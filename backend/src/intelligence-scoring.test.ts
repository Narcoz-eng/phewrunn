import { describe, expect, test } from "bun:test";
import {
  computeConfidenceScore,
  computeEarlyRunnerScore,
  computeHighConvictionScore,
  computeHotAlphaScore,
} from "./services/intelligence/scoring.js";

const concentratedStructure = {
  holderCount: 28,
  largestHolderPct: 24,
  top10HolderPct: 91,
  deployerSupplyPct: 18,
  bundledWalletCount: 7,
  estimatedBundledSupplyPct: 37,
  tokenRiskScore: 82,
};

const healthyStructure = {
  holderCount: 2_400,
  largestHolderPct: 5.5,
  top10HolderPct: 28,
  deployerSupplyPct: 2.2,
  bundledWalletCount: 1,
  estimatedBundledSupplyPct: 4,
  tokenRiskScore: 18,
};

describe("intelligence scoring with on-chain token structure", () => {
  test("confidence score rewards broader holder distribution", () => {
    const concentrated = computeConfidenceScore({
      traderWinRate30d: 68,
      traderAvgRoi30d: 96,
      traderTrustScore: 74,
      entryQualityScore: 72,
      liquidityUsd: 168_000,
      volumeGrowth24hPct: 145,
      liquidityGrowth1hPct: 48,
      holderGrowth1hPct: 24,
      mcapGrowthPct: 82,
      momentumPct: 76,
      trustedTraderCount: 3,
      marketBreadthScore: 61,
      roiCurrentPct: 38,
      sentimentScore: 63,
      ...concentratedStructure,
    });

    const healthy = computeConfidenceScore({
      traderWinRate30d: 68,
      traderAvgRoi30d: 96,
      traderTrustScore: 74,
      entryQualityScore: 72,
      liquidityUsd: 168_000,
      volumeGrowth24hPct: 145,
      liquidityGrowth1hPct: 48,
      holderGrowth1hPct: 24,
      mcapGrowthPct: 82,
      momentumPct: 76,
      trustedTraderCount: 3,
      marketBreadthScore: 61,
      roiCurrentPct: 38,
      sentimentScore: 63,
      ...healthyStructure,
    });

    expect(healthy).toBeGreaterThan(concentrated);
  });

  test("hot alpha rewards healthy RPC-derived token structure", () => {
    const concentrated = computeHotAlphaScore({
      confidenceScore: 58,
      weightedEngagementPerHour: 34,
      earlyGainsPct: 44,
      traderTrustScore: 71,
      liquidityUsd: 155_000,
      sentimentScore: 67,
      momentumPct: 82,
      ...concentratedStructure,
    });

    const healthy = computeHotAlphaScore({
      confidenceScore: 58,
      weightedEngagementPerHour: 34,
      earlyGainsPct: 44,
      traderTrustScore: 71,
      liquidityUsd: 155_000,
      sentimentScore: 67,
      momentumPct: 82,
      ...healthyStructure,
    });

    expect(healthy).toBeGreaterThan(concentrated);
  });

  test("early runner score uses holder breadth and structure health", () => {
    const concentrated = computeEarlyRunnerScore({
      distinctTrustedTradersLast6h: 3,
      liquidityGrowth1hPct: 52,
      volumeGrowth1hPct: 172,
      holderGrowth1hPct: 16,
      momentumPct: 66,
      sentimentScore: 60,
      ...concentratedStructure,
    });

    const healthy = computeEarlyRunnerScore({
      distinctTrustedTradersLast6h: 3,
      liquidityGrowth1hPct: 52,
      volumeGrowth1hPct: 172,
      holderGrowth1hPct: 16,
      momentumPct: 66,
      sentimentScore: 60,
      ...healthyStructure,
    });

    expect(healthy).toBeGreaterThan(concentrated);
  });

  test("high conviction favors healthier distribution and lower deployer concentration", () => {
    const concentrated = computeHighConvictionScore({
      confidenceScore: 61,
      traderTrustScore: 72,
      entryQualityScore: 70,
      liquidityUsd: 188_000,
      sentimentScore: 64,
      trustedTraderCount: 4,
      ...concentratedStructure,
    });

    const healthy = computeHighConvictionScore({
      confidenceScore: 61,
      traderTrustScore: 72,
      entryQualityScore: 70,
      liquidityUsd: 188_000,
      sentimentScore: 64,
      trustedTraderCount: 4,
      ...healthyStructure,
    });

    expect(healthy).toBeGreaterThan(concentrated);
  });
});
