import { Hono } from "hono";
import { createMiddleware } from "hono/factory";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "../prisma.js";
import type { AuthVariables } from "../auth.js";
import {
  AdminUsersQuerySchema,
  AdminPostsQuerySchema,
  AdminReportsQuerySchema,
  AdminAnnouncementsQuerySchema,
  CreateAnnouncementSchema,
  UpdateAnnouncementSchema,
  UpdateAdminReportSchema,
  MIN_LEVEL,
  MAX_LEVEL,
  type AdminStats,
  type AdminReport,
  type AdminReportsResponse,
  type AdminUser,
  type AdminUsersResponse,
  type AdminPost,
  type AdminPostsResponse,
  type Announcement,
  type AdminAnnouncementsResponse,
} from "../types.js";

const adminRouter = new Hono<{ Variables: AuthVariables }>();
const ADMIN_EMAIL_ALLOWLIST = new Set(["rengarro@gmail.com"]);
const SOL_MINT = "So11111111111111111111111111111111111111112";
const ACTIVE_REPORT_STATUSES = ["open", "reviewing"] as const;

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

function toSafeNumber(value: unknown): number {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : 0;
  }
  if (typeof value === "bigint") {
    return Number(value);
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  if (value instanceof Prisma.Decimal) {
    return value.toNumber();
  }
  return 0;
}

function toRoundedSol(lamports: unknown): number {
  return Math.round((toSafeNumber(lamports) / 1_000_000_000) * 10_000) / 10_000;
}

function toCount(value: unknown): number {
  return Math.max(0, Math.round(toSafeNumber(value)));
}

async function getTradeSummary() {
  try {
    const rows = await prisma.$queryRaw<
      Array<{ volumeLamports: Prisma.Decimal | number | string | null; tradeCount: bigint | number | null }>
    >(Prisma.sql`
      SELECT
        COALESCE(SUM(
          CASE
            WHEN "inputMint" = ${SOL_MINT} THEN CAST("inAmountAtomic" AS numeric)
            WHEN "outputMint" = ${SOL_MINT} THEN CAST("outAmountAtomic" AS numeric)
            ELSE 0
          END
        ), 0) AS "volumeLamports",
        COUNT(*) AS "tradeCount"
      FROM "TradeFeeEvent"
      WHERE "txSignature" IS NOT NULL
    `);

    const row = rows[0];
    return {
      confirmedTrades: toCount(row?.tradeCount ?? 0),
      routedVolumeSol: toRoundedSol(row?.volumeLamports ?? 0),
    };
  } catch (error) {
    if (isPrismaSchemaDriftError(error)) {
      return {
        confirmedTrades: 0,
        routedVolumeSol: 0,
      };
    }
    throw error;
  }
}

async function getUserVolumeMaps(userIds: string[]) {
  const traderMap = new Map<string, { confirmedTradeCount: number; traderVolumeSol: number }>();
  const drivenMap = new Map<string, { drivenTradeCount: number; drivenVolumeSol: number }>();

  if (userIds.length === 0) {
    return { traderMap, drivenMap };
  }

  try {
    const [traderRows, drivenRows] = await Promise.all([
      prisma.$queryRaw<
        Array<{ userId: string; tradeCount: bigint | number | null; volumeLamports: Prisma.Decimal | number | string | null }>
      >(Prisma.sql`
        SELECT
          "traderUserId" AS "userId",
          COUNT(*) AS "tradeCount",
          COALESCE(SUM(
            CASE
              WHEN "inputMint" = ${SOL_MINT} THEN CAST("inAmountAtomic" AS numeric)
              WHEN "outputMint" = ${SOL_MINT} THEN CAST("outAmountAtomic" AS numeric)
              ELSE 0
            END
          ), 0) AS "volumeLamports"
        FROM "TradeFeeEvent"
        WHERE "txSignature" IS NOT NULL
          AND "traderUserId" IN (${Prisma.join(userIds)})
        GROUP BY "traderUserId"
      `),
      prisma.$queryRaw<
        Array<{ userId: string; tradeCount: bigint | number | null; volumeLamports: Prisma.Decimal | number | string | null }>
      >(Prisma.sql`
        SELECT
          "posterUserId" AS "userId",
          COUNT(*) AS "tradeCount",
          COALESCE(SUM(
            CASE
              WHEN "inputMint" = ${SOL_MINT} THEN CAST("inAmountAtomic" AS numeric)
              WHEN "outputMint" = ${SOL_MINT} THEN CAST("outAmountAtomic" AS numeric)
              ELSE 0
            END
          ), 0) AS "volumeLamports"
        FROM "TradeFeeEvent"
        WHERE "txSignature" IS NOT NULL
          AND "posterUserId" IN (${Prisma.join(userIds)})
        GROUP BY "posterUserId"
      `),
    ]);

    for (const row of traderRows) {
      traderMap.set(row.userId, {
        confirmedTradeCount: toCount(row.tradeCount),
        traderVolumeSol: toRoundedSol(row.volumeLamports),
      });
    }

    for (const row of drivenRows) {
      drivenMap.set(row.userId, {
        drivenTradeCount: toCount(row.tradeCount),
        drivenVolumeSol: toRoundedSol(row.volumeLamports),
      });
    }
  } catch (error) {
    if (!isPrismaSchemaDriftError(error)) {
      throw error;
    }
  }

  return { traderMap, drivenMap };
}

async function getUserReportMap(userIds: string[]) {
  const reportMap = new Map<string, { reportCount: number; openReportCount: number }>();

  if (userIds.length === 0) {
    return reportMap;
  }

  try {
    const rows = await prisma.$queryRaw<
      Array<{ userId: string; reportCount: bigint | number | null; openReportCount: bigint | number | null }>
    >(Prisma.sql`
      SELECT
        "targetUserId" AS "userId",
        COUNT(*) AS "reportCount",
        COUNT(*) FILTER (WHERE "status" IN (${Prisma.join(ACTIVE_REPORT_STATUSES)})) AS "openReportCount"
      FROM "Report"
      WHERE "targetUserId" IN (${Prisma.join(userIds)})
      GROUP BY "targetUserId"
    `);

    for (const row of rows) {
      reportMap.set(row.userId, {
        reportCount: toCount(row.reportCount),
        openReportCount: toCount(row.openReportCount),
      });
    }
  } catch (error) {
    if (!isPrismaSchemaDriftError(error)) {
      throw error;
    }
  }

  return reportMap;
}

async function getPostReportMap(postIds: string[]) {
  const reportMap = new Map<string, { reportCount: number; openReportCount: number }>();

  if (postIds.length === 0) {
    return reportMap;
  }

  try {
    const rows = await prisma.$queryRaw<
      Array<{ postId: string; reportCount: bigint | number | null; openReportCount: bigint | number | null }>
    >(Prisma.sql`
      SELECT
        "postId",
        COUNT(*) AS "reportCount",
        COUNT(*) FILTER (WHERE "status" IN (${Prisma.join(ACTIVE_REPORT_STATUSES)})) AS "openReportCount"
      FROM "Report"
      WHERE "postId" IN (${Prisma.join(postIds)})
      GROUP BY "postId"
    `);

    for (const row of rows) {
      reportMap.set(row.postId, {
        reportCount: toCount(row.reportCount),
        openReportCount: toCount(row.openReportCount),
      });
    }
  } catch (error) {
    if (!isPrismaSchemaDriftError(error)) {
      throw error;
    }
  }

  return reportMap;
}

const AdminUpdateUserSchema = z
  .object({
    name: z.string().trim().min(1).max(100).optional(),
    username: z.preprocess(
      (val) => (typeof val === "string" && val.trim() === "" ? null : val),
      z
        .string()
        .trim()
        .min(3)
        .max(32)
        .regex(/^[a-zA-Z0-9_]+$/)
        .nullable()
        .optional()
    ),
    bio: z.preprocess(
      (val) => (typeof val === "string" && val.trim() === "" ? null : val),
      z.string().trim().max(280).nullable().optional()
    ),
    level: z.number().int().min(MIN_LEVEL).max(MAX_LEVEL).optional(),
    xp: z.number().int().min(0).max(1_000_000_000).optional(),
    isVerified: z.boolean().optional(),
    isBanned: z.boolean().optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: "At least one field is required",
  });

const AdminUpdatePostSchema = z
  .object({
    content: z.string().trim().min(1).max(2000).optional(),
    tokenName: z.preprocess(
      (val) => (typeof val === "string" && val.trim() === "" ? null : val),
      z.string().trim().max(100).nullable().optional()
    ),
    tokenSymbol: z.preprocess(
      (val) => (typeof val === "string" && val.trim() === "" ? null : val),
      z.string().trim().max(32).nullable().optional()
    ),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: "At least one field is required",
  });

/**
 * Middleware to check if the current user is an admin
 */
const requireAdmin = createMiddleware<{ Variables: AuthVariables }>(
  async (c, next) => {
    const user = c.get("user");

    if (!user) {
      return c.json(
        { error: { message: "Unauthorized", code: "UNAUTHORIZED" } },
        401
      );
    }

    // Check if user is admin in database
    const dbUser = await prisma.user.findUnique({
      where: { id: user.id },
      select: { email: true, isAdmin: true },
    });

    const email = dbUser?.email?.trim().toLowerCase();
    if (!email || !ADMIN_EMAIL_ALLOWLIST.has(email)) {
      return c.json(
        { error: { message: "Forbidden - Admin access is restricted", code: "FORBIDDEN" } },
        403
      );
    }

    return next();
  }
);

// Apply admin middleware to all routes
adminRouter.use("*", requireAdmin);

/**
 * GET /api/admin/stats - Get global platform statistics
 */
adminRouter.get("/stats", async (c) => {
  // Get today's start for posts count
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const reportSummaryPromise = (async () => {
    try {
      const [totalReports, openReports] = await Promise.all([
        prisma.report.count(),
        prisma.report.count({
          where: {
            status: { in: [...ACTIVE_REPORT_STATUSES] },
          },
        }),
      ]);

      return { totalReports, openReports };
    } catch (error) {
      if (isPrismaSchemaDriftError(error)) {
        return {
          totalReports: 0,
          openReports: 0,
        };
      }
      throw error;
    }
  })();

  const [
    totalUsers,
    totalPosts,
    postsToday,
    totalLikes,
    totalComments,
    totalReposts,
    avgLevelResult,
    settlementStats,
    tradeSummary,
    reportSummary,
  ] = await Promise.all([
    prisma.user.count(),
    prisma.post.count(),
    prisma.post.count({
      where: { createdAt: { gte: todayStart } },
    }),
    prisma.like.count(),
    prisma.comment.count(),
    prisma.repost.count(),
    prisma.user.aggregate({
      _avg: { level: true },
    }),
    prisma.post.groupBy({
      by: ["isWin"],
      where: { settled: true },
      _count: true,
    }),
    getTradeSummary(),
    reportSummaryPromise,
  ]);

  // Calculate settlement stats
  const settledPosts = settlementStats.reduce((acc, stat) => acc + stat._count, 0);
  const wins = settlementStats.find((s) => s.isWin === true)?._count || 0;
  const losses = settlementStats.find((s) => s.isWin === false)?._count || 0;
  const winRate = settledPosts > 0 ? (wins / settledPosts) * 100 : 0;

  const stats: AdminStats = {
    totalUsers,
    totalPosts,
    postsToday,
    totalLikes,
    totalComments,
    totalReposts,
    confirmedTrades: tradeSummary.confirmedTrades,
    routedVolumeSol: tradeSummary.routedVolumeSol,
    totalReports: reportSummary.totalReports,
    openReports: reportSummary.openReports,
    averageLevel: avgLevelResult._avg.level || 0,
    settlementStats: {
      total: settledPosts,
      wins,
      losses,
      winRate: Math.round(winRate * 100) / 100,
    },
  };

  return c.json({ data: stats });
});

/**
 * GET /api/admin/users - List all users with pagination
 */
adminRouter.get(
  "/users",
  zValidator("query", AdminUsersQuerySchema),
  async (c) => {
    const { page, limit, search, sortBy, sortOrder } = c.req.valid("query");
    const skip = (page - 1) * limit;

    // Build where clause for search
    const where = search
      ? {
          OR: [
            { username: { contains: search, mode: "insensitive" as const } },
            { email: { contains: search, mode: "insensitive" as const } },
            { name: { contains: search, mode: "insensitive" as const } },
          ],
        }
      : {};

    // Build orderBy clause
    let orderBy: Record<string, string | Record<string, string>> = { createdAt: sortOrder };
    if (sortBy === "posts") {
      orderBy = { posts: { _count: sortOrder } };
    } else if (sortBy === "level" || sortBy === "xp") {
      orderBy = { [sortBy]: sortOrder };
    }

    // Run queries in parallel
    const [users, total] = await Promise.all([
      prisma.user.findMany({
        where,
        skip,
        take: limit,
        orderBy,
        select: {
          id: true,
          name: true,
          email: true,
          username: true,
          image: true,
          bio: true,
          walletAddress: true,
          level: true,
          xp: true,
          isAdmin: true,
          isBanned: true,
          isVerified: true,
          createdAt: true,
          _count: {
            select: {
              posts: true,
              followers: true,
              following: true,
            },
          },
        },
      }),
      prisma.user.count({ where }),
    ]);

    const userIds = users.map((user) => user.id);
    const [{ traderMap, drivenMap }, userReportMap] = await Promise.all([
      getUserVolumeMaps(userIds),
      getUserReportMap(userIds),
    ]);

    const response: AdminUsersResponse = {
      users: users.map((user): AdminUser => {
        const traderMetrics = traderMap.get(user.id);
        const drivenMetrics = drivenMap.get(user.id);
        const reportMetrics = userReportMap.get(user.id);

        return {
          id: user.id,
          name: user.name,
          email: user.email,
          username: user.username,
          image: user.image,
          bio: user.bio,
          walletAddress: user.walletAddress,
          level: user.level,
          xp: user.xp,
          isAdmin: user.isAdmin,
          isBanned: user.isBanned,
          isVerified: user.isVerified,
          createdAt: user.createdAt.toISOString(),
          confirmedTradeCount: traderMetrics?.confirmedTradeCount ?? 0,
          traderVolumeSol: traderMetrics?.traderVolumeSol ?? 0,
          drivenTradeCount: drivenMetrics?.drivenTradeCount ?? 0,
          drivenVolumeSol: drivenMetrics?.drivenVolumeSol ?? 0,
          reportCount: reportMetrics?.reportCount ?? 0,
          openReportCount: reportMetrics?.openReportCount ?? 0,
          _count: user._count,
        };
      }),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };

    return c.json({ data: response });
  }
);

/**
 * PATCH /api/admin/users/:id - Edit user profile/moderation fields
 */
adminRouter.patch(
  "/users/:id",
  zValidator("json", AdminUpdateUserSchema),
  async (c) => {
    const userId = c.req.param("id");
    const currentUser = c.get("user");
    const updates = c.req.valid("json");

    const existing = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, name: true },
    });

    if (!existing) {
      return c.json(
        { error: { message: "User not found", code: "NOT_FOUND" } },
        404
      );
    }

    if (currentUser?.id === userId && updates.isBanned === true) {
      return c.json(
        { error: { message: "Cannot ban the current admin user", code: "INVALID_OPERATION" } },
        400
      );
    }

    try {
      const updated = await prisma.user.update({
        where: { id: userId },
        data: updates,
        select: {
          id: true,
          name: true,
          email: true,
          username: true,
          image: true,
          bio: true,
          walletAddress: true,
          level: true,
          xp: true,
          isAdmin: true,
          isBanned: true,
          isVerified: true,
          createdAt: true,
        },
      });

      return c.json({
        data: {
          success: true,
          message: `User ${existing.name} updated successfully`,
          user: {
            ...updated,
            createdAt: updated.createdAt.toISOString(),
          },
        },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        return c.json(
          { error: { message: "Username already exists", code: "CONFLICT" } },
          409
        );
      }

      console.error("[Admin] Failed to update user:", error);
      return c.json(
        { error: { message: "Failed to update user", code: "INTERNAL_ERROR" } },
        500
      );
    }
  }
);

/**
 * GET /api/admin/posts - List all posts with pagination
 */
adminRouter.get(
  "/posts",
  zValidator("query", AdminPostsQuerySchema),
  async (c) => {
    const { page, limit, filter } = c.req.valid("query");
    const skip = (page - 1) * limit;

    // Build where clause for filter
    let where = {};
    if (filter === "settled") {
      where = { settled: true };
    } else if (filter === "unsettled") {
      where = { settled: false };
    }

    // Run queries in parallel
    const [posts, total] = await Promise.all([
      prisma.post.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          content: true,
          authorId: true,
          author: {
            select: {
              id: true,
              name: true,
              username: true,
              image: true,
              level: true,
            },
          },
          contractAddress: true,
          chainType: true,
          tokenName: true,
          tokenSymbol: true,
          entryMcap: true,
          currentMcap: true,
          settled: true,
          settledAt: true,
          isWin: true,
          viewCount: true,
          createdAt: true,
          _count: {
            select: {
              likes: true,
              comments: true,
              reposts: true,
            },
          },
        },
      }),
      prisma.post.count({ where }),
    ]);

    const postReportMap = await getPostReportMap(posts.map((post) => post.id));

    const response: AdminPostsResponse = {
      posts: posts.map((post): AdminPost => {
        const reportMetrics = postReportMap.get(post.id);

        return {
          id: post.id,
          content: post.content,
          authorId: post.authorId,
          author: post.author,
          contractAddress: post.contractAddress,
          chainType: post.chainType,
          tokenName: post.tokenName,
          tokenSymbol: post.tokenSymbol,
          entryMcap: post.entryMcap,
          currentMcap: post.currentMcap,
          settled: post.settled,
          settledAt: post.settledAt?.toISOString() ?? null,
          isWin: post.isWin,
          viewCount: post.viewCount,
          createdAt: post.createdAt.toISOString(),
          reportCount: reportMetrics?.reportCount ?? 0,
          openReportCount: reportMetrics?.openReportCount ?? 0,
          _count: post._count,
        };
      }),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };

    return c.json({ data: response });
  }
);

/**
 * PATCH /api/admin/posts/:id - Edit post content/token labels
 */
adminRouter.patch(
  "/posts/:id",
  zValidator("json", AdminUpdatePostSchema),
  async (c) => {
    const postId = c.req.param("id");
    const updates = c.req.valid("json");

    const existing = await prisma.post.findUnique({
      where: { id: postId },
      select: { id: true },
    });

    if (!existing) {
      return c.json(
        { error: { message: "Post not found", code: "NOT_FOUND" } },
        404
      );
    }

    const updated = await prisma.post.update({
      where: { id: postId },
      data: updates,
      select: {
        id: true,
        content: true,
        tokenName: true,
        tokenSymbol: true,
        updatedAt: true,
      },
    });

    return c.json({
      data: {
        success: true,
        message: "Post updated successfully",
        post: {
          ...updated,
          updatedAt: updated.updatedAt.toISOString(),
        },
      },
    });
  }
);

/**
 * POST /api/admin/users/:id/ban - Ban/unban a user
 */
adminRouter.post("/users/:id/ban", async (c) => {
  const userId = c.req.param("id");

  // Check if user exists
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, name: true, isBanned: true },
  });

  if (!user) {
    return c.json(
      { error: { message: "User not found", code: "NOT_FOUND" } },
      404
    );
  }

  // Toggle ban status
  const updatedUser = await prisma.user.update({
    where: { id: userId },
    data: { isBanned: !user.isBanned },
    select: { id: true, name: true, isBanned: true },
  });

  return c.json({
    data: {
      success: true,
      message: updatedUser.isBanned
        ? `User ${user.name} has been banned`
        : `User ${user.name} has been unbanned`,
      userId: user.id,
      isBanned: updatedUser.isBanned,
    },
  });
});

/**
 * PATCH /api/admin/users/:userId/verify - Set/unset verified status
 */
adminRouter.patch(
  "/users/:userId/verify",
  zValidator("json", z.object({ isVerified: z.boolean() })),
  async (c) => {
    const userId = c.req.param("userId");
    const { isVerified } = c.req.valid("json");

    // Check if user exists
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, name: true },
    });

    if (!user) {
      return c.json(
        { error: { message: "User not found", code: "NOT_FOUND" } },
        404
      );
    }

    // Update verified status
    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: { isVerified },
      select: { id: true, name: true, isVerified: true },
    });

    return c.json({
      data: {
        success: true,
        message: updatedUser.isVerified
          ? `User ${user.name} has been verified`
          : `User ${user.name} verification has been removed`,
        userId: user.id,
        isVerified: updatedUser.isVerified,
      },
    });
  }
);

/**
 * DELETE /api/admin/posts/:id - Delete any post (moderation)
 */
adminRouter.delete("/posts/:id", async (c) => {
  const postId = c.req.param("id");

  // Check if post exists
  const post = await prisma.post.findUnique({
    where: { id: postId },
    select: { id: true, content: true, authorId: true },
  });

  if (!post) {
    return c.json(
      { error: { message: "Post not found", code: "NOT_FOUND" } },
      404
    );
  }

  // Delete the post (cascades to likes, comments, reposts, notifications)
  await prisma.post.delete({
    where: { id: postId },
  });

  return c.json({
    data: {
      success: true,
      message: "Post deleted successfully",
      postId: post.id,
    },
  });
});

/**
 * GET /api/admin/reports - List moderation reports
 */
adminRouter.get(
  "/reports",
  zValidator("query", AdminReportsQuerySchema),
  async (c) => {
    const { page, limit, status, targetType } = c.req.valid("query");
    const skip = (page - 1) * limit;

    const where = {
      ...(status !== "all" ? { status } : {}),
      ...(targetType !== "all" ? { entityType: targetType } : {}),
    };

    try {
      const [reports, total] = await Promise.all([
        prisma.report.findMany({
          where,
          skip,
          take: limit,
          orderBy: [{ createdAt: "desc" }],
          include: {
            reporter: {
              select: {
                id: true,
                name: true,
                username: true,
                image: true,
              },
            },
            targetUser: {
              select: {
                id: true,
                name: true,
                username: true,
                image: true,
              },
            },
            post: {
              select: {
                id: true,
                content: true,
                author: {
                  select: {
                    id: true,
                    name: true,
                    username: true,
                    image: true,
                  },
                },
              },
            },
            reviewedBy: {
              select: {
                id: true,
                name: true,
                username: true,
                image: true,
              },
            },
          },
        }),
        prisma.report.count({ where }),
      ]);

      const response: AdminReportsResponse = {
        reports: reports.map((report): AdminReport => ({
          id: report.id,
          entityType: report.entityType as AdminReport["entityType"],
          reason: report.reason as AdminReport["reason"],
          details: report.details,
          status: report.status as AdminReport["status"],
          createdAt: report.createdAt.toISOString(),
          updatedAt: report.updatedAt.toISOString(),
          resolvedAt: report.resolvedAt?.toISOString() ?? null,
          reviewerNotes: report.reviewerNotes ?? null,
          reporter: report.reporter,
          targetUser: report.targetUser,
          post: report.post
            ? {
                id: report.post.id,
                content: report.post.content,
                author: report.post.author,
              }
            : null,
          reviewedBy: report.reviewedBy,
        })),
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      };

      return c.json({ data: response });
    } catch (error) {
      if (isPrismaSchemaDriftError(error)) {
        const response: AdminReportsResponse = {
          reports: [],
          total: 0,
          page,
          limit,
          totalPages: 0,
        };
        return c.json({ data: response });
      }

      console.error("[Admin] Failed to load reports:", error);
      return c.json(
        { error: { message: "Failed to load reports", code: "INTERNAL_ERROR" } },
        500
      );
    }
  }
);

/**
 * PATCH /api/admin/reports/:id - Update report review status
 */
adminRouter.patch(
  "/reports/:id",
  zValidator("json", UpdateAdminReportSchema),
  async (c) => {
    const reportId = c.req.param("id");
    const reviewer = c.get("user");
    const payload = c.req.valid("json");

    if (!reviewer) {
      return c.json({ error: { message: "Unauthorized", code: "UNAUTHORIZED" } }, 401);
    }

    try {
      const existing = await prisma.report.findUnique({
        where: { id: reportId },
        select: { id: true },
      });

      if (!existing) {
        return c.json(
          { error: { message: "Report not found", code: "NOT_FOUND" } },
          404
        );
      }

      const nextResolvedAt =
        payload.status === "resolved" || payload.status === "dismissed" ? new Date() : null;

      const updated = await prisma.report.update({
        where: { id: reportId },
        data: {
          status: payload.status,
          reviewerNotes: payload.reviewerNotes ?? null,
          reviewedById: reviewer.id,
          resolvedAt: nextResolvedAt,
        },
        select: {
          id: true,
          status: true,
          resolvedAt: true,
          reviewerNotes: true,
        },
      });

      return c.json({
        data: {
          success: true,
          report: {
            id: updated.id,
            status: updated.status,
            resolvedAt: updated.resolvedAt?.toISOString() ?? null,
            reviewerNotes: updated.reviewerNotes ?? null,
          },
        },
      });
    } catch (error) {
      if (isPrismaSchemaDriftError(error)) {
        return c.json(
          { error: { message: "Reports schema is not available yet", code: "REPORTS_UNAVAILABLE" } },
          503
        );
      }

      console.error("[Admin] Failed to update report:", error);
      return c.json(
        { error: { message: "Failed to update report", code: "INTERNAL_ERROR" } },
        500
      );
    }
  }
);

// =====================================================
// Announcement Routes
// =====================================================

/**
 * GET /api/admin/announcements - List all announcements with pagination
 */
adminRouter.get(
  "/announcements",
  zValidator("query", AdminAnnouncementsQuerySchema),
  async (c) => {
    const { page, limit } = c.req.valid("query");
    const skip = (page - 1) * limit;

    const [announcements, total] = await Promise.all([
      prisma.announcement.findMany({
        skip,
        take: limit,
        orderBy: [{ isPinned: "desc" }, { priority: "desc" }, { createdAt: "desc" }],
        include: {
          author: {
            select: {
              id: true,
              name: true,
              username: true,
              image: true,
            },
          },
          _count: {
            select: {
              views: true,
            },
          },
        },
      }),
      prisma.announcement.count(),
    ]);

    const response: AdminAnnouncementsResponse = {
      announcements: announcements.map((a): Announcement => ({
        id: a.id,
        title: a.title,
        content: a.content,
        isPinned: a.isPinned,
        priority: a.priority,
        createdAt: a.createdAt.toISOString(),
        updatedAt: a.updatedAt.toISOString(),
        authorId: a.authorId,
        author: a.author,
        viewCount: a._count.views,
      })),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };

    return c.json({ data: response });
  }
);

/**
 * POST /api/admin/announcements - Create announcement
 */
adminRouter.post(
  "/announcements",
  zValidator("json", CreateAnnouncementSchema),
  async (c) => {
    const user = c.get("user");
    if (!user) {
      return c.json(
        { error: { message: "Unauthorized", code: "UNAUTHORIZED" } },
        401
      );
    }

    const { title, content, isPinned, priority } = c.req.valid("json");

    const announcement = await prisma.announcement.create({
      data: {
        title,
        content,
        isPinned: isPinned ?? false,
        priority: priority ?? 0,
        authorId: user.id,
      },
      include: {
        author: {
          select: {
            id: true,
            name: true,
            username: true,
            image: true,
          },
        },
      },
    });

    return c.json({
      data: {
        id: announcement.id,
        title: announcement.title,
        content: announcement.content,
        isPinned: announcement.isPinned,
        priority: announcement.priority,
        createdAt: announcement.createdAt.toISOString(),
        updatedAt: announcement.updatedAt.toISOString(),
        authorId: announcement.authorId,
        author: announcement.author,
      } as Announcement,
    });
  }
);

/**
 * PATCH /api/admin/announcements/:id - Update announcement
 */
adminRouter.patch(
  "/announcements/:id",
  zValidator("json", UpdateAnnouncementSchema),
  async (c) => {
    const announcementId = c.req.param("id");
    const updates = c.req.valid("json");

    // Check if announcement exists
    const existing = await prisma.announcement.findUnique({
      where: { id: announcementId },
    });

    if (!existing) {
      return c.json(
        { error: { message: "Announcement not found", code: "NOT_FOUND" } },
        404
      );
    }

    const announcement = await prisma.announcement.update({
      where: { id: announcementId },
      data: updates,
      include: {
        author: {
          select: {
            id: true,
            name: true,
            username: true,
            image: true,
          },
        },
      },
    });

    return c.json({
      data: {
        id: announcement.id,
        title: announcement.title,
        content: announcement.content,
        isPinned: announcement.isPinned,
        priority: announcement.priority,
        createdAt: announcement.createdAt.toISOString(),
        updatedAt: announcement.updatedAt.toISOString(),
        authorId: announcement.authorId,
        author: announcement.author,
      } as Announcement,
    });
  }
);

/**
 * DELETE /api/admin/announcements/:id - Delete announcement
 */
adminRouter.delete("/announcements/:id", async (c) => {
  const announcementId = c.req.param("id");

  // Check if announcement exists
  const existing = await prisma.announcement.findUnique({
    where: { id: announcementId },
  });

  if (!existing) {
    return c.json(
      { error: { message: "Announcement not found", code: "NOT_FOUND" } },
      404
    );
  }

  await prisma.announcement.delete({
    where: { id: announcementId },
  });

  return c.json({
    data: {
      success: true,
      message: "Announcement deleted successfully",
      announcementId,
    },
  });
});

/**
 * POST /api/admin/announcements/:id/pin - Toggle pin status
 */
adminRouter.post("/announcements/:id/pin", async (c) => {
  const announcementId = c.req.param("id");

  // Check if announcement exists
  const existing = await prisma.announcement.findUnique({
    where: { id: announcementId },
  });

  if (!existing) {
    return c.json(
      { error: { message: "Announcement not found", code: "NOT_FOUND" } },
      404
    );
  }

  const announcement = await prisma.announcement.update({
    where: { id: announcementId },
    data: { isPinned: !existing.isPinned },
    include: {
      author: {
        select: {
          id: true,
          name: true,
          username: true,
          image: true,
        },
      },
    },
  });

  return c.json({
    data: {
      id: announcement.id,
      title: announcement.title,
      content: announcement.content,
      isPinned: announcement.isPinned,
      priority: announcement.priority,
      createdAt: announcement.createdAt.toISOString(),
      updatedAt: announcement.updatedAt.toISOString(),
      authorId: announcement.authorId,
      author: announcement.author,
    } as Announcement,
  });
});

export { adminRouter };
