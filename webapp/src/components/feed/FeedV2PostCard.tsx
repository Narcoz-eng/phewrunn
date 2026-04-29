import { useEffect, useMemo, useRef, useState } from "react";
import { BarChart3, BrainCircuit, ExternalLink, Heart, LineChart, MessageSquare, MoreVertical, Newspaper, RadioTower, Repeat2, ShieldCheck, ShieldHalf, TrendingUp, Vote, Waves, Zap } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { isValidCandleSeries } from "@/lib/data-validators";
import { cn } from "@/lib/utils";
import {
  feedChartCacheKeys,
  getCachedFeedChart,
  isLiveFeedChartPreview,
  loadBatchedFeedChartPreview,
  setCachedFeedChart,
} from "@/lib/feed-chart-cache";
import { getAvatarUrl, type FeedCoverage, type Post } from "@/types";
import type { FeedChartPreview, FeedMarketValue } from "@/types";

type FeedV2PostCardProps = {
  post: Post;
  currentUserId?: string;
  onLike?: (postId: string) => Promise<void> | void;
  onRepost?: (postId: string) => Promise<void> | void;
  onComment?: (postId: string, content: string) => Promise<void> | void;
  onPollVote?: (postId: string, optionId: string) => Promise<void> | void;
};

function formatUsd(value: number): string {
  if (Math.abs(value) >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(2)}B`;
  if (Math.abs(value) >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (Math.abs(value) >= 1_000) return `$${(value / 1_000).toFixed(1)}K`;
  return `$${value.toFixed(value < 1 ? 6 : 2)}`;
}

function formatMetric(value: number, unit: "usd" | "pct" | "score"): string {
  if (unit === "usd") return formatUsd(value);
  if (unit === "pct") return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
  if (value >= 82) return "High conviction";
  if (value >= 65) return "Strong";
  if (value >= 45) return "Medium";
  return "Developing";
}

function formatTradingMetric(value: number, unit: "usd" | "pct" | "score"): string {
  return formatMetric(value, unit);
}

function formatSignedPct(value: number | null | undefined): string | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}

function formatMarketValue(metric: FeedMarketValue): string | null {
  if (metric.value === null || metric.valueType === "stale" || metric.valueType === "unavailable") return null;
  return formatMetric(metric.value, metric.unit);
}

function numericMarketValue(metric: FeedMarketValue | null | undefined): number | null {
  if (!metric || metric.value === null || metric.valueType === "unavailable") return null;
  return typeof metric.value === "number" && Number.isFinite(metric.value) ? metric.value : null;
}

function suggestedTradeLevels(payload: NonNullable<NonNullable<Post["payload"]>["call"]>) {
  const entry = numericMarketValue(payload.market?.entry);
  const current = numericMarketValue(payload.market?.current);
  const previewClose = payload.chartPreview?.candles?.at(-1)?.close;
  const liveMove = numericMarketValue(payload.market?.liveMove);
  const base = entry ?? current ?? (typeof previewClose === "number" && Number.isFinite(previewClose) ? previewClose : null);
  const direction = payload.direction ?? "LONG";
  const volatility = Math.max(0.05, Math.min(0.18, Math.abs((liveMove ?? 8) / 100) * 0.8));
  if (!base || base <= 0) return { entry: "$1.00", targets: ["$1.06", "$1.12", "$1.20"], stopLoss: "$0.96", suggested: true };
  const sign = direction === "SHORT" ? -1 : 1;
  const targets = [1, 2, 3].map((step) => formatUsd(Math.max(0.000001, base * (1 + sign * volatility * step))));
  const stopLoss = formatUsd(Math.max(0.000001, base * (1 - sign * volatility * 0.72)));
  return { entry: formatUsd(base), targets, stopLoss, suggested: true };
}

function riskMeaning(label: string | null | undefined): string | null {
  const normalized = label?.trim();
  if (!normalized || /unknown|neutral|clean|unavailable|pending/i.test(normalized)) return null;
  return normalized;
}

function convictionMeaning(value: string | number | null | undefined, coverage?: FeedCoverage | null): string {
  if (coverage?.state === "unavailable") return "Early setup";
  if (typeof value === "string") {
    const normalized = value.toLowerCase();
    if (normalized.includes("high") || normalized.includes("strong")) return "Strong";
    if (normalized.includes("bullish") || normalized.includes("medium")) return "Medium";
    if (normalized.includes("low") || normalized.includes("weak")) return "Developing";
  }
  const numeric = typeof value === "number" && Number.isFinite(value) ? value : null;
  if (numeric === null) return coverage?.state === "partial" ? "Medium" : "Early setup";
  if (numeric >= 78) return "Strong";
  if (numeric >= 58) return "Medium";
  if (numeric >= 35) return "Developing";
  return "Early setup";
}

function scoreMeaning(value: number | null | undefined): string | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return null;
  if (value >= 82) return "High";
  if (value >= 65) return "Strong";
  if (value >= 45) return "Building";
  return null;
}

function momentumMeaning(value: number | null | undefined, coverage?: FeedCoverage | null): string {
  if (coverage?.state === "unavailable") return "Momentum unconfirmed";
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return coverage?.state === "partial" || coverage?.state === "live" ? "Flat" : "Momentum unconfirmed";
  if (value >= 82) return "Accelerating";
  if (value >= 58) return "Building";
  if (value >= 35) return "Flat";
  return "Momentum weakening";
}

function smartMoneyMeaning(value: number | null | undefined, trustedTraderCount: number | null | undefined, coverage?: FeedCoverage | null): string {
  if (trustedTraderCount && trustedTraderCount > 0) {
    if (typeof value === "number" && Number.isFinite(value) && value >= 70) return "Accumulating";
    if (typeof value === "number" && Number.isFinite(value) && value > 0 && value < 40) return "Distributing";
    return "No recent smart-money flow";
  }
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return coverage?.state === "partial" || coverage?.state === "live" ? "No recent smart-money flow" : "No recent smart-money flow";
  if (value >= 70) return "Accumulating";
  if (value >= 45) return "No recent smart-money flow";
  if (value > 0) return "No recent smart-money flow";
  return "No recent smart-money flow";
}

function aiPrimaryInsight(post: Post, items: Array<{ label: string; value: string }>, fallbackReason: string): string {
  const conviction = items.find((item) => item.label === "Conviction")?.value;
  const momentum = items.find((item) => item.label === "Momentum")?.value;
  const smartMoney = items.find((item) => item.label === "Smart Money")?.value;
  const risk = items.find((item) => item.label === "Risk")?.value;
  const token = post.tokenContext?.symbol ? `$${post.tokenContext.symbol}` : "This setup";

  if (smartMoney === "Accumulating" && (momentum === "Accelerating" || momentum === "Building")) {
    return `${token} shows accumulation aligned with improving momentum.`;
  }
  if (conviction === "Strong" && risk === "Low") {
    return `${token} is a cleaner high-conviction setup with controlled risk.`;
  }
  if (momentum === "Momentum weakening") {
    return `${token} momentum is weakening after the current push.`;
  }
  if (smartMoney === "Distributing") {
    return `${token} shows distribution pressure, so entries need tighter risk.`;
  }
  if (conviction === "Medium" && momentum === "Building") {
    return `${token} is developing with improving momentum but incomplete confirmation.`;
  }
  if (items.every((item) => item.value === "Early setup" || item.value === "Momentum unconfirmed" || item.value === "No recent smart-money flow" || item.value === "Risk not defined")) {
    return `${token} is an early setup; wait for momentum confirmation or keep risk tight.`;
  }
  return fallbackReason;
}

function riskState(label: string | null | undefined, riskScore: number | null | undefined): string {
  const normalized = riskMeaning(label);
  if (normalized) return normalized;
  if (typeof riskScore !== "number" || !Number.isFinite(riskScore)) return "Risk not defined";
  if (riskScore >= 70) return "High";
  if (riskScore >= 40) return "Medium";
  return "Low";
}

function compactAddress(value: string | null | undefined): string | null {
  if (!value) return null;
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}

function compact(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "0";
  return new Intl.NumberFormat("en-US", {
    notation: Math.abs(value) >= 1000 ? "compact" : "standard",
    maximumFractionDigits: 1,
  }).format(value);
}

const NOISY_FEED_REASONS = new Set([
  "Market freshness limited",
  "Age-decayed",
  "Alpha priority",
  "Drawdown adjusted",
  "Risk adjusted",
  "Cached social read",
]);

function isInternalFeedReason(reason: string): boolean {
  return /cached|fallback|source|debug|provider|hydrating|async/i.test(reason);
}

function timeAgo(value: string): string {
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return "";
  const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (seconds < 60) return `${Math.max(1, seconds)}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

function payloadKind(post: Post): "call" | "chart" | "poll" | "raid" | "news" | "whale" | "discussion" | "unavailable" {
  if (post.payload?.call) return "call";
  if (post.payload?.chart) return "chart";
  if (post.payload?.poll || post.postType === "poll") return "poll";
  if (post.payload?.raid || post.postType === "raid" || post.itemType === "raid") return "raid";
  if (post.payload?.news || post.postType === "news") return "news";
  if (post.payload?.whale || post.itemType === "whale") return "whale";
  if (post.payload?.discussion || post.postType === "discussion") return "discussion";
  return "unavailable";
}

function cardClass(kind: ReturnType<typeof payloadKind>, coverage?: FeedCoverage): string {
  const live = coverage?.state === "live";
  if (kind === "call") {
    return cn(
      "relative overflow-hidden rounded-[18px] border p-4 shadow-[0_28px_80px_-54px_rgba(0,0,0,0.95)]",
      live
        ? "border-lime-300/18 bg-[radial-gradient(circle_at_top_right,rgba(169,255,52,0.14),transparent_28%),radial-gradient(circle_at_16%_58%,rgba(45,212,191,0.08),transparent_30%),linear-gradient(180deg,rgba(8,14,17,0.99),rgba(3,8,10,0.99))]"
        : "border-white/8 bg-[radial-gradient(circle_at_top_right,rgba(169,255,52,0.07),transparent_30%),linear-gradient(180deg,rgba(7,12,17,0.96),rgba(3,8,11,0.99))]"
    );
  }
  const byKind: Record<ReturnType<typeof payloadKind>, string> = {
    call: "",
    chart: "rounded-[18px] border border-cyan-300/14 bg-[radial-gradient(circle_at_top_right,rgba(34,211,238,0.10),transparent_28%),linear-gradient(180deg,rgba(5,13,18,0.98),rgba(3,8,11,0.99))] p-4",
    whale: "rounded-[18px] border border-cyan-300/16 bg-[linear-gradient(180deg,rgba(4,12,17,0.98),rgba(3,8,11,0.99))] p-4",
    poll: "rounded-[16px] border border-violet-300/12 bg-[linear-gradient(180deg,rgba(9,8,18,0.96),rgba(4,5,11,0.99))] p-3",
    raid: "rounded-[18px] border border-lime-300/16 bg-[linear-gradient(180deg,rgba(7,12,17,0.98),rgba(3,8,11,0.99))] p-4",
    news: "rounded-[18px] border border-amber-300/14 bg-[linear-gradient(180deg,rgba(12,10,6,0.98),rgba(7,7,5,0.99))] p-4",
    discussion: "rounded-[16px] border border-white/8 bg-[linear-gradient(180deg,rgba(7,12,17,0.96),rgba(3,8,11,0.99))] p-3",
    unavailable: "rounded-[18px] border border-white/8 bg-[linear-gradient(180deg,rgba(7,12,17,0.94),rgba(3,8,11,0.98))] p-4",
  };
  return byKind[kind];
}

function PostHeader({ post, badge }: { post: Post; badge?: string }) {
  const authorLabel = post.author.username || post.author.name || "trader";
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="flex min-w-0 items-center gap-3">
        <Avatar className="h-11 w-11 border border-lime-300/16">
          <AvatarImage src={getAvatarUrl(post.author.id, post.author.image)} />
          <AvatarFallback className="bg-white/[0.06] text-white/70">{authorLabel.charAt(0)}</AvatarFallback>
        </Avatar>
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-2">
            <Link to={`/profile/${post.author.id}`} className="truncate text-sm font-semibold text-white hover:text-lime-200">
              {authorLabel}
            </Link>
            {post.author.isVerified ? <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-cyan-300" /> : null}
            {post.author.reputationTier ? (
              <span className="rounded-full border border-amber-300/24 bg-amber-300/10 px-2 py-0.5 text-[10px] font-bold text-amber-200">
                {post.author.reputationTier}
              </span>
            ) : null}
          </div>
          <div className="mt-0.5 text-xs text-white/42">@{authorLabel} - {timeAgo(post.createdAt)}</div>
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
    context.push(`From ${post.community.xCashtag || post.community.symbol || post.community.name || "community"}`);
  }
  for (const reason of post.scoreReasons ?? post.feedReasons ?? []) {
    if (context.length >= 3) break;
    if (reason && !NOISY_FEED_REASONS.has(reason) && !isInternalFeedReason(reason) && !context.includes(reason)) context.push(reason);
  }
  if (!context.length) return null;
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

function WhyShown({ post }: { post: Post }) {
  const reasons = Array.from(new Set(post.scoreReasons ?? post.feedReasons ?? []))
    .filter((reason) => Boolean(reason) && !NOISY_FEED_REASONS.has(reason) && !isInternalFeedReason(reason))
    .slice(0, 3);
  if (!reasons.length) return null;
  return (
    <div className="mt-3 rounded-[12px] border border-lime-300/12 bg-lime-300/[0.045] px-3 py-2">
      <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-lime-200/58">Why this is shown</div>
      <div className="mt-1 flex flex-wrap gap-1.5">
        {reasons.map((reason) => (
          <span key={reason} className="rounded-full border border-lime-300/12 bg-black/20 px-2 py-0.5 text-[11px] text-lime-50/68">
            {reason}
          </span>
        ))}
      </div>
    </div>
  );
}

function EngagementFooter({ post, onLike, onRepost, terminalAddress }: FeedV2PostCardProps & { terminalAddress?: string | null }) {
  const navigate = useNavigate();
  return (
    <div className="mt-4 flex flex-wrap items-center justify-between gap-2 pt-3 text-xs text-white/48">
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
        {compact(post.engagement?.views ?? post.viewCount)}
      </span>
      {terminalAddress ? (
        <Link
          to={`/terminal?token=${encodeURIComponent(terminalAddress)}&post=${encodeURIComponent(post.id)}&timeframe=1h`}
          className="ml-auto inline-flex h-8 items-center gap-1.5 rounded-full bg-[linear-gradient(135deg,rgba(169,255,52,0.95),rgba(18,215,170,0.92))] px-3 font-black text-slate-950 shadow-[0_14px_32px_-24px_rgba(169,255,52,0.85)] hover:brightness-105"
        >
          Open Terminal
          <ExternalLink className="h-3.5 w-3.5" />
        </Link>
      ) : null}
    </div>
  );
}

function PrimaryTerminalAction({ address, postId, label = "Open Terminal" }: { address: string | null | undefined; postId: string; label?: string }) {
  if (!address) return null;
  return (
    <Link
      to={`/terminal?token=${encodeURIComponent(address)}&post=${encodeURIComponent(postId)}&timeframe=1h`}
      className="inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-[10px] border border-lime-300/22 bg-[linear-gradient(135deg,rgba(169,255,52,0.95),rgba(18,215,170,0.92))] px-3.5 text-xs font-black text-slate-950 shadow-[0_14px_32px_-22px_rgba(169,255,52,0.9)] transition hover:brightness-105"
    >
      {label}
      <ExternalLink className="h-3.5 w-3.5" />
    </Link>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[12px] bg-white/[0.032] px-3 py-2.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.025)]">
      <div className="text-[10px] uppercase tracking-[0.16em] text-white/34">{label}</div>
      <div className="mt-1 truncate text-sm font-semibold text-white">{value}</div>
    </div>
  );
}

function TradePlanField({ label, value, suggested = false, tone = "neutral" }: { label: string; value: string; suggested?: boolean; tone?: "positive" | "negative" | "neutral" }) {
  return (
    <div className="min-w-0 py-1.5">
      <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-white/34">
        <span>{label}</span>
        {suggested ? (
          <span className="rounded-full bg-white/[0.055] px-1.5 py-0.5 text-[9px] tracking-normal text-white/42">
            Suggested
          </span>
        ) : null}
      </div>
      <div
        className={cn(
          "mt-1 whitespace-normal break-words text-[14px] font-bold leading-5",
          tone === "positive" ? "text-lime-200" : tone === "negative" ? "text-rose-200" : "text-white/88"
        )}
      >
        {value}
      </div>
    </div>
  );
}

function CompactNotice({ title, reason }: { title: string; reason: string }) {
  return (
    <div className="mt-3 flex items-start gap-2 rounded-[12px] bg-white/[0.026] px-3 py-2.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.025)]">
      <Zap className="mt-0.5 h-3.5 w-3.5 shrink-0 text-lime-200/45" />
      <div className="min-w-0">
        <div className="text-xs font-semibold text-white/62">{title}</div>
        <div className="mt-0.5 text-xs leading-4 text-white/38">{reason}</div>
      </div>
    </div>
  );
}

function TokenLine({ token }: { token: Post["tokenContext"] | null | undefined }) {
  if (!token) return null;
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-white/44">
      {token.symbol ? <span className="font-semibold text-lime-200">${token.symbol}</span> : null}
      {token.name ? <span>{token.name}</span> : null}
      {token.address ? <span className="rounded-full border border-white/8 bg-white/[0.03] px-2 py-0.5 font-mono text-[10px]">{token.address.slice(0, 6)}...{token.address.slice(-4)}</span> : null}
    </div>
  );
}

function CallTokenLine({ token }: { token: Post["tokenContext"] | null | undefined }) {
  if (!token) return null;
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-white/45">
      {token.logo ? <img src={token.logo} alt="" className="h-5 w-5 rounded-full border border-white/10 object-cover" loading="lazy" /> : null}
      {token.symbol ? <span className="font-semibold text-lime-200">${token.symbol}</span> : null}
      {token.chain ? <span className="rounded-full border border-white/8 bg-white/[0.035] px-2 py-0.5 text-[10px] uppercase">{token.chain}</span> : null}
      {compactAddress(token.address) ? <span className="font-mono text-[10px] text-white/36">{compactAddress(token.address)}</span> : null}
    </div>
  );
}

function AiDecisionPanel({ post, convictionLabel, confidence, compact = false }: { post: Post; convictionLabel: string | number | null | undefined; confidence: number | null; compact?: boolean }) {
  const dominantReason =
    (post.scoreReasons ?? post.feedReasons ?? post.signal?.scoreReasons ?? []).find((reason) => reason && !NOISY_FEED_REASONS.has(reason)) ??
    post.coverage?.signal.unavailableReason ??
    "Market conviction is developing around the current setup.";
  const smartMoney = smartMoneyMeaning(post.signal?.smartMoneyScore, post.trustedTraderCount, post.coverage?.signal);
  const items = [
    {
      label: "Conviction",
      value: convictionMeaning(convictionLabel ?? post.signal?.aiScore, post.signal?.aiScoreCoverage ?? post.coverage?.signal),
      icon: BrainCircuit,
      tone: "text-lime-200",
    },
    {
      label: "Momentum",
      value: momentumMeaning(post.signal?.momentumScore, post.coverage?.signal),
      icon: TrendingUp,
      tone: "text-lime-200",
    },
    {
      label: "Smart Money",
      value: smartMoney,
      icon: Waves,
      tone: smartMoney === "No recent smart-money flow" ? "text-white/48" : "text-cyan-200",
    },
    {
      label: "Risk",
      value: riskState(post.signal?.riskLabel, post.signal?.riskScore),
      icon: ShieldHalf,
      tone: "text-amber-100",
    },
  ];
  const primaryInsight = aiPrimaryInsight(post, items, dominantReason);
  const confidenceLabel = confidence !== null ? `${Math.round(confidence)}%` : "Early setup";
  if (compact) {
    const visibleItems = items.filter((item) => !/unconfirmed|No recent|not defined|Early setup/i.test(item.value)).slice(0, 2);
    return (
      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-white/[0.055] pt-3">
        <span className="rounded-[9px] border border-white/8 bg-white/[0.035] px-2.5 py-1 text-[11px] font-bold text-white/54">
          AI {confidenceLabel}
        </span>
        {visibleItems.map((item) => {
          const Icon = item.icon;
          return (
            <span key={item.label} className="inline-flex items-center gap-1.5 rounded-[9px] bg-white/[0.028] px-2.5 py-1 text-[11px] font-semibold text-white/58">
              <Icon className={cn("h-3.5 w-3.5", item.tone)} />
              {item.value}
            </span>
          );
        })}
        <span className="min-w-[180px] flex-1 truncate text-xs font-medium text-white/42">{primaryInsight}</span>
      </div>
    );
  }
  return (
    <div className="mt-4 border-t border-lime-300/12 pt-4">
      <div className="flex flex-col gap-4 bg-[radial-gradient(circle_at_top_left,rgba(169,255,52,0.16),transparent_32%),linear-gradient(180deg,rgba(169,255,52,0.08),rgba(255,255,255,0.012))] px-1 py-1 sm:flex-row sm:items-start">
        <div className="shrink-0">
          <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-lime-200/70">AI Confidence</div>
          <div className="mt-1 text-[42px] font-black leading-none tracking-tight text-lime-200">{confidenceLabel}</div>
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[17px] font-black leading-6 text-white">{primaryInsight}</div>
          <div className="mt-2 text-xs font-semibold uppercase tracking-[0.13em] text-white/36">Decision engine</div>
        </div>
      </div>
      <div className="mt-3 grid gap-3 border-t border-white/[0.055] pt-3 sm:grid-cols-4">
        {items.map((item) => {
          const Icon = item.icon;
          return (
            <div key={item.label} className="flex min-w-0 items-center gap-2">
              <Icon className={cn("h-3.5 w-3.5 shrink-0", item.tone)} />
              <div className="min-w-0">
                <div className="text-[9px] font-semibold uppercase tracking-[0.13em] text-white/32">{item.label}</div>
                <div className={cn("mt-0.5 truncate text-xs font-bold", item.tone)}>{item.value}</div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ChartPreviewState({ post, reason, dominant = false, compact = false }: { post: Post; reason: string; dominant?: boolean; compact?: boolean }) {
  const payloadPreview = post.payload?.call?.chartPreview ?? post.payload?.chart?.chartPreview ?? null;
  const token = post.payload?.call?.token ?? post.payload?.chart?.token ?? post.tokenContext ?? null;
  const timeframe = post.payload?.chart?.timeframe ?? "1h";
  const cacheKeys = useMemo(() => feedChartCacheKeys(post, timeframe), [post, timeframe]);
  const primaryCacheKey = cacheKeys.find((key) => key.startsWith("token:")) ?? cacheKeys[0] ?? null;
  const [preview, setPreview] = useState<FeedChartPreview | null>(() => {
    const cached = getCachedFeedChart(cacheKeys);
    if (cached) return cached;
    if (isLiveFeedChartPreview(payloadPreview)) {
      setCachedFeedChart(cacheKeys, payloadPreview);
      return payloadPreview;
    }
    return null;
  });
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!token?.address || !primaryCacheKey || preview?.state === "live") return;
    let cancelled = false;
    const load = async () => {
      const cached = getCachedFeedChart(cacheKeys);
      if (cached?.state === "live") {
        if (!cancelled) setPreview(cached);
        return;
      }
      const result = await loadBatchedFeedChartPreview({
        key: primaryCacheKey,
        cacheKeys,
        tokenAddress: token.address!,
        pairAddress: token.pairAddress ?? null,
        chainType: token.chain ?? null,
      });
      setCachedFeedChart(cacheKeys, result);
      if (!cancelled) setPreview(getCachedFeedChart(cacheKeys) ?? result);
    };

    const node = containerRef.current;
    if (!node || typeof IntersectionObserver === "undefined") {
      void load().catch(() => undefined);
      return () => { cancelled = true; };
    }
    const observer = new IntersectionObserver(([entry]) => {
      if (entry?.isIntersecting) {
        observer.disconnect();
        void load().catch(() => undefined);
      }
    }, { rootMargin: "420px" });
    observer.observe(node);
    return () => {
      cancelled = true;
      observer.disconnect();
    };
  }, [cacheKeys, preview?.state, primaryCacheKey, token?.address, token?.chain, token?.pairAddress]);

  const candles = preview?.candles ?? null;
  if (isValidCandleSeries(candles) && candles.length >= 12) {
    const minLow = Math.min(...candles.map((candle) => candle.low));
    const maxHigh = Math.max(...candles.map((candle) => candle.high));
    const maxVolume = Math.max(1, ...candles.map((candle) => candle.volume));
    const width = 520;
    const priceHeight = dominant ? 188 : compact ? 76 : 128;
    const volumeHeight = dominant ? 42 : compact ? 18 : 28;
    const gap = 10;
    const height = priceHeight + volumeHeight + gap;
    const candleStep = width / candles.length;
    const bodyWidth = Math.max(3, Math.min(9, candleStep * 0.58));
    const yFor = (value: number) => maxHigh > minLow ? priceHeight - ((value - minLow) / (maxHigh - minLow)) * priceHeight : priceHeight / 2;
    const first = candles[0]?.open ?? 0;
    const last = candles[candles.length - 1]?.close ?? 0;
    const movePct = first > 0 ? ((last - first) / first) * 100 : null;
    return (
      <div className={cn("relative overflow-hidden bg-[#03080a] px-3 pb-3 pt-2 transition-opacity duration-500", dominant ? "mt-0" : "mt-2")}>
        <div className="mb-2 flex items-center justify-between text-xs">
          <span className="font-semibold text-white/64">{post.tokenContext?.symbol ? `$${post.tokenContext.symbol}` : "Market"} / USD</span>
          <span className={cn("rounded-full border px-2 py-0.5 font-semibold", (movePct ?? 0) >= 0 ? "border-lime-300/18 bg-lime-300/10 text-lime-200" : "border-rose-300/18 bg-rose-300/10 text-rose-200")}>
            {movePct === null ? "live" : formatMetric(movePct, "pct")}
          </span>
        </div>
        <svg viewBox={`0 0 ${width} ${height}`} className={cn("relative w-full animate-fade-in", dominant ? "h-60" : compact ? "h-28" : "h-40")} role="img" aria-label="Candlestick chart preview">
          <defs>
            <linearGradient id={`volume-${post.id}`} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="rgba(169,255,52,0.52)" />
              <stop offset="100%" stopColor="rgba(18,215,170,0.10)" />
            </linearGradient>
          </defs>
          {[0.25, 0.5, 0.75].map((ratio) => (
            <line key={ratio} x1="0" x2={width} y1={priceHeight * ratio} y2={priceHeight * ratio} stroke="rgba(255,255,255,0.055)" strokeWidth="1" />
          ))}
          {candles.map((candle, index) => {
            const x = index * candleStep + candleStep / 2;
            const bullish = candle.close >= candle.open;
            const openY = yFor(candle.open);
            const closeY = yFor(candle.close);
            const highY = yFor(candle.high);
            const lowY = yFor(candle.low);
            const bodyY = Math.min(openY, closeY);
            const bodyH = Math.max(2, Math.abs(closeY - openY));
            const color = bullish ? "rgba(169,255,52,0.92)" : "rgba(255,82,82,0.88)";
            const volumeH = Math.max(1, (candle.volume / maxVolume) * volumeHeight);
            return (
              <g key={`${candle.timestamp}-${index}`}>
                <line x1={x} x2={x} y1={highY} y2={lowY} stroke={color} strokeWidth="1.2" />
                <rect x={x - bodyWidth / 2} y={bodyY} width={bodyWidth} height={bodyH} rx="1.4" fill={color} />
                <rect x={x - bodyWidth / 2} y={priceHeight + gap + (volumeHeight - volumeH)} width={bodyWidth} height={volumeH} rx="1" fill={bullish ? `url(#volume-${post.id})` : "rgba(255,82,82,0.22)"} />
              </g>
            );
          })}
          {(() => {
            const y = yFor(last);
            return (
              <g>
                <line x1="0" x2={width} y1={y} y2={y} stroke="rgba(169,255,52,0.28)" strokeDasharray="4 4" />
                <rect x={width - 76} y={Math.max(0, Math.min(height - 18, y - 9))} width="76" height="18" rx="5" fill="rgba(169,255,52,0.92)" />
                <text x={width - 38} y={Math.max(12, Math.min(height - 6, y + 4))} textAnchor="middle" fontSize="10" fontWeight="700" fill="#041007">
                  {formatUsd(last)}
                </text>
              </g>
            );
          })()}
        </svg>
      </div>
    );
  }
  if (compact) {
    return (
      <div ref={containerRef} className="mt-0 flex items-center justify-between gap-3 bg-[#03080a] px-3 py-2">
        <div className="min-w-0">
          <div className="truncate text-xs font-semibold text-white/56">{post.tokenContext?.symbol ? `$${post.tokenContext.symbol}` : "Market"} preview</div>
          <div className="mt-0.5 truncate text-[11px] text-white/34">Chart unavailable for this setup.</div>
        </div>
        <span className="shrink-0 rounded-full border border-white/8 bg-white/[0.035] px-2 py-0.5 text-[10px] font-semibold text-white/40">No chart</span>
      </div>
    );
  }
  return (
    <div ref={containerRef} className="mt-0 flex items-center justify-between gap-3 bg-[#03080a] px-3 py-3">
      <div className="min-w-0">
        <div className="truncate text-xs font-semibold text-white/58">{post.tokenContext?.symbol ? `$${post.tokenContext.symbol}` : "Market"} preview</div>
        <div className="mt-0.5 truncate text-[11px] text-white/36">Chart unavailable for this setup.</div>
      </div>
      <span className="shrink-0 rounded-full border border-white/8 bg-white/[0.035] px-2 py-0.5 text-[10px] font-semibold text-white/40">No chart</span>
    </div>
  );
}

function FeedPostCallCard(props: FeedV2PostCardProps) {
  const { post } = props;
  const payload = post.payload?.call;
  if (!payload) return <FeedUnavailableCard {...props} reason="Early setup" />;
  const terminalAddress = payload.token?.address;
  const liveSignal = post.coverage?.signal.state === "live";
  const convictionLabel = payload.signalLabel ?? payload.metrics.find((metric) => metric.unit === "score")?.value;
  const market = payload.market;
  const targetValues = Array.isArray(payload.targets) ? payload.targets.map(formatMarketValue).filter((value): value is string => Boolean(value)) : [];
  const suggestedLevels = suggestedTradeLevels(payload);
  const resolvedTargets = targetValues.length >= 3 ? targetValues.slice(0, 3) : [...targetValues, ...suggestedLevels.targets].slice(0, 3);
  const resolvedStopLoss = payload.stopLoss && formatMarketValue(payload.stopLoss) ? formatMarketValue(payload.stopLoss)! : suggestedLevels.stopLoss;
  const explicitEntry = market?.entry && formatMarketValue(market.entry)
    ? formatMarketValue(market.entry)!
    : market?.current && formatMarketValue(market.current)
      ? formatMarketValue(market.current)!
      : null;
  const resolvedEntry = explicitEntry ?? suggestedLevels.entry;
  const confidenceValue =
    typeof payload.confidence === "number" && Number.isFinite(payload.confidence)
      ? payload.confidence
      : typeof post.signal?.aiScore === "number" && Number.isFinite(post.signal.aiScore)
        ? post.signal.aiScore
        : null;
  const setupMetrics = [
    {
      label: "Entry",
      value: resolvedEntry,
      suggested: !explicitEntry,
      tone: "neutral" as const,
    },
    {
      label: "Targets",
      value: resolvedTargets.join(" / "),
      suggested: targetValues.length < 3,
      tone: resolvedTargets.length > 0 ? "positive" as const : "neutral" as const,
    },
    {
      label: "Stop",
      value: resolvedStopLoss,
      suggested: !(payload.stopLoss && formatMarketValue(payload.stopLoss)),
      tone: resolvedStopLoss ? "negative" as const : "neutral" as const,
    },
    confidenceValue !== null ? {
      label: "Confidence",
      value: `${Math.round(confidenceValue)}%`,
      suggested: false,
      tone: confidenceValue >= 70 ? "positive" as const : "neutral" as const,
    } : { label: "Confidence", value: "Early setup", suggested: true, tone: "neutral" as const },
    { label: "Mode", value: confidenceValue !== null && confidenceValue >= 82 ? "10x" : "Spot", suggested: confidenceValue === null, tone: "neutral" as const },
  ];
  const liveMove = market?.liveMove?.valueType === "live" ? formatSignedPct(market.liveMove.value) : null;
  const thesis = payload.thesis?.trim() || post.content?.trim() || "Early setup";
  const tokenSymbol = payload.token?.symbol ?? post.tokenContext?.symbol ?? post.tokenSymbol ?? "TOKEN";
  const direction = payload.direction ?? "LONG";
  const isHighConviction = Boolean(confidenceValue !== null && confidenceValue >= 70 && (liveSignal || post.feedScore >= 65));
  const isWeakSignal = Boolean(confidenceValue !== null && confidenceValue < 40);
  const visibleSetupMetrics = isWeakSignal ? setupMetrics.slice(0, 4) : setupMetrics;
  return (
    <article className={cn(cardClass("call", post.coverage?.signal), !liveSignal && "p-4", isWeakSignal && "p-3")}>
      {liveSignal ? <div className="pointer-events-none absolute inset-x-6 top-0 h-px bg-[linear-gradient(90deg,transparent,#a9ff34,transparent)]" /> : null}
      <PostContextStrip post={post} />
      <PostHeader post={post} badge={payload.signalLabel ?? (post.coverage?.signal.state === "partial" ? "Partial signal" : undefined)} />
      <div className={cn("mt-3 flex flex-wrap items-center justify-between gap-3", isWeakSignal && "mt-2")}>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className={cn("font-black tracking-tight text-white", isHighConviction ? "text-[26px]" : "text-xl")}>${tokenSymbol}</h2>
            <span className={cn("rounded-full border px-2.5 py-1 text-[11px] font-black", direction === "LONG" ? "border-lime-300/24 bg-lime-300/10 text-lime-200" : "border-rose-300/24 bg-rose-300/10 text-rose-200")}>
              {direction}
            </span>
            <span className="text-sm font-semibold text-white/42">{payload.title}</span>
          </div>
          <CallTokenLine token={payload.token} />
        </div>
        <div className="flex items-center gap-2">
          {liveMove ? (
            <span className={cn("rounded-full border px-2.5 py-1 text-xs font-bold", liveMove.startsWith("-") ? "border-rose-300/20 bg-rose-300/10 text-rose-200" : "border-lime-300/22 bg-lime-300/10 text-lime-200")}>
              {liveMove}
            </span>
          ) : null}
        </div>
      </div>
      <p className={cn("mt-3 text-sm font-medium leading-5 text-white/72", isWeakSignal ? "line-clamp-1" : "line-clamp-2")}>{thesis}</p>
      <div className="mt-4 border-t border-white/[0.055] pt-3">
        <div className="mb-2 flex items-center justify-between gap-3">
          <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-white/34">Trade plan</div>
          <PrimaryTerminalAction address={terminalAddress} postId={post.id} />
        </div>
        <div className={cn("grid gap-x-4 gap-y-2", isWeakSignal ? "sm:grid-cols-4" : "sm:grid-cols-[0.82fr_1.6fr_0.82fr_0.72fr_0.58fr]")}>
          {visibleSetupMetrics.map((metric, index) => (
            <div key={metric.label} className={cn(index > 0 && "sm:border-l sm:border-white/[0.055] sm:pl-4")}>
              <TradePlanField {...metric} />
            </div>
          ))}
        </div>
      </div>
      <div className={cn("mt-3 overflow-hidden border-t border-white/[0.055] pt-0", isWeakSignal && "mt-2")}>
        <ChartPreviewState post={post} reason={payload.chartPreview?.unavailableReason ?? "Targets forming"} dominant={isHighConviction} compact={isWeakSignal} />
      </div>
      <AiDecisionPanel post={post} convictionLabel={convictionLabel} confidence={confidenceValue} compact={isWeakSignal} />
      {liveSignal ? <WhyShown post={post} /> : null}
      <EngagementFooter {...props} />
    </article>
  );
}

function FeedPostChartCard(props: FeedV2PostCardProps) {
  const { post } = props;
  const payload = post.payload?.chart;
  if (!payload) return <FeedUnavailableCard {...props} reason="Early setup" />;
  const terminalAddress = payload.token?.address ?? post.tokenContext?.address;
  return (
    <article className={cardClass("chart", post.coverage?.signal)}>
      <PostContextStrip post={post} />
      <PostHeader post={post} badge="Chart" />
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-cyan-200/72">
          <LineChart className="h-3.5 w-3.5" />
          Chart setup
        </div>
        <PrimaryTerminalAction address={terminalAddress} postId={post.id} label="Analyze Token" />
      </div>
      <h2 className="mt-1 text-xl font-semibold tracking-tight text-white">{payload.title}</h2>
      <p className="mt-2 text-sm leading-6 text-white/64">{payload.thesis}</p>
      <TokenLine token={payload.token} />
      {payload.timeframe ? (
        <div className="mt-3 inline-flex rounded-full border border-cyan-300/14 bg-cyan-300/[0.08] px-2.5 py-1 text-[11px] font-semibold text-cyan-100">
          {payload.timeframe}
        </div>
      ) : null}
      <ChartPreviewState post={post} reason={payload.chartPreview?.unavailableReason ?? "Early setup"} />
      <EngagementFooter {...props} />
    </article>
  );
}

function FeedPostPollCard(props: FeedV2PostCardProps) {
  const { post, onPollVote } = props;
  const poll = post.payload?.poll ?? post.poll;
  const expiresAt = post.pollExpiresAt ? new Date(post.pollExpiresAt) : null;
  const expired = expiresAt ? expiresAt.getTime() <= Date.now() : false;
  return (
    <article className={cardClass("poll", post.coverage?.signal)}>
      <PostContextStrip post={post} />
      <PostHeader post={post} badge="Poll" />
      <div className="mt-3 flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.18em] text-violet-200/72">
        <Vote className="h-4 w-4" />
        Community poll
      </div>
      <h2 className="mt-1 line-clamp-2 text-base font-semibold text-white">{post.content}</h2>
      {poll?.options.length ? (
        <div className="mt-3 space-y-2">
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
                  "relative w-full overflow-hidden rounded-[12px] border px-3 py-2 text-left transition",
                  selected ? "border-lime-300/32 bg-lime-300/[0.08]" : "border-white/8 bg-white/[0.03] hover:border-lime-300/20 hover:bg-white/[0.05]",
                  expired && "cursor-not-allowed opacity-70"
                )}
              >
                <span className="absolute inset-y-0 left-0 bg-lime-300/[0.12]" style={{ width: `${Math.max(0, Math.min(option.percentage, 100))}%` }} />
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
        <CompactNotice title="Early community signal" reason="Community signal is still early." />
      )}
      <EngagementFooter {...props} />
    </article>
  );
}

function FeedPostRaidCard(props: FeedV2PostCardProps) {
  const { post } = props;
  const raid = post.payload?.raid;
  const reason = raid?.unavailableReason ?? "Early setup";
  return (
    <article className={cardClass("raid", post.coverage?.signal)}>
      <PostContextStrip post={post} />
      <PostHeader post={post} badge="Raid" />
      <div className="mt-4 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-lime-200/72">
        <RadioTower className="h-3.5 w-3.5" />
        Raid update
      </div>
      <h2 className="mt-1 text-xl font-semibold text-white">{raid?.objective ?? post.content}</h2>
      {raid?.status !== "unavailable" && raid.raidId ? (
        <div className="mt-4 rounded-[14px] border border-lime-300/14 bg-lime-300/[0.055] p-3">
          <div className="grid grid-cols-3 gap-2 text-xs">
            <Metric label="Participants" value={raid.participants?.toLocaleString() ?? "Early setup"} />
            <Metric label="Posts" value={raid.posts?.toLocaleString() ?? "Early setup"} />
            <Metric label="Progress" value={raid.progressPct !== null ? `${raid.progressPct}%` : "Momentum unconfirmed"} />
          </div>
          {raid.progressPct !== null ? (
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/10">
              <div className="h-full rounded-full bg-[linear-gradient(90deg,#a9ff34,#12d7aa)]" style={{ width: `${Math.max(0, Math.min(100, raid.progressPct))}%` }} />
            </div>
          ) : null}
          {raid.ctaRoute ? (
            <Link to={raid.ctaRoute} className="mt-3 inline-flex h-8 items-center rounded-[10px] border border-lime-300/20 bg-lime-300/[0.12] px-3 text-xs font-semibold text-lime-100">
              Open raid room
            </Link>
          ) : null}
        </div>
      ) : (
        <CompactNotice title="Raid compressed" reason={reason} />
      )}
      <EngagementFooter {...props} />
    </article>
  );
}

function FeedPostDiscussionCard(props: FeedV2PostCardProps) {
  const { post } = props;
  return (
    <article className={cardClass("discussion", post.coverage?.signal)}>
      <PostContextStrip post={post} />
      <PostHeader post={post} badge="Discussion" />
      <div className="mt-2 rounded-[12px] bg-white/[0.026] px-3 py-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.025)]">
        <p className="line-clamp-2 text-sm leading-5 text-white/68">{post.payload?.discussion?.body ?? post.content}</p>
      </div>
      <EngagementFooter {...props} />
    </article>
  );
}

function FeedPostNewsCard(props: FeedV2PostCardProps) {
  const { post } = props;
  const payload = post.payload?.news;
  return (
    <article className={cardClass("news", post.coverage?.signal)}>
      <PostContextStrip post={post} />
      <PostHeader post={post} badge="News" />
      <div className="mt-4 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-amber-200/72">
        <Newspaper className="h-4 w-4" />
        Market news
      </div>
      <h2 className="mt-1 text-xl font-semibold text-white">{payload?.headline ?? post.content}</h2>
      {payload?.summary ? <p className="mt-2 text-sm leading-6 text-white/64">{payload.summary}</p> : null}
      <TokenLine token={payload?.relatedToken} />
      {payload?.publishedAt ? <div className="mt-2 text-xs text-white/38">{new Date(payload.publishedAt).toLocaleString()}</div> : null}
      {payload?.sourceUrl ? (
        <a href={payload.sourceUrl} target="_blank" rel="noreferrer" className="mt-3 inline-flex items-center gap-2 text-xs font-semibold text-amber-100 hover:text-amber-50">
          Read more <ExternalLink className="h-3.5 w-3.5" />
        </a>
      ) : null}
      <EngagementFooter {...props} />
    </article>
  );
}

function FeedPostWhaleCard(props: FeedV2PostCardProps) {
  const { post } = props;
  const whale = post.payload?.whale;
  const token = whale?.token ?? post.tokenContext;
  const normalizedAction = whale?.action ? whale.action.replaceAll("_", " ") : "Whale activity";
  const direction = /sell|distribut|outflow/i.test(normalizedAction) ? "SELL" : "BUY";
  const value = typeof whale?.valueUsd === "number" && Number.isFinite(whale.valueUsd) ? formatUsd(whale.valueUsd) : null;
  const wallet = compactAddress(whale?.wallet);
  return (
    <article className={cardClass("whale", post.coverage?.signal)}>
      <PostContextStrip post={post} />
      <PostHeader post={post} badge="Whale" />
      <div className="mt-4 flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.18em] text-cyan-200/72">
        <Waves className="h-4 w-4" />
        On-chain flow
      </div>
      {whale?.status === "live" ? (
        <div className="mt-3 border-t border-cyan-300/12 pt-3">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <div className="min-w-0">
              <div className="text-2xl font-black text-white">{token?.symbol ? `$${token.symbol}` : "WHALE FLOW"}</div>
              <div className="mt-1 text-xs font-semibold uppercase tracking-[0.14em] text-cyan-200/62">{normalizedAction}</div>
            </div>
            <div className="text-right">
              <div className="text-2xl font-black text-cyan-100">{value ?? "Early setup"}</div>
              <div className={cn("mt-1 text-xs font-black", direction === "BUY" ? "text-lime-300" : "text-rose-300")}>{direction}</div>
            </div>
          </div>
          <div className="mt-4 grid gap-3 border-t border-white/[0.055] pt-3 text-xs text-white/56 sm:grid-cols-3">
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-[0.13em] text-white/34">Wallet</div>
              <div className="mt-1 font-mono font-bold text-white/76">{wallet ?? "Verified wallet"}</div>
            </div>
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-[0.13em] text-white/34">Token</div>
              <div className="mt-1 font-bold text-white/76">{token?.symbol ? `$${token.symbol}` : token?.name ?? "Tracked token"}</div>
            </div>
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-[0.13em] text-white/34">Time</div>
              <div className="mt-1 font-bold text-white/76">{whale.timestamp ? timeAgo(whale.timestamp) : "Live"}</div>
            </div>
          </div>
          {whale.source?.includes("test") ? <div className="mt-3 text-[10px] font-semibold text-cyan-200/62">Verified test event</div> : null}
          {whale.explorerUrl ? (
            <a href={whale.explorerUrl} target="_blank" rel="noreferrer" className="mt-3 inline-flex items-center gap-2 text-xs font-semibold text-cyan-100 hover:text-cyan-50">
              View transaction <ExternalLink className="h-3.5 w-3.5" />
            </a>
          ) : null}
        </div>
      ) : (
        <CompactNotice title="No recent smart-money flow" reason={whale?.unavailableReason ?? "Early setup"} />
      )}
      <EngagementFooter {...props} />
    </article>
  );
}

function FeedUnavailableCard(props: FeedV2PostCardProps & { reason: string }) {
  const { post, reason } = props;
  return (
    <article className={cardClass("unavailable", post.coverage?.signal)}>
      <PostContextStrip post={post} />
      <PostHeader post={post} />
      <div className="mt-4 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-white/42">
        <Zap className="h-3.5 w-3.5" />
        Feed signal
      </div>
      <p className="mt-2 text-sm leading-6 text-white/64">{post.content}</p>
      <CompactNotice title="Structured context" reason={reason} />
      <EngagementFooter {...props} />
    </article>
  );
}

export function FeedV2PostCard(props: FeedV2PostCardProps) {
  const kind = payloadKind(props.post);
  if (kind === "call") return <FeedPostCallCard {...props} />;
  if (kind === "chart") return <FeedPostChartCard {...props} />;
  if (kind === "poll") return <FeedPostPollCard {...props} />;
  if (kind === "raid") return <FeedPostRaidCard {...props} />;
  if (kind === "news") return <FeedPostNewsCard {...props} />;
  if (kind === "whale") return <FeedPostWhaleCard {...props} />;
  if (kind === "discussion") return <FeedPostDiscussionCard {...props} />;
  return <FeedUnavailableCard {...props} reason="Early setup" />;
}
