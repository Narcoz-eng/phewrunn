import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useSession } from "@/lib/auth-client";
import { api, ApiError } from "@/lib/api";
import { Post, calculatePercentChange, getAvatarUrl, LIQUIDATION_LEVEL } from "@/types";
import { LevelBadge } from "@/components/feed/LevelBar";
import { getLevelLabel, isInDangerZone, getDangerMessage } from "@/lib/level-utils";
import { PostCard } from "@/components/feed/PostCard";
import { PostCardSkeleton } from "@/components/feed/PostCardSkeleton";
import { ProfileDashboard, UserStats, RecentTrade, WalletData } from "@/components/profile/ProfileDashboard";
import { WindowVirtualList } from "@/components/virtual/WindowVirtualList";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  ArrowLeft,
  Calendar,
  Wallet,
  Mail,
  TrendingUp,
  TrendingDown,
  UserPlus,
  UserMinus,
  Loader2,
  Sparkles,
  AlertCircle,
  Repeat2,
  Copy,
  Check,
  AlertTriangle,
  Skull,
} from "lucide-react";
import { VerifiedBadge } from "@/components/VerifiedBadge";
import { ReportDialog } from "@/components/reporting/ReportDialog";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { readSessionCache, writeSessionCache } from "@/lib/session-cache";
import { buildProfilePath } from "@/lib/profile-path";

interface UserProfileData {
  id: string;
  name: string;
  email: string | null;
  image: string | null;
  walletAddress: string | null;
  username: string | null;
  level: number;
  xp: number;
  bio: string | null;
  isVerified?: boolean;
  createdAt: string;
  isFollowing?: boolean;
  _count: {
    posts: number;
    followers: number;
    following: number;
  };
  stats?: {
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
const USER_PROFILE_WALLET_CACHE_TTL_MS = 60_000;

export default function UserProfile() {
  const navigate = useNavigate();
  const location = useLocation();
  const { userId } = useParams<{ userId: string }>();
  const { data: session, hasLiveSession } = useSession();
  const queryClient = useQueryClient();
  const [mainTab, setMainTab] = useState<MainTab>("posts");
  const [postFilter, setPostFilter] = useState<PostFilter>("all");
  const [walletCopied, setWalletCopied] = useState(false);
  const [enableWalletOverviewQuery, setEnableWalletOverviewQuery] = useState(false);
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
    () => (userId ? `phew.user-profile:${viewerCacheScope}:${userId}` : null),
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
  const cachedUserWalletOverview = useMemo(
    () =>
      userId
        ? readSessionCache<WalletData>(`phew.user-wallet:${userId}`, USER_PROFILE_WALLET_CACHE_TTL_MS)
        : null,
    [userId]
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
      const data = await api.get<UserProfileData>(`/api/users/${userId}`);
      return data;
    },
    initialData: cachedUserProfile ?? undefined,
    enabled: !!userId,
    staleTime: 60000,
    gcTime: 300000,
    refetchInterval: userId ? 15_000 : false,
    refetchOnMount: "always",
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
      const data = await api.get<Post[]>(`/api/users/${userId}/posts`);
      return data;
    },
    initialData: cachedUserPosts ?? undefined,
    enabled: !!userId,
    staleTime: 60000,
    gcTime: 300000,
    refetchInterval: userId ? 15_000 : false,
    refetchOnMount: "always",
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
      const data = await api.get<Post[]>(`/api/users/${userId}/reposts`);
      return data;
    },
    initialData: cachedUserReposts ?? undefined,
    enabled: !!userId && (mainTab === "reposts" || !!cachedUserReposts),
    staleTime: 60000,
    gcTime: 300000,
    refetchInterval: userId && (mainTab === "reposts" || !!cachedUserReposts) ? 20_000 : false,
    refetchOnMount: "always",
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: 1,
  });

  const {
    data: walletOverview,
    isFetched: isWalletOverviewFetched,
  } = useQuery({
    queryKey: ["userWalletOverview", userId],
    queryFn: async () => {
      if (!userId) return null;
      return await api.get<WalletData>(`/api/users/${userId}/wallet/overview`);
    },
    initialData: cachedUserWalletOverview ?? undefined,
    enabled: !!userId && !!user?.walletAddress && enableWalletOverviewQuery,
    staleTime: 60_000,
    gcTime: 300_000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: 1,
  });

  useEffect(() => {
    if (!user || !isUserFetched || !userProfileCacheKey) return;
    writeSessionCache(userProfileCacheKey, user);
  }, [isUserFetched, user, userProfileCacheKey]);

  useEffect(() => {
    setEnableWalletOverviewQuery(false);
    if (!user?.walletAddress) return;
    const timer = window.setTimeout(() => setEnableWalletOverviewQuery(true), 350);
    return () => window.clearTimeout(timer);
  }, [user?.walletAddress]);

  useEffect(() => {
    if (!isPostsFetched || !userPostsCacheKey) return;
    writeSessionCache(userPostsCacheKey, posts);
  }, [isPostsFetched, posts, userPostsCacheKey]);

  useEffect(() => {
    if (!isRepostsFetched || !userRepostsCacheKey) return;
    writeSessionCache(userRepostsCacheKey, reposts);
  }, [isRepostsFetched, reposts, userRepostsCacheKey]);

  useEffect(() => {
    if (!userId || !isWalletOverviewFetched || !walletOverview) return;
    writeSessionCache(`phew.user-wallet:${userId}`, walletOverview);
  }, [isWalletOverviewFetched, userId, walletOverview]);

  useEffect(() => {
    if (!user || !userId) return;

    const canonicalPath = buildProfilePath(user.id, user.username);
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
      if (!hasLiveSession) {
        throw new Error("Still finalizing sign-in. Try again in a moment.");
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
          _count: {
            ...prev._count,
            followers: result.followerCount,
          },
        };
      });

      const syncPostFollowState = (prev?: Post[]) =>
        prev?.map((post) =>
          post.author.id === user?.id ? { ...post, isFollowingAuthor: nextFollowing } : post
        ) ?? prev;

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
    if (!hasLiveSession) {
      toast.info("Still finalizing sign-in. Try again in a moment.");
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
    if (!hasLiveSession) {
      toast.info("Still finalizing sign-in. Try again in a moment.");
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
    if (!hasLiveSession) {
      toast.info("Still finalizing sign-in. Try again in a moment.");
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

  // Truncate wallet address
  const truncateAddress = (address: string) => {
    return `${address.slice(0, 6)}...${address.slice(-4)}`;
  };

  // Check if this is current user's profile
  const isOwnProfile = session?.user?.id === user?.id;

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-background/80 backdrop-blur-xl border-b border-border">
        <div className="max-w-2xl mx-auto px-4 h-14 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => navigate(-1)}
              className="h-9 w-9"
            >
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <h1 className="font-heading font-semibold text-lg">
              {user?.username || user?.name || "Profile"}
            </h1>
          </div>

          {!isOwnProfile && user && (
            <div className="flex items-center gap-2">
              {hasLiveSession ? (
                <ReportDialog
                  targetType="user"
                  targetId={user.id}
                  targetLabel={user.username || user.name}
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
                  if (!hasLiveSession) {
                    toast.info("Still finalizing sign-in. Try again in a moment.");
                    return;
                  }
                  followMutation.mutate();
                }}
                disabled={followMutation.isPending || !session?.user || !hasLiveSession}
                className="h-8 px-3 gap-1.5"
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
                    <UserPlus className="h-3.5 w-3.5" />
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

      <main className="max-w-2xl mx-auto px-4 py-6">
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
          <div className="flex flex-col items-center justify-center py-16 gap-4">
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
                  <AvatarImage src={getAvatarUrl(user.id, user.image)} />
                  <AvatarFallback className="bg-muted text-muted-foreground text-3xl">
                    {user.name?.charAt(0) || "?"}
                  </AvatarFallback>
                </Avatar>

                {/* Level badge overlay */}
                <div className="absolute -bottom-2 -right-2">
                  <LevelBadge level={user.level} size="lg" showLabel />
                </div>
              </div>

              {/* Username */}
              <h2 className="mt-4 font-heading font-bold text-2xl flex items-center gap-1.5">
                {user.username || user.name}
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

              {/* Bio */}
              {user.bio && (
                <p className="mt-2 text-muted-foreground max-w-sm">{user.bio}</p>
              )}

              {/* Info badges */}
              <div className="mt-4 flex flex-wrap items-center justify-center gap-3">
                {user.walletAddress && (
                  <button
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(user.walletAddress!);
                        setWalletCopied(true);
                        toast.success("Address copied to clipboard");
                        setTimeout(() => setWalletCopied(false), 2000);
                      } catch {
                        toast.error("Failed to copy address");
                      }
                    }}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-secondary hover:bg-secondary/80 rounded-full text-xs text-muted-foreground transition-colors cursor-pointer group"
                    title="Click to copy address"
                  >
                    <Wallet className="h-3.5 w-3.5" />
                    <span className="font-mono">
                      {truncateAddress(user.walletAddress)}
                    </span>
                    {walletCopied ? (
                      <Check className="h-3 w-3 text-gain" />
                    ) : (
                      <Copy className="h-3 w-3 opacity-0 group-hover:opacity-100 transition-opacity" />
                    )}
                  </button>
                )}

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
              walletData={
                walletOverview
                  ? { ...walletOverview, address: user.walletAddress ?? walletOverview.address }
                  : user.walletAddress
                    ? { connected: true, address: user.walletAddress }
                    : undefined
              }
              isLoading={isLoadingUser}
            />

            {/* Followers/Following */}
            <div className="flex items-center justify-center gap-6 py-3">
              <div className="flex items-center gap-2">
                <span className="font-bold">{user._count?.followers ?? 0}</span>
                <span className="text-muted-foreground">Followers</span>
              </div>
              <div className="h-4 w-px bg-border" />
              <div className="flex items-center gap-2">
                <span className="font-bold">{user._count?.following ?? 0}</span>
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
                    <Repeat2 className="h-3.5 w-3.5" />
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
                                  currentUserId={hasLiveSession ? session?.user?.id : undefined}
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
                    <div className="flex flex-col items-center justify-center py-16 gap-4 text-center">
                      <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center">
                        <Repeat2 className="h-8 w-8 text-muted-foreground" />
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
                              currentUserId={hasLiveSession ? session?.user?.id : undefined}
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
