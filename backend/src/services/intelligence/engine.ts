import { Prisma, type AlertPreference } from "@prisma/client";
import { prisma, isTransientPrismaError } from "../../prisma.js";
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
  pct,
  type ReactionCounts,
} from "./scoring.js";
import {
  analyzeSolanaTokenDistribution,
  fetchDexTokenStats,
  type DexTokenStats,
  type TokenHolderSnapshot,
} from "./token-metrics.js";
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
const FEED_PRIORITY_POST_COUNT = 15;
const FEED_PRIORITY_REFRESH_TIMEOUT_MS = process.env.NODE_ENV === "production" ? 850 : 1_300;
const FEED_RESULT_CACHE_TTL_MS = 15_000;
const PERSONALIZED_FEED_RESULT_CACHE_TTL_MS = 8_000;
const FOLLOWING_SNAPSHOT_CACHE_TTL_MS = 15_000;
const TOKEN_OVERVIEW_CACHE_TTL_MS = 20_000;
const PERSONALIZED_TOKEN_OVERVIEW_CACHE_TTL_MS = 12_000;
const RADAR_CACHE_TTL_MS = 15_000;
const TRADER_OVERVIEW_CACHE_TTL_MS = 20_000;
const LEADERBOARD_CACHE_TTL_MS = 20_000;
const LEADERBOARD_SNAPSHOT_TTL_MS = 2 * 60_000;
const LEADERBOARD_SNAPSHOT_STALE_REVALIDATE_MS = 20 * 60_000;
const LEADERBOARD_SNAPSHOT_VERSION = 2;
const DAILY_LEADERBOARD_SNAPSHOT_KEY = `intelligence:leaderboards:daily:v${LEADERBOARD_SNAPSHOT_VERSION}`;
const FIRST_CALLER_LEADERBOARD_SNAPSHOT_KEY = `intelligence:leaderboards:first-callers:v${LEADERBOARD_SNAPSHOT_VERSION}`;
const MARKET_CONTEXT_CACHE_TTL_MS = 10 * 60_000;
const TOKEN_REFRESH_SOFT_TIMEOUT_MS = 1_200;
const TOKEN_OVERVIEW_SECTION_TIMEOUT_MS = process.env.NODE_ENV === "production" ? 1_500 : 2_250;
const TOKEN_OVERVIEW_DISTRIBUTION_SECTION_TIMEOUT_MS =
  process.env.NODE_ENV === "production" ? 12_000 : 15_000;
const TOKEN_CONFIDENCE_MODEL_UPDATED_AT_MS = Date.parse("2026-03-10T00:00:00.000Z");
const INTELLIGENCE_PREWARM_INTERVAL_MS = 10 * 60_000;
const INTELLIGENCE_PREWARM_START_DELAY_MS = process.env.NODE_ENV === "production" ? 25_000 : 8_000;
const INTELLIGENCE_PREWARM_TOKEN_LIMIT = 24;
const PRIORITY_FEED_KINDS: FeedKind[] = ["latest", "hot-alpha", "early-runners", "high-conviction"];

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
export const INTELLIGENCE_CALL_SELECT = CALL_SELECT;
export type IntelligenceCallRecord = CallRecord;

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
  isFollowingAuthor: boolean;
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

export type RealtimePostIntelligenceSnapshot = Pick<
  EnrichedCall,
  | "confidenceScore"
  | "hotAlphaScore"
  | "earlyRunnerScore"
  | "highConvictionScore"
  | "timingTier"
  | "roiCurrentPct"
  | "bundleRiskLabel"
  | "tokenRiskScore"
  | "liquidity"
  | "volume24h"
  | "holderCount"
  | "largestHolderPct"
  | "top10HolderPct"
  | "bundledWalletCount"
  | "estimatedBundledSupplyPct"
> & {
  lastIntelligenceAt: string | null;
};

type RealtimeIntelligenceOverride = {
  currentMcap?: number | null;
  lastMcapUpdate?: Date | null;
  settled?: boolean;
  settledAt?: Date | null;
};

type FeedListResult = {
  items: EnrichedCall[];
  hasMore: boolean;
  nextCursor: string | null;
  totalItems: number;
  degraded?: boolean;
};

type FeedCursorBoundary = {
  id: string;
  createdAt: Date;
};

type HydrateCallOptions = {
  refreshTraders?: boolean;
  refreshTokens?: boolean;
  ensureTokenLinks?: boolean;
  persistComputed?: boolean;
  preferStoredIntelligence?: boolean;
};

export type TokenOverview = {
  token: TokenRecord & {
    marketCap: number | null;
    isFollowing: boolean;
    holderCountSource: "stored" | "solscan" | "helius" | "rpc_scan" | "birdeye" | "largest_accounts" | null;
    topHolders: TokenHolderSnapshot[];
    devWallet: TokenHolderSnapshot | null;
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
      topHolders: TokenHolderSnapshot[];
      devWallet: TokenHolderSnapshot | null;
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

export type FirstCallerLeaderboardRow = {
  traderId: string;
  handle: string | null;
  name: string;
  image: string | null;
  trustScore: number | null;
  firstCalls: number;
  firstCallAvgRoi: number | null;
  avgConfidenceScore: number;
};

type CacheEntry<T> = {
  expiresAt: number;
  value: T;
};

type SocialState = {
  likedPostIds: Set<string>;
  repostedPostIds: Set<string>;
  followedAuthorIds: Set<string>;
  reactionByPostId: Map<string, string>;
  reactionCountsByPostId: Map<string, ReactionCounts>;
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
  CacheEntry<FirstCallerLeaderboardRow[]>
>();
const firstCallerLeaderboardsInFlight = new Map<
  string,
  Promise<FirstCallerLeaderboardRow[]>
>();
const marketContextCache = new Map<string, CacheEntry<MarketContextSnapshot>>();
const marketContextInFlight = new Map<string, Promise<MarketContextSnapshot>>();
let intelligencePriorityLoopTimer: ReturnType<typeof setInterval> | null = null;
let intelligencePriorityLoopInFlight: Promise<void> | null = null;
let intelligencePriorityLoopCanRun: (() => boolean) | null = null;

type TokenRefreshResult = {
  token: TokenRecord;
  previousToken: TokenRecord | null;
  refreshed: boolean;
};

type MarketContextSnapshot = {
  label: "risk-on" | "balanced" | "risk-off";
  breadthScore: number;
  confidenceBias: number;
  accelerationMultiplier: number;
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

function hasFiniteMetric(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function hasPositiveMetric(value: number | null | undefined): value is number {
  return hasFiniteMetric(value) && value > 0;
}

function pickFirstFiniteMetric(...values: Array<number | null | undefined>): number | null {
  for (const value of values) {
    if (hasFiniteMetric(value)) {
      return value;
    }
  }
  return null;
}

function pickFirstPositiveMetric(...values: Array<number | null | undefined>): number | null {
  for (const value of values) {
    if (hasFiniteMetric(value) && value > 0) {
      return value;
    }
  }
  return null;
}

function computeDexSentimentTrendAdjustment(dexStats: DexTokenStats | null | undefined): number {
  const priceChangePct = finite(dexStats?.priceChange24hPct);
  const buys24h = Math.max(0, finite(dexStats?.buys24h));
  const sells24h = Math.max(0, finite(dexStats?.sells24h));
  const totalTrades = buys24h + sells24h;
  const orderFlowImbalancePct = totalTrades > 0 ? ((buys24h - sells24h) / totalTrades) * 100 : 0;
  const priceAdjustment = Math.max(-14, Math.min(14, priceChangePct / 3));
  const flowAdjustment = Math.max(-10, Math.min(10, orderFlowImbalancePct / 5));
  const activityAdjustment = totalTrades >= 40 ? Math.min(4, totalTrades / 50) : 0;

  if (!hasFiniteMetric(priceChangePct) && totalTrades === 0) {
    return 0;
  }

  return roundMetricOrZero(priceAdjustment + flowAdjustment + activityAdjustment);
}

function tokenNeedsCoreHydration(token: TokenRecord | null): boolean {
  if (!token) return true;
  if (!hasFiniteMetric(token.confidenceScore)) return true;
  if (!hasFiniteMetric(token.hotAlphaScore)) return true;
  if (!hasFiniteMetric(token.earlyRunnerScore)) return true;
  if (!hasFiniteMetric(token.highConvictionScore)) return true;
  if (!hasFiniteMetric(token.sentimentScore)) return true;
  if (!hasFiniteMetric(token.liquidity) && !hasFiniteMetric(token.volume24h)) return true;
  if (
    token.chainType === "solana" &&
    (!hasPositiveMetric(token.holderCount) ||
      !hasFiniteMetric(token.top10HolderPct) ||
      !hasFiniteMetric(token.largestHolderPct))
  ) {
    return true;
  }
  return false;
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

function peekCacheValue<T>(cache: Map<string, CacheEntry<T>>, key: string): T | null {
  const cached = cache.get(key);
  if (!cached) return null;
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

function parseLeaderboardsPayloadSnapshot(payload: Prisma.JsonValue): LeaderboardsPayload | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return null;
  }

  const candidate = payload as Partial<LeaderboardsPayload>;
  if (
    !Array.isArray(candidate.topTradersToday) ||
    !Array.isArray(candidate.topAlphaToday) ||
    !Array.isArray(candidate.biggestRoiToday) ||
    !Array.isArray(candidate.bestEntryToday)
  ) {
    return null;
  }

  return candidate as LeaderboardsPayload;
}

function parseFirstCallerLeaderboardRowsSnapshot(
  payload: Prisma.JsonValue
): FirstCallerLeaderboardRow[] | null {
  if (!Array.isArray(payload)) {
    return null;
  }

  return payload as unknown as FirstCallerLeaderboardRow[];
}

async function readAggregateSnapshotPayload<T>(
  key: string,
  version: number,
  parser: (payload: Prisma.JsonValue) => T | null
): Promise<{ fresh: T | null; stale: T | null }> {
  try {
    const snapshot = await prisma.aggregateSnapshot.findUnique({
      where: { key },
      select: {
        version: true,
        payload: true,
        capturedAt: true,
        expiresAt: true,
      },
    });

    if (!snapshot) {
      return { fresh: null, stale: null };
    }

    const parsedPayload = parser(snapshot.payload);
    if (!parsedPayload) {
      return { fresh: null, stale: null };
    }

    const now = Date.now();
    if (snapshot.version === version && snapshot.expiresAt.getTime() > now) {
      return { fresh: parsedPayload, stale: parsedPayload };
    }

    const isUsableStale =
      snapshot.capturedAt.getTime() + LEADERBOARD_SNAPSHOT_STALE_REVALIDATE_MS > now;

    return {
      fresh: null,
      stale: isUsableStale ? parsedPayload : null,
    };
  } catch (error) {
    console.warn("[intelligence] aggregate snapshot read failed", {
      key,
      message: error instanceof Error ? error.message : String(error),
    });
    return { fresh: null, stale: null };
  }
}

async function writeAggregateSnapshotPayload<T>(
  key: string,
  version: number,
  payload: T,
  ttlMs: number
): Promise<void> {
  try {
    const now = new Date();
    await prisma.aggregateSnapshot.upsert({
      where: { key },
      create: {
        key,
        version,
        payload: payload as Prisma.InputJsonValue,
        capturedAt: now,
        expiresAt: new Date(now.getTime() + ttlMs),
      },
      update: {
        version,
        payload: payload as Prisma.InputJsonValue,
        capturedAt: now,
        expiresAt: new Date(now.getTime() + ttlMs),
      },
    });
  } catch (error) {
    console.warn("[intelligence] aggregate snapshot write failed", {
      key,
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

function sanitizeCacheKeyPart(value: string | null | undefined): string {
  const normalized = value?.trim().toLowerCase();
  return normalized && normalized.length > 0 ? normalized : "-";
}

function clearCacheEntriesByPrefix<T>(cache: Map<string, T>, prefix: string): void {
  for (const key of Array.from(cache.keys())) {
    if (key.startsWith(prefix)) {
      cache.delete(key);
    }
  }
}

function clearCacheEntriesContaining<T>(cache: Map<string, T>, fragment: string): void {
  for (const key of Array.from(cache.keys())) {
    if (key.includes(fragment)) {
      cache.delete(key);
    }
  }
}

export function invalidateViewerSocialCaches(viewerId: string | null | undefined): void {
  const normalizedViewerId = viewerId?.trim();
  if (!normalizedViewerId) return;

  const viewerKey = sanitizeCacheKeyPart(normalizedViewerId);
  followingSnapshotCache.delete(normalizedViewerId);
  clearCacheEntriesContaining(feedListCache, `:${viewerKey}:`);
  clearCacheEntriesContaining(feedListInFlight, `:${viewerKey}:`);
  clearCacheEntriesByPrefix(tokenOverviewCache, `token:${normalizedViewerId}:`);
  clearCacheEntriesByPrefix(tokenOverviewInFlight, `token:${normalizedViewerId}:`);
  clearCacheEntriesByPrefix(traderOverviewCache, `trader:${normalizedViewerId}:`);
  clearCacheEntriesByPrefix(traderOverviewInFlight, `trader:${normalizedViewerId}:`);
  clearCacheEntriesByPrefix(dailyLeaderboardsCache, `leaderboards:daily:${normalizedViewerId}`);
  clearCacheEntriesByPrefix(dailyLeaderboardsInFlight, `leaderboards:daily:${normalizedViewerId}`);
  clearCacheEntriesByPrefix(firstCallerLeaderboardsCache, `leaderboards:first-callers:${normalizedViewerId}`);
  clearCacheEntriesByPrefix(firstCallerLeaderboardsInFlight, `leaderboards:first-callers:${normalizedViewerId}`);
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

function logTokenOverviewSectionFallback(label: string, error: unknown): void {
  console.warn("[intelligence/token] serving fallback section", {
    label,
    message: error instanceof Error ? error.message : String(error),
  });
}

async function resolveTokenOverviewSection<T>(
  label: string,
  loader: () => Promise<T>,
  fallback: T,
  options?: { timeoutMs?: number }
): Promise<T> {
  try {
    const result = await withSoftTimeout(
      loader(),
      options?.timeoutMs ?? TOKEN_OVERVIEW_SECTION_TIMEOUT_MS
    );
    if (result === null) {
      logTokenOverviewSectionFallback(label, new Error("timed_out"));
      return cloneCachedValue(fallback);
    }
    return result;
  } catch (error) {
    logTokenOverviewSectionFallback(label, error);
    return cloneCachedValue(fallback);
  }
}

function hasMeaningfulTokenOverviewChart(
  chart: TokenOverview["token"]["chart"] | null | undefined
): chart is TokenOverview["token"]["chart"] {
  return Array.isArray(chart) && chart.some((point) =>
    hasPositiveMetric(point.marketCap) ||
    hasPositiveMetric(point.liquidity) ||
    hasPositiveMetric(point.volume24h) ||
    hasPositiveMetric(point.holderCount)
  );
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
  return deriveRoiPct(record.entryMcap, record.currentMcap) ?? record.roiCurrentPct;
}

function toDateMs(value: Date | string | null | undefined): number {
  if (value instanceof Date) {
    return value.getTime();
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function resolvePostIntelligenceSignalVersion(
  record: Pick<CallRecord, "lastMcapUpdate" | "settledAt" | "entryMcap" | "currentMcap" | "roiCurrentPct">
): number {
  const liveRoiPct = deriveRoiPct(record.entryMcap, record.currentMcap);
  const storedRoiPct = record.roiCurrentPct;
  const roiDrifted =
    hasFiniteMetric(liveRoiPct) &&
    hasFiniteMetric(storedRoiPct) &&
    Math.abs(liveRoiPct - storedRoiPct) >= 8;

  return Math.max(
    toDateMs(record.lastMcapUpdate),
    toDateMs(record.settledAt),
    roiDrifted ? Date.now() : 0
  );
}

function shouldUseStoredPostIntelligence(
  record: Pick<CallRecord, "lastIntelligenceAt" | "lastMcapUpdate" | "settledAt" | "entryMcap" | "currentMcap" | "roiCurrentPct">
): boolean {
  const lastIntelligenceAt = record.lastIntelligenceAt?.getTime() ?? 0;
  if (lastIntelligenceAt <= 0) {
    return false;
  }

  return resolvePostIntelligenceSignalVersion(record) <= lastIntelligenceAt;
}

function toNumber(value: number | bigint | string | null | undefined): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function averageOf(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

async function getMarketContextSnapshot(): Promise<MarketContextSnapshot> {
  return memoizeCached(
    marketContextCache,
    marketContextInFlight,
    "global",
    MARKET_CONTEXT_CACHE_TTL_MS,
    async () => {
      const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const since6h = new Date(Date.now() - 6 * 60 * 60 * 1000);

      const [recentCalls, activeTokens] = await Promise.all([
        prisma.post.findMany({
          where: {
            createdAt: {
              gte: since24h,
            },
          },
          select: {
            entryMcap: true,
            currentMcap: true,
            isWin: true,
          },
          orderBy: { createdAt: "desc" },
          take: 240,
        }),
        prisma.token.findMany({
          where: {
            updatedAt: {
              gte: since6h,
            },
          },
          select: {
            sentimentScore: true,
            tokenRiskScore: true,
            hotAlphaScore: true,
            earlyRunnerScore: true,
            highConvictionScore: true,
          },
          orderBy: { updatedAt: "desc" },
          take: 120,
        }),
      ]);

      const callRois = recentCalls
        .map((call) => deriveRoiPct(call.entryMcap, call.currentMcap))
        .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
      const positiveCallShare =
        callRois.length > 0 ? (callRois.filter((value) => value >= 0).length / callRois.length) * 100 : 50;
      const positiveMomentumScore = pct(
        averageOf(callRois.filter((value) => value > 0)),
        180
      );
      const realizedWinShare =
        recentCalls.length > 0
          ? (recentCalls.filter((call) => call.isWin === true).length / recentCalls.length) * 100
          : 50;
      const averageSentimentScore = averageOf(
        activeTokens
          .map((token) => finite(token.sentimentScore, 50))
          .filter((value) => Number.isFinite(value))
      );
      const lowRiskShare =
        activeTokens.length > 0
          ? (activeTokens.filter((token) => finite(token.tokenRiskScore, 100) <= 55).length / activeTokens.length) * 100
          : 50;
      const activeSignalShare =
        activeTokens.length > 0
          ? (activeTokens.filter((token) =>
              Math.max(
                finite(token.hotAlphaScore),
                finite(token.earlyRunnerScore),
                finite(token.highConvictionScore)
              ) >= 60
            ).length / activeTokens.length) * 100
          : 50;

      const breadthScore = clampScore(
        0.24 * positiveCallShare +
          0.18 * positiveMomentumScore +
          0.18 * realizedWinShare +
          0.16 * averageSentimentScore +
          0.12 * lowRiskShare +
          0.12 * activeSignalShare
      );

      if (breadthScore >= 68) {
        return {
          label: "risk-on",
          breadthScore: roundMetricOrZero(breadthScore),
          confidenceBias: 8,
          accelerationMultiplier: 1.18,
        };
      }

      if (breadthScore <= 38) {
        return {
          label: "risk-off",
          breadthScore: roundMetricOrZero(breadthScore),
          confidenceBias: -8,
          accelerationMultiplier: 0.88,
        };
      }

      return {
        label: "balanced",
        breadthScore: roundMetricOrZero(breadthScore),
        confidenceBias: breadthScore >= 56 ? 3 : breadthScore <= 46 ? -3 : 0,
        accelerationMultiplier: breadthScore >= 56 ? 1.08 : breadthScore <= 46 ? 0.95 : 1,
      };
    }
  );
}

function shouldRefreshToken(token: TokenRecord | null): boolean {
  if (tokenNeedsCoreHydration(token)) return true;
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
  const sentimentTrendAdjustment = computeDexSentimentTrendAdjustment(dexStats);
  const sentimentScore = computeSentimentScore({
    reactions: reactionCounts,
    sentimentTrendAdjustment,
  });
  const liquidity = roundMetric(
    pickFirstPositiveMetric(dexStats?.liquidityUsd, existing.liquidity)
  );
  const volume24h = roundMetric(
    pickFirstPositiveMetric(dexStats?.volume24hUsd, existing.volume24h)
  );
  const marketCap = roundMetric(
    pickFirstPositiveMetric(
      dexStats?.marketCap,
      recentCalls[0]?.currentMcap,
      recentCalls[0]?.entryMcap,
      latestSnapshot?.marketCap
    )
  );
  const holderCount = Math.round(
    pickFirstPositiveMetric(distribution?.holderCount, existing.holderCount) ?? 0
  ) || null;
  const tokenRiskScore = roundMetric(
    pickFirstFiniteMetric(distribution?.tokenRiskScore, existing.tokenRiskScore)
  );
  const bundleRiskLabel =
    distribution?.bundleRiskLabel ??
    (tokenRiskScore !== null ? determineBundleRiskLabel(tokenRiskScore) : existing.bundleRiskLabel);
  const volumeGrowthPct = growthPct(volume24h, latestSnapshot?.volume24h ?? null);
  const liquidityGrowthPct = growthPct(liquidity, latestSnapshot?.liquidity ?? null);
  const holderGrowthPct = growthPct(holderCount, latestSnapshot?.holderCount ?? null);
  const mcapGrowthPct = growthPct(marketCap, latestSnapshot?.marketCap ?? null);
  const momentumPct = finite(dexStats?.priceChange24hPct);
  const marketContext = await getMarketContextSnapshot();
  const marketAdjustedMomentumPct = Math.max(0, momentumPct) * marketContext.accelerationMultiplier;
  const marketAdjustedVolumeGrowthPct = Math.max(0, volumeGrowthPct) * marketContext.accelerationMultiplier;
  const marketAdjustedLiquidityGrowthPct = Math.max(0, liquidityGrowthPct) * marketContext.accelerationMultiplier;
  const marketAdjustedHolderGrowthPct = Math.max(0, holderGrowthPct) * marketContext.accelerationMultiplier;
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
      liquidityGrowth1hPct: marketAdjustedLiquidityGrowthPct,
      volumeGrowth1hPct: marketAdjustedVolumeGrowthPct,
      holderGrowth1hPct: marketAdjustedHolderGrowthPct,
      momentumPct: Math.max(marketAdjustedMomentumPct, Math.max(0, mcapGrowthPct)),
      sentimentScore,
      tokenRiskScore,
    })
  );
  const tokenConfidenceBaseScore = clampScore(
    avgCallConfidence > 0
      ? avgCallConfidence * 0.50 +
          finite(sentimentScore) * 0.12 +
          Math.max(0, 100 - finite(tokenRiskScore)) * 0.08 +
          pct(marketAdjustedMomentumPct, 180) * 0.08 +
          pct(marketAdjustedVolumeGrowthPct, 360) * 0.08 +
          pct(marketAdjustedLiquidityGrowthPct, 140) * 0.05 +
          pct(marketAdjustedHolderGrowthPct, 70) * 0.05 +
          pct(mcapGrowthPct, 220) * 0.04 +
          marketContext.breadthScore * 0.04 +
          marketContext.confidenceBias
      : 0.26 * Math.max(0, 100 - finite(tokenRiskScore)) +
          0.28 * finite(sentimentScore) +
          0.16 * pct(marketAdjustedMomentumPct, 180) +
          0.10 * pct(marketAdjustedVolumeGrowthPct, 360) +
          0.08 * pct(marketAdjustedLiquidityGrowthPct, 140) +
          0.06 * pct(marketAdjustedHolderGrowthPct, 70) +
          0.06 * pct(mcapGrowthPct, 220) +
          0.08 * marketContext.breadthScore +
          marketContext.confidenceBias
  );
  const confidenceScore = roundMetric(
    applyConfidenceGuardrails({
      baseScore: tokenConfidenceBaseScore,
      tokenRiskScore,
      top10HolderPct: distribution?.top10HolderPct ?? existing.top10HolderPct,
      roiCurrentPct: avgCurrentRoiPct ?? mcapGrowthPct ?? momentumPct,
      sentimentScore,
    })
  );
  const hotAlphaScore = roundMetric(
    clampScore(
      avgHotAlpha * 0.50 +
        finite(earlyRunnerScore) * 0.18 +
        finite(sentimentScore) * 0.08 +
        pct(marketAdjustedMomentumPct, 180) * 0.09 +
        pct(marketAdjustedVolumeGrowthPct, 360) * 0.08 +
        marketContext.breadthScore * 0.07
    )
  );
  const highConvictionScore = roundMetric(
    clampScore(
      avgHighConviction * 0.52 +
        finite(confidenceScore) * 0.24 +
        Math.max(0, 100 - finite(tokenRiskScore)) * 0.09 +
        pct(marketAdjustedLiquidityGrowthPct, 140) * 0.07 +
        marketContext.breadthScore * 0.08
    )
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

async function readSocialState(
  viewerId: string | null,
  postIds: string[],
  authorIds: string[]
): Promise<SocialState> {
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
      followedAuthorIds: new Set<string>(),
      reactionByPostId,
      reactionCountsByPostId,
    };
  }

  const [likes, reposts, follows] = await Promise.all([
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
    authorIds.length > 0
      ? prisma.follow.findMany({
          where: {
            followerId: viewerId,
            followingId: { in: authorIds },
          },
          select: { followingId: true },
        })
      : Promise.resolve([]),
  ]);

  return {
    likedPostIds: new Set(likes.map((like) => like.postId)),
    repostedPostIds: new Set(reposts.map((repost) => repost.postId)),
    followedAuthorIds: new Set(follows.map((follow) => follow.followingId)),
    reactionByPostId,
    reactionCountsByPostId,
  };
}

function buildEmptySocialState(): SocialState {
  return {
    likedPostIds: new Set<string>(),
    repostedPostIds: new Set<string>(),
    followedAuthorIds: new Set<string>(),
    reactionByPostId: new Map<string, string>(),
    reactionCountsByPostId: new Map<string, ReactionCounts>(),
  };
}

function parseStoredReactionCounts(value: Prisma.JsonValue | null | undefined): ReactionCounts {
  const counts = buildReactionCounts([]);
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return counts;
  }

  const candidate = value as Record<string, unknown>;
  for (const key of ["alpha", "based", "printed", "rug"] as const) {
    const raw = candidate[key];
    if (typeof raw === "number" && Number.isFinite(raw) && raw >= 0) {
      counts[key] = Math.round(raw);
    }
  }

  return counts;
}

async function readViewerSocialState(
  viewerId: string | null,
  postIds: string[],
  authorIds: string[]
): Promise<SocialState> {
  if (!viewerId || postIds.length === 0) {
    return buildEmptySocialState();
  }

  const [likes, reposts, follows, reactions] = await Promise.all([
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
    authorIds.length > 0
      ? prisma.follow.findMany({
          where: {
            followerId: viewerId,
            followingId: { in: authorIds },
          },
          select: { followingId: true },
        })
      : Promise.resolve([]),
    prisma.reaction.findMany({
      where: {
        userId: viewerId,
        postId: { in: postIds },
      },
      select: {
        postId: true,
        type: true,
      },
    }),
  ]);

  const reactionByPostId = new Map<string, string>();
  for (const reaction of reactions) {
    if (!reactionByPostId.has(reaction.postId)) {
      reactionByPostId.set(reaction.postId, reaction.type);
    }
  }

  return {
    likedPostIds: new Set(likes.map((like) => like.postId)),
    repostedPostIds: new Set(reposts.map((repost) => repost.postId)),
    followedAuthorIds: new Set(follows.map((follow) => follow.followingId)),
    reactionByPostId,
    reactionCountsByPostId: new Map<string, ReactionCounts>(),
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

async function readTimingMetaForCalls(records: CallRecord[]): Promise<
  Map<
    string,
    {
      firstCallerRank: number | null;
      firstCallCreatedAt: Date | null;
      firstCallEntryMcap: number | null;
    }
  >
> {
  const tokenIds = Array.from(
    new Set(records.map((record) => record.tokenId ?? record.token?.id ?? null).filter((value): value is string => Boolean(value)))
  );
  const recordIds = records.map((record) => record.id);

  if (tokenIds.length === 0 || recordIds.length === 0) {
    return new Map();
  }

  const rows = await prisma.$queryRaw<
    Array<{
      id: string;
      tokenId: string;
      firstCallerRank: number | bigint | string;
      firstCallCreatedAt: Date | null;
      firstCallEntryMcap: number | null;
    }>
  >(Prisma.sql`
    SELECT ranked.id,
           ranked."tokenId",
           ranked."firstCallerRank",
           ranked."firstCallCreatedAt",
           ranked."firstCallEntryMcap"
    FROM (
      SELECT
        p.id,
        p."tokenId",
        ROW_NUMBER() OVER (PARTITION BY p."tokenId" ORDER BY p."createdAt" ASC, p.id ASC) AS "firstCallerRank",
        FIRST_VALUE(p."createdAt") OVER (
          PARTITION BY p."tokenId"
          ORDER BY p."createdAt" ASC, p.id ASC
          ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING
        ) AS "firstCallCreatedAt",
        FIRST_VALUE(p."entryMcap") OVER (
          PARTITION BY p."tokenId"
          ORDER BY p."createdAt" ASC, p.id ASC
          ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING
        ) AS "firstCallEntryMcap"
      FROM "Post" p
      WHERE p."tokenId" IN (${Prisma.join(tokenIds)})
    ) ranked
    WHERE ranked.id IN (${Prisma.join(recordIds)})
  `);

  const byId = new Map<
    string,
    {
      firstCallerRank: number | null;
      firstCallCreatedAt: Date | null;
      firstCallEntryMcap: number | null;
    }
  >();

  for (const row of rows) {
    byId.set(row.id, {
      firstCallerRank: toNumber(row.firstCallerRank),
      firstCallCreatedAt: row.firstCallCreatedAt ?? null,
      firstCallEntryMcap: row.firstCallEntryMcap ?? null,
    });
  }

  return byId;
}

async function readLatestTokenGrowthById(tokenIds: string[]): Promise<
  Map<
    string,
    {
      volumeGrowthPct: number;
      liquidityGrowthPct: number;
      holderGrowthPct: number;
      mcapGrowthPct: number;
    }
  >
> {
  if (tokenIds.length === 0) {
    return new Map();
  }

  const rows = await prisma.$queryRaw<
    Array<{
      tokenId: string;
      capturedAt: Date;
      marketCap: number | null;
      liquidity: number | null;
      volume24h: number | null;
      holderCount: number | null;
      rowNumber: number | bigint | string;
    }>
  >(Prisma.sql`
    SELECT ranked."tokenId",
           ranked."capturedAt",
           ranked."marketCap",
           ranked."liquidity",
           ranked."volume24h",
           ranked."holderCount",
           ranked."rowNumber"
    FROM (
      SELECT
        s."tokenId",
        s."capturedAt",
        s."marketCap",
        s."liquidity",
        s."volume24h",
        s."holderCount",
        ROW_NUMBER() OVER (PARTITION BY s."tokenId" ORDER BY s."capturedAt" DESC) AS "rowNumber"
      FROM "TokenMetricSnapshot" s
      WHERE s."tokenId" IN (${Prisma.join(tokenIds)})
    ) ranked
    WHERE ranked."rowNumber" <= 2
  `);

  const latestByTokenId = new Map<
    string,
    {
      marketCap: number | null;
      liquidity: number | null;
      volume24h: number | null;
      holderCount: number | null;
    }
  >();
  const previousByTokenId = new Map<
    string,
    {
      marketCap: number | null;
      liquidity: number | null;
      volume24h: number | null;
      holderCount: number | null;
    }
  >();

  for (const row of rows) {
    const rowNumber = toNumber(row.rowNumber);
    if (rowNumber === 1) {
      latestByTokenId.set(row.tokenId, {
        marketCap: row.marketCap,
        liquidity: row.liquidity,
        volume24h: row.volume24h,
        holderCount: row.holderCount,
      });
    } else if (rowNumber === 2) {
      previousByTokenId.set(row.tokenId, {
        marketCap: row.marketCap,
        liquidity: row.liquidity,
        volume24h: row.volume24h,
        holderCount: row.holderCount,
      });
    }
  }

  const growthByTokenId = new Map<
    string,
    {
      volumeGrowthPct: number;
      liquidityGrowthPct: number;
      holderGrowthPct: number;
      mcapGrowthPct: number;
    }
  >();

  for (const tokenId of tokenIds) {
    const latest = latestByTokenId.get(tokenId) ?? null;
    const previous = previousByTokenId.get(tokenId) ?? null;
    growthByTokenId.set(tokenId, {
      volumeGrowthPct: growthPct(latest?.volume24h ?? null, previous?.volume24h ?? null),
      liquidityGrowthPct: growthPct(latest?.liquidity ?? null, previous?.liquidity ?? null),
      holderGrowthPct: growthPct(latest?.holderCount ?? null, previous?.holderCount ?? null),
      mcapGrowthPct: growthPct(latest?.marketCap ?? null, previous?.marketCap ?? null),
    });
  }

  return growthByTokenId;
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
    preferStoredIntelligence = false,
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
  const relatedCalls = !preferStoredIntelligence && tokenIds.length > 0
    ? await prisma.post.findMany({
        where: {
          tokenId: { in: tokenIds },
          createdAt: {
            gte: new Date(Date.now() - 72 * 60 * 60 * 1000),
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

  const postIds = records.map((record) => record.id);
  const authorIds = Array.from(new Set(records.map((record) => record.authorId)));
  const socialStatePromise = (
    preferStoredIntelligence
      ? readViewerSocialState(viewerId, postIds, authorIds)
      : readSocialState(viewerId, postIds, authorIds)
  ).catch((error) => {
    if (!isTransientPrismaError(error)) {
      throw error;
    }
    console.warn("[intelligence/feed] social state degraded during transient prisma pressure", {
      viewerId,
      preferStoredIntelligence,
      message: error instanceof Error ? error.message : String(error),
    });
    return buildEmptySocialState();
  });

  const [socialState, bundleClustersByTokenId, timingMetaByPostId, tokenGrowthById, marketContext] =
    await Promise.all([
      socialStatePromise,
      preferStoredIntelligence
        ? Promise.resolve(new Map<string, EnrichedCall["bundleClusters"]>())
        : readTokenClusters(Array.from(new Set(Array.from(tokenMap.values()).map((token) => token.id)))),
      preferStoredIntelligence
        ? Promise.resolve(new Map<string, Awaited<ReturnType<typeof readTimingMetaForCalls>> extends Map<string, infer TValue> ? TValue : never>())
        : readTimingMetaForCalls(records),
      preferStoredIntelligence
        ? Promise.resolve(new Map<string, { volumeGrowthPct: number; liquidityGrowthPct: number; holderGrowthPct: number; mcapGrowthPct: number }>())
        : readLatestTokenGrowthById(tokenIds),
      preferStoredIntelligence
        ? Promise.resolve<MarketContextSnapshot>({
            label: "balanced",
            breadthScore: 50,
            confidenceBias: 0,
            accelerationMultiplier: 1,
          })
        : getMarketContextSnapshot(),
    ]);

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
    const timingMeta = timingMetaByPostId.get(record.id);
    const firstCallerRank = record.firstCallerRank ?? timingMeta?.firstCallerRank ?? null;
    const firstCallCreatedAt = timingMeta?.firstCallCreatedAt ?? tokenCalls[0]?.createdAt ?? null;
    const firstCallEntryMcap = timingMeta?.firstCallEntryMcap ?? tokenCalls[0]?.entryMcap ?? null;
    const tokenGrowth = resolvedTokenId ? tokenGrowthById.get(resolvedTokenId) ?? null : null;
    const volumeGrowthPct = tokenGrowth?.volumeGrowthPct ?? 0;
    const liquidityGrowthPct = tokenGrowth?.liquidityGrowthPct ?? 0;
    const holderGrowthPct = tokenGrowth?.holderGrowthPct ?? 0;
    const mcapGrowthPct = tokenGrowth?.mcapGrowthPct ?? 0;
    const marketAdjustedVolumeGrowthPct = Math.max(0, volumeGrowthPct) * marketContext.accelerationMultiplier;
    const marketAdjustedLiquidityGrowthPct = Math.max(0, liquidityGrowthPct) * marketContext.accelerationMultiplier;
    const marketAdjustedHolderGrowthPct = Math.max(0, holderGrowthPct) * marketContext.accelerationMultiplier;
    const distinctTrustedTraders = preferStoredIntelligence
      ? finite(record.trustedTraderCount)
      : new Set(
          tokenCalls
            .filter((call) => Date.now() - call.createdAt.getTime() <= 6 * 60 * 60 * 1000)
            .filter((call) => finite(call.author.trustScore) >= TRUSTED_TRADER_THRESHOLD)
            .map((call) => call.authorId)
        ).size;
    const trustedTraderCount = preferStoredIntelligence
      ? finite(record.trustedTraderCount)
      : new Set(
          tokenCalls
            .filter((call) => finite(call.author.trustScore) >= TRUSTED_TRADER_THRESHOLD)
            .map((call) => call.authorId)
        ).size;
    const reactionCounts =
      socialState.reactionCountsByPostId.get(record.id) ??
      parseStoredReactionCounts(record.reactionCounts);
    const sentimentScore = roundMetricOrZero(
      record.sentimentScore ??
        computeSentimentScore({
          reactions: reactionCounts,
        })
    );
    const roiPeakPct = roundMetric(record.roiPeakPct ?? deriveRoiPeakPct(record));
    const roiCurrentPct = roundMetric(deriveCurrentRoiPct(record));
    const shouldUseStoredIntelligence = preferStoredIntelligence && shouldUseStoredPostIntelligence(record);
    const entryQualityScore = roundMetricOrZero(
      record.entryQualityScore ??
        computeEntryQualityScore({
          firstCallerRank,
          createdAt: record.createdAt,
            firstCallCreatedAt,
            entryMcap: record.entryMcap,
            firstCallEntryMcap,
          })
    );
    const marketAdjustedMomentumPct = Math.max(0, roiCurrentPct ?? 0) * marketContext.accelerationMultiplier;
    const compositeMomentumPct = Math.max(marketAdjustedMomentumPct, Math.max(0, mcapGrowthPct) * marketContext.accelerationMultiplier);
    const confidenceScore = roundMetricOrZero(
      shouldUseStoredIntelligence && hasFiniteMetric(record.confidenceScore)
        ? record.confidenceScore
        :
        computeConfidenceScore({
          traderWinRate30d: record.author.winRate30d,
          traderAvgRoi30d: record.author.avgRoi30d,
          traderTrustScore: record.author.trustScore,
          entryQualityScore,
          liquidityUsd: token?.liquidity ?? record.currentMcap,
          volumeGrowth24hPct: marketAdjustedVolumeGrowthPct,
          liquidityGrowth1hPct: marketAdjustedLiquidityGrowthPct,
          holderGrowth1hPct: marketAdjustedHolderGrowthPct,
          mcapGrowthPct,
          momentumPct: compositeMomentumPct,
          trustedTraderCount,
          top10HolderPct: token?.top10HolderPct ?? null,
          tokenRiskScore: token?.tokenRiskScore ?? null,
          marketBreadthScore: marketContext.breadthScore,
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
      shouldUseStoredIntelligence && hasFiniteMetric(record.hotAlphaScore)
        ? record.hotAlphaScore
        :
        computeHotAlphaScore({
          confidenceScore,
          weightedEngagementPerHour,
          earlyGainsPct: roiCurrentPct,
          traderTrustScore: record.author.trustScore,
          liquidityUsd: token?.liquidity ?? record.currentMcap,
          sentimentScore,
          momentumPct: compositeMomentumPct,
          tokenRiskScore: token?.tokenRiskScore ?? null,
        })
    );
    const earlyRunnerScore = roundMetricOrZero(
      shouldUseStoredIntelligence && hasFiniteMetric(record.earlyRunnerScore)
        ? record.earlyRunnerScore
        :
        computeEarlyRunnerScore({
          distinctTrustedTradersLast6h: distinctTrustedTraders,
          liquidityGrowth1hPct: marketAdjustedLiquidityGrowthPct,
          volumeGrowth1hPct: marketAdjustedVolumeGrowthPct,
          holderGrowth1hPct: marketAdjustedHolderGrowthPct,
          momentumPct: compositeMomentumPct,
          sentimentScore,
          tokenRiskScore: token?.tokenRiskScore ?? null,
        })
    );
    const highConvictionScore = roundMetricOrZero(
      shouldUseStoredIntelligence && hasFiniteMetric(record.highConvictionScore)
        ? record.highConvictionScore
        :
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
          firstCallCreatedAt
            ? Math.max(0, (record.createdAt.getTime() - firstCallCreatedAt.getTime()) / (60 * 1000))
            : null,
        entryMcap: record.entryMcap,
        firstCallEntryMcap,
      });
    const bundlePenaltyScore = roundMetric(record.bundlePenaltyScore ?? token?.tokenRiskScore ?? null) ?? 0;
    const radarReasons = buildRadarReasons({
      distinctTrustedTraders,
      volumeGrowthPct,
      liquidityGrowthPct,
      holderGrowthPct,
      momentumPct: Math.max(roiCurrentPct ?? 0, mcapGrowthPct),
      tokenRiskScore: token?.tokenRiskScore ?? null,
    });

    enriched.push({
      ...record,
      token,
      isLiked: socialState.likedPostIds.has(record.id),
      isReposted: socialState.repostedPostIds.has(record.id),
      isFollowingAuthor: socialState.followedAuthorIds.has(record.authorId),
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

async function resolveFeedCursorBoundary(
  kind: FeedKind,
  cursor: string | null | undefined
): Promise<FeedCursorBoundary | null> {
  const normalizedCursor = cursor?.trim();
  if (!normalizedCursor || (kind !== "latest" && kind !== "following")) {
    return null;
  }

  const record = await prisma.post.findUnique({
    where: { id: normalizedCursor },
    select: { id: true, createdAt: true },
  });

  if (!record) {
    return null;
  }

  return {
    id: record.id,
    createdAt: record.createdAt,
  };
}

function buildFeedCursorWhere(cursorBoundary: FeedCursorBoundary | null): Prisma.PostWhereInput | undefined {
  if (!cursorBoundary) {
    return undefined;
  }

  return {
    OR: [
      { createdAt: { lt: cursorBoundary.createdAt } },
      {
        AND: [
          { createdAt: cursorBoundary.createdAt },
          { id: { lt: cursorBoundary.id } },
        ],
      },
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

  try {
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

    return writeCacheValue(
      followingSnapshotCache,
      cacheKey,
      {
        followedTraderIds: follows.map((follow) => follow.followingId),
        followedTokenIds: tokenFollows.map((follow) => follow.tokenId),
      },
      FOLLOWING_SNAPSHOT_CACHE_TTL_MS
    );
  } catch (error) {
    if (!isTransientPrismaError(error)) {
      throw error;
    }

    const staleCached = peekCacheValue(followingSnapshotCache, cacheKey);
    if (staleCached) {
      console.warn("[intelligence/feed] serving stale following snapshot after transient prisma failure", {
        viewerId,
        message: error instanceof Error ? error.message : String(error),
      });
      return staleCached;
    }

    console.warn("[intelligence/feed] following snapshot unavailable during transient prisma pressure", {
      viewerId,
      message: error instanceof Error ? error.message : String(error),
    });
    return { followedTraderIds: [], followedTokenIds: [] };
  }
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

function isEligibleForRankedFeed(
  kind: FeedKind,
  call: Pick<EnrichedCall, "hotAlphaScore" | "earlyRunnerScore" | "highConvictionScore" | "confidenceScore" | "roiCurrentPct">
): boolean {
  if (kind === "latest" || kind === "following") {
    return true;
  }

  const roiCurrentPct = call.roiCurrentPct;
  if (kind === "hot-alpha") {
    return call.hotAlphaScore >= HOT_ALPHA_THRESHOLD && (roiCurrentPct === null || roiCurrentPct > -45);
  }

  if (kind === "early-runners") {
    return call.earlyRunnerScore >= EARLY_RUNNER_THRESHOLD && (roiCurrentPct === null || roiCurrentPct > -50);
  }

  return (
    call.highConvictionScore >= HIGH_CONVICTION_THRESHOLD &&
    call.confidenceScore >= 45 &&
    (roiCurrentPct === null || roiCurrentPct > -35)
  );
}

function filterCallsForFeedKind(kind: FeedKind, calls: EnrichedCall[]): EnrichedCall[] {
  if (kind === "latest" || kind === "following") {
    return calls;
  }

  return calls.filter((call) => isEligibleForRankedFeed(kind, call));
}

function shouldPriorityRefreshFeed(args: FeedArgs): boolean {
  return !args.cursor && !args.search?.trim() && PRIORITY_FEED_KINDS.includes(args.kind);
}

async function refreshPriorityFeedSlice(
  args: FeedArgs,
  records: CallRecord[],
  hydrated: EnrichedCall[]
): Promise<EnrichedCall[]> {
  if (!shouldPriorityRefreshFeed(args) || hydrated.length === 0 || records.length === 0) {
    return hydrated;
  }

  const rankedPriorityCount = Math.min(
    hydrated.length,
    Math.max(
      FEED_PRIORITY_POST_COUNT,
      Math.min(30, Math.max(1, args.limit ?? DEFAULT_FEED_LIMIT) * 2)
    )
  );
  const recordsById = new Map(records.map((record) => [record.id, record] as const));
  const priorityRecords = hydrated
    .slice(0, rankedPriorityCount)
    .map((call) => recordsById.get(call.id) ?? null)
    .filter((record): record is CallRecord => Boolean(record));
  if (priorityRecords.length === 0) {
    return hydrated;
  }

  const refreshed = await withSoftTimeout(
    hydrateCalls(priorityRecords, args.viewerId, {
      refreshTraders: false,
      refreshTokens: true,
      ensureTokenLinks: true,
      persistComputed: false,
      preferStoredIntelligence: false,
    }),
    FEED_PRIORITY_REFRESH_TIMEOUT_MS
  );

  if (!refreshed || refreshed.length === 0) {
    return hydrated;
  }

  const refreshedById = new Map(refreshed.map((call) => [call.id, call] as const));
  return sortCalls(
    args.kind,
    hydrated.map((call) => refreshedById.get(call.id) ?? call)
  );
}

export async function computeRealtimeIntelligenceSnapshots(
  records: CallRecord[],
  overrides?: Map<string, RealtimeIntelligenceOverride>
): Promise<Map<string, RealtimePostIntelligenceSnapshot>> {
  if (records.length === 0) {
    return new Map();
  }

  const hydrated = await hydrateCalls(
    records.map((record) => {
      const override = overrides?.get(record.id);
      if (!override) {
        return record;
      }

      return {
        ...record,
        currentMcap:
          override.currentMcap === undefined ? record.currentMcap : override.currentMcap,
        lastMcapUpdate:
          override.lastMcapUpdate === undefined ? record.lastMcapUpdate : override.lastMcapUpdate,
        settled: override.settled === undefined ? record.settled : override.settled,
        settledAt: override.settledAt === undefined ? record.settledAt : override.settledAt,
      };
    }),
    null,
    {
      refreshTraders: false,
      refreshTokens: false,
      ensureTokenLinks: false,
      persistComputed: false,
      preferStoredIntelligence: false,
    }
  );

  const computedAtIso = new Date().toISOString();
  return new Map(
    hydrated.map((call) => [
      call.id,
      {
        confidenceScore: call.confidenceScore,
        hotAlphaScore: call.hotAlphaScore,
        earlyRunnerScore: call.earlyRunnerScore,
        highConvictionScore: call.highConvictionScore,
        timingTier: call.timingTier,
        roiCurrentPct: call.roiCurrentPct,
        bundleRiskLabel: call.bundleRiskLabel,
        tokenRiskScore: call.tokenRiskScore,
        liquidity: call.liquidity,
        volume24h: call.volume24h,
        holderCount: call.holderCount,
        largestHolderPct: call.largestHolderPct,
        top10HolderPct: call.top10HolderPct,
        bundledWalletCount: call.bundledWalletCount,
        estimatedBundledSupplyPct: call.estimatedBundledSupplyPct,
        lastIntelligenceAt: computedAtIso,
      } satisfies RealtimePostIntelligenceSnapshot,
    ])
  );
}

async function prewarmRecentTokenIntelligence(): Promise<void> {
  const recentRecords = await prisma.post.findMany({
    where: {
      OR: [
        { tokenId: { not: null } },
        { contractAddress: { not: null } },
      ],
    },
    select: CALL_SELECT,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: Math.max(INTELLIGENCE_PREWARM_TOKEN_LIMIT * 3, 72),
  });

  if (recentRecords.length === 0) {
    return;
  }

  const ensuredTokenMap = await ensureTokensForCalls(recentRecords);
  const tokenMap = mergeTokenMaps(buildTokenMapFromRecords(recentRecords), ensuredTokenMap);
  const tokensToRefresh = Array.from(tokenMap.values())
    .sort((left, right) => {
      const leftFreshness = left.lastIntelligenceAt?.getTime() ?? 0;
      const rightFreshness = right.lastIntelligenceAt?.getTime() ?? 0;
      if (leftFreshness !== rightFreshness) {
        return leftFreshness - rightFreshness;
      }
      return (right.updatedAt?.getTime?.() ?? 0) - (left.updatedAt?.getTime?.() ?? 0);
    })
    .slice(0, INTELLIGENCE_PREWARM_TOKEN_LIMIT);

  for (let index = 0; index < tokensToRefresh.length; index += 3) {
    const batch = tokensToRefresh.slice(index, index + 3);
    await Promise.allSettled(batch.map((token) => refreshTokenIntelligence(token.id)));
  }
}

async function runIntelligencePriorityLoop(): Promise<void> {
  if (intelligencePriorityLoopInFlight) {
    return intelligencePriorityLoopInFlight;
  }

  intelligencePriorityLoopInFlight = (async () => {
    try {
      await prewarmRecentTokenIntelligence();
    } catch (error) {
      console.warn("[intelligence] priority prewarm failed", error);
    } finally {
      intelligencePriorityLoopInFlight = null;
    }
  })();

  return intelligencePriorityLoopInFlight;
}

export function startIntelligencePriorityLoop(opts?: { canRun?: () => boolean }): void {
  if (opts?.canRun) {
    intelligencePriorityLoopCanRun = opts.canRun;
  }
  if (intelligencePriorityLoopTimer) {
    return;
  }

  const triggerLoop = () => {
    if (intelligencePriorityLoopCanRun && !intelligencePriorityLoopCanRun()) {
      return;
    }
    void runIntelligencePriorityLoop();
  };

  setTimeout(() => {
    triggerLoop();
  }, INTELLIGENCE_PREWARM_START_DELAY_MS);

  intelligencePriorityLoopTimer = setInterval(() => {
    triggerLoop();
  }, INTELLIGENCE_PREWARM_INTERVAL_MS);
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
  const staleCached = peekCacheValue(feedListCache, cacheKey);

  return memoizeCached(feedListCache, feedListInFlight, cacheKey, ttlMs, async () => {
    try {
      const { followedTraderIds, followedTokenIds } =
        args.kind === "following"
          ? await getFollowingSnapshot(args.viewerId)
          : { followedTraderIds: [], followedTokenIds: [] };
      if (args.kind === "following" && followedTraderIds.length === 0 && followedTokenIds.length === 0) {
        return {
          items: [],
          hasMore: false,
          nextCursor: null,
          totalItems: 0,
        };
      }

      const cursorBoundary = await resolveFeedCursorBoundary(args.kind, args.cursor);
      const whereClauses: Prisma.PostWhereInput[] = [];
      const searchWhere = buildSearchWhere(args.search);
      if (searchWhere) {
        whereClauses.push(searchWhere);
      }

      if (args.kind === "following") {
        whereClauses.push({
          OR: [
            ...(followedTraderIds.length > 0 ? [{ authorId: { in: followedTraderIds } }] : []),
            ...(followedTokenIds.length > 0 ? [{ tokenId: { in: followedTokenIds } }] : []),
          ],
        });
      } else if (args.kind !== "latest") {
        whereClauses.push({
          createdAt: {
            gte: new Date(Date.now() - 72 * 60 * 60 * 1000),
          },
        });
      }

      const cursorWhere = buildFeedCursorWhere(cursorBoundary);
      if (cursorWhere) {
        whereClauses.push(cursorWhere);
      }

      const where =
        whereClauses.length === 0
          ? undefined
          : whereClauses.length === 1
            ? whereClauses[0]
            : { AND: whereClauses };
      const isDirectChronologicalFeed = args.kind === "latest" || args.kind === "following";
      const candidateLimit = isDirectChronologicalFeed
        ? Math.max(limit + 1, FEED_PRIORITY_POST_COUNT)
        : limit * 5;
      const records = await prisma.post.findMany({
        where,
        select: CALL_SELECT,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: Math.min(200, Math.max(limit + 1, candidateLimit)),
      });

      const baseHydrated = filterCallsForFeedKind(
        args.kind,
        sortCalls(
          args.kind,
          await hydrateCalls(records, args.viewerId, {
            refreshTraders: false,
            refreshTokens: false,
            ensureTokenLinks: false,
            persistComputed: false,
            preferStoredIntelligence: true,
          })
        )
      );
      const hydrated = filterCallsForFeedKind(
        args.kind,
        await refreshPriorityFeedSlice(args, records, baseHydrated)
      );
      const startIndex =
        isDirectChronologicalFeed && cursorBoundary
          ? 0
          : args.cursor
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
    } catch (error) {
      if (!isTransientPrismaError(error)) {
        throw error;
      }

      if (staleCached) {
        console.warn("[intelligence/feed] serving stale feed cache after transient prisma failure", {
          kind: args.kind,
          viewerId: args.viewerId,
          message: error instanceof Error ? error.message : String(error),
        });
        return staleCached;
      }

      console.warn("[intelligence/feed] feed unavailable during transient prisma pressure; serving empty state", {
        kind: args.kind,
        viewerId: args.viewerId,
        message: error instanceof Error ? error.message : String(error),
      });
      return {
        items: [],
        hasMore: false,
        nextCursor: null,
        totalItems: 0,
        degraded: true,
      };
    }
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

async function listTokenRelatedCallRecords(
  token: TokenRecord,
  normalizedAddress: string,
  take: number
): Promise<CallRecord[]> {
  const records = await prisma.post.findMany({
    where: {
      OR: [
        { tokenId: token.id },
        { contractAddress: normalizedAddress },
      ],
    },
    select: CALL_SELECT,
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take,
  });

  const deduped = new Map<string, CallRecord>();
  for (const record of records) {
    deduped.set(record.id, record);
  }

  return Array.from(deduped.values());
}

function sortTokenCallsForDisplay(calls: EnrichedCall[]): EnrichedCall[] {
  return [...calls].sort((left, right) => {
    const leftRank = left.firstCallerRank ?? Number.MAX_SAFE_INTEGER;
    const rightRank = right.firstCallerRank ?? Number.MAX_SAFE_INTEGER;
    if (leftRank !== rightRank) {
      return leftRank - rightRank;
    }

    const createdAtDelta = new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime();
    if (createdAtDelta !== 0) {
      return createdAtDelta;
    }

    return left.id.localeCompare(right.id);
  });
}

export async function getTokenOverviewByAddress(address: string, viewerId: string | null): Promise<TokenOverview | null> {
  const normalizedAddress = address.trim();
  const cacheKey = `token:${viewerId ?? "anonymous"}:${sanitizeCacheKeyPart(normalizedAddress)}`;
  const ttlMs = viewerId ? PERSONALIZED_TOKEN_OVERVIEW_CACHE_TTL_MS : TOKEN_OVERVIEW_CACHE_TTL_MS;
  const staleOverview = peekCacheValue(tokenOverviewCache, cacheKey);

  return memoizeCached(tokenOverviewCache, tokenOverviewInFlight, cacheKey, ttlMs, async () => {
    let token: TokenRecord | null = null;
    try {
      token = await findTokenByAddress(normalizedAddress);
    } catch (error) {
      if (staleOverview) {
        console.warn("[intelligence/token] base token lookup failed; serving stale overview", {
          address: normalizedAddress,
          viewerId,
          message: error instanceof Error ? error.message : String(error),
        });
        return staleOverview;
      }
      throw error;
    }
    if (!token) return null;

    const staleToken = staleOverview?.token ?? null;
    const forceHydration = tokenNeedsCoreHydration(token);
    const refreshPromise = !staleOverview && shouldRefreshToken(token)
      ? refreshTokenIntelligence(token.id).catch(() => null)
      : null;
    const refreshed = refreshPromise
      ? await withSoftTimeout(
          refreshPromise,
          forceHydration ? Math.max(TOKEN_REFRESH_SOFT_TIMEOUT_MS, 4_500) : TOKEN_REFRESH_SOFT_TIMEOUT_MS
        )
      : null;
    const currentToken = refreshed?.token ?? token;
    const needsFallbackTokenData =
      tokenNeedsCoreHydration(currentToken) ||
      !hasFiniteMetric(currentToken.liquidity) ||
      !hasFiniteMetric(currentToken.volume24h) ||
      (currentToken.chainType === "solana" &&
        (!hasPositiveMetric(currentToken.holderCount) ||
          !hasFiniteMetric(currentToken.top10HolderPct) ||
          !hasFiniteMetric(currentToken.largestHolderPct)));

    const [callsRaw, clusters, snapshots, events, tokenFollow, dexStatsFallback, distributionFallback] = await Promise.all([
      resolveTokenOverviewSection(
        "related_calls_query",
        () => listTokenRelatedCallRecords(currentToken, normalizedAddress, 80),
        [] as CallRecord[]
      ),
      resolveTokenOverviewSection(
        "bundle_clusters_query",
        () =>
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
        [] as Array<{
          id: string;
          clusterLabel: string;
          walletCount: number;
          estimatedSupplyPct: number;
          evidenceJson: unknown;
        }>
      ),
      resolveTokenOverviewSection(
        "metric_snapshots_query",
        () =>
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
        [] as Array<{
          capturedAt: Date;
          marketCap: number | null;
          liquidity: number | null;
          volume24h: number | null;
          holderCount: number | null;
          sentimentScore: number | null;
          confidenceScore: number | null;
        }>
      ),
      resolveTokenOverviewSection(
        "timeline_events_query",
        () =>
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
        [] as Array<{
          id: string;
          eventType: string;
          timestamp: Date;
          marketCap: number | null;
          liquidity: number | null;
          volume: number | null;
          traderId: string | null;
          postId: string | null;
          metadata: Prisma.JsonValue | null;
        }>
      ),
      viewerId
        ? resolveTokenOverviewSection(
            "viewer_follow_query",
            () =>
              prisma.tokenFollow.findUnique({
                where: {
                  userId_tokenId: {
                    userId: viewerId,
                    tokenId: currentToken.id,
                  },
                },
                select: { id: true },
              }),
            staleToken?.isFollowing ? ({ id: "__stale__" } as { id: string }) : null
          )
        : Promise.resolve(null),
      needsFallbackTokenData
        ? resolveTokenOverviewSection(
            "dex_stats_query",
            () => fetchDexTokenStats(currentToken.address, currentToken.chainType),
            null as DexTokenStats | null
          )
        : Promise.resolve(null),
      needsFallbackTokenData && currentToken.chainType === "solana"
        ? resolveTokenOverviewSection(
            "distribution_query",
            () => analyzeSolanaTokenDistribution(currentToken.address, currentToken.liquidity),
            null,
            { timeoutMs: TOKEN_OVERVIEW_DISTRIBUTION_SECTION_TIMEOUT_MS }
          )
        : Promise.resolve(null),
    ]);

    const hydratedCalls =
      callsRaw.length > 0
        ? await resolveTokenOverviewSection(
            "hydrate_calls",
            () =>
              hydrateCalls(callsRaw, viewerId, {
                refreshTraders: false,
                refreshTokens: false,
                ensureTokenLinks: false,
                persistComputed: false,
              }),
            staleToken?.recentCalls ?? ([] as EnrichedCall[])
          )
        : staleToken?.recentCalls ?? [];
    const recentCalls = sortTokenCallsForDisplay(hydratedCalls);
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
    const sentimentTrendAdjustment = computeDexSentimentTrendAdjustment(dexStatsFallback);
    const hasLiveSentimentInputs =
      totalSentimentReactions > 0 ||
      hasFiniteMetric(currentToken.sentimentScore) ||
      sentimentTrendAdjustment !== 0;
    const computedSentimentScore = roundMetricOrZero(
      computeSentimentScore({
        reactions: allReactionCounts,
        sentimentTrendAdjustment:
          sentimentTrendAdjustment + (currentToken.sentimentScore !== null ? (currentToken.sentimentScore - 50) * 0.2 : 0),
      })
    );
    const sentimentScore = roundMetricOrZero(
      pickFirstFiniteMetric(
        hasLiveSentimentInputs ? computedSentimentScore : null,
        currentToken.sentimentScore,
        staleToken?.sentiment?.score
      ) ?? 0
    );
    const resolvedLiquidity = roundMetric(
      pickFirstPositiveMetric(currentToken.liquidity, dexStatsFallback?.liquidityUsd, staleToken?.liquidity)
    );
    const resolvedVolume24h = roundMetric(
      pickFirstPositiveMetric(currentToken.volume24h, dexStatsFallback?.volume24hUsd, staleToken?.volume24h)
    );
    const latestSnapshotMarketCap =
      snapshots.length > 0 ? snapshots[snapshots.length - 1]?.marketCap ?? null : null;
    const resolvedMarketCap = roundMetric(
      pickFirstPositiveMetric(
        dexStatsFallback?.marketCap,
        latestSnapshotMarketCap,
        recentCalls[0]?.currentMcap,
        recentCalls[0]?.entryMcap,
        events.find((event) => hasFiniteMetric(event.marketCap))?.marketCap,
        staleToken?.marketCap
      )
    );
    const staleTopHolders =
      staleToken?.topHolders && staleToken.topHolders.length > 0
        ? cloneCachedValue(staleToken.topHolders)
        : [];
    const staleDevWallet =
      staleToken?.devWallet
        ? cloneCachedValue(staleToken.devWallet)
        : null;
    const hasFreshDistributionTelemetry = Boolean(distributionFallback);
    const canTrustStoredSolanaHolderTelemetry =
      currentToken.chainType !== "solana" || staleTopHolders.length > 0;
    const resolvedHolderCount = Math.round(
      pickFirstPositiveMetric(
        distributionFallback?.holderCount,
        canTrustStoredSolanaHolderTelemetry ? currentToken.holderCount : null,
        canTrustStoredSolanaHolderTelemetry ? staleToken?.holderCount : null
      ) ?? 0
    ) || null;
    const resolvedHolderCountSource =
      distributionFallback?.holderCountSource ??
      (staleTopHolders.length > 0 ? staleToken?.holderCountSource ?? "largest_accounts" : null) ??
      (currentToken.chainType !== "solana" && resolvedHolderCount !== null ? "stored" : null);
    const resolvedLargestHolderPct = roundMetric(
      pickFirstFiniteMetric(
        distributionFallback?.largestHolderPct,
        currentToken.largestHolderPct,
        staleToken?.largestHolderPct
      )
    );
    const resolvedTop10HolderPct = roundMetric(
      pickFirstFiniteMetric(
        distributionFallback?.top10HolderPct,
        currentToken.top10HolderPct,
        staleToken?.top10HolderPct
      )
    );
    const resolvedDeployerSupplyPct = roundMetric(
      pickFirstFiniteMetric(
        distributionFallback?.deployerSupplyPct,
        currentToken.deployerSupplyPct,
        staleToken?.deployerSupplyPct
      )
    );
    const resolvedBundledWalletCount =
      distributionFallback?.bundledWalletCount ??
      currentToken.bundledWalletCount ??
      staleToken?.bundledWalletCount ??
      null;
    const resolvedEstimatedBundledSupplyPct = roundMetric(
      pickFirstFiniteMetric(
        distributionFallback?.estimatedBundledSupplyPct,
        currentToken.estimatedBundledSupplyPct,
        staleToken?.estimatedBundledSupplyPct
      )
    );
    const resolvedTokenRiskScore = roundMetric(
      pickFirstFiniteMetric(
        distributionFallback?.tokenRiskScore,
        currentToken.tokenRiskScore,
        staleToken?.tokenRiskScore
      )
    );
    const resolvedBundleRiskLabel =
      distributionFallback?.bundleRiskLabel ??
      currentToken.bundleRiskLabel ??
      staleToken?.bundleRiskLabel ??
      (resolvedTokenRiskScore !== null ? determineBundleRiskLabel(resolvedTokenRiskScore) : null);
    const resolvedTopHolders =
      hasFreshDistributionTelemetry &&
      distributionFallback?.topHolders &&
      distributionFallback.topHolders.length > 0
        ? cloneCachedValue(distributionFallback.topHolders)
        : staleTopHolders;
    const resolvedDevWallet =
      hasFreshDistributionTelemetry && distributionFallback?.devWallet
        ? cloneCachedValue(distributionFallback.devWallet)
        : staleDevWallet;
    const resolvedConfidenceScore = roundMetric(
      pickFirstFiniteMetric(
        currentToken.confidenceScore,
        staleToken?.confidenceScore,
        recentCalls.length > 0
          ? recentCalls.reduce((sum, call) => sum + finite(call.confidenceScore), 0) / recentCalls.length
          : null
      )
    );
    const resolvedHotAlphaScore = roundMetric(
      pickFirstFiniteMetric(
        currentToken.hotAlphaScore,
        staleToken?.hotAlphaScore,
        recentCalls.length > 0
          ? recentCalls.reduce((sum, call) => sum + finite(call.hotAlphaScore), 0) / recentCalls.length
          : null
      )
    );
    const resolvedEarlyRunnerScore = roundMetric(
      pickFirstFiniteMetric(
        currentToken.earlyRunnerScore,
        staleToken?.earlyRunnerScore,
        recentCalls.length > 0
          ? Math.max(...recentCalls.map((call) => finite(call.earlyRunnerScore)))
          : null
      )
    );
    const resolvedHighConvictionScore = roundMetric(
      pickFirstFiniteMetric(
        currentToken.highConvictionScore,
        staleToken?.highConvictionScore,
        recentCalls.length > 0
          ? recentCalls.reduce((sum, call) => sum + finite(call.highConvictionScore), 0) / recentCalls.length
          : null
      )
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
        rankingScore: number;
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
        rankingScore: 0,
      };
      current.callsCount += 1;
      current.totalConfidence += call.confidenceScore;
      current.bestRoiPct = Math.max(
        current.bestRoiPct,
        finite(call.roiPeakPct, finite(call.roiCurrentPct, -100))
      );
      current.rankingScore +=
        call.confidenceScore * 0.42 +
        finite(call.author.trustScore) * 0.22 +
        pct(call.roiPeakPct, 220) * 0.22 +
        pct(call.entryQualityScore, 100) * 0.14;
      topTraderMap.set(call.author.id, current);
    }

    const topTraders = Array.from(topTraderMap.values())
      .map((entry) => ({
        ...entry,
        avgConfidenceScore: entry.callsCount > 0 ? roundMetricOrZero(entry.totalConfidence / entry.callsCount) : 0,
        bestRoiPct: roundMetricOrZero(entry.bestRoiPct),
      }))
      .sort((left, right) => {
        const rankingDelta = right.rankingScore - left.rankingScore;
        if (rankingDelta !== 0) return rankingDelta;
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
    const snapshotChart = snapshots.map((snapshot) => ({
          timestamp: snapshot.capturedAt.toISOString(),
          marketCap: snapshot.marketCap,
          liquidity: snapshot.liquidity,
          volume24h: snapshot.volume24h,
          holderCount: snapshot.holderCount,
          sentimentScore: snapshot.sentimentScore,
          confidenceScore: snapshot.confidenceScore,
        }));
    const derivedChart = [
          recentCalls[recentCalls.length - 1]
            ? {
                timestamp: recentCalls[recentCalls.length - 1]!.createdAt.toISOString(),
                marketCap: pickFirstPositiveMetric(
                  recentCalls[recentCalls.length - 1]!.entryMcap,
                  recentCalls[recentCalls.length - 1]!.currentMcap
                ),
                liquidity: resolvedLiquidity,
                volume24h: resolvedVolume24h,
                holderCount: resolvedHolderCount,
                sentimentScore,
                confidenceScore: resolvedConfidenceScore,
              }
            : null,
          {
            timestamp:
              currentToken.lastIntelligenceAt?.toISOString() ??
              currentToken.updatedAt.toISOString(),
            marketCap: resolvedMarketCap,
            liquidity: resolvedLiquidity,
            volume24h: resolvedVolume24h,
            holderCount: resolvedHolderCount,
            sentimentScore,
            confidenceScore: resolvedConfidenceScore,
          },
        ].filter((point): point is NonNullable<typeof point> => point !== null);
    const chart =
      snapshotChart.length > 1
        ? snapshotChart
        : hasMeaningfulTokenOverviewChart(staleToken?.chart)
          ? cloneCachedValue(staleToken.chart)
          : derivedChart;

    const bundleClusters =
      clusters.length > 0
        ? clusters
        : staleToken?.bundleClusters && staleToken.bundleClusters.length > 0
          ? cloneCachedValue(staleToken.bundleClusters)
        : (distributionFallback?.clusters ?? []).map((cluster) => ({
            id: `derived:${currentToken.id}:${cluster.clusterLabel}`,
            clusterLabel: cluster.clusterLabel,
            walletCount: cluster.walletCount,
            estimatedSupplyPct: cluster.estimatedSupplyPct,
            evidenceJson: cluster.evidenceJson,
          }));

    const timeline = [
      ...events.map((event) => ({
        ...event,
        timestamp: event.timestamp.toISOString(),
      })),
      ...derivedTimeline,
    ]
      .sort((left, right) => new Date(right.timestamp).getTime() - new Date(left.timestamp).getTime())
      .slice(0, 48);

    return {
      token: {
        ...currentToken,
        marketCap: resolvedMarketCap,
        liquidity: resolvedLiquidity,
        volume24h: resolvedVolume24h,
        holderCount: resolvedHolderCount,
        holderCountSource: resolvedHolderCountSource,
        largestHolderPct: resolvedLargestHolderPct,
        top10HolderPct: resolvedTop10HolderPct,
        topHolders: resolvedTopHolders,
        devWallet: resolvedDevWallet,
        deployerSupplyPct: resolvedDeployerSupplyPct,
        bundledWalletCount: resolvedBundledWalletCount,
        estimatedBundledSupplyPct: resolvedEstimatedBundledSupplyPct,
        bundleRiskLabel: resolvedBundleRiskLabel,
        tokenRiskScore: resolvedTokenRiskScore,
        sentimentScore,
        confidenceScore: resolvedConfidenceScore,
        hotAlphaScore: resolvedHotAlphaScore,
        earlyRunnerScore: resolvedEarlyRunnerScore,
        highConvictionScore: resolvedHighConvictionScore,
        isFollowing: viewerId ? Boolean(tokenFollow) : false,
        bundleClusters,
        chart,
        callsCount: recentCalls.length > 0 ? recentCalls.length : staleToken?.callsCount ?? 0,
        distinctTraders: topTraderMap.size > 0 ? topTraderMap.size : staleToken?.distinctTraders ?? 0,
        topTraders: topTraders.length > 0 ? topTraders : cloneCachedValue(staleToken?.topTraders ?? []),
        sentiment: {
          score: sentimentScore,
          reactions: allReactionCounts,
          bullishPct: totalSentimentReactions > 0 ? roundMetricOrZero((bullishReactions / totalSentimentReactions) * 100) : 0,
          bearishPct: totalSentimentReactions > 0 ? roundMetricOrZero((bearishReactions / totalSentimentReactions) * 100) : 0,
        },
        risk: {
          tokenRiskScore: resolvedTokenRiskScore,
          bundleRiskLabel: resolvedBundleRiskLabel,
          largestHolderPct: resolvedLargestHolderPct,
          top10HolderPct: resolvedTop10HolderPct,
          bundledWalletCount: resolvedBundledWalletCount,
          estimatedBundledSupplyPct: resolvedEstimatedBundledSupplyPct,
          deployerSupplyPct: resolvedDeployerSupplyPct,
          holderCount: resolvedHolderCount,
          topHolders: resolvedTopHolders,
          devWallet: resolvedDevWallet,
        },
        timeline: timeline.length > 0 ? timeline : cloneCachedValue(staleToken?.timeline ?? []),
        recentCalls: recentCalls.length > 0 ? recentCalls : cloneCachedValue(staleToken?.recentCalls ?? []),
      },
    };
  });
}

export async function listTokenCallsByAddress(address: string, viewerId: string | null): Promise<EnrichedCall[]> {
  const token = await findTokenByAddress(address);
  if (!token) return [];
  const records = await listTokenRelatedCallRecords(token, address.trim(), 80);
  return sortTokenCallsForDisplay(await hydrateCalls(records, viewerId, {
    refreshTraders: false,
    refreshTokens: false,
    ensureTokenLinks: false,
    persistComputed: false,
  }));
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

async function computeDailyLeaderboardsPayload(): Promise<LeaderboardsPayload> {
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

  const todaysCalls = await hydrateCalls(todaysCallsRaw, null, {
    refreshTraders: false,
    refreshTokens: false,
    ensureTokenLinks: false,
    persistComputed: false,
    preferStoredIntelligence: true,
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
    topAlphaToday: [...todaysCalls]
      .sort((left, right) => right.hotAlphaScore - left.hotAlphaScore)
      .slice(0, 12),
    biggestRoiToday: [...todaysCalls]
      .sort((left, right) => finite(right.roiPeakPct, -100) - finite(left.roiPeakPct, -100))
      .slice(0, 12),
    bestEntryToday: [...todaysCalls]
      .filter((call) => call.firstCallerRank === 1 || call.timingTier === "FIRST CALLER")
      .sort((left, right) => finite(right.roiPeakPct, -100) - finite(left.roiPeakPct, -100))
      .slice(0, 12),
  };
}

export async function listDailyLeaderboards(_viewerId: string | null): Promise<LeaderboardsPayload> {
  const cacheKey = "leaderboards:daily:global";
  const staleCached = peekCacheValue(dailyLeaderboardsCache, cacheKey);
  return memoizeCached(
    dailyLeaderboardsCache,
    dailyLeaderboardsInFlight,
    cacheKey,
    LEADERBOARD_CACHE_TTL_MS,
    async () => {
      const snapshot = await readAggregateSnapshotPayload(
        DAILY_LEADERBOARD_SNAPSHOT_KEY,
        LEADERBOARD_SNAPSHOT_VERSION,
        parseLeaderboardsPayloadSnapshot
      );

      if (snapshot.fresh) {
        return snapshot.fresh;
      }

      try {
        const payload = await computeDailyLeaderboardsPayload();
        await writeAggregateSnapshotPayload(
          DAILY_LEADERBOARD_SNAPSHOT_KEY,
          LEADERBOARD_SNAPSHOT_VERSION,
          payload,
          LEADERBOARD_SNAPSHOT_TTL_MS
        );
        return payload;
      } catch (error) {
        if (staleCached) {
          console.warn("[intelligence] serving stale in-memory daily leaderboard cache", {
            message: error instanceof Error ? error.message : String(error),
          });
          return staleCached;
        }
        if (snapshot.stale) {
          console.warn("[intelligence] serving stale daily leaderboard snapshot", {
            message: error instanceof Error ? error.message : String(error),
          });
          return snapshot.stale;
        }
        console.warn("[intelligence] daily leaderboard compute failed; serving empty payload", {
          message: error instanceof Error ? error.message : String(error),
        });
        return {
          topTradersToday: [],
          topAlphaToday: [],
          biggestRoiToday: [],
          bestEntryToday: [],
        };
      }
    }
  );
}

async function computeFirstCallerLeaderboardsPayload(): Promise<FirstCallerLeaderboardRow[]> {
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

  const traderIds = traders.map((trader) => trader.id);
  if (traderIds.length === 0) {
    return [];
  }

  const callsRaw = await prisma.post.findMany({
    where: {
      authorId: { in: traderIds },
    },
    select: CALL_SELECT,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: 320,
  });
  const firstCalls = (
    await hydrateCalls(callsRaw, null, {
      refreshTraders: false,
      refreshTokens: false,
      ensureTokenLinks: false,
      persistComputed: false,
      preferStoredIntelligence: true,
    })
  ).filter((call) => call.firstCallerRank === 1);
  const confidenceByTrader = new Map<string, { total: number; count: number }>();
  for (const call of firstCalls) {
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

export async function listFirstCallerLeaderboards(_viewerId: string | null): Promise<FirstCallerLeaderboardRow[]> {
  const cacheKey = "leaderboards:first-callers:global";
  const staleCached = peekCacheValue(firstCallerLeaderboardsCache, cacheKey);
  return memoizeCached(
    firstCallerLeaderboardsCache,
    firstCallerLeaderboardsInFlight,
    cacheKey,
    LEADERBOARD_CACHE_TTL_MS,
    async () => {
      const snapshot = await readAggregateSnapshotPayload(
        FIRST_CALLER_LEADERBOARD_SNAPSHOT_KEY,
        LEADERBOARD_SNAPSHOT_VERSION,
        parseFirstCallerLeaderboardRowsSnapshot
      );

      if (snapshot.fresh) {
        return snapshot.fresh;
      }

      try {
        const payload = await computeFirstCallerLeaderboardsPayload();
        await writeAggregateSnapshotPayload(
          FIRST_CALLER_LEADERBOARD_SNAPSHOT_KEY,
          LEADERBOARD_SNAPSHOT_VERSION,
          payload,
          LEADERBOARD_SNAPSHOT_TTL_MS
        );
        return payload;
      } catch (error) {
        if (staleCached) {
          console.warn("[intelligence] serving stale in-memory first-caller leaderboard cache", {
            message: error instanceof Error ? error.message : String(error),
          });
          return staleCached;
        }
        if (snapshot.stale) {
          console.warn("[intelligence] serving stale first-caller leaderboard snapshot", {
            message: error instanceof Error ? error.message : String(error),
          });
          return snapshot.stale;
        }
        console.warn("[intelligence] first-caller leaderboard compute failed; serving empty payload", {
          message: error instanceof Error ? error.message : String(error),
        });
        return [];
      }
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
