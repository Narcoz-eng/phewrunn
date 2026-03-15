import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { type AuthVariables, requireAuth } from "../auth.js";
import { prisma } from "../prisma.js";
import { getVapidPublicKey } from "../services/webPush.js";

const pushRouter = new Hono<{ Variables: AuthVariables }>();

const SubscribeSchema = z.object({
  endpoint: z.string().url(),
  expirationTime: z.number().nullable().optional(),
  keys: z.object({
    p256dh: z.string().min(1),
    auth: z.string().min(1),
  }),
});

// GET /api/push/vapid-public-key — public key for browser subscription
pushRouter.get("/vapid-public-key", (c) => {
  const key = getVapidPublicKey();
  if (!key) {
    return c.json({ error: { message: "Push notifications not configured" } }, 503);
  }
  return c.json({ data: { publicKey: key } });
});

// GET /api/push/status — check if current browser is subscribed
pushRouter.get("/status", requireAuth, async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ data: { subscribed: false } });

  const endpoint = c.req.query("endpoint");
  if (!endpoint) return c.json({ data: { subscribed: false } });

  const sub = await prisma.pushSubscription.findFirst({
    where: { userId: user.id, endpoint },
    select: { id: true },
  });

  return c.json({ data: { subscribed: !!sub } });
});

// POST /api/push/subscribe — register a push subscription
pushRouter.post("/subscribe", requireAuth, zValidator("json", SubscribeSchema), async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);

  const { endpoint, keys } = c.req.valid("json");

  await prisma.pushSubscription.upsert({
    where: { endpoint },
    create: {
      userId: user.id,
      endpoint,
      p256dh: keys.p256dh,
      auth: keys.auth,
    },
    update: {
      userId: user.id,
      p256dh: keys.p256dh,
      auth: keys.auth,
    },
  });

  return c.json({ data: { ok: true } });
});

// POST /api/push/unsubscribe — remove a push subscription
pushRouter.post(
  "/unsubscribe",
  requireAuth,
  zValidator("json", z.object({ endpoint: z.string().min(1) })),
  async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);

    const { endpoint } = c.req.valid("json");

    await prisma.pushSubscription.deleteMany({
      where: { userId: user.id, endpoint },
    });

    return c.json({ data: { ok: true } });
  }
);

export { pushRouter };
