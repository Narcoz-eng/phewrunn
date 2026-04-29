import type { ReactNode } from "react";
import { ArrowUpRight, BrainCircuit, RadioTower } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { V2StatusPill } from "@/components/ui/v2/V2StatusPill";
import { cn } from "@/lib/utils";
import { isValidGainer, isValidMarketStats, isValidSignalScore, isValidTrendingCall } from "@/lib/data-validators";
import type { DiscoveryFeedSidebarResponse, FeedTab } from "@/types";

type FeedV2RightRailProps = {
  discovery: DiscoveryFeedSidebarResponse | undefined;
  onFilterFeed?: (query: string) => void;
  onSelectTab?: (tab: FeedTab) => void;
};

function formatUsd(value: number | null | undefined, fallback = "Early setup"): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  if (Math.abs(value) >= 1_000_000_000_000) return `$${(value / 1_000_000_000_000).toFixed(2)}T`;
  if (Math.abs(value) >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(2)}B`;
  if (Math.abs(value) >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (Math.abs(value) >= 1_000) return `$${(value / 1_000).toFixed(1)}K`;
  return `$${value.toFixed(value < 1 ? 6 : 2)}`;
}

function formatPct(value: number | null | undefined, fallback = "Momentum unconfirmed"): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}

function compactAddress(value: string | null | undefined): string {
  if (!value) return "Verified wallet";
  if (value.length <= 12) return value;
  return `${value.slice(0, 5)}...${value.slice(-4)}`;
}

function timeAgo(value: string | null | undefined): string | null {
  if (!value) return null;
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return null;
  const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (seconds < 60) return `${Math.max(1, seconds)}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function whaleDirection(action: string | null | undefined): "BUY" | "SELL" {
  const normalized = (action ?? "").toLowerCase();
  if (normalized.includes("sell") || normalized.includes("distribut") || normalized.includes("outflow")) return "SELL";
  return "BUY";
}

function convictionLabel(score: number | null): string {
  if (score === null) return "Early setup";
  if (score >= 75) return "Strong conviction";
  if (score >= 55) return "Medium conviction";
  return "Momentum unconfirmed";
}

function RailCard({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <section className="rounded-[16px] bg-[linear-gradient(180deg,rgba(8,13,18,0.97),rgba(4,8,11,0.99))] p-3.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.045),0_20px_55px_-44px_rgba(0,0,0,0.9)]">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-[15px] font-semibold tracking-tight text-white">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

function RailUnavailable({ message, tone = "neutral" }: { message: string; tone?: "neutral" | "positive" | "negative" }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-[11px] bg-white/[0.028] px-2.5 py-2 text-xs leading-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.025)]">
      <span className="truncate text-white/54">{message}</span>
      <span className={cn("h-2 w-2 shrink-0 rounded-full", tone === "positive" ? "bg-lime-300" : tone === "negative" ? "bg-rose-300" : "bg-cyan-300")} />
    </div>
  );
}

function TokenAvatar({ src, label }: { src?: string | null; label: string }) {
  return src ? (
    <img src={src} alt="" className="h-7 w-7 rounded-full border border-white/10 object-cover" loading="lazy" />
  ) : (
    <span className="flex h-7 w-7 items-center justify-center rounded-full border border-lime-300/18 bg-lime-300/[0.08] text-[10px] font-bold text-lime-200">
      {label.slice(0, 2).toUpperCase()}
    </span>
  );
}

export function FeedV2RightRail({ discovery, onFilterFeed }: FeedV2RightRailProps) {
  const navigate = useNavigate();
  const topGainers = (discovery?.topGainers ?? []).filter(isValidGainer);
  const liveRaids = (discovery?.liveRaids ?? []).filter((raid) => raid.participantCount > 0 || raid.postedCount > 0);
  const trendingCalls = (discovery?.trendingCalls ?? [])
    .filter(isValidTrendingCall)
    .filter((item, index, rows) => {
      const key = item.contractAddress?.toLowerCase() || item.tokenSymbol?.toLowerCase() || item.id;
      return rows.findIndex((row) => (row.contractAddress?.toLowerCase() || row.tokenSymbol?.toLowerCase() || row.id) === key) === index;
    });
  const aiWatchlist = topGainers
    .filter((item) => isValidSignalScore(item.confidenceScore) || isValidSignalScore(item.highConvictionScore))
    .slice(0, 5);
  const whaleRows = discovery?.whaleActivity ?? [];
  const marketStats = isValidMarketStats(discovery?.marketStats) ? discovery?.marketStats ?? null : null;
  const signalBreadth = topGainers.length + trendingCalls.length + aiWatchlist.length;
  const filterByToken = (symbol?: string | null, address?: string | null): boolean => {
    const query = symbol ? `$${symbol}` : address ?? "";
    if (!query || !onFilterFeed) return false;
    onFilterFeed?.(query);
    return true;
  };

  return (
    <aside className="space-y-3 xl:sticky xl:top-4 xl:self-start">
      <section className="rounded-[16px] bg-[linear-gradient(180deg,rgba(8,13,18,0.97),rgba(4,8,11,0.99))] p-3.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.045)]">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-[15px] font-semibold tracking-tight text-white">Signal Pulse</h2>
          <span className="rounded-[8px] border border-lime-300/14 bg-lime-300/[0.08] px-2 py-1 text-[11px] font-semibold text-lime-200">Live</span>
        </div>
        {marketStats ? (
        <div className="grid grid-cols-3 divide-x divide-white/8 overflow-hidden rounded-[12px] bg-white/[0.026] shadow-[inset_0_1px_0_rgba(255,255,255,0.025)]">
          {[
            ["Tracked Cap", formatUsd(marketStats?.marketCap), formatPct(marketStats?.marketCapChangePct), "token universe"],
            ["24h Flow", formatUsd(marketStats?.volume24h), formatPct(marketStats?.volume24hChangePct), "active volume"],
            ["Signal Breadth", String(signalBreadth), signalBreadth > 0 ? "active" : "Early setup", "ranked items"],
          ].map(([label, value, delta, caption]) => (
            <div key={label} className="px-3 py-2.5">
              <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-white/38">{label}</div>
              <div className="mt-1 text-[15px] font-bold text-white">{value}</div>
              <div className={cn("mt-0.5 text-[11px] font-semibold", delta.startsWith("-") ? "text-rose-300" : delta === "Early setup" || delta === "Momentum unconfirmed" ? "text-white/34" : "text-lime-300")}>
                {delta}
              </div>
              <div className="mt-0.5 text-[10px] text-white/30">{caption}</div>
            </div>
          ))}
        </div>
        ) : (
          <RailUnavailable message="Market pulse muted" />
        )}
      </section>

      <RailCard
        title="Top Movers"
        action={<span className="rounded-[8px] border border-white/10 bg-white/[0.04] px-2 py-1 text-[11px] text-white/54">24h</span>}
      >
        {topGainers.length ? (
          <div className="space-y-2">
            {topGainers.slice(0, 5).map((item, index) => (
            <button
              key={item.id}
              type="button"
              onClick={() => {
                if (!filterByToken(item.symbol || item.name, item.address)) navigate(`/token/${item.address}`);
              }}
              className="flex w-full items-center gap-3 rounded-[12px] px-1.5 py-1.5 text-left transition hover:bg-white/[0.045]"
            >
              <span className="w-4 text-center text-sm font-semibold text-white/70">{index + 1}</span>
              <TokenAvatar src={item.imageUrl} label={item.symbol || item.name || "?"} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-bold text-white">{item.symbol || item.name || "Token"}</div>
                <div className="text-[11px] text-white/38">{formatUsd(item.marketCap ?? item.liquidity)}</div>
              </div>
              <div className={cn("text-sm font-bold", (item.change24hPct ?? 0) >= 0 ? "text-lime-300" : "text-rose-300")}>
                {formatPct(item.change24hPct)}
              </div>
              <ArrowUpRight className="h-3.5 w-3.5 text-white/34" />
            </button>
            ))}
          </div>
        ) : (
          <RailUnavailable message="No sharp movers right now" tone="positive" />
        )}
      </RailCard>

      <RailCard title="Live Raids" action={<V2StatusPill tone="live">Live</V2StatusPill>}>
        {liveRaids.length ? (
          <div className="space-y-3">
            {liveRaids.slice(0, 2).map((raid) => {
            const progress = Math.max(8, Math.min(100, (raid.postedCount / Math.max(raid.participantCount, 1)) * 100));
            return (
              <button key={raid.id} type="button" onClick={() => navigate(`/raids/${raid.tokenAddress}/${raid.id}`)} className="w-full rounded-[14px] bg-white/[0.026] p-3 text-left shadow-[inset_0_1px_0_rgba(255,255,255,0.025)] transition hover:bg-white/[0.045]">
                <div className="flex items-start gap-3">
                  <span className="flex h-9 w-9 items-center justify-center rounded-full border border-lime-300/20 bg-black/30">
                    <RadioTower className="h-4 w-4 text-lime-300" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-bold text-white">{raid.tokenSymbol ? `$${raid.tokenSymbol} RAID` : "Live raid"}</div>
                    <div className="mt-0.5 truncate text-[11px] text-white/44">Target: {raid.objective}</div>
                    <div className="mt-0.5 text-[10px] text-lime-200/58">{timeAgo(raid.openedAt) ?? "Live"}</div>
                  </div>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                  <div>
                    <div className="text-white/38">Participants</div>
                    <div className="font-semibold text-white">{raid.participantCount.toLocaleString()}</div>
                  </div>
                  <div>
                    <div className="text-white/38">Posts</div>
                    <div className="font-semibold text-white">{raid.postedCount.toLocaleString()}</div>
                  </div>
                </div>
                <div className="mt-3 flex items-center gap-2">
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-white/10">
                    <div className="h-full rounded-full bg-[linear-gradient(90deg,#a9ff34,#12d7aa)]" style={{ width: `${progress}%` }} />
                  </div>
                  <span className="text-[11px] text-white/54">{progress.toFixed(0)}%</span>
                </div>
                <div className="mt-2 flex h-7 items-center justify-center rounded-[9px] bg-white/[0.035] text-[11px] font-semibold text-white/58">
                  Open raid room
                </div>
              </button>
            );
            })}
          </div>
        ) : (
          <RailUnavailable message="No live raid pressure" tone="positive" />
        )}
      </RailCard>

      <RailCard title="Active Calls" action={<span className="rounded-[8px] border border-amber-300/20 bg-amber-300/10 px-2 py-1 text-[11px] font-semibold text-amber-200">Fresh</span>}>
        {trendingCalls.length ? (
          <div className="space-y-2">
            {trendingCalls.slice(0, 5).map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => navigate(`/post/${item.id}`)}
              className="flex w-full items-center gap-2 rounded-[12px] px-1.5 py-1.5 text-left transition hover:bg-white/[0.045]"
            >
              <TokenAvatar src={item.tokenImage} label={item.tokenSymbol || item.tokenName || "?"} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-bold text-white">
                  {item.tokenSymbol ? `$${item.tokenSymbol}` : item.title || "Call"} <span className="text-lime-300">{item.direction ?? ""}</span>
                </div>
                <div className="truncate text-[11px] text-white/40">by {item.authorHandle}{timeAgo(item.createdAt) ? ` - ${timeAgo(item.createdAt)}` : " - Live"}</div>
              </div>
              <div className={cn("text-sm font-bold", (item.roiCurrentPct ?? 0) >= 0 ? "text-lime-300" : "text-rose-300")}>
                {formatPct(item.roiCurrentPct)}
              </div>
            </button>
            ))}
          </div>
        ) : (
          <RailUnavailable message="No strong calls right now" tone="positive" />
        )}
      </RailCard>

      <RailCard title="AI Watchlist">
        {aiWatchlist.length ? (
          <div className="space-y-2">
            {aiWatchlist.map((item) => {
            const score = item.highConvictionScore ?? item.confidenceScore ?? item.hotAlphaScore ?? null;
            return (
              <button
                key={`ai-${item.id}`}
                type="button"
                onClick={() => {
                  if (!filterByToken(item.symbol || item.name, item.address)) navigate(`/token/${item.address}`);
                }}
                className="flex w-full items-center gap-2 rounded-[12px] px-1.5 py-1.5 text-left transition hover:bg-white/[0.045]"
              >
                <TokenAvatar src={item.imageUrl} label={item.symbol || item.name || "?"} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-bold text-white">{item.symbol || item.name || "Token"}</div>
                  <div className="text-[11px] text-white/40">{convictionLabel(score)}</div>
                </div>
                <ArrowUpRight className="h-4 w-4 text-lime-300/70" />
              </button>
            );
            })}
          </div>
        ) : (
          <RailUnavailable message="No high-confidence watchlist" tone="positive" />
        )}
      </RailCard>

      <RailCard title="Whale Flow" action={<span className="rounded-[8px] border border-white/10 bg-white/[0.04] px-2 py-1 text-[11px] text-white/54">24h</span>}>
        {whaleRows.length ? (
          <div className="space-y-2">
            {whaleRows.slice(0, 4).map((item) => {
              const direction = whaleDirection(item.action);
              const seenAt = timeAgo(item.createdAt) ?? "Live";
              return (
            <button
              key={`whale-${item.id}`}
              type="button"
              onClick={() => {
                if (item.tokenSymbol) {
                  filterByToken(item.tokenSymbol, item.tokenAddress ?? null);
                } else if (item.explorerUrl) {
                  window.open(item.explorerUrl, "_blank", "noopener,noreferrer");
                }
              }}
              className="grid w-full grid-cols-[minmax(54px,0.8fr)_minmax(48px,0.62fr)_minmax(76px,0.82fr)_44px_46px] items-center gap-2 rounded-[12px] px-1.5 py-1.5 text-left transition hover:bg-white/[0.045]"
            >
              <div className="min-w-0 flex-1">
                <div className="truncate font-mono text-[11px] font-semibold text-white/60">{compactAddress(item.wallet)}</div>
                {item.isTest ? <div className="mt-0.5 text-[10px] font-semibold text-cyan-200/62">Verified test event</div> : null}
              </div>
              <div className="truncate text-xs font-black text-white">{item.tokenSymbol ? `$${item.tokenSymbol}` : "Token"}</div>
              <div className="text-right text-xs font-black text-white">{formatUsd(item.valueUsd)}</div>
              <div className={cn("text-right text-[11px] font-black", direction === "BUY" ? "text-lime-300" : "text-rose-300")}>{direction}</div>
              <div className="text-right text-[10px] font-semibold text-white/42">{seenAt}</div>
            </button>
              );
            })}
          </div>
        ) : (
          <RailUnavailable message="No recent smart-money flow" />
        )}
      </RailCard>

      {discovery?.aiSpotlight &&
      (isValidSignalScore(discovery.aiSpotlight.confidenceScore) || isValidSignalScore(discovery.aiSpotlight.highConvictionScore)) ? (
        <button
          type="button"
          onClick={() => navigate(`/token/${discovery.aiSpotlight?.tokenAddress}`)}
          className="flex w-full items-center gap-3 rounded-[16px] border border-lime-300/14 bg-[radial-gradient(circle_at_top_left,rgba(169,255,52,0.16),transparent_34%),linear-gradient(180deg,rgba(8,13,18,0.98),rgba(4,8,11,0.99))] p-3.5 text-left hover:border-lime-300/24"
        >
          <BrainCircuit className="h-5 w-5 text-lime-300" />
          <div className="min-w-0 flex-1">
            <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-lime-200/70">AI Spotlight</div>
            <div className="truncate text-sm font-bold text-white">{discovery.aiSpotlight.ticker || discovery.aiSpotlight.title}</div>
          </div>
          <ArrowUpRight className="h-4 w-4 text-white/42" />
        </button>
      ) : null}
    </aside>
  );
}
