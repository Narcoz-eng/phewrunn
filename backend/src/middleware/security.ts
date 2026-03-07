import type { Context, Next } from "hono";

/**
 * Security Headers Middleware
 *
 * Adds security headers to all responses to protect against common vulnerabilities.
 */

export interface SecurityHeadersConfig {
  /**
   * Content Security Policy directives
   * Only set if you want to override the defaults
   */
  contentSecurityPolicy?: string | false;

  /**
   * Whether to include HSTS header (only enable if you're using HTTPS)
   */
  hsts?: boolean;

  /**
   * Custom frame-ancestors for CSP (who can embed this site)
   * Set to 'none' to prevent all framing
   */
  frameAncestors?: string;
}

/**
 * Security headers middleware
 * Adds standard security headers to all responses
 */
export function securityHeaders(config: SecurityHeadersConfig = {}) {
  const { hsts = false, frameAncestors = "'self'" } = config;

  return async (c: Context, next: Next) => {
    await next();

    // Prevent MIME type sniffing
    c.header("X-Content-Type-Options", "nosniff");

    // Prevent clickjacking
    c.header("X-Frame-Options", "DENY");

    // Enable XSS filter in browsers
    c.header("X-XSS-Protection", "1; mode=block");

    // Control referrer information
    c.header("Referrer-Policy", "strict-origin-when-cross-origin");

    // Prevent DNS prefetching
    c.header("X-DNS-Prefetch-Control", "off");

    // Don't allow the browser to cache sensitive responses
    // Specifically useful for authenticated API responses
    if (c.req.header("Authorization")) {
      c.header("Cache-Control", "no-store, no-cache, must-revalidate, private");
      c.header("Pragma", "no-cache");
    }

    // Content Security Policy for API responses
    // More restrictive than a web app since this is an API
    if (config.contentSecurityPolicy !== false) {
      const csp =
        config.contentSecurityPolicy ||
        `default-src 'none'; frame-ancestors ${frameAncestors}`;
      c.header("Content-Security-Policy", csp);
    }

    // HTTP Strict Transport Security
    // Only enable in production with HTTPS
    if (hsts) {
      // 1 year, include subdomains
      c.header(
        "Strict-Transport-Security",
        "max-age=31536000; includeSubDomains"
      );
    }

    // Permissions Policy (formerly Feature Policy)
    // Disable various browser features for security
    c.header(
      "Permissions-Policy",
      "accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=()"
    );
  };
}

/**
 * CORS preflight handler
 * Explicitly handle OPTIONS requests for CORS
 */
export function corsPreflightHandler() {
  return async (c: Context, next: Next) => {
    if (c.req.method === "OPTIONS") {
      // CORS headers are handled by the cors middleware
      // Just return 204 No Content for preflight
      return c.body(null, 204);
    }
    await next();
  };
}

/**
 * Request ID middleware
 * Adds a unique request ID to each request for tracing
 */
export function requestId() {
  return async (c: Context, next: Next) => {
    // Check if a request ID was passed in (e.g., from a load balancer)
    let reqId = c.req.header("x-request-id");

    if (!reqId) {
      // Generate a simple unique ID
      reqId = `${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
    }

    // Store in context for logging
    c.set("requestId", reqId);

    // Add to response headers
    await next();

    c.header("X-Request-ID", reqId);
  };
}

/**
 * Production environment validator
 * Logs warnings for insecure configurations in production
 */
export function validateProductionEnvironment(): {
  isValid: boolean;
  warnings: string[];
  errors: string[];
} {
  const warnings: string[] = [];
  const errors: string[] = [];
  const isProduction = process.env.NODE_ENV === "production";

  // Check required secrets
  if (!process.env.PRIVY_APP_SECRET) {
    errors.push("PRIVY_APP_SECRET is not set");
  }

  if (!process.env.PRIVY_APP_ID) {
    errors.push("PRIVY_APP_ID is not set");
  }

  if (!process.env.AUTH_SESSION_TOKEN_SECRET) {
    errors.push("AUTH_SESSION_TOKEN_SECRET is not set");
  }

  // Check for production-specific concerns
  if (isProduction) {
    // Check if database URL looks like a production URL
    const dbUrl = process.env.DATABASE_URL || "";
    if (dbUrl.includes("file:") || dbUrl.includes("dev.db")) {
      warnings.push(
        "Using file-based SQLite in production. Consider using a managed database."
      );
    }

    // Check for debug mode
    if (process.env.DEBUG === "true") {
      warnings.push("DEBUG mode is enabled in production");
    }

    // Check BACKEND_URL for HTTPS
    const backendUrl = process.env.BACKEND_URL || "";
    if (backendUrl.startsWith("http://") && !backendUrl.includes("localhost")) {
      warnings.push(
        "BACKEND_URL is using HTTP instead of HTTPS in production"
      );
    }

    const revocationDbEnabled =
      process.env.AUTH_SESSION_REVOCATION_DB_ENABLED?.trim().toLowerCase() === "true";
    const hasRedis =
      Boolean(process.env.UPSTASH_REDIS_REST_URL?.trim()) ||
      Boolean(process.env.REDIS_URL?.trim());
    if (!revocationDbEnabled && !hasRedis) {
      warnings.push(
        "Shared session revocation is not configured; enable Redis or AUTH_SESSION_REVOCATION_DB_ENABLED=true"
      );
    }
  }

  return {
    isValid: errors.length === 0,
    warnings,
    errors,
  };
}

/**
 * Log production environment status
 * Call this during app startup
 */
export function logProductionStatus(): void {
  const { isValid, warnings, errors } = validateProductionEnvironment();
  const isProduction = process.env.NODE_ENV === "production";

  console.log("\n=== Security Configuration ===");
  console.log(`Environment: ${isProduction ? "PRODUCTION" : "development"}`);

  if (errors.length > 0) {
    console.error("\nCRITICAL ERRORS:");
    errors.forEach((err) => console.error(`  - ${err}`));
  }

  if (warnings.length > 0) {
    console.warn("\nWarnings:");
    warnings.forEach((warn) => console.warn(`  - ${warn}`));
  }

  if (isValid && warnings.length === 0) {
    console.log("\nAll security checks passed.");
  }

  console.log("==============================\n");

  // In production, exit if there are critical errors
  if (isProduction && !isValid) {
    console.error("Refusing to start with critical security errors.");
    process.exit(1);
  }
}

/**
 * Timing-safe string comparison
 * Use this for comparing tokens/secrets to prevent timing attacks
 */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }

  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }

  return result === 0;
}
