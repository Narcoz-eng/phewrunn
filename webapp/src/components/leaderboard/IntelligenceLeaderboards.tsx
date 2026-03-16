import { type ComponentType, type ReactNode, useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { api } from "@/lib/api";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { getAvatarUrl, type Post, formatMarketCap, formatTimeAgo } from "@/types";
import { buildProfilePath } from "@/lib/profile-path";
import { cn } from "@/lib/utils";
import { readSessionCache, writeSessionCache } from "@/lib/session-cache";
import {
  Award,
  Flame,
  RefreshCcw,
  Target,
  TrendingUp,
  Trophy,
} from "lucide-react";

type DailyLeaderboards = {
  topTradersToday: Array<{
    traderId: string;
    handle: string | null;
    name: string;
    image: string | null;
    trustScore: number | null;
    avgRoiPct: number;
    winRatePct: number;
    callsCount: number;
  }>;
  topAlphaToday: Post[];
  biggestRoiToday: Post[];
  bestEntryToday: Post[];
};

type FirstCallerRow = {
  traderId: string;
  handle: string | null;
  name: string;
  image: string | null;
  trustScore: number | null;
  firstCalls: number;
  firstCallAvgRoi: number | null;
  avgConfidenceScore: number;
};

function hasMeaningfulDailyLeaderboards(data: DailyLeaderboards | null | undefined): data is DailyLeaderboards {
  return Boolean(
    data &&
    (
      data.topTradersToday.length > 0 ||
      data.topAlphaToday.length > 0 ||
      data.biggestRoiToday.length > 0 ||
      data.bestEntryToday.length > 0
    )
  );
}

function hasMeaningfulFirstCallerRows(
  rows: FirstCallerRow[] | null | undefined
): rows is FirstCallerRow[] {
  return Array.isArray(rows) && rows.length > 0;
}

const DAILY_LEADERBOARDS_CACHE_KEY = "phew.leaderboards.daily:v1";
const FIRST_CALLERS_CACHE_KEY = "phew.leaderboards.first-callers:v1";
const LEADERBOARDS_CACHE_TTL_MS = 15 * 60_000;

function BoardSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="rounded-[28px] border border-border/65 bg-card/80 p-5 shadow-[0_18px_36px_-32px_hsl(var(--foreground)/0.18)]">
      <div className="flex items-center justify-between gap-3">
        <Skeleton className="h-5 w-36" />
        <Skeleton className="h-8 w-20 rounded-full" />
      </div>
      <div className="mt-4 space-y-3">
        {Array.from({ length: rows }).map((_, index) => (
          <div key={index} className="flex items-center gap-3 rounded-2xl border border-border/60 px-3 py-3">
            <Skeleton className="h-10 w-10 rounded-full" />
            <div className="min-w-0 flex-1 space-y-2">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-3 w-40" />
            </div>
            <div className="space-y-2 text-right">
              <Skeleton className="h-4 w-16 ml-auto" />
              <Skeleton className="h-3 w-12 ml-auto" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function SectionShell({
  title,
  description,
  icon: Icon,
  children,
}: {
  title: string;
  description: string;
  icon: ComponentType<{ className?: string }>;
  children: ReactNode;
}) {
  return (
    <section className="rounded-[32px] border border-border/65 bg-[linear-gradient(180deg,hsl(0_0%_100%/0.9),hsl(40_33%_94%/0.92))] p-5 shadow-[0_22px_54px_-38px_hsl(var(--foreground)/0.22)] dark:bg-[linear-gradient(180deg,rgba(15,17,22,0.96),rgba(9,11,15,0.98))] dark:shadow-none sm:p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-primary">
            <Icon className="h-3.5 w-3.5" />
            Intelligence
          </div>
          <h2 className="mt-3 text-xl font-semibold text-foreground">{title}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{description}</p>
        </div>
      </div>
      <div className="mt-5">{children}</div>
    </section>
  );
}

function EmptyState({
  title,
  subtitle,
}: {
  title: string;
  subtitle: string;
}) {
  return (
    <div className="rounded-[24px] border border-dashed border-border/70 bg-background/40 px-4 py-10 text-center">
      <p className="font-medium text-foreground">{title}</p>
      <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>
    </div>
  );
}

function MetricChip({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: string;
  tone?: "default" | "good" | "warn";
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.16em]",
        tone === "good" && "border-emerald-500/30 bg-emerald-500/10 text-emerald-500",
        tone === "warn" && "border-amber-500/30 bg-amber-500/10 text-amber-500",
        tone === "default" && "border-border/70 bg-background/70 text-muted-foreground"
      )}
    >
      {label} {value}
    </span>
  );
}

function TraderRow({
  trader,
  index,
}: {
  trader: DailyLeaderboards["topTradersToday"][number];
  index: number;
}) {
  const navigate = useNavigate();
  return (
    <button
      type="button"
      onClick={() => navigate(buildProfilePath(trader.traderId, trader.handle))}
      className="flex w-full items-center gap-3 rounded-[22px] border border-border/65 bg-background/70 px-3 py-3 text-left transition-colors hover:border-primary/30 hover:bg-background"
    >
      <div className="flex h-9 w-9 items-center justify-center rounded-full border border-border/70 bg-background font-semibold text-sm text-muted-foreground">
        {index + 1}
      </div>
      <Avatar className="h-10 w-10 border border-border/70">
        <AvatarImage src={getAvatarUrl(trader.traderId, trader.image)} />
        <AvatarFallback className="bg-secondary text-xs">
          {(trader.handle || trader.name || "?").charAt(0).toUpperCase()}
        </AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-semibold text-foreground">
          {trader.handle ? `@${trader.handle}` : trader.name}
        </div>
        <div className="mt-1 flex flex-wrap gap-1.5">
          <MetricChip label="Avg ROI" value={`${trader.avgRoiPct.toFixed(1)}%`} tone={trader.avgRoiPct >= 0 ? "good" : "warn"} />
          <MetricChip label="Win" value={`${trader.winRatePct.toFixed(0)}%`} />
        </div>
      </div>
      <div className="text-right">
        <div className="text-sm font-semibold text-foreground">{trader.callsCount}</div>
        <div className="text-[11px] text-muted-foreground">calls today</div>
      </div>
    </button>
  );
}

function CallRow({
  post,
  index,
  metricLabel,
  metricValue,
  metricTone = "default",
}: {
  post: Post;
  index: number;
  metricLabel: string;
  metricValue: string;
  metricTone?: "default" | "good" | "warn";
}) {
  const navigate = useNavigate();
  const handle = post.author.username ? `@${post.author.username}` : post.author.name;
  const tokenLabel = post.tokenSymbol || post.tokenName || "Unknown Token";
  const roundedConfidence = Math.round(post.confidenceScore ?? 0);
  return (
    <button
      type="button"
      onClick={() => navigate(`/post/${post.id}`)}
      className="flex w-full items-center gap-3 rounded-[22px] border border-border/65 bg-background/70 px-3 py-3 text-left transition-colors hover:border-primary/30 hover:bg-background"
    >
      <div className="flex h-9 w-9 items-center justify-center rounded-full border border-border/70 bg-background font-semibold text-sm text-muted-foreground">
        {index + 1}
      </div>
      <Avatar className="h-10 w-10 border border-border/70">
        <AvatarImage src={post.tokenImage ?? undefined} />
        <AvatarFallback className="bg-secondary text-xs">
          {tokenLabel.charAt(0).toUpperCase()}
        </AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-semibold text-foreground">{tokenLabel}</div>
        <div className="mt-0.5 text-[11px] text-muted-foreground">
          {handle} • {formatTimeAgo(post.createdAt)}
        </div>
        <div className="mt-1 flex flex-wrap gap-1.5">
          <MetricChip label={metricLabel} value={metricValue} tone={metricTone} />
          <MetricChip
            label="Confidence"
            value={`${roundedConfidence}%`}
            tone={roundedConfidence >= 45 ? "good" : "warn"}
          />
          {post.bundleRiskLabel ? (
            <MetricChip
              label="Risk"
              value={post.bundleRiskLabel}
              tone={post.bundleRiskLabel === "Clean" ? "good" : "warn"}
            />
          ) : null}
          {post.timingTier ? <MetricChip label="Timing" value={post.timingTier} /> : null}
        </div>
      </div>
      <div className="text-right">
        <div className="text-sm font-semibold text-foreground">{metricValue}</div>
        <div className="text-[11px] text-muted-foreground">{metricLabel}</div>
        <div className="mt-1 text-[11px] text-muted-foreground">
          {formatMarketCap(post.entryMcap)}
        </div>
      </div>
    </button>
  );
}

function FirstCallerRow({
  row,
  index,
}: {
  row: FirstCallerRow;
  index: number;
}) {
  const navigate = useNavigate();
  return (
    <button
      type="button"
      onClick={() => navigate(buildProfilePath(row.traderId, row.handle))}
      className="flex w-full items-center gap-3 rounded-[22px] border border-border/65 bg-background/70 px-3 py-3 text-left transition-colors hover:border-primary/30 hover:bg-background"
    >
      <div className="flex h-9 w-9 items-center justify-center rounded-full border border-border/70 bg-background font-semibold text-sm text-muted-foreground">
        {index + 1}
      </div>
      <Avatar className="h-10 w-10 border border-border/70">
        <AvatarImage src={getAvatarUrl(row.traderId, row.image)} />
        <AvatarFallback className="bg-secondary text-xs">
          {(row.handle || row.name || "?").charAt(0).toUpperCase()}
        </AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-semibold text-foreground">
          {row.handle ? `@${row.handle}` : row.name}
        </div>
        <div className="mt-1 flex flex-wrap gap-1.5">
          <MetricChip label="First calls" value={String(row.firstCalls)} tone="good" />
          <MetricChip label="Confidence" value={`${row.avgConfidenceScore.toFixed(0)}%`} />
        </div>
      </div>
      <div className="text-right">
        <div className="text-sm font-semibold text-foreground">
          {(row.firstCallAvgRoi ?? 0).toFixed(1)}%
        </div>
        <div className="text-[11px] text-muted-foreground">avg ROI</div>
      </div>
    </button>
  );
}

interface IntelligenceLeaderboardsProps {
  enabled?: boolean;
}

export function IntelligenceLeaderboards({ enabled = true }: IntelligenceLeaderboardsProps) {
  const [firstCallersReady, setFirstCallersReady] = useState(false);
  const cachedDaily = readSessionCache<DailyLeaderboards>(DAILY_LEADERBOARDS_CACHE_KEY, LEADERBOARDS_CACHE_TTL_MS);
  const cachedFirstCallers = readSessionCache<FirstCallerRow[]>(FIRST_CALLERS_CACHE_KEY, LEADERBOARDS_CACHE_TTL_MS);

  useEffect(() => {
    setFirstCallersReady(false);
    if (!enabled) {
      return;
    }
    const timer = window.setTimeout(() => {
      setFirstCallersReady(true);
    }, 500);
    return () => window.clearTimeout(timer);
  }, [enabled]);

  const {
    data: daily,
    isLoading: isLoadingDaily,
    isFetching: isFetchingDaily,
    error: dailyError,
    refetch: refetchDaily,
  } = useQuery({
    queryKey: ["leaderboards", "daily"],
    queryFn: async () => {
      const liveData = await api.get<DailyLeaderboards>("/api/leaderboards/daily");
      const resolved = hasMeaningfulDailyLeaderboards(liveData) ? liveData : cachedDaily ?? liveData;
      if (hasMeaningfulDailyLeaderboards(resolved)) {
        writeSessionCache(DAILY_LEADERBOARDS_CACHE_KEY, resolved);
      }
      return resolved;
    },
    enabled,
    initialData: cachedDaily ?? undefined,
    initialDataUpdatedAt: cachedDaily ? Date.now() : undefined,
    placeholderData: (previousData) => previousData ?? cachedDaily ?? undefined,
    refetchOnWindowFocus: false,
    retry: 0,
    staleTime: 90_000,
    gcTime: 10 * 60_000,
  });

  const {
    data: firstCallers = [],
    isLoading: isLoadingFirstCallers,
    isFetching: isFetchingFirstCallers,
    error: firstCallersError,
    refetch: refetchFirstCallers,
  } = useQuery({
    queryKey: ["leaderboards", "first-callers"],
    queryFn: async () => {
      const liveData = await api.get<FirstCallerRow[]>("/api/leaderboards/first-callers");
      const resolved = hasMeaningfulFirstCallerRows(liveData) ? liveData : cachedFirstCallers ?? liveData;
      if (hasMeaningfulFirstCallerRows(resolved)) {
        writeSessionCache(FIRST_CALLERS_CACHE_KEY, resolved);
      }
      return resolved;
    },
    enabled: enabled && firstCallersReady,
    initialData: cachedFirstCallers ?? undefined,
    initialDataUpdatedAt: cachedFirstCallers ? Date.now() : undefined,
    placeholderData: (previousData) => previousData ?? cachedFirstCallers ?? undefined,
    refetchOnWindowFocus: false,
    retry: 0,
    staleTime: 90_000,
    gcTime: 10 * 60_000,
  });

  return (
    <div className="space-y-6">
      <SectionShell
        title="Daily Alpha Race"
        description="Today’s strongest traders, hottest calls, biggest ROI, and best entries ranked by the new intelligence engine."
        icon={Trophy}
      >
        {isLoadingDaily && !daily ? (
          <div className="grid gap-4 xl:grid-cols-2">
            <BoardSkeleton />
            <BoardSkeleton />
            <BoardSkeleton />
            <BoardSkeleton />
          </div>
        ) : dailyError || !daily ? (
          <div className="rounded-[24px] border border-destructive/30 bg-destructive/5 px-4 py-8 text-center">
            <p className="font-medium text-foreground">Failed to load the daily alpha race</p>
            <Button type="button" variant="outline" size="sm" className="mt-3" onClick={() => void refetchDaily()}>
              <RefreshCcw className="mr-2 h-4 w-4" />
              Retry
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            {isFetchingDaily ? (
              <div className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-primary">
                <RefreshCcw className="h-3.5 w-3.5 animate-spin" />
                Refreshing live leaderboard
              </div>
            ) : null}
            <div className="grid gap-4 xl:grid-cols-2">
            <div className="rounded-[28px] border border-border/65 bg-card/80 p-5 shadow-[0_18px_36px_-32px_hsl(var(--foreground)/0.18)]">
              <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                <Trophy className="h-4 w-4 text-primary" />
                Top Traders Today
              </div>
              <div className="mt-4 space-y-3">
                {daily.topTradersToday.length === 0 ? (
                  <EmptyState title="No trader rankings yet" subtitle="As traders post and settle calls today, this board will fill in." />
                ) : (
                  daily.topTradersToday.slice(0, 6).map((trader, index) => (
                    <TraderRow key={trader.traderId} trader={trader} index={index} />
                  ))
                )}
              </div>
            </div>

            <div className="rounded-[28px] border border-border/65 bg-card/80 p-5 shadow-[0_18px_36px_-32px_hsl(var(--foreground)/0.18)]">
              <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                <Flame className="h-4 w-4 text-orange-500" />
                Hot Alpha Today
              </div>
              <div className="mt-4 space-y-3">
                {daily.topAlphaToday.length === 0 ? (
                  <EmptyState title="No hot alpha yet" subtitle="The hottest calls today will rank here once enough signals land." />
                ) : (
                  daily.topAlphaToday.slice(0, 6).map((post, index) => (
                    <CallRow
                      key={post.id}
                      post={post}
                      index={index}
                      metricLabel="Hot"
                      metricValue={`${Math.round(post.hotAlphaScore ?? 0)}%`}
                      metricTone="good"
                    />
                  ))
                )}
              </div>
            </div>

            <div className="rounded-[28px] border border-border/65 bg-card/80 p-5 shadow-[0_18px_36px_-32px_hsl(var(--foreground)/0.18)]">
              <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                <TrendingUp className="h-4 w-4 text-emerald-500" />
                Biggest ROI Today
              </div>
              <div className="mt-4 space-y-3">
                {daily.biggestRoiToday.length === 0 ? (
                  <EmptyState title="No ROI leaders yet" subtitle="This fills with today’s top runners as returns develop." />
                ) : (
                  daily.biggestRoiToday.slice(0, 6).map((post, index) => (
                    <CallRow
                      key={post.id}
                      post={post}
                      index={index}
                      metricLabel="ROI"
                      metricValue={`${(post.roiPeakPct ?? 0).toFixed(1)}%`}
                      metricTone={typeof post.roiPeakPct === "number" && post.roiPeakPct >= 0 ? "good" : "warn"}
                    />
                  ))
                )}
              </div>
            </div>

            <div className="rounded-[28px] border border-border/65 bg-card/80 p-5 shadow-[0_18px_36px_-32px_hsl(var(--foreground)/0.18)]">
              <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                <Target className="h-4 w-4 text-primary" />
                Best Entry Today
              </div>
              <div className="mt-4 space-y-3">
                {daily.bestEntryToday.length === 0 ? (
                  <EmptyState title="No first-call winners yet" subtitle="First caller and early-entry leaders will rank here." />
                ) : (
                  daily.bestEntryToday.slice(0, 6).map((post, index) => (
                    <CallRow
                      key={post.id}
                      post={post}
                      index={index}
                      metricLabel="Entry"
                      metricValue={`${Math.round(post.entryQualityScore ?? 0)}%`}
                      metricTone="good"
                    />
                  ))
                )}
              </div>
            </div>
            </div>
          </div>
        )}
      </SectionShell>

      <SectionShell
        title="First Caller Board"
        description="Traders who consistently arrive earliest and still keep quality high."
        icon={Award}
      >
        {isLoadingFirstCallers && firstCallers.length === 0 ? (
          <BoardSkeleton rows={6} />
        ) : firstCallersError ? (
          <div className="rounded-[24px] border border-destructive/30 bg-destructive/5 px-4 py-8 text-center">
            <p className="font-medium text-foreground">Failed to load first-caller rankings</p>
            <Button type="button" variant="outline" size="sm" className="mt-3" onClick={() => void refetchFirstCallers()}>
              <RefreshCcw className="mr-2 h-4 w-4" />
              Retry
            </Button>
          </div>
        ) : firstCallers.length === 0 ? (
          <EmptyState title="No first-caller rankings yet" subtitle="Once enough calls are classified, this board will populate." />
        ) : (
          <div className="space-y-3">
            {isFetchingFirstCallers ? (
              <div className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-primary">
                <RefreshCcw className="h-3.5 w-3.5 animate-spin" />
                Updating first-caller board
              </div>
            ) : null}
            {firstCallers.slice(0, 10).map((row, index) => (
              <FirstCallerRow key={row.traderId} row={row} index={index} />
            ))}
          </div>
        )}
      </SectionShell>
    </div>
  );
}
