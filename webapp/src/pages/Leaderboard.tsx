import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { useSession, useAuth } from "@/lib/auth-client";
import { api } from "@/lib/api";
import { getAvatarUrl, type User } from "@/types";
import { buildProfilePath } from "@/lib/profile-path";
import { readSessionCache, writeSessionCache } from "@/lib/session-cache";
import { DenseLeaderboardView } from "@/components/experience/TraderPerformanceView";
import {
  buildLeaderboardRowsVm,
  buildPinnedRankVm,
  type PerformancePeriod,
  type LeaderboardPinnedRankVM,
} from "@/viewmodels/trader-performance";
import { cn } from "@/lib/utils";
import { Trophy } from "lucide-react";
import { V2PageHeader } from "@/components/layout/V2PageHeader";
import { V2MetricCard } from "@/components/ui/v2/V2MetricCard";
import { V2StatusPill } from "@/components/ui/v2/V2StatusPill";
import { V2Surface } from "@/components/ui/v2/V2Surface";

const NOTIFICATIONS_UNREAD_CACHE_PREFIX = "phew.notifications.unread";
const NOTIFICATIONS_UNREAD_CACHE_TTL_MS = 60_000;
const TOP_USERS_CACHE_TTL_MS = 10 * 60_000;

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

type TopUsersResponse = {
  data: PerformanceLeaderboardEntry[];
  meta?: {
    currentUser?: PerformanceLeaderboardEntry | null;
  } | null;
};

function buildTopUsersCacheKey(period: PerformancePeriod): string {
  return `phew.leaderboard.performance:v1:${period}`;
}

export default function Leaderboard() {
  const navigate = useNavigate();
  const { data: session } = useSession();
  const { hasLiveSession } = useAuth();
  const [period, setPeriod] = useState<PerformancePeriod>("30d");

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
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: false,
  });

  const topUsersCacheKey = buildTopUsersCacheKey(period);
  const cachedTopUsers = readSessionCache<TopUsersResponse>(topUsersCacheKey, TOP_USERS_CACHE_TTL_MS);
  const { data, isLoading, isFetching } = useQuery({
    queryKey: ["leaderboard", "terminal-performance", period],
    queryFn: async () => {
      const response = await api.raw(`/api/leaderboard/performance?period=${period}&limit=100`);
      if (!response.ok) {
        throw new Error(`Failed to load leaderboard: ${response.status}`);
      }
      const payload = (await response.json()) as TopUsersResponse;
      if (payload.data.length > 0) {
        writeSessionCache(topUsersCacheKey, payload);
      }
      return payload;
    },
    initialData: cachedTopUsers ?? undefined,
    placeholderData: (previous) => previous ?? cachedTopUsers ?? undefined,
    staleTime: 60_000,
    gcTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: 0,
  });

  const rows = useMemo(
    () => buildLeaderboardRowsVm(data?.data ?? []),
    [data?.data]
  );

  const pinnedRank = useMemo<LeaderboardPinnedRankVM | null>(() => {
    const exact = buildPinnedRankVm(data?.meta?.currentUser ?? null, currentUser?.id ?? null);
    if (exact) return exact;
    if (!currentUser) return null;
    return {
      title: "Your rank",
      rankLabel: "Unranked",
      valueLabel: "No settled record",
      valueTone: "neutral",
      avatarUrl: getAvatarUrl(currentUser.id, currentUser.image),
      avatarFallback: (currentUser.name || currentUser.username || "?").charAt(0).toUpperCase(),
    };
  }, [currentUser, data?.meta?.currentUser]);

  const unreadCacheKey = session?.user?.id
    ? `${NOTIFICATIONS_UNREAD_CACHE_PREFIX}:${session.user.id}`
    : NOTIFICATIONS_UNREAD_CACHE_PREFIX;
  const cachedUnreadCount = readSessionCache<number>(unreadCacheKey, NOTIFICATIONS_UNREAD_CACHE_TTL_MS);
  useQuery({
    queryKey: ["notifications", "unread-count", session?.user?.id ?? "anonymous"],
    queryFn: async () => {
      const response = await api.get<{ count: number }>("/api/notifications/unread-count");
      writeSessionCache(unreadCacheKey, response.count);
      return response;
    },
    initialData: cachedUnreadCount !== null ? { count: cachedUnreadCount } : undefined,
    enabled: !!currentUser && hasLiveSession,
    refetchOnWindowFocus: false,
    staleTime: 45_000,
    retry: 0,
  });

  const leaderStats = useMemo(() => {
    const entries = data?.data ?? [];
    const bestAvgRoi = entries.reduce((best, entry) => {
      const value = entry.performance.avgRoi ?? Number.NEGATIVE_INFINITY;
      return value > best ? value : best;
    }, Number.NEGATIVE_INFINITY);
    const totalSettledCalls = entries.reduce((sum, entry) => sum + entry.performance.settledCount, 0);
    const totalTrackedCallers = entries.length;
    const averageWinRate =
      entries.length > 0
        ? entries.reduce((sum, entry) => sum + (entry.performance.winRate ?? 0), 0) / entries.length
        : null;

    return [
      {
        label: "Tracked Traders",
        value: totalTrackedCallers.toLocaleString(),
        hint: "Current ranked rows",
      },
      {
        label: "Settled Calls",
        value: totalSettledCalls.toLocaleString(),
        hint: "Backend-ranked outcomes",
      },
      {
        label: "Best Avg ROI",
        value: Number.isFinite(bestAvgRoi) ? `${bestAvgRoi >= 0 ? "+" : ""}${bestAvgRoi.toFixed(1)}%` : "--",
        hint: `For ${period}`,
      },
      {
        label: "Avg Win Rate",
        value: averageWinRate !== null ? `${averageWinRate.toFixed(1)}%` : "--",
        hint: "Across ranked traders",
      },
    ];
  }, [data?.data, period]);

  return (
    <div className="space-y-5 text-white">
      <V2PageHeader
        title="Leaderboard"
        description="Backend-ranked trader performance, preserved from the existing performance buckets and surfaced in the V2 shell without changing the leaderboard contract."
        badge={<V2StatusPill tone="xp">Performance Rank</V2StatusPill>}
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
        {leaderStats.map((stat) => (
          <V2MetricCard key={stat.label} label={stat.label} value={stat.value} hint={stat.hint} accent={<Trophy className="h-5 w-5 text-lime-300" />} />
        ))}
      </div>

      {isLoading ? (
        <V2Surface className="px-6 py-10 text-white/56">Loading leaderboard...</V2Surface>
      ) : (
        <V2Surface className={cn("p-4 sm:p-5 transition-opacity", isFetching && "opacity-80")}>
          <DenseLeaderboardView
            eyebrow="Calls leaderboard"
            title="Signal Performance Board"
            subtitle="Ranked from backend performance buckets, not UI-derived metrics. Rows stay on real call results until the trade-PnL board ships."
            pinnedRank={pinnedRank}
            timeframeTabs={[
              {
                key: "24h",
                label: "24h",
                active: period === "24h",
                onSelect: () => setPeriod("24h"),
              },
              {
                key: "7d",
                label: "7d",
                active: period === "7d",
                onSelect: () => setPeriod("7d"),
              },
              {
                key: "30d",
                label: "30d",
                active: period === "30d",
                onSelect: () => setPeriod("30d"),
              },
              {
                key: "all",
                label: "All",
                active: period === "all",
                onSelect: () => setPeriod("all"),
              },
            ]}
            modeTabs={[]}
            rows={rows}
            onSelectRow={(row) => {
              const source = data?.data.find((item) => item.user.id === row.id);
              navigate(buildProfilePath(row.id, source?.user.username ?? null));
            }}
          />
        </V2Surface>
      )}
    </div>
  );
}
