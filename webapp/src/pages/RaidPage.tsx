import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "react-router-dom";
import { BrainCircuit, Gift, Megaphone, RadioTower, Trophy } from "lucide-react";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { TokenRaidDetailResponse } from "@/types";

type RaidTab = "info" | "participants" | "leaderboard" | "updates";

function formatCompact(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "--";
  return new Intl.NumberFormat("en-US", {
    notation: value >= 1_000 ? "compact" : "standard",
    maximumFractionDigits: 1,
  }).format(value);
}

export default function RaidPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { tokenAddress = "", raidId = "" } = useParams<{ tokenAddress: string; raidId: string }>();
  const { canPerformAuthenticatedWrites } = useAuth();
  const [tab, setTab] = useState<RaidTab>("info");
  const [xPostUrl, setXPostUrl] = useState("");

  const raidQuery = useQuery<TokenRaidDetailResponse>({
    queryKey: ["raid-detail", tokenAddress, raidId],
    enabled: tokenAddress.length > 0 && raidId.length > 0,
    staleTime: 15_000,
    refetchOnWindowFocus: false,
    queryFn: async () => api.get<TokenRaidDetailResponse>(`/api/tokens/${tokenAddress}/community/raids/${raidId}`),
  });

  const raid = raidQuery.data?.campaign ?? null;
  const submissions = raidQuery.data?.submissions ?? [];
  const participants = raidQuery.data?.participants ?? [];
  const leaderboard = raidQuery.data?.leaderboard ?? [];
  const updates = raidQuery.data?.updates ?? [];
  const myParticipant = raidQuery.data?.myParticipant ?? null;
  const mySubmission = raidQuery.data?.mySubmission ?? null;
  const milestones = raidQuery.data?.milestones ?? [];
  const firstCopy = raid?.copyOptions?.[0] ?? null;
  const firstMeme = raid?.memeOptions?.[0] ?? null;

  const participantTarget = Math.max((raid?.participantCount ?? 0) + 200, 1000);
  const progressPct = useMemo(() => {
    if (!raid) return 0;
    return Math.min(100, Math.round((raid.participantCount / participantTarget) * 100));
  }, [participantTarget, raid]);

  const invalidateRaid = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["raid-detail", tokenAddress, raidId] }),
      queryClient.invalidateQueries({ queryKey: ["community-raids", tokenAddress] }),
      queryClient.invalidateQueries({ queryKey: ["community-summary", tokenAddress] }),
      queryClient.invalidateQueries({ queryKey: ["token-community-room", tokenAddress] }),
    ]);
  };

  const joinMutation = useMutation({
    mutationFn: async () => api.post(`/api/tokens/${tokenAddress}/community/raids/${raidId}/join`),
    onSuccess: invalidateRaid,
  });

  const regenerateMutation = useMutation({
    mutationFn: async () => api.post(`/api/tokens/${tokenAddress}/community/raids/${raidId}/regenerate`),
    onSuccess: invalidateRaid,
  });

  const launchMutation = useMutation({
    mutationFn: async () => {
      if (!firstCopy || !firstMeme) throw new Error("No raid creative available");
      return api.post(`/api/tokens/${tokenAddress}/community/raids/${raidId}/launch`, {
        memeOptionId: firstMeme.id,
        copyOptionId: firstCopy.id,
        renderPayloadJson: {
          templateId: firstMeme.templateId,
          title: firstMeme.title,
          toneLabel: firstMeme.toneLabel,
          socialTag: firstCopy.socialTag,
          assetIdsUsed: firstMeme.assetIdsUsed,
        },
        composerText: firstCopy.text,
      });
    },
    onSuccess: invalidateRaid,
  });

  const submitMutation = useMutation({
    mutationFn: async () => api.patch(`/api/tokens/${tokenAddress}/community/raids/${raidId}/submission`, { xPostUrl: xPostUrl.trim() }),
    onSuccess: async () => {
      setXPostUrl("");
      await invalidateRaid();
    },
  });

  const boostMutation = useMutation({
    mutationFn: async (submissionId: string) => api.post(`/api/tokens/${tokenAddress}/community/raids/${raidId}/submissions/${submissionId}/boosts`),
    onSuccess: invalidateRaid,
  });

  if (raidQuery.isLoading) {
    return <div className="rounded-[30px] border border-white/8 bg-white/[0.03] px-6 py-10 text-sm text-white/56">Loading raid surface...</div>;
  }

  if (!raid) {
    return (
      <section className="rounded-[30px] border border-dashed border-white/12 px-6 py-16 text-center">
        <div className="mx-auto max-w-lg">
          <h1 className="text-2xl font-semibold text-white">Raid not available</h1>
          <p className="mt-3 text-sm leading-6 text-white/52">
            This route does not currently resolve to a raid. Open the token community to inspect active campaigns.
          </p>
          <div className="mt-6">
            <Link to={`/communities/${tokenAddress}`} className="inline-flex h-11 items-center rounded-[16px] border border-white/10 bg-white/[0.04] px-5 text-sm text-white/78 transition hover:bg-white/[0.08] hover:text-white">
              Open community
            </Link>
          </div>
        </div>
      </section>
    );
  }

  return (
    <div className="space-y-5">
      <section className="rounded-[32px] border border-white/8 bg-[linear-gradient(180deg,rgba(8,12,16,0.98),rgba(4,7,10,0.98))] p-5 sm:p-6 lg:p-7">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
          <div className="max-w-3xl">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full border border-lime-300/18 bg-lime-300/8 px-3 py-1 text-[11px] uppercase tracking-[0.14em] text-lime-200">
                {raid.status}
              </span>
              <span className="rounded-full border border-white/10 bg-white/[0.03] px-3 py-1 text-[11px] uppercase tracking-[0.14em] text-white/60">
                {raid.closedAt ? "Historical" : "Live"}
              </span>
            </div>
            <div className="mt-4 flex items-center gap-4">
              <div className="flex h-20 w-20 items-center justify-center rounded-full border border-lime-300/20 bg-[linear-gradient(180deg,rgba(169,255,52,0.16),rgba(45,212,191,0.1))]">
                <Megaphone className="h-9 w-9 text-lime-200" />
              </div>
              <div>
                <h1 className="text-4xl font-semibold tracking-[-0.05em] text-white sm:text-5xl">{raid.objective}</h1>
                <div className="mt-2 text-sm text-white/56">
                  Target: coordinated push for {tokenAddress.slice(0, 6)}...{tokenAddress.slice(-4)}
                </div>
              </div>
            </div>
          </div>

          <div className="grid w-full gap-3 sm:grid-cols-3 lg:w-[440px]">
            <MetricBox label="Participants" value={formatCompact(raid.participantCount)} />
            <MetricBox label="Pool" value={formatCompact(raid.participantCount * 20)} />
            <MetricBox label="Posted" value={formatCompact(raid.postedCount)} />
          </div>
        </div>

        <div className="mt-6 flex flex-wrap gap-2">
          {!myParticipant ? (
            <Button type="button" onClick={() => joinMutation.mutate()} disabled={!canPerformAuthenticatedWrites || joinMutation.isPending} className="h-12 rounded-[18px] px-6 text-slate-950">
              Join Raid
            </Button>
          ) : null}
          {!raid.closedAt && firstCopy && firstMeme ? (
            <Button
              type="button"
              variant="outline"
              onClick={() => launchMutation.mutate()}
              disabled={!canPerformAuthenticatedWrites || launchMutation.isPending}
              className="h-12 rounded-[18px] border-white/10 bg-white/[0.04] px-6 text-white/80 hover:bg-white/[0.08] hover:text-white"
            >
              Launch Kit
            </Button>
          ) : null}
          {!raid.closedAt ? (
            <Button
              type="button"
              variant="outline"
              onClick={() => regenerateMutation.mutate()}
              disabled={!canPerformAuthenticatedWrites || regenerateMutation.isPending}
              className="h-12 rounded-[18px] border-white/10 bg-white/[0.04] px-6 text-white/80 hover:bg-white/[0.08] hover:text-white"
            >
              Regenerate
            </Button>
          ) : null}
          <Button type="button" variant="outline" onClick={() => navigate(`/communities/${tokenAddress}`)} className="h-12 rounded-[18px] border-white/10 bg-white/[0.04] px-6 text-white/80 hover:bg-white/[0.08] hover:text-white">
            Open Community
          </Button>
        </div>

        <div className="mt-6 rounded-[26px] border border-white/8 bg-white/[0.03] px-4 py-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-[11px] uppercase tracking-[0.18em] text-white/38">Raid Progress</div>
              <div className="mt-2 text-sm text-white/56">Next milestone: stronger room saturation and more launched posts</div>
            </div>
            <div className="text-lg font-semibold text-white">{progressPct}%</div>
          </div>
          <div className="mt-4 h-3 overflow-hidden rounded-full bg-white/8">
            <div className="h-full rounded-full bg-[linear-gradient(90deg,rgba(169,255,52,0.96),rgba(45,212,191,0.9))]" style={{ width: `${progressPct}%` }} />
          </div>
          <div className="mt-3 flex items-center justify-between gap-3 text-sm text-white/48">
            <span>{formatCompact(raid.participantCount)} / {formatCompact(participantTarget)} joined</span>
            <span>{formatCompact(raid.postedCount)} posted</span>
          </div>
        </div>

        {milestones.length ? (
          <div className="mt-4 grid gap-3 md:grid-cols-3">
            {milestones.map((milestone) => (
              <div key={milestone.label} className={cn(
                "rounded-[18px] border px-4 py-3",
                milestone.unlocked ? "border-lime-300/18 bg-lime-300/8" : "border-white/8 bg-white/[0.03]"
              )}>
                <div className="text-[10px] uppercase tracking-[0.16em] text-white/38">{milestone.label}</div>
                <div className="mt-2 text-lg font-semibold text-white">{formatCompact(milestone.threshold)}</div>
              </div>
            ))}
          </div>
        ) : null}

        <div className="mt-6 flex flex-wrap gap-6 border-t border-white/8 pt-4">
          {[
            { value: "info", label: "Info" },
            { value: "participants", label: "Participants" },
            { value: "leaderboard", label: "Leaderboard" },
            { value: "updates", label: "Updates" },
          ].map((item) => (
            <button
              key={item.value}
              type="button"
              onClick={() => setTab(item.value as RaidTab)}
              className={cn("relative pb-2 text-sm font-medium transition", tab === item.value ? "text-lime-200" : "text-white/44 hover:text-white/72")}
            >
              {item.label}
              {tab === item.value ? <span className="absolute inset-x-0 bottom-0 h-0.5 rounded-full bg-lime-300" /> : null}
            </button>
          ))}
        </div>
      </section>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.15fr)_360px]">
        <div className="space-y-4">
          {tab === "info" ? (
            <section className="rounded-[30px] border border-white/8 bg-[linear-gradient(180deg,rgba(7,12,15,0.98),rgba(4,7,9,0.98))] p-5 sm:p-6">
              <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-white/38">Raid Info</div>
              <h2 className="mt-2 text-2xl font-semibold tracking-[-0.04em] text-white">Campaign setup</h2>
              <div className="mt-5 grid gap-3 md:grid-cols-2">
                <InfoCard label="Direction" value="LONG" />
                <InfoCard label="Targets" value={`${raid.copyOptions.length} copy / ${raid.memeOptions.length} meme tracks`} />
                <InfoCard label="Created By" value={raid.createdBy.username || raid.createdBy.name} />
                <InfoCard label="Started" value={new Date(raid.openedAt).toLocaleString()} />
              </div>

              {!raid.closedAt ? (
                <div className="mt-6 rounded-[26px] border border-white/8 bg-white/[0.03] p-4">
                  <div className="text-sm font-semibold text-white">Link your X post</div>
                  <div className="mt-3 flex flex-col gap-3 sm:flex-row">
                    <Input
                      value={xPostUrl}
                      onChange={(event) => setXPostUrl(event.target.value)}
                      placeholder={mySubmission?.xPostUrl || "https://x.com/..."}
                      className="h-12 rounded-[16px] border-white/10 bg-black/20 text-white placeholder:text-white/30"
                    />
                    <Button
                      type="button"
                      onClick={() => submitMutation.mutate()}
                      disabled={!canPerformAuthenticatedWrites || !xPostUrl.trim() || submitMutation.isPending}
                      className="h-12 rounded-[16px] px-5 text-slate-950"
                    >
                      Save Link
                    </Button>
                  </div>
                </div>
              ) : null}
            </section>
          ) : null}

          {tab === "participants" ? (
            <section className="space-y-3">
              {participants.length ? participants.map((participant) => (
                <div key={participant.id} className="rounded-[24px] border border-white/8 bg-[linear-gradient(180deg,rgba(7,12,15,0.98),rgba(4,7,9,0.98))] px-4 py-4">
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <div className="text-sm font-semibold text-white">{participant.user?.username || participant.user?.name || "Participant"}</div>
                      <div className="mt-1 text-xs text-white/42">
                        {participant.status} • {participant.currentStep}
                      </div>
                    </div>
                    <div className="text-xs text-white/46">{new Date(participant.joinedAt).toLocaleString()}</div>
                  </div>
                </div>
              )) : (
                <EmptyCopy text="No participants visible yet." />
              )}
            </section>
          ) : null}

          {tab === "leaderboard" ? (
            <section className="space-y-3">
              {leaderboard.length ? leaderboard.map((entry, index) => (
                <div key={entry.submissionId} className="rounded-[24px] border border-white/8 bg-[linear-gradient(180deg,rgba(7,12,15,0.98),rgba(4,7,9,0.98))] px-4 py-4">
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <div className="text-sm font-semibold text-white">{index + 1}. {entry.user.username || entry.user.name}</div>
                      <div className="mt-1 text-xs text-white/42">{entry.postedAt ? "Posted live" : "Prepared"} submission</div>
                    </div>
                    <div className="text-sm font-semibold text-lime-300">{entry.boostCount} boosts</div>
                  </div>
                </div>
              )) : (
                <EmptyCopy text="No leaderboard activity yet." />
              )}
            </section>
          ) : null}

          {tab === "updates" ? (
            <section className="space-y-3">
              {updates.length ? updates.map((update) => (
                <div key={update.id} className="rounded-[24px] border border-white/8 bg-[linear-gradient(180deg,rgba(7,12,15,0.98),rgba(4,7,9,0.98))] px-4 py-4">
                  <div className="flex items-center justify-between gap-4">
                    <div className="text-sm font-semibold text-white">{update.user?.username || update.user?.name || update.kind}</div>
                    <div className="text-xs text-white/42">{new Date(update.createdAt).toLocaleString()}</div>
                  </div>
                  <div className="mt-2 text-sm text-white/58">{update.body}</div>
                  {update.kind === "submission" && canPerformAuthenticatedWrites && submissions.length ? (
                    <div className="mt-3">
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => boostMutation.mutate(submissions[0]!.id)}
                        disabled={boostMutation.isPending}
                        className="h-10 rounded-[14px] border-white/10 bg-white/[0.04] px-4 text-white/80 hover:bg-white/[0.08] hover:text-white"
                      >
                        Boost
                      </Button>
                    </div>
                  ) : null}
                </div>
              )) : (
                <EmptyCopy text="No update stream yet." />
              )}
            </section>
          ) : null}
        </div>

        <div className="space-y-4">
          <section className="rounded-[30px] border border-white/8 bg-white/[0.03] p-5">
            <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-white/38">Creative Stack</div>
            <div className="mt-4 space-y-3">
              {raid.copyOptions.slice(0, 3).map((option) => (
                <div key={option.id} className="rounded-[18px] border border-white/8 bg-black/20 px-4 py-4">
                  <div className="text-sm font-semibold text-white">{option.label}</div>
                  <div className="mt-1 text-xs text-white/42">{option.style} • {option.voiceLabel}</div>
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-[30px] border border-white/8 bg-white/[0.03] p-5">
            <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-white/38">Value Props</div>
            <div className="mt-4 grid gap-3">
              {[
                { icon: RadioTower, label: "Auto Tracking", text: "Active calls and raid movement stay visible in real time." },
                { icon: BrainCircuit, label: "AI Intelligence", text: "Campaigns compound with intelligence and trend detection." },
                { icon: Trophy, label: "Levels & XP", text: "Strong coordination grows reputation and level progression." },
                { icon: Gift, label: "Rewards", text: "Top performers and contributors can capture more upside." },
              ].map((item) => {
                const Icon = item.icon;
                return (
                  <div key={item.label} className="flex gap-3 rounded-[18px] border border-white/8 bg-black/20 px-4 py-4">
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
          </section>
        </div>
      </div>
    </div>
  );
}

function MetricBox({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[20px] border border-white/8 bg-white/[0.04] px-4 py-4">
      <div className="text-[10px] uppercase tracking-[0.16em] text-white/38">{label}</div>
      <div className="mt-3 text-2xl font-semibold text-white">{value}</div>
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

function EmptyCopy({ text }: { text: string }) {
  return (
    <div className="rounded-[24px] border border-dashed border-white/10 px-4 py-8 text-center text-sm text-white/46">
      {text}
    </div>
  );
}
