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

tradersRouter.get("/:handle", zValidator("param", HandleParamSchema), async (c) => {
  const { handle } = c.req.valid("param");
  const viewer = c.get("user");
  let overview;
  try {
    overview = await getTraderOverview(handle, viewer?.id ?? null);
  } catch (error) {
    if (!isTransientPrismaError(error)) {
      throw error;
    }
    c.header("Retry-After", "2");
    return c.json(
      { error: { message: "Trader profile is temporarily unavailable. Please retry.", code: "TRADER_UNAVAILABLE" } },
      503
    );
  }

  if (!overview) {
    return c.json({ error: { message: "Trader not found", code: "NOT_FOUND" } }, 404);
  }

  return c.json({ data: overview.trader });
});

tradersRouter.get("/:handle/stats", zValidator("param", HandleParamSchema), async (c) => {
  const { handle } = c.req.valid("param");
  const viewer = c.get("user");
  let overview;
  try {
    overview = await getTraderOverview(handle, viewer?.id ?? null);
  } catch (error) {
    if (!isTransientPrismaError(error)) {
      throw error;
    }
    c.header("Retry-After", "2");
    return c.json(
      { error: { message: "Trader stats are temporarily unavailable. Please retry.", code: "TRADER_STATS_UNAVAILABLE" } },
      503
    );
  }

  if (!overview) {
    return c.json({ error: { message: "Trader not found", code: "NOT_FOUND" } }, 404);
  }

  return c.json({ data: overview.stats });
});

tradersRouter.get("/:handle/calls", zValidator("param", HandleParamSchema), async (c) => {
  const { handle } = c.req.valid("param");
  const viewer = c.get("user");
  let overview;
  try {
    overview = await getTraderOverview(handle, viewer?.id ?? null);
  } catch (error) {
    if (!isTransientPrismaError(error)) {
      throw error;
    }
    c.header("Retry-After", "2");
    return c.json(
      { error: { message: "Trader calls are temporarily unavailable. Please retry.", code: "TRADER_CALLS_UNAVAILABLE" } },
      503
    );
  }

  if (!overview) {
    return c.json({ error: { message: "Trader not found", code: "NOT_FOUND" } }, 404);
  }

  return c.json({ data: overview.calls });
});
