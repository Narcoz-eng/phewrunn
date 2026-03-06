import { useEffect, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  ArrowDownRight,
  ArrowUpRight,
  ShieldCheck,
  ShieldAlert,
  Sparkles,
} from "lucide-react";
import { LevelBar } from "@/components/feed/LevelBar";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";

type ReputationFrame = {
  id: string;
  label: string;
  title: string;
  fromLevel: number;
  level: number;
  description: string;
  tone: "positive" | "neutral" | "negative";
  metrics: Array<{
    label: string;
    value: number;
  }>;
  footnote: string;
  icon: typeof ArrowUpRight;
};

const REPUTATION_FRAMES: ReputationFrame[] = [
  {
    id: "clean-win",
    label: "Win Settled",
    title: "A win above 3% moves your level up immediately.",
    fromLevel: 0,
    level: 1,
    description:
      "The market sees receipts, not promises. A strong win adds public proof to your profile. Smaller wins can still add XP even when they do not move your level.",
    tone: "positive",
    metrics: [
      { label: "Trust", value: 68 },
      { label: "Reach", value: 56 },
      { label: "Buyer Flow", value: 52 },
    ],
    footnote: "Strong wins move level fast.",
    icon: ArrowUpRight,
  },
  {
    id: "soft-recovery",
    label: "Recovery Window",
    title: "Losses under 30% get a 6H recovery window before any penalty.",
    fromLevel: 0,
    level: 0,
    description:
      "Soft misses do not level you down at 1H. If the trade recovers by 6H, your level stays intact instead of taking a delayed hit.",
    tone: "neutral",
    metrics: [
      { label: "Trust", value: 60 },
      { label: "Reach", value: 51 },
      { label: "Buyer Flow", value: 44 },
    ],
    footnote: "Discipline protects edge.",
    icon: ShieldCheck,
  },
  {
    id: "veteran-streak",
    label: "Veteran Unlock",
    title: "Reach LVL +5 and Veteran protection turns on.",
    fromLevel: 4,
    level: 5,
    description:
      "Consistent wins compound into trust. Once you hit LVL +5, softer drawdowns become less punishing and your profile carries more earned weight.",
    tone: "positive",
    metrics: [
      { label: "Trust", value: 86 },
      { label: "Reach", value: 78 },
      { label: "Buyer Flow", value: 81 },
    ],
    footnote: "Good calls create gravity.",
    icon: Sparkles,
  },
  {
    id: "severe-loss",
    label: "Severe Loss",
    title: "A severe loss costs a full level immediately.",
    fromLevel: 5,
    level: 4,
    description:
      "Losses of 30% or worse do not get a recovery window. They settle fast, hit your public level, and cool trust until you rebuild it.",
    tone: "negative",
    metrics: [
      { label: "Trust", value: 48 },
      { label: "Reach", value: 39 },
      { label: "Buyer Flow", value: 34 },
    ],
    footnote: "30%+ losses skip recovery.",
    icon: ShieldAlert,
  },
];

const toneClasses: Record<ReputationFrame["tone"], string> = {
  positive:
    "border-gain/25 bg-gain/10 text-gain shadow-[0_12px_30px_-24px_hsl(var(--gain)/0.7)]",
  neutral:
    "border-primary/20 bg-primary/10 text-primary shadow-[0_12px_30px_-24px_hsl(var(--primary)/0.65)]",
  negative:
    "border-loss/25 bg-loss/10 text-loss shadow-[0_12px_30px_-24px_hsl(var(--loss)/0.65)]",
};

const meterClasses: Record<ReputationFrame["tone"], string> = {
  positive: "from-gain to-emerald-300",
  neutral: "from-primary to-accent",
  negative: "from-loss to-rose-300",
};

function formatLevelValue(level: number) {
  return `LVL ${level > 0 ? `+${level}` : level}`;
}

function formatLevelDelta(fromLevel: number, level: number) {
  const delta = level - fromLevel;
  if (delta > 0) {
    return `+${delta} LVL`;
  }
  if (delta < 0) {
    return `${delta} LVL`;
  }
  return "0 LVL";
}

export function ReputationEngine() {
  const isMobile = useIsMobile();
  const reducedMotion = useReducedMotion();
  const [activeIndex, setActiveIndex] = useState(0);
  const activeFrame = REPUTATION_FRAMES[activeIndex];

  useEffect(() => {
    if (reducedMotion) {
      return;
    }
    const interval = window.setInterval(() => {
      setActiveIndex((current) => (current + 1) % REPUTATION_FRAMES.length);
    }, isMobile ? 4200 : 3200);

    return () => window.clearInterval(interval);
  }, [isMobile, reducedMotion]);

  return (
    <div className="rounded-[28px] border border-primary/15 bg-[linear-gradient(180deg,hsl(var(--card)/0.92),hsl(var(--background)/0.88))] p-5 sm:p-6 shadow-[0_24px_80px_-44px_hsl(var(--primary)/0.45)]">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-[10px] uppercase tracking-[0.28em] text-primary/75">
            Reputation Engine
          </div>
          <h3 className="mt-2 text-lg font-semibold tracking-tight sm:text-xl">
            Good calls lift you. Bad calls cool you off.
          </h3>
        </div>
        <div className="rounded-full border border-border/50 bg-background/60 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
          Public by design
        </div>
      </div>

      <div className="mt-5 grid gap-4 xl:grid-cols-[1.12fr_0.88fr]">
        <div className="rounded-[24px] border border-border/45 bg-background/55 p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="space-y-1">
              <div className="text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
                Active outcome
              </div>
              <div className="text-sm font-semibold tracking-tight text-foreground">
                {activeFrame.label}
              </div>
            </div>
            <div
              className={cn(
                "rounded-2xl border px-3 py-2 text-sm font-mono font-bold",
                toneClasses[activeFrame.tone]
              )}
            >
              {formatLevelDelta(activeFrame.fromLevel, activeFrame.level)}
            </div>
          </div>

          <AnimatePresence mode="wait">
            <motion.div
              key={activeFrame.id}
              className="mt-4 space-y-4"
              initial={reducedMotion ? false : { opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={reducedMotion ? undefined : { opacity: 0, y: -10 }}
              transition={{ duration: reducedMotion ? 0 : 0.24, ease: "easeOut" }}
            >
              <div>
                <h4 className="max-w-[28rem] text-xl font-semibold tracking-tight sm:text-2xl">
                  {activeFrame.title}
                </h4>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                  {activeFrame.description}
                </p>
              </div>

              <div className="rounded-2xl border border-border/45 bg-card/65 p-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-xs font-medium text-muted-foreground">
                    Example level state
                  </div>
                  <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                    Example only
                  </div>
                </div>
                <div className="mt-3">
                  <LevelBar
                    level={activeFrame.level}
                    size={isMobile ? "md" : "lg"}
                    showLabel={false}
                  />
                </div>
                <p className="mt-2 text-[11px] text-muted-foreground">
                  Example only. Your public level changes only from your own settled posts.
                </p>
                <div className="mt-4 grid grid-cols-3 gap-2">
                  {activeFrame.metrics.map((metric) => (
                    <div
                      key={metric.label}
                      className="rounded-2xl border border-border/40 bg-background/55 px-3 py-3"
                    >
                      <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                        {metric.label}
                      </div>
                      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-border/60">
                        <motion.div
                          className={cn(
                            "h-full rounded-full bg-gradient-to-r",
                            meterClasses[activeFrame.tone]
                          )}
                          initial={reducedMotion ? false : { width: "0%" }}
                          animate={{ width: `${metric.value}%` }}
                          transition={{ duration: reducedMotion ? 0 : 0.35, ease: "easeOut" }}
                        />
                      </div>
                      <div className="mt-2 text-sm font-semibold tracking-tight">
                        {metric.value}%
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </motion.div>
          </AnimatePresence>
        </div>

        <div className="space-y-3">
          <div className="rounded-[24px] border border-border/45 bg-card/60 p-4">
            <div className="text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
              Outcome tape
            </div>
            <div className="mt-3 space-y-2">
              {REPUTATION_FRAMES.map((frame, index) => {
                const isActive = index === activeIndex;
                const Icon = frame.icon;
                return (
                  <button
                    key={frame.id}
                    type="button"
                    onClick={() => setActiveIndex(index)}
                    className={cn(
                      "w-full rounded-2xl border px-3 py-3 text-left transition-all duration-200",
                      isActive
                        ? "border-primary/30 bg-primary/10 shadow-[0_18px_40px_-32px_hsl(var(--primary)/0.55)]"
                        : "border-border/45 bg-background/45 hover:border-primary/20 hover:bg-background/65"
                    )}
                  >
                    <div className="flex items-start gap-3">
                      <div
                        className={cn(
                          "mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl border",
                          toneClasses[frame.tone]
                        )}
                      >
                        <Icon className="h-4 w-4" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-3">
                          <div className="text-sm font-semibold tracking-tight">
                            {frame.label}
                          </div>
                          <div className="text-xs font-mono font-bold text-muted-foreground whitespace-nowrap">
                            {formatLevelDelta(frame.fromLevel, frame.level)}
                          </div>
                        </div>
                        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                          {frame.footnote}
                        </p>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="rounded-[24px] border border-primary/18 bg-[linear-gradient(180deg,hsl(var(--primary)/0.1),transparent_75%)] p-4">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-primary/25 bg-primary/10">
                <ArrowDownRight className="h-4 w-4 text-primary" />
              </div>
              <div>
                <div className="text-sm font-semibold tracking-tight">
                  Signal quality compounds harder than volume.
                </div>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  Anyone can publish. The accounts that hold attention are the ones
                  that keep earning higher levels through outcomes the market can
                  verify in public.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
