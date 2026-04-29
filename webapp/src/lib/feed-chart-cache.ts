import type { FeedChartPreview, Post } from "@/types";

type CachedFeedChart = {
  value: FeedChartPreview;
  expiresAt: number;
};

const feedChartPreviewCache = new Map<string, CachedFeedChart>();
const feedChartPreviewInFlight = new Map<string, Promise<FeedChartPreview>>();

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
