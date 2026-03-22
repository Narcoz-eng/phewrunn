import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useState, useMemo } from "react";
import {
  AlertTriangle,
  BadgeCheck,
  BarChart2,
  ChevronDown,
  CircleAlert,
  Crosshair,
  Droplets,
  Flame,
  Lock,
  Shield,
  ShieldCheck,
  Star,
  Target,
  TrendingDown,
  TrendingUp,
  Wallet,
  Zap,
} from "lucide-react";
import { LevelBadge } from "@/components/feed/LevelBar";

/* ─── Signal definitions ─── */

interface SignalDef {
  icon: React.ElementType;
  label: string;
  color: string;
  bg: string;
  border: string;
}

const SIGNAL_DEFS: Record<string, SignalDef> = {
  early_runner: { icon: TrendingUp, label: "Early Runner", color: "text-emerald-400", bg: "bg-emerald-500/10", border: "border-emerald-500/25" },
  hot_alpha: { icon: Flame, label: "Hot Alpha", color: "text-orange-400", bg: "bg-orange-500/10", border: "border-orange-500/25" },
  high_conviction: { icon: Star, label: "High Conviction", color: "text-violet-400", bg: "bg-violet-500/10", border: "border-violet-500/25" },
  liquidity_spike: { icon: Droplets, label: "Liq Spike", color: "text-cyan-400", bg: "bg-cyan-500/10", border: "border-cyan-500/25" },
  volume_spike: { icon: BarChart2, label: "Vol Spike", color: "text-amber-400", bg: "bg-amber-500/10", border: "border-amber-500/25" },
  bundle_risk: { icon: AlertTriangle, label: "Bundle Risk", color: "text-amber-400", bg: "bg-amber-500/10", border: "border-amber-500/25" },
};

/* ─── Token data ─── */

interface MockTokenData {
  symbol: string;
  displayName: string;
  avatarUrl: string;
  callText: string;
  level: number;
  signals: string[];
  price: number;
  balance: string;
  balanceUsd: string;
  quantity: number;
  sliderPct: number;
  orderValue: string;
  creatorFee: string;
  impact: string;
  minReceive: string;
  stopLoss: string;
  stopLossPct: string;
  takeProfit: string;
  takeProfitPct: string;
  orderBook: { price: string; size: string; total: string; side: "bid" | "ask" }[];
}

const MOCK_TOKENS: MockTokenData[] = [
  {
    symbol: "WIF",
    displayName: "CryptoSage",
    avatarUrl: "https://api.dicebear.com/7.x/notionists/svg?seed=CryptoSage&backgroundColor=0a0a0f",
    callText: "$WIF — accumulating here at 0.35, expecting move to 0.55+. Degen size.",
    level: 7,
    signals: ["early_runner", "high_conviction"],
    price: 0.3521,
    balance: "705.33 USD",
    balanceUsd: "705.33",
    quantity: 274.32,
    sliderPct: 42,
    orderValue: "96.60",
    creatorFee: "0.00255 SOL",
    impact: "0.04%",
    minReceive: "271.57 WIF",
    stopLoss: "0.2985",
    stopLossPct: "-15%",
    takeProfit: "0.5500",
    takeProfitPct: "+56%",
    orderBook: [
      { price: "0.3580", size: "3.11", total: "2,589.91", side: "ask" },
      { price: "0.3564", size: "334.27", total: "2,586.90", side: "ask" },
      { price: "0.3553", size: "149.68", total: "2,252.63", side: "ask" },
      { price: "0.3542", size: "40.65", total: "2,081.63", side: "ask" },
      { price: "0.3531", size: "477.32", total: "2,033.28", side: "ask" },
      { price: "0.3521", size: "658.01", total: "1,555.96", side: "bid" },
      { price: "0.3510", size: "284.49", total: "574.32", side: "bid" },
      { price: "0.3498", size: "321.53", total: "897.95", side: "bid" },
      { price: "0.3485", size: "127.32", total: "291.63", side: "bid" },
      { price: "0.3470", size: "55.30", total: "55.30", side: "bid" },
    ],
  },
  {
    symbol: "BONK",
    displayName: "AlphaHound",
    avatarUrl: "https://api.dicebear.com/7.x/notionists/svg?seed=AlphaHound&backgroundColor=0a0a0f",
    callText: "$BONK breaking out of 3-week range. Vol spike + whale accumulation confirmed.",
    level: 5,
    signals: ["volume_spike", "liquidity_spike", "hot_alpha"],
    price: 0.00002034,
    balance: "412.80 USD",
    balanceUsd: "412.80",
    quantity: 22400000,
    sliderPct: 28,
    orderValue: "45.56",
    creatorFee: "0.00128 SOL",
    impact: "0.02%",
    minReceive: "22.2M BONK",
    stopLoss: "0.00001730",
    stopLossPct: "-15%",
    takeProfit: "0.00003200",
    takeProfitPct: "+57%",
    orderBook: [
      { price: "0.00002098", size: "12.4M", total: "84.2M", side: "ask" },
      { price: "0.00002078", size: "8.9M", total: "71.8M", side: "ask" },
      { price: "0.00002061", size: "15.2M", total: "62.9M", side: "ask" },
      { price: "0.00002048", size: "6.3M", total: "47.7M", side: "ask" },
      { price: "0.00002041", size: "18.1M", total: "41.4M", side: "ask" },
      { price: "0.00002034", size: "23.3M", total: "23.3M", side: "bid" },
      { price: "0.00002028", size: "9.7M", total: "16.8M", side: "bid" },
      { price: "0.00002019", size: "11.2M", total: "33.0M", side: "bid" },
      { price: "0.00002008", size: "7.1M", total: "22.4M", side: "bid" },
      { price: "0.00001994", size: "4.5M", total: "4.5M", side: "bid" },
    ],
  },
  {
    symbol: "PEPE",
    displayName: "OnchainOracle",
    avatarUrl: "https://api.dicebear.com/7.x/notionists/svg?seed=OnchainOracle&backgroundColor=0a0a0f",
    callText: "$PEPE — CT sleeping on this. Supply shock incoming, chart looks clean.",
    level: 9,
    signals: ["hot_alpha", "early_runner"],
    price: 0.00001183,
    balance: "1,247.60 USD",
    balanceUsd: "1,247.60",
    quantity: 78300000,
    sliderPct: 65,
    orderValue: "183.20",
    creatorFee: "0.00510 SOL",
    impact: "0.06%",
    minReceive: "77.5M PEPE",
    stopLoss: "0.00001005",
    stopLossPct: "-15%",
    takeProfit: "0.00001890",
    takeProfitPct: "+60%",
    orderBook: [
      { price: "0.00001215", size: "42.1M", total: "192.4M", side: "ask" },
      { price: "0.00001205", size: "28.7M", total: "150.3M", side: "ask" },
      { price: "0.00001198", size: "35.9M", total: "121.6M", side: "ask" },
      { price: "0.00001192", size: "19.4M", total: "85.7M", side: "ask" },
      { price: "0.00001187", size: "22.8M", total: "66.3M", side: "ask" },
      { price: "0.00001183", size: "43.5M", total: "43.5M", side: "bid" },
      { price: "0.00001178", size: "31.2M", total: "58.6M", side: "bid" },
      { price: "0.00001170", size: "18.9M", total: "72.1M", side: "bid" },
      { price: "0.00001162", size: "14.6M", total: "48.2M", side: "bid" },
      { price: "0.00001154", size: "8.3M", total: "8.3M", side: "bid" },
    ],
  },
];

/* ─── Sub-components ─── */

function SignalChip({ signalKey }: { signalKey: string }) {
  const def = SIGNAL_DEFS[signalKey];
  if (!def) return null;
  const Icon = def.icon;
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${def.bg} ${def.border} ${def.color}`}>
      <Icon className="w-2.5 h-2.5" />
      {def.label}
    </span>
  );
}

function OrderBookRow({
  row,
  maxTotal,
  animate: shouldAnimate,
}: {
  row: { price: string; size: string; total: string; side: "bid" | "ask" };
  maxTotal: number;
  animate: boolean;
}) {
  const totalNum = parseFloat(row.total.replace(/,/g, "")) || 1;
  const depthPct = Math.min((totalNum / maxTotal) * 100, 100);

  return (
    <motion.div
      className="relative grid grid-cols-3 text-[11px] font-mono tabular-nums py-[3px] px-3"
      initial={shouldAnimate ? { opacity: 0 } : false}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.2 }}
    >
      {/* Depth bar */}
      <div
        className={`absolute inset-y-0 ${row.side === "bid" ? "right-0 bg-emerald-500/[0.08]" : "right-0 bg-rose-500/[0.08]"}`}
        style={{ width: `${depthPct}%` }}
      />
      <span className={`relative z-10 ${row.side === "bid" ? "text-emerald-400" : "text-rose-400"}`}>
        {row.price}
      </span>
      <span className="relative z-10 text-right text-white/60">{row.size}</span>
      <span className="relative z-10 text-right text-white/40">{row.total}</span>
    </motion.div>
  );
}

/* ─── Main component ─── */

export function BuyPanelViz() {
  const [tokenIdx, setTokenIdx] = useState<number>(0);
  const [orderType, setOrderType] = useState<"limit" | "market">("market");
  const [mevEnabled, setMevEnabled] = useState(true);
  const [stopLossEnabled, setStopLossEnabled] = useState(true);
  const [execPing, setExecPing] = useState(false);

  useEffect(() => {
    const iv = window.setInterval(() => {
      setExecPing(true);
      setTimeout(() => setExecPing(false), 600);
      setTokenIdx((i) => (i + 1) % MOCK_TOKENS.length);
    }, 4200);
    return () => window.clearInterval(iv);
  }, []);

  const token = MOCK_TOKENS[tokenIdx]!;

  const maxTotal = useMemo(() => {
    return Math.max(...token.orderBook.map((r) => parseFloat(r.total.replace(/,/g, "")) || 0));
  }, [token.orderBook]);

  const asks = token.orderBook.filter((r) => r.side === "ask").reverse();
  const bids = token.orderBook.filter((r) => r.side === "bid");

  return (
    <div className="rounded-[22px] border border-white/[0.08] bg-[linear-gradient(180deg,rgba(10,16,28,0.97),rgba(6,10,18,0.99))] shadow-[0_0_48px_-8px_rgba(16,185,129,0.18),0_0_0_1px_rgba(255,255,255,0.04)] overflow-hidden">

      {/* ── Post header ── */}
      <div className="px-4 pt-4 pb-3 border-b border-white/[0.06]">
        <div className="flex items-center justify-between mb-2.5">
          <div className="flex items-center gap-2.5">
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
                  className="w-full h-full rounded-full object-cover bg-white/5"
                />
                <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full bg-emerald-400 border-2 border-[rgba(10,16,28,0.97)]" />
              </motion.div>
            </AnimatePresence>
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
          <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/25 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-400">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 inline-block animate-pulse" />
            LIVE
          </span>
        </div>

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

      {/* ── Two-column: Order Book + Trading Form ── */}
      <div className="flex flex-col overflow-hidden border-t-0 border border-white/[0.06] border-t-transparent rounded-b-2xl bg-[radial-gradient(circle_at_14%_0%,rgba(16,185,129,0.06),transparent_28%),linear-gradient(180deg,rgba(8,12,20,0.98),rgba(4,8,14,0.99))]">
        <div className="grid grid-cols-[1fr_1fr] min-h-0">

          {/* ── Left: Order Book ── */}
          <div className="border-r border-white/[0.06] flex flex-col">
            {/* Book / Trades tabs */}
            <div className="flex items-center border-b border-white/[0.06]">
              <div className="px-3 py-2 text-[11px] font-semibold text-emerald-400 border-b border-emerald-400">
                Book
              </div>
              <div className="px-3 py-2 text-[11px] font-medium text-white/35">
                Trades
              </div>
            </div>

            {/* Column headers */}
            <div className="grid grid-cols-3 text-[9px] font-semibold uppercase tracking-wider text-white/30 px-3 py-1.5 border-b border-white/[0.05]">
              <span>Price (USD)</span>
              <span className="text-right">Size</span>
              <span className="text-right">Total</span>
            </div>

            {/* Asks (sells) — top half */}
            <div className="flex flex-col">
              {asks.map((row, i) => (
                <OrderBookRow key={`ask-${i}`} row={row} maxTotal={maxTotal} animate={i < 2} />
              ))}
            </div>

            {/* Spread / mid price */}
            <AnimatePresence mode="wait">
              <motion.div
                key={tokenIdx}
                className="flex items-center justify-between px-3 py-1.5 bg-white/[0.02] border-y border-white/[0.05]"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2 }}
              >
                <span className="text-[12px] font-bold text-emerald-400 font-mono">
                  {token.price < 0.01 ? token.price.toFixed(8) : token.price.toFixed(4)}
                </span>
                <span className="text-[9px] text-emerald-400/60 font-medium">
                  +0.44%
                </span>
              </motion.div>
            </AnimatePresence>

            {/* Bids (buys) — bottom half */}
            <div className="flex flex-col">
              {bids.map((row, i) => (
                <OrderBookRow key={`bid-${i}`} row={row} maxTotal={maxTotal} animate={i < 2} />
              ))}
            </div>
          </div>

          {/* ── Right: Trading Form ── */}
          <div className="flex flex-col">

            {/* Buy / Sell Toggle */}
            <div className="grid grid-cols-2 border-b border-white/[0.07]">
              <div className="relative py-2.5 text-[13px] font-semibold tracking-wide text-emerald-400">
                <span className="relative z-10 flex items-center justify-center gap-1.5">
                  <TrendingUp className="w-3.5 h-3.5" />
                  Buy
                </span>
                <div className="absolute inset-x-0 bottom-0 h-0.5 bg-gradient-to-r from-emerald-500/0 via-emerald-400 to-emerald-500/0" />
                <div className="absolute inset-0 bg-gradient-to-b from-emerald-500/[0.08] to-transparent" />
              </div>
              <div className="relative py-2.5 text-[13px] font-semibold tracking-wide text-white/35">
                <span className="relative z-10 flex items-center justify-center gap-1.5">
                  <TrendingDown className="w-3.5 h-3.5" />
                  Sell
                </span>
              </div>
            </div>

            {/* Order type tabs: Limit / Market / Conditional */}
            <div className="flex items-center gap-0.5 px-3 py-2 border-b border-white/[0.05]">
              {(["limit", "market"] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setOrderType(t)}
                  className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition-all ${
                    orderType === t
                      ? "bg-white/[0.08] text-white ring-1 ring-white/[0.12]"
                      : "text-white/40 hover:text-white/60"
                  }`}
                >
                  {t.charAt(0).toUpperCase() + t.slice(1)}
                </button>
              ))}
              <span className="px-2.5 py-1 text-[11px] font-medium text-white/25 flex items-center gap-1">
                Conditional
                <ChevronDown className="w-3 h-3" />
              </span>
            </div>

            {/* Form body */}
            <div className="flex flex-col gap-2.5 p-3">

              {/* Balance */}
              <div className="flex items-center justify-between text-[10px]">
                <span className="text-white/35">Balance</span>
                <AnimatePresence mode="wait">
                  <motion.span
                    key={tokenIdx}
                    className="font-semibold text-white/70 font-mono"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.15 }}
                  >
                    {token.balance}
                  </motion.span>
                </AnimatePresence>
              </div>

              {/* Price input */}
              <div className="space-y-1">
                <span className="text-[10px] font-medium text-white/40 uppercase tracking-wider">Price</span>
                <div className="flex items-center rounded-lg h-10 border border-white/[0.08] bg-[linear-gradient(180deg,rgba(10,17,30,0.98),rgba(6,12,22,0.98))] shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
                  <div className="flex-1 px-3">
                    <AnimatePresence mode="wait">
                      <motion.span
                        key={tokenIdx}
                        className="text-[14px] font-semibold text-white font-mono"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.2 }}
                      >
                        {token.price < 0.01 ? token.price.toFixed(8) : token.price.toFixed(4)}
                      </motion.span>
                    </AnimatePresence>
                  </div>
                  {/* Price quick buttons */}
                  <div className="flex items-center gap-px pr-1.5">
                    <span className="flex items-center justify-center w-6 h-6 rounded text-[10px] font-semibold text-white/50 bg-white/[0.04] hover:bg-white/[0.08] transition-colors">
                      Mid
                    </span>
                    <span className="flex items-center justify-center w-7 h-6 rounded text-[9px] font-bold text-emerald-400/70 bg-emerald-500/[0.06] hover:bg-emerald-500/[0.12] transition-colors">
                      BBO
                    </span>
                  </div>
                </div>
              </div>

              {/* Quantity input */}
              <div className="space-y-1">
                <span className="text-[10px] font-medium text-white/40 uppercase tracking-wider">Quantity</span>
                <div className="flex items-center rounded-lg h-10 border border-white/[0.08] bg-[linear-gradient(180deg,rgba(10,17,30,0.98),rgba(6,12,22,0.98))] shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
                  <div className="flex-1 px-3">
                    <AnimatePresence mode="wait">
                      <motion.span
                        key={tokenIdx}
                        className="text-[14px] font-semibold text-white font-mono"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.2 }}
                      >
                        {token.quantity >= 1000000
                          ? `${(token.quantity / 1000000).toFixed(1)}M`
                          : token.quantity.toFixed(2)}
                      </motion.span>
                    </AnimatePresence>
                  </div>
                  <div className="flex items-center gap-1 pr-2">
                    <div className="flex h-5 w-5 items-center justify-center rounded-full bg-white/10 text-[8px] font-bold text-white/50">
                      {token.symbol.charAt(0)}
                    </div>
                    <AnimatePresence mode="wait">
                      <motion.span
                        key={tokenIdx}
                        className="text-[11px] font-semibold text-white/60"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                      >
                        {token.symbol}
                      </motion.span>
                    </AnimatePresence>
                  </div>
                </div>
              </div>

              {/* Slider */}
              <div className="space-y-1.5">
                <div className="relative h-1.5 rounded-full bg-white/[0.06] overflow-hidden">
                  <AnimatePresence mode="wait">
                    <motion.div
                      key={tokenIdx}
                      className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-emerald-500 to-emerald-400"
                      initial={{ width: "0%" }}
                      animate={{ width: `${token.sliderPct}%` }}
                      transition={{ duration: 0.6, ease: "easeOut" }}
                    />
                  </AnimatePresence>
                  {/* Thumb */}
                  <AnimatePresence mode="wait">
                    <motion.div
                      key={tokenIdx}
                      className="absolute top-1/2 -translate-y-1/2 w-3.5 h-3.5 rounded-full bg-white border-2 border-emerald-400 shadow-[0_0_8px_rgba(16,185,129,0.4)]"
                      initial={{ left: "0%" }}
                      animate={{ left: `${token.sliderPct}%` }}
                      transition={{ duration: 0.6, ease: "easeOut" }}
                      style={{ marginLeft: "-7px" }}
                    />
                  </AnimatePresence>
                </div>
                {/* Percentage markers */}
                <div className="flex items-center justify-between">
                  {[0, 25, 50, 75, 100].map((pct) => (
                    <span
                      key={pct}
                      className={`text-[9px] font-medium ${
                        pct <= token.sliderPct ? "text-emerald-400/60" : "text-white/20"
                      }`}
                    >
                      {pct}%
                    </span>
                  ))}
                </div>
              </div>

              {/* Order Value */}
              <div className="flex items-center justify-between rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2">
                <span className="text-[10px] text-white/40">Order Value</span>
                <AnimatePresence mode="wait">
                  <motion.div
                    key={tokenIdx}
                    className="flex items-center gap-1.5"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.18 }}
                  >
                    <span className="text-[14px] font-bold text-white font-mono">{token.orderValue}</span>
                    <div className="w-4 h-4 rounded-full bg-gradient-to-br from-[#9945FF] to-[#14F195] flex items-center justify-center">
                      <span className="text-[7px] font-bold text-white">$</span>
                    </div>
                  </motion.div>
                </AnimatePresence>
              </div>

              {/* MEV Protection */}
              <div className="rounded-lg border border-emerald-500/15 bg-emerald-500/[0.04] px-3 py-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="flex items-center justify-center w-5 h-5 rounded-md bg-emerald-500/15">
                      <ShieldCheck className="w-3 h-3 text-emerald-400" />
                    </div>
                    <div>
                      <span className="text-[11px] font-semibold text-emerald-400">MEV Protection</span>
                      <p className="text-[9px] text-white/35 leading-tight">Frontrun & sandwich guard</p>
                    </div>
                  </div>
                  <button
                    onClick={() => setMevEnabled(!mevEnabled)}
                    className={`relative w-8 h-[18px] rounded-full transition-colors ${
                      mevEnabled ? "bg-emerald-500/40" : "bg-white/10"
                    }`}
                  >
                    <motion.div
                      className={`absolute top-[2px] w-[14px] h-[14px] rounded-full shadow-sm ${
                        mevEnabled ? "bg-emerald-400" : "bg-white/50"
                      }`}
                      animate={{ left: mevEnabled ? 14 : 2 }}
                      transition={{ duration: 0.2 }}
                    />
                  </button>
                </div>
                {mevEnabled ? (
                  <div className="flex items-center gap-3 mt-1.5 pt-1.5 border-t border-emerald-500/10">
                    <div className="flex items-center gap-1 text-[9px] text-emerald-400/70">
                      <Lock className="w-2.5 h-2.5" />
                      <span>Private mempool</span>
                    </div>
                    <div className="flex items-center gap-1 text-[9px] text-emerald-400/70">
                      <Shield className="w-2.5 h-2.5" />
                      <span>Jito bundles</span>
                    </div>
                    <div className="flex items-center gap-1 text-[9px] text-emerald-400/70">
                      <Zap className="w-2.5 h-2.5" />
                      <span>Skip validators</span>
                    </div>
                  </div>
                ) : null}
              </div>

              {/* Stop Loss / Take Profit */}
              <div className="rounded-lg border border-amber-500/15 bg-amber-500/[0.03] px-3 py-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="flex items-center justify-center w-5 h-5 rounded-md bg-amber-500/15">
                      <Crosshair className="w-3 h-3 text-amber-400" />
                    </div>
                    <div>
                      <span className="text-[11px] font-semibold text-amber-400">Stop Loss / Take Profit</span>
                      <p className="text-[9px] text-white/35 leading-tight">Auto-exit on price triggers</p>
                    </div>
                  </div>
                  <button
                    onClick={() => setStopLossEnabled(!stopLossEnabled)}
                    className={`relative w-8 h-[18px] rounded-full transition-colors ${
                      stopLossEnabled ? "bg-amber-500/40" : "bg-white/10"
                    }`}
                  >
                    <motion.div
                      className={`absolute top-[2px] w-[14px] h-[14px] rounded-full shadow-sm ${
                        stopLossEnabled ? "bg-amber-400" : "bg-white/50"
                      }`}
                      animate={{ left: stopLossEnabled ? 14 : 2 }}
                      transition={{ duration: 0.2 }}
                    />
                  </button>
                </div>
                {stopLossEnabled ? (
                  <div className="mt-2 pt-2 border-t border-amber-500/10 space-y-1.5">
                    {/* Stop Loss */}
                    <div className="flex items-center gap-2">
                      <div className="flex items-center gap-1.5 flex-1">
                        <CircleAlert className="w-3 h-3 text-rose-400 flex-shrink-0" />
                        <span className="text-[10px] text-rose-400/80 font-medium w-10 flex-shrink-0">Stop</span>
                        <div className="flex-1 flex items-center rounded-md h-7 border border-rose-500/15 bg-rose-500/[0.04] px-2">
                          <AnimatePresence mode="wait">
                            <motion.span
                              key={tokenIdx}
                              className="text-[11px] font-semibold text-white/80 font-mono"
                              initial={{ opacity: 0 }}
                              animate={{ opacity: 1 }}
                              exit={{ opacity: 0 }}
                            >
                              {token.stopLoss}
                            </motion.span>
                          </AnimatePresence>
                        </div>
                      </div>
                      <span className="text-[10px] font-bold text-rose-400 font-mono w-8 text-right">{token.stopLossPct}</span>
                    </div>
                    {/* Take Profit */}
                    <div className="flex items-center gap-2">
                      <div className="flex items-center gap-1.5 flex-1">
                        <Target className="w-3 h-3 text-emerald-400 flex-shrink-0" />
                        <span className="text-[10px] text-emerald-400/80 font-medium w-10 flex-shrink-0">Target</span>
                        <div className="flex-1 flex items-center rounded-md h-7 border border-emerald-500/15 bg-emerald-500/[0.04] px-2">
                          <AnimatePresence mode="wait">
                            <motion.span
                              key={tokenIdx}
                              className="text-[11px] font-semibold text-white/80 font-mono"
                              initial={{ opacity: 0 }}
                              animate={{ opacity: 1 }}
                              exit={{ opacity: 0 }}
                            >
                              {token.takeProfit}
                            </motion.span>
                          </AnimatePresence>
                        </div>
                      </div>
                      <span className="text-[10px] font-bold text-emerald-400 font-mono w-8 text-right">{token.takeProfitPct}</span>
                    </div>
                    {/* Risk/Reward ratio */}
                    <div className="flex items-center justify-between pt-1">
                      <span className="text-[9px] text-white/30">Risk/Reward Ratio</span>
                      <span className="text-[10px] font-semibold text-amber-400 font-mono">1:3.7</span>
                    </div>
                  </div>
                ) : null}
              </div>

              {/* Trade details */}
              <div className="space-y-1 rounded-lg border border-white/[0.06] bg-white/[0.02] p-2.5">
                <div className="flex items-center justify-between text-[10px]">
                  <span className="text-white/40">Slippage</span>
                  <span className="text-white/60 font-medium">1.0%</span>
                </div>
                <div className="flex items-center justify-between text-[10px]">
                  <span className="text-white/40">Impact</span>
                  <AnimatePresence mode="wait">
                    <motion.span
                      key={tokenIdx}
                      className="text-emerald-400 font-medium"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                    >
                      {token.impact}
                    </motion.span>
                  </AnimatePresence>
                </div>
                <div className="flex items-center justify-between text-[10px]">
                  <span className="text-white/40">Min. Received</span>
                  <AnimatePresence mode="wait">
                    <motion.span
                      key={tokenIdx}
                      className="text-white/60 font-medium"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                    >
                      {token.minReceive}
                    </motion.span>
                  </AnimatePresence>
                </div>
                <div className="flex items-center justify-between text-[10px]">
                  <span className="text-white/40">Route</span>
                  <span className="text-white/60 font-medium">Jupiter v6</span>
                </div>
                <div className="flex items-center justify-between text-[10px]">
                  <span className="text-white/40">Creator Reward</span>
                  <AnimatePresence mode="wait">
                    <motion.span
                      key={tokenIdx}
                      className="text-emerald-400 font-semibold"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                    >
                      {token.creatorFee}
                    </motion.span>
                  </AnimatePresence>
                </div>
              </div>

              {/* CTA button */}
              <div className="w-full h-11 text-[13px] font-bold rounded-xl flex items-center justify-center gap-2 bg-gradient-to-r from-emerald-600 to-emerald-500 text-white shadow-[0_0_20px_-4px_rgba(16,185,129,0.35)]">
                <Wallet className="w-4 h-4" />
                Connect Wallet to Trade
              </div>

              {/* Bottom row */}
              <div className="flex items-center justify-between pt-0.5">
                <div className="flex items-center gap-2">
                  <Zap className="w-3 h-3 text-white/25" />
                  <span className="text-[10px] text-white/40">Instant</span>
                  <div className="w-7 h-4 rounded-full bg-white/10 ml-0.5 relative flex-shrink-0">
                    <div className="absolute left-0.5 top-0.5 w-3 h-3 rounded-full bg-white/60 shadow-sm" />
                  </div>
                </div>
                <motion.span
                  animate={{ opacity: execPing ? 1 : 0.55 }}
                  transition={{ duration: 0.25 }}
                  className="inline-flex items-center gap-1 text-[9px] font-semibold text-emerald-400"
                >
                  <Zap className="w-2.5 h-2.5" />
                  ~180ms avg exec
                </motion.span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
