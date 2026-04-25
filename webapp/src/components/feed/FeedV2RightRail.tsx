import { ArrowUpRight, BrainCircuit, TrendingUp, Users, Zap } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { V2StatusPill } from "@/components/ui/v2/V2StatusPill";
import { cn } from "@/lib/utils";
import type { DiscoveryFeedSidebarResponse } from "@/types";

function formatCompactMetric(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "--";
  if (Math.abs(value) >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(1)}B`;
  if (Math.abs(value) >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (Math.abs(value) >= 1_000) return `$${(value / 1_000).toFixed(1)}K`;
  return `$${value.toFixed(0)}`;
}

function avgMetric(values: Array<number | null | undefined>): number | null {
  const finite = values.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  if (!finite.length) return null;
  return finite.reduce((sum, value) => sum + value, 0) / finite.length;
}

type FeedV2RightRailProps = {
  discovery: DiscoveryFeedSidebarResponse | undefined;
};

export function FeedV2RightRail({ discovery }: FeedV2RightRailProps) {
  const navigate = useNavigate();
  const topGainers = discovery?.topGainers ?? [];
  const liveRaid = discovery?.liveRaids?.[0] ?? null;
  const trendingCalls = discovery?.trendingCalls ?? [];
  const trendingCommunities = discovery?.trendingCommunities ?? [];
  const aiSpotlight = discovery?.aiSpotlight ?? null;
  const trackedMarketCount = topGainers.length;
  const avgLiquidity = avgMetric(topGainers.map((item) => item.liquidity));
  const avgVolume = avgMetric(topGainers.map((item) => item.volume24h));
  const avgConviction = avgMetric(topGainers.map((item) => item.highConvictionScore));
  const activeRaidProgressPct = liveRaid
    ? Math.max(8, Math.min(100, (liveRaid.postedCount / Math.max(liveRaid.participantCount, 1)) * 100))
    : 0;

  return (
    <aside className="space-y-4">
      <section className="rounded-[28px] border border-white/8 bg-[linear-gradient(180deg,rgba(8,12,18,0.96),rgba(5,9,13,0.99))] p-4">
        <div className="grid grid-cols-3 gap-2">
          <div className="rounded-[18px] border border-white/8 bg-white/[0.035] px-3 py-3">
            <div className="text-[10px] uppercase tracking-[0.16em] text-white/34">Tracked</div>
            <div className="mt-1 text-lg font-semibold text-white">{trackedMarketCount || "--"}</div>
          </div>
          <div className="rounded-[18px] border border-white/8 bg-white/[0.035] px-3 py-3">
            <div className="text-[10px] uppercase tracking-[0.16em] text-white/34">Avg Vol</div>
            <div className="mt-1 text-lg font-semibold text-white">{formatCompactMetric(avgVolume)}</div>
          </div>
          <div className="rounded-[18px] border border-white/8 bg-white/[0.035] px-3 py-3">
            <div className="text-[10px] uppercase tracking-[0.16em] text-white/34">AI</div>
            <div className="mt-1 text-lg font-semibold text-lime-300">{typeof avgConviction === "number" ? avgConviction.toFixed(0) : "--"}</div>
          </div>
        </div>
        <div className="mt-2 rounded-[18px] border border-lime-300/10 bg-lime-300/[0.045] px-3 py-2 text-xs text-white/50">
          Liquidity baseline {formatCompactMetric(avgLiquidity)} across the current discovery set.
        </div>
      </section>

      <section className="rounded-[28px] border border-white/8 bg-[linear-gradient(180deg,rgba(8,12,18,0.96),rgba(5,9,13,0.99))] p-4">
        <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-white/34">
          <TrendingUp className="h-3.5 w-3.5 text-lime-300" />
          Top gainers
        </div>
        <div className="mt-4 space-y-3">
          {topGainers.slice(0, 5).map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => navigate(`/token/${item.address}`)}
              className="flex w-full items-center justify-between rounded-[18px] border border-white/8 bg-white/[0.03] px-3 py-3 text-left transition hover:bg-white/[0.06]"
            >
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold text-white">
                  {item.symbol || item.name || item.address.slice(0, 6)}
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-white/42">
                  <span>Conviction {typeof item.highConvictionScore === "number" ? item.highConvictionScore.toFixed(0) : "--"}</span>
                  <span>Confidence {typeof item.confidenceScore === "number" ? item.confidenceScore.toFixed(0) : "--"}</span>
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-white/34">
                  <span>Vol {formatCompactMetric(item.volume24h)}</span>
                  <span>Liq {formatCompactMetric(item.liquidity)}</span>
                </div>
              </div>
              <div className="text-right">
                <div className="text-sm font-semibold text-lime-300">
                  {typeof item.highConvictionScore === "number" ? `${item.highConvictionScore.toFixed(0)}/100` : "--"}
                </div>
                <div className="mt-1 text-[10px] uppercase tracking-[0.14em] text-white/34">Signal stack</div>
              </div>
            </button>
          ))}
          {!topGainers.length ? <p className="text-sm leading-6 text-white/48">No live token conviction data is available.</p> : null}
        </div>
      </section>

      <section className="rounded-[28px] border border-lime-300/12 bg-[radial-gradient(circle_at_top_right,rgba(169,255,52,0.12),transparent_30%),linear-gradient(180deg,rgba(10,15,14,0.96),rgba(7,10,13,0.98))] p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-white/34">Raid pressure</div>
            <div className="mt-1 text-sm font-semibold text-white">{liveRaid?.objective || "No active raid pulse"}</div>
          </div>
          <V2StatusPill tone="live">{liveRaid ? "Live" : "Idle"}</V2StatusPill>
        </div>
        {liveRaid ? (
          <>
            <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
              <div className="rounded-[18px] border border-white/8 bg-white/[0.04] px-3 py-3">
                <div className="text-[10px] uppercase tracking-[0.16em] text-white/34">Participants</div>
                <div className="mt-1 text-lg font-semibold text-white">{liveRaid.participantCount.toLocaleString()}</div>
              </div>
              <div className="rounded-[18px] border border-white/8 bg-white/[0.04] px-3 py-3">
                <div className="text-[10px] uppercase tracking-[0.16em] text-white/34">Posts launched</div>
                <div className="mt-1 text-lg font-semibold text-white">{liveRaid.postedCount.toLocaleString()}</div>
              </div>
            </div>
            <div className="mt-4">
              <div className="flex items-center justify-between text-[10px] uppercase tracking-[0.16em] text-white/34">
                <span>Raid throughput</span>
                <span>{activeRaidProgressPct.toFixed(0)}%</span>
              </div>
              <div className="mt-2 h-2.5 overflow-hidden rounded-full bg-white/8">
                <div
                  className="h-full rounded-full bg-[linear-gradient(90deg,rgba(169,255,52,0.96),rgba(45,212,191,0.88))]"
                  style={{ width: `${activeRaidProgressPct}%` }}
                />
              </div>
              <div className="mt-2 text-xs text-white/46">
                {liveRaid.tokenSymbol || "This token"} has {liveRaid.postedCount.toLocaleString()} live submissions against {liveRaid.participantCount.toLocaleString()} active raiders.
              </div>
            </div>
            <Button
              type="button"
              onClick={() => navigate(`/raids/${liveRaid.tokenAddress}/${liveRaid.id}`)}
              className="mt-4 h-11 w-full rounded-full border border-lime-300/30 bg-[linear-gradient(135deg,rgba(169,255,52,0.96),rgba(45,212,191,0.88))] text-sm font-semibold text-slate-950"
            >
              Join raid
            </Button>
          </>
        ) : (
          <p className="mt-3 text-sm text-white/48">A live coordinated campaign will surface here as soon as one opens.</p>
        )}
      </section>

      <section className="rounded-[28px] border border-white/8 bg-[linear-gradient(180deg,rgba(8,12,18,0.96),rgba(5,9,13,0.99))] p-4">
        <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-white/34">
          <Zap className="h-3.5 w-3.5 text-cyan-300" />
          Trending calls
        </div>
        <div className="mt-4 space-y-3">
          {trendingCalls.slice(0, 4).map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => navigate(`/post/${item.id}`)}
              className="flex w-full items-center justify-between rounded-[18px] border border-white/8 bg-white/[0.03] px-3 py-3 text-left transition hover:bg-white/[0.06]"
            >
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold text-white">{item.title || item.tokenSymbol || item.tokenName || "Tracked call"}</div>
                <div className="mt-0.5 truncate text-xs text-white/42">
                  @{item.authorHandle || "trader"} - {item.direction || "Signal"}
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-white/34">
                  <span>Conviction {typeof item.conviction === "number" ? item.conviction.toFixed(0) : "--"}</span>
                  <span>Confidence {typeof item.confidence === "number" ? item.confidence.toFixed(0) : "--"}</span>
                </div>
              </div>
              <div className="text-right">
                <div className={cn("text-sm font-semibold", typeof item.roiCurrentPct === "number" && item.roiCurrentPct >= 0 ? "text-lime-300" : "text-white")}>
                  {typeof item.roiCurrentPct === "number" ? `${item.roiCurrentPct >= 0 ? "+" : ""}${item.roiCurrentPct.toFixed(1)}%` : "--"}
                </div>
                <ArrowUpRight className="ml-auto mt-1 h-4 w-4 text-white/34" />
              </div>
            </button>
          ))}
          {!trendingCalls.length ? <p className="text-sm leading-6 text-white/48">No trending call data is available.</p> : null}
        </div>
      </section>

      {aiSpotlight ? (
        <section className="rounded-[28px] border border-lime-300/12 bg-[radial-gradient(circle_at_top_left,rgba(169,255,52,0.12),transparent_30%),linear-gradient(180deg,rgba(11,16,13,0.96),rgba(7,10,12,0.99))] p-4">
          <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-white/34">
            <BrainCircuit className="h-3.5 w-3.5 text-lime-200" />
            AI watchlist
          </div>
          <div className="mt-3 rounded-[22px] border border-lime-300/14 bg-lime-300/8 p-4">
            <div className="text-sm font-semibold text-white">{aiSpotlight.ticker || aiSpotlight.title}</div>
            <p className="mt-2 text-sm leading-6 text-white/62">{aiSpotlight.summary}</p>
            <div className="mt-4 grid grid-cols-2 gap-3">
              <div className="rounded-[16px] border border-white/8 bg-black/20 px-3 py-3">
                <div className="text-[10px] uppercase tracking-[0.16em] text-white/34">Confidence</div>
                <div className="mt-1 text-lg font-semibold text-white">
                  {typeof aiSpotlight.confidenceScore === "number" ? `${aiSpotlight.confidenceScore.toFixed(0)}/100` : "--"}
                </div>
              </div>
              <div className="rounded-[16px] border border-white/8 bg-black/20 px-3 py-3">
                <div className="text-[10px] uppercase tracking-[0.16em] text-white/34">Timing</div>
                <div className="mt-1 text-lg font-semibold text-white">{aiSpotlight.timingTier || "Monitoring"}</div>
              </div>
            </div>
            <Button
              type="button"
              variant="ghost"
              onClick={() => (aiSpotlight.tokenAddress ? navigate(`/token/${aiSpotlight.tokenAddress}`) : undefined)}
              className="mt-4 h-10 rounded-full border border-white/10 bg-black/20 px-4 text-white/76 hover:bg-white/[0.08] hover:text-white"
            >
              Open watch
            </Button>
          </div>
        </section>
      ) : null}

      <section className="rounded-[28px] border border-white/8 bg-[linear-gradient(180deg,rgba(8,12,18,0.96),rgba(5,9,13,0.99))] p-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-white/34">
            <BrainCircuit className="h-3.5 w-3.5 text-cyan-300" />
            AI watchlist
          </div>
          <div className="rounded-full border border-white/8 bg-white/[0.03] px-3 py-1 text-[10px] uppercase tracking-[0.14em] text-white/44">Live</div>
        </div>
        <div className="mt-4 space-y-3">
          {topGainers.slice(0, 4).map((item) => (
            <button
              key={`watch-${item.id}`}
              type="button"
              onClick={() => navigate(`/token/${item.address}`)}
              className="flex w-full items-center justify-between gap-3 rounded-[18px] border border-white/8 bg-white/[0.03] px-3 py-3 text-left transition hover:bg-white/[0.06]"
            >
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold text-white">{item.symbol || item.name || item.address.slice(0, 6)}</div>
                <div className="truncate text-xs text-white/42">
                  Hot alpha {typeof item.hotAlphaScore === "number" ? item.hotAlphaScore.toFixed(0) : "--"} - Vol {formatCompactMetric(item.volume24h)}
                </div>
              </div>
              <div className="text-sm font-semibold text-cyan-200">
                {typeof item.confidenceScore === "number" ? item.confidenceScore.toFixed(0) : "--"}
              </div>
            </button>
          ))}
          {!topGainers.length ? <p className="text-sm leading-6 text-white/48">No AI watchlist entries are available.</p> : null}
        </div>
      </section>

      <section className="rounded-[28px] border border-white/8 bg-[linear-gradient(180deg,rgba(8,12,18,0.96),rgba(5,9,13,0.99))] p-4">
        <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-white/34">
          <Users className="h-3.5 w-3.5 text-lime-300" />
          Community momentum
        </div>
        <div className="mt-4 space-y-3">
          {trendingCommunities.slice(0, 4).map((community) => (
            <button
              key={community.tokenAddress}
              type="button"
              onClick={() => navigate(`/communities/${community.tokenAddress}`)}
              className="flex w-full items-center justify-between rounded-[18px] border border-white/8 bg-white/[0.03] px-3 py-3 text-left transition hover:bg-white/[0.06]"
            >
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold text-white">{community.xCashtag || community.name}</div>
                <div className="mt-0.5 truncate text-xs text-white/42">
                  {community.memberCount.toLocaleString()} members - {community.threadCount.toLocaleString()} threads - {community.raidCount.toLocaleString()} raids
                </div>
              </div>
              <ArrowUpRight className="h-4 w-4 text-white/34" />
            </button>
          ))}
          {!trendingCommunities.length ? <p className="text-sm leading-6 text-white/48">No community momentum data is available.</p> : null}
        </div>
      </section>
    </aside>
  );
}
