const DYNAMIC_IMPORT_RELOAD_KEY_PREFIX = "phew.dynamic-import-reload";

function buildReloadKey(scope: string): string {
  return `${DYNAMIC_IMPORT_RELOAD_KEY_PREFIX}:${scope}`;
}

function isRecoverableDynamicImportError(error: unknown): boolean {
  const message =
    error instanceof Error
      ? `${error.name}: ${error.message}`
      : typeof error === "string"
        ? error
        : String(error ?? "");

  return (
    message.includes("Failed to fetch dynamically imported module") ||
    message.includes("Importing a module script failed") ||
    message.includes("ChunkLoadError") ||
    message.includes("error loading dynamically imported module")
  );
}

function clearReloadMarker(scope: string) {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.sessionStorage.removeItem(buildReloadKey(scope));
  } catch {
    // ignore private-browsing and storage access errors
  }
}

function reloadOnce(scope: string): boolean {
  if (typeof window === "undefined") {
    return false;
  }

  const storageKey = buildReloadKey(scope);

  try {
    if (window.sessionStorage.getItem(storageKey) === "1") {
      window.sessionStorage.removeItem(storageKey);
      return false;
    }

    window.sessionStorage.setItem(storageKey, "1");
  } catch {
    // ignore storage access errors and attempt a best-effort reload
  }

  void navigator.serviceWorker?.getRegistrations?.()
    .then((registrations) => Promise.all(registrations.map((registration) => registration.update().catch(() => undefined))))
    .catch(() => undefined);

  const nextUrl = new URL(window.location.href);
  nextUrl.searchParams.set("__phew_refresh", String(Date.now()));
  window.location.replace(nextUrl.toString());
  return true;
}

export async function importWithRecovery<T>(
  importer: () => Promise<T>,
  scope: string
): Promise<T> {
  try {
    const module = await importer();
    clearReloadMarker(scope);
    return module;
  } catch (error) {
    if (isRecoverableDynamicImportError(error) && reloadOnce(scope)) {
      return new Promise<T>(() => {
        // Keep Suspense pending while the page reloads.
      });
    }

    throw error;
  }
}
