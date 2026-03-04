import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Loader2, TrendingUp, TrendingDown, Wallet, X } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

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
}

function formatUsd(value: number | null): string {
  if (value === null || value === undefined) return "—";
  return `$${Math.abs(value) < 0.01 ? value.toExponential(2) : value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 6 })}`;
}

function formatPrice(value: number | null): string {
  if (value === null || value === undefined) return "—";
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

function PnlDisplay({ pnl, pnlPercent }: { pnl: number | null; pnlPercent: number | null }) {
  if (pnl === null) return <span className="text-white/40">—</span>;

  const isProfit = pnl >= 0;

  return (
    <div className={cn("flex flex-col items-end", isProfit ? "text-[#74f37a]" : "text-[#ff6b6b]")}>
      <span className="flex items-center gap-1 text-xs font-medium">
        {isProfit ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
        {formatUsd(pnl)}
      </span>
      {pnlPercent !== null && (
        <span className="text-[10px] opacity-70">{formatPercent(pnlPercent)}</span>
      )}
    </div>
  );
}

function LoadingSkeleton() {
  return (
    <div className="flex flex-col gap-2 p-3">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="flex items-center gap-3">
          <Skeleton className="h-6 w-6 rounded-full bg-white/5" />
          <Skeleton className="h-4 w-16 bg-white/5" />
          <Skeleton className="ml-auto h-4 w-12 bg-white/5" />
          <Skeleton className="h-4 w-14 bg-white/5" />
          <Skeleton className="h-4 w-14 bg-white/5" />
        </div>
      ))}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-10 text-white/40">
      <Wallet className="h-8 w-8" />
      <p className="text-sm">No open positions</p>
    </div>
  );
}

function ConnectWalletState() {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-10 text-white/40">
      <Wallet className="h-8 w-8" />
      <p className="text-sm">Connect wallet to view portfolio</p>
    </div>
  );
}

export default function PortfolioPanel({
  positions,
  isLoading,
  totalUnrealizedPnl,
  onQuickSell,
  walletConnected,
}: PortfolioPanelProps) {
  const totalIsProfit = totalUnrealizedPnl !== null && totalUnrealizedPnl >= 0;

  return (
    <div className="flex flex-col rounded-lg border border-white/10 bg-[#0c0e14]">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
        <h2 className="text-sm font-semibold text-white">Portfolio</h2>
        {walletConnected && totalUnrealizedPnl !== null && (
          <div
            className={cn(
              "flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium",
              totalIsProfit
                ? "bg-[#74f37a]/10 text-[#74f37a]"
                : "bg-[#ff6b6b]/10 text-[#ff6b6b]"
            )}
          >
            {totalIsProfit ? (
              <TrendingUp className="h-3 w-3" />
            ) : (
              <TrendingDown className="h-3 w-3" />
            )}
            <span>Total UPnL: {formatUsd(totalUnrealizedPnl)}</span>
          </div>
        )}
      </div>

      {/* Content */}
      {!walletConnected ? (
        <ConnectWalletState />
      ) : isLoading ? (
        <LoadingSkeleton />
      ) : positions.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="max-h-[400px] overflow-auto">
          {/* Table header */}
          <div className="sticky top-0 z-10 grid grid-cols-[minmax(100px,1.5fr)_1fr_1fr_1fr_1fr_1fr_auto] gap-2 border-b border-white/5 bg-[#0c0e14] px-4 py-2 text-[11px] font-medium uppercase tracking-wider text-white/40">
            <span>Asset</span>
            <span className="text-right">Balance</span>
            <span className="text-right">Avg Entry</span>
            <span className="text-right">Price</span>
            <span className="text-right">Cost Basis</span>
            <span className="text-right">UPnL</span>
            <span className="w-16" />
          </div>

          {/* Rows */}
          {positions.map((pos) => (
            <div
              key={pos.mint}
              className="grid grid-cols-[minmax(100px,1.5fr)_1fr_1fr_1fr_1fr_1fr_auto] items-center gap-2 border-b border-white/5 px-4 py-2 transition-colors hover:bg-white/[0.03]"
            >
              {/* Asset */}
              <div className="flex items-center gap-2 overflow-hidden">
                {pos.image ? (
                  <img
                    src={pos.image}
                    alt={pos.symbol}
                    className="h-6 w-6 flex-shrink-0 rounded-full object-cover"
                  />
                ) : (
                  <div className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-white/10 text-[10px] font-bold text-white/60">
                    {pos.symbol.charAt(0)}
                  </div>
                )}
                <div className="flex flex-col overflow-hidden">
                  <span className="truncate text-xs font-medium text-white">
                    {pos.symbol}
                  </span>
                  <span className="truncate text-[10px] text-white/30">{pos.name}</span>
                </div>
              </div>

              {/* Balance */}
              <span className="text-right text-xs text-white/70">
                {formatBalance(pos.balance)}
              </span>

              {/* Avg Entry */}
              <span className="text-right text-xs text-white/70">
                {formatPrice(pos.avgEntryPrice)}
              </span>

              {/* Current Price */}
              <span className="text-right text-xs text-white/70">
                {formatPrice(pos.currentPrice)}
              </span>

              {/* Cost Basis */}
              <span className="text-right text-xs text-white/70">
                {formatUsd(pos.costBasis)}
              </span>

              {/* UPnL */}
              <div className="flex justify-end">
                <PnlDisplay pnl={pos.unrealizedPnl} pnlPercent={pos.unrealizedPnlPercent} />
              </div>

              {/* Quick Sell */}
              <div className="flex w-16 justify-end">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 rounded-full bg-[#ff6b6b]/10 px-2 text-[10px] font-medium text-[#ff6b6b] hover:bg-[#ff6b6b]/20 hover:text-[#ff6b6b]"
                  onClick={() => onQuickSell(pos.mint, pos.balance)}
                >
                  <X className="mr-0.5 h-3 w-3" />
                  Sell
                </Button>
              </div>
            </div>
          ))}

          {/* Total row */}
          {totalUnrealizedPnl !== null && (
            <div className="sticky bottom-0 grid grid-cols-[minmax(100px,1.5fr)_1fr_1fr_1fr_1fr_1fr_auto] items-center gap-2 border-t border-white/10 bg-[#0c0e14] px-4 py-2.5">
              <span className="text-xs font-semibold text-white/60">Total</span>
              <span />
              <span />
              <span />
              <span />
              <div className="flex justify-end">
                <span
                  className={cn(
                    "text-xs font-semibold",
                    totalIsProfit ? "text-[#74f37a]" : "text-[#ff6b6b]"
                  )}
                >
                  {formatUsd(totalUnrealizedPnl)}
                </span>
              </div>
              <span className="w-16" />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
