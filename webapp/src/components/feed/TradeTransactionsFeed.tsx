import { memo, useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronUp, Dot, Flame, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { TradePanelRecentTrade } from "@/lib/trade-panel-live";
import { TradePanelLiveBadge } from "./TradePanelLiveBadge";

type TradeTransactionsFeedProps = {
  trades: Array<TradePanelRecentTrade & { walletShort: string | null }>;
  liveMode: "stream" | "fallback" | "unavailable";
  usingFallbackPolling: boolean;
  lastTradeEventAtMs: number;
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

  return (
    <div
      className={cn(
        "overflow-hidden rounded-2xl border border-slate-900/[0.08] bg-[linear-gradient(180deg,rgba(255,255,255,0.82),rgba(247,241,230,0.94))] shadow-[0_18px_52px_-42px_rgba(148,163,184,0.56)] ring-1 ring-white/65 dark:border-white/[0.08] dark:bg-[linear-gradient(180deg,rgba(8,11,18,0.99),rgba(3,6,11,0.99))] dark:ring-white/6",
        className
      )}
    >
      <button
        type="button"
        onClick={() => setCollapsed((current) => !current)}
        className="flex w-full items-center justify-between gap-3 border-b border-slate-900/[0.06] px-3 py-2.5 text-left dark:border-white/[0.06]"
      >
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-semibold uppercase tracking-[0.22em] text-slate-500 dark:text-white/42">
              Recent Trades
            </span>
            <TradePanelLiveBadge
              lastEventAtMs={lastTradeEventAtMs}
              usingFallbackPolling={usingFallbackPolling}
              mode={liveMode}
            />
          </div>
          <div className="mt-0.5 text-[10px] text-slate-400 dark:text-white/28">{freshnessLabel}</div>
        </div>
        {collapsed ? (
          <ChevronDown className="h-4 w-4 shrink-0 text-slate-400 dark:text-white/32" />
        ) : (
          <ChevronUp className="h-4 w-4 shrink-0 text-slate-400 dark:text-white/32" />
        )}
      </button>

      {!collapsed ? (
        trades.length > 0 ? (
          <div className="max-h-[14rem] overflow-y-auto">
            <div className="grid grid-cols-[auto_auto_minmax(0,1fr)_auto_auto] gap-x-3 gap-y-0 px-3 py-1.5 text-[9px] uppercase tracking-[0.18em] text-slate-400 dark:text-white/28">
              <span>Time</span>
              <span>Side</span>
              <span>Wallet</span>
              <span>Size</span>
              <span>Price</span>
            </div>
            <div className="divide-y divide-slate-900/[0.05] dark:divide-white/[0.05]">
              {trades.slice(0, 32).map((trade) => (
                <div
                  key={trade.id}
                  className="grid grid-cols-[auto_auto_minmax(0,1fr)_auto_auto] items-center gap-x-3 px-3 py-2 text-[11px]"
                >
                  <span className="font-mono text-slate-500 dark:text-white/52">
                    {formatTradeTimestamp(trade.timestampMs)}
                  </span>
                  <span
                    className={cn(
                      "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                      trade.side === "buy"
                        ? "bg-emerald-500/12 text-emerald-600 dark:text-emerald-300"
                        : trade.side === "sell"
                          ? "bg-rose-500/12 text-rose-600 dark:text-rose-300"
                          : "bg-slate-900/[0.05] text-slate-500 dark:bg-white/[0.06] dark:text-white/45"
                    )}
                  >
                    {trade.side}
                  </span>
                  <div className="min-w-0">
                    <div className="truncate font-medium text-slate-700 dark:text-white/76">
                      {trade.walletShort ?? "Unknown wallet"}
                    </div>
                    <div className="truncate text-[11px] text-slate-400 dark:text-white/28">
                      {trade.platform ?? trade.source ?? trade.fromSymbol ?? "Swap"}
                    </div>
                  </div>
                  <div className="justify-self-end text-right">
                    <div className="font-semibold text-slate-800 dark:text-white/78">
                      {formatTradeValue(trade.volumeUsd)}
                    </div>
                    <div className="text-[11px] text-slate-400 dark:text-white/28">
                      {trade.fromAmount !== null && trade.fromSymbol
                        ? `${trade.fromAmount.toLocaleString(undefined, {
                            maximumFractionDigits: trade.fromAmount >= 1 ? 2 : 6,
                          })} ${trade.fromSymbol}`
                        : "--"}
                    </div>
                  </div>
                  <div className="justify-self-end text-right">
                    <div className="font-medium text-slate-700 dark:text-white/70">
                      {formatTradeValue(trade.priceUsd)}
                    </div>
                    <div className="flex items-center justify-end gap-1 text-[11px] text-slate-400 dark:text-white/28">
                      {trade.isLarge ? (
                        <>
                          <Flame className="h-3 w-3 text-amber-500" />
                          <span>Large</span>
                        </>
                      ) : (
                        <>
                          <Dot className="h-3 w-3" />
                          <span>Print</span>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="flex min-h-[6rem] flex-col items-center justify-center gap-2 px-4 py-5 text-center">
            <Loader2 className="h-4 w-4 animate-spin text-slate-400 dark:text-white/28" />
            <div className="text-[12px] font-medium text-slate-600 dark:text-white/58">
              Connecting trade feed
            </div>
            <div className="text-[11px] text-slate-400 dark:text-white/30">
              Recent swaps will appear here as soon as the route sends its first print.
            </div>
          </div>
        )
      ) : null}
    </div>
  );
});
