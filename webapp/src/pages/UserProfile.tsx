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

type PostFilter = "all" | "wins" | "losses";
type MainTab = "posts" | "reposts";
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
  const [mainTab, setMainTab] = useState<MainTab>("posts");
  const [postFilter, setPostFilter] = useState<PostFilter>("all");
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
    (session?.user?.id === user?.id ||
      session?.user?.id === userId ||
      session?.user?.username?.trim().toLowerCase() === normalizedProfileIdentifier);
  const profileDisplayName =
    user?.username?.trim() || user?.name?.trim() || normalizedProfileIdentifier || "Trader";
  const profileAvatarSeed =
    user?.id ?? user?.username ?? (normalizedProfileIdentifier || "trader");

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
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowShareCard(true)}
                className="h-8 px-3 gap-1.5"
              >
                <Share2 className="h-3.5 w-3.5" />
                Share
              </Button>
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
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => navigate("/profile")}
                disabled={!hasLiveSession}
                className="h-8 px-3"
              >
                Edit Profile
              </Button>
              {user && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowShareCard(true)}
                  className="h-8 px-3 gap-1.5"
                >
                  <Share2 className="h-3.5 w-3.5" />
                  Share
                </Button>
              )}
            </div>
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
        ) : userError && !user ? (
          <div className="app-empty-state">
            <div className="w-16 h-16 rounded-full bg-destructive/10 flex items-center justify-center">
              <AlertCircle className="h-8 w-8 text-destructive" />
            </div>
            <p className="text-muted-foreground">{userErrorMessage}</p>
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
              {/* Banner */}
              <div className="w-full -mx-0 mb-4 rounded-xl overflow-hidden">
                <ProfileBanner bannerImage={user.bannerImage} />
              </div>

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
