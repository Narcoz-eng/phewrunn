export const REACTION_TYPES = ["alpha", "based", "printed", "rug"] as const;

export type ReactionType = (typeof REACTION_TYPES)[number];

export type ReactionCounts = Record<ReactionType, number>;

export type TokenRiskInputs = {
  estimatedBundledSupplyPct: number | null;
  bundledClusterCount: number | null;
  largestHolderPct: number | null;
  top10HolderPct: number | null;
  deployerSupplyPct: number | null;
};

export type ConfidenceInputs = {
  traderWinRate30d: number | null;
  traderAvgRoi30d: number | null;
  traderTrustScore: number | null;
  entryQualityScore: number | null;
  liquidityUsd: number | null;
  volumeGrowth24hPct: number | null;
  liquidityGrowth1hPct?: number | null;
  holderGrowth1hPct?: number | null;
  mcapGrowthPct?: number | null;
  momentumPct: number | null;
  trustedTraderCount: number | null;
  holderCount?: number | null;
  largestHolderPct?: number | null;
  top10HolderPct: number | null;
  deployerSupplyPct?: number | null;
  bundledWalletCount?: number | null;
  estimatedBundledSupplyPct?: number | null;
  tokenRiskScore: number | null;
  marketBreadthScore?: number | null;
  roiCurrentPct?: number | null;
  sentimentScore?: number | null;
};

export type HotAlphaInputs = {
  confidenceScore: number | null;
  weightedEngagementPerHour: number | null;
  earlyGainsPct: number | null;
  traderTrustScore: number | null;
  liquidityUsd: number | null;
  sentimentScore: number | null;
  momentumPct: number | null;
  holderCount?: number | null;
  largestHolderPct?: number | null;
  top10HolderPct?: number | null;
  deployerSupplyPct?: number | null;
  bundledWalletCount?: number | null;
  estimatedBundledSupplyPct?: number | null;
  tokenRiskScore: number | null;
};

export type EarlyRunnerInputs = {
  distinctTrustedTradersLast6h: number | null;
  liquidityGrowth1hPct: number | null;
  volumeGrowth1hPct: number | null;
  holderGrowth1hPct: number | null;
  momentumPct: number | null;
  sentimentScore: number | null;
  holderCount?: number | null;
  largestHolderPct?: number | null;
  top10HolderPct?: number | null;
  deployerSupplyPct?: number | null;
  bundledWalletCount?: number | null;
  estimatedBundledSupplyPct?: number | null;
  tokenRiskScore: number | null;
};

export type HighConvictionInputs = {
  confidenceScore: number | null;
  traderTrustScore: number | null;
  entryQualityScore: number | null;
  liquidityUsd: number | null;
  sentimentScore: number | null;
  trustedTraderCount: number | null;
  holderCount?: number | null;
  largestHolderPct?: number | null;
  top10HolderPct?: number | null;
  deployerSupplyPct?: number | null;
  bundledWalletCount?: number | null;
  estimatedBundledSupplyPct?: number | null;
  tokenRiskScore: number | null;
};

export type TokenActivityStatus = "active" | "warming" | "inactive" | "dormant" | "untradable";

export type StateAwareScoreInputs = {
  baseConfidenceScore: number | null;
  baseHotAlphaScore: number | null;
  baseEarlyRunnerScore: number | null;
  baseHighConvictionScore: number | null;
  liquidityUsd: number | null;
  volume24hUsd: number | null;
  holderCount: number | null;
  largestHolderPct?: number | null;
  top10HolderPct?: number | null;
  deployerSupplyPct?: number | null;
  bundledWalletCount?: number | null;
  estimatedBundledSupplyPct?: number | null;
  tokenRiskScore: number | null;
  traderTrustScore?: number | null;
  entryQualityScore?: number | null;
  trustedTraderCount?: number | null;
  sentimentScore?: number | null;
  marketBreadthScore?: number | null;
  liquidityGrowthPct?: number | null;
  volumeGrowthPct?: number | null;
  holderGrowthPct?: number | null;
  mcapGrowthPct?: number | null;
  momentumPct?: number | null;
  tradeCount24h?: number | null;
  hasTradablePair?: boolean;
  hasResolvedHolderDistribution?: boolean;
  recentCallCount?: number | null;
  signalAgeHours?: number | null;
};

export type StateAwareScoreResult = {
  confidenceScore: number;
  hotAlphaScore: number;
  earlyRunnerScore: number;
  highConvictionScore: number;
  marketHealthScore: number;
  setupQualityScore: number;
  opportunityScore: number;
  dataReliabilityScore: number;
  scoreDecayMultiplier: number;
  isTradable: boolean;
  bullishSignalsSuppressed: boolean;
  activityStatus: TokenActivityStatus;
  activityStatusLabel: string;
};

function finite(value: number | null | undefined, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function hasFiniteMetric(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function roundMetricOrZero(value: number | null | undefined): number {
  return hasFiniteMetric(value) ? Math.round(value * 100) / 100 : 0;
}

export function clampScore(value: number): number {
  return Math.max(0, Math.min(100, value));
}

export function pct(value: number | null | undefined, max: number): number {
  if (!max || max <= 0) return 0;
  return clampScore((finite(value) / max) * 100);
}

export function inversePct(value: number | null | undefined, max: number): number {
  return clampScore(100 - pct(value, max));
}

export function logScore(value: number | null | undefined, pivot: number): number {
  const normalizedValue = Math.max(0, finite(value));
  if (pivot <= 0) return 0;
  return clampScore((Math.log1p(normalizedValue) / Math.log1p(pivot)) * 100);
}

function neutralPct(value: number | null | undefined, max: number, neutral = 50): number {
  return hasFiniteMetric(value) ? pct(value, max) : neutral;
}

function neutralInversePct(value: number | null | undefined, max: number, neutral = 50): number {
  return hasFiniteMetric(value) ? inversePct(value, max) : neutral;
}

function neutralLogScore(value: number | null | undefined, pivot: number, neutral = 50): number {
  return hasFiniteMetric(value) ? logScore(value, pivot) : neutral;
}

export function buildReactionCounts(types: Array<string | null | undefined>): ReactionCounts {
  const counts: ReactionCounts = {
    alpha: 0,
    based: 0,
    printed: 0,
    rug: 0,
  };

  for (const type of types) {
    if (!type) continue;
    const normalized = type.trim().toLowerCase() as ReactionType;
    if (normalized in counts) {
      counts[normalized] += 1;
    }
  }

  return counts;
}

export function computeWeightedEngagementPerHour(args: {
  reactions: ReactionCounts;
  threadReplies: number | null | undefined;
  ageHours: number;
}): number {
  const ageHours = Math.max(1 / 12, args.ageHours);
  const weightedTotal =
    1.0 * args.reactions.alpha +
    0.8 * args.reactions.based +
    1.4 * args.reactions.printed +
    1.2 * finite(args.threadReplies) -
    1.8 * args.reactions.rug;

  return weightedTotal / ageHours;
}

export function computeSentimentScore(args: {
  reactions: ReactionCounts;
  sentimentTrendAdjustment?: number | null;
}): number {
  const raw =
    2.0 * args.reactions.alpha +
    1.0 * args.reactions.based +
    3.0 * args.reactions.printed -
    4.0 * args.reactions.rug;

  return clampScore(50 + raw + finite(args.sentimentTrendAdjustment));
}

export function computeTokenRiskScore(inputs: TokenRiskInputs): number {
  const bundledSupplyRisk = pct(inputs.estimatedBundledSupplyPct, 40);
  const clusterCountRisk = pct(inputs.bundledClusterCount, 8);
  const largestHolderRisk = pct(inputs.largestHolderPct, 20);
  const top10HolderRisk = pct(inputs.top10HolderPct, 65);
  const deployerRisk = pct(inputs.deployerSupplyPct, 15);
  const concentrationRisk = clampScore((largestHolderRisk * 0.55) + (top10HolderRisk * 0.45));

  return clampScore(
    0.35 * bundledSupplyRisk +
    0.10 * clusterCountRisk +
    0.20 * largestHolderRisk +
    0.15 * top10HolderRisk +
    0.10 * deployerRisk +
    0.10 * concentrationRisk
  );
}

export function computeHolderBreadthScore(args: {
  holderCount: number | null | undefined;
  largestHolderPct?: number | null | undefined;
  top10HolderPct?: number | null | undefined;
}): number {
  const holderCountScore = neutralLogScore(args.holderCount, 2_500, 45);
  const largestHolderHealth = neutralInversePct(args.largestHolderPct, 20, 50);
  const top10Health = neutralInversePct(args.top10HolderPct, 75, 50);

  return clampScore(
    0.58 * holderCountScore +
      0.18 * largestHolderHealth +
      0.24 * top10Health
  );
}

export function computeOnchainStructureHealthScore(args: {
  largestHolderPct?: number | null | undefined;
  top10HolderPct?: number | null | undefined;
  deployerSupplyPct?: number | null | undefined;
  bundledWalletCount?: number | null | undefined;
  estimatedBundledSupplyPct?: number | null | undefined;
}): number {
  const largestHolderHealth = neutralInversePct(args.largestHolderPct, 20, 50);
  const top10Health = neutralInversePct(args.top10HolderPct, 75, 50);
  const deployerHealth = neutralInversePct(args.deployerSupplyPct, 15, 50);
  const bundledWalletHealth = neutralInversePct(args.bundledWalletCount, 10, 50);
  const bundledSupplyHealth = neutralInversePct(args.estimatedBundledSupplyPct, 40, 50);

  return clampScore(
    0.24 * largestHolderHealth +
      0.24 * top10Health +
      0.18 * deployerHealth +
      0.12 * bundledWalletHealth +
      0.22 * bundledSupplyHealth
  );
}

export function determineBundleRiskLabel(tokenRiskScore: number | null | undefined): string {
  const score = finite(tokenRiskScore);
  if (score < 30) return "Clean";
  if (score < 60) return "Moderate Bundling";
  return "Hard Bundled";
}

function computeConfidenceDrawdownPenalty(roiCurrentPct: number | null | undefined): number {
  const roi = finite(roiCurrentPct);
  if (roi >= 0) return 0;
  const drawdown = Math.abs(roi);
  if (drawdown >= 90) return 100;
  if (drawdown >= 80) return 100;
  if (drawdown >= 70) return 95;
  if (drawdown >= 55) return 80;
  if (drawdown >= 40) return 60;
  if (drawdown >= 25) return 40;
  return pct(drawdown, 25) * 0.8;
}

function computeNegativeSentimentPenalty(sentimentScore: number | null | undefined): number {
  const score = clampScore(finite(sentimentScore, 50));
  if (score >= 50) return 0;
  return pct(50 - score, 50);
}

function computeAccelerationScore(args: {
  volumeGrowth24hPct: number | null | undefined;
  liquidityGrowth1hPct: number | null | undefined;
  holderGrowth1hPct: number | null | undefined;
  mcapGrowthPct: number | null | undefined;
  momentumPct: number | null | undefined;
}): number {
  const volumeGrowthScore = pct(args.volumeGrowth24hPct, 360);
  const liquidityGrowthScore = pct(args.liquidityGrowth1hPct, 140);
  const holderGrowthScore = pct(args.holderGrowth1hPct, 70);
  const mcapGrowthScore = pct(args.mcapGrowthPct, 220);
  const momentumScore = pct(args.momentumPct, 180);

  return clampScore(
    0.26 * volumeGrowthScore +
      0.18 * liquidityGrowthScore +
      0.14 * holderGrowthScore +
      0.18 * mcapGrowthScore +
      0.24 * momentumScore
  );
}

function computeConfidenceScoreCap(args: {
  tokenRiskScore: number | null | undefined;
  roiCurrentPct: number | null | undefined;
}): number {
  const risk = finite(args.tokenRiskScore);
  const currentRoi = finite(args.roiCurrentPct);
  let cap = 100;

  if (risk >= 80) cap = Math.min(cap, 14);
  else if (risk >= 65) cap = Math.min(cap, 28);
  else if (risk >= 50) cap = Math.min(cap, 42);

  if (currentRoi <= -90) cap = Math.min(cap, 4);
  else if (currentRoi <= -80) cap = Math.min(cap, 7);
  else if (currentRoi <= -70) cap = Math.min(cap, 12);
  else if (currentRoi <= -55) cap = Math.min(cap, 20);
  else if (currentRoi <= -40) cap = Math.min(cap, 28);
  else if (currentRoi <= -25) cap = Math.min(cap, 42);

  return cap;
}

function computeConfidenceScoreMultiplier(args: {
  tokenRiskScore: number | null | undefined;
  roiCurrentPct: number | null | undefined;
  sentimentScore: number | null | undefined;
}): number {
  const risk = finite(args.tokenRiskScore);
  const currentRoi = finite(args.roiCurrentPct);
  const sentiment = clampScore(finite(args.sentimentScore, 50));
  let multiplier = 1;

  if (risk >= 80) multiplier *= 0.24;
  else if (risk >= 65) multiplier *= 0.55;
  else if (risk >= 50) multiplier *= 0.78;
  else if (risk >= 40) multiplier *= 0.9;

  if (currentRoi <= -90) multiplier *= 0.08;
  else if (currentRoi <= -80) multiplier *= 0.15;
  else if (currentRoi <= -70) multiplier *= 0.28;
  else if (currentRoi <= -55) multiplier *= 0.44;
  else if (currentRoi <= -40) multiplier *= 0.62;
  else if (currentRoi <= -25) multiplier *= 0.80;

  if (sentiment <= 25) multiplier *= 0.72;
  else if (sentiment <= 35) multiplier *= 0.84;
  else if (sentiment <= 45) multiplier *= 0.94;

  return multiplier;
}

export function applyConfidenceGuardrails(args: {
  baseScore: number;
  tokenRiskScore: number | null | undefined;
  top10HolderPct: number | null | undefined;
  roiCurrentPct?: number | null | undefined;
  sentimentScore?: number | null | undefined;
}): number {
  const bundlePenalty = pct(args.tokenRiskScore, 100);
  const holderConcentrationPenalty = pct(args.top10HolderPct, 85);
  const drawdownPenalty = computeConfidenceDrawdownPenalty(args.roiCurrentPct);
  const negativeSentimentPenalty = computeNegativeSentimentPenalty(args.sentimentScore);

  const penaltyAdjusted = clampScore(
    clampScore(args.baseScore) -
      0.30 * bundlePenalty -
      0.16 * holderConcentrationPenalty -
      0.28 * drawdownPenalty -
      0.10 * negativeSentimentPenalty
  );

  const multiplied =
    penaltyAdjusted *
    computeConfidenceScoreMultiplier({
      tokenRiskScore: args.tokenRiskScore,
      roiCurrentPct: args.roiCurrentPct,
      sentimentScore: args.sentimentScore,
    });

  return clampScore(
    Math.min(
      computeConfidenceScoreCap({
        tokenRiskScore: args.tokenRiskScore,
        roiCurrentPct: args.roiCurrentPct,
      }),
      multiplied
    )
  );
}

export function computeConfidenceScore(inputs: ConfidenceInputs): number {
  const traderWinRateScore = pct(inputs.traderWinRate30d, 80);
  const traderRoiScore = logScore(Math.max(0, finite(inputs.traderAvgRoi30d)), 300);
  const traderTrustScore = clampScore(finite(inputs.traderTrustScore));
  const entryQualityScore = clampScore(finite(inputs.entryQualityScore, 50));
  const liquidityScore = logScore(inputs.liquidityUsd, 250_000);
  const volumeGrowthScore = pct(inputs.volumeGrowth24hPct, 300);
  const accelerationScore = computeAccelerationScore({
    volumeGrowth24hPct: inputs.volumeGrowth24hPct,
    liquidityGrowth1hPct: inputs.liquidityGrowth1hPct,
    holderGrowth1hPct: inputs.holderGrowth1hPct,
    mcapGrowthPct: inputs.mcapGrowthPct,
    momentumPct: inputs.momentumPct,
  });
  const confirmationScore = pct(inputs.trustedTraderCount, 5);
  const holderBreadthScore = computeHolderBreadthScore({
    holderCount: inputs.holderCount,
    largestHolderPct: inputs.largestHolderPct,
    top10HolderPct: inputs.top10HolderPct,
  });
  const onchainStructureHealthScore = computeOnchainStructureHealthScore({
    largestHolderPct: inputs.largestHolderPct,
    top10HolderPct: inputs.top10HolderPct,
    deployerSupplyPct: inputs.deployerSupplyPct,
    bundledWalletCount: inputs.bundledWalletCount,
    estimatedBundledSupplyPct: inputs.estimatedBundledSupplyPct,
  });
  const marketBreadthScore = clampScore(finite(inputs.marketBreadthScore, 50));

  const confidenceScoreRaw =
    0.15 * traderTrustScore +
    0.10 * traderWinRateScore +
    0.07 * traderRoiScore +
    0.12 * entryQualityScore +
    0.08 * liquidityScore +
    0.09 * volumeGrowthScore +
    0.15 * accelerationScore +
    0.06 * confirmationScore +
    0.05 * holderBreadthScore +
    0.08 * onchainStructureHealthScore +
    0.05 * marketBreadthScore;

  return applyConfidenceGuardrails({
    baseScore: confidenceScoreRaw,
    tokenRiskScore: inputs.tokenRiskScore,
    top10HolderPct: inputs.top10HolderPct,
    roiCurrentPct: inputs.roiCurrentPct,
    sentimentScore: inputs.sentimentScore,
  });
}

export function computeHotAlphaScore(inputs: HotAlphaInputs): number {
  const confidenceScore = clampScore(finite(inputs.confidenceScore));
  const engagementVelocityScore = pct(inputs.weightedEngagementPerHour, 80);
  const earlyGainsScore = pct(Math.max(0, finite(inputs.earlyGainsPct)), 250);
  const traderTrustScore = clampScore(finite(inputs.traderTrustScore));
  const liquidityScore = logScore(inputs.liquidityUsd, 250_000);
  const sentimentScore = clampScore(finite(inputs.sentimentScore));
  const momentumScore = pct(inputs.momentumPct, 120);
  const holderBreadthScore = computeHolderBreadthScore({
    holderCount: inputs.holderCount,
    largestHolderPct: inputs.largestHolderPct,
    top10HolderPct: inputs.top10HolderPct,
  });
  const onchainStructureHealthScore = computeOnchainStructureHealthScore({
    largestHolderPct: inputs.largestHolderPct,
    top10HolderPct: inputs.top10HolderPct,
    deployerSupplyPct: inputs.deployerSupplyPct,
    bundledWalletCount: inputs.bundledWalletCount,
    estimatedBundledSupplyPct: inputs.estimatedBundledSupplyPct,
  });
  const bundlePenalty = pct(inputs.tokenRiskScore, 100);

  const raw =
    0.20 * confidenceScore +
    0.16 * engagementVelocityScore +
    0.14 * earlyGainsScore +
    0.09 * traderTrustScore +
    0.10 * liquidityScore +
    0.08 * sentimentScore +
    0.11 * momentumScore +
    0.06 * holderBreadthScore +
    0.06 * onchainStructureHealthScore;

  return clampScore(raw - (0.18 * bundlePenalty));
}

export function computeEarlyRunnerScore(inputs: EarlyRunnerInputs): number {
  const trustedTraderClusterScore = pct(inputs.distinctTrustedTradersLast6h, 4);
  const liquidityRiseScore = pct(inputs.liquidityGrowth1hPct, 120);
  const volumeSpikeScore = pct(inputs.volumeGrowth1hPct, 300);
  const holderGrowthScore = pct(inputs.holderGrowth1hPct, 80);
  const momentumScore = pct(inputs.momentumPct, 100);
  const sentimentScore = clampScore(finite(inputs.sentimentScore));
  const holderBreadthScore = computeHolderBreadthScore({
    holderCount: inputs.holderCount,
    largestHolderPct: inputs.largestHolderPct,
    top10HolderPct: inputs.top10HolderPct,
  });
  const onchainStructureHealthScore = computeOnchainStructureHealthScore({
    largestHolderPct: inputs.largestHolderPct,
    top10HolderPct: inputs.top10HolderPct,
    deployerSupplyPct: inputs.deployerSupplyPct,
    bundledWalletCount: inputs.bundledWalletCount,
    estimatedBundledSupplyPct: inputs.estimatedBundledSupplyPct,
  });
  const riskGate = inversePct(inputs.tokenRiskScore, 100);

  return clampScore(
    0.20 * trustedTraderClusterScore +
    0.16 * liquidityRiseScore +
    0.20 * volumeSpikeScore +
    0.12 * holderGrowthScore +
    0.10 * momentumScore +
    0.06 * sentimentScore +
    0.04 * riskGate +
    0.07 * holderBreadthScore +
    0.05 * onchainStructureHealthScore
  );
}

export function computeHighConvictionScore(inputs: HighConvictionInputs): number {
  const confidenceScore = clampScore(finite(inputs.confidenceScore));
  const traderTrustScore = clampScore(finite(inputs.traderTrustScore));
  const entryQualityScore = clampScore(finite(inputs.entryQualityScore, 50));
  const liquidityScore = logScore(inputs.liquidityUsd, 250_000);
  const sentimentScore = clampScore(finite(inputs.sentimentScore));
  const confirmationScore = pct(inputs.trustedTraderCount, 5);
  const holderBreadthScore = computeHolderBreadthScore({
    holderCount: inputs.holderCount,
    largestHolderPct: inputs.largestHolderPct,
    top10HolderPct: inputs.top10HolderPct,
  });
  const onchainStructureHealthScore = computeOnchainStructureHealthScore({
    largestHolderPct: inputs.largestHolderPct,
    top10HolderPct: inputs.top10HolderPct,
    deployerSupplyPct: inputs.deployerSupplyPct,
    bundledWalletCount: inputs.bundledWalletCount,
    estimatedBundledSupplyPct: inputs.estimatedBundledSupplyPct,
  });
  const healthScore = inversePct(inputs.tokenRiskScore, 100);

  return clampScore(
    0.28 * confidenceScore +
    0.16 * traderTrustScore +
    0.09 * entryQualityScore +
    0.10 * liquidityScore +
    0.08 * sentimentScore +
    0.08 * confirmationScore +
    0.09 * healthScore +
    0.05 * holderBreadthScore +
    0.07 * onchainStructureHealthScore
  );
}

export function computeSetupQualityScore(args: {
  traderTrustScore?: number | null;
  entryQualityScore?: number | null;
  trustedTraderCount?: number | null;
  sentimentScore?: number | null;
  holderCount?: number | null;
  largestHolderPct?: number | null;
  top10HolderPct?: number | null;
  deployerSupplyPct?: number | null;
  bundledWalletCount?: number | null;
  estimatedBundledSupplyPct?: number | null;
  tokenRiskScore?: number | null;
}): number {
  const traderTrustScore = clampScore(finite(args.traderTrustScore, 50));
  const entryQualityScore = clampScore(finite(args.entryQualityScore, 50));
  const confirmationScore = pct(args.trustedTraderCount, 5);
  const sentimentScore = clampScore(finite(args.sentimentScore, 50));
  const holderBreadthScore = computeHolderBreadthScore({
    holderCount: args.holderCount,
    largestHolderPct: args.largestHolderPct,
    top10HolderPct: args.top10HolderPct,
  });
  const onchainStructureHealthScore = computeOnchainStructureHealthScore({
    largestHolderPct: args.largestHolderPct,
    top10HolderPct: args.top10HolderPct,
    deployerSupplyPct: args.deployerSupplyPct,
    bundledWalletCount: args.bundledWalletCount,
    estimatedBundledSupplyPct: args.estimatedBundledSupplyPct,
  });
  const riskHealth = inversePct(args.tokenRiskScore, 100);

  return clampScore(
    0.15 * traderTrustScore +
      0.13 * entryQualityScore +
      0.08 * confirmationScore +
      0.06 * sentimentScore +
      0.24 * holderBreadthScore +
      0.24 * onchainStructureHealthScore +
      0.10 * riskHealth
  );
}

export function computeMarketHealthScore(args: {
  liquidityUsd: number | null | undefined;
  volume24hUsd: number | null | undefined;
  holderCount: number | null | undefined;
  holderGrowthPct?: number | null | undefined;
  liquidityGrowthPct?: number | null | undefined;
  volumeGrowthPct?: number | null | undefined;
  mcapGrowthPct?: number | null | undefined;
  momentumPct?: number | null | undefined;
  tradeCount24h?: number | null | undefined;
  tokenRiskScore?: number | null | undefined;
  marketBreadthScore?: number | null | undefined;
  hasTradablePair?: boolean | null | undefined;
}): number {
  const liquidityScore = logScore(args.liquidityUsd, 180_000);
  const volumeScore = logScore(args.volume24hUsd, 320_000);
  const tradeActivityScore = hasFiniteMetric(args.tradeCount24h)
    ? logScore(args.tradeCount24h, 260)
    : neutralLogScore(args.volume24hUsd, 320_000, 40);
  const holderScore = logScore(args.holderCount, 2_500);
  const holderGrowthScore = pct(Math.max(0, finite(args.holderGrowthPct)), 60);
  const accelerationScore = computeAccelerationScore({
    volumeGrowth24hPct: args.volumeGrowthPct,
    liquidityGrowth1hPct: args.liquidityGrowthPct,
    holderGrowth1hPct: args.holderGrowthPct,
    mcapGrowthPct: args.mcapGrowthPct,
    momentumPct: args.momentumPct,
  });
  const marketBreadthScore = clampScore(finite(args.marketBreadthScore, 50));
  const riskHealth = inversePct(args.tokenRiskScore, 100);

  let penalties = 0;
  const liquidity = Math.max(0, finite(args.liquidityUsd));
  const volume = Math.max(0, finite(args.volume24hUsd));
  const holders = Math.max(0, finite(args.holderCount));
  const tradeCount = hasFiniteMetric(args.tradeCount24h) ? Math.max(0, args.tradeCount24h) : null;
  const tradablePairMissing = args.hasTradablePair === false;

  if (liquidity > 0 && liquidity < 5_000) penalties += 38;
  else if (liquidity > 0 && liquidity < 15_000) penalties += 18;

  if (volume > 0 && volume < 1_500) penalties += 28;
  else if (volume > 0 && volume < 6_000) penalties += 12;

  if (tradeCount !== null && tradeCount < 4) penalties += 24;
  else if (tradeCount !== null && tradeCount < 12) penalties += 10;

  if (holders > 0 && holders < 20) penalties += 14;
  else if (holders > 0 && holders < 60) penalties += 6;

  if (finite(args.tokenRiskScore) >= 90) penalties += 28;
  else if (finite(args.tokenRiskScore) >= 82) penalties += 14;

  if (tradablePairMissing) penalties += 18;

  return clampScore(
    0.24 * liquidityScore +
      0.20 * volumeScore +
      0.16 * tradeActivityScore +
      0.12 * holderScore +
      0.08 * holderGrowthScore +
      0.12 * accelerationScore +
      0.04 * marketBreadthScore +
      0.04 * riskHealth -
      penalties
  );
}

export function computeDataReliabilityScore(args: {
  liquidityUsd: number | null | undefined;
  volume24hUsd: number | null | undefined;
  holderCount: number | null | undefined;
  tradeCount24h?: number | null | undefined;
  recentCallCount?: number | null | undefined;
  signalAgeHours?: number | null | undefined;
  hasTradablePair?: boolean | null | undefined;
  hasResolvedHolderDistribution?: boolean | null | undefined;
  largestHolderPct?: number | null | undefined;
  top10HolderPct?: number | null | undefined;
  tokenRiskScore?: number | null | undefined;
}): number {
  const liquidityEvidence =
    hasFiniteMetric(args.liquidityUsd) && args.liquidityUsd > 0 ? 100 : 0;
  const volumeEvidence =
    hasFiniteMetric(args.volume24hUsd) && args.volume24hUsd > 0 ? 100 : 0;
  const holderEvidence =
    hasFiniteMetric(args.holderCount) && args.holderCount > 0 ? 100 : 0;
  const tradeEvidence =
    hasFiniteMetric(args.tradeCount24h) && args.tradeCount24h > 0
      ? logScore(args.tradeCount24h, 220)
      : 0;
  const recentCallEvidence =
    hasFiniteMetric(args.recentCallCount) && args.recentCallCount > 0
      ? logScore(args.recentCallCount, 18)
      : 20;
  const signalFreshnessScore =
    !hasFiniteMetric(args.signalAgeHours)
      ? 32
      : args.signalAgeHours <= 6
        ? 100
        : args.signalAgeHours <= 24
          ? 80
          : args.signalAgeHours <= 48
            ? 56
            : args.signalAgeHours <= 72
              ? 40
              : 22;
  const distributionEvidence = (() => {
    if (args.hasResolvedHolderDistribution) return 100;
    const partialSignals = [
      hasFiniteMetric(args.largestHolderPct),
      hasFiniteMetric(args.top10HolderPct),
      hasFiniteMetric(args.tokenRiskScore),
    ].filter(Boolean).length;
    if (partialSignals >= 3) return 74;
    if (partialSignals >= 2) return 54;
    if (partialSignals >= 1) return 34;
    return 0;
  })();
  const routeEvidence = args.hasTradablePair === false ? 18 : 100;

  return clampScore(
    0.16 * liquidityEvidence +
      0.16 * volumeEvidence +
      0.14 * holderEvidence +
      0.12 * tradeEvidence +
      0.10 * recentCallEvidence +
      0.12 * signalFreshnessScore +
      0.12 * distributionEvidence +
      0.08 * routeEvidence
  );
}

export function getTokenActivityStatusLabel(status: TokenActivityStatus): string {
  switch (status) {
    case "active":
      return "Active";
    case "warming":
      return "Warming";
    case "inactive":
      return "Inactive";
    case "dormant":
      return "Dormant";
    case "untradable":
      return "Untradable";
    default:
      return "Inactive";
  }
}

export function computeStateAwareIntelligenceScores(
  inputs: StateAwareScoreInputs
): StateAwareScoreResult {
  const marketHealthScore = computeMarketHealthScore({
    liquidityUsd: inputs.liquidityUsd,
    volume24hUsd: inputs.volume24hUsd,
    holderCount: inputs.holderCount,
    holderGrowthPct: inputs.holderGrowthPct,
    liquidityGrowthPct: inputs.liquidityGrowthPct,
    volumeGrowthPct: inputs.volumeGrowthPct,
    mcapGrowthPct: inputs.mcapGrowthPct,
    momentumPct: inputs.momentumPct,
    tradeCount24h: inputs.tradeCount24h,
    tokenRiskScore: inputs.tokenRiskScore,
    marketBreadthScore: inputs.marketBreadthScore,
    hasTradablePair: inputs.hasTradablePair,
  });
  const setupQualityScore = computeSetupQualityScore({
    traderTrustScore: inputs.traderTrustScore,
    entryQualityScore: inputs.entryQualityScore,
    trustedTraderCount: inputs.trustedTraderCount,
    sentimentScore: inputs.sentimentScore,
    holderCount: inputs.holderCount,
    largestHolderPct: inputs.largestHolderPct,
    top10HolderPct: inputs.top10HolderPct,
    deployerSupplyPct: inputs.deployerSupplyPct,
    bundledWalletCount: inputs.bundledWalletCount,
    estimatedBundledSupplyPct: inputs.estimatedBundledSupplyPct,
    tokenRiskScore: inputs.tokenRiskScore,
  });
  const dataReliabilityScore = computeDataReliabilityScore({
    liquidityUsd: inputs.liquidityUsd,
    volume24hUsd: inputs.volume24hUsd,
    holderCount: inputs.holderCount,
    tradeCount24h: inputs.tradeCount24h,
    recentCallCount: inputs.recentCallCount,
    signalAgeHours: inputs.signalAgeHours,
    hasTradablePair: inputs.hasTradablePair,
    hasResolvedHolderDistribution: inputs.hasResolvedHolderDistribution,
    largestHolderPct: inputs.largestHolderPct,
    top10HolderPct: inputs.top10HolderPct,
    tokenRiskScore: inputs.tokenRiskScore,
  });
  const accelerationScore = computeAccelerationScore({
    volumeGrowth24hPct: inputs.volumeGrowthPct,
    liquidityGrowth1hPct: inputs.liquidityGrowthPct,
    holderGrowth1hPct: inputs.holderGrowthPct,
    mcapGrowthPct: inputs.mcapGrowthPct,
    momentumPct: inputs.momentumPct,
  });
  const marketBreadthScore = clampScore(finite(inputs.marketBreadthScore, 50));

  let scoreDecayMultiplier: number;
  if (!hasFiniteMetric(inputs.signalAgeHours)) {
    scoreDecayMultiplier = 0.72;
  } else if (inputs.signalAgeHours <= 2) {
    scoreDecayMultiplier = 1;
  } else if (inputs.signalAgeHours <= 6) {
    scoreDecayMultiplier = 0.94;
  } else if (inputs.signalAgeHours <= 12) {
    scoreDecayMultiplier = 0.82;
  } else if (inputs.signalAgeHours <= 24) {
    scoreDecayMultiplier = 0.68;
  } else if (inputs.signalAgeHours <= 48) {
    scoreDecayMultiplier = 0.48;
  } else if (inputs.signalAgeHours <= 72) {
    scoreDecayMultiplier = 0.34;
  } else {
    scoreDecayMultiplier = 0.22;
  }

  const tradeCount = hasFiniteMetric(inputs.tradeCount24h) ? Math.max(0, inputs.tradeCount24h) : null;
  if (
    (tradeCount !== null && tradeCount >= 80) ||
    Math.max(0, finite(inputs.volume24hUsd)) >= 100_000
  ) {
    scoreDecayMultiplier = Math.max(scoreDecayMultiplier, 0.92);
  } else if (
    (tradeCount !== null && tradeCount >= 30) ||
    Math.max(0, finite(inputs.volume24hUsd)) >= 25_000
  ) {
    scoreDecayMultiplier = Math.max(scoreDecayMultiplier, 0.80);
  }

  const opportunityBase = clampScore(
    0.42 * marketHealthScore +
      0.30 * setupQualityScore +
      0.18 * accelerationScore +
      0.10 * marketBreadthScore
  );
  const opportunityScore = clampScore(opportunityBase * scoreDecayMultiplier);
  const severeRisk =
    finite(inputs.tokenRiskScore) >= 88 ||
    finite(inputs.estimatedBundledSupplyPct) >= 45;
  const tradablePairOk = inputs.hasTradablePair !== false;
  const isTradable =
    tradablePairOk &&
    Math.max(0, finite(inputs.liquidityUsd)) >= 7_500 &&
    Math.max(0, finite(inputs.volume24hUsd)) >= 2_500 &&
    (tradeCount === null || tradeCount >= 6) &&
    !severeRisk;

  let activityStatus: TokenActivityStatus;
  if (!tradablePairOk && Math.max(0, finite(inputs.liquidityUsd)) <= 0 && Math.max(0, finite(inputs.volume24hUsd)) <= 0) {
    activityStatus = "untradable";
  } else if (
    marketHealthScore < 20 ||
    (!isTradable &&
      Math.max(0, finite(inputs.liquidityUsd)) < 5_000 &&
      Math.max(0, finite(inputs.volume24hUsd)) < 1_500)
  ) {
    activityStatus = "dormant";
  } else if (marketHealthScore < 38 || !isTradable) {
    activityStatus = "inactive";
  } else if (marketHealthScore < 60) {
    activityStatus = "warming";
  } else {
    activityStatus = "active";
  }

  const statusCaps = (() => {
    switch (activityStatus) {
      case "active":
        return { confidence: 100, hotAlpha: 100, earlyRunner: 100, highConviction: 100 };
      case "warming":
        return { confidence: 68, hotAlpha: 62, earlyRunner: 64, highConviction: 66 };
      case "inactive":
        return { confidence: 38, hotAlpha: 30, earlyRunner: 34, highConviction: 36 };
      case "dormant":
        return { confidence: 18, hotAlpha: 16, earlyRunner: 18, highConviction: 20 };
      case "untradable":
      default:
        return { confidence: 12, hotAlpha: 12, earlyRunner: 14, highConviction: 16 };
    }
  })();
  const healthMultiplier =
    activityStatus === "active"
      ? 1
      : activityStatus === "warming"
        ? 0.78
        : activityStatus === "inactive"
          ? 0.48
          : 0.22;
  const confidenceCap = Math.min(
    statusCaps.confidence,
    Math.max(12, dataReliabilityScore + (activityStatus === "active" ? 10 : activityStatus === "warming" ? 4 : 0))
  );
  const confidenceRaw = clampScore(
    0.45 * clampScore(finite(inputs.baseConfidenceScore)) +
      0.40 * dataReliabilityScore +
      0.15 * setupQualityScore
  );
  const confidenceScore = clampScore(
    Math.min(confidenceCap, confidenceRaw * (0.70 + 0.30 * healthMultiplier))
  );
  const hotAlphaScore = clampScore(
    Math.min(
      statusCaps.hotAlpha,
      clampScore(
        0.56 *
          (clampScore(finite(inputs.baseHotAlphaScore)) *
            scoreDecayMultiplier *
            (0.30 + 0.70 * healthMultiplier)) +
          0.44 * opportunityScore
      )
    )
  );
  const earlyRunnerScore = clampScore(
    Math.min(
      statusCaps.earlyRunner,
      clampScore(
        0.52 *
          (clampScore(finite(inputs.baseEarlyRunnerScore)) *
            scoreDecayMultiplier *
            (0.28 + 0.72 * healthMultiplier)) +
          0.48 * opportunityScore
      )
    )
  );
  const highConvictionAnchor = clampScore(0.72 * setupQualityScore + 0.28 * marketHealthScore);
  const highConvictionScore = clampScore(
    Math.min(
      statusCaps.highConviction,
      clampScore(
        0.58 *
          (clampScore(finite(inputs.baseHighConvictionScore)) *
            scoreDecayMultiplier *
            (0.34 + 0.66 * healthMultiplier)) +
          0.42 * highConvictionAnchor
      )
    )
  );
  const bullishSignalsSuppressed =
    activityStatus === "dormant" ||
    activityStatus === "untradable" ||
    (activityStatus === "inactive" && opportunityScore < 42);

  return {
    confidenceScore,
    hotAlphaScore,
    earlyRunnerScore,
    highConvictionScore,
    marketHealthScore: roundMetricOrZero(marketHealthScore),
    setupQualityScore: roundMetricOrZero(setupQualityScore),
    opportunityScore: roundMetricOrZero(opportunityScore),
    dataReliabilityScore: roundMetricOrZero(dataReliabilityScore),
    scoreDecayMultiplier,
    isTradable,
    bullishSignalsSuppressed,
    activityStatus,
    activityStatusLabel: getTokenActivityStatusLabel(activityStatus),
  };
}

export function computeTraderTrustScore(args: {
  winRate30d: number | null;
  avgRoi30d: number | null;
  settledCount30d: number | null;
  firstCallCount: number | null;
  firstCallAvgRoi: number | null;
}): number {
  const winScore = pct(args.winRate30d, 85);
  const roiScore = logScore(Math.max(0, finite(args.avgRoi30d)), 350);
  const consistencyScore = pct(args.settledCount30d, 20);
  const firstCallScore = pct(args.firstCallCount, 20);
  const firstCallRoiScore = logScore(Math.max(0, finite(args.firstCallAvgRoi)), 350);

  return clampScore(
    0.35 * winScore +
    0.20 * roiScore +
    0.20 * consistencyScore +
    0.10 * firstCallScore +
    0.15 * firstCallRoiScore
  );
}

export function determineTimingTier(args: {
  firstCallerRank: number | null | undefined;
  ageMinutesSinceFirstCall: number | null | undefined;
  entryMcap: number | null | undefined;
  firstCallEntryMcap: number | null | undefined;
}): string | null {
  const firstCallerRank = finite(args.firstCallerRank, -1);
  const ageMinutesSinceFirstCall = finite(args.ageMinutesSinceFirstCall, Number.POSITIVE_INFINITY);
  const entryMcap = finite(args.entryMcap, 0);
  const firstCallEntryMcap = finite(args.firstCallEntryMcap, 0);

  if (firstCallerRank === 1) return "FIRST CALLER";
  if (
    (firstCallerRank > 0 && firstCallerRank <= 3) ||
    ageMinutesSinceFirstCall <= 30 ||
    (entryMcap > 0 && firstCallEntryMcap > 0 && entryMcap <= firstCallEntryMcap * 1.5)
  ) {
    return "EARLY CALLER";
  }
  if (firstCallerRank > 0) {
    return "LATE CALLER";
  }
  return null;
}
