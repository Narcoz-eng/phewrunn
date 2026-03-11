import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { prisma, withPrismaRetry } from "../prisma.js";
import { type AuthVariables, requireAuth, requireNotBanned } from "../auth.js";
import {
  CreatePostSchema,
  CreateCommentSchema,
  FeedQuerySchema,
  detectContractAddress,
  MIN_LEVEL,
  MAX_LEVEL,
  LIQUIDATION_LEVEL,
  calculateXpChange,
  calculate6HXpChange,
  calculateFinalLevel,
  calculate1HSettlement,
  calculate6HSettlement,
  DAILY_POST_LIMIT,
  DAILY_COMMENT_LIMIT,
  DAILY_REPOST_LIMIT,
  SETTLEMENT_1H_MS,
  SETTLEMENT_6H_MS,
} from "../types.js";
import {
  fetchMarketCap as fetchMarketCapService,
  needsMcapUpdate,
  determineTrackingMode,
  isReadyFor1HSettlement,
  isReadyFor6HSnapshot,
  TRACKING_MODE_ACTIVE,
  TRACKING_MODE_SETTLED,
  type MarketCapResult,
} from "../services/marketcap.js";
import {
  getWalletTradeSnapshotsForSolanaTokens,
  getHeliusTokenMetadataForMint,
  getParsedSolanaTransaction,
  isHeliusConfigured,
  type ParsedSolanaInstruction,
  type ParsedSolanaTransaction,
} from "../services/helius.js";
import { invalidateLeaderboardCaches } from "./leaderboard.js";
import { invalidateNotificationsCache } from "./notifications.js";
import { cacheGetJson, cacheSetJson } from "../lib/redis.js";
import { getEnrichedCallById } from "../services/intelligence/engine.js";
import { fanoutPostedAlphaAlert } from "../services/intelligence/alerts.js";

export const postsRouter = new Hono<{ Variables: AuthVariables }>();

type SettlementRunResult = {
  settled1h: number;
  snapshot6h: number;
  levelChanges6h: number;
  errors: number;
  skipped?: boolean;
  reason?: string;
};

type MarketRefreshRunResult = {
  scannedPosts: number;
  eligiblePosts: number;
  refreshedContracts: number;
  updatedPosts: number;
  errors: number;
};

type MaintenanceRunResult = {
  startedAt: string;
  durationMs: number;
  settlement: SettlementRunResult;
  marketRefresh: MarketRefreshRunResult;
  snapshotWarmup?: {
    attempted: number;
    succeeded: number;
    failed: number;
    durationMs: number;
    skipped?: boolean;
    reason?: string;
  };
};

type JupiterProxyResult = {
  status: number;
  bodyText: string;
  contentType: string | null;
};

type NormalizedChartCandle = {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

type ChartCandlesSource = "birdeye" | "geckoterminal";

type ChartCandlesFetchResult = {
  source: ChartCandlesSource;
  network: "solana" | "eth";
  candles: NormalizedChartCandle[];
};

type ChartCandlesSourceHealth = {
  source: ChartCandlesSource;
  avgLatencyMs: number;
  lastSuccessAtMs: number;
  lastFailureAtMs: number;
  lastCandleTimestampSec: number;
  consecutiveFailures: number;
  successCount: number;
  failureCount: number;
  cooldownUntilMs: number;
};

type FeedResponsePayload = {
  data: unknown[];
  hasMore: boolean;
  nextCursor: string | null;
  totalPosts?: number | null;
};

type PostPriceResponsePayload = {
  currentMcap: number | null;
  entryMcap: number | null;
  mcap1h: number | null;
  mcap6h: number | null;
  percentChange: number | null;
  trackingMode: string | null;
  lastMcapUpdate: string | null;
  settled: boolean;
  settledAt: string | null;
};

type EndpointConcurrencyLease = {
  release: () => void;
};

type EndpointConcurrencyLimiter = {
  label: string;
  limit: number;
  tryAcquire: () => EndpointConcurrencyLease | null;
  current: () => number;
};

function readPositiveIntEnv(name: string): number | null {
  const raw = process.env[name];
  if (!raw) return null;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
}

function createEndpointConcurrencyLimiter(label: string, configuredLimit: number): EndpointConcurrencyLimiter {
  let inFlight = 0;
  const limit = configuredLimit > 0 ? configuredLimit : Number.MAX_SAFE_INTEGER;

  return {
    label,
    limit,
    tryAcquire() {
      if (inFlight >= limit) {
        return null;
      }

      inFlight += 1;
      let released = false;

      return {
        release() {
          if (released) return;
          released = true;
          inFlight = Math.max(0, inFlight - 1);
        },
      };
    },
    current() {
      return inFlight;
    },
  };
}

let maintenanceRunInFlight: Promise<MaintenanceRunResult> | null = null;
let settlementRunInFlight: Promise<SettlementRunResult> | null = null;
let lastMaintenanceRunStartedAt = 0;
let lastSettlementRunStartedAt = 0;
let lastCronMaintenanceCompletedAt = 0;
let lastLeaderboardSnapshotWarmAt = 0;
let leaderboardSnapshotWarmCursor = 0;
const MAINTENANCE_RUN_MIN_INTERVAL_MS = process.env.NODE_ENV === "production" ? 30_000 : 5_000;
const SETTLEMENT_RUN_MIN_INTERVAL_MS = process.env.NODE_ENV === "production" ? 20_000 : 4_000;
const LEADERBOARD_SNAPSHOT_WARM_INTERVAL_MS =
  process.env.NODE_ENV === "production" ? 5 * 60_000 : 30_000;
const CRON_MAINTENANCE_HEALTH_WINDOW_MS =
  process.env.NODE_ENV === "production" ? 3 * 60_000 : 20_000;
const MAINTENANCE_STALE_PROBE_COOLDOWN_MS =
  process.env.NODE_ENV === "production" ? 25_000 : 5_000;
const priceRefreshInFlight = new Map<string, Promise<number | null>>();
const TRENDING_CACHE_TTL_MS = process.env.NODE_ENV === "production" ? 30_000 : 10_000;
const TRENDING_LIVE_GAIN_PRIORITY_PCT = process.env.NODE_ENV === "production" ? 25 : 15;
let trendingCache: { data: unknown; expiresAtMs: number } | null = null;
let trendingInFlight: Promise<unknown> | null = null;
const FEED_MCAP_CACHE_TTL_MS = process.env.NODE_ENV === "production" ? 15_000 : 5_000;
const FEED_RESPONSE_CACHE_TTL_MS = process.env.NODE_ENV === "production" ? 9_000 : 3_000;
const FEED_RESPONSE_STALE_FALLBACK_MS =
  process.env.NODE_ENV === "production" ? 2 * 60_000 : 30_000;
const FEED_DB_QUERY_TIMEOUT_MS = process.env.NODE_ENV === "production" ? 4_000 : 4_800;
const FEED_SOCIAL_QUERY_TIMEOUT_MS = process.env.NODE_ENV === "production" ? 2_600 : 3_500;
const FEED_ENRICH_TIMEOUT_MS = process.env.NODE_ENV === "production" ? 2_800 : 3_800;
const FEED_SHARED_RESPONSE_REDIS_KEY_PREFIX = "posts:feed:shared:v1";
const FEED_CARD_SNAPSHOT_TTL_MS = process.env.NODE_ENV === "production" ? 10 * 60_000 : 2 * 60_000;
const FEED_CARD_SNAPSHOT_MAX_ENTRIES = process.env.NODE_ENV === "production" ? 16_000 : 2_000;
const FEED_DEGRADED_CIRCUIT_TTL_MS = process.env.NODE_ENV === "production" ? 45_000 : 15_000;
const FEED_TOTAL_POST_COUNT_CACHE_TTL_MS = process.env.NODE_ENV === "production" ? 60_000 : 10_000;
const POST_PRICE_CACHE_TTL_MS = process.env.NODE_ENV === "production" ? 12_000 : 4_000;
const POST_PRICE_ACTIVE_STALE_FALLBACK_MS =
  process.env.NODE_ENV === "production" ? 75_000 : 20_000;
const POST_PRICE_SETTLED_STALE_FALLBACK_MS =
  process.env.NODE_ENV === "production" ? 10 * 60_000 : 2 * 60_000;
const POST_PRICE_CACHE_MAX_ENTRIES = process.env.NODE_ENV === "production" ? 40_000 : 4_000;
const POST_PRICE_REDIS_KEY_PREFIX = "posts:price:v1";
const SHARED_ALPHA_CACHE_TTL_MS = process.env.NODE_ENV === "production" ? 60_000 : 10_000;
const FEED_ENABLE_LIVE_SHARED_ALPHA = (() => {
  const raw = process.env.FEED_ENABLE_LIVE_SHARED_ALPHA?.trim().toLowerCase();
  if (raw === "true") return true;
  if (raw === "false") return false;
  return process.env.NODE_ENV !== "production";
})();
const FEED_MAX_CONCURRENT_REQUESTS =
  readPositiveIntEnv("FEED_MAX_CONCURRENT_REQUESTS") ??
  (process.env.NODE_ENV === "production" ? 8 : 4);
const MAINTENANCE_MAX_CONCURRENT_REQUESTS =
  readPositiveIntEnv("MAINTENANCE_MAX_CONCURRENT_REQUESTS") ??
  1;
const SETTLEMENT_MAX_CONCURRENT_REQUESTS =
  readPositiveIntEnv("SETTLEMENT_MAX_CONCURRENT_REQUESTS") ??
  1;
const SETTLEMENT_RUN_LOCK_TTL_MS =
  readPositiveIntEnv("SETTLEMENT_RUN_LOCK_TTL_MS") ??
  (process.env.NODE_ENV === "production" ? 120_000 : 45_000);
const SETTLEMENT_RUN_LOCK_REFRESH_INTERVAL_MS = Math.max(
  5_000,
  Math.floor(SETTLEMENT_RUN_LOCK_TTL_MS / 3)
);
const SETTLEMENT_RUN_LOCK_KEY = "runtime-lock:settlement:v1";
const runtimeInstanceId = `${process.pid}:${randomUUID().slice(0, 8)}`;
const feedRequestLimiter = createEndpointConcurrencyLimiter(
  "posts/feed",
  FEED_MAX_CONCURRENT_REQUESTS
);
const maintenanceRequestLimiter = createEndpointConcurrencyLimiter(
  "posts/maintenance",
  MAINTENANCE_MAX_CONCURRENT_REQUESTS
);
const settlementRequestLimiter = createEndpointConcurrencyLimiter(
  "posts/settle",
  SETTLEMENT_MAX_CONCURRENT_REQUESTS
);
const FEED_ENABLE_LIVE_WALLET_ENRICHMENT = (() => {
  const raw = process.env.FEED_ENABLE_LIVE_WALLET_ENRICHMENT?.trim().toLowerCase();
  if (raw === "true") return true;
  if (raw === "false") return false;
  return process.env.NODE_ENV !== "production";
})();
const MARKET_REFRESH_LOOKBACK_MS = process.env.NODE_ENV === "production" ? 7 * 24 * 60 * 60 * 1000 : 24 * 60 * 60 * 1000;
const MARKET_REFRESH_SCAN_LIMIT = process.env.NODE_ENV === "production" ? 160 : 60;
const MARKET_REFRESH_MAX_CONTRACTS_PER_RUN = process.env.NODE_ENV === "production" ? 20 : 8;
const SETTLEMENT_1H_TARGET_PER_RUN = process.env.NODE_ENV === "production" ? 28 : 14;
const SETTLEMENT_1H_SCAN_MULTIPLIER = process.env.NODE_ENV === "production" ? 6 : 4;
const SETTLEMENT_6H_TARGET_PER_RUN = process.env.NODE_ENV === "production" ? 20 : 10;
const SETTLEMENT_6H_SCAN_MULTIPLIER = process.env.NODE_ENV === "production" ? 5 : 3;
const ALPHA_SCORE_WINDOW_MS = 6 * 60 * 60 * 1000;
const HOURLY_POST_LIMIT = 10;
const CREATE_POST_MARKETCAP_TIMEOUT_MS = process.env.NODE_ENV === "production" ? 1_500 : 2_200;
const CREATE_POST_HELIUS_TIMEOUT_MS = process.env.NODE_ENV === "production" ? 1_200 : 1_800;
const FOLLOWER_BIG_GAIN_ALERT_THRESHOLD_PCT = 50;
const FEED_HELIUS_ENRICH_MAX_POSTS_PER_REQUEST = process.env.NODE_ENV === "production" ? 6 : 3;
const SHARED_ALPHA_STALE_FALLBACK_MS =
  process.env.NODE_ENV === "production" ? 10 * 60_000 : 2 * 60_000;
const feedMcapCache = new Map<string, { result: MarketCapResult; expiresAtMs: number }>();
const feedMcapInFlight = new Map<string, Promise<MarketCapResult>>();
const sharedAlphaAuthorCache = new Map<string, { authorIds: Set<string>; expiresAtMs: number }>();
const sharedAlphaWarmInFlight = new Map<string, Promise<void>>();
const sharedAlphaResponseCache = new Map<
  string,
  {
    data: {
      users: Array<Record<string, unknown>>;
      count: number;
    };
    expiresAtMs: number;
    staleUntilMs: number;
  }
>();
const feedCardSnapshotCache = new Map<
  string,
  {
    snapshot: Record<string, unknown>;
    expiresAtMs: number;
  }
>();
let feedTotalPostCountCache: { count: number; expiresAtMs: number } | null = null;
const feedResponseCache = new Map<
  string,
  {
    payload: FeedResponsePayload;
    expiresAtMs: number;
    staleUntilMs: number;
  }
>();
const feedSharedResponseCache = new Map<
  string,
  {
    payload: FeedResponsePayload;
    expiresAtMs: number;
    staleUntilMs: number;
  }
>();
const postPriceResponseCache = new Map<
  string,
  {
    data: PostPriceResponsePayload;
    expiresAtMs: number;
    staleUntilMs: number;
  }
>();
const hasCronMaintenanceConfigured = !!process.env.CRON_SECRET?.trim();
let feedDegradedCircuitState: {
  openUntilMs: number;
  openedAtMs: number;
  reason: string;
} | null = null;
const opportunisticMaintenanceEnabled = (() => {
  const raw = process.env.POSTS_ENABLE_OPPORTUNISTIC_MAINTENANCE?.trim().toLowerCase();
  if (raw === "true") return true;
  if (raw === "false") return false;
  // In production, keep the fallback runner enabled unless explicitly turned off.
  // It is throttled and only activates when cron is missing or unhealthy.
  return true;
})();

function isCronMaintenanceHealthy(): boolean {
  if (!hasCronMaintenanceConfigured) return false;
  if (!lastCronMaintenanceCompletedAt) return false;
  return Date.now() - lastCronMaintenanceCompletedAt < CRON_MAINTENANCE_HEALTH_WINDOW_MS;
}

function shouldRunOpportunisticMaintenance(): boolean {
  if (!opportunisticMaintenanceEnabled) return false;
  return !hasCronMaintenanceConfigured || !isCronMaintenanceHealthy();
}

type MaintenanceCandidatePost = {
  createdAt: Date;
  settled: boolean;
  mcap6h: number | null;
  entryMcap: number | null;
};

function shouldTriggerMaintenanceForPost(post: MaintenanceCandidatePost): boolean {
  if (post.entryMcap === null || post.entryMcap <= 0) return false;
  return (
    isReadyFor1HSettlement(post.createdAt, post.settled) ||
    isReadyFor6HSnapshot(post.createdAt, post.mcap6h)
  );
}

function triggerMaintenanceForStaleCandidates(
  reason: string,
  posts: MaintenanceCandidatePost[]
): void {
  if (!shouldRunOpportunisticMaintenance()) return;
  if (!posts.some(shouldTriggerMaintenanceForPost)) return;

  const now = Date.now();
  if (now - lastSettlementRunStartedAt < MAINTENANCE_STALE_PROBE_COOLDOWN_MS) return;

  triggerSettlementCycleNonBlocking(reason);
}

function buildFeedResponseCacheKey(params: {
  userId: string | null;
  sort: "latest" | "trending";
  following: boolean;
  limit: number;
  cursor?: string;
  search?: string;
}): string {
  return [
    params.userId ?? "anon",
    params.sort,
    params.following ? "following" : "all",
    String(params.limit),
    params.cursor ?? "",
    (params.search ?? "").trim().toLowerCase(),
  ].join(":");
}

function buildFeedSharedResponseCacheKey(params: {
  sort: "latest" | "trending";
  following: boolean;
  limit: number;
  cursor?: string;
  search?: string;
}): string {
  return [
    params.sort,
    params.following ? "following" : "all",
    String(params.limit),
    params.cursor ?? "",
    (params.search ?? "").trim().toLowerCase(),
  ].join(":");
}

function isFeedDegradedCircuitOpen(): boolean {
  if (!feedDegradedCircuitState) return false;
  if (feedDegradedCircuitState.openUntilMs > Date.now()) {
    return true;
  }
  feedDegradedCircuitState = null;
  return false;
}

function openFeedDegradedCircuit(reason: string, error?: unknown): void {
  const now = Date.now();
  feedDegradedCircuitState = {
    openUntilMs: now + FEED_DEGRADED_CIRCUIT_TTL_MS,
    openedAtMs: now,
    reason,
  };
  console.warn("[posts/feed] degraded-mode circuit opened", {
    reason,
    untilMs: feedDegradedCircuitState.openUntilMs,
    message: getErrorMessage(error),
  });
}

function clearFeedDegradedCircuit(): void {
  if (!feedDegradedCircuitState) return;
  feedDegradedCircuitState = null;
}

function sanitizeFeedCardSnapshot(item: unknown): Record<string, unknown> | null {
  if (!item || typeof item !== "object" || Array.isArray(item)) {
    return null;
  }

  const record = { ...(item as Record<string, unknown>) };
  if (typeof record.id !== "string" || record.id.length === 0) {
    return null;
  }

  if ("isLiked" in record) record.isLiked = false;
  if ("isReposted" in record) record.isReposted = false;
  if ("isFollowingAuthor" in record) record.isFollowingAuthor = false;
  if ("walletTradeSnapshot" in record) {
    delete record.walletTradeSnapshot;
  }

  return record;
}

function writeFeedCardSnapshots(items: unknown[]): void {
  const nowMs = Date.now();
  for (const item of items) {
    const snapshot = sanitizeFeedCardSnapshot(item);
    if (!snapshot) continue;
    const existingSnapshot = readFeedCardSnapshot(String(snapshot.id));
    const mergedSnapshot = mergeFeedCardSnapshotRecords(existingSnapshot, snapshot);
    trimFeedCardSnapshotCache();
    feedCardSnapshotCache.set(String(snapshot.id), {
      snapshot: mergedSnapshot,
      expiresAtMs: nowMs + FEED_CARD_SNAPSHOT_TTL_MS,
    });
  }
}

function readFeedCardSnapshot(postId: string): Record<string, unknown> | null {
  const cached = feedCardSnapshotCache.get(postId);
  if (!cached) return null;
  if (cached.expiresAtMs > Date.now()) {
    return { ...cached.snapshot };
  }
  feedCardSnapshotCache.delete(postId);
  return null;
}

function readSharedAlphaResponseCache(
  key: string,
  opts?: { allowStale?: boolean }
): { users: Array<Record<string, unknown>>; count: number } | null {
  const cached = sharedAlphaResponseCache.get(key);
  if (!cached) return null;

  const nowMs = Date.now();
  if (cached.expiresAtMs > nowMs) {
    return {
      users: cached.data.users.map((user) => ({ ...user })),
      count: cached.data.count,
    };
  }

  if (opts?.allowStale && cached.staleUntilMs > nowMs) {
    return {
      users: cached.data.users.map((user) => ({ ...user })),
      count: cached.data.count,
    };
  }

  sharedAlphaResponseCache.delete(key);
  return null;
}

function writeSharedAlphaResponseCache(
  key: string,
  data: { users: Array<Record<string, unknown>>; count: number }
): void {
  sharedAlphaResponseCache.set(key, {
    data: {
      users: data.users.map((user) => ({ ...user })),
      count: data.count,
    },
    expiresAtMs: Date.now() + SHARED_ALPHA_CACHE_TTL_MS,
    staleUntilMs: Date.now() + SHARED_ALPHA_STALE_FALLBACK_MS,
  });
}

function hydrateFeedPostsFromSnapshots<T extends { id: string }>(posts: T[]): Array<T | Record<string, unknown>> {
  return posts.map((post) => readFeedCardSnapshot(post.id) ?? post);
}

function readFeedResponseFromCache(
  cacheMap: Map<
    string,
    {
      payload: FeedResponsePayload;
      expiresAtMs: number;
      staleUntilMs: number;
    }
  >,
  key: string,
  nowMs: number,
  opts?: { allowStale?: boolean }
): FeedResponsePayload | null {
  const cached = cacheMap.get(key);
  if (!cached) return null;
  if (cached.expiresAtMs > nowMs) return hydrateFeedResponsePayload(cached.payload);
  if (opts?.allowStale && cached.staleUntilMs > nowMs) {
    return hydrateFeedResponsePayload(cached.payload);
  }
  cacheMap.delete(key);
  return null;
}

function buildFeedSharedRedisKey(key: string): string {
  return `${FEED_SHARED_RESPONSE_REDIS_KEY_PREFIX}:${key}`;
}

function trimFeedCardSnapshotCache(): void {
  while (feedCardSnapshotCache.size >= FEED_CARD_SNAPSHOT_MAX_ENTRIES) {
    const oldestKey = feedCardSnapshotCache.keys().next().value;
    if (typeof oldestKey !== "string") {
      break;
    }
    feedCardSnapshotCache.delete(oldestKey);
  }
}

function trimPostPriceCache(): void {
  while (postPriceResponseCache.size >= POST_PRICE_CACHE_MAX_ENTRIES) {
    const oldestKey = postPriceResponseCache.keys().next().value;
    if (typeof oldestKey !== "string") {
      break;
    }
    postPriceResponseCache.delete(oldestKey);
  }
}

function buildPostPriceRedisKey(postId: string): string {
  return `${POST_PRICE_REDIS_KEY_PREFIX}:${postId}`;
}

function normalizePostPricePayload(value: unknown): PostPriceResponsePayload | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const candidate = value as Record<string, unknown>;
  const currentMcap = typeof candidate.currentMcap === "number" ? candidate.currentMcap : null;
  const entryMcap = typeof candidate.entryMcap === "number" ? candidate.entryMcap : null;
  const mcap1h = typeof candidate.mcap1h === "number" ? candidate.mcap1h : null;
  const mcap6h = typeof candidate.mcap6h === "number" ? candidate.mcap6h : null;
  const percentChange =
    typeof candidate.percentChange === "number" ? candidate.percentChange : null;
  const trackingMode =
    typeof candidate.trackingMode === "string" ? candidate.trackingMode : null;
  const lastMcapUpdate =
    typeof candidate.lastMcapUpdate === "string" ? candidate.lastMcapUpdate : null;
  const settledAt = typeof candidate.settledAt === "string" ? candidate.settledAt : null;

  return {
    currentMcap,
    entryMcap,
    mcap1h,
    mcap6h,
    percentChange,
    trackingMode,
    lastMcapUpdate,
    settled: candidate.settled === true,
    settledAt,
  };
}

function normalizePostPriceCacheEnvelope(
  value: unknown
): { data: PostPriceResponsePayload; cachedAtMs: number } | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const candidate = value as { data?: unknown; cachedAt?: unknown };
  const normalized = normalizePostPricePayload(candidate.data);
  if (!normalized) {
    return null;
  }

  return {
    data: normalized,
    cachedAtMs:
      typeof candidate.cachedAt === "number" && Number.isFinite(candidate.cachedAt)
        ? candidate.cachedAt
        : Date.now() - POST_PRICE_CACHE_TTL_MS,
  };
}

async function readPostPriceCache(
  postId: string,
  opts?: { allowStale?: boolean }
): Promise<PostPriceResponsePayload | null> {
  const nowMs = Date.now();
  const cached = postPriceResponseCache.get(postId);
  if (cached) {
    if (cached.expiresAtMs > nowMs) {
      return cached.data;
    }
    if (opts?.allowStale && cached.staleUntilMs > nowMs) {
      return cached.data;
    }
    if (cached.staleUntilMs <= nowMs) {
      postPriceResponseCache.delete(postId);
    }
  }

  const redisRaw = await cacheGetJson<unknown>(buildPostPriceRedisKey(postId));
  const redisEnvelope = normalizePostPriceCacheEnvelope(redisRaw);
  const redisCached = redisEnvelope?.data ?? normalizePostPricePayload(redisRaw);
  if (!redisCached) {
    return null;
  }
  if (
    !opts?.allowStale &&
    redisEnvelope &&
    nowMs - redisEnvelope.cachedAtMs > POST_PRICE_CACHE_TTL_MS
  ) {
    return null;
  }

  writePostPriceCache(postId, redisCached);
  return redisCached;
}

function writePostPriceCache(postId: string, data: PostPriceResponsePayload): void {
  const existingCached = postPriceResponseCache.get(postId)?.data ?? null;
  const nextData = mergePostPricePayloadWithFresherState(existingCached, data);
  if (postPriceResponseCache.has(postId)) {
    postPriceResponseCache.delete(postId);
  }
  trimPostPriceCache();
  const nowMs = Date.now();
  const staleFallbackMs = getPostPriceStaleFallbackMs(nextData);
  postPriceResponseCache.set(postId, {
    data: nextData,
    expiresAtMs: nowMs + POST_PRICE_CACHE_TTL_MS,
    staleUntilMs: nowMs + staleFallbackMs,
  });
  void cacheSetJson(
    buildPostPriceRedisKey(postId),
    {
      data: nextData,
      cachedAt: nowMs,
    },
    staleFallbackMs
  );
}

function normalizeFeedResponsePayload(value: unknown): FeedResponsePayload | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const payload = value as {
    data?: unknown;
    hasMore?: unknown;
    nextCursor?: unknown;
    totalPosts?: unknown;
  };

  if (!Array.isArray(payload.data) || typeof payload.hasMore !== "boolean") {
    return null;
  }

  const nextCursor =
    typeof payload.nextCursor === "string" || payload.nextCursor === null
      ? payload.nextCursor
      : null;
  const totalPosts =
    typeof payload.totalPosts === "number" && Number.isFinite(payload.totalPosts)
      ? payload.totalPosts
      : null;

  return {
    data: payload.data,
    hasMore: payload.hasMore,
    nextCursor,
    totalPosts,
  };
}

async function readSharedFeedResponseFromRedis(key: string): Promise<FeedResponsePayload | null> {
  const cached = await cacheGetJson<unknown>(buildFeedSharedRedisKey(key));
  const normalized = normalizeFeedResponsePayload(cached);
  if (!normalized) {
    return null;
  }
  writeFeedResponseToCache(feedSharedResponseCache, key, normalized);
  return hydrateFeedResponsePayload(normalized);
}

function createSharedFeedPayload(payload: FeedResponsePayload): FeedResponsePayload {
  return {
    ...payload,
    data: payload.data.map((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        return item;
      }
      const record = { ...(item as Record<string, unknown>) };
      if ("isLiked" in record) {
        record.isLiked = false;
      }
      if ("isReposted" in record) {
        record.isReposted = false;
      }
      return record;
    }),
  };
}

function writeFeedResponseToCache(
  cacheMap: Map<
    string,
    {
      payload: FeedResponsePayload;
      expiresAtMs: number;
      staleUntilMs: number;
    }
  >,
  key: string,
  payload: FeedResponsePayload
): void {
  const nowMs = Date.now();
  writeFeedCardSnapshots(payload.data);
  cacheMap.set(key, {
    payload,
    expiresAtMs: nowMs + FEED_RESPONSE_CACHE_TTL_MS,
    staleUntilMs: nowMs + FEED_RESPONSE_STALE_FALLBACK_MS,
  });
}

function parseCachedDate(value: unknown): Date | null {
  if (value instanceof Date && Number.isFinite(value.getTime())) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = new Date(value);
    if (Number.isFinite(parsed.getTime())) {
      return parsed;
    }
  }
  return null;
}

function toNullableNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function getPostPricePayloadVersion(
  payload:
    | Pick<PostPriceResponsePayload, "lastMcapUpdate" | "settledAt">
    | { lastMcapUpdate?: string | null; settledAt?: string | null; createdAt?: string | Date | null }
    | null
    | undefined
): number {
  if (!payload) return 0;

  const createdAt =
    "createdAt" in payload ? parseCachedDate(payload.createdAt)?.getTime() ?? 0 : 0;

  return Math.max(
    parseCachedDate(payload.lastMcapUpdate)?.getTime() ?? 0,
    parseCachedDate(payload.settledAt)?.getTime() ?? 0,
    createdAt
  );
}

function preserveNewerMarketStateFields(
  target: Record<string, unknown>,
  source: Record<string, unknown>
): Record<string, unknown> {
  const merged = { ...target };
  const marketStateKeys = [
    "currentMcap",
    "settled",
    "settledAt",
    "mcap1h",
    "mcap6h",
    "isWin",
    "lastMcapUpdate",
    "trackingMode",
  ] as const;

  for (const key of marketStateKeys) {
    if (key in source) {
      merged[key] = source[key];
    }
  }

  return merged;
}

function mergeFeedCardSnapshotRecords(
  existingSnapshot: Record<string, unknown> | null,
  nextSnapshot: Record<string, unknown>
): Record<string, unknown> {
  if (!existingSnapshot) {
    return nextSnapshot;
  }

  const merged = {
    ...existingSnapshot,
    ...nextSnapshot,
  };
  const existingVersion = getPostPricePayloadVersion(existingSnapshot);
  const nextVersion = getPostPricePayloadVersion(nextSnapshot);

  if (existingVersion > nextVersion) {
    return preserveNewerMarketStateFields(merged, existingSnapshot);
  }

  return merged;
}

function mergePostPricePayloadWithFresherState(
  existingPayload: PostPriceResponsePayload | null | undefined,
  nextPayload: PostPriceResponsePayload
): PostPriceResponsePayload {
  if (!existingPayload) {
    return nextPayload;
  }

  const existingVersion = getPostPricePayloadVersion(existingPayload);
  const nextVersion = getPostPricePayloadVersion(nextPayload);

  if (existingVersion > nextVersion) {
    return {
      ...nextPayload,
      currentMcap: existingPayload.currentMcap,
      settled: existingPayload.settled,
      settledAt: existingPayload.settledAt,
      mcap1h: existingPayload.mcap1h,
      mcap6h: existingPayload.mcap6h,
      trackingMode: existingPayload.trackingMode,
      lastMcapUpdate: existingPayload.lastMcapUpdate,
      percentChange: existingPayload.percentChange,
    };
  }

  return nextPayload;
}

function getPostPriceStaleFallbackMs(data: PostPriceResponsePayload): number {
  return data.settled || data.trackingMode === TRACKING_MODE_SETTLED
    ? POST_PRICE_SETTLED_STALE_FALLBACK_MS
    : POST_PRICE_ACTIVE_STALE_FALLBACK_MS;
}

function hydrateFeedResponsePayload(payload: FeedResponsePayload): FeedResponsePayload {
  return {
    ...payload,
    data: payload.data.map((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        return item;
      }

      const id = (item as { id?: unknown }).id;
      if (typeof id !== "string" || id.length === 0) {
        return item;
      }

      const snapshot = readFeedCardSnapshot(id);
      if (!snapshot) {
        return item;
      }

      return mergeFeedCardSnapshotRecords(item as Record<string, unknown>, snapshot);
    }),
  };
}

function buildPostPricePayloadFromRecord(post: PriceRoutePostRecord): PostPriceResponsePayload {
  const effectiveCurrentMcap = post.currentMcap;
  const percentChange =
    post.entryMcap && effectiveCurrentMcap
      ? ((effectiveCurrentMcap - post.entryMcap) / post.entryMcap) * 100
      : null;

  return {
    currentMcap: effectiveCurrentMcap,
    entryMcap: post.entryMcap,
    mcap1h: post.mcap1h,
    mcap6h: post.mcap6h,
    percentChange: percentChange !== null ? Math.round(percentChange * 100) / 100 : null,
    trackingMode: post.trackingMode ?? determineTrackingMode(post.createdAt),
    lastMcapUpdate: post.lastMcapUpdate?.toISOString() ?? null,
    settled: post.settled,
    settledAt: post.settledAt?.toISOString() ?? null,
  };
}

function findCachedFeedPostPriceRecord(postId: string): PriceRoutePostRecord | null {
  const cachedPost = [...feedResponseCache.values(), ...feedSharedResponseCache.values()]
    .flatMap((entry) => entry.payload.data)
    .find((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return false;
      return (item as { id?: unknown }).id === postId;
    });

  if (!cachedPost || typeof cachedPost !== "object" || Array.isArray(cachedPost)) {
    return null;
  }

  const candidate = cachedPost as Record<string, unknown>;
  const createdAt = parseCachedDate(candidate.createdAt);
  if (!createdAt) {
    return null;
  }

  return {
    id: postId,
    contractAddress:
      typeof candidate.contractAddress === "string" ? candidate.contractAddress : null,
    chainType: typeof candidate.chainType === "string" ? candidate.chainType : null,
    entryMcap: toNullableNumber(candidate.entryMcap),
    currentMcap: toNullableNumber(candidate.currentMcap),
    mcap1h: toNullableNumber(candidate.mcap1h),
    mcap6h: toNullableNumber(candidate.mcap6h),
    settled: candidate.settled === true,
    settledAt: parseCachedDate(candidate.settledAt),
    createdAt,
    lastMcapUpdate: parseCachedDate(candidate.lastMcapUpdate),
    trackingMode: typeof candidate.trackingMode === "string" ? candidate.trackingMode : null,
  };
}

async function resolveCachedPostPricePayload(
  postId: string,
  opts?: { allowStale?: boolean }
): Promise<PostPriceResponsePayload | null> {
  const cachedPayload = await readPostPriceCache(postId, opts);
  if (cachedPayload) {
    return cachedPayload;
  }

  const cachedPost = findCachedFeedPostPriceRecord(postId);
  if (!cachedPost) {
    return null;
  }

  const payload = buildPostPricePayloadFromRecord(cachedPost);
  writePostPriceCache(postId, payload);
  return payload;
}

async function loadEmergencyFeedPosts(
  feedFindManyBase: Record<string, unknown>
): Promise<any[]> {
  // Strip search conditions that reference potentially missing columns (tokenName, tokenSymbol)
  // by removing the where clause and using a simple orderBy + limit
  const safeBase = { ...feedFindManyBase };
  // Keep only safe where conditions (createdAt, authorId) - remove any OR containing tokenName etc.
  const existingWhere = (safeBase as any).where;
  if (existingWhere?.AND) {
    (safeBase as any).where = {
      AND: existingWhere.AND.filter((cond: any) => !cond.OR),
    };
  }

  const minimalPosts = (await withFeedTimeout(
    prisma.post.findMany({
      ...safeBase,
      select: {
        id: true,
        content: true,
        authorId: true,
        createdAt: true,
        author: {
          select: {
            id: true,
            name: true,
            image: true,
          },
        },
      },
    } as any),
    "emergency_minimal_posts_query",
    Math.min(FEED_DB_QUERY_TIMEOUT_MS, 1600)
  )) as any[];

  return minimalPosts.map((post) => ({
    ...post,
    contractAddress: null,
    chainType: null,
    tokenName: null,
    tokenSymbol: null,
    tokenImage: null,
    entryMcap: null,
    currentMcap: null,
    mcap1h: null,
    mcap6h: null,
    settled: false,
    settledAt: null,
    isWin: null,
    isWin1h: null,
    isWin6h: null,
    percentChange1h: null,
    percentChange6h: null,
    viewCount: 0,
    dexscreenerUrl: null,
    author: {
      ...post.author,
      username: null,
      walletAddress: null,
      level: 0,
      xp: 0,
      isVerified: false,
    },
    _count: {
      likes: 0,
      comments: 0,
      reposts: 0,
    },
  }));
}

async function loadPrimaryFeedPosts(
  feedFindManyBase: Record<string, unknown>
): Promise<any[]> {
  try {
    return await withFeedTimeout(
      withPrismaRetry(
        () =>
          prisma.post.findMany({
            ...(feedFindManyBase as Record<string, unknown>),
            select: {
              id: true,
              content: true,
              authorId: true,
              contractAddress: true,
              chainType: true,
              tokenName: true,
              tokenSymbol: true,
              tokenImage: true,
              entryMcap: true,
              currentMcap: true,
              mcap1h: true,
              mcap6h: true,
              settled: true,
              settledAt: true,
              isWin: true,
              isWin1h: true,
              isWin6h: true,
              percentChange1h: true,
              percentChange6h: true,
              createdAt: true,
              viewCount: true,
              dexscreenerUrl: true,
              lastMcapUpdate: true,
              trackingMode: true,
              author: {
                select: {
                  id: true,
                  name: true,
                  username: true,
                  image: true,
                  level: true,
                  xp: true,
                  isVerified: true,
                },
              },
              _count: {
                select: {
                  likes: true,
                  comments: true,
                  reposts: true,
                },
              },
            },
          } as any),
        {
          label: "posts:feed-primary",
          maxRetries: 0,
        }
      ),
      "primary_posts_query"
    );
  } catch (error) {
    if (!isPrismaSchemaDriftError(error)) {
      throw error;
    }

    console.warn("[posts/feed] schema drift detected; using compatibility select");
    try {
      return await withFeedTimeout(
        prisma.post.findMany({
          ...(feedFindManyBase as Record<string, unknown>),
          select: {
            id: true,
            content: true,
            authorId: true,
            contractAddress: true,
            chainType: true,
            tokenName: true,
            tokenSymbol: true,
            tokenImage: true,
            entryMcap: true,
            currentMcap: true,
            mcap1h: true,
            mcap6h: true,
            settled: true,
            settledAt: true,
            isWin: true,
            isWin1h: true,
            isWin6h: true,
            percentChange1h: true,
            percentChange6h: true,
            createdAt: true,
            viewCount: true,
            dexscreenerUrl: true,
            author: {
              select: {
                id: true,
                name: true,
                username: true,
                image: true,
                level: true,
                xp: true,
                isVerified: true,
              },
            },
            _count: {
              select: {
                likes: true,
                comments: true,
                reposts: true,
              },
            },
          },
        } as any),
        "compat_posts_query"
      );
    } catch (fallbackError) {
      if (!isPrismaSchemaDriftError(fallbackError)) {
        throw fallbackError;
      }

      console.warn("[posts/feed] legacy compatibility select engaged");
      try {
        const legacyPosts = (await withFeedTimeout(
          prisma.post.findMany({
            ...(feedFindManyBase as Record<string, unknown>),
            select: {
              id: true,
              content: true,
              authorId: true,
              contractAddress: true,
              chainType: true,
              entryMcap: true,
              currentMcap: true,
              settled: true,
              settledAt: true,
              isWin: true,
              createdAt: true,
              author: {
                select: {
                  id: true,
                  name: true,
                  username: true,
                  image: true,
                  level: true,
                  xp: true,
                },
              },
            },
          } as any),
          "legacy_posts_query"
        )) as any[];
        return legacyPosts.map((post) => ({
          ...post,
          tokenName: null,
          tokenSymbol: null,
          tokenImage: null,
          mcap1h: null,
          mcap6h: null,
          isWin1h: null,
          isWin6h: null,
          percentChange1h: null,
          percentChange6h: null,
          viewCount: 0,
          dexscreenerUrl: null,
          lastMcapUpdate: null,
          trackingMode: null,
          author: {
            ...post.author,
            walletAddress: null,
            isVerified: false,
          },
          _count: {
            likes: 0,
            comments: 0,
            reposts: 0,
          },
        }));
      } catch (legacyError) {
        if (!isPrismaSchemaDriftError(legacyError)) {
          throw legacyError;
        }

        console.warn("[posts/feed] ultra-legacy compatibility select engaged");
        const minimalPosts = (await withFeedTimeout(
          prisma.post.findMany({
            ...(feedFindManyBase as Record<string, unknown>),
            select: {
              id: true,
              content: true,
              authorId: true,
              createdAt: true,
              author: {
                select: {
                  id: true,
                  name: true,
                  image: true,
                },
              },
            },
          } as any),
          "ultra_legacy_posts_query"
        )) as any[];
        return minimalPosts.map((post) => ({
          ...post,
          contractAddress: null,
          chainType: null,
          entryMcap: null,
          currentMcap: null,
          settled: false,
          settledAt: null,
          isWin: null,
          tokenName: null,
          tokenSymbol: null,
          tokenImage: null,
          mcap1h: null,
          mcap6h: null,
          isWin1h: null,
          isWin6h: null,
          percentChange1h: null,
          percentChange6h: null,
          viewCount: 0,
          dexscreenerUrl: null,
          lastMcapUpdate: null,
          trackingMode: null,
          author: {
            ...post.author,
            username: null,
            walletAddress: null,
            level: 0,
            xp: 0,
            isVerified: false,
          },
          _count: {
            likes: 0,
            comments: 0,
            reposts: 0,
          },
        }));
      }
    }
  }
}

async function loadDegradedFeedPosts(
  feedFindManyBase: Record<string, unknown>
): Promise<any[]> {
  const minimalPosts = await loadEmergencyFeedPosts(feedFindManyBase);
  return hydrateFeedPostsFromSnapshots(minimalPosts) as any[];
}

function toFiniteNumber(value: unknown, fallback = 0): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "bigint") {
    return Number(value);
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return fallback;
}

async function loadEmergencyFeedPostsRaw(params: {
  sort: "latest" | "trending";
  following: boolean;
  followedIds: string[];
  limit: number;
  cursor?: string;
  search?: string;
}): Promise<any[]> {
  // Try full query first, fall back to minimal if columns don't exist
  try {
    return await loadEmergencyFeedPostsRawFull(params);
  } catch (fullError) {
    console.warn("[posts/feed] full raw emergency failed, trying minimal", {
      message: fullError instanceof Error ? fullError.message : String(fullError),
    });
    return await loadEmergencyFeedPostsRawMinimal(params);
  }
}

// Minimal raw query using SELECT p.* — can never fail on missing columns
async function loadEmergencyFeedPostsRawMinimal(params: {
  sort: "latest" | "trending";
  following: boolean;
  followedIds: string[];
  limit: number;
  cursor?: string;
  search?: string;
}): Promise<any[]> {
  const conditions: Prisma.Sql[] = [];

  if (params.sort === "trending") {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    conditions.push(Prisma.sql`p."createdAt" >= ${sevenDaysAgo}`);
  }

  if (params.following && params.followedIds.length > 0) {
    conditions.push(Prisma.sql`p."authorId" IN (${Prisma.join(params.followedIds)})`);
  } else if (params.following) {
    return [];
  }

  if (params.search && params.search.trim().length > 0) {
    const likeTerm = `%${params.search.trim()}%`;
    conditions.push(Prisma.sql`(p.content ILIKE ${likeTerm} OR u.name ILIKE ${likeTerm})`);

  }

  if (params.cursor) {
    const cursorRows = await prisma.$queryRaw<Array<{ id: string; createdAt: Date }>>(Prisma.sql`
      SELECT p.id, p."createdAt" FROM "Post" p WHERE p.id = ${params.cursor} LIMIT 1
    `);
    const cursorRow = cursorRows[0];
    if (cursorRow) {
      conditions.push(
        Prisma.sql`(p."createdAt" < ${cursorRow.createdAt} OR (p."createdAt" = ${cursorRow.createdAt} AND p.id < ${cursorRow.id}))`
      );
    }
  }

  const whereSql =
    conditions.length > 0
      ? Prisma.sql`WHERE ${Prisma.join(conditions, " AND ")}`
      : Prisma.sql``;

  // Use SELECT p.* so this never fails regardless of which columns exist in DB
  const rows = await withFeedTimeout(
    prisma.$queryRaw<Array<Record<string, unknown>>>(Prisma.sql`
      SELECT
        p.*,
        u.name AS "authorName",
        u.image AS "authorImage"
      FROM "Post" p
      JOIN "User" u ON u.id = p."authorId"
      ${whereSql}
      ORDER BY p."createdAt" DESC, p.id DESC
      LIMIT ${params.limit + 1}
    `),
    "raw_minimal_emergency_posts_query",
    Math.min(FEED_DB_QUERY_TIMEOUT_MS + 2000, 7_000)
  );

  return rows.map((row: Record<string, unknown>) => ({
    id: row.id,
    content: row.content ?? "",
    authorId: row.authorId,
    contractAddress: row.contractAddress ?? null,
    chainType: row.chainType ?? null,
    tokenName: row.tokenName ?? null,
    tokenSymbol: row.tokenSymbol ?? null,
    tokenImage: row.tokenImage ?? null,
    entryMcap: row.entryMcap ?? null,
    currentMcap: row.currentMcap ?? null,
    mcap1h: row.mcap1h ?? null,
    mcap6h: row.mcap6h ?? null,
    settled: row.settled === true,
    settledAt: row.settledAt ?? null,
    isWin: row.isWin ?? null,
    isWin1h: row.isWin1h ?? null,
    isWin6h: row.isWin6h ?? null,
    percentChange1h: row.percentChange1h ?? null,
    percentChange6h: row.percentChange6h ?? null,
    createdAt: row.createdAt,
    viewCount: toFiniteNumber(row.viewCount, 0),
    dexscreenerUrl: row.dexscreenerUrl ?? null,
    author: {
      id: row.authorId,
      name: row.authorName ?? "Anonymous",
      username: row.authorUsername ?? null,
      image: row.authorImage ?? null,
      walletAddress: null,
      level: toFiniteNumber(row.authorLevel, 0),
      xp: toFiniteNumber(row.authorXp, 0),
      isVerified: false,
    },
    _count: {
      likes: 0,
      comments: 0,
      reposts: 0,
    },
  }));
}

// Full raw query with all columns (may fail if newer columns don't exist)
async function loadEmergencyFeedPostsRawFull(params: {
  sort: "latest" | "trending";
  following: boolean;
  followedIds: string[];
  limit: number;
  cursor?: string;
  search?: string;
}): Promise<any[]> {
  const conditions: Prisma.Sql[] = [];

  if (params.sort === "trending") {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    conditions.push(Prisma.sql`p."createdAt" >= ${sevenDaysAgo}`);
  }

  if (params.following) {
    if (params.followedIds.length === 0) {
      return [];
    }
    conditions.push(Prisma.sql`p."authorId" IN (${Prisma.join(params.followedIds)})`);
  }

  if (params.search && params.search.trim().length > 0) {
    const likeTerm = `%${params.search.trim()}%`;
    conditions.push(Prisma.sql`(
      p."contractAddress" ILIKE ${likeTerm}
      OR p."tokenName" ILIKE ${likeTerm}
      OR p."tokenSymbol" ILIKE ${likeTerm}
      OR p.content ILIKE ${likeTerm}
      OR u.username ILIKE ${likeTerm}
      OR u.name ILIKE ${likeTerm}
    )`);
  }

  if (params.cursor) {
    const cursorRows = await prisma.$queryRaw<Array<{ id: string; createdAt: Date }>>(Prisma.sql`
      SELECT p.id, p."createdAt"
      FROM "Post" p
      WHERE p.id = ${params.cursor}
      LIMIT 1
    `);
    const cursorRow = cursorRows[0];
    if (cursorRow) {
      conditions.push(
        Prisma.sql`(p."createdAt" < ${cursorRow.createdAt} OR (p."createdAt" = ${cursorRow.createdAt} AND p.id < ${cursorRow.id}))`
      );
    }
  }

  const whereSql =
    conditions.length > 0
      ? Prisma.sql`WHERE ${Prisma.join(conditions, " AND ")}`
      : Prisma.sql``;

  const rows = await withFeedTimeout(
    prisma.$queryRaw<Array<{
      id: string;
      content: string;
      authorId: string;
      contractAddress: string | null;
      chainType: string | null;
      tokenName: string | null;
      tokenSymbol: string | null;
      tokenImage: string | null;
      entryMcap: number | null;
      currentMcap: number | null;
      mcap1h: number | null;
      mcap6h: number | null;
      settled: boolean | null;
      settledAt: Date | null;
      isWin: boolean | null;
      isWin1h: boolean | null;
      isWin6h: boolean | null;
      percentChange1h: number | null;
      percentChange6h: number | null;
      createdAt: Date;
      viewCount: number | null;
      dexscreenerUrl: string | null;
      authorName: string;
      authorUsername: string | null;
      authorImage: string | null;
      authorWalletAddress: string | null;
      authorLevel: number | null;
      authorXp: number | null;
      authorIsVerified: boolean | null;
      likesCount: number | bigint | null;
      commentsCount: number | bigint | null;
      repostsCount: number | bigint | null;
    }>>(Prisma.sql`
      SELECT
        p.id,
        p.content,
        p."authorId",
        p."contractAddress",
        p."chainType",
        p."tokenName",
        p."tokenSymbol",
        p."tokenImage",
        p."entryMcap",
        p."currentMcap",
        p."mcap1h",
        p."mcap6h",
        p.settled,
        p."settledAt",
        p."isWin",
        p."isWin1h",
        p."isWin6h",
        p."percentChange1h",
        p."percentChange6h",
        p."createdAt",
        p."viewCount",
        p."dexscreenerUrl",
        u.name AS "authorName",
        u.username AS "authorUsername",
        u.image AS "authorImage",
        u."walletAddress" AS "authorWalletAddress",
        u.level AS "authorLevel",
        u.xp AS "authorXp",
        u."isVerified" AS "authorIsVerified",
        (SELECT COUNT(*)::int FROM "Like" l WHERE l."postId" = p.id) AS "likesCount",
        (SELECT COUNT(*)::int FROM "Comment" c WHERE c."postId" = p.id) AS "commentsCount",
        (SELECT COUNT(*)::int FROM "Repost" r WHERE r."postId" = p.id) AS "repostsCount"
      FROM "Post" p
      JOIN "User" u ON u.id = p."authorId"
      ${whereSql}
      ORDER BY p."createdAt" DESC, p.id DESC
      LIMIT ${params.limit + 1}
    `),
    "raw_emergency_posts_query",
    Math.min(FEED_DB_QUERY_TIMEOUT_MS + 1200, 5_500)
  );

  return rows.map((row) => ({
    id: row.id,
    content: row.content,
    authorId: row.authorId,
    contractAddress: row.contractAddress ?? null,
    chainType: row.chainType ?? null,
    tokenName: row.tokenName ?? null,
    tokenSymbol: row.tokenSymbol ?? null,
    tokenImage: row.tokenImage ?? null,
    entryMcap: row.entryMcap ?? null,
    currentMcap: row.currentMcap ?? null,
    mcap1h: row.mcap1h ?? null,
    mcap6h: row.mcap6h ?? null,
    settled: row.settled === true,
    settledAt: row.settledAt,
    isWin: row.isWin,
    isWin1h: row.isWin1h,
    isWin6h: row.isWin6h,
    percentChange1h: row.percentChange1h ?? null,
    percentChange6h: row.percentChange6h ?? null,
    createdAt: row.createdAt,
    viewCount: toFiniteNumber(row.viewCount, 0),
    dexscreenerUrl: row.dexscreenerUrl ?? null,
    author: {
      id: row.authorId,
      name: row.authorName,
      username: row.authorUsername ?? null,
      image: row.authorImage ?? null,
      walletAddress: row.authorWalletAddress ?? null,
      level: toFiniteNumber(row.authorLevel, 0),
      xp: toFiniteNumber(row.authorXp, 0),
      isVerified: row.authorIsVerified === true,
    },
    _count: {
      likes: toFiniteNumber(row.likesCount, 0),
      comments: toFiniteNumber(row.commentsCount, 0),
      reposts: toFiniteNumber(row.repostsCount, 0),
    },
  }));
}

function invalidatePostReadCaches(options?: { leaderboard?: boolean }): void {
  feedResponseCache.clear();
  feedSharedResponseCache.clear();
  feedMcapCache.clear();
  sharedAlphaAuthorCache.clear();
  sharedAlphaWarmInFlight.clear();
  sharedAlphaResponseCache.clear();
  feedCardSnapshotCache.clear();
  trendingCache = null;
  trendingInFlight = null;
  feedTotalPostCountCache = null;

  if (options?.leaderboard) {
    invalidateLeaderboardCaches();
  }
}

async function readTotalPostCountHint(): Promise<number | null> {
  const nowMs = Date.now();
  if (feedTotalPostCountCache && feedTotalPostCountCache.expiresAtMs > nowMs) {
    return feedTotalPostCountCache.count;
  }

  try {
    const count = await withFeedTimeout(
      prisma.post.count(),
      "feed_total_posts_count_query",
      FEED_SOCIAL_QUERY_TIMEOUT_MS
    );
    feedTotalPostCountCache = {
      count,
      expiresAtMs: nowMs + FEED_TOTAL_POST_COUNT_CACHE_TTL_MS,
    };
    return count;
  } catch (error) {
    if (
      !isPrismaSchemaDriftError(error) &&
      !isPrismaClientError(error) &&
      !isFeedTimeoutError(error)
    ) {
      throw error;
    }

    console.warn("[posts/feed] total post count hint unavailable; continuing without dataset-size hint", {
      message: error instanceof Error ? error.message : String(error),
    });
    return feedTotalPostCountCache?.count ?? null;
  }
}

function queueSharedAlphaAuthorWarmup(contractAddresses: string[], fromDate: Date): void {
  const addressesToWarm = [...new Set(contractAddresses.filter((value) => value.length > 0))];
  if (addressesToWarm.length === 0) return;

  const pendingAddresses = addressesToWarm.filter((contractAddress) => {
    const cached = sharedAlphaAuthorCache.get(contractAddress);
    if (cached && cached.expiresAtMs > Date.now()) {
      return false;
    }
    return !sharedAlphaWarmInFlight.has(contractAddress);
  });

  if (pendingAddresses.length === 0) return;

  const warmPromise = (async () => {
    try {
      const rows = await prisma.post.findMany({
        where: {
          contractAddress: { in: pendingAddresses },
          createdAt: { gte: fromDate },
        },
        select: {
          contractAddress: true,
          authorId: true,
        },
      });

      const nextMap = new Map<string, Set<string>>();
      for (const contractAddress of pendingAddresses) {
        nextMap.set(contractAddress, new Set<string>());
      }
      for (const row of rows) {
        if (!row.contractAddress) continue;
        nextMap.get(row.contractAddress)?.add(row.authorId);
      }

      const expiresAtMs = Date.now() + SHARED_ALPHA_CACHE_TTL_MS;
      for (const [contractAddress, authorIds] of nextMap) {
        sharedAlphaAuthorCache.set(contractAddress, { authorIds, expiresAtMs });
      }
    } catch (error) {
      console.warn("[posts/feed] shared alpha warmup skipped after query failure", {
        contractAddresses: pendingAddresses,
        message: getErrorMessage(error),
      });
    } finally {
      for (const contractAddress of pendingAddresses) {
        sharedAlphaWarmInFlight.delete(contractAddress);
      }
    }
  })();

  for (const contractAddress of pendingAddresses) {
    sharedAlphaWarmInFlight.set(contractAddress, warmPromise);
  }
}
const JUPITER_QUOTE_URLS = [
  "https://lite-api.jup.ag/swap/v1/quote",
  "https://quote-api.jup.ag/v6/quote",
];
const JUPITER_SWAP_URLS = [
  "https://lite-api.jup.ag/swap/v1/swap",
  "https://quote-api.jup.ag/v6/swap",
];
const JUPITER_QUOTE_CACHE_TTL_MS = process.env.NODE_ENV === "production" ? 1_500 : 600;
const JUPITER_QUOTE_ERROR_CACHE_TTL_MS = process.env.NODE_ENV === "production" ? 450 : 200;
const CHART_CANDLES_CACHE_TTL_MS = process.env.NODE_ENV === "production" ? 8_000 : 2_000;
const CHART_CANDLES_STALE_FALLBACK_MS = process.env.NODE_ENV === "production" ? 5 * 60_000 : 60_000;
const CHART_CANDLES_FETCH_TIMEOUT_MS = process.env.NODE_ENV === "production" ? 4_200 : 6_000;
const CHART_POOL_ADDRESS_CACHE_TTL_MS = process.env.NODE_ENV === "production" ? 90_000 : 20_000;
const CHART_PROVIDER_DEFAULT_LATENCY_MS: Record<ChartCandlesSource, number> = {
  birdeye: 380,
  geckoterminal: 760,
};
const CHART_PROVIDER_BASELINE_SCORE: Record<ChartCandlesSource, number> = {
  birdeye: 74,
  geckoterminal: 62,
};
const CHART_PROVIDER_RECENT_SUCCESS_WINDOW_MS =
  process.env.NODE_ENV === "production" ? 3 * 60_000 : 60_000;
const CHART_PROVIDER_RECENT_FAILURE_WINDOW_MS =
  process.env.NODE_ENV === "production" ? 90_000 : 25_000;
const CHART_PROVIDER_FAILURE_COOLDOWN_BASE_MS =
  process.env.NODE_ENV === "production" ? 2_500 : 700;
const CHART_PROVIDER_FAILURE_COOLDOWN_MAX_MS =
  process.env.NODE_ENV === "production" ? 45_000 : 10_000;
const CHART_PROVIDER_FRESHNESS_GRACE_CANDLES = 6;
const SOL_MINT = "So11111111111111111111111111111111111111112";
const PLATFORM_FEE_ACCOUNT_FALLBACK = "Gqxyto95NExADzBbGka8j1Ki9QjKcEgSHPYVrNCJQTC6";
const FIXED_PLATFORM_FEE_BPS = 100; // 1.00% total routed fee (0.50% creator + 0.50% platform)
const DEFAULT_POSTER_TRADE_FEE_SHARE_BPS = 50;
const MAX_POSTER_TRADE_FEE_SHARE_BPS = 50; // max 0.50% effective creator fee
const BIRDEYE_API_KEY = process.env.BIRDEYE_API_KEY?.trim() || "";
const JUPITER_PLATFORM_FEE_BPS = FIXED_PLATFORM_FEE_BPS;
const JUPITER_PLATFORM_FEE_ACCOUNT =
  process.env.JUPITER_PLATFORM_FEE_ACCOUNT?.trim() || PLATFORM_FEE_ACCOUNT_FALLBACK;
const JUPITER_PRIORITY_LEVEL = (() => {
  const raw = process.env.JUPITER_PRIORITY_LEVEL?.trim().toLowerCase();
  if (raw === "medium" || raw === "high" || raw === "veryhigh") {
    return raw === "veryhigh" ? "veryHigh" : raw;
  }
  return "veryHigh";
})();
const JUPITER_MAX_PRIORITY_FEE_LAMPORTS = (() => {
  const raw = Number(process.env.JUPITER_MAX_PRIORITY_FEE_LAMPORTS ?? "1000000");
  if (!Number.isFinite(raw) || raw <= 0) return 1_000_000;
  return Math.max(10_000, Math.min(5_000_000, Math.round(raw)));
})();
const jupiterQuoteCache = new Map<
  string,
  {
    result: JupiterProxyResult;
    expiresAtMs: number;
  }
>();
const jupiterQuoteInFlight = new Map<string, Promise<JupiterProxyResult>>();
const chartCandlesCache = new Map<
  string,
  {
    result: ChartCandlesFetchResult;
    expiresAtMs: number;
    staleUntilMs: number;
  }
>();
const chartCandlesInFlight = new Map<string, Promise<ChartCandlesFetchResult>>();
const chartPoolAddressCache = new Map<string, { poolAddress: string | null; expiresAtMs: number }>();
const chartPoolAddressInFlight = new Map<string, Promise<string | null>>();
const chartCandlesSourceHealth = new Map<ChartCandlesSource, ChartCandlesSourceHealth>();

function getActivePlatformFeeBps(): number {
  if (!JUPITER_PLATFORM_FEE_ACCOUNT) return 0;
  return JUPITER_PLATFORM_FEE_BPS;
}

function clampPosterFeeShareBps(value: number | null | undefined): number {
  if (!Number.isFinite(value)) return DEFAULT_POSTER_TRADE_FEE_SHARE_BPS;
  return Math.min(MAX_POSTER_TRADE_FEE_SHARE_BPS, Math.max(0, Math.round(Number(value))));
}

function buildJupiterQuoteCacheKey(payload: {
  inputMint: string;
  outputMint: string;
  amount: number;
  slippageBps: number;
  swapMode?: string | null;
}, platformFeeBps: number): string {
  return [
    payload.inputMint,
    payload.outputMint,
    String(payload.amount),
    String(payload.slippageBps),
    payload.swapMode ?? "ExactIn",
    String(platformFeeBps),
  ].join(":");
}

function isPrismaSchemaDriftError(error: unknown): boolean {
  const code =
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof (error as { code?: unknown }).code === "string"
      ? (error as { code: string }).code
      : "";

  if (code === "P2021" || code === "P2022") {
    return true;
  }

  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : typeof error === "object" &&
            error !== null &&
            "message" in error &&
            typeof (error as { message?: unknown }).message === "string"
          ? (error as { message: string }).message
          : "";

  const normalizedMessage = message.toLowerCase();

  return (
    normalizedMessage.includes("does not exist in the current database") ||
    normalizedMessage.includes("no such column") ||
    normalizedMessage.includes("no such table") ||
    normalizedMessage.includes("has no column named") ||
    normalizedMessage.includes("unknown arg") ||
    normalizedMessage.includes("unknown argument") ||
    normalizedMessage.includes("unknown field") ||
    (normalizedMessage.includes("column") && normalizedMessage.includes("does not exist")) ||
    (normalizedMessage.includes("table") && normalizedMessage.includes("does not exist")) ||
    (normalizedMessage.includes("relation") && normalizedMessage.includes("does not exist")) ||
    (normalizedMessage.includes("invalid") && normalizedMessage.includes("invocation"))
  );
}

function isPrismaClientError(error: unknown): boolean {
  const name =
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    typeof (error as { name?: unknown }).name === "string"
      ? (error as { name: string }).name
      : "";
  return name.startsWith("PrismaClient");
}

function isPrismaKnownRequestError(error: unknown, code?: string): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    (code ? error.code === code : true)
  );
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof (error as { message?: unknown }).message === "string"
  ) {
    return (error as { message: string }).message;
  }
  return "";
}

function getPrismaErrorDetails(error: unknown): {
  message: string;
  code: string | null;
  meta: unknown;
} {
  if (typeof error !== "object" || error === null) {
    return {
      message: getErrorMessage(error),
      code: null,
      meta: null,
    };
  }

  const candidate = error as {
    message?: unknown;
    code?: unknown;
    meta?: unknown;
  };

  return {
    message:
      typeof candidate.message === "string"
        ? candidate.message
        : getErrorMessage(error),
    code: typeof candidate.code === "string" ? candidate.code : null,
    meta: candidate.meta ?? null,
  };
}

function isPrismaPoolPressureError(error: unknown): boolean {
  const details = getPrismaErrorDetails(error);
  const normalizedMessage = details.message.toLowerCase();
  return (
    details.code === "P2024" ||
    normalizedMessage.includes("connection pool") ||
    normalizedMessage.includes("too many clients already") ||
    normalizedMessage.includes("too many connections") ||
    normalizedMessage.includes("remaining connection slots are reserved")
  );
}

function isFeedCircuitBreakerError(error: unknown): boolean {
  return isFeedTimeoutError(error) || isPrismaPoolPressureError(error);
}

function logFeedQueryFailure(
  queryPath: string,
  error: unknown,
  extra?: Record<string, unknown>
): void {
  const details = getPrismaErrorDetails(error);
  console.error("[posts/feed] query failure", {
    endpoint: "/api/posts",
    queryPath,
    message: details.message,
    code: details.code,
    meta: details.meta,
    ...extra,
  });
}

function logNonCriticalNotificationFailure(operation: string, error: unknown): void {
  console.warn(`[notifications] ${operation} failed; continuing without blocking the main action`, {
    message: getErrorMessage(error),
  });
}

function buildNotificationDedupeKey(params: {
  type: string;
  userId: string;
  postId?: string | null;
  fromUserId?: string | null;
  scope?: string | null;
}): string {
  const normalize = (value: string | null | undefined): string =>
    value && value.length > 0 ? value.replaceAll(":", "_") : "-";

  return [
    normalize(params.type),
    normalize(params.scope),
    normalize(params.userId),
    normalize(params.fromUserId),
    normalize(params.postId),
  ].join(":");
}

async function createNotificationSafely(params: {
  operation: string;
  data: Prisma.NotificationCreateManyInput;
  fallbackData?: Prisma.NotificationCreateManyInput;
}): Promise<void> {
  try {
    await prisma.notification.create({
      data: params.data as Prisma.NotificationUncheckedCreateInput,
    });
    invalidateNotificationsCache(params.data.userId);
    return;
  } catch (error) {
    if (isPrismaKnownRequestError(error, "P2002")) {
      return;
    }

    if (params.fallbackData && isPrismaSchemaDriftError(error)) {
      try {
        await prisma.notification.create({
          data: params.fallbackData as Prisma.NotificationUncheckedCreateInput,
        });
        invalidateNotificationsCache(params.fallbackData.userId);
        return;
      } catch (fallbackError) {
        if (isPrismaKnownRequestError(fallbackError, "P2002")) {
          return;
        }
        logNonCriticalNotificationFailure(params.operation, fallbackError);
        return;
      }
    }

    logNonCriticalNotificationFailure(params.operation, error);
  }
}

async function createManyNotificationsSafely(params: {
  operation: string;
  data: Prisma.NotificationCreateManyInput[];
  fallbackData?: Prisma.NotificationCreateManyInput[];
}): Promise<void> {
  if (params.data.length === 0) return;
  const invalidateUsers = (items: Prisma.NotificationCreateManyInput[]) => {
    const userIds = new Set<string>();
    for (const item of items) {
      if (typeof item.userId === "string" && item.userId.length > 0) {
        userIds.add(item.userId);
      }
    }
    for (const userId of userIds) {
      invalidateNotificationsCache(userId);
    }
  };

  try {
    await prisma.notification.createMany({ data: params.data, skipDuplicates: true });
    invalidateUsers(params.data);
    return;
  } catch (error) {
    if (
      params.fallbackData &&
      params.fallbackData.length > 0 &&
      isPrismaSchemaDriftError(error)
    ) {
      try {
        await prisma.notification.createMany({ data: params.fallbackData, skipDuplicates: true });
        invalidateUsers(params.fallbackData);
        return;
      } catch (fallbackError) {
        logNonCriticalNotificationFailure(params.operation, fallbackError);
        return;
      }
    }

    logNonCriticalNotificationFailure(params.operation, error);
  }
}

async function listFollowerIdsSafely(params: {
  followingId: string;
  take?: number;
  operation: string;
}): Promise<string[]> {
  try {
    const followers = await prisma.follow.findMany({
      where: { followingId: params.followingId },
      select: { followerId: true },
      ...(typeof params.take === "number" ? { take: params.take } : {}),
    });
    return followers.map((follower) => follower.followerId);
  } catch (error) {
    console.warn(`[followers] ${params.operation} failed; continuing without follower fanout`, {
      message: getErrorMessage(error),
    });
    return [];
  }
}

type CreatePostAuthorSnapshot = {
  id: string;
  name: string;
  username: string | null;
  image: string | null;
  level: number;
  xp: number;
  isVerified: boolean;
};

type CreatePostRateLimitSnapshot = {
  postCountLastHour: number;
  oldestPostLastHourAt: Date | null;
  postCountLast24h: number;
  oldestPostLast24hAt: Date | null;
};

function buildCreatePostAuthorSnapshot(params: {
  userId: string;
  sessionUser: unknown;
  dbUser?: {
    id: string;
    name: string;
    username: string | null;
    level: number;
    image?: string | null;
    xp?: number;
    isVerified?: boolean;
  } | null;
}): CreatePostAuthorSnapshot {
  const sessionUserRecord = safeRecord(params.sessionUser);
  const sessionName =
    typeof sessionUserRecord?.name === "string" && sessionUserRecord.name.trim()
      ? sessionUserRecord.name
      : null;
  const sessionUsername =
    typeof sessionUserRecord?.username === "string" && sessionUserRecord.username.trim()
      ? sessionUserRecord.username
      : null;
  const sessionImage =
    typeof sessionUserRecord?.image === "string" && sessionUserRecord.image.trim()
      ? sessionUserRecord.image
      : null;
  const sessionLevel = toFiniteNumber(sessionUserRecord?.level, 0);
  const sessionXp = toFiniteNumber(sessionUserRecord?.xp, 0);
  const sessionIsVerified =
    typeof sessionUserRecord?.isVerified === "boolean" ? sessionUserRecord.isVerified : false;

  return {
    id: params.userId,
    name: params.dbUser?.name ?? sessionName ?? "Trader",
    username: params.dbUser?.username ?? sessionUsername,
    image: params.dbUser?.image ?? sessionImage,
    level: params.dbUser?.level ?? sessionLevel,
    xp: params.dbUser?.xp ?? sessionXp,
    isVerified: params.dbUser?.isVerified ?? sessionIsVerified,
  };
}

async function resolveCreatePostUserSnapshot(params: {
  userId: string;
  sessionUser: unknown;
}): Promise<CreatePostAuthorSnapshot | null> {
  try {
    const user = await prisma.user.findUnique({
      where: { id: params.userId },
      select: {
        id: true,
        level: true,
        name: true,
        username: true,
        image: true,
        xp: true,
        isVerified: true,
      },
    });
    return user ? buildCreatePostAuthorSnapshot({ userId: params.userId, sessionUser: params.sessionUser, dbUser: user }) : null;
  } catch (error) {
    if (!isPrismaSchemaDriftError(error) && !isPrismaClientError(error)) {
      throw error;
    }
  }

  try {
    const rows = await prisma.$queryRaw<Array<{
      id: string;
      name: string;
      username: string | null;
      image: string | null;
      level: number | null;
      xp: number | null;
      isVerified: boolean | null;
    }>>(Prisma.sql`
      SELECT
        id,
        name,
        username,
        image,
        level,
        xp,
        "isVerified"
      FROM "User"
      WHERE id = ${params.userId}
      LIMIT 1
    `);
    const row = rows[0];
    if (!row) {
      return null;
    }
    return buildCreatePostAuthorSnapshot({
      userId: params.userId,
      sessionUser: params.sessionUser,
      dbUser: {
        id: row.id,
        name: row.name,
        username: row.username,
        image: row.image,
        level: toFiniteNumber(row.level, 0),
        xp: toFiniteNumber(row.xp, 0),
        isVerified: row.isVerified === true,
      },
    });
  } catch (error) {
    console.warn("[posts/create] user lookup fallback failed; using session-backed author snapshot", {
      message: getErrorMessage(error),
    });
    const sessionAuthor = buildCreatePostAuthorSnapshot({
      userId: params.userId,
      sessionUser: params.sessionUser,
    });
    return sessionAuthor.name ? sessionAuthor : null;
  }
}

async function getCreatePostRateLimitSnapshot(userId: string): Promise<CreatePostRateLimitSnapshot> {
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
  const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const rows = await prisma.$queryRaw<Array<{
    postCountLastHour: number | bigint | string | null;
    oldestPostLastHourAt: Date | null;
    postCountLast24h: number | bigint | string | null;
    oldestPostLast24hAt: Date | null;
  }>>(Prisma.sql`
    SELECT
      COUNT(*) FILTER (WHERE "createdAt" >= ${oneHourAgo}) AS "postCountLastHour",
      MIN("createdAt") FILTER (WHERE "createdAt" >= ${oneHourAgo}) AS "oldestPostLastHourAt",
      COUNT(*) FILTER (WHERE "createdAt" >= ${twentyFourHoursAgo}) AS "postCountLast24h",
      MIN("createdAt") FILTER (WHERE "createdAt" >= ${twentyFourHoursAgo}) AS "oldestPostLast24hAt"
    FROM "Post"
    WHERE "authorId" = ${userId}
  `);

  const row = rows[0];
  return {
    postCountLastHour: toFiniteNumber(row?.postCountLastHour, 0),
    oldestPostLastHourAt: row?.oldestPostLastHourAt ?? null,
    postCountLast24h: toFiniteNumber(row?.postCountLast24h, 0),
    oldestPostLast24hAt: row?.oldestPostLast24hAt ?? null,
  };
}

async function resolveCreatePostMarketContext(params: {
  address: string;
  chainType: string;
}): Promise<{
  marketCapResult: MarketCapResult;
  heliusTokenMetadata: Awaited<ReturnType<typeof getHeliusTokenMetadataForMint>> | null;
}> {
  const marketCapFallback: MarketCapResult = { mcap: null };

  const [marketCapResult, heliusTokenMetadata] = await Promise.all([
    withTimeoutFallback(
      fetchMarketCapService(params.address, params.chainType).catch((error) => {
        console.warn("[posts/create] market cap lookup failed; continuing without market context", {
          message: getErrorMessage(error),
        });
        return marketCapFallback;
      }),
      CREATE_POST_MARKETCAP_TIMEOUT_MS,
      marketCapFallback
    ),
    params.chainType === "solana" && isHeliusConfigured()
      ? withTimeoutFallback(
          getHeliusTokenMetadataForMint({ mint: params.address, chainType: params.chainType }).catch((error) => {
            console.warn("[posts/create] helius token lookup failed; continuing without token metadata", {
              message: getErrorMessage(error),
            });
            return null;
          }),
          CREATE_POST_HELIUS_TIMEOUT_MS,
          null
        )
      : Promise.resolve(null),
  ]);

  return {
    marketCapResult,
    heliusTokenMetadata,
  };
}

function buildCreatePostResponse(params: {
  id: string;
  content: string;
  authorId: string;
  contractAddress: string | null;
  chainType: string | null;
  entryMcap: number | null;
  currentMcap: number | null;
  tokenName: string | null;
  tokenSymbol: string | null;
  tokenImage: string | null;
  dexscreenerUrl: string | null;
  trackingMode: string | null;
  lastMcapUpdate: Date | null;
  createdAt: Date;
  author: CreatePostAuthorSnapshot;
  settled?: boolean;
  settledAt?: Date | null;
  isWin?: boolean | null;
}) {
  return {
    id: params.id,
    content: params.content,
    authorId: params.authorId,
    contractAddress: params.contractAddress,
    chainType: params.chainType,
    entryMcap: params.entryMcap,
    currentMcap: params.currentMcap,
    tokenName: params.tokenName,
    tokenSymbol: params.tokenSymbol,
    tokenImage: params.tokenImage,
    dexscreenerUrl: params.dexscreenerUrl,
    trackingMode: params.trackingMode,
    lastMcapUpdate: params.lastMcapUpdate,
    settled: params.settled ?? false,
    settledAt: params.settledAt ?? null,
    isWin: params.isWin ?? null,
    createdAt: params.createdAt,
    author: params.author,
    _count: {
      likes: 0,
      comments: 0,
      reposts: 0,
    },
  };
}

async function createPostRawFallback(params: {
  content: string;
  authorId: string;
  contractAddress: string | null;
  chainType: string | null;
  entryMcap: number | null;
  currentMcap: number | null;
  author: CreatePostAuthorSnapshot;
  tokenName: string | null;
  tokenSymbol: string | null;
  tokenImage: string | null;
  dexscreenerUrl: string | null;
}): Promise<ReturnType<typeof buildCreatePostResponse>> {
  const id = randomUUID();
  const now = new Date();
  await prisma.$executeRaw(Prisma.sql`
    INSERT INTO "Post" (
      id,
      content,
      "authorId",
      "contractAddress",
      "chainType",
      "entryMcap",
      "currentMcap",
      "createdAt",
      "updatedAt"
    ) VALUES (
      ${id},
      ${params.content},
      ${params.authorId},
      ${params.contractAddress},
      ${params.chainType},
      ${params.entryMcap},
      ${params.currentMcap},
      ${now},
      ${now}
    )
  `);

  return buildCreatePostResponse({
    id,
    content: params.content,
    authorId: params.authorId,
    contractAddress: params.contractAddress,
    chainType: params.chainType,
    entryMcap: params.entryMcap,
    currentMcap: params.currentMcap,
    tokenName: params.tokenName,
    tokenSymbol: params.tokenSymbol,
    tokenImage: params.tokenImage,
    dexscreenerUrl: params.dexscreenerUrl,
    trackingMode: TRACKING_MODE_ACTIVE,
    lastMcapUpdate: now,
    createdAt: now,
    author: params.author,
  });
}

function triggerNewPostFollowerFanout(params: {
  authorId: string;
  authorName: string;
  authorUsername: string | null;
  postId: string;
}): void {
  setTimeout(() => {
    void (async () => {
      const followerIds = await listFollowerIdsSafely({
        followingId: params.authorId,
        operation: "new_post_follower_lookup",
      });

      if (followerIds.length === 0) {
        return;
      }

      const displayName = params.authorUsername || params.authorName || "A trader";
      await createManyNotificationsSafely({
        operation: "new_post_follower_notification",
        data: followerIds.map((followerId) => ({
          userId: followerId,
          type: "new_post",
          message: `${displayName} just posted a new Alpha!`,
          dedupeKey: buildNotificationDedupeKey({
            type: "new_post",
            scope: "post_create",
            userId: followerId,
            fromUserId: params.authorId,
            postId: params.postId,
          }),
          postId: params.postId,
          fromUserId: params.authorId,
        })),
        fallbackData: followerIds.map((followerId) => ({
          userId: followerId,
          type: "new_post",
          message: `${displayName} just posted a new Alpha!`,
          postId: params.postId,
          fromUserId: params.authorId,
        })),
      });
    })().catch((error) => {
      console.warn("[posts/create] follower notification fanout failed", {
        message: getErrorMessage(error),
      });
    });
  }, 0);
}

function safeRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function safeNumericString(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    const normalized = Math.floor(value);
    return normalized >= 0 ? String(normalized) : null;
  }
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  if (!/^\d+$/.test(normalized)) return null;
  return normalized;
}

function safeString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function safeFiniteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function safeTimestampSeconds(value: unknown): number | null {
  const parsed = safeFiniteNumber(value);
  if (parsed === null || !Number.isFinite(parsed) || parsed <= 0) return null;
  // Supports upstream timestamps in either seconds or milliseconds.
  return parsed > 10_000_000_000 ? Math.floor(parsed / 1000) : Math.floor(parsed);
}

function normalizeChartCandle(input: {
  timestamp: unknown;
  open: unknown;
  high: unknown;
  low: unknown;
  close: unknown;
  volume?: unknown;
}): NormalizedChartCandle | null {
  const timestamp = safeTimestampSeconds(input.timestamp);
  const open = safeFiniteNumber(input.open);
  const high = safeFiniteNumber(input.high);
  const low = safeFiniteNumber(input.low);
  const close = safeFiniteNumber(input.close);
  const volume = safeFiniteNumber(input.volume ?? 0) ?? 0;
  if (
    timestamp === null ||
    open === null ||
    high === null ||
    low === null ||
    close === null
  ) {
    return null;
  }

  const normalizedHigh = Math.max(high, low, open, close);
  const normalizedLow = Math.min(high, low, open, close);
  return {
    timestamp,
    open,
    high: normalizedHigh,
    low: normalizedLow,
    close,
    volume: Number.isFinite(volume) ? volume : 0,
  };
}

function finalizeChartCandles(
  candles: Array<NormalizedChartCandle | null>,
  limit: number
): NormalizedChartCandle[] {
  const deduped = new Map<number, NormalizedChartCandle>();
  for (const candle of candles) {
    if (!candle) continue;
    deduped.set(candle.timestamp, candle);
  }

  return [...deduped.values()]
    .sort((a, b) => a.timestamp - b.timestamp)
    .slice(-limit);
}

function deriveTradeSideFromQuote(quote: Record<string, unknown>): "buy" | "sell" {
  const inputMint = safeString(quote.inputMint);
  return inputMint === SOL_MINT ? "buy" : "sell";
}

function getAlphaScoreBucketStart(value: Date): Date {
  const bucketStartMs = Math.floor(value.getTime() / ALPHA_SCORE_WINDOW_MS) * ALPHA_SCORE_WINDOW_MS;
  return new Date(bucketStartMs);
}

async function findEarliestAlphaInBucket(params: {
  authorId: string;
  contractAddress: string;
  createdAt: Date;
}) {
  const bucketStart = getAlphaScoreBucketStart(params.createdAt);
  const bucketEnd = new Date(bucketStart.getTime() + ALPHA_SCORE_WINDOW_MS);

  return await prisma.post.findFirst({
    where: {
      authorId: params.authorId,
      contractAddress: params.contractAddress,
      createdAt: {
        gte: bucketStart,
        lt: bucketEnd,
      },
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: {
      id: true,
      createdAt: true,
    },
  });
}

async function isPrimaryAlphaInBucket(params: {
  postId: string;
  authorId: string;
  contractAddress: string | null;
  createdAt: Date;
}): Promise<boolean> {
  if (!params.contractAddress) {
    return true;
  }

  const earliest = await findEarliestAlphaInBucket({
    authorId: params.authorId,
    contractAddress: params.contractAddress,
    createdAt: params.createdAt,
  });
  return earliest?.id === params.postId;
}

function buildTradeVerificationMemo(params: {
  tradeFeeEventId: string;
  postId: string;
}): string {
  return `phew:trade-fee:${params.tradeFeeEventId}:post:${params.postId}`;
}

function normalizeParsedAccountKey(value: unknown): string | null {
  if (typeof value === "string") {
    return safeString(value);
  }

  const record = safeRecord(value);
  return safeString(record?.pubkey);
}

function getParsedTransactionInstructions(
  transaction: ParsedSolanaTransaction | null
): ParsedSolanaInstruction[] {
  if (!transaction) return [];

  const topLevel = Array.isArray(transaction.transaction?.message?.instructions)
    ? transaction.transaction.message.instructions
    : [];
  const inner = Array.isArray(transaction.meta?.innerInstructions)
    ? transaction.meta.innerInstructions.flatMap((entry) =>
        Array.isArray(entry?.instructions) ? entry.instructions : []
      )
    : [];
  return [...topLevel, ...inner];
}

function readInstructionInfo(instruction: ParsedSolanaInstruction): Record<string, unknown> | null {
  const parsed = instruction.parsed;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return null;
  }

  const parsedRecord = parsed as Record<string, unknown>;
  if ("info" in parsedRecord) {
    return safeRecord(parsedRecord.info);
  }
  return parsedRecord;
}

function readInstructionAmountAtomic(instruction: ParsedSolanaInstruction): bigint | null {
  const info = readInstructionInfo(instruction);
  const directAmount = safeNumericString(info?.amount);
  if (directAmount) {
    return BigInt(directAmount);
  }

  const tokenAmount = safeRecord(info?.tokenAmount);
  const rawTokenAmount = safeNumericString(tokenAmount?.amount);
  if (rawTokenAmount) {
    return BigInt(rawTokenAmount);
  }

  const directTokenAmount = safeNumericString(info?.tokenAmount);
  if (directTokenAmount) {
    return BigInt(directTokenAmount);
  }

  const lamports = safeNumericString(info?.lamports);
  return lamports ? BigInt(lamports) : null;
}

function transactionHasExpectedSigner(
  transaction: ParsedSolanaTransaction | null,
  walletAddress: string
): boolean {
  const normalizedWallet = walletAddress.trim();
  const accountKeys = Array.isArray(transaction?.transaction?.message?.accountKeys)
    ? transaction.transaction.message.accountKeys
    : [];

  return accountKeys.some((entry) => {
    const account = normalizeParsedAccountKey(entry);
    if (account !== normalizedWallet) {
      return false;
    }
    if (typeof entry === "string") {
      return true;
    }
    return safeRecord(entry)?.signer === true;
  });
}

function transactionHasExpectedMemo(
  transaction: ParsedSolanaTransaction | null,
  expectedMemo: string
): boolean {
  const normalizedMemo = expectedMemo.trim();
  if (!normalizedMemo) return false;

  return getParsedTransactionInstructions(transaction).some((instruction) => {
    const programId = safeString(instruction.programId);
    const program = safeString(instruction.program)?.toLowerCase();
    if (
      programId !== "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr" &&
      program !== "spl-memo"
    ) {
      return false;
    }

    if (typeof instruction.parsed === "string") {
      return instruction.parsed.trim() === normalizedMemo;
    }

    const parsedRecord = safeRecord(instruction.parsed);
    return (
      safeString(parsedRecord?.memo) === normalizedMemo ||
      safeString(parsedRecord?.parsed) === normalizedMemo
    );
  });
}

function transactionHasExpectedFeeTransfer(params: {
  transaction: ParsedSolanaTransaction | null;
  destinationAddress: string;
  minimumAmountAtomic: bigint;
}): boolean {
  if (params.minimumAmountAtomic <= 0n) {
    return true;
  }

  const normalizedDestination = params.destinationAddress.trim();
  return getParsedTransactionInstructions(params.transaction).some((instruction) => {
    const info = readInstructionInfo(instruction);
    if (!info) {
      return false;
    }

    const destination =
      safeString(info.destination) ??
      safeString(info.dest) ??
      safeString(info.feeAccount);
    if (destination !== normalizedDestination) {
      return false;
    }

    const amountAtomic = readInstructionAmountAtomic(instruction);
    return amountAtomic !== null && amountAtomic >= params.minimumAmountAtomic;
  });
}

function withTimeoutFallback<T>(promise: Promise<T>, timeoutMs: number, fallback: T): Promise<T> {
  return new Promise((resolve) => {
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve(fallback);
    }, timeoutMs);

    promise
      .then((value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        resolve(value);
      })
      .catch(() => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        resolve(fallback);
      });
  });
}

class FeedTimeoutError extends Error {
  constructor(stage: string, timeoutMs: number) {
    super(`[posts/feed] ${stage} timed out after ${timeoutMs}ms`);
    this.name = "FeedTimeoutError";
  }
}

function isFeedTimeoutError(error: unknown): error is FeedTimeoutError {
  return error instanceof FeedTimeoutError;
}

function withFeedTimeout<T>(
  promise: Promise<T>,
  stage: string,
  timeoutMs = FEED_DB_QUERY_TIMEOUT_MS
): Promise<T> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new FeedTimeoutError(stage, timeoutMs));
    }, timeoutMs);

    promise
      .then((value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        resolve(value);
      })
      .catch((error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        reject(error);
      });
  });
}

type JupiterSwapPostContext = {
  id: string;
  chainType: string | null;
  authorId: string;
  author: {
    id: string;
    walletAddress: string | null;
    tradeFeeRewardsEnabled: boolean;
    tradeFeeShareBps: number;
    tradeFeePayoutAddress: string | null;
  };
};

async function attachWalletTradeSnapshots<T extends {
  [key: string]: unknown;
  contractAddress: string | null;
  chainType: string | null;
  author: { [key: string]: unknown; walletAddress?: string | null };
}>(posts: T[], maxToEnrich = FEED_HELIUS_ENRICH_MAX_POSTS_PER_REQUEST): Promise<Array<T & { walletTradeSnapshot?: unknown }>> {
  if (!isHeliusConfigured()) {
    return posts as Array<T & { walletTradeSnapshot?: unknown }>;
  }

  const eligibleIndexes: number[] = [];
  for (let i = 0; i < posts.length && eligibleIndexes.length < maxToEnrich; i++) {
    const post = posts[i];
    if (post?.chainType !== "solana" || !post?.contractAddress || !post?.author?.walletAddress) continue;
    eligibleIndexes.push(i);
  }

  if (eligibleIndexes.length === 0) {
    return posts as Array<T & { walletTradeSnapshot?: unknown }>;
  }

  const walletToMints = new Map<string, Set<string>>();
  for (const index of eligibleIndexes) {
    const post = posts[index];
    if (!post || post.chainType !== "solana" || !post.contractAddress || !post.author.walletAddress) {
      continue;
    }
    const wallet = post.author.walletAddress!;
    const mint = post.contractAddress!;
    let mintSet = walletToMints.get(wallet);
    if (!mintSet) {
      mintSet = new Set<string>();
      walletToMints.set(wallet, mintSet);
    }
    mintSet.add(mint);
  }

  const snapshotsByWallet = new Map<string, Record<string, unknown>>();
  await Promise.all(
    [...walletToMints.entries()].map(async ([walletAddress, mintSet]) => {
      try {
        const snapshots = await getWalletTradeSnapshotsForSolanaTokens({
          walletAddress,
          tokenMints: [...mintSet],
        });
        if (snapshots) {
          snapshotsByWallet.set(walletAddress, snapshots as Record<string, unknown>);
        }
      } catch (error) {
        console.warn("[posts/feed] wallet snapshot enrichment skipped for wallet", {
          walletAddress,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    })
  );

  return posts.map((post) => {
    if (post.chainType !== "solana" || !post.contractAddress || !post.author.walletAddress) {
      return post as T & { walletTradeSnapshot?: unknown };
    }
    const byMint = snapshotsByWallet.get(post.author.walletAddress);
    const walletTradeSnapshot = byMint?.[post.contractAddress];
    if (!walletTradeSnapshot) {
      return post as T & { walletTradeSnapshot?: unknown };
    }
    return {
      ...post,
      walletTradeSnapshot,
    };
  });
}

/**
 * Helper to fetch market cap using the enhanced service
 * Returns just the mcap value for backward compatibility
 */
async function fetchMarketCap(
  address: string,
  chainType?: string | null
): Promise<number | null> {
  const result = await fetchMarketCapService(address, chainType);
  return result.mcap;
}

async function getFeedMarketCapSnapshot(
  address: string,
  chainType?: string | null
): Promise<MarketCapResult> {
  const cacheKey = `${chainType ?? "unknown"}:${address}`;
  const now = Date.now();
  const cached = feedMcapCache.get(cacheKey);
  if (cached && cached.expiresAtMs > now) {
    return cached.result;
  }

  const existingInFlight = feedMcapInFlight.get(cacheKey);
  if (existingInFlight) {
    return existingInFlight;
  }

  const request = fetchMarketCapService(address, chainType)
    .then((result) => {
      feedMcapCache.set(cacheKey, {
        result,
        expiresAtMs: Date.now() + FEED_MCAP_CACHE_TTL_MS,
      });
      return result;
    })
    .finally(() => {
      feedMcapInFlight.delete(cacheKey);
    });

  feedMcapInFlight.set(cacheKey, request);
  return request;
}

async function notifyFollowersOfBigGain(params: {
  postId: string;
  authorId: string;
  authorName: string;
  authorUsername?: string | null;
  percentChange1h: number;
}): Promise<void> {
  if (params.percentChange1h < FOLLOWER_BIG_GAIN_ALERT_THRESHOLD_PCT) return;

  const followerIds = await listFollowerIdsSafely({
    followingId: params.authorId,
    take: 500,
    operation: "big_gain_alert_follower_lookup",
  });
  if (followerIds.length === 0) return;

  const displayName = params.authorUsername || params.authorName || "A trader";
  const message = `${displayName} posted a runner: +${params.percentChange1h.toFixed(1)}% at 1H`;

  await createManyNotificationsSafely({
    operation: "big_gain_alert_fanout",
    data: followerIds.map((followerId) => ({
      userId: followerId,
      type: "alpha_gain_alert",
      message,
      dedupeKey: buildNotificationDedupeKey({
        type: "alpha_gain_alert",
        scope: "1h",
        userId: followerId,
        fromUserId: params.authorId,
        postId: params.postId,
      }),
      postId: params.postId,
      fromUserId: params.authorId,
    })),
    fallbackData: followerIds.map((followerId) => ({
      userId: followerId,
      type: "alpha_gain_alert",
      message,
      postId: params.postId,
    })),
  });
}

type OneHourSettlementCandidate = {
  id: string;
  authorId: string;
  contractAddress: string | null;
  chainType: string | null;
  createdAt: Date;
  entryMcap: number | null;
  currentMcap: number | null;
  isWin: boolean | null;
  isWin1h: boolean | null;
  recoveryEligible: boolean | null;
  author: {
    name: string;
    username: string | null;
  };
};

type SixHourSnapshotCandidate = {
  id: string;
  authorId: string;
  contractAddress: string | null;
  chainType: string | null;
  createdAt: Date;
  entryMcap: number | null;
  currentMcap: number | null;
  mcap1h: number | null;
  isWin: boolean | null;
  isWin1h: boolean | null;
  recoveryEligible: boolean | null;
};

async function findPostsToSettle1h(
  oneHourAgo: Date,
  take?: number
): Promise<OneHourSettlementCandidate[]> {
  const baseWhere = {
    settled: false,
    contractAddress: { not: null },
    entryMcap: { gt: 0 },
    createdAt: { lt: oneHourAgo },
  };

  try {
    const rows = await prisma.post.findMany({
      where: baseWhere,
      select: {
        id: true,
        authorId: true,
        contractAddress: true,
        chainType: true,
        createdAt: true,
        entryMcap: true,
        currentMcap: true,
        isWin: true,
        isWin1h: true,
        recoveryEligible: true,
        author: {
          select: {
            name: true,
            username: true,
          },
        },
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      ...(typeof take === "number" ? { take } : {}),
    });
    return rows;
  } catch (error) {
    if (!isPrismaSchemaDriftError(error)) {
      throw error;
    }

    // Use raw SQL as ultimate fallback - works regardless of which columns exist
    try {
      const rawRows = await prisma.$queryRaw<Array<Record<string, unknown>>>(Prisma.sql`
        SELECT p.*, u.name AS "authorName", u.username AS "authorUsername"
        FROM "Post" p
        JOIN "User" u ON u.id = p."authorId"
        WHERE p.settled = false
          AND p."contractAddress" IS NOT NULL
          AND p."entryMcap" > 0
          AND p."createdAt" < ${oneHourAgo}
        ORDER BY p."createdAt" ASC, p.id ASC
        ${typeof take === "number" ? Prisma.sql`LIMIT ${take}` : Prisma.sql``}
      `);

      return rawRows.map((row: Record<string, unknown>) => ({
        id: row.id as string,
        authorId: row.authorId as string,
        contractAddress: row.contractAddress as string,
        chainType: (row.chainType as string) ?? null,
        createdAt: row.createdAt as Date,
        entryMcap: row.entryMcap as number | null,
        currentMcap: row.currentMcap as number | null,
        isWin: row.isWin as boolean | null,
        isWin1h: (row.isWin1h ?? row.isWin ?? null) as boolean | null,
        recoveryEligible: (row.recoveryEligible ?? null) as boolean | null,
        author: {
          name: (row.authorName as string) ?? "User",
          username: (row.authorUsername as string) ?? null,
        },
      }));
    } catch (rawError) {
      console.warn("[Settlement 1H] Raw SQL fallback also failed:", rawError);
      return [];
    }
  }
}

async function findPostsToSnapshot6h(
  sixHoursAgo: Date,
  take?: number
): Promise<SixHourSnapshotCandidate[]> {
  const withSettled6hWhere = {
    settled: true,
    settled6h: false,
    contractAddress: { not: null },
    entryMcap: { gt: 0 },
    createdAt: { lt: sixHoursAgo },
  };

  try {
    const rows = await prisma.post.findMany({
      where: withSettled6hWhere,
      select: {
        id: true,
        authorId: true,
        contractAddress: true,
        chainType: true,
        createdAt: true,
        entryMcap: true,
        currentMcap: true,
        mcap1h: true,
        isWin: true,
        isWin1h: true,
        recoveryEligible: true,
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      ...(typeof take === "number" ? { take } : {}),
    });
    return rows;
  } catch (error) {
    if (!isPrismaSchemaDriftError(error)) {
      throw error;
    }
  }

  // Compatibility fallback for partially migrated schemas: use mcap6h null check instead.
  const legacyRows = await prisma.post.findMany({
    where: {
      settled: true,
      contractAddress: { not: null },
      entryMcap: { gt: 0 },
      createdAt: { lt: sixHoursAgo },
      mcap6h: null,
    },
    select: {
      id: true,
      authorId: true,
      contractAddress: true,
      chainType: true,
      createdAt: true,
      entryMcap: true,
      currentMcap: true,
      mcap1h: true,
      isWin: true,
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    ...(typeof take === "number" ? { take } : {}),
  });

  return legacyRows.map((row) => ({
    ...row,
    mcap1h: null,
    isWin1h: row.isWin,
    recoveryEligible: null,
  }));
}

// Background settlement check - runs automatically on feed fetch
// This ensures trades settle for ALL users, not just when they open the app
/**
 * TODO: Background Job System Enhancement
 *
 * The current implementation uses a lazy update pattern where market caps
 * are updated when the feed is fetched. For production, consider implementing
 * a proper background job system (see services/marketcap.ts for details).
 */
async function checkAndSettlePosts(): Promise<SettlementRunResult> {
  return await withSettlementRunLock(
    "background_settlement",
    () => createSkippedSettlementResult("database_lock_held"),
    async () => {
      const now = Date.now();
      const oneHourAgo = new Date(now - SETTLEMENT_1H_MS);
      const sixHoursAgo = new Date(now - SETTLEMENT_6H_MS);

      let settled1hCount = 0;
      let snapshot6hCount = 0;
      let levelChanges6hCount = 0;
      let errorCount = 0;

      try {
        // ============================================
        // 1H SETTLEMENT - Official settlement for XP/Level
        // ============================================
        const oneHourScanLimit = SETTLEMENT_1H_TARGET_PER_RUN * SETTLEMENT_1H_SCAN_MULTIPLIER;
        const postsToSettle1h = await findPostsToSettle1h(oneHourAgo, oneHourScanLimit);

    for (const post of postsToSettle1h) {
      if (settled1hCount >= SETTLEMENT_1H_TARGET_PER_RUN) break;
      if (!post.contractAddress || post.entryMcap === null) continue;

      try {
        const fetchedMcap = await fetchMarketCap(post.contractAddress, post.chainType);
        const mcap1h = fetchedMcap ?? post.currentMcap;
        if (mcap1h === null || mcap1h <= 0) {
          errorCount++;
          continue;
        }

        // Calculate percent change at 1H
        const percentChange1h = ((mcap1h - post.entryMcap) / post.entryMcap) * 100;
        const isWin1h = mcap1h > post.entryMcap;

        // Use the new 1H settlement logic
        const { levelChange, recoveryEligible } = calculate1HSettlement(percentChange1h);
        const xpChange = calculateXpChange(percentChange1h);
        const currentUser = await prisma.user.findUnique({
          where: { id: post.authorId },
          select: { id: true, level: true, xp: true },
        });
        if (!currentUser) {
          errorCount++;
          continue;
        }
        const scoreEligible = await isPrimaryAlphaInBucket({
          postId: post.id,
          authorId: post.authorId,
          contractAddress: post.contractAddress,
          createdAt: post.createdAt,
        });
        const effectiveLevelChange = scoreEligible ? levelChange : 0;
        const effectiveXpChange = scoreEligible ? xpChange : 0;
        const effectiveRecoveryEligible = scoreEligible ? recoveryEligible : false;
        const newLevel = calculateFinalLevel(currentUser.level, effectiveLevelChange);
        const newXp = Math.max(0, currentUser.xp + effectiveXpChange);
        const settledAt = new Date();

        // Keep settlement + user rewards/penalties atomic to avoid "settled but no level/xp" failures.
        try {
          await prisma.$transaction([
            prisma.post.updateMany({
              where: { id: post.id },
              data: {
                settled: true,
                settledAt,
                isWin: isWin1h,
                isWin1h: isWin1h,
                currentMcap: mcap1h,
                mcap1h: mcap1h,
                percentChange1h: percentChange1h,
                recoveryEligible: effectiveRecoveryEligible,
                levelChange1h: effectiveLevelChange,
                trackingMode: TRACKING_MODE_SETTLED,
                lastMcapUpdate: settledAt,
              },
            }),
            prisma.user.updateMany({
              where: { id: post.authorId },
              data: {
                level: newLevel,
                xp: newXp,
              },
            }),
          ]);
        } catch (error) {
          if (!isPrismaSchemaDriftError(error)) {
            throw error;
          }

          // Use raw SQL to update - works regardless of which columns exist
          try {
            await prisma.$executeRaw`
              UPDATE "Post" SET settled = true, "settledAt" = ${settledAt}, "isWin" = ${isWin1h}, "currentMcap" = ${mcap1h}
              WHERE id = ${post.id}
            `;
          } catch (rawPostErr) {
            console.warn("[Settlement 1H] Raw post update failed (continuing with user update):", rawPostErr);
          }
          await prisma.$executeRaw`
            UPDATE "User" SET level = ${newLevel}, xp = ${newXp} WHERE id = ${post.authorId}
          `;
        }

        // Create notification for the author about 1H settlement
        if (scoreEligible) {
          const levelDiff = newLevel - currentUser.level;
          const xpDisplay =
            effectiveXpChange >= 0 ? `+${effectiveXpChange}` : effectiveXpChange;
          const levelDisplay = levelDiff >= 0 ? `+${levelDiff}` : levelDiff;

          let settlementMsg: string;
          if (isWin1h) {
            settlementMsg =
              levelDiff !== 0
                ? `1H WIN! +${percentChange1h.toFixed(1)}% | Level ${levelDisplay} | XP ${xpDisplay}`
                : `1H WIN! +${percentChange1h.toFixed(1)}% | XP ${xpDisplay}`;
          } else if (effectiveRecoveryEligible) {
            settlementMsg = `1H: ${percentChange1h.toFixed(1)}% | Recovery chance at 6H!`;
          } else {
            settlementMsg = `1H LOSS: ${percentChange1h.toFixed(1)}% | Level ${levelDisplay} | XP ${xpDisplay}`;
          }

          await createNotificationSafely({
            operation: "settlement_1h_author_notification",
            data: {
              userId: post.authorId,
              type: "settlement",
              message: settlementMsg,
              dedupeKey: buildNotificationDedupeKey({
                type: "settlement",
                scope: "1h",
                userId: post.authorId,
                postId: post.id,
              }),
              postId: post.id,
            },
          });
          await notifyFollowersOfBigGain({
            postId: post.id,
            authorId: post.authorId,
            authorName: post.author.name,
            authorUsername: post.author.username,
            percentChange1h,
          });
        }

        settled1hCount++;
        console.log(`[Settlement 1H] Post ${post.id}: ${isWin1h ? 'WIN' : 'LOSS'} (${percentChange1h.toFixed(2)}%), scoreEligible=${scoreEligible}, recoveryEligible=${effectiveRecoveryEligible}, User ${post.authorId} level ${currentUser.level} -> ${newLevel}`);
      } catch (err) {
        console.error(`[Settlement 1H] Error settling post ${post.id}:`, err);
        errorCount++;
      }
    }

    // ============================================
    // 6H MARKET CAP SNAPSHOT - For ALL posts >= 6 hours old
    // This captures the 6H mcap regardless of whether level changes apply
    // ============================================
    const sixHourScanLimit = SETTLEMENT_6H_TARGET_PER_RUN * SETTLEMENT_6H_SCAN_MULTIPLIER;
    const postsNeedingSnapshot6h = await findPostsToSnapshot6h(sixHoursAgo, sixHourScanLimit);

    console.log(`[Snapshot 6H] Found ${postsNeedingSnapshot6h.length} posts needing 6H mcap snapshot`);

    for (const post of postsNeedingSnapshot6h) {
      if (snapshot6hCount >= SETTLEMENT_6H_TARGET_PER_RUN) break;
      if (!post.contractAddress || post.entryMcap === null) continue;

      try {
        // Fetch current market cap from DexScreener
        const fetchedMcap = await fetchMarketCap(post.contractAddress, post.chainType);
        const mcap6h = fetchedMcap ?? post.currentMcap ?? post.mcap1h;
        if (mcap6h === null || mcap6h <= 0) {
          console.warn(`[Snapshot 6H] Could not fetch mcap for post ${post.id} (CA: ${post.contractAddress})`);
          errorCount++;
          continue;
        }

        // Calculate percent change at 6H relative to entry
        const percentChange6h = ((mcap6h - post.entryMcap) / post.entryMcap) * 100;
        const isWin6h = percentChange6h > 0;

        // Now check if this post needs level adjustment based on 6H rules
        const isWin1h = post.isWin1h ?? post.isWin ?? false;
        const recoveryEligible = post.recoveryEligible ?? false;
        const levelChange6h = calculate6HSettlement(isWin1h, percentChange6h, recoveryEligible);
        const xpChange6h = calculate6HXpChange(percentChange6h, levelChange6h);
        const scoreEligible = await isPrimaryAlphaInBucket({
          postId: post.id,
          authorId: post.authorId,
          contractAddress: post.contractAddress,
          createdAt: post.createdAt,
        });
        const effectiveLevelChange6h = scoreEligible ? levelChange6h : 0;
        const effectiveXpChange6h = scoreEligible ? xpChange6h : 0;
        const snapshotUpdatedAt = new Date();

        // Keep 6H snapshot + user rewards atomic when XP and/or level changes apply.
        if (effectiveLevelChange6h !== 0 || effectiveXpChange6h !== 0) {
          const currentUser = await prisma.user.findUnique({
            where: { id: post.authorId },
            select: { id: true, level: true, xp: true },
          });
          if (!currentUser) {
            errorCount++;
            continue;
          }
          const newLevel = calculateFinalLevel(currentUser.level, effectiveLevelChange6h);
          const newXp = Math.max(0, currentUser.xp + effectiveXpChange6h);
          try {
            await prisma.$transaction([
              prisma.post.updateMany({
                where: { id: post.id },
                data: {
                  mcap6h: mcap6h,
                  currentMcap: mcap6h,
                  isWin6h: isWin6h,
                  percentChange6h: percentChange6h,
                  settled6h: true,
                  levelChange6h: effectiveLevelChange6h,
                  lastMcapUpdate: snapshotUpdatedAt,
                },
              }),
              prisma.user.updateMany({
                where: { id: post.authorId },
                data: {
                  level: newLevel,
                  xp: newXp,
                },
              }),
            ]);
          } catch (error) {
            if (!isPrismaSchemaDriftError(error)) {
              throw error;
            }

            await prisma.$transaction([
              prisma.post.updateMany({
                where: { id: post.id },
                data: {
                  currentMcap: mcap6h,
                },
              }),
              prisma.user.updateMany({
                where: { id: post.authorId },
                data: {
                  level: newLevel,
                  xp: newXp,
                },
              }),
            ]);
          }

          snapshot6hCount++;
          console.log(`[Snapshot 6H] Post ${post.id}: mcap6h=${mcap6h}, change=${percentChange6h.toFixed(2)}%, isWin6h=${isWin6h}`);

          // Create notification for the user about level change
          const levelDiff = newLevel - currentUser.level;
          const levelDisplay = levelDiff >= 0 ? `+${levelDiff}` : levelDiff;
          const xpDisplay =
            effectiveXpChange6h >= 0 ? `+${effectiveXpChange6h}` : effectiveXpChange6h;

          let msg6h: string;
          if (effectiveLevelChange6h > 0 && recoveryEligible) {
            msg6h = `6H RECOVERY! +${percentChange6h.toFixed(1)}% | Level ${levelDisplay} | XP ${xpDisplay}`;
          } else if (effectiveLevelChange6h > 0) {
            msg6h = `6H BONUS! +${percentChange6h.toFixed(1)}% | Level ${levelDisplay} | XP ${xpDisplay}`;
          } else if (effectiveLevelChange6h < 0) {
            msg6h = `6H: ${percentChange6h.toFixed(1)}% | Level ${levelDisplay} | XP ${xpDisplay}`;
          } else {
            msg6h = `6H SNAPSHOT WIN! +${percentChange6h.toFixed(1)}% | XP ${xpDisplay}`;
          }

          await createNotificationSafely({
            operation: "settlement_6h_author_notification",
            data: {
              userId: post.authorId,
              type: "settlement",
              message: msg6h,
              dedupeKey: buildNotificationDedupeKey({
                type: "settlement",
                scope: "6h",
                userId: post.authorId,
                postId: post.id,
              }),
              postId: post.id,
            },
          });

          if (effectiveLevelChange6h !== 0) {
            levelChanges6hCount++;
            console.log(`[Settlement 6H Level] Post ${post.id}: levelChange6h=${effectiveLevelChange6h}, User ${post.authorId} level ${currentUser.level} -> ${newLevel}`);
          } else {
            console.log(`[Settlement 6H XP] Post ${post.id}: +${percentChange6h.toFixed(2)}%, XP ${xpDisplay}, User ${post.authorId}`);
          }
        } else {
          try {
            await prisma.post.updateMany({
              where: { id: post.id },
              data: {
                mcap6h: mcap6h,
                currentMcap: mcap6h,
                isWin6h: isWin6h,
                percentChange6h: percentChange6h,
                settled6h: true,
                lastMcapUpdate: snapshotUpdatedAt,
              },
            });
          } catch (error) {
            if (!isPrismaSchemaDriftError(error)) {
              throw error;
            }
            await prisma.post.updateMany({
              where: { id: post.id },
              data: {
                currentMcap: mcap6h,
              },
            });
          }

          snapshot6hCount++;
          console.log(`[Snapshot 6H] Post ${post.id}: mcap6h=${mcap6h}, change=${percentChange6h.toFixed(2)}%, isWin6h=${isWin6h}`);
        }
      } catch (err) {
        console.error(`[Snapshot 6H] Error processing post ${post.id}:`, err);
        errorCount++;
      }
    }
      } catch (err) {
        console.error("[Settlement] Background check error:", err);
      }

      if (settled1hCount > 0 || snapshot6hCount > 0 || levelChanges6hCount > 0) {
        invalidatePostReadCaches({ leaderboard: true });
      }

      return {
        settled1h: settled1hCount,
        snapshot6h: snapshot6hCount,
        levelChanges6h: levelChanges6hCount,
        errors: errorCount,
      };
    }
  );
}

async function refreshTrackedMarketCaps(): Promise<MarketRefreshRunResult> {
  const result: MarketRefreshRunResult = {
    scannedPosts: 0,
    eligiblePosts: 0,
    refreshedContracts: 0,
    updatedPosts: 0,
    errors: 0,
  };

  try {
    const lookback = new Date(Date.now() - MARKET_REFRESH_LOOKBACK_MS);
    const candidates = await prisma.post.findMany({
      where: {
        contractAddress: { not: null },
        createdAt: { gte: lookback },
      },
      select: {
        id: true,
        contractAddress: true,
        chainType: true,
        entryMcap: true,
        currentMcap: true,
        createdAt: true,
        settled: true,
        lastMcapUpdate: true,
        trackingMode: true,
        tokenName: true,
        tokenSymbol: true,
        tokenImage: true,
        dexscreenerUrl: true,
      },
      orderBy: [
        { lastMcapUpdate: "asc" },
        { createdAt: "desc" },
      ],
      take: MARKET_REFRESH_SCAN_LIMIT,
    });

    result.scannedPosts = candidates.length;

    const postsByContract = new Map<
      string,
      {
        contractAddress: string;
        chainType: string | null;
        posts: typeof candidates;
      }
    >();
    for (const post of candidates) {
      const contractAddress = post.contractAddress;
      if (!contractAddress) continue;

      const shouldUpdateMcap = needsMcapUpdate(post.createdAt, post.lastMcapUpdate, post.settled);
      const needsTokenMetadata = !post.tokenName || !post.tokenSymbol || !post.tokenImage;
      if (!shouldUpdateMcap && !needsTokenMetadata) continue;

      if (
        !shouldUpdateMcap &&
        needsTokenMetadata &&
        post.chainType === "solana" &&
        isHeliusConfigured()
      ) {
        try {
          const heliusMetadata = await getHeliusTokenMetadataForMint({
            mint: contractAddress,
            chainType: post.chainType,
          });
          if (heliusMetadata) {
            const updateData: {
              tokenName?: string | null;
              tokenSymbol?: string | null;
              tokenImage?: string | null;
            } = {};

            if (!post.tokenName && heliusMetadata.tokenName) updateData.tokenName = heliusMetadata.tokenName;
            if (!post.tokenSymbol && heliusMetadata.tokenSymbol) updateData.tokenSymbol = heliusMetadata.tokenSymbol;
            if (!post.tokenImage && heliusMetadata.tokenImage) updateData.tokenImage = heliusMetadata.tokenImage;

            if (Object.keys(updateData).length > 0) {
              await prisma.post.updateMany({
                where: { id: post.id },
                data: updateData,
              });
              result.updatedPosts++;
              const stillMissingMetadata =
                (!post.tokenName && !updateData.tokenName) ||
                (!post.tokenSymbol && !updateData.tokenSymbol) ||
                (!post.tokenImage && !updateData.tokenImage);
              if (!stillMissingMetadata) continue;
            }
          }
        } catch (error) {
          console.error("[Maintenance] Failed Helius metadata backfill", {
            postId: post.id,
            contractAddress,
            error,
          });
          result.errors++;
        }
      }

      result.eligiblePosts++;

      const contractKey = `${post.chainType ?? "unknown"}:${contractAddress}`;
      let bucket = postsByContract.get(contractKey);
      if (!bucket) {
        if (postsByContract.size >= MARKET_REFRESH_MAX_CONTRACTS_PER_RUN) continue;
        bucket = {
          contractAddress,
          chainType: post.chainType,
          posts: [],
        };
        postsByContract.set(contractKey, bucket);
      }
      bucket.posts.push(post);
    }

    for (const [, bucket] of postsByContract) {
      const { contractAddress, chainType, posts } = bucket;
      let marketCapResult: MarketCapResult;
      let heliusMetadata: Awaited<ReturnType<typeof getHeliusTokenMetadataForMint>> | null = null;

      try {
        marketCapResult = await getFeedMarketCapSnapshot(contractAddress, chainType);
        if (
          isHeliusConfigured() &&
          posts.some((p) => p.chainType === "solana" && (!p.tokenName || !p.tokenSymbol || !p.tokenImage))
        ) {
          heliusMetadata = await getHeliusTokenMetadataForMint({
            mint: contractAddress,
            chainType: "solana",
          });
        }
        result.refreshedContracts++;
      } catch (error) {
        console.error("[Maintenance] Failed to fetch market cap for contract", {
          contractAddress,
          error,
        });
        result.errors++;
        continue;
      }

      for (const post of posts) {
        try {
          const shouldUpdateMcap = needsMcapUpdate(post.createdAt, post.lastMcapUpdate, post.settled);
          const trackingMode = determineTrackingMode(post.createdAt);
          const updateData: {
            entryMcap?: number;
            currentMcap?: number;
            lastMcapUpdate?: Date;
            trackingMode?: string;
            tokenName?: string | null;
            tokenSymbol?: string | null;
            tokenImage?: string | null;
            dexscreenerUrl?: string | null;
          } = {};

          if (post.entryMcap === null && marketCapResult.mcap !== null) {
            // Backfill missing entry market cap so this trade can be settled at 1H/6H.
            // Without this, null-entry rows can remain unresolved forever.
            updateData.entryMcap = marketCapResult.mcap;
            if (post.currentMcap === null) {
              updateData.currentMcap = marketCapResult.mcap;
              updateData.lastMcapUpdate = new Date();
            }
          }

          if (shouldUpdateMcap && marketCapResult.mcap !== null) {
            updateData.currentMcap = marketCapResult.mcap;
            updateData.lastMcapUpdate = new Date();
            updateData.trackingMode = trackingMode;
          }

          if (!post.tokenName && (heliusMetadata?.tokenName || marketCapResult.tokenName)) {
            updateData.tokenName = heliusMetadata?.tokenName ?? marketCapResult.tokenName;
          }
          if (!post.tokenSymbol && (heliusMetadata?.tokenSymbol || marketCapResult.tokenSymbol)) {
            updateData.tokenSymbol = heliusMetadata?.tokenSymbol ?? marketCapResult.tokenSymbol;
          }
          if (!post.tokenImage && (marketCapResult.tokenImage || heliusMetadata?.tokenImage)) {
            updateData.tokenImage = marketCapResult.tokenImage ?? heliusMetadata?.tokenImage;
          }
          if (!post.dexscreenerUrl && marketCapResult.dexscreenerUrl) {
            updateData.dexscreenerUrl = marketCapResult.dexscreenerUrl;
          }

          if (Object.keys(updateData).length === 0) continue;

          await prisma.post.updateMany({
            where: { id: post.id },
            data: updateData,
          });
          result.updatedPosts++;
        } catch (error) {
          console.error("[Maintenance] Failed to persist market cap update", {
            postId: post.id,
            contractAddress,
            error,
          });
          result.errors++;
        }
      }
    }
  } catch (error) {
    console.error("[Maintenance] Market refresh scan failed:", error);
    result.errors++;
  }

  if (result.updatedPosts > 0) {
    invalidatePostReadCaches({ leaderboard: true });
  }

  return result;
}

function isAuthorizedMaintenanceRequest(c: { req: { header: (name: string) => string | undefined } }): boolean {
  const cronSecret = process.env.CRON_SECRET?.trim();
  if (!cronSecret) return false;

  const authHeader = c.req.header("authorization") ?? c.req.header("Authorization");
  if (authHeader?.startsWith("Bearer ")) {
    const token = authHeader.slice("Bearer ".length).trim();
    if (token && token === cronSecret) return true;
  }

  const rawSecret = c.req.header("x-cron-secret")?.trim();
  return !!rawSecret && rawSecret === cronSecret;
}

function createSkippedSettlementResult(reason: string): SettlementRunResult {
  return {
    settled1h: 0,
    snapshot6h: 0,
    levelChanges6h: 0,
    errors: 0,
    skipped: true,
    reason,
  };
}

async function tryAcquireSettlementRunLock(reason: string): Promise<{
  acquired: boolean;
  ownerToken: string;
}> {
  const ownerToken = `${runtimeInstanceId}:${Date.now()}:${randomUUID().slice(0, 8)}`;
  const acquiredAt = new Date();
  const expiresAt = new Date(acquiredAt.getTime() + SETTLEMENT_RUN_LOCK_TTL_MS);
  const payload = JSON.stringify({
    ownerToken,
    reason,
    instanceId: runtimeInstanceId,
    acquiredAt: acquiredAt.toISOString(),
  });

  const rows = await prisma.$queryRaw<Array<{ key: string }>>(Prisma.sql`
    INSERT INTO "AggregateSnapshot" ("key", "version", "payload", "capturedAt", "expiresAt", "updatedAt")
    VALUES (
      ${SETTLEMENT_RUN_LOCK_KEY},
      1,
      CAST(${payload} AS jsonb),
      ${acquiredAt},
      ${expiresAt},
      ${acquiredAt}
    )
    ON CONFLICT ("key") DO UPDATE
    SET
      "payload" = EXCLUDED."payload",
      "capturedAt" = EXCLUDED."capturedAt",
      "expiresAt" = EXCLUDED."expiresAt",
      "updatedAt" = EXCLUDED."updatedAt"
    WHERE "AggregateSnapshot"."expiresAt" <= NOW()
    RETURNING "key"
  `);

  return {
    acquired: rows.length > 0,
    ownerToken,
  };
}

async function refreshSettlementRunLock(ownerToken: string): Promise<boolean> {
  const refreshedUntil = new Date(Date.now() + SETTLEMENT_RUN_LOCK_TTL_MS);
  const updatedAt = new Date();
  const refreshed = await prisma.$executeRaw(Prisma.sql`
    UPDATE "AggregateSnapshot"
    SET "expiresAt" = ${refreshedUntil},
        "updatedAt" = ${updatedAt}
    WHERE "key" = ${SETTLEMENT_RUN_LOCK_KEY}
      AND "payload"->>'ownerToken' = ${ownerToken}
  `);
  return refreshed > 0;
}

async function releaseSettlementRunLock(ownerToken: string): Promise<void> {
  await prisma.$executeRaw(Prisma.sql`
    DELETE FROM "AggregateSnapshot"
    WHERE "key" = ${SETTLEMENT_RUN_LOCK_KEY}
      AND "payload"->>'ownerToken' = ${ownerToken}
  `);
}

async function withSettlementRunLock<T>(
  reason: string,
  onLocked: () => Promise<T> | T,
  run: () => Promise<T>
): Promise<T> {
  const lockState = await tryAcquireSettlementRunLock(reason);
  if (!lockState.acquired) {
    console.warn("[Settlement] Run lock unavailable; skipping overlapping execution", {
      reason,
      lockKey: SETTLEMENT_RUN_LOCK_KEY,
    });
    return await onLocked();
  }

  const heartbeat = setInterval(() => {
    void refreshSettlementRunLock(lockState.ownerToken)
      .then((refreshed) => {
        if (!refreshed) {
          console.warn("[Settlement] Run lock heartbeat lost ownership", {
            reason,
            lockKey: SETTLEMENT_RUN_LOCK_KEY,
          });
        }
      })
      .catch((error) => {
        console.warn("[Settlement] Failed to refresh run lock", {
          reason,
          message: getErrorMessage(error),
        });
      });
  }, SETTLEMENT_RUN_LOCK_REFRESH_INTERVAL_MS);
  heartbeat.unref?.();

  try {
    return await run();
  } finally {
    clearInterval(heartbeat);
    try {
      await releaseSettlementRunLock(lockState.ownerToken);
    } catch (error) {
      console.warn("[Settlement] Failed to release run lock", {
        reason,
        message: getErrorMessage(error),
      });
    }
  }
}

async function prewarmLeaderboardSnapshots(): Promise<{
  attempted: number;
  succeeded: number;
  failed: number;
  durationMs: number;
  skipped?: boolean;
  reason?: string;
}> {
  const now = Date.now();
  if (now - lastLeaderboardSnapshotWarmAt < LEADERBOARD_SNAPSHOT_WARM_INTERVAL_MS) {
    return {
      attempted: 0,
      succeeded: 0,
      failed: 0,
      durationMs: 0,
      skipped: true,
      reason: "cooldown",
    };
  }

  const baseUrl = process.env.BACKEND_URL?.trim();
  if (!baseUrl) {
    return {
      attempted: 0,
      succeeded: 0,
      failed: 0,
      durationMs: 0,
      skipped: true,
      reason: "missing_backend_url",
    };
  }

  const startedAtMs = Date.now();
  const endpoints = [
    "/api/leaderboard/daily-gainers",
    "/api/leaderboard/stats",
    "/api/leaderboard/top-users?sortBy=level&page=1&limit=20",
    "/api/leaderboard/top-users?sortBy=activity&page=1&limit=20",
    "/api/leaderboard/top-users?sortBy=winrate&page=1&limit=20",
  ];

  let attempted = 0;
  let succeeded = 0;
  let failed = 0;

  const fetchWithTimeout = async (path: string) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4_000);
    try {
      attempted += 1;
      const url = new URL(path, baseUrl).toString();
      const response = await fetch(url, {
        method: "GET",
        headers: {
          "x-maintenance-prewarm": "1",
        },
        signal: controller.signal,
      });
      if (!response.ok) {
        failed += 1;
        console.warn("[Maintenance] Snapshot prewarm request failed", {
          path,
          status: response.status,
        });
        return;
      }
      succeeded += 1;
    } catch (error) {
      failed += 1;
      console.warn("[Maintenance] Snapshot prewarm request error", { path, error });
    } finally {
      clearTimeout(timeout);
    }
  };

  const endpointToWarm = endpoints[leaderboardSnapshotWarmCursor % endpoints.length];
  leaderboardSnapshotWarmCursor = (leaderboardSnapshotWarmCursor + 1) % endpoints.length;

  if (endpointToWarm) {
    await fetchWithTimeout(endpointToWarm);
  }

  // Advance cooldown after each attempt to prevent repeated warm spikes if an endpoint fails.
  lastLeaderboardSnapshotWarmAt = now;

  return {
    attempted,
    succeeded,
    failed,
    durationMs: Date.now() - startedAtMs,
  };
}

async function runMaintenanceCycle(options?: { prewarmSnapshots?: boolean }): Promise<MaintenanceRunResult> {
  const startedAtMs = Date.now();
  const settlement = await checkAndSettlePosts();
  const marketRefresh = await refreshTrackedMarketCaps();
  const snapshotWarmup = options?.prewarmSnapshots
    ? await prewarmLeaderboardSnapshots()
    : {
        attempted: 0,
        succeeded: 0,
        failed: 0,
        durationMs: 0,
        skipped: true,
        reason: "disabled_for_opportunistic_run",
      };

  const summary: MaintenanceRunResult = {
    startedAt: new Date(startedAtMs).toISOString(),
    durationMs: Date.now() - startedAtMs,
    settlement,
    marketRefresh,
    snapshotWarmup,
  };

  if (
    settlement.settled1h ||
    settlement.snapshot6h ||
    settlement.levelChanges6h ||
    settlement.errors ||
    marketRefresh.refreshedContracts ||
    marketRefresh.updatedPosts ||
    marketRefresh.errors ||
    (snapshotWarmup.succeeded > 0 || snapshotWarmup.failed > 0)
  ) {
    console.log("[Maintenance] Run result:", summary);
  }

  // Trending and feed caches may depend on currentMcap updates.
  if (marketRefresh.updatedPosts > 0) {
    trendingCache = null;
  }

  return summary;
}

function triggerMaintenanceCycleNonBlocking(reason: string): void {
  const now = Date.now();
  if (maintenanceRunInFlight) return;
  if (now - lastMaintenanceRunStartedAt < MAINTENANCE_RUN_MIN_INTERVAL_MS) return;

  lastMaintenanceRunStartedAt = now;
  maintenanceRunInFlight = runMaintenanceCycle()
    .then((result) => {
      if (
        result.settlement.settled1h ||
        result.settlement.snapshot6h ||
        result.settlement.levelChanges6h ||
        result.settlement.errors ||
        result.marketRefresh.updatedPosts ||
        result.marketRefresh.errors
      ) {
        console.log("[Maintenance] Opportunistic trigger completed", { reason, result });
      }
      return result;
    })
    .catch((error) => {
      console.error("[Maintenance] Opportunistic trigger failed", { reason, error });
      // Do not rethrow from non-awaited background maintenance.
      // Rethrow here can surface as an unhandled rejection and destabilize the API process.
      return {
        startedAt: new Date(now).toISOString(),
        durationMs: Date.now() - now,
        settlement: { settled1h: 0, snapshot6h: 0, levelChanges6h: 0, errors: 1 },
        marketRefresh: { scannedPosts: 0, eligiblePosts: 0, refreshedContracts: 0, updatedPosts: 0, errors: 1 },
        snapshotWarmup: {
          attempted: 0,
          succeeded: 0,
          failed: 1,
          durationMs: 0,
          skipped: true,
          reason: "opportunistic_run_failed",
        },
      } satisfies MaintenanceRunResult;
    })
    .finally(() => {
      maintenanceRunInFlight = null;
    });
}

function triggerSettlementCycleNonBlocking(reason: string): void {
  const now = Date.now();
  if (settlementRunInFlight) return;
  if (now - lastSettlementRunStartedAt < SETTLEMENT_RUN_MIN_INTERVAL_MS) return;

  lastSettlementRunStartedAt = now;
  settlementRunInFlight = checkAndSettlePosts()
    .then((result) => {
      if (result.settled1h || result.snapshot6h || result.levelChanges6h || result.errors) {
        console.log("[Settlement] Opportunistic trigger completed", { reason, result });
      }
      return result;
    })
    .catch((error) => {
      console.error("[Settlement] Opportunistic trigger failed", { reason, error });
      return { settled1h: 0, snapshot6h: 0, levelChanges6h: 0, errors: 1 } satisfies SettlementRunResult;
    })
    .finally(() => {
      settlementRunInFlight = null;
    });
}

// Get all posts (feed) with sorting and filtering
postsRouter.get("/", async (c) => {
  const user = c.get("user");
  const queryParams = c.req.query();

  // Parse query params
  const parsed = FeedQuerySchema.safeParse(queryParams);
  const { sort, following, limit, cursor, search } = parsed.success
    ? parsed.data
    : { sort: "latest" as const, following: false, limit: 10, cursor: undefined, search: undefined };
  const feedCacheKey = buildFeedResponseCacheKey({
    userId: user?.id ?? null,
    sort,
    following,
    limit,
    cursor,
    search,
  });
  const sharedFeedCacheKey = buildFeedSharedResponseCacheKey({
    sort,
    following,
    limit,
    cursor,
    search,
  });
  let feedDegradedMode = isFeedDegradedCircuitOpen();
  const readStaleFeedPayload = async (): Promise<FeedResponsePayload | null> => {
    const nowMs = Date.now();
    const redisSharedFallback =
      !following ? await readSharedFeedResponseFromRedis(sharedFeedCacheKey) : null;
    return (
      readFeedResponseFromCache(feedResponseCache, feedCacheKey, nowMs, { allowStale: true }) ??
      ((!following)
        ? readFeedResponseFromCache(feedSharedResponseCache, sharedFeedCacheKey, nowMs, {
            allowStale: true,
          }) ??
          redisSharedFallback
        : null)
    );
  };
  const respondWithFeedCacheFallback = async (error: unknown) => {
    const stalePayload = await readStaleFeedPayload();
    console.warn("[posts/feed] falling back to cached payload after database error", {
      sort,
      following,
      cursor: cursor ?? null,
      search: search ?? null,
      userId: user?.id ?? null,
      hasStalePayload: Boolean(stalePayload),
      message: error instanceof Error ? error.message : String(error),
    });
    if (stalePayload) {
      return c.json(stalePayload);
    }
    if (isPrismaClientError(error) || isFeedTimeoutError(error)) {
      console.warn("[posts/feed] no cached payload available; serving empty degraded feed", {
        sort,
        following,
        cursor: cursor ?? null,
        search: search ?? null,
        userId: user?.id ?? null,
      });
      return c.json({
        data: [],
        hasMore: false,
        nextCursor: null,
      });
    }
    return c.json(
      {
        error: {
          message: "Feed is temporarily unavailable. Please retry in a moment.",
          code: "FEED_UNAVAILABLE",
        },
      },
      503
    );
  };

  if (!cursor) {
    const nowMs = Date.now();
    const redisSharedPayload =
      !following ? await readSharedFeedResponseFromRedis(sharedFeedCacheKey) : null;
    const freshPayload =
      readFeedResponseFromCache(feedResponseCache, feedCacheKey, nowMs) ??
      ((!following)
        ? readFeedResponseFromCache(feedSharedResponseCache, sharedFeedCacheKey, nowMs) ??
          redisSharedPayload
        : null);
    if (freshPayload) {
      return c.json(freshPayload);
    }
  }

  if (feedDegradedMode && !cursor) {
    const stalePayload = await readStaleFeedPayload();
    if (stalePayload) {
      return c.json(stalePayload);
    }
  }

  const feedRequestLease = feedRequestLimiter.tryAcquire();
  if (!feedRequestLease) {
    console.warn("[posts/feed] request concurrency cap reached", {
      sort,
      following,
      cursor: cursor ?? null,
      search: search ?? null,
      inFlight: feedRequestLimiter.current(),
      limit: feedRequestLimiter.limit,
    });
    const stalePayload = await readStaleFeedPayload();
    if (stalePayload) {
      return c.json(stalePayload);
    }
    return c.json({
      data: [],
      hasMore: false,
      nextCursor: null,
    });
  }

  try {

  // Keep settlement/snapshot state progressing from organic traffic without running the full
  // market-refresh job on the feed path. Cron/manual maintenance handles the heavier updates.
  if (!feedDegradedMode && !cursor && shouldRunOpportunisticMaintenance()) {
    const reason = search
      ? `feed:${sort}:search`
      : following
        ? `feed:${sort}:following`
        : `feed:${sort}`;
    triggerSettlementCycleNonBlocking(reason);
  }

  // Build the where clause - use Prisma's AND/OR operators
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const whereConditions: any[] = [];

  if (sort === "trending") {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    whereConditions.push({ createdAt: { gte: sevenDaysAgo } });
  }

  // If following filter is true, only show posts from followed users (NOT including user's own posts)
  if (following && !user) {
    return c.json(
      { error: { message: "Unauthorized", code: "UNAUTHORIZED" } },
      401
    );
  }

  let followedIds: string[] = [];
  if (following && user) {
    try {
      const followedUsers = await withFeedTimeout(
        prisma.follow.findMany({
          where: { followerId: user.id },
          select: { followingId: true },
        }),
        "following_lookup"
      );
      followedIds = followedUsers.map((f) => f.followingId);
    } catch (error) {
      if (
        !isPrismaSchemaDriftError(error) &&
        !isPrismaClientError(error) &&
        !isFeedTimeoutError(error)
      ) {
        throw error;
      }
      console.warn("[posts/feed] follow query unavailable; using feed cache fallback", {
        message: error instanceof Error ? error.message : String(error),
      });
      if (isFeedCircuitBreakerError(error)) {
        feedDegradedMode = true;
        openFeedDegradedCircuit("following_lookup", error);
      }
      return await respondWithFeedCacheFallback(error);
    }

    if (followedIds.length === 0) {
      return c.json({
        data: [],
        hasMore: false,
        nextCursor: null,
      });
    }

    // Only show posts from users the current user follows (excluding own posts)
    whereConditions.push({ authorId: { in: followedIds } });
  }

  // Add search conditions if search query provided.
  // PostgreSQL can handle case-insensitive matching directly, which keeps the
  // feed search query smaller and lets CA/ticker/name lookups stay responsive.
  if (search && search.trim().length > 0) {
    const searchTerm = search.trim();
    whereConditions.push({
      OR: [
        { contractAddress: { contains: searchTerm, mode: "insensitive" } },
        { tokenName: { contains: searchTerm, mode: "insensitive" } },
        { tokenSymbol: { contains: searchTerm, mode: "insensitive" } },
        { content: { contains: searchTerm, mode: "insensitive" } },
        { author: { username: { contains: searchTerm, mode: "insensitive" } } },
        { author: { name: { contains: searchTerm, mode: "insensitive" } } },
      ],
    });
  }

  // Build final where clause
  const whereClause = whereConditions.length > 0
    ? { AND: whereConditions }
    : {};

  // Cursor pagination uses recency keyset pagination (createdAt + id).
  // For trending, each page is then ranked by the existing app-layer trending sort.
  const cursorPaginationEnabled = true;

  const feedFindManyBase = {
    where: whereClause,
    orderBy: [
      { createdAt: "desc" as const },
      { id: "desc" as const },
    ],
    take: cursorPaginationEnabled ? limit + 1 : limit,
    ...(cursorPaginationEnabled && cursor
      ? {
          cursor: { id: cursor },
          skip: 1,
        }
      : {}),
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let fetchedPosts: any[] = [];
  if (feedDegradedMode) {
    try {
      fetchedPosts = await loadDegradedFeedPosts(
        feedFindManyBase as Record<string, unknown>
      );
    } catch (error) {
      if (isPrismaClientError(error) || isFeedTimeoutError(error)) {
        logFeedQueryFailure("degraded_snapshot_posts_query", error, {
          sort,
          following,
          cursor: cursor ?? null,
          search: search ?? null,
          userId: user?.id ?? null,
          isPoolPressure:
            isFeedTimeoutError(error) || isPrismaPoolPressureError(error),
        });
        return await respondWithFeedCacheFallback(error);
      }
      throw error;
    }
  } else {
    try {
      fetchedPosts = await loadPrimaryFeedPosts(
        feedFindManyBase as Record<string, unknown>
      );
      clearFeedDegradedCircuit();
    } catch (error) {
      if (!isPrismaClientError(error) && !isFeedTimeoutError(error)) {
        throw error;
      }

      logFeedQueryFailure("primary_posts_query", error, {
        sort,
        following,
        cursor: cursor ?? null,
        search: search ?? null,
        userId: user?.id ?? null,
        isPoolPressure:
          isFeedTimeoutError(error) || isPrismaPoolPressureError(error),
      });

      if (!isFeedCircuitBreakerError(error)) {
        return await respondWithFeedCacheFallback(error);
      }

      feedDegradedMode = true;
      openFeedDegradedCircuit("primary_posts_query", error);

      const stalePayload = !cursor ? await readStaleFeedPayload() : null;
      if (stalePayload) {
        return c.json(stalePayload);
      }

      try {
        fetchedPosts = await loadDegradedFeedPosts(
          feedFindManyBase as Record<string, unknown>
        );
      } catch (degradedError) {
        if (isPrismaClientError(degradedError) || isFeedTimeoutError(degradedError)) {
          logFeedQueryFailure("degraded_snapshot_posts_query", degradedError, {
            sort,
            following,
            cursor: cursor ?? null,
            search: search ?? null,
            userId: user?.id ?? null,
            isPoolPressure:
              isFeedTimeoutError(degradedError) ||
              isPrismaPoolPressureError(degradedError),
          });
          return await respondWithFeedCacheFallback(degradedError);
        }
        throw degradedError;
      }
    }
  }

  let hasMore = false;
  let nextCursor: string | null = null;
  const posts = (() => {
    if (!cursorPaginationEnabled) {
      return fetchedPosts;
    }

    hasMore = fetchedPosts.length > limit;
    const pagePosts = hasMore ? fetchedPosts.slice(0, limit) : fetchedPosts;
    nextCursor = hasMore ? pagePosts[pagePosts.length - 1]?.id ?? null : null;
    return pagePosts;
  })();

  if (!feedDegradedMode) {
    triggerMaintenanceForStaleCandidates(
      `feed:${sort}:${following ? "following" : "all"}`,
      posts
    );
  }

  // Get user's likes and reposts for these posts
  let userLikes: Set<string> = new Set();
  let userReposts: Set<string> = new Set();
  let userFollowing: Set<string> = new Set();

  if (!feedDegradedMode && user && posts.length > 0) {
    const postIds = posts.map((p) => p.id);
    const authorIds = [...new Set(posts.map((p) => p.authorId))];

    try {
      const likes = await withFeedTimeout(
        prisma.like.findMany({
          where: {
            userId: user.id,
            postId: { in: postIds },
          },
          select: { postId: true },
        }),
        "social_likes_query",
        FEED_SOCIAL_QUERY_TIMEOUT_MS
      );
      const reposts = await withFeedTimeout(
        prisma.repost.findMany({
          where: {
            userId: user.id,
            postId: { in: postIds },
          },
          select: { postId: true },
        }),
        "social_reposts_query",
        FEED_SOCIAL_QUERY_TIMEOUT_MS
      );
      const follows = await withFeedTimeout(
        prisma.follow.findMany({
          where: {
            followerId: user.id,
            followingId: { in: authorIds },
          },
          select: { followingId: true },
        }),
        "social_follows_query",
        FEED_SOCIAL_QUERY_TIMEOUT_MS
      );

      userLikes = new Set(likes.map((l) => l.postId));
      userReposts = new Set(reposts.map((r) => r.postId));
      userFollowing = new Set(follows.map((f) => f.followingId));
    } catch (error) {
      if (
        !isPrismaSchemaDriftError(error) &&
        !isPrismaClientError(error) &&
        !isFeedTimeoutError(error)
      ) {
        throw error;
      }
      console.warn("[posts/feed] social relation lookup unavailable; continuing without personalized flags", {
        message: error instanceof Error ? error.message : String(error),
      });
      if (isFeedCircuitBreakerError(error)) {
        feedDegradedMode = true;
        openFeedDegradedCircuit("social_flags_query", error);
      }
    }
  }

  // Map posts with social data
  let postsWithSocial = posts.map((post) => ({
    ...post,
    isLiked: userLikes.has(post.id),
    isReposted: userReposts.has(post.id),
    isFollowingAuthor: userFollowing.has(post.authorId),
  }));

  // Apply trending sort if requested
  // Priority: 1) Winners first (isWin), 2) Highest percentage gain, 3) Engagement, 4) Recency
  if (sort === "trending") {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    postsWithSocial = postsWithSocial
      .filter((post) => new Date(post.createdAt) >= sevenDaysAgo)
      .sort((a, b) => {
        // Helper to get the best percent change (use percentChange1h, percentChange6h, or calculate from mcap)
        const getPercentGain = (post: typeof a) => {
          // Prefer stored percentChange values if available
          if (post.percentChange6h !== null) return post.percentChange6h;
          if (post.percentChange1h !== null) return post.percentChange1h;
          // Fall back to calculating from current mcap
          if (!post.entryMcap || !post.currentMcap) return -Infinity;
          return ((post.currentMcap - post.entryMcap) / post.entryMcap) * 100;
        };

        // Helper to calculate engagement score
        const getEngagement = (post: typeof a) => {
          return (post._count.likes || 0) + (post._count.comments || 0) + (post._count.reposts || 0);
        };

        const gainA = getPercentGain(a);
        const gainB = getPercentGain(b);
        const aHasHighLiveMomentum = !a.settled && gainA >= TRENDING_LIVE_GAIN_PRIORITY_PCT;
        const bHasHighLiveMomentum = !b.settled && gainB >= TRENDING_LIVE_GAIN_PRIORITY_PCT;

        // 1. Primary: Big live runners should surface with settled winners.
        if (aHasHighLiveMomentum !== bHasHighLiveMomentum) {
          return bHasHighLiveMomentum ? 1 : -1;
        }

        // 2. Positive performers / winners first (includes unsettled gains)
        const aIsWin = !!(a.isWin || a.isWin1h || a.isWin6h || gainA > 0);
        const bIsWin = !!(b.isWin || b.isWin1h || b.isWin6h || gainB > 0);
        if (aIsWin !== bIsWin) {
          return bIsWin ? 1 : -1; // Winners (true) come first
        }

        // 3. Secondary: Sort by percentage gain (highest first)
        if (gainA !== gainB) {
          return gainB - gainA;
        }

        // 4. Tertiary: Sort by engagement (likes + comments + reposts)
        const engagementA = getEngagement(a);
        const engagementB = getEngagement(b);
        if (engagementA !== engagementB) {
          return engagementB - engagementA;
        }

        // 5. Final tiebreaker: Most recent first
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      });
  }

  // Update current mcap based on tracking mode (lazy update pattern)
  // - Active mode (< 1 hour old): Update if lastMcapUpdate > 30 seconds ago
  // - Settled mode (>= 1 hour old): Update if lastMcapUpdate > 5 minutes ago
  const fortyEightHoursAgo = new Date(Date.now() - 48 * 60 * 60 * 1000);
  const contractAddresses = [...new Set(
    postsWithSocial
      .map((post) => post.contractAddress)
      .filter((address): address is string => typeof address === "string" && address.length > 0)
  )];

  const sharedAlphaAuthorsByContract = new Map<string, Set<string>>();
  if (!feedDegradedMode && contractAddresses.length > 0) {
    const nowMs = Date.now();
    const missingContracts: string[] = [];

    for (const contractAddress of contractAddresses) {
      const cached = sharedAlphaAuthorCache.get(contractAddress);
      if (cached && cached.expiresAtMs > nowMs) {
        sharedAlphaAuthorsByContract.set(contractAddress, cached.authorIds);
      } else {
        if (cached) sharedAlphaAuthorCache.delete(contractAddress);
        missingContracts.push(contractAddress);
      }
    }

    if (missingContracts.length > 0) {
      let sharedAlphaCandidates: Array<{ contractAddress: string | null; authorId: string }> = [];
      if (FEED_ENABLE_LIVE_SHARED_ALPHA) {
        try {
          sharedAlphaCandidates = await withFeedTimeout(
            prisma.post.findMany({
              where: {
                contractAddress: { in: missingContracts },
                createdAt: { gte: fortyEightHoursAgo },
              },
              select: {
                contractAddress: true,
                authorId: true,
              },
            }),
            "shared_alpha_query",
            FEED_SOCIAL_QUERY_TIMEOUT_MS
          );
        } catch (error) {
          if (
            !isPrismaSchemaDriftError(error) &&
            !isPrismaClientError(error) &&
            !isFeedTimeoutError(error)
          ) {
            throw error;
          }
          console.warn("[posts/feed] shared alpha enrichment unavailable; continuing without sharedAlphaCount", {
            message: error instanceof Error ? error.message : String(error),
          });
          if (isFeedCircuitBreakerError(error)) {
            feedDegradedMode = true;
            openFeedDegradedCircuit("shared_alpha_query", error);
          }
        }
      } else {
        queueSharedAlphaAuthorWarmup(missingContracts, fortyEightHoursAgo);
      }

      const fetchedAuthorsByContract = new Map<string, Set<string>>();
      for (const contractAddress of missingContracts) {
        fetchedAuthorsByContract.set(contractAddress, new Set<string>());
      }

      for (const candidate of sharedAlphaCandidates) {
        if (!candidate.contractAddress) continue;
        const authorSet = fetchedAuthorsByContract.get(candidate.contractAddress);
        if (authorSet) {
          authorSet.add(candidate.authorId);
        }
      }

      for (const [contractAddress, authorIds] of fetchedAuthorsByContract) {
        sharedAlphaAuthorCache.set(contractAddress, {
          authorIds,
          expiresAtMs: nowMs + SHARED_ALPHA_CACHE_TTL_MS,
        });
        sharedAlphaAuthorsByContract.set(contractAddress, authorIds);
      }
    }
  }

  // Feed is intentionally read-only for market data/settlement updates.
  // Maintenance work is handled by a cron endpoint to keep request latency stable.
  const postsWithUpdatedMcap = postsWithSocial.map((post) => {
    const existingSharedAlphaCount =
      typeof (post as { sharedAlphaCount?: unknown }).sharedAlphaCount === "number"
        ? Number((post as { sharedAlphaCount?: unknown }).sharedAlphaCount)
        : 0;
    const postWithSharedAlpha = { ...post, sharedAlphaCount: existingSharedAlphaCount };

    if (post.contractAddress) {
      const authorIds = sharedAlphaAuthorsByContract.get(post.contractAddress);
      if (authorIds) {
        postWithSharedAlpha.sharedAlphaCount = Math.max(
          0,
          authorIds.size - (authorIds.has(post.authorId) ? 1 : 0)
        );
      }
    }

    return postWithSharedAlpha;
  });

  const responsePosts = postsWithUpdatedMcap;
  const totalPostsHint = !cursor ? await readTotalPostCountHint() : null;
  const responsePayload: FeedResponsePayload = {
    data: responsePosts,
    hasMore,
    nextCursor,
    totalPosts: totalPostsHint,
  };
  writeFeedResponseToCache(feedResponseCache, feedCacheKey, responsePayload);
  if (!following) {
    const sharedPayload = createSharedFeedPayload(responsePayload);
    writeFeedResponseToCache(feedSharedResponseCache, sharedFeedCacheKey, sharedPayload);
    void cacheSetJson(
      buildFeedSharedRedisKey(sharedFeedCacheKey),
      sharedPayload,
      FEED_RESPONSE_STALE_FALLBACK_MS
    );
  }
  return c.json(responsePayload);
  } finally {
    feedRequestLease.release();
  }
});

// Protected cron/maintenance runner for settlement + market refresh.
// Vercel Cron can call this with Authorization: Bearer <CRON_SECRET>.
postsRouter.get("/maintenance/run", async (c) => {
  const cronSecret = process.env.CRON_SECRET?.trim();
  if (!cronSecret) {
    return c.json({
      error: {
        message: "CRON_SECRET is not configured",
        code: "CRON_NOT_CONFIGURED",
      },
    }, 503);
  }

  if (!isAuthorizedMaintenanceRequest(c)) {
    return c.json({
      error: {
        message: "Unauthorized",
        code: "UNAUTHORIZED",
      },
    }, 401);
  }

  const maintenanceRequestLease = maintenanceRequestLimiter.tryAcquire();
  if (!maintenanceRequestLease) {
    console.warn("[Maintenance] Request concurrency cap reached", {
      inFlight: maintenanceRequestLimiter.current(),
      limit: maintenanceRequestLimiter.limit,
    });
    return c.json({
      data: {
        skipped: true,
        reason: "concurrency_cap",
        inFlight: maintenanceRequestLimiter.current(),
        limit: maintenanceRequestLimiter.limit,
      },
    }, 202);
  }

  try {
    const now = Date.now();
    if (maintenanceRunInFlight) {
      return c.json({
        data: {
          skipped: true,
          reason: "already_running",
          inFlight: maintenanceRequestLimiter.current(),
          limit: maintenanceRequestLimiter.limit,
        },
      }, 202);
    }

    const cooldownRemainingMs = Math.max(
      0,
      MAINTENANCE_RUN_MIN_INTERVAL_MS - (now - lastMaintenanceRunStartedAt)
    );

    if (cooldownRemainingMs > 0) {
      return c.json({
        data: {
          skipped: true,
          reason: "cooldown",
          retryAfterMs: cooldownRemainingMs,
        },
      }, 202);
    }

    lastMaintenanceRunStartedAt = now;
    maintenanceRunInFlight = runMaintenanceCycle({ prewarmSnapshots: true })
      .catch((error) => {
        console.error("[Maintenance] Run failed:", error);
        throw error;
      })
      .finally(() => {
        maintenanceRunInFlight = null;
      });

    try {
      const result = await maintenanceRunInFlight;
      lastCronMaintenanceCompletedAt = Date.now();
      return c.json({ data: result });
    } catch {
      return c.json({
        error: {
          message: "Maintenance run failed",
          code: "INTERNAL_ERROR",
        },
      }, 500);
    }
  } finally {
    maintenanceRequestLease.release();
  }
});

// Create a new post
postsRouter.post("/", requireNotBanned, zValidator("json", CreatePostSchema), async (c) => {
  const user = c.get("user");
  const session = c.get("session");
  if (!user) {
    return c.json({ error: { message: "Unauthorized", code: "UNAUTHORIZED" } }, 401);
  }

  const sessionUser = session?.user ?? null;
  const authorSnapshot = await resolveCreatePostUserSnapshot({
    userId: user.id,
    sessionUser,
  });
  if (!authorSnapshot || authorSnapshot.level <= LIQUIDATION_LEVEL) {
    return c.json({
      error: {
        message: "You are at level -5 (liquidation). You cannot post new alphas until your level improves.",
        code: "LIQUIDATED"
      }
    }, 403);
  }

  const { postCountLastHour, oldestPostLastHourAt, postCountLast24h, oldestPostLast24hAt } =
    await getCreatePostRateLimitSnapshot(user.id);

  if (postCountLastHour >= HOURLY_POST_LIMIT) {
    const resetTime = oldestPostLastHourAt
      ? new Date(oldestPostLastHourAt.getTime() + 60 * 60 * 1000)
      : new Date(Date.now() + 60 * 60 * 1000);
    const resetInMinutes = Math.max(1, Math.ceil((resetTime.getTime() - Date.now()) / (60 * 1000)));

    return c.json({
      error: {
        message: `Hourly limit reached. ${postCountLastHour}/${HOURLY_POST_LIMIT} posts used. Reset in ${resetInMinutes} minute${resetInMinutes !== 1 ? "s" : ""}.`,
        code: "RATE_LIMIT_EXCEEDED",
        data: {
          window: "1h",
          used: postCountLastHour,
          limit: HOURLY_POST_LIMIT,
          resetInMinutes,
        },
      },
    }, 429);
  }

  if (postCountLast24h >= DAILY_POST_LIMIT) {
    const resetTime = oldestPostLast24hAt
      ? new Date(oldestPostLast24hAt.getTime() + 24 * 60 * 60 * 1000)
      : new Date(Date.now() + 60 * 60 * 1000);
    const hoursUntilReset = Math.ceil((resetTime.getTime() - Date.now()) / (60 * 60 * 1000));

    return c.json({
      error: {
        message: `Daily limit reached. ${postCountLast24h}/${DAILY_POST_LIMIT} posts used. Reset in ${hoursUntilReset} hour${hoursUntilReset !== 1 ? 's' : ''}.`,
        code: "RATE_LIMIT_EXCEEDED",
        data: {
          used: postCountLast24h,
          limit: DAILY_POST_LIMIT,
          resetInHours: hoursUntilReset,
        }
      }
    }, 429);
  }

  const { content } = c.req.valid("json");

  // Detect contract address - REQUIRED for posting
  const detected = detectContractAddress(content);

  if (!detected) {
    return c.json({
      error: {
        message: "A valid Contract Address is required to post",
        code: "CA_REQUIRED"
      }
    }, 400);
  }

  const alphaCreatedAt = new Date();
  const existingAlphaInBucket = await findEarliestAlphaInBucket({
    authorId: user.id,
    contractAddress: detected.address,
    createdAt: alphaCreatedAt,
  });
  if (existingAlphaInBucket) {
    const bucketStart = getAlphaScoreBucketStart(alphaCreatedAt);
    const resetAt = new Date(bucketStart.getTime() + ALPHA_SCORE_WINDOW_MS);
    const resetInMinutes = Math.max(
      1,
      Math.ceil((resetAt.getTime() - Date.now()) / (60 * 1000))
    );
    return c.json(
      {
        error: {
          message:
            "You already posted this contract in the current scoring window. Wait before posting it again.",
          code: "ALPHA_COOLDOWN_ACTIVE",
          data: {
            contractAddress: detected.address,
            resetAt: resetAt.toISOString(),
            resetInMinutes,
          },
        },
      },
      429
    );
  }

  const { marketCapResult, heliusTokenMetadata } = await resolveCreatePostMarketContext({
    address: detected.address,
    chainType: detected.chainType,
  });
  const entryMcap = marketCapResult.mcap;

  const createPostData = {
    content,
    authorId: user.id,
    contractAddress: detected.address,
    chainType: detected.chainType,
    entryMcap,
    currentMcap: entryMcap,
    // Store token metadata (Helius-first for names/symbol, Dex-first for image)
    tokenName: heliusTokenMetadata?.tokenName ?? marketCapResult.tokenName ?? null,
    tokenSymbol: heliusTokenMetadata?.tokenSymbol ?? marketCapResult.tokenSymbol ?? null,
    tokenImage: marketCapResult.tokenImage ?? heliusTokenMetadata?.tokenImage ?? null,
    dexscreenerUrl: marketCapResult.dexscreenerUrl ?? null,
    trackingMode: TRACKING_MODE_ACTIVE, // New posts start in active tracking mode
    lastMcapUpdate: new Date(),
  };

  let post: ReturnType<typeof buildCreatePostResponse>;

  try {
    post = await prisma.post.create({
      data: createPostData,
      include: {
        author: {
          select: {
            id: true,
            name: true,
            username: true,
            image: true,
            level: true,
            xp: true,
            isVerified: true,
          },
        },
        _count: {
          select: {
            likes: true,
            comments: true,
            reposts: true,
          },
        },
      },
    });
  } catch (error) {
    if (!isPrismaSchemaDriftError(error) && !isPrismaClientError(error)) {
      throw error;
    }

    console.warn("[posts/create] prisma create fallback triggered", {
      message: getErrorMessage(error),
    });
    post = await createPostRawFallback({
      content: createPostData.content,
      authorId: createPostData.authorId,
      contractAddress: createPostData.contractAddress,
      chainType: createPostData.chainType,
      entryMcap: createPostData.entryMcap,
      currentMcap: createPostData.currentMcap,
      author: authorSnapshot,
      tokenName: marketCapResult.tokenName ?? heliusTokenMetadata?.tokenName ?? null,
      tokenSymbol: marketCapResult.tokenSymbol ?? heliusTokenMetadata?.tokenSymbol ?? null,
      tokenImage: marketCapResult.tokenImage ?? heliusTokenMetadata?.tokenImage ?? null,
      dexscreenerUrl: marketCapResult.dexscreenerUrl ?? null,
    });
  }

  triggerNewPostFollowerFanout({
    authorId: user.id,
    authorName: authorSnapshot.name,
    authorUsername: authorSnapshot.username,
    postId: post.id,
  });

  const enrichedCall = await getEnrichedCallById(post.id, user.id).catch(() => null);
  if (enrichedCall) {
    await fanoutPostedAlphaAlert({
      postId: enrichedCall.id,
      authorId: user.id,
      authorLabel: authorSnapshot.username ? `@${authorSnapshot.username}` : authorSnapshot.name,
      tokenId: enrichedCall.tokenId,
      tokenSymbol: enrichedCall.tokenSymbol,
      confidenceScore: enrichedCall.confidenceScore,
      liquidity: enrichedCall.liquidity,
      bundleRiskScore: enrichedCall.tokenRiskScore,
    }).catch(() => undefined);
  }

  invalidatePostReadCaches({ leaderboard: true });

  return c.json({
    data: {
      ...post,
      isLiked: false,
      isReposted: false,
    }
  });
});

// Settle posts (called periodically or on-demand)
// Handles 1H settlement (official XP calculation) and 6H snapshot + settlement (for ALL posts)
postsRouter.post("/settle", async (c) => {
  const cronSecret = process.env.CRON_SECRET?.trim();
  if (!cronSecret) {
    return c.json({
      error: {
        message: "CRON_SECRET is not configured",
        code: "CRON_NOT_CONFIGURED",
      },
    }, 503);
  }

  if (!isAuthorizedMaintenanceRequest(c)) {
    return c.json({
      error: {
        message: "Unauthorized",
        code: "UNAUTHORIZED",
      },
    }, 401);
  }

  const settlementRequestLease = settlementRequestLimiter.tryAcquire();
  if (!settlementRequestLease) {
    console.warn("[Settlement] Request concurrency cap reached", {
      inFlight: settlementRequestLimiter.current(),
      limit: settlementRequestLimiter.limit,
    });
    return c.json({
      data: {
        skipped: true,
        reason: "concurrency_cap",
        inFlight: settlementRequestLimiter.current(),
        limit: settlementRequestLimiter.limit,
      },
    }, 202);
  }

  try {
    return await withSettlementRunLock(
      "manual_settlement_endpoint",
      () =>
        c.json({
          data: {
            settled1h: 0,
            snapshot6h: 0,
            levelChanges6h: 0,
            results1h: [],
            results6h: [],
            skipped: true,
            reason: "database_lock_held",
          },
        }, 202),
      async () => {
        const now = Date.now();
        const oneHourAgo = new Date(now - SETTLEMENT_1H_MS);
        const sixHoursAgo = new Date(now - SETTLEMENT_6H_MS);

        const results1h: Array<{
          postId: string;
          userId: string;
          isWin: boolean;
          percentChange: number;
          oldLevel: number;
          newLevel: number;
          oldXp: number;
          newXp: number;
          xpChange: number;
          entryMcap: number;
          finalMcap: number;
          recoveryEligible: boolean;
        }> = [];

        const results6h: Array<{
          postId: string;
          userId: string;
          isWin6h: boolean;
          percentChange6h: number;
          mcap6h: number;
          oldLevel: number;
          newLevel: number;
          xpChange: number;
          levelChange6h: number;
          recoveryEligible: boolean;
          hadLevelChange: boolean;
        }> = [];

  // ============================================
  // 1H SETTLEMENT
  // ============================================
  const postsToSettle1h = await findPostsToSettle1h(oneHourAgo);

  for (const post of postsToSettle1h) {
    if (!post.contractAddress || post.entryMcap === null) continue;

    const fetchedMcap = await fetchMarketCap(post.contractAddress, post.chainType);
    const mcap1h = fetchedMcap ?? post.currentMcap;
    if (mcap1h === null || mcap1h <= 0) continue;

    const percentChange1h = ((mcap1h - post.entryMcap) / post.entryMcap) * 100;
    const isWin1h = mcap1h > post.entryMcap;

    // Use the new 1H settlement logic
    const { levelChange, recoveryEligible } = calculate1HSettlement(percentChange1h);
    const xpChange = calculateXpChange(percentChange1h);
    const currentUser = await prisma.user.findUnique({
      where: { id: post.authorId },
      select: { id: true, level: true, xp: true },
    });
    if (!currentUser) continue;
    const scoreEligible = await isPrimaryAlphaInBucket({
      postId: post.id,
      authorId: post.authorId,
      contractAddress: post.contractAddress,
      createdAt: post.createdAt,
    });
    const effectiveLevelChange = scoreEligible ? levelChange : 0;
    const effectiveXpChange = scoreEligible ? xpChange : 0;
    const effectiveRecoveryEligible = scoreEligible ? recoveryEligible : false;
    const newLevel = calculateFinalLevel(currentUser.level, effectiveLevelChange);
    const newXp = Math.max(0, currentUser.xp + effectiveXpChange);
    const settledAt = new Date();

    try {
      await prisma.$transaction([
        prisma.post.updateMany({
          where: { id: post.id },
          data: {
            settled: true,
            settledAt,
            isWin: isWin1h,
            isWin1h: isWin1h,
            currentMcap: mcap1h,
            mcap1h: mcap1h,
            percentChange1h: percentChange1h,
            recoveryEligible: effectiveRecoveryEligible,
            levelChange1h: effectiveLevelChange,
            trackingMode: TRACKING_MODE_SETTLED,
            lastMcapUpdate: settledAt,
          },
        }),
        prisma.user.updateMany({
          where: { id: post.authorId },
          data: {
            level: newLevel,
            xp: newXp,
          },
        }),
      ]);
    } catch (error) {
      if (!isPrismaSchemaDriftError(error)) {
        throw error;
      }

      await prisma.$transaction([
        prisma.post.updateMany({
          where: { id: post.id },
          data: {
            settled: true,
            settledAt,
            isWin: isWin1h,
            currentMcap: mcap1h,
          },
        }),
        prisma.user.updateMany({
          where: { id: post.authorId },
          data: {
            level: newLevel,
            xp: newXp,
          },
        }),
      ]);
    }

    if (scoreEligible) {
      await notifyFollowersOfBigGain({
        postId: post.id,
        authorId: post.authorId,
        authorName: post.author.name,
        authorUsername: post.author.username,
        percentChange1h,
      });
    }

    results1h.push({
      postId: post.id,
      userId: post.authorId,
      isWin: isWin1h,
      percentChange: Math.round(percentChange1h * 100) / 100,
      oldLevel: currentUser.level,
      newLevel,
      oldXp: currentUser.xp,
      newXp,
      xpChange: effectiveXpChange,
      entryMcap: post.entryMcap,
      finalMcap: mcap1h,
      recoveryEligible: effectiveRecoveryEligible,
    });
  }

  // ============================================
  // 6H MARKET CAP SNAPSHOT - For ALL posts >= 6 hours old
  // This captures the 6H mcap for every post, regardless of level changes
  // ============================================
  const postsToSnapshot6h = await findPostsToSnapshot6h(sixHoursAgo);

  console.log(`[Settle API] Processing 6H snapshot for ${postsToSnapshot6h.length} posts`);

  for (const post of postsToSnapshot6h) {
    if (!post.contractAddress || post.entryMcap === null) continue;

    const fetchedMcap = await fetchMarketCap(post.contractAddress, post.chainType);
    const mcap6h = fetchedMcap ?? post.currentMcap ?? post.mcap1h;
    if (mcap6h === null || mcap6h <= 0) continue;

    const percentChange6h = ((mcap6h - post.entryMcap) / post.entryMcap) * 100;
    const isWin6h = percentChange6h > 0;

    // Use the new 6H settlement logic to check for level changes
    const isWin1h = post.isWin1h ?? post.isWin ?? false;
    const recoveryEligible = post.recoveryEligible ?? false;
    const levelChange6h = calculate6HSettlement(isWin1h, percentChange6h, recoveryEligible);
    let xpChange = calculate6HXpChange(percentChange6h, levelChange6h);
    const scoreEligible = await isPrimaryAlphaInBucket({
      postId: post.id,
      authorId: post.authorId,
      contractAddress: post.contractAddress,
      createdAt: post.createdAt,
    });
    const effectiveLevelChange6h = scoreEligible ? levelChange6h : 0;
    xpChange = scoreEligible ? xpChange : 0;
    const currentUser = await prisma.user.findUnique({
      where: { id: post.authorId },
      select: { level: true, xp: true },
    });
    if (!currentUser) continue;

    let oldLevel = currentUser.level;
    let newLevel = oldLevel;

    const snapshotUpdatedAt = new Date();
    if (effectiveLevelChange6h !== 0 || xpChange !== 0) {
      oldLevel = currentUser.level;
      newLevel = calculateFinalLevel(currentUser.level, effectiveLevelChange6h);
      const newXp = Math.max(0, currentUser.xp + xpChange);

      try {
        await prisma.$transaction([
          prisma.post.updateMany({
            where: { id: post.id },
            data: {
              mcap6h: mcap6h,
              currentMcap: mcap6h,
              isWin6h: isWin6h,
              percentChange6h: percentChange6h,
              settled6h: true,
              levelChange6h: effectiveLevelChange6h,
              lastMcapUpdate: snapshotUpdatedAt,
            },
          }),
          prisma.user.updateMany({
            where: { id: post.authorId },
            data: {
              level: newLevel,
              xp: newXp,
            },
          }),
        ]);
      } catch (error) {
        if (!isPrismaSchemaDriftError(error)) {
          throw error;
        }

        await prisma.$transaction([
          prisma.post.updateMany({
            where: { id: post.id },
            data: {
              currentMcap: mcap6h,
            },
          }),
          prisma.user.updateMany({
            where: { id: post.authorId },
            data: {
              level: newLevel,
              xp: newXp,
            },
          }),
        ]);
      }
    } else {
      // ALWAYS update post with 6H snapshot data (for ALL posts)
      try {
        await prisma.post.updateMany({
          where: { id: post.id },
          data: {
            mcap6h: mcap6h,
            currentMcap: mcap6h,
            isWin6h: isWin6h,
            percentChange6h: percentChange6h,
            settled6h: true,
            levelChange6h: effectiveLevelChange6h,
            lastMcapUpdate: snapshotUpdatedAt,
          },
        });
      } catch (error) {
        if (!isPrismaSchemaDriftError(error)) {
          throw error;
        }
        await prisma.post.updateMany({
          where: { id: post.id },
          data: {
            currentMcap: mcap6h,
          },
        });
      }
    }

    results6h.push({
      postId: post.id,
      userId: post.authorId,
      isWin6h: isWin6h,
      percentChange6h: Math.round(percentChange6h * 100) / 100,
      mcap6h: mcap6h,
      oldLevel,
      newLevel,
      xpChange,
      levelChange6h: effectiveLevelChange6h,
      recoveryEligible,
      hadLevelChange: effectiveLevelChange6h !== 0,
    });
  }

        if (results1h.length > 0 || results6h.length > 0) {
          invalidatePostReadCaches({ leaderboard: true });
        }

        return c.json({
          data: {
            settled1h: results1h.length,
            snapshot6h: results6h.length,
            levelChanges6h: results6h.filter(r => r.hadLevelChange).length,
            results1h,
            results6h,
          }
        });
      }
    );
  } finally {
    settlementRequestLease.release();
  }
});

// Get trending tokens (contract addresses with 50+ unique callers in last 48 hours)
// For testing, we use a lower threshold (2+) since we may not have enough data
// Sorted by: 1) Tokens with positive avg gain first, 2) avgGain DESC, 3) callCount DESC
postsRouter.get("/trending", async (c) => {
  const now = Date.now();
  if (trendingCache && trendingCache.expiresAtMs > now) {
    return c.json({ data: trendingCache.data });
  }
  if (trendingInFlight) {
    try {
      const data = await trendingInFlight;
      return c.json({ data });
    } catch (error) {
      console.warn("[posts/trending] using stale-or-empty fallback", {
        message: getErrorMessage(error),
      });
      return c.json({ data: trendingCache?.data ?? [] });
    }
  }

  trendingInFlight = (async () => {
  const fortyEightHoursAgo = new Date(Date.now() - 48 * 60 * 60 * 1000);

  // Query posts with contract addresses from last 48 hours
  // Include percent change data for calculating average gain
  let recentPosts: any[];
  try {
    recentPosts = await withPrismaRetry(
      () => prisma.post.findMany({
        where: {
          contractAddress: { not: null },
          createdAt: { gte: fortyEightHoursAgo },
        },
        select: {
          id: true,
          contractAddress: true,
          chainType: true,
          tokenName: true,
          tokenSymbol: true,
          entryMcap: true,
          currentMcap: true,
          percentChange1h: true,
          percentChange6h: true,
          isWin: true,
          isWin1h: true,
          isWin6h: true,
          authorId: true,
          createdAt: true,
          author: {
            select: {
              id: true,
              name: true,
              username: true,
              image: true,
              level: true,
              xp: true,
              isVerified: true,
            },
          },
        },
        orderBy: { createdAt: "asc" },
      }),
      { label: "posts:trending" }
    );
  } catch (error) {
    if (isPrismaSchemaDriftError(error) || isPrismaClientError(error)) {
      console.warn("[posts/trending] query failed, using raw SQL fallback", {
        message: getErrorMessage(error),
      });
      try {
        // Use SELECT p.* so this works regardless of which columns exist
        const rawRows = await prisma.$queryRaw<Array<Record<string, unknown>>>(Prisma.sql`
          SELECT
            p.*,
            u.id AS "authorUserId",
            u.name AS "authorName",
            u.username AS "authorUsername",
            u.image AS "authorImage",
            u.level AS "authorLevel",
            u.xp AS "authorXp",
            u."isVerified" AS "authorIsVerified"
          FROM "Post" p
          JOIN "User" u ON u.id = p."authorId"
          WHERE p."contractAddress" IS NOT NULL
            AND p."createdAt" >= ${fortyEightHoursAgo}
          ORDER BY p."createdAt" ASC
          LIMIT 500
        `);
        recentPosts = rawRows.map((r: Record<string, unknown>) => ({
          id: r.id,
          contractAddress: r.contractAddress ?? null,
          chainType: r.chainType ?? null,
          tokenName: r.tokenName ?? null,
          tokenSymbol: r.tokenSymbol ?? null,
          entryMcap: r.entryMcap ?? null,
          currentMcap: r.currentMcap ?? null,
          percentChange1h: r.percentChange1h ?? null,
          percentChange6h: r.percentChange6h ?? null,
          isWin: r.isWin ?? null,
          isWin1h: r.isWin1h ?? null,
          isWin6h: r.isWin6h ?? null,
          authorId: r.authorId,
          createdAt: r.createdAt,
          author: {
            id: r.authorUserId ?? r.authorId,
            name: typeof r.authorName === "string" ? r.authorName : null,
            username: r.authorUsername ?? null,
            image: typeof r.authorImage === "string" ? r.authorImage : null,
            level: toFiniteNumber(r.authorLevel, 0),
            xp: toFiniteNumber(r.authorXp, 0),
            isVerified: Boolean(r.authorIsVerified),
          },
        }));
      } catch (fallbackError) {
        console.warn("[posts/trending] raw SQL fallback also failed", {
          message: getErrorMessage(fallbackError),
        });
        return [];
      }
    } else {
      throw error;
    }
  }

  // Group by contract address and count unique users
  const addressMap = new Map<string, {
    contractAddress: string;
    chainType: string | null;
    tokenName: string | null;
    tokenSymbol: string | null;
    callers: Map<
      string,
      {
        id: string;
        name: string | null;
        username: string | null;
        image: string | null;
        level: number;
        xp: number;
        isVerified?: boolean;
      }
    >;
    earliestCall: Date;
    earliestPostId: string;
    mcaps: number[];
    latestMcap: number | null;
    percentGains: number[]; // Track percent gains for each call
    winCount: number; // Track number of winning calls
  }>();

  for (const post of recentPosts) {
    if (!post.contractAddress) continue;

    const addr = post.contractAddress.toLowerCase();

    if (!addressMap.has(addr)) {
      addressMap.set(addr, {
        contractAddress: post.contractAddress,
        chainType: post.chainType,
        tokenName: post.tokenName,
        tokenSymbol: post.tokenSymbol,
        callers: new Map(),
        earliestCall: post.createdAt,
        earliestPostId: post.id,
        mcaps: [],
        latestMcap: post.currentMcap,
        percentGains: [],
        winCount: 0,
      });
    }

    const token = addressMap.get(addr)!;

    // Track unique callers
    if (!token.callers.has(post.authorId)) {
      token.callers.set(post.authorId, {
        id: post.author.id,
        name: post.author.name ?? null,
        username: post.author.username,
        image: post.author.image ?? null,
        level: post.author.level,
        xp: toFiniteNumber(post.author.xp, 0),
        isVerified: Boolean(post.author.isVerified),
      });
    }

    // Update token info if we have better data
    if (post.tokenName && !token.tokenName) {
      token.tokenName = post.tokenName;
    }
    if (post.tokenSymbol && !token.tokenSymbol) {
      token.tokenSymbol = post.tokenSymbol;
    }
    if (post.entryMcap) {
      token.mcaps.push(post.entryMcap);
    }
    if (post.currentMcap) {
      token.latestMcap = post.currentMcap;
    }

    // Track percent gains for this call
    // Prefer settled values (percentChange6h > percentChange1h) or calculate from mcap
    let percentGain: number | null = null;
    if (post.percentChange6h !== null) {
      percentGain = post.percentChange6h;
    } else if (post.percentChange1h !== null) {
      percentGain = post.percentChange1h;
    } else if (post.entryMcap && post.currentMcap) {
      percentGain = ((post.currentMcap - post.entryMcap) / post.entryMcap) * 100;
    }

    if (percentGain !== null) {
      token.percentGains.push(percentGain);
    }

    // Track wins
    if (post.isWin || post.isWin1h || post.isWin6h) {
      token.winCount++;
    }
  }

  // Trending requires broad confirmation (10+ unique callers) before surfacing.
  const TRENDING_THRESHOLD = 10;

  const baseTrendingTokens = Array.from(addressMap.values())
    .filter((t) => t.callers.size >= TRENDING_THRESHOLD)
    .map((t) => {
      const callersArray = Array.from(t.callers.values());
      // Sort callers by level descending and take top 5
      const topCallers = callersArray
        .sort((a, b) => b.level - a.level)
        .slice(0, 5);

      const avgEntryMcap = t.mcaps.length > 0
        ? t.mcaps.reduce((sum, m) => sum + m, 0) / t.mcaps.length
        : null;

      // Calculate average percent gain across all calls
      const avgGain = t.percentGains.length > 0
        ? t.percentGains.reduce((sum, g) => sum + g, 0) / t.percentGains.length
        : null;

      // Calculate win rate
      const totalCalls = t.callers.size;
      const winRate = totalCalls > 0 ? (t.winCount / totalCalls) * 100 : 0;

      return {
        contractAddress: t.contractAddress,
        tokenName: t.tokenName,
        tokenSymbol: t.tokenSymbol,
        tokenImage: null, // We don't store token images yet
        chainType: t.chainType as "solana" | "evm",
        callCount: t.callers.size,
        earliestCall: t.earliestCall.toISOString(),
        firstPostId: t.earliestPostId,
        latestMcap: t.latestMcap,
        avgEntryMcap: avgEntryMcap ? Math.round(avgEntryMcap) : null,
        avgGain: avgGain !== null ? Math.round(avgGain * 100) / 100 : null, // Include avgGain in response
        winCount: t.winCount,
        winRate: Math.round(winRate * 100) / 100, // Include win rate in response
        topCallers,
      };
    })
    // Only show tokens with positive average gains.
    .filter((t) => t.avgGain !== null && t.avgGain > 0)
    // Sort by: 1) Positive avg gain first, 2) avgGain DESC, 3) callCount DESC
    .sort((a, b) => {
      // 1. Tokens with positive avgGain come first
      const aPositive = a.avgGain !== null && a.avgGain > 0;
      const bPositive = b.avgGain !== null && b.avgGain > 0;
      if (aPositive !== bPositive) {
        return bPositive ? 1 : -1;
      }

      // 2. Sort by avgGain descending (higher gains first)
      const aGain = a.avgGain ?? -Infinity;
      const bGain = b.avgGain ?? -Infinity;
      if (aGain !== bGain) {
        return bGain - aGain;
      }

      // 3. Tiebreaker: Sort by call count descending
      return b.callCount - a.callCount;
    })
    // Limit to top 10
    .slice(0, 10);

  const earliestPostIdByContract = new Map<string, string>();
  for (const token of baseTrendingTokens) {
    earliestPostIdByContract.set(token.contractAddress.toLowerCase(), token.firstPostId);
  }

  if (baseTrendingTokens.length > 0) {
    try {
      const earliestPosts = await withPrismaRetry(
        () =>
          prisma.post.findMany({
            where: {
              contractAddress: {
                in: baseTrendingTokens.map((token) => token.contractAddress),
              },
            },
            select: {
              id: true,
              contractAddress: true,
            },
            orderBy: [{ createdAt: "asc" }, { id: "asc" }],
          }),
        { label: "posts:trending-earliest-posts" }
      );

      for (const post of earliestPosts) {
        if (!post.contractAddress) continue;
        const normalizedContract = post.contractAddress.toLowerCase();
        if (!earliestPostIdByContract.has(normalizedContract)) {
          earliestPostIdByContract.set(normalizedContract, post.id);
        }
      }
    } catch (error) {
      console.warn("[posts/trending] earliest post lookup unavailable; using fallback ids", {
        message: getErrorMessage(error),
      });
    }
  }

  const trendingTokens = baseTrendingTokens.map((token) => ({
    ...token,
    firstPostId:
      earliestPostIdByContract.get(token.contractAddress.toLowerCase()) ?? token.firstPostId,
  }));

    trendingCache = {
      data: trendingTokens,
      expiresAtMs: Date.now() + TRENDING_CACHE_TTL_MS,
    };
    return trendingTokens;
  })();

  try {
    const data = await trendingInFlight;
    return c.json({ data });
  } catch (error) {
    console.warn("[posts/trending] primary query failed; returning stale-or-empty payload", {
      message: getErrorMessage(error),
    });
    if (!trendingCache) {
      trendingCache = {
        data: [],
        expiresAtMs: Date.now() + TRENDING_CACHE_TTL_MS,
      };
    }
    return c.json({ data: trendingCache.data });
  } finally {
    trendingInFlight = null;
  }
});

// Get single post
postsRouter.get("/:id", async (c) => {
  const id = c.req.param("id");
  const user = c.get("user");

  let post: any = null;
  try {
    post = await prisma.post.findUnique({
      where: { id },
      include: {
        author: {
          select: {
            id: true,
            name: true,
            username: true,
            image: true,
            level: true,
            xp: true,
            isVerified: true,
          },
        },
        _count: {
          select: {
            likes: true,
            comments: true,
            reposts: true,
          },
        },
      },
    });
  } catch (error) {
    if (!isPrismaSchemaDriftError(error) && !isPrismaClientError(error)) {
      throw error;
    }
    console.warn("[posts/detail] detail lookup unavailable", {
      postId: id,
      message: getErrorMessage(error),
    });
    const cachedPost = [...feedResponseCache.values(), ...feedSharedResponseCache.values()]
      .flatMap((entry) => entry.payload.data)
      .find((item) => {
        if (!item || typeof item !== "object" || Array.isArray(item)) return false;
        return (item as { id?: unknown }).id === id;
      });
    if (cachedPost) {
      return c.json({ data: cachedPost });
    }
    return c.json(
      { error: { message: "Post is temporarily unavailable", code: "POST_UNAVAILABLE" } },
      503
    );
  }

  if (!post) {
    return c.json({ error: { message: "Post not found", code: "NOT_FOUND" } }, 404);
  }

  // Check user interactions
  let isLiked = false;
  let isReposted = false;

  if (user) {
    const [like, repost] = await Promise.all([
      prisma.like.findUnique({
        where: { userId_postId: { userId: user.id, postId: id } },
      }),
      prisma.repost.findUnique({
        where: { userId_postId: { userId: user.id, postId: id } },
      }),
    ]);

    isLiked = !!like;
    isReposted = !!repost;
  }

  return c.json({
    data: {
      ...post,
      isLiked,
      isReposted,
    }
  });
});

// Like a post
postsRouter.post("/:id/like", requireNotBanned, async (c) => {
  const user = c.get("user");
  const postId = c.req.param("id");

  if (!user) {
    return c.json({ error: { message: "Unauthorized", code: "UNAUTHORIZED" } }, 401);
  }

  // Check if post exists
  const post = await prisma.post.findUnique({
    where: { id: postId },
    include: { author: { select: { id: true, name: true, username: true } } },
  });
  if (!post) {
    return c.json({ error: { message: "Post not found", code: "NOT_FOUND" } }, 404);
  }

  // Repeated taps or stale UI should reconcile to the final liked state instead of surfacing a DB race.
  const existingLike = await prisma.like.findUnique({
    where: { userId_postId: { userId: user.id, postId } },
  });

  let createdLike = false;
  if (!existingLike) {
    try {
      await prisma.like.create({
        data: {
          userId: user.id,
          postId,
        },
      });
      createdLike = true;
    } catch (error) {
      if (!isPrismaKnownRequestError(error, "P2002")) {
        throw error;
      }
    }
  }

  // Create notification for post author (if not liking own post)
  if (createdLike && post.authorId !== user.id) {
    // Get current user's name from database
    const dbUser = await prisma.user.findUnique({
      where: { id: user.id },
      select: { name: true },
    });
    const userName = dbUser?.name || "Someone";

    await createNotificationSafely({
      operation: "like_author_notification",
      data: {
        userId: post.authorId,
        type: "like",
        message: `${userName} liked your Alpha!`,
        dedupeKey: buildNotificationDedupeKey({
          type: "like",
          userId: post.authorId,
          fromUserId: user.id,
          postId: post.id,
        }),
        postId: post.id,
        fromUserId: user.id,
      },
      fallbackData: {
        userId: post.authorId,
        type: "like",
        message: `${userName} liked your Alpha!`,
        postId: post.id,
      },
    });
  }

  // Get updated count
  const likeCount = await prisma.like.count({ where: { postId } });

  return c.json({ data: { liked: true, likeCount } });
});

// Unlike a post
postsRouter.delete("/:id/like", requireNotBanned, async (c) => {
  const user = c.get("user");
  const postId = c.req.param("id");

  if (!user) {
    return c.json({ error: { message: "Unauthorized", code: "UNAUTHORIZED" } }, 401);
  }

  // Delete like
  try {
    await prisma.like.delete({
      where: { userId_postId: { userId: user.id, postId } },
    });
  } catch (error) {
    if (!isPrismaKnownRequestError(error, "P2025")) {
      throw error;
    }
  }

  // Get updated count
  const likeCount = await prisma.like.count({ where: { postId } });

  return c.json({ data: { liked: false, likeCount } });
});

// Repost a post
postsRouter.post("/:id/repost", requireNotBanned, async (c) => {
  const user = c.get("user");
  const postId = c.req.param("id");

  if (!user) {
    return c.json({ error: { message: "Unauthorized", code: "UNAUTHORIZED" } }, 401);
  }

  // Rate limit check: max 10 reposts per 24 hours
  const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const repostCountLast24h = await prisma.repost.count({
    where: {
      userId: user.id,
      createdAt: { gte: twentyFourHoursAgo },
    },
  });

  if (repostCountLast24h >= DAILY_REPOST_LIMIT) {
    // Calculate time until reset
    const oldestRepost = await prisma.repost.findFirst({
      where: {
        userId: user.id,
        createdAt: { gte: twentyFourHoursAgo },
      },
      orderBy: { createdAt: "asc" },
      select: { createdAt: true },
    });

    const resetTime = oldestRepost
      ? new Date(oldestRepost.createdAt.getTime() + 24 * 60 * 60 * 1000)
      : new Date(Date.now() + 60 * 60 * 1000);
    const hoursUntilReset = Math.ceil((resetTime.getTime() - Date.now()) / (60 * 60 * 1000));

    return c.json({
      error: {
        message: `Daily repost limit reached. ${repostCountLast24h}/${DAILY_REPOST_LIMIT} reposts used. Reset in ${hoursUntilReset} hour${hoursUntilReset !== 1 ? 's' : ''}.`,
        code: "RATE_LIMIT_EXCEEDED",
        data: {
          used: repostCountLast24h,
          limit: DAILY_REPOST_LIMIT,
          resetInHours: hoursUntilReset,
        }
      }
    }, 429);
  }

  // Check if post exists
  const post = await prisma.post.findUnique({
    where: { id: postId },
    include: { author: { select: { id: true, name: true, username: true } } },
  });
  if (!post) {
    return c.json({ error: { message: "Post not found", code: "NOT_FOUND" } }, 404);
  }

  // Cannot repost own post
  if (post.authorId === user.id) {
    return c.json({ error: { message: "Cannot repost own post", code: "CANNOT_REPOST_OWN" } }, 400);
  }

  // Repeated taps or stale UI should reconcile to the final reposted state instead of surfacing a DB race.
  const existingRepost = await prisma.repost.findUnique({
    where: { userId_postId: { userId: user.id, postId } },
  });

  let createdRepost = false;
  if (!existingRepost) {
    try {
      await prisma.repost.create({
        data: {
          userId: user.id,
          postId,
        },
      });
      createdRepost = true;
    } catch (error) {
      if (!isPrismaKnownRequestError(error, "P2002")) {
        throw error;
      }
    }
  }

  // Create notification for post author
  // Get current user's name from database
  if (createdRepost) {
    const dbUser = await prisma.user.findUnique({
      where: { id: user.id },
      select: { name: true },
    });
    const userName = dbUser?.name || "Someone";

    await createNotificationSafely({
      operation: "repost_author_notification",
      data: {
        userId: post.authorId,
        type: "repost",
        message: `${userName} reposted your Alpha!`,
        dedupeKey: buildNotificationDedupeKey({
          type: "repost",
          userId: post.authorId,
          fromUserId: user.id,
          postId: post.id,
        }),
        postId: post.id,
        fromUserId: user.id,
      },
      fallbackData: {
        userId: post.authorId,
        type: "repost",
        message: `${userName} reposted your Alpha!`,
        postId: post.id,
      },
    });
  }

  // Get updated count
  const repostCount = await prisma.repost.count({ where: { postId } });

  return c.json({ data: { reposted: true, repostCount } });
});

// Unrepost a post
postsRouter.delete("/:id/repost", requireNotBanned, async (c) => {
  const user = c.get("user");
  const postId = c.req.param("id");

  if (!user) {
    return c.json({ error: { message: "Unauthorized", code: "UNAUTHORIZED" } }, 401);
  }

  // Delete repost
  try {
    await prisma.repost.delete({
      where: { userId_postId: { userId: user.id, postId } },
    });
  } catch (error) {
    if (!isPrismaKnownRequestError(error, "P2025")) {
      throw error;
    }
  }

  // Get updated count
  const repostCount = await prisma.repost.count({ where: { postId } });

  return c.json({ data: { reposted: false, repostCount } });
});

// Get comments for a post
postsRouter.get("/:id/comments", async (c) => {
  const postId = c.req.param("id");

  // Check if post exists
  const post = await prisma.post.findUnique({ where: { id: postId } });
  if (!post) {
    return c.json({ error: { message: "Post not found", code: "NOT_FOUND" } }, 404);
  }

  const comments = await prisma.comment.findMany({
    where: { postId },
    orderBy: { createdAt: "desc" },
    include: {
      author: {
        select: {
          id: true,
          name: true,
          username: true,
          image: true,
          level: true,
          xp: true,
          isVerified: true,
        },
      },
    },
  });

  return c.json({ data: comments });
});

// Add a comment to a post
postsRouter.post("/:id/comments", requireNotBanned, zValidator("json", CreateCommentSchema), async (c) => {
  const user = c.get("user");
  const postId = c.req.param("id");
  const { content } = c.req.valid("json");

  if (!user) {
    return c.json({ error: { message: "Unauthorized", code: "UNAUTHORIZED" } }, 401);
  }

  // Rate limit check: max 15 comments per 24 hours
  const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const commentCountLast24h = await prisma.comment.count({
    where: {
      authorId: user.id,
      createdAt: { gte: twentyFourHoursAgo },
    },
  });

  if (commentCountLast24h >= DAILY_COMMENT_LIMIT) {
    // Calculate time until reset
    const oldestComment = await prisma.comment.findFirst({
      where: {
        authorId: user.id,
        createdAt: { gte: twentyFourHoursAgo },
      },
      orderBy: { createdAt: "asc" },
      select: { createdAt: true },
    });

    const resetTime = oldestComment
      ? new Date(oldestComment.createdAt.getTime() + 24 * 60 * 60 * 1000)
      : new Date(Date.now() + 60 * 60 * 1000);
    const hoursUntilReset = Math.ceil((resetTime.getTime() - Date.now()) / (60 * 60 * 1000));

    return c.json({
      error: {
        message: `Daily comment limit reached. ${commentCountLast24h}/${DAILY_COMMENT_LIMIT} comments used. Reset in ${hoursUntilReset} hour${hoursUntilReset !== 1 ? 's' : ''}.`,
        code: "RATE_LIMIT_EXCEEDED",
        data: {
          used: commentCountLast24h,
          limit: DAILY_COMMENT_LIMIT,
          resetInHours: hoursUntilReset,
        }
      }
    }, 429);
  }

  // Check if post exists
  const post = await prisma.post.findUnique({ where: { id: postId } });
  if (!post) {
    return c.json({ error: { message: "Post not found", code: "NOT_FOUND" } }, 404);
  }

  // Check for duplicate comment (same user, same post, same content within 10 seconds)
  const tenSecondsAgo = new Date(Date.now() - 10 * 1000);
  const duplicateComment = await prisma.comment.findFirst({
    where: {
      authorId: user.id,
      postId,
      content: content.trim(),
      createdAt: { gte: tenSecondsAgo },
    },
    include: {
      author: {
        select: {
          id: true,
          name: true,
          username: true,
          image: true,
          level: true,
          xp: true,
          isVerified: true,
        },
      },
    },
  });

  if (duplicateComment) {
    // Return the existing comment instead of creating a duplicate
    return c.json({ data: duplicateComment });
  }

  const comment = await prisma.comment.create({
    data: {
      content,
      authorId: user.id,
      postId,
    },
    include: {
      author: {
        select: {
          id: true,
          name: true,
          username: true,
          image: true,
          level: true,
          xp: true,
          isVerified: true,
        },
      },
    },
  });

  return c.json({ data: comment });
});

// Delete a comment
postsRouter.delete("/:id/comments/:commentId", requireNotBanned, async (c) => {
  const user = c.get("user");
  const postId = c.req.param("id");
  const commentId = c.req.param("commentId");

  if (!user) {
    return c.json({ error: { message: "Unauthorized", code: "UNAUTHORIZED" } }, 401);
  }

  // Find the comment
  const comment = await prisma.comment.findUnique({
    where: { id: commentId },
  });

  if (!comment) {
    return c.json({ error: { message: "Comment not found", code: "NOT_FOUND" } }, 404);
  }

  // Check if comment belongs to this post
  if (comment.postId !== postId) {
    return c.json({ error: { message: "Comment not found", code: "NOT_FOUND" } }, 404);
  }

  // Check if user owns the comment
  if (comment.authorId !== user.id) {
    return c.json({ error: { message: "Unauthorized", code: "UNAUTHORIZED" } }, 403);
  }

  await prisma.comment.delete({ where: { id: commentId } });

  return c.json({ data: { deleted: true } });
});

// Increment view count
postsRouter.post("/:id/view", async (c) => {
  const postId = c.req.param("id");

  // Check if post exists
  const post = await prisma.post.findUnique({ where: { id: postId } });
  if (!post) {
    return c.json({ error: { message: "Post not found", code: "NOT_FOUND" } }, 404);
  }

  // Increment view count
  const updated = await prisma.post.update({
    where: { id: postId },
    data: { viewCount: { increment: 1 } },
    select: { viewCount: true },
  });

  return c.json({ data: { viewCount: updated.viewCount } });
});

// Get users who reposted a post
postsRouter.get("/:id/reposters", async (c) => {
  const postId = c.req.param("id");

  // Check if post exists
  const post = await prisma.post.findUnique({ where: { id: postId } });
  if (!post) {
    return c.json({ error: { message: "Post not found", code: "NOT_FOUND" } }, 404);
  }

  const reposts = await prisma.repost.findMany({
    where: { postId },
    orderBy: { createdAt: "desc" },
    include: {
      user: {
        select: {
          id: true,
          name: true,
          username: true,
          image: true,
          level: true,
          xp: true,
          isVerified: true,
        },
      },
    },
  });

  const users = reposts.map((r) => r.user);

  return c.json({ data: users });
});

// Get users who posted the same CA within 48 hours (Shared Alpha)
postsRouter.get("/:id/shared-alpha", async (c) => {
  const postId = c.req.param("id");
  const freshCached = readSharedAlphaResponseCache(postId);
  if (freshCached) {
    return c.json({ data: freshCached });
  }

  const snapshot = readFeedCardSnapshot(postId);
  const snapshotAuthor =
    snapshot && typeof snapshot.author === "object" && snapshot.author !== null && !Array.isArray(snapshot.author)
      ? (snapshot.author as Record<string, unknown>)
      : null;
  const snapshotAuthorId =
    typeof snapshot?.authorId === "string"
      ? snapshot.authorId
      : typeof snapshotAuthor?.id === "string"
        ? snapshotAuthor.id
        : null;
  const snapshotContractAddress =
    typeof snapshot?.contractAddress === "string" && snapshot.contractAddress.length > 0
      ? snapshot.contractAddress
      : null;
  const snapshotSharedAlphaCount =
    typeof snapshot?.sharedAlphaCount === "number" && Number.isFinite(snapshot.sharedAlphaCount)
      ? Math.max(0, Math.round(snapshot.sharedAlphaCount))
      : 0;

  if (snapshotContractAddress && snapshotSharedAlphaCount === 0) {
    const emptyData = { users: [], count: 0 };
    writeSharedAlphaResponseCache(postId, emptyData);
    return c.json({ data: emptyData });
  }

  let post:
    | {
        id: string;
        contractAddress: string | null;
        createdAt: Date;
        authorId: string;
      }
    | null = snapshotContractAddress && snapshotAuthorId
      ? {
          id: postId,
          contractAddress: snapshotContractAddress,
          createdAt:
            typeof snapshot?.createdAt === "string" || snapshot?.createdAt instanceof Date
              ? new Date(snapshot.createdAt as string | Date)
              : new Date(),
          authorId: snapshotAuthorId,
        }
      : null;

  if (!post) {
    try {
      post = await withFeedTimeout(
        prisma.post.findUnique({
          where: { id: postId },
          select: {
            id: true,
            contractAddress: true,
            createdAt: true,
            authorId: true,
          },
        }),
        "shared_alpha_post_query",
        FEED_SOCIAL_QUERY_TIMEOUT_MS
      );
    } catch (error) {
      if (!isPrismaSchemaDriftError(error) && !isPrismaClientError(error) && !isFeedTimeoutError(error)) {
        throw error;
      }

      const staleCached = readSharedAlphaResponseCache(postId, { allowStale: true });
      if (staleCached) {
        return c.json({ data: staleCached });
      }

      return c.json({
        data: {
          users: [],
          count: snapshotSharedAlphaCount,
        },
      });
    }
  }

  if (!post) {
    return c.json({ error: { message: "Post not found", code: "NOT_FOUND" } }, 404);
  }

  if (!post.contractAddress) {
    const emptyData = { users: [], count: 0 };
    writeSharedAlphaResponseCache(postId, emptyData);
    return c.json({ data: emptyData });
  }

  const nowMs = Date.now();
  const cachedAuthors = sharedAlphaAuthorCache.get(post.contractAddress);
  if (cachedAuthors && cachedAuthors.expiresAtMs > nowMs) {
    const cachedCount = Math.max(0, cachedAuthors.authorIds.size - (cachedAuthors.authorIds.has(post.authorId) ? 1 : 0));
    if (cachedCount === 0) {
      const emptyData = { users: [], count: 0 };
      writeSharedAlphaResponseCache(postId, emptyData);
      return c.json({ data: emptyData });
    }
  }

  const fortyEightHoursAgo = new Date(Date.now() - 48 * 60 * 60 * 1000);

  try {
    const sharedPosts = await withFeedTimeout(
      prisma.post.findMany({
        where: {
          contractAddress: post.contractAddress,
          id: { not: post.id },
          authorId: { not: post.authorId },
          createdAt: { gte: fortyEightHoursAgo },
        },
        orderBy: { createdAt: "desc" },
        distinct: ["authorId"],
        include: {
          author: {
            select: {
              id: true,
              name: true,
              username: true,
              image: true,
              level: true,
              xp: true,
              isVerified: true,
            },
          },
        },
      }),
      "shared_alpha_users_query",
      FEED_SOCIAL_QUERY_TIMEOUT_MS
    );

    const authorIds = new Set<string>([post.authorId]);
    const users = sharedPosts.map((sharedPost) => {
      authorIds.add(sharedPost.authorId);
      return {
        ...sharedPost.author,
        postId: sharedPost.id,
        postedAt: sharedPost.createdAt,
      };
    });

    sharedAlphaAuthorCache.set(post.contractAddress, {
      authorIds,
      expiresAtMs: nowMs + SHARED_ALPHA_CACHE_TTL_MS,
    });

    const data = { users, count: users.length };
    writeSharedAlphaResponseCache(postId, data);
    return c.json({ data });
  } catch (error) {
    if (!isPrismaSchemaDriftError(error) && !isPrismaClientError(error) && !isFeedTimeoutError(error)) {
      throw error;
    }

    const staleCached = readSharedAlphaResponseCache(postId, { allowStale: true });
    if (staleCached) {
      return c.json({ data: staleCached });
    }

    const cachedAuthorIds = sharedAlphaAuthorCache.get(post.contractAddress);
    const cachedCount =
      cachedAuthorIds && cachedAuthorIds.expiresAtMs > nowMs
        ? Math.max(0, cachedAuthorIds.authorIds.size - (cachedAuthorIds.authorIds.has(post.authorId) ? 1 : 0))
        : snapshotSharedAlphaCount;

    return c.json({
      data: {
        users: [],
        count: cachedCount,
      },
    });
  }
});

// Get real-time price update for a post's CA (force refresh)
// This endpoint always fetches the latest price regardless of tracking mode
const BatchPostPricesSchema = z.object({
  ids: z.array(z.string().min(1)).min(1).max(50),
});

const JupiterQuoteProxySchema = z
  .object({
    inputMint: z.string().min(32).max(64),
    outputMint: z.string().min(32).max(64),
    amount: z.number().int().positive(),
    slippageBps: z.number().int().min(1).max(5000),
    swapMode: z.enum(["ExactIn", "ExactOut"]).optional().default("ExactIn"),
    postId: z.string().min(1).optional(),
  })
  .strict();

const JupiterSwapProxySchema = z
  .object({
    quoteResponse: z.record(z.string(), z.any()),
    userPublicKey: z.string().min(32).max(64),
    postId: z.string().min(1).optional(),
    tradeSide: z.enum(["buy", "sell"]).optional(),
    wrapAndUnwrapSol: z.boolean().optional(),
    dynamicComputeUnitLimit: z.boolean().optional(),
  })
  .strict();

const JupiterFeeConfirmSchema = z
  .object({
    tradeFeeEventId: z.string().min(1),
    txSignature: z.string().min(40).max(128),
    walletAddress: z.string().min(32).max(64),
  })
  .strict();

const ChartCandlesProxySchema = z
  .object({
    poolAddress: z.string().min(10).max(128).optional(),
    tokenAddress: z.string().min(10).max(128).optional(),
    chainType: z.enum(["solana", "evm", "ethereum"]).optional(),
    timeframe: z.enum(["minute", "hour", "day"]).optional().default("minute"),
    aggregate: z.number().int().min(1).max(240).optional().default(5),
    limit: z.number().int().min(20).max(720).optional().default(260),
  })
  .strict()
  .refine((value) => Boolean(value.poolAddress || value.tokenAddress), {
    message: "poolAddress or tokenAddress is required",
    path: ["poolAddress"],
  });

type ChartCandlesPayload = z.infer<typeof ChartCandlesProxySchema>;

type PriceRoutePostRecord = {
  id: string;
  contractAddress: string | null;
  chainType: string | null;
  entryMcap: number | null;
  currentMcap: number | null;
  mcap1h: number | null;
  mcap6h: number | null;
  settled: boolean;
  settledAt: Date | null;
  createdAt: Date;
  lastMcapUpdate: Date | null;
  trackingMode: string | null;
};

async function resolvePostPricePayload(post: PriceRoutePostRecord) {
  // If no contract address, return current values
  if (!post.contractAddress) {
    return {
      currentMcap: post.currentMcap,
      entryMcap: post.entryMcap,
      mcap1h: post.mcap1h,
      mcap6h: post.mcap6h,
      percentChange: null,
      trackingMode: post.trackingMode,
      lastMcapUpdate: post.lastMcapUpdate?.toISOString() ?? null,
      settled: post.settled,
      settledAt: post.settledAt?.toISOString() ?? null,
    };
  }

  // Live post polling can still nudge settlement forward when cron is unavailable, but it
  // must not run the heavier market-refresh job on this hot request path.
  if (shouldRunOpportunisticMaintenance() && shouldTriggerMaintenanceForPost(post)) {
    triggerSettlementCycleNonBlocking(`price:${post.id}`);
  }

  const trackingMode = determineTrackingMode(post.createdAt);
  let finalMcap = post.currentMcap;
  let responseUpdatedAt = post.lastMcapUpdate ?? new Date();

  // Avoid a thundering herd: only refresh if the cached value is stale.
  const shouldRefresh = needsMcapUpdate(post.createdAt, post.lastMcapUpdate, post.settled);

  if (shouldRefresh) {
    let refreshPromise = priceRefreshInFlight.get(post.id);
    if (!refreshPromise) {
      refreshPromise = (async () => {
        // Price route must stay fast and non-blocking.
        // Persisted writes are handled by maintenance to avoid lock contention from polling.
        const latest = await getFeedMarketCapSnapshot(post.contractAddress!, post.chainType);
        return latest.mcap;
      })()
        .catch((error) => {
          console.error("[posts/price] Failed to refresh market cap", { postId: post.id, error });
          return null;
        })
        .finally(() => {
          priceRefreshInFlight.delete(post.id);
        });
      priceRefreshInFlight.set(post.id, refreshPromise);
    }

    const refreshedMcap = await refreshPromise;
    if (refreshedMcap !== null) {
      finalMcap = refreshedMcap;
      responseUpdatedAt = new Date();
    }
  }

  const percentChange = post.entryMcap && finalMcap
    ? ((finalMcap - post.entryMcap) / post.entryMcap) * 100
    : null;

  return {
    currentMcap: finalMcap,
    entryMcap: post.entryMcap,
    mcap1h: post.mcap1h,
    mcap6h: post.mcap6h,
    percentChange: percentChange !== null ? Math.round(percentChange * 100) / 100 : null,
    trackingMode: trackingMode,
    lastMcapUpdate: responseUpdatedAt.toISOString(),
    settled: post.settled,
    settledAt: post.settledAt?.toISOString() ?? null,
  };
}

async function forwardJupiterRequest(
  targets: string[],
  init: RequestInit & { timeoutMs?: number; hedgeDelayMs?: number }
): Promise<JupiterProxyResult> {
  const { timeoutMs = 7000, hedgeDelayMs = 140, ...requestInit } = init;
  let lastStatus = 502;
  let lastBody = "Failed to reach Jupiter";
  let lastContentType: string | null = null;

  if (targets.length === 0) {
    return { status: lastStatus, bodyText: lastBody, contentType: lastContentType };
  }

  // Hedge requests across Jupiter mirrors so quote/swap fetches return faster.
  // First target starts immediately, mirror(s) are slightly delayed.
  return await new Promise((resolve) => {
    const controllers: AbortController[] = [];
    let pending = targets.length;
    let settled = false;

    const resolveOnce = (result: JupiterProxyResult) => {
      if (settled) return;
      settled = true;
      for (const controller of controllers) {
        controller.abort();
      }
      resolve(result);
    };

    const onFailure = (result: JupiterProxyResult) => {
      lastStatus = result.status;
      lastBody = result.bodyText;
      lastContentType = result.contentType;
      pending -= 1;
      if (pending <= 0 && !settled) {
        resolve({ status: lastStatus, bodyText: lastBody, contentType: lastContentType });
      }
    };

    targets.forEach((url, index) => {
      const delayMs = index === 0 ? 0 : hedgeDelayMs * index;
      setTimeout(async () => {
        if (settled) {
          pending -= 1;
          return;
        }

        const controller = new AbortController();
        controllers.push(controller);
        const timeout = setTimeout(() => controller.abort(), timeoutMs);
        try {
          const res = await fetch(url, {
            ...requestInit,
            signal: controller.signal,
          });
          clearTimeout(timeout);
          const bodyText = await res.text();
          const contentType = res.headers.get("content-type");
          if (res.ok) {
            resolveOnce({ status: res.status, bodyText, contentType });
            return;
          }
          onFailure({
            status: res.status,
            bodyText: bodyText || `Jupiter request failed (${res.status})`,
            contentType,
          });
        } catch (error) {
          clearTimeout(timeout);
          onFailure({
            status: 502,
            bodyText: error instanceof Error ? error.message : "Jupiter request failed",
            contentType: "text/plain",
          });
        }
      }, delayMs);
    });
  });
}

postsRouter.post("/jupiter/quote", zValidator("json", JupiterQuoteProxySchema), async (c) => {
  const payload = c.req.valid("json");
  const platformFeeBps = getActivePlatformFeeBps();
  const cacheKey = buildJupiterQuoteCacheKey(payload, platformFeeBps);
  const now = Date.now();
  const cached = jupiterQuoteCache.get(cacheKey);
  if (cached && cached.expiresAtMs > now) {
    const contentType = cached.result.contentType ?? "application/json";
    return new Response(cached.result.bodyText, {
      status: cached.result.status,
      headers: {
        "content-type": contentType,
        "cache-control": "no-store",
      },
    });
  }
  if (cached) {
    jupiterQuoteCache.delete(cacheKey);
  }

  const params = new URLSearchParams({
    inputMint: payload.inputMint,
    outputMint: payload.outputMint,
    amount: String(payload.amount),
    slippageBps: String(payload.slippageBps),
    swapMode: payload.swapMode ?? "ExactIn",
  });
  if (platformFeeBps > 0) {
    params.set("platformFeeBps", String(platformFeeBps));
  }

  let request = jupiterQuoteInFlight.get(cacheKey);
  if (!request) {
    request = forwardJupiterRequest(
      JUPITER_QUOTE_URLS.map((base) => `${base}?${params.toString()}`),
      {
        method: "GET",
        headers: { accept: "application/json" },
        timeoutMs: 3_200,
        hedgeDelayMs: 40,
      }
    );
    jupiterQuoteInFlight.set(cacheKey, request);
  }

  const result = await request.finally(() => {
    const current = jupiterQuoteInFlight.get(cacheKey);
    if (current === request) {
      jupiterQuoteInFlight.delete(cacheKey);
    }
  });

  const ttlMs =
    result.status >= 400 ? JUPITER_QUOTE_ERROR_CACHE_TTL_MS : JUPITER_QUOTE_CACHE_TTL_MS;
  if (ttlMs > 0) {
    jupiterQuoteCache.set(cacheKey, {
      result,
      expiresAtMs: Date.now() + ttlMs,
    });
  }

  const contentType = result.contentType ?? "application/json";
  return new Response(result.bodyText, {
    status: result.status,
    headers: {
      "content-type": contentType,
      "cache-control": "no-store",
    },
  });
});

postsRouter.post("/jupiter/swap", requireNotBanned, zValidator("json", JupiterSwapProxySchema), async (c) => {
  const payload = c.req.valid("json");
  const currentUser = c.get("user");
  if (!currentUser) {
    return c.json({ error: { message: "Unauthorized", code: "UNAUTHORIZED" } }, 401);
  }

  const traderUser = await prisma.user.findUnique({
    where: { id: currentUser.id },
    select: { walletAddress: true },
  });
  const linkedWalletAddress = safeString(traderUser?.walletAddress);
  if (!linkedWalletAddress) {
    return c.json(
      { error: { message: "Link a wallet before building trades", code: "WALLET_NOT_LINKED" } },
      403
    );
  }
  if (linkedWalletAddress !== payload.userPublicKey) {
    return c.json(
      { error: { message: "Trade wallet does not match the authenticated wallet", code: "WALLET_MISMATCH" } },
      403
    );
  }

  const platformFeeBps = getActivePlatformFeeBps();
  const quote = safeRecord(payload.quoteResponse) ?? {};

  const postContextPromise: Promise<JupiterSwapPostContext | null> = payload.postId
    ? (async () => {
        try {
          return await prisma.post.findUnique({
            where: { id: payload.postId },
            select: {
              id: true,
              chainType: true,
              authorId: true,
              author: {
                select: {
                  id: true,
                  walletAddress: true,
                  tradeFeeRewardsEnabled: true,
                  tradeFeeShareBps: true,
                  tradeFeePayoutAddress: true,
                },
              },
            },
          });
        } catch (error) {
          if (!isPrismaSchemaDriftError(error)) {
            console.warn("[posts/jupiter/swap] post context lookup skipped", {
              postId: payload.postId,
              code:
                typeof error === "object" &&
                error !== null &&
                "code" in error &&
                typeof (error as { code?: unknown }).code === "string"
                  ? (error as { code: string }).code
                  : null,
              message: error instanceof Error ? error.message : String(error),
            });
            return null;
          }

          // Fallback for environments where fee columns are not yet migrated.
          try {
            const fallbackPost = await prisma.post.findUnique({
              where: { id: payload.postId },
              select: {
                id: true,
                chainType: true,
                authorId: true,
                author: {
                  select: {
                    id: true,
                    walletAddress: true,
                  },
                },
              },
            });

            return fallbackPost
              ? {
                  id: fallbackPost.id,
                  chainType: fallbackPost.chainType,
                  authorId: fallbackPost.authorId,
                  author: {
                    id: fallbackPost.author.id,
                    walletAddress: fallbackPost.author.walletAddress,
                    tradeFeeRewardsEnabled: true,
                    tradeFeeShareBps: DEFAULT_POSTER_TRADE_FEE_SHARE_BPS,
                    tradeFeePayoutAddress: null,
                  },
                }
              : null;
          } catch (fallbackError) {
            console.warn("[posts/jupiter/swap] fallback post context lookup skipped", {
              postId: payload.postId,
              message: fallbackError instanceof Error ? fallbackError.message : String(fallbackError),
            });
            return null;
          }
        }
      })()
    : Promise.resolve(null);

  const outboundPayload: Record<string, unknown> = {
    quoteResponse: payload.quoteResponse,
    userPublicKey: payload.userPublicKey,
    wrapAndUnwrapSol: payload.wrapAndUnwrapSol ?? true,
    dynamicComputeUnitLimit: payload.dynamicComputeUnitLimit ?? true,
    prioritizationFeeLamports: {
      priorityLevelWithMaxLamports: {
        priorityLevel: JUPITER_PRIORITY_LEVEL,
        maxLamports: JUPITER_MAX_PRIORITY_FEE_LAMPORTS,
        global: false,
      },
    },
  };
  if (platformFeeBps > 0) {
    outboundPayload.feeAccount = JUPITER_PLATFORM_FEE_ACCOUNT;
  }

  const result = await forwardJupiterRequest(JUPITER_SWAP_URLS, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify(outboundPayload),
    timeoutMs: 7000,
  });

  if (result.status >= 400) {
    const contentType = result.contentType ?? "application/json";
    return new Response(result.bodyText, {
      status: result.status,
      headers: {
        "content-type": contentType,
        "cache-control": "no-store",
      },
    });
  }

  let parsedSwapBody: Record<string, unknown> | null = null;
  try {
    const parsed = JSON.parse(result.bodyText) as unknown;
    parsedSwapBody = safeRecord(parsed);
  } catch {
    parsedSwapBody = null;
  }

  if (!parsedSwapBody) {
    const contentType = result.contentType ?? "application/json";
    return new Response(result.bodyText, {
      status: result.status,
      headers: {
        "content-type": contentType,
        "cache-control": "no-store",
      },
    });
  }

  let tradeFeeEventId: string | null = null;
  let tradeVerificationMemo: string | null = null;
  let posterShareBpsApplied = 0;
  const platformFeeInfo = safeRecord(quote.platformFee);
  const platformFeeAmountAtomic = safeNumericString(platformFeeInfo?.amount);
  const platformFeeAmountBigInt =
    platformFeeAmountAtomic && platformFeeAmountAtomic !== "0"
      ? BigInt(platformFeeAmountAtomic)
      : 0n;
  const platformFeeMint =
    safeString(platformFeeInfo?.mint) ??
    safeString(quote.outputMint) ??
    safeString(quote.inputMint) ??
    SOL_MINT;
  const quotePlatformFeeBpsRaw = Number(platformFeeInfo?.feeBps);
  const platformFeeBpsApplied =
    Number.isFinite(quotePlatformFeeBpsRaw) && quotePlatformFeeBpsRaw > 0
      ? Math.min(FIXED_PLATFORM_FEE_BPS, Math.max(1, Math.round(quotePlatformFeeBpsRaw)))
      : platformFeeBps;
  const postContext = await withTimeoutFallback(postContextPromise, 180, null);

  if (
    postContext &&
    postContext.chainType === "solana" &&
    platformFeeAmountBigInt > 0n &&
    platformFeeBpsApplied > 0
  ) {
    const posterShareBps = postContext.author.tradeFeeRewardsEnabled
      ? clampPosterFeeShareBps(postContext.author.tradeFeeShareBps)
      : 0;
    posterShareBpsApplied = posterShareBps;
    const posterShareAmountAtomic =
      ((platformFeeAmountBigInt * BigInt(posterShareBps)) / BigInt(platformFeeBpsApplied)).toString();

    const tradeFeeEventPromise = prisma.tradeFeeEvent.create({
      data: {
        postId: postContext.id,
        posterUserId: postContext.authorId,
        traderUserId: currentUser?.id ?? null,
        traderWalletAddress: payload.userPublicKey,
        tradeSide: payload.tradeSide ?? deriveTradeSideFromQuote(quote),
        inputMint: safeString(quote.inputMint) ?? SOL_MINT,
        outputMint: safeString(quote.outputMint) ?? SOL_MINT,
        inAmountAtomic: safeNumericString(quote.inAmount) ?? "0",
        outAmountAtomic: safeNumericString(quote.outAmount) ?? "0",
        platformFeeBps: platformFeeBpsApplied,
        platformFeeAmountAtomic: platformFeeAmountBigInt.toString(),
        feeMint: platformFeeMint,
        posterShareBps,
        posterShareAmountAtomic,
        posterPayoutAddress: postContext.author.tradeFeePayoutAddress ?? postContext.author.walletAddress,
        status: "pending",
      },
      select: { id: true },
    })
      .then((row) => row)
      .catch((error) => {
        if (isPrismaSchemaDriftError(error)) {
          console.warn("[posts/jupiter/swap] trade fee event logging skipped (schema not ready)");
        } else {
          console.warn("[posts/jupiter/swap] trade fee event logging skipped", {
            postId: postContext.id,
            traderUserId: currentUser?.id ?? null,
            traderWalletAddress: payload.userPublicKey,
            code:
              typeof error === "object" &&
              error !== null &&
              "code" in error &&
              typeof (error as { code?: unknown }).code === "string"
                ? (error as { code: string }).code
                : null,
            message: error instanceof Error ? error.message : String(error),
          });
        }
        return null;
      });

    const createdEvent = await withTimeoutFallback<{ id: string } | null>(
      tradeFeeEventPromise,
      240,
      null
    );
    if (createdEvent?.id) {
      tradeFeeEventId = createdEvent.id;
      tradeVerificationMemo = buildTradeVerificationMemo({
        tradeFeeEventId: createdEvent.id,
        postId: postContext.id,
      });
    }
  }

  return new Response(
    JSON.stringify({
      ...parsedSwapBody,
      tradeFeeEventId,
      tradeVerificationMemo,
      platformFeeBpsApplied,
      posterShareBpsApplied,
    }),
    {
      status: result.status,
      headers: {
        "content-type": "application/json",
        "cache-control": "no-store",
      },
    }
  );
});

postsRouter.post(
  "/jupiter/fee-confirm",
  requireNotBanned,
  zValidator("json", JupiterFeeConfirmSchema),
  async (c) => {
    const user = c.get("user");
    if (!user) {
      return c.json({ error: { message: "Unauthorized", code: "UNAUTHORIZED" } }, 401);
    }

    const payload = c.req.valid("json");
    let existing:
      | {
          id: string;
          postId: string;
          status: string;
          traderUserId: string | null;
          traderWalletAddress: string;
          platformFeeAmountAtomic: string;
          txSignature: string | null;
          verificationError: string | null;
        }
      | null = null;
    try {
      existing = await prisma.tradeFeeEvent.findUnique({
        where: { id: payload.tradeFeeEventId },
        select: {
          id: true,
          postId: true,
          status: true,
          traderUserId: true,
          traderWalletAddress: true,
          platformFeeAmountAtomic: true,
          txSignature: true,
          verificationError: true,
        },
      });
    } catch (error) {
      if (isPrismaSchemaDriftError(error)) {
        console.warn("[posts/jupiter/fee-confirm] skipped (schema not ready)");
      } else {
        console.warn("[posts/jupiter/fee-confirm] lookup skipped", {
          id: payload.tradeFeeEventId,
          message: error instanceof Error ? error.message : String(error),
        });
      }
      return c.json({
        data: {
          id: payload.tradeFeeEventId,
          txSignature: payload.txSignature,
          skipped: true,
        },
      });
    }

    if (!existing) {
      return c.json({
        data: {
          id: payload.tradeFeeEventId,
          txSignature: payload.txSignature,
          skipped: true,
        },
      });
    }

    if (existing.traderUserId && existing.traderUserId !== user.id) {
      return c.json({ error: { message: "Forbidden", code: "FORBIDDEN" } }, 403);
    }

    if (existing.traderWalletAddress !== payload.walletAddress) {
      return c.json({ error: { message: "Wallet mismatch for fee event", code: "WALLET_MISMATCH" } }, 403);
    }

    if (existing.status === "rejected") {
      return c.json(
        {
          error: {
            message: existing.verificationError ?? "Fee event was rejected during verification",
            code: "TRADE_VERIFICATION_REJECTED",
          },
        },
        409
      );
    }

    if (existing.txSignature && existing.txSignature !== payload.txSignature) {
      return c.json({ error: { message: "Fee event already confirmed", code: "ALREADY_CONFIRMED" } }, 409);
    }

    if (user.walletAddress && user.walletAddress !== payload.walletAddress) {
      return c.json({ error: { message: "Authenticated wallet mismatch", code: "WALLET_MISMATCH" } }, 403);
    }

    const parsedTransaction = await getParsedSolanaTransaction(payload.txSignature);
    if (!parsedTransaction || parsedTransaction.meta?.err) {
      await prisma.tradeFeeEvent.update({
        where: { id: existing.id },
        data: {
          verificationError: parsedTransaction?.meta?.err
            ? "Transaction failed on-chain"
            : "Transaction not yet confirmed on-chain",
        },
      }).catch(() => undefined);

      return c.json(
        {
          error: {
            message: "Transaction is not yet confirmed on-chain",
            code: "TX_NOT_CONFIRMED",
          },
        },
        409
      );
    }

    const expectedMemo = buildTradeVerificationMemo({
      tradeFeeEventId: existing.id,
      postId: existing.postId,
    });
    if (!transactionHasExpectedSigner(parsedTransaction, existing.traderWalletAddress)) {
      await prisma.tradeFeeEvent.update({
        where: { id: existing.id },
        data: {
          status: "rejected",
          txSignature: payload.txSignature,
          verificationError: "Transaction signer does not match the authenticated trader wallet",
        },
      }).catch(() => undefined);
      return c.json(
        {
          error: {
            message: "Transaction signer does not match the authenticated wallet",
            code: "TRADE_VERIFICATION_FAILED",
          },
        },
        400
      );
    }

    if (!transactionHasExpectedMemo(parsedTransaction, expectedMemo)) {
      await prisma.tradeFeeEvent.update({
        where: { id: existing.id },
        data: {
          status: "rejected",
          txSignature: payload.txSignature,
          verificationError: "Transaction memo does not match the expected post metadata",
        },
      }).catch(() => undefined);
      return c.json(
        {
          error: {
            message: "Transaction memo does not match the expected post",
            code: "TRADE_VERIFICATION_FAILED",
          },
        },
        400
      );
    }

    if (
      !transactionHasExpectedFeeTransfer({
        transaction: parsedTransaction,
        destinationAddress: JUPITER_PLATFORM_FEE_ACCOUNT,
        minimumAmountAtomic: BigInt(existing.platformFeeAmountAtomic),
      })
    ) {
      await prisma.tradeFeeEvent.update({
        where: { id: existing.id },
        data: {
          status: "rejected",
          txSignature: payload.txSignature,
          verificationError: "Expected platform fee transfer was not found on-chain",
        },
      }).catch(() => undefined);
      return c.json(
        {
          error: {
            message: "Expected platform fee transfer was not found on-chain",
            code: "TRADE_VERIFICATION_FAILED",
          },
        },
        400
      );
    }

    let updated: {
      id: string;
      txSignature: string | null;
      status: string;
      confirmedAt: Date | null;
    };
    try {
      updated = await prisma.tradeFeeEvent.update({
        where: { id: existing.id },
        data: {
          txSignature: payload.txSignature,
          status: "confirmed",
          confirmedAt: new Date(),
          verificationError: null,
        },
        select: {
          id: true,
          txSignature: true,
          status: true,
          confirmedAt: true,
        },
      });
    } catch (error) {
      if (isPrismaSchemaDriftError(error)) {
        console.warn("[posts/jupiter/fee-confirm] update skipped (schema not ready)");
      } else {
        console.warn("[posts/jupiter/fee-confirm] update skipped", {
          id: payload.tradeFeeEventId,
          message: error instanceof Error ? error.message : String(error),
        });
      }
      return c.json({
        data: {
          id: payload.tradeFeeEventId,
          txSignature: payload.txSignature,
          skipped: true,
        },
      });
    }

    return c.json({
      data: {
        ...updated,
        confirmedAt: updated.confirmedAt?.toISOString() ?? null,
      },
    });
  }
);

function buildChartCandlesCacheKey(payload: ChartCandlesPayload): string {
  return [
    payload.chainType ?? "ethereum",
    payload.poolAddress?.toLowerCase() ?? "",
    payload.tokenAddress?.toLowerCase() ?? "",
    payload.timeframe ?? "minute",
    String(payload.aggregate ?? 5),
    String(payload.limit ?? 260),
  ].join(":");
}

function secondsPerCandle(timeframe: "minute" | "hour" | "day", aggregate: number): number {
  if (timeframe === "minute") return Math.max(1, aggregate) * 60;
  if (timeframe === "hour") return Math.max(1, aggregate) * 60 * 60;
  return Math.max(1, aggregate) * 24 * 60 * 60;
}

function toBirdeyeInterval(timeframe: "minute" | "hour" | "day", aggregate: number): string {
  if (timeframe === "minute") {
    if (aggregate <= 1) return "1m";
    if (aggregate <= 3) return "3m";
    if (aggregate <= 5) return "5m";
    if (aggregate <= 15) return "15m";
    return "30m";
  }
  if (timeframe === "hour") {
    if (aggregate <= 1) return "1H";
    if (aggregate <= 2) return "2H";
    if (aggregate <= 4) return "4H";
    if (aggregate <= 8) return "8H";
    return "12H";
  }
  return "1D";
}

function getChartCandlesSourceHealth(source: ChartCandlesSource): ChartCandlesSourceHealth {
  const existing = chartCandlesSourceHealth.get(source);
  if (existing) {
    return existing;
  }
  const initial: ChartCandlesSourceHealth = {
    source,
    avgLatencyMs: CHART_PROVIDER_DEFAULT_LATENCY_MS[source],
    lastSuccessAtMs: 0,
    lastFailureAtMs: 0,
    lastCandleTimestampSec: 0,
    consecutiveFailures: 0,
    successCount: 0,
    failureCount: 0,
    cooldownUntilMs: 0,
  };
  chartCandlesSourceHealth.set(source, initial);
  return initial;
}

function recordChartCandlesProviderSuccess(
  source: ChartCandlesSource,
  latencyMs: number,
  result: ChartCandlesFetchResult
): void {
  const state = getChartCandlesSourceHealth(source);
  const normalizedLatency = Number.isFinite(latencyMs)
    ? Math.max(10, Math.min(20_000, Math.round(latencyMs)))
    : state.avgLatencyMs;
  state.avgLatencyMs =
    state.successCount <= 0
      ? normalizedLatency
      : Math.round(state.avgLatencyMs * 0.72 + normalizedLatency * 0.28);
  state.lastSuccessAtMs = Date.now();
  state.consecutiveFailures = 0;
  state.cooldownUntilMs = 0;
  state.successCount += 1;

  const newestCandle = result.candles[result.candles.length - 1];
  if (newestCandle && Number.isFinite(newestCandle.timestamp)) {
    state.lastCandleTimestampSec = Math.max(0, Math.floor(newestCandle.timestamp));
  }
}

function recordChartCandlesProviderFailure(source: ChartCandlesSource, latencyMs: number): void {
  const state = getChartCandlesSourceHealth(source);
  const normalizedLatency = Number.isFinite(latencyMs)
    ? Math.max(10, Math.min(20_000, Math.round(latencyMs)))
    : state.avgLatencyMs;
  state.avgLatencyMs = Math.round(state.avgLatencyMs * 0.9 + normalizedLatency * 0.1);
  state.lastFailureAtMs = Date.now();
  state.failureCount += 1;
  state.consecutiveFailures = Math.min(8, state.consecutiveFailures + 1);

  const cooldownMs = Math.min(
    CHART_PROVIDER_FAILURE_COOLDOWN_MAX_MS,
    CHART_PROVIDER_FAILURE_COOLDOWN_BASE_MS * Math.pow(2, state.consecutiveFailures - 1)
  );
  state.cooldownUntilMs = Date.now() + cooldownMs;
}

function scoreChartCandlesProvider(
  source: ChartCandlesSource,
  payload: ChartCandlesPayload,
  nowMs: number
): number {
  const state = getChartCandlesSourceHealth(source);
  const timeframe = payload.timeframe ?? "minute";
  const aggregate = payload.aggregate ?? 5;
  const expectedCadenceSec = Math.max(1, secondsPerCandle(timeframe, aggregate));
  const nowSec = Math.floor(nowMs / 1000);

  let score = CHART_PROVIDER_BASELINE_SCORE[source];

  if (state.cooldownUntilMs > nowMs) {
    score -= 10_000;
  }

  if (state.lastSuccessAtMs > 0) {
    const successAgeMs = nowMs - state.lastSuccessAtMs;
    if (successAgeMs <= CHART_PROVIDER_RECENT_SUCCESS_WINDOW_MS) {
      score += 14;
    } else if (successAgeMs <= 10 * 60_000) {
      score += 4;
    } else {
      score -= 4;
    }
  }

  if (state.lastCandleTimestampSec > 0) {
    const allowedLagSec = Math.max(expectedCadenceSec * CHART_PROVIDER_FRESHNESS_GRACE_CANDLES, 90);
    const lagSec = Math.max(0, nowSec - state.lastCandleTimestampSec);
    if (lagSec <= allowedLagSec) {
      score += 10;
    } else if (lagSec <= allowedLagSec * 2) {
      score += 2;
    } else {
      score -= Math.min(28, Math.floor(lagSec / expectedCadenceSec) * 2);
    }
  }

  score -= Math.min(24, state.avgLatencyMs / 120);
  score -= state.consecutiveFailures * 18;

  if (state.lastFailureAtMs > 0 && nowMs - state.lastFailureAtMs <= CHART_PROVIDER_RECENT_FAILURE_WINDOW_MS) {
    score -= 8;
  }

  score += Math.min(8, state.successCount / 8);
  return score;
}

function buildChartPoolLookupKey(payload: ChartCandlesPayload): string | null {
  const tokenAddress = safeString(payload.tokenAddress)?.toLowerCase();
  if (!tokenAddress) return null;
  const network = payload.chainType === "solana" ? "solana" : "ethereum";
  return `${network}:${tokenAddress}`;
}

function parseDexPairsForPoolLookup(payload: unknown): Record<string, unknown>[] {
  if (Array.isArray(payload)) {
    return payload
      .map((entry) => safeRecord(entry))
      .filter((entry): entry is Record<string, unknown> => entry !== null);
  }
  const top = safeRecord(payload);
  const pairs = Array.isArray(top?.pairs) ? top.pairs : [];
  return pairs
    .map((entry) => safeRecord(entry))
    .filter((entry): entry is Record<string, unknown> => entry !== null);
}

function parseGeckoPoolsForLookup(payload: unknown): string[] {
  const top = safeRecord(payload);
  const rows = Array.isArray(top?.data) ? top.data : [];
  const ranked = rows
    .map((entry) => {
      const item = safeRecord(entry);
      if (!item) return null;
      const attributes = safeRecord(item.attributes);
      const id = safeString(item.id);
      const idAddress = id && id.includes("_") ? id.slice(id.lastIndexOf("_") + 1) : null;
      const poolAddress = safeString(attributes?.address) ?? idAddress;
      if (!poolAddress) return null;

      const liquidityUsd = safeFiniteNumber(attributes?.reserve_in_usd) ?? 0;
      const volumeBlock = safeRecord(attributes?.volume_usd);
      const volume24h =
        safeFiniteNumber(volumeBlock?.h24) ??
        safeFiniteNumber(attributes?.volume_usd) ??
        0;

      return {
        poolAddress,
        score: liquidityUsd * 2 + volume24h,
      };
    })
    .filter((entry): entry is { poolAddress: string; score: number } => entry !== null)
    .sort((a, b) => b.score - a.score);

  if (ranked.length === 0) {
    return [];
  }

  return ranked.map((entry) => entry.poolAddress);
}

function pickBestPoolAddressFromDexPairs(
  pairs: Record<string, unknown>[],
  network: "solana" | "ethereum"
): string | null {
  let bestAddress: string | null = null;
  let bestScore = -Infinity;

  for (const pair of pairs) {
    const chainId = safeString(pair.chainId)?.toLowerCase() ?? "";
    if (chainId && chainId !== network) continue;

    const pairAddress = safeString(pair.pairAddress);
    if (!pairAddress) continue;

    const liquidity = safeRecord(pair.liquidity);
    const volume = safeRecord(pair.volume);
    const txns = safeRecord(pair.txns);
    const tx24h = safeRecord(txns?.h24);

    const liquidityUsd = safeFiniteNumber(liquidity?.usd) ?? 0;
    const volume24h = safeFiniteNumber(volume?.h24) ?? 0;
    const buyCount24h = safeFiniteNumber(tx24h?.buys) ?? 0;
    const sellCount24h = safeFiniteNumber(tx24h?.sells) ?? 0;
    const score = liquidityUsd * 2 + volume24h + (buyCount24h + sellCount24h) * 12;

    if (score > bestScore) {
      bestScore = score;
      bestAddress = pairAddress;
    } else if (!bestAddress) {
      bestAddress = pairAddress;
    }
  }

  return bestAddress;
}

async function resolveChartPoolAddress(payload: ChartCandlesPayload): Promise<string | null> {
  const directPoolAddress = safeString(payload.poolAddress);
  if (directPoolAddress) return directPoolAddress;

  const tokenAddress = safeString(payload.tokenAddress);
  if (!tokenAddress) return null;
  const network: "solana" | "ethereum" = payload.chainType === "solana" ? "solana" : "ethereum";
  const lookupKey = buildChartPoolLookupKey(payload);
  if (!lookupKey) return null;

  const now = Date.now();
  const cached = chartPoolAddressCache.get(lookupKey);
  if (cached && cached.expiresAtMs > now) {
    return cached.poolAddress;
  }
  if (cached) {
    chartPoolAddressCache.delete(lookupKey);
  }

  let request = chartPoolAddressInFlight.get(lookupKey);
  if (!request) {
    request = (async () => {
      const endpoints = [
        `https://api.dexscreener.com/tokens/v1/${network}/${tokenAddress}`,
        `https://api.dexscreener.com/latest/dex/tokens/${tokenAddress}`,
      ];

      for (const endpoint of endpoints) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 3_200);
        try {
          const response = await fetch(endpoint, {
            method: "GET",
            headers: { accept: "application/json" },
            signal: controller.signal,
          });
          if (!response.ok) {
            continue;
          }
          const parsed = (await response.json()) as unknown;
          const pairs = parseDexPairsForPoolLookup(parsed);
          const bestPool = pickBestPoolAddressFromDexPairs(pairs, network);
          if (bestPool) {
            return bestPool;
          }
        } catch {
          // Continue trying other endpoints.
        } finally {
          clearTimeout(timeout);
        }
      }

      const geckoNetwork = network === "solana" ? "solana" : "eth";
      const geckoEndpoint = `https://api.geckoterminal.com/api/v2/networks/${geckoNetwork}/tokens/${tokenAddress}/pools?page=1`;
      const geckoController = new AbortController();
      const geckoTimeout = setTimeout(() => geckoController.abort(), 3_200);
      try {
        const response = await fetch(geckoEndpoint, {
          method: "GET",
          headers: { accept: "application/json" },
          signal: geckoController.signal,
        });
        if (response.ok) {
          const parsed = (await response.json()) as unknown;
          const pools = parseGeckoPoolsForLookup(parsed);
          if (pools.length > 0) {
            return pools[0] ?? null;
          }
        }
      } catch {
        // Continue with null fallback.
      } finally {
        clearTimeout(geckoTimeout);
      }

      return null;
    })().finally(() => {
      chartPoolAddressInFlight.delete(lookupKey);
    });
    chartPoolAddressInFlight.set(lookupKey, request);
  }

  const poolAddress = await request;
  chartPoolAddressCache.set(lookupKey, {
    poolAddress,
    expiresAtMs: Date.now() + CHART_POOL_ADDRESS_CACHE_TTL_MS,
  });
  return poolAddress;
}

async function fetchGeckoTerminalCandles(payload: ChartCandlesPayload): Promise<ChartCandlesFetchResult> {
  const poolAddress = await resolveChartPoolAddress(payload);
  if (!poolAddress) {
    throw new Error("Pool address is required for GeckoTerminal candles");
  }

  const network = payload.chainType === "solana" ? "solana" : "eth";
  const params = new URLSearchParams({
    aggregate: String(payload.aggregate ?? 5),
    limit: String(payload.limit ?? 260),
    currency: "usd",
    token: "base",
  });
  const geckoUrl = `https://api.geckoterminal.com/api/v2/networks/${network}/pools/${poolAddress}/ohlcv/${payload.timeframe ?? "minute"}?${params.toString()}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 4_500);
  try {
    const response = await fetch(geckoUrl, {
      method: "GET",
      headers: { accept: "application/json" },
      signal: controller.signal,
    });
    const bodyText = await response.text();
    if (!response.ok) {
      throw new Error(bodyText || `GeckoTerminal request failed (${response.status})`);
    }

    const parsed = JSON.parse(bodyText) as unknown;
    const top = safeRecord(parsed);
    const data = safeRecord(top?.data);
    const attributes = safeRecord(data?.attributes);
    const rawList = Array.isArray(attributes?.ohlcv_list) ? attributes.ohlcv_list : [];

    const candles = finalizeChartCandles(
      rawList.map((row) => {
        if (!Array.isArray(row) || row.length < 6) return null;
        return normalizeChartCandle({
          timestamp: row[0],
          open: row[1],
          high: row[2],
          low: row[3],
          close: row[4],
          volume: row[5],
        });
      }),
      payload.limit ?? 260
    );

    return {
      source: "geckoterminal",
      network,
      candles,
    };
  } finally {
    clearTimeout(timeout);
  }
}

function parseBirdeyeCandlesFromBody(bodyText: string, limit: number): NormalizedChartCandle[] {
  const parsed = JSON.parse(bodyText) as unknown;
  const top = safeRecord(parsed);
  const successFlag = top?.success;
  if (successFlag === false) {
    throw new Error("Birdeye returned an unsuccessful response");
  }
  const data = safeRecord(top?.data);
  const rawItems = Array.isArray(data?.items)
    ? data.items
    : Array.isArray(data?.history)
      ? data.history
      : [];

  return finalizeChartCandles(
    rawItems.map((row) => {
      const item = safeRecord(row);
      if (!item) return null;
      const value = safeFiniteNumber(item.value);
      return normalizeChartCandle({
        timestamp: item.unixTime ?? item.time ?? item.timestamp,
        open: item.o ?? item.open ?? value,
        high: item.h ?? item.high ?? value,
        low: item.l ?? item.low ?? value,
        close: item.c ?? item.close ?? value,
        volume: item.v ?? item.volume ?? item.baseVolume ?? item.quoteVolume ?? 0,
      });
    }),
    limit
  );
}

async function requestBirdeyeCandles(args: {
  endpointPath: "/defi/v3/ohlcv/pair" | "/defi/v3/ohlcv" | "/defi/ohlcv";
  params: URLSearchParams;
  limit: number;
}): Promise<NormalizedChartCandle[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 2_800);
  try {
    const response = await fetch(`https://public-api.birdeye.so${args.endpointPath}?${args.params.toString()}`, {
      method: "GET",
      headers: {
        accept: "application/json",
        "x-chain": "solana",
        "X-API-KEY": BIRDEYE_API_KEY,
      },
      signal: controller.signal,
    });
    const bodyText = await response.text();
    if (!response.ok) {
      throw new Error(bodyText || `Birdeye request failed (${response.status})`);
    }

    return parseBirdeyeCandlesFromBody(bodyText, args.limit);
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchBirdeyeCandles(payload: ChartCandlesPayload): Promise<ChartCandlesFetchResult> {
  if (!BIRDEYE_API_KEY) {
    throw new Error("Birdeye API key is not configured");
  }
  if (payload.chainType !== "solana") {
    throw new Error("Birdeye candles are only used for Solana pairs");
  }
  if (!payload.tokenAddress) {
    throw new Error("Token address is required for Birdeye candles");
  }

  const timeframe = payload.timeframe ?? "minute";
  const aggregate = payload.aggregate ?? 5;
  const limit = payload.limit ?? 260;
  const intervalSeconds = secondsPerCandle(timeframe, aggregate);
  const timeTo = Math.floor(Date.now() / 1000);
  const timeFrom = Math.max(0, timeTo - intervalSeconds * (limit + 6));
  const type = toBirdeyeInterval(timeframe, aggregate);
  const baseParams = {
    type,
    time_from: String(timeFrom),
    time_to: String(timeTo),
  };
  const pairAddress = await resolveChartPoolAddress(payload).catch(() => null);
  const attempts: Array<{
    label: string;
    endpointPath: "/defi/v3/ohlcv/pair" | "/defi/v3/ohlcv" | "/defi/ohlcv";
    params: URLSearchParams;
  }> = [];

  if (pairAddress) {
    attempts.push({
      label: "pair-v3",
      endpointPath: "/defi/v3/ohlcv/pair",
      params: new URLSearchParams({
        address: pairAddress,
        count_limit: String(limit),
        ...baseParams,
      }),
    });
  }

  attempts.push({
    label: "token-v3",
    endpointPath: "/defi/v3/ohlcv",
    params: new URLSearchParams({
      address: payload.tokenAddress,
      address_type: "token",
      count_limit: String(limit),
      ...baseParams,
    }),
  });
  attempts.push({
    label: "token-legacy",
    endpointPath: "/defi/ohlcv",
    params: new URLSearchParams({
      address: payload.tokenAddress,
      address_type: "token",
      ...baseParams,
    }),
  });

  const errors: string[] = [];
  for (const attempt of attempts) {
    try {
      const candles = await requestBirdeyeCandles({
        endpointPath: attempt.endpointPath,
        params: attempt.params,
        limit,
      });
      if (candles.length >= 2) {
        return {
          source: "birdeye",
          network: "solana",
          candles,
        };
      }
      errors.push(`${attempt.label}: insufficient candle data`);
    } catch (error) {
      errors.push(`${attempt.label}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  throw new Error(errors.join(" | ") || "Birdeye returned insufficient candle data");
}

async function fetchBestChartCandles(payload: ChartCandlesPayload): Promise<ChartCandlesFetchResult> {
  const isSolana = payload.chainType === "solana";
  const candidates: Array<{
    source: ChartCandlesSource;
    fetcher: () => Promise<ChartCandlesFetchResult>;
  }> = [];

  if (isSolana && payload.tokenAddress && BIRDEYE_API_KEY) {
    candidates.push({
      source: "birdeye",
      fetcher: () => fetchBirdeyeCandles(payload),
    });
  }

  candidates.push({
    source: "geckoterminal",
    fetcher: () => fetchGeckoTerminalCandles(payload),
  });

  const nowMs = Date.now();
  const scored = candidates
    .map((candidate) => {
      const health = getChartCandlesSourceHealth(candidate.source);
      const score = scoreChartCandlesProvider(candidate.source, payload, nowMs);
      const inCooldown = health.cooldownUntilMs > nowMs;
      return {
        ...candidate,
        score,
        inCooldown,
      };
    })
    .sort((a, b) => b.score - a.score);

  const preferred =
    scored.length > 1 && scored.some((candidate) => !candidate.inCooldown)
      ? scored.filter((candidate) => !candidate.inCooldown)
      : scored;

  const failures: string[] = [];

  for (const candidate of preferred) {
    const startedAtMs = Date.now();
    try {
      const result = await candidate.fetcher();
      const latencyMs = Date.now() - startedAtMs;
      recordChartCandlesProviderSuccess(candidate.source, latencyMs, result);
      return result;
    } catch (error) {
      const latencyMs = Date.now() - startedAtMs;
      recordChartCandlesProviderFailure(candidate.source, latencyMs);
      const message = error instanceof Error ? error.message : String(error);
      failures.push(`${candidate.source}: ${message}`);
      console.warn("[posts/chart/candles] provider failed", {
        source: candidate.source,
        latencyMs,
        score: candidate.score,
        message,
      });
    }
  }

  if (failures.length > 0) {
    throw new Error(failures.join(" | "));
  }

  throw new Error("No chart provider available");
}

postsRouter.post(
  "/portfolio",
  requireNotBanned,
  zValidator(
    "json",
    z.object({
      walletAddress: z.string(),
      tokenMints: z.array(z.string()).max(120).optional(),
    })
  ),
  async (c) => {
    const currentUser = c.get("user");
    if (!currentUser) {
      return c.json({ error: { message: "Unauthorized", code: "UNAUTHORIZED" } }, 401);
    }

    const { walletAddress, tokenMints } = c.req.valid("json");
    const linkedWallet = await prisma.user.findUnique({
      where: { id: currentUser.id },
      select: { walletAddress: true },
    });
    if (!linkedWallet?.walletAddress) {
      return c.json(
        { error: { message: "Link a wallet before requesting portfolio data", code: "WALLET_NOT_LINKED" } },
        403
      );
    }
    if (linkedWallet.walletAddress !== walletAddress) {
      return c.json(
        { error: { message: "Portfolio access is restricted to the linked wallet owner", code: "FORBIDDEN" } },
        403
      );
    }

    const hasExplicitMints = Array.isArray(tokenMints) && tokenMints.length > 0;

    // Get trade snapshots (holdings + prices) for all mints
    const snapshots = await getWalletTradeSnapshotsForSolanaTokens({
      walletAddress,
      tokenMints,
      withPricing: hasExplicitMints,
    });

    if (!snapshots) {
      return c.json(
        { error: { message: "Failed to fetch portfolio data", code: "PORTFOLIO_FETCH_FAILED" } },
        500
      );
    }

    const portfolioMints =
      hasExplicitMints
        ? tokenMints
        : Object.keys(snapshots);

    // Enrich with metadata, but keep wallet-wide fetches bounded to avoid panel stalls.
    const metadataMints = hasExplicitMints ? portfolioMints : portfolioMints.slice(0, 40);
    const metadataEntries = await Promise.all(
      metadataMints.map(async (mint) => {
        const meta = await getHeliusTokenMetadataForMint({ mint, chainType: "solana" });
        return [mint, meta] as const;
      })
    );
    const metadataByMint = new Map(metadataEntries);

    let totalUnrealizedPnl = 0;
    let hasPnl = false;

    const positionsWithSort = portfolioMints.flatMap((mint) => {
      const snap = snapshots[mint];
      if (!snap) return [];

      const meta = metadataByMint.get(mint);
      const balance = snap.holdingAmount ?? 0;
      if (!Number.isFinite(balance) || balance <= 0) return [];
      const currentPrice =
        balance > 0 && snap.holdingUsd !== null ? snap.holdingUsd / balance : null;
      const avgEntryPrice =
        snap.boughtAmount && snap.boughtAmount > 0 && snap.boughtUsd !== null
          ? snap.boughtUsd / snap.boughtAmount
          : null;
      const costBasis = avgEntryPrice !== null ? avgEntryPrice * balance : null;
      const currentValue = snap.holdingUsd ?? 0;
      const unrealizedPnl = costBasis !== null ? currentValue - costBasis : null;
      const unrealizedPnlPercent =
        costBasis !== null && costBasis > 0
          ? Math.round(((currentValue - costBasis) / costBasis) * 10000) / 100
          : null;

      if (unrealizedPnl !== null) {
        totalUnrealizedPnl += unrealizedPnl;
        hasPnl = true;
      }

      return [
        {
          sortValue:
            Number.isFinite(currentValue) && currentValue > 0
              ? currentValue
              : Math.max(0, balance),
          position: {
            mint,
            symbol: meta?.tokenSymbol ?? null,
            name: meta?.tokenName ?? null,
            image: meta?.tokenImage ?? null,
            balance,
            avgEntryPrice: avgEntryPrice !== null ? Math.round(avgEntryPrice * 1e8) / 1e8 : null,
            currentPrice: currentPrice !== null ? Math.round(currentPrice * 1e8) / 1e8 : null,
            costBasis: costBasis !== null ? Math.round(costBasis * 100) / 100 : null,
            unrealizedPnl: unrealizedPnl !== null ? Math.round(unrealizedPnl * 100) / 100 : null,
            unrealizedPnlPercent,
          },
        },
      ];
    });
    positionsWithSort.sort((a, b) => b.sortValue - a.sortValue);
    const positions = positionsWithSort.map((entry) => entry.position);

    return c.json({
      data: {
        positions,
        totalUnrealizedPnl: hasPnl ? Math.round(totalUnrealizedPnl * 100) / 100 : null,
      },
    });
  }
);

postsRouter.post("/chart/candles", zValidator("json", ChartCandlesProxySchema), async (c) => {
  const payload = c.req.valid("json");
  const cacheKey = buildChartCandlesCacheKey(payload);
  const now = Date.now();
  const cached = chartCandlesCache.get(cacheKey);
  if (cached && cached.expiresAtMs > now) {
    return c.json({
      data: {
        source: cached.result.source,
        network: cached.result.network,
        poolAddress: payload.poolAddress ?? null,
        tokenAddress: payload.tokenAddress ?? null,
        timeframe: payload.timeframe ?? "minute",
        aggregate: payload.aggregate ?? 5,
        candles: cached.result.candles,
      },
    });
  }
  const staleCachedResult = cached && cached.staleUntilMs > now ? cached.result : null;
  if (cached && cached.staleUntilMs <= now) {
    chartCandlesCache.delete(cacheKey);
  }

  let request = chartCandlesInFlight.get(cacheKey);
  if (!request) {
    request = Promise.race<ChartCandlesFetchResult>([
      fetchBestChartCandles(payload),
      new Promise<ChartCandlesFetchResult>((_, reject) => {
        setTimeout(() => reject(new Error("Chart candles request timed out")), CHART_CANDLES_FETCH_TIMEOUT_MS);
      }),
    ]);
    chartCandlesInFlight.set(cacheKey, request);
  }

  try {
    const result = await request;
    chartCandlesCache.set(cacheKey, {
      result,
      expiresAtMs: Date.now() + CHART_CANDLES_CACHE_TTL_MS,
      staleUntilMs: Date.now() + CHART_CANDLES_STALE_FALLBACK_MS,
    });

    return c.json({
      data: {
        source: result.source,
        network: result.network,
        poolAddress: payload.poolAddress ?? null,
        tokenAddress: payload.tokenAddress ?? null,
        timeframe: payload.timeframe ?? "minute",
        aggregate: payload.aggregate ?? 5,
        candles: result.candles,
      },
    });
  } catch (error) {
    if (staleCachedResult) {
      return c.json({
        data: {
          source: staleCachedResult.source,
          network: staleCachedResult.network,
          poolAddress: payload.poolAddress ?? null,
          tokenAddress: payload.tokenAddress ?? null,
          timeframe: payload.timeframe ?? "minute",
          aggregate: payload.aggregate ?? 5,
          candles: staleCachedResult.candles,
        },
      });
    }
    const message =
      error instanceof Error ? error.message : "Failed to load chart candles";
    return c.json(
      {
        error: {
          message,
          code: "CHART_CANDLES_FAILED",
        },
      },
      502
    );
  } finally {
    const current = chartCandlesInFlight.get(cacheKey);
    if (current === request) {
      chartCandlesInFlight.delete(cacheKey);
    }
  }
});

postsRouter.post("/prices", zValidator("json", BatchPostPricesSchema), async (c) => {
  const { ids } = c.req.valid("json");
  const uniqueIds = [...new Set(ids)].slice(0, 50);
  const freshCachedEntries = await Promise.all(
    uniqueIds.map(async (id) => [id, await readPostPriceCache(id)] as const)
  );
  const payloadById = new Map<string, PostPriceResponsePayload>();
  for (const [id, cached] of freshCachedEntries) {
    if (cached) {
      payloadById.set(id, cached);
    }
  }
  const missingIds = uniqueIds.filter((id) => !payloadById.has(id));

  if (missingIds.length === 0) {
    return c.json({
      data: Object.fromEntries(
        uniqueIds.flatMap((id) => {
          const payload = payloadById.get(id);
          return payload ? [[id, payload] as const] : [];
        })
      ),
    });
  }

  let posts: PriceRoutePostRecord[] = [];
  let databaseLookupError: unknown = null;
  try {
    posts = await withPrismaRetry(
      () => prisma.post.findMany({
        where: { id: { in: missingIds } },
        select: {
          id: true,
          contractAddress: true,
          chainType: true,
          entryMcap: true,
          currentMcap: true,
          mcap1h: true,
          mcap6h: true,
          settled: true,
          settledAt: true,
          createdAt: true,
          lastMcapUpdate: true,
          trackingMode: true,
        },
      }),
      { label: "posts:prices:batch" }
    );
  } catch (error) {
    if (!isPrismaSchemaDriftError(error) && !isPrismaClientError(error)) {
      throw error;
    }
    databaseLookupError = error;
    console.warn("[posts/prices] post lookup degraded; serving cached price payloads when possible", {
      message: getErrorMessage(error),
    });
  }

  if (posts.length > 0) {
    triggerMaintenanceForStaleCandidates("prices:batch", posts);
    const resolved = await Promise.all(
      posts.map(async (post) => {
        const payload = await resolvePostPricePayload(post);
        writePostPriceCache(post.id, payload);
        return [post.id, payload] as const;
      })
    );
    for (const [id, payload] of resolved) {
      payloadById.set(id, payload);
    }
  }

  const unresolvedIds = uniqueIds.filter((id) => !payloadById.has(id));
  if (unresolvedIds.length > 0) {
    const staleCachedEntries = await Promise.all(
      unresolvedIds.map(async (id) => [id, await resolveCachedPostPricePayload(id, { allowStale: true })] as const)
    );
    for (const [id, cached] of staleCachedEntries) {
      if (cached) {
        payloadById.set(id, cached);
      }
    }
  }

  if (payloadById.size === 0 && databaseLookupError) {
    return c.json(
      {
        error: {
          message: "Post prices are temporarily unavailable. Please retry shortly.",
          code: "POST_PRICES_UNAVAILABLE",
        },
      },
      503
    );
  }

  return c.json({
    data: Object.fromEntries(
      uniqueIds.flatMap((id) => {
        const payload = payloadById.get(id);
        return payload ? [[id, payload] as const] : [];
      })
    ),
  });
});

postsRouter.get("/:id/price", async (c) => {
  const postId = c.req.param("id");

  let post: PriceRoutePostRecord | null = null;
  let lookupError: unknown = null;
  try {
    post = await prisma.post.findUnique({
      where: { id: postId },
      select: {
        id: true,
        contractAddress: true,
        chainType: true,
        entryMcap: true,
        currentMcap: true,
        mcap1h: true,
        mcap6h: true,
        settled: true,
        settledAt: true,
        createdAt: true,
        lastMcapUpdate: true,
        trackingMode: true,
      },
    });
  } catch (error) {
    if (!isPrismaSchemaDriftError(error) && !isPrismaClientError(error)) {
      throw error;
    }
    lookupError = error;
    console.warn("[posts/price] price lookup degraded; serving cached snapshot when possible", {
      postId,
      message: getErrorMessage(error),
    });
  }

  if (!post && lookupError) {
    const cachedPayload = await resolveCachedPostPricePayload(postId, { allowStale: true });
    if (cachedPayload) {
      return c.json({ data: cachedPayload });
    }
    return c.json(
      {
        error: {
          message: "Post price is temporarily unavailable. Please retry shortly.",
          code: "POST_PRICE_UNAVAILABLE",
        },
      },
      503
    );
  }

  if (!post) {
    return c.json({ error: { message: "Post not found", code: "NOT_FOUND" } }, 404);
  }

  const data = await resolvePostPricePayload(post);
  writePostPriceCache(post.id, data);
  return c.json({ data });
});
