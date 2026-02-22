import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { api } from "@/lib/api";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { LevelBadge } from "@/components/feed/LevelBar";
import { VerifiedBadge } from "@/components/VerifiedBadge";
import { getAvatarUrl } from "@/types";
import { cn } from "@/lib/utils";
import { Trophy, Medal, Award, Users, ChevronLeft, ChevronRight, Target, Activity, TrendingUp } from "lucide-react";

// Type for top user from API
interface TopUser {
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
    recentAlphas?: number; // Only present for activity sort
    wins: number;
    losses: number;
    winRate: number;
  };
}

interface TopUsersResponse {
  data: TopUser[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

type SortOption = 'level' | 'activity' | 'winrate';

function getRankDisplay(rank: number) {
  if (rank === 1) {
    return (
      <div className="flex items-center justify-center w-8 h-8 rounded-full bg-gradient-to-br from-yellow-400 to-yellow-600 shadow-lg shadow-yellow-500/30">
        <Trophy className="h-4 w-4 text-yellow-100" />
      </div>
    );
  }
  if (rank === 2) {
    return (
      <div className="flex items-center justify-center w-8 h-8 rounded-full bg-gradient-to-br from-slate-300 to-slate-500 shadow-lg shadow-slate-400/30">
        <Medal className="h-4 w-4 text-slate-100" />
      </div>
    );
  }
  if (rank === 3) {
    return (
      <div className="flex items-center justify-center w-8 h-8 rounded-full bg-gradient-to-br from-amber-500 to-amber-700 shadow-lg shadow-amber-600/30">
        <Award className="h-4 w-4 text-amber-100" />
      </div>
    );
  }
  return (
    <div className="flex items-center justify-center w-8 h-8 rounded-full bg-muted">
      <span className="text-sm font-mono font-bold text-muted-foreground">{rank}</span>
    </div>
  );
}

function TopUserSkeleton() {
  return (
    <div className="flex items-center gap-4 p-4 rounded-lg bg-card border border-border">
      <Skeleton className="h-8 w-8 rounded-full" />
      <Skeleton className="h-10 w-10 rounded-full" />
      <div className="flex-1 space-y-2">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-3 w-20" />
      </div>
      <div className="space-y-1 text-right">
        <Skeleton className="h-4 w-16 ml-auto" />
        <Skeleton className="h-3 w-12 ml-auto" />
      </div>
    </div>
  );
}

export function TopUsersTable() {
  const navigate = useNavigate();
  const [page, setPage] = useState(1);
  const [sortBy, setSortBy] = useState<SortOption>('level');
  const limit = 20;

  const { data, isLoading, error, isFetching } = useQuery({
    queryKey: ["leaderboard", "top-users", page, sortBy],
    queryFn: async () => {
      try {
        // Use api.get which unwraps the outer { data } envelope
        // The response from backend is { data: users[], pagination: {...} }
        // After unwrap, we get { data: users[], pagination: {...} } directly
        // But wait - api.get unwraps json.data, so we get: users[] | { data: users[], pagination } ??
        // Actually, the backend returns c.json({ data: usersWithStats, pagination: {...} })
        // This means the JSON response is { data: usersWithStats, pagination: {...} }
        // api.get does json.data, returning usersWithStats directly (losing pagination)

        // Use raw to get the full response with pagination
        const response = await api.raw(`/api/leaderboard/top-users?page=${page}&limit=${limit}&sortBy=${sortBy}`);
        if (!response.ok) {
          throw new Error(`Failed to load leaderboard: ${response.status}`);
        }
        const json = await response.json();
        // Backend returns { data: users[], pagination: {...} }
        return json as { data: TopUser[]; pagination: { page: number; limit: number; total: number; totalPages: number } };
      } catch (err) {
        console.error("[TopUsersTable] Error fetching data:", err);
        throw err;
      }
    },
    staleTime: 60 * 1000, // Consider data stale after 1 minute
    placeholderData: (previousData) => previousData,
  });

  const handleSortChange = (newSort: SortOption) => {
    setSortBy(newSort);
    setPage(1);
  };

  const users = data?.data ?? [];
  const pagination = data?.pagination;
  const totalPages = pagination?.totalPages ?? 1;

  if (isLoading) {
    return (
      <div className="space-y-3">
        {[...Array(10)].map((_, i) => (
          <TopUserSkeleton key={i} />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-12 gap-4 text-center">
        <div className="w-16 h-16 rounded-full bg-destructive/10 flex items-center justify-center">
          <Users className="h-8 w-8 text-destructive" />
        </div>
        <p className="text-muted-foreground">Failed to load leaderboard</p>
      </div>
    );
  }

  if (users.length === 0) {
    // Different message based on sort option
    const emptyMessage = sortBy === 'activity'
      ? { title: "No recent activity", subtitle: "No posts in the last 7 days" }
      : sortBy === 'winrate'
      ? { title: "No qualified users", subtitle: "Users need at least 5 settled posts to appear" }
      : { title: "No users yet", subtitle: "Be the first to post alpha!" };

    return (
      <div className="space-y-4">
        {/* Sort Toggle - Still show it so users can switch */}
        <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3">
          <span className="text-sm text-muted-foreground">Sort by:</span>
          <div className="flex gap-1.5 overflow-x-auto pb-1 sm:pb-0">
            <Button
              variant={sortBy === 'level' ? 'default' : 'outline'}
              size="sm"
              onClick={() => handleSortChange('level')}
              className="transition-all duration-200 shrink-0"
            >
              <Trophy className="h-4 w-4 mr-1.5" />
              Level
            </Button>
            <Button
              variant={sortBy === 'activity' ? 'default' : 'outline'}
              size="sm"
              onClick={() => handleSortChange('activity')}
              className="transition-all duration-200 shrink-0"
            >
              <Activity className="h-4 w-4 mr-1.5" />
              Activity
            </Button>
            <Button
              variant={sortBy === 'winrate' ? 'default' : 'outline'}
              size="sm"
              onClick={() => handleSortChange('winrate')}
              className="transition-all duration-200 shrink-0"
            >
              <TrendingUp className="h-4 w-4 mr-1.5" />
              Win Rate
            </Button>
          </div>
        </div>

        {/* Empty state */}
        <div className="flex flex-col items-center justify-center py-12 gap-4 text-center">
          <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center">
            <Users className="h-8 w-8 text-muted-foreground" />
          </div>
          <div>
            <p className="font-semibold">{emptyMessage.title}</p>
            <p className="text-sm text-muted-foreground mt-1">{emptyMessage.subtitle}</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Sort Toggle */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3">
        <span className="text-sm text-muted-foreground">Sort by:</span>
        <div className="flex gap-1.5 overflow-x-auto pb-1 sm:pb-0">
          <Button
            variant={sortBy === 'level' ? 'default' : 'outline'}
            size="sm"
            onClick={() => handleSortChange('level')}
            className="transition-all duration-200 shrink-0"
          >
            <Trophy className="h-4 w-4 mr-1.5" />
            Level
          </Button>
          <Button
            variant={sortBy === 'activity' ? 'default' : 'outline'}
            size="sm"
            onClick={() => handleSortChange('activity')}
            className="transition-all duration-200 shrink-0"
          >
            <Activity className="h-4 w-4 mr-1.5" />
            Activity
          </Button>
          <Button
            variant={sortBy === 'winrate' ? 'default' : 'outline'}
            size="sm"
            onClick={() => handleSortChange('winrate')}
            className="transition-all duration-200 shrink-0"
          >
            <TrendingUp className="h-4 w-4 mr-1.5" />
            Win Rate
          </Button>
        </div>
      </div>

      {/* User List */}
      <div className={cn("space-y-3 transition-opacity", isFetching && "opacity-60")}>
        {users.map((item, index) => (
          <div
            key={item.user.id}
            onClick={() => navigate(`/profile/${item.user.id}`)}
            className={cn(
              "flex items-center gap-4 p-4 rounded-lg bg-card border transition-all cursor-pointer",
              "hover:border-primary/50 hover:shadow-md hover:shadow-primary/5",
              item.rank === 1 && "border-yellow-500/30 bg-gradient-to-r from-yellow-500/10 to-transparent",
              item.rank === 2 && "border-slate-400/30 bg-gradient-to-r from-slate-400/10 to-transparent",
              item.rank === 3 && "border-amber-600/30 bg-gradient-to-r from-amber-600/10 to-transparent",
              item.rank > 3 && "border-border"
            )}
            style={{ animationDelay: `${index * 0.03}s` }}
          >
            {/* Rank */}
            {getRankDisplay(item.rank)}

            {/* Avatar */}
            <Avatar className="h-10 w-10 border-2 border-background">
              <AvatarImage src={getAvatarUrl(item.user.id, item.user.image)} />
              <AvatarFallback className="text-sm">
                {(item.user.name || item.user.username || "?").charAt(0)}
              </AvatarFallback>
            </Avatar>

            {/* User Info */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-semibold truncate">
                  {item.user.username || item.user.name || "Anonymous"}
                </span>
                {item.user.isVerified ? <VerifiedBadge size="sm" /> : null}
                <LevelBadge level={item.user.level ?? 0} size="sm" />
              </div>
              <div className="text-sm text-muted-foreground">
                {(item.user.xp ?? 0).toLocaleString()} XP
              </div>
            </div>

            {/* Stats - varies based on sort option */}
            <div className="flex-shrink-0 text-right">
              {sortBy === 'activity' ? (
                <>
                  <div className="flex items-center gap-1 justify-end">
                    <Activity className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className="font-bold text-primary">
                      {item.stats.recentAlphas ?? item.stats.totalAlphas ?? 0}
                    </span>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    posts (7d)
                  </div>
                </>
              ) : sortBy === 'winrate' ? (
                <>
                  <div className="flex items-center gap-1 justify-end">
                    <TrendingUp className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className={cn(
                      "font-bold",
                      (item.stats.winRate ?? 0) >= 60 ? "text-gain" :
                      (item.stats.winRate ?? 0) >= 40 ? "text-foreground" : "text-loss"
                    )}>
                      {(item.stats.winRate ?? 0).toFixed(1)}%
                    </span>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {item.stats.wins ?? 0}W / {item.stats.losses ?? 0}L
                  </div>
                </>
              ) : (
                <>
                  <div className="flex items-center gap-1 justify-end">
                    <Target className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className={cn(
                      "font-bold",
                      (item.stats.winRate ?? 0) >= 60 ? "text-gain" :
                      (item.stats.winRate ?? 0) >= 40 ? "text-foreground" : "text-loss"
                    )}>
                      {(item.stats.winRate ?? 0).toFixed(1)}%
                    </span>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {item.stats.totalAlphas ?? 0} alphas
                  </div>
                </>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 pt-4">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPage(p => Math.max(1, p - 1))}
            disabled={page === 1 || isFetching}
          >
            <ChevronLeft className="h-4 w-4" />
            Previous
          </Button>
          <span className="text-sm text-muted-foreground px-4">
            Page {page} of {totalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPage(p => Math.min(totalPages, p + 1))}
            disabled={page === totalPages || isFetching}
          >
            Next
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      )}
    </div>
  );
}
