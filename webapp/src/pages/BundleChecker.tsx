import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { AlertTriangle, Info, Maximize2, Minus, Plus, Search } from "lucide-react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { V2ProgressBar } from "@/components/ui/v2/V2ProgressBar";
import type { BundleCheckerGraphEdge, BundleCheckerGraphNode, BundleCheckerResponse } from "@/types";

type GraphLayoutNode = BundleCheckerGraphNode & { x: number; y: number };

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

function riskStroke(score: number | null | undefined) {
  if (score === null || score === undefined || !Number.isFinite(score)) return "rgb(148 163 184)";
  if (score >= 75) return "rgb(251 113 133)";
  if (score >= 45) return "rgb(251 191 36)";
  return "rgb(190 242 100)";
}

function riskBg(score: number | null | undefined) {
  if (score === null || score === undefined || !Number.isFinite(score)) return "rgba(148,163,184,0.52)";
  if (score >= 75) return "rgba(251,113,133,0.82)";
  if (score >= 45) return "rgba(251,191,36,0.82)";
  return "rgba(190,242,100,0.82)";
}

function clampScore(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, value));
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
    walletEdgesByCluster.set(cluster.id, walletNodes.filter((node) => connectedWalletIds.includes(node.id)));
  }

  const laidOut: GraphLayoutNode[] = [{ ...tokenNode, x: 50, y: 50 }];
  clusterNodes.forEach((cluster, clusterIndex) => {
    const clusterAngle = (clusterIndex / Math.max(clusterNodes.length, 1)) * Math.PI * 2 - Math.PI / 2;
    const clusterX = 50 + Math.cos(clusterAngle) * 25;
    const clusterY = 50 + Math.sin(clusterAngle) * 25;
    laidOut.push({ ...cluster, x: clusterX, y: clusterY });

    const connectedWallets = walletEdgesByCluster.get(cluster.id) ?? [];
    connectedWallets.forEach((wallet, walletIndex) => {
      const walletAngle =
        clusterAngle +
        ((walletIndex - (connectedWallets.length - 1) / 2) / Math.max(connectedWallets.length, 1)) * 1.45;
      laidOut.push({
        ...wallet,
        x: clusterX + Math.cos(walletAngle) * (15 + (walletIndex % 3) * 4),
        y: clusterY + Math.sin(walletAngle) * (15 + (walletIndex % 3) * 4),
      });
    });
  });

  for (const wallet of walletNodes) {
    if (laidOut.some((node) => node.id === wallet.id)) continue;
    const angle = (laidOut.length / Math.max(walletNodes.length, 1)) * Math.PI * 2;
    laidOut.push({ ...wallet, x: 50 + Math.cos(angle) * 38, y: 50 + Math.sin(angle) * 38 });
  }

  return laidOut.map((node) => ({
    ...node,
    x: Math.max(5, Math.min(95, node.x)),
    y: Math.max(7, Math.min(93, node.y)),
  }));
}

function nodeSize(node: BundleCheckerGraphNode) {
  if (node.kind === "token") return 44;
  if (node.kind === "cluster") return Math.max(24, Math.min(36, 24 + node.weight * 1.6));
  return Math.max(12, Math.min(20, 12 + node.weight * 0.6));
}

function nodeClass(node: BundleCheckerGraphNode, selected: boolean, hovered: boolean) {
  const base = "absolute flex -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border text-center font-semibold shadow-[0_0_44px_rgba(0,0,0,0.45)] transition";
  const active = selected || hovered;
  if (node.kind === "token") return cn(base, active && "ring-2 ring-cyan-200", "border-cyan-300/40 bg-cyan-300/14 text-[10px] text-cyan-100");
  if (node.riskLabel === "high") return cn(base, active && "ring-2 ring-rose-200", "border-rose-300/50 bg-rose-400/18 text-[9px] text-rose-100 shadow-[0_0_42px_rgba(251,113,133,0.25)]");
  if (node.riskLabel === "medium") return cn(base, active && "ring-2 ring-amber-200", "border-amber-300/45 bg-amber-400/16 text-[9px] text-amber-100 shadow-[0_0_42px_rgba(251,191,36,0.18)]");
  if (node.riskLabel === "low") return cn(base, active && "ring-2 ring-lime-200", "border-lime-300/38 bg-lime-300/14 text-[9px] text-lime-100");
  return cn(base, active && "ring-2 ring-white/60", "border-white/16 bg-white/[0.075] text-[8px] text-white/72");
}

function describeNode(node: BundleCheckerGraphNode, edges: BundleCheckerGraphEdge[]) {
  if (node.evidence) return node.evidence;
  if (node.kind === "token") return "Root token node. All cluster evidence is measured against this asset.";
  if (node.kind === "cluster") {
    return `${node.clusterLabel || node.label} groups ${edges.length} directly connected wallet relationships.`;
  }
  return `${node.label} has ${edges.length} graph relationship${edges.length === 1 ? "" : "s"} in this bundle view.`;
}

function relationshipScore(edges: BundleCheckerGraphEdge[]) {
  if (!edges.length) return 0;
  return Math.min(100, Math.round(edges.reduce((sum, edge) => sum + edge.weight, 0) / edges.length));
}

export default function BundleChecker() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [draft, setDraft] = useState(searchParams.get("token") ?? "");
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const identifier = searchParams.get("token")?.trim() ?? "";

  useEffect(() => {
    const urlToken = searchParams.get("token")?.trim() ?? "";
    if (urlToken) setDraft((current) => current || urlToken);
  }, [searchParams]);

  const checkerQuery = useQuery<BundleCheckerResponse>({
    queryKey: ["bundle-checker-v3", identifier],
    enabled: identifier.length > 0,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    queryFn: async () => api.get<BundleCheckerResponse>(`/api/bundle-checker/${encodeURIComponent(identifier)}`),
  });

  const bundle = checkerQuery.data ?? null;
  const graphLayout = useMemo(() => (bundle ? buildGraphLayout(bundle.graph.nodes, bundle.graph.edges) : []), [bundle]);
  const graphNodeMap = useMemo(() => new Map(graphLayout.map((node) => [node.id, node])), [graphLayout]);
  const selectedNode = selectedNodeId ? graphNodeMap.get(selectedNodeId) ?? null : null;
  const selectedNodeEdges = useMemo(
    () =>
      selectedNode
        ? bundle?.graph.edges.filter((edge) => edge.source === selectedNode.id || edge.target === selectedNode.id) ?? []
        : [],
    [bundle?.graph.edges, selectedNode],
  );
  const selectedNodeRelationshipScore = useMemo(() => relationshipScore(selectedNodeEdges), [selectedNodeEdges]);
  const behaviorMax = useMemo(() => Math.max(...(bundle?.behaviorSeries.map((point) => point.bundledSupplyPct ?? 0) ?? [1]), 1), [bundle?.behaviorSeries]);
  const graphIsSparse = Boolean(bundle && (bundle.graph.nodes.length < 4 || bundle.graph.edges.length < 2));
  const riskFactors = useMemo(() => {
    if (!bundle) return [];
    return (bundle.riskFactors ?? []).map((factor) => ({
      label: factor.label,
      value: clampScore(factor.score),
      detail: factor.detail,
    }));
  }, [bundle]);
  const hasExplicitRiskFactors = riskFactors.length > 0;
  const riskSummaryLabel =
    bundle?.riskSummary.label === "not_enough_evidence"
      ? "Not enough evidence"
      : bundle?.riskSummary.label;
  const behaviorPath = useMemo(() => {
    const series = bundle?.behaviorSeries ?? [];
    if (series.length < 2) return "";
    return series
      .map((point, index) => {
        const x = (index / (series.length - 1)) * 100;
        const y = 92 - (((point.bundledSupplyPct ?? 0) / behaviorMax) * 78);
        return `${index === 0 ? "M" : "L"} ${x.toFixed(2)} ${Math.max(8, Math.min(92, y)).toFixed(2)}`;
      })
      .join(" ");
  }, [behaviorMax, bundle?.behaviorSeries]);

  const handleSearch = () => {
    const next = draft.trim();
    setSearchParams(next ? { token: next } : {});
    setSelectedNodeId(null);
    setHoveredNodeId(null);
    setZoom(1);
  };

  const topKpis = bundle
    ? [
        { label: "Wallets Scanned", value: formatCompact(bundle.totalWallets), hint: "resolved" },
        { label: "Clusters Found", value: formatCompact(bundle.bundlesDetected), hint: "linked sets" },
        { label: "Risky Clusters", value: hasExplicitRiskFactors && bundle.riskSummary.score && bundle.riskSummary.score >= 45 ? formatCompact(bundle.bundlesDetected) : "--", hint: hasExplicitRiskFactors ? "medium+" : "not enough evidence" },
        { label: "Avg Risk Score", value: typeof bundle.riskSummary.score === "number" ? bundle.riskSummary.score.toFixed(1) : "--", hint: riskSummaryLabel ?? "pending" },
      ]
    : [
        { label: "Wallets Scanned", value: "--", hint: "search first" },
        { label: "Clusters Found", value: "--", hint: "search first" },
        { label: "Risky Clusters", value: "--", hint: "search first" },
        { label: "Avg Risk Score", value: "--", hint: "search first" },
      ];

  return (
    <div className="space-y-4 text-white">
      <section className="rounded-[18px] border border-white/8 bg-[linear-gradient(180deg,rgba(8,12,16,0.98),rgba(4,7,10,0.98))] p-5">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-lime-300">Bundle Checker</div>
            <h1 className="mt-2 text-4xl font-semibold tracking-[-0.04em]">Trace smart. Trade safe.</h1>
            <p className="mt-2 text-sm text-white/56">Detect linked wallets, dev clusters, and coordination patterns before they move.</p>
          </div>
          <div className="grid gap-3 sm:grid-cols-4 xl:min-w-[560px]">
            {topKpis.map((metric) => (
              <div key={metric.label} className="rounded-[14px] border border-white/8 bg-white/[0.03] px-4 py-3">
                <div className="text-[10px] uppercase tracking-[0.18em] text-white/38">{metric.label}</div>
                <div className="mt-2 text-xl font-semibold">{metric.value}</div>
                <div className="mt-1 text-[11px] text-lime-300/72">{metric.hint}</div>
              </div>
            ))}
          </div>
        </div>
        <div className="mt-5 rounded-[14px] border border-white/8 bg-white/[0.03] p-2.5">
          <div className="flex flex-col gap-3 sm:flex-row">
            <Input
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder="Enter wallet address, token CA, or ENS..."
              className="h-12 rounded-[12px] border-white/10 bg-black/25 text-sm text-white placeholder:text-white/30"
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  handleSearch();
                }
              }}
            />
            <Button type="button" onClick={handleSearch} className="h-12 rounded-[12px] px-8 text-sm font-semibold text-slate-950">
              <Search className="mr-2 h-4 w-4" />
              Analyze
            </Button>
          </div>
          <div className="mt-3 text-xs text-white/40">
            Search resolves against real token records only. Sparse targets show an intentional unavailable state instead of synthetic clusters.
          </div>
        </div>
      </section>

      {!identifier ? (
        <section className="rounded-[18px] border border-dashed border-white/12 px-6 py-16 text-center text-sm text-white/48">
          Enter an identifier to load the real bundle graph. No synthetic clusters are shown before backend resolution.
        </section>
      ) : checkerQuery.isLoading ? (
        <section className="rounded-[18px] border border-white/8 bg-white/[0.03] px-6 py-10 text-sm text-white/56">Loading bundle intelligence...</section>
      ) : checkerQuery.isError || !bundle ? (
        <section className="rounded-[18px] border border-dashed border-white/12 px-6 py-16 text-center">
          <h2 className="text-2xl font-semibold">No bundle intelligence found</h2>
          <p className="mt-3 text-sm text-white/52">This identifier could not be resolved by the bundle aggregate endpoint.</p>
        </section>
      ) : (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_350px]">
          <div className="space-y-4">
            <section className="rounded-[18px] border border-white/8 bg-[linear-gradient(180deg,rgba(7,12,15,0.98),rgba(4,7,9,0.98))] p-4">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-white/38">Cluster Graph</div>
                  <h2 className="mt-1 text-xl font-semibold">Resolved wallet relationships</h2>
                </div>
                <div className="rounded-[10px] border border-white/10 bg-white/[0.04] px-3 py-1 text-xs text-white/60">{bundle.graph.nodes.length} nodes</div>
              </div>
              <div className="relative mt-4 h-[500px] overflow-hidden rounded-[16px] border border-white/8 bg-[radial-gradient(circle_at_50%_50%,rgba(169,255,52,0.10),transparent_25%),linear-gradient(180deg,rgba(0,0,0,0.26),rgba(0,0,0,0.42))]">
                {graphIsSparse ? (
                  <div className="absolute inset-0 flex items-center justify-center p-8">
                    <div className="max-w-[520px] rounded-[18px] border border-dashed border-white/14 bg-black/45 p-6 text-center backdrop-blur">
                      <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-lime-200">Sparse evidence</div>
                      <h3 className="mt-3 text-2xl font-semibold">Not enough resolved relationships</h3>
                      <p className="mt-3 text-sm leading-6 text-white/54">
                        The backend returned {bundle.graph.nodes.length} nodes and {bundle.graph.edges.length} edges. The forensic graph stays unavailable until real cluster evidence contains enough linked wallets.
                      </p>
                    </div>
                  </div>
                ) : (
                  <>
                    <svg
                      className="absolute inset-0 h-full w-full transition-transform duration-200"
                      style={{ transform: `scale(${zoom})`, transformOrigin: "50% 50%" }}
                      viewBox="0 0 100 100"
                      preserveAspectRatio="none"
                    >
                      {bundle.graph.edges.map((edge, index) => {
                        const source = graphNodeMap.get(edge.source);
                        const target = graphNodeMap.get(edge.target);
                        if (!source || !target) return null;
                        const selected =
                          selectedNodeId === edge.source ||
                          selectedNodeId === edge.target ||
                          hoveredNodeId === edge.source ||
                          hoveredNodeId === edge.target;
                        const strength = Math.max(0.16, Math.min(0.72, edge.weight / 22));
                        return (
                          <g key={`${edge.source}-${edge.target}-${index}`}>
                            <line
                              x1={source.x}
                              y1={source.y}
                              x2={target.x}
                              y2={target.y}
                              stroke={selected ? "rgba(169,255,52,0.72)" : "rgba(255,255,255,0.42)"}
                              strokeOpacity={selected ? 0.88 : strength}
                              strokeWidth={selected ? Math.max(0.7, Math.min(1.8, edge.weight / 8)) : Math.max(0.22, Math.min(1.25, edge.weight / 12))}
                            />
                            {edge.weight >= 55 ? (
                              <circle r="0.75" fill="rgba(169,255,52,0.92)">
                                <animateMotion dur={`${Math.max(3, 8 - edge.weight / 18)}s`} repeatCount="indefinite" path={`M${source.x} ${source.y} L${target.x} ${target.y}`} />
                              </circle>
                            ) : null}
                          </g>
                        );
                      })}
                    </svg>
                    <div
                      className="absolute inset-0 transition-transform duration-200"
                      style={{ transform: `scale(${zoom})`, transformOrigin: "50% 50%" }}
                    >
                      {graphLayout.map((node) => {
                        const selected = node.id === selectedNodeId;
                        const hovered = node.id === hoveredNodeId;
                        return (
                          <button
                            key={node.id}
                            type="button"
                            onClick={() => setSelectedNodeId(node.id)}
                            onMouseEnter={() => setHoveredNodeId(node.id)}
                            onMouseLeave={() => setHoveredNodeId(null)}
                            className={nodeClass(node, selected, hovered)}
                            style={{ left: `${node.x}%`, top: `${node.y}%`, width: `${nodeSize(node)}px`, height: `${nodeSize(node)}px` }}
                            title={node.label}
                            aria-label={`Inspect ${node.label}`}
                          >
                            {node.riskLabel === "high" ? <span className="absolute inset-[-8px] rounded-full border border-rose-300/18 animate-pulse" /> : null}
                            <span className="max-w-[90%] truncate px-1">{node.kind === "wallet" ? "" : node.label}</span>
                          </button>
                        );
                      })}
                    </div>
                  </>
                )}
                <div className="absolute right-4 top-4 rounded-[12px] border border-white/10 bg-black/35 p-3 text-xs text-white/58 backdrop-blur">
                  <div className="mb-2 font-semibold uppercase tracking-[0.16em] text-white/42">Legend</div>
                  <LegendDot className="bg-rose-400" label="High Risk" />
                  <LegendDot className="bg-amber-400" label="Medium Risk" />
                  <LegendDot className="bg-lime-300" label="Low Risk" />
                  <LegendDot className="bg-cyan-300" label="Token" />
                  <LegendDot className="bg-white/45" label="External" />
                </div>
                {!graphIsSparse ? (
                  <div className="absolute bottom-4 left-4 flex gap-2">
                    <button type="button" onClick={() => setZoom(1)} className="flex h-9 w-9 items-center justify-center rounded-[10px] border border-white/10 bg-black/35 text-white/62 hover:text-white">
                      <Maximize2 className="h-4 w-4" />
                    </button>
                    <button type="button" onClick={() => setZoom((value) => Math.min(1.8, value + 0.15))} className="flex h-9 w-9 items-center justify-center rounded-[10px] border border-white/10 bg-black/35 text-white/62 hover:text-white">
                      <Plus className="h-4 w-4" />
                    </button>
                    <button type="button" onClick={() => setZoom((value) => Math.max(0.75, value - 0.15))} className="flex h-9 w-9 items-center justify-center rounded-[10px] border border-white/10 bg-black/35 text-white/62 hover:text-white">
                      <Minus className="h-4 w-4" />
                    </button>
                  </div>
                ) : null}
                {selectedNode && !graphIsSparse ? (
                  <div className="absolute bottom-4 right-4 w-[260px] rounded-[14px] border border-lime-300/18 bg-black/55 p-4 backdrop-blur">
                    <div className="text-[10px] uppercase tracking-[0.16em] text-lime-200">Selected node</div>
                    <div className="mt-2 truncate text-sm font-semibold">{selectedNode.label}</div>
                    <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                      <StatBox label="Kind" value={selectedNode.kind} />
                      <StatBox label="Weight" value={formatCompact(selectedNode.weight)} />
                      <StatBox label="Supply" value={formatPct(selectedNode.supplyPct)} />
                      <StatBox label="Strength" value={`${selectedNodeRelationshipScore}/100`} />
                    </div>
                    <div className="mt-3 text-xs leading-5 text-white/50">
                      {describeNode(selectedNode, selectedNodeEdges)}
                    </div>
                    <div className="mt-3 space-y-1.5">
                      {selectedNodeEdges.slice(0, 3).map((edge) => (
                        <div key={`${edge.source}-${edge.target}`} className="truncate rounded-[10px] border border-white/8 bg-white/[0.04] px-2 py-1.5 text-[11px] text-white/46">
                          {edge.relationLabel || `${edge.weight}/100 relationship`}
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
            </section>

            <div className="grid gap-4 lg:grid-cols-3">
              <section className="rounded-[18px] border border-white/8 bg-white/[0.03] p-4">
                <h3 className="text-sm font-semibold">Cluster Summary</h3>
                <div className="mt-4 space-y-3">
                  <MetricLine label="Total Wallets" value={formatCompact(bundle.totalWallets)} />
                  <MetricLine label="Clusters" value={formatCompact(bundle.bundlesDetected)} />
                  <MetricLine label="Total Holdings" value={formatUsd(bundle.totalHoldingsUsd)} />
                  <MetricLine label="Bundled Supply" value={formatPct(bundle.bundledSupplyPct)} />
                </div>
              </section>
              <section className="rounded-[18px] border border-white/8 bg-white/[0.03] p-4">
                <h3 className="text-sm font-semibold">Top Wallets In Cluster</h3>
                <div className="mt-4 space-y-2">
                  {bundle.linkedWallets.length ? bundle.linkedWallets.slice(0, 5).map((wallet) => (
                    <div key={wallet.address} className="grid grid-cols-[1fr_70px_70px] gap-2 text-xs">
                      <span className="truncate text-white/72">{wallet.label || `${wallet.address.slice(0, 6)}...${wallet.address.slice(-4)}`}</span>
                      <span className="text-right text-rose-300">{formatCompact(wallet.relationStrength)}</span>
                      <span className="text-right text-white/52">{formatPct(wallet.supplyPct)}</span>
                    </div>
                  )) : <div className="rounded-[12px] border border-dashed border-white/12 p-4 text-sm text-white/44">No linked wallet evidence returned.</div>}
                </div>
              </section>
              <section className="rounded-[18px] border border-white/8 bg-white/[0.03] p-4">
                <h3 className="text-sm font-semibold">Behavior Over Time</h3>
                <div className="relative mt-4 h-[140px] overflow-hidden rounded-[14px] border border-white/8 bg-black/20">
                  {bundle.behaviorSeries.length ? (
                    <>
                      <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-3 h-[calc(100%-24px)] w-[calc(100%-24px)]">
                        <path d={`${behaviorPath} L 100 100 L 0 100 Z`} fill="rgba(169,255,52,0.12)" />
                        <path d={behaviorPath} fill="none" stroke="rgba(169,255,52,0.92)" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.4" vectorEffect="non-scaling-stroke" />
                      </svg>
                      <div className="absolute bottom-3 left-3 right-3 flex items-end gap-1.5">
                        {bundle.behaviorSeries.map((point, index) => (
                          <div key={`${point.timestamp}-${index}`} className="flex h-9 flex-1 flex-col justify-end">
                            <div className="rounded-t bg-lime-300/42" style={{ height: `${Math.max(10, ((point.bundledSupplyPct ?? 0) / behaviorMax) * 100)}%` }} />
                          </div>
                        ))}
                      </div>
                    </>
                  ) : (
                    <div className="flex h-full items-center justify-center text-sm text-white/44">No historical snapshots.</div>
                  )}
                </div>
              </section>
            </div>
          </div>

          <aside className="space-y-4">
            <section className="rounded-[18px] border border-white/8 bg-white/[0.03] p-5">
              <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-white/38">
                <AlertTriangle className="h-4 w-4 text-rose-300" />
                Risk Overview
              </div>
              <RiskGauge score={bundle.riskSummary.score} label={riskSummaryLabel} />
              <div className="mt-5 grid grid-cols-2 gap-3">
                <StatBox label="Risk Score" value={typeof bundle.riskSummary.score === "number" ? `${bundle.riskSummary.score.toFixed(0)}/100` : "--"} />
                <StatBox label="Confidence" value={riskSummaryLabel || "Unknown"} />
                <StatBox label="Cluster Size" value={formatCompact(bundle.riskSummary.walletCount)} />
                <StatBox label="Value" value={formatUsd(bundle.riskSummary.totalValueUsd)} />
              </div>
              <div className="mt-4">
                <V2ProgressBar value={bundle.riskSummary.clusterPct} valueLabel="Bundled supply concentration" />
              </div>
            </section>

            <section className="rounded-[18px] border border-white/8 bg-white/[0.03] p-5">
              <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-white/38">Risk Factors</div>
              <div className="mt-4 space-y-4">
                {riskFactors.length ? riskFactors.map((factor) => (
                  <RiskFactorRow key={factor.label} {...factor} />
                )) : (
                  <div className="rounded-[14px] border border-dashed border-white/12 bg-black/20 p-4 text-sm leading-6 text-white/50">
                    Not enough explicit bundle evidence was returned. This target is not marked clean.
                  </div>
                )}
              </div>
            </section>

            <section className="rounded-[18px] border border-lime-300/12 bg-[radial-gradient(circle_at_top_right,rgba(169,255,52,0.10),transparent_32%),rgba(255,255,255,0.03)] p-5">
              <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-lime-200">
                <Info className="h-4 w-4" />
                AI Insight
              </div>
              <p className="mt-4 text-sm leading-6 text-white/62">
                {bundle.aiInsight?.summary || "This analysis is generated only from resolved bundle data. Sparse or missing backend evidence stays unavailable instead of rendering synthetic clusters."}
              </p>
              {bundle.aiInsight?.trendDeltaPct !== null && bundle.aiInsight?.trendDeltaPct !== undefined ? (
                <div className="mt-4 rounded-[14px] border border-white/8 bg-black/20 px-3 py-3">
                  <div className="text-[10px] uppercase tracking-[0.16em] text-white/34">Bundle trend delta</div>
                  <div className={cn("mt-1 text-lg font-semibold", bundle.aiInsight.trendDeltaPct > 0 ? "text-rose-300" : "text-lime-300")}>
                    {bundle.aiInsight.trendDeltaPct > 0 ? "+" : ""}{bundle.aiInsight.trendDeltaPct.toFixed(2)} pts
                  </div>
                </div>
              ) : null}
              <div className="mt-4 text-sm font-semibold text-white">
                Recommendation: <span className={riskTone(bundle.riskSummary.score)}>{bundle.aiInsight?.recommendation || (hasExplicitRiskFactors ? ((bundle.riskSummary.score ?? 0) >= 45 ? "Caution" : "Monitor") : "Not enough evidence")}</span>
              </div>
            </section>
          </aside>
        </div>
      )}
    </div>
  );
}

function LegendDot({ className, label }: { className: string; label: string }) {
  return (
    <div className="mt-1.5 flex items-center gap-2">
      <span className={cn("h-2.5 w-2.5 rounded-full", className)} />
      <span>{label}</span>
    </div>
  );
}

function StatBox({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[12px] border border-white/8 bg-black/20 px-3 py-2">
      <div className="text-[9px] uppercase tracking-[0.14em] text-white/34">{label}</div>
      <div className="mt-1 truncate text-sm font-semibold text-white">{value}</div>
    </div>
  );
}

function RiskGauge({ score, label }: { score: number | null | undefined; label: string | null | undefined }) {
  const pct = clampScore(score);
  const dash = 157;
  const offset = dash - (dash * pct) / 100;
  return (
    <div className="relative mx-auto mt-5 h-[132px] max-w-[230px]">
      <svg className="h-full w-full" viewBox="0 0 120 76" role="img" aria-label={`Risk score ${typeof score === "number" ? score.toFixed(0) : "unavailable"}`}>
        <path d="M10 62 A50 50 0 0 1 110 62" fill="none" stroke="rgba(255,255,255,0.10)" strokeWidth="10" strokeLinecap="round" />
        <path
          d="M10 62 A50 50 0 0 1 110 62"
          fill="none"
          stroke={riskStroke(score)}
          strokeWidth="10"
          strokeLinecap="round"
          strokeDasharray={dash}
          strokeDashoffset={offset}
          className="drop-shadow-[0_0_16px_rgba(169,255,52,0.22)]"
        />
      </svg>
      <div className="absolute inset-x-0 bottom-1 text-center">
        <div className={cn("text-5xl font-semibold", riskTone(score))}>{typeof score === "number" ? score.toFixed(0) : "--"}</div>
        <div className="mt-1 text-sm font-semibold text-white/62">{label || "Pending"}</div>
      </div>
    </div>
  );
}

function RiskFactorRow({ label, value, detail }: { label: string; value: number; detail: string }) {
  return (
    <div className="rounded-[12px] border border-white/8 bg-black/18 p-3">
      <div className="flex items-center justify-between gap-3 text-sm">
        <span className="text-white/70">{label}</span>
        <span className={cn("font-semibold", riskTone(value))}>{value.toFixed(0)}/100</span>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/8">
        <div className="h-full rounded-full" style={{ width: `${value}%`, background: riskBg(value) }} />
      </div>
      <div className="mt-2 text-xs text-white/38">{detail}</div>
    </div>
  );
}

function MetricLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-white/8 pb-2 last:border-b-0">
      <span className="text-white/52">{label}</span>
      <span className="font-semibold text-white">{value}</span>
    </div>
  );
}
