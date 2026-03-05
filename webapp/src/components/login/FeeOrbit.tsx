import { motion, AnimatePresence } from "framer-motion";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

interface OrbitalUser {
  id: number;
  radius: number;
  duration: number;
  initAngle: number;
  label: string;
}

const ORBITAL_USERS: OrbitalUser[] = [
  { id: 1, radius: 90, duration: 14, initAngle: 0, label: "@whale" },
  { id: 2, radius: 82, duration: 10, initAngle: 45, label: "@bull" },
  { id: 3, radius: 95, duration: 18, initAngle: 90, label: "@degen" },
  { id: 4, radius: 86, duration: 12, initAngle: 135, label: "@alpha" },
  { id: 5, radius: 91, duration: 16, initAngle: 180, label: "@hodl" },
  { id: 6, radius: 83, duration: 11, initAngle: 225, label: "@moon" },
  { id: 7, radius: 88, duration: 15, initAngle: 270, label: "@chad" },
  { id: 8, radius: 79, duration: 13, initAngle: 315, label: "@ape" },
];

export function FeeOrbit() {
  const [visibleCount, setVisibleCount] = useState(0);
  const [totalFees, setTotalFees] = useState(0);
  const [activePulse, setActivePulse] = useState<number | null>(null);
  const [particleKey, setParticleKey] = useState(0);
  const [particleAngle, setParticleAngle] = useState(0);
  const [particleRadius, setParticleRadius] = useState(90);

  // Users appear one by one with stagger
  useEffect(() => {
    if (visibleCount >= ORBITAL_USERS.length) return;
    const t = setTimeout(() => setVisibleCount((v) => v + 1), 300);
    return () => clearTimeout(t);
  }, [visibleCount]);

  // Fee accumulation loop
  useEffect(() => {
    if (visibleCount === 0) return;
    const interval = setInterval(() => {
      const idx = Math.floor(Math.random() * visibleCount);
      const user = ORBITAL_USERS[idx];
      if (!user) return;
      setActivePulse(idx);
      setParticleAngle(user.initAngle);
      setParticleRadius(user.radius);
      setParticleKey((k) => k + 1);
      setTotalFees((prev) => prev + 0.5);
      setTimeout(() => setActivePulse(null), 700);
    }, 700);
    return () => clearInterval(interval);
  }, [visibleCount]);

  const particleStartX =
    Math.cos((particleAngle * Math.PI) / 180) * particleRadius;
  const particleStartY =
    Math.sin((particleAngle * Math.PI) / 180) * particleRadius;

  return (
    <div className="select-none">
      {/* Label */}
      <div className="text-center mb-3">
        <div className="inline-flex items-center gap-2 text-xs text-muted-foreground">
          <span className="inline-block w-2 h-2 rounded-full bg-gain animate-pulse" />
          Live simulation — every follower generates 0.5% fee
        </div>
      </div>

      <div className="relative w-[260px] h-[260px] mx-auto">
        {/* Background orbital rings */}
        <svg
          className="absolute inset-0 w-full h-full pointer-events-none"
          viewBox="0 0 260 260"
          fill="none"
        >
          <circle
            cx="130"
            cy="130"
            r="82"
            stroke="hsl(var(--primary)/0.18)"
            strokeWidth="1"
            strokeDasharray="4 8"
          />
          <circle
            cx="130"
            cy="130"
            r="97"
            stroke="hsl(var(--primary)/0.08)"
            strokeWidth="1"
            strokeDasharray="3 12"
          />
          {/* Radial connection lines (static) */}
          {ORBITAL_USERS.slice(0, visibleCount).map((user) => {
            const rad = (user.initAngle * Math.PI) / 180;
            const x = 130 + Math.cos(rad) * user.radius;
            const y = 130 + Math.sin(rad) * user.radius;
            return (
              <motion.line
                key={user.id}
                x1="130"
                y1="130"
                x2={x}
                y2={y}
                stroke="hsl(var(--gain)/0.18)"
                strokeWidth="0.75"
                strokeDasharray="3 5"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.4 }}
              />
            );
          })}
        </svg>

        {/* Orbiting users */}
        {ORBITAL_USERS.slice(0, visibleCount).map((user, i) => (
          <motion.div
            key={user.id}
            className="absolute top-1/2 left-1/2"
            style={{
              width: user.radius * 2,
              height: user.radius * 2,
              marginLeft: -user.radius,
              marginTop: -user.radius,
            }}
            initial={{ opacity: 0, scale: 0.3 }}
            animate={{
              opacity: 1,
              scale: 1,
              rotate: [user.initAngle, user.initAngle + 360],
            }}
            transition={{
              opacity: { duration: 0.3 },
              scale: { duration: 0.3 },
              rotate: {
                duration: user.duration,
                ease: "linear",
                repeat: Infinity,
              },
            }}
          >
            <motion.div
              className={cn(
                "absolute w-8 h-8 rounded-full border-2 flex items-center justify-center font-bold transition-colors duration-200 text-[9px]",
                activePulse === i
                  ? "bg-gain/20 border-gain/60 text-gain"
                  : "bg-card border-border/60 text-muted-foreground"
              )}
              style={{ top: -16, left: "50%", marginLeft: -16 }}
              animate={{
                rotate: [-user.initAngle, -(user.initAngle + 360)],
              }}
              transition={{
                duration: user.duration,
                ease: "linear",
                repeat: Infinity,
              }}
            >
              {user.label.slice(1, 3).toUpperCase()}
            </motion.div>
          </motion.div>
        ))}

        {/* Fee particle flying to center */}
        <AnimatePresence>
          <motion.div
            key={particleKey}
            className="absolute top-1/2 left-1/2 w-3 h-3 rounded-full bg-gain pointer-events-none z-20"
            style={{ marginLeft: -6, marginTop: -6 }}
            initial={{ x: particleStartX, y: particleStartY, opacity: 1, scale: 1.8 }}
            animate={{ x: 0, y: 0, opacity: 0, scale: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.6, ease: "easeIn" }}
          />
        </AnimatePresence>

        {/* Center caller node */}
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-10">
          <motion.div
            className="w-[66px] h-[66px] rounded-full bg-card border-2 border-primary/60 flex flex-col items-center justify-center gap-0.5 shadow-glow-sm"
            animate={{
              boxShadow: [
                "0 0 0px 0 hsl(var(--primary)/0.4)",
                "0 0 20px 10px hsl(var(--primary)/0.08)",
                "0 0 0px 0 hsl(var(--primary)/0.4)",
              ],
            }}
            transition={{ duration: 2.5, repeat: Infinity }}
          >
            <span className="text-[8px] font-semibold text-muted-foreground uppercase tracking-widest">
              YOU
            </span>
            <motion.span
              className="text-[12px] font-mono font-bold text-gain leading-none"
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

      {/* Stats row */}
      <div className="flex gap-3 mt-4">
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
          <div className="text-[11px] text-muted-foreground mt-0.5">
            Fees Earned
          </div>
        </div>
        <div className="flex-1 rounded-xl border border-border/50 bg-card/60 p-3 text-center">
          <div className="text-xl font-mono font-bold">{visibleCount}</div>
          <div className="text-[11px] text-muted-foreground mt-0.5">
            Followers
          </div>
        </div>
      </div>
    </div>
  );
}
