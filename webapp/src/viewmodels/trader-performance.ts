import type { RecentTrade, WalletData, WalletTokenPosition } from "@/components/profile/ProfileDashboard";

export type PerformancePeriod = "24h" | "7d" | "30d" | "all";

export type PerformancePositionVM = {
  id: string;
  tokenLabel: string;
  tokenSubLabel: string;
  imageUrl: string | null;
  valueLabel: string;
  changeLabel: string | null;
  changeTone: "gain" | "loss" | "neutral";
  href: string | null;
};

export type PerformanceStatVM = {
  label: string;
  value: string;
};

export type TraderPerformanceVM = {
  displayName: string;
  handle: string | null;
  avatarUrl: string | null;
  avatarFallback: string;
  bio: string | null;
  surfaceLabel: string;
  stats: PerformanceStatVM[];
  heroLabel: string;
  heroValueLabel: string;
  heroSubValueLabel: string | null;
  heroSubCaption: string | null;
  heroSubTone: "gain" | "loss" | "neutral";
  chartLabel: string;
  chartPoints: number[];
  cashBalanceLabel: string | null;
  positionsHeading: string;
  positionsCountLabel: string | null;
  positionsCaption: string | null;
  positions: PerformancePositionVM[];
};

export type LeaderboardRowVM = {
  id: string;
  rank: number;
  displayName: string;
  handle: string | null;
  avatarUrl: string | null;
  avatarFallback: string;
  metadataLabel: string;
  valueLabel: string;
  valueTone: "gain" | "loss" | "neutral";
  changeLabel: string | null;
  changeTone: "gain" | "loss" | "neutral";
  recentTokens: Array<{
    address: string;
    symbol: string | null;
    image: string | null;
  }>;
  trendPoints: number[];
  followersLabel: string;
};

export type LeaderboardPinnedRankVM = {
  title: string;
  rankLabel: string;
  valueLabel: string;
  valueTone: "gain" | "loss" | "neutral";
  avatarUrl: string | null;
  avatarFallback: string;
};

type TraderPerformanceInput = {
  displayName: string;
  handle?: string | null;
  avatarUrl?: string | null;
  bio?: string | null;
  followersCount?: number | null;
  followingCount?: number | null;
  joinedAt?: string | null;
  walletData?: WalletData | null;
  recentTrades?: RecentTrade[];
  postsFallbackHrefBuilder?: (address: string | null) => string | null;
  chartPointsOverride?: number[] | null;
  heroLabelOverride?: string | null;
  heroValueLabelOverride?: string | null;
  heroSubValueLabelOverride?: string | null;
  heroSubCaptionOverride?: string | null;
  heroSubToneOverride?: "gain" | "loss" | "neutral";
  positionsHeadingOverride?: string | null;
  positionsCaptionOverride?: string | null;
  surfaceLabelOverride?: string | null;
  chartLabelOverride?: string | null;
  statsOverride?: PerformanceStatVM[] | null;
};

type LeaderboardPerformanceEntry = {
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
    settledCount?: number;
    firstCallCount: number;
  };
  recentTokens: Array<{
    address: string;
    symbol: string | null;
    image: string | null;
  }>;
  trendPoints?: number[];
};

export type UserPerformanceSnapshot = {
  source: "wallet" | "calls";
  user: {
    id: string;
    name: string;
    username: string | null;
    image: string | null;
    bio: string | null;
    createdAt: string;
    isVerified: boolean;
    followersCount: number;
    followingCount: number;
  };
  callMetrics: {
    callsCount: number;
    winRate7d: number | null;
    winRate30d: number | null;
    avgRoi7d: number | null;
    avgRoi30d: number | null;
    trustScore: number | null;
    reputationTier: string | null;
    firstCallCount: number;
    firstCallAvgRoi: number | null;
  };
  periodMetrics: Record<
    PerformancePeriod,
    {
      callsCount: number;
      settledCount: number;
      avgRoi: number | null;
      winRate: number | null;
      trustScore: number | null;
    }
  >;
  walletOverview: WalletData | null;
  chartPoints: number[];
  recentCalls: Array<{
    id: string;
    content: string;
    contractAddress: string | null;
    chainType: string | null;
    tokenName: string | null;
    tokenSymbol: string | null;
    tokenImage: string | null;
    entryMcap: number | null;
    currentMcap: number | null;
    settledAt: string | null;
    createdAt: string;
    isWin: boolean | null;
  }>;
};

function formatCompactNumber(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "0";
  return new Intl.NumberFormat(undefined, {
    notation: value >= 1000 ? "compact" : "standard",
    maximumFractionDigits: value >= 1000 ? 1 : 0,
  }).format(value);
}

function formatUsd(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "$0.00";
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: Math.abs(value) >= 1000 ? 0 : 2,
  }).format(value);
}

function formatSignedUsd(value: number | null | undefined): string | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const formatted = formatUsd(Math.abs(value));
  return `${value >= 0 ? "+" : "-"}${formatted.replace("$", "$")}`;
}

function formatPercent(value: number | null | undefined, fractionDigits = 1): string | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return `${value >= 0 ? "+" : ""}${value.toFixed(fractionDigits)}%`;
}

function formatJoinDate(dateString: string | null | undefined): string {
  if (!dateString) return "Joined recently";
  const date = new Date(dateString);
  if (Number.isNaN(date.getTime())) return "Joined recently";
  return date.toLocaleDateString("en-US", {
    month: "short",
    year: "numeric",
  });
}

function formatAverageHoldLabel(trades: RecentTrade[]): string {
  const holdDurationsMs = trades
    .filter((trade) => trade.settledAt)
    .map((trade) => {
      const openedAt = new Date(trade.createdAt).getTime();
      const closedAt = new Date(trade.settledAt ?? trade.createdAt).getTime();
      return closedAt - openedAt;
    })
    .filter((duration) => Number.isFinite(duration) && duration > 0);

  if (holdDurationsMs.length === 0) {
    return "No closed holds";
  }

  const averageMs = holdDurationsMs.reduce((sum, value) => sum + value, 0) / holdDurationsMs.length;
  const totalHours = averageMs / (1000 * 60 * 60);

  if (totalHours < 1) {
    return `${Math.max(1, Math.round(totalHours * 60))}m`;
  }
  if (totalHours < 24) {
    return `${totalHours.toFixed(totalHours >= 10 ? 0 : 1)}h`;
  }

  const days = totalHours / 24;
  return `${days.toFixed(days >= 10 ? 0 : 1)}d`;
}

function buildSparklinePoints(walletData: WalletData | null | undefined, recentTrades: RecentTrade[]): number[] {
  const positionSeries = (walletData?.tokenPositions ?? [])
    .map((position) => position.totalPnlUsd ?? position.holdingUsd ?? 0)
    .filter((value) => Number.isFinite(value));

  if (positionSeries.length > 1) {
    return cumulativeSeries(positionSeries);
  }

  const tradeSeries = recentTrades
    .slice()
    .sort((left, right) => {
      const leftAt = new Date(left.settledAt ?? left.createdAt).getTime();
      const rightAt = new Date(right.settledAt ?? right.createdAt).getTime();
      return leftAt - rightAt;
    })
    .map((trade) => {
      const changePct = trade.entryMcap && trade.currentMcap
        ? ((trade.currentMcap - trade.entryMcap) / trade.entryMcap) * 100
        : 0;
      return Number.isFinite(changePct) ? changePct : 0;
    });

  if (tradeSeries.length > 1) {
    return cumulativeSeries(tradeSeries);
  }

  return [2, 4, 6, 8, 7, 10, 12, 16, 14, 18, 24, 27];
}

function cumulativeSeries(values: number[]): number[] {
  let total = 0;
  return values.map((value) => {
    total += value;
    return Number(total.toFixed(2));
  });
}

function buildWalletPositionVm(
  position: WalletTokenPosition,
  buildHref?: (address: string | null) => string | null
): PerformancePositionVM {
  const value = position.holdingUsd ?? position.totalPnlUsd ?? 0;
  const pnl = position.totalPnlUsd ?? null;
  return {
    id: position.mint,
    tokenLabel: position.tokenName || position.tokenSymbol || `${position.mint.slice(0, 6)}...${position.mint.slice(-4)}`,
    tokenSubLabel:
      typeof position.holdingAmount === "number" && Number.isFinite(position.holdingAmount)
        ? `${position.holdingAmount.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${position.tokenSymbol ?? ""}`.trim()
        : position.tokenSymbol || `${position.mint.slice(0, 6)}...${position.mint.slice(-4)}`,
    imageUrl: position.tokenImage ?? null,
    valueLabel: formatUsd(value),
    changeLabel: formatSignedUsd(pnl),
    changeTone: pnl === null ? "neutral" : pnl >= 0 ? "gain" : "loss",
    href: buildHref?.(position.mint) ?? null,
  };
}

function buildRecentTradePositionVm(
  trade: RecentTrade,
  buildHref?: (address: string | null) => string | null
): PerformancePositionVM {
  const percentChange =
    trade.entryMcap && trade.currentMcap
      ? ((trade.currentMcap - trade.entryMcap) / trade.entryMcap) * 100
      : null;
  return {
    id: trade.id,
    tokenLabel: trade.content || "Recent call",
    tokenSubLabel: trade.chainType ? `${trade.chainType.toUpperCase()} signal` : "Settled call",
    imageUrl: null,
    valueLabel: trade.currentMcap ? formatUsd(trade.currentMcap) : "Open terminal",
    changeLabel: formatPercent(percentChange),
    changeTone: percentChange === null ? "neutral" : percentChange >= 0 ? "gain" : "loss",
    href: buildHref?.(trade.contractAddress) ?? null,
  };
}

export function buildTraderPerformanceVm(input: TraderPerformanceInput): TraderPerformanceVM {
  const recentTrades = input.recentTrades ?? [];
  const walletData = input.walletData ?? null;
  const tokenPositions = walletData?.tokenPositions ?? [];
  const positions =
    tokenPositions.length > 0
      ? tokenPositions.slice(0, 6).map((position) => buildWalletPositionVm(position, input.postsFallbackHrefBuilder))
      : recentTrades.slice(0, 6).map((trade) => buildRecentTradePositionVm(trade, input.postsFallbackHrefBuilder));

  const totalPnlUsd = walletData?.totalProfitUsd ?? null;
  const recentTradeCount = recentTrades.length;
  const recent24hCount = recentTrades.filter((trade) => {
    const settledAt = new Date(trade.settledAt ?? trade.createdAt).getTime();
    return Number.isFinite(settledAt) && Date.now() - settledAt <= 24 * 60 * 60 * 1000;
  }).length;

  return {
    displayName: input.displayName,
    handle: input.handle ?? null,
    avatarUrl: input.avatarUrl ?? null,
    avatarFallback: input.displayName.charAt(0).toUpperCase() || "?",
    bio: input.bio ?? null,
    surfaceLabel: input.surfaceLabelOverride ?? (tokenPositions.length > 0 ? "Wallet performance" : "Call performance"),
    stats:
      input.statsOverride ??
      [
        { label: "Followers", value: formatCompactNumber(input.followersCount) },
        { label: "Following", value: formatCompactNumber(input.followingCount) },
        { label: "Avg hold", value: formatAverageHoldLabel(recentTrades) },
        { label: "Joined", value: formatJoinDate(input.joinedAt) },
      ],
    heroLabel: input.heroLabelOverride ?? (tokenPositions.length > 0 ? "Net portfolio PnL" : "Call performance"),
    heroValueLabel:
      input.heroValueLabelOverride ??
      (totalPnlUsd !== null ? formatUsd(totalPnlUsd) : `${formatCompactNumber(recentTradeCount)} calls`),
    heroSubValueLabel:
      input.heroSubValueLabelOverride !== undefined
        ? input.heroSubValueLabelOverride
        : recent24hCount > 0
          ? `${recent24hCount} closed`
          : null,
    heroSubCaption:
      input.heroSubCaptionOverride !== undefined
        ? input.heroSubCaptionOverride
        : recent24hCount > 0
          ? "last 24h"
          : null,
    heroSubTone:
      input.heroSubToneOverride ??
      (totalPnlUsd !== null && totalPnlUsd >= 0 ? "gain" : totalPnlUsd !== null ? "loss" : "neutral"),
    chartLabel: input.chartLabelOverride ?? "Performance curve",
    chartPoints:
      input.chartPointsOverride && input.chartPointsOverride.length > 0
        ? input.chartPointsOverride
        : buildSparklinePoints(walletData, recentTrades),
    cashBalanceLabel:
      walletData?.balanceUsd != null
        ? formatUsd(walletData.balanceUsd)
        : walletData?.balanceUsdc != null
          ? formatUsd(walletData.balanceUsdc)
          : null,
    positionsHeading: input.positionsHeadingOverride ?? (tokenPositions.length > 0 ? "Live positions" : "Recent calls"),
    positionsCountLabel: positions.length > 0 ? `${positions.length}` : null,
    positionsCaption:
      input.positionsCaptionOverride ??
      (tokenPositions.length > 0 ? "Wallet-synced holdings" : "Latest settled calls"),
    positions,
  };
}

export function buildTraderPerformanceVmFromSnapshot(params: {
  snapshot: UserPerformanceSnapshot;
  avatarUrl: string | null;
  selectedPeriod: PerformancePeriod;
  postsFallbackHrefBuilder?: (address: string | null) => string | null;
}): TraderPerformanceVM {
  const { snapshot, selectedPeriod } = params;
  const recentTrades: RecentTrade[] = snapshot.recentCalls.map((call) => ({
    id: call.id,
    content: call.content || call.tokenName || call.tokenSymbol || "Recent call",
    contractAddress: call.contractAddress,
    chainType: call.chainType,
    entryMcap: call.entryMcap,
    currentMcap: call.currentMcap,
    settled: true,
    settledAt: call.settledAt,
    isWin: call.isWin,
    createdAt: call.createdAt,
  }));
  const periodMetrics = snapshot.periodMetrics[selectedPeriod];
  const periodLabel = selectedPeriod === "all" ? "All time" : selectedPeriod;

  return buildTraderPerformanceVm({
    displayName: snapshot.user.name || snapshot.user.username || "Trader",
    handle: snapshot.user.username ? `@${snapshot.user.username}` : null,
    avatarUrl: params.avatarUrl,
    bio: snapshot.user.bio,
    followersCount: snapshot.user.followersCount,
    followingCount: snapshot.user.followingCount,
    joinedAt: snapshot.user.createdAt,
    walletData: snapshot.walletOverview ?? undefined,
    recentTrades,
    postsFallbackHrefBuilder: params.postsFallbackHrefBuilder,
    chartPointsOverride: snapshot.chartPoints,
    heroLabelOverride: snapshot.source === "wallet" ? "Net portfolio PnL" : `${periodLabel} call return`,
    heroValueLabelOverride:
      snapshot.source === "wallet"
        ? undefined
        : formatPercent(periodMetrics.avgRoi, 1) ?? `${formatCompactNumber(periodMetrics.callsCount)} calls`,
    heroSubValueLabelOverride:
      snapshot.source === "wallet"
        ? undefined
        : periodMetrics.winRate !== null && Number.isFinite(periodMetrics.winRate)
          ? `${periodMetrics.winRate.toFixed(0)}% win rate`
          : periodMetrics.trustScore !== null && Number.isFinite(periodMetrics.trustScore)
            ? `${periodMetrics.trustScore.toFixed(0)} trust`
            : null,
    heroSubCaptionOverride:
      snapshot.source === "wallet"
        ? undefined
        : `${periodMetrics.settledCount} settled | ${periodMetrics.callsCount} calls`,
    heroSubToneOverride:
      snapshot.source === "wallet"
        ? "neutral"
        : periodMetrics.avgRoi !== null && Number.isFinite(periodMetrics.avgRoi)
          ? periodMetrics.avgRoi >= 0
            ? "gain"
            : "loss"
          : "neutral",
    positionsHeadingOverride: snapshot.source === "wallet" ? "Live positions" : "Recent calls",
    positionsCaptionOverride:
      snapshot.source === "wallet"
        ? "Wallet-synced holdings"
        : `Calls settled from ${periodLabel.toLowerCase()}`,
    surfaceLabelOverride: snapshot.source === "wallet" ? "Wallet performance" : "Calls performance",
    chartLabelOverride:
      snapshot.source === "wallet"
        ? "Wallet PnL curve"
        : `${periodLabel} call-performance curve`,
    statsOverride: [
      { label: "Followers", value: formatCompactNumber(snapshot.user.followersCount) },
      { label: "Following", value: formatCompactNumber(snapshot.user.followingCount) },
      { label: "Calls", value: formatCompactNumber(periodMetrics.callsCount) },
      { label: "Settled", value: formatCompactNumber(periodMetrics.settledCount) },
      { label: "Avg hold", value: formatAverageHoldLabel(recentTrades) },
      { label: "Joined", value: formatJoinDate(snapshot.user.createdAt) },
    ],
  });
}

export function buildLeaderboardRowsVm(
  users: LeaderboardPerformanceEntry[]
): LeaderboardRowVM[] {
  return users.map((item) => {
    const avgRoi = item.performance.avgRoi;
    const winRate = item.performance.winRate;
    const trustScore = item.performance.trustScore;
    const settledCount = item.performance.settledCount ?? 0;

    return {
      id: item.user.id,
      rank: item.rank,
      displayName: item.user.name || item.user.username || "Anonymous",
      handle: item.user.username ? `@${item.user.username}` : null,
      avatarUrl: item.user.image ?? null,
      avatarFallback: (item.user.name || item.user.username || "?").charAt(0).toUpperCase(),
      metadataLabel: `${item.performance.callsCount} calls • ${settledCount} settled`,
      valueLabel: formatPercent(avgRoi, 1) ?? "0.0%",
      valueTone: avgRoi === null ? "neutral" : avgRoi >= 0 ? "gain" : "loss",
      changeLabel:
        winRate !== null && Number.isFinite(winRate)
          ? `${winRate.toFixed(0)}% win`
          : trustScore !== null && Number.isFinite(trustScore)
            ? `${trustScore.toFixed(0)} trust`
            : null,
      changeTone:
        winRate !== null && Number.isFinite(winRate)
          ? winRate >= 60
            ? "gain"
            : winRate >= 40
              ? "neutral"
              : "loss"
          : "neutral",
      recentTokens: item.recentTokens ?? [],
      trendPoints: item.trendPoints ?? [],
      followersLabel: formatCompactNumber(item.user.followersCount ?? 0),
    };
  });
}

export function buildPinnedRankVm(
  entry: LeaderboardPerformanceEntry | null | undefined,
  currentUserId: string | null
): LeaderboardPinnedRankVM | null {
  if (!currentUserId || !entry) return null;

  return {
    title: "Your rank",
    rankLabel: `#${entry.rank}`,
    valueLabel: formatPercent(entry.performance.avgRoi, 1) ?? "0.0%",
    valueTone:
      typeof entry.performance.avgRoi === "number" && Number.isFinite(entry.performance.avgRoi)
        ? entry.performance.avgRoi >= 0
          ? "gain"
          : "loss"
        : "neutral",
    avatarUrl: entry.user.image ?? null,
    avatarFallback: (entry.user.name || entry.user.username || "?").charAt(0).toUpperCase(),
  };
}
