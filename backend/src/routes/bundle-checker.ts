import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { prisma } from "../prisma.js";

export const bundleCheckerRouter = new Hono();

const BundleIdentifierParamSchema = z.object({
  identifier: z.string().trim().min(1),
});

function normalizeSearchIdentifier(identifier: string): string {
  return identifier.trim().toLowerCase();
}

function toFiniteNumber(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function inferRiskScore(params: {
  tokenRiskScore: number | null;
  clusterCount: number;
  bundledSupplyPct: number | null;
  bundledWalletCount: number | null;
  bundleRiskLabel: string | null;
}): number {
  const base = typeof params.tokenRiskScore === "number" ? params.tokenRiskScore : 0;
  const derived =
    params.clusterCount * 6 +
    toFiniteNumber(params.bundledSupplyPct) * 1.15 +
    toFiniteNumber(params.bundledWalletCount) * 0.8;
  const labelBoost =
    params.bundleRiskLabel === "high"
      ? 18
      : params.bundleRiskLabel === "medium"
        ? 10
        : params.bundleRiskLabel === "low"
          ? 4
          : 0;
  return Math.max(0, Math.min(99, Math.round(base + derived + labelBoost)));
}

function inferRiskLabel(score: number, hasExplicitEvidence: boolean): "high" | "medium" | "low" | "not_enough_evidence" {
  if (!hasExplicitEvidence) return "not_enough_evidence";
  if (score >= 70) return "high";
  if (score >= 40) return "medium";
  return "low";
}

type BundleWalletNode = {
  id: string;
  label: string;
  valueUsd: number;
  kind: "cluster" | "wallet" | "token";
  riskLabel: "high" | "medium" | "low" | "external";
  address?: string | null;
  clusterLabel?: string | null;
  supplyPct?: number | null;
  relationStrength?: number | null;
  evidence?: string | null;
};

function inferNodeRisk(value: number): "high" | "medium" | "low" {
  if (value >= 20) return "high";
  if (value >= 8) return "medium";
  return "low";
}

function parseClusterEvidence(
  evidenceJson: unknown,
  clusterId: string,
  clusterLabel: string,
  estimatedSupplyPct: number,
): { nodes: BundleWalletNode[]; edges: Array<{ source: string; target: string; weight: number; relationLabel: string | null }> } {
  const baseNodeId = `cluster:${clusterId}`;
  const nodes: BundleWalletNode[] = [
    {
      id: baseNodeId,
      label: clusterLabel,
      valueUsd: estimatedSupplyPct,
      kind: "cluster",
      riskLabel: inferNodeRisk(estimatedSupplyPct),
      clusterLabel,
      supplyPct: estimatedSupplyPct,
      relationStrength: Math.max(1, Math.min(100, Math.round(estimatedSupplyPct * 2.2))),
      evidence: `${clusterLabel} controls an estimated ${estimatedSupplyPct.toFixed(2)}% of supply.`,
    },
  ];
  const edges: Array<{ source: string; target: string; weight: number; relationLabel: string | null }> = [];
  if (!evidenceJson || typeof evidenceJson !== "object") {
    return { nodes, edges };
  }

  const record = evidenceJson as Record<string, unknown>;
  const walletsRaw = Array.isArray(record.wallets)
    ? record.wallets
    : Array.isArray(record.linkedWallets)
      ? record.linkedWallets
      : [];

  for (const wallet of walletsRaw.slice(0, 24)) {
    if (!wallet || typeof wallet !== "object") continue;
    const candidate = wallet as Record<string, unknown>;
    const rawAddress =
      typeof candidate.address === "string"
        ? candidate.address
        : typeof candidate.wallet === "string"
          ? candidate.wallet
          : null;
    if (!rawAddress) continue;
    const nodeId = `wallet:${rawAddress}`;
    const relationStrength = Math.max(1, Math.round(toFiniteNumber(candidate.overlapPct ?? candidate.weight ?? 1)));
    const valueUsd = toFiniteNumber(candidate.valueUsd ?? candidate.usdValue ?? candidate.exposureUsd);
    const overlapPct = toFiniteNumber(candidate.overlapPct ?? candidate.weight ?? estimatedSupplyPct);
    nodes.push({
      id: nodeId,
      label: rawAddress,
      valueUsd,
      kind: "wallet",
      riskLabel: inferNodeRisk(overlapPct),
      address: rawAddress,
      clusterLabel,
      supplyPct: estimatedSupplyPct,
      relationStrength,
      evidence:
        typeof candidate.reason === "string"
          ? candidate.reason
          : `${relationStrength}/100 relationship strength inside ${clusterLabel}.`,
    });
    edges.push({
      source: baseNodeId,
      target: nodeId,
      weight: relationStrength,
      relationLabel: `Shared ${clusterLabel} behavior (${relationStrength}/100)`,
    });
  }

  return { nodes, edges };
}

bundleCheckerRouter.get(
  "/:identifier",
  zValidator("param", BundleIdentifierParamSchema),
  async (c) => {
    const { identifier } = c.req.valid("param");
    const normalized = normalizeSearchIdentifier(identifier);

    const token = await prisma.token.findFirst({
      where: {
        OR: [
          { address: identifier },
          { symbol: normalized.toUpperCase() },
          { name: identifier },
        ],
      },
      select: {
        id: true,
        address: true,
        chainType: true,
        symbol: true,
        name: true,
        imageUrl: true,
        liquidity: true,
        volume24h: true,
        holderCount: true,
        bundledWalletCount: true,
        bundledClusterCount: true,
        estimatedBundledSupplyPct: true,
        bundleRiskLabel: true,
        tokenRiskScore: true,
        clusters: {
          select: {
            id: true,
            clusterLabel: true,
            walletCount: true,
            estimatedSupplyPct: true,
            evidenceJson: true,
          },
          orderBy: [{ estimatedSupplyPct: "desc" }, { walletCount: "desc" }],
          take: 12,
        },
        snapshots: {
          select: {
            capturedAt: true,
            marketCap: true,
            holderCount: true,
            bundledWalletCount: true,
            estimatedBundledSupplyPct: true,
            tokenRiskScore: true,
          },
          orderBy: { capturedAt: "asc" },
          take: 24,
        },
      },
    });

    if (!token) {
      return c.json({ error: { message: "Bundle target not found", code: "NOT_FOUND" } }, 404);
    }

    const graphNodes: BundleWalletNode[] = [
      {
        id: `token:${token.id}`,
        label: token.symbol?.trim() || token.name?.trim() || token.address,
        valueUsd: toFiniteNumber(token.volume24h),
        kind: "token",
        riskLabel: "external",
      },
    ];
    const graphEdges: Array<{ source: string; target: string; weight: number; relationLabel: string | null }> = [];
    const linkedWallets: Array<{ address: string; exposureUsd: number; clusterLabel: string; supplyPct: number; relationStrength: number }> = [];

    for (const cluster of token.clusters) {
      const parsed = parseClusterEvidence(
        cluster.evidenceJson,
        cluster.id,
        cluster.clusterLabel,
        cluster.estimatedSupplyPct,
      );
      const clusterNodeId = parsed.nodes[0]?.id;
      if (clusterNodeId) {
        graphEdges.push({
          source: `token:${token.id}`,
          target: clusterNodeId,
          weight: Math.max(2, Math.round(cluster.estimatedSupplyPct)),
          relationLabel: `${cluster.clusterLabel} supply concentration`,
        });
      }
      graphNodes.push(...parsed.nodes);
      graphEdges.push(...parsed.edges);

      for (const node of parsed.nodes) {
        if (node.kind !== "wallet") continue;
        linkedWallets.push({
          address: node.label,
          exposureUsd: node.valueUsd,
          clusterLabel: cluster.clusterLabel,
          supplyPct: cluster.estimatedSupplyPct,
          relationStrength: node.riskLabel === "high" ? 90 : node.riskLabel === "medium" ? 65 : 35,
        });
      }
    }

    const hasExplicitRiskEvidence =
      token.clusters.length > 0 ||
      graphEdges.length > 0 ||
      (typeof token.estimatedBundledSupplyPct === "number" && Number.isFinite(token.estimatedBundledSupplyPct) && token.estimatedBundledSupplyPct > 0) ||
      (typeof token.bundledWalletCount === "number" && Number.isFinite(token.bundledWalletCount) && token.bundledWalletCount > 0) ||
      (typeof token.tokenRiskScore === "number" && Number.isFinite(token.tokenRiskScore) && token.tokenRiskScore > 0);
    const riskScore = hasExplicitRiskEvidence ? inferRiskScore({
      tokenRiskScore: token.tokenRiskScore,
      clusterCount: token.clusters.length,
      bundledSupplyPct: token.estimatedBundledSupplyPct,
      bundledWalletCount: token.bundledWalletCount,
      bundleRiskLabel: token.bundleRiskLabel,
    }) : null;
    const riskLabel = inferRiskLabel(riskScore ?? 0, hasExplicitRiskEvidence);
    const edgeCount = graphEdges.length;
    const clusterCount = token.clusters.length;
    const bundledSupplyPct = toFiniteNumber(token.estimatedBundledSupplyPct);
    const bundledWalletCount = toFiniteNumber(token.bundledWalletCount);
    const walletDensityScore = Math.max(0, Math.min(100, Math.round(edgeCount * 7 + bundledWalletCount * 2.4)));
    const supplyConcentrationScore = Math.max(0, Math.min(100, Math.round(bundledSupplyPct * 2.25)));
    const clusterConcentrationScore = Math.max(0, Math.min(100, Math.round(clusterCount * 13 + bundledSupplyPct)));
    const liquiditySensitivityScore = Math.max(
      0,
      Math.min(100, Math.round((toFiniteNumber(token.volume24h) / Math.max(toFiniteNumber(token.liquidity), 1)) * 22))
    );
    const trend = token.snapshots
      .map((snapshot) => snapshot.estimatedBundledSupplyPct)
      .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
    const firstTrend = trend[0] ?? null;
    const lastTrend = trend[trend.length - 1] ?? null;
    const trendDelta =
      typeof firstTrend === "number" && typeof lastTrend === "number" ? lastTrend - firstTrend : null;
    const riskFactors = hasExplicitRiskEvidence ? [
      {
        key: "wallet_interconnectivity",
        label: "Wallet interconnectivity",
        score: walletDensityScore,
        detail: `${edgeCount.toLocaleString()} resolved relationship edges across ${bundledWalletCount.toLocaleString()} linked wallets.`,
      },
      {
        key: "supply_concentration",
        label: "Bundled supply concentration",
        score: supplyConcentrationScore,
        detail: `${bundledSupplyPct.toFixed(2)}% of supply appears coordinated or clustered.`,
      },
      {
        key: "cluster_concentration",
        label: "Cluster concentration",
        score: clusterConcentrationScore,
        detail: `${clusterCount.toLocaleString()} cluster${clusterCount === 1 ? "" : "s"} detected from stored evidence.`,
      },
      {
        key: "liquidity_sensitivity",
        label: "Liquidity sensitivity",
        score: liquiditySensitivityScore,
        detail: `${token.volume24h != null ? "$" + Math.round(token.volume24h).toLocaleString() : "Unknown"} 24h volume versus ${token.liquidity != null ? "$" + Math.round(token.liquidity).toLocaleString() : "unknown"} liquidity.`,
      },
    ] : [];
    const resolvedRiskScore = riskScore ?? 0;
    const aiInsight =
      !hasExplicitRiskEvidence
        ? "Not enough bundle evidence: the backend did not return clusters, linked wallets, or bundled supply measurements for this target."
        : resolvedRiskScore >= 70
        ? `High coordination risk: ${clusterCount} cluster${clusterCount === 1 ? "" : "s"} and ${bundledWalletCount} linked wallets create a meaningful supply control pocket. ${trendDelta != null ? `Bundled supply ${trendDelta >= 0 ? "increased" : "decreased"} ${Math.abs(trendDelta).toFixed(2)} pts across captured snapshots.` : "Trend history is limited."}`
        : resolvedRiskScore >= 40
          ? `Moderate coordination pressure: ${clusterCount} cluster${clusterCount === 1 ? "" : "s"} detected with ${bundledSupplyPct.toFixed(2)}% estimated bundled supply. Watch for synchronized distribution into high-volume spikes.`
          : `Low current bundle pressure: resolved clusters do not show dominant supply control. Continue monitoring because new holder snapshots can change this quickly.`;
    const recommendation =
      !hasExplicitRiskEvidence
        ? "Not enough evidence; do not treat this as clean."
        : resolvedRiskScore >= 70
        ? "Avoid or size defensively until cluster pressure eases."
        : resolvedRiskScore >= 40
          ? "Trade with caution and require confirmation from liquidity and holder trend."
          : "Monitor normally; no dominant bundle risk detected from current evidence.";

    return c.json({
      data: {
        entity: {
          id: token.id,
          address: token.address,
          chainType: token.chainType,
          symbol: token.symbol,
          name: token.name,
          imageUrl: token.imageUrl,
        },
        riskSummary: {
          score: riskScore,
          label: riskLabel,
          clusterPct: token.estimatedBundledSupplyPct,
          walletCount: token.bundledWalletCount,
          totalValueUsd: token.volume24h,
          liquidityUsd: token.liquidity,
        },
        bundlesDetected: token.bundledClusterCount ?? token.clusters.length,
        totalWallets: token.bundledWalletCount ?? linkedWallets.length,
        totalHoldingsUsd: token.volume24h,
        bundledSupplyPct: token.estimatedBundledSupplyPct,
        linkedWallets: linkedWallets
          .sort((a, b) => b.exposureUsd - a.exposureUsd)
          .slice(0, 8)
          .map((wallet) => ({
            address: wallet.address,
            label: wallet.clusterLabel,
            valueUsd: wallet.exposureUsd,
            supplyPct: wallet.supplyPct,
            relationStrength: wallet.relationStrength,
          })),
        graph: {
          nodes: graphNodes.map((node) => ({
            id: node.id,
            label: node.label,
            kind: node.kind,
            weight: Math.max(1, Math.round(node.valueUsd || 1)),
            highlight: node.kind === "token",
            riskLabel: node.riskLabel,
            address: node.address ?? null,
            valueUsd: node.valueUsd,
            supplyPct: node.supplyPct ?? null,
            clusterLabel: node.clusterLabel ?? null,
            relationStrength: node.relationStrength ?? null,
            evidence: node.evidence ?? null,
          })),
          edges: graphEdges.map((edge) => ({
            source: edge.source,
            target: edge.target,
            weight: edge.weight,
            relationLabel: edge.relationLabel,
          })),
        },
        behaviorSeries: token.snapshots.map((snapshot) => ({
          timestamp: snapshot.capturedAt.toISOString(),
          bundledSupplyPct: snapshot.estimatedBundledSupplyPct,
          linkedWalletCount: snapshot.bundledWalletCount,
          totalHoldingsUsd: snapshot.marketCap,
        })),
        relatedTokens: [
          {
            address: token.address,
            symbol: token.symbol,
            name: token.name,
          },
        ],
        riskFactors,
        aiInsight: {
          summary: aiInsight,
          recommendation,
          trendDeltaPct: trendDelta,
          severity: riskLabel,
        },
      },
    });
  },
);
