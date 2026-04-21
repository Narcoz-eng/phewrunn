import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { useSession, useAuth } from "@/lib/auth-client";
import { api } from "@/lib/api";
import { getAvatarUrl, type User } from "@/types";
import { buildProfilePath } from "@/lib/profile-path";
import { readSessionCache, writeSessionCache } from "@/lib/session-cache";
import { DenseLeaderboardView } from "@/components/experience/TraderPerformanceView";
import {
  buildLeaderboardRowsVm,
  buildPinnedRankVm,
  type LeaderboardPinnedRankVM,
} from "@/viewmodels/trader-performance";
import { cn } from "@/lib/utils";
import { ArrowLeft, House, Trophy, UserRound } from "lucide-react";

const NOTIFICATIONS_UNREAD_CACHE_PREFIX = "phew.notifications.unread";
const NOTIFICATIONS_UNREAD_CACHE_TTL_MS = 60_000;
const TOP_USERS_CACHE_TTL_MS = 10 * 60_000;
type PerformancePeriod = "7d" | "30d" | "all";

type PerformanceLeaderboardEntry = {
  rank: number;
  user: {
    id: string;
    username: string | null;
    name: string;
    image: string | null;
    isVerified?: boolean;
  };
  performance: {
    avgRoi: number | null;
    winRate: number | null;
    trustScore: number | null;
    callsCount: number;
    firstCallCount: number;
  };
  recentTokens: Array<{
    address: string;
    symbol: string | null;
    image: string | null;
  }>;
};

type TopUsersResponse = {
  data: PerformanceLeaderboardEntry[];
};

function buildTopUsersCacheKey(period: PerformancePeriod): string {
  return `phew.leaderboard.performance:v1:${period}`;
}

export default function Leaderboard() {
  const navigate = useNavigate();
  const { data: session } = useSession();
  const { hasLiveSession } = useAuth();
  const [period, setPeriod] = useState<PerformancePeriod>("30d");

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

  const { data: currentUser } = useQuery({
    queryKey: ["currentUser", session?.user?.id ?? "anonymous"],
    queryFn: async () => await api.get<User>("/api/me"),
    initialData: sessionBackedUser ?? undefined,
    enabled: !!session?.user && hasLiveSession,
    staleTime: 5 * 60 * 1000,
    gcTime: 15 * 60 * 1000,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: false,
  });

  const topUsersCacheKey = buildTopUsersCacheKey(period);
  const cachedTopUsers = readSessionCache<TopUsersResponse>(topUsersCacheKey, TOP_USERS_CACHE_TTL_MS);
  const { data, isLoading, isFetching } = useQuery({
    queryKey: ["leaderboard", "terminal-performance", period],
    queryFn: async () => {
      const response = await api.raw(`/api/leaderboard/performance?period=${period}&limit=100`);
      if (!response.ok) {
        throw new Error(`Failed to load leaderboard: ${response.status}`);
      }
      const payload = (await response.json()) as TopUsersResponse;
      if (payload.data.length > 0) {
        writeSessionCache(topUsersCacheKey, payload);
      }
      return payload;
    },
    initialData: cachedTopUsers ?? undefined,
    placeholderData: (previous) => previous ?? cachedTopUsers ?? undefined,
    staleTime: 60_000,
    gcTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: 0,
  });

  const rows = useMemo(
    () => buildLeaderboardRowsVm(data?.data ?? []),
    [data?.data]
  );

  const pinnedRank = useMemo<LeaderboardPinnedRankVM | null>(() => {
    const exact = buildPinnedRankVm(data?.data ?? [], currentUser?.id ?? null);
    if (exact) return exact;
    if (!currentUser) return null;
    return {
      title: "Your rank",
      rankLabel: "Top 100?",
      valueLabel: "Building record",
      valueTone: "neutral",
      avatarUrl: getAvatarUrl(currentUser.id, currentUser.image),
      avatarFallback: (currentUser.name || currentUser.username || "?").charAt(0).toUpperCase(),
    };
  }, [currentUser, data?.data]);

  const unreadCacheKey = session?.user?.id
    ? `${NOTIFICATIONS_UNREAD_CACHE_PREFIX}:${session.user.id}`
    : NOTIFICATIONS_UNREAD_CACHE_PREFIX;
  const cachedUnreadCount = readSessionCache<number>(unreadCacheKey, NOTIFICATIONS_UNREAD_CACHE_TTL_MS);
  useQuery({
    queryKey: ["notifications", "unread-count", session?.user?.id ?? "anonymous"],
    queryFn: async () => {
      const response = await api.get<{ count: number }>("/api/notifications/unread-count");
      writeSessionCache(unreadCacheKey, response.count);
      return response;
    },
    initialData: cachedUnreadCount !== null ? { count: cachedUnreadCount } : undefined,
    enabled: !!currentUser && hasLiveSession,
    refetchOnWindowFocus: false,
    staleTime: 45_000,
    retry: 0,
  });

  return (
    <div className="terminal-screen min-h-screen text-white">
      <header className="mx-auto flex max-w-5xl items-center justify-between px-4 pt-6 sm:px-6">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="icon"
            className="h-10 w-10 rounded-2xl border border-white/8 bg-white/5 text-white hover:bg-white/10"
            onClick={() => navigate("/")}
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <div className="text-xs uppercase tracking-[0.22em] text-white/38">Terminal ranking</div>
            <div className="text-lg font-semibold text-white">Leaderboard</div>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 pb-32 pt-6 sm:px-6">
        {isLoading ? (
          <div className="terminal-card px-6 py-10 text-white/56">Loading leaderboard...</div>
        ) : (
          <div className={cn("transition-opacity", isFetching && "opacity-80")}>
            <DenseLeaderboardView
              eyebrow="Performance board"
              title="Trader Rankings"
              subtitle="Backend-ranked call performance with live-linked trader profiles."
              pinnedRank={pinnedRank}
              timeframeTabs={[
                {
                  key: "7d",
                  label: "7d",
                  active: period === "7d",
                  onSelect: () => setPeriod("7d"),
                },
                {
                  key: "30d",
                  label: "30d",
                  active: period === "30d",
                  onSelect: () => setPeriod("30d"),
                },
                {
                  key: "all",
                  label: "All",
                  active: period === "all",
                  onSelect: () => setPeriod("all"),
                },
              ]}
              modeTabs={[]}
              rows={rows}
              onSelectRow={(row) => {
                const source = data?.data.find((item) => item.user.id === row.id);
                navigate(buildProfilePath(row.id, source?.user.username ?? null));
              }}
            />
          </div>
        )}
      </main>

      <div className="pointer-events-none fixed inset-x-0 bottom-5 z-50 flex justify-center px-4">
        <div className="terminal-nav-pill pointer-events-auto flex items-center gap-2 px-2 py-2">
          <Button
            type="button"
            variant="ghost"
            onClick={() => navigate("/")}
            className="h-14 min-w-[72px] rounded-[26px] text-white/58 hover:bg-white/6 hover:text-white"
          >
            <House className="h-5 w-5" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            onClick={() => navigate("/leaderboard")}
            className="h-14 min-w-[88px] rounded-[26px] bg-white/10 text-white hover:bg-white/10"
          >
            <Trophy className="h-5 w-5" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            onClick={() => navigate("/profile")}
            className="h-14 min-w-[72px] rounded-[26px] text-white/58 hover:bg-white/6 hover:text-white"
          >
            <UserRound className="h-5 w-5" />
          </Button>
        </div>
      </div>
    </div>
  );
}
