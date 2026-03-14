import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { type AuthVariables, requireAuth } from "../auth.js";
import { prisma, withPrismaRetry, isTransientPrismaError } from "../prisma.js";

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
  const now = new Date();
  return {
    id: `default:${userId}`,
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
    createdAt: now,
    updatedAt: now,
  };
}

alertsRouter.get("/", requireAuth, async (c) => {
  const user = c.get("user");
  if (!user) {
    return c.json({ error: { message: "Unauthorized", code: "UNAUTHORIZED" } }, 401);
  }

  try {
    const notifications = await withPrismaRetry(
      () =>
        prisma.notification.findMany({
          where: {
            userId: user.id,
            OR: [
              { entityType: "token" },
              { entityType: "call" },
              {
                type: {
                  in: [
                    "posted_alpha",
                    "early_runner_detected",
                    "hot_alpha_detected",
                    "high_conviction_detected",
                    "bundle_risk_changed",
                    "token_confidence_crossed",
                  ],
                },
              },
            ],
          },
          orderBy: { createdAt: "desc" },
          take: 200,
        }),
      { label: "alerts:list" }
    );

    return c.json({ data: notifications });
  } catch (error) {
    if (isTransientPrismaError(error)) {
      console.warn("[alerts] notifications unavailable; returning empty alerts list", {
        userId: user.id,
        message: error instanceof Error ? error.message : String(error),
      });
      return c.json({ data: [] });
    }
    throw error;
  }
});

alertsRouter.get("/preferences", requireAuth, async (c) => {
  const user = c.get("user");
  if (!user) {
    return c.json({ error: { message: "Unauthorized", code: "UNAUTHORIZED" } }, 401);
  }

  try {
    const pref = await withPrismaRetry(
      () =>
        prisma.alertPreference.findUnique({
          where: { userId: user.id },
        }),
      { label: "alerts:preferences:read" }
    );
    return c.json({ data: pref ?? buildDefaultAlertPreference(user.id) });
  } catch (error) {
    if (isTransientPrismaError(error)) {
      console.warn("[alerts] preferences unavailable; returning default preferences", {
        userId: user.id,
        message: error instanceof Error ? error.message : String(error),
      });
      return c.json({ data: buildDefaultAlertPreference(user.id) });
    }
    throw error;
  }
});

alertsRouter.put("/preferences", requireAuth, zValidator("json", AlertPreferenceSchema), async (c) => {
  const user = c.get("user");
  if (!user) {
    return c.json({ error: { message: "Unauthorized", code: "UNAUTHORIZED" } }, 401);
  }

  const body = c.req.valid("json");
  try {
    const updated = await withPrismaRetry(
      () =>
        prisma.alertPreference.upsert({
          where: { userId: user.id },
          create: {
            userId: user.id,
            ...body,
          },
          update: body,
        }),
      { label: "alerts:preferences:update" }
    );

    return c.json({ data: updated });
  } catch (error) {
    if (isTransientPrismaError(error)) {
      console.warn("[alerts] preferences update unavailable", {
        userId: user.id,
        message: error instanceof Error ? error.message : String(error),
      });
      return c.json(
        {
          error: {
            message: "Alert preferences are temporarily unavailable. Please retry shortly.",
            code: "ALERT_PREFERENCES_UNAVAILABLE",
          },
        },
        503
      );
    }
    throw error;
  }
});
