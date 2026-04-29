import { PrismaClient, Prisma } from "@prisma/client";
import { isRedisFastForHotPath, redisGetString, redisSetString } from "./lib/redis.js";

/**
 * Database Configuration
 *
 * Production Recommendations:
 * - Use a connection pool (PgBouncer for PostgreSQL)
 * - For serverless runtimes, keep Prisma's application-side pool bounded.
 *   This deployment can run against a Supabase pooler constrained to a single
 *   connection, so request paths must avoid fan-out and heavy work.
 * - Use Supavisor/PgBouncer transaction mode for short-lived/serverless traffic.
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

function getPositiveIntEnv(name: string): number | null {
  const raw = process.env[name];
  if (!raw) return null;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
}

function resolveRuntimeConnectionLimit(configuredLimit: number | null): number {
  if (isServerlessRuntime) {
    const requestedLimit = configuredLimit ?? 1;
    const safeUpperBound = isProduction ? 5 : 5;
    return Math.max(1, Math.min(requestedLimit, safeUpperBound));
  }

  return configuredLimit ?? 1;
}

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
    const preferDirectRuntimeUrl =
      process.env.PRISMA_PREFER_DIRECT_URL?.trim().toLowerCase() === "true";
    const isPostgresProtocol =
      parsed.protocol === "postgres:" || parsed.protocol === "postgresql:";
    const isSupabaseHost =
      hostname.endsWith(".supabase.co") || hostname.endsWith(".supabase.com");
    const isPoolerHost =
      hostname.includes(".pooler.") || hostname.includes("-pooler.") || hostname.includes("pooler");
    const configuredConnectionLimit = getPositiveIntEnv("PRISMA_CONNECTION_LIMIT");
    const desiredConnectionLimit = resolveRuntimeConnectionLimit(configuredConnectionLimit);
    const configuredPoolTimeout = getPositiveIntEnv("PRISMA_POOL_TIMEOUT_SECONDS");
    const desiredPoolTimeout = configuredPoolTimeout ?? (isServerlessRuntime ? (isProduction ? 15 : 10) : (isProduction ? 8 : 10));

    const ensureSessionSafetyOptions = (target: URL, targetNotes: string[]) => {
      if (target.searchParams.has("options")) return;
      const idleTimeoutMs = isProduction ? 45_000 : 30_000;
      const lockTimeoutMs = isProduction ? 9_000 : 7_000;
      const statementTimeoutMs = isProduction ? 8_000 : 12_000;
      target.searchParams.set(
        "options",
        `-c idle_in_transaction_session_timeout=${idleTimeoutMs} -c lock_timeout=${lockTimeoutMs} -c statement_timeout=${statementTimeoutMs}`
      );
      targetNotes.push("added postgres options (idle_in_transaction_session_timeout, lock_timeout, statement_timeout)");
    };

    if (isSupabaseHost && !parsed.searchParams.has("sslmode")) {
      parsed.searchParams.set("sslmode", "require");
      notes.push("added sslmode=require");
    }

    if (isPostgresProtocol) {
      const existingConnectionLimit = Number(parsed.searchParams.get("connection_limit") ?? "");
      if (
        !Number.isFinite(existingConnectionLimit) ||
        existingConnectionLimit !== desiredConnectionLimit
      ) {
        parsed.searchParams.set("connection_limit", String(desiredConnectionLimit));
        notes.push(`set connection_limit=${desiredConnectionLimit}`);
      }
      if (
        isServerlessRuntime &&
        configuredConnectionLimit !== null &&
        configuredConnectionLimit > desiredConnectionLimit
      ) {
        notes.push(`capped PRISMA_CONNECTION_LIMIT from ${configuredConnectionLimit} to ${desiredConnectionLimit}`);
      }

      const existingPoolTimeout = Number(parsed.searchParams.get("pool_timeout") ?? "");
      if (
        !Number.isFinite(existingPoolTimeout) ||
        existingPoolTimeout !== desiredPoolTimeout
      ) {
        parsed.searchParams.set("pool_timeout", String(desiredPoolTimeout));
        notes.push(`set pool_timeout=${desiredPoolTimeout}`);
      }
    }

    // Prefer pooled DATABASE_URL by default for runtime stability.
    // DIRECT_URL can still be opted into explicitly when needed.
    if (hostname.endsWith(".pooler.supabase.com")) {
      if (preferDirectRuntimeUrl && directUrl && !directUrl.startsWith("file:")) {
        const directParsed = new URL(directUrl);
        if (directParsed.searchParams.has("sslmode") || directParsed.protocol.startsWith("postgres")) {
          if (
            directParsed.hostname.toLowerCase().endsWith(".supabase.co") ||
            directParsed.hostname.toLowerCase().endsWith(".supabase.com")
          ) {
            ensureSessionSafetyOptions(directParsed, notes);
          }
          notes.push("using DIRECT_URL for runtime queries");
          return { url: directParsed.toString(), notes };
        }
      }
      if (directUrl && !preferDirectRuntimeUrl) {
        notes.push("using pooled DATABASE_URL for runtime queries");
      }

      if (!parsed.searchParams.has("pgbouncer")) {
        parsed.searchParams.set("pgbouncer", "true");
        notes.push("added pgbouncer=true");
      }

      ensureSessionSafetyOptions(parsed, notes);
    } else if (isSupabaseHost || isPoolerHost) {
      if (isPoolerHost && !parsed.searchParams.has("pgbouncer")) {
        parsed.searchParams.set("pgbouncer", "true");
        notes.push("added pgbouncer=true");
      }
      ensureSessionSafetyOptions(parsed, notes);
    } else if (isPostgresProtocol) {
      ensureSessionSafetyOptions(parsed, notes);
    }

    return { url: parsed.toString(), notes };
  } catch {
    return { url: rawUrl, notes: [] };
  }
}

function describeDatasourceRuntime(url: string | undefined): {
  provider: "sqlite" | "postgresql";
  host: string | null;
  mode: "file" | "pooler" | "direct";
  runtime: "serverless" | "long_lived";
} | null {
  if (!url) return null;
  if (url.startsWith("file:")) {
    return {
      provider: "sqlite",
      host: null,
      mode: "file",
      runtime: isServerlessRuntime ? "serverless" : "long_lived",
    };
  }

  try {
    const parsed = new URL(url);
    return {
      provider: "postgresql",
      host: parsed.hostname || null,
      mode: parsed.hostname.toLowerCase().includes(".pooler.") ? "pooler" : "direct",
      runtime: isServerlessRuntime ? "serverless" : "long_lived",
    };
  } catch {
    return {
      provider: "postgresql",
      host: null,
      mode: "direct",
      runtime: isServerlessRuntime ? "serverless" : "long_lived",
    };
  }
}

const normalizedDb = normalizeDatabaseUrl(process.env.DATABASE_URL, process.env.DIRECT_URL);
if (normalizedDb.notes.length > 0) {
  console.warn(`[Prisma] Normalized DATABASE_URL for Supabase connection (${normalizedDb.notes.join(", ")})`);
}
const datasourceRuntime = describeDatasourceRuntime(normalizedDb.url ?? process.env.DATABASE_URL);
if (datasourceRuntime) {
  console.warn("[Prisma] Active datasource runtime", {
    ...datasourceRuntime,
    usedDirectUrlFallback: normalizedDb.notes.includes("using DIRECT_URL in non-serverless runtime"),
  });
  if (isServerlessRuntime && datasourceRuntime.provider === "postgresql" && datasourceRuntime.mode === "direct") {
    console.warn(
      "[Prisma] Serverless runtime is using a direct Postgres connection. Use Supabase transaction-mode pooler for DATABASE_URL and reserve DIRECT_URL for migrations."
    );
  }
}

type PrismaClientWithEvents = PrismaClient<Prisma.PrismaClientOptions, "query" | "warn" | "error">;

type PrismaGlobalState = {
  client?: PrismaClientWithEvents;
  listenersAttached?: boolean;
};

const prismaGlobal = globalThis as typeof globalThis & {
  __phewPrisma?: PrismaGlobalState;
};
const prismaState = prismaGlobal.__phewPrisma ??= {};

const prisma =
  prismaState.client ??
  (prismaState.client = new PrismaClient({
    ...(normalizedDb.url ? { datasources: { db: { url: normalizedDb.url } } } : {}),
    log: logConfig.map((level) => ({
      emit: "event" as const,
      level,
    })),
  }) as PrismaClientWithEvents);

const isSqlite = (normalizedDb.url || process.env.DATABASE_URL || "").startsWith("file:");
const isPostgres = !isSqlite;

const SLOW_QUERY_THRESHOLD_MS =
  getPositiveIntEnv("PRISMA_SLOW_QUERY_THRESHOLD_MS") ??
  (isProduction ? 400 : 800);
const PRISMA_OPERATION_WARN_MS =
  getPositiveIntEnv("PRISMA_OPERATION_WARN_MS") ??
  (isProduction ? 700 : 1_200);
const PRISMA_QUERY_LATENCY_WARN_MS =
  getPositiveIntEnv("PRISMA_QUERY_LATENCY_WARN_MS") ??
  SLOW_QUERY_THRESHOLD_MS;
const PRISMA_LATENCY_SUMMARY_INTERVAL_MS =
  getPositiveIntEnv("PRISMA_LATENCY_SUMMARY_INTERVAL_MS") ??
  (isProduction ? 60_000 : 15_000);
const PRISMA_LATENCY_SUMMARY_TOP_N =
  getPositiveIntEnv("PRISMA_LATENCY_SUMMARY_TOP_N") ??
  6;

type PrismaLatencyMetric = {
  count: number;
  totalDurationMs: number;
  maxDurationMs: number;
  slowCount: number;
  lastDurationMs: number;
  lastSeenAt: string;
};

const prismaLatencyMetrics = new Map<string, PrismaLatencyMetric>();
let lastPrismaLatencySummaryAt = Date.now();

function normalizeQuerySnippet(query: string): string {
  return query.replace(/\s+/g, " ").trim();
}

function inferPrismaQueryLabel(query: string): string {
  const snippet = normalizeQuerySnippet(query);
  if (!snippet) return "unknown";

  const commandMatch = snippet.match(/^[a-z]+/i);
  const command = commandMatch?.[0]?.toLowerCase() ?? "raw";
  const tableName =
    snippet.match(/\bfrom\s+"([^"]+)"/i)?.[1] ??
    snippet.match(/\bupdate\s+"([^"]+)"/i)?.[1] ??
    snippet.match(/\binto\s+"([^"]+)"/i)?.[1] ??
    snippet.match(/\bjoin\s+"([^"]+)"/i)?.[1] ??
    null;

  return tableName ? `${command}.${tableName}` : command;
}

function flushPrismaLatencySummaryIfDue(nowMs: number): void {
  if (nowMs - lastPrismaLatencySummaryAt < PRISMA_LATENCY_SUMMARY_INTERVAL_MS) {
    return;
  }

  const summaryWindowMs = nowMs - lastPrismaLatencySummaryAt;
  lastPrismaLatencySummaryAt = nowMs;

  if (prismaLatencyMetrics.size === 0) {
    return;
  }

  const topOperations = Array.from(prismaLatencyMetrics.entries())
    .map(([label, metric]) => ({
      label,
      count: metric.count,
      avgDurationMs: Math.round(metric.totalDurationMs / Math.max(metric.count, 1)),
      maxDurationMs: metric.maxDurationMs,
      slowCount: metric.slowCount,
      lastDurationMs: metric.lastDurationMs,
      lastSeenAt: metric.lastSeenAt,
    }))
    .sort((a, b) => {
      if (b.maxDurationMs !== a.maxDurationMs) {
        return b.maxDurationMs - a.maxDurationMs;
      }
      if (b.avgDurationMs !== a.avgDurationMs) {
        return b.avgDurationMs - a.avgDurationMs;
      }
      return b.count - a.count;
    })
    .slice(0, PRISMA_LATENCY_SUMMARY_TOP_N);

  console.warn("[Prisma] Query latency summary", {
    windowMs: summaryWindowMs,
    trackedOperations: prismaLatencyMetrics.size,
    datasourceMode: datasourceRuntime?.mode ?? null,
    topOperations,
  });

  prismaLatencyMetrics.clear();
}

if (!prismaState.listenersAttached) {
  prisma.$on("query", (e: Prisma.QueryEvent) => {
    const nowMs = Date.now();
    const label = inferPrismaQueryLabel(e.query);
    const metric = prismaLatencyMetrics.get(label) ?? {
      count: 0,
      totalDurationMs: 0,
      maxDurationMs: 0,
      slowCount: 0,
      lastDurationMs: 0,
      lastSeenAt: new Date(nowMs).toISOString(),
    };

    metric.count += 1;
    metric.totalDurationMs += e.duration;
    metric.maxDurationMs = Math.max(metric.maxDurationMs, e.duration);
    metric.lastDurationMs = e.duration;
    metric.lastSeenAt = new Date(nowMs).toISOString();
    if (e.duration >= PRISMA_QUERY_LATENCY_WARN_MS) {
      metric.slowCount += 1;
    }
    prismaLatencyMetrics.set(label, metric);

    if (isProduction) {
      // In production, only log slow queries
      if (e.duration >= PRISMA_QUERY_LATENCY_WARN_MS) {
        console.warn("[Prisma] Slow query", {
          label,
          timestamp: new Date(nowMs).toISOString(),
          durationMs: e.duration,
          target: e.target,
          datasourceMode: datasourceRuntime?.mode ?? null,
          query: normalizeQuerySnippet(e.query).substring(0, 200),
        });
      }
    } else {
      // In development, log all queries
      console.log(`[Prisma Query] ${e.query} - ${e.duration}ms`);
    }

    flushPrismaLatencySummaryIfDue(nowMs);
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

  prismaState.listenersAttached = true;
}

// IMPORTANT: SQLite optimizations for local file databases only
async function initSqlitePragmas(prisma: PrismaClient) {
  await prisma.$queryRawUnsafe("PRAGMA journal_mode = WAL;");
  await prisma.$queryRawUnsafe("PRAGMA foreign_keys = ON;");
  await prisma.$queryRawUnsafe("PRAGMA busy_timeout = 10000;");
  await prisma.$queryRawUnsafe("PRAGMA synchronous = NORMAL;");
}

let prismaReadyPromise: Promise<void> | null = null;
const PRISMA_PRESSURE_COOLDOWN_MS =
  getPositiveIntEnv("PRISMA_PRESSURE_COOLDOWN_MS") ??
  (isProduction ? 15_000 : 5_000);
const PRISMA_PRESSURE_LOG_COOLDOWN_MS =
  getPositiveIntEnv("PRISMA_PRESSURE_LOG_COOLDOWN_MS") ??
  (isProduction ? 5_000 : 2_000);
const PRISMA_PRESSURE_SHARED_CACHE_TTL_MS =
  getPositiveIntEnv("PRISMA_PRESSURE_SHARED_CACHE_TTL_MS") ??
  (isProduction ? 1_500 : 500);
const PRISMA_PRESSURE_PUBLISH_COOLDOWN_MS =
  getPositiveIntEnv("PRISMA_PRESSURE_PUBLISH_COOLDOWN_MS") ??
  (isProduction ? 1_000 : 300);
const PRISMA_PRESSURE_REDIS_KEY = "prisma:pool-pressure:v1";
let prismaPressureUntilMs = 0;
let prismaPressureLastReason: string | null = null;
let prismaPressureLastLoggedAt = 0;
let prismaPressureLastPublishedAt = 0;
let prismaPressureSharedStateCache:
  | {
      active: boolean;
      expiresAtMs: number;
    }
  | null = null;

async function initializePrismaRuntime(): Promise<void> {
  await prisma.$connect();

  if (isSqlite) {
    await initSqlitePragmas(prisma);
  }
}

function ensurePrismaReady(): Promise<void> {
  if (prismaReadyPromise) {
    return prismaReadyPromise;
  }

  prismaReadyPromise = initializePrismaRuntime().catch((error) => {
    prismaReadyPromise = null;
    throw error;
  });

  return prismaReadyPromise;
}

void ensurePrismaReady().catch((error) => {
  console.warn("[Prisma] Startup initialization failed:", error);
});

/**
 * Retry wrapper for transient Prisma connectivity errors (pool exhaustion, timeouts).
 * Retries up to `maxRetries` times with exponential backoff.
 */
async function withPrismaRetry<T>(
  fn: () => Promise<T>,
  opts?: { maxRetries?: number; baseDelayMs?: number; label?: string }
): Promise<T> {
  const maxRetries = opts?.maxRetries ?? ((isProduction && isServerlessRuntime) ? 0 : 2);
  const baseDelayMs = opts?.baseDelayMs ?? 150;
  let lastError: unknown;
  const startedAtMs = Date.now();

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const attemptStartedAtMs = Date.now();
    try {
      const result = await fn();
      const totalDurationMs = Date.now() - startedAtMs;
      if (opts?.label && totalDurationMs >= PRISMA_OPERATION_WARN_MS) {
        console.warn("[Prisma] Slow operation", {
          label: opts.label,
          durationMs: totalDurationMs,
          attempts: attempt + 1,
          attemptDurationMs: Date.now() - attemptStartedAtMs,
        });
      }
      return result;
    } catch (error) {
      lastError = error;
      const isTransient = isTransientPrismaError(error);
      if (isTransient) {
        markPrismaPressure(error, opts?.label);
      }
      const attemptDurationMs = Date.now() - attemptStartedAtMs;
      const totalDurationMs = Date.now() - startedAtMs;
      if (!isTransient || attempt >= maxRetries) {
        if (opts?.label && totalDurationMs >= PRISMA_OPERATION_WARN_MS) {
          console.warn("[Prisma] Slow failed operation", {
            label: opts.label,
            durationMs: totalDurationMs,
            attempts: attempt + 1,
            attemptDurationMs,
            transient: isTransient,
            message: error instanceof Error ? error.message : String(error),
          });
        }
        throw error;
      }
      const delayMs = baseDelayMs * Math.pow(2, attempt);
      if (opts?.label) {
        console.warn(`[Prisma] Retrying ${opts.label} (attempt ${attempt + 1}/${maxRetries}) after ${delayMs}ms`, {
          message: error instanceof Error ? error.message : String(error),
          attemptDurationMs,
          totalDurationMs,
        });
      }
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  throw lastError;
}

function setLocalPrismaPressure(reason: string, untilMs = Date.now() + PRISMA_PRESSURE_COOLDOWN_MS): void {
  const now = Date.now();
  prismaPressureUntilMs = Math.max(prismaPressureUntilMs, untilMs);
  prismaPressureLastReason = reason;
  prismaPressureSharedStateCache = {
    active: true,
    expiresAtMs: Math.min(prismaPressureUntilMs, now + PRISMA_PRESSURE_SHARED_CACHE_TTL_MS),
  };

  if (now - prismaPressureLastLoggedAt >= PRISMA_PRESSURE_LOG_COOLDOWN_MS) {
    prismaPressureLastLoggedAt = now;
    console.warn("[Prisma] Pool-pressure guard active", {
      label: null,
      cooldownMs: PRISMA_PRESSURE_COOLDOWN_MS,
      until: new Date(prismaPressureUntilMs).toISOString(),
      reason: prismaPressureLastReason,
    });
  }
}

function publishSharedPrismaPressure(reason: string): void {
  if (!isRedisFastForHotPath()) {
    return;
  }

  const now = Date.now();
  if (now - prismaPressureLastPublishedAt < PRISMA_PRESSURE_PUBLISH_COOLDOWN_MS) {
    return;
  }
  prismaPressureLastPublishedAt = now;

  void redisSetString(
    PRISMA_PRESSURE_REDIS_KEY,
    JSON.stringify({
      reason,
      untilMs: prismaPressureUntilMs,
    }),
    Math.max(PRISMA_PRESSURE_COOLDOWN_MS, Math.max(1_000, prismaPressureUntilMs - now))
  );
}

function markPrismaPressure(error: unknown, label?: string): void {
  if (!isTransientPrismaError(error)) {
    return;
  }

  const reason =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : label ?? "transient_prisma_error";
  setLocalPrismaPressure(reason);
  publishSharedPrismaPressure(reason);
}

function notePrismaPoolPressure(reason: string): void {
  setLocalPrismaPressure(reason);
  publishSharedPrismaPressure(reason);
}

async function isPrismaPoolPressureActive(): Promise<boolean> {
  const now = Date.now();
  if (now < prismaPressureUntilMs) {
    return true;
  }

  if (prismaPressureSharedStateCache && prismaPressureSharedStateCache.expiresAtMs > now) {
    return prismaPressureSharedStateCache.active;
  }

  if (!isRedisFastForHotPath()) {
    prismaPressureSharedStateCache = {
      active: false,
      expiresAtMs: now + PRISMA_PRESSURE_SHARED_CACHE_TTL_MS,
    };
    return false;
  }

  try {
    const raw = await redisGetString(PRISMA_PRESSURE_REDIS_KEY);
    if (!raw) {
      prismaPressureSharedStateCache = {
        active: false,
        expiresAtMs: now + PRISMA_PRESSURE_SHARED_CACHE_TTL_MS,
      };
      return false;
    }

    const parsed = JSON.parse(raw) as {
      untilMs?: unknown;
      reason?: unknown;
    };
    const untilMs =
      typeof parsed.untilMs === "number" && Number.isFinite(parsed.untilMs)
        ? parsed.untilMs
        : 0;
    const active = untilMs > now;
    if (active) {
      prismaPressureUntilMs = Math.max(prismaPressureUntilMs, untilMs);
      prismaPressureLastReason =
        typeof parsed.reason === "string" && parsed.reason.trim()
          ? parsed.reason
          : prismaPressureLastReason;
    }

    prismaPressureSharedStateCache = {
      active,
      expiresAtMs: active
        ? Math.min(untilMs, now + PRISMA_PRESSURE_SHARED_CACHE_TTL_MS)
        : now + PRISMA_PRESSURE_SHARED_CACHE_TTL_MS,
    };
    return active;
  } catch {
    prismaPressureSharedStateCache = {
      active: false,
      expiresAtMs: now + PRISMA_PRESSURE_SHARED_CACHE_TTL_MS,
    };
    return false;
  }
}

function isTransientPrismaError(error: unknown): boolean {
  const code =
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof (error as { code?: unknown }).code === "string"
      ? (error as { code: string }).code
      : "";

  // P1001/P1002 = database unreachable/timeout, P1008 = query timeout,
  // P1017 = server closed connection, P2024 = pool timeout
  if (
    code === "P1001" ||
    code === "P1002" ||
    code === "P1008" ||
    code === "P1017" ||
    code === "P2024"
  ) {
    return true;
  }

  const message =
    error instanceof Error ? error.message : typeof error === "string" ? error : "";

  return /timed out|connection pool|pool timeout|econnreset|etimedout|connection.*closed|server closed|transaction already closed|expired transaction/i.test(
    message
  );
}

export {
  prisma,
  ensurePrismaReady,
  withPrismaRetry,
  isTransientPrismaError,
  isPrismaPoolPressureActive,
  notePrismaPoolPressure,
};
