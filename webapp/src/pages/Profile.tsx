import { useState, useRef, useMemo, useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useWallet } from "@solana/wallet-adapter-react";
import { useSession, useAuth, updateCachedAuthUser } from "@/lib/auth-client";
import { api, ApiError } from "@/lib/api";
import { User, Post, getAvatarUrl, calculatePercentChange, LIQUIDATION_LEVEL } from "@/types";
import { LevelBadge, LevelBar } from "@/components/feed/LevelBar";
import { getLevelLabel, isInDangerZone, getDangerMessage } from "@/lib/level-utils";
import { PostCard } from "@/components/feed/PostCard";
import { PostCardSkeleton } from "@/components/feed/PostCardSkeleton";
import { ProfileDashboard, UserStats, RecentTrade, WalletData } from "@/components/profile/ProfileDashboard";
import { TraderIntelligenceCard } from "@/components/profile/TraderIntelligenceCard";
import { WalletConnection } from "@/components/profile/WalletConnection";
import { WindowVirtualList } from "@/components/virtual/WindowVirtualList";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  ArrowLeft,
  Camera,
  Calendar,
  Wallet,
  Mail,
  TrendingUp,
  TrendingDown,
  Check,
  X,
  Loader2,
  Sparkles,
  Repeat2,
  AlertTriangle,
  Skull,
  ZoomIn,
  Move,
  RotateCcw,
} from "lucide-react";
import { VerifiedBadge } from "@/components/VerifiedBadge";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { readSessionCache, writeSessionCache } from "@/lib/session-cache";
import {
  buildProfilePath,
  getProfileHandleValidationMessage,
  normalizeProfileHandleInput,
} from "@/lib/profile-path";
import { getCachedPostsForAuthor, syncPostsIntoQueryCache } from "@/lib/post-query-cache";
import {
  getBestCachedProfileSnapshot,
  mergeProfileSnapshotIntoExtendedUser,
  syncProfileSnapshotAcrossCaches,
} from "@/lib/profile-cache";
import { PhewEditIcon } from "@/components/icons/PhewIcons";
import { LivePortfolioDialog } from "@/components/account/LivePortfolioDialog";
import { MyInvitesSection } from "@/components/profile/MyInvitesSection";
import { ProfileBanner } from "@/components/profile/ProfileBanner";
import { BannerPicker } from "@/components/profile/BannerPicker";
import { ShareableProfileCard } from "@/components/profile/ShareableProfileCard";
import { Share2, ImageIcon } from "lucide-react";
import { TraderPerformanceView } from "@/components/experience/TraderPerformanceView";
import { buildTraderPerformanceVm } from "@/viewmodels/trader-performance";

interface ExtendedUser extends User {
  followersCount?: number;
  followingCount?: number;
  postsCount?: number;
  winsCount?: number;
  lossesCount?: number;
}

type UserProfileCountersPayload = {
  stats?: {
    posts?: number;
    followers?: number;
    following?: number;
    wins?: number;
    losses?: number;
  };
};

type PostFilter = "all" | "wins" | "losses";
type MainTab = "posts" | "reposts";
type ProfileViewTab = "profile" | "settings";
const PROFILE_ME_CACHE_TTL_MS = 60_000;
const PROFILE_POSTS_CACHE_TTL_MS = 45_000;
const PROFILE_WALLET_CACHE_TTL_MS = 60_000;

const AVATAR_CROP_BOX_SIZE = 280;
const AVATAR_CROP_OUTPUT_SIZE = 512;

type CropOffset = { x: number; y: number };
type CropImageMeta = { width: number; height: number };

interface FeeSettingsData {
  tradeFeeRewardsEnabled: boolean;
  tradeFeeShareBps: number;
  tradeFeePayoutAddress: string | null;
  effectivePayoutAddress: string | null;
  platformFeeBps: number;
  platformFeeAccountConfigured: boolean;
}

interface FeeEarningsData {
  totalTrades: number;
  totalPosterShareAtomic: string;
  byMint: Array<{
    mint: string;
    totalAtomic: string;
    count: number;
  }>;
  recentEvents: Array<{
    id: string;
    postId: string;
    feeMint: string;
    tradeSide: string;
    platformFeeAmountAtomic: string;
    posterShareAmountAtomic: string;
    txSignature: string;
    traderWalletAddress: string;
    createdAt: string;
  }>;
}

function hasFiniteCount(value: number | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function hasCompleteProfileCounters(user: ExtendedUser | null | undefined): boolean {
  if (!user) return false;

  return [
    user.followersCount,
    user.followingCount,
    user.postsCount,
    user.winsCount,
    user.lossesCount,
  ].every(hasFiniteCount);
}

function hasOnlyZeroProfileCounters(user: ExtendedUser | null | undefined): boolean {
  if (!user || !hasCompleteProfileCounters(user)) {
    return false;
  }

  return (
    user.followersCount === 0 &&
    user.followingCount === 0 &&
    user.postsCount === 0 &&
    user.winsCount === 0 &&
    user.lossesCount === 0
  );
}

function hasSuspiciousZeroSocialCounts(user: ExtendedUser | null | undefined): boolean {
  if (!user) {
    return true;
  }

  if (!hasFiniteCount(user.followersCount) || !hasFiniteCount(user.followingCount)) {
    return true;
  }

  return user.followersCount === 0 && user.followingCount === 0;
}

function mergeProfileCounters(
  user: ExtendedUser,
  profile: UserProfileCountersPayload | null | undefined
): ExtendedUser {
  const stats = profile?.stats;

  return {
    ...user,
    followersCount: hasFiniteCount(stats?.followers) ? stats.followers : user.followersCount,
    followingCount: hasFiniteCount(stats?.following) ? stats.following : user.followingCount,
    postsCount: hasFiniteCount(stats?.posts) ? stats.posts : user.postsCount,
    winsCount: hasFiniteCount(stats?.wins) ? stats.wins : user.winsCount,
    lossesCount: hasFiniteCount(stats?.losses) ? stats.losses : user.lossesCount,
  };
}

function mergeDerivedPostCounters(
  user: ExtendedUser,
  posts: Post[] | null | undefined
): ExtendedUser {
  if (!posts?.length) {
    return user;
  }

  const settledPosts = posts.filter((post) => post.settled);
  const winsCount = settledPosts.filter((post) => post.isWin).length;
  const lossesCount = settledPosts.filter((post) => post.isWin === false).length;

  return {
    ...user,
    postsCount:
      hasFiniteCount(user.postsCount) && user.postsCount > 0
        ? user.postsCount
        : posts.length,
    winsCount:
      hasFiniteCount(user.winsCount) && user.winsCount > 0
        ? user.winsCount
        : winsCount,
    lossesCount:
      hasFiniteCount(user.lossesCount) && user.lossesCount > 0
        ? user.lossesCount
        : lossesCount,
  };
}

function clampCropOffset(offset: CropOffset, image: CropImageMeta, scale: number): CropOffset {
  const scaledWidth = image.width * scale;
  const scaledHeight = image.height * scale;
  const maxX = Math.max(0, (scaledWidth - AVATAR_CROP_BOX_SIZE) / 2);
  const maxY = Math.max(0, (scaledHeight - AVATAR_CROP_BOX_SIZE) / 2);

  return {
    x: Math.min(maxX, Math.max(-maxX, offset.x)),
    y: Math.min(maxY, Math.max(-maxY, offset.y)),
  };
}

export default function Profile() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [isPortfolioOpen, setIsPortfolioOpen] = useState(false);
  const queryClient = useQueryClient();
  const { data: session } = useSession();
  const { signOut, hasLiveSession } = useAuth();
  const { publicKey: connectedWalletPublicKey } = useWallet();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cropDragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
  } | null>(null);
  const cropPreviewImgRef = useRef<HTMLImageElement>(null);

  const [isEditing, setIsEditing] = useState(false);
  const [mainTab, setMainTab] = useState<MainTab>("posts");
  const [postFilter, setPostFilter] = useState<PostFilter>("all");
  const [enableWalletOverviewQuery, setEnableWalletOverviewQuery] = useState(false);
  const [enableFeeEarningsQuery, setEnableFeeEarningsQuery] = useState(false);
  const profileViewTab: ProfileViewTab = searchParams.get("tab") === "settings" ? "settings" : "profile";
  const [feeRewardsEnabled, setFeeRewardsEnabled] = useState(true);
  const [feeSharePercentInput, setFeeSharePercentInput] = useState("1.00");
  const [feePayoutAddressInput, setFeePayoutAddressInput] = useState("");

  // Edit form state
  const [editUsername, setEditUsername] = useState("");
  const [editBio, setEditBio] = useState("");
  const [editBannerImage, setEditBannerImage] = useState<string | null>(null);
  const [isBannerPickerOpen, setIsBannerPickerOpen] = useState(false);
  const [isShareCardOpen, setIsShareCardOpen] = useState(false);
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [isCropDialogOpen, setIsCropDialogOpen] = useState(false);
  const [cropSourceImage, setCropSourceImage] = useState<string | null>(null);
  const [cropImageMeta, setCropImageMeta] = useState<CropImageMeta | null>(null);
  const [cropZoom, setCropZoom] = useState(1);
  const [cropOffset, setCropOffset] = useState<CropOffset>({ x: 0, y: 0 });
  const [isApplyingCrop, setIsApplyingCrop] = useState(false);

  const cropBaseScale = useMemo(() => {
    if (!cropImageMeta) return 1;
    return Math.max(
      AVATAR_CROP_BOX_SIZE / cropImageMeta.width,
      AVATAR_CROP_BOX_SIZE / cropImageMeta.height
    );
  }, [cropImageMeta]);

  const cropRenderScale = cropBaseScale * cropZoom;

  const meProfileCacheKey = session?.user?.id ? `phew.profile.me:${session.user.id}` : null;
  const profileMeQueryKey = useMemo(
    () => ["profile", "me", session?.user?.id ?? "anonymous"] as const,
    [session?.user?.id]
  );
  const cachedProfileBySession = useMemo(
    () => (meProfileCacheKey ? readSessionCache<ExtendedUser>(meProfileCacheKey, PROFILE_ME_CACHE_TTL_MS) : null),
    [meProfileCacheKey]
  );
  const cachedProfileSnapshot = useMemo(
    () =>
      getBestCachedProfileSnapshot(
        queryClient,
        session?.user?.id ?? cachedProfileBySession?.id ?? null,
        session?.user?.username ?? cachedProfileBySession?.username ?? null
      ),
    [
      cachedProfileBySession?.id,
      cachedProfileBySession?.username,
      queryClient,
      session?.user?.id,
      session?.user?.username,
    ]
  );
  const profilePostFallbackIdentifier =
    session?.user?.id ??
    cachedProfileBySession?.id ??
    cachedProfileSnapshot?.id ??
    session?.user?.username ??
    cachedProfileBySession?.username ??
    cachedProfileSnapshot?.username ??
    null;
  const feedFallbackPosts = useMemo(
    () => getCachedPostsForAuthor(queryClient, profilePostFallbackIdentifier),
    [profilePostFallbackIdentifier, queryClient]
  );
  const cachedPosts = useMemo(
    () =>
      session?.user?.id
        ? readSessionCache<Post[]>(`phew.profile.posts:${session.user.id}`, PROFILE_POSTS_CACHE_TTL_MS)
        : null,
    [session?.user?.id]
  );
  const cachedReposts = useMemo(
    () =>
      session?.user?.id
        ? readSessionCache<Post[]>(`phew.profile.reposts:${session.user.id}`, PROFILE_POSTS_CACHE_TTL_MS)
        : null,
    [session?.user?.id]
  );
  const cachedWalletOverview = useMemo(
    () =>
      session?.user?.id
        ? readSessionCache<WalletData>(`phew.profile.wallet:${session.user.id}`, PROFILE_WALLET_CACHE_TTL_MS)
        : null,
    [session?.user?.id]
  );
  const derivedCachedProfilePosts = useMemo(
    () =>
      cachedPosts && cachedPosts.length > 0
        ? cachedPosts
        : feedFallbackPosts.length > 0
          ? feedFallbackPosts
          : null,
    [cachedPosts, feedFallbackPosts]
  );
  const sessionBackedProfile = useMemo<ExtendedUser | null>(() => {
    if (!session?.user) return cachedProfileBySession;
    const baseProfile: ExtendedUser = {
      ...(cachedProfileBySession ?? {}),
      id: session.user.id,
      name: session.user.name,
      email: session.user.email,
      image: session.user.image ?? cachedProfileBySession?.image ?? null,
      walletAddress: session.user.walletAddress ?? cachedProfileBySession?.walletAddress ?? null,
      username: session.user.username ?? cachedProfileBySession?.username ?? null,
      level: session.user.level ?? cachedProfileBySession?.level ?? 0,
      xp: session.user.xp ?? cachedProfileBySession?.xp ?? 0,
      bio: session.user.bio ?? cachedProfileBySession?.bio ?? null,
      isAdmin: session.user.isAdmin ?? cachedProfileBySession?.isAdmin ?? false,
      isVerified: session.user.isVerified ?? cachedProfileBySession?.isVerified,
      tradeFeeRewardsEnabled:
        session.user.tradeFeeRewardsEnabled ?? cachedProfileBySession?.tradeFeeRewardsEnabled,
      tradeFeeShareBps: session.user.tradeFeeShareBps ?? cachedProfileBySession?.tradeFeeShareBps,
      tradeFeePayoutAddress:
        session.user.tradeFeePayoutAddress ?? cachedProfileBySession?.tradeFeePayoutAddress ?? null,
      createdAt: session.user.createdAt ?? cachedProfileBySession?.createdAt ?? new Date(0).toISOString(),
      followersCount: cachedProfileBySession?.followersCount,
      followingCount: cachedProfileBySession?.followingCount,
      postsCount: cachedProfileBySession?.postsCount,
      winsCount: cachedProfileBySession?.winsCount,
      lossesCount: cachedProfileBySession?.lossesCount,
    };
    return mergeDerivedPostCounters(
      mergeProfileSnapshotIntoExtendedUser(baseProfile, cachedProfileSnapshot),
      derivedCachedProfilePosts
    );
  }, [cachedProfileBySession, cachedProfileSnapshot, derivedCachedProfilePosts, session?.user]);
  const shouldRefetchProfileOnMount =
    !hasCompleteProfileCounters(sessionBackedProfile) ||
    hasOnlyZeroProfileCounters(sessionBackedProfile) ||
    hasSuspiciousZeroSocialCounts(sessionBackedProfile);

  // Fetch user data with React Query
  const {
    data: user,
    isLoading: isLoadingUser,
    error: userError,
    refetch: refetchUser,
    isFetched: isUserFetched,
  } = useQuery({
    queryKey: profileMeQueryKey,
    queryFn: async () => {
      if (!session?.user && sessionBackedProfile) {
        return sessionBackedProfile;
      }
      try {
        const userData = await api.get<ExtendedUser>("/api/me");
        const mergedUserData = mergeDerivedPostCounters(
          mergeProfileSnapshotIntoExtendedUser(userData, cachedProfileSnapshot),
          derivedCachedProfilePosts
        );
        if (hasCompleteProfileCounters(mergedUserData) || !session?.user?.id) {
          return mergedUserData;
        }
        try {
          const profileData = await api.get<UserProfileCountersPayload>(`/api/users/${session.user.id}`);
          return mergeProfileCounters(mergedUserData, profileData);
        } catch {
          return mergedUserData;
        }
      } catch (error) {
        if (
          sessionBackedProfile &&
          (!(error instanceof ApiError) || (error.status !== 401 && error.status !== 403))
        ) {
          if (!hasCompleteProfileCounters(sessionBackedProfile) && session?.user?.id) {
            try {
              const profileData = await api.get<UserProfileCountersPayload>(`/api/users/${session.user.id}`);
              return mergeProfileCounters(sessionBackedProfile, profileData);
            } catch {
              return sessionBackedProfile;
            }
          }
          return sessionBackedProfile;
        }
        if (session?.user?.id && sessionBackedProfile) {
          try {
            const profileData = await api.get<UserProfileCountersPayload>(`/api/users/${session.user.id}`);
            return mergeProfileCounters(sessionBackedProfile, profileData);
          } catch {
            // fall through to original error
          }
        }
        throw error;
      }
    },
    initialData: sessionBackedProfile ?? undefined,
    enabled: hasLiveSession || (!session?.user && !!sessionBackedProfile),
    staleTime: 5 * 60 * 1000, // 5 minutes
    gcTime: 10 * 60 * 1000, // 10 minutes (formerly cacheTime)
    refetchInterval: false,
    refetchOnMount: shouldRefetchProfileOnMount,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: (failureCount, error) => {
      if (error instanceof ApiError && (error.status === 401 || error.status === 403 || error.status === 429)) {
        return false;
      }
      return failureCount < 1;
    },
  });
  const shouldBackfillProfileCounters = Boolean(session?.user?.id);
  const { data: publicProfileCounters } = useQuery({
    queryKey: ["profile", "me", "public-counters", session?.user?.id ?? "anonymous"],
    queryFn: async () => {
      if (!session?.user?.id) {
        throw new Error("User ID is required");
      }
      return await api.get<UserProfileCountersPayload>(`/api/users/${session.user.id}`);
    },
    enabled: shouldBackfillProfileCounters,
    staleTime: 60_000,
    gcTime: 5 * 60 * 1000,
    refetchOnMount: true,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: 0,
  });
  const canonicalProfileUser = useMemo(() => {
    const baseUser = user ?? sessionBackedProfile;
    if (!baseUser) {
      return null;
    }
    return publicProfileCounters ? mergeProfileCounters(baseUser, publicProfileCounters) : baseUser;
  }, [publicProfileCounters, sessionBackedProfile, user]);

  // Update edit form state when user data loads
  useEffect(() => {
    if (user) {
      setEditUsername(user.username || "");
      setEditBio(user.bio || "");
    }
  }, [user]);

  useEffect(() => {
    setEnableWalletOverviewQuery(false);
    if (!user?.walletAddress) return;
    const timer = window.setTimeout(() => setEnableWalletOverviewQuery(true), 1800);
    return () => window.clearTimeout(timer);
  }, [user?.walletAddress]);

  useEffect(() => {
    setEnableFeeEarningsQuery(false);
    if (!hasLiveSession || !user?.id || profileViewTab !== "settings") return;
    const timer = window.setTimeout(() => setEnableFeeEarningsQuery(true), 1200);
    return () => window.clearTimeout(timer);
  }, [hasLiveSession, profileViewTab, user?.id]);

  // Fetch user posts with React Query
  const {
    data: posts = [],
    isLoading: isLoadingPosts,
    isFetched: isPostsFetched,
  } = useQuery({
    queryKey: ["profile", "posts", user?.id],
    queryFn: async () => {
      const fallbackPosts =
        cachedPosts && cachedPosts.length > 0
          ? cachedPosts
          : feedFallbackPosts.length > 0
            ? feedFallbackPosts
            : null;
      if (!user?.id) {
        return fallbackPosts ?? [];
      }
      try {
        const postsData = await api.get<Post[]>(`/api/users/${user.id}/posts`);
        if (postsData.length === 0 && fallbackPosts) {
          return fallbackPosts;
        }
        return postsData;
      } catch (error) {
        if (fallbackPosts) {
          return fallbackPosts;
        }
        throw error;
      }
    },
    initialData:
      cachedPosts ??
      (feedFallbackPosts.length > 0 ? feedFallbackPosts : undefined),
    enabled: !!user?.id,
    staleTime: 2 * 60 * 1000, // 2 minutes
    gcTime: 5 * 60 * 1000, // 5 minutes
    refetchInterval: false,
    refetchOnMount: cachedPosts || feedFallbackPosts.length > 0 ? false : true,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: 0,
  });

  const {
    data: walletOverview,
    isFetched: isWalletOverviewFetched,
  } = useQuery({
    queryKey: ["profile", "wallet-overview", user?.id],
    queryFn: async () => {
      if (!user?.id) return null;
      return await api.get<WalletData>(`/api/users/${user.id}/wallet/overview`);
    },
    initialData: user?.id ? (cachedWalletOverview ?? undefined) : undefined,
    enabled: !!user?.id && !!user?.walletAddress && enableWalletOverviewQuery,
    staleTime: 60_000,
    gcTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: 0,
  });

  // Fetch user reposts with React Query
  const {
    data: reposts = [],
    isLoading: isLoadingReposts,
    isFetched: isRepostsFetched,
  } = useQuery({
    queryKey: ["profile", "reposts", user?.id],
    queryFn: async () => {
      if (!user?.id) return [];
      const repostsData = await api.get<Post[]>(`/api/users/${user.id}/reposts`);
      return repostsData;
    },
    initialData: user?.id ? (cachedReposts ?? undefined) : undefined,
    enabled: !!user?.id && mainTab === "reposts",
    staleTime: 2 * 60 * 1000, // 2 minutes
    gcTime: 5 * 60 * 1000, // 5 minutes
    refetchInterval: false,
    refetchOnMount: cachedReposts ? false : true,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: 1,
  });

  const {
    data: feeSettings,
    isLoading: isLoadingFeeSettings,
  } = useQuery({
    queryKey: ["profile", "fee-settings", user?.id],
    queryFn: async () => {
      return await api.get<FeeSettingsData>("/api/users/me/fee-settings");
    },
    enabled: hasLiveSession && !!user?.id && profileViewTab === "settings",
    staleTime: 60_000,
    gcTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: 0,
  });

  const {
    data: feeEarnings,
    isLoading: isLoadingFeeEarnings,
  } = useQuery({
    queryKey: ["profile", "fee-earnings", user?.id],
    queryFn: async () => {
      return await api.get<FeeEarningsData>("/api/users/me/fee-earnings");
    },
    enabled: hasLiveSession && !!user?.id && profileViewTab === "settings" && enableFeeEarningsQuery,
    staleTime: 20_000,
    gcTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: 0,
  });

  const connectedWalletAddress = connectedWalletPublicKey?.toBase58() ?? null;
  const displayWalletAddress = user?.walletAddress ?? connectedWalletAddress;

  useEffect(() => {
    if (!user || !isUserFetched) return;
    if (meProfileCacheKey) {
      writeSessionCache(meProfileCacheKey, user);
    }
    syncProfileSnapshotAcrossCaches(queryClient, {
      id: user.id,
      username: user.username ?? null,
      image: user.image ?? null,
      level: user.level,
      xp: user.xp,
      isVerified: user.isVerified,
      createdAt: user.createdAt,
      followersCount: user.followersCount ?? null,
      followingCount: user.followingCount ?? null,
      postsCount: user.postsCount ?? null,
      winsCount: user.winsCount ?? null,
      lossesCount: user.lossesCount ?? null,
    });
  }, [isUserFetched, meProfileCacheKey, queryClient, user]);

  useEffect(() => {
    if (!publicProfileCounters || !session?.user?.id) return;

    const currentUser =
      queryClient.getQueryData<ExtendedUser>(profileMeQueryKey) ??
      sessionBackedProfile;
    if (!currentUser) return;

    const mergedUser = mergeProfileCounters(currentUser, publicProfileCounters);
    queryClient.setQueryData(profileMeQueryKey, mergedUser);
    if (meProfileCacheKey) {
      writeSessionCache(meProfileCacheKey, mergedUser);
    }
    syncProfileSnapshotAcrossCaches(queryClient, {
      id: mergedUser.id,
      username: mergedUser.username ?? null,
      image: mergedUser.image ?? null,
      level: mergedUser.level,
      xp: mergedUser.xp,
      isVerified: mergedUser.isVerified,
      createdAt: mergedUser.createdAt,
      followersCount: mergedUser.followersCount ?? null,
      followingCount: mergedUser.followingCount ?? null,
      postsCount: mergedUser.postsCount ?? null,
      winsCount: mergedUser.winsCount ?? null,
      lossesCount: mergedUser.lossesCount ?? null,
    });
  }, [
    meProfileCacheKey,
    profileMeQueryKey,
    publicProfileCounters,
    queryClient,
    session?.user?.id,
    sessionBackedProfile,
  ]);

  useEffect(() => {
    if (!session?.user?.id || !isPostsFetched) return;
    writeSessionCache(`phew.profile.posts:${session.user.id}`, posts);
    syncPostsIntoQueryCache(queryClient, posts);
  }, [isPostsFetched, posts, queryClient, session?.user?.id]);

  useEffect(() => {
    if (!session?.user?.id || !isRepostsFetched) return;
    writeSessionCache(`phew.profile.reposts:${session.user.id}`, reposts);
    syncPostsIntoQueryCache(queryClient, reposts);
  }, [isRepostsFetched, queryClient, reposts, session?.user?.id]);

  useEffect(() => {
    if (!session?.user?.id || !isWalletOverviewFetched || !walletOverview) return;
    writeSessionCache(`phew.profile.wallet:${session.user.id}`, walletOverview);
  }, [isWalletOverviewFetched, session?.user?.id, walletOverview]);

  useEffect(() => {
    if (!feeSettings) return;
    setFeeRewardsEnabled(feeSettings.tradeFeeRewardsEnabled);
    setFeeSharePercentInput((feeSettings.tradeFeeShareBps / 100).toFixed(2));
    setFeePayoutAddressInput(feeSettings.tradeFeePayoutAddress ?? "");
  }, [feeSettings]);

  // Mutation for updating profile
  const updateProfileMutation = useMutation({
    mutationFn: async (updateData: { username?: string; bio?: string; image?: string; bannerImage?: string }) => {
      return await api.patch<ExtendedUser>("/api/users/me", updateData);
    },
    onSuccess: (updatedUser) => {
      queryClient.setQueryData(profileMeQueryKey, updatedUser);
      if (meProfileCacheKey) {
        writeSessionCache(meProfileCacheKey, updatedUser);
      }
      syncProfileSnapshotAcrossCaches(queryClient, {
        id: updatedUser.id,
        username: updatedUser.username ?? null,
        image: updatedUser.image ?? null,
        level: updatedUser.level,
        xp: updatedUser.xp,
        isVerified: updatedUser.isVerified,
        createdAt: updatedUser.createdAt,
        followersCount: updatedUser.followersCount ?? null,
        followingCount: updatedUser.followingCount ?? null,
        postsCount: updatedUser.postsCount ?? null,
        winsCount: updatedUser.winsCount ?? null,
        lossesCount: updatedUser.lossesCount ?? null,
      });
      updateCachedAuthUser(updatedUser);
      setIsEditing(false);
      setPreviewImage(null);
      toast.success("Profile updated!");
    },
    onError: (error: ApiError) => {
      toast.error(error.message || "Failed to update profile");
    },
  });

  const updateFeeSettingsMutation = useMutation({
    mutationFn: async (payload: {
      tradeFeeRewardsEnabled: boolean;
      tradeFeeShareBps: number;
      tradeFeePayoutAddress: string;
    }) => {
      return await api.patch<FeeSettingsData>("/api/users/me/fee-settings", payload);
    },
    onSuccess: (updated) => {
      queryClient.setQueryData(["profile", "fee-settings", user?.id], updated);
      queryClient.setQueryData<ExtendedUser | undefined>(profileMeQueryKey, (prev) =>
        prev
          ? {
              ...prev,
              tradeFeeRewardsEnabled: updated.tradeFeeRewardsEnabled,
              tradeFeeShareBps: updated.tradeFeeShareBps,
              tradeFeePayoutAddress: updated.tradeFeePayoutAddress,
            }
          : prev
      );
      toast.success("Fee settings saved");
    },
    onError: (error: ApiError) => {
      toast.error(error.message || "Failed to update fee settings");
    },
  });

  // Mutation for liking a post
  const likeMutation = useMutation({
    mutationFn: async (postId: string) => {
      await api.post(`/api/posts/${postId}/like`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["profile", "posts", user?.id] });
    },
    onError: (error) => {
      console.error("Failed to like post:", error);
    },
  });

  // Mutation for reposting
  const repostMutation = useMutation({
    mutationFn: async (postId: string) => {
      await api.post(`/api/posts/${postId}/repost`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["profile", "posts", user?.id] });
      queryClient.invalidateQueries({ queryKey: ["profile", "reposts", user?.id] });
    },
    onError: (error) => {
      console.error("Failed to repost:", error);
    },
  });

  // Mutation for commenting
  const commentMutation = useMutation({
    mutationFn: async ({ postId, content }: { postId: string; content: string }) => {
      await api.post(`/api/posts/${postId}/comments`, { content });
    },
    onSuccess: () => {
      toast.success("Comment added!");
      queryClient.invalidateQueries({ queryKey: ["profile", "posts", user?.id] });
    },
    onError: (error) => {
      console.error("Failed to comment:", error);
      toast.error("Failed to add comment");
    },
  });

  // Handle image upload
  const handleImageClick = () => {
    if (isEditing) {
      fileInputRef.current?.click();
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate file type
    if (!file.type.startsWith("image/")) {
      toast.error("Please select an image file");
      return;
    }

    // Validate file size (max 5MB)
    if (file.size > 5 * 1024 * 1024) {
      toast.error("Image must be less than 5MB");
      return;
    }

    // Convert to base64 and open crop dialog
    const reader = new FileReader();
    reader.onload = (event) => {
      const result = event.target?.result as string;
      setCropSourceImage(result);
      setCropImageMeta(null);
      setCropZoom(1);
      setCropOffset({ x: 0, y: 0 });
      setIsCropDialogOpen(true);
    };
    reader.readAsDataURL(file);
  };

  useEffect(() => {
    if (!cropImageMeta) return;
    setCropOffset((prev) => clampCropOffset(prev, cropImageMeta, cropRenderScale));
  }, [cropImageMeta, cropRenderScale]);

  const resetCropDialog = () => {
    setIsCropDialogOpen(false);
    setCropSourceImage(null);
    setCropImageMeta(null);
    setCropZoom(1);
    setCropOffset({ x: 0, y: 0 });
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const handleCropImageLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget;
    setCropImageMeta({
      width: img.naturalWidth,
      height: img.naturalHeight,
    });
    setCropOffset({ x: 0, y: 0 });
  };

  const handleCropPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!cropImageMeta) return;
    cropDragRef.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      originX: cropOffset.x,
      originY: cropOffset.y,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const handleCropPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const drag = cropDragRef.current;
    if (!drag || drag.pointerId !== e.pointerId || !cropImageMeta) return;

    const next = clampCropOffset(
      {
        x: drag.originX + (e.clientX - drag.startX),
        y: drag.originY + (e.clientY - drag.startY),
      },
      cropImageMeta,
      cropRenderScale
    );
    setCropOffset(next);
  };

  const handleCropPointerEnd = (e: React.PointerEvent<HTMLDivElement>) => {
    const drag = cropDragRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    cropDragRef.current = null;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      // no-op
    }
  };

  const handleApplyCrop = async () => {
    if (!cropSourceImage || !cropImageMeta || !cropPreviewImgRef.current) {
      toast.error("Image crop is not ready yet");
      return;
    }

    setIsApplyingCrop(true);
    try {
      const img = cropPreviewImgRef.current;
      const canvas = document.createElement("canvas");
      canvas.width = AVATAR_CROP_OUTPUT_SIZE;
      canvas.height = AVATAR_CROP_OUTPUT_SIZE;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Canvas not supported");

      const scaledWidth = cropImageMeta.width * cropRenderScale;
      const scaledHeight = cropImageMeta.height * cropRenderScale;
      const left = (AVATAR_CROP_BOX_SIZE - scaledWidth) / 2 + cropOffset.x;
      const top = (AVATAR_CROP_BOX_SIZE - scaledHeight) / 2 + cropOffset.y;

      const srcX = Math.max(0, (0 - left) / cropRenderScale);
      const srcY = Math.max(0, (0 - top) / cropRenderScale);
      const srcW = Math.min(cropImageMeta.width - srcX, AVATAR_CROP_BOX_SIZE / cropRenderScale);
      const srcH = Math.min(cropImageMeta.height - srcY, AVATAR_CROP_BOX_SIZE / cropRenderScale);

      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.save();
      ctx.beginPath();
      ctx.arc(
        AVATAR_CROP_OUTPUT_SIZE / 2,
        AVATAR_CROP_OUTPUT_SIZE / 2,
        AVATAR_CROP_OUTPUT_SIZE / 2,
        0,
        Math.PI * 2
      );
      ctx.clip();
      ctx.drawImage(img, srcX, srcY, srcW, srcH, 0, 0, canvas.width, canvas.height);
      ctx.restore();

      const croppedPng = canvas.toDataURL("image/png");
      setPreviewImage(croppedPng);
      toast.success("Profile picture cropped");
      resetCropDialog();
    } catch (error) {
      console.error("[profile] Failed to crop image", error);
      toast.error("Failed to crop image");
    } finally {
      setIsApplyingCrop(false);
    }
  };

  // Save profile changes
  const handleSave = async () => {
    const normalizedHandle = normalizeProfileHandleInput(editUsername);
    const handleError = getProfileHandleValidationMessage(normalizedHandle);
    const currentNormalizedHandle = normalizeProfileHandleInput(user?.username ?? "");

    if (handleError) {
      toast.error(handleError);
      return;
    }

    const updateData: { username?: string; bio?: string; image?: string; bannerImage?: string } = {
      bio: editBio.trim() || undefined,
    };

    if (normalizedHandle !== currentNormalizedHandle) {
      updateData.username = normalizedHandle;
    }

    if (previewImage) {
      updateData.image = previewImage;
    }

    if (editBannerImage !== null) {
      updateData.bannerImage = editBannerImage;
    }

    updateProfileMutation.mutate(updateData);
  };

  // Cancel editing
  const handleCancel = () => {
    setIsEditing(false);
    setEditUsername(user?.username || "");
    setEditBio(user?.bio || "");
    setPreviewImage(null);
    setEditBannerImage(null);
    resetCropDialog();
  };

  // Filter posts
  const filteredPosts = posts.filter((post) => {
    if (postFilter === "all") return true;
    if (postFilter === "wins") return post.settled && post.isWin;
    if (postFilter === "losses") return post.settled && !post.isWin;
    return true;
  });

  // Calculate stats
  const winsCount = canonicalProfileUser?.winsCount ?? posts.filter((p) => p.settled && p.isWin).length;
  const lossesCount = canonicalProfileUser?.lossesCount ?? posts.filter((p) => p.settled && !p.isWin).length;
  const followersCount =
    publicProfileCounters?.stats && hasFiniteCount(publicProfileCounters.stats.followers)
      ? publicProfileCounters.stats.followers
      : canonicalProfileUser?.followersCount ?? 0;
  const followingCount =
    publicProfileCounters?.stats && hasFiniteCount(publicProfileCounters.stats.following)
      ? publicProfileCounters.stats.following
      : canonicalProfileUser?.followingCount ?? 0;
  const totalSettled = winsCount + lossesCount;
  const winRate = totalSettled > 0 ? Math.round((winsCount / totalSettled) * 100) : 0;

  // Calculate user stats for ProfileDashboard
  const userStats = useMemo<UserStats>(() => {
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
  }, [posts, winsCount, lossesCount, totalSettled]);

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

  const performanceVm = useMemo(
    () =>
      canonicalProfileUser
        ? buildTraderPerformanceVm({
            displayName: canonicalProfileUser.name || canonicalProfileUser.username || "Trader",
            handle: canonicalProfileUser.username ? `@${canonicalProfileUser.username}` : null,
            avatarUrl: getAvatarUrl(canonicalProfileUser.id, canonicalProfileUser.image),
            bio: canonicalProfileUser.bio ?? null,
            followersCount,
            followingCount,
            joinedAt: canonicalProfileUser.createdAt,
            walletData:
              walletOverview
                ? { ...walletOverview, address: displayWalletAddress ?? walletOverview.address }
                : displayWalletAddress
                  ? { connected: true, address: displayWalletAddress }
                  : undefined,
            recentTrades,
            postsFallbackHrefBuilder: (address) => (address ? `/token/${address}` : null),
          })
        : null,
    [
      canonicalProfileUser,
      displayWalletAddress,
      followersCount,
      followingCount,
      recentTrades,
      walletOverview,
    ]
  );

  // Handle like
  const handleLike = async (postId: string) => {
    likeMutation.mutate(postId);
  };

  // Handle repost
  const handleRepost = async (postId: string) => {
    repostMutation.mutate(postId);
  };

  // Handle comment
  const handleComment = async (postId: string, content: string) => {
    commentMutation.mutate({ postId, content });
  };

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

  const setProfileView = (nextTab: ProfileViewTab) => {
    if (nextTab === "settings" && isEditing) {
      setIsEditing(false);
      setPreviewImage(null);
      resetCropDialog();
    }
    const nextParams = new URLSearchParams(searchParams);
    if (nextTab === "settings") {
      nextParams.set("tab", "settings");
    } else {
      nextParams.delete("tab");
    }
    setSearchParams(nextParams, { replace: true });
  };

  const handleSaveFeeSettings = () => {
    const parsedSharePercent = Number(feeSharePercentInput);
    if (!Number.isFinite(parsedSharePercent)) {
      toast.error("Fee share must be a valid number");
      return;
    }
    const normalizedShareBps = Math.min(50, Math.max(0, Math.round(parsedSharePercent * 100)));
    updateFeeSettingsMutation.mutate({
      tradeFeeRewardsEnabled: feeRewardsEnabled,
      tradeFeeShareBps: normalizedShareBps,
      tradeFeePayoutAddress: feePayoutAddressInput.trim(),
    });
  };

  const formatAtomicShort = (value: string) => {
    try {
      const big = BigInt(value);
      return big.toLocaleString();
    } catch {
      return value;
    }
  };
  const shouldShowProfileSignInState = !session?.user && !cachedProfileBySession;

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="app-topbar">
        <div className="mx-auto flex h-[4.4rem] max-w-[780px] items-center justify-between px-4 sm:px-5">
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => navigate("/")}
              className="h-10 w-10 rounded-2xl border border-border/60 bg-white/60 shadow-[0_18px_34px_-28px_hsl(var(--foreground)/0.18)] dark:border-white/[0.08] dark:bg-white/[0.04] dark:shadow-none"
            >
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <h1 className="font-heading font-semibold text-lg">Profile</h1>
          </div>

          {profileViewTab === "profile" ? (
            !isEditing ? (
              <div className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-9 w-9 rounded-full"
                  onClick={() => setIsShareCardOpen(true)}
                >
                  <Share2 className="h-4 w-4" />
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setProfileView("settings")}
                  className="h-9 gap-1.5 rounded-full px-3"
                >
                  <PhewEditIcon className="h-3.5 w-3.5" />
                  Settings
                </Button>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleCancel}
                  disabled={updateProfileMutation.isPending}
                  className="h-8 px-3 gap-1.5"
                >
                  <X className="h-3.5 w-3.5" />
                  Cancel
                </Button>
                <Button
                  size="sm"
                  onClick={handleSave}
                  disabled={updateProfileMutation.isPending}
                  className="h-8 px-3 gap-1.5"
                >
                  {updateProfileMutation.isPending ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Check className="h-3.5 w-3.5" />
                  )}
                  Save
                </Button>
              </div>
            )
          ) : (
            <span className="text-xs text-muted-foreground">Trading Settings</span>
          )}
        </div>
      </header>

      <main className="app-page-shell">
        <Dialog
          open={isCropDialogOpen}
          onOpenChange={(open) => {
            if (!open && !isApplyingCrop) {
              resetCropDialog();
              return;
            }
            setIsCropDialogOpen(open);
          }}
        >
          <DialogContent className="sm:max-w-md p-0 overflow-hidden">
            <DialogHeader className="px-5 pt-5">
              <DialogTitle className="flex items-center gap-2">
                <Camera className="h-4 w-4" />
                Crop profile photo
              </DialogTitle>
              <DialogDescription>
                Drag to position your image and zoom for a perfect round profile picture.
              </DialogDescription>
            </DialogHeader>

            <div className="px-5 pb-4">
              <div className="mx-auto rounded-2xl border border-border/60 bg-secondary/20 p-3">
                <div
                  className="relative mx-auto h-[280px] w-[280px] rounded-2xl overflow-hidden bg-black touch-none select-none"
                  onPointerDown={handleCropPointerDown}
                  onPointerMove={handleCropPointerMove}
                  onPointerUp={handleCropPointerEnd}
                  onPointerCancel={handleCropPointerEnd}
                >
                  {cropSourceImage ? (
                    <img
                      ref={cropPreviewImgRef}
                      src={cropSourceImage}
                      alt="Crop preview"
                      draggable={false}
                      onLoad={handleCropImageLoad}
                      className="absolute max-w-none pointer-events-none"
                      style={{
                        width: cropImageMeta ? `${cropImageMeta.width * cropRenderScale}px` : undefined,
                        height: cropImageMeta ? `${cropImageMeta.height * cropRenderScale}px` : undefined,
                        left: cropImageMeta
                          ? `${(AVATAR_CROP_BOX_SIZE - cropImageMeta.width * cropRenderScale) / 2 + cropOffset.x}px`
                          : "50%",
                        top: cropImageMeta
                          ? `${(AVATAR_CROP_BOX_SIZE - cropImageMeta.height * cropRenderScale) / 2 + cropOffset.y}px`
                          : "50%",
                        transform: cropImageMeta ? undefined : "translate(-50%, -50%)",
                      }}
                    />
                  ) : null}

                  <div className="absolute inset-0 pointer-events-none">
                    <div className="absolute left-1/2 top-1/2 h-[236px] w-[236px] -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white/85 shadow-[0_0_0_9999px_rgba(0,0,0,0.52)]" />
                    <div className="absolute left-1/2 top-1/2 h-[236px] w-[236px] -translate-x-1/2 -translate-y-1/2 rounded-full ring-1 ring-primary/50" />
                  </div>

                  <div className="absolute bottom-2 left-2 right-2 flex items-center justify-center gap-2 rounded-lg border border-white/10 bg-black/40 px-2 py-1.5 text-[11px] text-white/85 backdrop-blur-sm pointer-events-none">
                    <Move className="h-3.5 w-3.5" />
                    Drag to reposition
                  </div>
                </div>
              </div>

              <div className="mt-4 space-y-2">
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span className="inline-flex items-center gap-1.5">
                    <ZoomIn className="h-3.5 w-3.5" />
                    Zoom
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setCropZoom(1);
                      setCropOffset({ x: 0, y: 0 });
                    }}
                    className="inline-flex items-center gap-1 text-xs hover:text-foreground transition-colors"
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                    Reset
                  </button>
                </div>
                <input
                  type="range"
                  min={1}
                  max={3}
                  step={0.01}
                  value={cropZoom}
                  onChange={(e) => setCropZoom(Number(e.target.value))}
                  className="w-full accent-primary"
                />
              </div>
            </div>

            <DialogFooter className="px-5 pb-5 pt-0 flex-row justify-end gap-2">
              <Button
                type="button"
                variant="ghost"
                onClick={resetCropDialog}
                disabled={isApplyingCrop}
              >
                Cancel
              </Button>
              <Button
                type="button"
                onClick={handleApplyCrop}
                disabled={!cropSourceImage || !cropImageMeta || isApplyingCrop}
                className="gap-2"
              >
                {isApplyingCrop ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                Apply crop
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {isLoadingUser ? (
          // Loading skeleton
          <div className="space-y-6">
            <div className="flex flex-col items-center gap-4">
              <Skeleton className="h-28 w-28 rounded-full" />
              <Skeleton className="h-6 w-40" />
              <Skeleton className="h-4 w-32" />
            </div>
            <Skeleton className="h-24 w-full rounded-xl" />
            <Skeleton className="h-32 w-full rounded-xl" />
          </div>
        ) : user ? (
          <div className="space-y-6 animate-fade-in">
            <Tabs value={profileViewTab} onValueChange={(value) => setProfileView(value as ProfileViewTab)} className="w-full">
              <TabsList className="w-full grid grid-cols-2 h-10">
                <TabsTrigger value="profile">Profile</TabsTrigger>
                <TabsTrigger value="settings">Settings</TabsTrigger>
              </TabsList>
            </Tabs>

            {profileViewTab === "profile" ? (
              <>
                {/* Danger Zone Warning Banner */}
                {(user.level <= LIQUIDATION_LEVEL || isInDangerZone(user.level)) && (
                  <div
                    className={cn(
                      "flex items-center gap-3 p-4 rounded-xl border animate-pulse",
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
                {performanceVm ? (
                  <TraderPerformanceView
                    vm={performanceVm}
                    headerActions={[
                      {
                        key: "share",
                        label: <Share2 className="h-4 w-4" />,
                        onClick: () => setIsShareCardOpen(true),
                        variant: "ghost",
                      },
                      {
                        key: "portfolio",
                        label: "Portfolio",
                        onClick: () => setIsPortfolioOpen(true),
                        variant: "ghost",
                      },
                    ]}
                    heroTabs={[
                      { key: "24h", label: "24h", active: true },
                      { key: "7d", label: "7d", active: false, disabled: true },
                      { key: "30d", label: "30d", active: false, disabled: true },
                      { key: "all", label: "All", active: false, disabled: true },
                    ]}
                  />
                ) : null}

                <TraderIntelligenceCard
                  handle={user.username ?? user.id}
                  enabled={isPostsFetched}
                  deferMs={1800}
                />

            <LivePortfolioDialog
              open={isPortfolioOpen}
              onOpenChange={setIsPortfolioOpen}
              walletAddress={displayWalletAddress ?? user.walletAddress ?? null}
            />

            <BannerPicker
              open={isBannerPickerOpen}
              onOpenChange={setIsBannerPickerOpen}
              currentBanner={editBannerImage ?? user.bannerImage ?? null}
              userLevel={user.level}
              onSelect={(banner) => {
                setEditBannerImage(banner);
                setIsBannerPickerOpen(false);
              }}
            />

            {isShareCardOpen && (
              <ShareableProfileCard
                open={isShareCardOpen}
                onOpenChange={setIsShareCardOpen}
                user={{
                  id: user.id,
                  username: user.username,
                  name: user.name,
                  image: user.image,
                  level: user.level,
                  xp: user.xp,
                  isVerified: user.isVerified,
                  bannerImage: user.bannerImage,
                  stats: {
                    wins: winsCount,
                    losses: lossesCount,
                    winRate,
                    totalCalls: totalSettled,
                  },
                }}
              />
            )}

            {/* Wallet Connection Section */}
            <WalletConnection deferMs={2600} />

            {/* My Invites Section */}
            <MyInvitesSection />
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
                        // Loading skeletons using PostCardSkeleton
                        <>
                          {[1, 2, 3].map((i) => (
                            <PostCardSkeleton
                              key={i}
                              showMarketData={i === 1 || i === 2}
                              className="animate-fade-in-up"
                              style={{ animationDelay: `${i * 0.1}s` }}
                            />
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
                                ? "Start posting your alpha calls!"
                                : "Keep trading to build your record"}
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
                                  currentUserId={user?.id}
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
                    // Loading skeletons using PostCardSkeleton
                    <>
                      {[1, 2, 3].map((i) => (
                        <PostCardSkeleton
                          key={i}
                          showMarketData={i === 1 || i === 2}
                          className="animate-fade-in-up"
                          style={{ animationDelay: `${i * 0.1}s` }}
                        />
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
                          Repost posts you want to save and share
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
                              currentUserId={user?.id}
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
              </>
            ) : (
              <div className="space-y-4">
                <div className="app-surface p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <h3 className="text-sm font-semibold text-foreground">Trade Fee Settings</h3>
                      <p className="text-xs text-muted-foreground mt-1">
                        Configure how swap fee rewards are credited when users trade through your calls.
                      </p>
                    </div>
                    {isLoadingFeeSettings ? (
                      <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                    ) : null}
                  </div>

                  <div className="mt-4 grid gap-3 sm:grid-cols-2">
                    <div className="rounded-lg border border-border/60 bg-background/40 px-3 py-2">
                      <p className="text-[11px] uppercase tracking-wider text-muted-foreground">Platform Fee</p>
                      <p className="text-sm font-semibold text-foreground mt-1">
                        {feeSettings?.platformFeeBps ? `${(feeSettings.platformFeeBps / 100).toFixed(2)}%` : "Not enabled"}
                      </p>
                    </div>
                    <div className="rounded-lg border border-border/60 bg-background/40 px-3 py-2">
                      <p className="text-[11px] uppercase tracking-wider text-muted-foreground">Payout Wallet</p>
                      <p className="text-sm font-semibold text-foreground mt-1 truncate">
                        {feeSettings?.effectivePayoutAddress ?? user.walletAddress ?? "Not set"}
                      </p>
                    </div>
                  </div>

                  <div className="mt-4 space-y-3">
                    <label className="flex items-center justify-between gap-3 rounded-lg border border-border/60 bg-background/40 p-3">
                      <div>
                        <p className="text-sm font-medium text-foreground">Enable Fee Rewards</p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          Turn off if you don&apos;t want poster fee credits.
                        </p>
                      </div>
                      <input
                        type="checkbox"
                        checked={feeRewardsEnabled}
                        onChange={(e) => setFeeRewardsEnabled(e.target.checked)}
                        className="h-4 w-4 accent-primary"
                      />
                    </label>

                    <div className="grid gap-3 sm:grid-cols-2">
                      <div>
                        <label className="text-xs font-medium text-muted-foreground">Your Creator Fee (%) (max 0.50)</label>
                        <Input
                          value={feeSharePercentInput}
                          onChange={(e) => setFeeSharePercentInput(e.target.value)}
                          inputMode="decimal"
                          placeholder="0.50"
                          className="mt-1"
                        />
                      </div>
                      <div>
                        <label className="text-xs font-medium text-muted-foreground">Payout Wallet (optional)</label>
                        <Input
                          value={feePayoutAddressInput}
                          onChange={(e) => setFeePayoutAddressInput(e.target.value)}
                          placeholder="Solana address"
                          className="mt-1"
                        />
                      </div>
                    </div>

                    <Button
                      type="button"
                      onClick={handleSaveFeeSettings}
                      disabled={updateFeeSettingsMutation.isPending}
                      className="w-full sm:w-auto"
                    >
                      {updateFeeSettingsMutation.isPending ? (
                        <Loader2 className="h-4 w-4 animate-spin mr-1" />
                      ) : null}
                      Save Fee Settings
                    </Button>
                  </div>
                </div>

                <div className="app-surface p-4">
                  <h3 className="text-sm font-semibold text-foreground">Fee Earnings</h3>
                  <p className="text-xs text-muted-foreground mt-1">
                    Confirmed trades routed through your posts.
                  </p>

                  {isLoadingFeeEarnings ? (
                    <div className="mt-4 flex items-center gap-2 text-sm text-muted-foreground">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Loading fee earnings...
                    </div>
                  ) : (
                    <div className="mt-4 space-y-4">
                      <div className="grid gap-3 sm:grid-cols-2">
                        <div className="rounded-lg border border-border/60 bg-background/40 px-3 py-2">
                          <p className="text-[11px] uppercase tracking-wider text-muted-foreground">Total Trades</p>
                          <p className="text-lg font-bold text-foreground mt-1">{feeEarnings?.totalTrades ?? 0}</p>
                        </div>
                        <div className="rounded-lg border border-border/60 bg-background/40 px-3 py-2">
                          <p className="text-[11px] uppercase tracking-wider text-muted-foreground">Total Earned (Atomic)</p>
                          <p className="text-lg font-bold text-foreground mt-1">
                            {formatAtomicShort(feeEarnings?.totalPosterShareAtomic ?? "0")}
                          </p>
                        </div>
                      </div>

                      <div className="space-y-2">
                        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">By Mint</p>
                        {feeEarnings?.byMint && feeEarnings.byMint.length > 0 ? (
                          feeEarnings.byMint.map((mintItem) => (
                            <div key={mintItem.mint} className="flex items-center justify-between rounded-lg border border-border/60 bg-background/40 px-3 py-2 text-sm">
                              <span className="font-mono text-xs text-muted-foreground">{truncateAddress(mintItem.mint)}</span>
                              <span className="text-foreground font-medium">
                                {formatAtomicShort(mintItem.totalAtomic)} ({mintItem.count})
                              </span>
                            </div>
                          ))
                        ) : (
                          <p className="text-sm text-muted-foreground">No confirmed fee earnings yet.</p>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        ) : shouldShowProfileSignInState ? (
          <div className="flex flex-col items-center justify-center py-16 gap-4">
            <p className="text-muted-foreground">Sign in to view your profile.</p>
            <Button onClick={() => navigate("/login")}>Go to Sign In</Button>
          </div>
        ) : (
          // Error state
          <div className="flex flex-col items-center justify-center py-16 gap-4">
            <p className="text-muted-foreground">Failed to load profile</p>
            <Button onClick={() => refetchUser()}>Try Again</Button>
          </div>
        )}
      </main>
    </div>
  );
}
