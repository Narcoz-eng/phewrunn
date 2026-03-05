import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useEffect, useMemo, useState } from "react";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";

interface IncomingTrade {
  id: number;
  radius: number;
  duration: number;
  initAngle: number;
  label: string;
  amount: string;
}

const TRADERS: IncomingTrade[] = [
  { id: 1, radius: 90, duration: 13, initAngle: 0, label: "7xKX..gAsU", amount: "$420" },
  { id: 2, radius: 82, duration: 10, initAngle: 40, label: "Gh9Z..KtKJ", amount: "$85" },
  { id: 3, radius: 95, duration: 17, initAngle: 90, label: "mT3P..vY8n", amount: "$1.2K" },
  { id: 4, radius: 86, duration: 11, initAngle: 140, label: "9wQR..aB4f", amount: "$230" },
  { id: 5, radius: 91, duration: 15, initAngle: 185, label: "xE7L..pN2k", amount: "$660" },
  { id: 6, radius: 83, duration: 12, initAngle: 225, label: "Hf3R..k2L7", amount: "$90" },
  { id: 7, radius: 88, duration: 16, initAngle: 270, label: "TkN8..3rXp", amount: "$3.5K" },
  { id: 8, radius: 79, duration: 14, initAngle: 315, label: "Bv5Q..mJ9e", amount: "$175" },
];

const BUY_LABELS = [
  "7xKX..gAsU bought -> $420",
  "TkN8..3rXp bought -> $3.5K",
  "mT3P..vY8n bought -> $1.2K",
  "xE7L..pN2k bought -> $660",
  "Gh9Z..KtKJ bought -> $85",
  "9wQR..aB4f bought -> $230",
];

export function FeeOrbit() {
  const isMobile = useIsMobile();
  const reduceMotion = useReducedMotion();
  const liteMode = isMobile || reduceMotion;
  const orbitScale = liteMode ? 0.84 : 1;
  const canvasSize = liteMode ? 220 : 260;
  const center = canvasSize / 2;
  const traders = useMemo(
    () =>
      TRADERS.slice(0, liteMode ? 5 : TRADERS.length).map((trader) => ({
        ...trader,
        radius: Math.round(trader.radius * orbitScale),
      })),
    [liteMode, orbitScale]
  );

  const [visibleCount, setVisibleCount] = useState(0);
  const [totalFees, setTotalFees] = useState(0);
  const [tradeCount, setTradeCount] = useState(0);
  const [activePulse, setActivePulse] = useState<number | null>(null);
  const [particleKey, setParticleKey] = useState(0);
  const [particleAngle, setParticleAngle] = useState(0);
  const [particleRadius, setParticleRadius] = useState(90);
  const [lastBuy, setLastBuy] = useState<string | null>(null);
  const [buyFeedKey, setBuyFeedKey] = useState(0);

  useEffect(() => {
    setVisibleCount(0);
  }, [traders.length]);

  useEffect(() => {
    if (visibleCount >= traders.length) return;
    const timer = window.setTimeout(
      () => setVisibleCount((value) => value + 1),
      liteMode ? 420 : 300
    );
    return () => window.clearTimeout(timer);
  }, [liteMode, traders.length, visibleCount]);

  useEffect(() => {
    if (visibleCount === 0) return;
    const interval = window.setInterval(() => {
      const idx = Math.floor(Math.random() * visibleCount);
      const trader = traders[idx];
      if (!trader) return;

      setActivePulse(idx);
      setParticleAngle(trader.initAngle);
      setParticleRadius(trader.radius);
      setParticleKey((value) => value + 1);
      setTotalFees((value) => value + 0.5);
      setTradeCount((value) => value + 1);
      setLastBuy(BUY_LABELS[idx % BUY_LABELS.length] ?? null);
      setBuyFeedKey((value) => value + 1);

      const pulseTimer = window.setTimeout(() => setActivePulse(null), 700);
      return () => window.clearTimeout(pulseTimer);
    }, liteMode ? 1400 : 800);

    return () => window.clearInterval(interval);
  }, [liteMode, traders, visibleCount]);

  const particleStartX = Math.cos((particleAngle * Math.PI) / 180) * particleRadius;
  const particleStartY = Math.sin((particleAngle * Math.PI) / 180) * particleRadius;
  const ringOuter = Math.round(97 * orbitScale);
  const ringInner = Math.round(82 * orbitScale);

  return (
    <div className="select-none">
      <div className="mb-3 text-center">
        <div className="inline-flex items-center gap-2 text-xs text-muted-foreground">
          <span className="inline-block h-2 w-2 rounded-full bg-gain animate-pulse" />
          Live sim - traders buying from this post
        </div>
      </div>

      <div className="relative mx-auto" style={{ width: canvasSize, height: canvasSize }}>
        <svg className="absolute inset-0 h-full w-full pointer-events-none" viewBox={`0 0 ${canvasSize} ${canvasSize}`} fill="none">
          <circle cx={center} cy={center} r={ringInner} stroke="hsl(var(--primary)/0.18)" strokeWidth="1" strokeDasharray="4 8" />
          <circle cx={center} cy={center} r={ringOuter} stroke="hsl(var(--primary)/0.08)" strokeWidth="1" strokeDasharray="3 12" />
          {traders.slice(0, visibleCount).map((trader) => {
            const rad = (trader.initAngle * Math.PI) / 180;
            const x = center + Math.cos(rad) * trader.radius;
            const y = center + Math.sin(rad) * trader.radius;
            return (
              <motion.line
                key={trader.id}
                x1={x}
                y1={y}
                x2={center}
                y2={center}
                stroke="hsl(var(--gain)/0.2)"
                strokeWidth="0.75"
                strokeDasharray="3 5"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.25 }}
              />
            );
          })}
        </svg>

        {traders.slice(0, visibleCount).map((trader, index) => (
          <motion.div
            key={trader.id}
            className="absolute left-1/2 top-1/2"
            style={{
              width: trader.radius * 2,
              height: trader.radius * 2,
              marginLeft: -trader.radius,
              marginTop: -trader.radius,
            }}
            initial={{ opacity: 0, scale: 0.3 }}
            animate={
              liteMode
                ? { opacity: 1, scale: 1 }
                : { opacity: 1, scale: 1, rotate: [trader.initAngle, trader.initAngle + 360] }
            }
            transition={
              liteMode
                ? { opacity: { duration: 0.2 }, scale: { duration: 0.2 } }
                : {
                    opacity: { duration: 0.3 },
                    scale: { duration: 0.3 },
                    rotate: { duration: trader.duration, ease: "linear", repeat: Infinity },
                  }
            }
          >
            <motion.div
              className={cn(
                "absolute flex min-h-[28px] w-[44px] flex-col items-center justify-center rounded-lg border px-1.5 py-1 text-center",
                activePulse === index
                  ? "border-gain/50 bg-gain/20 text-gain"
                  : "border-border/60 bg-card text-muted-foreground"
              )}
              style={{ top: -18, left: "50%", marginLeft: -22 }}
              animate={
                liteMode
                  ? undefined
                  : { rotate: [-trader.initAngle, -(trader.initAngle + 360)] }
              }
              transition={
                liteMode
                  ? undefined
                  : { duration: trader.duration, ease: "linear", repeat: Infinity }
              }
            >
              <span className="text-[8px] font-mono leading-none">
                {activePulse === index ? "BUY ->" : trader.label}
              </span>
              {activePulse === index ? (
                <span className="text-[8px] font-bold leading-none">{trader.amount}</span>
              ) : null}
            </motion.div>
          </motion.div>
        ))}

        <AnimatePresence>
          <motion.div
            key={particleKey}
            className="absolute left-1/2 top-1/2 z-20 flex h-3 w-3 items-center justify-center rounded-full bg-gain pointer-events-none"
            style={{ marginLeft: -6, marginTop: -6 }}
            initial={{ x: particleStartX, y: particleStartY, opacity: 1, scale: 1.8 }}
            animate={{ x: 0, y: 0, opacity: 0, scale: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: liteMode ? 0.45 : 0.6, ease: "easeIn" }}
          />
        </AnimatePresence>

        <div className="absolute left-1/2 top-1/2 z-10 -translate-x-1/2 -translate-y-1/2">
          <motion.div
            className="flex h-[72px] w-[72px] flex-col items-center justify-center gap-0.5 rounded-2xl border-2 border-primary/60 bg-card shadow-glow-sm"
            animate={
              liteMode
                ? undefined
                : {
                    boxShadow: [
                      "0 0 0px 0 hsl(var(--primary)/0.4)",
                      "0 0 20px 10px hsl(var(--primary)/0.08)",
                      "0 0 0px 0 hsl(var(--primary)/0.4)",
                    ],
                  }
            }
            transition={liteMode ? undefined : { duration: 2.5, repeat: Infinity }}
          >
            <span className="text-[8px] font-semibold uppercase tracking-widest leading-none text-muted-foreground">YOUR</span>
            <span className="text-[8px] font-semibold uppercase tracking-widest leading-none text-muted-foreground">POST</span>
            <motion.span
              className="mt-1 text-[11px] font-mono font-bold leading-none text-gain"
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

      <div className="mt-3 flex h-6 items-center overflow-hidden rounded-lg border border-border/40 bg-card/50 px-3">
        <AnimatePresence mode="wait">
          {lastBuy ? (
            <motion.div
              key={buyFeedKey}
              className="w-full text-[11px] font-mono text-gain"
              initial={{ y: 10, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: -10, opacity: 0 }}
              transition={{ duration: 0.2 }}
            >
              {"->"} {lastBuy} {"->"} <span className="font-bold text-foreground">+0.5%</span> to you
            </motion.div>
          ) : (
            <motion.div key="idle" className="w-full text-[11px] text-muted-foreground" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
              Waiting for trades from your post...
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div className="mt-3 flex gap-3">
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
          <div className="mt-0.5 text-[11px] text-muted-foreground">Fees Earned</div>
        </div>
        <div className="flex-1 rounded-xl border border-border/50 bg-card/60 p-3 text-center">
          <div className="text-xl font-mono font-bold">{tradeCount}</div>
          <div className="mt-0.5 text-[11px] text-muted-foreground">Trades from Post</div>
        </div>
      </div>
    </div>
  );
}
