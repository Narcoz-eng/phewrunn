import { prisma } from "../prisma.js";

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

  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "";

  return /does not exist|unknown arg|unknown field|column|table/i.test(message);
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

function getCookieValue(cookieHeader: string | null | undefined, name: string): string | null {
  if (!cookieHeader) return null;

  let resolvedValue: string | null = null;
  for (const part of cookieHeader.split(";")) {
    const [rawKey, ...rest] = part.trim().split("=");
    if (rawKey !== name) continue;
    const value = rest.join("=");
    if (!value) {
      resolvedValue = null;
      continue;
    }
    try {
      resolvedValue = decodeURIComponent(value);
    } catch {
      resolvedValue = value;
    }
  }

  return resolvedValue;
}

function getSessionTokenFromHeaders(headers: Headers): string | null {
  const cookieHeader = headers.get("cookie");
  return (
    getCookieValue(cookieHeader, "phew.session_token") ??
    getCookieValue(cookieHeader, "better-auth.session_token") ??
    getCookieValue(cookieHeader, "auth.session_token")
  );
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
          createdAt: Date;
          updatedAt: Date;
          user: SessionRecord["user"] | null;
        }
      | null = null;

    try {
      dbSession = await prisma.session.findUnique({
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
      }) as typeof dbSession;
    } catch (error) {
      if (!isPrismaSchemaDriftError(error)) {
        throw error;
      }

      console.warn("[auth] Session user schema drift detected; using fallback select");

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
            user: fallbackSession.user
              ? {
                  ...fallbackSession.user,
                  walletAddress: null,
                  walletProvider: null,
                  walletConnectedAt: null,
                  username: null,
                  level: 0,
                  xp: 0,
                  bio: null,
                  isAdmin: false,
                  isBanned: false,
                  isVerified: false,
                  lastUsernameUpdate: null,
                  lastPhotoUpdate: null,
                }
              : null,
          }
        : null;
    }

    if (!dbSession?.user || dbSession.expiresAt.getTime() <= Date.now()) {
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
        createdAt: dbSession.createdAt,
        updatedAt: dbSession.updatedAt,
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
  if (
    normalizedHost === "phew.run" ||
    normalizedHost === "www.phew.run" ||
    normalizedHost.endsWith(".phew.run")
  ) {
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
      const token = getSessionTokenFromHeaders(headers);
      return getSessionFromToken(token);
    },

    getSessionByToken: async (token: string | null): Promise<SessionRecord | null> => {
      return getSessionFromToken(token);
    },

    signOut: async ({ headers }: { headers: Headers }) => {
      const cookieToken = getSessionTokenFromHeaders(headers);
      const authHeader = headers.get("authorization");
      const bearerToken =
        authHeader && authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;

      const tokens = [...new Set([cookieToken, bearerToken].filter(Boolean) as string[])];

      if (tokens.length > 0) {
        await prisma.session.deleteMany({
          where: { token: { in: tokens } },
        });
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
