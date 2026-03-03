import { PrismaClient, Prisma } from "@prisma/client";

/**
 * Database Configuration
 *
 * Production Recommendations:
 * - Use a connection pool (PgBouncer for PostgreSQL)
 * - Set appropriate pool size based on your workload:
 *   - connection_limit = (num_physical_cores * 2) + effective_spindle_count
 *   - For most cloud instances: 10-20 connections per instance
 * - Enable SSL for production databases
 * - Use read replicas for read-heavy workloads
 */

// Determine log levels based on environment
const isProduction = process.env.NODE_ENV === "production";

// In production, only log warnings and errors. In development, log queries too.
const logConfig: Prisma.LogLevel[] = isProduction
  ? ["warn", "error"]
  : ["query", "warn", "error"];

const isServerlessRuntime =
  !!process.env.VERCEL ||
  !!process.env.AWS_LAMBDA_FUNCTION_NAME ||
  !!process.env.K_SERVICE ||
  !!process.env.FUNCTIONS_WORKER_RUNTIME;

function normalizeDatabaseUrl(
  rawUrl: string | undefined,
  directUrl: string | undefined
): { url: string | undefined; notes: string[] } {
  if (!rawUrl) return { url: rawUrl, notes: [] };
  if (rawUrl.startsWith("file:")) return { url: rawUrl, notes: [] };

  try {
    const parsed = new URL(rawUrl);
    const hostname = parsed.hostname.toLowerCase();
    const notes: string[] = [];
    const isSupabaseHost =
      hostname.endsWith(".supabase.co") || hostname.endsWith(".supabase.com");

    const ensureSessionSafetyOptions = (target: URL, targetNotes: string[]) => {
      if (target.searchParams.has("options")) return;
      const idleTimeoutMs = isProduction ? 45_000 : 30_000;
      const lockTimeoutMs = isProduction ? 9_000 : 7_000;
      target.searchParams.set(
        "options",
        `-c idle_in_transaction_session_timeout=${idleTimeoutMs} -c lock_timeout=${lockTimeoutMs}`
      );
      targetNotes.push("added postgres options (idle_in_transaction_session_timeout, lock_timeout)");
    };

    if (isSupabaseHost && !parsed.searchParams.has("sslmode")) {
      parsed.searchParams.set("sslmode", "require");
      notes.push("added sslmode=require");
    }

    // Supabase transaction pooler is ideal in serverless.
    // In long-lived runtimes (Bun/Node servers), DIRECT_URL is usually more stable.
    if (hostname.endsWith(".pooler.supabase.com")) {
      if (!isServerlessRuntime && directUrl && !directUrl.startsWith("file:")) {
        const directParsed = new URL(directUrl);
        if (directParsed.searchParams.has("sslmode") || directParsed.protocol.startsWith("postgres")) {
          if (
            directParsed.hostname.toLowerCase().endsWith(".supabase.co") ||
            directParsed.hostname.toLowerCase().endsWith(".supabase.com")
          ) {
            ensureSessionSafetyOptions(directParsed, notes);
          }
          notes.push("using DIRECT_URL in non-serverless runtime");
          return { url: directParsed.toString(), notes };
        }
      }

      if (!parsed.searchParams.has("pgbouncer")) {
        parsed.searchParams.set("pgbouncer", "true");
        notes.push("added pgbouncer=true");
      }

      const desiredConnectionLimit = isServerlessRuntime ? 1 : (isProduction ? 5 : 8);
      const existingConnectionLimit = Number(parsed.searchParams.get("connection_limit") ?? "");
      if (!Number.isFinite(existingConnectionLimit) || existingConnectionLimit < desiredConnectionLimit) {
        parsed.searchParams.set("connection_limit", String(desiredConnectionLimit));
        notes.push(`set connection_limit=${desiredConnectionLimit}`);
      }

      // Fail fast instead of hanging feed/auth when the pool is saturated.
      if (!parsed.searchParams.has("pool_timeout")) {
        parsed.searchParams.set("pool_timeout", "5");
        notes.push("added pool_timeout=5");
      }

      ensureSessionSafetyOptions(parsed, notes);
    } else if (isSupabaseHost) {
      ensureSessionSafetyOptions(parsed, notes);
    }

    return { url: parsed.toString(), notes };
  } catch {
    return { url: rawUrl, notes: [] };
  }
}

const normalizedDb = normalizeDatabaseUrl(process.env.DATABASE_URL, process.env.DIRECT_URL);
if (normalizedDb.notes.length > 0) {
  console.warn(`[Prisma] Normalized DATABASE_URL for Supabase connection (${normalizedDb.notes.join(", ")})`);
}

const prisma = new PrismaClient({
  ...(normalizedDb.url ? { datasources: { db: { url: normalizedDb.url } } } : {}),
  log: logConfig.map((level) => ({
    emit: "event" as const,
    level,
  })),
});

const isSqlite = (normalizedDb.url || process.env.DATABASE_URL || "").startsWith("file:");
const isPostgres = !isSqlite;

// Log slow queries in production (queries taking > 1 second)
const SLOW_QUERY_THRESHOLD_MS = 1000;

prisma.$on("query", (e: Prisma.QueryEvent) => {
  if (isProduction) {
    // In production, only log slow queries
    if (e.duration > SLOW_QUERY_THRESHOLD_MS) {
      console.warn(
        JSON.stringify({
          type: "slow_query",
          timestamp: new Date().toISOString(),
          duration: e.duration,
          query: e.query.substring(0, 200), // Truncate long queries
          // Don't log params in production (may contain sensitive data)
        })
      );
    }
  } else {
    // In development, log all queries
    console.log(`[Prisma Query] ${e.query} - ${e.duration}ms`);
  }
});

// Log warnings
prisma.$on("warn", (e: Prisma.LogEvent) => {
  console.warn(`[Prisma Warning] ${e.message}`);
});

// Log errors
prisma.$on("error", (e: Prisma.LogEvent) => {
  console.error(`[Prisma Error] ${e.message}`);
  if (e.message.toLowerCase().includes("prepared statement")) {
    console.error("[Prisma] Hint: Supabase pooler URL should include pgbouncer=true and a suitable connection_limit/pool_timeout");
  }
});

// IMPORTANT: SQLite optimizations for local file databases only
async function initSqlitePragmas(prisma: PrismaClient) {
  await prisma.$queryRawUnsafe("PRAGMA journal_mode = WAL;");
  await prisma.$queryRawUnsafe("PRAGMA foreign_keys = ON;");
  await prisma.$queryRawUnsafe("PRAGMA busy_timeout = 10000;");
  await prisma.$queryRawUnsafe("PRAGMA synchronous = NORMAL;");
}

// Compatibility guard for deployed environments where DB schema may lag behind code.
// Keeps critical read/write paths alive until migrations are applied.
async function initPostgresCompatColumns(prisma: PrismaClient) {
  const statements = [
    `ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "tradeFeeRewardsEnabled" BOOLEAN NOT NULL DEFAULT true;`,
    `ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "tradeFeeShareBps" INTEGER NOT NULL DEFAULT 100;`,
    `ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "tradeFeePayoutAddress" TEXT;`,
    `ALTER TABLE "Notification" ADD COLUMN IF NOT EXISTS "dismissed" BOOLEAN NOT NULL DEFAULT false;`,
    `ALTER TABLE "Notification" ADD COLUMN IF NOT EXISTS "clickedAt" TIMESTAMP(3);`,
  ] as const;

  for (const statement of statements) {
    await prisma.$executeRawUnsafe(statement);
  }
}

if (isSqlite) {
  initSqlitePragmas(prisma).catch((error) => {
    console.warn("[Prisma] Failed to apply SQLite PRAGMAs:", error);
  });
} else if (isPostgres) {
  initPostgresCompatColumns(prisma)
    .then(() => {
      console.log("[Prisma] Postgres compatibility columns check complete");
    })
    .catch((error) => {
      console.warn("[Prisma] Failed to apply compatibility column guardrails:", error);
    });
}

export { prisma };
