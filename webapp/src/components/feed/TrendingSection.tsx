import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { formatMarketCap, getAvatarUrl, PostAuthor } from "@/types";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Flame, Users, TrendingUp, TrendingDown, Trophy } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { readSessionCache, writeSessionCache } from "@/lib/session-cache";

interface TrendingToken {
  contractAddress: string;
  chainType: string;
  tokenName: string | null;
  tokenSymbol: string | null;
  tokenImage: string | null;
  callCount: number;
  firstPostId: string | null;
  currentMcap: number | null;
  latestMcap?: number | null;
  avgEntryMcap?: number | null;
  avgGain?: number | null;
  winCount?: number;
  winRate?: number;
  topCallers: PostAuthor[];
}

const TRENDING_TOKENS_SESSION_CACHE_KEY = "phew.feed.trending.tokens";
const TRENDING_TOKENS_SESSION_CACHE_TTL_MS = 2 * 60_000;

interface TrendingSectionProps {
  enabled?: boolean;
}

export function TrendingSection({ enabled = true }: TrendingSectionProps) {
  const navigate = useNavigate();
  const cachedTrendingTokens = readSessionCache<TrendingToken[]>(
    TRENDING_TOKENS_SESSION_CACHE_KEY,
    TRENDING_TOKENS_SESSION_CACHE_TTL_MS
  );

  // Fetch trending tokens
  const { data: trendingTokens = [], isLoading } = useQuery({
    queryKey: ["trending-tokens"],
    queryFn: async () => {
      const data = await api.get<TrendingToken[]>("/api/posts/trending");
      writeSessionCache(TRENDING_TOKENS_SESSION_CACHE_KEY, data);
      return data;
    },
    initialData: cachedTrendingTokens ?? undefined,
    enabled,
    staleTime: 60000, // 1 minute
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    refetchInterval: () => {
      if (typeof document !== "undefined" && document.visibilityState !== "visible") {
        return false;
      }
      return 120000; // 2 minutes
    },
  });

  // Backend enforces trending eligibility; keep a matching client-side guard.
  const qualifiedTokens = trendingTokens.filter(
    (t) => t.callCount >= 10 && (t.avgGain ?? Number.NEGATIVE_INFINITY) > 0
  );

  if (isLoading) {
    return <TrendingSkeleton />;
  }

  if (qualifiedTokens.length === 0) {
    return null;
  }

  return (
    <div className="mb-6">
      {/* Section Header */}
      <div className="flex items-center gap-2 mb-3">
        <Flame className="h-5 w-5 text-orange-500" />
        <h2 className="font-bold text-foreground">TRENDING NOW</h2>
      </div>

      {/* Horizontal scrolling container */}
      <div
        className={cn(
          "relative -mx-4 px-4",
          "before:absolute before:left-0 before:top-0 before:bottom-0 before:w-4 before:bg-gradient-to-r before:from-background before:to-transparent before:z-10 before:pointer-events-none",
          "after:absolute after:right-0 after:top-0 after:bottom-0 after:w-4 after:bg-gradient-to-l after:from-background after:to-transparent after:z-10 after:pointer-events-none"
        )}
      >
        <div className="flex gap-3 overflow-x-auto pb-2 scrollbar-hide">
          {qualifiedTokens.map((token, index) => {
            const isWinner = token.avgGain !== null && token.avgGain !== undefined && token.avgGain > 0;
            const avgGain = token.avgGain ?? 0;
            const winRate = token.winRate ?? 0;
            const hiddenCallerCount = Math.max(token.callCount - 3, 0);

            return (
            <motion.div
              key={token.contractAddress}
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: index * 0.05 }}
              className={cn(
                "flex-shrink-0 w-52 p-4 rounded-xl cursor-pointer relative",
                isWinner
                  ? "bg-gradient-to-br from-gain/15 via-card to-accent/10 border-gain/30 hover:border-gain/50"
                  : "bg-gradient-to-br from-orange-500/10 via-card to-red-500/10 border-orange-500/20 hover:border-orange-500/40",
                "border transition-all duration-200 hover:shadow-lg",
                isWinner ? "hover:shadow-gain/10" : "hover:shadow-orange-500/10",
                "hover:scale-[1.02]"
              )}
              onClick={() => {
                navigate(`/token/${token.contractAddress}`);
              }}
            >
              {/* Winner Badge */}
              {isWinner && index === 0 && (
                <div className="absolute -top-2 -right-2 flex items-center gap-1 px-2 py-1 rounded-full bg-gradient-to-r from-yellow-500 to-amber-500 text-white text-[10px] font-bold shadow-lg">
                  <Trophy className="h-3 w-3" />
                  TOP WINNER
                </div>
              )}
              {isWinner && index > 0 && (
                <div className="absolute -top-2 -right-2 flex items-center gap-1 px-2 py-0.5 rounded-full bg-gain/20 text-gain text-[9px] font-semibold border border-gain/40">
                  <TrendingUp className="h-2.5 w-2.5" />
                  WINNER
                </div>
              )}

              {/* Token Info */}
              <div className="flex items-center gap-3 mb-3">
                {/* Token Image or Placeholder */}
                <div className={cn(
                  "w-10 h-10 rounded-full flex items-center justify-center overflow-hidden border",
                  isWinner
                    ? "bg-gradient-to-br from-gain/20 to-accent/20 border-gain/30"
                    : "bg-gradient-to-br from-orange-500/20 to-red-500/20 border-orange-500/30"
                )}>
                  {token.tokenImage ? (
                    <img
                      src={token.tokenImage}
                      alt={token.tokenSymbol || "Token"}
                      loading="lazy"
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <span className={cn(
                      "text-lg font-bold",
                      isWinner ? "text-gain" : "text-orange-500"
                    )}>
                      {token.tokenSymbol?.charAt(0) || "?"}
                    </span>
                  )}
                </div>

                <div className="flex-1 min-w-0">
                  <p className="font-bold text-foreground truncate">
                    {token.tokenSymbol || token.tokenName || "Unknown"}
                  </p>
                  <p className="text-xs text-muted-foreground truncate">
                    {token.tokenName || "Token"}
                  </p>
                </div>
              </div>

              {/* Performance Stats */}
              <div className="flex items-center gap-2 mb-2">
                {/* Avg Gain */}
                <div className={cn(
                  "flex items-center gap-1 px-2 py-1 rounded-md text-xs font-semibold",
                  isWinner
                    ? "bg-gain/20 text-gain"
                    : avgGain < 0
                      ? "bg-loss/20 text-loss"
                      : "bg-muted text-muted-foreground"
                )}>
                  {isWinner ? (
                    <TrendingUp className="h-3 w-3" />
                  ) : avgGain < 0 ? (
                    <TrendingDown className="h-3 w-3" />
                  ) : null}
                  {avgGain >= 0 ? "+" : ""}{avgGain.toFixed(1)}%
                </div>

                {/* Win Rate */}
                {winRate > 0 && (
                  <div className={cn(
                    "text-xs font-medium px-1.5 py-0.5 rounded",
                    winRate >= 50 ? "text-gain" : "text-muted-foreground"
                  )}>
                    {winRate.toFixed(0)}% WR
                  </div>
                )}
              </div>

              {/* Call Count Badge */}
              <div className="flex items-center gap-1.5 mb-2">
                <Users className={cn(
                  "h-3.5 w-3.5",
                  isWinner ? "text-gain" : "text-orange-500"
                )} />
                <span className={cn(
                  "text-sm font-semibold",
                  isWinner ? "text-gain" : "text-orange-500"
                )}>
                  {token.callCount} calls
                </span>
              </div>

              {/* Market Cap */}
              <p className="text-xs text-muted-foreground mb-3">
                MCap:{" "}
                <span className="font-mono font-medium text-foreground">
                  {formatMarketCap(token.latestMcap ?? token.currentMcap)}
                </span>
              </p>

              {/* Top Callers Avatars */}
              {token.topCallers.length > 0 && (
                <div className="flex items-center">
                  <div className="flex -space-x-2">
                    {token.topCallers.slice(0, 3).map((caller) => (
                      <Avatar
                        key={caller.id}
                        className="h-6 w-6 border-2 border-card"
                      >
                        <AvatarImage
                          src={getAvatarUrl(caller.id, caller.image)}
                        />
                        <AvatarFallback className="text-[9px] bg-muted">
                          {caller.name?.charAt(0) || "?"}
                        </AvatarFallback>
                      </Avatar>
                    ))}
                  </div>
                  {hiddenCallerCount > 0 && (
                    <span className="ml-2 text-[10px] text-muted-foreground">
                      +{hiddenCallerCount} more
                    </span>
                  )}
                </div>
              )}
            </motion.div>
          );
          })}
        </div>
      </div>
    </div>
  );
}

function TrendingSkeleton() {
  return (
    <div className="mb-6">
      <div className="flex items-center gap-2 mb-3">
        <Skeleton className="h-5 w-5 rounded" />
        <Skeleton className="h-5 w-32" />
      </div>
      <div className="flex gap-3 overflow-hidden">
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="flex-shrink-0 w-48 p-4 rounded-xl border border-border bg-card"
          >
            <div className="flex items-center gap-3 mb-3">
              <Skeleton className="w-10 h-10 rounded-full" />
              <div className="flex-1">
                <Skeleton className="h-4 w-16 mb-1" />
                <Skeleton className="h-3 w-12" />
              </div>
            </div>
            <Skeleton className="h-4 w-20 mb-2" />
            <Skeleton className="h-3 w-24 mb-3" />
            <div className="flex -space-x-2">
              {[0, 1, 2].map((j) => (
                <Skeleton key={j} className="h-6 w-6 rounded-full" />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
