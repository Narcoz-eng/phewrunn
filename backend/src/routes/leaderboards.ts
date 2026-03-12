import { Hono } from "hono";
import { type AuthVariables } from "../auth.js";
import { cacheGetJson, cacheSetJson } from "../lib/redis.js";
import {
  type FirstCallerLeaderboardRow,
  type LeaderboardsPayload,
  listDailyLeaderboards,
  listFirstCallerLeaderboards,
} from "../services/intelligence/engine.js";

export const leaderboardsRouter = new Hono<{ Variables: AuthVariables }>();

type RouteCacheEntry<T> = {
  data: T;
  expiresAtMs: number;
};

const LEADERBOARDS_ROUTE_CACHE_TTL_MS = process.env.NODE_ENV === "production" ? 5 * 60_000 : 20_000;
const DAILY_LEADERBOARDS_ROUTE_CACHE_KEY = "route:leaderboards:daily";
const FIRST_CALLERS_ROUTE_CACHE_KEY = "route:leaderboards:first-callers";
const dailyLeaderboardsRouteCache = new Map<string, RouteCacheEntry<LeaderboardsPayload>>();
const firstCallersRouteCache = new Map<string, RouteCacheEntry<FirstCallerLeaderboardRow[]>>();

function readRouteCache<T>(cache: Map<string, RouteCacheEntry<T>>, key: string): T | null {
  const cached = cache.get(key);
  if (!cached) return null;
  if (cached.expiresAtMs <= Date.now()) {
    cache.delete(key);
    return null;
  }
  return cached.data;
}

function writeRouteCache<T>(cache: Map<string, RouteCacheEntry<T>>, key: string, data: T): void {
  cache.set(key, {
    data,
    expiresAtMs: Date.now() + LEADERBOARDS_ROUTE_CACHE_TTL_MS,
  });
}

async function readBestEffortRouteCache<T>(
  cache: Map<string, RouteCacheEntry<T>>,
  key: string
): Promise<T | null> {
  const local = readRouteCache(cache, key);
  if (local) {
    return local;
  }

  const redisCached = await cacheGetJson<T>(key);
  if (redisCached) {
    writeRouteCache(cache, key, redisCached);
    return redisCached;
  }

  return null;
}

function writeBestEffortRouteCache<T>(
  cache: Map<string, RouteCacheEntry<T>>,
  key: string,
  data: T
): void {
  writeRouteCache(cache, key, data);
  void cacheSetJson(key, data, LEADERBOARDS_ROUTE_CACHE_TTL_MS);
}

function isMeaningfulDailyLeaderboards(data: LeaderboardsPayload): boolean {
  return (
    data.topTradersToday.length > 0 ||
    data.topAlphaToday.length > 0 ||
    data.biggestRoiToday.length > 0 ||
    data.bestEntryToday.length > 0
  );
}

function buildLeaderboardRouteHeaders(): Record<string, string> {
  return {
    "cache-control": process.env.NODE_ENV === "production"
      ? "public, max-age=30, s-maxage=60, stale-while-revalidate=300"
      : "no-store",
  };
}

leaderboardsRouter.get("/daily", async (c) => {
  const cached = await readBestEffortRouteCache(dailyLeaderboardsRouteCache, DAILY_LEADERBOARDS_ROUTE_CACHE_KEY);
  try {
    const viewer = c.get("user");
    const liveData = await listDailyLeaderboards(viewer?.id ?? null);
    const data = isMeaningfulDailyLeaderboards(liveData) ? liveData : cached ?? liveData;
    if (isMeaningfulDailyLeaderboards(data)) {
      writeBestEffortRouteCache(dailyLeaderboardsRouteCache, DAILY_LEADERBOARDS_ROUTE_CACHE_KEY, data);
    }
    return c.json({ data }, 200, buildLeaderboardRouteHeaders());
  } catch (error) {
    if (cached) {
      console.warn("[leaderboards] serving stale daily route cache", {
        message: error instanceof Error ? error.message : String(error),
      });
      return c.json({ data: cached }, 200, buildLeaderboardRouteHeaders());
    }
    throw error;
  }
});

leaderboardsRouter.get("/first-callers", async (c) => {
  const cached = await readBestEffortRouteCache(firstCallersRouteCache, FIRST_CALLERS_ROUTE_CACHE_KEY);
  try {
    const viewer = c.get("user");
    const liveData = await listFirstCallerLeaderboards(viewer?.id ?? null);
    const data = liveData.length > 0 ? liveData : cached ?? liveData;
    if (data.length > 0) {
      writeBestEffortRouteCache(firstCallersRouteCache, FIRST_CALLERS_ROUTE_CACHE_KEY, data);
    }
    return c.json({ data }, 200, buildLeaderboardRouteHeaders());
  } catch (error) {
    if (cached) {
      console.warn("[leaderboards] serving stale first-callers route cache", {
        message: error instanceof Error ? error.message : String(error),
      });
      return c.json({ data: cached }, 200, buildLeaderboardRouteHeaders());
    }
    throw error;
  }
});
