import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function V2RightRailCard({
  eyebrow,
  title,
  badge,
  action,
  children,
  className,
  tone = "default",
}: {
  eyebrow?: string;
  title?: string;
  badge?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  tone?: "default" | "soft" | "accent";
}) {
  return (
    <section
      className={cn(
        "rounded-[28px] border p-5",
        tone === "accent"
          ? "border-lime-300/12 bg-[radial-gradient(circle_at_top_left,rgba(169,255,52,0.12),transparent_28%),linear-gradient(180deg,rgba(10,15,14,0.98),rgba(6,10,12,0.99))]"
          : tone === "soft"
            ? "border-white/8 bg-white/[0.03]"
            : "border-white/8 bg-[linear-gradient(180deg,rgba(8,12,18,0.96),rgba(5,9,13,0.99))]",
        className
      )}
    >
      {eyebrow || title || badge || action ? (
        <div className="flex items-start justify-between gap-3">
          <div>
            {eyebrow ? (
              <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-white/38">
                {eyebrow}
              </div>
            ) : null}
            {title ? <div className="mt-2 text-xl font-semibold text-white">{title}</div> : null}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {badge}
            {action}
          </div>
        </div>
      ) : null}
      <div className={cn(eyebrow || title || badge || action ? "mt-4" : undefined)}>{children}</div>
    </section>
  );
}
