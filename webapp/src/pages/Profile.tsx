import { useState, useRef, useMemo, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useSession, useAuth } from "@/lib/auth-client";
import { api, ApiError } from "@/lib/api";
import { User, Post, getAvatarUrl, calculatePercentChange, LIQUIDATION_LEVEL } from "@/types";
import { LevelBadge, LevelBar } from "@/components/feed/LevelBar";
import { getLevelLabel, isInDangerZone, getDangerMessage } from "@/lib/level-utils";
import { PostCard } from "@/components/feed/PostCard";
import { PostCardSkeleton } from "@/components/feed/PostCardSkeleton";
import { ProfileDashboard, UserStats, RecentTrade, WalletData } from "@/components/profile/ProfileDashboard";
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
  Edit3,
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

interface ExtendedUser extends User {
  followersCount?: number;
  followingCount?: number;
  postsCount?: number;
  winsCount?: number;
  lossesCount?: number;
}

type PostFilter = "all" | "wins" | "losses";
type MainTab = "posts" | "reposts";
const PROFILE_ME_CACHE_TTL_MS = 60_000;
const PROFILE_POSTS_CACHE_TTL_MS = 45_000;
const PROFILE_WALLET_CACHE_TTL_MS = 60_000;

const AVATAR_CROP_BOX_SIZE = 280;
const AVATAR_CROP_OUTPUT_SIZE = 512;

type CropOffset = { x: number; y: number };
type CropImageMeta = { width: number; height: number };

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
  const queryClient = useQueryClient();
  const { data: session } = useSession();
  const { signOut } = useAuth();
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

  // Edit form state
  const [editUsername, setEditUsername] = useState("");
  const [editBio, setEditBio] = useState("");
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
  const cachedProfile = useMemo(
    () => (meProfileCacheKey ? readSessionCache<ExtendedUser>(meProfileCacheKey, PROFILE_ME_CACHE_TTL_MS) : null),
    [meProfileCacheKey]
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

  // Fetch user data with React Query
  const {
    data: user,
    isLoading: isLoadingUser,
    error: userError,
    refetch: refetchUser,
    isFetched: isUserFetched,
  } = useQuery({
    queryKey: ["profile", "me"],
    queryFn: async () => {
      const userData = await api.get<ExtendedUser>("/api/me");
      return userData;
    },
    initialData: cachedProfile ?? undefined,
    enabled: !!session?.user,
    staleTime: 5 * 60 * 1000, // 5 minutes
    gcTime: 10 * 60 * 1000, // 10 minutes (formerly cacheTime)
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: 1,
  });

  // Update edit form state when user data loads
  useEffect(() => {
    if (user) {
      setEditUsername(user.username || user.name || "");
      setEditBio(user.bio || "");
    }
  }, [user]);

  useEffect(() => {
    setEnableWalletOverviewQuery(false);
    if (!user?.walletAddress) return;
    const timer = window.setTimeout(() => setEnableWalletOverviewQuery(true), 350);
    return () => window.clearTimeout(timer);
  }, [user?.walletAddress]);

  // Fetch user posts with React Query
  const {
    data: posts = [],
    isLoading: isLoadingPosts,
    isFetched: isPostsFetched,
  } = useQuery({
    queryKey: ["profile", "posts", user?.id],
    queryFn: async () => {
      if (!user?.id) return [];
      const postsData = await api.get<Post[]>(`/api/users/${user.id}/posts`);
      return postsData;
    },
    initialData: user?.id ? (cachedPosts ?? undefined) : undefined,
    enabled: !!user?.id,
    staleTime: 2 * 60 * 1000, // 2 minutes
    gcTime: 5 * 60 * 1000, // 5 minutes
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: 1,
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
    retry: 1,
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
    enabled: !!user?.id && (mainTab === "reposts" || !!cachedReposts),
    staleTime: 2 * 60 * 1000, // 2 minutes
    gcTime: 5 * 60 * 1000, // 5 minutes
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: 1,
  });

  useEffect(() => {
    if (!meProfileCacheKey || !user || !isUserFetched) return;
    writeSessionCache(meProfileCacheKey, user);
  }, [isUserFetched, meProfileCacheKey, user]);

  useEffect(() => {
    if (!session?.user?.id || !isPostsFetched) return;
    writeSessionCache(`phew.profile.posts:${session.user.id}`, posts);
  }, [isPostsFetched, posts, session?.user?.id]);

  useEffect(() => {
    if (!session?.user?.id || !isRepostsFetched) return;
    writeSessionCache(`phew.profile.reposts:${session.user.id}`, reposts);
  }, [isRepostsFetched, reposts, session?.user?.id]);

  useEffect(() => {
    if (!session?.user?.id || !isWalletOverviewFetched || !walletOverview) return;
    writeSessionCache(`phew.profile.wallet:${session.user.id}`, walletOverview);
  }, [isWalletOverviewFetched, session?.user?.id, walletOverview]);

  // Mutation for updating profile
  const updateProfileMutation = useMutation({
    mutationFn: async (updateData: { username?: string; bio?: string; image?: string }) => {
      return await api.patch<ExtendedUser>("/api/users/me", updateData);
    },
    onSuccess: (updatedUser) => {
      queryClient.setQueryData(["profile", "me"], updatedUser);
      setIsEditing(false);
      setPreviewImage(null);
      toast.success("Profile updated!");
    },
    onError: (error: ApiError) => {
      toast.error(error.message || "Failed to update profile");
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
    if (!editUsername.trim()) {
      toast.error("Username cannot be empty");
      return;
    }

    const updateData: { username?: string; bio?: string; image?: string } = {
      username: editUsername.trim(),
      bio: editBio.trim() || undefined,
    };

    if (previewImage) {
      updateData.image = previewImage;
    }

    updateProfileMutation.mutate(updateData);
  };

  // Cancel editing
  const handleCancel = () => {
    setIsEditing(false);
    setEditUsername(user?.username || user?.name || "");
    setEditBio(user?.bio || "");
    setPreviewImage(null);
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
  const winsCount = user?.winsCount ?? posts.filter((p) => p.settled && p.isWin).length;
  const lossesCount = user?.lossesCount ?? posts.filter((p) => p.settled && !p.isWin).length;
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

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-background/80 backdrop-blur-xl border-b border-border">
        <div className="max-w-2xl mx-auto px-4 h-14 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => navigate("/")}
              className="h-9 w-9"
            >
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <h1 className="font-heading font-semibold text-lg">Profile</h1>
          </div>

          {!isEditing ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setIsEditing(true)}
              className="h-8 px-3 gap-1.5"
            >
              <Edit3 className="h-3.5 w-3.5" />
              Edit
            </Button>
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
          )}
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-6">
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

            {/* Profile Header */}
            <div className="flex flex-col items-center text-center">
              {/* Avatar */}
              <div className="relative group">
                <Avatar
                  className={cn(
                    "h-28 w-28 border-4 border-background ring-4 ring-primary/20",
                    isEditing && "cursor-pointer"
                  )}
                  onClick={handleImageClick}
                >
                  <AvatarImage
                    src={previewImage || getAvatarUrl(user.id, user.image)}
                  />
                  <AvatarFallback className="bg-muted text-muted-foreground text-3xl">
                    {user.name?.charAt(0) || "?"}
                  </AvatarFallback>
                </Avatar>

                {isEditing && (
                  <div
                    onClick={handleImageClick}
                    className="absolute inset-0 flex items-center justify-center bg-black/50 rounded-full cursor-pointer opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    <Camera className="h-8 w-8 text-white" />
                  </div>
                )}

                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handleFileChange}
                  className="hidden"
                />

                {/* Level badge overlay */}
                <div className="absolute -bottom-2 -right-2">
                  <LevelBadge level={user.level} size="lg" showLabel />
                </div>
              </div>

              {/* Username */}
              {isEditing ? (
                <Input
                  value={editUsername}
                  onChange={(e) => setEditUsername(e.target.value)}
                  placeholder="Username"
                  className="mt-4 max-w-xs text-center font-semibold text-lg"
                />
              ) : (
                <>
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
                </>
              )}

              {/* Bio */}
              {isEditing ? (
                <Textarea
                  value={editBio}
                  onChange={(e) => setEditBio(e.target.value)}
                  placeholder="Write a short bio..."
                  className="mt-2 max-w-sm text-center resize-none"
                  rows={2}
                />
              ) : user.bio ? (
                <p className="mt-2 text-muted-foreground max-w-sm">{user.bio}</p>
              ) : null}

              {/* Info badges */}
              <div className="mt-4 flex flex-wrap items-center justify-center gap-3">
                {user.walletAddress && (
                  <div className="flex items-center gap-1.5 px-3 py-1.5 bg-secondary rounded-full text-xs text-muted-foreground">
                    <Wallet className="h-3.5 w-3.5" />
                    <span className="font-mono">
                      {truncateAddress(user.walletAddress)}
                    </span>
                  </div>
                )}

                {user.email && (
                  <div className="flex items-center gap-1.5 px-3 py-1.5 bg-secondary rounded-full text-xs text-muted-foreground">
                    <Mail className="h-3.5 w-3.5" />
                    <span>{user.email}</span>
                  </div>
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

            {/* Wallet Connection Section */}
            <WalletConnection />

            {/* Followers/Following */}
            <div className="flex items-center justify-center gap-6 py-3">
              <button className="flex items-center gap-2 hover:text-primary transition-colors">
                <span className="font-bold">{user.followersCount ?? 0}</span>
                <span className="text-muted-foreground">Followers</span>
              </button>
              <div className="h-4 w-px bg-border" />
              <button className="flex items-center gap-2 hover:text-primary transition-colors">
                <span className="font-bold">{user.followingCount ?? 0}</span>
                <span className="text-muted-foreground">Following</span>
              </button>
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
