import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

interface PostCardProps {
  post: Post;
  className?: string;
  currentUserId?: string;
  onLike?: (postId: string) => void;
  onRepost?: (postId: string) => void;
  onComment?: (postId: string, content: string) => void;
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
          // Invalidate posts query to refresh the entire feed
          queryClient.invalidateQueries({ queryKey: ["posts"] });
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

  const handleSubmitComment = async () => {
    if (!commentText.trim() || !currentUserId) return;

    try {
      await api.post(`/api/posts/${post.id}/comments`, { content: commentText.trim() });
      setCommentText("");
      setCommentCount(prev => prev + 1);
      refetchComments();
      onComment?.(post.id, commentText.trim());
      toast.success("Comment added!");
    } catch (error: unknown) {
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
