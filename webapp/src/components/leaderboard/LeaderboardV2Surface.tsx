import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { V2StatusPill } from "@/components/ui/v2/V2StatusPill";
import { V2Surface } from "@/components/ui/v2/V2Surface";
import { cn } from "@/lib/utils";
import type { LeaderboardRowVM } from "@/viewmodels/trader-performance";
import { Activity, BrainCircuit, Coins, Flame, ShieldCheck, Trophy, Users } from "lucide-react";
import type { ReactNode } from "react";

function parseCalls(label: string): string {
  const match = label.match(/^(\d+)/);
  return match?.[1] ?? "0";
}

function buildSparklinePath(points: number[], width = 120, height = 34): string {
  if (points.length < 2) return "";
  const max = Math.max(...points);
  const min = Math.min(...points);
  const range = max - min || 1;
  return points
    .map((point, index) => {
      const x = (index / Math.max(points.length - 1, 1)) * width;
      const y = height - ((point - min) / range) * (height - 4) + 2;
      return `${index === 0 ? "M" : "L"}${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(" ");
}

export function LeaderboardTrend({ row }: { row: LeaderboardRowVM }) {
  const path = buildSparklinePath(row.trendPoints);
  if (!path) {
    return <span className="text-[11px] uppercase tracking-[0.14em] text-white/28">No trend</span>;
  }
  return (
    <svg viewBox="0 0 120 40" className="h-10 w-28" aria-hidden="true">
      <path
        d={path}
        fill="none"
        stroke={row.valueTone === "loss" ? "rgba(248,113,113,0.9)" : "rgba(169,255,52,0.9)"}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
      />
    </svg>
  );
}

export function LeaderboardRankTable({
  rows,
  currentUserId,
  onSelectRow,
  title,
  subtitle,
}: {
  rows: LeaderboardRowVM[];
  currentUserId?: string | null;
  onSelectRow: (row: LeaderboardRowVM) => void;
  title: string;
  subtitle: string;
}) {
  return (
    <V2Surface className="overflow-hidden p-0">
      <div className="flex items-center justify-between gap-3 border-b border-white/8 px-5 py-3.5">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-white/38">Rank Table</div>
          <h2 className="mt-1 text-lg font-semibold text-white">{title}</h2>
          <p className="mt-0.5 text-xs text-white/46">{subtitle}</p>
        </div>
        <V2StatusPill tone="default">{rows.length} rows</V2StatusPill>
      </div>

      <div className="overflow-x-auto">
        <table className="min-w-[840px] w-full border-collapse text-left">
          <thead>
            <tr className="border-b border-white/8 text-[10px] uppercase tracking-[0.16em] text-white/36">
              <th className="w-16 px-5 py-2.5 font-semibold">Rank</th>
              <th className="px-3 py-2.5 font-semibold">User</th>
              <th className="px-3 py-2.5 font-semibold">Signal ROI</th>
              <th className="px-3 py-2.5 font-semibold">Win Rate</th>
              <th className="px-3 py-2.5 font-semibold">Calls</th>
              <th className="px-3 py-2.5 font-semibold">Followers</th>
              <th className="px-3 py-2.5 font-semibold">Trend</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const isCurrent = currentUserId === row.id;
              return (
                <tr
                  key={row.id}
                  onClick={() => onSelectRow(row)}
                  className={cn(
                    "cursor-pointer border-b border-white/6 transition-colors hover:bg-white/[0.04]",
                    isCurrent && "bg-lime-300/[0.07] outline outline-1 outline-lime-300/35"
                  )}
                >
                  <td className="px-5 py-2.5">
                    <span
                      className={cn(
                        "inline-flex h-8 w-8 items-center justify-center rounded-full text-sm font-bold",
                        row.rank === 1
                          ? "bg-yellow-300 text-black"
                          : row.rank === 2
                            ? "bg-slate-200 text-black"
                            : row.rank === 3
                              ? "bg-orange-300 text-black"
                              : "border border-white/10 bg-white/[0.04] text-white/70"
                      )}
                    >
                      {row.rank}
                    </span>
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="flex items-center gap-3">
                      <Avatar className="h-9 w-9 border border-white/10">
                        <AvatarImage src={row.avatarUrl ?? undefined} />
                        <AvatarFallback className="bg-white/[0.06] text-white">{row.avatarFallback}</AvatarFallback>
                      </Avatar>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="truncate text-sm font-semibold text-white">{row.displayName}</span>
                          {isCurrent ? <span className="rounded-full bg-lime-300/18 px-2 py-0.5 text-[10px] font-semibold text-lime-200">Your Rank</span> : null}
                        </div>
                        <div className="truncate text-xs text-white/42">{row.handle ?? row.metadataLabel}</div>
                      </div>
                    </div>
                  </td>
                  <td className={cn("px-3 py-2.5 text-sm font-semibold", row.valueTone === "loss" ? "text-red-300" : "text-[#76ff44]")}>
                    {row.valueLabel}
                  </td>
                  <td className="px-3 py-2.5 text-sm text-white/78">{row.changeLabel ?? "--"}</td>
                  <td className="px-3 py-2.5 text-sm text-white/78">{parseCalls(row.metadataLabel)}</td>
                  <td className="px-3 py-2.5 text-sm text-white/78">{row.followersLabel}</td>
                  <td className="px-3 py-2.5"><LeaderboardTrend row={row} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {rows.length === 0 ? (
        <div className="px-5 py-12 text-center">
          <div className="text-lg font-semibold text-white">No ranked rows available</div>
          <p className="mt-2 text-sm text-white/48">This board appears once real backend leaderboard data is available.</p>
        </div>
      ) : null}
    </V2Surface>
  );
}

export function LeaderboardWalletUnavailable() {
  return (
    <V2Surface className="p-6">
      <div className="rounded-[20px] border border-amber-300/20 bg-[radial-gradient(circle_at_top_left,rgba(251,191,36,0.12),transparent_34%),linear-gradient(180deg,rgba(20,14,8,0.98),rgba(7,8,10,0.99))] p-6">
        <V2StatusPill tone="risk">Unavailable</V2StatusPill>
        <h2 className="mt-4 text-2xl font-semibold text-white">Wallet Performance Requires Real Portfolio Snapshots</h2>
        <p className="mt-3 max-w-3xl text-sm leading-6 text-white/58">
          This board is disabled until wallet-backed realized PnL and portfolio snapshot data exists. Call ROI is intentionally not reused as wallet profit.
        </p>
      </div>
    </V2Surface>
  );
}

export function LeaderboardRightRail({
  topMovers,
  raidLeaders,
  onSelectRow,
  period,
}: {
  topMovers: LeaderboardRowVM[];
  raidLeaders: LeaderboardRowVM[];
  onSelectRow: (row: LeaderboardRowVM) => void;
  period: string;
}) {
  return (
    <div className="space-y-4">
      <RailCard title="Top Movers" badge={period.toUpperCase()}>
        {topMovers.slice(0, 5).map((row, index) => (
          <button key={row.id} type="button" onClick={() => onSelectRow(row)} className="flex w-full items-center justify-between gap-3 rounded-[14px] border border-white/8 bg-white/[0.03] px-3 py-2.5 text-left hover:bg-white/[0.06]">
            <div className="flex min-w-0 items-center gap-3">
              <span className="text-sm font-semibold text-white/42">{index + 1}</span>
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold text-white">{row.displayName}</div>
                <div className="truncate text-xs text-white/42">{row.changeLabel ?? row.metadataLabel}</div>
              </div>
            </div>
            <span className={cn("text-sm font-semibold", row.valueTone === "loss" ? "text-red-300" : "text-[#76ff44]")}>{row.valueLabel}</span>
          </button>
        ))}
        {!topMovers.length ? <RailEmpty>Top movers appear once settled call-performance rows are available.</RailEmpty> : null}
      </RailCard>

      <RailCard title="AI Highlights">
        {topMovers.slice(0, 3).map((row) => (
          <div key={`ai-${row.id}`} className="rounded-[14px] border border-white/8 bg-black/20 px-3 py-3">
            <div className="text-sm font-semibold text-white">{row.displayName}</div>
            <p className="mt-1 text-xs leading-5 text-white/48">
              Ranked from real call outcomes: {row.valueLabel} signal ROI, {row.changeLabel ?? "win rate pending"}.
            </p>
          </div>
        ))}
        {!topMovers.length ? <RailEmpty>AI highlights are generated from real ranked call outcomes.</RailEmpty> : null}
      </RailCard>

      <RailCard title="Active Raid Leaders" badge="Live">
        {raidLeaders.slice(0, 3).map((row) => (
          <div key={`raid-${row.id}`} className="flex items-center justify-between gap-3 rounded-[14px] border border-white/8 bg-black/20 px-3 py-2.5">
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold text-white">{row.displayName}</div>
              <div className="truncate text-xs text-white/42">{row.changeLabel}</div>
            </div>
            <span className="text-sm font-semibold text-lime-300">{row.valueLabel}</span>
          </div>
        ))}
        {!raidLeaders.length ? <RailEmpty>Raid leaders appear once live community activity is ranked.</RailEmpty> : null}
      </RailCard>

      <RailCard title="Leaderboard Legend">
        {[
          { icon: Trophy, label: "Legend", text: "Top call-performance rank." },
          { icon: BrainCircuit, label: "High Conviction", text: "Consistent signal ROI." },
          { icon: Flame, label: "Raid Leaders", text: "Community pressure and activity." },
          { icon: ShieldCheck, label: "Wallet Board", text: "Disabled until wallet PnL exists." },
        ].map((item) => {
          const Icon = item.icon;
          return (
            <div key={item.label} className="flex gap-3 rounded-[14px] border border-white/8 bg-black/20 px-3 py-3">
              <Icon className="mt-0.5 h-4 w-4 shrink-0 text-lime-300" />
              <div>
                <div className="text-sm font-semibold text-white">{item.label}</div>
                <div className="mt-0.5 text-xs text-white/46">{item.text}</div>
              </div>
            </div>
          );
        })}
      </RailCard>
    </div>
  );
}

export function LeaderboardFeatureRail() {
  const items = [
    { icon: Activity, title: "Compete", text: "Climb from real ranked outcomes" },
    { icon: Coins, title: "Earn Rewards", text: "Top traders earn platform rewards" },
    { icon: ShieldCheck, title: "Build Reputation", text: "Separate calls, XP, and wallet state" },
    { icon: Users, title: "Lead the Community", text: "Raid and room activity stay visible" },
  ];
  return (
    <V2Surface className="grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-4">
      {items.map((item) => {
        const Icon = item.icon;
        return (
          <div key={item.title} className="flex items-center gap-3 rounded-[14px] bg-white/[0.03] px-4 py-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-lime-300/10">
              <Icon className="h-5 w-5 text-lime-300" />
            </div>
            <div>
              <div className="text-sm font-semibold text-white">{item.title}</div>
              <div className="mt-0.5 text-xs text-white/46">{item.text}</div>
            </div>
          </div>
        );
      })}
    </V2Surface>
  );
}

function RailCard({ title, badge, children }: { title: string; badge?: string; children: ReactNode }) {
  return (
    <V2Surface className="p-5" tone="soft">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h3 className="text-base font-semibold text-white">{title}</h3>
        {badge ? <V2StatusPill tone={badge === "Live" ? "live" : "default"}>{badge}</V2StatusPill> : null}
      </div>
      <div className="space-y-3">{children}</div>
    </V2Surface>
  );
}

function RailEmpty({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-[14px] border border-dashed border-white/12 bg-black/20 px-3 py-3 text-xs leading-5 text-white/46">
      {children}
    </div>
  );
}
