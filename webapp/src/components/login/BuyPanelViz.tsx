import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useState } from "react";
import {
  ArrowDownUp,
  AlertTriangle,
  BadgeCheck,
  BarChart2,
  ChevronDown,
  Droplets,
  Flame,
  Shield,
  Star,
  TrendingDown,
  TrendingUp,
  Wallet,
  Zap,
} from "lucide-react";
import { LevelBadge } from "@/components/feed/LevelBar";

interface SignalDef {
  icon: React.ElementType;
  label: string;
  color: string;
  bg: string;
  border: string;
}

const SIGNAL_DEFS: Record<string, SignalDef> = {
  early_runner: {
    icon: TrendingUp,
    label: "Early Runner",
    color: "text-emerald-400",
    bg: "bg-emerald-500/10",
    border: "border-emerald-500/25",
  },
  hot_alpha: {
    icon: Flame,
    label: "Hot Alpha",
    color: "text-orange-400",
    bg: "bg-orange-500/10",
    border: "border-orange-500/25",
  },
  high_conviction: {
    icon: Star,
    label: "High Conviction",
    color: "text-violet-400",
    bg: "bg-violet-500/10",
    border: "border-violet-500/25",
  },
  liquidity_spike: {
    icon: Droplets,
    label: "Liq Spike",
    color: "text-cyan-400",
    bg: "bg-cyan-500/10",
    border: "border-cyan-500/25",
  },
  volume_spike: {
    icon: BarChart2,
    label: "Vol Spike",
    color: "text-amber-400",
    bg: "bg-amber-500/10",
    border: "border-amber-500/25",
  },
  bundle_risk: {
    icon: AlertTriangle,
    label: "Bundle Risk",
    color: "text-amber-400",
    bg: "bg-amber-500/10",
    border: "border-amber-500/25",
  },
};

interface MockTokenData {
  symbol: string;
  caller: string;
  displayName: string;
  avatarUrl: string;
  callText: string;
  level: number;
  signals: string[];
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
    caller: "cryptosage",
    displayName: "CryptoSage",
    avatarUrl: "https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=80&h=80&fit=crop&crop=face",
    callText: "$WIF — accumulating here at 0.35, expecting move to 0.55+. Degen size.",
    level: 7,
    signals: ["early_runner", "high_conviction"],
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
    caller: "alpha_hound",
    displayName: "AlphaHound",
    avatarUrl: "https://images.unsplash.com/photo-1599566150163-29194dcabd9c?w=80&h=80&fit=crop&crop=face",
    callText: "$BONK breaking out of 3-week range. Vol spike + whale accumulation confirmed.",
    level: 5,
    signals: ["volume_spike", "liquidity_spike", "hot_alpha"],
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
    caller: "onchain_oracle",
    displayName: "OnchainOracle",
    avatarUrl: "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=80&h=80&fit=crop&crop=face",
    callText: "$PEPE — CT sleeping on this. Supply shock incoming, chart looks clean.",
    level: 9,
    signals: ["hot_alpha", "early_runner"],
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

const AVATAR_COLORS: Record<string, string> = {
  cryptosage: "from-violet-500 to-indigo-500",
  alpha_hound: "from-orange-500 to-amber-400",
  onchain_oracle: "from-emerald-500 to-teal-400",
};

const panelSurface =
  "flex flex-col overflow-hidden rounded-b-2xl border-t-0 border border-white/[0.06] bg-[radial-gradient(circle_at_14%_0%,rgba(16,185,129,0.06),transparent_28%),linear-gradient(180deg,rgba(8,12,20,0.98),rgba(4,8,14,0.99))]";
const sectionBorder = "border-white/[0.07]";
const mutedText = "text-white/55";
const fieldSurface =
  "border border-white/[0.08] bg-[linear-gradient(180deg,rgba(10,17,30,0.98),rgba(6,12,22,0.98))] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]";
const chipSurface =
  "bg-[linear-gradient(180deg,rgba(13,20,34,0.98),rgba(8,14,24,0.98))] text-white/82 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]";
const softSection =
  "rounded-xl border border-white/[0.07] bg-[linear-gradient(180deg,rgba(9,15,27,0.95),rgba(5,10,19,0.97))] shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]";

function SignalChip({ signalKey }: { signalKey: string }) {
  const def = SIGNAL_DEFS[signalKey];
  if (!def) return null;
  const Icon = def.icon;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${def.bg} ${def.border} ${def.color}`}
    >
      <Icon className="w-2.5 h-2.5" />
      {def.label}
    </span>
  );
}

export function BuyPanelViz() {
  const [tokenIdx, setTokenIdx] = useState<number>(0);
  const [execPing, setExecPing] = useState(false);

  useEffect(() => {
    const iv = window.setInterval(() => {
      setExecPing(true);
      setTimeout(() => setExecPing(false), 600);
      setTokenIdx((i) => (i + 1) % MOCK_TOKENS.length);
    }, 3400);
    return () => window.clearInterval(iv);
  }, []);

  const token = MOCK_TOKENS[tokenIdx]!;

  return (
    <div className="rounded-[22px] border border-white/[0.08] bg-[linear-gradient(180deg,rgba(10,16,28,0.97),rgba(6,10,18,0.99))] shadow-[0_0_48px_-8px_rgba(16,185,129,0.18),0_0_0_1px_rgba(255,255,255,0.04)] overflow-hidden">

      {/* ── Post header ── */}
      <div className="px-4 pt-4 pb-3 border-b border-white/[0.06]">
        {/* Top row: avatar + name + level + LIVE */}
        <div className="flex items-center justify-between mb-2.5">
          <div className="flex items-center gap-2.5">
            {/* Avatar */}
            <AnimatePresence mode="wait">
              <motion.div
                key={tokenIdx}
                className="relative w-9 h-9 rounded-full flex-shrink-0 ring-2 ring-emerald-500/20 ring-offset-1 ring-offset-[rgba(10,16,28,0.97)]"
                initial={{ opacity: 0, scale: 0.85 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.85 }}
                transition={{ duration: 0.2 }}
              >
                <img
                  src={token.avatarUrl}
                  alt={token.displayName}
                  className="w-full h-full rounded-full object-cover"
                />
                <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full bg-emerald-400 border-2 border-[rgba(10,16,28,0.97)]" />
              </motion.div>
            </AnimatePresence>

            {/* Name + level */}
            <div>
              <AnimatePresence mode="wait">
                <motion.div
                  key={tokenIdx}
                  className="flex items-center gap-1.5"
                  initial={{ opacity: 0, x: -4 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.18 }}
                >
                  <span className="text-[13px] font-semibold text-white/90">@{token.displayName}</span>
                  <BadgeCheck className="w-3.5 h-3.5 text-emerald-400" />
                  <LevelBadge level={token.level} size="sm" />
                </motion.div>
              </AnimatePresence>
              <span className="text-[10px] text-white/35">2m ago</span>
            </div>
          </div>

          {/* LIVE badge */}
          <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/25 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-400">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 inline-block animate-pulse" />
            LIVE
          </span>
        </div>

        {/* Call text */}
        <AnimatePresence mode="wait">
          <motion.p
            key={tokenIdx}
            className="text-[13px] text-white/72 leading-snug mb-2.5"
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.22 }}
          >
            {token.callText}
          </motion.p>
        </AnimatePresence>

        {/* Market signals strip */}
        <AnimatePresence mode="wait">
          <motion.div
            key={tokenIdx}
            className="flex items-center gap-1.5 flex-wrap"
            initial={{ opacity: 0, y: 3 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
          >
            {token.signals.map((sig) => (
              <SignalChip key={sig} signalKey={sig} />
            ))}
          </motion.div>
        </AnimatePresence>
      </div>

      {/* ── Panel label ── */}
      <div className="flex items-center gap-2 px-4 py-2 bg-emerald-500/[0.05] border-b border-emerald-500/[0.08]">
        <Zap className="w-3 h-3 text-emerald-400" />
        <span className="text-[10px] font-semibold uppercase tracking-widest text-emerald-400/80">
          Integrated trading panel
        </span>
      </div>

      {/* ── Trading panel UI ── */}
      <div className={panelSurface}>
        {/* Buy / Sell Toggle */}
        <div className={`grid grid-cols-2 border-b ${sectionBorder}`}>
          <div className="relative py-3 text-sm font-semibold tracking-wide text-emerald-400">
            <span className="relative z-10 flex items-center justify-center gap-1.5">
              <TrendingUp className="w-3.5 h-3.5" />
              Buy
            </span>
            <div className="absolute inset-x-0 bottom-0 h-0.5 bg-gradient-to-r from-emerald-500/0 via-emerald-400 to-emerald-500/0" />
            <div className="absolute inset-0 bg-gradient-to-b from-emerald-500/[0.08] to-transparent" />
          </div>
          <div className="relative py-3 text-sm font-semibold tracking-wide text-white/35">
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
              <span className="text-[11px] text-white/32">
                Balance:{" "}
                <span className="font-medium text-white/60">2.3491 SOL</span>
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
                <span className="text-xs font-semibold text-white/70">SOL</span>
              </div>
            </div>
            <div className="flex items-center justify-between text-[10px] text-white/32">
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
                    : "bg-white/[0.04] text-white/50"
                }`}
              >
                {preset}
              </div>
            ))}
          </div>

          {/* Swap arrow */}
          <div className="flex items-center gap-3">
            <div className="h-px flex-1 bg-white/[0.06]" />
            <div className="flex items-center justify-center w-8 h-8 rounded-full border border-emerald-500/20 bg-emerald-500/[0.06] text-emerald-400">
              <ArrowDownUp className="w-3.5 h-3.5" />
            </div>
            <div className="h-px flex-1 bg-white/[0.06]" />
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
                  className="text-lg font-semibold text-white"
                  initial={{ opacity: 0, y: -5 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 5 }}
                  transition={{ duration: 0.22 }}
                >
                  {token.receiveAmount}
                </motion.span>
              </AnimatePresence>
              <div className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 ${chipSurface}`}>
                <div className="flex h-4 w-4 items-center justify-center rounded-full bg-white/10 text-[8px] font-bold text-white/50">
                  {token.symbol.charAt(0)}
                </div>
                <AnimatePresence mode="wait">
                  <motion.span
                    key={tokenIdx}
                    className="text-xs font-semibold text-white/70"
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
            <div className="flex items-center justify-between text-[10px] text-white/32">
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

          {/* Slippage row */}
          <div className="flex items-center justify-between rounded-lg border border-white/[0.07] bg-[linear-gradient(180deg,rgba(10,17,29,0.96),rgba(6,11,20,0.98))] px-3 py-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
            <div className="flex items-center gap-2 text-[11px] text-white/60">
              <Shield className="w-3 h-3" />
              <span>
                Slippage 1.0%
                <span className="ml-2 text-emerald-400">Impact {token.impact}</span>
              </span>
            </div>
            <ChevronDown className="w-3.5 h-3.5 text-white/30" />
          </div>

          {/* Trade details */}
          <div className={`space-y-1.5 p-3 ${softSection}`}>
            <div className="flex items-center justify-between text-[11px]">
              <span className="text-white/55">Min. Received</span>
              <AnimatePresence mode="wait">
                <motion.span
                  key={tokenIdx}
                  className="font-medium text-white/72"
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
              <span className="text-white/55">Route</span>
              <span className="font-medium text-white/72">Jupiter v6</span>
            </div>
            <div className="flex items-center justify-between text-[11px]">
              <span className="text-white/55">Creator Reward</span>
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

          {/* CTA button */}
          <div className="w-full h-12 text-sm font-semibold rounded-xl flex items-center justify-center gap-2 border border-white/[0.1] bg-gradient-to-r from-white/[0.08] to-white/[0.04] text-white">
            <Wallet className="w-4 h-4" />
            Connect Wallet
          </div>

          {/* Speed badge row */}
          <div className="flex items-center justify-between pt-0.5">
            <div className="flex items-center gap-2">
              <Zap className="w-3 h-3 text-white/25" />
              <span className="text-[11px] text-white/40">Instant</span>
              <div className="w-7 h-4 rounded-full bg-white/10 ml-1 relative flex-shrink-0">
                <div className="absolute left-0.5 top-0.5 w-3 h-3 rounded-full bg-white/60 shadow-sm" />
              </div>
            </div>
            <motion.span
              animate={{ opacity: execPing ? 1 : 0.55 }}
              transition={{ duration: 0.25 }}
              className="inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-400"
            >
              <Zap className="w-2.5 h-2.5" />
              ~180ms avg exec
            </motion.span>
          </div>
        </div>
      </div>
    </div>
  );
}
