import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { prisma } from "../prisma.js";
import { type AuthVariables, requireAuth } from "../auth.js";
import { NotificationsQuerySchema } from "../types.js";

export const notificationsRouter = new Hono<{ Variables: AuthVariables }>();

function normalizeNotificationMessage(message: string): string {
  return message.trim().toLowerCase().replace(/\s+/g, " ");
}

function buildNotificationGroupKey(notification: {
  id: string;
  type: string;
  fromUserId: string | null;
  postId: string | null;
  message: string;
}): string {
  const actorKey = notification.fromUserId ?? "system";
  const postKey = notification.postId ?? "none";
  const messageKey = normalizeNotificationMessage(notification.message).slice(0, 96);

  switch (notification.type) {
    case "like":
    case "comment":
    case "repost":
    case "new_post":
    case "follow":
      return `${notification.type}:${actorKey}`;
    case "win_1h":
    case "loss_1h":
    case "win_6h":
    case "loss_6h":
    case "settlement":
    case "level_up":
    case "achievement":
      return `${notification.type}:${actorKey}:${messageKey}`;
    default:
      return `${notification.type}:${actorKey}:${postKey}:${messageKey}:${notification.id}`;
  }
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof (error as { message?: unknown }).message === "string"
  ) {
    return (error as { message: string }).message;
  }
  return "";
}

function isPrismaSchemaDriftError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const code = "code" in error ? String((error as { code?: unknown }).code ?? "") : "";
  if (code === "P2021" || code === "P2022") return true;
  const message = getErrorMessage(error);
  return /does not exist|unknown arg|unknown field|column|table|no such column|invalid\s+`prisma\.[^`]+`\s+invocation/i.test(message);
}

function isPrismaMissingColumnError(error: unknown, columnName: string): boolean {
  if (!isPrismaSchemaDriftError(error)) return false;
  const message = getErrorMessage(error);
  return message.toLowerCase().includes(columnName.toLowerCase());
}

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

  if (!includeDismissed) {
    whereClause.dismissed = false;
  }

  let notifications: unknown[] = [];
  try {
    notifications = await prisma.notification.findMany({
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
  } catch (error) {
    if (!isPrismaSchemaDriftError(error)) {
      throw error;
    }
    try {
      notifications = await prisma.notification.findMany({
        where: { userId: user.id },
        orderBy: { createdAt: "desc" },
        take: 50,
        include: {
          fromUser: {
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
              contractAddress: true,
            },
          },
        },
      });
    } catch (fallbackError) {
      if (!isPrismaSchemaDriftError(fallbackError)) {
        throw fallbackError;
      }
      try {
        const minimalNotifications = await prisma.notification.findMany({
          where: { userId: user.id },
          orderBy: { createdAt: "desc" },
          take: 50,
          select: {
            id: true,
            type: true,
            message: true,
            read: true,
            postId: true,
            fromUserId: true,
            createdAt: true,
          },
        });
        notifications = minimalNotifications.map((notification) => ({
          ...notification,
          dismissed: false,
          clickedAt: null,
          fromUser: null,
          post: null,
        }));
      } catch (minimalError) {
        if (!isPrismaSchemaDriftError(minimalError)) {
          throw minimalError;
        }
        console.warn("[notifications/list] schema drift fallback exhausted; returning empty notifications list", {
          message: getErrorMessage(minimalError),
        });
        notifications = [];
      }
    }
  }

  return c.json({ data: notifications });
});

// Get unread notification count (excludes dismissed)
notificationsRouter.get("/unread-count", requireAuth, async (c) => {
  const user = c.get("user");
  if (!user) {
    return c.json({ error: { message: "Unauthorized", code: "UNAUTHORIZED" } }, 401);
  }

  let unreadNotifications: Array<{
    id: string;
    type: string;
    fromUserId: string | null;
    postId: string | null;
    message: string;
  }> = [];
  try {
    unreadNotifications = await prisma.notification.findMany({
      where: {
        userId: user.id,
        read: false,
        dismissed: false,
      },
      select: {
        id: true,
        type: true,
        fromUserId: true,
        postId: true,
        message: true,
      },
      orderBy: { createdAt: "desc" },
      take: 200,
    });
  } catch (error) {
    if (!isPrismaSchemaDriftError(error)) {
      throw error;
    }
    try {
      unreadNotifications = await prisma.notification.findMany({
        where: {
          userId: user.id,
          read: false,
        },
        select: {
          id: true,
          type: true,
          fromUserId: true,
          postId: true,
          message: true,
        },
        orderBy: { createdAt: "desc" },
        take: 200,
      });
    } catch (fallbackError) {
      if (!isPrismaSchemaDriftError(fallbackError)) {
        throw fallbackError;
      }
      try {
        const minimalRows = await prisma.notification.findMany({
          where: {
            userId: user.id,
          },
          select: {
            id: true,
            type: true,
          },
          orderBy: { createdAt: "desc" },
          take: 200,
        });
        unreadNotifications = minimalRows.map((row) => ({
          ...row,
          fromUserId: null,
          postId: null,
          message: "",
        }));
      } catch (minimalError) {
        if (!isPrismaSchemaDriftError(minimalError)) {
          throw minimalError;
        }
        console.warn("[notifications/unread-count] schema drift fallback exhausted; returning zero unread count", {
          message: getErrorMessage(minimalError),
        });
        unreadNotifications = [];
      }
    }
  }

  const groupKeys = new Set(
    unreadNotifications.map((notification) => buildNotificationGroupKey(notification))
  );

  return c.json({ data: { count: groupKeys.size } });
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

  try {
    await prisma.notification.updateMany({
      where: {
        userId: user.id,
        read: false,
        dismissed: false,
      },
      data: { read: true },
    });
  } catch (error) {
    if (!isPrismaMissingColumnError(error, "dismissed")) {
      throw error;
    }
    await prisma.notification.updateMany({
      where: {
        userId: user.id,
        read: false,
      },
      data: { read: true },
    });
  }

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

  let updated;
  try {
    updated = await prisma.notification.update({
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
  } catch (error) {
    if (!isPrismaMissingColumnError(error, "clickedAt")) {
      throw error;
    }
    updated = await prisma.notification.update({
      where: { id: notificationId },
      data: {
        read: true,
      },
      include: {
        fromUser: {
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
            contractAddress: true,
          },
        },
      },
    });
  }

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

  try {
    const updated = await prisma.notification.update({
      where: { id: notificationId },
      data: { dismissed: true },
    });
    return c.json({ data: updated });
  } catch (error) {
    if (!isPrismaMissingColumnError(error, "dismissed")) {
      throw error;
    }
    await prisma.notification.delete({
      where: { id: notificationId },
    });
    return c.json({ data: { deleted: true } });
  }
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
