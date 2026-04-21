import type { RecentTrade, WalletData, WalletTokenPosition } from "@/components/profile/ProfileDashboard";

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

export type TraderPerformanceVM = {
  displayName: string;
  handle: string | null;
  avatarUrl: string | null;
  avatarFallback: string;
  bio: string | null;
  followersLabel: string;
  followingLabel: string;
  avgHoldLabel: string;
  tradeCountLabel: string;
  joinedLabel: string;
  heroValueLabel: string;
  heroSubValueLabel: string | null;
  heroSubCaption: string | null;
  heroSubTone: "gain" | "loss" | "neutral";
  chartPoints: number[];
  cashBalanceLabel: string | null;
  positionsHeading: string;
  positionsCountLabel: string | null;
  positions: PerformancePositionVM[];
};

export type LeaderboardRowVM = {
  id: string;
  rank: number;
  displayName: string;
  handle: string | null;
  avatarUrl: string | null;
  avatarFallback: string;
  valueLabel: string;
  valueTone: "gain" | "loss" | "neutral";
  subLabel: string;
  metaBadges: string[];
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
};

type LeaderboardTopUser = {
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

type LeaderboardMetricMode = "level" | "activity" | "winrate";

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
  return `Joined ${date.toLocaleDateString("en-US", {
    month: "short",
    year: "numeric",
  })}`;
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
    return `${Math.max(1, Math.round(totalHours * 60))}m avg hold`;
  }
  if (totalHours < 24) {
    return `${totalHours.toFixed(totalHours >= 10 ? 0 : 1)}h avg hold`;
  }

  const days = totalHours / 24;
  return `${days.toFixed(days >= 10 ? 0 : 1)}d avg hold`;
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

  return [4, 5, 5, 6, 8, 9, 11, 12, 14, 18, 17, 23];
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
    tokenLabel: trade.content || "Recent trade",
    tokenSubLabel: trade.chainType ? `${trade.chainType.toUpperCase()} call` : "Settled call",
    imageUrl: null,
    valueLabel: trade.currentMcap ? formatUsd(trade.currentMcap) : "Open in terminal",
    changeLabel: formatPercent(percentChange),
    changeTone:
      percentChange === null ? "neutral" : percentChange >= 0 ? "gain" : "loss",
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
    followersLabel: `${formatCompactNumber(input.followersCount)} Followers`,
    followingLabel: `${formatCompactNumber(input.followingCount)} Following`,
    avgHoldLabel: formatAverageHoldLabel(recentTrades),
    tradeCountLabel: `${formatCompactNumber(recentTradeCount)} trades`,
    joinedLabel: formatJoinDate(input.joinedAt),
    heroValueLabel: totalPnlUsd !== null ? formatUsd(totalPnlUsd) : `${formatCompactNumber(recentTradeCount)} trades`,
    heroSubValueLabel:
      totalPnlUsd !== null
        ? recent24hCount > 0
          ? `${recent24hCount} closed trades`
          : "No closed trades"
        : recent24hCount > 0
          ? `${recent24hCount} closed trades`
          : null,
    heroSubCaption: recent24hCount > 0 ? "24h activity" : totalPnlUsd !== null ? "24h activity" : null,
    heroSubTone: totalPnlUsd !== null && totalPnlUsd >= 0 ? "gain" : totalPnlUsd !== null ? "loss" : "neutral",
    chartPoints: buildSparklinePoints(walletData, recentTrades),
    cashBalanceLabel:
      walletData?.balanceUsd != null
        ? formatUsd(walletData.balanceUsd)
        : walletData?.balanceUsdc != null
          ? formatUsd(walletData.balanceUsdc)
          : null,
    positionsHeading: tokenPositions.length > 0 ? "Open positions" : "Recent calls",
    positionsCountLabel: positions.length > 0 ? `${positions.length}` : null,
    positions,
  };
}

export function buildLeaderboardRowsVm(
  users: LeaderboardTopUser[],
  mode: LeaderboardMetricMode
): LeaderboardRowVM[] {
  return users.map((item) => {
    const valueLabel =
      mode === "activity"
        ? `${item.stats.recentAlphas ?? item.stats.totalAlphas ?? 0}`
        : mode === "winrate"
          ? `${item.stats.winRate.toFixed(1)}%`
          : `LVL ${item.user.level}`;

    const subLabel =
      mode === "activity"
        ? `${item.stats.totalAlphas} total calls`
        : mode === "winrate"
          ? `${item.stats.wins}W / ${item.stats.losses}L`
          : `${item.user.xp.toLocaleString()} XP`;

    return {
      id: item.user.id,
      rank: item.rank,
      displayName: item.user.name || item.user.username || "Anonymous",
      handle: item.user.username ? `@${item.user.username}` : null,
      avatarUrl: item.user.image ?? null,
      avatarFallback: (item.user.name || item.user.username || "?").charAt(0).toUpperCase(),
      valueLabel,
      valueTone:
        mode === "winrate"
          ? item.stats.winRate >= 60
            ? "gain"
            : item.stats.winRate > 40
              ? "neutral"
              : "loss"
          : mode === "activity"
            ? "gain"
            : "neutral",
      subLabel,
      metaBadges: [
        `${item.stats.totalAlphas} calls`,
        `${item.stats.winRate.toFixed(0)}% win`,
      ],
    };
  });
}

export function buildPinnedRankVm(
  users: LeaderboardTopUser[],
  currentUserId: string | null,
  mode: LeaderboardMetricMode
): LeaderboardPinnedRankVM | null {
  if (!currentUserId) return null;
  const row = users.find((item) => item.user.id === currentUserId);
  if (!row) return null;

  const valueLabel =
    mode === "activity"
      ? `${row.stats.recentAlphas ?? row.stats.totalAlphas ?? 0} trades`
      : mode === "winrate"
        ? `${row.stats.winRate.toFixed(1)}% win rate`
        : `${row.user.xp.toLocaleString()} XP`;

  return {
    title: "Your rank",
    rankLabel: `#${row.rank}`,
    valueLabel,
    valueTone: mode === "winrate" && row.stats.winRate >= 60 ? "gain" : "neutral",
    avatarUrl: row.user.image ?? null,
    avatarFallback: (row.user.name || row.user.username || "?").charAt(0).toUpperCase(),
  };
}
