import { BarChart3, Heart, LineChart, MessageSquare, MoreVertical, RadioTower, Repeat2, ShieldCheck, TrendingDown, TrendingUp, Vote, Zap, type LucideIcon } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";
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
  const minutes = Math.max(0, Math.floor((Date.now() - timestamp) / 60_000));
  if (minutes < 1) return "now";
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
  if (post.postType === "alpha") return post.contractAddress || post.tokenSymbol ? "call" : "discussion";

  if (post.walletTradeSnapshot) return "whale";
  if (post.contractAddress || post.tokenSymbol || post.entryMcap !== null || typeof post.confidenceScore === "number") return "call";
  return "discussion";
}

function displayContent(post: Post): string {
  return post.content.replace(/^\[(alpha|discussion|chart|poll|raid|news)\]\s*/i, "");
}

function tokenLabel(post: Post): string {
  return post.tokenSymbol ? `$${post.tokenSymbol}` : post.tokenName || "Alpha";
}

function signalTitle(post: Post): string {
  const direction = inferDirection(post);
  return `${tokenLabel(post)}${direction ? ` ${direction}` : ""}`;
}

function headline(post: Post): string {
  const clean = displayContent(post);
  const firstLine = clean.split(/\n+/)[0]?.trim();
  if (!firstLine) return tokenLabel(post);
  if (firstLine.length <= 72) return firstLine;
  return `${firstLine.slice(0, 69).trim()}...`;
}

function riskLabel(post: Post): string {
  const risk = post.tokenRiskScore ?? post.bundlePenaltyScore;
  if (typeof risk !== "number") return "Unavailable";
  if (risk >= 70) return "High";
  if (risk >= 40) return "Medium";
  return "Low";
}

function momentumLabel(post: Post): string {
  const value = post.hotAlphaScore ?? post.earlyRunnerScore ?? post.roiCurrentPct;
  if (typeof value !== "number") return "Unavailable";
  if (value >= 80) return "Very High";
  if (value >= 55) return "High";
  if (value >= 25) return "Building";
  return "Neutral";
}

function smartMoneyLabel(post: Post): string {
  if (typeof post.trustedTraderCount === "number" && post.trustedTraderCount > 0) {
    return `${post.trustedTraderCount} trusted`;
  }
  if (typeof post.bundlePenaltyScore === "number") return post.bundlePenaltyScore <= 35 ? "Clean" : "Watch";
  return "Unavailable";
}

function chartPoints(post: Post): number[] {
  const start = typeof post.entryMcap === "number" && post.entryMcap > 0 ? post.entryMcap : 1;
  const end = typeof post.currentMcap === "number" && post.currentMcap > 0 ? post.currentMcap : start;
  const peak = typeof post.roiPeakPct === "number" ? start * (1 + post.roiPeakPct / 100) : Math.max(start, end);
  return [start, start * 1.04, start * 0.98, peak * 0.72, peak * 0.88, end * 0.94, end];
}

function hasMarketChartData(post: Post): boolean {
  return post.entryMcap !== null || post.currentMcap !== null || post.roiCurrentPct !== null;
}

function callMetrics(post: Post): Array<{ label: string; value: string }> {
  const metrics: Array<{ label: string; value: string }> = [];
  if (typeof post.entryMcap === "number" && Number.isFinite(post.entryMcap)) {
    metrics.push({ label: "Entry MCap", value: compact(post.entryMcap, "$") });
  }
  if (typeof post.currentMcap === "number" && Number.isFinite(post.currentMcap)) {
    metrics.push({ label: "Current MCap", value: compact(post.currentMcap, "$") });
  }
  if (typeof post.roiPeakPct === "number" && Number.isFinite(post.roiPeakPct)) {
    metrics.push({ label: "Peak Move", value: pct(post.roiPeakPct) });
  }
  if (typeof post.roiCurrentPct === "number" && Number.isFinite(post.roiCurrentPct)) {
    metrics.push({ label: "Live Move", value: pct(post.roiCurrentPct) });
  }
  if (typeof post.confidenceScore === "number" && Number.isFinite(post.confidenceScore)) {
    metrics.push({ label: "Confidence", value: `${post.confidenceScore.toFixed(0)}/100` });
  }
  if (post.tokenRiskScore !== null || post.bundlePenaltyScore !== null) {
    metrics.push({ label: "Risk", value: riskLabel(post) });
  }

  return metrics.slice(0, 4);
}

function MiniChart({ post, tall = false }: { post: Post; tall?: boolean }) {
  if (!hasMarketChartData(post)) {
    return (
      <div className={cn("flex items-center justify-center rounded-[16px] border border-white/8 bg-black/20 text-sm text-white/40", tall ? "h-[210px]" : "h-[116px]")}>
        Chart unavailable
      </div>
    );
  }

  const points = chartPoints(post);
  const min = Math.min(...points);
  const max = Math.max(...points);
  const range = Math.max(max - min, 1);
  const path = points
    .map((value, index) => {
      const x = (index / (points.length - 1)) * 100;
      const y = 88 - ((value - min) / range) * 68;
      return `${index === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(" ");
  const positive = (post.roiCurrentPct ?? 0) >= 0;

  return (
    <div className={cn("relative overflow-hidden rounded-[16px] border border-white/8 bg-[linear-gradient(180deg,rgba(5,13,18,0.98),rgba(3,7,10,0.99))]", tall ? "h-[210px]" : "h-[116px]")}>
      <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.035)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.035)_1px,transparent_1px)] bg-[size:25%_25%]" />
      <div className="absolute inset-x-0 bottom-0 h-12 bg-[linear-gradient(180deg,transparent,rgba(0,0,0,0.34))]" />
      <div className="absolute left-3 top-3 flex items-center gap-2 text-xs font-semibold text-white">
        <span>{post.tokenSymbol ? `$${post.tokenSymbol}` : "TOKEN"}/USDT</span>
        <span className={positive ? "text-lime-300" : "text-rose-300"}>{pct(post.roiCurrentPct)}</span>
      </div>
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-x-3 bottom-4 top-8 h-[calc(100%-48px)] w-[calc(100%-24px)] overflow-visible">
        <path d={`${path} L 100 100 L 0 100 Z`} fill={positive ? "rgba(132,255,74,0.12)" : "rgba(251,113,133,0.12)"} />
        <path d={path} fill="none" stroke={positive ? "#a9ff34" : "#fb7185"} strokeWidth="2.2" vectorEffect="non-scaling-stroke" />
      </svg>
      <div className="absolute bottom-3 left-3 right-3 flex h-9 items-end gap-1.5">
        {points.map((value, index) => {
          const height = 22 + ((value - min) / range) * 68;
          return (
            <span
              key={`${value}-${index}`}
              className={cn("flex-1 rounded-t-sm opacity-50", index % 3 === 1 ? "bg-rose-400/70" : "bg-lime-300/70")}
              style={{ height: `${Math.min(100, height)}%` }}
            />
          );
        })}
      </div>
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
  if (post.feedReasons?.length) {
    context.push(post.feedReasons.slice(0, 2).join(" + "));
  }
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
  return (
    <article className="rounded-[18px] border border-white/8 bg-[linear-gradient(180deg,rgba(7,12,17,0.98),rgba(3,8,11,0.99))] p-4 shadow-[0_24px_60px_-46px_rgba(0,0,0,0.92)]">
      <PostContextStrip post={post} />
      <PostHeader post={post} badge={typeof post.highConvictionScore === "number" && post.highConvictionScore >= 70 ? "High Conviction" : undefined} />
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <h2 className="text-xl font-semibold tracking-tight text-white">{signalTitle(post)}</h2>
        {direction ? (
          <span className={cn("rounded-full border px-2.5 py-1 text-[11px] font-bold", positive ? "border-lime-300/24 bg-lime-300/10 text-lime-200" : "border-rose-300/24 bg-rose-300/10 text-rose-200")}>
            {direction}
          </span>
        ) : null}
      </div>
      <p className="mt-2 text-sm leading-6 text-white/64">{displayContent(post)}</p>

      {metrics.length ? (
        <div className="mt-4 grid grid-cols-2 gap-2 md:grid-cols-4">
          {metrics.map((metric) => (
            <Metric key={metric.label} label={metric.label} value={metric.value} />
          ))}
        </div>
      ) : (
        <div className="mt-4 rounded-[16px] border border-white/8 bg-black/20 px-3 py-3 text-sm text-white/48">
          Token metrics attach after a token address or market snapshot is present.
        </div>
      )}

      {hasMarketChartData(post) ? (
        <div className="mt-4">
          <MiniChart post={post} tall />
        </div>
      ) : (
        <div className="mt-4 rounded-[16px] border border-white/8 bg-black/20 p-4">
          <div className="text-sm font-semibold text-white">Token context pending</div>
          <p className="mt-1 text-sm leading-6 text-white/50">
            This call has structured type data, but live market candles are not available yet. No chart metrics are inferred.
          </p>
        </div>
      )}

      {post.contractAddress ? (
        <div className="mt-3 flex flex-wrap gap-2">
          <Link
            to={`/token/${post.contractAddress}`}
            className="inline-flex h-9 items-center rounded-[12px] border border-lime-300/20 bg-lime-300/[0.1] px-3 text-xs font-semibold text-lime-100 hover:bg-lime-300/[0.16]"
          >
            Open Terminal
          </Link>
        </div>
      ) : null}

      <div className="mt-3 grid gap-2 md:grid-cols-4">
        <AiMetric icon={Zap} label="AI Score" value={typeof post.confidenceScore === "number" ? post.confidenceScore.toFixed(1) : "--"} sub={post.highConvictionScore ? "Conviction" : "Unavailable"} />
        <AiMetric icon={TrendingUp} label="Momentum" value={momentumLabel(post)} sub={post.timingTier || "Live signal"} />
        <AiMetric icon={ShieldCheck} label="Smart Money" value={smartMoneyLabel(post)} sub="Derived from trusted activity" />
        <AiMetric icon={TrendingDown} label="Risk Level" value={riskLabel(post)} sub={post.bundleRiskLabel || "Backend risk"} />
      </div>
      <EngagementFooter {...props} />
    </article>
  );
}

export function FeedPostWhaleCard(props: FeedV2PostCardProps) {
  const { post } = props;
  const snapshot = post.walletTradeSnapshot;
  const whaleValueUsd = snapshot?.holdingUsd ?? snapshot?.boughtUsd ?? snapshot?.soldUsd ?? snapshot?.totalPnlUsd ?? null;
  return (
    <article className="rounded-[18px] border border-cyan-300/12 bg-[linear-gradient(180deg,rgba(6,13,18,0.98),rgba(3,8,11,0.99))] p-4">
      <PostContextStrip post={post} />
      <PostHeader post={post} badge="Whale Alert" />
      <h2 className="mt-4 text-xl font-semibold tracking-tight text-white">{tokenLabel(post)} WHALE ACTIVITY</h2>
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
    <article className="rounded-[18px] border border-white/8 bg-[linear-gradient(180deg,rgba(7,12,17,0.98),rgba(3,8,11,0.99))] p-4">
      <PostContextStrip post={post} />
      <PostHeader post={post} badge="Poll" />
      <h2 className="mt-4 text-lg font-semibold text-white">{displayContent(post)}</h2>
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
    <article className="rounded-[18px] border border-cyan-300/14 bg-[radial-gradient(circle_at_top_right,rgba(34,211,238,0.10),transparent_28%),linear-gradient(180deg,rgba(7,12,17,0.98),rgba(3,8,11,0.99))] p-4">
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
      {hasMarketChartData(post) ? (
        <div className="mt-4">
          <MiniChart post={post} tall />
        </div>
      ) : (
        <div className="mt-4 rounded-[16px] border border-cyan-300/12 bg-cyan-300/[0.05] p-4 text-sm leading-6 text-cyan-100/70">
          Chart data is not attached to this setup yet. The post remains a chart post, but no candles are fabricated.
        </div>
      )}
      <div className="mt-3 grid gap-2 md:grid-cols-3">
        <Metric label="Setup Quality" value={typeof post.setupQualityScore === "number" ? post.setupQualityScore.toFixed(1) : "Unavailable"} />
        <Metric label="Market Health" value={typeof post.marketHealthScore === "number" ? post.marketHealthScore.toFixed(1) : "Unavailable"} />
        <Metric label="Current Move" value={pct(post.roiCurrentPct)} />
      </div>
      {post.contractAddress ? <TokenPreview post={post} /> : null}
      <EngagementFooter {...props} />
    </article>
  );
}

export function FeedPostRaidCard(props: FeedV2PostCardProps) {
  const { post } = props;
  return (
    <article className="rounded-[18px] border border-lime-300/12 bg-[radial-gradient(circle_at_top_right,rgba(169,255,52,0.12),transparent_30%),linear-gradient(180deg,rgba(7,12,17,0.98),rgba(3,8,11,0.99))] p-4">
      <PostContextStrip post={post} />
      <PostHeader post={post} badge="Raid" />
      <div className="mt-4 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-lime-200/72">
        <RadioTower className="h-3.5 w-3.5" />
        Raid signal
      </div>
      <h2 className="mt-1 text-xl font-semibold text-white">{tokenLabel(post)} RAID UPDATE</h2>
      <p className="mt-2 text-sm leading-6 text-white/64">{displayContent(post)}</p>
      <div className="mt-4 grid gap-2 sm:grid-cols-[1fr_auto]">
        <div className="rounded-[16px] border border-lime-300/12 bg-lime-300/8 p-4 text-sm text-white/58">
          Raid room data is shown only when this post is linked to a backend raid campaign.
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
    <article className="rounded-[18px] border border-white/8 bg-[linear-gradient(180deg,rgba(7,12,17,0.98),rgba(3,8,11,0.99))] p-4">
      <PostContextStrip post={post} />
      <PostHeader post={post} badge="Discussion" />
      <p className="mt-4 text-[15px] leading-7 text-white/72">{displayContent(post)}</p>
      {post.contractAddress ? <TokenPreview post={post} /> : null}
      <EngagementFooter {...props} />
    </article>
  );
}

export function FeedPostNewsCard(props: FeedV2PostCardProps) {
  const { post } = props;
  return (
    <article className="rounded-[18px] border border-amber-300/12 bg-[radial-gradient(circle_at_top_right,rgba(251,191,36,0.10),transparent_28%),linear-gradient(180deg,rgba(7,12,17,0.98),rgba(3,8,11,0.99))] p-4">
      <PostContextStrip post={post} />
      <PostHeader post={post} badge="News" />
      <div className="mt-4 text-[11px] font-semibold uppercase tracking-[0.18em] text-amber-200/72">Market news</div>
      <h2 className="mt-1 text-xl font-semibold text-white">{headline(post)}</h2>
      <p className="mt-2 text-sm leading-6 text-white/64">{displayContent(post)}</p>
      {post.contractAddress ? <TokenPreview post={post} /> : null}
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
  return (
    <Link to={post.contractAddress ? `/token/${post.contractAddress}` : "#"} className="mt-4 flex items-center justify-between gap-3 rounded-[16px] border border-white/8 bg-black/20 px-3 py-3 hover:bg-white/[0.05]">
      <div className="flex min-w-0 items-center gap-3">
        {post.tokenImage ? <img src={post.tokenImage} alt="" className="h-9 w-9 rounded-full object-cover" /> : null}
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-white">{tokenLabel(post)}</div>
          <div className="truncate text-xs text-white/42">{post.contractAddress}</div>
        </div>
      </div>
      <div className={cn("text-sm font-semibold", (post.roiCurrentPct ?? 0) >= 0 ? "text-lime-300" : "text-rose-300")}>
        {pct(post.roiCurrentPct)}
      </div>
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
