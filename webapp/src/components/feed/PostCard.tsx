import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { LevelBadge, LevelBar } from "./LevelBar";
import { RepostersDialog } from "./RepostersDialog";
import { SharedAlphaDialog } from "./SharedAlphaDialog";
import { TokenInfoCard } from "./TokenInfoCard";
import { AlsoCalledBy } from "./AlsoCalledBy";
import { VerifiedBadge } from "@/components/VerifiedBadge";
import { api } from "@/lib/api";
import { getPostPriceSnapshotBatched } from "@/lib/post-price-batch";
import {
  Post,
  Comment,
  SharedAlphaUser,
  MIN_LEVEL,
  MAX_LEVEL,
  formatMarketCap,
  calculatePercentChange,
  formatMultiplier,
  formatTimeAgo,
  getAvatarUrl,
  stripContractAddress,
} from "@/types";
import type { MultiplierDisplay } from "@/types";
import {
  Heart,
  MessageCircle,
  Repeat2,
  Share,
  ExternalLink,
  Clock,
  TrendingUp,
  TrendingDown,
  CheckCircle2,
  XCircle,
  Send,
  Users,
  Check,
  BarChart3,
  Sparkles,
  UserPlus,
  UserCheck,
  Loader2,
  Download,
  Coins,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

interface PostCardProps {
  post: Post;
  className?: string;
  currentUserId?: string;
  onLike?: (postId: string) => void;
  onRepost?: (postId: string) => void;
  onComment?: (postId: string, content: string) => Promise<void> | void;
}

export function PostCard({ post, className, currentUserId, onLike, onRepost, onComment }: PostCardProps) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const cardRef = useRef<HTMLDivElement>(null);
  const [isCommentsOpen, setIsCommentsOpen] = useState(false);
  const [commentText, setCommentText] = useState("");
  const [isLiked, setIsLiked] = useState(post.isLiked);
  const [isReposted, setIsReposted] = useState(post.isReposted);
  const [likeCount, setLikeCount] = useState(post._count?.likes ?? 0);
  const [repostCount, setRepostCount] = useState(post._count?.reposts ?? 0);
  const [copied, setCopied] = useState(false);
  const [isRepostersOpen, setIsRepostersOpen] = useState(false);
  const [isSharedAlphaOpen, setIsSharedAlphaOpen] = useState(false);
  // Initialize follow state from post data (optimistic update)
  const [isFollowing, setIsFollowing] = useState(post.isFollowingAuthor ?? false);
  const [isFollowLoading, setIsFollowLoading] = useState(false);
  const [commentCount, setCommentCount] = useState(post._count?.comments ?? 0);
  const [isInViewport, setIsInViewport] = useState(true);
  const [isWinCardDownloading, setIsWinCardDownloading] = useState(false);
  const [isWinCardPreviewOpen, setIsWinCardPreviewOpen] = useState(false);
  const exactLogoImageSrc = "https://i.imgur.com/yDZerPC.png";

  // Sync follow state when post data changes
  useEffect(() => {
    setIsFollowing(post.isFollowingAuthor ?? false);
  }, [post.isFollowingAuthor]);

  // Only live-poll prices for visible/nearby cards to reduce load on initial feed render.
  useEffect(() => {
    if (typeof window === "undefined" || typeof IntersectionObserver === "undefined") {
      return;
    }
    const node = cardRef.current;
    if (!node) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (entry) {
          setIsInViewport(entry.isIntersecting);
        }
      },
      {
        root: null,
        rootMargin: "300px 0px",
        threshold: 0,
      }
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  // Real-time price state
  const [currentMcap, setCurrentMcap] = useState(post.currentMcap);
  // Track settlement state locally to detect when post settles
  const [localSettled, setLocalSettled] = useState(post.settled);
  const [localMcap1h, setLocalMcap1h] = useState(post.mcap1h);
  const [localMcap6h, setLocalMcap6h] = useState(post.mcap6h);
  const [localIsWin, setLocalIsWin] = useState(post.isWin);

  // Sync state when post prop changes
  useEffect(() => {
    setLocalSettled(post.settled);
    setLocalMcap1h(post.mcap1h);
    setLocalMcap6h(post.mcap6h);
    setLocalIsWin(post.isWin);
  }, [post.settled, post.mcap1h, post.mcap6h, post.isWin]);

  // Real-time price updates with dynamic intervals:
  // - Unsettled posts (< 1 hour): Update every 30 seconds
  // - Settled posts (>= 1 hour): Update every 5 minutes
  // Also auto-refresh when post settles to show final 1H result
  useEffect(() => {
    if (!post.contractAddress) return;
    if (!isInViewport) return;

    const fetchPrice = async () => {
      if (typeof document !== "undefined" && document.visibilityState !== "visible") {
        return;
      }
      try {
        const data = await getPostPriceSnapshotBatched(post.id);
        if (!data) return;

        if (data.currentMcap !== null) {
          setCurrentMcap(data.currentMcap);
        }

        // Check if post just settled - update local state to show final result
        if (data.settled && !localSettled) {
          setLocalSettled(true);
          if (data.mcap1h !== null) {
            setLocalMcap1h(data.mcap1h);
            // Calculate if it's a win based on 1H mcap
            const isWin = post.entryMcap !== null && data.mcap1h > post.entryMcap;
            setLocalIsWin(isWin);
          }
          // Avoid refetching the full feed from every visible card when many posts settle at once.
          // The card already has the updated settlement state locally.
        }

        // Update 6H mcap if available
        if (data.mcap6h !== null && data.mcap6h !== localMcap6h) {
          setLocalMcap6h(data.mcap6h);
        }
      } catch (error) {
        // Silently fail - don't spam console
      }
    };

    // Use 30s for unsettled posts, 5 minutes for settled posts
    const baseInterval = localSettled ? 5 * 60 * 1000 : 30000;
    const initialDelay =
      post.currentMcap == null
        ? 0
        : Math.min(10_000, Math.floor(Math.random() * 4_000) + 1_000);

    const initialTimer = setTimeout(fetchPrice, initialDelay);
    const intervalTimer = setInterval(fetchPrice, baseInterval);

    return () => {
      clearTimeout(initialTimer);
      clearInterval(intervalTimer);
    };
  }, [post.id, post.contractAddress, post.entryMcap, post.currentMcap, localSettled, localMcap6h, isInViewport, queryClient]);

  // Fetch comments when expanded
  const { data: comments, isLoading: isCommentsLoading, refetch: refetchComments } = useQuery({
    queryKey: ["comments", post.id],
    queryFn: async () => {
      const data = await api.get<Comment[]>(`/api/posts/${post.id}/comments`);
      return data;
    },
    enabled: isCommentsOpen,
    staleTime: 30000,
  });

  // Fetch shared alpha users (other traders who called the same token)
  const { data: sharedAlphaUsers } = useQuery({
    queryKey: ["shared-alpha", post.id],
    queryFn: () => api.get<SharedAlphaUser[]>(`/api/posts/${post.id}/shared-alpha`),
    enabled: (post.sharedAlphaCount ?? 0) > 0, // Only fetch if there are shared alphas
    staleTime: 60000,
  });

  // Handle follow/unfollow with optimistic updates
  const handleFollow = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!currentUserId || isFollowLoading) return;

    // Optimistic update - change state immediately
    const wasFollowing = isFollowing;
    setIsFollowing(!wasFollowing);
    setIsFollowLoading(true);

    try {
      if (wasFollowing) {
        await api.delete(`/api/users/${post.author.id}/follow`);
        toast.success(`Unfollowed ${post.author.username || post.author.name}`);
      } else {
        await api.post(`/api/users/${post.author.id}/follow`, {});
        toast.success(`Following ${post.author.username || post.author.name}`);
      }
      // Invalidate relevant queries to refresh data
      queryClient.invalidateQueries({ queryKey: ["posts"] });
      queryClient.invalidateQueries({ queryKey: ["users"] });
      queryClient.invalidateQueries({ queryKey: ["userProfile"] });
      queryClient.invalidateQueries({ queryKey: ["userPosts"] });
      queryClient.invalidateQueries({ queryKey: ["userReposts"] });
    } catch (error) {
      // Revert on error
      setIsFollowing(wasFollowing);
      toast.error("Failed to update follow status");
    } finally {
      setIsFollowLoading(false);
    }
  };

  // Use mcap1h for settled posts, currentMcap for live posts
  const officialMcap = localSettled ? localMcap1h : currentMcap;
  const percentChange = calculatePercentChange(post.entryMcap, officialMcap);
  const isGain = percentChange !== null && percentChange > 0;
  const isLoss = percentChange !== null && percentChange < 0;
  const hasContractAddress = post.contractAddress !== null;
  const winCardProfitLossValue =
    post.entryMcap !== null && officialMcap !== null ? officialMcap - post.entryMcap : null;
  const walletTradeSnapshot = post.walletTradeSnapshot ?? null;
  const verifiedTotalPnlUsd =
    typeof walletTradeSnapshot?.totalPnlUsd === "number" ? walletTradeSnapshot.totalPnlUsd : null;
  const boughtUsd = typeof walletTradeSnapshot?.boughtUsd === "number" ? walletTradeSnapshot.boughtUsd : null;
  const soldUsd = typeof walletTradeSnapshot?.soldUsd === "number" ? walletTradeSnapshot.soldUsd : null;
  const holdingUsd = typeof walletTradeSnapshot?.holdingUsd === "number" ? walletTradeSnapshot.holdingUsd : null;
  const boughtAmount =
    typeof walletTradeSnapshot?.boughtAmount === "number" ? walletTradeSnapshot.boughtAmount : null;
  const soldAmount =
    typeof walletTradeSnapshot?.soldAmount === "number" ? walletTradeSnapshot.soldAmount : null;
  const holdingAmount =
    typeof walletTradeSnapshot?.holdingAmount === "number" ? walletTradeSnapshot.holdingAmount : null;
  const hasWalletTradeInfo =
    verifiedTotalPnlUsd !== null ||
    boughtUsd !== null ||
    soldUsd !== null ||
    boughtAmount !== null ||
    soldAmount !== null ||
    holdingUsd !== null ||
    holdingAmount !== null;
  const formatUsdCompact = (value: number) =>
    new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: "USD",
      notation: Math.abs(value) >= 1000 ? "compact" : "standard",
      maximumFractionDigits: Math.abs(value) >= 1000 ? 1 : 2,
    }).format(value);
  const winCardSettledWin = localSettled && localIsWin === true;
  const winCardSettledLoss = localSettled && localIsWin === false;
  const winCardAccentClass =
    winCardSettledWin || (!localSettled && (winCardProfitLossValue ?? 0) >= 0)
      ? "text-gain"
      : winCardSettledLoss
        ? "text-loss"
        : "text-muted-foreground";
  const winCardResultLabel = localSettled ? (winCardSettledWin ? "WIN CARD" : "RESULT CARD") : "LIVE CARD";
  const winCardResultText =
    percentChange !== null ? `${percentChange >= 0 ? "+" : ""}${percentChange.toFixed(2)}%` : "N/A";
  const winCardVerifiedPnlLabel =
    verifiedTotalPnlUsd === null
      ? null
      : verifiedTotalPnlUsd >= 0
        ? "Wallet Profit"
        : "Wallet Loss";
  const winCardVerifiedPnlText =
    verifiedTotalPnlUsd === null ? null : `${verifiedTotalPnlUsd >= 0 ? "+" : "-"}${formatUsdCompact(Math.abs(verifiedTotalPnlUsd))}`;
  const winCardMarketMoveLabel =
    winCardProfitLossValue === null
      ? "MCAP Delta"
      : winCardProfitLossValue >= 0
        ? "MCAP Gain"
        : "MCAP Drop";
  const winCardMarketMoveText =
    winCardProfitLossValue === null
      ? "N/A"
      : `${winCardProfitLossValue >= 0 ? "+" : "-"}${formatMarketCap(Math.abs(winCardProfitLossValue))}`;
  const winCardTokenPrimary = post.tokenSymbol || post.tokenName || "TOKEN";
  const winCardTokenSecondary =
    post.tokenName && post.tokenSymbol
      ? post.tokenName
      : post.contractAddress
        ? `${post.contractAddress.slice(0, 6)}...${post.contractAddress.slice(-4)}`
        : "No contract";
  const winCardPostPreview = (stripContractAddress(post.content) || post.content || "No description").slice(0, 220);
  const buildWinCardSnapshotMetric = (label: string, snapshotMcap: number | null) => {
    if (post.entryMcap === null || snapshotMcap === null) {
      return {
        label,
        percentText: "Pending",
        profitText: "N/A",
        toneClass: "text-muted-foreground",
        positive: null as boolean | null,
        magnitudeRatio: 0,
      };
    }
    const snapshotPercent = calculatePercentChange(post.entryMcap, snapshotMcap);
    const snapshotProfit = snapshotMcap - post.entryMcap;
    const isPositive = snapshotProfit >= 0;
    const absPercent = snapshotPercent === null ? 0 : Math.abs(snapshotPercent);
    return {
      label,
      percentText:
        snapshotPercent === null ? "N/A" : `${snapshotPercent >= 0 ? "+" : ""}${snapshotPercent.toFixed(2)}%`,
      profitText: `${snapshotProfit >= 0 ? "+" : "-"}${formatMarketCap(Math.abs(snapshotProfit))}`,
      toneClass: isPositive ? "text-gain" : "text-loss",
      positive: isPositive,
      magnitudeRatio: Math.max(0.12, Math.min(1, absPercent / 250)),
    };
  };
  const winCardSnapshotMetrics = [
    buildWinCardSnapshotMetric("1H Snapshot", localMcap1h),
    buildWinCardSnapshotMetric("6H Snapshot", localMcap6h),
    buildWinCardSnapshotMetric("Current", currentMcap),
  ];
  const winCardLevelProgressRatio = Math.max(
    0,
    Math.min(1, (post.author.level - MIN_LEVEL) / (MAX_LEVEL - MIN_LEVEL))
  );
  const winCardLevelLabel =
    post.author.level >= 8
      ? "Elite"
      : post.author.level >= 4
        ? "Veteran"
        : post.author.level >= 1
          ? "Rising"
          : post.author.level >= -2
            ? "Neutral"
            : "Danger";
  const winCardLevelToneClass =
    post.author.level >= 8
      ? "text-amber-300"
      : post.author.level >= 4
        ? "text-slate-200"
        : post.author.level >= 1
          ? "text-orange-300"
          : post.author.level >= -2
            ? "text-rose-200"
            : "text-red-300";

  // Calculate multiplier displays for each mcap field
  const multiplierLive = formatMultiplier(post.entryMcap, currentMcap);
  const multiplier1h = formatMultiplier(post.entryMcap, localMcap1h);
  const multiplier6h = formatMultiplier(post.entryMcap, localMcap6h);
  const multiplierCurrent = formatMultiplier(post.entryMcap, currentMcap);

  // Calculate 6H percent change if available
  const percentChange6h = localMcap6h ? calculatePercentChange(post.entryMcap, localMcap6h) : null;
  const isGain6h = percentChange6h !== null && percentChange6h > 0;
  const isLoss6h = percentChange6h !== null && percentChange6h < 0;

  // Calculate current mcap vs entry (for settled posts showing current as reference)
  const percentChangeCurrent = currentMcap ? calculatePercentChange(post.entryMcap, currentMcap) : null;
  const isGainCurrent = percentChangeCurrent !== null && percentChangeCurrent > 0;
  const isLossCurrent = percentChangeCurrent !== null && percentChangeCurrent < 0;

  // Helper function to get styling classes based on multiplier tier
  const getMultiplierClasses = (display: MultiplierDisplay | null) => {
    if (!display) return { text: "text-muted-foreground", bg: "", glow: "" };

    switch (display.tier) {
      case 'negative':
        return { text: "text-loss", bg: "bg-loss/10", glow: "" };
      case 'low':
        return { text: "text-gain", bg: "bg-gain/10", glow: "" };
      case 'medium':
        return { text: "text-gain font-bold", bg: "bg-gain/15", glow: "" };
      case 'high':
        return { text: "text-yellow-500 font-bold", bg: "bg-yellow-500/15", glow: "" };
      case 'mega':
        return {
          text: "text-yellow-400 font-black",
          bg: "bg-gradient-to-r from-yellow-500/20 to-amber-500/20",
          glow: "shadow-[0_0_20px_rgba(234,179,8,0.4)]"
        };
      default:
        return { text: "text-muted-foreground", bg: "", glow: "" };
    }
  };

  // Calculate time until settlement (1 hour from creation)
  const createdAt = new Date(post.createdAt);
  const settlesAt = new Date(createdAt.getTime() + 60 * 60 * 1000);
  const now = new Date();
  const timeUntilSettlement = Math.max(0, settlesAt.getTime() - now.getTime());
  const minutesLeft = Math.floor(timeUntilSettlement / 60000);
  const isSettlementPending = !localSettled && timeUntilSettlement > 0 && hasContractAddress;

  const sharedByCount = post.sharedBy?.length ?? 0;
  const sharedAlphaCount = post.sharedAlphaCount ?? 0;

  const handleLike = () => {
    setIsLiked(!isLiked);
    setLikeCount(isLiked ? likeCount - 1 : likeCount + 1);
    onLike?.(post.id);
  };

  const handleRepost = () => {
    setIsReposted(!isReposted);
    setRepostCount(isReposted ? repostCount - 1 : repostCount + 1);
    onRepost?.(post.id);
  };

  const handleShare = async () => {
    const url = `${window.location.origin}/post/${post.id}`;
    await navigator.clipboard.writeText(url);
    setCopied(true);
    toast.success("Link copied to clipboard");
    setTimeout(() => setCopied(false), 2000);
  };

  const handleOpenWinCardPreview = () => {
    setIsWinCardPreviewOpen(true);
  };

  const handleDownloadWinCard = async () => {
    if (isWinCardDownloading) return;

    const canvas = document.createElement("canvas");
    const width = 1200;
    const height = 700;
    const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;

    const ctx = canvas.getContext("2d");
    if (!ctx) {
      toast.error("Failed to generate win card");
      return;
    }

    ctx.scale(dpr, dpr);

    const officialValue = officialMcap;
    const profitLossValue =
      post.entryMcap !== null && officialValue !== null ? officialValue - post.entryMcap : null;
    const isSettledWin = localSettled && localIsWin === true;
    const isSettledLoss = localSettled && localIsWin === false;
    const isPositive = profitLossValue !== null ? profitLossValue >= 0 : false;
    const accent = isSettledWin || (!localSettled && isPositive) ? "#22c55e" : isSettledLoss ? "#ef4444" : "#94a3b8";
    const accentSoft = isSettledWin || (!localSettled && isPositive) ? "rgba(34,197,94,0.18)" : isSettledLoss ? "rgba(239,68,68,0.16)" : "rgba(148,163,184,0.16)";
    const bgTop = "#0a0f16";
    const bgBottom = "#080b10";

    const drawRoundedRect = (
      x: number,
      y: number,
      w: number,
      h: number,
      r: number
    ) => {
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.lineTo(x + w - r, y);
      ctx.quadraticCurveTo(x + w, y, x + w, y + r);
      ctx.lineTo(x + w, y + h - r);
      ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
      ctx.lineTo(x + r, y + h);
      ctx.quadraticCurveTo(x, y + h, x, y + h - r);
      ctx.lineTo(x, y + r);
      ctx.quadraticCurveTo(x, y, x + r, y);
      ctx.closePath();
    };

    const drawWrappedText = (
      text: string,
      x: number,
      y: number,
      maxWidth: number,
      lineHeight: number,
      maxLines: number
    ) => {
      const words = text.trim().split(/\s+/);
      const lines: string[] = [];
      let current = "";

      for (const word of words) {
        const next = current ? `${current} ${word}` : word;
        if (ctx.measureText(next).width <= maxWidth) {
          current = next;
          continue;
        }
        if (current) {
          lines.push(current);
          current = word;
        } else {
          lines.push(word);
          current = "";
        }
        if (lines.length >= maxLines) break;
      }

      if (lines.length < maxLines && current) {
        lines.push(current);
      }

      const trimmedLines = lines.slice(0, maxLines);
      if (lines.length > maxLines && trimmedLines.length > 0) {
        trimmedLines[trimmedLines.length - 1] = `${trimmedLines[trimmedLines.length - 1]}…`;
      }

      trimmedLines.forEach((line, index) => {
        ctx.fillText(line, x, y + index * lineHeight);
      });
      return trimmedLines.length;
    };

    const fitTextSingleLine = (text: string, maxWidth: number) => {
      const source = text.trim();
      if (!source) return "";
      if (ctx.measureText(source).width <= maxWidth) return source;
      let value = source;
      while (value.length > 1) {
        value = value.slice(0, -1);
        const candidate = `${value}...`;
        if (ctx.measureText(candidate).width <= maxWidth) {
          return candidate;
        }
      }
      return "...";
    };

    const titleName = post.author.username ? `@${post.author.username}` : post.author.name;
    const tokenPrimary = post.tokenSymbol || post.tokenName || "TOKEN";
    const tokenSecondary = post.tokenName && post.tokenSymbol ? post.tokenName : (post.contractAddress ? `${post.contractAddress.slice(0, 6)}...${post.contractAddress.slice(-4)}` : "No contract");
    const resultLabel = localSettled ? (isSettledWin ? "WIN CARD" : "RESULT CARD") : "LIVE CARD";
    const resultText =
      percentChange !== null
        ? `${percentChange >= 0 ? "+" : ""}${percentChange.toFixed(2)}%`
        : "N/A";
    const verifiedPnlText =
      verifiedTotalPnlUsd === null
        ? null
        : `${verifiedTotalPnlUsd >= 0 ? "+" : "-"}${formatUsdCompact(Math.abs(verifiedTotalPnlUsd))}`;
    const verifiedPnlLabel =
      verifiedTotalPnlUsd === null
        ? null
        : verifiedTotalPnlUsd >= 0
          ? "Wallet Profit"
          : "Wallet Loss";
    const postPreview = stripContractAddress(post.content) || post.content || "No description";
    const logoMarkSrc = exactLogoImageSrc;
    const logoMarkFallbackSrc = "/phew-mark.svg";
    const authorAvatarSrc = getAvatarUrl(post.author.id, post.author.image);
    const loadCanvasImage = (src: string | null | undefined) =>
      new Promise<HTMLImageElement | null>((resolve) => {
        if (!src) {
          resolve(null);
          return;
        }
        const img = new Image();
        if (/^https?:\/\//i.test(src)) {
          img.crossOrigin = "anonymous";
        }
        img.onload = () => resolve(img);
        img.onerror = () => resolve(null);
        img.src = src;
      });
    const loadFirstCanvasImage = async (sources: Array<string | null | undefined>) => {
      for (const src of sources) {
        const img = await loadCanvasImage(src);
        if (img) return img;
      }
      return null;
    };

    setIsWinCardDownloading(true);
    try {
      const [brandMarkImg, authorAvatarImg] = await Promise.all([
        loadFirstCanvasImage([logoMarkSrc, logoMarkFallbackSrc]),
        loadCanvasImage(authorAvatarSrc),
      ]);

      // Background (playful / attention-grabbing, but still premium)
      const gradient = ctx.createLinearGradient(0, 0, width, height);
      gradient.addColorStop(0, "#070a10");
      gradient.addColorStop(0.45, "#091018");
      gradient.addColorStop(1, "#06080d");
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, width, height);

      const ambientLeft = ctx.createRadialGradient(210, 180, 10, 210, 180, 340);
      ambientLeft.addColorStop(0, "rgba(163,230,53,0.18)");
      ambientLeft.addColorStop(0.45, "rgba(132,204,22,0.11)");
      ambientLeft.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = ambientLeft;
      ctx.fillRect(-80, -40, 560, 520);

      const ambientRight = ctx.createRadialGradient(980, 170, 12, 980, 170, 360);
      ambientRight.addColorStop(0, "rgba(45,212,191,0.16)");
      ambientRight.addColorStop(0.45, "rgba(20,184,166,0.10)");
      ambientRight.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = ambientRight;
      ctx.fillRect(660, -60, 520, 520);

      const ambientBottom = ctx.createRadialGradient(300, 640, 20, 300, 640, 300);
      ambientBottom.addColorStop(0, accentSoft);
      ambientBottom.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = ambientBottom;
      ctx.fillRect(20, 420, 540, 260);

      // Motion ribbons
      ctx.save();
      ctx.translate(860, 120);
      ctx.rotate(-0.24);
      const ribbon = ctx.createLinearGradient(-180, 0, 180, 0);
      ribbon.addColorStop(0, "rgba(163,230,53,0.03)");
      ribbon.addColorStop(0.5, "rgba(255,255,255,0.08)");
      ribbon.addColorStop(1, "rgba(45,212,191,0.03)");
      ctx.fillStyle = ribbon;
      drawRoundedRect(-180, -22, 360, 44, 22);
      ctx.fill();
      ctx.restore();

      ctx.save();
      ctx.translate(250, 510);
      ctx.rotate(0.18);
      const ribbon2 = ctx.createLinearGradient(-220, 0, 220, 0);
      ribbon2.addColorStop(0, "rgba(45,212,191,0.03)");
      ribbon2.addColorStop(0.5, "rgba(255,255,255,0.06)");
      ribbon2.addColorStop(1, "rgba(163,230,53,0.03)");
      ctx.fillStyle = ribbon2;
      drawRoundedRect(-220, -20, 440, 40, 20);
      ctx.fill();
      ctx.restore();

      // Diagonal texture streaks
      ctx.save();
      ctx.globalAlpha = 0.08;
      ctx.strokeStyle = "rgba(255,255,255,0.8)";
      ctx.lineWidth = 1;
      for (let i = -height; i < width + height; i += 40) {
        ctx.beginPath();
        ctx.moveTo(i, 0);
        ctx.lineTo(i - 120, height);
        ctx.stroke();
      }
      ctx.restore();

      // Subtle grid
      ctx.strokeStyle = "rgba(255,255,255,0.035)";
      ctx.lineWidth = 1;
      for (let x = 0; x < width; x += 48) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, height);
        ctx.stroke();
      }
      for (let y = 0; y < height; y += 48) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
        ctx.stroke();
      }

      // Confetti sparks for fast visual attention
      const sparkColor = isSettledLoss ? "rgba(248,113,113,0.28)" : "rgba(163,230,53,0.24)";
      ctx.strokeStyle = sparkColor;
      ctx.lineWidth = 2;
      const sparks = [
        [94, 86, 18, -6],
        [148, 96, 24, -8],
        [1098, 112, -18, 6],
        [1062, 124, -28, 10],
        [104, 610, 16, 8],
        [1088, 598, -20, -8],
      ];
      sparks.forEach(([sx, sy, dx, dy]) => {
        ctx.beginPath();
        ctx.moveTo(sx, sy);
        ctx.lineTo(sx + dx, sy + dy);
        ctx.stroke();
      });

      // Main card container
      drawRoundedRect(40, 36, width - 80, height - 72, 28);
      const cardFill = ctx.createLinearGradient(40, 36, width - 40, height - 36);
      cardFill.addColorStop(0, "rgba(9,12,18,0.92)");
      cardFill.addColorStop(0.55, "rgba(10,14,20,0.88)");
      cardFill.addColorStop(1, "rgba(7,10,15,0.90)");
      ctx.fillStyle = cardFill;
      ctx.fill();
      ctx.strokeStyle = "rgba(255,255,255,0.10)";
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.fillStyle = "rgba(255,255,255,0.05)";
      drawRoundedRect(40, 36, width - 80, 10, 28);
      ctx.fill();

      // Header brand
      drawRoundedRect(68, 58, 338, 46, 20);
      const brandPillFill = ctx.createLinearGradient(68, 58, 406, 104);
      brandPillFill.addColorStop(0, "rgba(163,230,53,0.07)");
      brandPillFill.addColorStop(0.45, "rgba(255,255,255,0.04)");
      brandPillFill.addColorStop(1, "rgba(45,212,191,0.07)");
      ctx.fillStyle = brandPillFill;
      ctx.fill();
      ctx.strokeStyle = "rgba(255,255,255,0.08)";
      ctx.stroke();

      drawRoundedRect(76, 68, 28, 28, 10);
      ctx.fillStyle = "rgba(255,255,255,0.05)";
      ctx.fill();
      ctx.strokeStyle = "rgba(255,255,255,0.07)";
      ctx.stroke();
      if (brandMarkImg) {
        ctx.save();
        ctx.beginPath();
        drawRoundedRect(78, 70, 24, 24, 8);
        ctx.clip();
        ctx.drawImage(brandMarkImg, 78, 70, 24, 24);
        ctx.restore();
      }

      ctx.font = "800 18px Inter, system-ui, sans-serif";
      ctx.fillStyle = "rgba(248,250,252,0.92)";
      ctx.fillText("PHEW", 114, 89);
      ctx.fillStyle = "#bfe8c8";
      ctx.fillText(".RUN", 169, 89);
      ctx.fillStyle = "rgba(226,232,240,0.55)";
      ctx.font = "600 9px Inter, system-ui, sans-serif";
      ctx.fillText("PHEW RUNNING THE INTERNET", 114, 76);
      ctx.fillStyle = "rgba(226,232,240,0.60)";
      ctx.font = "700 10px Inter, system-ui, sans-serif";
      ctx.fillText("ALPHA RECEIPT", 288, 86);

      drawRoundedRect(918, 58, 174, 40, 18);
      const resultChipFill = ctx.createLinearGradient(918, 58, 1092, 98);
      resultChipFill.addColorStop(0, accentSoft);
      resultChipFill.addColorStop(1, "rgba(255,255,255,0.04)");
      ctx.fillStyle = resultChipFill;
      ctx.fill();
      ctx.strokeStyle = accent;
      ctx.stroke();
      ctx.fillStyle = "rgba(255,255,255,0.05)";
      drawRoundedRect(924, 64, 46, 28, 14);
      ctx.fill();
      ctx.fillStyle = accent;
      ctx.font = "800 10px Inter, system-ui, sans-serif";
      ctx.fillText("SHARE", 936, 81);
      ctx.font = "700 14px Inter, system-ui, sans-serif";
      ctx.fillText(resultLabel, 977, 83);

      // User / token block
      drawRoundedRect(68, 120, 670, 150, 22);
      const userPanelFill = ctx.createLinearGradient(68, 120, 738, 270);
      userPanelFill.addColorStop(0, "rgba(255,255,255,0.035)");
      userPanelFill.addColorStop(1, "rgba(255,255,255,0.02)");
      ctx.fillStyle = userPanelFill;
      ctx.fill();
      ctx.strokeStyle = "rgba(255,255,255,0.07)";
      ctx.stroke();
      drawRoundedRect(68, 120, 8, 150, 22);
      ctx.fillStyle = accent;
      ctx.globalAlpha = 0.9;
      ctx.fill();
      ctx.globalAlpha = 1;

      // avatar
      ctx.beginPath();
      ctx.arc(108, 170, 24, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(255,255,255,0.07)";
      ctx.fill();
      ctx.strokeStyle = "rgba(255,255,255,0.09)";
      ctx.stroke();
      if (authorAvatarImg) {
        ctx.save();
        ctx.beginPath();
        ctx.arc(108, 170, 22.5, 0, Math.PI * 2);
        ctx.clip();
        ctx.drawImage(authorAvatarImg, 85.5, 147.5, 45, 45);
        ctx.restore();
      } else {
        ctx.fillStyle = "#f8fafc";
        ctx.font = "700 18px Inter, system-ui, sans-serif";
        ctx.textAlign = "center";
        ctx.fillText((post.author.username || post.author.name || "?").charAt(0).toUpperCase(), 108, 177);
        ctx.textAlign = "start";
      }

      ctx.fillStyle = "#f8fafc";
      ctx.font = "700 28px Inter, system-ui, sans-serif";
      ctx.fillText(fitTextSingleLine(titleName, 570), 146, 162);

      ctx.fillStyle = "rgba(226,232,240,0.75)";
      ctx.font = "500 14px Inter, system-ui, sans-serif";
      ctx.fillText(`Level ${post.author.level > 0 ? `+${post.author.level}` : post.author.level}  |  ${formatTimeAgo(post.createdAt)}  |  ${post.chainType?.toUpperCase() || "CHAIN"}`, 146, 188);

      drawRoundedRect(146, 198, 560, 58, 14);
      const tokenChipFill = ctx.createLinearGradient(146, 204, 706, 250);
      tokenChipFill.addColorStop(0, "rgba(163,230,53,0.05)");
      tokenChipFill.addColorStop(0.4, "rgba(255,255,255,0.025)");
      tokenChipFill.addColorStop(1, "rgba(45,212,191,0.05)");
      ctx.fillStyle = tokenChipFill;
      ctx.fill();
      ctx.strokeStyle = "rgba(255,255,255,0.06)";
      ctx.stroke();

      ctx.fillStyle = "#ffffff";
      ctx.font = "700 18px Inter, system-ui, sans-serif";
      ctx.fillText(fitTextSingleLine(tokenPrimary, 450), 162, 219);
      ctx.textAlign = "right";
      ctx.fillStyle = "rgba(248,250,252,0.96)";
      ctx.font = "700 14px Inter, system-ui, sans-serif";
      ctx.fillText(`LVL ${post.author.level > 0 ? `+${post.author.level}` : post.author.level}`, 690, 218);
      ctx.textAlign = "start";
      ctx.fillStyle = "rgba(226,232,240,0.75)";
      ctx.font = "500 12px Inter, system-ui, sans-serif";
      ctx.fillText(`${tokenSecondary} | ${winCardLevelLabel}`, 162, 237);
      const levelTrackX = 162;
      const levelTrackY = 243;
      const levelTrackW = 528;
      const levelTrackH = 8;
      drawRoundedRect(levelTrackX, levelTrackY, levelTrackW, levelTrackH, 4);
      ctx.fillStyle = "rgba(255,255,255,0.10)";
      ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,0.07)";
      drawRoundedRect(levelTrackX + levelTrackW * 0.333 - 1, levelTrackY - 1, 2, levelTrackH + 2, 1);
      ctx.fill();
      const levelFillW = Math.max(10, Math.round(levelTrackW * winCardLevelProgressRatio));
      const levelFill = ctx.createLinearGradient(levelTrackX, levelTrackY, levelTrackX + levelFillW, levelTrackY);
      if (post.author.level >= 8) {
        levelFill.addColorStop(0, "#f59e0b");
        levelFill.addColorStop(1, "#fde68a");
      } else if (post.author.level >= 4) {
        levelFill.addColorStop(0, "#94a3b8");
        levelFill.addColorStop(1, "#e2e8f0");
      } else if (post.author.level >= 1) {
        levelFill.addColorStop(0, "#f97316");
        levelFill.addColorStop(1, "#fdba74");
      } else if (post.author.level >= -2) {
        levelFill.addColorStop(0, "#fb7185");
        levelFill.addColorStop(1, "#fecdd3");
      } else {
        levelFill.addColorStop(0, "#dc2626");
        levelFill.addColorStop(1, "#f87171");
      }
      drawRoundedRect(levelTrackX, levelTrackY, levelFillW, levelTrackH, 4);
      ctx.fillStyle = levelFill;
      ctx.fill();

      // Result hero
      drawRoundedRect(760, 120, 332, 150, 22);
      const resultPanelFill = ctx.createLinearGradient(760, 120, 1092, 270);
      resultPanelFill.addColorStop(0, "rgba(255,255,255,0.035)");
      resultPanelFill.addColorStop(0.55, "rgba(255,255,255,0.02)");
      resultPanelFill.addColorStop(1, "rgba(255,255,255,0.028)");
      ctx.fillStyle = resultPanelFill;
      ctx.fill();
      ctx.strokeStyle = "rgba(255,255,255,0.07)";
      ctx.stroke();
      drawRoundedRect(760, 120, 332, 10, 22);
      const resultTopFill = ctx.createLinearGradient(760, 120, 1092, 130);
      resultTopFill.addColorStop(0, accentSoft);
      resultTopFill.addColorStop(1, "rgba(255,255,255,0.01)");
      ctx.fillStyle = resultTopFill;
      ctx.fill();

      ctx.fillStyle = "rgba(226,232,240,0.75)";
      ctx.font = "600 13px Inter, system-ui, sans-serif";
      ctx.fillText("Post Performance", 786, 148);

      ctx.fillStyle = accent;
      ctx.shadowColor = `${accent}55`;
      ctx.shadowBlur = 16;
      ctx.font = "800 44px Inter, system-ui, sans-serif";
      ctx.fillText(resultText, 786, 205);
      ctx.shadowBlur = 0;
      ctx.fillStyle = "rgba(226,232,240,0.60)";
      ctx.font = "700 10px Inter, system-ui, sans-serif";
      ctx.fillText("SHARE-READY", 1004, 148);

      if (verifiedPnlText && verifiedPnlLabel) {
        ctx.fillStyle = "rgba(226,232,240,0.72)";
        ctx.font = "600 14px Inter, system-ui, sans-serif";
        ctx.fillText(verifiedPnlLabel, 786, 235);
        ctx.fillStyle = verifiedTotalPnlUsd !== null && verifiedTotalPnlUsd >= 0 ? "#bbf7d0" : "#fecaca";
        ctx.font = "700 18px Inter, system-ui, sans-serif";
        ctx.fillText(verifiedPnlText, 786, 257);
      }

      // Metrics row
      const metricY = 296;
      const metricW = 328;
      const metricGap = 18;
      const metricX1 = 68;
      const metricX2 = metricX1 + metricW + metricGap;
      const metricX3 = metricX2 + metricW + metricGap;
      const metricH = 126;

      const drawMetricCard = (x: number, title: string, value: string, sub?: string, valueColor = "#f8fafc") => {
        drawRoundedRect(x, metricY, metricW, metricH, 18);
        const metricFill = ctx.createLinearGradient(x, metricY, x + metricW, metricY + metricH);
        metricFill.addColorStop(0, "rgba(255,255,255,0.03)");
        metricFill.addColorStop(1, "rgba(255,255,255,0.02)");
        ctx.fillStyle = metricFill;
        ctx.fill();
        ctx.strokeStyle = "rgba(255,255,255,0.06)";
        ctx.stroke();
        ctx.fillStyle = "rgba(255,255,255,0.045)";
        drawRoundedRect(x, metricY, metricW, 8, 18);
        ctx.fill();

        ctx.fillStyle = "rgba(226,232,240,0.72)";
        ctx.font = "600 12px Inter, system-ui, sans-serif";
        ctx.fillText(title, x + 18, metricY + 28);

        ctx.fillStyle = valueColor;
        ctx.font = "800 30px Inter, system-ui, sans-serif";
        ctx.fillText(value, x + 18, metricY + 70);

        if (sub) {
          ctx.fillStyle = "rgba(226,232,240,0.6)";
          ctx.font = "500 12px Inter, system-ui, sans-serif";
          ctx.fillText(sub, x + 18, metricY + 96);
        }
      };

      const drawSnapshotsCard = (x: number) => {
        drawRoundedRect(x, metricY, metricW, metricH, 18);
        const snapFill = ctx.createLinearGradient(x, metricY, x + metricW, metricY + metricH);
        snapFill.addColorStop(0, "rgba(163,230,53,0.03)");
        snapFill.addColorStop(0.5, "rgba(255,255,255,0.02)");
        snapFill.addColorStop(1, "rgba(45,212,191,0.03)");
        ctx.fillStyle = snapFill;
        ctx.fill();
        ctx.strokeStyle = "rgba(255,255,255,0.06)";
        ctx.stroke();

        ctx.fillStyle = "rgba(226,232,240,0.72)";
        ctx.font = "600 12px Inter, system-ui, sans-serif";
        ctx.fillText("Snapshots", x + 18, metricY + 28);

        const rows = [
          { short: "1H", ...winCardSnapshotMetrics[0] },
          { short: "6H", ...winCardSnapshotMetrics[1] },
          { short: "NOW", ...winCardSnapshotMetrics[2] },
        ];

        rows.forEach((row, index) => {
          const rowY = metricY + 52 + index * 22;
          const barX = x + 18;
          const barY = rowY + 4;
          const barW = 28;
          const fillW = Math.max(4, Math.round(barW * row.magnitudeRatio));
          const barColor = row.positive === null ? "rgba(148,163,184,0.45)" : row.positive ? "rgba(34,197,94,0.75)" : "rgba(239,68,68,0.75)";
          ctx.fillStyle = "rgba(255,255,255,0.08)";
          drawRoundedRect(barX, barY, barW, 4, 2);
          ctx.fill();
          ctx.fillStyle = barColor;
          drawRoundedRect(barX, barY, fillW, 4, 2);
          ctx.fill();

          ctx.fillStyle = "rgba(226,232,240,0.7)";
          ctx.font = "700 11px Inter, system-ui, sans-serif";
          ctx.fillText(row.short, x + 56, rowY);

          ctx.fillStyle =
            row.positive === null ? "#cbd5e1" : row.positive ? "#22c55e" : "#ef4444";
          ctx.font = "700 12px Inter, system-ui, sans-serif";
          ctx.fillText(row.percentText, x + 94, rowY);

          ctx.textAlign = "right";
          ctx.fillStyle =
            row.positive === null ? "rgba(226,232,240,0.72)" : row.positive ? "#bbf7d0" : "#fecaca";
          ctx.fillText(row.profitText, x + metricW - 18, rowY);
          ctx.textAlign = "start";
        });
      };

      drawMetricCard(metricX1, "Entry MCAP", formatMarketCap(post.entryMcap), "Position open");
      drawMetricCard(metricX2, localSettled ? "Official MCAP" : "Current MCAP", formatMarketCap(officialValue), localSettled ? "1H settlement benchmark" : "Live market snapshot");
      drawSnapshotsCard(metricX3);

      // Post text panel
      drawRoundedRect(68, 442, width - 136, 150, 20);
      const postPanelFill = ctx.createLinearGradient(68, 442, width - 68, 592);
      postPanelFill.addColorStop(0, "rgba(255,255,255,0.025)");
      postPanelFill.addColorStop(1, "rgba(255,255,255,0.018)");
      ctx.fillStyle = postPanelFill;
      ctx.fill();
      ctx.strokeStyle = "rgba(255,255,255,0.06)";
      ctx.stroke();

      let postPanelTextY = 504;
      let postPanelMaxLines = 3;
      ctx.fillStyle = "rgba(226,232,240,0.72)";
      ctx.font = "600 12px Inter, system-ui, sans-serif";
      ctx.fillText("Alpha Call Notes", 88, 470);

      if (hasWalletTradeInfo) {
        const parts: string[] = [];
        if (verifiedPnlText && verifiedPnlLabel) parts.push(`Wallet P/L ${verifiedPnlText}`);
        if (boughtUsd !== null) parts.push(`Bought ${formatUsdCompact(boughtUsd)}`);
        if (soldUsd !== null) parts.push(`Sold ${formatUsdCompact(soldUsd)}`);
        if (boughtAmount !== null) parts.push(`Bought Qty ${boughtAmount.toLocaleString(undefined, { maximumFractionDigits: 4 })}`);
        if (soldAmount !== null) parts.push(`Sold Qty ${soldAmount.toLocaleString(undefined, { maximumFractionDigits: 4 })}`);
        if (holdingUsd !== null) parts.push(`Held ${formatUsdCompact(holdingUsd)}`);
        if (holdingAmount !== null) parts.push(`Qty ${holdingAmount.toLocaleString(undefined, { maximumFractionDigits: 4 })}`);

        if (parts.length > 0) {
          ctx.fillStyle = "rgba(226,232,240,0.72)";
          ctx.font = "600 12px Inter, system-ui, sans-serif";
          ctx.fillText("Wallet Summary", 88, 492);
          ctx.fillStyle = "rgba(226,232,240,0.9)";
          ctx.font = "500 11px Inter, system-ui, sans-serif";
          drawWrappedText(parts.join(" | "), 88, 512, width - 176, 18, 2);
          postPanelTextY = 548;
          postPanelMaxLines = 2;
        }
      }

      ctx.fillStyle = "#e5e7eb";
      ctx.font = "500 20px Inter, system-ui, sans-serif";
      drawWrappedText(postPreview, 88, postPanelTextY, width - 176, 26, postPanelMaxLines);

      // Footer
      ctx.strokeStyle = "rgba(255,255,255,0.06)";
      ctx.beginPath();
      ctx.moveTo(68, 614);
      ctx.lineTo(width - 68, 614);
      ctx.stroke();

      ctx.fillStyle = "rgba(226,232,240,0.68)";
      ctx.font = "500 12px Inter, system-ui, sans-serif";
      ctx.fillText("Generated on PHEW.RUN - Share your receipts", 88, 642);
      ctx.fillText(`Post ID: ${post.id.slice(0, 10)}...`, 88, 662);

      const interactions = `${likeCount} likes | ${commentCount} comments | ${repostCount} reposts`;
      ctx.textAlign = "right";
      ctx.fillText(interactions, width - 88, 642);
      ctx.fillText(
        localSettled ? "Settlement-based result snapshot" : "Live result snapshot (updates over time)",
        width - 88,
        662
      );
      ctx.textAlign = "start";

      const filenameBase = (post.tokenSymbol || post.author.username || post.author.name || "phew-post")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 32) || "phew-post";
      const filename = `phew-${localSettled && isSettledWin ? "wincard" : "result-card"}-${filenameBase}.png`;

      const triggerDownload = (url: string) => {
        const link = document.createElement("a");
        link.href = url;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        link.remove();
      };

      if (canvas.toBlob) {
        await new Promise<void>((resolve, reject) => {
          canvas.toBlob((blob) => {
            if (!blob) {
              reject(new Error("Failed to render image"));
              return;
            }
            const objectUrl = URL.createObjectURL(blob);
            triggerDownload(objectUrl);
            setTimeout(() => URL.revokeObjectURL(objectUrl), 1500);
            resolve();
          }, "image/png");
        });
      } else {
        triggerDownload(canvas.toDataURL("image/png"));
      }

      toast.success(localSettled && isSettledWin ? "Wincard downloaded" : "Result card downloaded");
    } catch (error) {
      console.error("[wincard] Failed to generate card", error);
      toast.error("Failed to generate win card");
    } finally {
      setIsWinCardDownloading(false);
    }
  };

  const handleSubmitComment = async () => {
    if (!commentText.trim() || !currentUserId) return;
    const trimmedComment = commentText.trim();
    const previousComments = queryClient.getQueryData<Comment[]>(["comments", post.id]);
    const optimisticCommentId = `optimistic-${post.id}-${Date.now()}`;
    const optimisticComment: Comment = {
      id: optimisticCommentId,
      content: trimmedComment,
      authorId: currentUserId,
      author: {
        id: currentUserId,
        name: "You",
        username: null,
        image: null,
        level: 0,
        xp: 0,
      },
      postId: post.id,
      createdAt: new Date().toISOString(),
    };

    try {
      setCommentText("");
      setCommentCount((prev) => prev + 1);
      if (isCommentsOpen && previousComments) {
        queryClient.setQueryData<Comment[]>(["comments", post.id], [optimisticComment, ...previousComments]);
      }

      if (onComment) {
        await onComment(post.id, trimmedComment);
      } else {
        await api.post(`/api/posts/${post.id}/comments`, { content: trimmedComment });
      }
      void refetchComments();
    } catch (error: unknown) {
      setCommentText(trimmedComment);
      setCommentCount((prev) => Math.max(0, prev - 1));
      if (isCommentsOpen && previousComments) {
        queryClient.setQueryData<Comment[]>(["comments", post.id], previousComments);
      }
      const err = error as { message?: string };
      toast.error(err.message || "Failed to add comment");
    }
  };

  const getDexscreenerUrl = () => {
    if (post.dexscreenerUrl) return post.dexscreenerUrl;
    if (!post.contractAddress) return null;
    const chain = post.chainType === "solana" ? "solana" : "ethereum";
    return `https://dexscreener.com/${chain}/${post.contractAddress}`;
  };

  const isPumpFunToken = () => {
    if (!post.contractAddress || post.chainType !== "solana") return null;
    const normalizedCa = post.contractAddress.trim().toLowerCase();
    const sourceUrl = (post.dexscreenerUrl ?? "").toLowerCase();
    const looksLikePumpFun =
      normalizedCa.endsWith("pump") ||
      sourceUrl.includes("pump.fun") ||
      sourceUrl.includes("pumpfun");
    return looksLikePumpFun;
  };

  const getPumpFunUrl = (allowFallback = false) => {
    if (!post.contractAddress || post.chainType !== "solana") return null;
    if (isPumpFunToken() || allowFallback) {
      return `https://pump.fun/coin/${post.contractAddress}`;
    }
    return null;
  };

  const dexscreenerUrl = getDexscreenerUrl();
  const pumpFunUrl = getPumpFunUrl(true);
  const isPumpFunDetected = !!isPumpFunToken();
  const marketButtonsTone =
    !localSettled
      ? "border-primary/20 bg-primary/5"
      : localIsWin
        ? "border-gain/20 bg-gain/5"
        : "border-loss/20 bg-loss/5";
  const marketButtonsGlow =
    !localSettled
      ? "shadow-[0_0_0_1px_rgba(148,163,184,0.08),0_16px_38px_-24px_rgba(148,163,184,0.35)]"
      : localIsWin
        ? "shadow-[0_0_0_1px_rgba(34,197,94,0.08),0_16px_38px_-24px_rgba(34,197,94,0.35)]"
        : "shadow-[0_0_0_1px_rgba(239,68,68,0.08),0_16px_38px_-24px_rgba(239,68,68,0.30)]";

  // Navigate to user profile (prefer username over ID for cleaner URLs)
  const handleProfileClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    const profilePath = post.author.username || post.author.id;
    navigate(`/profile/${profilePath}`);
  };

  return (
    <div
      ref={cardRef}
      className={cn(
        "group relative bg-card border border-border rounded-xl transition-all duration-300",
        "hover:border-primary/30 hover:shadow-lg",
        localSettled && localIsWin && "border-gain/20",
        localSettled && !localIsWin && "border-loss/20",
        className
      )}
    >
      {/* Glow overlay for settled posts */}
      {localSettled && (
        <div
          className={cn(
            "absolute inset-0 rounded-xl opacity-5 pointer-events-none",
            localIsWin ? "bg-gain" : "bg-loss"
          )}
        />
      )}

      <div className="p-4">
        {/* Header */}
        <div className="flex items-start gap-3">
          <Avatar
            className="h-11 w-11 border-2 border-border ring-2 ring-background cursor-pointer hover:ring-primary/50 transition-all"
            onClick={handleProfileClick}
          >
            <AvatarImage src={getAvatarUrl(post.author.id, post.author.image)} />
            <AvatarFallback className="bg-muted text-muted-foreground text-sm font-medium">
              {post.author.name?.charAt(0) || "?"}
            </AvatarFallback>
          </Avatar>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <button
                onClick={handleProfileClick}
                className="font-semibold text-foreground truncate hover:text-primary hover:underline transition-colors"
              >
                {post.author.username || post.author.name}
              </button>
              {post.author.isVerified ? <VerifiedBadge size="sm" /> : null}
              <LevelBadge level={post.author.level} />
              <span className="text-muted-foreground text-xs">
                {formatTimeAgo(post.createdAt)}
              </span>
              {/* Follow Button - Only show if logged in and not own post */}
              {currentUserId && currentUserId !== post.author.id && (
                <button
                  onClick={handleFollow}
                  disabled={isFollowLoading}
                  className={cn(
                    "ml-auto flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium transition-all",
                    isFollowing
                      ? "bg-primary/10 text-primary border border-primary/30 hover:bg-primary/20"
                      : "bg-primary text-primary-foreground hover:bg-primary/90"
                  )}
                >
                  {isFollowLoading ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : isFollowing ? (
                    <>
                      <UserCheck className="h-3 w-3" />
                      <span>Following</span>
                    </>
                  ) : (
                    <>
                      <UserPlus className="h-3 w-3" />
                      <span>Follow</span>
                    </>
                  )}
                </button>
              )}
            </div>

            {/* Author Level Bar - Larger and Higher Contrast */}
            <div className="mt-2">
              <LevelBar level={post.author.level} size="lg" showLabel={false} />
            </div>

            {/* Token Info Card - Display prominently if contract address exists */}
            {hasContractAddress && post.contractAddress && (
              <div className="mt-3">
                <TokenInfoCard
                  contractAddress={post.contractAddress}
                  chainType={post.chainType}
                  tokenName={post.tokenName}
                  tokenSymbol={post.tokenSymbol}
                  tokenImage={post.tokenImage}
                  dexscreenerUrl={post.dexscreenerUrl}
                />
              </div>
            )}

            {/* Also Called By - Show other users who called this token */}
            {sharedAlphaUsers && sharedAlphaUsers.length > 0 && (
              <AlsoCalledBy
                users={sharedAlphaUsers}
                totalCount={post.sharedAlphaCount ?? sharedAlphaUsers.length}
                onShowMore={() => setIsSharedAlphaOpen(true)}
              />
            )}

            {/* Post content - Cleaned of contract addresses */}
            {(() => {
              const cleanedContent = stripContractAddress(post.content);
              return cleanedContent ? (
                <p className="mt-3 text-foreground text-[15px] leading-relaxed whitespace-pre-wrap break-words">
                  {cleanedContent}
                </p>
              ) : null;
            })()}

            {/* Market Cap Info */}
            {hasContractAddress && (
              <div className="mt-4 p-4 bg-secondary/50 rounded-xl border border-border/50">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  {/* Live Badge / Settled Status */}
                  <div className="flex items-center gap-2">
                    {!localSettled && (
                      <div className="flex items-center gap-1.5">
                        <span className="relative flex h-2 w-2">
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75"></span>
                          <span className="relative inline-flex rounded-full h-2 w-2 bg-primary"></span>
                        </span>
                        <span className="text-xs text-primary font-semibold">LIVE</span>
                      </div>
                    )}

                    {localSettled && (
                      <div className="flex items-center gap-1.5">
                        {localIsWin ? (
                          <>
                            <CheckCircle2 className="h-4 w-4 text-gain" />
                            <span className="text-xs text-gain font-semibold">WON</span>
                          </>
                        ) : (
                          <>
                            <XCircle className="h-4 w-4 text-loss" />
                            <span className="text-xs text-loss font-semibold">LOST</span>
                          </>
                        )}
                      </div>
                    )}
                  </div>

                  <div className={cn("flex items-center gap-2 flex-wrap rounded-xl border p-1.5", marketButtonsTone, marketButtonsGlow)}>
                    {/* Dexscreener Link */}
                    {dexscreenerUrl && (
                      <a
                        href={dexscreenerUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={cn(
                          "group/button relative overflow-hidden flex items-center justify-center gap-2 py-2 px-4 rounded-lg font-semibold text-sm",
                          "border border-white/10 text-white/95",
                          !localSettled && "bg-gradient-to-r from-primary/25 via-primary/15 to-white/5 hover:from-primary/30 hover:to-white/10 shadow-lg shadow-primary/15",
                          localSettled && localIsWin && "bg-gradient-to-r from-gain/25 via-gain/15 to-white/5 hover:from-gain/30 hover:to-white/10 shadow-lg shadow-gain/20",
                          localSettled && !localIsWin && "bg-gradient-to-r from-loss/20 via-loss/12 to-white/5 hover:from-loss/25 hover:to-white/10 shadow-lg shadow-loss/15",
                          "transform transition-all duration-200 hover:scale-[1.02] active:scale-[0.98]"
                        )}
                      >
                        <span className="pointer-events-none absolute inset-0 opacity-0 group-hover/button:opacity-100 transition-opacity bg-gradient-to-r from-transparent via-white/10 to-transparent" />
                        {!localSettled && (
                          <span className="relative flex h-2 w-2">
                            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary/70" />
                            <span className="relative inline-flex h-2 w-2 rounded-full bg-primary" />
                          </span>
                        )}
                        <BarChart3 className="h-4 w-4" />
                        <span>Dexscreener</span>
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    )}

                    {pumpFunUrl && (
                      <a
                        href={pumpFunUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        title={isPumpFunDetected ? "Open Pump.fun coin page" : "Open Pump.fun coin page (if listed)"}
                        className={cn(
                          "group/button relative overflow-hidden flex items-center justify-center gap-2 py-2 px-4 rounded-lg font-semibold text-sm",
                          "border text-white",
                          isPumpFunDetected
                            ? "border-emerald-400/40 bg-gradient-to-r from-emerald-500/80 to-green-500/75 shadow-lg shadow-emerald-500/20 hover:from-emerald-400/90 hover:to-green-400/85"
                            : "border-emerald-500/25 bg-gradient-to-r from-emerald-500/35 to-green-500/30 shadow-lg shadow-emerald-600/10 hover:from-emerald-500/45 hover:to-green-500/38",
                          localSettled && !localIsWin && "saturate-[0.9]",
                          "transform transition-all duration-200 hover:scale-[1.02] active:scale-[0.98]"
                        )}
                      >
                        <span className="pointer-events-none absolute inset-0 opacity-0 group-hover/button:opacity-100 transition-opacity bg-gradient-to-r from-transparent via-white/10 to-transparent" />
                        {!localSettled && (
                          <Sparkles className="h-3.5 w-3.5 text-white/90" />
                        )}
                        <Coins className="h-4 w-4" />
                        <span>Trade on Pump</span>
                        {!isPumpFunDetected && (
                          <span className="hidden sm:inline rounded-full border border-white/20 bg-white/10 px-1.5 py-0.5 text-[10px] font-medium">
                            if listed
                          </span>
                        )}
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    )}
                  </div>
                </div>

                {/* Entry Market Cap - Prominent Display */}
                <div className="mt-4 p-3 bg-background/50 rounded-lg border border-border/50">
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium">Entry Market Cap</p>
                  <p className="text-2xl font-bold font-mono text-foreground mt-1">
                    {formatMarketCap(post.entryMcap)}
                  </p>
                </div>

                {/* Market Cap Stats - Different layout for settled vs live */}
                {localSettled ? (
                  <div className="mt-3 space-y-2">
                    {/* 1H Mcap - Official Result (Primary) */}
                    {(() => {
                      const m1hStyles = getMultiplierClasses(multiplier1h);
                      return (
                        <div
                          className={cn(
                            "p-3 rounded-lg border-2 relative overflow-hidden",
                            multiplier1h?.tier === 'mega' && m1hStyles.glow,
                            isGain && "bg-gain/5 border-gain/40",
                            isLoss && "bg-loss/5 border-loss/40",
                            !isGain && !isLoss && "bg-muted/50 border-border"
                          )}
                          style={{
                            boxShadow: multiplier1h?.tier === 'mega'
                              ? "0 0 30px rgba(234, 179, 8, 0.5), inset 0 0 40px rgba(234, 179, 8, 0.1)"
                              : isGain
                              ? "0 0 20px rgba(34, 197, 94, 0.3), inset 0 0 30px rgba(34, 197, 94, 0.05)"
                              : isLoss
                              ? "0 0 20px rgba(239, 68, 68, 0.3), inset 0 0 30px rgba(239, 68, 68, 0.05)"
                              : undefined,
                          }}
                        >
                          <div className="flex items-center justify-between">
                            <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium">
                              1H Snapshot
                            </p>
                            <span
                              className={cn(
                                "text-[9px] font-bold uppercase px-2 py-0.5 rounded-full",
                                isGain && "bg-gain/20 text-gain border border-gain/30",
                                isLoss && "bg-loss/20 text-loss border border-loss/30",
                                !isGain && !isLoss && "bg-primary/20 text-primary border border-primary/30"
                              )}
                            >
                              Official Result
                            </span>
                          </div>
                          <div className="flex items-center justify-between mt-1.5">
                            <p
                              className={cn(
                                "text-xl font-mono font-bold",
                                isGain && "text-gain",
                                isLoss && "text-loss",
                                !isGain && !isLoss && "text-foreground"
                              )}
                            >
                              {formatMarketCap(localMcap1h)}
                            </p>
                            <div className="flex items-center gap-1">
                              {isGain && <TrendingUp className="h-4 w-4 text-gain" />}
                              {isLoss && <TrendingDown className="h-4 w-4 text-loss" />}
                              <span
                                className={cn(
                                  "text-sm font-mono font-bold px-2 py-0.5 rounded",
                                  m1hStyles.text,
                                  multiplier1h?.tier === 'high' && "bg-yellow-500/20",
                                  multiplier1h?.tier === 'mega' && "bg-gradient-to-r from-yellow-500/30 to-amber-500/30 animate-pulse"
                                )}
                              >
                                {multiplier1h?.text ?? "N/A"}
                              </span>
                            </div>
                          </div>
                        </div>
                      );
                    })()}

                    {/* 6H Mcap - Extended Benchmark (if available) */}
                    {localMcap6h !== null && (() => {
                      const m6hStyles = getMultiplierClasses(multiplier6h);
                      return (
                        <div
                          className={cn(
                            "p-2 rounded-lg border",
                            multiplier6h?.tier === 'mega' && m6hStyles.glow,
                            isGain6h && "bg-gain/10 border-gain/30",
                            isLoss6h && "bg-loss/10 border-loss/30",
                            !isGain6h && !isLoss6h && "bg-background/30 border-border/50"
                          )}
                          style={{
                            boxShadow: multiplier6h?.tier === 'mega'
                              ? "0 0 20px rgba(234, 179, 8, 0.4)"
                              : undefined,
                          }}
                        >
                          <div className="flex items-center justify-between">
                            <p className={cn(
                              "text-[10px] uppercase tracking-wider",
                              isGain6h && "text-gain/80",
                              isLoss6h && "text-loss/80",
                              !isGain6h && !isLoss6h && "text-muted-foreground"
                            )}>
                              6H Snapshot
                            </p>
                            <div className="flex items-center gap-1">
                              {isGain6h && <TrendingUp className="h-3 w-3 text-gain" />}
                              {isLoss6h && <TrendingDown className="h-3 w-3 text-loss" />}
                              <span
                                className={cn(
                                  "text-xs font-mono font-medium px-1.5 py-0.5 rounded",
                                  m6hStyles.text,
                                  multiplier6h?.tier === 'high' && "bg-yellow-500/15",
                                  multiplier6h?.tier === 'mega' && "bg-gradient-to-r from-yellow-500/25 to-amber-500/25"
                                )}
                              >
                                {multiplier6h?.text ?? "N/A"}
                              </span>
                            </div>
                          </div>
                          <p className={cn(
                            "text-sm font-mono font-semibold mt-0.5",
                            isGain6h && "text-gain",
                            isLoss6h && "text-loss",
                            !isGain6h && !isLoss6h && "text-foreground"
                          )}>
                            {formatMarketCap(localMcap6h)}
                          </p>
                        </div>
                      );
                    })()}

                    {/* Current Mcap - Same layout as 1H/6H rows */}
                    {(() => {
                      const mCurrentStyles = getMultiplierClasses(multiplierCurrent);
                      return (
                        <div
                          className={cn(
                            "p-2 rounded-lg border",
                            multiplierCurrent?.tier === 'mega' && mCurrentStyles.glow,
                            isGainCurrent && "bg-gain/10 border-gain/30",
                            isLossCurrent && "bg-loss/10 border-loss/30",
                            !isGainCurrent && !isLossCurrent && "bg-background/30 border-border/50"
                          )}
                          style={{
                            boxShadow: multiplierCurrent?.tier === 'mega'
                              ? "0 0 20px rgba(234, 179, 8, 0.4)"
                              : undefined,
                          }}
                        >
                          <div className="flex items-center justify-between">
                            <p className={cn(
                              "text-[10px] uppercase tracking-wider",
                              isGainCurrent && "text-gain/80",
                              isLossCurrent && "text-loss/80",
                              !isGainCurrent && !isLossCurrent && "text-muted-foreground"
                            )}>
                              Current
                            </p>
                            <div className="flex items-center gap-1">
                              {isGainCurrent && <TrendingUp className="h-3 w-3 text-gain" />}
                              {isLossCurrent && <TrendingDown className="h-3 w-3 text-loss" />}
                              <span
                                className={cn(
                                  "text-xs font-mono font-medium px-1.5 py-0.5 rounded",
                                  mCurrentStyles.text,
                                  multiplierCurrent?.tier === 'high' && "bg-yellow-500/15",
                                  multiplierCurrent?.tier === 'mega' && "bg-gradient-to-r from-yellow-500/25 to-amber-500/25"
                                )}
                              >
                                {multiplierCurrent?.text ?? "N/A"}
                              </span>
                            </div>
                          </div>
                          <p className={cn(
                            "text-sm font-mono font-semibold mt-0.5",
                            isGainCurrent && "text-gain",
                            isLossCurrent && "text-loss",
                            !isGainCurrent && !isLossCurrent && "text-foreground"
                          )}>
                            {formatMarketCap(currentMcap)}
                          </p>
                        </div>
                      );
                    })()}
                  </div>
                ) : (
                  /* Live - Before 1H Settlement */
                  <div className="mt-3 grid grid-cols-2 gap-3">
                    {(() => {
                      const mLiveStyles = getMultiplierClasses(multiplierLive);
                      return (
                        <>
                          <div
                            className={cn(
                              "p-2 bg-background/30 rounded-lg border border-primary/20",
                              multiplierLive?.tier === 'mega' && mLiveStyles.glow
                            )}
                            style={{
                              boxShadow: multiplierLive?.tier === 'mega'
                                ? "0 0 20px rgba(234, 179, 8, 0.4)"
                                : undefined,
                            }}
                          >
                            <div className="flex items-center gap-1.5">
                              <span className="relative flex h-2 w-2">
                                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75"></span>
                                <span className="relative inline-flex rounded-full h-2 w-2 bg-primary"></span>
                              </span>
                              <p className="text-[10px] text-primary uppercase tracking-wider font-semibold">LIVE</p>
                            </div>
                            <p className="text-base font-mono font-semibold text-foreground mt-1">
                              {formatMarketCap(currentMcap)}
                            </p>
                          </div>
                          <div
                            className={cn(
                              "p-2 bg-background/30 rounded-lg",
                              multiplierLive?.tier === 'mega' && "border border-yellow-500/30"
                            )}
                          >
                            <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Change</p>
                            <div className="flex items-center gap-1 mt-1">
                              {isGain && <TrendingUp className="h-4 w-4 text-gain" />}
                              {isLoss && <TrendingDown className="h-4 w-4 text-loss" />}
                              <p
                                className={cn(
                                  "text-base font-mono font-bold px-1.5 py-0.5 rounded",
                                  mLiveStyles.text,
                                  multiplierLive?.tier === 'high' && "bg-yellow-500/15",
                                  multiplierLive?.tier === 'mega' && "bg-gradient-to-r from-yellow-500/25 to-amber-500/25 animate-pulse"
                                )}
                              >
                                {multiplierLive?.text ?? "N/A"}
                              </p>
                            </div>
                          </div>
                        </>
                      );
                    })()}
                  </div>
                )}

                {hasWalletTradeInfo && (
                  <div className="mt-3 rounded-lg border border-border/60 bg-background/25 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-[10px] uppercase tracking-wider font-semibold text-foreground/80">
                        Wallet Trade Summary
                      </p>
                    </div>

                    <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {(holdingUsd !== null || holdingAmount !== null) && (
                        <div className="rounded-md border border-border/60 bg-background/40 p-2.5 sm:col-span-2">
                          <div className="flex items-center justify-between gap-2">
                            <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Holding</p>
                            {holdingAmount !== null && (
                              <p className="text-[11px] font-mono text-muted-foreground">
                                Qty {holdingAmount.toLocaleString(undefined, { maximumFractionDigits: 6 })}
                              </p>
                            )}
                          </div>
                          <p className="mt-1 text-sm font-semibold text-foreground">
                            {holdingUsd !== null ? formatUsdCompact(holdingUsd) : "N/A"}
                          </p>
                        </div>
                      )}

                      {verifiedTotalPnlUsd !== null && (
                        <div className="rounded-md border border-border/60 bg-background/40 p-2.5">
                          <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Wallet P/L</p>
                          <p className={cn("mt-1 text-sm font-semibold", verifiedTotalPnlUsd >= 0 ? "text-gain" : "text-loss")}>
                            {winCardVerifiedPnlText}
                          </p>
                        </div>
                      )}

                      {(boughtUsd !== null || boughtAmount !== null) && (
                        <div className="rounded-md border border-border/60 bg-background/40 p-2.5">
                          <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Bought</p>
                          <p className="mt-1 text-sm font-semibold text-foreground">
                            {boughtUsd !== null ? formatUsdCompact(boughtUsd) : "N/A"}
                          </p>
                          {boughtAmount !== null && (
                            <p className="mt-0.5 text-[10px] text-muted-foreground">
                              Qty {boughtAmount.toLocaleString(undefined, { maximumFractionDigits: 6 })}
                            </p>
                          )}
                        </div>
                      )}

                      {(soldUsd !== null || soldAmount !== null) && (
                        <div className="rounded-md border border-border/60 bg-background/40 p-2.5">
                          <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Sold</p>
                          <p className="mt-1 text-sm font-semibold text-foreground">
                            {soldUsd !== null ? formatUsdCompact(soldUsd) : "N/A"}
                          </p>
                          {soldAmount !== null && (
                            <p className="mt-0.5 text-[10px] text-muted-foreground">
                              Qty {soldAmount.toLocaleString(undefined, { maximumFractionDigits: 6 })}
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* Settlement Timer */}
                {isSettlementPending && (
                  <div className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Clock className="h-3.5 w-3.5" />
                    <span>Settles in {minutesLeft}m</span>
                  </div>
                )}
              </div>
            )}

            {/* Shared Alpha Badge - Users who posted same CA within 48 hours */}
            {sharedAlphaCount > 0 && hasContractAddress && (
              <button
                onClick={() => setIsSharedAlphaOpen(true)}
                className={cn(
                  "mt-3 inline-flex items-center gap-2 px-3 py-2 rounded-lg",
                  "bg-gradient-to-r from-accent/10 to-primary/10 hover:from-accent/20 hover:to-primary/20",
                  "border border-accent/30 hover:border-accent/50",
                  "text-sm text-foreground font-medium transition-all duration-200",
                  "hover:shadow-md hover:shadow-accent/10 cursor-pointer group"
                )}
              >
                <Sparkles className="h-4 w-4 text-accent group-hover:animate-pulse" />
                <span className="bg-gradient-to-r from-accent to-primary bg-clip-text text-transparent font-semibold">
                  {sharedAlphaCount} {sharedAlphaCount === 1 ? "trader" : "traders"} called this
                </span>
              </button>
            )}

            {/* Shared By Counter - Clickable Badge (Reposts) */}
            {sharedByCount > 0 && (
              <button
                onClick={() => setIsRepostersOpen(true)}
                className={cn(
                  "mt-3 inline-flex items-center gap-2 px-3 py-2 rounded-lg",
                  "bg-primary/5 hover:bg-primary/10 border border-primary/20",
                  "text-sm text-foreground font-medium transition-all duration-200",
                  "hover:border-primary/40 hover:shadow-sm cursor-pointer"
                )}
              >
                <Users className="h-4 w-4 text-primary" />
                <span>Shared by {sharedByCount} {sharedByCount === 1 ? "other" : "others"}</span>
                <div className="flex -space-x-2 ml-1">
                  {post.sharedBy?.slice(0, 3).map((user) => (
                    <Avatar key={user.id} className="h-6 w-6 border-2 border-background">
                      <AvatarImage src={getAvatarUrl(user.id, user.image)} />
                      <AvatarFallback className="text-[9px] bg-muted">{user.name?.charAt(0)}</AvatarFallback>
                    </Avatar>
                  ))}
                  {sharedByCount > 3 && (
                    <div className="h-6 w-6 rounded-full bg-muted border-2 border-background flex items-center justify-center">
                      <span className="text-[9px] font-medium text-muted-foreground">+{sharedByCount - 3}</span>
                    </div>
                  )}
                </div>
              </button>
            )}
          </div>
        </div>

        {/* Social Buttons */}
        <div className="mt-4 pt-3 border-t border-border/50 flex items-center justify-between">
          <div className="flex items-center gap-1">
            {/* Like Button */}
            <Button
              variant="ghost"
              size="sm"
              onClick={handleLike}
              className={cn(
                "h-9 px-3 gap-1.5 text-muted-foreground hover:text-foreground",
                isLiked && "text-loss hover:text-loss"
              )}
            >
              <Heart className={cn("h-4 w-4", isLiked && "fill-current")} />
              <span className="text-xs font-medium">{likeCount > 0 ? likeCount : ""}</span>
            </Button>

            {/* Comment Button */}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setIsCommentsOpen(!isCommentsOpen)}
              className="h-9 px-3 gap-1.5 text-muted-foreground hover:text-foreground"
            >
              <MessageCircle className={cn("h-4 w-4", isCommentsOpen && "text-primary")} />
              <span className="text-xs font-medium">{commentCount > 0 ? commentCount : ""}</span>
            </Button>

            {/* Repost Button */}
            <Button
              variant="ghost"
              size="sm"
              onClick={handleRepost}
              className={cn(
                "h-9 px-3 gap-1.5 text-muted-foreground hover:text-foreground",
                isReposted && "text-gain hover:text-gain"
              )}
            >
              <Repeat2 className={cn("h-4 w-4", isReposted && "text-gain")} />
              <span className="text-xs font-medium">{repostCount > 0 ? repostCount : ""}</span>
            </Button>

            {/* Share Button */}
            <Button
              variant="ghost"
              size="sm"
              onClick={handleShare}
              className="h-9 px-3 gap-1.5 text-muted-foreground hover:text-foreground"
            >
              {copied ? <Check className="h-4 w-4 text-gain" /> : <Share className="h-4 w-4" />}
            </Button>

            {/* Wincard / Result card preview */}
            <Button
              variant="ghost"
              size="sm"
              onClick={handleOpenWinCardPreview}
              className="h-9 px-3 gap-1.5 text-muted-foreground hover:text-foreground"
              title="Preview shareable win card"
            >
              <Download className="h-4 w-4" />
            </Button>
          </div>

          {/* View Count */}
          {post.viewCount > 0 && (
            <span className="text-xs text-muted-foreground">
              {post.viewCount.toLocaleString()} views
            </span>
          )}
        </div>

        {/* Comments Section - Animated */}
        <AnimatePresence>
          {isCommentsOpen && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ type: "spring", damping: 25, stiffness: 300 }}
              className="overflow-hidden"
            >
              <div className="mt-3 pt-3 border-t border-border/50 space-y-3">
                {/* Add Comment Input */}
                <motion.div
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ type: "spring", damping: 25, stiffness: 300, delay: 0.1 }}
                  className="flex items-center gap-2"
                >
                  <Input
                    placeholder="Add a comment..."
                    value={commentText}
                    onChange={(e) => setCommentText(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleSubmitComment()}
                    className="flex-1 h-9 text-sm bg-secondary/50 border-border/50"
                  />
                  <Button
                    size="sm"
                    onClick={handleSubmitComment}
                    disabled={!commentText.trim()}
                    className="h-9 px-3"
                  >
                    <Send className="h-4 w-4" />
                  </Button>
                </motion.div>

                {/* Comments List */}
                <motion.div
                  initial="hidden"
                  animate="visible"
                  variants={{
                    visible: {
                      transition: {
                        staggerChildren: 0.05
                      }
                    }
                  }}
                  className="space-y-3 max-h-80 overflow-y-auto"
                >
                  {isCommentsLoading ? (
                    <div className="flex items-center justify-center py-4">
                      <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                    </div>
                  ) : comments && comments.length > 0 ? (
                    comments.map((comment) => (
                      <motion.div
                        key={comment.id}
                        variants={{
                          hidden: { opacity: 0, y: -10 },
                          visible: { opacity: 1, y: 0 }
                        }}
                        className="flex items-start gap-2 p-2 bg-secondary/30 rounded-lg"
                      >
                        <Avatar
                          className="h-7 w-7 cursor-pointer border border-border"
                          onClick={() => navigate(`/profile/${comment.author.username || comment.author.id}`)}
                        >
                          <AvatarImage src={getAvatarUrl(comment.author.id, comment.author.image)} />
                          <AvatarFallback className="text-[10px] bg-muted">
                            {comment.author.name?.charAt(0) || "?"}
                          </AvatarFallback>
                        </Avatar>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5">
                            <button
                              onClick={() => navigate(`/profile/${comment.author.username || comment.author.id}`)}
                              className="text-xs font-semibold text-foreground hover:text-primary hover:underline transition-colors"
                            >
                              {comment.author.username || comment.author.name}
                            </button>
                            <LevelBadge level={comment.author.level} className="text-[8px] px-1 py-0" />
                            <span className="text-[10px] text-muted-foreground">
                              {formatTimeAgo(comment.createdAt)}
                            </span>
                          </div>
                          <p className="text-sm text-foreground mt-0.5 break-words">
                            {comment.content}
                          </p>
                        </div>
                      </motion.div>
                    ))
                  ) : (
                    <motion.p
                      variants={{
                        hidden: { opacity: 0, y: -10 },
                        visible: { opacity: 1, y: 0 }
                      }}
                      className="text-sm text-muted-foreground text-center py-4"
                    >
                      No comments yet. Be the first!
                    </motion.p>
                  )}
                </motion.div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <Dialog open={isWinCardPreviewOpen} onOpenChange={setIsWinCardPreviewOpen}>
        <DialogContent className="w-[calc(100vw-0.75rem)] max-w-4xl max-h-[92vh] p-0 overflow-y-auto border-border/60 bg-background/95">
            <DialogHeader className="px-5 sm:px-6 pt-5 pb-3 border-b border-border/50">
              <DialogTitle className="flex items-center gap-2 text-base sm:text-lg">
                <Sparkles className="h-4 w-4 text-primary" />
                Wincard Preview
              </DialogTitle>
              <DialogDescription className="text-xs sm:text-sm">
                Review a share-ready card, then export a PNG built for fast attention.
              </DialogDescription>
            </DialogHeader>

          <div className="p-3 sm:p-5">
            <div className="mx-auto max-w-[980px]">
              <div className="relative overflow-hidden rounded-2xl sm:rounded-[22px] border border-white/10 bg-[#090d13] shadow-[0_28px_90px_-36px_rgba(0,0,0,0.85)] ring-1 ring-white/5">
                <div
                  className="absolute inset-0 opacity-[0.04]"
                  style={{
                    backgroundImage:
                      "linear-gradient(rgba(255,255,255,0.9) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.9) 1px, transparent 1px)",
                    backgroundSize: "34px 34px",
                  }}
                />
                <div className="absolute inset-0 bg-[radial-gradient(circle_at_18%_12%,rgba(163,230,53,0.14),transparent_42%),radial-gradient(circle_at_88%_16%,rgba(45,212,191,0.14),transparent_42%),radial-gradient(circle_at_22%_88%,rgba(148,163,184,0.08),transparent_48%)]" />
                <div className="absolute inset-0 opacity-[0.08] [background-image:linear-gradient(120deg,transparent_0%,rgba(255,255,255,0.6)_48%,transparent_52%)] [background-size:260px_100%]" />
                <div
                  className={cn(
                    "absolute -top-20 right-[-6%] h-64 w-64 rounded-full blur-3xl",
                    winCardSettledWin || (!localSettled && (winCardProfitLossValue ?? 0) >= 0)
                      ? "bg-gain/20"
                      : winCardSettledLoss
                        ? "bg-loss/20"
                        : "bg-slate-400/20"
                  )}
                />
                <div className="absolute -bottom-20 left-[-8%] h-64 w-64 rounded-full blur-3xl bg-primary/10" />
                <div className="absolute inset-x-0 top-0 h-14 bg-gradient-to-r from-lime-300/8 via-white/5 to-teal-300/8" />
                <div className="absolute inset-x-8 top-20 h-px bg-gradient-to-r from-transparent via-white/10 to-transparent" />
                <div className="absolute -left-8 top-52 h-32 w-32 rounded-full border border-white/5 bg-white/[0.015]" />
                <div className="absolute -right-10 bottom-28 h-40 w-40 rounded-full border border-white/5 bg-white/[0.015]" />

                <div className="relative p-3.5 sm:p-6">
                  <div className="mb-4 flex flex-col items-start gap-2.5 sm:flex-row sm:items-center sm:justify-between">
                    <div className="inline-flex items-center gap-2.5 rounded-full border border-white/10 bg-gradient-to-r from-white/5 via-white/4 to-white/5 px-2.5 py-1.5 shadow-[0_10px_30px_-18px_rgba(0,0,0,0.9)]">
                      <div className="h-7 w-7 rounded-md border border-white/10 bg-white/5 p-0.5">
                        <img
                          src={exactLogoImageSrc}
                          alt="Phew"
                          className="h-full w-full object-cover rounded-[5px]"
                          loading="lazy"
                        />
                      </div>
                      <div className="leading-tight">
                        <div className="text-xs font-semibold tracking-wide">
                          <span className="text-white/90">PHEW</span>
                          <span className="text-[#c0e5cb]">.RUN</span>
                        </div>
                        <div className="hidden sm:block text-[9px] tracking-[0.12em] text-slate-300/60">
                          PHEW RUNNING THE INTERNET
                        </div>
                      </div>
                    </div>
                    <div
                      className={cn(
                        "rounded-full border px-3 py-1 text-[11px] font-semibold tracking-[0.14em] shadow-[0_8px_24px_-18px_rgba(0,0,0,0.8)]",
                        winCardSettledWin || (!localSettled && (winCardProfitLossValue ?? 0) >= 0)
                          ? "border-gain/40 bg-gain/10 text-gain"
                          : winCardSettledLoss
                            ? "border-loss/40 bg-loss/10 text-loss"
                            : "border-border/60 bg-white/5 text-muted-foreground"
                      )}
                    >
                      {winCardResultLabel}
                    </div>
                  </div>

                  <div className="mb-3 rounded-xl border border-white/10 bg-gradient-to-r from-lime-300/5 via-white/5 to-teal-300/5 px-3.5 py-2.5 text-[11px] sm:text-xs text-slate-200/85 shadow-[0_12px_32px_-24px_rgba(0,0,0,0.9)]">
                    Share-ready alpha receipt with settlement snapshots and engagement proof.
                  </div>

                  <div className="grid gap-3 sm:gap-4 lg:grid-cols-[1.2fr_0.8fr]">
                    <div className="rounded-xl border border-white/10 bg-gradient-to-br from-white/6 to-white/4 p-3.5 sm:p-4 shadow-[0_18px_50px_-36px_rgba(0,0,0,0.9)]">
                      <div className="flex items-center gap-3">
                        <Avatar className="h-11 w-11 border border-white/10">
                          <AvatarImage src={getAvatarUrl(post.author.id, post.author.image)} />
                          <AvatarFallback className="bg-white/5 text-sm font-bold text-white">
                            {(post.author.username || post.author.name || "?").charAt(0).toUpperCase()}
                          </AvatarFallback>
                        </Avatar>
                        <div className="min-w-0">
                          <div className="truncate text-lg font-semibold text-white">
                            {post.author.username ? `@${post.author.username}` : post.author.name}
                          </div>
                          <div className="truncate text-[11px] sm:text-xs text-slate-300/80">
                            Level {post.author.level > 0 ? `+${post.author.level}` : post.author.level} | {formatTimeAgo(post.createdAt)} | {post.chainType?.toUpperCase() || "CHAIN"}
                          </div>
                        </div>
                      </div>
                      <div className="mt-4 rounded-xl border border-white/10 bg-black/20 p-3 shadow-inner shadow-black/30">
                        <div className="mb-2 inline-flex items-center rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] font-medium tracking-[0.12em] text-slate-300/75">
                          TOKEN CALL
                        </div>
                        <div className="text-sm font-semibold text-white truncate">{winCardTokenPrimary}</div>
                        <div className="mt-1 text-xs text-slate-300/80 truncate">{winCardTokenSecondary}</div>
                      </div>
                      <div className="mt-3 rounded-xl border border-white/10 bg-black/20 p-3 shadow-inner shadow-black/25">
                        <div className="mb-2 flex items-center justify-between gap-2">
                          <div className="text-[11px] uppercase tracking-[0.12em] text-slate-300/70">
                            Reputation
                          </div>
                          <div className={cn("text-[11px] font-semibold tracking-wide", winCardLevelToneClass)}>
                            {winCardLevelLabel} · LVL {post.author.level > 0 ? `+${post.author.level}` : post.author.level}
                          </div>
                        </div>
                        <LevelBar
                          level={post.author.level}
                          size="sm"
                          showLabel={false}
                          className="space-y-0"
                        />
                      </div>
                    </div>

                    <div className="relative overflow-hidden rounded-xl border border-white/10 bg-gradient-to-br from-white/6 to-white/4 p-3.5 sm:p-4 shadow-[0_18px_50px_-36px_rgba(0,0,0,0.9)]">
                      <div className="absolute inset-x-0 top-0 h-1.5 bg-gradient-to-r from-lime-300/70 via-white/30 to-teal-300/70" />
                      <div className="text-xs uppercase tracking-[0.14em] text-slate-300/70">Performance</div>
                      <div className={cn("mt-2 text-2xl sm:text-4xl font-bold tracking-tight", winCardAccentClass)}>
                        {winCardResultText}
                      </div>
                      {winCardVerifiedPnlLabel && winCardVerifiedPnlText ? (
                        <>
                          <div className="mt-3 text-xs text-slate-300/75">{winCardVerifiedPnlLabel}</div>
                          <div
                            className={cn(
                              "mt-1 text-base sm:text-lg font-semibold",
                              verifiedTotalPnlUsd !== null && verifiedTotalPnlUsd >= 0 ? "text-gain" : "text-loss"
                            )}
                          >
                            {winCardVerifiedPnlText}
                          </div>
                        </>
                      ) : null}
                      <div className={cn("mt-3 text-xs", winCardVerifiedPnlLabel ? "text-slate-300/60" : "text-slate-300/75")}>
                        {winCardMarketMoveLabel}
                      </div>
                      <div className={cn("mt-1 text-sm sm:text-base font-semibold", winCardAccentClass)}>
                        {winCardMarketMoveText}
                      </div>
                      <div className="mt-4 flex items-center gap-2 text-[11px] text-slate-300/70">
                        <Sparkles className="h-3.5 w-3.5" />
                        Instant proof card for fast sharing
                      </div>
                    </div>
                  </div>

                  <div className="mt-4 grid gap-3 sm:grid-cols-3">
                    <div className="rounded-xl border border-white/10 bg-white/5 p-3">
                      <div className="text-[11px] uppercase tracking-[0.12em] text-slate-300/70">Entry MCAP</div>
                      <div className="mt-1 text-base font-semibold text-white">{formatMarketCap(post.entryMcap)}</div>
                    </div>
                    <div className="rounded-xl border border-white/10 bg-white/5 p-3">
                      <div className="text-[11px] uppercase tracking-[0.12em] text-slate-300/70">
                        {localSettled ? "Official MCAP" : "Current MCAP"}
                      </div>
                      <div className="mt-1 text-base font-semibold text-white">{formatMarketCap(officialMcap)}</div>
                    </div>
                    <div className="rounded-xl border border-white/10 bg-white/5 p-3">
                      <div className="text-[11px] uppercase tracking-[0.12em] text-slate-300/70">Engagement</div>
                      <div className="mt-1 text-xs sm:text-sm font-medium text-white">
                        {likeCount} likes | {commentCount} comments | {repostCount} reposts
                      </div>
                    </div>
                  </div>

                  <div className="mt-4 rounded-xl border border-white/10 bg-white/5 p-3.5">
                    <div className="text-[11px] uppercase tracking-[0.12em] text-slate-300/70">
                      Snapshot Profit Breakdown
                    </div>
                    <div className="mt-3 grid gap-2.5 sm:grid-cols-3">
                      {winCardSnapshotMetrics.map((metric) => (
                        <div
                          key={metric.label}
                          className="rounded-lg border border-white/10 bg-black/20 p-3 shadow-inner shadow-black/20"
                        >
                          <div className="text-[11px] uppercase tracking-[0.1em] text-slate-300/70">
                            {metric.label}
                          </div>
                          <div className="mt-2 h-1.5 rounded-full bg-white/10 overflow-hidden">
                            <div
                              className={cn(
                                "h-full rounded-full",
                                metric.positive === null
                                  ? "bg-white/20"
                                  : metric.positive
                                    ? "bg-gradient-to-r from-lime-300/80 to-green-400/80"
                                    : "bg-gradient-to-r from-rose-400/80 to-red-500/80"
                              )}
                              style={{ width: `${Math.round(metric.magnitudeRatio * 100)}%` }}
                            />
                          </div>
                          <div className={cn("mt-1 text-sm sm:text-base font-semibold", metric.toneClass)}>
                            {metric.percentText}
                          </div>
                          <div
                            className={cn(
                              "mt-0.5 text-xs sm:text-sm",
                              metric.positive === null ? "text-slate-300/75" : metric.toneClass
                            )}
                          >
                            {metric.profitText}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {hasWalletTradeInfo ? (
                    <div className="mt-4 rounded-xl border border-white/10 bg-white/5 p-3.5">
                      <div className="flex items-center justify-between gap-2">
                        <div className="text-[11px] uppercase tracking-[0.12em] text-slate-300/70">
                          Wallet Trade Summary
                        </div>
                      </div>
                      <div className="mt-3 grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
                        {verifiedTotalPnlUsd !== null ? (
                          <div className="rounded-lg border border-white/10 bg-black/20 p-3">
                            <div className="text-[11px] uppercase tracking-[0.1em] text-slate-300/70">Wallet P/L</div>
                            <div className={cn("mt-1 text-sm font-semibold", verifiedTotalPnlUsd >= 0 ? "text-gain" : "text-loss")}>
                              {winCardVerifiedPnlText}
                            </div>
                          </div>
                        ) : null}
                        {boughtUsd !== null || boughtAmount !== null ? (
                          <div className="rounded-lg border border-white/10 bg-black/20 p-3">
                            <div className="text-[11px] uppercase tracking-[0.1em] text-slate-300/70">Bought</div>
                            <div className="mt-1 text-sm font-semibold text-white">
                              {boughtUsd !== null ? formatUsdCompact(boughtUsd) : "N/A"}
                            </div>
                            {boughtAmount !== null ? (
                              <div className="mt-0.5 text-[11px] text-slate-300/75">
                                Qty {boughtAmount.toLocaleString(undefined, { maximumFractionDigits: 6 })}
                              </div>
                            ) : null}
                          </div>
                        ) : null}
                        {soldUsd !== null || soldAmount !== null ? (
                          <div className="rounded-lg border border-white/10 bg-black/20 p-3">
                            <div className="text-[11px] uppercase tracking-[0.1em] text-slate-300/70">Sold</div>
                            <div className="mt-1 text-sm font-semibold text-white">
                              {soldUsd !== null ? formatUsdCompact(soldUsd) : "N/A"}
                            </div>
                            {soldAmount !== null ? (
                              <div className="mt-0.5 text-[11px] text-slate-300/75">
                                Qty {soldAmount.toLocaleString(undefined, { maximumFractionDigits: 6 })}
                              </div>
                            ) : null}
                          </div>
                        ) : null}
                        {holdingUsd !== null || holdingAmount !== null ? (
                          <div className="rounded-lg border border-white/10 bg-black/20 p-3">
                            <div className="text-[11px] uppercase tracking-[0.1em] text-slate-300/70">Holding</div>
                            <div className="mt-1 text-sm font-semibold text-white">
                              {holdingUsd !== null ? formatUsdCompact(holdingUsd) : "N/A"}
                            </div>
                            {holdingAmount !== null ? (
                              <div className="mt-0.5 text-[11px] text-slate-300/75">
                                Qty {holdingAmount.toLocaleString(undefined, { maximumFractionDigits: 6 })}
                              </div>
                            ) : null}
                          </div>
                        ) : null}
                      </div>
                    </div>
                  ) : null}

                  <div className="mt-4 rounded-xl border border-white/10 bg-gradient-to-br from-white/5 to-white/[0.03] p-3.5">
                    <div className="text-[11px] uppercase tracking-[0.12em] text-slate-300/70">Post</div>
                    <p className="mt-1.5 text-sm leading-relaxed text-slate-100 whitespace-pre-wrap break-words">
                      {winCardPostPreview}
                    </p>
                  </div>

                  <div className="mt-4 flex flex-col items-start gap-2 text-[11px] text-slate-300/70 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-2.5 py-1">
                      <Sparkles className="h-3 w-3 text-slate-300/80" />
                      Generated on PHEW.RUN
                    </span>
                    <span className="rounded-full border border-white/10 bg-black/20 px-2.5 py-1">
                      Post ID: {post.id.slice(0, 10)}...
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <DialogFooter className="px-5 sm:px-6 py-4 border-t border-border/50 bg-background/80">
            <Button
              type="button"
              variant="outline"
              onClick={() => setIsWinCardPreviewOpen(false)}
              className="w-full sm:w-auto"
            >
              Close
            </Button>
            <Button
              type="button"
              onClick={handleDownloadWinCard}
              disabled={isWinCardDownloading}
              className="w-full sm:w-auto gap-2"
            >
              {isWinCardDownloading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Download className="h-4 w-4" />
              )}
              Download PNG
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reposters Dialog */}
      <RepostersDialog
        postId={post.id}
        open={isRepostersOpen}
        onOpenChange={setIsRepostersOpen}
        initialCount={sharedByCount}
      />

      {/* Shared Alpha Dialog */}
      <SharedAlphaDialog
        postId={post.id}
        contractAddress={post.contractAddress}
        open={isSharedAlphaOpen}
        onOpenChange={setIsSharedAlphaOpen}
      />
    </div>
  );
}
