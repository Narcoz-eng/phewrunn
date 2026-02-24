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

function normalizeDatabaseUrl(rawUrl: string | undefined): { url: string | undefined; notes: string[] } {
  if (!rawUrl) return { url: rawUrl, notes: [] };
  if (rawUrl.startsWith("file:")) return { url: rawUrl, notes: [] };

  try {
    const parsed = new URL(rawUrl);
    const hostname = parsed.hostname.toLowerCase();
    const notes: string[] = [];

    // Supabase transaction pooler is very sensitive in serverless environments.
    if (hostname.endsWith(".pooler.supabase.com")) {
      if (!parsed.searchParams.has("pgbouncer")) {
        parsed.searchParams.set("pgbouncer", "true");
        notes.push("added pgbouncer=true");
      }
      if (!parsed.searchParams.has("connection_limit")) {
        parsed.searchParams.set("connection_limit", "1");
        notes.push("added connection_limit=1");
      }
      if (!parsed.searchParams.has("sslmode")) {
        parsed.searchParams.set("sslmode", "require");
        notes.push("added sslmode=require");
      }
    }

    return { url: parsed.toString(), notes };
  } catch {
    return { url: rawUrl, notes: [] };
  }
}

const normalizedDb = normalizeDatabaseUrl(process.env.DATABASE_URL);
if (normalizedDb.notes.length > 0) {
  console.warn(`[Prisma] Normalized DATABASE_URL for Supabase pooler (${normalizedDb.notes.join(", ")})`);
}

const prisma = new PrismaClient({
  ...(normalizedDb.url ? { datasources: { db: { url: normalizedDb.url } } } : {}),
  log: logConfig.map((level) => ({
    emit: "event" as const,
    level,
  })),
});

const isSqlite = (normalizedDb.url || process.env.DATABASE_URL || "").startsWith("file:");

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
    console.error("[Prisma] Hint: Supabase pooler URL should include pgbouncer=true and connection_limit=1");
  }
});

// IMPORTANT: SQLite optimizations for local file databases only
async function initSqlitePragmas(prisma: PrismaClient) {
  await prisma.$queryRawUnsafe("PRAGMA journal_mode = WAL;");
  await prisma.$queryRawUnsafe("PRAGMA foreign_keys = ON;");
  await prisma.$queryRawUnsafe("PRAGMA busy_timeout = 10000;");
  await prisma.$queryRawUnsafe("PRAGMA synchronous = NORMAL;");
}

if (isSqlite) {
  initSqlitePragmas(prisma).catch((error) => {
    console.warn("[Prisma] Failed to apply SQLite PRAGMAs:", error);
  });
}

export { prisma };
