import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Activity, Megaphone, Trophy, Users } from "lucide-react";
import { api } from "@/lib/api";
import { V2PageHeader } from "@/components/layout/V2PageHeader";
import { V2EmptyState } from "@/components/ui/v2/V2EmptyState";
import { V2MetricCard } from "@/components/ui/v2/V2MetricCard";
import { V2SectionHeader } from "@/components/ui/v2/V2SectionHeader";
import { V2StatusPill } from "@/components/ui/v2/V2StatusPill";
import { V2Surface } from "@/components/ui/v2/V2Surface";
import { V2TabBar } from "@/components/ui/v2/V2TabBar";
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

  return (
    <div className="space-y-5">
      <V2PageHeader
        title={campaign?.objective || "X Raid"}
        description="Dedicated raid surface using the current active raid payload. This keeps the existing raid workflow intact while exposing a cleaner entrypoint from the V2 shell."
        badge={<V2StatusPill tone={campaign ? "live" : "default"}>{campaign ? campaign.status : "Unavailable"}</V2StatusPill>}
        onBack={() => navigate(-1)}
        action={
          <Link
            to={`/communities/${tokenAddress}`}
            className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-2 text-sm font-medium text-white/74 hover:bg-white/[0.08] hover:text-white"
          >
            Open community
          </Link>
        }
      />

      {raidQuery.isLoading ? (
        <V2Surface className="p-8">
          <div className="text-sm text-white/56">Loading raid context...</div>
        </V2Surface>
      ) : !campaign || !matchesRoute ? (
        <V2EmptyState
          icon={<Megaphone className="h-7 w-7" />}
          title="Raid not available"
          description="This dedicated raid route currently resolves the active community raid. If the campaign has closed or the route id is stale, open the community page to launch the current raid."
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
          <V2Surface tone="accent" className="p-5 sm:p-6 lg:p-7">
            <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
              <div className="max-w-3xl">
                <div className="flex flex-wrap items-center gap-2">
                  <V2StatusPill tone="live">Raid Live</V2StatusPill>
                  <V2StatusPill tone="xp">{campaign.status}</V2StatusPill>
                </div>
                <h2 className="mt-4 text-4xl font-semibold tracking-tight text-white sm:text-5xl">
                  {campaign.objective}
                </h2>
                <p className="mt-3 max-w-2xl text-sm leading-6 text-white/60">
                  The raid page centralizes objective, participation, and submission pressure while preserving the current join/post workflow from the community stack.
                </p>
              </div>

              <div className="grid w-full gap-3 sm:grid-cols-2 lg:w-[360px]">
                <V2Surface tone="soft" className="p-4">
                  <div className="text-[11px] uppercase tracking-[0.18em] text-white/38">Participants</div>
                  <div className="mt-3 text-3xl font-semibold text-white">{formatCompact(campaign.participantCount)}</div>
                  <div className="mt-2 text-sm text-white/50">Joined the campaign</div>
                </V2Surface>
                <V2Surface tone="soft" className="p-4">
                  <div className="text-[11px] uppercase tracking-[0.18em] text-white/38">Posted</div>
                  <div className="mt-3 text-3xl font-semibold text-white">{formatCompact(campaign.postedCount)}</div>
                  <div className="mt-2 text-sm text-white/50">Launches completed</div>
                </V2Surface>
              </div>
            </div>

            <div className="mt-6 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <V2MetricCard label="Participants" value={formatCompact(campaign.participantCount)} hint="Joined this raid" accent={<Users className="h-5 w-5 text-lime-300" />} />
              <V2MetricCard label="Posted" value={formatCompact(campaign.postedCount)} hint="Launches completed" accent={<Activity className="h-5 w-5 text-cyan-300" />} />
              <V2MetricCard label="Meme Options" value={formatCompact(campaign.memeOptions.length)} hint="Prepared creative tracks" />
              <V2MetricCard label="Copy Options" value={formatCompact(campaign.copyOptions.length)} hint="Approved message variants" />
            </div>
          </V2Surface>

          <V2TabBar
            value={raidTab}
            onChange={setRaidTab}
            items={[
              { value: "info", label: "Info", badge: "objective + setup" },
              { value: "participants", label: "Participants", badge: formatCompact(campaign.participantCount) },
              { value: "leaderboard", label: "Leaderboard", badge: formatCompact(topParticipants.length) },
              { value: "updates", label: "Updates", badge: formatCompact(submissions.length) },
            ]}
          />

          {raidTab === "info" ? (
            <div className="grid gap-4 xl:grid-cols-[minmax(0,1.15fr)_360px]">
              <V2Surface className="p-5 sm:p-6">
                <V2SectionHeader
                  eyebrow="Raid Info"
                  title="Campaign brief"
                  description="Everything the current active raid payload exposes about the live campaign."
                />
                <div className="mt-4 space-y-3 text-sm text-white/64">
                  <div className="rounded-[20px] border border-white/8 bg-white/[0.03] px-4 py-3">
                    <div className="font-semibold text-white">Objective</div>
                    <div className="mt-1">{campaign.objective}</div>
                  </div>
                  <div className="grid gap-3 md:grid-cols-2">
                    <div className="rounded-[20px] border border-white/8 bg-white/[0.03] px-4 py-3">
                      <div className="font-semibold text-white">Opened</div>
                      <div className="mt-1">{new Date(campaign.openedAt).toLocaleString()}</div>
                    </div>
                    <div className="rounded-[20px] border border-white/8 bg-white/[0.03] px-4 py-3">
                      <div className="font-semibold text-white">Created By</div>
                      <div className="mt-1">{campaign.createdBy.username || campaign.createdBy.name}</div>
                    </div>
                  </div>
                </div>
              </V2Surface>

              <V2Surface className="p-5" tone="soft">
                <V2SectionHeader
                  eyebrow="Creative Stack"
                  title="Prepared options"
                  description="Meme and copy choices already generated for this raid."
                />
                <div className="mt-4 space-y-3">
                  {campaign.copyOptions.slice(0, 4).map((option) => (
                    <div key={option.id} className="rounded-[20px] border border-white/8 bg-white/[0.03] px-4 py-3">
                      <div className="text-sm font-semibold text-white">{option.label}</div>
                      <div className="mt-1 text-xs text-white/42">{option.style} • {option.voiceLabel}</div>
                    </div>
                  ))}
                </div>
              </V2Surface>
            </div>
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
                  <div key={submission.id} className="flex items-center justify-between gap-4 rounded-[22px] border border-white/8 bg-white/[0.03] px-4 py-4">
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-white">
                        {submission.user.username || submission.user.name}
                      </div>
                      <div className="mt-1 truncate text-xs text-white/42">
                        {submission.postedAt ? "Posted live" : "Prepared draft"} • {submission.composerText}
                      </div>
                    </div>
                    <div className="text-sm font-semibold text-lime-300">{submission.boostCount} boosts</div>
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
            <V2Surface className="p-5">
              <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.22em] text-white/42">
                <Trophy className="h-4 w-4" />
                Leaderboard
              </div>
              <div className="mt-4 space-y-3">
                {topParticipants.length > 0 ? (
                  topParticipants.map((submission, index) => (
                    <div
                      key={submission.id}
                      className="flex items-center justify-between gap-4 rounded-[18px] border border-white/8 bg-white/[0.03] px-3 py-3"
                    >
                      <div>
                        <div className="text-sm font-semibold text-white">
                          {index + 1}. {submission.user.username || submission.user.name}
                        </div>
                        <div className="text-xs text-white/42">{submission.postedAt ? "Posted" : "Drafted"} submission</div>
                      </div>
                      <div className="text-sm font-semibold text-lime-300">
                        {submission.boostCount} boosts
                      </div>
                    </div>
                  ))
                ) : (
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
                title="Latest campaign movement"
                description="A lightweight update stream derived from the existing submission payload."
              />
              <div className="mt-5 space-y-3">
                {submissions.length ? submissions.slice(0, 8).map((submission) => (
                  <div key={`update-${submission.id}`} className="rounded-[22px] border border-white/8 bg-white/[0.03] px-4 py-4">
                    <div className="flex items-center justify-between gap-4">
                      <div className="text-sm font-semibold text-white">
                        {submission.user.username || submission.user.name}
                      </div>
                      <div className="text-xs text-white/42">
                        {new Date(submission.updatedAt).toLocaleString()}
                      </div>
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
        </>
      )}
    </div>
  );
}
