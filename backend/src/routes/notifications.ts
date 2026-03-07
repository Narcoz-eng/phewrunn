import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { Prisma } from "@prisma/client";
import { prisma, withPrismaRetry } from "../prisma.js";
import { type AuthVariables, requireAuth } from "../auth.js";
import { cacheGetJson, cacheSetJson, redisDelete } from "../lib/redis.js";
import { NotificationsQuerySchema } from "../types.js";

export const notificationsRouter = new Hono<{ Variables: AuthVariables }>();

const NOTIFICATIONS_LIST_CACHE_TTL_MS =
  process.env.NODE_ENV === "production" ? 15_000 : 4_000;
const NOTIFICATIONS_UNREAD_CACHE_TTL_MS =
  process.env.NODE_ENV === "production" ? 10_000 : 3_000;
const NOTIFICATIONS_LIST_STALE_FALLBACK_MS =
  process.env.NODE_ENV === "production" ? 30 * 60_000 : 5 * 60_000;
const NOTIFICATIONS_UNREAD_STALE_FALLBACK_MS =
  process.env.NODE_ENV === "production" ? 15 * 60_000 : 5 * 60_000;
const NOTIFICATIONS_CACHE_MAX_ENTRIES =
  process.env.NODE_ENV === "production" ? 20_000 : 2_000;
const NOTIFICATIONS_LIST_REDIS_KEY_PREFIX = "notifications:list:v1";
const NOTIFICATIONS_UNREAD_REDIS_KEY_PREFIX = "notifications:unread:v1";

const notificationsListCache = new Map<
  string,
  {
    data: unknown[];
    expiresAtMs: number;
    staleUntilMs: number;
  }
>();
const notificationsUnreadCountCache = new Map<
  string,
  {
    count: number;
    expiresAtMs: number;
    staleUntilMs: number;
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
    staleUntilMs: Date.now() + NOTIFICATIONS_LIST_STALE_FALLBACK_MS,
  });
}

function normalizeNotificationsListCacheEnvelope(
  value: unknown
): { data: unknown[]; cachedAtMs: number } | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const candidate = value as { data?: unknown; cachedAt?: unknown };
  if (!Array.isArray(candidate.data)) {
    return null;
  }

  return {
    data: candidate.data,
    cachedAtMs:
      typeof candidate.cachedAt === "number" && Number.isFinite(candidate.cachedAt)
        ? candidate.cachedAt
        : Date.now() - NOTIFICATIONS_LIST_CACHE_TTL_MS,
  };
}

async function readNotificationsListCache(
  cacheKey: string,
  opts?: { allowStale?: boolean }
): Promise<unknown[] | null> {
  const nowMs = Date.now();
  const cached = notificationsListCache.get(cacheKey);
  if (cached) {
    if (cached.expiresAtMs > nowMs) {
      return cached.data;
    }
    if (opts?.allowStale && cached.staleUntilMs > nowMs) {
      return cached.data;
    }
    if (cached.staleUntilMs <= nowMs) {
      notificationsListCache.delete(cacheKey);
    }
  }

  const redisRaw = await cacheGetJson<unknown>(buildNotificationsListRedisKey(cacheKey));
  const redisEnvelope = normalizeNotificationsListCacheEnvelope(redisRaw);
  const redisCached = redisEnvelope?.data ?? (Array.isArray(redisRaw) ? redisRaw : null);
  if (!redisCached) {
    return null;
  }
  if (!opts?.allowStale && redisEnvelope && nowMs - redisEnvelope.cachedAtMs > NOTIFICATIONS_LIST_CACHE_TTL_MS) {
    return null;
  }

  writeNotificationsListCacheLocal(cacheKey, redisCached);
  return redisCached;
}

function writeNotificationsListCache(cacheKey: string, data: unknown[]): void {
  writeNotificationsListCacheLocal(cacheKey, data);
  void cacheSetJson(
    buildNotificationsListRedisKey(cacheKey),
    {
      data,
      cachedAt: Date.now(),
    },
    NOTIFICATIONS_LIST_STALE_FALLBACK_MS
  );
}

function writeNotificationsUnreadCountCacheLocal(userId: string, count: number): void {
  if (notificationsUnreadCountCache.has(userId)) {
    notificationsUnreadCountCache.delete(userId);
  }
  trimNotificationCache(notificationsUnreadCountCache);
  notificationsUnreadCountCache.set(userId, {
    count,
    expiresAtMs: Date.now() + NOTIFICATIONS_UNREAD_CACHE_TTL_MS,
    staleUntilMs: Date.now() + NOTIFICATIONS_UNREAD_STALE_FALLBACK_MS,
  });
}

async function readNotificationsUnreadCountCache(
  userId: string,
  opts?: { allowStale?: boolean }
): Promise<number | null> {
  const nowMs = Date.now();
  const cached = notificationsUnreadCountCache.get(userId);
  if (cached) {
    if (cached.expiresAtMs > nowMs) {
      return cached.count;
    }
    if (opts?.allowStale && cached.staleUntilMs > nowMs) {
      return cached.count;
    }
    if (cached.staleUntilMs <= nowMs) {
      notificationsUnreadCountCache.delete(userId);
    }
  }

  const redisCached = await cacheGetJson<{ count?: unknown; cachedAt?: unknown } | number>(
    buildNotificationsUnreadRedisKey(userId)
  );
  const count =
    typeof redisCached === "number"
      ? redisCached
      : redisCached?.count;
  const cachedAtMs =
    typeof redisCached === "object" &&
    redisCached !== null &&
    typeof redisCached.cachedAt === "number" &&
    Number.isFinite(redisCached.cachedAt)
      ? redisCached.cachedAt
      : Date.now() - NOTIFICATIONS_UNREAD_CACHE_TTL_MS;
  if (typeof count !== "number" || !Number.isFinite(count)) {
    return null;
  }
  if (!opts?.allowStale && nowMs - cachedAtMs > NOTIFICATIONS_UNREAD_CACHE_TTL_MS) {
    return null;
  }

  writeNotificationsUnreadCountCacheLocal(userId, count);
  return count;
}

function writeNotificationsUnreadCountCache(userId: string, count: number): void {
  writeNotificationsUnreadCountCacheLocal(userId, count);
  void cacheSetJson(
    buildNotificationsUnreadRedisKey(userId),
    { count, cachedAt: Date.now() },
    NOTIFICATIONS_UNREAD_STALE_FALLBACK_MS
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

function getPrismaErrorDetails(error: unknown): {
  message: string;
  code: string | null;
  meta: unknown;
} {
  if (typeof error !== "object" || error === null) {
    return {
      message: getErrorMessage(error),
      code: null,
      meta: null,
    };
  }

  const candidate = error as {
    message?: unknown;
    code?: unknown;
    meta?: unknown;
  };

  return {
    message:
      typeof candidate.message === "string"
        ? candidate.message
        : getErrorMessage(error),
    code: typeof candidate.code === "string" ? candidate.code : null,
    meta: candidate.meta ?? null,
  };
}

function isPrismaPoolPressureError(error: unknown): boolean {
  const details = getPrismaErrorDetails(error);
  const normalizedMessage = details.message.toLowerCase();
  return (
    details.code === "P2024" ||
    normalizedMessage.includes("connection pool") ||
    normalizedMessage.includes("too many clients already") ||
    normalizedMessage.includes("too many connections") ||
    normalizedMessage.includes("remaining connection slots are reserved")
  );
}

function logNotificationsQueryFailure(
  queryPath: string,
  error: unknown,
  extra?: Record<string, unknown>
): void {
  const details = getPrismaErrorDetails(error);
  console.warn("[notifications] query failure", {
    endpoint: "/api/notifications/unread-count",
    queryPath,
    message: details.message,
    code: details.code,
    meta: details.meta,
    ...extra,
  });
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
    (normalizedMessage.includes("relation") && normalizedMessage.includes("does not exist")) ||
    (normalizedMessage.includes("invalid") && normalizedMessage.includes("invocation"))
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

function toSafeNumber(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  if (value instanceof Prisma.Decimal) {
    return value.toNumber();
  }
  return 0;
}

type RawNotificationRow = {
  id: string;
  userId: string;
  type: string;
  message: string;
  read: boolean | null;
  postId: string | null;
  fromUserId: string | null;
  createdAt: Date;
  fromUserName: string | null;
  fromUserUsername: string | null;
  fromUserImage: string | null;
  fromUserLevel: number | null;
  postContent: string | null;
  postContractAddress: string | null;
};

function mapRawNotificationRow(row: RawNotificationRow) {
  return {
    id: row.id,
    userId: row.userId,
    type: row.type,
    message: row.message,
    read: row.read === true,
    postId: row.postId ?? null,
    fromUserId: row.fromUserId ?? null,
    fromUser: row.fromUserId
      ? {
          id: row.fromUserId,
          name: row.fromUserName ?? "Unknown",
          username: row.fromUserUsername ?? null,
          image: row.fromUserImage ?? null,
          level: Math.max(0, Math.round(toSafeNumber(row.fromUserLevel))),
        }
      : null,
    post: row.postId
      ? {
          id: row.postId,
          content: row.postContent ?? "",
          contractAddress: row.postContractAddress ?? null,
        }
      : null,
    createdAt: row.createdAt.toISOString(),
  };
}

async function queryNotificationsRaw(userId: string, includeDismissed: boolean): Promise<unknown[]> {
  const dismissedCondition = includeDismissed ? Prisma.sql`` : Prisma.sql`AND n.dismissed = false`;
  const rows = await prisma.$queryRaw<RawNotificationRow[]>(Prisma.sql`
    SELECT
      n.id,
      n."userId",
      n.type,
      n.message,
      n.read,
      n."postId",
      n."fromUserId",
      n."createdAt",
      fu.name AS "fromUserName",
      fu.username AS "fromUserUsername",
      fu.image AS "fromUserImage",
      fu.level AS "fromUserLevel",
      p.content AS "postContent",
      p."contractAddress" AS "postContractAddress"
    FROM "Notification" n
    LEFT JOIN "User" fu ON fu.id = n."fromUserId"
    LEFT JOIN "Post" p ON p.id = n."postId"
    WHERE n."userId" = ${userId}
    ${dismissedCondition}
    ORDER BY n."createdAt" DESC
    LIMIT 50
  `);

  return rows.map(mapRawNotificationRow);
}

async function queryUnreadNotificationsRaw(userId: string): Promise<Array<{
  id: string;
  type: string;
  fromUserId: string | null;
  postId: string | null;
  message: string;
}>> {
  const rows = await prisma.$queryRaw<Array<{
    id: string;
    type: string;
    fromUserId: string | null;
    postId: string | null;
    message: string;
  }>>(Prisma.sql`
    SELECT
      n.id,
      n.type,
      n."fromUserId",
      n."postId",
      n.message
    FROM "Notification" n
    WHERE n."userId" = ${userId}
      AND n.read = false
      AND n.dismissed = false
    ORDER BY n."createdAt" DESC
    LIMIT 200
  `);

  return rows.map((row) => ({
    id: row.id,
    type: row.type,
    fromUserId: row.fromUserId ?? null,
    postId: row.postId ?? null,
    message: row.message,
  }));
}

async function countUnreadNotifications(userId: string): Promise<number> {
  try {
    return await prisma.notification.count({
      where: {
        userId,
        read: false,
        dismissed: false,
      },
    });
  } catch (error) {
    if (!isPrismaMissingColumnError(error, "dismissed")) {
      throw error;
    }
  }

  return prisma.notification.count({
    where: {
      userId,
      read: false,
    },
  });
}

async function queryNotificationByIdRaw(notificationId: string): Promise<ReturnType<typeof mapRawNotificationRow> | null> {
  const rows = await prisma.$queryRaw<RawNotificationRow[]>(Prisma.sql`
    SELECT
      n.id,
      n."userId",
      n.type,
      n.message,
      n.read,
      n."postId",
      n."fromUserId",
      n."createdAt",
      fu.name AS "fromUserName",
      fu.username AS "fromUserUsername",
      fu.image AS "fromUserImage",
      fu.level AS "fromUserLevel",
      p.content AS "postContent",
      p."contractAddress" AS "postContractAddress"
    FROM "Notification" n
    LEFT JOIN "User" fu ON fu.id = n."fromUserId"
    LEFT JOIN "Post" p ON p.id = n."postId"
    WHERE n.id = ${notificationId}
    LIMIT 1
  `);

  const row = rows[0];
  return row ? mapRawNotificationRow(row) : null;
}

async function markNotificationReadRaw(notificationId: string, userId: string): Promise<boolean> {
  const updatedRows = await prisma.$executeRaw(Prisma.sql`
    UPDATE "Notification"
    SET read = true
    WHERE id = ${notificationId}
      AND "userId" = ${userId}
  `);
  return updatedRows > 0;
}

async function markAllNotificationsReadRaw(userId: string): Promise<void> {
  try {
    await prisma.$executeRaw(Prisma.sql`
      UPDATE "Notification"
      SET read = true
      WHERE "userId" = ${userId}
        AND read = false
        AND dismissed = false
    `);
  } catch (error) {
    const message = getErrorMessage(error).toLowerCase();
    if (!message.includes("dismissed") || !message.includes("does not exist")) {
      throw error;
    }
    await prisma.$executeRaw(Prisma.sql`
      UPDATE "Notification"
      SET read = true
      WHERE "userId" = ${userId}
        AND read = false
    `);
  }
}

async function markNotificationClickedRaw(notificationId: string, userId: string): Promise<boolean> {
  try {
    const updatedRows = await prisma.$executeRaw(Prisma.sql`
      UPDATE "Notification"
      SET "clickedAt" = NOW(), read = true
      WHERE id = ${notificationId}
        AND "userId" = ${userId}
    `);
    return updatedRows > 0;
  } catch (error) {
    const message = getErrorMessage(error).toLowerCase();
    if (!message.includes("clickedat") || !message.includes("does not exist")) {
      throw error;
    }
    const updatedRows = await prisma.$executeRaw(Prisma.sql`
      UPDATE "Notification"
      SET read = true
      WHERE id = ${notificationId}
        AND "userId" = ${userId}
    `);
    return updatedRows > 0;
  }
}

async function dismissNotificationRaw(notificationId: string, userId: string): Promise<"dismissed" | "deleted" | "missing"> {
  try {
    const updatedRows = await prisma.$executeRaw(Prisma.sql`
      UPDATE "Notification"
      SET dismissed = true
      WHERE id = ${notificationId}
        AND "userId" = ${userId}
    `);
    return updatedRows > 0 ? "dismissed" : "missing";
  } catch (error) {
    const message = getErrorMessage(error).toLowerCase();
    if (!message.includes("dismissed") || !message.includes("does not exist")) {
      throw error;
    }
    const deletedRows = await prisma.$executeRaw(Prisma.sql`
      DELETE FROM "Notification"
      WHERE id = ${notificationId}
        AND "userId" = ${userId}
    `);
    return deletedRows > 0 ? "deleted" : "missing";
  }
}

async function deleteNotificationRaw(notificationId: string, userId: string): Promise<boolean> {
  const deletedRows = await prisma.$executeRaw(Prisma.sql`
    DELETE FROM "Notification"
    WHERE id = ${notificationId}
      AND "userId" = ${userId}
  `);
  return deletedRows > 0;
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
  const staleCachedNotifications = cachedNotifications ?? (await readNotificationsListCache(listCacheKey, { allowStale: true }));
  if (cachedNotifications) {
    return c.json({ data: cachedNotifications });
  }

  const whereClause: { userId: string; dismissed?: boolean } = { userId: user.id };

  if (!includeDismissed) {
    whereClause.dismissed = false;
  }

  let notifications: unknown[] = [];
  try {
    notifications = await withPrismaRetry(
      () => prisma.notification.findMany({
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
      }),
      { label: "notifications:list" }
    );
  } catch (error) {
    if (!isPrismaSchemaDriftError(error)) {
      if (isPrismaClientError(error)) {
        console.warn("[notifications/list] database unavailable; returning cached or empty notifications", {
          message: getErrorMessage(error),
        });
        let recoveredFromRaw = false;
        try {
          notifications = await queryNotificationsRaw(user.id, includeDismissed);
          recoveredFromRaw = true;
        } catch (rawError) {
          console.warn("[notifications/list] raw fallback unavailable; returning stale cached or empty notifications", {
            message: getErrorMessage(rawError),
          });
        }
        if (recoveredFromRaw) {
          writeNotificationsListCache(listCacheKey, notifications);
          return c.json({ data: notifications });
        }
        if (staleCachedNotifications) {
          return c.json({ data: staleCachedNotifications });
        }
        return c.json(
          {
            error: {
              message: "Notifications are temporarily unavailable. Please retry shortly.",
              code: "NOTIFICATIONS_UNAVAILABLE",
            },
          },
          503
        );
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
            let recoveredFromRaw = false;
            try {
              notifications = await queryNotificationsRaw(user.id, includeDismissed);
              recoveredFromRaw = true;
            } catch (rawError) {
              console.warn("[notifications/list] raw fallback after minimal failure unavailable", {
                message: getErrorMessage(rawError),
              });
            }
            if (recoveredFromRaw) {
              writeNotificationsListCache(listCacheKey, notifications);
              return c.json({ data: notifications });
            }
            if (staleCachedNotifications) {
              return c.json({ data: staleCachedNotifications });
            }
            return c.json(
              {
                error: {
                  message: "Notifications are temporarily unavailable. Please retry shortly.",
                  code: "NOTIFICATIONS_UNAVAILABLE",
                },
              },
              503
            );
          }
          throw minimalError;
        }
        console.warn("[notifications/list] schema drift fallback exhausted; returning empty notifications list", {
          message: getErrorMessage(minimalError),
        });
        let recoveredFromRaw = false;
        try {
          notifications = await queryNotificationsRaw(user.id, includeDismissed);
          recoveredFromRaw = true;
        } catch (rawError) {
          console.warn("[notifications/list] raw fallback after schema drift unavailable", {
            message: getErrorMessage(rawError),
          });
        }
        if (!recoveredFromRaw) {
          if (staleCachedNotifications) {
            return c.json({ data: staleCachedNotifications });
          }
          return c.json(
            {
              error: {
                message: "Notifications are temporarily unavailable. Please retry shortly.",
                code: "NOTIFICATIONS_UNAVAILABLE",
              },
            },
            503
          );
        }
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
  const staleUnreadCount =
    cachedUnreadCount ?? (await readNotificationsUnreadCountCache(user.id, { allowStale: true }));
  if (cachedUnreadCount !== null) {
    return c.json({ data: { count: cachedUnreadCount } });
  }

  let count = staleUnreadCount ?? 0;
  try {
    count = await withPrismaRetry(
      () => countUnreadNotifications(user.id),
      { label: "notifications:unread-count" }
    );
  } catch (error) {
    if (isPrismaClientError(error) || isPrismaSchemaDriftError(error)) {
      logNotificationsQueryFailure("notification.count", error, {
        userId: user.id,
        isPoolPressure: isPrismaPoolPressureError(error),
      });
      writeNotificationsUnreadCountCache(user.id, count);
      return c.json({ data: { count } });
    }
    throw error;
  }

  writeNotificationsUnreadCountCache(user.id, count);
  return c.json({ data: { count } });
});

// Mark notification as read
notificationsRouter.patch("/:id/read", requireAuth, async (c) => {
  const user = c.get("user");
  const notificationId = c.req.param("id");

  if (!user) {
    return c.json({ error: { message: "Unauthorized", code: "UNAUTHORIZED" } }, 401);
  }

  let updated: unknown;
  try {
    const notification = await prisma.notification.findUnique({
      where: { id: notificationId },
    });

    if (!notification) {
      return c.json({ error: { message: "Notification not found", code: "NOT_FOUND" } }, 404);
    }

    if (notification.userId !== user.id) {
      return c.json({ error: { message: "Unauthorized", code: "UNAUTHORIZED" } }, 403);
    }

    updated = await prisma.notification.update({
      where: { id: notificationId },
      data: { read: true },
    });
  } catch (error) {
    if (!isPrismaClientError(error) && !isPrismaSchemaDriftError(error)) {
      throw error;
    }
    console.warn("[notifications/read] prisma fallback triggered", {
      message: getErrorMessage(error),
    });
    const notification = await queryNotificationByIdRaw(notificationId);
    if (!notification) {
      return c.json({ error: { message: "Notification not found", code: "NOT_FOUND" } }, 404);
    }
    if (notification.userId !== user.id) {
      return c.json({ error: { message: "Unauthorized", code: "UNAUTHORIZED" } }, 403);
    }
    await markNotificationReadRaw(notificationId, user.id);
    updated = {
      ...notification,
      read: true,
    };
  }
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
    if (isPrismaClientError(error) || isPrismaSchemaDriftError(error)) {
      console.warn("[notifications/read-all] prisma fallback triggered", {
        message: getErrorMessage(error),
      });
      await markAllNotificationsReadRaw(user.id);
    } else {
      throw error;
    }
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

  let updated;
  try {
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
    if (isPrismaClientError(error) || isPrismaSchemaDriftError(error)) {
      console.warn("[notifications/click] prisma fallback triggered", {
        message: getErrorMessage(error),
      });
      const notification = await queryNotificationByIdRaw(notificationId);
      if (!notification) {
        return c.json({ error: { message: "Notification not found", code: "NOT_FOUND" } }, 404);
      }
      if (notification.userId !== user.id) {
        return c.json({ error: { message: "Unauthorized", code: "UNAUTHORIZED" } }, 403);
      }
      await markNotificationClickedRaw(notificationId, user.id);
      updated = {
        ...notification,
        read: true,
      };
    } else {
      throw error;
    }
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

  try {
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
    invalidateNotificationsCache(user.id);
    return c.json({ data: updated });
  } catch (error) {
    if (!isPrismaClientError(error) && !isPrismaSchemaDriftError(error)) {
      throw error;
    }
    console.warn("[notifications/dismiss] prisma fallback triggered", {
      message: getErrorMessage(error),
    });
    const notification = await queryNotificationByIdRaw(notificationId);
    if (!notification) {
      return c.json({ error: { message: "Notification not found", code: "NOT_FOUND" } }, 404);
    }
    if (notification.userId !== user.id) {
      return c.json({ error: { message: "Unauthorized", code: "UNAUTHORIZED" } }, 403);
    }
    const result = await dismissNotificationRaw(notificationId, user.id);
    invalidateNotificationsCache(user.id);
    return c.json({ data: result === "dismissed" ? { dismissed: true } : { deleted: true } });
  }
});

// Delete a notification (hard delete - kept for backwards compatibility)
notificationsRouter.delete("/:id", requireAuth, async (c) => {
  const user = c.get("user");
  const notificationId = c.req.param("id");

  if (!user) {
    return c.json({ error: { message: "Unauthorized", code: "UNAUTHORIZED" } }, 401);
  }

  try {
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
  } catch (error) {
    if (!isPrismaClientError(error) && !isPrismaSchemaDriftError(error)) {
      throw error;
    }
    console.warn("[notifications/delete] prisma fallback triggered", {
      message: getErrorMessage(error),
    });
    const notification = await queryNotificationByIdRaw(notificationId);
    if (!notification) {
      return c.json({ error: { message: "Notification not found", code: "NOT_FOUND" } }, 404);
    }
    if (notification.userId !== user.id) {
      return c.json({ error: { message: "Unauthorized", code: "UNAUTHORIZED" } }, 403);
    }
    await deleteNotificationRaw(notificationId, user.id);
  }
  invalidateNotificationsCache(user.id);

  return c.json({ data: { deleted: true } });
});
