import { prisma } from "../prisma.js";

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
  fetchedAt: string | null;
  maxAgeMs: number | null;
  unavailableReason: string | null;
  candles: FeedChartPreviewCandle[] | null;
};

type CacheEntry = {
  expiresAtMs: number;
  value: FeedChartPreviewResult;
};

const FEED_CHART_PREVIEW_CACHE_TTL_MS = 45_000;
const FEED_CHART_PREVIEW_STALE_FALLBACK_MS = 5 * 60_000;
const FEED_CHART_PREVIEW_TIMEOUT_MS = 2_200;
const FEED_CHART_PREVIEW_FRESH_MAX_AGE_MS = 10 * 60_000;
const BIRDEYE_API_KEY = process.env.BIRDEYE_API_KEY?.trim() || "";
const feedChartPreviewCache = new Map<string, CacheEntry>();
const feedChartPreviewLastGoodCache = new Map<string, CacheEntry>();
const feedChartPreviewInFlight = new Map<string, Promise<FeedChartPreviewResult>>();
let birdeyeChartPreviewCircuitOpenUntilMs = 0;

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
  if (high < Math.max(open, close) || low > Math.min(open, close)) return null;
  return {
    timestamp,
    open,
    high,
    low,
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
  if (high < Math.max(open, close) || low > Math.min(open, close)) return null;
  return {
    timestamp,
    open,
    high,
    low,
    close,
    volume: Math.max(0, volume),
  };
}

function isValidPreviewSeries(candles: FeedChartPreviewCandle[]): boolean {
  if (candles.length < 12) return false;
  const sorted = [...candles].sort((a, b) => a.timestamp - b.timestamp);
  for (let index = 1; index < sorted.length; index += 1) {
    const previous = sorted[index - 1];
    const current = sorted[index];
    if (!previous || !current || current.timestamp <= previous.timestamp) return false;
  }
  const valid = sorted.filter((candle) => {
    if (candle.open <= 0 || candle.high <= 0 || candle.low <= 0 || candle.close <= 0) return false;
    if (!Number.isFinite(candle.volume) || candle.volume < 0) return false;
    if (candle.high < Math.max(candle.open, candle.close) || candle.low > Math.min(candle.open, candle.close)) return false;
    const body = Math.abs(candle.close - candle.open);
    const range = candle.high - candle.low;
    if (range <= 0) return false;
    const basis = Math.max(candle.open, candle.close, candle.low);
    const rangePct = basis > 0 ? range / basis : 0;
    if (rangePct > 0.65) return false;
    if (body > 0 && range / body > 18 && rangePct > 0.12) return false;
    if (body === 0 && rangePct > 0.04) return false;
    return true;
  });
  if (valid.length < Math.max(12, Math.ceil(candles.length * 0.9))) return false;
  const minLow = Math.min(...valid.map((candle) => candle.low));
  const maxHigh = Math.max(...valid.map((candle) => candle.high));
  const firstOpen = valid[0]?.open ?? 0;
  const lastClose = valid[valid.length - 1]?.close ?? 0;
  const bodyCount = valid.filter((candle) => Math.abs(candle.close - candle.open) > candle.open * 0.0005).length;
  const rangePct = minLow > 0 ? ((maxHigh - minLow) / minLow) * 100 : 0;
  const movePct = firstOpen > 0 ? Math.abs(((lastClose - firstOpen) / firstOpen) * 100) : 0;
  const returns = valid.slice(1).map((candle, index) => {
    const previous = valid[index]?.close ?? candle.open;
    return previous > 0 ? Math.abs((candle.close - previous) / previous) : 0;
  });
  const extremeSingleBar = returns.some((value, index) => {
    const current = valid[index + 1];
    if (!current || value < 0.45) return false;
    const previousValues = returns.slice(Math.max(0, index - 5), index);
    const nextValues = returns.slice(index + 1, index + 6);
    const neighborMax = Math.max(0, ...previousValues, ...nextValues);
    return neighborMax < value / 8;
  });
  return !extremeSingleBar && rangePct >= 0.05 && rangePct <= 600 && (movePct >= 0.03 || bodyCount >= Math.ceil(valid.length * 0.25));
}

function newestCandleFresh(candles: FeedChartPreviewCandle[]): boolean {
  const newest = candles[candles.length - 1]?.timestamp;
  if (!newest) return false;
  return Date.now() - newest * 1000 <= FEED_CHART_PREVIEW_FRESH_MAX_AGE_MS;
}

async function getStoredSnapshotCandles(tokenAddress: string, chainType: string): Promise<FeedChartPreviewCandle[]> {
  const token = await prisma.token.findUnique({
    where: {
      chainType_address: {
        chainType,
        address: tokenAddress,
      },
    },
    select: {
      snapshots: {
        select: {
          capturedAt: true,
          priceUsd: true,
          marketCap: true,
          volume24h: true,
        },
        orderBy: { capturedAt: "desc" },
        take: 48,
      },
    },
  });
  if (!token?.snapshots.length) return [];

  const rows = [...token.snapshots].reverse();
  return rows
    .map((snapshot, index) => {
      const close = finite(snapshot.priceUsd) ?? finite(snapshot.marketCap);
      if (close === null || close <= 0) return null;
      const previous = index > 0 ? finite(rows[index - 1]?.priceUsd) ?? finite(rows[index - 1]?.marketCap) : close;
      const open = previous && previous > 0 ? previous : close;
      const high = Math.max(open, close);
      const low = Math.min(open, close);
      return {
        timestamp: Math.floor(snapshot.capturedAt.getTime() / 1000),
        open,
        high,
        low,
        close,
        volume: Math.max(0, finite(snapshot.volume24h) ?? 0),
      };
    })
    .filter((candle): candle is FeedChartPreviewCandle => Boolean(candle));
}

function unavailablePreview(source: string, unavailableReason: string): FeedChartPreviewResult {
  return {
    state: "unavailable",
    source,
    fetchedAt: new Date().toISOString(),
    maxAgeMs: FEED_CHART_PREVIEW_FRESH_MAX_AGE_MS,
    unavailableReason,
    candles: null,
  };
}

function isRateLimitResponse(status: number, bodyText = ""): boolean {
  return status === 429 || /too many requests|rate.?limit/i.test(bodyText);
}

function getLastGoodPreview(cacheKey: string): FeedChartPreviewResult | null {
  const cached = feedChartPreviewLastGoodCache.get(cacheKey);
  if (!cached || cached.expiresAtMs <= Date.now()) return null;
  if (cached.value.state === "live" && (!cached.value.candles || !isValidPreviewSeries(cached.value.candles))) {
    feedChartPreviewLastGoodCache.delete(cacheKey);
    return null;
  }
  return cached.value;
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
      fetchedAt: new Date().toISOString(),
      maxAgeMs: FEED_CHART_PREVIEW_FRESH_MAX_AGE_MS,
      unavailableReason: "No token or pair address is attached for market candles.",
      candles: null,
    };
  }

  const network = params.chainType === "solana" ? "solana" : "eth";
  const cacheKey = `${network}:${(pairAddress ?? tokenAddress ?? "").toLowerCase()}:minute:5`;
  const cached = feedChartPreviewCache.get(cacheKey);
  if (cached && cached.expiresAtMs > Date.now()) {
    if (cached.value.state !== "live" || (cached.value.candles && isValidPreviewSeries(cached.value.candles))) {
      return cached.value;
    }
    feedChartPreviewCache.delete(cacheKey);
  }

  let request = feedChartPreviewInFlight.get(cacheKey);
  if (!request) {
    request = (async () => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), FEED_CHART_PREVIEW_TIMEOUT_MS);
      try {
        if (network === "solana" && tokenAddress && BIRDEYE_API_KEY && birdeyeChartPreviewCircuitOpenUntilMs <= Date.now()) {
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
          const birdeyeBodyText = await birdeyeResponse.text();
          if (isRateLimitResponse(birdeyeResponse.status, birdeyeBodyText)) {
            birdeyeChartPreviewCircuitOpenUntilMs = Date.now() + 60_000;
            const lastGood = getLastGoodPreview(cacheKey);
            if (lastGood) return lastGood;
          }
          if (birdeyeResponse.ok) {
            const candles = parseBirdeyeCandles(JSON.parse(birdeyeBodyText));
            if (isValidPreviewSeries(candles) && newestCandleFresh(candles)) {
              return {
                state: "live",
                source: "birdeye",
                fetchedAt: new Date().toISOString(),
                maxAgeMs: FEED_CHART_PREVIEW_FRESH_MAX_AGE_MS,
                unavailableReason: null,
                candles,
              } satisfies FeedChartPreviewResult;
            }
          }
        }

        if (!pairAddress) {
          if (tokenAddress) {
            const storedCandles = await getStoredSnapshotCandles(tokenAddress, network === "solana" ? "solana" : "evm");
            if (isValidPreviewSeries(storedCandles) && newestCandleFresh(storedCandles)) {
              return {
                state: "live",
                source: "token-snapshots",
                fetchedAt: new Date().toISOString(),
                maxAgeMs: FEED_CHART_PREVIEW_FRESH_MAX_AGE_MS,
                unavailableReason: null,
                candles: storedCandles,
              } satisfies FeedChartPreviewResult;
            }
          }
          return unavailablePreview(
            network === "solana" ? "birdeye" : "geckoterminal",
            "No pair address is attached for fallback market candles."
          );
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
          return unavailablePreview("geckoterminal", `GeckoTerminal candles unavailable (${response.status}).`);
        }
        const candles = parseGeckoCandles(await response.json());
        if (!isValidPreviewSeries(candles) || !newestCandleFresh(candles)) {
          if (tokenAddress) {
            const storedCandles = await getStoredSnapshotCandles(tokenAddress, network === "solana" ? "solana" : "evm");
            if (isValidPreviewSeries(storedCandles) && newestCandleFresh(storedCandles)) {
              return {
                state: "live",
                source: "token-snapshots",
                fetchedAt: new Date().toISOString(),
                maxAgeMs: FEED_CHART_PREVIEW_FRESH_MAX_AGE_MS,
                unavailableReason: null,
                candles: storedCandles,
              } satisfies FeedChartPreviewResult;
            }
          }
          return unavailablePreview(
            "geckoterminal",
            !newestCandleFresh(candles)
              ? "Provider candles are stale for feed preview."
              : "Provider returned insufficient or flat candle movement."
          );
        }
        return {
          state: "live",
          source: "geckoterminal",
          fetchedAt: new Date().toISOString(),
          maxAgeMs: FEED_CHART_PREVIEW_FRESH_MAX_AGE_MS,
          unavailableReason: null,
          candles,
        } satisfies FeedChartPreviewResult;
      } catch (error) {
        const lastGood = getLastGoodPreview(cacheKey);
        if (lastGood) return lastGood;
        return unavailablePreview(
          "geckoterminal",
          error instanceof Error ? error.message : "Chart preview provider failed."
        );
      } finally {
        clearTimeout(timeout);
      }
    })().finally(() => {
      feedChartPreviewInFlight.delete(cacheKey);
    });
    feedChartPreviewInFlight.set(cacheKey, request);
  }

  const value = await request;
  if (value.state === "live") {
    feedChartPreviewCache.set(cacheKey, { value, expiresAtMs: Date.now() + FEED_CHART_PREVIEW_CACHE_TTL_MS });
    feedChartPreviewLastGoodCache.set(cacheKey, { value, expiresAtMs: Date.now() + FEED_CHART_PREVIEW_STALE_FALLBACK_MS });
  } else {
    const lastGood = getLastGoodPreview(cacheKey);
    if (lastGood) return lastGood;
    feedChartPreviewCache.set(cacheKey, { value, expiresAtMs: Date.now() + 5_000 });
  }
  return value;
}
