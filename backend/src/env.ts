import { createHash } from "node:crypto";
import { z } from "zod";

function normalizeBooleanEnv(value: unknown): unknown {
  if (value === undefined || value === null) return "false";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return value === 1 ? "true" : "false";
  if (typeof value !== "string") return value;

  const normalized = value.trim().toLowerCase();
  if (!normalized) return "false";
  if (["true", "1", "yes", "y", "on"].includes(normalized)) return "true";
  if (["false", "0", "no", "n", "off"].includes(normalized)) return "false";
  return "false";
}

function normalizeOptionalStringEnv(value: unknown): unknown {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") return value;

  const normalized = value.trim();
  if (!normalized) return undefined;

  const lower = normalized.toLowerCase();
  if (lower === "undefined" || lower === "null" || lower === "none") {
    return undefined;
  }

  return normalized;
}

/**
 * Environment variable schema using Zod
 * This ensures all required environment variables are present and valid
 */
const envSchema = z.object({
  // Server Configuration
  PORT: z.string().optional().default("3000"),
  NODE_ENV: z.enum(["development", "production", "test"]).optional().default("development"),
  BACKEND_URL: z.string().url("BACKEND_URL must be a valid URL").default("http://localhost:3000"),

  // Database
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),

  // Privy Auth
  PRIVY_APP_ID: z.string().min(1, "PRIVY_APP_ID is required"),
  PRIVY_APP_SECRET: z.string().min(1, "PRIVY_APP_SECRET is required"),
  AUTH_SESSION_TOKEN_SECRET: z
    .string()
    .min(32, "AUTH_SESSION_TOKEN_SECRET must be at least 32 characters"),
  AUTH_SESSION_DB_PERSISTENCE_ENABLED: z
    .preprocess(normalizeBooleanEnv, z.enum(["true", "false"]))
    .optional()
    .default("false"),

  // Shared session revocation persistence
  AUTH_SESSION_REVOCATION_DB_ENABLED: z
    .preprocess(normalizeBooleanEnv, z.enum(["true", "false"]))
    .optional()
    .default("false"),

  // Optional: Debug mode
  DEBUG: z.preprocess(normalizeBooleanEnv, z.enum(["true", "false"])).optional().default("false"),

  // Optional: Log level
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).optional().default("info"),

  // Optional: Vercel Cron / maintenance endpoint auth
  CRON_SECRET: z
    .preprocess(normalizeOptionalStringEnv, z.string().min(16, "CRON_SECRET must be at least 16 characters").optional()),

  // Optional: Helius Solana RPC (wallet holdings/trade snapshot enrichment)
  HELIUS_RPC_URL: z
    .preprocess(normalizeOptionalStringEnv, z.string().url("HELIUS_RPC_URL must be a valid URL").optional()),

  // Optional: Solscan Pro API key (holder intelligence / dev wallet enrichment)
  SOLSCAN_API_KEY: z
    .preprocess(normalizeOptionalStringEnv, z.string().min(1, "SOLSCAN_API_KEY cannot be empty").optional()),

  // Optional: Jupiter integrator fee settings
  JUPITER_PLATFORM_FEE_BPS: z
    .preprocess(normalizeOptionalStringEnv, z.string()
      .regex(/^\d+$/, "JUPITER_PLATFORM_FEE_BPS must be an integer string")
      .optional()),
  JUPITER_PLATFORM_FEE_ACCOUNT: z
    .preprocess(
      normalizeOptionalStringEnv,
      z.string().min(32, "JUPITER_PLATFORM_FEE_ACCOUNT must be a valid Solana token account").optional()
    ),

  // Optional: Upstash Redis REST (shared rate limiting + cache)
  UPSTASH_REDIS_REST_URL: z
    .preprocess(normalizeOptionalStringEnv, z.string().url("UPSTASH_REDIS_REST_URL must be a valid URL").optional()),
  UPSTASH_REDIS_REST_TOKEN: z
    .preprocess(normalizeOptionalStringEnv, z.string().min(1, "UPSTASH_REDIS_REST_TOKEN cannot be empty").optional()),

  // Optional: Upstash QStash (durable background job dispatch)
  QSTASH_URL: z.preprocess(
    (value) => normalizeOptionalStringEnv(value) ?? "https://qstash.upstash.io",
    z.string().url("QSTASH_URL must be a valid URL")
  ),
  QSTASH_TOKEN: z
    .preprocess(normalizeOptionalStringEnv, z.string().min(1, "QSTASH_TOKEN cannot be empty").optional()),
  QSTASH_CURRENT_SIGNING_KEY: z.preprocess(
    normalizeOptionalStringEnv,
    z.string().min(1, "QSTASH_CURRENT_SIGNING_KEY cannot be empty").optional()
  ),
  QSTASH_NEXT_SIGNING_KEY: z.preprocess(
    normalizeOptionalStringEnv,
    z.string().min(1, "QSTASH_NEXT_SIGNING_KEY cannot be empty").optional()
  ),

  // Optional: Standard Redis URL (Redis Cloud / Redis Labs, shared rate limiting + cache)
  REDIS_URL: z
    .preprocess(normalizeOptionalStringEnv, z.string().url("REDIS_URL must be a valid URL").optional()),

  // Optional: Sentry DSN for error tracking
  SENTRY_DSN: z
    .preprocess(normalizeOptionalStringEnv, z.string().url("SENTRY_DSN must be a valid URL").optional()),
  SENTRY_ENVIRONMENT: z
    .preprocess(normalizeOptionalStringEnv, z.string().min(1, "SENTRY_ENVIRONMENT cannot be empty").optional()),
  SENTRY_RELEASE: z
    .preprocess(normalizeOptionalStringEnv, z.string().min(1, "SENTRY_RELEASE cannot be empty").optional()),
  SENTRY_TRACES_SAMPLE_RATE: z
    .preprocess(
      normalizeOptionalStringEnv,
      z.string().regex(/^(\d+(\.\d+)?|0?\.\d+)$/, "SENTRY_TRACES_SAMPLE_RATE must be a numeric string").optional()
    ),

  // Optional: community asset object storage
  COMMUNITY_ASSET_STORAGE_ENDPOINT: z
    .preprocess(normalizeOptionalStringEnv, z.string().url("COMMUNITY_ASSET_STORAGE_ENDPOINT must be a valid URL").optional()),
  COMMUNITY_ASSET_STORAGE_REGION: z
    .preprocess(normalizeOptionalStringEnv, z.string().min(1, "COMMUNITY_ASSET_STORAGE_REGION cannot be empty").optional()),
  COMMUNITY_ASSET_STORAGE_BUCKET: z
    .preprocess(normalizeOptionalStringEnv, z.string().min(1, "COMMUNITY_ASSET_STORAGE_BUCKET cannot be empty").optional()),
  COMMUNITY_ASSET_ACCESS_KEY_ID: z
    .preprocess(normalizeOptionalStringEnv, z.string().min(1, "COMMUNITY_ASSET_ACCESS_KEY_ID cannot be empty").optional()),
  COMMUNITY_ASSET_SECRET_ACCESS_KEY: z
    .preprocess(normalizeOptionalStringEnv, z.string().min(1, "COMMUNITY_ASSET_SECRET_ACCESS_KEY cannot be empty").optional()),
  COMMUNITY_ASSET_PUBLIC_BASE_URL: z
    .preprocess(normalizeOptionalStringEnv, z.string().url("COMMUNITY_ASSET_PUBLIC_BASE_URL must be a valid URL").optional()),
  COMMUNITY_ASSET_UPLOAD_EXPIRES_SECONDS: z
    .preprocess(
      normalizeOptionalStringEnv,
      z.string().regex(/^\d+$/, "COMMUNITY_ASSET_UPLOAD_EXPIRES_SECONDS must be an integer string").optional()
    ),
});

/**
 * Additional production-specific validations
 */
function validateProductionConfig(parsed: z.infer<typeof envSchema>): string[] {
  const warnings: string[] = [];

  if (parsed.NODE_ENV === "production") {
    // Check for secure database URL
    if (parsed.DATABASE_URL.includes("file:") || parsed.DATABASE_URL.includes("dev.db")) {
      warnings.push("Using file-based SQLite in production. Consider using a managed database.");
    }

    // Check for HTTPS in BACKEND_URL
    if (parsed.BACKEND_URL.startsWith("http://") && !parsed.BACKEND_URL.includes("localhost")) {
      warnings.push("BACKEND_URL is using HTTP instead of HTTPS in production");
    }

    // Check debug mode
    if (parsed.DEBUG === "true") {
      warnings.push("DEBUG mode is enabled in production");
    }

    if (parsed.AUTH_SESSION_DB_PERSISTENCE_ENABLED === "true") {
      warnings.push(
        "AUTH_SESSION_DB_PERSISTENCE_ENABLED=true will add Session table writes back into the auth path; keep it off unless you explicitly need legacy session compatibility"
      );
    }

    if (!parsed.CRON_SECRET) {
      warnings.push("CRON_SECRET is not configured; scheduled maintenance endpoint will be disabled");
    }

    const hasUpstashFastPath = Boolean(
      parsed.UPSTASH_REDIS_REST_URL && parsed.UPSTASH_REDIS_REST_TOKEN
    );
    const hasAnyRedis =
      hasUpstashFastPath ||
      Boolean(parsed.REDIS_URL);
    if (!hasUpstashFastPath) {
      warnings.push(
        "Upstash Redis REST is not configured; auth/rate-limit hot paths will not have the fast shared cache backend recommended for serverless production"
      );
    }

    const hasAnyQStashConfig = Boolean(
      parsed.QSTASH_TOKEN ||
      parsed.QSTASH_CURRENT_SIGNING_KEY ||
      parsed.QSTASH_NEXT_SIGNING_KEY
    );
    const hasFullQStashConfig = Boolean(
      parsed.QSTASH_TOKEN &&
      parsed.QSTASH_CURRENT_SIGNING_KEY &&
      parsed.QSTASH_NEXT_SIGNING_KEY
    );
    if (hasAnyQStashConfig && !hasFullQStashConfig) {
      warnings.push(
        "QStash queue delivery is only partially configured; set QSTASH_TOKEN, QSTASH_CURRENT_SIGNING_KEY, and QSTASH_NEXT_SIGNING_KEY together"
      );
    }
    if (!hasFullQStashConfig) {
      warnings.push(
        "QStash queue delivery is not configured; PR-004 queue plumbing is present but background-job cutover remains blocked until QStash credentials are supplied"
      );
    }

    const hasSharedRevocationBackend =
      parsed.AUTH_SESSION_REVOCATION_DB_ENABLED === "true" ||
      hasAnyRedis;
    if (!hasSharedRevocationBackend) {
      warnings.push(
        "Shared session revocation is not configured; enable Redis or AUTH_SESSION_REVOCATION_DB_ENABLED=true"
      );
    }

    if (parsed.SENTRY_DSN && !parsed.SENTRY_RELEASE) {
      warnings.push(
        "SENTRY_DSN is configured without SENTRY_RELEASE; set SENTRY_RELEASE or rely on your deployment SHA for better release tracking"
      );
    }
  }

  return warnings;
}

function getProductionConfigErrors(parsed: z.infer<typeof envSchema>): string[] {
  const errors: string[] = [];

  if (parsed.NODE_ENV !== "production") {
    return errors;
  }

  const hasUpstashFastPath = Boolean(
    parsed.UPSTASH_REDIS_REST_URL && parsed.UPSTASH_REDIS_REST_TOKEN
  );

  if (!hasUpstashFastPath) {
    errors.push(
      "Upstash Redis REST is required in production for shared rate limiting and hot-path session revocation"
    );
  }

  return errors;
}

/**
 * Get safe configuration for logging (no secrets)
 */
function getSafeConfig(parsed: z.infer<typeof envSchema>): Record<string, string> {
  const isPostgres =
    parsed.DATABASE_URL.startsWith("postgres://") ||
    parsed.DATABASE_URL.startsWith("postgresql://");
  const isSupabase =
    parsed.DATABASE_URL.includes("supabase.com") ||
    parsed.DATABASE_URL.includes("supabase.co");

  return {
    PORT: parsed.PORT,
    NODE_ENV: parsed.NODE_ENV,
    BACKEND_URL: parsed.BACKEND_URL,
    DATABASE_URL: parsed.DATABASE_URL.includes("file:")
      ? "SQLite (file-based)"
      : isSupabase
        ? "Supabase PostgreSQL"
      : isPostgres
        ? "PostgreSQL (external)"
        : "External database",
    PRIVY_APP_ID: `${parsed.PRIVY_APP_ID.substring(0, 8)}...`,
    AUTH_SESSION_TOKEN_SECRET: "configured",
    AUTH_SESSION_TOKEN_SECRET_FINGERPRINT: createHash("sha256")
      .update(parsed.AUTH_SESSION_TOKEN_SECRET)
      .digest("hex")
      .slice(0, 12),
    AUTH_SESSION_DB_PERSISTENCE_ENABLED: parsed.AUTH_SESSION_DB_PERSISTENCE_ENABLED,
    DEBUG: parsed.DEBUG,
    LOG_LEVEL: parsed.LOG_LEVEL,
    CRON_SECRET: parsed.CRON_SECRET ? "configured" : "not set",
    HELIUS_RPC_URL: parsed.HELIUS_RPC_URL ? "configured" : "not set",
    SOLSCAN_API_KEY: parsed.SOLSCAN_API_KEY ? "configured" : "not set",
    JUPITER_PLATFORM_FEE_BPS: parsed.JUPITER_PLATFORM_FEE_BPS ?? "0",
    JUPITER_PLATFORM_FEE_ACCOUNT: parsed.JUPITER_PLATFORM_FEE_ACCOUNT ? "configured" : "not set",
    AUTH_SESSION_REVOCATION_DB_ENABLED: parsed.AUTH_SESSION_REVOCATION_DB_ENABLED,
    UPSTASH_REDIS_REST_URL: parsed.UPSTASH_REDIS_REST_URL ? "configured" : "not set",
    UPSTASH_REDIS_REST_TOKEN: parsed.UPSTASH_REDIS_REST_TOKEN ? "configured" : "not set",
    QSTASH_URL: parsed.QSTASH_URL,
    QSTASH_TOKEN: parsed.QSTASH_TOKEN ? "configured" : "not set",
    QSTASH_CURRENT_SIGNING_KEY: parsed.QSTASH_CURRENT_SIGNING_KEY ? "configured" : "not set",
    QSTASH_NEXT_SIGNING_KEY: parsed.QSTASH_NEXT_SIGNING_KEY ? "configured" : "not set",
    REDIS_URL: parsed.REDIS_URL ? "configured" : "not set",
    SENTRY_DSN: parsed.SENTRY_DSN ? "configured" : "not set",
    SENTRY_ENVIRONMENT: parsed.SENTRY_ENVIRONMENT ?? parsed.NODE_ENV,
    SENTRY_RELEASE: parsed.SENTRY_RELEASE ?? "not set",
    SENTRY_TRACES_SAMPLE_RATE: parsed.SENTRY_TRACES_SAMPLE_RATE ?? "0",
    COMMUNITY_ASSET_STORAGE_ENDPOINT: parsed.COMMUNITY_ASSET_STORAGE_ENDPOINT ? "configured" : "not set",
    COMMUNITY_ASSET_STORAGE_REGION: parsed.COMMUNITY_ASSET_STORAGE_REGION ?? "auto",
    COMMUNITY_ASSET_STORAGE_BUCKET: parsed.COMMUNITY_ASSET_STORAGE_BUCKET ? "configured" : "not set",
    COMMUNITY_ASSET_ACCESS_KEY_ID: parsed.COMMUNITY_ASSET_ACCESS_KEY_ID ? "configured" : "not set",
    COMMUNITY_ASSET_SECRET_ACCESS_KEY: parsed.COMMUNITY_ASSET_SECRET_ACCESS_KEY ? "configured" : "not set",
    COMMUNITY_ASSET_PUBLIC_BASE_URL: parsed.COMMUNITY_ASSET_PUBLIC_BASE_URL ? "configured" : "not set",
    COMMUNITY_ASSET_UPLOAD_EXPIRES_SECONDS: parsed.COMMUNITY_ASSET_UPLOAD_EXPIRES_SECONDS ?? "600",
  };
}

/**
 * Validate and parse environment variables
 */
function validateEnv() {
  try {
    const parsed = envSchema.parse(process.env);
    const warnings = validateProductionConfig(parsed);
    const errors = getProductionConfigErrors(parsed);

    // Log configuration on startup (without secrets)
    console.log("\n=== Environment Configuration ===");
    const safeConfig = getSafeConfig(parsed);
    for (const [key, value] of Object.entries(safeConfig)) {
      console.log(`  ${key}: ${value}`);
    }
    console.log("=================================\n");

    // Log warnings
    if (warnings.length > 0) {
      console.warn("Environment Warnings:");
      warnings.forEach((warn) => {
        console.warn(`  - ${warn}`);
      });
      console.warn("");
    }

    if (errors.length > 0) {
      console.error("Environment Errors:");
      errors.forEach((message) => {
        console.error(`  - ${message}`);
      });
      console.error("");
      process.exit(1);
    }

    if (parsed.NODE_ENV === "production") {
      console.log("Running in PRODUCTION mode");
    } else {
      console.log("Environment variables validated successfully");
    }

    return parsed;
  } catch (error) {
    if (error instanceof z.ZodError) {
      console.error("Environment variable validation failed:");
      error.issues.forEach((err) => {
        console.error(`  - ${err.path.join(".")}: ${err.message}`);
      });
      console.error("\nPlease check your .env file and ensure all required variables are set.");
      process.exit(1);
    }
    throw error;
  }
}

/**
 * Validated and typed environment variables
 */
export const env = validateEnv();

/**
 * Type of the validated environment variables
 */
export type Env = z.infer<typeof envSchema>;

/**
 * Helper to check if we're in production
 */
export const isProduction = env.NODE_ENV === "production";

/**
 * Helper to check if debug mode is enabled
 */
export const isDebug = env.DEBUG === "true";
