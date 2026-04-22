import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { CandlestickChart, ExternalLink, Search } from "lucide-react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TradeTransactionsFeed } from "@/components/feed/TradeTransactionsFeed";
import { DirectTokenTradePanel } from "@/components/token/DirectTokenTradePanel";
import { V2PageHeader } from "@/components/layout/V2PageHeader";
import { V2EmptyState } from "@/components/ui/v2/V2EmptyState";
import { V2StatusPill } from "@/components/ui/v2/V2StatusPill";
import { useTradePanelLiveFeed } from "@/lib/trade-panel-live";
import { cn } from "@/lib/utils";

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

function formatUsd(value: number | null) {
  if (value === null || !Number.isFinite(value)) return "--";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: Math.abs(value) >= 1000 ? "compact" : "standard",
    maximumFractionDigits: value >= 1 ? 2 : 6,
  }).format(value);
}

function formatCompact(value: number | null) {
  if (value === null || !Number.isFinite(value)) return "--";
  return new Intl.NumberFormat("en-US", {
    notation: Math.abs(value) >= 1000 ? "compact" : "standard",
    maximumFractionDigits: 1,
  }).format(value);
}

export default function Terminal() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [draftToken, setDraftToken] = useState(searchParams.get("token") ?? "");
  const tokenAddress = searchParams.get("token")?.trim() || "";

  const tokenQuery = useQuery<TerminalTokenResponse>({
    queryKey: ["terminal-token", tokenAddress],
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

  const handleSearch = () => {
    const next = draftToken.trim();
    setSearchParams(next ? { token: next } : {});
  };

  const pricePoints = useMemo(
    () => tradeFeed.recentTrades.slice(0, 24).reverse().map((trade) => trade.priceUsd).filter((value): value is number => typeof value === "number" && Number.isFinite(value)),
    [tradeFeed.recentTrades]
  );

  const orderRows = useMemo(
    () =>
      tradeFeed.recentTrades.slice(0, 12).map((trade) => ({
        id: trade.id,
        side: trade.side,
        price: formatUsd(trade.priceUsd),
        amount: trade.fromAmount !== null && Number.isFinite(trade.fromAmount)
          ? trade.fromAmount.toLocaleString(undefined, { maximumFractionDigits: trade.fromAmount >= 1 ? 2 : 6 })
          : "--",
        total: formatUsd(trade.volumeUsd),
      })),
    [tradeFeed.recentTrades]
  );

  const sells = orderRows.filter((row) => row.side === "sell").slice(0, 6);
  const buys = orderRows.filter((row) => row.side === "buy").slice(0, 6);
  const maxChart = pricePoints.length ? Math.max(...pricePoints) : 0;
  const minChart = pricePoints.length ? Math.min(...pricePoints) : 0;
  const spread = Math.max(maxChart - minChart, maxChart * 0.02, 0.0000001);

  return (
    <div className="space-y-5">
      <V2PageHeader
        title="Trading Terminal"
        description="Dense execution, order flow, and market-intelligence surface on top of the existing token query and trade-feed stack."
        badge={<V2StatusPill tone={tradeFeed.liveStatus.connected ? "live" : "default"}>{tradeFeed.liveStatus.connected ? "Live" : "Standby"}</V2StatusPill>}
        action={
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex min-w-[280px] items-center gap-2 rounded-[20px] border border-white/10 bg-white/[0.04] p-2">
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
            {token?.address ? (
              <Button
                type="button"
                variant="ghost"
                className="rounded-2xl border border-white/10 bg-white/[0.04] text-white/76 hover:bg-white/[0.08] hover:text-white"
                onClick={() => navigate(`/token/${token.address}?tab=trade`)}
              >
                Open token board
              </Button>
            ) : null}
          </div>
        }
      />

      {!tokenAddress ? (
        <V2EmptyState
          icon={<CandlestickChart className="h-7 w-7" />}
          title="Load a live market"
          description="Enter a token address to open the order surface, market prints, and direct trade panel."
        />
      ) : tokenQuery.isLoading ? (
        <div className="v2-terminal-frame p-8 text-sm text-white/56">Loading terminal context...</div>
      ) : tokenQuery.isError || !token ? (
        <V2EmptyState
          icon={<CandlestickChart className="h-7 w-7" />}
          title="Unable to load this token"
          description="The terminal could not resolve token context from the current token endpoint."
          action={
            <Button type="button" onClick={() => navigate("/")}>
              Back to feed
            </Button>
          }
        />
      ) : (
        <>
          <section className="v2-terminal-frame overflow-hidden">
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
                  <div className="v2-micro-kpi">
                    <div className="text-[11px] uppercase tracking-[0.18em] text-white/38">24H High</div>
                    <div className="mt-2 text-lg font-semibold text-white">{pricePoints.length ? formatUsd(maxChart) : "--"}</div>
                  </div>
                  <div className="v2-micro-kpi">
                    <div className="text-[11px] uppercase tracking-[0.18em] text-white/38">24H Low</div>
                    <div className="mt-2 text-lg font-semibold text-white">{pricePoints.length ? formatUsd(minChart) : "--"}</div>
                  </div>
                  <div className="v2-micro-kpi">
                    <div className="text-[11px] uppercase tracking-[0.18em] text-white/38">24H Vol</div>
                    <div className="mt-2 text-lg font-semibold text-white">{formatUsd(token.volume24h)}</div>
                  </div>
                  <div className="v2-micro-kpi">
                    <div className="text-[11px] uppercase tracking-[0.18em] text-white/38">Liquidity</div>
                    <div className="mt-2 text-lg font-semibold text-white">{formatUsd(token.liquidity)}</div>
                  </div>
                </div>
              </div>
            </div>

            <div className="v2-terminal-grid">
              <div className="v2-terminal-cell px-4 py-4">
                <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-white/38">Order book</div>
                <div className="mt-4 rounded-[22px] border border-white/8 bg-white/[0.02] p-3">
                  <div className="grid grid-cols-3 gap-3 px-1 text-[10px] uppercase tracking-[0.16em] text-white/34">
                    <span>Price</span>
                    <span className="text-right">Amount</span>
                    <span className="text-right">Total</span>
                  </div>
                  <div className="mt-3 space-y-2">
                    {sells.map((row) => (
                      <div key={row.id} className="grid grid-cols-3 gap-3 rounded-[14px] border border-rose-400/10 bg-rose-500/6 px-3 py-2 text-sm">
                        <span className="text-rose-300">{row.price}</span>
                        <span className="text-right text-white/66">{row.amount}</span>
                        <span className="text-right text-white/72">{row.total}</span>
                      </div>
                    ))}
                    <div className="rounded-[14px] border border-lime-300/14 bg-lime-300/8 px-3 py-3 text-center text-lg font-semibold text-lime-300">
                      {formatUsd(token.priceUsd)}
                    </div>
                    {buys.map((row) => (
                      <div key={row.id} className="grid grid-cols-3 gap-3 rounded-[14px] border border-lime-300/10 bg-lime-300/6 px-3 py-2 text-sm">
                        <span className="text-lime-300">{row.price}</span>
                        <span className="text-right text-white/66">{row.amount}</span>
                        <span className="text-right text-white/72">{row.total}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div className="v2-terminal-cell px-4 py-4">
                <div className="flex items-center justify-between gap-3 border-b border-white/8 pb-3">
                  <div>
                    <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-white/38">Chart core</div>
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

                <div className="mt-4 rounded-[24px] border border-white/8 bg-[linear-gradient(180deg,rgba(8,14,17,0.98),rgba(4,8,10,0.98))] p-4">
                  <div className="relative h-[360px] overflow-hidden rounded-[20px] border border-white/6 bg-[linear-gradient(180deg,rgba(255,255,255,0.02),rgba(255,255,255,0.01))]">
                    <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.04)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.03)_1px,transparent_1px)] bg-[size:56px_56px]" />
                    <div className="absolute inset-x-0 bottom-0 flex items-end gap-1 px-4 pb-4">
                      {(pricePoints.length ? pricePoints : Array.from({ length: 24 }, (_, index) => 24 - index)).map((value, index, list) => {
                        const normalized = ((value - (minChart || 0)) / spread) * 100;
                        const previous = index > 0 ? list[index - 1]! : value;
                        const positive = value >= previous;
                        return (
                          <div key={`${value}-${index}`} className="flex min-h-[12px] flex-1 flex-col justify-end">
                            <div
                              className={cn("rounded-t-[6px]", positive ? "bg-lime-300/82" : "bg-rose-400/82")}
                              style={{ height: `${Math.max(12, normalized)}%` }}
                            />
                          </div>
                        );
                      })}
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

              <div className="v2-terminal-cell px-4 py-4">
                <div className="space-y-4">
                  <TradeTransactionsFeed
                    trades={tradeFeed.recentTrades}
                    liveMode={tradeFeed.liveStatus.mode}
                    usingFallbackPolling={tradeFeed.usingFallbackPolling}
                    lastTradeEventAtMs={tradeFeed.lastTradeEventAtMs}
                    chainType={token.chainType === "solana" ? "solana" : "ethereum"}
                  />

                  <div className="rounded-[24px] border border-white/8 bg-white/[0.03] p-4">
                    <div className="text-[11px] uppercase tracking-[0.18em] text-white/38">Depth chart</div>
                    <div className="mt-4 grid h-[220px] grid-cols-2 gap-4">
                      <div className="relative overflow-hidden rounded-[18px] border border-lime-300/10 bg-lime-300/6">
                        <div className="absolute inset-x-0 bottom-0">
                          {(pricePoints.length ? pricePoints.slice(0, 8) : [1, 2, 3, 4, 5, 6, 7, 8]).map((value, index) => (
                            <div
                              key={`bid-${index}`}
                              className="h-4 rounded-r-full bg-lime-300/65"
                              style={{ width: `${20 + ((index + 1) / 8) * 80}%` }}
                            />
                          ))}
                        </div>
                      </div>
                      <div className="relative overflow-hidden rounded-[18px] border border-rose-300/10 bg-rose-500/6">
                        <div className="absolute inset-x-0 bottom-0">
                          {(pricePoints.length ? pricePoints.slice(0, 8) : [1, 2, 3, 4, 5, 6, 7, 8]).map((value, index) => (
                            <div
                              key={`ask-${index}`}
                              className="ml-auto h-4 rounded-l-full bg-rose-400/70"
                              style={{ width: `${20 + ((index + 1) / 8) * 80}%` }}
                            />
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="rounded-[24px] border border-white/8 bg-white/[0.03] p-4">
                    <div className="text-[11px] uppercase tracking-[0.18em] text-white/38">Routing status</div>
                    <div className="mt-3 text-lg font-semibold text-white">
                      {tradeFeed.liveStatus.connected ? "Realtime stream connected" : "Fallback polling"}
                    </div>
                    <div className="mt-2 text-sm text-white/52">
                      Confidence {token.confidenceScore?.toFixed(0) ?? "--"} / Conviction {token.highConvictionScore?.toFixed(0) ?? "--"}.
                    </div>
                    <div className="mt-4">
                      <a
                        href={token.dexscreenerUrl ?? "#"}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-2 text-sm font-semibold text-lime-300"
                      >
                        Open Dexscreener
                        <ExternalLink className="h-4 w-4" />
                      </a>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
