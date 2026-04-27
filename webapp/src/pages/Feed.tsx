import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient, type InfiniteData } from "@tanstack/react-query";
import { useNavigate, useSearchParams } from "react-router-dom";
import { AlertCircle, BrainCircuit, Flame, Radar, RefreshCw, Sparkles, type LucideIcon } from "lucide-react";
import { toast } from "sonner";
import { api, ApiError } from "@/lib/api";
import { useAuth, useSession } from "@/lib/auth-client";
import { readSessionCache, writeSessionCache } from "@/lib/session-cache";
import { applyPostPollVote } from "@/lib/post-poll";
import { cn } from "@/lib/utils";
import type { DiscoveryFeedSidebarResponse, FeedTab, Post, User } from "@/types";
import { FeedV2PostCard } from "@/components/feed/FeedV2PostCard";
import { FeedV2RightRail } from "@/components/feed/FeedV2RightRail";
import { CreatePost } from "@/components/feed/CreatePost";
import { PostCardSkeleton } from "@/components/feed/PostCardSkeleton";
import { AnnouncementBanner } from "@/components/feed/AnnouncementBanner";
import { WindowVirtualList } from "@/components/virtual/WindowVirtualList";
import { Button } from "@/components/ui/button";
import { QueryErrorBoundary } from "@/components/QueryErrorBoundary";
import { V2PageTopbar } from "@/components/layout/V2PageTopbar";

type FeedPage = {
  items: Post[];
  hasMore: boolean;
  nextCursor: string | null;
  totalPosts: number | null;
  debugCounts?: FeedDebugCounts | null;
  degraded?: boolean;
};

type FeedDebugCounts = {
  backendReturned: number;
  afterKindFilter: number;
  afterRanking: number;
  selected: number;
  alphaCandidates: number;
  selectedCallCandidates?: number;
  selectedChartPreviews?: number;
  hidden: number;
};

type FeedApiPayload = {
  items?: Post[];
  hasMore?: boolean;
  nextCursor?: string | null;
  totalPosts?: number | null;
  debugCounts?: FeedDebugCounts | null;
  degraded?: boolean;
};

const FEED_PAGE_SIZE = 10;
const FEED_MAX_PAGES = 5;
const FEED_CURRENT_USER_CACHE_KEY = "phew.feed.current-user";
const FEED_CURRENT_USER_CACHE_TTL_MS = 5 * 60_000;
const FEED_RIGHT_RAIL_DELAY_MS = import.meta.env.PROD ? 1_800 : 650;
const FEED_ANNOUNCEMENTS_DELAY_MS = import.meta.env.PROD ? 1_200 : 450;

const FEED_TAB_ITEMS: Array<{
  id: FeedTab;
  label: string;
  icon?: LucideIcon;
}> = [
  { id: "latest", label: "For You" },
  { id: "following", label: "Following" },
  { id: "hot-alpha", label: "Hot Alpha", icon: Flame },
  { id: "high-conviction", label: "Top Calls", icon: BrainCircuit },
  { id: "early-runners", label: "X Raids", icon: Radar },
];

const chartPreviewCache = new Map<string, NonNullable<NonNullable<Post["payload"]>["call"]>["chartPreview"]>();

function chartPreviewKeys(post: Post): string[] {
  const payload = post.payload;
  const token = payload?.call?.token ?? payload?.chart?.token ?? post.tokenContext ?? null;
  return [
    `post:${post.id}`,
    token?.address ? `token:${token.chain ?? "any"}:${token.address.toLowerCase()}` : null,
    token?.symbol ? `symbol:${token.symbol.toLowerCase()}` : null,
  ].filter((key): key is string => Boolean(key));
}

function isLiveChartPreview(preview: NonNullable<NonNullable<Post["payload"]>["call"]>["chartPreview"] | null | undefined): boolean {
  return Boolean(preview && preview.state === "live" && Array.isArray(preview.candles) && preview.candles.length >= 8);
}

function stabilizePostChartPreview(post: Post): Post {
  const payload = post.payload;
  const preview = payload?.call?.chartPreview ?? payload?.chart?.chartPreview ?? null;
  if (isLiveChartPreview(preview)) {
    for (const key of chartPreviewKeys(post)) chartPreviewCache.set(key, preview);
    return post;
  }
  const cached = chartPreviewKeys(post).map((key) => chartPreviewCache.get(key)).find(isLiveChartPreview);
  if (!cached || !isLiveChartPreview(cached) || !payload) return post;
  if (payload.call) {
    return { ...post, payload: { ...payload, call: { ...payload.call, chartPreview: cached } } };
  }
  if (payload.chart) {
    return { ...post, payload: { ...payload, chart: { ...payload.chart, chartPreview: cached } } };
  }
  return post;
}

function normalizeFeedResponse(data: FeedApiPayload): FeedPage {
  if (!data || !Array.isArray(data.items)) {
    throw new ApiError("Feed payload was invalid. Please retry.", 500, data);
  }
  return {
    items: data.items.map(stabilizePostChartPreview),
    hasMore: Boolean(data.hasMore && data.nextCursor),
    nextCursor: typeof data.nextCursor === "string" ? data.nextCursor : null,
    totalPosts: typeof data.totalPosts === "number" && Number.isFinite(data.totalPosts) ? data.totalPosts : null,
    debugCounts: data.debugCounts ?? null,
    degraded: data.degraded === true,
  };
}

function feedQueryKey(tab: FeedTab, search: string, viewerScope: string) {
  return ["feed", tab, search, viewerScope] as const;
}

function updatePostInPages(
  queryClient: ReturnType<typeof useQueryClient>,
  queryKey: ReturnType<typeof feedQueryKey>,
  updater: (post: Post) => Post
) {
  queryClient.setQueryData<InfiniteData<FeedPage>>(queryKey, (oldData) => {
    if (!oldData) return oldData;
    return {
      ...oldData,
      pages: oldData.pages.map((page) => ({
        ...page,
        items: page.items.map(updater),
      })),
    };
  });
}

function isWriteAuthError(error: unknown): boolean {
  return error instanceof ApiError && (error.status === 401 || error.status === 403);
}

function FeedError({ error, onRetry }: { error: Error; onRetry: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center gap-4 py-16 text-center">
      <div className="flex h-20 w-20 items-center justify-center rounded-full bg-destructive/10">
        <AlertCircle className="h-10 w-10 text-destructive" />
      </div>
      <div>
        <p className="text-lg font-semibold text-foreground">Failed to load feed</p>
        <p className="mt-1 max-w-xs text-sm text-muted-foreground">{error.message || "Please retry."}</p>
      </div>
      <Button onClick={onRetry} variant="outline" className="mt-2">
        <RefreshCw className="mr-2 h-4 w-4" />
        Try Again
      </Button>
    </div>
  );
}

export default function Feed() {
  const { data: session } = useSession();
  const { signOut, hasLiveSession, canPerformAuthenticatedWrites, isUsingCachedUser } = useAuth();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [activeTab, setActiveTab] = useState<FeedTab>("latest");
  const [searchQuery, setSearchQuery] = useState(searchParams.get("search") || "");
  const [isManualRefreshing, setIsManualRefreshing] = useState(false);
  const [rightRailReady, setRightRailReady] = useState(false);
  const [announcementsReady, setAnnouncementsReady] = useState(false);
  const loadMoreRef = useRef<HTMLDivElement>(null);

  const requestedComposerMode = useMemo(() => {
    const value = searchParams.get("compose");
    return value === "alpha" ||
      value === "discussion" ||
      value === "chart" ||
      value === "poll" ||
      value === "raid" ||
      value === "news"
      ? value
      : null;
  }, [searchParams]);

  const effectiveSearchQuery = searchQuery.trim().length >= 3 ? searchQuery.trim() : "";
  const viewerScope = session?.user?.id ?? "anonymous";
  const activeFeedQueryKey = useMemo(
    () => feedQueryKey(activeTab, effectiveSearchQuery, viewerScope),
    [activeTab, effectiveSearchQuery, viewerScope]
  );

  const feedCurrentUserCacheKey = session?.user?.id ? `${FEED_CURRENT_USER_CACHE_KEY}:${session.user.id}` : null;
  const cachedFeedUser = feedCurrentUserCacheKey
    ? readSessionCache<User>(feedCurrentUserCacheKey, FEED_CURRENT_USER_CACHE_TTL_MS)
    : null;
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
      tradeFeeRewardsEnabled: session.user.tradeFeeRewardsEnabled ?? cachedFeedUser?.tradeFeeRewardsEnabled,
      tradeFeeShareBps: session.user.tradeFeeShareBps ?? cachedFeedUser?.tradeFeeShareBps,
      tradeFeePayoutAddress: session.user.tradeFeePayoutAddress ?? cachedFeedUser?.tradeFeePayoutAddress ?? null,
      createdAt: session.user.createdAt ?? cachedFeedUser?.createdAt ?? new Date(0).toISOString(),
    };
  }, [cachedFeedUser, session?.user]);

  const {
    data: user,
    error: userError,
    refetch: refetchUser,
  } = useQuery({
    queryKey: ["currentUser", session?.user?.id ?? "anonymous"],
    queryFn: async () => {
      try {
        return await api.get<User>("/api/me");
      } catch (error) {
        if (sessionBackedUser && error instanceof ApiError && error.status !== 401 && error.status !== 403) {
          return sessionBackedUser;
        }
        if (sessionBackedUser && !(error instanceof ApiError)) {
          return sessionBackedUser;
        }
        throw error;
      }
    },
    initialData: sessionBackedUser ?? undefined,
    enabled: hasLiveSession,
    staleTime: 5 * 60_000,
    gcTime: 15 * 60_000,
    retry: 1,
    refetchOnWindowFocus: false,
  });

  useEffect(() => {
    if (feedCurrentUserCacheKey && user) {
      writeSessionCache(feedCurrentUserCacheKey, user);
    }
  }, [feedCurrentUserCacheKey, user]);

  const fetchFeedPage = useCallback(
    async (pageParam?: string): Promise<FeedPage> => {
      let endpoint = `/api/feed/${activeTab}`;
      const params = new URLSearchParams();
      params.set("limit", String(FEED_PAGE_SIZE));
      if (effectiveSearchQuery) params.set("search", effectiveSearchQuery);
      if (pageParam) params.set("cursor", pageParam);
      endpoint += `?${params.toString()}`;
      return normalizeFeedResponse(await api.get<FeedApiPayload>(endpoint, { cache: "no-store" }));
    },
    [activeTab, effectiveSearchQuery]
  );

  const {
    data: postsPages,
    isLoading: isLoadingPosts,
    isFetched: isPostsFetched,
    error: postsError,
    refetch: refetchPosts,
    isFetching,
    isFetchingNextPage,
    fetchNextPage,
    hasNextPage,
  } = useInfiniteQuery({
    queryKey: activeFeedQueryKey,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => fetchFeedPage(pageParam),
    getNextPageParam: (lastPage) => (lastPage.hasMore ? lastPage.nextCursor ?? undefined : undefined),
    maxPages: FEED_MAX_PAGES,
    enabled: activeTab !== "following" || hasLiveSession,
    placeholderData: (previousData) => previousData,
    staleTime: 30_000,
    gcTime: 5 * 60_000,
    retry: (failureCount, error) => {
      if (error instanceof ApiError && (error.status === 401 || error.status === 403 || error.status === 429)) {
        return false;
      }
      return failureCount < 2;
    },
    refetchOnWindowFocus: false,
  });

  const displayedPosts = useMemo(() => postsPages?.pages.flatMap((page) => page.items) ?? [], [postsPages?.pages]);
  const hasPosts = displayedPosts.length > 0;
  const hasInitialFeedResult = isPostsFetched || Boolean(postsError);
  const firstPageDebugCounts = postsPages?.pages[0]?.debugCounts ?? null;
  const showFeedDiagnostics = Boolean(import.meta.env.DEV || user?.isAdmin);
  const isAuthWritePending = Boolean(session?.user) && !canPerformAuthenticatedWrites;

  useEffect(() => {
    if (!hasInitialFeedResult) return;
    const railTimer = window.setTimeout(() => setRightRailReady(true), FEED_RIGHT_RAIL_DELAY_MS);
    const announcementTimer = window.setTimeout(() => setAnnouncementsReady(true), FEED_ANNOUNCEMENTS_DELAY_MS);
    return () => {
      window.clearTimeout(railTimer);
      window.clearTimeout(announcementTimer);
    };
  }, [hasInitialFeedResult]);

  useEffect(() => {
    if (!hasNextPage || isFetchingNextPage) return;
    const node = loadMoreRef.current;
    if (!node || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry?.isIntersecting) {
        void fetchNextPage();
      }
    }, { rootMargin: "900px" });
    observer.observe(node);
    return () => observer.disconnect();
  }, [fetchNextPage, hasNextPage, isFetchingNextPage]);

  const guardPendingAuthWrite = useCallback(() => {
    if (!session?.user) {
      toast.info("Sign in to interact with posts.");
      return true;
    }
    if (!isAuthWritePending) return false;
    toast.warning("Signing you in...");
    return true;
  }, [isAuthWritePending, session?.user]);

  const handleWriteSessionExpired = useCallback(async () => {
    toast.error("Session expired. Please sign in again.");
    await signOut();
    navigate("/login", { replace: true });
  }, [navigate, signOut]);

  const createPostMutation = useMutation({
    mutationFn: async ({ content, postType, pollOptions }: { content: string; postType: NonNullable<Post["postType"]>; pollOptions?: string[] }) => {
      await api.post<Post>("/api/posts", { content, postType, pollOptions });
    },
    onSuccess: async () => {
      toast.success("Post published");
      await queryClient.invalidateQueries({ queryKey: ["feed"] });
      await refetchPosts();
      void refetchUser();
    },
    onError: (error) => {
      if (isWriteAuthError(error)) {
        void handleWriteSessionExpired();
        return;
      }
      toast.error(error instanceof ApiError ? error.message : "Failed to post");
    },
  });

  const likeMutation = useMutation({
    mutationFn: async ({ postId, isLiked }: { postId: string; isLiked: boolean }) => {
      if (isLiked) await api.delete(`/api/posts/${postId}/like`);
      else await api.post(`/api/posts/${postId}/like`);
      return { postId, isLiked };
    },
    onMutate: ({ postId, isLiked }) => {
      updatePostInPages(queryClient, activeFeedQueryKey, (post) =>
        post.id === postId
          ? {
              ...post,
              isLiked: !isLiked,
              _count: { ...post._count, likes: Math.max(0, post._count.likes + (isLiked ? -1 : 1)) },
            }
          : post
      );
    },
    onError: (error) => {
      void queryClient.invalidateQueries({ queryKey: activeFeedQueryKey });
      if (isWriteAuthError(error)) void handleWriteSessionExpired();
    },
  });

  const repostMutation = useMutation({
    mutationFn: async ({ postId, isReposted }: { postId: string; isReposted: boolean }) => {
      if (isReposted) await api.delete(`/api/posts/${postId}/repost`);
      else await api.post(`/api/posts/${postId}/repost`);
      return { postId, isReposted };
    },
    onMutate: ({ postId, isReposted }) => {
      updatePostInPages(queryClient, activeFeedQueryKey, (post) =>
        post.id === postId
          ? {
              ...post,
              isReposted: !isReposted,
              _count: { ...post._count, reposts: Math.max(0, post._count.reposts + (isReposted ? -1 : 1)) },
            }
          : post
      );
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["feed"] });
      void queryClient.invalidateQueries({ queryKey: ["profile", "reposts"] });
    },
    onError: (error) => {
      void queryClient.invalidateQueries({ queryKey: activeFeedQueryKey });
      if (isWriteAuthError(error)) void handleWriteSessionExpired();
    },
  });

  const pollVoteMutation = useMutation({
    mutationFn: async ({ postId, optionId }: { postId: string; optionId: string }) => {
      const poll = await api.post<NonNullable<Post["poll"]>>(`/api/posts/${postId}/poll-vote`, { optionId });
      return { postId, poll };
    },
    onMutate: ({ postId, optionId }) => {
      updatePostInPages(queryClient, activeFeedQueryKey, (post) => (post.id === postId ? applyPostPollVote(post, optionId) : post));
    },
    onSuccess: ({ postId, poll }) => {
      updatePostInPages(queryClient, activeFeedQueryKey, (post) =>
        post.id === postId
          ? {
              ...post,
              poll,
              payload: post.payload ? { ...post.payload, poll } : post.payload,
            }
          : post
      );
    },
    onError: (error) => {
      void queryClient.invalidateQueries({ queryKey: activeFeedQueryKey });
      if (isWriteAuthError(error)) {
        void handleWriteSessionExpired();
        return;
      }
      toast.error(error instanceof ApiError ? error.message : "Failed to vote");
    },
  });

  const handleCreatePost = async (content: string, postType: NonNullable<Post["postType"]>, options?: { pollOptions?: string[] }) => {
    if (guardPendingAuthWrite()) return;
    await createPostMutation.mutateAsync({ content, postType, pollOptions: options?.pollOptions });
  };

  const handleLike = async (postId: string) => {
    if (guardPendingAuthWrite()) return;
    const post = displayedPosts.find((item) => item.id === postId);
    if (post) likeMutation.mutate({ postId, isLiked: post.isLiked });
  };

  const handleRepost = async (postId: string) => {
    if (guardPendingAuthWrite()) return;
    const post = displayedPosts.find((item) => item.id === postId);
    if (post) repostMutation.mutate({ postId, isReposted: post.isReposted });
  };

  const handlePollVote = async (postId: string, optionId: string) => {
    if (guardPendingAuthWrite()) return;
    await pollVoteMutation.mutateAsync({ postId, optionId });
  };

  const handleSearchChange = useCallback((value: string) => {
    setSearchQuery(value);
    if (value) setSearchParams({ search: value });
    else setSearchParams({});
  }, [setSearchParams]);

  const handleRefresh = async () => {
    setIsManualRefreshing(true);
    try {
      await queryClient.invalidateQueries({ queryKey: activeFeedQueryKey });
      await refetchPosts();
    } finally {
      setIsManualRefreshing(false);
    }
  };

  const { data: discoverySidebar } = useQuery({
    queryKey: ["discovery", "feed-sidebar"],
    queryFn: () => api.get<DiscoveryFeedSidebarResponse>("/api/discovery/feed-sidebar"),
    enabled: rightRailReady,
    staleTime: 45_000,
    refetchOnWindowFocus: false,
    refetchInterval: 90_000,
  });

  const shouldShowFollowingSessionRecovery = activeTab === "following" && isUsingCachedUser;
  const shouldShowFollowingAuthState = activeTab === "following" && !hasLiveSession && !shouldShowFollowingSessionRecovery;
  const shouldShowFeedFatalError = Boolean(postsError && !hasPosts && !shouldShowFollowingAuthState && !shouldShowFollowingSessionRecovery);
  const shouldShowFeedSoftError = Boolean(postsError && hasPosts);
  const isRefreshing = isManualRefreshing || (isFetching && !isFetchingNextPage);

  return (
    <div className="space-y-3">
      <main className="grid gap-3 xl:grid-cols-[minmax(720px,1fr)_344px]">
        <div className="space-y-3">
          <section className="relative overflow-hidden px-1 py-1">
            <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <h1 className="text-[22px] font-semibold tracking-tight text-white">FEED</h1>
                <p className="mt-0.5 text-[12px] leading-5 text-white/50">
                  Real-time alpha from the smartest traders on the internet.
                </p>
              </div>
              <V2PageTopbar
                value={searchQuery}
                onChange={handleSearchChange}
                placeholder="Search token, user, or wallet..."
                className="lg:min-w-[400px]"
              />
            </div>
          </section>

          <CreatePost
            user={user ?? null}
            onSubmit={handleCreatePost}
            isSubmitting={createPostMutation.isPending}
            isAuthPending={isAuthWritePending}
            initialMode={requestedComposerMode}
          />

          <section className="rounded-[13px] border border-white/8 bg-[linear-gradient(180deg,rgba(8,12,18,0.92),rgba(6,10,15,0.96))] px-2.5 py-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
            <div className="flex flex-wrap items-center gap-2">
              {FEED_TAB_ITEMS.map((tab) => {
                const Icon = tab.icon;
                const active = tab.id === activeTab;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setActiveTab(tab.id)}
                    className={cn(
                      "relative inline-flex h-8 items-center gap-1.5 rounded-[9px] px-3 text-[13px] font-semibold transition-all",
                      active
                        ? "bg-lime-300/[0.08] text-lime-200 after:absolute after:inset-x-2 after:-bottom-2 after:h-0.5 after:rounded-full after:bg-lime-300"
                        : "text-white/54 hover:bg-white/[0.045] hover:text-white/84"
                    )}
                  >
                    {Icon ? <Icon className={cn("h-4 w-4", active ? "text-lime-200" : "text-white/40")} /> : null}
                    <span>{tab.label}</span>
                  </button>
                );
              })}
              <button
                type="button"
                onClick={() => void handleRefresh()}
                className="ml-auto inline-flex h-8 items-center rounded-[9px] border border-white/8 bg-white/[0.025] px-3 text-xs font-semibold text-white/46 hover:bg-white/[0.055] hover:text-white/78"
              >
                {isRefreshing ? "Refreshing" : "Refresh"}
              </button>
            </div>
          </section>

          <section className="space-y-3">
            <QueryErrorBoundary sectionName="Announcements">
              <AnnouncementBanner enabled={announcementsReady} />
            </QueryErrorBoundary>
          </section>

          {userError ? (
            <div className="rounded-[18px] border border-destructive/30 bg-destructive/10 p-4">
              <div className="flex items-center gap-3 text-destructive">
                <AlertCircle className="h-5 w-5" />
                <span className="text-sm">Failed to load profile</span>
                <Button variant="ghost" size="sm" onClick={() => void refetchUser()} className="ml-auto">
                  Retry
                </Button>
              </div>
            </div>
          ) : null}

          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-white/34">
                  {effectiveSearchQuery ? "Search mode" : activeTab === "latest" ? "For you" : activeTab.replace("-", " ")}
                </div>
                <div className="mt-1 text-sm text-white/56">
                  {effectiveSearchQuery ? `Results for "${effectiveSearchQuery}"` : "Signals prioritized by conviction, momentum, and trader reputation."}
                </div>
              </div>
              <div className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs text-white/50">
                {displayedPosts.length} visible
                {showFeedDiagnostics && firstPageDebugCounts ? (
                  <span className="ml-2 text-white/30">
                    / {firstPageDebugCounts.backendReturned} scanned
                  </span>
                ) : null}
              </div>
            </div>

            {shouldShowFeedSoftError ? (
              <div className="rounded-[14px] border border-amber-400/25 bg-amber-400/10 p-3 text-amber-100">
                <div className="flex items-center gap-2">
                  <AlertCircle className="h-4 w-4" />
                  <span className="text-xs sm:text-sm">Live refresh is delayed. Existing feed items stay visible.</span>
                  <Button variant="ghost" size="sm" onClick={() => void refetchPosts()} className="ml-auto h-7 px-2 text-xs">
                    Retry
                  </Button>
                </div>
              </div>
            ) : null}

            {isLoadingPosts && !hasPosts ? (
              <>
                {[0, 1, 2].map((index) => (
                  <PostCardSkeleton
                    key={index}
                    showMarketData={index < 2}
                    className="animate-fade-in-up"
                    style={{ animationDelay: `${index * 0.1}s` }}
                  />
                ))}
              </>
            ) : shouldShowFollowingSessionRecovery ? (
              <div className="app-empty-state">
                <RefreshCw className="h-10 w-10 animate-spin text-muted-foreground" />
                <div>
                  <p className="text-lg font-semibold text-foreground">Loading Following</p>
                  <p className="mt-1 text-sm text-muted-foreground">Finalizing your session and loading followed traders.</p>
                </div>
              </div>
            ) : shouldShowFollowingAuthState ? (
              <div className="app-empty-state">
                <Sparkles className="h-10 w-10 text-muted-foreground" />
                <div>
                  <p className="text-lg font-semibold text-foreground">Sign in to see Following</p>
                  <p className="mt-1 text-sm text-muted-foreground">Follow traders and their calls will appear here.</p>
                </div>
              </div>
            ) : shouldShowFeedFatalError ? (
              <FeedError error={postsError as Error} onRetry={() => void refetchPosts()} />
            ) : displayedPosts.length === 0 ? (
              <div className="app-empty-state">
                {activeTab === "hot-alpha" ? (
                  <Flame className="h-10 w-10 text-muted-foreground" />
                ) : activeTab === "early-runners" ? (
                  <Radar className="h-10 w-10 text-muted-foreground" />
                ) : activeTab === "high-conviction" ? (
                  <BrainCircuit className="h-10 w-10 text-muted-foreground" />
                ) : (
                  <Sparkles className="h-10 w-10 text-muted-foreground" />
                )}
                <div>
                  <p className="text-lg font-semibold text-foreground">
                    {effectiveSearchQuery
                      ? "No results found"
                      : activeTab === "following"
                        ? "No posts from people you follow"
                        : "No feed items yet"}
                  </p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {effectiveSearchQuery ? "Try a different search term." : "The alpha stream is waiting for ranked feed items."}
                  </p>
                </div>
              </div>
            ) : (
              <>
                <WindowVirtualList
                  items={displayedPosts}
                  getItemKey={(post) => post.id}
                  estimateItemHeight={420}
                  overscanPx={1000}
                  renderItem={(post, index) => (
                    <div className={index < displayedPosts.length - 1 ? "pb-3" : undefined}>
                      <div className="animate-fade-in-up" style={{ animationDelay: `${Math.min(index, 8) * 0.05}s` }}>
                        <FeedV2PostCard
                          post={post}
                          currentUserId={user?.id}
                          onLike={handleLike}
                          onRepost={handleRepost}
                          onPollVote={handlePollVote}
                        />
                      </div>
                    </div>
                  )}
                />

                {hasNextPage ? (
                  <div className="pt-2">
                    <div ref={loadMoreRef} className="h-1 w-full" aria-hidden="true" />
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
                        <Button variant="outline" size="sm" onClick={() => void fetchNextPage()} className="px-4">
                          Show more
                        </Button>
                      )}
                    </div>
                  </div>
                ) : null}
              </>
            )}
          </section>
        </div>

        <FeedV2RightRail
          discovery={discoverySidebar}
          onFilterFeed={handleSearchChange}
          onSelectTab={setActiveTab}
        />
      </main>
    </div>
  );
}
