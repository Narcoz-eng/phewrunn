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
  top10HolderPct: number | null;
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
  tokenRiskScore: number | null;
};

export type EarlyRunnerInputs = {
  distinctTrustedTradersLast6h: number | null;
  liquidityGrowth1hPct: number | null;
  volumeGrowth1hPct: number | null;
  holderGrowth1hPct: number | null;
  momentumPct: number | null;
  sentimentScore: number | null;
  tokenRiskScore: number | null;
};

export type HighConvictionInputs = {
  confidenceScore: number | null;
  traderTrustScore: number | null;
  entryQualityScore: number | null;
  liquidityUsd: number | null;
  sentimentScore: number | null;
  trustedTraderCount: number | null;
  tokenRiskScore: number | null;
};

function finite(value: number | null | undefined, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
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
  if (drawdown >= 85) return 100;
  if (drawdown >= 70) return 90;
  if (drawdown >= 55) return 72;
  if (drawdown >= 40) return 54;
  if (drawdown >= 25) return 34;
  return pct(drawdown, 25) * 0.7;
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

  if (currentRoi <= -85) cap = Math.min(cap, 8);
  else if (currentRoi <= -70) cap = Math.min(cap, 14);
  else if (currentRoi <= -55) cap = Math.min(cap, 22);
  else if (currentRoi <= -40) cap = Math.min(cap, 30);
  else if (currentRoi <= -25) cap = Math.min(cap, 44);

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

  if (currentRoi <= -85) multiplier *= 0.22;
  else if (currentRoi <= -70) multiplier *= 0.34;
  else if (currentRoi <= -55) multiplier *= 0.5;
  else if (currentRoi <= -40) multiplier *= 0.68;
  else if (currentRoi <= -25) multiplier *= 0.84;

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
  const holderHealthScore = inversePct(inputs.top10HolderPct, 70);
  const marketBreadthScore = clampScore(finite(inputs.marketBreadthScore, 50));

  const confidenceScoreRaw =
    0.15 * traderTrustScore +
    0.10 * traderWinRateScore +
    0.07 * traderRoiScore +
    0.13 * entryQualityScore +
    0.09 * liquidityScore +
    0.10 * volumeGrowthScore +
    0.16 * accelerationScore +
    0.07 * confirmationScore +
    0.07 * holderHealthScore +
    0.06 * marketBreadthScore;

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
  const bundlePenalty = pct(inputs.tokenRiskScore, 100);

  const raw =
    0.22 * confidenceScore +
    0.18 * engagementVelocityScore +
    0.14 * earlyGainsScore +
    0.10 * traderTrustScore +
    0.12 * liquidityScore +
    0.10 * sentimentScore +
    0.14 * momentumScore;

  return clampScore(raw - (0.18 * bundlePenalty));
}

export function computeEarlyRunnerScore(inputs: EarlyRunnerInputs): number {
  const trustedTraderClusterScore = pct(inputs.distinctTrustedTradersLast6h, 4);
  const liquidityRiseScore = pct(inputs.liquidityGrowth1hPct, 120);
  const volumeSpikeScore = pct(inputs.volumeGrowth1hPct, 300);
  const holderGrowthScore = pct(inputs.holderGrowth1hPct, 80);
  const momentumScore = pct(inputs.momentumPct, 100);
  const sentimentScore = clampScore(finite(inputs.sentimentScore));
  const riskGate = inversePct(inputs.tokenRiskScore, 100);

  return clampScore(
    0.22 * trustedTraderClusterScore +
    0.18 * liquidityRiseScore +
    0.22 * volumeSpikeScore +
    0.14 * holderGrowthScore +
    0.12 * momentumScore +
    0.07 * sentimentScore +
    0.05 * riskGate
  );
}

export function computeHighConvictionScore(inputs: HighConvictionInputs): number {
  const confidenceScore = clampScore(finite(inputs.confidenceScore));
  const traderTrustScore = clampScore(finite(inputs.traderTrustScore));
  const entryQualityScore = clampScore(finite(inputs.entryQualityScore, 50));
  const liquidityScore = logScore(inputs.liquidityUsd, 250_000);
  const sentimentScore = clampScore(finite(inputs.sentimentScore));
  const confirmationScore = pct(inputs.trustedTraderCount, 5);
  const healthScore = inversePct(inputs.tokenRiskScore, 100);

  return clampScore(
    0.32 * confidenceScore +
    0.18 * traderTrustScore +
    0.10 * entryQualityScore +
    0.12 * liquidityScore +
    0.08 * sentimentScore +
    0.10 * confirmationScore +
    0.10 * healthScore
  );
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
