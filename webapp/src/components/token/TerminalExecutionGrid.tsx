import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

type TerminalExecutionGridProps = {
  chart: ReactNode;
  trade: ReactNode;
  intelligence: ReactNode;
  className?: string;
};

export function TerminalExecutionGrid({
  chart,
  trade,
  intelligence,
  className,
}: TerminalExecutionGridProps) {
  return (
    <div
      className={cn(
        "grid gap-3 2xl:grid-cols-[minmax(760px,1fr)_340px_318px] xl:grid-cols-[minmax(620px,1fr)_340px] xl:items-start",
        className
      )}
    >
      <div className="min-w-0 space-y-3">{chart}</div>
      <div className="min-w-0 space-y-3 xl:sticky xl:top-3">{trade}</div>
      <div className="min-w-0 space-y-3 xl:col-span-2 2xl:sticky 2xl:top-3 2xl:col-span-1">
        {intelligence}
      </div>
    </div>
  );
}
