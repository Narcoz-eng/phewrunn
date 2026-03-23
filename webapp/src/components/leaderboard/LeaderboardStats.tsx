import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Skeleton } from "@/components/ui/skeleton";
import { readSessionCache, writeSessionCache } from "@/lib/session-cache";

interface PlatformStats {
  volume: {
    day: number;
    week: number;
    month: number;
    allTime: number;
  };
  alphas: {
    today: number;
    week: number;
    month: number;
    total: number;
  };
  avgWinRate: number;
  activeUsers: {
    today: number;
    week: number;
  };
  totalUsers: number;
  levelDistribution: Array<{ level: number; count: number }>;
  topUsersThisWeek: Array<{
    id: string;
    name: string | null;
    username: string | null;
    image: string | null;
    level: number;
    postsThisWeek: number;
  }>;
}

const PLATFORM_STATS_CACHE_KEY = "phew.leaderboard.stats:v1";
const PLATFORM_STATS_CACHE_TTL_MS = 15 * 60_000;

interface StatItemProps {
  label: string;
  value: string;
}

function StatItem({ label, value }: StatItemProps) {
  return (
    <div className="flex flex-col items-center gap-0.5 px-4 py-3 flex-1">
      <span className="text-xl font-bold font-mono tabular-nums">{value}</span>
      <span className="text-xs text-muted-foreground tracking-wide">{label}</span>
    </div>
  );
}

function StatItemSkeleton() {
  return (
    <div className="flex flex-col items-center gap-1.5 px-4 py-3 flex-1">
      <Skeleton className="h-7 w-16" />
      <Skeleton className="h-3 w-20" />
    </div>
  );
}

export function LeaderboardStats() {
  const cachedStats = readSessionCache<PlatformStats>(PLATFORM_STATS_CACHE_KEY, PLATFORM_STATS_CACHE_TTL_MS);

  const { data: stats, isLoading } = useQuery({
    queryKey: ["leaderboard", "stats"],
    queryFn: async () => {
      const data = await api.get<PlatformStats>("/api/leaderboard/stats");
      if (data && (data.totalUsers > 0 || data.alphas.total > 0)) {
        writeSessionCache(PLATFORM_STATS_CACHE_KEY, data);
      }
      return data;
    },
    initialData: cachedStats ?? undefined,
    initialDataUpdatedAt: cachedStats ? Date.now() : undefined,
    placeholderData: (previousData) => previousData ?? cachedStats ?? undefined,
    refetchOnWindowFocus: false,
    retry: 0,
    staleTime: 10 * 60 * 1000,
    gcTime: 20 * 60 * 1000,
  });

  if (isLoading && !cachedStats) {
    return (
      <div className="flex divide-x divide-border border border-border rounded-xl overflow-hidden bg-card/40">
        <StatItemSkeleton />
        <StatItemSkeleton />
        <StatItemSkeleton />
      </div>
    );
  }

  if (!stats) return null;

  const totalTraders = stats.totalUsers;
  const avgWinRate = stats.avgWinRate;
  const totalAlphas = stats.alphas.total;

  return (
    <div className="flex divide-x divide-border border border-border rounded-xl overflow-hidden bg-card/40">
      <StatItem
        label="Total Traders"
        value={totalTraders.toLocaleString()}
      />
      <StatItem
        label="Avg Win Rate"
        value={`${avgWinRate.toFixed(0)}%`}
      />
      <StatItem
        label="Alpha Calls"
        value={totalAlphas.toLocaleString()}
      />
    </div>
  );
}
