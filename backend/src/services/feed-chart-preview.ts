type FeedChartPreviewCandle = {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

export type FeedChartPreviewResult = {
  state: "live" | "unavailable";
  source: string;
  unavailableReason: string | null;
  candles: FeedChartPreviewCandle[] | null;
};

type CacheEntry = {
  expiresAtMs: number;
  value: FeedChartPreviewResult;
};

const FEED_CHART_PREVIEW_CACHE_TTL_MS = 45_000;
const FEED_CHART_PREVIEW_TIMEOUT_MS = 2_200;
const BIRDEYE_API_KEY = process.env.BIRDEYE_API_KEY?.trim() || "";
const feedChartPreviewCache = new Map<string, CacheEntry>();
const feedChartPreviewInFlight = new Map<string, Promise<FeedChartPreviewResult>>();

function finite(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function timestampSeconds(value: unknown): number | null {
  const parsed = finite(value);
  if (parsed === null || parsed <= 0) return null;
  return parsed > 10_000_000_000 ? Math.floor(parsed / 1000) : Math.floor(parsed);
}

function normalizeCandle(row: unknown): FeedChartPreviewCandle | null {
  if (!Array.isArray(row) || row.length < 6) return null;
  const timestamp = timestampSeconds(row[0]);
  const open = finite(row[1]);
  const high = finite(row[2]);
  const low = finite(row[3]);
  const close = finite(row[4]);
  const volume = finite(row[5]) ?? 0;
  if (timestamp === null || open === null || high === null || low === null || close === null) {
    return null;
  }
  if (open <= 0 || high <= 0 || low <= 0 || close <= 0) return null;
  return {
    timestamp,
    open,
    high: Math.max(high, low, open, close),
    low: Math.min(high, low, open, close),
    close,
    volume: Math.max(0, volume),
  };
}

function parseGeckoCandles(payload: unknown): FeedChartPreviewCandle[] {
  const top = payload && typeof payload === "object" ? payload as Record<string, unknown> : null;
  const data = top?.data && typeof top.data === "object" ? top.data as Record<string, unknown> : null;
  const attributes = data?.attributes && typeof data.attributes === "object" ? data.attributes as Record<string, unknown> : null;
  const raw = Array.isArray(attributes?.ohlcv_list) ? attributes.ohlcv_list : [];
  const deduped = new Map<number, FeedChartPreviewCandle>();
  for (const row of raw) {
    const candle = normalizeCandle(row);
    if (candle) deduped.set(candle.timestamp, candle);
  }
  return [...deduped.values()].sort((a, b) => a.timestamp - b.timestamp).slice(-48);
}

function parseBirdeyeCandles(payload: unknown): FeedChartPreviewCandle[] {
  const top = payload && typeof payload === "object" ? payload as Record<string, unknown> : null;
  if (top?.success === false) return [];
  const data = top?.data && typeof top.data === "object" ? top.data as Record<string, unknown> : null;
  const raw = Array.isArray(data?.items)
    ? data.items
    : Array.isArray(data?.history)
      ? data.history
      : [];
  const deduped = new Map<number, FeedChartPreviewCandle>();
  for (const row of raw) {
    const item = row && typeof row === "object" ? row as Record<string, unknown> : null;
    if (!item) continue;
    const value = finite(item.value);
    const candle = normalizeObjectCandle({
      timestamp: item.unixTime ?? item.time ?? item.timestamp,
      open: item.o ?? item.open ?? value,
      high: item.h ?? item.high ?? value,
      low: item.l ?? item.low ?? value,
      close: item.c ?? item.close ?? value,
      volume: item.v ?? item.volume ?? item.baseVolume ?? item.quoteVolume ?? 0,
    });
    if (candle) deduped.set(candle.timestamp, candle);
  }
  return [...deduped.values()].sort((a, b) => a.timestamp - b.timestamp).slice(-48);
}

function normalizeObjectCandle(row: {
  timestamp: unknown;
  open: unknown;
  high: unknown;
  low: unknown;
  close: unknown;
  volume: unknown;
}): FeedChartPreviewCandle | null {
  const timestamp = timestampSeconds(row.timestamp);
  const open = finite(row.open);
  const high = finite(row.high);
  const low = finite(row.low);
  const close = finite(row.close);
  const volume = finite(row.volume) ?? 0;
  if (timestamp === null || open === null || high === null || low === null || close === null) return null;
  if (open <= 0 || high <= 0 || low <= 0 || close <= 0) return null;
  return {
    timestamp,
    open,
    high: Math.max(high, low, open, close),
    low: Math.min(high, low, open, close),
    close,
    volume: Math.max(0, volume),
  };
}

function isValidPreviewSeries(candles: FeedChartPreviewCandle[]): boolean {
  if (candles.length < 12) return false;
  const minLow = Math.min(...candles.map((candle) => candle.low));
  const maxHigh = Math.max(...candles.map((candle) => candle.high));
  const firstOpen = candles[0]?.open ?? 0;
  const lastClose = candles[candles.length - 1]?.close ?? 0;
  const bodyCount = candles.filter((candle) => Math.abs(candle.close - candle.open) > candle.open * 0.0005).length;
  const rangePct = minLow > 0 ? ((maxHigh - minLow) / minLow) * 100 : 0;
  const movePct = firstOpen > 0 ? Math.abs(((lastClose - firstOpen) / firstOpen) * 100) : 0;
  return rangePct >= 0.05 && (movePct >= 0.03 || bodyCount >= Math.ceil(candles.length * 0.25));
}

export async function getFeedChartPreview(params: {
  tokenAddress: string | null | undefined;
  pairAddress: string | null | undefined;
  chainType: string | null | undefined;
}): Promise<FeedChartPreviewResult> {
  const tokenAddress = params.tokenAddress?.trim();
  const pairAddress = params.pairAddress?.trim();
  if (!pairAddress && !tokenAddress) {
    return {
      state: "unavailable",
      source: "chart-preview",
      unavailableReason: "No token or pair address is attached for market candles.",
      candles: null,
    };
  }

  const network = params.chainType === "solana" ? "solana" : "eth";
  const cacheKey = `${network}:${(pairAddress ?? tokenAddress ?? "").toLowerCase()}:minute:5`;
  const cached = feedChartPreviewCache.get(cacheKey);
  if (cached && cached.expiresAtMs > Date.now()) return cached.value;

  let request = feedChartPreviewInFlight.get(cacheKey);
  if (!request) {
    request = (async () => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), FEED_CHART_PREVIEW_TIMEOUT_MS);
      try {
        if (network === "solana" && tokenAddress && BIRDEYE_API_KEY) {
          const timeTo = Math.floor(Date.now() / 1000);
          const timeFrom = timeTo - 5 * 60 * 54;
          const birdeyeParams = new URLSearchParams({
            address: tokenAddress,
            address_type: "token",
            type: "5m",
            time_from: String(timeFrom),
            time_to: String(timeTo),
            count_limit: "48",
          });
          const birdeyeResponse = await fetch(
            `https://public-api.birdeye.so/defi/v3/ohlcv?${birdeyeParams.toString()}`,
            {
              headers: {
                accept: "application/json",
                "x-chain": "solana",
                "X-API-KEY": BIRDEYE_API_KEY,
              },
              signal: controller.signal,
            }
          );
          if (birdeyeResponse.ok) {
            const candles = parseBirdeyeCandles(await birdeyeResponse.json());
            if (isValidPreviewSeries(candles)) {
              return {
                state: "live",
                source: "birdeye",
                unavailableReason: null,
                candles,
              } satisfies FeedChartPreviewResult;
            }
          }
        }

        if (!pairAddress) {
          return {
            state: "unavailable",
            source: network === "solana" ? "birdeye" : "geckoterminal",
            unavailableReason: "No pair address is attached for fallback market candles.",
            candles: null,
          } satisfies FeedChartPreviewResult;
        }

        const params = new URLSearchParams({
          aggregate: "5",
          limit: "48",
          currency: "usd",
          token: "base",
        });
        const response = await fetch(
          `https://api.geckoterminal.com/api/v2/networks/${network}/pools/${pairAddress}/ohlcv/minute?${params.toString()}`,
          { headers: { accept: "application/json" }, signal: controller.signal }
        );
        if (!response.ok) {
          return {
            state: "unavailable",
            source: "geckoterminal",
            unavailableReason: `GeckoTerminal candles unavailable (${response.status}).`,
            candles: null,
          } satisfies FeedChartPreviewResult;
        }
        const candles = parseGeckoCandles(await response.json());
        if (!isValidPreviewSeries(candles)) {
          return {
            state: "unavailable",
            source: "geckoterminal",
            unavailableReason: "Provider returned insufficient or flat candle movement.",
            candles: null,
          } satisfies FeedChartPreviewResult;
        }
        return {
          state: "live",
          source: "geckoterminal",
          unavailableReason: null,
          candles,
        } satisfies FeedChartPreviewResult;
      } catch (error) {
        return {
          state: "unavailable",
          source: "geckoterminal",
          unavailableReason: error instanceof Error ? error.message : "Chart preview provider failed.",
          candles: null,
        } satisfies FeedChartPreviewResult;
      } finally {
        clearTimeout(timeout);
      }
    })().finally(() => {
      feedChartPreviewInFlight.delete(cacheKey);
    });
    feedChartPreviewInFlight.set(cacheKey, request);
  }

  const value = await request;
  feedChartPreviewCache.set(cacheKey, { value, expiresAtMs: Date.now() + FEED_CHART_PREVIEW_CACHE_TTL_MS });
  return value;
}
