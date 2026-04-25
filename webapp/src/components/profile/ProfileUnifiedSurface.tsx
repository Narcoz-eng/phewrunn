import type { ReactNode } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";
import { getAvatarUrl, type ProfileHubResponse } from "@/types";
import type { PerformancePeriod, TraderPerformanceVM } from "@/viewmodels/trader-performance";
import { VerifiedBadge } from "@/components/VerifiedBadge";
import {
  Activity,
  BrainCircuit,
  CalendarDays,
  Coins,
  ShieldCheck,
  Sparkles,
  Target,
  Trophy,
  Users,
  Wallet,
  Zap,
} from "lucide-react";

export type SharedProfileTab = "overview" | "posts" | "calls" | "raids" | "portfolio" | "badges" | "activity";

type PeriodTab = {
  key: PerformancePeriod;
  label: string;
  active: boolean;
  onSelect: () => void;
};

interface ProfileUnifiedSurfaceProps {
  hub: ProfileHubResponse;
  isOwnProfile: boolean;
  heroActions?: ReactNode;
  profileTab: SharedProfileTab;
  onProfileTabChange: (tab: SharedProfileTab) => void;
  performanceVm: TraderPerformanceVM | null;
  performanceTabs: PeriodTab[];
  callsContent: ReactNode;
  statsAside?: ReactNode;
}

function buildSparklinePath(points: number[], width: number, height: number): string {
  if (!points.length) return "";
  const max = Math.max(...points);
  const min = Math.min(...points);
  const range = max - min || 1;

  return points
    .map((point, index) => {
      const x = (index / Math.max(points.length - 1, 1)) * width;
      const y = height - ((point - min) / range) * height;
      return `${index === 0 ? "M" : "L"}${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(" ");
}

function formatCompact(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "0";
  return new Intl.NumberFormat("en-US", {
    notation: value >= 1000 ? "compact" : "standard",
    maximumFractionDigits: value >= 1000 ? 1 : 0,
  }).format(value);
}

function formatJoinDate(value: string | null | undefined): string {
  if (!value) return "Joined recently";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Joined recently";
  return date.toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });
}

function formatShortDate(value: string | null | undefined): string {
  if (!value) return "Recent";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Recent";
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

function formatSignedPercent(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "Tracking";
  return `${value >= 0 ? "+" : ""}${value.toFixed(1)}%`;
}

function toTimestamp(value: string | null | undefined): number {
  if (!value) return 0;
  const date = new Date(value).getTime();
  return Number.isFinite(date) ? date : 0;
}

function toneClass(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "text-white";
  return value >= 0 ? "text-lime-300" : "text-rose-300";
}

function ProfileTabButton({
  active,
  label,
  badge,
  onClick,
}: {
  active: boolean;
  label: string;
  badge?: string | null;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex min-w-0 items-center justify-center gap-2 rounded-[12px] border px-3 py-2.5 text-sm font-medium transition-colors",
        active
          ? "border-lime-300/35 bg-lime-300/12 text-white shadow-[0_0_0_1px_rgba(163,230,53,0.08)]"
          : "border-white/8 bg-white/[0.03] text-white/58 hover:bg-white/[0.06] hover:text-white/86"
      )}
    >
      <span>{label}</span>
      {badge ? <span className="text-[11px] text-white/40">{badge}</span> : null}
    </button>
  );
}

function HeroMetric({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-[0.22em] text-white/38">{label}</div>
      <div className="mt-2 text-[1.45rem] font-semibold leading-none text-white">{value}</div>
    </div>
  );
}

function OverviewCard({
  eyebrow,
  title,
  children,
  className,
}: {
  eyebrow: string;
  title: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("rounded-[28px] border border-white/8 bg-[#0a0e17] p-5 shadow-[0_20px_70px_rgba(0,0,0,0.26)]", className)}>
      <div className="text-[11px] uppercase tracking-[0.22em] text-white/38">{eyebrow}</div>
      <h3 className="mt-2 text-[1.35rem] font-semibold text-white">{title}</h3>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function SideRailCard({
  eyebrow,
  title,
  children,
  className,
}: {
  eyebrow: string;
  title: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn(
        "rounded-[26px] border border-white/8 bg-[linear-gradient(180deg,rgba(9,13,20,0.98),rgba(5,9,13,0.98))] p-5 shadow-[0_22px_70px_rgba(0,0,0,0.22)]",
        className
      )}
    >
      <div className="text-[11px] uppercase tracking-[0.22em] text-white/38">{eyebrow}</div>
      <h3 className="mt-2 text-xl font-semibold text-white">{title}</h3>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function MetricListRow({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-[18px] border border-white/8 bg-white/[0.03] px-4 py-3">
      <div className="text-sm text-white/52">{label}</div>
      <div className={cn("text-sm font-semibold text-white", tone)}>{value}</div>
    </div>
  );
}

export function ProfileUnifiedSurface({
  hub,
  isOwnProfile,
  heroActions,
  profileTab,
  onProfileTabChange,
  performanceVm,
  performanceTabs,
  callsContent,
  statsAside,
}: ProfileUnifiedSurfaceProps) {
  const avatarSeed = hub.hero.id || hub.hero.username || hub.hero.name || "trader";
  const avatarUrl = getAvatarUrl(avatarSeed, hub.hero.image);
  const sparklinePath = buildSparklinePath(performanceVm?.chartPoints ?? [4, 7, 11, 10, 14, 19, 18, 24], 100, 42);
  const totalProfitPercent = hub.performanceSummary.totalProfitPercent ?? null;
  const performanceLabel =
    typeof totalProfitPercent === "number" && Number.isFinite(totalProfitPercent)
      ? `${totalProfitPercent >= 0 ? "+" : ""}${totalProfitPercent.toFixed(1)}%`
      : "Tracking";
  const earnedLabel =
    typeof hub.hero.earnedPoints === "number" && Number.isFinite(hub.hero.earnedPoints)
      ? `${formatCompact(hub.hero.earnedPoints)} $PHEW earned`
      : `${formatCompact(hub.hero.followersCount)} followers reached`;
  const callBadge = `${hub.performanceSummary.totalCalls} tracked`;
  const raidBadge = `${hub.raidHistory.length} recent`;
  const portfolioBadge = hub.portfolioSnapshot?.connected ? "wallet linked" : "wallet quiet";
  const primaryCall = hub.topCalls[0] ?? null;
  const nextRewardLevel = hub.xp.level + 1;
  const nextRewardXp = Math.max(hub.xp.nextLevelXp - hub.xp.xp, 0);
  const signalStats = [
    { label: "Followers", value: formatCompact(hub.hero.followersCount) },
    { label: "Calls Shared", value: formatCompact(hub.performanceSummary.totalCalls) },
    { label: "Raids Joined", value: formatCompact(hub.raidImpact.raidsJoined) },
    { label: "Boost Count", value: formatCompact(hub.raidImpact.boostCount) },
    { label: "Raid Wins", value: formatCompact(hub.raidImpact.raidsWon) },
    { label: "Contribution", value: formatCompact(hub.raidImpact.contributionScore) },
  ];
  const reputationBand =
    hub.reputationMetrics.find((metric) => /tier|rank|reputation/i.test(metric.label)) ??
    null;
  const contributorMetric =
    hub.reputationMetrics.find((metric) => /contrib|leader|impact|rank/i.test(metric.label)) ??
    null;
  const heroBadges = hub.badges.slice(0, 4);
  const walletPositions = (hub.portfolioSnapshot?.tokenPositions ?? []).slice(0, 4);
  const recentActivity = [
    ...hub.topCalls.map((call) => ({
      id: `call:${call.id}`,
      type: "call" as const,
      label: call.ticker ? `$${call.ticker}` : call.title || "Tracked call",
      meta: "Signal posted",
      dateLabel: formatShortDate(call.createdAt),
      sortAt: toTimestamp(call.createdAt),
      value: formatSignedPercent(call.roiCurrentPct ?? call.roiPeakPct ?? null),
      tone: toneClass(call.roiCurrentPct ?? call.roiPeakPct ?? null),
    })),
    ...hub.raidHistory.map((raid) => ({
      id: `raid:${raid.id}`,
      type: "raid" as const,
      label: raid.tokenSymbol ? `$${raid.tokenSymbol}` : raid.tokenName || "Raid room",
      meta: raid.objective,
      dateLabel: formatShortDate(raid.postedAt ?? raid.launchedAt ?? raid.joinedAt),
      sortAt: toTimestamp(raid.postedAt ?? raid.launchedAt ?? raid.joinedAt),
      value: `${raid.boostCount} boosts`,
      tone: "text-cyan-300",
    })),
  ]
    .sort((a, b) => b.sortAt - a.sortAt)
    .slice(0, 6);

  return (
    <div className="space-y-4 pb-24">
      <section className="overflow-hidden rounded-[22px] border border-white/8 bg-[#080b12] shadow-[0_26px_90px_rgba(0,0,0,0.32)]">
        <div className="relative px-5 pb-5 pt-[86px] sm:px-6">
          {hub.hero.bannerImage ? (
            <div className="absolute inset-x-0 top-0 h-[235px] overflow-hidden">
              <div
                className="absolute inset-0 bg-cover bg-center opacity-35"
                style={{ backgroundImage: `url("${hub.hero.bannerImage}")` }}
              />
              <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(2,5,8,0.18),rgba(2,5,8,0.92)),radial-gradient(circle_at_14%_8%,rgba(163,230,53,0.24),transparent_28%),radial-gradient(circle_at_80%_10%,rgba(34,211,238,0.2),transparent_28%)]" />
            </div>
          ) : (
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_18%_0%,rgba(163,230,53,0.22),transparent_30%),radial-gradient(circle_at_80%_0%,rgba(34,211,238,0.18),transparent_30%),linear-gradient(180deg,rgba(255,255,255,0.03),rgba(255,255,255,0))]" />
          )}
          <div className="relative space-y-4">
            <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_330px]">
              <div className="rounded-[22px] border border-white/8 bg-[linear-gradient(180deg,rgba(8,13,20,0.88),rgba(4,8,12,0.94))] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] sm:p-5">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
                  <Avatar className="h-24 w-24 shrink-0 rounded-[26px] border border-lime-300/25 shadow-[0_0_0_1px_rgba(163,230,53,0.12)]">
                    <AvatarImage src={avatarUrl} alt={hub.hero.name ?? hub.hero.username ?? "Trader"} />
                    <AvatarFallback className="rounded-[26px] bg-white/5 text-3xl text-white">
                      {(hub.hero.name ?? hub.hero.username ?? "?").charAt(0).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>

                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="rounded-full border border-lime-300/18 bg-lime-300/10 px-3 py-1 text-[11px] uppercase tracking-[0.22em] text-lime-200">
                        Level {hub.xp.level}
                      </div>
                      <div className="rounded-full border border-cyan-400/18 bg-cyan-400/10 px-3 py-1 text-[11px] uppercase tracking-[0.22em] text-cyan-200">
                        {hub.aiScore.score?.toFixed(1) ?? "0.0"} AI score
                      </div>
                      <div className="rounded-full border border-amber-300/18 bg-amber-300/10 px-3 py-1 text-[11px] uppercase tracking-[0.22em] text-amber-200">
                        {reputationBand?.value ?? hub.aiScore.label}
                      </div>
                    </div>

                    <div className="mt-3 flex flex-wrap items-center gap-3">
                      <h1 className="min-w-0 truncate text-[2rem] font-semibold leading-none text-white sm:text-[2.45rem]">
                        {hub.hero.name ?? hub.hero.username ?? "Trader"}
                      </h1>
                      {hub.hero.isVerified ? <VerifiedBadge className="h-5 w-5 text-cyan-300" /> : null}
                      {hub.hero.username ? (
                        <span className="rounded-2xl border border-white/8 bg-white/[0.04] px-3 py-1.5 text-base text-white/70">
                          @{hub.hero.username}
                        </span>
                      ) : null}
                    </div>

                    <div className="mt-3 flex flex-wrap items-center gap-3 text-sm text-white/62">
                      <span className="inline-flex items-center gap-1.5">
                        <CalendarDays className="h-4 w-4 text-white/38" />
                        Joined {formatJoinDate(hub.hero.createdAt)}
                      </span>
                      <span>{earnedLabel}</span>
                      <span>{hub.performanceSummary.totalCalls} tracked calls</span>
                    </div>

                    <p className="mt-3 max-w-3xl text-[0.95rem] leading-6 text-white/68">
                      {hub.hero.bio || "No bio added yet."}
                    </p>

                    {heroBadges.length ? (
                      <div className="mt-4 flex flex-wrap gap-2">
                        {heroBadges.map((badge) => (
                          <span
                            key={badge.id}
                            className={cn(
                              "rounded-full border px-3 py-1 text-[11px] uppercase tracking-[0.16em]",
                              badge.tone === "xp" && "border-lime-300/18 bg-lime-300/10 text-lime-200",
                              badge.tone === "live" && "border-cyan-300/18 bg-cyan-300/10 text-cyan-200",
                              badge.tone !== "xp" && badge.tone !== "live" && "border-white/10 bg-white/[0.04] text-white/62"
                            )}
                          >
                            {badge.label}
                          </span>
                        ))}
                      </div>
                    ) : null}

                    <div className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-6">
                      <HeroMetric label="Following" value={formatCompact(hub.hero.followingCount)} />
                      <HeroMetric label="Followers" value={formatCompact(hub.hero.followersCount)} />
                      <HeroMetric label="AI Score" value={hub.aiScore.score?.toFixed(1) ?? "0.0"} />
                      <HeroMetric label="Calls" value={formatCompact(hub.performanceSummary.totalCalls)} />
                      <HeroMetric label="Win Rate" value={`${hub.performanceSummary.winRate?.toFixed(0) ?? "0"}%`} />
                      <HeroMetric label="Signal ROI" value={performanceLabel} />
                    </div>

                    <div className="mt-4 rounded-[18px] border border-white/8 bg-white/[0.03] p-3">
                      <div className="flex flex-wrap items-center justify-between gap-3 text-xs uppercase tracking-[0.22em] text-white/44">
                        <span>{hub.xp.xp.toLocaleString()} XP</span>
                        <span>Next level {hub.xp.nextLevelXp.toLocaleString()}</span>
                      </div>
                      <div className="mt-3 h-3 overflow-hidden rounded-full bg-white/8">
                        <div
                          className="h-full rounded-full bg-[linear-gradient(90deg,#b9ff2f,#1fe4c6)] shadow-[0_0_20px_rgba(31,228,198,0.28)]"
                          style={{ width: `${hub.xp.progressPct}%` }}
                        />
                      </div>
                      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-sm text-white/54">
                        <span>XP tracks calls, raids, and contributor trust.</span>
                        <span className="font-semibold text-lime-200">{hub.xp.progressPct.toFixed(0)}%</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <div className="grid gap-3">
                <div className="rounded-[20px] border border-lime-300/18 bg-[radial-gradient(circle_at_top_left,rgba(169,255,52,0.12),transparent_34%),linear-gradient(180deg,rgba(7,10,15,0.98),rgba(4,7,11,0.98))] p-4 shadow-[0_16px_60px_rgba(120,255,67,0.08)]">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <div className="text-[11px] uppercase tracking-[0.22em] text-white/38">Reputation command center</div>
                      <div className="mt-3 text-[1.25rem] font-semibold text-white">
                        {reputationBand?.value ?? "Live trader"}
                      </div>
                      <div className="mt-2 text-sm text-white/54">
                        {reputationBand?.label ?? "Real call outcomes, raid impact, and AI quality all feed this surface."}
                      </div>
                    </div>
                    <div className="rounded-[14px] border border-lime-300/18 bg-lime-300/10 px-3 py-2 text-sm font-semibold text-lime-200">
                      {hub.aiScore.percentile ?? hub.aiScore.label}
                    </div>
                  </div>
                  <div className="mt-4 grid grid-cols-2 gap-3">
                    <div className="rounded-[16px] border border-white/8 bg-[#090d15] p-3">
                      <div className="text-[11px] uppercase tracking-[0.22em] text-white/38">AI trader score</div>
                      <div className="mt-3 text-[2.5rem] font-semibold leading-none text-white">
                        {hub.aiScore.score?.toFixed(1) ?? "0.0"}
                      </div>
                    </div>
                    <div className="rounded-[16px] border border-white/8 bg-[#090d15] p-3">
                      <div className="text-[11px] uppercase tracking-[0.22em] text-white/38">Contributor impact</div>
                      <div className="mt-3 text-[2.5rem] font-semibold leading-none text-white">
                        {formatCompact(hub.raidImpact.contributionScore)}
                      </div>
                    </div>
                  </div>
                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    <MetricListRow label="Followers" value={formatCompact(hub.hero.followersCount)} />
                    <MetricListRow label="Following" value={formatCompact(hub.hero.followingCount)} />
                    <MetricListRow
                      label="Signal win rate"
                      value={`${hub.performanceSummary.winRate?.toFixed(0) ?? "0"}%`}
                      tone="text-lime-300"
                    />
                    <MetricListRow
                      label="Tracked calls"
                      value={formatCompact(hub.performanceSummary.totalCalls)}
                    />
                  </div>
                </div>

                <div className="rounded-[20px] border border-white/8 bg-[linear-gradient(180deg,rgba(9,13,20,0.98),rgba(5,9,13,0.98))] p-4">
                  <div className="text-[11px] uppercase tracking-[0.22em] text-white/38">Level progression</div>
                  <div className="mt-3 text-lg font-semibold text-white">
                    Level {hub.xp.level}{" - "}{hub.xp.xp.toLocaleString()} / {hub.xp.nextLevelXp.toLocaleString()} XP
                  </div>
                  <div className="mt-2 text-sm text-white/54">This profile grows as real calls settle and raids convert into visible impact.</div>
                  <div className="mt-4 h-3 overflow-hidden rounded-full bg-white/8">
                    <div
                      className="h-full rounded-full bg-[linear-gradient(90deg,#b9ff2f,#1fe4c6)] shadow-[0_0_22px_rgba(31,228,198,0.28)]"
                      style={{ width: `${hub.xp.progressPct}%` }}
                    />
                  </div>
                </div>

                {heroActions ? <div className="flex flex-wrap justify-end gap-2">{heroActions}</div> : null}
              </div>
            </div>
          </div>
        </div>
      </section>

      <div className="grid grid-cols-2 gap-2 lg:grid-cols-7">
        <ProfileTabButton active={profileTab === "overview"} label="Overview" onClick={() => onProfileTabChange("overview")} />
        <ProfileTabButton active={profileTab === "posts"} label="Posts" onClick={() => onProfileTabChange("posts")} />
        <ProfileTabButton active={profileTab === "calls"} label="Calls" badge={callBadge} onClick={() => onProfileTabChange("calls")} />
        <ProfileTabButton active={profileTab === "raids"} label="X Raids" badge={raidBadge} onClick={() => onProfileTabChange("raids")} />
        <ProfileTabButton active={profileTab === "portfolio"} label="Portfolio" badge={portfolioBadge} onClick={() => onProfileTabChange("portfolio")} />
        <ProfileTabButton active={profileTab === "badges"} label="Badges" onClick={() => onProfileTabChange("badges")} />
        <ProfileTabButton active={profileTab === "activity"} label="Activity" onClick={() => onProfileTabChange("activity")} />
      </div>

      {profileTab === "overview" ? (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1.08fr)_minmax(320px,0.84fr)_340px]">
          <div className="space-y-4">
              <OverviewCard eyebrow="Signal Performance" title="Call reputation engine">
                <div className="flex flex-col gap-5">
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                    <div className="max-w-2xl">
                      <div className="inline-flex items-center rounded-full border border-cyan-300/18 bg-cyan-300/10 px-3 py-1 text-[11px] uppercase tracking-[0.18em] text-cyan-200">
                        Signal-based only, not wallet
                      </div>
                      <div className={cn("mt-4 text-[3.4rem] font-semibold leading-none", toneClass(totalProfitPercent))}>
                        {performanceLabel}
                      </div>
                      <p className="mt-3 text-sm leading-6 text-white/56">
                        Settled call performance across {hub.performanceSummary.totalCalls} tracked setups. This surface ranks published signals only and never implies realized wallet PnL.
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {performanceTabs.map((tab) => (
                        <button
                          key={tab.key}
                          type="button"
                          onClick={tab.onSelect}
                          className={cn(
                            "rounded-full border px-3 py-1.5 text-xs font-medium tracking-wide transition-colors",
                            tab.active
                              ? "border-lime-300/30 bg-lime-300/12 text-lime-200"
                              : "border-white/8 bg-white/[0.03] text-white/52 hover:bg-white/[0.06] hover:text-white/86"
                          )}
                        >
                          {tab.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-4">
                    <MetricListRow label="Signal ROI" value={performanceLabel} tone={toneClass(totalProfitPercent)} />
                    <MetricListRow
                      label="Win Rate"
                      value={`${hub.performanceSummary.winRate?.toFixed(0) ?? "0"}%`}
                      tone="text-lime-300"
                    />
                    <MetricListRow label="Tracked Calls" value={formatCompact(hub.performanceSummary.totalCalls)} />
                    <MetricListRow
                      label="Top Setup"
                      value={primaryCall?.ticker ? `$${primaryCall.ticker}` : primaryCall ? "Live" : "Waiting"}
                      tone="text-cyan-300"
                    />
                  </div>

                  <div className="overflow-hidden rounded-[24px] border border-white/8 bg-[linear-gradient(180deg,rgba(14,18,34,0.98),rgba(8,10,18,0.98))] px-2 pb-2 pt-5">
                    <div className="flex items-center justify-between gap-4 px-4">
                      <div className="text-[10px] uppercase tracking-[0.22em] text-white/34">
                        {performanceVm?.chartLabel ?? "Signal ROI curve"}
                      </div>
                      <div className="rounded-full border border-lime-300/16 bg-lime-300/10 px-3 py-1 text-[10px] uppercase tracking-[0.18em] text-lime-200">
                        Reputation weighted
                      </div>
                    </div>
                    <svg viewBox="0 0 100 42" className="mt-3 h-[240px] w-full" preserveAspectRatio="none">
                      <path d={`${sparklinePath} L100 42 L0 42 Z`} fill="url(#profile-area-fill)" opacity="0.18" />
                      <path d={sparklinePath} fill="none" stroke="url(#profile-line)" strokeWidth="1.8" strokeLinecap="round" />
                      <defs>
                        <linearGradient id="profile-line" x1="0%" x2="100%">
                          <stop offset="0%" stopColor="rgba(184,255,47,0.9)" />
                          <stop offset="100%" stopColor="rgba(31,228,198,0.95)" />
                        </linearGradient>
                        <linearGradient id="profile-area-fill" x1="0%" x2="0%" y1="0%" y2="100%">
                          <stop offset="0%" stopColor="rgba(184,255,47,0.68)" />
                          <stop offset="100%" stopColor="rgba(31,228,198,0)" />
                        </linearGradient>
                      </defs>
                    </svg>
                  </div>

                  <div className="grid gap-3">
                    {primaryCall ? (
                      <div className="rounded-[24px] border border-lime-300/16 bg-[linear-gradient(180deg,rgba(169,255,52,0.08),rgba(45,212,191,0.04))] p-4">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="rounded-full border border-lime-300/18 bg-lime-300/10 px-3 py-1 text-[11px] uppercase tracking-[0.16em] text-lime-200">
                            {primaryCall.ticker ? `$${primaryCall.ticker}` : "Tracked call"}
                          </span>
                          <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-[11px] uppercase tracking-[0.16em] text-white/58">
                            Top call in profile history
                          </span>
                        </div>
                        <div className="mt-4 text-2xl font-semibold tracking-[-0.04em] text-white">
                          {primaryCall.title || "High-conviction setup"}
                        </div>
                        <div className="mt-4 grid gap-3 sm:grid-cols-3">
                          <MetricListRow
                            label="Current ROI"
                            value={formatSignedPercent(primaryCall.roiCurrentPct)}
                            tone={toneClass(primaryCall.roiCurrentPct)}
                          />
                          <MetricListRow
                            label="Peak ROI"
                            value={formatSignedPercent(primaryCall.roiPeakPct)}
                            tone={toneClass(primaryCall.roiPeakPct)}
                          />
                          <MetricListRow label="Logged" value={formatJoinDate(primaryCall.createdAt)} />
                        </div>
                      </div>
                    ) : (
                      <div className="rounded-[24px] border border-dashed border-white/12 bg-white/[0.02] px-5 py-6 text-sm text-white/54">
                        A ranked call will appear here as soon as this profile has settled signal history to surface.
                      </div>
                    )}
                  </div>
                </div>
              </OverviewCard>

              <OverviewCard eyebrow="Call History" title="Top calls and tracked outcomes">
                <div className="space-y-3">
                  {hub.topCalls.length ? (
                    hub.topCalls.map((call, index) => (
                      <div
                        key={call.id}
                        className="grid gap-3 rounded-[22px] border border-white/8 bg-white/[0.03] px-4 py-4 lg:grid-cols-[56px_minmax(0,1fr)_110px_110px]"
                      >
                        <div className="flex h-14 w-14 items-center justify-center rounded-[18px] border border-white/8 bg-white/[0.04] text-lg font-semibold text-white/72">
                          #{index + 1}
                        </div>
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <div className="truncate text-sm font-semibold text-white">
                              {call.ticker ? `$${call.ticker}` : call.title || "Tracked call"}
                            </div>
                            <span className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[10px] uppercase tracking-[0.16em] text-white/48">
                              Logged {formatShortDate(call.createdAt)}
                            </span>
                          </div>
                          <div className="mt-1 truncate text-xs text-white/46">
                            {call.title || "Settled signal used in the public profile ranking surface."}
                          </div>
                        </div>
                        <div>
                          <div className="text-[10px] uppercase tracking-[0.16em] text-white/38">Current ROI</div>
                          <div className={cn("mt-2 text-lg font-semibold", toneClass(call.roiCurrentPct))}>
                            {formatSignedPercent(call.roiCurrentPct)}
                          </div>
                        </div>
                        <div>
                          <div className="text-[10px] uppercase tracking-[0.16em] text-white/38">Peak ROI</div>
                          <div className={cn("mt-2 text-lg font-semibold", toneClass(call.roiPeakPct))}>
                            {formatSignedPercent(call.roiPeakPct)}
                          </div>
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="rounded-[22px] border border-dashed border-white/12 bg-white/[0.02] px-5 py-10 text-sm text-white/54">
                      No settled signal history yet. Once calls start resolving, they’ll populate this ranking ledger.
                    </div>
                  )}
                </div>
              </OverviewCard>
          </div>

          <div className="space-y-4">
            <OverviewCard eyebrow="Wallet Snapshot" title="Portfolio surface">
                <div className="space-y-4">
                  <div className="inline-flex items-center rounded-full border border-amber-300/18 bg-amber-300/10 px-3 py-1 text-[11px] uppercase tracking-[0.18em] text-amber-200">
                    Wallet-based only, not signal ROI
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="rounded-[22px] border border-white/8 bg-white/[0.03] px-4 py-4">
                      <div className="text-[11px] uppercase tracking-[0.18em] text-white/34">Wallet address</div>
                      <div className="mt-2 text-lg font-semibold text-white">
                        {hub.portfolioSnapshot?.address
                          ? `${hub.portfolioSnapshot.address.slice(0, 6)}...${hub.portfolioSnapshot.address.slice(-4)}`
                          : "Unavailable"}
                      </div>
                    </div>
                    <div className="rounded-[22px] border border-white/8 bg-white/[0.03] px-4 py-4">
                      <div className="text-[11px] uppercase tracking-[0.18em] text-white/34">Wallet state</div>
                      <div className={cn("mt-2 text-lg font-semibold", hub.portfolioSnapshot?.connected ? "text-cyan-300" : "text-white")}>
                        {hub.portfolioSnapshot?.connected ? "Linked snapshot" : "Private or missing"}
                      </div>
                    </div>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-3">
                    <MetricListRow
                      label="Balance USD"
                      value={`$${((hub.portfolioSnapshot?.balanceUsd ?? 0) || 0).toLocaleString()}`}
                    />
                    <MetricListRow
                      label="SOL Balance"
                      value={(hub.portfolioSnapshot?.balanceSol ?? 0).toLocaleString(undefined, { maximumFractionDigits: 3 })}
                    />
                    <MetricListRow
                      label="Open Positions"
                      value={formatCompact(hub.portfolioSnapshot?.tokenPositions.length ?? 0)}
                    />
                  </div>

                  <div className="rounded-[24px] border border-white/8 bg-[#0a1016] p-4">
                    <div className="text-[11px] uppercase tracking-[0.2em] text-white/38">Wallet holdings in focus</div>
                    <div className="mt-4 space-y-3">
                      {walletPositions.length ? (
                        walletPositions.map((position) => (
                          <div
                            key={position.mint}
                            className="flex items-center justify-between gap-4 rounded-[18px] border border-white/8 bg-white/[0.03] px-4 py-3"
                          >
                            <div className="min-w-0">
                              <div className="truncate text-sm font-semibold text-white">
                                {position.tokenSymbol ? `$${position.tokenSymbol}` : position.tokenName || "Position"}
                              </div>
                              <div className="mt-1 text-xs text-white/44">
                                ${(position.holdingUsd ?? 0).toLocaleString()} exposure
                              </div>
                            </div>
                            <div className={cn("text-sm font-semibold", toneClass(position.totalPnlUsd ?? null))}>
                              {(position.totalPnlUsd ?? 0) >= 0 ? "+" : ""}${Math.abs(position.totalPnlUsd ?? 0).toLocaleString()}
                            </div>
                          </div>
                        ))
                      ) : (
                        <div className="rounded-[18px] border border-dashed border-white/12 bg-white/[0.02] px-4 py-5 text-sm text-white/54">
                          No token positions are exposed in the current wallet snapshot.
                        </div>
                      )}
                    </div>
                  </div>
                </div>
            </OverviewCard>

            <OverviewCard eyebrow="Recent Activity" title="Calls, raids, and profile momentum">
                <div className="space-y-3">
                  {recentActivity.length ? (
                    recentActivity.map((item) => (
                      <div
                        key={item.id}
                        className="flex items-start justify-between gap-4 rounded-[20px] border border-white/8 bg-white/[0.03] px-4 py-3"
                      >
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span
                              className={cn(
                                "rounded-full border px-2.5 py-0.5 text-[10px] uppercase tracking-[0.16em]",
                                item.type === "call"
                                  ? "border-lime-300/18 bg-lime-300/10 text-lime-200"
                                  : "border-cyan-300/18 bg-cyan-300/10 text-cyan-200"
                              )}
                            >
                              {item.type === "call" ? "Signal" : "Raid"}
                            </span>
                            <div className="truncate text-sm font-semibold text-white">{item.label}</div>
                          </div>
                          <div className="mt-1 text-xs text-white/46">{item.meta}</div>
                        </div>
                        <div className="shrink-0 text-right">
                          <div className={cn("text-sm font-semibold", item.tone)}>{item.value}</div>
                          <div className="mt-1 text-[11px] uppercase tracking-[0.16em] text-white/34">{item.dateLabel}</div>
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="rounded-[20px] border border-dashed border-white/12 bg-white/[0.02] px-4 py-10 text-sm text-white/54">
                      Activity will appear here when calls or raid participation become visible on this profile.
                    </div>
                  )}
                </div>
            </OverviewCard>
          </div>

          <div className="space-y-4">
            {statsAside}

            <SideRailCard eyebrow="Level Progression" title={reputationBand?.value ?? "Reputation band"}>
              <div className="space-y-4">
                <div>
                  <div className="text-sm text-white/58">Level {hub.xp.level} public identity track</div>
                  <div className="mt-2 text-lg font-semibold text-white">
                    {hub.xp.xp.toLocaleString()} / {hub.xp.nextLevelXp.toLocaleString()} XP
                  </div>
                  <div className="mt-2 text-sm text-white/50">
                    XP compounds from calls, raids, boosts, and profile trust. This is the visible progression surface.
                  </div>
                </div>
                <div className="h-3 overflow-hidden rounded-full bg-white/8">
                  <div
                    className="h-full rounded-full bg-[linear-gradient(90deg,#b9ff2f,#1fe4c6)] shadow-[0_0_22px_rgba(31,228,198,0.28)]"
                    style={{ width: `${hub.xp.progressPct}%` }}
                  />
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <MetricListRow label="Progress" value={`${hub.xp.progressPct.toFixed(0)}%`} tone="text-lime-300" />
                  <MetricListRow label="Next Reward" value={`Level ${nextRewardLevel}`} tone="text-cyan-300" />
                </div>
                <div className="rounded-[20px] border border-lime-300/16 bg-lime-300/8 px-4 py-3">
                  <div className="text-[11px] uppercase tracking-[0.18em] text-white/40">Remaining XP</div>
                  <div className="mt-2 text-sm font-semibold text-lime-200">{nextRewardXp.toLocaleString()} XP to unlock</div>
                </div>
              </div>
            </SideRailCard>

            <SideRailCard eyebrow="Badges" title="Proof of reputation">
              <div className="grid grid-cols-2 gap-3">
                {hub.badges.length ? hub.badges.slice(0, 8).map((badge) => (
                  <div
                    key={badge.id}
                    className={cn(
                      "rounded-[18px] border px-3 py-3 text-center text-sm font-medium capitalize",
                      badge.tone === "xp" && "border-lime-300/25 bg-lime-300/10 text-lime-200",
                      badge.tone === "live" && "border-cyan-300/25 bg-cyan-300/10 text-cyan-200",
                      badge.tone !== "xp" && badge.tone !== "live" && "border-white/10 bg-white/[0.04] text-white/74"
                    )}
                  >
                    {badge.label}
                  </div>
                )) : (
                  <div className="col-span-2 text-sm text-white/58">No verified badge cluster yet.</div>
                )}
              </div>
            </SideRailCard>

            <SideRailCard eyebrow="Contributor Rank" title={contributorMetric?.value ?? "Campaign footprint"}>
              <div className="space-y-3">
                {signalStats.map((metric) => (
                  <MetricListRow key={metric.label} label={metric.label} value={metric.value} />
                ))}
              </div>
            </SideRailCard>
          </div>
        </div>
      ) : null}

      {profileTab === "posts" ? callsContent : null}

      {profileTab === "calls" ? (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_360px]">
          <OverviewCard eyebrow="Top Calls" title="Signal/call performance, not wallet profit">
            <div className="space-y-3">
              {hub.topCalls.length ? hub.topCalls.map((call) => (
                <div key={call.id} className="rounded-[22px] border border-white/8 bg-white/[0.03] px-4 py-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded-full border border-lime-300/18 bg-lime-300/10 px-2.5 py-0.5 text-[10px] uppercase tracking-[0.16em] text-lime-200">
                          Signal ROI
                        </span>
                        <div className="truncate text-sm font-semibold text-white">
                          {call.ticker ? `$${call.ticker}` : call.title || "Tracked call"}
                        </div>
                      </div>
                      {call.title ? <div className="mt-2 text-sm leading-6 text-white/52">{call.title}</div> : null}
                      <div className="mt-3 text-[11px] uppercase tracking-[0.16em] text-white/34">
                        Posted {formatShortDate(call.createdAt)}
                      </div>
                    </div>
                    <div className="shrink-0 text-right">
                      <div className={cn("text-lg font-semibold", toneClass(call.roiCurrentPct ?? call.roiPeakPct))}>
                        {formatSignedPercent(call.roiCurrentPct ?? call.roiPeakPct)}
                      </div>
                      <div className="mt-1 text-[11px] text-white/38">call performance</div>
                    </div>
                  </div>
                </div>
              )) : (
                <div className="rounded-[22px] border border-dashed border-white/12 bg-white/[0.02] px-4 py-10 text-center text-sm text-white/54">
                  No token-linked call outcomes are available for this profile yet.
                </div>
              )}
            </div>
          </OverviewCard>
          <div className="space-y-4">
            {statsAside}
            <OverviewCard eyebrow="Call Integrity" title="What this number means">
              <div className="space-y-3">
                <MetricListRow label="Signal ROI" value={performanceLabel} tone={toneClass(totalProfitPercent)} />
                <MetricListRow label="Win Rate" value={`${hub.performanceSummary.winRate?.toFixed(0) ?? "0"}%`} tone="text-lime-300" />
                <MetricListRow label="Tracked Calls" value={formatCompact(hub.performanceSummary.totalCalls)} />
                <div className="rounded-[20px] border border-cyan-300/16 bg-cyan-300/8 px-4 py-3 text-sm leading-6 text-white/56">
                  These values are derived from published signal outcomes. They do not claim realized wallet or portfolio PnL.
                </div>
              </div>
            </OverviewCard>
          </div>
        </div>
      ) : null}

      {profileTab === "raids" ? (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_360px]">
          <OverviewCard eyebrow="Raid History" title="Recent campaign footprint">
            <div className="space-y-3">
              {hub.raidHistory.length ? hub.raidHistory.map((raid) => (
                <a
                  key={raid.id}
                  href={`/raids/${raid.tokenAddress}/${raid.id}`}
                  className="flex items-center justify-between gap-4 rounded-[22px] border border-white/8 bg-white/[0.03] px-4 py-4 transition-colors hover:bg-white/[0.06]"
                >
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold text-white">
                      {raid.tokenSymbol ? `$${raid.tokenSymbol}` : raid.tokenName || "Raid"}
                    </div>
                    <div className="mt-1 truncate text-xs text-white/44">{raid.objective}</div>
                    <div className="mt-2 flex flex-wrap items-center gap-3 text-[11px] uppercase tracking-[0.18em] text-white/32">
                      <span>{raid.participantStatus}</span>
                      <span>{formatCompact(raid.participantCount)} participants</span>
                      <span>{formatJoinDate(raid.joinedAt)}</span>
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="text-sm font-semibold text-white">{raid.boostCount} boosts</div>
                    <div className="mt-1 text-xs text-white/42">{raid.status}</div>
                  </div>
                </a>
              )) : (
                <div className="text-sm text-white/56">No raid history is visible yet.</div>
              )}
            </div>
          </OverviewCard>

          <div className="space-y-4">
            <OverviewCard eyebrow="Rewards" title="Why this matters">
              <div className="grid gap-3">
                {[
                  { icon: <Activity className="h-5 w-5 text-lime-300" />, label: "Auto tracking", copy: "Participation and posting states are tracked from real raid mutations." },
                  { icon: <BrainCircuit className="h-5 w-5 text-cyan-300" />, label: "AI intelligence", copy: "Raid score and signal quality compound the profile surface." },
                  { icon: <Zap className="h-5 w-5 text-lime-300" />, label: "Levels & XP", copy: "Campaign activity feeds real XP and contribution metrics." },
                  { icon: <Coins className="h-5 w-5 text-cyan-300" />, label: "Rewards", copy: "Boosts and posted campaigns contribute to visible impact." },
                ].map((item) => (
                  <div key={item.label} className="flex items-start gap-3 rounded-[22px] border border-white/8 bg-white/[0.03] px-4 py-3">
                    <div className="mt-0.5">{item.icon}</div>
                    <div>
                      <div className="text-sm font-semibold text-white">{item.label}</div>
                      <div className="mt-1 text-xs leading-6 text-white/48">{item.copy}</div>
                    </div>
                  </div>
                ))}
              </div>
            </OverviewCard>
          </div>
        </div>
      ) : null}

      {profileTab === "portfolio" ? (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1.15fr)_360px]">
          <OverviewCard eyebrow="Portfolio" title="Wallet snapshot">
            {hub.portfolioSnapshot?.connected && hub.portfolioSnapshot.tokenPositions.length ? (
              <div className="space-y-3">
                {hub.portfolioSnapshot.tokenPositions.slice(0, 8).map((position) => (
                  <div key={position.mint} className="flex items-center justify-between gap-4 rounded-[22px] border border-white/8 bg-white/[0.03] px-4 py-4">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold text-white">
                        {position.tokenSymbol ? `$${position.tokenSymbol}` : position.tokenName || "Position"}
                      </div>
                      <div className="mt-1 truncate text-xs text-white/44">
                        {(position.holdingAmount ?? 0).toLocaleString(undefined, { maximumFractionDigits: 2 })} tokens
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-sm font-semibold text-white">${(position.holdingUsd ?? 0).toLocaleString()}</div>
                      <div className={cn("mt-1 text-xs", toneClass(position.totalPnlUsd ?? null))}>
                        {(position.totalPnlUsd ?? 0) >= 0 ? "+" : ""}${(position.totalPnlUsd ?? 0).toLocaleString()}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="rounded-[22px] border border-dashed border-white/12 bg-white/[0.02] px-4 py-10 text-center text-sm text-white/54">
                {isOwnProfile
                  ? "Connect or sync a wallet snapshot to populate the portfolio board."
                  : "This trader does not currently expose a public wallet snapshot."}
              </div>
            )}
          </OverviewCard>

          <div className="space-y-4">
            <OverviewCard eyebrow="Balances" title="Capital profile">
              <div className="grid gap-3">
                <div className="rounded-[22px] border border-white/8 bg-white/[0.03] px-4 py-3">
                  <div className="text-[11px] uppercase tracking-[0.2em] text-white/34">Wallet</div>
                  <div className="mt-2 text-sm font-semibold text-white">
                    {hub.portfolioSnapshot?.address
                      ? `${hub.portfolioSnapshot.address.slice(0, 6)}...${hub.portfolioSnapshot.address.slice(-4)}`
                      : "Unavailable"}
                  </div>
                </div>
                <div className="rounded-[22px] border border-white/8 bg-white/[0.03] px-4 py-3">
                  <div className="text-[11px] uppercase tracking-[0.2em] text-white/34">Balance</div>
                  <div className="mt-2 text-sm font-semibold text-white">
                    ${((hub.portfolioSnapshot?.balanceUsd ?? 0) || 0).toLocaleString()}
                  </div>
                </div>
                <div className="rounded-[22px] border border-white/8 bg-white/[0.03] px-4 py-3">
                  <div className="text-[11px] uppercase tracking-[0.2em] text-white/34">SOL</div>
                  <div className="mt-2 text-sm font-semibold text-white">
                    {(hub.portfolioSnapshot?.balanceSol ?? 0).toLocaleString(undefined, { maximumFractionDigits: 3 })}
                  </div>
                </div>
              </div>
            </OverviewCard>
          </div>
        </div>
      ) : null}

      {profileTab === "badges" ? (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_360px]">
          <OverviewCard eyebrow="Badges" title="Proof of reputation">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {hub.badges.length ? hub.badges.map((badge) => (
                <div
                  key={badge.id}
                  className={cn(
                    "rounded-[22px] border px-4 py-5 text-center",
                    badge.tone === "xp" && "border-lime-300/25 bg-lime-300/10 text-lime-200",
                    badge.tone === "live" && "border-cyan-300/25 bg-cyan-300/10 text-cyan-200",
                    badge.tone !== "xp" && badge.tone !== "live" && "border-white/10 bg-white/[0.04] text-white/74"
                  )}
                >
                  <div className="text-sm font-semibold capitalize">{badge.label}</div>
                  <div className="mt-2 text-[11px] uppercase tracking-[0.16em] opacity-70">{badge.tone}</div>
                </div>
              )) : (
                <div className="rounded-[22px] border border-dashed border-white/12 bg-white/[0.02] px-4 py-10 text-center text-sm text-white/54">
                  No verified badge cluster is available yet.
                </div>
              )}
            </div>
          </OverviewCard>
          <div className="space-y-4">
            <OverviewCard eyebrow="Badge Inputs" title="How reputation is earned">
              <div className="space-y-3">
                {signalStats.map((metric) => (
                  <MetricListRow key={metric.label} label={metric.label} value={metric.value} />
                ))}
              </div>
            </OverviewCard>
          </div>
        </div>
      ) : null}

      {profileTab === "activity" ? (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_360px]">
          <OverviewCard eyebrow="Activity" title="Calls, raids, and profile momentum">
            <div className="space-y-3">
              {recentActivity.length ? recentActivity.map((item) => (
                <div
                  key={item.id}
                  className="flex items-start justify-between gap-4 rounded-[20px] border border-white/8 bg-white/[0.03] px-4 py-3"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={cn(
                          "rounded-full border px-2.5 py-0.5 text-[10px] uppercase tracking-[0.16em]",
                          item.type === "call"
                            ? "border-lime-300/18 bg-lime-300/10 text-lime-200"
                            : "border-cyan-300/18 bg-cyan-300/10 text-cyan-200"
                        )}
                      >
                        {item.type === "call" ? "Signal" : "Raid"}
                      </span>
                      <div className="truncate text-sm font-semibold text-white">{item.label}</div>
                    </div>
                    <div className="mt-1 text-xs text-white/46">{item.meta}</div>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className={cn("text-sm font-semibold", item.tone)}>{item.value}</div>
                    <div className="mt-1 text-[11px] uppercase tracking-[0.16em] text-white/34">{item.dateLabel}</div>
                  </div>
                </div>
              )) : (
                <div className="rounded-[20px] border border-dashed border-white/12 bg-white/[0.02] px-4 py-10 text-sm text-white/54">
                  Activity will appear here when calls or raid participation become visible on this profile.
                </div>
              )}
            </div>
          </OverviewCard>
          <div className="space-y-4">
            {statsAside}
            <OverviewCard eyebrow="Reputation Metrics" title="Signal breakdown">
            <div className="grid gap-3 md:grid-cols-2">
              {hub.reputationMetrics.map((metric) => (
                <div key={`${metric.label}:${metric.value}`} className="rounded-[22px] border border-white/8 bg-white/[0.03] px-4 py-4">
                  <div className="text-[11px] uppercase tracking-[0.2em] text-white/34">{metric.label}</div>
                  <div className="mt-2 text-[1.8rem] font-semibold leading-none text-white">{metric.value}</div>
                </div>
              ))}
              <div className="rounded-[22px] border border-white/8 bg-white/[0.03] px-4 py-4">
                <div className="text-[11px] uppercase tracking-[0.2em] text-white/34">Signal ROI</div>
                <div className={cn("mt-2 text-[1.8rem] font-semibold leading-none", toneClass(hub.performanceSummary.totalProfitPercent))}>
                  {typeof hub.performanceSummary.totalProfitPercent === "number"
                    ? `${hub.performanceSummary.totalProfitPercent >= 0 ? "+" : ""}${hub.performanceSummary.totalProfitPercent.toFixed(1)}%`
                    : "Tracking"}
                </div>
              </div>
              <div className="rounded-[22px] border border-white/8 bg-white/[0.03] px-4 py-4">
                <div className="text-[11px] uppercase tracking-[0.2em] text-white/34">Raid Impact</div>
                <div className="mt-2 text-[1.8rem] font-semibold leading-none text-white">{hub.raidImpact.contributionScore}</div>
              </div>
            </div>
          </OverviewCard>
            <OverviewCard eyebrow="Status" title="Profile posture">
              <div className="grid gap-3">
                {[
                  { icon: <Users className="h-5 w-5 text-lime-300" />, label: `${formatCompact(hub.hero.followersCount)} followers`, copy: "Audience and trader attention already attached to this profile." },
                  { icon: <Target className="h-5 w-5 text-cyan-300" />, label: `${hub.performanceSummary.totalCalls} calls`, copy: "Tracked results used in rank, feed, and token-context surfaces." },
                  { icon: <ShieldCheck className="h-5 w-5 text-lime-300" />, label: `${Math.round(hub.performanceSummary.winRate ?? 0)}% win rate`, copy: "Trust band reinforced by settled call outcomes." },
                  { icon: <Wallet className="h-5 w-5 text-cyan-300" />, label: hub.portfolioSnapshot?.connected ? "Wallet linked" : "Wallet quiet", copy: "Portfolio visibility depends on the linked or public wallet snapshot." },
                  { icon: <Trophy className="h-5 w-5 text-lime-300" />, label: `Level ${hub.xp.level}`, copy: "XP progress remains part of the unified identity system." },
                  { icon: <Sparkles className="h-5 w-5 text-cyan-300" />, label: hub.aiScore.percentile ?? hub.aiScore.label, copy: "AI trader score is derived from the live profile-hub aggregate." },
                ].map((item) => (
                  <div key={item.label} className="flex items-start gap-3 rounded-[22px] border border-white/8 bg-white/[0.03] px-4 py-3">
                    <div className="mt-0.5">{item.icon}</div>
                    <div>
                      <div className="text-sm font-semibold text-white">{item.label}</div>
                      <div className="mt-1 text-xs leading-6 text-white/48">{item.copy}</div>
                    </div>
                  </div>
                ))}
              </div>
            </OverviewCard>
          </div>
        </div>
      ) : null}
    </div>
  );
}
