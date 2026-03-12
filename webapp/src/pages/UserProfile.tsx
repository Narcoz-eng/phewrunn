import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import {
  useQuery,
  useMutation,
  useQueryClient,
  type InfiniteData,
  type QueryClient,
} from "@tanstack/react-query";
import { useSession } from "@/lib/auth-client";
import { api, ApiError } from "@/lib/api";
import { Post, calculatePercentChange, getAvatarUrl, LIQUIDATION_LEVEL } from "@/types";
import { LevelBadge } from "@/components/feed/LevelBar";
import { getLevelLabel, isInDangerZone, getDangerMessage } from "@/lib/level-utils";
import { PostCard } from "@/components/feed/PostCard";
import { PostCardSkeleton } from "@/components/feed/PostCardSkeleton";
import { ProfileDashboard, UserStats, RecentTrade } from "@/components/profile/ProfileDashboard";
import { TraderIntelligenceCard } from "@/components/profile/TraderIntelligenceCard";
import { WindowVirtualList } from "@/components/virtual/WindowVirtualList";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  ArrowLeft,
  Calendar,
  TrendingUp,
  TrendingDown,
  UserMinus,
  Loader2,
  Sparkles,
  AlertCircle,
  Repeat2,
  AlertTriangle,
  Skull,
} from "lucide-react";
import { VerifiedBadge } from "@/components/VerifiedBadge";
import { ReportDialog } from "@/components/reporting/ReportDialog";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { readSessionCache, writeSessionCache } from "@/lib/session-cache";
import { PhewFollowIcon, PhewRepostIcon } from "@/components/icons/PhewIcons";

interface UserProfileData {
  id?: string | null;
  name?: string | null;
  image: string | null;
  username: string | null;
  level: number;
  xp: number;
  isVerified?: boolean;
  createdAt: string;
  isFollowing?: boolean;
  stats: {
    posts: number;
    followers: number;
    following: number;
    totalCalls: number;
    wins: number;
    losses: number;
    winRate: number;
    totalProfitPercent: number;
  };
}

type PostFilter = "all" | "wins" | "losses";
type MainTab = "posts" | "reposts";
type FollowMutationResponse = { following: boolean; followerCount: number };
const USER_PROFILE_CACHE_TTL_MS = 60_000;
const USER_PROFILE_POSTS_CACHE_TTL_MS = 45_000;
type CachedFeedPage = {
  items: Post[];
  nextCursor: string | null;
  hasMore: boolean;
};

function collectCachedFeedPosts(queryClient: QueryClient): Post[] {
  const queryEntries = queryClient.getQueriesData<InfiniteData<CachedFeedPage>>({
    queryKey: ["posts"],
  });
  const seenIds = new Set<string>();
  const posts: Post[] = [];

  for (const [, data] of queryEntries) {
    for (const page of data?.pages ?? []) {
      for (const post of page.items ?? []) {
        if (!post?.id || seenIds.has(post.id)) continue;
        seenIds.add(post.id);
        posts.push(post);
      }
    }
  }

  posts.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  return posts;
}

function getCachedFeedPostsForProfile(queryClient: QueryClient, identifier: string | undefined): Post[] {
  if (!identifier) return [];
  const normalizedIdentifier = identifier.trim().toLowerCase();
  return collectCachedFeedPosts(queryClient).filter((post) => {
    const username = post.author.username?.trim().toLowerCase();
    return (
      post.authorId === identifier ||
      post.author.id === identifier ||
      username === normalizedIdentifier
    );
  });
}

function buildUserProfileFallbackFromFeed(
  queryClient: QueryClient,
  identifier: string | undefined
): UserProfileData | null {
  const matchingPosts = getCachedFeedPostsForProfile(queryClient, identifier);
  const latestPost = matchingPosts[0];
  if (!latestPost) {
    return null;
  }

  const settledPosts = matchingPosts.filter(
    (post) => post.settled && post.isWin !== null && post.entryMcap !== null && post.currentMcap !== null
  );
  const wins = settledPosts.filter((post) => post.isWin === true).length;
  const losses = settledPosts.filter((post) => post.isWin === false).length;
  const totalCalls = settledPosts.length;
  const totalProfitPercent = settledPosts.reduce((sum, post) => {
    if (!post.entryMcap || !post.currentMcap) return sum;
    return sum + ((post.currentMcap - post.entryMcap) / post.entryMcap) * 100;
  }, 0);

  return {
    id: latestPost.author.id,
    name: latestPost.author.name,
    image: latestPost.author.image ?? null,
    username: latestPost.author.username ?? null,
    level: latestPost.author.level ?? 0,
    xp: latestPost.author.xp ?? 0,
    isVerified: latestPost.author.isVerified,
    createdAt: latestPost.createdAt,
    isFollowing: Boolean(latestPost.isFollowingAuthor),
    stats: {
      posts: matchingPosts.length,
      followers: 0,
      following: 0,
      totalCalls,
      wins,
      losses,
      winRate: totalCalls > 0 ? Math.round((wins / totalCalls) * 100) : 0,
      totalProfitPercent: Math.round(totalProfitPercent * 100) / 100,
    },
  };
}

export default function UserProfile() {
  const navigate = useNavigate();
  const location = useLocation();
  const { userId } = useParams<{ userId: string }>();
  const { data: session, hasLiveSession, canPerformAuthenticatedWrites } = useSession();
  const queryClient = useQueryClient();
  const [mainTab, setMainTab] = useState<MainTab>("posts");
  const [postFilter, setPostFilter] = useState<PostFilter>("all");
  const viewerCacheScope = session?.user?.id ?? "anonymous";
  const userProfileQueryKey = useMemo(
    () => ["userProfile", userId, viewerCacheScope] as const,
    [userId, viewerCacheScope]
  );
  const userPostsQueryKey = useMemo(
    () => ["userPosts", userId, viewerCacheScope] as const,
    [userId, viewerCacheScope]
  );
  const userRepostsQueryKey = useMemo(
    () => ["userReposts", userId, viewerCacheScope] as const,
    [userId, viewerCacheScope]
  );
  const userProfileCacheKey = useMemo(
    () => (userId ? `phew.user-profile:v2:${viewerCacheScope}:${userId}` : null),
    [userId, viewerCacheScope]
  );
  const userPostsCacheKey = useMemo(
    () => (userId ? `phew.user-posts:${viewerCacheScope}:${userId}` : null),
    [userId, viewerCacheScope]
  );
  const userRepostsCacheKey = useMemo(
    () => (userId ? `phew.user-reposts:${viewerCacheScope}:${userId}` : null),
    [userId, viewerCacheScope]
  );
  const cachedUserProfile = useMemo(
    () =>
      userProfileCacheKey
        ? readSessionCache<UserProfileData>(userProfileCacheKey, USER_PROFILE_CACHE_TTL_MS)
        : null,
    [userProfileCacheKey]
  );
  const cachedUserPosts = useMemo(
    () =>
      userPostsCacheKey
        ? readSessionCache<Post[]>(userPostsCacheKey, USER_PROFILE_POSTS_CACHE_TTL_MS)
        : null,
    [userPostsCacheKey]
  );
  const cachedUserReposts = useMemo(
    () =>
      userRepostsCacheKey
        ? readSessionCache<Post[]>(userRepostsCacheKey, USER_PROFILE_POSTS_CACHE_TTL_MS)
        : null,
    [userRepostsCacheKey]
  );

  // Fetch user profile
  const {
    data: user,
    isLoading: isLoadingUser,
    error: userError,
    isFetched: isUserFetched,
  } = useQuery({
    queryKey: userProfileQueryKey,
    queryFn: async () => {
      const sessionCachedProfile =
        userProfileCacheKey
          ? readSessionCache<UserProfileData>(userProfileCacheKey, USER_PROFILE_CACHE_TTL_MS)
          : null;
      const currentProfile = queryClient.getQueryData<UserProfileData>(userProfileQueryKey);
      const feedFallbackProfile = buildUserProfileFallbackFromFeed(queryClient, userId);
      const fallbackProfile =
        sessionCachedProfile ?? currentProfile ?? cachedUserProfile ?? feedFallbackProfile ?? null;
      try {
        const data = await api.get<UserProfileData>(`/api/users/${userId}`);
        return data;
      } catch (error) {
        if (fallbackProfile) {
          return fallbackProfile;
        }
        throw error;
      }
    },
    initialData: cachedUserProfile ?? buildUserProfileFallbackFromFeed(queryClient, userId) ?? undefined,
    enabled: !!userId,
    staleTime: 60000,
    gcTime: 300000,
    refetchInterval: false,
    refetchOnMount: cachedUserProfile ? false : true,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: 1,
  });

  // Fetch user posts
  const {
    data: posts = [],
    isLoading: isLoadingPosts,
    isFetched: isPostsFetched,
  } = useQuery({
    queryKey: userPostsQueryKey,
    queryFn: async () => {
      const sessionCachedPosts =
        userPostsCacheKey
          ? readSessionCache<Post[]>(userPostsCacheKey, USER_PROFILE_POSTS_CACHE_TTL_MS)
          : null;
      const currentPosts = queryClient.getQueryData<Post[]>(userPostsQueryKey);
      const feedFallbackPosts = getCachedFeedPostsForProfile(queryClient, userId);
      const fallbackPosts =
        sessionCachedPosts && sessionCachedPosts.length > 0
          ? sessionCachedPosts
          : currentPosts && currentPosts.length > 0
            ? currentPosts
            : cachedUserPosts && cachedUserPosts.length > 0
              ? cachedUserPosts
              : feedFallbackPosts.length > 0
                ? feedFallbackPosts
                : null;
      try {
        const data = await api.get<Post[]>(`/api/users/${userId}/posts`);
        if (data.length === 0 && fallbackPosts) {
          return fallbackPosts;
        }
        return data;
      } catch (error) {
        if (fallbackPosts) {
          return fallbackPosts;
        }
        throw error;
      }
    },
    initialData:
      cachedUserPosts ?? (() => {
        const fallbackPosts = getCachedFeedPostsForProfile(queryClient, userId);
        return fallbackPosts.length > 0 ? fallbackPosts : undefined;
      })(),
    enabled: !!userId,
    staleTime: 60000,
    gcTime: 300000,
    refetchInterval: false,
    refetchOnMount: cachedUserPosts ? false : true,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: 1,
  });

  // Fetch user reposts
  const {
    data: reposts = [],
    isLoading: isLoadingReposts,
    isFetched: isRepostsFetched,
  } = useQuery({
    queryKey: userRepostsQueryKey,
    queryFn: async () => {
      const sessionCachedReposts =
        userRepostsCacheKey
          ? readSessionCache<Post[]>(userRepostsCacheKey, USER_PROFILE_POSTS_CACHE_TTL_MS)
          : null;
      const currentReposts = queryClient.getQueryData<Post[]>(userRepostsQueryKey);
      const fallbackReposts =
        sessionCachedReposts && sessionCachedReposts.length > 0
          ? sessionCachedReposts
          : currentReposts && currentReposts.length > 0
            ? currentReposts
            : cachedUserReposts && cachedUserReposts.length > 0
              ? cachedUserReposts
              : null;
      try {
        const data = await api.get<Post[]>(`/api/users/${userId}/reposts`);
        if (data.length === 0 && fallbackReposts) {
          return fallbackReposts;
        }
        return data;
      } catch (error) {
        if (fallbackReposts) {
          return fallbackReposts;
        }
        throw error;
      }
    },
    initialData: cachedUserReposts ?? undefined,
    enabled: !!userId && mainTab === "reposts",
    staleTime: 60000,
    gcTime: 300000,
    refetchInterval: false,
    refetchOnMount: cachedUserReposts ? false : true,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: 1,
  });

  useEffect(() => {
    if (!user || !isUserFetched || !userProfileCacheKey) return;
    writeSessionCache(userProfileCacheKey, user);
  }, [isUserFetched, user, userProfileCacheKey]);

  useEffect(() => {
    if (!isPostsFetched || !userPostsCacheKey) return;
    writeSessionCache(userPostsCacheKey, posts);
  }, [isPostsFetched, posts, userPostsCacheKey]);

  useEffect(() => {
    if (!isRepostsFetched || !userRepostsCacheKey) return;
    writeSessionCache(userRepostsCacheKey, reposts);
  }, [isRepostsFetched, reposts, userRepostsCacheKey]);

  useEffect(() => {
    const canonicalUsername = user?.username?.trim().toLowerCase();
    if (!canonicalUsername || !userId) return;

    const canonicalPath = `/${canonicalUsername}`;
    if (location.pathname === canonicalPath) {
      return;
    }

    const legacyPath = `/profile/${userId}`;
    const publicPath = `/${userId}`;
    if (location.pathname === legacyPath || location.pathname === publicPath) {
      navigate(`${canonicalPath}${location.search}${location.hash}`, { replace: true });
    }
  }, [location.hash, location.pathname, location.search, navigate, user, userId]);

  // Follow mutation
  const followMutation = useMutation({
    mutationFn: async () => {
      if (!session?.user) {
        throw new Error("Sign in to follow users");
      }
      if (!canPerformAuthenticatedWrites) {
        throw new Error("Signing you in...");
      }
      const targetIdentifier = user?.username ?? user?.id ?? userId;
      if (!targetIdentifier) {
        throw new Error("User not found");
      }
      if (user?.isFollowing) {
        return await api.delete<FollowMutationResponse>(`/api/users/${targetIdentifier}/follow`);
      } else {
        return await api.post<FollowMutationResponse>(`/api/users/${targetIdentifier}/follow`);
      }
    },
    onSuccess: (result) => {
      const nextFollowing = result.following;

      queryClient.setQueryData<UserProfileData | undefined>(userProfileQueryKey, (prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          isFollowing: nextFollowing,
          stats: {
            ...prev.stats,
            followers: result.followerCount,
          },
        };
      });

      const syncPostFollowState = (prev?: Post[]) =>
        prev?.map((post) => {
          const matchesProfile =
            post.author.id === user?.id ||
            (Boolean(user?.username) && post.author.username === user?.username);
          return matchesProfile ? { ...post, isFollowingAuthor: nextFollowing } : post;
        }) ?? prev;

      queryClient.setQueryData<Post[] | undefined>(userPostsQueryKey, syncPostFollowState);
      queryClient.setQueryData<Post[] | undefined>(userRepostsQueryKey, syncPostFollowState);

      queryClient.invalidateQueries({ queryKey: userProfileQueryKey });
      queryClient.invalidateQueries({ queryKey: userPostsQueryKey });
      queryClient.invalidateQueries({ queryKey: userRepostsQueryKey });
      toast.success(nextFollowing ? "Following" : "Unfollowed");
    },
    onError: (error) => {
      if (error instanceof ApiError) {
        const alreadyFollowing = error.status === 400 && /already following/i.test(error.message);
        const notFollowing = error.status === 404 && /not following/i.test(error.message);

        if (alreadyFollowing || notFollowing) {
          const nextFollowing = alreadyFollowing;
          queryClient.setQueryData<UserProfileData | undefined>(userProfileQueryKey, (prev) => {
            if (!prev) return prev;
            return {
              ...prev,
              isFollowing: nextFollowing,
            };
          });
          queryClient.invalidateQueries({ queryKey: userProfileQueryKey });
          queryClient.invalidateQueries({ queryKey: userPostsQueryKey });
          queryClient.invalidateQueries({ queryKey: userRepostsQueryKey });
          toast.success(nextFollowing ? "Following" : "Unfollowed");
          return;
        }
      }

      toast.error(error instanceof Error ? error.message : "Failed to update follow status");
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
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: userPostsQueryKey });
      queryClient.invalidateQueries({ queryKey: userRepostsQueryKey });
    },
  });

  // Comment mutation
  const commentMutation = useMutation({
    mutationFn: async ({ postId, content }: { postId: string; content: string }) => {
      await api.post(`/api/posts/${postId}/comments`, { content });
    },
    onSuccess: () => {
      toast.success("Comment added!");
      queryClient.invalidateQueries({ queryKey: userPostsQueryKey });
    },
  });

  // Handlers
  const handleLike = (postId: string) => {
    if (!session?.user) {
      toast.info("Sign in to interact with posts.");
      return;
    }
    if (!canPerformAuthenticatedWrites) {
      toast.info("Signing you in...");
      return;
    }
    const post = posts.find((p) => p.id === postId) || reposts.find((p) => p.id === postId);
    if (post) {
      likeMutation.mutate({ postId, isLiked: post.isLiked });
    }
  };

  const handleRepost = (postId: string) => {
    if (!session?.user) {
      toast.info("Sign in to interact with posts.");
      return;
    }
    if (!canPerformAuthenticatedWrites) {
      toast.info("Signing you in...");
      return;
    }
    const post = posts.find((p) => p.id === postId) || reposts.find((p) => p.id === postId);
    if (post) {
      repostMutation.mutate({ postId, isReposted: post.isReposted });
    }
  };

  const handleComment = (postId: string, content: string) => {
    if (!session?.user) {
      toast.info("Sign in to interact with posts.");
      return;
    }
    if (!canPerformAuthenticatedWrites) {
      toast.info("Signing you in...");
      return;
    }
    commentMutation.mutate({ postId, content });
  };

  // Filter posts
  const filteredPosts = posts.filter((post) => {
    if (postFilter === "all") return true;
    if (postFilter === "wins") return post.settled && post.isWin;
    if (postFilter === "losses") return post.settled && !post.isWin;
    return true;
  });

  // Calculate stats
  const winsCount = user?.stats?.wins ?? posts.filter((p) => p.settled && p.isWin).length;
  const lossesCount = user?.stats?.losses ?? posts.filter((p) => p.settled && !p.isWin).length;
  const totalSettled = winsCount + lossesCount;

  // Calculate user stats for ProfileDashboard
  const userStats = useMemo<UserStats>(() => {
    if (user?.stats) {
      return user.stats;
    }
    const settledPosts = posts.filter((p) => p.settled);
    let totalProfitPercent = 0;

    settledPosts.forEach((post) => {
      const change = calculatePercentChange(post.entryMcap, post.currentMcap);
      if (change !== null) {
        totalProfitPercent += change;
      }
    });

    return {
      totalCalls: settledPosts.length,
      wins: winsCount,
      losses: lossesCount,
      winRate: totalSettled > 0 ? (winsCount / totalSettled) * 100 : 0,
      totalProfitPercent,
    };
  }, [user?.stats, posts, winsCount, lossesCount, totalSettled]);

  // Get recent settled trades for ProfileDashboard
  const recentTrades = useMemo<RecentTrade[]>(() => {
    return posts
      .filter((p) => p.settled)
      .sort((a, b) => {
        const dateA = new Date(a.settledAt || a.createdAt).getTime();
        const dateB = new Date(b.settledAt || b.createdAt).getTime();
        return dateB - dateA;
      })
      .slice(0, 5)
      .map((p) => ({
        id: p.id,
        content: p.content,
        contractAddress: p.contractAddress,
        chainType: p.chainType,
        entryMcap: p.entryMcap,
        currentMcap: p.currentMcap,
        settled: p.settled,
        settledAt: p.settledAt,
        isWin: p.isWin,
        createdAt: p.createdAt,
      }));
  }, [posts]);

  // Format join date
  const formatJoinDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString("en-US", {
      month: "long",
      year: "numeric",
    });
  };

  // Check if this is current user's profile
  const normalizedProfileIdentifier = userId?.trim().toLowerCase() ?? "";
  const isOwnProfile =
    Boolean(session?.user?.id) &&
    (session?.user?.id === userId ||
      session?.user?.username?.trim().toLowerCase() === normalizedProfileIdentifier);
  const profileDisplayName =
    user?.username?.trim() || user?.name?.trim() || normalizedProfileIdentifier || "Trader";
  const profileAvatarSeed =
    user?.id ?? (normalizedProfileIdentifier || "trader");

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="app-topbar">
        <div className="mx-auto flex h-[4.4rem] max-w-[780px] items-center justify-between px-4 sm:px-5">
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => navigate(-1)}
              className="h-10 w-10 rounded-2xl border border-border/60 bg-white/60 shadow-[0_18px_34px_-28px_hsl(var(--foreground)/0.18)] dark:border-white/[0.08] dark:bg-white/[0.04] dark:shadow-none"
            >
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <h1 className="font-heading font-semibold text-lg">
              {profileDisplayName || "Profile"}
            </h1>
          </div>

          {!isOwnProfile && user && (
            <div className="flex items-center gap-2">
              {canPerformAuthenticatedWrites ? (
                <ReportDialog
                  targetType="user"
                  targetId={user.username ?? userId ?? ""}
                  targetLabel={user.username ? `@${user.username}` : "this user"}
                  buttonVariant="outline"
                  buttonSize="sm"
                  buttonClassName="h-8 px-3 gap-1.5"
                />
              ) : null}
              <Button
                variant={user.isFollowing ? "outline" : "default"}
                size="sm"
                onClick={() => {
                  if (!session?.user) {
                    toast.info("Sign in to follow users.");
                    return;
                  }
                  if (!canPerformAuthenticatedWrites) {
                    toast.info("Signing you in...");
                    return;
                  }
                  followMutation.mutate();
                }}
                disabled={followMutation.isPending || !session?.user || !canPerformAuthenticatedWrites}
                className="h-9 gap-1.5 rounded-full px-3"
              >
                {followMutation.isPending ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : user.isFollowing ? (
                  <>
                    <UserMinus className="h-3.5 w-3.5" />
                    Unfollow
                  </>
                ) : (
                  <>
                    <PhewFollowIcon className="h-3.5 w-3.5" />
                    Follow
                  </>
                )}
              </Button>
            </div>
          )}

          {isOwnProfile && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => navigate("/profile")}
              disabled={!hasLiveSession}
              className="h-8 px-3"
            >
              Edit Profile
            </Button>
          )}
        </div>
      </header>

      <main className="app-page-shell">
        {isLoadingUser ? (
          <div className="space-y-6">
            <div className="flex flex-col items-center gap-4">
              <Skeleton className="h-28 w-28 rounded-full" />
              <Skeleton className="h-6 w-40" />
              <Skeleton className="h-4 w-32" />
            </div>
            <Skeleton className="h-24 w-full rounded-xl" />
            <Skeleton className="h-32 w-full rounded-xl" />
          </div>
        ) : userError ? (
          <div className="app-empty-state">
            <div className="w-16 h-16 rounded-full bg-destructive/10 flex items-center justify-center">
              <AlertCircle className="h-8 w-8 text-destructive" />
            </div>
            <p className="text-muted-foreground">User not found</p>
            <Button onClick={() => navigate(-1)}>Go Back</Button>
          </div>
        ) : user ? (
          <div className="space-y-6 animate-fade-in">
            {/* Danger Zone Warning Banner */}
            {(user.level <= LIQUIDATION_LEVEL || isInDangerZone(user.level)) && (
              <div
                className={cn(
                  "flex items-center gap-3 p-4 rounded-xl border",
                  user.level <= LIQUIDATION_LEVEL
                    ? "bg-red-600/20 border-red-600 text-red-500"
                    : "bg-red-500/10 border-red-400 text-red-300"
                )}
              >
                {user.level <= LIQUIDATION_LEVEL ? (
                  <Skull className="h-6 w-6 flex-shrink-0" />
                ) : (
                  <AlertTriangle className="h-6 w-6 flex-shrink-0" />
                )}
                <div>
                  <p className="font-bold text-sm">
                    {user.level <= LIQUIDATION_LEVEL ? "ACCOUNT LIQUIDATED" : "REPUTATION AT RISK"}
                  </p>
                  <p className="text-xs opacity-80 mt-0.5">
                    {getDangerMessage(user.level)}
                  </p>
                </div>
              </div>
            )}

            {/* Profile Header */}
            <div className="flex flex-col items-center text-center">
              {/* Avatar */}
              <div className="relative">
                <Avatar className="h-28 w-28 border-4 border-background ring-4 ring-primary/20">
                  <AvatarImage src={getAvatarUrl(profileAvatarSeed, user.image)} />
                  <AvatarFallback className="bg-muted text-muted-foreground text-3xl">
                    {profileDisplayName.charAt(0).toUpperCase() || "?"}
                  </AvatarFallback>
                </Avatar>

                {/* Level badge overlay */}
                <div className="absolute -bottom-2 -right-2">
                  <LevelBadge level={user.level} size="lg" showLabel />
                </div>
              </div>

              {/* Username */}
              <h2 className="mt-4 font-heading font-bold text-2xl flex items-center gap-1.5">
                {user.username ? `@${user.username}` : profileDisplayName}
                {user.isVerified ? <VerifiedBadge size="md" /> : null}
              </h2>
              {/* Level label under username */}
              <span className={cn(
                "text-xs font-medium uppercase tracking-wider mt-1",
                user.level >= 8 && "text-amber-400",
                user.level >= 4 && user.level < 8 && "text-slate-300",
                user.level >= 1 && user.level < 4 && "text-orange-500",
                user.level >= -2 && user.level < 1 && "text-red-300",
                user.level < -2 && "text-red-500"
              )}>
                {getLevelLabel(user.level)} Trader
              </span>

              {/* Info badges */}
              <div className="mt-4 flex flex-wrap items-center justify-center gap-3">
                <div className="flex items-center gap-1.5 px-3 py-1.5 bg-secondary rounded-full text-xs text-muted-foreground">
                  <Calendar className="h-3.5 w-3.5" />
                  <span>Joined {formatJoinDate(user.createdAt)}</span>
                </div>
              </div>
            </div>

            {/* Profile Dashboard - XP, Stats, Recent Trades */}
            <ProfileDashboard
              level={user.level}
              xp={user.xp ?? 0}
              stats={userStats}
              recentTrades={recentTrades}
              isLoading={isLoadingUser}
            />

            <TraderIntelligenceCard handle={user.username ?? user.id ?? userId} />

            {/* Followers/Following */}
            <div className="flex items-center justify-center gap-6 py-3">
              <div className="flex items-center gap-2">
                <span className="font-bold">{user.stats.followers ?? 0}</span>
                <span className="text-muted-foreground">Followers</span>
              </div>
              <div className="h-4 w-px bg-border" />
              <div className="flex items-center gap-2">
                <span className="font-bold">{user.stats.following ?? 0}</span>
                <span className="text-muted-foreground">Following</span>
              </div>
            </div>

            {/* User Posts Section */}
            <div className="space-y-4">
              {/* Main Tabs: Posts | Reposts */}
              <Tabs
                value={mainTab}
                onValueChange={(v) => setMainTab(v as MainTab)}
                className="w-full"
              >
                <TabsList className="w-full grid grid-cols-2 h-10">
                  <TabsTrigger value="posts" className="gap-1.5">
                    Posts
                  </TabsTrigger>
                  <TabsTrigger value="reposts" className="gap-1.5">
                        <PhewRepostIcon className="h-3.5 w-3.5" />
                        Reposts
                  </TabsTrigger>
                </TabsList>

                {/* Posts Tab Content */}
                <TabsContent value="posts" className="mt-4">
                  {/* Sub-tabs: All | Wins | Losses */}
                  <Tabs
                    value={postFilter}
                    onValueChange={(v) => setPostFilter(v as PostFilter)}
                    className="w-full"
                  >
                    <TabsList className="w-full grid grid-cols-3 h-10">
                      <TabsTrigger value="all" className="gap-1.5">
                        All
                      </TabsTrigger>
                      <TabsTrigger value="wins" className="gap-1.5">
                        <TrendingUp className="h-3.5 w-3.5" />
                        Wins
                      </TabsTrigger>
                      <TabsTrigger value="losses" className="gap-1.5">
                        <TrendingDown className="h-3.5 w-3.5" />
                        Losses
                      </TabsTrigger>
                    </TabsList>

                    <TabsContent value={postFilter} className="mt-4 space-y-4">
                      {isLoadingPosts ? (
                        <>
                          {[0, 1, 2].map((i) => (
                            <PostCardSkeleton key={i} showMarketData={i < 2} />
                          ))}
                        </>
                      ) : filteredPosts.length === 0 ? (
                        <div className="flex flex-col items-center justify-center py-16 gap-4 text-center">
                          <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center">
                            <Sparkles className="h-8 w-8 text-muted-foreground" />
                          </div>
                          <div>
                            <p className="font-semibold text-foreground">
                              {postFilter === "all"
                                ? "No posts yet"
                                : postFilter === "wins"
                                ? "No wins yet"
                                : "No losses yet"}
                            </p>
                            <p className="text-sm text-muted-foreground mt-1">
                              {postFilter === "all"
                                ? "This user hasn't posted any alpha calls yet"
                                : "Check back later"}
                            </p>
                          </div>
                        </div>
                      ) : (
                        <WindowVirtualList
                          items={filteredPosts}
                          getItemKey={(post) => post.id}
                          estimateItemHeight={560}
                          overscanPx={1200}
                          renderItem={(post, index) => (
                            <div className={index < filteredPosts.length - 1 ? "pb-4" : undefined}>
                              <div
                                className="animate-fade-in-up"
                                style={{ animationDelay: `${Math.min(index, 8) * 0.05}s` }}
                              >
                                <PostCard
                                  post={post}
                                  currentUserId={canPerformAuthenticatedWrites ? session?.user?.id : undefined}
                                  onLike={handleLike}
                                  onRepost={handleRepost}
                                  onComment={handleComment}
                                />
                              </div>
                            </div>
                          )}
                        />
                      )}
                    </TabsContent>
                  </Tabs>
                </TabsContent>

                {/* Reposts Tab Content */}
                <TabsContent value="reposts" className="mt-4 space-y-4">
                  {isLoadingReposts ? (
                    <>
                      {[0, 1, 2].map((i) => (
                        <PostCardSkeleton key={i} showMarketData={i < 2} />
                      ))}
                    </>
                  ) : reposts.length === 0 ? (
                    <div className="app-empty-state">
                      <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center">
                        <PhewRepostIcon className="h-8 w-8 text-muted-foreground" />
                      </div>
                      <div>
                        <p className="font-semibold text-foreground">No reposts yet</p>
                        <p className="text-sm text-muted-foreground mt-1">
                          This user hasn't reposted anything yet
                        </p>
                      </div>
                    </div>
                  ) : (
                    <WindowVirtualList
                      items={reposts}
                      getItemKey={(post) => post.id}
                      estimateItemHeight={560}
                      overscanPx={1200}
                      renderItem={(post, index) => (
                        <div className={index < reposts.length - 1 ? "pb-4" : undefined}>
                          <div
                            className="animate-fade-in-up"
                            style={{ animationDelay: `${Math.min(index, 8) * 0.05}s` }}
                          >
                            <PostCard
                              post={post}
                              currentUserId={canPerformAuthenticatedWrites ? session?.user?.id : undefined}
                              onLike={handleLike}
                              onRepost={handleRepost}
                              onComment={handleComment}
                            />
                          </div>
                        </div>
                      )}
                    />
                  )}
                </TabsContent>
              </Tabs>
            </div>
          </div>
        ) : null}
      </main>
    </div>
  );
}
