import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { Activity, Search, ShieldAlert, Wallet } from "lucide-react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { V2PageHeader } from "@/components/layout/V2PageHeader";
import { V2EmptyState } from "@/components/ui/v2/V2EmptyState";
import { V2MetricCard } from "@/components/ui/v2/V2MetricCard";
import { V2SectionHeader } from "@/components/ui/v2/V2SectionHeader";
import { V2StatusPill } from "@/components/ui/v2/V2StatusPill";
import { V2Surface } from "@/components/ui/v2/V2Surface";

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
  const metrics = useMemo(
    () =>
      token
        ? [
            { label: "Risk Score", value: token.tokenRiskScore?.toFixed(0) ?? "--", hint: token.bundleRiskLabel || "Pending" },
            { label: "Bundled Wallets", value: formatCompact(token.bundledWalletCount), hint: "Detected overlap cluster" },
            { label: "Bundled Supply", value: formatPct(token.estimatedBundledSupplyPct), hint: "Estimated concentration" },
            { label: "Holders", value: formatCompact(token.holderCount), hint: `Top 10 hold ${formatPct(token.top10HolderPct)}` },
          ]
        : [],
    [token]
  );
  const clusterTimeline = useMemo(
    () =>
      token?.bundleClusters.map((cluster, index) => ({
        id: cluster.id || cluster.clusterLabel,
        label: cluster.clusterLabel,
        walletCount: cluster.walletCount,
        pct: cluster.estimatedSupplyPct,
        width: Math.max(12, Math.min(100, 18 + index * 11)),
      })) ?? [],
    [token?.bundleClusters]
  );

  return (
    <div className="space-y-5">
      <V2PageHeader
        title="Bundle Checker"
        description="Wallet overlap and cluster concentration surface built on the existing token intelligence payload. Search a token address to inspect bundle pressure, holder concentration, and linked wallet clusters."
        badge={<V2StatusPill tone="risk">Risk Intel</V2StatusPill>}
        action={
          <div className="flex min-w-[280px] items-center gap-2 rounded-[20px] border border-white/10 bg-white/[0.04] p-2">
            <Input
              value={address}
              onChange={(event) => setAddress(event.target.value)}
              placeholder="Paste token address"
              className="border-0 bg-transparent text-white placeholder:text-white/30 focus-visible:ring-0"
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  const next = address.trim();
                  setSearchParams(next ? { token: next } : {});
                  setSubmittedAddress(next);
                }
              }}
            />
            <Button
              type="button"
              size="sm"
              onClick={() => {
                const next = address.trim();
                setSearchParams(next ? { token: next } : {});
                setSubmittedAddress(next);
              }}
            >
              <Search className="mr-2 h-4 w-4" />
              Check
            </Button>
          </div>
        }
      />

      {!submittedAddress ? (
        <V2EmptyState
          icon={<ShieldAlert className="h-7 w-7" />}
          title="Start with a token address"
          description="The current implementation derives bundle intelligence from the existing token API instead of adding a new backend contract up front."
        />
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
        <>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            {metrics.map((metric) => (
              <V2MetricCard key={metric.label} label={metric.label} value={metric.value} hint={metric.hint} />
            ))}
          </div>

          <div className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_360px]">
            <V2Surface className="p-5 sm:p-6" tone="accent">
              <V2SectionHeader
                eyebrow="Bundle Operating Surface"
                title={`${token.symbol ? `$${token.symbol}` : token.name || "Token"} bundle map`}
                description="Concentration, cluster overlap, and holder pressure are being read from the existing token intelligence payload."
                action={
                  <div className="flex flex-wrap gap-2">
                    <Link
                      to={`/token/${token.address}`}
                      className="inline-flex items-center rounded-full border border-white/10 bg-white/[0.04] px-4 py-2 text-sm font-medium text-white/74 hover:bg-white/[0.08] hover:text-white"
                    >
                      Open token
                    </Link>
                    <Link
                      to={`/communities/${token.address}`}
                      className="inline-flex items-center rounded-full border border-lime-400/20 bg-lime-400/10 px-4 py-2 text-sm font-medium text-lime-300"
                    >
                      Community
                    </Link>
                  </div>
                }
              />

              <div className="mt-5 grid gap-4 lg:grid-cols-[minmax(0,1fr)_280px]">
                <div className="rounded-[28px] border border-white/8 bg-[radial-gradient(circle_at_top,rgba(169,255,52,0.08),transparent_34%),linear-gradient(180deg,rgba(7,11,13,0.98),rgba(7,11,13,0.94))] p-5">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-white/38">
                        Cluster topology
                      </div>
                      <div className="mt-2 text-sm text-white/52">
                        Main token wallet at center, linked clusters radiating out by overlap size.
                      </div>
                    </div>
                    <V2StatusPill tone="risk">{token.bundleRiskLabel || "Pending"}</V2StatusPill>
                  </div>

                  <div className="mt-5 grid place-items-center py-4">
                    <div className="relative h-[320px] w-full max-w-[460px]">
                      <div className="absolute left-1/2 top-1/2 flex h-20 w-20 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-cyan-300/25 bg-cyan-300/10 text-center text-sm font-semibold text-cyan-200 shadow-[0_0_40px_rgba(45,212,191,0.16)]">
                        Main
                      </div>
                      {token.bundleClusters.slice(0, 8).map((cluster, index, clusters) => {
                        const angle = (index / Math.max(clusters.length, 1)) * Math.PI * 2;
                        const radius = 118 + (index % 2) * 28;
                        const left = 50 + Math.cos(angle) * radius / 3.6;
                        const top = 50 + Math.sin(angle) * radius / 3;
                        return (
                          <div key={cluster.id || cluster.clusterLabel}>
                            <div
                              className="absolute left-1/2 top-1/2 h-px w-[92px] origin-left bg-gradient-to-r from-cyan-300/30 to-transparent"
                              style={{ transform: `translate(0,-50%) rotate(${angle}rad)` }}
                            />
                            <div
                              className="absolute flex h-14 w-14 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-lime-300/20 bg-lime-300/10 text-[10px] font-semibold uppercase tracking-[0.14em] text-lime-200"
                              style={{ left: `${left}%`, top: `${top}%` }}
                            >
                              {cluster.walletCount}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>

                <div className="space-y-3">
                  {clusterTimeline.length ? (
                    clusterTimeline.map((cluster) => (
                      <div key={cluster.id} className="rounded-[24px] border border-white/8 bg-white/[0.03] px-4 py-4">
                        <div className="flex items-center justify-between gap-3">
                          <div className="text-sm font-semibold text-white">{cluster.label}</div>
                          <div className="text-sm text-lime-300">{formatPct(cluster.pct)}</div>
                        </div>
                        <div className="mt-2 text-xs text-white/42">{cluster.walletCount} linked wallets</div>
                        <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/8">
                          <div
                            className="h-full rounded-full bg-[linear-gradient(90deg,rgba(169,255,52,0.95),rgba(45,212,191,0.88))]"
                            style={{ width: `${cluster.width}%` }}
                          />
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="rounded-[24px] border border-dashed border-white/10 px-4 py-10 text-center text-sm text-white/46">
                      No explicit cluster groups were returned yet.
                    </div>
                  )}
                </div>
              </div>
            </V2Surface>

            <div className="space-y-4">
              <V2Surface className="p-5">
                <V2SectionHeader
                  eyebrow="Bundle Analysis"
                  title="Risk read"
                  description="Quick scan of concentration and holder overlap."
                />
                <div className="mt-4 grid gap-3">
                  <div className="rounded-[24px] border border-white/8 bg-white/[0.03] px-4 py-4">
                    <div className="text-[11px] uppercase tracking-[0.18em] text-white/38">Risk Score</div>
                    <div className="mt-3 text-3xl font-semibold text-white">{token.tokenRiskScore?.toFixed(0) ?? "--"}</div>
                    <div className="mt-2 text-sm text-white/50">{token.bundleRiskLabel || "Pending"}</div>
                  </div>
                  <div className="rounded-[24px] border border-white/8 bg-white/[0.03] px-4 py-4 text-sm text-white/62">
                    Largest holder controls {formatPct(token.largestHolderPct)} and the top 10 hold {formatPct(token.top10HolderPct)} of visible supply.
                  </div>
                  <div className="rounded-[24px] border border-white/8 bg-white/[0.03] px-4 py-4 text-sm text-white/62">
                    Bundled wallets detected: {formatCompact(token.bundledWalletCount)} across {formatCompact(token.holderCount)} total holders.
                  </div>
                </div>
              </V2Surface>

              <V2Surface className="p-5">
                <V2SectionHeader
                  eyebrow="What this means"
                  title="Operator notes"
                  description="How to read this screen before acting."
                />
                <div className="mt-4 space-y-3 text-sm leading-6 text-white/60">
                  <div className="rounded-[22px] border border-white/8 bg-white/[0.03] px-4 py-4">
                    High bundled supply usually means overlapping wallet control and thinner real float.
                  </div>
                  <div className="rounded-[22px] border border-white/8 bg-white/[0.03] px-4 py-4">
                    Large holder concentration can overpower community demand even when social momentum looks strong.
                  </div>
                  <div className="rounded-[22px] border border-white/8 bg-white/[0.03] px-4 py-4">
                    Use this alongside the token page intelligence and active community pulse rather than as a standalone buy signal.
                  </div>
                </div>
              </V2Surface>
            </div>
          </div>

          <V2Surface className="p-5 sm:p-6">
            <V2SectionHeader
              eyebrow="Linked Wallets"
              title="Largest positions"
              description={`Largest holder owns ${formatPct(token.largestHolderPct)} of supply.`}
            />
            <div className="mt-4 space-y-3">
              {token.topHolders.slice(0, 8).map((holder) => (
                <div
                  key={holder.address}
                  className="flex items-center justify-between gap-4 rounded-[18px] border border-white/8 bg-white/[0.03] px-3 py-3"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-full border border-white/8 bg-white/[0.04]">
                      <Wallet className="h-4 w-4 text-white/58" />
                    </div>
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold text-white">
                        {holder.label || `${holder.address.slice(0, 4)}...${holder.address.slice(-4)}`}
                      </div>
                      <div className="text-xs text-white/42">{formatPct(holder.supplyPct)} of supply</div>
                    </div>
                  </div>
                  <div className="text-right text-sm font-medium text-white/74">
                    {formatUsd(holder.valueUsd)}
                  </div>
                </div>
              ))}
            </div>
          </V2Surface>
        </>
      )}
    </div>
  );
}
