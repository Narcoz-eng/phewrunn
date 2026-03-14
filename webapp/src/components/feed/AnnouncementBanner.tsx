import { useState, useEffect, useCallback, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Megaphone, X, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { readSessionCache, writeSessionCache } from "@/lib/session-cache";

interface Announcement {
  id: string;
  title: string;
  content: string;
  isPinned: boolean;
  createdAt: string;
  isViewed?: boolean;
}

const ANNOUNCEMENTS_SESSION_CACHE_KEY = "phew.feed.announcements.pinned";
const ANNOUNCEMENTS_SESSION_CACHE_TTL_MS = 60_000;

interface AnnouncementBannerProps {
  enabled?: boolean;
}

export function AnnouncementBanner({ enabled = true }: AnnouncementBannerProps) {
  const queryClient = useQueryClient();
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set());
  const viewedIdsRef = useRef<Set<string>>(new Set());
  const cachedAnnouncements = readSessionCache<Announcement[]>(
    ANNOUNCEMENTS_SESSION_CACHE_KEY,
    ANNOUNCEMENTS_SESSION_CACHE_TTL_MS
  );

  // Fetch pinned announcements
  const { data: announcements = [], isLoading } = useQuery({
    queryKey: ["announcements", "pinned"],
    queryFn: async () => {
      const data = await api.get<Announcement[]>("/api/announcements");
      const pinnedAnnouncements = data.filter((a) => a.isPinned);
      writeSessionCache(ANNOUNCEMENTS_SESSION_CACHE_KEY, pinnedAnnouncements);
      return pinnedAnnouncements;
    },
    initialData: cachedAnnouncements ?? undefined,
    enabled,
    staleTime: 60000, // 1 minute
    refetchOnMount: cachedAnnouncements ? false : "always",
    refetchInterval: 120000, // 2 minutes
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: 0,
  });

  // Mark as viewed mutation
  const viewMutation = useMutation({
    mutationFn: async (id: string) => {
      await api.post(`/api/announcements/${id}/view`, {});
    },
    onSuccess: (_, id) => {
      // Update the local cache to mark as viewed
      queryClient.setQueryData<Announcement[]>(
        ["announcements", "pinned"],
        (old) =>
          old?.map((a) =>
            a.id === id ? { ...a, isViewed: true } : a
          )
      );
    },
  });

  // Dismiss an announcement (local only, reappears on refresh)
  const handleDismiss = useCallback((id: string) => {
    setDismissedIds((prev) => new Set([...prev, id]));
  }, []);

  // Filter out dismissed announcements
  const visibleAnnouncements = announcements.filter(
    (a) => !dismissedIds.has(a.id)
  );

  // Auto-mark as viewed when announcements load (with ref to prevent infinite loops)
  useEffect(() => {
    if (!enabled) return;
    visibleAnnouncements.forEach((a) => {
      if (!a.isViewed && !viewedIdsRef.current.has(a.id)) {
        viewedIdsRef.current.add(a.id);
        viewMutation.mutate(a.id);
      }
    });
  }, [enabled, visibleAnnouncements, viewMutation]);

  if (isLoading || visibleAnnouncements.length === 0) {
    return null;
  }

  return (
    <div className="space-y-3 mb-6">
      <AnimatePresence>
        {visibleAnnouncements.map((announcement) => (
          <motion.div
            key={announcement.id}
            initial={{ opacity: 0, y: -20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -10, scale: 0.95 }}
            transition={{ type: "spring", damping: 25, stiffness: 300 }}
            className={cn(
              "relative p-4 rounded-xl overflow-hidden",
              "bg-gradient-to-r from-card via-card to-card",
              "border-2 border-transparent",
              // Gradient border effect
              "before:absolute before:inset-0 before:-z-10 before:rounded-xl before:p-[2px]",
              "before:bg-gradient-to-r before:from-cyan-500 before:via-primary before:to-purple-500"
            )}
            style={{
              background:
                "linear-gradient(var(--card), var(--card)) padding-box, linear-gradient(135deg, #06b6d4, hsl(var(--primary)), #a855f7) border-box",
              border: "2px solid transparent",
            }}
          >
            {/* Background glow effect */}
            <div className="absolute inset-0 bg-gradient-to-r from-cyan-500/5 via-primary/5 to-purple-500/5 pointer-events-none" />

            <div className="relative flex items-start gap-3">
              {/* Icon */}
              <div className="flex-shrink-0 w-10 h-10 rounded-full bg-gradient-to-br from-cyan-500/20 to-purple-500/20 flex items-center justify-center">
                <Megaphone className="h-5 w-5 text-primary" />
              </div>

              {/* Content */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className="font-bold text-foreground">
                    {announcement.title}
                  </h3>
                  {/* NEW badge if not viewed */}
                  {!announcement.isViewed && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-bold uppercase rounded-full bg-gradient-to-r from-cyan-500 to-purple-500 text-white">
                      <Sparkles className="h-2.5 w-2.5" />
                      NEW
                    </span>
                  )}
                </div>
                <p className="mt-1 text-sm text-muted-foreground leading-relaxed">
                  {announcement.content}
                </p>
              </div>

              {/* Dismiss button */}
              <Button
                variant="ghost"
                size="icon"
                className="flex-shrink-0 h-8 w-8 text-muted-foreground hover:text-foreground"
                onClick={() => handleDismiss(announcement.id)}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
