import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowUpRight, Loader2, RadioTower, Users } from "lucide-react";
import { V2PageTopbar } from "@/components/layout/V2PageTopbar";
import { V2StatusPill } from "@/components/ui/v2/V2StatusPill";
import { api } from "@/lib/api";
import type { DiscoveryFeedSidebarResponse } from "@/types";

export default function CommunitiesIndexPage() {
  const communitiesQuery = useQuery({
    queryKey: ["discovery", "communities-index"],
    queryFn: () => api.get<DiscoveryFeedSidebarResponse>("/api/discovery/feed-sidebar"),
    staleTime: 45_000,
    refetchInterval: 90_000,
    refetchOnWindowFocus: false,
  });

  const communities = communitiesQuery.data?.trendingCommunities ?? [];
  const liveRaids = communitiesQuery.data?.liveRaids ?? [];

  return (
    <div className="space-y-4">
      <section className="rounded-[18px] border border-white/8 bg-[linear-gradient(180deg,rgba(8,12,18,0.97),rgba(3,7,10,0.99))] px-4 py-4 sm:px-5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h1 className="text-[24px] font-semibold tracking-tight text-white">COMMUNITIES</h1>
            <p className="mt-1 text-[13px] leading-5 text-white/54">Token rooms, active calls, and coordinated raid hubs.</p>
          </div>
          <V2PageTopbar placeholder="Search posts, users, tokens..." className="lg:min-w-[520px]" />
        </div>
      </section>

      {communitiesQuery.isLoading ? (
        <section className="flex min-h-[420px] items-center justify-center rounded-[22px] border border-white/8 bg-[linear-gradient(180deg,rgba(8,12,18,0.96),rgba(4,8,12,0.99))] text-white/56">
          <Loader2 className="mr-2 h-5 w-5 animate-spin" />
          Loading live communities...
        </section>
      ) : communities.length ? (
        <main className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
          <section className="rounded-[22px] border border-white/8 bg-[linear-gradient(180deg,rgba(8,12,18,0.96),rgba(4,8,12,0.99))] p-4">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold text-white">Active Community Rooms</h2>
                <p className="mt-1 text-sm text-white/48">Real token communities discovered from backend room activity.</p>
              </div>
              <V2StatusPill tone="live">{communities.length} Live</V2StatusPill>
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              {communities.map((community) => (
                <Link
                  key={community.tokenAddress}
                  to={`/communities/${community.tokenAddress}`}
                  className="group overflow-hidden rounded-[20px] border border-white/8 bg-[radial-gradient(circle_at_top_right,rgba(169,255,52,0.09),transparent_28%),linear-gradient(180deg,rgba(255,255,255,0.035),rgba(255,255,255,0.015))] p-4 transition hover:border-lime-300/20 hover:bg-white/[0.05]"
                >
                  <div className="flex items-start gap-4">
                    <div className="flex h-16 w-16 items-center justify-center overflow-hidden rounded-full border border-lime-300/18 bg-black/30">
                      {community.imageUrl ? (
                        <img src={community.imageUrl} alt="" className="h-full w-full object-cover" />
                      ) : (
                        <Users className="h-7 w-7 text-lime-300" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-3">
                        <h3 className="truncate text-lg font-semibold text-white">
                          {community.xCashtag || community.name || "Community"}
                        </h3>
                        <ArrowUpRight className="h-4 w-4 shrink-0 text-white/34 transition group-hover:text-lime-300" />
                      </div>
                      <p className="mt-1 line-clamp-2 text-sm leading-5 text-white/54">
                        {community.headline || "Live community activity from token holders and callers."}
                      </p>
                    </div>
                  </div>
                  <div className="mt-4 grid grid-cols-4 gap-2">
                    {[
                      ["Members", community.memberCount],
                      ["Online", community.onlineCount],
                      ["Threads", community.threadCount],
                      ["Raids", community.raidCount],
                    ].map(([label, value]) => (
                      <div key={label} className="rounded-[14px] border border-white/8 bg-black/20 px-2.5 py-2">
                        <div className="text-[10px] uppercase tracking-[0.14em] text-white/34">{label}</div>
                        <div className="mt-1 text-sm font-semibold text-white">{Number(value).toLocaleString()}</div>
                      </div>
                    ))}
                  </div>
                </Link>
              ))}
            </div>
          </section>

          <aside className="space-y-4">
            <section className="rounded-[22px] border border-white/8 bg-[linear-gradient(180deg,rgba(8,12,18,0.96),rgba(4,8,12,0.99))] p-4">
              <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-white/36">
                <RadioTower className="h-4 w-4 text-lime-300" />
                Community Raid Pulse
              </div>
              <div className="mt-4 space-y-3">
                {liveRaids.length ? (
                  liveRaids.map((raid) => (
                    <Link key={raid.id} to={`/raids/${raid.tokenAddress}/${raid.id}`} className="block rounded-[16px] border border-white/8 bg-white/[0.03] px-3 py-3 hover:bg-white/[0.055]">
                      <div className="flex items-center justify-between gap-3">
                        <span className="truncate text-sm font-semibold text-white">{raid.tokenSymbol ? `$${raid.tokenSymbol} RAID` : "Live Raid"}</span>
                        <span className="text-xs text-lime-300">{raid.postedCount.toLocaleString()} posts</span>
                      </div>
                      <p className="mt-1 line-clamp-2 text-xs leading-5 text-white/44">{raid.objective}</p>
                    </Link>
                  ))
                ) : (
                  <p className="text-sm leading-6 text-white/50">No active community raid is available from the backend right now.</p>
                )}
              </div>
            </section>
          </aside>
        </main>
      ) : (
        <section className="rounded-[22px] border border-white/8 bg-[linear-gradient(180deg,rgba(8,12,18,0.96),rgba(4,8,12,0.99))] px-6 py-16 text-center">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full border border-lime-300/18 bg-lime-300/8">
            <Users className="h-7 w-7 text-lime-300" />
          </div>
          <h2 className="mt-5 text-xl font-semibold text-white">No community rooms are indexed yet</h2>
          <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-white/54">
            The Communities route is wired to real discovery data. Once backend community profiles exist, they appear here as indexed rooms only.
          </p>
        </section>
      )}
    </div>
  );
}
