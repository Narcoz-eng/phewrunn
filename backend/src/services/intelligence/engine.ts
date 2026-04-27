import { Prisma, type AlertPreference } from "@prisma/client";
import { prisma, isPrismaPoolPressureActive, isTransientPrismaError, notePrismaPoolPressure } from "../../prisma.js";
import {
  applyConfidenceGuardrails,
  buildReactionCounts,
  clampScore,
  computeStateAwareIntelligenceScores,
  computeConfidenceScore,
  computeEarlyRunnerScore,
  computeHolderBreadthScore,
  computeHighConvictionScore,
  computeHotAlphaScore,
  computeOnchainStructureHealthScore,
  computeSentimentScore,
  computeWeightedEngagementPerHour,
  determineBundleRiskLabel,
  determineTimingTier,
  pct,
  type ReactionCounts,
} from "./scoring.js";
import {
  analyzeSolanaTokenDistribution,
  type TokenHolderSnapshot,
} from "./token-metrics.js";
import { refreshTraderMetrics } from "./trader-metrics.js";
import { fanoutTokenSignalAlerts } from "./alerts.js";
import { getCachedMarketCapSnapshot, type MarketCapResult } from "../marketcap.js";
import { getFeedChartPreview } from "../feed-chart-preview.js";
import { enqueueInternalJob, hasQStashPublishConfig, type EnqueueInternalJobInput } from "../../lib/job-queue.js";
import { isRedisConfigured, cacheGetJson, cacheSetJson } from "../../lib/redis.js";
import type { PostType } from "../../types.js";

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
const RANKED_FEED_MIN_CANDIDATE_COUNT = 120;
const RANKED_FEED_MAX_CANDIDATE_COUNT = 180;
const FEED_PRIORITY_REFRESH_TIMEOUT_MS = process.env.NODE_ENV === "production" ? 850 : 1_300;
const FEED_RESULT_CACHE_TTL_MS = 15_000;
const PERSONALIZED_FEED_RESULT_CACHE_TTL_MS = 8_000;
const FEED_LIST_SOFT_TIMEOUT_MS = process.env.NODE_ENV === "production" ? 2_600 : 4_000;
const FOLLOWING_SNAPSHOT_CACHE_TTL_MS = 15_000;
const TOKEN_OVERVIEW_CACHE_TTL_MS = 20_000;
const PERSONALIZED_TOKEN_OVERVIEW_CACHE_TTL_MS = 12_000;
const TOKEN_OVERVIEW_CACHE_VERSION = 11;
const TOKEN_LOOKUP_CACHE_TTL_MS = process.env.NODE_ENV === "production" ? 2 * 60_000 : 15_000;
const TOKEN_LOOKUP_REDIS_TTL_MS = process.env.NODE_ENV === "production" ? 90_000 : 20_000;
const TOKEN_LOOKUP_CACHE_MAX_ENTRIES = 2_000;
const FEED_LIST_CACHE_MAX_ENTRIES = 500;
const TOKEN_OVERVIEW_CACHE_MAX_ENTRIES = 500;
const TRADER_OVERVIEW_CACHE_MAX_ENTRIES = 300;
const FOLLOWING_SNAPSHOT_CACHE_MAX_ENTRIES = 1_000;
const RADAR_CACHE_MAX_ENTRIES = 50;
const LEADERBOARD_CACHE_MAX_ENTRIES = 20;
const TOKEN_HIGH_SIGNAL_REFRESH_STALE_MS = process.env.NODE_ENV === "production" ? 2 * 60_000 : 30_000;
const RADAR_CACHE_TTL_MS = 15_000;
const TRADER_OVERVIEW_CACHE_TTL_MS = 20_000;
const LEADERBOARD_CACHE_TTL_MS = 20_000;
const LEADERBOARD_SNAPSHOT_TTL_MS = 2 * 60_000;
const LEADERBOARD_SNAPSHOT_STALE_REVALIDATE_MS = 20 * 60_000;
const LEADERBOARD_SNAPSHOT_VERSION = 4;
const DAILY_LEADERBOARD_SNAPSHOT_KEY = `intelligence:leaderboards:daily:v${LEADERBOARD_SNAPSHOT_VERSION}`;
const FIRST_CALLER_LEADERBOARD_SNAPSHOT_KEY = `intelligence:leaderboards:first-callers:v${LEADERBOARD_SNAPSHOT_VERSION}`;
const MARKET_CONTEXT_CACHE_TTL_MS = 10 * 60_000;
const TOKEN_OVERVIEW_SECTION_TIMEOUT_MS = process.env.NODE_ENV === "production" ? 1_500 : 2_250;
const TOKEN_OVERVIEW_DISTRIBUTION_SECTION_TIMEOUT_MS =
  process.env.NODE_ENV === "production" ? 5_000 : 7_500;
const TOKEN_CONFIDENCE_MODEL_UPDATED_AT_MS = Date.parse("2026-03-12T00:00:00.000Z");
const STORED_POST_INTELLIGENCE_STALE_MS = 10 * 60_000; // recompute confidence every 10 min
const INTELLIGENCE_PREWARM_INTERVAL_MS = 10 * 60_000;
const INTELLIGENCE_PREWARM_START_DELAY_MS = process.env.NODE_ENV === "production" ? 25_000 : 8_000;
const INTELLIGENCE_PREWARM_TOKEN_LIMIT = 30;
const INTELLIGENCE_REFRESH_JOB_BUCKET_MS = INTELLIGENCE_PREWARM_INTERVAL_MS;
const PRIORITY_FEED_KINDS: FeedKind[] = ["latest", "hot-alpha", "early-runners", "high-conviction"];
const IS_SERVERLESS_RUNTIME =
  !!process.env.VERCEL ||
  !!process.env.AWS_LAMBDA_FUNCTION_NAME ||
  !!process.env.K_SERVICE ||
  !!process.env.FUNCTIONS_WORKER_RUNTIME;
const FEED_COUNT_SUMMARY_QUERY_ENABLED = (() => {
  const raw = process.env.ENABLE_FEED_COUNT_SUMMARIES?.trim().toLowerCase();
  if (raw === "true") return true;
  if (raw === "false") return false;
  return !(process.env.NODE_ENV === "production" && IS_SERVERLESS_RUNTIME);
})();

// Global LRU size registry — every cache Map registers here so writeCacheValue
// can enforce limits on every write without touching each call site.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const cacheMaxEntriesRegistry = new WeakMap<Map<string, any>, number>();

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

const POST_COMMUNITY_SELECT = Prisma.validator<Prisma.TokenCommunityProfileSelect>()({
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
});

const CALL_SELECT = Prisma.validator<Prisma.PostSelect>()({
  id: true,
  content: true,
  postType: true,
  pollExpiresAt: true,
  authorId: true,
  tokenId: true,
  communityId: true,
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
  community: { select: POST_COMMUNITY_SELECT },
  _count: {
    select: {
      likes: true,
      comments: true,
      reposts: true,
      reactions: true,
    },
  },
});

const FEED_CALL_SELECT = Prisma.validator<Prisma.PostSelect>()({
  id: true,
  content: true,
  postType: true,
  pollExpiresAt: true,
  authorId: true,
  tokenId: true,
  communityId: true,
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
  community: { select: POST_COMMUNITY_SELECT },
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
  postType?: PostType;
};

type FeedCountSummary = {
  likes: number;
  comments: number;
  reposts: number;
  reactions: number;
};

type FeedPollSummary = {
  totalVotes: number;
  viewerOptionId: string | null;
  options: Array<{
    id: string;
    label: string;
    votes: number;
    percentage: number;
  }>;
};

type FeedSignalCoverageState = "live" | "partial" | "unavailable";

type FeedSignalCoverage = {
  state: FeedSignalCoverageState;
  source: string;
  unavailableReason: string | null;
};

type FeedSignalContract = {
  tokenAddress: string | null;
  tokenSymbol: string | null;
  tokenLogo: string | null;
  chain: string | null;
  price: number | null;
  priceChange24h: number | null;
  candlesCoverage: FeedSignalCoverage;
  aiScore: number | null;
  aiScoreCoverage: FeedSignalCoverage;
  momentumScore: number | null;
  smartMoneyScore: number | null;
  riskScore: number | null;
  convictionLabel: string;
  riskLabel: string;
  scoreReasons: string[];
  unavailableReasons: string[];
};

type FeedTokenContext = {
  address: string | null;
  symbol: string | null;
  name: string | null;
  logo: string | null;
  chain: string | null;
  dexscreenerUrl: string | null;
};

type FeedChartPreview = {
  state: FeedSignalCoverageState;
  source: string;
  unavailableReason: string | null;
  candles: Array<{
    timestamp: number;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
  }> | null;
};

type FeedItemPayload = {
  call: {
    title: string;
    thesis: string;
    direction: "LONG" | "SHORT" | null;
    token: FeedTokenContext | null;
    metrics: Array<{ label: string; value: number; unit: "usd" | "pct" | "score" }>;
    signalScore: number | null;
    signalLabel: string | null;
    chartPreview: FeedChartPreview | null;
  } | null;
  chart: {
    title: string;
    thesis: string;
    token: FeedTokenContext | null;
    timeframe: string | null;
    chartPreview: FeedChartPreview | null;
  } | null;
  poll: FeedPollSummary | null;
  raid: {
    status: "live" | "upcoming" | "closed" | "unavailable";
    unavailableReason: string | null;
    raidId: string | null;
    token: FeedTokenContext | null;
    participants: number | null;
    posts: number | null;
    progressPct: number | null;
    openedAt: string | null;
    closesAt: string | null;
    ctaRoute: string | null;
    objective: string | null;
  } | null;
  news: {
    headline: string;
    sourceUrl: string | null;
    summary: string;
    publishedAt: string | null;
    relatedToken: FeedTokenContext | null;
  } | null;
  whale: {
    status: "unavailable";
    unavailableReason: string;
  } | null;
  discussion: {
    body: string;
  } | null;
};

export type EnrichedCall = CallRecord & {
  itemType: "post" | "repost" | "raid" | "whale" | "system";
  payload: FeedItemPayload;
  poll: FeedPollSummary | null;
  isLiked: boolean;
  isReposted: boolean;
  isFollowingAuthor: boolean;
  tokenContext: FeedTokenContext | null;
  signal: FeedSignalContract | null;
  engagement: FeedCountSummary & {
    views: number;
    velocity: number;
  };
  coverage: {
    signal: FeedSignalCoverage;
    candles: FeedSignalCoverage;
  };
  feedScore: number;
  feedReasons: string[];
  scoreReasons: string[];
  repostContext: {
    createdAt: Date;
    user: Pick<AuthorRecord, "id" | "name" | "username" | "image" | "level" | "xp" | "isVerified" | "trustScore" | "reputationTier">;
  } | null;
  currentReactionType: string | null;
  reactionCounts: ReactionCounts;
  confidenceScore: number;
  hotAlphaScore: number;
  earlyRunnerScore: number;
  highConvictionScore: number;
  marketHealthScore: number;
  setupQualityScore: number;
  opportunityScore: number;
  dataReliabilityScore: number;
  activityStatus: string;
  activityStatusLabel: string;
  isTradable: boolean;
  bullishSignalsSuppressed: boolean;
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
    currentAction: string | null;
  }>;
  radarReasons: string[];
};

export type RealtimePostIntelligenceSnapshot = Pick<
  EnrichedCall,
  | "confidenceScore"
  | "hotAlphaScore"
  | "earlyRunnerScore"
  | "highConvictionScore"
  | "marketHealthScore"
  | "setupQualityScore"
  | "opportunityScore"
  | "dataReliabilityScore"
  | "activityStatus"
  | "activityStatusLabel"
  | "isTradable"
  | "bullishSignalsSuppressed"
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
    communityExists: boolean;
    communityBannerUrl: string | null;
    holderCountSource: "stored" | "helius" | "rpc_scan" | "birdeye" | "largest_accounts" | null;
    topHolders: TokenHolderSnapshot[];
    devWallet: TokenHolderSnapshot | null;
    bundleClusters: Array<{
      id: string;
      clusterLabel: string;
      walletCount: number;
      estimatedSupplyPct: number;
      evidenceJson: unknown;
      currentAction: string | null;
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
      marketHealthScore: number;
      setupQualityScore: number;
      opportunityScore: number;
      dataReliabilityScore: number;
      activityStatus: string;
      activityStatusLabel: string;
      isTradable: boolean;
      bullishSignalsSuppressed: boolean;
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
const tokenLookupCache = new Map<string, CacheEntry<TokenRecord | null>>();
const tokenLookupInFlight = new Map<string, Promise<TokenRecord | null>>();
const tokenOverviewCache = new Map<string, CacheEntry<TokenOverview | null>>();
const tokenOverviewInFlight = new Map<string, Promise<TokenOverview | null>>();
const tokenRefreshInFlight = new Map<string, Promise<TokenRefreshResult | null>>();
const tokenRefreshAttemptAt = new Map<string, number>();
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

// Register LRU size limits — writeCacheValue enforces these on every write.
cacheMaxEntriesRegistry.set(feedListCache, FEED_LIST_CACHE_MAX_ENTRIES);
cacheMaxEntriesRegistry.set(followingSnapshotCache, FOLLOWING_SNAPSHOT_CACHE_MAX_ENTRIES);
cacheMaxEntriesRegistry.set(tokenLookupCache, TOKEN_LOOKUP_CACHE_MAX_ENTRIES);
cacheMaxEntriesRegistry.set(tokenOverviewCache, TOKEN_OVERVIEW_CACHE_MAX_ENTRIES);
cacheMaxEntriesRegistry.set(radarCache, RADAR_CACHE_MAX_ENTRIES);
cacheMaxEntriesRegistry.set(traderOverviewCache, TRADER_OVERVIEW_CACHE_MAX_ENTRIES);
cacheMaxEntriesRegistry.set(dailyLeaderboardsCache, LEADERBOARD_CACHE_MAX_ENTRIES);
cacheMaxEntriesRegistry.set(firstCallerLeaderboardsCache, LEADERBOARD_CACHE_MAX_ENTRIES);

let intelligencePriorityLoopTimer: ReturnType<typeof setInterval> | null = null;
let intelligencePriorityLoopInFlight: Promise<void> | null = null;
let intelligencePriorityLoopCanRun: (() => boolean) | null = null;

type TokenRefreshResult = {
  token: TokenRecord;
  previousToken: TokenRecord | null;
  refreshed: boolean;
};

type IntelligencePrewarmResult = {
  attempted: number;
  refreshed: number;
  skipped: number;
  errors: number;
  durationMs: number;
};

type MarketContextSnapshot = {
  label: "risk-on" | "balanced" | "risk-off";
  breadthScore: number;
  confidenceBias: number;
  accelerationMultiplier: number;
};

function buildTokenLookupCacheKey(address: string): string {
  return `token:lookup:${sanitizeCacheKeyPart(address.trim().toLowerCase())}`;
}

function writeTokenLookupCacheValue(address: string, value: TokenRecord | null): void {
  evictOldestFromMap(tokenLookupCache, TOKEN_LOOKUP_CACHE_MAX_ENTRIES);
  tokenLookupCache.set(buildTokenLookupCacheKey(address), {
    value: cloneCachedValue(value),
    expiresAt: Date.now() + TOKEN_LOOKUP_CACHE_TTL_MS,
  });
}

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

function normalizeOptionalDate(value: Date | string | null | undefined): Date | null {
  if (value instanceof Date) {
    return Number.isFinite(value.getTime()) ? value : null;
  }
  if (typeof value !== "string") {
    return null;
  }
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
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

function computeDexSentimentTrendAdjustment(
  marketSnapshot: Pick<MarketCapResult, "priceChange24hPct" | "buys24h" | "sells24h"> | null | undefined
): number {
  const priceChangePct = finite(marketSnapshot?.priceChange24hPct);
  const buys24h = Math.max(0, finite(marketSnapshot?.buys24h));
  const sells24h = Math.max(0, finite(marketSnapshot?.sells24h));
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

function writeCacheValue<T>(cache: Map<string, CacheEntry<T>>, key: string, value: T, ttlMs: number, maxEntries?: number): T {
  const resolvedMax = maxEntries ?? cacheMaxEntriesRegistry.get(cache);
  if (resolvedMax !== undefined) evictOldestFromMap(cache, resolvedMax);
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
  loader: () => Promise<T>,
  maxEntries?: number
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
    .then((value) => writeCacheValue(cache, key, value, ttlMs, maxEntries))
    .finally(() => {
      inFlight.delete(key);
    });

  inFlight.set(key, promise);
  return cloneCachedValue(await promise);
}

async function loadFeedCountSummaries(postIds: string[]): Promise<Map<string, FeedCountSummary>> {
  if (postIds.length === 0) {
    return new Map();
  }

  if (!FEED_COUNT_SUMMARY_QUERY_ENABLED) {
    return new Map();
  }

  try {
    const counts = new Map<string, FeedCountSummary>();
    const rows = await prisma.$queryRaw<
      Array<{ postId: string; kind: string; count: number | bigint }>
    >(Prisma.sql`
      SELECT "postId", 'likes' AS kind, COUNT(*)::int AS count
      FROM "Like"
      WHERE "postId" IN (${Prisma.join(postIds)})
      GROUP BY "postId"
      UNION ALL
      SELECT "postId", 'comments' AS kind, COUNT(*)::int AS count
      FROM "Comment"
      WHERE "postId" IN (${Prisma.join(postIds)}) AND "deletedAt" IS NULL
      GROUP BY "postId"
      UNION ALL
      SELECT "postId", 'reposts' AS kind, COUNT(*)::int AS count
      FROM "Repost"
      WHERE "postId" IN (${Prisma.join(postIds)})
      GROUP BY "postId"
    `);

    for (const row of rows) {
      const value = typeof row.count === "bigint" ? Number(row.count) : Number(row.count ?? 0);
      if (!Number.isFinite(value) || value < 0) continue;
      const current = counts.get(row.postId) ?? {
        likes: 0,
        comments: 0,
        reposts: 0,
        reactions: 0,
      };
      if (row.kind === "likes") current.likes = value;
      if (row.kind === "comments") current.comments = value;
      if (row.kind === "reposts") current.reposts = value;
      counts.set(row.postId, current);
    }
    return counts;
  } catch (error) {
    if (!isTransientPrismaError(error)) {
      throw error;
    }
    console.warn("[intelligence/feed] count summaries degraded during transient prisma pressure", {
      postCount: postIds.length,
      message: error instanceof Error ? error.message : String(error),
    });
    return new Map();
  }
}

function evictOldestFromMap<V>(map: Map<string, V>, maxEntries: number): void {
  while (map.size >= maxEntries) {
    const oldestKey = map.keys().next().value;
    if (typeof oldestKey !== "string") break;
    map.delete(oldestKey);
  }
}

function serializeWithDates(value: unknown): string {
  return JSON.stringify(value, (_key, val) => {
    if (val instanceof Date) return { __date__: val.getTime() };
    return val;
  });
}

function deserializeWithDates<T>(raw: string): T {
  return JSON.parse(raw, (_key, val) => {
    if (val && typeof val === "object" && "__date__" in val && typeof val.__date__ === "number") {
      return new Date(val.__date__);
    }
    return val;
  });
}

function buildTokenLookupRedisKey(address: string): string {
  return `intelligence:token:lookup:v1:${address.trim().toLowerCase()}`;
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
  clearCacheEntriesByPrefix(tokenOverviewCache, `token:v${TOKEN_OVERVIEW_CACHE_VERSION}:${normalizedViewerId}:`);
  clearCacheEntriesByPrefix(tokenOverviewInFlight, `token:v${TOKEN_OVERVIEW_CACHE_VERSION}:${normalizedViewerId}:`);
  clearCacheEntriesByPrefix(traderOverviewCache, `trader:${normalizedViewerId}:`);
  clearCacheEntriesByPrefix(traderOverviewInFlight, `trader:${normalizedViewerId}:`);
  clearCacheEntriesByPrefix(dailyLeaderboardsCache, `leaderboards:daily:${normalizedViewerId}`);
  clearCacheEntriesByPrefix(dailyLeaderboardsInFlight, `leaderboards:daily:${normalizedViewerId}`);
  clearCacheEntriesByPrefix(firstCallerLeaderboardsCache, `leaderboards:first-callers:${normalizedViewerId}`);
  clearCacheEntriesByPrefix(firstCallerLeaderboardsInFlight, `leaderboards:first-callers:${normalizedViewerId}`);
}

export function invalidateFeedListCaches(): void {
  feedListCache.clear();
  feedListInFlight.clear();
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
  const lastIntelligenceAt = toDateMs(record.lastIntelligenceAt);
  if (lastIntelligenceAt <= 0) {
    return false;
  }
  if (lastIntelligenceAt < TOKEN_CONFIDENCE_MODEL_UPDATED_AT_MS) {
    return false;
  }
  // Expire stored confidence after 10 minutes so holder growth, volume, sentiment & momentum signals stay fresh
  if (Date.now() - lastIntelligenceAt > STORED_POST_INTELLIGENCE_STALE_MS) {
    return false;
  }

  return resolvePostIntelligenceSignalVersion(record) <= lastIntelligenceAt;
}

function looksLikeLowerBoundSolanaHolderCount(args: {
  storedHolderCount: number | null | undefined;
  observedTopHolderCount: number;
  liveHolderCount: number | null | undefined;
  liveHolderCountSource: TokenOverview["token"]["holderCountSource"] | "stored" | null | undefined;
}): boolean {
  if (!hasPositiveMetric(args.storedHolderCount)) {
    return false;
  }
  const hasVerifiedLiveCountSource = hasVerifiedSolanaHolderCount(args.liveHolderCount, args.liveHolderCountSource);
  if (hasVerifiedLiveCountSource) {
    return false;
  }

  const normalizedStoredCount = Math.round(args.storedHolderCount);
  if (normalizedStoredCount === 1000) {
    return true;
  }
  if (args.observedTopHolderCount >= 20) {
    return normalizedStoredCount <= args.observedTopHolderCount;
  }

  return args.observedTopHolderCount >= 10 && normalizedStoredCount <= 20;
}

function hasVerifiedSolanaHolderCount(
  holderCount: number | null | undefined,
  holderCountSource: TokenOverview["token"]["holderCountSource"] | "stored" | null | undefined
): boolean {
  return (
    holderCountSource !== "largest_accounts" &&
    holderCountSource !== null &&
    hasPositiveMetric(holderCount) &&
    !(
      (holderCountSource === "stored" ||
        holderCountSource === "helius" ||
        holderCountSource === "rpc_scan" ||
        holderCountSource === "birdeye") &&
      Math.round(holderCount) === 1000
    )
  );
}

function hasResolvedHolderRoleFields(
  holder: Pick<TokenHolderSnapshot, "badges" | "devRole" | "activeAgeDays" | "fundedBy" | "tradeVolume90dSol" | "solBalance" | "label"> | null | undefined
): boolean {
  if (!holder) {
    return false;
  }

  return Boolean(
    holder.badges.length > 0 ||
      holder.activeAgeDays !== null ||
      holder.fundedBy !== null ||
      holder.tradeVolume90dSol !== null ||
      holder.solBalance !== null ||
      (typeof holder.label === "string" && holder.label.trim().length > 0)
  );
}

function hasResolvedHolderRoleIntelligence(
  topHolders: TokenHolderSnapshot[] | null | undefined,
  devWallet: TokenHolderSnapshot | null | undefined
): boolean {
  return Boolean((topHolders ?? []).some((holder) => hasResolvedHolderRoleFields(holder)));
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
            liquidity: true,
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
      // Tracks what share of recent calls have severely collapsed — feeds market risk-off bias
      const severeCollapseRate =
        callRois.length > 0
          ? (callRois.filter((value) => value <= -70).length / callRois.length) * 100
          : 0;
      // Tracks how many active tokens have near-zero liquidity (effectively dead)
      const deadLiquidityShare =
        activeTokens.length > 0
          ? (activeTokens.filter((token) => {
              const liq = finite(token.liquidity);
              return liq > 0 && liq < 5_000;
            }).length / activeTokens.length) * 100
          : 0;
      // Combine collapse signals into a single bearish pressure score (0–100, higher = more dead tokens)
      const marketStressScore = clampScore(0.6 * severeCollapseRate + 0.4 * deadLiquidityShare);

      const breadthScore = clampScore(
        0.22 * positiveCallShare +
          0.16 * positiveMomentumScore +
          0.17 * realizedWinShare +
          0.15 * averageSentimentScore +
          0.11 * lowRiskShare +
          0.11 * activeSignalShare -
          0.08 * marketStressScore
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
  if (!token) return false;
  if (tokenNeedsCoreHydration(token)) return true;
  const lastIntelligenceAt = normalizeOptionalDate(token.lastIntelligenceAt);
  if (!lastIntelligenceAt) return true;
  if (lastIntelligenceAt.getTime() < TOKEN_CONFIDENCE_MODEL_UPDATED_AT_MS) return true;

  const hasHighSignal =
    finite(token.hotAlphaScore) >= HOT_ALPHA_THRESHOLD ||
    finite(token.earlyRunnerScore) >= EARLY_RUNNER_THRESHOLD ||
    finite(token.highConvictionScore) >= HIGH_CONVICTION_THRESHOLD;
  const staleAfterMs = hasHighSignal
    ? TOKEN_HIGH_SIGNAL_REFRESH_STALE_MS
    : TOKEN_INTELLIGENCE_STALE_MS;

  return Date.now() - lastIntelligenceAt.getTime() > staleAfterMs;
}

function hasFreshStoredTokenIntelligence(
  token:
    | Pick<
        TokenRecord,
        "lastIntelligenceAt" | "hotAlphaScore" | "earlyRunnerScore" | "highConvictionScore"
      >
    | null
    | undefined
): boolean {
  const lastIntelligenceAt = normalizeOptionalDate(token?.lastIntelligenceAt);
  if (!token || !lastIntelligenceAt) {
    return false;
  }
  if (lastIntelligenceAt.getTime() < TOKEN_CONFIDENCE_MODEL_UPDATED_AT_MS) {
    return false;
  }

  const hasHighSignal =
    finite(token.hotAlphaScore) >= HOT_ALPHA_THRESHOLD ||
    finite(token.earlyRunnerScore) >= EARLY_RUNNER_THRESHOLD ||
    finite(token.highConvictionScore) >= HIGH_CONVICTION_THRESHOLD;
  const staleAfterMs = hasHighSignal
    ? TOKEN_HIGH_SIGNAL_REFRESH_STALE_MS
    : TOKEN_INTELLIGENCE_STALE_MS;

  return Date.now() - lastIntelligenceAt.getTime() <= staleAfterMs;
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

function feedCoverage(
  state: FeedSignalCoverageState,
  source: string,
  unavailableReason: string | null = null
): FeedSignalCoverage {
  return { state, source, unavailableReason };
}

function signalRiskLabel(score: number | null): string {
  if (typeof score !== "number" || !Number.isFinite(score)) return "Unavailable";
  if (score >= 70) return "High";
  if (score >= 40) return "Medium";
  return "Low";
}

function signalConvictionLabel(score: number | null): string {
  if (typeof score !== "number" || !Number.isFinite(score)) return "Not enough signal";
  if (score >= 82) return "High conviction";
  if (score >= 65) return "Bullish";
  if (score >= 45) return "Monitoring";
  return "Low conviction";
}

function inferBackendSignalDirection(content: string): "LONG" | "SHORT" | null {
  const normalized = content.trim().toLowerCase();
  if (!normalized) return null;
  if (normalized.startsWith("short ") || normalized.includes(" short ") || normalized.includes("bearish")) {
    return "SHORT";
  }
  if (normalized.startsWith("long ") || normalized.includes(" long ") || normalized.includes("bullish")) {
    return "LONG";
  }
  return null;
}

function stripComposerIntentPrefix(content: string): string {
  return content.replace(/^(long|short)\s+/i, "").trim();
}

function buildUnavailableChartPreview(coverage: FeedSignalCoverage): FeedChartPreview | null {
  if (coverage.state !== "unavailable" && !coverage.unavailableReason) {
    return null;
  }
  return {
    state: "unavailable",
    source: coverage.source,
    unavailableReason: coverage.unavailableReason ?? "No feed chart preview was provided by the backend.",
    candles: null,
  };
}

function applyChartPreviewToPayload(payload: FeedItemPayload, chartPreview: FeedChartPreview): FeedItemPayload {
  if (payload.call) {
    return { ...payload, call: { ...payload.call, chartPreview } };
  }
  if (payload.chart) {
    return { ...payload, chart: { ...payload.chart, chartPreview } };
  }
  return payload;
}

function applyRaidPayload(payload: FeedItemPayload, raid: NonNullable<FeedItemPayload["raid"]>): FeedItemPayload {
  return { ...payload, raid };
}

function applyNewsMetadata(payload: FeedItemPayload, news: NonNullable<FeedItemPayload["news"]>): FeedItemPayload {
  return { ...payload, news };
}

function readJsonRecord(value: Prisma.JsonValue | null | undefined): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function readJsonString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

async function enrichSelectedFeedPayloads(items: EnrichedCall[]): Promise<EnrichedCall[]> {
  if (items.length === 0) return items;

  const chartCandidates = items
    .filter((item) => (item.payload.call || item.payload.chart) && item.token?.address)
    .slice(0, 8);
  const raidTokenIds = Array.from(new Set(items
    .filter((item) => item.postType === "raid" && item.tokenId)
    .map((item) => item.tokenId!)
  ));
  const newsTokenIds = Array.from(new Set(items
    .filter((item) => item.postType === "news" && item.tokenId)
    .map((item) => item.tokenId!)
  ));

  const [chartResults, raids, newsEvents] = await Promise.all([
    withSoftTimeout(
      Promise.allSettled(
        chartCandidates.map(async (item) => {
          const preview = await getFeedChartPreview({
            tokenAddress: item.token?.address ?? item.contractAddress,
            pairAddress: item.token?.pairAddress ?? null,
            chainType: item.token?.chainType ?? item.chainType,
          });
          return [item.id, preview] as const;
        })
      ),
      2_600
    ),
    raidTokenIds.length
      ? prisma.tokenRaidCampaign.findMany({
          where: { tokenId: { in: raidTokenIds }, status: { in: ["active", "upcoming"] } },
          orderBy: [{ status: "asc" }, { openedAt: "desc" }],
          include: {
            token: { select: TOKEN_SELECT },
            participants: { select: { id: true, postedAt: true } },
            submissions: { select: { id: true, postedAt: true } },
          },
        }).catch(() => [])
      : Promise.resolve([]),
    newsTokenIds.length
      ? prisma.tokenEvent.findMany({
          where: { tokenId: { in: newsTokenIds } },
          orderBy: { timestamp: "desc" },
          take: Math.max(20, newsTokenIds.length * 3),
        }).catch(() => [])
      : Promise.resolve([]),
  ]);

  const chartByPostId = new Map<string, FeedChartPreview>();
  for (const result of chartResults ?? []) {
    if (result.status === "fulfilled") {
      chartByPostId.set(result.value[0], result.value[1]);
    }
  }

  const raidByTokenId = new Map<string, (typeof raids)[number]>();
  for (const raid of raids) {
    if (!raidByTokenId.has(raid.tokenId)) raidByTokenId.set(raid.tokenId, raid);
  }

  const newsByTokenId = new Map<string, (typeof newsEvents)[number]>();
  for (const event of newsEvents) {
    if (!newsByTokenId.has(event.tokenId)) newsByTokenId.set(event.tokenId, event);
  }

  return items.map((item) => {
    let payload = item.payload;
    const chartPreview = chartByPostId.get(item.id);
    if (chartPreview) {
      payload = applyChartPreviewToPayload(payload, chartPreview);
    }

    if (item.postType === "raid" && item.tokenId) {
      const raid = raidByTokenId.get(item.tokenId);
      if (raid) {
        const participantCount = raid.participants.length;
        const postedCount = raid.submissions.filter((submission) => submission.postedAt).length;
        const progressPct = participantCount > 0 ? Math.round((postedCount / participantCount) * 100) : null;
        payload = applyRaidPayload(payload, {
          status: raid.status === "active" ? "live" : raid.status === "upcoming" ? "upcoming" : "closed",
          unavailableReason: null,
          raidId: raid.id,
          token: buildFeedTokenContext(item, raid.token),
          participants: participantCount,
          posts: postedCount,
          progressPct,
          openedAt: raid.openedAt.toISOString(),
          closesAt: raid.closedAt?.toISOString() ?? null,
          ctaRoute: `/raids/${raid.token.address}/${raid.id}`,
          objective: raid.objective,
        });
      }
    }

    if (item.postType === "news" && item.payload.news) {
      const metadata = item.tokenId ? readJsonRecord(newsByTokenId.get(item.tokenId)?.metadata) : null;
      const event = item.tokenId ? newsByTokenId.get(item.tokenId) : null;
      payload = applyNewsMetadata(payload, {
        ...item.payload.news,
        sourceUrl:
          readJsonString(metadata?.sourceUrl) ??
          readJsonString(metadata?.url) ??
          item.payload.news.sourceUrl,
        publishedAt: event?.timestamp.toISOString() ?? item.payload.news.publishedAt,
        relatedToken: item.tokenContext,
      });
    }

    return payload === item.payload ? item : { ...item, payload };
  });
}

function feedMetric(
  label: string,
  value: number | null | undefined,
  unit: "usd" | "pct" | "score",
  options?: { minAbs?: number; requiresLiveSignal?: boolean; signalCoverage?: FeedSignalCoverage | null }
): { label: string; value: number; unit: "usd" | "pct" | "score" } | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  if (options?.requiresLiveSignal && options.signalCoverage?.state !== "live") return null;
  if (options?.minAbs !== undefined && Math.abs(value) < options.minAbs) return null;
  return { label, value, unit };
}

function buildFeedItemPayload(args: {
  record: CallRecord;
  tokenContext: FeedTokenContext | null;
  signal: FeedSignalContract | null;
  poll: FeedPollSummary | null;
  coverage: { signal: FeedSignalCoverage; candles: FeedSignalCoverage };
  roiCurrentPct: number | null;
  roiPeakPct: number | null;
  tokenRiskScore: number | null;
}): FeedItemPayload {
  const body = stripComposerIntentPrefix(args.record.content);
  const symbol = args.tokenContext?.symbol ? `$${args.tokenContext.symbol}` : args.tokenContext?.name ?? "Alpha";
  const direction = inferBackendSignalDirection(args.record.content);
  const chartPreview = buildUnavailableChartPreview(args.coverage.candles);
  const liveSignal = args.coverage.signal.state === "live";
  const metrics = [
    feedMetric("Entry MCap", args.record.entryMcap, "usd"),
    feedMetric("Current MCap", args.record.currentMcap, "usd"),
    feedMetric("Live Move", args.roiCurrentPct, "pct", { minAbs: 0.01 }),
    feedMetric("Peak Move", args.roiPeakPct, "pct", { minAbs: 0.01 }),
    feedMetric("Signal", args.signal?.aiScore, "score", {
      requiresLiveSignal: true,
      signalCoverage: args.signal?.aiScoreCoverage ?? null,
    }),
    feedMetric("Risk", args.signal?.riskScore ?? args.tokenRiskScore, "score", {
      requiresLiveSignal: true,
      signalCoverage: args.signal?.aiScoreCoverage ?? null,
    }),
  ].filter((item): item is { label: string; value: number; unit: "usd" | "pct" | "score" } => Boolean(item));

  const callPayload = {
    title: `${symbol}${direction ? ` ${direction}` : ""}`,
    thesis: body || args.record.content,
    direction,
    token: args.tokenContext,
    metrics: metrics.slice(0, 4),
    signalScore: liveSignal && typeof args.signal?.aiScore === "number" ? args.signal.aiScore : null,
    signalLabel: liveSignal ? args.signal?.convictionLabel ?? null : null,
    chartPreview,
  };

  switch (args.record.postType) {
    case "poll":
      return {
        call: null,
        chart: null,
        poll: args.poll,
        raid: null,
        news: null,
        whale: null,
        discussion: null,
      };
    case "raid":
      return {
        call: null,
        chart: null,
        poll: null,
        raid: {
          status: "unavailable",
          unavailableReason: "This feed post is not linked to a live raid campaign payload.",
          raidId: null,
          token: args.tokenContext,
          participants: null,
          posts: null,
          progressPct: null,
          openedAt: null,
          closesAt: null,
          ctaRoute: null,
          objective: null,
        },
        news: null,
        whale: null,
        discussion: null,
      };
    case "news":
      return {
        call: null,
        chart: null,
        poll: null,
        raid: null,
        news: {
          headline: body.split(/\n+/)[0]?.trim() || "Market news",
          sourceUrl: args.record.dexscreenerUrl,
          summary: body,
          publishedAt: args.record.createdAt.toISOString(),
          relatedToken: args.tokenContext,
        },
        whale: null,
        discussion: null,
      };
    case "discussion":
      return {
        call: null,
        chart: null,
        poll: null,
        raid: null,
        news: null,
        whale: null,
        discussion: { body },
      };
    case "chart":
      return {
        call: null,
        chart: {
          title: `${symbol} Technical Setup`,
          thesis: body,
          token: args.tokenContext,
          timeframe: args.record.timingTier,
          chartPreview,
        },
        poll: null,
        raid: null,
        news: null,
        whale: null,
        discussion: null,
      };
    case "alpha":
    default:
      return {
        call: callPayload,
        chart: null,
        poll: null,
        raid: null,
        news: null,
        whale: null,
        discussion: null,
      };
  }
}

function buildFeedTokenContext(record: CallRecord, token: TokenRecord | null): FeedTokenContext | null {
  const address = token?.address ?? record.contractAddress ?? null;
  const symbol = token?.symbol ?? record.tokenSymbol ?? null;
  const name = token?.name ?? record.tokenName ?? null;
  const logo = token?.imageUrl ?? record.tokenImage ?? null;
  const chain = token?.chainType ?? record.chainType ?? null;
  const dexscreenerUrl = token?.dexscreenerUrl ?? record.dexscreenerUrl ?? null;

  if (!address && !symbol && !name) return null;
  return { address, symbol, name, logo, chain, dexscreenerUrl };
}

function buildFeedSignalContract(args: {
  record: CallRecord;
  token: TokenRecord | null;
  confidenceScore: number | null;
  hotAlphaScore: number | null;
  earlyRunnerScore: number | null;
  highConvictionScore: number | null;
  opportunityScore: number | null;
  tokenRiskScore: number | null;
  trustedTraderCount: number;
  radarReasons: string[];
}): FeedSignalContract | null {
  const { record, token } = args;
  const tokenAddress = token?.address ?? record.contractAddress ?? null;
  const tokenSymbol = token?.symbol ?? record.tokenSymbol ?? null;
  const tokenLogo = token?.imageUrl ?? record.tokenImage ?? null;
  const chain = token?.chainType ?? record.chainType ?? null;
  if (!tokenAddress && !tokenSymbol && !tokenLogo) return null;

  const unavailableReasons: string[] = [];
  const hasMarket =
    typeof token?.liquidity === "number" ||
    typeof token?.volume24h === "number" ||
    typeof record.currentMcap === "number";
  const hasSocial =
    args.trustedTraderCount > 0 ||
    args.radarReasons.length > 0 ||
    typeof record.threadCount === "number" ||
    record._count.likes + record._count.comments + record._count.reposts > 0;
  const hasRisk = typeof args.tokenRiskScore === "number" || typeof token?.top10HolderPct === "number";
  const sourceCount = [hasMarket, hasSocial, hasRisk].filter(Boolean).length;

  if (!tokenAddress) unavailableReasons.push("No token address attached.");
  if (!hasMarket) unavailableReasons.push("No market/liquidity snapshot attached.");
  if (!hasRisk) unavailableReasons.push("Holder/risk coverage is not resolved.");
  if (typeof args.confidenceScore !== "number") unavailableReasons.push("AI score requires market or social signal coverage.");

  const aiCoverage =
    sourceCount >= 2
      ? feedCoverage("live", "phew-signal-engine")
      : sourceCount === 1
        ? feedCoverage("partial", "phew-signal-engine", "Signal is based on partial market/social coverage.")
        : feedCoverage("unavailable", "phew-signal-engine", "No usable market, social, or risk coverage is available.");
  const candlesCoverage = tokenAddress
    ? token?.pairAddress || token?.dexscreenerUrl || record.dexscreenerUrl
      ? feedCoverage("partial", "terminal-aggregate", "Candles are loaded by the shared terminal aggregate on demand.")
      : feedCoverage("unavailable", "terminal-aggregate", "No tradable pair is attached for OHLCV candles.")
    : feedCoverage("unavailable", "terminal-aggregate", "No token address is attached for OHLCV candles.");

  const momentumInputs = [args.hotAlphaScore, args.earlyRunnerScore, record.roiCurrentPct].filter(
    (value): value is number => typeof value === "number" && Number.isFinite(value)
  );
  const momentumScore =
    momentumInputs.length > 0
      ? roundMetricOrZero(momentumInputs.reduce((sum, value) => sum + value, 0) / momentumInputs.length)
      : null;
  const smartMoneyScore =
    args.trustedTraderCount > 0
      ? clampScore(Math.min(100, 48 + args.trustedTraderCount * 9 + finite(args.opportunityScore) * 0.16))
      : null;
  const riskScore =
    typeof args.tokenRiskScore === "number"
      ? roundMetricOrZero(args.tokenRiskScore)
      : typeof token?.top10HolderPct === "number"
        ? roundMetricOrZero(Math.max(15, Math.min(85, token.top10HolderPct)))
        : null;
  const aiScore = typeof args.confidenceScore === "number" ? roundMetricOrZero(args.confidenceScore) : null;
  const scoreReasons = [
    ...args.radarReasons,
    args.trustedTraderCount > 0 ? `${args.trustedTraderCount} trusted trader${args.trustedTraderCount === 1 ? "" : "s"}` : null,
    hasRisk && riskScore !== null ? `Risk ${signalRiskLabel(riskScore).toLowerCase()}` : null,
  ].filter((reason): reason is string => Boolean(reason)).slice(0, 5);

  return {
    tokenAddress,
    tokenSymbol,
    tokenLogo,
    chain,
    price: null,
    priceChange24h: null,
    candlesCoverage,
    aiScore,
    aiScoreCoverage: aiCoverage,
    momentumScore,
    smartMoneyScore: smartMoneyScore === null ? null : roundMetricOrZero(smartMoneyScore),
    riskScore,
    convictionLabel: signalConvictionLabel(args.highConvictionScore ?? aiScore),
    riskLabel: signalRiskLabel(riskScore),
    scoreReasons,
    unavailableReasons: unavailableReasons.slice(0, 4),
  };
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
    writeTokenLookupCacheValue(token.address, token);
  }

  const missingCandidates = uniqueCandidates.filter((c) => !tokenMap.has(c.key));
  if (missingCandidates.length > 0) {
    // Batch create all missing tokens in a single query instead of sequential creates.
    // skipDuplicates handles race conditions where another instance created the token first.
    await prisma.token.createMany({
      data: missingCandidates.map((c) => ({
        chainType: c.chainType,
        address: c.address,
        symbol: c.symbol,
        name: c.name,
        imageUrl: c.imageUrl,
        dexscreenerUrl: c.dexscreenerUrl,
        launchAt: c.launchAt,
        liquidity: c.liquidity,
        volume24h: c.volume24h,
      })),
      skipDuplicates: true,
    }).catch(() => {});

    // createMany doesn't return records, so fetch them (including any created by other instances)
    const createdTokens = await prisma.token.findMany({
      where: {
        OR: missingCandidates.map((c) => ({
          chainType: c.chainType,
          address: c.address,
        })),
      },
      select: TOKEN_SELECT,
    }).catch(() => []);

    for (const token of createdTokens) {
      tokenMap.set(buildTokenKey(token.chainType, token.address), token);
      writeTokenLookupCacheValue(token.address, token);
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

export async function refreshTokenIntelligence(
  tokenId: string,
  opts?: { awaitSignalAlerts?: boolean }
): Promise<TokenRefreshResult | null> {
  const existingRequest = tokenRefreshInFlight.get(tokenId);
  if (existingRequest) {
    return existingRequest;
  }

  const request = (async () => {
    const existing = await prisma.token.findUnique({
      where: { id: tokenId },
      select: TOKEN_SELECT,
    });

    if (!existing) return null;
    if (!shouldRefreshToken(existing)) {
      writeTokenLookupCacheValue(existing.address, existing);
      return {
        token: existing,
        previousToken: existing,
        refreshed: false,
      };
    }

    const [latestSnapshot, recentCalls, reactions, marketSnapshot, distribution, clusters] = await Promise.all([
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
          earlyRunnerScore: true,
          highConvictionScore: true,
          entryQualityScore: true,
          lastIntelligenceAt: true,
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
      getCachedMarketCapSnapshot(existing.address, existing.chainType).catch(
        () => ({ mcap: null } as MarketCapResult)
      ),
      existing.chainType === "solana"
        ? analyzeSolanaTokenDistribution(existing.address, existing.liquidity, { preferFresh: true }).catch(() => null)
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
  const sentimentTrendAdjustment = computeDexSentimentTrendAdjustment(marketSnapshot);
  const sentimentScore = computeSentimentScore({
    reactions: reactionCounts,
    sentimentTrendAdjustment,
  });
  const liquidity = roundMetric(
    pickFirstPositiveMetric(marketSnapshot?.liquidityUsd, existing.liquidity)
  );
  const volume24h = roundMetric(
    pickFirstPositiveMetric(marketSnapshot?.volume24hUsd, existing.volume24h)
  );
  const marketCap = roundMetric(
    pickFirstPositiveMetric(
      marketSnapshot?.mcap,
      recentCalls[0]?.currentMcap,
      latestSnapshot?.marketCap
    )
  );
  const hasResolvedDistributionHolderCount = hasVerifiedSolanaHolderCount(
    distribution?.holderCount,
    distribution?.holderCountSource ?? null
  );
  const observedDistributionTopHolderCount = distribution?.topHolders.length ?? 0;
  const existingHolderCountLooksLowerBound =
    existing.chainType === "solana" &&
    looksLikeLowerBoundSolanaHolderCount({
      storedHolderCount: existing.holderCount,
      observedTopHolderCount: observedDistributionTopHolderCount,
      liveHolderCount: distribution?.holderCount,
      liveHolderCountSource: distribution?.holderCountSource ?? null,
    });
  const holderCount = Math.round(
    pickFirstPositiveMetric(
      hasResolvedDistributionHolderCount ? distribution?.holderCount : null,
      !existingHolderCountLooksLowerBound ? existing.holderCount : null
    ) ?? 0
  ) || null;
  const resolvedLargestHolderPct = roundMetric(
    pickFirstFiniteMetric(distribution?.largestHolderPct, existing.largestHolderPct)
  );
  const resolvedTop10HolderPct = roundMetric(
    pickFirstFiniteMetric(distribution?.top10HolderPct, existing.top10HolderPct)
  );
  const resolvedDeployerSupplyPct = roundMetric(
    pickFirstFiniteMetric(distribution?.deployerSupplyPct, existing.deployerSupplyPct)
  );
  const resolvedBundledWalletCount =
    distribution?.bundledWalletCount ??
    existing.bundledWalletCount ??
    null;
  const resolvedEstimatedBundledSupplyPct = roundMetric(
    pickFirstFiniteMetric(
      distribution?.estimatedBundledSupplyPct,
      existing.estimatedBundledSupplyPct
    )
  );
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
  const momentumPct = finite(marketSnapshot?.priceChange24hPct);
  const marketContext = await getMarketContextSnapshot();
  const marketAdjustedMomentumPct = Math.max(0, momentumPct) * marketContext.accelerationMultiplier;
  const marketAdjustedVolumeGrowthPct = Math.max(0, volumeGrowthPct) * marketContext.accelerationMultiplier;
  const marketAdjustedLiquidityGrowthPct = Math.max(0, liquidityGrowthPct) * marketContext.accelerationMultiplier;
  const marketAdjustedHolderGrowthPct = Math.max(0, holderGrowthPct) * marketContext.accelerationMultiplier;
  const modelAwareRecentCalls = recentCalls.filter(
    (call) => toDateMs(call.lastIntelligenceAt) >= TOKEN_CONFIDENCE_MODEL_UPDATED_AT_MS
  );
  const scoringSeedCalls = modelAwareRecentCalls;
  const distinctTrustedTraders = new Set(
    recentCalls
      .filter((call) => finite(call.author.trustScore) >= TRUSTED_TRADER_THRESHOLD)
      .filter((call) => Date.now() - call.createdAt.getTime() <= 6 * 60 * 60 * 1000)
      .map((call) => call.authorId)
  ).size;
  const avgCallConfidence =
    scoringSeedCalls.length > 0
      ? scoringSeedCalls.reduce((sum, call) => sum + finite(call.confidenceScore), 0) / scoringSeedCalls.length
      : 0;
  const avgCurrentRoiPct =
    recentCalls.length > 0
      ? recentCalls.reduce((sum, call) => sum + finite(deriveRoiPct(call.entryMcap, call.currentMcap)), 0) / recentCalls.length
      : null;
  const avgHotAlpha =
    scoringSeedCalls.length > 0
      ? scoringSeedCalls.reduce((sum, call) => sum + finite(call.hotAlphaScore), 0) / scoringSeedCalls.length
      : 0;
  const avgHighConviction =
    scoringSeedCalls.length > 0
      ? scoringSeedCalls.reduce((sum, call) => sum + finite(call.highConvictionScore), 0) / scoringSeedCalls.length
      : 0;
  const baseEarlyRunnerScore = roundMetric(
    computeEarlyRunnerScore({
      distinctTrustedTradersLast6h: distinctTrustedTraders,
      liquidityGrowth1hPct: marketAdjustedLiquidityGrowthPct,
      volumeGrowth1hPct: marketAdjustedVolumeGrowthPct,
      holderGrowth1hPct: marketAdjustedHolderGrowthPct,
      momentumPct: Math.max(marketAdjustedMomentumPct, Math.max(0, mcapGrowthPct)),
      sentimentScore,
      holderCount,
      largestHolderPct: resolvedLargestHolderPct,
      top10HolderPct: resolvedTop10HolderPct,
      deployerSupplyPct: resolvedDeployerSupplyPct,
      bundledWalletCount: resolvedBundledWalletCount,
      estimatedBundledSupplyPct: resolvedEstimatedBundledSupplyPct,
      tokenRiskScore,
    })
  );
  const tokenConfidenceBaseScore = clampScore(
    avgCallConfidence > 0
      ? avgCallConfidence * 0.44 +
          finite(sentimentScore) * 0.11 +
          Math.max(0, 100 - finite(tokenRiskScore)) * 0.07 +
          pct(marketAdjustedMomentumPct, 180) * 0.07 +
          pct(marketAdjustedVolumeGrowthPct, 360) * 0.07 +
          pct(marketAdjustedLiquidityGrowthPct, 140) * 0.04 +
          pct(marketAdjustedHolderGrowthPct, 70) * 0.04 +
          pct(mcapGrowthPct, 220) * 0.03 +
          marketContext.breadthScore * 0.04 +
          computeHolderBreadthScore({
            holderCount,
            largestHolderPct: resolvedLargestHolderPct,
            top10HolderPct: resolvedTop10HolderPct,
          }) * 0.05 +
          computeOnchainStructureHealthScore({
            largestHolderPct: resolvedLargestHolderPct,
            top10HolderPct: resolvedTop10HolderPct,
            deployerSupplyPct: resolvedDeployerSupplyPct,
            bundledWalletCount: resolvedBundledWalletCount,
            estimatedBundledSupplyPct: resolvedEstimatedBundledSupplyPct,
          }) * 0.04 +
          marketContext.confidenceBias
      : 0.22 * Math.max(0, 100 - finite(tokenRiskScore)) +
          0.24 * finite(sentimentScore) +
          0.14 * pct(marketAdjustedMomentumPct, 180) +
          0.10 * pct(marketAdjustedVolumeGrowthPct, 360) +
          0.07 * pct(marketAdjustedLiquidityGrowthPct, 140) +
          0.05 * pct(marketAdjustedHolderGrowthPct, 70) +
          0.04 * pct(mcapGrowthPct, 220) +
          0.05 * marketContext.breadthScore +
          0.05 * computeHolderBreadthScore({
            holderCount,
            largestHolderPct: resolvedLargestHolderPct,
            top10HolderPct: resolvedTop10HolderPct,
          }) +
          0.04 * computeOnchainStructureHealthScore({
            largestHolderPct: resolvedLargestHolderPct,
            top10HolderPct: resolvedTop10HolderPct,
            deployerSupplyPct: resolvedDeployerSupplyPct,
            bundledWalletCount: resolvedBundledWalletCount,
            estimatedBundledSupplyPct: resolvedEstimatedBundledSupplyPct,
          }) +
          marketContext.confidenceBias
  );
  const baseConfidenceScore = roundMetric(
    applyConfidenceGuardrails({
      baseScore: tokenConfidenceBaseScore,
      tokenRiskScore,
      top10HolderPct: resolvedTop10HolderPct,
      roiCurrentPct: avgCurrentRoiPct ?? mcapGrowthPct ?? momentumPct,
      sentimentScore,
    })
  );
  const baseHotAlphaScore = roundMetric(
    clampScore(
      avgHotAlpha * 0.44 +
        finite(baseEarlyRunnerScore) * 0.16 +
        finite(sentimentScore) * 0.08 +
        pct(marketAdjustedMomentumPct, 180) * 0.08 +
        pct(marketAdjustedVolumeGrowthPct, 360) * 0.07 +
        marketContext.breadthScore * 0.05 +
        computeHolderBreadthScore({
          holderCount,
          largestHolderPct: resolvedLargestHolderPct,
          top10HolderPct: resolvedTop10HolderPct,
        }) * 0.04 +
        computeOnchainStructureHealthScore({
          largestHolderPct: resolvedLargestHolderPct,
          top10HolderPct: resolvedTop10HolderPct,
          deployerSupplyPct: resolvedDeployerSupplyPct,
          bundledWalletCount: resolvedBundledWalletCount,
          estimatedBundledSupplyPct: resolvedEstimatedBundledSupplyPct,
        }) * 0.04 +
        Math.max(0, 100 - finite(tokenRiskScore)) * 0.04
    )
  );
  const baseHighConvictionScore = roundMetric(
    clampScore(
      avgHighConviction * 0.46 +
        finite(baseConfidenceScore) * 0.22 +
        Math.max(0, 100 - finite(tokenRiskScore)) * 0.08 +
        pct(marketAdjustedLiquidityGrowthPct, 140) * 0.06 +
        marketContext.breadthScore * 0.05 +
        computeHolderBreadthScore({
          holderCount,
          largestHolderPct: resolvedLargestHolderPct,
          top10HolderPct: resolvedTop10HolderPct,
        }) * 0.05 +
        computeOnchainStructureHealthScore({
          largestHolderPct: resolvedLargestHolderPct,
          top10HolderPct: resolvedTop10HolderPct,
          deployerSupplyPct: resolvedDeployerSupplyPct,
          bundledWalletCount: resolvedBundledWalletCount,
          estimatedBundledSupplyPct: resolvedEstimatedBundledSupplyPct,
        }) * 0.08
    )
  );
  const latestSignalAtMs = recentCalls.reduce(
    (latest, call) => Math.max(latest, call.createdAt.getTime()),
    0
  );
  const scoreState = computeStateAwareIntelligenceScores({
    baseConfidenceScore,
    baseHotAlphaScore,
    baseEarlyRunnerScore,
    baseHighConvictionScore,
    liquidityUsd: liquidity,
    volume24hUsd: volume24h,
    holderCount,
    largestHolderPct: resolvedLargestHolderPct,
    top10HolderPct: resolvedTop10HolderPct,
    deployerSupplyPct: resolvedDeployerSupplyPct,
    bundledWalletCount: resolvedBundledWalletCount,
    estimatedBundledSupplyPct: resolvedEstimatedBundledSupplyPct,
    tokenRiskScore,
    traderTrustScore: scoringSeedCalls.length > 0
      ? scoringSeedCalls.reduce((sum, call) => sum + finite(call.author.trustScore), 0) / scoringSeedCalls.length
      : null,
    entryQualityScore: scoringSeedCalls.length > 0
      ? scoringSeedCalls.reduce((sum, call) => sum + finite(call.entryQualityScore), 0) / scoringSeedCalls.length
      : null,
    trustedTraderCount: distinctTrustedTraders,
    sentimentScore,
    marketBreadthScore: marketContext.breadthScore,
    liquidityGrowthPct: marketAdjustedLiquidityGrowthPct,
    volumeGrowthPct: marketAdjustedVolumeGrowthPct,
    holderGrowthPct: marketAdjustedHolderGrowthPct,
    mcapGrowthPct,
    momentumPct: Math.max(marketAdjustedMomentumPct, Math.max(0, mcapGrowthPct)),
    tradeCount24h:
      typeof marketSnapshot?.buys24h === "number" || typeof marketSnapshot?.sells24h === "number"
        ? finite(marketSnapshot?.buys24h) + finite(marketSnapshot?.sells24h)
        : null,
    hasTradablePair: Boolean(
      marketSnapshot?.pairAddress ??
        existing.pairAddress ??
        marketSnapshot?.dexscreenerUrl ??
        existing.dexscreenerUrl
    ),
    hasResolvedHolderDistribution:
      Boolean(distribution?.topHolders?.length) ||
      resolvedLargestHolderPct !== null ||
      resolvedTop10HolderPct !== null,
    recentCallCount: recentCalls.length,
    signalAgeHours:
      latestSignalAtMs > 0
        ? Math.max(0, (Date.now() - latestSignalAtMs) / (60 * 60 * 1000))
        : null,
  });
  const confidenceScore = roundMetric(scoreState.confidenceScore);
  const hotAlphaScore = roundMetric(scoreState.hotAlphaScore);
  const earlyRunnerScore = roundMetric(scoreState.earlyRunnerScore);
  const highConvictionScore = roundMetric(scoreState.highConvictionScore);
  const radarScore = roundMetric(scoreState.opportunityScore);
  const radarReasons = buildRadarReasons({
    distinctTrustedTraders,
    volumeGrowthPct,
    liquidityGrowthPct,
    holderGrowthPct,
    momentumPct,
    tokenRiskScore,
  });

    const refreshedToken = await prisma.token.update({
      where: { id: tokenId },
      data: {
        symbol: marketSnapshot?.tokenSymbol ?? existing.symbol,
        name: marketSnapshot?.tokenName ?? existing.name,
        imageUrl: marketSnapshot?.tokenImage ?? existing.imageUrl,
        dexscreenerUrl: marketSnapshot?.dexscreenerUrl ?? existing.dexscreenerUrl,
        pairAddress: marketSnapshot?.pairAddress ?? existing.pairAddress,
        dexId: marketSnapshot?.dexId ?? existing.dexId,
        liquidity,
        volume24h,
        holderCount,
        largestHolderPct: resolvedLargestHolderPct,
        top10HolderPct: resolvedTop10HolderPct,
        deployerSupplyPct: resolvedDeployerSupplyPct,
        bundledWalletCount: resolvedBundledWalletCount,
        bundledClusterCount: distribution?.bundledClusterCount ?? clusters.length,
        estimatedBundledSupplyPct: resolvedEstimatedBundledSupplyPct,
        bundleRiskLabel,
        tokenRiskScore,
        sentimentScore: roundMetric(sentimentScore),
        radarScore,
        confidenceScore,
        hotAlphaScore,
        earlyRunnerScore,
        highConvictionScore,
        isEarlyRunner:
          !scoreState.bullishSignalsSuppressed &&
          finite(earlyRunnerScore) >= EARLY_RUNNER_THRESHOLD &&
          finite(tokenRiskScore, 100) <= 55,
        earlyRunnerReasons: radarReasons,
        lastIntelligenceAt: new Date(),
      },
      select: TOKEN_SELECT,
    });

    const deferredWrites: Promise<unknown>[] = [];
    if (distribution?.clusters) {
      deferredWrites.push(
        prisma.tokenBundleCluster.findMany({
          where: { tokenId },
          select: { clusterLabel: true, estimatedSupplyPct: true },
        })
          .then((existingClusters) => {
            const prevByLabel = new Map<string, number>(
              existingClusters.map((c) => [c.clusterLabel, c.estimatedSupplyPct])
            );
            const computeAction = (label: string, newPct: number): string => {
              const prev = prevByLabel.get(label);
              if (prev === undefined) return "new";
              const delta = newPct - prev;
              if (delta <= -0.5) return "distributing";
              if (delta >= 0.5) return "accumulating";
              return "holding";
            };
            return prisma.tokenBundleCluster.deleteMany({ where: { tokenId } })
              .then(() => (
                distribution.clusters.length > 0
                  ? prisma.tokenBundleCluster.createMany({
                      data: distribution.clusters.map((cluster) => ({
                        tokenId,
                        clusterLabel: cluster.clusterLabel,
                        walletCount: cluster.walletCount,
                        estimatedSupplyPct: roundMetricOrZero(cluster.estimatedSupplyPct),
                        evidenceJson: cluster.evidenceJson,
                        currentAction: computeAction(
                          cluster.clusterLabel,
                          roundMetricOrZero(cluster.estimatedSupplyPct)
                        ),
                      })),
                    })
                  : null
              ));
          })
          .catch((error) => {
            console.warn("[intelligence/token] bundle cluster write skipped", {
              tokenId,
              message: error instanceof Error ? error.message : String(error),
            });
          })
      );
    }

    if (
      !latestSnapshot ||
      Date.now() - latestSnapshot.capturedAt.getTime() >= TOKEN_SNAPSHOT_MIN_INTERVAL_MS
    ) {
      deferredWrites.push(
        prisma.tokenMetricSnapshot.create({
          data: {
            tokenId,
            marketCap,
            liquidity,
            volume24h,
            holderCount,
            largestHolderPct: resolvedLargestHolderPct,
            top10HolderPct: resolvedTop10HolderPct,
            bundledWalletCount: resolvedBundledWalletCount,
            estimatedBundledSupplyPct: resolvedEstimatedBundledSupplyPct,
            tokenRiskScore,
            sentimentScore: roundMetric(sentimentScore),
            confidenceScore,
            radarScore,
          },
        }).catch((error) => {
          console.warn("[intelligence/token] metric snapshot write skipped", {
            tokenId,
            message: error instanceof Error ? error.message : String(error),
          });
        })
      );
    }

    if (
      !scoreState.bullishSignalsSuppressed &&
      finite(earlyRunnerScore) >= EARLY_RUNNER_THRESHOLD &&
      finite(existing.earlyRunnerScore) < EARLY_RUNNER_THRESHOLD
    ) {
      deferredWrites.push(
        prisma.tokenEvent.create({
          data: {
            tokenId,
            eventType: "early_runner_detected",
            timestamp: new Date(),
            marketCap,
            liquidity,
            volume: volume24h,
            metadata: { reasons: radarReasons },
          },
        }).catch(() => undefined)
      );
    }

    if (
      !scoreState.bullishSignalsSuppressed &&
      finite(hotAlphaScore) >= HOT_ALPHA_THRESHOLD &&
      finite(existing.hotAlphaScore) < HOT_ALPHA_THRESHOLD
    ) {
      deferredWrites.push(
        prisma.tokenEvent.create({
          data: {
            tokenId,
            eventType: "hot_alpha_detected",
            timestamp: new Date(),
            marketCap,
            liquidity,
            volume: volume24h,
            metadata: { score: hotAlphaScore },
          },
        }).catch(() => undefined)
      );
    }

    if (
      !scoreState.bullishSignalsSuppressed &&
      finite(highConvictionScore) >= HIGH_CONVICTION_THRESHOLD &&
      finite(existing.highConvictionScore) < HIGH_CONVICTION_THRESHOLD
    ) {
      deferredWrites.push(
        prisma.tokenEvent.create({
          data: {
            tokenId,
            eventType: "high_conviction_detected",
            timestamp: new Date(),
            marketCap,
            liquidity,
            volume: volume24h,
            metadata: { score: highConvictionScore },
          },
        }).catch(() => undefined)
      );
    }

    if (deferredWrites.length > 0) {
      void Promise.allSettled(deferredWrites);
    }

    writeTokenLookupCacheValue(refreshedToken.address, refreshedToken);
    const topHolders = distribution?.topHolders ?? [];
    // Whale = has whale badge OR holding ≥1% of supply with ≥$1k value (size-based fallback)
    // Smart money = has high_volume_trader badge
    // Accumulating = tradeSnapshot net positive, OR no tradeSnapshot but holds the token (they bought at some point)
    const isWhale = (h: TokenHolderSnapshot) =>
      h.badges.some((b) => b === "whale") ||
      (h.supplyPct >= 1 && (h.valueUsd ?? 0) >= 1000);
    const isSmartMoney = (h: TokenHolderSnapshot) =>
      h.badges.some((b) => b === "high_volume_trader");
    const isAccumulating = (h: TokenHolderSnapshot) =>
      h.tradeSnapshot !== null
        ? (h.tradeSnapshot.netAmount ?? 0) > 0
        : (h.amount ?? 0) > 0; // holding = accumulated at some point
    const holderStats = {
      holderCount: holderCount ?? null,
      previousHolderCount: latestSnapshot?.holderCount ?? null,
      whaleAccumulatingCount: topHolders.filter((h) => isWhale(h) && isAccumulating(h)).length,
      smartMoneyCount: topHolders.filter((h) => isSmartMoney(h) && isAccumulating(h)).length,
    };
    const signalAlertTask = fanoutTokenSignalAlerts({
      marketCap,
      token: {
        ...refreshedToken,
        liquidity,
        marketHealthScore: scoreState.marketHealthScore,
        setupQualityScore: scoreState.setupQualityScore,
        opportunityScore: scoreState.opportunityScore,
        dataReliabilityScore: scoreState.dataReliabilityScore,
        activityStatus: scoreState.activityStatus,
        activityStatusLabel: scoreState.activityStatusLabel,
        isTradable: scoreState.isTradable,
        bullishSignalsSuppressed: scoreState.bullishSignalsSuppressed,
      },
      previousToken: existing
        ? {
            ...existing,
            liquidity: existing.liquidity ?? null,
            marketCap: latestSnapshot?.marketCap ?? null,
          }
        : null,
      holderStats,
    }).catch(() => undefined);
    if (opts?.awaitSignalAlerts) {
      await signalAlertTask;
    }

    return {
      token: refreshedToken,
      previousToken: existing,
      refreshed: true,
    };
  })();

  tokenRefreshInFlight.set(tokenId, request);

  try {
    return await request;
  } finally {
    if (tokenRefreshInFlight.get(tokenId) === request) {
      tokenRefreshInFlight.delete(tokenId);
    }
    tokenRefreshAttemptAt.set(tokenId, Date.now());
  }
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

  const [row] = await prisma.$queryRaw<
    Array<{
      likedPostIds: unknown;
      repostedPostIds: unknown;
      followedAuthorIds: unknown;
      reactions: unknown;
    }>
  >(Prisma.sql`
    SELECT
      COALESCE(
        (
          SELECT json_agg("postId")
          FROM "Like"
          WHERE "userId" = ${viewerId} AND "postId" IN (${Prisma.join(postIds)})
        ),
        '[]'::json
      ) AS "likedPostIds",
      COALESCE(
        (
          SELECT json_agg("postId")
          FROM "Repost"
          WHERE "userId" = ${viewerId} AND "postId" IN (${Prisma.join(postIds)})
        ),
        '[]'::json
      ) AS "repostedPostIds",
      ${
        authorIds.length > 0
          ? Prisma.sql`
              COALESCE(
                (
                  SELECT json_agg("followingId")
                  FROM "Follow"
                  WHERE "followerId" = ${viewerId} AND "followingId" IN (${Prisma.join(authorIds)})
                ),
                '[]'::json
              )
            `
          : Prisma.sql`'[]'::json`
      } AS "followedAuthorIds",
      COALESCE(
        (
          SELECT json_agg(
            json_build_object(
              'postId', "postId",
              'type', "type"
            )
          )
          FROM "Reaction"
          WHERE "userId" = ${viewerId} AND "postId" IN (${Prisma.join(postIds)})
        ),
        '[]'::json
      ) AS "reactions"
  `);

  const likedPostIds = Array.isArray(row?.likedPostIds)
    ? row.likedPostIds.filter((value): value is string => typeof value === "string")
    : [];
  const repostedPostIds = Array.isArray(row?.repostedPostIds)
    ? row.repostedPostIds.filter((value): value is string => typeof value === "string")
    : [];
  const followedAuthorIds = Array.isArray(row?.followedAuthorIds)
    ? row.followedAuthorIds.filter((value): value is string => typeof value === "string")
    : [];
  const reactions = Array.isArray(row?.reactions)
    ? row.reactions.filter(
        (value): value is { postId: string; type: string } =>
          typeof value === "object" &&
          value !== null &&
          "postId" in value &&
          "type" in value &&
          typeof (value as { postId?: unknown }).postId === "string" &&
          typeof (value as { type?: unknown }).type === "string"
      )
    : [];

  const reactionByPostId = new Map<string, string>();
  for (const reaction of reactions) {
    if (!reactionByPostId.has(reaction.postId)) {
      reactionByPostId.set(reaction.postId, reaction.type);
    }
  }

  return {
    likedPostIds: new Set(likedPostIds),
    repostedPostIds: new Set(repostedPostIds),
    followedAuthorIds: new Set(followedAuthorIds),
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
      currentAction: true,
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
      currentAction: row.currentAction ?? null,
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

async function buildFeedPollSummaries(postIds: string[], viewerId: string | null): Promise<Map<string, FeedPollSummary>> {
  if (postIds.length === 0) return new Map();

  const [options, voteCounts, viewerVotes] = await Promise.all([
    prisma.postPollOption.findMany({
      where: { postId: { in: postIds } },
      orderBy: [{ postId: "asc" }, { sortOrder: "asc" }, { createdAt: "asc" }],
      select: { id: true, postId: true, label: true },
    }),
    prisma.postPollVote.groupBy({
      by: ["postId", "optionId"],
      where: { postId: { in: postIds } },
      _count: { _all: true },
    }),
    viewerId
      ? prisma.postPollVote.findMany({
          where: { postId: { in: postIds }, userId: viewerId },
          select: { postId: true, optionId: true },
        })
      : Promise.resolve([]),
  ]);

  const votesByOptionId = new Map<string, number>();
  const totalsByPostId = new Map<string, number>();
  for (const count of voteCounts) {
    const votes = count._count._all;
    votesByOptionId.set(count.optionId, votes);
    totalsByPostId.set(count.postId, (totalsByPostId.get(count.postId) ?? 0) + votes);
  }

  const viewerVoteByPostId = new Map(viewerVotes.map((vote) => [vote.postId, vote.optionId]));
  const summaries = new Map<string, FeedPollSummary>();
  for (const option of options) {
    const totalVotes = totalsByPostId.get(option.postId) ?? 0;
    const optionVotes = votesByOptionId.get(option.id) ?? 0;
    const summary = summaries.get(option.postId) ?? {
      totalVotes,
      viewerOptionId: viewerVoteByPostId.get(option.postId) ?? null,
      options: [],
    };
    summary.options.push({
      id: option.id,
      label: option.label,
      votes: optionVotes,
      percentage: totalVotes > 0 ? Math.round((optionVotes / totalVotes) * 1000) / 10 : 0,
    });
    summaries.set(option.postId, summary);
  }

  return summaries;
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

  // ── Batch 1: social state + market context ───────────────────────────────
  // Run these first so the viewer's like/follow/repost state is ready.
  // socialStatePromise already spawns up to 4 sub-queries internally;
  // keeping this batch to 2 outer tasks limits peak concurrent connections.
  const [socialState, marketContext] = await Promise.all([
    socialStatePromise,
    preferStoredIntelligence
      ? Promise.resolve<MarketContextSnapshot>({
          label: "balanced",
          breadthScore: 50,
          confidenceBias: 0,
          accelerationMultiplier: 1,
        })
      : getMarketContextSnapshot(),
  ]);

  // ── Batch 2: token enrichment data ───────────────────────────────────────
  // Runs after batch 1 so we never hold more than ~3 DB connections at once.
  const [bundleClustersByTokenId, timingMetaByPostId, tokenGrowthById] = await Promise.all([
    preferStoredIntelligence
      ? Promise.resolve(new Map<string, EnrichedCall["bundleClusters"]>())
      : readTokenClusters(Array.from(new Set(Array.from(tokenMap.values()).map((token) => token.id)))),
    preferStoredIntelligence
      ? Promise.resolve(new Map<string, Awaited<ReturnType<typeof readTimingMetaForCalls>> extends Map<string, infer TValue> ? TValue : never>())
      : readTimingMetaForCalls(records),
    preferStoredIntelligence
      ? Promise.resolve(new Map<string, { volumeGrowthPct: number; liquidityGrowthPct: number; holderGrowthPct: number; mcapGrowthPct: number }>())
      : readLatestTokenGrowthById(tokenIds),
  ]);

  const callsByTokenId = new Map<string, typeof relatedCalls>();
  for (const call of relatedCalls) {
    if (!call.tokenId) continue;
    const bucket = callsByTokenId.get(call.tokenId) ?? [];
    bucket.push(call);
    callsByTokenId.set(call.tokenId, bucket);
  }

  const pollPostIds = records
    .filter((record) => record.postType === "poll")
    .map((record) => record.id);
  const pollSummariesByPostId = pollPostIds.length
    ? await buildFeedPollSummaries(pollPostIds, viewerId)
    : new Map<string, FeedPollSummary>();

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
    const baseConfidenceScore = roundMetricOrZero(
      shouldUseStoredIntelligence && hasFiniteMetric(record.confidenceScore)
        ? record.confidenceScore
        : computeConfidenceScore({
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
          holderCount: token?.holderCount ?? null,
          largestHolderPct: token?.largestHolderPct ?? null,
          top10HolderPct: token?.top10HolderPct ?? null,
          deployerSupplyPct: token?.deployerSupplyPct ?? null,
          bundledWalletCount: token?.bundledWalletCount ?? null,
          estimatedBundledSupplyPct: token?.estimatedBundledSupplyPct ?? null,
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
    const baseHotAlphaScore = roundMetricOrZero(
      shouldUseStoredIntelligence && hasFiniteMetric(record.hotAlphaScore)
        ? record.hotAlphaScore
        :
        computeHotAlphaScore({
          confidenceScore: baseConfidenceScore,
          weightedEngagementPerHour,
          earlyGainsPct: roiCurrentPct,
          traderTrustScore: record.author.trustScore,
          liquidityUsd: token?.liquidity ?? record.currentMcap,
          sentimentScore,
          momentumPct: compositeMomentumPct,
          holderCount: token?.holderCount ?? null,
          largestHolderPct: token?.largestHolderPct ?? null,
          top10HolderPct: token?.top10HolderPct ?? null,
          deployerSupplyPct: token?.deployerSupplyPct ?? null,
          bundledWalletCount: token?.bundledWalletCount ?? null,
          estimatedBundledSupplyPct: token?.estimatedBundledSupplyPct ?? null,
          tokenRiskScore: token?.tokenRiskScore ?? null,
        })
    );
    const baseEarlyRunnerScore = roundMetricOrZero(
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
          holderCount: token?.holderCount ?? null,
          largestHolderPct: token?.largestHolderPct ?? null,
          top10HolderPct: token?.top10HolderPct ?? null,
          deployerSupplyPct: token?.deployerSupplyPct ?? null,
          bundledWalletCount: token?.bundledWalletCount ?? null,
          estimatedBundledSupplyPct: token?.estimatedBundledSupplyPct ?? null,
          tokenRiskScore: token?.tokenRiskScore ?? null,
        })
    );
    const baseHighConvictionScore = roundMetricOrZero(
      shouldUseStoredIntelligence && hasFiniteMetric(record.highConvictionScore)
        ? record.highConvictionScore
        :
        computeHighConvictionScore({
          confidenceScore: baseConfidenceScore,
          traderTrustScore: record.author.trustScore,
          entryQualityScore,
          liquidityUsd: token?.liquidity ?? record.currentMcap,
          sentimentScore,
          trustedTraderCount,
          holderCount: token?.holderCount ?? null,
          largestHolderPct: token?.largestHolderPct ?? null,
          top10HolderPct: token?.top10HolderPct ?? null,
          deployerSupplyPct: token?.deployerSupplyPct ?? null,
          bundledWalletCount: token?.bundledWalletCount ?? null,
          estimatedBundledSupplyPct: token?.estimatedBundledSupplyPct ?? null,
          tokenRiskScore: token?.tokenRiskScore ?? null,
        })
    );
    const scoreState = computeStateAwareIntelligenceScores({
      baseConfidenceScore,
      baseHotAlphaScore,
      baseEarlyRunnerScore,
      baseHighConvictionScore,
      liquidityUsd: token?.liquidity ?? record.currentMcap,
      volume24hUsd: token?.volume24h ?? null,
      holderCount: token?.holderCount ?? null,
      largestHolderPct: token?.largestHolderPct ?? null,
      top10HolderPct: token?.top10HolderPct ?? null,
      deployerSupplyPct: token?.deployerSupplyPct ?? null,
      bundledWalletCount: token?.bundledWalletCount ?? null,
      estimatedBundledSupplyPct: token?.estimatedBundledSupplyPct ?? null,
      tokenRiskScore: token?.tokenRiskScore ?? null,
      traderTrustScore: record.author.trustScore,
      entryQualityScore,
      trustedTraderCount,
      sentimentScore,
      marketBreadthScore: marketContext.breadthScore,
      liquidityGrowthPct: marketAdjustedLiquidityGrowthPct,
      volumeGrowthPct: marketAdjustedVolumeGrowthPct,
      holderGrowthPct: marketAdjustedHolderGrowthPct,
      mcapGrowthPct,
      momentumPct: compositeMomentumPct,
      tradeCount24h: null,
      hasTradablePair: Boolean(token?.pairAddress ?? record.dexscreenerUrl),
      hasResolvedHolderDistribution:
        token?.largestHolderPct !== null ||
        token?.top10HolderPct !== null ||
        token?.tokenRiskScore !== null,
      recentCallCount: tokenCalls.length,
      signalAgeHours: Math.max(0.2, (Date.now() - record.createdAt.getTime()) / (60 * 60 * 1000)),
    });
    const confidenceScore = roundMetricOrZero(scoreState.confidenceScore);
    const hotAlphaScore = roundMetricOrZero(scoreState.hotAlphaScore);
    const earlyRunnerScore = roundMetricOrZero(scoreState.earlyRunnerScore);
    const highConvictionScore = roundMetricOrZero(scoreState.highConvictionScore);
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
    const tokenContext = buildFeedTokenContext(record, token);
    const signal = buildFeedSignalContract({
      record,
      token,
      confidenceScore,
      hotAlphaScore,
      earlyRunnerScore,
      highConvictionScore,
      opportunityScore: scoreState.opportunityScore,
      tokenRiskScore: token?.tokenRiskScore ?? null,
      trustedTraderCount,
      radarReasons,
    });
    const coverage = {
      signal: signal?.aiScoreCoverage ?? feedCoverage("unavailable", "phew-signal-engine", "No signal context resolved."),
      candles: signal?.candlesCoverage ?? feedCoverage("unavailable", "terminal-aggregate", "No token context resolved."),
    };
    const poll =
      record.postType === "poll"
        ? pollSummariesByPostId.get(record.id) ?? { totalVotes: 0, viewerOptionId: null, options: [] }
        : null;
    const countSummary = {
      likes: record._count.likes,
      comments: record._count.comments,
      reposts: record._count.reposts,
      reactions: record._count.reactions,
    };
    const ageHoursForVelocity = Math.max(0.2, (Date.now() - record.createdAt.getTime()) / (60 * 60 * 1000));
    const engagementVelocity =
      ((countSummary.likes * 2 + countSummary.comments * 3 + countSummary.reposts * 5 + countSummary.reactions) /
        ageHoursForVelocity);

    enriched.push({
      ...record,
      itemType: record.postType === "raid" ? "raid" : "post",
      payload: buildFeedItemPayload({
        record,
        tokenContext,
        signal,
        poll,
        coverage,
        roiCurrentPct,
        roiPeakPct,
        tokenRiskScore: token?.tokenRiskScore ?? null,
      }),
      poll,
      token,
      isLiked: socialState.likedPostIds.has(record.id),
      isReposted: socialState.repostedPostIds.has(record.id),
      isFollowingAuthor: socialState.followedAuthorIds.has(record.authorId),
      tokenContext,
      signal,
      engagement: {
        ...countSummary,
        views: record.viewCount,
        velocity: roundMetricOrZero(engagementVelocity),
      },
      coverage,
      feedScore: 0,
      feedReasons: [],
      scoreReasons: [],
      repostContext: null,
      currentReactionType: socialState.reactionByPostId.get(record.id) ?? null,
      reactionCounts,
      confidenceScore,
      hotAlphaScore,
      earlyRunnerScore,
      highConvictionScore,
      marketHealthScore: scoreState.marketHealthScore,
      setupQualityScore: scoreState.setupQualityScore,
      opportunityScore: scoreState.opportunityScore,
      dataReliabilityScore: scoreState.dataReliabilityScore,
      activityStatus: scoreState.activityStatus,
      activityStatusLabel: scoreState.activityStatusLabel,
      isTradable: scoreState.isTradable,
      bullishSignalsSuppressed: scoreState.bullishSignalsSuppressed,
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
  if (!normalizedCursor || kind !== "following") {
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

function buildFeedOrderBy(kind: FeedKind): Prisma.PostOrderByWithRelationInput[] {
  if (kind === "following") {
    return [{ createdAt: "desc" }, { id: "desc" }];
  }

  // Ranked feeds are sorted in-memory after fresh intelligence hydration.
  // Pull the freshest candidate window instead of depending on persisted
  // post score columns, which can lag or be unset on new posts.
  return [{ createdAt: "desc" }, { id: "desc" }];
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
  const hasFeedScores = sorted.some((call) => call.feedScore > 0);
  if (hasFeedScores) {
    return sorted.sort((left, right) => {
      const scoreDelta = right.feedScore - left.feedScore;
      if (scoreDelta !== 0) return scoreDelta;
      const createdDelta = right.createdAt.getTime() - left.createdAt.getTime();
      return createdDelta !== 0 ? createdDelta : right.id.localeCompare(left.id);
    });
  }
  if (kind === "following") {
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
  call: Pick<
    EnrichedCall,
    | "hotAlphaScore"
    | "earlyRunnerScore"
    | "highConvictionScore"
    | "confidenceScore"
    | "roiCurrentPct"
    | "marketHealthScore"
    | "opportunityScore"
    | "bullishSignalsSuppressed"
    | "isTradable"
    | "postType"
  >
): boolean {
  if (kind === "latest" || kind === "following") {
    return true;
  }

  if (kind === "early-runners" && call.postType === "raid") {
    return true;
  }

  if (call.bullishSignalsSuppressed || !call.isTradable || call.marketHealthScore < 38 || call.opportunityScore < 40) {
    return false;
  }

  const roiCurrentPct = call.roiCurrentPct;
  if (kind === "hot-alpha") {
    return (
      call.hotAlphaScore >= HOT_ALPHA_THRESHOLD &&
      call.opportunityScore >= 55 &&
      (roiCurrentPct === null || roiCurrentPct > -45)
    );
  }

  if (kind === "early-runners") {
    return (
      call.earlyRunnerScore >= EARLY_RUNNER_THRESHOLD &&
      call.opportunityScore >= 52 &&
      (roiCurrentPct === null || roiCurrentPct > -50)
    );
  }

  return (
    call.highConvictionScore >= HIGH_CONVICTION_THRESHOLD &&
    call.confidenceScore >= 45 &&
    call.marketHealthScore >= 45 &&
    (roiCurrentPct === null || roiCurrentPct > -35)
  );
}

function filterCallsForFeedKind(kind: FeedKind, calls: EnrichedCall[]): EnrichedCall[] {
  if (kind === "latest" || kind === "following") {
    return calls;
  }

  return calls.filter((call) => isEligibleForRankedFeed(kind, call));
}

function postTypeWeight(postType: unknown): number {
  switch (postType) {
    case "alpha":
      return 10;
    case "chart":
      return 8;
    case "raid":
      return 9;
    case "poll":
      return 5;
    case "news":
      return 6;
    case "discussion":
      return 4;
    default:
      return 3;
  }
}

function computeFeedScoreForCall(
  kind: FeedKind,
  call: EnrichedCall,
  followedTraderIds: Set<string>,
  followedTokenIds: Set<string>
): { score: number; reasons: string[] } {
  const ageHours = Math.max(0.15, (Date.now() - call.createdAt.getTime()) / (60 * 60 * 1000));
  const freshnessWeight = Math.exp(-ageHours / 24) * 28;
  const authorTrust = finite(call.author.trustScore ?? 0);
  const authorLevelScore = Math.min(100, Math.max(0, finite(call.author.level ?? 0) * 3));
  const authorRoiScore = Math.max(0, Math.min(100, finite(call.author.avgRoi30d ?? 0)));
  const authorReputationWeight = Math.max(authorTrust, authorLevelScore, authorRoiScore) * 0.18;
  const engagement =
    (call._count.likes ?? 0) * 2 +
    (call._count.comments ?? call.threadCount ?? 0) * 3 +
    (call._count.reposts ?? 0) * 5 +
    (call._count.reactions ?? 0);
  const engagementVelocityWeight = Math.min(24, (engagement / ageHours) * 3.5);
  const tokenSignalWeight =
    call.postType === "alpha" || call.postType === "chart"
      ? Math.max(finite(call.confidenceScore), finite(call.highConvictionScore), finite(call.hotAlphaScore)) * 0.2
      : 0;
  const isFollowedAuthor = followedTraderIds.has(call.authorId);
  const isFollowedToken = Boolean(call.tokenId && followedTokenIds.has(call.tokenId));
  const isJoinedCommunity = Boolean(call.community?.tokenId && followedTokenIds.has(call.community.tokenId));
  const communityContextWeight = call.communityId
    ? isJoinedCommunity
      ? 13
      : 6
    : 0;
  const personalizationWeight = (isFollowedAuthor ? 12 : 0) + (isFollowedToken ? 10 : 0);
  const raidPressureWeight =
    call.postType === "raid"
      ? Math.min(18, 8 + (call._count.comments ?? 0) * 1.4 + (call._count.reposts ?? 0) * 2.2)
      : 0;
  const repostBoost = call.repostContext ? 8 : 0;
  const riskPenalty = Math.max(finite(call.bundlePenaltyScore), finite(call.tokenRiskScore ?? 0)) >= 70 ? 14 : 0;
  const spamPenalty =
    authorTrust > 0 && authorTrust < 18 && call.content.trim().length < 48 && engagement < 2 ? 8 : 0;

  const kindBoost =
    kind === "hot-alpha"
      ? finite(call.hotAlphaScore) * 0.18
      : kind === "high-conviction"
        ? finite(call.highConvictionScore) * 0.18
        : kind === "early-runners"
          ? call.postType === "raid"
            ? raidPressureWeight
            : finite(call.earlyRunnerScore) * 0.18
          : 0;

  const score = clampScore(
    freshnessWeight +
      authorReputationWeight +
      engagementVelocityWeight +
      postTypeWeight(call.postType) +
      tokenSignalWeight +
      communityContextWeight +
      personalizationWeight +
      raidPressureWeight +
      repostBoost +
      kindBoost -
      riskPenalty -
      spamPenalty
  );

  const reasons: string[] = [];
  if (tokenSignalWeight >= 14 || call.highConvictionScore >= HIGH_CONVICTION_THRESHOLD) reasons.push("High conviction");
  if (engagementVelocityWeight >= 10) reasons.push("Fast engagement");
  if (authorReputationWeight >= 12) reasons.push("Trusted caller");
  if (communityContextWeight >= 6) reasons.push(isJoinedCommunity ? "Your community" : "Community momentum");
  if (raidPressureWeight >= 10) reasons.push("Raid pressure");
  if (finite(call.trustedTraderCount) > 0) reasons.push("Smart money detected");
  if (call.repostContext) reasons.push("Repost momentum");
  if (riskPenalty > 0) reasons.push("Risk adjusted");
  return { score: Math.round(score * 10) / 10, reasons: reasons.slice(0, 4) };
}

async function loadRepostContexts(postIds: string[]): Promise<Map<string, EnrichedCall["repostContext"]>> {
  if (postIds.length === 0) return new Map();
  const reposts = await prisma.repost.findMany({
    where: { postId: { in: postIds } },
    orderBy: { createdAt: "desc" },
    select: {
      postId: true,
      createdAt: true,
      user: {
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
    },
    take: Math.max(20, postIds.length * 2),
  });
  const contexts = new Map<string, EnrichedCall["repostContext"]>();
  for (const repost of reposts) {
    if (contexts.has(repost.postId)) continue;
    contexts.set(repost.postId, {
      createdAt: repost.createdAt,
      user: repost.user,
    });
  }
  return contexts;
}

async function applyFeedRankingContext(
  kind: FeedKind,
  calls: EnrichedCall[],
  followedTraderIds: string[],
  followedTokenIds: string[]
): Promise<EnrichedCall[]> {
  if (calls.length === 0) return calls;
  const [feedCounts, repostContexts] = await Promise.all([
    loadFeedCountSummaries(calls.map((item) => item.id)),
    loadRepostContexts(calls.map((item) => item.id)),
  ]);
  const followedTraderSet = new Set(followedTraderIds);
  const followedTokenSet = new Set(followedTokenIds);
  return calls.map((call) => {
    const withCounts = {
      ...call,
      _count: feedCounts.get(call.id) ?? call._count,
      repostContext: repostContexts.get(call.id) ?? null,
    };
    const ranking = computeFeedScoreForCall(kind, withCounts, followedTraderSet, followedTokenSet);
    const scoreReasons = Array.from(
      new Set([...ranking.reasons, ...(withCounts.signal?.scoreReasons ?? [])])
    ).slice(0, 6);
    return {
      ...withCounts,
      itemType: withCounts.repostContext ? "repost" : withCounts.itemType,
      signal: withCounts.signal
        ? {
            ...withCounts.signal,
            scoreReasons,
          }
        : null,
      feedScore: ranking.score,
      feedReasons: scoreReasons,
      scoreReasons,
    };
  });
}

function shouldPriorityRefreshFeed(args: FeedArgs): boolean {
  return !args.cursor && !args.search?.trim() && PRIORITY_FEED_KINDS.includes(args.kind);
}

function sanitizeFeedItemForResponse(call: EnrichedCall): EnrichedCall {
  const liveSignal = call.coverage.signal.state === "live";
  return {
    ...call,
    confidenceScore: (liveSignal ? call.confidenceScore : null) as unknown as number,
    hotAlphaScore: (liveSignal ? call.hotAlphaScore : null) as unknown as number,
    earlyRunnerScore: (liveSignal ? call.earlyRunnerScore : null) as unknown as number,
    highConvictionScore: (liveSignal ? call.highConvictionScore : null) as unknown as number,
    marketHealthScore: null as unknown as number,
    setupQualityScore: null as unknown as number,
    opportunityScore: null as unknown as number,
    dataReliabilityScore: null as unknown as number,
    entryQualityScore: null as unknown as number,
    bundlePenaltyScore: null as unknown as number,
    sentimentScore: null as unknown as number,
    trustedTraderCount: call.trustedTraderCount > 0 ? call.trustedTraderCount : 0,
    tokenRiskScore: liveSignal ? call.tokenRiskScore : null,
    bundleRiskLabel: liveSignal ? call.bundleRiskLabel : null,
  };
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
      refreshTokens: false,
      ensureTokenLinks: false,
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
      ensureTokenLinks: true,
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
        marketHealthScore: call.marketHealthScore,
        setupQualityScore: call.setupQualityScore,
        opportunityScore: call.opportunityScore,
        dataReliabilityScore: call.dataReliabilityScore,
        activityStatus: call.activityStatus,
        activityStatusLabel: call.activityStatusLabel,
        isTradable: call.isTradable,
        bullishSignalsSuppressed: call.bullishSignalsSuppressed,
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

export async function prewarmRecentTokenIntelligence(
  opts?: { limit?: number; awaitSignalAlerts?: boolean }
): Promise<IntelligencePrewarmResult> {
  const startedAtMs = Date.now();
  const limit = Math.max(1, Math.trunc(opts?.limit ?? INTELLIGENCE_PREWARM_TOKEN_LIMIT));
  const recentRecords = await prisma.post.findMany({
    where: {
      OR: [
        { tokenId: { not: null } },
        { contractAddress: { not: null } },
      ],
    },
    select: CALL_SELECT,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: Math.max(limit * 3, 72),
  });

  if (recentRecords.length === 0) {
    return {
      attempted: 0,
      refreshed: 0,
      skipped: 0,
      errors: 0,
      durationMs: Date.now() - startedAtMs,
    };
  }

  const ensuredTokenMap = await ensureTokensForCalls(recentRecords);
  const tokenMap = mergeTokenMaps(buildTokenMapFromRecords(recentRecords), ensuredTokenMap);
  const tokensToRefresh = Array.from(tokenMap.values())
    .sort((left, right) => {
      const leftFreshness = toDateMs(left.lastIntelligenceAt);
      const rightFreshness = toDateMs(right.lastIntelligenceAt);
      if (leftFreshness !== rightFreshness) {
        return leftFreshness - rightFreshness;
      }
      return (right.updatedAt?.getTime?.() ?? 0) - (left.updatedAt?.getTime?.() ?? 0);
    })
    .slice(0, limit);

  let attempted = 0;
  let refreshed = 0;
  let skipped = 0;
  let errors = 0;

  for (let index = 0; index < tokensToRefresh.length; index += 5) {
    const batch = tokensToRefresh.slice(index, index + 5);
    const results = await Promise.allSettled(
      batch.map((token) =>
        refreshTokenIntelligence(
          token.id,
          opts?.awaitSignalAlerts ? { awaitSignalAlerts: true } : undefined
        )
      )
    );
    attempted += batch.length;
    for (const result of results) {
      if (result.status === "rejected") {
        errors += 1;
        continue;
      }
      if (result.value?.refreshed) {
        refreshed += 1;
      } else {
        skipped += 1;
      }
    }
  }

  return {
    attempted,
    refreshed,
    skipped,
    errors,
    durationMs: Date.now() - startedAtMs,
  };
}

export function buildIntelligenceRefreshJobInput(params?: {
  reason?: string;
  traceId?: string | null;
  nowMs?: number;
  intervalMs?: number;
  scope?: string;
  contractAddress?: string | null;
}): EnqueueInternalJobInput {
  const nowMs = params?.nowMs ?? Date.now();
  const intervalMs = Math.max(1_000, params?.intervalMs ?? INTELLIGENCE_REFRESH_JOB_BUCKET_MS);
  const bucket = Math.floor(nowMs / intervalMs);
  const scope = params?.scope?.trim() ? params.scope.trim() : "priority-loop";
  const normalizedContractAddress = params?.contractAddress?.trim().toLowerCase() ?? null;
  const scopeKey = normalizedContractAddress ? `${scope}:${normalizedContractAddress}` : scope;

  return {
    jobName: "intelligence_refresh",
    idempotencyKey: `intelligence-refresh:${scopeKey}:${bucket}`,
    payload: {
      reason: params?.reason ?? "intelligence_priority_loop",
      ...(normalizedContractAddress ? { contractAddress: normalizedContractAddress } : {}),
    },
    ...(params?.traceId ? { traceId: params.traceId } : {}),
  };
}

async function enqueuePriorityIntelligenceRefresh(): Promise<void> {
  if (!hasQStashPublishConfig()) {
    if (process.env.NODE_ENV !== "production") {
      console.info("[intelligence] skipping priority refresh enqueue; queue publish config missing");
      return;
    }

    throw new Error("Queue publish config missing for intelligence_refresh");
  }

  await enqueueInternalJob(
    buildIntelligenceRefreshJobInput({
      reason: "intelligence_priority_loop",
    })
  );
}

async function runIntelligencePriorityLoop(): Promise<void> {
  if (intelligencePriorityLoopInFlight) {
    return intelligencePriorityLoopInFlight;
  }

  intelligencePriorityLoopInFlight = (async () => {
    try {
      await enqueuePriorityIntelligenceRefresh();
      // Enforce Map size limits on each cycle to prevent unbounded memory growth
      evictOldestFromMap(feedListCache, FEED_LIST_CACHE_MAX_ENTRIES);
      evictOldestFromMap(tokenOverviewCache, TOKEN_OVERVIEW_CACHE_MAX_ENTRIES);
      evictOldestFromMap(traderOverviewCache, TRADER_OVERVIEW_CACHE_MAX_ENTRIES);
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
  const postTypeKey = args.postType ?? "all-types";
  const cacheKey = `feed:${args.kind}:${viewerKey}:${searchKey}:${cursorKey}:${postTypeKey}:${limit}`;
  const ttlMs =
    args.kind === "following" || args.viewerId
      ? PERSONALIZED_FEED_RESULT_CACHE_TTL_MS
      : FEED_RESULT_CACHE_TTL_MS;
  const freshCached = readCacheValue(feedListCache, cacheKey);
  if (freshCached) {
    return freshCached;
  }
  const staleCached = peekCacheValue(feedListCache, cacheKey);
  if (await isPrismaPoolPressureActive()) {
    if (staleCached) {
      console.warn("[intelligence/feed] serving stale feed cache during prisma pool pressure", {
        kind: args.kind,
        viewerId: args.viewerId,
      });
      return staleCached;
    }

    console.warn("[intelligence/feed] pool pressure active; serving degraded empty feed", {
      kind: args.kind,
      viewerId: args.viewerId,
    });
    return {
      items: [],
      hasMore: false,
      nextCursor: null,
      totalItems: 0,
      degraded: true,
    };
  }
  const currentInFlight = feedListInFlight.get(cacheKey);
  if (currentInFlight) {
    if (staleCached) {
      return staleCached;
    }
    return cloneCachedValue(await currentInFlight);
  }

  const request = (async () => {
    const computeFeedResult = async (): Promise<FeedListResult> => {
      const { followedTraderIds, followedTokenIds } = args.viewerId
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
      if (args.postType) {
        whereClauses.push({ postType: args.postType });
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
      const isDirectChronologicalFeed = args.kind === "following";
      const preferStoredFeedIntelligence = isDirectChronologicalFeed;
      const candidateLimit = isDirectChronologicalFeed
        ? Math.max(limit + 1, FEED_PRIORITY_POST_COUNT)
        : Math.max(
            RANKED_FEED_MIN_CANDIDATE_COUNT,
            Math.min(RANKED_FEED_MAX_CANDIDATE_COUNT, limit * 8)
          );
      const lightRecords = await prisma.post.findMany({
        where,
        select: FEED_CALL_SELECT,
        orderBy: buildFeedOrderBy(args.kind),
        take: Math.max(limit + 1, candidateLimit),
      });
      const records = lightRecords.map((record) => ({
        ...record,
        _count: {
          likes: 0,
          comments: record.threadCount ?? 0,
          reposts: 0,
          reactions: 0,
        },
      })) as CallRecord[];

      const initiallyHydrated = sortCalls(
        args.kind,
        await hydrateCalls(records, args.viewerId, {
          refreshTraders: false,
          refreshTokens: false,
          ensureTokenLinks: true,
          persistComputed: false,
          preferStoredIntelligence: preferStoredFeedIntelligence,
        })
      );
      const baseHydrated = filterCallsForFeedKind(args.kind, initiallyHydrated);
      const hydratedBeforeRanking = filterCallsForFeedKind(
        args.kind,
        isDirectChronologicalFeed
          ? await refreshPriorityFeedSlice(args, records, baseHydrated)
          : baseHydrated
      );
      const hydrated = sortCalls(
        args.kind,
        await applyFeedRankingContext(args.kind, hydratedBeforeRanking, followedTraderIds, followedTokenIds)
      );
      const startIndex =
        isDirectChronologicalFeed && cursorBoundary
          ? 0
          : args.cursor
            ? Math.max(0, hydrated.findIndex((item) => item.id === args.cursor) + 1)
            : 0;
      const items = await enrichSelectedFeedPayloads(
        hydrated.slice(startIndex, startIndex + limit).map(sanitizeFeedItemForResponse)
      );
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
    };

    try {
      const result = await withSoftTimeout(computeFeedResult(), FEED_LIST_SOFT_TIMEOUT_MS);
      if (result) {
        return result;
      }

      if (staleCached) {
        console.warn("[intelligence/feed] serving stale feed cache after soft timeout", {
          kind: args.kind,
          viewerId: args.viewerId,
          timeoutMs: FEED_LIST_SOFT_TIMEOUT_MS,
        });
        return staleCached;
      }

      console.warn("[intelligence/feed] feed soft-timed out; serving degraded empty state", {
        kind: args.kind,
        viewerId: args.viewerId,
        timeoutMs: FEED_LIST_SOFT_TIMEOUT_MS,
      });
      notePrismaPoolPressure(`intelligence/feed_soft_timeout:${args.kind}`);
      return {
        items: [],
        hasMore: false,
        nextCursor: null,
        totalItems: 0,
        degraded: true,
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
  })()
    .then((value) => writeCacheValue(feedListCache, cacheKey, value, ttlMs, FEED_LIST_CACHE_MAX_ENTRIES))
    .finally(() => {
      feedListInFlight.delete(cacheKey);
    });

  feedListInFlight.set(cacheKey, request);
  return cloneCachedValue(await request);
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
    ensureTokenLinks: true,
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

export async function findTokenByAddress(address: string): Promise<TokenRecord | null> {
  const normalizedAddress = address.trim();
  const cacheKey = buildTokenLookupCacheKey(normalizedAddress);
  const staleCachedToken = peekCacheValue(tokenLookupCache, cacheKey);

  // Check in-memory cache first (fastest path)
  const inMemory = readCacheValue(tokenLookupCache, cacheKey);
  if (inMemory !== null) return inMemory;

  // Check Redis before hitting DB (shared across instances)
  if (isRedisConfigured()) {
    const redisRaw = await cacheGetJson<unknown>(buildTokenLookupRedisKey(normalizedAddress));
    if (redisRaw !== null) {
      try {
        const redisToken = deserializeWithDates<TokenRecord | null>(JSON.stringify(redisRaw));
        if (redisToken !== null) {
          writeTokenLookupCacheValue(normalizedAddress, redisToken);
          return redisToken;
        }
      } catch {
        // ignore malformed Redis entry, fall through to DB
      }
    }
  }

  return memoizeCached(tokenLookupCache, tokenLookupInFlight, cacheKey, TOKEN_LOOKUP_CACHE_TTL_MS, async () => {
    try {
      const token = await prisma.token.findFirst({
        where: {
          address: normalizedAddress,
        },
        select: TOKEN_SELECT,
        orderBy: { updatedAt: "desc" },
      });

      if (token) {
        void cacheSetJson(buildTokenLookupRedisKey(normalizedAddress), JSON.parse(serializeWithDates(token)), TOKEN_LOOKUP_REDIS_TTL_MS);
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
      let resolved = tokenMap.get(key) ?? null;

      // If ensureTokensForCalls didn't populate the map (e.g. batch create failed silently),
      // do one final direct lookup so the token page isn't falsely shown as "not found".
      if (!resolved) {
        resolved = await prisma.token.findFirst({
          where: { address: normalizedAddress },
          select: TOKEN_SELECT,
          orderBy: { updatedAt: "desc" },
        }).catch(() => null);
      }

      if (resolved) {
        void cacheSetJson(buildTokenLookupRedisKey(normalizedAddress), JSON.parse(serializeWithDates(resolved)), TOKEN_LOOKUP_REDIS_TTL_MS);
      }
      return resolved;
    } catch (error) {
      if (staleCachedToken) {
        console.warn("[intelligence/token] serving stale token lookup after transient prisma failure", {
          address: normalizedAddress,
          message: error instanceof Error ? error.message : String(error),
        });
        return staleCachedToken;
      }
      throw error;
    }
  });
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

export async function refreshTokenIntelligenceByAddress(
  address: string,
  opts?: { awaitSignalAlerts?: boolean }
): Promise<TokenRefreshResult | null> {
  const normalizedAddress = address.trim();
  if (!normalizedAddress) {
    return null;
  }

  const token = await findTokenByAddress(normalizedAddress);
  if (!token) {
    return null;
  }

  return refreshTokenIntelligence(token.id, opts);
}

function getFreshestCallMetricTimestamp(
  call: Pick<EnrichedCall, "lastMcapUpdate" | "lastIntelligenceAt" | "createdAt">
): number {
  return Math.max(
    toDateMs(call.lastMcapUpdate),
    toDateMs(call.lastIntelligenceAt),
    toDateMs(call.createdAt)
  );
}

function pickFreshestCallCurrentMcap(
  calls: Array<Pick<EnrichedCall, "currentMcap" | "lastMcapUpdate" | "lastIntelligenceAt" | "createdAt">>
): number | null {
  let bestValue: number | null = null;
  let bestTimestamp = 0;

  for (const call of calls) {
    if (!hasPositiveMetric(call.currentMcap)) {
      continue;
    }

    const timestamp = getFreshestCallMetricTimestamp(call);
    if (bestValue === null || timestamp >= bestTimestamp) {
      bestValue = call.currentMcap;
      bestTimestamp = timestamp;
    }
  }

  return bestValue;
}

export async function getTokenOverviewByAddress(address: string, viewerId: string | null): Promise<TokenOverview | null> {
  const normalizedAddress = address.trim();
  const cacheKey = `token:v${TOKEN_OVERVIEW_CACHE_VERSION}:${viewerId ?? "anonymous"}:${sanitizeCacheKeyPart(normalizedAddress)}`;
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
    const staleTopHolders =
      staleToken?.topHolders && staleToken.topHolders.length > 0
        ? cloneCachedValue(staleToken.topHolders)
        : [];
    const currentToken = token;
    const needsFallbackTokenData =
      tokenNeedsCoreHydration(currentToken) ||
      !hasFiniteMetric(currentToken.liquidity) ||
      !hasFiniteMetric(currentToken.volume24h) ||
      (currentToken.chainType === "solana" &&
        (!hasPositiveMetric(currentToken.holderCount) ||
          !hasFiniteMetric(currentToken.top10HolderPct) ||
          !hasFiniteMetric(currentToken.largestHolderPct) ||
          staleTopHolders.length === 0 ||
          !hasResolvedHolderRoleIntelligence(staleTopHolders, staleToken?.devWallet ?? null)));

    const [
      callsRaw,
      clusters,
      snapshots,
      events,
      tokenFollow,
      marketSnapshotFallback,
      distributionFallback,
      communityProfile,
      communityBannerAsset,
    ] = await Promise.all([
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
              currentAction: true,
            },
            orderBy: [{ estimatedSupplyPct: "desc" }, { clusterLabel: "asc" }],
          }),
        [] as Array<{
          id: string;
          clusterLabel: string;
          walletCount: number;
          estimatedSupplyPct: number;
          evidenceJson: unknown;
          currentAction: string | null;
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
      resolveTokenOverviewSection(
        "market_snapshot_query",
        () => getCachedMarketCapSnapshot(currentToken.address, currentToken.chainType),
        { mcap: null } as MarketCapResult
      ),
      needsFallbackTokenData && currentToken.chainType === "solana"
        ? resolveTokenOverviewSection(
            "distribution_query",
            () => analyzeSolanaTokenDistribution(currentToken.address, currentToken.liquidity),
            null,
            { timeoutMs: TOKEN_OVERVIEW_DISTRIBUTION_SECTION_TIMEOUT_MS }
          )
        : Promise.resolve(null),
      resolveTokenOverviewSection(
        "community_profile_query",
        () =>
          prisma.tokenCommunityProfile.findUnique({
            where: { tokenId: currentToken.id },
            select: { id: true },
          }),
        staleToken?.communityExists ? ({ id: "__stale__" } as { id: string }) : null
      ),
      resolveTokenOverviewSection(
        "community_banner_query",
        () =>
          prisma.tokenCommunityAsset.findFirst({
            where: {
              tokenId: currentToken.id,
              kind: "banner",
              status: "ready",
            },
            select: {
              url: true,
            },
            orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }],
          }),
        staleToken?.communityBannerUrl ? ({ url: staleToken.communityBannerUrl } as { url: string }) : null
      ),
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
                preferStoredIntelligence: false,
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
    const sentimentTrendAdjustment = computeDexSentimentTrendAdjustment(marketSnapshotFallback);
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
      pickFirstPositiveMetric(
        marketSnapshotFallback?.liquidityUsd,
        currentToken.liquidity,
        staleToken?.liquidity
      )
    );
    const resolvedVolume24h = roundMetric(
      pickFirstPositiveMetric(
        marketSnapshotFallback?.volume24hUsd,
        currentToken.volume24h,
        staleToken?.volume24h
      )
    );
    const latestSnapshotMarketCap =
      snapshots.length > 0 ? snapshots[snapshots.length - 1]?.marketCap ?? null : null;
    const resolvedMarketCap = roundMetric(
      pickFirstPositiveMetric(
        pickFreshestCallCurrentMcap(recentCalls),
        marketSnapshotFallback?.mcap,
        latestSnapshotMarketCap,
        events.find((event) => hasFiniteMetric(event.marketCap))?.marketCap,
        staleToken?.marketCap
      )
    );
    const staleDevWallet =
      staleToken?.devWallet
        ? cloneCachedValue(staleToken.devWallet)
        : null;
    const hasFreshDistributionTelemetry = Boolean(distributionFallback);
    const minimumObservedHolderCount = Math.max(
      distributionFallback?.topHolders.length ?? 0,
      staleTopHolders.length
    );
    const isPlausibleStoredHolderCount = (value: number | null | undefined): value is number =>
      hasPositiveMetric(value) &&
      Math.round(value) >= minimumObservedHolderCount &&
      !looksLikeLowerBoundSolanaHolderCount({
        storedHolderCount: value,
        observedTopHolderCount: minimumObservedHolderCount,
        liveHolderCount: distributionFallback?.holderCount,
        liveHolderCountSource: distributionFallback?.holderCountSource ?? staleToken?.holderCountSource ?? null,
      });
    const storedSolanaHolderCount = isPlausibleStoredHolderCount(currentToken.holderCount)
      ? Math.round(currentToken.holderCount)
      : isPlausibleStoredHolderCount(staleToken?.holderCount)
        ? Math.round(staleToken!.holderCount!)
        : null;
    const hasResolvedDistributionHolderCount = hasVerifiedSolanaHolderCount(
      distributionFallback?.holderCount,
      distributionFallback?.holderCountSource ?? null
    );
    const unresolvedDistributionHolderCount =
      distributionFallback?.holderCountSource === "largest_accounts"
        ? distributionFallback?.holderCount
        : minimumObservedHolderCount > 0 && !hasResolvedDistributionHolderCount
          ? minimumObservedHolderCount
        : null;
    const resolvedHolderCount = Math.round(
      pickFirstPositiveMetric(
        hasResolvedDistributionHolderCount ? distributionFallback?.holderCount : null,
        currentToken.chainType === "solana" ? storedSolanaHolderCount : currentToken.holderCount,
        currentToken.chainType === "solana" ? null : staleToken?.holderCount,
        !hasResolvedDistributionHolderCount ? unresolvedDistributionHolderCount : null
      ) ?? 0
    ) || null;
    const resolvedHolderCountSource =
      hasResolvedDistributionHolderCount
        ? distributionFallback?.holderCountSource ?? null
        : currentToken.chainType === "solana"
          ? storedSolanaHolderCount !== null
            ? "stored"
            : unresolvedDistributionHolderCount !== null
              ? distributionFallback?.holderCountSource ??
                (minimumObservedHolderCount > 0 || staleTopHolders.length > 0
                  ? staleToken?.holderCountSource ?? "largest_accounts"
                  : null)
              : (minimumObservedHolderCount > 0 || staleTopHolders.length > 0
                  ? staleToken?.holderCountSource ?? "largest_accounts"
                  : null)
          : resolvedHolderCount !== null
            ? "stored"
            : null;
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
    // Don't trust stored scores when liquidity has collapsed — they reflect old active state
    const tokenLiquidityIsDead =
      typeof currentToken.liquidity === "number" &&
      Number.isFinite(currentToken.liquidity) &&
      currentToken.liquidity > 0 &&
      currentToken.liquidity < 5_000;
    const canUseCurrentTokenStoredIntelligence =
      !tokenLiquidityIsDead && hasFreshStoredTokenIntelligence(currentToken);
    const currentTokenConfidenceScore = canUseCurrentTokenStoredIntelligence
      ? currentToken.confidenceScore
      : null;
    const currentTokenHotAlphaScore = canUseCurrentTokenStoredIntelligence
      ? currentToken.hotAlphaScore
      : null;
    const currentTokenEarlyRunnerScore = canUseCurrentTokenStoredIntelligence
      ? currentToken.earlyRunnerScore
      : null;
    const currentTokenHighConvictionScore = canUseCurrentTokenStoredIntelligence
      ? currentToken.highConvictionScore
      : null;
    const currentTokenRiskScore = canUseCurrentTokenStoredIntelligence
      ? currentToken.tokenRiskScore
      : null;
    const currentTokenBundleRiskLabel = canUseCurrentTokenStoredIntelligence
      ? currentToken.bundleRiskLabel
      : null;
    const resolvedTokenRiskScore = roundMetric(
      pickFirstFiniteMetric(
        distributionFallback?.tokenRiskScore,
        currentTokenRiskScore
      )
    );
    const resolvedBundleRiskLabel =
      distributionFallback?.bundleRiskLabel ??
      currentTokenBundleRiskLabel ??
      (resolvedTokenRiskScore !== null ? determineBundleRiskLabel(resolvedTokenRiskScore) : null);
    const rawTopHolders =
      hasFreshDistributionTelemetry &&
      distributionFallback?.topHolders &&
      distributionFallback.topHolders.length > 0
        ? cloneCachedValue(distributionFallback.topHolders)
        : staleTopHolders;

    // Cross-reference top holder wallets against phew user accounts
    const holderWallets = rawTopHolders.map((h) => h.ownerAddress ?? h.address).filter(Boolean) as string[];
    const linkedUsers = holderWallets.length > 0
      ? await prisma.user.findMany({
          where: { walletAddress: { in: holderWallets } },
          select: { id: true, walletAddress: true, username: true, image: true },
        }).catch(() => [])
      : [];
    const linkedUserMap = new Map(linkedUsers.map((u) => [u.walletAddress!, { id: u.id, username: u.username, image: u.image }]));
    const callerEntryMcapByUserId = new Map<string, number | null>();
    for (const call of recentCalls) {
      if (!callerEntryMcapByUserId.has(call.author.id) && typeof call.entryMcap === "number") {
        callerEntryMcapByUserId.set(call.author.id, call.entryMcap);
      }
    }
    const resolvedTopHolders: TokenHolderSnapshot[] = rawTopHolders.map((h) => {
      const walletKey = h.ownerAddress ?? h.address;
      const linked = walletKey ? linkedUserMap.get(walletKey) : undefined;
      const phewEntryMcap = linked ? (callerEntryMcapByUserId.get(linked.id) ?? null) : null;
      return { ...h, phewHandle: linked?.username ?? null, phewImage: linked?.image ?? null, phewEntryMcap };
    });

    const resolvedDevWallet = distributionFallback?.devWallet
      ? cloneCachedValue(distributionFallback.devWallet)
      : staleDevWallet;
    const resolvedConfidenceScore = roundMetric(
      pickFirstFiniteMetric(
        currentTokenConfidenceScore,
        recentCalls.length > 0
          ? recentCalls.reduce((sum, call) => sum + finite(call.confidenceScore), 0) / recentCalls.length
          : null
      )
    );
    const resolvedHotAlphaScore = roundMetric(
      pickFirstFiniteMetric(
        currentTokenHotAlphaScore,
        recentCalls.length > 0
          ? recentCalls.reduce((sum, call) => sum + finite(call.hotAlphaScore), 0) / recentCalls.length
          : null
      )
    );
    const resolvedEarlyRunnerScore = roundMetric(
      pickFirstFiniteMetric(
        currentTokenEarlyRunnerScore,
        recentCalls.length > 0
          ? Math.max(...recentCalls.map((call) => finite(call.earlyRunnerScore)))
          : null
      )
    );
    const resolvedHighConvictionScore = roundMetric(
      pickFirstFiniteMetric(
        currentTokenHighConvictionScore,
        recentCalls.length > 0
          ? recentCalls.reduce((sum, call) => sum + finite(call.highConvictionScore), 0) / recentCalls.length
          : null
      )
    );
    const latestOverviewSignalAtMs = recentCalls.reduce(
      (latest, call) => Math.max(latest, call.createdAt.getTime()),
      0
    );
    const overviewScoreState = computeStateAwareIntelligenceScores({
      baseConfidenceScore: resolvedConfidenceScore,
      baseHotAlphaScore: resolvedHotAlphaScore,
      baseEarlyRunnerScore: resolvedEarlyRunnerScore,
      baseHighConvictionScore: resolvedHighConvictionScore,
      liquidityUsd: resolvedLiquidity,
      volume24hUsd: resolvedVolume24h,
      holderCount: resolvedHolderCount,
      largestHolderPct: resolvedLargestHolderPct,
      top10HolderPct: resolvedTop10HolderPct,
      deployerSupplyPct: resolvedDeployerSupplyPct,
      bundledWalletCount: resolvedBundledWalletCount,
      estimatedBundledSupplyPct: resolvedEstimatedBundledSupplyPct,
      tokenRiskScore: resolvedTokenRiskScore,
      traderTrustScore:
        recentCalls.length > 0
          ? recentCalls.reduce((sum, call) => sum + finite(call.author.trustScore), 0) / recentCalls.length
          : null,
      entryQualityScore:
        recentCalls.length > 0
          ? recentCalls.reduce((sum, call) => sum + finite(call.entryQualityScore), 0) / recentCalls.length
          : null,
      trustedTraderCount: new Set(
        recentCalls
          .filter((call) => finite(call.author.trustScore) >= TRUSTED_TRADER_THRESHOLD)
          .map((call) => call.authorId)
      ).size,
      sentimentScore,
      marketBreadthScore: 50,
      liquidityGrowthPct: null,
      volumeGrowthPct: null,
      holderGrowthPct: null,
      mcapGrowthPct: null,
      momentumPct: roundMetric(marketSnapshotFallback?.priceChange24hPct ?? null),
      tradeCount24h:
        typeof marketSnapshotFallback?.buys24h === "number" || typeof marketSnapshotFallback?.sells24h === "number"
          ? finite(marketSnapshotFallback?.buys24h) + finite(marketSnapshotFallback?.sells24h)
          : null,
      hasTradablePair: Boolean(
        marketSnapshotFallback?.pairAddress ??
          currentToken.pairAddress ??
          marketSnapshotFallback?.dexscreenerUrl ??
          currentToken.dexscreenerUrl
      ),
      hasResolvedHolderDistribution:
        rawTopHolders.length > 0 ||
        resolvedLargestHolderPct !== null ||
        resolvedTop10HolderPct !== null,
      recentCallCount: recentCalls.length,
      signalAgeHours:
        latestOverviewSignalAtMs > 0
          ? Math.max(0, (Date.now() - latestOverviewSignalAtMs) / (60 * 60 * 1000))
          : null,
    });

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
              normalizeOptionalDate(currentToken.lastIntelligenceAt)?.toISOString() ??
              (normalizeOptionalDate(currentToken.updatedAt)?.toISOString() ?? new Date().toISOString()),
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
            currentAction: null,
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
        symbol: marketSnapshotFallback?.tokenSymbol ?? currentToken.symbol,
        name: marketSnapshotFallback?.tokenName ?? currentToken.name,
        imageUrl: marketSnapshotFallback?.tokenImage ?? currentToken.imageUrl,
        dexscreenerUrl: marketSnapshotFallback?.dexscreenerUrl ?? currentToken.dexscreenerUrl,
        pairAddress: marketSnapshotFallback?.pairAddress ?? currentToken.pairAddress,
        dexId: marketSnapshotFallback?.dexId ?? currentToken.dexId,
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
        lastIntelligenceAt: normalizeOptionalDate(
          currentToken.lastIntelligenceAt ?? staleToken?.lastIntelligenceAt ?? null
        ),
        confidenceScore: roundMetric(overviewScoreState.confidenceScore),
        hotAlphaScore: roundMetric(overviewScoreState.hotAlphaScore),
        earlyRunnerScore: roundMetric(overviewScoreState.earlyRunnerScore),
        highConvictionScore: roundMetric(overviewScoreState.highConvictionScore),
        marketHealthScore: overviewScoreState.marketHealthScore,
        setupQualityScore: overviewScoreState.setupQualityScore,
        opportunityScore: overviewScoreState.opportunityScore,
        dataReliabilityScore: overviewScoreState.dataReliabilityScore,
        activityStatus: overviewScoreState.activityStatus,
        activityStatusLabel: overviewScoreState.activityStatusLabel,
        isTradable: overviewScoreState.isTradable,
        bullishSignalsSuppressed: overviewScoreState.bullishSignalsSuppressed,
        isFollowing: viewerId ? Boolean(tokenFollow) : false,
        communityExists: Boolean(communityProfile),
        communityBannerUrl: communityBannerAsset?.url ?? staleToken?.communityBannerUrl ?? null,
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
  const leaderboardWindowStart = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const todaysCallsRaw = await prisma.post.findMany({
    where: {
      createdAt: {
        gte: leaderboardWindowStart,
      },
    },
    select: CALL_SELECT,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: 180,
  });

  const todaysCalls = await hydrateCalls(todaysCallsRaw, null, {
    refreshTraders: false,
    refreshTokens: false,
    ensureTokenLinks: false,
    persistComputed: false,
    preferStoredIntelligence: true,
  });
  const primaryQualifiedCallsToday = todaysCalls.filter((call) => {
    return (
      !call.bullishSignalsSuppressed &&
      call.isTradable &&
      call.marketHealthScore >= 40 &&
      finite(call.confidenceScore) >= 45 &&
      (call.roiCurrentPct === null || call.roiCurrentPct > -50)
    );
  });
  const fallbackQualifiedCallsToday = todaysCalls.filter((call) => {
    const hasStrongSignal =
      finite(call.confidenceScore) >= 35 ||
      finite(call.hotAlphaScore) >= 60 ||
      finite(call.earlyRunnerScore) >= 60 ||
      finite(call.highConvictionScore) >= 60;
    return (
      !call.bullishSignalsSuppressed &&
      call.marketHealthScore >= 35 &&
      call.opportunityScore >= 40 &&
      hasStrongSignal &&
      (call.roiCurrentPct === null || call.roiCurrentPct > -70)
    );
  });
  const qualifiedCallsToday =
    primaryQualifiedCallsToday.length > 0
      ? primaryQualifiedCallsToday
      : fallbackQualifiedCallsToday.length > 0
        ? fallbackQualifiedCallsToday
        : todaysCalls.filter((call) => call.roiCurrentPct === null || call.roiCurrentPct > -80);
  const traderMap = new Map<string, LeaderboardsPayload["topTradersToday"][number] & { wins: number }>();

  for (const call of qualifiedCallsToday) {
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
  const sortedHotAlphaToday = [...qualifiedCallsToday].sort((left, right) => {
    const hotDelta = right.hotAlphaScore - left.hotAlphaScore;
    if (hotDelta !== 0) return hotDelta;
    const confidenceDelta = right.confidenceScore - left.confidenceScore;
    if (confidenceDelta !== 0) return confidenceDelta;
    return right.createdAt.getTime() - left.createdAt.getTime();
  });
  const hardRankedHotAlphaToday = sortedHotAlphaToday.filter((call) =>
    isEligibleForRankedFeed("hot-alpha", call)
  );
  const fallbackHotAlphaToday = sortedHotAlphaToday.filter((call) => {
    return (
      finite(call.hotAlphaScore) >= 35 ||
      finite(call.confidenceScore) >= 35 ||
      finite(call.earlyRunnerScore) >= 50 ||
      finite(call.highConvictionScore) >= 50
    );
  });

  return {
    topTradersToday,
    topAlphaToday: (hardRankedHotAlphaToday.length > 0
      ? hardRankedHotAlphaToday
      : fallbackHotAlphaToday)
      .slice(0, 12),
    biggestRoiToday: [...qualifiedCallsToday]
      .filter((call) => finite(call.roiPeakPct, -100) > 0)
      .sort((left, right) => finite(right.roiPeakPct, -100) - finite(left.roiPeakPct, -100))
      .slice(0, 12),
    bestEntryToday: [...qualifiedCallsToday]
      .filter((call) => call.firstCallerRank === 1 || call.timingTier === "FIRST CALLER")
      .sort((left, right) => {
        const entryDelta = finite(right.entryQualityScore) - finite(left.entryQualityScore);
        if (entryDelta !== 0) return entryDelta;
        const confidenceDelta = right.confidenceScore - left.confidenceScore;
        if (confidenceDelta !== 0) return confidenceDelta;
        return finite(right.roiPeakPct, -100) - finite(left.roiPeakPct, -100);
      })
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
