import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import {
  Zap,
  Loader2,
  ExternalLink,
  Wallet,
  ArrowDownUp,
  ChevronDown,
  ChevronUp,
  Shield,
  TrendingUp,
  TrendingDown,
} from "lucide-react";

interface TradingPanelProps {
  tradeSide: "buy" | "sell";
  onTradeSideChange: (side: "buy" | "sell") => void;
  buyAmountSol: string;
  onBuyAmountChange: (amount: string) => void;
  sellAmountToken: string;
  onSellAmountChange: (amount: string) => void;
  tokenSymbol: string;
  tokenName: string;
  tokenImage: string | null;
  slippageBps: number;
  onSlippageChange: (bps: number) => void;
  jupiterOutputFormatted: string;
  jupiterMinReceiveFormatted: string;
  jupiterPriceImpactDisplay: string;
  jupiterPlatformFeeDisplay: string;
  jupiterStatusLabel: string;
  isQuoteLoading: boolean;
  isExecuting: boolean;
  canExecute: boolean;
  walletConnected: boolean;
  walletBalance: number | null;
  walletBalanceUsd: number | null;
  walletTokenBalance: number | null;
  walletTokenBalanceFormatted: string;
  payAmountUsd: number | null;
  receiveAmountUsd: number | null;
  slippageInputPercent: string;
  onSlippageInputChange: (value: string) => void;
  onSlippageInputCommit: () => void;
  onExecute: () => void;
  onConnectWallet: () => void;
  txSignature: string | null;
  quickBuyPresets: string[];
  sellQuickPercents: number[];
  onQuickBuyPresetClick: (amount: string) => void;
  onSellPercentClick: (percent: number) => void;
  autoConfirmEnabled: boolean;
  onAutoConfirmChange: (enabled: boolean) => void;
}

const SLIPPAGE_QUICK = [50, 100, 200, 500];

function formatUsdEstimate(value: number | null): string | null {
  if (value === null || !Number.isFinite(value)) return null;
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "USD",
    notation: Math.abs(value) >= 1000 ? "compact" : "standard",
    maximumFractionDigits: Math.abs(value) >= 1 ? 2 : 4,
  }).format(value);
}

export function TradingPanel({
  tradeSide,
  onTradeSideChange,
  buyAmountSol,
  onBuyAmountChange,
  sellAmountToken,
  onSellAmountChange,
  tokenSymbol,
  tokenName,
  tokenImage,
  slippageBps,
  onSlippageChange,
  jupiterOutputFormatted,
  jupiterMinReceiveFormatted,
  jupiterPriceImpactDisplay,
  jupiterPlatformFeeDisplay,
  jupiterStatusLabel,
  isQuoteLoading,
  isExecuting,
  canExecute,
  walletConnected,
  walletBalance,
  walletBalanceUsd,
  walletTokenBalance,
  walletTokenBalanceFormatted,
  payAmountUsd,
  receiveAmountUsd,
  slippageInputPercent,
  onSlippageInputChange,
  onSlippageInputCommit,
  onExecute,
  onConnectWallet,
  txSignature,
  quickBuyPresets,
  sellQuickPercents,
  onQuickBuyPresetClick,
  onSellPercentClick,
  autoConfirmEnabled,
  onAutoConfirmChange,
}: TradingPanelProps) {
  const isBuy = tradeSide === "buy";
  const [showDetails, setShowDetails] = useState(false);
  const detailsRef = useRef<HTMLDivElement>(null);

  const inputValue = isBuy ? buyAmountSol : sellAmountToken;
  const onInputChange = isBuy ? onBuyAmountChange : onSellAmountChange;

  const availableBalanceLabel = isBuy
    ? walletBalance !== null
      ? `${walletBalance.toFixed(4)} SOL`
      : "--"
    : walletTokenBalance !== null
      ? `${walletTokenBalanceFormatted} ${tokenSymbol}`
      : "--";
  const availableBalanceUsdLabel =
    isBuy && walletBalanceUsd !== null ? formatUsdEstimate(walletBalanceUsd) : null;
  const payAmountUsdLabel = formatUsdEstimate(payAmountUsd);
  const receiveAmountUsdLabel = formatUsdEstimate(receiveAmountUsd);

  const priceImpactNum = parseFloat(jupiterPriceImpactDisplay);
  const priceImpactSeverity =
    priceImpactNum > 5 ? "critical" : priceImpactNum > 2 ? "warning" : "safe";

  useEffect(() => {
    if (!showDetails || typeof window === "undefined") return;
    const frame = window.requestAnimationFrame(() => {
      detailsRef.current?.scrollIntoView({ block: "nearest" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [showDetails]);

  return (
    <div className="flex flex-col rounded-2xl bg-[#0a0c12] border border-white/[0.07] overflow-hidden">
      {/* Buy / Sell Toggle */}
      <div className="grid grid-cols-2 border-b border-white/[0.07]">
        <button
          onClick={() => onTradeSideChange("buy")}
          className={cn(
            "relative py-3 text-sm font-semibold tracking-wide transition-all duration-200",
            isBuy
              ? "text-emerald-400"
              : "text-white/35 hover:text-white/55"
          )}
        >
          <span className="relative z-10 flex items-center justify-center gap-1.5">
            <TrendingUp className="w-3.5 h-3.5" />
            Buy
          </span>
          {isBuy && (
            <div className="absolute inset-x-0 bottom-0 h-0.5 bg-gradient-to-r from-emerald-500/0 via-emerald-400 to-emerald-500/0" />
          )}
          {isBuy && (
            <div className="absolute inset-0 bg-gradient-to-b from-emerald-500/[0.08] to-transparent" />
          )}
        </button>
        <button
          onClick={() => onTradeSideChange("sell")}
          className={cn(
            "relative py-3 text-sm font-semibold tracking-wide transition-all duration-200",
            !isBuy
              ? "text-rose-400"
              : "text-white/35 hover:text-white/55"
          )}
        >
          <span className="relative z-10 flex items-center justify-center gap-1.5">
            <TrendingDown className="w-3.5 h-3.5" />
            Sell
          </span>
          {!isBuy && (
            <div className="absolute inset-x-0 bottom-0 h-0.5 bg-gradient-to-r from-rose-500/0 via-rose-400 to-rose-500/0" />
          )}
          {!isBuy && (
            <div className="absolute inset-0 bg-gradient-to-b from-rose-500/[0.08] to-transparent" />
          )}
        </button>
      </div>

      <div className="flex flex-col gap-3 p-4">
        {/* Pay Section */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-medium uppercase tracking-widest text-white/40">
              You Pay
            </span>
            {walletConnected && (
              <button
                onClick={() => {
                  if (isBuy && walletBalance !== null) {
                    onBuyAmountChange(walletBalance.toFixed(4));
                  } else if (!isBuy && walletTokenBalance !== null) {
                    onSellPercentClick(100);
                  }
                }}
                className="text-[11px] text-white/40 hover:text-white/70 transition-colors"
              >
                Balance: <span className="text-white/60 font-medium">{availableBalanceLabel}</span>
                {availableBalanceUsdLabel ? (
                  <span className="text-white/30"> ({availableBalanceUsdLabel})</span>
                ) : null}
              </button>
            )}
          </div>
          <div className="relative group">
            <Input
              type="text"
              inputMode="decimal"
              placeholder="0.00"
              value={inputValue}
              onChange={(e) => onInputChange(e.target.value)}
              className={cn(
                "h-14 bg-white/[0.03] border-white/[0.08] text-white text-xl font-semibold pr-24 placeholder:text-white/20",
                "rounded-xl transition-all duration-200",
                "focus-visible:ring-1",
                isBuy ? "focus-visible:ring-emerald-500/30" : "focus-visible:ring-rose-500/30"
              )}
            />
            <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-2 rounded-lg bg-white/[0.06] px-2.5 py-1.5">
              {isBuy ? (
                <div className="flex items-center gap-1.5">
                  <div className="w-4 h-4 rounded-full bg-gradient-to-br from-[#9945FF] to-[#14F195] flex items-center justify-center">
                    <span className="text-[8px] font-bold text-white">S</span>
                  </div>
                  <span className="text-xs font-semibold text-white/70">SOL</span>
                </div>
              ) : (
                <div className="flex items-center gap-1.5">
                  {tokenImage ? (
                    <img src={tokenImage} alt={tokenSymbol} className="w-4 h-4 rounded-full" />
                  ) : (
                    <div className="w-4 h-4 rounded-full bg-white/10 flex items-center justify-center text-[8px] font-bold text-white/50">
                      {tokenSymbol.charAt(0)}
                    </div>
                  )}
                  <span className="text-xs font-semibold text-white/70">{tokenSymbol}</span>
                </div>
              )}
            </div>
          </div>
          <div className="flex items-center justify-between text-[10px] text-white/32">
            <span>{isBuy ? "Spend value" : "Token value"}</span>
            <span>{payAmountUsdLabel ? `~${payAmountUsdLabel}` : "--"}</span>
          </div>
        </div>

        {/* Quick Amount Presets */}
        <div className="grid grid-cols-4 gap-1.5">
          {isBuy
            ? quickBuyPresets.map((preset) => (
                <button
                  key={preset}
                  onClick={() => onQuickBuyPresetClick(preset)}
                  className={cn(
                    "py-2 text-[11px] font-semibold rounded-lg transition-all duration-150",
                    buyAmountSol === preset
                      ? "bg-emerald-500/15 text-emerald-400 ring-1 ring-emerald-500/30"
                      : "bg-white/[0.04] text-white/50 hover:bg-white/[0.08] hover:text-white/70"
                  )}
                >
                  {preset}
                </button>
              ))
            : sellQuickPercents.map((percent) => (
                <button
                  key={percent}
                  onClick={() => onSellPercentClick(percent)}
                  className={cn(
                    "py-2 text-[11px] font-semibold rounded-lg transition-all duration-150",
                    "bg-white/[0.04] text-white/50 hover:bg-white/[0.08] hover:text-white/70"
                  )}
                >
                  {percent === 100 ? "MAX" : `${percent}%`}
                </button>
              ))}
        </div>

        {/* Swap Direction Indicator */}
        <div className="flex items-center gap-3">
          <div className="flex-1 h-px bg-white/[0.06]" />
          <div className={cn(
            "flex items-center justify-center w-8 h-8 rounded-full border transition-colors",
            isBuy
              ? "border-emerald-500/20 bg-emerald-500/[0.06] text-emerald-400"
              : "border-rose-500/20 bg-rose-500/[0.06] text-rose-400"
          )}>
            <ArrowDownUp className="w-3.5 h-3.5" />
          </div>
          <div className="flex-1 h-px bg-white/[0.06]" />
        </div>

        {/* Receive Section */}
        <div className="space-y-2">
          <span className="text-[11px] font-medium uppercase tracking-widest text-white/40">
            You Receive
          </span>
          <div className="flex items-center justify-between rounded-xl bg-white/[0.03] border border-white/[0.08] px-4 py-3.5">
            {isQuoteLoading ? (
              <div className="flex items-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin text-white/30" />
                <span className="text-sm text-white/30">Fetching quote...</span>
              </div>
            ) : (
              <span className="text-lg font-semibold text-white">
                {jupiterOutputFormatted || "--"}
              </span>
            )}
            <div className="flex items-center gap-2 rounded-lg bg-white/[0.06] px-2.5 py-1.5">
              {isBuy ? (
                <div className="flex items-center gap-1.5">
                  {tokenImage ? (
                    <img src={tokenImage} alt={tokenSymbol} className="w-4 h-4 rounded-full" />
                  ) : (
                    <div className="w-4 h-4 rounded-full bg-white/10 flex items-center justify-center text-[8px] font-bold text-white/50">
                      {tokenSymbol.charAt(0)}
                    </div>
                  )}
                  <span className="text-xs font-semibold text-white/70">{tokenSymbol}</span>
                </div>
              ) : (
                <div className="flex items-center gap-1.5">
                  <div className="w-4 h-4 rounded-full bg-gradient-to-br from-[#9945FF] to-[#14F195] flex items-center justify-center">
                    <span className="text-[8px] font-bold text-white">S</span>
                  </div>
                  <span className="text-xs font-semibold text-white/70">SOL</span>
                </div>
              )}
            </div>
          </div>
          <div className="flex items-center justify-between text-[10px] text-white/32">
            <span>{isBuy ? "Quoted receive value" : "Estimated SOL proceeds"}</span>
            <span>{receiveAmountUsdLabel ? `~${receiveAmountUsdLabel}` : "--"}</span>
          </div>
        </div>

        {/* Expandable Order Details */}
        <button
          onClick={() => setShowDetails(!showDetails)}
          className="flex items-center justify-between rounded-lg bg-white/[0.02] border border-white/[0.06] px-3 py-2 transition-colors hover:bg-white/[0.04]"
        >
          <div className="flex items-center gap-2 text-[11px] text-white/50">
            <Shield className="w-3 h-3" />
            <span>
              Slippage {(slippageBps / 100).toFixed(1)}%
              {!isQuoteLoading && jupiterPriceImpactDisplay !== "-" && (
                <span className={cn(
                  "ml-2",
                  priceImpactSeverity === "critical" && "text-rose-400",
                  priceImpactSeverity === "warning" && "text-amber-400",
                  priceImpactSeverity === "safe" && "text-emerald-400",
                )}>
                  Impact {jupiterPriceImpactDisplay}
                </span>
              )}
            </span>
          </div>
          {showDetails ? (
            <ChevronUp className="w-3.5 h-3.5 text-white/30" />
          ) : (
            <ChevronDown className="w-3.5 h-3.5 text-white/30" />
          )}
        </button>

        {showDetails && (
          <div ref={detailsRef} className="space-y-2 animate-in fade-in slide-in-from-top-1 duration-200">
            {/* Slippage Quick Adjust */}
            <div className="rounded-xl bg-white/[0.02] border border-white/[0.06] p-3 space-y-2">
              <div className="flex items-center justify-between gap-3">
                <span className="text-[10px] font-medium uppercase tracking-widest text-white/35">Slippage Tolerance</span>
                <span className="text-[10px] text-white/25">0.01% - 50.00%</span>
              </div>
              <div className="grid grid-cols-4 gap-1.5">
                {SLIPPAGE_QUICK.map((bps) => (
                  <button
                    key={bps}
                    onClick={() => {
                      onSlippageChange(bps);
                    }}
                    className={cn(
                      "py-1.5 text-[11px] font-medium rounded-md transition-all",
                      slippageBps === bps
                        ? "bg-white/10 text-white ring-1 ring-white/20"
                        : "bg-white/[0.03] text-white/40 hover:bg-white/[0.06] hover:text-white/60"
                    )}
                  >
                    {(bps / 100).toFixed(1)}%
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-2">
                <Input
                  type="text"
                  inputMode="decimal"
                  value={slippageInputPercent}
                  onChange={(event) => onSlippageInputChange(event.target.value)}
                  onBlur={onSlippageInputCommit}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      onSlippageInputCommit();
                    }
                  }}
                  className="h-9 border-white/[0.08] bg-white/[0.03] text-sm text-white placeholder:text-white/25"
                  placeholder="1.00"
                />
                <span className="text-xs font-medium text-white/45">%</span>
              </div>
            </div>

            {/* Trade Details */}
            <div className="rounded-xl bg-white/[0.02] border border-white/[0.06] p-3 space-y-1.5">
              <DetailRow label="Min. Received" value={jupiterMinReceiveFormatted} />
              <DetailRow label="Price Impact" value={jupiterPriceImpactDisplay} severity={priceImpactSeverity} />
              <DetailRow label="Platform Fee" value={jupiterPlatformFeeDisplay} />
              <DetailRow label="Route" value="Jupiter v6" />
            </div>
          </div>
        )}

        {/* Execute / Connect */}
        {!walletConnected ? (
          <Button
            onClick={onConnectWallet}
            className={cn(
              "w-full h-12 text-sm font-semibold rounded-xl transition-all duration-200",
              "bg-gradient-to-r from-white/[0.08] to-white/[0.04] hover:from-white/[0.12] hover:to-white/[0.08]",
              "border border-white/[0.1] text-white"
            )}
          >
            <Wallet className="w-4 h-4 mr-2" />
            Connect Wallet
          </Button>
        ) : (
          <Button
            onClick={onExecute}
            disabled={!canExecute || isExecuting}
            className={cn(
              "w-full h-12 text-sm font-bold rounded-xl transition-all duration-200 border-0",
              isBuy
                ? "bg-gradient-to-r from-emerald-600 to-emerald-500 hover:from-emerald-500 hover:to-emerald-400 text-white shadow-[0_0_20px_-4px_rgba(16,185,129,0.35)] disabled:from-emerald-900/40 disabled:to-emerald-800/30 disabled:text-white/30 disabled:shadow-none"
                : "bg-gradient-to-r from-rose-600 to-rose-500 hover:from-rose-500 hover:to-rose-400 text-white shadow-[0_0_20px_-4px_rgba(244,63,94,0.35)] disabled:from-rose-900/40 disabled:to-rose-800/30 disabled:text-white/30 disabled:shadow-none"
            )}
          >
            {isExecuting ? (
              <span className="flex items-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin" />
                {jupiterStatusLabel || "Processing..."}
              </span>
            ) : (
              <span className="flex items-center gap-1.5">
                {isBuy ? "Buy" : "Sell"} {tokenSymbol}
              </span>
            )}
          </Button>
        )}

        {/* Bottom Controls */}
        <div className="flex items-center justify-between pt-1">
          <div className="flex items-center gap-2">
            <Zap className={cn("w-3 h-3", autoConfirmEnabled ? "text-amber-400" : "text-white/25")} />
            <span className="text-[11px] text-white/40">Instant</span>
            <Switch
              checked={autoConfirmEnabled}
              onCheckedChange={onAutoConfirmChange}
              className="data-[state=checked]:bg-amber-500/80 scale-[0.7] -ml-1"
            />
          </div>
          {txSignature && (
            <a
              href={`https://solscan.io/tx/${txSignature}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 text-[11px] text-white/30 hover:text-white/60 transition-colors"
            >
              View Tx
              <ExternalLink className="w-2.5 h-2.5" />
            </a>
          )}
        </div>
      </div>
    </div>
  );
}

function DetailRow({
  label,
  value,
  severity,
}: {
  label: string;
  value: string;
  severity?: "safe" | "warning" | "critical";
}) {
  return (
    <div className="flex items-center justify-between text-[11px]">
      <span className="text-white/35">{label}</span>
      <span
        className={cn(
          "font-medium",
          severity === "critical" && "text-rose-400",
          severity === "warning" && "text-amber-400",
          severity === "safe" && "text-white/60",
          !severity && "text-white/55"
        )}
      >
        {value || "--"}
      </span>
    </div>
  );
}
