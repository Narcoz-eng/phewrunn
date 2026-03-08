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
  routeFeeDisplay: string;
  creatorFeeDisplay: string;
  platformFeeDisplay: string;
  jupiterStatusLabel: string;
  isQuoteLoading: boolean;
  isExecuting: boolean;
  canExecute: boolean;
  walletConnected: boolean;
  walletBalance: number | null;
  walletBalanceLoading: boolean;
  walletBalanceUsd: number | null;
  walletTokenBalance: number | null;
  walletTokenBalanceFormatted: string;
  walletTokenBalanceLoading: boolean;
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
  routeFeeDisplay,
  creatorFeeDisplay,
  platformFeeDisplay,
  jupiterStatusLabel,
  isQuoteLoading,
  isExecuting,
  canExecute,
  walletConnected,
  walletBalance,
  walletBalanceLoading,
  walletBalanceUsd,
  walletTokenBalance,
  walletTokenBalanceFormatted,
  walletTokenBalanceLoading,
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
      : walletBalanceLoading
        ? "Loading..."
      : "--"
    : walletTokenBalance !== null
      ? `${walletTokenBalanceFormatted} ${tokenSymbol}`
      : walletTokenBalanceLoading
        ? "Loading..."
      : "--";
  const availableBalanceUsdLabel =
    isBuy && walletBalanceUsd !== null ? formatUsdEstimate(walletBalanceUsd) : null;
  const payAmountUsdLabel = formatUsdEstimate(payAmountUsd);
  const receiveAmountUsdLabel = formatUsdEstimate(receiveAmountUsd);

  const priceImpactNum = parseFloat(jupiterPriceImpactDisplay);
  const priceImpactSeverity =
    priceImpactNum > 5 ? "critical" : priceImpactNum > 2 ? "warning" : "safe";
  const panelSurfaceClassName =
    "flex flex-col overflow-hidden rounded-2xl border border-slate-900/[0.08] bg-[linear-gradient(180deg,rgba(255,255,255,0.82),rgba(247,241,230,0.94))] shadow-[0_30px_80px_-52px_rgba(148,163,184,0.7)] ring-1 ring-white/65 dark:border-white/[0.07] dark:bg-[linear-gradient(180deg,rgba(10,12,18,0.96),rgba(6,8,12,0.98))] dark:shadow-none dark:ring-white/5";
  const sectionBorderClassName = "border-slate-900/[0.07] dark:border-white/[0.07]";
  const mutedTextClassName = "text-slate-500 dark:text-white/58";
  const fieldSurfaceClassName =
    "border-slate-900/[0.08] bg-white/75 text-slate-900 placeholder:text-slate-400 shadow-[inset_0_1px_0_rgba(255,255,255,0.75)] dark:border-white/[0.1] dark:bg-[linear-gradient(180deg,rgba(255,255,255,0.06),rgba(255,255,255,0.03))] dark:text-white dark:placeholder:text-white/30 dark:shadow-none";
  const chipSurfaceClassName =
    "bg-slate-900/[0.05] text-slate-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.7)] dark:bg-white/[0.08] dark:text-white/78 dark:shadow-none";
  const softSectionClassName =
    "rounded-xl border border-slate-900/[0.06] bg-white/60 shadow-[inset_0_1px_0_rgba(255,255,255,0.72)] dark:border-white/[0.09] dark:bg-[linear-gradient(180deg,rgba(255,255,255,0.055),rgba(255,255,255,0.028))] dark:shadow-none";

  useEffect(() => {
    if (!showDetails || typeof window === "undefined") return;
    const frame = window.requestAnimationFrame(() => {
      detailsRef.current?.scrollIntoView({ block: "start" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [showDetails]);

  return (
    <div className={panelSurfaceClassName}>
      {/* Buy / Sell Toggle */}
      <div className={cn("grid grid-cols-2 border-b", sectionBorderClassName)}>
        <button
          onClick={() => onTradeSideChange("buy")}
          className={cn(
            "relative py-3 text-sm font-semibold tracking-wide transition-all duration-200",
            isBuy
              ? "text-emerald-400"
              : "text-slate-500 hover:text-slate-700 dark:text-white/35 dark:hover:text-white/55"
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
              : "text-slate-500 hover:text-slate-700 dark:text-white/35 dark:hover:text-white/55"
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
            <span className={cn("text-[11px] font-medium uppercase tracking-widest", mutedTextClassName)}>
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
                className="text-[11px] text-slate-500 transition-colors hover:text-slate-700 dark:text-white/40 dark:hover:text-white/70"
              >
                Balance: <span className="font-medium text-slate-700 dark:text-white/60">{availableBalanceLabel}</span>
                {availableBalanceUsdLabel ? (
                  <span className="text-slate-400 dark:text-white/30"> ({availableBalanceUsdLabel})</span>
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
                "h-14 pr-24 text-xl font-semibold",
                "rounded-xl transition-all duration-200",
                "focus-visible:ring-1",
                fieldSurfaceClassName,
                isBuy ? "focus-visible:ring-emerald-500/30" : "focus-visible:ring-rose-500/30"
              )}
            />
            <div className={cn("absolute right-3 top-1/2 flex -translate-y-1/2 items-center gap-2 rounded-lg px-2.5 py-1.5", chipSurfaceClassName)}>
              {isBuy ? (
                <div className="flex items-center gap-1.5">
                  <div className="w-4 h-4 rounded-full bg-gradient-to-br from-[#9945FF] to-[#14F195] flex items-center justify-center">
                    <span className="text-[8px] font-bold text-white">S</span>
                  </div>
                  <span className="text-xs font-semibold text-slate-700 dark:text-white/70">SOL</span>
                </div>
              ) : (
                <div className="flex items-center gap-1.5">
                  {tokenImage ? (
                    <img src={tokenImage} alt={tokenSymbol} className="w-4 h-4 rounded-full" />
                  ) : (
                    <div className="flex h-4 w-4 items-center justify-center rounded-full bg-slate-900/10 text-[8px] font-bold text-slate-500 dark:bg-white/10 dark:text-white/50">
                      {tokenSymbol.charAt(0)}
                    </div>
                  )}
                  <span className="text-xs font-semibold text-slate-700 dark:text-white/70">{tokenSymbol}</span>
                </div>
              )}
            </div>
          </div>
          <div className="flex items-center justify-between text-[10px] text-slate-400 dark:text-white/32">
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
                      : "bg-slate-900/[0.04] text-slate-500 hover:bg-slate-900/[0.08] hover:text-slate-700 dark:bg-white/[0.04] dark:text-white/50 dark:hover:bg-white/[0.08] dark:hover:text-white/70"
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
                    "bg-slate-900/[0.04] text-slate-500 hover:bg-slate-900/[0.08] hover:text-slate-700 dark:bg-white/[0.04] dark:text-white/50 dark:hover:bg-white/[0.08] dark:hover:text-white/70"
                  )}
                >
                  {percent === 100 ? "MAX" : `${percent}%`}
                </button>
              ))}
        </div>

        {/* Swap Direction Indicator */}
        <div className="flex items-center gap-3">
          <div className="h-px flex-1 bg-slate-900/[0.08] dark:bg-white/[0.06]" />
          <div className={cn(
            "flex items-center justify-center w-8 h-8 rounded-full border transition-colors",
            isBuy
              ? "border-emerald-500/20 bg-emerald-500/[0.06] text-emerald-400"
              : "border-rose-500/20 bg-rose-500/[0.06] text-rose-400"
          )}>
            <ArrowDownUp className="w-3.5 h-3.5" />
          </div>
          <div className="h-px flex-1 bg-slate-900/[0.08] dark:bg-white/[0.06]" />
        </div>

        {/* Receive Section */}
        <div className="space-y-2">
          <span className={cn("text-[11px] font-medium uppercase tracking-widest", mutedTextClassName)}>
            You Receive
          </span>
          <div className={cn("flex items-center justify-between rounded-xl px-4 py-3.5", fieldSurfaceClassName)}>
            {isQuoteLoading ? (
              <div className="flex items-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin text-slate-400 dark:text-white/30" />
                <span className="text-sm text-slate-400 dark:text-white/30">Fetching quote...</span>
              </div>
            ) : (
              <span className="text-lg font-semibold text-slate-900 dark:text-white">
                {jupiterOutputFormatted || "--"}
              </span>
            )}
            <div className={cn("flex items-center gap-2 rounded-lg px-2.5 py-1.5", chipSurfaceClassName)}>
              {isBuy ? (
                <div className="flex items-center gap-1.5">
                  {tokenImage ? (
                    <img src={tokenImage} alt={tokenSymbol} className="w-4 h-4 rounded-full" />
                  ) : (
                    <div className="flex h-4 w-4 items-center justify-center rounded-full bg-slate-900/10 text-[8px] font-bold text-slate-500 dark:bg-white/10 dark:text-white/50">
                      {tokenSymbol.charAt(0)}
                    </div>
                  )}
                  <span className="text-xs font-semibold text-slate-700 dark:text-white/70">{tokenSymbol}</span>
                </div>
              ) : (
                <div className="flex items-center gap-1.5">
                  <div className="w-4 h-4 rounded-full bg-gradient-to-br from-[#9945FF] to-[#14F195] flex items-center justify-center">
                    <span className="text-[8px] font-bold text-white">S</span>
                  </div>
                  <span className="text-xs font-semibold text-slate-700 dark:text-white/70">SOL</span>
                </div>
              )}
            </div>
          </div>
          <div className="flex items-center justify-between text-[10px] text-slate-400 dark:text-white/32">
            <span>{isBuy ? "Quoted receive value" : "Estimated SOL proceeds"}</span>
            <span>{receiveAmountUsdLabel ? `~${receiveAmountUsdLabel}` : "--"}</span>
          </div>
        </div>

        {/* Expandable Order Details */}
        <button
          onClick={() => setShowDetails(!showDetails)}
          className="flex items-center justify-between rounded-lg border border-slate-900/[0.06] bg-white/60 px-3 py-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.7)] transition-colors hover:bg-white dark:border-white/[0.09] dark:bg-[linear-gradient(180deg,rgba(255,255,255,0.055),rgba(255,255,255,0.028))] dark:shadow-none dark:hover:bg-white/[0.07]"
        >
          <div className="flex items-center gap-2 text-[11px] text-slate-500 dark:text-white/65">
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
            <ChevronUp className="w-3.5 h-3.5 text-slate-400 dark:text-white/30" />
          ) : (
            <ChevronDown className="w-3.5 h-3.5 text-slate-400 dark:text-white/30" />
          )}
        </button>

        {showDetails && (
          <div ref={detailsRef} className="scroll-mt-4 space-y-2 animate-in fade-in slide-in-from-top-1 duration-200">
            {/* Slippage Quick Adjust */}
            <div className={cn("space-y-2 p-3", softSectionClassName)}>
              <div className="flex items-center justify-between gap-3">
                <span className="text-[10px] font-medium uppercase tracking-widest text-slate-500 dark:text-white/55">Slippage Tolerance</span>
                <span className="text-[10px] text-slate-400 dark:text-white/38">0.01% - 50.00%</span>
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
                        ? "bg-slate-900/[0.08] text-slate-900 ring-1 ring-slate-900/[0.12] dark:bg-white/12 dark:text-white dark:ring-white/24"
                        : "bg-slate-900/[0.04] text-slate-500 hover:bg-slate-900/[0.08] hover:text-slate-700 dark:bg-white/[0.05] dark:text-white/58 dark:hover:bg-white/[0.09] dark:hover:text-white/82"
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
                  className={cn("h-9 text-sm", fieldSurfaceClassName)}
                  placeholder="1.00"
                />
                <span className="text-xs font-medium text-slate-500 dark:text-white/62">%</span>
              </div>
            </div>

            {/* Trade Details */}
            <div className={cn("space-y-1.5 p-3", softSectionClassName)}>
              <DetailRow label="Min. Received" value={jupiterMinReceiveFormatted} />
              <DetailRow label="Price Impact" value={jupiterPriceImpactDisplay} severity={priceImpactSeverity} />
              <DetailRow label="Total Route Fee" value={routeFeeDisplay} />
              <DetailRow label="Creator Reward" value={creatorFeeDisplay} />
              <DetailRow label="Platform Fee" value={platformFeeDisplay} />
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
              "border border-emerald-200/70 bg-gradient-to-r from-emerald-300/95 via-teal-300/90 to-cyan-300/95 text-[#04251f] shadow-[0_20px_44px_-24px_rgba(45,212,191,0.9)] hover:from-emerald-200 hover:via-teal-200 hover:to-cyan-200 dark:border-white/[0.1] dark:bg-gradient-to-r dark:from-white/[0.08] dark:to-white/[0.04] dark:text-white dark:shadow-none dark:hover:from-white/[0.12] dark:hover:to-white/[0.08]"
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
            <Zap className={cn("w-3 h-3", autoConfirmEnabled ? "text-amber-400" : "text-slate-400 dark:text-white/25")} />
            <span className="text-[11px] text-slate-500 dark:text-white/40">Instant</span>
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
              className="flex items-center gap-1 text-[11px] text-slate-500 transition-colors hover:text-slate-700 dark:text-white/30 dark:hover:text-white/60"
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
      <span className="text-slate-500 dark:text-white/55">{label}</span>
      <span
        className={cn(
          "font-medium",
          severity === "critical" && "text-rose-400",
          severity === "warning" && "text-amber-400",
          severity === "safe" && "text-slate-700 dark:text-white/78",
          !severity && "text-slate-600 dark:text-white/72"
        )}
      >
        {value || "--"}
      </span>
    </div>
  );
}
