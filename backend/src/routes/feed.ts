import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { type AuthVariables } from "../auth.js";
import { listFeedCalls } from "../services/intelligence/engine.js";
import { listMaterializedFeedCalls } from "../services/materialized-feed.js";
import { getFeedChartPreview } from "../services/feed-chart-preview.js";
import { PostTypeSchema } from "../types.js";

export const feedRouter = new Hono<{ Variables: AuthVariables }>();

const FeedQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(40).optional(),
  cursor: z.string().trim().min(1).optional(),
  search: z.string().trim().max(120).optional(),
  postType: PostTypeSchema.optional(),
});

const FeedDebugQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).optional(),
});

const FeedChartPreviewQuerySchema = z.object({
  tokenAddress: z.string().trim().min(1),
  pairAddress: z.string().trim().min(1).nullable().optional(),
  chainType: z.string().trim().min(1).nullable().optional(),
});

const FeedChartPreviewBatchSchema = z.object({
  tokens: z.array(FeedChartPreviewQuerySchema.extend({
    key: z.string().trim().min(1).max(180).optional(),
  })).min(1).max(12),
});

feedRouter.post("/chart-previews", zValidator("json", FeedChartPreviewBatchSchema), async (c) => {
  const startedAt = Date.now();
  const { tokens } = c.req.valid("json");
  const results: Record<string, Awaited<ReturnType<typeof getFeedChartPreview>>> = {};
  const deduped = new Map<string, (typeof tokens)[number]>();
  for (const token of tokens) {
    const key = token.key ?? `${token.chainType ?? "any"}:${token.pairAddress ?? token.tokenAddress}`.toLowerCase();
    if (!deduped.has(key)) deduped.set(key, token);
  }
  const queue = [...deduped.values()];
  const workers = Array.from({ length: Math.min(3, queue.length) }, async () => {
    while (queue.length > 0) {
      const token = queue.shift();
      if (!token) return;
      const key = token.key ?? `${token.chainType ?? "any"}:${token.pairAddress ?? token.tokenAddress}`.toLowerCase();
      results[key] = await getFeedChartPreview({
        tokenAddress: token.tokenAddress,
        pairAddress: token.pairAddress ?? null,
        chainType: token.chainType ?? null,
      });
    }
  });
  await Promise.all(workers);
  console.info("[feed/chart-previews] batch complete", {
    requested: tokens.length,
    deduped: deduped.size,
    dedupeHits: Math.max(0, tokens.length - deduped.size),
    liveResults: Object.values(results).filter((preview) => preview.state === "live").length,
    latencyMs: Date.now() - startedAt,
  });
  c.header("Cache-Control", "private, max-age=15, stale-while-revalidate=45");
  return c.json({ data: { results } });
});

feedRouter.get("/:kind/debug-ranking", zValidator("query", FeedDebugQuerySchema), async (c) => {
  const rawKind = c.req.param("kind");
  const kind =
    rawKind === "latest" ||
    rawKind === "hot-alpha" ||
    rawKind === "early-runners" ||
    rawKind === "high-conviction" ||
    rawKind === "following"
      ? rawKind
      : null;

  if (!kind) {
    return c.json({ error: { message: "Unsupported feed tab", code: "INVALID_FEED_KIND" } }, 400);
  }

  const viewer = c.get("user");
  if (process.env.NODE_ENV === "production" && !viewer?.isAdmin) {
    return c.json({ error: { message: "Feed diagnostics are unavailable.", code: "NOT_FOUND" } }, 404);
  }

  const query = c.req.valid("query");
  const result = await listFeedCalls({
    kind,
    viewerId: viewer?.id ?? null,
    limit: query.limit ?? 20,
    cursor: null,
    search: null,
    postType: kind === "early-runners" ? "raid" : undefined,
  });

  return c.json({
    data: {
      kind,
      generatedAt: new Date().toISOString(),
      returnedCount: result.items.length,
      debugCounts: result.debugCounts ?? null,
      nextCursor: result.nextCursor,
      items: result.items.map((item, index) => ({
        rank: index + 1,
        id: item.id,
        token: item.tokenContext?.symbol ?? item.tokenSymbol ?? item.tokenContext?.address ?? null,
        postType: item.postType,
        itemType: item.itemType,
        feedScore: item.feedScore,
        scoreReasons: item.scoreReasons ?? item.feedReasons ?? [],
        createdAt: item.createdAt,
        author: {
          id: item.author.id,
          username: item.author.username,
          reputationTier: item.author.reputationTier ?? null,
          trustScore: item.author.trustScore ?? null,
          level: item.author.level,
          avgRoi30d: item.author.avgRoi30d ?? null,
        },
        engagement: item.engagement ?? {
          likes: item._count.likes,
          comments: item._count.comments,
          reposts: item._count.reposts,
          reactions: 0,
          views: item.viewCount,
          velocity: 0,
        },
        coverage: item.coverage,
        marketProvenance: item.payload.call?.market ?? null,
        contexts: {
          community: item.community
            ? item.community.xCashtag ?? item.community.token?.symbol ?? item.community.token?.name ?? item.communityId
            : null,
          repostedBy: item.repostContext?.user?.username ?? item.repostContext?.user?.name ?? null,
        },
      })),
    },
  });
});

feedRouter.get("/:kind", zValidator("query", FeedQuerySchema), async (c) => {
  const rawKind = c.req.param("kind");
  const kind =
    rawKind === "latest" ||
    rawKind === "hot-alpha" ||
    rawKind === "early-runners" ||
    rawKind === "high-conviction" ||
    rawKind === "following"
      ? rawKind
      : null;

  if (!kind) {
    return c.json({ error: { message: "Unsupported feed tab", code: "INVALID_FEED_KIND" } }, 400);
  }

  const query = c.req.valid("query");
  const viewer = c.get("user");
  const shouldUsePublicResponseCaching =
    !viewer &&
    kind !== "following" &&
    !query.cursor &&
    !query.search?.trim();

  const startedAt = Date.now();
  const result = await listMaterializedFeedCalls({
    kind,
    viewerId: viewer?.id ?? null,
    limit: query.limit,
    cursor: query.cursor ?? null,
    search: query.search ?? null,
    postType: query.postType,
  });

  c.header("Vary", "Cookie");
  c.header(
    "Cache-Control",
    shouldUsePublicResponseCaching
      ? "public, max-age=30, stale-while-revalidate=120"
      : "private, no-store"
  );
  c.header("X-Feed-Source", result.materialized.source);
  c.header("X-Feed-Cache", result.materialized.cacheState);

  console.info("[feed/route] served", {
    kind,
    viewerScope: viewer?.id ? "user" : "anonymous",
    items: result.items.length,
    totalItems: result.totalItems,
    source: result.materialized.source,
    cacheState: result.materialized.cacheState,
    refreshQueued: result.materialized.refreshQueued,
    latencyMs: Date.now() - startedAt,
  });

  return c.json({
    data: {
      items: result.items,
      hasMore: result.hasMore,
      nextCursor: result.nextCursor,
      totalPosts: result.totalItems,
      debugCounts: result.debugCounts
        ? {
            ...result.debugCounts,
            source: result.materialized.source,
            cacheState: result.materialized.cacheState,
            latencyMs: result.materialized.latencyMs,
          }
        : null,
      degraded: false,
    },
  });
});
