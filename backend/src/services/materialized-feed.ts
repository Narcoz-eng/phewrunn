import { cacheGetJson, cacheSetJson } from "../lib/redis.js";
import { isPrismaPoolPressureActive } from "../prisma.js";
import {
  listFeedCalls,
  type EnrichedCall,
  type FeedArgs,
  type FeedKind,
  type FeedListResult,
} from "./intelligence/engine.js";

type MaterializedFeedEnvelope = {
  cachedAtMs: number;
  result: FeedListResult;
};

type MaterializedFeedRead = FeedListResult & {
  materialized: {
    source: "memory" | "redis" | "cold" | "passthrough";
    cacheState: "fresh" | "stale" | "missing" | "passthrough";
    refreshQueued: boolean;
    latencyMs: number;
  };
};

const MATERIALIZED_FEED_LIMIT = 40;
const MATERIALIZED_FEED_TTL_MS = 45_000;
const MATERIALIZED_FEED_STALE_MS = 10 * 60_000;
const MATERIALIZED_FEED_COLD_WAIT_MS = 650;
const MATERIALIZED_FEED_REFRESH_MIN_MS = 20_000;
const MATERIALIZED_FEED_KINDS: FeedKind[] = ["latest", "hot-alpha", "early-runners", "high-conviction"];

const materializedFeedMemory = new Map<string, MaterializedFeedEnvelope>();
const materializedFeedRefreshInFlight = new Map<string, Promise<MaterializedFeedEnvelope | null>>();
const materializedFeedLastRefreshStartedAt = new Map<string, number>();

function clone<T>(value: T): T {
  if (typeof globalThis.structuredClone === "function") return globalThis.structuredClone(value);
  return JSON.parse(JSON.stringify(value)) as T;
}

function canUseMaterializedFeed(args: FeedArgs): boolean {
  return args.kind !== "following" && !args.search?.trim() && !args.postType;
}

function buildMaterializedFeedKey(kind: FeedKind): string {
  return `feed:materialized:v2:${kind}`;
}

function buildRedisFeedKey(kind: FeedKind): string {
  return `phew:${buildMaterializedFeedKey(kind)}`;
}

function readMemoryEnvelope(key: string): MaterializedFeedEnvelope | null {
  const cached = materializedFeedMemory.get(key);
  if (!cached) return null;
  if (Date.now() - cached.cachedAtMs > MATERIALIZED_FEED_STALE_MS) {
    materializedFeedMemory.delete(key);
    return null;
  }
  return clone(cached);
}

async function readMaterializedEnvelope(kind: FeedKind): Promise<{ envelope: MaterializedFeedEnvelope | null; source: "memory" | "redis" | "cold" }> {
  const key = buildMaterializedFeedKey(kind);
  const memory = readMemoryEnvelope(key);
  if (memory) return { envelope: memory, source: "memory" };

  const redisEnvelope = await cacheGetJson<MaterializedFeedEnvelope>(buildRedisFeedKey(kind));
  if (redisEnvelope && Date.now() - redisEnvelope.cachedAtMs <= MATERIALIZED_FEED_STALE_MS) {
    materializedFeedMemory.set(key, clone(redisEnvelope));
    return { envelope: redisEnvelope, source: "redis" };
  }

  return { envelope: null, source: "cold" };
}

function sliceMaterializedResult(result: FeedListResult, args: FeedArgs, limit: number): FeedListResult {
  const startIndex = args.cursor
    ? Math.max(0, result.items.findIndex((item) => item.id === args.cursor) + 1)
    : 0;
  const items = result.items.slice(startIndex, startIndex + limit);
  const nextItem = result.items[startIndex + limit] as EnrichedCall | undefined;
  return {
    ...result,
    items,
    hasMore: Boolean(nextItem),
    nextCursor: nextItem && items.length === limit ? items[items.length - 1]?.id ?? null : null,
    totalItems: result.items.length,
    degraded: false,
  };
}

async function refreshMaterializedFeed(kind: FeedKind): Promise<MaterializedFeedEnvelope | null> {
  const key = buildMaterializedFeedKey(kind);
  const current = materializedFeedRefreshInFlight.get(key);
  if (current) return current;

  const startedAt = Date.now();
  const lastStartedAt = materializedFeedLastRefreshStartedAt.get(key) ?? 0;
  if (startedAt - lastStartedAt < MATERIALIZED_FEED_REFRESH_MIN_MS) {
    return readMemoryEnvelope(key);
  }

  materializedFeedLastRefreshStartedAt.set(key, startedAt);
  const request = (async () => {
    try {
      const result = await listFeedCalls({
        kind,
        viewerId: null,
        limit: MATERIALIZED_FEED_LIMIT,
        cursor: null,
        search: null,
        postType: undefined,
      });
      const envelope: MaterializedFeedEnvelope = {
        cachedAtMs: Date.now(),
        result: {
          ...result,
          degraded: false,
        },
      };
      materializedFeedMemory.set(key, clone(envelope));
      void cacheSetJson(buildRedisFeedKey(kind), envelope, MATERIALIZED_FEED_STALE_MS);
      console.info("[feed/materialized] refresh complete", {
        kind,
        itemCount: result.items.length,
        latencyMs: Date.now() - startedAt,
        selectedChartPreviews: result.debugCounts?.selectedChartPreviews ?? null,
      });
      return envelope;
    } catch (error) {
      console.warn("[feed/materialized] refresh failed", {
        kind,
        latencyMs: Date.now() - startedAt,
        message: error instanceof Error ? error.message : String(error),
      });
      return null;
    } finally {
      materializedFeedRefreshInFlight.delete(key);
    }
  })();

  materializedFeedRefreshInFlight.set(key, request);
  return request;
}

function queueMaterializedRefresh(kind: FeedKind): boolean {
  const key = buildMaterializedFeedKey(kind);
  if (materializedFeedRefreshInFlight.has(key)) return false;
  void refreshMaterializedFeed(kind);
  return true;
}

function emptyMaterializedResult(args: FeedArgs): FeedListResult {
  return {
    items: [],
    hasMore: false,
    nextCursor: null,
    totalItems: 0,
    degraded: false,
    debugCounts: {
      backendReturned: 0,
      afterKindFilter: 0,
      afterRanking: 0,
      selected: 0,
      alphaCandidates: 0,
      selectedCallCandidates: 0,
      selectedChartPreviews: 0,
      hidden: 0,
    },
  };
}

export async function listMaterializedFeedCalls(args: FeedArgs): Promise<MaterializedFeedRead> {
  const startedAt = Date.now();
  const limit = Math.max(1, Math.min(40, args.limit ?? 10));

  if (!canUseMaterializedFeed(args)) {
    const result = await listFeedCalls(args);
    return {
      ...result,
      materialized: {
        source: "passthrough",
        cacheState: "passthrough",
        refreshQueued: false,
        latencyMs: Date.now() - startedAt,
      },
    };
  }

  const { envelope, source } = await readMaterializedEnvelope(args.kind);
  const ageMs = envelope ? Date.now() - envelope.cachedAtMs : null;
  const cacheState = envelope && ageMs !== null && ageMs <= MATERIALIZED_FEED_TTL_MS ? "fresh" : envelope ? "stale" : "missing";
  let refreshQueued = false;

  if (cacheState !== "fresh") {
    refreshQueued = queueMaterializedRefresh(args.kind);
  }

  if (envelope) {
    const result = sliceMaterializedResult(envelope.result, args, limit);
    console.info("[feed/materialized] read", {
      kind: args.kind,
      source,
      cacheState,
      ageMs,
      selected: result.items.length,
      totalItems: result.totalItems,
      refreshQueued,
      latencyMs: Date.now() - startedAt,
    });
    return {
      ...result,
      materialized: {
        source,
        cacheState,
        refreshQueued,
        latencyMs: Date.now() - startedAt,
      },
    };
  }

  if (!(await isPrismaPoolPressureActive())) {
    const coldRefresh = refreshMaterializedFeed(args.kind);
    const coldEnvelope = await Promise.race([
      coldRefresh,
      new Promise<null>((resolve) => setTimeout(() => resolve(null), MATERIALIZED_FEED_COLD_WAIT_MS)),
    ]);
    if (coldEnvelope) {
      const result = sliceMaterializedResult(coldEnvelope.result, args, limit);
      return {
        ...result,
        materialized: {
          source: "cold",
          cacheState: "missing",
          refreshQueued: false,
          latencyMs: Date.now() - startedAt,
        },
      };
    }
  }

  console.warn("[feed/materialized] cold cache missing; serving non-degraded empty shell", {
    kind: args.kind,
    refreshQueued: true,
    latencyMs: Date.now() - startedAt,
  });
  return {
    ...emptyMaterializedResult(args),
    materialized: {
      source: "cold",
      cacheState: "missing",
      refreshQueued: true,
      latencyMs: Date.now() - startedAt,
    },
  };
}

export function prewarmMaterializedFeeds(): void {
  for (const kind of MATERIALIZED_FEED_KINDS) {
    queueMaterializedRefresh(kind);
  }
}

export function startMaterializedFeedPrewarmLoop(opts?: { canRun?: () => boolean }): void {
  const run = () => {
    if (opts?.canRun && !opts.canRun()) return;
    prewarmMaterializedFeeds();
  };
  setTimeout(run, 1_500);
  setInterval(run, 45_000);
}
