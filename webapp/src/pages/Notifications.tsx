import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  isPushSupported,
  getPushPermission,
  subscribeToPush,
  unsubscribeFromPush,
  isPushSubscribed,
} from "@/services/pushNotifications";
import { useNavigate } from "react-router-dom";
import { api } from "@/lib/api";
import { useAuth, useSession } from "@/lib/auth-client";
import { Notification } from "@/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CheckCheck, ArrowLeft, BellOff, Settings2 } from "lucide-react";
import { toast } from "sonner";
import { NotificationItem, NotificationItemSkeleton } from "@/components/notifications/NotificationItem";
import { readSessionCache, readSessionCacheEntry, writeSessionCache } from "@/lib/session-cache";
import { WindowVirtualList } from "@/components/virtual/WindowVirtualList";
import { cn } from "@/lib/utils";
import { buildProfilePath } from "@/lib/profile-path";
import { PhewBellIcon } from "@/components/icons/PhewIcons";
import { V2StatusPill } from "@/components/ui/v2/V2StatusPill";
import { V2Surface } from "@/components/ui/v2/V2Surface";
import { V2TabBar } from "@/components/ui/v2/V2TabBar";

const NOTIFICATIONS_CACHE_KEY = "phew.notifications.list";
const NOTIFICATIONS_CACHE_TTL_MS = 60_000;
const NOTIFICATION_MERGE_WINDOW_MS = 24 * 60 * 60 * 1000;
const NOTIFICATIONS_UNREAD_CACHE_PREFIX = "phew.notifications.unread";
const NOTIFICATIONS_UNREAD_CACHE_TTL_MS = 60_000;

type AlertPreference = {
  minConfidenceScore: number | null;
  minLiquidity: number | null;
  maxBundleRiskScore: number | null;
  notifyFollowedTraders: boolean;
  notifyFollowedTokens: boolean;
  notifyEarlyRunners: boolean;
  notifyHotAlpha: boolean;
  notifyHighConviction: boolean;
  notifyBundleChanges: boolean;
  notifyConfidenceCross: boolean;
  notifyLiquiditySurge: boolean;
  notifyHolderGrowth: boolean;
  notifyMomentum: boolean;
  notifyWhaleAccumulating: boolean;
  notifySmartMoney: boolean;
};

function normalizeNotificationMessage(message: string): string {
  return message.trim().toLowerCase().replace(/\s+/g, " ");
}

function readNotificationPayloadString(notification: Notification, key: string): string | null {
  const value = notification.payload?.[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function buildNotificationGroupKey(notification: Notification): string {
  const actorKey = notification.fromUserId ?? "system";
  const postKey = notification.postId ?? "none";
  const messageKey = normalizeNotificationMessage(notification.message).slice(0, 96);
  const tokenKey =
    notification.entityId ??
    readNotificationPayloadString(notification, "tokenAddress") ??
    readNotificationPayloadString(notification, "symbol") ??
    messageKey;

  switch (notification.type) {
    case "like":
    case "comment":
    case "repost":
    case "follow":
      return `${notification.type}:${actorKey}`;
    case "new_post":
    case "posted_alpha":
      return `${notification.type}:${notification.id}`;
    case "early_runner_detected":
    case "hot_alpha_detected":
    case "high_conviction_detected":
    case "bundle_risk_changed":
    case "token_confidence_crossed":
    case "token_liquidity_surge":
    case "token_holder_growth":
    case "token_momentum":
    case "token_whale_accumulating":
    case "token_smart_money":
    case "liquidity_spike":
    case "volume_spike":
      return `${notification.type}:${tokenKey}`;
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

function buildMergedNotificationMessage(base: Notification, count: number, uniquePostCount: number): string {
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
    case "posted_alpha":
      return uniquePostCount <= 1 ? `${actor} posted a new Alpha` : `${actor} posted ${uniquePostCount} new Alphas`;
    case "follow":
      return `${actor} and ${count - 1} others followed you`;
    case "early_runner_detected":
      return `${base.message} (+${count - 1} more runner signals)`;
    case "hot_alpha_detected":
      return `${base.message} (+${count - 1} more hot alpha signals)`;
    case "high_conviction_detected":
      return `${base.message} (+${count - 1} more conviction signals)`;
    case "bundle_risk_changed":
      return `${base.message} (+${count - 1} more risk changes)`;
    case "token_confidence_crossed":
      return `${base.message} (+${count - 1} more confidence alerts)`;
    case "token_liquidity_surge":
      return `${base.message} (+${count - 1} more liquidity alerts)`;
    case "token_holder_growth":
      return `${base.message} (+${count - 1} more holder alerts)`;
    case "token_momentum":
      return `${base.message} (+${count - 1} more momentum alerts)`;
    case "token_whale_accumulating":
      return `${base.message} (+${count - 1} more whale alerts)`;
    case "token_smart_money":
      return `${base.message} (+${count - 1} more smart money alerts)`;
    case "liquidity_spike":
      return `${base.message} (+${count - 1} more liquidity spikes)`;
    case "volume_spike":
      return `${base.message} (+${count - 1} more volume spikes)`;
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
    const uniquePostCount = new Set(
      byNewest.map((item) => item.postId ?? item.entityId ?? item.id)
    ).size;

    merged.push({
      ...base,
      read: !hasUnread,
      message: buildMergedNotificationMessage(base, byNewest.length, uniquePostCount),
      mergedCount: byNewest.length,
      mergedIds,
      mergedItems: byNewest,
    });
  }

  return merged.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

type NotificationCategory = "all" | "mentions" | "raids" | "follows" | "system";

function getNotificationCategory(notification: Notification): Exclude<NotificationCategory, "all"> {
  const type = notification.type.toLowerCase();
  const reasonCode = notification.reasonCode?.toLowerCase() ?? "";
  const entityType = notification.entityType?.toLowerCase() ?? "";
  const message = notification.message.toLowerCase();

  if (type === "follow") return "follows";
  if (type.includes("raid") || reasonCode.includes("raid") || entityType.includes("raid") || message.includes("raid")) {
    return "raids";
  }
  if (reasonCode.includes("mention") || message.includes("mentioned you")) {
    return "mentions";
  }
  return "system";
}

function EmptyState({ mode }: { mode: NotificationCategory }) {
  const copy: Record<NotificationCategory, { title: string; body: string }> = {
    all: {
      title: "No notifications yet",
      body: "When someone interacts with your posts or follows you, you'll see it here.",
    },
    mentions: {
      title: "No mentions right now",
      body: "Direct mentions and callouts will appear here.",
    },
    raids: {
      title: "No raid alerts right now",
      body: "Active raid updates, joins, and completions will appear here.",
    },
    follows: {
      title: "No follow activity yet",
      body: "New followers will show up here once your profile starts attracting fresh attention.",
    },
    system: {
      title: "No system alerts right now",
      body: "AI detections, rewards, and platform notifications will appear here.",
    },
  };
  return (
    <div className="mx-auto flex min-h-[360px] max-w-[680px] items-center justify-center px-4 py-6">
      <div className="app-empty-state w-full gap-5 px-8 py-12">
        <div className="flex h-20 w-20 items-center justify-center rounded-full border border-border/70 bg-muted/80">
          <BellOff className="h-10 w-10 text-muted-foreground" />
        </div>
        <div>
          <p className="text-lg font-semibold text-foreground">{copy[mode].title}</p>
          <p className="mt-1 text-sm text-muted-foreground max-w-xs">
            {copy[mode].body}
          </p>
        </div>
      </div>
    </div>
  );
}

export default function Notifications() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const pageTopRef = useRef<HTMLDivElement>(null);
  const { data: session } = useSession();
  const { isAuthenticated, hasLiveSession, canPerformAuthenticatedWrites, isUsingCachedUser } = useAuth();
  const [activeFilter, setActiveFilter] = useState<NotificationCategory>("all");
  const [showAlertPreferences, setShowAlertPreferences] = useState(false);
  const [pushSubscribed, setPushSubscribed] = useState(false);
  const [pushLoading, setPushLoading] = useState(false);
  const prefersReducedMotion = useReducedMotion();
  const pushSupported = isPushSupported() && getPushPermission() !== "denied";

  // Check current push subscription state on mount
  useEffect(() => {
    isPushSubscribed().then(setPushSubscribed).catch(() => {});
  }, []);

  const handlePushToggle = useCallback(async () => {
    setPushLoading(true);
    try {
      if (pushSubscribed) {
        await unsubscribeFromPush();
        setPushSubscribed(false);
        toast.success("Push notifications disabled");
      } else {
        const ok = await subscribeToPush();
        if (ok) {
          setPushSubscribed(true);
          toast.success("Push notifications enabled");
        } else if (getPushPermission() === "denied") {
          toast.error("Notifications blocked — allow them in browser settings");
        } else {
          toast.error("Could not enable push notifications");
        }
      }
    } catch {
      toast.error("Something went wrong");
    } finally {
      setPushLoading(false);
    }
  }, [pushSubscribed]);
  const notificationsQueryKey = useMemo(
    () => ["notifications", session?.user?.id ?? "anonymous"] as const,
    [session?.user?.id]
  );
  const notificationsCacheKey = useMemo(
    () => (session?.user?.id ? `${NOTIFICATIONS_CACHE_KEY}:${session.user.id}` : NOTIFICATIONS_CACHE_KEY),
    [session?.user?.id]
  );
  const unreadCacheKey = useMemo(
    () =>
      session?.user?.id
        ? `${NOTIFICATIONS_UNREAD_CACHE_PREFIX}:${session.user.id}`
        : NOTIFICATIONS_UNREAD_CACHE_PREFIX,
    [session?.user?.id]
  );
  const unreadQueryKey = useMemo(
    () => ["notifications", "unread-count", session?.user?.id ?? "anonymous"] as const,
    [session?.user?.id]
  );
  const initialCachedEntry = useMemo(
    () => readSessionCacheEntry<Notification[]>(notificationsCacheKey, NOTIFICATIONS_CACHE_TTL_MS),
    [notificationsCacheKey]
  );
  const initialCachedNotifications = initialCachedEntry?.data ?? null;

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
      const payload = (await response.json().catch(() => null)) as { data?: Notification[]; degraded?: boolean } | null;
      const data = Array.isArray(payload?.data) ? payload.data : [];
      // DB was unavailable and no stale data — throw so the error state shows
      // instead of falsely presenting the user with "no notifications yet"
      if (payload?.degraded && data.length === 0) {
        if (fallbackNotifications && fallbackNotifications.length > 0) {
          return fallbackNotifications;
        }
        const degradedError = new Error("Notifications temporarily unavailable") as Error & { status?: number };
        degradedError.status = 503;
        throw degradedError;
      }
      if (data.length === 0 && fallbackNotifications && fallbackNotifications.length > 0) {
        return fallbackNotifications;
      }
      return data;
    },
    initialData:
      initialCachedNotifications && initialCachedNotifications.length > 0
        ? initialCachedNotifications
        : undefined,
    initialDataUpdatedAt: initialCachedEntry?.cachedAt,
    enabled: isAuthenticated && hasLiveSession,
    staleTime: 30_000,
    refetchOnMount: true,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
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
      return false;
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

  const {
    data: alertPreferences,
    refetch: refetchAlertPreferences,
  } = useQuery({
    queryKey: ["alert-preferences", session?.user?.id ?? "anonymous"],
    queryFn: () => api.get<AlertPreference>("/api/alerts/preferences"),
    enabled: isAuthenticated && hasLiveSession && showAlertPreferences,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });

  const updateAlertPreferencesMutation = useMutation({
    mutationFn: (payload: Partial<AlertPreference>) => api.put<AlertPreference>("/api/alerts/preferences", payload),
    onSuccess: () => {
      toast.success("Alert preferences updated");
      void refetchAlertPreferences();
    },
    onError: () => {
      toast.error("Failed to update alert preferences");
    },
  });

  useEffect(() => {
    if (!isFetched) return;
    writeSessionCache(notificationsCacheKey, notifications);
  }, [isFetched, notifications, notificationsCacheKey]);

  const updateUnreadCountCache = useCallback(
    (count: number) => {
      const nextCount = Math.max(0, Math.floor(Number.isFinite(count) ? count : 0));
      queryClient.setQueryData(unreadQueryKey, { count: nextCount });
      writeSessionCache(unreadCacheKey, nextCount);
    },
    [queryClient, unreadCacheKey, unreadQueryKey]
  );

  useEffect(() => {
    if (!isFetched) return;
    updateUnreadCountCache(notifications.filter((notification) => !notification.read).length);
  }, [isFetched, notifications, updateUnreadCountCache]);

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
      const nextNotifications =
        queryClient.setQueryData<Notification[]>(notificationsQueryKey, (old) =>
          old?.map((n) =>
            idSet.has(n.id) ? { ...n, read: true } : n
          )
        ) ?? [];
      updateUnreadCountCache(nextNotifications.filter((notification) => !notification.read).length);
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
      const nextNotifications =
        queryClient.setQueryData<Notification[]>(notificationsQueryKey, (old) =>
          old?.filter((n) => !dismissedSet.has(n.id))
        ) ?? [];
      updateUnreadCountCache(nextNotifications.filter((notification) => !notification.read).length);
      if (failedIds.length > 0) {
        toast.warning("Some notifications could not be dismissed");
        return;
      }
      toast.success("Notification dismissed");
    },
    onError: (_err, _id, context) => {
      if (context?.previousNotifications) {
        queryClient.setQueryData(notificationsQueryKey, context.previousNotifications);
        updateUnreadCountCache(
          context.previousNotifications.filter((notification) => !notification.read).length
        );
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
      updateUnreadCountCache(0);
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
  const filteredNotifications =
    activeFilter === "all"
      ? mergedNotifications
      : mergedNotifications.filter((notification) => getNotificationCategory(notification) === activeFilter);
  const shouldShowSessionRecovery = isAuthenticated && isUsingCachedUser && filteredNotifications.length === 0;
  const shouldShowRecoveryBanner = isAuthenticated && isUsingCachedUser && filteredNotifications.length > 0;
  const contentStateKey = !isAuthenticated
    ? "signed-out"
    : shouldShowSessionRecovery
      ? "session-recovery"
      : shouldShowRecoveryBanner
        ? `recovery:${activeFilter}`
        : isLoading || (!isFetched && filteredNotifications.length === 0)
          ? `loading:${activeFilter}`
          : error
            ? `error:${activeFilter}`
            : filteredNotifications.length === 0
              ? `empty:${activeFilter}`
              : `list:${activeFilter}`;
  const panelTransition = prefersReducedMotion
    ? { duration: 0 }
    : { duration: 0.24, ease: [0.22, 1, 0.36, 1] as const };

  useLayoutEffect(() => {
    if (typeof window === "undefined") return;
    let rafId = 0;
    let secondRafId = 0;
    const timeoutId = window.setTimeout(() => {
      pageTopRef.current?.scrollIntoView({ block: "start" });
      window.scrollTo({ top: 0, left: 0, behavior: "auto" });
    }, 90);

    const alignToTop = () => {
      pageTopRef.current?.scrollIntoView({ block: "start" });
      window.scrollTo({ top: 0, left: 0, behavior: "auto" });
    };

    alignToTop();
    rafId = window.requestAnimationFrame(() => {
      alignToTop();
      secondRafId = window.requestAnimationFrame(() => {
        alignToTop();
      });
    });

    return () => {
      window.clearTimeout(timeoutId);
      if (rafId) window.cancelAnimationFrame(rafId);
      if (secondRafId) window.cancelAnimationFrame(secondRafId);
    };
  }, []);

  const notificationsContent = !isAuthenticated ? (
    <div className="mx-auto flex min-h-[360px] max-w-[680px] items-center justify-center px-4 py-6">
      <div className="app-empty-state w-full gap-5 px-8 py-12">
        <div className="flex h-20 w-20 items-center justify-center rounded-full border border-border/70 bg-muted/80">
          <PhewBellIcon className="h-10 w-10 text-muted-foreground" />
        </div>
        <div>
          <p className="text-lg font-semibold text-foreground">Sign in to view notifications</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Activity alerts appear here after you sign in.
          </p>
        </div>
      </div>
    </div>
  ) : shouldShowSessionRecovery ? (
    <div className="px-4 pb-6 pt-6">
      {[0, 1, 2].map((i) => (
        <NotificationItemSkeleton key={i} />
      ))}
      <p className="px-4 py-3 text-sm text-muted-foreground">
        Finalizing your session and loading notifications...
      </p>
    </div>
  ) : shouldShowRecoveryBanner ? (
    <div className="px-4 pb-6 pt-6">
      <div className="mb-4 rounded-2xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
        Notifications are showing cached activity while sign-in finishes. Actions will unlock automatically.
      </div>
      <WindowVirtualList
        items={filteredNotifications}
        getItemKey={(notification) => notification.id}
        estimateItemHeight={104}
        overscanPx={900}
        className="pt-5"
        renderItem={(notification, index) => (
          <div
            className={cn(
              index === 0 && "pt-4",
              index < filteredNotifications.length - 1 && "pb-3"
            )}
          >
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
    <div className="px-4 pb-6 pt-6">
      {[0, 1, 2, 3, 4].map((i) => (
        <NotificationItemSkeleton key={i} />
      ))}
    </div>
  ) : error ? (
    <div className="mx-auto flex min-h-[360px] max-w-[680px] items-center justify-center px-4 py-6">
      <div className="app-empty-state w-full gap-5 px-8 py-12">
        <div className="flex h-20 w-20 items-center justify-center rounded-full bg-destructive/10">
          <PhewBellIcon className="h-10 w-10 text-destructive" />
        </div>
        <div>
          <p className="text-lg font-semibold text-foreground">
            Failed to load notifications
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            {notificationsErrorMessage}
          </p>
        </div>
        <Button variant="outline" onClick={() => refetch()}>
          Try Again
        </Button>
      </div>
    </div>
  ) : filteredNotifications.length === 0 ? (
    <EmptyState mode={activeFilter} />
  ) : (
    <div className="px-4 pb-6 pt-6">
      <WindowVirtualList
        items={filteredNotifications}
        getItemKey={(notification) => notification.id}
        estimateItemHeight={112}
        overscanPx={900}
        className="pt-5"
        renderItem={(notification, index) => (
          <div
            className={cn(
              index === 0 && "pt-4",
              index < filteredNotifications.length - 1 && "pb-3"
            )}
          >
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
  );

  return (
    <div ref={pageTopRef} className="space-y-5">
      <section className="overflow-hidden rounded-[30px] border border-white/8 bg-[radial-gradient(circle_at_top_left,rgba(169,255,52,0.12),transparent_28%),radial-gradient(circle_at_top_right,rgba(45,212,191,0.12),transparent_24%),linear-gradient(180deg,rgba(8,12,18,0.96),rgba(4,8,13,0.98))] px-5 py-5 shadow-[0_34px_80px_-44px_rgba(15,20,28,0.9)] sm:px-6">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <V2StatusPill tone="live">{unreadCount > 0 ? `${unreadCount} unread` : "Inbox clear"}</V2StatusPill>
              <span className="text-[11px] font-semibold uppercase tracking-[0.2em] text-white/34">Premium inbox</span>
            </div>
            <div>
              <h1 className="text-3xl font-semibold tracking-tight text-white sm:text-[2.2rem]">Notifications</h1>
              <p className="mt-1 max-w-2xl text-sm leading-6 text-white/56">
                Mentions, raid movement, follows, AI detections, and system rewards routed through the live notifications stack.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {unreadCount > 0 ? (
              <Button
                variant="ghost"
                size="sm"
                className="h-10 rounded-full border border-lime-300/18 bg-lime-300/10 px-4 text-lime-100 hover:bg-lime-300/14 hover:text-white"
                onClick={handleMarkAllRead}
                disabled={markAllReadMutation.isPending || !canPerformAuthenticatedWrites}
              >
                <CheckCheck className="mr-2 h-4 w-4" />
                Mark all read
              </Button>
            ) : null}
            <Button
              variant="ghost"
              size="sm"
              className="h-10 rounded-full border border-white/10 bg-white/[0.03] px-3 text-white/56 hover:bg-white/[0.06] hover:text-white"
              onClick={() => setShowAlertPreferences((prev) => !prev)}
            >
              <Settings2 className="h-4 w-4" />
              <span className="sr-only">{showAlertPreferences ? "Hide settings" : "Settings"}</span>
            </Button>
          </div>
        </div>
      </section>

      <main className="space-y-4">
        <section className="min-h-[calc(100vh-8rem)] overflow-hidden rounded-[30px] border border-white/8 bg-[linear-gradient(180deg,rgba(8,12,18,0.96),rgba(4,8,13,0.98))] shadow-[0_34px_80px_-44px_rgba(15,20,28,0.9)]">
          <div className="relative z-10 border-b border-white/8 bg-black/20 px-4 pb-4 pt-4 backdrop-blur-xl">
            <AnimatePresence initial={false}>
              {showAlertPreferences ? (
                <motion.div
                  initial={prefersReducedMotion ? { opacity: 1, height: "auto" } : { opacity: 0, height: 0, y: -8 }}
                  animate={{ opacity: 1, height: "auto", y: 0 }}
                  exit={prefersReducedMotion ? { opacity: 1, height: 0 } : { opacity: 0, height: 0, y: -8 }}
                  transition={panelTransition}
                  className="mb-4 overflow-hidden"
                >
                  <div className="rounded-[24px] border border-border/65 bg-background/55 p-4 shadow-[inset_0_1px_0_hsl(0_0%_100%/0.7)] dark:border-white/[0.08] dark:bg-white/[0.03] dark:shadow-none">
                    {alertPreferences ? (
                      <>
                        {pushSupported ? (
                          <div className="mb-4 flex items-center justify-between rounded-2xl border border-border/60 bg-muted/40 px-4 py-3">
                            <div>
                              <p className="text-sm font-semibold text-foreground">Browser push notifications</p>
                              <p className="text-xs text-muted-foreground">
                                {pushSubscribed
                                  ? "You'll get notified even when the app is closed"
                                  : "Get alerts even when you're not on the platform"}
                              </p>
                            </div>
                            <button
                              type="button"
                              disabled={pushLoading}
                              onClick={handlePushToggle}
                              className={cn(
                                "relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none disabled:opacity-50",
                                pushSubscribed ? "bg-primary" : "bg-muted-foreground/30"
                              )}
                              role="switch"
                              aria-checked={pushSubscribed}
                            >
                              <span
                                className={cn(
                                  "pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-lg transition duration-200",
                                  pushSubscribed ? "translate-x-5" : "translate-x-0"
                                )}
                              />
                            </button>
                          </div>
                        ) : null}
                        <div className="grid gap-3 md:grid-cols-3">
                          <label className="space-y-1">
                            <span className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Min confidence</span>
                            <Input
                              type="number"
                              defaultValue={alertPreferences.minConfidenceScore ?? 65}
                              onBlur={(event) =>
                                updateAlertPreferencesMutation.mutate({
                                  minConfidenceScore: Number(event.target.value),
                                })
                              }
                            />
                          </label>
                          <label className="space-y-1">
                            <span className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Min liquidity</span>
                            <Input
                              type="number"
                              defaultValue={alertPreferences.minLiquidity ?? 0}
                              onBlur={(event) =>
                                updateAlertPreferencesMutation.mutate({
                                  minLiquidity: Number(event.target.value),
                                })
                              }
                            />
                          </label>
                          <label className="space-y-1">
                            <span className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Max bundled %</span>
                            <Input
                              type="number"
                              defaultValue={alertPreferences.maxBundleRiskScore ?? 45}
                              onBlur={(event) =>
                                updateAlertPreferencesMutation.mutate({
                                  maxBundleRiskScore: Number(event.target.value),
                                })
                              }
                            />
                          </label>
                        </div>
                        <div className="mt-4 flex flex-wrap gap-2">
                          {[
                            ["notifyFollowedTraders", "Followed traders"],
                            ["notifyFollowedTokens", "Followed tokens"],
                            ["notifyEarlyRunners", "Early runners"],
                            ["notifyHotAlpha", "Hot alpha"],
                            ["notifyHighConviction", "High conviction"],
                            ["notifyBundleChanges", "Bundle changes"],
                            ["notifyConfidenceCross", "Confidence cross"],
                            ["notifyLiquiditySurge", "Liquidity surge"],
                            ["notifyHolderGrowth", "Holder growth"],
                            ["notifyMomentum", "Momentum"],
                            ["notifyWhaleAccumulating", "Whale aping"],
                            ["notifySmartMoney", "Smart money"],
                          ].map(([key, label]) => (
                            <button
                              key={key}
                              type="button"
                              onClick={() =>
                                updateAlertPreferencesMutation.mutate({
                                  [key]: !alertPreferences[key as keyof AlertPreference],
                                } as Partial<AlertPreference>)
                              }
                              className={cn(
                                "rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors",
                                alertPreferences[key as keyof AlertPreference]
                                  ? "border-primary/30 bg-primary/10 text-primary"
                                  : "border-border/60 bg-secondary text-muted-foreground"
                              )}
                            >
                              {label}
                            </button>
                          ))}
                        </div>
                      </>
                    ) : (
                      <div className="rounded-2xl border border-border/60 bg-muted/35 px-4 py-5 text-sm text-muted-foreground">
                        Loading alert settings...
                      </div>
                    )}
                  </div>
                </motion.div>
              ) : null}
            </AnimatePresence>
            <V2TabBar
              value={activeFilter}
              onChange={setActiveFilter}
              items={[
                { value: "all", label: "All" },
                { value: "mentions", label: "Mentions" },
                { value: "raids", label: "X Raids" },
                { value: "follows", label: "Follows" },
                { value: "system", label: "System" },
              ]}
            />
          </div>

          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={contentStateKey}
              initial={prefersReducedMotion ? { opacity: 1, y: 0 } : { opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={prefersReducedMotion ? { opacity: 1, y: 0 } : { opacity: 0, y: -8 }}
              transition={panelTransition}
            >
              {notificationsContent}
            </motion.div>
          </AnimatePresence>
        </section>
      </main>
    </div>
  );
}
