import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { useInfiniteQuery, useQuery, useMutation, useQueryClient, type InfiniteData } from "@tanstack/react-query";
import { useNavigate, useSearchParams } from "react-router-dom";
import { usePrivy } from "@privy-io/react-auth";
import { useSession, useAuth } from "@/lib/auth-client";
import { api, ApiError } from "@/lib/api";
import { Post, User } from "@/types";
import { PostCard } from "@/components/feed/PostCard";
import { PostCardSkeleton, ProfileCardSkeleton } from "@/components/feed/PostCardSkeleton";
import { CreatePost } from "@/components/feed/CreatePost";
import { LevelBar } from "@/components/feed/LevelBar";
import { FeedHeader, FeedTab } from "@/components/feed/FeedHeader";
import { AnnouncementBanner } from "@/components/feed/AnnouncementBanner";
import { TrendingSection } from "@/components/feed/TrendingSection";
import { SearchBar } from "@/components/feed/SearchBar";
import { WindowVirtualList } from "@/components/virtual/WindowVirtualList";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Sparkles, RefreshCw, AlertCircle, Radar, BrainCircuit, Flame } from "lucide-react";
import { getAvatarUrl } from "@/types";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { readSessionCache, writeSessionCache } from "@/lib/session-cache";
import { QueryErrorBoundary } from "@/components/QueryErrorBoundary";
import { PhewTrophyIcon } from "@/components/icons/PhewIcons";

interface FeedPage {
  items: Post[];
  hasMore: boolean;
  nextCursor: string | null;
  totalPosts: number | null;
}

type CachedFeedPageEntry = {
  cachedAt: number;
  page: FeedPage;
};

const FEED_PAGE_SIZE = 10;
const FEED_MAX_PAGES = 5;
const FEED_FIRST_PAGE_CACHE_PREFIX = "phew.feed.first-page.v2";
const FEED_FIRST_PAGE_CACHE_TTL_MS = 30 * 60_000;
const FEED_PUBLIC_CACHE_SCOPE = "public";
const FEED_NEW_POSTS_POLL_MS = 15_000;
const FEED_ACTIVE_TAB_POLL_MS = 90_000;
const FEED_TAB_PREFETCH_ENABLED = false;
const FEED_AUTO_APPLY_NEW_POSTS_TOP_THRESHOLD_PX = 600;
const FEED_REALTIME_STATE_FIELDS_COUNT = 20;
const FEED_CURRENT_USER_CACHE_KEY = "phew.feed.current-user";
const FEED_CURRENT_USER_CACHE_TTL_MS = 30 * 60_000;
const FEED_LATEST_ACK_CACHE_KEY = "phew.feed.latest.ack.v1";
const FEED_LATEST_ACK_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const FEED_OLDER_POST_REFETCH_MIN_TOTAL_POSTS = 500;
const FEED_OLDER_POST_REFETCH_AGE_MS = 6 * 60 * 60 * 1000;
const FEED_RECENT_POST_CACHE_BYPASS_AGE_MS = 2 * 60 * 60 * 1000;
const FEED_LATEST_CACHE_HYDRATION_MAX_AGE_MS = 15_000;
const FEED_QUERY_GC_TIME_MS = 5 * 60_000;

function isGlobalOverlayOpen(): boolean {
  if (typeof document === "undefined") return false;
  if (
    document.body.classList.contains("overflow-hidden") ||
    document.documentElement.classList.contains("overflow-hidden") ||
    document.body.classList.contains("wallet-adapter-modal-open") ||
    document.body.classList.contains("phew-overlay-open")
  ) {
    return true;
  }
  if (document.body.style.overflow === "hidden" || document.documentElement.style.overflow === "hidden") {
    return true;
  }
  return document.querySelector("[role='dialog'][data-state='open']") !== null;
}

function hasActiveTradeDialogMarker(): boolean {
  if (typeof document === "undefined") return false;
  const active = document.body?.dataset?.phewActiveTradeDialogPostId?.trim();
  return Boolean(active);
}

function getFeedFirstPageCacheKey(viewerScope: string, tab: FeedTab, search: string): string {
  return `${FEED_FIRST_PAGE_CACHE_PREFIX}:${viewerScope}:${tab}:${search}`;
}

function readCachedFirstFeedPageEntry(
  viewerScope: string,
  tab: FeedTab,
  search: string
): CachedFeedPageEntry | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(getFeedFirstPageCacheKey(viewerScope, tab, search));
    if (!raw) return null;

    const parsed = JSON.parse(raw) as Partial<CachedFeedPageEntry>;

    if (
      typeof parsed?.cachedAt !== "number" ||
      !parsed.page ||
      !Array.isArray(parsed.page.items) ||
      parsed.page.items.length === 0 ||
      Date.now() - parsed.cachedAt > FEED_FIRST_PAGE_CACHE_TTL_MS
    ) {
      return null;
    }

    return {
      cachedAt: parsed.cachedAt,
      page: {
        ...parsed.page,
        totalPosts:
          typeof parsed.page.totalPosts === "number" && Number.isFinite(parsed.page.totalPosts)
            ? parsed.page.totalPosts
            : null,
      },
    };
  } catch {
    return null;
  }
}

function readCachedFirstFeedPage(viewerScope: string, tab: FeedTab, search: string): FeedPage | null {
  return readCachedFirstFeedPageEntry(viewerScope, tab, search)?.page ?? null;
}

function writeCachedFirstFeedPage(
  viewerScope: string,
  tab: FeedTab,
  search: string,
  page: FeedPage
): void {
  if (typeof window === "undefined") return;
  try {
    const cacheKey = getFeedFirstPageCacheKey(viewerScope, tab, search);
    if (!Array.isArray(page.items) || page.items.length === 0) {
      window.sessionStorage.removeItem(cacheKey);
      return;
    }
    window.sessionStorage.setItem(
      cacheKey,
      JSON.stringify({
        cachedAt: Date.now(),
        page,
      })
    );
  } catch {
    // Ignore storage quota / privacy mode issues.
  }
}

function stripPersonalizedPostState(post: Post): Post {
  if (!post.isLiked && !post.isReposted && !post.isFollowingAuthor) {
    return post;
  }

  return {
    ...post,
    isLiked: false,
    isReposted: false,
    isFollowingAuthor: false,
  };
}

function stripPersonalizedFeedPageState(page: FeedPage): FeedPage {
  let didChange = false;
  const nextItems = page.items.map((item) => {
    const nextItem = stripPersonalizedPostState(item);
    if (nextItem !== item) {
      didChange = true;
    }
    return nextItem;
  });

  if (!didChange) {
    return page;
  }

  return {
    ...page,
    items: nextItems,
  };
}

function shouldUseSharedPublicFeedCache(tab: FeedTab, search: string): boolean {
  return tab !== "following" && search.trim().length === 0;
}

function readPreferredCachedFirstFeedPageEntry(
  viewerScope: string,
  tab: FeedTab,
  search: string
): CachedFeedPageEntry | null {
  const scopedEntry = readCachedFirstFeedPageEntry(viewerScope, tab, search);
  if (scopedEntry?.page.items.length) {
    return scopedEntry;
  }
  if (!shouldUseSharedPublicFeedCache(tab, search) || viewerScope === FEED_PUBLIC_CACHE_SCOPE) {
    return scopedEntry;
  }
  const sharedEntry = readCachedFirstFeedPageEntry(FEED_PUBLIC_CACHE_SCOPE, tab, search);
  return sharedEntry?.page.items.length ? sharedEntry : scopedEntry;
}

function readPreferredCachedFirstFeedPage(
  viewerScope: string,
  tab: FeedTab,
  search: string
): FeedPage | null {
  return readPreferredCachedFirstFeedPageEntry(viewerScope, tab, search)?.page ?? null;
}

function writeCachedFirstFeedPageForScopes(
  viewerScope: string,
  tab: FeedTab,
  search: string,
  page: FeedPage
): void {
  writeCachedFirstFeedPage(viewerScope, tab, search, page);
  if (viewerScope !== FEED_PUBLIC_CACHE_SCOPE && shouldUseSharedPublicFeedCache(tab, search)) {
    writeCachedFirstFeedPage(
      FEED_PUBLIC_CACHE_SCOPE,
      tab,
      search,
      stripPersonalizedFeedPageState(page)
    );
  }
}

function buildRealtimePageFingerprint(page: FeedPage): string {
  return page.items
    .slice(0, FEED_REALTIME_STATE_FIELDS_COUNT)
    .map((item) => [
      item.id,
      item.settled ? "1" : "0",
      item.currentMcap ?? "null",
      item.mcap1h ?? "null",
      item.mcap6h ?? "null",
      item.isWin ?? "null",
      item.author?.level ?? "null",
      item.author?.xp ?? "null",
    ].join(":"))
    .join("|");
}

function sortPostsNewestFirst(items: Post[]): Post[] {
  return [...items].sort((a, b) => {
    const createdAtDelta = new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    if (createdAtDelta !== 0) {
      return createdAtDelta;
    }
    return b.id.localeCompare(a.id);
  });
}

function isRecentFeedPost(post: Pick<Post, "createdAt"> | null | undefined): boolean {
  if (!post?.createdAt) return false;
  const createdAtMs = new Date(post.createdAt).getTime();
  if (!Number.isFinite(createdAtMs)) return false;
  return Date.now() - createdAtMs < FEED_RECENT_POST_CACHE_BYPASS_AGE_MS;
}

function shouldUseCachedFeedPageForHydration(
  entry: CachedFeedPageEntry | null,
  tab: FeedTab,
  search: string
): boolean {
  if (!entry?.page.items.length) return false;
  if (tab !== "latest" || search.trim().length > 0) return true;

  const cacheAgeMs = Date.now() - entry.cachedAt;
  const hasRecentLatestPosts = entry.page.items.slice(0, 5).some((post) => isRecentFeedPost(post));
  if (!hasRecentLatestPosts) {
    return true;
  }

  return cacheAgeMs <= FEED_LATEST_CACHE_HYDRATION_MAX_AGE_MS;
}

function shouldBypassCachedRealtimeMerge(post: Post, tab: FeedTab, search: string): boolean {
  return tab === "latest" && search.trim().length === 0 && isRecentFeedPost(post);
}

function shouldMergeSessionCachedRealtimeState(tab: FeedTab, search: string): boolean {
  return !(tab === "latest" && search.trim().length === 0);
}

function mergePostWithCachedRealtimeState(
  post: Post,
  cachedPost: Post | null | undefined,
  options?: { preserveEngagementState?: boolean }
): Post {
  if (!cachedPost) {
    return post;
  }

  let didChange = false;
  let nextCurrentMcap = post.currentMcap;
  let nextSettled = post.settled;
  let nextSettledAt = post.settledAt;
  let nextMcap1h = post.mcap1h;
  let nextMcap6h = post.mcap6h;
  let nextIsWin = post.isWin;
  let nextIsLiked = post.isLiked;
  let nextIsReposted = post.isReposted;
  let nextIsFollowingAuthor = post.isFollowingAuthor;
  let nextCounts = post._count;

  const cachedLooksLikeLiveCurrent =
    cachedPost.currentMcap !== null &&
    cachedPost.entryMcap !== null &&
    cachedPost.currentMcap !== cachedPost.entryMcap;
  const fetchedLooksLikeBaselineCurrent =
    post.currentMcap === null ||
    (post.entryMcap !== null && post.currentMcap === post.entryMcap);

  if (cachedLooksLikeLiveCurrent && fetchedLooksLikeBaselineCurrent) {
    nextCurrentMcap = cachedPost.currentMcap;
    didChange = true;
  }

  if (cachedPost.settled && !post.settled) {
    nextSettled = true;
    nextSettledAt = cachedPost.settledAt ?? post.settledAt;
    didChange = true;
  }

  if (cachedPost.mcap1h !== null && post.mcap1h === null) {
    nextMcap1h = cachedPost.mcap1h;
    didChange = true;
  }

  if (cachedPost.mcap6h !== null && post.mcap6h === null) {
    nextMcap6h = cachedPost.mcap6h;
    didChange = true;
  }

  if (cachedPost.isWin !== null && post.isWin === null) {
    nextIsWin = cachedPost.isWin;
    didChange = true;
  }

  if (options?.preserveEngagementState) {
    if (cachedPost.isLiked && !post.isLiked) {
      nextIsLiked = true;
      didChange = true;

      const fetchedLikes = post._count?.likes ?? 0;
      const cachedLikes = cachedPost._count?.likes ?? fetchedLikes;
      if (cachedLikes > fetchedLikes) {
        nextCounts = {
          ...nextCounts,
          likes: cachedLikes,
        };
      }
    }

    if (cachedPost.isReposted && !post.isReposted) {
      nextIsReposted = true;
      didChange = true;

      const fetchedReposts = post._count?.reposts ?? 0;
      const cachedReposts = cachedPost._count?.reposts ?? fetchedReposts;
      if (cachedReposts > fetchedReposts) {
        nextCounts = {
          ...nextCounts,
          reposts: cachedReposts,
        };
      }
    }

    if (cachedPost.isFollowingAuthor && !post.isFollowingAuthor) {
      nextIsFollowingAuthor = true;
      didChange = true;
    }
  }

  if (!didChange) {
    return post;
  }

  return {
    ...post,
    currentMcap: nextCurrentMcap,
    settled: nextSettled,
    settledAt: nextSettledAt,
    mcap1h: nextMcap1h,
    mcap6h: nextMcap6h,
    isWin: nextIsWin,
    isLiked: nextIsLiked,
    isReposted: nextIsReposted,
    isFollowingAuthor: nextIsFollowingAuthor,
    _count: nextCounts,
  };
}

function shouldEnableFeedCardRealtimePolling(post: Post, totalPosts: number | null): boolean {
  if (totalPosts === null || totalPosts < FEED_OLDER_POST_REFETCH_MIN_TOTAL_POSTS) {
    return true;
  }

  const createdAtMs = new Date(post.createdAt).getTime();
  if (!Number.isFinite(createdAtMs)) {
    return true;
  }

  return Date.now() - createdAtMs < FEED_OLDER_POST_REFETCH_AGE_MS;
}

// Error Boundary Component for Feed
function FeedError({ error, onRetry }: { error: Error; onRetry: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 gap-4 text-center">
      <div className="w-20 h-20 rounded-full bg-destructive/10 flex items-center justify-center">
        <AlertCircle className="h-10 w-10 text-destructive" />
      </div>
      <div>
        <p className="font-semibold text-foreground text-lg">Failed to load posts</p>
        <p className="text-sm text-muted-foreground mt-1 max-w-xs">
          {error.message || "Something went wrong. Please try again."}
        </p>
      </div>
      <Button onClick={onRetry} variant="outline" className="mt-2">
        <RefreshCw className="h-4 w-4 mr-2" />
        Try Again
      </Button>
    </div>
  );
}

export default function Feed() {
  const { data: session } = useSession();
  const { signOut, hasLiveSession, canPerformAuthenticatedWrites } = useAuth();
  const { logout: privyLogout } = usePrivy();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [activeTab, setActiveTab] = useState<FeedTab>("latest");
  const [searchQuery, setSearchQuery] = useState(searchParams.get("search") || "");
  const loadMoreRef = useRef<HTMLDivElement>(null);
  const [hasUserScrolledForAutoLoad, setHasUserScrolledForAutoLoad] = useState(false);
  const [pendingLatestFirstPage, setPendingLatestFirstPage] = useState<FeedPage | null>(null);
  const [pendingLatestCount, setPendingLatestCount] = useState(0);
  const [isManualRefreshing, setIsManualRefreshing] = useState(false);
  const [isOverlayOpen, setIsOverlayOpen] = useState<boolean>(() => isGlobalOverlayOpen());
  const [frozenPostsWhileOverlayOpen, setFrozenPostsWhileOverlayOpen] = useState<Post[] | null>(null);
  const [latestAcknowledgedTopId, setLatestAcknowledgedTopId] = useState<string | null>(() =>
    readSessionCache<string>(FEED_LATEST_ACK_CACHE_KEY, FEED_LATEST_ACK_CACHE_TTL_MS)
  );
  const feedShownLoggedRef = useRef(false);
  const latestAcknowledgedTopIdRef = useRef<string | null>(latestAcknowledgedTopId);
  const effectiveSearchQuery = searchQuery.trim().length >= 3 ? searchQuery.trim() : "";
  // Keep feed cache/query scope stable while backend session confirmation catches up.
  // Using hasLiveSession here causes the feed query to bounce between anonymous and
  // user-scoped keys during transient /api/me churn, which can leave the page stuck
  // in loading even when /api/feed/latest itself is healthy.
  const feedViewerScope = session?.user?.id ?? "anonymous";
  const cachedFirstPageEntry = useMemo(
    () => readPreferredCachedFirstFeedPageEntry(feedViewerScope, activeTab, effectiveSearchQuery),
    [activeTab, effectiveSearchQuery, feedViewerScope]
  );
  const cachedFirstPage = cachedFirstPageEntry?.page ?? null;
  const hydrationCachedFirstPageEntry = useMemo(
    () =>
      shouldUseCachedFeedPageForHydration(cachedFirstPageEntry, activeTab, effectiveSearchQuery)
        ? cachedFirstPageEntry
        : null,
    [activeTab, cachedFirstPageEntry, effectiveSearchQuery]
  );
  const hydrationCachedFirstPage = hydrationCachedFirstPageEntry?.page ?? null;
  const feedCurrentUserCacheKey = useMemo(
    () => (session?.user?.id ? `${FEED_CURRENT_USER_CACHE_KEY}:${session.user.id}` : null),
    [session?.user?.id]
  );
  const cachedFeedUser = useMemo(
    () =>
      feedCurrentUserCacheKey
        ? readSessionCache<User>(feedCurrentUserCacheKey, FEED_CURRENT_USER_CACHE_TTL_MS)
        : null,
    [feedCurrentUserCacheKey]
  );
  const sessionBackedUser = useMemo<User | null>(() => {
    if (!session?.user) return cachedFeedUser;
    return {
      id: session.user.id,
      name: session.user.name,
      email: session.user.email,
      image: session.user.image ?? cachedFeedUser?.image ?? null,
      walletAddress: session.user.walletAddress ?? cachedFeedUser?.walletAddress ?? null,
      username: session.user.username ?? cachedFeedUser?.username ?? null,
      level: session.user.level ?? cachedFeedUser?.level ?? 0,
      xp: session.user.xp ?? cachedFeedUser?.xp ?? 0,
      bio: session.user.bio ?? cachedFeedUser?.bio ?? null,
      isAdmin: session.user.isAdmin ?? cachedFeedUser?.isAdmin ?? false,
      isVerified: session.user.isVerified ?? cachedFeedUser?.isVerified,
      tradeFeeRewardsEnabled:
        session.user.tradeFeeRewardsEnabled ?? cachedFeedUser?.tradeFeeRewardsEnabled,
      tradeFeeShareBps: session.user.tradeFeeShareBps ?? cachedFeedUser?.tradeFeeShareBps,
      tradeFeePayoutAddress:
        session.user.tradeFeePayoutAddress ?? cachedFeedUser?.tradeFeePayoutAddress ?? null,
      createdAt: session.user.createdAt ?? cachedFeedUser?.createdAt ?? new Date(0).toISOString(),
    };
  }, [cachedFeedUser, session?.user]);
  const isAuthWritePending = Boolean(session?.user) && !canPerformAuthenticatedWrites;
  const persistLatestAcknowledgedTopId = useCallback((nextTopId: string | null) => {
    latestAcknowledgedTopIdRef.current = nextTopId;
    setLatestAcknowledgedTopId(nextTopId);
    if (typeof window === "undefined") return;

    try {
      if (nextTopId) {
        writeSessionCache(FEED_LATEST_ACK_CACHE_KEY, nextTopId);
        return;
      }
      window.sessionStorage.removeItem(FEED_LATEST_ACK_CACHE_KEY);
    } catch {
      // Ignore storage access failures.
    }
  }, []);
  const clearPendingLatestState = useCallback(() => {
    setPendingLatestFirstPage(null);
    setPendingLatestCount(0);
  }, []);
  const setPendingLatestState = useCallback((nextFirstPage: FeedPage, nextCount: number) => {
    setPendingLatestFirstPage(nextFirstPage);
    setPendingLatestCount(nextCount);
  }, []);

  useEffect(() => {
    if (!hasLiveSession || !session?.user?.id) {
      feedShownLoggedRef.current = false;
      return;
    }

    if (feedShownLoggedRef.current) {
      return;
    }

    feedShownLoggedRef.current = true;
    console.info("[AuthFlow] feed shown", {
      userId: session.user.id,
      pathname: typeof window !== "undefined" ? window.location.pathname : null,
    });
  }, [hasLiveSession, session?.user?.id]);

  useEffect(() => {
    latestAcknowledgedTopIdRef.current = latestAcknowledgedTopId;
  }, [latestAcknowledgedTopId]);

  const guardPendingAuthWrite = useCallback(() => {
    if (!session?.user) {
      toast.info("Sign in to interact with posts.");
      return true;
    }
    if (!isAuthWritePending) {
      return false;
    }
    toast.warning("Signing you in...");
    return true;
  }, [isAuthWritePending, session?.user]);

  const handleSignOut = useCallback(async () => {
    await signOut();
    try {
      await privyLogout();
    } catch (error) {
      console.error("[Feed] Privy logout failed:", error);
    } finally {
      navigate("/login", { replace: true });
    }
  }, [navigate, privyLogout, signOut]);

  const handleWriteSessionExpired = useCallback(() => {
    toast.error("Session expired. Please sign in again.");
    void handleSignOut();
  }, [handleSignOut]);

  const getFeedQueryKey = useCallback(
    (tab: FeedTab, search: string, viewerScope: string) =>
      ["posts", viewerScope, tab, search] as const,
    []
  );
  const activeFeedQueryKey = useMemo(
    () => getFeedQueryKey(activeTab, effectiveSearchQuery, feedViewerScope),
    [activeTab, effectiveSearchQuery, feedViewerScope, getFeedQueryKey]
  );

  useEffect(() => {
    if (typeof document === "undefined" || typeof window === "undefined") return;

    let rafId = 0;
    const syncOverlayState = () => {
      if (rafId) return;
      rafId = window.requestAnimationFrame(() => {
        rafId = 0;
        const next = isGlobalOverlayOpen();
        setIsOverlayOpen((prev) => (prev === next ? prev : next));
      });
    };

    syncOverlayState();

    const observer = new MutationObserver(() => syncOverlayState());
    if (document.body) {
      observer.observe(document.body, {
        subtree: true,
        childList: true,
        attributes: true,
        attributeFilter: [
          "class",
          "style",
          "data-state",
          "role",
          "data-phew-pinned-item-key",
          "data-phew-active-trade-dialog-post-id",
        ],
      });
    }
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "style"],
    });

    window.addEventListener("focus", syncOverlayState);
    document.addEventListener("visibilitychange", syncOverlayState);
    return () => {
      if (rafId) {
        window.cancelAnimationFrame(rafId);
      }
      observer.disconnect();
      window.removeEventListener("focus", syncOverlayState);
      document.removeEventListener("visibilitychange", syncOverlayState);
    };
  }, []);

  const fetchFeedPage = useCallback(async (
    tab: FeedTab,
    search: string,
    pageParam?: string
  ): Promise<FeedPage> => {
    const liveCachedFirstPageEntry =
      !pageParam && !search && tab !== "following"
        ? readPreferredCachedFirstFeedPageEntry(feedViewerScope, tab, search)
        : null;
    const liveCachedFirstPage = liveCachedFirstPageEntry?.page ?? null;
    const queryKey = getFeedQueryKey(tab, search, feedViewerScope);
    const currentQueryFirstPage =
      !pageParam
        ? queryClient.getQueryData<InfiniteData<FeedPage>>(queryKey)?.pages?.[0] ?? null
        : null;
    const hasCurrentFirstPage = Boolean(currentQueryFirstPage?.items.length);
    const fallbackFirstPage =
      hasCurrentFirstPage && currentQueryFirstPage
        ? currentQueryFirstPage
        : liveCachedFirstPage && liveCachedFirstPage.items.length > 0
          ? liveCachedFirstPage
          : currentQueryFirstPage && currentQueryFirstPage.items.length > 0
            ? currentQueryFirstPage
            : null;
    const shouldUseCachedFirstPageFallback = !pageParam && !search && tab !== "following" && Boolean(fallbackFirstPage?.items.length);
    let endpoint = `/api/feed/${tab}`;
    const params = new URLSearchParams();

    if (search && search.length >= 3) {
      params.set("search", search);
    }
    params.set("limit", String(FEED_PAGE_SIZE));
    if (pageParam) {
      params.set("cursor", pageParam);
    }

    if (params.toString()) {
      endpoint += `?${params.toString()}`;
    }

    const response = await api.raw(endpoint, { cache: "no-store" });
    if (!response.ok) {
      if (shouldUseCachedFirstPageFallback && fallbackFirstPage) {
        return fallbackFirstPage;
      }
      const json = await response.json().catch(() => null);
      throw new ApiError(
        json?.error?.message || `Request failed with status ${response.status}`,
        response.status,
        json?.error || json
      );
    }

    const json = await response.json().catch(() => null) as {
      data?: {
        items?: Post[];
        nextCursor?: string | null;
        hasMore?: boolean;
        totalPosts?: number | null;
      };
    } | null;
    const data = json?.data;
    if (!data || !Array.isArray(data.items)) {
      throw new ApiError(
        "Feed payload was invalid. Please retry.",
        response.status,
        json
      );
    }
    const items = data.items;
    const nextCursor = typeof data.nextCursor === "string" ? data.nextCursor : null;
    const totalPosts =
      typeof data.totalPosts === "number" && Number.isFinite(data.totalPosts)
        ? data.totalPosts
        : null;
    const currentVisiblePostsById = new Map<string, Post>();
    const currentRealtimeMergeSource = hasCurrentFirstPage ? currentQueryFirstPage : null;
    for (const item of currentRealtimeMergeSource?.items ?? []) {
      currentVisiblePostsById.set(item.id, item);
    }

    const cachedRealtimePostsById = new Map<string, Post>();
    const canUseSessionRealtimeMerge =
      !pageParam &&
      !hasCurrentFirstPage &&
      shouldMergeSessionCachedRealtimeState(tab, search);
    if (canUseSessionRealtimeMerge && liveCachedFirstPage?.items?.length) {
      for (const item of liveCachedFirstPage.items) {
        if (currentVisiblePostsById.has(item.id) || cachedRealtimePostsById.has(item.id)) {
          continue;
        }
        cachedRealtimePostsById.set(item.id, item);
      }
    }
    const mergedItems = items.map((item) => {
      const mergedWithCurrentView = mergePostWithCachedRealtimeState(
        item,
        currentVisiblePostsById.get(item.id),
        { preserveEngagementState: true }
      );

      if (shouldBypassCachedRealtimeMerge(item, tab, search)) {
        return mergedWithCurrentView;
      }

      return mergePostWithCachedRealtimeState(
        mergedWithCurrentView,
        cachedRealtimePostsById.get(item.id)
      );
    });

    if (shouldUseCachedFirstPageFallback && fallbackFirstPage && mergedItems.length === 0) {
      return fallbackFirstPage;
    }

    return {
      items: mergedItems,
      nextCursor,
      hasMore: Boolean(data.hasMore && nextCursor),
      totalPosts,
    } satisfies FeedPage;
  }, [feedViewerScope, getFeedQueryKey, queryClient]);

  // Update URL when search changes
  const handleSearchChange = useCallback((value: string) => {
    setSearchQuery(value);
    if (value) {
      setSearchParams({ search: value });
    } else {
      setSearchParams({});
    }
  }, [setSearchParams]);

  // Fetch current user with React Query
  const {
    data: user,
    isLoading: isLoadingUser,
    error: userError,
    refetch: refetchUser,
    isFetched: isUserFetched,
  } = useQuery({
    queryKey: ["currentUser", session?.user?.id ?? "anonymous"],
    queryFn: async () => {
      try {
        return await api.get<User>("/api/me");
      } catch (error) {
        if (sessionBackedUser) {
          if (!(error instanceof ApiError)) {
            return sessionBackedUser;
          }
          if (error.status !== 401 && error.status !== 403) {
            return sessionBackedUser;
          }
        }
        throw error;
      }
    },
    initialData: sessionBackedUser ?? undefined,
    enabled: hasLiveSession,
    retry: (failureCount, error) => {
      if (error instanceof ApiError && (error.status === 401 || error.status === 403 || error.status === 429)) {
        return false;
      }
      return failureCount < 2;
    },
    staleTime: 30000, // 30 seconds
    refetchInterval: hasLiveSession && !isOverlayOpen ? 45_000 : false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

  useEffect(() => {
    if (!isUserFetched || !user || !feedCurrentUserCacheKey) return;
    writeSessionCache(feedCurrentUserCacheKey, user);
  }, [feedCurrentUserCacheKey, isUserFetched, user]);

  // Fetch posts with React Query
  const {
    data: postsPages,
    isLoading: isLoadingPosts,
    error: postsError,
    refetch: refetchPosts,
    isFetching,
    isFetchingNextPage,
    dataUpdatedAt: postsDataUpdatedAt,
    fetchNextPage,
    hasNextPage,
  } = useInfiniteQuery({
    queryKey: activeFeedQueryKey,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => fetchFeedPage(activeTab, effectiveSearchQuery, pageParam),
    getNextPageParam: (lastPage) => (lastPage.hasMore ? (lastPage.nextCursor ?? undefined) : undefined),
    maxPages: FEED_MAX_PAGES,
    initialData: hydrationCachedFirstPage
      ? {
          pages: [hydrationCachedFirstPage],
          pageParams: [undefined],
        }
      : undefined,
    initialDataUpdatedAt: hydrationCachedFirstPageEntry?.cachedAt,
    enabled: activeTab !== "following" || hasLiveSession,
    retry: (failureCount, error) => {
      if (error instanceof ApiError && error.status === 429) {
        return false;
      }
      return failureCount < 2;
    },
    gcTime: FEED_QUERY_GC_TIME_MS,
    staleTime: 60_000, // 1 minute; reduces tab-switch reloads
    refetchOnMount: "always",
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    refetchInterval: false,
  });

  const posts = useMemo(() => {
    const mergedPosts = postsPages?.pages.flatMap((page) => page.items) ?? [];
    if (activeTab === "hot-alpha" || activeTab === "early-runners" || activeTab === "high-conviction") {
      return mergedPosts;
    }
    return sortPostsNewestFirst(mergedPosts);
  }, [activeTab, postsPages?.pages]);
  const feedTotalPosts = useMemo(
    () =>
      postsPages?.pages.find((page) => typeof page.totalPosts === "number")?.totalPosts ??
      cachedFirstPage?.totalPosts ??
      null,
    [cachedFirstPage?.totalPosts, postsPages?.pages]
  );
  const hasLiveOverlay = useCallback(
    () => isOverlayOpen || hasActiveTradeDialogMarker(),
    [isOverlayOpen]
  );
  const shouldFreezeFeedItems = isOverlayOpen || hasActiveTradeDialogMarker();
  useEffect(() => {
    if (shouldFreezeFeedItems) {
      setFrozenPostsWhileOverlayOpen((prev) => prev ?? posts);
      return;
    }
    setFrozenPostsWhileOverlayOpen(null);
  }, [posts, shouldFreezeFeedItems]);
  const displayedPosts = frozenPostsWhileOverlayOpen ?? posts;
  const shouldShowFollowingAuthState = activeTab === "following" && !hasLiveSession;
  const hasPosts = displayedPosts.length > 0;
  const shouldShowFeedFatalError = Boolean(postsError && !hasPosts && !shouldShowFollowingAuthState);
  const shouldShowFeedSoftError = Boolean(postsError && hasPosts);
  const isRefreshing = isManualRefreshing || (isFetching && !isFetchingNextPage);

  useEffect(() => {
    const firstPage = postsPages?.pages?.[0];
    if (!firstPage) return;
    if (postsDataUpdatedAt <= 0) return;
    if (
      hydrationCachedFirstPageEntry?.cachedAt &&
      postsDataUpdatedAt <= hydrationCachedFirstPageEntry.cachedAt
    ) {
      return;
    }
    writeCachedFirstFeedPageForScopes(feedViewerScope, activeTab, effectiveSearchQuery, firstPage);
  }, [
    activeTab,
    effectiveSearchQuery,
    feedViewerScope,
    hydrationCachedFirstPageEntry?.cachedAt,
    postsDataUpdatedAt,
    postsPages?.pages,
  ]);

  const updateInfinitePosts = useCallback((updater: (post: Post) => Post) => {
    const updatedData = queryClient.setQueryData<InfiniteData<FeedPage>>(
      activeFeedQueryKey,
      (oldData) => {
        if (!oldData) return oldData;
        return {
          ...oldData,
          pages: oldData.pages.map((page) => ({
            ...page,
            items: page.items.map(updater),
          })),
        };
      }
    );
    const nextFirstPage = updatedData?.pages?.[0];
    if (nextFirstPage?.items.length) {
      writeCachedFirstFeedPageForScopes(
        feedViewerScope,
        activeTab,
        effectiveSearchQuery,
        nextFirstPage
      );
    }
  }, [activeFeedQueryKey, activeTab, effectiveSearchQuery, feedViewerScope, queryClient]);

  const applyFirstPageToCache = useCallback(
    (tab: FeedTab, search: string, nextFirstPage: FeedPage) => {
      queryClient.setQueryData<InfiniteData<FeedPage>>(
        getFeedQueryKey(tab, search, feedViewerScope),
        (oldData) => {
          if (!oldData || oldData.pages.length === 0) {
            return {
              pages: [nextFirstPage],
              pageParams: [undefined],
            };
          }

          const preserveDisplacedItems = hasLiveOverlay();
          if (preserveDisplacedItems) {
            return oldData;
          }
          const nextIds = new Set(nextFirstPage.items.map((item) => item.id));
          const [previousFirstPage, ...restPages] = oldData.pages;
          const carryOverItems = (previousFirstPage?.items ?? []).filter(
            (item) => !nextIds.has(item.id)
          );

          const nextPages: FeedPage[] = [nextFirstPage];
          const globalSeenIds = new Set(nextFirstPage.items.map((item) => item.id));

          const restWithCarry: FeedPage[] = [];
          if (carryOverItems.length > 0) {
            restWithCarry.push({
              hasMore: true,
              nextCursor: nextFirstPage.nextCursor ?? null,
              items: carryOverItems,
              totalPosts: nextFirstPage.totalPosts,
            });
          }
          restWithCarry.push(...restPages);

          for (const page of restWithCarry) {
            const dedupedItems = page.items.filter((item) => {
              if (nextIds.has(item.id)) return false;
              if (globalSeenIds.has(item.id)) return false;
              globalSeenIds.add(item.id);
              return true;
            });
            if (dedupedItems.length === 0) continue;
            nextPages.push({
              ...page,
              items: dedupedItems,
            });
          }

          return {
            ...oldData,
            pages: nextPages,
          };
        }
      );
    },
    [feedViewerScope, getFeedQueryKey, hasLiveOverlay, queryClient]
  );

  const applyPendingLatestPosts = useCallback(() => {
    if (!pendingLatestFirstPage) return;
    applyFirstPageToCache("latest", "", pendingLatestFirstPage);
    writeCachedFirstFeedPageForScopes(feedViewerScope, "latest", "", pendingLatestFirstPage);
    persistLatestAcknowledgedTopId(pendingLatestFirstPage.items[0]?.id ?? null);
    clearPendingLatestState();
  }, [
    applyFirstPageToCache,
    clearPendingLatestState,
    feedViewerScope,
    pendingLatestFirstPage,
    persistLatestAcknowledgedTopId,
  ]);

  const visibleLatestTopId =
    activeTab === "latest" && !effectiveSearchQuery
      ? postsPages?.pages?.[0]?.items?.[0]?.id ?? null
      : null;

  useEffect(() => {
    if (!visibleLatestTopId) return;
    if (typeof window === "undefined") return;
    if (hasLiveOverlay()) return;
    if (window.scrollY >= FEED_AUTO_APPLY_NEW_POSTS_TOP_THRESHOLD_PX) return;

    persistLatestAcknowledgedTopId(visibleLatestTopId);
    if (pendingLatestFirstPage?.items?.[0]?.id === visibleLatestTopId) {
      clearPendingLatestState();
    }
  }, [
    clearPendingLatestState,
    hasLiveOverlay,
    pendingLatestFirstPage?.items,
    persistLatestAcknowledgedTopId,
    visibleLatestTopId,
  ]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const onScroll = () => {
      if (window.scrollY > 120) {
        setHasUserScrolledForAutoLoad(true);
      }
    };

    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    if (!FEED_TAB_PREFETCH_ENABLED) return;
    if (!hasLiveSession) return;
    if (activeTab !== "latest") return;
    if (searchQuery.trim().length >= 3) return;
    if (!postsPages?.pages?.length) return;

    const prefetchTabs = () => {
      const tabsToPrefetch: FeedTab[] = ["hot-alpha", "early-runners", "high-conviction", "following"];

      for (const tab of tabsToPrefetch) {
        const key = getFeedQueryKey(tab, "", feedViewerScope);
        const state = queryClient.getQueryState(key);
        if (state?.status === "success" && Date.now() - state.dataUpdatedAt < 45_000) {
          continue;
        }

        void queryClient.prefetchInfiniteQuery({
          queryKey: key,
          initialPageParam: undefined as string | undefined,
          queryFn: ({ pageParam }) => fetchFeedPage(tab, "", pageParam),
          getNextPageParam: (lastPage) => (lastPage.hasMore ? (lastPage.nextCursor ?? undefined) : undefined),
          staleTime: 60_000,
        });
      }
    };

    let idleHandle: number | null = null;
    const timer = window.setTimeout(() => {
      if ("requestIdleCallback" in window) {
        idleHandle = window.requestIdleCallback(() => {
          prefetchTabs();
        }, { timeout: 1500 });
        return;
      }

      prefetchTabs();
    }, 2200);

    return () => {
      window.clearTimeout(timer);
      if (idleHandle !== null && "cancelIdleCallback" in window) {
        window.cancelIdleCallback(idleHandle);
      }
    };
  }, [
    activeTab,
    feedViewerScope,
    fetchFeedPage,
    getFeedQueryKey,
    postsPages?.pages?.length,
    queryClient,
    searchQuery,
    hasLiveSession,
  ]);

  useEffect(() => {
    if (!hasNextPage || isFetchingNextPage) return;
    if (typeof window === "undefined" || typeof IntersectionObserver === "undefined") return;
    if (!hasUserScrolledForAutoLoad) return;
    const node = loadMoreRef.current;
    if (!node) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (entry?.isIntersecting) {
          void fetchNextPage();
        }
      },
      {
        root: null,
        rootMargin: "100px 0px",
        threshold: 0,
      }
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, [fetchNextPage, hasNextPage, hasUserScrolledForAutoLoad, isFetchingNextPage]);

  // X-style lightweight new-post detection on Latest:
  // poll only the first page every 30s, then show a "new posts" button (or auto-apply near top).
  useEffect(() => {
    if (activeTab !== "latest") return;
    if (effectiveSearchQuery) return;
    if (hasLiveOverlay()) return;
    if (typeof window === "undefined") return;

    let cancelled = false;
    let inFlight = false;

    const checkForNewPosts = async () => {
      if (cancelled || inFlight) return;
      if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
      if (typeof navigator !== "undefined" && navigator.onLine === false) return;
      if (hasLiveOverlay()) return;

      const currentData = queryClient.getQueryData<InfiniteData<FeedPage>>(
        getFeedQueryKey("latest", "", feedViewerScope)
      );
      const currentFirstPage =
        currentData?.pages?.[0] ??
        readPreferredCachedFirstFeedPage(feedViewerScope, "latest", "") ??
        null;
      const baselineTopId = latestAcknowledgedTopIdRef.current ?? currentFirstPage?.items[0]?.id ?? null;
      if (!currentFirstPage && !baselineTopId) return;

      inFlight = true;
      try {
        const freshFirstPage = await fetchFeedPage("latest", "");
        if (cancelled || freshFirstPage.items.length === 0) return;
        if (hasLiveOverlay()) return;

        const freshTopId = freshFirstPage.items[0]?.id;

        if (!freshTopId) {
          return;
        }

        if (!baselineTopId) {
          if (window.scrollY < FEED_AUTO_APPLY_NEW_POSTS_TOP_THRESHOLD_PX) {
            applyFirstPageToCache("latest", "", freshFirstPage);
            writeCachedFirstFeedPageForScopes(feedViewerScope, "latest", "", freshFirstPage);
            persistLatestAcknowledgedTopId(freshTopId);
            clearPendingLatestState();
            return;
          }

          setPendingLatestState(freshFirstPage, freshFirstPage.items.length);
          return;
        }

        if (baselineTopId === freshTopId) {
          const currentFingerprint = buildRealtimePageFingerprint(currentFirstPage ?? freshFirstPage);
          const freshFingerprint = buildRealtimePageFingerprint(freshFirstPage);

          if (currentFingerprint !== freshFingerprint) {
            applyFirstPageToCache("latest", "", freshFirstPage);
            writeCachedFirstFeedPageForScopes(feedViewerScope, "latest", "", freshFirstPage);
            if (window.scrollY < FEED_AUTO_APPLY_NEW_POSTS_TOP_THRESHOLD_PX) {
              persistLatestAcknowledgedTopId(freshTopId);
            }
            clearPendingLatestState();
            void refetchUser();
            return;
          }

          clearPendingLatestState();
          return;
        }

        let newCount = 0;
        for (const item of freshFirstPage.items) {
          if (item.id === baselineTopId) break;
          newCount++;
        }
        if (newCount <= 0) {
          newCount = freshFirstPage.items.length;
        }

        // If user is near the top, apply instantly for a seamless "live" feel.
        if (window.scrollY < FEED_AUTO_APPLY_NEW_POSTS_TOP_THRESHOLD_PX) {
          applyFirstPageToCache("latest", "", freshFirstPage);
          writeCachedFirstFeedPageForScopes(feedViewerScope, "latest", "", freshFirstPage);
          persistLatestAcknowledgedTopId(freshTopId);
          clearPendingLatestState();
          return;
        }

        setPendingLatestState(freshFirstPage, newCount);
      } catch {
        // Silent failure; polling should never break feed UX.
      } finally {
        inFlight = false;
      }
    };

    void checkForNewPosts();

    const intervalId = window.setInterval(() => {
      void checkForNewPosts();
    }, FEED_NEW_POSTS_POLL_MS);

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void checkForNewPosts();
      }
    };

    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [
    activeTab,
    applyFirstPageToCache,
    clearPendingLatestState,
    effectiveSearchQuery,
    feedViewerScope,
    fetchFeedPage,
    getFeedQueryKey,
    hasLiveOverlay,
    persistLatestAcknowledgedTopId,
    queryClient,
    refetchUser,
    setPendingLatestState,
  ]);

  // Keep non-latest tabs (and searched latest) fresh with lightweight first-page sync.
  // This stays visibility-aware and online-aware to reduce unnecessary traffic.
  useEffect(() => {
    if (!hasLiveSession) return;
    if (activeTab === "latest" && !effectiveSearchQuery) return;
    if (hasLiveOverlay()) return;
    if (typeof window === "undefined") return;

    let cancelled = false;
    let inFlight = false;

    const refreshActiveTabFirstPage = async () => {
      if (cancelled || inFlight) return;
      if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
      if (typeof navigator !== "undefined" && navigator.onLine === false) return;
      if (hasLiveOverlay()) return;

      const currentData = queryClient.getQueryData<InfiniteData<FeedPage>>(
        getFeedQueryKey(activeTab, effectiveSearchQuery, feedViewerScope)
      );
      const currentFirstPage = currentData?.pages?.[0];
      if (!currentFirstPage || currentFirstPage.items.length === 0) return;

      inFlight = true;
      try {
        const freshFirstPage = await fetchFeedPage(activeTab, effectiveSearchQuery);
        if (cancelled || freshFirstPage.items.length === 0) return;
        if (hasLiveOverlay()) return;

        const currentTopId = currentFirstPage.items[0]?.id;
        const freshTopId = freshFirstPage.items[0]?.id;
        if (!currentTopId || !freshTopId) return;

        if (currentTopId === freshTopId) {
          const currentFingerprint = buildRealtimePageFingerprint(currentFirstPage);
          const freshFingerprint = buildRealtimePageFingerprint(freshFirstPage);
          if (currentFingerprint === freshFingerprint) {
            return;
          }
        }

        applyFirstPageToCache(activeTab, effectiveSearchQuery, freshFirstPage);
        writeCachedFirstFeedPageForScopes(
          feedViewerScope,
          activeTab,
          effectiveSearchQuery,
          freshFirstPage
        );
      } catch {
        // Keep current feed visible; next interval will retry.
      } finally {
        inFlight = false;
      }
    };

    void refreshActiveTabFirstPage();

    const intervalId = window.setInterval(() => {
      void refreshActiveTabFirstPage();
    }, FEED_ACTIVE_TAB_POLL_MS);

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void refreshActiveTabFirstPage();
      }
    };

    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [
    activeTab,
    applyFirstPageToCache,
    effectiveSearchQuery,
    feedViewerScope,
    fetchFeedPage,
    getFeedQueryKey,
    hasLiveOverlay,
    queryClient,
    hasLiveSession,
  ]);

  // Create post mutation
  const createPostMutation = useMutation({
    mutationFn: async (content: string) => {
      const newPost = await api.post<Post>("/api/posts", { content });
      return newPost;
    },
    onSuccess: (newPost) => {
      const prependPostToFeed = (tab: FeedTab, search: string) => {
        const queryKey = getFeedQueryKey(tab, search, feedViewerScope);
        const updatedData = queryClient.setQueryData<InfiniteData<FeedPage>>(queryKey, (oldData) => {
          if (!oldData || oldData.pages.length === 0) {
            return oldData;
          }
          const [firstPage, ...restPages] = oldData.pages;
          if (!firstPage) return oldData;

          const dedupedItems = firstPage.items.filter((item) => item.id !== newPost.id);
          const nextFirstPage: FeedPage = {
            ...firstPage,
            items: [newPost, ...dedupedItems],
          };

          return {
            ...oldData,
            pages: [nextFirstPage, ...restPages],
          };
        });

        const nextFirstPage = updatedData?.pages?.[0];
        if (nextFirstPage && nextFirstPage.items.length > 0) {
          writeCachedFirstFeedPageForScopes(feedViewerScope, tab, search, nextFirstPage);
        }
      };

      prependPostToFeed(activeTab, effectiveSearchQuery);
      if (activeTab !== "latest" || effectiveSearchQuery) {
        prependPostToFeed("latest", "");
      }
      toast.success("Alpha posted!");
      // Refresh user data in case level changed
      refetchUser();
    },
    onError: (error) => {
      if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
        handleWriteSessionExpired();
        return;
      }
      const message = error instanceof ApiError ? error.message : "Failed to post";
      toast.error(message);
    },
  });

  // Like mutation
  const likeMutation = useMutation({
    mutationFn: async ({ postId, isLiked }: { postId: string; isLiked: boolean }) => {
      if (isLiked) {
        await api.delete(`/api/posts/${postId}/like`);
      } else {
        await api.post(`/api/posts/${postId}/like`);
      }
      return { postId, isLiked };
    },
    onSuccess: ({ postId, isLiked }) => {
      updateInfinitePosts((post) =>
        post.id === postId
          ? {
              ...post,
              isLiked: !isLiked,
              _count: {
                ...post._count,
                likes: post._count.likes + (isLiked ? -1 : 1),
              },
            }
          : post
      );
    },
    onError: (error) => {
      if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
        handleWriteSessionExpired();
      }
    },
  });

  // Repost mutation
  const repostMutation = useMutation({
    mutationFn: async ({ postId, isReposted }: { postId: string; isReposted: boolean }) => {
      if (isReposted) {
        await api.delete(`/api/posts/${postId}/repost`);
      } else {
        await api.post(`/api/posts/${postId}/repost`);
      }
      return { postId, isReposted };
    },
    onSuccess: ({ postId, isReposted }) => {
      updateInfinitePosts((post) =>
        post.id === postId
          ? {
              ...post,
              isReposted: !isReposted,
              _count: {
                ...post._count,
                reposts: post._count.reposts + (isReposted ? -1 : 1),
              },
            }
          : post
      );
    },
    onError: (error) => {
      if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
        handleWriteSessionExpired();
      }
    },
  });

  // Comment mutation
  const commentMutation = useMutation({
    mutationFn: async ({ postId, content }: { postId: string; content: string }) => {
      await api.post(`/api/posts/${postId}/comments`, { content });
      return { postId };
    },
    onSuccess: ({ postId }) => {
      toast.success("Comment added!");
      // Update comment count
      updateInfinitePosts((post) =>
        post.id === postId
          ? {
              ...post,
              _count: {
                ...post._count,
                comments: post._count.comments + 1,
              },
            }
          : post
      );
    },
    onError: (error) => {
      if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
        handleWriteSessionExpired();
        return;
      }
      toast.error("Failed to add comment");
    },
  });

  // Handlers
  const handleCreatePost = async (content: string) => {
    if (guardPendingAuthWrite()) {
      return;
    }
    await createPostMutation.mutateAsync(content);
  };

  const handleLike = async (postId: string) => {
    if (guardPendingAuthWrite()) {
      return;
    }
    const post = displayedPosts.find((p) => p.id === postId);
    if (post) {
      likeMutation.mutate({ postId, isLiked: post.isLiked });
    }
  };

  const handleRepost = async (postId: string) => {
    if (guardPendingAuthWrite()) {
      return;
    }
    const post = displayedPosts.find((p) => p.id === postId);
    if (post) {
      repostMutation.mutate({ postId, isReposted: post.isReposted });
    }
  };

  const handleComment = async (postId: string, content: string) => {
    if (guardPendingAuthWrite()) {
      return;
    }
    await commentMutation.mutateAsync({ postId, content });
  };

  const handleTabChange = (tab: FeedTab) => {
    setActiveTab(tab);
  };

  const handleRefresh = () => {
    void (async () => {
      if (activeTab === "latest" && !effectiveSearchQuery && pendingLatestFirstPage) {
        applyPendingLatestPosts();
        return;
      }

      setIsManualRefreshing(true);
      try {
        const freshFirstPage = await fetchFeedPage(activeTab, effectiveSearchQuery);
        applyFirstPageToCache(activeTab, effectiveSearchQuery, freshFirstPage);
        writeCachedFirstFeedPageForScopes(
          feedViewerScope,
          activeTab,
          effectiveSearchQuery,
          freshFirstPage
        );
        if (activeTab === "latest" && !effectiveSearchQuery) {
          persistLatestAcknowledgedTopId(freshFirstPage.items[0]?.id ?? null);
          clearPendingLatestState();
        }
      } catch {
        // Fallback to react-query refetch if manual refresh fails
        queryClient.setQueryData<InfiniteData<FeedPage>>(
          activeFeedQueryKey,
          (oldData) => {
            if (!oldData) return oldData;
            return {
              ...oldData,
              pages: oldData.pages.slice(0, 1),
              pageParams: oldData.pageParams.slice(0, 1),
            };
          }
        );
        await refetchPosts();
      } finally {
        setIsManualRefreshing(false);
      }
    })();
  };

  const autoLoadEnabled = Boolean(hasNextPage && hasUserScrolledForAutoLoad);
  const showLoadMoreControls = Boolean(hasNextPage);
  const showTrendingSection = activeTab === "latest" && searchQuery.trim().length < 3;

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <FeedHeader
        user={user ?? null}
        activeTab={activeTab}
        onTabChange={handleTabChange}
        onLogout={handleSignOut}
      />

      <main className="app-page-shell">
        {/* 1. Pinned Announcements (at very top) */}
        <AnnouncementBanner />

        {/* 2. Trending Now Section */}
        {showTrendingSection ? (
          <QueryErrorBoundary sectionName="Trending">
            <TrendingSection />
          </QueryErrorBoundary>
        ) : null}

        {/* 3. Search Bar (prominent, always visible) */}
        <SearchBar
          value={searchQuery}
          onChange={handleSearchChange}
          isLoading={isRefreshing && searchQuery.length >= 3}
        />

        {/* User Profile Card */}
        {isLoadingUser ? (
          <ProfileCardSkeleton className="mb-6" />
        ) : user ? (
          <div className="app-surface mb-6 p-5 sm:p-6">
            <div className="flex items-center gap-4">
              <Avatar className="h-16 w-16 border-2 border-primary/25 ring-4 ring-white/70 dark:ring-background">
                <AvatarImage src={getAvatarUrl(user.id, user.image)} />
                <AvatarFallback className="bg-muted text-muted-foreground text-xl">
                  {user.name?.charAt(0) || "?"}
                </AvatarFallback>
              </Avatar>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <h2 className="font-bold text-lg truncate">{user.username || user.name}</h2>
                  <PhewTrophyIcon className="h-4 w-4 text-primary" />
                </div>
                <p className="truncate text-xs text-muted-foreground">{user.email}</p>
                {/* XP Display */}
                <p className="mt-3 text-lg font-semibold text-primary">
                  {user.xp?.toLocaleString() || 0} XP
                </p>
              </div>
            </div>
            {/* Large Level Bar */}
            <div className="mt-5">
              <LevelBar level={user.level} size="xl" />
            </div>
          </div>
        ) : userError ? (
          <div className="app-surface mb-6 border-destructive/30 p-5">
            <div className="flex items-center gap-3 text-destructive">
              <AlertCircle className="h-5 w-5" />
              <span className="text-sm">Failed to load profile</span>
              <Button variant="ghost" size="sm" onClick={() => refetchUser()} className="ml-auto">
                Retry
              </Button>
            </div>
          </div>
        ) : null}

        {/* Create Post */}
        <div className="mb-6">
          <CreatePost
            user={user ?? null}
            onSubmit={handleCreatePost}
            isSubmitting={createPostMutation.isPending}
            isAuthPending={isAuthWritePending}
          />
        </div>

        {/* 4. Refresh Button and Tab Label */}
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            {searchQuery.length >= 3 ? (
              `Search results for "${searchQuery}"`
            ) : (
              <>
                {activeTab === "latest" && "Latest Posts"}
                {activeTab === "hot-alpha" && "Hot Alpha"}
                {activeTab === "early-runners" && "Early Runners"}
                {activeTab === "high-conviction" && "High Conviction"}
                {activeTab === "following" && "Following"}
              </>
            )}
          </h3>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleRefresh}
            disabled={isRefreshing}
            className="h-9 gap-1.5 rounded-full border border-border/60 bg-white/60 px-3 text-muted-foreground shadow-[0_18px_30px_-28px_hsl(var(--foreground)/0.16)] hover:text-foreground dark:border-white/[0.08] dark:bg-white/[0.04] dark:shadow-none"
          >
            <RefreshCw className={cn("h-3.5 w-3.5", isRefreshing && "animate-spin")} />
            <span className="text-xs">Refresh</span>
          </Button>
        </div>

        {/* Feed */}
        <div className="space-y-4">
          {activeTab === "latest" && !effectiveSearchQuery && pendingLatestCount > 0 ? (
            <div className="sticky top-[7.25rem] z-20 flex justify-center">
              <Button
                type="button"
                onClick={applyPendingLatestPosts}
                className="h-10 rounded-full border border-primary/25 px-4 shadow-[0_20px_46px_-20px_hsl(var(--primary)/0.45)]"
              >
                {pendingLatestCount > FEED_PAGE_SIZE ? `${FEED_PAGE_SIZE}+` : pendingLatestCount} new alpha{pendingLatestCount === 1 ? "" : "s"} posted - Show
              </Button>
            </div>
          ) : null}

          {shouldShowFeedSoftError ? (
            <div className="app-surface-soft mb-3 border-amber-400/25 bg-amber-400/10 p-3 text-amber-900 dark:text-amber-100">
              <div className="flex items-center gap-2">
                <AlertCircle className="h-4 w-4" />
                <span className="text-xs sm:text-sm">
                  Live refresh is temporarily delayed. Existing posts stay visible.
                </span>
                <Button variant="ghost" size="sm" onClick={() => void refetchPosts()} className="ml-auto h-7 px-2 text-xs">
                  Retry
                </Button>
              </div>
            </div>
          ) : null}

          {isLoadingPosts && !hasPosts ? (
            // Loading Skeletons
            <>
              {[0, 1, 2].map((i) => (
                <PostCardSkeleton
                  key={i}
                  showMarketData={i < 2}
                  className="animate-fade-in-up"
                  style={{ animationDelay: `${i * 0.1}s` }}
                />
              ))}
            </>
          ) : shouldShowFollowingAuthState ? (
            <div className="app-empty-state">
              <div className="flex h-20 w-20 items-center justify-center rounded-full bg-muted">
                <Sparkles className="h-10 w-10 text-muted-foreground" />
              </div>
              <div>
                <p className="font-semibold text-foreground text-lg">Sign in to see Following</p>
                <p className="text-sm text-muted-foreground mt-1">
                  Follow traders and their new calls will appear here.
                </p>
              </div>
            </div>
          ) : shouldShowFeedFatalError ? (
            <FeedError
              error={postsError as Error}
              onRetry={() => refetchPosts()}
            />
          ) : displayedPosts.length === 0 ? (
            <div className="app-empty-state">
              <div className="flex h-20 w-20 items-center justify-center rounded-full bg-muted">
                {activeTab === "hot-alpha" ? (
                  <Flame className="h-10 w-10 text-muted-foreground" />
                ) : activeTab === "early-runners" ? (
                  <Radar className="h-10 w-10 text-muted-foreground" />
                ) : activeTab === "high-conviction" ? (
                  <BrainCircuit className="h-10 w-10 text-muted-foreground" />
                ) : (
                  <Sparkles className="h-10 w-10 text-muted-foreground" />
                )}
              </div>
              <div>
                <p className="font-semibold text-foreground text-lg">
                  {searchQuery.length >= 3
                    ? "No results found"
                    : activeTab === "high-conviction"
                    ? "No high conviction calls yet"
                    : activeTab === "early-runners"
                    ? "No early runners yet"
                    : activeTab === "hot-alpha"
                    ? "No hot alpha yet"
                    : activeTab === "following"
                    ? "No posts from people you follow"
                    : "No alpha yet"}
                </p>
                <p className="text-sm text-muted-foreground mt-1">
                  {searchQuery.length >= 3
                    ? `Try a different search term`
                    : activeTab === "high-conviction"
                    ? "Calls with the strongest combined trust, confidence, and token health will show here"
                    : activeTab === "early-runners"
                    ? "AI-detected breakouts will surface here once signals line up"
                    : activeTab === "hot-alpha"
                    ? "Strong signal, engagement, and momentum calls will surface here"
                    : activeTab === "following"
                    ? "Follow some traders to see their calls here"
                    : "Be the first to drop a call!"}
                </p>
              </div>
            </div>
          ) : (
            <>
              <WindowVirtualList
                items={displayedPosts}
                getItemKey={(post) => post.id}
                estimateItemHeight={560}
                overscanPx={1400}
                renderItem={(post, index) => (
                  <div className={index < displayedPosts.length - 1 ? "pb-4" : undefined}>
                    <div
                      className="animate-fade-in-up"
                      style={{ animationDelay: `${Math.min(index, 8) * 0.05}s` }}
                    >
                          <PostCard
                            post={post}
                            currentUserId={user?.id}
                            onLike={handleLike}
                            onRepost={handleRepost}
                            onComment={handleComment}
                            enableRealtimePricePolling={shouldEnableFeedCardRealtimePolling(post, feedTotalPosts)}
                          />
                    </div>
                  </div>
                )}
              />

              {showLoadMoreControls ? (
                <div className="pt-2">
                  {autoLoadEnabled ? <div ref={loadMoreRef} className="h-1 w-full" aria-hidden="true" /> : null}

                  <div className="flex flex-col items-center gap-3 py-2">
                    {isFetchingNextPage ? (
                      <>
                        <div className="flex items-center gap-2 text-sm text-muted-foreground">
                          <RefreshCw className="h-4 w-4 animate-spin" />
                          Loading more posts...
                        </div>
                        <PostCardSkeleton showMarketData={false} />
                      </>
                    ) : (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => void fetchNextPage()}
                        className="px-4"
                      >
                        Show more
                      </Button>
                    )}
                  </div>
                </div>
              ) : null}
            </>
          )}
        </div>
      </main>
    </div>
  );
}
