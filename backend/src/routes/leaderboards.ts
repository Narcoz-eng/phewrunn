import { Hono } from "hono";
import { type AuthVariables } from "../auth.js";
import { listDailyLeaderboards, listFirstCallerLeaderboards } from "../services/intelligence/engine.js";

export const leaderboardsRouter = new Hono<{ Variables: AuthVariables }>();

leaderboardsRouter.get("/daily", async (c) => {
  const viewer = c.get("user");
  const data = await listDailyLeaderboards(viewer?.id ?? null);
  return c.json({ data });
});

leaderboardsRouter.get("/first-callers", async (c) => {
  const viewer = c.get("user");
  const data = await listFirstCallerLeaderboards(viewer?.id ?? null);
  return c.json({ data });
});
