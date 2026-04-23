import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  Activity,
  BrainCircuit,
  Coins,
  Flame,
  LineChart,
  Radar,
  ShieldCheck,
  Trophy,
  Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth, useSession } from "@/lib/auth-client";
import { api } from "@/lib/api";
import { buildProfilePath } from "@/lib/profile-path";
import { readSessionCache, writeSessionCache } from "@/lib/session-cache";
import { DenseLeaderboardView } from "@/components/experience/TraderPerformanceView";
import {
  buildLeaderboardRowsVm,
  buildPinnedRankVm,
  type LeaderboardPinnedRankVM,
  type LeaderboardRowVM,
  type PerformancePeriod,
} from "@/viewmodels/trader-performance";
import { cn } from "@/lib/utils";
import { getAvatarUrl, type User } from "@/types";
import { V2PageHeader } from "@/components/layout/V2PageHeader";
import { V2MetricCard } from "@/components/ui/v2/V2MetricCard";
import { V2StatusPill } from "@/components/ui/v2/V2StatusPill";
import { V2Surface } from "@/components/ui/v2/V2Surface";
import { V2TabBar } from "@/components/ui/v2/V2TabBar";

type LeaderboardBoard = "calls" | "wallet" | "raids" | "xp";

type PerformanceLeaderboardEntry = {
  rank: number;
  user: {
    id: string;
    username: string | null;
    name: string;
    image: string | null;
    isVerified?: boolean;
  };
  performance: {
    avgRoi: number | null;
    winRate: number | null;
    trustScore: number | null;
    callsCount: number;
    settledCount: number;
    firstCallCount: number;
  };
  recentTokens: Array<{
    address: string;
    symbol: string | null;
    image: string | null;
  }>;
};

type PerformanceResponse = {
  data: PerformanceLeaderboardEntry[];
  meta?: {
    currentUser?: PerformanceLeaderboardEntry | null;
  } | null;
};

type TopUserEntry = {
  rank: number;
  user: {
    id: string;
    username: string | null;
    name: string;
    image: string | null;
    level: number;
    xp: number;
    isVerified?: boolean;
  };
  stats: {
    totalAlphas: number;
    recentAlphas?: number;
    wins: number;
    losses: number;
    winRate: number;
  };
};

type TopUsersResponse = {
  data: TopUserEntry[];
};

function formatCompact(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "0";
  return new Intl.NumberFormat("en-US", {
    notation: value >= 1000 ? "compact" : "standard",
    maximumFractionDigits: value >= 1000 ? 1 : 0,
  }).format(value);
}

function formatSignedPercent(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "--";
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}

function buildTopUsersCacheKey(kind: string): string {
  return `phew.leaderboard.${kind}:v2`;
}

function mapActivityRows(entries: TopUserEntry[]): LeaderboardRowVM[] {
  return entries.map((entry) => ({
    id: entry.user.id,
    rank: entry.rank,
    displayName: entry.user.username || entry.user.name,
    handle: entry.user.username ? `@${entry.user.username}` : null,
    avatarUrl: getAvatarUrl(entry.user.id, entry.user.image),
    avatarFallback: (entry.user.name || entry.user.username || "?").charAt(0).toUpperCase(),
    metadataLabel: `${entry.stats.wins} wins • ${entry.stats.recentAlphas ?? entry.stats.totalAlphas} live pushes`,
    valueLabel: `${entry.stats.recentAlphas ?? entry.stats.totalAlphas}`,
    valueTone: "neutral",
    changeLabel: `${entry.stats.winRate.toFixed(1)}% win rate`,
    changeTone: entry.stats.winRate >= 55 ? "gain" : entry.stats.winRate >= 40 ? "neutral" : "loss",
    recentTokens: [],
  }));
}

function mapXpRows(entries: TopUserEntry[]): LeaderboardRowVM[] {
  return entries.map((entry) => ({
    id: entry.user.id,
    rank: entry.rank,
    displayName: entry.user.username || entry.user.name,
    handle: entry.user.username ? `@${entry.user.username}` : null,
    avatarUrl: getAvatarUrl(entry.user.id, entry.user.image),
    avatarFallback: (entry.user.name || entry.user.username || "?").charAt(0).toUpperCase(),
    metadataLabel: `${entry.user.xp.toLocaleString()} XP`,
    valueLabel: `Lvl ${entry.user.level}`,
    valueTone: "neutral",
    changeLabel: `${entry.stats.totalAlphas} calls logged`,
    changeTone: "neutral",
    recentTokens: [],
  }));
}

export default function Leaderboard() {
  const navigate = useNavigate();
  const { data: session } = useSession();
  const { hasLiveSession } = useAuth();
  const [period, setPeriod] = useState<PerformancePeriod>("30d");
  const [board, setBoard] = useState<LeaderboardBoard>("calls");

  const sessionBackedUser = session?.user
    ? {
        id: session.user.id,
        name: session.user.name,
        email: session.user.email,
        image: session.user.image ?? null,
        walletAddress: session.user.walletAddress ?? null,
        username: session.user.username ?? null,
        level: session.user.level ?? 0,
        xp: session.user.xp ?? 0,
        bio: session.user.bio ?? null,
        isAdmin: session.user.isAdmin ?? false,
        isVerified: session.user.isVerified,
        createdAt: session.user.createdAt ?? new Date(0).toISOString(),
      }
    : null;

  const { data: currentUser } = useQuery({
    queryKey: ["currentUser", session?.user?.id ?? "anonymous"],
    queryFn: async () => await api.get<User>("/api/me"),
    initialData: sessionBackedUser ?? undefined,
    enabled: !!session?.user && hasLiveSession,
    staleTime: 5 * 60 * 1000,
    gcTime: 15 * 60 * 1000,
    refetchOnWindowFocus: false,
    retry: false,
  });

  const performanceCacheKey = buildTopUsersCacheKey(`performance:${period}`);
  const performanceCached = readSessionCache<PerformanceResponse>(performanceCacheKey, 10 * 60_000);
  const performanceQuery = useQuery({
    queryKey: ["leaderboard", "performance", period],
    queryFn: async () => {
      const response = await api.raw(`/api/leaderboard/performance?period=${period}&limit=100`);
      if (!response.ok) {
        throw new Error(`Failed to load leaderboard: ${response.status}`);
      }
      const payload = (await response.json()) as PerformanceResponse;
      if (payload.data.length > 0) {
        writeSessionCache(performanceCacheKey, payload);
      }
      return payload;
    },
    initialData: performanceCached ?? undefined,
    placeholderData: (previous) => previous ?? performanceCached ?? undefined,
    staleTime: 60_000,
    gcTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
    retry: 0,
  });

  const activityCacheKey = buildTopUsersCacheKey("activity");
  const activityCached = readSessionCache<TopUsersResponse>(activityCacheKey, 10 * 60_000);
  const activityQuery = useQuery({
    queryKey: ["leaderboard", "top-users", "activity"],
    queryFn: async () => {
      const response = await api.raw("/api/leaderboard/top-users?page=1&limit=100&sortBy=activity&period=week");
      if (!response.ok) {
        throw new Error(`Failed to load activity leaderboard: ${response.status}`);
      }
      const payload = (await response.json()) as TopUsersResponse;
      if (payload.data.length > 0) {
        writeSessionCache(activityCacheKey, payload);
      }
      return payload;
    },
    initialData: activityCached ?? undefined,
    placeholderData: (previous) => previous ?? activityCached ?? undefined,
    staleTime: 2 * 60 * 1000,
    gcTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
    retry: 0,
  });

  const xpCacheKey = buildTopUsersCacheKey("xp");
  const xpCached = readSessionCache<TopUsersResponse>(xpCacheKey, 10 * 60_000);
  const xpQuery = useQuery({
    queryKey: ["leaderboard", "top-users", "xp"],
    queryFn: async () => {
      const response = await api.raw("/api/leaderboard/top-users?page=1&limit=100&sortBy=level&period=week");
      if (!response.ok) {
        throw new Error(`Failed to load XP leaderboard: ${response.status}`);
      }
      const payload = (await response.json()) as TopUsersResponse;
      if (payload.data.length > 0) {
        writeSessionCache(xpCacheKey, payload);
      }
      return payload;
    },
    initialData: xpCached ?? undefined,
    placeholderData: (previous) => previous ?? xpCached ?? undefined,
    staleTime: 2 * 60 * 1000,
    gcTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
    retry: 0,
  });

  const callRows = useMemo(
    () => buildLeaderboardRowsVm(performanceQuery.data?.data ?? []),
    [performanceQuery.data?.data]
  );
  const raidRows = useMemo(
    () => mapActivityRows(activityQuery.data?.data ?? []),
    [activityQuery.data?.data]
  );
  const xpRows = useMemo(() => mapXpRows(xpQuery.data?.data ?? []), [xpQuery.data?.data]);

  const activeRows = board === "calls" ? callRows : board === "raids" ? raidRows : board === "xp" ? xpRows : [];
  const activeLoading =
    board === "calls"
      ? performanceQuery.isLoading
      : board === "raids"
        ? activityQuery.isLoading
        : board === "xp"
          ? xpQuery.isLoading
          : false;
  const activeFetching =
    board === "calls"
      ? performanceQuery.isFetching
      : board === "raids"
        ? activityQuery.isFetching
        : board === "xp"
          ? xpQuery.isFetching
          : false;

  const pinnedRank = useMemo<LeaderboardPinnedRankVM | null>(() => {
    if (board === "calls") {
      const exact = buildPinnedRankVm(performanceQuery.data?.meta?.currentUser ?? null, currentUser?.id ?? null);
      if (exact) return exact;
    }
    if (!currentUser) return null;
    if (board === "wallet") {
      return {
        title: "Your wallet state",
        rankLabel: currentUser.walletAddress ? "Snapshot linked" : "No linked wallet",
        valueLabel: currentUser.walletAddress ? "Portfolio board is separate from calls" : "Connect wallet to rank",
        valueTone: "neutral",
        avatarUrl: getAvatarUrl(currentUser.id, currentUser.image),
        avatarFallback: (currentUser.name || currentUser.username || "?").charAt(0).toUpperCase(),
      };
    }
    if (board === "xp") {
      return {
        title: "Your XP / level",
        rankLabel: `Level ${currentUser.level ?? 0}`,
        valueLabel: `${(currentUser.xp ?? 0).toLocaleString()} XP`,
        valueTone: "neutral",
        avatarUrl: getAvatarUrl(currentUser.id, currentUser.image),
        avatarFallback: (currentUser.name || currentUser.username || "?").charAt(0).toUpperCase(),
      };
    }
    return {
      title: "Your rank",
      rankLabel: currentUser.username ? `@${currentUser.username}` : currentUser.name,
      valueLabel: board === "raids" ? "Raid leadership separate from profitability" : "Separate board semantics",
      valueTone: "neutral",
      avatarUrl: getAvatarUrl(currentUser.id, currentUser.image),
      avatarFallback: (currentUser.name || currentUser.username || "?").charAt(0).toUpperCase(),
    };
  }, [board, currentUser, performanceQuery.data?.meta?.currentUser]);

  const boardCopy = useMemo(() => {
    switch (board) {
      case "wallet":
        return {
          eyebrow: "Wallet performance",
          title: "Portfolio Performance Board",
          subtitle:
            "Wallet and portfolio performance are intentionally separated from call performance. This board only ranks realized or snapshot-backed wallet state.",
          emptyTitle: "Wallet board stays separate from signal ROI",
          emptyBody:
            "No wallet-performance leaderboard is rendered from call data. The product now makes that separation explicit instead of implying portfolio profit from published calls.",
        };
      case "raids":
        return {
          eyebrow: "Raid leaders",
          title: "Raid / Community Leadership",
          subtitle:
            "Community pressure, coordination output, and live room momentum surface here. This board is not a profitability board.",
          emptyTitle: "Raid leadership is warming up",
          emptyBody: "Open raids and live room participation will surface here once enough activity is available.",
        };
      case "xp":
        return {
          eyebrow: "XP / level",
          title: "XP / Level Arena",
          subtitle:
            "Progression is ranked independently from call ROI and wallet performance so reputation, execution, and capital stay semantically separate.",
          emptyTitle: "XP arena is empty",
          emptyBody: "Level and XP rankings will appear here as profile progression data resolves.",
        };
      default:
        return {
          eyebrow: "Call performance",
          title: "Signal Performance Board",
          subtitle:
            "Ranked from settled call outcomes. This board measures published call performance only and does not imply wallet or portfolio profit.",
          emptyTitle: "Signal board is empty",
          emptyBody: "Settled calls will populate the board once enough ranked results are available.",
        };
    }
  }, [board]);

  const topMoverRows = useMemo(() => callRows.slice(0, 5), [callRows]);
  const raidLeaderRows = useMemo(() => raidRows.slice(0, 5), [raidRows]);
  const xpLeaderRows = useMemo(() => xpRows.slice(0, 5), [xpRows]);

  const leaderStats = useMemo(() => {
    const entries = performanceQuery.data?.data ?? [];
    const bestAvgRoi = entries.reduce((best, entry) => {
      const value = entry.performance.avgRoi ?? Number.NEGATIVE_INFINITY;
      return value > best ? value : best;
    }, Number.NEGATIVE_INFINITY);
    const totalSettledCalls = entries.reduce((sum, entry) => sum + entry.performance.settledCount, 0);
    const averageWinRate =
      entries.length > 0
        ? entries.reduce((sum, entry) => sum + (entry.performance.winRate ?? 0), 0) / entries.length
        : null;

    return [
      {
        label: "Tracked Traders",
        value: entries.length.toLocaleString(),
        hint: "Board-wide ranked rows",
        icon: Trophy,
      },
      {
        label: "Settled Calls",
        value: totalSettledCalls.toLocaleString(),
        hint: "Call board only",
        icon: Radar,
      },
      {
        label: "Best Avg Call ROI",
        value: Number.isFinite(bestAvgRoi) ? formatSignedPercent(bestAvgRoi) : "--",
        hint: "Signal performance, not wallet PnL",
        icon: LineChart,
      },
      {
        label: "Avg Win Rate",
        value: averageWinRate !== null ? `${averageWinRate.toFixed(1)}%` : "--",
        hint: "Across ranked callers",
        icon: BrainCircuit,
      },
    ];
  }, [performanceQuery.data?.data]);

  return (
    <div className="space-y-5 text-white">
      <V2PageHeader
        title="Leaderboard"
        description="An arena surface, not a generic table. Call performance, wallet state, raid leadership, and XP progression now live as separate boards instead of one mixed metric stack."
        badge={<V2StatusPill tone="xp">Competitive Surfaces</V2StatusPill>}
        action={
          <Button
            type="button"
            variant="ghost"
            className="rounded-2xl border border-white/10 bg-white/[0.04] text-white/72 hover:bg-white/[0.08] hover:text-white"
            onClick={() => navigate("/")}
          >
            Back to feed
          </Button>
        }
      />

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {leaderStats.map((stat) => {
          const Icon = stat.icon;
          return (
            <V2MetricCard
              key={stat.label}
              label={stat.label}
              value={stat.value}
              hint={stat.hint}
              accent={<Icon className="h-5 w-5 text-lime-300" />}
            />
          );
        })}
      </div>

      <V2Surface className="p-4 sm:p-5">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
          <V2TabBar
            value={board}
            onChange={setBoard}
            items={[
              { value: "calls", label: "Call Performance", badge: "Settled calls only" },
              { value: "wallet", label: "Wallet Performance", badge: "Portfolio PnL only" },
              { value: "raids", label: "Raid Leaders", badge: "Room pressure" },
              { value: "xp", label: "XP / Level", badge: "Progression board" },
            ]}
          />
          <V2TabBar
            value={period}
            onChange={(value) => setPeriod(value as PerformancePeriod)}
            items={[
              { value: "24h", label: "24H" },
              { value: "7d", label: "7D" },
              { value: "30d", label: "30D" },
              { value: "all", label: "All Time" },
            ]}
            className="xl:ml-auto"
          />
        </div>
      </V2Surface>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-4">
          {board === "wallet" ? (
            <V2Surface className="p-6">
              <div className="rounded-[30px] border border-amber-300/16 bg-[radial-gradient(circle_at_top_left,rgba(251,191,36,0.12),transparent_32%),linear-gradient(180deg,rgba(20,14,8,0.98),rgba(10,8,5,0.99))] p-6">
                <div className="flex flex-wrap items-center gap-2">
                  <V2StatusPill tone="risk">Portfolio Board</V2StatusPill>
                  <V2StatusPill tone="default">Semantically separate</V2StatusPill>
                </div>
                <h2 className="mt-4 text-3xl font-semibold tracking-tight text-white">
                  {boardCopy.emptyTitle}
                </h2>
                <p className="mt-3 max-w-3xl text-sm leading-6 text-white/60">
                  {boardCopy.emptyBody}
                </p>
                <div className="mt-6 grid gap-3 md:grid-cols-3">
                  <div className="rounded-[22px] border border-white/8 bg-black/20 px-4 py-4">
                    <div className="text-[10px] uppercase tracking-[0.18em] text-white/34">Call board</div>
                    <div className="mt-2 text-lg font-semibold text-white">Signal ROI</div>
                    <div className="mt-1 text-xs text-white/46">Based on published calls only</div>
                  </div>
                  <div className="rounded-[22px] border border-white/8 bg-black/20 px-4 py-4">
                    <div className="text-[10px] uppercase tracking-[0.18em] text-white/34">Wallet board</div>
                    <div className="mt-2 text-lg font-semibold text-white">Portfolio state</div>
                    <div className="mt-1 text-xs text-white/46">Requires wallet-backed snapshots</div>
                  </div>
                  <div className="rounded-[22px] border border-white/8 bg-black/20 px-4 py-4">
                    <div className="text-[10px] uppercase tracking-[0.18em] text-white/34">Why separate</div>
                    <div className="mt-2 text-lg font-semibold text-white">No false PnL</div>
                    <div className="mt-1 text-xs text-white/46">Signal hit rate never implies account profit</div>
                  </div>
                </div>
              </div>
            </V2Surface>
          ) : activeLoading ? (
            <V2Surface className="px-6 py-10 text-white/56">Loading leaderboard...</V2Surface>
          ) : (
            <div className={cn("transition-opacity", activeFetching && "opacity-80")}>
              <DenseLeaderboardView
                eyebrow={boardCopy.eyebrow}
                title={boardCopy.title}
                subtitle={boardCopy.subtitle}
                pinnedRank={pinnedRank}
                timeframeTabs={[
                  {
                    key: "24h",
                    label: "24H",
                    active: period === "24h",
                    onSelect: () => setPeriod("24h"),
                  },
                  {
                    key: "7d",
                    label: "7D",
                    active: period === "7d",
                    onSelect: () => setPeriod("7d"),
                  },
                  {
                    key: "30d",
                    label: "30D",
                    active: period === "30d",
                    onSelect: () => setPeriod("30d"),
                  },
                  {
                    key: "all",
                    label: "All Time",
                    active: period === "all",
                    onSelect: () => setPeriod("all"),
                  },
                ]}
                modeTabs={[
                  {
                    key: "calls",
                    label: "Calls",
                    active: board === "calls",
                    onSelect: () => setBoard("calls"),
                  },
                  {
                    key: "raids",
                    label: "Raids",
                    active: board === "raids",
                    onSelect: () => setBoard("raids"),
                  },
                  {
                    key: "xp",
                    label: "XP",
                    active: board === "xp",
                    onSelect: () => setBoard("xp"),
                  },
                ]}
                rows={activeRows}
                onSelectRow={(row) => {
                  const source =
                    performanceQuery.data?.data.find((item) => item.user.id === row.id)?.user.username ??
                    activityQuery.data?.data.find((item) => item.user.id === row.id)?.user.username ??
                    xpQuery.data?.data.find((item) => item.user.id === row.id)?.user.username ??
                    null;
                  navigate(buildProfilePath(row.id, source));
                }}
              />
            </div>
          )}
        </div>

        <div className="space-y-4">
          <V2Surface className="p-5" tone="soft">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-white/38">
                  Top Movers
                </div>
                <div className="mt-2 text-xl font-semibold text-white">Call board winners</div>
              </div>
              <V2StatusPill tone="live">{period.toUpperCase()}</V2StatusPill>
            </div>
            <div className="mt-4 space-y-3">
              {topMoverRows.slice(0, 5).map((row) => (
                <button
                  key={`mover-${row.id}`}
                  type="button"
                  onClick={() => navigate(buildProfilePath(row.id, row.handle?.replace("@", "") ?? null))}
                  className="flex w-full items-center justify-between gap-3 rounded-[18px] border border-white/8 bg-white/[0.03] px-3 py-3 text-left transition hover:bg-white/[0.06]"
                >
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold text-white">{row.displayName}</div>
                    <div className="truncate text-xs text-white/42">{row.metadataLabel}</div>
                  </div>
                  <div className={cn("text-sm font-semibold", row.valueTone === "gain" ? "text-[#76ff44]" : "text-white")}>
                    {row.valueLabel}
                  </div>
                </button>
              ))}
            </div>
          </V2Surface>

          <V2Surface className="p-5" tone="soft">
            <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-white/38">
              AI Highlights
            </div>
            <div className="mt-4 grid gap-3">
              {[
                "Call board ranks settled signal outcomes only.",
                "Wallet/portfolio performance stays separate and never reuses call ROI.",
                "Raid leadership measures room pressure, not trader profitability.",
                "XP / Level ranks progression, not returns.",
              ].map((line) => (
                <div
                  key={line}
                  className="rounded-[18px] border border-white/8 bg-black/20 px-4 py-3 text-sm leading-6 text-white/58"
                >
                  {line}
                </div>
              ))}
            </div>
          </V2Surface>

          <V2Surface className="p-5" tone="soft">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-white/38">
                  Active Leaders
                </div>
                <div className="mt-2 text-xl font-semibold text-white">Raid / XP surfaces</div>
              </div>
              <V2StatusPill tone="live">Live</V2StatusPill>
            </div>

            <div className="mt-4 space-y-3">
              {raidLeaderRows.slice(0, 3).map((row) => (
                <div
                  key={`raid-${row.id}`}
                  className="flex items-center justify-between gap-3 rounded-[18px] border border-white/8 bg-black/20 px-3 py-3"
                >
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold text-white">{row.displayName}</div>
                    <div className="truncate text-xs text-white/42">{row.changeLabel}</div>
                  </div>
                  <div className="text-sm font-semibold text-[#76ff44]">{row.valueLabel}</div>
                </div>
              ))}

              {xpLeaderRows.slice(0, 2).map((row) => (
                <div
                  key={`xp-${row.id}`}
                  className="flex items-center justify-between gap-3 rounded-[18px] border border-white/8 bg-black/20 px-3 py-3"
                >
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold text-white">{row.displayName}</div>
                    <div className="truncate text-xs text-white/42">{row.metadataLabel}</div>
                  </div>
                  <div className="text-sm font-semibold text-white">{row.valueLabel}</div>
                </div>
              ))}
            </div>
          </V2Surface>

          <V2Surface className="p-5" tone="soft">
            <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-white/38">
              Board Legend
            </div>
            <div className="mt-4 grid gap-3">
              {[
                {
                  icon: LineChart,
                  label: "Call Performance",
                  text: "Published call results only. No wallet inference.",
                },
                {
                  icon: Coins,
                  label: "Wallet Performance",
                  text: "Portfolio and realized wallet state only.",
                },
                {
                  icon: Flame,
                  label: "Raid Leaders",
                  text: "Room pressure, campaign activity, and coordination output.",
                },
                {
                  icon: Activity,
                  label: "XP / Level",
                  text: "Progression and reputation board, not returns.",
                },
              ].map((item) => {
                const Icon = item.icon;
                return (
                  <div
                    key={item.label}
                    className="flex items-start gap-3 rounded-[18px] border border-white/8 bg-black/20 px-4 py-3"
                  >
                    <div className="mt-0.5 flex h-9 w-9 items-center justify-center rounded-full border border-white/10 bg-white/[0.04]">
                      <Icon className="h-4 w-4 text-[#76ff44]" />
                    </div>
                    <div>
                      <div className="text-sm font-semibold text-white">{item.label}</div>
                      <div className="mt-1 text-xs leading-6 text-white/48">{item.text}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          </V2Surface>
        </div>
      </div>
    </div>
  );
}
