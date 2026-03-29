import { memo, useEffect, useState } from "react";
import { cn } from "@/lib/utils";

type TradePanelLiveBadgeProps = {
  lastEventAtMs: number;
  usingFallbackPolling: boolean;
  mode: "stream" | "fallback" | "unavailable";
  className?: string;
};

const LIVE_FRESHNESS_WINDOW_MS = 10_000;

function resolveLiveBadgeState(
  lastEventAtMs: number,
  usingFallbackPolling: boolean,
  mode: "stream" | "fallback" | "unavailable",
  nowMs: number
) {
  const isFresh = lastEventAtMs > 0 && nowMs - lastEventAtMs <= LIVE_FRESHNESS_WINDOW_MS;
  if (mode === "unavailable") {
    return {
      isFresh: false,
      label: "Offline",
      tone: "offline" as const,
    };
  }
  if (isFresh && !usingFallbackPolling) {
    return {
      isFresh: true,
      label: "Live",
      tone: "live" as const,
    };
  }
  if (isFresh && usingFallbackPolling) {
    return {
      isFresh: true,
      label: "Polling",
      tone: "polling" as const,
    };
  }
  if (usingFallbackPolling) {
    return {
      isFresh: false,
      label: "Delayed",
      tone: "polling" as const,
    };
  }
  return {
    isFresh: false,
    label: lastEventAtMs > 0 ? "Reconnecting" : "Connecting",
    tone: "offline" as const,
  };
}

export const TradePanelLiveBadge = memo(function TradePanelLiveBadge({
  lastEventAtMs,
  usingFallbackPolling,
  mode,
  className,
}: TradePanelLiveBadgeProps) {
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    const interval = window.setInterval(() => {
      setNowMs(Date.now());
    }, 1_000);
    return () => window.clearInterval(interval);
  }, []);

  const badge = resolveLiveBadgeState(lastEventAtMs, usingFallbackPolling, mode, nowMs);

  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.18em]",
        badge.tone === "live"
          ? "bg-emerald-500/10 text-emerald-500"
          : badge.tone === "polling"
            ? "bg-amber-500/10 text-amber-600 dark:text-amber-300"
            : "bg-slate-900/[0.05] text-slate-500 dark:bg-white/[0.06] dark:text-white/40",
        className
      )}
    >
      {badge.label}
    </span>
  );
});
