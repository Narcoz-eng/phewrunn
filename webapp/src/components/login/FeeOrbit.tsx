import { motion, AnimatePresence } from "framer-motion";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

// Each incoming trade: wallet address fragment + buy amount
interface IncomingTrade {
  id: number;
  angle: number;       // degrees (where it enters from)
  radius: number;      // orbit radius
  duration: number;    // orbital speed
  initAngle: number;   // starting angle
  label: string;       // short wallet
  amount: string;      // buy size
}

const TRADERS: IncomingTrade[] = [
  { id: 1, radius: 90, duration: 13, initAngle: 0,   label: "7xKX..gAsU", amount: "$420" },
  { id: 2, radius: 82, duration: 10, initAngle: 40,  label: "Gh9Z..KtKJ", amount: "$85"  },
  { id: 3, radius: 95, duration: 17, initAngle: 90,  label: "mT3P..vY8n", amount: "$1.2K"},
  { id: 4, radius: 86, duration: 11, initAngle: 140, label: "9wQR..aB4f", amount: "$230" },
  { id: 5, radius: 91, duration: 15, initAngle: 185, label: "xE7L..pN2k", amount: "$660" },
  { id: 6, radius: 83, duration: 12, initAngle: 225, label: "Hf3R..k2L7", amount: "$90"  },
  { id: 7, radius: 88, duration: 16, initAngle: 270, label: "TkN8..3rXp", amount: "$3.5K"},
  { id: 8, radius: 79, duration: 14, initAngle: 315, label: "Bv5Q..mJ9e", amount: "$175" },
];

// Recent buy feed
const BUY_LABELS = [
  "7xKX..gAsU bought → $420",
  "TkN8..3rXp bought → $3.5K",
  "mT3P..vY8n bought → $1.2K",
  "xE7L..pN2k bought → $660",
  "Gh9Z..KtKJ bought → $85",
  "9wQR..aB4f bought → $230",
];

export function FeeOrbit() {
  const [visibleCount, setVisibleCount] = useState(0);
  const [totalFees, setTotalFees] = useState(0);
  const [tradeCount, setTradeCount] = useState(0);
  const [activePulse, setActivePulse] = useState<number | null>(null);
  const [particleKey, setParticleKey] = useState(0);
  const [particleAngle, setParticleAngle] = useState(0);
  const [particleRadius, setParticleRadius] = useState(90);
  const [lastBuy, setLastBuy] = useState<string | null>(null);
  const [buyFeedKey, setBuyFeedKey] = useState(0);

  // Traders appear one by one
  useEffect(() => {
    if (visibleCount >= TRADERS.length) return;
    const t = setTimeout(() => setVisibleCount((v) => v + 1), 300);
    return () => clearTimeout(t);
  }, [visibleCount]);

  // Trade execution loop — someone buys from the post
  useEffect(() => {
    if (visibleCount === 0) return;
    const interval = setInterval(() => {
      const idx = Math.floor(Math.random() * visibleCount);
      const trader = TRADERS[idx];
      if (!trader) return;

      setActivePulse(idx);
      setParticleAngle(trader.initAngle);
      setParticleRadius(trader.radius);
      setParticleKey((k) => k + 1);
      setTotalFees((prev) => prev + 0.5);
      setTradeCount((prev) => prev + 1);

      // Show buy feed
      const label = BUY_LABELS[idx % BUY_LABELS.length];
      setLastBuy(label ?? null);
      setBuyFeedKey((k) => k + 1);

      setTimeout(() => setActivePulse(null), 700);
    }, 800);
    return () => clearInterval(interval);
  }, [visibleCount]);

  const particleStartX =
    Math.cos((particleAngle * Math.PI) / 180) * particleRadius;
  const particleStartY =
    Math.sin((particleAngle * Math.PI) / 180) * particleRadius;

  return (
    <div className="select-none">
      {/* Top label */}
      <div className="text-center mb-3">
        <div className="inline-flex items-center gap-2 text-xs text-muted-foreground">
          <span className="inline-block w-2 h-2 rounded-full bg-gain animate-pulse" />
          Live sim — traders buying from this post
        </div>
      </div>

      {/* Canvas */}
      <div className="relative w-[260px] h-[260px] mx-auto">
        {/* Orbital rings */}
        <svg
          className="absolute inset-0 w-full h-full pointer-events-none"
          viewBox="0 0 260 260"
          fill="none"
        >
          <circle
            cx="130" cy="130" r="82"
            stroke="hsl(var(--primary)/0.18)"
            strokeWidth="1" strokeDasharray="4 8"
          />
          <circle
            cx="130" cy="130" r="97"
            stroke="hsl(var(--primary)/0.08)"
            strokeWidth="1" strokeDasharray="3 12"
          />
          {/* "buy" flow lines — trader → post */}
          {TRADERS.slice(0, visibleCount).map((trader) => {
            const rad = (trader.initAngle * Math.PI) / 180;
            const x = 130 + Math.cos(rad) * trader.radius;
            const y = 130 + Math.sin(rad) * trader.radius;
            return (
              <motion.line
                key={trader.id}
                x1={x} y1={y} x2="130" y2="130"
                stroke="hsl(var(--gain)/0.2)"
                strokeWidth="0.75"
                strokeDasharray="3 5"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.4 }}
              />
            );
          })}
        </svg>

        {/* Orbiting traders */}
        {TRADERS.slice(0, visibleCount).map((trader, i) => (
          <motion.div
            key={trader.id}
            className="absolute top-1/2 left-1/2"
            style={{
              width: trader.radius * 2,
              height: trader.radius * 2,
              marginLeft: -trader.radius,
              marginTop: -trader.radius,
            }}
            initial={{ opacity: 0, scale: 0.3 }}
            animate={{
              opacity: 1,
              scale: 1,
              rotate: [trader.initAngle, trader.initAngle + 360],
            }}
            transition={{
              opacity: { duration: 0.3 },
              scale: { duration: 0.3 },
              rotate: {
                duration: trader.duration,
                ease: "linear",
                repeat: Infinity,
              },
            }}
          >
            <motion.div
              className={cn(
                "absolute flex flex-col items-center justify-center rounded-lg border px-1.5 py-1 text-center",
                activePulse === i
                  ? "bg-gain/20 border-gain/50 text-gain"
                  : "bg-card border-border/60 text-muted-foreground"
              )}
              style={{
                top: -18,
                left: "50%",
                marginLeft: -22,
                width: 44,
                minHeight: 28,
              }}
              animate={{
                rotate: [-trader.initAngle, -(trader.initAngle + 360)],
              }}
              transition={{
                duration: trader.duration,
                ease: "linear",
                repeat: Infinity,
              }}
            >
              <span className="text-[8px] font-mono leading-none">
                {activePulse === i ? "BUY ↗" : trader.label}
              </span>
              {activePulse === i && (
                <span className="text-[8px] font-bold leading-none">
                  {trader.amount}
                </span>
              )}
            </motion.div>
          </motion.div>
        ))}

        {/* Fee particle flying from trade → you (center) */}
        <AnimatePresence>
          <motion.div
            key={particleKey}
            className="absolute top-1/2 left-1/2 w-3 h-3 rounded-full bg-gain pointer-events-none z-20 flex items-center justify-center"
            style={{ marginLeft: -6, marginTop: -6 }}
            initial={{ x: particleStartX, y: particleStartY, opacity: 1, scale: 1.8 }}
            animate={{ x: 0, y: 0, opacity: 0, scale: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.6, ease: "easeIn" }}
          />
        </AnimatePresence>

        {/* Center — YOUR POST node */}
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-10">
          <motion.div
            className="w-[72px] h-[72px] rounded-2xl bg-card border-2 border-primary/60 flex flex-col items-center justify-center gap-0.5 shadow-glow-sm"
            animate={{
              boxShadow: [
                "0 0 0px 0 hsl(var(--primary)/0.4)",
                "0 0 20px 10px hsl(var(--primary)/0.08)",
                "0 0 0px 0 hsl(var(--primary)/0.4)",
              ],
            }}
            transition={{ duration: 2.5, repeat: Infinity }}
          >
            <span className="text-[8px] font-semibold text-muted-foreground uppercase tracking-widest leading-none">
              YOUR
            </span>
            <span className="text-[8px] font-semibold text-muted-foreground uppercase tracking-widest leading-none">
              POST
            </span>
            <motion.span
              className="text-[11px] font-mono font-bold text-gain leading-none mt-1"
              key={totalFees}
              initial={{ y: -3, opacity: 0.6 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ duration: 0.15 }}
            >
              +{totalFees.toFixed(1)}%
            </motion.span>
          </motion.div>
        </div>
      </div>

      {/* Buy feed ticker */}
      <div className="mt-3 h-6 overflow-hidden rounded-lg border border-border/40 bg-card/50 px-3 flex items-center">
        <AnimatePresence mode="wait">
          {lastBuy ? (
            <motion.div
              key={buyFeedKey}
              className="text-[11px] text-gain font-mono w-full"
              initial={{ y: 10, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: -10, opacity: 0 }}
              transition={{ duration: 0.2 }}
            >
              ↗ {lastBuy} → <span className="text-foreground font-bold">+0.5%</span> to you
            </motion.div>
          ) : (
            <motion.div
              key="idle"
              className="text-[11px] text-muted-foreground w-full"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
            >
              Waiting for trades from your post…
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Stats row */}
      <div className="flex gap-3 mt-3">
        <div className="flex-1 rounded-xl border border-gain/20 bg-gain/5 p-3 text-center">
          <motion.div
            className="text-xl font-mono font-bold text-gain"
            key={Math.floor(totalFees)}
            initial={{ scale: 1.2 }}
            animate={{ scale: 1 }}
            transition={{ duration: 0.12 }}
          >
            +{totalFees.toFixed(1)}%
          </motion.div>
          <div className="text-[11px] text-muted-foreground mt-0.5">Fees Earned</div>
        </div>
        <div className="flex-1 rounded-xl border border-border/50 bg-card/60 p-3 text-center">
          <div className="text-xl font-mono font-bold">{tradeCount}</div>
          <div className="text-[11px] text-muted-foreground mt-0.5">Trades from Post</div>
        </div>
      </div>
    </div>
  );
}
