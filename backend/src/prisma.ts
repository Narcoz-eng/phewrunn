import { PrismaClient, Prisma } from "@prisma/client";

/**
 * Database Configuration
 *
 * Production Recommendations:
 * - Use a connection pool (PgBouncer for PostgreSQL)
 * - For serverless runtimes, keep Prisma's application-side pool tiny.
 *   Start with connection_limit=1 and only increase after measuring pool pressure.
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
    const isSupabaseHost =
      hostname.endsWith(".supabase.co") || hostname.endsWith(".supabase.com");
    const configuredConnectionLimit = getPositiveIntEnv("PRISMA_CONNECTION_LIMIT");
    const desiredConnectionLimit = isServerlessRuntime
      ? (configuredConnectionLimit ?? 1)
      : (configuredConnectionLimit ?? (isProduction ? 10 : 5));
    const configuredPoolTimeout = getPositiveIntEnv("PRISMA_POOL_TIMEOUT_SECONDS");
    const desiredPoolTimeout = isServerlessRuntime
      ? Math.min(configuredPoolTimeout ?? (isProduction ? 10 : 8), 10)
      : (configuredPoolTimeout ?? (isProduction ? 8 : 10));

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

    if (isSupabaseHost) {
      const existingConnectionLimit = Number(parsed.searchParams.get("connection_limit") ?? "");
      if (
        !Number.isFinite(existingConnectionLimit) ||
        existingConnectionLimit !== desiredConnectionLimit
      ) {
        parsed.searchParams.set("connection_limit", String(desiredConnectionLimit));
        notes.push(`set connection_limit=${desiredConnectionLimit}`);
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
    } else if (isSupabaseHost) {
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

const prisma = new PrismaClient({
  ...(normalizedDb.url ? { datasources: { db: { url: normalizedDb.url } } } : {}),
  log: logConfig.map((level) => ({
    emit: "event" as const,
    level,
  })),
});

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
    `CREATE EXTENSION IF NOT EXISTS pg_trgm;`,
    `ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "tradeFeeRewardsEnabled" BOOLEAN NOT NULL DEFAULT true;`,
    `ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "tradeFeeShareBps" INTEGER NOT NULL DEFAULT 50;`,
    `ALTER TABLE "User" ALTER COLUMN "tradeFeeShareBps" SET DEFAULT 50;`,
    `ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "tradeFeePayoutAddress" TEXT;`,
    `ALTER TABLE "Post" ADD COLUMN IF NOT EXISTS "dexscreenerUrl" TEXT;`,
    `ALTER TABLE "Post" ADD COLUMN IF NOT EXISTS "tokenSymbol" TEXT;`,
    `ALTER TABLE "Post" ADD COLUMN IF NOT EXISTS "tokenName" TEXT;`,
    `ALTER TABLE "Post" ADD COLUMN IF NOT EXISTS "tokenImage" TEXT;`,
    `ALTER TABLE "Post" ADD COLUMN IF NOT EXISTS "mcap1h" DOUBLE PRECISION;`,
    `ALTER TABLE "Post" ADD COLUMN IF NOT EXISTS "mcap6h" DOUBLE PRECISION;`,
    `ALTER TABLE "Post" ADD COLUMN IF NOT EXISTS "isWin1h" BOOLEAN;`,
    `ALTER TABLE "Post" ADD COLUMN IF NOT EXISTS "isWin6h" BOOLEAN;`,
    `ALTER TABLE "Post" ADD COLUMN IF NOT EXISTS "percentChange1h" DOUBLE PRECISION;`,
    `ALTER TABLE "Post" ADD COLUMN IF NOT EXISTS "percentChange6h" DOUBLE PRECISION;`,
    `ALTER TABLE "Post" ADD COLUMN IF NOT EXISTS "recoveryEligible" BOOLEAN;`,
    `ALTER TABLE "Post" ADD COLUMN IF NOT EXISTS "settled6h" BOOLEAN NOT NULL DEFAULT false;`,
    `ALTER TABLE "Post" ADD COLUMN IF NOT EXISTS "levelChange1h" INTEGER;`,
    `ALTER TABLE "Post" ADD COLUMN IF NOT EXISTS "levelChange6h" INTEGER;`,
    `ALTER TABLE "Post" ADD COLUMN IF NOT EXISTS "viewCount" INTEGER NOT NULL DEFAULT 0;`,
    `ALTER TABLE "Post" ADD COLUMN IF NOT EXISTS "trackingMode" TEXT;`,
    `ALTER TABLE "Post" ADD COLUMN IF NOT EXISTS "lastMcapUpdate" TIMESTAMP(3);`,
    `ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "walletProvider" TEXT;`,
    `ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "walletConnectedAt" TIMESTAMP(3);`,
    `ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "bio" TEXT;`,
    `ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "isVerified" BOOLEAN NOT NULL DEFAULT false;`,
    `ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "lastUsernameUpdate" TIMESTAMP(3);`,
    `ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "lastPhotoUpdate" TIMESTAMP(3);`,
    `ALTER TABLE "Notification" ADD COLUMN IF NOT EXISTS "dismissed" BOOLEAN NOT NULL DEFAULT false;`,
    `ALTER TABLE "Notification" ADD COLUMN IF NOT EXISTS "clickedAt" TIMESTAMP(3);`,
    `ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "winRate7d" DOUBLE PRECISION;`,
    `ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "winRate30d" DOUBLE PRECISION;`,
    `ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "avgRoi7d" DOUBLE PRECISION;`,
    `ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "avgRoi30d" DOUBLE PRECISION;`,
    `ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "trustScore" DOUBLE PRECISION;`,
    `ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "reputationTier" TEXT;`,
    `ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "firstCallCount" INTEGER NOT NULL DEFAULT 0;`,
    `ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "firstCallAvgRoi" DOUBLE PRECISION;`,
    `ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "lastTraderMetricsAt" TIMESTAMP(3);`,
    `ALTER TABLE "Post" ADD COLUMN IF NOT EXISTS "tokenId" TEXT;`,
    `ALTER TABLE "Post" ADD COLUMN IF NOT EXISTS "confidenceScore" DOUBLE PRECISION;`,
    `ALTER TABLE "Post" ADD COLUMN IF NOT EXISTS "hotAlphaScore" DOUBLE PRECISION;`,
    `ALTER TABLE "Post" ADD COLUMN IF NOT EXISTS "earlyRunnerScore" DOUBLE PRECISION;`,
    `ALTER TABLE "Post" ADD COLUMN IF NOT EXISTS "highConvictionScore" DOUBLE PRECISION;`,
    `ALTER TABLE "Post" ADD COLUMN IF NOT EXISTS "timingTier" TEXT;`,
    `ALTER TABLE "Post" ADD COLUMN IF NOT EXISTS "firstCallerRank" INTEGER;`,
    `ALTER TABLE "Post" ADD COLUMN IF NOT EXISTS "roiPeakPct" DOUBLE PRECISION;`,
    `ALTER TABLE "Post" ADD COLUMN IF NOT EXISTS "roiCurrentPct" DOUBLE PRECISION;`,
    `ALTER TABLE "Post" ADD COLUMN IF NOT EXISTS "threadCount" INTEGER NOT NULL DEFAULT 0;`,
    `ALTER TABLE "Post" ADD COLUMN IF NOT EXISTS "reactionCounts" JSONB;`,
    `ALTER TABLE "Post" ADD COLUMN IF NOT EXISTS "trustedTraderCount" INTEGER NOT NULL DEFAULT 0;`,
    `ALTER TABLE "Post" ADD COLUMN IF NOT EXISTS "entryQualityScore" DOUBLE PRECISION;`,
    `ALTER TABLE "Post" ADD COLUMN IF NOT EXISTS "bundlePenaltyScore" DOUBLE PRECISION;`,
    `ALTER TABLE "Post" ADD COLUMN IF NOT EXISTS "sentimentScore" DOUBLE PRECISION;`,
    `ALTER TABLE "Post" ADD COLUMN IF NOT EXISTS "lastIntelligenceAt" TIMESTAMP(3);`,
    `ALTER TABLE "Comment" ADD COLUMN IF NOT EXISTS "parentId" TEXT;`,
    `ALTER TABLE "Comment" ADD COLUMN IF NOT EXISTS "rootId" TEXT;`,
    `ALTER TABLE "Comment" ADD COLUMN IF NOT EXISTS "depth" INTEGER NOT NULL DEFAULT 0;`,
    `ALTER TABLE "Comment" ADD COLUMN IF NOT EXISTS "kind" TEXT;`,
    `ALTER TABLE "Comment" ADD COLUMN IF NOT EXISTS "replyCount" INTEGER NOT NULL DEFAULT 0;`,
    `ALTER TABLE "Comment" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);`,
    `ALTER TABLE "Notification" ADD COLUMN IF NOT EXISTS "readAt" TIMESTAMP(3);`,
    `ALTER TABLE "Notification" ADD COLUMN IF NOT EXISTS "priority" INTEGER NOT NULL DEFAULT 0;`,
    `ALTER TABLE "Notification" ADD COLUMN IF NOT EXISTS "entityType" TEXT;`,
    `ALTER TABLE "Notification" ADD COLUMN IF NOT EXISTS "entityId" TEXT;`,
    `ALTER TABLE "Notification" ADD COLUMN IF NOT EXISTS "reasonCode" TEXT;`,
    `ALTER TABLE "Notification" ADD COLUMN IF NOT EXISTS "payload" JSONB;`,
    `ALTER TABLE "Notification" ADD COLUMN IF NOT EXISTS "dedupeKey" TEXT;`,
    `ALTER TABLE "Notification" ADD COLUMN IF NOT EXISTS "postId" TEXT;`,
    `ALTER TABLE "Notification" ADD COLUMN IF NOT EXISTS "fromUserId" TEXT;`,
    `CREATE TABLE IF NOT EXISTS "Token" (
      "id" TEXT NOT NULL,
      "chainType" TEXT NOT NULL,
      "address" TEXT NOT NULL,
      "symbol" TEXT,
      "name" TEXT,
      "imageUrl" TEXT,
      "dexscreenerUrl" TEXT,
      "launchAt" TIMESTAMP(3),
      "pairAddress" TEXT,
      "dexId" TEXT,
      "liquidity" DOUBLE PRECISION,
      "volume24h" DOUBLE PRECISION,
      "holderCount" INTEGER,
      "largestHolderPct" DOUBLE PRECISION,
      "top10HolderPct" DOUBLE PRECISION,
      "deployerSupplyPct" DOUBLE PRECISION,
      "bundledWalletCount" INTEGER,
      "bundledClusterCount" INTEGER,
      "estimatedBundledSupplyPct" DOUBLE PRECISION,
      "bundleRiskLabel" TEXT,
      "tokenRiskScore" DOUBLE PRECISION,
      "sentimentScore" DOUBLE PRECISION,
      "radarScore" DOUBLE PRECISION,
      "confidenceScore" DOUBLE PRECISION,
      "hotAlphaScore" DOUBLE PRECISION,
      "earlyRunnerScore" DOUBLE PRECISION,
      "highConvictionScore" DOUBLE PRECISION,
      "isEarlyRunner" BOOLEAN NOT NULL DEFAULT false,
      "earlyRunnerReasons" JSONB,
      "lastIntelligenceAt" TIMESTAMP(3),
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "Token_pkey" PRIMARY KEY ("id")
    );`,
    `CREATE UNIQUE INDEX IF NOT EXISTS "Token_chainType_address_key" ON "Token"("chainType", "address");`,
    `CREATE TABLE IF NOT EXISTS "TokenMetricSnapshot" (
      "id" TEXT NOT NULL,
      "tokenId" TEXT NOT NULL,
      "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "priceUsd" DOUBLE PRECISION,
      "marketCap" DOUBLE PRECISION,
      "liquidity" DOUBLE PRECISION,
      "volume1h" DOUBLE PRECISION,
      "volume24h" DOUBLE PRECISION,
      "holderCount" INTEGER,
      "largestHolderPct" DOUBLE PRECISION,
      "top10HolderPct" DOUBLE PRECISION,
      "bundledWalletCount" INTEGER,
      "estimatedBundledSupplyPct" DOUBLE PRECISION,
      "tokenRiskScore" DOUBLE PRECISION,
      "sentimentScore" DOUBLE PRECISION,
      "confidenceScore" DOUBLE PRECISION,
      "radarScore" DOUBLE PRECISION,
      CONSTRAINT "TokenMetricSnapshot_pkey" PRIMARY KEY ("id")
    );`,
    `CREATE TABLE IF NOT EXISTS "TokenBundleCluster" (
      "id" TEXT NOT NULL,
      "tokenId" TEXT NOT NULL,
      "clusterLabel" TEXT NOT NULL,
      "walletCount" INTEGER NOT NULL,
      "estimatedSupplyPct" DOUBLE PRECISION NOT NULL,
      "evidenceJson" JSONB NOT NULL,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "TokenBundleCluster_pkey" PRIMARY KEY ("id")
    );`,
    `CREATE TABLE IF NOT EXISTS "TokenEvent" (
      "id" TEXT NOT NULL,
      "tokenId" TEXT NOT NULL,
      "eventType" TEXT NOT NULL,
      "timestamp" TIMESTAMP(3) NOT NULL,
      "marketCap" DOUBLE PRECISION,
      "liquidity" DOUBLE PRECISION,
      "volume" DOUBLE PRECISION,
      "traderId" TEXT,
      "postId" TEXT,
      "metadata" JSONB,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "TokenEvent_pkey" PRIMARY KEY ("id")
    );`,
    `CREATE TABLE IF NOT EXISTS "Reaction" (
      "id" TEXT NOT NULL,
      "postId" TEXT NOT NULL,
      "userId" TEXT NOT NULL,
      "type" TEXT NOT NULL,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "Reaction_pkey" PRIMARY KEY ("id")
    );`,
    `CREATE UNIQUE INDEX IF NOT EXISTS "Reaction_postId_userId_type_key" ON "Reaction"("postId", "userId", "type");`,
    `CREATE TABLE IF NOT EXISTS "TokenFollow" (
      "id" TEXT NOT NULL,
      "userId" TEXT NOT NULL,
      "tokenId" TEXT NOT NULL,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "TokenFollow_pkey" PRIMARY KEY ("id")
    );`,
    `CREATE UNIQUE INDEX IF NOT EXISTS "TokenFollow_userId_tokenId_key" ON "TokenFollow"("userId", "tokenId");`,
    `CREATE TABLE IF NOT EXISTS "AlertPreference" (
      "id" TEXT NOT NULL,
      "userId" TEXT NOT NULL,
      "minConfidenceScore" DOUBLE PRECISION DEFAULT 65,
      "minLiquidity" DOUBLE PRECISION,
      "maxBundleRiskScore" DOUBLE PRECISION DEFAULT 45,
      "timeframeMinutes" INTEGER DEFAULT 240,
      "notifyFollowedTraders" BOOLEAN NOT NULL DEFAULT true,
      "notifyFollowedTokens" BOOLEAN NOT NULL DEFAULT true,
      "notifyEarlyRunners" BOOLEAN NOT NULL DEFAULT true,
      "notifyHotAlpha" BOOLEAN NOT NULL DEFAULT true,
      "notifyHighConviction" BOOLEAN NOT NULL DEFAULT true,
      "notifyBundleChanges" BOOLEAN NOT NULL DEFAULT true,
      "notifyConfidenceCross" BOOLEAN NOT NULL DEFAULT true,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "AlertPreference_pkey" PRIMARY KEY ("id")
    );`,
    `CREATE UNIQUE INDEX IF NOT EXISTS "AlertPreference_userId_key" ON "AlertPreference"("userId");`,
    `CREATE TABLE IF NOT EXISTS "TraderMetricDaily" (
      "id" TEXT NOT NULL,
      "traderId" TEXT NOT NULL,
      "bucketDate" TIMESTAMP(3) NOT NULL,
      "callsCount" INTEGER NOT NULL,
      "settledCount" INTEGER NOT NULL,
      "winRate" DOUBLE PRECISION NOT NULL,
      "avgRoi" DOUBLE PRECISION NOT NULL,
      "firstCalls" INTEGER NOT NULL,
      "firstCallAvgRoi" DOUBLE PRECISION,
      "trustScore" DOUBLE PRECISION,
      CONSTRAINT "TraderMetricDaily_pkey" PRIMARY KEY ("id")
    );`,
    `CREATE UNIQUE INDEX IF NOT EXISTS "TraderMetricDaily_traderId_bucketDate_key" ON "TraderMetricDaily"("traderId", "bucketDate");`,
    `CREATE TABLE IF NOT EXISTS "AggregateSnapshot" (
      "key" TEXT NOT NULL,
      "version" INTEGER NOT NULL DEFAULT 1,
      "payload" JSONB NOT NULL,
      "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "expiresAt" TIMESTAMP(3) NOT NULL,
      "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "AggregateSnapshot_pkey" PRIMARY KEY ("key")
    );`,
    `CREATE TABLE IF NOT EXISTS "TradeFeeEvent" (
      "id" TEXT NOT NULL,
      "postId" TEXT NOT NULL,
      "posterUserId" TEXT NOT NULL,
      "traderUserId" TEXT,
      "traderWalletAddress" TEXT NOT NULL,
      "status" TEXT NOT NULL DEFAULT 'pending',
      "tradeSide" TEXT NOT NULL,
      "inputMint" TEXT NOT NULL,
      "outputMint" TEXT NOT NULL,
      "inAmountAtomic" TEXT NOT NULL,
      "outAmountAtomic" TEXT NOT NULL,
      "platformFeeBps" INTEGER NOT NULL,
      "platformFeeAmountAtomic" TEXT NOT NULL,
      "feeMint" TEXT NOT NULL,
      "posterShareBps" INTEGER NOT NULL,
      "posterShareAmountAtomic" TEXT NOT NULL,
      "posterPayoutAddress" TEXT,
      "txSignature" TEXT,
      "confirmedAt" TIMESTAMP(3),
      "verificationError" TEXT,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "TradeFeeEvent_pkey" PRIMARY KEY ("id")
    );`,
    `ALTER TABLE "TradeFeeEvent" ADD COLUMN IF NOT EXISTS "postId" TEXT;`,
    `ALTER TABLE "TradeFeeEvent" ADD COLUMN IF NOT EXISTS "posterUserId" TEXT;`,
    `ALTER TABLE "TradeFeeEvent" ADD COLUMN IF NOT EXISTS "traderUserId" TEXT;`,
    `ALTER TABLE "TradeFeeEvent" ADD COLUMN IF NOT EXISTS "traderWalletAddress" TEXT;`,
    `ALTER TABLE "TradeFeeEvent" ADD COLUMN IF NOT EXISTS "status" TEXT NOT NULL DEFAULT 'pending';`,
    `ALTER TABLE "TradeFeeEvent" ADD COLUMN IF NOT EXISTS "tradeSide" TEXT;`,
    `ALTER TABLE "TradeFeeEvent" ADD COLUMN IF NOT EXISTS "inputMint" TEXT;`,
    `ALTER TABLE "TradeFeeEvent" ADD COLUMN IF NOT EXISTS "outputMint" TEXT;`,
    `ALTER TABLE "TradeFeeEvent" ADD COLUMN IF NOT EXISTS "inAmountAtomic" TEXT;`,
    `ALTER TABLE "TradeFeeEvent" ADD COLUMN IF NOT EXISTS "outAmountAtomic" TEXT;`,
    `ALTER TABLE "TradeFeeEvent" ADD COLUMN IF NOT EXISTS "platformFeeBps" INTEGER;`,
    `ALTER TABLE "TradeFeeEvent" ADD COLUMN IF NOT EXISTS "platformFeeAmountAtomic" TEXT;`,
    `ALTER TABLE "TradeFeeEvent" ADD COLUMN IF NOT EXISTS "feeMint" TEXT;`,
    `ALTER TABLE "TradeFeeEvent" ADD COLUMN IF NOT EXISTS "posterShareBps" INTEGER;`,
    `ALTER TABLE "TradeFeeEvent" ADD COLUMN IF NOT EXISTS "posterShareAmountAtomic" TEXT;`,
    `ALTER TABLE "TradeFeeEvent" ADD COLUMN IF NOT EXISTS "posterPayoutAddress" TEXT;`,
    `ALTER TABLE "TradeFeeEvent" ADD COLUMN IF NOT EXISTS "txSignature" TEXT;`,
    `ALTER TABLE "TradeFeeEvent" ADD COLUMN IF NOT EXISTS "confirmedAt" TIMESTAMP(3);`,
    `ALTER TABLE "TradeFeeEvent" ADD COLUMN IF NOT EXISTS "verificationError" TEXT;`,
    `ALTER TABLE "TradeFeeEvent" ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;`,
    `ALTER TABLE "TradeFeeEvent" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;`,
    `CREATE TABLE IF NOT EXISTS "Report" (
      "id" TEXT NOT NULL,
      "entityType" TEXT NOT NULL,
      "reason" TEXT NOT NULL,
      "details" TEXT,
      "status" TEXT NOT NULL DEFAULT 'open',
      "reporterUserId" TEXT NOT NULL,
      "targetUserId" TEXT,
      "postId" TEXT,
      "reviewedById" TEXT,
      "resolvedAt" TIMESTAMP(3),
      "reviewerNotes" TEXT,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "Report_pkey" PRIMARY KEY ("id")
    );`,
    `ALTER TABLE "Report" ADD COLUMN IF NOT EXISTS "entityType" TEXT;`,
    `ALTER TABLE "Report" ADD COLUMN IF NOT EXISTS "reason" TEXT;`,
    `ALTER TABLE "Report" ADD COLUMN IF NOT EXISTS "details" TEXT;`,
    `ALTER TABLE "Report" ADD COLUMN IF NOT EXISTS "status" TEXT NOT NULL DEFAULT 'open';`,
    `ALTER TABLE "Report" ADD COLUMN IF NOT EXISTS "reporterUserId" TEXT;`,
    `ALTER TABLE "Report" ADD COLUMN IF NOT EXISTS "targetUserId" TEXT;`,
    `ALTER TABLE "Report" ADD COLUMN IF NOT EXISTS "postId" TEXT;`,
    `ALTER TABLE "Report" ADD COLUMN IF NOT EXISTS "reviewedById" TEXT;`,
    `ALTER TABLE "Report" ADD COLUMN IF NOT EXISTS "resolvedAt" TIMESTAMP(3);`,
    `ALTER TABLE "Report" ADD COLUMN IF NOT EXISTS "reviewerNotes" TEXT;`,
    `ALTER TABLE "Report" ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;`,
    `ALTER TABLE "Report" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;`,
    `CREATE TABLE IF NOT EXISTS "Announcement" (
      "id" TEXT NOT NULL,
      "title" TEXT NOT NULL,
      "content" TEXT NOT NULL,
      "isPinned" BOOLEAN NOT NULL DEFAULT false,
      "priority" INTEGER NOT NULL DEFAULT 0,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "authorId" TEXT NOT NULL,
      CONSTRAINT "Announcement_pkey" PRIMARY KEY ("id")
    );`,
    `ALTER TABLE "Announcement" ADD COLUMN IF NOT EXISTS "title" TEXT;`,
    `ALTER TABLE "Announcement" ADD COLUMN IF NOT EXISTS "content" TEXT;`,
    `ALTER TABLE "Announcement" ADD COLUMN IF NOT EXISTS "isPinned" BOOLEAN NOT NULL DEFAULT false;`,
    `ALTER TABLE "Announcement" ADD COLUMN IF NOT EXISTS "priority" INTEGER NOT NULL DEFAULT 0;`,
    `ALTER TABLE "Announcement" ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;`,
    `ALTER TABLE "Announcement" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;`,
    `ALTER TABLE "Announcement" ADD COLUMN IF NOT EXISTS "authorId" TEXT;`,
    `CREATE TABLE IF NOT EXISTS "AnnouncementView" (
      "id" TEXT NOT NULL,
      "userId" TEXT NOT NULL,
      "announcementId" TEXT NOT NULL,
      "viewedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "AnnouncementView_pkey" PRIMARY KEY ("id")
    );`,
    `ALTER TABLE "AnnouncementView" ADD COLUMN IF NOT EXISTS "userId" TEXT;`,
    `ALTER TABLE "AnnouncementView" ADD COLUMN IF NOT EXISTS "announcementId" TEXT;`,
    `ALTER TABLE "AnnouncementView" ADD COLUMN IF NOT EXISTS "viewedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;`,
    `CREATE INDEX IF NOT EXISTS "AggregateSnapshot_expiresAt_idx" ON "AggregateSnapshot"("expiresAt");`,
    `CREATE INDEX IF NOT EXISTS "AggregateSnapshot_capturedAt_idx" ON "AggregateSnapshot"("capturedAt");`,
    `CREATE INDEX IF NOT EXISTS "TradeFeeEvent_posterUserId_createdAt_idx" ON "TradeFeeEvent"("posterUserId", "createdAt");`,
    `CREATE INDEX IF NOT EXISTS "TradeFeeEvent_postId_createdAt_idx" ON "TradeFeeEvent"("postId", "createdAt");`,
    `CREATE INDEX IF NOT EXISTS "TradeFeeEvent_status_createdAt_idx" ON "TradeFeeEvent"("status", "createdAt");`,
    `CREATE INDEX IF NOT EXISTS "TradeFeeEvent_txSignature_idx" ON "TradeFeeEvent"("txSignature");`,
    `CREATE INDEX IF NOT EXISTS "TradeFeeEvent_traderUserId_createdAt_idx" ON "TradeFeeEvent"("traderUserId", "createdAt");`,
    `CREATE INDEX IF NOT EXISTS "Report_status_createdAt_idx" ON "Report"("status", "createdAt");`,
    `CREATE INDEX IF NOT EXISTS "Report_entityType_status_createdAt_idx" ON "Report"("entityType", "status", "createdAt");`,
    `CREATE INDEX IF NOT EXISTS "Report_reporterUserId_createdAt_idx" ON "Report"("reporterUserId", "createdAt");`,
    `CREATE INDEX IF NOT EXISTS "Report_targetUserId_status_createdAt_idx" ON "Report"("targetUserId", "status", "createdAt");`,
    `CREATE INDEX IF NOT EXISTS "Report_postId_status_createdAt_idx" ON "Report"("postId", "status", "createdAt");`,
    `CREATE INDEX IF NOT EXISTS "Report_reviewedById_createdAt_idx" ON "Report"("reviewedById", "createdAt");`,
    `CREATE INDEX IF NOT EXISTS "Announcement_isPinned_priority_createdAt_idx" ON "Announcement"("isPinned", "priority", "createdAt");`,
    `CREATE INDEX IF NOT EXISTS "Announcement_authorId_createdAt_idx" ON "Announcement"("authorId", "createdAt");`,
    `CREATE UNIQUE INDEX IF NOT EXISTS "AnnouncementView_userId_announcementId_key" ON "AnnouncementView"("userId", "announcementId");`,
    `CREATE INDEX IF NOT EXISTS "AnnouncementView_userId_viewedAt_idx" ON "AnnouncementView"("userId", "viewedAt");`,
    `CREATE INDEX IF NOT EXISTS "AnnouncementView_announcementId_viewedAt_idx" ON "AnnouncementView"("announcementId", "viewedAt");`,
    // Performance indexes for frequently queried columns
    `CREATE INDEX IF NOT EXISTS "User_walletAddress_idx" ON "User"("walletAddress");`,
    `CREATE INDEX IF NOT EXISTS "User_username_idx" ON "User"("username");`,
    `CREATE INDEX IF NOT EXISTS "Notification_userId_type_createdAt_idx" ON "Notification"("userId", "type", "createdAt");`,
    `CREATE UNIQUE INDEX IF NOT EXISTS "Notification_dedupeKey_key" ON "Notification"("dedupeKey");`,
    `CREATE INDEX IF NOT EXISTS "Notification_userId_dismissed_createdAt_idx" ON "Notification"("userId", "dismissed", "createdAt");`,
    `CREATE INDEX IF NOT EXISTS "Notification_fromUserId_createdAt_idx" ON "Notification"("fromUserId", "createdAt");`,
    `CREATE INDEX IF NOT EXISTS "Notification_postId_createdAt_idx" ON "Notification"("postId", "createdAt");`,
    `CREATE INDEX IF NOT EXISTS "Notification_entityType_entityId_createdAt_idx" ON "Notification"("entityType", "entityId", "createdAt");`,
    `CREATE INDEX IF NOT EXISTS "Post_settled6h_createdAt_idx" ON "Post"("settled6h", "createdAt");`,
    `CREATE INDEX IF NOT EXISTS "Post_settled_isWin_idx" ON "Post"("settled", "isWin");`,
    `CREATE INDEX IF NOT EXISTS "Post_createdAt_entryMcap_idx" ON "Post"("createdAt", "entryMcap");`,
    `CREATE INDEX IF NOT EXISTS "Post_createdAt_id_idx" ON "Post"("createdAt" DESC, "id" DESC);`,
    `CREATE INDEX IF NOT EXISTS "Post_content_trgm_idx" ON "Post" USING GIN ("content" gin_trgm_ops);`,
    `CREATE INDEX IF NOT EXISTS "Post_tokenName_trgm_idx" ON "Post" USING GIN ("tokenName" gin_trgm_ops);`,
    `CREATE INDEX IF NOT EXISTS "Post_tokenSymbol_trgm_idx" ON "Post" USING GIN ("tokenSymbol" gin_trgm_ops);`,
    `CREATE INDEX IF NOT EXISTS "Post_contractAddress_trgm_idx" ON "Post" USING GIN ("contractAddress" gin_trgm_ops);`,
    `CREATE INDEX IF NOT EXISTS "User_name_trgm_idx" ON "User" USING GIN ("name" gin_trgm_ops);`,
    `CREATE INDEX IF NOT EXISTS "User_username_trgm_idx" ON "User" USING GIN ("username" gin_trgm_ops);`,
    `CREATE INDEX IF NOT EXISTS "Notification_userId_read_dismissed_createdAt_idx" ON "Notification"("userId", "read", "dismissed", "createdAt");`,
  ] as const;

  for (const statement of statements) {
    try {
      await prisma.$executeRawUnsafe(statement);
    } catch (err) {
      // Log but continue - one failing guardrail shouldn't block the rest
      console.warn("[Prisma] Compat guardrail failed (continuing):", {
        statement: statement.substring(0, 80),
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

const compatGuardrailsSetting = process.env.PRISMA_ENABLE_COMPAT_GUARDRAILS?.trim().toLowerCase();
const shouldRunCompatGuardrails =
  isPostgres &&
  compatGuardrailsSetting !== "false";
const PRISMA_COMPAT_REFRESH_COOLDOWN_MS =
  getPositiveIntEnv("PRISMA_COMPAT_REFRESH_COOLDOWN_MS") ??
  (isProduction ? 60_000 : 10_000);
let prismaReadyPromise: Promise<void> | null = null;
let postgresCompatRefreshPromise: Promise<void> | null = null;
let lastPostgresCompatRefreshStartedAt = 0;
let lastPostgresCompatRefreshSucceededAt = 0;
let lastPostgresCompatRefreshFailedAt = 0;
let lastPostgresCompatRefreshError: string | null = null;

async function refreshPrismaCompatGuardrails(options?: {
  force?: boolean;
  reason?: string;
}): Promise<void> {
  if (!isPostgres || !shouldRunCompatGuardrails) {
    return;
  }

  if (postgresCompatRefreshPromise) {
    return postgresCompatRefreshPromise;
  }

  const now = Date.now();
  if (
    !options?.force &&
    lastPostgresCompatRefreshSucceededAt > 0 &&
    now - lastPostgresCompatRefreshSucceededAt < PRISMA_COMPAT_REFRESH_COOLDOWN_MS
  ) {
    return;
  }
  if (
    !options?.force &&
    lastPostgresCompatRefreshFailedAt > 0 &&
    now - lastPostgresCompatRefreshFailedAt < Math.max(5_000, Math.floor(PRISMA_COMPAT_REFRESH_COOLDOWN_MS / 4))
  ) {
    return;
  }

  postgresCompatRefreshPromise = (async () => {
    lastPostgresCompatRefreshStartedAt = Date.now();
    try {
      await initPostgresCompatColumns(prisma);
      lastPostgresCompatRefreshSucceededAt = Date.now();
      lastPostgresCompatRefreshError = null;
      console.log("[Prisma] Postgres compatibility columns check complete", {
        reason: options?.reason ?? "startup",
        startedAt: new Date(lastPostgresCompatRefreshStartedAt).toISOString(),
        durationMs: lastPostgresCompatRefreshSucceededAt - lastPostgresCompatRefreshStartedAt,
      });
    } catch (error) {
      lastPostgresCompatRefreshFailedAt = Date.now();
      lastPostgresCompatRefreshError =
        error instanceof Error ? error.message : String(error);
      throw error;
    } finally {
      postgresCompatRefreshPromise = null;
    }
  })();

  return postgresCompatRefreshPromise;
}

async function initializePrismaRuntime(): Promise<void> {
  await prisma.$connect();

  if (isSqlite) {
    await initSqlitePragmas(prisma);
    return;
  }

  if (!isPostgres) {
    return;
  }

  if (!shouldRunCompatGuardrails) {
    console.log("[Prisma] Postgres compatibility guardrails disabled", {
      reason:
        compatGuardrailsSetting === "false"
          ? "env_disabled"
          : isProduction
            ? "default_disabled_in_production"
            : "not_enabled",
    });
    return;
  }

  try {
    await refreshPrismaCompatGuardrails({ force: true, reason: "startup" });
  } catch (error) {
    console.warn("[Prisma] Failed to apply compatibility column guardrails:", error);
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
  const maxRetries = opts?.maxRetries ?? 2;
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
  refreshPrismaCompatGuardrails,
};
