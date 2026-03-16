import { prisma } from "../prisma.js";

type WebPushModule = {
  setVapidDetails: (subject: string, publicKey: string, privateKey: string) => void;
  sendNotification: (
    subscription: {
      endpoint: string;
      keys: {
        p256dh: string;
        auth: string;
      };
    },
    payload: string,
    options?: { TTL?: number }
  ) => Promise<void>;
};

const webPushModuleName = "web-push";
const webPush = (await import(webPushModuleName).catch(() => null)) as
  | ({ default?: WebPushModule } & Partial<WebPushModule>)
  | null;
const resolvedWebPush: WebPushModule | null =
  (webPush?.default as WebPushModule | undefined) ??
  (webPush && "sendNotification" in webPush ? (webPush as WebPushModule) : null);

const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY;
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;
const VAPID_EMAIL = process.env.VAPID_EMAIL ?? "mailto:admin@phewrunn.app";

let vapidConfigured = false;

if (!resolvedWebPush) {
  console.warn("[webPush] web-push package is not installed — push disabled");
} else if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
  try {
    resolvedWebPush.setVapidDetails(VAPID_EMAIL, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
    vapidConfigured = true;
  } catch (err) {
    console.warn("[webPush] Failed to configure VAPID keys — push disabled", err);
  }
}

export type PushPayload = {
  title: string;
  body: string;
  icon?: string;
  badge?: string;
  url?: string;
  tag?: string;
};

export function getVapidPublicKey(): string | null {
  return VAPID_PUBLIC_KEY ?? null;
}

export async function sendPushToUser(userId: string, payload: PushPayload): Promise<void> {
  if (!vapidConfigured || !resolvedWebPush) return;

  let subscriptions: { id: string; endpoint: string; p256dh: string; auth: string }[];
  try {
    subscriptions = await prisma.pushSubscription.findMany({
      where: { userId },
      select: { id: true, endpoint: true, p256dh: true, auth: true },
    });
  } catch {
    return;
  }

  if (subscriptions.length === 0) return;

  await Promise.allSettled(
    subscriptions.map(async (sub) => {
      try {
        await resolvedWebPush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          JSON.stringify(payload),
          { TTL: 86400 }
        );
      } catch (err: unknown) {
        const status =
          err != null && typeof err === "object" && "statusCode" in err
            ? (err as { statusCode: number }).statusCode
            : null;
        if (status === 410 || status === 404) {
          await prisma.pushSubscription.delete({ where: { id: sub.id } }).catch(() => {});
        } else {
          console.warn("[webPush] Delivery failed", { endpoint: sub.endpoint.slice(0, 60), status });
        }
      }
    })
  );
}

export async function sendPushToUsers(userIds: string[], payload: PushPayload): Promise<void> {
  if (!vapidConfigured || !resolvedWebPush || userIds.length === 0) return;

  let subscriptions: { id: string; userId: string; endpoint: string; p256dh: string; auth: string }[];
  try {
    subscriptions = await prisma.pushSubscription.findMany({
      where: { userId: { in: userIds } },
      select: { id: true, userId: true, endpoint: true, p256dh: true, auth: true },
    });
  } catch {
    return;
  }

  if (subscriptions.length === 0) return;

  await Promise.allSettled(
    subscriptions.map(async (sub) => {
      try {
        await resolvedWebPush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          JSON.stringify(payload),
          { TTL: 86400 }
        );
      } catch (err: unknown) {
        const status =
          err != null && typeof err === "object" && "statusCode" in err
            ? (err as { statusCode: number }).statusCode
            : null;
        if (status === 410 || status === 404) {
          await prisma.pushSubscription.delete({ where: { id: sub.id } }).catch(() => {});
        }
      }
    })
  );
}
