import { FlowRouteIcon } from "@/components/login/LoginPageIcons";
import { cn } from "@/lib/utils";

interface AccuracyScoreCardProps {
  score?: number;
  trend?: number;
  trendLabel?: string;
  className?: string;
}

// Daily bar heights for the mini chart (representing daily wins)
const barHeights = [40, 65, 55, 80, 45, 70, 90];

export function AccuracyScoreCard({
  score = 87.3,
  trend = 12.4,
  trendLabel = "this month",
  className
}: AccuracyScoreCardProps) {
  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-xl border border-border bg-card p-4 sm:p-5",
        "transition-all duration-300 hover:border-primary/30",
        className
      )}
    >
      {/* Subtle glow effect */}
      <div
        className="absolute inset-0 opacity-20 pointer-events-none"
        style={{
          background: "radial-gradient(ellipse at 30% 30%, hsl(var(--gain) / 0.15), transparent 60%)"
        }}
      />

      <div className="relative z-10">
        {/* Label */}
        <div className="mb-2.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground sm:mb-3 sm:text-xs">
          Accuracy Score
        </div>

        {/* Score and Chart Row */}
        <div className="flex flex-col gap-3 min-[390px]:flex-row min-[390px]:items-end min-[390px]:justify-between sm:gap-4">
          {/* Score Section */}
          <div className="flex flex-col">
            {/* Large Percentage */}
            <div
              className="text-[2rem] font-bold tracking-tight sm:text-4xl md:text-5xl"
              style={{ color: "hsl(var(--gain))" }}
            >
              {score.toFixed(1)}%
            </div>

            {/* Trend Indicator */}
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5 sm:mt-2">
              <FlowRouteIcon
                className="h-3.5 w-3.5 sm:h-4 sm:w-4"
                style={{ color: "hsl(var(--gain))" }}
              />
              <span
                className="text-xs font-medium sm:text-sm"
                style={{ color: "hsl(var(--gain))" }}
              >
                +{trend.toFixed(1)}%
              </span>
              <span className="text-xs text-muted-foreground sm:text-sm">
                {trendLabel}
              </span>
            </div>
          </div>

          {/* Mini Bar Chart */}
          <div className="flex h-14 items-end gap-1 sm:self-start min-[390px]:self-auto sm:h-16 sm:gap-1.5">
            {barHeights.map((height, index) => (
              <div
                key={index}
                className="w-2 rounded-sm transition-all duration-300 sm:w-2.5"
                style={{
                  height: `${height}%`,
                  backgroundColor: index === barHeights.length - 1
                    ? "hsl(var(--gain))"
                    : "hsl(var(--gain) / 0.3)",
                }}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
