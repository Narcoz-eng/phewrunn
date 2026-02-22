import { Hono } from "hono";
import { createMiddleware } from "hono/factory";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { prisma } from "../prisma";
import type { AuthVariables } from "../auth";
import {
  AdminUsersQuerySchema,
  AdminPostsQuerySchema,
  AdminAnnouncementsQuerySchema,
  CreateAnnouncementSchema,
  UpdateAnnouncementSchema,
  type AdminStats,
  type AdminUser,
  type AdminUsersResponse,
  type AdminPost,
  type AdminPostsResponse,
  type Announcement,
  type AdminAnnouncementsResponse,
} from "../types";

const adminRouter = new Hono<{ Variables: AuthVariables }>();

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
      select: { isAdmin: true },
    });

    if (!dbUser?.isAdmin) {
      return c.json(
        { error: { message: "Forbidden - Admin access required", code: "FORBIDDEN" } },
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

  // Run all queries in parallel
  const [
    totalUsers,
    totalPosts,
    postsToday,
    totalLikes,
    totalComments,
    totalReposts,
    avgLevelResult,
    settlementStats,
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
            { username: { contains: search } },
            { email: { contains: search } },
            { name: { contains: search } },
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
          walletAddress: true,
          level: true,
          xp: true,
          isAdmin: true,
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

    const response: AdminUsersResponse = {
      users: users.map((user): AdminUser => ({
        id: user.id,
        name: user.name,
        email: user.email,
        username: user.username,
        image: user.image,
        walletAddress: user.walletAddress,
        level: user.level,
        xp: user.xp,
        isAdmin: user.isAdmin,
        isVerified: user.isVerified,
        createdAt: user.createdAt.toISOString(),
        _count: user._count,
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

    const response: AdminPostsResponse = {
      posts: posts.map((post): AdminPost => ({
        id: post.id,
        content: post.content,
        authorId: post.authorId,
        author: post.author,
        contractAddress: post.contractAddress,
        chainType: post.chainType,
        tokenSymbol: post.tokenSymbol,
        entryMcap: post.entryMcap,
        currentMcap: post.currentMcap,
        settled: post.settled,
        settledAt: post.settledAt?.toISOString() ?? null,
        isWin: post.isWin,
        viewCount: post.viewCount,
        createdAt: post.createdAt.toISOString(),
        _count: post._count,
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
