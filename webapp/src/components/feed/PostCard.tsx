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
import {
  Post,
  Comment,
  SharedAlphaUser,
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
  CornerDownRight,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

interface PostCardProps {
  post: Post;
  className?: string;
  currentUserId?: string;
  onLike?: (postId: string) => void;
  onRepost?: (postId: string) => void;
  onComment?: (postId: string, content: string, parentCommentId?: string | null) => Promise<void> | void;
}

export function PostCard({ post, className, currentUserId, onLike, onRepost, onComment }: PostCardProps) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const cardRef = useRef<HTMLDivElement>(null);
  const [isCommentsOpen, setIsCommentsOpen] = useState(false);
  const [commentText, setCommentText] = useState("");
  const [replyToCommentId, setReplyToCommentId] = useState<string | null>(null);
  const [replyToCommentName, setReplyToCommentName] = useState<string | null>(null);
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
        const data = await api.get<{
          currentMcap: number | null;
          entryMcap: number | null;
          mcap1h: number | null;
          mcap6h: number | null;
          settled: boolean;
        }>(`/api/posts/${post.id}/price`);

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

  const commentList = comments ?? [];
  const topLevelComments = commentList.filter((comment) => !comment.parentCommentId);
  const repliesByParent = new Map<string, Comment[]>();
  for (const comment of commentList) {
    if (!comment.parentCommentId) continue;
    const existing = repliesByParent.get(comment.parentCommentId) ?? [];
    existing.push(comment);
    repliesByParent.set(comment.parentCommentId, existing);
  }

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
  const winCardProfitLabel =
    winCardProfitLossValue === null
      ? "Total P/L"
      : winCardProfitLossValue >= 0
        ? "Total Profit"
        : "Total Loss";
  const winCardProfitText =
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

    const titleName = post.author.username ? `@${post.author.username}` : post.author.name;
    const tokenPrimary = post.tokenSymbol || post.tokenName || "TOKEN";
    const tokenSecondary = post.tokenName && post.tokenSymbol ? post.tokenName : (post.contractAddress ? `${post.contractAddress.slice(0, 6)}...${post.contractAddress.slice(-4)}` : "No contract");
    const resultLabel = localSettled ? (isSettledWin ? "WIN CARD" : "RESULT CARD") : "LIVE CARD";
    const resultText =
      percentChange !== null
        ? `${percentChange >= 0 ? "+" : ""}${percentChange.toFixed(2)}%`
        : "N/A";
    const totalProfitLossText =
      profitLossValue !== null
        ? `${profitLossValue >= 0 ? "+" : ""}${formatMarketCap(Math.abs(profitLossValue)).replace("$", "$")}${profitLossValue >= 0 ? "" : ""}`
        : "N/A";
    const totalProfitLossLabel =
      profitLossValue === null
        ? "Total P/L"
        : profitLossValue >= 0
          ? "Total Profit"
          : "Total Loss";
    const postPreview = stripContractAddress(post.content) || post.content || "No description";

    setIsWinCardDownloading(true);
    try {
      // Background
      const gradient = ctx.createLinearGradient(0, 0, width, height);
      gradient.addColorStop(0, bgTop);
      gradient.addColorStop(1, bgBottom);
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, width, height);

      // Subtle grid
      ctx.strokeStyle = "rgba(255,255,255,0.04)";
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

      // Accent glows
      const glow1 = ctx.createRadialGradient(980, 80, 20, 980, 80, 220);
      glow1.addColorStop(0, accentSoft);
      glow1.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = glow1;
      ctx.fillRect(760, -60, 420, 320);

      const glow2 = ctx.createRadialGradient(160, 640, 20, 160, 640, 220);
      glow2.addColorStop(0, "rgba(59,130,246,0.12)");
      glow2.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = glow2;
      ctx.fillRect(-80, 420, 420, 280);

      // Main card container
      drawRoundedRect(40, 36, width - 80, height - 72, 28);
      ctx.fillStyle = "rgba(10,14,20,0.82)";
      ctx.fill();
      ctx.strokeStyle = "rgba(255,255,255,0.10)";
      ctx.lineWidth = 1.5;
      ctx.stroke();

      // Header brand
      drawRoundedRect(68, 62, 120, 36, 18);
      ctx.fillStyle = "rgba(255,255,255,0.04)";
      ctx.fill();
      ctx.strokeStyle = "rgba(255,255,255,0.08)";
      ctx.stroke();

      ctx.fillStyle = "#e5e7eb";
      ctx.font = "700 18px Inter, system-ui, sans-serif";
      ctx.fillText("PHEW.RUN", 84, 86);

      drawRoundedRect(932, 62, 160, 36, 18);
      ctx.fillStyle = accentSoft;
      ctx.fill();
      ctx.strokeStyle = accent;
      ctx.stroke();
      ctx.fillStyle = accent;
      ctx.font = "700 15px Inter, system-ui, sans-serif";
      ctx.fillText(resultLabel, 964, 86);

      // User / token block
      drawRoundedRect(68, 120, 670, 150, 22);
      ctx.fillStyle = "rgba(255,255,255,0.03)";
      ctx.fill();
      ctx.strokeStyle = "rgba(255,255,255,0.07)";
      ctx.stroke();

      // avatar placeholder
      ctx.beginPath();
      ctx.arc(108, 170, 24, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(255,255,255,0.07)";
      ctx.fill();
      ctx.strokeStyle = "rgba(255,255,255,0.09)";
      ctx.stroke();
      ctx.fillStyle = "#f8fafc";
      ctx.font = "700 18px Inter, system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText((post.author.username || post.author.name || "?").charAt(0).toUpperCase(), 108, 177);
      ctx.textAlign = "start";

      ctx.fillStyle = "#f8fafc";
      ctx.font = "700 28px Inter, system-ui, sans-serif";
      ctx.fillText(titleName, 146, 162);

      ctx.fillStyle = "rgba(226,232,240,0.75)";
      ctx.font = "500 14px Inter, system-ui, sans-serif";
      ctx.fillText(`Level ${post.author.level > 0 ? `+${post.author.level}` : post.author.level}  •  ${formatTimeAgo(post.createdAt)}  •  ${post.chainType?.toUpperCase() || "CHAIN"}`, 146, 188);

      drawRoundedRect(146, 204, 560, 46, 14);
      ctx.fillStyle = "rgba(255,255,255,0.025)";
      ctx.fill();
      ctx.strokeStyle = "rgba(255,255,255,0.06)";
      ctx.stroke();

      ctx.fillStyle = "#ffffff";
      ctx.font = "700 18px Inter, system-ui, sans-serif";
      ctx.fillText(tokenPrimary, 162, 225);
      ctx.fillStyle = "rgba(226,232,240,0.75)";
      ctx.font = "500 13px Inter, system-ui, sans-serif";
      ctx.fillText(tokenSecondary, 162, 244);

      // Result hero
      drawRoundedRect(760, 120, 332, 150, 22);
      ctx.fillStyle = "rgba(255,255,255,0.03)";
      ctx.fill();
      ctx.strokeStyle = "rgba(255,255,255,0.07)";
      ctx.stroke();

      ctx.fillStyle = "rgba(226,232,240,0.75)";
      ctx.font = "600 13px Inter, system-ui, sans-serif";
      ctx.fillText("Post Performance", 786, 150);

      ctx.fillStyle = accent;
      ctx.font = "800 44px Inter, system-ui, sans-serif";
      ctx.fillText(resultText, 786, 205);

      ctx.fillStyle = "rgba(226,232,240,0.72)";
      ctx.font = "600 14px Inter, system-ui, sans-serif";
      ctx.fillText(totalProfitLossLabel, 786, 235);
      ctx.fillStyle = profitLossValue !== null ? (profitLossValue >= 0 ? "#bbf7d0" : "#fecaca") : "#cbd5e1";
      ctx.font = "700 18px Inter, system-ui, sans-serif";
      ctx.fillText(totalProfitLossText, 786, 257);

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
        ctx.fillStyle = "rgba(255,255,255,0.025)";
        ctx.fill();
        ctx.strokeStyle = "rgba(255,255,255,0.06)";
        ctx.stroke();

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

      drawMetricCard(metricX1, "Entry MCAP", formatMarketCap(post.entryMcap), "Position open");
      drawMetricCard(metricX2, localSettled ? "Official MCAP" : "Current MCAP", formatMarketCap(officialValue), localSettled ? "1H settlement benchmark" : "Live market snapshot");
      drawMetricCard(
        metricX3,
        "Outcome",
        profitLossValue === null ? "N/A" : `${profitLossValue >= 0 ? "+" : "-"}${Math.abs(profitLossValue).toLocaleString(undefined, { maximumFractionDigits: 0 })}`,
        "MCAP delta",
        profitLossValue === null ? "#f8fafc" : profitLossValue >= 0 ? "#22c55e" : "#ef4444"
      );

      // Post text panel
      drawRoundedRect(68, 442, width - 136, 150, 20);
      ctx.fillStyle = "rgba(255,255,255,0.02)";
      ctx.fill();
      ctx.strokeStyle = "rgba(255,255,255,0.06)";
      ctx.stroke();

      ctx.fillStyle = "rgba(226,232,240,0.72)";
      ctx.font = "600 12px Inter, system-ui, sans-serif";
      ctx.fillText("Post", 88, 470);

      ctx.fillStyle = "#e5e7eb";
      ctx.font = "500 20px Inter, system-ui, sans-serif";
      drawWrappedText(postPreview, 88, 504, width - 176, 30, 3);

      // Footer
      ctx.strokeStyle = "rgba(255,255,255,0.06)";
      ctx.beginPath();
      ctx.moveTo(68, 614);
      ctx.lineTo(width - 68, 614);
      ctx.stroke();

      ctx.fillStyle = "rgba(226,232,240,0.68)";
      ctx.font = "500 12px Inter, system-ui, sans-serif";
      ctx.fillText("Generated on PHEW.RUN", 88, 642);
      ctx.fillText(`Post ID: ${post.id.slice(0, 10)}…`, 88, 662);

      const interactions = `${likeCount} likes  •  ${commentCount} comments  •  ${repostCount} reposts`;
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

    try {
      if (onComment) {
        await onComment(post.id, trimmedComment, replyToCommentId);
      } else {
        await api.post(`/api/posts/${post.id}/comments`, {
          content: trimmedComment,
          ...(replyToCommentId ? { parentCommentId: replyToCommentId } : {}),
        });
      }
      setCommentText("");
      setReplyToCommentId(null);
      setReplyToCommentName(null);
      setCommentCount(prev => prev + 1);
      refetchComments();
    } catch (error: unknown) {
      const err = error as { message?: string };
      toast.error(err.message || "Failed to add comment");
    }
  };

  const handleReplyToComment = (comment: Comment) => {
    if (!currentUserId) {
      toast.error("Sign in to reply");
      return;
    }
    setIsCommentsOpen(true);
    setReplyToCommentId(comment.id);
    setReplyToCommentName(comment.author.username || comment.author.name || "user");
  };

  const handleToggleCommentLike = async (comment: Comment) => {
    if (!currentUserId) {
      toast.error("Sign in to like comments");
      return;
    }
    try {
      if (comment.isLiked) {
        await api.delete(`/api/posts/${post.id}/comments/${comment.id}/like`);
      } else {
        await api.post(`/api/posts/${post.id}/comments/${comment.id}/like`);
      }
      await refetchComments();
    } catch (error: unknown) {
      const err = error as { message?: string };
      toast.error(err.message || "Failed to update comment like");
    }
  };

  const renderCommentItem = (comment: Comment, isReply = false) => {
    const commentLikeCount = comment.likeCount ?? 0;
    const commentReplies = repliesByParent.get(comment.id) ?? [];

    return (
      <motion.div
        key={comment.id}
        variants={{
          hidden: { opacity: 0, y: -10 },
          visible: { opacity: 1, y: 0 }
        }}
        className={cn(
          "flex items-start gap-2 p-2 rounded-lg",
          isReply ? "bg-background/40 ml-6 border border-border/30" : "bg-secondary/30"
        )}
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
          <div className="flex items-center gap-1.5 flex-wrap">
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
          <div className="mt-2 flex items-center gap-3">
            <button
              type="button"
              onClick={() => void handleToggleCommentLike(comment)}
              className={cn(
                "inline-flex items-center gap-1 text-[11px] transition-colors",
                comment.isLiked ? "text-primary" : "text-muted-foreground hover:text-foreground"
              )}
            >
              <Heart className={cn("h-3 w-3", comment.isLiked && "fill-current")} />
              <span>{commentLikeCount > 0 ? commentLikeCount : "Like"}</span>
            </button>
            {!isReply && (
              <button
                type="button"
                onClick={() => handleReplyToComment(comment)}
                className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
              >
                <CornerDownRight className="h-3 w-3" />
                <span>{(comment.replyCount ?? commentReplies.length) > 0 ? `Reply (${comment.replyCount ?? commentReplies.length})` : "Reply"}</span>
              </button>
            )}
          </div>
          {!isReply && commentReplies.length > 0 ? (
            <div className="mt-2 space-y-2">
              {commentReplies.map((reply) => renderCommentItem(reply, true))}
            </div>
          ) : null}
        </div>
      </motion.div>
    );
  };

  const getDexscreenerUrl = () => {
    if (post.dexscreenerUrl) return post.dexscreenerUrl;
    if (!post.contractAddress) return null;
    const chain = post.chainType === "solana" ? "solana" : "ethereum";
    return `https://dexscreener.com/${chain}/${post.contractAddress}`;
  };

  const getPumpFunUrl = () => {
    if (!post.contractAddress || post.chainType !== "solana") return null;
    const normalizedCa = post.contractAddress.trim().toLowerCase();
    const sourceUrl = (post.dexscreenerUrl ?? "").toLowerCase();
    const looksLikePumpFun =
      normalizedCa.endsWith("pump") ||
      sourceUrl.includes("pump.fun") ||
      sourceUrl.includes("pumpfun");
    return looksLikePumpFun ? `https://pump.fun/coin/${post.contractAddress}` : null;
  };

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

                  <div className="flex items-center gap-2 flex-wrap">
                    {/* Dexscreener Link */}
                    {getDexscreenerUrl() && (
                      <a
                        href={getDexscreenerUrl() ?? ""}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={cn(
                          "flex items-center justify-center gap-2 py-2 px-4 rounded-lg font-semibold text-sm",
                          "bg-gradient-to-r from-gain/90 to-accent/90 hover:from-gain hover:to-accent",
                          "text-primary-foreground shadow-lg shadow-gain/20",
                          "transform transition-all duration-200 hover:scale-[1.02] active:scale-[0.98]"
                        )}
                      >
                        <BarChart3 className="h-4 w-4" />
                        <span>Dexscreener</span>
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    )}

                    {getPumpFunUrl() && (
                      <a
                        href={getPumpFunUrl() ?? ""}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={cn(
                          "flex items-center justify-center gap-2 py-2 px-4 rounded-lg font-semibold text-sm",
                          "bg-green-600 hover:bg-green-500 border border-green-500/80",
                          "text-white shadow-lg shadow-green-600/20",
                          "transform transition-all duration-200 hover:scale-[1.02] active:scale-[0.98]"
                        )}
                      >
                        <Coins className="h-4 w-4" />
                        <span>Trade on Pump</span>
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
                  className="space-y-2"
                >
                  {replyToCommentId ? (
                    <div className="flex items-center justify-between gap-2 rounded-md border border-primary/20 bg-primary/5 px-3 py-2 text-xs">
                      <span className="text-primary truncate">
                        Replying to @{replyToCommentName || "user"}
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          setReplyToCommentId(null);
                          setReplyToCommentName(null);
                        }}
                        className="text-muted-foreground hover:text-foreground"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : null}
                  <div className="flex items-center gap-2">
                    <Input
                      placeholder={replyToCommentId ? "Write a reply..." : "Add a comment..."}
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
                  </div>
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
                  ) : topLevelComments.length > 0 ? (
                    topLevelComments.map((comment) => renderCommentItem(comment))
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
              <Download className="h-4 w-4 text-primary" />
              Preview Wincard
            </DialogTitle>
            <DialogDescription className="text-xs sm:text-sm">
              Review the shareable result card before downloading the PNG.
            </DialogDescription>
          </DialogHeader>

          <div className="p-3 sm:p-5">
            <div className="mx-auto max-w-3xl">
              <div className="relative overflow-hidden rounded-xl sm:rounded-2xl border border-border/60 bg-[#090d13] shadow-[0_24px_80px_-40px_rgba(0,0,0,0.8)]">
                <div
                  className="absolute inset-0 opacity-[0.04]"
                  style={{
                    backgroundImage:
                      "linear-gradient(rgba(255,255,255,0.9) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.9) 1px, transparent 1px)",
                    backgroundSize: "34px 34px",
                  }}
                />
                <div
                  className={cn(
                    "absolute -top-16 right-[-6%] h-52 w-52 rounded-full blur-3xl",
                    winCardSettledWin || (!localSettled && (winCardProfitLossValue ?? 0) >= 0)
                      ? "bg-gain/20"
                      : winCardSettledLoss
                        ? "bg-loss/20"
                        : "bg-slate-400/20"
                  )}
                />
                <div className="absolute -bottom-16 left-[-8%] h-52 w-52 rounded-full blur-3xl bg-primary/10" />

                <div className="relative p-3.5 sm:p-6">
                  <div className="mb-4 flex flex-col items-start gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1.5">
                      <span className="text-xs font-semibold tracking-wide text-white">PHEW.RUN</span>
                    </div>
                    <div
                      className={cn(
                        "rounded-full border px-3 py-1 text-[11px] font-semibold tracking-wide",
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

                  <div className="grid gap-3 sm:gap-4 lg:grid-cols-[1.2fr_0.8fr]">
                    <div className="rounded-xl border border-white/10 bg-white/5 p-3.5 sm:p-4">
                      <div className="flex items-center gap-3">
                        <div className="h-11 w-11 rounded-full border border-white/10 bg-white/5 flex items-center justify-center text-sm font-bold text-white">
                          {(post.author.username || post.author.name || "?").charAt(0).toUpperCase()}
                        </div>
                        <div className="min-w-0">
                          <div className="truncate text-lg font-semibold text-white">
                            {post.author.username ? `@${post.author.username}` : post.author.name}
                          </div>
                          <div className="truncate text-[11px] sm:text-xs text-slate-300/80">
                            Level {post.author.level > 0 ? `+${post.author.level}` : post.author.level} | {formatTimeAgo(post.createdAt)} | {post.chainType?.toUpperCase() || "CHAIN"}
                          </div>
                        </div>
                      </div>
                      <div className="mt-4 rounded-xl border border-white/10 bg-black/20 p-3">
                        <div className="text-sm font-semibold text-white truncate">{winCardTokenPrimary}</div>
                        <div className="mt-1 text-xs text-slate-300/80 truncate">{winCardTokenSecondary}</div>
                      </div>
                    </div>

                    <div className="rounded-xl border border-white/10 bg-white/5 p-3.5 sm:p-4">
                      <div className="text-xs uppercase tracking-[0.14em] text-slate-300/70">Performance</div>
                      <div className={cn("mt-2 text-2xl sm:text-4xl font-bold tracking-tight", winCardAccentClass)}>
                        {winCardResultText}
                      </div>
                      <div className="mt-3 text-xs text-slate-300/75">{winCardProfitLabel}</div>
                      <div className={cn("mt-1 text-base sm:text-lg font-semibold", winCardAccentClass)}>
                        {winCardProfitText}
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
                    <div className="text-[11px] uppercase tracking-[0.12em] text-slate-300/70">Post</div>
                    <p className="mt-1.5 text-sm leading-relaxed text-slate-100 whitespace-pre-wrap break-words">
                      {winCardPostPreview}
                    </p>
                  </div>

                  <div className="mt-4 flex flex-col items-start gap-1.5 text-[11px] text-slate-300/70 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
                    <span>Generated on PHEW.RUN</span>
                    <span>Post ID: {post.id.slice(0, 10)}...</span>
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
