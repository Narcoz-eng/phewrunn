import { Hono } from "hono";
import { cors } from "hono/cors";
import "./env.js";
import {
  betterAuthMiddleware,
  auth,
  type AuthVariables,
} from "./auth.js";
import { prisma } from "./prisma.js";
import { postsRouter } from "./routes/posts.js";
import { usersRouter } from "./routes/users.js";
import { adminRouter } from "./routes/admin.js";
import { notificationsRouter } from "./routes/notifications.js";
import { announcementsRouter } from "./routes/announcements.js";
import { leaderboardRouter } from "./routes/leaderboard.js";

// Security middleware imports
import {
  securityHeaders,
  requestId,
  logProductionStatus,
  createErrorHandler,
  apiRateLimit,
  authRateLimit,
  sessionRateLimit,
  feedRateLimit,
  adminRateLimit,
  leaderboardRateLimit,
  commentRateLimit,
  startRateLimitCleanup,
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

// =====================================================
// App Configuration
// =====================================================

// Alpha Protocol Backend - SocialFi platform with Better Auth
const app = new Hono<{
  Variables: AuthVariables & { requestId?: string; sanitizedBody?: unknown; sanitizedQuery?: Record<string, string[]> };
}>();

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
  // Privy identity tokens are already validated server-side.
  // Keep this endpoint responsive during reconnect/retry loops.
  if (c.req.path === "/api/auth/privy-sync") {
    return next();
  }
  return authRateLimit(c, next);
});
app.use("/api/me", sessionRateLimit);
app.use("/api/me/stats", sessionRateLimit);
app.use("/api/posts", async (c, next) => {
  if (c.req.method === "GET") {
    return feedRateLimit(c, next);
  }
  return next();
});
// Admin endpoints - 50 req/min
app.use("/api/admin/*", adminRateLimit);
// Leaderboard endpoints - 60 req/min (expensive queries)
app.use("/api/leaderboard/*", leaderboardRateLimit);

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

const PRIVY_APP_ID = process.env.PRIVY_APP_ID;
const PRIVY_APP_SECRET = process.env.PRIVY_APP_SECRET;
const PRIVY_CLIENT =
  PRIVY_APP_ID && PRIVY_APP_SECRET
    ? new PrivyClient(PRIVY_APP_ID, PRIVY_APP_SECRET)
    : null;
const PRIVY_IDENTITY_CACHE_TTL_MS = 45_000;
const privyIdentityCache = new Map<string, { userId: string; email: string | null; cachedAt: number }>();

const AUTH_RESPONSE_USER_SELECT = {
  id: true,
  name: true,
  email: true,
  image: true,
  walletAddress: true,
  walletProvider: true,
  level: true,
  xp: true,
  isVerified: true,
} as const;

const AUTH_RESPONSE_USER_FALLBACK_SELECT = {
  id: true,
  name: true,
  email: true,
  image: true,
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
  level: number;
  xp: number;
  isVerified: boolean;
};

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
        : "";

  return /does not exist|unknown arg|unknown field|column|table/i.test(message);
}

function normalizeAuthResponseUser(
  user: {
    id: string;
    name: string;
    email: string;
    image?: string | null;
    walletAddress?: string | null;
    walletProvider?: string | null;
    level?: number | null;
    xp?: number | null;
    isVerified?: boolean | null;
  }
): AuthResponseUser {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    image: user.image ?? null,
    walletAddress: user.walletAddress ?? null,
    walletProvider: user.walletProvider ?? null,
    level: user.level ?? 0,
    xp: user.xp ?? 0,
    isVerified: user.isVerified ?? false,
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

async function findAuthUserByWallet(walletAddress: string): Promise<AuthResponseUser | null> {
  try {
    const user = await prisma.user.findFirst({
      where: { walletAddress },
      select: AUTH_RESPONSE_USER_SELECT,
    });
    return user ? normalizeAuthResponseUser(user) : null;
  } catch (error) {
    if (!isPrismaSchemaDriftError(error)) {
      throw error;
    }
    try {
      const fallbackUser = await prisma.user.findFirst({
        where: { walletAddress },
        select: AUTH_RESPONSE_USER_FALLBACK_SELECT,
      });
      return fallbackUser ? normalizeAuthResponseUser(fallbackUser) : null;
    } catch (fallbackError) {
      if (isPrismaSchemaDriftError(fallbackError)) {
        return null;
      }
      throw fallbackError;
    }
  }
}

async function findAuthUserByEmail(email: string): Promise<AuthResponseUser | null> {
  try {
    const user = await prisma.user.findFirst({
      where: { email },
      select: AUTH_RESPONSE_USER_SELECT,
    });
    return user ? normalizeAuthResponseUser(user) : null;
  } catch (error) {
    if (!isPrismaSchemaDriftError(error)) {
      throw error;
    }
    try {
      const fallbackUser = await prisma.user.findFirst({
        where: { email },
        select: AUTH_RESPONSE_USER_FALLBACK_SELECT,
      });
      return fallbackUser ? normalizeAuthResponseUser(fallbackUser) : null;
    } catch (fallbackError) {
      if (!isPrismaSchemaDriftError(fallbackError)) {
        throw fallbackError;
      }
      try {
        const minimalUser = await prisma.user.findFirst({
          where: { email },
          select: AUTH_RESPONSE_USER_MINIMAL_SELECT,
        });
        return minimalUser ? normalizeAuthResponseUser(minimalUser) : null;
      } catch (minimalError) {
        if (isPrismaSchemaDriftError(minimalError)) {
          return null;
        }
        throw minimalError;
      }
    }
  }
}

async function findAuthUserById(id: string): Promise<AuthResponseUser | null> {
  try {
    const user = await prisma.user.findUnique({
      where: { id },
      select: AUTH_RESPONSE_USER_SELECT,
    });
    return user ? normalizeAuthResponseUser(user) : null;
  } catch (error) {
    if (!isPrismaSchemaDriftError(error)) {
      throw error;
    }
    try {
      const fallbackUser = await prisma.user.findUnique({
        where: { id },
        select: AUTH_RESPONSE_USER_FALLBACK_SELECT,
      });
      return fallbackUser ? normalizeAuthResponseUser(fallbackUser) : null;
    } catch (fallbackError) {
      if (!isPrismaSchemaDriftError(fallbackError)) {
        throw fallbackError;
      }
      try {
        const minimalUser = await prisma.user.findUnique({
          where: { id },
          select: AUTH_RESPONSE_USER_MINIMAL_SELECT,
        });
        return minimalUser ? normalizeAuthResponseUser(minimalUser) : null;
      } catch (minimalError) {
        if (isPrismaSchemaDriftError(minimalError)) {
          return null;
        }
        throw minimalError;
      }
    }
  }
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
    const created = await prisma.user.create({
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
        isAdmin: false,
        isBanned: false,
        createdAt: now,
        updatedAt: now,
      },
      select: AUTH_RESPONSE_USER_SELECT,
    });
    return normalizeAuthResponseUser(created);
  } catch (error) {
    if (!isPrismaSchemaDriftError(error)) {
      throw error;
    }

    let fallbackCreated:
      | {
          id: string;
          name: string;
          email: string;
          image: string | null;
        }
      | null = null;

    try {
      fallbackCreated = await prisma.user.create({
        data: {
          id: userId,
          email: `${normalizedWalletAddress.slice(0, 8).toLowerCase()}@wallet.local`,
          name: `${normalizedWalletAddress.slice(0, 6)}...${normalizedWalletAddress.slice(-4)}`,
          walletAddress: normalizedWalletAddress,
          emailVerified: false,
        },
        select: AUTH_RESPONSE_USER_FALLBACK_SELECT,
      });
    } catch (fallbackCreateError) {
      if (isPrismaSchemaDriftError(fallbackCreateError)) {
        try {
          fallbackCreated = await prisma.user.create({
            data: {
              id: userId,
              email: `${normalizedWalletAddress.slice(0, 8).toLowerCase()}@wallet.local`,
              name: `${normalizedWalletAddress.slice(0, 6)}...${normalizedWalletAddress.slice(-4)}`,
              emailVerified: false,
            },
            select: AUTH_RESPONSE_USER_FALLBACK_SELECT,
          });

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
    const user = await prisma.user.upsert({
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
        isAdmin: false,
        isBanned: false,
        createdAt: params.now,
        updatedAt: params.now,
      },
      select: AUTH_RESPONSE_USER_SELECT,
    });
    return normalizeAuthResponseUser(user);
  } catch (error) {
    if (!isPrismaSchemaDriftError(error)) {
      throw error;
    }

    const existing = await findAuthUserByEmail(params.email);
    if (existing) {
      return existing;
    }

    try {
      const fallbackCreated = await prisma.user.create({
        data: {
          id: crypto.randomUUID().replace(/-/g, "").slice(0, 32),
          email: params.email,
          name: params.displayName,
          emailVerified: true,
        },
        select: AUTH_RESPONSE_USER_FALLBACK_SELECT,
      });
      return normalizeAuthResponseUser(fallbackCreated);
    } catch (fallbackCreateError) {
      if (isUniqueConstraintError(fallbackCreateError)) {
        const concurrentUser = await findAuthUserByEmail(params.email);
        if (concurrentUser) {
          return concurrentUser;
        }
      }
      if (isPrismaSchemaDriftError(fallbackCreateError)) {
        const minimalCreated = await prisma.user.create({
          data: {
            id: crypto.randomUUID().replace(/-/g, "").slice(0, 32),
            email: params.email,
            name: params.displayName,
          },
          select: AUTH_RESPONSE_USER_MINIMAL_SELECT,
        });
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
  } catch (error) {
    if (!isPrismaSchemaDriftError(error)) {
      throw error;
    }
    await prisma.session.create({
      data: {
        id: crypto.randomUUID().replace(/-/g, "").slice(0, 32),
        token: params.sessionToken,
        userId: params.userId,
        expiresAt: params.expiresAt,
        createdAt: params.now,
        updatedAt: params.now,
      },
    });
  }
}

function resolveSessionCookieDomain(hostHeader: string | undefined): string | null {
  if (!hostHeader) return null;
  const normalizedHost = hostHeader.split(":")[0]?.trim().toLowerCase() ?? "";
  if (!normalizedHost) return null;
  if (
    normalizedHost === "phew.run" ||
    normalizedHost === "www.phew.run" ||
    normalizedHost.endsWith(".phew.run")
  ) {
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
    const body = await c.req.json();
    const { walletAddress, walletProvider, signature, message } = body;

    if (!walletAddress || typeof walletAddress !== "string") {
      return c.json(
        { error: { message: "Wallet address is required", code: "INVALID_INPUT" } },
        400
      );
    }

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
      if (typeof signature !== "string" || typeof message !== "string" || !signature || !message) {
        return c.json(
          { error: { message: "Signature and message are required for wallet authentication", code: "INVALID_INPUT" } },
          400
        );
      }

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
          if (isPrismaSchemaDriftError(error) || isUniqueConstraintError(error)) {
            return;
          }
          throw error;
        });
    }

    // Create session
    const sessionToken = crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "").slice(0, 16);
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

    await createSessionRecord({
      sessionToken,
      userId: user.id,
      expiresAt,
      now,
      ipAddress: c.req.header("x-forwarded-for") || c.req.header("x-real-ip") || "unknown",
      userAgent: c.req.header("user-agent") || "unknown",
    });

    // Set session cookie
    const isProduction = process.env.NODE_ENV === "production";
    const cookieDomain = resolveSessionCookieDomain(c.req.header("host"));
    const cookieOptions = [
      `phew.session_token=${sessionToken}`,
      `Path=/`,
      `HttpOnly`,
      `SameSite=Lax`,
      `Max-Age=${7 * 24 * 60 * 60}`,
      cookieDomain ? `Domain=${cookieDomain}` : "",
      isProduction ? "Secure" : "",
    ].filter(Boolean).join("; ");

    c.header("Set-Cookie", cookieOptions);

    return c.json({
      token: sessionToken,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        image: user.image,
        walletAddress: user.walletAddress,
        walletProvider: user.walletProvider,
        level: user.level,
        xp: user.xp,
        isVerified: user.isVerified,
      },
    });
  } catch (error) {
    console.error("Wallet auth error:", error);
    return c.json(
      { error: { message: "Failed to authenticate with wallet", code: "INTERNAL_ERROR" } },
      500
    );
  }
});

// =====================================================
// Privy Session Sync Route
// =====================================================
// Verifies the Privy user via the Privy API, then finds/creates
// a local user and issues a Better Auth session token.
app.post("/api/auth/privy-sync", async (c) => {
  try {
    const existingSession = c.get("session");
    if (existingSession?.session?.token && existingSession?.user?.id) {
      return c.json({
        token: existingSession.session.token,
        user: {
          id: existingSession.user.id,
          name: existingSession.user.name,
          email: existingSession.user.email,
          image: existingSession.user.image ?? null,
          level: typeof existingSession.user.level === "number" ? existingSession.user.level : 0,
          xp: typeof existingSession.user.xp === "number" ? existingSession.user.xp : 0,
          isVerified: Boolean(existingSession.user.isVerified),
        },
      });
    }

    const body = await c.req.json() as { privyUserId?: unknown; privyIdToken?: unknown; email?: unknown; name?: unknown };
    const { privyUserId, privyIdToken, email, name } = body;
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

    if (privyCacheKey) {
      const cachedIdentity = privyIdentityCache.get(privyCacheKey);
      if (cachedIdentity && Date.now() - cachedIdentity.cachedAt <= PRIVY_IDENTITY_CACHE_TTL_MS) {
        if (
          typeof privyUserId !== "string" ||
          privyUserId.length === 0 ||
          cachedIdentity.userId === privyUserId
        ) {
          verifiedPrivyUserId = cachedIdentity.userId;
          verifiedEmail = cachedIdentity.email;
        }
      } else if (cachedIdentity) {
        privyIdentityCache.delete(privyCacheKey);
      }
    }

    if (!verifiedPrivyUserId && typeof privyIdToken === "string" && privyIdToken.length > 0) {
      try {
        const tokenUser = await PRIVY_CLIENT.getUser({ idToken: privyIdToken }) as PrivyUserLike;
        verifiedPrivyUserId = typeof tokenUser.id === "string" ? tokenUser.id : null;
        verifiedEmail = getPrivyEmail(tokenUser);

        if (!verifiedEmail && !providedEmail && verifiedPrivyUserId) {
          const fullUser = await PRIVY_CLIENT.getUserById(verifiedPrivyUserId) as PrivyUserLike;
          verifiedEmail = getPrivyEmail(fullUser);
        }
      } catch (error) {
        console.error("[privy-sync] Failed to verify Privy identity token:", error);
        return c.json({ error: { message: "Invalid Privy session", code: "UNAUTHORIZED" } }, 401);
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
        const fullUser = await PRIVY_CLIENT.getUserById(privyUserId) as PrivyUserLike;
        verifiedPrivyUserId = typeof fullUser.id === "string" ? fullUser.id : privyUserId;
        verifiedEmail = getPrivyEmail(fullUser);
      } catch (error) {
        console.error("[privy-sync] Failed to fetch Privy user:", error);
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
      verifiedEmail = `${verifiedPrivyUserId.slice(0, 24).toLowerCase()}@privy.local`;
    }

    if (privyCacheKey) {
      privyIdentityCache.set(privyCacheKey, {
        userId: verifiedPrivyUserId,
        email: verifiedEmail,
        cachedAt: Date.now(),
      });
    }

    const now = new Date();

    // Prefer the Privy account link first to support email changes in Privy.
    // We resolve the user in a second query so orphaned rows don't crash the route.
    let existingPrivyAccount: { id: string; userId: string } | null = null;
    try {
      existingPrivyAccount = await prisma.account.findUnique({
        where: {
          providerId_accountId: {
            providerId: "privy",
            accountId: verifiedPrivyUserId,
          },
        },
        select: { id: true, userId: true },
      });
    } catch (error) {
      if (!isPrismaSchemaDriftError(error)) {
        throw error;
      }
    }

    let user = existingPrivyAccount?.userId
      ? await findAuthUserById(existingPrivyAccount.userId)
      : null;

    if (existingPrivyAccount && !user) {
      console.warn("[privy-sync] Found orphaned Privy account link; removing stale link", {
        accountId: existingPrivyAccount.id,
        userId: existingPrivyAccount.userId,
      });
      await prisma.account.delete({ where: { id: existingPrivyAccount.id } }).catch((error) => {
        console.warn("[privy-sync] Failed to delete orphaned Privy account link:", error);
      });
    }
    const hasValidPrivyAccountLink = !!(existingPrivyAccount && user);

    // If no linked Privy account exists yet, find/create the local user by verified email.
    if (!user) {
      user = await findAuthUserByEmail(verifiedEmail);
    }

    if (!user) {
      const displayName = typeof name === "string" && name.trim() ? name.trim() : verifiedEmail.split("@")[0] ?? "User";
      user = await upsertAuthUserByEmail({
        email: verifiedEmail,
        displayName,
        now,
      });
    }

    if (!hasValidPrivyAccountLink) {
      try {
        const linkedAccount = await prisma.account.upsert({
          where: {
            providerId_accountId: {
              providerId: "privy",
              accountId: verifiedPrivyUserId,
            },
          },
          update: { updatedAt: now },
          create: {
            id: crypto.randomUUID().replace(/-/g, "").slice(0, 32),
            accountId: verifiedPrivyUserId,
            providerId: "privy",
            userId: user.id,
            createdAt: now,
            updatedAt: now,
          },
          select: { userId: true },
        });
        const linkedUser = await findAuthUserById(linkedAccount.userId);
        if (linkedUser) {
          user = linkedUser;
        }
      } catch (error) {
        if (isPrismaSchemaDriftError(error)) {
          console.warn("[privy-sync] Privy account link sync skipped (schema not ready)");
          // If account table isn't ready yet, keep auth functional via email mapping.
        } else if (!isUniqueConstraintError(error)) {
          throw error;
        }

        if (isUniqueConstraintError(error)) {
          // Another concurrent sync may have created the account between our check and create.
          let linkedAccount: { id: string; userId: string } | null = null;
          try {
            linkedAccount = await prisma.account.findUnique({
              where: {
                providerId_accountId: {
                  providerId: "privy",
                  accountId: verifiedPrivyUserId,
                },
              },
              select: { id: true, userId: true },
            });
          } catch (lookupError) {
            if (!isPrismaSchemaDriftError(lookupError)) {
              throw lookupError;
            }
          }
          if (!linkedAccount?.userId) {
            throw error;
          }
          const linkedUser = await findAuthUserById(linkedAccount.userId);
          if (!linkedUser) {
            console.warn("[privy-sync] Linked Privy account exists but user is missing; deleting stale link", {
              accountId: linkedAccount.id,
              userId: linkedAccount.userId,
            });
            await prisma.account.delete({ where: { id: linkedAccount.id } }).catch((deleteError) => {
              console.warn("[privy-sync] Failed to delete stale concurrent Privy link:", deleteError);
            });
            throw error;
          }
          user = linkedUser;
        }
      }
    }

    // Issue a session token (retry once if an unlikely token collision occurs)
    let sessionToken =
      crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "").slice(0, 16);
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    const ipAddress = c.req.header("x-forwarded-for") ?? c.req.header("x-real-ip") ?? "unknown";
    const userAgent = c.req.header("user-agent") ?? "unknown";

    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        await createSessionRecord({
          sessionToken,
          userId: user.id,
          expiresAt,
          now,
          ipAddress,
          userAgent,
        });
        break;
      } catch (error) {
        if (attempt === 0 && isUniqueConstraintError(error)) {
          sessionToken =
            crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "").slice(0, 16);
          continue;
        }
        throw error;
      }
    }

    // Also set a session cookie for cookie-based auth
    const isProd = process.env.NODE_ENV === "production";
    const cookieDomain = resolveSessionCookieDomain(c.req.header("host"));
    const cookieOptions = [
      `phew.session_token=${sessionToken}`,
      "Path=/",
      "HttpOnly",
      "SameSite=Lax",
      `Max-Age=${7 * 24 * 60 * 60}`,
      cookieDomain ? `Domain=${cookieDomain}` : "",
      isProd ? "Secure" : "",
    ].filter(Boolean).join("; ");

    c.header("Set-Cookie", cookieOptions);

    return c.json({
      token: sessionToken,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        image: user.image,
        level: user.level,
        xp: user.xp,
        isVerified: user.isVerified,
      },
    });
  } catch (error) {
    console.error("[privy-sync] Error:", error);
    return c.json({ error: { message: "Failed to sync Privy session", code: "INTERNAL_ERROR" } }, 500);
  }
});

// =====================================================
// Privy Session Auth Routes
// =====================================================

// Sign out and clear server-side session/cookie.
app.post("/api/auth/logout", async (c) => {
  try {
    const result = await auth.api.signOut({ headers: c.req.raw.headers });

    result.clearedCookies.forEach((cookie, index) => {
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
  const user = c.get("user");
  const session = c.get("session");
  if (!user) return c.body(null, 401);

  let dbUser: {
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
  } | null = null;

  const defaultFeeSettings = {
    tradeFeeRewardsEnabled: true,
    tradeFeeShareBps: 100,
    tradeFeePayoutAddress: null as string | null,
  };

  try {
    // Fetch full user data from database
    dbUser = await prisma.user.findUnique({
      where: { id: user.id },
      select: {
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
      },
    });
  } catch (error) {
    if (isPrismaSchemaDriftError(error)) {
      try {
        const fallbackUser = await prisma.user.findUnique({
          where: { id: user.id },
          select: {
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
            createdAt: true,
          },
        });

        if (fallbackUser) {
          dbUser = {
            ...fallbackUser,
            ...defaultFeeSettings,
          };
        }
      } catch (fallbackError) {
        console.error("[/api/me] Failed to fetch fallback user profile:", fallbackError);
      }
    } else {
      console.error("[/api/me] Failed to fetch full user profile:", error);
    }
  }

  if (!dbUser) {
    if (session?.user) {
      return c.json({
        data: {
          id: session.user.id,
          name: session.user.name,
          email: session.user.email,
          image: session.user.image,
          walletAddress: session.user.walletAddress,
          username: session.user.username,
          level: session.user.level,
          xp: session.user.xp,
          bio: session.user.bio,
          isAdmin: session.user.isAdmin,
          isVerified: session.user.isVerified,
          ...defaultFeeSettings,
          createdAt: session.user.createdAt,
        },
      });
    }
    return c.json(
      { error: { message: "User not found", code: "NOT_FOUND" } },
      404
    );
  }

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
app.route("/api/admin", adminRouter);
app.route("/api/notifications", notificationsRouter);
app.route("/api/announcements", announcementsRouter);
app.route("/api/leaderboard", leaderboardRouter);

// =====================================================
// Static File Serving (Production Only)
// =====================================================
// In production, serve the frontend build from ../webapp/dist
if (process.env.NODE_ENV === "production") {
  const isBunRuntime = typeof (globalThis as { Bun?: unknown }).Bun !== "undefined";

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

export default {
  port,
  // Bun defaults to a 10s idle timeout, which can abort long DB/network operations
  // mid-flight and leave transaction state unhealthy under load.
  idleTimeout: 60,
  fetch: app.fetch,
};
