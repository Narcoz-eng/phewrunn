import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { Zap, Loader2, ExternalLink, Settings, Wallet } from "lucide-react";

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
  walletTokenBalance: number | null;
  walletTokenBalanceFormatted: string;
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
  walletTokenBalance,
  walletTokenBalanceFormatted,
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

  const inputValue = isBuy ? buyAmountSol : sellAmountToken;
  const onInputChange = isBuy ? onBuyAmountChange : onSellAmountChange;
  const currencyLabel = isBuy ? "SOL" : tokenSymbol;

  const availableBalance = isBuy
    ? walletBalance !== null
      ? `${walletBalance.toFixed(4)} SOL`
      : "--"
    : walletTokenBalance !== null
      ? `${walletTokenBalanceFormatted} ${tokenSymbol}`
      : "--";

  return (
    <div className="flex flex-col gap-3 rounded-xl bg-[#0c0e14] border border-white/10 p-4">
      {/* Buy / Sell Tabs */}
      <div className="flex rounded-lg bg-white/5 p-1">
        <button
          onClick={() => onTradeSideChange("buy")}
          className={cn(
            "flex-1 py-2 text-sm font-semibold rounded-md transition-colors",
            isBuy
              ? "bg-emerald-500/20 text-emerald-400"
              : "text-white/50 hover:text-white/70"
          )}
        >
          Buy
        </button>
        <button
          onClick={() => onTradeSideChange("sell")}
          className={cn(
            "flex-1 py-2 text-sm font-semibold rounded-md transition-colors",
            !isBuy
              ? "bg-red-500/20 text-red-400"
              : "text-white/50 hover:text-white/70"
          )}
        >
          Sell
        </button>
      </div>

      {/* Amount Input */}
      <div className="relative">
        <Input
          type="text"
          inputMode="decimal"
          placeholder="0.00"
          value={inputValue}
          onChange={(e) => onInputChange(e.target.value)}
          className="h-12 bg-white/5 border-white/10 text-white text-lg pr-16 placeholder:text-white/30 focus-visible:ring-1 focus-visible:ring-white/20"
        />
        <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-1.5">
          {isBuy ? (
            <span className="text-sm font-medium text-white/60">SOL</span>
          ) : (
            <div className="flex items-center gap-1.5">
              {tokenImage && (
                <img
                  src={tokenImage}
                  alt={tokenSymbol}
                  className="w-4 h-4 rounded-full"
                />
              )}
              <span className="text-sm font-medium text-white/60">
                {tokenSymbol}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Quick Select Buttons */}
      <div className="flex gap-1.5">
        {isBuy
          ? quickBuyPresets.map((preset) => (
              <button
                key={preset}
                onClick={() => onQuickBuyPresetClick(preset)}
                className={cn(
                  "flex-1 py-1.5 text-xs font-medium rounded-md transition-colors",
                  "bg-white/5 text-white/60 hover:bg-white/10 hover:text-white/80",
                  buyAmountSol === preset &&
                    "bg-emerald-500/15 text-emerald-400 border border-emerald-500/30"
                )}
              >
                {preset} SOL
              </button>
            ))
          : sellQuickPercents.map((percent) => (
              <button
                key={percent}
                onClick={() => onSellPercentClick(percent)}
                className={cn(
                  "flex-1 py-1.5 text-xs font-medium rounded-md transition-colors",
                  "bg-white/5 text-white/60 hover:bg-white/10 hover:text-white/80"
                )}
              >
                {percent === 100 ? "MAX" : `${percent}%`}
              </button>
            ))}
      </div>

      {/* Divider */}
      <div className="h-px bg-white/10" />

      {/* Order Details */}
      <div className="flex flex-col gap-2 text-xs">
        <DetailRow
          label="You Receive"
          value={
            isQuoteLoading ? (
              <Loader2 className="w-3 h-3 animate-spin text-white/40" />
            ) : (
              <span className="text-white font-medium">
                {jupiterOutputFormatted}{" "}
                <span className="text-white/50">
                  {isBuy ? tokenSymbol : "SOL"}
                </span>
              </span>
            )
          }
        />
        <DetailRow
          label="Min Receive"
          value={
            <span className="text-white/60">
              {jupiterMinReceiveFormatted}{" "}
              <span className="text-white/40">
                {isBuy ? tokenSymbol : "SOL"}
              </span>
            </span>
          }
        />
        <DetailRow
          label="Slippage"
          value={
            <span className="text-white/60">
              {(slippageBps / 100).toFixed(1)}%
            </span>
          }
        />
        <DetailRow
          label="Routing"
          value={<span className="text-white/60">Jupiter</span>}
        />
        <DetailRow
          label="Fee"
          value={
            <span className="text-white/60">{jupiterPlatformFeeDisplay}</span>
          }
        />
        <DetailRow
          label="Price Impact"
          value={
            <span
              className={cn(
                "text-white/60",
                parseFloat(jupiterPriceImpactDisplay) > 3 && "text-red-400",
                parseFloat(jupiterPriceImpactDisplay) > 1 &&
                  parseFloat(jupiterPriceImpactDisplay) <= 3 &&
                  "text-yellow-400"
              )}
            >
              {jupiterPriceImpactDisplay}
            </span>
          }
        />
      </div>

      {/* Divider */}
      <div className="h-px bg-white/10" />

      {/* Execute Button */}
      {!walletConnected ? (
        <Button
          onClick={onConnectWallet}
          className="w-full h-12 text-sm font-semibold bg-white/10 hover:bg-white/15 text-white"
        >
          <Wallet className="w-4 h-4 mr-2" />
          Connect Wallet
        </Button>
      ) : (
        <Button
          onClick={onExecute}
          disabled={!canExecute || isExecuting}
          className={cn(
            "w-full h-12 text-sm font-bold transition-colors",
            isBuy
              ? "bg-emerald-500 hover:bg-emerald-600 text-white disabled:bg-emerald-500/30 disabled:text-white/40"
              : "bg-red-500 hover:bg-red-600 text-white disabled:bg-red-500/30 disabled:text-white/40"
          )}
        >
          {isExecuting ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              {jupiterStatusLabel || "Processing..."}
            </>
          ) : (
            <>
              {isBuy ? "Buy" : "Sell"} {tokenSymbol}
            </>
          )}
        </Button>
      )}

      {/* Available Balance */}
      <div className="flex items-center justify-between text-xs">
        <span className="text-white/40">Available to Trade</span>
        <span className="text-white/60 font-medium">{availableBalance}</span>
      </div>

      {/* Auto-confirm Toggle */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <Zap className="w-3.5 h-3.5 text-yellow-400" />
          <span className="text-xs text-white/60">Auto-confirm</span>
        </div>
        <Switch
          checked={autoConfirmEnabled}
          onCheckedChange={onAutoConfirmChange}
          className="data-[state=checked]:bg-yellow-500 scale-90"
        />
      </div>

      {/* Transaction Link */}
      {txSignature && (
        <a
          href={`https://solscan.io/tx/${txSignature}`}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center justify-center gap-1.5 text-xs text-white/40 hover:text-white/60 transition-colors py-1"
        >
          View on Solscan
          <ExternalLink className="w-3 h-3" />
        </a>
      )}
    </div>
  );
}

function DetailRow({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-white/40">{label}</span>
      {value}
    </div>
  );
}
