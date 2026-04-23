import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { ExternalLink, Search } from "lucide-react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TradeTransactionsFeed } from "@/components/feed/TradeTransactionsFeed";
import { DirectTokenTradePanel } from "@/components/token/DirectTokenTradePanel";
import { useTradePanelLiveFeed } from "@/lib/trade-panel-live";
import { cn } from "@/lib/utils";
import type { TerminalDepthResponse } from "@/types";

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

export default function Terminal() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [draftToken, setDraftToken] = useState(searchParams.get("token") ?? "");
  const [activeBottomTab, setActiveBottomTab] = useState<"orders" | "history" | "positions" | "holdings">("positions");
  const tokenAddress = searchParams.get("token")?.trim() || "";

  const tokenQuery = useQuery<TerminalTokenResponse>({
    queryKey: ["terminal-token-v2", tokenAddress],
    enabled: tokenAddress.length > 0,
    staleTime: 30_000,
    gcTime: 5 * 60_000,
    refetchOnWindowFocus: false,
    queryFn: async () => api.get<TerminalTokenResponse>(`/api/tokens/${tokenAddress}`),
  });

  const token = tokenQuery.data ?? null;

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

  const depth = depthQuery.data ?? null;

  const handleSearch = () => {
    const next = draftToken.trim();
    setSearchParams(next ? { token: next } : {});
  };

  const chartBars = useMemo(() => {
    const prices = tradeFeed.recentTrades
      .slice(0, 32)
      .reverse()
      .map((trade) => trade.priceUsd)
      .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
    if (!prices.length) return Array.from({ length: 24 }, (_, index) => ({ value: 18 + ((index * 17) % 64), positive: index % 3 !== 0 }));
    return prices.map((value, index, list) => {
      const min = Math.min(...list);
      const max = Math.max(...list);
      const spread = Math.max(max - min, max * 0.02, 0.0000001);
      return {
        value: Math.max(14, ((value - min) / spread) * 100),
        positive: index === 0 ? true : value >= list[index - 1]!,
      };
    });
  }, [tradeFeed.recentTrades]);

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

  const convictionLabel = token?.highConvictionScore
    ? token.highConvictionScore >= 90
      ? "High Conviction"
      : token.highConvictionScore >= 70
        ? "Bullish Setup"
        : "Developing"
    : "Developing";

  const benchmarkMarkets = [
    { symbol: "BTC", price: "$68.6K", change: "+1.32%" },
    { symbol: "ETH", price: "$3.24K", change: "+2.21%" },
    { symbol: "SOL", price: "$179.35", change: "+3.65%" },
    { symbol: "X RAIDS", price: "Live", change: "Room flow" },
  ];

  const signalMatrix = useMemo(
    () => [
      {
        label: "AI Analysis",
        value: token?.highConvictionScore ? `${token.highConvictionScore.toFixed(0)} / 100` : "--",
        detail: convictionLabel,
      },
      {
        label: "Smart Money",
        value: largePrints.length > 1 ? "Active" : "Quiet",
        detail: `${largePrints.length} large prints`,
      },
      {
        label: "Buy Flow",
        value: buyPressurePct !== null ? `${buyPressurePct}%` : "--",
        detail: "Recent trade sample",
      },
      {
        label: "Community Room",
        value: token?.symbol ? `$${token.symbol}` : "Open room",
        detail: "Signals and raids",
      },
    ],
    [buyPressurePct, convictionLabel, largePrints.length, token?.highConvictionScore, token?.symbol]
  );

  const liveFeedRows = useMemo(
    () =>
      tradeFeed.recentTrades.slice(0, 5).map((trade) => ({
        id: trade.id,
        headline: `${trade.walletShort ?? "Trader"} ${trade.side === "buy" ? "hit the ask" : "tapped the bid"}`,
        detail: `${formatUsd(trade.volumeUsd)} / ${formatAmount(trade.priceUsd)}`,
        at: new Date(trade.timestampMs).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      })),
    [tradeFeed.recentTrades]
  );

  return (
    <div className="space-y-5">
      <section className="rounded-[26px] border border-white/8 bg-[linear-gradient(180deg,rgba(8,12,18,0.96),rgba(5,8,12,0.98))] px-4 py-3">
        <div className="grid gap-3 md:grid-cols-4">
          {benchmarkMarkets.map((market) => (
            <div key={market.symbol} className="rounded-[18px] border border-white/8 bg-white/[0.03] px-4 py-3">
              <div className="text-[10px] uppercase tracking-[0.16em] text-white/34">{market.symbol}</div>
              <div className="mt-2 text-sm font-semibold text-white">{market.price}</div>
              <div className={cn("mt-1 text-xs", market.change.startsWith("+") ? "text-lime-300" : "text-cyan-200")}>{market.change}</div>
            </div>
          ))}
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
            ) : null}
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
              Enter a token address to open the order surface, market prints, and direct trade panel.
            </p>
          </div>
        </section>
      ) : tokenQuery.isLoading ? (
        <section className="rounded-[30px] border border-white/8 bg-white/[0.03] px-6 py-10 text-sm text-white/56">Loading terminal context...</section>
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
                    <div className={cn("mt-1 text-sm font-semibold", (token.priceChange24hPct ?? 0) >= 0 ? "text-lime-300" : "text-rose-300")}>
                      {(token.priceChange24hPct ?? 0) >= 0 ? "+" : ""}{token.priceChange24hPct?.toFixed(2) ?? "--"}%
                    </div>
                  </div>
                </div>
                <div className="grid gap-3 sm:grid-cols-4">
                  <KpiBox label="24H High" value={depth?.asks[0] ? formatUsd(depth.asks[0].price) : "--"} />
                  <KpiBox label="24H Low" value={depth?.bids[depth.bids.length - 1] ? formatUsd(depth.bids[depth.bids.length - 1].price) : "--"} />
                  <KpiBox label="24H Vol" value={formatUsd(token.volume24h)} />
                  <KpiBox label="Liquidity" value={formatUsd(token.liquidity)} />
                </div>
              </div>
            </div>

            <div className="grid gap-0 xl:grid-cols-[300px_minmax(0,1fr)_320px]">
              <div className="border-r border-white/8 px-4 py-4">
                <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-white/38">Order Book</div>
                <div className="mt-4 rounded-[22px] border border-white/8 bg-white/[0.02] p-3">
                  <div className="grid grid-cols-3 gap-3 px-1 text-[10px] uppercase tracking-[0.16em] text-white/34">
                    <span>Price</span>
                    <span className="text-right">Amount</span>
                    <span className="text-right">Total</span>
                  </div>
                  <div className="mt-3 space-y-2">
                    {depth?.asks.slice(0, 8).map((row, index) => (
                      <OrderRow key={`ask-${index}-${row.price}`} side="ask" price={row.price} amount={row.amount} total={row.totalUsd} />
                    ))}
                    <div className="rounded-[14px] border border-lime-300/14 bg-lime-300/8 px-3 py-3 text-center text-lg font-semibold text-lime-300">
                      {formatUsd(token.priceUsd)}
                    </div>
                    {depth?.bids.slice(0, 8).map((row, index) => (
                      <OrderRow key={`bid-${index}-${row.price}`} side="bid" price={row.price} amount={row.amount} total={row.totalUsd} />
                    ))}
                  </div>
                </div>
              </div>

              <div className="px-4 py-4">
                <div className="flex items-center justify-between gap-3 border-b border-white/8 pb-3">
                  <div>
                    <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-white/38">Chart Core</div>
                    <div className="mt-1 text-sm text-white/54">
                      {tradeFeed.liveStatus.connected ? "Realtime prints feeding the terminal." : "Fallback polling active."}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2 text-xs">
                    {["1m", "5m", "15m", "1h", "4h", "1D"].map((label) => (
                      <span key={label} className={cn("rounded-full border px-3 py-1", label === "1m" ? "border-lime-300/16 bg-lime-300/10 text-lime-200" : "border-white/8 bg-white/[0.03] text-white/54")}>
                        {label}
                      </span>
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
                    value={token.confidenceScore ? `${token.confidenceScore.toFixed(0)}` : "--"}
                    tone="teal"
                  />
                  <InlineMetric label="Holders" value={formatAmount(token.holderCount)} tone="default" />
                  <InlineMetric label="Activity" value={token.activityStatusLabel ?? "Monitoring"} tone="default" />
                </div>

                <div className="mt-4 rounded-[24px] border border-white/8 bg-[linear-gradient(180deg,rgba(8,14,17,0.98),rgba(4,8,10,0.98))] p-4">
                  <div className="relative h-[320px] overflow-hidden rounded-[20px] border border-white/6 bg-[linear-gradient(180deg,rgba(255,255,255,0.02),rgba(255,255,255,0.01))]">
                    <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.04)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.03)_1px,transparent_1px)] bg-[size:56px_56px]" />
                    <div className="absolute inset-x-0 bottom-0 flex items-end gap-1 px-4 pb-4">
                      {chartBars.map((bar, index) => (
                        <div key={index} className="flex min-h-[12px] flex-1 flex-col justify-end">
                          <div
                            className={cn("rounded-t-[6px]", bar.positive ? "bg-lime-300/82" : "bg-rose-400/82")}
                            style={{ height: `${bar.value}%` }}
                          />
                        </div>
                      ))}
                    </div>
                    <div className="absolute right-4 top-4 rounded-[14px] border border-white/8 bg-black/20 px-3 py-2 text-right">
                      <div className="text-xs uppercase tracking-[0.16em] text-white/34">Last</div>
                      <div className="mt-1 text-sm font-semibold text-lime-300">{formatUsd(token.priceUsd)}</div>
                    </div>
                  </div>
                </div>

                <div className="mt-4">
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

              <div className="border-l border-white/8 px-4 py-4">
                <div className="space-y-4">
                  <div className="rounded-[24px] border border-lime-300/12 bg-[radial-gradient(circle_at_top_left,rgba(169,255,52,0.12),transparent_28%),linear-gradient(180deg,rgba(11,16,13,0.98),rgba(7,10,12,0.99))] p-4">
                    <div className="mb-3 flex items-center justify-between gap-3">
                      <div className="text-[11px] uppercase tracking-[0.18em] text-white/38">AI Analysis</div>
                      <span className="rounded-full border border-lime-300/18 bg-lime-300/8 px-3 py-1 text-[10px] uppercase tracking-[0.14em] text-lime-200">
                        {convictionLabel}
                      </span>
                    </div>
                    <div className="text-3xl font-semibold text-white">
                      {token.highConvictionScore ? token.highConvictionScore.toFixed(1) : "--"}
                    </div>
                    <div className="mt-2 text-sm leading-6 text-white/56">
                      Execution and token intelligence are shown together here, but they remain separate signals.
                    </div>
                    <div className="mt-4 grid gap-2">
                      {signalMatrix.slice(0, 3).map((item) => (
                        <div key={item.label} className="rounded-[16px] border border-white/8 bg-black/20 px-3 py-3">
                          <div className="text-[10px] uppercase tracking-[0.16em] text-white/34">{item.label}</div>
                          <div className="mt-1 text-sm font-semibold text-white">{item.value}</div>
                          <div className="mt-1 text-xs text-white/42">{item.detail}</div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <TradeTransactionsFeed
                    trades={tradeFeed.recentTrades}
                    liveMode={tradeFeed.liveStatus.mode}
                    usingFallbackPolling={tradeFeed.usingFallbackPolling}
                    lastTradeEventAtMs={tradeFeed.lastTradeEventAtMs}
                    chainType={token.chainType === "solana" ? "solana" : "ethereum"}
                  />

                  <div className="rounded-[24px] border border-white/8 bg-white/[0.03] p-4">
                    <div className="mb-3 flex items-center justify-between gap-3">
                      <div className="text-[11px] uppercase tracking-[0.18em] text-white/38">Depth Chart</div>
                      <div className="rounded-full border border-white/8 bg-white/[0.03] px-3 py-1 text-[10px] uppercase tracking-[0.14em] text-white/44">
                        Derived from quote ladder
                      </div>
                    </div>
                    <div className="mt-4 grid h-[220px] grid-cols-2 gap-4">
                      <div className="relative overflow-hidden rounded-[18px] border border-lime-300/10 bg-lime-300/6">
                        <div className="absolute inset-x-0 bottom-0">
                          {(depth?.depthSeries.slice(0, 8) ?? []).map((point, index, list) => {
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
                        <div className="absolute inset-x-0 bottom-0">
                          {(depth?.depthSeries.slice(0, 8) ?? []).map((point, index, list) => {
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
                  </div>

                  <div className="rounded-[24px] border border-white/8 bg-white/[0.03] p-4">
                    <div className="text-[11px] uppercase tracking-[0.18em] text-white/38">Routing Status</div>
                    <div className="mt-3 text-lg font-semibold text-white">
                      {tradeFeed.liveStatus.connected ? "Realtime stream connected" : "Fallback polling"}
                    </div>
                    <div className="mt-2 text-sm text-white/52">
                      Confidence {token.confidenceScore?.toFixed(0) ?? "--"} / Conviction {token.highConvictionScore?.toFixed(0) ?? "--"}.
                    </div>
                    <div className="mt-4 flex flex-wrap gap-2">
                      <a
                        href={token.dexscreenerUrl ?? "#"}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-2 text-sm font-semibold text-lime-300"
                      >
                        Open Dexscreener
                        <ExternalLink className="h-4 w-4" />
                      </a>
                      <Link to={`/token/${token.address}`} className="inline-flex items-center gap-2 text-sm font-semibold text-cyan-200">
                        Open token board
                      </Link>
                    </div>
                  </div>

                  <div className="rounded-[24px] border border-white/8 bg-white/[0.03] p-4">
                    <div className="mb-3 flex items-center justify-between gap-3">
                      <div className="text-[11px] uppercase tracking-[0.18em] text-white/38">Room Coordination</div>
                      <span className="rounded-full border border-white/8 bg-white/[0.03] px-3 py-1 text-[10px] uppercase tracking-[0.14em] text-white/44">
                        Community
                      </span>
                    </div>
                    <div className="text-lg font-semibold text-white">
                      {token.symbol ? `$${token.symbol} room` : "Token room"}
                    </div>
                    <div className="mt-2 text-sm leading-6 text-white/54">
                      Use the room for raids and discussion without confusing room progress with execution or PnL.
                    </div>
                    <div className="mt-4 flex gap-2">
                      <Link
                        to={`/communities/${token.address}`}
                        className="inline-flex h-10 flex-1 items-center justify-center rounded-[14px] border border-white/10 bg-white/[0.04] px-4 text-sm font-semibold text-white/80 transition hover:bg-white/[0.08] hover:text-white"
                      >
                        Open Community
                      </Link>
                      <Link
                        to={`/token/${token.address}?tab=community`}
                        className="inline-flex h-10 flex-1 items-center justify-center rounded-[14px] border border-lime-300/18 bg-lime-300/10 px-4 text-sm font-semibold text-lime-200 transition hover:bg-lime-300/14"
                      >
                        View Signals
                      </Link>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </section>

          <section className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_400px]">
            <div className="space-y-4">
              <div className="rounded-[32px] border border-white/8 bg-[linear-gradient(180deg,rgba(8,12,16,0.98),rgba(4,7,10,0.98))] p-5">
                <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-white/38">Terminal Board</div>
                <div className="mt-4 flex flex-wrap gap-3">
                  {[
                    { value: "orders", label: "Open Orders" },
                    { value: "history", label: "Order History" },
                    { value: "positions", label: "Positions" },
                    { value: "holdings", label: "Holdings" },
                  ].map((item) => (
                    <button
                      key={item.value}
                      type="button"
                      onClick={() => setActiveBottomTab(item.value as typeof activeBottomTab)}
                      className={cn(
                        "rounded-full border px-4 py-2 text-sm transition",
                        activeBottomTab === item.value ? "border-lime-300/18 bg-lime-300/8 text-lime-200" : "border-white/8 bg-white/[0.03] text-white/54 hover:text-white"
                      )}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>

                <div className="mt-5 grid gap-3 md:grid-cols-3">
                  <BottomCard
                    label={activeBottomTab === "orders" ? "Open Orders" : activeBottomTab === "history" ? "Executed Prints" : activeBottomTab === "positions" ? "Exposure" : "Holdings"}
                    value={
                      activeBottomTab === "orders"
                        ? formatAmount(depth?.positionSummary.openOrders ?? 0)
                        : activeBottomTab === "history"
                          ? formatAmount(tradeFeed.recentTrades.length)
                          : activeBottomTab === "positions"
                            ? formatUsd(depth?.positionSummary.exposureUsd)
                            : formatUsd(depth?.positionSummary.holdingsUsd)
                    }
                    hint="Live terminal state"
                  />
                  <BottomCard label="Spread" value={depth?.spread ? formatUsd(depth.spread) : "--"} hint="Derived execution gap" />
                  <BottomCard label="Holders" value={formatAmount(token.holderCount)} hint="Token context" />
                </div>
              </div>

              <div className="rounded-[32px] border border-white/8 bg-[linear-gradient(180deg,rgba(8,12,16,0.98),rgba(4,7,10,0.98))] p-5">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-white/38">Signal Matrix</div>
                    <div className="mt-1 text-sm text-white/54">AI context, room access, and trade flow.</div>
                  </div>
                </div>
                <div className="mt-4 grid gap-3 md:grid-cols-2">
                  {signalMatrix.map((item) => (
                    <div key={item.label} className="rounded-[22px] border border-white/8 bg-white/[0.03] px-4 py-4">
                      <div className="text-[10px] uppercase tracking-[0.16em] text-white/34">{item.label}</div>
                      <div className="mt-3 text-xl font-semibold text-white">{item.value}</div>
                      <div className="mt-1 text-xs text-white/44">{item.detail}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="space-y-4">
              <div className="rounded-[28px] border border-white/8 bg-[linear-gradient(180deg,rgba(8,12,16,0.98),rgba(4,7,10,0.98))] p-5">
                <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-white/38">Whale Activity</div>
                <div className="mt-4 space-y-3">
                  {largePrints.length > 0 ? (
                    largePrints.map((trade) => (
                      <div key={trade.id} className="rounded-[18px] border border-white/8 bg-white/[0.03] px-4 py-3">
                        <div className="flex items-center justify-between gap-3">
                          <div className="text-sm font-semibold text-white">{trade.walletShort ?? "Large print"}</div>
                          <div className={cn("text-sm font-semibold", trade.side === "buy" ? "text-lime-300" : "text-rose-300")}>
                            {trade.side === "buy" ? "Bought" : "Sold"}
                          </div>
                        </div>
                        <div className="mt-1 flex items-center justify-between gap-3 text-xs text-white/46">
                          <span>{formatUsd(trade.volumeUsd)}</span>
                          <span>{formatAmount(trade.priceUsd)} / token</span>
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
              </div>

              <div className="rounded-[28px] border border-white/8 bg-[linear-gradient(180deg,rgba(8,12,16,0.98),rgba(4,7,10,0.98))] p-5">
                <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-white/38">Execution Pulse</div>
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <BottomCard label="Smart Money" value={largePrints.length > 1 ? "Active" : "Quiet"} hint="Based on large route prints" />
                  <BottomCard label="Momentum" value={(token.priceChange24hPct ?? 0) >= 0 ? "Bullish" : "Weak"} hint="24H trend" />
                  <BottomCard label="Buy Flow" value={buyPressurePct !== null ? `${buyPressurePct}%` : "--"} hint="Recent trade sample" />
                  <BottomCard label="Live Route" value={tradeFeed.liveStatus.connected ? "Connected" : "Fallback"} hint="Execution transport" />
                </div>
              </div>

              <div className="rounded-[28px] border border-white/8 bg-[linear-gradient(180deg,rgba(8,12,16,0.98),rgba(4,7,10,0.98))] p-5">
                <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-white/38">Live Feed</div>
                <div className="mt-4 space-y-3">
                  {liveFeedRows.length ? liveFeedRows.map((row) => (
                    <div key={row.id} className="rounded-[18px] border border-white/8 bg-white/[0.03] px-4 py-3">
                      <div className="flex items-center justify-between gap-3">
                        <div className="text-sm font-semibold text-white">{row.headline}</div>
                        <div className="text-[11px] text-white/40">{row.at}</div>
                      </div>
                      <div className="mt-1 text-xs text-white/50">{row.detail}</div>
                    </div>
                  )) : (
                    <div className="rounded-[18px] border border-dashed border-white/10 px-4 py-6 text-sm text-white/48">
                      Waiting for fresh terminal prints.
                    </div>
                  )}
                </div>
              </div>
            </div>
          </section>
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
    <div className={cn(
      "grid grid-cols-3 gap-3 rounded-[14px] px-3 py-2 text-sm",
      side === "ask" ? "border border-rose-400/10 bg-rose-500/6" : "border border-lime-300/10 bg-lime-300/6"
    )}>
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
