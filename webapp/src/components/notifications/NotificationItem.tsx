import { useMemo, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useNavigate } from "react-router-dom";
import { Notification, getAvatarUrl, formatTimeAgo, stripContractAddress } from "@/types";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  TrendingUp,
  TrendingDown,
  Award,
  Star,
  Check,
  X,
  Flame,
  AlertTriangle,
  Droplets,
  BarChart2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { buildProfilePath } from "@/lib/profile-path";
import {
  PhewBellIcon,
  PhewCommentIcon,
  PhewFollowIcon,
  PhewLikeIcon,
  PhewRepostIcon,
} from "@/components/icons/PhewIcons";

const notificationIcons: Record<string, { icon: typeof PhewBellIcon; colorClass: string }> = {
  like: { icon: PhewLikeIcon, colorClass: "text-rose-500" },
  comment: { icon: PhewCommentIcon, colorClass: "text-sky-500" },
  follow: { icon: PhewFollowIcon, colorClass: "text-primary" },
  repost: { icon: PhewRepostIcon, colorClass: "text-primary" },
  settlement: { icon: TrendingUp, colorClass: "text-emerald-500" },
  win_1h: { icon: TrendingUp, colorClass: "text-emerald-500" },
  loss_1h: { icon: TrendingDown, colorClass: "text-rose-500" },
  win_6h: { icon: TrendingUp, colorClass: "text-emerald-500" },
  loss_6h: { icon: TrendingDown, colorClass: "text-rose-500" },
  level_up: { icon: Award, colorClass: "text-amber-500" },
  new_post: { icon: PhewBellIcon, colorClass: "text-primary" },
  achievement: { icon: Star, colorClass: "text-amber-500" },
  posted_alpha: { icon: PhewBellIcon, colorClass: "text-primary" },
  early_runner_detected: { icon: TrendingUp, colorClass: "text-emerald-500" },
  hot_alpha_detected: { icon: Flame, colorClass: "text-orange-500" },
  high_conviction_detected: { icon: Star, colorClass: "text-violet-500" },
  bundle_risk_changed: { icon: AlertTriangle, colorClass: "text-amber-500" },
  token_confidence_crossed: { icon: Award, colorClass: "text-primary" },
  liquidity_spike: { icon: Droplets, colorClass: "text-cyan-400" },
  volume_spike: { icon: BarChart2, colorClass: "text-orange-400" },
};

function readNotificationPayloadString(notification: Notification, key: string): string | null {
  const value = notification.payload?.[key];
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function buildNotificationDestination(notification: Notification): string | null {
  if (notification.entityType === "token") {
    const tokenAddress =
      readNotificationPayloadString(notification, "tokenAddress") ?? notification.post?.contractAddress;
    if (tokenAddress) {
      return `/token/${tokenAddress}`;
    }
  }

  if (notification.entityType === "call" || notification.entityType === "post") {
    const callId = notification.entityId ?? notification.postId;
    if (callId) {
      return `/post/${callId}`;
    }
  }

  if (notification.postId) {
    return `/post/${notification.postId}`;
  }

  if (notification.entityType === "trader" || notification.entityType === "user") {
    if (notification.fromUser) {
      return buildProfilePath(notification.fromUser.id, notification.fromUser.username);
    }
    const handle = readNotificationPayloadString(notification, "handle");
    if (handle) {
      return `/${handle}`;
    }
    if (notification.entityId) {
      return buildProfilePath(notification.entityId, handle);
    }
  }

  if (notification.fromUser) {
    return buildProfilePath(notification.fromUser.id, notification.fromUser.username);
  }

  return null;
}

function getNotificationIcon(notification: Notification) {
  if (notification.type === "settlement") {
    const isWin =
      notification.message.toLowerCase().includes("win") ||
      notification.message.includes("+") ||
      notification.message.toLowerCase().includes("level up");
    return isWin
      ? { icon: TrendingUp, colorClass: "text-emerald-500" }
      : { icon: TrendingDown, colorClass: "text-rose-500" };
  }

  return notificationIcons[notification.type] || { icon: PhewBellIcon, colorClass: "text-primary" };
}

interface NotificationItemProps {
  notification: Notification;
  onMarkClicked: (notification: Notification) => void;
  onDismiss: (notification: Notification) => void;
  onProfileClick: (userId: string, username?: string | null) => void;
}

export function NotificationItem({
  notification,
  onMarkClicked,
  onDismiss,
  onProfileClick,
}: NotificationItemProps) {
  const navigate = useNavigate();
  const [isExpanded, setIsExpanded] = useState(false);
  const prefersReducedMotion = useReducedMotion();
  const fromUser = notification.fromUser;
  const { icon: IconComponent, colorClass } = getNotificationIcon(notification);
  const mergedItems = Array.isArray(notification.mergedItems) ? notification.mergedItems : [];
  const hasMergedItems = mergedItems.length > 1;
  const mergedCount = notification.mergedCount ?? mergedItems.length;
  const cardTransition = prefersReducedMotion
    ? { duration: 0 }
    : { duration: 0.22, ease: [0.22, 1, 0.36, 1] as const };

  const detailPreview = useMemo(
    () => stripContractAddress(notification.post?.content ?? "").trim(),
    [notification.post?.content]
  );
  const tokenAddress = readNotificationPayloadString(notification, "tokenAddress");
  const destinationHref = buildNotificationDestination(notification);

  const handleRowActivate = () => {
    if (!notification.read) {
      onMarkClicked(notification);
    }
    if (hasMergedItems) {
      setIsExpanded((prev) => !prev);
      return;
    }
    if (destinationHref) {
      navigate(destinationHref);
    }
  };

  const handleRowKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      handleRowActivate();
    }
  };

  const handleAvatarClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (fromUser) {
      onProfileClick(fromUser.id, fromUser.username);
    }
  };

  const handleDismissClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onDismiss(notification);
  };

  const handleMarkReadClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!notification.read) {
      onMarkClicked(notification);
    }
  };

  return (
    <motion.article
      layout="position"
      initial={prefersReducedMotion ? false : { opacity: 0, y: 10, scale: 0.985 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      whileHover={prefersReducedMotion ? undefined : { y: -1.5 }}
      transition={cardTransition}
      className={cn(
        "group relative overflow-hidden rounded-[24px] border border-border/65 transition-all duration-200 shadow-[0_18px_36px_-34px_hsl(var(--foreground)/0.14)] dark:shadow-none",
        !notification.read
          ? "bg-[radial-gradient(circle_at_top,hsl(var(--primary)/0.1),transparent_48%),linear-gradient(180deg,hsl(0_0%_100%/0.94),hsl(38_35%_94%/0.92))] hover:border-primary/20 hover:bg-primary/[0.05] hover:shadow-[0_24px_42px_-34px_hsl(var(--primary)/0.22)] dark:bg-[radial-gradient(circle_at_top,hsl(var(--primary)/0.12),transparent_44%),linear-gradient(180deg,rgba(14,16,22,0.96),rgba(10,12,16,0.98))] dark:hover:shadow-none"
          : "bg-[linear-gradient(180deg,hsl(0_0%_100%/0.82),hsl(38_30%_93%/0.86))] hover:border-border hover:bg-white/90 hover:shadow-[0_24px_42px_-34px_hsl(var(--foreground)/0.18)] dark:bg-[linear-gradient(180deg,rgba(12,14,20,0.92),rgba(8,10,14,0.96))] dark:hover:shadow-none"
      )}
    >
      <div
        role="button"
        tabIndex={0}
        onClick={handleRowActivate}
        onKeyDown={handleRowKeyDown}
        className="grid grid-cols-[auto,minmax(0,1fr)] items-start gap-3.5 px-4 py-4 outline-none sm:grid-cols-[auto,minmax(0,1fr),auto] sm:px-5"
      >
        <div className="relative shrink-0">
          <Avatar
            className={cn(
              "h-10 w-10 border border-border/60",
              fromUser && "cursor-pointer hover:ring-2 hover:ring-primary/30 transition-all"
            )}
            onClick={handleAvatarClick}
          >
            {fromUser ? (
              <>
                <AvatarImage src={getAvatarUrl(fromUser.id, fromUser.image)} />
                <AvatarFallback className="bg-muted text-muted-foreground">
                  {(fromUser.username || fromUser.name)?.charAt(0) || "?"}
                </AvatarFallback>
              </>
            ) : (
              <>
                <AvatarImage src="" />
                <AvatarFallback className="bg-primary/20 text-primary">
                  <PhewBellIcon className="h-4 w-4" />
                </AvatarFallback>
              </>
            )}
          </Avatar>
          <div
            className={cn(
              "absolute -bottom-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full border border-border bg-background/95 shadow-[0_10px_18px_-16px_hsl(var(--foreground)/0.3)] dark:shadow-none",
              !notification.read && "border-primary/30 bg-primary/15"
            )}
          >
            <IconComponent className={cn("h-3 w-3", colorClass)} />
          </div>
        </div>

        <div className="min-w-0 pt-0.5">
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
            <span className="max-w-[12rem] truncate text-sm font-semibold text-foreground sm:max-w-[18rem]">
              {fromUser ? `@${fromUser.username || fromUser.name}` : "PHEW"}
            </span>
            <span className="text-xs text-muted-foreground">{formatTimeAgo(notification.createdAt)}</span>
            {!notification.read ? <span className="h-2 w-2 rounded-full bg-primary shrink-0" /> : null}
          </div>
          <p className={cn("mt-1 text-sm leading-relaxed text-foreground/95", !notification.read && "font-medium")}>
            {notification.message}
          </p>
          {hasMergedItems ? (
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                setIsExpanded((prev) => !prev);
              }}
              className="mt-1 text-xs text-primary hover:underline"
            >
              {isExpanded ? "Hide grouped activity" : `Show grouped activity (${mergedCount})`}
            </button>
          ) : null}
          {detailPreview ? (
            <p className="mt-1 line-clamp-1 text-xs text-muted-foreground">{detailPreview}</p>
          ) : null}
          {notification.post?.contractAddress ? (
            <p className="mt-1 truncate text-[11px] font-mono text-muted-foreground/85">
              {notification.post.contractAddress}
            </p>
          ) : tokenAddress ? (
            <p className="mt-1 truncate text-[11px] font-mono text-muted-foreground/85">
              {tokenAddress}
            </p>
          ) : null}
        </div>

        <div className="col-start-2 flex items-center gap-1.5 justify-self-start pt-1 sm:col-start-3 sm:justify-self-end sm:pt-0.5 sm:opacity-0 sm:transition-opacity sm:group-hover:opacity-100 sm:group-focus-within:opacity-100">
          {!notification.read ? (
            <Button
              variant="ghost"
              size="icon"
              className="h-9 w-9 rounded-full border border-border/70 bg-background/80 text-muted-foreground shadow-[0_12px_22px_-18px_hsl(var(--foreground)/0.25)] hover:bg-background hover:text-foreground dark:border-white/[0.08] dark:bg-white/[0.04] dark:shadow-none dark:hover:bg-white/[0.08]"
              onClick={handleMarkReadClick}
              title="Mark as read"
            >
              <Check className="h-4 w-4" />
            </Button>
          ) : null}
          <Button
            variant="ghost"
            size="icon"
            className="h-9 w-9 rounded-full border border-border/70 bg-background/80 text-muted-foreground shadow-[0_12px_22px_-18px_hsl(var(--foreground)/0.25)] hover:bg-background hover:text-foreground dark:border-white/[0.08] dark:bg-white/[0.04] dark:shadow-none dark:hover:bg-white/[0.08]"
            onClick={handleDismissClick}
            title="Dismiss notification"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <AnimatePresence initial={false}>
        {hasMergedItems && isExpanded ? (
          <motion.div
            initial={prefersReducedMotion ? { opacity: 1, height: "auto" } : { opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={prefersReducedMotion ? { opacity: 1, height: 0 } : { opacity: 0, height: 0 }}
            transition={cardTransition}
            className="overflow-hidden border-t border-border/60 bg-muted/15"
          >
            <div className="px-4 pb-4 pt-3">
              <div className="space-y-2">
                {mergedItems.map((item) => {
                  const itemPreview = stripContractAddress(item.post?.content ?? "").trim();
                  const itemHref = buildNotificationDestination(item);
                  const itemTokenAddress = readNotificationPayloadString(item, "tokenAddress");
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        if (!item.read) {
                          onMarkClicked(item);
                        }
                        if (itemHref) {
                          navigate(itemHref);
                        }
                      }}
                      className="w-full rounded-[16px] border border-border/60 bg-background/70 px-3 py-2.5 text-left transition-colors hover:bg-background/90"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-[11px] text-muted-foreground">{formatTimeAgo(item.createdAt)}</span>
                        {item.post?.contractAddress ? (
                          <span className="truncate text-[10px] font-mono text-muted-foreground">
                            {item.post.contractAddress}
                          </span>
                        ) : itemTokenAddress ? (
                          <span className="truncate text-[10px] font-mono text-muted-foreground">
                            {itemTokenAddress}
                          </span>
                        ) : null}
                      </div>
                      <p className="mt-1 line-clamp-1 text-xs text-foreground/90">{item.message}</p>
                      {itemPreview ? (
                        <p className="mt-0.5 line-clamp-1 text-[11px] text-muted-foreground">{itemPreview}</p>
                      ) : null}
                    </button>
                  );
                })}
              </div>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </motion.article>
  );
}

export function NotificationItemSkeleton() {
  return (
    <div className="flex items-start gap-3 rounded-[24px] border border-border/60 px-4 py-4">
      <div className="h-10 w-10 rounded-full bg-muted animate-pulse shrink-0" />
      <div className="flex-1 space-y-2">
        <div className="h-3.5 w-1/3 bg-muted animate-pulse rounded" />
        <div className="h-4 w-4/5 bg-muted animate-pulse rounded" />
        <div className="h-3 w-2/3 bg-muted animate-pulse rounded" />
      </div>
      <div className="h-7 w-7 bg-muted animate-pulse rounded-full shrink-0" />
    </div>
  );
}
