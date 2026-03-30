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
  receivedAtMs?: number | null;
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
  latestPrice?: TradePanelLivePricePayload | null;
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
const FALLBACK_TRADES_POLL_MS = 2_500;
const FALLBACK_PRICE_POLL_MS = 1_500;
const STREAM_ERROR_GRACE_MS = 2_500;
const LIVE_PRICE_SNAPSHOT_FRESHNESS_MS = 5_000;
const LIVE_TRADE_SNAPSHOT_FRESHNESS_MS = 10_000;

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
  const receivedAtMs = Date.now();
  const referenceNowMs = receivedAtMs;
  for (const trade of [...incoming, ...current]) {
    const normalized: TradePanelRecentTrade = {
      ...trade,
      receivedAtMs:
        typeof trade.receivedAtMs === "number" && Number.isFinite(trade.receivedAtMs)
          ? trade.receivedAtMs
          : receivedAtMs,
    };
    byId.set(normalized.id, normalized);
  }
  return [...byId.values()]
    .sort((left, right) => {
      const leftArrival =
        referenceNowMs - left.timestampMs <= 15_000
          ? Math.max(left.timestampMs, left.receivedAtMs ?? left.timestampMs)
          : left.timestampMs;
      const rightArrival =
        referenceNowMs - right.timestampMs <= 15_000
          ? Math.max(right.timestampMs, right.receivedAtMs ?? right.timestampMs)
          : right.timestampMs;
      if (rightArrival !== leftArrival) {
        return rightArrival - leftArrival;
      }
      return right.timestampMs - left.timestampMs;
    })
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
  const [lastTradeEventAtMs, setLastTradeEventAtMs] = useState(0);
  const [usingFallbackPolling, setUsingFallbackPolling] = useState(false);
  const [hasConnectedStream, setHasConnectedStream] = useState(false);
  const fallbackPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const fallbackTradesRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const streamErrorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!params.enabled || !params.tokenAddress) {
      setRecentTrades([]);
      setLiveSamples([]);
      setLastEventAtMs(0);
      setLastTradeEventAtMs(0);
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
    const clearStreamErrorTimer = () => {
      if (streamErrorTimerRef.current) {
        clearTimeout(streamErrorTimerRef.current);
        streamErrorTimerRef.current = null;
      }
    };
    const primeTrades = async () => {
      try {
        const query = new URLSearchParams({
          tokenAddress: params.tokenAddress!,
          chainType: params.chainType,
          limit: String(MAX_RECENT_TRADES),
        });
        if (params.pairAddress) {
          query.set("pairAddress", params.pairAddress);
        }
        const payload = await api.get<{
          trades: TradePanelRecentTrade[];
        }>(`/api/posts/chart/trades?${query.toString()}`);
        if (cancelled || !Array.isArray(payload.trades)) {
          return;
        }
        setRecentTrades((current) => mergeRecentTrades(current, payload.trades));
        if (payload.trades.length > 0) {
          const latestTrade = [...payload.trades].sort((left, right) => right.timestampMs - left.timestampMs)[0];
          if (
            latestTrade &&
            typeof latestTrade.priceUsd === "number" &&
            Number.isFinite(latestTrade.priceUsd) &&
            latestTrade.priceUsd > 0 &&
            Date.now() - latestTrade.timestampMs <= 30_000
          ) {
            setLiveSamples((current) =>
              appendLiveTradeSample(
                current,
                {
                  timestamp: latestTrade.timestampMs,
                  priceUsd: latestTrade.priceUsd,
                  tradeVolumeUsd: latestTrade.volumeUsd,
                  source: "trade",
                  receivedAtMs: Date.now(),
                },
                MAX_LIVE_SAMPLES
              )
            );
            setLastEventAtMs(Date.now());
            setLastTradeEventAtMs(latestTrade.timestampMs);
          }
        }
      } catch {
        // Ignore priming failures; stream and fallback polling will continue.
      }
    };

    void primeTrades();

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
      clearStreamErrorTimer();
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
        const latestPrice =
          payload.latestPrice &&
          typeof payload.latestPrice.close === "number" &&
          Number.isFinite(payload.latestPrice.close) &&
          payload.latestPrice.close > 0
            ? payload.latestPrice
            : null;
        if (trades.length > 0) {
          const latestTradeTs = trades.reduce((maxTimestamp, trade) => Math.max(maxTimestamp, trade.timestampMs), 0);
          setRecentTrades((current) => mergeRecentTrades(current, trades));
          if (latestTradeTs > 0) {
            setLastTradeEventAtMs(latestTradeTs);
            if (Date.now() - latestTradeTs <= 30_000) {
              setLastEventAtMs(Date.now());
            }
          }
        }
        if (latestPrice) {
          if (Date.now() - latestPrice.timestampMs <= LIVE_PRICE_SNAPSHOT_FRESHNESS_MS) {
            setLiveSamples((current) =>
              appendLiveTradeSample(
                current,
                {
                  timestamp: latestPrice.timestampMs,
                  priceUsd: latestPrice.close,
                  tradeVolumeUsd: latestPrice.volumeUsd,
                  source: "price",
                  receivedAtMs: Date.now(),
                },
                MAX_LIVE_SAMPLES
              )
            );
            setLastEventAtMs(Date.now());
          }
        } else if (trades.length > 0) {
          const freshestTrade = trades
            .filter(
              (trade) =>
                typeof trade.priceUsd === "number" &&
                Number.isFinite(trade.priceUsd) &&
                trade.priceUsd > 0
            )
            .sort((left, right) => right.timestampMs - left.timestampMs)[0];
          if (freshestTrade && Date.now() - freshestTrade.timestampMs <= LIVE_TRADE_SNAPSHOT_FRESHNESS_MS) {
            setLiveSamples((current) =>
              appendLiveTradeSample(
                current,
                {
                  timestamp: freshestTrade.timestampMs,
                  priceUsd: freshestTrade.priceUsd!,
                  tradeVolumeUsd: freshestTrade.volumeUsd,
                  source: "trade",
                  receivedAtMs: Date.now(),
                },
                MAX_LIVE_SAMPLES
              )
            );
          }
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
              source: "price",
              receivedAtMs: Date.now(),
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
                source: "trade",
                receivedAtMs: Date.now(),
              },
              MAX_LIVE_SAMPLES
            )
          );
        }
        setLastEventAtMs(Date.now());
        setLastTradeEventAtMs(payload.timestampMs);
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
          clearStreamErrorTimer();
          setHasConnectedStream(true);
          setUsingFallbackPolling(false);
        } else if (payload.mode !== "stream") {
          setUsingFallbackPolling(true);
        }
      } catch {
        // Ignore malformed status frames.
      }
    });
    source.onerror = () => {
      if (cancelled) return;
      if (streamErrorTimerRef.current) {
        return;
      }
      streamErrorTimerRef.current = window.setTimeout(() => {
        if (cancelled) return;
        setUsingFallbackPolling(true);
        setStatus((current) => ({
          connected: false,
          mode: current.mode === "unavailable" ? "unavailable" : "fallback",
          reason: current.reason ?? "Live connection interrupted",
          timestampMs: Date.now(),
        }));
        streamErrorTimerRef.current = null;
      }, STREAM_ERROR_GRACE_MS);
    };

    return () => {
      cancelled = true;
      clearStreamErrorTimer();
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
              source: "fallback",
              receivedAtMs: Date.now(),
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
        if (params.pairAddress) {
          query.set("pairAddress", params.pairAddress);
        }
        const payload = await api.get<{
          trades: TradePanelRecentTrade[];
        }>(`/api/posts/chart/trades?${query.toString()}`);
        if (cancelled || !Array.isArray(payload.trades)) {
          return;
        }
        setRecentTrades((current) => mergeRecentTrades(current, payload.trades));
        if (payload.trades.length > 0) {
          const latestTradeTs = payload.trades.reduce(
            (maxTimestamp, trade) => Math.max(maxTimestamp, trade.timestampMs),
            0
          );
          if (latestTradeTs > 0) {
            setLastTradeEventAtMs(latestTradeTs);
            if (Date.now() - latestTradeTs <= 30_000) {
              setLastEventAtMs(Date.now());
            }
          }
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
    usingFallbackPolling,
    hasConnectedStream,
    lastEventAtMs,
    lastTradeEventAtMs,
  };
}
