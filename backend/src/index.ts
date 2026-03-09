import { Hono, type Context } from "hono";
import { cors } from "hono/cors";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import "./env.js";
import {
  betterAuthMiddleware,
  auth,
  invalidateResolvedSessionCache,
  startSessionMaintenance,
  type AuthVariables,
} from "./auth.js";
import { prisma, withPrismaRetry, ensurePrismaReady } from "./prisma.js";
import { postsRouter } from "./routes/posts.js";
import { usersRouter } from "./routes/users.js";
import { adminRouter } from "./routes/admin.js";
import { notificationsRouter } from "./routes/notifications.js";
import { reportsRouter } from "./routes/reports.js";
import { announcementsRouter } from "./routes/announcements.js";
import { leaderboardRouter } from "./routes/leaderboard.js";
import { feedRouter } from "./routes/feed.js";
import { tokensRouter } from "./routes/tokens.js";
import { callsRouter } from "./routes/calls.js";
import { tradersRouter } from "./routes/traders.js";
import { radarRouter } from "./routes/radar.js";
import { alertsRouter } from "./routes/alerts.js";
import { leaderboardsRouter } from "./routes/leaderboards.js";
import { cacheGetJson, cacheSetJson, redisDelete } from "./lib/redis.js";

// Security middleware imports
import {
  securityHeaders,
  requestId,
  logProductionStatus,
  createErrorHandler,
  apiRateLimit,
  authRateLimit,
  privySyncRateLimit,
  sessionRateLimit,
  feedRateLimit,
  jupiterQuoteRateLimit,
  chartCandlesRateLimit,
  tradeWriteRateLimit,
  adminRateLimit,
  leaderboardRateLimit,
  commentRateLimit,
  startRateLimitCleanup,
  bodySizeLimit,
  sanitizeBody,
  sanitizeQuery,
  csrfProtection,
  structuredLogger,
} from "./middleware/index.js";

// =====================================================
// Production Environment Validation
// =====================================================
// Log security status on startup
logProductionStatus();

// Start rate limit cleanup (cleans expired entries every minute)
startRateLimitCleanup(60000);
startSessionMaintenance();

// =====================================================
// App Configuration
// =====================================================

// Alpha Protocol Backend - SocialFi platform with Better Auth
const app = new Hono<{
  Variables: AuthVariables & { requestId?: string; sanitizedBody?: unknown; sanitizedQuery?: Record<string, string[]> };
}>();
const isBunRuntime = typeof (globalThis as { Bun?: unknown }).Bun !== "undefined";

// =====================================================
// Middleware Stack (order matters!)
// =====================================================

// 1. Request ID - for tracing and debugging
app.use("*", requestId());

// 2. Security Headers - protect against common vulnerabilities
const isProduction = process.env.NODE_ENV === "production";
app.use(
  "*",
  securityHeaders({
    hsts: isProduction, // Only enable HSTS in production
  })
);

// 3. CORS - Production-ready, validates origin against allowlist
const allowed = [
  /^http:\/\/localhost(:\d+)?$/,
  /^http:\/\/127\.0\.0\.1(:\d+)?$/,
  /^https:\/\/[a-z0-9-]+\.dev\.vibecode\.run$/,
  /^https:\/\/[a-z0-9-]+\.vibecode\.run$/,
  /^https:\/\/phew\.vibecode\.run$/,
  /^https:\/\/[a-z0-9-]+\.vibecodeapp\.com$/,
  /^https:\/\/phew\.run$/,
  /^https:\/\/www\.phew\.run$/,
  /^https:\/\/[a-z0-9-]+\.phew\.run$/,
];

app.use(
  "*",
  cors({
    origin: (origin) => (origin && allowed.some((re) => re.test(origin)) ? origin : null),
    credentials: true,
  })
);

// 3.5. Prisma readiness gate - ensure DB is connected before serving API requests
// Uses a short timeout so requests don't hang if guardrails are slow
let prismaReady = false;
function requiresStrictPrismaReadiness(path: string): boolean {
  return (
    path.startsWith("/api/feed") ||
    path.startsWith("/api/tokens") ||
    path.startsWith("/api/calls") ||
    path.startsWith("/api/traders") ||
    path.startsWith("/api/radar") ||
    path.startsWith("/api/alerts") ||
    path.startsWith("/api/leaderboards")
  );
}

app.use("/api/*", async (c, next) => {
  if (!prismaReady) {
    const requiresStrictReadiness = requiresStrictPrismaReadiness(c.req.path);
    const readinessTimeoutMs = requiresStrictReadiness ? 10_000 : 3_000;
    try {
      await Promise.race([
        ensurePrismaReady().then(() => { prismaReady = true; }),
        new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), readinessTimeoutMs)),
      ]);
    } catch {
      // Non-fatal: allow request through even if guardrails timed out;
      // individual route handlers have their own fallbacks
      if (requiresStrictReadiness) {
        return c.json(
          {
            error: {
              message: "Database is still preparing intelligence features. Retry shortly.",
              code: "INTELLIGENCE_DB_NOT_READY",
            },
          },
          503
        );
      }
    }
  }
  return next();
});

// 4. Input Sanitization - sanitize request bodies and query params
app.use("/api/*", sanitizeBody());
app.use("/api/*", sanitizeQuery());

// 5. CSRF Protection - validate origin for state-changing requests
app.use("/api/*", async (c, next) => {
  // Explicitly exempt auth bootstrap endpoints that may be called before a cookie session exists.
  // Keep logout and other state-changing routes protected.
  if (c.req.path === "/api/auth/privy-sync" || c.req.path === "/api/auth/wallet") {
    return next();
  }
  return csrfProtection()(c, next);
});

// 6. Global API Rate Limit - 100 requests per minute per client
// Protects against abuse and DoS
app.use("/api/*", async (c, next) => {
  // High-frequency market polling + quote refresh endpoints should not starve the rest
  // of the app via shared global buckets.
  if (
    c.req.path === "/api/auth/privy-sync" ||
    c.req.path === "/api/me" ||
    c.req.path === "/api/me/stats" ||
    c.req.path === "/api/notifications" ||
    c.req.path === "/api/notifications/unread-count" ||
    c.req.path === "/api/posts/prices" ||
    c.req.path === "/api/posts/jupiter/quote" ||
    c.req.path === "/api/posts/chart/candles"
  ) {
    return next();
  }
  return apiRateLimit(c, next);
});

// 7. Endpoint-specific rate limits (more restrictive, applied before general limit)
// Auth endpoints - 10 req/5min (brute force protection)
app.use("/api/auth/*", async (c, next) => {
  return authRateLimit(c, next);
});
app.use("/api/auth/privy-sync", privySyncRateLimit);
app.use("/api/posts/jupiter/quote", jupiterQuoteRateLimit);
app.use("/api/posts/chart/candles", chartCandlesRateLimit);
app.use("/api/posts/jupiter/swap", tradeWriteRateLimit);
app.use("/api/posts/jupiter/fee-confirm", tradeWriteRateLimit);
app.use("/api/posts/portfolio", tradeWriteRateLimit);
app.use("/api/me", sessionRateLimit);
app.use("/api/me/stats", sessionRateLimit);
app.use("/api/posts", async (c, next) => {
  if (c.req.method === "GET") {
    return feedRateLimit(c, next);
  }
  return next();
});
app.use("/api/feed/*", feedRateLimit);
// Admin endpoints - 50 req/min
app.use("/api/admin/*", adminRateLimit);
// Leaderboard endpoints - 60 req/min (expensive queries)
app.use("/api/leaderboard/*", leaderboardRateLimit);
app.use("/api/leaderboards/*", leaderboardRateLimit);
app.use("/api/auth/privy-sync", bodySizeLimit(8 * 1024, "Privy sync payload is too large"));
app.use("/api/auth/wallet", bodySizeLimit(16 * 1024, "Wallet auth payload is too large"));
app.use("/api/posts/jupiter/quote", bodySizeLimit(12 * 1024, "Quote payload is too large"));
app.use("/api/posts/jupiter/swap", bodySizeLimit(128 * 1024, "Swap payload is too large"));
app.use("/api/posts/jupiter/fee-confirm", bodySizeLimit(8 * 1024, "Trade confirmation payload is too large"));
app.use("/api/posts/chart/candles", bodySizeLimit(8 * 1024, "Chart payload is too large"));
app.use("/api/posts/portfolio", bodySizeLimit(12 * 1024, "Portfolio payload is too large"));

// 8. Structured Logging
app.use("*", structuredLogger({
  level: isProduction ? "slow" : "all",
  slowThreshold: 1000,
  skipPaths: ["/health"],
}));

// 9. Global error handler - doesn't leak stack traces in production
app.onError(createErrorHandler());

// 10. Better Auth middleware - populates user from session cookie
app.use("*", betterAuthMiddleware);

// =====================================================
// Health Check
// =====================================================
app.get("/health", (c) => {
  const databaseUrl = process.env.DATABASE_URL || "";
  const database =
    databaseUrl.includes("supabase.com") || databaseUrl.includes("supabase.co")
      ? "supabase-postgres"
      : databaseUrl.includes("file:")
        ? "sqlite"
        : databaseUrl.startsWith("postgres://") || databaseUrl.startsWith("postgresql://")
          ? "postgres"
          : "unknown";

  return prisma.$queryRawUnsafe("SELECT 1").then(() =>
    c.json({
      status: "ok",
      timestamp: new Date().toISOString(),
      environment: process.env.NODE_ENV || "development",
      database,
      dbConnected: true,
      // Don't expose version in production for security
      ...(isProduction ? {} : { version: "1.0.0" }),
    })
  ).catch((error) => {
    console.error("[health] DB connectivity check failed:", error);
    return c.json(
      {
        status: "degraded",
        timestamp: new Date().toISOString(),
        environment: process.env.NODE_ENV || "development",
        database,
        dbConnected: false,
      },
      503
    );
  });
});

// =====================================================
// Wallet Authentication Routes (BEFORE Better Auth to take priority)
// =====================================================

import { PublicKey } from "@solana/web3.js";
import nacl from "tweetnacl";
import bs58 from "bs58";
import { PrivyClient } from "@privy-io/server-auth";
import {
  createSignedSessionToken,
  inspectSignedSessionToken,
  verifySignedSessionToken,
  type SessionTokenUserClaims,
} from "./lib/session-token.js";
import {
  appendAuthDecision,
  buildApiMeAuthTrace,
  finalizeApiMeAuthTrace,
} from "./lib/auth-trace.js";

const PRIVY_APP_ID = process.env.PRIVY_APP_ID;
const PRIVY_APP_SECRET = process.env.PRIVY_APP_SECRET;
const PRIVY_CLIENT =
  PRIVY_APP_ID && PRIVY_APP_SECRET
    ? new PrivyClient(PRIVY_APP_ID, PRIVY_APP_SECRET)
    : null;
const PRIVY_IDENTITY_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const PRIVY_IDENTITY_CACHE_MAX_ENTRIES = process.env.NODE_ENV === "production" ? 20_000 : 2_000;
const privyIdentityCache = new Map<string, { userId: string; email: string | null; cachedAt: number }>();
const PRIVY_AUTH_USER_CACHE_TTL_MS = process.env.NODE_ENV === "production" ? 30 * 60 * 1000 : 5 * 60 * 1000;
const PRIVY_AUTH_USER_CACHE_MAX_ENTRIES = process.env.NODE_ENV === "production" ? 20_000 : 2_000;
const PRIVY_AUTH_USER_REDIS_KEY_PREFIX = "privy-auth-user:v1";
const privyAuthUserCache = new Map<string, { user: AuthResponseUser; expiresAtMs: number }>();

function readCachedPrivyIdentity(cacheKey: string | null) {
  if (!cacheKey) return null;

  const cached = privyIdentityCache.get(cacheKey);
  if (!cached) return null;

  if (Date.now() - cached.cachedAt > PRIVY_IDENTITY_CACHE_TTL_MS) {
    privyIdentityCache.delete(cacheKey);
    return null;
  }

  if (privyIdentityCache.has(cacheKey)) {
    privyIdentityCache.delete(cacheKey);
    privyIdentityCache.set(cacheKey, cached);
  }

  return cached;
}

function writeCachedPrivyIdentity(
  cacheKey: string | null,
  value: { userId: string; email: string | null }
): void {
  if (!cacheKey) return;

  if (privyIdentityCache.has(cacheKey)) {
    privyIdentityCache.delete(cacheKey);
  }

  if (privyIdentityCache.size >= PRIVY_IDENTITY_CACHE_MAX_ENTRIES) {
    const oldestKey = privyIdentityCache.keys().next().value;
    if (typeof oldestKey === "string") {
      privyIdentityCache.delete(oldestKey);
    }
  }

  privyIdentityCache.set(cacheKey, {
    ...value,
    cachedAt: Date.now(),
  });
}

const AUTH_RESPONSE_USER_SELECT = {
  id: true,
  name: true,
  email: true,
  image: true,
  walletAddress: true,
  walletProvider: true,
  username: true,
  level: true,
  xp: true,
  bio: true,
  role: true,
  isAdmin: true,
  isVerified: true,
  tradeFeeRewardsEnabled: true,
  tradeFeeShareBps: true,
  tradeFeePayoutAddress: true,
  createdAt: true,
} as const;

const AUTH_RESPONSE_USER_FALLBACK_SELECT = {
  id: true,
  name: true,
  email: true,
  image: true,
  walletAddress: true,
  walletProvider: true,
  username: true,
  level: true,
  xp: true,
  bio: true,
  isAdmin: true,
  isVerified: true,
  tradeFeeRewardsEnabled: true,
  tradeFeeShareBps: true,
  tradeFeePayoutAddress: true,
  createdAt: true,
} as const;

const AUTH_RESPONSE_USER_MINIMAL_SELECT = {
  id: true,
  name: true,
  email: true,
} as const;

type AuthResponseUser = {
  id: string;
  name: string;
  email: string;
  image: string | null;
  walletAddress: string | null;
  walletProvider: string | null;
  username: string | null;
  level: number;
  xp: number;
  bio: string | null;
  role: string;
  isAdmin: boolean;
  isVerified: boolean;
  tradeFeeRewardsEnabled: boolean;
  tradeFeeShareBps: number;
  tradeFeePayoutAddress: string | null;
  createdAt: Date;
};

type AuthResponseUserLookupMode = "full" | "fallback" | "minimal";
const AUTH_RESPONSE_USER_LOOKUP_ORDER: AuthResponseUserLookupMode[] = [
  "full",
  "fallback",
  "minimal",
];
let authResponseUserLookupMode: AuthResponseUserLookupMode = "full";
const MAX_EFFECTIVE_POSTER_FEE_BPS = 50;

function normalizeTradeFeeShareBps(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return MAX_EFFECTIVE_POSTER_FEE_BPS;
  }
  return Math.max(0, Math.min(MAX_EFFECTIVE_POSTER_FEE_BPS, Math.round(value)));
}

function getAuthResponseUserLookupModes(
  startingMode: AuthResponseUserLookupMode = authResponseUserLookupMode
): AuthResponseUserLookupMode[] {
  const startIndex = AUTH_RESPONSE_USER_LOOKUP_ORDER.indexOf(startingMode);
  return AUTH_RESPONSE_USER_LOOKUP_ORDER.slice(startIndex >= 0 ? startIndex : 0);
}

function getNextAuthResponseUserLookupMode(
  currentMode: AuthResponseUserLookupMode
): AuthResponseUserLookupMode | null {
  const currentIndex = AUTH_RESPONSE_USER_LOOKUP_ORDER.indexOf(currentMode);
  if (currentIndex < 0 || currentIndex >= AUTH_RESPONSE_USER_LOOKUP_ORDER.length - 1) {
    return null;
  }
  return AUTH_RESPONSE_USER_LOOKUP_ORDER[currentIndex + 1] ?? null;
}

function getAuthResponseUserSelect(mode: AuthResponseUserLookupMode) {
  if (mode === "full") return AUTH_RESPONSE_USER_SELECT;
  if (mode === "fallback") return AUTH_RESPONSE_USER_FALLBACK_SELECT;
  return AUTH_RESPONSE_USER_MINIMAL_SELECT;
}

function updateAuthResponseUserLookupMode(
  nextMode: AuthResponseUserLookupMode,
  error: unknown
): void {
  if (authResponseUserLookupMode === nextMode) {
    return;
  }
  authResponseUserLookupMode = nextMode;
  console.warn(`[auth/db] User lookup compatibility downgraded to ${nextMode}`, {
    message: error instanceof Error ? error.message : String(error),
  });
}

function buildSessionTokenUserClaims(user: AuthResponseUser): SessionTokenUserClaims {
  const normalizedName = user.name.trim();
  const normalizedEmail = user.email.trim().toLowerCase();
  const normalizedWalletProvider =
    typeof user.walletProvider === "string" && user.walletProvider.trim().length > 0
      ? user.walletProvider.trim().slice(0, 32)
      : null;
  const normalizedUsername =
    typeof user.username === "string" && user.username.trim().length > 0
      ? user.username.trim().slice(0, 40)
      : null;
  const normalizedImage =
    typeof user.image === "string" &&
    /^https?:\/\//i.test(user.image.trim()) &&
    user.image.trim().length > 0
      ? user.image.trim().slice(0, 240)
      : null;
  const createdAtIso =
    user.createdAt instanceof Date && !Number.isNaN(user.createdAt.getTime())
      ? user.createdAt.toISOString()
      : null;
  return {
    // Keep stateless auth claims compact so cookies/bearer headers stay reliable.
    // Rich profile fields continue to come from /api/me and the login payload.
    name: normalizedName.length > 120 ? normalizedName.slice(0, 120) : normalizedName,
    email: normalizedEmail.length > 190 ? normalizedEmail.slice(0, 190) : normalizedEmail,
    image: normalizedImage,
    walletAddress: user.walletAddress,
    walletProvider: normalizedWalletProvider,
    username: normalizedUsername,
    level: user.level,
    xp: user.xp,
    role: user.role,
    isAdmin: user.isAdmin,
    isVerified: user.isVerified,
    createdAt: createdAtIso,
  };
}

function buildClientAuthUser(user: AuthResponseUser) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    image: user.image,
    walletAddress: user.walletAddress,
    walletProvider: user.walletProvider,
    username: user.username,
    level: user.level,
    xp: user.xp,
    bio: user.bio,
    isAdmin: user.role === "admin",
    isVerified: user.isVerified,
    tradeFeeRewardsEnabled: user.tradeFeeRewardsEnabled,
    tradeFeeShareBps: user.tradeFeeShareBps,
    tradeFeePayoutAddress: user.tradeFeePayoutAddress,
    createdAt: user.createdAt.toISOString(),
  };
}

function isPrismaSchemaDriftError(error: unknown): boolean {
  const code =
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof (error as { code?: unknown }).code === "string"
      ? (error as { code: string }).code
      : "";

  if (code === "P2021" || code === "P2022") {
    return true;
  }

  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : typeof error === "object" &&
            error !== null &&
            "message" in error &&
            typeof (error as { message?: unknown }).message === "string"
          ? (error as { message: string }).message
          : "";

  const normalizedMessage = message.toLowerCase();

  return (
    normalizedMessage.includes("does not exist in the current database") ||
    normalizedMessage.includes("no such column") ||
    normalizedMessage.includes("no such table") ||
    normalizedMessage.includes("has no column named") ||
    normalizedMessage.includes("unknown arg") ||
    normalizedMessage.includes("unknown argument") ||
    normalizedMessage.includes("unknown field") ||
    (normalizedMessage.includes("column") && normalizedMessage.includes("does not exist")) ||
    (normalizedMessage.includes("table") && normalizedMessage.includes("does not exist")) ||
    (normalizedMessage.includes("relation") && normalizedMessage.includes("does not exist")) ||
    (normalizedMessage.includes("invalid") && normalizedMessage.includes("invocation"))
  );
}

function isPrismaClientError(error: unknown): boolean {
  const name =
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    typeof (error as { name?: unknown }).name === "string"
      ? (error as { name: string }).name
      : "";
  return name.startsWith("PrismaClient");
}

function isPrismaConnectivityError(error: unknown): boolean {
  const code =
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof (error as { code?: unknown }).code === "string"
      ? (error as { code: string }).code
      : "";

  if (code === "P1001" || code === "P1002" || code === "P1008" || code === "P1017") {
    return true;
  }

  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : typeof error === "object" &&
            error !== null &&
            "message" in error &&
            typeof (error as { message?: unknown }).message === "string"
          ? (error as { message: string }).message
          : "";

  return /timed out fetching a new connection|connection pool|error in connector|kind:\s*closed|server closed the connection|connection.*(closed|timed out|timeout|refused|terminated)|econnreset|etimedout|can't reach database/i.test(
    message
  );
}

const ME_DB_LOOKUP_TIMEOUT_MS = (() => {
  const raw = process.env.ME_DB_LOOKUP_TIMEOUT_MS;
  const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN;
  if (Number.isFinite(parsed) && parsed > 0) return parsed;
  return process.env.NODE_ENV === "production" ? 4000 : 4500;
})();
const ME_RESPONSE_CACHE_TTL_MS = process.env.NODE_ENV === "production" ? 5 * 60_000 : 30_000;
const ME_RESPONSE_STALE_FALLBACK_MS =
  process.env.NODE_ENV === "production" ? 60 * 60_000 : 10 * 60_000;
const ME_RESPONSE_CACHE_MAX_ENTRIES = process.env.NODE_ENV === "production" ? 20_000 : 2_000;
const ME_RESPONSE_REDIS_KEY_PREFIX = "me-response:v1";
type MeResponseUser = {
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

const ME_RESPONSE_USER_SELECT = {
  id: true,
  name: true,
  email: true,
  image: true,
  walletAddress: true,
  username: true,
  level: true,
  xp: true,
  bio: true,
  role: true,
  isAdmin: true,
  isVerified: true,
  tradeFeeRewardsEnabled: true,
  tradeFeeShareBps: true,
  tradeFeePayoutAddress: true,
  createdAt: true,
} as const;

const ME_RESPONSE_USER_FALLBACK_SELECT = {
  id: true,
  name: true,
  email: true,
  image: true,
  walletAddress: true,
  username: true,
  level: true,
  xp: true,
  bio: true,
  isAdmin: true,
  isVerified: true,
  tradeFeeRewardsEnabled: true,
  tradeFeeShareBps: true,
  tradeFeePayoutAddress: true,
  createdAt: true,
} as const;

type MeResponseLookupMode = "full" | "fallback";
let meResponseLookupMode: MeResponseLookupMode = "full";

function updateMeResponseLookupMode(nextMode: MeResponseLookupMode, error: unknown): void {
  if (meResponseLookupMode === nextMode) {
    return;
  }
  meResponseLookupMode = nextMode;
  console.warn(`[/api/me] Prisma compatibility downgraded to ${nextMode}`, {
    message: error instanceof Error ? error.message : String(error),
  });
}

function buildPrivyAuthUserRedisKey(privyUserId: string): string {
  return `${PRIVY_AUTH_USER_REDIS_KEY_PREFIX}:${privyUserId}`;
}

function normalizeCachedPrivyAuthUser(data: unknown): AuthResponseUser | null {
  if (!data || typeof data !== "object") return null;
  const candidate = data as Record<string, unknown>;
  if (
    typeof candidate.id !== "string" ||
    typeof candidate.name !== "string" ||
    typeof candidate.email !== "string"
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

  return normalizeAuthResponseUser({
    id: candidate.id,
    name: candidate.name,
    email: candidate.email,
    image: typeof candidate.image === "string" ? candidate.image : null,
    walletAddress: typeof candidate.walletAddress === "string" ? candidate.walletAddress : null,
    walletProvider: typeof candidate.walletProvider === "string" ? candidate.walletProvider : null,
    username: typeof candidate.username === "string" ? candidate.username : null,
    level: typeof candidate.level === "number" ? candidate.level : 0,
    xp: typeof candidate.xp === "number" ? candidate.xp : 0,
    bio: typeof candidate.bio === "string" ? candidate.bio : null,
    role: typeof candidate.role === "string" ? candidate.role : "user",
    isAdmin: typeof candidate.isAdmin === "boolean" ? candidate.isAdmin : false,
    isVerified: typeof candidate.isVerified === "boolean" ? candidate.isVerified : false,
    tradeFeeRewardsEnabled:
      typeof candidate.tradeFeeRewardsEnabled === "boolean" ? candidate.tradeFeeRewardsEnabled : true,
    tradeFeeShareBps: normalizeTradeFeeShareBps(candidate.tradeFeeShareBps),
    tradeFeePayoutAddress:
      typeof candidate.tradeFeePayoutAddress === "string" ? candidate.tradeFeePayoutAddress : null,
    createdAt,
  });
}

function readLocalCachedPrivyAuthUser(privyUserId: string): AuthResponseUser | null {
  const cached = privyAuthUserCache.get(privyUserId);
  if (!cached) return null;
  if (cached.expiresAtMs <= Date.now()) {
    privyAuthUserCache.delete(privyUserId);
    return null;
  }
  return cached.user;
}

async function readCachedPrivyAuthUser(privyUserId: string): Promise<AuthResponseUser | null> {
  const localCached = readLocalCachedPrivyAuthUser(privyUserId);
  if (localCached) {
    return localCached;
  }

  const redisCached = normalizeCachedPrivyAuthUser(
    await cacheGetJson<Record<string, unknown>>(buildPrivyAuthUserRedisKey(privyUserId))
  );
  if (!redisCached) {
    return null;
  }

  writeCachedPrivyAuthUser(privyUserId, redisCached);
  return redisCached;
}

function writeCachedPrivyAuthUser(privyUserId: string, user: AuthResponseUser): void {
  if (privyAuthUserCache.has(privyUserId)) {
    privyAuthUserCache.delete(privyUserId);
  }

  if (privyAuthUserCache.size >= PRIVY_AUTH_USER_CACHE_MAX_ENTRIES) {
    const oldestKey = privyAuthUserCache.keys().next().value;
    if (typeof oldestKey === "string") {
      privyAuthUserCache.delete(oldestKey);
    }
  }

  privyAuthUserCache.set(privyUserId, {
    user,
    expiresAtMs: Date.now() + PRIVY_AUTH_USER_CACHE_TTL_MS,
  });

  void cacheSetJson(buildPrivyAuthUserRedisKey(privyUserId), {
    id: user.id,
    name: user.name,
    email: user.email,
    image: user.image,
    walletAddress: user.walletAddress,
    walletProvider: user.walletProvider,
    username: user.username,
    level: user.level,
    xp: user.xp,
    bio: user.bio,
    role: user.role,
    isAdmin: user.isAdmin,
    isVerified: user.isVerified,
    tradeFeeRewardsEnabled: user.tradeFeeRewardsEnabled,
    tradeFeeShareBps: user.tradeFeeShareBps,
    tradeFeePayoutAddress: user.tradeFeePayoutAddress,
    createdAt: user.createdAt.toISOString(),
  }, PRIVY_AUTH_USER_CACHE_TTL_MS);
}
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

  meResponseCache.set(userId, {
    data,
    expiresAtMs: Date.now() + ME_RESPONSE_CACHE_TTL_MS,
    staleUntilMs: Date.now() + ME_RESPONSE_STALE_FALLBACK_MS,
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

async function readCachedMeResponse(
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
  const redisCached =
    redisEnvelope?.data ??
    normalizeCachedMeResponse(redisRaw);
  if (!redisCached || (!opts?.allowStale && redisEnvelope && nowMs - redisEnvelope.cachedAtMs > ME_RESPONSE_CACHE_TTL_MS)) {
    return null;
  }

  writeLocalMeResponseCache(userId, redisCached);
  return redisCached;
}

function writeCachedMeResponse(userId: string, data: MeResponseUser): void {
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

function buildMeResponseUserFromAuthUser(user: AuthResponseUser): MeResponseUser {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    image: user.image,
    walletAddress: user.walletAddress,
    username: user.username,
    level: user.level,
    xp: user.xp,
    bio: user.bio,
    isAdmin: user.isAdmin,
    isVerified: user.isVerified,
    tradeFeeRewardsEnabled: user.tradeFeeRewardsEnabled,
    tradeFeeShareBps: user.tradeFeeShareBps,
    tradeFeePayoutAddress: user.tradeFeePayoutAddress,
    createdAt: user.createdAt,
  };
}

function buildMeResponseUserFromDbRecord(
  user: {
    id: string;
    name: string;
    email: string;
    image?: string | null;
    walletAddress?: string | null;
    username?: string | null;
    level?: number | null;
    xp?: number | null;
    bio?: string | null;
    role?: string | null;
    isAdmin?: boolean | null;
    isVerified?: boolean | null;
    tradeFeeRewardsEnabled?: boolean | null;
    tradeFeeShareBps?: number | null;
    tradeFeePayoutAddress?: string | null;
    createdAt?: Date | null;
  }
): MeResponseUser {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    image: user.image ?? null,
    walletAddress: user.walletAddress ?? null,
    username: user.username ?? null,
    level: user.level ?? 0,
    xp: user.xp ?? 0,
    bio: user.bio ?? null,
    isAdmin: user.role === "admin" || (user.isAdmin ?? false),
    isVerified: user.isVerified ?? false,
    tradeFeeRewardsEnabled: user.tradeFeeRewardsEnabled ?? true,
    tradeFeeShareBps: normalizeTradeFeeShareBps(user.tradeFeeShareBps),
    tradeFeePayoutAddress: user.tradeFeePayoutAddress ?? null,
    createdAt: user.createdAt ?? new Date(),
  };
}

async function queryMeResponseUserRaw(userId: string): Promise<MeResponseUser | null> {
  // Use SELECT * so this works regardless of which columns exist in DB
  const rows = await prisma.$queryRaw<Array<Record<string, unknown>>>(Prisma.sql`
    SELECT * FROM "User" WHERE id = ${userId} LIMIT 1
  `);

  const row = rows[0];
  if (!row) {
    return null;
  }

  const toNum = (v: unknown, def: number) => {
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v === "bigint") return Number(v);
    return def;
  };

  return {
    id: row.id as string,
    name: (row.name as string) ?? "User",
    email: (row.email as string) ?? "",
    image: (row.image as string) ?? null,
    walletAddress: (row.walletAddress as string) ?? null,
    username: (row.username as string) ?? null,
    level: toNum(row.level, 0),
    xp: toNum(row.xp, 0),
    bio: (row.bio as string) ?? null,
    isAdmin: row.role === "admin" || row.isAdmin === true,
    isVerified: row.isVerified === true,
    tradeFeeRewardsEnabled: row.tradeFeeRewardsEnabled !== false,
    tradeFeeShareBps: normalizeTradeFeeShareBps(toNum(row.tradeFeeShareBps, 50)),
    tradeFeePayoutAddress: (row.tradeFeePayoutAddress as string) ?? null,
    createdAt: row.createdAt as Date,
  };
}

function primeMeResponseCacheFromAuthUser(user: AuthResponseUser): void {
  writeCachedMeResponse(user.id, buildMeResponseUserFromAuthUser(user));
}

async function withTimeoutResult<T>(
  promise: Promise<T>,
  timeoutMs: number
): Promise<{ timedOut: true } | { timedOut: false; value: T }> {
  let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
  try {
    const timeoutPromise = new Promise<{ timedOut: true }>((resolve) => {
      timeoutHandle = setTimeout(() => resolve({ timedOut: true }), timeoutMs);
    });
    const result = await Promise.race([
      promise.then((value) => ({ timedOut: false as const, value })),
      timeoutPromise,
    ]);
    return result;
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
  }
}

const AUTH_DB_LOOKUP_TIMEOUT_MS = (() => {
  const raw = process.env.AUTH_DB_LOOKUP_TIMEOUT_MS;
  const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN;
  if (Number.isFinite(parsed) && parsed > 0) return parsed;
  return process.env.NODE_ENV === "production" ? 6000 : 6500;
})();

class AuthDbTimeoutError extends Error {
  constructor(stage: string, timeoutMs: number) {
    super("[auth/db] " + stage + " timed out after " + timeoutMs + "ms");
    this.name = "AuthDbTimeoutError";
  }
}

function isAuthDbTimeoutError(error: unknown): error is AuthDbTimeoutError {
  return error instanceof AuthDbTimeoutError;
}

const PRIVY_API_TIMEOUT_MS = (() => {
  const raw = process.env.PRIVY_API_TIMEOUT_MS;
  const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN;
  if (Number.isFinite(parsed) && parsed > 0) return parsed;
  return process.env.NODE_ENV === "production" ? 5000 : 6000;
})();

class PrivyApiTimeoutError extends Error {
  constructor(stage: string, timeoutMs: number) {
    super("[privy] " + stage + " timed out after " + timeoutMs + "ms");
    this.name = "PrivyApiTimeoutError";
  }
}

function isPrivyApiTimeoutError(error: unknown): error is PrivyApiTimeoutError {
  return error instanceof PrivyApiTimeoutError;
}

function isTransientAuthAvailabilityError(error: unknown): boolean {
  return isPrismaConnectivityError(error) || isAuthDbTimeoutError(error);
}

async function withPrivyApiTimeout<T>(
  promise: Promise<T>,
  stage: string,
  timeoutMs = PRIVY_API_TIMEOUT_MS
): Promise<T> {
  const result = await withTimeoutResult(promise, timeoutMs);
  if (result.timedOut) {
    throw new PrivyApiTimeoutError(stage, timeoutMs);
  }
  return result.value;
}

async function withAuthDbTimeout<T>(
  promise: Promise<T>,
  stage: string,
  timeoutMs = AUTH_DB_LOOKUP_TIMEOUT_MS
): Promise<T> {
  const result = await withTimeoutResult(promise, timeoutMs);
  if (result.timedOut) {
    throw new AuthDbTimeoutError(stage, timeoutMs);
  }
  return result.value;
}

function normalizeAuthResponseUser(
  user: {
    id: string;
    name: string;
    email: string;
    image?: string | null;
    walletAddress?: string | null;
    walletProvider?: string | null;
    username?: string | null;
    level?: number | null;
    xp?: number | null;
    bio?: string | null;
    role?: string | null;
    isAdmin?: boolean | null;
    isVerified?: boolean | null;
    tradeFeeRewardsEnabled?: boolean | null;
    tradeFeeShareBps?: number | null;
    tradeFeePayoutAddress?: string | null;
    createdAt?: Date | null;
  }
): AuthResponseUser {
  const normalizedRole = user.role?.trim().toLowerCase() === "admin" ? "admin" : "user";
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    image: user.image ?? null,
    walletAddress: user.walletAddress ?? null,
    walletProvider: user.walletProvider ?? null,
    username: user.username ?? null,
    level: user.level ?? 0,
    xp: user.xp ?? 0,
    bio: user.bio ?? null,
    role: normalizedRole,
    isAdmin: normalizedRole === "admin" || (user.isAdmin ?? false),
    isVerified: user.isVerified ?? false,
    tradeFeeRewardsEnabled: user.tradeFeeRewardsEnabled ?? true,
    tradeFeeShareBps: normalizeTradeFeeShareBps(user.tradeFeeShareBps),
    tradeFeePayoutAddress: user.tradeFeePayoutAddress ?? null,
    createdAt: user.createdAt ?? new Date(),
  };
}

function isUniqueConstraintError(error: unknown): error is { code: string } {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
      (error as { code?: unknown }).code === "P2002"
  );
}

type AuthAccountLink = {
  id: string;
  userId: string;
};

const PRIVY_USER_LINK_IDENTIFIER = "privy-user-link";

function buildPrivySyntheticEmail(privyUserId: string): string {
  return `${privyUserId.slice(0, 24).toLowerCase()}@privy.local`;
}

function buildPrivyUserLinkId(privyUserId: string): string {
  return `privy-link:${privyUserId}`;
}

async function findAuthUserByPrivyIdentity(params: {
  privyUserId: string;
  verifiedEmail?: string | null;
}): Promise<AuthResponseUser | null> {
  const syntheticPrivyEmail = buildPrivySyntheticEmail(params.privyUserId);
  const normalizedVerifiedEmail =
    typeof params.verifiedEmail === "string" && params.verifiedEmail.trim().length > 0
      ? params.verifiedEmail.trim().toLowerCase()
      : null;

  const syntheticUser = await findAuthUserByEmail(syntheticPrivyEmail);
  if (syntheticUser) {
    return syntheticUser;
  }

  if (
    normalizedVerifiedEmail &&
    normalizedVerifiedEmail !== syntheticPrivyEmail
  ) {
    return await findAuthUserByEmail(normalizedVerifiedEmail);
  }

  return null;
}

async function findAuthUserLinkByPrivyUserId(
  privyUserId: string
): Promise<AuthAccountLink | null> {
  const record = await withAuthDbTimeout(
    prisma.verification.findUnique({
      where: {
        id: buildPrivyUserLinkId(privyUserId),
      },
      select: {
        id: true,
        value: true,
      },
    }),
    "verification.findUnique(privyUserLink)"
  );

  if (!record || record.value.trim().length === 0) {
    return null;
  }

  return {
    id: record.id,
    userId: record.value.trim(),
  };
}

async function writeAuthUserLinkForPrivyUserId(params: {
  privyUserId: string;
  userId: string;
  now: Date;
}): Promise<AuthAccountLink | null> {
  const farFuture = new Date("2999-12-31T00:00:00.000Z");
  const record = await withAuthDbTimeout(
    prisma.verification.upsert({
      where: {
        id: buildPrivyUserLinkId(params.privyUserId),
      },
      update: {
        identifier: PRIVY_USER_LINK_IDENTIFIER,
        value: params.userId,
        expiresAt: farFuture,
        updatedAt: params.now,
      },
      create: {
        id: buildPrivyUserLinkId(params.privyUserId),
        identifier: PRIVY_USER_LINK_IDENTIFIER,
        value: params.userId,
        expiresAt: farFuture,
        createdAt: params.now,
        updatedAt: params.now,
      },
      select: {
        id: true,
        value: true,
      },
    }),
    "verification.upsert(privyUserLink)"
  );

  return {
    id: record.id,
    userId: record.value.trim(),
  };
}

function toAuthResponseUserFromSessionUser(
  sessionUser:
    | {
        id: string;
        name: string;
        email: string;
        image: string | null;
        walletAddress: string | null;
        walletProvider: string | null;
        username?: string | null;
        level: number;
        xp: number;
        bio?: string | null;
        role?: string | null;
        isAdmin?: boolean;
        isVerified: boolean;
        tradeFeeRewardsEnabled?: boolean;
        tradeFeeShareBps?: number;
        tradeFeePayoutAddress?: string | null;
        createdAt?: Date;
      }
    | null
    | undefined
): AuthResponseUser | null {
  if (!sessionUser?.id) return null;
  const normalizedEmail = sessionUser.email?.trim() || `${sessionUser.id.slice(0, 24).toLowerCase()}@privy.local`;
  const normalizedName = sessionUser.name?.trim() || normalizedEmail.split("@")[0] || "User";
  return normalizeAuthResponseUser({
    id: sessionUser.id,
    name: normalizedName,
    email: normalizedEmail,
    image: sessionUser.image,
    walletAddress: sessionUser.walletAddress,
    walletProvider: sessionUser.walletProvider,
    username: sessionUser.username,
    level: sessionUser.level,
    xp: sessionUser.xp,
    bio: sessionUser.bio,
    role: sessionUser.role,
    isAdmin: sessionUser.isAdmin,
    isVerified: sessionUser.isVerified,
    tradeFeeRewardsEnabled: sessionUser.tradeFeeRewardsEnabled,
    tradeFeeShareBps: sessionUser.tradeFeeShareBps,
    tradeFeePayoutAddress: sessionUser.tradeFeePayoutAddress,
    createdAt: sessionUser.createdAt,
  });
}

function clearCachedMeResponse(userId: string): void {
  meResponseCache.delete(userId);
  void redisDelete(buildMeResponseRedisKey(userId));
}

function normalizeOptionalDisplayName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function isSyntheticAuthEmail(email: string | null | undefined): boolean {
  if (typeof email !== "string") return false;
  const normalized = email.trim().toLowerCase();
  return normalized.endsWith("@privy.local") || normalized.endsWith("@wallet.local");
}

function shouldUpdateAuthDisplayName(user: AuthResponseUser, nextName: string | null): boolean {
  if (!nextName) return false;

  const currentName = user.name.trim();
  const normalizedCurrentName = currentName.toLowerCase();
  const normalizedNextName = nextName.trim().toLowerCase();
  if (!normalizedNextName || normalizedCurrentName === normalizedNextName) {
    return false;
  }

  if (!currentName) {
    return true;
  }

  const currentEmailLocalPart = user.email.trim().toLowerCase().split("@")[0] ?? "";
  return (
    normalizedCurrentName === currentEmailLocalPart ||
    normalizedCurrentName === "user" ||
    (isSyntheticAuthEmail(user.email) && normalizedCurrentName === currentEmailLocalPart)
  );
}

async function reconcilePrivyLinkedUserProfile(params: {
  user: AuthResponseUser;
  verifiedEmail: string;
  preferredName?: string | null;
  privyUserId: string;
}): Promise<AuthResponseUser> {
  const currentEmail = params.user.email.trim().toLowerCase();
  const verifiedEmail = params.verifiedEmail.trim().toLowerCase();
  const nextName = normalizeOptionalDisplayName(params.preferredName);
  const nextEmailCandidate =
    verifiedEmail && verifiedEmail !== currentEmail ? verifiedEmail : currentEmail;

  let nextEmail = currentEmail;
  if (nextEmailCandidate !== currentEmail && !isSyntheticAuthEmail(nextEmailCandidate)) {
    const conflictingUser = await findAuthUserByEmail(nextEmailCandidate);
    if (conflictingUser && conflictingUser.id !== params.user.id) {
      console.warn("[privy-sync] Verified email is already mapped to a different local user", {
        privyUserId: params.privyUserId,
        userId: params.user.id,
        conflictingUserId: conflictingUser.id,
        currentEmail,
        verifiedEmail: nextEmailCandidate,
      });
    } else {
      nextEmail = nextEmailCandidate;
    }
  }

  const shouldUpdateName = shouldUpdateAuthDisplayName(params.user, nextName);
  const nextResolvedName = shouldUpdateName && nextName ? nextName : params.user.name;

  if (nextEmail === currentEmail && nextResolvedName === params.user.name) {
    return params.user;
  }

  const updateData: { email?: string; name?: string } = {};
  if (nextEmail !== currentEmail) {
    updateData.email = nextEmail;
  }
  if (nextResolvedName !== params.user.name) {
    updateData.name = nextResolvedName;
  }

  try {
    await withAuthDbTimeout(
      prisma.user.update({
        where: { id: params.user.id },
        data: updateData,
        select: { id: true },
      }),
      "user.update(reconcile)"
    );
    clearCachedMeResponse(params.user.id);
    const refreshedUser = await findAuthUserById(params.user.id);
    return refreshedUser ?? normalizeAuthResponseUser({ ...params.user, ...updateData });
  } catch (error) {
    if (!isUniqueConstraintError(error) || !("email" in updateData)) {
      throw error;
    }

    console.warn("[privy-sync] Email reconciliation lost a uniqueness race; preserving current email", {
      privyUserId: params.privyUserId,
      userId: params.user.id,
      attemptedEmail: updateData.email,
    });

    if (!("name" in updateData)) {
      return params.user;
    }

    await withAuthDbTimeout(
      prisma.user.update({
        where: { id: params.user.id },
        data: { name: nextResolvedName },
        select: { id: true },
      }),
      "user.update(reconcileNameOnly)"
    );
    clearCachedMeResponse(params.user.id);
    const refreshedUser = await findAuthUserById(params.user.id);
    return refreshedUser ?? normalizeAuthResponseUser({ ...params.user, name: nextResolvedName });
  }
}

async function findAuthUserByUnique(
  where: Prisma.UserWhereUniqueInput,
  stageLabel: string
): Promise<AuthResponseUser | null> {
  for (const mode of getAuthResponseUserLookupModes()) {
    const stage =
      mode === "full"
        ? `${stageLabel}`
        : mode === "fallback"
          ? `${stageLabel}:fallback`
          : `${stageLabel}:minimal`;

    try {
      const user = await withAuthDbTimeout(
        prisma.user.findUnique({
          where,
          select: getAuthResponseUserSelect(mode),
        }),
        stage
      );
      return user ? normalizeAuthResponseUser(user) : null;
    } catch (error) {
      if (!isPrismaSchemaDriftError(error)) {
        throw error;
      }
      const nextMode = getNextAuthResponseUserLookupMode(mode);
      if (nextMode) {
        updateAuthResponseUserLookupMode(nextMode, error);
        continue;
      }
      return null;
    }
  }

  return null;
}

async function findAuthUserByWallet(walletAddress: string): Promise<AuthResponseUser | null> {
  return await findAuthUserByUnique({ walletAddress }, "user.findUnique(wallet)");
}

async function findAuthUserByEmail(email: string): Promise<AuthResponseUser | null> {
  return await findAuthUserByUnique({ email }, "user.findUnique(email)");
}

async function findAuthUserById(id: string): Promise<AuthResponseUser | null> {
  return await findAuthUserByUnique({ id }, "user.findUnique(id)");
}

async function createWalletAuthUser(params: {
  walletAddress: string;
  walletProvider: string | null | undefined;
  now: Date;
}): Promise<AuthResponseUser> {
  const userId = crypto.randomUUID().replace(/-/g, "").slice(0, 32);
  const normalizedWalletAddress = params.walletAddress;
  const now = params.now;
  try {
    const created = await withAuthDbTimeout(
      prisma.user.create({
      data: {
        id: userId,
        email: `${normalizedWalletAddress.slice(0, 8).toLowerCase()}@wallet.local`,
        name: `${normalizedWalletAddress.slice(0, 6)}...${normalizedWalletAddress.slice(-4)}`,
        walletAddress: normalizedWalletAddress,
        walletProvider: params.walletProvider || "unknown",
        walletConnectedAt: now,
        emailVerified: false,
        level: 0,
        xp: 0,
        role: "user",
        isAdmin: false,
        isBanned: false,
        createdAt: now,
        updatedAt: now,
      },
      select: getAuthResponseUserSelect(authResponseUserLookupMode),
      }),
      "user.create(wallet)"
    );
    return normalizeAuthResponseUser(created);
  } catch (error) {
    if (!isPrismaSchemaDriftError(error)) {
      throw error;
    }
    const nextLookupMode =
      getNextAuthResponseUserLookupMode(authResponseUserLookupMode) ??
      authResponseUserLookupMode;
    updateAuthResponseUserLookupMode(nextLookupMode, error);

    let fallbackCreated:
      | {
          id: string;
          name: string;
          email: string;
          image: string | null;
        }
      | null = null;

    try {
      fallbackCreated = await withAuthDbTimeout(
        prisma.user.create({
        data: {
          id: userId,
          email: `${normalizedWalletAddress.slice(0, 8).toLowerCase()}@wallet.local`,
          name: `${normalizedWalletAddress.slice(0, 6)}...${normalizedWalletAddress.slice(-4)}`,
          walletAddress: normalizedWalletAddress,
          emailVerified: false,
        },
        select: AUTH_RESPONSE_USER_FALLBACK_SELECT,
        }),
        "user.create(wallet:fallback)"
      );
    } catch (fallbackCreateError) {
      if (isPrismaSchemaDriftError(fallbackCreateError)) {
        try {
          fallbackCreated = await withAuthDbTimeout(
            prisma.user.create({
            data: {
              id: userId,
              email: `${normalizedWalletAddress.slice(0, 8).toLowerCase()}@wallet.local`,
              name: `${normalizedWalletAddress.slice(0, 6)}...${normalizedWalletAddress.slice(-4)}`,
              emailVerified: false,
            },
            select: AUTH_RESPONSE_USER_FALLBACK_SELECT,
            }),
            "user.create(wallet:minimalCompat)"
          );

          return normalizeAuthResponseUser({
            ...fallbackCreated,
            walletAddress: normalizedWalletAddress,
          });
        } catch (minimalCreateError) {
          if (isUniqueConstraintError(minimalCreateError)) {
            const existingByEmail = await findAuthUserByEmail(
              `${normalizedWalletAddress.slice(0, 8).toLowerCase()}@wallet.local`
            );
            if (existingByEmail) {
              return {
                ...existingByEmail,
                walletAddress: normalizedWalletAddress,
              };
            }
          }
          throw minimalCreateError;
        }
      }
      if (!isUniqueConstraintError(fallbackCreateError)) {
        throw fallbackCreateError;
      }
      const existing = await findAuthUserByWallet(normalizedWalletAddress);
      if (existing) {
        return existing;
      }
      throw fallbackCreateError;
    }

    return normalizeAuthResponseUser(fallbackCreated);
  }
}

async function upsertAuthUserByEmail(params: {
  email: string;
  displayName: string;
  now: Date;
}): Promise<AuthResponseUser> {
  try {
    const user = await withAuthDbTimeout(
      prisma.user.upsert({
      where: { email: params.email },
      update: {
        emailVerified: true,
      },
      create: {
        id: crypto.randomUUID().replace(/-/g, "").slice(0, 32),
        email: params.email,
        name: params.displayName,
        emailVerified: true,
        level: 0,
        xp: 0,
        role: "user",
        isAdmin: false,
        isBanned: false,
        createdAt: params.now,
        updatedAt: params.now,
      },
      select: getAuthResponseUserSelect(authResponseUserLookupMode),
      }),
      "user.upsert(email)"
    );
    return normalizeAuthResponseUser(user);
  } catch (error) {
    if (!isPrismaSchemaDriftError(error)) {
      throw error;
    }
    const nextLookupMode =
      getNextAuthResponseUserLookupMode(authResponseUserLookupMode) ??
      authResponseUserLookupMode;
    updateAuthResponseUserLookupMode(nextLookupMode, error);

    const existing = await findAuthUserByEmail(params.email);
    if (existing) {
      return existing;
    }

    try {
      const fallbackCreated = await withAuthDbTimeout(
        prisma.user.create({
        data: {
          id: crypto.randomUUID().replace(/-/g, "").slice(0, 32),
          email: params.email,
          name: params.displayName,
          emailVerified: true,
        },
        select: AUTH_RESPONSE_USER_FALLBACK_SELECT,
        }),
        "user.create(email:fallback)"
      );
      return normalizeAuthResponseUser(fallbackCreated);
    } catch (fallbackCreateError) {
      if (isUniqueConstraintError(fallbackCreateError)) {
        const concurrentUser = await findAuthUserByEmail(params.email);
        if (concurrentUser) {
          return concurrentUser;
        }
      }
      if (isPrismaSchemaDriftError(fallbackCreateError)) {
        const minimalCreated = await withAuthDbTimeout(
          prisma.user.create({
          data: {
            id: crypto.randomUUID().replace(/-/g, "").slice(0, 32),
            email: params.email,
            name: params.displayName,
          },
          select: AUTH_RESPONSE_USER_MINIMAL_SELECT,
          }),
          "user.create(email:minimal)"
        );
        return normalizeAuthResponseUser(minimalCreated);
      }
      throw fallbackCreateError;
    }
  }
}

async function createSessionRecord(params: {
  sessionToken: string;
  userId: string;
  expiresAt: Date;
  now: Date;
  ipAddress: string;
  userAgent: string;
}): Promise<void> {
  try {
    await prisma.session.create({
      data: {
        id: crypto.randomUUID().replace(/-/g, "").slice(0, 32),
        token: params.sessionToken,
        userId: params.userId,
        expiresAt: params.expiresAt,
        createdAt: params.now,
        updatedAt: params.now,
        ipAddress: params.ipAddress,
        userAgent: params.userAgent,
      },
    });
    return;
  } catch (error) {
    if (!isPrismaSchemaDriftError(error) && !isPrismaClientError(error)) {
      throw error;
    }
  }

  try {
    await prisma.session.create({
      data: {
        id: crypto.randomUUID().replace(/-/g, "").slice(0, 32),
        token: params.sessionToken,
        userId: params.userId,
        expiresAt: params.expiresAt,
      },
    });
    return;
  } catch (fallbackError) {
    if (
      !isPrismaSchemaDriftError(fallbackError) &&
      !isPrismaClientError(fallbackError) &&
      !isUniqueConstraintError(fallbackError)
    ) {
      throw fallbackError;
    }
  }

  console.warn("[auth/session] Session store unavailable; continuing with signed stateless token fallback");
}

type SessionRecordWriteOutcome = "written" | "timed_out" | "failed";

const SESSION_RECORD_WRITE_TIMEOUT_MS = (() => {
  const raw = process.env.SESSION_RECORD_WRITE_TIMEOUT_MS;
  const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN;
  if (Number.isFinite(parsed) && parsed > 0) return parsed;
  return process.env.NODE_ENV === "production" ? 1500 : 1200;
})();

async function createSessionRecordBestEffort(params: {
  sessionToken: string;
  userId: string;
  expiresAt: Date;
  now: Date;
  ipAddress: string;
  userAgent: string;
}): Promise<SessionRecordWriteOutcome> {
  let timedOut = false;
  let timeoutHandle: ReturnType<typeof setTimeout> | null = null;

  const writePromise = createSessionRecord(params)
    .then(() => "written" as const)
    .catch((error) => {
      if (timedOut) {
        console.warn("[auth/session] Session write failed after timeout window", error);
      } else {
        console.warn("[auth/session] Session write failed; using stateless token only", error);
      }
      return "failed" as const;
    });

  const timeoutPromise = new Promise<"timed_out">((resolve) => {
    timeoutHandle = setTimeout(() => {
      timedOut = true;
      resolve("timed_out");
    }, SESSION_RECORD_WRITE_TIMEOUT_MS);
  });

  const outcome = await Promise.race([writePromise, timeoutPromise]);

  if (timeoutHandle) {
    clearTimeout(timeoutHandle);
  }

  if (outcome === "timed_out") {
    console.warn(
      `[auth/session] Session write exceeded ${SESSION_RECORD_WRITE_TIMEOUT_MS}ms; continuing without blocking sign-in`
    );
  }
  return outcome;
}

function queueSessionRecordBestEffort(params: {
  sessionToken: string;
  userId: string;
  expiresAt: Date;
  now: Date;
  ipAddress: string;
  userAgent: string;
}): void {
  void createSessionRecordBestEffort(params).catch((error) => {
    console.warn("[auth/session] Background session write scheduling failed", error);
  });
}

const LEGACY_SESSION_COOKIE_NAMES = [
  "better-auth.session_token",
  "auth.session_token",
  "session_token",
] as const;
const SESSION_COOKIE_NAME = "phew.session_token";
const SESSION_COOKIE_PATH = "/";
const SESSION_COOKIE_SAME_SITE = "Lax";
const SESSION_COOKIE_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;
const INCOMING_SESSION_COOKIE_NAMES = [
  SESSION_COOKIE_NAME,
  ...LEGACY_SESSION_COOKIE_NAMES,
] as const;

function readSessionCookieToken(cookieHeader: string | undefined): string | null {
  if (!cookieHeader) return null;

  for (const cookieName of INCOMING_SESSION_COOKIE_NAMES) {
    const escapedName = cookieName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${escapedName}=([^;]+)`));
    const rawValue = match?.[1]?.trim();
    if (!rawValue) continue;
    try {
      return decodeURIComponent(rawValue);
    } catch {
      return rawValue;
    }
  }

  return null;
}

function buildSessionCookie(params: {
  name: string;
  value: string;
  domain?: string;
  maxAgeSeconds: number;
  secure: boolean;
}): string {
  return [
    `${params.name}=${params.value}`,
    `Path=${SESSION_COOKIE_PATH}`,
    "HttpOnly",
    `SameSite=${SESSION_COOKIE_SAME_SITE}`,
    `Max-Age=${params.maxAgeSeconds}`,
    params.domain ? `Domain=${params.domain}` : "",
    params.secure ? "Secure" : "",
  ]
    .filter(Boolean)
    .join("; ");
}

function applySessionCookies(c: Context, sessionToken: string): void {
  const isProd = process.env.NODE_ENV === "production";
  const cookieDomain = resolveSessionCookieDomain(c.req.header("host"));
  const cookies: string[] = [];

  cookies.push(...buildClearedSessionCookies(c.req.header("host"), { includeLegacy: false }));

  // Set the canonical session cookie last so it wins within the response.
  cookies.push(
    buildSessionCookie({
      name: SESSION_COOKIE_NAME,
      value: sessionToken,
      domain: cookieDomain ?? undefined,
      maxAgeSeconds: SESSION_COOKIE_MAX_AGE_SECONDS,
      secure: isProd,
    })
  );

  cookies.forEach((cookie, index) => {
    c.header("Set-Cookie", cookie, index === 0 ? undefined : { append: true });
  });
}

function logIssuedSessionCookie(
  c: Context,
  userId: string,
  sessionRecordWriteOutcome: SessionRecordWriteOutcome
): void {
  const isProd = process.env.NODE_ENV === "production";
  const cookieDomain = resolveSessionCookieDomain(c.req.header("host"));
  const clearedCookieNames = [SESSION_COOKIE_NAME];
  console.info("[auth/session] Issued session cookie", {
    requestId: c.get("requestId") ?? null,
    host: c.req.header("host") ?? null,
    origin: c.req.header("origin") ?? null,
    userAgent: c.req.header("user-agent") ?? null,
    userId,
    cookieName: SESSION_COOKIE_NAME,
    clearedCookieNames,
    clearedLegacyCookieNames: [],
    setCookieCount:
      buildClearedSessionCookies(c.req.header("host"), { includeLegacy: false }).length + 1,
    domain: cookieDomain ?? null,
    path: SESSION_COOKIE_PATH,
    httpOnly: true,
    secure: isProd,
    sameSite: SESSION_COOKIE_SAME_SITE,
    maxAgeSeconds: SESSION_COOKIE_MAX_AGE_SECONDS,
    sessionRecordWriteOutcome,
  });
}

function maybeRefreshSessionCookieAfterFallback(
  c: Context,
  sessionUser:
    | {
        id: string;
        name: string;
        email: string;
        image: string | null;
        walletAddress: string | null;
        walletProvider: string | null;
        username?: string | null;
        level: number;
        xp: number;
        bio?: string | null;
        role?: string | null;
        isAdmin?: boolean;
        isVerified: boolean;
        tradeFeeRewardsEnabled?: boolean;
        tradeFeeShareBps?: number;
        tradeFeePayoutAddress?: string | null;
        createdAt?: Date;
      }
    | null
    | undefined
): void {
  if (!sessionUser?.id) return;

  const cookieToken = readSessionCookieToken(c.req.header("cookie"));
  if (!cookieToken || !cookieToken.startsWith("v1.")) {
    return;
  }

  if (verifySignedSessionToken(cookieToken)) {
    return;
  }

  const authUser = toAuthResponseUserFromSessionUser(sessionUser);
  if (!authUser) {
    return;
  }

  const now = new Date();
  const refreshedToken = createSignedSessionToken({
    userId: authUser.id,
    now,
    user: buildSessionTokenUserClaims(authUser),
  });
  applySessionCookies(c, refreshedToken);
  logIssuedSessionCookie(c, authUser.id, "written");
  queueSessionRecordBestEffort({
    sessionToken: refreshedToken,
    userId: authUser.id,
    expiresAt: new Date(now.getTime() + SESSION_COOKIE_MAX_AGE_SECONDS * 1000),
    now,
    ipAddress: c.req.header("x-forwarded-for") || c.req.header("x-real-ip") || "unknown",
    userAgent: c.req.header("user-agent") || "unknown",
  });
  console.warn("[/api/me] Refreshed invalid signed session cookie from recovered session");
}

async function issueAuthSessionResponse(
  c: Context,
  user: AuthResponseUser,
  now = new Date()
) {
  const sessionToken = createSignedSessionToken({
    userId: user.id,
    now,
    user: buildSessionTokenUserClaims(user),
  });
  const expiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

  const sessionRecordWriteOutcome = await createSessionRecordBestEffort({
    sessionToken,
    userId: user.id,
    expiresAt,
    now,
    ipAddress: c.req.header("x-forwarded-for") || c.req.header("x-real-ip") || "unknown",
    userAgent: c.req.header("user-agent") || "unknown",
  });

  applySessionCookies(c, sessionToken);
  logIssuedSessionCookie(c, user.id, sessionRecordWriteOutcome);
  primeMeResponseCacheFromAuthUser(user);

  return c.json({
    user: buildClientAuthUser(user),
  });
}

function buildClearedSessionCookies(
  hostHeader: string | undefined,
  options?: { includeLegacy?: boolean }
): string[] {
  const isProd = process.env.NODE_ENV === "production";
  const cookieDomain = resolveSessionCookieDomain(hostHeader);
  const includeLegacy = options?.includeLegacy ?? true;
  const cookies: string[] = [
    buildSessionCookie({
      name: SESSION_COOKIE_NAME,
      value: "",
      maxAgeSeconds: 0,
      secure: isProd,
    }),
  ];

  if (includeLegacy) {
    for (const cookieName of LEGACY_SESSION_COOKIE_NAMES) {
      cookies.push(
        buildSessionCookie({
          name: cookieName,
          value: "",
          maxAgeSeconds: 0,
          secure: isProd,
        })
      );
    }
  }

  if (cookieDomain) {
    cookies.push(
      buildSessionCookie({
        name: SESSION_COOKIE_NAME,
        value: "",
        domain: cookieDomain,
        maxAgeSeconds: 0,
        secure: isProd,
      })
    );
    if (includeLegacy) {
      for (const cookieName of LEGACY_SESSION_COOKIE_NAMES) {
        cookies.push(
          buildSessionCookie({
            name: cookieName,
            value: "",
            domain: cookieDomain,
            maxAgeSeconds: 0,
            secure: isProd,
          })
        );
      }
    }
  }

  return cookies;
}

function resolveSessionCookieDomain(hostHeader: string | undefined): string | null {
  if (!hostHeader) return null;
  const normalizedHost = hostHeader.split(":")[0]?.trim().toLowerCase() ?? "";
  if (!normalizedHost) return null;
  // Share cookies only on canonical production hosts.
  // Preview/staging subdomains must stay isolated to avoid cross-environment token collisions.
  if (normalizedHost === "phew.run" || normalizedHost === "www.phew.run") {
    return ".phew.run";
  }
  return null;
}

// Vibecode proxy patches global fetch for the Vibecode runtime, but it can break or add
// noise in generic Node serverless environments (e.g. Vercel).
if (!process.env.VERCEL) {
  try {
    await import("@vibecodeapp/proxy");
  } catch (error) {
    console.warn("[Startup] Failed to initialize Vibecode proxy:", error);
  }
}

// Verify Solana wallet signature
function verifySolanaSignature(
  message: string,
  signature: string,
  publicKeyStr: string
): boolean {
  try {
    const messageBytes = new TextEncoder().encode(message);
    const signatureBytes = bs58.decode(signature);
    const publicKey = new PublicKey(publicKeyStr);
    const publicKeyBytes = publicKey.toBytes();

    return nacl.sign.detached.verify(messageBytes, signatureBytes, publicKeyBytes);
  } catch (error) {
    console.error("Signature verification error:", error);
    return false;
  }
}

const WALLET_AUTH_MESSAGE_MAX_AGE_MS = 5 * 60 * 1000;
const walletAuthNonceReplayCache = new Map<string, number>();

function validateWalletAuthMessage(
  message: string,
  walletAddress: string
): { ok: true; nonce: string } | { ok: false; reason: string } {
  const normalized = message.trim();

  if (normalized.length === 0 || normalized.length > 4096) {
    return { ok: false, reason: "Invalid auth message length" };
  }

  if (!normalized.includes("verify your wallet ownership")) {
    return { ok: false, reason: "Invalid wallet auth challenge" };
  }

  if (!normalized.includes(`Wallet: ${walletAddress}`)) {
    return { ok: false, reason: "Wallet address mismatch in auth message" };
  }

  const lines = normalized.split("\n").map((line) => line.trim());

  const nonceLine = lines.find((line) => line.startsWith("Nonce: "));
  const nonce = nonceLine?.slice("Nonce: ".length).trim() ?? "";
  if (!/^[a-f0-9]{16,128}$/i.test(nonce)) {
    return { ok: false, reason: "Missing or invalid nonce in auth message" };
  }

  const timestampLine = lines.find((line) => line.startsWith("Timestamp: "));
  const timestampValue = timestampLine?.slice("Timestamp: ".length).trim();
  const timestampMs = timestampValue ? Date.parse(timestampValue) : Number.NaN;
  if (!Number.isFinite(timestampMs)) {
    return { ok: false, reason: "Missing or invalid timestamp in auth message" };
  }

  if (Math.abs(Date.now() - timestampMs) > WALLET_AUTH_MESSAGE_MAX_AGE_MS) {
    return { ok: false, reason: "Wallet auth message expired. Please sign again." };
  }

  return { ok: true, nonce };
}

const WalletAuthRequestSchema = z
  .object({
    walletAddress: z.string().trim().min(32).max(64),
    walletProvider: z.string().trim().min(1).max(64).optional(),
    signature: z.string().trim().min(1).max(1024),
    message: z.string().trim().min(1).max(4096),
  })
  .strict();

const PrivySyncRequestSchema = z
  .object({
    privyIdToken: z.string().trim().min(1).max(4096).optional(),
    name: z.string().trim().max(120).optional(),
  })
  .strict();

const PRIVY_ID_TOKEN_COOKIE_NAME = "privy-id-token";
const PRIVY_ID_TOKEN_HEADER_NAME = "privy-id-token";
const PRIVY_AUTH_TOKEN_COOKIE_NAME = "privy-token";

type VerifiedPrivyUserLike = {
  id?: unknown;
  email?: { address?: unknown } | null;
  linkedAccounts?: Array<{ type?: unknown; address?: unknown }> | null;
};

type PrivyAuthTokenClaimsLike = {
  userId?: unknown;
};

function normalizeRequestTokenCandidate(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function readCookieValue(cookieHeader: string | undefined, cookieName: string): string | null {
  if (!cookieHeader) {
    return null;
  }

  const segments = cookieHeader.split(";");
  for (const segment of segments) {
    const separatorIndex = segment.indexOf("=");
    if (separatorIndex <= 0) {
      continue;
    }

    const rawName = segment.slice(0, separatorIndex).trim();
    if (rawName !== cookieName) {
      continue;
    }

    const rawValue = segment.slice(separatorIndex + 1).trim();
    if (!rawValue) {
      return null;
    }

    try {
      return decodeURIComponent(rawValue);
    } catch {
      return rawValue;
    }
  }

  return null;
}

function readAuthorizationBearerToken(headerValue: string | undefined): string | null {
  if (!headerValue) {
    return null;
  }

  const normalizedHeader = headerValue.trim();
  if (!normalizedHeader.toLowerCase().startsWith("bearer ")) {
    return null;
  }

  const token = normalizedHeader.slice("bearer ".length).trim();
  return token.length > 0 ? token : null;
}

function buildPrivyTokenCacheKey(prefix: "id_token" | "auth_token", token: string | null): string | null {
  if (!token || token.length <= 32) {
    return null;
  }
  return `${prefix}:${token.slice(-32)}`;
}

function getPrivyEmailFromVerifiedUser(user: VerifiedPrivyUserLike): string | null {
  const directEmail = user.email?.address;
  if (typeof directEmail === "string" && directEmail.includes("@")) {
    return directEmail.trim().toLowerCase();
  }

  const linkedEmail = user.linkedAccounts?.find(
    (account) =>
      account?.type === "email" &&
      typeof account.address === "string" &&
      account.address.includes("@")
  );

  return typeof linkedEmail?.address === "string"
    ? linkedEmail.address.trim().toLowerCase()
    : null;
}

async function resolveVerifiedPrivyRequestIdentity(
  c: Context,
  bodyPrivyIdToken: string | null
): Promise<{
  verifiedPrivyUserId: string;
  verifiedEmail: string;
  verificationMethod: "id_token" | "auth_token";
  verificationSource: "body" | "header" | "cookie" | "authorization";
}> {
  if (!PRIVY_CLIENT) {
    throw new Error("Privy client is not configured");
  }

  const requestCookieHeader = c.req.header("cookie");
  const idTokenCandidates = [
    {
      value: normalizeRequestTokenCandidate(bodyPrivyIdToken),
      source: "body" as const,
    },
    {
      value: normalizeRequestTokenCandidate(c.req.header(PRIVY_ID_TOKEN_HEADER_NAME)),
      source: "header" as const,
    },
    {
      value: normalizeRequestTokenCandidate(
        readCookieValue(requestCookieHeader, PRIVY_ID_TOKEN_COOKIE_NAME)
      ),
      source: "cookie" as const,
    },
  ];
  const idTokenCandidate = idTokenCandidates.find((candidate) => Boolean(candidate.value));

  if (idTokenCandidate?.value) {
    try {
      const verifiedTokenUser = (await withPrivyApiTimeout(
        PRIVY_CLIENT.getUser({ idToken: idTokenCandidate.value }) as Promise<VerifiedPrivyUserLike>,
        `privy.getUser(idToken:${idTokenCandidate.source})`
      )) as VerifiedPrivyUserLike;
      const verifiedPrivyUserId =
        typeof verifiedTokenUser.id === "string" && verifiedTokenUser.id.trim().length > 0
          ? verifiedTokenUser.id.trim()
          : null;

      if (!verifiedPrivyUserId) {
        throw new Error("Invalid Privy identity token");
      }

      const verifiedEmail =
        getPrivyEmailFromVerifiedUser(verifiedTokenUser) ||
        buildPrivySyntheticEmail(verifiedPrivyUserId);
      const privyCacheKey = buildPrivyTokenCacheKey("id_token", idTokenCandidate.value);

      writeCachedPrivyIdentity(privyCacheKey, {
        userId: verifiedPrivyUserId,
        email: verifiedEmail,
      });

      return {
        verifiedPrivyUserId,
        verifiedEmail,
        verificationMethod: "id_token",
        verificationSource: idTokenCandidate.source,
      };
    } catch (error) {
      console.warn("[privy-sync] Privy ID token verification failed; falling back to auth token", {
        requestId: c.get("requestId") ?? null,
        source: idTokenCandidate.source,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const authTokenCandidates = [
    {
      value: normalizeRequestTokenCandidate(
        readCookieValue(requestCookieHeader, PRIVY_AUTH_TOKEN_COOKIE_NAME)
      ),
      source: "cookie" as const,
    },
    {
      value: normalizeRequestTokenCandidate(c.req.header(PRIVY_AUTH_TOKEN_COOKIE_NAME)),
      source: "header" as const,
    },
    {
      value: normalizeRequestTokenCandidate(
        readAuthorizationBearerToken(c.req.header("authorization"))
      ),
      source: "authorization" as const,
    },
  ];
  const authTokenCandidate = authTokenCandidates.find((candidate) => Boolean(candidate.value));

  if (!authTokenCandidate?.value) {
    throw new Error("Missing verified Privy session token");
  }

  const verifiedClaims = (await withPrivyApiTimeout(
    PRIVY_CLIENT.verifyAuthToken(authTokenCandidate.value),
    `privy.verifyAuthToken(${authTokenCandidate.source})`
  )) as PrivyAuthTokenClaimsLike;
  const verifiedPrivyUserId =
    typeof verifiedClaims.userId === "string" && verifiedClaims.userId.trim().length > 0
      ? verifiedClaims.userId.trim()
      : null;

  if (!verifiedPrivyUserId) {
    throw new Error("Invalid Privy auth token");
  }

  const cachedAuthUser = await readCachedPrivyAuthUser(verifiedPrivyUserId);
  let verifiedEmail =
    typeof cachedAuthUser?.email === "string" && cachedAuthUser.email.includes("@")
      ? cachedAuthUser.email.trim().toLowerCase()
      : null;

  if (!verifiedEmail) {
    const verifiedPrivyUser = (await withPrivyApiTimeout(
      PRIVY_CLIENT.getUserById(verifiedPrivyUserId) as Promise<VerifiedPrivyUserLike>,
      "privy.getUserById(verifiedPrivyUserId)"
    )) as VerifiedPrivyUserLike;
    verifiedEmail = getPrivyEmailFromVerifiedUser(verifiedPrivyUser);
  }

  const normalizedVerifiedEmail =
    verifiedEmail || buildPrivySyntheticEmail(verifiedPrivyUserId);
  const privyCacheKey = buildPrivyTokenCacheKey("auth_token", authTokenCandidate.value);

  writeCachedPrivyIdentity(privyCacheKey, {
    userId: verifiedPrivyUserId,
    email: normalizedVerifiedEmail,
  });

  return {
    verifiedPrivyUserId,
    verifiedEmail: normalizedVerifiedEmail,
    verificationMethod: "auth_token",
    verificationSource: authTokenCandidate.source,
  };
}

function consumeWalletAuthNonce(walletAddress: string, nonce: string): boolean {
  const now = Date.now();
  for (const [key, expiresAtMs] of walletAuthNonceReplayCache) {
    if (expiresAtMs <= now) walletAuthNonceReplayCache.delete(key);
  }

  const replayKey = `${walletAddress}:${nonce}`;
  const existing = walletAuthNonceReplayCache.get(replayKey);
  if (existing && existing > now) {
    return false;
  }

  walletAuthNonceReplayCache.set(replayKey, now + WALLET_AUTH_MESSAGE_MAX_AGE_MS);
  return true;
}

// Sign up / Sign in with wallet address
// This creates a user account using wallet address as identifier
app.post("/api/auth/wallet", async (c) => {
  try {
    const parsedBody = WalletAuthRequestSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsedBody.success) {
      return c.json(
        { error: { message: "Invalid wallet authentication payload", code: "INVALID_INPUT" } },
        400
      );
    }
    const { walletAddress, walletProvider, signature, message } = parsedBody.data;

    const normalizedWalletAddress = walletAddress.trim();

    // Validate wallet address format (Solana or EVM)
    const solanaRegex = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
    const evmRegex = /^0x[a-fA-F0-9]{40}$/;

    if (!solanaRegex.test(normalizedWalletAddress) && !evmRegex.test(normalizedWalletAddress)) {
      return c.json(
        { error: { message: "Invalid wallet address format", code: "INVALID_INPUT" } },
        400
      );
    }

    // Security hardening: EVM auth is disabled until signature verification is implemented.
    if (evmRegex.test(normalizedWalletAddress)) {
      return c.json(
        {
          error: {
            message: "EVM wallet sign-in is not enabled yet. Use Solana wallet sign-in or Privy email sign-in.",
            code: "UNSUPPORTED_WALLET_AUTH",
          },
        },
        400
      );
    }

    // For Solana wallets, verify the signature
    if (solanaRegex.test(normalizedWalletAddress)) {
      const challenge = validateWalletAuthMessage(message, normalizedWalletAddress);
      if (!challenge.ok) {
        return c.json(
          { error: { message: challenge.reason, code: "INVALID_MESSAGE" } },
          401
        );
      }

      if (!consumeWalletAuthNonce(normalizedWalletAddress, challenge.nonce)) {
        return c.json(
          { error: { message: "This wallet auth message was already used. Please sign a new message.", code: "REPLAY_DETECTED" } },
          409
        );
      }

      // Verify the signature
      const isValid = verifySolanaSignature(message, signature, normalizedWalletAddress);
      if (!isValid) {
        return c.json(
          { error: { message: "Invalid signature. Please try again.", code: "INVALID_SIGNATURE" } },
          401
        );
      }
    }

    // Check if user exists with this wallet
    let user = await findAuthUserByWallet(normalizedWalletAddress);

    const now = new Date();

    if (!user) {
      // Create new user with wallet
      user = await createWalletAuthUser({
        walletAddress: normalizedWalletAddress,
        walletProvider,
        now,
      });

      // Create account record for Better Auth
      await prisma.account
        .create({
          data: {
            id: crypto.randomUUID().replace(/-/g, "").slice(0, 32),
            accountId: normalizedWalletAddress,
            providerId: "wallet",
            userId: user.id,
            createdAt: now,
            updatedAt: now,
          },
        })
        .catch((error) => {
          if (isPrismaSchemaDriftError(error) || isPrismaClientError(error) || isUniqueConstraintError(error)) {
            return;
          }
          throw error;
        });
    }

    return issueAuthSessionResponse(c, user, now);
  } catch (error) {
    console.error("Wallet auth error:", error);
    return c.json(
      { error: { message: "Failed to authenticate with wallet", code: "INTERNAL_ERROR" } },
      500
    );
  }
});

async function handleVerifiedPrivySyncRequest(c: Context) {
  const body = await c.req.json().catch(() => null);
  const parsed = PrivySyncRequestSchema.safeParse(body);
  if (!parsed.success) {
    return c.json(
      { error: { message: "A valid Privy sync payload is required", code: "INVALID_INPUT" } },
      400
    );
  }

  if (!PRIVY_CLIENT) {
    console.error("[privy-sync] Missing PRIVY_APP_ID or PRIVY_APP_SECRET env vars");
    return c.json({ error: { message: "Server misconfiguration", code: "SERVER_ERROR" } }, 500);
  }

  try {
    const { privyIdToken, name } = parsed.data;
    const verifiedIdentity = await resolveVerifiedPrivyRequestIdentity(
      c,
      normalizeRequestTokenCandidate(privyIdToken)
    );
    const { verifiedPrivyUserId, verifiedEmail } = verifiedIdentity;

    const now = new Date();
    const existingLink = await findAuthUserLinkByPrivyUserId(verifiedPrivyUserId);

    let user: AuthResponseUser | null = null;
    if (existingLink?.userId) {
      user = await findAuthUserById(existingLink.userId);
      if (!user) {
        console.error("[privy-sync] Privy user link points to missing user", {
          privyUserId: verifiedPrivyUserId,
          linkedUserId: existingLink.userId,
        });
        return c.json(
          {
            error: {
              message: "Account link is inconsistent. Please contact support.",
              code: "ACCOUNT_LINK_CONFLICT",
            },
          },
          409
        );
      }
    }

    if (!user) {
      user = await findAuthUserByPrivyIdentity({
        privyUserId: verifiedPrivyUserId,
        verifiedEmail,
      });
    }

    if (!user && verifiedEmail !== buildPrivySyntheticEmail(verifiedPrivyUserId)) {
      user = await findAuthUserByEmail(verifiedEmail);
    }

    if (!user) {
      user = await upsertAuthUserByEmail({
        email: verifiedEmail,
        displayName:
          normalizeOptionalDisplayName(name) ??
          verifiedEmail.split("@")[0] ??
          "User",
        now,
      });
    }

    user = await reconcilePrivyLinkedUserProfile({
      user,
      verifiedEmail,
      preferredName: name,
      privyUserId: verifiedPrivyUserId,
    });

    if (existingLink && existingLink.userId !== user.id) {
      console.error("[privy-sync] Refusing to remap linked Privy user", {
        privyUserId: verifiedPrivyUserId,
        linkedUserId: existingLink.userId,
        resolvedUserId: user.id,
      });
      return c.json(
        {
          error: {
            message: "Privy account is already linked to a different user.",
            code: "ACCOUNT_LINK_CONFLICT",
          },
        },
        409
      );
    }

    await writeAuthUserLinkForPrivyUserId({
      privyUserId: verifiedPrivyUserId,
      userId: user.id,
      now,
    });

    writeCachedPrivyAuthUser(verifiedPrivyUserId, user);
    const response = await issueAuthSessionResponse(c, user, now);
    console.info("[AuthFlow] /api/auth/privy-sync 200", {
      requestId: c.get("requestId") ?? null,
      userId: user.id,
      privyUserId: verifiedPrivyUserId,
      verificationMethod: verifiedIdentity.verificationMethod,
      verificationSource: verifiedIdentity.verificationSource,
    });
    return response;
  } catch (error) {
    if (isPrismaConnectivityError(error) || isAuthDbTimeoutError(error)) {
      c.header("Retry-After", "2");
      return c.json(
        {
          error: {
            message: "Auth is temporarily reconnecting. Please retry.",
            code: "AUTH_TEMPORARILY_UNAVAILABLE",
          },
        },
        503
      );
    }
    if (isPrivyApiTimeoutError(error)) {
      c.header("Retry-After", "2");
      return c.json(
        {
          error: {
            message: "Auth provider timed out. Please retry.",
            code: "AUTH_PROVIDER_TIMEOUT",
          },
        },
        503
      );
    }
    console.error("[privy-sync] Error:", error);
    return c.json({ error: { message: "Invalid Privy session", code: "UNAUTHORIZED" } }, 401);
  }
}

function logApiMe200(
  c: Context,
  userId: string,
  source: "cache" | "database" | "session_fallback" | "stale_cache"
): void {
  console.info("[AuthFlow] /api/me 200", {
    requestId: c.get("requestId") ?? null,
    userId,
    source,
  });
}

// =====================================================
// Privy Session Sync Route
// =====================================================
// Verifies the Privy user via the Privy API, then finds/creates
// a local user and issues a Better Auth session token.
app.post("/api/auth/privy-sync", handleVerifiedPrivySyncRequest);

// Legacy handler retained temporarily under an internal path until the old code
// is deleted after the production rollout.
app.post("/api/internal/_legacy-privy-sync", async (c) => {
  return c.json(
    {
      error: {
        message: "Legacy Privy sync has been disabled",
        code: "ENDPOINT_DISABLED",
      },
    },
    410
  );

  /*
  const existingSession = c.get("session");
  let hasPrivyIdentityInput = false;
  let resolvedAuthUser: AuthResponseUser | null = null;
  let cachedPrivyAuthUser: AuthResponseUser | null = null;
  try {
    const body = (await c.req
      .json()
      .catch(() => ({}))) as {
      privyUserId?: unknown;
      privyIdToken?: unknown;
      email?: unknown;
      name?: unknown;
    };
    const { privyUserId, privyIdToken, email, name } = body;
    hasPrivyIdentityInput =
      (typeof privyUserId === "string" && privyUserId.length > 0) ||
      (typeof privyIdToken === "string" && privyIdToken.length > 0);

    // Only short-circuit when this call is a session keepalive/backfill.
    // If the client provides Privy identity, we must re-bind that identity
    // instead of blindly reissuing whatever backend session is currently set.
    if (existingSession?.user?.id && !hasPrivyIdentityInput) {
      const sessionBackfillEmailRaw = existingSession.user.email?.trim() ?? "";
      const sessionBackfillEmail =
        sessionBackfillEmailRaw.length > 0
          ? sessionBackfillEmailRaw.toLowerCase()
          : `${existingSession.user.id.slice(0, 24).toLowerCase()}@privy.local`;
      const sessionBackfillNameRaw = existingSession.user.name?.trim() ?? "";
      const sessionBackfillName =
        sessionBackfillNameRaw.length > 0
          ? sessionBackfillNameRaw
          : sessionBackfillEmail.split("@")[0] ?? "User";
      const sessionBackfillUser = normalizeAuthResponseUser({
        id: existingSession.user.id,
        name: sessionBackfillName,
        email: sessionBackfillEmail,
        image: existingSession.user.image ?? null,
        walletAddress: existingSession.user.walletAddress ?? null,
        walletProvider: existingSession.user.walletProvider ?? null,
        level:
          typeof existingSession.user.level === "number" && Number.isFinite(existingSession.user.level)
            ? existingSession.user.level
            : 0,
        xp:
          typeof existingSession.user.xp === "number" && Number.isFinite(existingSession.user.xp)
            ? existingSession.user.xp
            : 0,
        isVerified: Boolean(existingSession.user.isVerified),
      });

      // Always re-issue a compact token/cookie so stale bearer-only sessions
      // are healed during Privy sync across devices and browsers.
      const issuedAt = new Date();
      const sessionToken = createSignedSessionToken({
        userId: sessionBackfillUser.id,
        now: issuedAt,
        user: buildSessionTokenUserClaims(sessionBackfillUser),
      });
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
      const ipAddress = c.req.header("x-forwarded-for") ?? c.req.header("x-real-ip") ?? "unknown";
      const userAgent = c.req.header("user-agent") ?? "unknown";

      queueSessionRecordBestEffort({
        sessionToken,
        userId: sessionBackfillUser.id,
        expiresAt,
        now: issuedAt,
        ipAddress,
        userAgent,
      });

      applySessionCookies(c, sessionToken);
      primeMeResponseCacheFromAuthUser(sessionBackfillUser);

      return c.json({
        token: sessionToken,
        user: buildClientAuthUser(sessionBackfillUser),
      });
    }
    const providedEmail =
      typeof email === "string" && email.trim().includes("@")
        ? email.trim().toLowerCase()
        : null;

    const privyCacheKey =
      typeof privyIdToken === "string" && privyIdToken.length > 32
        ? `token:${privyIdToken.slice(-32)}`
        : typeof privyUserId === "string" && privyUserId.length > 0
          ? `user:${privyUserId}`
          : null;

    if ((!privyUserId || typeof privyUserId !== "string") && (!privyIdToken || typeof privyIdToken !== "string")) {
      return c.json({ error: { message: "privyUserId or privyIdToken is required", code: "INVALID_INPUT" } }, 400);
    }

    if (typeof privyUserId === "string" && privyUserId.length > 0) {
      cachedPrivyAuthUser = await readCachedPrivyAuthUser(privyUserId);
      if (cachedPrivyAuthUser) {
        resolvedAuthUser = cachedPrivyAuthUser;
        writeCachedPrivyIdentity(privyCacheKey, {
          userId: privyUserId,
          email: cachedPrivyAuthUser.email,
        });

        const issuedAt = new Date();
        const sessionToken = createSignedSessionToken({
          userId: cachedPrivyAuthUser.id,
          now: issuedAt,
          user: buildSessionTokenUserClaims(cachedPrivyAuthUser),
        });
        const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
        const ipAddress = c.req.header("x-forwarded-for") ?? c.req.header("x-real-ip") ?? "unknown";
        const userAgent = c.req.header("user-agent") ?? "unknown";

        queueSessionRecordBestEffort({
          sessionToken,
          userId: cachedPrivyAuthUser.id,
          expiresAt,
          now: issuedAt,
          ipAddress,
          userAgent,
        });

        applySessionCookies(c, sessionToken);
        primeMeResponseCacheFromAuthUser(cachedPrivyAuthUser);

        return c.json({
          token: sessionToken,
          user: buildClientAuthUser(cachedPrivyAuthUser),
        });
      }
    }

    // ── Fast path for returning users ──
    // Resolve by the deterministic synthetic Privy email first, then the verified
    // email if we have one. This keeps auth working even when older deployments
    // have a Verification model shape that differs from the current schema.
    if (typeof privyUserId === "string" && privyUserId.length > 0) {
      let fastPathUser: AuthResponseUser | null = null;
      try {
        fastPathUser = await findAuthUserByPrivyIdentity({
          privyUserId,
          verifiedEmail: providedEmail,
        });
      } catch (error) {
        if (isTransientAuthAvailabilityError(error)) {
          console.warn("[privy-sync] Fast path account lookup unavailable; continuing with verified sync", {
            message: error instanceof Error ? error.message : String(error),
          });
        } else {
          throw error;
        }
      }

      if (fastPathUser) {
        resolvedAuthUser = fastPathUser;
        let reconciledFastPathUser = fastPathUser;
        try {
          reconciledFastPathUser = await reconcilePrivyLinkedUserProfile({
            user: fastPathUser,
            verifiedEmail: providedEmail ?? fastPathUser.email,
            preferredName: normalizeOptionalDisplayName(name),
            privyUserId,
          });
          resolvedAuthUser = reconciledFastPathUser;
        } catch (error) {
          if (!isTransientAuthAvailabilityError(error)) {
            throw error;
          }
          console.warn("[privy-sync] Fast path profile reconciliation unavailable; continuing with existing user", {
            message: error instanceof Error ? error.message : String(error),
            userId: fastPathUser.id,
          });
        }

        writeCachedPrivyIdentity(privyCacheKey, {
          userId: privyUserId,
          email: reconciledFastPathUser.email,
        });
        writeCachedPrivyAuthUser(privyUserId, reconciledFastPathUser);

        const issuedAt = new Date();
        const sessionToken = createSignedSessionToken({
          userId: reconciledFastPathUser.id,
          now: issuedAt,
          user: buildSessionTokenUserClaims(reconciledFastPathUser),
        });
        const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
        const ipAddress = c.req.header("x-forwarded-for") ?? c.req.header("x-real-ip") ?? "unknown";
        const userAgent = c.req.header("user-agent") ?? "unknown";

        queueSessionRecordBestEffort({
          sessionToken,
          userId: reconciledFastPathUser.id,
          expiresAt,
          now: issuedAt,
          ipAddress,
          userAgent,
        });

        applySessionCookies(c, sessionToken);
        primeMeResponseCacheFromAuthUser(reconciledFastPathUser);

        return c.json({
          token: sessionToken,
          user: buildClientAuthUser(reconciledFastPathUser),
        });
      }
    }

    // ── Full verification path (new users or missing account link) ──
    if (!PRIVY_CLIENT) {
      console.error("[privy-sync] Missing PRIVY_APP_ID or PRIVY_APP_SECRET env vars");
      return c.json({ error: { message: "Server misconfiguration", code: "SERVER_ERROR" } }, 500);
    }

    type PrivyUserLike = {
      id?: unknown;
      email?: { address?: unknown } | null;
      linkedAccounts?: Array<{ type?: unknown; address?: unknown }> | null;
    };

    const getPrivyEmail = (user: PrivyUserLike): string | null => {
      const directEmail = user.email?.address;
      if (typeof directEmail === "string" && directEmail.includes("@")) return directEmail.trim().toLowerCase();

      const linkedEmail = user.linkedAccounts?.find(
        (account) => account?.type === "email" && typeof account.address === "string" && account.address.includes("@")
      );
      return typeof linkedEmail?.address === "string" ? linkedEmail.address.trim().toLowerCase() : null;
    };

    let verifiedPrivyUserId: string | null = null;
    let verifiedEmail: string | null = null;

    {
      const cachedIdentity = readCachedPrivyIdentity(privyCacheKey);
      if (
        cachedIdentity &&
        (typeof privyUserId !== "string" ||
          privyUserId.length === 0 ||
          cachedIdentity.userId === privyUserId)
      ) {
        verifiedPrivyUserId = cachedIdentity.userId;
        verifiedEmail = cachedIdentity.email;
      }
    }

    if (!verifiedPrivyUserId && typeof privyIdToken === "string" && privyIdToken.length > 0) {
      try {
        const tokenUser = await withPrivyApiTimeout(
          PRIVY_CLIENT.getUser({ idToken: privyIdToken }) as Promise<PrivyUserLike>,
          "privy.getUser(idToken)"
        ) as PrivyUserLike;
        verifiedPrivyUserId = typeof tokenUser.id === "string" ? tokenUser.id : null;
        verifiedEmail = getPrivyEmail(tokenUser);

        if (!verifiedEmail && !providedEmail && verifiedPrivyUserId) {
          const fullUser = await withPrivyApiTimeout(
            PRIVY_CLIENT.getUserById(verifiedPrivyUserId) as Promise<PrivyUserLike>,
            "privy.getUserById(verifiedPrivyUserId)"
          ) as PrivyUserLike;
          verifiedEmail = getPrivyEmail(fullUser);
        }
      } catch (error) {
        console.error("[privy-sync] Failed to verify Privy identity token:", error);
        // If Privy API fails but we have userId + email from the client, trust the
        // client data to avoid blocking sign-in when Privy API is rate-limited.
        if (typeof privyUserId === "string") {
          console.warn("[privy-sync] Privy API failed, falling back to client-provided identity");
          verifiedPrivyUserId = privyUserId;
          verifiedEmail = providedEmail ?? buildPrivySyntheticEmail(privyUserId);
        } else if (isPrivyApiTimeoutError(error)) {
          c.header("Retry-After", "2");
          return c.json(
            { error: { message: "Auth provider timed out. Please retry.", code: "AUTH_PROVIDER_TIMEOUT" } },
            503
          );
        } else {
          return c.json({ error: { message: "Invalid Privy session", code: "UNAUTHORIZED" } }, 401);
        }
      }
    }

    if (typeof privyUserId === "string" && verifiedPrivyUserId && privyUserId !== verifiedPrivyUserId) {
      console.error("[privy-sync] Privy user ID mismatch", { privyUserId, verifiedPrivyUserId });
      return c.json({ error: { message: "Invalid Privy user", code: "UNAUTHORIZED" } }, 401);
    }

    if (!verifiedPrivyUserId && typeof privyUserId === "string" && providedEmail) {
      verifiedPrivyUserId = privyUserId;
      verifiedEmail = providedEmail;
    }

    if (!verifiedPrivyUserId && typeof privyUserId === "string") {
      try {
        const fullUser = await withPrivyApiTimeout(
          PRIVY_CLIENT.getUserById(privyUserId) as Promise<PrivyUserLike>,
          "privy.getUserById(privyUserId)"
        ) as PrivyUserLike;
        verifiedPrivyUserId = typeof fullUser.id === "string" ? fullUser.id : privyUserId;
        verifiedEmail = getPrivyEmail(fullUser);
      } catch (error) {
        console.error("[privy-sync] Failed to fetch Privy user:", error);
        if (isPrivyApiTimeoutError(error)) {
          c.header("Retry-After", "2");
          return c.json(
            { error: { message: "Auth provider timed out. Please retry.", code: "AUTH_PROVIDER_TIMEOUT" } },
            503
          );
        }
        return c.json({ error: { message: "Invalid Privy user", code: "UNAUTHORIZED" } }, 401);
      }
    }

    if (!verifiedPrivyUserId) {
      return c.json({ error: { message: "Invalid Privy user", code: "UNAUTHORIZED" } }, 401);
    }

    if (!verifiedEmail && providedEmail) {
      verifiedEmail = providedEmail;
    }

    if (!verifiedEmail) {
      verifiedEmail = buildPrivySyntheticEmail(verifiedPrivyUserId);
    }

    writeCachedPrivyIdentity(privyCacheKey, {
      userId: verifiedPrivyUserId,
      email: verifiedEmail,
    });

    const now = new Date();

    let user = await findAuthUserByPrivyIdentity({
      privyUserId: verifiedPrivyUserId,
      verifiedEmail,
    });
    if (user) {
      resolvedAuthUser = user;
    }

    const syntheticPrivyEmail = buildPrivySyntheticEmail(verifiedPrivyUserId);

    // If no linked Privy account exists yet, resolve/create the local user by verified email.
    if (!user) {
      if (verifiedEmail !== syntheticPrivyEmail) {
        user = await findAuthUserByEmail(verifiedEmail);
      }
      if (!user) {
        user = await findAuthUserByEmail(syntheticPrivyEmail);
      }
      const displayName = typeof name === "string" && name.trim() ? name.trim() : verifiedEmail.split("@")[0] ?? "User";
      if (!user) {
        user = await upsertAuthUserByEmail({
          email: verifiedEmail,
          displayName,
          now,
        });
      }
      resolvedAuthUser = user;
    }

    try {
      user = await reconcilePrivyLinkedUserProfile({
        user,
        verifiedEmail,
        preferredName: normalizeOptionalDisplayName(name),
        privyUserId: verifiedPrivyUserId,
      });
      resolvedAuthUser = user;
    } catch (error) {
      if (!isTransientAuthAvailabilityError(error)) {
        throw error;
      }
      console.warn("[privy-sync] Profile reconciliation unavailable; continuing with resolved user", {
        message: error instanceof Error ? error.message : String(error),
        userId: user.id,
      });
    }

    // Issue signed session token (stateless fallback works even if session table drifts).
    const sessionToken = createSignedSessionToken({
      userId: user.id,
      now,
      user: buildSessionTokenUserClaims(user),
    });
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    const ipAddress = c.req.header("x-forwarded-for") ?? c.req.header("x-real-ip") ?? "unknown";
    const userAgent = c.req.header("user-agent") ?? "unknown";

    queueSessionRecordBestEffort({
      sessionToken,
      userId: user.id,
      expiresAt,
      now,
      ipAddress,
      userAgent,
    });

    // Set canonical session cookie and clear stale legacy cookies.
    applySessionCookies(c, sessionToken);
    primeMeResponseCacheFromAuthUser(user);
    writeCachedPrivyAuthUser(verifiedPrivyUserId, user);

    return c.json({
      token: sessionToken,
      user: buildClientAuthUser(user),
    });
  } catch (error) {
    if (isPrismaConnectivityError(error) || isAuthDbTimeoutError(error)) {
      const fallbackUser =
        resolvedAuthUser ??
        cachedPrivyAuthUser ??
        (!hasPrivyIdentityInput ? toAuthResponseUserFromSessionUser(existingSession?.user) : null);
      if (fallbackUser) {
        console.warn("[privy-sync] Database unavailable; reissuing signed session from existing auth state");
        const issuedAt = new Date();
        const sessionToken = createSignedSessionToken({
          userId: fallbackUser.id,
          now: issuedAt,
          user: buildSessionTokenUserClaims(fallbackUser),
        });
        const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
        const ipAddress = c.req.header("x-forwarded-for") ?? c.req.header("x-real-ip") ?? "unknown";
        const userAgent = c.req.header("user-agent") ?? "unknown";

        queueSessionRecordBestEffort({
          sessionToken,
          userId: fallbackUser.id,
          expiresAt,
          now: issuedAt,
          ipAddress,
          userAgent,
        });

        applySessionCookies(c, sessionToken);
        primeMeResponseCacheFromAuthUser(fallbackUser);

        return c.json({
          token: sessionToken,
          user: buildClientAuthUser(fallbackUser),
        });
      }
      c.header("Retry-After", "2");
      return c.json(
        {
          error: {
            message: "Auth is temporarily reconnecting. Please retry.",
            code: "AUTH_TEMPORARILY_UNAVAILABLE",
          },
        },
        503
      );
    }
    if (isPrivyApiTimeoutError(error)) {
      c.header("Retry-After", "2");
      return c.json(
        {
          error: {
            message: "Auth provider timed out. Please retry.",
            code: "AUTH_PROVIDER_TIMEOUT",
          },
        },
        503
      );
    }
    console.error("[privy-sync] Error:", error);
    return c.json({ error: { message: "Failed to sync Privy session", code: "INTERNAL_ERROR" } }, 500);
  }
  */
});

// =====================================================
// Privy Session Auth Routes
// =====================================================

// Sign out and clear server-side session/cookie.
app.post("/api/auth/logout", async (c) => {
  try {
    const result = await auth.api.signOut({ headers: c.req.raw.headers });
    invalidateResolvedSessionCache(result.tokens);

    const clearedCookies = [
      ...result.clearedCookies,
      ...buildClearedSessionCookies(c.req.header("host")),
    ];
    clearedCookies.forEach((cookie, index) => {
      c.header("Set-Cookie", cookie, index === 0 ? undefined : { append: true });
    });

    return c.json({ data: { success: true } });
  } catch (error) {
    console.error("[auth/logout] Error:", error);
    return c.json(
      { error: { message: "Failed to sign out", code: "INTERNAL_ERROR" } },
      500
    );
  }
});

// =====================================================
// User Profile Routes (require auth)
// =====================================================

// Get current user - returns full user data from database
app.get("/api/me", async (c) => {
  let user = c.get("user");
  let session = c.get("session");
  const requestId = c.get("requestId") ?? null;
  const authTrace = c.get("authTrace") ?? buildApiMeAuthTrace(c.req.raw.headers, requestId);
  const authHeader = c.req.header("authorization") ?? c.req.header("Authorization");
  const bearerToken =
    authHeader && /^bearer\s+/i.test(authHeader)
      ? authHeader.replace(/^bearer\s+/i, "").trim()
      : "";
  const cookieHeader = c.req.header("cookie") ?? "";
  const cookieToken = readSessionCookieToken(cookieHeader);
  const signedTokenInspection = cookieToken ? inspectSignedSessionToken(cookieToken) : null;
  const hasSessionCookie = /(?:^|;\s*)(?:phew\.session_token|better-auth\.session_token|auth\.session_token|session_token)=/i.test(
    cookieHeader
  );
  const hasBearerToken = bearerToken.length > 0;
  let finalAuthReason = "middleware_session";
  appendAuthDecision(authTrace, user ? "/api/me:middleware_user_present" : "/api/me:middleware_user_missing");

  if ((!user || !session?.user) && (hasSessionCookie || hasBearerToken)) {
    try {
      appendAuthDecision(authTrace, "/api/me:recovery_lookup_start");
      const recoveredSession = hasSessionCookie
        ? await auth.api.getSession({ headers: c.req.raw.headers, trace: authTrace })
        : null;
      if (recoveredSession?.user) {
        const recoveredFromDbFallback = Boolean(
          authTrace.tokenAttempts.some(
            (attempt) =>
              attempt.source === "cookie" &&
              attempt.fallbackToDbUsed &&
              attempt.sessionResolved
          )
        );
        finalAuthReason = recoveredFromDbFallback
          ? "db_fallback_recovered_session"
          : "cookie_recovered_session";
        appendAuthDecision(authTrace, `/api/me:${finalAuthReason}`);
        session = recoveredSession;
        user = {
          id: recoveredSession.user.id,
          email: recoveredSession.user.email || null,
          walletAddress: recoveredSession.user.walletAddress || null,
          role:
            typeof recoveredSession.user.role === "string" &&
            recoveredSession.user.role.trim().length > 0
              ? recoveredSession.user.role.trim().toLowerCase()
              : recoveredSession.user.isAdmin
                ? "admin"
                : "user",
          isAdmin:
            recoveredSession.user.role === "admin" ||
            recoveredSession.user.isAdmin === true,
          isBanned: recoveredSession.user.isBanned === true,
        };
        c.set("session", recoveredSession);
        c.set("user", user);
      } else if (hasBearerToken) {
        const bearerSession = await auth.api.getSessionByToken(bearerToken, authTrace);
        if (bearerSession?.user) {
          finalAuthReason = "bearer_recovered_session";
          appendAuthDecision(authTrace, "/api/me:bearer_recovered_session");
          session = bearerSession;
          user = {
            id: bearerSession.user.id,
            email: bearerSession.user.email || null,
            walletAddress: bearerSession.user.walletAddress || null,
            role:
              typeof bearerSession.user.role === "string" &&
              bearerSession.user.role.trim().length > 0
                ? bearerSession.user.role.trim().toLowerCase()
                : bearerSession.user.isAdmin
                  ? "admin"
                  : "user",
            isAdmin:
              bearerSession.user.role === "admin" ||
              bearerSession.user.isAdmin === true,
            isBanned: bearerSession.user.isBanned === true,
          };
          c.set("session", bearerSession);
          c.set("user", user);
        }
      }
    } catch (recoverError) {
      finalAuthReason = "session_recovery_exception";
      appendAuthDecision(authTrace, "/api/me:session_recovery_exception");
      console.warn("[/api/me] Session recovery fallback failed", recoverError);
    }
  }

  if (!user) {
    const failedAttempt =
      authTrace.tokenAttempts[authTrace.tokenAttempts.length - 1] ??
      authTrace.tokenAttempts[0] ??
      null;
    const exact401Reason = hasSessionCookie
      ? failedAttempt?.reason ??
        (signedTokenInspection?.failureReason
          ? `signed_token_${signedTokenInspection.failureReason}`
          : finalAuthReason)
      : hasBearerToken
        ? failedAttempt?.reason ?? "bearer_session_missing"
        : "no_session_credentials";
    appendAuthDecision(authTrace, `/api/me:final_401:${exact401Reason}`);
    if (hasSessionCookie || hasBearerToken) {
      console.warn("[/api/me] Unauthorized request", {
        host: c.req.header("host") ?? null,
        origin: c.req.header("origin") ?? null,
        hasAuthorizationHeader: hasBearerToken,
        hasSessionCookie,
      });
    }
    console.warn("[/api/me][auth-trace]", finalizeApiMeAuthTrace(authTrace, 401, exact401Reason));
    return c.body(null, 401);
  }

  maybeRefreshSessionCookieAfterFallback(c, session?.user);
  appendAuthDecision(authTrace, `/api/me:final_200:${finalAuthReason}`);
  console.info("[/api/me][auth-trace]", finalizeApiMeAuthTrace(authTrace, 200, null));

  const cachedUser = await readCachedMeResponse(user.id);
  if (cachedUser) {
    logApiMe200(c, user.id, "cache");
    return c.json({ data: cachedUser });
  }

  let dbUser: MeResponseUser | null = null;

  const defaultFeeSettings = {
    tradeFeeRewardsEnabled: true,
    tradeFeeShareBps: 50,
    tradeFeePayoutAddress: null as string | null,
  };

  const sessionIsStatelessFallback =
    typeof session?.session?.id === "string" &&
    session.session.id.startsWith("stateless:");

  try {
    const primaryLookupTimeoutMs = sessionIsStatelessFallback
      ? Math.min(ME_DB_LOOKUP_TIMEOUT_MS, 700)
      : ME_DB_LOOKUP_TIMEOUT_MS;
    const meLookupMode = meResponseLookupMode;
    const runMeLookup = async (
      mode: MeResponseLookupMode,
      timeoutMs: number
    ) =>
      await withTimeoutResult(
        prisma.user.findUnique({
          where: { id: user.id },
          select: mode === "full" ? ME_RESPONSE_USER_SELECT : ME_RESPONSE_USER_FALLBACK_SELECT,
        }),
        timeoutMs
      );

    let fullLookup = await runMeLookup(meLookupMode, primaryLookupTimeoutMs);

    if (fullLookup.timedOut && !sessionIsStatelessFallback) {
      const retryTimeoutMs = Math.min(ME_DB_LOOKUP_TIMEOUT_MS + 1200, 5000);
      fullLookup = await runMeLookup(meLookupMode, retryTimeoutMs);
      if (fullLookup.timedOut) {
        console.warn(
          `[/api/me] User lookup exceeded ${ME_DB_LOOKUP_TIMEOUT_MS}ms (+retry ${retryTimeoutMs}ms); serving fallback`
        );
      }
    } else if (fullLookup.timedOut) {
      console.warn(
        `[/api/me] Stateless session lookup exceeded ${primaryLookupTimeoutMs}ms; serving session-backed fallback`
      );
    }

    if (!fullLookup.timedOut) {
      dbUser = fullLookup.value ? buildMeResponseUserFromDbRecord(fullLookup.value) : null;
    } else {
      const fallbackLookup = await runMeLookup("fallback", Math.min(ME_DB_LOOKUP_TIMEOUT_MS, 1500));
      if (!fallbackLookup.timedOut && fallbackLookup.value) {
        dbUser = buildMeResponseUserFromDbRecord(fallbackLookup.value);
      }
    }
  } catch (error) {
    if (isPrismaSchemaDriftError(error) || isPrismaClientError(error)) {
      updateMeResponseLookupMode("fallback", error);
      try {
        const fallbackLookup = await withTimeoutResult(
          prisma.user.findUnique({
            where: { id: user.id },
            select: ME_RESPONSE_USER_FALLBACK_SELECT,
          }),
          Math.min(ME_DB_LOOKUP_TIMEOUT_MS, 1500)
        );
        if (!fallbackLookup.timedOut) {
          dbUser = fallbackLookup.value
            ? buildMeResponseUserFromDbRecord(fallbackLookup.value)
            : null;
        }
      } catch (fallbackError) {
        if (
          !isPrismaSchemaDriftError(fallbackError) &&
          !isPrismaClientError(fallbackError) &&
          !isPrismaConnectivityError(fallbackError)
        ) {
          console.error("[/api/me] Failed to fetch compatible user profile:", fallbackError);
        }
      }
    } else if (isPrismaConnectivityError(error)) {
      console.warn("[/api/me] Primary query failed, using raw SQL fallback", {
        message: error instanceof Error ? error.message : String(error),
      });
    } else {
      console.error("[/api/me] Failed to fetch full user profile:", error);
    }

    if (!dbUser) {
      try {
        dbUser = await queryMeResponseUserRaw(user.id);
      } catch (rawError) {
        console.error("[/api/me] Raw fallback user profile lookup failed:", rawError);
      }
    }
  }

  if (!dbUser) {
    const staleCachedUser = await readCachedMeResponse(user.id, { allowStale: true });
    if (staleCachedUser) {
      console.warn("[/api/me] Serving stale cached profile while database lookup is degraded");
      logApiMe200(c, user.id, "stale_cache");
      return c.json({ data: staleCachedUser });
    }
    if (session?.user) {
        const sessionBackedUser: MeResponseUser = {
        id: session.user.id,
        name: session.user.name,
        email: session.user.email,
        image: session.user.image,
        walletAddress: session.user.walletAddress,
        username: session.user.username,
        level: session.user.level,
        xp: session.user.xp,
        bio: session.user.bio,
        isAdmin: session.user.role === "admin" || session.user.isAdmin,
        isVerified: session.user.isVerified,
        tradeFeeRewardsEnabled:
          session.user.tradeFeeRewardsEnabled ?? defaultFeeSettings.tradeFeeRewardsEnabled,
        tradeFeeShareBps: session.user.tradeFeeShareBps ?? defaultFeeSettings.tradeFeeShareBps,
        tradeFeePayoutAddress:
          session.user.tradeFeePayoutAddress ?? defaultFeeSettings.tradeFeePayoutAddress,
        createdAt: session.user.createdAt,
      };
      if (sessionIsStatelessFallback) {
        console.warn("[/api/me] Serving session-backed fallback profile while database is unavailable");
      }
      logApiMe200(c, user.id, "session_fallback");
      return c.json({ data: sessionBackedUser });
    }
    return c.json(
      sessionIsStatelessFallback
        ? {
            error: {
              message: "Profile is temporarily unavailable. Please retry.",
              code: "PROFILE_TEMPORARILY_UNAVAILABLE",
            },
          }
        : { error: { message: "User not found", code: "NOT_FOUND" } },
      sessionIsStatelessFallback ? 503 : 404
    );
  }

  writeCachedMeResponse(user.id, dbUser);
  logApiMe200(c, user.id, "database");
  return c.json({ data: dbUser });
});

// Get current user stats - returns accuracy score and performance data
app.get("/api/me/stats", async (c) => {
  const user = c.get("user");
  if (!user) return c.body(null, 401);

  let totalPosts = 0;
  try {
    // Get all posts for total count
    totalPosts = await prisma.post.count({
      where: { authorId: user.id },
    });
  } catch (error) {
    if (!isPrismaSchemaDriftError(error)) {
      throw error;
    }
    totalPosts = 0;
  }

  type SettledStatsPost = {
    id: string;
    isWin: boolean | null;
    isWin1h: boolean | null;
    isWin6h: boolean | null;
    percentChange1h: number | null;
    percentChange6h: number | null;
    settled: boolean;
    settled6h: boolean;
    settledAt: Date | null;
    createdAt: Date;
  };

  let settledPosts: SettledStatsPost[] = [];
  try {
    // Get all settled posts with their settlement data
    settledPosts = await prisma.post.findMany({
      where: {
        authorId: user.id,
        settled: true,
      },
      select: {
        id: true,
        isWin: true,
        isWin1h: true,
        isWin6h: true,
        percentChange1h: true,
        percentChange6h: true,
        settled: true,
        settled6h: true,
        settledAt: true,
        createdAt: true,
      },
      orderBy: { settledAt: "asc" },
    });
  } catch (error) {
    if (!isPrismaSchemaDriftError(error)) {
      throw error;
    }
    const fallbackSettledPosts = await prisma.post.findMany({
      where: {
        authorId: user.id,
        settled: true,
      },
      select: {
        id: true,
        isWin: true,
        settled: true,
        settledAt: true,
        createdAt: true,
      },
      orderBy: { settledAt: "asc" },
    });
    settledPosts = fallbackSettledPosts.map((post) => ({
      ...post,
      isWin1h: post.isWin,
      isWin6h: null,
      percentChange1h: null,
      percentChange6h: null,
      settled6h: false,
    }));
  }

  // Calculate wins: A "win" is when isWin1h = true OR isWin6h = true
  const wins = settledPosts.filter(
    (post) => post.isWin1h === true || post.isWin6h === true
  ).length;
  const losses = settledPosts.length - wins;

  // Calculate accuracy score
  const accuracyScore =
    settledPosts.length > 0
      ? Math.round((wins / settledPosts.length) * 100 * 10) / 10
      : 0;

  // Calculate average percent change
  let totalPercentChange = 0;
  let validPercentChanges = 0;
  for (const post of settledPosts) {
    const percentChange = post.percentChange6h ?? post.percentChange1h;
    if (percentChange !== null) {
      totalPercentChange += percentChange;
      validPercentChanges++;
    }
  }
  const avgPercentChange =
    validPercentChanges > 0
      ? Math.round((totalPercentChange / validPercentChanges) * 100) / 100
      : null;

  // Calculate streaks
  let currentStreak = 0;
  let bestWinStreak = 0;
  let tempWinStreak = 0;

  const sortedPosts = [...settledPosts].sort((a, b) => {
    const dateA = a.settledAt ? new Date(a.settledAt).getTime() : 0;
    const dateB = b.settledAt ? new Date(b.settledAt).getTime() : 0;
    return dateA - dateB;
  });

  for (const post of sortedPosts) {
    const isWin = post.isWin1h === true || post.isWin6h === true;
    if (isWin) {
      tempWinStreak++;
      if (tempWinStreak > bestWinStreak) {
        bestWinStreak = tempWinStreak;
      }
    } else {
      tempWinStreak = 0;
    }
  }

  if (sortedPosts.length > 0) {
    const lastPost = sortedPosts[sortedPosts.length - 1];
    if (lastPost) {
      const lastWasWin = lastPost.isWin1h === true || lastPost.isWin6h === true;

      if (lastWasWin) {
        for (let i = sortedPosts.length - 1; i >= 0; i--) {
          const post = sortedPosts[i];
          if (post) {
            const isWin = post.isWin1h === true || post.isWin6h === true;
            if (isWin) {
              currentStreak++;
            } else {
              break;
            }
          }
        }
      } else {
        for (let i = sortedPosts.length - 1; i >= 0; i--) {
          const post = sortedPosts[i];
          if (post) {
            const isWin = post.isWin1h === true || post.isWin6h === true;
            if (!isWin) {
              currentStreak--;
            } else {
              break;
            }
          }
        }
      }
    }
  }

  // Calculate monthly change
  const now = new Date();
  const currentMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0);

  const currentMonthPosts = settledPosts.filter((post) => {
    const settledDate = post.settledAt ? new Date(post.settledAt) : null;
    return settledDate && settledDate >= currentMonthStart;
  });

  const lastMonthPosts = settledPosts.filter((post) => {
    const settledDate = post.settledAt ? new Date(post.settledAt) : null;
    return settledDate && settledDate >= lastMonthStart && settledDate <= lastMonthEnd;
  });

  const currentMonthWins = currentMonthPosts.filter(
    (post) => post.isWin1h === true || post.isWin6h === true
  ).length;
  const currentMonthAccuracy =
    currentMonthPosts.length > 0
      ? (currentMonthWins / currentMonthPosts.length) * 100
      : 0;

  const lastMonthWins = lastMonthPosts.filter(
    (post) => post.isWin1h === true || post.isWin6h === true
  ).length;
  const lastMonthAccuracy =
    lastMonthPosts.length > 0
      ? (lastMonthWins / lastMonthPosts.length) * 100
      : 0;

  const monthlyChange =
    lastMonthPosts.length > 0
      ? Math.round((currentMonthAccuracy - lastMonthAccuracy) * 10) / 10
      : null;

  // Calculate weekly stats (last 7 days)
  const weeklyStats: { date: string; dayLabel: string; wins: number; losses: number; total: number }[] = [];
  const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  for (let i = 6; i >= 0; i--) {
    const date = new Date();
    date.setDate(date.getDate() - i);
    date.setHours(0, 0, 0, 0);

    const nextDate = new Date(date);
    nextDate.setDate(nextDate.getDate() + 1);

    const dayPosts = settledPosts.filter((post) => {
      const settledDate = post.settledAt ? new Date(post.settledAt) : null;
      return settledDate && settledDate >= date && settledDate < nextDate;
    });

    const dayWins = dayPosts.filter(
      (post) => post.isWin1h === true || post.isWin6h === true
    ).length;
    const dayLosses = dayPosts.length - dayWins;

    weeklyStats.push({
      date: date.toISOString().split("T")[0] ?? "",
      dayLabel: dayNames[date.getDay()] ?? "",
      wins: dayWins,
      losses: dayLosses,
      total: dayPosts.length,
    });
  }

  return c.json({
    data: {
      accuracyScore,
      totalPosts,
      settledPosts: settledPosts.length,
      wins,
      losses,
      avgPercentChange,
      streakCurrent: currentStreak,
      streakBest: bestWinStreak,
      monthlyChange,
      weeklyStats,
    },
  });
});

// =====================================================
// API Routes
// =====================================================

// Apply method-specific rate limits for posts and comments
// POST /api/posts/:id/comments - 30 comments/hour
app.post("/api/posts/:id/comments", commentRateLimit);

app.route("/api/posts", postsRouter);
app.route("/api/users", usersRouter);
app.route("/api/feed", feedRouter);
app.route("/api/tokens", tokensRouter);
app.route("/api/calls", callsRouter);
app.route("/api/traders", tradersRouter);
app.route("/api/radar", radarRouter);
app.route("/api/alerts", alertsRouter);
app.route("/api/leaderboards", leaderboardsRouter);
app.route("/api/admin", adminRouter);
app.route("/api/notifications", notificationsRouter);
app.route("/api/reports", reportsRouter);
app.route("/api/announcements", announcementsRouter);
app.route("/api/leaderboard", leaderboardRouter);

// =====================================================
// Static File Serving (Production Only)
// =====================================================
// In production, serve the frontend build from ../webapp/dist
if (process.env.NODE_ENV === "production") {
  if (!isBunRuntime) {
    console.log("[Startup] Skipping Bun static file middleware (non-Bun runtime; handled by platform routes)");
  } else {
    const { serveStatic } = await import("hono/bun");

  // Serve static assets (JS, CSS, images, etc.)
  app.use("/assets/*", serveStatic({ root: "../webapp/dist" }));
  app.use("/favicon.ico", serveStatic({ root: "../webapp/dist", path: "favicon.ico" }));
  app.use("/phew-mark.svg", serveStatic({ root: "../webapp/dist", path: "phew-mark.svg" }));
  app.use("/phew-logo.svg", serveStatic({ root: "../webapp/dist", path: "phew-logo.svg" }));
  app.use("/robots.txt", serveStatic({ root: "../webapp/dist", path: "robots.txt" }));
  app.use("/og-base.png", serveStatic({ root: "../webapp/dist", path: "og-base.png" }));
  app.use("/placeholder.svg", serveStatic({ root: "../webapp/dist", path: "placeholder.svg" }));

  // Fallback to index.html for client-side routing (SPA)
  // This must come after API routes and static assets
  app.get("*", serveStatic({ root: "../webapp/dist", path: "index.html" }));
  }
}

// =====================================================
// Server Configuration
// =====================================================
const port = Number(process.env.PORT) || 3000;
const databaseUrl = process.env.DATABASE_URL || "";
const databaseLabel = databaseUrl.includes("file:")
  ? "SQLite (file)"
  : (databaseUrl.includes("supabase.com") || databaseUrl.includes("supabase.co"))
    ? "Supabase Postgres"
    : databaseUrl.startsWith("postgres://") || databaseUrl.startsWith("postgresql://")
      ? "PostgreSQL (external)"
      : "External DB";

// Log startup info
console.log(`
====================================
  Alpha Protocol Backend
====================================
  Port: ${port}
  Environment: ${process.env.NODE_ENV || "development"}
  Database: ${databaseLabel}
  Auth: Better Auth (email/password)
====================================
`);

// =====================================================
// TODO: Production Improvements
// =====================================================
// - [ ] Use Redis for rate limiting in production (distributed)
// - [ ] Add APM integration (DataDog, New Relic, etc.)
// - [ ] Set up health check improvements (database connectivity, external services)
// - [ ] Add request body size limits
// - [ ] Implement IP allowlisting for admin endpoints
//
// IMPLEMENTED:
// - [x] Structured logging with JSON format in production
// - [x] Input sanitization middleware
// - [x] CSRF protection with Origin/Referer validation
// - [x] Endpoint-specific rate limits
// - [x] Security headers (HSTS, CSP, etc.)
// - [x] Slow query logging in Prisma
// - [x] Environment validation on startup
// - [x] Better Auth for email/password authentication
// =====================================================

export { app };

export default isBunRuntime
  ? {
      port,
      // Bun defaults to a 10s idle timeout, which can abort long DB/network operations
      // mid-flight and leave transaction state unhealthy under load.
      idleTimeout: 60,
      fetch: app.fetch,
    }
  : app;

