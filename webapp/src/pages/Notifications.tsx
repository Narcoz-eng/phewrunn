import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { api } from "@/lib/api";
import { useAuth, useSession } from "@/lib/auth-client";
import { Notification } from "@/types";
import { Button } from "@/components/ui/button";
import { CheckCheck, ArrowLeft, BellOff } from "lucide-react";
import { toast } from "sonner";
import { NotificationItem, NotificationItemSkeleton } from "@/components/notifications/NotificationItem";
import { readSessionCache, writeSessionCache } from "@/lib/session-cache";
import { WindowVirtualList } from "@/components/virtual/WindowVirtualList";
import { cn } from "@/lib/utils";
import { buildProfilePath } from "@/lib/profile-path";
import { PhewBellIcon } from "@/components/icons/PhewIcons";

const NOTIFICATIONS_CACHE_KEY = "phew.notifications.list";
const NOTIFICATIONS_CACHE_TTL_MS = 30 * 60_000;
const NOTIFICATION_MERGE_WINDOW_MS = 24 * 60 * 60 * 1000;

function normalizeNotificationMessage(message: string): string {
  return message.trim().toLowerCase().replace(/\s+/g, " ");
}

function buildNotificationGroupKey(notification: Notification): string {
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
      return `${notification.type}:${actorKey}:${postKey}:${messageKey}`;
  }
}

function buildMergedNotificationMessage(base: Notification, count: number): string {
  if (count <= 1) return base.message;
  const actor = base.fromUser?.username || base.fromUser?.name || "Someone";

  switch (base.type) {
    case "like":
      return `${actor} liked ${count} of your posts`;
    case "comment":
      return `${actor} commented on ${count} of your posts`;
    case "repost":
      return `${actor} reposted ${count} of your posts`;
    case "new_post":
      return `${actor} posted ${count} new Alphas`;
    case "follow":
      return `${actor} and ${count - 1} others followed you`;
    default:
      return `${base.message} (+${count - 1} more)`;
  }
}

function mergeNotifications(notifications: Notification[]): Notification[] {
  const groups = new Map<string, Notification[]>();
  const sorted = [...notifications].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );

  for (const notification of sorted) {
    const key = buildNotificationGroupKey(notification);
    const existing = groups.get(key);
    if (!existing) {
      groups.set(key, [notification]);
      continue;
    }

    const newestAt = new Date(existing[0].createdAt).getTime();
    const currentAt = new Date(notification.createdAt).getTime();
    const withinWindow =
      Number.isFinite(newestAt) &&
      Number.isFinite(currentAt) &&
      Math.abs(newestAt - currentAt) <= NOTIFICATION_MERGE_WINDOW_MS;

    if (!withinWindow) {
      groups.set(`${key}:${notification.id}`, [notification]);
      continue;
    }

    existing.push(notification);
  }

  const merged: Notification[] = [];

  for (const group of groups.values()) {
    const byNewest = [...group].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
    const base = byNewest[0];
    if (!base) continue;

    if (byNewest.length === 1) {
      merged.push(base);
      continue;
    }

    const mergedIds = byNewest.map((item) => item.id);
    const hasUnread = byNewest.some((item) => !item.read);

    merged.push({
      ...base,
      read: !hasUnread,
      message: buildMergedNotificationMessage(base, byNewest.length),
      mergedCount: byNewest.length,
      mergedIds,
      mergedItems: byNewest,
    });
  }

  return merged.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

function EmptyState({ mode }: { mode: "all" | "unread" }) {
  const isUnreadMode = mode === "unread";
  return (
    <div className="app-empty-state m-4">
      <div className="flex h-20 w-20 items-center justify-center rounded-full bg-muted">
        <BellOff className="h-10 w-10 text-muted-foreground" />
      </div>
      <div>
        <p className="font-semibold text-foreground text-lg">
          {isUnreadMode ? "You're all caught up" : "No notifications yet"}
        </p>
        <p className="text-sm text-muted-foreground mt-1 max-w-xs">
          {isUnreadMode
            ? "Unread alerts will appear here as soon as there is new activity."
            : "When someone interacts with your posts or follows you, you'll see it here."}
        </p>
      </div>
    </div>
  );
}

export default function Notifications() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: session } = useSession();
  const { isAuthenticated, hasLiveSession, canPerformAuthenticatedWrites, isUsingCachedUser } = useAuth();
  const [activeFilter, setActiveFilter] = useState<"all" | "unread">("all");
  const notificationsQueryKey = useMemo(
    () => ["notifications", session?.user?.id ?? "anonymous"] as const,
    [session?.user?.id]
  );
  const notificationsCacheKey = useMemo(
    () => (session?.user?.id ? `${NOTIFICATIONS_CACHE_KEY}:${session.user.id}` : NOTIFICATIONS_CACHE_KEY),
    [session?.user?.id]
  );
  const initialCachedNotifications = useMemo(
    () => readSessionCache<Notification[]>(notificationsCacheKey, NOTIFICATIONS_CACHE_TTL_MS),
    [notificationsCacheKey]
  );

  // Fetch notifications
  const {
    data: notifications = [],
    isLoading,
    error,
    refetch,
    isFetched,
  } = useQuery({
    queryKey: notificationsQueryKey,
    queryFn: async () => {
      const sessionCachedNotifications = readSessionCache<Notification[]>(
        notificationsCacheKey,
        NOTIFICATIONS_CACHE_TTL_MS
      );
      const currentQueryNotifications = queryClient.getQueryData<Notification[]>(notificationsQueryKey);
      const fallbackNotifications =
        sessionCachedNotifications && sessionCachedNotifications.length > 0
          ? sessionCachedNotifications
          : currentQueryNotifications && currentQueryNotifications.length > 0
            ? currentQueryNotifications
            : initialCachedNotifications && initialCachedNotifications.length > 0
              ? initialCachedNotifications
              : null;
      const response = await api.raw("/api/notifications");
      if (response.status === 401 || response.status === 403) {
        return fallbackNotifications ?? [];
      }
      if (response.status === 429) {
        const retryAfterHeader = response.headers.get("retry-after");
        const retryAfterSeconds = Number.parseInt(retryAfterHeader || "", 10);
        const waitMessage =
          Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0
            ? `Please wait ${retryAfterSeconds}s and try again.`
            : "Please wait a few seconds and try again.";
        const rateError = new Error(waitMessage) as Error & { status?: number };
        rateError.status = 429;
        throw rateError;
      }
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        const message =
          payload?.error?.message ||
          payload?.message ||
          `Request failed with status ${response.status}`;
        if (fallbackNotifications && fallbackNotifications.length > 0) {
          return fallbackNotifications;
        }
        const requestError = new Error(message) as Error & { status?: number };
        requestError.status = response.status;
        throw requestError;
      }
      const payload = (await response.json().catch(() => null)) as { data?: Notification[] } | null;
      const data = Array.isArray(payload?.data) ? payload.data : [];
      if (data.length === 0 && fallbackNotifications && fallbackNotifications.length > 0) {
        return fallbackNotifications;
      }
      return data;
    },
    initialData:
      initialCachedNotifications && initialCachedNotifications.length > 0
        ? initialCachedNotifications
        : undefined,
    enabled: isAuthenticated && hasLiveSession,
    staleTime: 60_000,
    refetchOnMount: "always",
    refetchOnWindowFocus: false,
    refetchOnReconnect: true,
    retry: (failureCount, error) => {
      const status =
        typeof error === "object" && error !== null && "status" in error
          ? Number((error as { status?: unknown }).status)
          : null;
      if (status === 401 || status === 403) {
        return false;
      }
      if (status === 429) {
        return failureCount < 1;
      }
      return failureCount < 2;
    },
    retryDelay: (attempt) => Math.min(1200 * 2 ** attempt, 5000),
    refetchInterval: () => {
      if (typeof document !== "undefined" && document.visibilityState !== "visible") {
        return false;
      }
      return hasLiveSession ? 120_000 : false;
    },
  });
  const notificationsErrorMessage = useMemo(() => {
    if (!error || typeof error !== "object") return "Please try again later.";
    const status = "status" in error ? Number((error as { status?: unknown }).status) : null;
    if (status === 429) {
      return error instanceof Error && error.message ? error.message : "Too many requests. Please wait and try again.";
    }
    if (error instanceof Error && error.message) {
      return error.message;
    }
    return "Please try again later.";
  }, [error]);

  useEffect(() => {
    if (!isFetched) return;
    writeSessionCache(notificationsCacheKey, notifications);
  }, [isFetched, notifications, notificationsCacheKey]);

  // Mark notification as clicked (read)
  const markClickedMutation = useMutation({
    mutationFn: async (notificationIds: string[]) => {
      await Promise.all(
        notificationIds.map((notificationId) =>
          api.patch(`/api/notifications/${notificationId}/click`)
        )
      );
      return notificationIds;
    },
    onSuccess: (notificationIds) => {
      const idSet = new Set(notificationIds);
      queryClient.setQueryData<Notification[]>(notificationsQueryKey, (old) =>
        old?.map((n) =>
          idSet.has(n.id) ? { ...n, read: true } : n
        )
      );
    },
    onError: () => {
      // Silently fail for click tracking
    },
  });

  // Dismiss notification
  const dismissMutation = useMutation({
    mutationFn: async (notificationIds: string[]) => {
      const settled = await Promise.allSettled(
        notificationIds.map((notificationId) =>
          api.patch(`/api/notifications/${notificationId}/dismiss`)
        )
      );
      const dismissedIds: string[] = [];
      const failedIds: string[] = [];
      settled.forEach((result, index) => {
        const id = notificationIds[index];
        if (!id) return;
        if (result.status === "fulfilled") {
          dismissedIds.push(id);
        } else {
          failedIds.push(id);
        }
      });
      if (dismissedIds.length === 0) {
        throw new Error("Failed to dismiss notification");
      }
      return {
        dismissedIds,
        failedIds,
      };
    },
    onMutate: async (notificationIds) => {
      await queryClient.cancelQueries({ queryKey: notificationsQueryKey });
      const previousNotifications = queryClient.getQueryData<Notification[]>(notificationsQueryKey);
      return { previousNotifications, attemptedIds: notificationIds };
    },
    onSuccess: ({ dismissedIds, failedIds }) => {
      const dismissedSet = new Set(dismissedIds);
      queryClient.setQueryData<Notification[]>(notificationsQueryKey, (old) =>
        old?.filter((n) => !dismissedSet.has(n.id))
      );
      if (failedIds.length > 0) {
        toast.warning("Some notifications could not be dismissed");
        return;
      }
      toast.success("Notification dismissed");
    },
    onError: (_err, _id, context) => {
      if (context?.previousNotifications) {
        queryClient.setQueryData(notificationsQueryKey, context.previousNotifications);
      }
      toast.error("Failed to dismiss notification");
    },
  });

  // Mark all notifications as read
  const markAllReadMutation = useMutation({
    mutationFn: async () => {
      await api.patch("/api/notifications/read-all");
    },
    onSuccess: () => {
      queryClient.setQueryData<Notification[]>(notificationsQueryKey, (old) =>
        old?.map((n) => ({ ...n, read: true }))
      );
      toast.success("All notifications marked as read");
    },
    onError: () => {
      toast.error("Failed to mark all as read");
    },
  });

  const getNotificationIds = (notification: Notification): string[] => {
    if (Array.isArray(notification.mergedIds) && notification.mergedIds.length > 0) {
      return notification.mergedIds;
    }
    return [notification.id];
  };

  const handleMarkClicked = (notification: Notification) => {
    if (!canPerformAuthenticatedWrites) {
      toast.info("Signing you in...");
      return;
    }
    markClickedMutation.mutate(getNotificationIds(notification));
  };

  const handleDismiss = (notification: Notification) => {
    if (!canPerformAuthenticatedWrites) {
      toast.info("Signing you in...");
      return;
    }
    dismissMutation.mutate(getNotificationIds(notification));
  };

  const handleMarkAllRead = () => {
    if (!canPerformAuthenticatedWrites) {
      toast.info("Signing you in...");
      return;
    }
    markAllReadMutation.mutate();
  };

  const handleProfileClick = (userId: string, username?: string | null) => {
    navigate(buildProfilePath(userId, username));
  };

  const mergedNotifications = useMemo(() => mergeNotifications(notifications), [notifications]);
  const unreadCount = mergedNotifications.filter((n) => !n.read).length;
  const filteredNotifications = activeFilter === "unread"
    ? mergedNotifications.filter((notification) => !notification.read)
    : mergedNotifications;
  const shouldShowSessionRecovery = isAuthenticated && isUsingCachedUser && filteredNotifications.length === 0;
  const shouldShowRecoveryBanner = isAuthenticated && isUsingCachedUser && filteredNotifications.length > 0;

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="app-topbar">
        <div className="mx-auto flex h-[4.4rem] max-w-[780px] items-center justify-between px-4 sm:px-5">
          <div className="flex items-center gap-3">
              <Button
                variant="ghost"
                size="icon"
                className="h-10 w-10 rounded-2xl border border-border/60 bg-white/60 shadow-[0_18px_34px_-28px_hsl(var(--foreground)/0.18)] dark:border-white/[0.08] dark:bg-white/[0.04] dark:shadow-none"
                onClick={() => navigate(-1)}
            >
              <ArrowLeft className="h-5 w-5" />
            </Button>
              <div className="flex items-center gap-2">
                <PhewBellIcon className="h-5 w-5 text-primary" />
                <h1 className="font-semibold text-lg">Notifications</h1>
                {unreadCount > 0 && (
                  <span className="rounded-full border border-white/70 bg-primary px-2 py-0.5 text-xs font-medium text-primary-foreground shadow-[0_12px_24px_-18px_hsl(var(--primary)/0.65)] dark:border-black/30">
                    {unreadCount > 99 ? "99+" : unreadCount}
                  </span>
                )}
              </div>
            </div>

          {unreadCount > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="h-9 gap-1.5 rounded-full border border-border/60 bg-white/60 px-3 text-muted-foreground shadow-[0_18px_30px_-28px_hsl(var(--foreground)/0.16)] hover:text-foreground dark:border-white/[0.08] dark:bg-white/[0.04] dark:shadow-none"
              onClick={handleMarkAllRead}
              disabled={markAllReadMutation.isPending || !canPerformAuthenticatedWrites}
            >
              <CheckCheck className="h-4 w-4" />
              <span className="text-xs">Mark all read</span>
            </Button>
          )}
        </div>
      </header>

      <main className="app-page-shell pt-5">
        <div className="app-surface min-h-[calc(100vh-4rem)] overflow-hidden">
          <div className="sticky top-[4.4rem] z-40 border-b border-border/60 bg-white/70 px-2 backdrop-blur-xl dark:bg-black/20">
            <div className="app-tab-rail my-3 flex items-center">
              <button
                type="button"
                onClick={() => setActiveFilter("all")}
                className={cn(
                  "relative z-10 h-11 rounded-[18px] px-4 text-sm font-semibold transition-colors",
                  activeFilter === "all" ? "text-foreground" : "text-muted-foreground hover:text-foreground"
                )}
              >
                All
              </button>
              <button
                type="button"
                onClick={() => setActiveFilter("unread")}
                className={cn(
                  "relative z-10 h-11 rounded-[18px] px-4 text-sm font-semibold transition-colors",
                  activeFilter === "unread" ? "text-foreground" : "text-muted-foreground hover:text-foreground"
                )}
              >
                Unread
              </button>
              <span
                className={cn(
                  "absolute bottom-1.5 top-1.5 rounded-[18px] border border-primary/15 bg-[linear-gradient(180deg,hsl(0_0%_100%/0.95),hsl(37_34%_95%/0.9))] shadow-[0_16px_28px_-26px_hsl(var(--foreground)/0.16)] transition-all duration-300 dark:border-white/[0.08] dark:bg-[linear-gradient(180deg,rgba(18,20,26,0.96),rgba(11,13,18,0.98))] dark:shadow-none",
                  activeFilter === "all" ? "left-1.5 w-[72px]" : "left-[86px] w-[88px]"
                )}
              />
            </div>
          </div>

          {!isAuthenticated ? (
            <div className="app-empty-state m-4">
              <div className="flex h-20 w-20 items-center justify-center rounded-full bg-muted">
                <PhewBellIcon className="h-10 w-10 text-muted-foreground" />
              </div>
              <div>
                <p className="font-semibold text-foreground text-lg">Sign in to view notifications</p>
                <p className="text-sm text-muted-foreground mt-1">
                  Activity alerts appear here after you sign in.
                </p>
              </div>
            </div>
          ) : shouldShowSessionRecovery ? (
            <div className="py-6">
              {[0, 1, 2].map((i) => (
                <NotificationItemSkeleton key={i} />
              ))}
              <p className="px-4 py-3 text-sm text-muted-foreground">
                Finalizing your session and loading notifications...
              </p>
            </div>
          ) : shouldShowRecoveryBanner ? (
            <div>
              <div className="mx-4 mt-4 rounded-2xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
                Notifications are showing cached activity while sign-in finishes. Actions will unlock automatically.
              </div>
              <WindowVirtualList
                items={filteredNotifications}
                getItemKey={(notification) => notification.id}
                estimateItemHeight={104}
                overscanPx={900}
                renderItem={(notification, index) => (
                  <div className={index < filteredNotifications.length - 1 ? "pb-0.5" : undefined}>
                    <NotificationItem
                      notification={notification}
                      onMarkClicked={handleMarkClicked}
                      onDismiss={handleDismiss}
                      onProfileClick={handleProfileClick}
                    />
                  </div>
                )}
              />
            </div>
          ) : isLoading || (!isFetched && filteredNotifications.length === 0) ? (
            // Loading skeletons
            <div>
              {[0, 1, 2, 3, 4].map((i) => (
                <NotificationItemSkeleton key={i} />
              ))}
            </div>
          ) : error ? (
            // Error state
            <div className="app-empty-state m-4">
              <div className="flex h-20 w-20 items-center justify-center rounded-full bg-destructive/10">
                <PhewBellIcon className="h-10 w-10 text-destructive" />
              </div>
              <div>
                <p className="font-semibold text-foreground text-lg">
                  Failed to load notifications
                </p>
                <p className="text-sm text-muted-foreground mt-1">
                  {notificationsErrorMessage}
                </p>
              </div>
              <Button variant="outline" onClick={() => refetch()}>
                Try Again
              </Button>
            </div>
          ) : filteredNotifications.length === 0 ? (
            <EmptyState mode={activeFilter} />
          ) : (
            <WindowVirtualList
              items={filteredNotifications}
              getItemKey={(notification) => notification.id}
              estimateItemHeight={104}
              overscanPx={900}
              renderItem={(notification, index) => (
                <div className={index < filteredNotifications.length - 1 ? "pb-0.5" : undefined}>
                  <NotificationItem
                    notification={notification}
                    onMarkClicked={handleMarkClicked}
                    onDismiss={handleDismiss}
                    onProfileClick={handleProfileClick}
                  />
                </div>
              )}
            />
          )}
        </div>
      </main>
    </div>
  );
}
