const BACKEND_SESSION_TOKEN_STORAGE_KEY = "phew.auth.backend-session-token.v1";

let inMemoryBackendSessionToken: string | null = null;

function normalizeToken(token: string | null | undefined): string | null {
  if (typeof token !== "string") return null;
  const normalized = token.trim();
  return normalized.length > 0 ? normalized : null;
}

export function getStoredBackendSessionToken(): string | null {
  if (inMemoryBackendSessionToken) {
    return inMemoryBackendSessionToken;
  }

  if (typeof window === "undefined") {
    return null;
  }

  try {
    const stored = normalizeToken(window.sessionStorage.getItem(BACKEND_SESSION_TOKEN_STORAGE_KEY));
    if (stored) {
      inMemoryBackendSessionToken = stored;
    }
    return stored;
  } catch {
    return null;
  }
}

export function setStoredBackendSessionToken(token: string): void {
  const normalized = normalizeToken(token);
  if (!normalized) {
    clearStoredBackendSessionToken();
    return;
  }

  inMemoryBackendSessionToken = normalized;

  if (typeof window === "undefined") {
    return;
  }

  try {
    window.sessionStorage.setItem(BACKEND_SESSION_TOKEN_STORAGE_KEY, normalized);
  } catch {
    // Ignore storage failures; in-memory fallback still helps within the tab.
  }
}

export function clearStoredBackendSessionToken(): void {
  inMemoryBackendSessionToken = null;

  if (typeof window === "undefined") {
    return;
  }

  try {
    window.sessionStorage.removeItem(BACKEND_SESSION_TOKEN_STORAGE_KEY);
  } catch {
    // Ignore storage failures while clearing local auth state.
  }
}
