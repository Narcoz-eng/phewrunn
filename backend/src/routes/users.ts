import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { PublicKey } from "@solana/web3.js";
import nacl from "tweetnacl";
import bs58 from "bs58";
import { prisma } from "../prisma.js";
import { invalidateLeaderboardCaches } from "./leaderboard.js";
import { type AuthVariables, requireAuth } from "../auth.js";
import { UpdateProfileSchema, USERNAME_UPDATE_COOLDOWN_DAYS, PHOTO_UPDATE_COOLDOWN_HOURS, ConnectWalletSchema, WALLET_CONNECT_LIMIT_PER_HOUR, type UserStats, type WeeklyStat } from "../types.js";
import {
  getWalletPortfolioOverviewForPostedTokens,
  getWalletTradeSnapshotsForSolanaTokens,
  isHeliusConfigured,
} from "../services/helius.js";

export const usersRouter = new Hono<{ Variables: AuthVariables }>();
const PROFILE_POST_WALLET_ENRICH_MAX_POSTS = process.env.NODE_ENV === "production" ? 12 : 6;
const PROFILE_WALLET_OVERVIEW_MAX_TOKENS = process.env.NODE_ENV === "production" ? 40 : 20;
const PROFILE_WALLET_OVERVIEW_TIMEOUT_MS = process.env.NODE_ENV === "production" ? 4000 : 8000;
const platformFeeBpsFromEnv = Number(process.env.JUPITER_PLATFORM_FEE_BPS ?? "0");
const userSettingsPlatformFeeBps =
  Number.isFinite(platformFeeBpsFromEnv) && platformFeeBpsFromEnv > 0
    ? Math.min(5000, Math.max(1, Math.round(platformFeeBpsFromEnv)))
    : 0;
const hasUserSettingsPlatformFeeAccount = !!process.env.JUPITER_PLATFORM_FEE_ACCOUNT?.trim();
const activeUserSettingsPlatformFeeBps = hasUserSettingsPlatformFeeAccount ? userSettingsPlatformFeeBps : 0;
const MAX_POSTER_TRADE_FEE_SHARE_BPS = 10000;

const UpdateFeeSettingsSchema = z.object({
  tradeFeeRewardsEnabled: z.boolean().optional(),
  tradeFeeShareBps: z.number().int().min(0).max(MAX_POSTER_TRADE_FEE_SHARE_BPS).optional(),
  tradeFeePayoutAddress: z.union([
    z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/, "Payout wallet must be a valid Solana address"),
    z.literal(""),
  ]).optional(),
});

function isLikelySolanaWalletAddress(value: string | null | undefined): value is string {
  return typeof value === "string" && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value);
}

async function attachWalletTradeSnapshotsForUserPosts<
  T extends {
    contractAddress: string | null;
    chainType: string | null;
    createdAt: Date;
  },
>(posts: T[], walletAddress: string | null | undefined): Promise<Array<T & { walletTradeSnapshot?: unknown }>> {
  if (!isHeliusConfigured() || !isLikelySolanaWalletAddress(walletAddress) || posts.length === 0) {
    return posts as Array<T & { walletTradeSnapshot?: unknown }>;
  }

  const eligiblePosts = posts
    .filter((post) => post.chainType === "solana" && isLikelySolanaWalletAddress(post.contractAddress))
    .slice(0, PROFILE_POST_WALLET_ENRICH_MAX_POSTS);

  const uniqueMints = [...new Set(eligiblePosts.map((post) => post.contractAddress as string))];

  if (uniqueMints.length === 0) {
    return posts as Array<T & { walletTradeSnapshot?: unknown }>;
  }

  let snapshots: Record<string, unknown> | null = null;
  try {
    const snapshotPromise = getWalletTradeSnapshotsForSolanaTokens({
      walletAddress,
      tokenMints: uniqueMints,
    });
    snapshots = await Promise.race([
      snapshotPromise,
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 3000)),
    ]);
  } catch (error) {
    console.warn("[users/profile-posts] wallet snapshot enrichment skipped:", error);
    snapshots = null;
  }

  if (!snapshots) {
    return posts as Array<T & { walletTradeSnapshot?: unknown }>;
  }

  return posts.map((post) => {
    if (post.chainType !== "solana" || !post.contractAddress) {
      return post as T & { walletTradeSnapshot?: unknown };
    }
    const walletTradeSnapshot = snapshots[post.contractAddress];
    if (!walletTradeSnapshot) {
      return post as T & { walletTradeSnapshot?: unknown };
    }
    return {
      ...post,
      walletTradeSnapshot,
    };
  });
}

function verifySolanaSignature(message: string, signature: string, publicKeyStr: string): boolean {
  try {
    const messageBytes = new TextEncoder().encode(message);
    const signatureBytes = bs58.decode(signature);
    const publicKey = new PublicKey(publicKeyStr);
    return nacl.sign.detached.verify(messageBytes, signatureBytes, publicKey.toBytes());
  } catch (error) {
    console.error("[users/wallet] Signature verification error:", error);
    return false;
  }
}

function validateWalletLinkMessage(message: string, walletAddress: string, userId: string): { ok: true } | { ok: false; reason: string } {
  const normalized = message.trim();
  if (!normalized.includes("Phew.run Wallet Link")) {
    return { ok: false, reason: "Missing wallet link challenge prefix" };
  }
  if (!normalized.includes(`Wallet: ${walletAddress}`)) {
    return { ok: false, reason: "Wallet address mismatch in signed message" };
  }
  if (!normalized.includes(`User: ${userId}`)) {
    return { ok: false, reason: "User mismatch in signed message" };
  }

  const tsLine = normalized
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.startsWith("Timestamp: "));

  const timestampValue = tsLine?.slice("Timestamp: ".length);
  const timestampMs = timestampValue ? Date.parse(timestampValue) : Number.NaN;
  if (!Number.isFinite(timestampMs)) {
    return { ok: false, reason: "Missing or invalid timestamp in signed message" };
  }

  const maxAgeMs = 5 * 60 * 1000;
  if (Math.abs(Date.now() - timestampMs) > maxAgeMs) {
    return { ok: false, reason: "Signed message expired. Please sign again." };
  }

  return { ok: true };
}

// Get leaderboard (must be before /:identifier to avoid conflict)
usersRouter.get("/", async (c) => {
  const users = await prisma.user.findMany({
    orderBy: [
      { level: "desc" },
      { xp: "desc" }, // Tiebreaker
    ],
    take: 50,
    select: {
      id: true,
      name: true,
      username: true,
      image: true,
      level: true,
      xp: true,
      _count: {
        select: { posts: true },
      },
    },
  });

  return c.json({ data: users });
});

// =====================================================
// Wallet Connection Endpoints
// Must be defined before /:identifier to avoid route conflicts
// =====================================================

// Get wallet connection status
usersRouter.get("/me/wallet", requireAuth, async (c) => {
  const sessionUser = c.get("user");
  if (!sessionUser) {
    return c.json({ error: { message: "Unauthorized", code: "UNAUTHORIZED" } }, 401);
  }

  const user = await prisma.user.findUnique({
    where: { id: sessionUser.id },
    select: {
      walletAddress: true,
      walletProvider: true,
      walletConnectedAt: true,
    },
  });

  if (!user) {
    return c.json({ error: { message: "User not found", code: "NOT_FOUND" } }, 404);
  }

  return c.json({
    data: {
      connected: !!user.walletAddress,
      address: user.walletAddress,
      provider: user.walletProvider,
      connectedAt: user.walletConnectedAt?.toISOString() || null,
    }
  });
});

usersRouter.post("/me/wallet", requireAuth, zValidator("json", ConnectWalletSchema), async (c) => {
  const sessionUser = c.get("user");
  if (!sessionUser) {
    return c.json({ error: { message: "Unauthorized", code: "UNAUTHORIZED" } }, 401);
  }

  const { walletAddress, walletProvider, signature, message } = c.req.valid("json");

  const solanaRegex = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
  const isSolanaWallet = solanaRegex.test(walletAddress);

  if (!isSolanaWallet) {
    return c.json({
      error: {
        message: "Only Solana wallet verification is supported right now",
        code: "UNSUPPORTED_WALLET_PROVIDER",
      }
    }, 400);
  }

  // Require proof-of-ownership for Solana wallets (profile linking)
  if (!signature || !message) {
    return c.json({
      error: {
        message: "Signature confirmation is required to connect a Solana wallet",
        code: "SIGNATURE_REQUIRED",
      }
    }, 400);
  }

  const challengeCheck = validateWalletLinkMessage(message, walletAddress, sessionUser.id);
  if (!challengeCheck.ok) {
    return c.json({
      error: {
        message: challengeCheck.reason,
        code: "INVALID_WALLET_CHALLENGE",
      }
    }, 400);
  }

  const isValidSignature = verifySolanaSignature(message, signature, walletAddress);
  if (!isValidSignature) {
    return c.json({
      error: {
        message: "Invalid wallet signature. Please confirm the signature again.",
        code: "INVALID_SIGNATURE",
      }
    }, 401);
  }

  // Rate limiting: Check how many wallet connections this user has made in the last hour
  // TODO: Implement proper rate limiting with a dedicated rate limit table for audit trail
  // For now, we'll just check if they recently connected a wallet
  const user = await prisma.user.findUnique({
    where: { id: sessionUser.id },
    select: {
      walletAddress: true,
      walletConnectedAt: true,
    },
  });

  if (!user) {
    return c.json({ error: { message: "User not found", code: "NOT_FOUND" } }, 404);
  }

  // Simple rate limit: If wallet was connected within the last 12 minutes (5 per hour = 1 per 12 min)
  // This is a simplified check; a proper implementation would track all attempts
  if (user.walletConnectedAt) {
    const minutesSinceLastConnect = (Date.now() - user.walletConnectedAt.getTime()) / (1000 * 60);
    if (minutesSinceLastConnect < 60 / WALLET_CONNECT_LIMIT_PER_HOUR) {
      const minutesRemaining = Math.ceil(60 / WALLET_CONNECT_LIMIT_PER_HOUR - minutesSinceLastConnect);
      return c.json({
        error: {
          message: `Rate limit exceeded. You can only connect/disconnect wallets ${WALLET_CONNECT_LIMIT_PER_HOUR} times per hour. Please wait ${minutesRemaining} more minute${minutesRemaining === 1 ? '' : 's'}.`,
          code: "RATE_LIMIT_EXCEEDED"
        }
      }, 429);
    }
  }

  // Check if this wallet is already connected to another user
  const existingWalletUser = await prisma.user.findFirst({
    where: {
      walletAddress,
      NOT: { id: sessionUser.id },
    },
  });

  if (existingWalletUser) {
    return c.json({
      error: {
        message: "This wallet is already connected to another account",
        code: "WALLET_ALREADY_CONNECTED"
      }
    }, 400);
  }

  // Update user with wallet info
  // TODO: Log wallet changes for audit trail
  const updatedUser = await prisma.user.update({
    where: { id: sessionUser.id },
    data: {
      walletAddress,
      walletProvider: walletProvider || "phantom",
      walletConnectedAt: new Date(),
    },
    select: {
      id: true,
      name: true,
      email: true,
      image: true,
      walletAddress: true,
      walletProvider: true,
      walletConnectedAt: true,
      username: true,
      level: true,
      xp: true,
      bio: true,
      createdAt: true,
    },
  });

  return c.json({ data: updatedUser });
});

// Disconnect wallet
usersRouter.delete("/me/wallet", requireAuth, async (c) => {
  const sessionUser = c.get("user");
  if (!sessionUser) {
    return c.json({ error: { message: "Unauthorized", code: "UNAUTHORIZED" } }, 401);
  }

  // Get current user to check rate limit
  const user = await prisma.user.findUnique({
    where: { id: sessionUser.id },
    select: {
      walletAddress: true,
      walletConnectedAt: true,
    },
  });

  if (!user) {
    return c.json({ error: { message: "User not found", code: "NOT_FOUND" } }, 404);
  }

  if (!user.walletAddress) {
    return c.json({
      error: {
        message: "No wallet connected",
        code: "NO_WALLET_CONNECTED"
      }
    }, 400);
  }

  // Rate limiting check (same as connect)
  if (user.walletConnectedAt) {
    const minutesSinceLastConnect = (Date.now() - user.walletConnectedAt.getTime()) / (1000 * 60);
    if (minutesSinceLastConnect < 60 / WALLET_CONNECT_LIMIT_PER_HOUR) {
      const minutesRemaining = Math.ceil(60 / WALLET_CONNECT_LIMIT_PER_HOUR - minutesSinceLastConnect);
      return c.json({
        error: {
          message: `Rate limit exceeded. You can only connect/disconnect wallets ${WALLET_CONNECT_LIMIT_PER_HOUR} times per hour. Please wait ${minutesRemaining} more minute${minutesRemaining === 1 ? '' : 's'}.`,
          code: "RATE_LIMIT_EXCEEDED"
        }
      }, 429);
    }
  }

  // Clear wallet info
  // TODO: Log wallet disconnection for audit trail
  const updatedUser = await prisma.user.update({
    where: { id: sessionUser.id },
    data: {
      walletAddress: null,
      walletProvider: null,
      walletConnectedAt: null,
    },
    select: {
      id: true,
      name: true,
      email: true,
      image: true,
      walletAddress: true,
      walletProvider: true,
      walletConnectedAt: true,
      username: true,
      level: true,
      xp: true,
      bio: true,
      createdAt: true,
    },
  });

  return c.json({ data: updatedUser });
});

// =====================================================
// User Stats Endpoints (Accuracy Score System)
// Must be defined before /:identifier to avoid route conflicts
// =====================================================

/**
 * Calculate user stats including accuracy score, streaks, and weekly data
 */
async function calculateUserStats(userId: string): Promise<UserStats> {
  // Get all posts for total count
  const totalPosts = await prisma.post.count({
    where: { authorId: userId },
  });

  // Get all settled posts with their settlement data
  const settledPosts = await prisma.post.findMany({
    where: {
      authorId: userId,
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
    // Prefer 6h percent change if available, otherwise use 1h
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

  // Sort by settlement date for streak calculation
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

  // Calculate current streak from the most recent posts
  if (sortedPosts.length > 0) {
    const lastPost = sortedPosts[sortedPosts.length - 1];
    if (lastPost) {
      const lastWasWin = lastPost.isWin1h === true || lastPost.isWin6h === true;

      if (lastWasWin) {
        // Count consecutive wins from the end
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
        // Count consecutive losses from the end (as negative)
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

  // Calculate monthly change (compare current month to last month)
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
  const weeklyStats: WeeklyStat[] = [];
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

  return {
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
  };
}

// Get stats for current logged-in user
usersRouter.get("/me/stats", requireAuth, async (c) => {
  const sessionUser = c.get("user");
  if (!sessionUser) {
    return c.json({ error: { message: "Unauthorized", code: "UNAUTHORIZED" } }, 401);
  }

  const stats = await calculateUserStats(sessionUser.id);
  return c.json({ data: stats });
});

// Get stats for a specific user by ID
usersRouter.get("/:userId/stats", async (c) => {
  const userId = c.req.param("userId");

  // Check if user exists
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true },
  });

  if (!user) {
    return c.json({ error: { message: "User not found", code: "NOT_FOUND" } }, 404);
  }

  const stats = await calculateUserStats(userId);
  return c.json({ data: stats });
});

// Get wallet overview for a user (balances + posted-token position summaries)
// Must be defined before /:identifier to avoid route conflicts
usersRouter.get("/:identifier/wallet/overview", async (c) => {
  const identifier = c.req.param("identifier");

  const user = await prisma.user.findFirst({
    where: {
      OR: [{ id: identifier }, { username: identifier }],
    },
    select: {
      id: true,
      walletAddress: true,
    },
  });

  if (!user) {
    return c.json({ error: { message: "User not found", code: "NOT_FOUND" } }, 404);
  }

  if (!user.walletAddress || !isLikelySolanaWalletAddress(user.walletAddress) || !isHeliusConfigured()) {
    return c.json({
      data: {
        connected: Boolean(user.walletAddress),
        balanceSol: null,
        balanceUsd: null,
        totalVolumeBoughtSol: null,
        totalVolumeSoldSol: null,
        totalVolumeBoughtUsd: null,
        totalVolumeSoldUsd: null,
        totalProfitUsd: null,
        tokenPositions: [],
      }
    });
  }

  const postedTokens = await prisma.post.findMany({
    where: {
      authorId: user.id,
      chainType: "solana",
      contractAddress: { not: null },
    },
    orderBy: { createdAt: "desc" },
    take: 200,
    select: {
      contractAddress: true,
      chainType: true,
      tokenName: true,
      tokenSymbol: true,
      tokenImage: true,
      createdAt: true,
    },
  });

  if (postedTokens.length === 0) {
    return c.json({
      data: {
        connected: true,
        balanceSol: null,
        balanceUsd: null,
        totalVolumeBoughtSol: null,
        totalVolumeSoldSol: null,
        totalVolumeBoughtUsd: null,
        totalVolumeSoldUsd: null,
        totalProfitUsd: null,
        tokenPositions: [],
      }
    });
  }

  const tokenMetaByMint = new Map<string, {
    mint: string;
    tokenName: string | null;
    tokenSymbol: string | null;
    tokenImage: string | null;
    firstPostedAt: Date;
  }>();

  let earliestPostMs: number | null = null;
  for (const post of postedTokens) {
    const mint = post.contractAddress;
    if (!mint) continue;
    const createdAtMs = post.createdAt.getTime();
    if (earliestPostMs === null || createdAtMs < earliestPostMs) {
      earliestPostMs = createdAtMs;
    }

    if (!tokenMetaByMint.has(mint)) {
      tokenMetaByMint.set(mint, {
        mint,
        tokenName: post.tokenName,
        tokenSymbol: post.tokenSymbol,
        tokenImage: post.tokenImage,
        firstPostedAt: post.createdAt,
      });
    }
  }

  if (tokenMetaByMint.size > PROFILE_WALLET_OVERVIEW_MAX_TOKENS) {
    const limited = new Map<string, {
      mint: string;
      tokenName: string | null;
      tokenSymbol: string | null;
      tokenImage: string | null;
      firstPostedAt: Date;
    }>();
    for (const [mint, meta] of tokenMetaByMint.entries()) {
      if (limited.size >= PROFILE_WALLET_OVERVIEW_MAX_TOKENS) break;
      limited.set(mint, meta);
    }
    tokenMetaByMint.clear();
    for (const [mint, meta] of limited.entries()) {
      tokenMetaByMint.set(mint, meta);
    }
  }
  let portfolio: Awaited<ReturnType<typeof getWalletPortfolioOverviewForPostedTokens>> | null = null;
  try {
    portfolio = await Promise.race([
      getWalletPortfolioOverviewForPostedTokens({
        walletAddress: user.walletAddress,
        tokens: [...tokenMetaByMint.values()].map((t) => ({ mint: t.mint, chainType: "solana" })),
        sinceMs: earliestPostMs,
      }),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), PROFILE_WALLET_OVERVIEW_TIMEOUT_MS)),
    ]);
    if (portfolio === null) {
      console.warn("[users/wallet-overview] Timed out or unavailable; returning fallback", {
        userId: user.id,
      });
    }
  } catch (error) {
    console.warn("[users/wallet-overview] Failed to build wallet overview; returning fallback", {
      userId: user.id,
      error,
    });
    portfolio = null;
  }

  if (!portfolio) {
    return c.json({
      data: {
        connected: true,
        balanceSol: null,
        balanceUsd: null,
        totalVolumeBoughtSol: null,
        totalVolumeSoldSol: null,
        totalVolumeBoughtUsd: null,
        totalVolumeSoldUsd: null,
        totalProfitUsd: null,
        tokenPositions: [],
      }
    });
  }

  const tokenPositions = [...tokenMetaByMint.values()]
    .map((meta) => {
      const wallet = portfolio.tokens[meta.mint];
      if (!wallet) return null;
      return {
        mint: meta.mint,
        tokenName: meta.tokenName,
        tokenSymbol: meta.tokenSymbol,
        tokenImage: meta.tokenImage,
        holdingAmount: wallet.holdingAmount ?? null,
        holdingUsd: wallet.holdingUsd ?? null,
        boughtAmount: wallet.boughtAmount ?? null,
        soldAmount: wallet.soldAmount ?? null,
        totalPnlUsd: wallet.totalPnlUsd ?? null,
      };
    })
    .filter((item): item is NonNullable<typeof item> => item !== null)
    .sort((a, b) => {
      const aValue = a.holdingUsd ?? a.totalPnlUsd ?? 0;
      const bValue = b.holdingUsd ?? b.totalPnlUsd ?? 0;
      return bValue - aValue;
    });

  return c.json({
    data: {
      connected: true,
      balanceSol: portfolio.balanceSol,
      balanceUsd: portfolio.balanceUsd,
      totalVolumeBoughtSol: portfolio.totalVolumeBoughtSol,
      totalVolumeSoldSol: portfolio.totalVolumeSoldSol,
      totalVolumeBoughtUsd: portfolio.totalVolumeBoughtUsd,
      totalVolumeSoldUsd: portfolio.totalVolumeSoldUsd,
      totalProfitUsd: portfolio.totalProfitUsd,
      tokenPositions,
    }
  });
});

usersRouter.get("/me/fee-settings", requireAuth, async (c) => {
  const sessionUser = c.get("user");
  if (!sessionUser) {
    return c.json({ error: { message: "Unauthorized", code: "UNAUTHORIZED" } }, 401);
  }

  const user = await prisma.user.findUnique({
    where: { id: sessionUser.id },
    select: {
      tradeFeeRewardsEnabled: true,
      tradeFeeShareBps: true,
      tradeFeePayoutAddress: true,
      walletAddress: true,
    },
  });

  if (!user) {
    return c.json({ error: { message: "User not found", code: "NOT_FOUND" } }, 404);
  }

  return c.json({
    data: {
      tradeFeeRewardsEnabled: user.tradeFeeRewardsEnabled,
      tradeFeeShareBps: user.tradeFeeShareBps,
      tradeFeePayoutAddress: user.tradeFeePayoutAddress,
      effectivePayoutAddress: user.tradeFeePayoutAddress ?? user.walletAddress ?? null,
      platformFeeBps: activeUserSettingsPlatformFeeBps,
      platformFeeAccountConfigured: hasUserSettingsPlatformFeeAccount,
    },
  });
});

usersRouter.patch(
  "/me/fee-settings",
  requireAuth,
  zValidator("json", UpdateFeeSettingsSchema),
  async (c) => {
    const sessionUser = c.get("user");
    if (!sessionUser) {
      return c.json({ error: { message: "Unauthorized", code: "UNAUTHORIZED" } }, 401);
    }

    const payload = c.req.valid("json");
    const updateData: {
      tradeFeeRewardsEnabled?: boolean;
      tradeFeeShareBps?: number;
      tradeFeePayoutAddress?: string | null;
    } = {};

    if (typeof payload.tradeFeeRewardsEnabled === "boolean") {
      updateData.tradeFeeRewardsEnabled = payload.tradeFeeRewardsEnabled;
    }
    if (typeof payload.tradeFeeShareBps === "number" && Number.isFinite(payload.tradeFeeShareBps)) {
      updateData.tradeFeeShareBps = Math.min(
        MAX_POSTER_TRADE_FEE_SHARE_BPS,
        Math.max(0, Math.round(payload.tradeFeeShareBps))
      );
    }
    if (payload.tradeFeePayoutAddress !== undefined) {
      updateData.tradeFeePayoutAddress = payload.tradeFeePayoutAddress || null;
    }

    if (Object.keys(updateData).length === 0) {
      const user = await prisma.user.findUnique({
        where: { id: sessionUser.id },
        select: {
          tradeFeeRewardsEnabled: true,
          tradeFeeShareBps: true,
          tradeFeePayoutAddress: true,
          walletAddress: true,
        },
      });
      if (!user) {
        return c.json({ error: { message: "User not found", code: "NOT_FOUND" } }, 404);
      }
      return c.json({
        data: {
          tradeFeeRewardsEnabled: user.tradeFeeRewardsEnabled,
          tradeFeeShareBps: user.tradeFeeShareBps,
          tradeFeePayoutAddress: user.tradeFeePayoutAddress,
          effectivePayoutAddress: user.tradeFeePayoutAddress ?? user.walletAddress ?? null,
          platformFeeBps: activeUserSettingsPlatformFeeBps,
          platformFeeAccountConfigured: hasUserSettingsPlatformFeeAccount,
        },
      });
    }

    const user = await prisma.user.update({
      where: { id: sessionUser.id },
      data: updateData,
      select: {
        tradeFeeRewardsEnabled: true,
        tradeFeeShareBps: true,
        tradeFeePayoutAddress: true,
        walletAddress: true,
      },
    });

    return c.json({
      data: {
        tradeFeeRewardsEnabled: user.tradeFeeRewardsEnabled,
        tradeFeeShareBps: user.tradeFeeShareBps,
        tradeFeePayoutAddress: user.tradeFeePayoutAddress,
        effectivePayoutAddress: user.tradeFeePayoutAddress ?? user.walletAddress ?? null,
        platformFeeBps: activeUserSettingsPlatformFeeBps,
        platformFeeAccountConfigured: hasUserSettingsPlatformFeeAccount,
      },
    });
  }
);

usersRouter.get("/me/fee-earnings", requireAuth, async (c) => {
  const sessionUser = c.get("user");
  if (!sessionUser) {
    return c.json({ error: { message: "Unauthorized", code: "UNAUTHORIZED" } }, 401);
  }

  const events = await prisma.tradeFeeEvent.findMany({
    where: {
      posterUserId: sessionUser.id,
      txSignature: { not: null },
    },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      postId: true,
      feeMint: true,
      tradeSide: true,
      platformFeeAmountAtomic: true,
      posterShareAmountAtomic: true,
      txSignature: true,
      createdAt: true,
      traderWalletAddress: true,
    },
  });

  let totalPosterShareAtomic = 0n;
  const totalsByMint = new Map<string, { totalAtomic: bigint; count: number }>();

  for (const event of events) {
    const posterShareAmount = BigInt(event.posterShareAmountAtomic);
    totalPosterShareAtomic += posterShareAmount;
    const bucket = totalsByMint.get(event.feeMint) ?? { totalAtomic: 0n, count: 0 };
    bucket.totalAtomic += posterShareAmount;
    bucket.count += 1;
    totalsByMint.set(event.feeMint, bucket);
  }

  const byMint = [...totalsByMint.entries()]
    .map(([mint, bucket]) => ({
      mint,
      totalAtomic: bucket.totalAtomic.toString(),
      count: bucket.count,
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 12);

  const recentEvents = events.slice(0, 20).map((event) => ({
    id: event.id,
    postId: event.postId,
    feeMint: event.feeMint,
    tradeSide: event.tradeSide,
    platformFeeAmountAtomic: event.platformFeeAmountAtomic,
    posterShareAmountAtomic: event.posterShareAmountAtomic,
    txSignature: event.txSignature,
    traderWalletAddress: event.traderWalletAddress,
    createdAt: event.createdAt.toISOString(),
  }));

  return c.json({
    data: {
      totalTrades: events.length,
      totalPosterShareAtomic: totalPosterShareAtomic.toString(),
      byMint,
      recentEvents,
    },
  });
});

// Get user profile by ID or username
usersRouter.get("/:identifier", async (c) => {
  const identifier = c.req.param("identifier");
  const currentUser = c.get("user");

  const user = await prisma.user.findFirst({
    where: {
      OR: [
        { id: identifier },
        { username: identifier },
      ],
    },
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
      isVerified: true,
      createdAt: true,
      lastUsernameUpdate: true,
      lastPhotoUpdate: true,
      _count: {
        select: {
          posts: true,
          followers: true,
          following: true,
        },
      },
    },
  });

  if (!user) {
    return c.json({ error: { message: "User not found", code: "NOT_FOUND" } }, 404);
  }

  // Check if current user follows this user
  let isFollowing = false;
  if (currentUser && currentUser.id !== user.id) {
    const follow = await prisma.follow.findUnique({
      where: {
        followerId_followingId: {
          followerId: currentUser.id,
          followingId: user.id,
        },
      },
    });
    isFollowing = !!follow;
  }

  // Get user stats (settled posts, win rate, total profit)
  const settledPosts = await prisma.post.findMany({
    where: {
      authorId: user.id,
      settled: true,
    },
    select: {
      isWin: true,
      entryMcap: true,
      currentMcap: true,
    },
  });

  const totalCalls = settledPosts.length;
  const wins = settledPosts.filter(p => p.isWin === true).length;
  const losses = settledPosts.filter(p => p.isWin === false).length;
  const winRate = totalCalls > 0 ? Math.round((wins / totalCalls) * 100) : 0;

  // Calculate total profit/loss percentage
  let totalProfitPercent = 0;
  for (const post of settledPosts) {
    if (post.entryMcap && post.currentMcap) {
      const changePercent = ((post.currentMcap - post.entryMcap) / post.entryMcap) * 100;
      totalProfitPercent += changePercent;
    }
  }

  return c.json({
    data: {
      ...user,
      isFollowing,
      stats: {
        totalCalls,
        wins,
        losses,
        winRate,
        totalProfitPercent: Math.round(totalProfitPercent * 100) / 100,
      },
    }
  });
});

// Update current user's profile
usersRouter.patch("/me", requireAuth, zValidator("json", UpdateProfileSchema), async (c) => {
  const sessionUser = c.get("user");
  if (!sessionUser) {
    return c.json({ error: { message: "Unauthorized", code: "UNAUTHORIZED" } }, 401);
  }

  const {
    username,
    walletAddress,
    bio,
    image,
    tradeFeeRewardsEnabled,
    tradeFeeShareBps,
    tradeFeePayoutAddress,
  } = c.req.valid("json");

  // Get current user data to check update timestamps
  const currentUserData = await prisma.user.findUnique({
    where: { id: sessionUser.id },
    select: {
      username: true,
      image: true,
      lastUsernameUpdate: true,
      lastPhotoUpdate: true
    },
  });

  if (!currentUserData) {
    return c.json({ error: { message: "User not found", code: "NOT_FOUND" } }, 404);
  }

  const now = new Date();
  const updateData: Record<string, unknown> = {};

  // Check username update cooldown (7 days)
  if (username !== undefined && username !== currentUserData.username) {
    if (currentUserData.lastUsernameUpdate) {
      const daysSinceLastUpdate = (now.getTime() - currentUserData.lastUsernameUpdate.getTime()) / (1000 * 60 * 60 * 24);
      if (daysSinceLastUpdate < USERNAME_UPDATE_COOLDOWN_DAYS) {
        const daysRemaining = Math.ceil(USERNAME_UPDATE_COOLDOWN_DAYS - daysSinceLastUpdate);
        return c.json({
          error: {
            message: `You can only change your username once every ${USERNAME_UPDATE_COOLDOWN_DAYS} days. Please wait ${daysRemaining} more day${daysRemaining === 1 ? '' : 's'}.`,
            code: "USERNAME_COOLDOWN"
          }
        }, 400);
      }
    }

    // Check if username is taken
    const existing = await prisma.user.findFirst({
      where: {
        username,
        NOT: { id: sessionUser.id },
      },
    });

    if (existing) {
      return c.json({
        error: { message: "Username already taken", code: "USERNAME_TAKEN" }
      }, 400);
    }

    updateData.username = username;
    updateData.lastUsernameUpdate = now;
  }

  // Check photo update cooldown (24 hours)
  if (image !== undefined && image !== currentUserData.image) {
    if (currentUserData.lastPhotoUpdate) {
      const hoursSinceLastUpdate = (now.getTime() - currentUserData.lastPhotoUpdate.getTime()) / (1000 * 60 * 60);
      if (hoursSinceLastUpdate < PHOTO_UPDATE_COOLDOWN_HOURS) {
        const hoursRemaining = Math.ceil(PHOTO_UPDATE_COOLDOWN_HOURS - hoursSinceLastUpdate);
        return c.json({
          error: {
            message: `You can only change your profile photo once every ${PHOTO_UPDATE_COOLDOWN_HOURS} hours. Please wait ${hoursRemaining} more hour${hoursRemaining === 1 ? '' : 's'}.`,
            code: "PHOTO_COOLDOWN"
          }
        }, 400);
      }
    }

    updateData.image = image;
    updateData.lastPhotoUpdate = now;
  }

  // Add other fields if provided
  if (walletAddress !== undefined) {
    updateData.walletAddress = walletAddress || null;
  }
  if (bio !== undefined) {
    updateData.bio = bio || null;
  }
  if (tradeFeeRewardsEnabled !== undefined) {
    updateData.tradeFeeRewardsEnabled = tradeFeeRewardsEnabled;
  }
  if (tradeFeeShareBps !== undefined && Number.isFinite(tradeFeeShareBps)) {
    updateData.tradeFeeShareBps = Math.min(
      MAX_POSTER_TRADE_FEE_SHARE_BPS,
      Math.max(0, Math.round(tradeFeeShareBps))
    );
  }
  if (tradeFeePayoutAddress !== undefined) {
    updateData.tradeFeePayoutAddress = tradeFeePayoutAddress || null;
  }

  // If no updates, return current user
  if (Object.keys(updateData).length === 0) {
    const user = await prisma.user.findUnique({
      where: { id: sessionUser.id },
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
        tradeFeeRewardsEnabled: true,
        tradeFeeShareBps: true,
        tradeFeePayoutAddress: true,
        createdAt: true,
        lastUsernameUpdate: true,
        lastPhotoUpdate: true,
      },
    });
    return c.json({ data: user });
  }

  const user = await prisma.user.update({
    where: { id: sessionUser.id },
    data: updateData,
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
      tradeFeeRewardsEnabled: true,
      tradeFeeShareBps: true,
      tradeFeePayoutAddress: true,
      createdAt: true,
      lastUsernameUpdate: true,
      lastPhotoUpdate: true,
    },
  });

  // Username/image updates affect leaderboard profile chips and cached stats.
  invalidateLeaderboardCaches();

  return c.json({ data: user });
});

// Get user's posts
usersRouter.get("/:identifier/posts", async (c) => {
  const identifier = c.req.param("identifier");
  const currentUser = c.get("user");

  const user = await prisma.user.findFirst({
    where: {
      OR: [
        { id: identifier },
        { username: identifier },
      ],
    },
  });

  if (!user) {
    return c.json({ error: { message: "User not found", code: "NOT_FOUND" } }, 404);
  }

  const posts = await prisma.post.findMany({
    where: { authorId: user.id },
    orderBy: { createdAt: "desc" },
    include: {
      author: {
        select: {
          id: true,
          name: true,
          username: true,
          image: true,
          level: true,
          xp: true,
        },
      },
      _count: {
        select: {
          likes: true,
          comments: true,
          reposts: true,
        },
      },
    },
  });

  const postsWithWalletTrade = await attachWalletTradeSnapshotsForUserPosts(posts, user.walletAddress);

  // Get current user's interactions with these posts
  let userLikes: Set<string> = new Set();
  let userReposts: Set<string> = new Set();
  let isFollowingAuthor = false;

  if (currentUser) {
    const postIds = postsWithWalletTrade.map((p) => p.id);

    const [likes, reposts, follow] = await Promise.all([
      prisma.like.findMany({
        where: {
          userId: currentUser.id,
          postId: { in: postIds },
        },
        select: { postId: true },
      }),
      prisma.repost.findMany({
        where: {
          userId: currentUser.id,
          postId: { in: postIds },
        },
        select: { postId: true },
      }),
      currentUser.id !== user.id
        ? prisma.follow.findUnique({
            where: {
              followerId_followingId: {
                followerId: currentUser.id,
                followingId: user.id,
              },
            },
          })
        : Promise.resolve(null),
    ]);

    userLikes = new Set(likes.map((l) => l.postId));
    userReposts = new Set(reposts.map((r) => r.postId));
    isFollowingAuthor = !!follow;
  }

  const postsWithSocial = postsWithWalletTrade.map((post) => ({
    ...post,
    isLiked: userLikes.has(post.id),
    isReposted: userReposts.has(post.id),
    isFollowingAuthor,
  }));

  return c.json({ data: postsWithSocial });
});

// Get user's reposts (saved alpha) - only visible on profile page
usersRouter.get("/:identifier/reposts", async (c) => {
  const identifier = c.req.param("identifier");
  const currentUser = c.get("user");

  const user = await prisma.user.findFirst({
    where: {
      OR: [
        { id: identifier },
        { username: identifier },
      ],
    },
  });

  if (!user) {
    return c.json({ error: { message: "User not found", code: "NOT_FOUND" } }, 404);
  }

  // Get the user's reposts with the original post data
  const reposts = await prisma.repost.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
    include: {
      post: {
        include: {
          author: {
            select: {
              id: true,
              name: true,
              username: true,
              image: true,
              level: true,
              xp: true,
            },
          },
          _count: {
            select: {
              likes: true,
              comments: true,
              reposts: true,
            },
          },
        },
      },
    },
  });

  // Get current user's interactions with these posts
  let userLikes: Set<string> = new Set();
  let userRepostsSet: Set<string> = new Set();
  let followingAuthorIds: Set<string> = new Set();

  const posts = reposts.map((r) => r.post);
  const postIds = posts.map((p) => p.id);

  if (currentUser) {
    const authorIds = [...new Set(posts.map((p) => p.authorId).filter((id) => id !== currentUser.id))];
    const [likes, repostInteractions, follows] = await Promise.all([
      prisma.like.findMany({
        where: {
          userId: currentUser.id,
          postId: { in: postIds },
        },
        select: { postId: true },
      }),
      prisma.repost.findMany({
        where: {
          userId: currentUser.id,
          postId: { in: postIds },
        },
        select: { postId: true },
      }),
      authorIds.length > 0
        ? prisma.follow.findMany({
            where: {
              followerId: currentUser.id,
              followingId: { in: authorIds },
            },
            select: { followingId: true },
          })
        : Promise.resolve([]),
    ]);

    userLikes = new Set(likes.map((l) => l.postId));
    userRepostsSet = new Set(repostInteractions.map((r) => r.postId));
    followingAuthorIds = new Set(follows.map((f) => f.followingId));
  }

  const postsWithSocial = posts.map((post) => ({
    ...post,
    isLiked: userLikes.has(post.id),
    isReposted: userRepostsSet.has(post.id),
    isFollowingAuthor: currentUser ? followingAuthorIds.has(post.authorId) : false,
  }));

  return c.json({ data: postsWithSocial });
});

// Follow a user
usersRouter.post("/:id/follow", requireAuth, async (c) => {
  const currentUser = c.get("user");
  const targetUserId = c.req.param("id");

  if (!currentUser) {
    return c.json({ error: { message: "Unauthorized", code: "UNAUTHORIZED" } }, 401);
  }

  // Cannot follow yourself
  if (currentUser.id === targetUserId) {
    return c.json({ error: { message: "Cannot follow yourself", code: "CANNOT_FOLLOW_SELF" } }, 400);
  }

  // Check if target user exists
  const targetUser = await prisma.user.findUnique({ where: { id: targetUserId } });
  if (!targetUser) {
    return c.json({ error: { message: "User not found", code: "NOT_FOUND" } }, 404);
  }

  // Check if already following
  const existingFollow = await prisma.follow.findUnique({
    where: {
      followerId_followingId: {
        followerId: currentUser.id,
        followingId: targetUserId,
      },
    },
  });

  if (existingFollow) {
    return c.json({ error: { message: "Already following", code: "ALREADY_FOLLOWING" } }, 400);
  }

  // Create follow
  await prisma.follow.create({
    data: {
      followerId: currentUser.id,
      followingId: targetUserId,
    },
  });

  // Get updated counts
  const followerCount = await prisma.follow.count({ where: { followingId: targetUserId } });

  return c.json({ data: { following: true, followerCount } });
});

// Unfollow a user
usersRouter.delete("/:id/follow", requireAuth, async (c) => {
  const currentUser = c.get("user");
  const targetUserId = c.req.param("id");

  if (!currentUser) {
    return c.json({ error: { message: "Unauthorized", code: "UNAUTHORIZED" } }, 401);
  }

  // Delete follow
  try {
    await prisma.follow.delete({
      where: {
        followerId_followingId: {
          followerId: currentUser.id,
          followingId: targetUserId,
        },
      },
    });
  } catch {
    return c.json({ error: { message: "Not following", code: "NOT_FOLLOWING" } }, 404);
  }

  // Get updated counts
  const followerCount = await prisma.follow.count({ where: { followingId: targetUserId } });

  return c.json({ data: { following: false, followerCount } });
});

// Get user's followers
usersRouter.get("/:id/followers", async (c) => {
  const userId = c.req.param("id");
  const currentUser = c.get("user");

  // Check if user exists
  const user = await prisma.user.findFirst({
    where: {
      OR: [
        { id: userId },
        { username: userId },
      ],
    },
  });

  if (!user) {
    return c.json({ error: { message: "User not found", code: "NOT_FOUND" } }, 404);
  }

  const followers = await prisma.follow.findMany({
    where: { followingId: user.id },
    include: {
      follower: {
        select: {
          id: true,
          name: true,
          username: true,
          image: true,
          level: true,
          xp: true,
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  // Check if current user follows these users
  let currentUserFollowing: Set<string> = new Set();
  if (currentUser) {
    const followerIds = followers.map((f) => f.follower.id);
    const following = await prisma.follow.findMany({
      where: {
        followerId: currentUser.id,
        followingId: { in: followerIds },
      },
      select: { followingId: true },
    });
    currentUserFollowing = new Set(following.map((f) => f.followingId));
  }

  const followersWithState = followers.map((f) => ({
    ...f.follower,
    isFollowing: currentUserFollowing.has(f.follower.id),
  }));

  return c.json({ data: followersWithState });
});

// Get users that a user is following
usersRouter.get("/:id/following", async (c) => {
  const userId = c.req.param("id");
  const currentUser = c.get("user");

  // Check if user exists
  const user = await prisma.user.findFirst({
    where: {
      OR: [
        { id: userId },
        { username: userId },
      ],
    },
  });

  if (!user) {
    return c.json({ error: { message: "User not found", code: "NOT_FOUND" } }, 404);
  }

  const following = await prisma.follow.findMany({
    where: { followerId: user.id },
    include: {
      following: {
        select: {
          id: true,
          name: true,
          username: true,
          image: true,
          level: true,
          xp: true,
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  // Check if current user follows these users
  let currentUserFollowing: Set<string> = new Set();
  if (currentUser) {
    const followingIds = following.map((f) => f.following.id);
    const myFollowing = await prisma.follow.findMany({
      where: {
        followerId: currentUser.id,
        followingId: { in: followingIds },
      },
      select: { followingId: true },
    });
    currentUserFollowing = new Set(myFollowing.map((f) => f.followingId));
  }

  const followingWithState = following.map((f) => ({
    ...f.following,
    isFollowing: currentUserFollowing.has(f.following.id),
  }));

  return c.json({ data: followingWithState });
});
