import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { type AuthVariables } from "../auth.js";
import { listFeedCalls } from "../services/intelligence/engine.js";

export const feedRouter = new Hono<{ Variables: AuthVariables }>();

const FeedQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(40).optional(),
  cursor: z.string().trim().min(1).optional(),
  search: z.string().trim().max(120).optional(),
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
  const result = await listFeedCalls({
    kind,
    viewerId: viewer?.id ?? null,
    limit: query.limit,
    cursor: query.cursor ?? null,
    search: query.search ?? null,
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
