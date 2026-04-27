import { useEffect, useRef, useState } from "react";
import { BarChart3, BrainCircuit, ExternalLink, Heart, LineChart, MessageSquare, MoreVertical, Newspaper, RadioTower, Repeat2, ShieldCheck, ShieldHalf, TrendingUp, Vote, Waves, Zap } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { isValidCandleSeries } from "@/lib/data-validators";
import { cn } from "@/lib/utils";
import { api } from "@/lib/api";
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

const feedChartPreviewCache = new Map<string, { value: FeedChartPreview; expiresAt: number }>();

function feedChartCacheKey(token: Post["tokenContext"] | null | undefined, timeframe = "1h"): string | null {
  if (!token?.address) return null;
  return `${token.chain ?? "any"}:${token.address.toLowerCase()}:${timeframe}`;
}

function getCachedFeedChart(key: string | null): FeedChartPreview | null {
  if (!key) return null;
  const cached = feedChartPreviewCache.get(key);
  if (!cached || cached.expiresAt <= Date.now()) {
    if (cached) feedChartPreviewCache.delete(key);
    return null;
  }
  return cached.value;
}

function setCachedFeedChart(key: string | null, value: FeedChartPreview): void {
  if (!key) return;
  const existing = getCachedFeedChart(key);
  if (existing?.state === "live" && value.state !== "live") return;
  const ttl = value.state === "live" ? value.maxAgeMs ?? 60_000 : 8_000;
  feedChartPreviewCache.set(key, { value, expiresAt: Date.now() + ttl });
}

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
  return "Low signal";
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

function riskMeaning(label: string | null | undefined): string | null {
  const normalized = label?.trim();
  if (!normalized || /unknown|neutral|clean|unavailable|pending/i.test(normalized)) return null;
  return normalized;
}

function convictionMeaning(value: string | number | null | undefined, coverage?: FeedCoverage | null): string {
  if (coverage?.state === "unavailable") return "Insufficient data";
  if (typeof value === "string") {
    const normalized = value.toLowerCase();
    if (normalized.includes("high") || normalized.includes("strong")) return "Strong";
    if (normalized.includes("bullish") || normalized.includes("medium")) return "Medium";
    if (normalized.includes("low") || normalized.includes("weak")) return "Weak";
  }
  const numeric = typeof value === "number" && Number.isFinite(value) ? value : null;
  if (numeric === null) return coverage?.state === "partial" ? "Medium" : "Insufficient data";
  if (numeric >= 78) return "Strong";
  if (numeric >= 58) return "Medium";
  if (numeric >= 35) return "Weak";
  return "Insufficient data";
}

function scoreMeaning(value: number | null | undefined): string | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return null;
  if (value >= 82) return "High";
  if (value >= 65) return "Strong";
  if (value >= 45) return "Building";
  return null;
}

function momentumMeaning(value: number | null | undefined, coverage?: FeedCoverage | null): string {
  if (coverage?.state === "unavailable") return "Insufficient data";
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return coverage?.state === "partial" || coverage?.state === "live" ? "Flat" : "Insufficient data";
  if (value >= 82) return "Accelerating";
  if (value >= 58) return "Building";
  if (value >= 35) return "Flat";
  return "Reversing";
}

function smartMoneyMeaning(value: number | null | undefined, trustedTraderCount: number | null | undefined, coverage?: FeedCoverage | null): string {
  if (trustedTraderCount && trustedTraderCount > 0) {
    if (typeof value === "number" && Number.isFinite(value) && value >= 70) return "Accumulating";
    if (typeof value === "number" && Number.isFinite(value) && value > 0 && value < 40) return "Distributing";
    return "Inactive";
  }
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return coverage?.state === "partial" || coverage?.state === "live" ? "Inactive" : "Insufficient data";
  if (value >= 70) return "Accumulating";
  if (value >= 45) return "Inactive";
  if (value > 0) return "Inactive";
  return "Insufficient data";
}

function aiPrimaryInsight(post: Post, items: Array<{ label: string; value: string }>, fallbackReason: string): string {
  const conviction = items.find((item) => item.label === "Conviction")?.value;
  const momentum = items.find((item) => item.label === "Momentum")?.value;
  const smartMoney = items.find((item) => item.label === "Smart Money")?.value;
  const risk = items.find((item) => item.label === "Risk")?.value;
  const token = post.tokenContext?.symbol ? `$${post.tokenContext.symbol}` : "This setup";

  if (smartMoney === "Accumulating" && (momentum === "Accelerating" || momentum === "Building")) {
    return `${token} has wallet accumulation aligning with ${momentum.toLowerCase()} market momentum.`;
  }
  if (conviction === "Strong" && risk === "Low") {
    return `${token} is ranking as a cleaner high-conviction setup with controlled risk.`;
  }
  if (momentum === "Reversing") {
    return `${token} momentum is weakening; confirmation should matter more than the headline call.`;
  }
  if (smartMoney === "Distributing") {
    return `${token} shows distribution risk, so entries need tighter confirmation.`;
  }
  if (conviction === "Medium" && momentum === "Building") {
    return `${token} is developing, with momentum improving but not yet a full-strength signal.`;
  }
  if (items.every((item) => item.value === "Insufficient data" || item.value === "Unknown")) {
    return "Intelligence coverage is still too thin to expand this signal.";
  }
  return fallbackReason;
}

function riskState(label: string | null | undefined, riskScore: number | null | undefined): string {
  const normalized = riskMeaning(label);
  if (normalized) return normalized;
  if (typeof riskScore !== "number" || !Number.isFinite(riskScore)) return "Unknown";
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

const NOISY_FEED_REASONS = new Set(["Market freshness limited", "Age-decayed", "Alpha priority", "Drawdown adjusted", "Risk adjusted"]);

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
      "relative overflow-hidden rounded-[18px] border p-4 shadow-[0_24px_60px_-46px_rgba(0,0,0,0.92)]",
      live
        ? "border-lime-300/22 bg-[radial-gradient(circle_at_top_right,rgba(169,255,52,0.13),transparent_30%),linear-gradient(180deg,rgba(8,14,17,0.99),rgba(3,8,10,0.99))]"
        : "border-white/8 bg-[linear-gradient(180deg,rgba(7,12,17,0.94),rgba(3,8,11,0.98))]"
    );
  }
  const byKind: Record<ReturnType<typeof payloadKind>, string> = {
    call: "",
    chart: "rounded-[18px] border border-cyan-300/14 bg-[radial-gradient(circle_at_top_right,rgba(34,211,238,0.10),transparent_28%),linear-gradient(180deg,rgba(5,13,18,0.98),rgba(3,8,11,0.99))] p-4",
    whale: "rounded-[18px] border border-cyan-300/16 bg-[linear-gradient(180deg,rgba(4,12,17,0.98),rgba(3,8,11,0.99))] p-4",
    poll: "rounded-[18px] border border-violet-300/14 bg-[linear-gradient(180deg,rgba(9,8,18,0.98),rgba(4,5,11,0.99))] p-4",
    raid: "rounded-[18px] border border-lime-300/16 bg-[linear-gradient(180deg,rgba(7,12,17,0.98),rgba(3,8,11,0.99))] p-4",
    news: "rounded-[18px] border border-amber-300/14 bg-[linear-gradient(180deg,rgba(12,10,6,0.98),rgba(7,7,5,0.99))] p-4",
    discussion: "rounded-[18px] border border-white/8 bg-[linear-gradient(180deg,rgba(7,12,17,0.98),rgba(3,8,11,0.99))] p-4",
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
    if (reason && !NOISY_FEED_REASONS.has(reason) && !context.includes(reason)) context.push(reason);
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
    .filter((reason) => Boolean(reason) && !NOISY_FEED_REASONS.has(reason))
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
        {compact(post.engagement?.views ?? post.viewCount)}
      </span>
      {terminalAddress ? (
        <Link
          to={`/terminal?token=${encodeURIComponent(terminalAddress)}&post=${encodeURIComponent(post.id)}&timeframe=1h`}
          className="inline-flex items-center gap-1.5 rounded-full border border-lime-300/16 bg-lime-300/[0.08] px-2.5 py-1 font-semibold text-lime-100 hover:bg-lime-300/[0.14]"
        >
          Terminal
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
    <div className="rounded-[14px] border border-white/8 bg-white/[0.03] px-3 py-2.5">
      <div className="text-[10px] uppercase tracking-[0.16em] text-white/34">{label}</div>
      <div className="mt-1 truncate text-sm font-semibold text-white">{value}</div>
    </div>
  );
}

function SetupMetric({ label, value, emphasis = false, tone = "neutral" }: { label: string; value: string; emphasis?: boolean; tone?: "positive" | "negative" | "neutral" }) {
  return (
    <div className={cn("min-w-0 border-l border-white/8 pl-3", emphasis && "border-lime-300/28")}>
      <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-white/34">{label}</div>
      <div className={cn(
        "mt-1 truncate text-sm font-semibold",
        tone === "positive" ? "text-lime-200" : tone === "negative" ? "text-rose-200" : emphasis ? "text-lime-200" : "text-white/82"
      )}>{value}</div>
    </div>
  );
}

function CompactNotice({ title, reason }: { title: string; reason: string }) {
  return (
    <div className="mt-3 flex items-start gap-2 rounded-[12px] border border-dashed border-white/10 bg-white/[0.025] px-3 py-2.5">
      <Zap className="mt-0.5 h-3.5 w-3.5 shrink-0 text-white/34" />
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

function AiReadStrip({ post, convictionLabel }: { post: Post; convictionLabel: string | number | null | undefined }) {
  const dominantReason =
    (post.scoreReasons ?? post.feedReasons ?? post.signal?.scoreReasons ?? []).find((reason) => reason && !NOISY_FEED_REASONS.has(reason)) ??
    post.coverage?.signal.unavailableReason ??
    "Awaiting stronger market confirmation.";
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
      tone: smartMoney === "Insufficient data" ? "text-white/44" : "text-cyan-200",
    },
    {
      label: "Risk",
      value: riskState(post.signal?.riskLabel, post.signal?.riskScore),
      icon: ShieldHalf,
      tone: "text-amber-100",
    },
  ];
  const primaryInsight = aiPrimaryInsight(post, items, dominantReason);
  return (
    <div className="mt-3 overflow-hidden rounded-[14px] border border-lime-300/12 bg-[linear-gradient(180deg,rgba(169,255,52,0.06),rgba(255,255,255,0.022))]">
      <div className="border-b border-white/8 px-3 py-2.5">
        <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-lime-200/58">AI read</div>
        <div className="mt-1 text-sm font-semibold leading-5 text-white/78">{primaryInsight}</div>
      </div>
      <div className="grid divide-y divide-white/8 sm:grid-cols-4 sm:divide-x sm:divide-y-0">
        {items.map((item) => {
          const Icon = item.icon;
          return (
            <div key={item.label} className={cn("flex items-center gap-2 px-3 py-2.5", item.value === "Insufficient data" && "bg-white/[0.012]")}>
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-white/8 bg-black/28">
                <Icon className={cn("h-4 w-4", item.tone)} />
              </span>
              <div className="min-w-0">
                <div className="text-[10px] font-semibold uppercase tracking-[0.13em] text-white/34">{item.label}</div>
                <div className={cn("mt-0.5 truncate text-xs font-semibold", item.tone)}>{item.value}</div>
              </div>
            </div>
          );
        })}
      </div>
      {dominantReason !== primaryInsight ? <div className="border-t border-white/8 px-3 py-2 text-xs leading-5 text-white/50">{dominantReason}</div> : null}
    </div>
  );
}

function ChartPreviewState({ post, reason, dominant = false }: { post: Post; reason: string; dominant?: boolean }) {
  const payloadPreview = post.payload?.call?.chartPreview ?? post.payload?.chart?.chartPreview ?? null;
  const token = post.payload?.call?.token ?? post.payload?.chart?.token ?? post.tokenContext ?? null;
  const timeframe = post.payload?.chart?.timeframe ?? "1h";
  const cacheKey = feedChartCacheKey(token, timeframe);
  const [preview, setPreview] = useState<FeedChartPreview | null>(() => {
    const cached = getCachedFeedChart(cacheKey);
    if (cached) return cached;
    if (payloadPreview?.state === "live") {
      setCachedFeedChart(cacheKey, payloadPreview);
      return payloadPreview;
    }
    return null;
  });
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!token?.address || !cacheKey || preview?.state === "live") return;
    let cancelled = false;
    const load = async () => {
      const cached = getCachedFeedChart(cacheKey);
      if (cached?.state === "live") {
        if (!cancelled) setPreview(cached);
        return;
      }
      const params = new URLSearchParams({ tokenAddress: token.address! });
      if (token.pairAddress) params.set("pairAddress", token.pairAddress);
      if (token.chain) params.set("chainType", token.chain);
      const result = await api.get<FeedChartPreview>(`/api/feed/chart-preview?${params.toString()}`);
      setCachedFeedChart(cacheKey, result);
      if (!cancelled) setPreview(getCachedFeedChart(cacheKey) ?? result);
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
  }, [cacheKey, preview?.state, token?.address, token?.chain, token?.pairAddress]);

  const candles = preview?.candles ?? null;
  if (isValidCandleSeries(candles) && candles.length >= 12) {
    const minLow = Math.min(...candles.map((candle) => candle.low));
    const maxHigh = Math.max(...candles.map((candle) => candle.high));
    const maxVolume = Math.max(1, ...candles.map((candle) => candle.volume));
    const width = 520;
    const priceHeight = dominant ? 188 : 128;
    const volumeHeight = dominant ? 42 : 28;
    const gap = 10;
    const height = priceHeight + volumeHeight + gap;
    const candleStep = width / candles.length;
    const bodyWidth = Math.max(3, Math.min(9, candleStep * 0.58));
    const yFor = (value: number) => maxHigh > minLow ? priceHeight - ((value - minLow) / (maxHigh - minLow)) * priceHeight : priceHeight / 2;
    const first = candles[0]?.open ?? 0;
    const last = candles[candles.length - 1]?.close ?? 0;
    const movePct = first > 0 ? ((last - first) / first) * 100 : null;
    return (
      <div className={cn("overflow-hidden rounded-[14px] border border-lime-300/14 bg-[#03080a] p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]", dominant ? "mt-4" : "mt-3")}>
        <div className="mb-2 flex items-center justify-between text-xs">
          <span className="font-semibold text-white/64">{post.tokenContext?.symbol ? `$${post.tokenContext.symbol}` : "Market"} / USD</span>
          <span className={cn("rounded-full border px-2 py-0.5 font-semibold", (movePct ?? 0) >= 0 ? "border-lime-300/18 bg-lime-300/10 text-lime-200" : "border-rose-300/18 bg-rose-300/10 text-rose-200")}>
            {movePct === null ? "live" : formatMetric(movePct, "pct")}
          </span>
        </div>
        <svg viewBox={`0 0 ${width} ${height}`} className={cn("w-full", dominant ? "h-60" : "h-40")} role="img" aria-label="Backend candlestick chart preview">
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
  return (
    <div ref={containerRef} className="mt-3 overflow-hidden rounded-[12px] border border-white/8 bg-white/[0.018] px-3 py-2.5">
      <div className="flex items-center justify-between gap-3 text-xs">
        <span className="font-semibold text-white/52">Chart loading</span>
        <span className="text-white/34">{preview?.state === "unavailable" ? "Compact view" : "Queued"}</span>
      </div>
      <div className="mt-2 h-8 overflow-hidden rounded-[8px] bg-[linear-gradient(90deg,rgba(169,255,52,0.10),rgba(18,215,170,0.05),rgba(255,255,255,0.025))]" aria-label={post.coverage?.candles.unavailableReason || reason} />
    </div>
  );
}

function FeedPostCallCard(props: FeedV2PostCardProps) {
  const { post } = props;
  const payload = post.payload?.call;
  if (!payload) return <FeedUnavailableCard {...props} reason="Call payload is unavailable." />;
  const terminalAddress = payload.token?.address;
  const liveSignal = post.coverage?.signal.state === "live";
  const chartIsLive = payload.chartPreview?.state === "live" && isValidCandleSeries(payload.chartPreview.candles);
  const convictionLabel = payload.signalLabel ?? payload.metrics.find((metric) => metric.unit === "score")?.value;
  const market = payload.market;
  const targetValues = Array.isArray(payload.targets) ? payload.targets.map(formatMarketValue).filter((value): value is string => Boolean(value)) : [];
  const setupMetrics = [
    market?.current && formatMarketValue(market.current) ? { label: "Current", value: formatMarketValue(market.current)!, emphasis: false, tone: "neutral" as const } : null,
    market?.liveMove && formatMarketValue(market.liveMove) ? {
      label: "Live Move",
      value: formatMarketValue(market.liveMove)!,
      emphasis: (market.liveMove.value ?? 0) > 0,
      tone: (market.liveMove.value ?? 0) >= 0 ? "positive" as const : "negative" as const,
    } : null,
    market?.entry && formatMarketValue(market.entry) ? { label: "Entry", value: formatMarketValue(market.entry)!, emphasis: true, tone: "neutral" as const } : null,
    market?.peakMove && formatMarketValue(market.peakMove) ? {
      label: "Peak",
      value: formatMarketValue(market.peakMove)!,
      emphasis: (market.peakMove.value ?? 0) > 0,
      tone: (market.peakMove.value ?? 0) >= 0 ? "positive" as const : "negative" as const,
    } : null,
    targetValues.length > 0 ? {
      label: "Targets",
      value: targetValues.join(" / "),
      emphasis: false,
      tone: "positive" as const,
    } : null,
    payload.stopLoss && formatMarketValue(payload.stopLoss) ? {
      label: "Stop",
      value: formatMarketValue(payload.stopLoss)!,
      emphasis: false,
      tone: "negative" as const,
    } : null,
    typeof payload.confidence === "number" && Number.isFinite(payload.confidence) ? {
      label: "Confidence",
      value: `${Math.round(payload.confidence)}%`,
      emphasis: payload.confidence >= 70,
      tone: payload.confidence >= 70 ? "positive" as const : "neutral" as const,
    } : null,
    post.timingTier ? { label: "Timeframe", value: post.timingTier, emphasis: false, tone: "neutral" as const } : null,
  ].filter((item): item is { label: string; value: string; emphasis: boolean; tone: "positive" | "negative" | "neutral" } => Boolean(item));
  const liveMove = market?.liveMove?.valueType === "live" ? formatSignedPct(market.liveMove.value) : null;
  const staleMarketReason = market?.current?.valueType === "stale" ? market.current.fallbackReason ?? "Current market data is stale." : null;
  return (
    <article className={cn(cardClass("call", post.coverage?.signal), !liveSignal && "p-3")}>
      {liveSignal ? <div className="pointer-events-none absolute inset-x-6 top-0 h-px bg-[linear-gradient(90deg,transparent,#a9ff34,transparent)]" /> : null}
      <PostContextStrip post={post} />
      <PostHeader post={post} badge={payload.signalLabel ?? (post.coverage?.signal.state === "partial" ? "Partial signal" : undefined)} />
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className={cn("font-semibold tracking-tight text-white", liveSignal ? "text-[23px]" : "text-xl")}>{payload.title}</h2>
            {payload.direction ? (
              <span className={cn("rounded-full border px-2.5 py-1 text-[11px] font-bold", payload.direction === "LONG" ? "border-lime-300/24 bg-lime-300/10 text-lime-200" : "border-rose-300/24 bg-rose-300/10 text-rose-200")}>
                {payload.direction}
              </span>
            ) : null}
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
      <p className="mt-3 line-clamp-2 text-sm leading-5 text-white/68">{payload.thesis}</p>
      {(setupMetrics.length > 0 || terminalAddress) ? (
        <div className="mt-3 grid gap-3 rounded-[15px] border border-lime-300/12 bg-[radial-gradient(circle_at_top_right,rgba(169,255,52,0.12),transparent_42%),linear-gradient(90deg,rgba(169,255,52,0.055),rgba(255,255,255,0.018))] px-3 py-3 sm:grid-cols-[repeat(auto-fit,minmax(92px,1fr))_auto]">
          {setupMetrics.map((metric) => <SetupMetric key={metric.label} {...metric} />)}
          <div className="flex items-center sm:pl-1">
            <PrimaryTerminalAction address={terminalAddress} postId={post.id} />
          </div>
        </div>
      ) : null}
      {(chartIsLive || payload.needsChart) ? <ChartPreviewState post={post} reason={payload.chartPreview?.unavailableReason ?? "No valid chart preview."} dominant /> : null}
      {!liveSignal ? (
        <CompactNotice title="Signal compressed" reason={post.coverage?.signal.unavailableReason ?? "More market confirmation is needed before expanding this call."} />
      ) : null}
      {staleMarketReason ? (
        <CompactNotice title="Stale market data" reason={staleMarketReason} />
      ) : null}
      {liveSignal ? <AiReadStrip post={post} convictionLabel={convictionLabel} /> : null}
      {liveSignal ? <WhyShown post={post} /> : null}
      <EngagementFooter {...props} />
    </article>
  );
}

function FeedPostChartCard(props: FeedV2PostCardProps) {
  const { post } = props;
  const payload = post.payload?.chart;
  if (!payload) return <FeedUnavailableCard {...props} reason="Chart payload is unavailable." />;
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
      <ChartPreviewState post={post} reason={payload.chartPreview?.unavailableReason ?? "No valid chart preview."} />
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
      <div className="mt-4 flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.18em] text-violet-200/72">
        <Vote className="h-4 w-4" />
        Community poll
      </div>
      <h2 className="mt-1 text-xl font-semibold text-white">{post.content}</h2>
      {poll?.options.length ? (
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
        <CompactNotice title="Poll unavailable" reason="This post does not include structured poll options." />
      )}
      <EngagementFooter {...props} />
    </article>
  );
}

function FeedPostRaidCard(props: FeedV2PostCardProps) {
  const { post } = props;
  const raid = post.payload?.raid;
  const reason = raid?.unavailableReason ?? "No live raid campaign payload is attached to this feed item.";
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
            <Metric label="Participants" value={raid.participants?.toLocaleString() ?? "--"} />
            <Metric label="Posts" value={raid.posts?.toLocaleString() ?? "--"} />
            <Metric label="Progress" value={raid.progressPct !== null ? `${raid.progressPct}%` : "--"} />
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
      <div className="mt-3 rounded-[14px] border border-white/8 bg-white/[0.025] px-3 py-2.5">
        <p className="line-clamp-3 text-sm leading-6 text-white/72">{post.payload?.discussion?.body ?? post.content}</p>
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
          Source <ExternalLink className="h-3.5 w-3.5" />
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
  const action = whale?.action ? whale.action.replaceAll("_", " ") : "Whale activity";
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
        <div className="mt-3 rounded-[16px] border border-cyan-300/12 bg-cyan-300/[0.045] p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-xl font-semibold capitalize text-white">{action}</div>
              <TokenLine token={token} />
            </div>
            {value ? (
              <div className="rounded-full border border-cyan-300/16 bg-cyan-300/[0.09] px-3 py-1 text-sm font-semibold text-cyan-100">
                {value}
              </div>
            ) : null}
          </div>
          <div className="mt-3 grid gap-2 text-xs text-white/56 sm:grid-cols-3">
            {wallet ? <Metric label="Wallet" value={wallet} /> : null}
            {typeof whale.amount === "number" && Number.isFinite(whale.amount) ? (
              <Metric label="Amount" value={compact(whale.amount)} />
            ) : null}
            {whale.timestamp ? <Metric label="Seen" value={timeAgo(whale.timestamp)} /> : null}
          </div>
          {whale.explorerUrl ? (
            <a href={whale.explorerUrl} target="_blank" rel="noreferrer" className="mt-3 inline-flex items-center gap-2 text-xs font-semibold text-cyan-100 hover:text-cyan-50">
              View transaction <ExternalLink className="h-3.5 w-3.5" />
            </a>
          ) : null}
        </div>
      ) : (
        <CompactNotice title="Whale flow unavailable" reason={whale?.unavailableReason ?? "No verified whale transaction payload is attached."} />
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
        Feed item unavailable
      </div>
      <p className="mt-2 text-sm leading-6 text-white/64">{post.content}</p>
      <CompactNotice title="Payload missing" reason={reason} />
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
  return <FeedUnavailableCard {...props} reason="This item is waiting for structured feed context." />;
}
