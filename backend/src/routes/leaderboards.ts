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
  staleUntilMs: number;
};

const LEADERBOARDS_ROUTE_CACHE_TTL_MS = process.env.NODE_ENV === "production" ? 5 * 60_000 : 20_000;
const LEADERBOARDS_ROUTE_STALE_FALLBACK_MS =
  process.env.NODE_ENV === "production" ? 30 * 60_000 : 2 * 60_000;
const DAILY_LEADERBOARDS_ROUTE_CACHE_KEY = "route:leaderboards:daily:v3";
const FIRST_CALLERS_ROUTE_CACHE_KEY = "route:leaderboards:first-callers:v2";
const dailyLeaderboardsRouteCache = new Map<string, RouteCacheEntry<LeaderboardsPayload>>();
const firstCallersRouteCache = new Map<string, RouteCacheEntry<FirstCallerLeaderboardRow[]>>();
const dailyLeaderboardsInFlight = new Map<string, Promise<LeaderboardsPayload>>();
const firstCallersInFlight = new Map<string, Promise<FirstCallerLeaderboardRow[]>>();

function readRouteCache<T>(
  cache: Map<string, RouteCacheEntry<T>>,
  key: string,
  opts?: { allowStale?: boolean }
): T | null {
  const cached = cache.get(key);
  if (!cached) return null;
  const now = Date.now();
  if (cached.expiresAtMs > now) {
    return cached.data;
  }
  if (opts?.allowStale && cached.staleUntilMs > now) {
    return cached.data;
  }
  if (cached.staleUntilMs <= now) {
    cache.delete(key);
  }
  return null;
}

function writeRouteCache<T>(cache: Map<string, RouteCacheEntry<T>>, key: string, data: T): void {
  const now = Date.now();
  cache.set(key, {
    data,
    expiresAtMs: now + LEADERBOARDS_ROUTE_CACHE_TTL_MS,
    staleUntilMs: now + LEADERBOARDS_ROUTE_STALE_FALLBACK_MS,
  });
}

async function readBestEffortRouteCache<T>(
  cache: Map<string, RouteCacheEntry<T>>,
  key: string,
  opts?: { allowStale?: boolean }
): Promise<T | null> {
  const local = readRouteCache(cache, key, opts);
  if (local) {
    return local;
  }

  const redisRaw = await cacheGetJson<unknown>(key);
  const envelope =
    redisRaw &&
    typeof redisRaw === "object" &&
    !Array.isArray(redisRaw) &&
    "data" in redisRaw
      ? (redisRaw as { data?: T; cachedAt?: unknown })
      : null;
  const redisCached = envelope?.data ?? (redisRaw as T | null);
  const cachedAtMs =
    envelope && typeof envelope.cachedAt === "number" && Number.isFinite(envelope.cachedAt)
      ? envelope.cachedAt
      : Date.now() - LEADERBOARDS_ROUTE_CACHE_TTL_MS;

  if (redisCached) {
    if (!opts?.allowStale && Date.now() - cachedAtMs > LEADERBOARDS_ROUTE_CACHE_TTL_MS) {
      return null;
    }
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
  void cacheSetJson(
    key,
    {
      data,
      cachedAt: Date.now(),
    },
    LEADERBOARDS_ROUTE_STALE_FALLBACK_MS
  );
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
  const staleCached =
    cached ??
    (await readBestEffortRouteCache(dailyLeaderboardsRouteCache, DAILY_LEADERBOARDS_ROUTE_CACHE_KEY, {
      allowStale: true,
    }));
  const inFlight = dailyLeaderboardsInFlight.get(DAILY_LEADERBOARDS_ROUTE_CACHE_KEY);
  const refresh = async (): Promise<LeaderboardsPayload> => {
    const viewer = c.get("user");
    const liveData = await listDailyLeaderboards(viewer?.id ?? null);
    const data = isMeaningfulDailyLeaderboards(liveData) ? liveData : staleCached ?? liveData;
    if (isMeaningfulDailyLeaderboards(data)) {
      writeBestEffortRouteCache(dailyLeaderboardsRouteCache, DAILY_LEADERBOARDS_ROUTE_CACHE_KEY, data);
    }
    return data;
  };

  if (cached) {
    return c.json({ data: cached }, 200, buildLeaderboardRouteHeaders());
  }

  if (staleCached) {
    if (!inFlight) {
      let trackedRequest: Promise<LeaderboardsPayload>;
      trackedRequest = refresh().finally(() => {
        if (dailyLeaderboardsInFlight.get(DAILY_LEADERBOARDS_ROUTE_CACHE_KEY) === trackedRequest) {
          dailyLeaderboardsInFlight.delete(DAILY_LEADERBOARDS_ROUTE_CACHE_KEY);
        }
      });
      dailyLeaderboardsInFlight.set(DAILY_LEADERBOARDS_ROUTE_CACHE_KEY, trackedRequest);
    }
    return c.json({ data: staleCached }, 200, buildLeaderboardRouteHeaders());
  }

  try {
    let request = inFlight;
    if (!request) {
      let trackedRequest: Promise<LeaderboardsPayload>;
      trackedRequest = refresh().finally(() => {
        if (dailyLeaderboardsInFlight.get(DAILY_LEADERBOARDS_ROUTE_CACHE_KEY) === trackedRequest) {
          dailyLeaderboardsInFlight.delete(DAILY_LEADERBOARDS_ROUTE_CACHE_KEY);
        }
      });
      request = trackedRequest;
    }
    if (!inFlight) {
      dailyLeaderboardsInFlight.set(DAILY_LEADERBOARDS_ROUTE_CACHE_KEY, request);
    }
    const data = await request;
    return c.json({ data }, 200, buildLeaderboardRouteHeaders());
  } catch (error) {
    if (staleCached) {
      console.warn("[leaderboards] serving stale daily route cache", {
        message: error instanceof Error ? error.message : String(error),
      });
      return c.json({ data: staleCached }, 200, buildLeaderboardRouteHeaders());
    }
    throw error;
  }
});

leaderboardsRouter.get("/first-callers", async (c) => {
  const cached = await readBestEffortRouteCache(firstCallersRouteCache, FIRST_CALLERS_ROUTE_CACHE_KEY);
  const staleCached =
    cached ??
    (await readBestEffortRouteCache(firstCallersRouteCache, FIRST_CALLERS_ROUTE_CACHE_KEY, {
      allowStale: true,
    }));
  const inFlight = firstCallersInFlight.get(FIRST_CALLERS_ROUTE_CACHE_KEY);
  const refresh = async (): Promise<FirstCallerLeaderboardRow[]> => {
    const viewer = c.get("user");
    const liveData = await listFirstCallerLeaderboards(viewer?.id ?? null);
    const data = liveData.length > 0 ? liveData : staleCached ?? liveData;
    if (data.length > 0) {
      writeBestEffortRouteCache(firstCallersRouteCache, FIRST_CALLERS_ROUTE_CACHE_KEY, data);
    }
    return data;
  };

  if (cached) {
    return c.json({ data: cached }, 200, buildLeaderboardRouteHeaders());
  }

  if (staleCached) {
    if (!inFlight) {
      let trackedRequest: Promise<FirstCallerLeaderboardRow[]>;
      trackedRequest = refresh().finally(() => {
        if (firstCallersInFlight.get(FIRST_CALLERS_ROUTE_CACHE_KEY) === trackedRequest) {
          firstCallersInFlight.delete(FIRST_CALLERS_ROUTE_CACHE_KEY);
        }
      });
      firstCallersInFlight.set(FIRST_CALLERS_ROUTE_CACHE_KEY, trackedRequest);
    }
    return c.json({ data: staleCached }, 200, buildLeaderboardRouteHeaders());
  }

  try {
    let request = inFlight;
    if (!request) {
      let trackedRequest: Promise<FirstCallerLeaderboardRow[]>;
      trackedRequest = refresh().finally(() => {
        if (firstCallersInFlight.get(FIRST_CALLERS_ROUTE_CACHE_KEY) === trackedRequest) {
          firstCallersInFlight.delete(FIRST_CALLERS_ROUTE_CACHE_KEY);
        }
      });
      request = trackedRequest;
    }
    if (!inFlight) {
      firstCallersInFlight.set(FIRST_CALLERS_ROUTE_CACHE_KEY, request);
    }
    const data = await request;
    return c.json({ data }, 200, buildLeaderboardRouteHeaders());
  } catch (error) {
    if (staleCached) {
      console.warn("[leaderboards] serving stale first-callers route cache", {
        message: error instanceof Error ? error.message : String(error),
      });
      return c.json({ data: staleCached }, 200, buildLeaderboardRouteHeaders());
    }
    throw error;
  }
});
