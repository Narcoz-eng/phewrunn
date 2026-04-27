import { BarChart3, ExternalLink, Heart, LineChart, MessageSquare, MoreVertical, Newspaper, RadioTower, Repeat2, ShieldCheck, Vote, Waves, Zap } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";
import { getAvatarUrl, type FeedCoverage, type Post } from "@/types";

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
  return `${value.toFixed(value % 1 === 0 ? 0 : 1)}/100`;
}

function compact(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "0";
  return new Intl.NumberFormat("en-US", {
    notation: Math.abs(value) >= 1000 ? "compact" : "standard",
    maximumFractionDigits: 1,
  }).format(value);
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
    if (reason && !context.includes(reason)) context.push(reason);
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
        {compact(post.engagement?.views ?? post.viewCount)}
      </span>
    </div>
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

function ChartPreviewState({ post, reason }: { post: Post; reason: string }) {
  const candles = post.payload?.call?.chartPreview?.candles ?? post.payload?.chart?.chartPreview?.candles ?? null;
  if (Array.isArray(candles) && candles.length >= 2) {
    const minLow = Math.min(...candles.map((candle) => candle.low));
    const maxHigh = Math.max(...candles.map((candle) => candle.high));
    const width = 320;
    const height = 104;
    const points = candles.map((candle, index) => {
      const x = candles.length <= 1 ? 0 : (index / (candles.length - 1)) * width;
      const y = maxHigh > minLow ? height - ((candle.close - minLow) / (maxHigh - minLow)) * height : height / 2;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(" ");
    const first = candles[0]?.open ?? 0;
    const last = candles[candles.length - 1]?.close ?? 0;
    const movePct = first > 0 ? ((last - first) / first) * 100 : null;
    return (
      <div className="mt-3 overflow-hidden rounded-[14px] border border-white/8 bg-black/24 p-3">
        <div className="mb-2 flex items-center justify-between text-xs">
          <span className="font-semibold text-white/62">Provider candles</span>
          <span className={cn("font-semibold", (movePct ?? 0) >= 0 ? "text-lime-300" : "text-rose-300")}>
            {movePct === null ? "live" : formatMetric(movePct, "pct")}
          </span>
        </div>
        <svg viewBox={`0 0 ${width} ${height}`} className="h-24 w-full" role="img" aria-label="Backend chart preview">
          <polyline fill="none" stroke="rgba(169,255,52,0.86)" strokeWidth="2" points={points} />
        </svg>
      </div>
    );
  }
  return (
    <CompactNotice
      title="Chart unavailable"
      reason={post.coverage?.candles.unavailableReason || reason}
    />
  );
}

function FeedPostCallCard(props: FeedV2PostCardProps) {
  const { post } = props;
  const payload = post.payload?.call;
  if (!payload) return <FeedUnavailableCard {...props} reason="Call payload is unavailable." />;
  const terminalAddress = payload.token?.address;
  const liveSignal = post.coverage?.signal.state === "live";
  return (
    <article className={cardClass("call", post.coverage?.signal)}>
      {liveSignal ? <div className="pointer-events-none absolute inset-x-6 top-0 h-px bg-[linear-gradient(90deg,transparent,#a9ff34,transparent)]" /> : null}
      <PostContextStrip post={post} />
      <PostHeader post={post} badge={payload.signalLabel ?? (post.coverage?.signal.state === "partial" ? "Partial signal" : undefined)} />
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <h2 className={cn("font-semibold tracking-tight text-white", liveSignal ? "text-[22px]" : "text-xl")}>{payload.title}</h2>
        {payload.direction ? (
          <span className={cn("rounded-full border px-2.5 py-1 text-[11px] font-bold", payload.direction === "LONG" ? "border-lime-300/24 bg-lime-300/10 text-lime-200" : "border-rose-300/24 bg-rose-300/10 text-rose-200")}>
            {payload.direction}
          </span>
        ) : null}
        {post.coverage?.signal.state === "unavailable" ? (
          <span className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[11px] font-semibold text-white/48">Signal unavailable</span>
        ) : null}
      </div>
      <p className="mt-2 text-sm leading-5 text-white/66">{payload.thesis}</p>
      <TokenLine token={payload.token} />
      {payload.metrics.length > 0 && liveSignal ? (
        <div className="mt-4 grid grid-cols-2 gap-2 md:grid-cols-4">
          {payload.metrics.map((metric) => (
            <Metric key={metric.label} label={metric.label} value={formatMetric(metric.value, metric.unit)} />
          ))}
        </div>
      ) : (
        <CompactNotice title="Signal compressed" reason={post.coverage?.signal.unavailableReason ?? "Backend coverage is not strong enough to show trading metrics."} />
      )}
      {payload.chartPreview ? <ChartPreviewState post={post} reason={payload.chartPreview.unavailableReason ?? "No valid chart preview."} /> : null}
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
      {liveSignal && payload.signalScore !== null ? (
        <div className="mt-3 grid gap-2 md:grid-cols-2">
          <Metric label="Signal Score" value={formatMetric(payload.signalScore, "score")} />
          <Metric label="Coverage" value={post.coverage?.signal.source ?? "phew-signal-engine"} />
        </div>
      ) : null}
      <EngagementFooter {...props} />
    </article>
  );
}

function FeedPostChartCard(props: FeedV2PostCardProps) {
  const { post } = props;
  const payload = post.payload?.chart;
  if (!payload) return <FeedUnavailableCard {...props} reason="Chart payload is unavailable." />;
  return (
    <article className={cardClass("chart", post.coverage?.signal)}>
      <PostContextStrip post={post} />
      <PostHeader post={post} badge="Chart" />
      <div className="mt-4 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-cyan-200/72">
        <LineChart className="h-3.5 w-3.5" />
        Chart setup
      </div>
      <h2 className="mt-1 text-xl font-semibold tracking-tight text-white">{payload.title}</h2>
      <p className="mt-2 text-sm leading-6 text-white/64">{payload.thesis}</p>
      <TokenLine token={payload.token} />
      {payload.timeframe ? (
        <div className="mt-3 inline-flex rounded-full border border-cyan-300/14 bg-cyan-300/[0.08] px-2.5 py-1 text-[11px] font-semibold text-cyan-100">
          {payload.timeframe}
        </div>
      ) : null}
      {payload.chartPreview ? <ChartPreviewState post={post} reason={payload.chartPreview.unavailableReason ?? "No valid chart preview."} /> : null}
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
      <div className="mt-4 rounded-[16px] border border-white/8 bg-white/[0.025] p-4">
        <p className="text-[15px] leading-7 text-white/76">{post.payload?.discussion?.body ?? post.content}</p>
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
  return (
    <article className={cardClass("whale", post.coverage?.signal)}>
      <PostContextStrip post={post} />
      <PostHeader post={post} badge="Whale" />
      <div className="mt-4 flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.18em] text-cyan-200/72">
        <Waves className="h-4 w-4" />
        On-chain flow
      </div>
      <CompactNotice title="Whale flow unavailable" reason={post.payload?.whale?.unavailableReason ?? "No verified whale transaction payload is attached."} />
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
  return <FeedUnavailableCard {...props} reason="No typed payload was returned by /api/feed." />;
}
