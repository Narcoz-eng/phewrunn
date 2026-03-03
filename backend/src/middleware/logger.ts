import type { Context, Next } from "hono";

/**
 * Structured Logging Middleware
 *
 * Provides structured logging for all requests with:
 * - Timestamp
 * - Request ID
 * - HTTP method and path
 * - Status code
 * - Duration
 * - User ID (if authenticated)
 *
 * IMPORTANT: Does not log sensitive data like passwords or tokens
 */

export interface LogEntry {
  timestamp: string;
  requestId: string;
  method: string;
  path: string;
  status: number;
  duration: number;
  userId?: string;
  userAgent?: string;
  ip?: string;
  query?: Record<string, string>;
  error?: string;
}

/**
 * Fields that should never be logged
 */
const SENSITIVE_FIELDS = new Set([
  "password",
  "token",
  "accessToken",
  "refreshToken",
  "authorization",
  "cookie",
  "secret",
  "apiKey",
  "privateKey",
]);

/**
 * Headers that should not be logged
 */
const SENSITIVE_HEADERS = new Set([
  "authorization",
  "cookie",
  "x-api-key",
  "x-auth-token",
]);

/**
 * Redact sensitive values from an object
 */
function redactSensitive(obj: Record<string, unknown>): Record<string, unknown> {
  const redacted: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(obj)) {
    const lowerKey = key.toLowerCase();
    if (SENSITIVE_FIELDS.has(lowerKey) || lowerKey.includes("password") || lowerKey.includes("secret") || lowerKey.includes("token")) {
      redacted[key] = "[REDACTED]";
    } else if (typeof value === "object" && value !== null) {
      redacted[key] = redactSensitive(value as Record<string, unknown>);
    } else {
      redacted[key] = value;
    }
  }

  return redacted;
}

/**
 * Get safe query parameters (redact sensitive ones)
 */
function getSafeQueryParams(c: Context): Record<string, string> | undefined {
  const queries = c.req.queries();
  if (Object.keys(queries).length === 0) return undefined;

  const safeQueries: Record<string, string> = {};
  for (const [key, values] of Object.entries(queries)) {
    const lowerKey = key.toLowerCase();
    if (SENSITIVE_FIELDS.has(lowerKey)) {
      safeQueries[key] = "[REDACTED]";
    } else {
      safeQueries[key] = values.join(",");
    }
  }

  return safeQueries;
}

/**
 * Get client IP from request
 */
function getClientIp(c: Context): string | undefined {
  const forwarded = c.req.header("x-forwarded-for");
  if (forwarded) {
    const parts = forwarded.split(",");
    const first = parts[0];
    if (first) return first.trim();
  }

  return c.req.header("x-real-ip") || undefined;
}

/**
 * Format log entry for production (JSON)
 */
function formatJsonLog(entry: LogEntry): string {
  return JSON.stringify(entry);
}

/**
 * Format log entry for development (pretty)
 */
function formatPrettyLog(entry: LogEntry): string {
  const statusColor = entry.status >= 500 ? "\x1b[31m" : // Red for 5xx
                     entry.status >= 400 ? "\x1b[33m" : // Yellow for 4xx
                     entry.status >= 300 ? "\x1b[36m" : // Cyan for 3xx
                     "\x1b[32m"; // Green for 2xx
  const resetColor = "\x1b[0m";

  const userPart = entry.userId ? ` user=${entry.userId.slice(0, 8)}...` : "";
  const errorPart = entry.error ? ` error="${entry.error}"` : "";

  return `${entry.timestamp} ${entry.method.padEnd(7)} ${entry.path.padEnd(40)} ${statusColor}${entry.status}${resetColor} ${entry.duration}ms${userPart}${errorPart}`;
}

export interface StructuredLoggerConfig {
  /**
   * Log level threshold
   * - 'all': Log all requests
   * - 'errors': Only log 4xx and 5xx responses
   * - 'slow': Only log errors and slow requests (>1s)
   */
  level?: "all" | "errors" | "slow";

  /**
   * Threshold for slow request logging in milliseconds
   */
  slowThreshold?: number;

  /**
   * Skip logging for certain paths (e.g., health checks)
   */
  skipPaths?: string[];

  /**
   * Custom log function (defaults to console.log)
   */
  logFn?: (entry: LogEntry) => void;

  /**
   * Suppress expected 401s from lightweight auth/session probes.
   * These are common for logged-out users and can overwhelm production logs.
   */
  suppressExpectedAuthProbe401?: boolean;
}

/**
 * Create structured logging middleware
 */
export function structuredLogger(config: StructuredLoggerConfig = {}) {
  const {
    level = "all",
    slowThreshold = 1000,
    skipPaths = ["/health"],
    logFn,
    suppressExpectedAuthProbe401 = true,
  } = config;

  const isProduction = process.env.NODE_ENV === "production";

  return async (c: Context, next: Next) => {
    // Skip logging for specified paths
    if (skipPaths.includes(c.req.path)) {
      return next();
    }

    const start = Date.now();

    // Execute the request
    await next();

    const duration = Date.now() - start;
    const status = c.res.status;

    // Determine if we should log this request
    const isError = status >= 400;
    const isSlow = duration > slowThreshold;
    const isExpectedAuthProbe401 =
      suppressExpectedAuthProbe401 &&
      status === 401 &&
      c.req.method === "GET" &&
      (c.req.path === "/api/me" || c.req.path === "/api/notifications/unread-count");

    let shouldLog = false;
    if (level === "all") {
      shouldLog = true;
    } else if (level === "errors") {
      shouldLog = isError;
    } else if (level === "slow") {
      shouldLog = isError || isSlow;
    }

    if (isExpectedAuthProbe401) {
      shouldLog = false;
    }

    if (!shouldLog) return;

    // Build log entry
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      requestId: (c.get("requestId") as string) || "unknown",
      method: c.req.method,
      path: c.req.path,
      status,
      duration,
    };

    // Add user ID if authenticated
    const user = c.get("user") as { id: string } | null;
    if (user?.id) {
      entry.userId = user.id;
    }

    // Add IP in production
    if (isProduction) {
      entry.ip = getClientIp(c);
    }

    // Add query params for non-GET requests (might be useful for debugging)
    const queryParams = getSafeQueryParams(c);
    if (queryParams && Object.keys(queryParams).length > 0) {
      entry.query = queryParams;
    }

    // Add user agent (truncated)
    const userAgent = c.req.header("user-agent");
    if (userAgent) {
      entry.userAgent = userAgent.substring(0, 100);
    }

    // Log the entry
    if (logFn) {
      logFn(entry);
    } else if (isProduction) {
      console.log(formatJsonLog(entry));
    } else {
      console.log(formatPrettyLog(entry));
    }
  };
}

/**
 * Create production logger (JSON format, errors and slow requests only)
 */
export function productionLogger() {
  return structuredLogger({
    level: "slow",
    slowThreshold: 1000,
  });
}

/**
 * Create development logger (pretty format, all requests)
 */
export function developmentLogger() {
  return structuredLogger({
    level: "all",
    slowThreshold: 500,
  });
}
