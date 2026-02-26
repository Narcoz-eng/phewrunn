type RedisPrimitive = string | number | boolean;

const REDIS_URL = process.env.UPSTASH_REDIS_REST_URL?.trim() || null;
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN?.trim() || null;

function hasRedisConfig(): boolean {
  return Boolean(REDIS_URL && REDIS_TOKEN);
}

type RedisResponse<T = unknown> = {
  result?: T;
  error?: string;
};

async function redisCommand<T = unknown>(args: RedisPrimitive[]): Promise<T | null> {
  if (!hasRedisConfig()) return null;

  try {
    const response = await fetch(REDIS_URL!, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${REDIS_TOKEN!}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(args),
    });

    if (!response.ok) return null;
    const payload = (await response.json()) as RedisResponse<T>;
    if (payload.error) {
      console.warn("[redis] command error", { command: args[0], error: payload.error });
      return null;
    }
    return (payload.result ?? null) as T | null;
  } catch (error) {
    console.warn("[redis] command failed", { command: args[0], error });
    return null;
  }
}

export function isRedisConfigured(): boolean {
  return hasRedisConfig();
}

export async function redisGetString(key: string): Promise<string | null> {
  const result = await redisCommand<unknown>(["GET", key]);
  if (result == null) return null;
  return typeof result === "string" ? result : String(result);
}

export async function redisSetString(key: string, value: string, ttlMs?: number): Promise<boolean> {
  const command: RedisPrimitive[] =
    typeof ttlMs === "number" && ttlMs > 0
      ? ["SET", key, value, "PX", Math.floor(ttlMs)]
      : ["SET", key, value];
  const result = await redisCommand<unknown>(command);
  return result !== null;
}

export async function redisDelete(key: string): Promise<boolean> {
  const result = await redisCommand<unknown>(["DEL", key]);
  return result !== null;
}

export async function redisIncr(key: string): Promise<number | null> {
  const result = await redisCommand<unknown>(["INCR", key]);
  if (typeof result === "number") return result;
  if (typeof result === "string") {
    const parsed = Number(result);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export async function redisPExpire(key: string, ttlMs: number): Promise<boolean> {
  const result = await redisCommand<unknown>(["PEXPIRE", key, Math.floor(ttlMs)]);
  return result !== null;
}

export async function redisPTtl(key: string): Promise<number | null> {
  const result = await redisCommand<unknown>(["PTTL", key]);
  if (typeof result === "number") return result;
  if (typeof result === "string") {
    const parsed = Number(result);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export async function cacheGetJson<T>(key: string): Promise<T | null> {
  const raw = await redisGetString(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export async function cacheSetJson(key: string, value: unknown, ttlMs: number): Promise<boolean> {
  try {
    return await redisSetString(key, JSON.stringify(value), ttlMs);
  } catch {
    return false;
  }
}

export async function redisIncrementWithWindow(
  key: string,
  windowMs: number
): Promise<{ count: number; resetTimeMs: number } | null> {
  const count = await redisIncr(key);
  if (count === null) return null;

  if (count === 1) {
    await redisPExpire(key, windowMs);
    return { count, resetTimeMs: Date.now() + windowMs };
  }

  let ttlMs = await redisPTtl(key);
  if (ttlMs === null || ttlMs < 0) {
    await redisPExpire(key, windowMs);
    ttlMs = windowMs;
  }

  return {
    count,
    resetTimeMs: Date.now() + ttlMs,
  };
}

