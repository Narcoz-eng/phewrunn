import { describe, expect, test } from "bun:test";
import {
  computeConfidenceScore,
  computeEarlyRunnerScore,
  computeHighConvictionScore,
  computeHotAlphaScore,
  computeStateAwareIntelligenceScores,
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

  test("state-aware scoring suppresses bullish scores for dormant tokens", () => {
    const dormant = computeStateAwareIntelligenceScores({
      baseConfidenceScore: 84,
      baseHotAlphaScore: 88,
      baseEarlyRunnerScore: 82,
      baseHighConvictionScore: 86,
      liquidityUsd: 1_200,
      volume24hUsd: 180,
      holderCount: 14,
      largestHolderPct: 28,
      top10HolderPct: 94,
      deployerSupplyPct: 22,
      bundledWalletCount: 9,
      estimatedBundledSupplyPct: 52,
      tokenRiskScore: 94,
      traderTrustScore: 74,
      entryQualityScore: 70,
      trustedTraderCount: 3,
      sentimentScore: 58,
      marketBreadthScore: 42,
      liquidityGrowthPct: -18,
      volumeGrowthPct: -36,
      holderGrowthPct: -8,
      mcapGrowthPct: -42,
      momentumPct: -28,
      tradeCount24h: 1,
      hasTradablePair: false,
      hasResolvedHolderDistribution: true,
      recentCallCount: 2,
      signalAgeHours: 80,
    });

    expect(dormant.activityStatus === "dormant" || dormant.activityStatus === "untradable").toBeTrue();
    expect(dormant.bullishSignalsSuppressed).toBeTrue();
    expect(dormant.isTradable).toBeFalse();
    expect(dormant.marketHealthScore).toBeLessThan(20);
    expect(dormant.opportunityScore).toBeLessThan(20);
    expect(dormant.hotAlphaScore).toBeLessThanOrEqual(16);
    expect(dormant.highConvictionScore).toBeLessThanOrEqual(20);
  });

  test("state-aware scoring separates healthy active setups from dormant ones", () => {
    const dormant = computeStateAwareIntelligenceScores({
      baseConfidenceScore: 84,
      baseHotAlphaScore: 88,
      baseEarlyRunnerScore: 82,
      baseHighConvictionScore: 86,
      liquidityUsd: 1_200,
      volume24hUsd: 180,
      holderCount: 14,
      largestHolderPct: 28,
      top10HolderPct: 94,
      deployerSupplyPct: 22,
      bundledWalletCount: 9,
      estimatedBundledSupplyPct: 52,
      tokenRiskScore: 94,
      traderTrustScore: 74,
      entryQualityScore: 70,
      trustedTraderCount: 3,
      sentimentScore: 58,
      marketBreadthScore: 42,
      liquidityGrowthPct: -18,
      volumeGrowthPct: -36,
      holderGrowthPct: -8,
      mcapGrowthPct: -42,
      momentumPct: -28,
      tradeCount24h: 1,
      hasTradablePair: false,
      hasResolvedHolderDistribution: true,
      recentCallCount: 2,
      signalAgeHours: 80,
    });

    const active = computeStateAwareIntelligenceScores({
      baseConfidenceScore: 84,
      baseHotAlphaScore: 88,
      baseEarlyRunnerScore: 82,
      baseHighConvictionScore: 86,
      liquidityUsd: 248_000,
      volume24hUsd: 410_000,
      holderCount: 3_200,
      largestHolderPct: 4.9,
      top10HolderPct: 24,
      deployerSupplyPct: 1.4,
      bundledWalletCount: 1,
      estimatedBundledSupplyPct: 3,
      tokenRiskScore: 14,
      traderTrustScore: 79,
      entryQualityScore: 82,
      trustedTraderCount: 5,
      sentimentScore: 71,
      marketBreadthScore: 74,
      liquidityGrowthPct: 44,
      volumeGrowthPct: 118,
      holderGrowthPct: 18,
      mcapGrowthPct: 62,
      momentumPct: 74,
      tradeCount24h: 228,
      hasTradablePair: true,
      hasResolvedHolderDistribution: true,
      recentCallCount: 14,
      signalAgeHours: 2,
    });

    expect(active.activityStatus).toBe("active");
    expect(active.isTradable).toBeTrue();
    expect(active.bullishSignalsSuppressed).toBeFalse();
    expect(active.marketHealthScore).toBeGreaterThan(dormant.marketHealthScore);
    expect(active.setupQualityScore).toBeGreaterThan(dormant.setupQualityScore);
    expect(active.opportunityScore).toBeGreaterThan(dormant.opportunityScore);
    expect(active.hotAlphaScore).toBeGreaterThan(dormant.hotAlphaScore);
    expect(active.highConvictionScore).toBeGreaterThan(dormant.highConvictionScore);
    expect(active.confidenceScore).toBeGreaterThan(dormant.confidenceScore);
  });

  test("state-aware scoring decays stale positive signals even for otherwise healthy tokens", () => {
    const activeInputs = {
      baseConfidenceScore: 76,
      baseHotAlphaScore: 80,
      baseEarlyRunnerScore: 74,
      baseHighConvictionScore: 78,
      liquidityUsd: 184_000,
      volume24hUsd: 142_000,
      holderCount: 1_900,
      largestHolderPct: 6.2,
      top10HolderPct: 31,
      deployerSupplyPct: 2.1,
      bundledWalletCount: 1,
      estimatedBundledSupplyPct: 5,
      tokenRiskScore: 20,
      traderTrustScore: 75,
      entryQualityScore: 77,
      trustedTraderCount: 4,
      sentimentScore: 66,
      marketBreadthScore: 68,
      liquidityGrowthPct: 28,
      volumeGrowthPct: 72,
      holderGrowthPct: 10,
      mcapGrowthPct: 34,
      momentumPct: 51,
      tradeCount24h: 96,
      hasTradablePair: true,
      hasResolvedHolderDistribution: true,
      recentCallCount: 10,
      signalAgeHours: 3,
    };

    const fresh = computeStateAwareIntelligenceScores(activeInputs);

    const stale = computeStateAwareIntelligenceScores({
      ...activeInputs,
      signalAgeHours: 96,
    });

    expect(fresh.activityStatus).toBe("active");
    expect(stale.activityStatus).toBe("active");
    expect(fresh.scoreDecayMultiplier).toBeGreaterThan(stale.scoreDecayMultiplier);
    expect(fresh.opportunityScore).toBeGreaterThan(stale.opportunityScore);
    expect(fresh.hotAlphaScore).toBeGreaterThan(stale.hotAlphaScore);
    expect(fresh.earlyRunnerScore).toBeGreaterThan(stale.earlyRunnerScore);
    expect(fresh.highConvictionScore).toBeGreaterThan(stale.highConvictionScore);
  });
});
