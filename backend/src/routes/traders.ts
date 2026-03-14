import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { type AuthVariables } from "../auth.js";
import { getTraderOverview } from "../services/intelligence/engine.js";
import { isTransientPrismaError } from "../prisma.js";

export const tradersRouter = new Hono<{ Variables: AuthVariables }>();

const HandleParamSchema = z.object({
  handle: z.string().trim().min(1),
});

const EMPTY_TRADER_STATS = {
  callsCount: 0,
  avgConfidenceScore: 0,
  avgHotAlphaScore: 0,
  avgHighConvictionScore: 0,
  firstCallCount: 0,
};

tradersRouter.get("/:handle/overview", zValidator("param", HandleParamSchema), async (c) => {
  const { handle } = c.req.valid("param");
  const viewer = c.get("user");

  try {
    const overview = await getTraderOverview(handle, viewer?.id ?? null);

    if (!overview) {
      return c.json({ error: { message: "Trader not found", code: "NOT_FOUND" } }, 404);
    }

    return c.json({
      data: {
        trader: overview.trader,
        stats: overview.stats,
        degraded: false,
      },
    });
  } catch (error) {
    if (!isTransientPrismaError(error)) {
      throw error;
    }

    console.warn("[traders/overview] transient database pressure; returning degraded trader overview", {
      handle,
      message: error instanceof Error ? error.message : String(error),
    });

    return c.json({
      data: {
        trader: null,
        stats: EMPTY_TRADER_STATS,
        degraded: true,
      },
    });
  }
});

tradersRouter.get("/:handle", zValidator("param", HandleParamSchema), async (c) => {
  const { handle } = c.req.valid("param");
  const viewer = c.get("user");
  const overview = await getTraderOverview(handle, viewer?.id ?? null);

  if (!overview) {
    return c.json({ error: { message: "Trader not found", code: "NOT_FOUND" } }, 404);
  }

  return c.json({ data: overview.trader });
});

tradersRouter.get("/:handle/stats", zValidator("param", HandleParamSchema), async (c) => {
  const { handle } = c.req.valid("param");
  const viewer = c.get("user");
  const overview = await getTraderOverview(handle, viewer?.id ?? null);

  if (!overview) {
    return c.json({ error: { message: "Trader not found", code: "NOT_FOUND" } }, 404);
  }

  return c.json({ data: overview.stats });
});

tradersRouter.get("/:handle/calls", zValidator("param", HandleParamSchema), async (c) => {
  const { handle } = c.req.valid("param");
  const viewer = c.get("user");
  const overview = await getTraderOverview(handle, viewer?.id ?? null);

  if (!overview) {
    return c.json({ error: { message: "Trader not found", code: "NOT_FOUND" } }, 404);
  }

  return c.json({ data: overview.calls });
});
