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

export const leaderboardRouter = new Hono<{ Variables: AuthVariables & { requestId?: string } }>();

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

type LeaderboardStatsPayload = {
  volume: {
    day: number;
    week: number;
    month: number;
    allTime: number;
  };
  alphas: {
    today: number;
    week: number;
    month: number;
    total: number;
  };
  avgWinRate: number;
  activeUsers: {
    today: number;
    week: number;
  };
  totalUsers: number;
  levelDistribution: Array<{
    level: number;
    count: number;
  }>;
  topUsersThisWeek: Array<{
    id: string;
    name: string | null;
    username: string | null;
    image: string | null;
    level: number;
    postsThisWeek: number;
  }>;
};

const DAILY_GAINERS_CACHE_TTL_MS = process.env.NODE_ENV === "production" ? 5 * 60_000 : 10_000;
const TOP_USERS_CACHE_TTL_MS = process.env.NODE_ENV === "production" ? 5 * 60_000 : 15_000;
const LEADERBOARD_STATS_CACHE_TTL_MS = process.env.NODE_ENV === "production" ? 5 * 60_000 : 30_000;
const LEADERBOARD_STATS_STALE_REVALIDATE_MS =
  process.env.NODE_ENV === "production" ? 20 * 60_000 : 3 * 60_000;
const LEADERBOARD_QUERY_TIMEOUT_MS = process.env.NODE_ENV === "production" ? 4_000 : 6_000;
const LEADERBOARD_CACHE_VERSION_KEY = "leaderboard:cache-version";
const LEADERBOARD_STATS_SNAPSHOT_KEY = "leaderboard:stats";
const ALPHA_SCORE_BUCKET_SECONDS = 6 * 60 * 60;
const LEADERBOARD_BUCKET_SECONDS_SQL = Prisma.raw(String(ALPHA_SCORE_BUCKET_SECONDS));
let leaderboardCacheVersionMemory = 1;
let leaderboardCacheVersionReadCache: { value: number; expiresAtMs: number } | null = null;

let dailyGainersCache: CacheEntry<Array<unknown>> | null = null;
let dailyGainersInFlight: Promise<Array<unknown>> | null = null;
const topUsersCache = new Map<string, CacheEntry<TopUsersResponsePayload>>();
const topUsersInFlight = new Map<string, Promise<TopUsersResponsePayload>>();
let statsCache: CacheEntry<LeaderboardStatsPayload> | null = null;
let statsInFlight: Promise<LeaderboardStatsPayload> | null = null;
const LEADERBOARD_DEGRADED_CACHE_TTL_MS =
  process.env.NODE_ENV === "production" ? 20_000 : 5_000;
const LEADERBOARD_CONTRACT_KEY_EXPR = Prisma.sql`
  COALESCE(p."contractAddress", CONCAT('__post__:', p.id))
`;
const LEADERBOARD_TIME_BUCKET_EXPR = Prisma.sql`
  FLOOR(EXTRACT(EPOCH FROM p."createdAt") / ${LEADERBOARD_BUCKET_SECONDS_SQL})
`;

const LEADERBOARD_DEDUPED_POSTS_SUBQUERY = Prisma.sql`
  SELECT DISTINCT ON (
    p."authorId",
    ${LEADERBOARD_CONTRACT_KEY_EXPR},
    ${LEADERBOARD_TIME_BUCKET_EXPR}
  )
    p.id,
    p."authorId",
    p."contractAddress",
    p."tokenName",
    p."tokenSymbol",
    p."tokenImage",
    p."entryMcap",
    p."currentMcap",
    p."mcap1h",
    p."mcap6h",
    p."percentChange1h",
    p."percentChange6h",
    p."settledAt",
    p."createdAt",
    p.settled,
    p."isWin"
  FROM "Post" p
  ORDER BY
    p."authorId",
    ${LEADERBOARD_CONTRACT_KEY_EXPR},
    ${LEADERBOARD_TIME_BUCKET_EXPR},
    p."createdAt" ASC,
    p.id ASC
`;
const LEADERBOARD_POSTS_CTE = Prisma.sql`
  WITH leaderboard_posts AS MATERIALIZED (${LEADERBOARD_DEDUPED_POSTS_SUBQUERY})
`;

const EMPTY_LEADERBOARD_STATS_PAYLOAD: LeaderboardStatsPayload = {
  volume: {
    day: 0,
    week: 0,
    month: 0,
    allTime: 0,
  },
  alphas: {
    today: 0,
    week: 0,
    month: 0,
    total: 0,
  },
  avgWinRate: 0,
  activeUsers: {
    today: 0,
    week: 0,
  },
  totalUsers: 0,
  levelDistribution: [],
  topUsersThisWeek: [],
};

function buildEmptyTopUsersResponse(page: number, limit: number): TopUsersResponsePayload {
  return {
    data: [],
    pagination: {
      page,
      limit,
      total: 0,
      totalPages: 0,
    },
  };
}

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

function buildLeaderboardRouteHeaders(): Record<string, string> {
  return {
    "Cache-Control": process.env.NODE_ENV === "production"
      ? "public, max-age=30, s-maxage=300, stale-while-revalidate=600"
      : "no-store",
  };
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

type LeaderboardTraceContext = {
  endpoint: string;
  requestId?: string | null;
};

function serializeLeaderboardQueryParam(value: unknown): unknown {
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (typeof value === "bigint") {
    return value.toString();
  }
  if (value instanceof Prisma.Decimal) {
    return value.toString();
  }
  if (Array.isArray(value)) {
    return value.map((entry) => serializeLeaderboardQueryParam(entry));
  }
  if (value === undefined) {
    return "__undefined__";
  }
  return value;
}

function getLeaderboardErrorCode(error: unknown): string | null {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof (error as { code?: unknown }).code === "string"
  ) {
    return (error as { code: string }).code;
  }
  return null;
}

function getLeaderboardErrorMeta(error: unknown): unknown {
  if (
    typeof error === "object" &&
    error !== null &&
    "meta" in error
  ) {
    return (error as { meta?: unknown }).meta ?? null;
  }
  return null;
}

async function executeLeaderboardRawQuery<T>(
  trace: LeaderboardTraceContext,
  label: string,
  query: Prisma.Sql
): Promise<T> {
  try {
    return await withLeaderboardTimeout(prisma.$queryRaw<T>(query), label);
  } catch (error) {
    console.warn("[leaderboard/raw] query failed", {
      endpoint: trace.endpoint,
      requestId: trace.requestId ?? null,
      label,
      sqlTemplate: typeof query.text === "string" ? query.text : query.sql,
      params: Array.isArray(query.values)
        ? query.values.map((value) => serializeLeaderboardQueryParam(value))
        : [],
      message: getErrorMessage(error),
      code: getLeaderboardErrorCode(error),
      meta: getLeaderboardErrorMeta(error),
    });
    throw error;
  }
}

async function resolveLeaderboardTotalCount(
  trace: LeaderboardTraceContext,
  rows: Array<{ totalCount?: number | bigint | null }>,
  skip: number,
  fallbackLabel: string,
  fallbackQuery: Prisma.Sql
): Promise<number> {
  if (rows.length > 0) {
    return Math.max(0, Math.round(toSafeNumber(rows[0]?.totalCount ?? 0)));
  }

  if (skip <= 0) {
    return 0;
  }

  const totalRows = await executeLeaderboardRawQuery<Array<{ count: number | bigint | null }>>(
    trace,
    fallbackLabel,
    fallbackQuery
  );

  return Math.max(0, Math.round(toSafeNumber(totalRows[0]?.count ?? 0)));
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

function asLeaderboardStatsPayload(value: Prisma.JsonValue | null): LeaderboardStatsPayload | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as unknown as LeaderboardStatsPayload;
}

function writeLeaderboardStatsLocalCache(data: LeaderboardStatsPayload): void {
  statsCache = {
    data,
    expiresAtMs: Date.now() + LEADERBOARD_STATS_CACHE_TTL_MS,
  };
}

function hydrateLeaderboardStatsCaches(redisKey: string, data: LeaderboardStatsPayload): void {
  writeLeaderboardStatsLocalCache(data);
  void cacheSetJson(redisKey, data, LEADERBOARD_STATS_CACHE_TTL_MS);
}

async function persistLeaderboardStats(
  cacheVersion: number,
  redisKey: string,
  data: LeaderboardStatsPayload
): Promise<void> {
  hydrateLeaderboardStatsCaches(redisKey, data);

  const now = new Date();
  const expiresAt = new Date(now.getTime() + LEADERBOARD_STATS_CACHE_TTL_MS);

  try {
    await prisma.aggregateSnapshot.upsert({
      where: { key: LEADERBOARD_STATS_SNAPSHOT_KEY },
      create: {
        key: LEADERBOARD_STATS_SNAPSHOT_KEY,
        version: cacheVersion,
        payload: data as Prisma.InputJsonValue,
        capturedAt: now,
        expiresAt,
      },
      update: {
        version: cacheVersion,
        payload: data as Prisma.InputJsonValue,
        capturedAt: now,
        expiresAt,
      },
    });
  } catch (error) {
    console.warn("[leaderboard] stats snapshot persistence failed", {
      message: getErrorMessage(error),
    });
  }
}

async function readLeaderboardStatsSnapshot(
  cacheVersion: number
): Promise<{ fresh: LeaderboardStatsPayload | null; stale: LeaderboardStatsPayload | null }> {
  try {
    const snapshot = await prisma.aggregateSnapshot.findUnique({
      where: { key: LEADERBOARD_STATS_SNAPSHOT_KEY },
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

    const payload = asLeaderboardStatsPayload(snapshot.payload);
    if (!payload) {
      return { fresh: null, stale: null };
    }

    const now = Date.now();
    const isFresh = snapshot.version === cacheVersion && snapshot.expiresAt.getTime() > now;
    if (isFresh) {
      return { fresh: payload, stale: payload };
    }

    const isUsableStale =
      snapshot.capturedAt.getTime() + LEADERBOARD_STATS_STALE_REVALIDATE_MS > now;
    return {
      fresh: null,
      stale: isUsableStale ? payload : null,
    };
  } catch (error) {
    console.warn("[leaderboard] stats snapshot read failed", {
      message: getErrorMessage(error),
    });
    return { fresh: null, stale: null };
  }
}

async function computeLeaderboardStatsPayload(
  trace: LeaderboardTraceContext
): Promise<LeaderboardStatsPayload> {
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

  type LevelDistributionRow = {
    level: number | null;
    count: bigint | number | string | Prisma.Decimal | null;
  };

  const [summaryRows, levelDistribution, topUsersThisWeek] = await Promise.all([
    executeLeaderboardRawQuery<StatsSummaryRow[]>(
      trace,
      "leaderboard.stats.summary",
      Prisma.sql`
        ${LEADERBOARD_POSTS_CTE}
        SELECT
          COALESCE(SUM(p."entryMcap") FILTER (WHERE p."createdAt" >= ${oneDayAgo} AND p."entryMcap" IS NOT NULL), 0) AS "volumeDay",
          COALESCE(SUM(p."entryMcap") FILTER (WHERE p."createdAt" >= ${oneWeekAgo} AND p."entryMcap" IS NOT NULL), 0) AS "volumeWeek",
          COALESCE(SUM(p."entryMcap") FILTER (WHERE p."createdAt" >= ${oneMonthAgo} AND p."entryMcap" IS NOT NULL), 0) AS "volumeMonth",
          COALESCE(SUM(p."entryMcap") FILTER (WHERE p."entryMcap" IS NOT NULL), 0) AS "volumeAllTime",
          COUNT(*) FILTER (WHERE p."createdAt" >= ${oneDayAgo})::bigint AS "alphasToday",
          COUNT(*) FILTER (WHERE p."createdAt" >= ${oneWeekAgo})::bigint AS "alphasWeek",
          COUNT(*) FILTER (WHERE p."createdAt" >= ${oneMonthAgo})::bigint AS "alphasMonth",
          COUNT(*)::bigint AS "alphasTotal",
          COUNT(*) FILTER (WHERE p.settled = true AND p."isWin" = true)::bigint AS "totalWins",
          COUNT(*) FILTER (WHERE p.settled = true AND p."isWin" = false)::bigint AS "totalLosses",
          COUNT(DISTINCT p."authorId") FILTER (WHERE p."createdAt" >= ${oneDayAgo})::bigint AS "activeUsersToday",
          COUNT(DISTINCT p."authorId") FILTER (WHERE p."createdAt" >= ${oneWeekAgo})::bigint AS "activeUsersWeek",
          (SELECT COUNT(*)::bigint FROM "User") AS "totalUsers"
        FROM leaderboard_posts p
      `
    ),
    executeLeaderboardRawQuery<LevelDistributionRow[]>(
      trace,
      "leaderboard.stats.level-distribution",
      Prisma.sql`
        SELECT
          u.level,
          COUNT(*)::bigint AS count
        FROM "User" u
        GROUP BY u.level
        ORDER BY u.level ASC
      `
    ),
    executeLeaderboardRawQuery<Array<{
        id: string;
        name: string | null;
        username: string | null;
        image: string | null;
        level: number | null;
        postsThisWeek: bigint | number | string | Prisma.Decimal | null;
      }>>(
      trace,
      "leaderboard.stats.top-users-week",
      Prisma.sql`
        ${LEADERBOARD_POSTS_CTE}
        SELECT
          u.id,
          u.name,
          u.username,
          u.image,
          u.level,
          COUNT(*)::bigint AS "postsThisWeek"
        FROM leaderboard_posts p
        JOIN "User" u ON u.id = p."authorId"
        WHERE p."createdAt" >= ${oneWeekAgo}
        GROUP BY u.id, u.name, u.username, u.image, u.level
        ORDER BY COUNT(*) DESC
        LIMIT 5
      `
    ),
  ]);

  const summary = summaryRows[0];
  const totalWins = toSafeNumber(summary?.totalWins ?? 0);
  const totalLosses = toSafeNumber(summary?.totalLosses ?? 0);
  const totalSettled = totalWins + totalLosses;
  const avgWinRate = totalSettled > 0 ? (totalWins / totalSettled) * 100 : 0;

  const levelDistMap = new Map<number, number>();
  levelDistribution.forEach((ld) => {
    levelDistMap.set(
      Math.max(MIN_LEVEL, Math.min(MAX_LEVEL, Math.round(toSafeNumber(ld.level ?? 0)))),
      Math.max(0, Math.round(toSafeNumber(ld.count ?? 0)))
    );
  });

  const formattedLevelDist = [];
  for (let level = MIN_LEVEL; level <= MAX_LEVEL; level++) {
    formattedLevelDist.push({
      level,
      count: levelDistMap.get(level) ?? 0,
    });
  }

  return {
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
}

function queueLeaderboardStatsRefresh(
  cacheVersion: number,
  redisKey: string,
  trace: LeaderboardTraceContext
): Promise<LeaderboardStatsPayload> {
  if (!statsInFlight) {
    const refreshPromise = (async () => {
      const data = await computeLeaderboardStatsPayload(trace);
      await persistLeaderboardStats(cacheVersion, redisKey, data);
      return data;
    })();
    const trackedPromise = refreshPromise.finally(() => {
      if (statsInFlight === trackedPromise) {
        statsInFlight = null;
      }
    });
    statsInFlight = trackedPromise;
  }
  return statsInFlight!;
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

async function getDailyGainersRaw(trace: LeaderboardTraceContext): Promise<Array<unknown>> {
  const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const rows = await executeLeaderboardRawQuery<Array<{
      id: string;
      tokenName: string | null;
      tokenSymbol: string | null;
      tokenImage: string | null;
      contractAddress: string | null;
      entryMcap: number | null;
      currentMcap: number | null;
      mcap1h: number | null;
      mcap6h: number | null;
      percentChange1h: number | null;
      percentChange6h: number | null;
      settledAt: Date | null;
      authorId: string;
      authorName: string | null;
      authorUsername: string | null;
      authorImage: string | null;
      authorLevel: number | null;
    }>>(
    trace,
    "leaderboard.daily-gainers.raw",
    Prisma.sql`
      ${LEADERBOARD_POSTS_CTE}
      SELECT
        p.id,
        p."tokenName",
        p."tokenSymbol",
        p."tokenImage",
        p."contractAddress",
        p."entryMcap",
        p."currentMcap",
        p."mcap1h",
        p."mcap6h",
        p."percentChange1h",
        p."percentChange6h",
        p."settledAt",
        u.id AS "authorId",
        u.name AS "authorName",
        u.username AS "authorUsername",
        u.image AS "authorImage",
        u.level AS "authorLevel"
      FROM leaderboard_posts p
      JOIN "User" u ON u.id = p."authorId"
      WHERE p.settled = true
        AND p."createdAt" >= ${twentyFourHoursAgo}
        AND p."contractAddress" IS NOT NULL
        AND p."entryMcap" IS NOT NULL
        AND p."currentMcap" IS NOT NULL
        AND p."settledAt" IS NOT NULL
    `
  );

  return rows
    .map((row) => {
      if (!row.contractAddress || !row.entryMcap || !row.currentMcap) {
        return null;
      }

      const candidates: Array<{ gainPercent: number; displayMcap: number }> = [];

      if (row.mcap1h !== null && row.percentChange1h !== null) {
        candidates.push({
          gainPercent: row.percentChange1h,
          displayMcap: row.mcap1h,
        });
      }

      if (row.mcap6h !== null && row.percentChange6h !== null) {
        candidates.push({
          gainPercent: row.percentChange6h,
          displayMcap: row.mcap6h,
        });
      }

      const currentGainPercent = ((row.currentMcap - row.entryMcap) / row.entryMcap) * 100;
      candidates.push({
        gainPercent: currentGainPercent,
        displayMcap: row.currentMcap,
      });

      const bestCandidate = candidates.reduce((best, candidate) =>
        candidate.gainPercent > best.gainPercent ? candidate : best
      );

      if (!(bestCandidate.gainPercent > 0)) {
        return null;
      }

      return {
        postId: row.id,
        tokenName: row.tokenName ?? null,
        tokenSymbol: row.tokenSymbol ?? null,
        tokenImage: row.tokenImage ?? null,
        contractAddress: row.contractAddress,
        user: {
          id: row.authorId,
          name: row.authorName ?? null,
          username: row.authorUsername ?? null,
          image: row.authorImage ?? null,
          level: Math.max(0, Math.round(toSafeNumber(row.authorLevel))),
        },
        gainPercent: Math.round(bestCandidate.gainPercent * 100) / 100,
        entryMcap: toSafeNumber(row.entryMcap),
        currentMcap: toSafeNumber(bestCandidate.displayMcap),
        settledAt: row.settledAt?.toISOString() ?? new Date(0).toISOString(),
      };
    })
    .filter((row): row is NonNullable<typeof row> => row !== null)
    .sort((a, b) => b.gainPercent - a.gainPercent)
    .slice(0, 10)
    .map((row, index) => ({
      rank: index + 1,
      ...row,
    }));
}

async function getTopUsersResponseRaw(
  trace: LeaderboardTraceContext,
  sortBy: "level" | "activity" | "winrate",
  page: number,
  limit: number
): Promise<TopUsersResponsePayload> {
  const skip = (page - 1) * limit;
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const MIN_POSTS_FOR_WINRATE = 5;

  if (sortBy === "activity") {
    const rows = await executeLeaderboardRawQuery<Array<{
      id: string;
      username: string | null;
      name: string | null;
      image: string | null;
      level: number | null;
      xp: number | null;
      totalAlphas: number | bigint | null;
      recentAlphas: number | bigint | null;
      wins: number | bigint | null;
      losses: number | bigint | null;
      totalCount: number | bigint | null;
    }>>(
      trace,
      "leaderboard.top-users.activity.raw",
      Prisma.sql`
        ${LEADERBOARD_POSTS_CTE},
        recent_posts AS (
          SELECT p."authorId", COUNT(*)::bigint AS "recentAlphas"
          FROM leaderboard_posts p
          WHERE p."createdAt" >= ${sevenDaysAgo}
          GROUP BY p."authorId"
        ),
        total_posts AS (
          SELECT p."authorId", COUNT(*)::bigint AS "totalAlphas"
          FROM leaderboard_posts p
          GROUP BY p."authorId"
        ),
        win_stats AS (
          SELECT
            p."authorId",
            COUNT(*) FILTER (WHERE p."isWin" = true)::bigint AS wins,
            COUNT(*) FILTER (WHERE p."isWin" = false)::bigint AS losses
          FROM leaderboard_posts p
          WHERE p.settled = true AND p."isWin" IS NOT NULL
          GROUP BY p."authorId"
        )
        SELECT
          u.id,
          u.username,
          u.name,
          u.image,
          u.level,
          u.xp,
          COALESCE(tp."totalAlphas", 0) AS "totalAlphas",
          rp."recentAlphas",
          COALESCE(ws.wins, 0) AS wins,
          COALESCE(ws.losses, 0) AS losses,
          COUNT(*) OVER ()::bigint AS "totalCount"
        FROM recent_posts rp
        JOIN "User" u ON u.id = rp."authorId"
        LEFT JOIN total_posts tp ON tp."authorId" = u.id
        LEFT JOIN win_stats ws ON ws."authorId" = u.id
        ORDER BY rp."recentAlphas" DESC, u.level DESC, u.xp DESC, u.id ASC
        OFFSET ${skip}
        LIMIT ${limit}
      `
    );
    const total = await resolveLeaderboardTotalCount(
      trace,
      rows,
      skip,
      "leaderboard.top-users.activity.raw-total",
      Prisma.sql`
        ${LEADERBOARD_POSTS_CTE}
        SELECT COUNT(*)::bigint AS count
        FROM (
          SELECT p."authorId"
          FROM leaderboard_posts p
          WHERE p."createdAt" >= ${sevenDaysAgo}
          GROUP BY p."authorId"
        ) activity_users
      `
    );
    return {
      data: rows.map((row, index) => {
        const wins = Math.max(0, Math.round(toSafeNumber(row.wins)));
        const losses = Math.max(0, Math.round(toSafeNumber(row.losses)));
        const totalSettled = wins + losses;
        return {
          rank: skip + index + 1,
          user: {
            id: row.id,
            username: row.username ?? null,
            name: row.name ?? "Unknown",
            image: row.image ?? null,
            level: Math.max(0, Math.round(toSafeNumber(row.level))),
            xp: Math.max(0, Math.round(toSafeNumber(row.xp))),
          },
          stats: {
            totalAlphas: Math.max(0, Math.round(toSafeNumber(row.totalAlphas))),
            recentAlphas: Math.max(0, Math.round(toSafeNumber(row.recentAlphas))),
            wins,
            losses,
            winRate: totalSettled > 0 ? Math.round((wins / totalSettled) * 10000) / 100 : 0,
          },
        };
      }),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  if (sortBy === "winrate") {
    const rows = await executeLeaderboardRawQuery<Array<{
      id: string;
      username: string | null;
      name: string | null;
      image: string | null;
      level: number | null;
      xp: number | null;
      totalAlphas: number | bigint | null;
      wins: number | bigint | null;
      losses: number | bigint | null;
      totalSettled: number | bigint | null;
      winRate: number | null;
      totalCount: number | bigint | null;
    }>>(
      trace,
      "leaderboard.top-users.winrate.raw",
      Prisma.sql`
        ${LEADERBOARD_POSTS_CTE},
        total_posts AS (
          SELECT p."authorId", COUNT(*)::bigint AS "totalAlphas"
          FROM leaderboard_posts p
          GROUP BY p."authorId"
        ),
        qualified AS (
          SELECT
            p."authorId",
            COUNT(*) FILTER (WHERE p."isWin" = true)::bigint AS wins,
            COUNT(*) FILTER (WHERE p."isWin" = false)::bigint AS losses,
            COUNT(*)::bigint AS "totalSettled",
            ROUND(
              (COUNT(*) FILTER (WHERE p."isWin" = true)::numeric / NULLIF(COUNT(*), 0)::numeric) * 100,
              2
            ) AS "winRate"
          FROM leaderboard_posts p
          WHERE p.settled = true AND p."isWin" IS NOT NULL
          GROUP BY p."authorId"
          HAVING COUNT(*) >= ${MIN_POSTS_FOR_WINRATE}
        )
        SELECT
          u.id,
          u.username,
          u.name,
          u.image,
          u.level,
          u.xp,
          COALESCE(tp."totalAlphas", 0) AS "totalAlphas",
          q.wins,
          q.losses,
          q."totalSettled",
          q."winRate",
          COUNT(*) OVER ()::bigint AS "totalCount"
        FROM qualified q
        JOIN "User" u ON u.id = q."authorId"
        LEFT JOIN total_posts tp ON tp."authorId" = u.id
        ORDER BY q."winRate" DESC, q."totalSettled" DESC, u.id ASC
        OFFSET ${skip}
        LIMIT ${limit}
      `
    );
    const total = await resolveLeaderboardTotalCount(
      trace,
      rows,
      skip,
      "leaderboard.top-users.winrate.raw-total",
      Prisma.sql`
        ${LEADERBOARD_POSTS_CTE}
        SELECT COUNT(*)::bigint AS count
        FROM (
          SELECT p."authorId"
          FROM leaderboard_posts p
          WHERE p.settled = true AND p."isWin" IS NOT NULL
          GROUP BY p."authorId"
          HAVING COUNT(*) >= ${MIN_POSTS_FOR_WINRATE}
        ) qualified_users
      `
    );
    return {
      data: rows.map((row, index) => ({
        rank: skip + index + 1,
        user: {
          id: row.id,
          username: row.username ?? null,
          name: row.name ?? "Unknown",
          image: row.image ?? null,
          level: Math.max(0, Math.round(toSafeNumber(row.level))),
          xp: Math.max(0, Math.round(toSafeNumber(row.xp))),
        },
        stats: {
          totalAlphas: Math.max(0, Math.round(toSafeNumber(row.totalAlphas))),
          wins: Math.max(0, Math.round(toSafeNumber(row.wins))),
          losses: Math.max(0, Math.round(toSafeNumber(row.losses))),
          winRate: Math.round(toSafeNumber(row.winRate) * 100) / 100,
        },
      })),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  const rows = await executeLeaderboardRawQuery<Array<{
    id: string;
    username: string | null;
    name: string | null;
    image: string | null;
    level: number | null;
    xp: number | null;
    totalAlphas: number | bigint | null;
    wins: number | bigint | null;
    losses: number | bigint | null;
    totalCount: number | bigint | null;
  }>>(
    trace,
    "leaderboard.top-users.level.raw",
    Prisma.sql`
      ${LEADERBOARD_POSTS_CTE},
      post_counts AS (
        SELECT p."authorId", COUNT(*)::bigint AS "totalAlphas"
        FROM leaderboard_posts p
        GROUP BY p."authorId"
      ),
      win_stats AS (
        SELECT
          p."authorId",
          COUNT(*) FILTER (WHERE p."isWin" = true)::bigint AS wins,
          COUNT(*) FILTER (WHERE p."isWin" = false)::bigint AS losses
        FROM leaderboard_posts p
        WHERE p.settled = true AND p."isWin" IS NOT NULL
        GROUP BY p."authorId"
      )
      SELECT
        u.id,
        u.username,
        u.name,
        u.image,
        u.level,
        u.xp,
        pc."totalAlphas",
        COALESCE(ws.wins, 0) AS wins,
        COALESCE(ws.losses, 0) AS losses,
        COUNT(*) OVER ()::bigint AS "totalCount"
      FROM post_counts pc
      JOIN "User" u ON u.id = pc."authorId"
      LEFT JOIN win_stats ws ON ws."authorId" = u.id
      ORDER BY u.level DESC, u.xp DESC, u.id ASC
      OFFSET ${skip}
      LIMIT ${limit}
    `
  );
  const total = await resolveLeaderboardTotalCount(
    trace,
    rows,
    skip,
    "leaderboard.top-users.level.raw-total",
    Prisma.sql`
      ${LEADERBOARD_POSTS_CTE}
      SELECT COUNT(*)::bigint AS count
      FROM (
        SELECT p."authorId"
        FROM leaderboard_posts p
        GROUP BY p."authorId"
      ) ranked_users
    `
  );
  return {
    data: rows.map((row, index) => {
      const wins = Math.max(0, Math.round(toSafeNumber(row.wins)));
      const losses = Math.max(0, Math.round(toSafeNumber(row.losses)));
      const totalSettled = wins + losses;
      return {
        rank: skip + index + 1,
        user: {
          id: row.id,
          username: row.username ?? null,
          name: row.name ?? "Unknown",
          image: row.image ?? null,
          level: Math.max(0, Math.round(toSafeNumber(row.level))),
          xp: Math.max(0, Math.round(toSafeNumber(row.xp))),
        },
        stats: {
          totalAlphas: Math.max(0, Math.round(toSafeNumber(row.totalAlphas))),
          wins,
          losses,
          winRate: totalSettled > 0 ? Math.round((wins / totalSettled) * 10000) / 100 : 0,
        },
      };
    }),
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  };
}

/**
 * GET /api/leaderboard/daily-gainers
 * Top 10 alphas by percentage gain today (posts created in last 24 hours)
 * Filter: Only settled posts with positive percent change
 */
leaderboardRouter.get("/daily-gainers", async (c) => {
  c.header("Cache-Control", buildLeaderboardRouteHeaders()["Cache-Control"]);
  const trace = {
    endpoint: "/api/leaderboard/daily-gainers",
    requestId: c.get("requestId") ?? null,
  };
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
      dailyGainersCache = {
        data: [],
        expiresAtMs: Date.now() + LEADERBOARD_DEGRADED_CACHE_TTL_MS,
      };
      return c.json({ data: [] });
    }
  }

  dailyGainersInFlight = (async () => {
    const dailyGainers = await getDailyGainersRaw(trace);

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
    try {
      const rawData = await getDailyGainersRaw(trace);
      dailyGainersCache = {
        data: rawData,
        expiresAtMs: Date.now() + DAILY_GAINERS_CACHE_TTL_MS,
      };
      void cacheSetJson(redisKey, rawData, DAILY_GAINERS_CACHE_TTL_MS);
      return c.json({ data: rawData });
    } catch (rawError) {
      logLeaderboardFallback("daily-gainers/raw", rawError, false);
    }
    dailyGainersCache = {
      data: [],
      expiresAtMs: Date.now() + LEADERBOARD_DEGRADED_CACHE_TTL_MS,
    };
    return c.json({ data: [] });
  } finally {
    dailyGainersInFlight = null;
  }
});

// ─── Weekly Best ──────────────────────────────────────────────────────────────

let weeklyBestCache: CacheEntry<Array<unknown>> | null = null;
let weeklyBestInFlight: Promise<Array<unknown>> | null = null;
const WEEKLY_BEST_CACHE_TTL_MS = process.env.NODE_ENV === "production" ? 15 * 60_000 : 20_000;

async function getWeeklyBestRaw(trace: LeaderboardTraceContext): Promise<Array<unknown>> {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const rows = await executeLeaderboardRawQuery<Array<{
    id: string;
    tokenName: string | null;
    tokenSymbol: string | null;
    tokenImage: string | null;
    contractAddress: string | null;
    entryMcap: number | null;
    currentMcap: number | null;
    mcap1h: number | null;
    mcap6h: number | null;
    percentChange1h: number | null;
    percentChange6h: number | null;
    settledAt: Date | null;
    createdAt: Date;
    authorId: string;
    authorName: string | null;
    authorUsername: string | null;
    authorImage: string | null;
    authorLevel: number | null;
  }>>(
    trace,
    "leaderboard.weekly-best.raw",
    Prisma.sql`
      ${LEADERBOARD_POSTS_CTE}
      SELECT
        p.id,
        p."tokenName",
        p."tokenSymbol",
        p."tokenImage",
        p."contractAddress",
        p."entryMcap",
        p."currentMcap",
        p."mcap1h",
        p."mcap6h",
        p."percentChange1h",
        p."percentChange6h",
        p."settledAt",
        p."createdAt",
        u.id AS "authorId",
        u.name AS "authorName",
        u.username AS "authorUsername",
        u.image AS "authorImage",
        u.level AS "authorLevel"
      FROM leaderboard_posts p
      JOIN "User" u ON u.id = p."authorId"
      WHERE p.settled = true
        AND p."createdAt" >= ${sevenDaysAgo}
        AND p."contractAddress" IS NOT NULL
        AND p."entryMcap" IS NOT NULL
        AND p."currentMcap" IS NOT NULL
        AND p."settledAt" IS NOT NULL
    `
  );

  const mapped = rows
    .map((row) => {
      if (!row.contractAddress || !row.entryMcap || !row.currentMcap) return null;

      const candidates: Array<{ gainPercent: number; displayMcap: number }> = [];
      if (row.mcap1h !== null && row.percentChange1h !== null) {
        candidates.push({ gainPercent: row.percentChange1h, displayMcap: row.mcap1h });
      }
      if (row.mcap6h !== null && row.percentChange6h !== null) {
        candidates.push({ gainPercent: row.percentChange6h, displayMcap: row.mcap6h });
      }
      const currentGainPercent = ((row.currentMcap - row.entryMcap) / row.entryMcap) * 100;
      candidates.push({ gainPercent: currentGainPercent, displayMcap: row.currentMcap });

      const best = candidates.reduce((a, b) => (b.gainPercent > a.gainPercent ? b : a));
      if (!(best.gainPercent > 0)) return null;

      return {
        postId: row.id,
        tokenName: row.tokenName ?? null,
        tokenSymbol: row.tokenSymbol ?? null,
        tokenImage: row.tokenImage ?? null,
        contractAddress: row.contractAddress,
        user: {
          id: row.authorId,
          name: row.authorName ?? null,
          username: row.authorUsername ?? null,
          image: row.authorImage ?? null,
          level: Math.max(0, Math.round(toSafeNumber(row.authorLevel))),
        },
        gainPercent: Math.round(best.gainPercent * 100) / 100,
        entryMcap: toSafeNumber(row.entryMcap),
        peakMcap: toSafeNumber(best.displayMcap),
        createdAt: row.createdAt?.toISOString() ?? new Date(0).toISOString(),
        settledAt: row.settledAt?.toISOString() ?? new Date(0).toISOString(),
      };
    })
    .filter(Boolean);

  mapped.sort((a, b) => (b as { gainPercent: number }).gainPercent - (a as { gainPercent: number }).gainPercent);
  return mapped.slice(0, 2);
}

/**
 * GET /api/leaderboard/weekly-best
 * Top 2 alpha calls of the past 7 days by peak gain percent (public, no auth)
 */
leaderboardRouter.get("/weekly-best", async (c) => {
  c.header("Cache-Control", buildLeaderboardRouteHeaders()["Cache-Control"]);
  const trace = { endpoint: "/api/leaderboard/weekly-best", requestId: c.get("requestId") ?? null };

  const cached = readCache(weeklyBestCache);
  if (cached) return c.json({ data: cached });

  const staleCached = readStaleCache(weeklyBestCache);
  const cacheVersion = await getLeaderboardCacheVersion();
  const redisKey = buildLeaderboardRedisKey("weekly-best", cacheVersion);
  const redisCached = await cacheGetJson<Array<unknown>>(redisKey);
  if (redisCached) {
    weeklyBestCache = { data: redisCached, expiresAtMs: Date.now() + WEEKLY_BEST_CACHE_TTL_MS };
    return c.json({ data: redisCached });
  }

  if (weeklyBestInFlight) {
    try {
      const data = await weeklyBestInFlight;
      return c.json({ data });
    } catch (error) {
      logLeaderboardFallback("weekly-best/in-flight", error, Boolean(staleCached));
      if (staleCached) return c.json({ data: staleCached });
      weeklyBestCache = { data: [], expiresAtMs: Date.now() + LEADERBOARD_DEGRADED_CACHE_TTL_MS };
      return c.json({ data: [] });
    }
  }

  weeklyBestInFlight = (async () => {
    const result = await getWeeklyBestRaw(trace);
    weeklyBestCache = { data: result, expiresAtMs: Date.now() + WEEKLY_BEST_CACHE_TTL_MS };
    void cacheSetJson(redisKey, result, WEEKLY_BEST_CACHE_TTL_MS);
    return result;
  })();

  try {
    const data = await weeklyBestInFlight;
    return c.json({ data });
  } catch (error) {
    logLeaderboardFallback("weekly-best", error, Boolean(staleCached));
    if (staleCached) return c.json({ data: staleCached });
    weeklyBestCache = { data: [], expiresAtMs: Date.now() + LEADERBOARD_DEGRADED_CACHE_TTL_MS };
    return c.json({ data: [] });
  } finally {
    weeklyBestInFlight = null;
  }
});

/**
 * GET /api/leaderboard/top-users
 * Top users ranked by level, activity, or win rate
 * Query params: page, limit (default 20), sortBy (level, activity, winrate)
 */
leaderboardRouter.get("/top-users", zValidator("query", LeaderboardQuerySchema), async (c) => {
  c.header("Cache-Control", buildLeaderboardRouteHeaders()["Cache-Control"]);
  const { page, limit, sortBy } = c.req.valid("query");
  const trace = {
    endpoint: `/api/leaderboard/top-users?sortBy=${sortBy}`,
    requestId: c.get("requestId") ?? null,
  };
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
  const inFlight = topUsersInFlight.get(topUsersCacheKey);
  if (inFlight) {
    try {
      const data = await inFlight;
      return c.json(data);
    } catch (error) {
      logLeaderboardFallback(`top-users/in-flight:${sortBy}`, error, Boolean(staleCached));
      if (staleCached) {
        return c.json(staleCached);
      }
      const fallbackPayload = buildEmptyTopUsersResponse(page, limit);
      topUsersCache.set(topUsersCacheKey, {
        data: fallbackPayload,
        expiresAtMs: Date.now() + LEADERBOARD_DEGRADED_CACHE_TTL_MS,
      });
      return c.json(fallbackPayload);
    }
  }
  try {
    const responsePromise = withLeaderboardTimeout(
      getTopUsersResponseRaw(trace, sortBy, page, limit),
      "leaderboard.top-users"
    );
    topUsersInFlight.set(topUsersCacheKey, responsePromise);
    const responsePayload = await responsePromise;

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
    const fallbackPayload = buildEmptyTopUsersResponse(page, limit);
    topUsersCache.set(topUsersCacheKey, {
      data: fallbackPayload,
      expiresAtMs: Date.now() + LEADERBOARD_DEGRADED_CACHE_TTL_MS,
    });
    return c.json(fallbackPayload);
  } finally {
    topUsersInFlight.delete(topUsersCacheKey);
  }
});

/**
 * GET /api/leaderboard/stats
 * Platform-wide statistics
 */
leaderboardRouter.get("/stats", async (c) => {
  c.header("Cache-Control", buildLeaderboardRouteHeaders()["Cache-Control"]);
  const trace = {
    endpoint: "/api/leaderboard/stats",
    requestId: c.get("requestId") ?? null,
  };
  const cacheVersion = await getLeaderboardCacheVersion();
  const cached = readCache(statsCache);
  if (cached) {
    return c.json({ data: cached });
  }
  const staleCached = readStaleCache(statsCache);
  const redisKey = buildLeaderboardRedisKey("stats", cacheVersion);
  const redisCached = await cacheGetJson<LeaderboardStatsPayload>(redisKey);
  if (redisCached) {
    writeLeaderboardStatsLocalCache(redisCached);
    return c.json({ data: redisCached });
  }
  const snapshotCached = await readLeaderboardStatsSnapshot(cacheVersion);
  if (snapshotCached.fresh) {
    hydrateLeaderboardStatsCaches(redisKey, snapshotCached.fresh);
    return c.json({ data: snapshotCached.fresh });
  }

  const snapshotFallback = snapshotCached.stale;
  if (snapshotFallback) {
    void queueLeaderboardStatsRefresh(cacheVersion, redisKey, trace).catch((error) => {
      logLeaderboardFallback("stats/background-refresh", error, true);
    });
    return c.json({ data: snapshotFallback });
  }

  if (!statsInFlight) {
    queueLeaderboardStatsRefresh(cacheVersion, redisKey, trace);
  }

  try {
    const data = await statsInFlight!;
    return c.json({ data });
  } catch (error) {
    logLeaderboardFallback("stats", error, Boolean(staleCached));
    if (staleCached) {
      return c.json({ data: staleCached });
    }
    statsCache = {
      data: EMPTY_LEADERBOARD_STATS_PAYLOAD,
      expiresAtMs: Date.now() + LEADERBOARD_DEGRADED_CACHE_TTL_MS,
    };
    return c.json({ data: EMPTY_LEADERBOARD_STATS_PAYLOAD });
  }
});
