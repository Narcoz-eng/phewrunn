import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useState } from "react";
import {
  BarChart2,
  Bell,
  Clock,
  Droplets,
  Flame,
  Star,
  TrendingUp,
  User,
  Zap,
} from "lucide-react";

interface Alert {
  id: number;
  signalType: "hot_alpha" | "early_runner" | "high_conviction" | "volume_spike" | "liquidity_spike";
  token: string;
  entry: string;
  multiplier: string;
  confidence: number;
  time: string;
  creator: string;
}

const ALL_ALERTS: Alert[] = [
  { id: 1, signalType: "early_runner",    token: "$SOL",  entry: "$183.40",    multiplier: "2.4x", confidence: 94, time: "2m ago",  creator: "7xKX..gAsU" },
  { id: 2, signalType: "volume_spike",    token: "$BONK", entry: "$0.0000224", multiplier: "3.1x", confidence: 87, time: "14m ago", creator: "TkN8..3rXp" },
  { id: 3, signalType: "hot_alpha",       token: "$WIF",  entry: "$1.82",      multiplier: "1.8x", confidence: 79, time: "31m ago", creator: "mT3P..vY8n" },
  { id: 4, signalType: "high_conviction", token: "$PEPE", entry: "$0.0000128", multiplier: "4.2x", confidence: 91, time: "45m ago", creator: "xE7L..pN2k" },
  { id: 5, signalType: "liquidity_spike", token: "$JUP",  entry: "$0.82",      multiplier: "2.9x", confidence: 88, time: "1h ago",  creator: "Rk2W..9mLp" },
];

const SIGNAL_META: Record<
  Alert["signalType"],
  { icon: React.ElementType; label: string; text: string; dot: string; bar: string; border: string; bg: string; glow: string }
> = {
  hot_alpha: {
    icon: Flame,
    label: "HOT ALPHA",
    text: "text-orange-400",
    dot: "bg-orange-400",
    bar: "bg-gradient-to-r from-orange-500 to-amber-400",
    border: "border-orange-500/20",
    bg: "bg-[linear-gradient(180deg,rgba(234,88,12,0.07),rgba(194,65,12,0.04))]",
    glow: "shadow-[0_0_0_1px_rgba(234,88,12,0.12)]",
  },
  early_runner: {
    icon: TrendingUp,
    label: "EARLY RUNNER",
    text: "text-emerald-400",
    dot: "bg-emerald-400",
    bar: "bg-gradient-to-r from-emerald-500 to-teal-400",
    border: "border-emerald-500/20",
    bg: "bg-[linear-gradient(180deg,rgba(16,185,129,0.07),rgba(5,150,105,0.04))]",
    glow: "shadow-[0_0_0_1px_rgba(16,185,129,0.12)]",
  },
  high_conviction: {
    icon: Star,
    label: "HIGH CONVICTION",
    text: "text-violet-400",
    dot: "bg-violet-400",
    bar: "bg-gradient-to-r from-violet-500 to-purple-400",
    border: "border-violet-500/20",
    bg: "bg-[linear-gradient(180deg,rgba(139,92,246,0.07),rgba(109,40,217,0.04))]",
    glow: "shadow-[0_0_0_1px_rgba(139,92,246,0.12)]",
  },
  volume_spike: {
    icon: BarChart2,
    label: "VOL SPIKE",
    text: "text-amber-400",
    dot: "bg-amber-400",
    bar: "bg-gradient-to-r from-amber-500 to-yellow-400",
    border: "border-amber-500/20",
    bg: "bg-[linear-gradient(180deg,rgba(245,158,11,0.07),rgba(217,119,6,0.04))]",
    glow: "shadow-[0_0_0_1px_rgba(245,158,11,0.12)]",
  },
  liquidity_spike: {
    icon: Droplets,
    label: "LIQ SPIKE",
    text: "text-cyan-400",
    dot: "bg-cyan-400",
    bar: "bg-gradient-to-r from-cyan-500 to-sky-400",
    border: "border-cyan-500/20",
    bg: "bg-[linear-gradient(180deg,rgba(6,182,212,0.07),rgba(8,145,178,0.04))]",
    glow: "shadow-[0_0_0_1px_rgba(6,182,212,0.12)]",
  },
};

function AlertCard({ alert, index }: { alert: Alert; index: number }) {
  const m = SIGNAL_META[alert.signalType];
  const Icon = m.icon;

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, x: -16, transition: { duration: 0.2 } }}
      transition={{ duration: 0.3, delay: index * 0.05 }}
      className={`rounded-xl border ${m.border} ${m.bg} ${m.glow} p-3 space-y-2`}
    >
      {/* Top row */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className={`flex-shrink-0 w-1.5 h-1.5 rounded-full ${m.dot} animate-pulse`} />
          <Icon className={`w-3 h-3 flex-shrink-0 ${m.text}`} />
          <span className={`text-[10px] font-bold tracking-widest uppercase ${m.text} flex-shrink-0`}>
            {m.label}
          </span>
          <span className="font-mono font-bold text-sm text-white/90 truncate">{alert.token}</span>
        </div>
        <div className="flex items-center gap-1 text-[10px] text-white/35 flex-shrink-0">
          <Clock className="w-2.5 h-2.5" />
          {alert.time}
        </div>
      </div>

      {/* Entry + multiplier */}
      <div className="flex items-center gap-3 text-[11px]">
        <span className="text-white/45">
          Entry <span className="font-mono text-white/80 font-medium">{alert.entry}</span>
        </span>
        <TrendingUp className={`w-3 h-3 flex-shrink-0 ${m.text}`} />
        <span className={`font-bold ${m.text}`}>{alert.multiplier}</span>
      </div>

      {/* Confidence bar */}
      <div className="space-y-1">
        <div className="flex items-center justify-between text-[10px] text-white/40">
          <span>Confidence</span>
          <span className={`font-semibold ${m.text}`}>{alert.confidence}%</span>
        </div>
        <div className="h-1 rounded-full bg-white/[0.07] overflow-hidden">
          <motion.div
            className={`h-full rounded-full ${m.bar}`}
            initial={{ width: "0%" }}
            animate={{ width: `${alert.confidence}%` }}
            transition={{ duration: 0.7, delay: index * 0.08 + 0.1, ease: "easeOut" }}
          />
        </div>
      </div>

      {/* Creator */}
      <div className="flex items-center gap-1.5 text-[10px] text-white/30">
        <User className="w-2.5 h-2.5 flex-shrink-0" />
        <span className="font-mono">{alert.creator}</span>
      </div>
    </motion.div>
  );
}

export function AlertsViz() {
  const [alerts, setAlerts] = useState<Alert[]>(ALL_ALERTS.slice(0, 3));
  const [newCount, setNewCount] = useState<number>(4);

  useEffect(() => {
    const iv = window.setInterval(() => {
      setAlerts((prev) => {
        const lastIdx = ALL_ALERTS.findIndex((a) => a.id === prev[prev.length - 1]?.id);
        const nextAlert = ALL_ALERTS[(lastIdx + 1) % ALL_ALERTS.length]!;
        return [...prev.slice(1), nextAlert];
      });
      setNewCount((n) => n + 1);
    }, 4000);
    return () => window.clearInterval(iv);
  }, []);

  return (
    <div className="rounded-[22px] border border-white/[0.08] bg-[linear-gradient(180deg,rgba(10,16,28,0.97),rgba(6,10,18,0.99))] shadow-[0_0_40px_-12px_rgba(16,185,129,0.12),0_0_0_1px_rgba(255,255,255,0.04)] overflow-hidden">

      {/* Header */}
      <div className="px-5 pt-5 pb-4 border-b border-white/[0.06] flex items-center justify-between">
        <div>
          <h3 className="font-heading font-bold text-sm text-white/90">Active Signals</h3>
          <p className="text-[11px] text-white/40 mt-0.5">Real-time calls from top creators</p>
        </div>
        <div className="flex items-center gap-2">
          {/* Bell count */}
          <div className="flex items-center gap-1.5 text-[10px] font-medium text-white/60 border border-white/[0.1] bg-white/[0.04] rounded-full px-2.5 py-1">
            <Bell className="w-2.5 h-2.5 flex-shrink-0" />
            <motion.span
              key={newCount}
              initial={{ scale: 1.3 }}
              animate={{ scale: 1 }}
              transition={{ duration: 0.2 }}
            >
              {newCount}
            </motion.span>
          </div>
          {/* Live badge */}
          <div className="flex items-center gap-1.5 text-[10px] font-semibold text-emerald-400 border border-emerald-500/25 bg-emerald-500/10 rounded-full px-2.5 py-1">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse inline-block" />
            Live
          </div>
        </div>
      </div>

      {/* Cards */}
      <div className="p-4 space-y-2.5">
        <AnimatePresence mode="popLayout">
          {alerts.map((alert, i) => (
            <AlertCard key={alert.id} alert={alert} index={i} />
          ))}
        </AnimatePresence>
      </div>

      {/* Footer */}
      <div className="px-5 py-3 border-t border-white/[0.05] bg-white/[0.02] flex items-center justify-between text-[11px]">
        <span className="text-white/35">Updating live as creators post</span>
        <span className="flex items-center gap-1 text-emerald-400 font-medium">
          <Zap className="w-3 h-3" />
          View all
        </span>
      </div>
    </div>
  );
}
