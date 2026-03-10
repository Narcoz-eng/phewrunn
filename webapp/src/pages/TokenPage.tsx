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

type TokenRisk = {
  tokenRiskScore: number | null;
  bundleRiskLabel: string | null;
  largestHolderPct: number | null;
  top10HolderPct: number | null;
  bundledWalletCount: number | null;
  estimatedBundledSupplyPct: number | null;
  deployerSupplyPct: number | null;
  holderCount: number | null;
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
  liquidity: number | null;
  volume24h: number | null;
  holderCount: number | null;
  holderCountSource?: "stored" | "rpc_scan" | "birdeye" | "largest_accounts" | null;
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
    () => (tokenAddress ? `phew.token-page.v4:${viewerScope}:${tokenAddress}` : null),
    [tokenAddress, viewerScope]
  );
  const cachedToken = useMemo(
    () => (tokenCacheKey ? readSessionCache<TokenPageData>(tokenCacheKey, TOKEN_PAGE_CACHE_TTL_MS) : null),
    [tokenCacheKey]
  );
  const recentCallsRef = useRef<HTMLDivElement | null>(null);
  const [pendingTradeCallId, setPendingTradeCallId] = useState<string | null>(null);
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
      return api.get<TokenPageData>(`/api/tokens/${tokenAddress}`);
    },
    initialData: cachedToken ?? undefined,
    placeholderData: (previousData) => previousData,
    enabled: !!tokenAddress,
    staleTime: 45_000,
    gcTime: 8 * 60_000,
    refetchOnMount: cachedToken ? false : "always",
    refetchOnWindowFocus: false,
  });

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

  const primaryTradeCall = useMemo(
    () =>
      token?.recentCalls.find((post) => Boolean(post.contractAddress) && post.chainType === "solana") ?? null,
    [token?.recentCalls]
  );
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
  const holderCountValue = token
    ? formatIntegerMetric(token.holderCount, {
        emptyLabel: isFetching ? "Scanning" : "Unavailable",
      })
    : "Scanning";
  const holderCountLabel =
    token?.holderCountSource === "largest_accounts" &&
    typeof token.holderCount === "number" &&
    Number.isFinite(token.holderCount) &&
    token.holderCount > 0
      ? `${holderCountValue}+`
      : holderCountValue;

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
              <div className="grid gap-5 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
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

                <div className="min-w-0 space-y-3">
                  <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
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

                  <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
                    <Button
                      onClick={handleOpenTradePanel}
                      disabled={!primaryTradeCall}
                      className="group h-12 min-w-0 justify-start gap-3 rounded-[20px] border border-primary/35 bg-[linear-gradient(135deg,hsl(var(--primary)/0.98),rgba(52,211,153,0.92))] px-4 text-left text-slate-950 shadow-[0_22px_50px_-24px_hsl(var(--primary)/0.58)] hover:brightness-[1.03] sm:min-w-[220px] sm:flex-1 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      <span className="flex h-8 w-8 items-center justify-center rounded-full border border-black/10 bg-white/20 text-slate-950">
                        <PhewTradeIcon className="h-4 w-4" />
                      </span>
                      <span className="min-w-0 flex flex-col items-start leading-none">
                        <span className="text-sm font-semibold text-slate-950">Open trade panel</span>
                        <span className="mt-1 truncate text-[11px] text-slate-900/75">
                          Jump into the live setup for this token.
                        </span>
                      </span>
                    </Button>
                    <Button
                      variant={token.isFollowing ? "outline" : "default"}
                      onClick={() => followMutation.mutate()}
                      disabled={followMutation.isPending}
                      className="h-11 rounded-2xl sm:min-w-[170px]"
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
                    {isFetching ? (
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

            <section className="grid gap-5 lg:items-start lg:grid-cols-[0.8fr_1.2fr]">
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
                      <div className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">Holders</div>
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
                  {token.holderCountSource === "largest_accounts" ? (
                    <p className="mt-2 text-[11px] text-muted-foreground">
                      Holder count is shown as a lower bound from the live largest-holder scan while the full distribution refresh completes.
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
                    <span className="text-sm text-muted-foreground">{token.callsCount} calls</span>
                  </div>
                  {token.recentCalls.map((post) => (
                    <PostCard
                      key={post.id}
                      post={post}
                      currentUserId={canPerformAuthenticatedWrites ? session?.user?.id : undefined}
                      autoOpenTradePanel={pendingTradeCallId === post.id}
                      onTradePanelAutoOpened={() => {
                        setPendingTradeCallId((current) => (current === post.id ? null : current));
                      }}
                    />
                  ))}
                </section>
              </div>
            </section>
          </div>
        )}
      </main>
    </div>
  );
}
