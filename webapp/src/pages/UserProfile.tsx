import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import {
  useQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import { useSession } from "@/lib/auth-client";
import { api, ApiError } from "@/lib/api";
import { Post, calculatePercentChange, getAvatarUrl, LIQUIDATION_LEVEL } from "@/types";
import { LevelBadge } from "@/components/feed/LevelBar";
import { getLevelLabel, isInDangerZone, getDangerMessage } from "@/lib/level-utils";
import { PostCard } from "@/components/feed/PostCard";
import { PostCardSkeleton } from "@/components/feed/PostCardSkeleton";
import { ProfileDashboard, type UserStats, type RecentTrade } from "@/components/profile/ProfileDashboard";
import { TraderIntelligenceCard } from "@/components/profile/TraderIntelligenceCard";
import { WindowVirtualList } from "@/components/virtual/WindowVirtualList";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  ArrowLeft,
  BrainCircuit,
  Calendar,
  Coins,
  TrendingUp,
  TrendingDown,
  UserMinus,
  Loader2,
  Sparkles,
  AlertCircle,
  Repeat2,
  AlertTriangle,
  Skull,
  Flag,
  ShieldCheck,
  Trophy,
  Wallet,
} from "lucide-react";
import { VerifiedBadge } from "@/components/VerifiedBadge";
import { ReportDialog } from "@/components/reporting/ReportDialog";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { readSessionCache, writeSessionCache } from "@/lib/session-cache";
import {
  getBestCachedProfileSnapshot,
  type ProfileCacheSnapshot,
  syncProfileSnapshotAcrossCaches,
} from "@/lib/profile-cache";
import {
  getCachedPostsForAuthor,
  syncFollowStateAcrossPostCaches,
  syncPostsIntoQueryCache,
} from "@/lib/post-query-cache";
import { PhewFollowIcon, PhewRepostIcon } from "@/components/icons/PhewIcons";
import { ProfileBanner } from "@/components/profile/ProfileBanner";
import { ShareableProfileCard } from "@/components/profile/ShareableProfileCard";
import { Share2 } from "lucide-react";
import { TraderPerformanceView } from "@/components/experience/TraderPerformanceView";
import { BrandLogo } from "@/components/BrandLogo";
import { V2PageHeader } from "@/components/layout/V2PageHeader";
import { V2EmptyState } from "@/components/ui/v2/V2EmptyState";
import { V2MetricCard } from "@/components/ui/v2/V2MetricCard";
import { V2SectionHeader } from "@/components/ui/v2/V2SectionHeader";
import { V2StatusPill } from "@/components/ui/v2/V2StatusPill";
import { V2Surface } from "@/components/ui/v2/V2Surface";
import { V2TabBar } from "@/components/ui/v2/V2TabBar";
import {
  buildTraderPerformanceVm,
  buildTraderPerformanceVmFromSnapshot,
  type PerformancePeriod,
  type UserPerformanceSnapshot,
} from "@/viewmodels/trader-performance";

interface UserProfileData {
  id?: string | null;
  name?: string | null;
  image: string | null;
  username: string | null;
  level: number;
  xp: number;
  isVerified?: boolean;
  bannerImage?: string | null;
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

type UserPerformanceResponse = UserPerformanceSnapshot;

type PostFilter = "all" | "wins" | "losses";
type MainTab = "posts" | "reposts";
type ProfileTab = "overview" | "calls" | "raids" | "portfolio" | "stats";
type FollowMutationResponse = { following: boolean; followerCount: number };
const USER_PROFILE_CACHE_TTL_MS = 60_000;
const USER_PROFILE_POSTS_CACHE_TTL_MS = 45_000;

function hasSuspiciousZeroPublicProfileCounts(profile: UserProfileData | null | undefined): boolean {
  if (!profile?.stats) {
    return true;
  }

  const { followers, following, posts, wins, losses } = profile.stats;
  const counts = [followers, following, posts, wins, losses];

  if (!counts.every((value) => typeof value === "number" && Number.isFinite(value))) {
    return true;
  }

  return followers === 0 && following === 0;
}

function buildUserProfileFromSnapshot(
  snapshot: ProfileCacheSnapshot | null | undefined
): UserProfileData | null {
  if (!snapshot?.id) {
    return null;
  }

  const wins = typeof snapshot.winsCount === "number" && Number.isFinite(snapshot.winsCount) ? snapshot.winsCount : 0;
  const losses =
    typeof snapshot.lossesCount === "number" && Number.isFinite(snapshot.lossesCount) ? snapshot.lossesCount : 0;
  const totalCalls = wins + losses;

  return {
    id: snapshot.id,
    name: snapshot.username ?? null,
    image: snapshot.image ?? null,
    username: snapshot.username ?? null,
    level: typeof snapshot.level === "number" && Number.isFinite(snapshot.level) ? snapshot.level : 0,
    xp: typeof snapshot.xp === "number" && Number.isFinite(snapshot.xp) ? snapshot.xp : 0,
    isVerified: typeof snapshot.isVerified === "boolean" ? snapshot.isVerified : false,
    createdAt: snapshot.createdAt ?? new Date(0).toISOString(),
    isFollowing: false,
    stats: {
      posts:
        typeof snapshot.postsCount === "number" && Number.isFinite(snapshot.postsCount) ? snapshot.postsCount : 0,
      followers:
        typeof snapshot.followersCount === "number" && Number.isFinite(snapshot.followersCount)
          ? snapshot.followersCount
          : 0,
      following:
        typeof snapshot.followingCount === "number" && Number.isFinite(snapshot.followingCount)
          ? snapshot.followingCount
          : 0,
      totalCalls,
      wins,
      losses,
      winRate: totalCalls > 0 ? Math.round((wins / totalCalls) * 100) : 0,
      totalProfitPercent: 0,
    },
  };
}

function buildUserProfileFromPostAuthorSnapshot(
  posts: Post[] | null | undefined,
  identifier: string | null | undefined
): UserProfileData | null {
  const author = posts?.find((post) => post.author)?.author;
  if (!author?.id) {
    return null;
  }

  return {
    id: author.id,
    name: author.name ?? author.username ?? null,
    image: author.image ?? null,
    username: author.username ?? (identifier?.trim() || null),
    level: typeof author.level === "number" && Number.isFinite(author.level) ? author.level : 0,
    xp: typeof author.xp === "number" && Number.isFinite(author.xp) ? author.xp : 0,
    isVerified: typeof author.isVerified === "boolean" ? author.isVerified : false,
    createdAt: new Date(0).toISOString(),
    isFollowing: typeof posts?.[0]?.isFollowingAuthor === "boolean" ? posts[0].isFollowingAuthor : false,
    stats: {
      posts: posts?.length ?? 0,
      followers: 0,
      following: 0,
      totalCalls: 0,
      wins: 0,
      losses: 0,
      winRate: 0,
      totalProfitPercent: 0,
    },
  };
}

export default function UserProfile() {
  const navigate = useNavigate();
  const location = useLocation();
  const { userId } = useParams<{ userId: string }>();
  const { data: session, hasLiveSession, canPerformAuthenticatedWrites } = useSession();
  const queryClient = useQueryClient();
  const [profileTab, setProfileTab] = useState<ProfileTab>("overview");
  const [mainTab, setMainTab] = useState<MainTab>("posts");
  const [postFilter, setPostFilter] = useState<PostFilter>("all");
  const [performancePeriod, setPerformancePeriod] = useState<PerformancePeriod>("30d");
  const [showShareCard, setShowShareCard] = useState<boolean>(false);
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
    () => (userId ? `phew.user-profile:v3:${viewerCacheScope}:${userId}` : null),
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
  const cachedProfileSnapshot = useMemo(
    () => getBestCachedProfileSnapshot(queryClient, userId, cachedUserProfile?.username ?? null),
    [cachedUserProfile?.username, queryClient, userId]
  );
  const shouldRefetchUserProfileOnMount = useMemo(() => {
    if (!cachedUserProfile) {
      return true;
    }

    if (!hasSuspiciousZeroPublicProfileCounts(cachedUserProfile)) {
      return false;
    }

    return !(
      typeof cachedProfileSnapshot?.followersCount === "number" &&
      Number.isFinite(cachedProfileSnapshot.followersCount) &&
      typeof cachedProfileSnapshot?.followingCount === "number" &&
      Number.isFinite(cachedProfileSnapshot.followingCount) &&
      (cachedProfileSnapshot.followersCount > 0 || cachedProfileSnapshot.followingCount > 0)
    );
  }, [cachedProfileSnapshot, cachedUserProfile]);
  const cachedFeedPostsForProfile = useMemo(
    () => getCachedPostsForAuthor(queryClient, userId),
    [queryClient, userId]
  );
  const cachedProfileFromPosts = useMemo(
    () => buildUserProfileFromPostAuthorSnapshot(cachedFeedPostsForProfile, userId),
    [cachedFeedPostsForProfile, userId]
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
      if (!userId) {
        throw new Error("User not found");
      }
      try {
        const profile = await api.get<UserProfileData>(`/api/users/${userId}`);
        if (!cachedProfileSnapshot) {
          return profile;
        }
        return {
          ...profile,
          username: profile.username ?? cachedProfileSnapshot.username ?? null,
          image: profile.image ?? cachedProfileSnapshot.image ?? null,
          level:
            typeof profile.level === "number" && Number.isFinite(profile.level)
              ? profile.level
              : cachedProfileSnapshot.level ?? 0,
          xp:
            typeof profile.xp === "number" && Number.isFinite(profile.xp)
              ? profile.xp
              : cachedProfileSnapshot.xp ?? 0,
          isVerified:
            typeof profile.isVerified === "boolean"
              ? profile.isVerified
              : cachedProfileSnapshot.isVerified,
          createdAt: profile.createdAt ?? cachedProfileSnapshot.createdAt ?? new Date(0).toISOString(),
          stats: {
            ...profile.stats,
            posts:
              typeof profile.stats?.posts === "number" && Number.isFinite(profile.stats.posts)
                ? profile.stats.posts
                : cachedProfileSnapshot.postsCount ?? 0,
            followers:
              typeof profile.stats?.followers === "number" && Number.isFinite(profile.stats.followers)
                ? profile.stats.followers
                : cachedProfileSnapshot.followersCount ?? 0,
            following:
              typeof profile.stats?.following === "number" && Number.isFinite(profile.stats.following)
                ? profile.stats.following
                : cachedProfileSnapshot.followingCount ?? 0,
            wins:
              typeof profile.stats?.wins === "number" && Number.isFinite(profile.stats.wins)
                ? profile.stats.wins
                : cachedProfileSnapshot.winsCount ?? 0,
            losses:
              typeof profile.stats?.losses === "number" && Number.isFinite(profile.stats.losses)
                ? profile.stats.losses
                : cachedProfileSnapshot.lossesCount ?? 0,
          },
        };
      } catch (error) {
        if (!(error instanceof ApiError && error.status === 404)) {
          const fallbackProfile = buildUserProfileFromSnapshot(cachedProfileSnapshot);
          if (fallbackProfile) {
            return fallbackProfile;
          }
          if (cachedProfileFromPosts) {
            return cachedProfileFromPosts;
          }
        }
        throw error;
      }
    },
    initialData:
      cachedUserProfile
        ? {
            ...cachedUserProfile,
            stats: {
              ...cachedUserProfile.stats,
              posts:
                typeof cachedUserProfile.stats?.posts === "number" && Number.isFinite(cachedUserProfile.stats.posts)
                  ? cachedUserProfile.stats.posts
                  : cachedProfileSnapshot?.postsCount ?? 0,
              followers:
                typeof cachedUserProfile.stats?.followers === "number" && Number.isFinite(cachedUserProfile.stats.followers)
                  ? cachedUserProfile.stats.followers
                  : cachedProfileSnapshot?.followersCount ?? 0,
              following:
                typeof cachedUserProfile.stats?.following === "number" && Number.isFinite(cachedUserProfile.stats.following)
                  ? cachedUserProfile.stats.following
                  : cachedProfileSnapshot?.followingCount ?? 0,
              wins:
                typeof cachedUserProfile.stats?.wins === "number" && Number.isFinite(cachedUserProfile.stats.wins)
                  ? cachedUserProfile.stats.wins
                  : cachedProfileSnapshot?.winsCount ?? 0,
              losses:
                typeof cachedUserProfile.stats?.losses === "number" && Number.isFinite(cachedUserProfile.stats.losses)
                  ? cachedUserProfile.stats.losses
                  : cachedProfileSnapshot?.lossesCount ?? 0,
            },
          }
        : cachedProfileFromPosts ?? undefined,
    initialDataUpdatedAt: cachedUserProfile ? Date.now() : 0,
    enabled: !!userId,
    staleTime: 60000,
    gcTime: 300000,
    refetchInterval: false,
    refetchOnMount: shouldRefetchUserProfileOnMount ? "always" : false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: 0,
  });

  const isProfileMissing = userError instanceof ApiError && userError.status === 404;
  const userErrorMessage = isProfileMissing ? "User not found" : "Profile temporarily unavailable";

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
      const feedFallbackPosts = getCachedPostsForAuthor(queryClient, user?.username ?? userId);
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
        const fallbackPosts = cachedFeedPostsForProfile;
        return fallbackPosts.length > 0 ? fallbackPosts : undefined;
      })(),
    enabled: !!userId && (!!user || !!cachedUserPosts?.length || cachedFeedPostsForProfile.length > 0),
    staleTime: 60000,
    gcTime: 300000,
    refetchInterval: false,
    refetchOnMount: cachedUserPosts ? false : "always",
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: 0,
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
    retry: 0,
  });

  const { data: performanceSnapshot } = useQuery({
    queryKey: ["userProfilePerformance", userId, viewerCacheScope],
    queryFn: async () => {
      if (!userId) {
        throw new Error("User not found");
      }
      return await api.get<UserPerformanceResponse>(`/api/users/${userId}/performance`);
    },
    enabled: !!userId,
    staleTime: 60_000,
    gcTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: 0,
  });

  useEffect(() => {
    if (!user || !isUserFetched || !userProfileCacheKey) return;
    writeSessionCache(userProfileCacheKey, user);
    syncProfileSnapshotAcrossCaches(queryClient, {
      id: user.id ?? userId ?? "",
      username: user.username ?? null,
      image: user.image ?? null,
      level: user.level,
      xp: user.xp,
      isVerified: user.isVerified,
      createdAt: user.createdAt,
      followersCount: user.stats.followers,
      followingCount: user.stats.following,
      postsCount: user.stats.posts,
      winsCount: user.stats.wins,
      lossesCount: user.stats.losses,
    });
  }, [isUserFetched, queryClient, user, userId, userProfileCacheKey]);

  useEffect(() => {
    if (!user || !isUserFetched) return;
    syncFollowStateAcrossPostCaches(
      queryClient,
      {
        id: user.id ?? userId ?? "",
        username: user.username ?? null,
      },
      Boolean(user.isFollowing)
    );
  }, [isUserFetched, queryClient, user, userId]);

  useEffect(() => {
    if (!isPostsFetched || !userPostsCacheKey) return;
    writeSessionCache(userPostsCacheKey, posts);
    syncPostsIntoQueryCache(queryClient, posts);
  }, [isPostsFetched, posts, queryClient, userPostsCacheKey]);

  useEffect(() => {
    if (!isRepostsFetched || !userRepostsCacheKey) return;
    writeSessionCache(userRepostsCacheKey, reposts);
    syncPostsIntoQueryCache(queryClient, reposts);
  }, [isRepostsFetched, queryClient, reposts, userRepostsCacheKey]);

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
      syncProfileSnapshotAcrossCaches(queryClient, {
        id: user?.id ?? userId ?? "",
        username: user?.username ?? null,
        image: user?.image ?? null,
        level: user?.level,
        xp: user?.xp,
        isVerified: user?.isVerified,
        createdAt: user?.createdAt,
        followersCount: result.followerCount,
        followingCount: user?.stats.following,
        postsCount: user?.stats.posts,
        winsCount: user?.stats.wins,
        lossesCount: user?.stats.losses,
      });

      syncFollowStateAcrossPostCaches(queryClient, {
        id: user?.id ?? userId ?? "",
        username: user?.username ?? null,
      }, nextFollowing);

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
          syncFollowStateAcrossPostCaches(queryClient, {
            id: user?.id ?? userId ?? "",
            username: user?.username ?? null,
          }, nextFollowing);
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

  // Check if this is current user's profile
  const normalizedProfileIdentifier = userId?.trim().toLowerCase() ?? "";
  const isOwnProfile =
    Boolean(session?.user?.id) &&
    (session?.user?.id === user?.id ||
      session?.user?.id === userId ||
      session?.user?.username?.trim().toLowerCase() === normalizedProfileIdentifier);
  const profileDisplayName =
    user?.username?.trim() || user?.name?.trim() || normalizedProfileIdentifier || "Trader";
  const profileAvatarSeed =
    user?.id ?? user?.username ?? (normalizedProfileIdentifier || "trader");
  const performanceVm = useMemo(
    () => {
      if (performanceSnapshot) {
        return buildTraderPerformanceVmFromSnapshot({
          snapshot: performanceSnapshot,
          avatarUrl: getAvatarUrl(
            performanceSnapshot.user.id ?? profileAvatarSeed,
            performanceSnapshot.user.image
          ),
          selectedPeriod: performancePeriod,
          postsFallbackHrefBuilder: (address) => (address ? `/token/${address}` : null),
        });
      }

      return user
        ? buildTraderPerformanceVm({
            displayName: user.name ?? user.username ?? "Trader",
            handle: user.username ? `@${user.username}` : null,
            avatarUrl: getAvatarUrl(profileAvatarSeed, user.image),
            bio: null,
            followersCount: user.stats.followers,
            followingCount: user.stats.following,
            joinedAt: user.createdAt,
            recentTrades,
            postsFallbackHrefBuilder: (address) => (address ? `/token/${address}` : null),
          })
        : null;
    },
    [performancePeriod, performanceSnapshot, profileAvatarSeed, recentTrades, user]
  );
  const xpFloor = Math.floor((user?.xp ?? 0) / 1000) * 1000;
  const xpCeiling = xpFloor + 1000;
  const xpProgress = Math.max(0, Math.min(((user?.xp ?? 0) - xpFloor) / 1000, 1));
  const aiTraderScore = useMemo(() => {
    const trustScore = performanceSnapshot?.periodMetrics?.[performancePeriod]?.trustScore;
    if (typeof trustScore === "number" && Number.isFinite(trustScore)) {
      return trustScore;
    }
    const fallback = performanceSnapshot?.callMetrics?.trustScore;
    if (typeof fallback === "number" && Number.isFinite(fallback)) {
      return fallback;
    }
    return userStats.winRate;
  }, [performancePeriod, performanceSnapshot, userStats.winRate]);
  const walletOverview = performanceSnapshot?.walletOverview ?? null;
  const topCalls = useMemo(
    () => (performanceSnapshot?.recentCalls ?? []).slice(0, 4),
    [performanceSnapshot?.recentCalls]
  );
  const profileBadges = useMemo(() => {
    const badges: Array<{ label: string; tone: "xp" | "ai" | "live" | "risk" | "default" }> = [];
    if ((user?.level ?? 0) >= 20) badges.push({ label: "Legend", tone: "xp" });
    if (typeof aiTraderScore === "number" && aiTraderScore >= 80) badges.push({ label: "AI Elite", tone: "ai" });
    if ((performanceSnapshot?.periodMetrics?.[performancePeriod]?.avgRoi ?? 0) > 0) badges.push({ label: "Positive Edge", tone: "live" });
    if ((performanceSnapshot?.callMetrics?.firstCallCount ?? 0) >= 5) badges.push({ label: "First Caller", tone: "default" });
    if ((user?.stats?.followers ?? 0) >= 1000) badges.push({ label: "Signal Leader", tone: "xp" });
    if (!badges.length) badges.push({ label: "Building Track Record", tone: "default" });
    return badges.slice(0, 5);
  }, [aiTraderScore, performancePeriod, performanceSnapshot, user?.level, user?.stats?.followers]);
  const overviewMetrics = useMemo(
    () => [
      {
        label: "Followers",
        value: Intl.NumberFormat("en-US", { notation: (user?.stats?.followers ?? 0) >= 1000 ? "compact" : "standard", maximumFractionDigits: 1 }).format(user?.stats?.followers ?? 0),
        hint: "Audience reached",
        accent: <Trophy className="h-5 w-5 text-lime-300" />,
      },
      {
        label: "Calls",
        value: Intl.NumberFormat("en-US", { notation: (userStats.totalCalls ?? 0) >= 1000 ? "compact" : "standard", maximumFractionDigits: 1 }).format(userStats.totalCalls ?? 0),
        hint: "Tracked calls",
        accent: <Coins className="h-5 w-5 text-cyan-300" />,
      },
      {
        label: "Win Rate",
        value: `${(userStats.winRate ?? 0).toFixed(0)}%`,
        hint: `${winsCount} wins / ${lossesCount} losses`,
        accent: <ShieldCheck className="h-5 w-5 text-lime-300" />,
      },
      {
        label: "AI Score",
        value: `${aiTraderScore.toFixed(1)}`,
        hint: performanceSnapshot?.callMetrics?.reputationTier || "Live trader model",
        accent: <BrainCircuit className="h-5 w-5 text-cyan-300" />,
      },
    ],
    [aiTraderScore, lossesCount, performanceSnapshot?.callMetrics?.reputationTier, user?.stats?.followers, userStats.totalCalls, userStats.winRate, winsCount]
  );

  const formatJoinDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString("en-US", {
      month: "long",
      year: "numeric",
    });
  };

  return (
    <div className="space-y-5 pb-24">
      <V2PageHeader
        title={profileDisplayName || "Profile"}
        description="Trader reputation, XP progression, recent calls, and performance intelligence surfaced through the existing public profile stack."
        badge={<V2StatusPill tone="xp">{getLevelLabel(user?.level ?? 0)}</V2StatusPill>}
        onBack={() => navigate(-1)}
        action={
          user ? (
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setShowShareCard(true)}
                className="h-10 rounded-full border-white/10 bg-white/[0.04] text-white/78 hover:bg-white/[0.08] hover:text-white"
              >
                <Share2 className="mr-2 h-4 w-4" />
                Share
              </Button>
              {!isOwnProfile ? (
                <Button
                  type="button"
                  onClick={() => followMutation.mutate()}
                  disabled={followMutation.isPending}
                  className={cn(
                    "h-10 rounded-full px-4",
                    user.isFollowing
                      ? "border border-white/10 bg-white/[0.04] text-white/78 hover:bg-white/[0.08] hover:text-white"
                      : "text-slate-950"
                  )}
                  variant={user.isFollowing ? "outline" : "default"}
                >
                  {followMutation.isPending ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <PhewFollowIcon className="mr-2 h-4 w-4" />
                  )}
                  {user.isFollowing ? "Following" : "Follow"}
                </Button>
              ) : null}
            </div>
          ) : null
        }
      />

      {isLoadingUser ? (
        <div className="space-y-4">
          <Skeleton className="h-[220px] w-full rounded-[32px] bg-white/8" />
          <Skeleton className="h-[420px] w-full rounded-[32px] bg-white/8" />
          <Skeleton className="h-[320px] w-full rounded-[32px] bg-white/8" />
        </div>
      ) : userError && !user ? (
        <V2EmptyState
          icon={<AlertCircle className="h-7 w-7" />}
          title={userErrorMessage}
          description="The public profile could not be loaded from the existing user route."
          action={
            <Button onClick={() => navigate(-1)} className="rounded-full px-5">
              Go Back
            </Button>
          }
        />
      ) : user ? (
        <div className="space-y-5 animate-fade-in">
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

            <V2Surface tone="accent" className="relative overflow-hidden p-0">
              {user.bannerImage ? (
                <div className="relative h-32 border-b border-white/8 sm:h-40">
                  <div
                    className="absolute inset-0 bg-cover bg-center opacity-60"
                    style={{ backgroundImage: `url("${user.bannerImage}")` }}
                    aria-hidden="true"
                  />
                  <div
                    className="absolute inset-0 bg-[linear-gradient(180deg,rgba(1,4,9,0.18),rgba(1,4,9,0.88)),radial-gradient(circle_at_top_left,rgba(169,255,52,0.18),transparent_30%),radial-gradient(circle_at_top_right,rgba(45,212,191,0.14),transparent_30%)]"
                    aria-hidden="true"
                  />
                </div>
              ) : (
                <div
                  className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(169,255,52,0.14),transparent_28%),radial-gradient(circle_at_top_right,rgba(45,212,191,0.12),transparent_28%),linear-gradient(180deg,rgba(5,10,14,0.2),rgba(5,10,14,0.86))]"
                  aria-hidden="true"
                />
              )}

              <div className="relative space-y-6 p-5 sm:p-6 lg:p-7">
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-[24px] border border-white/8 bg-black/20 px-4 py-3">
                  <BrandLogo size="sm" />
                  <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-white/44">
                    A PHEW RUNNING THE INTERNET
                  </div>
                </div>
                <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
                  <div className="flex min-w-0 items-start gap-4">
                    <Avatar className="h-24 w-24 rounded-[28px] border border-lime-300/20 shadow-[0_24px_64px_-28px_rgba(169,255,52,0.42)]">
                      <AvatarImage src={getAvatarUrl(profileAvatarSeed, user.image)} />
                      <AvatarFallback className="bg-white/[0.04] text-3xl font-semibold text-white">
                        {profileDisplayName.charAt(0).toUpperCase() || "?"}
                      </AvatarFallback>
                    </Avatar>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <V2StatusPill tone="xp">Level {user.level}</V2StatusPill>
                        <V2StatusPill tone="ai">{aiTraderScore.toFixed(1)} AI score</V2StatusPill>
                        {user.isVerified ? <V2StatusPill tone="live">Verified</V2StatusPill> : null}
                      </div>
                      <div className="mt-4 flex flex-wrap items-end gap-3">
                        <h2 className="text-4xl font-semibold tracking-tight text-white sm:text-5xl">
                          {user.name || profileDisplayName}
                        </h2>
                        {user.username ? (
                          <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-sm text-white/56">
                            @{user.username}
                          </span>
                        ) : null}
                      </div>
                      <div className="mt-3 flex flex-wrap items-center gap-2 text-sm text-white/56">
                        <span>Joined {formatJoinDate(user.createdAt)}</span>
                        <span className="text-white/24">•</span>
                        <span>{getLevelLabel(user.level)} trader</span>
                        <span className="text-white/24">•</span>
                        <span>{user.stats.following ?? 0} following</span>
                      </div>
                      <p className="mt-4 max-w-2xl text-sm leading-6 text-white/60">
                        Building. Trading. Winning. A reputation surface driven by calls, performance, raid impact, and AI signal quality.
                      </p>
                      <div className="mt-4 flex flex-wrap gap-8 text-sm">
                        <div>
                          <div className="text-white/40">Following</div>
                          <div className="mt-1 text-2xl font-semibold text-white">{(user.stats.following ?? 0).toLocaleString()}</div>
                        </div>
                        <div>
                          <div className="text-white/40">Followers</div>
                          <div className="mt-1 text-2xl font-semibold text-white">{(user.stats.followers ?? 0).toLocaleString()}</div>
                        </div>
                        <div>
                          <div className="text-white/40">Wins</div>
                          <div className="mt-1 text-2xl font-semibold text-white">{(user.stats.wins ?? 0).toLocaleString()}</div>
                        </div>
                      </div>
                      <div className="mt-4 h-3 w-full max-w-md overflow-hidden rounded-full bg-white/8">
                        <div
                          className="h-full rounded-full bg-[linear-gradient(90deg,rgba(169,255,52,0.95),rgba(45,212,191,0.9))]"
                          style={{ width: `${Math.max(8, xpProgress * 100)}%` }}
                        />
                      </div>
                      <div className="mt-2 text-sm text-white/50">
                        {(user.xp ?? 0).toLocaleString()} XP • Next band {xpFloor.toLocaleString()} - {xpCeiling.toLocaleString()}
                      </div>
                    </div>
                  </div>

                  <div className="grid w-full gap-3 sm:grid-cols-2 lg:w-[360px]">
                    <V2Surface tone="soft" className="p-4">
                      <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-white/38">AI Trader Score</div>
                      <div className="mt-3 text-3xl font-semibold text-white">{aiTraderScore.toFixed(1)}</div>
                      <div className="mt-2 text-sm text-white/50">
                        {performanceSnapshot?.callMetrics?.reputationTier || "Live trust model"}
                      </div>
                    </V2Surface>
                    <V2Surface tone="soft" className="p-4">
                      <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-white/38">Top Calls</div>
                      <div className="mt-3 text-3xl font-semibold text-white">{topCalls.length}</div>
                      <div className="mt-2 text-sm text-white/50">
                        Recent high-signal calls tracked in performance history
                      </div>
                    </V2Surface>
                  </div>
                </div>

                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                  {overviewMetrics.map((metric) => (
                    <V2MetricCard
                      key={metric.label}
                      label={metric.label}
                      value={metric.value}
                      hint={metric.hint}
                      accent={metric.accent}
                    />
                  ))}
                </div>

                <div className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_360px]">
                  <V2Surface className="p-5" tone="soft">
                    <V2SectionHeader
                      eyebrow="Badges"
                      title="Trader identity"
                      description="Signals derived from level, followership, trust score, and first-call behavior already present in the current profile stack."
                    />
                    <div className="mt-4 flex flex-wrap gap-2">
                      {profileBadges.map((badge) => (
                        <V2StatusPill key={badge.label} tone={badge.tone}>
                          {badge.label}
                        </V2StatusPill>
                      ))}
                    </div>
                  </V2Surface>

                  <V2Surface className="p-5" tone="soft">
                    <V2SectionHeader
                      eyebrow="Top Calls"
                      title="Best recent setups"
                      description="Pulled from the existing performance snapshot rather than a new backend contract."
                    />
                    <div className="mt-4 space-y-3">
                      {topCalls.length ? topCalls.map((call) => (
                        <div key={call.id} className="rounded-[20px] border border-white/8 bg-white/[0.03] px-4 py-3">
                          <div className="flex items-center justify-between gap-3">
                            <div className="min-w-0">
                              <div className="truncate text-sm font-semibold text-white">
                                {call.tokenSymbol ? `$${call.tokenSymbol}` : call.tokenName || "Recent call"}
                              </div>
                              <div className="mt-1 truncate text-xs text-white/44">
                                {call.content || "Tracked call"} • {new Date(call.createdAt).toLocaleDateString()}
                              </div>
                            </div>
                            <div className={cn("text-sm font-semibold", call.isWin === false ? "text-rose-300" : "text-lime-300")}>
                              {call.isWin === false ? "Loss" : "Win"}
                            </div>
                          </div>
                        </div>
                      )) : (
                        <div className="rounded-[20px] border border-dashed border-white/10 px-4 py-8 text-center text-sm text-white/46">
                          No recent calls have been indexed for this profile yet.
                        </div>
                      )}
                    </div>
                  </V2Surface>
                </div>
              </div>
            </V2Surface>

            <V2TabBar
              value={profileTab}
              onChange={setProfileTab}
              items={[
                { value: "overview", label: "Overview", badge: "hero + signal map" },
                { value: "calls", label: "Calls", badge: `${filteredPosts.length} visible` },
                { value: "raids", label: "Raids", badge: "community impact" },
                { value: "portfolio", label: "Portfolio", badge: walletOverview?.connected ? "wallet linked" : "wallet pending" },
                { value: "stats", label: "Stats", badge: "AI + trust" },
              ]}
            />

            {false ? (
              <>
            {/* Profile Header */}
            <div className="-mx-4">
              {/* Banner */}
              <ProfileBanner bannerImage={user.bannerImage} />

              {/* Avatar + info — overlaps banner */}
              <div className="px-4 -mt-14 flex flex-col items-center text-center pb-2">
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
              </div>{/* end inner px-4 overlap */}
            </div>{/* end -mx-4 banner block */}

            {/* Profile Dashboard - XP, Stats, Recent Trades */}
            <ProfileDashboard
              level={user.level}
              xp={user.xp ?? 0}
              stats={userStats}
              recentTrades={recentTrades}
              isLoading={isLoadingUser}
            />

            <TraderIntelligenceCard
              handle={user.username ?? user.id ?? userId}
              enabled={isPostsFetched}
              deferMs={1500}
            />

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
              </>
            ) : null}

            {profileTab === "overview" ? (
              <div className="grid gap-4 xl:grid-cols-[minmax(0,1.35fr)_360px]">
                <div className="space-y-4">
                  {performanceVm ? (
                    <TraderPerformanceView
                      vm={performanceVm}
                      heroTabs={[
                        { key: "24h", label: "24h", active: performancePeriod === "24h", onSelect: () => setPerformancePeriod("24h") },
                        { key: "7d", label: "7d", active: performancePeriod === "7d", onSelect: () => setPerformancePeriod("7d") },
                        { key: "30d", label: "30d", active: performancePeriod === "30d", onSelect: () => setPerformancePeriod("30d") },
                        { key: "all", label: "All", active: performancePeriod === "all", onSelect: () => setPerformancePeriod("all") },
                      ]}
                    />
                  ) : null}
                </div>
                <div className="space-y-4">
                  <V2Surface className="p-5" tone="soft">
                    <V2SectionHeader
                      eyebrow="Signal Stack"
                      title="Why this trader ranks"
                      description="Trust, followers, XP progression, and first-call behavior shape how this trader appears across the product."
                    />
                    <div className="mt-4 grid gap-3">
                      <div className="rounded-[20px] border border-white/8 bg-white/[0.03] px-4 py-3">
                        <div className="text-[11px] uppercase tracking-[0.18em] text-white/38">Followers</div>
                        <div className="mt-2 text-2xl font-semibold text-white">{user.stats.followers ?? 0}</div>
                      </div>
                      <div className="rounded-[20px] border border-white/8 bg-white/[0.03] px-4 py-3">
                        <div className="text-[11px] uppercase tracking-[0.18em] text-white/38">Total Profit</div>
                        <div className={cn("mt-2 text-2xl font-semibold", userStats.totalProfitPercent >= 0 ? "text-lime-300" : "text-rose-300")}>
                          {userStats.totalProfitPercent >= 0 ? "+" : ""}{userStats.totalProfitPercent.toFixed(1)}%
                        </div>
                      </div>
                    </div>
                  </V2Surface>

                  <TraderIntelligenceCard
                    handle={user.username ?? user.id ?? userId}
                    enabled={isPostsFetched}
                    deferMs={1500}
                  />
                </div>
              </div>
            ) : null}

            {profileTab === "calls" ? (
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
            ) : null}

            {profileTab === "raids" ? (
              <div className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_360px]">
                <V2Surface className="p-5 sm:p-6">
                  <V2SectionHeader
                    eyebrow="Raid Footprint"
                    title="Cross-community impact"
                    description="A dedicated public raid-history endpoint does not exist yet, so this section stays truthful and derives visible contribution from current profile and performance data."
                  />
                  <div className="mt-5 grid gap-3 md:grid-cols-3">
                    <V2MetricCard label="Followers" value={user.stats.followers ?? 0} hint="Potential amplification reach" />
                    <V2MetricCard label="Reposts" value={reposts.length} hint="Visible social amplification" />
                    <V2MetricCard label="First Calls" value={performanceSnapshot?.callMetrics?.firstCallCount ?? 0} hint="Early participation proxy" />
                  </div>
                  <div className="mt-5 rounded-[24px] border border-white/8 bg-white/[0.03] p-5 text-sm leading-6 text-white/58">
                    This trader already has measurable reach, trust, and first-caller behavior. When a dedicated raid-history aggregate is added, it can plug into this surface without changing the current profile contracts.
                  </div>
                </V2Surface>
                <V2Surface className="p-5" tone="soft">
                  <V2SectionHeader
                    eyebrow="Status"
                    title="Raid readiness"
                    description="Current scorecards that would matter in coordinated X pushes."
                  />
                  <div className="mt-4 space-y-3">
                    {profileBadges.map((badge) => (
                      <div key={`raid-${badge.label}`} className="rounded-[20px] border border-white/8 bg-white/[0.03] px-4 py-3 text-sm text-white/70">
                        {badge.label}
                      </div>
                    ))}
                  </div>
                </V2Surface>
              </div>
            ) : null}

            {profileTab === "portfolio" ? (
              <div className="grid gap-4 xl:grid-cols-[minmax(0,1.25fr)_360px]">
                <V2Surface className="p-5 sm:p-6">
                  <V2SectionHeader
                    eyebrow="Portfolio"
                    title="Wallet-linked view"
                    description="This reuses the existing performance snapshot wallet overview when present."
                  />
                  {walletOverview?.connected ? (
                    <div className="mt-5 space-y-4">
                      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                        <V2MetricCard label="Wallet" value={walletOverview.address ? `${walletOverview.address.slice(0, 4)}...${walletOverview.address.slice(-4)}` : "Connected"} hint="Connected account" accent={<Wallet className="h-5 w-5 text-lime-300" />} />
                        <V2MetricCard label="Balance" value={`$${(walletOverview.balanceUsd ?? 0).toLocaleString()}`} hint={`${walletOverview.balanceSol ?? 0} SOL`} />
                        <V2MetricCard label="PHEW" value={(walletOverview.platformCoinHoldings ?? 0).toLocaleString()} hint="Platform holdings" />
                        <V2MetricCard label="PnL" value={`$${(walletOverview.totalProfitUsd ?? 0).toLocaleString()}`} hint="Realized + unrealized" />
                      </div>
                      <div className="space-y-3">
                        {(walletOverview.tokenPositions ?? []).slice(0, 6).map((position) => (
                          <div key={position.mint} className="flex items-center justify-between gap-4 rounded-[22px] border border-white/8 bg-white/[0.03] px-4 py-4">
                            <div>
                              <div className="text-sm font-semibold text-white">
                                {position.tokenSymbol ? `$${position.tokenSymbol}` : position.tokenName || "Position"}
                              </div>
                              <div className="mt-1 text-xs text-white/44">
                                {(position.holdingAmount ?? 0).toLocaleString()} tokens
                              </div>
                            </div>
                            <div className="text-right">
                              <div className="text-sm font-semibold text-white">${(position.holdingUsd ?? 0).toLocaleString()}</div>
                              <div className={cn("mt-1 text-xs", (position.totalPnlUsd ?? 0) >= 0 ? "text-lime-300" : "text-rose-300")}>
                                {(position.totalPnlUsd ?? 0) >= 0 ? "+" : ""}${(position.totalPnlUsd ?? 0).toLocaleString()}
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <V2EmptyState
                      icon={<Wallet className="h-7 w-7" />}
                      title="No wallet snapshot"
                      description="This public profile does not currently expose a connected wallet portfolio in the performance snapshot."
                    />
                  )}
                </V2Surface>
                <V2Surface className="p-5" tone="soft">
                  <V2SectionHeader
                    eyebrow="Flow"
                    title="Capital profile"
                    description="Current buy, sell, and balance context derived from the existing wallet overview."
                  />
                  <div className="mt-4 grid gap-3">
                    <div className="rounded-[20px] border border-white/8 bg-white/[0.03] px-4 py-3 text-sm text-white/70">
                      Bought: ${(walletOverview?.totalVolumeBoughtUsd ?? 0).toLocaleString()}
                    </div>
                    <div className="rounded-[20px] border border-white/8 bg-white/[0.03] px-4 py-3 text-sm text-white/70">
                      Sold: ${(walletOverview?.totalVolumeSoldUsd ?? 0).toLocaleString()}
                    </div>
                    <div className="rounded-[20px] border border-white/8 bg-white/[0.03] px-4 py-3 text-sm text-white/70">
                      USDC: ${(walletOverview?.balanceUsdc ?? 0).toLocaleString()}
                    </div>
                  </div>
                </V2Surface>
              </div>
            ) : null}

            {profileTab === "stats" ? (
              <div className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_360px]">
                <TraderIntelligenceCard
                  handle={user.username ?? user.id ?? userId}
                  enabled={isPostsFetched}
                  deferMs={1500}
                />
                <V2Surface className="p-5" tone="soft">
                  <V2SectionHeader
                    eyebrow="Core Stats"
                    title="Public profile metrics"
                    description="Straight from the existing public profile and performance snapshot."
                  />
                  <div className="mt-4 grid gap-3">
                    <div className="rounded-[20px] border border-white/8 bg-white/[0.03] px-4 py-3 text-sm text-white/70">
                      Followers: {user.stats.followers ?? 0}
                    </div>
                    <div className="rounded-[20px] border border-white/8 bg-white/[0.03] px-4 py-3 text-sm text-white/70">
                      Following: {user.stats.following ?? 0}
                    </div>
                    <div className="rounded-[20px] border border-white/8 bg-white/[0.03] px-4 py-3 text-sm text-white/70">
                      Calls: {performanceSnapshot?.periodMetrics?.[performancePeriod]?.callsCount ?? userStats.totalCalls}
                    </div>
                    <div className="rounded-[20px] border border-white/8 bg-white/[0.03] px-4 py-3 text-sm text-white/70">
                      Avg ROI: {(performanceSnapshot?.periodMetrics?.[performancePeriod]?.avgRoi ?? 0).toFixed(1)}%
                    </div>
                  </div>
                </V2Surface>
              </div>
            ) : null}
          </div>
        ) : null}

      {/* Share Profile Card Dialog */}
      {user && (
        <ShareableProfileCard
          open={showShareCard}
          onOpenChange={setShowShareCard}
          user={{
            id: user.id ?? userId ?? "",
            username: user.username,
            name: user.name,
            image: user.image,
            level: user.level,
            xp: user.xp,
            isVerified: user.isVerified,
            bannerImage: user.bannerImage,
            stats: {
              wins: user.stats.wins,
              losses: user.stats.losses,
              winRate: user.stats.winRate,
              totalCalls: user.stats.totalCalls,
            },
          }}
        />
      )}
    </div>
  );
}
