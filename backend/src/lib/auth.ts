import { prisma } from "../prisma.js";
import {
  inspectSignedSessionToken,
  verifySignedSessionToken,
  type SessionTokenUserClaims,
} from "./session-token.js";
import {
  isSignedSessionTokenRevoked,
  pruneExpiredSessionRevocations,
  revokeSignedSessionTokens,
} from "./session-revocation.js";
import {
  appendAuthDecision,
  createAuthTokenAttemptTrace,
  getPreferredAuthCookieEntries,
  type ApiMeAuthTrace,
  type AuthTokenAttemptTrace,
} from "./auth-trace.js";

const SESSION_USER_SELECT = {
  id: true,
  name: true,
  email: true,
  emailVerified: true,
  image: true,
  createdAt: true,
  updatedAt: true,
  walletAddress: true,
  walletProvider: true,
  walletConnectedAt: true,
  username: true,
  level: true,
  xp: true,
  bio: true,
  bannerImage: true,
  role: true,
  isAdmin: true,
  isBanned: true,
  isVerified: true,
  tradeFeeRewardsEnabled: true,
  tradeFeeShareBps: true,
  tradeFeePayoutAddress: true,
  lastUsernameUpdate: true,
  lastPhotoUpdate: true,
} as const;

const SESSION_USER_FALLBACK_SELECT = {
  id: true,
  name: true,
  email: true,
  emailVerified: true,
  image: true,
  createdAt: true,
  updatedAt: true,
  walletAddress: true,
  walletProvider: true,
  walletConnectedAt: true,
  username: true,
  level: true,
  xp: true,
  bio: true,
  bannerImage: true,
  isAdmin: true,
  isBanned: true,
  isVerified: true,
  tradeFeeRewardsEnabled: true,
  tradeFeeShareBps: true,
  tradeFeePayoutAddress: true,
  lastUsernameUpdate: true,
  lastPhotoUpdate: true,
} as const;

const SESSION_USER_MINIMAL_SELECT = {
  id: true,
  name: true,
  email: true,
  image: true,
} as const;
const MAX_EFFECTIVE_POSTER_FEE_BPS = 50;

function normalizeTradeFeeShareBps(value: number | null | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return MAX_EFFECTIVE_POSTER_FEE_BPS;
  }
  return Math.max(0, Math.min(MAX_EFFECTIVE_POSTER_FEE_BPS, Math.round(value)));
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof (error as { message?: unknown }).message === "string"
  ) {
    return (error as { message: string }).message;
  }
  return "";
}

function isPrismaSchemaDriftError(error: unknown): boolean {
  const code =
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof (error as { code?: unknown }).code === "string"
      ? (error as { code: string }).code
      : "";

  if (code === "P2021" || code === "P2022") {
    return true;
  }

  const message = getErrorMessage(error);

  const normalizedMessage = message.toLowerCase();

  return (
    normalizedMessage.includes("does not exist in the current database") ||
    normalizedMessage.includes("no such column") ||
    normalizedMessage.includes("no such table") ||
    normalizedMessage.includes("has no column named") ||
    normalizedMessage.includes("unknown arg") ||
    normalizedMessage.includes("unknown argument") ||
    normalizedMessage.includes("unknown field") ||
    (normalizedMessage.includes("column") && normalizedMessage.includes("does not exist")) ||
    (normalizedMessage.includes("table") && normalizedMessage.includes("does not exist")) ||
    (normalizedMessage.includes("relation") && normalizedMessage.includes("does not exist")) ||
    (normalizedMessage.includes("invalid") && normalizedMessage.includes("invocation"))
  );
}

function isPrismaClientError(error: unknown): boolean {
  const name =
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    typeof (error as { name?: unknown }).name === "string"
      ? (error as { name: string }).name
      : "";
  return name.startsWith("PrismaClient");
}

function isPrismaConnectivityError(error: unknown): boolean {
  const code =
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof (error as { code?: unknown }).code === "string"
      ? (error as { code: string }).code
      : "";

  if (code === "P1001" || code === "P1002" || code === "P1008" || code === "P1017" || code === "P2024") {
    return true;
  }

  const message = getErrorMessage(error);
  return /timed out fetching a new connection|connection pool|error in connector|kind:\s*closed|server closed the connection|connection.*(closed|timed out|timeout|refused|terminated)|econnreset|etimedout|can't reach database|transaction already closed|expired transaction/i.test(
    message
  );
}

function isSessionLookupUnavailableError(error: unknown): boolean {
  return isPrismaSchemaDriftError(error) || isPrismaClientError(error);
}

type SessionRecord = {
  session: {
    id: string;
    userId: string;
    token: string;
    expiresAt: Date;
    createdAt: Date;
    updatedAt: Date;
  };
  user: {
    id: string;
    name: string;
    email: string;
    emailVerified: boolean;
    image: string | null;
    createdAt: Date;
    updatedAt: Date;
    walletAddress: string | null;
    walletProvider: string | null;
    walletConnectedAt: Date | null;
    username: string | null;
    level: number;
    xp: number;
    bio: string | null;
    bannerImage: string | null;
    role: string;
    isAdmin: boolean;
    isBanned: boolean;
    isVerified: boolean;
    tradeFeeRewardsEnabled: boolean;
    tradeFeeShareBps: number;
    tradeFeePayoutAddress: string | null;
    lastUsernameUpdate: Date | null;
    lastPhotoUpdate: Date | null;
  };
};

type SessionCacheEntry = {
  value: SessionRecord | null;
  expiresAtMs: number;
};

const sessionCache = new Map<string, SessionCacheEntry>();
const sessionFetchInFlight = new Map<string, Promise<SessionRecord | null>>();
const SESSION_CACHE_TTL_MS = 5_000;
const SESSION_CACHE_MISS_TTL_MS = 300;
const SESSION_CACHE_MAX_ENTRIES = 10_000;
const SESSION_DB_PERSISTENCE_ENABLED =
  process.env.AUTH_SESSION_DB_PERSISTENCE_ENABLED?.trim().toLowerCase() === "true";
const SESSION_STORE_CIRCUIT_OPEN_MS = 30_000;
const SESSION_STORE_LOG_COOLDOWN_MS = 15_000;
const SESSION_DB_FALLBACK_LOG_COOLDOWN_MS = 15_000;
const SESSION_LOOKUP_TIMEOUT_MS = process.env.NODE_ENV === "production" ? 1_200 : 2_000;
type AuthLookupCompatibilityMode = "full" | "fallback" | "minimal";
const AUTH_LOOKUP_COMPATIBILITY_ORDER: AuthLookupCompatibilityMode[] = [
  "full",
  "fallback",
  "minimal",
];
let sessionStoreUnavailableUntilMs = 0;
let sessionStoreLastWarningAtMs = 0;
let signedTokenDbFallbackLastWarningAtMs = 0;
let sessionUserLookupCompatibilityMode: AuthLookupCompatibilityMode = "full";
let sessionRecordLookupCompatibilityMode: AuthLookupCompatibilityMode = "full";

function getAuthLookupModes(
  startingMode: AuthLookupCompatibilityMode
): AuthLookupCompatibilityMode[] {
  const startIndex = AUTH_LOOKUP_COMPATIBILITY_ORDER.indexOf(startingMode);
  return AUTH_LOOKUP_COMPATIBILITY_ORDER.slice(startIndex >= 0 ? startIndex : 0);
}

function getNextAuthLookupMode(
  currentMode: AuthLookupCompatibilityMode
): AuthLookupCompatibilityMode | null {
  const currentIndex = AUTH_LOOKUP_COMPATIBILITY_ORDER.indexOf(currentMode);
  if (currentIndex < 0 || currentIndex >= AUTH_LOOKUP_COMPATIBILITY_ORDER.length - 1) {
    return null;
  }
  return AUTH_LOOKUP_COMPATIBILITY_ORDER[currentIndex + 1] ?? null;
}

function updateAuthLookupCompatibilityMode(
  target: "session-user" | "session-record",
  nextMode: AuthLookupCompatibilityMode,
  error: unknown
): void {
  if (target === "session-user") {
    if (sessionUserLookupCompatibilityMode === nextMode) return;
    sessionUserLookupCompatibilityMode = nextMode;
  } else {
    if (sessionRecordLookupCompatibilityMode === nextMode) return;
    sessionRecordLookupCompatibilityMode = nextMode;
  }

  console.warn(`[auth] ${target} compatibility downgraded to ${nextMode}`, {
    message: getErrorMessage(error),
  });
}

class SessionLookupTimeoutError extends Error {
  constructor(stage: string, timeoutMs: number) {
    super("[auth] " + stage + " timed out after " + timeoutMs + "ms");
    this.name = "SessionLookupTimeoutError";
  }
}

function isSessionLookupTimeoutError(error: unknown): error is SessionLookupTimeoutError {
  return error instanceof SessionLookupTimeoutError;
}

function withSessionLookupTimeout<T>(
  promise: Promise<T>,
  stage: string,
  timeoutMs = SESSION_LOOKUP_TIMEOUT_MS
): Promise<T> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new SessionLookupTimeoutError(stage, timeoutMs));
    }, timeoutMs);

    promise
      .then((value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        resolve(value);
      })
      .catch((error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        reject(error);
      });
  });
}

function markSessionStoreUnavailable(reason: string, error: unknown): void {
  const now = Date.now();
  sessionStoreUnavailableUntilMs = Math.max(
    sessionStoreUnavailableUntilMs,
    now + SESSION_STORE_CIRCUIT_OPEN_MS
  );
  if (now - sessionStoreLastWarningAtMs < SESSION_STORE_LOG_COOLDOWN_MS) {
    return;
  }
  sessionStoreLastWarningAtMs = now;
  console.warn(`[auth] Session store temporarily unavailable (${reason}); using signed-token fallback`, {
    message: getErrorMessage(error),
  });
}

function markSessionStoreAvailable(): void {
  sessionStoreUnavailableUntilMs = 0;
}

function toSessionUser(
  user: {
    id: string;
    name?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    image?: string | null;
    createdAt?: Date | null;
    updatedAt?: Date | null;
    walletAddress?: string | null;
    walletProvider?: string | null;
    walletConnectedAt?: Date | null;
    username?: string | null;
    level?: number | null;
    xp?: number | null;
    bio?: string | null;
    bannerImage?: string | null;
    role?: string | null;
    isAdmin?: boolean | null;
    isBanned?: boolean | null;
    isVerified?: boolean | null;
    tradeFeeRewardsEnabled?: boolean | null;
    tradeFeeShareBps?: number | null;
    tradeFeePayoutAddress?: string | null;
    lastUsernameUpdate?: Date | null;
    lastPhotoUpdate?: Date | null;
  }
): SessionRecord["user"] {
  const createdAt = user.createdAt ?? new Date();
  const updatedAt = user.updatedAt ?? createdAt;
  return {
    id: user.id,
    name: user.name ?? "",
    email: user.email ?? "",
    emailVerified: user.emailVerified ?? false,
    image: user.image ?? null,
    createdAt,
    updatedAt,
    walletAddress: user.walletAddress ?? null,
    walletProvider: user.walletProvider ?? null,
    walletConnectedAt: user.walletConnectedAt ?? null,
    username: user.username ?? null,
    level: user.level ?? 0,
    xp: user.xp ?? 0,
    bio: user.bio ?? null,
    bannerImage: user.bannerImage ?? null,
    role: user.role?.trim().toLowerCase() || "user",
    isAdmin: user.role?.trim().toLowerCase() === "admin" || (user.isAdmin ?? false),
    isBanned: user.isBanned ?? false,
    isVerified: user.isVerified ?? false,
    tradeFeeRewardsEnabled: user.tradeFeeRewardsEnabled ?? true,
    tradeFeeShareBps: normalizeTradeFeeShareBps(user.tradeFeeShareBps),
    tradeFeePayoutAddress: user.tradeFeePayoutAddress ?? null,
    lastUsernameUpdate: user.lastUsernameUpdate ?? null,
    lastPhotoUpdate: user.lastPhotoUpdate ?? null,
  };
}

function getSessionTokensFromHeaders(headers: Headers): string[] {
  const tokens = getPreferredAuthCookieEntries(headers.get("cookie"))
    .map((entry) => entry.value)
    .filter((token) => token.length > 0);
  return [...new Set(tokens)];
}

type SessionUserLookupResult =
  | { status: "found"; user: SessionRecord["user"] }
  | { status: "not_found" }
  | { status: "unavailable" };

async function findSessionUserByIdWithFallback(
  userId: string,
  trace?: ApiMeAuthTrace | null,
  attempt?: AuthTokenAttemptTrace | null
): Promise<SessionUserLookupResult> {
  for (const mode of getAuthLookupModes(sessionUserLookupCompatibilityMode)) {
    const stage =
      mode === "full"
        ? "user.findUnique"
        : mode === "fallback"
          ? "user.findUnique(fallback)"
          : "user.findUnique(minimal)";
    const select =
      mode === "full"
        ? SESSION_USER_SELECT
        : mode === "fallback"
          ? SESSION_USER_FALLBACK_SELECT
          : SESSION_USER_MINIMAL_SELECT;

    try {
      appendAuthDecision(trace, `user_lookup:${stage}:start`);
      const candidateUser = await withSessionLookupTimeout(
        prisma.user.findUnique({
          where: { id: userId },
          select,
        }),
        stage
      );
      if (!candidateUser) {
        appendAuthDecision(trace, `user_lookup:${stage}:not_found`);
        return { status: "not_found" };
      }
      if (attempt) {
        attempt.userRowFound = true;
      }
      appendAuthDecision(trace, `user_lookup:${stage}:found`);
      return { status: "found", user: toSessionUser(candidateUser) };
    } catch (error) {
      if (isPrismaConnectivityError(error) || isSessionLookupTimeoutError(error)) {
        appendAuthDecision(trace, `user_lookup:${stage}:unavailable`);
        markSessionStoreUnavailable(stage, error);
        return { status: "unavailable" };
      }
      if (!isSessionLookupUnavailableError(error)) {
        throw error;
      }
      if (!isPrismaSchemaDriftError(error)) {
        return { status: "unavailable" };
      }

      const nextMode = getNextAuthLookupMode(mode);
      if (nextMode) {
        updateAuthLookupCompatibilityMode("session-user", nextMode, error);
        continue;
      }

      console.warn("[auth] User lookup unavailable for signed token fallback", {
        message: getErrorMessage(error),
      });
      appendAuthDecision(trace, `user_lookup:${stage}:compat_unavailable`);
      return { status: "unavailable" };
    }
  }

  return { status: "unavailable" };
}

function parseDateClaim(value: string | null | undefined): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function looksLikeSignedSessionToken(token: string): boolean {
  if (!token.startsWith("v1.")) return false;
  return token.split(".").length === 3;
}

function shouldCacheNullSessionResult(token: string): boolean {
  // Fresh signed-cookie sessions can briefly race DB persistence or land on an
  // instance with an old secret. Avoid sticky negative caching for those tokens.
  return !looksLikeSignedSessionToken(token);
}

function logSignedTokenDbFallback(token: string): void {
  if (!looksLikeSignedSessionToken(token)) {
    return;
  }
  const now = Date.now();
  if (now - signedTokenDbFallbackLastWarningAtMs < SESSION_DB_FALLBACK_LOG_COOLDOWN_MS) {
    return;
  }
  signedTokenDbFallbackLastWarningAtMs = now;
  console.warn(
    "[auth] Signed session token required DB fallback; check AUTH_SESSION_TOKEN_SECRET consistency and instance clock skew"
  );
}

function buildSessionUserFromTokenClaims(
  userId: string,
  claims: SessionTokenUserClaims | null
): SessionRecord["user"] {
  const createdAt = parseDateClaim(claims?.createdAt) ?? new Date();
  const updatedAt = parseDateClaim(claims?.updatedAt) ?? createdAt;
  return toSessionUser({
    id: userId,
    name: claims?.name ?? "",
    email: claims?.email ?? "",
    emailVerified: claims?.emailVerified ?? false,
    image: claims?.image ?? null,
    walletAddress: claims?.walletAddress ?? null,
    walletProvider: claims?.walletProvider ?? null,
    username: claims?.username ?? null,
    level: claims?.level ?? 0,
    xp: claims?.xp ?? 0,
    bio: claims?.bio ?? null,
    role: claims?.role?.trim().toLowerCase() || "user",
    isAdmin: claims?.role?.trim().toLowerCase() === "admin" || (claims?.isAdmin ?? false),
    isBanned: claims?.isBanned ?? false,
    isVerified: claims?.isVerified ?? false,
    tradeFeeRewardsEnabled: claims?.tradeFeeRewardsEnabled ?? true,
    tradeFeeShareBps: normalizeTradeFeeShareBps(claims?.tradeFeeShareBps),
    tradeFeePayoutAddress: claims?.tradeFeePayoutAddress ?? null,
    createdAt,
    updatedAt,
  });
}

async function getSessionFromSignedToken(
  token: string,
  trace?: ApiMeAuthTrace | null,
  attempt?: AuthTokenAttemptTrace | null
): Promise<SessionRecord | null> {
  const verified = verifySignedSessionToken(token);
  if (!verified) {
    if (attempt && !attempt.reason) {
      attempt.reason = "signed_token_verification_failed";
    }
    appendAuthDecision(trace, "signed_token:verification_failed");
    return null;
  }
  appendAuthDecision(trace, "signed_token:verified");
  if (await isSignedSessionTokenRevoked(verified, attempt)) {
    if (attempt && !attempt.reason) {
      attempt.reason = "signed_token_revoked";
    }
    appendAuthDecision(trace, "signed_token:revoked");
    return null;
  }

  let resolvedUser: SessionRecord["user"] | null = verified.userClaims
    ? buildSessionUserFromTokenClaims(verified.userId, verified.userClaims)
    : null;
  if (resolvedUser) {
    appendAuthDecision(trace, "signed_token:user_claims_used");
  }

  if (!resolvedUser) {
    const userLookup = await findSessionUserByIdWithFallback(verified.userId, trace, attempt);
    if (userLookup.status === "found") {
      resolvedUser = userLookup.user;
    } else if (userLookup.status === "unavailable" && verified.userClaims) {
      resolvedUser = buildSessionUserFromTokenClaims(verified.userId, verified.userClaims);
      appendAuthDecision(trace, "signed_token:user_claims_used_after_db_unavailable");
    }
  }

  if (!resolvedUser) {
    if (attempt && !attempt.reason) {
      attempt.reason = "signed_token_user_unresolved";
    }
    appendAuthDecision(trace, "signed_token:user_unresolved");
    return null;
  }

  const syntheticNow = new Date();
  if (attempt) {
    attempt.sessionResolved = true;
    if (!attempt.reason) {
      attempt.reason = "signed_token_session_resolved";
    }
  }
  appendAuthDecision(trace, "signed_token:session_resolved");
  return {
    session: {
      id: `stateless:${verified.userId}`,
      userId: verified.userId,
      token,
      expiresAt: verified.expiresAt,
      createdAt: syntheticNow,
      updatedAt: syntheticNow,
    },
    user: resolvedUser,
  };
}

type DbSessionLookupRecord = {
  id: string;
  userId: string;
  token: string;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
  user: SessionRecord["user"] | null;
};

type DbSessionLookupResult =
  | { status: "found"; session: DbSessionLookupRecord }
  | { status: "not_found" }
  | { status: "unavailable" };

async function findDbSessionByTokenWithCompatibility(
  token: string,
  trace?: ApiMeAuthTrace | null,
  attempt?: AuthTokenAttemptTrace | null
): Promise<DbSessionLookupResult> {
  for (const mode of getAuthLookupModes(sessionRecordLookupCompatibilityMode)) {
    const stage =
      mode === "full"
        ? "session.findUnique"
        : mode === "fallback"
          ? "session.findUnique(fallback)"
          : "session.findUnique(minimal)";

    try {
      appendAuthDecision(trace, `db_session_lookup:${stage}:start`);
      if (mode === "full") {
        const fullSession = await withSessionLookupTimeout(
          prisma.session.findUnique({
            where: { token },
            select: {
              id: true,
              userId: true,
              token: true,
              expiresAt: true,
              createdAt: true,
              updatedAt: true,
              user: {
                select: SESSION_USER_SELECT,
              },
            },
          }),
          stage
        );
        markSessionStoreAvailable();
        if (fullSession && attempt) {
          attempt.sessionRowFound = true;
          attempt.userRowFound = Boolean(fullSession.user);
        }
        appendAuthDecision(
          trace,
          fullSession ? `db_session_lookup:${stage}:found` : `db_session_lookup:${stage}:not_found`
        );
        return fullSession
          ? {
              status: "found",
              session: {
                ...fullSession,
                createdAt: fullSession.createdAt,
                updatedAt: fullSession.updatedAt,
                user: fullSession.user ? toSessionUser(fullSession.user) : null,
              },
            }
          : { status: "not_found" };
      }

      if (mode === "fallback") {
        const fallbackSession = await withSessionLookupTimeout(
          prisma.session.findUnique({
            where: { token },
            select: {
              id: true,
              userId: true,
              token: true,
              expiresAt: true,
              createdAt: true,
              updatedAt: true,
              user: {
                select: SESSION_USER_FALLBACK_SELECT,
              },
            },
          }),
          stage
        );
        markSessionStoreAvailable();
        if (fallbackSession && attempt) {
          attempt.sessionRowFound = true;
          attempt.userRowFound = Boolean(fallbackSession.user);
        }
        appendAuthDecision(
          trace,
          fallbackSession
            ? `db_session_lookup:${stage}:found`
            : `db_session_lookup:${stage}:not_found`
        );
        return fallbackSession
          ? {
              status: "found",
              session: {
                ...fallbackSession,
                createdAt: fallbackSession.createdAt,
                updatedAt: fallbackSession.updatedAt,
                user: fallbackSession.user ? toSessionUser(fallbackSession.user) : null,
              },
            }
          : { status: "not_found" };
      }

      const minimalSession = await withSessionLookupTimeout(
        prisma.session.findUnique({
          where: { token },
          select: {
            id: true,
            userId: true,
            token: true,
            expiresAt: true,
            user: {
              select: SESSION_USER_MINIMAL_SELECT,
            },
          },
        }),
        stage
      );
      markSessionStoreAvailable();
      if (minimalSession && attempt) {
        attempt.sessionRowFound = true;
        attempt.userRowFound = Boolean(minimalSession.user);
      }
      appendAuthDecision(
        trace,
        minimalSession ? `db_session_lookup:${stage}:found` : `db_session_lookup:${stage}:not_found`
      );
      return minimalSession
        ? {
            status: "found",
            session: {
              ...minimalSession,
              createdAt: minimalSession.expiresAt,
              updatedAt: minimalSession.expiresAt,
              user: minimalSession.user ? toSessionUser(minimalSession.user) : null,
            },
          }
        : { status: "not_found" };
    } catch (error) {
      if (isPrismaConnectivityError(error) || isSessionLookupTimeoutError(error)) {
        appendAuthDecision(trace, `db_session_lookup:${stage}:unavailable`);
        markSessionStoreUnavailable(stage, error);
        return { status: "unavailable" };
      }
      if (!isSessionLookupUnavailableError(error)) {
        throw error;
      }
      if (!isPrismaSchemaDriftError(error)) {
        return { status: "unavailable" };
      }

      const nextMode = getNextAuthLookupMode(mode);
      if (nextMode) {
        updateAuthLookupCompatibilityMode("session-record", nextMode, error);
        continue;
      }

      console.warn("[auth] Session lookup unavailable after compatibility fallbacks", {
        message: getErrorMessage(error),
      });
      appendAuthDecision(trace, `db_session_lookup:${stage}:compat_unavailable`);
      return { status: "unavailable" };
    }
  }

  return { status: "unavailable" };
}

async function getSessionFromToken(
  token: string | null,
  trace?: ApiMeAuthTrace | null,
  attempt?: AuthTokenAttemptTrace | null
): Promise<SessionRecord | null> {
  if (!token) {
    if (attempt && !attempt.reason) {
      attempt.reason = "missing_token";
    }
    appendAuthDecision(trace, `${attempt?.source ?? "token"}:missing_token`);
    return null;
  }

  const signedInspection = looksLikeSignedSessionToken(token)
    ? inspectSignedSessionToken(token)
    : null;
  const verifiedSignedToken = signedInspection?.verified ?? null;
  if (attempt) {
    attempt.signedTokenPresent = looksLikeSignedSessionToken(token);
    attempt.signedTokenParseSuccess = Boolean(signedInspection?.payloadParsed);
    attempt.signatureVerifySuccess = Boolean(signedInspection?.signatureVerified);
    attempt.tokenExpiryValid = Boolean(
      signedInspection &&
        signedInspection.payloadValid &&
        !signedInspection.expired &&
        !signedInspection.futureIat
    );
  }
  if (signedInspection?.verified) {
    appendAuthDecision(trace, `${attempt?.source ?? "token"}:signed_token_verified`);
  } else if (signedInspection) {
    appendAuthDecision(
      trace,
      `${attempt?.source ?? "token"}:signed_token_invalid:${signedInspection.failureReason ?? "unknown"}`
    );
    if (attempt && !attempt.reason) {
      attempt.reason = `signed_token_${signedInspection.failureReason ?? "invalid"}`;
    }
  } else {
    appendAuthDecision(trace, `${attempt?.source ?? "token"}:non_signed_token`);
  }

  const now = Date.now();
  const cached = sessionCache.get(token);
  if (cached && cached.expiresAtMs > now) {
    if (attempt) {
      attempt.sessionResolved = Boolean(cached.value);
      if (!attempt.reason) {
        attempt.reason = cached.value ? "session_cache_hit" : "session_cache_miss";
      }
    }
    appendAuthDecision(
      trace,
      cached.value ? `${attempt?.source ?? "token"}:session_cache_hit` : `${attempt?.source ?? "token"}:session_cache_hit_null`
    );
    return cached.value;
  }
  if (cached) {
    sessionCache.delete(token);
    appendAuthDecision(trace, `${attempt?.source ?? "token"}:session_cache_expired`);
  }

  const existingInFlight = sessionFetchInFlight.get(token);
  if (existingInFlight) {
    appendAuthDecision(trace, `${attempt?.source ?? "token"}:session_lookup_inflight_reused`);
    return existingInFlight;
  }

  const lookupPromise = (async () => {
    const cacheAndReturn = (value: SessionRecord | null): SessionRecord | null => {
      // Evict oldest entry when cache is full
      if (
        value &&
        sessionCache.size >= SESSION_CACHE_MAX_ENTRIES &&
        !sessionCache.has(token)
      ) {
        const oldestKey = sessionCache.keys().next().value;
        if (typeof oldestKey === "string") {
          sessionCache.delete(oldestKey);
        }
      }
      if (value || shouldCacheNullSessionResult(token)) {
        sessionCache.set(token, {
          value,
          expiresAtMs: value
            ? Math.min(Date.now() + SESSION_CACHE_TTL_MS, value.session.expiresAt.getTime())
            : now + SESSION_CACHE_MISS_TTL_MS,
        });
      } else {
        sessionCache.delete(token);
      }
      return value;
    };

    const resolveSignedFallback = async (): Promise<SessionRecord | null> => {
      appendAuthDecision(trace, `${attempt?.source ?? "token"}:signed_fallback_start`);
      const fallbackSession = await getSessionFromSignedToken(token, trace, attempt);
      if (!fallbackSession && attempt && !attempt.reason) {
        attempt.reason = "signed_fallback_unresolved";
      }
      appendAuthDecision(
        trace,
        fallbackSession
          ? `${attempt?.source ?? "token"}:signed_fallback_resolved`
          : `${attempt?.source ?? "token"}:signed_fallback_null`
      );
      return fallbackSession;
    };

    if (verifiedSignedToken) {
      const signedSession = await getSessionFromSignedToken(token, trace, attempt);
      return cacheAndReturn(signedSession);
    }

    if (sessionStoreUnavailableUntilMs > Date.now()) {
      appendAuthDecision(trace, `${attempt?.source ?? "token"}:session_store_circuit_open`);
      const fallback = await resolveSignedFallback();
      return cacheAndReturn(fallback);
    }

    if (attempt) {
      attempt.fallbackToDbUsed = true;
    }
    appendAuthDecision(trace, `${attempt?.source ?? "token"}:db_fallback_start`);
    const dbSessionLookup = await findDbSessionByTokenWithCompatibility(token, trace, attempt);
    if (dbSessionLookup.status === "unavailable") {
      if (attempt && !attempt.reason) {
        attempt.reason = "db_session_lookup_unavailable";
      }
      const fallback = await resolveSignedFallback();
      return cacheAndReturn(fallback);
    }
    if (dbSessionLookup.status === "not_found") {
      if (attempt && !attempt.reason) {
        attempt.reason = "db_session_not_found";
      }
      const fallback = await resolveSignedFallback();
      return cacheAndReturn(fallback);
    }
    const dbSession = dbSessionLookup.session;
    if (!verifiedSignedToken) {
      logSignedTokenDbFallback(token);
      appendAuthDecision(trace, `${attempt?.source ?? "token"}:db_fallback_used_after_signed_verify_failure`);
    }

    if (!dbSession?.user || dbSession.expiresAt.getTime() <= Date.now()) {
      if (attempt && !attempt.reason) {
        attempt.reason = !dbSession?.user ? "db_session_user_missing" : "db_session_expired";
      }
      appendAuthDecision(
        trace,
        !dbSession?.user
          ? `${attempt?.source ?? "token"}:db_session_user_missing`
          : `${attempt?.source ?? "token"}:db_session_expired`
      );
      const signedTokenSession = await resolveSignedFallback();
      return cacheAndReturn(signedTokenSession);
    }

    const sessionRecord: SessionRecord = {
      session: {
        id: dbSession.id,
        userId: dbSession.userId,
        token: dbSession.token,
        expiresAt: dbSession.expiresAt,
        createdAt: dbSession.createdAt ?? dbSession.expiresAt,
        updatedAt: dbSession.updatedAt ?? dbSession.createdAt ?? dbSession.expiresAt,
      },
      user: dbSession.user as SessionRecord["user"],
    };
    if (attempt) {
      attempt.sessionResolved = true;
      attempt.sessionRowFound = true;
      attempt.userRowFound = true;
      attempt.reason = "db_session_resolved";
    }
    appendAuthDecision(trace, `${attempt?.source ?? "token"}:db_session_resolved`);
    return cacheAndReturn(sessionRecord);
  })().finally(() => {
    sessionFetchInFlight.delete(token);
  });

  sessionFetchInFlight.set(token, lookupPromise);
  return lookupPromise;
}

function clearSessionCache(tokens: string[]) {
  for (const token of tokens) {
    sessionCache.delete(token);
    sessionFetchInFlight.delete(token);
  }
}

function resolveSessionCookieDomainFromHeaders(headers: Headers): string | null {
  const hostHeader = headers.get("host");
  if (!hostHeader) return null;
  const normalizedHost = hostHeader.split(":")[0]?.trim().toLowerCase() ?? "";
  if (!normalizedHost) return null;
  // Share cookies only on canonical production hosts.
  // Preview/staging subdomains must stay isolated to avoid cross-environment token collisions.
  if (normalizedHost === "phew.run" || normalizedHost === "www.phew.run") {
    return ".phew.run";
  }
  return null;
}

function buildExpiredCookie(name: string, domain?: string): string {
  const isProd = process.env.NODE_ENV === "production";
  return [
    `${name}=`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=0",
    domain ? `Domain=${domain}` : "",
    isProd ? "Secure" : "",
  ]
    .filter(Boolean)
    .join("; ");
}

export const auth = {
  api: {
    getSession: async ({
      headers,
      trace,
    }: {
      headers: Headers;
      trace?: ApiMeAuthTrace | null;
    }): Promise<SessionRecord | null> => {
      const cookieEntries = getPreferredAuthCookieEntries(headers.get("cookie"));
      const tokens = [...new Set(cookieEntries.map((entry) => entry.value).filter((token) => token.length > 0))];
      appendAuthDecision(trace, `cookie_candidates:${cookieEntries.length}`);
      for (const token of tokens) {
        const attempt = createAuthTokenAttemptTrace({
          source: "cookie",
          cookieNames: cookieEntries
            .filter((entry) => entry.value === token)
            .map((entry) => entry.name),
          token,
        });
        trace?.tokenAttempts.push(attempt);
        const session = await getSessionFromToken(token, trace, attempt);
        if (session) {
          return session;
        }
      }
      return null;
    },

    getSessionByToken: async (
      token: string | null,
      trace?: ApiMeAuthTrace | null
    ): Promise<SessionRecord | null> => {
      if (!token) return null;
      const attempt = createAuthTokenAttemptTrace({
        source: "bearer",
        token,
      });
      trace?.tokenAttempts.push(attempt);
      return getSessionFromToken(token, trace, attempt);
    },

    signOut: async ({ headers }: { headers: Headers }) => {
      const cookieTokens = getSessionTokensFromHeaders(headers);
      const authHeader = headers.get("authorization");
      const bearerToken =
        authHeader && authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;

      const tokens = [...new Set([...cookieTokens, bearerToken].filter(Boolean) as string[])];

      if (tokens.length > 0) {
        const shouldDeleteSessionRows =
          SESSION_DB_PERSISTENCE_ENABLED || tokens.some((token) => !looksLikeSignedSessionToken(token));

        if (shouldDeleteSessionRows) {
          try {
            await prisma.session.deleteMany({
              where: { token: { in: tokens } },
            });
          } catch (error) {
            if (!isSessionLookupUnavailableError(error)) {
              console.warn("[auth/signOut] Session table delete failed; falling back to signed-token revocation", {
                message: getErrorMessage(error),
              });
            } else {
              console.warn("[auth/signOut] Session table delete skipped due unavailable session store");
            }
          }
        }
        await revokeSignedSessionTokens(tokens);
        clearSessionCache(tokens);
      }

      const cookieDomain = resolveSessionCookieDomainFromHeaders(headers);
      const cookieNames = [
        "phew.session_token",
        "better-auth.session_token",
        "auth.session_token",
        "session_token",
      ] as const;

      const clearedCookies = cookieNames.map((cookieName) => buildExpiredCookie(cookieName));
      if (cookieDomain) {
        for (const cookieName of cookieNames) {
          clearedCookies.push(buildExpiredCookie(cookieName, cookieDomain));
        }
      }

      return {
        tokens,
        clearedCookies,
      };
    },
  },

  // Legacy compatibility for routes still expecting an auth handler.
  handler: async () =>
    new Response(
      JSON.stringify({
        error: { message: "Email/password auth is disabled. Use Privy sign-in.", code: "UNSUPPORTED_AUTH" },
      }),
      {
        status: 404,
        headers: { "Content-Type": "application/json" },
      }
    ),
};

export type Session = NonNullable<Awaited<ReturnType<typeof auth.api.getSession>>>["session"];
export type User = NonNullable<Awaited<ReturnType<typeof auth.api.getSession>>>["user"];

const SESSION_MAINTENANCE_INTERVAL_MS = (() => {
  const raw = process.env.AUTH_SESSION_MAINTENANCE_INTERVAL_MS;
  const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN;
  if (Number.isFinite(parsed) && parsed > 0) return parsed;
  return process.env.NODE_ENV === "production" ? 15 * 60 * 1000 : 5 * 60 * 1000;
})();

const SESSION_MAINTENANCE_BATCH_SIZE = (() => {
  const raw = process.env.AUTH_SESSION_MAINTENANCE_BATCH_SIZE;
  const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN;
  if (Number.isFinite(parsed) && parsed > 0) return parsed;
  return process.env.NODE_ENV === "production" ? 500 : 100;
})();

const SESSION_MAINTENANCE_MAX_BATCHES_PER_RUN = 5;
let sessionMaintenanceTimer: ReturnType<typeof setInterval> | null = null;
let sessionMaintenanceInFlight = false;

async function pruneExpiredSessionsOnce(): Promise<number> {
  let totalDeleted = 0;

  for (let batch = 0; batch < SESSION_MAINTENANCE_MAX_BATCHES_PER_RUN; batch += 1) {
    const expiredSessions = await prisma.session.findMany({
      where: {
        expiresAt: { lt: new Date() },
      },
      orderBy: { expiresAt: "asc" },
      select: { id: true },
      take: SESSION_MAINTENANCE_BATCH_SIZE,
    });

    if (expiredSessions.length === 0) {
      break;
    }

    const ids = expiredSessions.map((session) => session.id);
    const deleted = await prisma.session.deleteMany({
      where: {
        id: { in: ids },
      },
    });
    totalDeleted += deleted.count;

    if (expiredSessions.length < SESSION_MAINTENANCE_BATCH_SIZE) {
      break;
    }
  }

  for (let batch = 0; batch < SESSION_MAINTENANCE_MAX_BATCHES_PER_RUN; batch += 1) {
    const deletedCount = await pruneExpiredSessionRevocations(SESSION_MAINTENANCE_BATCH_SIZE);
    totalDeleted += deletedCount;
    if (deletedCount < SESSION_MAINTENANCE_BATCH_SIZE) {
      break;
    }
  }

  return totalDeleted;
}

export function startSessionMaintenance(): void {
  if (sessionMaintenanceTimer || process.env.AUTH_DISABLE_SESSION_MAINTENANCE === "true") {
    return;
  }

  const runMaintenance = async () => {
    if (sessionMaintenanceInFlight) {
      return;
    }

    sessionMaintenanceInFlight = true;
    try {
      const deletedCount = await pruneExpiredSessionsOnce();
      if (deletedCount > 0) {
        console.log(`[auth/session] Pruned ${deletedCount} expired sessions`);
      }
    } catch (error) {
      console.warn("[auth/session] Expired session maintenance failed", error);
    } finally {
      sessionMaintenanceInFlight = false;
    }
  };

  sessionMaintenanceTimer = setInterval(() => {
    void runMaintenance();
  }, SESSION_MAINTENANCE_INTERVAL_MS);
  sessionMaintenanceTimer.unref?.();

  void runMaintenance();
}

