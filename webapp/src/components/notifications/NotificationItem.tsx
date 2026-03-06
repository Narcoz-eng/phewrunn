import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Notification, getAvatarUrl, formatTimeAgo, stripContractAddress } from "@/types";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  Bell,
  Heart,
  MessageCircle,
  UserPlus,
  Repeat2,
  TrendingUp,
  TrendingDown,
  Award,
  Star,
  Check,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { buildProfilePath } from "@/lib/profile-path";

const notificationIcons: Record<string, { icon: typeof Bell; colorClass: string }> = {
  like: { icon: Heart, colorClass: "text-rose-500" },
  comment: { icon: MessageCircle, colorClass: "text-blue-500" },
  follow: { icon: UserPlus, colorClass: "text-primary" },
  repost: { icon: Repeat2, colorClass: "text-primary" },
  settlement: { icon: TrendingUp, colorClass: "text-emerald-500" },
  win_1h: { icon: TrendingUp, colorClass: "text-emerald-500" },
  loss_1h: { icon: TrendingDown, colorClass: "text-rose-500" },
  win_6h: { icon: TrendingUp, colorClass: "text-emerald-500" },
  loss_6h: { icon: TrendingDown, colorClass: "text-rose-500" },
  level_up: { icon: Award, colorClass: "text-amber-500" },
  new_post: { icon: Bell, colorClass: "text-primary" },
  achievement: { icon: Star, colorClass: "text-amber-500" },
};

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

  return notificationIcons[notification.type] || { icon: Bell, colorClass: "text-primary" };
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
  const fromUser = notification.fromUser;
  const { icon: IconComponent, colorClass } = getNotificationIcon(notification);
  const mergedItems = Array.isArray(notification.mergedItems) ? notification.mergedItems : [];
  const hasMergedItems = mergedItems.length > 1;
  const mergedCount = notification.mergedCount ?? mergedItems.length;

  const detailPreview = useMemo(
    () => stripContractAddress(notification.post?.content ?? "").trim(),
    [notification.post?.content]
  );

  const destinationHref =
    notification.postId
      ? `/post/${notification.postId}`
      : fromUser
        ? buildProfilePath(fromUser.id, fromUser.username)
        : null;

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
    <article
      className={cn(
        "group relative border-b border-border/60 transition-colors",
        !notification.read
          ? "bg-primary/[0.07] hover:bg-primary/[0.11]"
          : "hover:bg-muted/35"
      )}
    >
      <div
        role="button"
        tabIndex={0}
        onClick={handleRowActivate}
        onKeyDown={handleRowKeyDown}
        className="flex items-start gap-3 px-4 py-3 pr-20 outline-none"
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
                  <Bell className="h-4 w-4" />
                </AvatarFallback>
              </>
            )}
          </Avatar>
          <div
            className={cn(
              "absolute -bottom-1 -right-1 h-5 w-5 rounded-full border border-border bg-background flex items-center justify-center",
              !notification.read && "border-primary/30 bg-primary/15"
            )}
          >
            <IconComponent className={cn("h-3 w-3", colorClass)} />
          </div>
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-semibold text-foreground">
              {fromUser ? `@${fromUser.username || fromUser.name}` : "PHEW"}
            </span>
            <span className="text-xs text-muted-foreground">{formatTimeAgo(notification.createdAt)}</span>
            {!notification.read ? <span className="h-2 w-2 rounded-full bg-primary shrink-0" /> : null}
          </div>
          <p className={cn("mt-0.5 text-sm leading-relaxed text-foreground/95", !notification.read && "font-medium")}>
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
          ) : null}
        </div>
      </div>

      <div className="absolute right-2 top-2 flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
        {!notification.read ? (
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-muted-foreground hover:text-foreground hover:bg-muted"
            onClick={handleMarkReadClick}
            title="Mark as read"
          >
            <Check className="h-3.5 w-3.5" />
          </Button>
        ) : null}
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 text-muted-foreground hover:text-foreground hover:bg-muted"
          onClick={handleDismissClick}
          title="Dismiss notification"
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>

      {hasMergedItems && isExpanded ? (
        <div className="border-t border-border/60 bg-muted/20 px-4 pb-3 pt-2">
          <div className="space-y-2">
            {mergedItems.map((item) => {
              const itemPreview = stripContractAddress(item.post?.content ?? "").trim();
              const itemHref = item.postId
                ? `/post/${item.postId}`
                : item.fromUser
                  ? buildProfilePath(item.fromUser.id, item.fromUser.username)
                  : null;
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
                  className="w-full rounded-md border border-border/60 bg-background/60 px-3 py-2 text-left hover:bg-background/80"
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-[11px] text-muted-foreground">{formatTimeAgo(item.createdAt)}</span>
                    {item.post?.contractAddress ? (
                      <span className="truncate text-[10px] font-mono text-muted-foreground">
                        {item.post.contractAddress}
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
      ) : null}
    </article>
  );
}

export function NotificationItemSkeleton() {
  return (
    <div className="flex items-start gap-3 px-4 py-3 border-b border-border/60">
      <div className="h-10 w-10 rounded-full bg-muted animate-pulse shrink-0" />
      <div className="flex-1 space-y-2">
        <div className="h-3.5 w-1/3 bg-muted animate-pulse rounded" />
        <div className="h-4 w-4/5 bg-muted animate-pulse rounded" />
        <div className="h-3 w-2/3 bg-muted animate-pulse rounded" />
      </div>
      <div className="h-7 w-7 bg-muted animate-pulse rounded-md shrink-0" />
    </div>
  );
}
