import { createMiddleware } from "hono/factory";
import { prisma } from "../prisma.js";
import type { AuthVariables } from "./auth.js";

const LOAD_SIM_AUTH_HEADER = "x-load-sim-user-id";
const LOAD_SIM_SECRET_HEADER = "x-load-sim-secret";
const LOAD_SIM_SESSION_CACHE_TTL_MS = 15_000;
const LOAD_SIM_SESSION_CACHE_MAX_ENTRIES = 1_000;

type LoadSimSession = NonNullable<AuthVariables["session"]>;
type LoadSimUserRecord = {
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

const loadSimSessionCache = new Map<string, { expiresAtMs: number; session: LoadSimSession | null }>();

function trimLoadSimSessionCache(): void {
  while (loadSimSessionCache.size >= LOAD_SIM_SESSION_CACHE_MAX_ENTRIES) {
    const oldestKey = loadSimSessionCache.keys().next().value;
    if (typeof oldestKey !== "string") {
      break;
    }
    loadSimSessionCache.delete(oldestKey);
  }
}

function readCachedLoadSimSession(userId: string): LoadSimSession | null | undefined {
  const cached = loadSimSessionCache.get(userId);
  if (!cached) {
    return undefined;
  }
  if (cached.expiresAtMs <= Date.now()) {
    loadSimSessionCache.delete(userId);
    return undefined;
  }
  return cached.session;
}

function writeCachedLoadSimSession(userId: string, session: LoadSimSession | null): void {
  if (loadSimSessionCache.has(userId)) {
    loadSimSessionCache.delete(userId);
  }
  trimLoadSimSessionCache();
  loadSimSessionCache.set(userId, {
    session,
    expiresAtMs: Date.now() + LOAD_SIM_SESSION_CACHE_TTL_MS,
  });
}

function isLoadSimAuthEnabled(): boolean {
  return process.env.NODE_ENV !== "production" && Boolean(process.env.LOAD_SIM_INTERNAL_AUTH_SECRET?.trim());
}

async function resolveLoadSimSession(userId: string): Promise<LoadSimSession | null> {
  const cached = readCachedLoadSimSession(userId);
  if (cached !== undefined) {
    return cached;
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
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
    },
  }) as LoadSimUserRecord | null;

  if (!user) {
    writeCachedLoadSimSession(userId, null);
    return null;
  }

  const now = new Date();
  const session = {
    session: {
      id: `load-sim:${user.id}`,
      userId: user.id,
      token: `load-sim:${user.id}`,
      expiresAt: new Date(now.getTime() + 60 * 60 * 1000),
      createdAt: now,
      updatedAt: now,
    },
    user,
  } as LoadSimSession;

  writeCachedLoadSimSession(userId, session);
  return session;
}

export const loadSimAuthMiddleware = createMiddleware<{
  Variables: AuthVariables & { requestId?: string };
}>(async (c, next) => {
  if (!isLoadSimAuthEnabled() || c.get("user")) {
    return next();
  }

  const providedSecret = c.req.header(LOAD_SIM_SECRET_HEADER)?.trim();
  const expectedSecret = process.env.LOAD_SIM_INTERNAL_AUTH_SECRET?.trim();
  if (!providedSecret || !expectedSecret || providedSecret !== expectedSecret) {
    return next();
  }

  const requestedUserId = c.req.header(LOAD_SIM_AUTH_HEADER)?.trim();
  if (!requestedUserId) {
    return next();
  }

  try {
    const session = await resolveLoadSimSession(requestedUserId);
    if (!session?.user) {
      return next();
    }

    c.set("session", session);
    c.set("user", {
      id: session.user.id,
      email: session.user.email || null,
      walletAddress: session.user.walletAddress || null,
      role: session.user.role || null,
      isAdmin: session.user.isAdmin || false,
      isBanned: session.user.isBanned || false,
    });
  } catch (error) {
    console.warn("[load-sim-auth] failed to resolve simulated user", {
      userId: requestedUserId,
      message: error instanceof Error ? error.message : String(error),
    });
  }

  return next();
});
