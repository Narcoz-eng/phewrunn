import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { V2Surface } from "./V2Surface";

export function V2MetricCard({
  label,
  value,
  hint,
  accent,
  className,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  accent?: ReactNode;
  className?: string;
}) {
  return (
    <V2Surface className={cn("flex min-h-[132px] flex-col justify-between p-5", className)} tone="soft">
      <div className="flex items-start justify-between gap-4">
        <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-white/46">{label}</p>
        {accent ? <div className="shrink-0">{accent}</div> : null}
      </div>
      <div>
        <div className="text-2xl font-semibold tracking-tight text-white">{value}</div>
        {hint ? <div className="mt-2 text-sm text-white/48">{hint}</div> : null}
      </div>
    </V2Surface>
  );
}
