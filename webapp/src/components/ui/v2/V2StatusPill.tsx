import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

type V2StatusTone = "default" | "live" | "ai" | "risk" | "xp";

const toneStyles: Record<V2StatusTone, string> = {
  default: "border-white/10 bg-white/[0.04] text-white/70",
  live: "border-emerald-400/20 bg-emerald-400/10 text-emerald-300",
  ai: "border-cyan-400/20 bg-cyan-400/10 text-cyan-300",
  risk: "border-amber-400/20 bg-amber-400/10 text-amber-300",
  xp: "border-lime-400/20 bg-lime-400/10 text-lime-300",
};

export function V2StatusPill({
  children,
  tone = "default",
  className,
}: {
  children: ReactNode;
  tone?: V2StatusTone;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-2 rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em]",
        toneStyles[tone],
        className
      )}
    >
      {children}
    </span>
  );
}
