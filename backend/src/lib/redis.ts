import net from "node:net";
import tls from "node:tls";

type RedisPrimitive = string | number | boolean;

const UPSTASH_REDIS_URL = process.env.UPSTASH_REDIS_REST_URL?.trim() || null;
const UPSTASH_REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN?.trim() || null;
const REDIS_TCP_URL = process.env.REDIS_URL?.trim() || null;

function hasUpstashConfig(): boolean {
  return Boolean(UPSTASH_REDIS_URL && UPSTASH_REDIS_TOKEN);
}

function hasTcpRedisConfig(): boolean {
  return Boolean(REDIS_TCP_URL);
}

function hasRedisConfig(): boolean {
  return hasUpstashConfig() || hasTcpRedisConfig();
}

type RedisResponse<T = unknown> = {
  result?: T;
  error?: string;
};

async function redisCommand<T = unknown>(args: RedisPrimitive[]): Promise<T | null> {
  if (!hasRedisConfig()) return null;

  try {
    if (hasUpstashConfig()) {
      const result = await redisCommandUpstash<T>(args);
      if (result !== null) return result;
      // If Upstash is configured but temporarily failing, do not silently double-send on TCP.
      if (!hasTcpRedisConfig()) return null;
    }

    if (hasTcpRedisConfig()) {
      return await redisCommandTcp<T>(args);
    }

    return null;
  } catch (error) {
    console.warn("[redis] command failed", { command: args[0], error });
    return null;
  }
}

async function redisCommandUpstash<T = unknown>(args: RedisPrimitive[]): Promise<T | null> {
  const response = await fetch(UPSTASH_REDIS_URL!, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${UPSTASH_REDIS_TOKEN!}`,
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
}

type RespValue = string | number | null | RespValue[];

function encodeRespCommand(args: RedisPrimitive[]): Buffer {
  const parts: Buffer[] = [Buffer.from(`*${args.length}\r\n`, "utf8")];
  for (const arg of args) {
    const value = String(arg);
    const valueBuffer = Buffer.from(value, "utf8");
    parts.push(Buffer.from(`$${valueBuffer.length}\r\n`, "utf8"));
    parts.push(valueBuffer);
    parts.push(Buffer.from("\r\n", "utf8"));
  }
  return Buffer.concat(parts);
}

function parseRespValue(
  buffer: Buffer,
  start = 0
): { value: RespValue; nextOffset: number } | null {
  if (start >= buffer.length) return null;
  const firstByte = buffer[start];
  if (typeof firstByte !== "number") return null;
  const prefix = String.fromCharCode(firstByte);

  const readLine = (offset: number): { line: string; nextOffset: number } | null => {
    const end = buffer.indexOf("\r\n", offset);
    if (end === -1) return null;
    return {
      line: buffer.toString("utf8", offset, end),
      nextOffset: end + 2,
    };
  };

  if (prefix === "+" || prefix === "-" || prefix === ":" || prefix === "$" || prefix === "*") {
    const header = readLine(start + 1);
    if (!header) return null;

    if (prefix === "+") {
      return { value: header.line, nextOffset: header.nextOffset };
    }

    if (prefix === "-") {
      throw new Error(header.line);
    }

    if (prefix === ":") {
      const parsed = Number(header.line);
      return { value: Number.isFinite(parsed) ? parsed : 0, nextOffset: header.nextOffset };
    }

    if (prefix === "$") {
      const length = Number(header.line);
      if (length === -1) {
        return { value: null, nextOffset: header.nextOffset };
      }
      if (!Number.isFinite(length) || length < 0) {
        throw new Error(`Invalid bulk string length: ${header.line}`);
      }
      const end = header.nextOffset + length;
      if (buffer.length < end + 2) return null;
      const trailingCrlf = buffer.toString("utf8", end, end + 2);
      if (trailingCrlf !== "\r\n") {
        throw new Error("Invalid bulk string terminator");
      }
      return {
        value: buffer.toString("utf8", header.nextOffset, end),
        nextOffset: end + 2,
      };
    }

    if (prefix === "*") {
      const count = Number(header.line);
      if (count === -1) {
        return { value: null, nextOffset: header.nextOffset };
      }
      if (!Number.isFinite(count) || count < 0) {
        throw new Error(`Invalid array length: ${header.line}`);
      }

      let offset = header.nextOffset;
      const items: RespValue[] = [];
      for (let i = 0; i < count; i += 1) {
        const item = parseRespValue(buffer, offset);
        if (!item) return null;
        items.push(item.value);
        offset = item.nextOffset;
      }
      return { value: items, nextOffset: offset };
    }
  }

  throw new Error(`Unsupported RESP prefix: ${prefix}`);
}

async function readRespReply(
  socket: net.Socket | tls.TLSSocket,
  timeoutMs = 4000
): Promise<RespValue> {
  return await new Promise<RespValue>((resolve, reject) => {
    let buffer = Buffer.alloc(0);

    const onData = (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, chunk]);
      try {
        const parsed = parseRespValue(buffer, 0);
        if (!parsed) return;
        cleanup();
        resolve(parsed.value);
      } catch (error) {
        cleanup();
        reject(error);
      }
    };

    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };

    const onTimeout = () => {
      cleanup();
      reject(new Error("Redis TCP command timed out"));
    };

    const cleanup = () => {
      clearTimeout(timer);
      socket.off("data", onData);
      socket.off("error", onError);
    };

    const timer = setTimeout(onTimeout, timeoutMs);
    socket.on("data", onData);
    socket.on("error", onError);
  });
}

async function writeAndReadReply(
  socket: net.Socket | tls.TLSSocket,
  command: RedisPrimitive[]
): Promise<RespValue> {
  const payload = encodeRespCommand(command);
  await new Promise<void>((resolve, reject) => {
    socket.write(payload, (error) => {
      if (error) reject(error);
      else resolve();
    });
  });
  return await readRespReply(socket);
}

function createRedisTcpSocket(url: URL): Promise<net.Socket | tls.TLSSocket> {
  const port = Number(url.port || "6379");
  const host = url.hostname;
  const useTls = url.protocol === "rediss:";

  return new Promise((resolve, reject) => {
    const socket = useTls
      ? tls.connect({
          host,
          port,
          servername: host,
        })
      : net.createConnection({ host, port });

    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };

    const onConnect = () => {
      cleanup();
      socket.setTimeout(5000);
      socket.on("timeout", () => socket.destroy(new Error("Redis TCP socket timeout")));
      resolve(socket);
    };

    const cleanup = () => {
      socket.off("error", onError);
      socket.off("connect", onConnect);
      if (socket instanceof tls.TLSSocket) {
        socket.off("secureConnect", onConnect);
      }
    };

    socket.on("error", onError);
    if (useTls) {
      (socket as tls.TLSSocket).on("secureConnect", onConnect);
    } else {
      socket.on("connect", onConnect);
    }
  });
}

function respToPrimitive<T>(value: RespValue): T | null {
  if (value == null) return null;
  if (Array.isArray(value)) return value as T;
  if (typeof value === "string" || typeof value === "number") return value as T;
  return null;
}

async function redisCommandTcp<T = unknown>(args: RedisPrimitive[]): Promise<T | null> {
  const rawUrl = REDIS_TCP_URL;
  if (!rawUrl) return null;

  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    console.warn("[redis] invalid REDIS_URL");
    return null;
  }

  if (url.protocol !== "redis:" && url.protocol !== "rediss:") {
    console.warn("[redis] unsupported REDIS_URL protocol", { protocol: url.protocol });
    return null;
  }

  let socket: net.Socket | tls.TLSSocket | null = null;
  try {
    socket = await createRedisTcpSocket(url);

    const username = decodeURIComponent(url.username || "");
    const password = decodeURIComponent(url.password || "");
    if (password) {
      const authCommand =
        username && username !== "default"
          ? ["AUTH", username, password]
          : username
            ? ["AUTH", username, password]
            : ["AUTH", password];
      const authReply = await writeAndReadReply(socket, authCommand);
      if (typeof authReply !== "string" || authReply.toUpperCase() !== "OK") {
        throw new Error("Redis AUTH failed");
      }
    }

    if (url.pathname && url.pathname !== "/") {
      const dbIndex = Number(url.pathname.replace("/", ""));
      if (Number.isFinite(dbIndex) && dbIndex >= 0) {
        const selectReply = await writeAndReadReply(socket, ["SELECT", dbIndex]);
        if (typeof selectReply !== "string" || selectReply.toUpperCase() !== "OK") {
          throw new Error("Redis SELECT failed");
        }
      }
    }

    const reply = await writeAndReadReply(socket, args);
    return respToPrimitive<T>(reply);
  } catch (error) {
    console.warn("[redis] tcp command failed", { command: String(args[0]), error });
    return null;
  } finally {
    if (socket) {
      socket.end();
      socket.destroy();
    }
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
