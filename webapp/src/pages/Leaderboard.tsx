import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { usePrivy } from "@privy-io/react-auth";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/ThemeToggle";
import { DailyGainersTable } from "@/components/leaderboard/DailyGainersTable";
import { TopUsersTable } from "@/components/leaderboard/TopUsersTable";
import { StatsOverview } from "@/components/leaderboard/StatsOverview";
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
import {
  ArrowLeft,
  Trophy,
  Users,
  BarChart3,
  Bell,
  LogOut,
  Settings,
  User as UserIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

type LeaderboardSection = "gainers" | "users" | "stats";

export default function Leaderboard() {
  const navigate = useNavigate();
  const { data: session } = useSession();
  const { signOut } = useAuth();
  const { logout: privyLogout } = usePrivy();

  // Fetch current user
  const { data: user } = useQuery({
    queryKey: ["currentUser"],
    queryFn: async () => {
      const data = await api.get<User>("/api/me");
      return data;
    },
    enabled: !!session?.user,
    staleTime: 30000,
    refetchOnWindowFocus: false,
    retry: false,
  });

  // Fetch unread notification count
  const { data: unreadData } = useQuery({
    queryKey: ["notifications", "unread-count"],
    queryFn: async () => {
      const response = await api.get<{ count: number }>("/api/notifications/unread-count");
      return response;
    },
    enabled: !!user,
    refetchOnWindowFocus: false,
    refetchInterval: () => {
      if (typeof document !== "undefined" && document.visibilityState !== "visible") {
        return false;
      }
      return 60000;
    },
    staleTime: 30000,
    retry: 1,
  });

  const unreadCount = unreadData?.count ?? 0;

  const handleLogout = async () => {
    await signOut();
    try {
      await privyLogout();
    } catch (error) {
      console.error("[Leaderboard] Privy logout failed:", error);
    }
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
            <div className="flex items-center gap-2">
              <Trophy className="h-5 w-5 text-primary" />
              <span className="font-bold text-lg">Leaderboard</span>
            </div>
          </div>

          {/* Right - Actions */}
          <div className="flex items-center gap-2">
            <ThemeToggle size="icon" className="h-8 w-8" />

            {user && (
              <>
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
              </>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-6">
        {/* Page Title */}
        <div className="mb-8">
          <h1 className="text-2xl md:text-3xl font-bold">Leaderboard</h1>
          <p className="text-muted-foreground mt-1">
            Top performers and platform stats
          </p>
        </div>

        {/* Content Grid */}
        <div className="space-y-8">
          {/* Daily Top Gainers Section */}
          <section>
            <div className="flex items-center gap-2 mb-4">
              <div className="p-2 rounded-lg bg-yellow-500/10">
                <Trophy className="h-5 w-5 text-yellow-500" />
              </div>
              <h2 className="text-xl font-semibold">Daily Top Gainers</h2>
            </div>
            <DailyGainersTable />
          </section>

          {/* Top Users Section */}
          <section>
            <div className="flex items-center gap-2 mb-4">
              <div className="p-2 rounded-lg bg-primary/10">
                <Users className="h-5 w-5 text-primary" />
              </div>
              <h2 className="text-xl font-semibold">Top Users (All Time)</h2>
            </div>
            <TopUsersTable />
          </section>

          {/* Platform Statistics Section */}
          <section>
            <div className="flex items-center gap-2 mb-4">
              <div className="p-2 rounded-lg bg-green-500/10">
                <BarChart3 className="h-5 w-5 text-green-500" />
              </div>
              <h2 className="text-xl font-semibold">Platform Stats</h2>
            </div>
            <StatsOverview />
          </section>
        </div>
      </main>
    </div>
  );
}
