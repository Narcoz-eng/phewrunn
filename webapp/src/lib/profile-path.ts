const RESERVED_PROFILE_HANDLES = new Set([
  "admin",
  "api",
  "assets",
  "docs",
  "feed",
  "leaderboard",
  "login",
  "notifications",
  "post",
  "privacy",
  "profile",
  "terms",
  "welcome",
]);

const PROFILE_HANDLE_REGEX = /^[a-z0-9_]{3,20}$/;

function normalizeProfilePathSegment(value: string): string {
  return value.trim().toLowerCase();
}

export function normalizeProfileHandleInput(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_")
    .replace(/[^a-z0-9_]/g, "")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 20);
}

export function isReservedProfileHandle(value: string): boolean {
  return RESERVED_PROFILE_HANDLES.has(normalizeProfilePathSegment(value));
}

export function canUsePublicProfileHandle(username: string | null | undefined): username is string {
  if (typeof username !== "string") {
    return false;
  }

  const normalized = normalizeProfilePathSegment(username);
  return PROFILE_HANDLE_REGEX.test(normalized) && !isReservedProfileHandle(normalized);
}

export function isPossiblePublicProfileSegment(segment: string | undefined): boolean {
  if (typeof segment !== "string") {
    return false;
  }

  const normalized = normalizeProfilePathSegment(segment);
  return PROFILE_HANDLE_REGEX.test(normalized) && !isReservedProfileHandle(normalized);
}

export function getProfileHandleValidationMessage(value: string): string | null {
  const normalized = normalizeProfileHandleInput(value);

  if (!normalized) {
    return "Choose a handle.";
  }
  if (normalized.length < 3) {
    return "Handle must be at least 3 characters.";
  }
  if (normalized.length > 20) {
    return "Handle must be 20 characters or less.";
  }
  if (!PROFILE_HANDLE_REGEX.test(normalized)) {
    return "Use lowercase letters, numbers, and underscores only.";
  }
  if (isReservedProfileHandle(normalized)) {
    return "That handle is reserved.";
  }

  return null;
}

export function buildProfilePath(userId: string, username?: string | null): string {
  const normalized = typeof username === "string" ? normalizeProfilePathSegment(username) : "";
  if (normalized && canUsePublicProfileHandle(normalized)) {
    return `/${normalized}`;
  }
  return `/profile/${userId}`;
}

export function buildSuggestedProfileHandle(
  seeds: Array<string | null | undefined>,
  fallbackSuffix?: string
): string {
  for (const seed of seeds) {
    const normalized = normalizeProfileHandleInput(seed ?? "");
    if (!normalized) {
      continue;
    }
    if (canUsePublicProfileHandle(normalized)) {
      return normalized;
    }

    const withSuffix = normalizeProfileHandleInput(`${normalized}_run`);
    if (canUsePublicProfileHandle(withSuffix)) {
      return withSuffix;
    }
  }

  const suffix = normalizeProfileHandleInput(fallbackSuffix ?? "").slice(-4);
  const fallback = normalizeProfileHandleInput(`phew_${suffix || "run"}`);
  return canUsePublicProfileHandle(fallback) ? fallback : "phew_run";
}
