import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";
import type { LeaderboardRowVM } from "@/viewmodels/trader-performance";

function sparkPath(seed: string) {
  let hash = 0;
  for (const char of seed) hash = (hash * 31 + char.charCodeAt(0)) % 9973;
  const points = Array.from({ length: 18 }, (_, index) => {
    const y = 38 - ((Math.sin((index + hash) * 0.72) + 1) * 10 + index * 0.9);
    return `${index * 7},${Math.max(8, Math.min(42, y))}`;
  });
  return points.join(" ");
}

export function LeaderboardSparkline({ id, tone = "lime" }: { id: string; tone?: "lime" | "red" }) {
  return (
    <svg viewBox="0 0 120 48" className="h-12 w-full overflow-visible" aria-hidden="true">
      <polyline
        points={sparkPath(id)}
        fill="none"
        stroke={tone === "red" ? "rgba(248,113,113,0.88)" : "rgba(169,255,52,0.86)"}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function LeaderboardPodium({ rows }: { rows: LeaderboardRowVM[] }) {
  const first = rows.find((row) => row.rank === 1) ?? rows[0] ?? null;
  const second = rows.find((row) => row.rank === 2) ?? rows[1] ?? null;
  const third = rows.find((row) => row.rank === 3) ?? rows[2] ?? null;
  const podiumRows = [second, first, third].filter(Boolean) as LeaderboardRowVM[];

  if (podiumRows.length === 0) {
    return (
      <section className="rounded-[16px] border border-dashed border-white/12 px-6 py-14 text-center text-sm text-white/48">
        Podium unlocks once ranked call-performance rows are available.
      </section>
    );
  }

  return (
    <section className="grid items-end gap-4 md:grid-cols-3">
      {podiumRows.map((row) => {
        const isFirst = row.rank === 1;
        const medal =
          row.rank === 1 ? "from-yellow-300/22 to-yellow-600/8 border-yellow-300/38" :
          row.rank === 2 ? "from-slate-200/16 to-slate-400/6 border-slate-200/20" :
          "from-orange-300/18 to-orange-700/8 border-orange-300/26";

        return (
          <article
            key={row.id}
            className={cn(
              "relative overflow-hidden rounded-[16px] border bg-[linear-gradient(180deg,rgba(10,17,19,0.98),rgba(4,8,10,0.99))] px-5 py-5 text-center",
              medal,
              isFirst ? "min-h-[300px] shadow-[0_0_54px_-24px_rgba(251,191,36,0.8)] md:order-2" : "min-h-[252px]",
              row.rank === 2 && "md:order-1",
              row.rank === 3 && "md:order-3"
            )}
          >
            <div className={cn("mx-auto flex items-center justify-center rounded-full border font-black", isFirst ? "h-16 w-16 text-4xl text-yellow-200" : "h-11 w-11 text-xl text-white/82")}>
              {row.rank}
            </div>
            <Avatar className={cn("mx-auto mt-3 border border-lime-300/20", isFirst ? "h-20 w-20" : "h-16 w-16")}>
              <AvatarImage src={row.avatarUrl ?? undefined} />
              <AvatarFallback className="bg-white/[0.06] text-white">{row.avatarFallback}</AvatarFallback>
            </Avatar>
            <h2 className="mt-3 truncate text-lg font-semibold text-white">{row.displayName}</h2>
            <div className="mt-1 text-xs text-white/42">{row.handle ?? row.metadataLabel}</div>
            <div className={cn("mt-4 font-semibold", isFirst ? "text-4xl text-[#19e67b]" : "text-3xl text-[#19e67b]")}>
              {row.valueLabel}
            </div>
            <div className="mt-1 text-sm text-white/58">Signal ROI</div>
            <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
              <div className="rounded-[12px] border border-white/8 bg-black/20 px-3 py-2">
                <div className="text-[10px] uppercase tracking-[0.14em] text-white/34">Win Rate</div>
                <div className="mt-1 font-semibold text-white">{row.changeLabel ?? "--"}</div>
              </div>
              <div className="rounded-[12px] border border-white/8 bg-black/20 px-3 py-2">
                <div className="text-[10px] uppercase tracking-[0.14em] text-white/34">Calls</div>
                <div className="mt-1 font-semibold text-white">{row.metadataLabel.split(" ")[0]}</div>
              </div>
            </div>
            <div className="mt-3">
              <LeaderboardSparkline id={row.id} tone={row.valueTone === "loss" ? "red" : "lime"} />
            </div>
          </article>
        );
      })}
    </section>
  );
}
