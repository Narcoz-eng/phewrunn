import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { type AuthVariables } from "../auth.js";
import { listFeedCalls } from "../services/intelligence/engine.js";
import { getFeedChartPreview } from "../services/feed-chart-preview.js";
import { triggerOrganicSettlementWakeup } from "./posts.js";
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
  pairAddress: z.string().trim().min(1).optional(),
  chainType: z.string().trim().min(1).optional(),
});

feedRouter.get("/chart-preview", zValidator("query", FeedChartPreviewQuerySchema), async (c) => {
  const query = c.req.valid("query");
  const preview = await getFeedChartPreview({
    tokenAddress: query.tokenAddress,
    pairAddress: query.pairAddress ?? null,
    chainType: query.chainType ?? null,
  });
  c.header("Cache-Control", preview.state === "live" ? "public, max-age=30" : "private, no-store");
  return c.json({ data: preview });
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

  if (!query.cursor) {
    const reason = query.search?.trim()
      ? `feed-router:${kind}:search`
      : `feed-router:${kind}`;
    triggerOrganicSettlementWakeup(reason);
  }

  const result = await listFeedCalls({
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
      ? "public, max-age=15, stale-while-revalidate=45"
      : "private, no-store"
  );

  return c.json({
    data: {
      items: result.items,
      hasMore: result.hasMore,
      nextCursor: result.nextCursor,
      totalPosts: result.totalItems,
      debugCounts: result.debugCounts ?? null,
      degraded: result.degraded === true,
    },
  });
});
