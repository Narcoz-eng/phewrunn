import { Suspense, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Flame, Users } from "lucide-react";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth-client";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { TokenCommunitySection } from "@/components/token-community/TokenCommunitySection";
import { cn } from "@/lib/utils";
import type {
  TokenCommunityProfile,
  TokenCommunityRoom,
  TokenCommunitySummaryResponse,
  TokenCommunityTopCall,
  DiscoverySidebarRaid,
} from "@/types";

type CommunityTab = "feed" | "calls" | "members" | "about" | "raids";

function formatCompact(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "--";
  return new Intl.NumberFormat("en-US", {
    notation: value >= 1_000 ? "compact" : "standard",
    maximumFractionDigits: 1,
  }).format(value);
}

function formatPct(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "--";
  return `${value >= 0 ? "+" : ""}${value.toFixed(value >= 10 ? 1 : 2)}%`;
}

export default function CommunityPage() {
  const navigate = useNavigate();
  const { tokenAddress = "" } = useParams<{ tokenAddress: string }>();
  const { user, canPerformAuthenticatedWrites } = useAuth();
  const [tab, setTab] = useState<CommunityTab>("feed");

  const summaryQuery = useQuery<TokenCommunitySummaryResponse>({
    queryKey: ["community-summary", tokenAddress],
    enabled: tokenAddress.length > 0,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    queryFn: async () => api.get<TokenCommunitySummaryResponse>(`/api/tokens/${tokenAddress}/community/summary`),
  });

  const roomQuery = useQuery<TokenCommunityRoom>({
    queryKey: ["community-room-v2", tokenAddress],
    enabled: tokenAddress.length > 0,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    queryFn: async () => api.get<TokenCommunityRoom>(`/api/tokens/${tokenAddress}/community/room`),
  });

  const profileQuery = useQuery<TokenCommunityProfile>({
    queryKey: ["community-profile-v2", tokenAddress],
    enabled: tokenAddress.length > 0,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    queryFn: async () => api.get<TokenCommunityProfile>(`/api/tokens/${tokenAddress}/community/profile`),
  });

  const topCallsQuery = useQuery<TokenCommunityTopCall[]>({
    queryKey: ["community-top-calls", tokenAddress],
    enabled: tokenAddress.length > 0,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    queryFn: async () => api.get<TokenCommunityTopCall[]>(`/api/tokens/${tokenAddress}/community/top-calls`),
  });

  const raidsQuery = useQuery<DiscoverySidebarRaid[]>({
    queryKey: ["community-raids", tokenAddress],
    enabled: tokenAddress.length > 0,
    staleTime: 20_000,
    refetchOnWindowFocus: false,
    queryFn: async () => api.get<DiscoverySidebarRaid[]>(`/api/tokens/${tokenAddress}/community/raids`),
  });

  const summary = summaryQuery.data ?? null;
  const room = roomQuery.data ?? null;
  const profile = profileQuery.data ?? null;
  const topCalls = topCallsQuery.data ?? [];
  const raids = raidsQuery.data ?? [];
  const activeRaid = summary?.activeRaid ?? raids[0] ?? null;
  const featuredTopCall = topCalls[0] ?? null;
  const heroName = summary?.hero.xCashtag || profile?.xCashtag || room?.xCashtag || "Community";
  const heroImage = summary?.hero.imageUrl || room?.assets.logo?.renderUrl || room?.assets.mascot?.renderUrl || undefined;
  const banner = summary?.hero.bannerUrl || room?.assets.banner?.renderUrl || undefined;
  const isLoading = summaryQuery.isLoading || roomQuery.isLoading;
  if (isLoading) {
    return (
      <div className="rounded-[30px] border border-white/8 bg-white/[0.03] px-6 py-10 text-sm text-white/56">
        Loading community board...
      </div>
    );
  }

  if (!summary || !room) {
    return (
      <section className="rounded-[30px] border border-dashed border-white/12 px-6 py-16 text-center">
        <div className="mx-auto max-w-lg">
          <h1 className="text-2xl font-semibold text-white">Community unavailable</h1>
          <p className="mt-3 text-sm leading-6 text-white/52">
            This token does not have a community summary available yet.
          </p>
        </div>
      </section>
    );
  }

  return (
    <div className="space-y-5">
      <section className="overflow-hidden rounded-[32px] border border-white/8 bg-[linear-gradient(180deg,rgba(8,12,16,0.98),rgba(4,7,10,0.98))]">
        <div className="relative">
          {banner ? (
            <div className="absolute inset-0">
              <div className="absolute inset-0 bg-cover bg-center opacity-50" style={{ backgroundImage: `url("${banner}")` }} />
              <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(3,7,9,0.24),rgba(3,7,9,0.95)),radial-gradient(circle_at_top_left,rgba(169,255,52,0.14),transparent_28%),radial-gradient(circle_at_top_right,rgba(45,212,191,0.12),transparent_28%)]" />
            </div>
          ) : (
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(169,255,52,0.14),transparent_28%),radial-gradient(circle_at_top_right,rgba(45,212,191,0.12),transparent_28%),linear-gradient(180deg,rgba(4,9,12,0.24),rgba(4,9,12,0.94))]" />
          )}
          <div className="relative p-5 sm:p-6 lg:p-7">
            <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
              <div className="flex items-start gap-4">
                <Avatar className="h-24 w-24 rounded-[28px] border border-lime-300/20 shadow-[0_24px_64px_-28px_rgba(169,255,52,0.42)]">
                  <AvatarImage src={heroImage} />
                  <AvatarFallback className="bg-white/[0.04] text-2xl font-semibold text-white">
                    {heroName.charAt(0)}
                  </AvatarFallback>
                </Avatar>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-[11px] uppercase tracking-[0.16em] text-white/62">
                      Public Community
                    </span>
                    {activeRaid ? (
                      <span className="rounded-full border border-lime-300/18 bg-lime-300/8 px-3 py-1 text-[11px] uppercase tracking-[0.16em] text-lime-200">
                        Live Raid
                      </span>
                    ) : null}
                  </div>
                  <h1 className="mt-4 text-4xl font-semibold tracking-[-0.05em] text-white sm:text-5xl">
                    {heroName}
                  </h1>
                  <div className="mt-2 flex flex-wrap items-center gap-3 text-sm text-white/56">
                    <span>{formatCompact(summary.hero.memberCount)} Members</span>
                    <span className="h-1.5 w-1.5 rounded-full bg-lime-300/70" />
                    <span>{formatCompact(summary.hero.onlineNowEstimate)} Online</span>
                  </div>
                  <p className="mt-3 max-w-2xl text-sm leading-6 text-white/60">
                    {profile?.headline || room.headline || "The official token community. Share calls, alpha, and coordinated raid momentum together."}
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  className="h-11 rounded-[16px] border-white/10 bg-white/[0.04] px-5 text-white/80 hover:bg-white/[0.08] hover:text-white"
                >
                  + Invite
                </Button>
                {activeRaid ? (
                  <Link to={`/raids/${tokenAddress}/${activeRaid.id}`} className="inline-flex h-11 items-center rounded-[16px] border border-lime-300/20 bg-[linear-gradient(90deg,rgba(169,255,52,0.96),rgba(45,212,191,0.9))] px-5 text-sm font-semibold text-slate-950">
                    Join Raid
                  </Link>
                ) : (
                  <Button type="button" onClick={() => navigate(`/token/${tokenAddress}?tab=community`)} className="h-11 rounded-[16px] px-5 text-slate-950">
                    Open Token Board
                  </Button>
                )}
              </div>
            </div>

            <div className="mt-6 flex flex-wrap gap-6 border-t border-white/8 pt-4">
              {[
                { value: "feed", label: "Feed" },
                { value: "calls", label: "Top Calls" },
                { value: "members", label: "Members" },
                { value: "about", label: "About" },
                { value: "raids", label: "Raids" },
              ].map((item) => (
                <button
                  key={item.value}
                  type="button"
                  onClick={() => setTab(item.value as CommunityTab)}
                  className={cn(
                    "relative pb-2 text-sm font-medium transition",
                    tab === item.value ? "text-lime-200" : "text-white/44 hover:text-white/72"
                  )}
                >
                  {item.label}
                  {tab === item.value ? <span className="absolute inset-x-0 bottom-0 h-0.5 rounded-full bg-lime-300" /> : null}
                </button>
              ))}
            </div>

            <div className="mt-6 grid gap-3 md:grid-cols-4 xl:grid-cols-6">
              <HeroStat label="Members" value={formatCompact(summary.hero.memberCount)} />
              <HeroStat label="Online" value={formatCompact(summary.hero.onlineNowEstimate)} />
              <HeroStat label="Posts" value={formatCompact(summary.stats.posts)} />
              <HeroStat label="Calls" value={formatCompact(summary.stats.calls)} />
              <HeroStat label="Top Call ROI" value={featuredTopCall ? formatPct(featuredTopCall.roiCurrentPct) : "--"} />
              <HeroStat label="Raids" value={formatCompact(raids.length)} />
            </div>
          </div>
        </div>
      </section>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_300px_320px]">
        <div className="space-y-4">
          {(tab === "feed" || tab === "calls") && summary.pinnedCall ? (
            <section className="rounded-[30px] border border-white/8 bg-[linear-gradient(180deg,rgba(7,12,15,0.98),rgba(4,7,9,0.98))] p-5 sm:p-6">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-white/38">Pinned Call</div>
                  <div className="mt-3 flex items-center gap-3">
                    <Avatar className="h-11 w-11 border border-white/10">
                      <AvatarImage src={summary.pinnedCall.author.image ?? undefined} />
                      <AvatarFallback className="bg-white/[0.04] text-white">
                        {(summary.pinnedCall.author.username || summary.pinnedCall.author.name || "P").charAt(0)}
                      </AvatarFallback>
                    </Avatar>
                    <div>
                      <div className="text-sm font-semibold text-white">
                        {summary.pinnedCall.author.username || summary.pinnedCall.author.name}
                      </div>
                      <div className="text-xs text-white/40">{new Date(summary.pinnedCall.createdAt).toLocaleDateString()}</div>
                    </div>
                  </div>
                </div>
                <span className="rounded-full border border-lime-300/18 bg-lime-300/8 px-3 py-1 text-[11px] uppercase tracking-[0.14em] text-lime-200">
                  High Conviction
                </span>
              </div>

              <div className="mt-5">
                <div className="text-2xl font-semibold tracking-[-0.04em] text-lime-200">
                  {summary.pinnedCall.title || `${heroName} LONG`}
                </div>
                <p className="mt-3 text-sm leading-7 text-white/62">{summary.pinnedCall.content}</p>
                <div className="mt-5 grid gap-3 sm:grid-cols-3">
                  <MiniMetric label="Pinned By" value={summary.pinnedCall.author.username || summary.pinnedCall.author.name || "Community"} />
                  <MiniMetric
                    label="Top Call ROI"
                    value={featuredTopCall ? formatPct(featuredTopCall.roiCurrentPct) : "--"}
                  />
                  <MiniMetric
                    label="Peak ROI"
                    value={featuredTopCall ? formatPct(featuredTopCall.roiPeakPct) : "--"}
                  />
                </div>
                <div className="mt-4 rounded-[24px] border border-white/8 bg-[linear-gradient(180deg,rgba(169,255,52,0.08),rgba(45,212,191,0.04))] px-4 py-4 text-sm leading-6 text-white/56">
                  {featuredTopCall ? (
                    <>
                      Ranked call context comes from the real community top-calls feed. The pinned thread remains the real featured community post.
                    </>
                  ) : (
                    <>
                      This is the real pinned community post. Ranked call performance will appear here when the community top-calls feed has enough data.
                    </>
                  )}
                </div>
              </div>
            </section>
          ) : null}

          {tab === "feed" ? (
            <Suspense fallback={<div className="rounded-[30px] border border-white/8 bg-white/[0.03] px-6 py-10 text-sm text-white/56">Loading community feed...</div>}>
              <TokenCommunitySection
                tokenAddress={tokenAddress}
                tokenSymbol={heroName}
                tokenName={profile?.headline ?? room.headline ?? heroName}
                viewer={user}
                canPerformAuthenticatedWrites={canPerformAuthenticatedWrites}
              />
            </Suspense>
          ) : null}

          {tab === "calls" ? (
            <section className="space-y-4">
              {topCalls.map((call) => (
                <div key={call.id} className="rounded-[28px] border border-white/8 bg-[linear-gradient(180deg,rgba(7,12,15,0.98),rgba(4,7,9,0.98))] p-5">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <Avatar className="h-11 w-11 border border-white/10">
                        <AvatarImage src={call.author.image ?? undefined} />
                        <AvatarFallback className="bg-white/[0.04] text-white">
                          {(call.author.username || call.author.name || "C").charAt(0)}
                        </AvatarFallback>
                      </Avatar>
                      <div>
                        <div className="text-sm font-semibold text-white">{call.author.username || call.author.name}</div>
                        <div className="text-xs text-white/42">{new Date(call.createdAt).toLocaleString()}</div>
                      </div>
                    </div>
                    <span className="rounded-full border border-lime-300/14 bg-lime-300/8 px-3 py-1 text-[11px] uppercase tracking-[0.14em] text-lime-200">
                      {call.conviction || "Signal"}
                    </span>
                  </div>
                  <div className="mt-4 text-2xl font-semibold tracking-[-0.04em] text-white">
                    {call.ticker ? `$${call.ticker}` : call.title || "Community call"}
                  </div>
                  <div className="mt-4 grid gap-3 sm:grid-cols-2">
                    <MiniMetric label="Current ROI" value={formatPct(call.roiCurrentPct)} />
                    <MiniMetric label="Peak ROI" value={formatPct(call.roiPeakPct)} />
                  </div>
                </div>
              ))}
            </section>
          ) : null}

          {tab === "members" ? (
            <section className="rounded-[30px] border border-white/8 bg-[linear-gradient(180deg,rgba(7,12,15,0.98),rgba(4,7,9,0.98))] p-5 sm:p-6">
              <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-white/38">Members</div>
              <h2 className="mt-2 text-2xl font-semibold tracking-[-0.04em] text-white">Online members</h2>
              <div className="mt-5 grid gap-3 sm:grid-cols-2">
                {summary.onlineMembers.map((member) => (
                  <div key={`${member.user.id}:${member.joinedAt}`} className="flex items-center gap-3 rounded-[20px] border border-white/8 bg-black/20 px-4 py-4">
                    <Avatar className="h-11 w-11 border border-white/8">
                      <AvatarImage src={member.user.image ?? undefined} />
                      <AvatarFallback className="bg-white/[0.04] text-white">
                        {(member.user.username || member.user.name || "M").charAt(0)}
                      </AvatarFallback>
                    </Avatar>
                    <div>
                      <div className="text-sm font-semibold text-white">{member.user.username || member.user.name}</div>
                      <div className="text-xs text-white/42">Joined {new Date(member.joinedAt).toLocaleDateString()}</div>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          ) : null}

          {tab === "about" ? (
            <section className="rounded-[30px] border border-white/8 bg-[linear-gradient(180deg,rgba(7,12,15,0.98),rgba(4,7,9,0.98))] p-5 sm:p-6">
              <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-white/38">About</div>
              <h2 className="mt-2 text-2xl font-semibold tracking-[-0.04em] text-white">Community operating model</h2>
              <div className="mt-5 space-y-3">
                <div className="rounded-[22px] border border-white/8 bg-black/20 px-4 py-4 text-sm leading-6 text-white/62">
                  {room.whyLine || profile?.whyLine || "This room exists to coordinate calls, share alpha, and organize raids around live token momentum."}
                </div>
                <div className="rounded-[22px] border border-white/8 bg-black/20 px-4 py-4 text-sm leading-6 text-white/62">
                  {room.welcomePrompt || profile?.welcomePrompt || "Introduce yourself, post a setup, and join the next coordinated push when conviction is high."}
                </div>
                <div className="flex flex-wrap gap-2 pt-1">
                  {room.vibeTags.map((tag) => (
                    <span key={tag} className="rounded-full border border-lime-300/14 bg-lime-300/8 px-3 py-1 text-xs text-lime-200">
                      {tag}
                    </span>
                  ))}
                </div>
              </div>
            </section>
          ) : null}

          {tab === "raids" ? (
            <section className="space-y-4">
              {raids.map((raid) => (
                <Link key={raid.id} to={`/raids/${tokenAddress}/${raid.id}`} className="block rounded-[28px] border border-white/8 bg-[linear-gradient(180deg,rgba(7,12,15,0.98),rgba(4,7,9,0.98))] p-5 transition hover:border-lime-300/16 hover:bg-white/[0.04]">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <div className="flex h-12 w-12 items-center justify-center rounded-full border border-lime-300/20 bg-lime-300/10">
                        <Flame className="h-5 w-5 text-lime-200" />
                      </div>
                      <div>
                        <div className="text-lg font-semibold text-white">{raid.objective}</div>
                        <div className="text-xs text-white/42">{new Date(raid.openedAt).toLocaleString()}</div>
                      </div>
                    </div>
                    <span className="rounded-full border border-white/10 bg-white/[0.03] px-3 py-1 text-xs text-white/62">
                      {raid.status}
                    </span>
                  </div>
                </Link>
              ))}
            </section>
          ) : null}
        </div>

        <div className="space-y-4">
          <section className="rounded-[30px] border border-white/8 bg-white/[0.03] p-5">
            <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-white/38">Top Contributors</div>
            <div className="mt-4 space-y-3">
              {summary.topContributors.slice(0, 5).map((contributor, index) => (
                <div key={contributor.user.id} className="flex items-center justify-between gap-4 rounded-[18px] border border-white/8 bg-black/20 px-3 py-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="flex h-8 w-8 items-center justify-center rounded-full border border-white/8 bg-white/[0.04] text-sm font-semibold text-lime-200">
                      {index + 1}
                    </div>
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold text-white">{contributor.user.username || contributor.user.name}</div>
                      <div className="text-xs text-white/42">{contributor.badge} • {contributor.currentRaidStreak} streak</div>
                    </div>
                  </div>
                  <div className="text-sm font-semibold text-lime-300">{formatCompact(contributor.contributionScore)}</div>
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-[30px] border border-white/8 bg-white/[0.03] p-5">
            <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-white/38">Community Stats</div>
            <div className="mt-4 grid grid-cols-3 gap-3">
              <MiniMetric label="Members" value={formatCompact(summary.stats.members)} />
              <MiniMetric label="Posts" value={formatCompact(summary.stats.posts)} />
              <MiniMetric label="Calls" value={formatCompact(summary.stats.calls)} />
            </div>
          </section>

          <section className="rounded-[30px] border border-white/8 bg-white/[0.03] p-5">
            <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-white/38">Online Members</div>
            <div className="mt-4 flex items-center">
              {summary.onlineMembers.slice(0, 5).map((member, index) => (
                <Avatar key={`${member.user.id}:${member.joinedAt}`} className={cn("h-12 w-12 border-2 border-[#091115]", index > 0 && "-ml-3")}>
                  <AvatarImage src={member.user.image ?? undefined} />
                  <AvatarFallback className="bg-white/[0.04] text-white">
                    {(member.user.username || member.user.name || "O").charAt(0)}
                  </AvatarFallback>
                </Avatar>
              ))}
              <div className="ml-3 rounded-full border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-white/62">
                +{Math.max(summary.hero.onlineNowEstimate - summary.onlineMembers.length, 0)}
              </div>
            </div>
          </section>
        </div>

        <div className="space-y-4">
          <section className="rounded-[30px] border border-white/8 bg-[linear-gradient(180deg,rgba(7,12,15,0.98),rgba(4,7,9,0.98))] p-5">
            <div className="flex items-center justify-between gap-3">
              <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-white/38">Live Raid</div>
              <span className={cn(
                "rounded-full border px-3 py-1 text-[11px] uppercase tracking-[0.14em]",
                activeRaid ? "border-lime-300/18 bg-lime-300/8 text-lime-200" : "border-white/10 bg-white/[0.03] text-white/54"
              )}>
                {activeRaid ? "Live" : "Idle"}
              </span>
            </div>
            {activeRaid ? (
              <div className="mt-4 space-y-4">
                <div className="flex items-center gap-3">
                  <div className="flex h-14 w-14 items-center justify-center rounded-full border border-lime-300/20 bg-lime-300/10">
                    <Flame className="h-6 w-6 text-lime-200" />
                  </div>
                  <div>
                    <div className="text-xl font-semibold text-white">{activeRaid.objective}</div>
                    <div className="mt-1 text-sm text-white/50">Target: trend this token on X</div>
                  </div>
                </div>
                <MetricRow label="Participants" value={formatCompact(activeRaid.participantCount)} />
                <MetricRow label="Posts" value={formatCompact(activeRaid.postedCount)} />
                <div className="h-3 overflow-hidden rounded-full bg-white/8">
                  <div className="h-full rounded-full bg-[linear-gradient(90deg,rgba(169,255,52,0.96),rgba(45,212,191,0.9))]" style={{ width: `${Math.min(100, Math.max(18, (activeRaid.postedCount / Math.max(activeRaid.participantCount, 1)) * 100))}%` }} />
                </div>
                <Link to={`/raids/${tokenAddress}/${activeRaid.id}`} className="inline-flex h-11 w-full items-center justify-center rounded-[16px] border border-lime-300/20 bg-[linear-gradient(90deg,rgba(169,255,52,0.96),rgba(45,212,191,0.9))] px-4 text-sm font-semibold text-slate-950">
                  Join Raid
                </Link>
              </div>
            ) : (
              <div className="mt-4 rounded-[20px] border border-dashed border-white/10 px-4 py-8 text-center text-sm text-white/46">
                No active raid is running right now.
              </div>
            )}
          </section>

          <section className="rounded-[30px] border border-white/8 bg-white/[0.03] p-5">
            <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-white/38">Recent Raids</div>
            <div className="mt-4 space-y-3">
              {summary.recentRaids.length ? summary.recentRaids.map((raid) => (
                <Link key={raid.id} to={`/raids/${tokenAddress}/${raid.id}`} className="flex items-center justify-between gap-3 rounded-[18px] border border-white/8 bg-black/20 px-3 py-3 transition hover:bg-white/[0.04]">
                  <div>
                    <div className="text-sm font-semibold text-white">{raid.objective}</div>
                    <div className="text-xs text-white/42">{new Date(raid.openedAt).toLocaleDateString()}</div>
                  </div>
                  <div className="text-xs text-white/54">{formatCompact(raid.participantCount)} joined</div>
                </Link>
              )) : (
                <div className="rounded-[18px] border border-dashed border-white/10 px-4 py-8 text-center text-sm text-white/46">
                  No recent raids visible yet.
                </div>
              )}
            </div>
          </section>

          <section className="rounded-[30px] border border-white/8 bg-white/[0.03] p-5">
            <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-white/38">
              <Users className="h-4 w-4 text-lime-200" />
              Community Value
            </div>
            <div className="mt-4 space-y-3">
              {[
                "AI detection compounds the best calls in the room.",
                "Threads and replies keep the narrative live.",
                "Raids convert community conviction into coordinated action.",
              ].map((line) => (
                <div key={line} className="rounded-[18px] border border-white/8 bg-black/20 px-4 py-4 text-sm leading-6 text-white/58">
                  {line}
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

function MiniMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[18px] border border-white/8 bg-black/20 px-3 py-3">
      <div className="text-[10px] uppercase tracking-[0.16em] text-white/38">{label}</div>
      <div className="mt-2 text-lg font-semibold text-white">{value}</div>
    </div>
  );
}

function MetricRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[18px] border border-white/8 bg-white/[0.03] px-4 py-3 text-sm text-white/66">
      {label}
      <span className="float-right font-semibold text-white">{value}</span>
    </div>
  );
}
