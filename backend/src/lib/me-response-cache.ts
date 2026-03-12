import { cacheGetJson, cacheSetJson, redisDelete } from "./redis.js";

const ME_RESPONSE_CACHE_TTL_MS = process.env.NODE_ENV === "production" ? 5 * 60_000 : 30_000;
const ME_RESPONSE_STALE_FALLBACK_MS =
  process.env.NODE_ENV === "production" ? 60 * 60_000 : 10 * 60_000;
const ME_RESPONSE_CACHE_MAX_ENTRIES = process.env.NODE_ENV === "production" ? 20_000 : 2_000;
const ME_RESPONSE_REDIS_KEY_PREFIX = "me-response:v1";

export type MeResponseUser = {
  id: string;
  name: string;
  email: string;
  image: string | null;
  walletAddress: string | null;
  username: string | null;
  level: number;
  xp: number;
  bio: string | null;
  isAdmin: boolean;
  isVerified: boolean;
  tradeFeeRewardsEnabled: boolean;
  tradeFeeShareBps: number;
  tradeFeePayoutAddress: string | null;
  createdAt: Date;
};

const meResponseCache = new Map<
  string,
  {
    data: MeResponseUser;
    expiresAtMs: number;
    staleUntilMs: number;
  }
>();

function buildMeResponseRedisKey(userId: string): string {
  return `${ME_RESPONSE_REDIS_KEY_PREFIX}:${userId}`;
}

function writeLocalMeResponseCache(userId: string, data: MeResponseUser): void {
  if (meResponseCache.has(userId)) {
    meResponseCache.delete(userId);
  }

  if (meResponseCache.size >= ME_RESPONSE_CACHE_MAX_ENTRIES) {
    const oldestKey = meResponseCache.keys().next().value;
    if (typeof oldestKey === "string") {
      meResponseCache.delete(oldestKey);
    }
  }

  const nowMs = Date.now();
  meResponseCache.set(userId, {
    data,
    expiresAtMs: nowMs + ME_RESPONSE_CACHE_TTL_MS,
    staleUntilMs: nowMs + ME_RESPONSE_STALE_FALLBACK_MS,
  });
}

function normalizeCachedMeResponse(data: unknown): MeResponseUser | null {
  if (!data || typeof data !== "object") return null;
  const candidate = data as Record<string, unknown>;
  if (
    typeof candidate.id !== "string" ||
    typeof candidate.name !== "string" ||
    typeof candidate.email !== "string" ||
    typeof candidate.level !== "number" ||
    typeof candidate.xp !== "number" ||
    typeof candidate.isAdmin !== "boolean" ||
    typeof candidate.isVerified !== "boolean" ||
    typeof candidate.tradeFeeRewardsEnabled !== "boolean" ||
    typeof candidate.tradeFeeShareBps !== "number"
  ) {
    return null;
  }

  const createdAt =
    candidate.createdAt instanceof Date
      ? candidate.createdAt
      : new Date(typeof candidate.createdAt === "string" ? candidate.createdAt : "");
  if (Number.isNaN(createdAt.getTime())) {
    return null;
  }

  return {
    id: candidate.id,
    name: candidate.name,
    email: candidate.email,
    image: typeof candidate.image === "string" ? candidate.image : null,
    walletAddress: typeof candidate.walletAddress === "string" ? candidate.walletAddress : null,
    username: typeof candidate.username === "string" ? candidate.username : null,
    level: candidate.level,
    xp: candidate.xp,
    bio: typeof candidate.bio === "string" ? candidate.bio : null,
    isAdmin: candidate.isAdmin,
    isVerified: candidate.isVerified,
    tradeFeeRewardsEnabled: candidate.tradeFeeRewardsEnabled,
    tradeFeeShareBps: candidate.tradeFeeShareBps,
    tradeFeePayoutAddress:
      typeof candidate.tradeFeePayoutAddress === "string" ? candidate.tradeFeePayoutAddress : null,
    createdAt,
  };
}

function normalizeCachedMeResponseEnvelope(
  data: unknown
): { data: MeResponseUser; cachedAtMs: number } | null {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return null;
  }

  const candidate = data as {
    data?: unknown;
    cachedAt?: unknown;
  };
  const normalized = normalizeCachedMeResponse(candidate.data);
  if (!normalized) {
    return null;
  }

  const cachedAtMs =
    typeof candidate.cachedAt === "number" && Number.isFinite(candidate.cachedAt)
      ? candidate.cachedAt
      : Date.now() - ME_RESPONSE_CACHE_TTL_MS;

  return {
    data: normalized,
    cachedAtMs,
  };
}

export async function readCachedMeResponse(
  userId: string,
  opts?: { allowStale?: boolean }
): Promise<MeResponseUser | null> {
  const nowMs = Date.now();
  const cached = meResponseCache.get(userId);
  if (cached) {
    if (cached.expiresAtMs > nowMs) {
      return cached.data;
    }
    if (opts?.allowStale && cached.staleUntilMs > nowMs) {
      return cached.data;
    }
    if (cached.staleUntilMs <= nowMs) {
      meResponseCache.delete(userId);
    }
  }

  const redisRaw = await cacheGetJson<Record<string, unknown>>(buildMeResponseRedisKey(userId));
  const redisEnvelope = normalizeCachedMeResponseEnvelope(redisRaw);
  const redisCached = redisEnvelope?.data ?? normalizeCachedMeResponse(redisRaw);
  if (
    !redisCached ||
    (!opts?.allowStale && redisEnvelope && nowMs - redisEnvelope.cachedAtMs > ME_RESPONSE_CACHE_TTL_MS)
  ) {
    return null;
  }

  writeLocalMeResponseCache(userId, redisCached);
  return redisCached;
}

export function writeCachedMeResponse(userId: string, data: MeResponseUser): void {
  writeLocalMeResponseCache(userId, data);
  void cacheSetJson(
    buildMeResponseRedisKey(userId),
    {
      data,
      cachedAt: Date.now(),
    },
    ME_RESPONSE_STALE_FALLBACK_MS
  );
}

export function clearCachedMeResponse(userId: string): void {
  meResponseCache.delete(userId);
  void redisDelete(buildMeResponseRedisKey(userId));
}
