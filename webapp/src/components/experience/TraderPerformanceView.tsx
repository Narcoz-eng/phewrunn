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
            "terminal-chip",
            option.active && "terminal-chip-active",
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
    <section className="terminal-card overflow-hidden">
      <div className="border-b border-white/6 px-5 pb-5 pt-5 sm:px-6">
        <div className="flex items-start justify-between gap-4">
          <div className="flex min-w-0 items-start gap-4">
            <div className="relative">
              <Avatar className="h-20 w-20 border border-white/10">
                <AvatarImage src={vm.avatarUrl ?? undefined} />
                <AvatarFallback className="bg-white/5 text-xl font-semibold text-white">
                  {vm.avatarFallback}
                </AvatarFallback>
              </Avatar>
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <div className="rounded-full border border-white/8 bg-white/4 px-2.5 py-1 text-[10px] uppercase tracking-[0.22em] text-white/42">
                  Performance
                </div>
                <h1 className="truncate text-[1.8rem] font-semibold leading-none text-white sm:text-[2.15rem]">
                  {vm.displayName}
                </h1>
                {vm.handle ? (
                  <span className="rounded-xl bg-white/6 px-2 py-1 text-sm text-white/62">{vm.handle}</span>
                ) : null}
              </div>
              {vm.bio ? (
                <p className="mt-3 max-w-xl text-base text-white/74">{vm.bio}</p>
              ) : null}
              <div className="mt-5 grid gap-2 text-sm text-white/68 sm:grid-cols-2 xl:grid-cols-5">
                <span><strong className="text-white">{vm.followingLabel.split(" ")[0]}</strong> Following</span>
                <span><strong className="text-white">{vm.followersLabel.split(" ")[0]}</strong> Followers</span>
                <span>{vm.avgHoldLabel}</span>
                <span>{vm.tradeCountLabel}</span>
                <span>{vm.joinedLabel}</span>
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

      <div className="terminal-dot-grid px-5 pb-5 pt-5 sm:px-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-[11px] uppercase tracking-[0.24em] text-white/38">Primary performance</div>
            <div className="mt-2 text-[3rem] font-semibold leading-none tracking-tight text-white sm:text-[4rem]">
              {vm.heroValueLabel}
            </div>
            {vm.heroSubValueLabel ? (
              <div className="mt-3 flex items-center gap-2 text-lg">
                <ValueTone tone={vm.heroSubTone}>{vm.heroSubValueLabel}</ValueTone>
                {vm.heroSubCaption ? <span className="text-white/56">{vm.heroSubCaption}</span> : null}
              </div>
            ) : null}
          </div>
          {heroTabs?.length ? <TerminalChipTabs options={heroTabs} /> : null}
        </div>

        <div className="mt-8 overflow-hidden rounded-[28px] bg-[#07060d] px-1 pb-1 pt-6">
          <svg viewBox="0 0 100 42" className="h-[180px] w-full sm:h-[220px]" preserveAspectRatio="none">
            <path d={`${sparklinePath} L100 42 L0 42 Z`} fill="url(#terminal-area-fill)" opacity="0.12" />
            <path d={sparklinePath} fill="none" stroke="url(#terminal-line)" strokeWidth="1.65" strokeLinecap="round" />
            <defs>
              <linearGradient id="terminal-line" x1="0%" x2="100%">
                <stop offset="0%" stopColor="rgba(67, 229, 112, 0.78)" />
                <stop offset="100%" stopColor="rgba(34, 197, 94, 0.98)" />
              </linearGradient>
              <linearGradient id="terminal-area-fill" x1="0%" x2="0%" y1="0%" y2="100%">
                <stop offset="0%" stopColor="rgba(34, 197, 94, 0.7)" />
                <stop offset="100%" stopColor="rgba(34, 197, 94, 0)" />
              </linearGradient>
            </defs>
          </svg>
        </div>

        <div className="mt-6 grid gap-3 sm:grid-cols-[1fr_auto] sm:items-center">
          <div className="terminal-soft-card flex items-center gap-4 px-4 py-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/5 text-2xl text-white/88">$</div>
            <div>
              <div className="text-sm text-white/56">Cash balance</div>
              <div className="mt-1 text-[2rem] font-semibold leading-none text-white">
                {vm.cashBalanceLabel ?? "Unavailable"}
              </div>
            </div>
          </div>
        </div>

        <div className="mt-8">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <h2 className="text-[1.65rem] font-semibold text-white">{vm.positionsHeading}</h2>
              {vm.positionsCountLabel ? <span className="text-sm text-white/44">| {vm.positionsCountLabel}</span> : null}
            </div>
          </div>

          <div className="mt-5 space-y-4">
            {vm.positions.map((position) => {
              const rowContent = (
                <div className="terminal-list-row flex items-center justify-between gap-4 rounded-[26px] px-3 py-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <Avatar className="h-14 w-14 border border-white/8">
                      <AvatarImage src={position.imageUrl ?? undefined} />
                      <AvatarFallback className="bg-white/5 text-lg text-white">
                        {position.tokenLabel.charAt(0).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    <div className="min-w-0">
                      <div className="truncate text-[1.05rem] font-semibold text-white sm:text-[1.15rem]">
                        {position.tokenLabel}
                      </div>
                      <div className="mt-1 truncate text-sm text-white/48">{position.tokenSubLabel}</div>
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="text-[1.1rem] font-semibold text-white">{position.valueLabel}</div>
                    {position.changeLabel ? (
                      <div className="mt-1 text-sm font-medium">
                        <ValueTone tone={position.changeTone}>{position.changeLabel}</ValueTone>
                      </div>
                    ) : null}
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
  return (
    <section className="terminal-card px-5 pb-5 pt-5 sm:px-6">
      <div className="flex items-end justify-between gap-4 border-b border-white/6 pb-4">
        <div>
          {eyebrow ? <div className="text-sm text-white/38">{eyebrow}</div> : null}
          <h1 className="mt-1 text-[1.8rem] font-semibold text-white">{title}</h1>
          {subtitle ? <p className="mt-1 text-sm text-white/50">{subtitle}</p> : null}
        </div>
      </div>

      {pinnedRank ? (
        <div className="mt-5 terminal-soft-card flex items-center justify-between gap-4 rounded-[28px] px-4 py-4">
          <div className="flex items-center gap-3">
            <Avatar className="h-14 w-14 border border-white/10">
              <AvatarImage src={pinnedRank.avatarUrl ?? undefined} />
              <AvatarFallback className="bg-white/5 text-white">{pinnedRank.avatarFallback}</AvatarFallback>
            </Avatar>
            <div>
              <div className="text-sm text-white/56">{pinnedRank.title}</div>
              <div className="mt-1 text-[2rem] font-semibold leading-none text-[#6d76ff]">{pinnedRank.rankLabel}</div>
            </div>
          </div>
          <div className="text-right text-[2rem] font-semibold leading-none">
            <ValueTone tone={pinnedRank.valueTone}>{pinnedRank.valueLabel}</ValueTone>
          </div>
        </div>
      ) : null}

      <div className="mt-6 flex items-center justify-between gap-3">
        <h2 className="text-[1.75rem] font-semibold text-white">Top traders</h2>
        <TerminalChipTabs options={timeframeTabs} />
      </div>

      <div className="mt-5 space-y-3">
        {rows.map((row) => (
          <button
            key={row.id}
            type="button"
            onClick={() => onSelectRow(row)}
            className="flex w-full items-center gap-3 rounded-[24px] px-2 py-2 text-left transition-colors hover:bg-white/[0.03]"
          >
            <div className="w-9 shrink-0">
              {row.rank <= 3 ? (
                <RankBadge rank={row.rank} />
              ) : (
                <div className="pl-1 text-[1.55rem] leading-none text-white/72">{row.rank}.</div>
              )}
            </div>
            <Avatar className="h-14 w-14 border border-white/10">
              <AvatarImage src={row.avatarUrl ?? undefined} />
              <AvatarFallback className="bg-white/5 text-white">{row.avatarFallback}</AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1">
              <div className="truncate text-[1.15rem] font-semibold text-white sm:text-[1.3rem]">{row.displayName}</div>
              <div className="mt-1 truncate text-sm text-white/48">
                {[row.handle, row.metadataLabel].filter(Boolean).join(" | ")}
              </div>
            </div>
            <div className="shrink-0 text-right">
              <div className="text-[1.35rem] font-semibold leading-none">
                <ValueTone tone={row.valueTone}>{row.valueLabel}</ValueTone>
              </div>
              {row.changeLabel ? (
                <div className="mt-1 text-xs font-medium">
                  <ValueTone tone={row.changeTone}>{row.changeLabel}</ValueTone>
                </div>
              ) : null}
              {row.recentTokens.length ? (
                <div className="mt-2 flex justify-end gap-1.5">
                  {row.recentTokens.slice(0, 3).map((token) => (
                    <Avatar key={`${row.id}:${token.address}`} className="h-7 w-7 border border-white/8">
                      <AvatarImage src={token.image ?? undefined} />
                      <AvatarFallback className="bg-white/5 text-[10px] text-white">
                        {(token.symbol ?? "?").charAt(0).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                  ))}
                </div>
              ) : null}
            </div>
          </button>
        ))}
      </div>
    </section>
  );
}
