import { cn } from "@/lib/utils";

type BrandLogoSize = "sm" | "md" | "lg";

interface BrandLogoProps {
  size?: BrandLogoSize;
  showTagline?: boolean;
  className?: string;
  markClassName?: string;
}

const sizeMap: Record<BrandLogoSize, { mark: string; title: string; subtitle: string }> = {
  sm: {
    mark: "h-10 w-10 rounded-xl",
    title: "text-sm",
    subtitle: "text-[8px]",
  },
  md: {
    mark: "h-11 w-11 rounded-xl",
    title: "text-base",
    subtitle: "text-[10px]",
  },
  lg: {
    mark: "h-14 w-14 rounded-2xl",
    title: "text-lg",
    subtitle: "text-[11px]",
  },
};

export function BrandLogo({
  size = "md",
  showTagline = false,
  className,
  markClassName,
}: BrandLogoProps) {
  const styles = sizeMap[size];
  const gapClass = showTagline ? (size === "lg" ? "gap-3.5" : "gap-3") : "gap-2.5";

  return (
    <div className={cn("flex items-center", gapClass, className)}>
      <div
        className={cn(
          "relative shrink-0 overflow-hidden p-1",
          "border border-white/10 bg-[linear-gradient(180deg,rgba(8,12,16,0.94),rgba(6,10,14,0.9))]",
          "shadow-[0_0_0_1px_hsl(var(--primary)/0.08),0_10px_25px_-14px_rgba(0,0,0,0.7)]",
          styles.mark,
          markClassName
        )}
      >
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_28%,rgba(123,255,92,0.16),transparent_58%),radial-gradient(circle_at_76%_30%,rgba(52,227,210,0.14),transparent_60%)]" />
        <img src="/phew-mark.svg" alt="" aria-hidden="true" className="relative h-full w-full object-contain scale-[1.04]" />
      </div>

      <div className="leading-tight min-w-0">
        <div
          className={cn(
            "font-extrabold tracking-tight uppercase leading-none",
            showTagline && "drop-shadow-[0_2px_8px_rgba(0,0,0,0.35)]",
            styles.title
          )}
        >
          <span className="text-foreground">PHEW</span>
          <span className="bg-gradient-to-r from-[#A9FF34] via-[#76FF44] to-[#41E8CF] bg-clip-text text-transparent">.RUN</span>
        </div>
        {showTagline ? (
          <div
            className={cn(
              "mt-0.5 text-white/80 tracking-[0.14em] uppercase leading-none",
              "drop-shadow-[0_1px_6px_rgba(0,0,0,0.28)]",
              styles.subtitle
            )}
          >
            Phew Running The Internet
          </div>
        ) : null}
      </div>
    </div>
  );
}
