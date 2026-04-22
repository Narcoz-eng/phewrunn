import type { ReactNode } from "react";
import { Coins, Copy, ExternalLink } from "lucide-react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { V2SectionHeader } from "@/components/ui/v2/V2SectionHeader";
import { V2StatusPill } from "@/components/ui/v2/V2StatusPill";
import { cn } from "@/lib/utils";

type StatItem = { label: string; value: string };
type MiniItem = { label: string; value: string; tone?: "gain" | "loss" | "default" };
type SignalItem = { label: string; caption: string; value: string; tone?: "ai" | "risk" | "live" | "default" };

export function TokenFlagshipHero({
  bannerUrl,
  imageUrl,
  symbol,
  name,
  address,
  chainType,
  activityLabel,
  confidenceLabel,
  bundleLabel,
  priceLabel,
  priceDeltaLabel,
  priceDeltaPositive,
  chartSourceLabel,
  stats,
  performance,
  contractHint,
  dexUrl,
  bundleUrl,
  communityUrl,
  raidUrl,
  communitySummary,
  raidSummary,
  signals,
  onCopyAddress,
  topTradeAction,
  moduleTradeAction,
  communityAction,
}: {
  bannerUrl: string | null;
  imageUrl: string | null;
  symbol: string;
  name: string;
  address: string;
  chainType: string;
  activityLabel: string;
  confidenceLabel: string;
  bundleLabel: string;
  priceLabel: string;
  priceDeltaLabel: string;
  priceDeltaPositive: boolean;
  chartSourceLabel: string;
  stats: StatItem[];
  performance: MiniItem[];
  contractHint: string;
  dexUrl: string;
  bundleUrl: string;
  communityUrl: string;
  raidUrl: string | null;
  communitySummary: string;
  raidSummary: string;
  signals: SignalItem[];
  onCopyAddress: () => void;
  topTradeAction: ReactNode;
  moduleTradeAction: ReactNode;
  communityAction: ReactNode;
}) {
  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1.45fr)_350px]">
      <section className="v2-hero-board p-0">
        {bannerUrl ? (
          <div className="relative h-32 border-b border-white/8 sm:h-40">
            <div
              className="absolute inset-0 bg-cover bg-center opacity-58"
              style={{ backgroundImage: `url("${bannerUrl}")` }}
              aria-hidden="true"
            />
            <div
              className="absolute inset-0 bg-[linear-gradient(180deg,rgba(2,6,8,0.22),rgba(2,6,8,0.88)),radial-gradient(circle_at_top_left,rgba(169,255,52,0.18),transparent_28%),radial-gradient(circle_at_top_right,rgba(45,212,191,0.16),transparent_28%)]"
              aria-hidden="true"
            />
          </div>
        ) : null}

        <div className="space-y-5 p-5 sm:p-6 lg:p-7">
          <div className="flex flex-col gap-6 xl:flex-row xl:items-start xl:justify-between">
            <div className="flex min-w-0 items-start gap-4">
              <div className="relative shrink-0">
                <div className="flex h-[88px] w-[88px] items-center justify-center overflow-hidden rounded-[28px] border border-lime-300/25 bg-black/24 shadow-[0_28px_68px_-30px_rgba(169,255,52,0.45)]">
                  {imageUrl ? (
                    <img src={imageUrl} alt={symbol} className="h-full w-full object-cover" />
                  ) : (
                    <Coins className="h-9 w-9 text-lime-300" />
                  )}
                </div>
                <span className="absolute -bottom-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full border border-black/35 bg-emerald-400 shadow-[0_0_20px_rgba(74,222,128,0.55)]">
                  <span className="h-2 w-2 rounded-full bg-[#03110a]" />
                </span>
              </div>

              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <V2StatusPill tone="live">{activityLabel}</V2StatusPill>
                  <V2StatusPill tone="ai">{confidenceLabel}</V2StatusPill>
                  <V2StatusPill tone="risk">{bundleLabel}</V2StatusPill>
                </div>

                <div className="mt-4 flex flex-wrap items-end gap-3">
                  <h2 className="text-4xl font-semibold tracking-tight text-white sm:text-5xl">{symbol}</h2>
                  <div className="pb-1 text-base text-white/58">{name}</div>
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] uppercase tracking-[0.18em] text-white/48">
                  <span className="rounded-full border border-white/10 bg-white/[0.03] px-3 py-1 font-mono">
                    {address.slice(0, 6)}...{address.slice(-4)}
                  </span>
                  <button
                    type="button"
                    onClick={onCopyAddress}
                    className="inline-flex h-8 items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-3 py-1 text-white/70 transition hover:bg-white/[0.06] hover:text-white"
                  >
                    <Copy className="h-3.5 w-3.5" />
                    Copy
                  </button>
                  <a
                    href={dexUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex h-8 items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-3 py-1 text-white/70 transition hover:bg-white/[0.06] hover:text-white"
                  >
                    Dexscreener
                    <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                  <span className="rounded-full border border-white/10 bg-white/[0.03] px-3 py-1">{chainType}</span>
                </div>
              </div>
            </div>

            <div className="flex shrink-0 flex-wrap items-center gap-2 xl:max-w-[240px] xl:justify-end">
              {topTradeAction}
              {communityAction}
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
            <div className="rounded-[28px] border border-white/8 bg-[linear-gradient(180deg,rgba(5,11,13,0.98),rgba(3,7,9,0.98))] p-5">
              <div className="flex flex-wrap items-end justify-between gap-4">
                <div>
                  <div className="text-sm text-white/48">Spot price</div>
                  <div className="mt-2 flex flex-wrap items-end gap-3">
                    <div className="text-4xl font-semibold tracking-tight text-white">{priceLabel}</div>
                    <div className={cn("pb-1 text-lg font-semibold", priceDeltaPositive ? "text-lime-300" : "text-rose-300")}>
                      {priceDeltaLabel}
                    </div>
                    <div className="pb-1 text-sm uppercase tracking-[0.18em] text-white/40">24H</div>
                  </div>
                </div>
                <div className="rounded-[20px] border border-white/8 bg-white/[0.03] px-4 py-3 text-sm text-white/62">
                  {chartSourceLabel}
                </div>
              </div>

              <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                {stats.map((item) => (
                  <div key={item.label} className="v2-micro-kpi">
                    <div className="text-[11px] uppercase tracking-[0.18em] text-white/38">{item.label}</div>
                    <div className="mt-2 text-xl font-semibold text-white">{item.value}</div>
                  </div>
                ))}
              </div>

              <div className="mt-4 grid gap-3 xl:grid-cols-[minmax(0,1fr)_240px_200px]">
                <div className="rounded-[24px] border border-white/8 bg-white/[0.03] p-4">
                  <div className="text-[11px] uppercase tracking-[0.18em] text-white/38">Performance</div>
                  <div className="mt-4 grid gap-3 sm:grid-cols-3">
                    {performance.map((item) => (
                      <div key={item.label}>
                        <div className="text-xs text-white/42">{item.label}</div>
                        <div
                          className={cn(
                            "mt-2 text-lg font-semibold",
                            item.tone === "gain"
                              ? "text-lime-300"
                              : item.tone === "loss"
                                ? "text-rose-300"
                                : "text-white"
                          )}
                        >
                          {item.value}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="rounded-[24px] border border-white/8 bg-white/[0.03] p-4">
                  <div className="text-[11px] uppercase tracking-[0.18em] text-white/38">Contract</div>
                  <div className="mt-3 break-all text-sm font-medium text-white/82">{address}</div>
                  <div className="mt-3 text-xs text-white/42">{contractHint}</div>
                </div>

                <div className="rounded-[24px] border border-white/8 bg-white/[0.03] p-4">
                  <div className="text-[11px] uppercase tracking-[0.18em] text-white/38">Links</div>
                  <div className="mt-3 grid gap-2">
                    <a
                      href={dexUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="rounded-[16px] border border-white/8 bg-white/[0.03] px-3 py-2 text-sm text-white/74 transition hover:bg-white/[0.06] hover:text-white"
                    >
                      Dexscreener
                    </a>
                    <Link
                      to={bundleUrl}
                      className="rounded-[16px] border border-cyan-300/16 bg-cyan-300/8 px-3 py-2 text-sm text-cyan-200 transition hover:bg-cyan-300/12"
                    >
                      Bundle checker
                    </Link>
                  </div>
                </div>
              </div>
            </div>

            <div className="space-y-4">
              <div className="v2-dense-module p-5">
                <V2SectionHeader
                  eyebrow="Operating modules"
                  title="Trade, community, raids"
                  description="The token page is the control surface for execution and social coordination."
                />
                <div className="mt-4 grid gap-3">
                  <div className="v2-signal-row">
                    <div>
                      <div className="text-sm font-semibold text-white">Trading terminal</div>
                      <div className="mt-1 text-sm text-white/48">Open execution, live prints, and order flow.</div>
                    </div>
                    {moduleTradeAction}
                  </div>
                  <div className="v2-signal-row">
                    <div>
                      <div className="text-sm font-semibold text-white">Community</div>
                      <div className="mt-1 text-sm text-white/48">{communitySummary}</div>
                    </div>
                    <Link
                      to={communityUrl}
                      className="inline-flex h-9 items-center rounded-full border border-white/10 bg-white/[0.04] px-4 text-sm font-medium text-white/76 transition hover:bg-white/[0.08] hover:text-white"
                    >
                      Open
                    </Link>
                  </div>
                  <div className="v2-signal-row">
                    <div>
                      <div className="text-sm font-semibold text-white">Raid pulse</div>
                      <div className="mt-1 text-sm text-white/48">{raidSummary}</div>
                    </div>
                    {raidUrl ? (
                      <Link
                        to={raidUrl}
                        className="inline-flex h-9 items-center rounded-full border border-lime-300/18 bg-lime-300/10 px-4 text-sm font-medium text-lime-200 transition hover:bg-lime-300/14"
                      >
                        Join raid
                      </Link>
                    ) : (
                      <Link
                        to={communityUrl}
                        className="inline-flex h-9 items-center rounded-full border border-white/10 bg-white/[0.04] px-4 text-sm font-medium text-white/76 transition hover:bg-white/[0.08] hover:text-white"
                      >
                        Launch
                      </Link>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <div className="space-y-4">
        <section className="v2-dense-module p-5">
          <V2SectionHeader
            eyebrow="AI Detection"
            title="Phew intelligence"
            description="Conviction, momentum, social trust, and bundle pressure fused into one operating read."
          />
          <div className="mt-4 rounded-[24px] border border-lime-300/12 bg-[radial-gradient(circle_at_top_left,rgba(169,255,52,0.12),transparent_28%),linear-gradient(180deg,rgba(255,255,255,0.03),rgba(255,255,255,0.01))] p-4">
            <div className="inline-flex rounded-full border border-lime-300/16 bg-lime-300/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-lime-200">
              {signals[0]?.value ? "High conviction" : "AI tracking"}
            </div>
            <div className="mt-4 text-5xl font-semibold text-[#41e8cf]">
              {signals[0]?.value ?? "--"}
              <span className="text-2xl text-white/34">/100</span>
            </div>
            <div className="mt-3 text-sm leading-6 text-white/56">
              Stronger reads combine social trust, market health, smart-money pickup, and holder behavior without changing the underlying intelligence contract.
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              {["Momentum", "Volume", "Smart Money", "Community", "Trend"].map((label) => (
                <span key={label} className="rounded-full border border-white/10 bg-white/[0.03] px-3 py-1 text-[11px] text-white/66">
                  {label}
                </span>
              ))}
            </div>
          </div>
        </section>

        <section className="v2-dense-module p-5">
          <V2SectionHeader
            eyebrow="Top Signals"
            title="Signal stack"
            description="What the intelligence system is weighting right now."
          />
          <div className="mt-4 space-y-2">
            {signals.map((signal) => (
              <div key={signal.label} className="v2-signal-row">
                <div>
                  <div className="text-sm font-semibold text-white">{signal.label}</div>
                  <div className="mt-1 text-xs text-white/42">{signal.caption}</div>
                </div>
                <span
                  className={cn(
                    "text-sm font-semibold",
                    signal.tone === "risk"
                      ? "text-amber-300"
                      : signal.tone === "ai"
                        ? "text-[#41e8cf]"
                        : signal.tone === "live"
                          ? "text-lime-300"
                          : "text-white/78"
                  )}
                >
                  {signal.value}
                </span>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
