import { prisma } from "../prisma.js";
import { verifySignedSessionToken, type SessionTokenUserClaims } from "./session-token.js";

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
  isAdmin: true,
  isBanned: true,
  isVerified: true,
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

  return /does not exist|unknown arg|unknown field|column|table|no such column|invalid\s+`prisma\.[^`]+`\s+invocation/i.test(message);
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
    isAdmin: boolean;
    isBanned: boolean;
    isVerified: boolean;
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
const SESSION_CACHE_MISS_TTL_MS = 1_500;

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
    isAdmin?: boolean | null;
    isBanned?: boolean | null;
    isVerified?: boolean | null;
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
    isAdmin: user.isAdmin ?? false,
    isBanned: user.isBanned ?? false,
    isVerified: user.isVerified ?? false,
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
    const fullUser = await prisma.user.findUnique({
      where: { id: userId },
      select: SESSION_USER_SELECT,
    });
    if (!fullUser) return { status: "not_found" };
    return { status: "found", user: toSessionUser(fullUser) };
  } catch (error) {
    if (!isSessionLookupUnavailableError(error)) {
      throw error;
    }
  }

  try {
    const fallbackUser = await prisma.user.findUnique({
      where: { id: userId },
      select: SESSION_USER_FALLBACK_SELECT,
    });
    if (!fallbackUser) return { status: "not_found" };
    return { status: "found", user: toSessionUser(fallbackUser) };
  } catch (error) {
    if (!isSessionLookupUnavailableError(error)) {
      throw error;
    }
  }

  try {
    const minimalUser = await prisma.user.findUnique({
      where: { id: userId },
      select: SESSION_USER_MINIMAL_SELECT,
    });
    if (!minimalUser) return { status: "not_found" };
    return { status: "found", user: toSessionUser(minimalUser) };
  } catch (error) {
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
    isAdmin: claims?.isAdmin ?? false,
    isBanned: claims?.isBanned ?? false,
    isVerified: claims?.isVerified ?? false,
    createdAt,
    updatedAt,
  });
}

async function getSessionFromSignedToken(token: string): Promise<SessionRecord | null> {
  const verified = verifySignedSessionToken(token);
  if (!verified) return null;

  const userLookup = await findSessionUserByIdWithFallback(verified.userId);
  let resolvedUser: SessionRecord["user"] | null = null;

  if (userLookup.status === "found") {
    resolvedUser = userLookup.user;
  } else if (userLookup.status === "unavailable" && verified.userClaims) {
    resolvedUser = buildSessionUserFromTokenClaims(verified.userId, verified.userClaims);
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
      const fullSession = await prisma.session.findUnique({
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
      });
      dbSession = fullSession
        ? {
            ...fullSession,
            user: fullSession.user ? toSessionUser(fullSession.user) : null,
          }
        : null;
    } catch (error) {
      if (!isSessionLookupUnavailableError(error)) {
        throw error;
      }
      console.warn("[auth] Session lookup failed; using fallback select", {
        message: getErrorMessage(error),
      });

      try {
        const fallbackSession = await prisma.session.findUnique({
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
        });

        dbSession = fallbackSession
          ? {
              ...fallbackSession,
              user: fallbackSession.user ? toSessionUser(fallbackSession.user) : null,
            }
          : null;
      } catch (fallbackError) {
        if (!isSessionLookupUnavailableError(fallbackError)) {
          throw fallbackError;
        }
        console.warn("[auth] Session fallback select unavailable; trying minimal compatibility select", {
          message: getErrorMessage(fallbackError),
        });

        try {
          const minimalSession = await prisma.session.findUnique({
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
          });

          dbSession = minimalSession
            ? {
                ...minimalSession,
                createdAt: minimalSession.expiresAt,
                updatedAt: minimalSession.expiresAt,
                user: minimalSession.user ? toSessionUser(minimalSession.user) : null,
              }
            : null;
        } catch (minimalError) {
          if (!isSessionLookupUnavailableError(minimalError)) {
            throw minimalError;
          }
          console.warn("[auth] Session lookup unavailable after fallback attempts", {
            message: getErrorMessage(minimalError),
          });
          dbSession = null;
        }
      }
    }

    if (!dbSession?.user || dbSession.expiresAt.getTime() <= Date.now()) {
      const signedTokenSession = await getSessionFromSignedToken(token);
      if (signedTokenSession) {
        sessionCache.set(token, {
          value: signedTokenSession,
          expiresAtMs: Math.min(Date.now() + SESSION_CACHE_TTL_MS, signedTokenSession.session.expiresAt.getTime()),
        });
        return signedTokenSession;
      }
      sessionCache.set(token, {
        value: null,
        expiresAtMs: now + SESSION_CACHE_MISS_TTL_MS,
      });
      return null;
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

    const sessionExpiry = dbSession.expiresAt.getTime();
    sessionCache.set(token, {
      value: sessionRecord,
      expiresAtMs: Math.min(Date.now() + SESSION_CACHE_TTL_MS, sessionExpiry),
    });

    return sessionRecord;
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
            throw error;
          }
          console.warn("[auth/signOut] Session table delete skipped due unavailable session store");
        }
        clearSessionCache(tokens);
      }

      const cookieDomain = resolveSessionCookieDomainFromHeaders(headers);
      const cookieNames = [
        "phew.session_token",
        "better-auth.session_token",
        "auth.session_token",
      ] as const;

      const clearedCookies = cookieNames.map((cookieName) => buildExpiredCookie(cookieName));
      if (cookieDomain) {
        for (const cookieName of cookieNames) {
          clearedCookies.push(buildExpiredCookie(cookieName, cookieDomain));
        }
      }

      return {
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
