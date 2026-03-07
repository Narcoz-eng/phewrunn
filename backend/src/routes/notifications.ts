import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { prisma } from "../prisma.js";
import { type AuthVariables, requireAuth } from "../auth.js";
import { cacheGetJson, cacheSetJson, redisDelete } from "../lib/redis.js";
import { NotificationsQuerySchema } from "../types.js";

export const notificationsRouter = new Hono<{ Variables: AuthVariables }>();

const NOTIFICATIONS_LIST_CACHE_TTL_MS =
  process.env.NODE_ENV === "production" ? 15_000 : 4_000;
const NOTIFICATIONS_UNREAD_CACHE_TTL_MS =
  process.env.NODE_ENV === "production" ? 10_000 : 3_000;
const NOTIFICATIONS_CACHE_MAX_ENTRIES =
  process.env.NODE_ENV === "production" ? 20_000 : 2_000;
const NOTIFICATIONS_LIST_REDIS_KEY_PREFIX = "notifications:list:v1";
const NOTIFICATIONS_UNREAD_REDIS_KEY_PREFIX = "notifications:unread:v1";

const notificationsListCache = new Map<
  string,
  {
    data: unknown[];
    expiresAtMs: number;
  }
>();
const notificationsUnreadCountCache = new Map<
  string,
  {
    count: number;
    expiresAtMs: number;
  }
>();

function trimNotificationCache<T>(
  cache: Map<string, T>,
  maxEntries = NOTIFICATIONS_CACHE_MAX_ENTRIES
): void {
  while (cache.size >= maxEntries) {
    const oldestKey = cache.keys().next().value;
    if (typeof oldestKey !== "string") {
      break;
    }
    cache.delete(oldestKey);
  }
}

function buildNotificationsListRedisKey(cacheKey: string): string {
  return `${NOTIFICATIONS_LIST_REDIS_KEY_PREFIX}:${cacheKey}`;
}

function buildNotificationsUnreadRedisKey(userId: string): string {
  return `${NOTIFICATIONS_UNREAD_REDIS_KEY_PREFIX}:${userId}`;
}

function writeNotificationsListCacheLocal(cacheKey: string, data: unknown[]): void {
  if (notificationsListCache.has(cacheKey)) {
    notificationsListCache.delete(cacheKey);
  }
  trimNotificationCache(notificationsListCache);
  notificationsListCache.set(cacheKey, {
    data,
    expiresAtMs: Date.now() + NOTIFICATIONS_LIST_CACHE_TTL_MS,
  });
}

async function readNotificationsListCache(cacheKey: string): Promise<unknown[] | null> {
  const cached = notificationsListCache.get(cacheKey);
  if (cached) {
    if (cached.expiresAtMs > Date.now()) {
      return cached.data;
    }
    notificationsListCache.delete(cacheKey);
  }

  const redisCached = await cacheGetJson<unknown[]>(buildNotificationsListRedisKey(cacheKey));
  if (!Array.isArray(redisCached)) {
    return null;
  }

  writeNotificationsListCacheLocal(cacheKey, redisCached);
  return redisCached;
}

function writeNotificationsListCache(cacheKey: string, data: unknown[]): void {
  writeNotificationsListCacheLocal(cacheKey, data);
  void cacheSetJson(buildNotificationsListRedisKey(cacheKey), data, NOTIFICATIONS_LIST_CACHE_TTL_MS);
}

function writeNotificationsUnreadCountCacheLocal(userId: string, count: number): void {
  if (notificationsUnreadCountCache.has(userId)) {
    notificationsUnreadCountCache.delete(userId);
  }
  trimNotificationCache(notificationsUnreadCountCache);
  notificationsUnreadCountCache.set(userId, {
    count,
    expiresAtMs: Date.now() + NOTIFICATIONS_UNREAD_CACHE_TTL_MS,
  });
}

async function readNotificationsUnreadCountCache(userId: string): Promise<number | null> {
  const cached = notificationsUnreadCountCache.get(userId);
  if (cached) {
    if (cached.expiresAtMs > Date.now()) {
      return cached.count;
    }
    notificationsUnreadCountCache.delete(userId);
  }

  const redisCached = await cacheGetJson<{ count?: unknown }>(buildNotificationsUnreadRedisKey(userId));
  const count = redisCached?.count;
  if (typeof count !== "number" || !Number.isFinite(count)) {
    return null;
  }

  writeNotificationsUnreadCountCacheLocal(userId, count);
  return count;
}

function writeNotificationsUnreadCountCache(userId: string, count: number): void {
  writeNotificationsUnreadCountCacheLocal(userId, count);
  void cacheSetJson(
    buildNotificationsUnreadRedisKey(userId),
    { count },
    NOTIFICATIONS_UNREAD_CACHE_TTL_MS
  );
}

function invalidateNotificationsCache(userId: string): void {
  notificationsUnreadCountCache.delete(userId);
  const prefix = `${userId}:`;
  for (const key of notificationsListCache.keys()) {
    if (key.startsWith(prefix)) {
      notificationsListCache.delete(key);
    }
  }
  void redisDelete(buildNotificationsUnreadRedisKey(userId));
  void redisDelete(buildNotificationsListRedisKey(`${userId}:active`));
  void redisDelete(buildNotificationsListRedisKey(`${userId}:all`));
}

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
    (normalizedMessage.includes("relation") && normalizedMessage.includes("does not exist"))
  );
}

function isPrismaMissingColumnError(error: unknown, columnName: string): boolean {
  if (!isPrismaSchemaDriftError(error)) return false;
  const message = getErrorMessage(error);
  return message.toLowerCase().includes(columnName.toLowerCase());
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
  const listCacheKey = `${user.id}:${includeDismissed ? "all" : "active"}`;
  const cachedNotifications = await readNotificationsListCache(listCacheKey);
  if (cachedNotifications) {
    return c.json({ data: cachedNotifications });
  }

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
  } catch (error) {
    if (!isPrismaSchemaDriftError(error)) {
      if (isPrismaClientError(error)) {
        console.warn("[notifications/list] database unavailable; returning cached or empty notifications", {
          message: getErrorMessage(error),
        });
        notifications = cachedNotifications ?? [];
        writeNotificationsListCache(listCacheKey, notifications);
        return c.json({ data: notifications });
      }
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
          if (isPrismaClientError(minimalError)) {
            console.warn("[notifications/list] minimal fallback unavailable; returning cached or empty notifications", {
              message: getErrorMessage(minimalError),
            });
            notifications = cachedNotifications ?? [];
            writeNotificationsListCache(listCacheKey, notifications);
            return c.json({ data: notifications });
          }
          throw minimalError;
        }
        console.warn("[notifications/list] schema drift fallback exhausted; returning empty notifications list", {
          message: getErrorMessage(minimalError),
        });
        notifications = [];
      }
    }
  }

  writeNotificationsListCache(listCacheKey, notifications);
  return c.json({ data: notifications });
});

// Get unread notification count (excludes dismissed)
notificationsRouter.get("/unread-count", requireAuth, async (c) => {
  const user = c.get("user");
  if (!user) {
    return c.json({ error: { message: "Unauthorized", code: "UNAUTHORIZED" } }, 401);
  }

  const cachedUnreadCount = await readNotificationsUnreadCountCache(user.id);
  if (cachedUnreadCount !== null) {
    return c.json({ data: { count: cachedUnreadCount } });
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
      if (isPrismaClientError(error)) {
        console.warn("[notifications/unread-count] database unavailable; returning cached or zero unread count", {
          message: getErrorMessage(error),
        });
        const count = cachedUnreadCount ?? 0;
        writeNotificationsUnreadCountCache(user.id, count);
        return c.json({ data: { count } });
      }
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
          if (isPrismaClientError(minimalError)) {
            console.warn("[notifications/unread-count] minimal fallback unavailable; returning cached or zero unread count", {
              message: getErrorMessage(minimalError),
            });
            const count = cachedUnreadCount ?? 0;
            writeNotificationsUnreadCountCache(user.id, count);
            return c.json({ data: { count } });
          }
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
  writeNotificationsUnreadCountCache(user.id, groupKeys.size);
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
  invalidateNotificationsCache(user.id);

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
  invalidateNotificationsCache(user.id);

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
  }

  // Return the notification data for frontend navigation (no redirect URL)
  invalidateNotificationsCache(user.id);
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
    invalidateNotificationsCache(user.id);
    return c.json({ data: updated });
  } catch (error) {
    if (!isPrismaMissingColumnError(error, "dismissed")) {
      throw error;
    }
    await prisma.notification.delete({
      where: { id: notificationId },
    });
    invalidateNotificationsCache(user.id);
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
  invalidateNotificationsCache(user.id);

  return c.json({ data: { deleted: true } });
});
