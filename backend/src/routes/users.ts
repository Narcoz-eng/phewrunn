import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { PublicKey } from "@solana/web3.js";
import nacl from "tweetnacl";
import bs58 from "bs58";
import { prisma, withPrismaRetry, isTransientPrismaError } from "../prisma.js";
import { invalidatePostReadCaches } from "./posts.js";
import { invalidateNotificationsCache } from "./notifications.js";
import { type AuthVariables, requireAuth, requireNotBanned } from "../auth.js";
import { cacheGetJson, cacheSetJson, redisDelete } from "../lib/redis.js";
import { clearCachedMeResponse } from "../lib/me-response-cache.js";
import {
  UpdateProfileSchema,
  USERNAME_UPDATE_COOLDOWN_DAYS,
  PHOTO_UPDATE_COOLDOWN_HOURS,
  ConnectWalletSchema,
  WALLET_CONNECT_LIMIT_PER_HOUR,
  type PublicUserProfileDTO,
  type UserStats,
  type WeeklyStat,
} from "../types.js";
import {
  getWalletPortfolioOverviewForPostedTokens,
  getWalletTradeSnapshotsForSolanaTokens,
  isHeliusConfigured,
} from "../services/helius.js";
import { invalidateViewerSocialCaches } from "../services/intelligence/engine.js";

export const usersRouter = new Hono<{ Variables: AuthVariables }>();
const PROFILE_POST_WALLET_ENRICH_MAX_POSTS = process.env.NODE_ENV === "production" ? 12 : 6;
const PROFILE_WALLET_OVERVIEW_MAX_TOKENS = process.env.NODE_ENV === "production" ? 40 : 20;
const PROFILE_WALLET_OVERVIEW_TIMEOUT_MS = process.env.NODE_ENV === "production" ? 4000 : 8000;
const PLATFORM_FEE_ACCOUNT_FALLBACK = "Gqxyto95NExADzBbGka8j1Ki9QjKcEgSHPYVrNCJQTC6";
const RETAINED_PLATFORM_FEE_BPS = 50; // 0.50% retained by the platform after creator reward
const userSettingsPlatformFeeBps = RETAINED_PLATFORM_FEE_BPS;
const hasUserSettingsPlatformFeeAccount = !!(
  process.env.JUPITER_PLATFORM_FEE_ACCOUNT?.trim() || PLATFORM_FEE_ACCOUNT_FALLBACK
);
const activeUserSettingsPlatformFeeBps = hasUserSettingsPlatformFeeAccount ? userSettingsPlatformFeeBps : 0;
const MAX_POSTER_TRADE_FEE_SHARE_BPS = 50;
const DEFAULT_FEE_SETTINGS = {
  tradeFeeRewardsEnabled: true,
  tradeFeeShareBps: 50,
  tradeFeePayoutAddress: null as string | null,
};
const RESERVED_USERNAME_HANDLES = new Set([
  "admin",
  "api",
  "assets",
  "docs",
  "feed",
  "leaderboard",
  "login",
  "notifications",
  "post",
  "privacy",
  "profile",
  "terms",
  "welcome",
]);
const USERS_ROUTE_CACHE_TTL_MS = process.env.NODE_ENV === "production" ? 45_000 : 10_000;
const USERS_ROUTE_STALE_FALLBACK_MS =
  process.env.NODE_ENV === "production" ? 30 * 60_000 : 5 * 60_000;
const USERS_ROUTE_CACHE_MAX_ENTRIES =
  process.env.NODE_ENV === "production" ? 20_000 : 2_000;
const USERS_PROFILE_REDIS_KEY_PREFIX = "users:profile:v2";
const USERS_POSTS_REDIS_KEY_PREFIX = "users:posts:v2";
const USERS_REPOSTS_REDIS_KEY_PREFIX = "users:reposts:v1";

type UserProfileRoutePayload = {
  data: PublicUserProfileDTO;
};

type UserPostsRoutePayload = {
  data: unknown[];
};

type TimedUserRouteCacheEntry<T> = {
  data: T;
  expiresAtMs: number;
  staleUntilMs: number;
};

const userProfileRouteCache = new Map<string, TimedUserRouteCacheEntry<UserProfileRoutePayload>>();
const userPostsRouteCache = new Map<string, TimedUserRouteCacheEntry<UserPostsRoutePayload>>();
const userRepostsRouteCache = new Map<string, TimedUserRouteCacheEntry<UserPostsRoutePayload>>();

function shouldUseUserRouteCache(viewerId: string | null | undefined): boolean {
  return !viewerId;
}

function buildUserRouteResponseHeaders(isPublicCacheable: boolean): Record<string, string> {
  return {
    "Cache-Control": isPublicCacheable
      ? process.env.NODE_ENV === "production"
        ? "public, max-age=30, s-maxage=45, stale-while-revalidate=300"
        : "no-store"
      : "private, no-store",
  };
}

function trimUserRouteCache<T>(cache: Map<string, TimedUserRouteCacheEntry<T>>): void {
  while (cache.size >= USERS_ROUTE_CACHE_MAX_ENTRIES) {
    const oldestKey = cache.keys().next().value;
    if (typeof oldestKey !== "string") {
      break;
    }
    cache.delete(oldestKey);
  }
}

function buildUserRouteCacheKey(identifier: string, viewerId: string | null | undefined): string {
  return `${viewerId ?? "anon"}:${normalizeUsernameHandle(identifier)}`;
}

function buildUserRouteRedisKey(prefix: string, cacheKey: string): string {
  return `${prefix}:${cacheKey}`;
}

function deleteUserRouteCacheEntry<T>(
  cache: Map<string, TimedUserRouteCacheEntry<T>>,
  prefix: string,
  identifier: string
): void {
  const cacheKey = buildUserRouteCacheKey(identifier, null);
  cache.delete(cacheKey);
  void redisDelete(buildUserRouteRedisKey(prefix, cacheKey));
}

export function invalidatePublicUserRouteCachesForUser(params: {
  userId: string;
  username?: string | null;
}): void {
  const identifiers = new Set<string>();
  if (params.userId?.trim()) {
    identifiers.add(params.userId.trim());
  }
  if (params.username?.trim()) {
    identifiers.add(params.username.trim());
  }

  for (const identifier of identifiers) {
    deleteUserRouteCacheEntry(userProfileRouteCache, USERS_PROFILE_REDIS_KEY_PREFIX, identifier);
    deleteUserRouteCacheEntry(userPostsRouteCache, USERS_POSTS_REDIS_KEY_PREFIX, identifier);
    deleteUserRouteCacheEntry(userRepostsRouteCache, USERS_REPOSTS_REDIS_KEY_PREFIX, identifier);
  }
}

function normalizeUserRouteCacheEnvelope<T>(
  value: unknown
): { data: T; cachedAtMs: number } | null {
  if (!value || typeof value !== "object" || Array.isArray(value) || !("data" in value)) {
    return null;
  }

  const candidate = value as { data?: T; cachedAt?: unknown };
  if (candidate.data === undefined) {
    return null;
  }

  return {
    data: candidate.data,
    cachedAtMs:
      typeof candidate.cachedAt === "number" && Number.isFinite(candidate.cachedAt)
        ? candidate.cachedAt
        : Date.now() - USERS_ROUTE_CACHE_TTL_MS,
  };
}

async function readUserRouteCache<T>(
  cache: Map<string, TimedUserRouteCacheEntry<T>>,
  cacheKey: string,
  redisKey: string,
  opts?: { allowStale?: boolean }
): Promise<T | null> {
  const nowMs = Date.now();
  const cached = cache.get(cacheKey);
  if (cached) {
    if (cached.expiresAtMs > nowMs) {
      return cached.data;
    }
    if (opts?.allowStale && cached.staleUntilMs > nowMs) {
      return cached.data;
    }
    if (cached.staleUntilMs <= nowMs) {
      cache.delete(cacheKey);
    }
  }

  const redisRaw = await cacheGetJson<unknown>(redisKey);
  const redisEnvelope = normalizeUserRouteCacheEnvelope<T>(redisRaw);
  if (!redisEnvelope) {
    return null;
  }
  if (!opts?.allowStale && nowMs - redisEnvelope.cachedAtMs > USERS_ROUTE_CACHE_TTL_MS) {
    return null;
  }

  writeUserRouteCache(cache, cacheKey, redisKey, redisEnvelope.data);
  return redisEnvelope.data;
}

function writeUserRouteCache<T>(
  cache: Map<string, TimedUserRouteCacheEntry<T>>,
  cacheKey: string,
  redisKey: string,
  data: T
): void {
  if (cache.has(cacheKey)) {
    cache.delete(cacheKey);
  }
  trimUserRouteCache(cache);
  const nowMs = Date.now();
  cache.set(cacheKey, {
    data,
    expiresAtMs: nowMs + USERS_ROUTE_CACHE_TTL_MS,
    staleUntilMs: nowMs + USERS_ROUTE_STALE_FALLBACK_MS,
  });
  void cacheSetJson(
    redisKey,
    {
      data,
      cachedAt: nowMs,
    },
    USERS_ROUTE_STALE_FALLBACK_MS
  );
}

function normalizeUsernameHandle(value: string): string {
  return value.trim().toLowerCase();
}

function buildUserIdentifierWhere(identifier: string) {
  const normalizedIdentifier = normalizeUsernameHandle(identifier);
  return {
    OR: [
      { id: identifier },
      { username: normalizedIdentifier },
    ],
  };
}

function buildFeeSettingsResponse(user: {
  walletAddress: string | null;
  tradeFeeRewardsEnabled: boolean;
  tradeFeeShareBps: number;
  tradeFeePayoutAddress: string | null;
}) {
  const normalizedTradeFeeShareBps = Math.min(
    MAX_POSTER_TRADE_FEE_SHARE_BPS,
    Math.max(0, Math.round(user.tradeFeeShareBps))
  );
  return {
    tradeFeeRewardsEnabled: user.tradeFeeRewardsEnabled,
    tradeFeeShareBps: normalizedTradeFeeShareBps,
    tradeFeePayoutAddress: user.tradeFeePayoutAddress,
    effectivePayoutAddress: user.tradeFeePayoutAddress ?? user.walletAddress ?? null,
    platformFeeBps: activeUserSettingsPlatformFeeBps,
    platformFeeAccountConfigured: hasUserSettingsPlatformFeeAccount,
  };
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

function toSafeNumber(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  if (value instanceof Prisma.Decimal) {
    return value.toNumber();
  }
  return 0;
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

type RawResolvedUserProfile = {
  id: string;
  image: string | null;
  username: string | null;
  level: number;
  xp: number;
  isVerified: boolean;
  createdAt: Date;
  _count: {
    posts: number;
    followers: number;
    following: number;
  };
};

type RawUserPostRow = {
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
  createdAt: Date;
  viewCount: number | null;
  dexscreenerUrl: string | null;
  authorName: string;
  authorUsername: string | null;
  authorImage: string | null;
  authorLevel: number | null;
  authorXp: number | null;
  authorIsVerified: boolean | null;
  likesCount: number | bigint | string | null;
  commentsCount: number | bigint | string | null;
  repostsCount: number | bigint | string | null;
};

function mapRawUserPostRow(row: RawUserPostRow) {
  return {
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
    settledAt: row.settledAt ?? null,
    isWin: row.isWin ?? null,
    createdAt: row.createdAt,
    viewCount: toSafeNumber(row.viewCount),
    dexscreenerUrl: row.dexscreenerUrl ?? null,
    author: {
      id: row.authorId,
      name: row.authorName,
      username: row.authorUsername ?? null,
      image: row.authorImage ?? null,
      level: toSafeNumber(row.authorLevel),
      xp: toSafeNumber(row.authorXp),
      isVerified: row.authorIsVerified === true,
    },
    _count: {
      likes: toSafeNumber(row.likesCount),
      comments: toSafeNumber(row.commentsCount),
      reposts: toSafeNumber(row.repostsCount),
    },
  };
}

async function findUserProfileByIdentifierRaw(identifier: string): Promise<RawResolvedUserProfile | null> {
  const normalizedIdentifier = normalizeUsernameHandle(identifier);
  const rows = await prisma.$queryRaw<Array<{
    id: string;
    image: string | null;
    username: string | null;
    level: number | null;
    xp: number | null;
    isVerified: boolean | null;
    createdAt: Date;
    postsCount: number | bigint | string | null;
    followersCount: number | bigint | string | null;
    followingCount: number | bigint | string | null;
  }>>(Prisma.sql`
    SELECT
      u.id,
      u.image,
      u.username,
      u.level,
      u.xp,
      u."isVerified",
      u."createdAt",
      (SELECT COUNT(*) FROM "Post" p WHERE p."authorId" = u.id) AS "postsCount",
      (SELECT COUNT(*) FROM "Follow" f WHERE f."followingId" = u.id) AS "followersCount",
      (SELECT COUNT(*) FROM "Follow" f WHERE f."followerId" = u.id) AS "followingCount"
    FROM "User" u
    WHERE u.id = ${identifier}
       OR LOWER(COALESCE(u.username, '')) = ${normalizedIdentifier}
    LIMIT 1
  `);

  const row = rows[0];
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    image: row.image ?? null,
    username: row.username ?? null,
    level: toSafeNumber(row.level),
    xp: toSafeNumber(row.xp),
    isVerified: row.isVerified === true,
    createdAt: row.createdAt,
    _count: {
      posts: toSafeNumber(row.postsCount),
      followers: toSafeNumber(row.followersCount),
      following: toSafeNumber(row.followingCount),
    },
  };
}

function buildPublicUserProfileDto(params: {
  user: RawResolvedUserProfile;
  isFollowing: boolean;
  stats: {
    totalCalls: number;
    wins: number;
    losses: number;
    winRate: number;
    totalProfitPercent: number;
  };
}): PublicUserProfileDTO {
  return {
    id: params.user.id,
    username: params.user.username,
    image: params.user.image,
    level: params.user.level,
    xp: params.user.xp,
    isVerified: params.user.isVerified,
    createdAt: params.user.createdAt.toISOString(),
    isFollowing: params.isFollowing,
    stats: {
      posts: params.user._count.posts,
      followers: params.user._count.followers,
      following: params.user._count.following,
      totalCalls: params.stats.totalCalls,
      wins: params.stats.wins,
      losses: params.stats.losses,
      winRate: params.stats.winRate,
      totalProfitPercent: params.stats.totalProfitPercent,
    },
  };
}

async function getIsFollowingSafely(currentUserId: string | null | undefined, targetUserId: string): Promise<boolean> {
  if (!currentUserId || currentUserId === targetUserId) {
    return false;
  }

  try {
    const follow = await prisma.follow.findUnique({
      where: {
        followerId_followingId: {
          followerId: currentUserId,
          followingId: targetUserId,
        },
      },
    });
    return !!follow;
  } catch (error) {
    if (!isPrismaClientError(error) && !isPrismaSchemaDriftError(error)) {
      throw error;
    }
  }

  try {
    const rows = await prisma.$queryRaw<Array<{ following: boolean | null }>>(Prisma.sql`
      SELECT EXISTS(
        SELECT 1
        FROM "Follow"
        WHERE "followerId" = ${currentUserId}
          AND "followingId" = ${targetUserId}
      ) AS following
    `);
    return rows[0]?.following === true;
  } catch (error) {
    console.warn("[users/profile] follow lookup degraded; defaulting to not-following", {
      message: getErrorMessage(error),
    });
    return false;
  }
}

async function getUserStatsSafely(userId: string): Promise<{
  totalCalls: number;
  wins: number;
  losses: number;
  winRate: number;
  totalProfitPercent: number;
}> {
  try {
    const settledPosts = await prisma.post.findMany({
      where: {
        authorId: userId,
        settled: true,
      },
      select: {
        isWin: true,
        entryMcap: true,
        currentMcap: true,
      },
    });

    const totalCalls = settledPosts.length;
    const wins = settledPosts.filter((p) => p.isWin === true).length;
    const losses = settledPosts.filter((p) => p.isWin === false).length;
    const winRate = totalCalls > 0 ? Math.round((wins / totalCalls) * 100) : 0;

    let totalProfitPercent = 0;
    for (const post of settledPosts) {
      if (post.entryMcap && post.currentMcap) {
        const changePercent = ((post.currentMcap - post.entryMcap) / post.entryMcap) * 100;
        totalProfitPercent += changePercent;
      }
    }

    return {
      totalCalls,
      wins,
      losses,
      winRate,
      totalProfitPercent: Math.round(totalProfitPercent * 100) / 100,
    };
  } catch (error) {
    if (!isPrismaClientError(error) && !isPrismaSchemaDriftError(error)) {
      throw error;
    }
  }

  try {
    const rows = await prisma.$queryRaw<Array<{
      totalCalls: number | bigint | string | null;
      wins: number | bigint | string | null;
      losses: number | bigint | string | null;
      totalProfitPercent: number | null;
    }>>(Prisma.sql`
      SELECT
        COUNT(*) AS "totalCalls",
        COUNT(*) FILTER (WHERE "isWin" = true) AS wins,
        COUNT(*) FILTER (WHERE "isWin" = false) AS losses,
        COALESCE(
          SUM(
            CASE
              WHEN "entryMcap" IS NOT NULL AND "entryMcap" > 0 AND "currentMcap" IS NOT NULL
                THEN (("currentMcap" - "entryMcap") / "entryMcap") * 100
              ELSE 0
            END
          ),
          0
        ) AS "totalProfitPercent"
      FROM "Post"
      WHERE "authorId" = ${userId}
        AND settled = true
    `);

    const row = rows[0];
    const totalCalls = toSafeNumber(row?.totalCalls);
    const wins = toSafeNumber(row?.wins);
    const losses = toSafeNumber(row?.losses);
    const rawProfit = typeof row?.totalProfitPercent === "number" ? row.totalProfitPercent : 0;
    return {
      totalCalls,
      wins,
      losses,
      winRate: totalCalls > 0 ? Math.round((wins / totalCalls) * 100) : 0,
      totalProfitPercent: Math.round(rawProfit * 100) / 100,
    };
  } catch (error) {
    console.warn("[users/profile] stats lookup degraded; defaulting to empty stats", {
      message: getErrorMessage(error),
    });
    return {
      totalCalls: 0,
      wins: 0,
      losses: 0,
      winRate: 0,
      totalProfitPercent: 0,
    };
  }
}

async function findUserPostsRaw(authorId: string): Promise<any[]> {
  const rows = await prisma.$queryRaw<RawUserPostRow[]>(Prisma.sql`
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
      p."createdAt",
      p."viewCount",
      p."dexscreenerUrl",
      u.name AS "authorName",
      u.username AS "authorUsername",
      u.image AS "authorImage",
      u.level AS "authorLevel",
      u.xp AS "authorXp",
      u."isVerified" AS "authorIsVerified",
      (SELECT COUNT(*) FROM "Like" l WHERE l."postId" = p.id) AS "likesCount",
      (SELECT COUNT(*) FROM "Comment" c WHERE c."postId" = p.id) AS "commentsCount",
      (SELECT COUNT(*) FROM "Repost" r WHERE r."postId" = p.id) AS "repostsCount"
    FROM "Post" p
    INNER JOIN "User" u ON u.id = p."authorId"
    WHERE p."authorId" = ${authorId}
    ORDER BY p."createdAt" DESC
  `);

  return rows.map(mapRawUserPostRow);
}

async function findUserRepostsRaw(userId: string): Promise<any[]> {
  const rows = await prisma.$queryRaw<RawUserPostRow[]>(Prisma.sql`
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
      p."createdAt",
      p."viewCount",
      p."dexscreenerUrl",
      u.name AS "authorName",
      u.username AS "authorUsername",
      u.image AS "authorImage",
      u.level AS "authorLevel",
      u.xp AS "authorXp",
      u."isVerified" AS "authorIsVerified",
      (SELECT COUNT(*) FROM "Like" l WHERE l."postId" = p.id) AS "likesCount",
      (SELECT COUNT(*) FROM "Comment" c WHERE c."postId" = p.id) AS "commentsCount",
      (SELECT COUNT(*) FROM "Repost" r2 WHERE r2."postId" = p.id) AS "repostsCount"
    FROM "Repost" r
    INNER JOIN "Post" p ON p.id = r."postId"
    INNER JOIN "User" u ON u.id = p."authorId"
    WHERE r."userId" = ${userId}
    ORDER BY r."createdAt" DESC
  `);

  return rows.map(mapRawUserPostRow);
}

async function getPostInteractionSetsSafely(params: {
  currentUserId: string | null | undefined;
  targetUserId: string;
  postIds: string[];
}): Promise<{
  userLikes: Set<string>;
  userReposts: Set<string>;
  isFollowingAuthor: boolean;
}> {
  if (!params.currentUserId || params.postIds.length === 0) {
    return {
      userLikes: new Set(),
      userReposts: new Set(),
      isFollowingAuthor: false,
    };
  }

  try {
    const [likes, reposts, follow] = await Promise.all([
      prisma.like.findMany({
        where: {
          userId: params.currentUserId,
          postId: { in: params.postIds },
        },
        select: { postId: true },
      }),
      prisma.repost.findMany({
        where: {
          userId: params.currentUserId,
          postId: { in: params.postIds },
        },
        select: { postId: true },
      }),
      params.currentUserId !== params.targetUserId
        ? prisma.follow.findUnique({
            where: {
              followerId_followingId: {
                followerId: params.currentUserId,
                followingId: params.targetUserId,
              },
            },
          })
        : Promise.resolve(null),
    ]);

    return {
      userLikes: new Set(likes.map((like) => like.postId)),
      userReposts: new Set(reposts.map((repost) => repost.postId)),
      isFollowingAuthor: !!follow,
    };
  } catch (error) {
    console.warn("[users/profile-posts] social lookup degraded; continuing with public post state", {
      message: getErrorMessage(error),
    });
    return {
      userLikes: new Set(),
      userReposts: new Set(),
      isFollowingAuthor: await getIsFollowingSafely(params.currentUserId, params.targetUserId),
    };
  }
}

async function getMixedAuthorPostInteractionsSafely(params: {
  currentUserId: string | null | undefined;
  postIds: string[];
  authorIds: string[];
}): Promise<{
  userLikes: Set<string>;
  userReposts: Set<string>;
  followingAuthorIds: Set<string>;
}> {
  if (!params.currentUserId || params.postIds.length === 0) {
    return {
      userLikes: new Set(),
      userReposts: new Set(),
      followingAuthorIds: new Set(),
    };
  }

  try {
    const [likes, reposts, follows] = await Promise.all([
      prisma.like.findMany({
        where: {
          userId: params.currentUserId,
          postId: { in: params.postIds },
        },
        select: { postId: true },
      }),
      prisma.repost.findMany({
        where: {
          userId: params.currentUserId,
          postId: { in: params.postIds },
        },
        select: { postId: true },
      }),
      params.authorIds.length > 0
        ? prisma.follow.findMany({
            where: {
              followerId: params.currentUserId,
              followingId: { in: params.authorIds },
            },
            select: { followingId: true },
          })
        : Promise.resolve([]),
    ]);

    return {
      userLikes: new Set(likes.map((like) => like.postId)),
      userReposts: new Set(reposts.map((repost) => repost.postId)),
      followingAuthorIds: new Set(follows.map((follow) => follow.followingId)),
    };
  } catch (error) {
    console.warn("[users/profile-reposts] mixed-author social lookup degraded; continuing with public post state", {
      message: getErrorMessage(error),
    });
    return {
      userLikes: new Set(),
      userReposts: new Set(),
      followingAuthorIds: new Set(),
    };
  }
}

const UpdateFeeSettingsSchema = z.object({
  tradeFeeRewardsEnabled: z.boolean().optional(),
  tradeFeeShareBps: z.number().int().min(0).max(MAX_POSTER_TRADE_FEE_SHARE_BPS).optional(),
  tradeFeePayoutAddress: z.union([
    z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/, "Payout wallet must be a valid Solana address"),
    z.literal(""),
  ]).optional(),
});

function isLikelySolanaWalletAddress(value: string | null | undefined): value is string {
  return typeof value === "string" && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value);
}

type WalletOverviewPayload = {
  connected: boolean;
  balanceSol: number | null;
  balanceUsd: number | null;
  totalVolumeBoughtSol: number | null;
  totalVolumeSoldSol: number | null;
  totalVolumeBoughtUsd: number | null;
  totalVolumeSoldUsd: number | null;
  totalProfitUsd: number | null;
  tokenPositions: Array<{
    mint: string;
    tokenName: string | null;
    tokenSymbol: string | null;
    tokenImage: string | null;
    holdingAmount: number | null;
    holdingUsd: number | null;
    boughtAmount: number | null;
    soldAmount: number | null;
    totalPnlUsd: number | null;
  }>;
};

function buildWalletStatusPayload(params: {
  walletAddress: string | null | undefined;
  walletProvider?: string | null | undefined;
  walletConnectedAt?: Date | null | undefined;
}) {
  return {
    connected: Boolean(params.walletAddress),
    address: params.walletAddress ?? null,
    provider: params.walletProvider ?? null,
    connectedAt: params.walletConnectedAt?.toISOString() ?? null,
  };
}

function buildEmptyWalletOverview(connected: boolean): WalletOverviewPayload {
  return {
    connected,
    balanceSol: null,
    balanceUsd: null,
    totalVolumeBoughtSol: null,
    totalVolumeSoldSol: null,
    totalVolumeBoughtUsd: null,
    totalVolumeSoldUsd: null,
    totalProfitUsd: null,
    tokenPositions: [],
  };
}

async function attachWalletTradeSnapshotsForUserPosts<
  T extends {
    contractAddress: string | null;
    chainType: string | null;
    createdAt: Date;
  },
>(posts: T[], walletAddress: string | null | undefined): Promise<Array<T & { walletTradeSnapshot?: unknown }>> {
  if (!isHeliusConfigured() || !isLikelySolanaWalletAddress(walletAddress) || posts.length === 0) {
    return posts as Array<T & { walletTradeSnapshot?: unknown }>;
  }

  const eligiblePosts = posts
    .filter((post) => post.chainType === "solana" && isLikelySolanaWalletAddress(post.contractAddress))
    .slice(0, PROFILE_POST_WALLET_ENRICH_MAX_POSTS);

  const uniqueMints = [...new Set(eligiblePosts.map((post) => post.contractAddress as string))];

  if (uniqueMints.length === 0) {
    return posts as Array<T & { walletTradeSnapshot?: unknown }>;
  }

  let snapshots: Record<string, unknown> | null = null;
  try {
    const snapshotPromise = getWalletTradeSnapshotsForSolanaTokens({
      walletAddress,
      tokenMints: uniqueMints,
    });
    snapshots = await Promise.race([
      snapshotPromise,
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 3000)),
    ]);
  } catch (error) {
    console.warn("[users/profile-posts] wallet snapshot enrichment skipped:", error);
    snapshots = null;
  }

  if (!snapshots) {
    return posts as Array<T & { walletTradeSnapshot?: unknown }>;
  }

  return posts.map((post) => {
    if (post.chainType !== "solana" || !post.contractAddress) {
      return post as T & { walletTradeSnapshot?: unknown };
    }
    const walletTradeSnapshot = snapshots[post.contractAddress];
    if (!walletTradeSnapshot) {
      return post as T & { walletTradeSnapshot?: unknown };
    }
    return {
      ...post,
      walletTradeSnapshot,
    };
  });
}

function verifySolanaSignature(message: string, signature: string, publicKeyStr: string): boolean {
  try {
    const messageBytes = new TextEncoder().encode(message);
    const signatureBytes = bs58.decode(signature);
    const publicKey = new PublicKey(publicKeyStr);
    return nacl.sign.detached.verify(messageBytes, signatureBytes, publicKey.toBytes());
  } catch (error) {
    console.error("[users/wallet] Signature verification error:", error);
    return false;
  }
}

function validateWalletLinkMessage(message: string, walletAddress: string, userId: string): { ok: true } | { ok: false; reason: string } {
  const normalized = message.trim();
  if (!normalized.includes("Phew.run Wallet Link")) {
    return { ok: false, reason: "Missing wallet link challenge prefix" };
  }
  if (!normalized.includes(`Wallet: ${walletAddress}`)) {
    return { ok: false, reason: "Wallet address mismatch in signed message" };
  }
  if (!normalized.includes(`User: ${userId}`)) {
    return { ok: false, reason: "User mismatch in signed message" };
  }

  const tsLine = normalized
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.startsWith("Timestamp: "));

  const timestampValue = tsLine?.slice("Timestamp: ".length);
  const timestampMs = timestampValue ? Date.parse(timestampValue) : Number.NaN;
  if (!Number.isFinite(timestampMs)) {
    return { ok: false, reason: "Missing or invalid timestamp in signed message" };
  }

  const maxAgeMs = 5 * 60 * 1000;
  if (Math.abs(Date.now() - timestampMs) > maxAgeMs) {
    return { ok: false, reason: "Signed message expired. Please sign again." };
  }

  return { ok: true };
}

// Get leaderboard (must be before /:identifier to avoid conflict)
usersRouter.get("/", async (c) => {
  const users = await prisma.user.findMany({
    orderBy: [
      { level: "desc" },
      { xp: "desc" }, // Tiebreaker
    ],
    take: 50,
    select: {
      id: true,
      name: true,
      username: true,
      image: true,
      level: true,
      xp: true,
      _count: {
        select: { posts: true },
      },
    },
  });

  return c.json({ data: users });
});

// =====================================================
// Wallet Connection Endpoints
// Must be defined before /:identifier to avoid route conflicts
// =====================================================

// Get wallet connection status
usersRouter.get("/me/wallet", requireAuth, async (c) => {
  const sessionUser = c.get("user");
  if (!sessionUser) {
    return c.json({ error: { message: "Unauthorized", code: "UNAUTHORIZED" } }, 401);
  }

  const sessionFallback = buildWalletStatusPayload({
    walletAddress: sessionUser.walletAddress,
  });

  let user:
    | {
        walletAddress: string | null;
        walletProvider: string | null;
        walletConnectedAt: Date | null;
      }
    | {
        walletAddress: string | null;
        walletProvider: null;
        walletConnectedAt: null;
      }
    | null = null;

  try {
    user = await withPrismaRetry(
      () =>
        prisma.user.findUnique({
          where: { id: sessionUser.id },
          select: {
            walletAddress: true,
            walletProvider: true,
            walletConnectedAt: true,
          },
        }),
      { label: "users:wallet-status" }
    );
  } catch (error) {
    if (isTransientPrismaError(error)) {
      console.warn("[users/wallet-status] database unavailable; returning session-backed wallet status", {
        userId: sessionUser.id,
        message: getErrorMessage(error),
      });
      return c.json({ data: sessionFallback });
    }
    if (!isPrismaSchemaDriftError(error)) {
      throw error;
    }

    let fallbackUser: { walletAddress: string | null } | null = null;
    try {
      fallbackUser = await withPrismaRetry(
        () =>
          prisma.user.findUnique({
            where: { id: sessionUser.id },
            select: {
              walletAddress: true,
            },
          }),
        { label: "users:wallet-status:fallback" }
      );
    } catch (fallbackError) {
      if (isTransientPrismaError(fallbackError)) {
        console.warn("[users/wallet-status] fallback lookup unavailable; returning session-backed wallet status", {
          userId: sessionUser.id,
          message: getErrorMessage(fallbackError),
        });
        return c.json({ data: sessionFallback });
      }
      throw fallbackError;
    }

    user = fallbackUser
      ? {
          walletAddress: fallbackUser.walletAddress,
          walletProvider: null,
          walletConnectedAt: null,
        }
      : null;
  }

  if (!user) {
    return c.json({ error: { message: "User not found", code: "NOT_FOUND" } }, 404);
  }

  return c.json({
    data: buildWalletStatusPayload(user),
  });
});

usersRouter.post("/me/wallet", requireAuth, zValidator("json", ConnectWalletSchema), async (c) => {
  const sessionUser = c.get("user");
  if (!sessionUser) {
    return c.json({ error: { message: "Unauthorized", code: "UNAUTHORIZED" } }, 401);
  }

  const { walletAddress, walletProvider, signature, message } = c.req.valid("json");

  const solanaRegex = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
  const isSolanaWallet = solanaRegex.test(walletAddress);

  if (!isSolanaWallet) {
    return c.json({
      error: {
        message: "Only Solana wallet verification is supported right now",
        code: "UNSUPPORTED_WALLET_PROVIDER",
      }
    }, 400);
  }

  // Require proof-of-ownership for Solana wallets (profile linking)
  if (!signature || !message) {
    return c.json({
      error: {
        message: "Signature confirmation is required to connect a Solana wallet",
        code: "SIGNATURE_REQUIRED",
      }
    }, 400);
  }

  const challengeCheck = validateWalletLinkMessage(message, walletAddress, sessionUser.id);
  if (!challengeCheck.ok) {
    return c.json({
      error: {
        message: challengeCheck.reason,
        code: "INVALID_WALLET_CHALLENGE",
      }
    }, 400);
  }

  const isValidSignature = verifySolanaSignature(message, signature, walletAddress);
  if (!isValidSignature) {
    return c.json({
      error: {
        message: "Invalid wallet signature. Please confirm the signature again.",
        code: "INVALID_SIGNATURE",
      }
    }, 401);
  }

  // Rate limiting: Check how many wallet connections this user has made in the last hour
  // TODO: Implement proper rate limiting with a dedicated rate limit table for audit trail
  // For now, we'll just check if they recently connected a wallet
  let user: { walletAddress: string | null; walletConnectedAt: Date | null } | null = null;
  try {
    user = await prisma.user.findUnique({
      where: { id: sessionUser.id },
      select: {
        walletAddress: true,
        walletConnectedAt: true,
      },
    });
  } catch (error) {
    if (!isPrismaSchemaDriftError(error)) {
      throw error;
    }
    const fallbackUser = await prisma.user.findUnique({
      where: { id: sessionUser.id },
      select: {
        walletAddress: true,
      },
    });
    user = fallbackUser
      ? {
          walletAddress: fallbackUser.walletAddress,
          walletConnectedAt: null,
        }
      : null;
  }

  if (!user) {
    return c.json({ error: { message: "User not found", code: "NOT_FOUND" } }, 404);
  }

  // Simple rate limit: If wallet was connected within the last 12 minutes (5 per hour = 1 per 12 min)
  // This is a simplified check; a proper implementation would track all attempts
  if (user.walletConnectedAt) {
    const minutesSinceLastConnect = (Date.now() - user.walletConnectedAt.getTime()) / (1000 * 60);
    if (minutesSinceLastConnect < 60 / WALLET_CONNECT_LIMIT_PER_HOUR) {
      const minutesRemaining = Math.ceil(60 / WALLET_CONNECT_LIMIT_PER_HOUR - minutesSinceLastConnect);
      return c.json({
        error: {
          message: `Rate limit exceeded. You can only connect/disconnect wallets ${WALLET_CONNECT_LIMIT_PER_HOUR} times per hour. Please wait ${minutesRemaining} more minute${minutesRemaining === 1 ? '' : 's'}.`,
          code: "RATE_LIMIT_EXCEEDED"
        }
      }, 429);
    }
  }

  // Check if this wallet is already connected to another user
  let existingWalletUser: { id: string } | null = null;
  try {
    existingWalletUser = await prisma.user.findFirst({
      where: {
        walletAddress,
        NOT: { id: sessionUser.id },
      },
      select: { id: true },
    });
  } catch (error) {
    if (!isPrismaSchemaDriftError(error)) {
      throw error;
    }
    return c.json(
      {
        error: {
          message: "Wallet linking is temporarily unavailable while database sync finishes.",
          code: "DATABASE_NOT_READY",
        },
      },
      503
    );
  }

  if (existingWalletUser) {
    return c.json({
      error: {
        message: "This wallet is already connected to another account",
        code: "WALLET_ALREADY_CONNECTED"
      }
    }, 400);
  }

  // Update user with wallet info
  // TODO: Log wallet changes for audit trail
  let updatedUser: {
    id: string;
    name: string;
    email: string;
    image: string | null;
    walletAddress: string | null;
    walletProvider: string | null;
    walletConnectedAt: Date | null;
    username: string | null;
    level: number;
    xp: number;
    bio: string | null;
    createdAt: Date;
  };

  try {
    updatedUser = await prisma.user.update({
      where: { id: sessionUser.id },
      data: {
        walletAddress,
        walletProvider: walletProvider || "phantom",
        walletConnectedAt: new Date(),
      },
      select: {
        id: true,
        name: true,
        email: true,
        image: true,
        walletAddress: true,
        walletProvider: true,
        walletConnectedAt: true,
        username: true,
        level: true,
        xp: true,
        bio: true,
        createdAt: true,
      },
    });
  } catch (error) {
    if (!isPrismaSchemaDriftError(error)) {
      throw error;
    }

    const fallbackUpdatedUser = await prisma.user
      .update({
        where: { id: sessionUser.id },
        data: {
          walletAddress,
        },
        select: {
          id: true,
          name: true,
          email: true,
          image: true,
          walletAddress: true,
          username: true,
          level: true,
          xp: true,
          bio: true,
          createdAt: true,
        },
      })
      .catch(() => null);

    if (!fallbackUpdatedUser) {
      return c.json(
        {
          error: {
            message: "Wallet linking is temporarily unavailable while database sync finishes.",
            code: "DATABASE_NOT_READY",
          },
        },
        503
      );
    }

    updatedUser = {
      ...fallbackUpdatedUser,
      walletProvider: null,
      walletConnectedAt: null,
    };
  }

  clearCachedMeResponse(sessionUser.id);

  return c.json({ data: updatedUser });
});

// Disconnect wallet
usersRouter.delete("/me/wallet", requireAuth, async (c) => {
  const sessionUser = c.get("user");
  if (!sessionUser) {
    return c.json({ error: { message: "Unauthorized", code: "UNAUTHORIZED" } }, 401);
  }

  // Get current user to check rate limit
  let user: { walletAddress: string | null; walletConnectedAt: Date | null } | null = null;
  try {
    user = await prisma.user.findUnique({
      where: { id: sessionUser.id },
      select: {
        walletAddress: true,
        walletConnectedAt: true,
      },
    });
  } catch (error) {
    if (!isPrismaSchemaDriftError(error)) {
      throw error;
    }
    const fallbackUser = await prisma.user.findUnique({
      where: { id: sessionUser.id },
      select: {
        walletAddress: true,
      },
    });
    user = fallbackUser
      ? {
          walletAddress: fallbackUser.walletAddress,
          walletConnectedAt: null,
        }
      : null;
  }

  if (!user) {
    return c.json({ error: { message: "User not found", code: "NOT_FOUND" } }, 404);
  }

  if (!user.walletAddress) {
    return c.json({
      error: {
        message: "No wallet connected",
        code: "NO_WALLET_CONNECTED"
      }
    }, 400);
  }

  // Rate limiting check (same as connect)
  if (user.walletConnectedAt) {
    const minutesSinceLastConnect = (Date.now() - user.walletConnectedAt.getTime()) / (1000 * 60);
    if (minutesSinceLastConnect < 60 / WALLET_CONNECT_LIMIT_PER_HOUR) {
      const minutesRemaining = Math.ceil(60 / WALLET_CONNECT_LIMIT_PER_HOUR - minutesSinceLastConnect);
      return c.json({
        error: {
          message: `Rate limit exceeded. You can only connect/disconnect wallets ${WALLET_CONNECT_LIMIT_PER_HOUR} times per hour. Please wait ${minutesRemaining} more minute${minutesRemaining === 1 ? '' : 's'}.`,
          code: "RATE_LIMIT_EXCEEDED"
        }
      }, 429);
    }
  }

  // Clear wallet info
  // TODO: Log wallet disconnection for audit trail
  let updatedUser: {
    id: string;
    name: string;
    email: string;
    image: string | null;
    walletAddress: string | null;
    walletProvider: string | null;
    walletConnectedAt: Date | null;
    username: string | null;
    level: number;
    xp: number;
    bio: string | null;
    createdAt: Date;
  };
  try {
    updatedUser = await prisma.user.update({
      where: { id: sessionUser.id },
      data: {
        walletAddress: null,
        walletProvider: null,
        walletConnectedAt: null,
      },
      select: {
        id: true,
        name: true,
        email: true,
        image: true,
        walletAddress: true,
        walletProvider: true,
        walletConnectedAt: true,
        username: true,
        level: true,
        xp: true,
        bio: true,
        createdAt: true,
      },
    });
  } catch (error) {
    if (!isPrismaSchemaDriftError(error)) {
      throw error;
    }

    const fallbackUpdatedUser = await prisma.user
      .update({
        where: { id: sessionUser.id },
        data: {
          walletAddress: null,
        },
        select: {
          id: true,
          name: true,
          email: true,
          image: true,
          walletAddress: true,
          username: true,
          level: true,
          xp: true,
          bio: true,
          createdAt: true,
        },
      })
      .catch(() => null);

    if (!fallbackUpdatedUser) {
      return c.json(
        {
          error: {
            message: "Wallet unlink is temporarily unavailable while database sync finishes.",
            code: "DATABASE_NOT_READY",
          },
        },
        503
      );
    }

    updatedUser = {
      ...fallbackUpdatedUser,
      walletProvider: null,
      walletConnectedAt: null,
    };
  }

  clearCachedMeResponse(sessionUser.id);

  return c.json({ data: updatedUser });
});

// =====================================================
// User Stats Endpoints (Accuracy Score System)
// Must be defined before /:identifier to avoid route conflicts
// =====================================================

/**
 * Calculate user stats including accuracy score, streaks, and weekly data
 */
async function calculateUserStats(userId: string): Promise<UserStats> {
  // Get all posts for total count
  const totalPosts = await prisma.post.count({
    where: { authorId: userId },
  });

  // Get all settled posts with their settlement data
  const settledPosts = await prisma.post.findMany({
    where: {
      authorId: userId,
      settled: true,
    },
    select: {
      id: true,
      isWin: true,
      isWin1h: true,
      isWin6h: true,
      percentChange1h: true,
      percentChange6h: true,
      settled: true,
      settled6h: true,
      settledAt: true,
      createdAt: true,
    },
    orderBy: { settledAt: "asc" },
  });

  // Calculate wins: A "win" is when isWin1h = true OR isWin6h = true
  const wins = settledPosts.filter(
    (post) => post.isWin1h === true || post.isWin6h === true
  ).length;
  const losses = settledPosts.length - wins;

  // Calculate accuracy score
  const accuracyScore =
    settledPosts.length > 0
      ? Math.round((wins / settledPosts.length) * 100 * 10) / 10
      : 0;

  // Calculate average percent change
  let totalPercentChange = 0;
  let validPercentChanges = 0;
  for (const post of settledPosts) {
    // Prefer 6h percent change if available, otherwise use 1h
    const percentChange = post.percentChange6h ?? post.percentChange1h;
    if (percentChange !== null) {
      totalPercentChange += percentChange;
      validPercentChanges++;
    }
  }
  const avgPercentChange =
    validPercentChanges > 0
      ? Math.round((totalPercentChange / validPercentChanges) * 100) / 100
      : null;

  // Calculate streaks
  let currentStreak = 0;
  let bestWinStreak = 0;
  let tempWinStreak = 0;

  // Sort by settlement date for streak calculation
  const sortedPosts = [...settledPosts].sort((a, b) => {
    const dateA = a.settledAt ? new Date(a.settledAt).getTime() : 0;
    const dateB = b.settledAt ? new Date(b.settledAt).getTime() : 0;
    return dateA - dateB;
  });

  for (const post of sortedPosts) {
    const isWin = post.isWin1h === true || post.isWin6h === true;

    if (isWin) {
      tempWinStreak++;
      if (tempWinStreak > bestWinStreak) {
        bestWinStreak = tempWinStreak;
      }
    } else {
      tempWinStreak = 0;
    }
  }

  // Calculate current streak from the most recent posts
  if (sortedPosts.length > 0) {
    const lastPost = sortedPosts[sortedPosts.length - 1];
    if (lastPost) {
      const lastWasWin = lastPost.isWin1h === true || lastPost.isWin6h === true;

      if (lastWasWin) {
        // Count consecutive wins from the end
        for (let i = sortedPosts.length - 1; i >= 0; i--) {
          const post = sortedPosts[i];
          if (post) {
            const isWin = post.isWin1h === true || post.isWin6h === true;
            if (isWin) {
              currentStreak++;
            } else {
              break;
            }
          }
        }
      } else {
        // Count consecutive losses from the end (as negative)
        for (let i = sortedPosts.length - 1; i >= 0; i--) {
          const post = sortedPosts[i];
          if (post) {
            const isWin = post.isWin1h === true || post.isWin6h === true;
            if (!isWin) {
              currentStreak--;
            } else {
              break;
            }
          }
        }
      }
    }
  }

  // Calculate monthly change (compare current month to last month)
  const now = new Date();
  const currentMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0);

  const currentMonthPosts = settledPosts.filter((post) => {
    const settledDate = post.settledAt ? new Date(post.settledAt) : null;
    return settledDate && settledDate >= currentMonthStart;
  });

  const lastMonthPosts = settledPosts.filter((post) => {
    const settledDate = post.settledAt ? new Date(post.settledAt) : null;
    return settledDate && settledDate >= lastMonthStart && settledDate <= lastMonthEnd;
  });

  const currentMonthWins = currentMonthPosts.filter(
    (post) => post.isWin1h === true || post.isWin6h === true
  ).length;
  const currentMonthAccuracy =
    currentMonthPosts.length > 0
      ? (currentMonthWins / currentMonthPosts.length) * 100
      : 0;

  const lastMonthWins = lastMonthPosts.filter(
    (post) => post.isWin1h === true || post.isWin6h === true
  ).length;
  const lastMonthAccuracy =
    lastMonthPosts.length > 0
      ? (lastMonthWins / lastMonthPosts.length) * 100
      : 0;

  const monthlyChange =
    lastMonthPosts.length > 0
      ? Math.round((currentMonthAccuracy - lastMonthAccuracy) * 10) / 10
      : null;

  // Calculate weekly stats (last 7 days)
  const weeklyStats: WeeklyStat[] = [];
  const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  for (let i = 6; i >= 0; i--) {
    const date = new Date();
    date.setDate(date.getDate() - i);
    date.setHours(0, 0, 0, 0);

    const nextDate = new Date(date);
    nextDate.setDate(nextDate.getDate() + 1);

    const dayPosts = settledPosts.filter((post) => {
      const settledDate = post.settledAt ? new Date(post.settledAt) : null;
      return settledDate && settledDate >= date && settledDate < nextDate;
    });

    const dayWins = dayPosts.filter(
      (post) => post.isWin1h === true || post.isWin6h === true
    ).length;
    const dayLosses = dayPosts.length - dayWins;

    weeklyStats.push({
      date: date.toISOString().split("T")[0] ?? "",
      dayLabel: dayNames[date.getDay()] ?? "",
      wins: dayWins,
      losses: dayLosses,
      total: dayPosts.length,
    });
  }

  return {
    accuracyScore,
    totalPosts,
    settledPosts: settledPosts.length,
    wins,
    losses,
    avgPercentChange,
    streakCurrent: currentStreak,
    streakBest: bestWinStreak,
    monthlyChange,
    weeklyStats,
  };
}

// Get stats for current logged-in user
usersRouter.get("/me/stats", requireAuth, async (c) => {
  const sessionUser = c.get("user");
  if (!sessionUser) {
    return c.json({ error: { message: "Unauthorized", code: "UNAUTHORIZED" } }, 401);
  }

  const stats = await calculateUserStats(sessionUser.id);
  return c.json({ data: stats });
});

// Get stats for a specific user by ID
usersRouter.get("/:userId/stats", async (c) => {
  const userId = c.req.param("userId");

  // Check if user exists
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true },
  });

  if (!user) {
    return c.json({ error: { message: "User not found", code: "NOT_FOUND" } }, 404);
  }

  const stats = await calculateUserStats(userId);
  return c.json({ data: stats });
});

// Get wallet overview for a user (balances + posted-token position summaries)
// Must be defined before /:identifier to avoid route conflicts
usersRouter.get("/:identifier/wallet/overview", requireAuth, async (c) => {
  const identifier = c.req.param("identifier");
  const sessionUser = c.get("user");
  if (!sessionUser) {
    return c.json({ error: { message: "Unauthorized", code: "UNAUTHORIZED" } }, 401);
  }

  let user:
    | {
        id: string;
        walletAddress: string | null;
      }
    | null = null;

  try {
    user = await withPrismaRetry(
      () =>
        prisma.user.findFirst({
          where: buildUserIdentifierWhere(identifier),
          select: {
            id: true,
            walletAddress: true,
          },
        }),
      { label: "users:wallet-overview:user" }
    );
  } catch (error) {
    if (isTransientPrismaError(error) && identifier === sessionUser.id) {
      console.warn("[users/wallet-overview] owner lookup unavailable; using session-backed wallet context", {
        userId: sessionUser.id,
        message: getErrorMessage(error),
      });
      user = {
        id: sessionUser.id,
        walletAddress: sessionUser.walletAddress,
      };
    } else if (isTransientPrismaError(error)) {
      console.warn("[users/wallet-overview] lookup unavailable; returning empty overview", {
        userId: sessionUser.id,
        identifier,
        message: getErrorMessage(error),
      });
      return c.json({ data: buildEmptyWalletOverview(Boolean(sessionUser.walletAddress)) });
    } else {
      throw error;
    }
  }

  if (!user) {
    return c.json({ error: { message: "User not found", code: "NOT_FOUND" } }, 404);
  }

  if (user.id !== sessionUser.id) {
    return c.json(
      { error: { message: "Wallet analytics are only available to the wallet owner", code: "FORBIDDEN" } },
      403
    );
  }

  if (!user.walletAddress || !isLikelySolanaWalletAddress(user.walletAddress) || !isHeliusConfigured()) {
    return c.json({
      data: buildEmptyWalletOverview(Boolean(user.walletAddress)),
    });
  }

  let postedTokens: Array<{
    contractAddress: string | null;
    chainType: string | null;
    tokenName: string | null;
    tokenSymbol: string | null;
    tokenImage: string | null;
    createdAt: Date;
  }> = [];

  try {
    postedTokens = await withPrismaRetry(
      () =>
        prisma.post.findMany({
          where: {
            authorId: user.id,
            chainType: "solana",
            contractAddress: { not: null },
          },
          orderBy: { createdAt: "desc" },
          take: 200,
          select: {
            contractAddress: true,
            chainType: true,
            tokenName: true,
            tokenSymbol: true,
            tokenImage: true,
            createdAt: true,
          },
        }),
      { label: "users:wallet-overview:posts" }
    );
  } catch (error) {
    if (isTransientPrismaError(error)) {
      console.warn("[users/wallet-overview] posted-token lookup unavailable; returning empty overview", {
        userId: user.id,
        message: getErrorMessage(error),
      });
      return c.json({ data: buildEmptyWalletOverview(true) });
    }
    throw error;
  }

  if (postedTokens.length === 0) {
    return c.json({
      data: buildEmptyWalletOverview(true),
    });
  }

  const tokenMetaByMint = new Map<string, {
    mint: string;
    tokenName: string | null;
    tokenSymbol: string | null;
    tokenImage: string | null;
    firstPostedAt: Date;
  }>();

  let earliestPostMs: number | null = null;
  for (const post of postedTokens) {
    const mint = post.contractAddress;
    if (!mint) continue;
    const createdAtMs = post.createdAt.getTime();
    if (earliestPostMs === null || createdAtMs < earliestPostMs) {
      earliestPostMs = createdAtMs;
    }

    if (!tokenMetaByMint.has(mint)) {
      tokenMetaByMint.set(mint, {
        mint,
        tokenName: post.tokenName,
        tokenSymbol: post.tokenSymbol,
        tokenImage: post.tokenImage,
        firstPostedAt: post.createdAt,
      });
    }
  }

  if (tokenMetaByMint.size > PROFILE_WALLET_OVERVIEW_MAX_TOKENS) {
    const limited = new Map<string, {
      mint: string;
      tokenName: string | null;
      tokenSymbol: string | null;
      tokenImage: string | null;
      firstPostedAt: Date;
    }>();
    for (const [mint, meta] of tokenMetaByMint.entries()) {
      if (limited.size >= PROFILE_WALLET_OVERVIEW_MAX_TOKENS) break;
      limited.set(mint, meta);
    }
    tokenMetaByMint.clear();
    for (const [mint, meta] of limited.entries()) {
      tokenMetaByMint.set(mint, meta);
    }
  }
  let portfolio: Awaited<ReturnType<typeof getWalletPortfolioOverviewForPostedTokens>> | null = null;
  try {
    portfolio = await Promise.race([
      getWalletPortfolioOverviewForPostedTokens({
        walletAddress: user.walletAddress,
        tokens: [...tokenMetaByMint.values()].map((t) => ({ mint: t.mint, chainType: "solana" })),
        sinceMs: earliestPostMs,
      }),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), PROFILE_WALLET_OVERVIEW_TIMEOUT_MS)),
    ]);
    if (portfolio === null) {
      console.warn("[users/wallet-overview] Timed out or unavailable; returning fallback", {
        userId: user.id,
      });
    }
  } catch (error) {
    console.warn("[users/wallet-overview] Failed to build wallet overview; returning fallback", {
      userId: user.id,
      error,
    });
    portfolio = null;
  }

  if (!portfolio) {
    return c.json({
      data: buildEmptyWalletOverview(true),
    });
  }

  const tokenPositions = [...tokenMetaByMint.values()]
    .map((meta) => {
      const wallet = portfolio.tokens[meta.mint];
      if (!wallet) return null;
      return {
        mint: meta.mint,
        tokenName: meta.tokenName,
        tokenSymbol: meta.tokenSymbol,
        tokenImage: meta.tokenImage,
        holdingAmount: wallet.holdingAmount ?? null,
        holdingUsd: wallet.holdingUsd ?? null,
        boughtAmount: wallet.boughtAmount ?? null,
        soldAmount: wallet.soldAmount ?? null,
        totalPnlUsd: wallet.totalPnlUsd ?? null,
      };
    })
    .filter((item): item is NonNullable<typeof item> => item !== null)
    .sort((a, b) => {
      const aValue = a.holdingUsd ?? a.totalPnlUsd ?? 0;
      const bValue = b.holdingUsd ?? b.totalPnlUsd ?? 0;
      return bValue - aValue;
    });

  return c.json({
    data: {
      connected: true,
      balanceSol: portfolio.balanceSol,
      balanceUsd: portfolio.balanceUsd,
      totalVolumeBoughtSol: portfolio.totalVolumeBoughtSol,
      totalVolumeSoldSol: portfolio.totalVolumeSoldSol,
      totalVolumeBoughtUsd: portfolio.totalVolumeBoughtUsd,
      totalVolumeSoldUsd: portfolio.totalVolumeSoldUsd,
      totalProfitUsd: portfolio.totalProfitUsd,
      tokenPositions,
    }
  });
});

usersRouter.get("/me/fee-settings", requireAuth, async (c) => {
  const sessionUser = c.get("user");
  if (!sessionUser) {
    return c.json({ error: { message: "Unauthorized", code: "UNAUTHORIZED" } }, 401);
  }

  let user:
    | {
        walletAddress: string | null;
        tradeFeeRewardsEnabled: boolean;
        tradeFeeShareBps: number;
        tradeFeePayoutAddress: string | null;
      }
    | null = null;

  try {
    user = await prisma.user.findUnique({
      where: { id: sessionUser.id },
      select: {
        tradeFeeRewardsEnabled: true,
        tradeFeeShareBps: true,
        tradeFeePayoutAddress: true,
        walletAddress: true,
      },
    });
  } catch (error) {
    if (!isPrismaSchemaDriftError(error)) {
      throw error;
    }

    const fallbackUser = await prisma.user.findUnique({
      where: { id: sessionUser.id },
      select: {
        walletAddress: true,
      },
    });
    user = fallbackUser
      ? {
          ...fallbackUser,
          ...DEFAULT_FEE_SETTINGS,
        }
      : null;
  }

  if (!user) {
    return c.json({ error: { message: "User not found", code: "NOT_FOUND" } }, 404);
  }

  return c.json({ data: buildFeeSettingsResponse(user) });
});

usersRouter.patch(
  "/me/fee-settings",
  requireAuth,
  zValidator("json", UpdateFeeSettingsSchema),
  async (c) => {
    const sessionUser = c.get("user");
    if (!sessionUser) {
      return c.json({ error: { message: "Unauthorized", code: "UNAUTHORIZED" } }, 401);
    }

    const payload = c.req.valid("json");
    const updateData: {
      tradeFeeRewardsEnabled?: boolean;
      tradeFeeShareBps?: number;
      tradeFeePayoutAddress?: string | null;
    } = {};

    if (typeof payload.tradeFeeRewardsEnabled === "boolean") {
      updateData.tradeFeeRewardsEnabled = payload.tradeFeeRewardsEnabled;
    }
    if (typeof payload.tradeFeeShareBps === "number" && Number.isFinite(payload.tradeFeeShareBps)) {
      updateData.tradeFeeShareBps = Math.min(
        MAX_POSTER_TRADE_FEE_SHARE_BPS,
        Math.max(0, Math.round(payload.tradeFeeShareBps))
      );
    }
    if (payload.tradeFeePayoutAddress !== undefined) {
      updateData.tradeFeePayoutAddress = payload.tradeFeePayoutAddress || null;
    }

    if (Object.keys(updateData).length === 0) {
      let user:
        | {
            walletAddress: string | null;
            tradeFeeRewardsEnabled: boolean;
            tradeFeeShareBps: number;
            tradeFeePayoutAddress: string | null;
          }
        | null = null;
      try {
        user = await prisma.user.findUnique({
          where: { id: sessionUser.id },
          select: {
            tradeFeeRewardsEnabled: true,
            tradeFeeShareBps: true,
            tradeFeePayoutAddress: true,
            walletAddress: true,
          },
        });
      } catch (error) {
        if (!isPrismaSchemaDriftError(error)) {
          throw error;
        }
        const fallbackUser = await prisma.user.findUnique({
          where: { id: sessionUser.id },
          select: { walletAddress: true },
        });
        user = fallbackUser
          ? {
              ...fallbackUser,
              ...DEFAULT_FEE_SETTINGS,
            }
          : null;
      }
      if (!user) {
        return c.json({ error: { message: "User not found", code: "NOT_FOUND" } }, 404);
      }
      clearCachedMeResponse(sessionUser.id);
      return c.json({ data: buildFeeSettingsResponse(user) });
    }

    let user:
      | {
          walletAddress: string | null;
          tradeFeeRewardsEnabled: boolean;
          tradeFeeShareBps: number;
          tradeFeePayoutAddress: string | null;
        }
      | null = null;
    try {
      user = await prisma.user.update({
        where: { id: sessionUser.id },
        data: updateData,
        select: {
          tradeFeeRewardsEnabled: true,
          tradeFeeShareBps: true,
          tradeFeePayoutAddress: true,
          walletAddress: true,
        },
      });
    } catch (error) {
      if (!isPrismaSchemaDriftError(error)) {
        throw error;
      }

      // Older schemas may not have fee columns yet. Keep endpoint functional.
      const fallbackUser = await prisma.user.findUnique({
        where: { id: sessionUser.id },
        select: { walletAddress: true },
      });
      user = fallbackUser
        ? {
            ...fallbackUser,
            ...DEFAULT_FEE_SETTINGS,
          }
        : null;
    }

    if (!user) {
      return c.json({ error: { message: "User not found", code: "NOT_FOUND" } }, 404);
    }

    clearCachedMeResponse(sessionUser.id);

    return c.json({ data: buildFeeSettingsResponse(user) });
  }
);

usersRouter.get("/me/fee-earnings", requireAuth, async (c) => {
  const sessionUser = c.get("user");
  if (!sessionUser) {
    return c.json({ error: { message: "Unauthorized", code: "UNAUTHORIZED" } }, 401);
  }

  let events: Array<{
    id: string;
    postId: string;
    feeMint: string;
    tradeSide: string;
    platformFeeAmountAtomic: string;
    posterShareAmountAtomic: string;
    txSignature: string | null;
    createdAt: Date;
    traderWalletAddress: string;
  }> = [];

  try {
    events = await prisma.tradeFeeEvent.findMany({
      where: {
        posterUserId: sessionUser.id,
        status: "confirmed",
      },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        postId: true,
        feeMint: true,
        tradeSide: true,
        platformFeeAmountAtomic: true,
        posterShareAmountAtomic: true,
        txSignature: true,
        createdAt: true,
        traderWalletAddress: true,
      },
    });
  } catch (error) {
    if (!isPrismaSchemaDriftError(error)) {
      throw error;
    }

    return c.json({
      data: {
        totalTrades: 0,
        totalPosterShareAtomic: "0",
        byMint: [],
        recentEvents: [],
      },
    });
  }

  let totalPosterShareAtomic = 0n;
  const totalsByMint = new Map<string, { totalAtomic: bigint; count: number }>();

  for (const event of events) {
    const posterShareAmount = BigInt(event.posterShareAmountAtomic);
    totalPosterShareAtomic += posterShareAmount;
    const bucket = totalsByMint.get(event.feeMint) ?? { totalAtomic: 0n, count: 0 };
    bucket.totalAtomic += posterShareAmount;
    bucket.count += 1;
    totalsByMint.set(event.feeMint, bucket);
  }

  const byMint = [...totalsByMint.entries()]
    .map(([mint, bucket]) => ({
      mint,
      totalAtomic: bucket.totalAtomic.toString(),
      count: bucket.count,
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 12);

  const recentEvents = events.slice(0, 20).map((event) => ({
    id: event.id,
    postId: event.postId,
    feeMint: event.feeMint,
    tradeSide: event.tradeSide,
    platformFeeAmountAtomic: event.platformFeeAmountAtomic,
    posterShareAmountAtomic: event.posterShareAmountAtomic,
    txSignature: event.txSignature,
    traderWalletAddress: event.traderWalletAddress,
    createdAt: event.createdAt.toISOString(),
  }));

  return c.json({
    data: {
      totalTrades: events.length,
      totalPosterShareAtomic: totalPosterShareAtomic.toString(),
      byMint,
      recentEvents,
    },
  });
});

// Get user profile by ID or username
usersRouter.get("/:identifier", async (c) => {
  const identifier = c.req.param("identifier");
  const currentUser = c.get("user");
  const shouldUseCache = shouldUseUserRouteCache(currentUser?.id);
  const profileCacheKey = shouldUseCache ? buildUserRouteCacheKey(identifier, null) : null;
  const profileRedisKey =
    profileCacheKey ? buildUserRouteRedisKey(USERS_PROFILE_REDIS_KEY_PREFIX, profileCacheKey) : null;
  c.header("Vary", "Cookie");
  c.header("Cache-Control", buildUserRouteResponseHeaders(shouldUseCache)["Cache-Control"]);
  const cachedProfileResponse =
    profileCacheKey && profileRedisKey
      ? await readUserRouteCache(userProfileRouteCache, profileCacheKey, profileRedisKey)
      : null;
  const staleCachedProfileResponse =
    cachedProfileResponse ??
    (profileCacheKey && profileRedisKey
      ? await readUserRouteCache(userProfileRouteCache, profileCacheKey, profileRedisKey, {
          allowStale: true,
        })
      : null);
  if (cachedProfileResponse) {
    return c.json(cachedProfileResponse);
  }

  let user:
    | {
        id: string;
        image: string | null;
        username: string | null;
        level: number;
        xp: number;
        isVerified: boolean;
        createdAt: Date;
        _count: {
          posts: number;
          followers: number;
          following: number;
        };
      }
    | null = null;
  let profileLookupUnavailable = false;

  try {
    user = await withPrismaRetry(
      () => prisma.user.findFirst({
        where: buildUserIdentifierWhere(identifier),
        select: {
          id: true,
          image: true,
          username: true,
          level: true,
          xp: true,
          isVerified: true,
          createdAt: true,
          _count: {
            select: {
              posts: true,
              followers: true,
              following: true,
            },
          },
        },
      }),
      { label: "users:profile" }
    );
  } catch (error) {
    if (!isPrismaSchemaDriftError(error) && !isPrismaClientError(error)) {
      throw error;
    }
    console.warn("[users/profile] prisma user lookup degraded; using raw fallback", {
      message: getErrorMessage(error),
    });
    try {
      user = await findUserProfileByIdentifierRaw(identifier);
    } catch (rawError) {
      profileLookupUnavailable = true;
      console.warn("[users/profile] raw user lookup degraded", {
        message: getErrorMessage(rawError),
      });
    }
  }

  if (!user) {
    if (profileLookupUnavailable) {
      if (staleCachedProfileResponse) {
        return c.json(staleCachedProfileResponse);
      }
      return c.json(
        {
          error: {
            message: "Profile is temporarily unavailable. Please retry shortly.",
            code: "PROFILE_UNAVAILABLE",
          },
        },
        503
      );
    }
    return c.json({ error: { message: "User not found", code: "NOT_FOUND" } }, 404);
  }

  const isFollowing = await getIsFollowingSafely(currentUser?.id, user.id);
  const stats = await getUserStatsSafely(user.id);
  const responsePayload: UserProfileRoutePayload = {
    data: buildPublicUserProfileDto({ user, isFollowing, stats }),
  };
  if (profileCacheKey && profileRedisKey) {
    writeUserRouteCache(
      userProfileRouteCache,
      profileCacheKey,
      profileRedisKey,
      responsePayload
    );
  }

  return c.json(responsePayload);
});

// Update current user's profile
usersRouter.patch("/me", requireNotBanned, zValidator("json", UpdateProfileSchema), async (c) => {
  const sessionUser = c.get("user");
  if (!sessionUser) {
    return c.json({ error: { message: "Unauthorized", code: "UNAUTHORIZED" } }, 401);
  }

  const {
    username,
    bio,
    image,
    tradeFeeRewardsEnabled,
    tradeFeeShareBps,
    tradeFeePayoutAddress,
  } = c.req.valid("json");

  // Get current user data to check update timestamps
  const currentUserData = await prisma.user.findUnique({
    where: { id: sessionUser.id },
    select: {
      username: true,
      image: true,
      lastUsernameUpdate: true,
      lastPhotoUpdate: true
    },
  });

  if (!currentUserData) {
    return c.json({ error: { message: "User not found", code: "NOT_FOUND" } }, 404);
  }

  const now = new Date();
  const updateData: Record<string, unknown> = {};
  const normalizedRequestedUsername =
    username !== undefined ? normalizeUsernameHandle(username) : undefined;
  const currentNormalizedUsername = currentUserData.username
    ? normalizeUsernameHandle(currentUserData.username)
    : null;
  const needsUsernameNormalizationOnly =
    normalizedRequestedUsername !== undefined &&
    normalizedRequestedUsername === currentNormalizedUsername &&
    normalizedRequestedUsername !== currentUserData.username;
  const isUsernameChanged =
    normalizedRequestedUsername !== undefined &&
    normalizedRequestedUsername !== currentNormalizedUsername;
  const shouldValidateRequestedUsername =
    normalizedRequestedUsername !== undefined &&
    (needsUsernameNormalizationOnly || isUsernameChanged);

  // Check username update cooldown (7 days)
  if (shouldValidateRequestedUsername && normalizedRequestedUsername) {
    if (RESERVED_USERNAME_HANDLES.has(normalizedRequestedUsername)) {
      return c.json(
        {
          error: {
            message: "This handle is reserved. Please choose another one.",
            code: "USERNAME_RESERVED",
          },
        },
        400
      );
    }

    if (needsUsernameNormalizationOnly) {
      updateData.username = normalizedRequestedUsername;
    }
  }

  if (isUsernameChanged && normalizedRequestedUsername) {
    if (currentUserData.lastUsernameUpdate) {
      const daysSinceLastUpdate = (now.getTime() - currentUserData.lastUsernameUpdate.getTime()) / (1000 * 60 * 60 * 24);
      if (daysSinceLastUpdate < USERNAME_UPDATE_COOLDOWN_DAYS) {
        const daysRemaining = Math.ceil(USERNAME_UPDATE_COOLDOWN_DAYS - daysSinceLastUpdate);
        return c.json({
          error: {
            message: `You can only change your username once every ${USERNAME_UPDATE_COOLDOWN_DAYS} days. Please wait ${daysRemaining} more day${daysRemaining === 1 ? '' : 's'}.`,
            code: "USERNAME_COOLDOWN"
          }
        }, 400);
      }
    }

    // Check if username is taken
    const existing = await prisma.user.findFirst({
      where: {
        username: {
          equals: normalizedRequestedUsername,
          mode: "insensitive",
        },
        NOT: { id: sessionUser.id },
      },
      select: {
        id: true,
      },
    });

    if (existing) {
      return c.json({
        error: { message: "Username already taken", code: "USERNAME_TAKEN" }
      }, 400);
    }

    updateData.username = normalizedRequestedUsername;
    updateData.lastUsernameUpdate = now;
  }

  // Check photo update cooldown (24 hours)
  if (image !== undefined && image !== currentUserData.image) {
    if (currentUserData.lastPhotoUpdate) {
      const hoursSinceLastUpdate = (now.getTime() - currentUserData.lastPhotoUpdate.getTime()) / (1000 * 60 * 60);
      if (hoursSinceLastUpdate < PHOTO_UPDATE_COOLDOWN_HOURS) {
        const hoursRemaining = Math.ceil(PHOTO_UPDATE_COOLDOWN_HOURS - hoursSinceLastUpdate);
        return c.json({
          error: {
            message: `You can only change your profile photo once every ${PHOTO_UPDATE_COOLDOWN_HOURS} hours. Please wait ${hoursRemaining} more hour${hoursRemaining === 1 ? '' : 's'}.`,
            code: "PHOTO_COOLDOWN"
          }
        }, 400);
      }
    }

    updateData.image = image;
    updateData.lastPhotoUpdate = now;
  }

  // Add other fields if provided
  if (bio !== undefined) {
    updateData.bio = bio || null;
  }
  if (tradeFeeRewardsEnabled !== undefined) {
    updateData.tradeFeeRewardsEnabled = tradeFeeRewardsEnabled;
  }
  if (tradeFeeShareBps !== undefined && Number.isFinite(tradeFeeShareBps)) {
    updateData.tradeFeeShareBps = Math.min(
      MAX_POSTER_TRADE_FEE_SHARE_BPS,
      Math.max(0, Math.round(tradeFeeShareBps))
    );
  }
  if (tradeFeePayoutAddress !== undefined) {
    updateData.tradeFeePayoutAddress = tradeFeePayoutAddress || null;
  }

  const fullProfileSelect = {
    id: true,
    name: true,
    email: true,
    image: true,
    walletAddress: true,
    username: true,
    level: true,
    xp: true,
    bio: true,
    tradeFeeRewardsEnabled: true,
    tradeFeeShareBps: true,
    tradeFeePayoutAddress: true,
    createdAt: true,
    lastUsernameUpdate: true,
    lastPhotoUpdate: true,
  } as const;

  const fallbackProfileSelect = {
    id: true,
    name: true,
    email: true,
    image: true,
    walletAddress: true,
    username: true,
    level: true,
    xp: true,
    bio: true,
    createdAt: true,
    lastUsernameUpdate: true,
    lastPhotoUpdate: true,
  } as const;

  // If no updates, return current user
  if (Object.keys(updateData).length === 0) {
    let user:
      | {
          id: string;
          name: string;
          email: string;
          image: string | null;
          walletAddress: string | null;
          username: string | null;
          level: number;
          xp: number;
          bio: string | null;
          createdAt: Date;
          lastUsernameUpdate: Date | null;
          lastPhotoUpdate: Date | null;
          tradeFeeRewardsEnabled: boolean;
          tradeFeeShareBps: number;
          tradeFeePayoutAddress: string | null;
        }
      | null = null;

    try {
      user = await prisma.user.findUnique({
        where: { id: sessionUser.id },
        select: fullProfileSelect,
      });
    } catch (error) {
      if (!isPrismaSchemaDriftError(error)) {
        throw error;
      }
      const fallbackUser = await prisma.user.findUnique({
        where: { id: sessionUser.id },
        select: fallbackProfileSelect,
      });
      user = fallbackUser
        ? {
            ...fallbackUser,
            ...DEFAULT_FEE_SETTINGS,
          }
        : null;
    }

    return c.json({ data: user });
  }

  let user:
    | {
        id: string;
        name: string;
        email: string;
        image: string | null;
        walletAddress: string | null;
        username: string | null;
        level: number;
        xp: number;
        bio: string | null;
        createdAt: Date;
        lastUsernameUpdate: Date | null;
        lastPhotoUpdate: Date | null;
        tradeFeeRewardsEnabled: boolean;
        tradeFeeShareBps: number;
        tradeFeePayoutAddress: string | null;
      }
    | null = null;

  try {
    user = await prisma.user.update({
      where: { id: sessionUser.id },
      data: updateData,
      select: fullProfileSelect,
    });
  } catch (error) {
    if (!isPrismaSchemaDriftError(error)) {
      throw error;
    }

    const fallbackUpdateData = { ...updateData };
    delete fallbackUpdateData.tradeFeeRewardsEnabled;
    delete fallbackUpdateData.tradeFeeShareBps;
    delete fallbackUpdateData.tradeFeePayoutAddress;

    const fallbackUser =
      Object.keys(fallbackUpdateData).length > 0
        ? await prisma.user.update({
            where: { id: sessionUser.id },
            data: fallbackUpdateData,
            select: fallbackProfileSelect,
          })
        : await prisma.user.findUnique({
            where: { id: sessionUser.id },
            select: fallbackProfileSelect,
          });

    user = fallbackUser
      ? {
          ...fallbackUser,
          ...DEFAULT_FEE_SETTINGS,
        }
      : null;
  }

  clearCachedMeResponse(sessionUser.id);
  invalidateViewerSocialCaches(sessionUser.id);
  if (currentNormalizedUsername) {
    invalidatePublicUserRouteCachesForUser({
      userId: sessionUser.id,
      username: currentNormalizedUsername,
    });
  }
  invalidatePublicUserRouteCachesForUser({
    userId: sessionUser.id,
    username: user?.username ?? currentNormalizedUsername,
  });
  invalidatePostReadCaches({ leaderboard: true });

  return c.json({ data: user });
});

// Get user's posts
usersRouter.get("/:identifier/posts", async (c) => {
  const identifier = c.req.param("identifier");
  const currentUser = c.get("user");
  const shouldUseCache = shouldUseUserRouteCache(currentUser?.id);
  const postsCacheKey = shouldUseCache ? buildUserRouteCacheKey(identifier, null) : null;
  const postsRedisKey =
    postsCacheKey ? buildUserRouteRedisKey(USERS_POSTS_REDIS_KEY_PREFIX, postsCacheKey) : null;
  c.header("Vary", "Cookie");
  c.header("Cache-Control", buildUserRouteResponseHeaders(shouldUseCache)["Cache-Control"]);
  const cachedPostsResponse =
    postsCacheKey && postsRedisKey
      ? await readUserRouteCache(userPostsRouteCache, postsCacheKey, postsRedisKey)
      : null;
  const staleCachedPostsResponse =
    cachedPostsResponse ??
    (postsCacheKey && postsRedisKey
      ? await readUserRouteCache(userPostsRouteCache, postsCacheKey, postsRedisKey, {
          allowStale: true,
        })
      : null);
  if (cachedPostsResponse) {
    return c.json(cachedPostsResponse);
  }

  let user: { id: string } | null = null;
  let userLookupUnavailable = false;
  try {
    user = await prisma.user.findFirst({
      where: buildUserIdentifierWhere(identifier),
      select: {
        id: true,
      },
    });
  } catch (error) {
    if (!isPrismaSchemaDriftError(error) && !isPrismaClientError(error)) {
      throw error;
    }
    try {
      const fallbackUser = await findUserProfileByIdentifierRaw(identifier);
      user = fallbackUser ? { id: fallbackUser.id } : null;
    } catch (rawError) {
      userLookupUnavailable = true;
      console.warn("[users/profile-posts] raw user lookup degraded", {
        message: getErrorMessage(rawError),
      });
    }
  }

  if (!user) {
    if (userLookupUnavailable) {
      if (staleCachedPostsResponse) {
        return c.json(staleCachedPostsResponse);
      }
      return c.json(
        {
          error: {
            message: "Profile posts are temporarily unavailable. Please retry shortly.",
            code: "PROFILE_POSTS_UNAVAILABLE",
          },
        },
        503
      );
    }
    return c.json({ error: { message: "User not found", code: "NOT_FOUND" } }, 404);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let posts: any[] = [];
  try {
    posts = await prisma.post.findMany({
      where: { authorId: user.id },
      orderBy: { createdAt: "desc" },
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
    });
  } catch (error) {
    if (!isPrismaSchemaDriftError(error) && !isPrismaClientError(error)) {
      throw error;
    }
    console.warn("[users/profile-posts] prisma post lookup degraded; using raw fallback", {
      message: getErrorMessage(error),
    });
    try {
      posts = await findUserPostsRaw(user.id);
    } catch (rawError) {
      console.warn("[users/profile-posts] raw post lookup degraded", {
        message: getErrorMessage(rawError),
      });
      if (staleCachedPostsResponse) {
        return c.json(staleCachedPostsResponse);
      }
      return c.json(
        {
          error: {
            message: "Profile posts are temporarily unavailable. Please retry shortly.",
            code: "PROFILE_POSTS_UNAVAILABLE",
          },
        },
        503
      );
    }
  }

  const { userLikes, userReposts, isFollowingAuthor } = await getPostInteractionSetsSafely({
    currentUserId: currentUser?.id,
    targetUserId: user.id,
    postIds: posts.map((p) => p.id),
  });

  const postsWithSocial = posts.map((post) => ({
    ...post,
    isLiked: userLikes.has(post.id),
    isReposted: userReposts.has(post.id),
    isFollowingAuthor,
  }));
  const responsePayload: UserPostsRoutePayload = { data: postsWithSocial };
  if (postsCacheKey && postsRedisKey) {
    writeUserRouteCache(userPostsRouteCache, postsCacheKey, postsRedisKey, responsePayload);
  }

  return c.json(responsePayload);
});

// Get user's reposts (saved alpha) - only visible on profile page
usersRouter.get("/:identifier/reposts", async (c) => {
  const identifier = c.req.param("identifier");
  const currentUser = c.get("user");
  const shouldUseCache = shouldUseUserRouteCache(currentUser?.id);
  const repostsCacheKey = shouldUseCache ? buildUserRouteCacheKey(identifier, null) : null;
  const repostsRedisKey =
    repostsCacheKey ? buildUserRouteRedisKey(USERS_REPOSTS_REDIS_KEY_PREFIX, repostsCacheKey) : null;
  c.header("Vary", "Cookie");
  c.header("Cache-Control", buildUserRouteResponseHeaders(shouldUseCache)["Cache-Control"]);
  const cachedRepostsResponse =
    repostsCacheKey && repostsRedisKey
      ? await readUserRouteCache(userRepostsRouteCache, repostsCacheKey, repostsRedisKey)
      : null;
  const staleCachedRepostsResponse =
    cachedRepostsResponse ??
    (repostsCacheKey && repostsRedisKey
      ? await readUserRouteCache(userRepostsRouteCache, repostsCacheKey, repostsRedisKey, {
          allowStale: true,
        })
      : null);
  if (cachedRepostsResponse) {
    return c.json(cachedRepostsResponse);
  }

  let user: { id: string } | null = null;
  let userLookupUnavailable = false;
  try {
    user = await prisma.user.findFirst({
      where: buildUserIdentifierWhere(identifier),
      select: {
        id: true,
      },
    });
  } catch (error) {
    if (!isPrismaSchemaDriftError(error) && !isPrismaClientError(error)) {
      throw error;
    }
    try {
      const fallbackUser = await findUserProfileByIdentifierRaw(identifier);
      user = fallbackUser ? { id: fallbackUser.id } : null;
    } catch (rawError) {
      userLookupUnavailable = true;
      console.warn("[users/profile-reposts] raw user lookup degraded", {
        message: getErrorMessage(rawError),
      });
    }
  }

  if (!user) {
    if (userLookupUnavailable) {
      if (staleCachedRepostsResponse) {
        return c.json(staleCachedRepostsResponse);
      }
      return c.json(
        {
          error: {
            message: "Profile reposts are temporarily unavailable. Please retry shortly.",
            code: "PROFILE_REPOSTS_UNAVAILABLE",
          },
        },
        503
      );
    }
    return c.json({ error: { message: "User not found", code: "NOT_FOUND" } }, 404);
  }

  // Get the user's reposts with the original post data
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let reposts: any[] = [];
  try {
    reposts = await prisma.repost.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      select: {
        post: {
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
        },
      },
    });
  } catch (error) {
    if (!isPrismaSchemaDriftError(error) && !isPrismaClientError(error)) {
      throw error;
    }
    console.warn("[users/profile-reposts] prisma repost lookup degraded; using raw fallback", {
      message: getErrorMessage(error),
    });
    try {
      reposts = (await findUserRepostsRaw(user.id)).map((post) => ({ post }));
    } catch (rawError) {
      console.warn("[users/profile-reposts] raw repost lookup degraded", {
        message: getErrorMessage(rawError),
      });
      if (staleCachedRepostsResponse) {
        return c.json(staleCachedRepostsResponse);
      }
      return c.json(
        {
          error: {
            message: "Profile reposts are temporarily unavailable. Please retry shortly.",
            code: "PROFILE_REPOSTS_UNAVAILABLE",
          },
        },
        503
      );
    }
  }

  // Get current user's interactions with these posts
  const posts = reposts.map((r) => r.post);
  const authorIds = [...new Set(posts.map((post) => post.authorId).filter((authorId) => authorId !== currentUser?.id))];
  const { userLikes, userReposts, followingAuthorIds } = await getMixedAuthorPostInteractionsSafely({
    currentUserId: currentUser?.id,
    postIds: posts.map((p) => p.id),
    authorIds,
  });

  const postsWithSocial = posts.map((post) => ({
    ...post,
    isLiked: userLikes.has(post.id),
    isReposted: userReposts.has(post.id),
    isFollowingAuthor: currentUser ? followingAuthorIds.has(post.authorId) : false,
  }));
  const responsePayload: UserPostsRoutePayload = { data: postsWithSocial };
  if (repostsCacheKey && repostsRedisKey) {
    writeUserRouteCache(
      userRepostsRouteCache,
      repostsCacheKey,
      repostsRedisKey,
      responsePayload
    );
  }

  return c.json(responsePayload);
});

async function resolveUserIdentityFromIdentifier(identifier: string): Promise<{
  id: string;
  username: string | null;
} | null> {
  const normalizedIdentifier = normalizeUsernameHandle(identifier);

  const byUsername = await prisma.user.findUnique({
    where: { username: normalizedIdentifier },
    select: { id: true, username: true },
  });
  if (byUsername?.id) {
    return byUsername;
  }

  const byId = await prisma.user.findUnique({
    where: { id: identifier },
    select: { id: true, username: true },
  });
  return byId ?? null;
}

async function createFollowNotificationSafely(params: {
  targetUserId: string;
  followerId: string;
  followerUsername: string | null;
  followerName: string | null;
}): Promise<void> {
  const actorLabel =
    params.followerUsername?.trim() ||
    params.followerName?.trim() ||
    "Someone";
  const payload =
    params.followerUsername && params.followerUsername.trim().length > 0
      ? { handle: params.followerUsername.trim().toLowerCase() }
      : undefined;

  try {
    await prisma.notification.create({
      data: {
        userId: params.targetUserId,
        type: "follow",
        message: `${actorLabel} followed you!`,
        fromUserId: params.followerId,
        entityType: "user",
        entityId: params.followerId,
        reasonCode: "followed_you",
        payload,
      },
    });
    invalidateNotificationsCache(params.targetUserId);
    return;
  } catch (error) {
    if (!isPrismaSchemaDriftError(error)) {
      console.warn("[users] Failed to create follow notification", {
        followerId: params.followerId,
        targetUserId: params.targetUserId,
        message: getErrorMessage(error),
      });
      return;
    }
  }

  try {
    await prisma.notification.create({
      data: {
        userId: params.targetUserId,
        type: "follow",
        message: `${actorLabel} followed you!`,
        fromUserId: params.followerId,
      },
    });
    invalidateNotificationsCache(params.targetUserId);
  } catch (fallbackError) {
    console.warn("[users] Failed to create follow notification fallback", {
      followerId: params.followerId,
      targetUserId: params.targetUserId,
      message: getErrorMessage(fallbackError),
    });
  }
}

// Follow a user
usersRouter.post("/:id/follow", requireNotBanned, async (c) => {
  const currentUser = c.get("user");
  const targetIdentifier = c.req.param("id");

  if (!currentUser) {
    return c.json({ error: { message: "Unauthorized", code: "UNAUTHORIZED" } }, 401);
  }

  const targetUser = await resolveUserIdentityFromIdentifier(targetIdentifier);

  if (!targetUser) {
    return c.json({ error: { message: "User not found", code: "NOT_FOUND" } }, 404);
  }
  const targetUserId = targetUser.id;

  // Cannot follow yourself
  if (currentUser.id === targetUserId) {
    return c.json({ error: { message: "Cannot follow yourself", code: "CANNOT_FOLLOW_SELF" } }, 400);
  }

  // Create follow idempotently so stale UI or repeated taps do not surface raw Prisma errors.
  let createdFollow = false;
  try {
    await prisma.follow.create({
      data: {
        followerId: currentUser.id,
        followingId: targetUserId,
      },
    });
    createdFollow = true;
  } catch (error) {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") {
      console.error("[users] Failed to follow user", {
        followerId: currentUser.id,
        followingId: targetUserId,
        error,
      });
      return c.json(
        { error: { message: "Failed to follow user", code: "INTERNAL_ERROR" } },
        500
      );
    }
  }

  if (createdFollow) {
    try {
      const followerProfile = await prisma.user.findUnique({
        where: { id: currentUser.id },
        select: { username: true, name: true },
      });

      await createFollowNotificationSafely({
        targetUserId,
        followerId: currentUser.id,
        followerUsername: followerProfile?.username ?? null,
        followerName: followerProfile?.name ?? null,
      });
    } catch (error) {
      console.warn("[users] Follow notification side-effect failed", {
        followerId: currentUser.id,
        targetUserId,
        message: getErrorMessage(error),
      });
    }
  }

  // Get updated counts
  const followerCount = await prisma.follow.count({ where: { followingId: targetUserId } });
  invalidateViewerSocialCaches(currentUser.id);
  invalidatePublicUserRouteCachesForUser({
    userId: currentUser.id,
  });
  invalidatePublicUserRouteCachesForUser({
    userId: targetUser.id,
    username: targetUser.username,
  });

  return c.json({ data: { following: true, followerCount } });
});

// Unfollow a user
usersRouter.delete("/:id/follow", requireNotBanned, async (c) => {
  const currentUser = c.get("user");
  const targetIdentifier = c.req.param("id");

  if (!currentUser) {
    return c.json({ error: { message: "Unauthorized", code: "UNAUTHORIZED" } }, 401);
  }

  const targetUser = await resolveUserIdentityFromIdentifier(targetIdentifier);
  if (!targetUser) {
    return c.json({ error: { message: "User not found", code: "NOT_FOUND" } }, 404);
  }
  const targetUserId = targetUser.id;

  // Delete follow idempotently so stale UI can safely reconcile to the final state.
  try {
    await prisma.follow.delete({
      where: {
        followerId_followingId: {
          followerId: currentUser.id,
          followingId: targetUserId,
        },
      },
    });
  } catch (error) {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2025") {
      console.error("[users] Failed to unfollow user", {
        followerId: currentUser.id,
        followingId: targetUserId,
        error,
      });
      return c.json(
        { error: { message: "Failed to unfollow user", code: "INTERNAL_ERROR" } },
        500
      );
    }
  }

  // Get updated counts
  const followerCount = await prisma.follow.count({ where: { followingId: targetUserId } });
  invalidateViewerSocialCaches(currentUser.id);
  invalidatePublicUserRouteCachesForUser({
    userId: currentUser.id,
  });
  invalidatePublicUserRouteCachesForUser({
    userId: targetUser.id,
    username: targetUser.username,
  });

  return c.json({ data: { following: false, followerCount } });
});

// Get user's followers
usersRouter.get("/:id/followers", async (c) => {
  const userId = c.req.param("id");
  const currentUser = c.get("user");

  // Check if user exists
  const user = await prisma.user.findFirst({
    where: buildUserIdentifierWhere(userId),
    select: {
      id: true,
    },
  });

  if (!user) {
    return c.json({ error: { message: "User not found", code: "NOT_FOUND" } }, 404);
  }

  const followers = await prisma.follow.findMany({
    where: { followingId: user.id },
    include: {
      follower: {
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
    orderBy: { createdAt: "desc" },
  });

  // Check if current user follows these users
  let currentUserFollowing: Set<string> = new Set();
  if (currentUser) {
    const followerIds = followers.map((f) => f.follower.id);
    const following = await prisma.follow.findMany({
      where: {
        followerId: currentUser.id,
        followingId: { in: followerIds },
      },
      select: { followingId: true },
    });
    currentUserFollowing = new Set(following.map((f) => f.followingId));
  }

  const followersWithState = followers.map((f) => ({
    ...f.follower,
    isFollowing: currentUserFollowing.has(f.follower.id),
  }));

  return c.json({ data: followersWithState });
});

// Get users that a user is following
usersRouter.get("/:id/following", async (c) => {
  const userId = c.req.param("id");
  const currentUser = c.get("user");

  // Check if user exists
  const user = await prisma.user.findFirst({
    where: buildUserIdentifierWhere(userId),
    select: {
      id: true,
    },
  });

  if (!user) {
    return c.json({ error: { message: "User not found", code: "NOT_FOUND" } }, 404);
  }

  const following = await prisma.follow.findMany({
    where: { followerId: user.id },
    include: {
      following: {
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
    orderBy: { createdAt: "desc" },
  });

  // Check if current user follows these users
  let currentUserFollowing: Set<string> = new Set();
  if (currentUser) {
    const followingIds = following.map((f) => f.following.id);
    const myFollowing = await prisma.follow.findMany({
      where: {
        followerId: currentUser.id,
        followingId: { in: followingIds },
      },
      select: { followingId: true },
    });
    currentUserFollowing = new Set(myFollowing.map((f) => f.followingId));
  }

  const followingWithState = following.map((f) => ({
    ...f.following,
    isFollowing: currentUserFollowing.has(f.following.id),
  }));

  return c.json({ data: followingWithState });
});
