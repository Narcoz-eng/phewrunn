import { Prisma } from "@prisma/client";
import { prisma } from "../prisma.js";
import { publishRealtimeEvent } from "./realtime.js";

type RawNotificationRow = {
  id: string;
  userId: string;
  type: string;
  message: string;
  read: boolean | null;
  entityType: string | null;
  entityId: string | null;
  reasonCode: string | null;
  payload: Prisma.JsonValue | null;
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

function mapRawNotificationRow(row: RawNotificationRow) {
  return {
    id: row.id,
    userId: row.userId,
    type: row.type,
    message: row.message,
    read: row.read === true,
    entityType: row.entityType ?? null,
    entityId: row.entityId ?? null,
    reasonCode: row.reasonCode ?? null,
    payload: row.payload ?? null,
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

async function queryNotificationByIdRaw(notificationId: string) {
  const rows = await prisma.$queryRaw<RawNotificationRow[]>(Prisma.sql`
    SELECT
      n.id,
      n."userId",
      n.type,
      n.message,
      n.read,
      n."entityType",
      n."entityId",
      n."reasonCode",
      n.payload,
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

async function queryNotificationsByDedupeKeysRaw(dedupeKeys: string[]) {
  const normalizedKeys = dedupeKeys.filter((value) => value.trim().length > 0);
  if (normalizedKeys.length === 0) {
    return [];
  }

  const rows = await prisma.$queryRaw<RawNotificationRow[]>(Prisma.sql`
    SELECT
      n.id,
      n."userId",
      n.type,
      n.message,
      n.read,
      n."entityType",
      n."entityId",
      n."reasonCode",
      n.payload,
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
    WHERE n."dedupeKey" IN (${Prisma.join(normalizedKeys)})
    ORDER BY n."createdAt" DESC
  `);

  return rows.map(mapRawNotificationRow);
}

function buildNotificationEventPayload(notification: Awaited<ReturnType<typeof queryNotificationByIdRaw>>) {
  if (!notification) {
    return null;
  }

  return {
    ...notification,
    dismissed: false,
    clickedAt: null,
  };
}

export async function publishNotificationCreatedById(notificationId: string): Promise<void> {
  const notification = buildNotificationEventPayload(await queryNotificationByIdRaw(notificationId));
  if (!notification) {
    return;
  }

  await publishRealtimeEvent({
    topics: [`user:${notification.userId}`],
    event: {
      type: "notification.created",
      notification,
    },
  });
}

export async function publishNotificationsCreatedByDedupeKeys(
  dedupeKeys: string[]
): Promise<void> {
  const notifications = await queryNotificationsByDedupeKeysRaw(dedupeKeys);
  if (notifications.length === 0) {
    return;
  }

  await Promise.allSettled(
    notifications.map((notification) =>
      publishRealtimeEvent({
        topics: [`user:${notification.userId}`],
        event: {
          type: "notification.created",
          notification: {
            ...notification,
            dismissed: false,
            clickedAt: null,
          },
        },
      })
    )
  );
}

export async function publishUnreadCountSnapshot(userId: string, count: number): Promise<void> {
  await publishRealtimeEvent({
    topics: [`user:${userId}`],
    event: {
      type: "notification.unread_count",
      userId,
      count,
    },
  });
}
