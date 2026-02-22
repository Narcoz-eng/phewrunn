import { TrendingUp } from "lucide-react";
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
        "relative overflow-hidden rounded-xl border border-border bg-card p-5",
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
        <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">
          Accuracy Score
        </div>

        {/* Score and Chart Row */}
        <div className="flex items-end justify-between gap-4">
          {/* Score Section */}
          <div className="flex flex-col">
            {/* Large Percentage */}
            <div
              className="text-4xl md:text-5xl font-bold tracking-tight"
              style={{ color: "hsl(var(--gain))" }}
            >
              {score.toFixed(1)}%
            </div>

            {/* Trend Indicator */}
            <div className="flex items-center gap-1.5 mt-2">
              <TrendingUp
                className="w-4 h-4"
                style={{ color: "hsl(var(--gain))" }}
              />
              <span
                className="text-sm font-medium"
                style={{ color: "hsl(var(--gain))" }}
              >
                +{trend.toFixed(1)}%
              </span>
              <span className="text-sm text-muted-foreground">
                {trendLabel}
              </span>
            </div>
          </div>

          {/* Mini Bar Chart */}
          <div className="flex items-end gap-1.5 h-16">
            {barHeights.map((height, index) => (
              <div
                key={index}
                className="w-2.5 rounded-sm transition-all duration-300"
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
