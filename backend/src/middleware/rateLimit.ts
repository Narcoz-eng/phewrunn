import type { Context, Next } from "hono";
import { isRedisFastForRateLimiting, redisIncrementWithWindow } from "../lib/redis.js";

/**
 * Rate Limiting Middleware
 *
 * Implements in-memory rate limiting with configurable windows and limits.
 * For production, consider using Redis for distributed rate limiting.
 *
 * TODO: Production Improvements
 * - Use Redis for distributed rate limiting across multiple instances
 * - Implement sliding window algorithm for smoother rate limiting
 * - Add rate limit headers (X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset)
 */

export interface RateLimitConfig {
  windowMs: number; // Time window in milliseconds
  max: number; // Max requests per window
  message?: string; // Custom error message
  keyGenerator?: (c: Context) => string; // Custom key generator
}

interface RateLimitEntry {
  count: number;
  resetTime: number;
}

const SESSION_COOKIE_NAMES = [
  "phew.session_token",
  "better-auth.session_token",
  "auth.session_token",
] as const;

// In-memory store for rate limits
// TODO: Replace with Redis for production multi-instance deployment
const rateLimitStore = new Map<string, RateLimitEntry>();
const RATE_LIMIT_STORE_MAX_ENTRIES = 50_000;

// Cleanup interval reference
let cleanupInterval: ReturnType<typeof setInterval> | null = null;

/**
 * Start periodic cleanup of expired entries
 * Call this once during app initialization
 */
export function startRateLimitCleanup(intervalMs: number = 60000): void {
  if (cleanupInterval) return;

  cleanupInterval = setInterval(() => {
    const now = Date.now();
    let cleaned = 0;

    for (const [key, entry] of rateLimitStore.entries()) {
      if (now > entry.resetTime) {
        rateLimitStore.delete(key);
        cleaned++;
      }
    }

    if (cleaned > 0 && process.env.NODE_ENV !== "production") {
      console.log(`[RateLimit] Cleaned ${cleaned} expired entries`);
    }
  }, intervalMs);
}

/**
 * Stop the cleanup interval (useful for tests)
 */
export function stopRateLimitCleanup(): void {
  if (cleanupInterval) {
    clearInterval(cleanupInterval);
    cleanupInterval = null;
  }
}

/**
 * Clear all rate limit entries (useful for tests)
 */
export function clearRateLimitStore(): void {
  rateLimitStore.clear();
}

/**
 * Get client identifier from request
 * Uses X-Forwarded-For for proxied requests, falls back to connection info
 */
function parseFirstForwardedIp(value: string | undefined): string | null {
  if (!value) return null;
  const first = value.split(",")[0]?.trim();
  return first || null;
}

function parseRfcForwardedFor(value: string | undefined): string | null {
  if (!value) return null;
  const match = value.match(/for="?([^;,\s"]+)"?/i);
  if (!match?.[1]) return null;
  const ip = match[1].replace(/^\[|\]$/g, "");
  return ip || null;
}

function getCookieValue(cookieHeader: string | undefined, name: string): string | null {
  if (!cookieHeader) return null;

  let resolvedValue: string | null = null;
  for (const part of cookieHeader.split(";")) {
    const [rawKey, ...rest] = part.trim().split("=");
    if (rawKey !== name) continue;
    const rawValue = rest.join("=");
    if (!rawValue) {
      resolvedValue = null;
      continue;
    }
    try {
      resolvedValue = decodeURIComponent(rawValue);
    } catch {
      resolvedValue = rawValue;
    }
  }

  return resolvedValue;
}

function getSessionFingerprint(c: Context): string | null {
  const authHeader = c.req.header("authorization");
  if (authHeader?.startsWith("Bearer ")) {
    const token = authHeader.slice(7).trim();
    if (token) return `bearer:${token.slice(0, 24)}`;
  }

  const cookieHeader = c.req.header("cookie");
  for (const name of SESSION_COOKIE_NAMES) {
    const token = getCookieValue(cookieHeader, name);
    if (token) return `cookie:${token.slice(0, 24)}`;
  }

  return null;
}

function getClientKey(c: Context): string {
  // Prefer authenticated session fingerprint to avoid cross-user collisions
  // when clients share IP ranges (mobile carriers, office networks, proxies).
  const sessionFingerprint = getSessionFingerprint(c);
  if (sessionFingerprint) return sessionFingerprint;

  // Prefer proxy/client IP headers set by Vercel/CDNs
  const ip =
    parseFirstForwardedIp(c.req.header("x-forwarded-for")) ??
    parseFirstForwardedIp(c.req.header("x-vercel-forwarded-for")) ??
    parseFirstForwardedIp(c.req.header("cf-connecting-ip")) ??
    parseFirstForwardedIp(c.req.header("x-real-ip")) ??
    parseRfcForwardedFor(c.req.header("forwarded"));

  if (ip) return `ip:${ip}`;

  // Last resort: low-cardinality but better than a single global bucket
  const host = c.req.header("host") ?? "unknown-host";
  const origin = c.req.header("origin") ?? c.req.header("referer") ?? "unknown-origin";
  const userAgent = c.req.header("user-agent") ?? "unknown-ua";
  return `fallback:${host}|${origin.slice(0, 120)}|${userAgent.slice(0, 120)}`;
}

/**
 * Create a rate limiting middleware with the given configuration
 */
export function rateLimit(config: RateLimitConfig) {
  const {
    windowMs,
    max,
    message = "Too many requests, please try again later",
    keyGenerator = getClientKey,
  } = config;

  return async (c: Context, next: Next) => {
    // Do not count CORS preflight requests toward application limits.
    if (c.req.method === "OPTIONS") {
      return next();
    }

    const key = keyGenerator(c);
    const now = Date.now();

    if (isRedisFastForRateLimiting()) {
      const redisKey = `ratelimit:${windowMs}:${max}:${key}`;
      const redisEntry = await redisIncrementWithWindow(redisKey, windowMs);

      if (redisEntry) {
        const remaining = Math.max(0, max - redisEntry.count);
        const resetSeconds = Math.ceil((redisEntry.resetTimeMs - now) / 1000);

        c.header("X-RateLimit-Limit", String(max));
        c.header("X-RateLimit-Remaining", String(remaining));
        c.header("X-RateLimit-Reset", String(Math.ceil(redisEntry.resetTimeMs / 1000)));

        if (redisEntry.count > max) {
          c.header("Retry-After", String(resetSeconds));
          console.warn("[RateLimit] Exceeded", {
            method: c.req.method,
            path: c.req.path,
            key,
            count: redisEntry.count,
            max,
            windowMs,
            backend: "redis",
          });

          return c.json(
            {
              error: {
                message,
                code: "RATE_LIMIT_EXCEEDED",
                retryAfter: resetSeconds,
              },
            },
            429
          );
        }

        return next();
      }
      // Fall through to in-memory mode if Redis is unavailable.
    }

    // Get or create entry for this key
    let entry = rateLimitStore.get(key);

    if (!entry || now > entry.resetTime) {
      // Evict oldest entry when store is full to prevent unbounded memory growth
      if (rateLimitStore.size >= RATE_LIMIT_STORE_MAX_ENTRIES && !rateLimitStore.has(key)) {
        const oldestKey = rateLimitStore.keys().next().value;
        if (typeof oldestKey === "string") {
          rateLimitStore.delete(oldestKey);
        }
      }
      // Create new entry or reset expired one
      entry = {
        count: 1,
        resetTime: now + windowMs,
      };
      rateLimitStore.set(key, entry);
    } else {
      // Increment existing entry
      entry.count++;
    }

    // Calculate remaining requests
    const remaining = Math.max(0, max - entry.count);
    const resetSeconds = Math.ceil((entry.resetTime - now) / 1000);

    // Set rate limit headers
    c.header("X-RateLimit-Limit", String(max));
    c.header("X-RateLimit-Remaining", String(remaining));
    c.header("X-RateLimit-Reset", String(Math.ceil(entry.resetTime / 1000)));

    // Check if limit exceeded
    if (entry.count > max) {
      c.header("Retry-After", String(resetSeconds));
      console.warn("[RateLimit] Exceeded", {
        method: c.req.method,
        path: c.req.path,
        key,
        count: entry.count,
        max,
        windowMs,
      });

      return c.json(
        {
          error: {
            message,
            code: "RATE_LIMIT_EXCEEDED",
            retryAfter: resetSeconds,
          },
        },
        429
      );
    }

    await next();
  };
}

/**
 * Create a rate limiter that combines IP and user ID
 * More restrictive for anonymous users, more lenient for authenticated users
 */
export function userAwareRateLimit(config: RateLimitConfig) {
  return rateLimit({
    ...config,
    keyGenerator: (c: Context) => {
      const user = c.get("user") as { id: string } | null;
      const clientKey = getClientKey(c);

      // Authenticated users get their own bucket (typically more lenient)
      // Anonymous users fall back to the client fingerprint key
      return user ? `user:${user.id}` : clientKey;
    },
  });
}

// ==========================================
// Pre-configured Rate Limiters
// ==========================================

/**
 * General API rate limit
 * 220 requests per minute per client
 */
export const apiRateLimit = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 220,
  message: "Too many requests, please slow down",
});

/**
 * Auth endpoints rate limit
 * 30 requests per 5 minutes per client
 * Protects against brute force attacks
 */
export const authRateLimit = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 30,
  message: "Too many authentication attempts, please wait before trying again",
});

export const privySyncRateLimit = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 12,
  message: "Too many Privy sync attempts, please wait before trying again",
});

/**
 * Session/profile endpoints rate limit
 * 180 requests per minute per authenticated user
 * Keeps /api/me responsive during reconnect + polling without weakening global abuse controls.
 */
export const sessionRateLimit = userAwareRateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 180,
  message: "Session check rate limit reached, please retry shortly",
});

/**
 * Feed endpoints rate limit
 * 120 requests per minute per authenticated user
 * Allows fast UI refresh while still preventing hot-loop abuse.
 */
export const feedRateLimit = userAwareRateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 120,
  message: "Feed rate limit reached, please retry shortly",
});

export const jupiterQuoteRateLimit = userAwareRateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 45,
  message: "Quote rate limit reached, please retry shortly",
});

export const chartCandlesRateLimit = userAwareRateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 30,
  message: "Chart rate limit reached, please retry shortly",
});

export const tradeWriteRateLimit = userAwareRateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 20,
  message: "Trade rate limit reached, please retry shortly",
});

/**
 * Post creation rate limit
 * 20 posts per hour per client
 * Prevents spam
 */
export const postRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 20,
  message: "Post limit reached, please wait before creating more posts",
});

/**
 * Strict rate limit for sensitive operations
 * 5 requests per 10 minutes
 */
export const strictRateLimit = rateLimit({
  windowMs: 10 * 60 * 1000, // 10 minutes
  max: 5,
  message: "Rate limit exceeded for this operation",
});

/**
 * Settlement endpoint rate limit
 * 10 requests per minute
 * Prevents abuse of the settlement system
 */
export const settlementRateLimit = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 10,
  message: "Settlement rate limit reached, please wait",
});

/**
 * Comment creation rate limit
 * 30 comments per hour per client
 * Prevents spam
 */
export const commentRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 30,
  message: "Comment limit reached, please wait before adding more comments",
});

/**
 * Admin endpoints rate limit
 * 50 requests per minute per client
 * Admin actions should be rate limited but more lenient
 */
export const adminRateLimit = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 50,
  message: "Admin rate limit reached, please slow down",
});

/**
 * Leaderboard endpoints rate limit
 * 60 requests per minute per client
 * Leaderboard queries can be expensive
 */
export const leaderboardRateLimit = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 60,
  message: "Leaderboard rate limit reached, please wait",
});

/**
 * Post creation rate limit (IP-based)
 * 10 posts per hour per client
 * Prevents spam posting
 */
export const postCreationRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 10,
  message: "Post creation limit reached, you can create up to 10 posts per hour",
});
