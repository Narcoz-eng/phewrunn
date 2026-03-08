import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

interface PostCardSkeletonProps {
  className?: string;
  showMarketData?: boolean;
  style?: React.CSSProperties;
}

export function PostCardSkeleton({ className, showMarketData = true, style }: PostCardSkeletonProps) {
  return (
    <div
      className={cn(
        "app-surface rounded-[28px] transition-all duration-300",
        className
      )}
      style={style}
    >
      <div className="p-4">
        {/* Header - Avatar, Name, Level Badge, Time */}
        <div className="flex items-start gap-3">
          {/* Avatar */}
          <Skeleton className="h-11 w-11 rounded-full flex-shrink-0" />

          <div className="flex-1 min-w-0 space-y-3">
            {/* Name row with level badge */}
            <div className="flex items-center gap-2">
              <Skeleton className="h-4 w-28" />
              <Skeleton className="h-5 w-10 rounded-md" />
              <Skeleton className="h-3 w-14" />
            </div>

            {/* Level Bar */}
            <Skeleton className="h-4 w-full rounded-full" />

            {/* Post content - multiple lines */}
            <div className="space-y-2 pt-1">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-4/5" />
              <Skeleton className="h-4 w-2/3" />
            </div>

            {/* Market Data Card */}
            {showMarketData && (
              <div className="app-surface-soft mt-4 rounded-[24px] p-4">
                {/* Chain badge and address */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Skeleton className="h-5 w-14 rounded-md" />
                    <Skeleton className="h-4 w-24" />
                  </div>
                  <div className="flex items-center gap-2">
                    <Skeleton className="h-5 w-12 rounded-md" />
                    <Skeleton className="h-6 w-16 rounded-md" />
                  </div>
                </div>

                {/* Dexscreener Button */}
                <Skeleton className="mt-4 h-12 w-full rounded-lg" />

                {/* Entry Market Cap */}
                <div className="mt-4 rounded-[18px] border border-border/60 bg-white/60 p-3 dark:bg-background/40">
                  <Skeleton className="h-3 w-24 mb-2" />
                  <Skeleton className="h-8 w-32" />
                </div>

                {/* Stats Grid */}
                <div className="mt-3 grid grid-cols-2 gap-3">
                  <div className="rounded-[16px] bg-background/40 p-2 dark:bg-background/30">
                    <Skeleton className="h-3 w-14 mb-1" />
                    <Skeleton className="h-5 w-20" />
                  </div>
                  <div className="rounded-[16px] bg-background/40 p-2 dark:bg-background/30">
                    <Skeleton className="h-3 w-14 mb-1" />
                    <Skeleton className="h-5 w-16" />
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Social Buttons */}
        <div className="mt-5 flex items-center justify-between border-t border-border/50 pt-4">
          <div className="flex items-center gap-1">
            <Skeleton className="h-9 w-14 rounded-md" />
            <Skeleton className="h-9 w-14 rounded-md" />
            <Skeleton className="h-9 w-14 rounded-md" />
            <Skeleton className="h-9 w-9 rounded-md" />
          </div>
          <Skeleton className="h-4 w-20" />
        </div>
      </div>
    </div>
  );
}

// Simple skeleton for user profile card
export function ProfileCardSkeleton({ className }: { className?: string }) {
  return (
    <div className={cn("app-surface p-5", className)}>
      <div className="flex items-center gap-4">
        <Skeleton className="h-16 w-16 rounded-full" />
        <div className="flex-1 space-y-2">
          <div className="flex items-center gap-2">
            <Skeleton className="h-5 w-32" />
            <Skeleton className="h-5 w-5" />
          </div>
          <Skeleton className="h-4 w-48" />
          <Skeleton className="h-3 w-16" />
        </div>
      </div>
      {/* Large Level Bar */}
      <div className="mt-5">
        <Skeleton className="h-6 w-full rounded-full" />
      </div>
    </div>
  );
}

// Feed loading state with multiple skeletons
export function FeedLoadingSkeleton({ count = 3 }: { count?: number }) {
  return (
    <div className="space-y-4">
      {Array.from({ length: count }).map((_, i) => (
        <PostCardSkeleton
          key={i}
          showMarketData={i === 0 || i === 1}
          className="animate-fade-in-up"
          style={{ animationDelay: `${i * 0.1}s` } as React.CSSProperties}
        />
      ))}
    </div>
  );
}
