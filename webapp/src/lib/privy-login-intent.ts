export type PrivyLoginIntentMethod = "twitter";

type PrivyLoginIntent = {
  method: PrivyLoginIntentMethod;
  requestedAt: number;
};

const PRIVY_LOGIN_INTENT_STORAGE_KEY = "phew.auth.privy-login-intent.v1";
const PRIVY_LOGIN_INTENT_TTL_MS = 2 * 60 * 1000;

export function writePrivyLoginIntent(method: PrivyLoginIntentMethod): void {
  if (typeof window === "undefined") {
    return;
  }

  try {
    const intent: PrivyLoginIntent = {
      method,
      requestedAt: Date.now(),
    };
    window.sessionStorage.setItem(
      PRIVY_LOGIN_INTENT_STORAGE_KEY,
      JSON.stringify(intent)
    );
  } catch {
    // ignore storage errors
  }
}

export function readPrivyLoginIntent(): PrivyLoginIntent | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const raw = window.sessionStorage.getItem(PRIVY_LOGIN_INTENT_STORAGE_KEY);
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw) as Partial<PrivyLoginIntent>;
    if (
      parsed.method !== "twitter" ||
      typeof parsed.requestedAt !== "number" ||
      !Number.isFinite(parsed.requestedAt)
    ) {
      clearPrivyLoginIntent();
      return null;
    }

    if (Date.now() - parsed.requestedAt > PRIVY_LOGIN_INTENT_TTL_MS) {
      clearPrivyLoginIntent();
      return null;
    }

    return {
      method: parsed.method,
      requestedAt: parsed.requestedAt,
    };
  } catch {
    clearPrivyLoginIntent();
    return null;
  }
}

export function clearPrivyLoginIntent(): void {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.sessionStorage.removeItem(PRIVY_LOGIN_INTENT_STORAGE_KEY);
  } catch {
    // ignore storage errors
  }
}
