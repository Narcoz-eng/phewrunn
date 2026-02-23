import { Hono } from "hono";
import { prisma } from "../prisma.js";
import { type AuthVariables, requireAuth } from "../auth.js";
import { type Announcement } from "../types.js";

// Public announcement routes for feed display and view tracking
export const announcementsRouter = new Hono<{ Variables: AuthVariables }>();

/**
 * GET /api/announcements - Get pinned announcements for feed (public)
 * Returns pinned announcements ordered by priority, with view status for authenticated users
 */
announcementsRouter.get("/", async (c) => {
  const user = c.get("user");

  // Get pinned announcements (or all if no pinned ones exist, limited to recent)
  const announcements = await prisma.announcement.findMany({
    where: { isPinned: true },
    orderBy: [{ priority: "desc" }, { createdAt: "desc" }],
    take: 10,
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
  });

  // If user is authenticated, get their viewed announcements
  let viewedIds: Set<string> = new Set();
  if (user) {
    const views = await prisma.announcementView.findMany({
      where: {
        userId: user.id,
        announcementId: { in: announcements.map((a) => a.id) },
      },
      select: { announcementId: true },
    });
    viewedIds = new Set(views.map((v) => v.announcementId));
  }

  const response: Announcement[] = announcements.map((a) => ({
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
    isViewed: viewedIds.has(a.id),
  }));

  return c.json({ data: response });
});

/**
 * GET /api/announcements/:id - Get a single announcement
 */
announcementsRouter.get("/:id", async (c) => {
  const announcementId = c.req.param("id");
  const user = c.get("user");

  const announcement = await prisma.announcement.findUnique({
    where: { id: announcementId },
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
  });

  if (!announcement) {
    return c.json(
      { error: { message: "Announcement not found", code: "NOT_FOUND" } },
      404
    );
  }

  // Check if user has viewed this announcement
  let isViewed = false;
  if (user) {
    const view = await prisma.announcementView.findUnique({
      where: {
        userId_announcementId: {
          userId: user.id,
          announcementId: announcement.id,
        },
      },
    });
    isViewed = !!view;
  }

  const response: Announcement = {
    id: announcement.id,
    title: announcement.title,
    content: announcement.content,
    isPinned: announcement.isPinned,
    priority: announcement.priority,
    createdAt: announcement.createdAt.toISOString(),
    updatedAt: announcement.updatedAt.toISOString(),
    authorId: announcement.authorId,
    author: announcement.author,
    viewCount: announcement._count.views,
    isViewed,
  };

  return c.json({ data: response });
});

/**
 * POST /api/announcements/:id/view - Mark announcement as viewed by current user
 */
announcementsRouter.post("/:id/view", requireAuth, async (c) => {
  const user = c.get("user");
  const announcementId = c.req.param("id");

  if (!user) {
    return c.json(
      { error: { message: "Unauthorized", code: "UNAUTHORIZED" } },
      401
    );
  }

  // Check if announcement exists
  const announcement = await prisma.announcement.findUnique({
    where: { id: announcementId },
  });

  if (!announcement) {
    return c.json(
      { error: { message: "Announcement not found", code: "NOT_FOUND" } },
      404
    );
  }

  // Check if already viewed
  const existingView = await prisma.announcementView.findUnique({
    where: {
      userId_announcementId: {
        userId: user.id,
        announcementId,
      },
    },
  });

  if (existingView) {
    // Already viewed, just return success
    return c.json({
      data: {
        viewed: true,
        viewedAt: existingView.viewedAt.toISOString(),
      },
    });
  }

  // Create view record
  const view = await prisma.announcementView.create({
    data: {
      userId: user.id,
      announcementId,
    },
  });

  return c.json({
    data: {
      viewed: true,
      viewedAt: view.viewedAt.toISOString(),
    },
  });
});
