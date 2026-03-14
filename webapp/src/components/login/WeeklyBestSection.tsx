import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { TrendingUp } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatMarketCap } from "@/types";
import { api } from "@/lib/api";

type WeeklyBestEntry = {
  postId: string;
  tokenName: string | null;
  tokenSymbol: string | null;
  tokenImage: string | null;
  contractAddress: string;
  user: {
    id: string;
    name: string | null;
    username: string | null;
    image: string | null;
    level: number;
  };
  gainPercent: number;
  entryMcap: number;
  peakMcap: number;
  createdAt: string;
  settledAt: string;
};

function formatMultiplier(gainPercent: number): string {
  const mult = gainPercent / 100 + 1;
  if (mult >= 10) return `${Math.round(mult)}x`;
  if (mult >= 2) return `${mult.toFixed(1)}x`;
  return `${mult.toFixed(2)}x`;
}

function formatGainPercent(gainPercent: number): string {
  if (gainPercent >= 10000) return `+${Math.round(gainPercent / 100) * 100}%`;
  if (gainPercent >= 1000) return `+${Math.round(gainPercent)}%`;
  return `+${gainPercent.toFixed(1)}%`;
}

function getLevelLabel(level: number): string {
  if (level >= 8) return "Elite";
  if (level >= 5) return "Veteran";
  if (level >= 1) return "Rising";
  return "Neutral";
}

function getLevelColor(level: number): string {
  if (level >= 8) return "text-yellow-400 border-yellow-400/30 bg-yellow-400/10";
  if (level >= 5) return "text-slate-300 border-slate-400/30 bg-slate-400/10";
  if (level >= 1) return "text-orange-400 border-orange-400/30 bg-orange-400/10";
  return "text-muted-foreground border-border/50 bg-background/60";
}

type WinCardProps = {
  entry: WeeklyBestEntry;
  rank: 1 | 2;
  optimizeMotion: boolean;
  index: number;
};

function WinCard({ entry, rank, optimizeMotion, index }: WinCardProps) {
  const symbol = entry.tokenSymbol ?? entry.tokenName ?? "???";
  const name = entry.tokenName ?? entry.tokenSymbol ?? "Unknown Token";
  const authorHandle = entry.user.username
    ? `@${entry.user.username}`
    : entry.user.name ?? "Trader";
  const levelLabel = getLevelLabel(entry.user.level);
  const levelColor = getLevelColor(entry.user.level);
  const initial = (entry.user.username ?? entry.user.name ?? "?").charAt(0).toUpperCase();
  const multiplierText = formatMultiplier(entry.gainPercent);
  const gainText = formatGainPercent(entry.gainPercent);

  const isTopRank = rank === 1;

  return (
    <motion.div
      initial={optimizeMotion ? false : { opacity: 0, y: 24 }}
      whileInView={optimizeMotion ? undefined : { opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-60px" }}
      transition={{ duration: optimizeMotion ? 0 : 0.45, delay: optimizeMotion ? 0 : index * 0.1 }}
      className="relative group"
    >
      {/* Outer glow */}
      <div
        className={cn(
          "absolute -inset-px rounded-[28px] opacity-0 group-hover:opacity-100 transition-opacity duration-500",
          isTopRank
            ? "bg-[radial-gradient(ellipse_at_top,hsl(var(--gain)/0.25),transparent_70%)]"
            : "bg-[radial-gradient(ellipse_at_top,hsl(var(--primary)/0.18),transparent_70%)]"
        )}
      />

      <div
        className={cn(
          "relative rounded-[28px] border overflow-hidden",
          isTopRank
            ? "border-gain/25 bg-[linear-gradient(160deg,hsl(var(--gain)/0.08)_0%,hsl(var(--card)/0.95)_40%)] shadow-[0_28px_80px_-32px_hsl(var(--gain)/0.35)]"
            : "border-primary/20 bg-[linear-gradient(160deg,hsl(var(--primary)/0.06)_0%,hsl(var(--card)/0.95)_40%)] shadow-[0_20px_60px_-30px_hsl(var(--primary)/0.25)]"
        )}
      >
        {/* Top bar */}
        <div
          className={cn(
            "h-[3px] w-full",
            isTopRank
              ? "bg-gradient-to-r from-transparent via-gain to-transparent"
              : "bg-gradient-to-r from-transparent via-primary to-transparent"
          )}
        />

        <div className="p-5 sm:p-6 space-y-5">
          {/* Header: rank badge + token */}
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3">
              {/* Token image or fallback */}
              <div
                className={cn(
                  "w-11 h-11 rounded-2xl border flex items-center justify-center shrink-0 overflow-hidden text-sm font-bold",
                  isTopRank
                    ? "border-gain/25 bg-gain/10 text-gain"
                    : "border-primary/25 bg-primary/10 text-primary"
                )}
              >
                {entry.tokenImage ? (
                  <img
                    src={entry.tokenImage}
                    alt={symbol}
                    className="w-full h-full object-cover"
                    onError={(e) => {
                      (e.target as HTMLImageElement).style.display = "none";
                    }}
                  />
                ) : (
                  symbol.slice(0, 2)
                )}
              </div>

              <div>
                <div className="font-mono font-bold text-base tracking-tight text-foreground">
                  ${symbol}
                </div>
                <div className="text-[11px] text-muted-foreground truncate max-w-[140px]">
                  {name}
                </div>
              </div>
            </div>

            {/* Rank badge */}
            <div
              className={cn(
                "shrink-0 rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.18em]",
                isTopRank
                  ? "border-gain/30 bg-gain/10 text-gain"
                  : "border-primary/25 bg-primary/8 text-primary"
              )}
            >
              #{rank} This Week
            </div>
          </div>

          {/* Big gain % */}
          <div className="text-center py-2">
            <div
              className={cn(
                "font-mono font-extrabold leading-none tracking-tight",
                entry.gainPercent >= 1000 ? "text-5xl sm:text-6xl" : "text-4xl sm:text-5xl",
                isTopRank
                  ? "bg-gradient-to-b from-gain to-[#5ed13a] bg-clip-text text-transparent"
                  : "bg-gradient-to-b from-primary to-[hsl(var(--primary)/0.65)] bg-clip-text text-transparent"
              )}
            >
              {gainText}
            </div>
            <div
              className={cn(
                "mt-2 text-lg font-mono font-bold",
                isTopRank ? "text-gain/70" : "text-primary/70"
              )}
            >
              {multiplierText}
            </div>
          </div>

          {/* Entry → Peak MCAP */}
          <div
            className={cn(
              "rounded-2xl border p-4 space-y-3",
              isTopRank ? "border-gain/15 bg-gain/5" : "border-primary/12 bg-primary/5"
            )}
          >
            <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground font-medium uppercase tracking-[0.16em]">
              <span>Entry MCAP</span>
              <TrendingUp className={cn("w-3.5 h-3.5", isTopRank ? "text-gain" : "text-primary")} />
              <span>Peak MCAP</span>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="font-mono font-semibold text-sm text-foreground/80">
                {formatMarketCap(entry.entryMcap)}
              </span>
              <div className="flex-1 mx-2 h-[2px] bg-border/50 relative">
                <div
                  className={cn(
                    "absolute inset-y-0 left-0 rounded-full",
                    isTopRank ? "bg-gain" : "bg-primary"
                  )}
                  style={{ width: "100%" }}
                />
              </div>
              <span
                className={cn(
                  "font-mono font-bold text-sm",
                  isTopRank ? "text-gain" : "text-primary"
                )}
              >
                {formatMarketCap(entry.peakMcap)}
              </span>
            </div>
          </div>

          {/* Trader attribution */}
          <div className="flex items-center justify-between gap-3 pt-1">
            <div className="flex items-center gap-2.5">
              <div
                className={cn(
                  "w-8 h-8 rounded-full border flex items-center justify-center text-xs font-bold shrink-0",
                  isTopRank
                    ? "border-gain/30 bg-gain/10 text-gain"
                    : "border-primary/30 bg-primary/10 text-primary"
                )}
              >
                {entry.user.image ? (
                  <img
                    src={entry.user.image}
                    alt={initial}
                    className="w-full h-full object-cover rounded-full"
                    onError={(e) => {
                      (e.target as HTMLImageElement).style.display = "none";
                    }}
                  />
                ) : (
                  initial
                )}
              </div>
              <div>
                <div className="text-xs font-semibold text-foreground">{authorHandle}</div>
                <div className="text-[10px] text-muted-foreground">
                  Settled WIN
                </div>
              </div>
            </div>

            <div
              className={cn(
                "rounded-full border px-2.5 py-1 text-[10px] font-semibold",
                levelColor
              )}
            >
              {getLevelLabel(entry.user.level)} · LVL {entry.user.level > 0 ? `+${entry.user.level}` : entry.user.level}
            </div>
          </div>
        </div>
      </div>
    </motion.div>
  );
}

function WinCardSkeleton({ rank }: { rank: 1 | 2 }) {
  const isTopRank = rank === 1;
  return (
    <div className="rounded-[28px] border border-border/40 bg-card/50 overflow-hidden">
      <div className={cn("h-[3px]", isTopRank ? "bg-gain/30" : "bg-primary/20")} />
      <div className="p-5 sm:p-6 space-y-5 animate-pulse">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-2xl bg-border/40" />
            <div className="space-y-1.5">
              <div className="h-4 w-16 rounded bg-foreground/10" />
              <div className="h-3 w-24 rounded bg-foreground/8" />
            </div>
          </div>
          <div className="h-6 w-24 rounded-full bg-border/40" />
        </div>
        <div className="text-center py-2 space-y-2">
          <div className="h-14 w-36 rounded-xl bg-foreground/10 mx-auto" />
          <div className="h-5 w-12 rounded bg-foreground/8 mx-auto" />
        </div>
        <div className="rounded-2xl border border-border/35 bg-background/40 p-4 space-y-3">
          <div className="h-3 w-full rounded bg-foreground/8" />
          <div className="h-4 w-full rounded bg-foreground/10" />
        </div>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-full bg-border/40" />
            <div className="space-y-1">
              <div className="h-3 w-20 rounded bg-foreground/10" />
              <div className="h-2.5 w-14 rounded bg-foreground/8" />
            </div>
          </div>
          <div className="h-6 w-24 rounded-full bg-border/40" />
        </div>
      </div>
    </div>
  );
}

type WeeklyBestSectionProps = {
  optimizeMotion: boolean;
};

export function WeeklyBestSection({ optimizeMotion }: WeeklyBestSectionProps) {
  const { data, isLoading } = useQuery({
    queryKey: ["weekly-best"],
    queryFn: () => api.get<WeeklyBestEntry[]>("/api/leaderboard/weekly-best"),
    staleTime: 10 * 60 * 1000,
    retry: 1,
  });

  const entries = data ?? [];
  const hasData = entries.length > 0;

  if (!isLoading && !hasData) return null;

  return (
    <section className="border-t border-border/40 bg-[linear-gradient(180deg,hsl(var(--card)/0.4),transparent_60%)]">
      <div className="max-w-7xl mx-auto px-3 sm:px-6 py-10 sm:py-12 md:py-16">

        {/* Header */}
        <motion.div
          className="text-center mb-8 sm:mb-10"
          initial={optimizeMotion ? false : { opacity: 0, y: 16 }}
          whileInView={optimizeMotion ? undefined : { opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-60px" }}
          transition={{ duration: optimizeMotion ? 0 : 0.4 }}
        >
          <div className="inline-flex items-center gap-2 text-xs font-semibold text-gain uppercase tracking-widest mb-3">
            <TrendingUp className="w-3.5 h-3.5" />
            Proof of Alpha
          </div>
          <h2 className="font-heading text-3xl sm:text-4xl font-extrabold tracking-tight">
            This Week's Best Calls.
          </h2>
          <p className="mt-2 text-sm text-muted-foreground max-w-md mx-auto leading-relaxed">
            Real calls. Real settlement. These are the top two verified wins from the past 7 days.
          </p>
        </motion.div>

        {/* Cards */}
        <div className="grid sm:grid-cols-2 gap-4 max-w-3xl mx-auto">
          {isLoading ? (
            <>
              <WinCardSkeleton rank={1} />
              <WinCardSkeleton rank={2} />
            </>
          ) : (
            entries.slice(0, 2).map((entry, i) => (
              <WinCard
                key={entry.postId}
                entry={entry}
                rank={(i + 1) as 1 | 2}
                optimizeMotion={optimizeMotion}
                index={i}
              />
            ))
          )}
        </div>

        {/* Footer note */}
        <motion.p
          className="text-center text-[11px] text-muted-foreground mt-6"
          initial={optimizeMotion ? false : { opacity: 0 }}
          whileInView={optimizeMotion ? undefined : { opacity: 1 }}
          viewport={{ once: true }}
          transition={{ duration: optimizeMotion ? 0 : 0.4, delay: optimizeMotion ? 0 : 0.3 }}
        >
          Gains calculated from entry market cap to peak across 1H and 6H settlement snapshots.
        </motion.p>
      </div>
    </section>
  );
}
