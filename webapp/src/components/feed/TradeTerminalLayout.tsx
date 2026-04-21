import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function TradeTerminalLayout({
  left,
  right,
  className,
  leftClassName,
  rightClassName,
}: {
  left: ReactNode;
  right: ReactNode;
  className?: string;
  leftClassName?: string;
  rightClassName?: string;
}) {
  return (
    <div
      className={cn(
        "grid gap-3 lg:min-h-0 lg:grid-cols-[minmax(0,1.25fr)_minmax(300px,0.75fr)] lg:items-start",
        className
      )}
    >
      <div className={cn("space-y-3 lg:min-h-0 lg:max-h-[min(74vh,58rem)] lg:overflow-y-auto lg:pr-1", leftClassName)}>
        {left}
      </div>
      <div className={cn("relative z-10 flex min-h-0 flex-col gap-3 self-start lg:max-h-[min(74vh,58rem)] lg:overflow-y-auto lg:pr-1", rightClassName)}>
        {right}
      </div>
    </div>
  );
}
