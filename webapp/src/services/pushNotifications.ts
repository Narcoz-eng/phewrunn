import { api } from "@/lib/api";

const SW_PATH = "/sw.js";

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)));
}

/** True if the browser supports push notifications */
export function isPushSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

/** Current permission state: 'default' | 'granted' | 'denied' */
export function getPushPermission(): NotificationPermission {
  if (!isPushSupported()) return "denied";
  return Notification.permission;
}

/** Fetch the VAPID public key from the backend */
async function getVapidPublicKey(): Promise<string> {
  const data = await api.get<{ publicKey: string }>("/api/push/vapid-public-key");
  return data.publicKey;
}

/** Register SW and subscribe to push; returns true on success */
export async function subscribeToPush(): Promise<boolean> {
  if (!isPushSupported()) return false;

  const permission = await Notification.requestPermission();
  if (permission !== "granted") return false;

  try {
    const registration = await navigator.serviceWorker.register(SW_PATH, { scope: "/" });
    await navigator.serviceWorker.ready;

    const vapidPublicKey = await getVapidPublicKey();
    const applicationServerKey = urlBase64ToUint8Array(vapidPublicKey);

    const subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey,
    });

    const sub = subscription.toJSON() as {
      endpoint: string;
      expirationTime?: number | null;
      keys?: { p256dh: string; auth: string };
    };

    if (!sub.keys?.p256dh || !sub.keys?.auth) {
      throw new Error("Subscription keys missing");
    }

    await api.post("/api/push/subscribe", {
      endpoint: sub.endpoint,
      expirationTime: sub.expirationTime ?? null,
      keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth },
    });

    return true;
  } catch (err) {
    console.warn("[push] Subscribe failed", err);
    return false;
  }
}

/** Unsubscribe from push and tell the backend */
export async function unsubscribeFromPush(): Promise<void> {
  try {
    const registration = await navigator.serviceWorker.getRegistration(SW_PATH);
    if (!registration) return;

    const subscription = await registration.pushManager.getSubscription();
    if (!subscription) return;

    const endpoint = subscription.endpoint;
    await subscription.unsubscribe();
    await api.post("/api/push/unsubscribe", { endpoint }).catch(() => {});
  } catch (err) {
    console.warn("[push] Unsubscribe failed", err);
  }
}

/** Check if this browser is currently subscribed */
export async function isPushSubscribed(): Promise<boolean> {
  if (!isPushSupported()) return false;
  try {
    const registration = await navigator.serviceWorker.getRegistration(SW_PATH);
    if (!registration) return false;
    const subscription = await registration.pushManager.getSubscription();
    return !!subscription;
  } catch {
    return false;
  }
}
