import type { Context, Next } from "hono";

/**
 * CSRF Protection Middleware
 *
 * Implements CSRF protection using Origin/Referer header validation
 * combined with SameSite cookie attribute checking.
 *
 * This approach doesn't require CSRF tokens since:
 * 1. Modern browsers enforce SameSite cookies (set to 'strict' or 'lax')
 * 2. We validate Origin/Referer headers against allowed origins
 * 3. CORS is already configured to only allow specific origins
 */

/**
 * List of allowed origins for CSRF validation
 * Should match your CORS configuration
 */
const ALLOWED_ORIGIN_PATTERNS = [
  /^http:\/\/localhost(:\d+)?$/,
  /^http:\/\/127\.0\.0\.1(:\d+)?$/,
  /^https:\/\/[a-z0-9-]+\.dev\.vibecode\.run$/,
  /^https:\/\/[a-z0-9-]+\.vibecode\.run$/,
  /^https:\/\/phew\.vibecode\.run$/,
  /^https:\/\/[a-z0-9-]+\.vibecodeapp\.com$/,
  /^https:\/\/phew\.run$/,
  /^https:\/\/www\.phew\.run$/,
  /^https:\/\/[a-z0-9-]+\.phew\.run$/,
];

/**
 * HTTP methods that modify state and require CSRF protection
 */
const STATE_CHANGING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * Paths that are exempt from CSRF protection
 * (e.g., webhook endpoints that use their own authentication)
 */
const EXEMPT_PATHS = new Set([
  "/api/webhooks/",
]);

export interface CsrfConfig {
  /**
   * Additional allowed origins (regex patterns)
   */
  allowedOrigins?: RegExp[];

  /**
   * Additional exempt paths
   */
  exemptPaths?: string[];

  /**
   * Whether to check Referer header as fallback
   * Default: true
   */
  checkReferer?: boolean;

  /**
   * Whether to allow requests with no Origin header (e.g., same-origin requests)
   * Default: true (for same-origin requests from the browser)
   */
  allowNoOrigin?: boolean;
}

/**
 * Check if an origin is allowed
 */
function isOriginAllowed(origin: string, additionalPatterns: RegExp[] = []): boolean {
  const allPatterns = [...ALLOWED_ORIGIN_PATTERNS, ...additionalPatterns];
  return allPatterns.some((pattern) => pattern.test(origin));
}

/**
 * Extract origin from Referer header
 */
function getOriginFromReferer(referer: string): string | null {
  try {
    const url = new URL(referer);
    return url.origin;
  } catch {
    return null;
  }
}

/**
 * Check if path is exempt from CSRF protection
 */
function isPathExempt(path: string, exemptPaths: Set<string>): boolean {
  for (const exemptPath of exemptPaths) {
    if (path.startsWith(exemptPath)) {
      return true;
    }
  }
  return false;
}

/**
 * CSRF Protection Middleware
 *
 * Validates Origin/Referer headers for state-changing requests.
 * Works alongside SameSite cookies for defense in depth.
 */
export function csrfProtection(config: CsrfConfig = {}) {
  const {
    allowedOrigins = [],
    exemptPaths = [],
    checkReferer = true,
    allowNoOrigin = true,
  } = config;

  const allExemptPaths = new Set([...EXEMPT_PATHS, ...exemptPaths]);

  return async (c: Context, next: Next) => {
    // Only check state-changing methods
    if (!STATE_CHANGING_METHODS.has(c.req.method)) {
      return next();
    }

    // Check if path is exempt
    if (isPathExempt(c.req.path, allExemptPaths)) {
      return next();
    }

    // Get Origin header
    const origin = c.req.header("origin");

    // If Origin header exists, validate it
    if (origin) {
      if (!isOriginAllowed(origin, allowedOrigins)) {
        console.warn(`[CSRF] Rejected request from origin: ${origin}`);
        return c.json(
          {
            error: {
              message: "CSRF validation failed: Invalid origin",
              code: "CSRF_ERROR",
            },
          },
          403
        );
      }
      // Origin is valid, proceed
      return next();
    }

    // No Origin header - check Referer as fallback
    if (checkReferer) {
      const referer = c.req.header("referer");
      if (referer) {
        const refererOrigin = getOriginFromReferer(referer);
        if (refererOrigin && isOriginAllowed(refererOrigin, allowedOrigins)) {
          return next();
        }

        if (refererOrigin) {
          console.warn(`[CSRF] Rejected request from referer: ${referer}`);
          return c.json(
            {
              error: {
                message: "CSRF validation failed: Invalid referer",
                code: "CSRF_ERROR",
              },
            },
            403
          );
        }
      }
    }

    // No Origin or Referer - this could be:
    // 1. Same-origin request (browser doesn't send Origin for same-origin)
    // 2. Non-browser client (API client, curl, etc.)
    // 3. Privacy extensions that strip headers
    if (allowNoOrigin) {
      // Allow but log for monitoring
      const userAgent = c.req.header("user-agent") || "unknown";
      const isLikelyBrowser = /mozilla|chrome|safari|firefox|edge/i.test(userAgent);

      // Only warn if it looks like a browser (non-browser clients are expected to have no origin)
      if (isLikelyBrowser) {
        console.warn(`[CSRF] Request without Origin/Referer from browser-like UA: ${userAgent.substring(0, 50)}`);
      }

      return next();
    }

    // Strict mode: reject requests without Origin
    console.warn("[CSRF] Rejected request without Origin header (strict mode)");
    return c.json(
      {
        error: {
          message: "CSRF validation failed: Origin header required",
          code: "CSRF_ERROR",
        },
      },
      403
    );
  };
}

/**
 * Cookie security settings for CSRF protection
 * Use these settings when setting authentication cookies
 */
export const secureCookieSettings = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "strict" as const,
  path: "/",
  // maxAge should be set based on your session requirements
};

/**
 * Cookie settings for development (less strict)
 */
export const developmentCookieSettings = {
  httpOnly: true,
  secure: false,
  sameSite: "lax" as const,
  path: "/",
};

/**
 * Get appropriate cookie settings based on environment
 */
export function getCookieSettings() {
  return process.env.NODE_ENV === "production"
    ? secureCookieSettings
    : developmentCookieSettings;
}
