import { api } from "@/lib/api";
import { readSessionCache, writeSessionCache } from "@/lib/session-cache";

export type BatchedPostPriceSnapshot = {
  currentMcap: number | null;
  entryMcap: number | null;
  mcap1h: number | null;
  mcap6h: number | null;
  percentChange: number | null;
  confidenceScore: number | null;
  hotAlphaScore: number | null;
  earlyRunnerScore: number | null;
  highConvictionScore: number | null;
  roiCurrentPct: number | null;
  timingTier?: string | null;
  bundleRiskLabel?: string | null;
  tokenRiskScore?: number | null;
  liquidity?: number | null;
  volume24h?: number | null;
  holderCount?: number | null;
  largestHolderPct?: number | null;
  top10HolderPct?: number | null;
  bundledWalletCount?: number | null;
  estimatedBundledSupplyPct?: number | null;
  lastIntelligenceAt: string | null;
  trackingMode?: string | null;
  lastMcapUpdate: string | null;
  settled: boolean;
  settledAt: string | null;
};

type PendingResolver = (value: BatchedPostPriceSnapshot | null) => void;

const BATCH_WINDOW_MS = 24;
const MAX_BATCH_SIZE = 40;
const PRICE_CACHE_TTL_MS = 12_000;
const POST_PRICE_SESSION_CACHE_PREFIX = "phew.post-price.v1";

const pendingById = new Map<string, PendingResolver[]>();
const cacheById = new Map<string, { data: BatchedPostPriceSnapshot | null; expiresAtMs: number }>();
let flushTimer: ReturnType<typeof setTimeout> | null = null;

function buildPostPriceSessionCacheKey(postId: string): string {
  return `${POST_PRICE_SESSION_CACHE_PREFIX}:${postId}`;
}

function parseSnapshotTimestamp(value: string | null | undefined): number {
  if (!value) return 0;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function getSnapshotVersion(snapshot: BatchedPostPriceSnapshot | null | undefined): number {
  if (!snapshot) return 0;
  return Math.max(
    parseSnapshotTimestamp(snapshot.lastMcapUpdate),
    parseSnapshotTimestamp(snapshot.settledAt),
    parseSnapshotTimestamp(snapshot.lastIntelligenceAt)
  );
}

function mergeSnapshotWithFresherState(
  existing: BatchedPostPriceSnapshot | null | undefined,
  incoming: BatchedPostPriceSnapshot | null
): BatchedPostPriceSnapshot | null {
  if (!incoming) {
    return existing ?? null;
  }
  if (!existing) {
    return incoming;
  }

  const existingVersion = getSnapshotVersion(existing);
  const incomingVersion = getSnapshotVersion(incoming);

  if (existingVersion > incomingVersion) {
    return {
      ...incoming,
      currentMcap: existing.currentMcap,
      mcap1h: existing.mcap1h,
      mcap6h: existing.mcap6h,
      settled: existing.settled,
      settledAt: existing.settledAt,
      trackingMode: existing.trackingMode,
      lastMcapUpdate: existing.lastMcapUpdate,
      percentChange: existing.percentChange,
      confidenceScore: existing.confidenceScore,
      hotAlphaScore: existing.hotAlphaScore,
      earlyRunnerScore: existing.earlyRunnerScore,
      highConvictionScore: existing.highConvictionScore,
      roiCurrentPct: existing.roiCurrentPct,
      timingTier: existing.timingTier,
      bundleRiskLabel: existing.bundleRiskLabel,
      tokenRiskScore: existing.tokenRiskScore,
      liquidity: existing.liquidity,
      volume24h: existing.volume24h,
      holderCount: existing.holderCount,
      largestHolderPct: existing.largestHolderPct,
      top10HolderPct: existing.top10HolderPct,
      bundledWalletCount: existing.bundledWalletCount,
      estimatedBundledSupplyPct: existing.estimatedBundledSupplyPct,
      lastIntelligenceAt: existing.lastIntelligenceAt,
    };
  }

  return incoming;
}

function readCached(postId: string): BatchedPostPriceSnapshot | null | undefined {
  const cached = cacheById.get(postId);
  if (!cached) return undefined;
  if (cached.expiresAtMs <= Date.now()) {
    cacheById.delete(postId);
    return undefined;
  }
  return cached.data;
}

function readSessionCached(postId: string): BatchedPostPriceSnapshot | null | undefined {
  const cached = readSessionCache<BatchedPostPriceSnapshot>(
    buildPostPriceSessionCacheKey(postId),
    PRICE_CACHE_TTL_MS
  );
  return cached ?? undefined;
}

function resolvePending(ids: string[], payloadById: Record<string, BatchedPostPriceSnapshot>) {
  const now = Date.now();
  for (const id of ids) {
    const resolvers = pendingById.get(id) ?? [];
    pendingById.delete(id);
    const existingCached = cacheById.get(id)?.data ?? null;
    const data = mergeSnapshotWithFresherState(existingCached, payloadById[id] ?? null);
    cacheById.set(id, { data, expiresAtMs: now + PRICE_CACHE_TTL_MS });
    writeSessionCache(buildPostPriceSessionCacheKey(id), data);
    resolvers.forEach((resolve) => resolve(data));
  }
}

async function flushPriceBatch() {
  flushTimer = null;
  const ids = [...pendingById.keys()];
  if (ids.length === 0) return;

  for (let i = 0; i < ids.length; i += MAX_BATCH_SIZE) {
    const batchIds = ids.slice(i, i + MAX_BATCH_SIZE);
    try {
      const response = await api.post<Record<string, BatchedPostPriceSnapshot>>("/api/posts/prices", {
        ids: batchIds,
      });
      resolvePending(batchIds, response ?? {});
    } catch {
      resolvePending(batchIds, {});
    }
  }
}

function scheduleFlush() {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    void flushPriceBatch();
  }, BATCH_WINDOW_MS);
}

export function getPostPriceSnapshotBatched(postId: string): Promise<BatchedPostPriceSnapshot | null> {
  const cached = readCached(postId);
  if (cached !== undefined) {
    return Promise.resolve(cached);
  }

  const sessionCached = readSessionCached(postId);
  if (sessionCached !== undefined) {
    cacheById.set(postId, {
      data: sessionCached,
      expiresAtMs: Date.now() + PRICE_CACHE_TTL_MS,
    });
    return Promise.resolve(sessionCached);
  }

  return new Promise<BatchedPostPriceSnapshot | null>((resolve) => {
    const resolvers = pendingById.get(postId);
    if (resolvers) {
      resolvers.push(resolve);
    } else {
      pendingById.set(postId, [resolve]);
    }
    scheduleFlush();
  });
}
