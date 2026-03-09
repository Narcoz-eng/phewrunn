import { useMemo } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Post, PostAuthor, ReactionCounts, formatMarketCap, formatTimeAgo, getAvatarUrl } from "@/types";
import { Button } from "@/components/ui/button";
import { ArrowLeft, AlertCircle, BarChart3, Coins, ShieldAlert, TrendingUp, Users } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { PostCard } from "@/components/feed/PostCard";
import { TokenScanningState } from "@/components/feed/TokenScanningState";
import { cn } from "@/lib/utils";
import { useSession } from "@/lib/auth-client";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { toast } from "sonner";

type TokenChartPoint = {
  timestamp: string;
  marketCap: number | null;
  liquidity: number | null;
  volume24h: number | null;
  holderCount: number | null;
  sentimentScore: number | null;
  confidenceScore: number | null;
};

type TokenTrader = PostAuthor & {
  callsCount: number;
  avgConfidenceScore: number;
  bestRoiPct: number;
};

type TokenRisk = {
  tokenRiskScore: number | null;
  bundleRiskLabel: string | null;
  largestHolderPct: number | null;
  top10HolderPct: number | null;
  bundledWalletCount: number | null;
  estimatedBundledSupplyPct: number | null;
  deployerSupplyPct: number | null;
  holderCount: number | null;
};

type TokenBundleCluster = {
  id?: string;
  clusterLabel: string;
  walletCount: number;
  estimatedSupplyPct: number;
  evidenceJson?: unknown;
};

type TokenTimelineEvent = {
  id: string;
  eventType: string;
  timestamp: string;
  marketCap: number | null;
  liquidity: number | null;
  volume: number | null;
  traderId: string | null;
  postId: string | null;
  metadata?: {
    traderHandle?: string | null;
    traderName?: string | null;
    timingTier?: string | null;
    confidenceScore?: number | null;
  } | null;
};

type TokenPageData = {
  id: string;
  address: string;
  chainType: string;
  symbol: string | null;
  name: string | null;
  imageUrl: string | null;
  dexscreenerUrl: string | null;
  liquidity: number | null;
  volume24h: number | null;
  holderCount: number | null;
  largestHolderPct: number | null;
  top10HolderPct: number | null;
  deployerSupplyPct: number | null;
  bundledWalletCount: number | null;
  estimatedBundledSupplyPct: number | null;
  bundleRiskLabel: string | null;
  tokenRiskScore: number | null;
  sentimentScore: number | null;
  radarScore: number | null;
  confidenceScore: number | null;
  hotAlphaScore: number | null;
  earlyRunnerScore: number | null;
  highConvictionScore: number | null;
  isEarlyRunner: boolean;
  isFollowing: boolean;
  earlyRunnerReasons?: string[];
  bundleClusters: TokenBundleCluster[];
  chart: TokenChartPoint[];
  callsCount: number;
  distinctTraders: number;
  topTraders: TokenTrader[];
  sentiment: {
    score: number;
    reactions: ReactionCounts;
    bullishPct: number;
    bearishPct: number;
  };
  risk: TokenRisk;
  timeline: TokenTimelineEvent[];
  recentCalls: Post[];
};

function formatPct(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "N/A";
  return `${value.toFixed(1)}%`;
}

function scoreTone(value: number | null | undefined): string {
  const score = typeof value === "number" && Number.isFinite(value) ? value : 0;
  if (score >= 75) return "text-gain";
  if (score >= 55) return "text-foreground";
  return "text-muted-foreground";
}

function riskTone(label: string | null | undefined): string {
  if (label === "Clean") return "border-gain/30 bg-gain/10 text-gain";
  if (label === "Moderate Bundling") return "border-amber-400/35 bg-amber-400/10 text-amber-600 dark:text-amber-300";
  return "border-loss/30 bg-loss/10 text-loss";
}

export default function TokenPage() {
  const { tokenAddress } = useParams<{ tokenAddress: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: session, canPerformAuthenticatedWrites } = useSession();

  const {
    data: token,
    isLoading,
    error,
  } = useQuery({
    queryKey: ["token-page", tokenAddress],
    queryFn: async () => {
      if (!tokenAddress) throw new Error("Token address is required");
      return api.get<TokenPageData>(`/api/tokens/${tokenAddress}`);
    },
    enabled: !!tokenAddress,
    staleTime: 20_000,
    refetchOnWindowFocus: false,
  });

  const chartData = useMemo(
    () =>
      (token?.chart ?? []).map((point) => ({
        ...point,
        label: new Date(point.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      })),
    [token?.chart]
  );

  const followMutation = useMutation({
    mutationFn: async () => {
      if (!tokenAddress) throw new Error("Token address is required");
      if (!session?.user) throw new Error("Sign in to follow tokens");
      if (!canPerformAuthenticatedWrites) throw new Error("Signing you in...");
      if (token?.isFollowing) {
        return api.delete<{ following: boolean }>(`/api/tokens/${tokenAddress}/follow`);
      }
      return api.post<{ following: boolean }>(`/api/tokens/${tokenAddress}/follow`);
    },
    onSuccess: (response) => {
      queryClient.setQueryData<TokenPageData | undefined>(["token-page", tokenAddress], (current) =>
        current ? { ...current, isFollowing: response.following } : current
      );
      toast.success(response.following ? "Token followed" : "Token unfollowed");
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Failed to update token follow");
    },
  });

  return (
    <div className="min-h-screen bg-background">
      <header className="app-topbar">
        <div className="mx-auto flex h-[4.4rem] max-w-[980px] items-center gap-3 px-4 sm:px-5">
          <Button
            variant="ghost"
            size="icon"
            className="h-10 w-10 rounded-2xl border border-border/60 bg-white/60 shadow-[0_18px_34px_-28px_hsl(var(--foreground)/0.18)] dark:border-white/[0.08] dark:bg-white/[0.04] dark:shadow-none"
            onClick={() => navigate(-1)}
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <div className="text-[10px] font-black uppercase tracking-[0.22em] text-primary/80">Phew Ultra</div>
            <h1 className="font-semibold text-lg">Token Lab</h1>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[980px] px-4 pb-10 pt-5 sm:px-5">
        {isLoading ? (
          <TokenScanningState
            address={tokenAddress}
            title="Opening Phew Ultra Token Lab"
            subtitle="We are mapping liquidity, community sentiment, holder concentration, bundle risk, and conviction signals for this token."
          />
        ) : error || !token ? (
          <div className="app-empty-state min-h-[360px]">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-destructive/10">
              <AlertCircle className="h-8 w-8 text-destructive" />
            </div>
            <p className="text-lg font-semibold text-foreground">Token not found</p>
            <p className="text-sm text-muted-foreground">
              We could not load token intelligence for this address.
            </p>
          </div>
        ) : (
          <div className="space-y-5">
            <section className="app-surface p-5 sm:p-6">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div className="flex items-center gap-4">
                  <div className="flex h-16 w-16 items-center justify-center overflow-hidden rounded-full border border-border/60 bg-secondary">
                    {token.imageUrl ? (
                      <img src={token.imageUrl} alt={token.symbol ?? token.name ?? "Token"} className="h-full w-full object-cover" />
                    ) : (
                      <Coins className="h-7 w-7 text-primary" />
                    )}
                  </div>
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-2xl font-bold text-foreground">
                        {token.symbol || token.name || token.address.slice(0, 8)}
                      </h2>
                      <span className={cn("rounded-full border px-3 py-1 text-xs font-semibold", riskTone(token.bundleRiskLabel))}>
                        {token.bundleRiskLabel || "Unknown Risk"}
                      </span>
                      {token.isEarlyRunner ? (
                        <span className="rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">
                          Early Runner
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-1 break-all text-xs text-muted-foreground">{token.address}</p>
                    {token.earlyRunnerReasons?.length ? (
                      <div className="mt-3 flex flex-wrap gap-2">
                        {token.earlyRunnerReasons.map((reason) => (
                          <span key={reason} className="rounded-full border border-border/60 bg-secondary px-3 py-1 text-[11px] text-muted-foreground">
                            {reason}
                          </span>
                        ))}
                      </div>
                    ) : null}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  {[
                    { label: "Confidence", value: token.confidenceScore },
                    { label: "Hot Alpha", value: token.hotAlphaScore },
                    { label: "Early Runner", value: token.earlyRunnerScore },
                    { label: "High Conviction", value: token.highConvictionScore },
                  ].map((metric) => (
                    <div key={metric.label} className="rounded-[20px] border border-border/60 bg-white/55 p-3 shadow-[inset_0_1px_0_hsl(0_0%_100%/0.7)] dark:bg-white/[0.03] dark:shadow-none">
                      <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">{metric.label}</div>
                      <div className={cn("mt-2 text-2xl font-bold", scoreTone(metric.value))}>
                        {typeof metric.value === "number" ? `${metric.value.toFixed(0)}%` : "N/A"}
                      </div>
                    </div>
                  ))}
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant={token.isFollowing ? "outline" : "default"}
                    onClick={() => followMutation.mutate()}
                    disabled={followMutation.isPending}
                  >
                    {token.isFollowing ? "Following token" : "Follow token"}
                  </Button>
                </div>
              </div>
            </section>

            <section className="grid gap-5 lg:grid-cols-[1.35fr_0.65fr]">
              <div className="app-surface p-5 sm:p-6">
                <div className="mb-4 flex items-center justify-between">
                  <div>
                    <h3 className="text-lg font-semibold text-foreground">Market + confidence chart</h3>
                    <p className="text-sm text-muted-foreground">Snapshots from the token intelligence engine</p>
                  </div>
                  <div className="rounded-full border border-border/60 bg-secondary px-3 py-1 text-xs text-muted-foreground">
                    <BarChart3 className="mr-1 inline h-3.5 w-3.5" />
                    {chartData.length} points
                  </div>
                </div>
                <div className="h-[320px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={chartData}>
                      <defs>
                        <linearGradient id="tokenChartFill" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.35} />
                          <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0.02} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.35} />
                      <XAxis dataKey="label" tick={{ fontSize: 11 }} minTickGap={24} />
                      <YAxis tickFormatter={(value) => formatMarketCap(Number(value))} tick={{ fontSize: 11 }} />
                      <Tooltip
                        formatter={(value: number | null, name: string) => {
                          if (name === "marketCap") return [formatMarketCap(value), "Market Cap"];
                          if (name === "confidenceScore") return [`${Number(value ?? 0).toFixed(0)}%`, "Confidence"];
                          return [value ?? "N/A", name];
                        }}
                      />
                      <Area type="monotone" dataKey="marketCap" stroke="hsl(var(--primary))" strokeWidth={2} fill="url(#tokenChartFill)" />
                      <Area type="monotone" dataKey="confidenceScore" stroke="hsl(var(--accent))" strokeWidth={1.5} fillOpacity={0} />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <div className="space-y-5">
                <section className="app-surface p-5">
                  <div className="mb-4 flex items-center gap-2">
                    <ShieldAlert className="h-4.5 w-4.5 text-primary" />
                    <h3 className="text-base font-semibold text-foreground">Risk panel</h3>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="rounded-[18px] border border-border/60 bg-secondary p-3">
                      <div className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">Largest holder</div>
                      <div className="mt-2 text-xl font-semibold text-foreground">{formatPct(token.risk.largestHolderPct)}</div>
                    </div>
                    <div className="rounded-[18px] border border-border/60 bg-secondary p-3">
                      <div className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">Top 10 holders</div>
                      <div className="mt-2 text-xl font-semibold text-foreground">{formatPct(token.risk.top10HolderPct)}</div>
                    </div>
                    <div className="rounded-[18px] border border-border/60 bg-secondary p-3">
                      <div className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">Bundled wallets</div>
                      <div className="mt-2 text-xl font-semibold text-foreground">{token.risk.bundledWalletCount ?? 0}</div>
                    </div>
                    <div className="rounded-[18px] border border-border/60 bg-secondary p-3">
                      <div className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">Bundled supply</div>
                      <div className="mt-2 text-xl font-semibold text-foreground">{formatPct(token.risk.estimatedBundledSupplyPct)}</div>
                    </div>
                  </div>
                  <div className="mt-4 rounded-[20px] border border-border/60 bg-white/55 p-3 dark:bg-white/[0.03]">
                    <div className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">Bundle clusters</div>
                    <div className="mt-3 space-y-2">
                      {token.bundleClusters.length > 0 ? (
                        token.bundleClusters.map((cluster) => (
                          <div key={cluster.id ?? cluster.clusterLabel} className="flex items-center justify-between rounded-[16px] border border-border/60 bg-secondary px-3 py-2 text-sm">
                            <span className="font-medium text-foreground">{cluster.clusterLabel}</span>
                            <span className="font-mono text-muted-foreground">{cluster.estimatedSupplyPct.toFixed(1)}%</span>
                          </div>
                        ))
                      ) : (
                        <p className="text-sm text-muted-foreground">No clustered bundlers detected yet.</p>
                      )}
                    </div>
                  </div>
                </section>

                <section className="app-surface p-5">
                  <div className="mb-4 flex items-center gap-2">
                    <Users className="h-4.5 w-4.5 text-primary" />
                    <h3 className="text-base font-semibold text-foreground">Top traders</h3>
                  </div>
                  <div className="space-y-3">
                    {token.topTraders.map((trader) => (
                      <div key={trader.id} className="flex items-center gap-3 rounded-[18px] border border-border/60 bg-secondary p-3">
                        <Avatar className="h-10 w-10 border border-border">
                          <AvatarImage src={getAvatarUrl(trader.id, trader.image)} />
                          <AvatarFallback>{(trader.username || trader.name || "?").charAt(0)}</AvatarFallback>
                        </Avatar>
                        <div className="min-w-0 flex-1">
                          <div className="truncate font-semibold text-foreground">{trader.username || trader.name}</div>
                          <div className="text-xs text-muted-foreground">
                            {trader.reputationTier || "Unranked"} | {trader.callsCount} calls | {trader.avgConfidenceScore.toFixed(0)}% avg confidence
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="text-sm font-semibold text-gain">{trader.bestRoiPct.toFixed(1)}%</div>
                          <div className="text-[11px] text-muted-foreground">best ROI</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              </div>
            </section>

            <section className="grid gap-5 lg:grid-cols-[0.8fr_1.2fr]">
              <div className="app-surface p-5">
                <div className="mb-4 flex items-center gap-2">
                  <TrendingUp className="h-4.5 w-4.5 text-primary" />
                  <h3 className="text-base font-semibold text-foreground">Alpha timeline</h3>
                </div>
                <div className="space-y-3">
                  {token.timeline.map((event) => (
                    <div key={event.id} className="rounded-[18px] border border-border/60 bg-secondary p-3">
                      <div className="flex items-center justify-between gap-2">
                        <div className="font-medium text-foreground">
                          {event.metadata?.traderHandle || event.metadata?.traderName || event.eventType.replace(/_/g, " ")}
                        </div>
                        <div className="text-xs text-muted-foreground">{formatTimeAgo(event.timestamp)}</div>
                      </div>
                      <div className="mt-1 text-sm text-muted-foreground">
                        {event.eventType.replace(/_/g, " ")}
                        {event.marketCap ? ` at ${formatMarketCap(event.marketCap)}` : ""}
                        {event.metadata?.timingTier ? ` | ${event.metadata.timingTier}` : ""}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="space-y-4">
                <section className="app-surface p-5">
                  <div className="mb-4 flex items-center justify-between">
                    <div>
                      <h3 className="text-base font-semibold text-foreground">Sentiment + market health</h3>
                      <p className="text-sm text-muted-foreground">Community reactions, liquidity, holders, and volume</p>
                    </div>
                    <a
                      href={token.dexscreenerUrl ?? `https://dexscreener.com/${token.chainType === "solana" ? "solana" : "ethereum"}/${token.address}`}
                      target="_blank"
                      rel="noreferrer"
                      className="text-xs font-semibold text-primary"
                    >
                      Open Dexscreener
                    </a>
                  </div>
                  <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                    <div className="rounded-[18px] border border-border/60 bg-secondary p-3">
                      <div className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">Liquidity</div>
                      <div className="mt-2 text-xl font-semibold text-foreground">{formatMarketCap(token.liquidity)}</div>
                    </div>
                    <div className="rounded-[18px] border border-border/60 bg-secondary p-3">
                      <div className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">Volume 24h</div>
                      <div className="mt-2 text-xl font-semibold text-foreground">{formatMarketCap(token.volume24h)}</div>
                    </div>
                    <div className="rounded-[18px] border border-border/60 bg-secondary p-3">
                      <div className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">Holders</div>
                      <div className="mt-2 text-xl font-semibold text-foreground">{token.holderCount ?? 0}</div>
                    </div>
                    <div className="rounded-[18px] border border-border/60 bg-secondary p-3">
                      <div className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">Sentiment</div>
                      <div className={cn("mt-2 text-xl font-semibold", scoreTone(token.sentiment.score))}>{token.sentiment.score.toFixed(0)}</div>
                    </div>
                  </div>
                  <div className="mt-4 flex flex-wrap gap-2 text-xs text-muted-foreground">
                    <span className="rounded-full border border-border/60 bg-secondary px-3 py-1">Bullish {token.sentiment.bullishPct.toFixed(0)}%</span>
                    <span className="rounded-full border border-border/60 bg-secondary px-3 py-1">Bearish {token.sentiment.bearishPct.toFixed(0)}%</span>
                    <span className="rounded-full border border-border/60 bg-secondary px-3 py-1">🔥 {token.sentiment.reactions.alpha}</span>
                    <span className="rounded-full border border-border/60 bg-secondary px-3 py-1">🐸 {token.sentiment.reactions.based}</span>
                    <span className="rounded-full border border-border/60 bg-secondary px-3 py-1">💰 {token.sentiment.reactions.printed}</span>
                    <span className="rounded-full border border-border/60 bg-secondary px-3 py-1">💀 {token.sentiment.reactions.rug}</span>
                  </div>
                </section>

                <section className="space-y-4">
                  <div className="flex items-center justify-between">
                    <h3 className="text-lg font-semibold text-foreground">Recent calls</h3>
                    <span className="text-sm text-muted-foreground">{token.callsCount} calls</span>
                  </div>
                  {token.recentCalls.map((post) => (
                    <PostCard
                      key={post.id}
                      post={post}
                      currentUserId={canPerformAuthenticatedWrites ? session?.user?.id : undefined}
                    />
                  ))}
                </section>
              </div>
            </section>
          </div>
        )}
      </main>
    </div>
  );
}
