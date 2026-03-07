import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { api } from "@/lib/api";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { LevelBadge } from "@/components/feed/LevelBar";
import { getAvatarUrl } from "@/types";
import { cn } from "@/lib/utils";
import { buildProfilePath } from "@/lib/profile-path";
import {
  Users,
  Activity,
  Target,
  Zap,
  Calendar,
  BarChart3,
  Flame,
} from "lucide-react";

// Platform stats type from API
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

const PLATFORM_STATS_CACHE_KEY = "phew.leaderboard.stats";
const PLATFORM_STATS_CACHE_TTL_MS = 30 * 60_000;

function isEmptyPlatformStats(stats: PlatformStats): boolean {
  return (
    stats.alphas.total === 0 &&
    stats.totalUsers === 0 &&
    stats.topUsersThisWeek.length === 0 &&
    stats.levelDistribution.every((item) => item.count === 0)
  );
}

function readCachedPlatformStats(): PlatformStats | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(PLATFORM_STATS_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { cachedAt?: number; data?: PlatformStats };
    if (
      typeof parsed?.cachedAt !== "number" ||
      !parsed.data ||
      Date.now() - parsed.cachedAt > PLATFORM_STATS_CACHE_TTL_MS
    ) {
      return null;
    }
    return parsed.data;
  } catch {
    return null;
  }
}

function writeCachedPlatformStats(data: PlatformStats): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(
      PLATFORM_STATS_CACHE_KEY,
      JSON.stringify({ cachedAt: Date.now(), data })
    );
  } catch {
    // ignore storage failures
  }
}

function StatCard({
  title,
  value,
  subValue,
  icon: Icon,
  className,
  valueClassName,
}: {
  title: string;
  value: string | number;
  subValue?: string;
  icon: React.ElementType;
  className?: string;
  valueClassName?: string;
}) {
  return (
    <Card className={cn("p-4 border transition-all hover:border-primary/30", className)}>
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            {title}
          </p>
          <p className={cn("text-2xl font-bold mt-1 font-mono", valueClassName)}>
            {value}
          </p>
          {subValue && (
            <p className="text-xs text-muted-foreground mt-0.5">{subValue}</p>
          )}
        </div>
        <div className="p-2 rounded-lg bg-primary/10">
          <Icon className="h-5 w-5 text-primary" />
        </div>
      </div>
    </Card>
  );
}

function StatCardSkeleton() {
  return (
    <Card className="p-4">
      <div className="flex items-start justify-between">
        <div className="space-y-2">
          <Skeleton className="h-3 w-20" />
          <Skeleton className="h-8 w-24" />
          <Skeleton className="h-3 w-16" />
        </div>
        <Skeleton className="h-9 w-9 rounded-lg" />
      </div>
    </Card>
  );
}

export function StatsOverview() {
  const navigate = useNavigate();
  const cachedStats = readCachedPlatformStats();
  const { data: stats, isLoading, error, refetch } = useQuery({
    queryKey: ["leaderboard", "stats"],
    queryFn: async () => {
      const data = await api.get<PlatformStats>("/api/leaderboard/stats");
      if (!isEmptyPlatformStats(data)) {
        writeCachedPlatformStats(data);
        return data;
      }
      if (cachedStats) {
        return cachedStats;
      }
      return data;
    },
    initialData: cachedStats ?? undefined,
    refetchOnWindowFocus: false,
    retry: 1,
    staleTime: 10 * 60 * 1000, // Consider data stale after 10 minutes
    refetchInterval: () => {
      if (typeof document !== "undefined" && document.visibilityState !== "visible") {
        return false;
      }
      return 10 * 60 * 1000; // Refetch every 10 minutes when tab is visible
    },
    gcTime: 20 * 60 * 1000,
  });

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[...Array(8)].map((_, i) => (
            <StatCardSkeleton key={i} />
          ))}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <Card className="p-6">
            <Skeleton className="h-5 w-40 mb-4" />
            <Skeleton className="h-40 w-full" />
          </Card>
          <Card className="p-6">
            <Skeleton className="h-5 w-40 mb-4" />
            <div className="space-y-3">
              {[...Array(5)].map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          </Card>
        </div>
      </div>
    );
  }

  if (error || !stats) {
    return (
      <div className="flex flex-col items-center justify-center py-12 gap-4 text-center">
        <div className="w-16 h-16 rounded-full bg-destructive/10 flex items-center justify-center">
          <BarChart3 className="h-8 w-8 text-destructive" />
        </div>
        <p className="text-muted-foreground">Failed to load platform statistics</p>
        <Button type="button" variant="outline" size="sm" onClick={() => void refetch()}>
          Retry Stats
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Alpha Stats */}
      <div>
        <h3 className="text-sm font-medium text-muted-foreground mb-3 flex items-center gap-2">
          <Flame className="h-4 w-4" />
          Alpha Calls
        </h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard
            title="Today"
            value={stats.alphas.today.toLocaleString()}
            icon={Zap}
            valueClassName="text-gain"
          />
          <StatCard
            title="This Week"
            value={stats.alphas.week.toLocaleString()}
            icon={Calendar}
          />
          <StatCard
            title="This Month"
            value={stats.alphas.month.toLocaleString()}
            icon={BarChart3}
          />
          <StatCard
            title="Total Alphas"
            value={stats.alphas.total.toLocaleString()}
            icon={Flame}
            className="border-gain/20"
          />
        </div>
      </div>

      {/* Platform Metrics */}
      <div>
        <h3 className="text-sm font-medium text-muted-foreground mb-3 flex items-center gap-2">
          <Activity className="h-4 w-4" />
          Platform Metrics
        </h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard
            title="Avg Win Rate"
            value={`${stats.avgWinRate.toFixed(1)}%`}
            icon={Target}
            valueClassName={cn(
              stats.avgWinRate >= 50 ? "text-gain" : "text-loss"
            )}
          />
          <StatCard
            title="Active Today"
            value={stats.activeUsers.today.toLocaleString()}
            icon={Activity}
          />
          <StatCard
            title="Active This Week"
            value={stats.activeUsers.week.toLocaleString()}
            icon={Calendar}
          />
          <StatCard
            title="Total Users"
            value={stats.totalUsers.toLocaleString()}
            icon={Users}
            className="border-primary/20"
          />
        </div>
      </div>

      {/* Level Distribution & Top Active Users */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Level Distribution */}
        <Card className="p-6">
          <h3 className="font-semibold mb-4 flex items-center gap-2">
            <BarChart3 className="h-4 w-4 text-primary" />
            Level Distribution
          </h3>
          <LevelDistributionChart distribution={stats.levelDistribution} />
        </Card>

        {/* Top Active Users This Week */}
        <Card className="p-6">
          <h3 className="font-semibold mb-4 flex items-center gap-2">
            <Flame className="h-4 w-4 text-primary" />
            Most Active This Week
          </h3>
          <div className="space-y-3">
            {stats.topUsersThisWeek.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">
                No activity this week yet
              </p>
            ) : (
              stats.topUsersThisWeek.map((user, index) => (
                <button
                  key={user.id}
                  type="button"
                  onClick={() => navigate(buildProfilePath(user.id, user.username))}
                  className="w-full text-left flex items-center gap-3 p-2 rounded-lg hover:bg-muted/50 transition-colors"
                >
                  <span className="text-sm font-mono text-muted-foreground w-4">
                    {index + 1}
                  </span>
                  <Avatar className="h-8 w-8">
                    <AvatarImage src={getAvatarUrl(user.id, user.image)} />
                    <AvatarFallback className="text-xs">
                      {(user.username || user.name)?.charAt(0) || "?"}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium truncate">
                        {user.username ? `@${user.username}` : (user.name || "anonymous")}
                      </span>
                      <LevelBadge level={user.level} size="sm" />
                    </div>
                  </div>
                  <span className="text-sm font-medium text-primary">
                    {user.postsThisWeek} posts
                  </span>
                </button>
              ))
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}

// Level Distribution Chart Component
function LevelDistributionChart({ distribution }: { distribution: Array<{ level: number; count: number }> }) {
  if (!distribution || distribution.length === 0) {
    return (
      <div className="text-sm text-muted-foreground text-center py-8">
        No data available
      </div>
    );
  }

  const maxCount = Math.max(...distribution.map(d => d.count));

  // Sort by level and fill in missing levels from -5 to 10
  const fullDistribution: Array<{ level: number; count: number }> = [];
  for (let level = -5; level <= 10; level++) {
    const found = distribution.find(d => d.level === level);
    fullDistribution.push({ level, count: found?.count ?? 0 });
  }

  return (
    <div className="space-y-2">
      {fullDistribution.map(({ level, count }) => {
        const percentage = maxCount > 0 ? (count / maxCount) * 100 : 0;
        const isNegative = level < 0;
        const isZero = level === 0;

        return (
          <div key={level} className="flex items-center gap-2">
            <span className={cn(
              "text-xs font-mono w-8 text-right",
              isNegative ? "text-loss" : isZero ? "text-muted-foreground" : "text-gain"
            )}>
              {level > 0 ? `+${level}` : level}
            </span>
            <div className="flex-1 h-5 bg-muted rounded-full overflow-hidden">
              <div
                className={cn(
                  "h-full rounded-full transition-all duration-500 ease-out",
                  isNegative ? "bg-loss" : isZero ? "bg-muted-foreground" : "bg-gain"
                )}
                style={{ width: `${Math.max(percentage, count > 0 ? 2 : 0)}%` }}
              />
            </div>
            <span className="text-xs text-muted-foreground w-10 text-right">
              {count.toLocaleString()}
            </span>
          </div>
        );
      })}
    </div>
  );
}
