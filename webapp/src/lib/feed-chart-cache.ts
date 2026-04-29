import type { FeedChartPreview, Post } from "@/types";
import { api } from "@/lib/api";

type CachedFeedChart = {
  value: FeedChartPreview;
  expiresAt: number;
};

const feedChartPreviewCache = new Map<string, CachedFeedChart>();
const feedChartPreviewInFlight = new Map<string, Promise<FeedChartPreview>>();
const feedChartPreviewBackoffUntil = new Map<string, number>();
const feedChartPreviewLastRequestedAt = new Map<string, number>();

type FeedChartBatchRequest = {
  key: string;
  cacheKeys: string[];
  tokenAddress: string;
  pairAddress: string | null;
  chainType: string | null;
  resolve: (value: FeedChartPreview) => void;
  reject: (reason?: unknown) => void;
};

const feedChartBatchQueue = new Map<string, FeedChartBatchRequest>();
let feedChartBatchTimer: ReturnType<typeof setTimeout> | null = null;
let feedChartBatchInFlightCount = 0;
const FEED_CHART_BATCH_MAX_CONCURRENCY = 2;
const FEED_CHART_MIN_REQUEST_INTERVAL_MS = 30_000;
const FEED_CHART_STORAGE_PREFIX = "phew.feed.chart-preview.";

export function isLiveFeedChartPreview(preview: FeedChartPreview | null | undefined): preview is FeedChartPreview {
  return Boolean(preview && preview.state === "live" && Array.isArray(preview.candles) && preview.candles.length >= 8);
}

export function feedChartCacheKeys(post: Post, timeframe = "1h"): string[] {
  const payload = post.payload;
  const token = payload?.call?.token ?? payload?.chart?.token ?? post.tokenContext ?? null;
  const chain = token?.chain ?? "any";
  const address = token?.address?.toLowerCase();
  const pairAddress = token?.pairAddress?.toLowerCase();
  const symbol = token?.symbol?.toLowerCase();
  return [
    pairAddress ? `pair:${chain}:${pairAddress}:${timeframe}` : null,
    address ? `token:${chain}:${address}:${timeframe}` : null,
    symbol ? `symbol:${symbol}:${timeframe}` : null,
  ].filter((key): key is string => Boolean(key));
}

function storageKey(key: string): string {
  return `${FEED_CHART_STORAGE_PREFIX}${key}`;
}

function readStoredChart(key: string): CachedFeedChart | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(storageKey(key));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedFeedChart;
    if (!parsed || typeof parsed.expiresAt !== "number" || !parsed.value) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeStoredChart(key: string, value: CachedFeedChart): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(storageKey(key), JSON.stringify(value));
  } catch {
    // Ignore quota/security errors; the in-memory cache still protects this tab.
  }
}

export function getCachedFeedChart(keys: string[] | string | null): FeedChartPreview | null {
  const candidates = typeof keys === "string" ? [keys] : keys ?? [];
  for (const key of candidates) {
    const cached = feedChartPreviewCache.get(key) ?? readStoredChart(key);
    if (!cached) continue;
    if (cached.expiresAt <= Date.now()) {
      feedChartPreviewCache.delete(key);
      continue;
    }
    feedChartPreviewCache.set(key, cached);
    return cached.value;
  }
  return null;
}

function getStaleCachedFeedChart(keys: string[] | string | null): FeedChartPreview | null {
  const candidates = typeof keys === "string" ? [keys] : keys ?? [];
  for (const key of candidates) {
    const cached = feedChartPreviewCache.get(key) ?? readStoredChart(key);
    if (cached) return cached.value;
  }
  return null;
}

export function setCachedFeedChart(keys: string[] | string | null, value: FeedChartPreview): void {
  const candidates = typeof keys === "string" ? [keys] : keys ?? [];
  if (!candidates.length) return;
  for (const key of candidates) {
    const existing = getCachedFeedChart(key);
    if (isLiveFeedChartPreview(existing) && !isLiveFeedChartPreview(value)) continue;
    const ttl = isLiveFeedChartPreview(value) ? value.maxAgeMs ?? 60_000 : 30_000;
    const entry = { value, expiresAt: Date.now() + ttl };
    feedChartPreviewCache.set(key, entry);
    writeStoredChart(key, entry);
  }
}

export function stabilizePostChartPreview(post: Post): Post {
  const payload = post.payload;
  const timeframe = payload?.chart?.timeframe ?? "1h";
  const preview = payload?.call?.chartPreview ?? payload?.chart?.chartPreview ?? null;
  const keys = feedChartCacheKeys(post, timeframe);
  if (isLiveFeedChartPreview(preview)) {
    setCachedFeedChart(keys, preview);
    return post;
  }
  const cached = getCachedFeedChart(keys);
  if (!isLiveFeedChartPreview(cached) || !payload) return post;
  if (payload.call) {
    return { ...post, payload: { ...payload, call: { ...payload.call, chartPreview: cached, hasChartPreview: true } } };
  }
  if (payload.chart) {
    return { ...post, payload: { ...payload, chart: { ...payload.chart, chartPreview: cached, hasChartPreview: true } } };
  }
  return post;
}

function scheduleFeedChartBatchFlush(): void {
  if (feedChartBatchTimer) return;
  feedChartBatchTimer = setTimeout(() => {
    feedChartBatchTimer = null;
    void flushFeedChartBatchQueue();
  }, 60);
}

async function flushFeedChartBatchQueue(): Promise<void> {
  if (feedChartBatchInFlightCount >= FEED_CHART_BATCH_MAX_CONCURRENCY || feedChartBatchQueue.size === 0) return;
  feedChartBatchInFlightCount += 1;
  const rawBatch = [...feedChartBatchQueue.values()].slice(0, 12);
  const batch = rawBatch.filter((item) => item.tokenAddress.trim().length > 0 && item.cacheKeys.length > 0);
  const invalidBatch = rawBatch.filter((item) => !batch.includes(item));
  for (const item of batch) feedChartBatchQueue.delete(item.key);
  for (const item of invalidBatch) {
    feedChartBatchQueue.delete(item.key);
    item.reject(new Error("Chart preview request was invalid"));
  }
  if (!batch.length) {
    feedChartBatchInFlightCount = Math.max(0, feedChartBatchInFlightCount - 1);
    if (feedChartBatchQueue.size > 0) scheduleFeedChartBatchFlush();
    return;
  }
  try {
    console.info("[feed-chart-cache] requesting batch", {
      batchSize: batch.length,
      queued: feedChartBatchQueue.size,
      dedupeHits: Math.max(0, rawBatch.length - batch.length),
    });
    const response = await api.post<{ results: Record<string, FeedChartPreview> }>("/api/feed/chart-previews", {
      tokens: batch.map((item) => ({
        key: item.key,
        tokenAddress: item.tokenAddress,
        pairAddress: item.pairAddress,
        chainType: item.chainType,
      })),
    });
    let cacheHits = 0;
    for (const item of batch) {
      const result = response.results[item.key];
      if (result) {
        setCachedFeedChart(item.cacheKeys, result);
        const cached = getCachedFeedChart(item.cacheKeys) ?? result;
        if (cached === result) cacheHits += 1;
        item.resolve(cached);
      } else {
        item.reject(new Error("Chart preview missing from batch response"));
      }
    }
    console.info("[feed-chart-cache] batch complete", {
      batchSize: batch.length,
      cacheHits,
      liveResults: Object.values(response.results).filter(isLiveFeedChartPreview).length,
    });
  } catch (error) {
    const backoffUntil = Date.now() + 60_000;
    for (const item of batch) {
      feedChartPreviewBackoffUntil.set(item.key, backoffUntil);
      const stale = getStaleCachedFeedChart(item.cacheKeys);
      if (stale) item.resolve(stale);
      else item.reject(error);
    }
  } finally {
    feedChartBatchInFlightCount = Math.max(0, feedChartBatchInFlightCount - 1);
    if (feedChartBatchQueue.size > 0) scheduleFeedChartBatchFlush();
  }
}

export function loadBatchedFeedChartPreview(params: {
  key: string;
  cacheKeys: string[];
  tokenAddress: string;
  pairAddress: string | null;
  chainType: string | null;
}): Promise<FeedChartPreview> {
  const cached = getCachedFeedChart(params.cacheKeys);
  if (cached) {
    console.info("[feed-chart-cache] cache hit", { key: params.key });
    return Promise.resolve(cached);
  }
  const stale = getStaleCachedFeedChart(params.cacheKeys);
  if ((feedChartPreviewBackoffUntil.get(params.key) ?? 0) > Date.now() && stale) {
    console.info("[feed-chart-cache] backoff stale hit", { key: params.key });
    return Promise.resolve(stale);
  }
  const inFlight = feedChartPreviewInFlight.get(params.key);
  if (inFlight) {
    console.info("[feed-chart-cache] dedupe hit", { key: params.key });
    return inFlight;
  }
  const lastRequestedAt = feedChartPreviewLastRequestedAt.get(params.key) ?? 0;
  if (Date.now() - lastRequestedAt < FEED_CHART_MIN_REQUEST_INTERVAL_MS && stale) {
    console.info("[feed-chart-cache] frequency stale hit", { key: params.key });
    return Promise.resolve(stale);
  }
  feedChartPreviewLastRequestedAt.set(params.key, Date.now());
  const request = new Promise<FeedChartPreview>((resolve, reject) => {
    feedChartBatchQueue.set(params.key, {
      ...params,
      resolve,
      reject,
    });
    scheduleFeedChartBatchFlush();
  }).finally(() => {
    feedChartPreviewInFlight.delete(params.key);
  });
  feedChartPreviewInFlight.set(params.key, request);
  return request;
}
