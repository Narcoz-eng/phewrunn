import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/lib/api";
import { appendLiveTradeSample, type LiveTradeSample } from "@/lib/live-candle-stream";
import { getTokenLiveIntelligence } from "@/lib/token-live-intelligence";

type TradePanelLiveStatus = {
  connected: boolean;
  mode: "stream" | "fallback" | "unavailable";
  reason: string | null;
  timestampMs: number;
};

export type TradePanelRecentTrade = {
  id: string;
  timestampMs: number;
  txHash: string | null;
  walletAddress: string | null;
  side: "buy" | "sell" | "unknown";
  priceUsd: number | null;
  volumeUsd: number | null;
  fromAmount: number | null;
  fromSymbol: string | null;
  toAmount: number | null;
  toSymbol: string | null;
  source: string | null;
  platform: string | null;
  poolId: string | null;
  isLarge: boolean;
};

type TradePanelLiveSeedPayload = {
  trades?: TradePanelRecentTrade[];
};

type TradePanelLivePricePayload = {
  timestampMs: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volumeUsd: number;
};

type TradePanelLiveHookParams = {
  enabled: boolean;
  tokenAddress: string | null;
  pairAddress: string | null;
  chainType: "solana" | "ethereum";
};

const MAX_RECENT_TRADES = 32;
const MAX_LIVE_SAMPLES = 720;
const LIVE_FRESHNESS_WINDOW_MS = 10_000;
const FALLBACK_TRADES_POLL_MS = 6_000;
const FALLBACK_PRICE_POLL_MS = 2_500;

function shortenTradeWalletAddress(address: string | null): string | null {
  if (!address) return null;
  if (address.length <= 10) return address;
  return `${address.slice(0, 4)}...${address.slice(-4)}`;
}

function mergeRecentTrades(
  current: TradePanelRecentTrade[],
  incoming: TradePanelRecentTrade[],
  maxEntries = MAX_RECENT_TRADES
): TradePanelRecentTrade[] {
  if (incoming.length === 0) return current;
  const byId = new Map<string, TradePanelRecentTrade>();
  for (const trade of [...incoming, ...current]) {
    byId.set(trade.id, trade);
  }
  return [...byId.values()]
    .sort((left, right) => right.timestampMs - left.timestampMs)
    .slice(0, maxEntries);
}

export function useTradePanelLiveFeed(params: TradePanelLiveHookParams) {
  const [status, setStatus] = useState<TradePanelLiveStatus>({
    connected: false,
    mode: "fallback",
    reason: null,
    timestampMs: 0,
  });
  const [recentTrades, setRecentTrades] = useState<TradePanelRecentTrade[]>([]);
  const [liveSamples, setLiveSamples] = useState<LiveTradeSample[]>([]);
  const [lastEventAtMs, setLastEventAtMs] = useState(0);
  const [usingFallbackPolling, setUsingFallbackPolling] = useState(false);
  const [hasConnectedStream, setHasConnectedStream] = useState(false);
  const [clockNowMs, setClockNowMs] = useState(() => Date.now());
  const fallbackPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const fallbackTradesRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!params.enabled) return;
    const interval = window.setInterval(() => {
      setClockNowMs(Date.now());
    }, 1_000);
    return () => window.clearInterval(interval);
  }, [params.enabled]);

  useEffect(() => {
    if (!params.enabled || !params.tokenAddress) {
      setRecentTrades([]);
      setLiveSamples([]);
      setLastEventAtMs(0);
      setUsingFallbackPolling(false);
      setHasConnectedStream(false);
      setStatus({
        connected: false,
        mode: "fallback",
        reason: null,
        timestampMs: 0,
      });
      return;
    }

    let cancelled = false;
    const search = new URLSearchParams({
      tokenAddress: params.tokenAddress,
      chainType: params.chainType,
    });
    if (params.pairAddress) {
      search.set("pairAddress", params.pairAddress);
    }

    const source = new EventSource(`/api/posts/chart/live?${search.toString()}`);
    source.onopen = () => {
      if (cancelled) return;
      setHasConnectedStream(true);
      setStatus((current) => ({
        connected: true,
        mode: "stream",
        reason: current.reason,
        timestampMs: Date.now(),
      }));
      setUsingFallbackPolling(false);
    };
    source.addEventListener("snapshot", (event) => {
      if (cancelled) return;
      try {
        const payload = JSON.parse((event as MessageEvent<string>).data) as TradePanelLiveSeedPayload;
        const trades = Array.isArray(payload.trades) ? payload.trades : [];
        if (trades.length > 0) {
          setRecentTrades((current) => mergeRecentTrades(current, trades));
          setLastEventAtMs(Date.now());
        }
      } catch {
        // Ignore malformed seed payloads; live events will continue.
      }
    });
    source.addEventListener("price", (event) => {
      if (cancelled) return;
      try {
        const payload = JSON.parse((event as MessageEvent<string>).data) as TradePanelLivePricePayload;
        if (!Number.isFinite(payload.close) || payload.close <= 0) {
          return;
        }
        setLiveSamples((current) =>
          appendLiveTradeSample(
            current,
            {
              timestamp: payload.timestampMs,
              priceUsd: payload.close,
              tradeVolumeUsd: payload.volumeUsd,
            },
            MAX_LIVE_SAMPLES
          )
        );
        setLastEventAtMs(Date.now());
      } catch {
        // Ignore malformed live price frames.
      }
    });
    source.addEventListener("trade", (event) => {
      if (cancelled) return;
      try {
        const payload = JSON.parse((event as MessageEvent<string>).data) as TradePanelRecentTrade;
        setRecentTrades((current) => mergeRecentTrades(current, [payload]));
        if (typeof payload.priceUsd === "number" && Number.isFinite(payload.priceUsd) && payload.priceUsd > 0) {
          setLiveSamples((current) =>
            appendLiveTradeSample(
              current,
              {
                timestamp: payload.timestampMs,
                priceUsd: payload.priceUsd,
                tradeVolumeUsd: payload.volumeUsd,
              },
              MAX_LIVE_SAMPLES
            )
          );
        }
        setLastEventAtMs(Date.now());
      } catch {
        // Ignore malformed trade frames.
      }
    });
    source.addEventListener("status", (event) => {
      if (cancelled) return;
      try {
        const payload = JSON.parse((event as MessageEvent<string>).data) as TradePanelLiveStatus;
        setStatus(payload);
        if (payload.connected) {
          setHasConnectedStream(true);
          setUsingFallbackPolling(false);
          setLastEventAtMs(Date.now());
        } else if (payload.mode !== "stream") {
          setUsingFallbackPolling(true);
        }
      } catch {
        // Ignore malformed status frames.
      }
    });
    source.onerror = () => {
      if (cancelled) return;
      setUsingFallbackPolling(true);
      setStatus((current) => ({
        connected: false,
        mode: current.mode === "unavailable" ? "unavailable" : "fallback",
        reason: current.reason ?? "Live connection interrupted",
        timestampMs: Date.now(),
      }));
    };

    return () => {
      cancelled = true;
      source.close();
    };
  }, [params.chainType, params.enabled, params.pairAddress, params.tokenAddress]);

  useEffect(() => {
    if (!params.enabled || !params.tokenAddress) {
      return;
    }

    if (!usingFallbackPolling) {
      if (fallbackPollRef.current) {
        clearInterval(fallbackPollRef.current);
        fallbackPollRef.current = null;
      }
      if (fallbackTradesRef.current) {
        clearInterval(fallbackTradesRef.current);
        fallbackTradesRef.current = null;
      }
      return;
    }

    let cancelled = false;

    const refreshFallbackPrice = async () => {
      try {
        const live = await getTokenLiveIntelligence(params.tokenAddress!, {
          timeoutMs: 4_500,
          cacheTtlMs: 1_500,
        });
        if (cancelled || typeof live.priceUsd !== "number" || !Number.isFinite(live.priceUsd) || live.priceUsd <= 0) {
          return;
        }
        setLiveSamples((current) =>
          appendLiveTradeSample(
            current,
            {
              timestamp: Date.now(),
              priceUsd: live.priceUsd,
              volume24hUsd: live.volume24h,
              tradeCount24h:
                typeof live.buys24h === "number" || typeof live.sells24h === "number"
                  ? Math.max(0, (live.buys24h ?? 0) + (live.sells24h ?? 0))
                  : null,
            },
            MAX_LIVE_SAMPLES
          )
        );
        setLastEventAtMs(Date.now());
      } catch {
        // Keep last good sample during fallback provider hiccups.
      }
    };

    const refreshFallbackTrades = async () => {
      try {
        const query = new URLSearchParams({
          tokenAddress: params.tokenAddress!,
          chainType: params.chainType,
          limit: String(MAX_RECENT_TRADES),
        });
        const payload = await api.get<{
          trades: TradePanelRecentTrade[];
        }>(`/api/posts/chart/trades?${query.toString()}`);
        if (cancelled || !Array.isArray(payload.trades)) {
          return;
        }
        setRecentTrades((current) => mergeRecentTrades(current, payload.trades));
        if (payload.trades.length > 0) {
          setLastEventAtMs(Date.now());
        }
      } catch {
        // Ignore fallback trade polling errors.
      }
    };

    void refreshFallbackPrice();
    void refreshFallbackTrades();
    fallbackPollRef.current = setInterval(() => {
      void refreshFallbackPrice();
    }, FALLBACK_PRICE_POLL_MS);
    fallbackTradesRef.current = setInterval(() => {
      void refreshFallbackTrades();
    }, FALLBACK_TRADES_POLL_MS);

    return () => {
      cancelled = true;
      if (fallbackPollRef.current) {
        clearInterval(fallbackPollRef.current);
        fallbackPollRef.current = null;
      }
      if (fallbackTradesRef.current) {
        clearInterval(fallbackTradesRef.current);
        fallbackTradesRef.current = null;
      }
    };
  }, [params.chainType, params.enabled, params.tokenAddress, usingFallbackPolling]);

  const liveIsFresh = lastEventAtMs > 0 && clockNowMs - lastEventAtMs <= LIVE_FRESHNESS_WINDOW_MS;
  const liveBadgeLabel = !params.enabled || !params.tokenAddress
    ? "Offline"
    : status.connected && liveIsFresh
      ? "Live"
      : usingFallbackPolling
        ? "Polling"
        : hasConnectedStream
          ? "Reconnecting"
          : "Connecting";

  const recentTradesWithDisplay = useMemo(
    () =>
      recentTrades.map((trade) => ({
        ...trade,
        walletShort: shortenTradeWalletAddress(trade.walletAddress),
      })),
    [recentTrades]
  );

  return {
    liveSamples,
    recentTrades: recentTradesWithDisplay,
    liveStatus: status,
    liveBadgeLabel,
    liveIsFresh,
    usingFallbackPolling,
    lastEventAtMs,
  };
}
