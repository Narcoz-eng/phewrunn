import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import {
  AlertTriangle,
  Info,
  Network,
  Search,
  ShieldAlert,
  TrendingUp,
  Wallet,
} from "lucide-react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { V2PageHeader } from "@/components/layout/V2PageHeader";
import { V2EmptyState } from "@/components/ui/v2/V2EmptyState";
import { V2SectionHeader } from "@/components/ui/v2/V2SectionHeader";
import { V2StatusPill } from "@/components/ui/v2/V2StatusPill";
import { V2Surface } from "@/components/ui/v2/V2Surface";
import { cn } from "@/lib/utils";

type BundleCheckerToken = {
  address: string;
  symbol: string | null;
  name: string | null;
  tokenRiskScore: number | null;
  bundleRiskLabel: string | null;
  bundledWalletCount: number | null;
  estimatedBundledSupplyPct: number | null;
  holderCount: number | null;
  top10HolderPct: number | null;
  largestHolderPct: number | null;
  bundleClusters: Array<{
    id?: string;
    clusterLabel: string;
    walletCount: number;
    estimatedSupplyPct: number;
  }>;
  topHolders: Array<{
    address: string;
    valueUsd: number | null;
    supplyPct: number;
    label: string | null;
  }>;
};

function formatUsd(value: number | null) {
  if (value === null || !Number.isFinite(value)) return "--";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: Math.abs(value) >= 1000 ? "compact" : "standard",
    maximumFractionDigits: 1,
  }).format(value);
}

function formatPct(value: number | null) {
  if (value === null || !Number.isFinite(value)) return "--";
  return `${value.toFixed(value >= 10 ? 1 : 2)}%`;
}

function formatCompact(value: number | null) {
  if (value === null || !Number.isFinite(value)) return "--";
  return new Intl.NumberFormat("en-US", {
    notation: Math.abs(value) >= 1000 ? "compact" : "standard",
    maximumFractionDigits: 1,
  }).format(value);
}

function getRiskTone(score: number | null) {
  if (score === null || !Number.isFinite(score)) return "neutral";
  if (score >= 75) return "loss";
  if (score >= 45) return "warning";
  return "gain";
}

export default function BundleChecker() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [address, setAddress] = useState("");
  const [submittedAddress, setSubmittedAddress] = useState("");

  useEffect(() => {
    const tokenFromUrl = searchParams.get("token")?.trim() ?? "";
    if (!tokenFromUrl) return;
    setAddress((current) => current || tokenFromUrl);
    setSubmittedAddress((current) => current || tokenFromUrl);
  }, [searchParams]);

  const tokenQuery = useQuery<BundleCheckerToken>({
    queryKey: ["bundle-checker", submittedAddress],
    enabled: submittedAddress.length > 0,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    queryFn: async () => api.get<BundleCheckerToken>(`/api/tokens/${submittedAddress}`),
  });

  const token = tokenQuery.data ?? null;
  const riskTone = getRiskTone(token?.tokenRiskScore ?? null);

  const summaryCards = useMemo(
    () =>
      token
        ? [
            { label: "Bundles Detected", value: formatCompact(token.bundleClusters.length), hint: "Visible overlap groups" },
            { label: "Total Wallets", value: formatCompact(token.bundledWalletCount), hint: "Linked addresses found" },
            { label: "Total Holdings", value: formatPct(token.top10HolderPct), hint: "Top ten visible concentration" },
            { label: "Cluster %", value: formatPct(token.estimatedBundledSupplyPct), hint: "Estimated bundled supply" },
          ]
        : [],
    [token]
  );

  const timelineBars = useMemo(() => {
    if (!token?.bundleClusters.length) return [];
    const clusters = token.bundleClusters.slice(0, 12);
    const maxPct = Math.max(...clusters.map((cluster) => cluster.estimatedSupplyPct), 1);
    return clusters.map((cluster, index) => ({
      id: cluster.id || cluster.clusterLabel,
      label: cluster.clusterLabel,
      value: cluster.estimatedSupplyPct,
      walletCount: cluster.walletCount,
      height: `${Math.max(14, (cluster.estimatedSupplyPct / maxPct) * 100)}%`,
      tone: index % 2 === 0 ? "lime" : "teal",
    }));
  }, [token]);

  const topWallets = useMemo(
    () => (token?.topHolders ?? []).slice(0, 5),
    [token?.topHolders]
  );

  const handleSubmit = () => {
    const next = address.trim();
    setSearchParams(next ? { token: next } : {});
    setSubmittedAddress(next);
  };

  return (
    <div className="space-y-5">
      <V2PageHeader
        title="Bundle Checker"
        description="Check wallets, KOLs, or deployment clusters for concentration and bundle behavior using the current token intelligence route."
        badge={<V2StatusPill tone="risk">Risk Intel</V2StatusPill>}
      />

      {!submittedAddress ? (
        <V2Surface tone="accent" className="overflow-hidden p-0">
          <div className="grid gap-0 xl:grid-cols-[minmax(0,1.2fr)_360px]">
            <div className="p-5 sm:p-6 lg:p-7">
              <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-white/40">Bundle Checker</div>
              <h2 className="mt-3 text-3xl font-semibold tracking-tight text-white sm:text-4xl">
                Trace wallet overlap before it traps the room.
              </h2>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-white/58">
                Enter a token address to inspect bundle clusters, linked holders, and concentration pressure. This page stays on the existing token contract and does not mutate backend behavior.
              </p>

              <div className="mt-6 rounded-[28px] border border-white/10 bg-white/[0.04] p-4 sm:p-5">
                <div className="flex flex-col gap-3 sm:flex-row">
                  <Input
                    value={address}
                    onChange={(event) => setAddress(event.target.value)}
                    placeholder="Enter wallet address or token CA"
                    className="h-14 rounded-[20px] border-white/10 bg-black/20 text-base text-white placeholder:text-white/28"
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        handleSubmit();
                      }
                    }}
                  />
                  <Button type="button" onClick={handleSubmit} className="h-14 rounded-[20px] px-8 text-base font-semibold text-slate-950">
                    <Search className="mr-2 h-4 w-4" />
                    Check
                  </Button>
                </div>
                <div className="mt-4 flex flex-wrap gap-2 text-xs text-white/42">
                  <span>Example:</span>
                  <button type="button" onClick={() => setAddress("So11111111111111111111111111111111111111112")} className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-cyan-200">
                    So111...1112
                  </button>
                  <button type="button" onClick={() => setAddress("7vfCXTUXx5WHzv9M6Yn5Bv9o9H4m6m2eNfB2R8Q7pump")} className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-cyan-200">
                    pump example
                  </button>
                </div>
              </div>

              <div className="mt-6 grid gap-3 sm:grid-cols-4">
                {[
                  { label: "Bundles Detected", value: "--" },
                  { label: "Total Wallets", value: "--" },
                  { label: "Total Holdings", value: "--" },
                  { label: "Cluster %", value: "--" },
                ].map((item) => (
                  <div key={item.label} className="rounded-[22px] border border-white/8 bg-white/[0.03] px-4 py-4">
                    <div className="text-[11px] uppercase tracking-[0.18em] text-white/38">{item.label}</div>
                    <div className="mt-3 text-2xl font-semibold text-white">{item.value}</div>
                  </div>
                ))}
              </div>
            </div>

            <div className="border-l border-white/8 bg-[linear-gradient(180deg,rgba(255,255,255,0.03),rgba(255,255,255,0.01))] p-5 sm:p-6">
              <V2SectionHeader
                eyebrow="Bundle Analysis"
                title="Risk sidecar"
                description="The right rail becomes the operator read once a token is loaded."
              />
              <div className="mt-5 space-y-3">
                <div className="rounded-[24px] border border-white/8 bg-white/[0.03] px-4 py-5 text-sm leading-6 text-white/60">
                  High risk clusters surface wallet overlap, concentration, and likely operator coordination.
                </div>
                <div className="rounded-[24px] border border-white/8 bg-white/[0.03] px-4 py-5 text-sm leading-6 text-white/60">
                  Top linked wallets and behavior-over-time appear here after a token is resolved.
                </div>
              </div>
            </div>
          </div>
        </V2Surface>
      ) : tokenQuery.isLoading ? (
        <V2Surface className="p-8">
          <div className="text-sm text-white/56">Loading bundle intelligence...</div>
        </V2Surface>
      ) : tokenQuery.isError || !token ? (
        <V2EmptyState
          icon={<ShieldAlert className="h-7 w-7" />}
          title="No bundle data found"
          description="This token could not be resolved from the current token endpoint. Verify the address and try again."
        />
      ) : (
        <div className="space-y-4">
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_360px]">
            <V2Surface tone="accent" className="p-5 sm:p-6">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div className="max-w-2xl">
                  <div className="flex flex-wrap items-center gap-2">
                    <V2StatusPill tone="risk">{token.bundleRiskLabel || "Pending"}</V2StatusPill>
                    <V2StatusPill tone="xp">{token.symbol ? `$${token.symbol}` : token.name || "Token"}</V2StatusPill>
                  </div>
                  <h2 className="mt-4 text-3xl font-semibold tracking-tight text-white sm:text-4xl">
                    Bundle Checker
                  </h2>
                  <p className="mt-2 max-w-xl text-sm leading-6 text-white/58">
                    Check wallets, KOLs, or dev clusters for bunching behavior and supply overlap. The current page uses the existing token payload and re-groups it into the concept layout instead of adding a new contract.
                  </p>
                </div>

                <div className="w-full rounded-[24px] border border-white/10 bg-black/20 p-4 lg:w-[320px]">
                  <div className="flex gap-2">
                    <Input
                      value={address}
                      onChange={(event) => setAddress(event.target.value)}
                      placeholder="Enter wallet or token"
                      className="h-12 rounded-[16px] border-white/10 bg-white/[0.03] text-white placeholder:text-white/28"
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          handleSubmit();
                        }
                      }}
                    />
                    <Button type="button" onClick={handleSubmit} className="h-12 rounded-[16px] px-5 text-slate-950">
                      Check
                    </Button>
                  </div>
                  <div className="mt-3 text-xs text-white/40">
                    Viewing {token.address.slice(0, 6)}...{token.address.slice(-4)}
                  </div>
                </div>
              </div>

              <div className="mt-5 grid gap-3 sm:grid-cols-4">
                {summaryCards.map((item) => (
                  <div key={item.label} className="rounded-[22px] border border-white/8 bg-white/[0.03] px-4 py-4">
                    <div className="text-[11px] uppercase tracking-[0.18em] text-white/38">{item.label}</div>
                    <div className="mt-3 text-2xl font-semibold text-white">{item.value}</div>
                    <div className="mt-1 text-xs text-white/42">{item.hint}</div>
                  </div>
                ))}
              </div>
            </V2Surface>

            <V2Surface className="p-5" tone="soft">
              <V2SectionHeader
                eyebrow="Bundle Analysis"
                title="Risk read"
                description="Operator-side summary of concentration and overlap."
              />
              <div className="mt-5 space-y-4">
                <div className="flex items-center justify-between gap-4 rounded-[26px] border border-white/8 bg-white/[0.03] px-4 py-4">
                  <div>
                    <div className="text-[11px] uppercase tracking-[0.18em] text-white/38">Risk Score</div>
                    <div className={cn(
                      "mt-3 text-3xl font-semibold",
                      riskTone === "loss" ? "text-rose-300" : riskTone === "warning" ? "text-amber-300" : "text-lime-300"
                    )}>
                      {token.tokenRiskScore?.toFixed(0) ?? "--"}
                    </div>
                    <div className="mt-1 text-sm text-white/50">{token.bundleRiskLabel || "Pending"}</div>
                  </div>
                  <div className={cn(
                    "flex h-24 w-24 items-center justify-center rounded-full border text-xl font-semibold",
                    riskTone === "loss"
                      ? "border-rose-400/30 bg-rose-400/10 text-rose-200"
                      : riskTone === "warning"
                        ? "border-amber-300/30 bg-amber-300/10 text-amber-200"
                        : "border-lime-300/30 bg-lime-300/10 text-lime-200"
                  )}>
                    {token.tokenRiskScore?.toFixed(0) ?? "--"}
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-3">
                  <div className="rounded-[18px] border border-white/8 bg-white/[0.03] px-3 py-3">
                    <div className="text-[10px] uppercase tracking-[0.16em] text-white/38">Cluster %</div>
                    <div className="mt-2 text-lg font-semibold text-white">{formatPct(token.estimatedBundledSupplyPct)}</div>
                  </div>
                  <div className="rounded-[18px] border border-white/8 bg-white/[0.03] px-3 py-3">
                    <div className="text-[10px] uppercase tracking-[0.16em] text-white/38">Wallets</div>
                    <div className="mt-2 text-lg font-semibold text-white">{formatCompact(token.bundledWalletCount)}</div>
                  </div>
                  <div className="rounded-[18px] border border-white/8 bg-white/[0.03] px-3 py-3">
                    <div className="text-[10px] uppercase tracking-[0.16em] text-white/38">Top 10</div>
                    <div className="mt-2 text-lg font-semibold text-white">{formatPct(token.top10HolderPct)}</div>
                  </div>
                </div>

                <div className="space-y-3">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-white/40">Top Linked Wallets</div>
                  {topWallets.map((holder) => (
                    <div key={holder.address} className="flex items-center justify-between gap-3 rounded-[18px] border border-white/8 bg-white/[0.03] px-3 py-3">
                      <div className="flex min-w-0 items-center gap-3">
                        <div className="flex h-9 w-9 items-center justify-center rounded-full border border-lime-300/18 bg-lime-300/8">
                          <Wallet className="h-4 w-4 text-lime-200" />
                        </div>
                        <div className="min-w-0">
                          <div className="truncate text-sm font-semibold text-white">
                            {holder.label || `${holder.address.slice(0, 5)}...${holder.address.slice(-4)}`}
                          </div>
                          <div className="text-xs text-white/42">{formatPct(holder.supplyPct)} of supply</div>
                        </div>
                      </div>
                      <div className="text-sm font-medium text-white/72">{formatUsd(holder.valueUsd)}</div>
                    </div>
                  ))}
                </div>
              </div>
            </V2Surface>
          </div>

          <div className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_360px]">
            <V2Surface className="p-5 sm:p-6">
              <V2SectionHeader
                eyebrow="Bundle Map"
                title="Relationship view"
                description="Main wallet centered, cluster groups radiating by overlap size and estimated concentration."
              />
              <div className="mt-5 rounded-[28px] border border-white/8 bg-[radial-gradient(circle_at_center,rgba(20,184,166,0.1),transparent_26%),linear-gradient(180deg,rgba(255,255,255,0.02),rgba(255,255,255,0.01))] p-5">
                <div className="relative mx-auto h-[330px] w-full max-w-[700px] overflow-hidden rounded-[26px] border border-white/6 bg-black/20">
                  <div className="absolute inset-0 bg-[linear-gradient(180deg,transparent,rgba(20,184,166,0.04)),radial-gradient(circle_at_center,rgba(169,255,52,0.12),transparent_32%)]" />
                  <div className="absolute left-1/2 top-1/2 flex h-20 w-20 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-cyan-300/25 bg-cyan-300/10 text-center text-sm font-semibold text-cyan-200 shadow-[0_0_48px_rgba(45,212,191,0.22)]">
                    Main
                  </div>
                  {token.bundleClusters.slice(0, 10).map((cluster, index, clusters) => {
                    const angle = (index / Math.max(clusters.length, 1)) * Math.PI * 2;
                    const radius = 120 + (index % 2) * 32;
                    const x = 50 + (Math.cos(angle) * radius) / 5;
                    const y = 50 + (Math.sin(angle) * radius) / 3.8;
                    return (
                      <div key={cluster.id || cluster.clusterLabel}>
                        <div
                          className="absolute left-1/2 top-1/2 h-px origin-left bg-gradient-to-r from-cyan-300/30 to-transparent"
                          style={{ width: `${86 + index * 3}px`, transform: `translateY(-50%) rotate(${angle}rad)` }}
                        />
                        <div
                          className="absolute flex h-14 w-14 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-lime-300/20 bg-lime-300/10 text-[10px] font-semibold uppercase tracking-[0.14em] text-lime-200"
                          style={{ left: `${x}%`, top: `${y}%` }}
                        >
                          {cluster.walletCount}
                        </div>
                      </div>
                    );
                  })}
                  <div className="absolute bottom-4 right-4 rounded-[18px] border border-white/8 bg-black/30 px-4 py-3 text-xs text-white/54">
                    <div className="flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-cyan-300" />Main wallet</div>
                    <div className="mt-2 flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-lime-300" />Cluster wallet</div>
                    <div className="mt-2 flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-white/50" />Unlinked holder</div>
                  </div>
                </div>
              </div>
            </V2Surface>

            <div className="space-y-4">
              <V2Surface className="p-5" tone="soft">
                <V2SectionHeader
                  eyebrow="What is this?"
                  title="How to read this"
                  description="Interpretation guidance for the operator view."
                />
                <div className="mt-4 space-y-3 text-sm leading-6 text-white/60">
                  <div className="rounded-[22px] border border-white/8 bg-white/[0.03] px-4 py-4">
                    Bundle Checker detects wallets that are part of the same cluster or have high overlap in transactions.
                  </div>
                  <div className="rounded-[22px] border border-white/8 bg-white/[0.03] px-4 py-4">
                    High bundled supply usually means weaker float and more concentrated operator control.
                  </div>
                  <div className="rounded-[22px] border border-white/8 bg-white/[0.03] px-4 py-4">
                    Use this with the token page intelligence and live community activity before acting.
                  </div>
                </div>
              </V2Surface>

              <V2Surface className="p-5" tone="soft">
                <V2SectionHeader
                  eyebrow="Routes"
                  title="Continue investigation"
                  description="Pivot into the other product surfaces."
                />
                <div className="mt-4 grid gap-3">
                  <Link to={`/token/${token.address}`} className="rounded-[20px] border border-white/8 bg-white/[0.03] px-4 py-3 text-sm font-medium text-white/74 transition hover:bg-white/[0.06] hover:text-white">
                    Open token board
                  </Link>
                  <Link to={`/communities/${token.address}`} className="rounded-[20px] border border-white/8 bg-white/[0.03] px-4 py-3 text-sm font-medium text-white/74 transition hover:bg-white/[0.06] hover:text-white">
                    Open community
                  </Link>
                </div>
              </V2Surface>
            </div>
          </div>

          <V2Surface className="p-5 sm:p-6">
            <V2SectionHeader
              eyebrow="Bundle Behavior Over Time"
              title="Cluster pressure"
              description="Behavior-over-time panel rebuilt from current cluster supply values."
            />
            <div className="mt-5 rounded-[28px] border border-white/8 bg-black/20 p-5">
              <div className="flex items-end justify-between gap-4">
                <div>
                  <div className="text-sm font-semibold text-white">Behavior over time</div>
                  <div className="mt-1 text-xs text-white/40">Cluster intensity proxy from visible bundle groups</div>
                </div>
                <div className="flex gap-2 text-xs text-white/42">
                  {["7D", "30D", "90D"].map((label, index) => (
                    <span key={label} className={cn(
                      "rounded-full border px-3 py-1",
                      index === 0 ? "border-lime-300/20 bg-lime-300/10 text-lime-200" : "border-white/8 bg-white/[0.03]"
                    )}>
                      {label}
                    </span>
                  ))}
                </div>
              </div>
              <div className="mt-6 flex h-[220px] items-end gap-3 overflow-hidden">
                {timelineBars.length ? timelineBars.map((bar) => (
                  <div key={bar.id} className="flex flex-1 flex-col justify-end">
                    <div
                      className={cn(
                        "w-full rounded-t-[14px]",
                        bar.tone === "lime"
                          ? "bg-[linear-gradient(180deg,rgba(169,255,52,0.95),rgba(169,255,52,0.2))]"
                          : "bg-[linear-gradient(180deg,rgba(45,212,191,0.95),rgba(45,212,191,0.2))]"
                      )}
                      style={{ height: bar.height }}
                    />
                    <div className="mt-3 text-center text-[10px] uppercase tracking-[0.16em] text-white/34">
                      {bar.label.slice(0, 2)}
                    </div>
                  </div>
                )) : (
                  <div className="flex h-full w-full items-center justify-center rounded-[22px] border border-dashed border-white/10 text-sm text-white/42">
                    No cluster-time sequence available yet.
                  </div>
                )}
              </div>
            </div>
          </V2Surface>
        </div>
      )}
    </div>
  );
}
