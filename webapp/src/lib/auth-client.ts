import { useState, useEffect, useCallback, createContext, useContext, createElement } from "react";
import type { ReactNode } from "react";
import { useRef } from "react";
import { clearSessionCacheByPrefix } from "./session-cache";
import {
  cancelPrivyIdentityRetryTimers,
  getPrivyIdentityRateLimitRemainingMs,
  requestPrivyIdentityTokenForBackendSync,
  type PrivyIdentityDebugContext,
  type PrivyUserLike,
} from "./privy-user";

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
const AUTH_SESSION_CONFIRMATION_TIMEOUT_MS = 5_500;
const AUTH_SESSION_FAST_CONFIRMATION_TIMEOUT_MS = 1_400;
const AUTH_SESSION_CONFIRMATION_RETRY_DELAYS_MS = [120, 220, 380, 650, 900] as const;
// Keep this comfortably above the backend /api/me lookup budget so the client
// does not abort session hydration before the server can serve a fallback.
const SESSION_FETCH_TIMEOUT_MS = 4500;
const SIGN_OUT_TIMEOUT_MS = 1500;
const AUTH_SESSION_RETRY_DELAY_MS = 300;
const AUTH_SESSION_RETRY_ATTEMPTS_WITH_TOKEN = 4;
const AUTH_SESSION_RETRY_DELAY_WITH_COOKIE_MS = 450;
const AUTH_SESSION_RETRY_ATTEMPTS_WITH_COOKIE = 3;
const PRIVY_SYNC_TIMEOUT_MS = 9_000;
const PRIVY_BOOTSTRAP_MAX_ATTEMPTS = 2;
const PRIVY_BOOTSTRAP_FINALIZATION_RETRY_DELAY_MS = 2_000;
const PRIVY_BOOTSTRAP_FINALIZATION_TIMEOUT_MS = 2_500;
const PRIVY_PENDING_IDENTITY_TOKEN_WAIT_MS = 1_500;
const PRIVY_IDENTITY_TOKEN_HOOK_POLL_INTERVAL_MS = 120;
const PRIVY_RATE_LIMIT_FAILURE_MESSAGE =
  "Privy is temporarily rate limiting sign-in. Please wait 10-15 seconds, then tap Sign in again.";
const SESSION_COOKIE_CANDIDATE_NAMES = [
  "phew.session_token",
  "better-auth.session_token",
  "auth.session_token",
  "session_token",
] as const;
const LEGACY_AUTH_TOKEN_STORAGE_KEY = "auth-token";
const AUTH_SESSION_SYNC_EVENT = "phew:auth-session-synced";
const PRIVY_SYNC_FAILURE_STORAGE_KEY = "phew.auth.privy-sync-failure.v1";
const PRIVY_SYNC_FAILURE_TTL_MS = 5 * 60 * 1000;
const AUTH_PRIVY_SYNC_FAILURE_EVENT = "phew:auth-privy-sync-failure";
const PRIVY_BOOTSTRAP_STATE_STORAGE_KEY = "phew.auth.privy-bootstrap.v1";
const PRIVY_BOOTSTRAP_STATE_TTL_MS = 30_000;
const PRIVY_BOOTSTRAP_LOCK_STORAGE_KEY = "phew.auth.privy-bootstrap.lock.v1";
const PRIVY_BOOTSTRAP_LOCK_TTL_MS = 20_000;
const PRIVY_BOOTSTRAP_TAB_ID_STORAGE_KEY = "phew.auth.tab-id.v1";
const AUTH_PRIVY_BOOTSTRAP_EVENT = "phew:auth-privy-bootstrap";
const EXPLICIT_LOGOUT_COOLDOWN_MS = 3_500;
const AUTH_BOOTSTRAPPED_SESSION_GRACE_MS = 20_000;

type PrivySyncFailureSnapshot = {
  message: string;
  recordedAt: number;
};

export type PrivyAuthBootstrapState =
  | "idle"
  | "privy_hydrating"
  | "privy_pending"
  | "awaiting_identity_token"
  | "awaiting_identity_verification_finalization"
  | "cooldown"
  | "syncing_backend"
  | "authenticated"
  | "anonymous"
  | "logout_in_progress"
  | "failed_rate_limited"
  | "failed";

export type AuthUiState =
  | "signed_out"
  | "hydrating"
  | "connecting_backend_session"
  | "finalizing_identity_verification"
  | "authenticated"
  | "rate_limited"
  | "logout_in_progress";

export type PrivyAuthBootstrapMode = "manual" | "auto" | "system";
export type PrivyAuthBootstrapOwner = "AuthInitializer" | "usePrivyLogin" | "system";

export type PrivyAuthBootstrapSnapshot = {
  state: PrivyAuthBootstrapState;
  owner: PrivyAuthBootstrapOwner;
  mode: PrivyAuthBootstrapMode;
  tabId: string | null;
  userId: string | null;
  detail: string | null;
  debugCode: string | null;
  backendSyncStarted: boolean;
  attempt: number;
  totalAttempts: number;
  retryScheduled: boolean;
  retryDelayMs: number | null;
  cooldownUntilMs: number | null;
  recordedAt: number;
};

type StartPrivyAuthBootstrapOptions = {
  owner: PrivyAuthBootstrapOwner;
  mode?: PrivyAuthBootstrapMode;
  user: PrivyUserLike;
  getLatestUser?: () => PrivyUserLike | null | undefined;
  privyReady?: boolean;
  privyAuthenticated?: boolean;
  privyIdentityToken?: string | null | undefined;
  getLatestPrivyIdentityToken?: () => string | null | undefined;
  refreshPrivyAuthState?: () => Promise<PrivyUserLike | null | undefined>;
  privyAccessToken?: string | null | undefined;
  getLatestPrivyAccessToken?: () => Promise<string | null | undefined> | string | null | undefined;
  tryExistingBackendSession?: boolean;
  triggerSource?: "component_mount" | "manual_user_action" | "system";
};

type PrivyAuthBootstrapLock = {
  ownerTabId: string;
  userId: string | null;
  acquiredAt: number;
  expiresAt: number;
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

export function isExplicitLogoutCoolingDown(referenceTime = Date.now()): boolean {
  return explicitLogoutAt > 0 && referenceTime - explicitLogoutAt < EXPLICIT_LOGOUT_COOLDOWN_MS;
}

export function hasRecentPrivySyncGrace(referenceTime = Date.now()): boolean {
  if (isExplicitLogoutCoolingDown(referenceTime)) {
    return false;
  }
  return (
    lastPrivySyncAt > 0 &&
    referenceTime - lastPrivySyncAt < AUTH_401_GRACE_AFTER_PRIVY_SYNC_MS
  );
}

export function hasValidatedAuthSession(referenceTime = Date.now()): boolean {
  if (isExplicitLogoutCoolingDown(referenceTime)) {
    return false;
  }
  if (lastSuccessfulSessionAt > 0) {
    return true;
  }
  return (
    lastBootstrappedSessionAt > 0 &&
    referenceTime - lastBootstrappedSessionAt < AUTH_BOOTSTRAPPED_SESSION_GRACE_MS
  );
}

// Privy-only auth: keep legacy exports as explicit unsupported stubs so callers fail loudly.
export async function signIn() {
  throw new Error("Email/password auth has been removed. Use Privy sign-in.");
}

export async function signUp() {
  throw new Error("Email/password auth has been removed. Use Privy sign-in.");
}

export async function signOut(options?: { token?: string | null }) {
  void options;
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
let privySyncInFlight: Promise<{ user: AuthUser }> | null = null;
let privyAuthBootstrapInFlight: Promise<AuthUser | null> | null = null;
let inMemoryPrivyBootstrapTabId: string | null = null;
const privyAuthRetryWaiters = new Map<number, (completed: boolean) => void>();
let sessionRateLimitedUntil = 0;
let lastPrivySyncAt = 0;
let lastSuccessfulSessionAt = 0;
let lastBootstrappedSessionAt = 0;
let unauthorizedSessionFailures = 0;
let inMemoryCachedAuthUser: { user: AuthUser; cachedAt: number } | null = null;
let inMemoryPrivySyncFailure: PrivySyncFailureSnapshot | null = null;
let inMemoryPrivyBootstrapSnapshot: PrivyAuthBootstrapSnapshot | null = null;

function getInMemoryCachedAuthUser(): AuthUser | null {
  if (!inMemoryCachedAuthUser) return null;
  if (Date.now() - inMemoryCachedAuthUser.cachedAt > AUTH_SESSION_CACHE_TTL_MS) {
    inMemoryCachedAuthUser = null;
    return null;
  }
  return inMemoryCachedAuthUser.user;
}

function clearLegacyStoredAuthTokenArtifacts(): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(LEGACY_AUTH_TOKEN_STORAGE_KEY);
  } catch (error) {
    console.warn("[Auth] Failed to clear legacy auth token from localStorage", error);
  }
}

function getStoredAuthToken(): string | null {
  clearLegacyStoredAuthTokenArtifacts();
  return null;
}

function setStoredAuthToken(_token: string): void {
  clearLegacyStoredAuthTokenArtifacts();
}

function clearStoredAuthToken(): void {
  clearLegacyStoredAuthTokenArtifacts();
}

export function hasStoredAuthTokenHint(): boolean {
  if (isExplicitLogoutCoolingDown()) {
    return false;
  }
  return Boolean(readCachedAuthUser()) || hasSessionCookieHint();
}

function hasRecoverableBackendSessionHint(referenceTime = Date.now()): boolean {
  if (isExplicitLogoutCoolingDown(referenceTime)) {
    return false;
  }

  return (
    Boolean(readCachedAuthUser()) ||
    hasSessionCookieHint() ||
    hasRecentPrivySyncGrace(referenceTime) ||
    hasValidatedAuthSession(referenceTime) ||
    lastSuccessfulSessionAt > 0 ||
    lastBootstrappedSessionAt > 0
  );
}

clearLegacyStoredAuthTokenArtifacts();

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
  if (isExplicitLogoutCoolingDown()) {
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

export function clearPrivySyncFailureState(): void {
  clearPrivySyncFailureSnapshot();
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

function writePrivyBootstrapSnapshot(snapshot: PrivyAuthBootstrapSnapshot | null): void {
  inMemoryPrivyBootstrapSnapshot = snapshot;

  if (typeof window === "undefined") {
    return;
  }

  try {
    if (!snapshot || snapshot.state === "idle") {
      window.localStorage.removeItem(PRIVY_BOOTSTRAP_STATE_STORAGE_KEY);
    } else {
      window.localStorage.setItem(
        PRIVY_BOOTSTRAP_STATE_STORAGE_KEY,
        JSON.stringify(snapshot)
      );
    }
  } catch {
    // ignore storage errors
  }

  window.dispatchEvent(new CustomEvent(AUTH_PRIVY_BOOTSTRAP_EVENT));
}

function normalizePrivyAuthBootstrapState(
  value: unknown
): PrivyAuthBootstrapState | null {
  switch (value) {
    case "idle":
    case "privy_hydrating":
    case "privy_pending":
    case "awaiting_identity_token":
    case "awaiting_identity_verification_finalization":
    case "cooldown":
    case "syncing_backend":
    case "authenticated":
    case "anonymous":
    case "logout_in_progress":
    case "failed_rate_limited":
    case "failed":
      return value;
    case "sync_started":
      return "syncing_backend";
    case "sync_succeeded":
      return "authenticated";
    case "sync_failed":
      return "failed";
    default:
      return null;
  }
}

function normalizePrivyAuthBootstrapMode(
  value: unknown
): PrivyAuthBootstrapMode {
  return value === "manual" || value === "auto" || value === "system"
    ? value
    : "system";
}

function normalizePrivyAuthBootstrapOwner(
  value: unknown
): PrivyAuthBootstrapOwner {
  return value === "AuthInitializer" || value === "usePrivyLogin" || value === "system"
    ? value
    : "system";
}

export function getAuthUiState(options: {
  snapshot: PrivyAuthBootstrapSnapshot | null | undefined;
  privyAuthenticated?: boolean;
  logoutCoolingDown?: boolean;
}): AuthUiState {
  const { snapshot, privyAuthenticated = false, logoutCoolingDown = false } = options;

  if (logoutCoolingDown || snapshot?.state === "logout_in_progress") {
    return "logout_in_progress";
  }

  switch (snapshot?.state) {
    case "authenticated":
      return "authenticated";
    case "privy_hydrating":
      return "hydrating";
    case "awaiting_identity_verification_finalization":
      return "finalizing_identity_verification";
    case "failed_rate_limited":
      return "rate_limited";
    case "privy_pending":
    case "awaiting_identity_token":
    case "cooldown":
    case "syncing_backend":
      return "connecting_backend_session";
    case "failed":
      return privyAuthenticated ? "finalizing_identity_verification" : "signed_out";
    case "anonymous":
    case "idle":
    default:
      return "signed_out";
  }
}

export function readPrivyAuthBootstrapSnapshot(): PrivyAuthBootstrapSnapshot | null {
  const now = Date.now();

  if (inMemoryPrivyBootstrapSnapshot) {
    if (now - inMemoryPrivyBootstrapSnapshot.recordedAt <= PRIVY_BOOTSTRAP_STATE_TTL_MS) {
      return inMemoryPrivyBootstrapSnapshot;
    }
    inMemoryPrivyBootstrapSnapshot = null;
  }

  if (typeof window === "undefined") {
    return null;
  }

  try {
    const raw = window.localStorage.getItem(PRIVY_BOOTSTRAP_STATE_STORAGE_KEY);
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw) as Partial<
      PrivyAuthBootstrapSnapshot & {
        phase?: string;
        source?: string;
      }
    >;
    const normalizedState = normalizePrivyAuthBootstrapState(
      parsed.state ?? parsed.phase
    );
    if (!normalizedState || typeof parsed.recordedAt !== "number" || !Number.isFinite(parsed.recordedAt)) {
      writePrivyBootstrapSnapshot(null);
      return null;
    }

    if (now - parsed.recordedAt > PRIVY_BOOTSTRAP_STATE_TTL_MS) {
      writePrivyBootstrapSnapshot(null);
      return null;
    }

    const snapshot: PrivyAuthBootstrapSnapshot = {
      state: normalizedState,
      owner: normalizePrivyAuthBootstrapOwner(parsed.owner),
      mode: normalizePrivyAuthBootstrapMode(parsed.mode ?? parsed.source),
      tabId: typeof parsed.tabId === "string" && parsed.tabId.length > 0 ? parsed.tabId : null,
      userId: typeof parsed.userId === "string" && parsed.userId.length > 0 ? parsed.userId : null,
      detail:
        typeof parsed.detail === "string" && parsed.detail.trim().length > 0
          ? parsed.detail.trim()
          : null,
      debugCode:
        typeof parsed.debugCode === "string" && parsed.debugCode.trim().length > 0
          ? parsed.debugCode.trim()
          : null,
      backendSyncStarted: parsed.backendSyncStarted === true,
      attempt:
        typeof parsed.attempt === "number" && Number.isFinite(parsed.attempt) ? parsed.attempt : 0,
      totalAttempts:
        typeof parsed.totalAttempts === "number" && Number.isFinite(parsed.totalAttempts)
          ? parsed.totalAttempts
          : typeof parsed.attempt === "number" && Number.isFinite(parsed.attempt)
            ? parsed.attempt
            : 0,
      retryScheduled: parsed.retryScheduled === true,
      retryDelayMs:
        typeof parsed.retryDelayMs === "number" && Number.isFinite(parsed.retryDelayMs)
          ? parsed.retryDelayMs
          : null,
      cooldownUntilMs:
        typeof parsed.cooldownUntilMs === "number" && Number.isFinite(parsed.cooldownUntilMs)
          ? parsed.cooldownUntilMs
          : null,
      recordedAt: parsed.recordedAt,
    };

    inMemoryPrivyBootstrapSnapshot = snapshot;
    return snapshot;
  } catch {
    writePrivyBootstrapSnapshot(null);
    return null;
  }
}

function generatePrivyBootstrapTabId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `tab_${Math.random().toString(36).slice(2, 12)}_${Date.now().toString(36)}`;
}

function getPrivyBootstrapTabId(): string {
  if (inMemoryPrivyBootstrapTabId) {
    return inMemoryPrivyBootstrapTabId;
  }

  if (typeof window === "undefined") {
    inMemoryPrivyBootstrapTabId = generatePrivyBootstrapTabId();
    return inMemoryPrivyBootstrapTabId;
  }

  try {
    const stored = window.sessionStorage.getItem(PRIVY_BOOTSTRAP_TAB_ID_STORAGE_KEY)?.trim();
    if (stored) {
      inMemoryPrivyBootstrapTabId = stored;
      return stored;
    }
  } catch {
    // ignore storage errors
  }

  const created = generatePrivyBootstrapTabId();
  inMemoryPrivyBootstrapTabId = created;

  try {
    window.sessionStorage.setItem(PRIVY_BOOTSTRAP_TAB_ID_STORAGE_KEY, created);
  } catch {
    // ignore storage errors
  }

  return created;
}

function doesPrivyAuthBootstrapSnapshotBelongToCurrentTab(
  snapshot: PrivyAuthBootstrapSnapshot | null | undefined
): boolean {
  if (!snapshot?.tabId) {
    return false;
  }

  return snapshot.tabId === getPrivyBootstrapTabId();
}

function writePrivyAuthBootstrapLock(lock: PrivyAuthBootstrapLock | null): void {
  if (typeof window === "undefined") {
    return;
  }

  try {
    if (!lock) {
      window.localStorage.removeItem(PRIVY_BOOTSTRAP_LOCK_STORAGE_KEY);
      return;
    }

    window.localStorage.setItem(PRIVY_BOOTSTRAP_LOCK_STORAGE_KEY, JSON.stringify(lock));
  } catch {
    // ignore storage errors
  }
}

function readPrivyAuthBootstrapLock(referenceTime = Date.now()): PrivyAuthBootstrapLock | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const raw = window.localStorage.getItem(PRIVY_BOOTSTRAP_LOCK_STORAGE_KEY);
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw) as Partial<PrivyAuthBootstrapLock>;
    if (
      typeof parsed.ownerTabId !== "string" ||
      parsed.ownerTabId.trim().length === 0 ||
      typeof parsed.acquiredAt !== "number" ||
      !Number.isFinite(parsed.acquiredAt) ||
      typeof parsed.expiresAt !== "number" ||
      !Number.isFinite(parsed.expiresAt)
    ) {
      writePrivyAuthBootstrapLock(null);
      return null;
    }

    if (parsed.expiresAt <= referenceTime) {
      writePrivyAuthBootstrapLock(null);
      return null;
    }

    return {
      ownerTabId: parsed.ownerTabId,
      userId: typeof parsed.userId === "string" && parsed.userId.length > 0 ? parsed.userId : null,
      acquiredAt: parsed.acquiredAt,
      expiresAt: parsed.expiresAt,
    };
  } catch {
    writePrivyAuthBootstrapLock(null);
    return null;
  }
}

function acquirePrivyAuthBootstrapLock(
  userId: string | null,
  referenceTime = Date.now()
): { acquired: true; ownerTabId: string } | { acquired: false; ownerTabId: string; lock: PrivyAuthBootstrapLock } {
  const ownerTabId = getPrivyBootstrapTabId();
  const existingLock = readPrivyAuthBootstrapLock(referenceTime);

  if (existingLock && existingLock.ownerTabId !== ownerTabId) {
    return {
      acquired: false,
      ownerTabId,
      lock: existingLock,
    };
  }

  writePrivyAuthBootstrapLock({
    ownerTabId,
    userId,
    acquiredAt: referenceTime,
    expiresAt: referenceTime + PRIVY_BOOTSTRAP_LOCK_TTL_MS,
  });

  return {
    acquired: true,
    ownerTabId,
  };
}

function releasePrivyAuthBootstrapLock(ownerTabId: string): void {
  const existingLock = readPrivyAuthBootstrapLock();
  if (!existingLock || existingLock.ownerTabId !== ownerTabId) {
    return;
  }

  writePrivyAuthBootstrapLock(null);
}

export function setPrivyAuthBootstrapState(
  state: PrivyAuthBootstrapState,
  params: {
    owner?: PrivyAuthBootstrapOwner;
    mode?: PrivyAuthBootstrapMode;
    userId?: string | null;
    detail?: string | null;
    debugCode?: string | null;
    backendSyncStarted?: boolean;
    attempt?: number;
    totalAttempts?: number;
    retryScheduled?: boolean;
    retryDelayMs?: number | null;
    cooldownUntilMs?: number | null;
  } = {}
): void {
  const previousSnapshot = inMemoryPrivyBootstrapSnapshot;
  const validatedUser = readCachedAuthUserSnapshot();
  const hasAuthoritativeBackendSession =
    Boolean(validatedUser?.id) && hasValidatedAuthSession();
  const isDowngradingAuthoritativeSession =
    hasAuthoritativeBackendSession &&
    state !== "authenticated" &&
    state !== "logout_in_progress";

  if (isDowngradingAuthoritativeSession) {
    console.info("[AuthFlow] ignoring bootstrap downgrade because backend session is already validated", {
      previousState: previousSnapshot?.state ?? null,
      nextState: state,
      nextOwner: params.owner ?? "system",
      nextMode: params.mode ?? "system",
      nextUserId: params.userId ?? null,
      validatedUserId: validatedUser?.id ?? null,
      debugCode: params.debugCode ?? null,
    });
    return;
  }

  const snapshot: PrivyAuthBootstrapSnapshot = {
    state,
    owner: params.owner ?? "system",
    mode: params.mode ?? "system",
    tabId: getPrivyBootstrapTabId(),
    userId: params.userId ?? null,
    detail: params.detail?.trim() || null,
    debugCode: params.debugCode?.trim() || null,
    backendSyncStarted: params.backendSyncStarted ?? false,
    attempt: params.attempt ?? 0,
    totalAttempts: params.totalAttempts ?? params.attempt ?? 0,
    retryScheduled: params.retryScheduled ?? false,
    retryDelayMs: params.retryDelayMs ?? null,
    cooldownUntilMs: params.cooldownUntilMs ?? null,
    recordedAt: Date.now(),
  };

  if (
    previousSnapshot?.state === "authenticated" &&
    snapshot.state !== "authenticated" &&
    previousSnapshot.tabId === snapshot.tabId
  ) {
    console.warn("[AuthFlow] authenticated state overwritten by pending bootstrap", {
      previousState: previousSnapshot.state,
      nextState: snapshot.state,
      previousOwner: previousSnapshot.owner,
      nextOwner: snapshot.owner,
      previousMode: previousSnapshot.mode,
      nextMode: snapshot.mode,
      tabId: snapshot.tabId,
      previousUserId: previousSnapshot.userId,
      nextUserId: snapshot.userId,
      detail: snapshot.detail,
      debugCode: snapshot.debugCode,
      backendSyncStarted: snapshot.backendSyncStarted,
    });
  }

  console.info("[AuthFlow] transition", snapshot);
  writePrivyBootstrapSnapshot(snapshot);
}

export function clearPrivyAuthBootstrapState(): void {
  writePrivyBootstrapSnapshot(null);
}

export function setPrivyAuthAnonymousState(
  owner: PrivyAuthBootstrapOwner = "system"
): void {
  console.info("[AuthFlow] applying anonymous bootstrap state", {
    owner,
    previousSnapshot: readPrivyAuthBootstrapSnapshot(),
  });
  setPrivyAuthBootstrapState("anonymous", {
    owner,
    mode: "system",
    detail: "no active Privy session",
  });
}

export function isPrivyAuthBootstrapStatePending(
  state: PrivyAuthBootstrapState | null | undefined
): boolean {
  return (
    state === "privy_pending" ||
    state === "awaiting_identity_token" ||
    state === "awaiting_identity_verification_finalization" ||
    state === "cooldown" ||
    state === "syncing_backend"
  );
}

function canResumePrivyAuthBootstrapPendingState(
  snapshot: PrivyAuthBootstrapSnapshot | null | undefined,
  owner: PrivyAuthBootstrapOwner,
  userId: string,
  hookIdentityTokenPresent = false
): boolean {
  if (!snapshot || !isPrivyAuthBootstrapStatePending(snapshot.state)) {
    return false;
  }

  if (!doesPrivyAuthBootstrapSnapshotBelongToCurrentTab(snapshot)) {
    return false;
  }

  return (
    snapshot.owner === owner &&
    snapshot.userId === userId &&
    (snapshot.debugCode === "awaiting_privy_sdk_ready" ||
      snapshot.debugCode === "awaiting_privy_identity_token_hook" ||
      (hookIdentityTokenPresent &&
        snapshot.debugCode === "awaiting_privy_identity_verification_finalization"))
  );
}

export function isPrivyAuthBootstrapStateBlockingApiMe(
  state: PrivyAuthBootstrapState | null | undefined
): boolean {
  return state === "failed_rate_limited" || isPrivyAuthBootstrapStatePending(state);
}

export function getPrivyAuthBootstrapCooldownRemainingMs(
  snapshot: PrivyAuthBootstrapSnapshot | null | undefined,
  referenceTime = Date.now()
): number {
  if (!snapshot?.cooldownUntilMs) {
    return 0;
  }
  return Math.max(0, snapshot.cooldownUntilMs - referenceTime);
}

export function isPrivyAuthBootstrapCooldownActive(
  snapshot: PrivyAuthBootstrapSnapshot | null | undefined,
  referenceTime = Date.now()
): boolean {
  return getPrivyAuthBootstrapCooldownRemainingMs(snapshot, referenceTime) > 0;
}

export function isPrivyAuthBootstrapPending(referenceTime = Date.now()): boolean {
  const snapshot = readPrivyAuthBootstrapSnapshot();
  if (!snapshot) {
    return false;
  }
  if (referenceTime - snapshot.recordedAt > PRIVY_BOOTSTRAP_STATE_TTL_MS) {
    return false;
  }
  if (!doesPrivyAuthBootstrapSnapshotBelongToCurrentTab(snapshot)) {
    return false;
  }
  return isPrivyAuthBootstrapStateBlockingApiMe(snapshot.state);
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

export function usePrivyAuthBootstrapSnapshot(): PrivyAuthBootstrapSnapshot | null {
  const [snapshot, setSnapshot] = useState<PrivyAuthBootstrapSnapshot | null>(() =>
    readPrivyAuthBootstrapSnapshot()
  );

  useEffect(() => {
    if (typeof window === "undefined") return;

    const refreshSnapshot = () => {
      setSnapshot(readPrivyAuthBootstrapSnapshot());
    };

    const handleStorage = (event: StorageEvent) => {
      if (event.key && event.key !== PRIVY_BOOTSTRAP_STATE_STORAGE_KEY) {
        return;
      }
      refreshSnapshot();
    };

    window.addEventListener(AUTH_PRIVY_BOOTSTRAP_EVENT, refreshSnapshot as EventListener);
    window.addEventListener("storage", handleStorage);
    return () => {
      window.removeEventListener(AUTH_PRIVY_BOOTSTRAP_EVENT, refreshSnapshot as EventListener);
      window.removeEventListener("storage", handleStorage);
    };
  }, []);

  return snapshot;
}

function getResolvedAuthUser(contextUser: AuthUser | null): AuthUser | null {
  return contextUser ?? readCachedAuthUserSnapshot();
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

function markValidatedAuthSession(user: AuthUser): AuthUser {
  sessionRateLimitedUntil = 0;
  unauthorizedSessionFailures = 0;
  lastSuccessfulSessionAt = Date.now();
  lastBootstrappedSessionAt = 0;
  writeCachedAuthUser(user);
  clearPrivySyncFailureSnapshot();
  const snapshot = readPrivyAuthBootstrapSnapshot();
  if (
    snapshot?.state !== "authenticated" ||
    snapshot.userId !== user.id ||
    snapshot.owner !== "system" ||
    snapshot.debugCode !== "backend_session_confirmed"
  ) {
    setPrivyAuthBootstrapState("authenticated", {
      owner: "system",
      mode: "system",
      userId: user.id,
      detail: "backend session confirmed",
      debugCode: "backend_session_confirmed",
    });
  }
  return user;
}

function markBootstrappedAuthSession(user: AuthUser): AuthUser {
  sessionRateLimitedUntil = 0;
  unauthorizedSessionFailures = 0;
  lastBootstrappedSessionAt = Date.now();
  writeCachedAuthUser(user);
  clearPrivySyncFailureSnapshot();
  return user;
}

function getPrivyBootstrapErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message.trim();
  }
  if (typeof error === "string" && error.trim().length > 0) {
    return error.trim();
  }
  return "Failed to finish sign-in";
}

async function waitForPendingPrivyIdentityToken(
  pendingPromise: Promise<string | undefined>,
  timeoutMs: number
): Promise<string | undefined> {
  return await Promise.race<string | undefined>([
    pendingPromise,
    new Promise<string | undefined>((resolve) => {
      window.setTimeout(() => resolve(undefined), timeoutMs);
    }),
  ]);
}

function normalizePrivyIdentityTokenCandidate(
  token: string | null | undefined
): string | undefined {
  return typeof token === "string" && token.trim().length > 0 ? token.trim() : undefined;
}

async function resolvePrivyAccessTokenCandidate(
  initialToken: string | null | undefined,
  getLatestPrivyAccessToken:
    | (() => Promise<string | null | undefined> | string | null | undefined)
    | undefined,
  metadata: {
    owner: PrivyAuthBootstrapOwner;
    mode: PrivyAuthBootstrapMode;
    userId: string;
    attemptId: string;
    attempt: number;
    totalAttempts: number;
  }
): Promise<string | undefined> {
  const normalizedInitialToken =
    typeof initialToken === "string" && initialToken.trim().length > 0
      ? initialToken.trim()
      : undefined;
  if (normalizedInitialToken) {
    return normalizedInitialToken;
  }

  if (!getLatestPrivyAccessToken) {
    return undefined;
  }

  try {
    const candidate = await getLatestPrivyAccessToken();
    const normalizedCandidate =
      typeof candidate === "string" && candidate.trim().length > 0 ? candidate.trim() : undefined;
    console.info("[AuthFlow] Privy access token resolution completed", {
      owner: metadata.owner,
      mode: metadata.mode,
      userId: metadata.userId,
      attemptId: metadata.attemptId,
      attempt: metadata.attempt,
      totalAttempts: metadata.totalAttempts,
      hasAccessToken: Boolean(normalizedCandidate),
    });
    return normalizedCandidate;
  } catch (error) {
    console.warn("[AuthFlow] Privy access token resolution failed", {
      owner: metadata.owner,
      mode: metadata.mode,
      userId: metadata.userId,
      attemptId: metadata.attemptId,
      attempt: metadata.attempt,
      totalAttempts: metadata.totalAttempts,
      message: error instanceof Error ? error.message : String(error),
    });
    return undefined;
  }
}

async function waitForLatestPrivyIdentityToken(options: {
  getLatestPrivyIdentityToken?: () => string | null | undefined;
  initialToken?: string | null | undefined;
  timeoutMs: number;
  isTerminal?: () => boolean;
}): Promise<string | undefined> {
  const startedAt = Date.now();
  let latestToken = normalizePrivyIdentityTokenCandidate(
    options.getLatestPrivyIdentityToken?.() ?? options.initialToken
  );
  if (latestToken) {
    return latestToken;
  }

  while (Date.now() - startedAt < options.timeoutMs) {
    if (options.isTerminal?.() === true) {
      return undefined;
    }

    const remainingMs = options.timeoutMs - (Date.now() - startedAt);
    const waitCompleted = await waitForAuthDelay(
      Math.min(PRIVY_IDENTITY_TOKEN_HOOK_POLL_INTERVAL_MS, remainingMs)
    );
    if (!waitCompleted) {
      return undefined;
    }

    latestToken = normalizePrivyIdentityTokenCandidate(
      options.getLatestPrivyIdentityToken?.() ?? options.initialToken
    );
    if (latestToken) {
      return latestToken;
    }
  }

  return normalizePrivyIdentityTokenCandidate(
    options.getLatestPrivyIdentityToken?.() ?? options.initialToken
  );
}

function isPrivyFinalizationPendingMessage(message: string): boolean {
  return /finalizing|identity verification|identity token/i.test(message);
}

function isPrivyRateLimitedMessage(message: string): boolean {
  return /429|too many requests|rate limit/i.test(message);
}

function cancelPendingPrivyAuthRetryTimers(reason: string): void {
  if (privyAuthRetryWaiters.size > 0) {
    const waiters = Array.from(privyAuthRetryWaiters.entries());
    privyAuthRetryWaiters.clear();
    for (const [timeoutId, resolve] of waiters) {
      window.clearTimeout(timeoutId);
      resolve(false);
    }
    console.info("[AuthFlow] cancelled pending controller retry timers", {
      reason,
      count: waiters.length,
    });
  }

  cancelPrivyIdentityRetryTimers(reason);
}

function waitForAuthDelay(delayMs: number): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const timeoutId = window.setTimeout(() => {
      privyAuthRetryWaiters.delete(timeoutId);
      resolve(true);
    }, delayMs);
    privyAuthRetryWaiters.set(timeoutId, resolve);
  });
}

function createPrivyBootstrapAttemptId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `privy_attempt_${Math.random().toString(36).slice(2, 12)}_${Date.now().toString(36)}`;
}

export async function startPrivyAuthBootstrap({
  owner,
  mode = "system",
  user,
  getLatestUser,
  privyReady,
  privyAuthenticated,
  privyIdentityToken,
  getLatestPrivyIdentityToken,
  refreshPrivyAuthState,
  privyAccessToken,
  getLatestPrivyAccessToken,
  tryExistingBackendSession = false,
  triggerSource = "system",
}: StartPrivyAuthBootstrapOptions): Promise<AuthUser | null> {
  const now = Date.now();
  const existingSnapshot = readPrivyAuthBootstrapSnapshot();
  const sameUserSnapshot = existingSnapshot?.userId === user.id ? existingSnapshot : null;
  const currentState = sameUserSnapshot?.state ?? existingSnapshot?.state ?? "idle";
  const hasHookIdentityToken = Boolean(
    normalizePrivyIdentityTokenCandidate(
      getLatestPrivyIdentityToken?.() ?? privyIdentityToken
    )
  );
  const delegatedAuthenticatedSdkState =
    owner === "AuthInitializer" &&
    triggerSource === "component_mount" &&
    privyReady === true &&
    privyAuthenticated === true;
  const hardCooldownRemainingMs = Math.max(
    getPrivyIdentityRateLimitRemainingMs(now),
    getPrivyAuthBootstrapCooldownRemainingMs(sameUserSnapshot, now)
  );

  console.info("[AuthFlow] bootstrap request received", {
    owner,
    mode,
    userId: user.id,
    alreadyInProgress: Boolean(privyAuthBootstrapInFlight),
      currentState,
      privyReady: privyReady ?? null,
      privyAuthenticated: privyAuthenticated ?? null,
      hookIdentityTokenPresent: hasHookIdentityToken,
    });

  if (delegatedAuthenticatedSdkState) {
    console.info("[AuthFlow] controller received delegated bootstrap from AuthInitializer", {
      owner,
      mode,
      userId: user.id,
      currentState,
      hasExistingSnapshot: Boolean(existingSnapshot),
      sameUserSnapshotState: sameUserSnapshot?.state ?? null,
      hookIdentityTokenPresent:
        typeof privyIdentityToken === "string" && privyIdentityToken.trim().length > 0,
    });
  }

  if (privyAuthBootstrapInFlight) {
    if (delegatedAuthenticatedSdkState) {
      console.info("[AuthFlow] delegated authenticated SDK state ignored because controller is already in progress", {
        owner,
        mode,
        userId: user.id,
        currentState,
      });
    }
    console.info("[AuthFlow] bootstrap reusing active controller", {
      owner,
      mode,
      userId: user.id,
      totalAttempts: sameUserSnapshot?.totalAttempts ?? 0,
    });
    return privyAuthBootstrapInFlight;
  }

  if (
    sameUserSnapshot &&
    isPrivyAuthBootstrapStatePending(sameUserSnapshot.state) &&
    !canResumePrivyAuthBootstrapPendingState(
      sameUserSnapshot,
      owner,
      user.id,
      hasHookIdentityToken
    )
  ) {
    if (delegatedAuthenticatedSdkState) {
      console.info("[AuthFlow] delegated authenticated SDK state ignored because pending state still owns the handoff", {
        owner,
        mode,
        userId: user.id,
        currentState: sameUserSnapshot.state,
        debugCode: sameUserSnapshot.debugCode,
      });
    }
    console.info("[AuthFlow] bootstrap blocked by shared pending state", {
      owner,
      mode,
      userId: user.id,
      currentState: sameUserSnapshot.state,
      retryAlreadyScheduled: sameUserSnapshot.retryScheduled,
    });
    return null;
  }

  if (
    canResumePrivyAuthBootstrapPendingState(
      sameUserSnapshot,
      owner,
      user.id,
      hasHookIdentityToken
    )
  ) {
    if (delegatedAuthenticatedSdkState) {
      console.info("[AuthFlow] delegated authenticated SDK state accepted; resuming token handoff", {
        owner,
        mode,
        userId: user.id,
        currentState: sameUserSnapshot?.state,
        debugCode: sameUserSnapshot?.debugCode,
      });
    }
    console.info("[AuthFlow] bootstrap resuming from deferred pending state", {
      owner,
      mode,
      userId: user.id,
      currentState: sameUserSnapshot?.state,
      debugCode: sameUserSnapshot?.debugCode,
    });
  }

  if (hardCooldownRemainingMs > 0) {
    if (delegatedAuthenticatedSdkState) {
      console.info("[AuthFlow] delegated authenticated SDK state ignored because cooldown is active", {
        owner,
        mode,
        userId: user.id,
        currentState,
        retryInMs: hardCooldownRemainingMs,
      });
    }
    console.info("[AuthFlow] bootstrap blocked by cooldown", {
      owner,
      mode,
      userId: user.id,
      retryAlreadyScheduled: false,
      cooldownBlocked: true,
      retryInMs: hardCooldownRemainingMs,
      state: sameUserSnapshot?.state ?? existingSnapshot?.state ?? "idle",
    });
    writePrivySyncFailureSnapshot(PRIVY_RATE_LIMIT_FAILURE_MESSAGE);
    return null;
  }

  if (sameUserSnapshot?.state === "failed_rate_limited" && mode !== "manual") {
    if (delegatedAuthenticatedSdkState) {
      console.info("[AuthFlow] delegated authenticated SDK state ignored until explicit manual retry", {
        owner,
        mode,
        userId: user.id,
        currentState: sameUserSnapshot.state,
      });
    }
    console.info("[AuthFlow] bootstrap blocked until explicit manual retry", {
      owner,
      mode,
      userId: user.id,
      retryAlreadyScheduled: false,
      cooldownBlocked: false,
    });
    writePrivySyncFailureSnapshot(PRIVY_RATE_LIMIT_FAILURE_MESSAGE);
    return null;
  }

  const lockAttempt = acquirePrivyAuthBootstrapLock(user.id, now);
  if (!lockAttempt.acquired) {
    if (delegatedAuthenticatedSdkState) {
      console.info("[AuthFlow] delegated authenticated SDK state ignored because another tab owns the bootstrap lock", {
        owner,
        mode,
        userId: user.id,
        currentState,
        lockOwnerTabId: lockAttempt.lock.ownerTabId,
      });
    }
    console.info("[AuthFlow] bootstrap blocked by active browser tab", {
      owner,
      mode,
      userId: user.id,
      currentState,
      lockOwnerTabId: lockAttempt.lock.ownerTabId,
      lockUserId: lockAttempt.lock.userId,
      lockExpiresInMs: Math.max(0, lockAttempt.lock.expiresAt - now),
    });
    return null;
  }

  privyAuthBootstrapInFlight = (async () => {
    const attemptState = {
      rateLimited: false,
      cancelled: false,
    };
    const privyBootstrapAttemptId = createPrivyBootstrapAttemptId();
    let backendSyncStartedForAttempt = false;
    let attempt = 0;
    let totalAttempts = sameUserSnapshot?.totalAttempts ?? 0;
    let finalizationStartedAt: number | null = null;

    try {
      const shouldCheckExistingBackendSession =
        tryExistingBackendSession && hasRecoverableBackendSessionHint();
      if (tryExistingBackendSession && !shouldCheckExistingBackendSession) {
        console.info("[AuthFlow] bootstrap skipping existing backend session check without local session hints", {
          owner,
          mode,
          userId: user.id,
        });
      }

      if (shouldCheckExistingBackendSession) {
        console.info("[AuthFlow] bootstrap checking existing backend session before Privy sync", {
          owner,
          mode,
          userId: user.id,
        });
        const recoveredUser = await ensureBackendSessionReady(user.id, 1800).catch((error) => {
          console.warn("[AuthFlow] existing backend session check failed", {
            owner,
            mode,
            userId: user.id,
            message: error instanceof Error ? error.message : String(error),
          });
          return null;
        });
        if (recoveredUser) {
          setPrivyAuthBootstrapState("authenticated", {
            owner,
            mode,
            userId: recoveredUser.id,
            detail: "existing backend session recovered",
            debugCode: "existing_backend_session_recovered",
            totalAttempts,
          });
          return recoveredUser;
        }
      }

      while (attempt < PRIVY_BOOTSTRAP_MAX_ATTEMPTS) {
        attempt += 1;
        totalAttempts += 1;
        setPrivyAuthBootstrapState("awaiting_identity_token", {
          owner,
          mode,
          userId: user.id,
          detail: "resolving Privy identity token",
          debugCode: "awaiting_privy_identity_token",
          attempt,
          totalAttempts,
        });
        console.info("[AuthFlow] bootstrap attempt started", {
          owner,
          mode,
          triggerSource,
          userId: user.id,
          attemptId: privyBootstrapAttemptId,
          attempt,
          totalAttempts,
          retryAlreadyScheduled: false,
        });

        try {
          if (
            privyReady === true &&
            privyAuthenticated === true &&
            !(typeof privyIdentityToken === "string" && privyIdentityToken.trim().length > 0)
          ) {
            console.info("[AuthFlow] SDK authenticated; actively requesting identity token for backend sync", {
              owner,
              mode,
              userId: user.id,
              attemptId: privyBootstrapAttemptId,
              attempt,
              totalAttempts,
            });
          }

          const privyIdentityDebugContext: PrivyIdentityDebugContext = {
            attemptId: privyBootstrapAttemptId,
            owner,
            mode,
            trigger: triggerSource,
            userId: user.id,
            bootstrapAttempt: attempt,
            totalAttempts,
            initialCaller:
              triggerSource === "component_mount"
                ? "component_mount"
                : triggerSource === "manual_user_action"
                  ? "usePrivyLogin"
                  : owner,
          };
          const resolvedPayload = await requestPrivyIdentityTokenForBackendSync({
            user,
            getLatestUser,
            privyReady,
            privyAuthenticated,
            privyIdToken: privyIdentityToken,
            getLatestPrivyIdToken: getLatestPrivyIdentityToken,
            refreshPrivyAuthState,
            isTerminal: () => attemptState.rateLimited || attemptState.cancelled,
            debugContext: privyIdentityDebugContext,
            pendingTokenWaitMs: PRIVY_PENDING_IDENTITY_TOKEN_WAIT_MS,
          });

          if (!resolvedPayload.privyIdToken) {
            if (resolvedPayload.pendingPrivyIdTokenPromise) {
              console.info("[AuthFlow] backend sync skipped: token promise pending", {
                owner,
                mode,
                userId: resolvedPayload.user.id,
                attemptId: privyBootstrapAttemptId,
                attempt,
                totalAttempts,
                tokenResolution: resolvedPayload.tokenResolution ?? "pending",
              });
              const awaitedToken = await waitForPendingPrivyIdentityToken(
                resolvedPayload.pendingPrivyIdTokenPromise,
                PRIVY_PENDING_IDENTITY_TOKEN_WAIT_MS
              );
              if (awaitedToken) {
                resolvedPayload.privyIdToken = awaitedToken;
                resolvedPayload.tokenResolution = "available";
                console.info("[AuthFlow] backend sync resumed: delayed identity token became available", {
                  owner,
                  mode,
                  userId: resolvedPayload.user.id,
                  attemptId: privyBootstrapAttemptId,
                  attempt,
                  totalAttempts,
                });
              } else {
                console.warn("[AuthFlow] backend sync skipped: token promise pending", {
                  owner,
                  mode,
                  userId: resolvedPayload.user.id,
                  attemptId: privyBootstrapAttemptId,
                  attempt,
                  totalAttempts,
                  waitMs: PRIVY_PENDING_IDENTITY_TOKEN_WAIT_MS,
                  tokenResolution: resolvedPayload.tokenResolution ?? "pending",
                });
              }
            }
          }

          if (!resolvedPayload.privyIdToken) {
            const skipReason =
              resolvedPayload.tokenResolution === "pending"
                ? "token promise pending"
                : resolvedPayload.tokenLocalCheck?.tokenInvalid ||
                    resolvedPayload.tokenLocalCheck?.tokenExpired
                  ? "token validation failed"
                  : "no identity token";
            console.warn(`[AuthFlow] backend sync skipped: ${skipReason}`, {
              owner,
              mode,
              userId: resolvedPayload.user.id,
              attemptId: privyBootstrapAttemptId,
              attempt,
              totalAttempts,
              tokenResolution: resolvedPayload.tokenResolution ?? "empty",
              tokenLocalCheck: resolvedPayload.tokenLocalCheck ?? null,
            });
            if (privyReady === true && privyAuthenticated === true) {
              console.warn("[AuthFlow] identity token unavailable after authenticated SDK state", {
                owner,
                mode,
                userId: resolvedPayload.user.id,
                attemptId: privyBootstrapAttemptId,
                attempt,
                totalAttempts,
                tokenResolution: resolvedPayload.tokenResolution ?? "empty",
                tokenLocalCheck: resolvedPayload.tokenLocalCheck ?? null,
              });
            }

            if (privyReady === true && privyAuthenticated === true) {
              const resolvedPrivyAccessToken = await resolvePrivyAccessTokenCandidate(
                privyAccessToken,
                getLatestPrivyAccessToken,
                {
                  owner,
                  mode,
                  userId: resolvedPayload.user.id,
                  attemptId: privyBootstrapAttemptId,
                  attempt,
                  totalAttempts,
                }
              );
              console.info(
                "[AuthFlow] attempting /api/auth/privy-sync using Privy access-token fallback",
                {
                  owner,
                  mode,
                  userId: resolvedPayload.user.id,
                  attemptId: privyBootstrapAttemptId,
                  attempt,
                  totalAttempts,
                  skipReason,
                  hasPrivyAccessToken: Boolean(resolvedPrivyAccessToken),
                }
              );

              try {
                const syncResult = await syncPrivySession(
                  resolvedPayload.user.id,
                  resolvedPayload.email,
                  resolvedPayload.name,
                  undefined,
                  {
                    allowMissingIdentityToken: true,
                    privyAuthToken: resolvedPrivyAccessToken,
                  }
                );

                setPrivyAuthBootstrapState("authenticated", {
                  owner,
                  mode,
                  userId: syncResult.user.id,
                  detail: "backend session synced from Privy access-token fallback",
                  debugCode: "backend_session_synced_privy_access_token",
                  backendSyncStarted: true,
                  attempt,
                  totalAttempts,
                });
                return syncResult.user;
              } catch (serverVisibleSyncError) {
                console.warn(
                  "[AuthFlow] Privy access-token fallback sync failed while identity token was unavailable",
                  {
                    owner,
                    mode,
                    userId: resolvedPayload.user.id,
                    attemptId: privyBootstrapAttemptId,
                    attempt,
                    totalAttempts,
                    hasPrivyAccessToken: Boolean(resolvedPrivyAccessToken),
                    message:
                      serverVisibleSyncError instanceof Error
                        ? serverVisibleSyncError.message
                        : String(serverVisibleSyncError),
                  }
                );
              }
            }

            throw new Error("Privy identity verification is still finalizing");
          }

          console.info("[AuthFlow] identity token acquired; starting /api/auth/privy-sync", {
            owner,
            mode,
            userId: resolvedPayload.user.id,
            attemptId: privyBootstrapAttemptId,
            attempt,
            totalAttempts,
            tokenLength: resolvedPayload.privyIdToken.length,
          });

          setPrivyAuthBootstrapState("syncing_backend", {
            owner,
            mode,
            userId: resolvedPayload.user.id,
            detail: "syncing backend session",
            debugCode: "backend_sync_started",
            backendSyncStarted: true,
            attempt,
            totalAttempts,
          });
          backendSyncStartedForAttempt = true;

          console.info("[AuthFlow] backend sync started", {
            owner,
            mode,
            userId: resolvedPayload.user.id,
            attempt,
            totalAttempts,
          });

          const syncResult = await syncPrivySession(
            resolvedPayload.user.id,
            resolvedPayload.email,
            resolvedPayload.name,
            resolvedPayload.privyIdToken
          );

          setPrivyAuthBootstrapState("authenticated", {
            owner,
            mode,
            userId: syncResult.user.id,
            detail: "backend session synced",
            debugCode: "backend_session_synced",
            backendSyncStarted: true,
            attempt,
            totalAttempts,
          });
          return syncResult.user;
        } catch (error) {
          const message = getPrivyBootstrapErrorMessage(error);
          const rateLimited = isPrivyRateLimitedMessage(message);
          const finalizing = isPrivyFinalizationPendingMessage(message);

          if (rateLimited) {
            attemptState.rateLimited = true;
            const retryInMs = Math.max(
              getPrivyIdentityRateLimitRemainingMs(),
              PRIVY_BOOTSTRAP_FINALIZATION_RETRY_DELAY_MS
            );
            const backendSyncStarted = backendSyncStartedForAttempt;
            const debugCode = backendSyncStarted
              ? "privy_rate_limited_after_backend_sync_start"
              : "privy_rate_limited_before_backend_sync";
            const detail = backendSyncStarted
              ? PRIVY_RATE_LIMIT_FAILURE_MESSAGE
              : "Sign-in could not start because Privy is temporarily rate limiting this browser/session. Please wait 10-15 seconds and try again, or use a fresh private window.";
            cancelPendingPrivyAuthRetryTimers("privy_429");
            writePrivySyncFailureSnapshot(detail);
            if (!backendSyncStarted) {
              console.warn("[AuthFlow] backend sync did not start before Privy rate limit", {
                owner,
                mode,
                userId: user.id,
                attempt,
                totalAttempts,
                debugCode,
              });
            }
            setPrivyAuthBootstrapState("failed_rate_limited", {
              owner,
              mode,
              userId: user.id,
              attempt,
              totalAttempts,
              detail,
              debugCode,
              backendSyncStarted,
              cooldownUntilMs: Date.now() + retryInMs,
            });
            console.warn("[AuthFlow] bootstrap halted after Privy 429", {
              owner,
              mode,
              userId: user.id,
              attempt,
              totalAttempts,
              privy429: true,
              retryScheduled: false,
              retryInMs,
            });
            return null;
          }

          if (finalizing) {
            if (attemptState.rateLimited || getPrivyIdentityRateLimitRemainingMs() > 0) {
              console.info("[AuthFlow] finalizing retry suppressed due to privy_429", {
                owner,
                mode,
                userId: user.id,
                attempt,
                totalAttempts,
              });
              return null;
            }

            if (finalizationStartedAt === null) {
              finalizationStartedAt = Date.now();
            }

            const elapsedFinalizationMs = Date.now() - finalizationStartedAt;
            const remainingFinalizationMs = Math.max(
              0,
              PRIVY_BOOTSTRAP_FINALIZATION_TIMEOUT_MS - elapsedFinalizationMs
            );
            const finalizationWaitMs = Math.min(
              PRIVY_BOOTSTRAP_FINALIZATION_RETRY_DELAY_MS,
              remainingFinalizationMs
            );

            if (finalizationWaitMs > 0) {
              clearPrivySyncFailureSnapshot();
              setPrivyAuthBootstrapState("awaiting_identity_verification_finalization", {
                owner,
                mode,
                userId: user.id,
                detail: "Privy is still finalizing identity verification for backend sign-in.",
                debugCode: "awaiting_privy_identity_verification_finalization",
                backendSyncStarted: false,
                attempt,
                totalAttempts,
                retryScheduled: false,
                retryDelayMs: finalizationWaitMs,
              });
              console.info(
                "[AuthFlow] identity verification still finalizing; entering bounded pending state",
                {
                  owner,
                  mode,
                  userId: user.id,
                  attemptId: privyBootstrapAttemptId,
                  attempt,
                  totalAttempts,
                  finalizationWaitMs,
                  elapsedFinalizationMs,
                  remainingFinalizationMs,
                }
              );
              const tokenAfterFinalizationWait = await waitForLatestPrivyIdentityToken({
                getLatestPrivyIdentityToken,
                initialToken: privyIdentityToken,
                timeoutMs: finalizationWaitMs,
                isTerminal: () => attemptState.rateLimited || attemptState.cancelled,
              });
              if (tokenAfterFinalizationWait) {
                privyIdentityToken = tokenAfterFinalizationWait;
                console.info("[AuthFlow] identity token acquired after finalization wait; retrying backend handoff", {
                  owner,
                  mode,
                  userId: user.id,
                  attemptId: privyBootstrapAttemptId,
                  attempt,
                  totalAttempts,
                  tokenLength: tokenAfterFinalizationWait.length,
                });
                continue;
              }
              console.warn("[AuthFlow] identity token unavailable after authenticated SDK state", {
                owner,
                mode,
                userId: user.id,
                attemptId: privyBootstrapAttemptId,
                attempt,
                totalAttempts,
                waitMs: finalizationWaitMs,
                reason: "finalization_token_unavailable",
              });
            }

            const detail =
              "Privy finished authenticating, but the identity token was not ready for backend sign-in. Please tap Sign in again.";
            writePrivySyncFailureSnapshot(detail);
            setPrivyAuthBootstrapState("failed", {
              owner,
              mode,
              userId: user.id,
              detail,
              debugCode: "privy_identity_token_unavailable",
              backendSyncStarted: false,
              attempt,
              totalAttempts,
            });
            console.warn("[AuthFlow] finalization timeout exceeded; failing auth", {
              owner,
              mode,
              userId: user.id,
              attemptId: privyBootstrapAttemptId,
              attempt,
              totalAttempts,
              reason: message,
              elapsedFinalizationMs,
              timeoutMs: PRIVY_BOOTSTRAP_FINALIZATION_TIMEOUT_MS,
            });
            return null;
          }

          writePrivySyncFailureSnapshot(message);
          setPrivyAuthBootstrapState("failed", {
            owner,
            mode,
            userId: user.id,
            detail: message,
            attempt,
            totalAttempts,
          });
          console.warn("[AuthFlow] bootstrap failed", {
            owner,
            mode,
            userId: user.id,
            attempt,
            totalAttempts,
            reason: message,
            retryScheduled: false,
          });
          return null;
        }
      }

      console.warn("[AuthFlow] finalization timeout exceeded; failing auth", {
        owner,
        mode,
        userId: user.id,
        attemptId: privyBootstrapAttemptId,
        attempt,
        totalAttempts,
        timeoutMs: PRIVY_BOOTSTRAP_FINALIZATION_TIMEOUT_MS,
      });
      writePrivySyncFailureSnapshot(
        "Privy finished authenticating, but the identity token was not ready for backend sign-in. Please tap Sign in again."
      );
      setPrivyAuthBootstrapState("failed", {
        owner,
        mode,
        userId: user.id,
        detail:
          "Privy finished authenticating, but the identity token was not ready for backend sign-in. Please tap Sign in again.",
        debugCode: "privy_identity_token_unavailable",
        attempt: PRIVY_BOOTSTRAP_MAX_ATTEMPTS,
        totalAttempts,
      });
      return null;
    } finally {
      attemptState.cancelled = true;
      releasePrivyAuthBootstrapLock(lockAttempt.ownerTabId);
    }
  })();

  try {
    return await privyAuthBootstrapInFlight;
  } finally {
    privyAuthBootstrapInFlight = null;
  }
}

type ServerSessionResult =
  | { status: "authenticated"; user: AuthUser }
  | { status: "unauthorized" }
  | { status: "rate_limited"; retryAfterMs: number }
  | { status: "empty" }
  | { status: "unavailable" };

async function fetchSessionFromServer(
  timeoutMs = SESSION_FETCH_TIMEOUT_MS,
  reason = "confirmation"
): Promise<ServerSessionResult> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    console.info("[AuthFlow] /api/me request started", {
      reason,
      timeoutMs,
      bootstrapPending: isPrivyAuthBootstrapPending(),
    });
    const response = await fetch(`${baseURL}/api/me`, {
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
      },
      signal: controller.signal,
    });
    console.info("[AuthColdStart] /api/me response received", {
      reason,
      status: response.status,
    });

    if (response.status === 401 || response.status === 403) {
      return { status: "unauthorized" };
    }

    if (response.status === 429) {
      const retryAfterHeader = response.headers.get("retry-after");
      const retryAfterSeconds = Number.parseInt(retryAfterHeader || "", 10);
      const retryAfterMs =
        Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0
          ? retryAfterSeconds * 1000
          : 1200;
      return { status: "rate_limited", retryAfterMs };
    }

    if (!response.ok) {
      return { status: "unavailable" };
    }

    const text = await response.text();
    if (!text || text === "null" || text === "undefined") {
      return { status: "empty" };
    }

    try {
      const data = JSON.parse(text) as { data?: unknown };
      const candidate = data?.data ?? data;
      if (
        typeof candidate === "object" &&
        candidate !== null &&
        "id" in candidate &&
        typeof (candidate as { id?: unknown }).id === "string"
      ) {
        return {
          status: "authenticated",
          user: toAuthUser(candidate as Partial<AuthUser> & {
            id: string;
            email?: string | null;
            name?: string | null;
          }),
        };
      }
      return { status: "empty" };
    } catch {
      return { status: "empty" };
    }
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      return { status: "unavailable" };
    }
    console.warn("[Auth] Failed to confirm server session:", error);
    return { status: "unavailable" };
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function ensureBackendSessionReady(
  expectedUserId?: string,
  timeoutMs = AUTH_SESSION_CONFIRMATION_TIMEOUT_MS
): Promise<AuthUser | null> {
  const deadline = Date.now() + timeoutMs;

  for (let attempt = 0; Date.now() < deadline; attempt += 1) {
    const remainingMs = Math.max(350, deadline - Date.now());
    const result = await fetchSessionFromServer(
      Math.min(SESSION_FETCH_TIMEOUT_MS, remainingMs),
      "sync_confirmation"
    );

    if (result.status === "authenticated") {
      if (!expectedUserId || result.user.id === expectedUserId) {
        return markValidatedAuthSession(result.user);
      }
    } else if (result.status === "unauthorized" && !hasRecentPrivySyncGrace()) {
      return null;
    }

    const delayMs =
      result.status === "rate_limited"
        ? Math.min(result.retryAfterMs, Math.max(200, deadline - Date.now()))
        : AUTH_SESSION_CONFIRMATION_RETRY_DELAYS_MS[
            Math.min(attempt, AUTH_SESSION_CONFIRMATION_RETRY_DELAYS_MS.length - 1)
          ];

    if (Date.now() + delayMs >= deadline) {
      break;
    }

    await new Promise<void>((resolve) => {
      window.setTimeout(resolve, delayMs);
    });
  }

  return null;
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

// Fetch session from backend using the server-issued HttpOnly session cookie.
async function fetchSession(): Promise<AuthUser | null> {
  const now = Date.now();
  const cachedUser = readCachedAuthUser();
  const pendingBootstrap = readPrivyAuthBootstrapSnapshot();
  const pendingBootstrapBelongsToCurrentTab =
    doesPrivyAuthBootstrapSnapshotBelongToCurrentTab(pendingBootstrap);

  if (pendingBootstrap && isPrivyAuthBootstrapPending(now)) {
    console.info("[AuthFlow] /api/me gated until Privy sync settles", {
      state: pendingBootstrap.state,
      owner: pendingBootstrap.owner,
      mode: pendingBootstrap.mode,
      tabId: pendingBootstrap.tabId,
      userId: pendingBootstrap.userId,
      detail: pendingBootstrap.detail,
      cachedUserPresent: Boolean(cachedUser),
    });
    return cachedUser;
  }

  console.info("[AuthColdStart] /api/me allowed to run", {
    cachedUserPresent: Boolean(cachedUser),
    pendingBootstrapState: pendingBootstrap?.state ?? null,
    pendingBootstrapOwner: pendingBootstrap?.owner ?? null,
    pendingBootstrapTabId: pendingBootstrap?.tabId ?? null,
    pendingBootstrapBelongsToCurrentTab,
    reason:
      pendingBootstrap == null
        ? "no_bootstrap_snapshot"
        : pendingBootstrapBelongsToCurrentTab
          ? "current_tab_bootstrap_not_blocking"
          : "foreign_tab_bootstrap_ignored",
  });

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
    console.info("[AuthFlow] /api/me request started", {
      hasCachedUser: Boolean(cachedUser),
      lastPrivySyncAt,
      lastSuccessfulSessionAt,
    });
    const response = await fetch(`${baseURL}/api/me`, {
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
      },
      signal: controller.signal,
    });
    console.info("[AuthColdStart] /api/me response received", {
      status: response.status,
      hasCachedUser: Boolean(cachedUser),
      requestStartedAt,
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
      // Clear local session hints after a confirmed unauthorized response.
      if (response.status === 401) {
        if (lastPrivySyncAt > requestStartedAt) {
          console.warn("[Auth] Ignoring stale 401 from /api/me after newer Privy sync");
          return cachedUser;
        }

        unauthorizedSessionFailures += 1;
        const recentlySynced = hasRecentPrivySyncGrace();
        const recentlyHealthySession =
          lastSuccessfulSessionAt > 0 &&
          Date.now() - lastSuccessfulSessionAt < AUTH_TRANSIENT_401_RECOVERY_MS;
        const hasSessionHint = Boolean(cachedUser) || hasSessionCookieHint() || recentlySynced;
        const shouldTreatAsTransient =
          recentlySynced ||
          (hasSessionHint && recentlyHealthySession);

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
            `[Auth] Temporary 401 from /api/me; preserving cached session hint (${unauthorizedSessionFailures})`
          );
          return cachedUser;
        }

        clearStoredAuthToken();
        clearCachedAuthUser();
        lastBootstrappedSessionAt = 0;
        lastSuccessfulSessionAt = 0;
        sessionRateLimitedUntil = Date.now() + 5000;
        return null;
      }
      return cachedUser;
    }

    sessionRateLimitedUntil = 0;
    unauthorizedSessionFailures = 0;
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
        return markValidatedAuthSession(toAuthUser(user));
      }

      const explicitNoSessionResponse =
        data === null ||
        (typeof data === "object" &&
          data !== null &&
          "data" in data &&
          (data as { data?: unknown }).data === null);

      if (explicitNoSessionResponse) {
        clearStoredAuthToken();
        clearCachedAuthUser();
        lastBootstrappedSessionAt = 0;
        lastSuccessfulSessionAt = 0;
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
    const hasConfirmedSession = cachedUser ? hasValidatedAuthSession() : false;
    return {
      user: cachedUser,
      isLoading: !cachedUser || !hasConfirmedSession,
      isAuthenticated: !!cachedUser,
    };
  });
  const coldStartLoggedRef = useRef(false);
  const coldStartSettledRef = useRef(false);

  const applyAuthProviderState = useCallback(
    (
      reason: string,
      nextState: SessionState,
      metadata: Record<string, unknown> = {}
    ) => {
      setState((previousState) => {
        if (previousState.user?.id && !nextState.user?.id && !nextState.isLoading) {
          console.warn("[AuthColdStart] authenticated auth provider state replaced", {
            reason,
            previousUserId: previousState.user.id,
            nextUserId: nextState.user?.id ?? null,
            previousIsLoading: previousState.isLoading,
            nextIsLoading: nextState.isLoading,
            previousIsAuthenticated: previousState.isAuthenticated,
            nextIsAuthenticated: nextState.isAuthenticated,
            ...metadata,
          });
        }

        console.info("[AuthColdStart] auth provider state applied", {
          reason,
          previousUserId: previousState.user?.id ?? null,
          nextUserId: nextState.user?.id ?? null,
          previousIsLoading: previousState.isLoading,
          nextIsLoading: nextState.isLoading,
          previousIsAuthenticated: previousState.isAuthenticated,
          nextIsAuthenticated: nextState.isAuthenticated,
          ...metadata,
        });

        return nextState;
      });
    },
    []
  );

  const resolveSessionWithRetry = useCallback(async () => {
    const optimisticCachedUser = readCachedAuthUser();
    const bootstrapSnapshot = readPrivyAuthBootstrapSnapshot();
    if (bootstrapSnapshot && isPrivyAuthBootstrapPending()) {
      console.info("[AuthFlow] /api/me retry skipped due to pending auth state", {
        state: bootstrapSnapshot.state,
        owner: bootstrapSnapshot.owner,
        mode: bootstrapSnapshot.mode,
        tabId: bootstrapSnapshot.tabId,
        userId: bootstrapSnapshot.userId,
      });
      return optimisticCachedUser;
    }

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

    const postFetchBootstrapSnapshot = readPrivyAuthBootstrapSnapshot();
    if (postFetchBootstrapSnapshot && isPrivyAuthBootstrapPending()) {
      console.info("[AuthFlow] /api/me retries suppressed while auth is pending", {
        state: postFetchBootstrapSnapshot.state,
        owner: postFetchBootstrapSnapshot.owner,
        mode: postFetchBootstrapSnapshot.mode,
        tabId: postFetchBootstrapSnapshot.tabId,
        userId: postFetchBootstrapSnapshot.userId,
      });
      return optimisticCachedUser;
    }

    // Fresh tabs can momentarily race cookie/session propagation right after sign-in.
    // Retry when we have session hints, or immediately after a Privy sync.
    const hasCookieSessionHint = hasSessionCookieHint();
    const recentlySynced = hasRecentPrivySyncGrace();
    const hasCachedSessionHint = Boolean(optimisticCachedUser);
    if (!hasCachedSessionHint && !hasCookieSessionHint && !recentlySynced) {
      return null;
    }

    const retryAttempts = AUTH_SESSION_RETRY_ATTEMPTS_WITH_COOKIE;
    const retryDelayMs = recentlySynced
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
      const user = (await resolveSessionWithRetry()) ?? readCachedAuthUserSnapshot();
      applyAuthProviderState("refetch", {
        user,
        isLoading: false,
        isAuthenticated: !!user,
      });
    } catch {
      const fallbackUser = readCachedAuthUserSnapshot();
      applyAuthProviderState("refetch_fallback", {
        user: fallbackUser,
        isLoading: false,
        isAuthenticated: !!fallbackUser,
      });
    }
  }, [applyAuthProviderState, resolveSessionWithRetry]);

  const logout = useCallback(async () => {
    console.info("[AuthFlow] logout started", {
      hasLiveSession: hasValidatedAuthSession(),
      bootstrapSnapshot: readPrivyAuthBootstrapSnapshot(),
    });
    for (const hook of preLogoutHooks) {
      try {
        await hook();
      } catch (error) {
        console.warn("[Auth] Pre-logout hook failed:", error);
      }
    }

    explicitLogoutAt = Date.now();
    setPrivyAuthBootstrapState("logout_in_progress", {
      owner: "system",
      mode: "system",
      detail: "signing out",
      debugCode: "logout_started",
    });
    cancelPendingPrivyAuthRetryTimers("logout");
    clearPrivyAuthBootstrapState();
    clearStoredAuthToken();
    clearCachedAuthUser();
    clearPrivySyncFailureSnapshot();
    cancelPrivyIdentityRetryTimers("logout");
    clearSessionCacheByPrefix("phew.");
    sessionRateLimitedUntil = 0;
    sessionFetchInFlight = null;
    privySyncInFlight = null;
    privyAuthBootstrapInFlight = null;
    lastPrivySyncAt = 0;
    lastSuccessfulSessionAt = 0;
    lastBootstrappedSessionAt = 0;
    unauthorizedSessionFailures = 0;
    applyAuthProviderState("logout", {
      user: null,
      isLoading: false,
      isAuthenticated: false,
    });
    setPrivyAuthAnonymousState("system");
    console.info("[AuthFlow] logout local auth state cleared", {
      bootstrapSnapshot: readPrivyAuthBootstrapSnapshot(),
    });

    try {
      await signOut();
      console.info("[AuthFlow] logout backend session cleared");
    } catch (error) {
      console.error("[Auth] Logout error:", error);
    }
  }, [applyAuthProviderState]);

  // Initial session check
  useEffect(() => {
    let mounted = true;

    const checkSession = async () => {
      const user = (await resolveSessionWithRetry()) ?? readCachedAuthUserSnapshot();
      if (mounted) {
        applyAuthProviderState("initial_check", {
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
  }, [applyAuthProviderState, resolveSessionWithRetry]);

  // Fast-path auth hydration after Privy sync without waiting for /api/me roundtrips.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const handleSessionSynced = (event: Event) => {
      const customEvent = event as CustomEvent<AuthSessionSyncEventDetail>;
      const syncedUser = customEvent.detail?.user;
      if (!syncedUser?.id) return;
      applyAuthProviderState("session_synced_event", {
        user: syncedUser,
        isLoading: false,
        isAuthenticated: true,
      });
    };
    window.addEventListener(AUTH_SESSION_SYNC_EVENT, handleSessionSynced as EventListener);
    return () => {
      window.removeEventListener(AUTH_SESSION_SYNC_EVENT, handleSessionSynced as EventListener);
    };
  }, [applyAuthProviderState]);

  useEffect(() => {
    if (coldStartLoggedRef.current || typeof window === "undefined") {
      return;
    }
    coldStartLoggedRef.current = true;
    const bootstrapSnapshot = readPrivyAuthBootstrapSnapshot();
    const cachedUser = readCachedAuthUser();
    console.info("[AuthColdStart] app mounted", {
      href: window.location.href,
      tabId: getPrivyBootstrapTabId(),
      cachedUserId: cachedUser?.id ?? null,
      cachedUserPresent: Boolean(cachedUser),
      bootstrapSnapshot,
    });
  }, []);

  useEffect(() => {
    if (coldStartSettledRef.current || state.isLoading) {
      return;
    }
    coldStartSettledRef.current = true;
    console.info("[AuthColdStart] final auth state after cold load", {
      tabId: getPrivyBootstrapTabId(),
      userId: state.user?.id ?? null,
      isAuthenticated: state.isAuthenticated,
      isLoading: state.isLoading,
      hasLiveSession: Boolean(state.user) && hasValidatedAuthSession(),
      bootstrapSnapshot: readPrivyAuthBootstrapSnapshot(),
    });
  }, [state]);

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

  const resolvedUser = getResolvedAuthUser(context.user);
  const isAuthenticated = Boolean(resolvedUser);
  const hasLiveSession = isAuthenticated && hasValidatedAuthSession();
  const canPerformAuthenticatedWrites = hasLiveSession;

  return {
    user: resolvedUser,
    isAuthenticated,
    hasLiveSession,
    canPerformAuthenticatedWrites,
    isUsingCachedUser: isAuthenticated && !hasLiveSession,
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

  const resolvedUser = getResolvedAuthUser(context.user);
  const hasLiveSession = Boolean(resolvedUser) && hasValidatedAuthSession();
  const canPerformAuthenticatedWrites = hasLiveSession;

  return {
    data: resolvedUser ? { user: resolvedUser } : null,
    isPending: context.isLoading,
    hasLiveSession,
    canPerformAuthenticatedWrites,
    isUsingCachedUser: Boolean(resolvedUser) && !hasLiveSession,
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

    // Ignore legacy token fields; browser auth is cookie-backed.
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

    // Ignore legacy token fields; browser auth is cookie-backed.
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

// Sync a Privy-authenticated user to our backend using a verified Privy identity token.
export async function syncPrivySession(
  privyUserId: string,
  email?: string,
  name?: string,
  privyIdToken?: string,
  options?: {
    allowMissingIdentityToken?: boolean;
    privyAuthToken?: string | null;
  }
): Promise<{ user: AuthUser }> {
  const normalizedUserId = privyUserId.trim();
  void email;
  if (privySyncInFlight) {
    return privySyncInFlight;
  }

  const normalizedPrivyIdToken =
    typeof privyIdToken === "string" && privyIdToken.trim().length > 0
      ? privyIdToken.trim()
      : null;
  const normalizedPrivyAuthToken =
    typeof options?.privyAuthToken === "string" && options.privyAuthToken.trim().length > 0
      ? options.privyAuthToken.trim()
      : null;
  if (!normalizedPrivyIdToken && options?.allowMissingIdentityToken !== true) {
    throw new Error("Privy identity verification is still finalizing");
  }

  const syncStartedAt = Date.now();

  privySyncInFlight = (async () => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), PRIVY_SYNC_TIMEOUT_MS);

    try {
      const response = await fetch(`${baseURL}/api/auth/privy-sync`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(normalizedPrivyAuthToken
            ? { Authorization: `Bearer ${normalizedPrivyAuthToken}` }
            : {}),
        },
        credentials: "include",
        signal: controller.signal,
        body: JSON.stringify({
          ...(normalizedPrivyIdToken ? { privyIdToken: normalizedPrivyIdToken } : {}),
          ...(name ? { name } : {}),
        }),
      });

      const text = await response.text();
      if (!text) {
        throw new Error("Empty response from auth server");
      }

      let data: { user?: AuthUser; error?: { message?: string } } | null = null;
      try {
        data = JSON.parse(text);
      } catch {
        console.error("[Auth] Failed to parse privy-sync response:", text);
        throw new Error("Invalid response from auth server");
      }

      if (!response.ok || !data?.user) {
        const message =
          data?.error?.message ??
          (response.status === 429
            ? "Too many requests"
            : response.status
              ? `Failed to sign in (${response.status})`
              : "Failed to sign in");
        console.error("[Auth] privy-sync failed:", message);
        throw new Error(message);
      }

      const syncedUser = toAuthUser(data.user);
      if (explicitLogoutAt > syncStartedAt) {
        throw new Error("Session sync completed after logout");
      }

      explicitLogoutAt = 0;
      lastPrivySyncAt = Date.now();
      sessionRateLimitedUntil = 0;
      sessionFetchInFlight = null;
      unauthorizedSessionFailures = 0;

      const bootstrappedUser = markBootstrappedAuthSession(syncedUser);
      emitAuthSessionSynced(bootstrappedUser);
      return { user: bootstrappedUser };
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error("Sign-in timed out while connecting to the server");
      }
      console.error("[Auth] syncPrivySession error:", error);
      if (error instanceof Error) {
        throw error;
      }
      throw new Error("Failed to sync Privy session");
    } finally {
      clearTimeout(timeoutId);
    }
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
