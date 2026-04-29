import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { type AuthVariables } from "../auth.js";
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

const FeedChartPreviewQuerySchema = z.object({
  tokenAddress: z.string().trim().min(1),
  pairAddress: z.string().trim().min(1).nullable().optional(),
  chainType: z.string().trim().min(1).nullable().optional(),
});

const FeedChartPreviewBatchSchema = z.object({
  tokens: z.array(FeedChartPreviewQuerySchema.extend({
    key: z.string().trim().min(1).max(180).optional(),
  })).min(1).max(24),
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
  const unavailableReasons = new Map<string, number>();
  for (const preview of Object.values(results)) {
    if (preview.state === "live") continue;
    const reason = preview.unavailableReason ?? "unknown";
    unavailableReasons.set(reason, (unavailableReasons.get(reason) ?? 0) + 1);
  }
  console.info("[feed/chart-previews] batch complete", {
    requested: tokens.length,
    batchSize: deduped.size,
    deduped: deduped.size,
    dedupeHits: Math.max(0, tokens.length - deduped.size),
    liveResults: Object.values(results).filter((preview) => preview.state === "live").length,
    unavailableReasons: Object.fromEntries(unavailableReasons.entries()),
    latencyMs: Date.now() - startedAt,
  });
  c.header("Cache-Control", "private, max-age=15, stale-while-revalidate=45");
  return c.json({ data: { results } });
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
    },
  });
});
