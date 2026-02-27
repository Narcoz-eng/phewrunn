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

  // Optional: Debug mode
  DEBUG: z.preprocess(normalizeBooleanEnv, z.enum(["true", "false"])).optional().default("false"),

  // Optional: Log level
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).optional().default("info"),

  // Optional: Vercel Cron / maintenance endpoint auth
  CRON_SECRET: z.string().min(16, "CRON_SECRET must be at least 16 characters").optional(),

  // Optional: Helius Solana RPC (wallet holdings/trade snapshot enrichment)
  HELIUS_RPC_URL: z.string().url("HELIUS_RPC_URL must be a valid URL").optional(),

  // Optional: Jupiter integrator fee settings
  JUPITER_PLATFORM_FEE_BPS: z
    .string()
    .regex(/^\d+$/, "JUPITER_PLATFORM_FEE_BPS must be an integer string")
    .optional(),
  JUPITER_PLATFORM_FEE_ACCOUNT: z.string().min(32, "JUPITER_PLATFORM_FEE_ACCOUNT must be a valid Solana token account").optional(),

  // Optional: Upstash Redis REST (shared rate limiting + cache)
  UPSTASH_REDIS_REST_URL: z.string().url("UPSTASH_REDIS_REST_URL must be a valid URL").optional(),
  UPSTASH_REDIS_REST_TOKEN: z.string().min(1, "UPSTASH_REDIS_REST_TOKEN cannot be empty").optional(),

  // Optional: Standard Redis URL (Redis Cloud / Redis Labs, shared rate limiting + cache)
  REDIS_URL: z.string().url("REDIS_URL must be a valid URL").optional(),
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

    if (!parsed.CRON_SECRET) {
      warnings.push("CRON_SECRET is not configured; scheduled maintenance endpoint will be disabled");
    }
  }

  return warnings;
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
    DEBUG: parsed.DEBUG,
    LOG_LEVEL: parsed.LOG_LEVEL,
    CRON_SECRET: parsed.CRON_SECRET ? "configured" : "not set",
    HELIUS_RPC_URL: parsed.HELIUS_RPC_URL ? "configured" : "not set",
    JUPITER_PLATFORM_FEE_BPS: parsed.JUPITER_PLATFORM_FEE_BPS ?? "0",
    JUPITER_PLATFORM_FEE_ACCOUNT: parsed.JUPITER_PLATFORM_FEE_ACCOUNT ? "configured" : "not set",
    UPSTASH_REDIS_REST_URL: parsed.UPSTASH_REDIS_REST_URL ? "configured" : "not set",
    UPSTASH_REDIS_REST_TOKEN: parsed.UPSTASH_REDIS_REST_TOKEN ? "configured" : "not set",
    REDIS_URL: parsed.REDIS_URL ? "configured" : "not set",
  };
}

/**
 * Validate and parse environment variables
 */
function validateEnv() {
  try {
    const parsed = envSchema.parse(process.env);
    const warnings = validateProductionConfig(parsed);

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
