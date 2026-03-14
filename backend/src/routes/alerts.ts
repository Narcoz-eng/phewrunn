import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { type AuthVariables, requireAuth } from "../auth.js";
import { prisma } from "../prisma.js";
import { ensureAlertPreference } from "../services/intelligence/engine.js";

export const alertsRouter = new Hono<{ Variables: AuthVariables }>();

const AlertPreferenceSchema = z.object({
  minConfidenceScore: z.number().min(0).max(100).nullable().optional(),
  minLiquidity: z.number().min(0).nullable().optional(),
  maxBundleRiskScore: z.number().min(0).max(100).nullable().optional(),
  timeframeMinutes: z.number().int().min(5).max(7 * 24 * 60).nullable().optional(),
  notifyFollowedTraders: z.boolean().optional(),
  notifyFollowedTokens: z.boolean().optional(),
  notifyEarlyRunners: z.boolean().optional(),
  notifyHotAlpha: z.boolean().optional(),
  notifyHighConviction: z.boolean().optional(),
  notifyBundleChanges: z.boolean().optional(),
  notifyConfidenceCross: z.boolean().optional(),
});

alertsRouter.get("/", requireAuth, async (c) => {
  const user = c.get("user");
  if (!user) {
    return c.json({ error: { message: "Unauthorized", code: "UNAUTHORIZED" } }, 401);
  }

  const notifications = await prisma.notification.findMany({
    where: {
      userId: user.id,
      OR: [
        { entityType: "token" },
        { entityType: "call" },
        { type: { in: ["posted_alpha", "early_runner_detected", "hot_alpha_detected", "high_conviction_detected", "bundle_risk_changed", "token_confidence_crossed"] } },
      ],
    },
    orderBy: { createdAt: "desc" },
    take: 200,
  });

  return c.json({ data: notifications });
});

alertsRouter.get("/preferences", requireAuth, async (c) => {
  const user = c.get("user");
  if (!user) {
    return c.json({ error: { message: "Unauthorized", code: "UNAUTHORIZED" } }, 401);
  }

  const pref = await ensureAlertPreference(user.id);
  return c.json({ data: pref });
});

alertsRouter.put("/preferences", requireAuth, zValidator("json", AlertPreferenceSchema), async (c) => {
  const user = c.get("user");
  if (!user) {
    return c.json({ error: { message: "Unauthorized", code: "UNAUTHORIZED" } }, 401);
  }

  const body = c.req.valid("json");
  const updated = await prisma.alertPreference.upsert({
    where: { userId: user.id },
    create: {
      userId: user.id,
      ...body,
    },
    update: body,
  });

  return c.json({ data: updated });
});
