import type { FeedChartPreview, Post } from "@/types";
import { api } from "@/lib/api";

type CachedFeedChart = {
  value: FeedChartPreview;
  expiresAt: number;
};

const feedChartPreviewCache = new Map<string, CachedFeedChart>();
const feedChartPreviewInFlight = new Map<string, Promise<FeedChartPreview>>();
const feedChartPreviewBackoffUntil = new Map<string, number>();

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

export function isLiveFeedChartPreview(preview: FeedChartPreview | null | undefined): preview is FeedChartPreview {
  return Boolean(preview && preview.state === "live" && Array.isArray(preview.candles) && preview.candles.length >= 8);
}

export function feedChartCacheKeys(post: Post, timeframe = "1h"): string[] {
  const payload = post.payload;
  const token = payload?.call?.token ?? payload?.chart?.token ?? post.tokenContext ?? null;
  const chain = token?.chain ?? "any";
  const address = token?.address?.toLowerCase();
  const symbol = token?.symbol?.toLowerCase();
  return [
    `post:${post.id}:${timeframe}`,
    address ? `token:${chain}:${address}:${timeframe}` : null,
    symbol ? `symbol:${symbol}:${timeframe}` : null,
  ].filter((key): key is string => Boolean(key));
}

export function getCachedFeedChart(keys: string[] | string | null): FeedChartPreview | null {
  const candidates = typeof keys === "string" ? [keys] : keys ?? [];
  for (const key of candidates) {
    const cached = feedChartPreviewCache.get(key);
    if (!cached) continue;
    if (cached.expiresAt <= Date.now()) {
      feedChartPreviewCache.delete(key);
      continue;
    }
    return cached.value;
  }
  return null;
}

function getStaleCachedFeedChart(keys: string[] | string | null): FeedChartPreview | null {
  const candidates = typeof keys === "string" ? [keys] : keys ?? [];
  for (const key of candidates) {
    const cached = feedChartPreviewCache.get(key);
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
    const ttl = isLiveFeedChartPreview(value) ? value.maxAgeMs ?? 60_000 : 8_000;
    feedChartPreviewCache.set(key, { value, expiresAt: Date.now() + ttl });
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

export function loadFeedChartOnce(key: string, loader: () => Promise<FeedChartPreview>): Promise<FeedChartPreview> {
  const inFlight = feedChartPreviewInFlight.get(key);
  if (inFlight) return inFlight;
  const request = loader().finally(() => {
    feedChartPreviewInFlight.delete(key);
  });
  feedChartPreviewInFlight.set(key, request);
  return request;
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
  const batch = [...feedChartBatchQueue.values()].slice(0, 12);
  for (const item of batch) feedChartBatchQueue.delete(item.key);
  try {
    const response = await api.post<{ results: Record<string, FeedChartPreview> }>("/api/feed/chart-previews", {
      tokens: batch.map((item) => ({
        key: item.key,
        tokenAddress: item.tokenAddress,
        pairAddress: item.pairAddress,
        chainType: item.chainType,
      })),
    });
    for (const item of batch) {
      const result = response.results[item.key];
      if (result) {
        setCachedFeedChart(item.cacheKeys, result);
        item.resolve(getCachedFeedChart(item.cacheKeys) ?? result);
      } else {
        item.reject(new Error("Chart preview missing from batch response"));
      }
    }
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
  if (cached) return Promise.resolve(cached);
  const stale = getStaleCachedFeedChart(params.cacheKeys);
  if ((feedChartPreviewBackoffUntil.get(params.key) ?? 0) > Date.now() && stale) {
    return Promise.resolve(stale);
  }
  const inFlight = feedChartPreviewInFlight.get(params.key);
  if (inFlight) return inFlight;
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
