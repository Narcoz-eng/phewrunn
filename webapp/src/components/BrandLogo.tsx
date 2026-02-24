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
  markClassName: _markClassName,
}: BrandLogoProps) {
  const styles = sizeMap[size];

  return (
    <div className={cn("flex items-center", className)}>
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
