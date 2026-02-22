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

const prisma = new PrismaClient({
  log: logConfig.map((level) => ({
    emit: "event" as const,
    level,
  })),
});

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
});

// IMPORTANT: SQLite optimizations for better performance
async function initSqlitePragmas(prisma: PrismaClient) {
  await prisma.$queryRawUnsafe("PRAGMA journal_mode = WAL;");
  await prisma.$queryRawUnsafe("PRAGMA foreign_keys = ON;");
  await prisma.$queryRawUnsafe("PRAGMA busy_timeout = 10000;");
  await prisma.$queryRawUnsafe("PRAGMA synchronous = NORMAL;");
}

initSqlitePragmas(prisma);

export { prisma };
