import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BarChart3, ExternalLink, Heart, LineChart, MessageSquare, MoreVertical, Newspaper, RadioTower, Repeat2, ShieldCheck, TrendingDown, TrendingUp, Vote, Waves, Zap, type LucideIcon } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import {
  isValidCandleSeries,
  isValidRiskLabel,
  isValidSignalScore,
  isValidSmartMoney,
} from "@/lib/data-validators";
import type { TerminalAggregateResponse, TerminalCandle } from "@/components/token/pro-terminal/types";
import { getAvatarUrl, type Post } from "@/types";

type FeedV2PostCardProps = {
  post: Post;
  currentUserId?: string;
  onLike?: (postId: string) => Promise<void> | void;
  onRepost?: (postId: string) => Promise<void> | void;
  onComment?: (postId: string, content: string) => Promise<void> | void;
  onPollVote?: (postId: string, optionId: string) => Promise<void> | void;
};

type FeedPostKind = "call" | "chart" | "whale" | "poll" | "raid" | "news" | "discussion";
type SignalTier = "strong" | "medium" | "partial" | "weak";
type DecisionBadge = {
  label: "STRONG" | "MEDIUM" | "PARTIAL" | "WEAK";
  tone: "strong" | "medium" | "partial" | "weak";
  reason: string;
};

function useNearViewport(rootMargin = "450px") {
  const ref = useRef<HTMLDivElement | null>(null);
  const [isNearViewport, setIsNearViewport] = useState(false);

  useEffect(() => {
    const node = ref.current;
    if (!node || isNearViewport) return;
    if (typeof IntersectionObserver === "undefined") {
      setIsNearViewport(true);
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setIsNearViewport(true);
          observer.disconnect();
        }
      },
      { rootMargin }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [isNearViewport, rootMargin]);

  return { ref, isNearViewport };
}

function compact(value: number | null | undefined, prefix = ""): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "--";
  const formatted = new Intl.NumberFormat("en-US", {
    notation: Math.abs(value) >= 1000 ? "compact" : "standard",
    maximumFractionDigits: Math.abs(value) >= 1000 ? 1 : 2,
  }).format(value);
  return `${prefix}${formatted}`;
}

function pct(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "--";
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}

function timeAgo(value: string): string {
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return "";
  const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (seconds < 15) return "just now";
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

function inferDirection(post: Post): "LONG" | "SHORT" | null {
  const content = post.content.toLowerCase();
  if (content.includes(" short") || content.startsWith("short ") || content.includes("bearish")) return "SHORT";
  if (content.includes(" long") || content.startsWith("long ") || content.includes("bullish")) return "LONG";
  if (typeof post.roiCurrentPct === "number") return post.roiCurrentPct >= 0 ? "LONG" : "SHORT";
  return null;
}

function inferKind(post: Post): FeedPostKind {
  if (post.postType === "poll") return "poll";
  if (post.postType === "news") return "news";
  if (post.postType === "raid") return "raid";
  if (post.postType === "discussion") return "discussion";
  if (post.postType === "chart") return "chart";
  if (post.postType === "alpha") return "call";

  if (post.walletTradeSnapshot || post.itemType === "whale") return "whale";
  if (post.signal?.tokenAddress || post.tokenContext?.address || post.contractAddress || post.tokenSymbol || post.entryMcap !== null || typeof post.confidenceScore === "number") return "call";
  return "discussion";
}

function displayContent(post: Post): string {
  return post.content.replace(/^\[(alpha|discussion|chart|poll|raid|news)\]\s*/i, "");
}

function tokenLabel(post: Post): string {
  const symbol = post.signal?.tokenSymbol ?? post.tokenContext?.symbol ?? post.tokenSymbol;
  const name = post.tokenContext?.name ?? post.tokenName;
  return symbol ? `$${symbol}` : name || "Alpha";
}

function signalTitle(post: Post): string {
  const direction = inferDirection(post);
  return `${tokenLabel(post)}${direction ? ` ${direction}` : ""}`;
}

function signalTier(post: Post): SignalTier {
  const score = post.signal?.aiScore ?? post.highConvictionScore ?? post.confidenceScore ?? null;
  if (post.signal?.aiScoreCoverage.state === "live" && isValidSignalScore(score, post.signal.aiScoreCoverage.state) && score >= 75) return "strong";
  if (post.signal?.aiScoreCoverage.state === "live" && isValidSignalScore(score, post.signal.aiScoreCoverage.state) && score >= 55) return "medium";
  if (post.signal?.aiScoreCoverage.state === "partial" || post.signal?.aiScoreCoverage.state === "live") return "partial";
  return "weak";
}

function shellClass(post: Post, kind: FeedPostKind): string {
  const tier = signalTier(post);
  if (kind === "call") {
    return cn(
      "relative overflow-hidden rounded-[18px] border p-4 shadow-[0_24px_60px_-46px_rgba(0,0,0,0.92)]",
      tier === "strong"
        ? "border-lime-300/22 bg-[radial-gradient(circle_at_top_right,rgba(169,255,52,0.13),transparent_30%),linear-gradient(180deg,rgba(8,14,17,0.99),rgba(3,8,10,0.99))]"
          : tier === "medium"
            ? "border-lime-300/14 bg-[radial-gradient(circle_at_top_right,rgba(169,255,52,0.08),transparent_28%),linear-gradient(180deg,rgba(7,12,17,0.98),rgba(3,8,11,0.99))]"
          : tier === "partial"
          ? "border-cyan-300/14 bg-[radial-gradient(circle_at_top_right,rgba(34,211,238,0.08),transparent_28%),linear-gradient(180deg,rgba(7,12,17,0.98),rgba(3,8,11,0.99))]"
          : "border-white/8 bg-[linear-gradient(180deg,rgba(7,12,17,0.94),rgba(3,8,11,0.98))]"
    );
  }
  const byKind: Record<FeedPostKind, string> = {
    call: "",
    chart: "rounded-[18px] border border-cyan-300/14 bg-[radial-gradient(circle_at_top_right,rgba(34,211,238,0.12),transparent_28%),linear-gradient(180deg,rgba(5,13,18,0.98),rgba(3,8,11,0.99))] p-4",
    whale: "rounded-[18px] border border-cyan-300/16 bg-[radial-gradient(circle_at_top_right,rgba(34,211,238,0.10),transparent_28%),linear-gradient(180deg,rgba(4,12,17,0.98),rgba(3,8,11,0.99))] p-4",
    poll: "rounded-[18px] border border-violet-300/14 bg-[radial-gradient(circle_at_top_right,rgba(167,139,250,0.10),transparent_28%),linear-gradient(180deg,rgba(9,8,18,0.98),rgba(4,5,11,0.99))] p-4",
    raid: "rounded-[18px] border border-lime-300/16 bg-[radial-gradient(circle_at_top_right,rgba(169,255,52,0.14),transparent_30%),linear-gradient(180deg,rgba(7,12,17,0.98),rgba(3,8,11,0.99))] p-4",
    news: "rounded-[18px] border border-amber-300/14 bg-[radial-gradient(circle_at_top_right,rgba(251,191,36,0.12),transparent_28%),linear-gradient(180deg,rgba(12,10,6,0.98),rgba(7,7,5,0.99))] p-4",
    discussion: "rounded-[18px] border border-white/8 bg-[linear-gradient(180deg,rgba(7,12,17,0.98),rgba(3,8,11,0.99))] p-4",
  };
  return byKind[kind];
}

function headline(post: Post): string {
  const clean = displayContent(post);
  const firstLine = clean.split(/\n+/)[0]?.trim();
  if (!firstLine) return tokenLabel(post);
  if (firstLine.length <= 72) return firstLine;
  return `${firstLine.slice(0, 69).trim()}...`;
}

function riskLabel(post: Post): string {
  if (isValidRiskLabel(post.signal?.riskLabel, post.signal?.riskScore)) return post.signal!.riskLabel;
  const risk = post.tokenRiskScore ?? post.bundlePenaltyScore;
  if (typeof risk !== "number") return "Unavailable";
  if (risk >= 70) return "High";
  if (risk >= 40) return "Medium";
  return "Not enough evidence";
}

function momentumLabel(post: Post): string {
  const value = post.signal?.momentumScore ?? post.hotAlphaScore ?? post.earlyRunnerScore ?? post.roiCurrentPct;
  if (typeof value !== "number") return "Unavailable";
  if (value >= 80) return "Very High";
  if (value >= 55) return "High";
  if (value >= 25) return "Building";
  return "Neutral";
}

function smartMoneyLabel(post: Post): string {
  if (isValidSignalScore(post.signal?.smartMoneyScore, post.signal?.aiScoreCoverage.state)) {
    return `${post.signal.smartMoneyScore.toFixed(1)}/100`;
  }
  if (typeof post.trustedTraderCount === "number" && post.trustedTraderCount > 0) {
    return `${post.trustedTraderCount} trusted`;
  }
  return "Not enough flow";
}

function smartMoneySubLabel(post: Post): string {
  if (isValidSignalScore(post.signal?.smartMoneyScore, post.signal?.aiScoreCoverage.state)) {
    return post.signal.scoreReasons.find((reason) => reason.toLowerCase().includes("trusted")) ?? "Derived by shared signal engine";
  }
  if (typeof post.trustedTraderCount === "number" && post.trustedTraderCount > 0) {
    return "Verified trader overlap";
  }
  return "Wallet-signal coverage unavailable";
}

function aiSignalValue(post: Post): string {
  if (isValidSignalScore(post.signal?.aiScore, post.signal?.aiScoreCoverage.state)) {
    return post.signal.aiScore.toFixed(1);
  }
  if (!isValidSignalScore(post.confidenceScore, post.signal?.aiScoreCoverage.state)) {
    return "Not enough signal";
  }
  return post.confidenceScore.toFixed(1);
}

function aiSignalSubLabel(post: Post): string {
  if (post.signal?.aiScoreCoverage.state === "unavailable") {
    return post.signal.aiScoreCoverage.unavailableReason ?? "Not enough source coverage";
  }
  if (post.signal?.aiScoreCoverage.state === "partial") {
    return post.signal.aiScoreCoverage.unavailableReason ?? "Partial source coverage";
  }
  if (post.signal?.convictionLabel) {
    return post.signal.convictionLabel;
  }
  if (typeof post.confidenceScore !== "number" || !Number.isFinite(post.confidenceScore)) {
    return "Needs token or engagement data";
  }
  if (typeof post.highConvictionScore === "number" && post.highConvictionScore >= 70) {
    return "High conviction";
  }
  return "Derived from live backend signals";
}

function scoreReasonSource(post: Post): string[] {
  const reasons = post.signal?.scoreReasons?.length ? post.signal.scoreReasons : post.scoreReasons?.length ? post.scoreReasons : post.feedReasons ?? [];
  return reasons;
}

function dominantReason(post: Post): string {
  const reasons = scoreReasonSource(post);
  if (reasons[0]) return reasons[0];
  if (post.signal?.convictionLabel && post.signal.convictionLabel.toLowerCase() !== "neutral") {
    return post.signal.convictionLabel;
  }
  if (post.signal?.unavailableReasons?.[0]) return post.signal.unavailableReasons[0];
  return post.community ? "Community context available" : "Signal coverage unavailable";
}

function decisionBadge(post: Post): DecisionBadge {
  const tier = signalTier(post);
  if (tier === "strong") return { label: "STRONG", tone: "strong", reason: dominantReason(post) };
  if (tier === "medium") return { label: "MEDIUM", tone: "medium", reason: dominantReason(post) };
  if (tier === "partial") return { label: "PARTIAL", tone: "partial", reason: post.signal?.aiScoreCoverage.unavailableReason ?? dominantReason(post) };
  return { label: "WEAK", tone: "weak", reason: post.signal?.aiScoreCoverage.unavailableReason ?? dominantReason(post) };
}

function interactionTotal(post: Post): number {
  return Math.max(0, post._count.likes + post._count.comments + post._count.reposts);
}

function engagementVelocityLabel(post: Post): string {
  const explicit = post.engagement?.velocity;
  if (typeof explicit === "number" && Number.isFinite(explicit) && explicit > 0) {
    return `+${Math.round(explicit)} interactions/hr`;
  }
  const timestamp = new Date(post.createdAt).getTime();
  const ageMinutes = Number.isFinite(timestamp) ? Math.max(1, Math.floor((Date.now() - timestamp) / 60_000)) : 1;
  const total = interactionTotal(post);
  if (total > 0 && ageMinutes <= 10) {
    return `+${total} interactions in ${ageMinutes} min`;
  }
  if (total > 0) return `${total} total interactions`;
  return "Engagement warming up";
}

function recentActionLabel(post: Post, noun = "detected"): string {
  return `${noun} ${timeAgo(post.createdAt)} ago`;
}

function callMetrics(post: Post): Array<{ label: string; value: string }> {
  const metrics: Array<{ label: string; value: string }> = [];
  if (typeof post.signal?.price === "number" && Number.isFinite(post.signal.price)) {
    metrics.push({ label: "Price", value: `$${post.signal.price.toPrecision(6)}` });
  }
  if (typeof post.signal?.priceChange24h === "number" && Number.isFinite(post.signal.priceChange24h) && Math.abs(post.signal.priceChange24h) >= 0.01) {
    metrics.push({ label: "24H Move", value: pct(post.signal.priceChange24h) });
  }
  if (typeof post.entryMcap === "number" && Number.isFinite(post.entryMcap)) {
    metrics.push({ label: "Entry MCap", value: compact(post.entryMcap, "$") });
  }
  if (typeof post.currentMcap === "number" && Number.isFinite(post.currentMcap)) {
    metrics.push({ label: "Current MCap", value: compact(post.currentMcap, "$") });
  }
  if (typeof post.roiPeakPct === "number" && Number.isFinite(post.roiPeakPct) && Math.abs(post.roiPeakPct) >= 0.01) {
    metrics.push({ label: "Peak Move", value: pct(post.roiPeakPct) });
  }
  if (typeof post.roiCurrentPct === "number" && Number.isFinite(post.roiCurrentPct) && Math.abs(post.roiCurrentPct) >= 0.01) {
    metrics.push({ label: "Live Move", value: pct(post.roiCurrentPct) });
  }
  if (isValidSignalScore(post.signal?.aiScore, post.signal?.aiScoreCoverage.state)) {
    metrics.push({ label: "AI Signal", value: `${post.signal.aiScore.toFixed(0)}/100` });
  } else if (isValidSignalScore(post.confidenceScore, post.signal?.aiScoreCoverage.state)) {
    metrics.push({ label: "AI Signal", value: `${post.confidenceScore.toFixed(0)}/100` });
  }
  if (isValidRiskLabel(post.signal?.riskLabel, post.signal?.riskScore) || (typeof post.tokenRiskScore === "number" && post.tokenRiskScore >= 40) || (typeof post.bundlePenaltyScore === "number" && post.bundlePenaltyScore >= 40)) {
    metrics.push({ label: "Risk", value: riskLabel(post) });
  }

  return metrics.slice(0, 4);
}

function FeedMiniCandleChart({ post, tall = false }: { post: Post; tall?: boolean }) {
  const queryClient = useQueryClient();
  const { ref, isNearViewport } = useNearViewport();
  const tokenAddress = (post.signal?.tokenAddress ?? post.tokenContext?.address ?? post.contractAddress)?.trim();
  const tokenSymbol = post.signal?.tokenSymbol ?? post.tokenContext?.symbol ?? post.tokenSymbol;
  const shouldFetchCandles = Boolean(tokenAddress) && isNearViewport && post.signal?.candlesCoverage.state !== "unavailable";
  const terminalQueryKey = ["terminal-aggregate-v1", tokenAddress, "1h"] as const;
  const cachedTerminal = tokenAddress
    ? queryClient.getQueryData<TerminalAggregateResponse>(terminalQueryKey)
    : undefined;
  const chartQuery = useQuery({
    queryKey: terminalQueryKey,
    queryFn: () =>
      api.get<TerminalAggregateResponse>(
        `/api/tokens/${encodeURIComponent(tokenAddress ?? "")}/terminal?timeframe=1h`,
        { cache: "default" }
      ),
    enabled: shouldFetchCandles,
    initialData: cachedTerminal,
    staleTime: 120_000,
    gcTime: 10 * 60_000,
    refetchOnWindowFocus: false,
  });
  const candles = chartQuery.data?.chart.candles.slice(-48) ?? [];
  const coverage = chartQuery.data?.chart.coverage;
  const hasValidCandles = coverage?.state !== "unavailable" && isValidCandleSeries(candles);

  if (!tokenAddress) {
    return (
      <div ref={ref} className={cn("flex flex-col items-center justify-center rounded-[14px] border border-white/8 bg-black/20 px-4 text-center", tall ? "h-[92px]" : "h-[76px]")}>
        <div className="text-sm font-semibold text-white/72">No token chart</div>
        <div className="mt-1 text-xs text-white/40">{post.signal?.candlesCoverage.unavailableReason ?? "Add a token address to attach live candle coverage."}</div>
      </div>
    );
  }

  if (!isNearViewport && !cachedTerminal) return <div ref={ref} />;

  if (chartQuery.isLoading && !cachedTerminal) return <div ref={ref} />;

  if (!hasValidCandles) {
    return (
      <div ref={ref} className={cn("flex flex-col items-center justify-center rounded-[14px] border border-white/8 bg-black/20 px-4 text-center", tall ? "h-[92px]" : "h-[76px]")}>
        <div className="text-sm font-semibold text-white/72">Chart unavailable</div>
        <div className="mt-1 text-xs text-white/40">
          {coverage?.unavailableReason || post.signal?.candlesCoverage.unavailableReason || "Insufficient real OHLC movement for a useful preview."}
        </div>
      </div>
    );
  }

  const values = candles.flatMap((candle) => [candle.high, candle.low]).filter((value) => Number.isFinite(value));
  const volumes = candles.map((candle) => candle.volume).filter((value) => Number.isFinite(value));
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = Math.max(max - min, 1);
  const maxVolume = Math.max(...volumes, 1);
  const last = candles[candles.length - 1] as TerminalCandle;
  const first = candles[0] as TerminalCandle;
  const positive = last.close >= first.open;
  const candleWidth = 100 / candles.length;
  const y = (value: number) => 8 + (1 - (value - min) / range) * 64;

  return (
    <div ref={ref} className={cn("relative overflow-hidden rounded-[14px] border border-white/8 bg-[linear-gradient(180deg,rgba(5,13,18,0.98),rgba(3,7,10,0.99))]", tall ? "h-[220px]" : "h-[118px]")}>
      <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.035)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.035)_1px,transparent_1px)] bg-[size:25%_25%]" />
      <div className="absolute left-3 top-3 z-10 flex items-center gap-2 text-xs font-semibold text-white">
        <span>{tokenSymbol ? `$${tokenSymbol}` : "TOKEN"}/USDT</span>
        <span className="rounded-md border border-white/10 bg-black/30 px-1.5 py-0.5 text-white/58">1h</span>
        <span className={positive ? "text-lime-300" : "text-rose-300"}>{pct(post.roiCurrentPct)}</span>
      </div>
      <div className="absolute right-3 top-3 z-10 rounded-md bg-lime-300 px-2 py-0.5 text-[11px] font-bold text-slate-950">
        {last.close.toPrecision(7)}
      </div>
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-x-3 bottom-3 top-8 h-[calc(100%-44px)] w-[calc(100%-24px)] overflow-visible">
        {candles.map((candle, index) => {
          const x = index * candleWidth + candleWidth / 2;
          const openY = y(candle.open);
          const closeY = y(candle.close);
          const highY = y(candle.high);
          const lowY = y(candle.low);
          const up = candle.close >= candle.open;
          const bodyTop = Math.min(openY, closeY);
          const bodyHeight = Math.max(1.2, Math.abs(closeY - openY));
          return (
            <g key={`${candle.timestamp}-${index}`}>
              <line x1={x} x2={x} y1={highY} y2={lowY} stroke={up ? "#a9ff34" : "#ef4444"} strokeWidth="0.28" vectorEffect="non-scaling-stroke" />
              <rect
                x={x - candleWidth * 0.28}
                y={bodyTop}
                width={Math.max(0.35, candleWidth * 0.56)}
                height={bodyHeight}
                fill={up ? "#39d353" : "#ef4444"}
                opacity="0.92"
              />
            </g>
          );
        })}
        {candles.map((candle, index) => {
          const x = index * candleWidth;
          const height = Math.max(1, (candle.volume / maxVolume) * 18);
          const up = candle.close >= candle.open;
          return (
            <rect
              key={`v-${candle.timestamp}-${index}`}
              x={x}
              y={98 - height}
              width={Math.max(0.3, candleWidth * 0.62)}
              height={height}
              fill={up ? "rgba(57,211,83,0.46)" : "rgba(239,68,68,0.42)"}
            />
          );
        })}
      </svg>
    </div>
  );
}

function PostHeader({ post, badge }: { post: Post; badge?: string }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="flex min-w-0 items-center gap-3">
        <Avatar className="h-11 w-11 border border-lime-300/16">
          <AvatarImage src={getAvatarUrl(post.author.id, post.author.image)} />
          <AvatarFallback className="bg-white/[0.06] text-white/70">
            {(post.author.name || post.author.username || "?").charAt(0)}
          </AvatarFallback>
        </Avatar>
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-2">
            <Link to={`/profile/${post.author.id}`} className="truncate text-sm font-semibold text-white hover:text-lime-200">
              {post.author.username || post.author.name}
            </Link>
            {post.author.isVerified ? <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-cyan-300" /> : null}
            {post.author.reputationTier ? (
              <span className="rounded-full border border-amber-300/24 bg-amber-300/10 px-2 py-0.5 text-[10px] font-bold text-amber-200">
                {post.author.reputationTier}
              </span>
            ) : null}
          </div>
          <div className="mt-0.5 text-xs text-white/42">
            @{post.author.username || post.author.name} - {timeAgo(post.createdAt)}
          </div>
        </div>
      </div>
      <div className="flex items-center gap-2">
        {badge ? (
          <span className="rounded-full border border-lime-300/16 bg-lime-300/10 px-3 py-1 text-[11px] font-semibold text-lime-200">
            {badge}
          </span>
        ) : null}
        <MoreVertical className="h-4 w-4 text-white/34" />
      </div>
    </div>
  );
}

function PostContextStrip({ post }: { post: Post }) {
  const context: string[] = [];
  if (post.repostContext?.user) {
    context.push(`Reposted by ${post.repostContext.user.username || post.repostContext.user.name}`);
  }
  if (post.community) {
    context.push(
      `from ${
        post.community.xCashtag ||
        post.community.symbol ||
        post.community.token?.symbol ||
        post.community.name ||
        post.community.token?.name ||
        "community"
      } community`
    );
  }
  if (post.feedReasons?.some((reason) => reason.toLowerCase().includes("follow"))) {
    context.push("You follow this caller");
  }
  if (post.feedReasons?.some((reason) => reason.toLowerCase().includes("community")) && post.community) {
    context.push("From your community");
  }
  const reason = dominantReason(post);
  if (reason && !context.includes(reason)) context.push(reason);
  if (context.length === 0) return null;
  return (
    <div className="mb-3 flex flex-wrap items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-lime-200/62">
      {context.map((item) => (
        <span key={item} className="rounded-full border border-lime-300/12 bg-lime-300/[0.055] px-2.5 py-1">
          {item}
        </span>
      ))}
    </div>
  );
}

function EngagementFooter({ post, onLike, onRepost }: FeedV2PostCardProps) {
  const navigate = useNavigate();
  return (
    <div className="mt-4 flex items-center justify-between border-t border-white/8 pt-3 text-xs text-white/48">
      <button type="button" onClick={() => onLike?.(post.id)} className={cn("inline-flex items-center gap-2 hover:text-lime-200", post.isLiked && "text-lime-300")}>
        <Heart className="h-4 w-4" />
        {post._count.likes}
      </button>
      <button type="button" onClick={() => navigate(`/post/${post.id}`)} className="inline-flex items-center gap-2 hover:text-lime-200">
        <MessageSquare className="h-4 w-4" />
        {post._count.comments}
      </button>
      <button type="button" onClick={() => onRepost?.(post.id)} className={cn("inline-flex items-center gap-2 hover:text-lime-200", post.isReposted && "text-lime-300")}>
        <Repeat2 className="h-4 w-4" />
        {post._count.reposts}
      </button>
      <span className="inline-flex items-center gap-2">
        <BarChart3 className="h-4 w-4" />
        {compact(post.viewCount)}
      </span>
    </div>
  );
}

export function FeedPostCallCard(props: FeedV2PostCardProps) {
  const { post } = props;
  const direction = inferDirection(post);
  const positive = direction !== "SHORT";
  const metrics = callMetrics(post);
  const terminalAddress = post.signal?.tokenAddress ?? post.tokenContext?.address ?? post.contractAddress;
  const tier = signalTier(post);
  const decision = decisionBadge(post);
  const hasTrustedSignal = tier === "strong";
  return (
    <article className={shellClass(post, "call")}>
      {tier === "strong" ? <div className="pointer-events-none absolute inset-x-6 top-0 h-px bg-[linear-gradient(90deg,transparent,#a9ff34,transparent)]" /> : null}
      <PostContextStrip post={post} />
      <PostHeader post={post} badge={post.signal?.convictionLabel && post.signal.convictionLabel !== "Not enough signal" ? post.signal.convictionLabel : typeof post.highConvictionScore === "number" && post.highConvictionScore >= 70 ? "High Conviction" : undefined} />
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <h2 className={cn("font-semibold tracking-tight text-white", tier === "strong" ? "text-[22px]" : "text-xl")}>{signalTitle(post)}</h2>
        {direction ? (
          <span className={cn("rounded-full border px-2.5 py-1 text-[11px] font-bold", positive ? "border-lime-300/24 bg-lime-300/10 text-lime-200" : "border-rose-300/24 bg-rose-300/10 text-rose-200")}>
            {direction}
          </span>
        ) : null}
        {post.signal?.aiScoreCoverage.state === "partial" ? <span className="rounded-full border border-cyan-300/20 bg-cyan-300/10 px-2.5 py-1 text-[11px] font-semibold text-cyan-100">Partial signal</span> : null}
        {post.signal?.aiScoreCoverage.state === "unavailable" ? <span className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[11px] font-semibold text-white/48">Signal pending</span> : null}
      </div>
      <p className="mt-2 text-sm leading-5 text-white/66">{displayContent(post)}</p>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <span
          className={cn(
            "rounded-[10px] border px-2.5 py-1 text-[11px] font-black tracking-[0.12em]",
            decision.tone === "strong" && "border-lime-300/28 bg-lime-300/[0.16] text-lime-100 shadow-[0_0_24px_rgba(169,255,52,0.16)]",
            decision.tone === "medium" && "border-lime-300/18 bg-lime-300/[0.08] text-lime-200",
            decision.tone === "partial" && "border-cyan-300/18 bg-cyan-300/[0.08] text-cyan-100",
            decision.tone === "weak" && "border-white/10 bg-white/[0.04] text-white/48"
          )}
        >
          {decision.label}
        </span>
        <span className="rounded-[10px] border border-white/8 bg-white/[0.035] px-2.5 py-1 text-[11px] font-semibold text-white/68">
          {decision.reason}
        </span>
        <span className="rounded-[10px] border border-white/8 bg-black/20 px-2.5 py-1 text-[11px] font-semibold text-white/42">
          {engagementVelocityLabel(post)}
        </span>
      </div>

      {hasTrustedSignal && metrics.length ? (
        <div className="mt-4 grid grid-cols-2 gap-2 md:grid-cols-4">
          {metrics.map((metric) => (
            <Metric key={metric.label} label={metric.label} value={metric.value} />
          ))}
        </div>
      ) : (
        <div className="mt-4 rounded-[16px] border border-white/8 bg-black/20 px-3 py-3 text-sm text-white/48">
          {post.signal?.aiScoreCoverage.unavailableReason ??
            "Market metrics are compressed until backend coverage can support a trusted trading signal."}
        </div>
      )}

      {hasTrustedSignal ? (
      <div className="mt-3">
        <FeedMiniCandleChart post={post} tall={tier !== "weak"} />
      </div>
      ) : null}

      {terminalAddress ? (
        <div className="mt-3 flex flex-wrap gap-2">
          <Link
            to={`/terminal?token=${encodeURIComponent(terminalAddress)}&post=${encodeURIComponent(post.id)}&timeframe=1h`}
            className="inline-flex h-9 items-center rounded-[12px] border border-lime-300/20 bg-lime-300/[0.1] px-3 text-xs font-semibold text-lime-100 hover:bg-lime-300/[0.16]"
          >
            Open Terminal
          </Link>
        </div>
      ) : null}

      {hasTrustedSignal ? (
        <div className="mt-3 grid gap-2 md:grid-cols-4">
          <AiMetric icon={Zap} label="AI Signal" value={aiSignalValue(post)} sub={aiSignalSubLabel(post)} />
          {isValidSignalScore(post.signal?.momentumScore ?? post.hotAlphaScore ?? post.earlyRunnerScore, post.signal?.aiScoreCoverage.state) ? (
            <AiMetric icon={TrendingUp} label="Momentum" value={momentumLabel(post)} sub={post.timingTier || "Shared signal engine"} />
          ) : null}
          {isValidSmartMoney(post) ? (
            <AiMetric icon={ShieldCheck} label="Smart Money" value={smartMoneyLabel(post)} sub={smartMoneySubLabel(post)} />
          ) : null}
          {isValidRiskLabel(post.signal?.riskLabel, post.signal?.riskScore) || (typeof post.tokenRiskScore === "number" && post.tokenRiskScore >= 40) ? (
            <AiMetric icon={TrendingDown} label="Risk Level" value={riskLabel(post)} sub={post.signal?.riskScore != null ? "Shared signal engine" : "Risk evidence returned"} />
          ) : null}
        </div>
      ) : null}
      <EngagementFooter {...props} />
    </article>
  );
}

export function FeedPostWhaleCard(props: FeedV2PostCardProps) {
  const { post } = props;
  const snapshot = post.walletTradeSnapshot;
  const whaleValueUsd = snapshot?.holdingUsd ?? snapshot?.boughtUsd ?? snapshot?.soldUsd ?? snapshot?.totalPnlUsd ?? null;
  return (
    <article className={shellClass(post, "whale")}>
      <PostContextStrip post={post} />
      <PostHeader post={post} badge="Whale Alert" />
      <div className="mt-4 flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.18em] text-cyan-200/72">
        <Waves className="h-4 w-4" />
        On-chain flow
        <span className="rounded-full border border-cyan-300/12 bg-cyan-300/[0.07] px-2 py-0.5 text-[10px] normal-case tracking-normal text-cyan-100/72">
          {recentActionLabel(post)}
        </span>
      </div>
      <h2 className="mt-1 text-xl font-semibold tracking-tight text-white">{tokenLabel(post)} WHALE ACTIVITY</h2>
      <p className="mt-2 text-sm leading-6 text-white/64">{displayContent(post)}</p>
      <div className="mt-4 grid grid-cols-2 gap-2 md:grid-cols-4">
        <Metric label="Amount" value={snapshot?.netAmount != null ? compact(snapshot.netAmount) : "Unavailable"} />
        <Metric label="Value" value={compact(whaleValueUsd, "$")} />
        <Metric label="From" value={snapshot?.source || "Unavailable"} />
        <Metric label="To" value={post.contractAddress ? `${post.contractAddress.slice(0, 6)}...${post.contractAddress.slice(-4)}` : "Unavailable"} />
      </div>
      <EngagementFooter {...props} />
    </article>
  );
}

export function FeedPostPollCard(props: FeedV2PostCardProps) {
  const { post, onPollVote } = props;
  const poll = post.poll;
  const expiresAt = post.pollExpiresAt ? new Date(post.pollExpiresAt) : null;
  const expired = expiresAt ? expiresAt.getTime() <= Date.now() : false;
  return (
    <article className={shellClass(post, "poll")}>
      <PostContextStrip post={post} />
      <PostHeader post={post} badge="Poll" />
      <div className="mt-4 flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.18em] text-violet-200/72">
        <Vote className="h-4 w-4" />
        Community poll
        <span className="rounded-full border border-violet-300/12 bg-violet-300/[0.07] px-2 py-0.5 text-[10px] normal-case tracking-normal text-violet-100/72">
          {engagementVelocityLabel(post)}
        </span>
      </div>
      <h2 className="mt-1 text-xl font-semibold text-white">{displayContent(post)}</h2>
      {poll && poll.options.length > 0 ? (
        <div className="mt-4 space-y-2">
          {poll.options.map((option) => {
            const selected = poll.viewerOptionId === option.id;
            return (
              <button
                key={option.id}
                type="button"
                onClick={() => {
                  if (!expired) void onPollVote?.(post.id, option.id);
                }}
                disabled={expired || selected}
                className={cn(
                  "relative w-full overflow-hidden rounded-[14px] border px-3 py-2.5 text-left transition",
                  selected
                    ? "border-lime-300/32 bg-lime-300/[0.08]"
                    : "border-white/8 bg-white/[0.03] hover:border-lime-300/20 hover:bg-white/[0.05]",
                  expired && "cursor-not-allowed opacity-70"
                )}
              >
                <span
                  className="absolute inset-y-0 left-0 bg-lime-300/[0.12]"
                  style={{ width: `${Math.max(0, Math.min(option.percentage, 100))}%` }}
                />
                <span className="relative flex items-center justify-between gap-3">
                  <span className="text-sm font-semibold text-white/82">{option.label}</span>
                  <span className="text-xs font-semibold text-lime-200">{option.percentage.toFixed(option.percentage % 1 === 0 ? 0 : 1)}%</span>
                </span>
              </button>
            );
          })}
          <div className="flex items-center justify-between text-xs text-white/42">
            <span>{poll.totalVotes} vote{poll.totalVotes === 1 ? "" : "s"}</span>
            <span>{expired ? "Expired" : expiresAt ? `Ends ${expiresAt.toLocaleString()}` : "No expiration"}</span>
          </div>
        </div>
      ) : (
      <div className="mt-4 rounded-[16px] border border-white/8 bg-black/20 p-4">
        <div className="flex items-center gap-2 text-sm font-semibold text-white">
          <Vote className="h-4 w-4 text-lime-300" />
          Poll options unavailable
        </div>
        <p className="mt-2 text-sm leading-6 text-white/50">
          This legacy poll post predates structured poll options and cannot accept votes.
        </p>
      </div>
      )}
      <EngagementFooter {...props} />
    </article>
  );
}

export function FeedPostChartCard(props: FeedV2PostCardProps) {
  const { post } = props;
  return (
    <article className={shellClass(post, "chart")}>
      <PostContextStrip post={post} />
      <PostHeader post={post} badge="Chart" />
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-cyan-200/72">
            <LineChart className="h-3.5 w-3.5" />
            Chart setup
          </div>
          <h2 className="mt-1 text-xl font-semibold tracking-tight text-white">{tokenLabel(post)} Technical Setup</h2>
        </div>
        <div className="rounded-[12px] border border-cyan-300/18 bg-cyan-300/[0.08] px-3 py-2 text-right">
          <div className="text-[10px] uppercase tracking-[0.14em] text-white/34">Timeframe</div>
          <div className="text-sm font-semibold text-cyan-100">{post.timingTier || post.activityStatusLabel || "Live"}</div>
        </div>
      </div>
      <p className="mt-2 text-sm leading-6 text-white/64">{displayContent(post)}</p>
      {signalTier(post) === "strong" ? (
        <div className="mt-4">
          <FeedMiniCandleChart post={post} tall />
        </div>
      ) : null}
      {post.signal?.tokenAddress || post.tokenContext?.address || post.contractAddress ? <TokenPreview post={post} /> : null}
      <EngagementFooter {...props} />
    </article>
  );
}

export function FeedPostRaidCard(props: FeedV2PostCardProps) {
  const { post } = props;
  const progress = Math.max(8, Math.min(100, (post.engagement?.velocity ?? post._count.reposts * 8 + post._count.comments * 4)));
  return (
    <article className={shellClass(post, "raid")}>
      <PostContextStrip post={post} />
      <PostHeader post={post} badge="Raid" />
      <div className="mt-4 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-lime-200/72">
        <RadioTower className="h-3.5 w-3.5" />
        Raid signal
        <span className="rounded-full border border-lime-300/12 bg-lime-300/[0.07] px-2 py-0.5 text-[10px] normal-case tracking-normal text-lime-100/72">
          {engagementVelocityLabel(post)}
        </span>
      </div>
      <h2 className="mt-1 text-xl font-semibold text-white">{tokenLabel(post)} RAID UPDATE</h2>
      <p className="mt-2 text-sm leading-6 text-white/64">{displayContent(post)}</p>
      <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_auto]">
        <div className="rounded-[16px] border border-lime-300/12 bg-lime-300/[0.06] p-4 text-sm text-white/64">
          <div className="flex items-center justify-between text-xs">
            <span>Raid pressure</span>
            <span className="font-bold text-lime-200">{progress.toFixed(0)}%</span>
          </div>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/10">
            <div className="h-full rounded-full bg-[linear-gradient(90deg,#a9ff34,#12d7aa)]" style={{ width: `${progress}%` }} />
          </div>
          <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
            <Metric label="Replies" value={compact(post._count.comments)} />
            <Metric label="Reposts" value={compact(post._count.reposts)} />
            <Metric label="Views" value={compact(post.viewCount)} />
          </div>
        </div>
        <Link
          to="/raids"
          className="inline-flex min-h-14 items-center justify-center rounded-[14px] border border-lime-300/22 bg-lime-300/[0.12] px-4 text-sm font-semibold text-lime-100 hover:bg-lime-300/[0.18]"
        >
          View Rooms
        </Link>
      </div>
      <EngagementFooter {...props} />
    </article>
  );
}

export function FeedPostDiscussionCard(props: FeedV2PostCardProps) {
  const { post } = props;
  return (
    <article className={shellClass(post, "discussion")}>
      <PostContextStrip post={post} />
      <PostHeader post={post} badge="Discussion" />
      <div className="mt-4 rounded-[16px] border border-white/8 bg-white/[0.025] p-4">
        <p className="text-[15px] leading-7 text-white/76">{displayContent(post)}</p>
        <div className="mt-4 flex items-center gap-3 text-xs text-white/44">
          <span>{post._count.comments} replies</span>
          <span>{post.engagement?.velocity ? `${post.engagement.velocity.toFixed(1)} velocity` : "Thread-first"}</span>
        </div>
      </div>
      {post.signal?.tokenAddress || post.tokenContext?.address || post.contractAddress ? <TokenPreview post={post} /> : null}
      <EngagementFooter {...props} />
    </article>
  );
}

export function FeedPostNewsCard(props: FeedV2PostCardProps) {
  const { post } = props;
  return (
    <article className={shellClass(post, "news")}>
      <PostContextStrip post={post} />
      <PostHeader post={post} badge="News" />
      <div className="mt-4 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-amber-200/72">
        <Newspaper className="h-4 w-4" />
        Market news
      </div>
      <h2 className="mt-1 text-xl font-semibold text-white">{headline(post)}</h2>
      <p className="mt-2 text-sm leading-6 text-white/64">{displayContent(post)}</p>
      {post.dexscreenerUrl ? (
        <a href={post.dexscreenerUrl} target="_blank" rel="noreferrer" className="mt-3 inline-flex items-center gap-2 text-xs font-semibold text-amber-100 hover:text-amber-50">
          Source <ExternalLink className="h-3.5 w-3.5" />
        </a>
      ) : null}
      {post.signal?.tokenAddress || post.tokenContext?.address || post.contractAddress ? <TokenPreview post={post} /> : null}
      <EngagementFooter {...props} />
    </article>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[14px] border border-white/8 bg-white/[0.03] px-3 py-2.5">
      <div className="text-[10px] uppercase tracking-[0.16em] text-white/34">{label}</div>
      <div className="mt-1 truncate text-sm font-semibold text-white">{value}</div>
    </div>
  );
}

function AiMetric({ icon: Icon, label, value, sub }: { icon: LucideIcon; label: string; value: string; sub: string }) {
  return (
    <div className="rounded-[16px] border border-lime-300/10 bg-lime-300/[0.045] px-3 py-3">
      <div className="flex items-center gap-2">
        <span className="flex h-8 w-8 items-center justify-center rounded-full border border-lime-300/14 bg-black/24">
          <Icon className="h-4 w-4 text-lime-300" />
        </span>
        <div className="min-w-0">
          <div className="text-[10px] uppercase tracking-[0.16em] text-white/34">{label}</div>
          <div className="truncate text-sm font-semibold text-lime-200">{value}</div>
        </div>
      </div>
      <div className="mt-2 truncate text-xs text-white/42">{sub}</div>
    </div>
  );
}

function TokenPreview({ post }: { post: Post }) {
  const address = post.signal?.tokenAddress ?? post.tokenContext?.address ?? post.contractAddress;
  const logo = post.signal?.tokenLogo ?? post.tokenContext?.logo ?? post.tokenImage;
  return (
    <Link to={address ? `/token/${address}` : "#"} className="mt-4 flex items-center justify-between gap-3 rounded-[16px] border border-white/8 bg-black/20 px-3 py-3 hover:bg-white/[0.05]">
      <div className="flex min-w-0 items-center gap-3">
        {logo ? <img src={logo} alt="" className="h-9 w-9 rounded-full object-cover" /> : null}
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-white">{tokenLabel(post)}</div>
          <div className="truncate text-xs text-white/42">{address}</div>
        </div>
      </div>
      {typeof post.roiCurrentPct === "number" && Number.isFinite(post.roiCurrentPct) && Math.abs(post.roiCurrentPct) >= 0.01 ? (
        <div className={cn("text-sm font-semibold", post.roiCurrentPct >= 0 ? "text-lime-300" : "text-rose-300")}>
          {pct(post.roiCurrentPct)}
        </div>
      ) : null}
    </Link>
  );
}

export function FeedV2PostCard(props: FeedV2PostCardProps) {
  const kind = inferKind(props.post);
  if (kind === "whale") return <FeedPostWhaleCard {...props} />;
  if (kind === "poll") return <FeedPostPollCard {...props} />;
  if (kind === "raid") return <FeedPostRaidCard {...props} />;
  if (kind === "news") return <FeedPostNewsCard {...props} />;
  if (kind === "chart") return <FeedPostChartCard {...props} />;
  if (kind === "call") return <FeedPostCallCard {...props} />;
  return <FeedPostDiscussionCard {...props} />;
}
