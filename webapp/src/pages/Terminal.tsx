import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { CandlestickChart, ExternalLink, Search } from "lucide-react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TradeTransactionsFeed } from "@/components/feed/TradeTransactionsFeed";
import { TradeTerminalLayout } from "@/components/feed/TradeTerminalLayout";
import { DirectTokenTradePanel } from "@/components/token/DirectTokenTradePanel";
import { V2PageHeader } from "@/components/layout/V2PageHeader";
import { V2EmptyState } from "@/components/ui/v2/V2EmptyState";
import { V2MetricCard } from "@/components/ui/v2/V2MetricCard";
import { V2SectionHeader } from "@/components/ui/v2/V2SectionHeader";
import { V2StatusPill } from "@/components/ui/v2/V2StatusPill";
import { V2Surface } from "@/components/ui/v2/V2Surface";
import { useTradePanelLiveFeed } from "@/lib/trade-panel-live";

type TerminalTokenResponse = {
  address: string;
  chainType: string;
  symbol: string | null;
  name: string | null;
  imageUrl: string | null;
  priceUsd: number | null;
  priceChange24hPct: number | null;
  liquidity: number | null;
  volume24h: number | null;
  holderCount: number | null;
  pairAddress: string | null;
  dexscreenerUrl: string | null;
  activityStatusLabel: string | null;
  confidenceScore: number | null;
  highConvictionScore: number | null;
};

function formatUsd(value: number | null) {
  if (value === null || !Number.isFinite(value)) return "--";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: Math.abs(value) >= 1000 ? "compact" : "standard",
    maximumFractionDigits: value >= 1 ? 2 : 6,
  }).format(value);
}

function formatCompact(value: number | null) {
  if (value === null || !Number.isFinite(value)) return "--";
  return new Intl.NumberFormat("en-US", {
    notation: Math.abs(value) >= 1000 ? "compact" : "standard",
    maximumFractionDigits: 1,
  }).format(value);
}

export default function Terminal() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [draftToken, setDraftToken] = useState(searchParams.get("token") ?? "");
  const tokenAddress = searchParams.get("token")?.trim() || "";

  const tokenQuery = useQuery<TerminalTokenResponse>({
    queryKey: ["terminal-token", tokenAddress],
    enabled: tokenAddress.length > 0,
    staleTime: 30_000,
    gcTime: 5 * 60_000,
    refetchOnWindowFocus: false,
    queryFn: async () => api.get<TerminalTokenResponse>(`/api/tokens/${tokenAddress}`),
  });

  const token = tokenQuery.data ?? null;
  const tradeFeed = useTradePanelLiveFeed({
    enabled: Boolean(token?.address),
    tokenAddress: token?.address ?? null,
    pairAddress: token?.pairAddress ?? null,
    chainType: token?.chainType === "solana" ? "solana" : "ethereum",
  });

  const liveBadgeTone = tradeFeed.liveStatus.connected ? "live" : "default";
  const stats = useMemo(
    () => [
      { label: "Price", value: formatUsd(token?.priceUsd ?? null), hint: token?.priceChange24hPct !== null && token?.priceChange24hPct !== undefined ? `${token.priceChange24hPct >= 0 ? "+" : ""}${token.priceChange24hPct.toFixed(2)}% 24H` : "Awaiting 24H move" },
      { label: "Liquidity", value: formatUsd(token?.liquidity ?? null), hint: "Pool depth" },
      { label: "24H Volume", value: formatUsd(token?.volume24h ?? null), hint: "Executed flow" },
      { label: "Holders", value: formatCompact(token?.holderCount ?? null), hint: "Wallet distribution" },
    ],
    [token]
  );

  const handleSearch = () => {
    const next = draftToken.trim();
    setSearchParams(next ? { token: next } : {});
  };

  return (
    <div className="space-y-5">
      <V2PageHeader
        title="Trading Terminal"
        description="High-signal execution surface layered on the current token and trade infrastructure. Search a token address to load live trades and route execution without changing the existing token flow."
        badge={<V2StatusPill tone={liveBadgeTone}>{tradeFeed.liveStatus.connected ? "Live" : "Standby"}</V2StatusPill>}
        action={
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex min-w-[260px] items-center gap-2 rounded-[20px] border border-white/10 bg-white/[0.04] p-2">
              <Input
                value={draftToken}
                onChange={(event) => setDraftToken(event.target.value)}
                placeholder="Paste token address"
                className="border-0 bg-transparent text-white placeholder:text-white/30 focus-visible:ring-0"
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    handleSearch();
                  }
                }}
              />
              <Button type="button" size="sm" onClick={handleSearch} className="rounded-xl">
                <Search className="mr-2 h-4 w-4" />
                Load
              </Button>
            </div>
            {token?.address ? (
              <Button
                type="button"
                variant="ghost"
                className="rounded-2xl border border-white/10 bg-white/[0.04] text-white/76 hover:bg-white/[0.08] hover:text-white"
                onClick={() => navigate(`/token/${token.address}?tab=trade`)}
              >
                Open Token Board
              </Button>
            ) : null}
          </div>
        }
      />

      {!tokenAddress ? (
        <V2EmptyState
          icon={<CandlestickChart className="h-7 w-7" />}
          title="Load a live market"
          description="This terminal reuses the existing token trading stack. Enter a token address to open execution, trade prints, and token-linked liquidity context."
        />
      ) : tokenQuery.isLoading ? (
        <V2Surface className="p-8">
          <div className="text-sm text-white/56">Loading terminal context...</div>
        </V2Surface>
      ) : tokenQuery.isError || !token ? (
        <V2EmptyState
          icon={<CandlestickChart className="h-7 w-7" />}
          title="Unable to load this token"
          description="The terminal could not resolve token context from the existing token endpoint. Try another address or open the token board directly."
          action={
            <Button type="button" onClick={() => navigate("/")}>
              Back to feed
            </Button>
          }
        />
      ) : (
        <>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            {stats.map((stat) => (
              <V2MetricCard key={stat.label} label={stat.label} value={stat.value} hint={stat.hint} />
            ))}
          </div>

          <TradeTerminalLayout
            left={
              <>
                <V2Surface className="p-5 sm:p-6">
                  <V2SectionHeader
                    eyebrow="Market"
                    title={`${token.symbol ? `$${token.symbol}` : token.name || "Token"} execution`}
                    description={`Current activity state: ${token.activityStatusLabel || "Monitoring"}. Confidence ${formatCompact(token.confidenceScore)} / Conviction ${formatCompact(token.highConvictionScore)}.`}
                    action={
                      token.dexscreenerUrl ? (
                        <a
                          href={token.dexscreenerUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-2 rounded-full border border-white/10 px-3 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-white/62 hover:bg-white/[0.05] hover:text-white"
                        >
                          Dexscreener
                          <ExternalLink className="h-3.5 w-3.5" />
                        </a>
                      ) : null
                    }
                  />
                  <div className="mt-5 grid gap-3 md:grid-cols-2">
                    <V2Surface tone="soft" className="p-4">
                      <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-white/42">Execution Mode</div>
                      <div className="mt-2 text-lg font-semibold text-white">
                        {tradeFeed.liveStatus.connected ? "Realtime prints active" : "Fallback polling"}
                      </div>
                      <div className="mt-2 text-sm text-white/48">
                        Route execution and wallet state stay on the current direct-trade implementation.
                      </div>
                    </V2Surface>
                    <V2Surface tone="soft" className="p-4">
                      <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-white/42">Token Board</div>
                      <div className="mt-2 text-lg font-semibold text-white">Integrated with existing page</div>
                      <div className="mt-2 text-sm text-white/48">
                        Use the full token board for chart telemetry, community, and deeper intelligence modules.
                      </div>
                      <div className="mt-4">
                        <Link
                          to={`/token/${token.address}?tab=trade`}
                          className="text-sm font-semibold text-[#76ff44]"
                        >
                          Open full token board
                        </Link>
                      </div>
                    </V2Surface>
                  </div>
                </V2Surface>
                <TradeTransactionsFeed
                  trades={tradeFeed.recentTrades}
                  liveMode={tradeFeed.liveStatus.mode}
                  usingFallbackPolling={tradeFeed.usingFallbackPolling}
                  lastTradeEventAtMs={tradeFeed.lastTradeEventAtMs}
                  chainType={token.chainType === "solana" ? "solana" : "ethereum"}
                />
              </>
            }
            right={
              <DirectTokenTradePanel
                tokenAddress={token.address}
                chainType={token.chainType === "solana" ? "solana" : "ethereum"}
                tokenSymbol={token.symbol || "TOKEN"}
                tokenName={token.name || token.symbol || "Token"}
                tokenImage={token.imageUrl}
                tokenPriceUsd={token.priceUsd}
                liveStateLabel={tradeFeed.liveStatus.connected ? "Live route" : "Fallback route"}
              />
            }
          />
        </>
      )}
    </div>
  );
}
