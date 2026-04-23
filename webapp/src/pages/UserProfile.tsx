import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import {
  useQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import { useSession } from "@/lib/auth-client";
import { api, ApiError } from "@/lib/api";
import { Post, calculatePercentChange, getAvatarUrl, LIQUIDATION_LEVEL, type ProfileHubResponse } from "@/types";
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
import { ProfileUnifiedSurface } from "@/components/profile/ProfileUnifiedSurface";
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

  const profileHubIdentifier = user?.username ?? user?.id ?? userId ?? null;
  const { data: profileHubPayload } = useQuery({
    queryKey: ["userProfile", "hub", profileHubIdentifier ?? "anonymous"],
    queryFn: async () => {
      if (!profileHubIdentifier) {
        throw new Error("Profile identifier is required");
      }
      return await api.get<ProfileHubResponse>(`/api/users/${profileHubIdentifier}/profile-hub`);
    },
    enabled: !!profileHubIdentifier,
    staleTime: 60_000,
    gcTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: 0,
  });

  const profileHub = useMemo<ProfileHubResponse | null>(() => {
    if (profileHubPayload) {
      return profileHubPayload;
    }
    if (!user) {
      return null;
    }
    return {
      hero: {
        id: user.id ?? userId ?? "",
        name: user.name ?? null,
        username: user.username,
        image: user.image,
        bannerImage: user.bannerImage ?? null,
        createdAt: user.createdAt,
        isVerified: Boolean(user.isVerified),
        isFollowing: Boolean(user.isFollowing),
        level: user.level,
        xp: user.xp,
        bio: null,
        followersCount: user.stats.followers ?? 0,
        followingCount: user.stats.following ?? 0,
        earnedPoints: user.xp,
      },
      xp: {
        level: user.level,
        xp: user.xp,
        nextLevelXp: xpCeiling,
        progressPct: xpProgress * 100,
      },
      aiScore: {
        score: Number.isFinite(aiTraderScore) ? aiTraderScore : null,
        label: performanceSnapshot?.callMetrics?.reputationTier ?? "developing",
        percentile: aiTraderScore >= 80 ? "Top 10%" : null,
      },
      topCalls: topCalls.map((call) => ({
        id: call.id,
        ticker: call.tokenSymbol ?? null,
        title: call.content || call.tokenName || call.tokenSymbol,
        roiCurrentPct: call.currentMcap && call.entryMcap ? ((call.currentMcap - call.entryMcap) / call.entryMcap) * 100 : null,
        roiPeakPct: null,
        createdAt: call.createdAt,
      })),
      raidImpact: {
        raidsJoined: 0,
        raidsWon: 0,
        boostCount: 0,
        contributionScore: 0,
      },
      badges: profileBadges.map((badge, index) => ({
        id: `${badge.label}-${index}`,
        label: badge.label,
        tone: badge.tone,
      })),
      reputationMetrics: [
        { label: "Followers", value: `${user.stats.followers ?? 0}` },
        { label: "Calls", value: `${userStats.totalCalls}` },
        { label: "Win Rate", value: `${(userStats.winRate ?? 0).toFixed(0)}%` },
        { label: "AI Score", value: aiTraderScore.toFixed(1) },
      ],
      portfolioSnapshot: walletOverview
        ? {
            connected: Boolean(walletOverview.connected),
            address: walletOverview.address ?? null,
            balanceUsd: walletOverview.balanceUsd ?? null,
            balanceSol: walletOverview.balanceSol ?? null,
            tokenPositions: (walletOverview.tokenPositions ?? []).map((position) => ({
              mint: position.mint,
              tokenSymbol: position.tokenSymbol ?? null,
              tokenName: position.tokenName ?? null,
              holdingAmount: position.holdingAmount ?? null,
              holdingUsd: position.holdingUsd ?? null,
              totalPnlUsd: position.totalPnlUsd ?? null,
            })),
          }
        : {
            connected: false,
            address: null,
            balanceUsd: null,
            balanceSol: null,
            tokenPositions: [],
          },
      performanceSummary: {
        winRate: userStats.winRate,
        totalCalls: userStats.totalCalls,
        totalProfitPercent: userStats.totalProfitPercent,
      },
      raidHistory: [],
    };
  }, [aiTraderScore, profileBadges, profileHubPayload, topCalls, user, userId, userStats, walletOverview, xpCeiling, xpProgress, performanceSnapshot?.callMetrics?.reputationTier]);

  const profileCallsContent = (
    <div className="space-y-4">
      <Tabs value={mainTab} onValueChange={(v) => setMainTab(v as MainTab)} className="w-full">
        <TabsList className="grid h-12 w-full grid-cols-2 rounded-[22px] border border-white/8 bg-[#090d15] p-1">
          <TabsTrigger value="posts" className="rounded-[18px] data-[state=active]:bg-lime-300/14 data-[state=active]:text-white">
            Posts
          </TabsTrigger>
          <TabsTrigger value="reposts" className="rounded-[18px] gap-1.5 data-[state=active]:bg-lime-300/14 data-[state=active]:text-white">
            <PhewRepostIcon className="h-3.5 w-3.5" />
            Reposts
          </TabsTrigger>
        </TabsList>

        <TabsContent value="posts" className="mt-4">
          <Tabs value={postFilter} onValueChange={(v) => setPostFilter(v as PostFilter)} className="w-full">
            <TabsList className="grid h-11 w-full grid-cols-3 rounded-[20px] border border-white/8 bg-[#090d15] p-1">
              <TabsTrigger value="all" className="rounded-[16px] data-[state=active]:bg-white/[0.08] data-[state=active]:text-white">All</TabsTrigger>
              <TabsTrigger value="wins" className="rounded-[16px] gap-1.5 data-[state=active]:bg-white/[0.08] data-[state=active]:text-white">
                <TrendingUp className="h-3.5 w-3.5" />
                Wins
              </TabsTrigger>
              <TabsTrigger value="losses" className="rounded-[16px] gap-1.5 data-[state=active]:bg-white/[0.08] data-[state=active]:text-white">
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
                <div className="rounded-[28px] border border-dashed border-white/12 bg-white/[0.02] px-6 py-14 text-center">
                  <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-white/[0.04]">
                    <Sparkles className="h-8 w-8 text-white/42" />
                  </div>
                  <p className="mt-4 text-lg font-semibold text-white">
                    {postFilter === "all" ? "No posts yet" : postFilter === "wins" ? "No wins yet" : "No losses yet"}
                  </p>
                  <p className="mt-2 text-sm text-white/48">
                    {postFilter === "all" ? "This trader has not posted any alpha calls yet." : "Check back after more calls settle."}
                  </p>
                </div>
              ) : (
                <WindowVirtualList
                  items={filteredPosts}
                  getItemKey={(post) => post.id}
                  estimateItemHeight={560}
                  overscanPx={1200}
                  renderItem={(post, index) => (
                    <div className={index < filteredPosts.length - 1 ? "pb-4" : undefined}>
                      <div className="animate-fade-in-up" style={{ animationDelay: `${Math.min(index, 8) * 0.05}s` }}>
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

        <TabsContent value="reposts" className="mt-4">
          {isLoadingReposts ? (
            <>
              {[0, 1, 2].map((i) => (
                <PostCardSkeleton key={i} showMarketData={i < 2} />
              ))}
            </>
          ) : reposts.length === 0 ? (
            <div className="rounded-[28px] border border-dashed border-white/12 bg-white/[0.02] px-6 py-14 text-center">
              <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-white/[0.04]">
                <PhewRepostIcon className="h-8 w-8 text-white/42" />
              </div>
              <p className="mt-4 text-lg font-semibold text-white">No reposts yet</p>
              <p className="mt-2 text-sm text-white/48">This trader has not amplified any calls yet.</p>
            </div>
          ) : (
            <WindowVirtualList
              items={reposts}
              getItemKey={(post) => post.id}
              estimateItemHeight={560}
              overscanPx={1200}
              renderItem={(post, index) => (
                <div className={index < reposts.length - 1 ? "pb-4" : undefined}>
                  <div className="animate-fade-in-up" style={{ animationDelay: `${Math.min(index, 8) * 0.05}s` }}>
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
  );

  return (
    <div className="space-y-5 pb-24">
      {isLoadingUser ? (
        <div className="space-y-4">
          <Skeleton className="h-[220px] w-full rounded-[32px] bg-white/8" />
          <Skeleton className="h-[420px] w-full rounded-[32px] bg-white/8" />
          <Skeleton className="h-[320px] w-full rounded-[32px] bg-white/8" />
        </div>
      ) : userError && !user ? (
        <div className="rounded-[30px] border border-dashed border-white/12 px-6 py-16 text-center">
          <div className="mx-auto max-w-lg">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full border border-white/10 bg-white/[0.04] text-white/70">
              <AlertCircle className="h-6 w-6" />
            </div>
            <h2 className="mt-5 text-2xl font-semibold text-white">{userErrorMessage}</h2>
            <p className="mt-3 text-sm leading-6 text-white/54">
              The public trader surface could not be loaded from the live profile routes.
            </p>
            <div className="mt-6 flex justify-center gap-3">
              <Button onClick={() => navigate(-1)} className="rounded-full px-5">
                Go Back
              </Button>
            </div>
          </div>
        </div>
      ) : user ? (
        <div className="space-y-5 animate-fade-in">
          {(user.level <= LIQUIDATION_LEVEL || isInDangerZone(user.level)) && (
            <div
              className={cn(
                "flex items-center gap-3 rounded-xl border p-4",
                user.level <= LIQUIDATION_LEVEL
                  ? "border-red-600 bg-red-600/20 text-red-500"
                  : "border-red-400 bg-red-500/10 text-red-300"
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
                <p className="mt-0.5 text-xs opacity-80">{getDangerMessage(user.level)}</p>
              </div>
            </div>
          )}

          {profileHub ? (
            <ProfileUnifiedSurface
              hub={profileHub}
              isOwnProfile={isOwnProfile}
              profileTab={profileTab}
              onProfileTabChange={(tab) => setProfileTab(tab as ProfileTab)}
              performanceVm={performanceVm}
              performanceTabs={[
                { key: "24h", label: "24h", active: performancePeriod === "24h", onSelect: () => setPerformancePeriod("24h") },
                { key: "7d", label: "7d", active: performancePeriod === "7d", onSelect: () => setPerformancePeriod("7d") },
                { key: "30d", label: "30d", active: performancePeriod === "30d", onSelect: () => setPerformancePeriod("30d") },
                { key: "all", label: "All", active: performancePeriod === "all", onSelect: () => setPerformancePeriod("all") },
              ]}
              heroActions={
                <div className="flex flex-wrap justify-end gap-2">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => navigate(-1)}
                    className="rounded-2xl border border-white/10 bg-white/[0.04] text-white/72 hover:bg-white/[0.08] hover:text-white"
                  >
                    <ArrowLeft className="h-4 w-4" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => setShowShareCard(true)}
                    className="rounded-2xl border border-white/10 bg-white/[0.04] text-white/72 hover:bg-white/[0.08] hover:text-white"
                  >
                    <Share2 className="h-4 w-4" />
                  </Button>
                  {!isOwnProfile ? (
                    <>
                      <Button
                        type="button"
                        onClick={() => followMutation.mutate()}
                        disabled={followMutation.isPending}
                        className={cn(
                          "rounded-2xl px-4",
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
                      <ReportDialog
                        targetType="user"
                        targetId={user.id ?? userId ?? ""}
                        targetLabel={profileDisplayName || user.username || user.id || "Trader"}
                        buttonLabel="Report"
                        buttonClassName="rounded-2xl border-white/10 bg-white/[0.04] px-4 text-white/72 hover:bg-white/[0.08] hover:text-white"
                      />
                    </>
                  ) : null}
                </div>
              }
              callsContent={profileCallsContent}
              statsAside={
                <TraderIntelligenceCard
                  handle={user.username ?? user.id ?? userId}
                  enabled={isPostsFetched}
                  deferMs={1500}
                />
              }
            />
          ) : null}

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
        </div>
      ) : null}
    </div>
  );
}

