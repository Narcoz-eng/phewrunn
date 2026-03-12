import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Post, PostAuthor, ReactionCounts, formatMarketCap, formatTimeAgo, getAvatarUrl } from "@/types";
import { Button } from "@/components/ui/button";
import { ArrowLeft, AlertCircle, BarChart3, Coins, ExternalLink, Loader2, ShieldAlert, TrendingUp, Users } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { PostCard } from "@/components/feed/PostCard";
import { TokenScanningState } from "@/components/feed/TokenScanningState";
import { CandlestickChart } from "@/components/feed/CandlestickChart";
import { cn } from "@/lib/utils";
import { useSession } from "@/lib/auth-client";
import { readSessionCache, writeSessionCache } from "@/lib/session-cache";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { toast } from "sonner";
import { PhewTradeIcon } from "@/components/icons/PhewIcons";

const TOKEN_PAGE_CACHE_TTL_MS = 75_000;
const TOKEN_LIVE_CHART_VISIBLE_POINTS = 72;
const TOKEN_LIVE_CHART_FUTURE_SLOTS = 6;
const TOKEN_CHART_INTERVAL_OPTIONS = [
  { value: "5", label: "5m" },
  { value: "15", label: "15m" },
  { value: "60", label: "1h" },
  { value: "240", label: "4h" },
  { value: "1D", label: "1D" },
] as const;
const TOKEN_QUICK_BUY_PRESETS = ["0.10", "0.20", "0.50", "1.00"] as const;

type TokenChartIntervalValue = (typeof TOKEN_CHART_INTERVAL_OPTIONS)[number]["value"];

type TokenChartPoint = {
  timestamp: string;
  marketCap: number | null;
  liquidity: number | null;
  volume24h: number | null;
  holderCount: number | null;
  sentimentScore: number | null;
  confidenceScore: number | null;
};

type TokenChartCandle = {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

type TokenChartCandlesSource = "birdeye" | "geckoterminal" | "unknown";

type TokenChartCandlesResponse = {
  candles: TokenChartCandle[];
  source: TokenChartCandlesSource;
  network: string | null;
};

type TokenTrader = PostAuthor & {
  callsCount: number;
  avgConfidenceScore: number;
  bestRoiPct: number;
};

type TokenHolder = {
  address: string;
  ownerAddress: string | null;
  tokenAccountAddress: string | null;
  amount: number | null;
  supplyPct: number;
  valueUsd: number | null;
  label: string | null;
  domain: string | null;
  accountType: string | null;
  activeAgeDays: number | null;
  fundedBy: string | null;
  totalValueUsd: number | null;
  tradeVolume90dSol: number | null;
  solBalance: number | null;
  badges: Array<
    "dev_wallet" |
    "fresh_wallet" |
    "high_volume_trader" |
    "whale" |
    "serial_deployer" |
    "serial_rugger"
  >;
  devRole: "creator" | "mint_authority" | "freeze_authority" | null;
};

type TokenRisk = {
  tokenRiskScore: number | null;
  bundleRiskLabel: string | null;
  largestHolderPct: number | null;
  top10HolderPct: number | null;
  bundledWalletCount: number | null;
  estimatedBundledSupplyPct: number | null;
  deployerSupplyPct: number | null;
  holderCount: number | null;
  topHolders: TokenHolder[];
  devWallet: TokenHolder | null;
};

type TokenBundleCluster = {
  id?: string;
  clusterLabel: string;
  walletCount: number;
  estimatedSupplyPct: number;
  evidenceJson?: unknown;
};

type TokenTimelineEvent = {
  id: string;
  eventType: string;
  timestamp: string;
  marketCap: number | null;
  liquidity: number | null;
  volume: number | null;
  traderId: string | null;
  postId: string | null;
  metadata?: {
    traderHandle?: string | null;
    traderName?: string | null;
    timingTier?: string | null;
    confidenceScore?: number | null;
  } | null;
};

type TokenPageData = {
  id: string;
  address: string;
  chainType: string;
  symbol: string | null;
  name: string | null;
  imageUrl: string | null;
  dexscreenerUrl: string | null;
  pairAddress?: string | null;
  marketCap: number | null;
  liquidity: number | null;
  volume24h: number | null;
  holderCount: number | null;
  holderCountSource?: "stored" | "helius" | "rpc_scan" | "birdeye" | "largest_accounts" | null;
  largestHolderPct: number | null;
  top10HolderPct: number | null;
  deployerSupplyPct: number | null;
  bundledWalletCount: number | null;
  estimatedBundledSupplyPct: number | null;
  bundleRiskLabel: string | null;
  tokenRiskScore: number | null;
  sentimentScore: number | null;
  radarScore: number | null;
  confidenceScore: number | null;
  hotAlphaScore: number | null;
  earlyRunnerScore: number | null;
  highConvictionScore: number | null;
  isEarlyRunner: boolean;
  isFollowing: boolean;
  earlyRunnerReasons?: string[];
  topHolders: TokenHolder[];
  devWallet: TokenHolder | null;
  bundleClusters: TokenBundleCluster[];
  chart: TokenChartPoint[];
  callsCount: number;
  distinctTraders: number;
  topTraders: TokenTrader[];
  sentiment: {
    score: number;
    reactions: ReactionCounts;
    bullishPct: number;
    bearishPct: number;
  };
  risk: TokenRisk;
  timeline: TokenTimelineEvent[];
  recentCalls: Post[];
};

type TokenLiveData = {
  marketCap: number | null;
  liquidity: number | null;
  volume24h: number | null;
  holderCount: number | null;
  holderCountSource?: "stored" | "helius" | "rpc_scan" | "birdeye" | "largest_accounts" | null;
  largestHolderPct: number | null;
  top10HolderPct: number | null;
  deployerSupplyPct: number | null;
  bundledWalletCount: number | null;
  estimatedBundledSupplyPct: number | null;
  bundleRiskLabel: string | null;
  tokenRiskScore: number | null;
  topHolders: TokenHolder[];
  devWallet: TokenHolder | null;
  bundleClusters: TokenBundleCluster[];
  dexscreenerUrl: string | null;
  pairAddress: string | null;
  dexId: string | null;
  imageUrl: string | null;
  symbol: string | null;
  name: string | null;
  priceUsd: number | null;
  priceChange24hPct: number | null;
  buys24h: number | null;
  sells24h: number | null;
  updatedAt: string;
};

function formatPct(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "N/A";
  return `${value.toFixed(1)}%`;
}

function formatIntegerMetric(
  value: number | null | undefined,
  options?: { zeroIsValid?: boolean; emptyLabel?: string }
): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return options?.emptyLabel ?? "Scanning";
  if (!options?.zeroIsValid && value <= 0) return options?.emptyLabel ?? "Scanning";
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(value);
}

function formatMarketMetric(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return "Scanning";
  return formatMarketCap(value);
}

function formatTokenPrice(value: number): string {
  if (!Number.isFinite(value)) return "-";
  if (value === 0) return "$0.00";
  if (Math.abs(value) < 0.000001) return `$${value.toExponential(2)}`;
  if (Math.abs(value) < 0.01) return `$${value.toFixed(6)}`;
  if (Math.abs(value) < 1) return `$${value.toFixed(4)}`;
  return `$${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`;
}

function formatHolderAmount(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return "Amount unavailable";
  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: value >= 1000 ? 1 : 2,
  }).format(value);
}

function formatSolMetric(value: number | null | undefined): string | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return null;
  return `${new Intl.NumberFormat("en-US", { maximumFractionDigits: value >= 100 ? 0 : 1 }).format(value)} SOL`;
}

function formatHolderAddress(address: string): string {
  const trimmed = address.trim();
  if (trimmed.length <= 12) return trimmed;
  return `${trimmed.slice(0, 4)}...${trimmed.slice(-4)}`;
}

function formatHolderBadge(badge: TokenHolder["badges"][number]): string {
  switch (badge) {
    case "dev_wallet":
      return "Dev wallet";
    case "fresh_wallet":
      return "Fresh";
    case "high_volume_trader":
      return "High volume";
    case "whale":
      return "Whale";
    case "serial_deployer":
      return "Serial deployer";
    case "serial_rugger":
      return "Serial rugger";
    default:
      return badge;
  }
}

function formatDaysMetric(value: number | null | undefined): string | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return null;
  return value < 1 ? "<1d" : `${Math.round(value)}d`;
}

function formatTimelineEventLabel(eventType: string): string {
  switch (eventType) {
    case "alpha_call":
      return "Alpha call";
    case "early_runner_detected":
      return "Early runner detected";
    case "hot_alpha_detected":
      return "Hot alpha detected";
    case "high_conviction_detected":
      return "High conviction signal";
    default:
      return eventType.replace(/_/g, " ");
  }
}

function buildTimelineCopy(event: TokenTimelineEvent): { title: string; description: string } {
  const traderLabel = event.metadata?.traderHandle || event.metadata?.traderName || "Phew engine";
  const eventLabel = formatTimelineEventLabel(event.eventType);
  const details = [
    event.marketCap ? `at ${formatMarketCap(event.marketCap)}` : null,
    event.metadata?.timingTier ?? null,
    typeof event.metadata?.confidenceScore === "number"
      ? `${event.metadata.confidenceScore.toFixed(0)}% confidence`
      : null,
  ].filter(Boolean);

  if (event.eventType === "alpha_call") {
    return {
      title: traderLabel,
      description: `${eventLabel}${details.length ? ` ${details.join(" | ")}` : ""}`,
    };
  }

  return {
    title: eventLabel,
    description: `${traderLabel}${details.length ? ` | ${details.join(" | ")}` : ""}`,
  };
}

function isTokenPageDataCacheable(token: TokenPageData | null | undefined): token is TokenPageData {
  if (!token) return false;
  const hasSignals = [
    token.confidenceScore,
    token.hotAlphaScore,
    token.earlyRunnerScore,
    token.highConvictionScore,
  ].some((value) => typeof value === "number" && Number.isFinite(value));
  const hasMarketData = [token.liquidity, token.volume24h, token.holderCount].some(
    (value) => typeof value === "number" && Number.isFinite(value) && value > 0
  );
  const hasChart = token.chart.some(
    (point) =>
      [point.marketCap, point.liquidity, point.volume24h, point.holderCount].some(
        (value) => typeof value === "number" && Number.isFinite(value) && value > 0
      )
  );

  return hasSignals || hasMarketData || hasChart || token.recentCalls.length > 0;
}

function pickMergedMetric(
  live: number | null | undefined,
  cached: number | null | undefined,
  options?: { positive?: boolean }
): number | null {
  if (typeof live === "number" && Number.isFinite(live) && (!options?.positive || live > 0)) {
    return live;
  }
  if (typeof cached === "number" && Number.isFinite(cached) && (!options?.positive || cached > 0)) {
    return cached;
  }
  return live ?? cached ?? null;
}

function hasResolvedHolderCount(
  holderCount: number | null | undefined,
  holderCountSource: TokenPageData["holderCountSource"] | TokenLiveData["holderCountSource"]
): boolean {
  return (
    typeof holderCount === "number" &&
    Number.isFinite(holderCount) &&
    holderCount > 0 &&
    holderCountSource !== "largest_accounts" &&
    holderCountSource !== null &&
    holderCountSource !== undefined
  );
}

function mergeTokenPageDataWithCached(
  live: TokenPageData,
  cached: TokenPageData | null | undefined
): TokenPageData {
  if (!cached) {
    return live;
  }

  const liveSentimentHasSignals =
    live.sentiment.score > 0 ||
    Object.values(live.sentiment.reactions).some((value) => value > 0);
  const liveRiskHasSignals =
    (typeof live.risk.tokenRiskScore === "number" && Number.isFinite(live.risk.tokenRiskScore)) ||
    (typeof live.risk.holderCount === "number" && Number.isFinite(live.risk.holderCount) && live.risk.holderCount > 0) ||
    typeof live.risk.bundleRiskLabel === "string";

  return {
    ...live,
    marketCap: pickMergedMetric(live.marketCap, cached.marketCap, { positive: true }),
    liquidity: pickMergedMetric(live.liquidity, cached.liquidity, { positive: true }),
    volume24h: pickMergedMetric(live.volume24h, cached.volume24h, { positive: true }),
    holderCount: pickMergedMetric(live.holderCount, cached.holderCount, { positive: true }),
    largestHolderPct: pickMergedMetric(live.largestHolderPct, cached.largestHolderPct),
    top10HolderPct: pickMergedMetric(live.top10HolderPct, cached.top10HolderPct),
    deployerSupplyPct: pickMergedMetric(live.deployerSupplyPct, cached.deployerSupplyPct),
    bundledWalletCount: pickMergedMetric(live.bundledWalletCount, cached.bundledWalletCount, { positive: true }),
    estimatedBundledSupplyPct: pickMergedMetric(live.estimatedBundledSupplyPct, cached.estimatedBundledSupplyPct),
    tokenRiskScore: pickMergedMetric(live.tokenRiskScore, cached.tokenRiskScore),
    sentimentScore: pickMergedMetric(live.sentimentScore, cached.sentimentScore),
    radarScore: pickMergedMetric(live.radarScore, cached.radarScore),
    confidenceScore: pickMergedMetric(live.confidenceScore, cached.confidenceScore),
    hotAlphaScore: pickMergedMetric(live.hotAlphaScore, cached.hotAlphaScore),
    earlyRunnerScore: pickMergedMetric(live.earlyRunnerScore, cached.earlyRunnerScore),
    highConvictionScore: pickMergedMetric(live.highConvictionScore, cached.highConvictionScore),
    bundleRiskLabel: live.bundleRiskLabel ?? cached.bundleRiskLabel,
    holderCountSource: live.holderCountSource ?? cached.holderCountSource,
    topHolders: live.topHolders.length > 0 ? live.topHolders : cached.topHolders,
    devWallet: live.devWallet ?? cached.devWallet,
    bundleClusters: live.bundleClusters.length > 0 ? live.bundleClusters : cached.bundleClusters,
    chart: live.chart.length > 1 ? live.chart : cached.chart,
    callsCount: live.callsCount > 0 ? live.callsCount : cached.callsCount,
    distinctTraders: live.distinctTraders > 0 ? live.distinctTraders : cached.distinctTraders,
    topTraders: live.topTraders.length > 0 ? live.topTraders : cached.topTraders,
    sentiment: liveSentimentHasSignals ? live.sentiment : cached.sentiment,
    risk: liveRiskHasSignals
      ? live.risk
      : {
          tokenRiskScore: pickMergedMetric(live.risk.tokenRiskScore, cached.risk.tokenRiskScore),
          bundleRiskLabel: live.risk.bundleRiskLabel ?? cached.risk.bundleRiskLabel,
          largestHolderPct: pickMergedMetric(live.risk.largestHolderPct, cached.risk.largestHolderPct),
          top10HolderPct: pickMergedMetric(live.risk.top10HolderPct, cached.risk.top10HolderPct),
          bundledWalletCount: pickMergedMetric(live.risk.bundledWalletCount, cached.risk.bundledWalletCount, { positive: true }),
          estimatedBundledSupplyPct: pickMergedMetric(
            live.risk.estimatedBundledSupplyPct,
            cached.risk.estimatedBundledSupplyPct
          ),
          deployerSupplyPct: pickMergedMetric(live.risk.deployerSupplyPct, cached.risk.deployerSupplyPct),
          holderCount: pickMergedMetric(live.risk.holderCount, cached.risk.holderCount, { positive: true }),
          topHolders: live.risk.topHolders.length > 0 ? live.risk.topHolders : cached.risk.topHolders,
          devWallet: live.risk.devWallet ?? cached.risk.devWallet,
        },
    timeline: live.timeline.length > 0 ? live.timeline : cached.timeline,
    recentCalls: live.recentCalls.length > 0 ? live.recentCalls : cached.recentCalls,
  };
}

function mergeTokenPageDataWithLiveSnapshot(
  current: TokenPageData,
  live: TokenLiveData
): TokenPageData {
  const holderCount = hasResolvedHolderCount(live.holderCount, live.holderCountSource)
    ? live.holderCount
    : hasResolvedHolderCount(current.holderCount, current.holderCountSource)
      ? current.holderCount
      : pickMergedMetric(live.holderCount, current.holderCount, { positive: true });
  const holderCountSource = hasResolvedHolderCount(live.holderCount, live.holderCountSource)
    ? live.holderCountSource ?? current.holderCountSource
    : hasResolvedHolderCount(current.holderCount, current.holderCountSource)
      ? current.holderCountSource
      : live.holderCountSource ?? current.holderCountSource;
  const largestHolderPct = pickMergedMetric(live.largestHolderPct, current.largestHolderPct);
  const top10HolderPct = pickMergedMetric(live.top10HolderPct, current.top10HolderPct);
  const deployerSupplyPct = pickMergedMetric(live.deployerSupplyPct, current.deployerSupplyPct);
  const bundledWalletCount = pickMergedMetric(live.bundledWalletCount, current.bundledWalletCount, { positive: true });
  const estimatedBundledSupplyPct = pickMergedMetric(live.estimatedBundledSupplyPct, current.estimatedBundledSupplyPct);
  const tokenRiskScore = pickMergedMetric(live.tokenRiskScore, current.tokenRiskScore);
  const bundleRiskLabel = live.bundleRiskLabel ?? current.bundleRiskLabel;
  const topHolders = live.topHolders.length > 0 ? live.topHolders : current.topHolders;
  const devWallet = live.devWallet ?? current.devWallet;
  const bundleClusters = live.bundleClusters.length > 0 ? live.bundleClusters : current.bundleClusters;

  return {
    ...current,
    symbol: live.symbol ?? current.symbol,
    name: live.name ?? current.name,
    imageUrl: live.imageUrl ?? current.imageUrl,
    dexscreenerUrl: live.dexscreenerUrl ?? current.dexscreenerUrl,
    pairAddress: live.pairAddress ?? current.pairAddress,
    marketCap: pickMergedMetric(live.marketCap, current.marketCap, { positive: true }),
    liquidity: pickMergedMetric(live.liquidity, current.liquidity, { positive: true }),
    volume24h: pickMergedMetric(live.volume24h, current.volume24h, { positive: true }),
    holderCount,
    holderCountSource,
    largestHolderPct,
    top10HolderPct,
    deployerSupplyPct,
    bundledWalletCount,
    estimatedBundledSupplyPct,
    bundleRiskLabel,
    tokenRiskScore,
    topHolders,
    devWallet,
    bundleClusters,
    risk: {
      ...current.risk,
      tokenRiskScore,
      bundleRiskLabel,
      largestHolderPct,
      top10HolderPct,
      bundledWalletCount,
      estimatedBundledSupplyPct,
      deployerSupplyPct,
      holderCount,
      topHolders,
      devWallet,
    },
  };
}

function scoreTone(value: number | null | undefined): string {
  const score = typeof value === "number" && Number.isFinite(value) ? value : 0;
  if (score >= 75) return "text-gain";
  if (score >= 55) return "text-foreground";
  return "text-muted-foreground";
}

function riskTone(label: string | null | undefined): string {
  if (label === "Clean") return "border-gain/30 bg-gain/10 text-gain";
  if (label === "Moderate Bundling") return "border-amber-400/35 bg-amber-400/10 text-amber-600 dark:text-amber-300";
  return "border-loss/30 bg-loss/10 text-loss";
}

export default function TokenPage() {
  const { tokenAddress } = useParams<{ tokenAddress: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const { data: session, canPerformAuthenticatedWrites } = useSession();
  const viewerScope = session?.user?.id ?? "anonymous";
  const tokenQueryKey = useMemo(
    () => ["token-page", viewerScope, tokenAddress] as const,
    [tokenAddress, viewerScope]
  );
  const tokenCacheKey = useMemo(
    () => (tokenAddress ? `phew.token-page.v9:${viewerScope}:${tokenAddress}` : null),
    [tokenAddress, viewerScope]
  );
  const cachedToken = useMemo(
    () => (tokenCacheKey ? readSessionCache<TokenPageData>(tokenCacheKey, TOKEN_PAGE_CACHE_TTL_MS) : null),
    [tokenCacheKey]
  );
  const recentCallsRef = useRef<HTMLDivElement | null>(null);
  const [pendingTradeCallId, setPendingTradeCallId] = useState<string | null>(null);
  const [pendingQuickBuyAmountSol, setPendingQuickBuyAmountSol] = useState<string | null>(null);
  const [chartInterval, setChartInterval] = useState<TokenChartIntervalValue>("15");
  const [hasConsumedTradeDeepLink, setHasConsumedTradeDeepLink] = useState(false);

  const {
    data: token,
    isLoading,
    isFetching,
    error,
  } = useQuery({
    queryKey: tokenQueryKey,
    queryFn: async () => {
      if (!tokenAddress) throw new Error("Token address is required");
      const data = await api.get<TokenPageData>(`/api/tokens/${tokenAddress}`);
      return mergeTokenPageDataWithCached(data, cachedToken);
    },
    initialData: cachedToken ?? undefined,
    placeholderData: (previousData) => previousData,
    enabled: !!tokenAddress,
    staleTime: 45_000,
    gcTime: 8 * 60_000,
    refetchOnMount: cachedToken ? false : "always",
    refetchOnWindowFocus: false,
    retry: 1,
  });

  const liveTokenQuery = useQuery<TokenLiveData>({
    queryKey: ["token-live", tokenAddress],
    enabled: Boolean(tokenAddress && token?.id),
    staleTime: 4_000,
    gcTime: 5 * 60_000,
    placeholderData: (previousData) => previousData,
    refetchOnWindowFocus: false,
    retry: 1,
    refetchInterval: 10_000,
    queryFn: async () => {
      if (!tokenAddress) throw new Error("Token address is required");
      const response = await api.raw(`/api/tokens/${tokenAddress}/live`, {
        method: "GET",
        cache: "no-store",
        timeout: 15_000,
      });

      if (!response.ok) {
        const payload = await response.text().catch(() => "");
        throw new Error(payload || `Live token request failed (${response.status})`);
      }

      const payload = (await response.json().catch(() => null)) as { data?: TokenLiveData } | null;
      if (!payload?.data) {
        throw new Error("Live token payload missing");
      }

      return payload.data;
    },
  });

  const recentCallsQuery = useQuery<Post[]>({
    queryKey: ["token-calls", viewerScope, tokenAddress],
    enabled: Boolean(tokenAddress),
    staleTime: 20_000,
    gcTime: 8 * 60_000,
    placeholderData: (previousData) => previousData,
    refetchOnWindowFocus: false,
    retry: 1,
    queryFn: async () => {
      if (!tokenAddress) throw new Error("Token address is required");
      return api.get<Post[]>(`/api/tokens/${tokenAddress}/calls`);
    },
  });

  useEffect(() => {
    if (!liveTokenQuery.data) return;
    queryClient.setQueryData<TokenPageData | undefined>(tokenQueryKey, (current) =>
      current ? mergeTokenPageDataWithLiveSnapshot(current, liveTokenQuery.data) : current
    );
  }, [liveTokenQuery.data, queryClient, tokenQueryKey]);

  useEffect(() => {
    if (!tokenCacheKey || !isTokenPageDataCacheable(token)) return;
    writeSessionCache(tokenCacheKey, token);
  }, [token, tokenCacheKey]);

  const chartRequestConfig = useMemo(() => {
    switch (chartInterval) {
      case "5":
        return { timeframe: "minute" as const, aggregate: 1, limit: 360 };
      case "15":
        return { timeframe: "minute" as const, aggregate: 5, limit: 360 };
      case "60":
        return { timeframe: "hour" as const, aggregate: 1, limit: 320 };
      case "240":
        return { timeframe: "hour" as const, aggregate: 4, limit: 320 };
      case "1D":
      default:
        return { timeframe: "day" as const, aggregate: 1, limit: 260 };
    }
  }, [chartInterval]);

  const liveChartQuery = useQuery<TokenChartCandlesResponse>({
    queryKey: [
      "token-live-chart",
      tokenAddress,
      token?.pairAddress ?? null,
      chartRequestConfig.timeframe,
      chartRequestConfig.aggregate,
      chartRequestConfig.limit,
    ],
    enabled: Boolean(tokenAddress && token && (token.pairAddress || token.address)),
    staleTime: 4_000,
    gcTime: 8 * 60_000,
    placeholderData: (previousData) => previousData,
    refetchOnWindowFocus: false,
    retry: 1,
    refetchInterval:
      chartRequestConfig.timeframe === "minute"
        ? chartRequestConfig.aggregate <= 5
          ? 8_000
          : 12_000
        : chartRequestConfig.timeframe === "hour"
          ? 20_000
          : 60_000,
    queryFn: async () => {
      if (!tokenAddress || !token) {
        return {
          candles: [],
          source: "unknown" as const,
          network: null,
        };
      }

      const response = await api.raw("/api/posts/chart/candles", {
        method: "POST",
        cache: "no-store",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          poolAddress: token.pairAddress ?? undefined,
          tokenAddress: token.address,
          chainType: token.chainType === "solana" ? "solana" : "ethereum",
          timeframe: chartRequestConfig.timeframe,
          aggregate: chartRequestConfig.aggregate,
          limit: chartRequestConfig.limit,
        }),
      });

      if (!response.ok) {
        const payload = await response.text().catch(() => "");
        throw new Error(payload || `Chart request failed (${response.status})`);
      }

      const payload = (await response.json().catch(() => null)) as
        | {
            data?: {
              candles?: TokenChartCandle[];
              source?: string;
              network?: string | null;
            };
          }
        | null;
      const sourceRaw = payload?.data?.source;
      return {
        candles: Array.isArray(payload?.data?.candles) ? payload.data.candles : [],
        source: sourceRaw === "birdeye" || sourceRaw === "geckoterminal" ? sourceRaw : "unknown",
        network: typeof payload?.data?.network === "string" ? payload.data.network : null,
      };
    },
  });

  const chartData = useMemo(
    () =>
      (token?.chart ?? []).map((point) => ({
        ...point,
        label: new Date(point.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      })),
    [token?.chart]
  );

  const liveChartData = useMemo(
    () =>
      (liveChartQuery.data?.candles ?? []).map((candle) => ({
        ts: candle.timestamp,
        open: candle.open,
        high: candle.high,
        low: candle.low,
        close: candle.close,
        volume: candle.volume,
        isBullish: candle.close >= candle.open,
        label: new Date(candle.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        fullLabel: new Date(candle.timestamp).toLocaleString([], {
          month: "short",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        }),
      })),
    [liveChartQuery.data?.candles]
  );

  const liveChartWindow = useMemo(() => {
    if (liveChartData.length === 0) {
      return { startIndex: 0, endIndex: -1 };
    }
    const visiblePoints = Math.min(TOKEN_LIVE_CHART_VISIBLE_POINTS, liveChartData.length);
    return {
      startIndex: Math.max(0, liveChartData.length - visiblePoints),
      endIndex: liveChartData.length - 1,
    };
  }, [liveChartData]);

  const recentCalls = useMemo(
    () => (recentCallsQuery.data && recentCallsQuery.data.length > 0 ? recentCallsQuery.data : (token?.recentCalls ?? [])),
    [recentCallsQuery.data, token?.recentCalls]
  );
  const recentCallsCount = Math.max(token?.callsCount ?? 0, recentCalls.length);
  const primaryTradeCall = useMemo(
    () => recentCalls.find((post) => Boolean(post.contractAddress) && post.chainType === "solana") ?? null,
    [recentCalls]
  );
  const isRefreshingLive = isFetching || liveTokenQuery.isFetching;
  const shouldAutoOpenTradePanel = searchParams.get("trade") === "1";
  const hasChartTelemetry = chartData.some(
    (point) =>
      [point.marketCap, point.liquidity, point.volume24h, point.holderCount].some(
        (value) => typeof value === "number" && Number.isFinite(value) && value > 0
      )
  );
  const hasLiveChartTelemetry = liveChartData.length > 1;
  const liveChartPriceChangePct =
    liveChartData.length > 1
      ? ((liveChartData[liveChartData.length - 1]!.close - liveChartData[0]!.open) / liveChartData[0]!.open) * 100
      : null;
  const liveChartSourceLabel =
    liveChartQuery.data?.source === "birdeye"
      ? "Birdeye live"
      : liveChartQuery.data?.source === "geckoterminal"
        ? "GeckoTerminal live"
        : "Live chart";

  const followMutation = useMutation({
    mutationFn: async () => {
      if (!tokenAddress) throw new Error("Token address is required");
      if (!session?.user) throw new Error("Sign in to follow tokens");
      if (!canPerformAuthenticatedWrites) throw new Error("Signing you in...");
      if (token?.isFollowing) {
        return api.delete<{ following: boolean }>(`/api/tokens/${tokenAddress}/follow`);
      }
      return api.post<{ following: boolean }>(`/api/tokens/${tokenAddress}/follow`);
    },
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey: tokenQueryKey });
      const previousToken = queryClient.getQueryData<TokenPageData | undefined>(tokenQueryKey);
      if (previousToken) {
        queryClient.setQueryData<TokenPageData | undefined>(tokenQueryKey, {
          ...previousToken,
          isFollowing: !previousToken.isFollowing,
        });
      }
      return { previousToken };
    },
    onSuccess: (response) => {
      queryClient.setQueryData<TokenPageData | undefined>(tokenQueryKey, (current) =>
        current ? { ...current, isFollowing: response.following } : current
      );
      void queryClient.invalidateQueries({ queryKey: ["posts"] });
      toast.success(response.following ? "Token followed" : "Token unfollowed");
    },
    onError: (_error, _variables, context) => {
      if (context?.previousToken) {
        queryClient.setQueryData(tokenQueryKey, context.previousToken);
      }
      toast.error(_error instanceof Error ? _error.message : "Failed to update token follow");
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: tokenQueryKey });
    },
  });

  const handleOpenTradePanel = () => {
    if (!primaryTradeCall) {
      toast.info("No trade-ready call is available for this token yet.");
      return;
    }
    setPendingQuickBuyAmountSol(null);
    setPendingTradeCallId(primaryTradeCall.id);
    recentCallsRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  };

  const handleQuickBuyPreset = (amount: string) => {
    if (!primaryTradeCall) {
      toast.info("No trade-ready call is available for this token yet.");
      return;
    }
    setPendingQuickBuyAmountSol(amount);
    setPendingTradeCallId(primaryTradeCall.id);
    recentCallsRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  };

  useEffect(() => {
    if (!shouldAutoOpenTradePanel || hasConsumedTradeDeepLink || !primaryTradeCall) return;
    setPendingTradeCallId(primaryTradeCall.id);
    setHasConsumedTradeDeepLink(true);
    recentCallsRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  }, [hasConsumedTradeDeepLink, primaryTradeCall, shouldAutoOpenTradePanel]);

  const showTokenLoading = !token && isLoading;
  const topHolders = token?.topHolders.length
    ? token.topHolders
    : (token?.risk.topHolders ?? []);
  const devWallet = token?.devWallet ?? token?.risk.devWallet ?? null;
  const topHolderRows = topHolders.slice(0, 10);
  const hasLiveHolderDistribution = topHolderRows.length > 0;
  const isHolderCountLowerBound = token?.holderCountSource === "largest_accounts";
  const hasVerifiedHolderCount = hasResolvedHolderCount(token?.holderCount, token?.holderCountSource);
  const holderCountValue = token
    ? formatIntegerMetric(token.holderCount, {
        emptyLabel: isRefreshingLive ? "Scanning" : "Unavailable",
      })
    : "Scanning";
  const holderCountLabel = hasVerifiedHolderCount
    ? holderCountValue
    : isHolderCountLowerBound
      ? hasLiveHolderDistribution
        ? "Pending"
        : "Scanning"
      : holderCountValue;
  const holderMetricTitle = "Total holders";
  const holderMetricBadge = hasVerifiedHolderCount
    ? token?.holderCountSource === "helius"
      ? "Helius"
      : token?.holderCountSource === "birdeye"
        ? "Birdeye"
        : token?.holderCountSource === "rpc_scan"
          ? "RPC verified"
          : "Live count"
    : isHolderCountLowerBound
      ? hasLiveHolderDistribution
        ? "Top 10 ready"
        : "Scanning"
      : "Refreshing";
  const holderMetricCopy = hasVerifiedHolderCount
    ? "Verified holder total from the latest live telemetry."
    : isHolderCountLowerBound
      ? hasLiveHolderDistribution
        ? "Largest wallets are loaded now. Full holder count is still resolving."
        : "Fetching the full holder count for this token."
      : "Refreshing holder telemetry from the live route.";
  const topHolderSectionCopy = hasVerifiedHolderCount
    ? token?.holderCountSource === "helius"
      ? "Helius holder count with RPC wallet ownership, dev roles, and swap activity badges."
      : "RPC top wallets with live circulating supply share."
    : "Top wallets are ready first. Full holder count follows after the RPC or Helius scan finishes.";
  const recentCallsEmptyCopy =
    recentCallsQuery.isLoading || recentCallsQuery.isFetching
      ? "Recent token calls are still loading for this address."
      : "No recent calls are available for this token yet.";

  return (
    <div className="min-h-screen bg-background">
      <header className="app-topbar">
        <div className="mx-auto flex h-[4.4rem] max-w-[980px] items-center gap-3 px-4 sm:px-5">
          <Button
            variant="ghost"
            size="icon"
            className="h-10 w-10 rounded-2xl border border-border/60 bg-white/60 shadow-[0_18px_34px_-28px_hsl(var(--foreground)/0.18)] dark:border-white/[0.08] dark:bg-white/[0.04] dark:shadow-none"
            onClick={() => navigate(-1)}
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <div className="text-[10px] font-black uppercase tracking-[0.22em] text-primary/80">Phew Ultra</div>
            <h1 className="font-semibold text-lg">Token Lab</h1>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[980px] px-4 pb-10 pt-5 sm:px-5">
        {showTokenLoading ? (
          <TokenScanningState
            address={tokenAddress}
            title="Opening Phew Ultra Token Lab"
            subtitle="We are mapping liquidity, community sentiment, holder concentration, bundle risk, and conviction signals for this token."
          />
        ) : error || !token ? (
          <div className="app-empty-state min-h-[360px]">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-destructive/10">
              <AlertCircle className="h-8 w-8 text-destructive" />
            </div>
            <p className="text-lg font-semibold text-foreground">Token not found</p>
            <p className="text-sm text-muted-foreground">
              We could not load token intelligence for this address.
            </p>
          </div>
        ) : (
          <div className="space-y-5">
            <section className="app-surface p-5 sm:p-6">
              <div className="space-y-5">
                <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
                  <div className="min-w-0 flex items-start gap-4">
                    <div className="flex h-16 w-16 items-center justify-center overflow-hidden rounded-full border border-border/60 bg-secondary">
                      {token.imageUrl ? (
                        <img src={token.imageUrl} alt={token.symbol ?? token.name ?? "Token"} className="h-full w-full object-cover" />
                      ) : (
                        <Coins className="h-7 w-7 text-primary" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="break-words text-2xl font-bold text-foreground">
                          {token.symbol || token.name || token.address.slice(0, 8)}
                        </h2>
                        <span className={cn("rounded-full border px-3 py-1 text-xs font-semibold", riskTone(token.bundleRiskLabel))}>
                          {token.bundleRiskLabel || "Unknown Risk"}
                        </span>
                        {token.isEarlyRunner ? (
                          <span className="rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">
                            Early Runner
                          </span>
                        ) : null}
                      </div>
                      <p className="mt-1 break-all text-xs text-muted-foreground">{token.address}</p>
                      {token.earlyRunnerReasons?.length ? (
                        <div className="mt-3 flex flex-wrap gap-2">
                          {token.earlyRunnerReasons.map((reason) => (
                            <span key={reason} className="rounded-full border border-border/60 bg-secondary px-3 py-1 text-[11px] text-muted-foreground">
                              {reason}
                            </span>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  </div>

                  <div className="grid w-full gap-3 sm:grid-cols-2 xl:w-[420px] xl:grid-cols-4">
                    {[
                      { label: "Confidence", value: token.confidenceScore },
                      { label: "Hot Alpha", value: token.hotAlphaScore },
                      { label: "Early Runner", value: token.earlyRunnerScore },
                      { label: "High Conviction", value: token.highConvictionScore },
                    ].map((metric) => (
                      <div key={metric.label} className="min-w-0 rounded-[20px] border border-border/60 bg-white/55 p-3 shadow-[inset_0_1px_0_hsl(0_0%_100%/0.7)] dark:bg-white/[0.03] dark:shadow-none">
                        <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">{metric.label}</div>
                        <div className={cn("mt-2 text-xl font-bold sm:text-2xl", scoreTone(metric.value))}>
                          {typeof metric.value === "number" ? `${metric.value.toFixed(0)}%` : "N/A"}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="grid gap-3 lg:grid-cols-[minmax(0,1.35fr)_repeat(2,minmax(0,1fr))]">
                  <div className="min-w-0 rounded-[28px] border border-primary/20 bg-[radial-gradient(circle_at_top_left,rgba(52,211,153,0.22),transparent_56%),linear-gradient(180deg,rgba(255,255,255,0.92),rgba(236,248,241,0.92))] p-5 shadow-[0_24px_48px_-34px_hsl(var(--primary)/0.45)] dark:bg-[radial-gradient(circle_at_top_left,rgba(52,211,153,0.18),transparent_58%),linear-gradient(180deg,rgba(15,22,20,0.94),rgba(8,13,12,0.98))] dark:shadow-none">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-primary/80">
                          Live market cap
                        </div>
                        <div className="mt-3 min-w-0 text-[clamp(2.9rem,6vw,4.6rem)] font-black leading-[0.88] tracking-[-0.06em] text-foreground tabular-nums">
                          {formatMarketMetric(token.marketCap)}
                        </div>
                        <div className="mt-3 text-sm text-muted-foreground">
                          Shared with postcard pricing and refreshed from the live market route.
                        </div>
                      </div>
                      <span className="shrink-0 rounded-full border border-primary/25 bg-white/70 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-primary dark:bg-white/[0.05]">
                        Live
                      </span>
                    </div>
                    <div className="mt-4 flex flex-wrap gap-2 text-[11px] text-muted-foreground">
                      <span className="rounded-full border border-border/60 bg-white/70 px-3 py-1 dark:bg-white/[0.04]">
                        24h volume <span className="ml-1 font-semibold text-foreground">{formatMarketMetric(token.volume24h)}</span>
                      </span>
                      <span className="rounded-full border border-border/60 bg-white/70 px-3 py-1 dark:bg-white/[0.04]">
                        {isRefreshingLive ? "Refreshing now" : "Live snapshot active"}
                      </span>
                    </div>
                  </div>
                  <div className="min-w-0 rounded-[22px] border border-border/60 bg-white/55 p-4 shadow-[inset_0_1px_0_hsl(0_0%_100%/0.72)] dark:bg-white/[0.03] dark:shadow-none">
                    <div className="flex items-start justify-between gap-3">
                      <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                        Liquidity
                      </div>
                      <span className="rounded-full border border-border/60 bg-secondary px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                        Live
                      </span>
                    </div>
                    <div className="mt-3 min-w-0 text-[clamp(2.1rem,4vw,2.95rem)] font-bold leading-none text-foreground tabular-nums">
                      {formatMarketMetric(token.liquidity)}
                    </div>
                    <div className="mt-3 text-sm text-muted-foreground">
                      Pool depth on the active trading pair.
                    </div>
                  </div>
                  <div className="min-w-0 rounded-[22px] border border-border/60 bg-white/55 p-4 shadow-[inset_0_1px_0_hsl(0_0%_100%/0.72)] dark:bg-white/[0.03] dark:shadow-none">
                    <div className="flex items-start justify-between gap-3">
                      <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                        {holderMetricTitle}
                      </div>
                      <span className="rounded-full border border-border/60 bg-secondary px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                        {holderMetricBadge}
                      </span>
                    </div>
                    <div className="mt-3 min-w-0 text-[clamp(2rem,4vw,2.8rem)] font-bold leading-none text-foreground tabular-nums">
                      {holderCountLabel}
                    </div>
                    <div className="mt-3 text-sm text-muted-foreground">
                      {holderMetricCopy}
                    </div>
                  </div>
                </div>

                <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                  <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(190px,auto)] lg:max-w-[560px] lg:flex-1">
                    <Button
                      onClick={handleOpenTradePanel}
                      disabled={!primaryTradeCall}
                      className="group min-h-[60px] min-w-0 justify-start gap-3 rounded-[22px] border border-primary/35 bg-[linear-gradient(135deg,hsl(var(--primary)/0.98),rgba(52,211,153,0.92))] px-4 py-3 text-left text-slate-950 shadow-[0_22px_50px_-24px_hsl(var(--primary)/0.58)] hover:brightness-[1.03] disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-black/10 bg-white/20 text-slate-950">
                        <PhewTradeIcon className="h-4 w-4" />
                      </span>
                      <span className="min-w-0 flex flex-col items-start text-left">
                        <span className="text-sm font-semibold text-slate-950">Open trade panel</span>
                        <span className="mt-1 whitespace-normal text-[11px] leading-[1.25] text-slate-900/75">
                          Jump straight to the latest trade-ready post for this token.
                        </span>
                      </span>
                    </Button>
                    <Button
                      variant={token.isFollowing ? "outline" : "default"}
                      onClick={() => followMutation.mutate()}
                      disabled={followMutation.isPending}
                      className="min-h-[60px] rounded-[22px] px-5"
                    >
                      {followMutation.isPending ? (
                        <>
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          Updating
                        </>
                      ) : token.isFollowing ? (
                        "Following token"
                      ) : (
                        "Follow token"
                      )}
                    </Button>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <a
                      href={token.dexscreenerUrl ?? `https://dexscreener.com/${token.chainType === "solana" ? "solana" : "ethereum"}/${token.address}`}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex h-9 items-center gap-2 rounded-full border border-border/60 bg-secondary px-3 text-xs font-semibold text-muted-foreground transition-colors hover:text-foreground"
                    >
                      Open Dexscreener
                      <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                    {isRefreshingLive ? (
                      <span className="inline-flex h-9 items-center gap-2 rounded-full border border-primary/20 bg-primary/10 px-3 text-[11px] font-semibold uppercase tracking-[0.16em] text-primary">
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        Refreshing live intelligence
                      </span>
                    ) : null}
                  </div>
                </div>
              </div>
            </section>

            <section className="grid gap-5 lg:items-start lg:grid-cols-[1.35fr_0.65fr]">
              <div className="app-surface p-5 sm:p-6">
                <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div>
                    <h3 className="text-lg font-semibold text-foreground">Live price chart</h3>
                    <p className="text-sm text-muted-foreground">
                      Real-time candles from the market route, with token snapshots held as fallback telemetry.
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="rounded-full border border-border/60 bg-secondary px-3 py-1 text-xs text-muted-foreground">
                      <BarChart3 className="mr-1 inline h-3.5 w-3.5" />
                      {hasLiveChartTelemetry ? liveChartSourceLabel : hasChartTelemetry ? `${chartData.length} snapshot points` : "Scanning"}
                    </div>
                    {typeof liveChartPriceChangePct === "number" && Number.isFinite(liveChartPriceChangePct) ? (
                      <div className={cn(
                        "rounded-full border px-3 py-1 text-xs font-semibold",
                        liveChartPriceChangePct >= 0
                          ? "border-gain/25 bg-gain/10 text-gain"
                          : "border-loss/25 bg-loss/10 text-loss"
                      )}>
                        {liveChartPriceChangePct >= 0 ? "+" : ""}
                        {liveChartPriceChangePct.toFixed(2)}%
                      </div>
                    ) : null}
                  </div>
                </div>
                <div className="mb-4 flex flex-wrap gap-2">
                  {TOKEN_CHART_INTERVAL_OPTIONS.map((option) => (
                    <Button
                      key={option.value}
                      type="button"
                      variant={chartInterval === option.value ? "default" : "outline"}
                      className="h-9 rounded-full px-3"
                      onClick={() => setChartInterval(option.value)}
                    >
                      {option.label}
                    </Button>
                  ))}
                </div>
                <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_230px]">
                  <div className="space-y-4">
                    <div className="h-[320px] w-full">
                      {hasLiveChartTelemetry ? (
                        <div className="h-full rounded-[24px] border border-border/60 bg-[radial-gradient(circle_at_top,rgba(16,185,129,0.09),transparent_52%),linear-gradient(180deg,rgba(255,255,255,0.02),rgba(255,255,255,0.01))] p-3">
                          <CandlestickChart
                            data={liveChartData}
                            visibleStartIndex={liveChartWindow.startIndex}
                            visibleEndIndex={liveChartWindow.endIndex}
                            futureSlotCount={TOKEN_LIVE_CHART_FUTURE_SLOTS}
                            showVolume
                            showCandles
                            stroke="hsl(var(--primary))"
                            fill="hsla(var(--primary), 0.22)"
                            formatPrice={formatTokenPrice}
                            formatTick={(timestampMs) =>
                              new Date(timestampMs).toLocaleTimeString([], {
                                hour: "2-digit",
                                minute: "2-digit",
                              })
                            }
                            className="h-full"
                          />
                        </div>
                      ) : hasChartTelemetry ? (
                        <ResponsiveContainer width="100%" height="100%">
                          <AreaChart data={chartData}>
                            <defs>
                              <linearGradient id="tokenChartFill" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.35} />
                                <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0.02} />
                              </linearGradient>
                            </defs>
                            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.35} />
                            <XAxis dataKey="label" tick={{ fontSize: 11 }} minTickGap={24} />
                            <YAxis tickFormatter={(value) => formatMarketCap(Number(value))} tick={{ fontSize: 11 }} />
                            <Tooltip
                              formatter={(value: number | null, name: string) => {
                                if (name === "marketCap") return [formatMarketCap(value), "Market Cap"];
                                if (name === "confidenceScore") return [`${Number(value ?? 0).toFixed(0)}%`, "Confidence"];
                                return [value ?? "N/A", name];
                              }}
                            />
                            <Area type="monotone" dataKey="marketCap" stroke="hsl(var(--primary))" strokeWidth={2} fill="url(#tokenChartFill)" />
                            <Area type="monotone" dataKey="confidenceScore" stroke="hsl(var(--accent))" strokeWidth={1.5} fillOpacity={0} />
                          </AreaChart>
                        </ResponsiveContainer>
                      ) : (
                        <div className="flex h-full items-center justify-center rounded-[24px] border border-dashed border-primary/25 bg-gradient-to-br from-primary/8 via-transparent to-cyan-400/6 px-6 text-center">
                          <div className="max-w-md space-y-3">
                            <div className="inline-flex h-12 w-12 items-center justify-center rounded-full border border-primary/30 bg-primary/10 text-primary">
                              <Loader2 className="h-5 w-5 animate-spin" />
                            </div>
                            <div className="space-y-1">
                              <div className="text-base font-semibold text-foreground">Scanning token telemetry</div>
                              <p className="text-sm text-muted-foreground">
                                We are pulling the live price route, market cap snapshots, liquidity flow, holder distribution, and sentiment inputs for this token.
                              </p>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>

                    {hasChartTelemetry ? (
                      <div className="rounded-[24px] border border-border/60 bg-white/50 p-4 shadow-[inset_0_1px_0_hsl(0_0%_100%/0.68)] dark:bg-white/[0.03] dark:shadow-none">
                        <div className="mb-3 flex items-center justify-between gap-3">
                          <div>
                            <div className="text-sm font-semibold text-foreground">Confidence + market cap timeline</div>
                            <div className="text-xs text-muted-foreground">Snapshot intelligence history for conviction and market structure.</div>
                          </div>
                          <div className="rounded-full border border-border/60 bg-secondary px-3 py-1 text-[11px] text-muted-foreground">
                            {chartData.length} points
                          </div>
                        </div>
                        <div className="h-[168px]">
                          <ResponsiveContainer width="100%" height="100%">
                            <AreaChart data={chartData}>
                              <defs>
                                <linearGradient id="tokenChartFillSecondary" x1="0" y1="0" x2="0" y2="1">
                                  <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.28} />
                                  <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0.01} />
                                </linearGradient>
                              </defs>
                              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.26} />
                              <XAxis dataKey="label" tick={{ fontSize: 10 }} minTickGap={24} />
                              <YAxis tickFormatter={(value) => formatMarketCap(Number(value))} tick={{ fontSize: 10 }} />
                              <Tooltip
                                formatter={(value: number | null, name: string) => {
                                  if (name === "marketCap") return [formatMarketCap(value), "Market Cap"];
                                  if (name === "confidenceScore") return [`${Number(value ?? 0).toFixed(0)}%`, "Confidence"];
                                  return [value ?? "N/A", name];
                                }}
                              />
                              <Area type="monotone" dataKey="marketCap" stroke="hsl(var(--primary))" strokeWidth={2} fill="url(#tokenChartFillSecondary)" />
                              <Area type="monotone" dataKey="confidenceScore" stroke="hsl(var(--accent))" strokeWidth={1.5} fillOpacity={0} />
                            </AreaChart>
                          </ResponsiveContainer>
                        </div>
                      </div>
                    ) : null}
                  </div>

                  <div className="space-y-4">
                    <div className="rounded-[24px] border border-border/60 bg-[linear-gradient(180deg,rgba(255,255,255,0.7),rgba(243,250,245,0.92))] p-4 shadow-[0_24px_54px_-40px_hsl(var(--primary)/0.35)] dark:bg-[linear-gradient(180deg,rgba(10,17,27,0.96),rgba(5,10,18,0.98))] dark:shadow-none">
                      <div className="text-sm font-semibold text-foreground">Quick buy</div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        Open the first trade-ready call with a preset amount already loaded.
                      </div>
                      <div className="mt-4 grid grid-cols-2 gap-2">
                        {TOKEN_QUICK_BUY_PRESETS.map((amount) => (
                          <Button
                            key={amount}
                            type="button"
                            variant="outline"
                            onClick={() => handleQuickBuyPreset(amount)}
                            disabled={!primaryTradeCall}
                            className="h-11 rounded-[18px] border-primary/20 bg-white/70 text-sm font-semibold text-foreground hover:border-primary/35 hover:bg-primary/8 dark:bg-white/[0.03]"
                          >
                            {amount} SOL
                          </Button>
                        ))}
                      </div>
                      <Button
                        type="button"
                        onClick={handleOpenTradePanel}
                        disabled={!primaryTradeCall}
                        className="mt-3 h-11 w-full rounded-[18px] border border-primary/25 bg-[linear-gradient(135deg,hsl(var(--primary)/0.95),rgba(52,211,153,0.88))] text-sm font-semibold text-slate-950 shadow-[0_18px_36px_-26px_hsl(var(--primary)/0.48)] hover:brightness-[1.03] disabled:opacity-60"
                      >
                        Open full trade panel
                      </Button>
                    </div>

                    <div className="rounded-[24px] border border-border/60 bg-white/50 p-4 shadow-[inset_0_1px_0_hsl(0_0%_100%/0.68)] dark:bg-white/[0.03] dark:shadow-none">
                      <div className="text-sm font-semibold text-foreground">Live route</div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        {hasLiveChartTelemetry
                          ? `${liveChartSourceLabel} is updating this panel in real time.`
                          : "Live candles will appear here as soon as market route data is available."}
                      </div>
                      <div className="mt-4 space-y-2 text-xs text-muted-foreground">
                        <div className="flex items-center justify-between rounded-[16px] border border-border/60 bg-secondary px-3 py-2">
                          <span>Current MCAP</span>
                          <span className="font-semibold text-foreground">{formatMarketMetric(token.marketCap)}</span>
                        </div>
                        <div className="flex items-center justify-between rounded-[16px] border border-border/60 bg-secondary px-3 py-2">
                          <span>Current liquidity</span>
                          <span className="font-semibold text-foreground">{formatMarketMetric(token.liquidity)}</span>
                        </div>
                        <div className="flex items-center justify-between rounded-[16px] border border-border/60 bg-secondary px-3 py-2">
                          <span>24h volume</span>
                          <span className="font-semibold text-foreground">{formatMarketMetric(token.volume24h)}</span>
                        </div>
                        <div className="flex items-center justify-between rounded-[16px] border border-border/60 bg-secondary px-3 py-2">
                          <span>Confidence</span>
                          <span className={cn("font-semibold", scoreTone(token.confidenceScore))}>
                            {typeof token.confidenceScore === "number" ? `${token.confidenceScore.toFixed(0)}%` : "N/A"}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <div className="space-y-5">
                <section className="app-surface p-5">
                  <div className="mb-4 flex items-center gap-2">
                    <ShieldAlert className="h-4.5 w-4.5 text-primary" />
                    <h3 className="text-base font-semibold text-foreground">Risk panel</h3>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="rounded-[18px] border border-border/60 bg-secondary p-3">
                      <div className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">Largest holder</div>
                      <div className="mt-2 text-xl font-semibold text-foreground">{formatPct(token.risk.largestHolderPct)}</div>
                    </div>
                    <div className="rounded-[18px] border border-border/60 bg-secondary p-3">
                      <div className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">Top 10 holders</div>
                      <div className="mt-2 text-xl font-semibold text-foreground">{formatPct(token.risk.top10HolderPct)}</div>
                    </div>
                    <div className="rounded-[18px] border border-border/60 bg-secondary p-3">
                      <div className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">Bundled wallets</div>
                      <div className="mt-2 text-xl font-semibold text-foreground">
                        {formatIntegerMetric(token.risk.bundledWalletCount, { zeroIsValid: true })}
                      </div>
                    </div>
                    <div className="rounded-[18px] border border-border/60 bg-secondary p-3">
                      <div className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">Bundled supply</div>
                      <div className="mt-2 text-xl font-semibold text-foreground">{formatPct(token.risk.estimatedBundledSupplyPct)}</div>
                    </div>
                  </div>
                  <div className="mt-4 rounded-[20px] border border-border/60 bg-white/55 p-3 dark:bg-white/[0.03]">
                    <div className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">Bundle clusters</div>
                    <div className="mt-3 space-y-2">
                      {token.bundleClusters.length > 0 ? (
                        token.bundleClusters.map((cluster) => (
                          <div key={cluster.id ?? cluster.clusterLabel} className="flex items-center justify-between rounded-[16px] border border-border/60 bg-secondary px-3 py-2 text-sm">
                            <span className="font-medium text-foreground">{cluster.clusterLabel}</span>
                            <span className="font-mono text-muted-foreground">{cluster.estimatedSupplyPct.toFixed(1)}%</span>
                          </div>
                        ))
                      ) : (
                        <p className="text-sm text-muted-foreground">
                          {token.risk.bundleRiskLabel ? "No clustered bundlers detected yet." : "Scanning holder clusters and linked bundlers."}
                        </p>
                      )}
                    </div>
                  </div>
                </section>

                <section className="app-surface p-5">
                  <div className="mb-4 flex items-center justify-between gap-3">
                    <div>
                      <div className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">Holder intelligence</div>
                      <div className="mt-1 text-sm text-muted-foreground">
                        {topHolderSectionCopy}
                      </div>
                    </div>
                    <div className="rounded-full border border-border/60 bg-secondary px-3 py-1 text-[11px] text-muted-foreground">
                      {topHolderRows.length > 0 ? `${topHolderRows.length} wallets` : "Live scan"}
                    </div>
                  </div>
                  {devWallet ? (
                    <div className="mb-3 rounded-[20px] border border-primary/20 bg-[linear-gradient(180deg,rgba(236,248,241,0.95),rgba(248,251,249,0.94))] p-4 dark:bg-[linear-gradient(180deg,rgba(12,20,17,0.98),rgba(9,14,13,0.98))]">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-primary/80">
                            {devWallet.devRole === "creator"
                              ? "Creator wallet"
                              : devWallet.devRole === "mint_authority"
                                ? "Mint authority"
                                : "Freeze authority"}
                          </div>
                          <div className="mt-2 font-mono text-sm font-semibold text-foreground">
                            {formatHolderAddress(devWallet.address)}
                          </div>
                          <div className="mt-1 text-xs text-muted-foreground">
                            {devWallet.label ?? devWallet.domain ?? "Wallet intelligence from Solana RPC and Helius."}
                          </div>
                        </div>
                        {devWallet.supplyPct > 0 ? (
                          <div className="shrink-0 text-right">
                            <div className="text-sm font-semibold text-foreground">{formatPct(devWallet.supplyPct)}</div>
                            <div className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">of supply</div>
                          </div>
                        ) : null}
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {devWallet.badges.length > 0
                          ? devWallet.badges.map((badge) => (
                              <span key={badge} className="rounded-full border border-primary/18 bg-white/75 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-primary dark:bg-white/[0.05]">
                                {formatHolderBadge(badge)}
                              </span>
                            ))
                          : (
                              <span className="rounded-full border border-border/60 bg-white/75 px-2.5 py-1 text-[10px] uppercase tracking-[0.12em] text-muted-foreground dark:bg-white/[0.05]">
                                Wallet scan active
                              </span>
                            )}
                      </div>
                      <div className="mt-3 grid grid-cols-2 gap-2 text-[11px] text-muted-foreground">
                        <div className="rounded-[14px] border border-border/60 bg-white/80 px-3 py-2 dark:bg-white/[0.04]">
                          Age <span className="ml-1 font-semibold text-foreground">{formatDaysMetric(devWallet.activeAgeDays) ?? "N/A"}</span>
                        </div>
                        <div className="rounded-[14px] border border-border/60 bg-white/80 px-3 py-2 dark:bg-white/[0.04]">
                          90d volume <span className="ml-1 font-semibold text-foreground">{formatSolMetric(devWallet.tradeVolume90dSol) ?? "N/A"}</span>
                        </div>
                        <div className="rounded-[14px] border border-border/60 bg-white/80 px-3 py-2 dark:bg-white/[0.04]">
                          SOL balance <span className="ml-1 font-semibold text-foreground">{formatSolMetric(devWallet.solBalance) ?? "N/A"}</span>
                        </div>
                        <div className="rounded-[14px] border border-border/60 bg-white/80 px-3 py-2 dark:bg-white/[0.04]">
                          Funded by <span className="ml-1 font-mono text-foreground">{devWallet.fundedBy ? formatHolderAddress(devWallet.fundedBy) : "N/A"}</span>
                        </div>
                      </div>
                    </div>
                  ) : null}
                  <div className="max-h-[360px] space-y-2.5 overflow-y-auto pr-1">
                    {topHolderRows.length > 0 ? (
                      topHolderRows.map((holder, index) => (
                        <div
                          key={`${holder.address}:${index}`}
                          className="rounded-[18px] border border-border/60 bg-secondary px-3 py-3 text-sm"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="flex min-w-0 items-start gap-3">
                              <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-primary/18 bg-white/70 text-[11px] font-semibold text-primary dark:bg-white/[0.05]">
                                {index + 1}
                              </div>
                              <div className="min-w-0">
                                <div className="font-mono text-[12px] font-semibold text-foreground">
                                  {formatHolderAddress(holder.address)}
                                </div>
                                <div className="mt-0.5 text-[11px] text-muted-foreground">
                                  {formatHolderAmount(holder.amount)} tokens
                                  {holder.valueUsd ? (
                                    <span className="ml-1 text-foreground/80">| {formatMarketCap(holder.valueUsd)}</span>
                                  ) : null}
                                </div>
                                <div className="mt-1.5 flex flex-wrap gap-1.5">
                                  {holder.badges.length > 0 ? (
                                    holder.badges.map((badge) => (
                                      <span key={badge} className="rounded-full border border-primary/18 bg-white/80 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.11em] text-primary dark:bg-white/[0.05]">
                                        {formatHolderBadge(badge)}
                                      </span>
                                    ))
                                  ) : (
                                    <span className="rounded-full border border-border/60 bg-white/80 px-2 py-0.5 text-[10px] uppercase tracking-[0.11em] text-muted-foreground dark:bg-white/[0.05]">
                                      Wallet scanned
                                    </span>
                                  )}
                                </div>
                                <div className="mt-1.5 flex flex-wrap gap-2 text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                                  {holder.activeAgeDays !== null ? <span>Age {formatDaysMetric(holder.activeAgeDays)}</span> : null}
                                  {holder.tradeVolume90dSol !== null ? <span>90d {formatSolMetric(holder.tradeVolume90dSol)}</span> : null}
                                  {holder.label ? <span>{holder.label}</span> : null}
                                </div>
                              </div>
                            </div>
                            <div className="shrink-0 text-right">
                              <div className="font-mono text-sm font-semibold text-foreground">
                                {formatPct(holder.supplyPct)}
                              </div>
                              <div className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                                of supply
                              </div>
                            </div>
                          </div>
                          <div className="mt-3 h-2 overflow-hidden rounded-full bg-border/55">
                            <div
                              className="h-full rounded-full bg-[linear-gradient(90deg,hsl(var(--primary)),rgba(52,211,153,0.82))]"
                              style={{ width: `${Math.max(6, Math.min(holder.supplyPct, 100))}%` }}
                            />
                          </div>
                        </div>
                      ))
                    ) : (
                      <p className="text-sm text-muted-foreground">
                        Scanning RPC holder wallets and dev-wallet intelligence for this token.
                      </p>
                    )}
                  </div>
                </section>
              </div>
            </section>

            <section className="grid gap-5 lg:items-start lg:grid-cols-[0.85fr_1.15fr]">
              <div className="space-y-5">
                <div className="app-surface self-start p-5">
                  <div className="mb-4 flex items-center gap-2">
                    <TrendingUp className="h-4.5 w-4.5 text-primary" />
                    <h3 className="text-base font-semibold text-foreground">Alpha timeline</h3>
                  </div>
                  <div className="space-y-3">
                    {token.timeline.length > 0 ? (
                      token.timeline.map((event) => {
                        const timelineCopy = buildTimelineCopy(event);
                        return (
                          <div key={event.id} className="rounded-[18px] border border-border/60 bg-secondary p-3">
                            <div className="flex items-center justify-between gap-2">
                              <div className="font-medium text-foreground">{timelineCopy.title}</div>
                              <div className="text-xs text-muted-foreground">{formatTimeAgo(event.timestamp)}</div>
                            </div>
                            <div className="mt-1 text-sm text-muted-foreground">{timelineCopy.description}</div>
                          </div>
                        );
                      })
                    ) : (
                      <div className="rounded-[18px] border border-dashed border-border/60 bg-secondary/60 p-4 text-sm text-muted-foreground">
                        Timeline events are being assembled from calls and token signals.
                      </div>
                    )}
                  </div>
                </div>

              </div>

              <div className="space-y-4">
                <section className="app-surface p-5">
                  <div className="mb-4 flex items-center justify-between">
                    <div>
                      <h3 className="text-base font-semibold text-foreground">Sentiment + market health</h3>
                      <p className="text-sm text-muted-foreground">Community reactions, liquidity, holders, and volume</p>
                    </div>
                    <span className="text-xs font-semibold text-primary">Live intelligence</span>
                  </div>
                  <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                    <div className="rounded-[18px] border border-border/60 bg-secondary p-3">
                      <div className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">Liquidity</div>
                      <div className="mt-2 text-xl font-semibold text-foreground">{formatMarketMetric(token.liquidity)}</div>
                    </div>
                    <div className="rounded-[18px] border border-border/60 bg-secondary p-3">
                      <div className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">Volume 24h</div>
                      <div className="mt-2 text-xl font-semibold text-foreground">{formatMarketMetric(token.volume24h)}</div>
                    </div>
                    <div className="rounded-[18px] border border-border/60 bg-secondary p-3">
                      <div className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">{holderMetricTitle}</div>
                      <div className="mt-2 text-xl font-semibold text-foreground">{holderCountLabel}</div>
                    </div>
                    <div className="rounded-[18px] border border-border/60 bg-secondary p-3">
                      <div className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">Sentiment</div>
                      <div className={cn("mt-2 text-xl font-semibold", scoreTone(token.sentiment.score))}>{token.sentiment.score.toFixed(0)}</div>
                    </div>
                  </div>
                  <p className="mt-3 text-xs text-muted-foreground">
                    Sentiment starts neutral, then moves with community reactions, 24h price trend, and buy versus sell pressure.
                  </p>
                  {isHolderCountLowerBound ? (
                    <p className="mt-2 text-[11px] text-muted-foreground">
                      Full holder count is still resolving. Holder intelligence is already live in the right column.
                    </p>
                  ) : null}
                  <div className="mt-4 flex flex-wrap gap-2 text-xs text-muted-foreground">
                    <span className="rounded-full border border-border/60 bg-secondary px-3 py-1">Bullish {token.sentiment.bullishPct.toFixed(0)}%</span>
                    <span className="rounded-full border border-border/60 bg-secondary px-3 py-1">Bearish {token.sentiment.bearishPct.toFixed(0)}%</span>
                    <span className="rounded-full border border-border/60 bg-secondary px-3 py-1">Alpha {token.sentiment.reactions.alpha}</span>
                    <span className="rounded-full border border-border/60 bg-secondary px-3 py-1">Based {token.sentiment.reactions.based}</span>
                    <span className="rounded-full border border-border/60 bg-secondary px-3 py-1">Printed {token.sentiment.reactions.printed}</span>
                    <span className="rounded-full border border-border/60 bg-secondary px-3 py-1">Rug {token.sentiment.reactions.rug}</span>
                  </div>
                </section>

                <section ref={recentCallsRef} className="space-y-4">
                  <div className="flex items-center justify-between">
                    <h3 className="text-lg font-semibold text-foreground">Recent calls</h3>
                    <span className="text-sm text-muted-foreground">{recentCallsCount} calls</span>
                  </div>
                  {recentCalls.length > 0 ? (
                    recentCalls.map((post) => (
                      <PostCard
                        key={post.id}
                        post={post}
                        currentUserId={canPerformAuthenticatedWrites ? session?.user?.id : undefined}
                        autoOpenTradePanel={pendingTradeCallId === post.id}
                        autoPrefillBuyAmountSol={pendingTradeCallId === post.id ? pendingQuickBuyAmountSol : null}
                        onTradePanelAutoOpened={() => {
                          setPendingTradeCallId((current) => (current === post.id ? null : current));
                          setPendingQuickBuyAmountSol(null);
                        }}
                      />
                    ))
                  ) : (
                    <div className="rounded-[20px] border border-dashed border-border/60 bg-secondary/60 p-5 text-sm text-muted-foreground">
                      {recentCallsEmptyCopy}
                    </div>
                  )}
                </section>

                <section className="app-surface p-5">
                  <div className="mb-4 flex items-center gap-2">
                    <Users className="h-4.5 w-4.5 text-primary" />
                    <h3 className="text-base font-semibold text-foreground">Top traders</h3>
                  </div>
                  <div className="space-y-3">
                    {token.topTraders.length > 0 ? (
                      token.topTraders.map((trader) => (
                        <div key={trader.id} className="flex items-center gap-3 rounded-[18px] border border-border/60 bg-secondary p-3">
                          <Avatar className="h-10 w-10 border border-border">
                            <AvatarImage src={getAvatarUrl(trader.id, trader.image)} />
                            <AvatarFallback>{(trader.username || trader.name || "?").charAt(0)}</AvatarFallback>
                          </Avatar>
                          <div className="min-w-0 flex-1">
                            <div className="truncate font-semibold text-foreground">{trader.username || trader.name}</div>
                            <div className="line-clamp-2 break-words text-xs text-muted-foreground">
                              {trader.reputationTier || "Unranked"} | {trader.callsCount} calls | {trader.avgConfidenceScore.toFixed(0)}% avg confidence
                            </div>
                          </div>
                          <div className="text-right">
                            <div className="text-sm font-semibold text-gain">{trader.bestRoiPct.toFixed(1)}%</div>
                            <div className="text-[11px] text-muted-foreground">best ROI</div>
                          </div>
                        </div>
                      ))
                    ) : (
                      <div className="rounded-[18px] border border-dashed border-border/60 bg-secondary/60 p-4 text-sm text-muted-foreground">
                        We are still ranking trader quality for this token.
                      </div>
                    )}
                  </div>
                </section>
              </div>
            </section>
          </div>
        )}
      </main>
    </div>
  );
}
