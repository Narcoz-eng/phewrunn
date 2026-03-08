import { cn } from "@/lib/utils";

function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "animate-pulse rounded-[18px] border border-border/50 bg-[linear-gradient(180deg,hsl(0_0%_100%/0.7),hsl(38_24%_92%/0.76))] dark:border-white/[0.05] dark:bg-white/[0.04]",
        "relative overflow-hidden",
        className
      )}
      {...props}
    >
      {/* Shimmer effect overlay */}
      <div className="absolute inset-0 -translate-x-full animate-[shimmer_2s_infinite] bg-gradient-to-r from-transparent via-foreground/5 to-transparent" />
    </div>
  );
}

export { Skeleton };
