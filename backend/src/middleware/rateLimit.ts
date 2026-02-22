import type { Context, Next } from "hono";

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

// In-memory store for rate limits
// TODO: Replace with Redis for production multi-instance deployment
const rateLimitStore = new Map<string, RateLimitEntry>();

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
function getClientKey(c: Context): string {
  // Try X-Forwarded-For first (for proxied requests)
  const forwarded = c.req.header("x-forwarded-for");
  if (forwarded) {
    // Take the first IP in the chain (original client)
    const parts = forwarded.split(",");
    const firstPart = parts[0];
    if (firstPart) {
      const clientIp = firstPart.trim();
      if (clientIp) return clientIp;
    }
  }

  // Try X-Real-IP (nginx)
  const realIp = c.req.header("x-real-ip");
  if (realIp) return realIp;

  // Fall back to "unknown" - in production, consider blocking these
  return "unknown";
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
    const key = keyGenerator(c);
    const now = Date.now();

    // Get or create entry for this key
    let entry = rateLimitStore.get(key);

    if (!entry || now > entry.resetTime) {
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
      const ip = getClientKey(c);

      // Authenticated users get their own bucket (typically more lenient)
      // Anonymous users share the IP bucket (more restrictive)
      return user ? `user:${user.id}` : `ip:${ip}`;
    },
  });
}

// ==========================================
// Pre-configured Rate Limiters
// ==========================================

/**
 * General API rate limit
 * 100 requests per minute per client
 */
export const apiRateLimit = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 100,
  message: "Too many requests, please slow down",
});

/**
 * Auth endpoints rate limit
 * 10 requests per 5 minutes per client
 * Protects against brute force attacks
 */
export const authRateLimit = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 10,
  message: "Too many authentication attempts, please wait before trying again",
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
