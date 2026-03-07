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
import { Sparkles, RefreshCw, Trophy, TrendingUp, AlertCircle } from "lucide-react";
import { getAvatarUrl } from "@/types";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { readSessionCache, writeSessionCache } from "@/lib/session-cache";

interface FeedPage {
  items: Post[];
  hasMore: boolean;
  nextCursor: string | null;
}

const FEED_PAGE_SIZE = 10;
const FEED_MAX_PAGES = 5;
const FEED_FIRST_PAGE_CACHE_PREFIX = "phew.feed.first-page.v2";
const FEED_FIRST_PAGE_CACHE_TTL_MS = 30 * 60_000;
const FEED_NEW_POSTS_POLL_MS = 25_000;
const FEED_ACTIVE_TAB_POLL_MS = 35_000;
const FEED_AUTO_APPLY_NEW_POSTS_TOP_THRESHOLD_PX = 600;
const FEED_REALTIME_STATE_FIELDS_COUNT = 20;
const FEED_CURRENT_USER_CACHE_KEY = "phew.feed.current-user";
const FEED_CURRENT_USER_CACHE_TTL_MS = 30 * 60_000;

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

function readCachedFirstFeedPage(viewerScope: string, tab: FeedTab, search: string): FeedPage | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(getFeedFirstPageCacheKey(viewerScope, tab, search));
    if (!raw) return null;

    const parsed = JSON.parse(raw) as {
      cachedAt?: number;
      page?: FeedPage;
    };

    if (
      typeof parsed?.cachedAt !== "number" ||
      !parsed.page ||
      !Array.isArray(parsed.page.items) ||
      parsed.page.items.length === 0 ||
      Date.now() - parsed.cachedAt > FEED_FIRST_PAGE_CACHE_TTL_MS
    ) {
      return null;
    }

    return parsed.page;
  } catch {
    return null;
  }
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
  const { signOut, hasLiveSession, isUsingCachedUser } = useAuth();
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
  const effectiveSearchQuery = searchQuery.trim().length >= 3 ? searchQuery.trim() : "";
  const feedViewerScope = hasLiveSession && session?.user?.id ? session.user.id : "anonymous";
  const cachedFirstPage = useMemo(
    () => readCachedFirstFeedPage(feedViewerScope, activeTab, effectiveSearchQuery),
    [activeTab, effectiveSearchQuery, feedViewerScope]
  );
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
  const isAuthWritePending = Boolean(isUsingCachedUser);

  const guardPendingAuthWrite = useCallback(() => {
    if (!isAuthWritePending) {
      return false;
    }
    toast.warning("Still finalizing sign-in. Try again in a moment.");
    return true;
  }, [isAuthWritePending]);

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
    const shouldUseCachedFirstPageFallback =
      !pageParam && !search && tab !== "following" && Boolean(cachedFirstPage?.items.length);
    let endpoint = "/api/posts";
    const params = new URLSearchParams();

    if (tab === "latest") {
      params.set("sort", "latest");
    } else if (tab === "trending") {
      params.set("sort", "trending");
    } else if (tab === "following") {
      params.set("following", "true");
    }

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

    const response = await api.raw(endpoint);
    if (!response.ok) {
      if (shouldUseCachedFirstPageFallback && cachedFirstPage) {
        return cachedFirstPage;
      }
      const json = await response.json().catch(() => null);
      throw new ApiError(
        json?.error?.message || `Request failed with status ${response.status}`,
        response.status,
        json?.error || json
      );
    }

    const json = await response.json().catch(() => null);
    if (!json || !Array.isArray((json as { data?: unknown }).data)) {
      throw new ApiError(
        "Feed payload was invalid. Please retry.",
        response.status,
        json
      );
    }
    const items = json.data as Post[];
    const nextCursor = typeof json?.nextCursor === "string" ? json.nextCursor : null;

    if (shouldUseCachedFirstPageFallback && cachedFirstPage && items.length === 0) {
      return cachedFirstPage;
    }

    return {
      items,
      nextCursor,
      hasMore: Boolean(json?.hasMore && nextCursor),
    } satisfies FeedPage;
  }, [cachedFirstPage]);

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
    fetchNextPage,
    hasNextPage,
  } = useInfiniteQuery({
    queryKey: activeFeedQueryKey,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => fetchFeedPage(activeTab, effectiveSearchQuery, pageParam),
    getNextPageParam: (lastPage) => (lastPage.hasMore ? (lastPage.nextCursor ?? undefined) : undefined),
    maxPages: FEED_MAX_PAGES,
    initialData: cachedFirstPage
      ? {
          pages: [cachedFirstPage],
          pageParams: [undefined],
        }
      : undefined,
    enabled: activeTab !== "following" || hasLiveSession,
    retry: (failureCount, error) => {
      if (error instanceof ApiError && error.status === 429) {
        return false;
      }
      return failureCount < 2;
    },
    staleTime: 60_000, // 1 minute; reduces tab-switch reloads
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    refetchOnMount: "always",
    refetchInterval: false,
  });

  const posts = useMemo(
    () => postsPages?.pages.flatMap((page) => page.items) ?? [],
    [postsPages?.pages]
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
    writeCachedFirstFeedPage(feedViewerScope, activeTab, effectiveSearchQuery, firstPage);
  }, [activeTab, effectiveSearchQuery, feedViewerScope, postsPages?.pages]);

  const updateInfinitePosts = useCallback((updater: (post: Post) => Post) => {
    queryClient.setQueryData<InfiniteData<FeedPage>>(
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
  }, [activeFeedQueryKey, queryClient]);

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
    writeCachedFirstFeedPage(feedViewerScope, "latest", "", pendingLatestFirstPage);
    setPendingLatestFirstPage(null);
    setPendingLatestCount(0);
  }, [applyFirstPageToCache, feedViewerScope, pendingLatestFirstPage]);

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
    if (!hasLiveSession) return;
    if (activeTab !== "latest") return;
    if (searchQuery.trim().length >= 3) return;
    if (!postsPages?.pages?.length) return;

    const prefetchTabs = () => {
      const tabsToPrefetch: FeedTab[] = ["trending", "following"];

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
    if (!hasLiveSession) return;
    if (activeTab !== "latest") return;
    if (effectiveSearchQuery) return;
    if (hasLiveOverlay()) return;
    if (typeof window === "undefined") return;

    let cancelled = false;

    const checkForNewPosts = async () => {
      if (cancelled) return;
      if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
      if (hasLiveOverlay()) return;

      const currentData = queryClient.getQueryData<InfiniteData<FeedPage>>(
        getFeedQueryKey("latest", "", feedViewerScope)
      );
      const currentFirstPage = currentData?.pages?.[0];
      if (!currentFirstPage || currentFirstPage.items.length === 0) return;

      try {
        const freshFirstPage = await fetchFeedPage("latest", "");
        if (cancelled || freshFirstPage.items.length === 0) return;
        if (hasLiveOverlay()) return;

        const currentTopId = currentFirstPage.items[0]?.id;
        const freshTopId = freshFirstPage.items[0]?.id;

        if (!currentTopId || !freshTopId) {
          return;
        }

        if (currentTopId === freshTopId) {
          const currentFingerprint = buildRealtimePageFingerprint(currentFirstPage);
          const freshFingerprint = buildRealtimePageFingerprint(freshFirstPage);

          if (currentFingerprint !== freshFingerprint) {
            applyFirstPageToCache("latest", "", freshFirstPage);
            writeCachedFirstFeedPage(feedViewerScope, "latest", "", freshFirstPage);
            setPendingLatestFirstPage(null);
            setPendingLatestCount(0);
            void refetchUser();
            return;
          }

          setPendingLatestFirstPage(null);
          setPendingLatestCount(0);
          return;
        }

        const currentIds = new Set(currentFirstPage.items.map((item) => item.id));
        let newCount = 0;
        for (const item of freshFirstPage.items) {
          if (currentIds.has(item.id)) break;
          newCount++;
        }
        if (newCount <= 0) {
          newCount = 1;
        }

        // If user is near the top, apply instantly for a seamless "live" feel.
        if (window.scrollY < FEED_AUTO_APPLY_NEW_POSTS_TOP_THRESHOLD_PX) {
          applyFirstPageToCache("latest", "", freshFirstPage);
          writeCachedFirstFeedPage(feedViewerScope, "latest", "", freshFirstPage);
          setPendingLatestFirstPage(null);
          setPendingLatestCount(0);
          return;
        }

        setPendingLatestFirstPage(freshFirstPage);
        setPendingLatestCount(newCount);
      } catch {
        // Silent failure; polling should never break feed UX.
      }
    };

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
    effectiveSearchQuery,
    feedViewerScope,
    fetchFeedPage,
    getFeedQueryKey,
    hasLiveOverlay,
    queryClient,
    refetchUser,
    hasLiveSession,
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
        writeCachedFirstFeedPage(feedViewerScope, activeTab, effectiveSearchQuery, freshFirstPage);
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
          writeCachedFirstFeedPage(feedViewerScope, tab, search, nextFirstPage);
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
    onError: () => {
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

  const handleSignOut = async () => {
    await signOut();
    try {
      await privyLogout();
    } catch (error) {
      console.error("[Feed] Privy logout failed:", error);
    } finally {
      navigate("/login", { replace: true });
    }
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
        writeCachedFirstFeedPage(feedViewerScope, activeTab, effectiveSearchQuery, freshFirstPage);
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

      <main className="max-w-2xl mx-auto px-4 py-6">
        {/* 1. Pinned Announcements (at very top) */}
        <AnnouncementBanner />

        {/* 2. Trending Now Section */}
        {showTrendingSection ? <TrendingSection /> : null}

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
          <div className="mb-6 p-5 bg-card border border-border rounded-xl shadow-sm">
            <div className="flex items-center gap-4">
              <Avatar className="h-16 w-16 border-2 border-primary/30 ring-2 ring-background">
                <AvatarImage src={getAvatarUrl(user.id, user.image)} />
                <AvatarFallback className="bg-muted text-muted-foreground text-xl">
                  {user.name?.charAt(0) || "?"}
                </AvatarFallback>
              </Avatar>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <h2 className="font-bold text-lg truncate">{user.username || user.name}</h2>
                  <Trophy className="h-4 w-4 text-primary" />
                </div>
                <p className="text-muted-foreground truncate text-xs font-thin">{user.email}</p>
                {/* XP Display */}
                <p className="text-primary font-medium mt-3 text-lg">
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
          <div className="mb-6 p-5 bg-card border border-destructive/30 rounded-xl">
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
          <h3 className="text-sm font-medium text-muted-foreground">
            {searchQuery.length >= 3 ? (
              `Search results for "${searchQuery}"`
            ) : (
              <>
                {activeTab === "latest" && "Latest Posts"}
                {activeTab === "trending" && "Trending Posts"}
                {activeTab === "following" && "Following"}
              </>
            )}
          </h3>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleRefresh}
            disabled={isRefreshing}
            className="h-8 px-3 gap-1.5 text-muted-foreground hover:text-foreground"
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
                className="h-9 rounded-full px-4 shadow-lg shadow-primary/20 border border-primary/30"
              >
                {pendingLatestCount > FEED_PAGE_SIZE ? `${FEED_PAGE_SIZE}+` : pendingLatestCount} new post{pendingLatestCount === 1 ? "" : "s"} • Show
              </Button>
            </div>
          ) : null}

          {shouldShowFeedSoftError ? (
            <div className="mb-3 p-3 rounded-lg border border-amber-400/25 bg-amber-400/10 text-amber-100">
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
            <div className="flex flex-col items-center justify-center py-16 gap-4 text-center">
              <div className="w-20 h-20 rounded-full bg-muted flex items-center justify-center">
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
            <div className="flex flex-col items-center justify-center py-16 gap-4 text-center">
              <div className="w-20 h-20 rounded-full bg-muted flex items-center justify-center">
                {activeTab === "trending" ? (
                  <TrendingUp className="h-10 w-10 text-muted-foreground" />
                ) : (
                  <Sparkles className="h-10 w-10 text-muted-foreground" />
                )}
              </div>
              <div>
                <p className="font-semibold text-foreground text-lg">
                  {searchQuery.length >= 3
                    ? "No results found"
                    : activeTab === "following"
                    ? "No posts from people you follow"
                    : "No alpha yet"}
                </p>
                <p className="text-sm text-muted-foreground mt-1">
                  {searchQuery.length >= 3
                    ? `Try a different search term`
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
