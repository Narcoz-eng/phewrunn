import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  BrainCircuit,
  ExternalLink,
  Megaphone,
  ShieldCheck,
  TimerReset,
  Trophy,
  Users,
  Zap,
} from "lucide-react";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";
import { V2RightRailCard } from "@/components/ui/v2/V2RightRailCard";
import { V2ProgressBar } from "@/components/ui/v2/V2ProgressBar";
import { V2PageTopbar } from "@/components/layout/V2PageTopbar";
import type { TokenRaidDetailResponse } from "@/types";

type RaidViewTab = "activity" | "participants" | "leaderboard";

function formatCompact(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "--";
  return new Intl.NumberFormat("en-US", {
    notation: value >= 1_000 ? "compact" : "standard",
    maximumFractionDigits: 1,
  }).format(value);
}

function formatRelativeCountdown(date: string | null | undefined) {
  if (!date) return "Live";
  const target = new Date(date).getTime();
  if (!Number.isFinite(target)) return "Live";
  const diff = Math.max(target - Date.now(), 0);
  const hours = Math.floor(diff / 3_600_000);
  const minutes = Math.floor((diff % 3_600_000) / 60_000);
  return `${hours}h ${minutes}m`;
}

export default function RaidPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { tokenAddress = "", raidId = "" } = useParams<{ tokenAddress: string; raidId: string }>();
  const { canPerformAuthenticatedWrites } = useAuth();
  const [tab, setTab] = useState<RaidViewTab>("activity");
  const [xPostUrl, setXPostUrl] = useState("");
  const [search, setSearch] = useState("");

  const raidQuery = useQuery<TokenRaidDetailResponse>({
    queryKey: ["raid-detail", tokenAddress, raidId],
    enabled: tokenAddress.length > 0 && raidId.length > 0,
    staleTime: 15_000,
    refetchOnWindowFocus: false,
    queryFn: async () => api.get<TokenRaidDetailResponse>(`/api/tokens/${tokenAddress}/community/raids/${raidId}`),
  });

  const raid = raidQuery.data?.campaign ?? null;
  const submissions = useMemo(() => raidQuery.data?.submissions ?? [], [raidQuery.data?.submissions]);
  const participants = useMemo(() => raidQuery.data?.participants ?? [], [raidQuery.data?.participants]);
  const leaderboard = useMemo(() => raidQuery.data?.leaderboard ?? [], [raidQuery.data?.leaderboard]);
  const updates = useMemo(() => raidQuery.data?.updates ?? [], [raidQuery.data?.updates]);
  const myParticipant = raidQuery.data?.myParticipant ?? null;
  const mySubmission = raidQuery.data?.mySubmission ?? null;
  const milestones = useMemo(() => raidQuery.data?.milestones ?? [], [raidQuery.data?.milestones]);
  const communityAssets = raidQuery.data?.communityAssets ?? null;
  const firstCopy = raid?.copyOptions?.[0] ?? null;
  const firstMeme = raid?.memeOptions?.[0] ?? null;

  const totalBoosts = useMemo(
    () => leaderboard.reduce((sum, entry) => sum + entry.boostCount, 0),
    [leaderboard]
  );

  const activityFeed = useMemo(() => {
    const updateRows = updates.map((update) => ({
      id: `update-${update.id}`,
      kind: update.kind === "submission" ? "Submission" : "Raid Update",
      title: update.user?.username || update.user?.name || "Room system",
      body: update.body,
      createdAt: update.createdAt,
      href: null as string | null,
    }));

    const submissionRows = submissions
      .filter((submission) => submission.xPostUrl)
      .map((submission) => ({
        id: `submission-${submission.id}`,
        kind: "Posted Link",
        title: submission.user.username || submission.user.name,
        body: submission.composerText,
        createdAt: submission.postedAt || submission.updatedAt,
        href: submission.xPostUrl,
      }));

    return [...updateRows, ...submissionRows]
      .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime())
      .slice(0, 12);
  }, [submissions, updates]);

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
    mutationFn: async () =>
      api.patch(`/api/tokens/${tokenAddress}/community/raids/${raidId}/submission`, { xPostUrl: xPostUrl.trim() }),
    onSuccess: async () => {
      setXPostUrl("");
      await invalidateRaid();
    },
  });

  const boostMutation = useMutation({
    mutationFn: async (submissionId: string) =>
      api.post(`/api/tokens/${tokenAddress}/community/raids/${raidId}/submissions/${submissionId}/boosts`),
    onSuccess: invalidateRaid,
  });

  if (raidQuery.isLoading) {
    return (
      <div className="rounded-[30px] border border-white/8 bg-white/[0.03] px-6 py-10 text-sm text-white/56">
        Loading raid mission control...
      </div>
    );
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
            <Link
              to={`/communities/${tokenAddress}`}
              className="inline-flex h-11 items-center rounded-[16px] border border-white/10 bg-white/[0.04] px-5 text-sm text-white/78 transition hover:bg-white/[0.08] hover:text-white"
            >
              Open community
            </Link>
          </div>
        </div>
      </section>
    );
  }

  return (
    <div className="space-y-5">
      <section className="rounded-[18px] border border-white/8 bg-[linear-gradient(180deg,rgba(8,12,18,0.97),rgba(3,7,10,0.99))] px-4 py-4 sm:px-5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h1 className="text-[26px] font-semibold tracking-tight text-white">RAIDS</h1>
            <p className="mt-1 text-[13px] text-white/54">Rally together. Break resistance.</p>
          </div>
          <V2PageTopbar
            value={search}
            onChange={setSearch}
            placeholder="Search tokens, users, raids..."
            className="lg:min-w-[520px]"
          />
        </div>
      </section>
      <section className="overflow-hidden rounded-[34px] border border-white/8 bg-[linear-gradient(180deg,rgba(8,12,16,0.98),rgba(4,7,10,0.98))] shadow-[0_34px_90px_-56px_rgba(0,0,0,0.92)]">
        <div className="grid gap-0 xl:grid-cols-[minmax(0,1.2fr)_360px]">
          <div className="relative overflow-hidden p-5 sm:p-6 lg:p-7">
            <div className="absolute inset-0">
              {communityAssets?.banner?.renderUrl ? (
                <div
                  className="absolute inset-0 bg-cover bg-center opacity-25"
                  style={{ backgroundImage: `url("${communityAssets.banner.renderUrl}")` }}
                />
              ) : null}
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(169,255,52,0.14),transparent_24%),radial-gradient(circle_at_center_right,rgba(45,212,191,0.12),transparent_28%),linear-gradient(180deg,rgba(5,9,11,0.56),rgba(5,9,11,0.92))]" />
            </div>
            <div className="relative">
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full border border-orange-300/18 bg-orange-300/8 px-3 py-1 text-[11px] uppercase tracking-[0.14em] text-orange-200">
                  Live Raid
                </span>
                <span className="rounded-full border border-lime-300/18 bg-lime-300/8 px-3 py-1 text-[11px] uppercase tracking-[0.14em] text-lime-200">
                  Raid #{raid.id.slice(0, 6).toUpperCase()}
                </span>
              </div>

              <div className="mt-5 grid gap-5 lg:grid-cols-[auto_minmax(0,1fr)]">
                <div className="flex h-24 w-24 items-center justify-center overflow-hidden rounded-[28px] border border-lime-300/18 bg-[linear-gradient(180deg,rgba(169,255,52,0.16),rgba(45,212,191,0.08))] shadow-[0_24px_64px_-28px_rgba(169,255,52,0.4)]">
                  {communityAssets?.mascot?.renderUrl || communityAssets?.logo?.renderUrl ? (
                    <img
                      src={communityAssets?.mascot?.renderUrl || communityAssets?.logo?.renderUrl || undefined}
                      alt={raid.objective}
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <Megaphone className="h-10 w-10 text-lime-200" />
                  )}
                </div>
                <div className="min-w-0">
                  <h1 className="text-4xl font-semibold tracking-[-0.05em] text-white sm:text-5xl">{raid.objective}</h1>
                  <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-white/54">
                    <span>Created by {raid.createdBy.username || raid.createdBy.name || "PHEW"}</span>
                    <span className="h-1 w-1 rounded-full bg-white/24" />
                    <span>{raid.closedAt ? "Historical room" : "Mission is active"}</span>
                    <span className="h-1 w-1 rounded-full bg-white/24" />
                    <span>Target token {raid.token?.symbol ? `$${raid.token.symbol}` : `${tokenAddress.slice(0, 6)}...${tokenAddress.slice(-4)}`}</span>
                  </div>
                  <p className="mt-4 max-w-3xl text-sm leading-7 text-white/60">
                    Mission control tracks actual joined raiders, posted links, boosts, and stored room updates. Token price action and trader profitability stay outside this progress model.
                  </p>
                  <div className="mt-5 flex flex-wrap gap-2">
                    {!myParticipant ? (
                      <Button
                        type="button"
                        onClick={() => joinMutation.mutate()}
                        disabled={!canPerformAuthenticatedWrites || joinMutation.isPending}
                        className="h-12 rounded-[18px] px-6 text-slate-950"
                      >
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
                        Refresh Creative
                      </Button>
                    ) : null}
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => navigate(`/communities/${tokenAddress}`)}
                      className="h-12 rounded-[18px] border-white/10 bg-white/[0.04] px-6 text-white/80 hover:bg-white/[0.08] hover:text-white"
                    >
                      Open Community
                    </Button>
                  </div>
                </div>
              </div>

              <div className="mt-6 grid gap-3 md:grid-cols-4">
                <HeroMetric label="Participants" value={formatCompact(raid.participantCount)} detail="Joined room members" />
                <HeroMetric label="Posted Links" value={formatCompact(raid.postedCount)} detail="Verified live posts" />
                <HeroMetric label="Milestone Target" value={formatCompact(raid.milestoneTarget)} detail="Room goal" />
                <HeroMetric label="Time Left" value={raid.closedAt ? "Closed" : formatRelativeCountdown(raid.closedAt)} detail={raid.closedAt ? "Historical raid" : "Live countdown"} />
              </div>

              <div className="mt-5 rounded-[26px] border border-white/8 bg-white/[0.03] p-4">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <div className="text-[11px] uppercase tracking-[0.18em] text-white/38">Raid Progress</div>
                    <div className="mt-2 text-sm text-white/56">
                      Progress comes directly from the raid detail payload and tracks posted execution against the active raid target.
                    </div>
                  </div>
                  <div className="text-2xl font-semibold text-white">{raid.progressPct}%</div>
                </div>
                <div className="mt-4">
                  <V2ProgressBar value={raid.progressPct} valueLabel="Posted execution progress" />
                </div>
                <div className="mt-3 grid gap-3 sm:grid-cols-3">
                  <ProgressCell label="Joined" value={formatCompact(raid.participantCount)} />
                  <ProgressCell label="Posted" value={formatCompact(raid.postedCount)} />
                  <ProgressCell label="Boosts" value={formatCompact(totalBoosts)} />
                </div>
              </div>
            </div>
          </div>

          <div className="border-l border-white/8 bg-[linear-gradient(180deg,rgba(9,13,15,0.92),rgba(5,8,10,0.98))] p-5 sm:p-6">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-[11px] uppercase tracking-[0.18em] text-white/38">Live Activity</div>
                <div className="mt-1 text-sm font-semibold text-white">Room pulse</div>
              </div>
              <span className="rounded-full border border-lime-300/18 bg-lime-300/8 px-3 py-1 text-[11px] uppercase tracking-[0.14em] text-lime-200">
                Live
              </span>
            </div>
            <div className="mt-4 space-y-3">
              {activityFeed.length ? (
                activityFeed.slice(0, 6).map((item) => (
                  <div key={item.id} className="rounded-[18px] border border-white/8 bg-black/20 px-3 py-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-sm font-semibold text-white">{item.title}</div>
                        <div className="mt-1 text-[11px] uppercase tracking-[0.14em] text-lime-200">{item.kind}</div>
                      </div>
                      <div className="text-[11px] text-white/36">
                        {new Date(item.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                      </div>
                    </div>
                    <div className="mt-2 text-sm leading-6 text-white/62">{item.body}</div>
                    {item.href ? (
                      <a
                        href={item.href}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-3 inline-flex items-center gap-2 text-xs font-semibold text-lime-300"
                      >
                        Open X link
                        <ExternalLink className="h-3.5 w-3.5" />
                      </a>
                    ) : null}
                  </div>
                ))
              ) : (
                <EmptyCopy text="No room activity has been recorded yet." />
              )}
            </div>

            <div className="mt-4 rounded-[18px] border border-white/8 bg-black/20 p-3">
              <Input
                value={xPostUrl}
                onChange={(event) => setXPostUrl(event.target.value)}
                placeholder={mySubmission?.xPostUrl || "Paste your X post link to prove execution"}
                className="h-11 border-white/10 bg-transparent text-white placeholder:text-white/30"
              />
              <Button
                type="button"
                onClick={() => submitMutation.mutate()}
                disabled={!canPerformAuthenticatedWrites || !xPostUrl.trim() || submitMutation.isPending}
                className="mt-3 h-10 w-full rounded-[14px] text-slate-950"
              >
                Submit Live Link
              </Button>
            </div>
          </div>
        </div>
      </section>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.14fr)_340px]">
        <div className="space-y-4">
          <section className="rounded-[30px] border border-white/8 bg-[linear-gradient(180deg,rgba(7,12,15,0.98),rgba(4,7,9,0.98))] p-5 sm:p-6">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-[11px] uppercase tracking-[0.18em] text-white/38">How To Join</div>
                <h2 className="mt-2 text-2xl font-semibold tracking-[-0.04em] text-white">Room workflow</h2>
              </div>
              <span className="rounded-full border border-white/10 bg-white/[0.03] px-3 py-1 text-[11px] uppercase tracking-[0.14em] text-white/48">
                Mission control
              </span>
            </div>
            <div className="mt-5 grid gap-3 md:grid-cols-4">
              {[
                { step: "1", title: "Join Room", text: "Enter the raid and attach yourself to the mission." },
                { step: "2", title: "Launch Creative", text: "Use the stored meme and copy stack instead of posting cold." },
                { step: "3", title: "Submit Link", text: "Post your X link so the room can count execution." },
                { step: "4", title: "Boost Others", text: "Amplify live submissions and keep the room dense." },
              ].map((item) => (
                <div key={item.step} className="rounded-[22px] border border-white/8 bg-black/20 px-4 py-4">
                  <div className="flex h-9 w-9 items-center justify-center rounded-full border border-lime-300/20 bg-lime-300/10 text-sm font-semibold text-lime-200">
                    {item.step}
                  </div>
                  <div className="mt-4 text-sm font-semibold text-white">{item.title}</div>
                  <div className="mt-2 text-xs leading-6 text-white/52">{item.text}</div>
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-[30px] border border-white/8 bg-[linear-gradient(180deg,rgba(7,12,15,0.98),rgba(4,7,9,0.98))] p-5 sm:p-6">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-[11px] uppercase tracking-[0.18em] text-white/38">Milestones</div>
                <h2 className="mt-2 text-2xl font-semibold tracking-[-0.04em] text-white">Room progression</h2>
              </div>
              <TimerReset className="h-5 w-5 text-lime-200" />
            </div>
            <div className="mt-5 grid gap-3 md:grid-cols-4 xl:grid-cols-5">
              {milestones.length ? (
                milestones.map((milestone) => (
                  <div
                    key={milestone.label}
                    className={cn(
                      "rounded-[22px] border px-4 py-4",
                      milestone.unlocked ? "border-lime-300/18 bg-lime-300/8" : "border-white/8 bg-black/20"
                    )}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="text-sm font-semibold text-white">{milestone.label}</div>
                      <div className={cn("text-xs font-semibold", milestone.unlocked ? "text-lime-200" : "text-white/38")}>
                        {milestone.unlocked ? "Unlocked" : "Locked"}
                      </div>
                    </div>
                    <div className="mt-4 text-2xl font-semibold text-white">{formatCompact(milestone.threshold)}</div>
                    <div className="mt-1 text-xs text-white/46">Required room output</div>
                  </div>
                ))
              ) : (
                <EmptyCopy text="Milestones are not available for this room yet." />
              )}
            </div>
          </section>

          <section className="rounded-[30px] border border-white/8 bg-[linear-gradient(180deg,rgba(7,12,15,0.98),rgba(4,7,9,0.98))] p-5 sm:p-6">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-[11px] uppercase tracking-[0.18em] text-white/38">Raid Stream</div>
                <h2 className="mt-2 text-2xl font-semibold tracking-[-0.04em] text-white">Mission feed</h2>
              </div>
              <div className="flex gap-2 rounded-[18px] border border-white/8 bg-black/20 p-1">
                {[
                  { value: "activity", label: "Activity" },
                  { value: "participants", label: "Participants" },
                  { value: "leaderboard", label: "Leaderboard" },
                ].map((item) => (
                  <button
                    key={item.value}
                    type="button"
                    onClick={() => setTab(item.value as RaidViewTab)}
                    className={cn(
                      "rounded-[14px] px-3 py-2 text-xs font-medium transition",
                      tab === item.value ? "bg-lime-300/10 text-lime-200" : "text-white/46 hover:text-white/76"
                    )}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="mt-5 space-y-3">
              {tab === "activity" ? (
                activityFeed.length ? (
                  activityFeed.map((item) => (
                    <StreamCard
                      key={item.id}
                      label={item.kind}
                      title={item.title}
                      body={item.body}
                      meta={new Date(item.createdAt).toLocaleString()}
                      action={
                        item.href ? (
                          <a
                            href={item.href}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex h-9 items-center rounded-[14px] border border-white/10 bg-white/[0.04] px-4 text-sm font-semibold text-white/80 transition hover:bg-white/[0.08] hover:text-white"
                          >
                            Open
                          </a>
                        ) : null
                      }
                    />
                  ))
                ) : (
                  <EmptyCopy text="No update stream yet." />
                )
              ) : null}

              {tab === "participants" ? (
                participants.length ? (
                  participants.map((participant) => (
                    <StreamCard
                      key={participant.id}
                      label={participant.currentStep || "Joined"}
                      title={participant.user?.username || participant.user?.name || "Participant"}
                      body={`Status: ${participant.status}. Current step: ${participant.currentStep}.`}
                      meta={new Date(participant.joinedAt).toLocaleString()}
                    />
                  ))
                ) : (
                  <EmptyCopy text="No participants visible yet." />
                )
              ) : null}

              {tab === "leaderboard" ? (
                leaderboard.length ? (
                  leaderboard.map((entry, index) => (
                    <StreamCard
                      key={entry.submissionId}
                      label={`#${index + 1}`}
                      title={entry.user.username || entry.user.name}
                      body={`${entry.boostCount} boosts captured across submitted room content.`}
                      meta={entry.postedAt ? `Posted ${new Date(entry.postedAt).toLocaleString()}` : "Prepared only"}
                      action={
                        canPerformAuthenticatedWrites ? (
                          <Button
                            type="button"
                            variant="outline"
                            onClick={() => boostMutation.mutate(entry.submissionId)}
                            disabled={boostMutation.isPending}
                            className="h-9 rounded-[14px] border-white/10 bg-white/[0.04] px-4 text-white/80 hover:bg-white/[0.08] hover:text-white"
                          >
                            Boost
                          </Button>
                        ) : null
                      }
                    />
                  ))
                ) : (
                  <EmptyCopy text="No leaderboard activity yet." />
                )
              ) : null}
            </div>
          </section>
        </div>

        <div className="space-y-4">
          <V2RightRailCard eyebrow="Top Raiders" title="Leaderboard" tone="soft">
            <div className="space-y-3">
              {leaderboard.slice(0, 5).length ? (
                leaderboard.slice(0, 5).map((entry, index) => (
                  <div key={entry.submissionId} className="flex items-center justify-between gap-3 rounded-[18px] border border-white/8 bg-black/20 px-3 py-3">
                    <div className="flex min-w-0 items-center gap-3">
                      <div className="flex h-8 w-8 items-center justify-center rounded-full border border-white/8 bg-white/[0.04] text-sm font-semibold text-lime-200">
                        {index + 1}
                      </div>
                      <div className="min-w-0">
                        <div className="truncate text-sm font-semibold text-white">{entry.user.username || entry.user.name}</div>
                        <div className="text-xs text-white/40">{entry.postedAt ? "Posted live" : "Prepared"}</div>
                      </div>
                    </div>
                    <div className="text-sm font-semibold text-lime-300">{entry.boostCount}</div>
                  </div>
                ))
              ) : (
                <EmptyCopy text="Waiting for top raiders..." />
              )}
            </div>
          </V2RightRailCard>

          <V2RightRailCard eyebrow="Raid Stats" title="Room state" tone="soft">
            <div className="grid gap-3">
              <SidebarMetric icon={Users} label="Participants" value={formatCompact(raid.participantCount)} />
              <SidebarMetric icon={Zap} label="Posts Launched" value={formatCompact(raid.postedCount)} />
              <SidebarMetric icon={ShieldCheck} label="Milestones Cleared" value={`${milestones.filter((item) => item.unlocked).length}/${milestones.length}`} />
              <SidebarMetric icon={Trophy} label="Total Boosts" value={formatCompact(totalBoosts)} />
            </div>
          </V2RightRailCard>

          <V2RightRailCard eyebrow="Creative Stack" title="Stored raid assets" tone="soft">
            <div className="space-y-3">
              {raid.copyOptions.slice(0, 2).map((option) => (
                <div key={option.id} className="rounded-[18px] border border-white/8 bg-black/20 px-4 py-4">
                  <div className="text-sm font-semibold text-white">{option.label}</div>
                  <div className="mt-1 text-xs text-white/42">{option.style} / {option.voiceLabel}</div>
                  <div className="mt-3 text-xs leading-6 text-white/56">{option.text}</div>
                </div>
              ))}
              {raid.memeOptions.slice(0, 2).map((option) => (
                <div key={option.id} className="rounded-[18px] border border-white/8 bg-black/20 px-4 py-4">
                  <div className="text-sm font-semibold text-white">{option.title}</div>
                  <div className="mt-1 text-xs text-white/42">{option.toneLabel}</div>
                </div>
              ))}
            </div>
          </V2RightRailCard>

          <V2RightRailCard eyebrow="Why This Room Matters" title="Execution semantics" tone="soft">
            <div className="space-y-3">
              {[
                { icon: Zap, label: "Live tracking", text: "Raid progress updates from joined members, posted links, and boosts." },
                { icon: BrainCircuit, label: "AI context", text: "Creative, signal, and community energy stay visible in one surface." },
                { icon: Trophy, label: "Leaderboard", text: "Raid output is ranked as room execution, not trader profitability." },
              ].map((item) => {
                const Icon = item.icon;
                return (
                  <div key={item.label} className="flex gap-3 rounded-[18px] border border-white/8 bg-black/20 px-4 py-4">
                    <div className="flex h-10 w-10 items-center justify-center rounded-full border border-lime-300/20 bg-lime-300/10">
                      <Icon className="h-4 w-4 text-lime-200" />
                    </div>
                    <div>
                      <div className="text-sm font-semibold text-white">{item.label}</div>
                      <div className="mt-1 text-xs leading-6 text-white/50">{item.text}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          </V2RightRailCard>
        </div>
      </div>
    </div>
  );
}

function HeroMetric({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="rounded-[22px] border border-white/8 bg-white/[0.04] px-4 py-4">
      <div className="text-[10px] uppercase tracking-[0.16em] text-white/38">{label}</div>
      <div className="mt-3 text-2xl font-semibold text-white">{value}</div>
      <div className="mt-1 text-xs text-white/44">{detail}</div>
    </div>
  );
}

function ProgressCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[18px] border border-white/8 bg-black/20 px-4 py-3">
      <div className="text-[10px] uppercase tracking-[0.16em] text-white/34">{label}</div>
      <div className="mt-2 text-sm font-semibold text-white">{value}</div>
    </div>
  );
}

function StreamCard({
  label,
  title,
  body,
  meta,
  action,
}: {
  label: string;
  title: string;
  body: string;
  meta: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="rounded-[22px] border border-white/8 bg-black/20 px-4 py-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full border border-lime-300/14 bg-lime-300/8 px-2.5 py-1 text-[10px] uppercase tracking-[0.14em] text-lime-200">
              {label}
            </span>
            <span className="text-xs text-white/40">{meta}</span>
          </div>
          <div className="mt-3 text-sm font-semibold text-white">{title}</div>
          <div className="mt-2 text-sm leading-6 text-white/56">{body}</div>
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
    </div>
  );
}

function SidebarMetric({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Users;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-[18px] border border-white/8 bg-black/20 px-4 py-3">
      <div className="flex items-center gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-full border border-lime-300/20 bg-lime-300/10">
          <Icon className="h-4 w-4 text-lime-200" />
        </div>
        <div className="text-sm text-white/68">{label}</div>
      </div>
      <div className="text-sm font-semibold text-white">{value}</div>
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
