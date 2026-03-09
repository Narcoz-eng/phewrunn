import { Loader2, Radar } from "lucide-react";
import { cn } from "@/lib/utils";

interface TokenScanningStateProps {
  address?: string | null;
  title?: string;
  subtitle?: string;
  compact?: boolean;
  className?: string;
}

const DEFAULT_SCAN_STEPS = ["Liquidity", "Holder map", "Bundle scan"];

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

  if (compact) {
    return (
      <div
        className={cn(
          "rounded-[18px] border border-primary/15 bg-[linear-gradient(135deg,hsl(var(--primary)/0.09),transparent)] px-3 py-3",
          className
        )}
      >
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-primary/20 bg-primary/10">
            <Radar className="h-4.5 w-4.5 text-primary" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-foreground">{title}</span>
              <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
            </div>
            <p className="mt-1 text-xs text-muted-foreground">{subtitle}</p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {DEFAULT_SCAN_STEPS.map((step) => (
                <span
                  key={step}
                  className="rounded-full border border-border/60 bg-white/60 px-2 py-1 text-[10px] font-medium text-muted-foreground dark:bg-white/[0.04]"
                >
                  {step}
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <section
      className={cn(
        "app-surface relative overflow-hidden border-primary/15 bg-[radial-gradient(circle_at_top_left,hsl(var(--primary)/0.15),transparent_50%),linear-gradient(180deg,hsl(var(--background)),hsl(var(--background)))] p-6 sm:p-7",
        className
      )}
    >
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary/45 to-transparent" />
      <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
        <div className="max-w-xl">
          <div className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-primary">
            <Radar className="h-3.5 w-3.5" />
            Token Intelligence
          </div>
          <h2 className="mt-4 text-2xl font-bold text-foreground sm:text-3xl">{title}</h2>
          <p className="mt-2 text-sm text-muted-foreground sm:text-base">{subtitle}</p>
          {displayAddress ? (
            <div className="mt-3 inline-flex items-center rounded-full border border-border/60 bg-secondary px-3 py-1.5 font-mono text-xs text-muted-foreground">
              {displayAddress}
            </div>
          ) : null}
        </div>

        <div className="grid gap-3 sm:grid-cols-3 lg:min-w-[360px]">
          {DEFAULT_SCAN_STEPS.map((step, index) => (
            <div
              key={step}
              className="rounded-[20px] border border-border/60 bg-white/55 p-4 shadow-[inset_0_1px_0_hsl(0_0%_100%/0.7)] dark:bg-white/[0.03] dark:shadow-none"
            >
              <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                Step {index + 1}
              </div>
              <div className="mt-2 text-sm font-semibold text-foreground">{step}</div>
              <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-secondary">
                <div
                  className="h-full rounded-full bg-primary/80 animate-pulse"
                  style={{ width: `${62 + index * 12}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
