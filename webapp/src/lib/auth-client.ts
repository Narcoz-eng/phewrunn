import { useState, useEffect, useCallback, createContext, useContext, createElement } from "react";
import type { ReactNode } from "react";
import { setAuthTokenGetter } from "./api";
import { clearSessionCacheByPrefix } from "./session-cache";

// Get the backend URL
const getBaseUrl = () => {
  const envBackendUrl = import.meta.env.VITE_BACKEND_URL?.trim();
  if (typeof window !== "undefined") {
    const { hostname, origin, protocol } = window.location;
    const isLocalhost =
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname === "[::1]" ||
      hostname === "0.0.0.0";

    const isKnownDeployedHost =
      hostname.endsWith(".vibecode.run") ||
      hostname.endsWith(".vibecodeapp.com") ||
      hostname === "phew.run" ||
      hostname === "www.phew.run" ||
      hostname.endsWith(".phew.run");

    // Prefer same-origin in deployed environments so a committed preview URL
    // does not send auth/session traffic to a different backend.
    if (isKnownDeployedHost || (!isLocalhost && protocol === "https:")) {
      return origin;
    }
  }
  if (envBackendUrl) {
    return envBackendUrl;
  }
  return "http://localhost:3000";
};

const baseURL = getBaseUrl();
console.log("[Auth] Using backend URL:", baseURL);

const AUTH_SESSION_CACHE_KEY = "phew.auth.session.v1";
const AUTH_SESSION_CACHE_TTL_MS = 5 * 60 * 1000;
const AUTH_401_GRACE_AFTER_PRIVY_SYNC_MS = 30_000;
const AUTH_TRANSIENT_401_RECOVERY_MS = 2 * 60 * 1000;
const AUTH_CACHE_FIRST_AFTER_PRIVY_SYNC_MS = 20_000;
const AUTH_MAX_401_FAILURES_BEFORE_SIGNOUT = 4;
const SESSION_FETCH_TIMEOUT_MS = 2200;
const SIGN_OUT_TIMEOUT_MS = 2500;
const AUTH_SESSION_RETRY_DELAY_MS = 300;
const AUTH_SESSION_RETRY_ATTEMPTS_WITH_TOKEN = 4;
const AUTH_SESSION_RETRY_DELAY_WITH_COOKIE_MS = 450;
const AUTH_SESSION_RETRY_ATTEMPTS_WITH_COOKIE = 3;
const PRIVY_SYNC_TIMEOUT_MS = 12_000;
const PRIVY_SYNC_RETRY_DELAYS_MS = [300, 900, 1800] as const;
const AUTH_BEARER_TOKEN_MAX_LENGTH = 3500;
const SESSION_COOKIE_CANDIDATE_NAMES = [
  "phew.session_token",
  "better-auth.session_token",
  "auth.session_token",
] as const;
const AUTH_SESSION_SYNC_EVENT = "phew:auth-session-synced";
const PRIVY_SYNC_FAILURE_STORAGE_KEY = "phew.auth.privy-sync-failure.v1";
const PRIVY_SYNC_FAILURE_TTL_MS = 5 * 60 * 1000;
const AUTH_PRIVY_SYNC_FAILURE_EVENT = "phew:auth-privy-sync-failure";

type PrivySyncFailureSnapshot = {
  message: string;
  recordedAt: number;
};

let preLogoutHooks: Array<() => Promise<void>> = [];

export function registerPreLogoutHook(hook: () => Promise<void>): () => void {
  preLogoutHooks.push(hook);
  return () => {
    preLogoutHooks = preLogoutHooks.filter((currentHook) => currentHook !== hook);
  };
}

let explicitLogoutAt = 0;

export function getExplicitLogoutAt(): number {
  return explicitLogoutAt;
}

// Privy-only auth: keep legacy exports as explicit unsupported stubs so callers fail loudly.
export async function signIn() {
  throw new Error("Email/password auth has been removed. Use Privy sign-in.");
}

export async function signUp() {
  throw new Error("Email/password auth has been removed. Use Privy sign-in.");
}

export async function signOut(options?: { token?: string | null }) {
  const token = normalizeAuthToken(options?.token) ?? getStoredAuthToken();
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), SIGN_OUT_TIMEOUT_MS);
  try {
    await fetch(`${baseURL}/api/auth/logout`, {
      method: "POST",
      credentials: "include",
      keepalive: true,
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    });
  } catch (error) {
    // We still clear local state/tokens in callers, but log the server-side logout failure.
    console.error("[Auth] signOut request failed:", error);
  } finally {
    clearTimeout(timeoutId);
  }
}

// Auth user interface
export interface AuthUser {
  id: string;
  email: string;
  name: string;
  image?: string | null;
  walletAddress?: string | null;
  walletProvider?: string | null;
  username?: string | null;
  level?: number;
  xp?: number;
  bio?: string | null;
  isAdmin?: boolean;
  isVerified?: boolean;
  tradeFeeRewardsEnabled?: boolean;
  tradeFeeShareBps?: number;
  tradeFeePayoutAddress?: string | null;
  createdAt?: string | null;
}

type AuthSessionSyncEventDetail = {
  user: AuthUser;
};

// Session state
interface SessionState {
  user: AuthUser | null;
  isLoading: boolean;
  isAuthenticated: boolean;
}

let sessionFetchInFlight: Promise<AuthUser | null> | null = null;
let privySyncInFlight: Promise<{ token: string; user: AuthUser }> | null = null;
let sessionRateLimitedUntil = 0;
let lastPrivySyncAt = 0;
let lastSuccessfulSessionAt = 0;
let unauthorizedSessionFailures = 0;
let inMemoryAuthToken: string | null = null;
let inMemoryCachedAuthUser: { user: AuthUser; cachedAt: number } | null = null;
let inMemoryPrivySyncFailure: PrivySyncFailureSnapshot | null = null;

function normalizeAuthToken(token: string | null | undefined): string | null {
  if (typeof token !== "string") return null;
  const trimmed = token.trim();
  if (!trimmed) return null;
  if (trimmed.length > AUTH_BEARER_TOKEN_MAX_LENGTH) {
    console.warn(`[Auth] Ignoring oversized auth token (${trimmed.length} chars)`);
    return null;
  }
  return trimmed;
}

function getInMemoryCachedAuthUser(): AuthUser | null {
  if (!inMemoryCachedAuthUser) return null;
  if (Date.now() - inMemoryCachedAuthUser.cachedAt > AUTH_SESSION_CACHE_TTL_MS) {
    inMemoryCachedAuthUser = null;
    return null;
  }
  return inMemoryCachedAuthUser.user;
}

function getStoredAuthToken(): string | null {
  const normalizedInMemoryToken = normalizeAuthToken(inMemoryAuthToken);
  if (normalizedInMemoryToken) {
    return normalizedInMemoryToken;
  }
  if (inMemoryAuthToken) {
    inMemoryAuthToken = null;
  }
  try {
    const stored = localStorage.getItem("auth-token");
    const normalizedStoredToken = normalizeAuthToken(stored);
    if (normalizedStoredToken) {
      inMemoryAuthToken = normalizedStoredToken;
      return normalizedStoredToken;
    }
    if (stored) {
      localStorage.removeItem("auth-token");
    }
    return null;
  } catch (error) {
    console.warn("[Auth] Failed to read auth token from localStorage; using cookie auth only", error);
    return null;
  }
}

function setStoredAuthToken(token: string): void {
  const normalizedToken = normalizeAuthToken(token);
  if (!normalizedToken) {
    clearStoredAuthToken();
    return;
  }
  inMemoryAuthToken = normalizedToken;
  try {
    localStorage.setItem("auth-token", normalizedToken);
  } catch (error) {
    // Cookie-based auth is primary. localStorage token is only a fallback.
    console.warn("[Auth] Failed to persist auth token to localStorage; continuing with cookie auth", error);
  }
}

function clearStoredAuthToken(): void {
  inMemoryAuthToken = null;
  try {
    localStorage.removeItem("auth-token");
  } catch (error) {
    console.warn("[Auth] Failed to clear auth token from localStorage", error);
  }
}

setAuthTokenGetter(async () => getStoredAuthToken());

export function hasStoredAuthTokenHint(): boolean {
  return Boolean(getStoredAuthToken());
}

function hasSessionCookieHint(): boolean {
  // Session cookies are HttpOnly and not readable from JS in modern browsers.
  // Keep this best-effort check for legacy non-HttpOnly artifacts only.
  if (typeof document === "undefined") return false;
  const cookieHeader = document.cookie || "";
  if (!cookieHeader) return false;
  return SESSION_COOKIE_CANDIDATE_NAMES.some((cookieName) =>
    cookieHeader.includes(`${cookieName}=`)
  );
}

function readCachedAuthUser(): AuthUser | null {
  if (typeof window === "undefined") return getInMemoryCachedAuthUser();
  try {
    const raw = window.sessionStorage.getItem(AUTH_SESSION_CACHE_KEY);
    if (!raw) {
      return getInMemoryCachedAuthUser();
    }
    const parsed = JSON.parse(raw) as { user?: AuthUser; cachedAt?: number };
    if (!parsed?.user || typeof parsed.cachedAt !== "number") {
      return getInMemoryCachedAuthUser();
    }
    if (Date.now() - parsed.cachedAt > AUTH_SESSION_CACHE_TTL_MS) {
      return getInMemoryCachedAuthUser();
    }
    inMemoryCachedAuthUser = {
      user: parsed.user,
      cachedAt: parsed.cachedAt,
    };
    return parsed.user;
  } catch {
    return getInMemoryCachedAuthUser();
  }
}

function writeCachedAuthUser(user: AuthUser | null): void {
  if (!user) {
    inMemoryCachedAuthUser = null;
  } else {
    inMemoryCachedAuthUser = {
      user,
      cachedAt: Date.now(),
    };
  }

  if (typeof window === "undefined") return;
  try {
    if (!user) {
      window.sessionStorage.removeItem(AUTH_SESSION_CACHE_KEY);
      return;
    }
    window.sessionStorage.setItem(
      AUTH_SESSION_CACHE_KEY,
      JSON.stringify({
        user,
        cachedAt: inMemoryCachedAuthUser?.cachedAt ?? Date.now(),
      })
    );
  } catch {
    // ignore sessionStorage errors
  }
}

function clearCachedAuthUser(): void {
  writeCachedAuthUser(null);
}

export function readCachedAuthUserSnapshot(): AuthUser | null {
  const logoutAt = getExplicitLogoutAt();
  if (logoutAt > 0 && Date.now() - logoutAt < 10_000) {
    return null;
  }

  return readCachedAuthUser();
}

function clearPrivySyncFailureSnapshot(): void {
  inMemoryPrivySyncFailure = null;
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(PRIVY_SYNC_FAILURE_STORAGE_KEY);
  } catch {
    // ignore sessionStorage errors
  }
  window.dispatchEvent(new CustomEvent(AUTH_PRIVY_SYNC_FAILURE_EVENT));
}

function writePrivySyncFailureSnapshot(message: string): void {
  const normalizedMessage = message.trim();
  if (!normalizedMessage) {
    clearPrivySyncFailureSnapshot();
    return;
  }

  const snapshot: PrivySyncFailureSnapshot = {
    message: normalizedMessage,
    recordedAt: Date.now(),
  };
  inMemoryPrivySyncFailure = snapshot;

  if (typeof window !== "undefined") {
    try {
      window.sessionStorage.setItem(
        PRIVY_SYNC_FAILURE_STORAGE_KEY,
        JSON.stringify(snapshot)
      );
    } catch {
      // ignore sessionStorage errors
    }

    window.dispatchEvent(new CustomEvent(AUTH_PRIVY_SYNC_FAILURE_EVENT));
  }
}

export function readPrivySyncFailureSnapshot(): PrivySyncFailureSnapshot | null {
  if (inMemoryPrivySyncFailure) {
    if (Date.now() - inMemoryPrivySyncFailure.recordedAt <= PRIVY_SYNC_FAILURE_TTL_MS) {
      return inMemoryPrivySyncFailure;
    }
    inMemoryPrivySyncFailure = null;
  }

  if (typeof window === "undefined") {
    return null;
  }

  try {
    const raw = window.sessionStorage.getItem(PRIVY_SYNC_FAILURE_STORAGE_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as Partial<PrivySyncFailureSnapshot>;
    if (
      typeof parsed.message !== "string" ||
      parsed.message.trim().length === 0 ||
      typeof parsed.recordedAt !== "number" ||
      !Number.isFinite(parsed.recordedAt)
    ) {
      clearPrivySyncFailureSnapshot();
      return null;
    }
    if (Date.now() - parsed.recordedAt > PRIVY_SYNC_FAILURE_TTL_MS) {
      clearPrivySyncFailureSnapshot();
      return null;
    }
    const snapshot: PrivySyncFailureSnapshot = {
      message: parsed.message.trim(),
      recordedAt: parsed.recordedAt,
    };
    inMemoryPrivySyncFailure = snapshot;
    return snapshot;
  } catch {
    clearPrivySyncFailureSnapshot();
    return null;
  }
}

export function usePrivySyncFailureSnapshot(): PrivySyncFailureSnapshot | null {
  const [snapshot, setSnapshot] = useState<PrivySyncFailureSnapshot | null>(() =>
    readPrivySyncFailureSnapshot()
  );

  useEffect(() => {
    if (typeof window === "undefined") return;

    const refreshSnapshot = () => {
      setSnapshot(readPrivySyncFailureSnapshot());
    };

    const handleStorage = (event: StorageEvent) => {
      if (event.key && event.key !== PRIVY_SYNC_FAILURE_STORAGE_KEY) {
        return;
      }
      refreshSnapshot();
    };

    window.addEventListener(AUTH_PRIVY_SYNC_FAILURE_EVENT, refreshSnapshot as EventListener);
    window.addEventListener("storage", handleStorage);
    return () => {
      window.removeEventListener(AUTH_PRIVY_SYNC_FAILURE_EVENT, refreshSnapshot as EventListener);
      window.removeEventListener("storage", handleStorage);
    };
  }, []);

  return snapshot;
}

export function updateCachedAuthUser(
  updates:
    | Partial<AuthUser>
    | ((currentUser: AuthUser) => AuthUser | null)
): void {
  const currentUser = readCachedAuthUser();
  if (!currentUser) {
    return;
  }

  const nextUser =
    typeof updates === "function"
      ? updates(currentUser)
      : {
          ...currentUser,
          ...updates,
        };

  writeCachedAuthUser(nextUser);
  if (nextUser) {
    emitAuthSessionSynced(nextUser);
  }
}

function toAuthUser(
  user: Partial<AuthUser> & { id: string; email?: string | null; name?: string | null }
): AuthUser {
  const normalizedEmail =
    typeof user.email === "string" && user.email.trim().length > 0
      ? user.email.trim()
      : `${user.id.slice(0, 24).toLowerCase()}@privy.local`;
  const normalizedName =
    typeof user.name === "string" && user.name.trim().length > 0
      ? user.name.trim()
      : normalizedEmail.split("@")[0] || "User";

  return {
    id: user.id,
    email: normalizedEmail,
    name: normalizedName,
    image: user.image ?? null,
    walletAddress: user.walletAddress ?? null,
    walletProvider: user.walletProvider ?? null,
    username: user.username ?? null,
    level: typeof user.level === "number" && Number.isFinite(user.level) ? user.level : 0,
    xp: typeof user.xp === "number" && Number.isFinite(user.xp) ? user.xp : 0,
    bio: user.bio ?? null,
    isAdmin: user.isAdmin ?? false,
    isVerified: user.isVerified ?? false,
    tradeFeeRewardsEnabled:
      typeof user.tradeFeeRewardsEnabled === "boolean" ? user.tradeFeeRewardsEnabled : undefined,
    tradeFeeShareBps:
      typeof user.tradeFeeShareBps === "number" && Number.isFinite(user.tradeFeeShareBps)
        ? user.tradeFeeShareBps
        : undefined,
    tradeFeePayoutAddress: user.tradeFeePayoutAddress ?? null,
    createdAt: typeof user.createdAt === "string" ? user.createdAt : null,
  };
}

function emitAuthSessionSynced(user: AuthUser): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<AuthSessionSyncEventDetail>(AUTH_SESSION_SYNC_EVENT, {
      detail: { user },
    })
  );
}

// Auth context
interface AuthContextType extends SessionState {
  refetch: () => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

// Fetch session from backend using /api/me endpoint
// This endpoint uses our custom middleware that supports Bearer tokens
async function fetchSession(): Promise<AuthUser | null> {
  const now = Date.now();
  const cachedUser = readCachedAuthUser();
  const token = getStoredAuthToken();

  if (
    cachedUser &&
    lastPrivySyncAt > 0 &&
    now - lastPrivySyncAt < AUTH_CACHE_FIRST_AFTER_PRIVY_SYNC_MS
  ) {
    return cachedUser;
  }
  if (sessionRateLimitedUntil > now && cachedUser) {
    return cachedUser;
  }

  if (sessionFetchInFlight) {
    return sessionFetchInFlight;
  }

  sessionFetchInFlight = (async () => {
  const requestStartedAt = Date.now();
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), SESSION_FETCH_TIMEOUT_MS);
  try {
    // Get token from localStorage as fallback for cross-origin issues
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }

    // Use /api/me which supports Bearer token auth via our middleware
    const response = await fetch(`${baseURL}/api/me`, {
      credentials: "include",
      headers,
      signal: controller.signal,
    });

    if (!response.ok) {
      console.log("[Auth] Session response not ok:", response.status);
      if (response.status === 429) {
        const retryAfterHeader = response.headers.get("retry-after");
        const retryAfterSeconds = Number.parseInt(retryAfterHeader || "", 10);
        const backoffMs =
          Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0
            ? retryAfterSeconds * 1000
            : 5000;
        sessionRateLimitedUntil = Date.now() + backoffMs;
        console.warn(`[Auth] /api/me rate limited. Backing off for ${Math.ceil(backoffMs / 1000)}s`);
      }
      // Clear invalid token
      if (response.status === 401) {
        if (lastPrivySyncAt > requestStartedAt) {
          console.warn("[Auth] Ignoring stale 401 from /api/me after newer Privy sync");
          return cachedUser;
        }

        unauthorizedSessionFailures += 1;
        const recentlySynced =
          lastPrivySyncAt > 0 && Date.now() - lastPrivySyncAt < AUTH_401_GRACE_AFTER_PRIVY_SYNC_MS;
        const recentlyHealthySession =
          lastSuccessfulSessionAt > 0 &&
          Date.now() - lastSuccessfulSessionAt < AUTH_TRANSIENT_401_RECOVERY_MS;
        const hasToken = Boolean(token || getStoredAuthToken());
        const shouldTreatAsTransient =
          recentlySynced ||
          (hasToken && recentlyHealthySession) ||
          (hasToken && unauthorizedSessionFailures < AUTH_MAX_401_FAILURES_BEFORE_SIGNOUT);

        if (
          cachedUser &&
          shouldTreatAsTransient
        ) {
          sessionRateLimitedUntil = Date.now() + 2000;
          console.warn(
            `[Auth] Temporary 401 from /api/me; keeping cached session (${unauthorizedSessionFailures})`
          );
          return cachedUser;
        }

        if (shouldTreatAsTransient) {
          console.warn(
            `[Auth] Temporary 401 from /api/me; preserving auth token (${unauthorizedSessionFailures})`
          );
          return cachedUser;
        }

        clearStoredAuthToken();
        clearCachedAuthUser();
        sessionRateLimitedUntil = Date.now() + 5000;
        return null;
      }
      return cachedUser;
    }

    sessionRateLimitedUntil = 0;
    unauthorizedSessionFailures = 0;
    lastSuccessfulSessionAt = Date.now();
    const text = await response.text();

    // Handle null or empty responses
    if (!text || text === "null" || text === "undefined") {
      return cachedUser;
    }

    try {
      const data = JSON.parse(text);

      // /api/me returns user data directly wrapped in { data: user }
      const user = data.data || data;
      if (user && user.id) {
        const authUser = toAuthUser(user);
        writeCachedAuthUser(authUser);
        clearPrivySyncFailureSnapshot();
        return authUser;
      }

      const explicitNoSessionResponse =
        data === null ||
        (typeof data === "object" &&
          data !== null &&
          "data" in data &&
          (data as { data?: unknown }).data === null);

      if (explicitNoSessionResponse) {
        if (token) {
          clearStoredAuthToken();
        }
        clearCachedAuthUser();
        return null;
      }
    } catch (parseError) {
      console.log("[Auth] Failed to parse session response:", parseError);
    }

    return cachedUser;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      console.warn("[Auth] /api/me timed out, using cached session if available");
      return cachedUser;
    }
    console.error("[Auth] Failed to fetch session:", error);
    return cachedUser;
  } finally {
    clearTimeout(timeoutId);
    sessionFetchInFlight = null;
  }
  })();

  return sessionFetchInFlight;
}

// Auth Provider component
export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<SessionState>(() => {
    const cachedUser = readCachedAuthUser();
    return {
      user: cachedUser,
      isLoading: !cachedUser,
      isAuthenticated: !!cachedUser,
    };
  });

  const resolveSessionWithRetry = useCallback(async () => {
    const optimisticCachedUser = readCachedAuthUser();
    if (
      optimisticCachedUser &&
      lastPrivySyncAt > 0 &&
      Date.now() - lastPrivySyncAt < AUTH_CACHE_FIRST_AFTER_PRIVY_SYNC_MS
    ) {
      return optimisticCachedUser;
    }

    let user = await fetchSession();
    if (user) {
      return user;
    }

    // Fresh tabs can momentarily race cookie/session propagation right after sign-in.
    // Retry when we have either bearer token/session hints, or immediately after a Privy sync.
    const hasStoredToken = Boolean(getStoredAuthToken());
    const hasCookieSessionHint = hasSessionCookieHint();
    const recentlySynced =
      lastPrivySyncAt > 0 && Date.now() - lastPrivySyncAt < AUTH_401_GRACE_AFTER_PRIVY_SYNC_MS;
    if (!hasStoredToken && !hasCookieSessionHint && !recentlySynced) {
      return null;
    }

    const retryAttempts = hasStoredToken
      ? AUTH_SESSION_RETRY_ATTEMPTS_WITH_TOKEN
      : AUTH_SESSION_RETRY_ATTEMPTS_WITH_COOKIE;
    const retryDelayMs = hasStoredToken
      ? AUTH_SESSION_RETRY_DELAY_MS
      : AUTH_SESSION_RETRY_DELAY_WITH_COOKIE_MS;

    for (let attempt = 1; attempt < retryAttempts; attempt += 1) {
      await new Promise<void>((resolve) => {
        setTimeout(resolve, retryDelayMs);
      });
      user = await fetchSession();
      if (user) {
        return user;
      }
    }

    return null;
  }, []);

  const refetch = useCallback(async () => {
    try {
      const user = await resolveSessionWithRetry();
      setState({
        user,
        isLoading: false,
        isAuthenticated: !!user,
      });
    } catch {
      setState({
        user: null,
        isLoading: false,
        isAuthenticated: false,
      });
    }
  }, [resolveSessionWithRetry]);

  const logout = useCallback(async () => {
    const logoutToken = getStoredAuthToken();

    for (const hook of preLogoutHooks) {
      try {
        await hook();
      } catch (error) {
        console.warn("[Auth] Pre-logout hook failed:", error);
      }
    }

    explicitLogoutAt = Date.now();
    clearStoredAuthToken();
    clearCachedAuthUser();
    clearPrivySyncFailureSnapshot();
    clearSessionCacheByPrefix("phew.");
    sessionRateLimitedUntil = 0;
    sessionFetchInFlight = null;
    privySyncInFlight = null;
    lastPrivySyncAt = 0;
    lastSuccessfulSessionAt = 0;
    unauthorizedSessionFailures = 0;
    setState({
      user: null,
      isLoading: false,
      isAuthenticated: false,
    });

    try {
      await signOut({ token: logoutToken });
    } catch (error) {
      console.error("[Auth] Logout error:", error);
    }
  }, []);

  // Initial session check
  useEffect(() => {
    let mounted = true;

    const checkSession = async () => {
      const user = await resolveSessionWithRetry();
      if (mounted) {
        setState({
          user,
          isLoading: false,
          isAuthenticated: !!user,
        });
      }
    };

    checkSession();

    return () => {
      mounted = false;
    };
  }, [resolveSessionWithRetry]);

  // Fast-path auth hydration after Privy sync without waiting for /api/me roundtrips.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const handleSessionSynced = (event: Event) => {
      const customEvent = event as CustomEvent<AuthSessionSyncEventDetail>;
      const syncedUser = customEvent.detail?.user;
      if (!syncedUser?.id) return;
      setState({
        user: syncedUser,
        isLoading: false,
        isAuthenticated: true,
      });
    };
    window.addEventListener(AUTH_SESSION_SYNC_EVENT, handleSessionSynced as EventListener);
    return () => {
      window.removeEventListener(AUTH_SESSION_SYNC_EVENT, handleSessionSynced as EventListener);
    };
  }, []);

  return createElement(
    AuthContext.Provider,
    { value: { ...state, refetch, logout } },
    children
  );
}

// Hook to use auth context
export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within AuthProvider");
  }

  return {
    user: context.user,
    isAuthenticated: context.isAuthenticated,
    isReady: !context.isLoading,
    isPending: context.isLoading,
    signOut: context.logout,
    refetch: context.refetch,
  };
}

// Session hook for ProtectedRoute/GuestRoute compatibility
export function useSession() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useSession must be used within AuthProvider");
  }

  return {
    data: context.user ? { user: context.user } : null,
    isPending: context.isLoading,
  };
}

// Legacy compatibility
export function usePrivyAuth() {
  const auth = useAuth();
  return {
    user: auth.user
      ? {
          id: auth.user.id,
          email: auth.user.email,
          walletAddress: auth.user.walletAddress ?? null,
          linkedAccounts: [],
        }
      : null,
    isAuthenticated: auth.isAuthenticated,
    isReady: auth.isReady,
    login: () => console.warn("login() - use form-based login"),
    logout: auth.signOut,
  };
}

// Sign up function - use direct fetch for reliability
export async function signUpWithEmail(email: string, password: string, name: string) {
  console.log("[Auth] Attempting sign up for:", email);
  try {
    const response = await fetch(`${baseURL}/api/auth/sign-up/email`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ email, password, name }),
    });

    // Try to parse JSON, but handle empty responses
    let data: { message?: string; code?: string; token?: string; [key: string]: unknown } | null = null;
    const text = await response.text();
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        console.log("[Auth] Response is not JSON:", text);
      }
    }
    console.log("[Auth] Sign up response:", response.status, data);

    if (!response.ok) {
      return { error: { message: data?.message || data?.code || "Failed to create account" } };
    }

    // Store token in localStorage for cross-origin auth
    if (data?.token) {
      setStoredAuthToken(data.token);
    }

    return { data: data || { success: true } };
  } catch (error) {
    console.error("[Auth] Sign up error:", error);
    return { error: { message: error instanceof Error ? error.message : "Sign up failed" } };
  }
}

// Sign in function - use direct fetch for reliability
export async function signInWithEmail(email: string, password: string) {
  console.log("[Auth] Attempting sign in for:", email);
  try {
    const response = await fetch(`${baseURL}/api/auth/sign-in/email`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ email, password }),
    });

    // Try to parse JSON, but handle empty responses
    let data: { message?: string; code?: string; token?: string; [key: string]: unknown } | null = null;
    const text = await response.text();
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        console.log("[Auth] Response is not JSON:", text);
      }
    }
    console.log("[Auth] Sign in response:", response.status, data);

    if (!response.ok) {
      return { error: { message: data?.message || data?.code || "Invalid email or password" } };
    }

    // Store token in localStorage for cross-origin auth
    if (data?.token) {
      setStoredAuthToken(data.token);
    }

    return { data: data || { success: true } };
  } catch (error) {
    console.error("[Auth] Sign in error:", error);
    return { error: { message: error instanceof Error ? error.message : "Sign in failed" } };
  }
}

// Sign in with Google - use direct redirect
export async function signInWithGoogle() {
  console.log("[Auth] Redirecting to Google sign in");
  // Redirect to Google OAuth
  const callbackURL = encodeURIComponent(window.location.origin);
  window.location.href = `${baseURL}/api/auth/sign-in/social?provider=google&callbackURL=${callbackURL}`;
}

// Forgot password - request password reset email
export async function forgotPassword(email: string) {
  console.log("[Auth] Requesting password reset for:", email);
  try {
    const response = await fetch(`${baseURL}/api/auth/request-password-reset`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        email,
        redirectTo: "/reset-password",
      }),
    });

    let data: { message?: string; code?: string; [key: string]: unknown } | null = null;
    const text = await response.text();
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        console.log("[Auth] Response is not JSON:", text);
      }
    }
    console.log("[Auth] Forgot password response:", response.status, data);

    if (!response.ok) {
      return { error: { message: data?.message || data?.code || "Failed to send reset email" } };
    }

    return { data: data || { success: true } };
  } catch (error) {
    console.error("[Auth] Forgot password error:", error);
    return { error: { message: error instanceof Error ? error.message : "Failed to send reset email" } };
  }
}

// Reset password with token
export async function resetPassword(newPassword: string, token: string) {
  console.log("[Auth] Resetting password with token");
  try {
    const response = await fetch(`${baseURL}/api/auth/reset-password`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ newPassword, token }),
    });

    let data: { message?: string; code?: string; [key: string]: unknown } | null = null;
    const text = await response.text();
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        console.log("[Auth] Response is not JSON:", text);
      }
    }
    console.log("[Auth] Reset password response:", response.status, data);

    if (!response.ok) {
      return { error: { message: data?.message || data?.code || "Failed to reset password" } };
    }

    return { data: data || { success: true } };
  } catch (error) {
    console.error("[Auth] Reset password error:", error);
    return { error: { message: error instanceof Error ? error.message : "Failed to reset password" } };
  }
}

// Sync a Privy-authenticated user to our backend, getting back a Better Auth session token
export async function syncPrivySession(
  privyUserId: string,
  email?: string,
  name?: string,
  privyIdToken?: string
): Promise<{ token: string; user: AuthUser }> {
  if (privySyncInFlight) {
    return privySyncInFlight;
  }

  const maxAttempts = PRIVY_SYNC_RETRY_DELAYS_MS.length + 1;
  const syncStartedAt = Date.now();

  privySyncInFlight = (async () => {
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), PRIVY_SYNC_TIMEOUT_MS);

      try {
        const token = getStoredAuthToken();
        const response = await fetch(`${baseURL}/api/auth/privy-sync`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          credentials: "include",
          signal: controller.signal,
          body: JSON.stringify({ privyUserId, email, name, privyIdToken }),
        });

        const text = await response.text();
        if (!text) {
          throw new Error("Empty response from auth server");
        }

        let data: { token?: string; user?: AuthUser; error?: { message?: string } } | null = null;
        try {
          data = JSON.parse(text);
        } catch {
          console.error("[Auth] Failed to parse privy-sync response:", text);
          throw new Error("Invalid response from auth server");
        }

        if (!response.ok || !data?.token || !data?.user) {
          const retryAfterHeader = response.headers.get("retry-after");
          const retryAfterSeconds = Number.parseInt(retryAfterHeader || "", 10);
          const message =
            data?.error?.message ??
            (response.status === 429
              ? "Too many requests"
              : response.status ? `Failed to sign in (${response.status})` : "Failed to sign in");
          const retryable = response.status === 429 || response.status >= 500;
          if (retryable && attempt < PRIVY_SYNC_RETRY_DELAYS_MS.length) {
            const delay = response.status === 429
              ? Math.min((Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0 ? retryAfterSeconds * 1000 : 1500), 3000)
              : PRIVY_SYNC_RETRY_DELAYS_MS[attempt];
            await new Promise<void>((resolve) => {
              setTimeout(resolve, delay);
            });
            continue;
          }
          console.error("[Auth] privy-sync failed:", message);
          throw new Error(message);
        }

        const syncedUser = toAuthUser(data.user);
        if (explicitLogoutAt > syncStartedAt) {
          throw new Error("Session sync completed after logout");
        }

        // Mark sync first so any in-flight pre-login /api/me response cannot wipe the fresh session.
        lastPrivySyncAt = Date.now();
        lastSuccessfulSessionAt = Date.now();
        sessionRateLimitedUntil = 0;
        sessionFetchInFlight = null;
        unauthorizedSessionFailures = 0;

        // Store the session token for Bearer auth fallback
        setStoredAuthToken(data.token);
        writeCachedAuthUser(syncedUser);
        clearPrivySyncFailureSnapshot();
        emitAuthSessionSynced(syncedUser);
        return { token: data.token, user: syncedUser };
      } catch (error) {
        const isAbort = error instanceof Error && error.name === "AbortError";
        const message = error instanceof Error ? error.message : String(error);
        const retryable =
          isAbort ||
          /network|failed to fetch|timeout|temporarily|server|rate limit|too many requests/i.test(message);

        if (retryable && attempt < PRIVY_SYNC_RETRY_DELAYS_MS.length) {
          await new Promise<void>((resolve) => {
            setTimeout(resolve, PRIVY_SYNC_RETRY_DELAYS_MS[attempt]);
          });
          continue;
        }

        const finalMessage = isAbort
          ? "Sign-in timed out while connecting to the server"
          : error instanceof Error
            ? error.message
            : "Failed to sync Privy session";
        writePrivySyncFailureSnapshot(finalMessage);
        console.error("[Auth] syncPrivySession error:", error);
        if (isAbort) {
          throw new Error(finalMessage);
        }
        if (error instanceof Error) {
          throw error;
        }
        throw new Error(finalMessage);
      } finally {
        clearTimeout(timeoutId);
      }
    }

    throw new Error("Failed to sync Privy session");
  })();

  try {
    return await privySyncInFlight;
  } finally {
    privySyncInFlight = null;
  }
}

// Check if running in an iframe
export function isInIframe(): boolean {
  try {
    return window.self !== window.top;
  } catch {
    return true;
  }
}
