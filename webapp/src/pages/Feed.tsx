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
import { stabilizePostChartPreview } from "@/lib/feed-chart-cache";
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
};

type FeedApiPayload = {
  items?: Post[];
  hasMore?: boolean;
  nextCursor?: string | null;
  totalPosts?: number | null;
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

const FEED_TAB_IDS = new Set<FeedTab>(FEED_TAB_ITEMS.map((item) => item.id));

function parseFeedTab(value: string | null): FeedTab {
  return value && FEED_TAB_IDS.has(value as FeedTab) ? (value as FeedTab) : "latest";
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
  };
}

function feedQueryKey(tab: FeedTab, search: string, viewerScope: string) {
  return ["feed", tab, search, viewerScope] as const;
}

function updatePostInAllFeedPages(
  queryClient: ReturnType<typeof useQueryClient>,
  updater: (post: Post) => Post
) {
  for (const [queryKey] of queryClient.getQueriesData<InfiniteData<FeedPage>>({ queryKey: ["feed"] })) {
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
        <p className="text-lg font-semibold text-foreground">Feed refresh needs retry</p>
        <p className="mt-1 max-w-xs text-sm text-muted-foreground">{error.message || "Try again."}</p>
      </div>
      <Button onClick={onRetry} variant="outline" className="mt-2">
        <RefreshCw className="mr-2 h-4 w-4" />
        Try Again
      </Button>
    </div>
  );
}

function TabFeedSkeleton() {
  return (
    <div className="rounded-[16px] border border-white/8 bg-white/[0.025] p-3">
      <div className="flex items-center gap-3">
        <div className="h-9 w-9 rounded-full bg-white/[0.07]" />
        <div className="min-w-0 flex-1 space-y-2">
          <div className="h-3 w-40 max-w-full rounded-full bg-white/[0.08]" />
          <div className="h-3 w-64 max-w-full rounded-full bg-white/[0.045]" />
        </div>
        <div className="h-7 w-24 rounded-[9px] bg-lime-300/[0.08]" />
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-4">
        {[0, 1, 2, 3].map((index) => (
          <div key={index} className="h-14 rounded-[12px] border border-white/7 bg-black/20" />
        ))}
      </div>
    </div>
  );
}

export default function Feed() {
  const { data: session } = useSession();
  const { signOut, hasLiveSession, canPerformAuthenticatedWrites, isUsingCachedUser } = useAuth();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [activeTab, setActiveTab] = useState<FeedTab>(() => parseFeedTab(searchParams.get("tab")));
  const [searchQuery, setSearchQuery] = useState(searchParams.get("search") || "");
  const [isManualRefreshing, setIsManualRefreshing] = useState(false);
  const [rightRailReady, setRightRailReady] = useState(false);
  const [announcementsReady, setAnnouncementsReady] = useState(false);
  const loadMoreRef = useRef<HTMLDivElement>(null);
  const whaleSeedAttemptedRef = useRef(false);

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

  useEffect(() => {
    const requestedTab = parseFeedTab(searchParams.get("tab"));
    if (requestedTab !== activeTab) setActiveTab(requestedTab);
  }, [activeTab, searchParams]);

  const fetchFeedPage = useCallback(
    async (args: { tab: FeedTab; search: string; pageParam?: string }): Promise<FeedPage> => {
      let endpoint = `/api/feed/${args.tab}`;
      const params = new URLSearchParams();
      params.set("limit", String(FEED_PAGE_SIZE));
      if (args.search) params.set("search", args.search);
      if (args.pageParam) params.set("cursor", args.pageParam);
      endpoint += `?${params.toString()}`;
      return normalizeFeedResponse(await api.get<FeedApiPayload>(endpoint, { cache: "no-store" }));
    },
    []
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
    queryFn: ({ pageParam, queryKey }) => {
      const [, tab, search] = queryKey as ReturnType<typeof feedQueryKey>;
      return fetchFeedPage({ tab, search, pageParam });
    },
    getNextPageParam: (lastPage) => (lastPage.hasMore ? lastPage.nextCursor ?? undefined : undefined),
    maxPages: FEED_MAX_PAGES,
    enabled: activeTab !== "following" || hasLiveSession,
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
  const isAuthWritePending = Boolean(session?.user) && !canPerformAuthenticatedWrites;

  useEffect(() => {
    if (!isPostsFetched || effectiveSearchQuery) return;
    const tabOrder = FEED_TAB_ITEMS.map((item) => item.id);
    const activeIndex = tabOrder.indexOf(activeTab);
    const neighborTabs = activeTab === "latest"
      ? (["hot-alpha"] as FeedTab[])
      : [tabOrder[activeIndex - 1], tabOrder[activeIndex + 1]].filter((tab): tab is FeedTab => Boolean(tab));

    for (const tab of neighborTabs) {
      if (tab === activeTab) continue;
      if (tab === "following") continue;
      const queryKey = feedQueryKey(tab, "", viewerScope);
      if (queryClient.getQueryData(queryKey)) continue;
      void queryClient.prefetchInfiniteQuery({
        queryKey,
        initialPageParam: undefined as string | undefined,
        queryFn: ({ pageParam }) => fetchFeedPage({ tab, search: "", pageParam }),
        getNextPageParam: (lastPage) => (lastPage.hasMore ? lastPage.nextCursor ?? undefined : undefined),
        pages: 1,
        staleTime: 30_000,
      });
    }
  }, [activeTab, effectiveSearchQuery, fetchFeedPage, hasLiveSession, isPostsFetched, queryClient, viewerScope]);

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
      updatePostInAllFeedPages(queryClient, (post) =>
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
      updatePostInAllFeedPages(queryClient, (post) =>
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
      updatePostInAllFeedPages(queryClient, (post) => (post.id === postId ? applyPostPollVote(post, optionId) : post));
    },
    onSuccess: ({ postId, poll }) => {
      updatePostInAllFeedPages(queryClient, (post) =>
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

  const handleTabSelect = useCallback((tab: FeedTab) => {
    setActiveTab(tab);
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      if (tab === "latest") next.delete("tab");
      else next.set("tab", tab);
      return next;
    });
  }, [setSearchParams]);

  const handleSearchChange = useCallback((value: string) => {
    setSearchQuery(value);
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      if (value) next.set("search", value);
      else next.delete("search");
      return next;
    });
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

  const { data: discoverySidebar, refetch: refetchDiscoverySidebar } = useQuery({
    queryKey: ["discovery", "feed-sidebar"],
    queryFn: () => api.get<DiscoveryFeedSidebarResponse>("/api/discovery/feed-sidebar"),
    enabled: rightRailReady,
    staleTime: 45_000,
    refetchOnWindowFocus: false,
    refetchInterval: 90_000,
  });

  useEffect(() => {
    const canSeedWhale = Boolean(import.meta.env.DEV || user?.isAdmin);
    const hasWhaleRows = (discoverySidebar?.whaleActivity?.length ?? 0) > 0;
    if (!rightRailReady || !canSeedWhale || hasWhaleRows || whaleSeedAttemptedRef.current) return;
    const sessionKey = "phew.feed.whale-seed-attempted";
    if (window.sessionStorage.getItem(sessionKey) === "1") return;
    whaleSeedAttemptedRef.current = true;
    window.sessionStorage.setItem(sessionKey, "1");
    void api.post<{ ingested: number; skipped: number; txHash: string; source: string }>("/api/webhooks/test/whale", {
      chainType: "solana",
      tokenAddress: "So11111111111111111111111111111111111111112",
      tokenSymbol: "SOL",
      tokenName: "Solana",
      wallet: "7YttLkHDoUi4YdE4Qz7N5zG6UygGvQx1Test",
      amount: 12420,
      valueUsd: 250000,
      direction: "verified test accumulation",
      eventType: "whale_accumulation",
      transactionType: "verified_test_whale_event",
      txHash: `feed-dev-whale-${Date.now()}`,
    }).then(() => {
      void refetchDiscoverySidebar();
      void queryClient.invalidateQueries({ queryKey: ["feed"] });
    }).catch(() => undefined);
  }, [discoverySidebar?.whaleActivity?.length, queryClient, refetchDiscoverySidebar, rightRailReady, user?.isAdmin]);

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
                    onClick={() => handleTabSelect(tab.id)}
                    className={cn(
                      "relative inline-flex h-8 items-center gap-1.5 rounded-[9px] px-3 text-[13px] font-semibold transition-all duration-150",
                      active
                        ? "scale-[1.01] bg-lime-300/[0.10] text-lime-200 shadow-[0_10px_28px_-24px_rgba(169,255,52,0.9)] after:absolute after:inset-x-2 after:-bottom-2 after:h-0.5 after:rounded-full after:bg-lime-300"
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
                <span className="text-sm">Profile sync needs retry</span>
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
              <TabFeedSkeleton />
            ) : shouldShowFollowingSessionRecovery ? (
              <div className="app-empty-state">
                <RefreshCw className="h-10 w-10 animate-spin text-muted-foreground" />
                <div>
                  <p className="text-lg font-semibold text-foreground">Following stream preparing</p>
                  <p className="mt-1 text-sm text-muted-foreground">Finalizing your session and followed traders.</p>
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
                      ? "Search is narrowing"
                      : activeTab === "following"
                        ? "No followed calls right now"
                        : "No ranked alpha yet"}
                  </p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {effectiveSearchQuery ? "Try a different search term." : "The feed will fill as alpha, charts, raids, or news are posted."}
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
                            Refreshing more signals...
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
          onSelectTab={handleTabSelect}
        />
      </main>
    </div>
  );
}
