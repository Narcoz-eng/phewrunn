import { api } from "@/lib/api";
import { appendLiveTradeSample, type LiveTradeSample } from "@/lib/live-candle-stream";
import { subscribeToTokenRealtime } from "@/lib/realtime/app-realtime-client";
import { getTokenLiveIntelligence } from "@/lib/token-live-intelligence";

export type TradePanelLiveStatus = {
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

export type TokenLiveStreamParams = {
  enabled: boolean;
  tokenAddress: string | null;
  pairAddress: string | null;
  chainType: "solana" | "ethereum";
};

export type TokenLiveStreamSnapshot = {
  status: TradePanelLiveStatus;
  recentTrades: TradePanelRecentTrade[];
  liveSamples: LiveTradeSample[];
  lastEventAtMs: number;
  lastTradeEventAtMs: number;
  usingFallbackPolling: boolean;
  hasConnectedStream: boolean;
};

type TokenLiveStreamSubscriber = (snapshot: TokenLiveStreamSnapshot) => void;

type SharedTokenLiveStream = {
  key: string;
  params: Omit<TokenLiveStreamParams, "enabled">;
  subscribers: Map<string, TokenLiveStreamSubscriber>;
  snapshot: TokenLiveStreamSnapshot;
  liveTransportCloser: (() => void) | null;
  fallbackPriceTimer: ReturnType<typeof setInterval> | null;
  fallbackTradesTimer: ReturnType<typeof setInterval> | null;
  streamErrorTimer: ReturnType<typeof setTimeout> | null;
  closeTimer: ReturnType<typeof setTimeout> | null;
  primingPromise: Promise<void> | null;
};

const MAX_RECENT_TRADES = 32;
const MAX_LIVE_SAMPLES = 720;
const FALLBACK_TRADES_POLL_MS = 60_000;
const FALLBACK_PRICE_POLL_MS = 60_000;
const STREAM_ERROR_GRACE_MS = 2_500;
const STREAM_IDLE_CLOSE_MS = 15_000;
const LIVE_PRICE_SNAPSHOT_FRESHNESS_MS = 5_000;
const LIVE_TRADE_SNAPSHOT_FRESHNESS_MS = 10_000;

const sharedStreams = new Map<string, SharedTokenLiveStream>();
const tradeRequestBackoffUntil = new Map<string, number>();
const tradeRequestFailureCount = new Map<string, number>();
const tradeRequestCache = new Map<
  string,
  {
    trades: TradePanelRecentTrade[];
    expiresAtMs: number;
    staleUntilMs: number;
  }
>();
const tradeRequestInFlight = new Map<string, Promise<TradePanelRecentTrade[]>>();

function buildTradesRequestKey(stream: SharedTokenLiveStream): string {
  return [stream.params.chainType, stream.params.tokenAddress ?? "", stream.params.pairAddress ?? ""]
    .join(":")
    .toLowerCase();
}

function readCachedTrades(key: string, allowStale = false): TradePanelRecentTrade[] | null {
  const cached = tradeRequestCache.get(key);
  if (!cached) return null;
  const now = Date.now();
  if (cached.expiresAtMs > now || (allowStale && cached.staleUntilMs > now)) return cached.trades;
  if (cached.staleUntilMs <= now) tradeRequestCache.delete(key);
  return null;
}

function recordTradesRequestFailure(key: string): void {
  const failures = Math.min(6, (tradeRequestFailureCount.get(key) ?? 0) + 1);
  tradeRequestFailureCount.set(key, failures);
  tradeRequestBackoffUntil.set(key, Date.now() + Math.min(5 * 60_000, 15_000 * Math.pow(2, failures - 1)));
}

function recordTradesRequestSuccess(key: string, trades: TradePanelRecentTrade[]): TradePanelRecentTrade[] {
  tradeRequestFailureCount.delete(key);
  tradeRequestBackoffUntil.delete(key);
  tradeRequestCache.set(key, {
    trades,
    expiresAtMs: Date.now() + 45_000,
    staleUntilMs: Date.now() + 5 * 60_000,
  });
  return trades;
}

async function loadRecentTrades(stream: SharedTokenLiveStream): Promise<TradePanelRecentTrade[]> {
  const key = buildTradesRequestKey(stream);
  const cached = readCachedTrades(key);
  if (cached) return cached;
  const stale = readCachedTrades(key, true);
  if ((tradeRequestBackoffUntil.get(key) ?? 0) > Date.now()) return stale ?? [];

  const inFlight = tradeRequestInFlight.get(key);
  if (inFlight) return inFlight;

  const request = (async () => {
    const query = new URLSearchParams({
      tokenAddress: stream.params.tokenAddress!,
      chainType: stream.params.chainType,
      limit: String(MAX_RECENT_TRADES),
    });
    if (stream.params.pairAddress) {
      query.set("pairAddress", stream.params.pairAddress);
    }
    const payload = await api.get<{ trades: TradePanelRecentTrade[] }>(`/api/posts/chart/trades?${query.toString()}`);
    return recordTradesRequestSuccess(key, Array.isArray(payload.trades) ? payload.trades : []);
  })().catch((error) => {
    recordTradesRequestFailure(key);
    const staleAfterFailure = readCachedTrades(key, true);
    if (staleAfterFailure) return staleAfterFailure;
    throw error;
  }).finally(() => {
    tradeRequestInFlight.delete(key);
  });

  tradeRequestInFlight.set(key, request);
  return request;
}

function buildStreamKey(params: Omit<TokenLiveStreamParams, "enabled">): string {
  return [params.chainType, params.tokenAddress ?? "", params.pairAddress ?? ""].join(":").toLowerCase();
}

function createEmptySnapshot(): TokenLiveStreamSnapshot {
  return {
    status: {
      connected: false,
      mode: "fallback",
      reason: null,
      timestampMs: 0,
    },
    recentTrades: [],
    liveSamples: [],
    lastEventAtMs: 0,
    lastTradeEventAtMs: 0,
    usingFallbackPolling: false,
    hasConnectedStream: false,
  };
}

function emitSnapshot(stream: SharedTokenLiveStream): void {
  const next = {
    ...stream.snapshot,
    status: { ...stream.snapshot.status },
    recentTrades: stream.snapshot.recentTrades.map((trade) => ({ ...trade })),
    liveSamples: stream.snapshot.liveSamples.map((sample) => ({ ...sample })),
  };
  for (const subscriber of stream.subscribers.values()) {
    subscriber(next);
  }
}

function patchSnapshot(
  stream: SharedTokenLiveStream,
  updater: (current: TokenLiveStreamSnapshot) => TokenLiveStreamSnapshot
): void {
  stream.snapshot = updater(stream.snapshot);
  emitSnapshot(stream);
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

function clearFallbackTimers(stream: SharedTokenLiveStream): void {
  if (stream.fallbackPriceTimer) {
    clearInterval(stream.fallbackPriceTimer);
    stream.fallbackPriceTimer = null;
  }
  if (stream.fallbackTradesTimer) {
    clearInterval(stream.fallbackTradesTimer);
    stream.fallbackTradesTimer = null;
  }
}

function clearStreamErrorTimer(stream: SharedTokenLiveStream): void {
  if (stream.streamErrorTimer) {
    clearTimeout(stream.streamErrorTimer);
    stream.streamErrorTimer = null;
  }
}

function applyFallbackMode(stream: SharedTokenLiveStream, reason: string | null): void {
  patchSnapshot(stream, (current) => ({
    ...current,
    usingFallbackPolling: true,
    status: {
      connected: false,
      mode: current.status.mode === "unavailable" ? "unavailable" : "fallback",
      reason: reason ?? current.status.reason ?? "Live connection interrupted",
      timestampMs: Date.now(),
    },
  }));
}

async function primeTrades(stream: SharedTokenLiveStream): Promise<void> {
  try {
    const trades = await loadRecentTrades(stream);
    if (trades.length === 0) {
      return;
    }
    patchSnapshot(stream, (current) => {
      const mergedTrades = mergeRecentTrades(current.recentTrades, trades);
      const latestTrade = [...trades].sort((left, right) => right.timestampMs - left.timestampMs)[0];
      let nextSamples = current.liveSamples;
      let nextLastEventAtMs = current.lastEventAtMs;
      let nextLastTradeEventAtMs = current.lastTradeEventAtMs;

      if (
        latestTrade &&
        typeof latestTrade.priceUsd === "number" &&
        Number.isFinite(latestTrade.priceUsd) &&
        latestTrade.priceUsd > 0 &&
        Date.now() - latestTrade.timestampMs <= 30_000
      ) {
        nextSamples = appendLiveTradeSample(
          current.liveSamples,
          {
            timestamp: latestTrade.timestampMs,
            priceUsd: latestTrade.priceUsd,
            tradeVolumeUsd: latestTrade.volumeUsd,
            source: "trade",
            receivedAtMs: Date.now(),
          },
          MAX_LIVE_SAMPLES
        );
        nextLastEventAtMs = Date.now();
        nextLastTradeEventAtMs = latestTrade.timestampMs;
      }

      return {
        ...current,
        recentTrades: mergedTrades,
        liveSamples: nextSamples,
        lastEventAtMs: nextLastEventAtMs,
        lastTradeEventAtMs: nextLastTradeEventAtMs,
      };
    });
  } catch {
    // Ignore priming failures; the live transport/fallback will continue.
  }
}

async function refreshFallbackPrice(stream: SharedTokenLiveStream): Promise<void> {
  try {
    const live = await getTokenLiveIntelligence(stream.params.tokenAddress!, {
      timeoutMs: 4_500,
      cacheTtlMs: 1_500,
    });
    if (typeof live.priceUsd !== "number" || !Number.isFinite(live.priceUsd) || live.priceUsd <= 0) {
      return;
    }
    patchSnapshot(stream, (current) => ({
      ...current,
      liveSamples: appendLiveTradeSample(
        current.liveSamples,
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
      ),
      lastEventAtMs: Date.now(),
    }));
  } catch {
    // Keep last good sample during fallback provider hiccups.
  }
}

async function refreshFallbackTrades(stream: SharedTokenLiveStream): Promise<void> {
  try {
    const trades = await loadRecentTrades(stream);
    patchSnapshot(stream, (current) => {
      const latestTradeTs = trades.reduce((maxTimestamp, trade) => Math.max(maxTimestamp, trade.timestampMs), 0);
      return {
        ...current,
        recentTrades: mergeRecentTrades(current.recentTrades, trades),
        lastTradeEventAtMs: latestTradeTs > 0 ? latestTradeTs : current.lastTradeEventAtMs,
        lastEventAtMs:
          latestTradeTs > 0 && Date.now() - latestTradeTs <= 30_000 ? Date.now() : current.lastEventAtMs,
      };
    });
  } catch {
    // Ignore fallback trade polling errors.
  }
}

function startFallbackPolling(stream: SharedTokenLiveStream): void {
  if (stream.fallbackPriceTimer || stream.fallbackTradesTimer) {
    return;
  }
  void refreshFallbackPrice(stream);
  void refreshFallbackTrades(stream);
  stream.fallbackPriceTimer = setInterval(() => {
    void refreshFallbackPrice(stream);
  }, FALLBACK_PRICE_POLL_MS);
  stream.fallbackTradesTimer = setInterval(() => {
    void refreshFallbackTrades(stream);
  }, FALLBACK_TRADES_POLL_MS);
}

function handleLiveSnapshot(stream: SharedTokenLiveStream, payload: TradePanelLiveSeedPayload): void {
  const trades = Array.isArray(payload.trades) ? payload.trades : [];
  const latestPrice =
    payload.latestPrice &&
    typeof payload.latestPrice.close === "number" &&
    Number.isFinite(payload.latestPrice.close) &&
    payload.latestPrice.close > 0
      ? payload.latestPrice
      : null;

  patchSnapshot(stream, (current) => {
    let next = { ...current };
    if (trades.length > 0) {
      const latestTradeTs = trades.reduce((maxTimestamp, trade) => Math.max(maxTimestamp, trade.timestampMs), 0);
      next = {
        ...next,
        recentTrades: mergeRecentTrades(next.recentTrades, trades),
        lastTradeEventAtMs: latestTradeTs > 0 ? latestTradeTs : next.lastTradeEventAtMs,
        lastEventAtMs: latestTradeTs > 0 && Date.now() - latestTradeTs <= 30_000 ? Date.now() : next.lastEventAtMs,
      };
    }

    if (latestPrice) {
      if (Date.now() - latestPrice.timestampMs <= LIVE_PRICE_SNAPSHOT_FRESHNESS_MS) {
        next = {
          ...next,
          liveSamples: appendLiveTradeSample(
            next.liveSamples,
            {
              timestamp: latestPrice.timestampMs,
              priceUsd: latestPrice.close,
              tradeVolumeUsd: latestPrice.volumeUsd,
              source: "price",
              receivedAtMs: Date.now(),
            },
            MAX_LIVE_SAMPLES
          ),
          lastEventAtMs: Date.now(),
        };
      }
    } else if (trades.length > 0) {
      const freshestTrade = trades
        .filter(
          (trade) => typeof trade.priceUsd === "number" && Number.isFinite(trade.priceUsd) && trade.priceUsd > 0
        )
        .sort((left, right) => right.timestampMs - left.timestampMs)[0];
      if (freshestTrade && Date.now() - freshestTrade.timestampMs <= LIVE_TRADE_SNAPSHOT_FRESHNESS_MS) {
        next = {
          ...next,
          liveSamples: appendLiveTradeSample(
            next.liveSamples,
            {
              timestamp: freshestTrade.timestampMs,
              priceUsd: freshestTrade.priceUsd!,
              tradeVolumeUsd: freshestTrade.volumeUsd,
              source: "trade",
              receivedAtMs: Date.now(),
            },
            MAX_LIVE_SAMPLES
          ),
        };
      }
    }

    return next;
  });
}

function startLiveTransport(stream: SharedTokenLiveStream): void {
  if (typeof window === "undefined" || !stream.params.tokenAddress || stream.liveTransportCloser) {
    return;
  }

  if (stream.primingPromise === null) {
    stream.primingPromise = primeTrades(stream).finally(() => {
      stream.primingPromise = null;
    });
  }

  stream.liveTransportCloser = subscribeToTokenRealtime(
    {
      tokenAddress: stream.params.tokenAddress,
      pairAddress: stream.params.pairAddress,
      chainType: stream.params.chainType,
    },
    {
      onOpen: () => {
        clearStreamErrorTimer(stream);
        clearFallbackTimers(stream);
        patchSnapshot(stream, (current) => ({
          ...current,
          hasConnectedStream: true,
          usingFallbackPolling: false,
          status: {
            connected: true,
            mode: "stream",
            reason: current.status.reason,
            timestampMs: Date.now(),
          },
        }));

        if (stream.snapshot.recentTrades.length === 0) {
          void refreshFallbackTrades(stream);
        }
      },
      onSnapshot: (payload) => {
        handleLiveSnapshot(stream, payload as TradePanelLiveSeedPayload);
        if (payload.status) {
          patchSnapshot(stream, (current) => ({
            ...current,
            status: payload.status!,
            hasConnectedStream: payload.status!.connected ? true : current.hasConnectedStream,
            usingFallbackPolling: payload.status!.connected ? false : payload.status!.mode !== "stream",
          }));
        }
      },
      onPrice: (payload) => {
        if (!Number.isFinite(payload.close) || payload.close <= 0) {
          return;
        }
        patchSnapshot(stream, (current) => ({
          ...current,
          liveSamples: appendLiveTradeSample(
            current.liveSamples,
            {
              timestamp: payload.timestampMs,
              priceUsd: payload.close,
              tradeVolumeUsd: payload.volumeUsd,
              source: "price",
              receivedAtMs: Date.now(),
            },
            MAX_LIVE_SAMPLES
          ),
          lastEventAtMs: Date.now(),
        }));
      },
      onTrade: (payload) => {
        patchSnapshot(stream, (current) => ({
          ...current,
          recentTrades: mergeRecentTrades(current.recentTrades, [payload]),
          liveSamples:
            typeof payload.priceUsd === "number" && Number.isFinite(payload.priceUsd) && payload.priceUsd > 0
              ? appendLiveTradeSample(
                  current.liveSamples,
                  {
                    timestamp: payload.timestampMs,
                    priceUsd: payload.priceUsd,
                    tradeVolumeUsd: payload.volumeUsd,
                    source: "trade",
                    receivedAtMs: Date.now(),
                  },
                  MAX_LIVE_SAMPLES
                )
              : current.liveSamples,
          lastEventAtMs: Date.now(),
          lastTradeEventAtMs: payload.timestampMs,
        }));
      },
      onStatus: (payload) => {
        patchSnapshot(stream, (current) => ({
          ...current,
          status: payload,
          hasConnectedStream: payload.connected ? true : current.hasConnectedStream,
          usingFallbackPolling: payload.connected ? false : payload.mode !== "stream",
        }));
        if (payload.connected) {
          clearStreamErrorTimer(stream);
          clearFallbackTimers(stream);
        } else if (payload.mode !== "stream") {
          startFallbackPolling(stream);
        }
      },
      onError: () => {
        if (stream.streamErrorTimer) {
          return;
        }
        stream.streamErrorTimer = window.setTimeout(() => {
          stream.streamErrorTimer = null;
          applyFallbackMode(stream, null);
          startFallbackPolling(stream);
        }, STREAM_ERROR_GRACE_MS);
      },
    }
  );
}

function stopLiveTransport(stream: SharedTokenLiveStream): void {
  clearStreamErrorTimer(stream);
  clearFallbackTimers(stream);
  stream.liveTransportCloser?.();
  stream.liveTransportCloser = null;
}

function createSharedStream(params: Omit<TokenLiveStreamParams, "enabled">): SharedTokenLiveStream {
  return {
    key: buildStreamKey(params),
    params,
    subscribers: new Map(),
    snapshot: createEmptySnapshot(),
    liveTransportCloser: null,
    fallbackPriceTimer: null,
    fallbackTradesTimer: null,
    streamErrorTimer: null,
    closeTimer: null,
    primingPromise: null,
  };
}

export function subscribeToTokenLiveStream(
  params: TokenLiveStreamParams,
  subscriber: TokenLiveStreamSubscriber
): () => void {
  if (!params.enabled || !params.tokenAddress) {
    subscriber(createEmptySnapshot());
    return () => undefined;
  }

  const normalizedParams = {
    tokenAddress: params.tokenAddress,
    pairAddress: params.pairAddress,
    chainType: params.chainType,
  } satisfies Omit<TokenLiveStreamParams, "enabled">;
  const key = buildStreamKey(normalizedParams);
  const stream = sharedStreams.get(key) ?? createSharedStream(normalizedParams);
  sharedStreams.set(key, stream);

  if (stream.closeTimer) {
    clearTimeout(stream.closeTimer);
    stream.closeTimer = null;
  }

  const subscriberId =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now()}:${Math.random().toString(36).slice(2)}`;
  stream.subscribers.set(subscriberId, subscriber);
  subscriber(stream.snapshot);
  startLiveTransport(stream);

  return () => {
    stream.subscribers.delete(subscriberId);
    if (stream.subscribers.size > 0) {
      return;
    }
    stream.closeTimer = window.setTimeout(() => {
      stopLiveTransport(stream);
      sharedStreams.delete(key);
    }, STREAM_IDLE_CLOSE_MS);
  };
}
