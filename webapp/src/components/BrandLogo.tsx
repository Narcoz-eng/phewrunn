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
    mark: "h-9 w-9 rounded-xl",
    title: "text-sm",
    subtitle: "text-[9px]",
  },
  md: {
    mark: "h-10 w-10 rounded-xl",
    title: "text-sm",
    subtitle: "text-[11px]",
  },
  lg: {
    mark: "h-12 w-12 rounded-2xl",
    title: "text-base",
    subtitle: "text-xs",
  },
};

export function BrandLogo({
  size = "md",
  showTagline = false,
  className,
  markClassName,
}: BrandLogoProps) {
  const styles = sizeMap[size];

  if (showTagline) {
    return (
      <div className={cn("flex items-center", className)}>
        <div className="rounded-2xl border border-white/10 bg-white/[0.88] px-2.5 py-1.5 shadow-[0_12px_40px_-24px_rgba(0,0,0,0.55)] backdrop-blur">
          <img
            src="/phew-logo.svg"
            alt="Phew.run"
            className={cn(
              "w-auto object-contain",
              size === "sm" && "h-7 sm:h-8",
              size === "md" && "h-9",
              size === "lg" && "h-11"
            )}
          />
        </div>
      </div>
    );
  }

  return (
    <div className={cn("flex items-center gap-3", className)}>
      <div
        className={cn(
          "relative shrink-0 border border-white/10 bg-background/90 shadow-[0_0_0_1px_hsl(var(--primary)/0.08)] overflow-hidden p-1",
          styles.mark,
          markClassName
        )}
      >
        <img src="/phew-mark.svg" alt="" aria-hidden="true" className="h-full w-full object-contain" />
      </div>

      <div className="leading-tight min-w-0">
        <div className={cn("font-semibold tracking-tight", styles.title)}>
          <span className="bg-gradient-to-r from-[#7BFF5C] to-[#34E3D2] bg-clip-text text-transparent">Phew</span>
          <span className="text-foreground">.run</span>
        </div>
        {showTagline ? (
          <div className={cn("text-muted-foreground/90 tracking-[0.12em] uppercase", styles.subtitle)}>
            A Phew Running The Internet
          </div>
        ) : null}
      </div>
    </div>
  );
}
