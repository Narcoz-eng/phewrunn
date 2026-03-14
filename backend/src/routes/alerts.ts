import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { type Notification } from "@prisma/client";
import { type AuthVariables, requireAuth } from "../auth.js";
import { isTransientPrismaError, prisma } from "../prisma.js";
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

function buildDefaultAlertPreference(userId: string) {
  return {
    id: `fallback:${userId}`,
    userId,
    minConfidenceScore: 65,
    minLiquidity: null,
    maxBundleRiskScore: 45,
    timeframeMinutes: 240,
    notifyFollowedTraders: true,
    notifyFollowedTokens: true,
    notifyEarlyRunners: true,
    notifyHotAlpha: true,
    notifyHighConviction: true,
    notifyBundleChanges: true,
    notifyConfidenceCross: true,
    createdAt: new Date(0),
    updatedAt: new Date(0),
  };
}

alertsRouter.get("/", requireAuth, async (c) => {
  const user = c.get("user");
  if (!user) {
    return c.json({ error: { message: "Unauthorized", code: "UNAUTHORIZED" } }, 401);
  }

  let notifications: Notification[] = [];
  try {
    notifications = await prisma.notification.findMany({
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
  } catch (error) {
    if (!isTransientPrismaError(error)) {
      throw error;
    }
    console.warn("[alerts] notification list degraded; returning empty alerts payload", {
      userId: user.id,
      message: error instanceof Error ? error.message : String(error),
    });
  }

  return c.json({ data: notifications });
});

alertsRouter.get("/preferences", requireAuth, async (c) => {
  const user = c.get("user");
  if (!user) {
    return c.json({ error: { message: "Unauthorized", code: "UNAUTHORIZED" } }, 401);
  }

  let pref;
  try {
    pref = await ensureAlertPreference(user.id);
  } catch (error) {
    if (!isTransientPrismaError(error)) {
      throw error;
    }
    console.warn("[alerts] preferences degraded; returning default alert preference payload", {
      userId: user.id,
      message: error instanceof Error ? error.message : String(error),
    });
    pref = buildDefaultAlertPreference(user.id);
  }
  return c.json({ data: pref });
});

alertsRouter.put("/preferences", requireAuth, zValidator("json", AlertPreferenceSchema), async (c) => {
  const user = c.get("user");
  if (!user) {
    return c.json({ error: { message: "Unauthorized", code: "UNAUTHORIZED" } }, 401);
  }

  const body = c.req.valid("json");
  let updated;
  try {
    updated = await prisma.alertPreference.upsert({
      where: { userId: user.id },
      create: {
        userId: user.id,
        ...body,
      },
      update: body,
    });
  } catch (error) {
    if (!isTransientPrismaError(error)) {
      throw error;
    }
    c.header("Retry-After", "2");
    return c.json(
      {
        error: {
          message: "Alert preferences are temporarily unavailable. Please retry.",
          code: "ALERT_PREFERENCES_UNAVAILABLE",
        },
      },
      503
    );
  }

  return c.json({ data: updated });
});
