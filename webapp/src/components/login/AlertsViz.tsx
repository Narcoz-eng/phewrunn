import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useState } from "react";
import { Bell, Clock, TrendingUp, User } from "lucide-react";

interface Alert {
  id: number;
  type: "STRONG BUY" | "SIGNAL" | "ENTRY POINT";
  token: string;
  entry: string;
  multiplier: string;
  confidence: number;
  time: string;
  creator: string;
}

const ALL_ALERTS: Alert[] = [
  { id: 1, type: "STRONG BUY", token: "$SOL", entry: "$183.40", multiplier: "2.4x", confidence: 94, time: "2m ago", creator: "7xKX..gAsU" },
  { id: 2, type: "SIGNAL", token: "$BONK", entry: "$0.0000224", multiplier: "3.1x", confidence: 87, time: "14m ago", creator: "TkN8..3rXp" },
  { id: 3, type: "ENTRY POINT", token: "$WIF", entry: "$1.82", multiplier: "1.8x", confidence: 79, time: "31m ago", creator: "mT3P..vY8n" },
  { id: 4, type: "STRONG BUY", token: "$PEPE", entry: "$0.0000128", multiplier: "4.2x", confidence: 91, time: "45m ago", creator: "xE7L..pN2k" },
];

const TYPE_STYLES: Record<Alert["type"], { label: string; dot: string; text: string; border: string; bg: string }> = {
  "STRONG BUY": { label: "STRONG BUY", dot: "bg-gain", text: "text-gain", border: "border-gain/25", bg: "bg-gain/8" },
  "SIGNAL":     { label: "SIGNAL",     dot: "bg-primary", text: "text-primary", border: "border-primary/20", bg: "bg-primary/6" },
  "ENTRY POINT":{ label: "ENTRY",      dot: "bg-foreground/50", text: "text-foreground/70", border: "border-border/50", bg: "bg-card/50" },
};

function AlertCard({ alert, index }: { alert: Alert; index: number }) {
  const s = TYPE_STYLES[alert.type];

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, x: -16, transition: { duration: 0.2 } }}
      transition={{ duration: 0.3, delay: index * 0.05 }}
      className={`rounded-xl border ${s.border} ${s.bg} p-3 space-y-2`}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className={`flex-shrink-0 w-1.5 h-1.5 rounded-full ${s.dot} animate-pulse`} />
          <span className={`text-[10px] font-bold tracking-widest uppercase ${s.text} flex-shrink-0`}>
            {s.label}
          </span>
          <span className="font-mono font-bold text-sm truncate">{alert.token}</span>
        </div>
        <div className="flex items-center gap-1 text-[10px] text-muted-foreground flex-shrink-0">
          <Clock className="w-2.5 h-2.5" />
          {alert.time}
        </div>
      </div>

      <div className="flex items-center gap-3 text-[11px]">
        <span className="text-muted-foreground">
          Entry <span className="font-mono text-foreground font-medium">{alert.entry}</span>
        </span>
        <TrendingUp className="w-3 h-3 text-gain flex-shrink-0" />
        <span className="font-bold text-gain">{alert.multiplier}</span>
      </div>

      <div className="space-y-1">
        <div className="flex items-center justify-between text-[10px] text-muted-foreground">
          <span>Confidence</span>
          <span className={`font-semibold ${s.text}`}>{alert.confidence}%</span>
        </div>
        <div className="h-1 rounded-full bg-border/40 overflow-hidden">
          <motion.div
            className={`h-full rounded-full ${alert.confidence >= 90 ? "bg-gain" : alert.confidence >= 85 ? "bg-primary" : "bg-foreground/35"}`}
            initial={{ width: "0%" }}
            animate={{ width: `${alert.confidence}%` }}
            transition={{ duration: 0.7, delay: index * 0.08 + 0.1, ease: "easeOut" }}
          />
        </div>
      </div>

      <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
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
    <div className="rounded-2xl border border-border/50 bg-card/60 backdrop-blur-sm overflow-hidden">
      {/* Header */}
      <div className="px-5 pt-5 pb-4 border-b border-border/40 flex items-center justify-between">
        <div>
          <h3 className="font-heading font-bold text-sm">Active Signals</h3>
          <p className="text-[11px] text-muted-foreground mt-0.5">Real-time calls from top creators</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 text-[10px] font-medium text-primary border border-primary/20 bg-primary/8 rounded-full px-2.5 py-1">
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
          <div className="flex items-center gap-1 text-[10px] text-gain border border-gain/20 bg-gain/8 rounded-full px-2.5 py-1">
            <span className="w-1.5 h-1.5 rounded-full bg-gain animate-pulse inline-block" />
            Live
          </div>
        </div>
      </div>

      <div className="p-4 space-y-2.5">
        <AnimatePresence mode="popLayout">
          {alerts.map((alert, i) => (
            <AlertCard key={alert.id} alert={alert} index={i} />
          ))}
        </AnimatePresence>
      </div>

      <div className="px-5 py-3 border-t border-border/30 bg-card/30 flex items-center justify-between text-[11px] text-muted-foreground">
        <span>Updating live as creators post</span>
        <span className="text-primary font-medium">View all →</span>
      </div>
    </div>
  );
}
