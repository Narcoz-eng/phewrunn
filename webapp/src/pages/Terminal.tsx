import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { ExternalLink, Search } from "lucide-react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CandlestickChart, type CandlestickChartPoint } from "@/components/feed/CandlestickChart";
import { TradeTransactionsFeed } from "@/components/feed/TradeTransactionsFeed";
import { DirectTokenTradePanel } from "@/components/token/DirectTokenTradePanel";
import { useTradePanelLiveFeed } from "@/lib/trade-panel-live";
import { cn } from "@/lib/utils";
import { mergeLiveSamplesIntoCandles, getChartBucketMs } from "@/lib/live-candle-stream";
import { V2RightRailCard } from "@/components/ui/v2/V2RightRailCard";
import { V2ProgressBar } from "@/components/ui/v2/V2ProgressBar";
import type {
  DiscoveryFeedSidebarResponse,
  DiscoverySidebarCall,
  DiscoverySidebarMover,
  DiscoverySidebarRaid,
  TerminalDepthResponse,
} from "@/types";

type TerminalTokenResponse = {
  address: string;
  chainType: string;
  symbol: string | null;
  name: string | null;
  imageUrl: string | null;
  priceUsd: number | null;
  priceChange24hPct: number | null;
  liquidity: number | null;
  volume24h: number | null;
  holderCount: number | null;
  pairAddress: string | null;
  dexscreenerUrl: string | null;
  activityStatusLabel: string | null;
  confidenceScore: number | null;
  highConvictionScore: number | null;
};

type TerminalChartCandle = {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

type TerminalChartResponse = {
  candles: TerminalChartCandle[];
  source: "birdeye" | "geckoterminal" | "unknown";
  network: string | null;
};

type ChartInterval = "1m" | "5m" | "15m" | "1h" | "4h" | "1D";

const CHART_INTERVAL_OPTIONS: Array<{ value: ChartInterval; label: string }> = [
  { value: "1m", label: "1m" },
  { value: "5m", label: "5m" },
  { value: "15m", label: "15m" },
  { value: "1h", label: "1h" },
  { value: "4h", label: "4h" },
  { value: "1D", label: "1D" },
];

function formatUsd(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "--";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: Math.abs(value) >= 1_000 ? "compact" : "standard",
    maximumFractionDigits: value >= 1 ? 2 : 6,
  }).format(value);
}

function formatAmount(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "--";
  return new Intl.NumberFormat("en-US", {
    notation: Math.abs(value) >= 1_000 ? "compact" : "standard",
    maximumFractionDigits: value >= 1 ? 2 : 6,
  }).format(value);
}

function formatSignedPercent(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "--";
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}

function formatChartInterval(value: ChartInterval) {
  switch (value) {
    case "1m":
      return { timeframe: "minute" as const, aggregate: 1, limit: 96 };
    case "5m":
      return { timeframe: "minute" as const, aggregate: 5, limit: 96 };
    case "15m":
      return { timeframe: "minute" as const, aggregate: 15, limit: 96 };
    case "1h":
      return { timeframe: "hour" as const, aggregate: 1, limit: 96 };
    case "4h":
      return { timeframe: "hour" as const, aggregate: 4, limit: 96 };
    case "1D":
      return { timeframe: "day" as const, aggregate: 1, limit: 72 };
    default:
      return { timeframe: "minute" as const, aggregate: 5, limit: 96 };
  }
}

function buildChartPoints(candles: TerminalChartCandle[]): CandlestickChartPoint[] {
  return candles.map((candle) => ({
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
  }));
}

function resolveConvictionLabel(score: number | null | undefined) {
  if (typeof score !== "number" || !Number.isFinite(score)) return "Monitoring";
  if (score >= 90) return "High Conviction";
  if (score >= 75) return "Bullish Setup";
  if (score >= 60) return "Developing";
  return "Early";
}

export default function Terminal() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [draftToken, setDraftToken] = useState(searchParams.get("token") ?? "");
  const [chartInterval, setChartInterval] = useState<ChartInterval>("5m");
  const tokenAddress = searchParams.get("token")?.trim() || "";

  const tokenQuery = useQuery<TerminalTokenResponse>({
    queryKey: ["terminal-token-v3", tokenAddress],
    enabled: tokenAddress.length > 0,
    staleTime: 30_000,
    gcTime: 5 * 60_000,
    refetchOnWindowFocus: false,
    queryFn: async () => api.get<TerminalTokenResponse>(`/api/tokens/${tokenAddress}`),
  });

  const discoveryQuery = useQuery<DiscoveryFeedSidebarResponse>({
    queryKey: ["terminal-discovery-rail"],
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    queryFn: () => api.get<DiscoveryFeedSidebarResponse>("/api/discovery/feed-sidebar"),
  });

  const token = tokenQuery.data ?? null;
  const chartRequest = formatChartInterval(chartInterval);

  const tradeFeed = useTradePanelLiveFeed({
    enabled: Boolean(token?.address),
    tokenAddress: token?.address ?? null,
    pairAddress: token?.pairAddress ?? null,
    chainType: token?.chainType === "solana" ? "solana" : "ethereum",
  });

  const depthQuery = useQuery<TerminalDepthResponse>({
    queryKey: ["terminal-depth", token?.address, token?.pairAddress, token?.chainType],
    enabled: Boolean(token?.address),
    staleTime: 12_000,
    refetchInterval: token?.address ? 12_000 : false,
    refetchOnWindowFocus: false,
    queryFn: async () =>
      api.post<TerminalDepthResponse>("/api/posts/terminal/depth", {
        tokenMint: token?.address,
        chainType: token?.chainType,
        pairAddress: token?.pairAddress ?? undefined,
      }),
  });

  const chartQuery = useQuery<TerminalChartResponse>({
    queryKey: ["terminal-chart", token?.address, token?.pairAddress, token?.chainType, chartInterval],
    enabled: Boolean(token?.address),
    staleTime: 6_000,
    refetchOnWindowFocus: false,
    refetchInterval:
      tradeFeed.liveStatus.connected && !tradeFeed.usingFallbackPolling
        ? false
        : chartRequest.timeframe === "minute"
          ? 8_000
          : chartRequest.timeframe === "hour"
            ? 15_000
            : 45_000,
    queryFn: async () => {
      const response = await api.raw("/api/posts/chart/candles", {
        method: "POST",
        cache: "no-store",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          poolAddress: token?.pairAddress ?? undefined,
          tokenAddress: token?.address,
          chainType: token?.chainType === "solana" ? "solana" : "ethereum",
          timeframe: chartRequest.timeframe,
          aggregate: chartRequest.aggregate,
          limit: chartRequest.limit,
        }),
      });

      if (!response.ok) {
        throw new Error(`Chart request failed (${response.status})`);
      }

      const payload = (await response.json().catch(() => null)) as
        | {
            data?: {
              candles?: TerminalChartCandle[];
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

  const depth = depthQuery.data ?? null;
  const convictionLabel = resolveConvictionLabel(token?.highConvictionScore);
  const activeRaid =
    discoveryQuery.data?.liveRaids.find((raid) => raid.tokenAddress === token?.address) ??
    discoveryQuery.data?.liveRaids[0] ??
    null;
  const movers = useMemo(() => {
    const rows: DiscoverySidebarMover[] = [];
    if (token?.address) {
      rows.push({
        address: token.address,
        symbol: token.symbol,
        name: token.name,
        imageUrl: token.imageUrl,
        priceChange24hPct: token.priceChange24hPct,
        volume24h: token.volume24h,
        liquidity: token.liquidity,
      });
    }
    for (const item of discoveryQuery.data?.topGainers ?? []) {
      if (rows.some((row) => row.address === item.address)) continue;
      rows.push(item);
    }
    return rows.slice(0, 5);
  }, [discoveryQuery.data?.topGainers, token]);

  const recentCalls = useMemo(
    () =>
      (discoveryQuery.data?.trendingCalls ?? []).filter((call) =>
        token?.symbol ? call.ticker?.toLowerCase() === token.symbol.toLowerCase() : true
      ),
    [discoveryQuery.data?.trendingCalls, token?.symbol]
  );

  const handleSearch = () => {
    const next = draftToken.trim();
    setSearchParams(next ? { token: next } : {});
  };

  const chartPoints = useMemo(() => {
    const mergedCandles = mergeLiveSamplesIntoCandles(
      chartQuery.data?.candles ?? [],
      tradeFeed.recentTrades,
      getChartBucketMs(chartRequest.timeframe, chartRequest.aggregate)
    );
    return buildChartPoints(mergedCandles);
  }, [chartQuery.data?.candles, chartRequest.aggregate, chartRequest.timeframe, tradeFeed.recentTrades]);

  const chartWindow = useMemo(() => {
    if (chartPoints.length === 0) return { startIndex: 0, endIndex: -1 };
    const visible = Math.min(72, chartPoints.length);
    return {
      startIndex: Math.max(0, chartPoints.length - visible),
      endIndex: chartPoints.length - 1,
    };
  }, [chartPoints]);

  const largePrints = useMemo(
    () => tradeFeed.recentTrades.filter((trade) => trade.isLarge).slice(0, 5),
    [tradeFeed.recentTrades]
  );

  const buyPressurePct = useMemo(() => {
    const sample = tradeFeed.recentTrades.slice(0, 24);
    if (!sample.length) return null;
    const buyCount = sample.filter((trade) => trade.side === "buy").length;
    return Math.round((buyCount / sample.length) * 100);
  }, [tradeFeed.recentTrades]);

  const liveFeedRows = useMemo(
    () =>
      tradeFeed.recentTrades.slice(0, 6).map((trade) => ({
        id: trade.id,
        headline: `${trade.walletShort ?? "Trader"} ${trade.side === "buy" ? "bought" : "sold"} ${token?.symbol ? `$${token.symbol}` : "token"}`,
        detail: `${formatUsd(trade.volumeUsd)} • ${formatUsd(trade.priceUsd)}`,
        at: new Date(trade.timestampMs).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      })),
    [token?.symbol, tradeFeed.recentTrades]
  );

  const totalVisibleDepthUsd = useMemo(() => {
    const askTotal = depth?.asks.reduce((sum, row) => sum + row.totalUsd, 0) ?? 0;
    const bidTotal = depth?.bids.reduce((sum, row) => sum + row.totalUsd, 0) ?? 0;
    return askTotal + bidTotal;
  }, [depth?.asks, depth?.bids]);

  return (
    <div className="space-y-5">
      <section className="rounded-[26px] border border-white/8 bg-[linear-gradient(180deg,rgba(8,12,18,0.96),rgba(5,9,13,0.99))] px-4 py-3">
        <div className="grid gap-3 md:grid-cols-5">
          {movers.length > 0 ? (
            movers.map((market) => (
              <div key={market.address} className="rounded-[18px] border border-white/8 bg-white/[0.03] px-4 py-3">
                <div className="text-[10px] uppercase tracking-[0.16em] text-white/34">
                  {market.symbol || market.name || market.address.slice(0, 6)}
                </div>
                <div className="mt-2 text-sm font-semibold text-white">
                  {token?.address === market.address ? formatUsd(token?.priceUsd) : formatUsd(market.volume24h)}
                </div>
                <div
                  className={cn(
                    "mt-1 text-xs font-medium",
                    (market.priceChange24hPct ?? 0) >= 0 ? "text-lime-300" : "text-rose-300"
                  )}
                >
                  {formatSignedPercent(market.priceChange24hPct)}
                </div>
              </div>
            ))
          ) : (
            <div className="rounded-[18px] border border-white/8 bg-white/[0.03] px-4 py-3 text-sm text-white/46">
              Market strip will populate when live movers are available.
            </div>
          )}
        </div>
      </section>

      <section className="rounded-[32px] border border-white/8 bg-[linear-gradient(180deg,rgba(8,12,16,0.98),rgba(4,7,10,0.98))] p-5 sm:p-6">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-white/38">Trading Terminal</div>
            <h1 className="mt-2 text-3xl font-semibold tracking-[-0.04em] text-white sm:text-4xl">
              {token ? `${token.symbol ? `$${token.symbol}` : token.name || "Token"} / USDT` : "Execution-first board"}
            </h1>
            {token ? (
              <div className="mt-3 flex flex-wrap gap-2 text-xs">
                <span className="rounded-full border border-lime-300/16 bg-lime-300/10 px-3 py-1 font-semibold text-lime-200">
                  {convictionLabel}
                </span>
                <span className="rounded-full border border-white/8 bg-white/[0.03] px-3 py-1 text-white/58">
                  {token.chainType === "solana" ? "Solana route" : "Ethereum route"}
                </span>
                <span className="rounded-full border border-white/8 bg-white/[0.03] px-3 py-1 text-white/58">
                  {tradeFeed.liveStatus.connected ? "Realtime prints" : "Fallback polling"}
                </span>
              </div>
            ) : (
              <div className="mt-3 text-sm text-white/54">
                Load a real token to open market depth, candles, and the direct trade route.
              </div>
            )}
          </div>
          <div className="flex min-w-[300px] items-center gap-2 rounded-[20px] border border-white/10 bg-white/[0.04] p-2">
            <Input
              value={draftToken}
              onChange={(event) => setDraftToken(event.target.value)}
              placeholder="Paste token address"
              className="border-0 bg-transparent text-white placeholder:text-white/30 focus-visible:ring-0"
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  handleSearch();
                }
              }}
            />
            <Button type="button" size="sm" onClick={handleSearch} className="rounded-xl">
              <Search className="mr-2 h-4 w-4" />
              Load
            </Button>
          </div>
        </div>
      </section>

      {!tokenAddress ? (
        <section className="rounded-[30px] border border-dashed border-white/12 px-6 py-16 text-center">
          <div className="mx-auto max-w-lg">
            <h2 className="text-2xl font-semibold text-white">Load a live market</h2>
            <p className="mt-3 text-sm leading-6 text-white/52">
              Enter a token address to open the chart, quote ladder, live tape, and direct trade surface.
            </p>
          </div>
        </section>
      ) : tokenQuery.isLoading ? (
        <section className="rounded-[30px] border border-white/8 bg-white/[0.03] px-6 py-10 text-sm text-white/56">
          Loading terminal context...
        </section>
      ) : tokenQuery.isError || !token ? (
        <section className="rounded-[30px] border border-dashed border-white/12 px-6 py-16 text-center">
          <div className="mx-auto max-w-lg">
            <h2 className="text-2xl font-semibold text-white">Unable to load this token</h2>
            <p className="mt-3 text-sm leading-6 text-white/52">
              The terminal could not resolve token context from the current token endpoint.
            </p>
          </div>
        </section>
      ) : (
        <>
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
            <div className="space-y-4">
              <section className="overflow-hidden rounded-[32px] border border-white/8 bg-[linear-gradient(180deg,rgba(8,12,16,0.98),rgba(4,7,10,0.98))]">
                <div className="border-b border-white/8 px-5 py-4 sm:px-6">
                  <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
                    <div className="flex items-center gap-4">
                      <div className="rounded-[20px] border border-white/8 bg-white/[0.03] px-4 py-3">
                        <div className="text-[11px] uppercase tracking-[0.18em] text-white/38">Pair</div>
                        <div className="mt-2 text-xl font-semibold text-white">
                          {token.symbol ? `$${token.symbol}` : token.name || "TOKEN"} / USDT
                        </div>
                      </div>
                      <div className="rounded-[20px] border border-lime-300/14 bg-lime-300/10 px-4 py-3">
                        <div className="text-[11px] uppercase tracking-[0.18em] text-white/42">Price</div>
                        <div className="mt-2 text-2xl font-semibold text-white">{formatUsd(token.priceUsd)}</div>
                        <div
                          className={cn(
                            "mt-1 text-sm font-semibold",
                            (token.priceChange24hPct ?? 0) >= 0 ? "text-lime-300" : "text-rose-300"
                          )}
                        >
                          {formatSignedPercent(token.priceChange24hPct)}
                        </div>
                      </div>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-4">
                      <KpiBox label="24H Vol" value={formatUsd(token.volume24h)} />
                      <KpiBox label="Liquidity" value={formatUsd(token.liquidity)} />
                      <KpiBox label="Holders" value={formatAmount(token.holderCount)} />
                      <KpiBox label="Recent Prints" value={formatAmount(depth?.positionSummary.recentTradeCount ?? 0)} />
                    </div>
                  </div>
                </div>

                <div className="grid gap-0 xl:grid-cols-[minmax(0,1fr)_320px]">
                  <div className="px-4 py-4">
                    <div className="flex items-center justify-between gap-3 border-b border-white/8 pb-3">
                      <div>
                        <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-white/38">Chart Core</div>
                        <div className="mt-1 text-sm text-white/54">
                          {tradeFeed.liveStatus.connected ? "Realtime prints merged into chart candles." : "Polling-driven candle stream."}
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-2 text-xs">
                        {CHART_INTERVAL_OPTIONS.map((option) => (
                          <button
                            key={option.value}
                            type="button"
                            onClick={() => setChartInterval(option.value)}
                            className={cn(
                              "rounded-full border px-3 py-1 transition",
                              chartInterval === option.value
                                ? "border-lime-300/16 bg-lime-300/10 text-lime-200"
                                : "border-white/8 bg-white/[0.03] text-white/54 hover:text-white"
                            )}
                          >
                            {option.label}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="mt-4 grid gap-3 sm:grid-cols-4">
                      <InlineMetric
                        label="Buy pressure"
                        value={buyPressurePct !== null ? `${buyPressurePct}%` : "--"}
                        tone="lime"
                      />
                      <InlineMetric
                        label="Confidence"
                        value={typeof token.confidenceScore === "number" ? `${token.confidenceScore.toFixed(0)}` : "--"}
                        tone="teal"
                      />
                      <InlineMetric
                        label="Reference"
                        value={formatUsd(depth?.positionSummary.referencePrice ?? token.priceUsd)}
                        tone="default"
                      />
                      <InlineMetric label="Activity" value={token.activityStatusLabel ?? "Monitoring"} tone="default" />
                    </div>

                    <div className="mt-4 rounded-[24px] border border-white/8 bg-[linear-gradient(180deg,rgba(8,14,17,0.98),rgba(4,8,10,0.98))] p-4">
                      <div className="h-[360px] overflow-hidden rounded-[20px] border border-white/6 bg-[linear-gradient(180deg,rgba(255,255,255,0.02),rgba(255,255,255,0.01))]">
                        {chartPoints.length > 1 ? (
                          <CandlestickChart
                            data={chartPoints}
                            visibleStartIndex={chartWindow.startIndex}
                            visibleEndIndex={chartWindow.endIndex}
                            futureSlotCount={0}
                            showVolume
                            showCandles
                            stroke="rgba(169,255,52,0.96)"
                            fill="rgba(169,255,52,0.18)"
                            formatPrice={(value) => formatUsd(value)}
                            formatTick={(timestampMs) =>
                              new Date(timestampMs).toLocaleTimeString([], {
                                hour: "2-digit",
                                minute: "2-digit",
                              })
                            }
                            className="h-full"
                          />
                        ) : (
                          <div className="flex h-full items-center justify-center px-6 text-center text-sm text-white/48">
                            Live candles will appear here once the market route returns enough trades for chart construction.
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="mt-4 grid gap-3 md:grid-cols-3">
                      <BottomCard label="Visible Ladder" value={formatUsd(totalVisibleDepthUsd)} hint="Depth shown on screen" />
                      <BottomCard label="Spread" value={depth?.spread ? formatUsd(depth.spread) : "--"} hint="Best ask minus best bid" />
                      <BottomCard
                        label="Route Source"
                        value={chartQuery.data?.source ? chartQuery.data.source.toUpperCase() : "LIVE"}
                        hint={tradeFeed.liveStatus.connected ? "Realtime tape attached" : "Polling fallback"}
                      />
                    </div>
                  </div>

                  <div className="border-l border-white/8 px-4 py-4">
                    <div className="space-y-4">
                      <div className="rounded-[24px] border border-white/8 bg-white/[0.03] p-4">
                        <div className="mb-3 flex items-center justify-between gap-3">
                          <div className="text-[11px] uppercase tracking-[0.18em] text-white/38">Order Book</div>
                          <div className="rounded-full border border-white/8 bg-white/[0.03] px-3 py-1 text-[10px] uppercase tracking-[0.14em] text-white/44">
                            Quote ladder
                          </div>
                        </div>
                        <div className="grid grid-cols-3 gap-3 px-1 text-[10px] uppercase tracking-[0.16em] text-white/34">
                          <span>Price</span>
                          <span className="text-right">Amount</span>
                          <span className="text-right">Total</span>
                        </div>
                        <div className="mt-3 space-y-2">
                          {depth?.asks.slice(0, 6).map((row, index) => (
                            <OrderRow key={`ask-${index}-${row.price}`} side="ask" price={row.price} amount={row.amount} total={row.totalUsd} />
                          ))}
                          <div className="rounded-[14px] border border-lime-300/14 bg-lime-300/8 px-3 py-3 text-center text-lg font-semibold text-lime-300">
                            {formatUsd(token.priceUsd)}
                          </div>
                          {depth?.bids.slice(0, 6).map((row, index) => (
                            <OrderRow key={`bid-${index}-${row.price}`} side="bid" price={row.price} amount={row.amount} total={row.totalUsd} />
                          ))}
                        </div>
                      </div>

                      <DirectTokenTradePanel
                        tokenAddress={token.address}
                        chainType={token.chainType === "solana" ? "solana" : "ethereum"}
                        tokenSymbol={token.symbol || "TOKEN"}
                        tokenName={token.name || token.symbol || "Token"}
                        tokenImage={token.imageUrl}
                        tokenPriceUsd={token.priceUsd}
                        liveStateLabel={tradeFeed.liveStatus.connected ? "Live route" : "Fallback route"}
                      />
                    </div>
                  </div>
                </div>
              </section>

              <div className="grid gap-4 xl:grid-cols-3">
                <V2RightRailCard eyebrow="Whale Activity" title="Large prints" tone="soft">
                  <div className="space-y-3">
                    {largePrints.length > 0 ? (
                      largePrints.map((trade) => (
                        <div key={trade.id} className="rounded-[18px] border border-white/8 bg-black/20 px-4 py-3">
                          <div className="flex items-center justify-between gap-3">
                            <div className="text-sm font-semibold text-white">{trade.walletShort ?? "Large print"}</div>
                            <div className={cn("text-sm font-semibold", trade.side === "buy" ? "text-lime-300" : "text-rose-300")}>
                              {trade.side === "buy" ? "Bought" : "Sold"}
                            </div>
                          </div>
                          <div className="mt-1 flex items-center justify-between gap-3 text-xs text-white/46">
                            <span>{formatUsd(trade.volumeUsd)}</span>
                            <span>{formatUsd(trade.priceUsd)}</span>
                            <span>{new Date(trade.timestampMs).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                          </div>
                        </div>
                      ))
                    ) : (
                      <div className="rounded-[18px] border border-dashed border-white/10 px-4 py-6 text-sm text-white/48">
                        Waiting for large prints from the live route.
                      </div>
                    )}
                  </div>
                </V2RightRailCard>

                <V2RightRailCard eyebrow="Live Feed" title="Execution pulse" tone="soft">
                  <div className="space-y-3">
                    {liveFeedRows.length ? (
                      liveFeedRows.map((row) => (
                        <div key={row.id} className="rounded-[18px] border border-white/8 bg-black/20 px-4 py-3">
                          <div className="flex items-center justify-between gap-3">
                            <div className="text-sm font-semibold text-white">{row.headline}</div>
                            <div className="text-[11px] text-white/40">{row.at}</div>
                          </div>
                          <div className="mt-1 text-xs text-white/50">{row.detail}</div>
                        </div>
                      ))
                    ) : (
                      <div className="rounded-[18px] border border-dashed border-white/10 px-4 py-6 text-sm text-white/48">
                        Waiting for fresh terminal prints.
                      </div>
                    )}
                  </div>
                </V2RightRailCard>

                <V2RightRailCard eyebrow="Depth Curve" title="Visible quote balance" tone="soft">
                  <div className="grid h-[220px] grid-cols-2 gap-4">
                    <div className="relative overflow-hidden rounded-[18px] border border-lime-300/10 bg-lime-300/6">
                      <div className="absolute inset-x-0 bottom-0 space-y-1.5 p-3">
                        {(depth?.depthSeries.filter((point) => point.bidDepthUsd > 0).slice(0, 8) ?? []).map((point, index, list) => {
                          const max = Math.max(...list.map((item) => item.bidDepthUsd), 1);
                          return (
                            <div
                              key={`bid-depth-${index}`}
                              className="h-4 rounded-r-full bg-lime-300/65"
                              style={{ width: `${20 + (point.bidDepthUsd / max) * 80}%` }}
                            />
                          );
                        })}
                      </div>
                    </div>
                    <div className="relative overflow-hidden rounded-[18px] border border-rose-300/10 bg-rose-500/6">
                      <div className="absolute inset-x-0 bottom-0 space-y-1.5 p-3">
                        {(depth?.depthSeries.filter((point) => point.askDepthUsd > 0).slice(0, 8) ?? []).map((point, index, list) => {
                          const max = Math.max(...list.map((item) => item.askDepthUsd), 1);
                          return (
                            <div
                              key={`ask-depth-${index}`}
                              className="ml-auto h-4 rounded-l-full bg-rose-400/70"
                              style={{ width: `${20 + (point.askDepthUsd / max) * 80}%` }}
                            />
                          );
                        })}
                      </div>
                    </div>
                  </div>
                </V2RightRailCard>
              </div>
            </div>

            <div className="space-y-4">
              <V2RightRailCard eyebrow="AI Analysis" title={convictionLabel} tone="accent">
                <div className="text-4xl font-semibold text-white">
                  {typeof token.highConvictionScore === "number" ? token.highConvictionScore.toFixed(1) : "--"}
                  <span className="ml-2 text-xl text-white/32">/100</span>
                </div>
                <p className="mt-3 text-sm leading-6 text-white/58">
                  Terminal execution data and intelligence data stay visible together here, but account or wallet performance is not inferred from this surface.
                </p>
                <div className="mt-4 grid gap-3">
                  <div className="rounded-[18px] border border-white/8 bg-black/20 px-4 py-3">
                    <div className="text-[10px] uppercase tracking-[0.16em] text-white/34">Confidence</div>
                    <div className="mt-2 text-lg font-semibold text-white">
                      {typeof token.confidenceScore === "number" ? `${token.confidenceScore.toFixed(0)} / 100` : "--"}
                    </div>
                  </div>
                  <div className="rounded-[18px] border border-white/8 bg-black/20 px-4 py-3">
                    <div className="text-[10px] uppercase tracking-[0.16em] text-white/34">Buy pressure</div>
                    <div className="mt-2 text-lg font-semibold text-white">
                      {buyPressurePct !== null ? `${buyPressurePct}%` : "--"}
                    </div>
                  </div>
                  <div className="rounded-[18px] border border-white/8 bg-black/20 px-4 py-3">
                    <div className="text-[10px] uppercase tracking-[0.16em] text-white/34">Route state</div>
                    <div className="mt-2 text-lg font-semibold text-white">
                      {tradeFeed.liveStatus.connected ? "Realtime" : "Fallback"}
                    </div>
                  </div>
                </div>
              </V2RightRailCard>

              <TradeTransactionsFeed
                trades={tradeFeed.recentTrades}
                liveMode={tradeFeed.liveStatus.mode}
                usingFallbackPolling={tradeFeed.usingFallbackPolling}
                lastTradeEventAtMs={tradeFeed.lastTradeEventAtMs}
                chainType={token.chainType === "solana" ? "solana" : "ethereum"}
              />

              <V2RightRailCard eyebrow="Active Raid" title={activeRaid?.objective ?? "No live raid"} tone="soft">
                {activeRaid ? (
                  <>
                    <div className="grid grid-cols-2 gap-3 text-sm">
                      <div className="rounded-[18px] border border-white/8 bg-black/20 px-3 py-3">
                        <div className="text-[10px] uppercase tracking-[0.16em] text-white/34">Participants</div>
                        <div className="mt-1 text-lg font-semibold text-white">{formatAmount(activeRaid.participantCount)}</div>
                      </div>
                      <div className="rounded-[18px] border border-white/8 bg-black/20 px-3 py-3">
                        <div className="text-[10px] uppercase tracking-[0.16em] text-white/34">Posted</div>
                        <div className="mt-1 text-lg font-semibold text-white">{formatAmount(activeRaid.postedCount)}</div>
                      </div>
                    </div>
                    <div className="mt-4">
                      <V2ProgressBar
                        value={
                          activeRaid.participantCount > 0
                            ? Math.round((activeRaid.postedCount / activeRaid.participantCount) * 100)
                            : 0
                        }
                        valueLabel="Posted / joined"
                      />
                    </div>
                    <Link
                      to={`/raids/${activeRaid.tokenAddress}/${activeRaid.id}`}
                      className="mt-4 inline-flex h-11 w-full items-center justify-center rounded-[16px] border border-lime-300/18 bg-[linear-gradient(90deg,rgba(169,255,52,0.96),rgba(45,212,191,0.9))] px-4 text-sm font-semibold text-slate-950"
                    >
                      Open raid
                    </Link>
                  </>
                ) : (
                  <div className="text-sm text-white/48">
                    The raid rail activates when a live community campaign is open.
                  </div>
                )}
              </V2RightRailCard>

              <V2RightRailCard eyebrow="Trending Calls" title="Signal board" tone="soft">
                <div className="space-y-3">
                  {(recentCalls.length ? recentCalls : discoveryQuery.data?.trendingCalls ?? []).slice(0, 4).map((call: DiscoverySidebarCall) => (
                    <div key={call.id} className="rounded-[18px] border border-white/8 bg-black/20 px-4 py-3">
                      <div className="text-sm font-semibold text-white">
                        {call.title || (call.ticker ? `$${call.ticker}` : "Call")}
                      </div>
                      <div className="mt-1 text-xs text-white/42">
                        {formatSignedPercent(call.roiCurrentPct)} current • {call.callsCount} calls
                      </div>
                    </div>
                  ))}
                </div>
              </V2RightRailCard>

              <V2RightRailCard eyebrow="Route Status" title="External references" tone="soft">
                <div className="space-y-3">
                  <div className="rounded-[18px] border border-white/8 bg-black/20 px-4 py-3 text-sm text-white/66">
                    Quote source
                    <span className="float-right font-semibold text-white">
                      {chartQuery.data?.source ? chartQuery.data.source.toUpperCase() : "Pending"}
                    </span>
                  </div>
                  <div className="rounded-[18px] border border-white/8 bg-black/20 px-4 py-3 text-sm text-white/66">
                    Tape connection
                    <span className="float-right font-semibold text-white">
                      {tradeFeed.liveStatus.connected ? "Connected" : "Fallback"}
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-2 pt-1">
                    <a
                      href={token.dexscreenerUrl ?? "#"}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex h-10 flex-1 items-center justify-center gap-2 rounded-[14px] border border-white/10 bg-white/[0.04] px-4 text-sm font-semibold text-white/80 transition hover:bg-white/[0.08] hover:text-white"
                    >
                      Open Dexscreener
                      <ExternalLink className="h-4 w-4" />
                    </a>
                    <Link
                      to={`/token/${token.address}`}
                      className="inline-flex h-10 flex-1 items-center justify-center rounded-[14px] border border-lime-300/18 bg-lime-300/10 px-4 text-sm font-semibold text-lime-200 transition hover:bg-lime-300/14"
                    >
                      Open token board
                    </Link>
                  </div>
                </div>
              </V2RightRailCard>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function KpiBox({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[16px] border border-white/8 bg-white/[0.03] px-4 py-3">
      <div className="text-[11px] uppercase tracking-[0.18em] text-white/38">{label}</div>
      <div className="mt-2 text-lg font-semibold text-white">{value}</div>
    </div>
  );
}

function InlineMetric({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "lime" | "teal" | "default";
}) {
  return (
    <div
      className={cn(
        "rounded-[18px] border px-3 py-3",
        tone === "lime"
          ? "border-lime-300/16 bg-lime-300/8"
          : tone === "teal"
            ? "border-cyan-300/16 bg-cyan-300/8"
            : "border-white/8 bg-white/[0.03]"
      )}
    >
      <div className="text-[10px] uppercase tracking-[0.16em] text-white/36">{label}</div>
      <div className="mt-2 text-lg font-semibold text-white">{value}</div>
    </div>
  );
}

function OrderRow({ side, price, amount, total }: { side: "bid" | "ask"; price: number; amount: number; total: number }) {
  return (
    <div
      className={cn(
        "grid grid-cols-3 gap-3 rounded-[14px] px-3 py-2 text-sm",
        side === "ask" ? "border border-rose-400/10 bg-rose-500/6" : "border border-lime-300/10 bg-lime-300/6"
      )}
    >
      <span className={side === "ask" ? "text-rose-300" : "text-lime-300"}>{formatUsd(price)}</span>
      <span className="text-right text-white/66">{formatAmount(amount)}</span>
      <span className="text-right text-white/72">{formatUsd(total)}</span>
    </div>
  );
}

function BottomCard({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="rounded-[22px] border border-white/8 bg-white/[0.03] px-4 py-4">
      <div className="text-[11px] uppercase tracking-[0.18em] text-white/38">{label}</div>
      <div className="mt-3 text-2xl font-semibold text-white">{value}</div>
      <div className="mt-1 text-xs text-white/42">{hint}</div>
    </div>
  );
}
