import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { BrainCircuit, Flame, ShieldCheck, Target } from "lucide-react";

type TraderOverview = {
  id: string;
  name: string;
  username: string | null;
  image: string | null;
  level: number;
  xp: number;
  isVerified: boolean;
  winRate7d: number | null;
  winRate30d: number | null;
  avgRoi7d: number | null;
  avgRoi30d: number | null;
  trustScore: number | null;
  reputationTier: string | null;
  firstCallCount: number;
  firstCallAvgRoi: number | null;
};

type TraderStats = {
  callsCount: number;
  avgConfidenceScore: number;
  avgHotAlphaScore: number;
  avgHighConvictionScore: number;
  firstCallCount: number;
};

function Metric({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: string;
  tone?: "default" | "good" | "primary";
}) {
  return (
    <div className="rounded-[22px] border border-border/65 bg-background/60 px-4 py-3">
      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">{label}</p>
      <p
        className={cn(
          "mt-2 text-lg font-semibold tracking-tight",
          tone === "good" && "text-emerald-500",
          tone === "primary" && "text-primary",
          tone === "default" && "text-foreground"
        )}
      >
        {value}
      </p>
    </div>
  );
}

export function TraderIntelligenceCard({ handle }: { handle?: string | null }) {
  const normalizedHandle = handle?.trim() ?? "";
  const {
    data,
    isLoading,
    error,
  } = useQuery({
    queryKey: ["trader-intelligence", normalizedHandle],
    queryFn: async () => {
      const [trader, stats] = await Promise.all([
        api.get<TraderOverview>(`/api/traders/${normalizedHandle}`),
        api.get<TraderStats>(`/api/traders/${normalizedHandle}/stats`),
      ]);
      return { trader, stats };
    },
    enabled: normalizedHandle.length > 0,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });

  if (!normalizedHandle) {
    return null;
  }

  if (isLoading) {
    return (
      <div className="app-surface p-4 sm:p-5">
        <div className="flex items-center gap-2">
          <Skeleton className="h-5 w-5 rounded-full" />
          <Skeleton className="h-5 w-44" />
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-3 xl:grid-cols-4">
          {Array.from({ length: 8 }).map((_, index) => (
            <Skeleton key={index} className="h-24 rounded-[22px]" />
          ))}
        </div>
      </div>
    );
  }

  if (error || !data) {
    return null;
  }

  const { trader, stats } = data;

  return (
    <div className="app-surface p-4 sm:p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-primary">
            <BrainCircuit className="h-3.5 w-3.5" />
            Trader Intelligence
          </div>
          <h3 className="mt-3 text-lg font-semibold text-foreground">Alpha profile</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Shared confidence metrics and reputation scores used across feeds, token pages, and alerts.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {trader.reputationTier ? (
            <span className="inline-flex items-center rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] text-primary">
              {trader.reputationTier}
            </span>
          ) : null}
          <span className="inline-flex items-center rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] text-emerald-500">
            Trust {Math.round(trader.trustScore ?? 0)}%
          </span>
        </div>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-3 xl:grid-cols-4">
        <Metric label="30D win rate" value={`${(trader.winRate30d ?? 0).toFixed(1)}%`} tone="good" />
        <Metric label="30D avg ROI" value={`${(trader.avgRoi30d ?? 0).toFixed(1)}%`} tone={(trader.avgRoi30d ?? 0) >= 0 ? "good" : "default"} />
        <Metric label="First calls" value={String(trader.firstCallCount ?? 0)} tone="primary" />
        <Metric label="First-call avg ROI" value={`${(trader.firstCallAvgRoi ?? 0).toFixed(1)}%`} />
        <Metric label="Avg confidence" value={`${stats.avgConfidenceScore.toFixed(0)}%`} tone="primary" />
        <Metric label="Hot alpha avg" value={`${stats.avgHotAlphaScore.toFixed(0)}%`} />
        <Metric label="Conviction avg" value={`${stats.avgHighConvictionScore.toFixed(0)}%`} />
        <Metric label="Tracked calls" value={String(stats.callsCount)} />
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-3">
        <div className="rounded-[22px] border border-border/65 bg-background/60 px-4 py-3">
          <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <ShieldCheck className="h-4 w-4 text-primary" />
            Confidence engine
          </div>
          <p className="mt-2 text-sm text-muted-foreground">
            Trader trust and historical ROI directly influence call confidence and high-conviction discovery.
          </p>
        </div>
        <div className="rounded-[22px] border border-border/65 bg-background/60 px-4 py-3">
          <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <Flame className="h-4 w-4 text-orange-500" />
            Feed impact
          </div>
          <p className="mt-2 text-sm text-muted-foreground">
            Better hot-alpha and first-call history pushes this trader higher in ranked feed tabs and alpha races.
          </p>
        </div>
        <div className="rounded-[22px] border border-border/65 bg-background/60 px-4 py-3">
          <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <Target className="h-4 w-4 text-emerald-500" />
            Early-entry edge
          </div>
          <p className="mt-2 text-sm text-muted-foreground">
            First-caller and timing signals help determine whether this trader tends to catch runners early.
          </p>
        </div>
      </div>
    </div>
  );
}
