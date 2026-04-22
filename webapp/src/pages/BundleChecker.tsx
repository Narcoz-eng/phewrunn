import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { AlertTriangle, Info, Network, Search, Wallet } from "lucide-react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { BundleCheckerResponse } from "@/types";

function formatUsd(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "--";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: Math.abs(value) >= 1_000 ? "compact" : "standard",
    maximumFractionDigits: value >= 1 ? 1 : 6,
  }).format(value);
}

function formatPct(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "--";
  return `${value.toFixed(value >= 10 ? 1 : 2)}%`;
}

function formatCompact(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "--";
  return new Intl.NumberFormat("en-US", {
    notation: Math.abs(value) >= 1_000 ? "compact" : "standard",
    maximumFractionDigits: 1,
  }).format(value);
}

function riskTone(score: number | null | undefined) {
  if (score === null || score === undefined || !Number.isFinite(score)) return "text-white";
  if (score >= 75) return "text-rose-300";
  if (score >= 45) return "text-amber-300";
  return "text-lime-300";
}

export default function BundleChecker() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [draft, setDraft] = useState(searchParams.get("token") ?? "");
  const identifier = searchParams.get("token")?.trim() ?? "";

  useEffect(() => {
    const urlToken = searchParams.get("token")?.trim() ?? "";
    if (urlToken) {
      setDraft((current) => current || urlToken);
    }
  }, [searchParams]);

  const checkerQuery = useQuery<BundleCheckerResponse>({
    queryKey: ["bundle-checker-v2", identifier],
    enabled: identifier.length > 0,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    queryFn: async () => api.get<BundleCheckerResponse>(`/api/bundle-checker/${encodeURIComponent(identifier)}`),
  });

  const bundle = checkerQuery.data ?? null;
  const metrics = useMemo(
    () =>
      bundle
        ? [
            { label: "Bundles Detected", value: formatCompact(bundle.bundlesDetected) },
            { label: "Total Wallets", value: formatCompact(bundle.totalWallets) },
            { label: "Total Holdings", value: formatUsd(bundle.totalHoldingsUsd) },
            { label: "% Supply", value: formatPct(bundle.bundledSupplyPct) },
          ]
        : [],
    [bundle]
  );

  const behaviorMax = useMemo(() => {
    if (!bundle?.behaviorSeries.length) return 1;
    return Math.max(...bundle.behaviorSeries.map((point) => point.bundledSupplyPct ?? 0), 1);
  }, [bundle?.behaviorSeries]);

  const handleSearch = () => {
    const next = draft.trim();
    setSearchParams(next ? { token: next } : {});
  };

  return (
    <div className="space-y-5">
      <section className="overflow-hidden rounded-[32px] border border-white/8 bg-[linear-gradient(180deg,rgba(8,12,16,0.98),rgba(4,7,10,0.98))] shadow-[0_32px_100px_-54px_rgba(0,0,0,0.92)]">
        <div className="grid gap-0 xl:grid-cols-[minmax(0,1.18fr)_360px]">
          <div className="p-5 sm:p-6 lg:p-7">
            <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-white/38">Bundle Checker</div>
            <h1 className="mt-4 text-3xl font-semibold tracking-[-0.04em] text-white sm:text-4xl">
              Trace cluster overlap before it traps the room.
            </h1>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-white/56">
              Check wallets, KOLs, or dev clusters for bunching behavior, linked supply, and operator concentration. This is a real bundle-intelligence surface backed by the dedicated aggregate endpoint.
            </p>

            <div className="mt-6 rounded-[28px] border border-white/8 bg-white/[0.03] p-4 sm:p-5">
              <div className="flex flex-col gap-3 sm:flex-row">
                <Input
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  placeholder="Enter wallet address, token CA, or symbol"
                  className="h-14 rounded-[18px] border-white/10 bg-black/25 text-base text-white placeholder:text-white/30"
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      handleSearch();
                    }
                  }}
                />
                <Button type="button" onClick={handleSearch} className="h-14 rounded-[18px] px-8 text-base font-semibold text-slate-950">
                  <Search className="mr-2 h-4 w-4" />
                  Check
                </Button>
              </div>
              <div className="mt-4 flex flex-wrap gap-2 text-xs text-white/40">
                <span>Examples:</span>
                {["PEPE", "So11111111111111111111111111111111111111112", "BONK"].map((example) => (
                  <button
                    key={example}
                    type="button"
                    onClick={() => setDraft(example)}
                    className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-cyan-200"
                  >
                    {example}
                  </button>
                ))}
              </div>
            </div>

            <div className="mt-6 grid gap-3 sm:grid-cols-4">
              {(bundle ? metrics : [
                { label: "Bundles Detected", value: "--" },
                { label: "Total Wallets", value: "--" },
                { label: "Total Holdings", value: "--" },
                { label: "% Supply", value: "--" },
              ]).map((metric) => (
                <div key={metric.label} className="rounded-[22px] border border-white/8 bg-white/[0.03] px-4 py-4">
                  <div className="text-[11px] uppercase tracking-[0.18em] text-white/38">{metric.label}</div>
                  <div className="mt-3 text-2xl font-semibold text-white">{metric.value}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="border-l border-white/8 bg-[linear-gradient(180deg,rgba(255,255,255,0.03),rgba(255,255,255,0.01))] p-5 sm:p-6">
            <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-white/38">
              <AlertTriangle className="h-4 w-4 text-rose-300" />
              Bundle Analysis
            </div>
            {bundle ? (
              <div className="mt-5 space-y-4">
                <div className="rounded-[26px] border border-white/8 bg-white/[0.03] px-4 py-5">
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <div className="text-[11px] uppercase tracking-[0.18em] text-white/38">Risk Score</div>
                      <div className={cn("mt-3 text-3xl font-semibold", riskTone(bundle.riskSummary.score))}>
                        {bundle.riskSummary.label || "Pending"}
                      </div>
                      <div className="mt-2 text-sm text-white/50">
                        This address is linked to {formatCompact(bundle.riskSummary.walletCount)} visible wallets.
                      </div>
                    </div>
                    <div className={cn(
                      "flex h-24 w-24 items-center justify-center rounded-full border text-2xl font-semibold",
                      bundle.riskSummary.score && bundle.riskSummary.score >= 75
                        ? "border-rose-300/30 bg-rose-400/10 text-rose-200"
                        : bundle.riskSummary.score && bundle.riskSummary.score >= 45
                          ? "border-amber-300/30 bg-amber-300/10 text-amber-200"
                          : "border-lime-300/30 bg-lime-300/10 text-lime-200"
                    )}>
                      {bundle.riskSummary.score?.toFixed(0) ?? "--"}
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-3">
                  <StatBox label="Cluster %" value={formatPct(bundle.riskSummary.clusterPct)} />
                  <StatBox label="Total Value" value={formatUsd(bundle.riskSummary.totalValueUsd)} />
                  <StatBox label="Wallets" value={formatCompact(bundle.riskSummary.walletCount)} />
                </div>

                <div className="rounded-[26px] border border-white/8 bg-white/[0.03] p-4">
                  <div className="text-[11px] uppercase tracking-[0.18em] text-white/38">Top Linked Wallets</div>
                  <div className="mt-4 space-y-3">
                    {bundle.linkedWallets.slice(0, 5).map((wallet) => (
                      <div key={wallet.address} className="flex items-center justify-between gap-3 rounded-[18px] border border-white/8 bg-black/20 px-3 py-3">
                        <div className="min-w-0">
                          <div className="truncate text-sm font-semibold text-white">
                            {wallet.label || `${wallet.address.slice(0, 6)}...${wallet.address.slice(-4)}`}
                          </div>
                          <div className="text-xs text-white/42">{formatPct(wallet.supplyPct)}</div>
                        </div>
                        <div className="text-sm font-medium text-white/72">{formatUsd(wallet.valueUsd)}</div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="rounded-[26px] border border-white/8 bg-white/[0.03] p-4">
                  <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.18em] text-white/38">
                    <Info className="h-4 w-4" />
                    What is this?
                  </div>
                  <p className="mt-3 text-sm leading-6 text-white/56">
                    Bundle Checker detects wallets that overlap in ownership, cluster behavior, or supply concentration. Use it with the token board and community pulse before acting.
                  </p>
                </div>
              </div>
            ) : (
              <div className="mt-5 space-y-3">
                <div className="rounded-[24px] border border-white/8 bg-white/[0.03] px-4 py-5 text-sm leading-6 text-white/60">
                  The right rail becomes the operator read once a token or wallet is resolved.
                </div>
                <div className="rounded-[24px] border border-white/8 bg-white/[0.03] px-4 py-5 text-sm leading-6 text-white/60">
                  Risk, linked wallets, and cluster pressure stay here instead of being buried below the fold.
                </div>
              </div>
            )}
          </div>
        </div>
      </section>

      {!identifier ? null : checkerQuery.isLoading ? (
        <section className="rounded-[30px] border border-white/8 bg-white/[0.03] px-6 py-10 text-sm text-white/56">
          Loading bundle intelligence...
        </section>
      ) : checkerQuery.isError || !bundle ? (
        <section className="rounded-[30px] border border-dashed border-white/12 px-6 py-16 text-center">
          <div className="mx-auto max-w-lg">
            <h2 className="text-2xl font-semibold text-white">No bundle intelligence found</h2>
            <p className="mt-3 text-sm leading-6 text-white/52">
              This identifier could not be resolved by the bundle aggregate endpoint. Verify the symbol or contract and try again.
            </p>
          </div>
        </section>
      ) : (
        <>
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1.18fr)_360px]">
            <section className="rounded-[30px] border border-white/8 bg-[linear-gradient(180deg,rgba(7,12,15,0.98),rgba(4,7,9,0.98))] p-5 sm:p-6">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-white/38">Bundle Map</div>
                  <h2 className="mt-2 text-2xl font-semibold tracking-[-0.04em] text-white">Cluster relationships</h2>
                </div>
                <div className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-xs text-white/60">
                  {bundle.graph.nodes.length} nodes
                </div>
              </div>

              <div className="mt-5 rounded-[28px] border border-white/8 bg-[radial-gradient(circle_at_center,rgba(45,212,191,0.12),transparent_28%),linear-gradient(180deg,rgba(255,255,255,0.02),rgba(255,255,255,0.01))] p-5">
                <div className="relative h-[360px] overflow-hidden rounded-[24px] border border-white/8 bg-black/25">
                  {bundle.graph.nodes.map((node, index, list) => {
                    const angle = (index / Math.max(list.length, 1)) * Math.PI * 2;
                    const radius = node.kind === "token" ? 0 : node.kind === "cluster" ? 95 : 145;
                    const x = 50 + Math.cos(angle) * (radius / 5);
                    const y = 50 + Math.sin(angle) * (radius / 3.9);
                    return (
                      <div
                        key={node.id}
                        className={cn(
                          "absolute flex -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border text-center font-semibold",
                          node.kind === "token"
                            ? "h-20 w-20 border-cyan-300/30 bg-cyan-300/10 text-xs text-cyan-200 shadow-[0_0_48px_rgba(45,212,191,0.22)]"
                            : node.kind === "cluster"
                              ? "h-16 w-16 border-lime-300/24 bg-lime-300/10 text-[10px] text-lime-200"
                              : "h-12 w-12 border-white/12 bg-white/[0.05] text-[10px] text-white/72"
                        )}
                        style={{ left: `${x}%`, top: `${y}%` }}
                      >
                        {node.label}
                      </div>
                    );
                  })}
                </div>
                <div className="mt-4 flex flex-wrap gap-2 text-xs text-white/46">
                  <span className="rounded-full border border-cyan-300/18 bg-cyan-300/8 px-3 py-1 text-cyan-200">Main Token</span>
                  <span className="rounded-full border border-lime-300/18 bg-lime-300/8 px-3 py-1 text-lime-200">Cluster</span>
                  <span className="rounded-full border border-white/10 bg-white/[0.03] px-3 py-1">Wallet</span>
                </div>
              </div>
            </section>

            <section className="space-y-4">
              <div className="rounded-[30px] border border-white/8 bg-white/[0.03] p-5">
                <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-white/38">
                  <Wallet className="h-4 w-4 text-lime-200" />
                  Linked Wallets
                </div>
                <div className="mt-4 space-y-3">
                  {bundle.linkedWallets.map((wallet) => (
                    <div key={wallet.address} className="rounded-[18px] border border-white/8 bg-black/20 px-4 py-3">
                      <div className="truncate text-sm font-semibold text-white">
                        {wallet.label || `${wallet.address.slice(0, 6)}...${wallet.address.slice(-4)}`}
                      </div>
                      <div className="mt-2 flex items-center justify-between gap-2 text-xs text-white/46">
                        <span>{formatPct(wallet.supplyPct)} overlap</span>
                        <span>{formatUsd(wallet.valueUsd)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-[30px] border border-white/8 bg-white/[0.03] p-5">
                <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-white/38">
                  <Network className="h-4 w-4 text-cyan-200" />
                  Related Routes
                </div>
                <div className="mt-4 grid gap-3">
                  <Link to={`/token/${bundle.entity.address}`} className="rounded-[18px] border border-white/8 bg-black/20 px-4 py-3 text-sm text-white/78 transition hover:bg-white/[0.05] hover:text-white">
                    Open token board
                  </Link>
                  <Link to={`/communities/${bundle.entity.address}`} className="rounded-[18px] border border-white/8 bg-black/20 px-4 py-3 text-sm text-white/78 transition hover:bg-white/[0.05] hover:text-white">
                    Open community
                  </Link>
                </div>
              </div>
            </section>
          </div>

          <section className="rounded-[30px] border border-white/8 bg-[linear-gradient(180deg,rgba(7,12,15,0.98),rgba(4,7,9,0.98))] p-5 sm:p-6">
            <div className="flex items-center justify-between gap-4">
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-white/38">Bundle Behavior Over Time</div>
                <h2 className="mt-2 text-2xl font-semibold tracking-[-0.04em] text-white">Cluster pressure</h2>
              </div>
              <div className="flex gap-2 text-xs">
                {["7D", "30D", "90D"].map((range, index) => (
                  <span
                    key={range}
                    className={cn(
                      "rounded-full border px-3 py-1",
                      index === 0 ? "border-lime-300/18 bg-lime-300/8 text-lime-200" : "border-white/8 bg-white/[0.03] text-white/54"
                    )}
                  >
                    {range}
                  </span>
                ))}
              </div>
            </div>

            <div className="mt-6 flex h-[220px] items-end gap-3 overflow-hidden rounded-[26px] border border-white/8 bg-black/20 px-5 pb-5 pt-8">
              {bundle.behaviorSeries.map((point, index) => {
                const pct = point.bundledSupplyPct ?? 0;
                const height = `${Math.max(14, (pct / behaviorMax) * 100)}%`;
                return (
                  <div key={`${point.timestamp}-${index}`} className="flex flex-1 flex-col justify-end">
                    <div
                      className={cn(
                        "w-full rounded-t-[14px]",
                        index % 2 === 0
                          ? "bg-[linear-gradient(180deg,rgba(169,255,52,0.95),rgba(169,255,52,0.16))]"
                          : "bg-[linear-gradient(180deg,rgba(45,212,191,0.95),rgba(45,212,191,0.16))]"
                      )}
                      style={{ height }}
                    />
                    <div className="mt-2 text-center text-[10px] uppercase tracking-[0.16em] text-white/34">
                      {new Date(point.timestamp).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        </>
      )}
    </div>
  );
}

function StatBox({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[18px] border border-white/8 bg-white/[0.03] px-3 py-3">
      <div className="text-[10px] uppercase tracking-[0.16em] text-white/38">{label}</div>
      <div className="mt-2 text-lg font-semibold text-white">{value}</div>
    </div>
  );
}
