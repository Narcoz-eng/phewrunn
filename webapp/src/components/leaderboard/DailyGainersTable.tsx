import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { api } from "@/lib/api";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";
import { LevelBadge } from "@/components/feed/LevelBar";
import { getAvatarUrl, formatMarketCap } from "@/types";
import { cn } from "@/lib/utils";
import { buildProfilePath } from "@/lib/profile-path";
import { Trophy, Medal, Award, TrendingUp } from "lucide-react";

// Type for daily gainer from API
interface DailyGainer {
  rank: number;
  postId: string;
  tokenName: string | null;
  tokenSymbol: string | null;
  tokenImage?: string | null;
  contractAddress: string;
  user: {
    id: string;
    name?: string | null;
    username: string | null;
    image: string | null;
    level: number;
  };
  gainPercent: number;
  entryMcap: number;
  currentMcap: number;
  settledAt: string;
}

function getRankIcon(rank: number) {
  if (rank === 1) {
    return <Trophy className="h-5 w-5 text-yellow-500 drop-shadow-[0_0_8px_rgba(234,179,8,0.6)]" />;
  }
  if (rank === 2) {
    return <Medal className="h-5 w-5 text-slate-400 drop-shadow-[0_0_8px_rgba(148,163,184,0.5)]" />;
  }
  if (rank === 3) {
    return <Award className="h-5 w-5 text-amber-600 drop-shadow-[0_0_8px_rgba(217,119,6,0.5)]" />;
  }
  return <span className="text-sm font-mono text-muted-foreground w-5 text-center">{rank}</span>;
}

function DailyGainerSkeleton() {
  return (
    <div className="flex items-center gap-4 p-4 rounded-lg bg-card border border-border">
      <Skeleton className="h-5 w-5 rounded" />
      <div className="flex-1 flex items-center gap-3">
        <Skeleton className="h-10 w-10 rounded-full" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-3 w-32" />
        </div>
      </div>
      <Skeleton className="h-6 w-16" />
    </div>
  );
}

export function DailyGainersTable() {
  const navigate = useNavigate();

  const { data: gainers = [], isLoading, error } = useQuery({
    queryKey: ["leaderboard", "daily-gainers"],
    queryFn: async () => {
      const data = await api.get<DailyGainer[]>("/api/leaderboard/daily-gainers");
      return data;
    },
    refetchOnWindowFocus: false,
    retry: 1,
    refetchInterval: () => {
      if (typeof document !== "undefined" && document.visibilityState !== "visible") {
        return false;
      }
      return 5 * 60 * 1000; // Auto-refresh every 5 minutes when tab is visible
    },
    staleTime: 5 * 60 * 1000, // Keep in sync with 5-minute refresh cadence
    gcTime: 10 * 60 * 1000,
  });

  if (isLoading) {
    return (
      <div className="space-y-3">
        {[...Array(5)].map((_, i) => (
          <DailyGainerSkeleton key={i} />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-12 gap-4 text-center">
        <div className="w-16 h-16 rounded-full bg-destructive/10 flex items-center justify-center">
          <TrendingUp className="h-8 w-8 text-destructive" />
        </div>
        <p className="text-muted-foreground">Failed to load daily gainers</p>
      </div>
    );
  }

  if (gainers.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 gap-4 text-center">
        <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center">
          <TrendingUp className="h-8 w-8 text-muted-foreground" />
        </div>
        <div>
          <p className="font-semibold">No settled trades yet today</p>
          <p className="text-sm text-muted-foreground mt-1">Check back later for today's top gainers</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {gainers.map((gainer, index) => (
        <div
          key={gainer.postId}
          onClick={() => navigate(buildProfilePath(gainer.user.id, gainer.user.username))}
          className={cn(
            "flex items-center gap-4 p-4 rounded-lg bg-card border transition-all cursor-pointer",
            "hover:border-primary/50 hover:shadow-md hover:shadow-primary/5",
            index === 0 && "border-yellow-500/30 bg-yellow-500/5",
            index === 1 && "border-slate-400/30 bg-slate-400/5",
            index === 2 && "border-amber-600/30 bg-amber-600/5",
            index > 2 && "border-border"
          )}
          style={{ animationDelay: `${index * 0.05}s` }}
        >
          {/* Rank */}
          <div className="flex-shrink-0 w-8 flex justify-center">
            {getRankIcon(gainer.rank)}
          </div>

          {/* Token Info */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 min-w-0">
              <Avatar className="h-7 w-7 border border-border/60 shrink-0">
                <AvatarImage src={gainer.tokenImage || undefined} />
                <AvatarFallback className="text-[10px] font-semibold bg-secondary">
                  {(gainer.tokenSymbol || gainer.tokenName || "?").charAt(0)}
                </AvatarFallback>
              </Avatar>
              <span className="font-semibold truncate">
                {gainer.tokenSymbol || "Unknown Token"}
              </span>
              {gainer.tokenName && (
                <span className="text-xs text-muted-foreground truncate">
                  ({gainer.tokenName})
                </span>
              )}
            </div>
            {/* User Info */}
            <div className="flex items-center gap-2 mt-1">
              <Avatar className="h-5 w-5">
                <AvatarImage src={getAvatarUrl(gainer.user.id, gainer.user.image)} />
                <AvatarFallback className="text-[10px]">
                  {(gainer.user.username || gainer.user.name || "?").charAt(0)}
                </AvatarFallback>
              </Avatar>
              <span className="text-sm text-muted-foreground truncate">
                {gainer.user.username ? `@${gainer.user.username}` : (gainer.user.name || "Anonymous")}
              </span>
              <LevelBadge level={gainer.user.level} size="sm" />
            </div>
          </div>

          {/* Market Cap Change */}
          <div className="flex-shrink-0 text-right">
            <div className={cn(
              "text-lg font-bold",
              gainer.gainPercent > 0 ? "text-gain" : "text-loss"
            )}>
              +{gainer.gainPercent.toFixed(1)}%
            </div>
            <div className="text-xs text-muted-foreground">
              {formatMarketCap(gainer.entryMcap)} → {formatMarketCap(gainer.currentMcap)}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
