import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

type V2SurfaceTone = "default" | "soft" | "muted" | "accent";

const toneClassMap: Record<V2SurfaceTone, string> = {
  default: "v2-surface",
  soft: "v2-surface v2-surface-soft",
  muted: "v2-surface bg-[linear-gradient(180deg,rgba(13,18,20,0.92),rgba(8,12,14,0.96))]",
  accent:
    "v2-surface bg-[radial-gradient(circle_at_top_left,rgba(169,255,52,0.14),transparent_34%),linear-gradient(180deg,rgba(10,16,14,0.98),rgba(6,11,12,0.98))]",
};

export function V2Surface({
  className,
  tone = "default",
  ...props
}: HTMLAttributes<HTMLDivElement> & { tone?: V2SurfaceTone }) {
  return <div className={cn(toneClassMap[tone], className)} {...props} />;
}
