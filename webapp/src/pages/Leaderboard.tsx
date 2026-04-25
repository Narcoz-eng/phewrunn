import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  BrainCircuit,
  LineChart,
  Radar,
  Trophy,
} from "lucide-react";
import { useAuth, useSession } from "@/lib/auth-client";
import { api } from "@/lib/api";
import { buildProfilePath } from "@/lib/profile-path";
import { readSessionCache, writeSessionCache } from "@/lib/session-cache";
import {
  buildLeaderboardRowsVm,
  type LeaderboardRowVM,
  type PerformancePeriod,
} from "@/viewmodels/trader-performance";
import { cn } from "@/lib/utils";
import { getAvatarUrl, type User } from "@/types";
import { V2PageTopbar } from "@/components/layout/V2PageTopbar";
import { V2MetricCard } from "@/components/ui/v2/V2MetricCard";
import { V2Surface } from "@/components/ui/v2/V2Surface";
import { V2TabBar } from "@/components/ui/v2/V2TabBar";
import { LeaderboardPodium } from "@/components/leaderboard/LeaderboardPodium";
import {
  LeaderboardFeatureRail,
  LeaderboardRankTable,
  LeaderboardRightRail,
  LeaderboardWalletUnavailable,
} from "@/components/leaderboard/LeaderboardV2Surface";

type LeaderboardBoard = "calls" | "wallet" | "raids" | "xp";

type PerformanceLeaderboardEntry = {
  rank: number;
  user: {
    id: string;
    username: string | null;
    name: string;
    image: string | null;
    isVerified?: boolean;
    followersCount?: number | null;
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
  trendPoints?: number[];
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
    trendPoints: [],
    followersLabel: "0",
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
    trendPoints: [],
    followersLabel: "0",
  }));
}

export default function Leaderboard() {
  const navigate = useNavigate();
  const { data: session } = useSession();
  const { hasLiveSession } = useAuth();
  const [period, setPeriod] = useState<PerformancePeriod>("30d");
  const [board, setBoard] = useState<LeaderboardBoard>("calls");
  const [search, setSearch] = useState("");

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

  const activeRowsRaw = useMemo(
    () => (board === "calls" ? callRows : board === "raids" ? raidRows : board === "xp" ? xpRows : []),
    [board, callRows, raidRows, xpRows]
  );
  const currentCallRankRow = useMemo(() => {
    const currentEntry = performanceQuery.data?.meta?.currentUser;
    if (!currentEntry) return null;
    return buildLeaderboardRowsVm([currentEntry])[0] ?? null;
  }, [performanceQuery.data?.meta?.currentUser]);
  const activeRowsWithYourRank = useMemo(() => {
    if (board !== "calls" || !currentCallRankRow || activeRowsRaw.some((row) => row.id === currentCallRankRow.id)) {
      return activeRowsRaw;
    }
    return [...activeRowsRaw, currentCallRankRow];
  }, [activeRowsRaw, board, currentCallRankRow]);
  const activeRows = useMemo(() => {
    const normalized = search.trim().toLowerCase();
    if (!normalized) return activeRowsWithYourRank;
    return activeRowsWithYourRank.filter((row) =>
      `${row.displayName} ${row.handle ?? ""} ${row.metadataLabel}`.toLowerCase().includes(normalized)
    );
  }, [activeRowsWithYourRank, search]);
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

  const boardCopy = useMemo(() => {
    switch (board) {
      case "wallet":
        return {
          tableTitle: "Portfolio Performance Board",
          subtitle:
            "Wallet and portfolio performance are intentionally separated from call performance. This board only ranks realized or snapshot-backed wallet state.",
        };
      case "raids":
        return {
          tableTitle: "Raid / Community Leadership",
          subtitle:
            "Community pressure, coordination output, and live room momentum surface here. This board is not a profitability board.",
        };
      case "xp":
        return {
          tableTitle: "XP / Level Arena",
          subtitle:
            "Progression is ranked independently from call ROI and wallet performance so reputation, execution, and capital stay semantically separate.",
        };
      default:
        return {
          tableTitle: "Signal Performance Board",
          subtitle:
            "Ranked from settled call outcomes. This board measures published call performance only and does not imply wallet or portfolio profit.",
        };
    }
  }, [board]);

  const topMoverRows = useMemo(() => callRows.slice(0, 5), [callRows]);
  const raidLeaderRows = useMemo(() => raidRows.slice(0, 5), [raidRows]);

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
      <section className="rounded-[18px] border border-white/8 bg-[linear-gradient(180deg,rgba(8,12,18,0.97),rgba(3,7,10,0.99))] px-4 py-4 sm:px-5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h1 className="text-[26px] font-semibold tracking-tight text-white">Leaderboard</h1>
            <p className="mt-1 text-[13px] text-white/54">Top traders, signal callers and raid leaders</p>
          </div>
          <V2PageTopbar
            value={search}
            onChange={setSearch}
            placeholder="Search users, tokens, raids..."
            className="lg:min-w-[520px]"
          />
        </div>
      </section>

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
              { value: "wallet", label: "Wallet Performance", badge: "Unavailable", disabled: true },
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
            <LeaderboardWalletUnavailable />
          ) : activeLoading ? (
            <V2Surface className="px-6 py-10 text-white/56">Loading leaderboard...</V2Surface>
          ) : (
            <div className={cn("space-y-4 transition-opacity", activeFetching && "opacity-80")}>
              {board === "calls" ? <LeaderboardPodium rows={activeRowsRaw} /> : null}
              <LeaderboardRankTable
                rows={activeRows}
                currentUserId={currentUser?.id ?? null}
                title={boardCopy.tableTitle}
                subtitle={boardCopy.subtitle}
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

        <LeaderboardRightRail
          topMovers={topMoverRows}
          raidLeaders={raidLeaderRows}
          period={period}
          onSelectRow={(row) => navigate(buildProfilePath(row.id, row.handle?.replace("@", "") ?? null))}
        />
      </div>

      <LeaderboardFeatureRail />
    </div>
  );
}
