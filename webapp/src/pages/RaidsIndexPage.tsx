import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowUpRight, Crosshair, Flame, Loader2, RadioTower } from "lucide-react";
import { V2PageTopbar } from "@/components/layout/V2PageTopbar";
import { V2StatusPill } from "@/components/ui/v2/V2StatusPill";
import { api } from "@/lib/api";
import type { DiscoveryFeedSidebarResponse, DiscoverySidebarRaid } from "@/types";

function formatRelativeTime(value: string): string {
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return "recently";
  const deltaMinutes = Math.max(0, Math.floor((Date.now() - timestamp) / 60_000));
  if (deltaMinutes < 1) return "just now";
  if (deltaMinutes < 60) return `${deltaMinutes}m ago`;
  const deltaHours = Math.floor(deltaMinutes / 60);
  if (deltaHours < 24) return `${deltaHours}h ago`;
  return `${Math.floor(deltaHours / 24)}d ago`;
}

function raidProgressPct(raid: DiscoverySidebarRaid): number {
  return Math.max(4, Math.min(100, (raid.postedCount / Math.max(raid.participantCount, 1)) * 100));
}

export default function RaidsIndexPage() {
  const raidsQuery = useQuery({
    queryKey: ["discovery", "raids-index"],
    queryFn: () => api.get<DiscoveryFeedSidebarResponse>("/api/discovery/feed-sidebar"),
    staleTime: 45_000,
    refetchInterval: 90_000,
    refetchOnWindowFocus: false,
  });

  const raids = raidsQuery.data?.liveRaids ?? [];
  const heroRaid = raids[0] ?? null;

  return (
    <div className="space-y-4">
      <section className="rounded-[18px] border border-white/8 bg-[linear-gradient(180deg,rgba(8,12,18,0.97),rgba(3,7,10,0.99))] px-4 py-4 sm:px-5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h1 className="text-[24px] font-semibold tracking-tight text-white">RAIDS</h1>
            <p className="mt-1 text-[13px] leading-5 text-white/54">Rally together. Break resistance.</p>
          </div>
          <V2PageTopbar placeholder="Search tokens, users, raids..." className="lg:min-w-[520px]" />
        </div>
      </section>

      {raidsQuery.isLoading ? (
        <section className="flex min-h-[420px] items-center justify-center rounded-[22px] border border-white/8 bg-[linear-gradient(180deg,rgba(8,12,18,0.96),rgba(4,8,12,0.99))] text-white/56">
          <Loader2 className="mr-2 h-5 w-5 animate-spin" />
          Loading live raid rooms...
        </section>
      ) : heroRaid ? (
        <main className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
          <div className="space-y-4">
            <section className="relative overflow-hidden rounded-[22px] border border-lime-300/14 bg-[radial-gradient(circle_at_78%_20%,rgba(169,255,52,0.2),transparent_28%),linear-gradient(180deg,rgba(9,15,18,0.98),rgba(4,8,12,0.99))] p-5">
              <div className="grid gap-5 md:grid-cols-[auto_1fr_auto] md:items-center">
                <div className="flex h-24 w-24 items-center justify-center overflow-hidden rounded-full border border-lime-300/25 bg-black/30">
                  {heroRaid.tokenImageUrl ? (
                    <img src={heroRaid.tokenImageUrl} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <Crosshair className="h-10 w-10 text-lime-300" />
                  )}
                </div>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full border border-orange-300/20 bg-orange-400/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.16em] text-orange-200">
                      Live Raid
                    </span>
                    <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-lime-300">Raid #{heroRaid.id.slice(0, 8)}</span>
                  </div>
                  <h2 className="mt-3 text-3xl font-semibold tracking-tight text-white">
                    {heroRaid.tokenSymbol ? `$${heroRaid.tokenSymbol}` : "Token"} RAID
                  </h2>
                  <p className="mt-2 max-w-2xl text-sm leading-6 text-white/62">{heroRaid.objective}</p>
                  <div className="mt-4 grid gap-3 sm:grid-cols-3">
                    <div className="rounded-[16px] border border-white/8 bg-white/[0.035] px-3 py-3">
                      <div className="text-[10px] uppercase tracking-[0.16em] text-white/34">Participants</div>
                      <div className="mt-1 text-xl font-semibold text-white">{heroRaid.participantCount.toLocaleString()}</div>
                    </div>
                    <div className="rounded-[16px] border border-white/8 bg-white/[0.035] px-3 py-3">
                      <div className="text-[10px] uppercase tracking-[0.16em] text-white/34">X Posts</div>
                      <div className="mt-1 text-xl font-semibold text-white">{heroRaid.postedCount.toLocaleString()}</div>
                    </div>
                    <div className="rounded-[16px] border border-white/8 bg-white/[0.035] px-3 py-3">
                      <div className="text-[10px] uppercase tracking-[0.16em] text-white/34">Opened</div>
                      <div className="mt-1 text-xl font-semibold text-white">{formatRelativeTime(heroRaid.openedAt)}</div>
                    </div>
                  </div>
                </div>
                <Link
                  to={`/raids/${heroRaid.tokenAddress}/${heroRaid.id}`}
                  className="inline-flex h-11 items-center justify-center gap-2 rounded-[14px] border border-lime-300/25 bg-[linear-gradient(90deg,#a9ff34,#18d6a3)] px-5 text-sm font-semibold text-slate-950"
                >
                  Join Raid
                  <ArrowUpRight className="h-4 w-4" />
                </Link>
              </div>
              <div className="mt-5">
                <div className="flex items-center justify-between text-[11px] uppercase tracking-[0.16em] text-white/40">
                  <span>Progress</span>
                  <span>{raidProgressPct(heroRaid).toFixed(0)}%</span>
                </div>
                <div className="mt-2 h-2.5 overflow-hidden rounded-full bg-white/8">
                  <div
                    className="h-full rounded-full bg-[linear-gradient(90deg,#a9ff34,#18d6a3)]"
                    style={{ width: `${raidProgressPct(heroRaid)}%` }}
                  />
                </div>
              </div>
            </section>

            <section className="rounded-[22px] border border-white/8 bg-[linear-gradient(180deg,rgba(8,12,18,0.96),rgba(4,8,12,0.99))] p-4">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-lg font-semibold text-white">Active Raids</h2>
                <V2StatusPill tone="live">{raids.length} Live</V2StatusPill>
              </div>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {raids.map((raid) => (
                  <Link
                    key={raid.id}
                    to={`/raids/${raid.tokenAddress}/${raid.id}`}
                    className="rounded-[18px] border border-white/8 bg-white/[0.03] p-4 transition hover:border-lime-300/20 hover:bg-white/[0.055]"
                  >
                    <div className="flex items-center gap-3">
                      <div className="flex h-12 w-12 items-center justify-center overflow-hidden rounded-full border border-white/10 bg-black/30">
                        {raid.tokenImageUrl ? <img src={raid.tokenImageUrl} alt="" className="h-full w-full object-cover" /> : <Flame className="h-5 w-5 text-lime-300" />}
                      </div>
                      <div className="min-w-0">
                        <div className="truncate text-sm font-semibold text-white">{raid.tokenSymbol ? `$${raid.tokenSymbol} RAID` : "Token Raid"}</div>
                        <div className="text-xs text-white/42">#{raid.id.slice(0, 10)}</div>
                      </div>
                    </div>
                    <p className="mt-3 line-clamp-2 text-sm leading-5 text-white/58">{raid.objective}</p>
                    <div className="mt-4 h-2 overflow-hidden rounded-full bg-white/8">
                      <div className="h-full rounded-full bg-lime-300" style={{ width: `${raidProgressPct(raid)}%` }} />
                    </div>
                    <div className="mt-3 flex items-center justify-between text-xs text-white/44">
                      <span>{raid.participantCount.toLocaleString()} participants</span>
                      <span>{raid.postedCount.toLocaleString()} posts</span>
                    </div>
                  </Link>
                ))}
              </div>
            </section>
          </div>

          <aside className="space-y-4">
            <section className="rounded-[22px] border border-white/8 bg-[linear-gradient(180deg,rgba(8,12,18,0.96),rgba(4,8,12,0.99))] p-4">
              <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-white/36">
                <RadioTower className="h-4 w-4 text-lime-300" />
                Live Raid Feed
              </div>
              <div className="mt-4 space-y-3">
                {raids.map((raid) => (
                  <Link key={`rail-${raid.id}`} to={`/raids/${raid.tokenAddress}/${raid.id}`} className="block rounded-[16px] border border-white/8 bg-white/[0.03] px-3 py-3 hover:bg-white/[0.055]">
                    <div className="flex items-center justify-between gap-3">
                      <span className="truncate text-sm font-semibold text-white">{raid.tokenSymbol ? `$${raid.tokenSymbol}` : "Raid"}</span>
                      <span className="text-xs text-lime-300">{raidProgressPct(raid).toFixed(0)}%</span>
                    </div>
                    <p className="mt-1 line-clamp-2 text-xs leading-5 text-white/44">{raid.objective}</p>
                  </Link>
                ))}
              </div>
            </section>
          </aside>
        </main>
      ) : (
        <section className="rounded-[22px] border border-white/8 bg-[linear-gradient(180deg,rgba(8,12,18,0.96),rgba(4,8,12,0.99))] px-6 py-16 text-center">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full border border-lime-300/18 bg-lime-300/8">
            <Crosshair className="h-7 w-7 text-lime-300" />
          </div>
          <h2 className="mt-5 text-xl font-semibold text-white">No live raid room is available</h2>
          <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-white/54">
            Raid navigation is real, but there is no active backend raid campaign to join right now.
          </p>
        </section>
      )}
    </div>
  );
}
