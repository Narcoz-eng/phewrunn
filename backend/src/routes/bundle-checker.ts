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

function inferRiskLabel(score: number): "high" | "medium" | "low" {
  if (score >= 70) return "high";
  if (score >= 40) return "medium";
  return "low";
}

type BundleWalletNode = {
  id: string;
  label: string;
  valueUsd: number;
  kind: "cluster" | "linked" | "main";
};

function parseClusterEvidence(
  evidenceJson: unknown,
  clusterId: string,
  clusterLabel: string,
  estimatedSupplyPct: number,
): { nodes: BundleWalletNode[]; edges: Array<{ source: string; target: string; weight: number }> } {
  const baseNodeId = `cluster:${clusterId}`;
  const nodes: BundleWalletNode[] = [
    {
      id: baseNodeId,
      label: clusterLabel,
      valueUsd: estimatedSupplyPct,
      kind: "cluster",
    },
  ];
  const edges: Array<{ source: string; target: string; weight: number }> = [];
  if (!evidenceJson || typeof evidenceJson !== "object") {
    return { nodes, edges };
  }

  const record = evidenceJson as Record<string, unknown>;
  const walletsRaw = Array.isArray(record.wallets)
    ? record.wallets
    : Array.isArray(record.linkedWallets)
      ? record.linkedWallets
      : [];

  for (const wallet of walletsRaw.slice(0, 8)) {
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
    nodes.push({
      id: nodeId,
      label: rawAddress,
      valueUsd: toFiniteNumber(candidate.valueUsd ?? candidate.usdValue ?? candidate.exposureUsd),
      kind: "linked",
    });
    edges.push({
      source: baseNodeId,
      target: nodeId,
      weight: Math.max(1, Math.round(toFiniteNumber(candidate.overlapPct ?? candidate.weight ?? 1))),
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
        kind: "main",
      },
    ];
    const graphEdges: Array<{ source: string; target: string; weight: number }> = [];
    const linkedWallets: Array<{ address: string; exposureUsd: number; clusterLabel: string }> = [];

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
        });
      }
      graphNodes.push(...parsed.nodes);
      graphEdges.push(...parsed.edges);

      for (const node of parsed.nodes) {
        if (node.kind !== "linked") continue;
        linkedWallets.push({
          address: node.label,
          exposureUsd: node.valueUsd,
          clusterLabel: cluster.clusterLabel,
        });
      }
    }

    const riskScore = inferRiskScore({
      tokenRiskScore: token.tokenRiskScore,
      clusterCount: token.clusters.length,
      bundledSupplyPct: token.estimatedBundledSupplyPct,
      bundledWalletCount: token.bundledWalletCount,
      bundleRiskLabel: token.bundleRiskLabel,
    });
    const riskLabel = inferRiskLabel(riskScore);

    return c.json({
      data: {
        entity: {
          id: token.id,
          tokenAddress: token.address,
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
          .slice(0, 8),
        graph: {
          nodes: graphNodes,
          edges: graphEdges,
        },
        behaviorSeries: token.snapshots.map((snapshot) => ({
          capturedAt: snapshot.capturedAt.toISOString(),
          marketCap: snapshot.marketCap,
          holderCount: snapshot.holderCount,
          bundledWalletCount: snapshot.bundledWalletCount,
          bundledSupplyPct: snapshot.estimatedBundledSupplyPct,
          tokenRiskScore: snapshot.tokenRiskScore,
        })),
        relatedTokens: [
          {
            tokenAddress: token.address,
            symbol: token.symbol,
            name: token.name,
            relationship: "source",
          },
        ],
      },
    });
  },
);
