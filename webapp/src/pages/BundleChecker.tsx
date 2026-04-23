import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { AlertTriangle, Info, Network, Search, Wallet } from "lucide-react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { V2RightRailCard } from "@/components/ui/v2/V2RightRailCard";
import { V2ProgressBar } from "@/components/ui/v2/V2ProgressBar";
import type {
  BundleCheckerGraphEdge,
  BundleCheckerGraphNode,
  BundleCheckerResponse,
} from "@/types";

type GraphLayoutNode = BundleCheckerGraphNode & {
  x: number;
  y: number;
};

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

function buildGraphLayout(nodes: BundleCheckerGraphNode[], edges: BundleCheckerGraphEdge[]): GraphLayoutNode[] {
  const tokenNode = nodes.find((node) => node.kind === "token") ?? nodes[0];
  if (!tokenNode) return [];

  const clusterNodes = nodes.filter((node) => node.kind === "cluster");
  const walletNodes = nodes.filter((node) => node.kind === "wallet");
  const walletEdgesByCluster = new Map<string, BundleCheckerGraphNode[]>();

  for (const cluster of clusterNodes) {
    const connectedWalletIds = edges
      .filter((edge) => edge.source === cluster.id || edge.target === cluster.id)
      .map((edge) => (edge.source === cluster.id ? edge.target : edge.source));
    walletEdgesByCluster.set(
      cluster.id,
      walletNodes.filter((node) => connectedWalletIds.includes(node.id))
    );
  }

  const laidOut: GraphLayoutNode[] = [{ ...tokenNode, x: 50, y: 50 }];

  clusterNodes.forEach((cluster, clusterIndex) => {
    const clusterAngle = (clusterIndex / Math.max(clusterNodes.length, 1)) * Math.PI * 2 - Math.PI / 2;
    const clusterX = 50 + Math.cos(clusterAngle) * 24;
    const clusterY = 50 + Math.sin(clusterAngle) * 24;
    laidOut.push({ ...cluster, x: clusterX, y: clusterY });

    const connectedWallets = walletEdgesByCluster.get(cluster.id) ?? [];
    connectedWallets.forEach((wallet, walletIndex) => {
      const walletAngle =
        clusterAngle +
        ((walletIndex - (connectedWallets.length - 1) / 2) / Math.max(connectedWallets.length, 1)) * 1.1;
      laidOut.push({
        ...wallet,
        x: clusterX + Math.cos(walletAngle) * 18,
        y: clusterY + Math.sin(walletAngle) * 18,
      });
    });
  });

  for (const wallet of walletNodes) {
    if (laidOut.some((node) => node.id === wallet.id)) continue;
    const walletIndex = laidOut.length;
    const angle = (walletIndex / Math.max(walletNodes.length, 1)) * Math.PI * 2;
    laidOut.push({
      ...wallet,
      x: 50 + Math.cos(angle) * 34,
      y: 50 + Math.sin(angle) * 34,
    });
  }

  return laidOut;
}

function nodeSize(node: BundleCheckerGraphNode) {
  if (node.kind === "token") return 42;
  if (node.kind === "cluster") return 30;
  return 18;
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
    queryKey: ["bundle-checker-v3", identifier],
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
            { label: "Linked Wallets", value: formatCompact(bundle.totalWallets) },
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

  const graphLayout = useMemo(
    () => (bundle ? buildGraphLayout(bundle.graph.nodes, bundle.graph.edges) : []),
    [bundle]
  );
  const graphNodeMap = useMemo(
    () => new Map(graphLayout.map((node) => [node.id, node])),
    [graphLayout]
  );

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
              Check wallets, operators, and supply concentration from the bundle-intelligence route. This screen only renders resolved cluster data from the backend; unresolved identifiers stay empty instead of implying risk.
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
                  Analyze
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
              {(bundle
                ? metrics
                : [
                    { label: "Bundles Detected", value: "--" },
                    { label: "Linked Wallets", value: "--" },
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
              Risk Overview
            </div>
            {bundle ? (
              <div className="mt-5 space-y-4">
                <div className="rounded-[26px] border border-white/8 bg-white/[0.03] px-4 py-5">
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <div className="text-[11px] uppercase tracking-[0.18em] text-white/38">Risk Score</div>
                      <div className={cn("mt-3 text-3xl font-semibold", riskTone(bundle.riskSummary.score))}>
                        {typeof bundle.riskSummary.score === "number" ? bundle.riskSummary.score.toFixed(0) : "--"}
                      </div>
                      <div className="mt-2 text-sm text-white/50">
                        {bundle.riskSummary.label ? `${bundle.riskSummary.label.toUpperCase()} cluster risk` : "Pending analysis"}
                      </div>
                    </div>
                    <div
                      className={cn(
                        "flex h-24 w-24 items-center justify-center rounded-full border text-sm font-semibold uppercase tracking-[0.16em]",
                        bundle.riskSummary.score && bundle.riskSummary.score >= 75
                          ? "border-rose-300/30 bg-rose-400/10 text-rose-200"
                          : bundle.riskSummary.score && bundle.riskSummary.score >= 45
                            ? "border-amber-300/30 bg-amber-300/10 text-amber-200"
                            : "border-lime-300/30 bg-lime-300/10 text-lime-200"
                      )}
                    >
                      {bundle.riskSummary.label || "Idle"}
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-3">
                  <StatBox label="Cluster %" value={formatPct(bundle.riskSummary.clusterPct)} />
                  <StatBox label="Total Value" value={formatUsd(bundle.riskSummary.totalValueUsd)} />
                  <StatBox label="Wallets" value={formatCompact(bundle.riskSummary.walletCount)} />
                </div>

                <div className="rounded-[26px] border border-white/8 bg-white/[0.03] p-4">
                  <div className="text-[11px] uppercase tracking-[0.18em] text-white/38">Concentration</div>
                  <div className="mt-3">
                    <V2ProgressBar
                      value={bundle.riskSummary.clusterPct}
                      valueLabel={bundle.riskSummary.clusterPct !== null ? `${bundle.riskSummary.clusterPct.toFixed(1)}% bundled supply` : "No bundled supply resolved"}
                    />
                  </div>
                </div>

                <div className="rounded-[26px] border border-white/8 bg-white/[0.03] p-4">
                  <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.18em] text-white/38">
                    <Info className="h-4 w-4" />
                    What is this?
                  </div>
                  <p className="mt-3 text-sm leading-6 text-white/56">
                    Bundle Checker detects linked wallets, clustered supply, and historical overlap using the stored bundle-analysis route. It does not invent clusters or risk labels when the backend cannot resolve them.
                  </p>
                </div>
              </div>
            ) : (
              <div className="mt-5 rounded-[24px] border border-white/8 bg-white/[0.03] px-4 py-5 text-sm leading-6 text-white/60">
                The risk rail stays empty until a token or wallet resolves through the bundle checker API.
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
                <div className="relative h-[420px] overflow-hidden rounded-[24px] border border-white/8 bg-black/25">
                  <svg className="absolute inset-0 h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none">
                    {bundle.graph.edges.map((edge, index) => {
                      const source = graphNodeMap.get(edge.source);
                      const target = graphNodeMap.get(edge.target);
                      if (!source || !target) return null;
                      return (
                        <line
                          key={`${edge.source}-${edge.target}-${index}`}
                          x1={source.x}
                          y1={source.y}
                          x2={target.x}
                          y2={target.y}
                          stroke="rgba(255,255,255,0.16)"
                          strokeWidth={Math.max(0.25, Math.min(1.2, edge.weight / 12))}
                        />
                      );
                    })}
                  </svg>

                  {graphLayout.map((node) => (
                    <div
                      key={node.id}
                      className={cn(
                        "absolute flex -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border text-center font-semibold shadow-[0_0_48px_rgba(0,0,0,0.28)]",
                        node.kind === "token"
                          ? "border-cyan-300/30 bg-cyan-300/10 text-xs text-cyan-200"
                          : node.kind === "cluster"
                            ? "border-lime-300/24 bg-lime-300/10 text-[10px] text-lime-200"
                            : "border-white/12 bg-white/[0.05] text-[10px] text-white/72"
                      )}
                      style={{
                        left: `${node.x}%`,
                        top: `${node.y}%`,
                        width: `${nodeSize(node)}px`,
                        height: `${nodeSize(node)}px`,
                      }}
                    >
                      <span className="max-w-[90%] truncate px-1">{node.label}</span>
                    </div>
                  ))}
                </div>
                <div className="mt-4 flex flex-wrap gap-2 text-xs text-white/46">
                  <span className="rounded-full border border-cyan-300/18 bg-cyan-300/8 px-3 py-1 text-cyan-200">Main Token</span>
                  <span className="rounded-full border border-lime-300/18 bg-lime-300/8 px-3 py-1 text-lime-200">Cluster</span>
                  <span className="rounded-full border border-white/10 bg-white/[0.03] px-3 py-1">Wallet</span>
                </div>
              </div>
            </section>

            <div className="space-y-4">
              <V2RightRailCard eyebrow="Linked Wallets" title="Largest visible operators" tone="soft">
                <div className="space-y-3">
                  {bundle.linkedWallets.length ? (
                    bundle.linkedWallets.map((wallet) => (
                      <div key={wallet.address} className="rounded-[18px] border border-white/8 bg-black/20 px-4 py-3">
                        <div className="truncate text-sm font-semibold text-white">
                          {wallet.label || `${wallet.address.slice(0, 6)}...${wallet.address.slice(-4)}`}
                        </div>
                        <div className="mt-2 flex items-center justify-between gap-2 text-xs text-white/46">
                          <span>{wallet.supplyPct !== null ? formatPct(wallet.supplyPct) : "Supply n/a"}</span>
                          <span>{formatUsd(wallet.valueUsd)}</span>
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="rounded-[18px] border border-dashed border-white/10 px-4 py-6 text-sm text-white/48">
                      No linked wallets were returned for this identifier.
                    </div>
                  )}
                </div>
              </V2RightRailCard>

              <V2RightRailCard eyebrow="Related Routes" title="Jump surfaces" tone="soft">
                <div className="grid gap-3">
                  <Link to={`/token/${bundle.entity.address}`} className="rounded-[18px] border border-white/8 bg-black/20 px-4 py-3 text-sm text-white/78 transition hover:bg-white/[0.05] hover:text-white">
                    Open token board
                  </Link>
                  <Link to={`/communities/${bundle.entity.address}`} className="rounded-[18px] border border-white/8 bg-black/20 px-4 py-3 text-sm text-white/78 transition hover:bg-white/[0.05] hover:text-white">
                    Open community
                  </Link>
                </div>
              </V2RightRailCard>
            </div>
          </div>

          <section className="rounded-[30px] border border-white/8 bg-[linear-gradient(180deg,rgba(7,12,15,0.98),rgba(4,7,9,0.98))] p-5 sm:p-6">
            <div className="flex items-center justify-between gap-4">
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-white/38">Bundle Behavior Over Time</div>
                <h2 className="mt-2 text-2xl font-semibold tracking-[-0.04em] text-white">Cluster pressure</h2>
              </div>
              <div className="rounded-full border border-white/8 bg-white/[0.03] px-3 py-1 text-xs text-white/54">
                {bundle.behaviorSeries.length} snapshots
              </div>
            </div>

            <div className="mt-6 flex h-[220px] items-end gap-3 overflow-hidden rounded-[26px] border border-white/8 bg-black/20 px-5 pb-5 pt-8">
              {bundle.behaviorSeries.length ? (
                bundle.behaviorSeries.map((point, index) => {
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
                })
              ) : (
                <div className="flex h-full w-full items-center justify-center text-sm text-white/48">
                  Historical bundle snapshots are not available yet for this identifier.
                </div>
              )}
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
