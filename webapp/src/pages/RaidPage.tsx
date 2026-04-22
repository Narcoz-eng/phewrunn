import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Activity, BrainCircuit, Gift, Megaphone, RadioTower, Trophy, Users } from "lucide-react";
import { api } from "@/lib/api";
import { V2PageHeader } from "@/components/layout/V2PageHeader";
import { V2EmptyState } from "@/components/ui/v2/V2EmptyState";
import { V2SectionHeader } from "@/components/ui/v2/V2SectionHeader";
import { V2StatusPill } from "@/components/ui/v2/V2StatusPill";
import { V2Surface } from "@/components/ui/v2/V2Surface";
import { cn } from "@/lib/utils";
import type { TokenActiveRaidResponse } from "@/types";

type RaidTab = "info" | "participants" | "leaderboard" | "updates";

function formatCompact(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "--";
  return new Intl.NumberFormat("en-US", {
    notation: value >= 1000 ? "compact" : "standard",
    maximumFractionDigits: 1,
  }).format(value);
}

export default function RaidPage() {
  const navigate = useNavigate();
  const { tokenAddress = "", raidId = "" } = useParams<{ tokenAddress: string; raidId: string }>();
  const [raidTab, setRaidTab] = useState<RaidTab>("info");

  const raidQuery = useQuery<TokenActiveRaidResponse>({
    queryKey: ["raid-page", tokenAddress],
    enabled: tokenAddress.length > 0,
    queryFn: async () => api.get<TokenActiveRaidResponse>(`/api/tokens/${tokenAddress}/community/raids/active`),
    refetchOnWindowFocus: false,
    staleTime: 15_000,
  });

  const campaign = raidQuery.data?.campaign ?? null;
  const submissions = raidQuery.data?.submissions ?? [];
  const matchesRoute = campaign?.id === raidId;

  const topParticipants = useMemo(
    () => [...submissions].sort((a, b) => b.boostCount - a.boostCount).slice(0, 8),
    [submissions]
  );

  const progressPct = useMemo(() => {
    if (!campaign) return 0;
    const participantTarget = Math.max(campaign.participantCount + 200, 1000);
    return Math.min(100, Math.round((campaign.participantCount / participantTarget) * 100));
  }, [campaign]);

  return (
    <div className="space-y-5">
      <V2PageHeader
        title={campaign?.objective || "X Raid"}
        description="Dedicated X raid surface using the current active raid payload. The workflow is unchanged; the visible campaign framing is rebuilt to match the product concept."
        badge={<V2StatusPill tone={campaign ? "live" : "default"}>{campaign ? "Live" : "Unavailable"}</V2StatusPill>}
        onBack={() => navigate(-1)}
      />

      {raidQuery.isLoading ? (
        <V2Surface className="p-8">
          <div className="text-sm text-white/56">Loading raid context...</div>
        </V2Surface>
      ) : !campaign || !matchesRoute ? (
        <V2EmptyState
          icon={<Megaphone className="h-7 w-7" />}
          title="Raid not available"
          description="This route currently resolves the active community raid. If the campaign has closed or the route id is stale, open the community page to launch the current raid."
          action={
            <Link
              to={`/communities/${tokenAddress}`}
              className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-2 text-sm font-medium text-white/74 hover:bg-white/[0.08] hover:text-white"
            >
              Open community
            </Link>
          }
        />
      ) : (
        <>
          <V2Surface tone="accent" className="overflow-hidden p-0">
            <div className="p-5 sm:p-6 lg:p-7">
              <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
                <div className="max-w-3xl">
                  <div className="flex flex-wrap items-center gap-2">
                    <V2StatusPill tone="live">Live</V2StatusPill>
                    <V2StatusPill tone="xp">{campaign.status}</V2StatusPill>
                  </div>
                  <div className="mt-4 flex items-center gap-4">
                    <div className="flex h-20 w-20 items-center justify-center rounded-full border border-lime-300/20 bg-[linear-gradient(180deg,rgba(169,255,52,0.16),rgba(45,212,191,0.1))]">
                      <Megaphone className="h-9 w-9 text-lime-200" />
                    </div>
                    <div>
                      <h2 className="text-4xl font-semibold tracking-tight text-white sm:text-5xl">{campaign.objective}</h2>
                      <div className="mt-2 text-sm text-white/56">Target: coordinated push for {tokenAddress.slice(0, 6)}...{tokenAddress.slice(-4)}</div>
                    </div>
                  </div>
                </div>

                <div className="grid w-full gap-3 sm:grid-cols-3 lg:w-[420px]">
                  <div className="rounded-[20px] border border-white/8 bg-white/[0.04] px-4 py-4">
                    <div className="text-[10px] uppercase tracking-[0.16em] text-white/38">Participants</div>
                    <div className="mt-3 text-2xl font-semibold text-white">{formatCompact(campaign.participantCount)}</div>
                  </div>
                  <div className="rounded-[20px] border border-white/8 bg-white/[0.04] px-4 py-4">
                    <div className="text-[10px] uppercase tracking-[0.16em] text-white/38">Posted</div>
                    <div className="mt-3 text-2xl font-semibold text-white">{formatCompact(campaign.postedCount)}</div>
                  </div>
                  <div className="rounded-[20px] border border-white/8 bg-white/[0.04] px-4 py-4">
                    <div className="text-[10px] uppercase tracking-[0.16em] text-white/38">Pool</div>
                    <div className="mt-3 text-2xl font-semibold text-white">{formatCompact(campaign.participantCount * 20)}</div>
                  </div>
                </div>
              </div>

              <div className="mt-6">
                <Link
                  to={`/communities/${tokenAddress}`}
                  className="inline-flex h-12 w-full items-center justify-center rounded-[18px] border border-lime-300/20 bg-[linear-gradient(90deg,rgba(169,255,52,0.96),rgba(45,212,191,0.9))] px-5 text-sm font-semibold text-slate-950"
                >
                  Join Raid
                </Link>
              </div>

              <div className="mt-6 border-t border-white/8 pt-5">
                <div className="flex flex-wrap gap-6">
                  {[
                    { value: "info", label: "Raid Info" },
                    { value: "participants", label: "Participants" },
                    { value: "leaderboard", label: "Leaderboard" },
                    { value: "updates", label: "Updates" },
                  ].map((tab) => (
                    <button
                      key={tab.value}
                      type="button"
                      onClick={() => setRaidTab(tab.value as RaidTab)}
                      className={cn(
                        "relative pb-2 text-sm font-medium transition",
                        raidTab === tab.value ? "text-lime-200" : "text-white/44 hover:text-white/72"
                      )}
                    >
                      {tab.label}
                      {raidTab === tab.value ? <span className="absolute inset-x-0 bottom-0 h-0.5 rounded-full bg-lime-300" /> : null}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </V2Surface>

          <div className="grid gap-4 xl:grid-cols-[minmax(0,1.15fr)_360px]">
            <div className="space-y-4">
              {raidTab === "info" ? (
                <V2Surface className="p-5 sm:p-6">
                  <V2SectionHeader
                    eyebrow="Raid Info"
                    title="Campaign setup"
                    description="The active campaign payload presented as a stronger raid briefing surface."
                  />
                  <div className="mt-5 grid gap-3 md:grid-cols-2">
                    <InfoCard label="Direction" value="LONG" />
                    <InfoCard label="Targets" value={`${campaign.copyOptions.length} copy / ${campaign.memeOptions.length} meme tracks`} />
                    <InfoCard label="Created By" value={campaign.createdBy.username || campaign.createdBy.name} />
                    <InfoCard label="Started" value={new Date(campaign.openedAt).toLocaleString()} />
                  </div>

                  <div className="mt-5 rounded-[24px] border border-white/8 bg-white/[0.03] px-4 py-4">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <div className="text-[11px] uppercase tracking-[0.18em] text-white/38">Raid Progress</div>
                        <div className="mt-2 text-sm text-white/56">Next milestone: stronger room saturation and more launched posts</div>
                      </div>
                      <div className="text-lg font-semibold text-white">{progressPct}%</div>
                    </div>
                    <div className="mt-4 h-3 overflow-hidden rounded-full bg-white/8">
                      <div
                        className="h-full rounded-full bg-[linear-gradient(90deg,rgba(169,255,52,0.96),rgba(45,212,191,0.9))]"
                        style={{ width: `${progressPct}%` }}
                      />
                    </div>
                    <div className="mt-3 flex items-center justify-between text-sm text-white/48">
                      <span>{formatCompact(campaign.participantCount)} joined</span>
                      <span>{formatCompact(campaign.postedCount)} posted</span>
                    </div>
                  </div>
                </V2Surface>
              ) : null}

              {raidTab === "participants" ? (
                <V2Surface className="p-5 sm:p-6">
                  <V2SectionHeader
                    eyebrow="Participants"
                    title="Submission stream"
                    description="Current visible submissions from the active raid payload."
                  />
                  <div className="mt-5 space-y-3">
                    {submissions.length ? submissions.map((submission) => (
                      <div key={submission.id} className="rounded-[22px] border border-white/8 bg-white/[0.03] px-4 py-4">
                        <div className="flex items-center justify-between gap-4">
                          <div className="min-w-0">
                            <div className="text-sm font-semibold text-white">{submission.user.username || submission.user.name}</div>
                            <div className="mt-1 truncate text-xs text-white/42">
                              {submission.postedAt ? "Posted live" : "Prepared draft"} • {submission.composerText}
                            </div>
                          </div>
                          <div className="text-sm font-semibold text-lime-300">{submission.boostCount} boosts</div>
                        </div>
                      </div>
                    )) : (
                      <div className="rounded-[20px] border border-dashed border-white/10 px-4 py-8 text-center text-sm text-white/46">
                        No submissions visible yet.
                      </div>
                    )}
                  </div>
                </V2Surface>
              ) : null}

              {raidTab === "leaderboard" ? (
                <V2Surface className="p-5 sm:p-6">
                  <V2SectionHeader
                    eyebrow="Leaderboard"
                    title="Top boosters"
                    description="Current ranking derived from visible raid submissions."
                  />
                  <div className="mt-5 space-y-3">
                    {topParticipants.length ? topParticipants.map((submission, index) => (
                      <div key={submission.id} className="flex items-center justify-between gap-4 rounded-[20px] border border-white/8 bg-white/[0.03] px-4 py-4">
                        <div>
                          <div className="text-sm font-semibold text-white">{index + 1}. {submission.user.username || submission.user.name}</div>
                          <div className="text-xs text-white/42">{submission.postedAt ? "Posted" : "Drafted"} submission</div>
                        </div>
                        <div className="text-sm font-semibold text-lime-300">{submission.boostCount} boosts</div>
                      </div>
                    )) : (
                      <div className="rounded-[20px] border border-dashed border-white/10 px-4 py-8 text-center text-sm text-white/46">
                        No submissions ranked yet.
                      </div>
                    )}
                  </div>
                </V2Surface>
              ) : null}

              {raidTab === "updates" ? (
                <V2Surface className="p-5 sm:p-6">
                  <V2SectionHeader
                    eyebrow="Updates"
                    title="Campaign movement"
                    description="A live-looking update rail derived from the active raid payload."
                  />
                  <div className="mt-5 space-y-3">
                    {submissions.length ? submissions.slice(0, 8).map((submission) => (
                      <div key={submission.id} className="rounded-[22px] border border-white/8 bg-white/[0.03] px-4 py-4">
                        <div className="flex items-center justify-between gap-4">
                          <div className="text-sm font-semibold text-white">{submission.user.username || submission.user.name}</div>
                          <div className="text-xs text-white/42">{new Date(submission.updatedAt).toLocaleString()}</div>
                        </div>
                        <div className="mt-2 text-sm text-white/58">
                          {submission.postedAt ? "Posted to X and collecting boosts." : "Prepared a submission and is waiting to launch."}
                        </div>
                      </div>
                    )) : (
                      <div className="rounded-[20px] border border-dashed border-white/10 px-4 py-8 text-center text-sm text-white/46">
                        No update stream yet.
                      </div>
                    )}
                  </div>
                </V2Surface>
              ) : null}
            </div>

            <div className="space-y-4">
              <V2Surface className="p-5" tone="soft">
                <V2SectionHeader
                  eyebrow="Creative Stack"
                  title="Prepared options"
                  description="Available copy and meme tracks for this campaign."
                />
                <div className="mt-4 space-y-3">
                  {campaign.copyOptions.slice(0, 3).map((option) => (
                    <div key={option.id} className="rounded-[20px] border border-white/8 bg-white/[0.03] px-4 py-4">
                      <div className="text-sm font-semibold text-white">{option.label}</div>
                      <div className="mt-1 text-xs text-white/42">{option.style} • {option.voiceLabel}</div>
                    </div>
                  ))}
                </div>
              </V2Surface>

              <V2Surface className="p-5" tone="soft">
                <V2SectionHeader
                  eyebrow="Rewards"
                  title="Why join this raid"
                  description="The value framing from the product concept."
                />
                <div className="mt-4 grid gap-3">
                  {[
                    { icon: RadioTower, label: "Auto Tracking", text: "Active calls and raid movement stay visible in real time." },
                    { icon: BrainCircuit, label: "AI Intelligence", text: "Campaigns compound with intelligence and trend detection." },
                    { icon: Trophy, label: "Levels & XP", text: "Strong coordination grows reputation and level progression." },
                    { icon: Gift, label: "Rewards", text: "Top performers and contributors can capture more upside." },
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

function InfoCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[20px] border border-white/8 bg-white/[0.03] px-4 py-4">
      <div className="text-[11px] uppercase tracking-[0.18em] text-white/38">{label}</div>
      <div className="mt-3 text-lg font-semibold text-white">{value}</div>
    </div>
  );
}
