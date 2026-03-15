const STALE_ASSET_RELOAD_KEY = "phew.stale-asset-reload-at";
const STALE_ASSET_RELOAD_COOLDOWN_MS = 30_000;

function readLastReloadAt(): number {
  if (typeof window === "undefined") {
    return 0;
  }

  try {
    const raw = window.sessionStorage.getItem(STALE_ASSET_RELOAD_KEY);
    const parsed = raw ? Number(raw) : 0;
    return Number.isFinite(parsed) ? parsed : 0;
  } catch {
    return 0;
  }
}

function writeReloadAt(timestamp: number) {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.sessionStorage.setItem(STALE_ASSET_RELOAD_KEY, String(timestamp));
  } catch {
    // ignore storage access issues
  }
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return `${error.name}: ${error.message}`;
  }

  if (typeof error === "string") {
    return error;
  }

  if (typeof error === "object" && error !== null && "message" in error) {
    return String((error as { message?: unknown }).message ?? "");
  }

  return String(error ?? "");
}

function isStaleAssetErrorMessage(message: string): boolean {
  return (
    message.includes("Failed to fetch dynamically imported module") ||
    message.includes("Importing a module script failed") ||
    message.includes("ChunkLoadError") ||
    message.includes("error loading dynamically imported module")
  );
}

function attemptStaleAssetReload(source: string, message: string): boolean {
  if (typeof window === "undefined") {
    return false;
  }

  if (!isStaleAssetErrorMessage(message)) {
    return false;
  }

  const now = Date.now();
  const lastReloadAt = readLastReloadAt();
  if (lastReloadAt > 0 && now - lastReloadAt < STALE_ASSET_RELOAD_COOLDOWN_MS) {
    console.warn("[stale-assets] chunk recovery skipped to avoid reload loop", {
      source,
      message,
      cooldownMs: STALE_ASSET_RELOAD_COOLDOWN_MS,
    });
    return false;
  }

  writeReloadAt(now);
  console.warn("[stale-assets] reloading after chunk fetch failure", {
    source,
    message,
  });
  window.location.reload();
  return true;
}

export function installStaleAssetRecovery() {
  if (typeof window === "undefined") {
    return;
  }

  window.addEventListener("vite:preloadError", ((event: Event) => {
    const customEvent = event as CustomEvent<unknown>;
    const message = getErrorMessage(customEvent.payload);
    if (!attemptStaleAssetReload("vite:preloadError", message)) {
      return;
    }

    if (typeof customEvent.preventDefault === "function") {
      customEvent.preventDefault();
    }
  }) as EventListener);

  window.addEventListener("error", (event) => {
    const message = getErrorMessage(event.error ?? event.message);
    if (attemptStaleAssetReload("window:error", message)) {
      event.preventDefault();
    }
  });

  window.addEventListener("unhandledrejection", (event) => {
    const message = getErrorMessage(event.reason);
    if (attemptStaleAssetReload("window:unhandledrejection", message)) {
      event.preventDefault();
    }
  });
}
