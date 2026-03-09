import { useEffect, useState } from "react";
import { Coins, Loader2, Radar, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

interface TokenScanningStateProps {
  address?: string | null;
  title?: string;
  subtitle?: string;
  compact?: boolean;
  className?: string;
}

const DEFAULT_SCAN_STEPS = [
  {
    label: "Liquidity map",
    hint: "Routing live pools, market depth, and volume pressure.",
    Icon: Coins,
  },
  {
    label: "Holder graph",
    hint: "Tracing wallet concentration and early holder expansion.",
    Icon: Radar,
  },
  {
    label: "Bundle scan",
    hint: "Estimating bundled clusters and coordinated supply pockets.",
    Icon: Sparkles,
  },
  {
    label: "Conviction pass",
    hint: "Locking confidence, timing, and momentum signals.",
    Icon: Loader2,
  },
] as const;
const SCAN_LOOP_INTERVAL_MS = 1450;

function truncateAddress(address: string | null | undefined): string | null {
  const normalized = address?.trim();
  if (!normalized) return null;
  if (normalized.length <= 18) return normalized;
  return `${normalized.slice(0, 8)}...${normalized.slice(-6)}`;
}

export function TokenScanningState({
  address,
  title = "Scanning token",
  subtitle = "Building liquidity, holder, timing, and bundle signals.",
  compact = false,
  className,
}: TokenScanningStateProps) {
  const displayAddress = truncateAddress(address);
  const [activeStepIndex, setActiveStepIndex] = useState(0);

  useEffect(() => {
    const interval = window.setInterval(() => {
      setActiveStepIndex((current) => (current + 1) % DEFAULT_SCAN_STEPS.length);
    }, SCAN_LOOP_INTERVAL_MS);

    return () => window.clearInterval(interval);
  }, []);

  const activeStep = DEFAULT_SCAN_STEPS[activeStepIndex];
  const ActiveStepIcon = activeStep.Icon;
  const progressWidth = `${((activeStepIndex + 1) / DEFAULT_SCAN_STEPS.length) * 100}%`;

  if (compact) {
    return (
      <div
        className={cn(
          "relative overflow-hidden rounded-[20px] border border-primary/25 bg-[radial-gradient(circle_at_top_left,hsl(var(--primary)/0.2),transparent_52%),linear-gradient(135deg,hsl(var(--primary)/0.12),hsl(var(--background))_78%)] px-3.5 py-3.5 shadow-[0_26px_60px_-34px_hsl(var(--primary)/0.55)]",
          className
        )}
      >
        <div className="absolute inset-0 bg-[linear-gradient(120deg,transparent,rgba(255,255,255,0.06),transparent)] opacity-70" />
        <div className="relative flex items-start gap-3">
          <div className="relative flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-primary/30 bg-primary/12">
            <span className="absolute inset-0 rounded-full border border-primary/30 animate-ping" />
            <Radar className="h-4.5 w-4.5 animate-[spin_5.8s_linear_infinite] text-primary" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full border border-primary/30 bg-primary/12 px-2 py-1 text-[9px] font-black uppercase tracking-[0.24em] text-primary">
                Phew Ultra
              </span>
              <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-primary/80">
                Live scan loop
              </span>
            </div>
            <div className="mt-2 flex items-center gap-2">
              <span className="text-sm font-semibold text-foreground">{title}</span>
              <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
            </div>
            <p className="mt-1 text-xs text-muted-foreground">{activeStep.hint}</p>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-primary/10">
              <div
                className="h-full rounded-full bg-gradient-to-r from-primary via-emerald-300 to-primary transition-all duration-500"
                style={{ width: progressWidth }}
              />
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {DEFAULT_SCAN_STEPS.map((step, index) => (
                <span
                  key={step.label}
                  className={cn(
                    "rounded-full border px-2 py-1 text-[10px] font-medium transition-colors",
                    index === activeStepIndex
                      ? "border-primary/35 bg-primary/14 text-foreground"
                      : "border-border/60 bg-white/60 text-muted-foreground dark:bg-white/[0.04]"
                  )}
                >
                  {step.label}
                </span>
              ))}
            </div>
            {displayAddress ? (
              <div className="mt-2 font-mono text-[11px] text-primary/80">{displayAddress}</div>
            ) : (
              <p className="mt-2 text-[11px] text-muted-foreground">{subtitle}</p>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <section
      className={cn(
        "app-surface relative overflow-hidden border-primary/20 bg-[radial-gradient(circle_at_top_left,hsl(var(--primary)/0.18),transparent_48%),radial-gradient(circle_at_bottom_right,hsl(var(--primary)/0.12),transparent_42%),linear-gradient(180deg,hsl(var(--background)),hsl(var(--background)))] p-6 sm:p-7",
        className
      )}
    >
      <div className="absolute -left-20 top-8 h-44 w-44 rounded-full bg-primary/12 blur-3xl" />
      <div className="absolute -right-12 bottom-0 h-36 w-36 rounded-full bg-emerald-400/10 blur-3xl" />
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary/45 to-transparent" />
      <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
        <div className="relative max-w-xl">
          <div className="inline-flex items-center gap-2 rounded-full border border-primary/25 bg-primary/12 px-3 py-1 text-[11px] font-black uppercase tracking-[0.22em] text-primary">
            <Sparkles className="h-3.5 w-3.5" />
            Phew Ultra Token Lab
          </div>
          <h2 className="mt-4 text-2xl font-bold text-foreground sm:text-3xl">{title}</h2>
          <p className="mt-2 text-sm text-muted-foreground sm:text-base">{subtitle}</p>
          <div className="mt-4 flex items-center gap-2 text-sm text-primary">
            <div className="relative flex h-3 w-3">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary/70" />
              <span className="relative inline-flex h-3 w-3 rounded-full bg-primary" />
            </div>
            <span className="font-semibold">{activeStep.hint}</span>
          </div>
          {displayAddress ? (
            <div className="mt-3 inline-flex items-center rounded-full border border-border/60 bg-secondary px-3 py-1.5 font-mono text-xs text-muted-foreground">
              {displayAddress}
            </div>
          ) : null}
        </div>

        <div className="relative lg:min-w-[420px]">
          <div className="rounded-[28px] border border-primary/20 bg-[linear-gradient(145deg,hsl(var(--background)),hsl(var(--background)))] p-4 shadow-[0_28px_80px_-42px_hsl(var(--primary)/0.4)]">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-[10px] font-black uppercase tracking-[0.22em] text-primary/80">
                  Scan progress
                </div>
                <div className="mt-1 text-lg font-semibold text-foreground">{activeStep.label}</div>
              </div>
              <div className="relative flex h-14 w-14 items-center justify-center rounded-full border border-primary/25 bg-primary/10">
                <span className="absolute inset-1 rounded-full border border-primary/20" />
                <ActiveStepIcon
                  className={cn(
                    "h-6 w-6 text-primary",
                    ActiveStepIcon === Loader2 ? "animate-spin" : "animate-pulse"
                  )}
                />
              </div>
            </div>

            <div className="mt-4 h-2 overflow-hidden rounded-full bg-primary/10">
              <div
                className="h-full rounded-full bg-gradient-to-r from-primary via-emerald-300 to-primary transition-all duration-500"
                style={{ width: progressWidth }}
              />
            </div>

            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              {DEFAULT_SCAN_STEPS.map((step, index) => (
                <div
                  key={step.label}
                  className={cn(
                    "rounded-[20px] border p-4 transition-all duration-300",
                    index === activeStepIndex
                      ? "border-primary/35 bg-primary/10 shadow-[0_20px_40px_-30px_hsl(var(--primary)/0.65)]"
                      : index < activeStepIndex
                        ? "border-emerald-400/25 bg-emerald-400/8"
                        : "border-border/60 bg-white/55 shadow-[inset_0_1px_0_hsl(0_0%_100%/0.7)] dark:bg-white/[0.03] dark:shadow-none"
                  )}
                >
                  {(() => {
                    const StepIcon = step.Icon;
                    return (
                      <>
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                      Step {index + 1}
                    </div>
                    <StepIcon
                      className={cn(
                        "h-4 w-4",
                        index === activeStepIndex
                          ? "text-primary"
                          : index < activeStepIndex
                            ? "text-emerald-400"
                            : "text-muted-foreground"
                      )}
                    />
                  </div>
                  <div className="mt-2 text-sm font-semibold text-foreground">{step.label}</div>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">{step.hint}</p>
                      </>
                    );
                  })()}
                </div>
              ))}
            </div>

            <div className="mt-4 rounded-[18px] border border-primary/15 bg-primary/8 px-3.5 py-3 text-sm text-muted-foreground">
              The scan loop keeps running until liquidity, holder, bundle, and conviction outputs lock into the live token page.
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
