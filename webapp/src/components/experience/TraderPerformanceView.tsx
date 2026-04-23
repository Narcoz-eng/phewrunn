import type { ReactNode } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type {
  LeaderboardPinnedRankVM,
  LeaderboardRowVM,
  TraderPerformanceVM,
} from "@/viewmodels/trader-performance";

type ChipOption = {
  key: string;
  label: string;
  active: boolean;
  disabled?: boolean;
  onSelect?: () => void;
};

type ActionButton = {
  key: string;
  label: ReactNode;
  onClick?: () => void;
  variant?: "primary" | "ghost";
};

function buildSparklinePath(points: number[], width: number, height: number): string {
  if (points.length === 0) return "";
  const max = Math.max(...points);
  const min = Math.min(...points);
  const range = max - min || 1;

  return points
    .map((point, index) => {
      const x = (index / Math.max(points.length - 1, 1)) * width;
      const y = height - ((point - min) / range) * height;
      return `${index === 0 ? "M" : "L"}${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(" ");
}

function RankBadge({ rank }: { rank: number }) {
  const toneClass =
    rank === 1
      ? "bg-[#f2b940] text-[#221404]"
      : rank === 2
        ? "bg-[#c8ccd8] text-[#161a25]"
        : rank === 3
          ? "bg-[#b87443] text-[#160c05]"
          : "bg-white/5 text-white/70";

  return (
    <div className={cn("flex h-10 w-10 items-center justify-center rounded-full text-sm font-semibold", toneClass)}>
      {rank}
    </div>
  );
}

function ValueTone({ tone, children }: { tone: "gain" | "loss" | "neutral"; children: ReactNode }) {
  return (
    <span
      className={cn(
        tone === "gain" && "text-gain",
        tone === "loss" && "text-loss",
        tone === "neutral" && "text-white"
      )}
    >
      {children}
    </span>
  );
}

function MetricTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[22px] border border-white/7 bg-white/[0.035] px-3 py-3">
      <div className="text-[10px] uppercase tracking-[0.22em] text-white/36">{label}</div>
      <div className="mt-2 text-sm font-medium text-white/88">{value}</div>
    </div>
  );
}

export function TerminalChipTabs({ options }: { options: ChipOption[] }) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((option) => (
        <button
          key={option.key}
          type="button"
          onClick={option.onSelect}
          disabled={option.disabled}
          className={cn(
            "rounded-full border px-3 py-1.5 text-xs font-medium tracking-wide transition-colors",
            option.active
              ? "border-[#7cf2c7]/25 bg-[#7cf2c7]/12 text-[#a7f7dd]"
              : "border-white/8 bg-white/4 text-white/56 hover:bg-white/8 hover:text-white/82",
            option.disabled && "cursor-not-allowed opacity-45"
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function TraderPerformanceView({
  vm,
  headerActions,
  heroTabs,
}: {
  vm: TraderPerformanceVM;
  headerActions?: ActionButton[];
  heroTabs?: ChipOption[];
}) {
  const sparklinePath = buildSparklinePath(vm.chartPoints, 100, 42);

  return (
    <section className="overflow-hidden rounded-[32px] border border-white/7 bg-[#090b15] shadow-[0_24px_80px_rgba(0,0,0,0.34)]">
      <div className="bg-[radial-gradient(circle_at_top_left,rgba(86,214,180,0.12),transparent_38%),linear-gradient(180deg,rgba(255,255,255,0.025),rgba(255,255,255,0))] px-5 pb-5 pt-5 sm:px-6">
        <div className="flex items-start justify-between gap-4 border-b border-white/6 pb-5">
          <div className="flex min-w-0 items-start gap-4">
            <Avatar className="h-20 w-20 border border-white/10 shadow-[0_0_0_8px_rgba(255,255,255,0.02)]">
              <AvatarImage src={vm.avatarUrl ?? undefined} />
              <AvatarFallback className="bg-white/5 text-xl font-semibold text-white">
                {vm.avatarFallback}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <div className="rounded-full border border-[#7cf2c7]/14 bg-[#7cf2c7]/8 px-2.5 py-1 text-[10px] uppercase tracking-[0.22em] text-[#9cf5d7]">
                  {vm.surfaceLabel}
                </div>
                <h1 className="truncate text-[1.8rem] font-semibold leading-none text-white sm:text-[2.05rem]">
                  {vm.displayName}
                </h1>
                {vm.handle ? (
                  <span className="rounded-xl border border-white/7 bg-white/[0.04] px-2.5 py-1 text-sm text-white/62">
                    {vm.handle}
                  </span>
                ) : null}
              </div>
              {vm.bio ? <p className="mt-3 max-w-xl text-sm leading-6 text-white/72">{vm.bio}</p> : null}
              <div className="mt-5 grid grid-cols-2 gap-2 lg:grid-cols-3 xl:grid-cols-6">
                {vm.stats.map((stat) => (
                  <MetricTile key={`${stat.label}:${stat.value}`} label={stat.label} value={stat.value} />
                ))}
              </div>
            </div>
          </div>
          {headerActions?.length ? (
            <div className="flex shrink-0 flex-wrap justify-end gap-2">
              {headerActions.map((action) => (
                <Button
                  key={action.key}
                  type="button"
                  onClick={action.onClick}
                  className={cn(
                    "h-10 rounded-2xl px-4",
                    action.variant === "primary"
                      ? "bg-gain text-black hover:bg-gain/90"
                      : "border border-white/8 bg-white/5 text-white hover:bg-white/10"
                  )}
                  variant={action.variant === "primary" ? "default" : "ghost"}
                >
                  {action.label}
                </Button>
              ))}
            </div>
          ) : null}
        </div>
      </div>

      <div className="px-5 pb-5 pt-5 sm:px-6">
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1.35fr)_340px]">
          <div className="rounded-[28px] border border-white/6 bg-[#060811] p-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-[11px] uppercase tracking-[0.24em] text-white/38">{vm.heroLabel}</div>
                <div className="mt-2 text-[3rem] font-semibold leading-none tracking-tight text-white sm:text-[3.6rem]">
                  {vm.heroValueLabel}
                </div>
                {vm.heroSubValueLabel ? (
                  <div className="mt-3 flex flex-wrap items-center gap-2 text-base">
                    <ValueTone tone={vm.heroSubTone}>{vm.heroSubValueLabel}</ValueTone>
                    {vm.heroSubCaption ? <span className="text-white/52">{vm.heroSubCaption}</span> : null}
                  </div>
                ) : null}
              </div>
              {heroTabs?.length ? <TerminalChipTabs options={heroTabs} /> : null}
            </div>

            <div className="mt-5 overflow-hidden rounded-[24px] border border-white/6 bg-[linear-gradient(180deg,rgba(14,18,34,0.98),rgba(8,10,18,0.98))] px-2 pb-2 pt-5">
              <div className="px-4 text-[10px] uppercase tracking-[0.22em] text-white/34">{vm.chartLabel}</div>
              <svg viewBox="0 0 100 42" className="mt-3 h-[180px] w-full sm:h-[220px]" preserveAspectRatio="none">
                <path d={`${sparklinePath} L100 42 L0 42 Z`} fill="url(#terminal-area-fill)" opacity="0.16" />
                <path d={sparklinePath} fill="none" stroke="url(#terminal-line)" strokeWidth="1.8" strokeLinecap="round" />
                <defs>
                  <linearGradient id="terminal-line" x1="0%" x2="100%">
                    <stop offset="0%" stopColor="rgba(124, 242, 199, 0.74)" />
                    <stop offset="100%" stopColor="rgba(26, 215, 132, 0.98)" />
                  </linearGradient>
                  <linearGradient id="terminal-area-fill" x1="0%" x2="0%" y1="0%" y2="100%">
                    <stop offset="0%" stopColor="rgba(26, 215, 132, 0.78)" />
                    <stop offset="100%" stopColor="rgba(26, 215, 132, 0)" />
                  </linearGradient>
                </defs>
              </svg>
            </div>
          </div>

          <div className="grid gap-4">
            <div className="rounded-[28px] border border-white/6 bg-white/[0.03] p-5">
              <div className="text-[11px] uppercase tracking-[0.22em] text-white/34">Available cash</div>
              <div className="mt-3 text-[2.4rem] font-semibold leading-none text-white">
                {vm.cashBalanceLabel ?? "Unavailable"}
              </div>
              <div className="mt-3 text-sm text-white/52">
                Balance is shown from the connected wallet snapshot when available.
              </div>
            </div>

            <div className="rounded-[28px] border border-white/6 bg-white/[0.03] p-5">
              <div className="text-[11px] uppercase tracking-[0.22em] text-white/34">Position stream</div>
              <h2 className="mt-2 text-[1.45rem] font-semibold text-white">{vm.positionsHeading}</h2>
              {vm.positionsCaption ? <p className="mt-2 text-sm text-white/48">{vm.positionsCaption}</p> : null}
              {vm.positionsCountLabel ? (
                <div className="mt-4 inline-flex rounded-full border border-white/8 bg-white/5 px-3 py-1 text-sm text-white/72">
                  {vm.positionsCountLabel} visible
                </div>
              ) : null}
            </div>
          </div>
        </div>

        <div className="mt-5 rounded-[28px] border border-white/6 bg-white/[0.02] p-4 sm:p-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-[11px] uppercase tracking-[0.22em] text-white/34">Rows</div>
              <h2 className="mt-2 text-[1.35rem] font-semibold text-white">{vm.positionsHeading}</h2>
            </div>
            {vm.positionsCountLabel ? <span className="text-sm text-white/42">{vm.positionsCountLabel} visible</span> : null}
          </div>

          <div className="mt-4 space-y-3">
            {vm.positions.map((position) => {
              const rowContent = (
                <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-3 rounded-[22px] border border-white/6 bg-[#0c0f1b] px-3 py-3 transition-colors hover:bg-[#101425]">
                  <div className="flex min-w-0 items-center gap-3">
                    <Avatar className="h-12 w-12 border border-white/8">
                      <AvatarImage src={position.imageUrl ?? undefined} />
                      <AvatarFallback className="bg-white/5 text-base text-white">
                        {position.tokenLabel.charAt(0).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    <div className="min-w-0">
                      <div className="truncate text-[1rem] font-semibold text-white">{position.tokenLabel}</div>
                      <div className="mt-1 truncate text-sm text-white/46">{position.tokenSubLabel}</div>
                    </div>
                  </div>
                  <div className="text-right text-[1rem] font-semibold text-white">{position.valueLabel}</div>
                  <div className="text-right text-sm font-medium">
                    {position.changeLabel ? (
                      <ValueTone tone={position.changeTone}>{position.changeLabel}</ValueTone>
                    ) : (
                      <span className="text-white/34">-</span>
                    )}
                  </div>
                </div>
              );

              if (!position.href) {
                return <div key={position.id}>{rowContent}</div>;
              }

              return (
                <a key={position.id} href={position.href} className="block">
                  {rowContent}
                </a>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}

export function DenseLeaderboardView({
  eyebrow,
  title,
  subtitle,
  pinnedRank,
  timeframeTabs,
  modeTabs,
  rows,
  onSelectRow,
}: {
  eyebrow?: string;
  title: string;
  subtitle?: string;
  pinnedRank: LeaderboardPinnedRankVM | null;
  timeframeTabs: ChipOption[];
  modeTabs: ChipOption[];
  rows: LeaderboardRowVM[];
  onSelectRow: (row: LeaderboardRowVM) => void;
}) {
  const podiumRows = rows.slice(0, 3);
  const tableRows = podiumRows.length >= 3 ? rows.slice(3) : rows;

  return (
    <section className="overflow-hidden rounded-[32px] border border-white/7 bg-[#090b15] px-5 pb-5 pt-5 shadow-[0_24px_80px_rgba(0,0,0,0.34)] sm:px-6">
      <div className="flex items-end justify-between gap-4 border-b border-white/6 pb-4">
        <div>
          {eyebrow ? <div className="text-[11px] uppercase tracking-[0.24em] text-white/36">{eyebrow}</div> : null}
          <h1 className="mt-2 text-[1.9rem] font-semibold text-white">{title}</h1>
          {subtitle ? <p className="mt-1 max-w-2xl text-sm leading-6 text-white/52">{subtitle}</p> : null}
        </div>
      </div>

      {podiumRows.length === 3 ? (
        <div className="mt-5 grid gap-4 xl:grid-cols-[0.92fr_1.1fr_0.92fr]">
          {[podiumRows[1], podiumRows[0], podiumRows[2]].map((row) => {
            if (!row) return null;
            const isChampion = row.rank === 1;
            return (
              <button
                key={`podium-${row.id}`}
                type="button"
                onClick={() => onSelectRow(row)}
                className={cn(
                  "relative overflow-hidden rounded-[30px] border px-5 py-5 text-left transition-colors",
                  isChampion
                    ? "border-[#d4ff5b]/28 bg-[radial-gradient(circle_at_top,rgba(212,255,91,0.16),transparent_34%),linear-gradient(180deg,rgba(18,22,14,0.98),rgba(7,11,9,0.99))]"
                    : row.rank === 2
                      ? "border-white/10 bg-[linear-gradient(180deg,rgba(14,18,28,0.98),rgba(8,10,18,0.99))]"
                      : "border-amber-400/18 bg-[linear-gradient(180deg,rgba(30,18,12,0.98),rgba(12,7,5,0.99))]"
                )}
              >
                <div className="flex items-start justify-between gap-4">
                  <RankBadge rank={row.rank} />
                  {row.changeLabel ? (
                    <div className="text-right text-xs font-medium">
                      <ValueTone tone={row.changeTone}>{row.changeLabel}</ValueTone>
                    </div>
                  ) : null}
                </div>

                <div className="mt-5 flex items-center gap-4">
                  <Avatar className={cn("border border-white/12", isChampion ? "h-24 w-24" : "h-20 w-20")}>
                    <AvatarImage src={row.avatarUrl ?? undefined} />
                    <AvatarFallback className="bg-white/5 text-white">{row.avatarFallback}</AvatarFallback>
                  </Avatar>
                  <div className="min-w-0">
                    <div className="truncate text-[1.45rem] font-semibold text-white">{row.displayName}</div>
                    <div className="mt-1 truncate text-sm text-white/48">
                      {[row.handle, row.metadataLabel].filter(Boolean).join(" • ")}
                    </div>
                  </div>
                </div>

                <div className="mt-6">
                  <div className="text-[2.5rem] font-semibold leading-none">
                    <ValueTone tone={row.valueTone}>{row.valueLabel}</ValueTone>
                  </div>
                  <div className="mt-2 text-sm text-white/46">
                    {isChampion ? "Top ranked board leader" : "Current board podium"}
                  </div>
                </div>

                <div className="mt-5 flex items-center justify-between gap-3 rounded-[22px] border border-white/8 bg-white/[0.04] px-4 py-3">
                  <div className="text-[11px] uppercase tracking-[0.18em] text-white/34">Recent tokens</div>
                  <div className="flex gap-1.5">
                    {row.recentTokens.slice(0, 3).map((token) => (
                      <Avatar key={`${row.id}:podium:${token.address}`} className="h-8 w-8 border border-white/10">
                        <AvatarImage src={token.image ?? undefined} />
                        <AvatarFallback className="bg-white/5 text-[10px] text-white">
                          {(token.symbol ?? "?").charAt(0).toUpperCase()}
                        </AvatarFallback>
                      </Avatar>
                    ))}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      ) : null}

      {pinnedRank ? (
        <div className="mt-5 flex items-center justify-between gap-4 rounded-[28px] border border-white/6 bg-[linear-gradient(135deg,rgba(124,242,199,0.09),rgba(255,255,255,0.03))] px-4 py-4">
          <div className="flex items-center gap-3">
            <Avatar className="h-14 w-14 border border-white/10">
              <AvatarImage src={pinnedRank.avatarUrl ?? undefined} />
              <AvatarFallback className="bg-white/5 text-white">{pinnedRank.avatarFallback}</AvatarFallback>
            </Avatar>
            <div>
              <div className="text-sm text-white/56">{pinnedRank.title}</div>
              <div className="mt-1 text-[2rem] font-semibold leading-none text-[#9cf5d7]">{pinnedRank.rankLabel}</div>
            </div>
          </div>
          <div className="text-right text-[2rem] font-semibold leading-none">
            <ValueTone tone={pinnedRank.valueTone}>{pinnedRank.valueLabel}</ValueTone>
          </div>
        </div>
      ) : null}

      <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-[11px] uppercase tracking-[0.22em] text-white/34">Ranking rows</div>
          <h2 className="mt-2 text-[1.55rem] font-semibold text-white">Top performers</h2>
        </div>
        <div className="flex flex-wrap gap-2">
          {modeTabs.length ? <TerminalChipTabs options={modeTabs} /> : null}
          <TerminalChipTabs options={timeframeTabs} />
        </div>
      </div>

      <div className="mt-5 space-y-3">
        {tableRows.map((row) => (
          <button
            key={row.id}
            type="button"
            onClick={() => onSelectRow(row)}
            className="grid w-full grid-cols-[40px_56px_minmax(0,1fr)_auto_auto] items-center gap-3 rounded-[24px] border border-white/6 bg-[#0c0f1b] px-3 py-3 text-left transition-colors hover:bg-[#101425]"
          >
            <div className="w-9 shrink-0">
              {row.rank <= 3 ? (
                <RankBadge rank={row.rank} />
              ) : (
                <div className="pl-1 text-[1.45rem] leading-none text-white/72">{row.rank}.</div>
              )}
            </div>
            <Avatar className="h-14 w-14 border border-white/10">
              <AvatarImage src={row.avatarUrl ?? undefined} />
              <AvatarFallback className="bg-white/5 text-white">{row.avatarFallback}</AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1">
              <div className="truncate text-[1.1rem] font-semibold text-white sm:text-[1.2rem]">{row.displayName}</div>
              <div className="mt-1 truncate text-sm text-white/48">
                {[row.handle, row.metadataLabel].filter(Boolean).join(" • ")}
              </div>
            </div>
            <div className="shrink-0 text-right">
              <div className="text-[1.25rem] font-semibold leading-none">
                <ValueTone tone={row.valueTone}>{row.valueLabel}</ValueTone>
              </div>
              {row.changeLabel ? (
                <div className="mt-1 text-xs font-medium">
                  <ValueTone tone={row.changeTone}>{row.changeLabel}</ValueTone>
                </div>
              ) : null}
            </div>
            <div className="shrink-0">
              {row.recentTokens.length ? (
                <div className="flex justify-end gap-1.5">
                  {row.recentTokens.slice(0, 3).map((token) => (
                    <Avatar key={`${row.id}:${token.address}`} className="h-7 w-7 border border-white/8">
                      <AvatarImage src={token.image ?? undefined} />
                      <AvatarFallback className="bg-white/5 text-[10px] text-white">
                        {(token.symbol ?? "?").charAt(0).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                  ))}
                </div>
              ) : (
                <span className="text-xs text-white/28">No recent tokens</span>
              )}
            </div>
          </button>
        ))}
      </div>
    </section>
  );
}
