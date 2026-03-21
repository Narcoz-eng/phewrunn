import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useState } from "react";
import {
  BarChart2,
  Bell,
  BellRing,
  Clock,
  Droplets,
  Flame,
  MessageSquare,
  Star,
  TrendingUp,
  Zap,
} from "lucide-react";

interface LoginNotification {
  id: number;
  type: "signal" | "post" | "milestone";
  signalType: "hot_alpha" | "early_runner" | "high_conviction" | "volume_spike" | "liquidity_spike";
  token: string;
  message: string;
  creator: string;
  avatarUrl: string;
  time: string;
  detail: string;
}

const ALL_NOTIFICATIONS: LoginNotification[] = [
  {
    id: 1,
    type: "post",
    signalType: "early_runner",
    token: "$SOL",
    message: "posted a new call on $SOL",
    creator: "SolMaxi",
    avatarUrl: "https://api.dicebear.com/7.x/notionists/svg?seed=SolMaxi&backgroundColor=0a0a0f",
    time: "Just now",
    detail: "Entry $183.40 — flagged as Early Runner with 94% confidence",
  },
  {
    id: 2,
    type: "signal",
    signalType: "volume_spike",
    token: "$BONK",
    message: "Volume spike detected on $BONK",
    creator: "DeFiAlpha",
    avatarUrl: "https://api.dicebear.com/7.x/notionists/svg?seed=DeFiAlpha&backgroundColor=0a0a0f",
    time: "3m ago",
    detail: "3.1x multiplier potential — 87% confidence score",
  },
  {
    id: 3,
    type: "post",
    signalType: "hot_alpha",
    token: "$WIF",
    message: "shared hot alpha on $WIF",
    creator: "WhaleWatch",
    avatarUrl: "https://api.dicebear.com/7.x/notionists/svg?seed=WhaleWatch&backgroundColor=0a0a0f",
    time: "12m ago",
    detail: "Entry $1.82 — whale accumulation pattern confirmed",
  },
  {
    id: 4,
    type: "signal",
    signalType: "high_conviction",
    token: "$PEPE",
    message: "High conviction alert for $PEPE",
    creator: "OnchainOracle",
    avatarUrl: "https://api.dicebear.com/7.x/notionists/svg?seed=OnchainOracle&backgroundColor=0a0a0f",
    time: "28m ago",
    detail: "4.2x potential — supply shock pattern, 91% confidence",
  },
  {
    id: 5,
    type: "post",
    signalType: "liquidity_spike",
    token: "$JUP",
    message: "posted liquidity analysis on $JUP",
    creator: "LiqHunter",
    avatarUrl: "https://api.dicebear.com/7.x/notionists/svg?seed=LiqHunter&backgroundColor=0a0a0f",
    time: "41m ago",
    detail: "Entry $0.82 — liquidity inflow surge, 2.9x target",
  },
];

const SIGNAL_META: Record<
  LoginNotification["signalType"],
  { icon: React.ElementType; label: string; text: string; dot: string; border: string; bg: string; glow: string }
> = {
  hot_alpha: {
    icon: Flame,
    label: "HOT ALPHA",
    text: "text-orange-400",
    dot: "bg-orange-400",
    border: "border-orange-500/20",
    bg: "bg-[linear-gradient(180deg,rgba(234,88,12,0.07),rgba(194,65,12,0.04))]",
    glow: "shadow-[0_0_0_1px_rgba(234,88,12,0.12)]",
  },
  early_runner: {
    icon: TrendingUp,
    label: "EARLY RUNNER",
    text: "text-emerald-400",
    dot: "bg-emerald-400",
    border: "border-emerald-500/20",
    bg: "bg-[linear-gradient(180deg,rgba(16,185,129,0.07),rgba(5,150,105,0.04))]",
    glow: "shadow-[0_0_0_1px_rgba(16,185,129,0.12)]",
  },
  high_conviction: {
    icon: Star,
    label: "HIGH CONVICTION",
    text: "text-violet-400",
    dot: "bg-violet-400",
    border: "border-violet-500/20",
    bg: "bg-[linear-gradient(180deg,rgba(139,92,246,0.07),rgba(109,40,217,0.04))]",
    glow: "shadow-[0_0_0_1px_rgba(139,92,246,0.12)]",
  },
  volume_spike: {
    icon: BarChart2,
    label: "VOL SPIKE",
    text: "text-amber-400",
    dot: "bg-amber-400",
    border: "border-amber-500/20",
    bg: "bg-[linear-gradient(180deg,rgba(245,158,11,0.07),rgba(217,119,6,0.04))]",
    glow: "shadow-[0_0_0_1px_rgba(245,158,11,0.12)]",
  },
  liquidity_spike: {
    icon: Droplets,
    label: "LIQ SPIKE",
    text: "text-cyan-400",
    dot: "bg-cyan-400",
    border: "border-cyan-500/20",
    bg: "bg-[linear-gradient(180deg,rgba(6,182,212,0.07),rgba(8,145,178,0.04))]",
    glow: "shadow-[0_0_0_1px_rgba(6,182,212,0.12)]",
  },
};

function NotificationCard({ notif, index }: { notif: LoginNotification; index: number }) {
  const m = SIGNAL_META[notif.signalType];
  const Icon = m.icon;

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, x: -16, transition: { duration: 0.2 } }}
      transition={{ duration: 0.3, delay: index * 0.05 }}
      className={`rounded-xl border ${m.border} ${m.bg} ${m.glow} p-3.5 space-y-2.5`}
    >
      {/* Creator row with avatar */}
      <div className="flex items-start gap-2.5">
        <div className="relative flex-shrink-0">
          <img
            src={notif.avatarUrl}
            alt={notif.creator}
            className="w-8 h-8 rounded-full object-cover ring-1 ring-white/10 shadow-md bg-white/5"
          />
          <span className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full ${m.dot} border-[1.5px] border-[rgba(10,16,28,0.97)]`} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[12px] text-white/80 leading-snug">
              <span className="font-semibold text-white/95">{notif.creator}</span>{" "}
              {notif.message}
            </p>
            <div className="flex items-center gap-1 text-[10px] text-white/30 flex-shrink-0">
              <Clock className="w-2.5 h-2.5" />
              {notif.time}
            </div>
          </div>
          {/* Signal badge */}
          <div className="flex items-center gap-1.5 mt-1.5">
            <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[9px] font-bold tracking-wider uppercase ${m.text} bg-white/[0.04] border border-white/[0.06]`}>
              <Icon className="w-2.5 h-2.5" />
              {m.label}
            </span>
            <span className="font-mono font-bold text-[12px] text-white/90">{notif.token}</span>
          </div>
        </div>
      </div>

      {/* Detail line */}
      <div className="pl-[42px] text-[11px] text-white/45 leading-relaxed">
        {notif.detail}
      </div>
    </motion.div>
  );
}

export function AlertsViz() {
  const [notifications, setNotifications] = useState<LoginNotification[]>(ALL_NOTIFICATIONS.slice(0, 3));
  const [newCount, setNewCount] = useState<number>(12);

  useEffect(() => {
    const iv = window.setInterval(() => {
      setNotifications((prev) => {
        const lastIdx = ALL_NOTIFICATIONS.findIndex((a) => a.id === prev[prev.length - 1]?.id);
        const nextNotif = ALL_NOTIFICATIONS[(lastIdx + 1) % ALL_NOTIFICATIONS.length]!;
        return [...prev.slice(1), nextNotif];
      });
      setNewCount((n) => n + 1);
    }, 4000);
    return () => window.clearInterval(iv);
  }, []);

  return (
    <div className="rounded-[22px] border border-white/[0.08] bg-[linear-gradient(180deg,rgba(10,16,28,0.97),rgba(6,10,18,0.99))] shadow-[0_0_40px_-12px_rgba(16,185,129,0.12),0_0_0_1px_rgba(255,255,255,0.04)] overflow-hidden">

      {/* Header */}
      <div className="px-5 pt-5 pb-4 border-b border-white/[0.06]">
        <div className="flex items-center justify-between mb-2.5">
          <div className="flex items-center gap-2.5">
            <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
              <BellRing className="w-4 h-4 text-emerald-400" />
            </div>
            <div>
              <h3 className="font-heading font-bold text-sm text-white/90">Live Notifications</h3>
              <p className="text-[10px] text-white/35 mt-0.5">From live posts & on-chain intelligence</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
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
            <div className="flex items-center gap-1.5 text-[10px] font-semibold text-emerald-400 border border-emerald-500/25 bg-emerald-500/10 rounded-full px-2.5 py-1">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse inline-block" />
              Live
            </div>
          </div>
        </div>
        {/* Description */}
        <p className="text-[11px] text-white/40 leading-relaxed">
          Get notified when creators post calls and when our intelligence detects signals like volume spikes, liquidity surges, and early runner patterns — so you never miss alpha.
        </p>
      </div>

      {/* Notification cards */}
      <div className="p-4 space-y-2.5">
        <AnimatePresence mode="popLayout">
          {notifications.map((notif, i) => (
            <NotificationCard key={notif.id} notif={notif} index={i} />
          ))}
        </AnimatePresence>
      </div>

      {/* Footer */}
      <div className="px-5 py-3 border-t border-white/[0.05] bg-white/[0.02] flex items-center justify-between text-[11px]">
        <span className="flex items-center gap-1.5 text-white/35">
          <MessageSquare className="w-3 h-3" />
          Posts & intelligence signals
        </span>
        <span className="flex items-center gap-1 text-emerald-400 font-medium">
          <Zap className="w-3 h-3" />
          View all
        </span>
      </div>
    </div>
  );
}
