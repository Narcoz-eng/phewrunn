import { Prisma, type AlertPreference } from "@prisma/client";
import { prisma } from "../../prisma.js";
import {
  applyConfidenceGuardrails,
  buildReactionCounts,
  clampScore,
  computeConfidenceScore,
  computeEarlyRunnerScore,
  computeHighConvictionScore,
  computeHotAlphaScore,
  computeSentimentScore,
  computeWeightedEngagementPerHour,
  determineBundleRiskLabel,
  determineTimingTier,
  type ReactionCounts,
} from "./scoring.js";
import { analyzeSolanaTokenDistribution, fetchDexTokenStats } from "./token-metrics.js";
import { refreshTraderMetrics } from "./trader-metrics.js";
import { fanoutTokenSignalAlerts } from "./alerts.js";

const TOKEN_INTELLIGENCE_STALE_MS = 15 * 60 * 1000;
const TRADER_METRICS_STALE_MS = 6 * 60 * 60 * 1000;
const TOKEN_SNAPSHOT_MIN_INTERVAL_MS = 10 * 60 * 1000;
const DEFAULT_FEED_LIMIT = 20;
const MAX_FEED_LIMIT = 40;
const TRUSTED_TRADER_THRESHOLD = 58;
const HOT_ALPHA_THRESHOLD = 75;
const EARLY_RUNNER_THRESHOLD = 72;
const HIGH_CONVICTION_THRESHOLD = 78;
const FEED_RESULT_CACHE_TTL_MS = 15_000;
const PERSONALIZED_FEED_RESULT_CACHE_TTL_MS = 8_000;
const FOLLOWING_SNAPSHOT_CACHE_TTL_MS = 15_000;
const TOKEN_OVERVIEW_CACHE_TTL_MS = 20_000;
const PERSONALIZED_TOKEN_OVERVIEW_CACHE_TTL_MS = 12_000;
const RADAR_CACHE_TTL_MS = 15_000;
const TRADER_OVERVIEW_CACHE_TTL_MS = 20_000;
const LEADERBOARD_CACHE_TTL_MS = 20_000;
const TOKEN_REFRESH_SOFT_TIMEOUT_MS = 1_200;
const TOKEN_CONFIDENCE_MODEL_UPDATED_AT_MS = Date.parse("2026-03-10T00:00:00.000Z");

const AUTHOR_SELECT = Prisma.validator<Prisma.UserSelect>()({
  id: true,
  name: true,
  username: true,
  image: true,
  level: true,
  xp: true,
  isVerified: true,
  winRate7d: true,
  winRate30d: true,
  avgRoi7d: true,
  avgRoi30d: true,
  trustScore: true,
  reputationTier: true,
  firstCallCount: true,
  firstCallAvgRoi: true,
  lastTraderMetricsAt: true,
});

const TOKEN_SELECT = Prisma.validator<Prisma.TokenSelect>()({
  id: true,
  chainType: true,
  address: true,
  symbol: true,
  name: true,
  imageUrl: true,
  dexscreenerUrl: true,
  launchAt: true,
  pairAddress: true,
  dexId: true,
  liquidity: true,
  volume24h: true,
  holderCount: true,
  largestHolderPct: true,
  top10HolderPct: true,
  deployerSupplyPct: true,
  bundledWalletCount: true,
  bundledClusterCount: true,
  estimatedBundledSupplyPct: true,
  bundleRiskLabel: true,
  tokenRiskScore: true,
  sentimentScore: true,
  radarScore: true,
  confidenceScore: true,
  hotAlphaScore: true,
  earlyRunnerScore: true,
  highConvictionScore: true,
  isEarlyRunner: true,
  earlyRunnerReasons: true,
  lastIntelligenceAt: true,
  updatedAt: true,
});

const CALL_SELECT = Prisma.validator<Prisma.PostSelect>()({
  id: true,
  content: true,
  authorId: true,
  tokenId: true,
  contractAddress: true,
  chainType: true,
  tokenName: true,
  tokenSymbol: true,
  tokenImage: true,
  dexscreenerUrl: true,
  entryMcap: true,
  currentMcap: true,
  mcap1h: true,
  mcap6h: true,
  lastMcapUpdate: true,
  viewCount: true,
  confidenceScore: true,
  hotAlphaScore: true,
  earlyRunnerScore: true,
  highConvictionScore: true,
  timingTier: true,
  firstCallerRank: true,
  roiPeakPct: true,
  roiCurrentPct: true,
  threadCount: true,
  reactionCounts: true,
  trustedTraderCount: true,
  entryQualityScore: true,
  bundlePenaltyScore: true,
  sentimentScore: true,
  lastIntelligenceAt: true,
  settled: true,
  settledAt: true,
  isWin: true,
  createdAt: true,
  updatedAt: true,
  author: { select: AUTHOR_SELECT },
  token: { select: TOKEN_SELECT },
  _count: {
    select: {
      likes: true,
      comments: true,
      reposts: true,
      reactions: true,
    },
  },
});

const THREAD_COMMENT_SELECT = Prisma.validator<Prisma.CommentSelect>()({
  id: true,
  content: true,
  authorId: true,
  postId: true,
  parentId: true,
  rootId: true,
  depth: true,
  kind: true,
  replyCount: true,
  deletedAt: true,
  createdAt: true,
  updatedAt: true,
  author: {
    select: {
      id: true,
      name: true,
      username: true,
      image: true,
      level: true,
      xp: true,
      isVerified: true,
      trustScore: true,
      reputationTier: true,
    },
  },
});

type TokenRecord = Prisma.TokenGetPayload<{ select: typeof TOKEN_SELECT }>;
type CallRecord = Prisma.PostGetPayload<{ select: typeof CALL_SELECT }>;
type ThreadCommentRecord = Prisma.CommentGetPayload<{ select: typeof THREAD_COMMENT_SELECT }>;
type AuthorRecord = CallRecord["author"];

export type FeedKind =
  | "latest"
  | "hot-alpha"
  | "early-runners"
  | "high-conviction"
  | "following";

export type FeedArgs = {
  kind: FeedKind;
  viewerId: string | null;
  limit?: number;
  cursor?: string | null;
  search?: string | null;
};

export type EnrichedCall = CallRecord & {
  isLiked: boolean;
  isReposted: boolean;
  currentReactionType: string | null;
  reactionCounts: ReactionCounts;
  confidenceScore: number;
  hotAlphaScore: number;
  earlyRunnerScore: number;
  highConvictionScore: number;
  timingTier: string | null;
  firstCallerRank: number | null;
  roiPeakPct: number | null;
  roiCurrentPct: number | null;
  threadCount: number;
  trustedTraderCount: number;
  entryQualityScore: number;
  bundlePenaltyScore: number;
  sentimentScore: number;
  tokenRiskScore: number | null;
  bundleRiskLabel: string | null;
  liquidity: number | null;
  volume24h: number | null;
  holderCount: number | null;
  largestHolderPct: number | null;
  top10HolderPct: number | null;
  bundledWalletCount: number | null;
  estimatedBundledSupplyPct: number | null;
  bundleClusters: Array<{
    id: string;
    clusterLabel: string;
    walletCount: number;
    estimatedSupplyPct: number;
    evidenceJson: unknown;
  }>;
  radarReasons: string[];
};

type FeedListResult = {
  items: EnrichedCall[];
  hasMore: boolean;
  nextCursor: string | null;
  totalItems: number;
};

type HydrateCallOptions = {
  refreshTraders?: boolean;
  refreshTokens?: boolean;
  ensureTokenLinks?: boolean;
  persistComputed?: boolean;
};

export type TokenOverview = {
  token: TokenRecord & {
    isFollowing: boolean;
    bundleClusters: Array<{
      id: string;
      clusterLabel: string;
      walletCount: number;
      estimatedSupplyPct: number;
      evidenceJson: unknown;
    }>;
    chart: Array<{
      timestamp: string;
      marketCap: number | null;
      liquidity: number | null;
      volume24h: number | null;
      holderCount: number | null;
      sentimentScore: number | null;
      confidenceScore: number | null;
    }>;
    callsCount: number;
    distinctTraders: number;
    topTraders: Array<{
      id: string;
      name: string;
      username: string | null;
      image: string | null;
      level: number;
      xp: number;
      trustScore: number | null;
      reputationTier: string | null;
      callsCount: number;
      avgConfidenceScore: number;
      bestRoiPct: number;
    }>;
    sentiment: {
      score: number;
      reactions: ReactionCounts;
      bullishPct: number;
      bearishPct: number;
    };
    risk: {
      tokenRiskScore: number | null;
      bundleRiskLabel: string | null;
      largestHolderPct: number | null;
      top10HolderPct: number | null;
      bundledWalletCount: number | null;
      estimatedBundledSupplyPct: number | null;
      deployerSupplyPct: number | null;
      holderCount: number | null;
    };
    timeline: Array<{
      id: string;
      eventType: string;
      timestamp: string;
      marketCap: number | null;
      liquidity: number | null;
      volume: number | null;
      traderId: string | null;
      postId: string | null;
      metadata: unknown;
    }>;
    recentCalls: EnrichedCall[];
  };
};

export type LeaderboardsPayload = {
  topTradersToday: Array<{
    traderId: string;
    handle: string | null;
    name: string;
    image: string | null;
    trustScore: number | null;
    avgRoiPct: number;
    winRatePct: number;
    callsCount: number;
  }>;
  topAlphaToday: EnrichedCall[];
  biggestRoiToday: EnrichedCall[];
  bestEntryToday: EnrichedCall[];
};

type CacheEntry<T> = {
  expiresAt: number;
  value: T;
};

const feedListCache = new Map<string, CacheEntry<FeedListResult>>();
const feedListInFlight = new Map<string, Promise<FeedListResult>>();
const followingSnapshotCache = new Map<
  string,
  CacheEntry<{ followedTraderIds: string[]; followedTokenIds: string[] }>
>();
const tokenOverviewCache = new Map<string, CacheEntry<TokenOverview | null>>();
const tokenOverviewInFlight = new Map<string, Promise<TokenOverview | null>>();
const radarCache = new Map<
  string,
  CacheEntry<Array<{ token: TokenOverview["token"]; score: number }>>
>();
const radarInFlight = new Map<
  string,
  Promise<Array<{ token: TokenOverview["token"]; score: number }>>
>();
const traderOverviewCache = new Map<
  string,
  CacheEntry<
    | {
        trader: {
          id: string;
          name: string;
          username: string | null;
          image: string | null;
          level: number;
          xp: number;
          isVerified: boolean;
          winRate7d: number | null;
          winRate30d: number | null;
          avgRoi7d: number | null;
          avgRoi30d: number | null;
          trustScore: number | null;
          reputationTier: string | null;
          firstCallCount: number;
          firstCallAvgRoi: number | null;
        };
        calls: EnrichedCall[];
        stats: {
          callsCount: number;
          avgConfidenceScore: number;
          avgHotAlphaScore: number;
          avgHighConvictionScore: number;
          firstCallCount: number;
        };
      }
    | null
  >
>();
const traderOverviewInFlight = new Map<
  string,
  Promise<
    | {
        trader: {
          id: string;
          name: string;
          username: string | null;
          image: string | null;
          level: number;
          xp: number;
          isVerified: boolean;
          winRate7d: number | null;
          winRate30d: number | null;
          avgRoi7d: number | null;
          avgRoi30d: number | null;
          trustScore: number | null;
          reputationTier: string | null;
          firstCallCount: number;
          firstCallAvgRoi: number | null;
        };
        calls: EnrichedCall[];
        stats: {
          callsCount: number;
          avgConfidenceScore: number;
          avgHotAlphaScore: number;
          avgHighConvictionScore: number;
          firstCallCount: number;
        };
      }
    | null
  >
>();
const dailyLeaderboardsCache = new Map<string, CacheEntry<LeaderboardsPayload>>();
const dailyLeaderboardsInFlight = new Map<string, Promise<LeaderboardsPayload>>();
const firstCallerLeaderboardsCache = new Map<
  string,
  CacheEntry<
    Array<{
      traderId: string;
      handle: string | null;
      name: string;
      image: string | null;
      trustScore: number | null;
      firstCalls: number;
      firstCallAvgRoi: number | null;
      avgConfidenceScore: number;
    }>
  >
>();
const firstCallerLeaderboardsInFlight = new Map<
  string,
  Promise<
    Array<{
      traderId: string;
      handle: string | null;
      name: string;
      image: string | null;
      trustScore: number | null;
      firstCalls: number;
      firstCallAvgRoi: number | null;
      avgConfidenceScore: number;
    }>
  >
>();

type TokenRefreshResult = {
  token: TokenRecord;
  previousToken: TokenRecord | null;
  refreshed: boolean;
};

function finite(value: number | null | undefined, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function roundMetric(value: number | null | undefined): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.round(value * 100) / 100;
}

function roundMetricOrZero(value: number | null | undefined): number {
  return roundMetric(value) ?? 0;
}

function normalizeChainType(chainType: string | null | undefined): string {
  return chainType === "solana" ? "solana" : "evm";
}

function buildTokenKey(chainType: string | null | undefined, address: string): string {
  return `${normalizeChainType(chainType)}:${address.trim().toLowerCase()}`;
}

function cloneCachedValue<T>(value: T): T {
  if (typeof globalThis.structuredClone === "function") {
    return globalThis.structuredClone(value);
  }
  return value;
}

function readCacheValue<T>(cache: Map<string, CacheEntry<T>>, key: string): T | null {
  const cached = cache.get(key);
  if (!cached) return null;
  if (cached.expiresAt <= Date.now()) {
    cache.delete(key);
    return null;
  }
  return cloneCachedValue(cached.value);
}

function writeCacheValue<T>(cache: Map<string, CacheEntry<T>>, key: string, value: T, ttlMs: number): T {
  cache.set(key, {
    expiresAt: Date.now() + ttlMs,
    value: cloneCachedValue(value),
  });
  return value;
}

async function memoizeCached<T>(
  cache: Map<string, CacheEntry<T>>,
  inFlight: Map<string, Promise<T>>,
  key: string,
  ttlMs: number,
  loader: () => Promise<T>
): Promise<T> {
  const cached = readCacheValue(cache, key);
  if (cached !== null) {
    return cached;
  }

  const currentInFlight = inFlight.get(key);
  if (currentInFlight) {
    return cloneCachedValue(await currentInFlight);
  }

  const promise = loader()
    .then((value) => writeCacheValue(cache, key, value, ttlMs))
    .finally(() => {
      inFlight.delete(key);
    });

  inFlight.set(key, promise);
  return cloneCachedValue(await promise);
}

function sanitizeCacheKeyPart(value: string | null | undefined): string {
  const normalized = value?.trim().toLowerCase();
  return normalized && normalized.length > 0 ? normalized : "-";
}

function buildTokenMapFromRecords(records: CallRecord[]): Map<string, TokenRecord> {
  const tokenMap = new Map<string, TokenRecord>();
  for (const record of records) {
    if (record.token) {
      tokenMap.set(buildTokenKey(record.token.chainType, record.token.address), record.token);
    }
  }
  return tokenMap;
}

function mergeTokenMaps(...maps: Array<Map<string, TokenRecord>>): Map<string, TokenRecord> {
  const merged = new Map<string, TokenRecord>();
  for (const current of maps) {
    for (const [key, value] of current.entries()) {
      merged.set(key, value);
    }
  }
  return merged;
}

async function withSoftTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T | null> {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<null>((resolve) => {
        timeoutId = setTimeout(() => resolve(null), timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}

function growthPct(current: number | null | undefined, previous: number | null | undefined): number {
  const currentValue = finite(current);
  const previousValue = finite(previous);
  if (currentValue <= 0 || previousValue <= 0) return 0;
  return ((currentValue - previousValue) / previousValue) * 100;
}

function deriveRoiPct(entryMcap: number | null | undefined, targetMcap: number | null | undefined): number | null {
  const entry = finite(entryMcap);
  const target = finite(targetMcap);
  if (entry <= 0 || target <= 0) return null;
  return ((target - entry) / entry) * 100;
}

function deriveRoiPeakPct(record: Pick<CallRecord, "entryMcap" | "currentMcap" | "mcap1h" | "mcap6h" | "roiPeakPct">): number | null {
  const candidates = [
    record.roiPeakPct,
    deriveRoiPct(record.entryMcap, record.currentMcap),
    deriveRoiPct(record.entryMcap, record.mcap1h),
    deriveRoiPct(record.entryMcap, record.mcap6h),
  ].filter((value): value is number => typeof value === "number" && Number.isFinite(value));

  if (candidates.length === 0) return null;
  return Math.max(...candidates);
}

function deriveCurrentRoiPct(record: Pick<CallRecord, "entryMcap" | "currentMcap" | "roiCurrentPct">): number | null {
  return record.roiCurrentPct ?? deriveRoiPct(record.entryMcap, record.currentMcap);
}

function shouldRefreshToken(token: TokenRecord | null): boolean {
  if (!token?.lastIntelligenceAt) return true;
  if (token.lastIntelligenceAt.getTime() < TOKEN_CONFIDENCE_MODEL_UPDATED_AT_MS) return true;
  if (finite(token.tokenRiskScore) >= 60 && finite(token.confidenceScore) >= 35) return true;
  return Date.now() - token.lastIntelligenceAt.getTime() > TOKEN_INTELLIGENCE_STALE_MS;
}

function buildRadarReasons(args: {
  distinctTrustedTraders: number;
  volumeGrowthPct: number;
  liquidityGrowthPct: number;
  holderGrowthPct: number;
  momentumPct: number;
  tokenRiskScore: number | null;
}): string[] {
  const reasons: string[] = [];
  if (args.distinctTrustedTraders >= 2) {
    reasons.push(`${args.distinctTrustedTraders} trusted traders called it`);
  }
  if (args.volumeGrowthPct >= 35) {
    reasons.push(`volume up ${roundMetricOrZero(args.volumeGrowthPct)}%`);
  }
  if (args.liquidityGrowthPct >= 20) {
    reasons.push(`liquidity rising ${roundMetricOrZero(args.liquidityGrowthPct)}%`);
  }
  if (args.holderGrowthPct >= 12) {
    reasons.push(`holders up ${roundMetricOrZero(args.holderGrowthPct)}%`);
  }
  if (args.momentumPct >= 20) {
    reasons.push(`momentum at ${roundMetricOrZero(args.momentumPct)}%`);
  }
  if (finite(args.tokenRiskScore, 100) <= 45) {
    reasons.push("risk profile acceptable");
  }
  return reasons.slice(0, 4);
}

function computeEntryQualityScore(args: {
  firstCallerRank: number | null;
  createdAt: Date;
  firstCallCreatedAt: Date | null;
  entryMcap: number | null;
  firstCallEntryMcap: number | null;
}): number {
  const ageMinutes =
    args.firstCallCreatedAt === null
      ? 0
      : Math.max(0, (args.createdAt.getTime() - args.firstCallCreatedAt.getTime()) / (60 * 1000));
  const entryRatio =
    finite(args.entryMcap) > 0 && finite(args.firstCallEntryMcap) > 0
      ? finite(args.entryMcap) / finite(args.firstCallEntryMcap)
      : 1;

  let score = 58;
  if (args.firstCallerRank === 1) score += 28;
  else if (args.firstCallerRank !== null && args.firstCallerRank <= 3) score += 18;
  else if (args.firstCallerRank !== null && args.firstCallerRank <= 5) score += 10;

  if (ageMinutes <= 10) score += 10;
  else if (ageMinutes <= 30) score += 6;
  else if (ageMinutes <= 120) score += 2;
  else score -= 8;

  if (entryRatio <= 1.12) score += 10;
  else if (entryRatio <= 1.3) score += 6;
  else if (entryRatio <= 1.6) score += 2;
  else score -= 10;

  return clampScore(score);
}

async function ensureTokensForCalls(records: CallRecord[]): Promise<Map<string, TokenRecord>> {
  const candidates = records
    .filter((record) => record.contractAddress)
    .map((record) => ({
      key: buildTokenKey(record.chainType, record.contractAddress!),
      chainType: normalizeChainType(record.chainType),
      address: record.contractAddress!,
      symbol: record.tokenSymbol,
      name: record.tokenName,
      imageUrl: record.tokenImage,
      dexscreenerUrl: record.dexscreenerUrl,
      launchAt: record.createdAt,
      liquidity: record.currentMcap,
      volume24h: null as number | null,
    }));

  if (candidates.length === 0) {
    return new Map<string, TokenRecord>();
  }

  const uniqueCandidates = Array.from(
    new Map(candidates.map((candidate) => [candidate.key, candidate])).values()
  );

  const existingTokens = await prisma.token.findMany({
    where: {
      OR: uniqueCandidates.map((candidate) => ({
        chainType: candidate.chainType,
        address: candidate.address,
      })),
    },
    select: TOKEN_SELECT,
  });

  const tokenMap = new Map<string, TokenRecord>();
  for (const token of existingTokens) {
    tokenMap.set(buildTokenKey(token.chainType, token.address), token);
  }

  for (const candidate of uniqueCandidates) {
    if (tokenMap.has(candidate.key)) {
      continue;
    }

    const created = await prisma.token.create({
      data: {
        chainType: candidate.chainType,
        address: candidate.address,
        symbol: candidate.symbol,
        name: candidate.name,
        imageUrl: candidate.imageUrl,
        dexscreenerUrl: candidate.dexscreenerUrl,
        launchAt: candidate.launchAt,
        liquidity: candidate.liquidity,
        volume24h: candidate.volume24h,
      },
      select: TOKEN_SELECT,
    }).catch(() => null);

    if (created) {
      tokenMap.set(candidate.key, created);
    }
  }

  await Promise.all(
    records
      .filter((record) => !record.tokenId && record.contractAddress)
      .map(async (record) => {
        const token = tokenMap.get(buildTokenKey(record.chainType, record.contractAddress!));
        if (!token) return;
        await prisma.post.update({
          where: { id: record.id },
          data: {
            tokenId: token.id,
          },
        }).catch(() => undefined);
      })
  );

  return tokenMap;
}

export async function refreshTokenIntelligence(tokenId: string): Promise<TokenRefreshResult | null> {
  const existing = await prisma.token.findUnique({
    where: { id: tokenId },
    select: TOKEN_SELECT,
  });

  if (!existing) return null;
  if (!shouldRefreshToken(existing)) {
    return {
      token: existing,
      previousToken: existing,
      refreshed: false,
    };
  }

  const [latestSnapshot, recentCalls, reactions, dexStats, distribution, clusters] = await Promise.all([
    prisma.tokenMetricSnapshot.findFirst({
      where: { tokenId },
      orderBy: { capturedAt: "desc" },
      select: {
        id: true,
        capturedAt: true,
        marketCap: true,
        liquidity: true,
        volume24h: true,
        holderCount: true,
        sentimentScore: true,
        confidenceScore: true,
      },
    }),
    prisma.post.findMany({
      where: {
        tokenId,
        createdAt: {
          gte: new Date(Date.now() - 72 * 60 * 60 * 1000),
        },
      },
      select: {
        id: true,
        authorId: true,
        createdAt: true,
        confidenceScore: true,
        hotAlphaScore: true,
        highConvictionScore: true,
        entryMcap: true,
        currentMcap: true,
        author: {
          select: {
            id: true,
            trustScore: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
    }),
    prisma.reaction.findMany({
      where: {
        post: {
          tokenId,
          createdAt: {
            gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
          },
        },
      },
      select: {
        type: true,
      },
    }),
    fetchDexTokenStats(existing.address, existing.chainType).catch(() => null),
    existing.chainType === "solana"
      ? analyzeSolanaTokenDistribution(existing.address, existing.liquidity).catch(() => null)
      : Promise.resolve(null),
    prisma.tokenBundleCluster.findMany({
      where: { tokenId },
      select: {
        id: true,
        clusterLabel: true,
        walletCount: true,
        estimatedSupplyPct: true,
        evidenceJson: true,
      },
      orderBy: [{ estimatedSupplyPct: "desc" }, { clusterLabel: "asc" }],
    }),
  ]);

  const reactionCounts = buildReactionCounts(reactions.map((reaction) => reaction.type));
  const sentimentScore = computeSentimentScore({ reactions: reactionCounts });
  const liquidity = roundMetric(dexStats?.liquidityUsd ?? existing.liquidity);
  const volume24h = roundMetric(dexStats?.volume24hUsd ?? existing.volume24h);
  const marketCap = roundMetric(dexStats?.marketCap ?? existing.liquidity ?? null);
  const holderCount = distribution?.holderCount ?? existing.holderCount;
  const tokenRiskScore = roundMetric(distribution?.tokenRiskScore ?? existing.tokenRiskScore);
  const bundleRiskLabel = distribution?.bundleRiskLabel ?? determineBundleRiskLabel(tokenRiskScore);
  const volumeGrowthPct = growthPct(volume24h, latestSnapshot?.volume24h ?? null);
  const liquidityGrowthPct = growthPct(liquidity, latestSnapshot?.liquidity ?? null);
  const holderGrowthPct = growthPct(holderCount, latestSnapshot?.holderCount ?? null);
  const momentumPct = finite(dexStats?.priceChange24hPct);
  const distinctTrustedTraders = new Set(
    recentCalls
      .filter((call) => finite(call.author.trustScore) >= TRUSTED_TRADER_THRESHOLD)
      .filter((call) => Date.now() - call.createdAt.getTime() <= 6 * 60 * 60 * 1000)
      .map((call) => call.authorId)
  ).size;
  const avgCallConfidence =
    recentCalls.length > 0
      ? recentCalls.reduce((sum, call) => sum + finite(call.confidenceScore), 0) / recentCalls.length
      : 0;
  const avgCurrentRoiPct =
    recentCalls.length > 0
      ? recentCalls.reduce((sum, call) => sum + finite(deriveRoiPct(call.entryMcap, call.currentMcap)), 0) / recentCalls.length
      : null;
  const avgHotAlpha =
    recentCalls.length > 0
      ? recentCalls.reduce((sum, call) => sum + finite(call.hotAlphaScore), 0) / recentCalls.length
      : 0;
  const avgHighConviction =
    recentCalls.length > 0
      ? recentCalls.reduce((sum, call) => sum + finite(call.highConvictionScore), 0) / recentCalls.length
      : 0;
  const earlyRunnerScore = roundMetric(
    computeEarlyRunnerScore({
      distinctTrustedTradersLast6h: distinctTrustedTraders,
      liquidityGrowth1hPct: liquidityGrowthPct,
      volumeGrowth1hPct: volumeGrowthPct,
      holderGrowth1hPct: holderGrowthPct,
      momentumPct,
      sentimentScore,
      tokenRiskScore,
    })
  );
  const tokenConfidenceBaseScore = clampScore(
    avgCallConfidence > 0
      ? avgCallConfidence * 0.72 +
          finite(sentimentScore) * 0.12 +
          Math.max(0, 100 - finite(tokenRiskScore)) * 0.08 +
          clampScore(Math.max(0, momentumPct)) * 0.08
      : 0.34 * Math.max(0, 100 - finite(tokenRiskScore)) +
          0.28 * finite(sentimentScore) +
          0.20 * clampScore(Math.max(0, momentumPct)) +
          0.18 * clampScore(100 - Math.min(100, Math.abs(finite(avgCurrentRoiPct, momentumPct))))
  );
  const confidenceScore = roundMetric(
    applyConfidenceGuardrails({
      baseScore: tokenConfidenceBaseScore,
      tokenRiskScore,
      top10HolderPct: distribution?.top10HolderPct ?? existing.top10HolderPct,
      roiCurrentPct: avgCurrentRoiPct ?? momentumPct,
      sentimentScore,
    })
  );
  const hotAlphaScore = roundMetric(
    clampScore(avgHotAlpha * 0.65 + finite(earlyRunnerScore) * 0.15 + finite(sentimentScore) * 0.1 + clampScore(momentumPct) * 0.1)
  );
  const highConvictionScore = roundMetric(
    clampScore(avgHighConviction * 0.7 + finite(confidenceScore) * 0.2 + Math.max(0, 100 - finite(tokenRiskScore)) * 0.1)
  );
  const radarScore = roundMetric(Math.max(finite(hotAlphaScore), finite(earlyRunnerScore), finite(highConvictionScore)));
  const radarReasons = buildRadarReasons({
    distinctTrustedTraders,
    volumeGrowthPct,
    liquidityGrowthPct,
    holderGrowthPct,
    momentumPct,
    tokenRiskScore,
  });

  await prisma.$transaction(async (tx) => {
    await tx.token.update({
      where: { id: tokenId },
      data: {
        symbol: dexStats?.symbol ?? existing.symbol,
        name: dexStats?.name ?? existing.name,
        imageUrl: dexStats?.imageUrl ?? existing.imageUrl,
        dexscreenerUrl: dexStats?.dexscreenerUrl ?? existing.dexscreenerUrl,
        pairAddress: dexStats?.pairAddress ?? existing.pairAddress,
        dexId: dexStats?.dexId ?? existing.dexId,
        liquidity,
        volume24h,
        holderCount,
        largestHolderPct: roundMetric(distribution?.largestHolderPct ?? existing.largestHolderPct),
        top10HolderPct: roundMetric(distribution?.top10HolderPct ?? existing.top10HolderPct),
        deployerSupplyPct: roundMetric(distribution?.deployerSupplyPct ?? existing.deployerSupplyPct),
        bundledWalletCount: distribution?.bundledWalletCount ?? existing.bundledWalletCount,
        bundledClusterCount: distribution?.bundledClusterCount ?? clusters.length,
        estimatedBundledSupplyPct: roundMetric(distribution?.estimatedBundledSupplyPct ?? existing.estimatedBundledSupplyPct),
        bundleRiskLabel,
        tokenRiskScore,
        sentimentScore: roundMetric(sentimentScore),
        radarScore,
        confidenceScore,
        hotAlphaScore,
        earlyRunnerScore,
        highConvictionScore,
        isEarlyRunner: finite(earlyRunnerScore) >= EARLY_RUNNER_THRESHOLD && finite(tokenRiskScore, 100) <= 55,
        earlyRunnerReasons: radarReasons,
        lastIntelligenceAt: new Date(),
      },
    });

    if (distribution?.clusters) {
      await tx.tokenBundleCluster.deleteMany({ where: { tokenId } });
      if (distribution.clusters.length > 0) {
        await tx.tokenBundleCluster.createMany({
          data: distribution.clusters.map((cluster) => ({
            tokenId,
            clusterLabel: cluster.clusterLabel,
            walletCount: cluster.walletCount,
            estimatedSupplyPct: roundMetricOrZero(cluster.estimatedSupplyPct),
            evidenceJson: cluster.evidenceJson,
          })),
        });
      }
    }

    if (
      !latestSnapshot ||
      Date.now() - latestSnapshot.capturedAt.getTime() >= TOKEN_SNAPSHOT_MIN_INTERVAL_MS
    ) {
      await tx.tokenMetricSnapshot.create({
        data: {
          tokenId,
          marketCap,
          liquidity,
          volume24h,
          holderCount,
          largestHolderPct: roundMetric(distribution?.largestHolderPct ?? existing.largestHolderPct),
          top10HolderPct: roundMetric(distribution?.top10HolderPct ?? existing.top10HolderPct),
          bundledWalletCount: distribution?.bundledWalletCount ?? existing.bundledWalletCount,
          estimatedBundledSupplyPct: roundMetric(distribution?.estimatedBundledSupplyPct ?? existing.estimatedBundledSupplyPct),
          tokenRiskScore,
          sentimentScore: roundMetric(sentimentScore),
          confidenceScore,
          radarScore,
        },
      });
    }

    if (finite(earlyRunnerScore) >= EARLY_RUNNER_THRESHOLD && finite(existing.earlyRunnerScore) < EARLY_RUNNER_THRESHOLD) {
      await tx.tokenEvent.create({
        data: {
          tokenId,
          eventType: "early_runner_detected",
          timestamp: new Date(),
          marketCap,
          liquidity,
          volume: volume24h,
          metadata: { reasons: radarReasons },
        },
      }).catch(() => undefined);
    }

    if (finite(hotAlphaScore) >= HOT_ALPHA_THRESHOLD && finite(existing.hotAlphaScore) < HOT_ALPHA_THRESHOLD) {
      await tx.tokenEvent.create({
        data: {
          tokenId,
          eventType: "hot_alpha_detected",
          timestamp: new Date(),
          marketCap,
          liquidity,
          volume: volume24h,
          metadata: { score: hotAlphaScore },
        },
      }).catch(() => undefined);
    }

    if (
      finite(highConvictionScore) >= HIGH_CONVICTION_THRESHOLD &&
      finite(existing.highConvictionScore) < HIGH_CONVICTION_THRESHOLD
    ) {
      await tx.tokenEvent.create({
        data: {
          tokenId,
          eventType: "high_conviction_detected",
          timestamp: new Date(),
          marketCap,
          liquidity,
          volume: volume24h,
          metadata: { score: highConvictionScore },
        },
      }).catch(() => undefined);
    }
  });

  const refreshedToken = await prisma.token.findUnique({
    where: { id: tokenId },
    select: TOKEN_SELECT,
  });

  if (!refreshedToken) return null;

  await fanoutTokenSignalAlerts({
    token: refreshedToken,
    previousToken: existing,
  }).catch(() => undefined);

  return {
    token: refreshedToken,
    previousToken: existing,
    refreshed: true,
  };
}

async function refreshTokenIntelligenceForMap(tokenMap: Map<string, TokenRecord>): Promise<Map<string, TokenRecord>> {
  if (tokenMap.size === 0) return tokenMap;

  const refreshedEntries = await Promise.all(
    Array.from(tokenMap.values()).map(async (token) => {
      const refreshed = await refreshTokenIntelligence(token.id).catch(() => null);
      return [token.id, refreshed?.token ?? token] as const;
    })
  );

  const byId = new Map<string, TokenRecord>(refreshedEntries);
  const nextMap = new Map<string, TokenRecord>();
  for (const token of byId.values()) {
    nextMap.set(buildTokenKey(token.chainType, token.address), token);
  }
  return nextMap;
}

async function maybeRefreshTraderMetrics(authors: AuthorRecord[]): Promise<void> {
  const staleAuthorIds = authors
    .filter((author) => !author.lastTraderMetricsAt || Date.now() - author.lastTraderMetricsAt.getTime() > TRADER_METRICS_STALE_MS)
    .map((author) => author.id);

  if (staleAuthorIds.length === 0) return;
  await refreshTraderMetrics(staleAuthorIds).catch(() => undefined);
}

async function readSocialState(viewerId: string | null, postIds: string[]): Promise<{
  likedPostIds: Set<string>;
  repostedPostIds: Set<string>;
  reactionByPostId: Map<string, string>;
  reactionCountsByPostId: Map<string, ReactionCounts>;
}> {
  const reactionRows = await prisma.reaction.findMany({
    where: {
      postId: { in: postIds },
    },
    select: {
      postId: true,
      userId: true,
      type: true,
    },
  });

  const reactionCountsByPostId = new Map<string, ReactionCounts>();
  const reactionByPostId = new Map<string, string>();
  for (const reaction of reactionRows) {
    const current = reactionCountsByPostId.get(reaction.postId) ?? buildReactionCounts([]);
    current[reaction.type === "alpha" || reaction.type === "based" || reaction.type === "printed" || reaction.type === "rug" ? reaction.type : "alpha"] += 1;
    reactionCountsByPostId.set(reaction.postId, current);
    if (viewerId && reaction.userId === viewerId && !reactionByPostId.has(reaction.postId)) {
      reactionByPostId.set(reaction.postId, reaction.type);
    }
  }

  if (!viewerId) {
    return {
      likedPostIds: new Set<string>(),
      repostedPostIds: new Set<string>(),
      reactionByPostId,
      reactionCountsByPostId,
    };
  }

  const [likes, reposts] = await Promise.all([
    prisma.like.findMany({
      where: {
        userId: viewerId,
        postId: { in: postIds },
      },
      select: { postId: true },
    }),
    prisma.repost.findMany({
      where: {
        userId: viewerId,
        postId: { in: postIds },
      },
      select: { postId: true },
    }),
  ]);

  return {
    likedPostIds: new Set(likes.map((like) => like.postId)),
    repostedPostIds: new Set(reposts.map((repost) => repost.postId)),
    reactionByPostId,
    reactionCountsByPostId,
  };
}

async function readTokenClusters(tokenIds: string[]): Promise<Map<string, TokenOverview["token"]["bundleClusters"]>> {
  if (tokenIds.length === 0) return new Map();

  const rows = await prisma.tokenBundleCluster.findMany({
    where: { tokenId: { in: tokenIds } },
    select: {
      id: true,
      tokenId: true,
      clusterLabel: true,
      walletCount: true,
      estimatedSupplyPct: true,
      evidenceJson: true,
    },
    orderBy: [{ estimatedSupplyPct: "desc" }, { clusterLabel: "asc" }],
  });

  const byTokenId = new Map<string, TokenOverview["token"]["bundleClusters"]>();
  for (const row of rows) {
    const bucket = byTokenId.get(row.tokenId) ?? [];
    bucket.push({
      id: row.id,
      clusterLabel: row.clusterLabel,
      walletCount: row.walletCount,
      estimatedSupplyPct: row.estimatedSupplyPct,
      evidenceJson: row.evidenceJson,
    });
    byTokenId.set(row.tokenId, bucket);
  }
  return byTokenId;
}

async function hydrateCalls(
  records: CallRecord[],
  viewerId: string | null,
  options: HydrateCallOptions = {}
): Promise<EnrichedCall[]> {
  if (records.length === 0) return [];

  const {
    refreshTraders = false,
    refreshTokens = false,
    ensureTokenLinks = false,
    persistComputed = false,
  } = options;

  if (refreshTraders) {
    await maybeRefreshTraderMetrics(records.map((record) => record.author));
  }

  let tokenMap = buildTokenMapFromRecords(records);
  if (ensureTokenLinks) {
    tokenMap = mergeTokenMaps(tokenMap, await ensureTokensForCalls(records));
  }
  if (refreshTokens && tokenMap.size > 0) {
    tokenMap = mergeTokenMaps(tokenMap, await refreshTokenIntelligenceForMap(tokenMap));
  }

  const tokenIds = Array.from(
    new Set(
      records
        .map((record) => record.tokenId ?? record.token?.id ?? null)
        .filter((value): value is string => Boolean(value))
    )
  );
  const relatedCalls = tokenIds.length > 0
    ? await prisma.post.findMany({
        where: {
          tokenId: { in: tokenIds },
          createdAt: {
            gte: new Date(Date.now() - 48 * 60 * 60 * 1000),
          },
        },
        select: {
          id: true,
          tokenId: true,
          authorId: true,
          createdAt: true,
          entryMcap: true,
          confidenceScore: true,
          author: {
            select: {
              trustScore: true,
            },
          },
        },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      })
    : [];

  const socialState = await readSocialState(viewerId, records.map((record) => record.id));
  const bundleClustersByTokenId = await readTokenClusters(
    Array.from(new Set(Array.from(tokenMap.values()).map((token) => token.id)))
  );

  const callsByTokenId = new Map<string, typeof relatedCalls>();
  for (const call of relatedCalls) {
    if (!call.tokenId) continue;
    const bucket = callsByTokenId.get(call.tokenId) ?? [];
    bucket.push(call);
    callsByTokenId.set(call.tokenId, bucket);
  }

  const enriched: EnrichedCall[] = [];
  const postIntelligenceUpdates: Promise<unknown>[] = [];
  for (const record of records) {
    const key = record.contractAddress ? buildTokenKey(record.chainType, record.contractAddress) : null;
    const token = key ? tokenMap.get(key) ?? record.token ?? null : record.token ?? null;
    const resolvedTokenId = record.tokenId ?? token?.id ?? null;
    const tokenCalls = resolvedTokenId ? callsByTokenId.get(resolvedTokenId) ?? [] : [];
    const sameTokenIndex = tokenCalls.findIndex((call) => call.id === record.id);
    const firstCallerRank = sameTokenIndex >= 0 ? sameTokenIndex + 1 : record.firstCallerRank ?? null;
    const firstCall = tokenCalls[0] ?? null;
    const distinctTrustedTraders = new Set(
      tokenCalls
        .filter((call) => Date.now() - call.createdAt.getTime() <= 6 * 60 * 60 * 1000)
        .filter((call) => finite(call.author.trustScore) >= TRUSTED_TRADER_THRESHOLD)
        .map((call) => call.authorId)
    ).size;
    const trustedTraderCount = new Set(
      tokenCalls
        .filter((call) => finite(call.author.trustScore) >= TRUSTED_TRADER_THRESHOLD)
        .map((call) => call.authorId)
    ).size;
    const reactionCounts = socialState.reactionCountsByPostId.get(record.id) ?? buildReactionCounts([]);
    const sentimentScore = roundMetricOrZero(
      computeSentimentScore({
        reactions: reactionCounts,
      })
    );
    const roiPeakPct = roundMetric(record.roiPeakPct ?? deriveRoiPeakPct(record));
    const roiCurrentPct = roundMetric(record.roiCurrentPct ?? deriveCurrentRoiPct(record));
    const entryQualityScore = roundMetricOrZero(
      record.entryQualityScore ??
        computeEntryQualityScore({
          firstCallerRank,
          createdAt: record.createdAt,
          firstCallCreatedAt: firstCall?.createdAt ?? null,
          entryMcap: record.entryMcap,
          firstCallEntryMcap: firstCall?.entryMcap ?? null,
        })
    );
    const confidenceScore = roundMetricOrZero(
      computeConfidenceScore({
        traderWinRate30d: record.author.winRate30d,
        traderAvgRoi30d: record.author.avgRoi30d,
        traderTrustScore: record.author.trustScore,
        entryQualityScore,
        liquidityUsd: token?.liquidity ?? record.currentMcap,
        volumeGrowth24hPct: 0,
        momentumPct: roiCurrentPct ?? 0,
        trustedTraderCount,
        top10HolderPct: token?.top10HolderPct ?? null,
        tokenRiskScore: token?.tokenRiskScore ?? null,
        roiCurrentPct,
        sentimentScore,
      })
    );
    const weightedEngagementPerHour = computeWeightedEngagementPerHour({
      reactions: reactionCounts,
      threadReplies: record.threadCount ?? record._count.comments,
      ageHours: Math.max(0.2, (Date.now() - record.createdAt.getTime()) / (60 * 60 * 1000)),
    });
    const hotAlphaScore = roundMetricOrZero(
      computeHotAlphaScore({
        confidenceScore,
        weightedEngagementPerHour,
        earlyGainsPct: roiCurrentPct,
        traderTrustScore: record.author.trustScore,
        liquidityUsd: token?.liquidity ?? record.currentMcap,
        sentimentScore,
        momentumPct: token?.hotAlphaScore ?? roiCurrentPct ?? 0,
        tokenRiskScore: token?.tokenRiskScore ?? null,
      })
    );
    const earlyRunnerScore = roundMetricOrZero(
      computeEarlyRunnerScore({
        distinctTrustedTradersLast6h: distinctTrustedTraders,
        liquidityGrowth1hPct: 0,
        volumeGrowth1hPct: 0,
        holderGrowth1hPct: 0,
        momentumPct: token?.earlyRunnerScore ?? roiCurrentPct ?? 0,
        sentimentScore,
        tokenRiskScore: token?.tokenRiskScore ?? null,
      })
    );
    const highConvictionScore = roundMetricOrZero(
      computeHighConvictionScore({
        confidenceScore,
        traderTrustScore: record.author.trustScore,
        entryQualityScore,
        liquidityUsd: token?.liquidity ?? record.currentMcap,
        sentimentScore,
        trustedTraderCount,
        tokenRiskScore: token?.tokenRiskScore ?? null,
      })
    );
    const timingTier =
      record.timingTier ??
      determineTimingTier({
        firstCallerRank,
        ageMinutesSinceFirstCall:
          firstCall ? Math.max(0, (record.createdAt.getTime() - firstCall.createdAt.getTime()) / (60 * 1000)) : null,
        entryMcap: record.entryMcap,
        firstCallEntryMcap: firstCall?.entryMcap ?? null,
      });
    const bundlePenaltyScore = roundMetric(record.bundlePenaltyScore ?? token?.tokenRiskScore ?? null) ?? 0;
    const radarReasons = buildRadarReasons({
      distinctTrustedTraders,
      volumeGrowthPct: 0,
      liquidityGrowthPct: 0,
      holderGrowthPct: 0,
      momentumPct: roiCurrentPct ?? 0,
      tokenRiskScore: token?.tokenRiskScore ?? null,
    });

    enriched.push({
      ...record,
      token,
      isLiked: socialState.likedPostIds.has(record.id),
      isReposted: socialState.repostedPostIds.has(record.id),
      currentReactionType: socialState.reactionByPostId.get(record.id) ?? null,
      reactionCounts,
      confidenceScore,
      hotAlphaScore,
      earlyRunnerScore,
      highConvictionScore,
      timingTier,
      firstCallerRank,
      roiPeakPct,
      roiCurrentPct,
      threadCount: record.threadCount ?? record._count.comments,
      trustedTraderCount,
      entryQualityScore,
      bundlePenaltyScore,
      sentimentScore,
      tokenRiskScore: token?.tokenRiskScore ?? null,
      bundleRiskLabel: token?.bundleRiskLabel ?? null,
      liquidity: token?.liquidity ?? null,
      volume24h: token?.volume24h ?? null,
      holderCount: token?.holderCount ?? null,
      largestHolderPct: token?.largestHolderPct ?? null,
      top10HolderPct: token?.top10HolderPct ?? null,
      bundledWalletCount: token?.bundledWalletCount ?? null,
      estimatedBundledSupplyPct: token?.estimatedBundledSupplyPct ?? null,
      bundleClusters: token ? bundleClustersByTokenId.get(token.id) ?? [] : [],
      radarReasons,
    });

    if (persistComputed) {
      postIntelligenceUpdates.push(
        prisma.post.update({
          where: { id: record.id },
          data: {
            confidenceScore,
            hotAlphaScore,
            earlyRunnerScore,
            highConvictionScore,
            timingTier,
            firstCallerRank,
            roiPeakPct,
            roiCurrentPct,
            threadCount: record.threadCount ?? record._count.comments,
            reactionCounts: reactionCounts as Prisma.InputJsonValue,
            trustedTraderCount,
            entryQualityScore,
            bundlePenaltyScore,
            sentimentScore,
            lastIntelligenceAt: new Date(),
          },
        }).catch(() => undefined)
      );
    }
  }

  if (postIntelligenceUpdates.length > 0) {
    await Promise.allSettled(postIntelligenceUpdates);
  }

  return enriched;
}

function buildSearchWhere(search: string | null | undefined): Prisma.PostWhereInput | undefined {
  const term = search?.trim();
  if (!term) return undefined;
  return {
    OR: [
      { content: { contains: term, mode: "insensitive" } },
      { contractAddress: { contains: term, mode: "insensitive" } },
      { tokenName: { contains: term, mode: "insensitive" } },
      { tokenSymbol: { contains: term, mode: "insensitive" } },
      { author: { name: { contains: term, mode: "insensitive" } } },
      { author: { username: { contains: term, mode: "insensitive" } } },
    ],
  };
}

async function getFollowingSnapshot(viewerId: string | null): Promise<{
  followedTraderIds: string[];
  followedTokenIds: string[];
}> {
  if (!viewerId) {
    return { followedTraderIds: [], followedTokenIds: [] };
  }

  const cacheKey = viewerId;
  const cached = readCacheValue(followingSnapshotCache, cacheKey);
  if (cached) {
    return cached;
  }

  const [follows, tokenFollows] = await Promise.all([
    prisma.follow.findMany({
      where: { followerId: viewerId },
      select: { followingId: true },
    }),
    prisma.tokenFollow.findMany({
      where: { userId: viewerId },
      select: { tokenId: true },
    }),
  ]);

  return writeCacheValue(followingSnapshotCache, cacheKey, {
    followedTraderIds: follows.map((follow) => follow.followingId),
    followedTokenIds: tokenFollows.map((follow) => follow.tokenId),
  }, FOLLOWING_SNAPSHOT_CACHE_TTL_MS);
}

function sortCalls(kind: FeedKind, calls: EnrichedCall[]): EnrichedCall[] {
  const sorted = [...calls];
  if (kind === "latest" || kind === "following") {
    return sorted.sort((left, right) => {
      const delta = right.createdAt.getTime() - left.createdAt.getTime();
      return delta !== 0 ? delta : right.id.localeCompare(left.id);
    });
  }

  if (kind === "hot-alpha") {
    return sorted.sort((left, right) => {
      const scoreDelta = right.hotAlphaScore - left.hotAlphaScore;
      if (scoreDelta !== 0) return scoreDelta;
      return right.createdAt.getTime() - left.createdAt.getTime();
    });
  }

  if (kind === "early-runners") {
    return sorted.sort((left, right) => {
      const scoreDelta = right.earlyRunnerScore - left.earlyRunnerScore;
      if (scoreDelta !== 0) return scoreDelta;
      return right.createdAt.getTime() - left.createdAt.getTime();
    });
  }

  return sorted.sort((left, right) => {
    const scoreDelta = right.highConvictionScore - left.highConvictionScore;
    if (scoreDelta !== 0) return scoreDelta;
    return right.createdAt.getTime() - left.createdAt.getTime();
  });
}

export async function listFeedCalls(args: FeedArgs): Promise<FeedListResult> {
  const limit = Math.max(1, Math.min(MAX_FEED_LIMIT, args.limit ?? DEFAULT_FEED_LIMIT));
  const viewerKey = args.viewerId ?? "anonymous";
  const searchKey = sanitizeCacheKeyPart(args.search);
  const cursorKey = sanitizeCacheKeyPart(args.cursor);
  const cacheKey = `feed:${args.kind}:${viewerKey}:${searchKey}:${cursorKey}:${limit}`;
  const ttlMs =
    args.kind === "following" || args.viewerId
      ? PERSONALIZED_FEED_RESULT_CACHE_TTL_MS
      : FEED_RESULT_CACHE_TTL_MS;

  return memoizeCached(feedListCache, feedListInFlight, cacheKey, ttlMs, async () => {
    const { followedTraderIds, followedTokenIds } = await getFollowingSnapshot(args.viewerId);
    if (args.kind === "following" && followedTraderIds.length === 0 && followedTokenIds.length === 0) {
      return {
        items: [],
        hasMore: false,
        nextCursor: null,
        totalItems: 0,
      };
    }

    const where: Prisma.PostWhereInput = {
      ...(buildSearchWhere(args.search) ?? {}),
    };

    if (args.kind === "following") {
      where.OR = [
        ...(followedTraderIds.length > 0 ? [{ authorId: { in: followedTraderIds } }] : []),
        ...(followedTokenIds.length > 0 ? [{ tokenId: { in: followedTokenIds } }] : []),
      ];
    } else if (args.kind !== "latest") {
      where.createdAt = {
        gte: new Date(Date.now() - 72 * 60 * 60 * 1000),
      };
    }

    const candidateLimit = args.kind === "latest" || args.kind === "following" ? limit * 4 : limit * 8;
    const records = await prisma.post.findMany({
      where,
      select: CALL_SELECT,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: Math.min(200, Math.max(limit + 1, candidateLimit)),
    });

    const hydrated = sortCalls(
      args.kind,
      await hydrateCalls(records, args.viewerId, {
        refreshTraders: false,
        refreshTokens: false,
        ensureTokenLinks: false,
        persistComputed: false,
      })
    );
    const startIndex = args.cursor
      ? Math.max(0, hydrated.findIndex((item) => item.id === args.cursor) + 1)
      : 0;
    const items = hydrated.slice(startIndex, startIndex + limit);
    const nextCursor =
      items.length === limit && hydrated[startIndex + limit]
        ? items[items.length - 1]?.id ?? null
        : null;

    return {
      items,
      hasMore: startIndex + limit < hydrated.length,
      nextCursor,
      totalItems: hydrated.length,
    };
  });
}

export async function getEnrichedCallById(id: string, viewerId: string | null): Promise<EnrichedCall | null> {
  const record = await prisma.post.findUnique({
    where: { id },
    select: CALL_SELECT,
  });

  if (!record) return null;
  const [call] = await hydrateCalls([record], viewerId, {
    refreshTraders: false,
    refreshTokens: false,
    ensureTokenLinks: false,
    persistComputed: false,
  });
  return call ?? null;
}

export async function listThreadForCall(postId: string): Promise<ThreadCommentRecord[]> {
  return prisma.comment.findMany({
    where: {
      postId,
      deletedAt: null,
    },
    select: THREAD_COMMENT_SELECT,
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
}

async function findTokenByAddress(address: string): Promise<TokenRecord | null> {
  const normalizedAddress = address.trim();
  const token = await prisma.token.findFirst({
    where: {
      address: normalizedAddress,
    },
    select: TOKEN_SELECT,
    orderBy: { updatedAt: "desc" },
  });

  if (token) {
    return token;
  }

  const post = await prisma.post.findFirst({
    where: {
      contractAddress: normalizedAddress,
    },
    select: CALL_SELECT,
    orderBy: { createdAt: "desc" },
  });

  if (!post) return null;
  const tokenMap = await ensureTokensForCalls([post]);
  const key = buildTokenKey(post.chainType, normalizedAddress);
  return tokenMap.get(key) ?? null;
}

export async function getTokenOverviewByAddress(address: string, viewerId: string | null): Promise<TokenOverview | null> {
  const normalizedAddress = address.trim();
  const cacheKey = `token:${viewerId ?? "anonymous"}:${sanitizeCacheKeyPart(normalizedAddress)}`;
  const ttlMs = viewerId ? PERSONALIZED_TOKEN_OVERVIEW_CACHE_TTL_MS : TOKEN_OVERVIEW_CACHE_TTL_MS;

  return memoizeCached(tokenOverviewCache, tokenOverviewInFlight, cacheKey, ttlMs, async () => {
    const token = await findTokenByAddress(normalizedAddress);
    if (!token) return null;

    const refreshPromise = shouldRefreshToken(token)
      ? refreshTokenIntelligence(token.id).catch(() => null)
      : null;
    const refreshed = refreshPromise
      ? await withSoftTimeout(refreshPromise, TOKEN_REFRESH_SOFT_TIMEOUT_MS)
      : null;
    const currentToken = refreshed?.token ?? token;

    const [callsRaw, clusters, snapshots, events, tokenFollow] = await Promise.all([
      prisma.post.findMany({
        where: { tokenId: currentToken.id },
        select: CALL_SELECT,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 40,
      }),
      prisma.tokenBundleCluster.findMany({
        where: { tokenId: currentToken.id },
        select: {
          id: true,
          clusterLabel: true,
          walletCount: true,
          estimatedSupplyPct: true,
          evidenceJson: true,
        },
        orderBy: [{ estimatedSupplyPct: "desc" }, { clusterLabel: "asc" }],
      }),
      prisma.tokenMetricSnapshot.findMany({
        where: { tokenId: currentToken.id },
        select: {
          capturedAt: true,
          marketCap: true,
          liquidity: true,
          volume24h: true,
          holderCount: true,
          sentimentScore: true,
          confidenceScore: true,
        },
        orderBy: { capturedAt: "asc" },
        take: 96,
      }),
      prisma.tokenEvent.findMany({
        where: { tokenId: currentToken.id },
        select: {
          id: true,
          eventType: true,
          timestamp: true,
          marketCap: true,
          liquidity: true,
          volume: true,
          traderId: true,
          postId: true,
          metadata: true,
        },
        orderBy: { timestamp: "desc" },
        take: 48,
      }),
      viewerId
        ? prisma.tokenFollow.findUnique({
            where: {
              userId_tokenId: {
                userId: viewerId,
                tokenId: currentToken.id,
              },
            },
            select: { id: true },
          })
        : Promise.resolve(null),
    ]);

    const recentCalls = await hydrateCalls(callsRaw, viewerId, {
      refreshTraders: false,
      refreshTokens: false,
      ensureTokenLinks: false,
      persistComputed: false,
    });
    const allReactionCounts = recentCalls.reduce(
      (acc, call) => {
        acc.alpha += call.reactionCounts.alpha;
        acc.based += call.reactionCounts.based;
        acc.printed += call.reactionCounts.printed;
        acc.rug += call.reactionCounts.rug;
        return acc;
      },
      buildReactionCounts([])
    );
    const totalSentimentReactions =
      allReactionCounts.alpha + allReactionCounts.based + allReactionCounts.printed + allReactionCounts.rug;
    const bullishReactions =
      allReactionCounts.alpha + allReactionCounts.based + allReactionCounts.printed;
    const bearishReactions = allReactionCounts.rug;
    const sentimentScore = roundMetricOrZero(
      currentToken.sentimentScore ?? computeSentimentScore({ reactions: allReactionCounts })
    );

    const topTraderMap = new Map<
      string,
      {
        id: string;
        name: string;
        username: string | null;
        image: string | null;
        level: number;
        xp: number;
        trustScore: number | null;
        reputationTier: string | null;
        callsCount: number;
        totalConfidence: number;
        bestRoiPct: number;
      }
    >();

    for (const call of recentCalls) {
      const current = topTraderMap.get(call.author.id) ?? {
        id: call.author.id,
        name: call.author.name,
        username: call.author.username,
        image: call.author.image,
        level: call.author.level,
        xp: call.author.xp,
        trustScore: call.author.trustScore,
        reputationTier: call.author.reputationTier,
        callsCount: 0,
        totalConfidence: 0,
        bestRoiPct: -100,
      };
      current.callsCount += 1;
      current.totalConfidence += call.confidenceScore;
      current.bestRoiPct = Math.max(current.bestRoiPct, finite(call.roiPeakPct, -100));
      topTraderMap.set(call.author.id, current);
    }

    const topTraders = Array.from(topTraderMap.values())
      .map((entry) => ({
        ...entry,
        avgConfidenceScore: entry.callsCount > 0 ? roundMetricOrZero(entry.totalConfidence / entry.callsCount) : 0,
        bestRoiPct: roundMetricOrZero(entry.bestRoiPct),
      }))
      .sort((left, right) => {
        const trustDelta = finite(right.trustScore) - finite(left.trustScore);
        if (trustDelta !== 0) return trustDelta;
        return right.avgConfidenceScore - left.avgConfidenceScore;
      })
      .slice(0, 8);

    const derivedTimeline = recentCalls.slice(0, 12).map((call) => ({
      id: `call:${call.id}`,
      eventType: "alpha_call",
      timestamp: call.createdAt.toISOString(),
      marketCap: call.entryMcap,
      liquidity: call.liquidity,
      volume: call.volume24h,
      traderId: call.author.id,
      postId: call.id,
      metadata: {
        traderHandle: call.author.username,
        traderName: call.author.name,
        timingTier: call.timingTier,
        confidenceScore: call.confidenceScore,
      },
    }));

    return {
      token: {
        ...currentToken,
        isFollowing: Boolean(tokenFollow),
        bundleClusters: clusters,
        chart: snapshots.map((snapshot) => ({
          timestamp: snapshot.capturedAt.toISOString(),
          marketCap: snapshot.marketCap,
          liquidity: snapshot.liquidity,
          volume24h: snapshot.volume24h,
          holderCount: snapshot.holderCount,
          sentimentScore: snapshot.sentimentScore,
          confidenceScore: snapshot.confidenceScore,
        })),
        callsCount: recentCalls.length,
        distinctTraders: topTraderMap.size,
        topTraders,
        sentiment: {
          score: sentimentScore,
          reactions: allReactionCounts,
          bullishPct: totalSentimentReactions > 0 ? roundMetricOrZero((bullishReactions / totalSentimentReactions) * 100) : 0,
          bearishPct: totalSentimentReactions > 0 ? roundMetricOrZero((bearishReactions / totalSentimentReactions) * 100) : 0,
        },
        risk: {
          tokenRiskScore: currentToken.tokenRiskScore,
          bundleRiskLabel: currentToken.bundleRiskLabel,
          largestHolderPct: currentToken.largestHolderPct,
          top10HolderPct: currentToken.top10HolderPct,
          bundledWalletCount: currentToken.bundledWalletCount,
          estimatedBundledSupplyPct: currentToken.estimatedBundledSupplyPct,
          deployerSupplyPct: currentToken.deployerSupplyPct,
          holderCount: currentToken.holderCount,
        },
        timeline: [
          ...events.map((event) => ({
            ...event,
            timestamp: event.timestamp.toISOString(),
          })),
          ...derivedTimeline,
        ]
          .sort((left, right) => new Date(right.timestamp).getTime() - new Date(left.timestamp).getTime())
          .slice(0, 48),
        recentCalls,
      },
    };
  });
}

export async function listTokenCallsByAddress(address: string, viewerId: string | null): Promise<EnrichedCall[]> {
  const token = await findTokenByAddress(address);
  if (!token) return [];
  const records = await prisma.post.findMany({
    where: { tokenId: token.id },
    select: CALL_SELECT,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: 50,
  });
  return hydrateCalls(records, viewerId, {
    refreshTraders: false,
    refreshTokens: false,
    ensureTokenLinks: false,
    persistComputed: false,
  });
}

export async function listRadarTokens(kind: "early-runners" | "hot-alpha" | "high-conviction", viewerId: string | null): Promise<Array<{
  token: TokenOverview["token"];
  score: number;
}>> {
  const cacheKey = `radar:${kind}:${viewerId ?? "anonymous"}`;
  return memoizeCached(radarCache, radarInFlight, cacheKey, RADAR_CACHE_TTL_MS, async () => {
    const field =
      kind === "early-runners"
        ? "earlyRunnerScore"
        : kind === "hot-alpha"
          ? "hotAlphaScore"
          : "highConvictionScore";

    const tokens = await prisma.token.findMany({
      where: {
        [field]: {
          gte: kind === "hot-alpha" ? 55 : 50,
        },
      },
      select: TOKEN_SELECT,
      orderBy: [{ [field]: "desc" }, { updatedAt: "desc" }],
      take: 18,
    });

    const overviews = await Promise.all(
      tokens.map(async (token) => {
        const overview = await getTokenOverviewByAddress(token.address, viewerId);
        return overview?.token ?? null;
      })
    );

    return overviews
      .filter((token): token is TokenOverview["token"] => token !== null)
      .map((token) => ({
        token,
        score: finite(token[field]),
      }))
      .sort((left, right) => right.score - left.score);
  });
}

export async function getTraderOverview(handle: string, viewerId: string | null): Promise<{
  trader: {
    id: string;
    name: string;
    username: string | null;
    image: string | null;
    level: number;
    xp: number;
    isVerified: boolean;
    winRate7d: number | null;
    winRate30d: number | null;
    avgRoi7d: number | null;
    avgRoi30d: number | null;
    trustScore: number | null;
    reputationTier: string | null;
    firstCallCount: number;
    firstCallAvgRoi: number | null;
  };
  calls: EnrichedCall[];
  stats: {
    callsCount: number;
    avgConfidenceScore: number;
    avgHotAlphaScore: number;
    avgHighConvictionScore: number;
    firstCallCount: number;
  };
} | null> {
  const cacheKey = `trader:${viewerId ?? "anonymous"}:${sanitizeCacheKeyPart(handle)}`;
  return memoizeCached(traderOverviewCache, traderOverviewInFlight, cacheKey, TRADER_OVERVIEW_CACHE_TTL_MS, async () => {
    const user = await prisma.user.findFirst({
      where: {
        OR: [{ id: handle }, { username: handle }],
      },
      select: AUTHOR_SELECT,
    });

    if (!user) return null;
    void maybeRefreshTraderMetrics([user]).catch(() => undefined);

    const callsRaw = await prisma.post.findMany({
      where: { authorId: user.id },
      select: CALL_SELECT,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 50,
    });
    const calls = await hydrateCalls(callsRaw, viewerId, {
      refreshTraders: false,
      refreshTokens: false,
      ensureTokenLinks: false,
      persistComputed: false,
    });
    const firstCallCount = calls.filter((call) => call.firstCallerRank === 1).length;

    return {
      trader: {
        id: user.id,
        name: user.name,
        username: user.username,
        image: user.image,
        level: user.level,
        xp: user.xp,
        isVerified: user.isVerified,
        winRate7d: user.winRate7d,
        winRate30d: user.winRate30d,
        avgRoi7d: user.avgRoi7d,
        avgRoi30d: user.avgRoi30d,
        trustScore: user.trustScore,
        reputationTier: user.reputationTier,
        firstCallCount: user.firstCallCount,
        firstCallAvgRoi: user.firstCallAvgRoi,
      },
      calls,
      stats: {
        callsCount: calls.length,
        avgConfidenceScore: calls.length > 0 ? roundMetricOrZero(calls.reduce((sum, call) => sum + call.confidenceScore, 0) / calls.length) : 0,
        avgHotAlphaScore: calls.length > 0 ? roundMetricOrZero(calls.reduce((sum, call) => sum + call.hotAlphaScore, 0) / calls.length) : 0,
        avgHighConvictionScore: calls.length > 0 ? roundMetricOrZero(calls.reduce((sum, call) => sum + call.highConvictionScore, 0) / calls.length) : 0,
        firstCallCount,
      },
    };
  });
}

export async function listDailyLeaderboards(viewerId: string | null): Promise<LeaderboardsPayload> {
  const cacheKey = `leaderboards:daily:${viewerId ?? "anonymous"}`;
  return memoizeCached(dailyLeaderboardsCache, dailyLeaderboardsInFlight, cacheKey, LEADERBOARD_CACHE_TTL_MS, async () => {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    const todaysCallsRaw = await prisma.post.findMany({
      where: {
        createdAt: {
          gte: startOfDay,
        },
      },
      select: CALL_SELECT,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 120,
    });

    const todaysCalls = await hydrateCalls(todaysCallsRaw, viewerId, {
      refreshTraders: false,
      refreshTokens: false,
      ensureTokenLinks: false,
      persistComputed: false,
    });
    const traderMap = new Map<string, LeaderboardsPayload["topTradersToday"][number] & { wins: number }>();

    for (const call of todaysCalls) {
      const current = traderMap.get(call.author.id) ?? {
        traderId: call.author.id,
        handle: call.author.username,
        name: call.author.name,
        image: call.author.image,
        trustScore: call.author.trustScore,
        avgRoiPct: 0,
        winRatePct: 0,
        callsCount: 0,
        wins: 0,
      };
      current.callsCount += 1;
      current.avgRoiPct += finite(call.roiPeakPct);
      if (call.isWin) {
        current.wins += 1;
      }
      traderMap.set(call.author.id, current);
    }

    const topTradersToday = Array.from(traderMap.values())
      .map((entry) => ({
        traderId: entry.traderId,
        handle: entry.handle,
        name: entry.name,
        image: entry.image,
        trustScore: entry.trustScore,
        avgRoiPct: entry.callsCount > 0 ? roundMetricOrZero(entry.avgRoiPct / entry.callsCount) : 0,
        winRatePct: entry.callsCount > 0 ? roundMetricOrZero((entry.wins / entry.callsCount) * 100) : 0,
        callsCount: entry.callsCount,
      }))
      .sort((left, right) => {
        const roiDelta = right.avgRoiPct - left.avgRoiPct;
        if (roiDelta !== 0) return roiDelta;
        return right.winRatePct - left.winRatePct;
      })
      .slice(0, 12);

    return {
      topTradersToday,
      topAlphaToday: [...todaysCalls].sort((left, right) => right.hotAlphaScore - left.hotAlphaScore).slice(0, 12),
      biggestRoiToday: [...todaysCalls].sort((left, right) => finite(right.roiPeakPct, -100) - finite(left.roiPeakPct, -100)).slice(0, 12),
      bestEntryToday: [...todaysCalls]
        .filter((call) => call.firstCallerRank === 1 || call.timingTier === "FIRST CALLER")
        .sort((left, right) => finite(right.roiPeakPct, -100) - finite(left.roiPeakPct, -100))
        .slice(0, 12),
    };
  });
}

export async function listFirstCallerLeaderboards(viewerId: string | null): Promise<Array<{
  traderId: string;
  handle: string | null;
  name: string;
  image: string | null;
  trustScore: number | null;
  firstCalls: number;
  firstCallAvgRoi: number | null;
  avgConfidenceScore: number;
}>> {
  const cacheKey = `leaderboards:first-callers:${viewerId ?? "anonymous"}`;
  return memoizeCached(
    firstCallerLeaderboardsCache,
    firstCallerLeaderboardsInFlight,
    cacheKey,
    LEADERBOARD_CACHE_TTL_MS,
    async () => {
      const traders = await prisma.user.findMany({
        where: {
          firstCallCount: {
            gt: 0,
          },
        },
        select: AUTHOR_SELECT,
        orderBy: [{ firstCallCount: "desc" }, { trustScore: "desc" }],
        take: 24,
      });

      const callsRaw = await prisma.post.findMany({
        where: {
          authorId: { in: traders.map((trader) => trader.id) },
          firstCallerRank: 1,
        },
        select: CALL_SELECT,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 160,
      });
      const calls = await hydrateCalls(callsRaw, viewerId, {
        refreshTraders: false,
        refreshTokens: false,
        ensureTokenLinks: false,
        persistComputed: false,
      });
      const confidenceByTrader = new Map<string, { total: number; count: number }>();
      for (const call of calls) {
        const current = confidenceByTrader.get(call.author.id) ?? { total: 0, count: 0 };
        current.total += call.confidenceScore;
        current.count += 1;
        confidenceByTrader.set(call.author.id, current);
      }

      return traders
        .map((trader) => {
          const confidence = confidenceByTrader.get(trader.id);
          return {
            traderId: trader.id,
            handle: trader.username,
            name: trader.name,
            image: trader.image,
            trustScore: trader.trustScore,
            firstCalls: trader.firstCallCount,
            firstCallAvgRoi: trader.firstCallAvgRoi,
            avgConfidenceScore: confidence?.count ? roundMetricOrZero(confidence.total / confidence.count) : 0,
          };
        })
        .sort((left, right) => {
          if (right.firstCalls !== left.firstCalls) {
            return right.firstCalls - left.firstCalls;
          }
          return finite(right.firstCallAvgRoi) - finite(left.firstCallAvgRoi);
        });
    }
  );
}

export async function ensureAlertPreference(userId: string): Promise<AlertPreference> {
  return prisma.alertPreference.upsert({
    where: { userId },
    create: { userId },
    update: {},
  });
}
