import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { prisma } from "../prisma.js";
import { type AuthVariables } from "../auth.js";
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

const DAILY_GAINERS_CACHE_TTL_MS = process.env.NODE_ENV === "production" ? 60_000 : 10_000;
const TOP_USERS_CACHE_TTL_MS = process.env.NODE_ENV === "production" ? 45_000 : 10_000;
const LEADERBOARD_STATS_CACHE_TTL_MS = process.env.NODE_ENV === "production" ? 180_000 : 30_000;

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
}

function readCache<T>(entry: CacheEntry<T> | null): T | null {
  if (!entry) return null;
  if (entry.expiresAtMs <= Date.now()) return null;
  return entry.data;
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
  const cached = readCache(dailyGainersCache);
  if (cached) {
    return c.json({ data: cached });
  }
  if (dailyGainersInFlight) {
    const data = await dailyGainersInFlight;
    return c.json({ data });
  }

  dailyGainersInFlight = (async () => {
  const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

  // Find settled posts from last 24 hours with positive gains
  const posts = await prisma.post.findMany({
    where: {
      settled: true,
      createdAt: { gte: twentyFourHoursAgo },
      contractAddress: { not: null },
      entryMcap: { not: null },
      currentMcap: { not: null },
      settledAt: { not: null },
    },
    include: {
      author: {
        select: {
          id: true,
          username: true,
          image: true,
          level: true,
        },
      },
    },
  });

  // Calculate gain percent and filter for positive gains
  const postsWithGains = posts
    .map((post) => {
      if (!post.entryMcap || !post.currentMcap) return null;

      // Use whichever percent change is higher (1h or 6h)
      let gainPercent: number;
      if (post.percentChange1h !== null && post.percentChange6h !== null) {
        gainPercent = Math.max(post.percentChange1h, post.percentChange6h);
      } else if (post.percentChange1h !== null) {
        gainPercent = post.percentChange1h;
      } else if (post.percentChange6h !== null) {
        gainPercent = post.percentChange6h;
      } else {
        // Fallback to calculating from entry/current mcap
        gainPercent = ((post.currentMcap - post.entryMcap) / post.entryMcap) * 100;
      }

      return {
        post,
        gainPercent,
      };
    })
    .filter((item): item is NonNullable<typeof item> =>
      item !== null && item.gainPercent > 0
    )
    .sort((a, b) => b.gainPercent - a.gainPercent)
    .slice(0, 10);

  // Format response
  const dailyGainers = postsWithGains.map((item, index) => ({
    rank: index + 1,
    postId: item.post.id,
    tokenName: item.post.tokenName,
    tokenSymbol: item.post.tokenSymbol,
    contractAddress: item.post.contractAddress!,
    user: {
      id: item.post.author.id,
      username: item.post.author.username,
      image: item.post.author.image,
      level: item.post.author.level,
    },
    gainPercent: Math.round(item.gainPercent * 100) / 100,
    entryMcap: item.post.entryMcap!,
    currentMcap: item.post.currentMcap!,
    settledAt: item.post.settledAt!.toISOString(),
  }));

    dailyGainersCache = {
      data: dailyGainers,
      expiresAtMs: Date.now() + DAILY_GAINERS_CACHE_TTL_MS,
    };
    return dailyGainers;
  })();

  try {
    const data = await dailyGainersInFlight;
    return c.json({ data });
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
  const topUsersCacheKey = `${sortBy}:${page}:${limit}`;
  const cached = topUsersCache.get(topUsersCacheKey);
  if (cached && cached.expiresAtMs > Date.now()) {
    return c.json(cached.data);
  }
  const skip = (page - 1) * limit;
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  // Minimum posts required for win rate ranking
  const MIN_POSTS_FOR_WINRATE = 5;

  // Get total count of users with at least one post
  const totalCount = await prisma.user.count({
    where: {
      posts: {
        some: {},
      },
    },
  });

  // For activity sorting, we need a different approach - get users with recent post counts
  if (sortBy === 'activity') {
    // Get users who posted in the last 7 days, ordered by post count
    const recentPostsByUser = await prisma.post.groupBy({
      by: ['authorId'],
      where: {
        createdAt: { gte: sevenDaysAgo },
      },
      _count: { id: true },
      orderBy: { _count: { id: 'desc' } },
      skip,
      take: limit,
    });

    const userIds = recentPostsByUser.map((p) => p.authorId);
    const winLossStats = await getWinLossStatsByAuthorIds(userIds);

    // Get user details
    const usersDetails = await prisma.user.findMany({
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
    });
    const usersById = new Map(usersDetails.map((u) => [u.id, u]));

    // Get win/loss stats for each user
    const usersWithStats = recentPostsByUser.map((recentPost, index) => {
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
      });

    const filteredUsers = usersWithStats.filter((u): u is NonNullable<typeof u> => u !== null);

    // Count total active users for pagination
    const totalActiveUsers = await prisma.post.groupBy({
      by: ['authorId'],
      where: { createdAt: { gte: sevenDaysAgo } },
    });

    const responsePayload: TopUsersResponsePayload = {
      data: filteredUsers,
      pagination: {
        page,
        limit,
        total: totalActiveUsers.length,
        totalPages: Math.ceil(totalActiveUsers.length / limit),
      },
    };
    topUsersCache.set(topUsersCacheKey, {
      data: responsePayload,
      expiresAtMs: Date.now() + TOP_USERS_CACHE_TTL_MS,
    });
    return c.json(responsePayload);
  }

  if (sortBy === 'winrate') {
    // For win rate, we need to get all users with enough posts and calculate win rates
    // First get all users with at least MIN_POSTS_FOR_WINRATE settled posts
    const usersWithSettledPosts = await prisma.user.findMany({
      where: {
        posts: {
          some: { settled: true },
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
          select: { posts: true },
        },
      },
    });

    const winLossStats = await getWinLossStatsByAuthorIds(usersWithSettledPosts.map((user) => user.id));

    // Calculate win rates for all users
    const usersWithWinRates = usersWithSettledPosts.map((user) => {
        const stats = winLossStats.get(user.id) ?? { wins: 0, losses: 0 };
        const wins = stats.wins;
        const losses = stats.losses;

        const totalSettled = wins + losses;
        const winRate = totalSettled > 0 ? (wins / totalSettled) * 100 : 0;

        return {
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
            totalSettled,
          },
        };
      });

    // Filter users with minimum posts and sort by win rate
    const qualifiedUsers = usersWithWinRates
      .filter((u) => u.stats.totalSettled >= MIN_POSTS_FOR_WINRATE)
      .sort((a, b) => {
        if (b.stats.winRate !== a.stats.winRate) {
          return b.stats.winRate - a.stats.winRate;
        }
        // Tie-breaker: more total alphas
        return b.stats.totalSettled - a.stats.totalSettled;
      });

    const totalQualified = qualifiedUsers.length;
    const paginatedUsers = qualifiedUsers.slice(skip, skip + limit);

    const result = paginatedUsers.map((u, index) => ({
      rank: skip + index + 1,
      user: u.user,
      stats: {
        totalAlphas: u.stats.totalAlphas,
        wins: u.stats.wins,
        losses: u.stats.losses,
        winRate: u.stats.winRate,
      },
    }));

    const responsePayload: TopUsersResponsePayload = {
      data: result,
      pagination: {
        page,
        limit,
        total: totalQualified,
        totalPages: Math.ceil(totalQualified / limit),
      },
    };
    topUsersCache.set(topUsersCacheKey, {
      data: responsePayload,
      expiresAtMs: Date.now() + TOP_USERS_CACHE_TTL_MS,
    });
    return c.json(responsePayload);
  }

  // Default: sortBy === 'level'
  // Get users with their post stats
  const users = await prisma.user.findMany({
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
  });

  const winLossStats = await getWinLossStatsByAuthorIds(users.map((user) => user.id));

  // Get win/loss stats for each user
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

  // Sort by level first, then by win rate for tie-breaking
  usersWithStats.sort((a, b) => {
    if (b.user.level !== a.user.level) {
      return b.user.level - a.user.level;
    }
    return b.stats.winRate - a.stats.winRate;
  });

  // Re-assign ranks after sorting
  usersWithStats.forEach((user, index) => {
    user.rank = skip + index + 1;
  });

  const responsePayload: TopUsersResponsePayload = {
    data: usersWithStats,
    pagination: {
      page,
      limit,
      total: totalCount,
      totalPages: Math.ceil(totalCount / limit),
    },
  };
  topUsersCache.set(topUsersCacheKey, {
    data: responsePayload,
    expiresAtMs: Date.now() + TOP_USERS_CACHE_TTL_MS,
  });
  return c.json(responsePayload);
});

/**
 * GET /api/leaderboard/stats
 * Platform-wide statistics
 */
leaderboardRouter.get("/stats", async (c) => {
  const cached = readCache(statsCache);
  if (cached) {
    return c.json({ data: cached });
  }
  if (statsInFlight) {
    const data = await statsInFlight;
    return c.json({ data });
  }

  statsInFlight = (async () => {
  const now = Date.now();
  const oneDayAgo = new Date(now - 24 * 60 * 60 * 1000);
  const oneWeekAgo = new Date(now - 7 * 24 * 60 * 60 * 1000);
  const oneMonthAgo = new Date(now - 30 * 24 * 60 * 60 * 1000);

  // Run all queries in parallel for performance
  const [
    // Volume calculations (sum of entryMcap)
    volumeDay,
    volumeWeek,
    volumeMonth,
    volumeAllTime,
    // Alpha counts
    alphasToday,
    alphasWeek,
    alphasMonth,
    alphasTotal,
    // Settlement stats for avg win rate
    totalWins,
    totalLosses,
    // Active users
    activeUsersToday,
    activeUsersWeek,
    // Total users
    totalUsers,
    // Level distribution
    levelDistribution,
    // Top users this week
    topUsersThisWeek,
  ] = await Promise.all([
    // Volume calculations
    prisma.post.aggregate({
      where: {
        createdAt: { gte: oneDayAgo },
        entryMcap: { not: null },
      },
      _sum: { entryMcap: true },
    }),
    prisma.post.aggregate({
      where: {
        createdAt: { gte: oneWeekAgo },
        entryMcap: { not: null },
      },
      _sum: { entryMcap: true },
    }),
    prisma.post.aggregate({
      where: {
        createdAt: { gte: oneMonthAgo },
        entryMcap: { not: null },
      },
      _sum: { entryMcap: true },
    }),
    prisma.post.aggregate({
      where: {
        entryMcap: { not: null },
      },
      _sum: { entryMcap: true },
    }),
    // Alpha counts
    prisma.post.count({
      where: { createdAt: { gte: oneDayAgo } },
    }),
    prisma.post.count({
      where: { createdAt: { gte: oneWeekAgo } },
    }),
    prisma.post.count({
      where: { createdAt: { gte: oneMonthAgo } },
    }),
    prisma.post.count(),
    // Win/loss for avg win rate
    prisma.post.count({
      where: { settled: true, isWin: true },
    }),
    prisma.post.count({
      where: { settled: true, isWin: false },
    }),
    // Active users (users who posted)
    prisma.post.groupBy({
      by: ["authorId"],
      where: { createdAt: { gte: oneDayAgo } },
    }),
    prisma.post.groupBy({
      by: ["authorId"],
      where: { createdAt: { gte: oneWeekAgo } },
    }),
    // Total users
    prisma.user.count(),
    // Level distribution (from -5 to 10)
    prisma.user.groupBy({
      by: ["level"],
      _count: { level: true },
      orderBy: { level: "asc" },
    }),
    // Top 5 users this week by post count
    prisma.post.groupBy({
      by: ["authorId"],
      where: { createdAt: { gte: oneWeekAgo } },
      _count: { id: true },
      orderBy: { _count: { id: "desc" } },
      take: 5,
    }),
  ]);

  // Get user details for top users this week
  const topUserIds = topUsersThisWeek.map((u) => u.authorId);
  const topUserDetails = await prisma.user.findMany({
    where: { id: { in: topUserIds } },
    select: {
      id: true,
      name: true,
      username: true,
      image: true,
      level: true,
    },
  });

  const topUsersWithDetails = topUsersThisWeek.map((tu) => {
    const userDetail = topUserDetails.find((u) => u.id === tu.authorId);
    return {
      id: tu.authorId,
      name: userDetail?.name ?? null,
      username: userDetail?.username ?? null,
      image: userDetail?.image ?? null,
      level: userDetail?.level ?? 0,
      postsThisWeek: tu._count.id,
    };
  });

  // Calculate avg win rate
  const totalSettled = totalWins + totalLosses;
  const avgWinRate = totalSettled > 0 ? (totalWins / totalSettled) * 100 : 0;

  // Format level distribution (ensure all levels from -5 to 10 are represented)
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
        day: volumeDay._sum.entryMcap ?? 0,
        week: volumeWeek._sum.entryMcap ?? 0,
        month: volumeMonth._sum.entryMcap ?? 0,
        allTime: volumeAllTime._sum.entryMcap ?? 0,
      },
      alphas: {
        today: alphasToday,
        week: alphasWeek,
        month: alphasMonth,
        total: alphasTotal,
      },
      avgWinRate: Math.round(avgWinRate * 100) / 100,
      activeUsers: {
        today: activeUsersToday.length,
        week: activeUsersWeek.length,
      },
      totalUsers,
      levelDistribution: formattedLevelDist,
      topUsersThisWeek: topUsersWithDetails,
    };

    statsCache = {
      data,
      expiresAtMs: Date.now() + LEADERBOARD_STATS_CACHE_TTL_MS,
    };
    return data;
  })();

  try {
    const data = await statsInFlight;
    return c.json({ data });
  } finally {
    statsInFlight = null;
  }
});
