import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { prisma } from "../prisma.js";
import { type AuthVariables, requireAuth } from "../auth.js";
import {
  CreatePostSchema,
  CreateCommentSchema,
  FeedQuerySchema,
  detectContractAddress,
  MIN_LEVEL,
  MAX_LEVEL,
  LIQUIDATION_LEVEL,
  calculateXpChange,
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

export const postsRouter = new Hono<{ Variables: AuthVariables }>();

type SettlementRunResult = {
  settled1h: number;
  snapshot6h: number;
  levelChanges6h: number;
  errors: number;
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
};

let maintenanceRunInFlight: Promise<MaintenanceRunResult> | null = null;
let lastMaintenanceRunStartedAt = 0;
const MAINTENANCE_RUN_MIN_INTERVAL_MS = process.env.NODE_ENV === "production" ? 30_000 : 5_000;
const priceRefreshInFlight = new Map<string, Promise<number | null>>();
const TRENDING_CACHE_TTL_MS = process.env.NODE_ENV === "production" ? 30_000 : 10_000;
let trendingCache: { data: unknown; expiresAtMs: number } | null = null;
let trendingInFlight: Promise<unknown> | null = null;
const FEED_MCAP_CACHE_TTL_MS = process.env.NODE_ENV === "production" ? 15_000 : 5_000;
const SHARED_ALPHA_CACHE_TTL_MS = process.env.NODE_ENV === "production" ? 60_000 : 10_000;
const MARKET_REFRESH_LOOKBACK_MS = process.env.NODE_ENV === "production" ? 7 * 24 * 60 * 60 * 1000 : 24 * 60 * 60 * 1000;
const MARKET_REFRESH_SCAN_LIMIT = process.env.NODE_ENV === "production" ? 160 : 60;
const MARKET_REFRESH_MAX_CONTRACTS_PER_RUN = process.env.NODE_ENV === "production" ? 20 : 8;
const HOURLY_POST_LIMIT = 3;
const feedMcapCache = new Map<string, { result: MarketCapResult; expiresAtMs: number }>();
const feedMcapInFlight = new Map<string, Promise<MarketCapResult>>();
const sharedAlphaAuthorCache = new Map<string, { authorIds: Set<string>; expiresAtMs: number }>();

/**
 * Helper to fetch market cap using the enhanced service
 * Returns just the mcap value for backward compatibility
 */
async function fetchMarketCap(address: string): Promise<number | null> {
  const result = await fetchMarketCapService(address);
  return result.mcap;
}

async function getFeedMarketCapSnapshot(address: string): Promise<MarketCapResult> {
  const now = Date.now();
  const cached = feedMcapCache.get(address);
  if (cached && cached.expiresAtMs > now) {
    return cached.result;
  }

  const existingInFlight = feedMcapInFlight.get(address);
  if (existingInFlight) {
    return existingInFlight;
  }

  const request = fetchMarketCapService(address)
    .then((result) => {
      feedMcapCache.set(address, {
        result,
        expiresAtMs: Date.now() + FEED_MCAP_CACHE_TTL_MS,
      });
      return result;
    })
    .finally(() => {
      feedMcapInFlight.delete(address);
    });

  feedMcapInFlight.set(address, request);
  return request;
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
    const postsToSettle1h = await prisma.post.findMany({
      where: {
        settled: false,
        contractAddress: { not: null },
        createdAt: { lt: oneHourAgo },
      },
      include: {
        author: true,
      },
      take: 20, // Process max 20 posts per check to avoid timeout
    });

    for (const post of postsToSettle1h) {
      if (!post.contractAddress || post.entryMcap === null) continue;

      try {
        const mcap1h = await fetchMarketCap(post.contractAddress);
        if (mcap1h === null) {
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
        const newLevel = calculateFinalLevel(currentUser.level, levelChange);
        const newXp = Math.max(0, currentUser.xp + xpChange);
        const settledAt = new Date();

        // Keep settlement + user rewards/penalties atomic to avoid "settled but no level/xp" failures.
        await prisma.$transaction([
          prisma.post.update({
            where: { id: post.id },
            data: {
              settled: true,
              settledAt,
              isWin: isWin1h,
              isWin1h: isWin1h,
              currentMcap: mcap1h,
              mcap1h: mcap1h,
              percentChange1h: percentChange1h,
              recoveryEligible: recoveryEligible,
              levelChange1h: levelChange,
              trackingMode: TRACKING_MODE_SETTLED,
              lastMcapUpdate: settledAt,
            },
          }),
          prisma.user.update({
            where: { id: post.authorId },
            data: {
              level: newLevel,
              xp: newXp,
            },
          }),
        ]);

        // Create notification for the author about 1H settlement
        const levelDiff = newLevel - currentUser.level;
        const xpDisplay = xpChange >= 0 ? `+${xpChange}` : xpChange;
        const levelDisplay = levelDiff >= 0 ? `+${levelDiff}` : levelDiff;

        let settlementMsg: string;
        if (isWin1h) {
          settlementMsg = `1H WIN! +${percentChange1h.toFixed(1)}% | Level ${levelDisplay} | XP ${xpDisplay}`;
        } else if (recoveryEligible) {
          settlementMsg = `1H: ${percentChange1h.toFixed(1)}% | Recovery chance at 6H!`;
        } else {
          settlementMsg = `1H LOSS: ${percentChange1h.toFixed(1)}% | Level ${levelDisplay} | XP ${xpDisplay}`;
        }

        await prisma.notification.create({
          data: {
            userId: post.authorId,
            type: "settlement",
            message: settlementMsg,
            postId: post.id,
          },
        });

        settled1hCount++;
        console.log(`[Settlement 1H] Post ${post.id}: ${isWin1h ? 'WIN' : 'LOSS'} (${percentChange1h.toFixed(2)}%), recoveryEligible=${recoveryEligible}, User ${post.authorId} level ${currentUser.level} -> ${newLevel}`);
      } catch (err) {
        console.error(`[Settlement 1H] Error settling post ${post.id}:`, err);
        errorCount++;
      }
    }

    // ============================================
    // 6H MARKET CAP SNAPSHOT - For ALL posts >= 6 hours old
    // This captures the 6H mcap regardless of whether level changes apply
    // ============================================
    const postsNeedingSnapshot6h = await prisma.post.findMany({
      where: {
        // Must have completed 1H settlement first
        settled: true,
        // 6H snapshot not yet taken
        settled6h: false,
        // Must have a contract address to fetch mcap
        contractAddress: { not: null },
        // Must be at least 6 hours old
        createdAt: { lt: sixHoursAgo },
      },
      include: {
        author: true,
      },
      take: 15, // Process max 15 posts per check
    });

    console.log(`[Snapshot 6H] Found ${postsNeedingSnapshot6h.length} posts needing 6H mcap snapshot`);

    for (const post of postsNeedingSnapshot6h) {
      if (!post.contractAddress || post.entryMcap === null) continue;

      try {
        // Fetch current market cap from DexScreener
        const mcap6h = await fetchMarketCap(post.contractAddress);
        if (mcap6h === null) {
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
        const snapshotUpdatedAt = new Date();

        // Keep 6H snapshot + user level change atomic when a level change applies.
        if (levelChange6h !== 0) {
          const currentUser = await prisma.user.findUnique({
            where: { id: post.authorId },
            select: { id: true, level: true, xp: true },
          });
          if (!currentUser) {
            errorCount++;
            continue;
          }
          const newLevel = calculateFinalLevel(currentUser.level, levelChange6h);
          const xpChange = calculateXpChange(percentChange6h);
          const newXp = Math.max(0, currentUser.xp + xpChange);
          await prisma.$transaction([
            prisma.post.update({
              where: { id: post.id },
              data: {
                mcap6h: mcap6h,
                currentMcap: mcap6h,
                isWin6h: isWin6h,
                percentChange6h: percentChange6h,
                settled6h: true,
                levelChange6h: levelChange6h,
                lastMcapUpdate: snapshotUpdatedAt,
              },
            }),
            prisma.user.update({
              where: { id: post.authorId },
              data: {
                level: newLevel,
                xp: newXp,
              },
            }),
          ]);

          snapshot6hCount++;
          console.log(`[Snapshot 6H] Post ${post.id}: mcap6h=${mcap6h}, change=${percentChange6h.toFixed(2)}%, isWin6h=${isWin6h}`);

          // Create notification for the user about level change
          const levelDiff = newLevel - currentUser.level;
          const levelDisplay = levelDiff >= 0 ? `+${levelDiff}` : levelDiff;
          const xpDisplay = xpChange >= 0 ? `+${xpChange}` : xpChange;

          let msg6h: string;
          if (levelChange6h > 0 && recoveryEligible) {
            msg6h = `6H RECOVERY! +${percentChange6h.toFixed(1)}% | Level ${levelDisplay} | XP ${xpDisplay}`;
          } else if (levelChange6h > 0) {
            msg6h = `6H BONUS! +${percentChange6h.toFixed(1)}% | Level ${levelDisplay} | XP ${xpDisplay}`;
          } else {
            msg6h = `6H: ${percentChange6h.toFixed(1)}% | Level ${levelDisplay} | XP ${xpDisplay}`;
          }

          await prisma.notification.create({
            data: {
              userId: post.authorId,
              type: "settlement",
              message: msg6h,
              postId: post.id,
            },
          });

          levelChanges6hCount++;
          console.log(`[Settlement 6H Level] Post ${post.id}: levelChange6h=${levelChange6h}, User ${post.authorId} level ${currentUser.level} -> ${newLevel}`);
        } else {
          await prisma.post.update({
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

  return { settled1h: settled1hCount, snapshot6h: snapshot6hCount, levelChanges6h: levelChanges6hCount, errors: errorCount };
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
        createdAt: true,
        settled: true,
        lastMcapUpdate: true,
        trackingMode: true,
        tokenName: true,
        tokenSymbol: true,
        tokenImage: true,
      },
      orderBy: [
        { lastMcapUpdate: "asc" },
        { createdAt: "desc" },
      ],
      take: MARKET_REFRESH_SCAN_LIMIT,
    });

    result.scannedPosts = candidates.length;

    const postsByContract = new Map<string, typeof candidates>();
    for (const post of candidates) {
      const contractAddress = post.contractAddress;
      if (!contractAddress) continue;

      const shouldUpdateMcap = needsMcapUpdate(post.createdAt, post.lastMcapUpdate, post.settled);
      const needsTokenMetadata = !post.tokenName || !post.tokenSymbol || !post.tokenImage;
      if (!shouldUpdateMcap && !needsTokenMetadata) continue;

      result.eligiblePosts++;

      let bucket = postsByContract.get(contractAddress);
      if (!bucket) {
        if (postsByContract.size >= MARKET_REFRESH_MAX_CONTRACTS_PER_RUN) continue;
        bucket = [];
        postsByContract.set(contractAddress, bucket);
      }
      bucket.push(post);
    }

    for (const [contractAddress, posts] of postsByContract) {
      let marketCapResult: MarketCapResult;

      try {
        marketCapResult = await getFeedMarketCapSnapshot(contractAddress);
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
            currentMcap?: number;
            lastMcapUpdate?: Date;
            trackingMode?: string;
            tokenName?: string | null;
            tokenSymbol?: string | null;
            tokenImage?: string | null;
          } = {};

          if (shouldUpdateMcap && marketCapResult.mcap !== null) {
            updateData.currentMcap = marketCapResult.mcap;
            updateData.lastMcapUpdate = new Date();
            updateData.trackingMode = trackingMode;
          }

          if (!post.tokenName && marketCapResult.tokenName) {
            updateData.tokenName = marketCapResult.tokenName;
          }
          if (!post.tokenSymbol && marketCapResult.tokenSymbol) {
            updateData.tokenSymbol = marketCapResult.tokenSymbol;
          }
          if (!post.tokenImage && marketCapResult.tokenImage) {
            updateData.tokenImage = marketCapResult.tokenImage;
          }

          if (Object.keys(updateData).length === 0) continue;

          await prisma.post.update({
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

async function runMaintenanceCycle(): Promise<MaintenanceRunResult> {
  const startedAtMs = Date.now();
  const settlement = await checkAndSettlePosts();
  const marketRefresh = await refreshTrackedMarketCaps();

  const summary: MaintenanceRunResult = {
    startedAt: new Date(startedAtMs).toISOString(),
    durationMs: Date.now() - startedAtMs,
    settlement,
    marketRefresh,
  };

  if (
    settlement.settled1h ||
    settlement.snapshot6h ||
    settlement.levelChanges6h ||
    settlement.errors ||
    marketRefresh.refreshedContracts ||
    marketRefresh.updatedPosts ||
    marketRefresh.errors
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
      throw error;
    })
    .finally(() => {
      maintenanceRunInFlight = null;
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
    : { sort: "latest" as const, following: false, limit: 50, cursor: undefined, search: undefined };

  // Safety fallback when scheduled maintenance is not running (e.g. no Vercel cron).
  // This is throttled + non-blocking, and only runs on the first page to avoid feed jitter.
  if (!cursor && !search) {
    triggerMaintenanceCycleNonBlocking(`feed:${sort}${following ? ":following" : ""}`);
  }

  // Build the where clause - use Prisma's AND/OR operators
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const whereConditions: any[] = [];

  if (sort === "trending") {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    whereConditions.push({ createdAt: { gte: sevenDaysAgo } });
  }

  // If following filter is true, only show posts from followed users (NOT including user's own posts)
  if (following && user) {
    const followedUsers = await prisma.follow.findMany({
      where: { followerId: user.id },
      select: { followingId: true },
    });
    const followedIds = followedUsers.map((f) => f.followingId);

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

  // Add search conditions if search query provided
  // Note: SQLite doesn't support mode: "insensitive", so we use LOWER() via raw queries
  // For now, we use contains which is case-sensitive, and filter in application layer if needed
  if (search && search.trim().length > 0) {
    const searchTerm = search.trim();
    whereConditions.push({
      OR: [
        { tokenName: { contains: searchTerm } },
        { tokenSymbol: { contains: searchTerm } },
        { content: { contains: searchTerm } },
        { author: { username: { contains: searchTerm } } },
        { author: { name: { contains: searchTerm } } },
        // Also search for lowercase versions
        { tokenName: { contains: searchTerm.toLowerCase() } },
        { tokenSymbol: { contains: searchTerm.toLowerCase() } },
        { content: { contains: searchTerm.toLowerCase() } },
        { author: { username: { contains: searchTerm.toLowerCase() } } },
        { author: { name: { contains: searchTerm.toLowerCase() } } },
        // Also search for uppercase versions
        { tokenName: { contains: searchTerm.toUpperCase() } },
        { tokenSymbol: { contains: searchTerm.toUpperCase() } },
        { content: { contains: searchTerm.toUpperCase() } },
        { author: { username: { contains: searchTerm.toUpperCase() } } },
        { author: { name: { contains: searchTerm.toUpperCase() } } },
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

  const fetchedPosts = await prisma.post.findMany({
    where: whereClause,
    orderBy: [
      { createdAt: "desc" },
      { id: "desc" },
    ],
    take: cursorPaginationEnabled ? limit + 1 : limit,
    ...(cursorPaginationEnabled && cursor
      ? {
          cursor: { id: cursor },
          skip: 1,
        }
      : {}),
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

  // Get user's likes and reposts for these posts
  let userLikes: Set<string> = new Set();
  let userReposts: Set<string> = new Set();
  let userFollowing: Set<string> = new Set();

  if (user && posts.length > 0) {
    const postIds = posts.map((p) => p.id);
    const authorIds = [...new Set(posts.map((p) => p.authorId))];

    const [likes, reposts, follows] = await Promise.all([
      prisma.like.findMany({
        where: {
          userId: user.id,
          postId: { in: postIds },
        },
        select: { postId: true },
      }),
      prisma.repost.findMany({
        where: {
          userId: user.id,
          postId: { in: postIds },
        },
        select: { postId: true },
      }),
      prisma.follow.findMany({
        where: {
          followerId: user.id,
          followingId: { in: authorIds },
        },
        select: { followingId: true },
      }),
    ]);

    userLikes = new Set(likes.map((l) => l.postId));
    userReposts = new Set(reposts.map((r) => r.postId));
    userFollowing = new Set(follows.map((f) => f.followingId));
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

        // 1. Primary: Winners first (isWin or isWin1h or isWin6h)
        const aIsWin = a.isWin || a.isWin1h || a.isWin6h || false;
        const bIsWin = b.isWin || b.isWin1h || b.isWin6h || false;
        if (aIsWin !== bIsWin) {
          return bIsWin ? 1 : -1; // Winners (true) come first
        }

        // 2. Secondary: Sort by percentage gain (highest first)
        const gainA = getPercentGain(a);
        const gainB = getPercentGain(b);
        if (gainA !== gainB) {
          return gainB - gainA;
        }

        // 3. Tertiary: Sort by engagement (likes + comments + reposts)
        const engagementA = getEngagement(a);
        const engagementB = getEngagement(b);
        if (engagementA !== engagementB) {
          return engagementB - engagementA;
        }

        // 4. Final tiebreaker: Most recent first
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
  if (contractAddresses.length > 0) {
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
      const sharedAlphaCandidates = await prisma.post.findMany({
        where: {
          contractAddress: { in: missingContracts },
          createdAt: { gte: fortyEightHoursAgo },
        },
        select: {
          contractAddress: true,
          authorId: true,
        },
      });

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
    const postWithSharedAlpha = { ...post, sharedAlphaCount: 0 };

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

  return c.json({
    data: postsWithUpdatedMcap,
    hasMore,
    nextCursor,
  });
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

  const now = Date.now();
  if (maintenanceRunInFlight) {
    const result = await maintenanceRunInFlight;
    return c.json({
      data: {
        ...result,
        reusedInFlight: true,
      },
    });
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
  maintenanceRunInFlight = runMaintenanceCycle()
    .catch((error) => {
      console.error("[Maintenance] Run failed:", error);
      throw error;
    })
    .finally(() => {
      maintenanceRunInFlight = null;
    });

  try {
    const result = await maintenanceRunInFlight;
    return c.json({ data: result });
  } catch {
    return c.json({
      error: {
        message: "Maintenance run failed",
        code: "INTERNAL_ERROR",
      },
    }, 500);
  }
});

// Create a new post
postsRouter.post("/", requireAuth, zValidator("json", CreatePostSchema), async (c) => {
  const user = c.get("user");
  if (!user) {
    return c.json({ error: { message: "Unauthorized", code: "UNAUTHORIZED" } }, 401);
  }

  // Check if user is liquidated (level is -5)
  const dbUser = await prisma.user.findUnique({ where: { id: user.id } });
  if (!dbUser || dbUser.level <= LIQUIDATION_LEVEL) {
    return c.json({
      error: {
        message: "You are at level -5 (liquidation). You cannot post new alphas until your level improves.",
        code: "LIQUIDATED"
      }
    }, 403);
  }

  // Rate limit check: max 3 posts per rolling hour
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
  const postCountLastHour = await prisma.post.count({
    where: {
      authorId: user.id,
      createdAt: { gte: oneHourAgo },
    },
  });

  if (postCountLastHour >= HOURLY_POST_LIMIT) {
    const oldestPostThisHour = await prisma.post.findFirst({
      where: {
        authorId: user.id,
        createdAt: { gte: oneHourAgo },
      },
      orderBy: { createdAt: "asc" },
      select: { createdAt: true },
    });

    const resetTime = oldestPostThisHour
      ? new Date(oldestPostThisHour.createdAt.getTime() + 60 * 60 * 1000)
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

  // Rate limit check: max 10 posts per 24 hours
  const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const postCountLast24h = await prisma.post.count({
    where: {
      authorId: user.id,
      createdAt: { gte: twentyFourHoursAgo },
    },
  });

  if (postCountLast24h >= DAILY_POST_LIMIT) {
    // Calculate time until reset
    const oldestPost = await prisma.post.findFirst({
      where: {
        authorId: user.id,
        createdAt: { gte: twentyFourHoursAgo },
      },
      orderBy: { createdAt: "asc" },
      select: { createdAt: true },
    });

    const resetTime = oldestPost
      ? new Date(oldestPost.createdAt.getTime() + 24 * 60 * 60 * 1000)
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

  // Fetch market cap AND token metadata from DexScreener
  const marketCapResult = await fetchMarketCapService(detected.address);
  const entryMcap = marketCapResult.mcap;

  const post = await prisma.post.create({
    data: {
      content,
      authorId: user.id,
      contractAddress: detected.address,
      chainType: detected.chainType,
      entryMcap,
      currentMcap: entryMcap,
      // Store token metadata from DexScreener
      tokenName: marketCapResult.tokenName ?? null,
      tokenSymbol: marketCapResult.tokenSymbol ?? null,
      tokenImage: marketCapResult.tokenImage ?? null,
      trackingMode: TRACKING_MODE_ACTIVE, // New posts start in active tracking mode
      lastMcapUpdate: new Date(),
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
      _count: {
        select: {
          likes: true,
          comments: true,
          reposts: true,
        },
      },
    },
  });

  // Create notifications for all followers
  const followers = await prisma.follow.findMany({
    where: { followingId: user.id },
    select: { followerId: true },
  });

  if (followers.length > 0) {
    const displayName = dbUser.username || dbUser.name;
    await prisma.notification.createMany({
      data: followers.map((follower) => ({
        userId: follower.followerId,
        type: "new_post",
        message: `${displayName} just posted a new Alpha!`,
        postId: post.id,
        fromUserId: user.id,
      })),
    });
  }

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
  const postsToSettle1h = await prisma.post.findMany({
    where: {
      settled: false,
      contractAddress: { not: null },
      createdAt: { lt: oneHourAgo },
    },
    include: {
      author: true,
    },
  });

  for (const post of postsToSettle1h) {
    if (!post.contractAddress || post.entryMcap === null) continue;

    const mcap1h = await fetchMarketCap(post.contractAddress);
    if (mcap1h === null) continue;

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
    const newLevel = calculateFinalLevel(currentUser.level, levelChange);
    const newXp = Math.max(0, currentUser.xp + xpChange);
    const settledAt = new Date();

    await prisma.$transaction([
      prisma.post.update({
        where: { id: post.id },
        data: {
          settled: true,
          settledAt,
          isWin: isWin1h,
          isWin1h: isWin1h,
          currentMcap: mcap1h,
          mcap1h: mcap1h,
          percentChange1h: percentChange1h,
          recoveryEligible: recoveryEligible,
          levelChange1h: levelChange,
          trackingMode: TRACKING_MODE_SETTLED,
          lastMcapUpdate: settledAt,
        },
      }),
      prisma.user.update({
        where: { id: post.authorId },
        data: {
          level: newLevel,
          xp: newXp,
        },
      }),
    ]);

    results1h.push({
      postId: post.id,
      userId: post.authorId,
      isWin: isWin1h,
      percentChange: Math.round(percentChange1h * 100) / 100,
      oldLevel: currentUser.level,
      newLevel,
      oldXp: currentUser.xp,
      newXp,
      xpChange,
      entryMcap: post.entryMcap,
      finalMcap: mcap1h,
      recoveryEligible,
    });
  }

  // ============================================
  // 6H MARKET CAP SNAPSHOT - For ALL posts >= 6 hours old
  // This captures the 6H mcap for every post, regardless of level changes
  // ============================================
  const postsToSnapshot6h = await prisma.post.findMany({
    where: {
      // Must have completed 1H settlement first
      settled: true,
      // 6H snapshot not yet taken
      settled6h: false,
      // Must have a contract address to fetch mcap
      contractAddress: { not: null },
      // Must be at least 6 hours old
      createdAt: { lt: sixHoursAgo },
    },
    include: {
      author: true,
    },
  });

  console.log(`[Settle API] Processing 6H snapshot for ${postsToSnapshot6h.length} posts`);

  for (const post of postsToSnapshot6h) {
    if (!post.contractAddress || post.entryMcap === null) continue;

    const mcap6h = await fetchMarketCap(post.contractAddress);
    if (mcap6h === null) continue;

    const percentChange6h = ((mcap6h - post.entryMcap) / post.entryMcap) * 100;
    const isWin6h = percentChange6h > 0;

    // Use the new 6H settlement logic to check for level changes
    const isWin1h = post.isWin1h ?? post.isWin ?? false;
    const recoveryEligible = post.recoveryEligible ?? false;
    const levelChange6h = calculate6HSettlement(isWin1h, percentChange6h, recoveryEligible);
    let xpChange = 0;
    let oldLevel = post.author.level;
    let newLevel = oldLevel;

    const snapshotUpdatedAt = new Date();
    if (levelChange6h !== 0) {
      const currentUser = await prisma.user.findUnique({
        where: { id: post.authorId },
        select: { id: true, level: true, xp: true },
      });
      if (!currentUser) continue;

      xpChange = calculateXpChange(percentChange6h);
      oldLevel = currentUser.level;
      newLevel = calculateFinalLevel(currentUser.level, levelChange6h);
      const newXp = Math.max(0, currentUser.xp + xpChange);

      await prisma.$transaction([
        prisma.post.update({
          where: { id: post.id },
          data: {
            mcap6h: mcap6h,
            currentMcap: mcap6h,
            isWin6h: isWin6h,
            percentChange6h: percentChange6h,
            settled6h: true,
            levelChange6h: levelChange6h,
            lastMcapUpdate: snapshotUpdatedAt,
          },
        }),
        prisma.user.update({
          where: { id: post.authorId },
          data: {
            level: newLevel,
            xp: newXp,
          },
        }),
      ]);
    } else {
      // ALWAYS update post with 6H snapshot data (for ALL posts)
      await prisma.post.update({
        where: { id: post.id },
        data: {
          mcap6h: mcap6h,
          currentMcap: mcap6h,
          isWin6h: isWin6h,
          percentChange6h: percentChange6h,
          settled6h: true,
          levelChange6h: levelChange6h,
          lastMcapUpdate: snapshotUpdatedAt,
        },
      });
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
      levelChange6h,
      recoveryEligible,
      hadLevelChange: levelChange6h !== 0,
    });
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
    const data = await trendingInFlight;
    return c.json({ data });
  }

  trendingInFlight = (async () => {
  const fortyEightHoursAgo = new Date(Date.now() - 48 * 60 * 60 * 1000);

  // Query posts with contract addresses from last 48 hours
  // Include percent change data for calculating average gain
  const recentPosts = await prisma.post.findMany({
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
          username: true,
          level: true,
        },
      },
    },
    orderBy: { createdAt: "asc" },
  });

  // Group by contract address and count unique users
  const addressMap = new Map<string, {
    contractAddress: string;
    chainType: string | null;
    tokenName: string | null;
    tokenSymbol: string | null;
    callers: Map<string, { userId: string; username: string | null; level: number }>;
    earliestCall: Date;
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
        userId: post.author.id,
        username: post.author.username,
        level: post.author.level,
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

  const trendingTokens = Array.from(addressMap.values())
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

    trendingCache = {
      data: trendingTokens,
      expiresAtMs: Date.now() + TRENDING_CACHE_TTL_MS,
    };
    return trendingTokens;
  })();

  try {
    const data = await trendingInFlight;
    return c.json({ data });
  } finally {
    trendingInFlight = null;
  }
});

// Get single post
postsRouter.get("/:id", async (c) => {
  const id = c.req.param("id");
  const user = c.get("user");

  const post = await prisma.post.findUnique({
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
postsRouter.post("/:id/like", requireAuth, async (c) => {
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

  // Check if already liked
  const existingLike = await prisma.like.findUnique({
    where: { userId_postId: { userId: user.id, postId } },
  });

  if (existingLike) {
    return c.json({ error: { message: "Already liked", code: "ALREADY_LIKED" } }, 400);
  }

  // Create like
  await prisma.like.create({
    data: {
      userId: user.id,
      postId,
    },
  });

  // Create notification for post author (if not liking own post)
  if (post.authorId !== user.id) {
    // Get current user's name from database
    const dbUser = await prisma.user.findUnique({
      where: { id: user.id },
      select: { name: true },
    });
    const userName = dbUser?.name || "Someone";

    await prisma.notification.create({
      data: {
        userId: post.authorId,
        type: "like",
        message: `${userName} liked your Alpha!`,
        postId: post.id,
        fromUserId: user.id,
      },
    });
  }

  // Get updated count
  const likeCount = await prisma.like.count({ where: { postId } });

  return c.json({ data: { liked: true, likeCount } });
});

// Unlike a post
postsRouter.delete("/:id/like", requireAuth, async (c) => {
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
  } catch {
    return c.json({ error: { message: "Like not found", code: "NOT_FOUND" } }, 404);
  }

  // Get updated count
  const likeCount = await prisma.like.count({ where: { postId } });

  return c.json({ data: { liked: false, likeCount } });
});

// Repost a post
postsRouter.post("/:id/repost", requireAuth, async (c) => {
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

  // Check if already reposted
  const existingRepost = await prisma.repost.findUnique({
    where: { userId_postId: { userId: user.id, postId } },
  });

  if (existingRepost) {
    return c.json({ error: { message: "Already reposted", code: "ALREADY_REPOSTED" } }, 400);
  }

  // Create repost
  await prisma.repost.create({
    data: {
      userId: user.id,
      postId,
    },
  });

  // Create notification for post author
  // Get current user's name from database
  const dbUser = await prisma.user.findUnique({
    where: { id: user.id },
    select: { name: true },
  });
  const userName = dbUser?.name || "Someone";

  await prisma.notification.create({
    data: {
      userId: post.authorId,
      type: "repost",
      message: `${userName} reposted your Alpha!`,
      postId: post.id,
      fromUserId: user.id,
    },
  });

  // Get updated count
  const repostCount = await prisma.repost.count({ where: { postId } });

  return c.json({ data: { reposted: true, repostCount } });
});

// Unrepost a post
postsRouter.delete("/:id/repost", requireAuth, async (c) => {
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
  } catch {
    return c.json({ error: { message: "Repost not found", code: "NOT_FOUND" } }, 404);
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
postsRouter.post("/:id/comments", requireAuth, zValidator("json", CreateCommentSchema), async (c) => {
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
postsRouter.delete("/:id/comments/:commentId", requireAuth, async (c) => {
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

  // Get the post with its CA
  const post = await prisma.post.findUnique({
    where: { id: postId },
    select: {
      id: true,
      contractAddress: true,
      createdAt: true,
      authorId: true,
    },
  });

  if (!post) {
    return c.json({ error: { message: "Post not found", code: "NOT_FOUND" } }, 404);
  }

  if (!post.contractAddress) {
    return c.json({ data: { users: [], count: 0 } });
  }

  // Find other posts with same CA within 48 hours
  const fortyEightHoursAgo = new Date(Date.now() - 48 * 60 * 60 * 1000);

  const sharedPosts = await prisma.post.findMany({
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
  });

  const users = sharedPosts.map((p) => ({
    ...p.author,
    postId: p.id,
    postedAt: p.createdAt,
  }));

  return c.json({ data: { users, count: users.length } });
});

// Get real-time price update for a post's CA (force refresh)
// This endpoint always fetches the latest price regardless of tracking mode
postsRouter.get("/:id/price", async (c) => {
  const postId = c.req.param("id");

  const post = await prisma.post.findUnique({
    where: { id: postId },
    select: {
      id: true,
      contractAddress: true,
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

  if (!post) {
    return c.json({ error: { message: "Post not found", code: "NOT_FOUND" } }, 404);
  }

  // If no contract address, return current values
  if (!post.contractAddress) {
    return c.json({
      data: {
        currentMcap: post.currentMcap,
        entryMcap: post.entryMcap,
        mcap1h: post.mcap1h,
        mcap6h: post.mcap6h,
        percentChange: null,
        trackingMode: post.trackingMode,
        lastMcapUpdate: post.lastMcapUpdate?.toISOString() ?? null,
      }
    });
  }

  // Fallback settlement trigger (non-blocking) for live post polling when cron is unavailable.
  // Keeps feed request path clean while still allowing 1H/6H status to catch up.
  if (
    (isReadyFor1HSettlement(post.createdAt, post.settled) ||
      isReadyFor6HSnapshot(post.createdAt, post.mcap6h)) &&
    post.entryMcap !== null
  ) {
    triggerMaintenanceCycleNonBlocking(`price:${postId}`);
  }

  const trackingMode = determineTrackingMode(post.createdAt);
  let finalMcap = post.currentMcap;
  let responseUpdatedAt = post.lastMcapUpdate ?? new Date();

  // Avoid a thundering herd: only refresh if the cached value is stale.
  const shouldRefresh = needsMcapUpdate(post.createdAt, post.lastMcapUpdate, post.settled);

  if (shouldRefresh) {
    let refreshPromise = priceRefreshInFlight.get(postId);
    if (!refreshPromise) {
      refreshPromise = (async () => {
        const latestMcap = await fetchMarketCap(post.contractAddress!);
        if (latestMcap !== null) {
          const now = new Date();
          await prisma.post.update({
            where: { id: postId },
            data: {
              currentMcap: latestMcap,
              lastMcapUpdate: now,
              trackingMode,
            },
          });
        }
        return latestMcap;
      })()
        .catch((error) => {
          console.error("[posts/price] Failed to refresh market cap", { postId, error });
          return null;
        })
        .finally(() => {
          priceRefreshInFlight.delete(postId);
        });
      priceRefreshInFlight.set(postId, refreshPromise);
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

  return c.json({
    data: {
      currentMcap: finalMcap,
      entryMcap: post.entryMcap,
      mcap1h: post.mcap1h,
      mcap6h: post.mcap6h,
      percentChange: percentChange !== null ? Math.round(percentChange * 100) / 100 : null,
      trackingMode: trackingMode,
      lastMcapUpdate: responseUpdatedAt.toISOString(),
      settled: post.settled,
      settledAt: post.settledAt?.toISOString() ?? null,
    },
  });
});
