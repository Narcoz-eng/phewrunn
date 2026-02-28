import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { api } from "@/lib/api";
import { useSession } from "@/lib/auth-client";
import { Notification } from "@/types";
import { Button } from "@/components/ui/button";
import { Bell, CheckCheck, ArrowLeft, BellOff } from "lucide-react";
import { toast } from "sonner";
import { NotificationItem, NotificationItemSkeleton } from "@/components/notifications/NotificationItem";
import { readSessionCache, writeSessionCache } from "@/lib/session-cache";
import { WindowVirtualList } from "@/components/virtual/WindowVirtualList";
import { cn } from "@/lib/utils";

const NOTIFICATIONS_CACHE_KEY = "phew.notifications.list";
const NOTIFICATIONS_CACHE_TTL_MS = 45_000;
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
    <div className="flex flex-col items-center justify-center py-16 gap-4 text-center">
      <div className="w-20 h-20 rounded-full bg-muted flex items-center justify-center">
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
  const isAuthenticated = !!session?.user;
  const [activeFilter, setActiveFilter] = useState<"all" | "unread">("all");
  const cachedNotifications = useMemo(
    () => readSessionCache<Notification[]>(NOTIFICATIONS_CACHE_KEY, NOTIFICATIONS_CACHE_TTL_MS),
    []
  );

  // Fetch notifications
  const {
    data: notifications = [],
    isLoading,
    error,
    refetch,
    isFetched,
  } = useQuery({
    queryKey: ["notifications"],
    queryFn: async () => {
      const data = await api.get<Notification[]>("/api/notifications");
      return data;
    },
    initialData: cachedNotifications ?? undefined,
    enabled: isAuthenticated,
    staleTime: 30000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    refetchInterval: () => {
      if (typeof document !== "undefined" && document.visibilityState !== "visible") {
        return false;
      }
      return isAuthenticated ? 60000 : false;
    },
  });

  useEffect(() => {
    if (!isFetched) return;
    writeSessionCache(NOTIFICATIONS_CACHE_KEY, notifications);
  }, [isFetched, notifications]);

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
      queryClient.setQueryData<Notification[]>(["notifications"], (old) =>
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
      await queryClient.cancelQueries({ queryKey: ["notifications"] });
      const previousNotifications = queryClient.getQueryData<Notification[]>(["notifications"]);
      return { previousNotifications, attemptedIds: notificationIds };
    },
    onSuccess: ({ dismissedIds, failedIds }) => {
      const dismissedSet = new Set(dismissedIds);
      queryClient.setQueryData<Notification[]>(["notifications"], (old) =>
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
        queryClient.setQueryData(["notifications"], context.previousNotifications);
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
      queryClient.setQueryData<Notification[]>(["notifications"], (old) =>
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
    markClickedMutation.mutate(getNotificationIds(notification));
  };

  const handleDismiss = (notification: Notification) => {
    dismissMutation.mutate(getNotificationIds(notification));
  };

  const handleMarkAllRead = () => {
    markAllReadMutation.mutate();
  };

  const handleProfileClick = (userId: string, username?: string | null) => {
    navigate(`/profile/${username || userId}`);
  };

  const mergedNotifications = useMemo(() => mergeNotifications(notifications), [notifications]);
  const unreadCount = mergedNotifications.filter((n) => !n.read).length;
  const filteredNotifications = activeFilter === "unread"
    ? mergedNotifications.filter((notification) => !notification.read)
    : mergedNotifications;

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 border-b border-border">
        <div className="max-w-2xl mx-auto px-4 h-14 flex items-center justify-between">
          <div className="flex items-center gap-3">
              <Button
                variant="ghost"
                size="icon"
                className="h-9 w-9"
                onClick={() => navigate(-1)}
            >
              <ArrowLeft className="h-5 w-5" />
            </Button>
              <div className="flex items-center gap-2">
                <Bell className="h-5 w-5 text-primary" />
                <h1 className="font-semibold text-lg">Notifications</h1>
                {unreadCount > 0 && (
                  <span className="px-2 py-0.5 text-xs font-medium bg-primary text-primary-foreground rounded-full">
                    {unreadCount > 99 ? "99+" : unreadCount}
                  </span>
                )}
              </div>
            </div>

          {unreadCount > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="h-8 gap-1.5 text-muted-foreground hover:text-foreground"
              onClick={handleMarkAllRead}
              disabled={markAllReadMutation.isPending}
            >
              <CheckCheck className="h-4 w-4" />
              <span className="text-xs">Mark all read</span>
            </Button>
          )}
        </div>
      </header>

      <main className="max-w-2xl mx-auto">
        <div className="bg-card border-x border-border min-h-[calc(100vh-3.5rem)]">
          <div className="sticky top-14 z-40 border-b border-border bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/80">
            <div className="flex items-center px-2">
              <button
                type="button"
                onClick={() => setActiveFilter("all")}
                className={cn(
                  "relative h-11 px-4 text-sm font-medium transition-colors",
                  activeFilter === "all" ? "text-foreground" : "text-muted-foreground hover:text-foreground"
                )}
              >
                All
                {activeFilter === "all" ? <span className="absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-primary" /> : null}
              </button>
              <button
                type="button"
                onClick={() => setActiveFilter("unread")}
                className={cn(
                  "relative h-11 px-4 text-sm font-medium transition-colors",
                  activeFilter === "unread" ? "text-foreground" : "text-muted-foreground hover:text-foreground"
                )}
              >
                Unread
                {activeFilter === "unread" ? <span className="absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-primary" /> : null}
              </button>
            </div>
          </div>

          {!isAuthenticated ? (
            <div className="flex flex-col items-center justify-center py-16 gap-4 text-center">
              <div className="w-20 h-20 rounded-full bg-muted flex items-center justify-center">
                <Bell className="h-10 w-10 text-muted-foreground" />
              </div>
              <div>
                <p className="font-semibold text-foreground text-lg">Sign in to view notifications</p>
                <p className="text-sm text-muted-foreground mt-1">
                  Activity alerts appear here after you sign in.
                </p>
              </div>
            </div>
          ) : isLoading ? (
            // Loading skeletons
            <div>
              {[0, 1, 2, 3, 4].map((i) => (
                <NotificationItemSkeleton key={i} />
              ))}
            </div>
          ) : error ? (
            // Error state
            <div className="flex flex-col items-center justify-center py-16 gap-4 text-center">
              <div className="w-20 h-20 rounded-full bg-destructive/10 flex items-center justify-center">
                <Bell className="h-10 w-10 text-destructive" />
              </div>
              <div>
                <p className="font-semibold text-foreground text-lg">
                  Failed to load notifications
                </p>
                <p className="text-sm text-muted-foreground mt-1">
                  Please try again later.
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
