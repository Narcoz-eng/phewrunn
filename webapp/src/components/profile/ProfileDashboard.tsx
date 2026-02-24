import { cn } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { LevelBar, LevelBadge } from "@/components/feed/LevelBar";
import {
  Trophy,
  Target,
  TrendingUp,
  TrendingDown,
  Percent,
  Sparkles,
  Zap,
  BarChart3,
  CheckCircle2,
  XCircle,
  Clock,
  Wallet,
  Coins,
  ArrowUpRight,
  ArrowDownRight,
} from "lucide-react";
import { MIN_LEVEL, MAX_LEVEL, formatTimeAgo, calculatePercentChange, formatMarketCap } from "@/types";

// Stats interface for user trading statistics
export interface UserStats {
  totalCalls: number;
  wins: number;
  losses: number;
  winRate: number;
  totalProfitPercent: number;
}

// Wallet data interface for Web3 users
export interface WalletData {
  connected: boolean;
  address?: string;
  platformCoinHoldings?: number; // PHEW token holdings
  totalVolumeBoughtSol?: number;
  totalVolumeSoldSol?: number;
  totalVolumeBoughtUsd?: number;
  totalVolumeSoldUsd?: number;
  totalProfitUsd?: number | null;
  balanceSol?: number;
  balanceUsd?: number;
  balanceUsdc?: number;
  tokenPositions?: WalletTokenPosition[];
}

export interface WalletTokenPosition {
  mint: string;
  tokenName?: string | null;
  tokenSymbol?: string | null;
  tokenImage?: string | null;
  holdingAmount?: number | null;
  holdingUsd?: number | null;
  boughtAmount?: number | null;
  soldAmount?: number | null;
  totalPnlUsd?: number | null;
}

// Simplified trade interface for recent trades display
export interface RecentTrade {
  id: string;
  content: string;
  contractAddress: string | null;
  chainType: string | null;
  entryMcap: number | null;
  currentMcap: number | null;
  settled: boolean;
  settledAt: string | null;
  isWin: boolean | null;
  createdAt: string;
}

interface ProfileDashboardProps {
  level: number;
  xp: number;
  stats: UserStats;
  recentTrades: RecentTrade[];
  walletData?: WalletData;
  isLoading?: boolean;
  className?: string;
}

// Skeleton component for loading state
export function ProfileDashboardSkeleton() {
  return (
    <div className="space-y-6">
      {/* XP & Level Progress Skeleton */}
      <Card className="border-primary/20 bg-gradient-to-br from-primary/5 via-card to-accent/5">
        <CardHeader className="pb-4">
          <div className="flex items-center justify-between">
            <Skeleton className="h-6 w-40" />
            <Skeleton className="h-8 w-12 rounded-md" />
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="p-4 bg-background/50 rounded-lg border border-border/50">
            <div className="flex items-center justify-between">
              <Skeleton className="h-4 w-16" />
              <Skeleton className="h-8 w-24" />
            </div>
          </div>
          <Skeleton className="h-6 w-full rounded-full" />
          <div className="flex justify-between">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-3 w-16" />
            <Skeleton className="h-3 w-20" />
          </div>
        </CardContent>
      </Card>

      {/* Stats Grid Skeleton */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[1, 2, 3, 4].map((i) => (
          <Card key={i}>
            <CardContent className="p-4 text-center">
              <Skeleton className="h-4 w-16 mx-auto mb-2" />
              <Skeleton className="h-8 w-12 mx-auto" />
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Recent Trades Skeleton */}
      <Card>
        <CardHeader className="pb-3">
          <Skeleton className="h-5 w-32" />
        </CardHeader>
        <CardContent className="space-y-3">
          {[1, 2, 3, 4, 5].map((i) => (
            <div
              key={i}
              className="p-3 bg-secondary/30 rounded-lg border border-border/50"
            >
              <div className="flex items-center justify-between mb-2">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-5 w-14 rounded-full" />
              </div>
              <div className="flex items-center justify-between">
                <Skeleton className="h-3 w-20" />
                <Skeleton className="h-4 w-16" />
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

export function ProfileDashboard({
  level,
  xp,
  stats,
  recentTrades,
  walletData,
  isLoading,
  className,
}: ProfileDashboardProps) {
  if (isLoading) {
    return <ProfileDashboardSkeleton />;
  }

  // Calculate XP progress within current level range
  const totalRange = MAX_LEVEL - MIN_LEVEL; // 15 levels total
  const normalizedLevel = ((level - MIN_LEVEL) / totalRange) * 100;

  const isPositiveLevel = level > 0;
  const isNegativeLevel = level < 0;
  const isLiquidated = level <= MIN_LEVEL;
  const walletBalanceUsd = walletData?.balanceUsd ?? walletData?.balanceUsdc ?? null;
  const walletTokenPositions = (walletData?.tokenPositions ?? []).slice(0, 6);
  const formatUsdValue = (value: number | null | undefined) => {
    if (typeof value !== "number" || !Number.isFinite(value)) return "N/A";
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: "USD",
      notation: Math.abs(value) >= 1000 ? "compact" : "standard",
      maximumFractionDigits: Math.abs(value) >= 1000 ? 1 : 2,
    }).format(value);
  };
  const formatTokenAmount = (value: number | null | undefined) => {
    if (typeof value !== "number" || !Number.isFinite(value)) return "N/A";
    return value.toLocaleString(undefined, { maximumFractionDigits: 4 });
  };

  return (
    <div className={cn("space-y-6", className)}>
      {/* XP & Level Progress Card */}
      <Card className="overflow-hidden border-primary/20 bg-gradient-to-br from-primary/5 via-card to-accent/5 dark:from-primary/10 dark:via-card dark:to-accent/10">
        <CardHeader className="pb-4">
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2 text-lg">
              <Trophy className="h-5 w-5 text-primary" />
              <span className="font-heading">Trader Reputation</span>
            </CardTitle>
            <LevelBadge level={level} size="lg" />
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Total XP Display */}
          <div className="p-4 bg-background/50 dark:bg-background/30 rounded-lg border border-border/50">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Total XP</span>
              <div className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-primary" />
                <span
                  className={cn(
                    "text-2xl font-bold font-mono",
                    isPositiveLevel && "text-gain",
                    isNegativeLevel && "text-loss",
                    level === 0 && "text-foreground"
                  )}
                >
                  {xp.toLocaleString()}
                </span>
              </div>
            </div>
          </div>

          {/* Large Level Progress Bar */}
          <div className="space-y-2">
            <LevelBar level={level} size="xl" />

            {/* Level Scale Labels */}
            <div className="flex justify-between text-xs text-muted-foreground">
              <span className="flex items-center gap-1">
                <TrendingDown className="h-3 w-3 text-loss" />
                -5 (Liquidated)
              </span>
              <span className="text-muted-foreground/70">0 (Start)</span>
              <span className="flex items-center gap-1">
                +10 (Alpha)
                <TrendingUp className="h-3 w-3 text-gain" />
              </span>
            </div>
          </div>

          {/* Level Progress Indicator */}
          <div className="flex items-center justify-center gap-2 pt-2">
            <Zap
              className={cn(
                "h-4 w-4",
                isPositiveLevel && "text-gain",
                isNegativeLevel && "text-loss",
                level === 0 && "text-muted-foreground"
              )}
            />
            <span className="text-sm text-muted-foreground">
              {isLiquidated
                ? "Account Liquidated"
                : isNegativeLevel
                  ? `${Math.abs(level)} levels below neutral`
                  : isPositiveLevel
                    ? `${level} levels above neutral`
                    : "Starting Level"}
            </span>
          </div>
        </CardContent>
      </Card>

      {/* Statistics Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {/* Total Alpha Calls */}
        <Card className="hover:border-primary/30 transition-colors">
          <CardContent className="p-4 text-center">
            <div className="flex items-center justify-center gap-1.5 text-muted-foreground mb-1">
              <Target className="h-4 w-4" />
              <span className="text-xs uppercase tracking-wider">
                Alpha Calls
              </span>
            </div>
            <p className="text-2xl font-bold font-mono text-foreground">
              {stats.totalCalls}
            </p>
          </CardContent>
        </Card>

        {/* Success Rate */}
        <Card className="hover:border-primary/30 transition-colors">
          <CardContent className="p-4 text-center">
            <div className="flex items-center justify-center gap-1.5 text-muted-foreground mb-1">
              <Percent className="h-4 w-4" />
              <span className="text-xs uppercase tracking-wider">
                Success Rate
              </span>
            </div>
            <p
              className={cn(
                "text-2xl font-bold font-mono",
                stats.winRate >= 50
                  ? "text-gain"
                  : stats.winRate > 0
                    ? "text-loss"
                    : "text-muted-foreground"
              )}
            >
              {stats.totalCalls > 0 ? `${stats.winRate.toFixed(1)}%` : "-"}
            </p>
          </CardContent>
        </Card>

        {/* Total Profit/Loss */}
        <Card className="hover:border-primary/30 transition-colors">
          <CardContent className="p-4 text-center">
            <div className="flex items-center justify-center gap-1.5 text-muted-foreground mb-1">
              <BarChart3 className="h-4 w-4" />
              <span className="text-xs uppercase tracking-wider">
                Total P/L
              </span>
            </div>
            <div className="flex items-center justify-center gap-1">
              {stats.totalProfitPercent > 0 && (
                <TrendingUp className="h-4 w-4 text-gain" />
              )}
              {stats.totalProfitPercent < 0 && (
                <TrendingDown className="h-4 w-4 text-loss" />
              )}
              <p
                className={cn(
                  "text-2xl font-bold font-mono",
                  stats.totalProfitPercent > 0
                    ? "text-gain"
                    : stats.totalProfitPercent < 0
                      ? "text-loss"
                      : "text-muted-foreground"
                )}
              >
                {stats.totalCalls > 0
                  ? `${stats.totalProfitPercent >= 0 ? "+" : ""}${stats.totalProfitPercent.toFixed(1)}%`
                  : "-"}
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Wins vs Losses */}
        <Card className="hover:border-primary/30 transition-colors">
          <CardContent className="p-4 text-center">
            <div className="flex items-center justify-center gap-1.5 text-muted-foreground mb-1">
              <Trophy className="h-4 w-4" />
              <span className="text-xs uppercase tracking-wider">
                W / L
              </span>
            </div>
            <div className="flex items-center justify-center gap-1">
              <span className="text-2xl font-bold font-mono text-gain">
                {stats.wins}
              </span>
              <span className="text-lg text-muted-foreground">/</span>
              <span className="text-2xl font-bold font-mono text-loss">
                {stats.losses}
              </span>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Web3 Wallet Data - Only show if wallet is connected */}
      {walletData?.connected && (
        <Card className="overflow-hidden border-accent/20 bg-gradient-to-br from-accent/5 via-card to-primary/5 dark:from-accent/10 dark:via-card dark:to-primary/10">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Wallet className="h-4 w-4 text-accent" />
              <span className="font-heading">Wallet Overview</span>
              {walletData.address && (
                <Badge variant="outline" className="ml-auto text-xs font-mono">
                  {walletData.address.slice(0, 4)}...{walletData.address.slice(-4)}
                </Badge>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Platform Coin Holdings */}
            {walletData.platformCoinHoldings !== undefined && (
              <div className="p-4 bg-background/50 dark:bg-background/30 rounded-lg border border-border/50">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Coins className="h-4 w-4 text-primary" />
                    <span className="text-sm text-muted-foreground">PHEW Holdings</span>
                  </div>
                  <span className="text-xl font-bold font-mono text-foreground">
                    {walletData.platformCoinHoldings.toLocaleString()}
                  </span>
                </div>
              </div>
            )}

            {/* Volume Stats */}
            <div className={cn("grid gap-3", walletData.totalProfitUsd != null ? "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3" : "grid-cols-2")}>
              {/* Total Bought */}
              <div className="p-3 bg-gain/5 rounded-lg border border-gain/20">
                <div className="flex items-center gap-1.5 text-gain mb-1">
                  <ArrowUpRight className="h-3.5 w-3.5" />
                  <span className="text-xs uppercase tracking-wider font-medium">Bought</span>
                </div>
                <div className="space-y-1">
                  <p className="text-lg font-bold font-mono text-foreground">
                    {walletData.totalVolumeBoughtSol?.toFixed(2) ?? "0.00"} SOL
                  </p>
                  <p className="text-xs text-muted-foreground font-mono">
                    ${walletData.totalVolumeBoughtUsd?.toLocaleString() ?? "0"}
                  </p>
                </div>
              </div>

              {/* Total Sold */}
              <div className="p-3 bg-loss/5 rounded-lg border border-loss/20">
                <div className="flex items-center gap-1.5 text-loss mb-1">
                  <ArrowDownRight className="h-3.5 w-3.5" />
                  <span className="text-xs uppercase tracking-wider font-medium">Sold</span>
                </div>
                <div className="space-y-1">
                  <p className="text-lg font-bold font-mono text-foreground">
                    {walletData.totalVolumeSoldSol?.toFixed(2) ?? "0.00"} SOL
                  </p>
                  <p className="text-xs text-muted-foreground font-mono">
                    ${walletData.totalVolumeSoldUsd?.toLocaleString() ?? "0"}
                  </p>
                </div>
              </div>

              {walletData.totalProfitUsd != null && (
                <div
                  className={cn(
                    "p-3 rounded-lg border",
                    walletData.totalProfitUsd >= 0
                      ? "bg-emerald-500/5 border-emerald-400/20"
                      : "bg-rose-500/5 border-rose-400/20"
                  )}
                >
                  <div
                    className={cn(
                      "flex items-center gap-1.5 mb-1",
                      walletData.totalProfitUsd >= 0 ? "text-gain" : "text-loss"
                    )}
                  >
                    {walletData.totalProfitUsd >= 0 ? (
                      <TrendingUp className="h-3.5 w-3.5" />
                    ) : (
                      <TrendingDown className="h-3.5 w-3.5" />
                    )}
                    <span className="text-xs uppercase tracking-wider font-medium">Wallet P/L</span>
                  </div>
                  <div className="space-y-1">
                    <p
                      className={cn(
                        "text-lg font-bold font-mono",
                        walletData.totalProfitUsd >= 0 ? "text-gain" : "text-loss"
                      )}
                    >
                      {formatUsdValue(walletData.totalProfitUsd)}
                    </p>
                    <p className="text-xs text-muted-foreground">Across posted Solana tokens</p>
                  </div>
                </div>
              )}
            </div>

            {/* Wallet Balances */}
            <div className="flex items-center gap-4 pt-2 border-t border-border/50">
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">Balance:</span>
                <span className="text-sm font-mono font-semibold text-foreground">
                  {walletData.balanceSol?.toFixed(4) ?? "0"} SOL
                </span>
              </div>
              <div className="h-4 w-px bg-border" />
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">USD:</span>
                <span className="text-sm font-mono font-semibold text-foreground">
                  {walletBalanceUsd != null ? formatUsdValue(walletBalanceUsd) : "N/A"}
                </span>
              </div>
            </div>

            {walletTokenPositions.length > 0 && (
              <div className="pt-2 border-t border-border/50">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <p className="text-xs uppercase tracking-wider text-muted-foreground">
                    Posted Token Positions
                  </p>
                  <Badge variant="outline" className="text-[10px]">
                    {walletTokenPositions.length} shown
                  </Badge>
                </div>
                <div className="space-y-2">
                  {walletTokenPositions.map((token) => {
                    const label = token.tokenSymbol || token.tokenName || `${token.mint.slice(0, 6)}...${token.mint.slice(-4)}`;
                    const subtitle =
                      token.tokenSymbol && token.tokenName ? token.tokenName : `${token.mint.slice(0, 6)}...${token.mint.slice(-4)}`;
                    const pnl = token.totalPnlUsd ?? null;
                    return (
                      <div
                        key={token.mint}
                        className="rounded-lg border border-border/50 bg-background/35 p-3"
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div className="flex min-w-0 items-center gap-2.5">
                            <div className="h-9 w-9 overflow-hidden rounded-full border border-border/50 bg-secondary/60 flex items-center justify-center">
                              {token.tokenImage ? (
                                <img
                                  src={token.tokenImage}
                                  alt={label}
                                  className="h-full w-full object-cover"
                                  loading="lazy"
                                />
                              ) : (
                                <Coins className="h-4 w-4 text-muted-foreground" />
                              )}
                            </div>
                            <div className="min-w-0">
                              <p className="truncate text-sm font-semibold text-foreground">{label}</p>
                              <p className="truncate text-xs text-muted-foreground">{subtitle}</p>
                            </div>
                          </div>
                          {pnl != null && (
                            <div
                              className={cn(
                                "text-right text-xs font-semibold",
                                pnl >= 0 ? "text-gain" : "text-loss"
                              )}
                            >
                              <div>{pnl >= 0 ? "+" : "-"}{formatUsdValue(Math.abs(pnl))}</div>
                              <div className="text-[10px] text-muted-foreground">Wallet P/L</div>
                            </div>
                          )}
                        </div>

                        <div className="mt-2 grid grid-cols-2 gap-2 text-xs md:grid-cols-4">
                          <div className="rounded-md border border-border/40 bg-background/40 p-2">
                            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Holding</div>
                            <div className="mt-1 font-mono text-foreground">{formatTokenAmount(token.holdingAmount)}</div>
                          </div>
                          <div className="rounded-md border border-border/40 bg-background/40 p-2">
                            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Holding USD</div>
                            <div className="mt-1 font-mono text-foreground">{formatUsdValue(token.holdingUsd)}</div>
                          </div>
                          <div className="rounded-md border border-border/40 bg-background/40 p-2">
                            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Bought</div>
                            <div className="mt-1 font-mono text-foreground">{formatTokenAmount(token.boughtAmount)}</div>
                          </div>
                          <div className="rounded-md border border-border/40 bg-background/40 p-2">
                            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Sold</div>
                            <div className="mt-1 font-mono text-foreground">{formatTokenAmount(token.soldAmount)}</div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Recent Trades (Last 5 Settled Posts) */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Clock className="h-4 w-4 text-muted-foreground" />
            <span className="font-heading">Recent Trades</span>
            <Badge variant="secondary" className="ml-auto text-xs">
              Last 5
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {recentTrades.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center mb-3">
                <BarChart3 className="h-6 w-6 text-muted-foreground" />
              </div>
              <p className="text-sm text-muted-foreground">
                No settled trades yet
              </p>
              <p className="text-xs text-muted-foreground/70 mt-1">
                Your recent trades will appear here once settled
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {recentTrades.slice(0, 5).map((trade, index) => {
                const percentChange = calculatePercentChange(
                  trade.entryMcap,
                  trade.currentMcap
                );
                const isWin = trade.isWin === true;

                return (
                  <div
                    key={trade.id}
                    className={cn(
                      "p-3 rounded-lg border transition-all duration-200",
                      "bg-secondary/30 dark:bg-secondary/20 border-border/50",
                      "hover:bg-secondary/50 dark:hover:bg-secondary/30",
                      isWin
                        ? "hover:border-gain/30"
                        : "hover:border-loss/30",
                      "animate-fade-in"
                    )}
                    style={{ animationDelay: `${index * 0.05}s` }}
                  >
                    <div className="flex items-start justify-between gap-2 mb-2">
                      {/* Trade Content Preview */}
                      <p className="text-sm text-foreground line-clamp-1 flex-1">
                        {trade.content.length > 50
                          ? `${trade.content.substring(0, 50)}...`
                          : trade.content}
                      </p>

                      {/* Win/Loss Badge */}
                      <Badge
                        className={cn(
                          "flex-shrink-0 gap-1",
                          isWin
                            ? "bg-gain/20 text-gain border-gain/30 hover:bg-gain/30"
                            : "bg-loss/20 text-loss border-loss/30 hover:bg-loss/30"
                        )}
                        variant="outline"
                      >
                        {isWin ? (
                          <>
                            <CheckCircle2 className="h-3 w-3" />
                            WIN
                          </>
                        ) : (
                          <>
                            <XCircle className="h-3 w-3" />
                            LOSS
                          </>
                        )}
                      </Badge>
                    </div>

                    <div className="flex items-center justify-between text-xs">
                      {/* Chain & Time */}
                      <div className="flex items-center gap-2 text-muted-foreground">
                        {trade.chainType && (
                          <span
                            className={cn(
                              "px-1.5 py-0.5 rounded text-[10px] font-bold uppercase border",
                              trade.chainType === "solana"
                                ? "bg-accent/15 text-accent border-accent/30 dark:bg-accent/20 dark:border-accent/40"
                                : "bg-primary/15 text-primary border-primary/30 dark:bg-primary/20 dark:border-primary/40"
                            )}
                          >
                            {trade.chainType}
                          </span>
                        )}
                        <span>{formatTimeAgo(trade.settledAt || trade.createdAt)}</span>
                      </div>

                      {/* Performance */}
                      <div className="flex items-center gap-1">
                        {percentChange !== null ? (
                          <>
                            {percentChange > 0 ? (
                              <TrendingUp className="h-3 w-3 text-gain" />
                            ) : (
                              <TrendingDown className="h-3 w-3 text-loss" />
                            )}
                            <span
                              className={cn(
                                "font-mono font-semibold",
                                percentChange > 0 ? "text-gain" : "text-loss"
                              )}
                            >
                              {percentChange >= 0 ? "+" : ""}
                              {percentChange.toFixed(1)}%
                            </span>
                          </>
                        ) : (
                          <span className="text-muted-foreground">N/A</span>
                        )}
                      </div>
                    </div>

                    {/* Entry & Current Market Cap */}
                    {trade.entryMcap && (
                      <div className="flex items-center gap-4 mt-2 pt-2 border-t border-border/30 text-[10px] text-muted-foreground">
                        <span>
                          Entry:{" "}
                          <span className="font-mono font-medium text-foreground">
                            {formatMarketCap(trade.entryMcap)}
                          </span>
                        </span>
                        <span>
                          Exit:{" "}
                          <span className="font-mono font-medium text-foreground">
                            {formatMarketCap(trade.currentMcap)}
                          </span>
                        </span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
