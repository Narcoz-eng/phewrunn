import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { PublicKey } from "@solana/web3.js";
import { prisma, withPrismaRetry, isPrismaPoolPressureActive } from "../prisma.js";
import { type AuthVariables, requireAuth, requireNotBanned } from "../auth.js";
import {
  CreatePostSchema,
  PostTypeSchema,
  type PostType,
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
  getCachedMarketCapSnapshot,
  clearMarketCapSnapshotCache,
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
  getHeliusTradePanelContext,
  getHeliusTokenMetadataForMint,
  getParsedSolanaTransaction,
  isHeliusConfigured,
  type ParsedSolanaInstruction,
  type ParsedSolanaTransaction,
} from "../services/helius.js";
import {
  fetchBirdeyeRecentTrades,
  getBufferedBirdeyeLiveFeedSnapshot,
  hasBirdeyeTradeFeedConfig,
  startBirdeyeLiveFeed,
  type BirdeyeTradeFeedChain,
  type TradeFeedSnapshot,
  type TradeFeedStatus,
} from "../services/birdeye-trade-feed.js";
import {
  buildLeaderboardRefreshJobInput,
  invalidateLeaderboardCaches,
  runLeaderboardStatsRefresh,
} from "./leaderboard.js";
import { invalidateNotificationsCache } from "./notifications.js";
import { cacheGetJson, cacheSetJson } from "../lib/redis.js";
import { enqueueInternalJob, hasQStashPublishConfig, type EnqueueInternalJobInput } from "../lib/job-queue.js";
import {
  buildIntelligenceRefreshJobInput,
  computeRealtimeIntelligenceSnapshots,
  getEnrichedCallById,
  INTELLIGENCE_CALL_SELECT,
  invalidateFeedListCaches,
  refreshTokenIntelligenceByAddress,
  type IntelligenceCallRecord,
  type RealtimePostIntelligenceSnapshot,
  prewarmRecentTokenIntelligence,
} from "../services/intelligence/engine.js";
import { fanoutPostedAlphaAlert } from "../services/intelligence/alerts.js";
import { runMarketAlertScan, type MarketAlertScanResult } from "../services/marketAlerts.js";
import { broadcastAppInvalidate } from "../lib/realtime.js";

export const postsRouter = new Hono<{ Variables: AuthVariables }>();
const IS_SERVERLESS_RUNTIME =
  !!process.env.VERCEL ||
  !!process.env.AWS_LAMBDA_FUNCTION_NAME ||
  !!process.env.K_SERVICE ||
  !!process.env.FUNCTIONS_WORKER_RUNTIME;

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
  intelligenceRefresh: {
    attempted: number;
    refreshed: number;
    skipped: number;
    errors: number;
    durationMs: number;
  };
  marketAlerts: MarketAlertScanResult;
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
  confidenceScore: number | null;
  hotAlphaScore: number | null;
  earlyRunnerScore: number | null;
  highConvictionScore: number | null;
  marketHealthScore: number | null;
  setupQualityScore: number | null;
  opportunityScore: number | null;
  dataReliabilityScore: number | null;
  activityStatus: string | null;
  activityStatusLabel: string | null;
  isTradable: boolean;
  bullishSignalsSuppressed: boolean;
  roiCurrentPct: number | null;
  timingTier: string | null;
  bundleRiskLabel: string | null;
  tokenRiskScore: number | null;
  liquidity: number | null;
  volume24h: number | null;
  holderCount: number | null;
  largestHolderPct: number | null;
  top10HolderPct: number | null;
  bundledWalletCount: number | null;
  estimatedBundledSupplyPct: number | null;
  lastIntelligenceAt: string | null;
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

const POST_TYPE_PREFIX_RE = /^\[(alpha|discussion|chart|poll|raid|news)\]\s*/i;

function normalizePostType(input: unknown, hasDetectedToken: boolean): PostType {
  const parsed = PostTypeSchema.safeParse(input);
  if (parsed.success) return parsed.data;

  return hasDetectedToken ? "alpha" : "discussion";
}

function stripPostTypePrefix(content: string): string {
  return content.replace(POST_TYPE_PREFIX_RE, "").trim();
}

function normalizePostTypeField(value: unknown, hasDetectedToken: boolean): PostType {
  return normalizePostType(value, hasDetectedToken);
}

type PollSummary = {
  totalVotes: number;
  viewerOptionId: string | null;
  options: Array<{
    id: string;
    label: string;
    votes: number;
    percentage: number;
  }>;
};

type PostLikeRecord = {
  id: string;
  postType?: unknown;
  contractAddress?: string | null;
  pollExpiresAt?: Date | string | null;
  [key: string]: unknown;
};

function normalizePostApiPayload<T extends PostLikeRecord>(post: T): T & { postType: PostType; pollExpiresAt: string | null } {
  const pollExpiresAt = post.pollExpiresAt instanceof Date
    ? post.pollExpiresAt.toISOString()
    : typeof post.pollExpiresAt === "string"
      ? post.pollExpiresAt
      : null;
  return {
    ...post,
    postType: normalizePostTypeField(post.postType, Boolean(post.contractAddress)),
    pollExpiresAt,
  };
}

async function buildPollSummariesForPosts(postIds: string[], viewerUserId?: string | null): Promise<Map<string, PollSummary>> {
  if (postIds.length === 0) return new Map();

  const [options, votes, viewerVotes] = await Promise.all([
    prisma.postPollOption.findMany({
      where: { postId: { in: postIds } },
      orderBy: [{ postId: "asc" }, { sortOrder: "asc" }, { createdAt: "asc" }],
      select: { id: true, postId: true, label: true, sortOrder: true },
    }),
    prisma.postPollVote.groupBy({
      by: ["postId", "optionId"],
      where: { postId: { in: postIds } },
      _count: { _all: true },
    }),
    viewerUserId
      ? prisma.postPollVote.findMany({
          where: { postId: { in: postIds }, userId: viewerUserId },
          select: { postId: true, optionId: true },
        })
      : Promise.resolve([]),
  ]);

  const votesByOption = new Map<string, number>();
  const totalsByPost = new Map<string, number>();
  for (const row of votes) {
    const count = row._count._all;
    votesByOption.set(row.optionId, count);
    totalsByPost.set(row.postId, (totalsByPost.get(row.postId) ?? 0) + count);
  }

  const viewerVoteByPost = new Map(viewerVotes.map((vote) => [vote.postId, vote.optionId]));
  const summaries = new Map<string, PollSummary>();
  for (const option of options) {
    const totalVotes = totalsByPost.get(option.postId) ?? 0;
    const optionVotes = votesByOption.get(option.id) ?? 0;
    const current = summaries.get(option.postId) ?? {
      totalVotes,
      viewerOptionId: viewerVoteByPost.get(option.postId) ?? null,
      options: [],
    };
    current.options.push({
      id: option.id,
      label: option.label,
      votes: optionVotes,
      percentage: totalVotes > 0 ? Math.round((optionVotes / totalVotes) * 1000) / 10 : 0,
    });
    summaries.set(option.postId, current);
  }
  return summaries;
}

export async function attachPollSummaries<T extends PostLikeRecord>(posts: T[], viewerUserId?: string | null): Promise<Array<T & { postType: PostType; pollExpiresAt: string | null; poll: PollSummary | null }>> {
  const normalized = posts.map((post) => normalizePostApiPayload(post));
  const pollPostIds = normalized.filter((post) => post.postType === "poll").map((post) => post.id);
  const summaries = await buildPollSummariesForPosts(pollPostIds, viewerUserId);
  return normalized.map((post) => ({
    ...post,
    poll: post.postType === "poll" ? summaries.get(post.id) ?? { totalVotes: 0, viewerOptionId: null, options: [] } : null,
  }));
}

type PostCommunityPayload = {
  id: string;
  tokenId: string;
  xCashtag: string | null;
  token: {
    id: string;
    address: string;
    chainType: string;
    symbol: string | null;
    name: string | null;
    imageUrl: string | null;
    dexscreenerUrl: string | null;
  };
};

function serializePostCommunity(community: PostCommunityPayload | null | undefined) {
  if (!community) return null;
  return {
    id: community.id,
    tokenId: community.tokenId,
    xCashtag: community.xCashtag,
    tokenAddress: community.token.address,
    chainType: community.token.chainType,
    symbol: community.token.symbol,
    name: community.token.name,
    image: community.token.imageUrl,
    dexscreenerUrl: community.token.dexscreenerUrl,
  };
}

async function resolveCommunityPostContext(communityId: string | null | undefined, userId: string) {
  if (!communityId) return null;

  const community = await prisma.tokenCommunityProfile.findUnique({
    where: { id: communityId },
    select: {
      id: true,
      tokenId: true,
      xCashtag: true,
      token: {
        select: {
          id: true,
          address: true,
          chainType: true,
          symbol: true,
          name: true,
          imageUrl: true,
          dexscreenerUrl: true,
        },
      },
    },
  });

  if (!community) {
    throw new Error("COMMUNITY_NOT_FOUND");
  }

  const membership = await prisma.tokenFollow.findUnique({
    where: {
      userId_tokenId: {
        userId,
        tokenId: community.tokenId,
      },
    },
    select: { id: true },
  });

  if (!membership) {
    throw new Error("COMMUNITY_JOIN_REQUIRED");
  }

  return community;
}

type JobDispatchRecord = {
  jobName: EnqueueInternalJobInput["jobName"];
  idempotencyKey: string;
  mode: "queued" | "inline";
  messageId: string | null;
  deduplicated: boolean;
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

let maintenanceRunInFlight: Promise<JobDispatchRecord[]> | null = null;
let settlementRunInFlight: Promise<JobDispatchRecord> | null = null;
let lastMaintenanceRunStartedAt = 0;
let lastSettlementRunStartedAt = 0;
let lastCronMaintenanceCompletedAt = 0;
let maintenanceLoopTimer: ReturnType<typeof setInterval> | null = null;
let maintenanceLoopCanRun: (() => boolean) | null = null;
const MAINTENANCE_RUN_MIN_INTERVAL_MS = process.env.NODE_ENV === "production" ? 30_000 : 5_000;
const SETTLEMENT_RUN_MIN_INTERVAL_MS = process.env.NODE_ENV === "production" ? 20_000 : 4_000;
const BACKGROUND_MAINTENANCE_LOOP_START_DELAY_MS = process.env.NODE_ENV === "production" ? 20_000 : 6_000;
const BACKGROUND_MAINTENANCE_LOOP_INTERVAL_MS = process.env.NODE_ENV === "production" ? 60_000 : 15_000;
const CRON_MAINTENANCE_HEALTH_WINDOW_MS =
  process.env.NODE_ENV === "production" ? 3 * 60_000 : 20_000;
const MAINTENANCE_STALE_PROBE_COOLDOWN_MS =
  process.env.NODE_ENV === "production" ? 25_000 : 5_000;
const priceRefreshInFlight = new Map<string, Promise<number | null>>();
const TRENDING_CACHE_TTL_MS = process.env.NODE_ENV === "production" ? 30_000 : 10_000;
const TRENDING_LIVE_GAIN_PRIORITY_PCT = process.env.NODE_ENV === "production" ? 25 : 15;
let trendingCache: { data: unknown; expiresAtMs: number } | null = null;
let trendingInFlight: Promise<unknown> | null = null;
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
const POST_PRICE_CACHE_TTL_MS = process.env.NODE_ENV === "production" ? 18_000 : 4_000;
const POST_PRICE_LIVE_INTELLIGENCE_REFRESH_INTERVAL_MS =
  process.env.NODE_ENV === "production" ? 5 * 60_000 : 60_000;
const POST_PRICE_ACTIVE_STALE_FALLBACK_MS =
  process.env.NODE_ENV === "production" ? 75_000 : 20_000;
const POST_PRICE_SETTLED_STALE_FALLBACK_MS =
  process.env.NODE_ENV === "production" ? 10 * 60_000 : 2 * 60_000;
const POST_PRICE_CACHE_MAX_ENTRIES = process.env.NODE_ENV === "production" ? 40_000 : 4_000;
const POST_PRICE_REDIS_KEY_PREFIX = "posts:price:v1";
const POST_PRICE_ENABLE_LIVE_INTELLIGENCE_REFRESH = (() => {
  const raw = process.env.POSTS_ENABLE_LIVE_PRICE_INTELLIGENCE?.trim().toLowerCase();
  if (raw === "true") return true;
  if (raw === "false") return false;
  return !(process.env.NODE_ENV === "production" && IS_SERVERLESS_RUNTIME);
})();
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
const postDetailResponseCache = new Map<
  string,
  {
    data: Record<string, unknown>;
    expiresAtMs: number;
    staleUntilMs: number;
  }
>();
const postDetailInFlight = new Map<string, Promise<Record<string, unknown>>>();
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
const postPriceResponseInFlight = new Map<
  string,
  Promise<
    | { state: "ok"; data: PostPriceResponsePayload }
    | { state: "not_found" }
    | { state: "unavailable" }
  >
>();
const hasCronMaintenanceConfigured = !!process.env.CRON_SECRET?.trim();
const POST_DETAIL_CACHE_TTL_MS = process.env.NODE_ENV === "production" ? 20_000 : 5_000;
const POST_DETAIL_STALE_FALLBACK_MS = process.env.NODE_ENV === "production" ? 2 * 60_000 : 30_000;
let feedDegradedCircuitState: {
  openUntilMs: number;
  openedAtMs: number;
  reason: string;
} | null = null;
const opportunisticMaintenanceEnabled = (() => {
  const raw = process.env.POSTS_ENABLE_OPPORTUNISTIC_MAINTENANCE?.trim().toLowerCase();
  if (raw === "true") return true;
  if (raw === "false") return false;
  return !(process.env.NODE_ENV === "production" && IS_SERVERLESS_RUNTIME);
})();
const organicSettlementWakeupsEnabled = (() => {
  const raw = process.env.POSTS_ENABLE_ORGANIC_SETTLEMENTS?.trim().toLowerCase();
  if (raw === "true") return true;
  if (raw === "false") return false;
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

function shouldRunOrganicSettlementWakeups(): boolean {
  return organicSettlementWakeupsEnabled;
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
  if (!shouldRunOrganicSettlementWakeups()) return;
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
  postType?: PostType;
}): string {
  return [
    params.userId ?? "anon",
    params.sort,
    params.following ? "following" : "all",
    String(params.limit),
    params.cursor ?? "",
    (params.search ?? "").trim().toLowerCase(),
    params.postType ?? "all-types",
  ].join(":");
}

function buildFeedSharedResponseCacheKey(params: {
  sort: "latest" | "trending";
  following: boolean;
  limit: number;
  cursor?: string;
  search?: string;
  postType?: PostType;
}): string {
  return [
    params.sort,
    params.following ? "following" : "all",
    String(params.limit),
    params.cursor ?? "",
    (params.search ?? "").trim().toLowerCase(),
    params.postType ?? "all-types",
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

function readPostDetailCache(postId: string, opts?: { allowStale?: boolean }): Record<string, unknown> | null {
  const cached = postDetailResponseCache.get(postId);
  if (!cached) return null;
  const nowMs = Date.now();
  if (cached.expiresAtMs > nowMs) {
    return { ...cached.data };
  }
  if (opts?.allowStale && cached.staleUntilMs > nowMs) {
    return { ...cached.data };
  }
  postDetailResponseCache.delete(postId);
  return null;
}

function writePostDetailCache(postId: string, data: Record<string, unknown>): void {
  postDetailResponseCache.set(postId, {
    data: { ...data },
    expiresAtMs: Date.now() + POST_DETAIL_CACHE_TTL_MS,
    staleUntilMs: Date.now() + POST_DETAIL_STALE_FALLBACK_MS,
  });
}

function invalidatePostDetailCache(postId: string): void {
  postDetailResponseCache.delete(postId);
  postDetailInFlight.delete(postId);
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
  const confidenceScore =
    typeof candidate.confidenceScore === "number" ? candidate.confidenceScore : null;
  const hotAlphaScore =
    typeof candidate.hotAlphaScore === "number" ? candidate.hotAlphaScore : null;
  const earlyRunnerScore =
    typeof candidate.earlyRunnerScore === "number" ? candidate.earlyRunnerScore : null;
  const highConvictionScore =
    typeof candidate.highConvictionScore === "number" ? candidate.highConvictionScore : null;
  const marketHealthScore =
    typeof candidate.marketHealthScore === "number" ? candidate.marketHealthScore : null;
  const setupQualityScore =
    typeof candidate.setupQualityScore === "number" ? candidate.setupQualityScore : null;
  const opportunityScore =
    typeof candidate.opportunityScore === "number" ? candidate.opportunityScore : null;
  const dataReliabilityScore =
    typeof candidate.dataReliabilityScore === "number" ? candidate.dataReliabilityScore : null;
  const activityStatus =
    typeof candidate.activityStatus === "string" ? candidate.activityStatus : null;
  const activityStatusLabel =
    typeof candidate.activityStatusLabel === "string" ? candidate.activityStatusLabel : null;
  const isTradable = candidate.isTradable === true;
  const bullishSignalsSuppressed = candidate.bullishSignalsSuppressed === true;
  const roiCurrentPct =
    typeof candidate.roiCurrentPct === "number" ? candidate.roiCurrentPct : null;
  const timingTier =
    typeof candidate.timingTier === "string" ? candidate.timingTier : null;
  const bundleRiskLabel =
    typeof candidate.bundleRiskLabel === "string" ? candidate.bundleRiskLabel : null;
  const tokenRiskScore =
    typeof candidate.tokenRiskScore === "number" ? candidate.tokenRiskScore : null;
  const liquidity = typeof candidate.liquidity === "number" ? candidate.liquidity : null;
  const volume24h = typeof candidate.volume24h === "number" ? candidate.volume24h : null;
  const holderCount = typeof candidate.holderCount === "number" ? candidate.holderCount : null;
  const largestHolderPct =
    typeof candidate.largestHolderPct === "number" ? candidate.largestHolderPct : null;
  const top10HolderPct =
    typeof candidate.top10HolderPct === "number" ? candidate.top10HolderPct : null;
  const bundledWalletCount =
    typeof candidate.bundledWalletCount === "number" ? candidate.bundledWalletCount : null;
  const estimatedBundledSupplyPct =
    typeof candidate.estimatedBundledSupplyPct === "number"
      ? candidate.estimatedBundledSupplyPct
      : null;
  const lastIntelligenceAt =
    typeof candidate.lastIntelligenceAt === "string" ? candidate.lastIntelligenceAt : null;
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
    confidenceScore,
    hotAlphaScore,
    earlyRunnerScore,
    highConvictionScore,
    marketHealthScore,
    setupQualityScore,
    opportunityScore,
    dataReliabilityScore,
    activityStatus,
    activityStatusLabel,
    isTradable,
    bullishSignalsSuppressed,
    roiCurrentPct,
    timingTier,
    bundleRiskLabel,
    tokenRiskScore,
    liquidity,
    volume24h,
    holderCount,
    largestHolderPct,
    top10HolderPct,
    bundledWalletCount,
    estimatedBundledSupplyPct,
    lastIntelligenceAt,
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
    if (!opts?.allowStale && hasSuspiciousSettledBaselineCurrentMcap(cached.data)) {
      postPriceResponseCache.delete(postId);
    } else {
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
  }

  const redisRaw = await cacheGetJson<unknown>(buildPostPriceRedisKey(postId));
  const redisEnvelope = normalizePostPriceCacheEnvelope(redisRaw);
  const redisCached = redisEnvelope?.data ?? normalizePostPricePayload(redisRaw);
  if (!redisCached) {
    return null;
  }
  if (!opts?.allowStale && hasSuspiciousSettledBaselineCurrentMcap(redisCached)) {
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
    | Pick<PostPriceResponsePayload, "lastMcapUpdate" | "settledAt" | "lastIntelligenceAt">
    | {
        lastMcapUpdate?: string | null;
        settledAt?: string | null;
        lastIntelligenceAt?: string | null;
        createdAt?: string | Date | null;
      }
    | null
    | undefined
): number {
  if (!payload) return 0;

  const createdAt =
    "createdAt" in payload ? parseCachedDate(payload.createdAt)?.getTime() ?? 0 : 0;

  return Math.max(
    parseCachedDate(payload.lastMcapUpdate)?.getTime() ?? 0,
    parseCachedDate(payload.settledAt)?.getTime() ?? 0,
    parseCachedDate(payload.lastIntelligenceAt)?.getTime() ?? 0,
    createdAt
  );
}

function getPostPriceIntelligenceVersion(
  payload: Pick<
    PostPriceResponsePayload,
    | "lastIntelligenceAt"
    | "confidenceScore"
    | "hotAlphaScore"
    | "earlyRunnerScore"
    | "highConvictionScore"
    | "roiCurrentPct"
    | "timingTier"
    | "bundleRiskLabel"
    | "tokenRiskScore"
    | "liquidity"
    | "volume24h"
    | "holderCount"
    | "largestHolderPct"
    | "top10HolderPct"
    | "bundledWalletCount"
    | "estimatedBundledSupplyPct"
  > | null | undefined
): number {
  if (!payload) return 0;
  const timestamp = parseCachedDate(payload.lastIntelligenceAt)?.getTime() ?? 0;
  if (timestamp > 0) {
    return timestamp;
  }

  const hasResolvedIntelligence =
    payload.confidenceScore !== null ||
    payload.hotAlphaScore !== null ||
    payload.earlyRunnerScore !== null ||
    payload.highConvictionScore !== null ||
    payload.roiCurrentPct !== null ||
    payload.timingTier !== null ||
    payload.bundleRiskLabel !== null ||
    payload.tokenRiskScore !== null ||
    payload.liquidity !== null ||
    payload.volume24h !== null ||
    payload.holderCount !== null ||
    payload.largestHolderPct !== null ||
    payload.top10HolderPct !== null ||
    payload.bundledWalletCount !== null ||
    payload.estimatedBundledSupplyPct !== null;

  return hasResolvedIntelligence ? Date.now() : 0;
}

function mergePostPricePayloadWithFresherIntelligence(
  payload: PostPriceResponsePayload,
  cachedPayload: PostPriceResponsePayload | null | undefined
): PostPriceResponsePayload {
  if (!cachedPayload) {
    return payload;
  }

  const payloadIntelligenceVersion = getPostPriceIntelligenceVersion(payload);
  const cachedIntelligenceVersion = getPostPriceIntelligenceVersion(cachedPayload);

  if (cachedIntelligenceVersion <= payloadIntelligenceVersion) {
    return payload;
  }

  return {
    ...payload,
    confidenceScore: cachedPayload.confidenceScore,
    hotAlphaScore: cachedPayload.hotAlphaScore,
    earlyRunnerScore: cachedPayload.earlyRunnerScore,
    highConvictionScore: cachedPayload.highConvictionScore,
    roiCurrentPct: cachedPayload.roiCurrentPct,
    timingTier: cachedPayload.timingTier,
    bundleRiskLabel: cachedPayload.bundleRiskLabel,
    tokenRiskScore: cachedPayload.tokenRiskScore,
    liquidity: cachedPayload.liquidity,
    volume24h: cachedPayload.volume24h,
    holderCount: cachedPayload.holderCount,
    largestHolderPct: cachedPayload.largestHolderPct,
    top10HolderPct: cachedPayload.top10HolderPct,
    bundledWalletCount: cachedPayload.bundledWalletCount,
    estimatedBundledSupplyPct: cachedPayload.estimatedBundledSupplyPct,
    lastIntelligenceAt: cachedPayload.lastIntelligenceAt,
  };
}

function shouldRefreshPostPriceIntelligence(
  payload: PostPriceResponsePayload | null | undefined,
  nowMs: number
): boolean {
  const intelligenceVersion = getPostPriceIntelligenceVersion(payload);
  if (intelligenceVersion <= 0) {
    return true;
  }

  return nowMs - intelligenceVersion >= POST_PRICE_LIVE_INTELLIGENCE_REFRESH_INTERVAL_MS;
}

function preserveNewerDynamicStateFields(
  target: Record<string, unknown>,
  source: Record<string, unknown>
): Record<string, unknown> {
  const merged = { ...target };
  const dynamicStateKeys = [
    "currentMcap",
    "settled",
    "settledAt",
    "mcap1h",
    "mcap6h",
    "isWin",
    "lastMcapUpdate",
    "trackingMode",
    "confidenceScore",
    "hotAlphaScore",
    "earlyRunnerScore",
    "highConvictionScore",
    "roiCurrentPct",
    "timingTier",
    "bundleRiskLabel",
    "tokenRiskScore",
    "liquidity",
    "volume24h",
    "holderCount",
    "largestHolderPct",
    "top10HolderPct",
    "bundledWalletCount",
    "estimatedBundledSupplyPct",
    "lastIntelligenceAt",
  ] as const;

  for (const key of dynamicStateKeys) {
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
    return preserveNewerDynamicStateFields(merged, existingSnapshot);
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
      confidenceScore: existingPayload.confidenceScore,
      hotAlphaScore: existingPayload.hotAlphaScore,
      earlyRunnerScore: existingPayload.earlyRunnerScore,
      highConvictionScore: existingPayload.highConvictionScore,
      roiCurrentPct: existingPayload.roiCurrentPct,
      timingTier: existingPayload.timingTier,
      bundleRiskLabel: existingPayload.bundleRiskLabel,
      tokenRiskScore: existingPayload.tokenRiskScore,
      liquidity: existingPayload.liquidity,
      volume24h: existingPayload.volume24h,
      holderCount: existingPayload.holderCount,
      largestHolderPct: existingPayload.largestHolderPct,
      top10HolderPct: existingPayload.top10HolderPct,
      bundledWalletCount: existingPayload.bundledWalletCount,
      estimatedBundledSupplyPct: existingPayload.estimatedBundledSupplyPct,
      lastIntelligenceAt: existingPayload.lastIntelligenceAt,
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
    confidenceScore: post.confidenceScore ?? null,
    hotAlphaScore: post.hotAlphaScore ?? null,
    earlyRunnerScore: post.earlyRunnerScore ?? null,
    highConvictionScore: post.highConvictionScore ?? null,
    marketHealthScore: post.marketHealthScore ?? null,
    setupQualityScore: post.setupQualityScore ?? null,
    opportunityScore: post.opportunityScore ?? null,
    dataReliabilityScore: post.dataReliabilityScore ?? null,
    activityStatus: post.activityStatus ?? null,
    activityStatusLabel: post.activityStatusLabel ?? null,
    isTradable: post.isTradable === true,
    bullishSignalsSuppressed: post.bullishSignalsSuppressed === true,
    roiCurrentPct: post.roiCurrentPct ?? null,
    timingTier: post.timingTier ?? null,
    bundleRiskLabel: post.bundleRiskLabel ?? null,
    tokenRiskScore: post.tokenRiskScore ?? null,
    liquidity: post.liquidity ?? null,
    volume24h: post.volume24h ?? null,
    holderCount: post.holderCount ?? null,
    largestHolderPct: post.largestHolderPct ?? null,
    top10HolderPct: post.top10HolderPct ?? null,
    bundledWalletCount: post.bundledWalletCount ?? null,
    estimatedBundledSupplyPct: post.estimatedBundledSupplyPct ?? null,
    lastIntelligenceAt: post.lastIntelligenceAt?.toISOString() ?? null,
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
    confidenceScore: toNullableNumber(candidate.confidenceScore),
    hotAlphaScore: toNullableNumber(candidate.hotAlphaScore),
    earlyRunnerScore: toNullableNumber(candidate.earlyRunnerScore),
    highConvictionScore: toNullableNumber(candidate.highConvictionScore),
    marketHealthScore: toNullableNumber(candidate.marketHealthScore),
    setupQualityScore: toNullableNumber(candidate.setupQualityScore),
    opportunityScore: toNullableNumber(candidate.opportunityScore),
    dataReliabilityScore: toNullableNumber(candidate.dataReliabilityScore),
    activityStatus: typeof candidate.activityStatus === "string" ? candidate.activityStatus : null,
    activityStatusLabel:
      typeof candidate.activityStatusLabel === "string" ? candidate.activityStatusLabel : null,
    isTradable: candidate.isTradable === true,
    bullishSignalsSuppressed: candidate.bullishSignalsSuppressed === true,
    roiCurrentPct: toNullableNumber(candidate.roiCurrentPct),
    timingTier: typeof candidate.timingTier === "string" ? candidate.timingTier : null,
    bundleRiskLabel:
      typeof candidate.bundleRiskLabel === "string" ? candidate.bundleRiskLabel : null,
    tokenRiskScore: toNullableNumber(candidate.tokenRiskScore),
    liquidity: toNullableNumber(candidate.liquidity),
    volume24h: toNullableNumber(candidate.volume24h),
    holderCount: toNullableNumber(candidate.holderCount),
    largestHolderPct: toNullableNumber(candidate.largestHolderPct),
    top10HolderPct: toNullableNumber(candidate.top10HolderPct),
    bundledWalletCount: toNullableNumber(candidate.bundledWalletCount),
    estimatedBundledSupplyPct: toNullableNumber(candidate.estimatedBundledSupplyPct),
    lastIntelligenceAt: parseCachedDate(candidate.lastIntelligenceAt),
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
    const cachedPost = findCachedFeedPostPriceRecord(postId);
    if (cachedPost) {
      triggerMaintenanceForStaleCandidates("price:cached", [cachedPost]);
    }
    return cachedPayload;
  }

  const cachedPost = findCachedFeedPostPriceRecord(postId);
  if (!cachedPost) {
    return null;
  }

  triggerMaintenanceForStaleCandidates("price:feed-cache", [cachedPost]);
  const payload = buildPostPricePayloadFromRecord(cachedPost);
  writePostPriceCache(postId, payload);
  return payload;
}

async function loadPostPricePayload(
  postId: string
): Promise<
  | { state: "ok"; data: PostPriceResponsePayload }
  | { state: "not_found" }
  | { state: "unavailable" }
> {
  const cachedPayload = await resolveCachedPostPricePayload(postId);
  if (cachedPayload) {
    return { state: "ok", data: cachedPayload };
  }

  const existingRequest = postPriceResponseInFlight.get(postId);
  if (existingRequest) {
    return await existingRequest;
  }

  if (await isPrismaPoolPressureActive()) {
    const stalePayload = await resolveCachedPostPricePayload(postId, { allowStale: true });
    return stalePayload
      ? ({ state: "ok", data: stalePayload } as const)
      : ({ state: "unavailable" } as const);
  }

  const request: Promise<
    | { state: "ok"; data: PostPriceResponsePayload }
    | { state: "not_found" }
    | { state: "unavailable" }
  > = (async () => {
      let post: IntelligenceCallRecord | null = null;
      let lookupError: unknown = null;
      try {
        post = await prisma.post.findUnique({
          where: { id: postId },
          select: INTELLIGENCE_CALL_SELECT,
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
        const stalePayload = await resolveCachedPostPricePayload(postId, { allowStale: true });
        return stalePayload
          ? ({ state: "ok", data: stalePayload } as const)
          : ({ state: "unavailable" } as const);
      }

      if (!post) {
        return { state: "not_found" } as const;
      }

      triggerMaintenanceForStaleCandidates("price:single", [post]);
      const payloadById = new Map([[post.id, await resolvePostPricePayload(post)]]);
      await attachRealtimeIntelligenceToPostPricePayloads([post], payloadById, "single");
      const data = payloadById.get(post.id)!;
      writePostPriceCache(post.id, data);
      return { state: "ok", data } as const;
    })().finally(() => {
      const current = postPriceResponseInFlight.get(postId);
      if (current === request) {
        postPriceResponseInFlight.delete(postId);
      }
    });
  postPriceResponseInFlight.set(postId, request);

  return await request;
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
    postType: "alpha",
    pollExpiresAt: null,
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
              postType: true,
              pollExpiresAt: true,
              authorId: true,
              communityId: true,
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
              community: {
                select: {
                  id: true,
                  tokenId: true,
                  xCashtag: true,
                  token: {
                    select: {
                      id: true,
                      address: true,
                      chainType: true,
                      symbol: true,
                      name: true,
                      imageUrl: true,
                      dexscreenerUrl: true,
                    },
                  },
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
            postType: true,
            pollExpiresAt: true,
            authorId: true,
            communityId: true,
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
          postType: "alpha",
          pollExpiresAt: null,
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
          postType: "alpha",
          pollExpiresAt: null,
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
    postType: row.postType ?? "alpha",
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
    pollExpiresAt: row.pollExpiresAt ?? null,
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
      postType: string | null;
      pollExpiresAt: Date | null;
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
        p."postType",
        p."pollExpiresAt",
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
    postType: row.postType ?? "alpha",
    pollExpiresAt: row.pollExpiresAt ?? null,
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

export function invalidatePostReadCaches(options?: { leaderboard?: boolean }): void {
  feedResponseCache.clear();
  feedSharedResponseCache.clear();
  invalidateFeedListCaches();
  clearMarketCapSnapshotCache();
  sharedAlphaAuthorCache.clear();
  sharedAlphaWarmInFlight.clear();
  sharedAlphaResponseCache.clear();
  feedCardSnapshotCache.clear();
  postDetailResponseCache.clear();
  postDetailInFlight.clear();
  trendingCache = null;
  trendingInFlight = null;
  feedTotalPostCountCache = null;

  if (options?.leaderboard) {
    invalidateLeaderboardCaches();
  }

  broadcastAppInvalidate([
    "feed",
    "leaderboard",
    "profiles",
    "profile-performance",
    "user-posts",
    "token-page",
  ]);
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
const CHART_CANDLES_CACHE_TTL_MS = process.env.NODE_ENV === "production" ? 45_000 : 30_000;
const CHART_CANDLES_STALE_FALLBACK_MS = process.env.NODE_ENV === "production" ? 5 * 60_000 : 60_000;
const CHART_CANDLES_FETCH_TIMEOUT_MS = process.env.NODE_ENV === "production" ? 4_200 : 6_000;
const CHART_TRADES_CACHE_TTL_MS = process.env.NODE_ENV === "production" ? 30_000 : 15_000;
const CHART_TRADES_STALE_FALLBACK_MS = process.env.NODE_ENV === "production" ? 3 * 60_000 : 60_000;
const TRADE_PANEL_CONTEXT_CACHE_TTL_MS = process.env.NODE_ENV === "production" ? 8_000 : 2_500;
const CHART_LIVE_STREAM_MAX_DURATION_MS = process.env.NODE_ENV === "production" ? 240_000 : 90_000;
const CHART_LIVE_STREAM_KEEPALIVE_MS = 15_000;
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
const TOKEN_PAGE_DIRECT_PLATFORM_FEE_BPS = 50; // 0.50% platform-only fee for token-page direct trades
const DEFAULT_POSTER_TRADE_FEE_SHARE_BPS = 50;
const MAX_POSTER_TRADE_FEE_SHARE_BPS = 50; // max 0.50% effective creator fee
const BIRDEYE_API_KEY = process.env.BIRDEYE_API_KEY?.trim() || "";
const JUPITER_PLATFORM_FEE_ACCOUNT =
  process.env.JUPITER_PLATFORM_FEE_ACCOUNT?.trim() || PLATFORM_FEE_ACCOUNT_FALLBACK;
type TradeAttributionType = "token_page_direct" | "post_attributed";
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
const chartTradesCache = new Map<string, { trades: Awaited<ReturnType<typeof fetchBirdeyeRecentTrades>>; expiresAtMs: number; staleUntilMs: number }>();
const chartTradesInFlight = new Map<string, Promise<Awaited<ReturnType<typeof fetchBirdeyeRecentTrades>>>>();
const chartTradesBackoffUntil = new Map<string, number>();
const tradePanelContextCache = new Map<string, { data: Awaited<ReturnType<typeof getHeliusTradePanelContext>>; expiresAtMs: number }>();
const tradePanelContextInFlight = new Map<string, Promise<Awaited<ReturnType<typeof getHeliusTradePanelContext>>>>();
const chartPoolAddressCache = new Map<string, { poolAddress: string | null; expiresAtMs: number }>();
const chartPoolAddressInFlight = new Map<string, Promise<string | null>>();
const chartCandlesSourceHealth = new Map<ChartCandlesSource, ChartCandlesSourceHealth>();

function normalizeTradeAttributionType(value: string | null | undefined): TradeAttributionType {
  return value === "token_page_direct" ? "token_page_direct" : "post_attributed";
}

function getActivePlatformFeeBps(attributionType: TradeAttributionType = "post_attributed"): number {
  if (!JUPITER_PLATFORM_FEE_ACCOUNT) return 0;
  return attributionType === "token_page_direct"
    ? TOKEN_PAGE_DIRECT_PLATFORM_FEE_BPS
    : FIXED_PLATFORM_FEE_BPS;
}

function clampPosterFeeShareBps(value: number | null | undefined): number {
  if (!Number.isFinite(value)) return DEFAULT_POSTER_TRADE_FEE_SHARE_BPS;
  return Math.min(MAX_POSTER_TRADE_FEE_SHARE_BPS, Math.max(0, Math.round(Number(value))));
}

function hasCreatorFeePayoutAddress(author: {
  walletAddress?: string | null;
  tradeFeePayoutAddress?: string | null;
} | null | undefined): boolean {
  return Boolean(
    (typeof author?.tradeFeePayoutAddress === "string" && author.tradeFeePayoutAddress.trim()) ||
      (typeof author?.walletAddress === "string" && author.walletAddress.trim())
  );
}

function isCreatorFeeEligible(author: {
  walletAddress?: string | null;
  tradeFeeRewardsEnabled?: boolean;
  tradeFeePayoutAddress?: string | null;
} | null | undefined): boolean {
  return Boolean(author?.tradeFeeRewardsEnabled !== false && hasCreatorFeePayoutAddress(author));
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
      getCachedMarketCapSnapshot(params.address, params.chainType).catch((error) => {
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
  postType: PostType;
  pollExpiresAt: Date | string | null;
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
    postType: params.postType,
    pollExpiresAt: params.pollExpiresAt instanceof Date ? params.pollExpiresAt.toISOString() : params.pollExpiresAt,
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
  postType: PostType;
  pollExpiresAt: Date | null;
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
      "postType",
      "authorId",
      "contractAddress",
      "chainType",
      "entryMcap",
      "currentMcap",
      "pollExpiresAt",
      "createdAt",
      "updatedAt"
    ) VALUES (
      ${id},
      ${params.content},
      ${params.postType},
      ${params.authorId},
      ${params.contractAddress},
      ${params.chainType},
      ${params.entryMcap},
      ${params.currentMcap},
      ${params.pollExpiresAt},
      ${now},
      ${now}
    )
  `);

  return buildCreatePostResponse({
    id,
    content: params.content,
    postType: params.postType,
    pollExpiresAt: params.pollExpiresAt,
    authorId: params.authorId,
    contractAddress: params.contractAddress,
    chainType: params.chainType,
    entryMcap: params.entryMcap,
    currentMcap: params.currentMcap,
    tokenName: params.tokenName,
    tokenSymbol: params.tokenSymbol,
    tokenImage: params.tokenImage,
    dexscreenerUrl: params.dexscreenerUrl,
    trackingMode: params.contractAddress ? TRACKING_MODE_ACTIVE : null,
    lastMcapUpdate: params.contractAddress ? now : null,
    createdAt: now,
    author: params.author,
  });
}

export async function runNewPostFollowerFanout(params: {
  authorId: string;
  authorName: string;
  authorUsername: string | null;
  postId: string;
}): Promise<void> {
  const followerIds = await listFollowerIdsSafely({
    followingId: params.authorId,
    operation: "new_post_follower_lookup",
  });

  if (followerIds.length === 0) {
    return;
  }

  const alertPreferences = await prisma.alertPreference.findMany({
    where: {
      userId: { in: followerIds },
    },
    select: {
      userId: true,
      notifyFollowedTraders: true,
    },
  });
  const disabledFollowerIds = new Set(
    alertPreferences
      .filter((pref) => pref.notifyFollowedTraders === false)
      .map((pref) => pref.userId)
  );
  const optedInFollowerIds = followerIds.filter((followerId) => !disabledFollowerIds.has(followerId));
  if (optedInFollowerIds.length === 0) {
    return;
  }

  const displayName = params.authorUsername || params.authorName || "A trader";
  await createManyNotificationsSafely({
    operation: "new_post_follower_notification",
    data: optedInFollowerIds.map((followerId) => ({
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
    fallbackData: optedInFollowerIds.map((followerId) => ({
      userId: followerId,
      type: "new_post",
      message: `${displayName} just posted a new Alpha!`,
      postId: params.postId,
      fromUserId: params.authorId,
    })),
  });
}

export async function runPostCreateFanout(params: {
  authorId: string;
  authorName: string;
  authorUsername: string | null;
  postId: string;
}): Promise<void> {
  await runNewPostFollowerFanout(params);

  const enrichedCall = await getEnrichedCallById(params.postId, params.authorId);
  if (!enrichedCall) {
    return;
  }

  await fanoutPostedAlphaAlert({
    postId: enrichedCall.id,
    authorId: params.authorId,
    authorLabel: params.authorUsername ? `@${params.authorUsername}` : params.authorName,
    tokenId: enrichedCall.tokenId,
    tokenSymbol: enrichedCall.tokenSymbol,
    confidenceScore: enrichedCall.confidenceScore,
    liquidity: enrichedCall.liquidity,
    entryMcap: enrichedCall.entryMcap,
    estimatedBundledSupplyPct: enrichedCall.estimatedBundledSupplyPct,
  });
}

function queuePostCreateFanout(params: {
  authorId: string;
  authorName: string;
  authorUsername: string | null;
  postId: string;
}): void {
  const runInlineFallback = () => {
    void runPostCreateFanout(params).catch((error) => {
      console.warn("[posts/create] post fanout failed", {
        message: getErrorMessage(error),
      });
    });
  };

  if (!hasQStashPublishConfig()) {
    runInlineFallback();
    return;
  }

  void enqueueInternalJob({
    jobName: "post_fanout",
    idempotencyKey: `post-fanout:${params.postId}`,
    payload: params,
  }).catch((error) => {
    console.warn("[posts/create] queue publish failed; falling back to inline fanout", {
      message: getErrorMessage(error),
      postId: params.postId,
    });
    runInlineFallback();
  });
}

function queuePostCreateIntelligenceRefresh(params: {
  postId: string;
  contractAddress: string | null;
}): void {
  const contractAddress = params.contractAddress?.trim().toLowerCase() ?? null;
  if (!contractAddress) {
    return;
  }

  const runInlineFallback = () => {
    void runIntelligenceRefreshJob({ contractAddress }).catch((error) => {
      console.warn("[posts/create] targeted intelligence refresh failed", {
        message: getErrorMessage(error),
        postId: params.postId,
        contractAddress,
      });
    });
  };

  if (!hasQStashPublishConfig()) {
    runInlineFallback();
    return;
  }

  void enqueueInternalJob(
    buildIntelligenceRefreshJobInput({
      reason: "post_create",
      scope: `post-create:${params.postId}`,
      contractAddress,
    })
  ).catch((error) => {
    console.warn("[posts/create] queue publish failed; falling back to inline intelligence refresh", {
      message: getErrorMessage(error),
      postId: params.postId,
      contractAddress,
    });
    runInlineFallback();
  });
}

export function buildPostAutoSettlementJobInput(params: {
  postId: string;
  createdAt: Date;
}): EnqueueInternalJobInput {
  return buildSettlementJobInput({
    reason: "post_create_1h_deadline",
    postId: params.postId,
    notBeforeAt: new Date(params.createdAt.getTime() + SETTLEMENT_1H_MS),
  });
}

function queuePostCreateSettlement(params: {
  postId: string;
  createdAt: Date;
}): void {
  const scheduledFor = new Date(params.createdAt.getTime() + SETTLEMENT_1H_MS);
  const runInlineFallback = () => {
    if (IS_SERVERLESS_RUNTIME) {
      console.warn("[posts/create] delayed settlement fallback unavailable on serverless runtime", {
        postId: params.postId,
        scheduledFor: scheduledFor.toISOString(),
      });
      return;
    }

    const delayMs = Math.max(0, scheduledFor.getTime() - Date.now());
    setTimeout(() => {
      void runSettlementJob({ postId: params.postId }).catch((error) => {
        console.warn("[posts/create] delayed inline settlement failed", {
          message: getErrorMessage(error),
          postId: params.postId,
        });
      });
    }, delayMs);
  };

  if (!hasQStashPublishConfig()) {
    runInlineFallback();
    return;
  }

  void enqueueInternalJob(buildPostAutoSettlementJobInput(params)).catch((error) => {
    console.warn("[posts/create] queue publish failed; falling back to delayed inline settlement", {
      message: getErrorMessage(error),
      postId: params.postId,
      scheduledFor: scheduledFor.toISOString(),
    });
    runInlineFallback();
  });
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

async function getFeedMarketCapSnapshot(
  address: string,
  chainType?: string | null
): Promise<MarketCapResult> {
  return getCachedMarketCapSnapshot(address, chainType);
}

type ResolvedPostMarketCapSnapshot = {
  mcap: number | null;
  source: "live_snapshot" | "persisted_current" | "persisted_1h" | "unavailable";
  snapshot: MarketCapResult;
};

function isPositiveMarketCap(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

async function resolveBestAvailablePostMarketCap(params: {
  contractAddress: string;
  chainType?: string | null;
  currentMcap?: number | null;
  mcap1h?: number | null;
}): Promise<ResolvedPostMarketCapSnapshot> {
  const snapshot = await getFeedMarketCapSnapshot(params.contractAddress, params.chainType);
  if (isPositiveMarketCap(snapshot.mcap)) {
    return {
      mcap: snapshot.mcap,
      source: "live_snapshot",
      snapshot,
    };
  }

  if (isPositiveMarketCap(params.currentMcap)) {
    return {
      mcap: params.currentMcap,
      source: "persisted_current",
      snapshot,
    };
  }

  if (isPositiveMarketCap(params.mcap1h)) {
    return {
      mcap: params.mcap1h,
      source: "persisted_1h",
      snapshot,
    };
  }

  return {
    mcap: null,
    source: "unavailable",
    snapshot,
  };
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

async function findPostToSettle1hById(postId: string): Promise<OneHourSettlementCandidate | null> {
  const row = await prisma.post.findUnique({
    where: { id: postId },
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
      settled: true,
      author: {
        select: {
          name: true,
          username: true,
        },
      },
    },
  });

  if (!row || row.settled || !row.contractAddress || row.entryMcap === null || row.entryMcap <= 0) {
    return null;
  }

  return {
    id: row.id,
    authorId: row.authorId,
    contractAddress: row.contractAddress,
    chainType: row.chainType,
    createdAt: row.createdAt,
    entryMcap: row.entryMcap,
    currentMcap: row.currentMcap,
    isWin: row.isWin,
    isWin1h: row.isWin1h,
    recoveryEligible: row.recoveryEligible,
    author: {
      name: row.author.name ?? "User",
      username: row.author.username ?? null,
    },
  };
}

async function settleOneHourPostCandidate(
  post: OneHourSettlementCandidate
): Promise<{ settled: boolean; error: boolean }> {
  if (!post.contractAddress || post.entryMcap === null) {
    return { settled: false, error: false };
  }

  try {
    const marketCap = await resolveBestAvailablePostMarketCap({
      contractAddress: post.contractAddress,
      chainType: post.chainType,
      currentMcap: post.currentMcap,
    });
    const mcap1h = marketCap.mcap;
    if (mcap1h === null || mcap1h <= 0) {
      return { settled: false, error: true };
    }

    const percentChange1h = ((mcap1h - post.entryMcap) / post.entryMcap) * 100;
    const isWin1h = mcap1h > post.entryMcap;
    const { levelChange, recoveryEligible } = calculate1HSettlement(percentChange1h);
    const xpChange = calculateXpChange(percentChange1h);
    const currentUser = await prisma.user.findUnique({
      where: { id: post.authorId },
      select: { id: true, level: true, xp: true },
    });
    if (!currentUser) {
      return { settled: false, error: true };
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

    try {
      await prisma.$transaction([
        prisma.post.updateMany({
          where: { id: post.id },
          data: {
            settled: true,
            settledAt,
            isWin: isWin1h,
            isWin1h,
            mcap1h,
            percentChange1h,
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

      try {
        await prisma.$executeRaw`
          UPDATE "Post" SET settled = true, "settledAt" = ${settledAt}, "isWin" = ${isWin1h}
          WHERE id = ${post.id}
        `;
      } catch (rawPostErr) {
        console.warn("[Settlement 1H] Raw post update failed (continuing with user update):", rawPostErr);
      }
      await prisma.$executeRaw`
        UPDATE "User" SET level = ${newLevel}, xp = ${newXp} WHERE id = ${post.authorId}
      `;
    }

    if (scoreEligible) {
      const levelDiff = newLevel - currentUser.level;
      const xpDisplay = effectiveXpChange >= 0 ? `+${effectiveXpChange}` : effectiveXpChange;
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
        fallbackData: {
          userId: post.authorId,
          type: "settlement",
          message: settlementMsg,
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

    console.log(
      `[Settlement 1H] Post ${post.id}: ${isWin1h ? "WIN" : "LOSS"} (${percentChange1h.toFixed(2)}%), source=${marketCap.source}, scoreEligible=${scoreEligible}, recoveryEligible=${effectiveRecoveryEligible}, User ${post.authorId} level ${currentUser.level} -> ${newLevel}`
    );

    return { settled: true, error: false };
  } catch (err) {
    console.error(`[Settlement 1H] Error settling post ${post.id}:`, err);
    return { settled: false, error: true };
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
async function checkAndSettlePosts(params?: {
  postId?: string | null;
}): Promise<SettlementRunResult> {
  const targetPostId = params?.postId?.trim() ?? null;
  return await withSettlementRunLock(
    targetPostId ? `targeted_settlement:${targetPostId}` : "background_settlement",
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
        if (targetPostId) {
          const post = await findPostToSettle1hById(targetPostId);
          if (!post) {
            return createSkippedSettlementResult("post_not_found_or_already_settled");
          }
          if (!isReadyFor1HSettlement(post.createdAt, false)) {
            return createSkippedSettlementResult("post_not_ready_for_1h_settlement");
          }

          const result = await settleOneHourPostCandidate(post);
          return {
            settled1h: result.settled ? 1 : 0,
            snapshot6h: 0,
            levelChanges6h: 0,
            errors: result.error ? 1 : 0,
            ...(result.settled
              ? {}
              : {
                  skipped: true,
                  reason: result.error ? "targeted_settlement_failed" : "targeted_settlement_skipped",
                }),
          };
        }

        // ============================================
        // 1H SETTLEMENT - Official settlement for XP/Level
        // ============================================
        const oneHourScanLimit = SETTLEMENT_1H_TARGET_PER_RUN * SETTLEMENT_1H_SCAN_MULTIPLIER;
        const postsToSettle1h = await findPostsToSettle1h(oneHourAgo, oneHourScanLimit);

        for (const post of postsToSettle1h) {
          if (settled1hCount >= SETTLEMENT_1H_TARGET_PER_RUN) break;
          const result = await settleOneHourPostCandidate(post);
          if (result.settled) {
            settled1hCount++;
          }
          if (result.error) {
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
        const marketCap = await resolveBestAvailablePostMarketCap({
          contractAddress: post.contractAddress,
          chainType: post.chainType,
          currentMcap: post.currentMcap,
          mcap1h: post.mcap1h,
        });
        const mcap6h = marketCap.mcap;
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
          console.log(`[Snapshot 6H] Post ${post.id}: mcap6h=${mcap6h}, source=${marketCap.source}, change=${percentChange6h.toFixed(2)}%, isWin6h=${isWin6h}`);

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
          }

          snapshot6hCount++;
          console.log(`[Snapshot 6H] Post ${post.id}: mcap6h=${mcap6h}, source=${marketCap.source}, change=${percentChange6h.toFixed(2)}%, isWin6h=${isWin6h}`);
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

      const shouldUpdateMcap =
        needsMcapUpdate(post.createdAt, post.lastMcapUpdate, post.settled) ||
        isPinnedToEntryBaseline(post);
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
          const shouldUpdateMcap =
            needsMcapUpdate(post.createdAt, post.lastMcapUpdate, post.settled) ||
            isPinnedToEntryBaseline(post);
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

function buildJobWindowId(nowMs: number, intervalMs: number): string {
  return String(Math.floor(nowMs / Math.max(1_000, intervalMs)));
}

export function buildSettlementJobInput(params: {
  reason: string;
  postId?: string | null;
  nowMs?: number;
  notBeforeAt?: Date | string | number | null;
}): EnqueueInternalJobInput {
  const nowMs = params.nowMs ?? Date.now();
  return {
    jobName: "settlement",
    idempotencyKey:
      params.postId?.trim()
        ? `settlement:post:${params.postId.trim()}:1h`
        : `settlement:${buildJobWindowId(nowMs, SETTLEMENT_RUN_MIN_INTERVAL_MS)}`,
    payload: {
      reason: params.reason,
      ...(params.postId?.trim() ? { postId: params.postId.trim() } : {}),
    },
    ...(params.notBeforeAt ? { notBeforeAt: params.notBeforeAt } : {}),
  };
}

export function buildMaintenanceJobInputs(params: {
  reason: string;
  prewarmLeaderboard?: boolean;
  nowMs?: number;
}): EnqueueInternalJobInput[] {
  const nowMs = params.nowMs ?? Date.now();
  const maintenanceBucket = buildJobWindowId(nowMs, MAINTENANCE_RUN_MIN_INTERVAL_MS);
  const inputs: EnqueueInternalJobInput[] = [
    buildSettlementJobInput({ reason: params.reason, nowMs }),
    {
      jobName: "market_refresh",
      idempotencyKey: `market-refresh:${maintenanceBucket}`,
      payload: {
        reason: params.reason,
      },
    },
    buildIntelligenceRefreshJobInput({
      reason: params.reason,
      nowMs,
      intervalMs: MAINTENANCE_RUN_MIN_INTERVAL_MS,
      scope: "maintenance",
    }),
  ];

  if (params.prewarmLeaderboard) {
    inputs.push(
      buildLeaderboardRefreshJobInput({
        reason: params.reason,
        nowMs,
      })
    );
  }

  return inputs;
}

export async function runSettlementJob(params?: {
  postId?: string | null;
}): Promise<SettlementRunResult> {
  return checkAndSettlePosts(params);
}

export async function runMarketRefreshJob(): Promise<{
  marketRefresh: MarketRefreshRunResult;
  marketAlerts: MarketAlertScanResult;
}> {
  const marketRefresh = await refreshTrackedMarketCaps();
  const marketAlerts = await runMarketAlertScan();
  if (marketRefresh.updatedPosts > 0) {
    trendingCache = null;
  }
  return {
    marketRefresh,
    marketAlerts,
  };
}

export async function runIntelligenceRefreshJob(params?: {
  contractAddress?: string | null;
}): Promise<MaintenanceRunResult["intelligenceRefresh"]> {
  const startedAtMs = Date.now();
  const contractAddress = params?.contractAddress?.trim();
  if (contractAddress) {
    const result = await refreshTokenIntelligenceByAddress(contractAddress, {
      awaitSignalAlerts: true,
    });

    return {
      attempted: 1,
      refreshed: result?.refreshed ? 1 : 0,
      skipped: result && !result.refreshed ? 1 : 0,
      errors: result ? 0 : 1,
      durationMs: Date.now() - startedAtMs,
    };
  }

  return prewarmRecentTokenIntelligence({ awaitSignalAlerts: true });
}

async function dispatchInternalMaintenanceJob(input: EnqueueInternalJobInput): Promise<JobDispatchRecord> {
  if (hasQStashPublishConfig()) {
    const queued = await enqueueInternalJob(input);
    return {
      jobName: input.jobName,
      idempotencyKey: input.idempotencyKey,
      mode: "queued",
      messageId: queued.messageId,
      deduplicated: queued.deduplicated,
    };
  }

  if (process.env.NODE_ENV === "production") {
    throw new Error(`Queue publish config missing for ${input.jobName}`);
  }

  switch (input.jobName) {
    case "settlement":
      await runSettlementJob();
      break;
    case "market_refresh":
      await runMarketRefreshJob();
      break;
    case "intelligence_refresh":
      await runIntelligenceRefreshJob();
      break;
    case "leaderboard_refresh":
      await runLeaderboardStatsRefresh({
        source: "/api/internal/jobs/leaderboard_refresh:inline-fallback",
      });
      break;
    default:
      throw new Error(`Inline fallback is not supported for ${input.jobName}`);
  }

  return {
    jobName: input.jobName,
    idempotencyKey: input.idempotencyKey,
    mode: "inline",
    messageId: null,
    deduplicated: false,
  };
}

async function dispatchMaintenanceJobs(inputs: EnqueueInternalJobInput[]): Promise<JobDispatchRecord[]> {
  return Promise.all(inputs.map((input) => dispatchInternalMaintenanceJob(input)));
}

function mergeRealtimeIntelligenceIntoPostPricePayload(
  payload: PostPriceResponsePayload,
  snapshot: RealtimePostIntelligenceSnapshot | null | undefined
): PostPriceResponsePayload {
  if (!snapshot) {
    return payload;
  }

  return {
    ...payload,
    confidenceScore: snapshot.confidenceScore,
    hotAlphaScore: snapshot.hotAlphaScore,
    earlyRunnerScore: snapshot.earlyRunnerScore,
    highConvictionScore: snapshot.highConvictionScore,
    marketHealthScore: snapshot.marketHealthScore,
    setupQualityScore: snapshot.setupQualityScore,
    opportunityScore: snapshot.opportunityScore,
    dataReliabilityScore: snapshot.dataReliabilityScore,
    activityStatus: snapshot.activityStatus,
    activityStatusLabel: snapshot.activityStatusLabel,
    isTradable: snapshot.isTradable,
    bullishSignalsSuppressed: snapshot.bullishSignalsSuppressed,
    roiCurrentPct: snapshot.roiCurrentPct,
    timingTier: snapshot.timingTier,
    bundleRiskLabel: snapshot.bundleRiskLabel,
    tokenRiskScore: snapshot.tokenRiskScore,
    liquidity: snapshot.liquidity,
    volume24h: snapshot.volume24h,
    holderCount: snapshot.holderCount,
    largestHolderPct: snapshot.largestHolderPct,
    top10HolderPct: snapshot.top10HolderPct,
    bundledWalletCount: snapshot.bundledWalletCount,
    estimatedBundledSupplyPct: snapshot.estimatedBundledSupplyPct,
    lastIntelligenceAt: snapshot.lastIntelligenceAt,
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

function triggerMaintenanceCycleNonBlocking(reason: string): void {
  const now = Date.now();
  if (maintenanceRunInFlight) return;
  if (now - lastMaintenanceRunStartedAt < MAINTENANCE_RUN_MIN_INTERVAL_MS) return;

  lastMaintenanceRunStartedAt = now;
  maintenanceRunInFlight = dispatchMaintenanceJobs(
    buildMaintenanceJobInputs({
      reason,
      prewarmLeaderboard: false,
      nowMs: now,
    })
  )
    .then((jobs) => {
      console.log("[Maintenance] Opportunistic trigger dispatched", { reason, jobs });
      return jobs;
    })
    .catch((error) => {
      console.error("[Maintenance] Opportunistic trigger failed", { reason, error });
      return [];
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
  settlementRunInFlight = dispatchInternalMaintenanceJob(
    buildSettlementJobInput({
      reason,
      nowMs: now,
    })
  )
    .then((job) => {
      console.log("[Settlement] Opportunistic trigger dispatched", { reason, job });
      return job;
    })
    .catch((error) => {
      console.error("[Settlement] Opportunistic trigger failed", { reason, error });
      return {
        jobName: "settlement",
        idempotencyKey: "settlement:error",
        mode: "inline",
        messageId: null,
        deduplicated: false,
      } satisfies JobDispatchRecord;
    })
    .finally(() => {
      settlementRunInFlight = null;
    });
}

export function triggerOrganicSettlementWakeup(reason: string): void {
  if (!shouldRunOrganicSettlementWakeups()) {
    return;
  }

  triggerSettlementCycleNonBlocking(reason);
}

export function startMaintenanceLoop(opts?: { canRun?: () => boolean }): void {
  if (opts?.canRun) {
    maintenanceLoopCanRun = opts.canRun;
  }
  if (maintenanceLoopTimer) {
    return;
  }

  const triggerLoop = () => {
    if (maintenanceLoopCanRun && !maintenanceLoopCanRun()) {
      return;
    }
    triggerMaintenanceCycleNonBlocking("background_loop");
  };

  setTimeout(() => {
    triggerLoop();
  }, BACKGROUND_MAINTENANCE_LOOP_START_DELAY_MS);

  maintenanceLoopTimer = setInterval(() => {
    triggerLoop();
  }, BACKGROUND_MAINTENANCE_LOOP_INTERVAL_MS);
}

// Get all posts (feed) with sorting and filtering
postsRouter.get("/", async (c) => {
  const user = c.get("user");
  const queryParams = c.req.query();

  // Parse query params
  const parsed = FeedQuerySchema.safeParse(queryParams);
  const { sort, following, limit, cursor, search, postType } = parsed.success
    ? parsed.data
    : { sort: "latest" as const, following: false, limit: 10, cursor: undefined, search: undefined, postType: undefined };
  const shouldUsePublicResponseCaching = !user && !following && !cursor && !search?.trim();
  c.header("Vary", "Cookie");
  c.header(
    "Cache-Control",
    shouldUsePublicResponseCaching
      ? "public, max-age=15, stale-while-revalidate=45"
      : "private, no-store"
  );
  const feedCacheKey = buildFeedResponseCacheKey({
    userId: user?.id ?? null,
    sort,
    following,
    limit,
    cursor,
    search,
    postType,
  });
  const sharedFeedCacheKey = buildFeedSharedResponseCacheKey({
    sort,
    following,
    limit,
    cursor,
    search,
    postType,
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

  if (await isPrismaPoolPressureActive()) {
    const stalePayload = !cursor ? await readStaleFeedPayload() : null;
    if (stalePayload) {
      return c.json(stalePayload);
    }
    return c.json({
      data: [],
      hasMore: false,
      nextCursor: null,
    });
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
  if (!feedDegradedMode && !cursor && shouldRunOrganicSettlementWakeups()) {
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

  if (postType) {
    whereConditions.push({ postType });
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

  const responsePosts = await attachPollSummaries(postsWithUpdatedMcap, user?.id ?? null);
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
    maintenanceRunInFlight = dispatchMaintenanceJobs(
      buildMaintenanceJobInputs({
        reason: "manual_maintenance_endpoint",
        prewarmLeaderboard: true,
        nowMs: now,
      })
    )
      .catch((error) => {
        console.error("[Maintenance] Queue dispatch failed:", error);
        throw error;
      })
      .finally(() => {
        maintenanceRunInFlight = null;
      });

    try {
      const jobs = await maintenanceRunInFlight;
      lastCronMaintenanceCompletedAt = Date.now();
      return c.json({
        data: {
          queued: true,
          jobs,
        },
      }, 202);
    } catch {
      return c.json({
        error: {
          message: "Maintenance dispatch failed",
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

  const body = c.req.valid("json");
  const strippedContent = stripPostTypePrefix(body.content);
  const detected = detectContractAddress(strippedContent);
  const postType = normalizePostType(body.postType, Boolean(detected));
  const content = strippedContent.length > 0 ? strippedContent : body.content.trim();
  const pollOptions = [...new Set((body.pollOptions ?? []).map((option) => option.trim()).filter(Boolean))];
  const pollExpiresAt = body.pollExpiresAt ? new Date(body.pollExpiresAt) : null;
  let communityContext: Awaited<ReturnType<typeof resolveCommunityPostContext>> = null;
  try {
    communityContext = await resolveCommunityPostContext(body.communityId, user.id);
  } catch (error) {
    if (error instanceof Error && error.message === "COMMUNITY_NOT_FOUND") {
      return c.json({ error: { message: "Community not found.", code: "COMMUNITY_NOT_FOUND" } }, 404);
    }
    if (error instanceof Error && error.message === "COMMUNITY_JOIN_REQUIRED") {
      return c.json({ error: { message: "Join this community before posting.", code: "COMMUNITY_JOIN_REQUIRED" } }, 403);
    }
    throw error;
  }

  if (postType === "poll" && pollOptions.length < 2) {
    return c.json({
      error: {
        message: "Poll posts require at least two options.",
        code: "POLL_OPTIONS_REQUIRED",
      },
    }, 400);
  }

  if (postType !== "poll" && pollOptions.length > 0) {
    return c.json({
      error: {
        message: "Poll options can only be submitted with poll posts.",
        code: "POLL_OPTIONS_UNSUPPORTED",
      },
    }, 400);
  }

  if (pollExpiresAt && pollExpiresAt.getTime() <= Date.now()) {
    return c.json({
      error: {
        message: "Poll expiration must be in the future.",
        code: "POLL_EXPIRATION_INVALID",
      },
    }, 400);
  }

  const alphaCreatedAt = new Date();
  if (detected) {
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
  }

  const marketContext = detected
    ? await resolveCreatePostMarketContext({
        address: detected.address,
        chainType: detected.chainType,
      })
    : null;
  const marketCapResult = marketContext?.marketCapResult ?? null;
  const heliusTokenMetadata = marketContext?.heliusTokenMetadata ?? null;
  const entryMcap = marketCapResult?.mcap ?? null;
  const communityToken = communityContext?.token ?? null;
  const communityTokenAppliesToPost =
    Boolean(communityToken) && !detected && (postType === "alpha" || postType === "chart" || postType === "raid");

  const createPostData = {
    content,
    postType,
    pollExpiresAt,
    authorId: user.id,
    communityId: communityContext?.id ?? null,
    tokenId: communityContext?.tokenId ?? null,
    contractAddress: detected?.address ?? (communityTokenAppliesToPost ? communityToken?.address ?? null : null),
    chainType: detected?.chainType ?? (communityTokenAppliesToPost ? communityToken?.chainType ?? null : null),
    entryMcap,
    currentMcap: entryMcap,
    // Store token metadata (Helius-first for names/symbol, Dex-first for image)
    tokenName: heliusTokenMetadata?.tokenName ?? marketCapResult?.tokenName ?? (communityTokenAppliesToPost ? communityToken?.name ?? null : null),
    tokenSymbol: heliusTokenMetadata?.tokenSymbol ?? marketCapResult?.tokenSymbol ?? (communityTokenAppliesToPost ? communityToken?.symbol ?? null : null),
    tokenImage: marketCapResult?.tokenImage ?? heliusTokenMetadata?.tokenImage ?? (communityTokenAppliesToPost ? communityToken?.imageUrl ?? null : null),
    dexscreenerUrl: marketCapResult?.dexscreenerUrl ?? (communityTokenAppliesToPost ? communityToken?.dexscreenerUrl ?? null : null),
    trackingMode: detected || communityTokenAppliesToPost ? TRACKING_MODE_ACTIVE : null,
    lastMcapUpdate: detected ? new Date() : null,
  };

  let post: ReturnType<typeof buildCreatePostResponse> & {
    communityId?: string | null;
    community?: ReturnType<typeof serializePostCommunity>;
  };

  try {
    const createdPost = await prisma.post.create({
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
        community: {
          select: {
            id: true,
            tokenId: true,
            xCashtag: true,
            token: {
              select: {
                id: true,
                address: true,
                chainType: true,
                symbol: true,
                name: true,
                imageUrl: true,
                dexscreenerUrl: true,
              },
            },
          },
        },
      },
    });
    post = {
      ...createdPost,
      postType: normalizePostType(createdPost.postType, Boolean(createdPost.contractAddress)),
      pollExpiresAt: createdPost.pollExpiresAt?.toISOString() ?? null,
      community: serializePostCommunity(createdPost.community),
    };
  } catch (error) {
    if (!isPrismaSchemaDriftError(error) && !isPrismaClientError(error)) {
      throw error;
    }

    console.warn("[posts/create] prisma create fallback triggered", {
      message: getErrorMessage(error),
    });
    post = await createPostRawFallback({
      content: createPostData.content,
      postType: createPostData.postType,
      pollExpiresAt: createPostData.pollExpiresAt,
      authorId: createPostData.authorId,
      contractAddress: createPostData.contractAddress,
      chainType: createPostData.chainType,
      entryMcap: createPostData.entryMcap,
      currentMcap: createPostData.currentMcap,
      author: authorSnapshot,
      tokenName: marketCapResult?.tokenName ?? heliusTokenMetadata?.tokenName ?? null,
      tokenSymbol: marketCapResult?.tokenSymbol ?? heliusTokenMetadata?.tokenSymbol ?? null,
      tokenImage: marketCapResult?.tokenImage ?? heliusTokenMetadata?.tokenImage ?? null,
      dexscreenerUrl: marketCapResult?.dexscreenerUrl ?? null,
    });
    post.communityId = communityContext?.id ?? null;
    post.community = serializePostCommunity(communityContext);
  }

  if (createPostData.postType === "poll" && pollOptions.length >= 2) {
    await prisma.postPollOption.createMany({
      data: pollOptions.map((label, index) => ({
        postId: post.id,
        label,
        sortOrder: index,
      })),
    });
  }

  if (communityContext) {
    await prisma.tokenCommunityMemberStats.upsert({
      where: {
        tokenId_userId: {
          tokenId: communityContext.tokenId,
          userId: user.id,
        },
      },
      create: {
        tokenId: communityContext.tokenId,
        userId: user.id,
        threadCount: 1,
        contributionScore: 6,
        lastActiveAt: new Date(),
      },
      update: {
        threadCount: { increment: 1 },
        contributionScore: { increment: 6 },
        lastActiveAt: new Date(),
      },
    });
  }

  const [postWithPoll] = await attachPollSummaries([post], user.id);

  queuePostCreateFanout({
    authorId: user.id,
    authorName: authorSnapshot.name,
    authorUsername: authorSnapshot.username,
    postId: post.id,
  });
  if (createPostData.contractAddress) {
    queuePostCreateSettlement({
      postId: post.id,
      createdAt: alphaCreatedAt,
    });
  }
  queuePostCreateIntelligenceRefresh({
    postId: post.id,
    contractAddress: createPostData.contractAddress,
  });

  invalidatePostReadCaches({ leaderboard: true });
  void import("./users.js")
    .then(({ invalidatePublicUserRouteCachesForUser }) => {
      invalidatePublicUserRouteCachesForUser({
        userId: user.id,
        username: authorSnapshot.username,
      });
    })
    .catch((error) => {
      console.warn("[posts/create] failed to invalidate public user caches", {
        userId: user.id,
        message: getErrorMessage(error),
      });
    });

  return c.json({
    data: {
      ...postWithPoll,
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
    const now = Date.now();
    if (settlementRunInFlight) {
      return c.json({
        data: {
          skipped: true,
          reason: "already_running",
          inFlight: settlementRequestLimiter.current(),
          limit: settlementRequestLimiter.limit,
        },
      }, 202);
    }

    const cooldownRemainingMs = Math.max(
      0,
      SETTLEMENT_RUN_MIN_INTERVAL_MS - (now - lastSettlementRunStartedAt)
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

    lastSettlementRunStartedAt = now;
    settlementRunInFlight = dispatchInternalMaintenanceJob(
      buildSettlementJobInput({
        reason: "manual_settlement_endpoint",
        nowMs: now,
      })
    )
      .catch((error) => {
        console.error("[Settlement] Queue dispatch failed:", error);
        throw error;
      })
      .finally(() => {
        settlementRunInFlight = null;
      });

    try {
      const job = await settlementRunInFlight;
      return c.json({
        data: {
          queued: true,
          job,
        },
      }, 202);
    } catch {
      return c.json({
        error: {
          message: "Settlement dispatch failed",
          code: "INTERNAL_ERROR",
        },
      }, 500);
    }
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

  if (await isPrismaPoolPressureActive()) {
    console.warn("[posts/trending] pool pressure active; serving stale-or-empty payload");
    return c.json({ data: trendingCache?.data ?? [] });
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
  const cachedPost = readPostDetailCache(id);
  if (cachedPost) {
    if (!user) {
      return c.json({ data: cachedPost });
    }
    const [like, repost] = await Promise.all([
      prisma.like.findUnique({
        where: { userId_postId: { userId: user.id, postId: id } },
      }),
      prisma.repost.findUnique({
        where: { userId_postId: { userId: user.id, postId: id } },
      }),
    ]);
    return c.json({
      data: {
        ...cachedPost,
        isLiked: !!like,
        isReposted: !!repost,
      },
    });
  }

  const staleCachedPost = readPostDetailCache(id, { allowStale: true });
  const inFlight = postDetailInFlight.get(id);
  if (inFlight) {
    const sharedPost = staleCachedPost ?? await inFlight;
    if (!user) {
      return c.json({ data: sharedPost });
    }
    const [like, repost] = await Promise.all([
      prisma.like.findUnique({
        where: { userId_postId: { userId: user.id, postId: id } },
      }),
      prisma.repost.findUnique({
        where: { userId_postId: { userId: user.id, postId: id } },
      }),
    ]);
    return c.json({
      data: {
        ...sharedPost,
        isLiked: !!like,
        isReposted: !!repost,
      },
    });
  }

  const loadPromise = (async () => {
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
      const fallbackPost =
        staleCachedPost ??
        [...feedResponseCache.values(), ...feedSharedResponseCache.values()]
          .flatMap((entry) => entry.payload.data)
          .find((item) => {
            if (!item || typeof item !== "object" || Array.isArray(item)) return false;
            return (item as { id?: unknown }).id === id;
          }) ??
        null;
      if (fallbackPost && typeof fallbackPost === "object" && !Array.isArray(fallbackPost)) {
        const normalizedFallback = fallbackPost as Record<string, unknown>;
        writePostDetailCache(id, normalizedFallback);
        return normalizedFallback;
      }
      throw error;
    }

    if (!post) {
      throw new Error("__POST_NOT_FOUND__");
    }

    const [normalizedPost] = await attachPollSummaries([post], null);
    const publicPayload = {
      ...normalizedPost,
      isLiked: false,
      isReposted: false,
    } satisfies Record<string, unknown>;
    writePostDetailCache(id, publicPayload);
    return publicPayload;
  })().finally(() => {
    postDetailInFlight.delete(id);
  });

  postDetailInFlight.set(id, loadPromise);

  let sharedPost: Record<string, unknown>;
  try {
    sharedPost = await loadPromise;
  } catch (error) {
    if (error instanceof Error && error.message === "__POST_NOT_FOUND__") {
      return c.json({ error: { message: "Post not found", code: "NOT_FOUND" } }, 404);
    }
    if (!isPrismaSchemaDriftError(error) && !isPrismaClientError(error)) {
      throw error;
    }
    return c.json(
      { error: { message: "Post is temporarily unavailable", code: "POST_UNAVAILABLE" } },
      503
    );
  }

  if (!user) {
    return c.json({ data: sharedPost });
  }

  // Check user interactions
  const [like, repost] = await Promise.all([
    prisma.like.findUnique({
      where: { userId_postId: { userId: user.id, postId: id } },
    }),
    prisma.repost.findUnique({
      where: { userId_postId: { userId: user.id, postId: id } },
    }),
  ]);

  return c.json({
    data: {
      ...sharedPost,
      isLiked: !!like,
      isReposted: !!repost,
    }
  });
});

// Like a post
postsRouter.post("/:id/like", requireNotBanned, async (c) => {
  const user = c.get("user");
  const session = c.get("session");
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
  const createdLike = (
    await prisma.like.createMany({
      data: [
        {
          userId: user.id,
          postId,
        },
      ],
      skipDuplicates: true,
    })
  ).count > 0;

  // Create notification for post author (if not liking own post)
  if (createdLike && post.authorId !== user.id) {
    const userName = session?.user?.name?.trim() || "Someone";

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
  invalidatePostDetailCache(postId);

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
  invalidatePostDetailCache(postId);

  return c.json({ data: { liked: false, likeCount } });
});

// Repost a post
postsRouter.post("/:id/repost", requireNotBanned, async (c) => {
  const user = c.get("user");
  const session = c.get("session");
  const postId = c.req.param("id");

  if (!user) {
    return c.json({ error: { message: "Unauthorized", code: "UNAUTHORIZED" } }, 401);
  }

  // Rate limit check: max 10 reposts per 24 hours
  const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const recentReposts = await prisma.repost.findMany({
    where: {
      userId: user.id,
      createdAt: { gte: twentyFourHoursAgo },
    },
    orderBy: { createdAt: "asc" },
    take: DAILY_REPOST_LIMIT,
    select: { createdAt: true },
  });
  const repostCountLast24h = recentReposts.length;

  if (repostCountLast24h >= DAILY_REPOST_LIMIT) {
    // Calculate time until reset
    const oldestRepost = recentReposts[0] ?? null;

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
  const createdRepost = (
    await prisma.repost.createMany({
      data: [
        {
          userId: user.id,
          postId,
        },
      ],
      skipDuplicates: true,
    })
  ).count > 0;

  // Create notification for post author
  if (createdRepost) {
    const userName = session?.user?.name?.trim() || "Someone";

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
  invalidatePostDetailCache(postId);

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
  invalidatePostDetailCache(postId);

  return c.json({ data: { reposted: false, repostCount } });
});

const PollVoteSchema = z.object({
  optionId: z.string().trim().min(1),
});

postsRouter.post("/:id/poll-vote", requireNotBanned, zValidator("json", PollVoteSchema), async (c) => {
  const user = c.get("user");
  if (!user) {
    return c.json({ error: { message: "Unauthorized", code: "UNAUTHORIZED" } }, 401);
  }

  const postId = c.req.param("id");
  const { optionId } = c.req.valid("json");
  const post = await prisma.post.findUnique({
    where: { id: postId },
    select: { id: true, postType: true, pollExpiresAt: true },
  });
  if (!post) {
    return c.json({ error: { message: "Post not found", code: "NOT_FOUND" } }, 404);
  }
  if (normalizePostType(post.postType, false) !== "poll") {
    return c.json({ error: { message: "This post is not a poll.", code: "NOT_POLL" } }, 400);
  }
  if (post.pollExpiresAt && post.pollExpiresAt.getTime() <= Date.now()) {
    return c.json({ error: { message: "This poll has expired.", code: "POLL_EXPIRED" } }, 400);
  }

  const option = await prisma.postPollOption.findFirst({
    where: { id: optionId, postId },
    select: { id: true },
  });
  if (!option) {
    return c.json({ error: { message: "Poll option not found.", code: "POLL_OPTION_NOT_FOUND" } }, 404);
  }

  await prisma.postPollVote.upsert({
    where: { postId_userId: { postId, userId: user.id } },
    create: { postId, optionId, userId: user.id },
    update: { optionId },
  });

  const [summaryPost] = await attachPollSummaries([{ id: postId, postType: "poll", pollExpiresAt: post.pollExpiresAt }], user.id);
  invalidatePostReadCaches();
  if (!summaryPost?.poll) {
    return c.json({ error: { message: "Poll summary unavailable.", code: "POLL_SUMMARY_UNAVAILABLE" } }, 500);
  }
  return c.json({ data: summaryPost.poll });
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

  // Notify post author — fire non-blocking so it never delays the response
  if (post.authorId !== user.id) {
    const commenterName = (user.email || "Someone").trim();
    void createNotificationSafely({
      operation: "comment_author_notification",
      data: {
        userId: post.authorId,
        type: "comment",
        message: `${commenterName} commented on your Alpha`,
        dedupeKey: buildNotificationDedupeKey({
          type: "comment",
          userId: post.authorId,
          fromUserId: user.id,
          postId: post.id,
        }),
        postId: post.id,
        fromUserId: user.id,
      },
      fallbackData: {
        userId: post.authorId,
        type: "comment",
        message: `${commenterName} commented on your Alpha`,
        postId: post.id,
      },
    }).catch(() => {});
  }

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
  c.header("Cache-Control", "no-store");
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
  c.header("Cache-Control", "no-store");
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

function isValidSolanaAddress(value: string): boolean {
  try {
    return new PublicKey(value).toBase58().length > 0;
  } catch {
    return false;
  }
}

const SolanaAddressStringSchema = z.string().min(32).max(64).refine(isValidSolanaAddress, {
  message: "Invalid Solana address",
});

const AtomicAmountNumberSchema = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);

const AtomicAmountStringSchema = z.string().regex(/^\d+$/, "Expected atomic amount string");

const JupiterQuoteResponseSchema = z
  .object({
    inputMint: SolanaAddressStringSchema,
    outputMint: SolanaAddressStringSchema,
    inAmount: AtomicAmountStringSchema,
    outAmount: AtomicAmountStringSchema,
    otherAmountThreshold: AtomicAmountStringSchema,
    swapMode: z.enum(["ExactIn", "ExactOut"]),
    slippageBps: z.number().int().min(1).max(5000),
    contextSlot: z.number().int().nonnegative().optional(),
    priceImpactPct: z.string().optional(),
    platformFee: z
      .object({
        amount: AtomicAmountStringSchema.optional(),
        feeBps: z.number().int().min(0).max(5000).optional(),
        mint: SolanaAddressStringSchema.optional(),
      })
      .optional(),
  })
  .passthrough()
  .superRefine((value, ctx) => {
    if (value.inputMint === value.outputMint) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["outputMint"],
        message: "inputMint and outputMint must differ",
      });
    }
  });

const JupiterQuoteProxySchema = z
  .object({
    inputMint: SolanaAddressStringSchema,
    outputMint: SolanaAddressStringSchema,
    amount: AtomicAmountNumberSchema,
    slippageBps: z.number().int().min(1).max(5000),
    swapMode: z.enum(["ExactIn", "ExactOut"]).optional().default("ExactIn"),
    postId: z.string().min(1).optional(),
    attributionType: z.enum(["token_page_direct", "post_attributed"]).optional().default("post_attributed"),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.inputMint === value.outputMint) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["outputMint"],
        message: "inputMint and outputMint must differ",
      });
    }
    if (value.attributionType === "post_attributed" && !value.postId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["postId"],
        message: "postId is required for post-attributed trades",
      });
    }
    if (value.attributionType === "token_page_direct" && value.postId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["postId"],
        message: "postId is not allowed for token-page direct trades",
      });
    }
  });

const JupiterSwapProxySchema = z
  .object({
    quoteResponse: JupiterQuoteResponseSchema,
    userPublicKey: SolanaAddressStringSchema,
    postId: z.string().min(1).optional(),
    tradeSide: z.enum(["buy", "sell"]).optional(),
    wrapAndUnwrapSol: z.boolean().optional(),
    dynamicComputeUnitLimit: z.boolean().optional(),
    mevProtection: z.boolean().optional(),
    attributionType: z.enum(["token_page_direct", "post_attributed"]).optional().default("post_attributed"),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.attributionType === "post_attributed" && !value.postId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["postId"],
        message: "postId is required for post-attributed trades",
      });
    }
    if (value.attributionType === "token_page_direct" && value.postId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["postId"],
        message: "postId is not allowed for token-page direct trades",
      });
    }
  });

const JupiterFeeConfirmSchema = z
  .object({
    tradeFeeEventId: z.string().min(1),
    txSignature: z.string().min(40).max(128),
    walletAddress: SolanaAddressStringSchema,
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

const ChartTradesQuerySchema = z
  .object({
    tokenAddress: z.string().min(10).max(128),
    pairAddress: z.string().min(10).max(128).optional(),
    chainType: z.enum(["solana", "evm", "ethereum"]).optional().default("solana"),
    limit: z.coerce.number().int().min(5).max(40).optional().default(24),
  })
  .strict();

const ChartLiveQuerySchema = z
  .object({
    tokenAddress: z.string().min(10).max(128),
    pairAddress: z.string().min(10).max(128).optional(),
    chainType: z.enum(["solana", "evm", "ethereum"]).optional().default("solana"),
  })
  .strict();

const TradePanelContextSchema = z
  .object({
    walletAddress: SolanaAddressStringSchema,
    tokenMint: SolanaAddressStringSchema,
  })
  .strict();

const PortfolioRequestSchema = z
  .object({
    walletAddress: SolanaAddressStringSchema,
    tokenMints: z.array(SolanaAddressStringSchema).max(120).optional(),
  })
  .strict();

const TerminalDepthRequestSchema = z
  .object({
    tokenMint: SolanaAddressStringSchema,
    chainType: z.enum(["solana", "evm", "ethereum"]).optional().default("solana"),
    pairAddress: z.string().min(10).max(128).optional(),
  })
  .strict();

type ChartTradesQuery = z.infer<typeof ChartTradesQuerySchema>;
type ChartLiveQuery = z.infer<typeof ChartLiveQuerySchema>;
type TerminalDepthRequest = z.infer<typeof TerminalDepthRequestSchema>;

type PriceRoutePostRecord = {
  id: string;
  contractAddress: string | null;
  chainType: string | null;
  entryMcap: number | null;
  currentMcap: number | null;
  mcap1h: number | null;
  mcap6h: number | null;
  confidenceScore?: number | null;
  hotAlphaScore?: number | null;
  earlyRunnerScore?: number | null;
  highConvictionScore?: number | null;
  marketHealthScore?: number | null;
  setupQualityScore?: number | null;
  opportunityScore?: number | null;
  dataReliabilityScore?: number | null;
  activityStatus?: string | null;
  activityStatusLabel?: string | null;
  isTradable?: boolean;
  bullishSignalsSuppressed?: boolean;
  roiCurrentPct?: number | null;
  timingTier?: string | null;
  bundleRiskLabel?: string | null;
  tokenRiskScore?: number | null;
  liquidity?: number | null;
  volume24h?: number | null;
  holderCount?: number | null;
  largestHolderPct?: number | null;
  top10HolderPct?: number | null;
  bundledWalletCount?: number | null;
  estimatedBundledSupplyPct?: number | null;
  lastIntelligenceAt?: Date | null;
  settled: boolean;
  settledAt: Date | null;
  createdAt: Date;
  lastMcapUpdate: Date | null;
  trackingMode?: string | null;
};

function hasSuspiciousSettledBaselineCurrentMcap(
  payload: Pick<PriceRoutePostRecord, "entryMcap" | "currentMcap" | "mcap1h" | "mcap6h" | "settled"> |
    Pick<PostPriceResponsePayload, "entryMcap" | "currentMcap" | "mcap1h" | "mcap6h" | "settled">
): boolean {
  if (!payload.settled) return false;
  if (payload.entryMcap === null || payload.currentMcap === null) return false;
  if (payload.currentMcap !== payload.entryMcap) return false;

  return (
    (payload.mcap1h !== null && payload.mcap1h !== payload.entryMcap) ||
    (payload.mcap6h !== null && payload.mcap6h !== payload.entryMcap)
  );
}

function isPinnedToEntryBaseline(post: Pick<
  PriceRoutePostRecord,
  "createdAt" | "settled" | "entryMcap" | "currentMcap" | "lastMcapUpdate"
>): boolean {
  if (post.settled) return false;
  if (determineTrackingMode(post.createdAt) !== TRACKING_MODE_ACTIVE) return false;
  if (post.entryMcap === null || post.currentMcap === null) return false;
  if (post.currentMcap !== post.entryMcap) return false;

  const lastUpdateAgeMs = post.lastMcapUpdate ? Date.now() - post.lastMcapUpdate.getTime() : Number.POSITIVE_INFINITY;
  return lastUpdateAgeMs >= 5_000;
}

async function resolvePostPricePayload(post: PriceRoutePostRecord) {
  // If no contract address, return current values
  if (!post.contractAddress) {
    return buildPostPricePayloadFromRecord(post);
  }

  const trackingMode = determineTrackingMode(post.createdAt);
  let finalMcap = post.currentMcap;
  let responseUpdatedAt = post.lastMcapUpdate ?? new Date();

  // Avoid a thundering herd: only refresh if the cached value is stale.
  const looksPinnedToSnapshot =
    finalMcap !== null &&
    (
      (post.mcap6h !== null && finalMcap === post.mcap6h) ||
      (post.mcap1h !== null && finalMcap === post.mcap1h)
    );
  const shouldRefresh =
    needsMcapUpdate(post.createdAt, post.lastMcapUpdate, post.settled) ||
    isPinnedToEntryBaseline(post) ||
    hasSuspiciousSettledBaselineCurrentMcap(post) ||
    looksPinnedToSnapshot;

  if (shouldRefresh) {
    let refreshPromise = priceRefreshInFlight.get(post.id);
    if (!refreshPromise) {
      refreshPromise = (async () => {
        // Price route must stay fast and non-blocking.
        // Persisted writes are handled by maintenance to avoid lock contention from polling.
        const latest = await resolveBestAvailablePostMarketCap({
          contractAddress: post.contractAddress!,
          chainType: post.chainType,
          currentMcap: post.currentMcap,
          mcap1h: post.mcap1h,
        });
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
    ...buildPostPricePayloadFromRecord(post),
    currentMcap: finalMcap,
    percentChange: percentChange !== null ? Math.round(percentChange * 100) / 100 : null,
    trackingMode,
    lastMcapUpdate: responseUpdatedAt.toISOString(),
  };
}

async function attachRealtimeIntelligenceToPostPricePayloads(
  posts: IntelligenceCallRecord[],
  payloadsById: Map<string, PostPriceResponsePayload>,
  context: "batch" | "single"
): Promise<void> {
  if (posts.length === 0 || payloadsById.size === 0) {
    return;
  }

  if (await isPrismaPoolPressureActive()) {
    return;
  }

  const staleCachedPayloadEntries = await Promise.all(
    posts.map(async (post) => [post.id, await resolveCachedPostPricePayload(post.id, { allowStale: true })] as const)
  );
  const staleCachedPayloadById = new Map(staleCachedPayloadEntries);
  const nowMs = Date.now();
  const stalePosts: IntelligenceCallRecord[] = [];
  const overrides = new Map<string, {
    currentMcap: number | null;
    lastMcapUpdate: Date | null;
    settled: boolean;
    settledAt: Date | null;
  }>();

  for (const post of posts) {
    const payload = payloadsById.get(post.id);
    if (!payload) {
      continue;
    }

    const freshestPayload = mergePostPricePayloadWithFresherIntelligence(
      payload,
      staleCachedPayloadById.get(post.id) ?? null
    );
    payloadsById.set(post.id, freshestPayload);

    if (!shouldRefreshPostPriceIntelligence(freshestPayload, nowMs)) {
      continue;
    }

    stalePosts.push(post);
    overrides.set(post.id, {
      currentMcap: freshestPayload.currentMcap,
      lastMcapUpdate: parseCachedDate(freshestPayload.lastMcapUpdate),
      settled: freshestPayload.settled,
      settledAt: parseCachedDate(freshestPayload.settledAt),
    });
  }

  if (stalePosts.length === 0 || overrides.size === 0) {
    return;
  }

  if (!POST_PRICE_ENABLE_LIVE_INTELLIGENCE_REFRESH) {
    return;
  }

  try {
    const snapshotsById = await computeRealtimeIntelligenceSnapshots(stalePosts, overrides);
    for (const [postId, payload] of payloadsById) {
      if (!overrides.has(postId)) {
        continue;
      }
      payloadsById.set(
        postId,
        mergeRealtimeIntelligenceIntoPostPricePayload(payload, snapshotsById.get(postId))
      );
    }
  } catch (error) {
    console.warn(`[posts/price] live intelligence refresh skipped for ${context} payload`, {
      message: getErrorMessage(error),
      postCount: stalePosts.length,
    });
  }
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
  const attributionType = normalizeTradeAttributionType(payload.attributionType);
  let platformFeeBps = getActivePlatformFeeBps(attributionType);
  if (attributionType === "post_attributed" && payload.postId) {
    try {
      const postAuthor = await prisma.post.findUnique({
        where: { id: payload.postId },
        select: {
          author: {
            select: {
              walletAddress: true,
              tradeFeeRewardsEnabled: true,
              tradeFeePayoutAddress: true,
            },
          },
        },
      });
      platformFeeBps = isCreatorFeeEligible(postAuthor?.author)
        ? FIXED_PLATFORM_FEE_BPS
        : TOKEN_PAGE_DIRECT_PLATFORM_FEE_BPS;
    } catch (error) {
      console.warn("[jupiter/quote] creator fee eligibility lookup skipped", {
        postId: payload.postId,
        message: getErrorMessage(error),
      });
      platformFeeBps = TOKEN_PAGE_DIRECT_PLATFORM_FEE_BPS;
    }
  }
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
        timeoutMs: 5_200,
        hedgeDelayMs: 60,
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

  if (result.status >= 500) {
    console.warn("[jupiter/quote] upstream route slow or failed", {
      inputMint: payload.inputMint,
      outputMint: payload.outputMint,
      amount: payload.amount,
      slippageBps: payload.slippageBps,
      status: result.status,
      body: result.bodyText.slice(0, 240),
    });
  }

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
  const normalizedLinkedWalletAddress = linkedWalletAddress ? new PublicKey(linkedWalletAddress).toBase58() : null;
  const normalizedUserPublicKey = new PublicKey(payload.userPublicKey).toBase58();
  if (!linkedWalletAddress) {
    return c.json(
      { error: { message: "Link a wallet before building trades", code: "WALLET_NOT_LINKED" } },
      403
    );
  }
  if (normalizedLinkedWalletAddress !== normalizedUserPublicKey) {
    return c.json(
      { error: { message: "Trade wallet does not match the authenticated wallet", code: "WALLET_MISMATCH" } },
      403
    );
  }

  const attributionType = normalizeTradeAttributionType(payload.attributionType);
  const platformFeeBps = getActivePlatformFeeBps(attributionType);
  const quote = payload.quoteResponse;

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
  };
  if (payload.mevProtection !== false) {
    outboundPayload.prioritizationFeeLamports = {
      priorityLevelWithMaxLamports: {
        priorityLevel: JUPITER_PRIORITY_LEVEL,
        maxLamports: JUPITER_MAX_PRIORITY_FEE_LAMPORTS,
        global: false,
      },
    };
  }
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
      ? Math.min(platformFeeBps, Math.max(1, Math.round(quotePlatformFeeBpsRaw)))
      : platformFeeBps;
  const postContext = await withTimeoutFallback(postContextPromise, 180, null);
  if (attributionType !== "token_page_direct" && payload.postId && !postContext) {
    return c.json(
      { error: { message: "Post context is unavailable for this trade", code: "POST_CONTEXT_UNAVAILABLE" } },
      409
    );
  }
  if (postContext && postContext.chainType !== "solana") {
    return c.json(
      { error: { message: "Only Solana trade attribution is supported", code: "UNSUPPORTED_CHAIN" } },
      400
    );
  }

  if (
    attributionType !== "token_page_direct" &&
    postContext &&
    postContext.chainType === "solana" &&
    platformFeeAmountBigInt > 0n &&
    platformFeeBpsApplied > 0
  ) {
    const posterShareBps = isCreatorFeeEligible(postContext.author)
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

    const normalizedPayloadWalletAddress = new PublicKey(payload.walletAddress).toBase58();
    const normalizedExistingWalletAddress = new PublicKey(existing.traderWalletAddress).toBase58();
    if (normalizedExistingWalletAddress !== normalizedPayloadWalletAddress) {
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

    if (
      user.walletAddress &&
      new PublicKey(user.walletAddress).toBase58() !== normalizedPayloadWalletAddress
    ) {
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

function toBirdeyeTradeFeedChain(chainType: string | null | undefined): BirdeyeTradeFeedChain {
  return chainType === "ethereum" || chainType === "evm" ? "ethereum" : "solana";
}

function buildChartTradesCacheKey(payload: ChartTradesQuery): string {
  return [
    toBirdeyeTradeFeedChain(payload.chainType),
    payload.tokenAddress.toLowerCase(),
    payload.pairAddress?.toLowerCase() ?? "",
    String(payload.limit),
  ].join(":");
}

function isProviderRateLimitError(error: unknown): boolean {
  const message = String(error instanceof Error ? error.message : error).toLowerCase();
  return message.includes("429") || message.includes("rate limit") || message.includes("too many requests");
}

export async function loadChartTrades(payload: ChartTradesQuery) {
  if (!hasBirdeyeTradeFeedConfig()) {
    return [];
  }

  const bufferedSnapshot = getBufferedBirdeyeLiveFeedSnapshot({
    chainType: toBirdeyeTradeFeedChain(payload.chainType),
    tokenAddress: payload.tokenAddress,
    pairAddress: payload.pairAddress ?? null,
  });

  if (
    bufferedSnapshot &&
    bufferedSnapshot.recentTrades.length > 0 &&
    (bufferedSnapshot.status.connected || Date.now() - bufferedSnapshot.lastTradeAtMs <= 30_000)
  ) {
    return bufferedSnapshot.recentTrades.slice(0, payload.limit);
  }

  const cacheKey = buildChartTradesCacheKey(payload);
  const now = Date.now();
  const cached = chartTradesCache.get(cacheKey);
  if (cached && cached.expiresAtMs > now) {
    return cached.trades;
  }
  const staleTrades = cached && cached.staleUntilMs > now ? cached.trades : null;
  if (cached && cached.staleUntilMs <= now) {
    chartTradesCache.delete(cacheKey);
  }

  const backoffUntil = chartTradesBackoffUntil.get(cacheKey) ?? 0;
  if (backoffUntil > now) {
    return staleTrades ?? [];
  }
  if (backoffUntil > 0) {
    chartTradesBackoffUntil.delete(cacheKey);
  }

  const inFlight = chartTradesInFlight.get(cacheKey);
  if (inFlight) {
    return inFlight;
  }

  const request = fetchBirdeyeRecentTrades({
    chainType: toBirdeyeTradeFeedChain(payload.chainType),
    tokenAddress: payload.tokenAddress,
    limit: payload.limit,
  }).finally(() => {
    if (chartTradesInFlight.get(cacheKey) === request) {
      chartTradesInFlight.delete(cacheKey);
    }
  });

  chartTradesInFlight.set(cacheKey, request);
  let trades: Awaited<ReturnType<typeof fetchBirdeyeRecentTrades>>;
  try {
    trades = await request;
  } catch (error) {
    chartTradesBackoffUntil.set(cacheKey, Date.now() + (isProviderRateLimitError(error) ? 60_000 : 20_000));
    if (staleTrades) return staleTrades;
    throw error;
  }
  chartTradesBackoffUntil.delete(cacheKey);
  chartTradesCache.set(cacheKey, {
    trades,
    expiresAtMs: Date.now() + CHART_TRADES_CACHE_TTL_MS,
    staleUntilMs: Date.now() + CHART_TRADES_STALE_FALLBACK_MS,
  });
  return trades;
}

const SOLANA_USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

async function fetchDerivedTerminalQuote(params: {
  inputMint: string;
  outputMint: string;
  amount: number;
}) {
  const search = new URLSearchParams({
    inputMint: params.inputMint,
    outputMint: params.outputMint,
    amount: String(params.amount),
    slippageBps: "50",
    swapMode: "ExactIn",
  });
  const response = await forwardJupiterRequest(
    JUPITER_QUOTE_URLS.map((base) => `${base}?${search.toString()}`),
    {
      method: "GET",
      headers: { accept: "application/json" },
      timeoutMs: 4_800,
      hedgeDelayMs: 60,
    }
  );
  if (response.status >= 400) {
    throw new Error(response.bodyText || `Quote failed (${response.status})`);
  }
  return JupiterQuoteResponseSchema.parse(JSON.parse(response.bodyText));
}

export async function buildTerminalDepthPayload(payload: TerminalDepthRequest) {
  if (payload.chainType !== "solana") {
    throw new Error("TERMINAL_DEPTH_SOLANA_ONLY");
  }

  const [_, trades] = await Promise.all([
    getHeliusTokenMetadataForMint({ mint: payload.tokenMint, chainType: payload.chainType }),
    loadChartTrades({
      tokenAddress: payload.tokenMint,
      pairAddress: payload.pairAddress,
      chainType: payload.chainType,
      limit: 24,
    }),
  ]);

  const tokenDecimals = 6;

  const recentPrice =
    trades.find((trade) => typeof trade.priceUsd === "number" && Number.isFinite(trade.priceUsd))?.priceUsd ?? null;
  const quoteSizesUsd = [5, 10, 25, 50, 100, 250];

  const bidQuotes = await Promise.all(
    quoteSizesUsd.map(async (usdSize) => {
      const quote = await fetchDerivedTerminalQuote({
        inputMint: SOLANA_USDC_MINT,
        outputMint: payload.tokenMint,
        amount: Math.round(usdSize * 1_000_000),
      });
      const outputAmount = Number(quote.outAmount) / Math.pow(10, tokenDecimals);
      const unitPrice = outputAmount > 0 ? usdSize / outputAmount : recentPrice ?? 0;
      return {
        price: Number(unitPrice.toFixed(10)),
        amount: Number(outputAmount.toFixed(4)),
        totalUsd: usdSize,
        side: "bid" as const,
      };
    }),
  );

  const sellSizesToken = quoteSizesUsd.map((usdSize) => {
    const referencePrice = recentPrice && recentPrice > 0 ? recentPrice : bidQuotes[0]?.price ?? 0.000001;
    return Math.max(1, usdSize / referencePrice);
  });

  const askQuotes = await Promise.all(
    sellSizesToken.map(async (tokenAmount) => {
      const atomicAmount = Math.max(1, Math.round(tokenAmount * Math.pow(10, tokenDecimals)));
      const quote = await fetchDerivedTerminalQuote({
        inputMint: payload.tokenMint,
        outputMint: SOLANA_USDC_MINT,
        amount: atomicAmount,
      });
      const outUsd = Number(quote.outAmount) / 1_000_000;
      const unitPrice = tokenAmount > 0 ? outUsd / tokenAmount : recentPrice ?? 0;
      return {
        price: Number(unitPrice.toFixed(10)),
        amount: Number(tokenAmount.toFixed(4)),
        totalUsd: Number(outUsd.toFixed(2)),
        side: "ask" as const,
      };
    }),
  );

  const bestBid = bidQuotes[0]?.price ?? recentPrice ?? null;
  const bestAsk = askQuotes[0]?.price ?? recentPrice ?? null;
  const spread =
    bestBid !== null && bestAsk !== null ? Number(Math.max(0, bestAsk - bestBid).toFixed(10)) : null;

  const depthSeries = [
    ...askQuotes.map((quote, index) => ({
      side: "ask" as const,
      level: index + 1,
      cumulativeUsd: Number(
        askQuotes.slice(0, index + 1).reduce((sum, entry) => sum + entry.totalUsd, 0).toFixed(2),
      ),
      price: quote.price,
    })),
    ...bidQuotes.map((quote, index) => ({
      side: "bid" as const,
      level: index + 1,
      cumulativeUsd: Number(
        bidQuotes.slice(0, index + 1).reduce((sum, entry) => sum + entry.totalUsd, 0).toFixed(2),
      ),
      price: quote.price,
    })),
  ];

  return {
    bids: bidQuotes.sort((left, right) => right.price - left.price),
    asks: askQuotes.sort((left, right) => left.price - right.price),
    spread,
    depthSeries,
    positionSummary: {
      tokenMint: payload.tokenMint,
      tokenDecimals,
      referencePrice: recentPrice ?? bestBid ?? bestAsk,
      recentTradeCount: trades.length,
    },
  };
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

export async function fetchBestChartCandles(payload: ChartCandlesPayload): Promise<ChartCandlesFetchResult> {
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
  "/trade-context",
  requireNotBanned,
  zValidator("json", TradePanelContextSchema),
  async (c) => {
    const currentUser = c.get("user");
    if (!currentUser) {
      return c.json({ error: { message: "Unauthorized", code: "UNAUTHORIZED" } }, 401);
    }

    const { walletAddress, tokenMint } = c.req.valid("json");
    const linkedWallet = await prisma.user.findUnique({
      where: { id: currentUser.id },
      select: { walletAddress: true },
    });
    if (!linkedWallet?.walletAddress) {
      return c.json(
        { error: { message: "Link a wallet before trading", code: "WALLET_NOT_LINKED" } },
        403
      );
    }
    const normalizedLinkedWalletAddress = new PublicKey(linkedWallet.walletAddress).toBase58();
    const normalizedWalletAddress = new PublicKey(walletAddress).toBase58();
    const normalizedTokenMint = new PublicKey(tokenMint).toBase58();
    if (normalizedLinkedWalletAddress !== normalizedWalletAddress) {
      return c.json(
        { error: { message: "Trade access is restricted to the linked wallet owner", code: "FORBIDDEN" } },
        403
      );
    }

    const cacheKey = `${normalizedWalletAddress}:${normalizedTokenMint}`;
    const now = Date.now();
    const cached = tradePanelContextCache.get(cacheKey);
    if (cached && cached.expiresAtMs > now) {
      return c.json({ data: cached.data });
    }

    let request = tradePanelContextInFlight.get(cacheKey);
    if (!request) {
      request = getHeliusTradePanelContext({
        walletAddress: normalizedWalletAddress,
        tokenMint: normalizedTokenMint,
      });
      tradePanelContextInFlight.set(cacheKey, request);
    }

    try {
      const data = await request;
      tradePanelContextCache.set(cacheKey, {
        data,
        expiresAtMs: Date.now() + TRADE_PANEL_CONTEXT_CACHE_TTL_MS,
      });
      return c.json({ data });
    } catch (error) {
      return c.json(
        {
          error: {
            message: getErrorMessage(error),
            code: "TRADE_CONTEXT_FAILED",
          },
        },
        502
      );
    } finally {
      const current = tradePanelContextInFlight.get(cacheKey);
      if (current === request) {
        tradePanelContextInFlight.delete(cacheKey);
      }
    }
  }
);

postsRouter.post(
  "/portfolio",
  requireNotBanned,
  zValidator("json", PortfolioRequestSchema),
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
    const normalizedLinkedWalletAddress = new PublicKey(linkedWallet.walletAddress).toBase58();
    const normalizedWalletAddress = new PublicKey(walletAddress).toBase58();
    if (normalizedLinkedWalletAddress !== normalizedWalletAddress) {
      return c.json(
        { error: { message: "Portfolio access is restricted to the linked wallet owner", code: "FORBIDDEN" } },
        403
      );
    }
    const normalizedTokenMints = tokenMints?.map((mint) => new PublicKey(mint).toBase58());

    const hasExplicitMints = Array.isArray(normalizedTokenMints) && normalizedTokenMints.length > 0;

    // Get trade snapshots (holdings + prices) for all mints
    const snapshots = await getWalletTradeSnapshotsForSolanaTokens({
      walletAddress: normalizedWalletAddress,
      tokenMints: normalizedTokenMints,
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
        ? normalizedTokenMints
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

postsRouter.post(
  "/terminal/depth",
  zValidator("json", TerminalDepthRequestSchema),
  async (c) => {
    try {
      const payload = c.req.valid("json");
      const data = await buildTerminalDepthPayload(payload);
      return c.json({ data });
    } catch (error) {
      if (getErrorMessage(error) === "TERMINAL_DEPTH_SOLANA_ONLY") {
        return c.json(
          {
            error: {
              message: "Terminal depth is currently available for Solana markets only",
              code: "TERMINAL_DEPTH_SOLANA_ONLY",
            },
          },
          400
        );
      }
      return c.json(
        {
          error: {
            message: getErrorMessage(error),
            code: "TERMINAL_DEPTH_FAILED",
          },
        },
        502
      );
    }
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

postsRouter.get("/chart/trades", zValidator("query", ChartTradesQuerySchema), async (c) => {
  const payload = c.req.valid("query");
  try {
    const trades = await loadChartTrades(payload);
    return c.json({
      data: {
        trades,
        source: hasBirdeyeTradeFeedConfig() ? "birdeye" : "unavailable",
        liveSupported: hasBirdeyeTradeFeedConfig(),
      },
    });
  } catch (error) {
    return c.json(
      {
        error: {
          message: getErrorMessage(error),
          code: "CHART_TRADES_FAILED",
        },
      },
      502
    );
  }
});

postsRouter.get("/chart/live", zValidator("query", ChartLiveQuerySchema), async (c) => {
  const payload = c.req.valid("query");
  if (!hasBirdeyeTradeFeedConfig()) {
    return c.json(
      {
        error: {
          message: "Live stream is unavailable for this deployment",
          code: "CHART_LIVE_UNAVAILABLE",
        },
      },
      503
    );
  }

  const encoder = new TextEncoder();
  const chainType = toBirdeyeTradeFeedChain(payload.chainType);

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      let keepAliveInterval: ReturnType<typeof setInterval> | null = null;
      let maxDurationTimeout: ReturnType<typeof setTimeout> | null = null;
      let detachAbort: (() => void) | null = null;
      let liveFeedCloser: (() => void) | null = null;

      const writeChunk = (chunk: string) => {
        if (closed) return;
        controller.enqueue(encoder.encode(chunk));
      };

      const writeEvent = (event: string, data: unknown) => {
        writeChunk(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      };
      const writeSnapshot = (snapshot: Pick<TradeFeedSnapshot, "recentTrades" | "latestPrice">) => {
        if (snapshot.recentTrades.length > 0 || snapshot.latestPrice) {
          writeEvent("snapshot", {
            trades: snapshot.recentTrades,
            latestPrice: snapshot.latestPrice,
          });
        }
      };

      const cleanup = () => {
        if (closed) return;
        closed = true;
        if (keepAliveInterval) {
          clearInterval(keepAliveInterval);
          keepAliveInterval = null;
        }
        if (maxDurationTimeout) {
          clearTimeout(maxDurationTimeout);
          maxDurationTimeout = null;
        }
        detachAbort?.();
        detachAbort = null;
        liveFeedCloser?.();
        liveFeedCloser = null;
        try {
          controller.close();
        } catch {
          // Ignore double-close races during disconnect.
        }
      };

      writeChunk("retry: 1000\n\n");

      keepAliveInterval = setInterval(() => {
        writeChunk(`: keepalive ${Date.now()}\n\n`);
      }, CHART_LIVE_STREAM_KEEPALIVE_MS);
      maxDurationTimeout = setTimeout(() => {
        writeEvent("status", {
          connected: false,
          mode: "fallback",
          reason: "Live stream recycled",
          timestampMs: Date.now(),
        } satisfies TradeFeedStatus);
        cleanup();
      }, CHART_LIVE_STREAM_MAX_DURATION_MS);

      const abortSignal = c.req.raw.signal;
      const onAbort = () => cleanup();
      abortSignal.addEventListener("abort", onAbort, { once: true });
      detachAbort = () => abortSignal.removeEventListener("abort", onAbort);

      const liveFeed = startBirdeyeLiveFeed({
        chainType,
        tokenAddress: payload.tokenAddress,
        pairAddress: payload.pairAddress,
        onSnapshot: (snapshot) => {
          writeSnapshot(snapshot);
        },
        onPrice: (update) => {
          writeEvent("price", update);
        },
        onTrade: (trade) => {
          writeEvent("trade", trade);
        },
        onStatus: (status) => {
          writeEvent("status", status);
        },
        onError: (error) => {
          writeEvent("status", {
            connected: false,
            mode: "fallback",
            reason: getErrorMessage(error),
            timestampMs: Date.now(),
          } satisfies TradeFeedStatus);
        },
      });

      const initialSnapshot = liveFeed.snapshot;
      writeSnapshot(initialSnapshot);
      writeEvent("status", initialSnapshot.status);
      if (initialSnapshot.recentTrades.length === 0) {
        void loadChartTrades({
          tokenAddress: payload.tokenAddress,
          pairAddress: payload.pairAddress,
          chainType,
          limit: 24,
        })
          .then((trades) => {
            if (trades.length > 0) {
              writeEvent("snapshot", {
                trades,
                latestPrice: initialSnapshot.latestPrice,
              });
            }
          })
          .catch((error) => {
            writeEvent("status", {
              connected: false,
              mode: "fallback",
              reason: `Trade seed unavailable: ${getErrorMessage(error)}`,
              timestampMs: Date.now(),
            } satisfies TradeFeedStatus);
          });
      }

      liveFeedCloser = liveFeed.close;
    },
    cancel() {
      // Request abort cleanup runs through the bound signal listener.
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    },
  });
});

postsRouter.post("/prices", zValidator("json", BatchPostPricesSchema), async (c) => {
  c.header("Cache-Control", "no-store");
  const { ids } = c.req.valid("json");
  const uniqueIds = [...new Set(ids)].slice(0, 50);
  const cachedCandidatePosts = uniqueIds
    .map((id) => findCachedFeedPostPriceRecord(id))
    .filter((post): post is PriceRoutePostRecord => post !== null);
  if (cachedCandidatePosts.length > 0) {
    triggerMaintenanceForStaleCandidates("prices:cached", cachedCandidatePosts);
  }
  const freshCachedEntries = await Promise.all(
    uniqueIds.map(async (id) => [id, await resolveCachedPostPricePayload(id)] as const)
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

  if (await isPrismaPoolPressureActive()) {
    const staleCachedEntries = await Promise.all(
      missingIds.map(async (id) => [id, await resolveCachedPostPricePayload(id, { allowStale: true })] as const)
    );
    for (const [id, cached] of staleCachedEntries) {
      if (cached) {
        payloadById.set(id, cached);
      }
    }

    console.warn("[posts/prices] pool pressure active; serving cached-or-empty batch payload", {
      requestedIds: uniqueIds.length,
      cachedIds: payloadById.size,
    });

    return c.json({
      data: Object.fromEntries(
        uniqueIds.flatMap((id) => {
          const payload = payloadById.get(id);
          return payload ? [[id, payload] as const] : [];
        })
      ),
    });
  }

  let posts: IntelligenceCallRecord[] = [];
  let databaseLookupError: unknown = null;
  try {
    posts = await withPrismaRetry(
      () => prisma.post.findMany({
        where: { id: { in: missingIds } },
        select: INTELLIGENCE_CALL_SELECT,
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
    const resolvedPayloadById = new Map(
      await Promise.all(
      posts.map(async (post) => {
        const payload = await resolvePostPricePayload(post);
        return [post.id, payload] as const;
      })
    )
    );
    await attachRealtimeIntelligenceToPostPricePayloads(posts, resolvedPayloadById, "batch");
    for (const [id, payload] of resolvedPayloadById) {
      writePostPriceCache(id, payload);
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
  c.header("Cache-Control", "no-store");
  const postId = c.req.param("id");
  const result = await loadPostPricePayload(postId);
  if (result.state === "ok") {
    return c.json({ data: result.data });
  }
  if (result.state === "not_found") {
    return c.json({ error: { message: "Post not found", code: "NOT_FOUND" } }, 404);
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
});
