import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { Prisma } from "@prisma/client";
import { prisma } from "../prisma.js";
import { type AuthVariables } from "../auth.js";
import { cacheGetJson, cacheSetJson, redisDelete, redisGetString, redisIncr, redisSetString } from "../lib/redis.js";
import {
  LeaderboardQuerySchema,
  MIN_LEVEL,
  MAX_LEVEL,
} from "../types.js";

export const leaderboardRouter = new Hono<{ Variables: AuthVariables }>();

type CacheEntry<T> = {
  data: T;
  expiresAtMs: number;
};

type TopUsersResponsePayload = {
  data: Array<unknown>;
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
};

const DAILY_GAINERS_CACHE_TTL_MS = process.env.NODE_ENV === "production" ? 5 * 60_000 : 10_000;
const TOP_USERS_CACHE_TTL_MS = process.env.NODE_ENV === "production" ? 5 * 60_000 : 15_000;
const LEADERBOARD_STATS_CACHE_TTL_MS = process.env.NODE_ENV === "production" ? 5 * 60_000 : 30_000;
const LEADERBOARD_QUERY_TIMEOUT_MS = process.env.NODE_ENV === "production" ? 2_500 : 6_000;
const LEADERBOARD_CACHE_VERSION_KEY = "leaderboard:cache-version";
let leaderboardCacheVersionMemory = 1;
let leaderboardCacheVersionReadCache: { value: number; expiresAtMs: number } | null = null;

let dailyGainersCache: CacheEntry<Array<unknown>> | null = null;
let dailyGainersInFlight: Promise<Array<unknown>> | null = null;
const topUsersCache = new Map<string, CacheEntry<TopUsersResponsePayload>>();
let statsCache: CacheEntry<unknown> | null = null;
let statsInFlight: Promise<unknown> | null = null;

export function invalidateLeaderboardCaches() {
  dailyGainersCache = null;
  dailyGainersInFlight = null;
  topUsersCache.clear();
  statsCache = null;
  statsInFlight = null;
  leaderboardCacheVersionReadCache = null;
  leaderboardCacheVersionMemory += 1;
  void redisIncr(LEADERBOARD_CACHE_VERSION_KEY);
  // Best-effort cleanup of current known singleton keys; paged top-users keys are versioned.
  void redisDelete(buildLeaderboardRedisKey("daily-gainers", leaderboardCacheVersionMemory));
  void redisDelete(buildLeaderboardRedisKey("stats", leaderboardCacheVersionMemory));
}

function readCache<T>(entry: CacheEntry<T> | null): T | null {
  if (!entry) return null;
  if (entry.expiresAtMs <= Date.now()) return null;
  return entry.data;
}

function readStaleCache<T>(entry: CacheEntry<T> | null): T | null {
  return entry?.data ?? null;
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

class LeaderboardQueryTimeoutError extends Error {
  constructor(label: string, timeoutMs: number) {
    super(`${label} timed out after ${timeoutMs}ms`);
    this.name = "LeaderboardQueryTimeoutError";
  }
}

async function withLeaderboardTimeout<T>(
  promise: Promise<T>,
  label: string,
  timeoutMs = LEADERBOARD_QUERY_TIMEOUT_MS
): Promise<T> {
  let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeoutHandle = setTimeout(() => {
          reject(new LeaderboardQueryTimeoutError(label, timeoutMs));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
  }
}

function toSafeNumber(value: unknown): number {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : 0;
  }
  if (typeof value === "bigint") {
    return Number(value);
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  if (value instanceof Prisma.Decimal) {
    return value.toNumber();
  }
  return 0;
}

function logLeaderboardFallback(kind: string, error: unknown, hasFallback: boolean): void {
  console.warn(`[leaderboard] ${kind} failed; ${hasFallback ? "serving stale cache" : "no cache fallback available"}`, {
    message: getErrorMessage(error),
  });
}

async function getLeaderboardCacheVersion(): Promise<number> {
  const cached = leaderboardCacheVersionReadCache;
  if (cached && cached.expiresAtMs > Date.now()) {
    return cached.value;
  }

  const redisValue = await redisGetString(LEADERBOARD_CACHE_VERSION_KEY);
  let version = Number.parseInt(redisValue ?? "", 10);
  if (!Number.isFinite(version) || version <= 0) {
    version = leaderboardCacheVersionMemory;
    // Best effort initialize redis version key.
    void redisSetString(LEADERBOARD_CACHE_VERSION_KEY, String(version), 24 * 60 * 60 * 1000);
  }

  leaderboardCacheVersionMemory = Math.max(leaderboardCacheVersionMemory, version);
  leaderboardCacheVersionReadCache = {
    value: leaderboardCacheVersionMemory,
    expiresAtMs: Date.now() + 30_000,
  };
  return leaderboardCacheVersionMemory;
}

function buildLeaderboardRedisKey(kind: string, version: number, suffix?: string): string {
  return `leaderboard:v${version}:${kind}${suffix ? `:${suffix}` : ""}`;
}

async function getWinLossStatsByAuthorIds(authorIds: string[]) {
  const statsMap = new Map<string, { wins: number; losses: number }>();
  const uniqueAuthorIds = [...new Set(authorIds)].filter(Boolean);

  if (uniqueAuthorIds.length === 0) {
    return statsMap;
  }

  const grouped = await prisma.post.groupBy({
    by: ["authorId", "isWin"],
    where: {
      authorId: { in: uniqueAuthorIds },
      settled: true,
      isWin: { not: null },
    },
    _count: { id: true },
  });

  for (const row of grouped) {
    const existing = statsMap.get(row.authorId) ?? { wins: 0, losses: 0 };
    if (row.isWin === true) {
      existing.wins = row._count.id;
    } else if (row.isWin === false) {
      existing.losses = row._count.id;
    }
    statsMap.set(row.authorId, existing);
  }

  return statsMap;
}

/**
 * GET /api/leaderboard/daily-gainers
 * Top 10 alphas by percentage gain today (posts created in last 24 hours)
 * Filter: Only settled posts with positive percent change
 */
leaderboardRouter.get("/daily-gainers", async (c) => {
  const cacheVersion = await getLeaderboardCacheVersion();
  const cached = readCache(dailyGainersCache);
  if (cached) {
    return c.json({ data: cached });
  }
  const staleCached = readStaleCache(dailyGainersCache);
  const redisKey = buildLeaderboardRedisKey("daily-gainers", cacheVersion);
  const redisCached = await cacheGetJson<Array<unknown>>(redisKey);
  if (redisCached) {
    dailyGainersCache = {
      data: redisCached,
      expiresAtMs: Date.now() + DAILY_GAINERS_CACHE_TTL_MS,
    };
    return c.json({ data: redisCached });
  }
  if (dailyGainersInFlight) {
    try {
      const data = await dailyGainersInFlight;
      return c.json({ data });
    } catch (error) {
      logLeaderboardFallback("daily-gainers/in-flight", error, Boolean(staleCached));
      if (staleCached) {
        return c.json({ data: staleCached });
      }
      return c.json(
        { error: { message: "Leaderboard is temporarily unavailable", code: "LEADERBOARD_UNAVAILABLE" } },
        503
      );
    }
  }

  dailyGainersInFlight = (async () => {
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const posts = await withLeaderboardTimeout(
      prisma.post.findMany({
        where: {
          settled: true,
          createdAt: { gte: twentyFourHoursAgo },
          contractAddress: { not: null },
          entryMcap: { not: null },
          currentMcap: { not: null },
          settledAt: { not: null },
        },
        select: {
          id: true,
          tokenName: true,
          tokenSymbol: true,
          tokenImage: true,
          contractAddress: true,
          entryMcap: true,
          currentMcap: true,
          mcap1h: true,
          mcap6h: true,
          percentChange1h: true,
          percentChange6h: true,
          settledAt: true,
          author: {
            select: {
              id: true,
              name: true,
              username: true,
              image: true,
              level: true,
            },
          },
        },
      }),
      "leaderboard.daily-gainers.posts"
    );

    // Calculate best displayed gain after settlement:
    // use the highest gain reached across 1H snapshot, 6H snapshot, and current mcap.
    const postsWithGains = posts
      .map((post) => {
        if (!post.entryMcap || !post.currentMcap) return null;

        const candidates: Array<{ gainPercent: number; displayMcap: number; source: "1h" | "6h" | "current" }> = [];

        if (post.mcap1h !== null && post.percentChange1h !== null) {
          candidates.push({
            gainPercent: post.percentChange1h,
            displayMcap: post.mcap1h,
            source: "1h",
          });
        }
        if (post.mcap6h !== null && post.percentChange6h !== null) {
          candidates.push({
            gainPercent: post.percentChange6h,
            displayMcap: post.mcap6h,
            source: "6h",
          });
        }

        const currentPercent = ((post.currentMcap - post.entryMcap) / post.entryMcap) * 100;
        candidates.push({
          gainPercent: currentPercent,
          displayMcap: post.currentMcap,
          source: "current",
        });

        const best = candidates.reduce((max, item) =>
          item.gainPercent > max.gainPercent ? item : max
        );

        return {
          post,
          gainPercent: best.gainPercent,
          displayMcap: best.displayMcap,
          gainSource: best.source,
        };
      })
      .filter((item): item is NonNullable<typeof item> =>
        item !== null && item.gainPercent > 0
      )
      .sort((a, b) => b.gainPercent - a.gainPercent)
      .slice(0, 10);

    const dailyGainers = postsWithGains.map((item, index) => ({
      rank: index + 1,
      postId: item.post.id,
      tokenName: item.post.tokenName,
      tokenSymbol: item.post.tokenSymbol,
      tokenImage: item.post.tokenImage,
      contractAddress: item.post.contractAddress!,
      user: {
        id: item.post.author.id,
        name: item.post.author.name,
        username: item.post.author.username,
        image: item.post.author.image,
        level: item.post.author.level,
      },
      gainPercent: Math.round(item.gainPercent * 100) / 100,
      entryMcap: item.post.entryMcap!,
      currentMcap: item.displayMcap,
      settledAt: item.post.settledAt!.toISOString(),
    }));

    dailyGainersCache = {
      data: dailyGainers,
      expiresAtMs: Date.now() + DAILY_GAINERS_CACHE_TTL_MS,
    };
    void cacheSetJson(redisKey, dailyGainers, DAILY_GAINERS_CACHE_TTL_MS);
    return dailyGainers;
  })();

  try {
    const data = await dailyGainersInFlight;
    return c.json({ data });
  } catch (error) {
    logLeaderboardFallback("daily-gainers", error, Boolean(staleCached));
    if (staleCached) {
      return c.json({ data: staleCached });
    }
    return c.json(
      { error: { message: "Leaderboard is temporarily unavailable", code: "LEADERBOARD_UNAVAILABLE" } },
      503
    );
  } finally {
    dailyGainersInFlight = null;
  }
});

/**
 * GET /api/leaderboard/top-users
 * Top users ranked by level, activity, or win rate
 * Query params: page, limit (default 20), sortBy (level, activity, winrate)
 */
leaderboardRouter.get("/top-users", zValidator("query", LeaderboardQuerySchema), async (c) => {
  const { page, limit, sortBy } = c.req.valid("query");
  const cacheVersion = await getLeaderboardCacheVersion();
  const topUsersCacheKey = `${sortBy}:${page}:${limit}`;
  const cached = topUsersCache.get(topUsersCacheKey);
  if (cached && cached.expiresAtMs > Date.now()) {
    return c.json(cached.data);
  }
  const redisKey = buildLeaderboardRedisKey("top-users", cacheVersion, topUsersCacheKey);
  const redisCached = await cacheGetJson<TopUsersResponsePayload>(redisKey);
  if (redisCached) {
    topUsersCache.set(topUsersCacheKey, {
      data: redisCached,
      expiresAtMs: Date.now() + TOP_USERS_CACHE_TTL_MS,
    });
    return c.json(redisCached);
  }
  const staleCached = cached?.data ?? null;
  const skip = (page - 1) * limit;
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  // Minimum posts required for win rate ranking
  const MIN_POSTS_FOR_WINRATE = 5;
  try {
    const responsePayload = await withLeaderboardTimeout((async (): Promise<TopUsersResponsePayload> => {
      if (sortBy === "activity") {
        const recentPostsByUser = await withLeaderboardTimeout(
          prisma.post.groupBy({
            by: ["authorId"],
            where: {
              createdAt: { gte: sevenDaysAgo },
            },
            _count: { id: true },
            orderBy: { _count: { id: "desc" } },
            skip,
            take: limit,
          }),
          "leaderboard.top-users.activity.rows"
        );

        const userIds = recentPostsByUser.map((p) => p.authorId);
        const [winLossStats, usersDetails, totalActiveUsersRows] = await Promise.all([
          withLeaderboardTimeout(
            getWinLossStatsByAuthorIds(userIds),
            "leaderboard.top-users.activity.stats"
          ),
          withLeaderboardTimeout(
            prisma.user.findMany({
              where: { id: { in: userIds } },
              select: {
                id: true,
                username: true,
                name: true,
                image: true,
                level: true,
                xp: true,
                _count: {
                  select: { posts: true },
                },
              },
            }),
            "leaderboard.top-users.activity.users"
          ),
          withLeaderboardTimeout(
            prisma.$queryRaw<Array<{ count: bigint | number | string | Prisma.Decimal | null }>>(Prisma.sql`
              SELECT COUNT(DISTINCT "authorId")::bigint AS count
              FROM "Post"
              WHERE "createdAt" >= ${sevenDaysAgo}
            `),
            "leaderboard.top-users.activity.total"
          ),
        ]);
        const usersById = new Map(usersDetails.map((u) => [u.id, u]));

        const usersWithStats = recentPostsByUser
          .map((recentPost, index) => {
            const user = usersById.get(recentPost.authorId);
            if (!user) return null;
            const stats = winLossStats.get(user.id) ?? { wins: 0, losses: 0 };
            const wins = stats.wins;
            const losses = stats.losses;
            const totalSettled = wins + losses;
            const winRate = totalSettled > 0 ? (wins / totalSettled) * 100 : 0;

            return {
              rank: skip + index + 1,
              user: {
                id: user.id,
                username: user.username,
                name: user.name,
                image: user.image,
                level: user.level,
                xp: user.xp,
              },
              stats: {
                totalAlphas: user._count.posts,
                recentAlphas: recentPost._count.id,
                wins,
                losses,
                winRate: Math.round(winRate * 100) / 100,
              },
            };
          })
          .filter((user): user is NonNullable<typeof user> => user !== null);

        const totalActiveUsers = Math.max(0, Math.round(toSafeNumber(totalActiveUsersRows[0]?.count ?? 0)));

        return {
          data: usersWithStats,
          pagination: {
            page,
            limit,
            total: totalActiveUsers,
            totalPages: Math.ceil(totalActiveUsers / limit),
          },
        };
      }

      if (sortBy === "winrate") {
        type WinrateRow = {
          authorId: string;
          wins: bigint | number | string | Prisma.Decimal | null;
          losses: bigint | number | string | Prisma.Decimal | null;
          totalSettled: bigint | number | string | Prisma.Decimal | null;
          winRate: bigint | number | string | Prisma.Decimal | null;
        };

        const [winrateRows, totalQualifiedRows] = await Promise.all([
          withLeaderboardTimeout(
            prisma.$queryRaw<WinrateRow[]>(Prisma.sql`
              SELECT
                p."authorId",
                COUNT(*) FILTER (WHERE p."isWin" = true) AS wins,
                COUNT(*) FILTER (WHERE p."isWin" = false) AS losses,
                COUNT(*) AS "totalSettled",
                ROUND(
                  (COUNT(*) FILTER (WHERE p."isWin" = true)::numeric / NULLIF(COUNT(*), 0)::numeric) * 100,
                  2
                ) AS "winRate"
              FROM "Post" p
              WHERE p."settled" = true
                AND p."isWin" IS NOT NULL
              GROUP BY p."authorId"
              HAVING COUNT(*) >= ${MIN_POSTS_FOR_WINRATE}
              ORDER BY "winRate" DESC, COUNT(*) DESC
              OFFSET ${skip}
              LIMIT ${limit}
            `),
            "leaderboard.top-users.winrate.rows"
          ),
          withLeaderboardTimeout(
            prisma.$queryRaw<Array<{ count: bigint | number | string | Prisma.Decimal | null }>>(Prisma.sql`
              SELECT COUNT(*)::bigint AS count
              FROM (
                SELECT p."authorId"
                FROM "Post" p
                WHERE p."settled" = true
                  AND p."isWin" IS NOT NULL
                GROUP BY p."authorId"
                HAVING COUNT(*) >= ${MIN_POSTS_FOR_WINRATE}
              ) qualified
            `),
            "leaderboard.top-users.winrate.total"
          ),
        ]);

        const userIds = winrateRows.map((row) => row.authorId);
        const usersDetails = await withLeaderboardTimeout(
          prisma.user.findMany({
            where: { id: { in: userIds } },
            select: {
              id: true,
              username: true,
              name: true,
              image: true,
              level: true,
              xp: true,
              _count: {
                select: { posts: true },
              },
            },
          }),
          "leaderboard.top-users.winrate.users"
        );
        const usersById = new Map(usersDetails.map((user) => [user.id, user]));

        const data = winrateRows
          .map((row, index) => {
            const user = usersById.get(row.authorId);
            if (!user) return null;
            return {
              rank: skip + index + 1,
              user: {
                id: user.id,
                username: user.username,
                name: user.name,
                image: user.image,
                level: user.level,
                xp: user.xp,
              },
              stats: {
                totalAlphas: user._count.posts,
                wins: Math.max(0, Math.round(toSafeNumber(row.wins))),
                losses: Math.max(0, Math.round(toSafeNumber(row.losses))),
                winRate: Math.round(toSafeNumber(row.winRate) * 100) / 100,
              },
            };
          })
          .filter((user): user is NonNullable<typeof user> => user !== null);

        const totalQualified = Math.max(0, Math.round(toSafeNumber(totalQualifiedRows[0]?.count ?? 0)));

        return {
          data,
          pagination: {
            page,
            limit,
            total: totalQualified,
            totalPages: Math.ceil(totalQualified / limit),
          },
        };
      }

      const [totalCount, users] = await Promise.all([
        withLeaderboardTimeout(
          prisma.user.count({
            where: {
              posts: {
                some: {},
              },
            },
          }),
          "leaderboard.top-users.level.total"
        ),
        withLeaderboardTimeout(
          prisma.user.findMany({
            where: {
              posts: {
                some: {},
              },
            },
            select: {
              id: true,
              username: true,
              name: true,
              image: true,
              level: true,
              xp: true,
              _count: {
                select: {
                  posts: true,
                },
              },
            },
            orderBy: [
              { level: "desc" },
              { xp: "desc" },
            ],
            skip,
            take: limit,
          }),
          "leaderboard.top-users.level.users"
        ),
      ]);

      const winLossStats = await withLeaderboardTimeout(
        getWinLossStatsByAuthorIds(users.map((user) => user.id)),
        "leaderboard.top-users.level.stats"
      );

      const usersWithStats = users.map((user, index) => {
        const stats = winLossStats.get(user.id) ?? { wins: 0, losses: 0 };
        const wins = stats.wins;
        const losses = stats.losses;
        const totalSettled = wins + losses;
        const winRate = totalSettled > 0 ? (wins / totalSettled) * 100 : 0;

        return {
          rank: skip + index + 1,
          user: {
            id: user.id,
            username: user.username,
            name: user.name,
            image: user.image,
            level: user.level,
            xp: user.xp,
          },
          stats: {
            totalAlphas: user._count.posts,
            wins,
            losses,
            winRate: Math.round(winRate * 100) / 100,
          },
        };
      });

      usersWithStats.sort((a, b) => {
        if (b.user.level !== a.user.level) {
          return b.user.level - a.user.level;
        }
        return b.stats.winRate - a.stats.winRate;
      });

      usersWithStats.forEach((user, index) => {
        user.rank = skip + index + 1;
      });

      return {
        data: usersWithStats,
        pagination: {
          page,
          limit,
          total: totalCount,
          totalPages: Math.ceil(totalCount / limit),
        },
      };
    })(), "leaderboard.top-users");

    topUsersCache.set(topUsersCacheKey, {
      data: responsePayload,
      expiresAtMs: Date.now() + TOP_USERS_CACHE_TTL_MS,
    });
    void cacheSetJson(redisKey, responsePayload, TOP_USERS_CACHE_TTL_MS);
    return c.json(responsePayload);
  } catch (error) {
    logLeaderboardFallback(`top-users:${sortBy}`, error, Boolean(staleCached));
    if (staleCached) {
      return c.json(staleCached);
    }
    return c.json(
      { error: { message: "Leaderboard is temporarily unavailable", code: "LEADERBOARD_UNAVAILABLE" } },
      503
    );
  }
});

/**
 * GET /api/leaderboard/stats
 * Platform-wide statistics
 */
leaderboardRouter.get("/stats", async (c) => {
  const cacheVersion = await getLeaderboardCacheVersion();
  const cached = readCache(statsCache);
  if (cached) {
    return c.json({ data: cached });
  }
  const staleCached = readStaleCache(statsCache);
  const redisKey = buildLeaderboardRedisKey("stats", cacheVersion);
  const redisCached = await cacheGetJson<unknown>(redisKey);
  if (redisCached) {
    statsCache = {
      data: redisCached,
      expiresAtMs: Date.now() + LEADERBOARD_STATS_CACHE_TTL_MS,
    };
    return c.json({ data: redisCached });
  }
  if (statsInFlight) {
    try {
      const data = await statsInFlight;
      return c.json({ data });
    } catch (error) {
      logLeaderboardFallback("stats/in-flight", error, Boolean(staleCached));
      if (staleCached) {
        return c.json({ data: staleCached });
      }
      return c.json(
        { error: { message: "Leaderboard stats are temporarily unavailable", code: "LEADERBOARD_UNAVAILABLE" } },
        503
      );
    }
  }

  statsInFlight = (async () => {
    const now = Date.now();
    const oneDayAgo = new Date(now - 24 * 60 * 60 * 1000);
    const oneWeekAgo = new Date(now - 7 * 24 * 60 * 60 * 1000);
    const oneMonthAgo = new Date(now - 30 * 24 * 60 * 60 * 1000);

    type StatsSummaryRow = {
      volumeDay: Prisma.Decimal | number | string | null;
      volumeWeek: Prisma.Decimal | number | string | null;
      volumeMonth: Prisma.Decimal | number | string | null;
      volumeAllTime: Prisma.Decimal | number | string | null;
      alphasToday: bigint | number | string | Prisma.Decimal | null;
      alphasWeek: bigint | number | string | Prisma.Decimal | null;
      alphasMonth: bigint | number | string | Prisma.Decimal | null;
      alphasTotal: bigint | number | string | Prisma.Decimal | null;
      totalWins: bigint | number | string | Prisma.Decimal | null;
      totalLosses: bigint | number | string | Prisma.Decimal | null;
      activeUsersToday: bigint | number | string | Prisma.Decimal | null;
      activeUsersWeek: bigint | number | string | Prisma.Decimal | null;
      totalUsers: bigint | number | string | Prisma.Decimal | null;
    };

    const [summaryRows, levelDistribution, topUsersThisWeek] = await Promise.all([
      withLeaderboardTimeout(
        prisma.$queryRaw<StatsSummaryRow[]>(Prisma.sql`
          SELECT
            COALESCE((SELECT SUM("entryMcap") FROM "Post" WHERE "createdAt" >= ${oneDayAgo} AND "entryMcap" IS NOT NULL), 0) AS "volumeDay",
            COALESCE((SELECT SUM("entryMcap") FROM "Post" WHERE "createdAt" >= ${oneWeekAgo} AND "entryMcap" IS NOT NULL), 0) AS "volumeWeek",
            COALESCE((SELECT SUM("entryMcap") FROM "Post" WHERE "createdAt" >= ${oneMonthAgo} AND "entryMcap" IS NOT NULL), 0) AS "volumeMonth",
            COALESCE((SELECT SUM("entryMcap") FROM "Post" WHERE "entryMcap" IS NOT NULL), 0) AS "volumeAllTime",
            (SELECT COUNT(*)::bigint FROM "Post" WHERE "createdAt" >= ${oneDayAgo}) AS "alphasToday",
            (SELECT COUNT(*)::bigint FROM "Post" WHERE "createdAt" >= ${oneWeekAgo}) AS "alphasWeek",
            (SELECT COUNT(*)::bigint FROM "Post" WHERE "createdAt" >= ${oneMonthAgo}) AS "alphasMonth",
            (SELECT COUNT(*)::bigint FROM "Post") AS "alphasTotal",
            (SELECT COUNT(*)::bigint FROM "Post" WHERE "settled" = true AND "isWin" = true) AS "totalWins",
            (SELECT COUNT(*)::bigint FROM "Post" WHERE "settled" = true AND "isWin" = false) AS "totalLosses",
            (SELECT COUNT(DISTINCT "authorId")::bigint FROM "Post" WHERE "createdAt" >= ${oneDayAgo}) AS "activeUsersToday",
            (SELECT COUNT(DISTINCT "authorId")::bigint FROM "Post" WHERE "createdAt" >= ${oneWeekAgo}) AS "activeUsersWeek",
            (SELECT COUNT(*)::bigint FROM "User") AS "totalUsers"
        `),
        "leaderboard.stats.summary"
      ),
      withLeaderboardTimeout(
        prisma.user.groupBy({
          by: ["level"],
          _count: { level: true },
          orderBy: { level: "asc" },
        }),
        "leaderboard.stats.level-distribution"
      ),
      withLeaderboardTimeout(
        prisma.$queryRaw<Array<{
          id: string;
          name: string | null;
          username: string | null;
          image: string | null;
          level: number | null;
          postsThisWeek: bigint | number | string | Prisma.Decimal | null;
        }>>(Prisma.sql`
          SELECT
            u.id,
            u.name,
            u.username,
            u.image,
            u.level,
            COUNT(*)::bigint AS "postsThisWeek"
          FROM "Post" p
          JOIN "User" u ON u.id = p."authorId"
          WHERE p."createdAt" >= ${oneWeekAgo}
          GROUP BY u.id, u.name, u.username, u.image, u.level
          ORDER BY COUNT(*) DESC
          LIMIT 5
        `),
        "leaderboard.stats.top-users-week"
      ),
    ]);

    const summary = summaryRows[0];
    const totalWins = toSafeNumber(summary?.totalWins ?? 0);
    const totalLosses = toSafeNumber(summary?.totalLosses ?? 0);
    const totalSettled = totalWins + totalLosses;
    const avgWinRate = totalSettled > 0 ? (totalWins / totalSettled) * 100 : 0;

    const levelDistMap = new Map<number, number>();
    levelDistribution.forEach((ld) => {
      levelDistMap.set(ld.level, ld._count.level);
    });

    const formattedLevelDist = [];
    for (let level = MIN_LEVEL; level <= MAX_LEVEL; level++) {
      formattedLevelDist.push({
        level,
        count: levelDistMap.get(level) ?? 0,
      });
    }

    const data = {
      volume: {
        day: toSafeNumber(summary?.volumeDay ?? 0),
        week: toSafeNumber(summary?.volumeWeek ?? 0),
        month: toSafeNumber(summary?.volumeMonth ?? 0),
        allTime: toSafeNumber(summary?.volumeAllTime ?? 0),
      },
      alphas: {
        today: Math.max(0, Math.round(toSafeNumber(summary?.alphasToday ?? 0))),
        week: Math.max(0, Math.round(toSafeNumber(summary?.alphasWeek ?? 0))),
        month: Math.max(0, Math.round(toSafeNumber(summary?.alphasMonth ?? 0))),
        total: Math.max(0, Math.round(toSafeNumber(summary?.alphasTotal ?? 0))),
      },
      avgWinRate: Math.round(avgWinRate * 100) / 100,
      activeUsers: {
        today: Math.max(0, Math.round(toSafeNumber(summary?.activeUsersToday ?? 0))),
        week: Math.max(0, Math.round(toSafeNumber(summary?.activeUsersWeek ?? 0))),
      },
      totalUsers: Math.max(0, Math.round(toSafeNumber(summary?.totalUsers ?? 0))),
      levelDistribution: formattedLevelDist,
      topUsersThisWeek: topUsersThisWeek.map((user) => ({
        id: user.id,
        name: user.name ?? null,
        username: user.username ?? null,
        image: user.image ?? null,
        level: Math.max(0, Math.round(toSafeNumber(user.level ?? 0))),
        postsThisWeek: Math.max(0, Math.round(toSafeNumber(user.postsThisWeek ?? 0))),
      })),
    };

    statsCache = {
      data,
      expiresAtMs: Date.now() + LEADERBOARD_STATS_CACHE_TTL_MS,
    };
    void cacheSetJson(redisKey, data, LEADERBOARD_STATS_CACHE_TTL_MS);
    return data;
  })();

  try {
    const data = await statsInFlight;
    return c.json({ data });
  } catch (error) {
    logLeaderboardFallback("stats", error, Boolean(staleCached));
    if (staleCached) {
      return c.json({ data: staleCached });
    }
    return c.json(
      { error: { message: "Leaderboard stats are temporarily unavailable", code: "LEADERBOARD_UNAVAILABLE" } },
      503
    );
  } finally {
    statsInFlight = null;
  }
});
