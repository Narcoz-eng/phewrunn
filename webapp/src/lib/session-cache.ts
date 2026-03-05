type SessionCacheEnvelope<T> = {
  cachedAt: number;
  data: T;
};

export function readSessionCache<T>(key: string, ttlMs: number): T | null {
  if (typeof window === "undefined") return null;

  try {
    const raw = window.sessionStorage.getItem(key);
    if (!raw) return null;

    const parsed = JSON.parse(raw) as SessionCacheEnvelope<T>;
    if (!parsed || typeof parsed.cachedAt !== "number") return null;
    if (Date.now() - parsed.cachedAt > ttlMs) return null;

    return parsed.data ?? null;
  } catch {
    return null;
  }
}

export function writeSessionCache<T>(key: string, data: T): void {
  if (typeof window === "undefined") return;

  try {
    const envelope: SessionCacheEnvelope<T> = {
      cachedAt: Date.now(),
      data,
    };
    window.sessionStorage.setItem(key, JSON.stringify(envelope));
  } catch {
    // Ignore quota/private browsing issues
  }
}

export function clearSessionCacheByPrefix(prefix: string): void {
  if (typeof window === "undefined") return;

  try {
    const keysToClear: string[] = [];
    for (let index = 0; index < window.sessionStorage.length; index += 1) {
      const key = window.sessionStorage.key(index);
      if (typeof key === "string" && key.startsWith(prefix)) {
        keysToClear.push(key);
      }
    }

    for (const key of keysToClear) {
      window.sessionStorage.removeItem(key);
    }
  } catch {
    // Ignore privacy mode / storage access issues
  }
}
