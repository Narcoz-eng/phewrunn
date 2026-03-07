import { prisma } from "../prisma.js";
import { verifySignedSessionToken, type SessionTokenUserClaims } from "./session-token.js";
import {
  isSignedSessionTokenRevoked,
  pruneExpiredSessionRevocations,
  revokeSignedSessionTokens,
} from "./session-revocation.js";

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
} as const;

const SESSION_USER_MINIMAL_SELECT = {
  id: true,
  name: true,
  email: true,
  image: true,
} as const;

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

  if (code === "P1001" || code === "P1002" || code === "P1008" || code === "P1017") {
    return true;
  }

  const message = getErrorMessage(error);
  return /timed out fetching a new connection|connection pool|error in connector|kind:\s*closed|server closed the connection|connection.*(closed|timed out|timeout|refused|terminated)|econnreset|etimedout|can't reach database/i.test(
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
const SESSION_STORE_CIRCUIT_OPEN_MS = 30_000;
const SESSION_STORE_LOG_COOLDOWN_MS = 15_000;
const SESSION_LOOKUP_TIMEOUT_MS = process.env.NODE_ENV === "production" ? 1_200 : 2_000;
let sessionStoreUnavailableUntilMs = 0;
let sessionStoreLastWarningAtMs = 0;

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
    role: user.role?.trim().toLowerCase() || "user",
    isAdmin: user.role?.trim().toLowerCase() === "admin" || (user.isAdmin ?? false),
    isBanned: user.isBanned ?? false,
    isVerified: user.isVerified ?? false,
    tradeFeeRewardsEnabled: user.tradeFeeRewardsEnabled ?? true,
    tradeFeeShareBps: user.tradeFeeShareBps ?? 100,
    tradeFeePayoutAddress: user.tradeFeePayoutAddress ?? null,
    lastUsernameUpdate: user.lastUsernameUpdate ?? null,
    lastPhotoUpdate: user.lastPhotoUpdate ?? null,
  };
}

function getCookieValues(cookieHeader: string | null | undefined, name: string): string[] {
  if (!cookieHeader) return [];

  const values: string[] = [];
  for (const part of cookieHeader.split(";")) {
    const [rawKey, ...rest] = part.trim().split("=");
    if (rawKey !== name) continue;
    const value = rest.join("=");
    if (!value) continue;
    try {
      values.push(decodeURIComponent(value));
    } catch {
      values.push(value);
    }
  }
  return values;
}

function getSessionTokensFromHeaders(headers: Headers): string[] {
  const cookieHeader = headers.get("cookie");
  const tokens = [
    ...getCookieValues(cookieHeader, "phew.session_token"),
    ...getCookieValues(cookieHeader, "better-auth.session_token"),
    ...getCookieValues(cookieHeader, "auth.session_token"),
    ...getCookieValues(cookieHeader, "session_token"),
  ].filter((token) => token.length > 0);
  return [...new Set(tokens)];
}

type SessionUserLookupResult =
  | { status: "found"; user: SessionRecord["user"] }
  | { status: "not_found" }
  | { status: "unavailable" };

async function findSessionUserByIdWithFallback(
  userId: string
): Promise<SessionUserLookupResult> {
  try {
    const fullUser = await withSessionLookupTimeout(
      prisma.user.findUnique({
        where: { id: userId },
        select: SESSION_USER_SELECT,
      }),
      "user.findUnique"
    );
    if (!fullUser) return { status: "not_found" };
    return { status: "found", user: toSessionUser(fullUser) };
  } catch (error) {
    if (isPrismaConnectivityError(error) || isSessionLookupTimeoutError(error)) {
      markSessionStoreUnavailable("user.findUnique", error);
      return { status: "unavailable" };
    }
    if (!isSessionLookupUnavailableError(error)) {
      throw error;
    }
    if (!isPrismaSchemaDriftError(error) || isSessionLookupTimeoutError(error)) {
      return { status: "unavailable" };
    }
  }

  try {
    const fallbackUser = await withSessionLookupTimeout(
      prisma.user.findUnique({
        where: { id: userId },
        select: SESSION_USER_FALLBACK_SELECT,
      }),
      "user.findUnique(fallback)"
    );
    if (!fallbackUser) return { status: "not_found" };
    return { status: "found", user: toSessionUser(fallbackUser) };
  } catch (error) {
    if (isPrismaConnectivityError(error) || isSessionLookupTimeoutError(error)) {
      markSessionStoreUnavailable("user.findUnique(fallback)", error);
      return { status: "unavailable" };
    }
    if (!isSessionLookupUnavailableError(error)) {
      throw error;
    }
    if (!isPrismaSchemaDriftError(error) || isSessionLookupTimeoutError(error)) {
      return { status: "unavailable" };
    }
  }

  try {
    const minimalUser = await withSessionLookupTimeout(
      prisma.user.findUnique({
        where: { id: userId },
        select: SESSION_USER_MINIMAL_SELECT,
      }),
      "user.findUnique(minimal)"
    );
    if (!minimalUser) return { status: "not_found" };
    return { status: "found", user: toSessionUser(minimalUser) };
  } catch (error) {
    if (isPrismaConnectivityError(error) || isSessionLookupTimeoutError(error)) {
      markSessionStoreUnavailable("user.findUnique(minimal)", error);
      return { status: "unavailable" };
    }
    if (!isSessionLookupUnavailableError(error)) {
      throw error;
    }
    console.warn("[auth] User lookup unavailable for signed token fallback", {
      message: getErrorMessage(error),
    });
    return { status: "unavailable" };
  }
}

function parseDateClaim(value: string | null | undefined): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
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
    tradeFeeShareBps: claims?.tradeFeeShareBps ?? 100,
    tradeFeePayoutAddress: claims?.tradeFeePayoutAddress ?? null,
    createdAt,
    updatedAt,
  });
}

async function getSessionFromSignedToken(token: string): Promise<SessionRecord | null> {
  const verified = verifySignedSessionToken(token);
  if (!verified) return null;
  if (await isSignedSessionTokenRevoked(verified)) return null;

  let resolvedUser: SessionRecord["user"] | null = verified.userClaims
    ? buildSessionUserFromTokenClaims(verified.userId, verified.userClaims)
    : null;

  if (!resolvedUser) {
    const userLookup = await findSessionUserByIdWithFallback(verified.userId);
    if (userLookup.status === "found") {
      resolvedUser = userLookup.user;
    } else if (userLookup.status === "unavailable" && verified.userClaims) {
      resolvedUser = buildSessionUserFromTokenClaims(verified.userId, verified.userClaims);
    }
  }

  if (!resolvedUser) return null;

  const syntheticNow = new Date();
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

async function getSessionFromToken(token: string | null): Promise<SessionRecord | null> {
  if (!token) return null;
  const verifiedSignedToken = verifySignedSessionToken(token);

  const now = Date.now();
  const cached = sessionCache.get(token);
  if (cached && cached.expiresAtMs > now) {
    return cached.value;
  }
  if (cached) {
    sessionCache.delete(token);
  }

  const existingInFlight = sessionFetchInFlight.get(token);
  if (existingInFlight) {
    return existingInFlight;
  }

  const lookupPromise = (async () => {
    const cacheAndReturn = (value: SessionRecord | null): SessionRecord | null => {
      // Evict oldest entry when cache is full
      if (sessionCache.size >= SESSION_CACHE_MAX_ENTRIES && !sessionCache.has(token)) {
        const oldestKey = sessionCache.keys().next().value;
        if (typeof oldestKey === "string") {
          sessionCache.delete(oldestKey);
        }
      }
      sessionCache.set(token, {
        value,
        expiresAtMs: value
          ? Math.min(Date.now() + SESSION_CACHE_TTL_MS, value.session.expiresAt.getTime())
          : now + SESSION_CACHE_MISS_TTL_MS,
      });
      return value;
    };

    const resolveSignedFallback = async (): Promise<SessionRecord | null> => {
      if (await isSignedSessionTokenRevoked(verifiedSignedToken)) {
        return null;
      }
      return await getSessionFromSignedToken(token);
    };

    if (verifiedSignedToken) {
      const signedSession = await getSessionFromSignedToken(token);
      return cacheAndReturn(signedSession);
    }

    if (sessionStoreUnavailableUntilMs > Date.now()) {
      const fallback = await resolveSignedFallback();
      return cacheAndReturn(fallback);
    }

    let dbSession:
      | {
          id: string;
          userId: string;
          token: string;
          expiresAt: Date;
          createdAt?: Date;
          updatedAt?: Date;
          user: SessionRecord["user"] | null;
        }
      | null = null;

    try {
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
        "session.findUnique"
      );
      dbSession = fullSession
        ? {
            ...fullSession,
            user: fullSession.user ? toSessionUser(fullSession.user) : null,
          }
        : null;
      markSessionStoreAvailable();
    } catch (error) {
      if (!isSessionLookupUnavailableError(error)) {
        throw error;
      }
      if (!isPrismaSchemaDriftError(error) || isSessionLookupTimeoutError(error)) {
        markSessionStoreUnavailable("session.findUnique", error);
        const fallback = await resolveSignedFallback();
        return cacheAndReturn(fallback);
      }
      console.warn("[auth] Session lookup failed; using fallback select", {
        message: getErrorMessage(error),
      });

      try {
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
          "session.findUnique(fallback)"
        );

        dbSession = fallbackSession
          ? {
              ...fallbackSession,
              user: fallbackSession.user ? toSessionUser(fallbackSession.user) : null,
            }
          : null;
        markSessionStoreAvailable();
      } catch (fallbackError) {
        if (!isSessionLookupUnavailableError(fallbackError)) {
          throw fallbackError;
        }
        if (!isPrismaSchemaDriftError(fallbackError) || isSessionLookupTimeoutError(fallbackError)) {
          markSessionStoreUnavailable("session.findUnique(fallback)", fallbackError);
          const fallback = await resolveSignedFallback();
          return cacheAndReturn(fallback);
        }
        console.warn("[auth] Session fallback select unavailable; trying minimal compatibility select", {
          message: getErrorMessage(fallbackError),
        });

        try {
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
            "session.findUnique(minimal)"
          );

          dbSession = minimalSession
            ? {
                ...minimalSession,
                createdAt: minimalSession.expiresAt,
                updatedAt: minimalSession.expiresAt,
                user: minimalSession.user ? toSessionUser(minimalSession.user) : null,
              }
            : null;
          markSessionStoreAvailable();
        } catch (minimalError) {
          if (!isSessionLookupUnavailableError(minimalError)) {
            throw minimalError;
          }
          if (isPrismaConnectivityError(minimalError) || isSessionLookupTimeoutError(minimalError)) {
            markSessionStoreUnavailable("session.findUnique(minimal)", minimalError);
          } else {
            console.warn("[auth] Session lookup unavailable after fallback attempts", {
              message: getErrorMessage(minimalError),
            });
          }
          const fallback = await resolveSignedFallback();
          return cacheAndReturn(fallback);
        }
      }
    }

    if (!dbSession?.user || dbSession.expiresAt.getTime() <= Date.now()) {
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
    getSession: async ({ headers }: { headers: Headers }): Promise<SessionRecord | null> => {
      const tokens = getSessionTokensFromHeaders(headers);
      for (const token of tokens) {
        const session = await getSessionFromToken(token);
        if (session) {
          return session;
        }
      }
      return null;
    },

    getSessionByToken: async (token: string | null): Promise<SessionRecord | null> => {
      return getSessionFromToken(token);
    },

    signOut: async ({ headers }: { headers: Headers }) => {
      const cookieTokens = getSessionTokensFromHeaders(headers);
      const authHeader = headers.get("authorization");
      const bearerToken =
        authHeader && authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;

      const tokens = [...new Set([...cookieTokens, bearerToken].filter(Boolean) as string[])];

      if (tokens.length > 0) {
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

