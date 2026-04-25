import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import {
  ArrowRightLeft,
  CheckCircle2,
  Copy,
  ExternalLink,
  Loader2,
  Maximize2,
  Search,
  Share2,
  ShieldAlert,
  Sparkles,
  Star,
  Users,
  Zap,
} from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { DirectTokenTradePanel } from "@/components/token/DirectTokenTradePanel";
import { TradeTransactionsFeed } from "@/components/feed/TradeTransactionsFeed";
import { useTradePanelLiveFeed } from "@/lib/trade-panel-live";
import { ProCandlestickChart } from "./ProCandlestickChart";
import {
  TERMINAL_TIMEFRAMES,
  type TerminalAggregateResponse,
  type TerminalDepthLevel,
  type TerminalTimeframe,
} from "./types";

type ProTerminalSurfaceProps = {
  initialTokenAddress?: string | null;
};

function formatUsd(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "--";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: Math.abs(value) >= 1_000 ? "compact" : "standard",
    maximumFractionDigits: Math.abs(value) >= 1 ? 2 : 8,
  }).format(value);
}

function formatCompact(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "--";
  return new Intl.NumberFormat("en-US", {
    notation: Math.abs(value) >= 1_000 ? "compact" : "standard",
    maximumFractionDigits: Math.abs(value) >= 1_000 ? 1 : 2,
  }).format(value);
}

function formatPct(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "--";
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}

function shortAddress(value: string | null | undefined): string {
  if (!value) return "--";
  if (value.length <= 12) return value;
  return `${value.slice(0, 6)}...${value.slice(-5)}`;
}

function scoreTone(score: number | null | undefined): string {
  if (typeof score !== "number" || !Number.isFinite(score)) return "text-white/48";
  if (score >= 75) return "text-lime-300";
  if (score >= 50) return "text-yellow-300";
  return "text-rose-300";
}

function EmptyTerminalState({ onLoad }: { onLoad: (value: string) => void }) {
  const [draft, setDraft] = useState("");
  return (
    <section className="rounded-[28px] border border-white/8 bg-[linear-gradient(180deg,rgba(6,12,16,0.96),rgba(2,6,9,0.98))] px-6 py-16 text-center">
      <div className="mx-auto max-w-2xl">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl border border-lime-300/20 bg-lime-300/10 text-lime-200">
          <ArrowRightLeft className="h-6 w-6" />
        </div>
        <h1 className="mt-5 text-3xl font-semibold tracking-[-0.04em] text-white">Open a live execution terminal</h1>
        <p className="mx-auto mt-3 max-w-xl text-sm leading-6 text-white/52">
          Paste a token address to load the aggregate terminal context: metadata, candles, market flow, execution state, AI signals, calls, raids, and community.
        </p>
        <div className="mx-auto mt-7 flex max-w-xl items-center gap-2 rounded-[18px] border border-white/10 bg-black/30 p-2">
          <Input
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && draft.trim()) onLoad(draft.trim());
            }}
            placeholder="Paste token address..."
            className="border-0 bg-transparent text-white placeholder:text-white/32 focus-visible:ring-0"
          />
          <Button onClick={() => draft.trim() && onLoad(draft.trim())} className="h-10 rounded-xl">
            Load
          </Button>
        </div>
      </div>
    </section>
  );
}

function MetricTile({
  label,
  value,
  detail,
  tone = "default",
}: {
  label: string;
  value: string;
  detail?: string | null;
  tone?: "default" | "gain" | "loss";
}) {
  return (
    <div className="rounded-[16px] border border-white/8 bg-white/[0.035] px-3 py-3">
      <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-white/34">{label}</div>
      <div
        className={cn(
          "mt-1 text-sm font-semibold",
          tone === "gain" ? "text-lime-300" : tone === "loss" ? "text-rose-300" : "text-white"
        )}
      >
        {value}
      </div>
      {detail ? <div className="mt-1 truncate text-[11px] text-white/38">{detail}</div> : null}
    </div>
  );
}

function OrderBookRow({ row, maxTotal }: { row: TerminalDepthLevel; maxTotal: number }) {
  const width = maxTotal > 0 ? Math.max(8, Math.min(100, (row.totalUsd / maxTotal) * 100)) : 0;
  const isBid = row.side === "bid";
  return (
    <div className="relative grid grid-cols-3 overflow-hidden rounded-lg px-2 py-1.5 text-[11px]">
      <div
        className={cn("absolute inset-y-0 right-0 opacity-18", isBid ? "bg-lime-400" : "bg-rose-500")}
        style={{ width: `${width}%` }}
      />
      <span className={cn("relative font-semibold", isBid ? "text-lime-300" : "text-rose-300")}>
        {formatUsd(row.price)}
      </span>
      <span className="relative text-right text-white/62">{formatCompact(row.amount)}</span>
      <span className="relative text-right text-white/42">{formatUsd(row.totalUsd)}</span>
    </div>
  );
}

function SignalBar({ label, value }: { label: string; value: number | null }) {
  const pct = typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : 0;
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-xs">
        <span className="text-white/46">{label}</span>
        <span className={scoreTone(value)}>{value === null ? "No signal" : value.toFixed(1)}</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-white/8">
        <div className="h-full rounded-full bg-[linear-gradient(90deg,#84cc16,#14f195)]" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export function ProTerminalSurface({ initialTokenAddress = null }: ProTerminalSurfaceProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const tokenAddress = (initialTokenAddress ?? searchParams.get("token") ?? "").trim();
  const [draftToken, setDraftToken] = useState(tokenAddress);
  const [timeframe, setTimeframe] = useState<TerminalTimeframe>("5m");

  const terminalQuery = useQuery<TerminalAggregateResponse>({
    queryKey: ["terminal-aggregate-v1", tokenAddress, timeframe],
    enabled: tokenAddress.length > 0,
    staleTime: 5_000,
    refetchInterval: tokenAddress ? 10_000 : false,
    refetchOnWindowFocus: false,
    queryFn: () => api.get<TerminalAggregateResponse>(`/api/tokens/${tokenAddress}/terminal?timeframe=${timeframe}`),
  });

  const terminal = terminalQuery.data ?? null;
  const liveFeed = useTradePanelLiveFeed({
    enabled: Boolean(terminal?.token.address),
    tokenAddress: terminal?.token.address ?? null,
    pairAddress: terminal?.token.pairAddress ?? null,
    chainType: terminal?.token.chainType === "solana" ? "solana" : "ethereum",
  });

  const followMutation = useMutation({
    mutationFn: async () => {
      if (!terminal) return null;
      if (terminal.token.isFollowing) {
        await api.delete(`/api/tokens/${terminal.token.address}/follow`);
        return false;
      }
      await api.post(`/api/tokens/${terminal.token.address}/follow`);
      return true;
    },
    onSuccess: (following) => {
      queryClient.invalidateQueries({ queryKey: ["terminal-aggregate-v1", tokenAddress] });
      toast.success(following ? "Added to watchlist" : "Removed from watchlist");
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Watchlist update failed");
    },
  });

  const maxDepthTotal = useMemo(() => {
    const totals = [...(terminal?.marketFlow.asks ?? []), ...(terminal?.marketFlow.bids ?? [])].map((row) => row.totalUsd);
    return Math.max(1, ...totals);
  }, [terminal?.marketFlow.asks, terminal?.marketFlow.bids]);

  const recentTrades = liveFeed.recentTrades.length > 0 ? liveFeed.recentTrades : terminal?.marketFlow.recentTrades ?? [];
  const topRaid = terminal?.activeRaids[0] ?? null;
  const symbol = terminal?.token.symbol ? `$${terminal.token.symbol}` : terminal?.token.name ?? "TOKEN";

  const loadToken = (value: string) => {
    const next = value.trim();
    if (!next) return;
    setSearchParams({ token: next });
    setDraftToken(next);
  };

  if (!tokenAddress) {
    return <EmptyTerminalState onLoad={loadToken} />;
  }

  if (terminalQuery.isLoading) {
    return (
      <div className="flex min-h-[520px] items-center justify-center rounded-[28px] border border-white/8 bg-black/30">
        <div className="flex items-center gap-3 text-sm text-white/58">
          <Loader2 className="h-5 w-5 animate-spin text-lime-300" />
          Loading aggregate terminal context...
        </div>
      </div>
    );
  }

  if (!terminal) {
    return (
      <div className="rounded-[28px] border border-dashed border-white/12 bg-black/20 px-6 py-14 text-center">
        <div className="text-lg font-semibold text-white">Terminal unavailable</div>
        <div className="mt-2 text-sm text-white/48">
          {terminalQuery.error instanceof Error ? terminalQuery.error.message : "The token terminal endpoint did not return usable data."}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <section className="rounded-[18px] border border-white/8 bg-[linear-gradient(90deg,rgba(5,10,13,0.98),rgba(4,8,12,0.98))] px-3 py-2">
        <div className="flex items-center gap-2 overflow-x-auto">
          {terminal.marketStrip.length > 0 ? (
            terminal.marketStrip.map((item) => (
              <Link
                key={item.address}
                to={`/terminal?token=${item.address}`}
                className="flex min-w-[178px] items-center gap-2 rounded-xl border border-white/7 bg-white/[0.035] px-3 py-2 transition hover:bg-white/[0.06]"
              >
                <Avatar className="h-6 w-6 border border-white/10">
                  <AvatarImage src={item.imageUrl ?? undefined} />
                  <AvatarFallback className="bg-lime-300/10 text-[10px] text-lime-200">
                    {(item.symbol ?? item.name ?? "?").slice(0, 2)}
                  </AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-xs font-semibold text-white">{item.symbol ? `$${item.symbol}` : item.name}</div>
                  <div className="text-[10px] text-white/38">{formatUsd(item.volume24h)} vol</div>
                </div>
                <div className={cn("text-xs font-semibold", scoreTone(item.score))}>
                  {item.score !== null ? item.score.toFixed(0) : "N/A"}
                </div>
              </Link>
            ))
          ) : (
            <div className="rounded-xl border border-white/8 px-3 py-2 text-xs text-white/46">
              Market strip unavailable: no indexed token telemetry yet.
            </div>
          )}
        </div>
      </section>

      <section className="rounded-[24px] border border-white/8 bg-[linear-gradient(180deg,rgba(7,13,17,0.98),rgba(3,7,10,0.99))] px-4 py-4">
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_420px]">
          <div className="flex min-w-0 items-center gap-4">
            <Avatar className="h-20 w-20 rounded-[22px] border border-lime-300/20 bg-lime-300/10">
              <AvatarImage src={terminal.token.imageUrl ?? terminal.token.fallbackImageUrl} />
              <AvatarFallback className="rounded-[22px] bg-lime-300/10 text-xl font-semibold text-lime-200">
                {(terminal.token.symbol ?? terminal.token.name ?? "?").slice(0, 2)}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-3xl font-semibold tracking-[-0.05em] text-white">{symbol}</h1>
                <span className="text-lg font-medium text-white/42">{terminal.token.name}</span>
                <button
                  type="button"
                  onClick={() => followMutation.mutate()}
                  disabled={followMutation.isPending}
                  className={cn(
                    "inline-flex h-8 items-center gap-1 rounded-xl border px-3 text-xs font-semibold transition",
                    terminal.token.isFollowing
                      ? "border-lime-300/20 bg-lime-300/10 text-lime-200"
                      : "border-white/10 bg-white/[0.03] text-white/58 hover:text-white"
                  )}
                >
                  <Star className="h-3.5 w-3.5" />
                  {terminal.token.isFollowing ? "Watching" : "Watch"}
                </button>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-white/44">
                <span className="rounded-full border border-white/8 bg-white/[0.03] px-2.5 py-1">
                  {terminal.token.chainType}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard.writeText(terminal.token.address).then(
                      () => toast.success("Contract copied"),
                      () => toast.error("Copy failed")
                    );
                  }}
                  className="inline-flex items-center gap-1 rounded-full border border-white/8 bg-white/[0.03] px-2.5 py-1 transition hover:text-white"
                >
                  {shortAddress(terminal.token.address)}
                  <Copy className="h-3 w-3" />
                </button>
                {terminal.token.dexscreenerUrl ? (
                  <a
                    href={terminal.token.dexscreenerUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 rounded-full border border-white/8 bg-white/[0.03] px-2.5 py-1 transition hover:text-white"
                  >
                    DexScreener
                    <ExternalLink className="h-3 w-3" />
                  </a>
                ) : null}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-2 2xl:grid-cols-4">
            <MetricTile label="Price" value={formatUsd(terminal.token.priceUsd)} detail={formatPct(terminal.token.priceChange24hPct)} tone={(terminal.token.priceChange24hPct ?? 0) >= 0 ? "gain" : "loss"} />
            <MetricTile label="Liquidity" value={formatUsd(terminal.token.liquidity)} detail={terminal.coverage.market.source} />
            <MetricTile label="Market Cap" value={formatUsd(terminal.token.marketCap)} detail="Dex/token cache" />
            <MetricTile label="24H Volume" value={formatUsd(terminal.token.volume24h)} detail={`${formatCompact(terminal.token.holderCount)} holders`} />
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-[300px] items-center gap-2 rounded-[16px] border border-white/10 bg-black/30 p-2">
            <Search className="ml-2 h-4 w-4 text-white/34" />
            <Input
              value={draftToken}
              onChange={(event) => setDraftToken(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") loadToken(draftToken);
              }}
              placeholder="Search token address..."
              className="h-9 border-0 bg-transparent text-sm text-white placeholder:text-white/28 focus-visible:ring-0"
            />
            <Button onClick={() => loadToken(draftToken)} size="sm" className="h-9 rounded-xl">
              Load
            </Button>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              onClick={() => {
                const url = window.location.href;
                if (navigator.share) {
                  navigator.share({ title: `${symbol} terminal`, url }).catch(() => undefined);
                } else {
                  navigator.clipboard.writeText(url).then(() => toast.success("Terminal link copied"));
                }
              }}
              variant="outline"
              className="h-10 rounded-xl border-white/10 bg-white/[0.03]"
            >
              <Share2 className="mr-2 h-4 w-4" />
              Share
            </Button>
            <Button
              type="button"
              onClick={() => terminal.community.exists ? navigate(`/communities/${terminal.token.address}`) : toast.info("Community is not open for this token yet.")}
              variant="outline"
              className="h-10 rounded-xl border-white/10 bg-white/[0.03]"
            >
              <Users className="mr-2 h-4 w-4" />
              Open Community
            </Button>
            <Button
              type="button"
              onClick={() => document.getElementById("terminal-execution-panel")?.scrollIntoView({ behavior: "smooth", block: "center" })}
              className="h-10 rounded-xl bg-[linear-gradient(90deg,#a3e635,#14f195)] text-slate-950"
            >
              <Zap className="mr-2 h-4 w-4" />
              Trade
            </Button>
          </div>
        </div>
      </section>

      <section className="grid gap-3 2xl:grid-cols-[300px_minmax(760px,1fr)_360px]">
        <div className="space-y-3">
          <div className="rounded-[22px] border border-white/8 bg-[linear-gradient(180deg,rgba(7,13,17,0.98),rgba(3,7,10,0.99))] p-3">
            <div className="mb-3 flex items-center justify-between">
              <div>
                <div className="text-sm font-semibold text-white">Market Depth</div>
                <div className="mt-1 text-[11px] text-white/40">
                  {terminal.marketFlow.mode === "liquidity_depth_approximation" ? "Jupiter route depth approximation" : terminal.marketFlow.mode}
                </div>
              </div>
              <ShieldAlert className="h-4 w-4 text-white/34" />
            </div>
            {terminal.marketFlow.mode === "unavailable" ? (
              <div className="rounded-[16px] border border-dashed border-white/12 px-3 py-5 text-xs leading-5 text-white/46">
                {terminal.marketFlow.coverage.depth.unavailableReason}
              </div>
            ) : (
              <>
                <div className="grid grid-cols-3 px-2 text-[10px] uppercase tracking-[0.14em] text-white/32">
                  <span>Price</span>
                  <span className="text-right">Size</span>
                  <span className="text-right">Total</span>
                </div>
                <div className="mt-2 space-y-1">
                  {terminal.marketFlow.asks.slice(0, 7).reverse().map((row, index) => (
                    <OrderBookRow key={`ask-${index}-${row.price}`} row={row} maxTotal={maxDepthTotal} />
                  ))}
                  <div className="rounded-xl border border-lime-300/15 bg-lime-300/8 px-3 py-2 text-center text-sm font-semibold text-lime-200">
                    {formatUsd(terminal.token.priceUsd)}
                    <span className="ml-2 text-[11px] text-white/36">
                      spread {terminal.marketFlow.spread !== null ? formatUsd(terminal.marketFlow.spread) : "--"}
                    </span>
                  </div>
                  {terminal.marketFlow.bids.slice(0, 7).map((row, index) => (
                    <OrderBookRow key={`bid-${index}-${row.price}`} row={row} maxTotal={maxDepthTotal} />
                  ))}
                </div>
              </>
            )}
          </div>

          <TradeTransactionsFeed
            trades={recentTrades}
            liveMode={liveFeed.liveStatus.mode}
            usingFallbackPolling={liveFeed.usingFallbackPolling}
            lastTradeEventAtMs={liveFeed.lastTradeEventAtMs}
            chainType={terminal.token.chainType === "solana" ? "solana" : "ethereum"}
          />
        </div>

        <div className="space-y-3">
          <div className="rounded-[22px] border border-white/8 bg-[linear-gradient(180deg,rgba(7,13,17,0.98),rgba(3,7,10,0.99))] p-3">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-white">Professional Chart</div>
                <div className="mt-1 text-[11px] text-white/40">
                  {terminal.chart.coverage.state === "live" ? `${terminal.chart.source} candles` : terminal.chart.coverage.unavailableReason}
                </div>
              </div>
              <div className="flex items-center gap-1">
                {TERMINAL_TIMEFRAMES.map((option) => (
                  <button
                    key={option}
                    type="button"
                    onClick={() => setTimeframe(option)}
                    className={cn(
                      "h-8 rounded-lg border px-2.5 text-xs font-semibold transition",
                      timeframe === option
                        ? "border-lime-300/30 bg-lime-300/12 text-lime-200"
                        : "border-white/8 bg-white/[0.03] text-white/46 hover:text-white"
                    )}
                  >
                    {option}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => toast.info("Chart settings are handled by the active market data route.")}
                  className="ml-1 flex h-8 w-8 items-center justify-center rounded-lg border border-white/8 bg-white/[0.03] text-white/44 hover:text-white"
                >
                  <Maximize2 className="h-4 w-4" />
                </button>
              </div>
            </div>
            <div className="h-[520px]">
              <ProCandlestickChart
                candles={terminal.chart.candles}
                timeframe={timeframe}
                symbol={symbol}
                priceFormatter={formatUsd}
                unavailableReason={terminal.chart.coverage.unavailableReason}
              />
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-4">
            <MetricTile label="24H Change" value={formatPct(terminal.token.priceChange24hPct)} tone={(terminal.token.priceChange24hPct ?? 0) >= 0 ? "gain" : "loss"} />
            <MetricTile label="Trades" value={formatCompact(recentTrades.length)} detail={terminal.marketFlow.coverage.trades.source} />
            <MetricTile label="Buy Pressure" value={`${terminal.intelligence.sentiment.bullishPct.toFixed(0)}%`} detail={`${terminal.intelligence.sentiment.sourceCount} reactions`} tone="gain" />
            <MetricTile label="Risk" value={terminal.intelligence.riskScore === null ? "No signal" : `${terminal.intelligence.riskScore.toFixed(0)}/100`} detail="holder/scan derived" />
          </div>
        </div>

        <div className="space-y-3">
          <div id="terminal-execution-panel" className="rounded-[22px] border border-white/8 bg-[linear-gradient(180deg,rgba(7,13,17,0.98),rgba(3,7,10,0.99))] p-3">
            <div className="mb-3 flex items-center justify-between">
              <div>
                <div className="text-sm font-semibold text-white">Execution</div>
                <div className="mt-1 text-[11px] text-white/40">
                  {terminal.execution.supported ? `${terminal.execution.provider} route live` : terminal.execution.unavailableReason}
                </div>
              </div>
              <CheckCircle2 className={cn("h-4 w-4", terminal.execution.supported ? "text-lime-300" : "text-white/28")} />
            </div>
            {terminal.execution.supported ? (
              <DirectTokenTradePanel
                tokenAddress={terminal.token.address}
                chainType={terminal.token.chainType === "solana" ? "solana" : "ethereum"}
                tokenSymbol={terminal.token.symbol || "TOKEN"}
                tokenName={terminal.token.name || terminal.token.symbol || "Token"}
                tokenImage={terminal.token.imageUrl}
                tokenPriceUsd={terminal.token.priceUsd}
                liveStateLabel={liveFeed.liveStatus.connected ? "Live route" : "Polling route"}
              />
            ) : (
              <div className="rounded-[16px] border border-dashed border-white/12 bg-black/20 px-3 py-5 text-xs leading-5 text-white/48">
                Execution unavailable: {terminal.execution.unavailableReason}
              </div>
            )}
          </div>

          <div className="rounded-[22px] border border-lime-300/15 bg-[radial-gradient(circle_at_top,rgba(163,230,53,0.16),rgba(5,12,15,0.96)_42%,rgba(2,6,9,0.99))] p-4">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-lime-200/70">AI High Conviction</div>
                <div className="mt-2 text-xl font-semibold text-white">{symbol}</div>
              </div>
              <Sparkles className="h-7 w-7 text-lime-300" />
            </div>
            <div className="mt-4 space-y-3">
              <SignalBar label="Conviction" value={terminal.intelligence.conviction} />
              <SignalBar label="Momentum" value={terminal.intelligence.momentum} />
              <SignalBar label="Smart money" value={terminal.intelligence.smartMoney} />
              <SignalBar label="Risk" value={terminal.intelligence.riskScore} />
            </div>
            <p className="mt-4 text-xs leading-5 text-white/54">{terminal.intelligence.explanation}</p>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {terminal.intelligence.labels.length ? (
                terminal.intelligence.labels.map((label) => (
                  <span key={label} className="rounded-full border border-lime-300/15 bg-lime-300/10 px-2 py-1 text-[10px] font-semibold text-lime-200">
                    {label}
                  </span>
                ))
              ) : (
                <span className="rounded-full border border-white/8 bg-white/[0.03] px-2 py-1 text-[10px] text-white/42">
                  Not enough signal
                </span>
              )}
            </div>
          </div>

          <RailPanel title="Smart Money Flow" actionLabel="View holders">
            {terminal.smartMoney.rows.length ? (
              terminal.smartMoney.rows.map((row, index) => (
                <div key={row.id} className="flex items-center justify-between gap-3 rounded-xl border border-white/8 bg-white/[0.03] px-3 py-2">
                  <div className="min-w-0">
                    <div className="truncate text-xs font-semibold text-white">{index + 1}. {shortAddress(row.wallet)}</div>
                    <div className="text-[11px] text-white/40">{row.label}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-xs font-semibold text-lime-300">{row.supplyPct !== null ? `${row.supplyPct.toFixed(2)}%` : "--"}</div>
                    <div className="text-[11px] text-white/38">{formatUsd(row.valueUsd)}</div>
                  </div>
                </div>
              ))
            ) : (
              <InlineUnavailable reason={terminal.smartMoney.coverage.unavailableReason ?? "Holder intelligence has not resolved for this token."} />
            )}
          </RailPanel>

          <RailPanel title="Market Sentiment" actionLabel={`${terminal.intelligence.sentiment.sourceCount} sources`}>
            <div className="flex items-center justify-between text-sm">
              <span className="font-semibold text-lime-300">Bullish {terminal.intelligence.sentiment.bullishPct.toFixed(0)}%</span>
              <span className="font-semibold text-rose-300">Bearish {terminal.intelligence.sentiment.bearishPct.toFixed(0)}%</span>
            </div>
            <div className="mt-3 h-3 overflow-hidden rounded-full bg-rose-500/25">
              <div className="h-full rounded-full bg-[linear-gradient(90deg,#84cc16,#a3e635)]" style={{ width: `${terminal.intelligence.sentiment.bullishPct}%` }} />
            </div>
          </RailPanel>
        </div>
      </section>

      <section className="grid gap-3 xl:grid-cols-4">
        <RailPanel title="Recent Calls" actionLabel="View calls">
          {terminal.recentCalls.length ? (
            terminal.recentCalls.slice(0, 4).map((post) => (
              <Link key={post.id} to={`/post/${post.id}`} className="block rounded-xl border border-white/8 bg-white/[0.03] px-3 py-2 hover:bg-white/[0.06]">
                <div className="flex items-center justify-between gap-2">
                  <div className="truncate text-sm font-semibold text-white">{post.content.slice(0, 46)}</div>
                  <div className="text-xs font-semibold text-lime-300">{formatPct(post.roiCurrentPct)}</div>
                </div>
                <div className="mt-1 text-[11px] text-white/40">{post.tokenSymbol ? `$${post.tokenSymbol}` : "Token call"} | {post.postType}</div>
              </Link>
            ))
          ) : (
            <InlineUnavailable reason="No token-specific calls are indexed yet." />
          )}
        </RailPanel>

        <RailPanel title="Active Raids" actionLabel={topRaid ? "Join room" : "No raid"}>
          {terminal.activeRaids.length ? (
            terminal.activeRaids.map((raid) => (
              <Link key={raid.id} to={`/raids/${terminal.token.address}/${raid.id}`} className="block rounded-xl border border-white/8 bg-white/[0.03] px-3 py-3 hover:bg-white/[0.06]">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold text-white">{raid.objective}</span>
                  <span className="rounded-full bg-lime-300/10 px-2 py-1 text-[10px] font-semibold text-lime-200">{raid.status}</span>
                </div>
                <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/8">
                  <div className="h-full rounded-full bg-lime-300" style={{ width: `${raid.progressPct}%` }} />
                </div>
                <div className="mt-2 flex justify-between text-[11px] text-white/42">
                  <span>{formatCompact(raid.participantCount)} joined</span>
                  <span>{raid.progressPct}% posted</span>
                </div>
              </Link>
            ))
          ) : (
            <InlineUnavailable reason="No active raid is linked to this token." />
          )}
        </RailPanel>

        <RailPanel title="Top Callers" actionLabel="Reputation">
          {terminal.topCallers.length ? (
            terminal.topCallers.map((caller) => (
              <Link key={caller.id} to={caller.username ? `/${caller.username}` : `/profile/${caller.id}`} className="flex items-center gap-3 rounded-xl border border-white/8 bg-white/[0.03] px-3 py-2 hover:bg-white/[0.06]">
                <Avatar className="h-8 w-8 border border-white/10">
                  <AvatarImage src={caller.image ?? undefined} />
                  <AvatarFallback className="bg-white/8 text-xs">{caller.name.slice(0, 2)}</AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-xs font-semibold text-white">{caller.name}</div>
                  <div className="text-[11px] text-white/40">{caller.callsCount} calls</div>
                </div>
                <div className={cn("text-xs font-semibold", caller.bestRoiPct >= 0 ? "text-lime-300" : "text-rose-300")}>
                  {formatPct(caller.bestRoiPct)}
                </div>
              </Link>
            ))
          ) : (
            <InlineUnavailable reason="No ranked callers yet for this token." />
          )}
        </RailPanel>

        <RailPanel title="News & Updates" actionLabel="Token events">
          {terminal.news.length ? (
            terminal.news.map((item) => (
              <div key={item.id} className="rounded-xl border border-white/8 bg-white/[0.03] px-3 py-2">
                <div className="text-xs font-semibold capitalize text-white">{item.headline}</div>
                <div className="mt-1 text-[11px] text-white/40">
                  {new Date(item.timestamp).toLocaleString()} | {formatUsd(item.marketCap)}
                </div>
              </div>
            ))
          ) : (
            <InlineUnavailable reason="No token timeline events are indexed yet." />
          )}
        </RailPanel>
      </section>
    </div>
  );
}

function RailPanel({
  title,
  actionLabel,
  children,
}: {
  title: string;
  actionLabel: string;
  children: ReactNode;
}) {
  return (
    <div className="rounded-[22px] border border-white/8 bg-[linear-gradient(180deg,rgba(7,13,17,0.98),rgba(3,7,10,0.99))] p-3">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="text-sm font-semibold text-white">{title}</div>
        <div className="text-[11px] text-white/36">{actionLabel}</div>
      </div>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

function InlineUnavailable({ reason }: { reason: string }) {
  return (
    <div className="rounded-xl border border-dashed border-white/12 bg-black/20 px-3 py-4 text-xs leading-5 text-white/46">
      {reason}
    </div>
  );
}
