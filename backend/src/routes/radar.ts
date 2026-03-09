import { Hono } from "hono";
import { type AuthVariables } from "../auth.js";
import { listRadarTokens } from "../services/intelligence/engine.js";

export const radarRouter = new Hono<{ Variables: AuthVariables }>();

radarRouter.get("/early-runners", async (c) => {
  const viewer = c.get("user");
  const data = await listRadarTokens("early-runners", viewer?.id ?? null);
  return c.json({ data });
});

radarRouter.get("/hot-alpha", async (c) => {
  const viewer = c.get("user");
  const data = await listRadarTokens("hot-alpha", viewer?.id ?? null);
  return c.json({ data });
});

radarRouter.get("/high-conviction", async (c) => {
  const viewer = c.get("user");
  const data = await listRadarTokens("high-conviction", viewer?.id ?? null);
  return c.json({ data });
});
