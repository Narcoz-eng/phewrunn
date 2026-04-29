import { Prisma } from "@prisma/client";
import { cacheGetJson, cacheSetJson } from "../lib/redis.js";
import { prisma } from "../prisma.js";
import {
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
    source: "memory" | "redis" | "stored-db" | "latest-cache" | "following-db";
    cacheState: "fresh" | "stale" | "warming" | "direct";
    refreshQueued: boolean;
    latencyMs: number;
  };
};

type LightweightFeedPost = Awaited<ReturnType<typeof listLightweightPosts>>[number];

const MATERIALIZED_FEED_LIMIT = 40;
const MATERIALIZED_FEED_TTL_MS = 45_000;
const MATERIALIZED_FEED_STALE_MS = 10 * 60_000;
const MATERIALIZED_FEED_REFRESH_MIN_MS = 20_000;
const MATERIALIZED_FEED_KINDS: FeedKind[] = ["latest", "hot-alpha", "early-runners", "high-conviction"];

const materializedFeedMemory = new Map<string, MaterializedFeedEnvelope>();
const materializedFeedRefreshInFlight = new Map<string, Promise<MaterializedFeedEnvelope | null>>();
const materializedFeedLastRefreshStartedAt = new Map<string, number>();

const LIGHTWEIGHT_FEED_SELECT = {
  id: true,
  content: true,
  postType: true,
  pollExpiresAt: true,
  authorId: true,
  tokenId: true,
  communityId: true,
  contractAddress: true,
  chainType: true,
  tokenName: true,
  tokenSymbol: true,
  tokenImage: true,
  dexscreenerUrl: true,
  entryMcap: true,
  currentMcap: true,
  lastMcapUpdate: true,
  viewCount: true,
  confidenceScore: true,
  hotAlphaScore: true,
  earlyRunnerScore: true,
  highConvictionScore: true,
  timingTier: true,
  roiPeakPct: true,
  roiCurrentPct: true,
  threadCount: true,
  trustedTraderCount: true,
  sentimentScore: true,
  createdAt: true,
  updatedAt: true,
  author: {
    select: {
      id: true,
      name: true,
      username: true,
      image: true,
      level: true,
      xp: true,
      isVerified: true,
      trustScore: true,
      reputationTier: true,
    },
  },
  token: {
    select: {
      id: true,
      chainType: true,
      address: true,
      symbol: true,
      name: true,
      imageUrl: true,
      dexscreenerUrl: true,
      pairAddress: true,
      liquidity: true,
      volume24h: true,
      holderCount: true,
      tokenRiskScore: true,
      bundleRiskLabel: true,
    },
  },
  community: {
    select: {
      id: true,
      tokenId: true,
      xCashtag: true,
      token: {
        select: {
          id: true,
          address: true,
          chainType: true,
          symbol: true,
          name: true,
          imageUrl: true,
          dexscreenerUrl: true,
        },
      },
    },
  },
  _count: {
    select: {
      likes: true,
      comments: true,
      reposts: true,
      reactions: true,
    },
  },
} as const;

function clone<T>(value: T): T {
  if (typeof globalThis.structuredClone === "function") return globalThis.structuredClone(value);
  return JSON.parse(JSON.stringify(value)) as T;
}

function toFinite(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function signalCoverage(post: LightweightFeedPost) {
  const hasStoredSignal =
    toFinite(post.confidenceScore) !== null ||
    toFinite(post.highConvictionScore) !== null ||
    toFinite(post.hotAlphaScore) !== null ||
    toFinite(post.earlyRunnerScore) !== null;
  return {
    state: hasStoredSignal ? "partial" as const : "unavailable" as const,
    source: hasStoredSignal ? "post-signal" : "unavailable",
    updatedAt: post.updatedAt.toISOString(),
    maxAgeMs: 10 * 60_000,
    unavailableReason: hasStoredSignal ? null : "Signal coverage is still developing.",
  };
}

function tokenContext(post: LightweightFeedPost) {
  const token = post.token;
  const address = token?.address ?? post.contractAddress ?? null;
  if (!address && !post.tokenSymbol && !post.tokenName) return null;
  return {
    id: token?.id ?? post.tokenId ?? null,
    address,
    chain: token?.chainType ?? post.chainType ?? null,
    symbol: token?.symbol ?? post.tokenSymbol ?? null,
    name: token?.name ?? post.tokenName ?? null,
    logo: token?.imageUrl ?? post.tokenImage ?? null,
    pairAddress: token?.pairAddress ?? null,
    dexUrl: token?.dexscreenerUrl ?? post.dexscreenerUrl ?? null,
  };
}

function inferDirection(content: string): "LONG" | "SHORT" | null {
  const normalized = content.toLowerCase();
  if (normalized.includes(" short") || normalized.startsWith("short ") || normalized.includes(" bearish")) return "SHORT";
  if (normalized.includes(" long") || normalized.startsWith("long ") || normalized.includes(" bullish")) return "LONG";
  return null;
}

function lightweightEngagementScore(post: LightweightFeedPost): number {
  return (
    post._count.likes +
    post._count.comments * 2 +
    post._count.reposts * 3 +
    post._count.reactions +
    Math.min(40, post.viewCount / 20)
  );
}

function postTypePriority(postType: string | null | undefined): number {
  if (postType === "alpha" || postType === "chart") return 600;
  if (postType === "raid" || postType === "news") return 320;
  if (postType === "poll" || postType === "discussion") return -220;
  return 0;
}

function lightweightProductScore(post: LightweightFeedPost, confidenceScore: number): number {
  const signalScore = Math.max(
    confidenceScore,
    toFinite(post.hotAlphaScore) ?? 0,
    toFinite(post.earlyRunnerScore) ?? 0,
    toFinite(post.highConvictionScore) ?? 0
  );
  const tokenBoost = post.contractAddress || post.token?.address || post.tokenId ? 90 : 0;
  const smartMoneyBoost = post.trustedTraderCount > 0 ? Math.min(90, post.trustedTraderCount * 12) : 0;
  const socialPenalty =
    post.postType === "poll" || post.postType === "discussion"
      ? lightweightEngagementScore(post) >= 24
        ? 60
        : -260
      : 0;
  return postTypePriority(post.postType) + signalScore * 2.2 + tokenBoost + smartMoneyBoost + lightweightEngagementScore(post) + socialPenalty;
}

function productReasonsForLightweightPost(post: LightweightFeedPost, token: ReturnType<typeof tokenContext>): string[] {
  const reasons: string[] = [];
  if (post.postType === "alpha" || post.postType === "chart") reasons.push("Alpha setup");
  if (post.trustedTraderCount > 0) reasons.push("Smart money detected");
  if ((toFinite(post.highConvictionScore) ?? 0) >= 70) reasons.push("High conviction");
  if ((toFinite(post.hotAlphaScore) ?? 0) >= 70) reasons.push("Hot alpha");
  if (post.postType === "raid") reasons.push("Raid pressure");
  if (post.postType === "news") reasons.push("Market update");
  if ((post.postType === "poll" || post.postType === "discussion") && lightweightEngagementScore(post) >= 24) reasons.push("Community momentum");
  if (!reasons.length && token?.address) reasons.push("Token setup");
  return reasons.slice(0, 3);
}

function lightweightPayload(post: LightweightFeedPost, token: ReturnType<typeof tokenContext>, coverage: ReturnType<typeof signalCoverage>) {
  const body = post.content.replace(/^\[(alpha|chart|poll|raid|news|discussion)\]\s*/i, "").trim();
  const score = toFinite(post.confidenceScore) ?? toFinite(post.highConvictionScore) ?? null;
  const direction = inferDirection(post.content);
  const market = {
    entry: toFinite(post.entryMcap) !== null ? { label: "Entry MCap", value: toFinite(post.entryMcap), unit: "usd" as const, valueType: "historical" as const, source: "post" } : null,
    current: toFinite(post.currentMcap) !== null ? { label: "Current MCap", value: toFinite(post.currentMcap), unit: "usd" as const, valueType: post.lastMcapUpdate ? "live" as const : "stale" as const, source: "post" } : null,
    liveMove: toFinite(post.roiCurrentPct) !== null ? { label: "Live Move", value: toFinite(post.roiCurrentPct), unit: "pct" as const, valueType: "live" as const, source: "post" } : null,
    peakMove: toFinite(post.roiPeakPct) !== null ? { label: "Peak Move", value: toFinite(post.roiPeakPct), unit: "pct" as const, valueType: "historical" as const, source: "post" } : null,
  };
  const callPayload = {
    title: token?.symbol ? `$${token.symbol}${direction ? ` ${direction}` : ""}` : post.tokenSymbol ?? "Alpha",
    thesis: body || post.content,
    direction,
    token,
    metrics: [
      score !== null ? { label: "Signal", value: score, unit: "score" as const } : null,
      market.liveMove?.value !== null && market.liveMove ? { label: "Live Move", value: market.liveMove.value, unit: "pct" as const } : null,
    ].filter((item): item is { label: string; value: number; unit: "score" | "pct" } => Boolean(item)),
    market,
    targets: [],
    stopLoss: null,
    confidence: score,
    needsChart: Boolean(token?.address),
    hasChartPreview: false,
    signalScore: score,
    signalLabel: score !== null && score >= 70 ? "Strong" : score !== null && score >= 40 ? "Developing" : null,
    chartPreview: null,
  };

  if (post.postType === "discussion" || !token?.address) {
    return {
      call: null,
      chart: null,
      poll: null,
      raid: null,
      news: null,
      whale: null,
      discussion: { body },
    };
  }

  if (post.postType === "chart") {
    return {
      call: null,
      chart: {
        title: callPayload.title,
        thesis: body || post.content,
        token,
        timeframe: "1h",
        hasChartPreview: false,
        chartPreview: null,
      },
      poll: null,
      raid: null,
      news: null,
      whale: null,
      discussion: null,
    };
  }

  return {
    call: callPayload,
    chart: null,
    poll: null,
    raid: null,
    news: null,
    whale: null,
    discussion: null,
  };
}

function buildLightweightFeedItem(post: LightweightFeedPost): EnrichedCall {
  const token = tokenContext(post);
  const signal = signalCoverage(post);
  const confidenceScore = toFinite(post.confidenceScore) ?? toFinite(post.highConvictionScore) ?? 0;
  const payload = lightweightPayload(post, token, signal);
  const productReasons = productReasonsForLightweightPost(post, token);
  return {
    ...post,
    itemType: "post",
    payload,
    poll: null,
    isLiked: false,
    isReposted: false,
    isFollowingAuthor: false,
    tokenContext: token,
    signal: {
      aiScore: confidenceScore || null,
      aiScoreCoverage: signal,
      convictionLabel: confidenceScore >= 70 ? "Strong" : confidenceScore >= 40 ? "Developing" : null,
      momentumScore: toFinite(post.hotAlphaScore),
      smartMoneyScore: post.trustedTraderCount > 0 ? Math.min(100, post.trustedTraderCount * 12) : null,
      riskScore: post.token?.tokenRiskScore ?? null,
      riskLabel: post.token?.bundleRiskLabel ?? null,
      scoreReasons: productReasons,
    },
    engagement: {
      likes: post._count.likes,
      comments: post._count.comments,
      reposts: post._count.reposts,
      reactions: post._count.reactions,
      views: post.viewCount,
      velocity: 0,
    },
    coverage: {
      signal,
      candles: {
        state: token?.address ? "partial" : "unavailable",
        source: token?.address ? "chart-preview" : "unavailable",
        updatedAt: post.updatedAt.toISOString(),
        maxAgeMs: 10 * 60_000,
        unavailableReason: token?.address ? "Chart preview is not ready for this setup." : "No token is attached.",
      },
    },
    feedScore: lightweightProductScore(post, confidenceScore),
    feedReasons: productReasons,
    scoreReasons: productReasons,
    repostContext: null,
    currentReactionType: null,
    reactionCounts: {},
    confidenceScore,
    hotAlphaScore: toFinite(post.hotAlphaScore) ?? 0,
    earlyRunnerScore: toFinite(post.earlyRunnerScore) ?? 0,
    highConvictionScore: toFinite(post.highConvictionScore) ?? 0,
    marketHealthScore: 0,
    setupQualityScore: 0,
    opportunityScore: 0,
    dataReliabilityScore: 0,
    activityStatus: token?.address ? "active" : "developing",
    activityStatusLabel: token?.address ? "Active setup" : "Developing",
    isTradable: Boolean(token?.address),
    bullishSignalsSuppressed: false,
    timingTier: post.timingTier,
    firstCallerRank: null,
    roiPeakPct: post.roiPeakPct,
    roiCurrentPct: post.roiCurrentPct,
    threadCount: post.threadCount,
    trustedTraderCount: post.trustedTraderCount,
    entryQualityScore: 0,
    bundlePenaltyScore: 0,
    sentimentScore: post.sentimentScore ?? 0,
    tokenRiskScore: post.token?.tokenRiskScore ?? null,
    bundleRiskLabel: post.token?.bundleRiskLabel ?? null,
    liquidity: post.token?.liquidity ?? null,
    volume24h: post.token?.volume24h ?? null,
    holderCount: post.token?.holderCount ?? null,
    largestHolderPct: null,
    top10HolderPct: null,
    bundledWalletCount: null,
    estimatedBundledSupplyPct: null,
    bundleClusters: [],
    radarReasons: [],
  } as unknown as EnrichedCall;
}

async function listLightweightPosts(args: FeedArgs, limit: number) {
  const followed =
    args.kind === "following" && args.viewerId
      ? await Promise.all([
          prisma.follow.findMany({ where: { followerId: args.viewerId }, select: { followingId: true } }),
          prisma.tokenFollow.findMany({ where: { userId: args.viewerId }, select: { tokenId: true } }),
        ])
      : null;
  const followedTraderIds = followed?.[0].map((item) => item.followingId) ?? [];
  const followedTokenIds = followed?.[1].map((item) => item.tokenId) ?? [];
  if (args.kind === "following" && followedTraderIds.length === 0 && followedTokenIds.length === 0) return [];

  const whereClauses: Prisma.PostWhereInput[] = [];
  if (args.cursor) {
    whereClauses.push({ createdAt: { lt: new Date(Number.isFinite(Number(args.cursor)) ? Number(args.cursor) : Date.now()) } });
  }
  if (args.postType) {
    whereClauses.push({ postType: args.postType });
  }
  const search = args.search?.trim();
  if (search) {
    whereClauses.push({
      OR: [
        { content: { contains: search, mode: "insensitive" } },
        { tokenSymbol: { contains: search.replace(/^\$/, ""), mode: "insensitive" } },
        { tokenName: { contains: search, mode: "insensitive" } },
        { contractAddress: { contains: search, mode: "insensitive" } },
        { author: { username: { contains: search.replace(/^@/, ""), mode: "insensitive" } } },
        { author: { name: { contains: search, mode: "insensitive" } } },
      ],
    });
  }
  if (args.kind === "following") {
    whereClauses.push({
      OR: [
        ...(followedTraderIds.length ? [{ authorId: { in: followedTraderIds } }] : []),
        ...(followedTokenIds.length ? [{ tokenId: { in: followedTokenIds } }] : []),
      ],
    });
  } else if (args.kind === "hot-alpha" || args.kind === "high-conviction") {
    whereClauses.push({ postType: { in: ["alpha", "chart"] } });
  } else if (args.kind === "early-runners") {
    whereClauses.push({ postType: { in: ["raid", "alpha", "chart"] } });
  }

  const where = whereClauses.length === 0 ? undefined : whereClauses.length === 1 ? whereClauses[0] : { AND: whereClauses };

  return prisma.post.findMany({
    where,
    select: LIGHTWEIGHT_FEED_SELECT,
    orderBy:
      args.kind === "hot-alpha"
        ? [{ hotAlphaScore: "desc" }, { highConvictionScore: "desc" }, { confidenceScore: "desc" }, { createdAt: "desc" }]
        : args.kind === "high-conviction"
          ? [{ highConvictionScore: "desc" }, { confidenceScore: "desc" }, { hotAlphaScore: "desc" }, { createdAt: "desc" }]
          : args.kind === "early-runners"
            ? [{ earlyRunnerScore: "desc" }, { hotAlphaScore: "desc" }, { createdAt: "desc" }]
            : args.kind === "latest"
              ? [
                  { highConvictionScore: "desc" },
                  { hotAlphaScore: "desc" },
                  { earlyRunnerScore: "desc" },
                  { createdAt: "desc" },
                ]
              : [{ createdAt: "desc" }],
    take: limit + 1,
  });
}

async function listLatestAlphaInventory(args: FeedArgs, limit: number): Promise<LightweightFeedPost[]> {
  if (args.kind === "following") return [];
  return prisma.post.findMany({
    where: {
      ...(args.cursor ? { createdAt: { lt: new Date(Number.isFinite(Number(args.cursor)) ? Number(args.cursor) : Date.now()) } } : {}),
      postType: { in: ["alpha", "chart", "raid", "news"] },
    },
    select: LIGHTWEIGHT_FEED_SELECT,
    orderBy: [
      { highConvictionScore: "desc" },
      { hotAlphaScore: "desc" },
      { earlyRunnerScore: "desc" },
      { createdAt: "desc" },
    ],
    take: limit + 1,
  });
}

async function listLightweightFeed(args: FeedArgs, limit: number): Promise<FeedListResult> {
  let rows = await listLightweightPosts(args, limit);
  if (args.kind !== "following" && !args.search?.trim() && !args.postType && rows.length === 0) {
    rows = await listLatestAlphaInventory(args, limit);
  }
  const rankedRows = [...rows].sort((left, right) => {
    const leftScore = lightweightProductScore(left, toFinite(left.confidenceScore) ?? toFinite(left.highConvictionScore) ?? 0);
    const rightScore = lightweightProductScore(right, toFinite(right.confidenceScore) ?? toFinite(right.highConvictionScore) ?? 0);
    if (rightScore !== leftScore) return rightScore - leftScore;
    return right.createdAt.getTime() - left.createdAt.getTime();
  });
  const items = rankedRows.slice(0, limit).map(buildLightweightFeedItem);
  return {
    items,
    hasMore: rows.length > limit,
    nextCursor: rows.length > limit ? String(rows[limit - 1]?.createdAt.getTime() ?? "") : null,
    totalItems: rows.length,
    degraded: false,
    debugCounts: {
      backendReturned: rows.length,
      afterKindFilter: rows.length,
      afterRanking: rows.length,
      selected: items.length,
      alphaCandidates: items.filter((item) => item.payload.call || item.payload.chart).length,
      selectedCallCandidates: items.filter((item) => item.payload.call || item.payload.chart).length,
      selectedChartPreviews: 0,
      hidden: 0,
    },
  };
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

async function readMaterializedEnvelope(kind: FeedKind): Promise<{ envelope: MaterializedFeedEnvelope | null; source: "memory" | "redis" | null }> {
  const key = buildMaterializedFeedKey(kind);
  const memory = readMemoryEnvelope(key);
  if (memory && memory.result.items.length > 0) return { envelope: memory, source: "memory" };

  const redisEnvelope = await cacheGetJson<MaterializedFeedEnvelope>(buildRedisFeedKey(kind));
  if (redisEnvelope && redisEnvelope.result.items.length > 0 && Date.now() - redisEnvelope.cachedAtMs <= MATERIALIZED_FEED_STALE_MS) {
    materializedFeedMemory.set(key, clone(redisEnvelope));
    return { envelope: redisEnvelope, source: "redis" };
  }

  return { envelope: null, source: null };
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
      const result = await listLightweightFeed(
        {
          kind,
          viewerId: null,
          limit: MATERIALIZED_FEED_LIMIT,
          cursor: null,
          search: null,
          postType: undefined,
        },
        MATERIALIZED_FEED_LIMIT
      );
      if (result.items.length === 0) {
        const existing = readMemoryEnvelope(key);
        console.warn("[feed/materialized] refresh produced no items; preserving last good", {
          kind,
          latencyMs: Date.now() - startedAt,
          hadLastGood: Boolean(existing?.result.items.length),
        });
        return existing;
      }
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

async function readLatestRankedEnvelope(excludeKind?: FeedKind): Promise<{ envelope: MaterializedFeedEnvelope | null; source: "memory" | "redis" | null }> {
  const preferredKinds: FeedKind[] = ["latest", "hot-alpha", "high-conviction", "early-runners"];
  for (const kind of preferredKinds) {
    if (kind === excludeKind) continue;
    const read = await readMaterializedEnvelope(kind);
    if (read.envelope && read.envelope.result.items.length > 0) return read;
  }
  return { envelope: null, source: null };
}

export async function listMaterializedFeedCalls(args: FeedArgs): Promise<MaterializedFeedRead> {
  const startedAt = Date.now();
  const limit = Math.max(1, Math.min(40, args.limit ?? 10));

  if (args.kind === "following") {
    const result = await listLightweightFeed(args, limit);
    console.info("[feed/materialized] following lightweight read", {
      viewerId: args.viewerId,
      selected: result.items.length,
      hasMore: result.hasMore,
      latencyMs: Date.now() - startedAt,
    });
    return {
      ...result,
      materialized: {
        source: "following-db",
        cacheState: "direct",
        refreshQueued: false,
        latencyMs: Date.now() - startedAt,
      },
    };
  }

  if (!canUseMaterializedFeed(args)) {
    const result = await listLightweightFeed(args, limit);
    return {
      ...result,
      materialized: {
        source: "stored-db",
        cacheState: "direct",
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
    const envelopeSource = source ?? "memory";
    console.info("[feed/materialized] read", {
      kind: args.kind,
      source: envelopeSource,
      cacheState: cacheState === "fresh" ? "fresh" : "stale",
      ageMs,
      selected: result.items.length,
      totalItems: result.totalItems,
      refreshQueued,
      latencyMs: Date.now() - startedAt,
    });
    return {
      ...result,
      materialized: {
        source: envelopeSource,
        cacheState: cacheState === "fresh" ? "fresh" : "stale",
        refreshQueued,
        latencyMs: Date.now() - startedAt,
      },
    };
  }

  const latestRanked = await readLatestRankedEnvelope(args.kind);
  if (latestRanked.envelope) {
    const result = sliceMaterializedResult(latestRanked.envelope.result, { ...args, cursor: null }, limit);
    console.info("[feed/materialized] cold tab served latest ranked inventory while warming", {
      kind: args.kind,
      source: latestRanked.source ?? "memory",
      selected: result.items.length,
      totalItems: result.totalItems,
      refreshQueued,
      latencyMs: Date.now() - startedAt,
    });
    return {
      ...result,
      materialized: {
        source: "latest-cache",
        cacheState: "warming",
        refreshQueued,
        latencyMs: Date.now() - startedAt,
      },
    };
  }

  const direct = await listLightweightFeed({ ...args, limit }, limit);
  if (direct.items.length > 0) {
    console.info("[feed/materialized] cold cache served stored ranked feed while warming", {
      kind: args.kind,
      selected: direct.items.length,
      refreshQueued,
      latencyMs: Date.now() - startedAt,
    });
    return {
      ...direct,
      materialized: {
        source: "stored-db",
        cacheState: "warming",
        refreshQueued,
        latencyMs: Date.now() - startedAt,
      },
    };
  }

  console.warn("[feed/materialized] no stored feed inventory available", {
    kind: args.kind,
    refreshQueued,
    latencyMs: Date.now() - startedAt,
  });
  return {
    ...direct,
    materialized: {
      source: "stored-db",
      cacheState: "direct",
      refreshQueued,
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
