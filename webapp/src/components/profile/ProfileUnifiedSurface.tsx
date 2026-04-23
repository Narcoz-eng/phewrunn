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

export type SharedProfileTab = "overview" | "calls" | "raids" | "portfolio" | "stats";

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
        "flex min-w-0 items-center justify-center gap-2 rounded-full border px-4 py-3 text-sm font-medium transition-colors",
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
      <div className="mt-2 text-[1.8rem] font-semibold leading-none text-white">{value}</div>
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
  const favoriteTokens = (hub.portfolioSnapshot?.tokenPositions ?? [])
    .slice(0, 5)
    .map((position) => ({
      id: position.mint,
      label: position.tokenSymbol ? `$${position.tokenSymbol}` : position.tokenName || "Token",
      value:
        typeof position.totalPnlUsd === "number" && Number.isFinite(position.totalPnlUsd)
          ? `${position.totalPnlUsd >= 0 ? "+" : ""}$${Math.abs(position.totalPnlUsd).toLocaleString()}`
          : `${Math.round(position.holdingUsd ?? 0).toLocaleString()} USD`,
      tone:
        typeof position.totalPnlUsd === "number" && Number.isFinite(position.totalPnlUsd)
          ? position.totalPnlUsd >= 0
            ? "text-lime-300"
            : "text-rose-300"
          : "text-white",
    }));
  const signalStats = [
    { label: "Followers", value: formatCompact(hub.hero.followersCount) },
    { label: "Calls Shared", value: formatCompact(hub.performanceSummary.totalCalls) },
    { label: "Raids Joined", value: formatCompact(hub.raidImpact.raidsJoined) },
    { label: "Boost Count", value: formatCompact(hub.raidImpact.boostCount) },
    { label: "Raid Wins", value: formatCompact(hub.raidImpact.raidsWon) },
    { label: "Contribution", value: formatCompact(hub.raidImpact.contributionScore) },
  ];

  return (
    <div className="space-y-5 pb-24">
      <section className="overflow-hidden rounded-[34px] border border-white/8 bg-[#080b12] shadow-[0_26px_90px_rgba(0,0,0,0.32)]">
        <div className="relative px-5 pb-6 pt-5 sm:px-6">
          {hub.hero.bannerImage ? (
            <div className="absolute inset-x-0 top-0 h-[240px] overflow-hidden">
              <div
                className="absolute inset-0 bg-cover bg-center opacity-35"
                style={{ backgroundImage: `url("${hub.hero.bannerImage}")` }}
              />
              <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(2,5,8,0.2),rgba(2,5,8,0.88)),radial-gradient(circle_at_14%_8%,rgba(163,230,53,0.26),transparent_28%),radial-gradient(circle_at_80%_10%,rgba(34,211,238,0.22),transparent_28%)]" />
            </div>
          ) : (
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_18%_0%,rgba(163,230,53,0.22),transparent_30%),radial-gradient(circle_at_80%_0%,rgba(34,211,238,0.18),transparent_30%),linear-gradient(180deg,rgba(255,255,255,0.03),rgba(255,255,255,0))]" />
          )}
          <div className="relative">
          <div className="rounded-[28px] border border-white/8 bg-[radial-gradient(circle_at_top_left,rgba(169,255,52,0.12),transparent_32%),linear-gradient(180deg,rgba(6,10,15,0.72),rgba(3,6,10,0.82))] px-4 py-3 text-[11px] uppercase tracking-[0.26em] text-white/68">
            <span className="text-lime-300">Phew.run</span>
            <span className="ml-3 text-white/48">A phew running the internet</span>
          </div>

          <div className="mt-5 flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
            <div className="flex min-w-0 flex-1 items-start gap-4">
              <Avatar className="h-24 w-24 shrink-0 rounded-[28px] border border-lime-300/25 shadow-[0_0_0_1px_rgba(163,230,53,0.12)]">
                <AvatarImage src={avatarUrl} alt={hub.hero.name ?? hub.hero.username ?? "Trader"} />
                <AvatarFallback className="rounded-[28px] bg-white/5 text-2xl text-white">
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
                    {hub.reputationMetrics.winRateLabel ?? "Legend"}
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-3">
                  <h1 className="min-w-0 truncate text-[2.25rem] font-semibold leading-none text-white sm:text-[3rem]">
                    {hub.hero.name ?? hub.hero.username ?? "Trader"}
                  </h1>
                  {hub.hero.username ? (
                    <span className="rounded-2xl border border-white/8 bg-white/[0.04] px-3 py-1.5 text-base text-white/70">
                      @{hub.hero.username}
                    </span>
                  ) : null}
                  {hub.hero.isVerified ? <VerifiedBadge className="h-5 w-5 text-cyan-300" /> : null}
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-3 text-sm text-white/62">
                  <span className="inline-flex items-center gap-1.5">
                    <CalendarDays className="h-4 w-4 text-white/38" />
                    Joined {formatJoinDate(hub.hero.createdAt)}
                  </span>
                  <span>{isOwnProfile ? "Your reputation surface" : "Public trader profile"}</span>
                  <span>{earnedLabel}</span>
                </div>

                {hub.hero.bio ? (
                  <p className="mt-4 max-w-3xl text-[1rem] leading-7 text-white/72">{hub.hero.bio}</p>
                ) : (
                  <p className="mt-4 max-w-3xl text-[1rem] leading-7 text-white/58">
                    Building. Trading. Winning. A reputation surface driven by calls, performance, raid impact, and signal quality.
                  </p>
                )}

                <div className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-4">
                  <HeroMetric label="Following" value={formatCompact(hub.hero.followingCount)} />
                  <HeroMetric label="Followers" value={formatCompact(hub.hero.followersCount)} />
                  <HeroMetric label="Wins" value={formatCompact(hub.performanceSummary.winCount)} />
                  <HeroMetric label="$PHEW Earned" value={formatCompact(hub.hero.earnedPoints)} />
                </div>

                <div className="mt-5 max-w-xl rounded-[24px] border border-white/8 bg-white/[0.03] p-4">
                  <div className="flex items-center justify-between text-xs uppercase tracking-[0.22em] text-white/44">
                    <span>{hub.xp.xp.toLocaleString()} XP</span>
                    <span>Next band {hub.xp.nextLevelXp.toLocaleString()}</span>
                  </div>
                  <div className="mt-3 h-3 overflow-hidden rounded-full bg-white/8">
                    <div
                      className="h-full rounded-full bg-[linear-gradient(90deg,#b9ff2f,#1fe4c6)] shadow-[0_0_20px_rgba(31,228,198,0.28)]"
                      style={{ width: `${hub.xp.progressPct}%` }}
                    />
                  </div>
                </div>
              </div>
            </div>

            <div className="grid gap-3 lg:w-[360px]">
              <div className="rounded-[26px] border border-white/8 bg-[radial-gradient(circle_at_top_left,rgba(169,255,52,0.1),transparent_34%),linear-gradient(180deg,rgba(7,10,15,0.98),rgba(4,7,11,0.98))] p-4">
                <div className="flex items-center justify-between gap-4">
                  <div className="min-w-0">
                    <div className="text-[11px] uppercase tracking-[0.22em] text-white/38">Level {hub.xp.level}</div>
                    <div className="mt-3 text-[1.1rem] font-semibold text-white">
                      {hub.xp.xp.toLocaleString()} / {hub.xp.nextLevelXp.toLocaleString()} XP
                    </div>
                    <div className="mt-2 text-sm text-white/52">Progression tracks live calls, raid pressure, and trader reputation.</div>
                  </div>
                  <div className="rounded-[20px] border border-lime-300/18 bg-lime-300/10 px-3 py-2 text-sm font-semibold text-lime-200">
                    {hub.xp.progressPct.toFixed(0)}%
                  </div>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-[24px] border border-white/8 bg-[#090d15] p-4">
                  <div className="text-[11px] uppercase tracking-[0.22em] text-white/38">AI Trader Score</div>
                  <div className="mt-3 text-[2.5rem] font-semibold leading-none text-white">
                    {hub.aiScore.score?.toFixed(1) ?? "0.0"}
                  </div>
                  <div className="mt-2 text-sm text-white/54">{hub.aiScore.percentile ?? hub.aiScore.label}</div>
                </div>
                <div className="rounded-[24px] border border-white/8 bg-[#090d15] p-4">
                  <div className="text-[11px] uppercase tracking-[0.22em] text-white/38">Top Calls</div>
                  <div className="mt-3 text-[2.5rem] font-semibold leading-none text-white">{hub.topCalls.length}</div>
                  <div className="mt-2 text-sm text-white/54">Recent high-signal setups</div>
                </div>
              </div>
              {heroActions ? <div className="flex flex-wrap justify-end gap-2">{heroActions}</div> : null}
            </div>
          </div>
          </div>
        </div>
      </section>

      <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
        {[
          { label: "Following", value: formatCompact(hub.hero.followingCount), hint: "Network graph" },
          { label: "Followers", value: formatCompact(hub.hero.followersCount), hint: "Social reputation" },
          { label: "X Score", value: hub.aiScore.score?.toFixed(1) ?? "0.0", hint: "AI trader score" },
          { label: "Total Calls", value: formatCompact(hub.performanceSummary.totalCalls), hint: "Signal history" },
          { label: "Win Rate", value: `${hub.performanceSummary.winRate?.toFixed(0) ?? "0"}%`, hint: "Call board only" },
          {
            label: "Wallet Snapshot",
            value: hub.portfolioSnapshot?.connected ? `$${Math.round(hub.portfolioSnapshot.balanceUsd ?? 0).toLocaleString()}` : "Not linked",
            hint: "Portfolio board only",
          },
        ].map((metric) => (
          <div key={metric.label} className="rounded-[24px] border border-white/8 bg-[linear-gradient(180deg,rgba(9,13,20,0.98),rgba(5,9,13,0.98))] px-4 py-4">
            <div className="text-[11px] uppercase tracking-[0.2em] text-white/36">{metric.label}</div>
            <div className="mt-2 text-[1.6rem] font-semibold leading-none text-white">{metric.value}</div>
            <div className="mt-2 text-xs text-white/44">{metric.hint}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <ProfileTabButton active={profileTab === "overview"} label="Overview" onClick={() => onProfileTabChange("overview")} />
        <ProfileTabButton active={profileTab === "calls"} label="Calls" badge={callBadge} onClick={() => onProfileTabChange("calls")} />
        <ProfileTabButton active={profileTab === "raids"} label="X Raids" badge={raidBadge} onClick={() => onProfileTabChange("raids")} />
        <ProfileTabButton active={profileTab === "portfolio"} label="Portfolio" badge={portfolioBadge} onClick={() => onProfileTabChange("portfolio")} />
        <ProfileTabButton active={profileTab === "stats"} label="Stats" onClick={() => onProfileTabChange("stats")} />
      </div>

      {profileTab === "overview" ? (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_380px]">
          <div className="space-y-4">
            <div className="grid gap-4 xl:grid-cols-[minmax(0,0.88fr)_minmax(0,1.12fr)]">
              <OverviewCard eyebrow="About Me" title="Trader identity">
                <div className="space-y-4">
                  <p className="text-sm leading-7 text-white/66">
                    {hub.hero.bio ||
                      "I call high-conviction setups, build raid pressure, and stay focused on reputation-backed execution."}
                  </p>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <MetricListRow label="Handle" value={hub.hero.username ? `@${hub.hero.username}` : "Unlisted"} />
                    <MetricListRow label="Joined" value={formatJoinDate(hub.hero.createdAt)} />
                    <MetricListRow
                      label="Verification"
                      value={hub.hero.isVerified ? "Verified trader" : "Open profile"}
                      tone={hub.hero.isVerified ? "text-cyan-300" : undefined}
                    />
                    <MetricListRow
                      label="AI posture"
                      value={hub.aiScore.percentile ?? hub.aiScore.label}
                      tone="text-lime-300"
                    />
                  </div>
                </div>
              </OverviewCard>

              <OverviewCard eyebrow="Call Performance" title="Signal performance">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className={cn("text-[3rem] font-semibold leading-none", toneClass(totalProfitPercent))}>
                      {performanceLabel}
                    </div>
                    <div className="mt-2 max-w-xl text-sm leading-6 text-white/52">
                      {hub.performanceSummary.totalCalls} settled calls tracked with reputation and raid context. This module is call-based only and does not imply wallet profit.
                    </div>
                  </div>
                  <div className="flex flex-wrap justify-end gap-2">
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
                <div className="mt-5 overflow-hidden rounded-[24px] border border-white/8 bg-[linear-gradient(180deg,rgba(14,18,34,0.98),rgba(8,10,18,0.98))] px-2 pb-2 pt-5">
                  <div className="flex items-center justify-between gap-4 px-4">
                    <div className="text-[10px] uppercase tracking-[0.22em] text-white/34">
                      {performanceVm?.chartLabel ?? "Performance curve"}
                    </div>
                    <div className="rounded-full border border-lime-300/16 bg-lime-300/10 px-3 py-1 text-[10px] uppercase tracking-[0.18em] text-lime-200">
                      Call ROI
                    </div>
                  </div>
                  <svg viewBox="0 0 100 42" className="mt-3 h-[220px] w-full" preserveAspectRatio="none">
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
                <div className="mt-4 grid gap-3 sm:grid-cols-3">
                  <MetricListRow label="Tracked Calls" value={formatCompact(hub.performanceSummary.totalCalls)} />
                  <MetricListRow
                    label="Win Rate"
                    value={`${hub.performanceSummary.winRate?.toFixed(0) ?? "0"}%`}
                    tone="text-lime-300"
                  />
                  <MetricListRow label="Performance Type" value="Call-based" tone="text-cyan-300" />
                </div>
              </OverviewCard>
            </div>

            <OverviewCard eyebrow="Wallet Snapshot" title="Portfolio state">
              <div className="grid gap-4 lg:grid-cols-[minmax(0,0.86fr)_minmax(0,1.14fr)]">
                <div className="space-y-3">
                  <div className="rounded-[22px] border border-white/8 bg-white/[0.03] px-4 py-4">
                    <div className="text-[11px] uppercase tracking-[0.18em] text-white/34">Wallet</div>
                    <div className="mt-2 text-lg font-semibold text-white">
                      {hub.portfolioSnapshot?.address
                        ? `${hub.portfolioSnapshot.address.slice(0, 6)}...${hub.portfolioSnapshot.address.slice(-4)}`
                        : "Unavailable"}
                    </div>
                  </div>
                  <div className="rounded-[22px] border border-white/8 bg-white/[0.03] px-4 py-4">
                    <div className="text-[11px] uppercase tracking-[0.18em] text-white/34">Wallet performance</div>
                    <div className="mt-2 text-[2rem] font-semibold leading-none text-white">
                      ${((hub.portfolioSnapshot?.balanceUsd ?? 0) || 0).toLocaleString()}
                    </div>
                    <div className="mt-2 text-sm text-white/50">
                      This panel reflects the linked or public wallet snapshot only and is intentionally separate from call ROI.
                    </div>
                  </div>
                </div>
                <div className="grid gap-3 sm:grid-cols-3">
                  <MetricListRow
                    label="SOL Balance"
                    value={(hub.portfolioSnapshot?.balanceSol ?? 0).toLocaleString(undefined, { maximumFractionDigits: 3 })}
                  />
                  <MetricListRow
                    label="Positions"
                    value={formatCompact(hub.portfolioSnapshot?.tokenPositions.length ?? 0)}
                  />
                  <MetricListRow
                    label="State"
                    value={hub.portfolioSnapshot?.connected ? "Wallet linked" : "Snapshot unavailable"}
                    tone={hub.portfolioSnapshot?.connected ? "text-cyan-300" : undefined}
                  />
                </div>
              </div>
            </OverviewCard>

            {primaryCall ? (
              <OverviewCard eyebrow="Pinned Call" title="Highest-signal recent setup">
                <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-full border border-lime-300/18 bg-lime-300/10 px-3 py-1 text-[11px] uppercase tracking-[0.16em] text-lime-200">
                        {primaryCall.ticker ? `$${primaryCall.ticker}` : "Tracked call"}
                      </span>
                      <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-[11px] uppercase tracking-[0.16em] text-white/58">
                        Call Performance
                      </span>
                    </div>
                    <div className="mt-4 text-2xl font-semibold tracking-[-0.04em] text-white">
                      {primaryCall.title || "High-conviction call"}
                    </div>
                    <div className="mt-3 grid gap-3 sm:grid-cols-3">
                      <MetricListRow
                        label="Current ROI"
                        value={
                          typeof primaryCall.roiCurrentPct === "number"
                            ? `${primaryCall.roiCurrentPct >= 0 ? "+" : ""}${primaryCall.roiCurrentPct.toFixed(1)}%`
                            : "Tracking"
                        }
                        tone={toneClass(primaryCall.roiCurrentPct)}
                      />
                      <MetricListRow
                        label="Peak ROI"
                        value={
                          typeof primaryCall.roiPeakPct === "number"
                            ? `${primaryCall.roiPeakPct >= 0 ? "+" : ""}${primaryCall.roiPeakPct.toFixed(1)}%`
                            : "Tracking"
                        }
                        tone={toneClass(primaryCall.roiPeakPct)}
                      />
                      <MetricListRow label="Logged" value={formatJoinDate(primaryCall.createdAt)} />
                    </div>
                  </div>
                  <div className="w-full rounded-[24px] border border-white/8 bg-[linear-gradient(180deg,rgba(169,255,52,0.08),rgba(45,212,191,0.04))] p-4 lg:max-w-[320px]">
                    <div className="text-[11px] uppercase tracking-[0.2em] text-white/38">Call context</div>
                    <div className="mt-4 space-y-3">
                      <MetricListRow label="Classification" value="High-signal call" tone="text-lime-300" />
                      <MetricListRow label="Performance Type" value="Signal ROI" tone="text-cyan-300" />
                      <MetricListRow label="Usage" value="Reputation and call ranking" />
                    </div>
                    <div className="mt-4 rounded-[18px] border border-white/8 bg-[#0a1016] px-4 py-3 text-xs leading-6 text-white/48">
                      This module tracks the published setup itself. It does not represent wallet profit unless a separate wallet panel says so.
                    </div>
                  </div>
                </div>
              </OverviewCard>
            ) : null}

            <OverviewCard eyebrow="Top Calls" title="Best recent setups">
              <div className="space-y-3">
                {hub.topCalls.length ? hub.topCalls.map((call) => (
                  <div key={call.id} className="flex items-center justify-between gap-4 rounded-[22px] border border-white/8 bg-white/[0.03] px-4 py-3">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold text-white">
                        {call.ticker ? `$${call.ticker}` : call.title || "Tracked call"}
                      </div>
                      <div className="mt-1 truncate text-xs text-white/44">
                        {call.title || "High-signal call tracked in performance history"}
                      </div>
                    </div>
                    <div className={cn("shrink-0 text-sm font-semibold", toneClass(call.roiCurrentPct ?? call.roiPeakPct ?? null))}>
                      {typeof (call.roiCurrentPct ?? call.roiPeakPct) === "number"
                        ? `${(call.roiCurrentPct ?? call.roiPeakPct ?? 0) >= 0 ? "+" : ""}${(call.roiCurrentPct ?? call.roiPeakPct ?? 0).toFixed(1)}%`
                        : "Tracking"}
                    </div>
                  </div>
                )) : (
                  <div className="text-sm text-white/56">No ranked calls yet.</div>
                )}
              </div>
            </OverviewCard>
          </div>

          <div className="space-y-4">
            {statsAside}

            <SideRailCard eyebrow="User Level" title={hub.reputationMetrics.find((metric) => /tier|rank|reputation/i.test(metric.label))?.value ?? "Legend"}>
              <div className="space-y-4">
                <div>
                  <div className="text-sm text-white/58">Level {hub.xp.level}</div>
                  <div className="mt-2 text-lg font-semibold text-white">
                    {hub.xp.xp.toLocaleString()} / {hub.xp.nextLevelXp.toLocaleString()} XP
                  </div>
                </div>
                <div className="h-3 overflow-hidden rounded-full bg-white/8">
                  <div
                    className="h-full rounded-full bg-[linear-gradient(90deg,#b9ff2f,#1fe4c6)] shadow-[0_0_22px_rgba(31,228,198,0.28)]"
                    style={{ width: `${hub.xp.progressPct}%` }}
                  />
                </div>
                <div className="rounded-[20px] border border-lime-300/16 bg-lime-300/8 px-4 py-3">
                  <div className="text-[11px] uppercase tracking-[0.18em] text-white/40">Next Reward</div>
                  <div className="mt-2 text-sm font-semibold text-lime-200">Level {nextRewardLevel}</div>
                  <div className="mt-1 text-sm text-white/56">{nextRewardXp.toLocaleString()} XP to unlock</div>
                </div>
              </div>
            </SideRailCard>

            <SideRailCard eyebrow="Top Badges" title="Badge stack">
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

            <SideRailCard eyebrow="Community Stats" title="Reputation board">
              <div className="space-y-3">
                {signalStats.map((metric) => (
                  <MetricListRow key={metric.label} label={metric.label} value={metric.value} />
                ))}
              </div>
            </SideRailCard>

            <SideRailCard eyebrow="Favorite Tokens" title="Wallet focus">
              <div className="space-y-3">
                {favoriteTokens.length ? favoriteTokens.map((token) => (
                  <div key={token.id} className="flex items-center justify-between gap-3 rounded-[18px] border border-white/8 bg-white/[0.03] px-4 py-3">
                    <div className="text-sm font-semibold text-white">{token.label}</div>
                    <div className={cn("text-sm font-semibold", token.tone)}>{token.value}</div>
                  </div>
                )) : (
                  <div className="text-sm text-white/56">Connect a wallet snapshot to surface favorite tokens here.</div>
                )}
              </div>
            </SideRailCard>

            <SideRailCard eyebrow="Recent Raids" title="Campaign footprint">
              <div className="space-y-3">
                {hub.raidHistory.length ? hub.raidHistory.slice(0, 4).map((raid) => (
                  <a
                    key={raid.id}
                    href={`/raids/${raid.tokenAddress}/${raid.id}`}
                    className="block rounded-[18px] border border-white/8 bg-white/[0.03] px-4 py-3 transition-colors hover:bg-white/[0.06]"
                  >
                    <div className="text-sm font-semibold text-white">
                      {raid.tokenSymbol ? `$${raid.tokenSymbol}` : raid.tokenName || "Raid"}
                    </div>
                    <div className="mt-1 text-xs text-white/44">{raid.objective}</div>
                    <div className="mt-2 text-[11px] uppercase tracking-[0.18em] text-white/34">
                      {raid.status} • {raid.boostCount} boosts
                    </div>
                  </a>
                )) : (
                  <div className="text-sm text-white/56">No raid history is visible yet.</div>
                )}
              </div>
            </SideRailCard>
          </div>
        </div>
      ) : null}

      {profileTab === "calls" ? callsContent : null}

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

      {profileTab === "stats" ? (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_360px]">
          <OverviewCard eyebrow="Reputation Metrics" title="Signal breakdown">
            <div className="grid gap-3 md:grid-cols-2">
              {hub.reputationMetrics.map((metric) => (
                <div key={`${metric.label}:${metric.value}`} className="rounded-[22px] border border-white/8 bg-white/[0.03] px-4 py-4">
                  <div className="text-[11px] uppercase tracking-[0.2em] text-white/34">{metric.label}</div>
                  <div className="mt-2 text-[1.8rem] font-semibold leading-none text-white">{metric.value}</div>
                </div>
              ))}
              <div className="rounded-[22px] border border-white/8 bg-white/[0.03] px-4 py-4">
                <div className="text-[11px] uppercase tracking-[0.2em] text-white/34">Total Profit</div>
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
          <div className="space-y-4">
            {statsAside}
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
