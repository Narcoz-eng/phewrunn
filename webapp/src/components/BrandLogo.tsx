import { Sparkles, TrendingUp } from "lucide-react";
import { cn } from "@/lib/utils";

type BrandLogoSize = "sm" | "md" | "lg";

interface BrandLogoProps {
  size?: BrandLogoSize;
  showTagline?: boolean;
  className?: string;
  markClassName?: string;
}

const sizeMap: Record<BrandLogoSize, { mark: string; icon: string; title: string; subtitle: string }> = {
  sm: {
    mark: "h-9 w-9 rounded-xl",
    icon: "h-4 w-4",
    title: "text-sm",
    subtitle: "text-[10px]",
  },
  md: {
    mark: "h-10 w-10 rounded-xl",
    icon: "h-4.5 w-4.5",
    title: "text-sm",
    subtitle: "text-[11px]",
  },
  lg: {
    mark: "h-12 w-12 rounded-2xl",
    icon: "h-5 w-5",
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

  return (
    <div className={cn("flex items-center gap-3", className)}>
      <div
        className={cn(
          "relative shrink-0 border border-primary/20 bg-background/90 shadow-[0_0_0_1px_hsl(var(--primary)/0.08)] overflow-hidden",
          styles.mark,
          markClassName
        )}
      >
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_28%_22%,hsl(var(--primary)/0.18),transparent_58%)]" />
        <div className="absolute inset-0 bg-[linear-gradient(135deg,hsl(var(--background)),hsl(var(--card))_60%,hsl(var(--accent)/0.08))]" />
        <div
          className="absolute inset-0 opacity-[0.08]"
          style={{
            backgroundImage:
              "linear-gradient(hsl(var(--foreground)) 1px, transparent 1px), linear-gradient(90deg, hsl(var(--foreground)) 1px, transparent 1px)",
            backgroundSize: "8px 8px",
          }}
        />

        <svg
          viewBox="0 0 40 40"
          className="absolute inset-[2px] h-[calc(100%-4px)] w-[calc(100%-4px)]"
          aria-hidden="true"
        >
          <defs>
            <linearGradient id="phew-logo-line" x1="6" y1="31" x2="34" y2="9" gradientUnits="userSpaceOnUse">
              <stop offset="0" stopColor="hsl(var(--accent))" />
              <stop offset="1" stopColor="hsl(var(--primary))" />
            </linearGradient>
          </defs>
          <path
            d="M6 28.5h8.5c1.4 0 2.3-.4 3.1-1.4l2.8-3.5c.8-1 1.8-1.4 3.1-1.4H34"
            fill="none"
            stroke="url(#phew-logo-line)"
            strokeWidth="2.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <circle cx="23.5" cy="22.4" r="6.2" fill="none" stroke="hsl(var(--primary) / 0.22)" strokeWidth="1.4" />
          <circle cx="23.5" cy="22.4" r="2.4" fill="hsl(var(--primary))" opacity="0.95" />
          <path
            d="M27 17.2l5.4-5.4"
            fill="none"
            stroke="hsl(var(--primary) / 0.65)"
            strokeWidth="1.6"
            strokeLinecap="round"
          />
        </svg>

        <div className="absolute -top-1 -right-1 rounded-full border border-primary/20 bg-background/90 p-1 shadow-sm">
          <Sparkles className={cn("text-primary", styles.icon)} />
        </div>
        <div className="absolute bottom-1 left-1 rounded-md border border-border/60 bg-background/80 px-1.5 py-0.5">
          <TrendingUp className="h-3 w-3 text-primary" />
        </div>
      </div>

      <div className="leading-tight min-w-0">
        <div className={cn("font-semibold tracking-tight text-foreground", styles.title)}>Phew.run</div>
        {showTagline ? (
          <div className={cn("text-muted-foreground", styles.subtitle)}>Proof over noise</div>
        ) : null}
      </div>
    </div>
  );
}

