import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Notification, getAvatarUrl, formatTimeAgo, stripContractAddress } from "@/types";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { LevelBadge } from "@/components/feed/LevelBar";
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
  X,
  ChevronDown,
  ChevronUp,
  ExternalLink,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { motion, AnimatePresence } from "framer-motion";

// Notification type icons mapping
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
  const type = notification.type;

  // Check for settlement win/loss in message
  if (type === "settlement") {
    const isWin = notification.message.toLowerCase().includes("win") ||
                  notification.message.includes("+") ||
                  notification.message.toLowerCase().includes("level up");
    return isWin
      ? { icon: TrendingUp, colorClass: "text-emerald-500" }
      : { icon: TrendingDown, colorClass: "text-rose-500" };
  }

  return notificationIcons[type] || { icon: Bell, colorClass: "text-primary" };
}

interface NotificationItemProps {
  notification: Notification;
  onMarkClicked: (id: string) => void;
  onDismiss: (id: string) => void;
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

  // Determine if this is a win or loss notification
  const isSettlement = notification.type === "settlement" ||
                       notification.type.startsWith("win_") ||
                       notification.type.startsWith("loss_");
  const isWin = notification.type.startsWith("win_") ||
                (notification.type === "settlement" &&
                 (notification.message.toLowerCase().includes("win") ||
                  notification.message.includes("+")));
  const isLoss = notification.type.startsWith("loss_") ||
                 (notification.type === "settlement" &&
                  (notification.message.toLowerCase().includes("loss") ||
                   notification.message.toLowerCase().includes("lost")));

  const handleClick = () => {
    // Mark as clicked (read)
    if (!notification.read) {
      onMarkClicked(notification.id);
    }
    // Toggle expanded state instead of navigating
    setIsExpanded(!isExpanded);
  };

  const handleAvatarClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (fromUser) {
      onProfileClick(fromUser.id, fromUser.username);
    }
  };

  const handleDismiss = (e: React.MouseEvent) => {
    e.stopPropagation();
    onDismiss(notification.id);
  };

  const handleViewPost = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (notification.postId) {
      navigate(`/post/${notification.postId}`);
    }
  };

  const handleViewProfile = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (fromUser) {
      navigate(`/profile/${fromUser.username || fromUser.id}`);
    }
  };

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, x: -100, height: 0 }}
      transition={{ duration: 0.2 }}
      className={cn(
        "relative border-b border-border/50 last:border-0 transition-colors",
        !notification.read && "bg-primary/5 dark:bg-primary/10",
        isSettlement && isWin && "bg-emerald-500/5 dark:bg-emerald-500/10",
        isSettlement && isLoss && "bg-rose-500/5 dark:bg-rose-500/10"
      )}
    >
      {/* Main notification row */}
      <div
        className={cn(
          "flex items-start gap-3 p-4 cursor-pointer hover:bg-muted/50 transition-colors",
          isExpanded && "bg-muted/30"
        )}
        onClick={handleClick}
      >
        {/* Avatar with type icon badge */}
        <div className="relative flex-shrink-0">
          <Avatar
            className={cn(
              "h-10 w-10",
              fromUser && "cursor-pointer hover:ring-2 hover:ring-primary/50 transition-all"
            )}
            onClick={handleAvatarClick}
          >
            {fromUser ? (
              <>
                <AvatarImage src={getAvatarUrl(fromUser.id, fromUser.image)} />
                <AvatarFallback className="bg-muted text-muted-foreground">
                  {fromUser.name?.charAt(0) || "?"}
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
          {/* Type indicator badge */}
          <div className={cn(
            "absolute -bottom-1 -right-1 h-5 w-5 rounded-full bg-background border border-border flex items-center justify-center",
            isSettlement && isWin && "bg-emerald-500/20 border-emerald-500/30",
            isSettlement && isLoss && "bg-rose-500/20 border-rose-500/30"
          )}>
            <IconComponent className={cn("h-3 w-3", colorClass)} />
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            {fromUser && (
              <>
                <button
                  onClick={handleAvatarClick}
                  className="font-semibold text-sm text-foreground hover:text-primary hover:underline transition-colors"
                >
                  {fromUser.username || fromUser.name}
                </button>
                <LevelBadge level={fromUser.level} size="sm" />
              </>
            )}
          </div>
          <p className={cn(
            "text-sm leading-relaxed mt-0.5",
            !notification.read && "font-medium",
            isSettlement && isWin && "text-emerald-600 dark:text-emerald-400",
            isSettlement && isLoss && "text-rose-600 dark:text-rose-400"
          )}>
            {notification.message}
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            {formatTimeAgo(notification.createdAt)}
          </p>
        </div>

        {/* Right side: Expand indicator and unread dot */}
        <div className="flex items-center gap-2 flex-shrink-0">
          {/* Unread indicator */}
          {!notification.read && (
            <div className="h-2 w-2 rounded-full bg-primary" />
          )}

          {/* Expand/collapse indicator */}
          {isExpanded ? (
            <ChevronUp className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          )}
        </div>

        {/* Dismiss button - top right */}
        <Button
          variant="ghost"
          size="icon"
          className="absolute top-2 right-2 h-6 w-6 opacity-0 group-hover:opacity-100 hover:opacity-100 focus:opacity-100 text-muted-foreground hover:text-foreground hover:bg-muted"
          onClick={handleDismiss}
          title="Dismiss notification"
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>

      {/* Expanded details */}
      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-4 pt-0 ml-[52px] space-y-3">
              {/* Post preview if available */}
              {notification.post && (
                <div className="p-3 bg-muted/50 rounded-lg border border-border/50">
                  <p className="text-sm text-muted-foreground line-clamp-3">
                    {stripContractAddress(notification.post.content)}
                  </p>
                  {notification.post.contractAddress && (
                    <p className="text-xs font-mono text-muted-foreground mt-2 truncate">
                      CA: {notification.post.contractAddress}
                    </p>
                  )}
                </div>
              )}

              {/* Action buttons */}
              <div className="flex items-center gap-2">
                {/* Only show View Post if the post exists and has an id */}
                {notification.postId && notification.post && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 gap-1.5"
                    onClick={handleViewPost}
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                    View Post
                  </Button>
                )}
                {fromUser && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 gap-1.5"
                    onClick={handleViewProfile}
                  >
                    <UserPlus className="h-3.5 w-3.5" />
                    View Profile
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 gap-1.5 text-muted-foreground hover:text-destructive"
                  onClick={handleDismiss}
                >
                  <X className="h-3.5 w-3.5" />
                  Dismiss
                </Button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

// Skeleton component for loading state
export function NotificationItemSkeleton() {
  return (
    <div className="flex items-start gap-3 p-4 border-b border-border/50 last:border-0">
      <div className="h-10 w-10 rounded-full bg-muted animate-pulse flex-shrink-0" />
      <div className="flex-1 space-y-2">
        <div className="h-4 w-3/4 bg-muted animate-pulse rounded" />
        <div className="h-3 w-20 bg-muted animate-pulse rounded" />
      </div>
      <div className="h-8 w-8 bg-muted animate-pulse rounded-md" />
    </div>
  );
}
