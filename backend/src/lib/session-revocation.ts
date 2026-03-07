import { prisma } from "../prisma.js";
import { redisGetString, redisSetString } from "./redis.js";
import type { VerifiedSignedSessionToken } from "./session-token.js";
import { verifySignedSessionToken } from "./session-token.js";

const LOCAL_REVOKED_SESSION_MAX_ENTRIES = process.env.NODE_ENV === "production" ? 20_000 : 2_000;
const SESSION_REVOCATION_IDENTIFIER = "session-revocation";
const SESSION_REVOCATION_DB_ENABLED =
  process.env.AUTH_SESSION_REVOCATION_DB_ENABLED?.trim().toLowerCase() === "true";
const SESSION_REVOCATION_LOG_COOLDOWN_MS = 15_000;

const localRevokedSessionTokens = new Map<string, number>();
let lastSessionRevocationDbWarningAt = 0;

function getRevokedSessionKey(jti: string): string {
  return `auth:revoked-session:${jti}`;
}

function cleanupExpiredLocalRevocations(now = Date.now()): void {
  for (const [jti, expiresAtMs] of localRevokedSessionTokens) {
    if (expiresAtMs <= now) {
      localRevokedSessionTokens.delete(jti);
    }
  }
}

function rememberRevokedSessionJti(jti: string, expiresAtMs: number): void {
  cleanupExpiredLocalRevocations();

  if (localRevokedSessionTokens.has(jti)) {
    localRevokedSessionTokens.delete(jti);
  }

  if (localRevokedSessionTokens.size >= LOCAL_REVOKED_SESSION_MAX_ENTRIES) {
    const oldestKey = localRevokedSessionTokens.keys().next().value;
    if (typeof oldestKey === "string") {
      localRevokedSessionTokens.delete(oldestKey);
    }
  }

  localRevokedSessionTokens.set(jti, expiresAtMs);
}

function logSessionRevocationDbWarning(stage: string, error: unknown): void {
  const now = Date.now();
  if (now - lastSessionRevocationDbWarningAt < SESSION_REVOCATION_LOG_COOLDOWN_MS) {
    return;
  }
  lastSessionRevocationDbWarningAt = now;
  console.warn(`[auth/session-revocation] ${stage} unavailable; continuing without DB persistence`, {
    message: error instanceof Error ? error.message : String(error),
  });
}

async function persistSessionRevocationToDatabase(
  jti: string,
  expiresAt: Date
): Promise<void> {
  if (!SESSION_REVOCATION_DB_ENABLED) {
    return;
  }
  await prisma.verification.create({
    data: {
      id: crypto.randomUUID().replace(/-/g, "").slice(0, 32),
      identifier: SESSION_REVOCATION_IDENTIFIER,
      value: jti,
      expiresAt,
    },
  });
}

async function readSessionRevocationFromDatabase(
  jti: string
): Promise<{ expiresAt: Date } | null> {
  if (!SESSION_REVOCATION_DB_ENABLED) {
    return null;
  }
  return await prisma.verification.findFirst({
    where: {
      identifier: SESSION_REVOCATION_IDENTIFIER,
      value: jti,
      expiresAt: { gt: new Date() },
    },
    select: {
      expiresAt: true,
    },
  });
}

export async function revokeSignedSessionToken(token: string): Promise<void> {
  const verified = verifySignedSessionToken(token);
  if (!verified) return;

  const ttlMs = verified.expiresAt.getTime() - Date.now();
  if (ttlMs <= 0) return;

  rememberRevokedSessionJti(verified.jti, verified.expiresAt.getTime());
  const results = await Promise.allSettled([
    redisSetString(getRevokedSessionKey(verified.jti), "1", ttlMs),
    persistSessionRevocationToDatabase(verified.jti, verified.expiresAt),
  ]);
  const dbResult = results[1];
  if (dbResult?.status === "rejected") {
    logSessionRevocationDbWarning("persist", dbResult.reason);
  }
}

export async function revokeSignedSessionTokens(tokens: string[]): Promise<void> {
  for (const token of tokens) {
    await revokeSignedSessionToken(token);
  }
}

export async function isSignedSessionTokenRevoked(
  verified: VerifiedSignedSessionToken | null
): Promise<boolean> {
  if (!verified) return false;

  const now = Date.now();
  cleanupExpiredLocalRevocations(now);

  const localExpiry = localRevokedSessionTokens.get(verified.jti);
  if (typeof localExpiry === "number" && localExpiry > now) {
    return true;
  }

  const redisHit = await redisGetString(getRevokedSessionKey(verified.jti)).catch(() => null);
  if (redisHit) {
    rememberRevokedSessionJti(verified.jti, verified.expiresAt.getTime());
    return true;
  }

  const dbHit = await readSessionRevocationFromDatabase(verified.jti).catch((error) => {
    logSessionRevocationDbWarning("read", error);
    return null;
  });
  if (dbHit) {
    rememberRevokedSessionJti(verified.jti, dbHit.expiresAt.getTime());
    return true;
  }

  return false;
}

export async function pruneExpiredSessionRevocations(batchSize: number): Promise<number> {
  if (!SESSION_REVOCATION_DB_ENABLED) {
    return 0;
  }
  const expiredRows = await prisma.verification.findMany({
    where: {
      identifier: SESSION_REVOCATION_IDENTIFIER,
      expiresAt: { lt: new Date() },
    },
    orderBy: { expiresAt: "asc" },
    select: { id: true },
    take: batchSize,
  });

  if (expiredRows.length === 0) {
    return 0;
  }

  const deleted = await prisma.verification.deleteMany({
    where: {
      id: {
        in: expiredRows.map((row) => row.id),
      },
    },
  });

  return deleted.count;
}
