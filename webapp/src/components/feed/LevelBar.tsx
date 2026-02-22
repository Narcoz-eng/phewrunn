import { cn } from "@/lib/utils";
import { MIN_LEVEL, MAX_LEVEL, LIQUIDATION_LEVEL } from "@/types";
import { getLevelColor, getLevelLabel, isInDangerZone, getDangerMessage } from "@/lib/level-utils";
import { AlertTriangle, Skull } from "lucide-react";

interface LevelBarProps {
  level: number;
  showLabel?: boolean;
  showWarningBanner?: boolean;
  size?: "sm" | "md" | "lg" | "xl";
  className?: string;
}

export function LevelBar({ level, showLabel = true, showWarningBanner = false, size = "md", className }: LevelBarProps) {
  // Normalize level to 0-100 scale (where -5 = 0, 10 = 100)
  const totalRange = MAX_LEVEL - MIN_LEVEL; // 15
  const normalizedLevel = ((level - MIN_LEVEL) / totalRange) * 100;

  const colors = getLevelColor(level);
  const levelLabel = getLevelLabel(level);
  const isLiquidated = level <= LIQUIDATION_LEVEL;
  const inDangerZone = isInDangerZone(level);
  const dangerMessage = getDangerMessage(level);

  const sizeClasses = {
    sm: "h-2",
    md: "h-3",
    lg: "h-5",
    xl: "h-8",
  };

  const labelSizeClasses = {
    sm: "text-[10px]",
    md: "text-xs",
    lg: "text-sm font-semibold",
    xl: "text-lg font-bold",
  };

  return (
    <div className={cn("space-y-2", className)}>
      {/* Warning Banner for dangerous levels */}
      {showWarningBanner && dangerMessage && (
        <div
          className={cn(
            "flex items-center gap-2 px-3 py-2 rounded-lg border animate-pulse",
            isLiquidated
              ? "bg-red-600/20 border-red-600 text-red-500"
              : "bg-red-500/10 border-red-400 text-red-300"
          )}
        >
          {isLiquidated ? (
            <Skull className="h-4 w-4 flex-shrink-0" />
          ) : (
            <AlertTriangle className="h-4 w-4 flex-shrink-0" />
          )}
          <span className="text-xs font-medium">{dangerMessage}</span>
        </div>
      )}

      <div className="flex items-center gap-3">
        {showLabel && (
          <div className="flex items-center gap-2">
            <span
              className={cn(
                "font-mono font-bold min-w-[3.5rem] tracking-tight",
                labelSizeClasses[size],
                colors.text
              )}
              style={{
                textShadow: level >= 8
                  ? "0 0 8px rgba(245,158,11,0.6)"
                  : level >= 4
                  ? "0 0 8px rgba(148,163,184,0.4)"
                  : level >= 1
                  ? "0 0 8px rgba(234,88,12,0.4)"
                  : level >= -2
                  ? "0 0 6px rgba(239,68,68,0.3)"
                  : "0 0 10px rgba(220,38,38,0.5)"
              }}
            >
              LVL {level > 0 ? `+${level}` : level}
            </span>
            <span className={cn("text-[10px] font-medium uppercase tracking-wider opacity-70", colors.text)}>
              {levelLabel}
            </span>
          </div>
        )}
        <div
          className={cn(
            "flex-1 min-w-[80px] rounded-full overflow-hidden relative",
            sizeClasses[size],
            "bg-secondary/80 border-2",
            colors.border,
            colors.glow
          )}
        >
          {/* Background segments for visual reference */}
          <div className="absolute inset-0 flex">
            {[...Array(15)].map((_, i) => (
              <div
                key={i}
                className={cn(
                  "flex-1 border-r border-border/20 last:border-r-0",
                  // Color segments based on level thresholds
                  i < 5 && "bg-red-600/10 dark:bg-red-600/15", // -5 to -1
                  i >= 5 && i < 6 && "bg-orange-600/10 dark:bg-orange-600/15", // 0
                  i >= 6 && i < 9 && "bg-orange-500/10 dark:bg-orange-500/15", // 1-3
                  i >= 9 && i < 13 && "bg-slate-400/10 dark:bg-slate-400/15", // 4-7
                  i >= 13 && "bg-amber-500/10 dark:bg-amber-500/15" // 8-10
                )}
              />
            ))}
          </div>

          {/* Progress fill with level-based color */}
          <div
            className={cn(
              "h-full rounded-full transition-all duration-500 ease-out relative z-10",
              colors.bg,
              colors.glow,
              isLiquidated && "animate-pulse"
            )}
            style={{
              width: `${Math.max(normalizedLevel, 3)}%`,
              background: level >= 8
                ? "linear-gradient(90deg, #f59e0b, #fbbf24)"
                : level >= 4
                ? "linear-gradient(90deg, #94a3b8, #cbd5e1)"
                : level >= 1
                ? "linear-gradient(90deg, #c2410c, #ea580c)"
                : level >= -2
                ? "linear-gradient(90deg, #dc2626, #f87171)"
                : "linear-gradient(90deg, #991b1b, #dc2626)"
            }}
          >
            {/* Animated shine effect */}
            <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/30 to-transparent rounded-full animate-shimmer" />
            {/* Top highlight */}
            <div className="absolute inset-x-0 top-0 h-1/2 bg-gradient-to-b from-white/25 to-transparent rounded-t-full" />
          </div>

          {/* Center marker at level 0 */}
          <div className="absolute top-0 bottom-0 left-1/3 w-0.5 bg-foreground/30 z-20" />
        </div>
      </div>
    </div>
  );
}

interface LevelBadgeProps {
  level: number;
  showLabel?: boolean;
  className?: string;
  size?: "sm" | "md" | "lg";
}

export function LevelBadge({ level, showLabel = false, className, size = "md" }: LevelBadgeProps) {
  const colors = getLevelColor(level);
  const label = getLevelLabel(level);
  const isLiquidated = level <= LIQUIDATION_LEVEL;

  const sizeClasses = {
    sm: "px-1.5 py-0 text-[10px] gap-1",
    md: "px-2 py-0.5 text-xs gap-1.5",
    lg: "px-3 py-1 text-sm gap-2",
  };

  return (
    <span
      className={cn(
        "inline-flex items-center justify-center rounded-md font-mono font-bold border transition-all",
        sizeClasses[size],
        colors.bg,
        colors.text,
        colors.border,
        colors.glow,
        isLiquidated && "animate-pulse",
        className
      )}
    >
      <span>{level > 0 ? `+${level}` : level}</span>
      {showLabel && (
        <span className="font-sans font-semibold opacity-80">{label}</span>
      )}
    </span>
  );
}
