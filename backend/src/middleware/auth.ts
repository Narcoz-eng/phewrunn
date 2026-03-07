import { createMiddleware } from "hono/factory";
import { auth } from "../lib/auth.js";
import { prisma } from "../prisma.js";
import {
  appendAuthDecision,
  buildApiMeAuthTrace,
  type ApiMeAuthTrace,
} from "../lib/auth-trace.js";

// Define the user type that will be available in context
// This matches the Better Auth user structure
export interface AuthUser {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  image: string | null;
  createdAt: Date;
  updatedAt: Date;
  // SocialFi fields
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
  lastUsernameUpdate: Date | null;
  lastPhotoUpdate: Date | null;
}

// Simplified user type for routes (backwards compatible with old PrivyUser)
export interface SimpleUser {
  id: string;
  email: string | null;
  walletAddress: string | null;
  role: string | null;
  isAdmin: boolean;
  isBanned: boolean;
}

// Type for the Hono context variables
export type AuthVariables = {
  user: SimpleUser | null;
  session: Awaited<ReturnType<typeof auth.api.getSession>> | null;
  authTrace: ApiMeAuthTrace | null;
};

type AuthSession = Awaited<ReturnType<typeof auth.api.getSession>>;

const SESSION_COOKIE_PATTERN =
  /(?:^|;\s*)(?:phew\.session_token|better-auth\.session_token|auth\.session_token|session_token)=([^;]+)/i;
const AUTH_ERROR_LOG_COOLDOWN_MS = 15_000;
const authErrorLastLoggedAt = new Map<string, number>();
const SESSION_CACHE_TTL_MS = 8_000;
const SESSION_CACHE_MAX_ENTRIES = 5_000;
const sessionLookupCache = new Map<string, { expiresAt: number; session: AuthSession | null }>();

function parseBearerToken(headerValue: string | undefined): string | null {
  if (!headerValue || !/^bearer\s+/i.test(headerValue)) return null;
  const token = headerValue.replace(/^bearer\s+/i, "").trim();
  return token.length > 0 ? token : null;
}

function hasSessionCookieHeader(cookieHeader: string | undefined): boolean {
  if (!cookieHeader) return false;
  return SESSION_COOKIE_PATTERN.test(cookieHeader);
}

function shouldSkipAuthResolution(path: string): boolean {
  if (path === "/api/auth/privy-sync" || path === "/api/auth/logout") {
    return false;
  }

  return (
    path === "/health" ||
    path.startsWith("/api/auth/") ||
    path === "/api/posts/prices" ||
    path === "/api/posts/jupiter/quote" ||
    path === "/api/posts/chart/candles" ||
    path === "/api/posts/trending" ||
    /^\/api\/posts\/[^/]+\/price$/.test(path)
  );
}

function logAuthLookupError(kind: "cookie" | "bearer", error: unknown): void {
  const now = Date.now();
  const key = `auth_lookup_${kind}`;
  const lastLoggedAt = authErrorLastLoggedAt.get(key) ?? 0;
  if (now - lastLoggedAt < AUTH_ERROR_LOG_COOLDOWN_MS) {
    return;
  }
  authErrorLastLoggedAt.set(key, now);
  console.error(`Failed to resolve ${kind} session:`, error);
}

function readSessionTokenFromCookie(cookieHeader: string | undefined): string | null {
  if (!cookieHeader) return null;
  const match = cookieHeader.match(SESSION_COOKIE_PATTERN);
  const token = match?.[1]?.trim();
  if (!token) return null;
  try {
    return decodeURIComponent(token);
  } catch {
    return token;
  }
}

function readCachedSession(cacheKey: string): AuthSession | null | undefined {
  const entry = sessionLookupCache.get(cacheKey);
  if (!entry) return undefined;
  if (entry.expiresAt <= Date.now()) {
    sessionLookupCache.delete(cacheKey);
    return undefined;
  }
  return entry.session;
}

function writeCachedSession(cacheKey: string, session: AuthSession | null, ttlMs: number): void {
  if (sessionLookupCache.has(cacheKey)) {
    sessionLookupCache.delete(cacheKey);
  }
  if (sessionLookupCache.size >= SESSION_CACHE_MAX_ENTRIES) {
    const oldestKey = sessionLookupCache.keys().next().value;
    if (typeof oldestKey === "string") {
      sessionLookupCache.delete(oldestKey);
    }
  }
  sessionLookupCache.set(cacheKey, {
    session,
    expiresAt: Date.now() + ttlMs,
  });
}

export function invalidateResolvedSessionCache(tokens: string[]): void {
  for (const token of tokens) {
    sessionLookupCache.delete(`bearer:${token}`);
    sessionLookupCache.delete(`cookie:${token}`);
  }
}

/**
 * Auth middleware that verifies Better Auth sessions
 * Supports both cookie-based sessions and Bearer token auth
 * Sets user to null if no session or invalid session
 * Does NOT block requests - use requireAuth for protected routes
 */
export const betterAuthMiddleware = createMiddleware<{ Variables: AuthVariables & { requestId?: string } }>(
  async (c, next) => {
    let session: AuthSession | null = null;
    const path = c.req.path;
    const shouldTraceApiMe = path === "/api/me";
    const authTrace = shouldTraceApiMe
      ? buildApiMeAuthTrace(c.req.raw.headers, c.get("requestId") ?? null)
      : null;
    const authHeader = c.req.header("authorization") ?? c.req.header("Authorization");
    const bearerToken = parseBearerToken(authHeader);
    const cookieHeader = c.req.header("cookie");
    const hasSessionCookie = hasSessionCookieHeader(cookieHeader);
    const cookieToken = readSessionTokenFromCookie(cookieHeader);
    const cacheKey = bearerToken
      ? `bearer:${bearerToken}`
      : cookieToken
        ? `cookie:${cookieToken}`
        : null;
    let cacheHit = false;

    if (shouldSkipAuthResolution(path) || (!hasSessionCookie && !bearerToken)) {
      appendAuthDecision(authTrace, "middleware:auth_resolution_skipped_or_no_credentials");
      c.set("user", null);
      c.set("session", null);
      c.set("authTrace", authTrace);
      return next();
    }

    if (cacheKey) {
      const cachedSession = readCachedSession(cacheKey);
      if (cachedSession !== undefined) {
        session = cachedSession;
        cacheHit = true;
        appendAuthDecision(authTrace, "middleware:session_lookup_cache_hit");
      }
    }

    if (!cacheHit) {
      // First try cookie-based session.
      if (hasSessionCookie) {
        try {
          appendAuthDecision(authTrace, "middleware:cookie_session_lookup_start");
          session = await auth.api.getSession({
            headers: c.req.raw.headers,
            trace: authTrace,
          });
        } catch (error) {
          appendAuthDecision(authTrace, "middleware:cookie_session_lookup_error");
          logAuthLookupError("cookie", error);
        }
      }

      // If no cookie session, try Bearer token. Keep this separate so cookie lookup
      // failures do not automatically skip bearer auth.
      if (!session?.user && bearerToken) {
        try {
          appendAuthDecision(authTrace, "middleware:bearer_session_lookup_start");
          const bearerSession = await auth.api.getSessionByToken(bearerToken, authTrace);
          if (bearerSession?.user) {
            session = bearerSession as AuthSession;
          }
        } catch (error) {
          appendAuthDecision(authTrace, "middleware:bearer_session_lookup_error");
          logAuthLookupError("bearer", error);
        }
      }

      if (cacheKey) {
        if (session?.user) {
          writeCachedSession(cacheKey, session, SESSION_CACHE_TTL_MS);
        } else {
          sessionLookupCache.delete(cacheKey);
        }
      }
    }

    if (session?.user) {
      appendAuthDecision(authTrace, "middleware:session_resolved");
      // Create simplified user object for backwards compatibility
      const user: SimpleUser = {
        id: session.user.id,
        email: session.user.email || null,
        walletAddress: (session.user as AuthUser).walletAddress || null,
        role: (session.user as AuthUser).role || null,
        isAdmin: (session.user as AuthUser).isAdmin || false,
        isBanned: (session.user as AuthUser).isBanned || false,
      };

      c.set("user", user);
      c.set("session", session);
    } else {
      appendAuthDecision(authTrace, "middleware:session_missing");
      c.set("user", null);
      c.set("session", null);
    }

    c.set("authTrace", authTrace);

    return next();
  }
);

/**
 * Middleware that requires authentication
 * Returns 401 if no valid session
 */
export const requireAuth = createMiddleware<{ Variables: AuthVariables }>(
  async (c, next) => {
    const user = c.get("user");

    if (!user) {
      return c.json(
        { error: { message: "Unauthorized", code: "UNAUTHORIZED" } },
        401
      );
    }

    return next();
  }
);

/**
 * Middleware that blocks banned users from state-changing endpoints.
 * Always re-checks the database so admin ban changes take effect immediately.
 */
export const requireNotBanned = createMiddleware<{ Variables: AuthVariables }>(
  async (c, next) => {
    const user = c.get("user");

    if (!user) {
      return c.json(
        { error: { message: "Unauthorized", code: "UNAUTHORIZED" } },
        401
      );
    }

    if (user.isBanned) {
      return c.json(
        { error: { message: "Your account is banned", code: "ACCOUNT_BANNED" } },
        403
      );
    }

    const dbUser = await prisma.user.findUnique({
      where: { id: user.id },
      select: { isBanned: true },
    });

    if (dbUser?.isBanned) {
      return c.json(
        { error: { message: "Your account is banned", code: "ACCOUNT_BANNED" } },
        403
      );
    }

    return next();
  }
);

// Export the Better Auth instance for use in routes
export { auth };
