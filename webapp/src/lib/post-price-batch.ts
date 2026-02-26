import { api } from "@/lib/api";

export type BatchedPostPriceSnapshot = {
  currentMcap: number | null;
  entryMcap: number | null;
  mcap1h: number | null;
  mcap6h: number | null;
  percentChange: number | null;
  trackingMode?: string | null;
  lastMcapUpdate: string | null;
  settled: boolean;
  settledAt: string | null;
};

type PendingResolver = (value: BatchedPostPriceSnapshot | null) => void;

const BATCH_WINDOW_MS = 24;
const MAX_BATCH_SIZE = 40;
const PRICE_CACHE_TTL_MS = 4_000;

const pendingById = new Map<string, PendingResolver[]>();
const cacheById = new Map<string, { data: BatchedPostPriceSnapshot | null; expiresAtMs: number }>();
let flushTimer: ReturnType<typeof setTimeout> | null = null;

function readCached(postId: string): BatchedPostPriceSnapshot | null | undefined {
  const cached = cacheById.get(postId);
  if (!cached) return undefined;
  if (cached.expiresAtMs <= Date.now()) {
    cacheById.delete(postId);
    return undefined;
  }
  return cached.data;
}

function resolvePending(ids: string[], payloadById: Record<string, BatchedPostPriceSnapshot>) {
  const now = Date.now();
  for (const id of ids) {
    const resolvers = pendingById.get(id) ?? [];
    pendingById.delete(id);
    const data = payloadById[id] ?? null;
    cacheById.set(id, { data, expiresAtMs: now + PRICE_CACHE_TTL_MS });
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

