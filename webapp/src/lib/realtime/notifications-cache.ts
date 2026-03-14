import type { QueryClient } from "@tanstack/react-query";
import { type Notification } from "@/types";
import { readSessionCache, writeSessionCache } from "@/lib/session-cache";

export const NOTIFICATIONS_CACHE_KEY = "phew.notifications.list";
export const NOTIFICATIONS_CACHE_TTL_MS = 60_000;
export const NOTIFICATIONS_UNREAD_CACHE_PREFIX = "phew.notifications.unread";
export const NOTIFICATIONS_UNREAD_CACHE_TTL_MS = 60_000;
const DEFAULT_NOTIFICATIONS_LIMIT = 200;

export function buildNotificationsQueryKey(userId: string | null | undefined) {
  return ["notifications", userId ?? "anonymous"] as const;
}

export function buildUnreadQueryKey(userId: string | null | undefined) {
  return ["notifications", "unread-count", userId ?? "anonymous"] as const;
}

export function buildNotificationsCacheKey(userId: string | null | undefined): string {
  return userId ? `${NOTIFICATIONS_CACHE_KEY}:${userId}` : NOTIFICATIONS_CACHE_KEY;
}

export function buildUnreadCacheKey(userId: string | null | undefined): string {
  return userId ? `${NOTIFICATIONS_UNREAD_CACHE_PREFIX}:${userId}` : NOTIFICATIONS_UNREAD_CACHE_PREFIX;
}

function dedupeNotifications(notifications: Notification[]): Notification[] {
  const seen = new Set<string>();
  const next: Notification[] = [];

  for (const notification of notifications) {
    if (seen.has(notification.id)) {
      continue;
    }
    seen.add(notification.id);
    next.push(notification);
  }

  return next;
}

export function setUnreadCountCache(
  queryClient: QueryClient,
  userId: string,
  count: number
): void {
  const nextCount = Math.max(0, Math.floor(Number.isFinite(count) ? count : 0));
  queryClient.setQueryData(buildUnreadQueryKey(userId), { count: nextCount });
  writeSessionCache(buildUnreadCacheKey(userId), nextCount);
}

export function incrementUnreadCountCache(
  queryClient: QueryClient,
  userId: string,
  delta: number
): void {
  const unreadQueryKey = buildUnreadQueryKey(userId);
  const cachedUnread =
    queryClient.getQueryData<{ count: number }>(unreadQueryKey)?.count ??
    readSessionCache<number>(buildUnreadCacheKey(userId), NOTIFICATIONS_UNREAD_CACHE_TTL_MS) ??
    0;
  setUnreadCountCache(queryClient, userId, cachedUnread + delta);
}

export function prependNotificationCache(
  queryClient: QueryClient,
  userId: string,
  notification: Notification
): void {
  const queryKey = buildNotificationsQueryKey(userId);
  const nextNotifications =
    queryClient.setQueryData<Notification[]>(queryKey, (old) => {
      const merged = dedupeNotifications([notification, ...(old ?? [])]);
      return merged
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
        .slice(0, DEFAULT_NOTIFICATIONS_LIMIT);
    }) ??
    [notification];

  writeSessionCache(buildNotificationsCacheKey(userId), nextNotifications);
}
