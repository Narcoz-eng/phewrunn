import { Suspense, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Activity, ExternalLink, Flame, ShieldCheck, Users } from "lucide-react";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth-client";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { V2PageHeader } from "@/components/layout/V2PageHeader";
import { V2EmptyState } from "@/components/ui/v2/V2EmptyState";
import { V2MetricCard } from "@/components/ui/v2/V2MetricCard";
import { V2SectionHeader } from "@/components/ui/v2/V2SectionHeader";
import { V2StatusPill } from "@/components/ui/v2/V2StatusPill";
import { V2Surface } from "@/components/ui/v2/V2Surface";
import { TokenCommunitySection } from "@/components/token-community/TokenCommunitySection";
import { cn } from "@/lib/utils";
import type { TokenActiveRaidResponse, TokenCommunityProfile, TokenCommunityRoom } from "@/types";

type CommunityTab = "feed" | "calls" | "members" | "about" | "raids";

function formatCompact(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "--";
  return new Intl.NumberFormat("en-US", {
    notation: value >= 1000 ? "compact" : "standard",
    maximumFractionDigits: 1,
  }).format(value);
}

export default function CommunityPage() {
  const navigate = useNavigate();
  const { tokenAddress = "" } = useParams<{ tokenAddress: string }>();
  const { user, canPerformAuthenticatedWrites } = useAuth();
  const [activeTab, setActiveTab] = useState<CommunityTab>("feed");

  const profileQuery = useQuery<TokenCommunityProfile>({
    queryKey: ["community-page", "profile", tokenAddress],
    enabled: tokenAddress.length > 0,
    queryFn: async () => api.get<TokenCommunityProfile>(`/api/tokens/${tokenAddress}/community/profile`),
    refetchOnWindowFocus: false,
    staleTime: 30_000,
  });

  const roomQuery = useQuery<TokenCommunityRoom>({
    queryKey: ["community-page", "room", tokenAddress],
    enabled: tokenAddress.length > 0,
    queryFn: async () => api.get<TokenCommunityRoom>(`/api/tokens/${tokenAddress}/community/room`),
    refetchOnWindowFocus: false,
    staleTime: 30_000,
  });

  const activeRaidQuery = useQuery<TokenActiveRaidResponse>({
    queryKey: ["community-page", "raid", tokenAddress],
    enabled: tokenAddress.length > 0,
    queryFn: async () => api.get<TokenActiveRaidResponse>(`/api/tokens/${tokenAddress}/community/raids/active`),
    refetchOnWindowFocus: false,
    staleTime: 15_000,
  });

  const room = roomQuery.data ?? null;
  const profile = profileQuery.data ?? null;
  const activeRaid = activeRaidQuery.data?.campaign ?? null;
  const heroImage =
    room?.assets.logo?.renderUrl ||
    room?.assets.mascot?.renderUrl ||
    room?.assets.banner?.renderUrl ||
    undefined;

  const tabs: Array<{ value: CommunityTab; label: string }> = [
    { value: "feed", label: "Feed" },
    { value: "calls", label: "Calls" },
    { value: "members", label: "Members" },
    { value: "about", label: "About" },
    { value: "raids", label: "Raids" },
  ];

  return (
    <div className="space-y-5">
      <V2PageHeader
        title={profile?.xCashtag || room?.xCashtag || "Community"}
        description={profile?.headline || room?.headline || "Token community feed, contributors, and active raids surfaced through the existing token community stack."}
        badge={<V2StatusPill tone={activeRaid ? "live" : "default"}>{activeRaid ? "Live Raid" : "Community"}</V2StatusPill>}
        onBack={() => navigate(-1)}
      />

      {roomQuery.isLoading ? (
        <V2Surface className="p-8">
          <div className="text-sm text-white/56">Loading community context...</div>
        </V2Surface>
      ) : roomQuery.isError || !room ? (
        <V2EmptyState
          icon={<Users className="h-7 w-7" />}
          title="Community unavailable"
          description="This token does not have a resolvable community room yet from the current community API."
        />
      ) : (
        <>
          <V2Surface tone="accent" className="overflow-hidden p-0">
            <div className="relative">
              {room.assets.banner?.renderUrl ? (
                <div className="absolute inset-0">
                  <div
                    className="absolute inset-0 bg-cover bg-center opacity-55"
                    style={{ backgroundImage: `url("${room.assets.banner.renderUrl}")` }}
                    aria-hidden="true"
                  />
                  <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(2,6,10,0.25),rgba(2,6,10,0.94)),radial-gradient(circle_at_top_left,rgba(169,255,52,0.14),transparent_28%),radial-gradient(circle_at_top_right,rgba(45,212,191,0.1),transparent_28%)]" />
                </div>
              ) : (
                <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(169,255,52,0.14),transparent_24%),radial-gradient(circle_at_top_right,rgba(45,212,191,0.1),transparent_24%),linear-gradient(180deg,rgba(5,10,14,0.22),rgba(5,10,14,0.9))]" />
              )}

              <div className="relative space-y-6 p-5 sm:p-6 lg:p-7">
                <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
                  <div className="flex min-w-0 items-start gap-4">
                    <Avatar className="h-24 w-24 rounded-[28px] border border-lime-300/20 shadow-[0_24px_64px_-28px_rgba(169,255,52,0.42)]">
                      <AvatarImage src={heroImage} />
                      <AvatarFallback className="bg-white/[0.04] text-2xl font-semibold text-white">
                        {(profile?.xCashtag || room.xCashtag || "C").charAt(0)}
                      </AvatarFallback>
                    </Avatar>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <V2StatusPill tone="xp">{room.viewer.joined ? "Public Community" : "Open Room"}</V2StatusPill>
                        {activeRaid ? <V2StatusPill tone="live">Raid Live</V2StatusPill> : null}
                      </div>
                      <h2 className="mt-4 text-4xl font-semibold tracking-tight text-white sm:text-5xl">
                        {profile?.xCashtag || room.xCashtag || "Community"}
                      </h2>
                      <div className="mt-2 flex flex-wrap items-center gap-3 text-sm text-white/56">
                        <span>{formatCompact(room.memberCount)} Members</span>
                        <span className="h-1.5 w-1.5 rounded-full bg-lime-300/70" />
                        <span>{formatCompact(room.onlineNowEstimate)} Online</span>
                      </div>
                      <p className="mt-3 max-w-2xl text-sm leading-6 text-white/60">
                        {profile?.headline || room.headline || "The official token community. Share calls, alpha, and raid together."}
                      </p>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      className="h-11 rounded-[16px] border-white/10 bg-white/[0.04] px-5 text-white/78 hover:bg-white/[0.08] hover:text-white"
                    >
                      + Invite
                    </Button>
                    {activeRaid ? (
                      <Link
                        to={`/raids/${tokenAddress}/${activeRaid.id}`}
                        className="inline-flex h-11 items-center rounded-[16px] border border-lime-300/20 bg-lime-300/12 px-5 text-sm font-semibold text-lime-200"
                      >
                        Join Raid
                      </Link>
                    ) : (
                      <Link
                        to={`/token/${tokenAddress}?tab=community`}
                        className="inline-flex h-11 items-center rounded-[16px] border border-lime-300/20 bg-lime-300/12 px-5 text-sm font-semibold text-lime-200"
                      >
                        Open Board
                      </Link>
                    )}
                  </div>
                </div>

                <div className="flex flex-wrap gap-6 border-t border-white/8 pt-4">
                  {tabs.map((tab) => (
                    <button
                      key={tab.value}
                      type="button"
                      onClick={() => setActiveTab(tab.value)}
                      className={cn(
                        "relative pb-2 text-sm font-medium transition",
                        activeTab === tab.value ? "text-lime-200" : "text-white/44 hover:text-white/72"
                      )}
                    >
                      {tab.label}
                      {activeTab === tab.value ? (
                        <span className="absolute inset-x-0 bottom-0 h-0.5 rounded-full bg-lime-300" />
                      ) : null}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </V2Surface>

          <div className="grid gap-4 xl:grid-cols-[minmax(0,1.15fr)_320px_320px]">
            <div className="space-y-4">
              {activeTab === "feed" || activeTab === "calls" ? (
                <>
                  <V2Surface className="p-5 sm:p-6">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-white/38">Pinned Call</div>
                        <div className="mt-3 flex items-center gap-3">
                          <Avatar className="h-11 w-11 border border-white/10">
                            <AvatarImage src={getAuthorImage(room.suggestedThread?.author.image)} />
                            <AvatarFallback className="bg-white/[0.04] text-white">
                              {(room.suggestedThread?.author.username || room.suggestedThread?.author.name || "P").charAt(0)}
                            </AvatarFallback>
                          </Avatar>
                          <div>
                            <div className="text-sm font-semibold text-white">
                              {room.suggestedThread?.author.username || room.suggestedThread?.author.name || "PhewRunner"}
                            </div>
                            <div className="text-xs text-white/40">
                              {room.suggestedThread?.createdAt ? new Date(room.suggestedThread.createdAt).toLocaleDateString() : "High conviction"}
                            </div>
                          </div>
                        </div>
                      </div>
                      <V2StatusPill tone="ai">High Conviction</V2StatusPill>
                    </div>

                    <div className="mt-5 space-y-3">
                      <div className="text-2xl font-semibold tracking-tight text-lime-200">
                        {room.suggestedThread?.title || `${profile?.xCashtag || room.xCashtag || "Token"} LONG`}
                      </div>
                      <div className="text-sm leading-7 text-white/62">
                        {room.suggestedThread?.content || room.whyLine || profile?.whyLine || "Share calls, alpha, and raid together."}
                      </div>
                      <div className="rounded-[24px] border border-white/8 bg-[linear-gradient(180deg,rgba(169,255,52,0.08),rgba(45,212,191,0.04))] p-4">
                        <div className="h-[180px] rounded-[20px] border border-white/6 bg-[linear-gradient(180deg,rgba(255,255,255,0.02),rgba(255,255,255,0.01))] p-3">
                          <div className="flex h-full items-end gap-2">
                            {Array.from({ length: 18 }).map((_, index) => (
                              <div key={index} className="flex flex-1 items-end">
                                <div
                                  className="w-full rounded-t-[10px] bg-[linear-gradient(180deg,rgba(169,255,52,0.95),rgba(45,212,191,0.75))]"
                                  style={{ height: `${28 + ((index * 19) % 74)}%` }}
                                />
                              </div>
                            ))}
                          </div>
                        </div>
                        <div className="mt-3 flex items-center justify-between text-sm">
                          <div className="text-white/44">Pinned momentum snapshot</div>
                          <div className="font-semibold text-lime-300">+24.23%</div>
                        </div>
                      </div>

                      <div className="flex items-center gap-6 text-sm text-white/50">
                        <span>112 hearts</span>
                        <span>45 reposts</span>
                        <span>23 comments</span>
                      </div>
                    </div>
                  </V2Surface>

                  <Suspense fallback={<V2Surface className="p-8 text-sm text-white/56">Loading community feed...</V2Surface>}>
                    <TokenCommunitySection
                      tokenAddress={tokenAddress}
                      tokenSymbol={profile?.xCashtag ?? null}
                      tokenName={profile?.headline ?? room.headline ?? null}
                      viewer={user}
                      canPerformAuthenticatedWrites={canPerformAuthenticatedWrites}
                    />
                  </Suspense>
                </>
              ) : null}

              {activeTab === "about" ? (
                <V2Surface className="p-5 sm:p-6">
                  <V2SectionHeader
                    eyebrow="About"
                    title="Community operating model"
                    description="Why the room exists, how it organizes, and what members are here to do."
                  />
                  <div className="mt-5 grid gap-3">
                    <div className="rounded-[22px] border border-white/8 bg-white/[0.03] px-4 py-4 text-sm leading-6 text-white/62">
                      {room.whyLine || profile?.whyLine || "This room exists to coordinate calls, share alpha, and organize live raids around token momentum."}
                    </div>
                    <div className="rounded-[22px] border border-white/8 bg-white/[0.03] px-4 py-4 text-sm leading-6 text-white/62">
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
                </V2Surface>
              ) : null}

              {activeTab === "members" ? (
                <V2Surface className="p-5 sm:p-6">
                  <V2SectionHeader
                    eyebrow="Members"
                    title="Recent visible members"
                    description="Newest visible members in the current room snapshot."
                  />
                  <div className="mt-5 grid gap-3 sm:grid-cols-2">
                    {room.recentMembers.slice(0, 12).map((member) => (
                      <div key={`${member.user.id}:${member.joinedAt}`} className="flex items-center gap-3 rounded-[20px] border border-white/8 bg-white/[0.03] px-4 py-4">
                        <Avatar className="h-11 w-11 border border-white/8">
                          <AvatarImage src={getAuthorImage(member.user.image)} />
                          <AvatarFallback className="bg-white/[0.04] text-white">
                            {(member.user.username || member.user.name || "M").charAt(0)}
                          </AvatarFallback>
                        </Avatar>
                        <div className="min-w-0">
                          <div className="truncate text-sm font-semibold text-white">{member.user.username || member.user.name}</div>
                          <div className="text-xs text-white/42">Joined {new Date(member.joinedAt).toLocaleDateString()}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </V2Surface>
              ) : null}

              {activeTab === "raids" ? (
                <V2Surface className="p-5 sm:p-6">
                  <V2SectionHeader
                    eyebrow="Raids"
                    title="Campaign pulse"
                    description="This room’s current raid state and recent visible outcomes."
                  />
                  <div className="mt-5 grid gap-3 md:grid-cols-3">
                    <V2MetricCard label="Active Raid" value={activeRaid ? "Live" : "None"} hint="Current room campaign" />
                    <V2MetricCard label="Participants" value={formatCompact(activeRaid?.participantCount ?? room.currentRaidPulse?.participantCount ?? 0)} hint="Joined the campaign" />
                    <V2MetricCard label="Posted" value={formatCompact(activeRaid?.postedCount ?? room.currentRaidPulse?.postedCount ?? 0)} hint="Launches completed" />
                  </div>
                  <div className="mt-5 space-y-3">
                    {room.recentWins.length ? room.recentWins.map((win) => (
                      <div key={win.id} className="flex items-center justify-between gap-4 rounded-[20px] border border-white/8 bg-white/[0.03] px-4 py-4">
                        <div className="min-w-0">
                          <div className="truncate text-sm font-semibold text-white">{win.user.username || win.user.name}</div>
                          <div className="text-xs text-white/42">{win.postedAt ? new Date(win.postedAt).toLocaleDateString() : "Recent room win"}</div>
                        </div>
                        <div className="text-sm font-semibold text-lime-300">{win.boostCount} boosts</div>
                      </div>
                    )) : (
                      <div className="rounded-[20px] border border-dashed border-white/10 px-4 py-8 text-center text-sm text-white/46">
                        No recent raid wins indexed yet.
                      </div>
                    )}
                  </div>
                </V2Surface>
              ) : null}
            </div>

            <div className="space-y-4">
              <V2Surface className="p-5" tone="soft">
                <V2SectionHeader
                  eyebrow="Top Contributors"
                  title="Room leaders"
                  description="Current top contributors in the room."
                />
                <div className="mt-4 space-y-3">
                  {room.topContributors.slice(0, 5).map((contributor, index) => (
                    <div key={contributor.user.id} className="flex items-center justify-between gap-4 rounded-[18px] border border-white/8 bg-white/[0.03] px-3 py-3">
                      <div className="flex min-w-0 items-center gap-3">
                        <div className="flex h-8 w-8 items-center justify-center rounded-full border border-white/8 bg-white/[0.04] text-sm font-semibold text-lime-200">
                          {index + 1}
                        </div>
                        <div className="min-w-0">
                          <div className="truncate text-sm font-semibold text-white">
                            {contributor.user.username || contributor.user.name}
                          </div>
                          <div className="text-xs text-white/42">{contributor.badge} • {contributor.currentRaidStreak} streak</div>
                        </div>
                      </div>
                      <div className="text-sm font-semibold text-lime-300">{formatCompact(contributor.contributionScore)}</div>
                    </div>
                  ))}
                </div>
              </V2Surface>

              <V2Surface className="p-5" tone="soft">
                <V2SectionHeader
                  eyebrow="Community Stats"
                  title="Room scale"
                  description="Members, active threads, and live presence."
                />
                <div className="mt-4 grid gap-3">
                  <div className="grid grid-cols-3 gap-3">
                    <div className="rounded-[18px] border border-white/8 bg-white/[0.03] px-3 py-3">
                      <div className="text-[10px] uppercase tracking-[0.16em] text-white/38">Members</div>
                      <div className="mt-2 text-lg font-semibold text-white">{formatCompact(room.memberCount)}</div>
                    </div>
                    <div className="rounded-[18px] border border-white/8 bg-white/[0.03] px-3 py-3">
                      <div className="text-[10px] uppercase tracking-[0.16em] text-white/38">Posts</div>
                      <div className="mt-2 text-lg font-semibold text-white">{formatCompact(room.activeThreadCount)}</div>
                    </div>
                    <div className="rounded-[18px] border border-white/8 bg-white/[0.03] px-3 py-3">
                      <div className="text-[10px] uppercase tracking-[0.16em] text-white/38">Calls</div>
                      <div className="mt-2 text-lg font-semibold text-white">{formatCompact(room.recentWins.length)}</div>
                    </div>
                  </div>
                </div>
              </V2Surface>
            </div>

            <div className="space-y-4">
              <V2Surface className="p-5" tone="soft">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-white/38">Live Raid</div>
                  <V2StatusPill tone={activeRaid ? "live" : "default"}>{activeRaid ? "Live" : "Idle"}</V2StatusPill>
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
                    <div className="grid gap-3">
                      <div className="rounded-[18px] border border-white/8 bg-white/[0.03] px-4 py-3 text-sm text-white/66">
                        Participants <span className="float-right font-semibold text-white">{formatCompact(activeRaid.participantCount)}</span>
                      </div>
                      <div className="rounded-[18px] border border-white/8 bg-white/[0.03] px-4 py-3 text-sm text-white/66">
                        Posted <span className="float-right font-semibold text-white">{formatCompact(activeRaid.postedCount)}</span>
                      </div>
                    </div>
                    <Link to={`/raids/${tokenAddress}/${activeRaid.id}`} className="inline-flex h-11 w-full items-center justify-center rounded-[16px] border border-lime-300/20 bg-[linear-gradient(90deg,rgba(169,255,52,0.92),rgba(45,212,191,0.9))] px-4 text-sm font-semibold text-slate-950">
                      Join Raid
                    </Link>
                  </div>
                ) : (
                  <div className="mt-4 rounded-[20px] border border-dashed border-white/10 px-4 py-8 text-center text-sm text-white/46">
                    No active raid is running right now.
                  </div>
                )}
              </V2Surface>

              <V2Surface className="p-5" tone="soft">
                <V2SectionHeader
                  eyebrow="Recent Wins"
                  title="Room momentum"
                  description="Visible recent outcomes from the current room payload."
                />
                <div className="mt-4 space-y-3">
                  {room.recentWins.slice(0, 4).map((win) => (
                    <div key={win.id} className="flex items-center justify-between gap-3 rounded-[18px] border border-white/8 bg-white/[0.03] px-3 py-3">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-semibold text-white">{win.user.username || win.user.name}</div>
                        <div className="text-xs text-white/42">
                          {win.postedAt ? new Date(win.postedAt).toLocaleDateString() : "Recent room win"}
                        </div>
                      </div>
                      <div className="text-sm font-semibold text-lime-300">{win.boostCount}</div>
                    </div>
                  ))}
                  {!room.recentWins.length ? (
                    <div className="rounded-[18px] border border-dashed border-white/10 px-4 py-8 text-center text-sm text-white/46">
                      No recent wins visible yet.
                    </div>
                  ) : null}
                </div>
              </V2Surface>

              <V2Surface className="p-5" tone="soft">
                <V2SectionHeader
                  eyebrow="Community Value"
                  title="Why this room matters"
                  description="The product pillars this room activates."
                />
                <div className="mt-4 grid gap-3">
                  {[
                    { icon: ShieldCheck, label: "AI detection", text: "Rooms amplify high-conviction setups." },
                    { icon: Activity, label: "Live calls", text: "Threads and replies keep the signal flowing." },
                    { icon: Users, label: "Members", text: "Contributor streaks and reputation compound over time." },
                  ].map((item) => {
                    const Icon = item.icon;
                    return (
                      <div key={item.label} className="flex gap-3 rounded-[18px] border border-white/8 bg-white/[0.03] px-4 py-4">
                        <div className="flex h-10 w-10 items-center justify-center rounded-full border border-lime-300/20 bg-lime-300/10">
                          <Icon className="h-4 w-4 text-lime-200" />
                        </div>
                        <div>
                          <div className="text-sm font-semibold text-white">{item.label}</div>
                          <div className="mt-1 text-xs leading-5 text-white/48">{item.text}</div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </V2Surface>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function getAuthorImage(image: string | null | undefined) {
  return image ?? undefined;
}
