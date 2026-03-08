import { useRef, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ThemeToggle } from "@/components/ThemeToggle";
import { BrandLogo } from "@/components/BrandLogo";
import { User, getAvatarUrl } from "@/types";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth-client";
import { readSessionCache, writeSessionCache } from "@/lib/session-cache";
import { LevelBadge } from "./LevelBar";
import { LogOut, Settings, User as UserIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { PhewBellIcon, PhewTrophyIcon } from "@/components/icons/PhewIcons";

export type FeedTab = "latest" | "trending" | "following";

interface FeedHeaderProps {
  user: User | null;
  activeTab: FeedTab;
  onTabChange: (tab: FeedTab) => void;
  onLogout: () => void;
}

const tabs: { id: FeedTab; label: string }[] = [
  { id: "latest", label: "Latest" },
  { id: "trending", label: "Trending" },
  { id: "following", label: "Following" },
];
const NOTIFICATIONS_UNREAD_CACHE_PREFIX = "phew.notifications.unread";
const NOTIFICATIONS_UNREAD_CACHE_TTL_MS = 10 * 60_000;

export function FeedHeader({ user, activeTab, onTabChange, onLogout }: FeedHeaderProps) {
  const navigate = useNavigate();
  const { hasLiveSession } = useAuth();
  const tabRefs = useRef<Map<FeedTab, HTMLButtonElement>>(new Map());
  const [indicatorStyle, setIndicatorStyle] = useState({ left: 0, width: 0 });
  const unreadCacheKey = user ? `${NOTIFICATIONS_UNREAD_CACHE_PREFIX}:${user.id}` : NOTIFICATIONS_UNREAD_CACHE_PREFIX;
  const cachedUnreadCount = readSessionCache<number>(unreadCacheKey, NOTIFICATIONS_UNREAD_CACHE_TTL_MS);
  const unreadQueryKey = ["notifications", "unread-count", user?.id ?? "anonymous"] as const;

  // Fetch unread notification count
  const { data: unreadData } = useQuery({
    queryKey: unreadQueryKey,
    queryFn: async () => {
      const response = await api.get<{ count: number }>("/api/notifications/unread-count");
      writeSessionCache(unreadCacheKey, response.count);
      return response;
    },
    initialData: cachedUnreadCount !== null ? { count: cachedUnreadCount } : undefined,
    enabled: !!user && hasLiveSession,
    refetchOnWindowFocus: false,
    refetchOnReconnect: true,
    refetchInterval: () => {
      if (typeof document !== "undefined" && document.visibilityState !== "visible") {
        return false;
      }
      return 90_000;
    },
    staleTime: 45_000,
    retry: 2,
    retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 5000),
  });

  const unreadCount = hasLiveSession ? (unreadData?.count ?? 0) : 0;

  useEffect(() => {
    const activeTabElement = tabRefs.current.get(activeTab);
    if (activeTabElement) {
      setIndicatorStyle({
        left: activeTabElement.offsetLeft,
        width: activeTabElement.offsetWidth,
      });
    }
  }, [activeTab]);

  return (
    <header className="app-topbar">
      {/* Top Row - Branding & Actions */}
      <div className="mx-auto flex h-[4.4rem] max-w-[780px] items-center justify-between px-4 sm:px-5">
        {/* Branding - Clean and minimal */}
        <BrandLogo size="sm" className="gap-3" />

        {/* Actions */}
        <div className="flex items-center gap-2">
          <ThemeToggle
            size="icon"
            className="h-10 w-10 rounded-2xl border border-border/60 bg-white/60 shadow-[0_18px_34px_-28px_hsl(var(--foreground)/0.18)] dark:border-white/[0.08] dark:bg-white/[0.04] dark:shadow-none"
          />

          {user && (
            <>
              {/* Leaderboard */}
              <Button
                variant="ghost"
                size="icon"
                className="h-10 w-10 rounded-2xl border border-border/60 bg-white/60 shadow-[0_18px_34px_-28px_hsl(var(--foreground)/0.18)] dark:border-white/[0.08] dark:bg-white/[0.04] dark:shadow-none"
                onClick={() => navigate("/leaderboard")}
              >
                <PhewTrophyIcon className="h-4.5 w-4.5" />
              </Button>

              {/* Notification Bell */}
              <Button
                variant="ghost"
                size="icon"
                className="relative h-10 w-10 rounded-2xl border border-border/60 bg-white/60 shadow-[0_18px_34px_-28px_hsl(var(--foreground)/0.18)] dark:border-white/[0.08] dark:bg-white/[0.04] dark:shadow-none"
                onClick={() => navigate("/notifications")}
              >
                <PhewBellIcon className="h-4.5 w-4.5" />
                {unreadCount > 0 && (
                  <span className="absolute -right-1 -top-1 flex min-w-[18px] items-center justify-center rounded-full border border-white/70 bg-primary px-1.5 py-0.5 text-[10px] font-extrabold text-primary-foreground shadow-[0_10px_20px_-14px_hsl(var(--primary)/0.75)] dark:border-black/40">
                    {unreadCount > 99 ? "99+" : unreadCount}
                  </span>
                )}
              </Button>

              <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" className="h-10 w-10 rounded-full border border-border/60 bg-white/60 p-0 shadow-[0_18px_34px_-28px_hsl(var(--foreground)/0.18)] ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 dark:border-white/[0.08] dark:bg-white/[0.04] dark:shadow-none">
                  <Avatar className="h-9 w-9 border border-border/70 transition-colors hover:border-primary/50">
                    <AvatarImage src={getAvatarUrl(user.id, user.image)} />
                    <AvatarFallback className="bg-muted text-muted-foreground text-xs">
                      {user.name?.charAt(0) || "?"}
                    </AvatarFallback>
                  </Avatar>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel className="font-normal">
                  <div className="flex flex-col space-y-1">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium leading-none">{user.username || user.name}</p>
                      <LevelBadge level={user.level} className="text-[10px] px-1.5 py-0" />
                    </div>
                    <p className="text-xs text-muted-foreground truncate">{user.email}</p>
                  </div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => navigate("/profile")} className="cursor-pointer">
                  <UserIcon className="mr-2 h-4 w-4" />
                  <span>Profile</span>
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => navigate("/profile?tab=settings")} className="cursor-pointer">
                  <Settings className="mr-2 h-4 w-4" />
                  <span>Settings</span>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={onLogout} className="cursor-pointer text-destructive focus:text-destructive">
                  <LogOut className="mr-2 h-4 w-4" />
                  <span>Log out</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            </>
          )}
        </div>
      </div>

      {/* Tab Bar */}
      <div className="mx-auto max-w-[780px] px-4 pb-3 sm:px-5">
        <nav className="app-tab-rail flex gap-1 relative">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              ref={(el) => {
                if (el) tabRefs.current.set(tab.id, el);
              }}
              onClick={() => onTabChange(tab.id)}
              className={cn(
                "relative z-10 rounded-[18px] px-5 py-2.5 text-sm font-semibold transition-colors",
                activeTab === tab.id
                  ? "text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {tab.label}
            </button>
          ))}
          {/* Animated indicator - thin and elegant */}
          <div
            className="absolute bottom-1.5 top-1.5 rounded-[18px] border border-primary/15 bg-[linear-gradient(180deg,hsl(0_0%_100%/0.95),hsl(37_34%_95%/0.9))] shadow-[0_18px_34px_-30px_hsl(var(--foreground)/0.16)] transition-all duration-300 ease-out dark:border-white/[0.08] dark:bg-[linear-gradient(180deg,rgba(18,20,26,0.96),rgba(11,13,18,0.98))] dark:shadow-none"
            style={{
              left: indicatorStyle.left,
              width: indicatorStyle.width,
            }}
          />
        </nav>
      </div>
    </header>
  );
}
