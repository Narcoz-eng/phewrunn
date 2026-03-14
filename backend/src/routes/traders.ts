import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { type AuthVariables } from "../auth.js";
import { getTraderOverview } from "../services/intelligence/engine.js";

export const tradersRouter = new Hono<{ Variables: AuthVariables }>();

const HandleParamSchema = z.object({
  handle: z.string().trim().min(1),
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
