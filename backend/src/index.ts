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
  adminRateLimit,
  leaderboardRateLimit,
  postCreationRateLimit,
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
// Skip CSRF for Better Auth routes (it handles its own security)
app.use("/api/*", async (c, next) => {
  // Skip CSRF check for Better Auth routes
  if (c.req.path.startsWith("/api/auth/")) {
    return next();
  }
  return csrfProtection()(c, next);
});

// 6. Global API Rate Limit - 100 requests per minute per client
// Protects against abuse and DoS
app.use("/api/*", apiRateLimit);

// 7. Endpoint-specific rate limits (more restrictive, applied before general limit)
// Auth endpoints - 10 req/5min (brute force protection)
app.use("/api/auth/*", authRateLimit);
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

    // Validate wallet address format (Solana or EVM)
    const solanaRegex = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
    const evmRegex = /^0x[a-fA-F0-9]{40}$/;

    if (!solanaRegex.test(walletAddress) && !evmRegex.test(walletAddress)) {
      return c.json(
        { error: { message: "Invalid wallet address format", code: "INVALID_INPUT" } },
        400
      );
    }

    // For Solana wallets, verify the signature
    if (solanaRegex.test(walletAddress)) {
      if (!signature || !message) {
        return c.json(
          { error: { message: "Signature and message are required for wallet authentication", code: "INVALID_INPUT" } },
          400
        );
      }

      // Verify the signature
      const isValid = verifySolanaSignature(message, signature, walletAddress);
      if (!isValid) {
        return c.json(
          { error: { message: "Invalid signature. Please try again.", code: "INVALID_SIGNATURE" } },
          401
        );
      }

      // Verify the message contains the correct wallet address
      if (!message.includes(walletAddress)) {
        return c.json(
          { error: { message: "Message does not match wallet address", code: "INVALID_MESSAGE" } },
          401
        );
      }
    }

    // Check if user exists with this wallet
    let user = await prisma.user.findFirst({
      where: { walletAddress },
    });

    const now = new Date();

    if (!user) {
      // Create new user with wallet
      user = await prisma.user.create({
        data: {
          id: crypto.randomUUID().replace(/-/g, "").slice(0, 32),
          email: `${walletAddress.slice(0, 8).toLowerCase()}@wallet.local`,
          name: `${walletAddress.slice(0, 6)}...${walletAddress.slice(-4)}`,
          walletAddress,
          walletProvider: walletProvider || "unknown",
          walletConnectedAt: now,
          emailVerified: false,
          level: 0,
          xp: 0,
          isAdmin: false,
          isBanned: false,
          createdAt: now,
          updatedAt: now,
        },
      });

      // Create account record for Better Auth
      await prisma.account.create({
        data: {
          id: crypto.randomUUID().replace(/-/g, "").slice(0, 32),
          accountId: walletAddress,
          providerId: "wallet",
          userId: user.id,
          createdAt: now,
          updatedAt: now,
        },
      });
    }

    // Create session
    const sessionToken = crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "").slice(0, 16);
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

    await prisma.session.create({
      data: {
        id: crypto.randomUUID().replace(/-/g, "").slice(0, 32),
        token: sessionToken,
        userId: user.id,
        expiresAt,
        createdAt: now,
        updatedAt: now,
        ipAddress: c.req.header("x-forwarded-for") || c.req.header("x-real-ip") || "unknown",
        userAgent: c.req.header("user-agent") || "unknown",
      },
    });

    // Set session cookie
    const isProduction = process.env.NODE_ENV === "production";
    const cookieOptions = [
      `phew.session_token=${sessionToken}`,
      `Path=/`,
      `HttpOnly`,
      `SameSite=Lax`,
      `Max-Age=${7 * 24 * 60 * 60}`,
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
    const isUniqueConstraintError = (error: unknown): error is { code: string } =>
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error as { code?: unknown }).code === "P2002";

    const body = await c.req.json() as { privyUserId?: unknown; privyIdToken?: unknown; email?: unknown; name?: unknown };
    const { privyUserId, privyIdToken, email, name } = body;

    if ((!privyUserId || typeof privyUserId !== "string") && (!privyIdToken || typeof privyIdToken !== "string")) {
      return c.json({ error: { message: "privyUserId or privyIdToken is required", code: "INVALID_INPUT" } }, 400);
    }

    const privyAppId = process.env.PRIVY_APP_ID;
    const privyAppSecret = process.env.PRIVY_APP_SECRET;

    if (!privyAppId || !privyAppSecret) {
      console.error("[privy-sync] Missing PRIVY_APP_ID or PRIVY_APP_SECRET env vars");
      return c.json({ error: { message: "Server misconfiguration", code: "SERVER_ERROR" } }, 500);
    }

    const privyClient = new PrivyClient(privyAppId, privyAppSecret);

    type PrivyUserLike = {
      id?: unknown;
      email?: { address?: unknown } | null;
      linkedAccounts?: Array<{ type?: unknown; address?: unknown }> | null;
    };

    const getPrivyEmail = (user: PrivyUserLike): string | null => {
      const directEmail = user.email?.address;
      if (typeof directEmail === "string" && directEmail.includes("@")) return directEmail;

      const linkedEmail = user.linkedAccounts?.find(
        (account) => account?.type === "email" && typeof account.address === "string" && account.address.includes("@")
      );
      return typeof linkedEmail?.address === "string" ? linkedEmail.address : null;
    };

    let verifiedPrivyUserId: string | null = null;
    let verifiedEmail: string | null = null;

    if (typeof privyIdToken === "string" && privyIdToken.length > 0) {
      try {
        const tokenUser = await privyClient.getUser({ idToken: privyIdToken }) as PrivyUserLike;
        verifiedPrivyUserId = typeof tokenUser.id === "string" ? tokenUser.id : null;
        verifiedEmail = getPrivyEmail(tokenUser);

        if (!verifiedEmail && verifiedPrivyUserId) {
          const fullUser = await privyClient.getUserById(verifiedPrivyUserId) as PrivyUserLike;
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

    if (!verifiedPrivyUserId && typeof privyUserId === "string") {
      try {
        const fullUser = await privyClient.getUserById(privyUserId) as PrivyUserLike;
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

    if (!verifiedEmail) {
      return c.json({ error: { message: "Privy user email is unavailable", code: "INVALID_PRIVY_USER" } }, 400);
    }

    const now = new Date();

    // Prefer the Privy account link first to support email changes in Privy.
    const existingPrivyAccount = await prisma.account.findUnique({
      where: {
        providerId_accountId: {
          providerId: "privy",
          accountId: verifiedPrivyUserId,
        },
      },
      include: { user: true },
    });

    let user = existingPrivyAccount?.user ?? null;

    // If no linked Privy account exists yet, find/create the local user by verified email.
    if (!user) {
      user = await prisma.user.findFirst({ where: { email: verifiedEmail } });
    }

    if (!user) {
      const displayName = typeof name === "string" && name.trim() ? name.trim() : verifiedEmail.split("@")[0] ?? "User";
      user = await prisma.user.upsert({
        where: { email: verifiedEmail },
        update: {
          emailVerified: true,
        },
        create: {
          id: crypto.randomUUID().replace(/-/g, "").slice(0, 32),
          email: verifiedEmail,
          name: displayName,
          emailVerified: true,
          level: 0,
          xp: 0,
          isAdmin: false,
          isBanned: false,
          createdAt: now,
          updatedAt: now,
        },
      });
    }

    if (!existingPrivyAccount) {
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
          include: { user: true },
        });
        if (linkedAccount.user) {
          user = linkedAccount.user;
        }
      } catch (error) {
        if (!isUniqueConstraintError(error)) {
          throw error;
        }

        // Another concurrent sync may have created the account between our check and create.
        const linkedAccount = await prisma.account.findUnique({
          where: {
            providerId_accountId: {
              providerId: "privy",
              accountId: verifiedPrivyUserId,
            },
          },
          include: { user: true },
        });
        if (!linkedAccount?.user) {
          throw error;
        }
        user = linkedAccount.user;
      }
    }

    // Issue a session token
    const sessionToken = crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "").slice(0, 16);
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    await prisma.session.create({
      data: {
        id: crypto.randomUUID().replace(/-/g, "").slice(0, 32),
        token: sessionToken,
        userId: user.id,
        expiresAt,
        createdAt: now,
        updatedAt: now,
        ipAddress: c.req.header("x-forwarded-for") ?? c.req.header("x-real-ip") ?? "unknown",
        userAgent: c.req.header("user-agent") ?? "unknown",
      },
    });

    // Also set a session cookie for cookie-based auth
    const isProd = process.env.NODE_ENV === "production";
    const cookieOptions = [
      `phew.session_token=${sessionToken}`,
      "Path=/",
      "HttpOnly",
      "SameSite=Lax",
      `Max-Age=${7 * 24 * 60 * 60}`,
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
  if (!user) return c.body(null, 401);

  // Fetch full user data from database
  const dbUser = await prisma.user.findUnique({
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

  if (!dbUser) {
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

  // Get all posts for total count
  const totalPosts = await prisma.post.count({
    where: { authorId: user.id },
  });

  // Get all settled posts with their settlement data
  const settledPosts = await prisma.post.findMany({
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
// POST /api/posts - 10 posts/hour
app.post("/api/posts", postCreationRateLimit);
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
  fetch: app.fetch,
};
