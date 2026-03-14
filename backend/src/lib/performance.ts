type RouteMetric = {
  count: number;
  totalDurationMs: number;
  maxDurationMs: number;
  slowCount: number;
  lastStatus: number;
  lastSeenAt: string;
};

type CacheMetric = {
  hits: number;
  misses: number;
  staleHits: number;
  lastSeenAt: string;
};

const ROUTE_SLOW_THRESHOLD_MS =
  Number.parseInt(process.env.ROUTE_SLOW_THRESHOLD_MS || "", 10) ||
  (process.env.NODE_ENV === "production" ? 700 : 1_200);
const ROUTE_SUMMARY_INTERVAL_MS =
  Number.parseInt(process.env.ROUTE_SUMMARY_INTERVAL_MS || "", 10) ||
  (process.env.NODE_ENV === "production" ? 60_000 : 20_000);
const CACHE_SUMMARY_INTERVAL_MS =
  Number.parseInt(process.env.CACHE_SUMMARY_INTERVAL_MS || "", 10) ||
  (process.env.NODE_ENV === "production" ? 60_000 : 20_000);

const routeMetrics = new Map<string, RouteMetric>();
const cacheMetrics = new Map<string, CacheMetric>();
let lastRouteSummaryAt = Date.now();
let lastCacheSummaryAt = Date.now();

function nowIso(): string {
  return new Date().toISOString();
}

function flushRouteMetricsIfDue(nowMs: number): void {
  if (nowMs - lastRouteSummaryAt < ROUTE_SUMMARY_INTERVAL_MS) {
    return;
  }

  const metrics = Array.from(routeMetrics.entries())
    .map(([label, metric]) => ({
      label,
      count: metric.count,
      avgDurationMs: Math.round(metric.totalDurationMs / Math.max(metric.count, 1)),
      maxDurationMs: metric.maxDurationMs,
      slowCount: metric.slowCount,
      lastStatus: metric.lastStatus,
      lastSeenAt: metric.lastSeenAt,
    }))
    .sort((a, b) => {
      if (b.maxDurationMs !== a.maxDurationMs) {
        return b.maxDurationMs - a.maxDurationMs;
      }
      return b.count - a.count;
    })
    .slice(0, 10);

  lastRouteSummaryAt = nowMs;
  if (metrics.length === 0) {
    return;
  }

  console.info("[perf] Route timing summary", {
    windowMs: ROUTE_SUMMARY_INTERVAL_MS,
    routesTracked: routeMetrics.size,
    metrics,
  });
  routeMetrics.clear();
}

function flushCacheMetricsIfDue(nowMs: number): void {
  if (nowMs - lastCacheSummaryAt < CACHE_SUMMARY_INTERVAL_MS) {
    return;
  }

  const metrics = Array.from(cacheMetrics.entries())
    .map(([cacheName, metric]) => {
      const total = metric.hits + metric.misses + metric.staleHits;
      return {
        cacheName,
        hits: metric.hits,
        misses: metric.misses,
        staleHits: metric.staleHits,
        hitRate: total > 0 ? Number(((metric.hits / total) * 100).toFixed(1)) : 0,
        lastSeenAt: metric.lastSeenAt,
      };
    })
    .sort((a, b) => b.hitRate - a.hitRate)
    .slice(0, 10);

  lastCacheSummaryAt = nowMs;
  if (metrics.length === 0) {
    return;
  }

  console.info("[perf] Cache hit summary", {
    windowMs: CACHE_SUMMARY_INTERVAL_MS,
    cachesTracked: cacheMetrics.size,
    metrics,
  });
  cacheMetrics.clear();
}

export function recordRouteTiming(params: {
  method: string;
  path: string;
  status: number;
  durationMs: number;
  requestId?: string | null;
}): void {
  const nowMs = Date.now();
  const label = `${params.method.toUpperCase()} ${params.path}`;
  const metric = routeMetrics.get(label) ?? {
    count: 0,
    totalDurationMs: 0,
    maxDurationMs: 0,
    slowCount: 0,
    lastStatus: params.status,
    lastSeenAt: nowIso(),
  };

  metric.count += 1;
  metric.totalDurationMs += params.durationMs;
  metric.maxDurationMs = Math.max(metric.maxDurationMs, params.durationMs);
  metric.lastStatus = params.status;
  metric.lastSeenAt = nowIso();
  if (params.durationMs >= ROUTE_SLOW_THRESHOLD_MS) {
    metric.slowCount += 1;
    console.warn("[perf] Slow route", {
      requestId: params.requestId ?? null,
      method: params.method.toUpperCase(),
      path: params.path,
      status: params.status,
      durationMs: params.durationMs,
    });
  }
  routeMetrics.set(label, metric);
  flushRouteMetricsIfDue(nowMs);
}

export function recordCacheResult(
  cacheName: string,
  result: "hit" | "miss" | "stale"
): void {
  const metric = cacheMetrics.get(cacheName) ?? {
    hits: 0,
    misses: 0,
    staleHits: 0,
    lastSeenAt: nowIso(),
  };

  if (result === "hit") {
    metric.hits += 1;
  } else if (result === "stale") {
    metric.staleHits += 1;
  } else {
    metric.misses += 1;
  }
  metric.lastSeenAt = nowIso();
  cacheMetrics.set(cacheName, metric);
  flushCacheMetricsIfDue(Date.now());
}
