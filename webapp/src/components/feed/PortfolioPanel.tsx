import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { TrendingUp, TrendingDown, Wallet, X, ChevronDown, ChevronUp } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { useState } from "react";

export interface PortfolioPosition {
  mint: string;
  symbol: string;
  name: string;
  image: string | null;
  balance: number;
  avgEntryPrice: number | null;
  currentPrice: number | null;
  costBasis: number | null;
  unrealizedPnl: number | null;
  unrealizedPnlPercent: number | null;
}

interface PortfolioPanelProps {
  positions: PortfolioPosition[];
  isLoading: boolean;
  totalUnrealizedPnl: number | null;
  onQuickSell: (mint: string, amount: number) => void;
  walletConnected: boolean;
  activeMint?: string | null;
}

function formatUsd(value: number | null): string {
  if (value === null || value === undefined) return "--";
  return `$${Math.abs(value) < 0.01 ? value.toExponential(2) : value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 6 })}`;
}

function formatPrice(value: number | null): string {
  if (value === null || value === undefined) return "--";
  if (value === 0) return "$0.00";
  if (value < 0.000001) return `$${value.toExponential(2)}`;
  if (value < 0.01) return `$${value.toFixed(6)}`;
  if (value < 1) return `$${value.toFixed(4)}`;
  return `$${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatBalance(value: number): string {
  if (value === 0) return "0";
  if (value < 0.001) return value.toExponential(2);
  if (value < 1) return value.toFixed(4);
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(2)}K`;
  return value.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

function formatPercent(value: number | null): string {
  if (value === null || value === undefined) return "";
  const sign = value >= 0 ? "+" : "";
  return `${sign}${value.toFixed(2)}%`;
}

export default function PortfolioPanel({
  positions,
  isLoading,
  totalUnrealizedPnl,
  onQuickSell,
  walletConnected,
  activeMint = null,
}: PortfolioPanelProps) {
  const [isExpanded, setIsExpanded] = useState(true);
  const totalIsProfit = totalUnrealizedPnl !== null && totalUnrealizedPnl >= 0;
  const positionCount = positions.length;

  if (!walletConnected) {
    return (
      <div className="rounded-2xl bg-[#0a0c12] border border-white/[0.07] overflow-hidden">
        <div className="flex flex-col items-center justify-center gap-2.5 py-8 text-white/30">
          <div className="w-10 h-10 rounded-full bg-white/[0.04] flex items-center justify-center">
            <Wallet className="h-4.5 w-4.5" />
          </div>
          <p className="text-[11px] tracking-wide">Connect wallet to view positions</p>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-2xl bg-[#0a0c12] border border-white/[0.07] overflow-hidden">
      {/* Header */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex w-full items-center justify-between px-4 py-3 transition-colors hover:bg-white/[0.02]"
      >
        <div className="flex items-center gap-2.5">
          <span className="text-[11px] font-semibold uppercase tracking-widest text-white/50">
            Portfolio
          </span>
          {positionCount > 0 && (
            <span className="rounded-full bg-white/[0.06] px-1.5 py-0.5 text-[10px] font-medium text-white/40">
              {positionCount}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {totalUnrealizedPnl !== null && (
            <div
              className={cn(
                "flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-semibold",
                totalIsProfit
                  ? "text-emerald-400"
                  : "text-rose-400"
              )}
            >
              {totalIsProfit ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
              {formatUsd(totalUnrealizedPnl)}
            </div>
          )}
          {isExpanded ? (
            <ChevronUp className="w-3.5 h-3.5 text-white/25" />
          ) : (
            <ChevronDown className="w-3.5 h-3.5 text-white/25" />
          )}
        </div>
      </button>

      {isExpanded && (
        <div className="border-t border-white/[0.05]">
          {isLoading ? (
            <div className="flex flex-col gap-2 p-4">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="flex items-center gap-3">
                  <Skeleton className="h-8 w-8 rounded-full bg-white/[0.04]" />
                  <div className="flex-1 space-y-1">
                    <Skeleton className="h-3 w-16 bg-white/[0.04]" />
                    <Skeleton className="h-2.5 w-12 bg-white/[0.04]" />
                  </div>
                  <Skeleton className="h-3 w-14 bg-white/[0.04]" />
                </div>
              ))}
            </div>
          ) : positions.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 py-8 text-white/25">
              <Wallet className="h-5 w-5" />
              <p className="text-[11px]">No open positions</p>
            </div>
          ) : (
            <div className="max-h-[280px] overflow-y-auto">
              {positions.map((pos) => {
                const isProfit = pos.unrealizedPnl !== null && pos.unrealizedPnl >= 0;
                const canCloseFromHere =
                  !!activeMint && pos.mint.toLowerCase() === activeMint.toLowerCase();
                const displaySymbol =
                  typeof pos.symbol === "string" && pos.symbol.trim().length > 0
                    ? pos.symbol.trim().toUpperCase()
                    : `${pos.mint.slice(0, 4)}...`;
                return (
                  <div
                    key={pos.mint}
                    className="group flex items-center gap-3 px-4 py-2.5 border-b border-white/[0.04] last:border-0 transition-colors hover:bg-white/[0.02]"
                  >
                    {/* Token icon */}
                    {pos.image ? (
                      <img
                        src={pos.image}
                        alt={displaySymbol}
                        className="h-8 w-8 flex-shrink-0 rounded-full object-cover ring-1 ring-white/[0.08]"
                      />
                    ) : (
                      <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-white/[0.06] text-[10px] font-bold text-white/40 ring-1 ring-white/[0.08]">
                        {displaySymbol.charAt(0)}
                      </div>
                    )}

                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs font-semibold text-white truncate">{displaySymbol}</span>
                        <span className="text-[10px] text-white/25">{formatBalance(pos.balance)}</span>
                      </div>
                      <div className="flex items-center gap-2 text-[10px] text-white/30">
                        <span>Entry {formatPrice(pos.avgEntryPrice)}</span>
                        <span className="text-white/15">|</span>
                        <span>Now {formatPrice(pos.currentPrice)}</span>
                      </div>
                    </div>

                    {/* PnL */}
                    <div className="flex items-center gap-2">
                      {pos.unrealizedPnl !== null && (
                        <div className={cn("text-right", isProfit ? "text-emerald-400" : "text-rose-400")}>
                          <div className="text-[11px] font-semibold">{formatUsd(pos.unrealizedPnl)}</div>
                          {pos.unrealizedPnlPercent !== null && (
                            <div className="text-[9px] opacity-70">{formatPercent(pos.unrealizedPnlPercent)}</div>
                          )}
                        </div>
                      )}

                      {/* Quick Sell */}
                      <Button
                        variant="ghost"
                        size="sm"
                        className={cn(
                          "h-6 rounded-md px-2 text-[10px] font-semibold opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity",
                          canCloseFromHere
                            ? "bg-rose-500/[0.08] text-rose-400/80 hover:bg-rose-500/20 hover:text-rose-400"
                            : "bg-white/[0.06] text-white/50 hover:bg-white/[0.1] hover:text-white/75"
                        )}
                        onClick={() => onQuickSell(pos.mint, pos.balance)}
                      >
                        {canCloseFromHere ? (
                          <>
                            <X className="mr-0.5 h-2.5 w-2.5" />
                            Close
                          </>
                        ) : (
                          "Open"
                        )}
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
