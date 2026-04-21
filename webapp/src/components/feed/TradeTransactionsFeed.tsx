import { memo, useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronUp, ExternalLink, Flame, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { TradePanelRecentTrade } from "@/lib/trade-panel-live";
import { TradePanelLiveBadge } from "./TradePanelLiveBadge";

type TradeTransactionsFeedProps = {
  trades: Array<TradePanelRecentTrade & { walletShort: string | null }>;
  liveMode: "stream" | "fallback" | "unavailable";
  usingFallbackPolling: boolean;
  lastTradeEventAtMs: number;
  chainType?: "solana" | "ethereum";
  className?: string;
};

function formatTradeTimestamp(timestampMs: number): string {
  const date = new Date(timestampMs);
  return date.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function formatTradeValue(value: number | null, prefix = "$"): string {
  if (value === null || !Number.isFinite(value)) return "--";
  if (Math.abs(value) >= 1000) {
    return `${prefix}${value.toLocaleString(undefined, {
      notation: "compact",
      maximumFractionDigits: 1,
    })}`;
  }
  return `${prefix}${value.toLocaleString(undefined, {
    maximumFractionDigits: value >= 1 ? 2 : 6,
  })}`;
}

export const TradeTransactionsFeed = memo(function TradeTransactionsFeed({
  trades,
  liveMode,
  usingFallbackPolling,
  lastTradeEventAtMs,
  chainType = "solana",
  className,
}: TradeTransactionsFeedProps) {
  const [collapsed, setCollapsed] = useState(() => typeof window !== "undefined" && window.innerWidth < 640);
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    const interval = window.setInterval(() => {
      setNowMs(Date.now());
    }, 1_000);
    return () => window.clearInterval(interval);
  }, []);

  const freshnessLabel = useMemo(() => {
    if (!lastTradeEventAtMs) {
      return usingFallbackPolling ? "Syncing fallback trades" : "Connecting live feed";
    }
    const ageSeconds = Math.max(0, Math.round((nowMs - lastTradeEventAtMs) / 1000));
    if (ageSeconds <= 1) {
      return "Updated just now";
    }
    if (ageSeconds >= 15) {
      return `Delayed ${ageSeconds}s`;
    }
    return `${ageSeconds}s ago`;
  }, [lastTradeEventAtMs, nowMs, usingFallbackPolling]);

  const explorerBaseUrl = chainType === "ethereum" ? "https://etherscan.io" : "https://solscan.io";

  return (
    <div
      className={cn(
        "terminal-soft-card overflow-hidden",
        className
      )}
    >
      <button
        type="button"
        onClick={() => setCollapsed((current) => !current)}
        className="flex w-full items-center justify-between gap-3 border-b border-white/6 px-3 py-3 text-left"
      >
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-semibold uppercase tracking-[0.22em] text-white/42">
              Recent Trades
            </span>
            <TradePanelLiveBadge
              lastEventAtMs={lastTradeEventAtMs}
              usingFallbackPolling={usingFallbackPolling}
              mode={liveMode}
            />
          </div>
          <div className="mt-0.5 text-[10px] text-white/28">{freshnessLabel}</div>
        </div>
        {collapsed ? (
          <ChevronDown className="h-4 w-4 shrink-0 text-white/32" />
        ) : (
          <ChevronUp className="h-4 w-4 shrink-0 text-white/32" />
        )}
      </button>

      {!collapsed ? (
        trades.length > 0 ? (
          <div className="max-h-[18rem] overflow-y-auto px-2 py-2">
            <div className="space-y-2">
              {trades.slice(0, 32).map((trade) => (
                <div
                  key={trade.id}
                  className="terminal-list-row flex items-center justify-between gap-4 rounded-[22px] px-3 py-3"
                >
                  <div className="flex min-w-0 flex-1 items-center gap-3">
                    <div
                      className={cn(
                        "flex h-11 w-11 shrink-0 items-center justify-center rounded-full border text-xs font-semibold uppercase",
                        trade.side === "buy"
                          ? "border-emerald-400/25 bg-emerald-500/10 text-emerald-300"
                          : trade.side === "sell"
                            ? "border-rose-400/25 bg-rose-500/10 text-rose-300"
                            : "border-white/8 bg-white/4 text-white/62"
                      )}
                    >
                      {(trade.walletShort ?? trade.walletAddress ?? "?").slice(0, 2)}
                    </div>
                    <div className="min-w-0">
                      <div className="truncate text-[0.98rem] font-semibold text-white">
                        {trade.walletShort ?? "Unknown wallet"}
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-white/38">
                        <span
                          className={cn(
                            "rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em]",
                            trade.side === "buy"
                              ? "bg-emerald-500/12 text-emerald-300"
                              : trade.side === "sell"
                                ? "bg-rose-500/12 text-rose-300"
                                : "bg-white/6 text-white/45"
                          )}
                        >
                          {trade.side}
                        </span>
                        <span>{formatTradeTimestamp(trade.timestampMs)}</span>
                        <span>{trade.platform ?? trade.source ?? trade.fromSymbol ?? "Swap"}</span>
                      </div>
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="text-[1rem] font-semibold text-white">
                      {formatTradeValue(trade.volumeUsd)}
                    </div>
                    <div className="mt-1 text-[11px] text-white/32">
                      {trade.fromAmount !== null && trade.fromSymbol
                        ? `${trade.fromAmount.toLocaleString(undefined, {
                            maximumFractionDigits: trade.fromAmount >= 1 ? 2 : 6,
                          })} ${trade.fromSymbol}`
                        : "--"}
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="text-[0.98rem] font-medium text-white/74">
                      {formatTradeValue(trade.priceUsd)}
                    </div>
                    <div className="mt-1 flex items-center justify-end gap-2 text-[11px] text-white/30">
                      {trade.isLarge ? <Flame className="h-3 w-3 text-amber-400" /> : null}
                      <span>{trade.isLarge ? "Large print" : "Market print"}</span>
                      {trade.txHash ? (
                        <a
                          href={`${explorerBaseUrl}/tx/${trade.txHash}`}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 text-white/42 transition-colors hover:text-white/72"
                          aria-label="Open transaction in explorer"
                        >
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      ) : null}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="flex min-h-[6rem] flex-col items-center justify-center gap-2 px-4 py-5 text-center">
            <Loader2 className="h-4 w-4 animate-spin text-white/28" />
            <div className="text-[12px] font-medium text-white/58">
              Connecting trade feed
            </div>
            <div className="text-[11px] text-white/30">
              Recent swaps will appear here as soon as the route sends its first print.
            </div>
          </div>
        )
      ) : null}
    </div>
  );
});
