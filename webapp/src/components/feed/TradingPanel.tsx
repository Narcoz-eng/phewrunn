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
  ShieldCheck,
  Lock,
  TrendingUp,
  TrendingDown,
  Crosshair,
  CircleAlert,
  Target,
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
  chainType?: "solana" | "ethereum";
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
  mevProtectionEnabled: boolean;
  onMevProtectionChange: (enabled: boolean) => void;
  protectionEnabled: boolean;
  onProtectionEnabledChange: (enabled: boolean) => void;
  stopLossPercent: string;
  onStopLossPercentChange: (value: string) => void;
  takeProfitPercent: string;
  onTakeProfitPercentChange: (value: string) => void;
  protectionStatusLabel?: string | null;
  protectionStatusTone?: "idle" | "armed" | "triggered";
  quoteFreshnessLabel?: string | null;
  liveStateLabel?: string | null;
  tradeError?: {
    title: string;
    message: string;
    retryable: boolean;
  } | null;
  onClearTradeError?: () => void;
  onRetryTradeError?: () => void;
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

function SolIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 397 311" fill="none" className="flex-shrink-0">
      <defs>
        <linearGradient id="tpSolGradA" x1="360.879" y1="-0.353" x2="141.213" y2="360.245" gradientUnits="userSpaceOnUse">
          <stop stopColor="#00FFA3" />
          <stop offset="1" stopColor="#DC1FFF" />
        </linearGradient>
        <linearGradient id="tpSolGradB" x1="264.829" y1="-47.505" x2="45.163" y2="313.093" gradientUnits="userSpaceOnUse">
          <stop stopColor="#00FFA3" />
          <stop offset="1" stopColor="#DC1FFF" />
        </linearGradient>
        <linearGradient id="tpSolGradC" x1="312.548" y1="-23.688" x2="92.882" y2="336.91" gradientUnits="userSpaceOnUse">
          <stop stopColor="#00FFA3" />
          <stop offset="1" stopColor="#DC1FFF" />
        </linearGradient>
      </defs>
      <path d="M64.6 237.9c2.4-2.4 5.7-3.8 9.2-3.8h320.3c5.8 0 8.7 7 4.6 11.1l-62.7 62.7c-2.4 2.4-5.7 3.8-9.2 3.8H6.5c-5.8 0-8.7-7-4.6-11.1l62.7-62.7z" fill="url(#tpSolGradA)" />
      <path d="M64.6 3.8C67.1 1.4 70.4 0 73.8 0h320.3c5.8 0 8.7 7 4.6 11.1l-62.7 62.7c-2.4 2.4-5.7 3.8-9.2 3.8H6.5c-5.8 0-8.7-7-4.6-11.1L64.6 3.8z" fill="url(#tpSolGradB)" />
      <path d="M333.1 120.1c-2.4-2.4-5.7-3.8-9.2-3.8H3.6c-5.8 0-8.7 7-4.6 11.1l62.7 62.7c2.4 2.4 5.7 3.8 9.2 3.8h320.3c5.8 0 8.7-7 4.6-11.1l-62.7-62.7z" fill="url(#tpSolGradC)" />
    </svg>
  );
}

function EthIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="flex-shrink-0">
      <circle cx="8" cy="8" r="8" fill="#627EEA" />
      <path d="M8 2.5L8 6.5L11.5 8L8 2.5Z" fill="white" fillOpacity="0.6" />
      <path d="M8 2.5L4.5 8L8 6.5L8 2.5Z" fill="white" />
      <path d="M8 9.5L8 13.5L11.5 8.75L8 9.5Z" fill="white" fillOpacity="0.6" />
      <path d="M8 13.5L8 9.5L4.5 8.75L8 13.5Z" fill="white" />
      <path d="M8 8.75L11.5 8L8 6.5L8 8.75Z" fill="white" fillOpacity="0.2" />
      <path d="M4.5 8L8 8.75L8 6.5L4.5 8Z" fill="white" fillOpacity="0.6" />
    </svg>
  );
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
  chainType = "solana",
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
  mevProtectionEnabled,
  onMevProtectionChange,
  protectionEnabled,
  onProtectionEnabledChange,
  stopLossPercent,
  onStopLossPercentChange,
  takeProfitPercent,
  onTakeProfitPercentChange,
  protectionStatusLabel = null,
  protectionStatusTone = "idle",
  quoteFreshnessLabel = null,
  liveStateLabel = null,
  tradeError = null,
  onClearTradeError,
  onRetryTradeError,
}: TradingPanelProps) {
  const isBuy = tradeSide === "buy";
  const [tokenImageError, setTokenImageError] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const detailsRef = useRef<HTMLDivElement>(null);
  const prevTokenImageRef = useRef<string | null>(null);
  if (prevTokenImageRef.current !== tokenImage) {
    prevTokenImageRef.current = tokenImage;
    if (tokenImageError) setTokenImageError(false);
  }

  const inputValue = isBuy ? buyAmountSol : sellAmountToken;
  const onInputChange = isBuy ? onBuyAmountChange : onSellAmountChange;

  const chainCurrencySymbol = chainType === "ethereum" ? "ETH" : "SOL";
  const availableBalanceLabel = isBuy
    ? walletBalance !== null
      ? `${walletBalance.toFixed(4)} ${chainCurrencySymbol}`
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
    "flex flex-col overflow-hidden rounded-2xl border border-slate-900/[0.08] bg-[linear-gradient(180deg,rgba(255,255,255,0.82),rgba(247,241,230,0.94))] shadow-[0_30px_80px_-52px_rgba(148,163,184,0.7)] ring-1 ring-white/65 dark:border-white/[0.07] dark:bg-[radial-gradient(circle_at_14%_0%,rgba(16,185,129,0.08),transparent_28%),radial-gradient(circle_at_100%_0%,rgba(59,130,246,0.08),transparent_24%),linear-gradient(180deg,rgba(8,12,20,0.98),rgba(4,8,14,0.99))] dark:shadow-none dark:ring-white/5";
  const sectionBorderClassName = "border-slate-900/[0.07] dark:border-white/[0.07]";
  const mutedTextClassName = "text-slate-500 dark:text-white/58";
  const fieldSurfaceClassName =
    "border-slate-900/[0.08] bg-white/75 text-slate-900 placeholder:text-slate-400 shadow-[inset_0_1px_0_rgba(255,255,255,0.75)] dark:border-white/[0.08] dark:bg-[linear-gradient(180deg,rgba(10,17,30,0.98),rgba(6,12,22,0.98))] dark:text-white dark:placeholder:text-white/28 dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]";
  const chipSurfaceClassName =
    "bg-slate-900/[0.05] text-slate-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.7)] dark:bg-[linear-gradient(180deg,rgba(13,20,34,0.98),rgba(8,14,24,0.98))] dark:text-white/82 dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]";
  const softSectionClassName =
    "rounded-xl border border-slate-900/[0.06] bg-white/60 shadow-[inset_0_1px_0_rgba(255,255,255,0.72)] dark:border-white/[0.08] dark:bg-[linear-gradient(180deg,rgba(9,15,27,0.95),rgba(5,10,19,0.97))] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.035)]";

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
            {walletConnected ? (
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
            ) : null}
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
                  {chainType === "ethereum" ? <EthIcon /> : <SolIcon />}
                  <span className="text-xs font-semibold text-slate-700 dark:text-white/70">
                    {chainType === "ethereum" ? "ETH" : "SOL"}
                  </span>
                </div>
              ) : (
                <div className="flex items-center gap-1.5">
                  {tokenImage && !tokenImageError ? (
                    <img src={tokenImage} alt={tokenSymbol} className="w-4 h-4 rounded-full" onError={() => setTokenImageError(true)} />
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
                  {tokenImage && !tokenImageError ? (
                    <img src={tokenImage} alt={tokenSymbol} className="w-4 h-4 rounded-full" onError={() => setTokenImageError(true)} />
                  ) : (
                    <div className="flex h-4 w-4 items-center justify-center rounded-full bg-slate-900/10 text-[8px] font-bold text-slate-500 dark:bg-white/10 dark:text-white/50">
                      {tokenSymbol.charAt(0)}
                    </div>
                  )}
                  <span className="text-xs font-semibold text-slate-700 dark:text-white/70">{tokenSymbol}</span>
                </div>
              ) : (
                <div className="flex items-center gap-1.5">
                  {chainType === "ethereum" ? <EthIcon /> : <SolIcon />}
                  <span className="text-xs font-semibold text-slate-700 dark:text-white/70">
                    {chainType === "ethereum" ? "ETH" : "SOL"}
                  </span>
                </div>
              )}
            </div>
          </div>
          <div className="flex items-center justify-between text-[10px] text-slate-400 dark:text-white/32">
            <span>{isBuy ? "Quoted receive value" : `Estimated ${chainType === "ethereum" ? "ETH" : "SOL"} proceeds`}</span>
            <span>{receiveAmountUsdLabel ? `~${receiveAmountUsdLabel}` : "--"}</span>
          </div>
        </div>

        {/* MEV Protection */}
        {(quoteFreshnessLabel || liveStateLabel) ? (
          <div className={cn("grid gap-2 sm:grid-cols-2", softSectionClassName, "p-3")}>
            <div>
              <div className="text-[10px] font-medium uppercase tracking-widest text-slate-400 dark:text-white/35">
                Route Freshness
              </div>
              <div className="mt-1 text-[12px] font-medium text-slate-700 dark:text-white/75">
                {quoteFreshnessLabel ?? "Waiting for quote"}
              </div>
            </div>
            <div>
              <div className="text-[10px] font-medium uppercase tracking-widest text-slate-400 dark:text-white/35">
                Live Market
              </div>
              <div className="mt-1 text-[12px] font-medium text-slate-700 dark:text-white/75">
                {liveStateLabel ?? "Waiting for stream"}
              </div>
            </div>
          </div>
        ) : null}

        {tradeError ? (
          <div className="rounded-xl border border-rose-500/18 bg-rose-500/[0.05] px-3 py-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-[11px] font-semibold uppercase tracking-widest text-rose-600 dark:text-rose-300">
                  {tradeError.title}
                </div>
                <div className="mt-1 text-[12px] leading-5 text-rose-700 dark:text-rose-200/90">
                  {tradeError.message}
                </div>
              </div>
              {onClearTradeError ? (
                <button
                  type="button"
                  onClick={onClearTradeError}
                  className="shrink-0 text-[10px] font-medium text-rose-500 transition-colors hover:text-rose-600 dark:text-rose-200/80 dark:hover:text-rose-100"
                >
                  Dismiss
                </button>
              ) : null}
            </div>
            {tradeError.retryable ? (
              <div className="mt-2 flex items-center justify-between gap-3">
                <div className="text-[11px] text-rose-600/80 dark:text-rose-200/75">
                  Retry is available as soon as the route refreshes.
                </div>
                {onRetryTradeError ? (
                  <button
                    type="button"
                    onClick={onRetryTradeError}
                    className="rounded-md border border-rose-500/20 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-rose-600 transition-colors hover:bg-rose-500/8 dark:border-rose-300/20 dark:text-rose-200"
                  >
                    Retry
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}

        {/* MEV Protection */}
        <div className={cn(
          "rounded-xl border px-3 py-2.5",
          mevProtectionEnabled
            ? "border-emerald-500/20 bg-emerald-500/[0.04] dark:border-emerald-500/15 dark:bg-emerald-500/[0.04]"
            : "border-slate-900/[0.06] bg-slate-50/50 dark:border-white/[0.06] dark:bg-white/[0.02]"
        )}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className={cn(
                "flex items-center justify-center w-6 h-6 rounded-lg",
                mevProtectionEnabled ? "bg-emerald-500/15" : "bg-slate-900/[0.05] dark:bg-white/[0.06]"
              )}>
                <ShieldCheck className={cn("w-3.5 h-3.5", mevProtectionEnabled ? "text-emerald-500 dark:text-emerald-400" : "text-slate-400 dark:text-white/40")} />
              </div>
              <div>
                <span className={cn("text-[11px] font-semibold", mevProtectionEnabled ? "text-emerald-600 dark:text-emerald-400" : "text-slate-600 dark:text-white/60")}>
                  MEV Protection
                </span>
                <p className="text-[9px] text-slate-400 dark:text-white/35 leading-tight">Frontrun & sandwich guard</p>
              </div>
            </div>
            <Switch
              checked={mevProtectionEnabled}
              onCheckedChange={onMevProtectionChange}
              className="data-[state=checked]:bg-emerald-500/80 scale-[0.75]"
            />
          </div>
          {mevProtectionEnabled ? (
            <div className="flex items-center gap-3 mt-2 pt-2 border-t border-emerald-500/10 dark:border-emerald-500/10">
              <div className="flex items-center gap-1 text-[9px] text-emerald-600/70 dark:text-emerald-400/70">
                <Lock className="w-2.5 h-2.5" />
                <span>Private mempool</span>
              </div>
              <div className="flex items-center gap-1 text-[9px] text-emerald-600/70 dark:text-emerald-400/70">
                <Shield className="w-2.5 h-2.5" />
                <span>{chainType === "ethereum" ? "Flashbots" : "Jito bundles"}</span>
              </div>
              <div className="flex items-center gap-1 text-[9px] text-emerald-600/70 dark:text-emerald-400/70">
                <Zap className="w-2.5 h-2.5" />
                <span>{chainType === "ethereum" ? "MEV-Share" : "Skip validators"}</span>
              </div>
            </div>
          ) : null}
        </div>

        {/* Stop Loss / Take Profit */}
        <div className={cn(
          "rounded-xl border px-3 py-2.5",
          protectionEnabled
            ? "border-amber-500/20 bg-amber-500/[0.03] dark:border-amber-500/15 dark:bg-amber-500/[0.03]"
            : "border-slate-900/[0.06] bg-slate-50/50 dark:border-white/[0.06] dark:bg-white/[0.02]"
        )}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className={cn(
                "flex items-center justify-center w-6 h-6 rounded-lg",
                protectionEnabled ? "bg-amber-500/15" : "bg-slate-900/[0.05] dark:bg-white/[0.06]"
              )}>
                <Crosshair className={cn("w-3.5 h-3.5", protectionEnabled ? "text-amber-500 dark:text-amber-400" : "text-slate-400 dark:text-white/40")} />
              </div>
              <div>
                <span className={cn("text-[11px] font-semibold", protectionEnabled ? "text-amber-600 dark:text-amber-400" : "text-slate-600 dark:text-white/60")}>
                  Stop Loss / Take Profit
                </span>
                <p className="text-[9px] text-slate-400 dark:text-white/35 leading-tight">Auto-exit on price triggers</p>
              </div>
            </div>
            <Switch
              checked={protectionEnabled}
              onCheckedChange={onProtectionEnabledChange}
              className="data-[state=checked]:bg-amber-500/80 scale-[0.75]"
            />
          </div>
          {protectionEnabled ? (
            <div className="mt-2 pt-2 border-t border-amber-500/10 dark:border-amber-500/10 space-y-2">
              {/* Stop Loss */}
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-1.5 flex-1">
                  <CircleAlert className="w-3 h-3 text-rose-400 flex-shrink-0" />
                  <span className="text-[10px] text-rose-500 dark:text-rose-400/80 font-medium w-10 flex-shrink-0">Stop</span>
                  <Input
                    type="text"
                    inputMode="decimal"
                    placeholder="-15%"
                    className={cn("h-7 text-[11px] font-mono", fieldSurfaceClassName)}
                    value={stopLossPercent}
                    onChange={(event) => onStopLossPercentChange(event.target.value)}
                  />
                </div>
              </div>
              {/* Take Profit */}
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-1.5 flex-1">
                  <Target className="w-3 h-3 text-emerald-400 flex-shrink-0" />
                  <span className="text-[10px] text-emerald-500 dark:text-emerald-400/80 font-medium w-10 flex-shrink-0">Target</span>
                  <Input
                    type="text"
                    inputMode="decimal"
                    placeholder="+50%"
                    className={cn("h-7 text-[11px] font-mono", fieldSurfaceClassName)}
                    value={takeProfitPercent}
                    onChange={(event) => onTakeProfitPercentChange(event.target.value)}
                  />
                </div>
              </div>
              {protectionStatusLabel ? (
                <div
                  className={cn(
                    "rounded-lg px-2.5 py-2 text-[10px] font-medium",
                    protectionStatusTone === "triggered"
                      ? "border border-rose-500/20 bg-rose-500/[0.07] text-rose-600 dark:text-rose-300"
                      : protectionStatusTone === "armed"
                        ? "border border-emerald-500/20 bg-emerald-500/[0.07] text-emerald-700 dark:text-emerald-300"
                        : "border border-slate-900/[0.06] bg-slate-900/[0.03] text-slate-600 dark:border-white/[0.08] dark:bg-white/[0.03] dark:text-white/65"
                  )}
                >
                  {protectionStatusLabel}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>

        {/* Expandable Order Details */}
        <button
          onClick={() => setShowDetails(!showDetails)}
          className="flex items-center justify-between rounded-lg border border-slate-900/[0.06] bg-white/60 px-3 py-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.7)] transition-colors hover:bg-white dark:border-white/[0.08] dark:bg-[linear-gradient(180deg,rgba(10,17,29,0.96),rgba(6,11,20,0.98))] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.035)] dark:hover:bg-[linear-gradient(180deg,rgba(12,19,34,0.98),rgba(7,13,24,1))]"
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

        {showDetails ? (
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
              <DetailRow label="Route" value={chainType === "ethereum" ? "Uniswap v3" : "Jupiter v6"} />
              <DetailRow label="MEV Protection" value={mevProtectionEnabled ? (chainType === "ethereum" ? "Enabled (Flashbots)" : "Enabled (Jito)") : "Disabled"} />
            </div>
          </div>
        ) : null}

        <div className="-mx-4 mt-1 sticky bottom-0 z-10 border-t border-slate-900/[0.06] bg-[linear-gradient(180deg,rgba(255,252,248,0.96),rgba(248,242,232,0.98))] px-4 pb-1 pt-3 backdrop-blur sm:static sm:mx-0 sm:border-t-0 sm:bg-transparent sm:px-0 sm:pb-0 sm:pt-0 sm:backdrop-blur-none dark:border-white/[0.06] dark:bg-[linear-gradient(180deg,rgba(7,10,16,0.96),rgba(5,8,12,0.98))] sm:dark:bg-transparent">
          {/* Execute / Connect */}
          {!walletConnected ? (
            <Button
              onClick={onConnectWallet}
              className={cn(
                "h-12 w-full rounded-xl border text-sm font-semibold transition-all duration-200",
                "border-emerald-200/70 bg-gradient-to-r from-emerald-300/95 via-teal-300/90 to-cyan-300/95 text-[#04251f] shadow-[0_20px_44px_-24px_rgba(45,212,191,0.9)] hover:from-emerald-200 hover:via-teal-200 hover:to-cyan-200 dark:border-white/[0.1] dark:bg-gradient-to-r dark:from-white/[0.08] dark:to-white/[0.04] dark:text-white dark:shadow-none dark:hover:from-white/[0.12] dark:hover:to-white/[0.08]"
              )}
            >
              <Wallet className="mr-2 h-4 w-4" />
              Connect Wallet
            </Button>
          ) : (
            <Button
              onClick={onExecute}
              disabled={!canExecute || isExecuting}
              className={cn(
                "h-12 w-full rounded-xl border-0 text-sm font-bold transition-all duration-200",
                isBuy
                  ? "bg-gradient-to-r from-emerald-600 to-emerald-500 text-white shadow-[0_0_20px_-4px_rgba(16,185,129,0.35)] hover:from-emerald-500 hover:to-emerald-400 disabled:from-emerald-900/40 disabled:to-emerald-800/30 disabled:text-white/30 disabled:shadow-none"
                  : "bg-gradient-to-r from-rose-600 to-rose-500 text-white shadow-[0_0_20px_-4px_rgba(244,63,94,0.35)] hover:from-rose-500 hover:to-rose-400 disabled:from-rose-900/40 disabled:to-rose-800/30 disabled:text-white/30 disabled:shadow-none"
              )}
            >
              {isExecuting ? (
                <span className="flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
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
          <div className="flex items-center justify-between pt-3">
            <div className="flex items-center gap-2">
              <Zap className={cn("h-3 w-3", autoConfirmEnabled ? "text-amber-400" : "text-slate-400 dark:text-white/25")} />
              <span className="text-[11px] text-slate-500 dark:text-white/40">Instant</span>
              <Switch
                checked={autoConfirmEnabled}
                onCheckedChange={onAutoConfirmChange}
                className="-ml-1 scale-[0.7] data-[state=checked]:bg-amber-500/80"
              />
            </div>
            {txSignature ? (
              <a
                href={chainType === "ethereum" ? `https://etherscan.io/tx/${txSignature}` : `https://solscan.io/tx/${txSignature}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 text-[11px] text-slate-500 transition-colors hover:text-slate-700 dark:text-white/30 dark:hover:text-white/60"
              >
                View Tx
                <ExternalLink className="h-2.5 w-2.5" />
              </a>
            ) : null}
          </div>
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
