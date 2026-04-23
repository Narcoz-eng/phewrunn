import { useQuery } from "@tanstack/react-query";
import { Bell, MessageSquare, Search, Trophy, Waves, Zap } from "lucide-react";
import { api } from "@/lib/api";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import type { DiscoveryFeedSidebarResponse, Post } from "@/types";
import { cn } from "@/lib/utils";

type FeedPreviewResponse = {
  items: Post[];
};

type LeaderboardPreviewEntry = {
  rank: number;
  user: {
    id: string;
    username: string | null;
    name: string;
    image: string | null;
  };
  performance: {
    avgRoi: number | null;
    winRate: number | null;
    callsCount: number;
  };
};

type LeaderboardPreviewResponse = {
  data: LeaderboardPreviewEntry[];
};

function formatCompact(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "--";
  return new Intl.NumberFormat("en-US", {
    notation: Math.abs(value) >= 1_000 ? "compact" : "standard",
    maximumFractionDigits: 1,
  }).format(value);
}

function formatSignedPercent(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "--";
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}

function formatTimeAgo(value: string | null | undefined) {
  if (!value) return "";
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return "";
  const diffMs = Date.now() - timestamp;
  if (diffMs < 60_000) return "now";
  if (diffMs < 3_600_000) return `${Math.max(1, Math.floor(diffMs / 60_000))}m`;
  if (diffMs < 86_400_000) return `${Math.max(1, Math.floor(diffMs / 3_600_000))}h`;
  return `${Math.max(1, Math.floor(diffMs / 86_400_000))}d`;
}

function resolvePostHeadline(post: Post) {
  if (post.title?.trim()) return post.title.trim();
  if (post.ticker?.trim()) return `$${post.ticker.trim()}`;
  return post.content.trim().slice(0, 90) || "Signal";
}

function resolvePostBody(post: Post) {
  if (post.content.trim()) return post.content.trim();
  if (post.title?.trim()) return post.title.trim();
  return "No body provided.";
}

export function LivePlatformPreview() {
  const feedQuery = useQuery<FeedPreviewResponse>({
    queryKey: ["login-preview", "feed"],
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      const response = await api.raw("/api/feed/latest?limit=3", { cache: "default" });
      if (!response.ok) {
        throw new Error(`Feed preview failed (${response.status})`);
      }
      const payload = (await response.json().catch(() => null)) as { data?: FeedPreviewResponse } | null;
      return {
        items: Array.isArray(payload?.data?.items) ? payload!.data!.items : [],
      };
    },
  });

  const sidebarQuery = useQuery<DiscoveryFeedSidebarResponse>({
    queryKey: ["login-preview", "sidebar"],
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    queryFn: () => api.get<DiscoveryFeedSidebarResponse>("/api/discovery/feed-sidebar"),
  });

  const leaderboardQuery = useQuery<LeaderboardPreviewResponse>({
    queryKey: ["login-preview", "leaderboard"],
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      const response = await api.raw("/api/leaderboard/performance?period=30d&limit=5", {
        cache: "default",
      });
      if (!response.ok) {
        throw new Error(`Leaderboard preview failed (${response.status})`);
      }
      return (await response.json()) as LeaderboardPreviewResponse;
    },
  });

  const previewPosts = feedQuery.data?.items ?? [];
  const discovery = sidebarQuery.data;
  const leaders = leaderboardQuery.data?.data ?? [];

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(169,255,52,0.18),transparent_24%),radial-gradient(circle_at_top_right,rgba(45,212,191,0.12),transparent_28%),linear-gradient(180deg,rgba(4,8,10,0.92),rgba(4,7,10,0.98))]" />
      <div className="absolute inset-0 scale-[1.06] blur-[18px] opacity-[0.96]">
        <div className="grid min-h-full grid-cols-[220px_minmax(0,1fr)_320px] gap-5 p-8">
          <aside className="rounded-[34px] border border-white/8 bg-[linear-gradient(180deg,rgba(6,10,13,0.98),rgba(3,7,10,0.98))] p-5">
            <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-lime-300/82">
              PHEW.RUN
            </div>
            <div className="mt-8 space-y-2">
              {["Feed", "Terminal", "X Raids", "Bundle Checker", "Leaderboard", "Communities"].map(
                (item, index) => (
                  <div
                    key={item}
                    className={cn(
                      "rounded-[18px] border px-4 py-3 text-sm",
                      index === 0
                        ? "border-lime-300/20 bg-lime-300/10 text-lime-200"
                        : "border-white/8 bg-white/[0.03] text-white/58"
                    )}
                  >
                    {item}
                  </div>
                )
              )}
            </div>
          </aside>

          <main className="space-y-5">
            <section className="rounded-[30px] border border-white/8 bg-[linear-gradient(180deg,rgba(8,12,16,0.98),rgba(4,7,10,0.98))] px-5 py-4">
              <div className="flex items-center gap-3">
                <div className="flex-1 rounded-[18px] border border-white/8 bg-white/[0.03] px-4 py-3 text-sm text-white/42">
                  <Search className="mr-2 inline h-4 w-4" />
                  Search tokens, users, raids...
                </div>
                <div className="flex h-11 w-11 items-center justify-center rounded-[16px] border border-white/8 bg-white/[0.03] text-white/60">
                  <Bell className="h-4 w-4" />
                </div>
                <div className="flex h-11 w-11 items-center justify-center rounded-[16px] border border-white/8 bg-white/[0.03] text-white/60">
                  <MessageSquare className="h-4 w-4" />
                </div>
              </div>

              <div className="mt-4 grid gap-3 md:grid-cols-3">
                {(discovery?.topGainers.slice(0, 3) ?? []).map((item) => (
                  <div key={item.address} className="rounded-[20px] border border-white/8 bg-white/[0.03] px-4 py-4">
                    <div className="text-[11px] uppercase tracking-[0.16em] text-white/36">
                      {item.symbol || item.name || item.address.slice(0, 6)}
                    </div>
                    <div className="mt-2 text-lg font-semibold text-white">
                      {formatSignedPercent(item.priceChange24hPct)}
                    </div>
                    <div className="mt-1 text-xs text-white/44">
                      Vol {formatCompact(item.volume24h)} • Liq {formatCompact(item.liquidity)}
                    </div>
                  </div>
                ))}
              </div>
            </section>

            {previewPosts.slice(0, 2).map((post) => (
              <section
                key={post.id}
                className="rounded-[30px] border border-white/8 bg-[linear-gradient(180deg,rgba(7,12,15,0.98),rgba(4,7,9,0.98))] p-5"
              >
                <div className="flex items-center justify-between gap-4">
                  <div className="flex min-w-0 items-center gap-3">
                    <Avatar className="h-11 w-11 border border-white/10">
                      <AvatarImage src={post.author?.image ?? undefined} />
                      <AvatarFallback className="bg-white/[0.04] text-white">
                        {(post.author?.username || post.author?.name || "P").charAt(0)}
                      </AvatarFallback>
                    </Avatar>
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold text-white">
                        {post.author?.username || post.author?.name || "Trader"}
                      </div>
                      <div className="text-xs text-white/42">{formatTimeAgo(post.createdAt)}</div>
                    </div>
                  </div>
                  {post.confidenceLabel ? (
                    <span className="rounded-full border border-lime-300/18 bg-lime-300/8 px-3 py-1 text-[11px] text-lime-200">
                      {post.confidenceLabel}
                    </span>
                  ) : null}
                </div>
                <div className="mt-4 text-[1.65rem] font-semibold tracking-[-0.04em] text-white">
                  {resolvePostHeadline(post)}
                </div>
                <p className="mt-3 text-sm leading-6 text-white/58">{resolvePostBody(post)}</p>
                <div className="mt-4 grid gap-3 sm:grid-cols-4">
                  <div className="rounded-[18px] border border-white/8 bg-white/[0.03] px-3 py-3">
                    <div className="text-[10px] uppercase tracking-[0.14em] text-white/34">Token</div>
                    <div className="mt-2 text-sm font-semibold text-white">
                      {post.tokenSymbol ? `$${post.tokenSymbol}` : post.contractAddress?.slice(0, 6) || "--"}
                    </div>
                  </div>
                  <div className="rounded-[18px] border border-white/8 bg-white/[0.03] px-3 py-3">
                    <div className="text-[10px] uppercase tracking-[0.14em] text-white/34">Conviction</div>
                    <div className="mt-2 text-sm font-semibold text-white">
                      {typeof post.confidenceScore === "number" ? `${post.confidenceScore.toFixed(0)} / 100` : "--"}
                    </div>
                  </div>
                  <div className="rounded-[18px] border border-white/8 bg-white/[0.03] px-3 py-3">
                    <div className="text-[10px] uppercase tracking-[0.14em] text-white/34">Comments</div>
                    <div className="mt-2 text-sm font-semibold text-white">
                      {formatCompact(post.threadCount ?? post._count?.comments ?? 0)}
                    </div>
                  </div>
                  <div className="rounded-[18px] border border-white/8 bg-white/[0.03] px-3 py-3">
                    <div className="text-[10px] uppercase tracking-[0.14em] text-white/34">Direction</div>
                    <div className="mt-2 text-sm font-semibold text-white">
                      {post.direction || post.postType || "--"}
                    </div>
                  </div>
                </div>
              </section>
            ))}
          </main>

          <aside className="space-y-5">
            <section className="rounded-[28px] border border-white/8 bg-[linear-gradient(180deg,rgba(8,12,18,0.96),rgba(5,9,13,0.99))] p-5">
              <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-white/38">
                <Waves className="h-4 w-4 text-lime-300" />
                Live raids
              </div>
              <div className="mt-4 space-y-3">
                {discovery?.liveRaids.slice(0, 2).map((raid) => (
                  <div key={raid.id} className="rounded-[18px] border border-white/8 bg-white/[0.03] px-4 py-4">
                    <div className="text-sm font-semibold text-white">{raid.objective}</div>
                    <div className="mt-2 flex items-center justify-between gap-3 text-xs text-white/44">
                      <span>{formatCompact(raid.participantCount)} joined</span>
                      <span>{formatCompact(raid.postedCount)} posted</span>
                    </div>
                  </div>
                )) ?? null}
              </div>
            </section>

            <section className="rounded-[28px] border border-white/8 bg-[linear-gradient(180deg,rgba(8,12,18,0.96),rgba(5,9,13,0.99))] p-5">
              <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-white/38">
                <Trophy className="h-4 w-4 text-amber-300" />
                Leaderboard
              </div>
              <div className="mt-4 space-y-3">
                {leaders.slice(0, 5).map((entry) => (
                  <div key={entry.user.id} className="flex items-center justify-between gap-3 rounded-[18px] border border-white/8 bg-white/[0.03] px-3 py-3">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold text-white">
                        {entry.user.username || entry.user.name}
                      </div>
                      <div className="text-xs text-white/42">
                        {entry.performance.callsCount} calls • {typeof entry.performance.winRate === "number" ? `${entry.performance.winRate.toFixed(1)}%` : "--"} win
                      </div>
                    </div>
                    <div className="text-sm font-semibold text-lime-300">
                      {formatSignedPercent(entry.performance.avgRoi)}
                    </div>
                  </div>
                ))}
              </div>
            </section>

            <section className="rounded-[28px] border border-white/8 bg-[linear-gradient(180deg,rgba(8,12,18,0.96),rgba(5,9,13,0.99))] p-5">
              <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-white/38">
                <Zap className="h-4 w-4 text-cyan-300" />
                AI watchlist
              </div>
              <div className="mt-4 space-y-3">
                {discovery?.trendingCalls.slice(0, 4).map((call) => (
                  <div key={call.id} className="rounded-[18px] border border-white/8 bg-white/[0.03] px-4 py-3">
                    <div className="text-sm font-semibold text-white">
                      {call.title || (call.ticker ? `$${call.ticker}` : "Call")}
                    </div>
                    <div className="mt-1 text-xs text-white/42">
                      {formatSignedPercent(call.roiCurrentPct)} current • {call.callsCount} calls
                    </div>
                  </div>
                ))}
              </div>
            </section>
          </aside>
        </div>
      </div>
      <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(2,5,7,0.36),rgba(2,5,7,0.76))]" />
    </div>
  );
}
