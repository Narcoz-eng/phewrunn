import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { api } from "@/lib/api";
import { Notification } from "@/types";
import { Button } from "@/components/ui/button";
import { Bell, CheckCheck, ArrowLeft, BellOff } from "lucide-react";
import { toast } from "sonner";
import { NotificationItem, NotificationItemSkeleton } from "@/components/notifications/NotificationItem";
import { AnimatePresence, motion } from "framer-motion";

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-16 gap-4 text-center">
      <div className="w-20 h-20 rounded-full bg-muted flex items-center justify-center">
        <BellOff className="h-10 w-10 text-muted-foreground" />
      </div>
      <div>
        <p className="font-semibold text-foreground text-lg">No notifications yet</p>
        <p className="text-sm text-muted-foreground mt-1 max-w-xs">
          When someone interacts with your posts or follows you, you'll see it here.
        </p>
      </div>
    </div>
  );
}

export default function Notifications() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  // Fetch notifications
  const {
    data: notifications = [],
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ["notifications"],
    queryFn: async () => {
      const data = await api.get<Notification[]>("/api/notifications");
      return data;
    },
    staleTime: 30000,
    refetchInterval: 60000,
  });

  // Mark notification as clicked (read)
  const markClickedMutation = useMutation({
    mutationFn: async (notificationId: string) => {
      await api.patch(`/api/notifications/${notificationId}/click`);
      return notificationId;
    },
    onSuccess: (notificationId) => {
      queryClient.setQueryData<Notification[]>(["notifications"], (old) =>
        old?.map((n) =>
          n.id === notificationId ? { ...n, read: true } : n
        )
      );
    },
    onError: () => {
      // Silently fail for click tracking
    },
  });

  // Dismiss notification
  const dismissMutation = useMutation({
    mutationFn: async (notificationId: string) => {
      await api.patch(`/api/notifications/${notificationId}/dismiss`);
      return notificationId;
    },
    onMutate: async (notificationId) => {
      // Optimistic update
      await queryClient.cancelQueries({ queryKey: ["notifications"] });
      const previousNotifications = queryClient.getQueryData<Notification[]>(["notifications"]);
      queryClient.setQueryData<Notification[]>(["notifications"], (old) =>
        old?.filter((n) => n.id !== notificationId)
      );
      return { previousNotifications };
    },
    onSuccess: () => {
      toast.success("Notification dismissed");
    },
    onError: (_err, _id, context) => {
      // Rollback on error
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

  const handleMarkClicked = (id: string) => {
    markClickedMutation.mutate(id);
  };

  const handleDismiss = (id: string) => {
    dismissMutation.mutate(id);
  };

  const handleMarkAllRead = () => {
    markAllReadMutation.mutate();
  };

  const handleProfileClick = (userId: string, username?: string | null) => {
    navigate(`/profile/${username || userId}`);
  };

  const unreadCount = notifications.filter((n) => !n.read).length;

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
                  {unreadCount}
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
          {isLoading ? (
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
          ) : notifications.length === 0 ? (
            <EmptyState />
          ) : (
            <motion.div layout>
              <AnimatePresence mode="popLayout">
                {notifications.map((notification) => (
                  <NotificationItem
                    key={notification.id}
                    notification={notification}
                    onMarkClicked={handleMarkClicked}
                    onDismiss={handleDismiss}
                    onProfileClick={handleProfileClick}
                  />
                ))}
              </AnimatePresence>
            </motion.div>
          )}
        </div>
      </main>
    </div>
  );
}
