import { publishRealtimeEvent } from "./realtime.js";
import {
  queryNotificationByIdRaw,
  queryNotificationsByDedupeKeysRaw,
} from "../routes/notifications.js";

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
