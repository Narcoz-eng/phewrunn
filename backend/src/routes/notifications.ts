import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { prisma } from "../prisma.js";
import { type AuthVariables, requireAuth } from "../auth.js";
import { NotificationsQuerySchema } from "../types.js";

export const notificationsRouter = new Hono<{ Variables: AuthVariables }>();

// Get all notifications for current user
// Query param: includeDismissed (default false)
notificationsRouter.get("/", requireAuth, async (c) => {
  const user = c.get("user");
  if (!user) {
    return c.json({ error: { message: "Unauthorized", code: "UNAUTHORIZED" } }, 401);
  }

  // Parse query params
  const query = c.req.query();
  const parsed = NotificationsQuerySchema.safeParse(query);
  const includeDismissed = parsed.success ? parsed.data.includeDismissed : false;

  const whereClause: { userId: string; dismissed?: boolean } = { userId: user.id };

  // By default, filter out dismissed notifications
  if (!includeDismissed) {
    whereClause.dismissed = false;
  }

  const notifications = await prisma.notification.findMany({
    where: whereClause,
    orderBy: { createdAt: "desc" },
    take: 50,
    include: {
      fromUser: {
        select: {
          id: true,
          name: true,
          username: true,
          image: true,
          level: true,
        },
      },
      post: {
        select: {
          id: true,
          content: true,
          contractAddress: true,
        },
      },
    },
  });

  return c.json({ data: notifications });
});

// Get unread notification count (excludes dismissed)
notificationsRouter.get("/unread-count", requireAuth, async (c) => {
  const user = c.get("user");
  if (!user) {
    return c.json({ error: { message: "Unauthorized", code: "UNAUTHORIZED" } }, 401);
  }

  const count = await prisma.notification.count({
    where: {
      userId: user.id,
      read: false,
      dismissed: false, // Don't count dismissed notifications
    },
  });

  return c.json({ data: { count } });
});

// Mark notification as read
notificationsRouter.patch("/:id/read", requireAuth, async (c) => {
  const user = c.get("user");
  const notificationId = c.req.param("id");

  if (!user) {
    return c.json({ error: { message: "Unauthorized", code: "UNAUTHORIZED" } }, 401);
  }

  const notification = await prisma.notification.findUnique({
    where: { id: notificationId },
  });

  if (!notification) {
    return c.json({ error: { message: "Notification not found", code: "NOT_FOUND" } }, 404);
  }

  if (notification.userId !== user.id) {
    return c.json({ error: { message: "Unauthorized", code: "UNAUTHORIZED" } }, 403);
  }

  const updated = await prisma.notification.update({
    where: { id: notificationId },
    data: { read: true },
  });

  return c.json({ data: updated });
});

// Mark all notifications as read (excludes dismissed)
notificationsRouter.patch("/read-all", requireAuth, async (c) => {
  const user = c.get("user");
  if (!user) {
    return c.json({ error: { message: "Unauthorized", code: "UNAUTHORIZED" } }, 401);
  }

  await prisma.notification.updateMany({
    where: {
      userId: user.id,
      read: false,
      dismissed: false, // Only mark non-dismissed as read
    },
    data: { read: true },
  });

  return c.json({ data: { success: true } });
});

// Mark notification as clicked (for analytics)
// Sets clickedAt timestamp and marks as read
notificationsRouter.patch("/:id/click", requireAuth, async (c) => {
  const user = c.get("user");
  const notificationId = c.req.param("id");

  if (!user) {
    return c.json({ error: { message: "Unauthorized", code: "UNAUTHORIZED" } }, 401);
  }

  const notification = await prisma.notification.findUnique({
    where: { id: notificationId },
    include: {
      fromUser: {
        select: {
          id: true,
          name: true,
          username: true,
          image: true,
          level: true,
        },
      },
      post: {
        select: {
          id: true,
          content: true,
          contractAddress: true,
        },
      },
    },
  });

  if (!notification) {
    return c.json({ error: { message: "Notification not found", code: "NOT_FOUND" } }, 404);
  }

  if (notification.userId !== user.id) {
    return c.json({ error: { message: "Unauthorized", code: "UNAUTHORIZED" } }, 403);
  }

  const updated = await prisma.notification.update({
    where: { id: notificationId },
    data: {
      clickedAt: new Date(),
      read: true,
    },
    include: {
      fromUser: {
        select: {
          id: true,
          name: true,
          username: true,
          image: true,
          level: true,
        },
      },
      post: {
        select: {
          id: true,
          content: true,
          contractAddress: true,
        },
      },
    },
  });

  // Return the notification data for frontend navigation (no redirect URL)
  return c.json({ data: updated });
});

// Dismiss a notification (soft delete)
// Sets dismissed: true, notification won't appear in list but is kept for analytics
notificationsRouter.patch("/:id/dismiss", requireAuth, async (c) => {
  const user = c.get("user");
  const notificationId = c.req.param("id");

  if (!user) {
    return c.json({ error: { message: "Unauthorized", code: "UNAUTHORIZED" } }, 401);
  }

  const notification = await prisma.notification.findUnique({
    where: { id: notificationId },
  });

  if (!notification) {
    return c.json({ error: { message: "Notification not found", code: "NOT_FOUND" } }, 404);
  }

  if (notification.userId !== user.id) {
    return c.json({ error: { message: "Unauthorized", code: "UNAUTHORIZED" } }, 403);
  }

  const updated = await prisma.notification.update({
    where: { id: notificationId },
    data: { dismissed: true },
  });

  return c.json({ data: updated });
});

// Delete a notification (hard delete - kept for backwards compatibility)
notificationsRouter.delete("/:id", requireAuth, async (c) => {
  const user = c.get("user");
  const notificationId = c.req.param("id");

  if (!user) {
    return c.json({ error: { message: "Unauthorized", code: "UNAUTHORIZED" } }, 401);
  }

  const notification = await prisma.notification.findUnique({
    where: { id: notificationId },
  });

  if (!notification) {
    return c.json({ error: { message: "Notification not found", code: "NOT_FOUND" } }, 404);
  }

  if (notification.userId !== user.id) {
    return c.json({ error: { message: "Unauthorized", code: "UNAUTHORIZED" } }, 403);
  }

  await prisma.notification.delete({
    where: { id: notificationId },
  });

  return c.json({ data: { deleted: true } });
});
