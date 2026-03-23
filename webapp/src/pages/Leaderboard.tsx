import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ThemeToggle } from "@/components/ThemeToggle";
import { TopUsersTable } from "@/components/leaderboard/TopUsersTable";
import { LeaderboardStats } from "@/components/leaderboard/LeaderboardStats";
import { useSession, useAuth } from "@/lib/auth-client";
import { api } from "@/lib/api";
import { User } from "@/types";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { LevelBadge } from "@/components/feed/LevelBar";
import { getAvatarUrl } from "@/types";
import { readSessionCache, writeSessionCache } from "@/lib/session-cache";
import { QueryErrorBoundary } from "@/components/QueryErrorBoundary";
import { LivePortfolioDialog } from "@/components/account/LivePortfolioDialog";
import {
  ArrowLeft,
  Bell,
  LogOut,
  Settings,
  User as UserIcon,
  Wallet,
} from "lucide-react";

const NOTIFICATIONS_UNREAD_CACHE_PREFIX = "phew.notifications.unread";
const NOTIFICATIONS_UNREAD_CACHE_TTL_MS = 60_000;

type Period = 'day' | 'week';

export default function Leaderboard() {
  const navigate = useNavigate();
  const [period, setPeriod] = useState<Period>('week');
  const [isPortfolioOpen, setIsPortfolioOpen] = useState<boolean>(false);
  const { data: session } = useSession();
  const { signOut, hasLiveSession } = useAuth();
  const unreadCacheKey = session?.user?.id
    ? `${NOTIFICATIONS_UNREAD_CACHE_PREFIX}:${session.user.id}`
    : NOTIFICATIONS_UNREAD_CACHE_PREFIX;
  const cachedUnreadCount = readSessionCache<number>(unreadCacheKey, NOTIFICATIONS_UNREAD_CACHE_TTL_MS);
  const unreadQueryKey = ["notifications", "unread-count", session?.user?.id ?? "anonymous"] as const;
  const sessionBackedUser = session?.user
    ? {
        id: session.user.id,
        name: session.user.name,
        email: session.user.email,
        image: session.user.image ?? null,
        walletAddress: session.user.walletAddress ?? null,
        username: session.user.username ?? null,
        level: session.user.level ?? 0,
        xp: session.user.xp ?? 0,
        bio: session.user.bio ?? null,
        isAdmin: session.user.isAdmin ?? false,
        isVerified: session.user.isVerified,
        createdAt: session.user.createdAt ?? new Date(0).toISOString(),
      }
    : null;

  // Fetch current user
  const { data: user } = useQuery({
    queryKey: ["currentUser", session?.user?.id ?? "anonymous"],
    queryFn: async () => {
      const data = await api.get<User>("/api/me");
      return data;
    },
    initialData: sessionBackedUser ?? undefined,
    enabled: !!session?.user && hasLiveSession,
    gcTime: 15 * 60 * 1000,
    staleTime: 5 * 60 * 1000,
    refetchOnMount: sessionBackedUser ? false : "always",
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: false,
  });

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
    refetchInterval: () => {
      if (typeof document !== "undefined" && document.visibilityState !== "visible") {
        return false;
      }
      return 90_000;
    },
    staleTime: 45_000,
    retry: 0,
  });

  const unreadCount = hasLiveSession ? (unreadData?.count ?? 0) : 0;

  const handleLogout = async () => {
    await signOut();
    navigate("/login");
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-background/80 backdrop-blur-xl border-b border-border">
        <div className="max-w-4xl mx-auto px-4 h-14 flex items-center justify-between">
          {/* Left - Back and Title */}
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={() => navigate("/")}
            >
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <span className="font-semibold text-base">Leaderboard</span>
          </div>

          {/* Right - Actions */}
          <div className="flex items-center gap-2">
            <ThemeToggle size="icon" className="h-8 w-8" />

            {user ? (
              <>
                {/* Notification Bell */}
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 relative"
                  onClick={() => navigate("/notifications")}
                >
                  <Bell className="h-4 w-4" />
                  {unreadCount > 0 ? (
                    <span className="absolute -top-0.5 -right-0.5 flex items-center justify-center min-w-[16px] h-4 px-1 text-[10px] font-bold text-primary-foreground bg-primary rounded-full">
                      {unreadCount > 99 ? "99+" : unreadCount}
                    </span>
                  ) : null}
                </Button>

                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      className="h-8 w-8 rounded-full p-0 ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                    >
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
                          <p className="text-sm font-medium leading-none">
                            {user.username || user.name}
                          </p>
                          <LevelBadge level={user.level} className="text-[10px] px-1.5 py-0" />
                        </div>
                        <p className="text-xs text-muted-foreground truncate">{user.email}</p>
                      </div>
                    </DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      onClick={() => navigate("/profile")}
                      className="cursor-pointer"
                    >
                      <UserIcon className="mr-2 h-4 w-4" />
                      <span>Profile</span>
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onSelect={(event) => {
                        event.preventDefault();
                        setIsPortfolioOpen(true);
                      }}
                      className="cursor-pointer"
                    >
                      <Wallet className="mr-2 h-4 w-4" />
                      <span>Portfolio</span>
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => navigate("/profile?tab=settings")}
                      className="cursor-pointer"
                    >
                      <Settings className="mr-2 h-4 w-4" />
                      <span>Settings</span>
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      onClick={handleLogout}
                      className="cursor-pointer text-destructive focus:text-destructive"
                    >
                      <LogOut className="mr-2 h-4 w-4" />
                      <span>Log out</span>
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
                <LivePortfolioDialog
                  open={isPortfolioOpen}
                  onOpenChange={setIsPortfolioOpen}
                  walletAddress={user.walletAddress ?? null}
                />
              </>
            ) : null}
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-6 space-y-6">
        {/* Page header */}
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Leaderboard</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Top traders ranked by level, activity, and win rate
          </p>
        </div>

        {/* Day / Week toggle */}
        <Tabs value={period} onValueChange={(v) => setPeriod(v as Period)}>
          <TabsList className="h-9 p-1">
            <TabsTrigger value="day" className="px-5 text-sm">
              Day
            </TabsTrigger>
            <TabsTrigger value="week" className="px-5 text-sm">
              Week
            </TabsTrigger>
          </TabsList>
        </Tabs>

        {/* Unified leaderboard */}
        <QueryErrorBoundary sectionName="Leaderboard">
          <TopUsersTable enabled period={period} />
        </QueryErrorBoundary>

        {/* Bottom stats bar */}
        <LeaderboardStats />
      </main>
    </div>
  );
}
