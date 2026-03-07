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
import { LevelBadge } from "./LevelBar";
import { LogOut, Settings, User as UserIcon, Bell, Trophy } from "lucide-react";
import { cn } from "@/lib/utils";

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

export function FeedHeader({ user, activeTab, onTabChange, onLogout }: FeedHeaderProps) {
  const navigate = useNavigate();
  const { hasLiveSession } = useAuth();
  const tabRefs = useRef<Map<FeedTab, HTMLButtonElement>>(new Map());
  const [indicatorStyle, setIndicatorStyle] = useState({ left: 0, width: 0 });

  // Fetch unread notification count
  const { data: unreadData } = useQuery({
    queryKey: ["notifications", "unread-count"],
    queryFn: async () => {
      const response = await api.get<{ count: number }>("/api/notifications/unread-count");
      return response;
    },
    enabled: !!user && hasLiveSession,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    refetchInterval: () => {
      if (typeof document !== "undefined" && document.visibilityState !== "visible") {
        return false;
      }
      return 30000;
    },
    staleTime: 10000,
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
    <header className="sticky top-0 z-50 bg-background/80 backdrop-blur-xl">
      {/* Top Row - Branding & Actions */}
      <div className="max-w-2xl mx-auto px-4 h-14 flex items-center justify-between">
        {/* Branding - Clean and minimal */}
        <BrandLogo size="sm" className="gap-2.5" />

        {/* Actions */}
        <div className="flex items-center gap-2">
          <ThemeToggle size="icon" className="h-8 w-8" />

          {user && (
            <>
              {/* Leaderboard */}
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={() => navigate("/leaderboard")}
              >
                <Trophy className="h-4 w-4" />
              </Button>

              {/* Notification Bell */}
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 relative"
                onClick={() => navigate("/notifications")}
              >
                <Bell className="h-4 w-4" />
                {unreadCount > 0 && (
                  <span className="absolute -top-0.5 -right-0.5 flex items-center justify-center min-w-[16px] h-4 px-1 text-[10px] font-bold text-primary-foreground bg-primary rounded-full">
                    {unreadCount > 99 ? "99+" : unreadCount}
                  </span>
                )}
              </Button>

              <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" className="h-8 w-8 rounded-full p-0 ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">
                  <Avatar className="h-8 w-8 border border-border hover:border-primary/50 transition-colors">
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
      <div className="max-w-2xl mx-auto px-4">
        <nav className="flex gap-1 relative">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              ref={(el) => {
                if (el) tabRefs.current.set(tab.id, el);
              }}
              onClick={() => onTabChange(tab.id)}
              className={cn(
                "relative px-5 py-3 text-sm font-medium transition-colors",
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
            className="absolute bottom-0 h-[2px] bg-primary transition-all duration-300 ease-out"
            style={{
              left: indicatorStyle.left,
              width: indicatorStyle.width,
            }}
          />
        </nav>
      </div>
      {/* Subtle gradient border */}
      <div className="h-px bg-gradient-to-r from-transparent via-border to-transparent" />
    </header>
  );
}
