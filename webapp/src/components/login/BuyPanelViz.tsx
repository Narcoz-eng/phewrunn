import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useState } from "react";
import {
  ArrowDownUp,
  ChevronDown,
  Shield,
  TrendingDown,
  TrendingUp,
  Wallet,
  Zap,
} from "lucide-react";

interface MockTokenData {
  symbol: string;
  solAmount: string;
  receiveAmount: string;
  receiveUsd: string;
  payUsd: string;
  creatorFee: string;
  impact: string;
  minReceive: string;
}

const MOCK_TOKENS: MockTokenData[] = [
  {
    symbol: "WIF",
    solAmount: "0.5",
    receiveAmount: "274.32 WIF",
    receiveUsd: "~$91.40",
    payUsd: "~$91.20",
    creatorFee: "0.00255 SOL → you",
    impact: "0.04%",
    minReceive: "271.57 WIF",
  },
  {
    symbol: "BONK",
    solAmount: "0.25",
    receiveAmount: "22.4M BONK",
    receiveUsd: "~$45.60",
    payUsd: "~$45.50",
    creatorFee: "0.00128 SOL → you",
    impact: "0.02%",
    minReceive: "22.2M BONK",
  },
  {
    symbol: "PEPE",
    solAmount: "1",
    receiveAmount: "78.3M PEPE",
    receiveUsd: "~$183.20",
    payUsd: "~$182.80",
    creatorFee: "0.00510 SOL → you",
    impact: "0.06%",
    minReceive: "77.5M PEPE",
  },
];

const QUICK_PRESETS = ["0.1", "0.25", "0.5", "1"];

const panelSurface =
  "flex flex-col overflow-hidden rounded-2xl border border-slate-900/[0.08] bg-[linear-gradient(180deg,rgba(255,255,255,0.82),rgba(247,241,230,0.94))] shadow-[0_30px_80px_-52px_rgba(148,163,184,0.7)] ring-1 ring-white/65 dark:border-white/[0.07] dark:bg-[radial-gradient(circle_at_14%_0%,rgba(16,185,129,0.08),transparent_28%),radial-gradient(circle_at_100%_0%,rgba(59,130,246,0.08),transparent_24%),linear-gradient(180deg,rgba(8,12,20,0.98),rgba(4,8,14,0.99))] dark:shadow-none dark:ring-white/5";
const sectionBorder = "border-slate-900/[0.07] dark:border-white/[0.07]";
const mutedText = "text-slate-500 dark:text-white/58";
const fieldSurface =
  "border border-slate-900/[0.08] bg-white/75 text-slate-900 shadow-[inset_0_1px_0_rgba(255,255,255,0.75)] dark:border-white/[0.08] dark:bg-[linear-gradient(180deg,rgba(10,17,30,0.98),rgba(6,12,22,0.98))] dark:text-white dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]";
const chipSurface =
  "bg-slate-900/[0.05] text-slate-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.7)] dark:bg-[linear-gradient(180deg,rgba(13,20,34,0.98),rgba(8,14,24,0.98))] dark:text-white/82 dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]";
const softSection =
  "rounded-xl border border-slate-900/[0.06] bg-white/60 shadow-[inset_0_1px_0_rgba(255,255,255,0.72)] dark:border-white/[0.08] dark:bg-[linear-gradient(180deg,rgba(9,15,27,0.95),rgba(5,10,19,0.97))] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.035)]";

export function BuyPanelViz() {
  const [tokenIdx, setTokenIdx] = useState<number>(0);

  useEffect(() => {
    const iv = window.setInterval(() => {
      setTokenIdx((i) => (i + 1) % MOCK_TOKENS.length);
    }, 3400);
    return () => window.clearInterval(iv);
  }, []);

  const token = MOCK_TOKENS[tokenIdx]!;

  return (
    <div className={panelSurface}>
      {/* Buy / Sell Toggle */}
      <div className={`grid grid-cols-2 border-b ${sectionBorder}`}>
        {/* Buy — active */}
        <div className="relative py-3 text-sm font-semibold tracking-wide text-emerald-400">
          <span className="relative z-10 flex items-center justify-center gap-1.5">
            <TrendingUp className="w-3.5 h-3.5" />
            Buy
          </span>
          <div className="absolute inset-x-0 bottom-0 h-0.5 bg-gradient-to-r from-emerald-500/0 via-emerald-400 to-emerald-500/0" />
          <div className="absolute inset-0 bg-gradient-to-b from-emerald-500/[0.08] to-transparent" />
        </div>
        {/* Sell — inactive */}
        <div className="relative py-3 text-sm font-semibold tracking-wide text-slate-500 dark:text-white/35">
          <span className="relative z-10 flex items-center justify-center gap-1.5">
            <TrendingDown className="w-3.5 h-3.5" />
            Sell
          </span>
        </div>
      </div>

      <div className="flex flex-col gap-3 p-4">
        {/* You Pay */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className={`text-[11px] font-medium uppercase tracking-widest ${mutedText}`}>
              You Pay
            </span>
            <span className="text-[11px] text-slate-400 dark:text-white/32">
              Balance:{" "}
              <span className="font-medium text-slate-600 dark:text-white/60">2.3491 SOL</span>
            </span>
          </div>
          <div className={`flex items-center rounded-xl h-14 px-4 ${fieldSurface}`}>
            <AnimatePresence mode="wait">
              <motion.span
                key={tokenIdx}
                className="text-xl font-semibold flex-1"
                initial={{ opacity: 0, y: -5 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 5 }}
                transition={{ duration: 0.22 }}
              >
                {token.solAmount}
              </motion.span>
            </AnimatePresence>
            <div className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 ${chipSurface}`}>
              <div className="w-4 h-4 rounded-full bg-gradient-to-br from-[#9945FF] to-[#14F195] flex items-center justify-center">
                <span className="text-[8px] font-bold text-white">S</span>
              </div>
              <span className="text-xs font-semibold text-slate-700 dark:text-white/70">SOL</span>
            </div>
          </div>
          <div className="flex items-center justify-between text-[10px] text-slate-400 dark:text-white/32">
            <span>Spend value</span>
            <AnimatePresence mode="wait">
              <motion.span
                key={tokenIdx}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.18 }}
              >
                {token.payUsd}
              </motion.span>
            </AnimatePresence>
          </div>
        </div>

        {/* Quick presets */}
        <div className="grid grid-cols-4 gap-1.5">
          {QUICK_PRESETS.map((preset) => (
            <div
              key={preset}
              className={`py-2 text-[11px] font-semibold rounded-lg text-center select-none ${
                preset === token.solAmount
                  ? "bg-emerald-500/15 text-emerald-400 ring-1 ring-emerald-500/30"
                  : "bg-slate-900/[0.04] text-slate-500 dark:bg-white/[0.04] dark:text-white/50"
              }`}
            >
              {preset}
            </div>
          ))}
        </div>

        {/* Swap arrow */}
        <div className="flex items-center gap-3">
          <div className="h-px flex-1 bg-slate-900/[0.08] dark:bg-white/[0.06]" />
          <div className="flex items-center justify-center w-8 h-8 rounded-full border border-emerald-500/20 bg-emerald-500/[0.06] text-emerald-400">
            <ArrowDownUp className="w-3.5 h-3.5" />
          </div>
          <div className="h-px flex-1 bg-slate-900/[0.08] dark:bg-white/[0.06]" />
        </div>

        {/* You Receive */}
        <div className="space-y-2">
          <span className={`text-[11px] font-medium uppercase tracking-widest ${mutedText}`}>
            You Receive
          </span>
          <div className={`flex items-center justify-between rounded-xl px-4 py-3.5 ${fieldSurface}`}>
            <AnimatePresence mode="wait">
              <motion.span
                key={tokenIdx}
                className="text-lg font-semibold text-slate-900 dark:text-white"
                initial={{ opacity: 0, y: -5 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 5 }}
                transition={{ duration: 0.22 }}
              >
                {token.receiveAmount}
              </motion.span>
            </AnimatePresence>
            <div className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 ${chipSurface}`}>
              <div className="flex h-4 w-4 items-center justify-center rounded-full bg-slate-900/10 text-[8px] font-bold text-slate-500 dark:bg-white/10 dark:text-white/50">
                {token.symbol.charAt(0)}
              </div>
              <AnimatePresence mode="wait">
                <motion.span
                  key={tokenIdx}
                  className="text-xs font-semibold text-slate-700 dark:text-white/70"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.18 }}
                >
                  {token.symbol}
                </motion.span>
              </AnimatePresence>
            </div>
          </div>
          <div className="flex items-center justify-between text-[10px] text-slate-400 dark:text-white/32">
            <span>Quoted receive value</span>
            <AnimatePresence mode="wait">
              <motion.span
                key={tokenIdx}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.18 }}
              >
                {token.receiveUsd}
              </motion.span>
            </AnimatePresence>
          </div>
        </div>

        {/* Slippage / details row */}
        <div className="flex items-center justify-between rounded-lg border border-slate-900/[0.06] bg-white/60 px-3 py-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.7)] dark:border-white/[0.08] dark:bg-[linear-gradient(180deg,rgba(10,17,29,0.96),rgba(6,11,20,0.98))] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.035)]">
          <div className="flex items-center gap-2 text-[11px] text-slate-500 dark:text-white/65">
            <Shield className="w-3 h-3" />
            <span>
              Slippage 1.0%
              <span className="ml-2 text-emerald-400">Impact {token.impact}</span>
            </span>
          </div>
          <ChevronDown className="w-3.5 h-3.5 text-slate-400 dark:text-white/30" />
        </div>

        {/* Trade details */}
        <div className={`space-y-1.5 p-3 ${softSection}`}>
          <div className="flex items-center justify-between text-[11px]">
            <span className="text-slate-500 dark:text-white/55">Min. Received</span>
            <AnimatePresence mode="wait">
              <motion.span
                key={tokenIdx}
                className="font-medium text-slate-600 dark:text-white/72"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.18 }}
              >
                {token.minReceive}
              </motion.span>
            </AnimatePresence>
          </div>
          <div className="flex items-center justify-between text-[11px]">
            <span className="text-slate-500 dark:text-white/55">Route</span>
            <span className="font-medium text-slate-600 dark:text-white/72">Jupiter v6</span>
          </div>
          <div className="flex items-center justify-between text-[11px]">
            <span className="text-slate-500 dark:text-white/55">Creator Reward</span>
            <AnimatePresence mode="wait">
              <motion.span
                key={tokenIdx}
                className="font-semibold text-emerald-500"
                initial={{ scale: 1.08, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.22 }}
              >
                {token.creatorFee}
              </motion.span>
            </AnimatePresence>
          </div>
        </div>

        {/* Connect Wallet button */}
        <div className="w-full h-12 text-sm font-semibold rounded-xl flex items-center justify-center gap-2 border border-emerald-200/70 bg-gradient-to-r from-emerald-300/95 via-teal-300/90 to-cyan-300/95 text-[#04251f] shadow-[0_20px_44px_-24px_rgba(45,212,191,0.9)] dark:border-white/[0.1] dark:from-white/[0.08] dark:to-white/[0.04] dark:text-white dark:shadow-none dark:bg-gradient-to-r">
          <Wallet className="w-4 h-4" />
          Connect Wallet
        </div>

        {/* Instant toggle */}
        <div className="flex items-center gap-2 pt-0.5">
          <Zap className="w-3 h-3 text-slate-400 dark:text-white/25" />
          <span className="text-[11px] text-slate-500 dark:text-white/40">Instant</span>
          <div className="w-7 h-4 rounded-full bg-slate-200 dark:bg-white/10 ml-1 relative flex-shrink-0">
            <div className="absolute left-0.5 top-0.5 w-3 h-3 rounded-full bg-white shadow-sm" />
          </div>
        </div>
      </div>
    </div>
  );
}
