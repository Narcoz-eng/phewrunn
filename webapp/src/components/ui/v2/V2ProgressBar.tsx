import { cn } from "@/lib/utils";

function clampPercent(value: number | null | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, value));
}

export function V2ProgressBar({
  value,
  valueLabel,
  className,
  trackClassName,
  barClassName,
}: {
  value: number | null | undefined;
  valueLabel?: string | null;
  className?: string;
  trackClassName?: string;
  barClassName?: string;
}) {
  const pct = clampPercent(value);

  return (
    <div className={cn("space-y-2", className)}>
      <div className={cn("h-3 overflow-hidden rounded-full bg-white/8", trackClassName)}>
        <div
          className={cn(
            "h-full rounded-full bg-[linear-gradient(90deg,rgba(169,255,52,0.96),rgba(45,212,191,0.9))]",
            barClassName
          )}
          style={{ width: `${pct}%` }}
        />
      </div>
      {valueLabel ? (
        <div className="text-right text-[11px] font-medium tracking-[0.12em] text-white/42 uppercase">
          {valueLabel}
        </div>
      ) : null}
    </div>
  );
}
