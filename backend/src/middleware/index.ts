/**
 * Middleware exports
 *
 * Central export point for all middleware modules.
 */

// Auth middleware
export {
  betterAuthMiddleware,
  requireAuth,
  auth,
  type AuthUser,
  type SimpleUser,
  type AuthVariables,
} from "./auth.js";

// Rate limiting
export {
  rateLimit,
  userAwareRateLimit,
  apiRateLimit,
  authRateLimit,
  sessionRateLimit,
  feedRateLimit,
  postRateLimit,
  strictRateLimit,
  settlementRateLimit,
  commentRateLimit,
  adminRateLimit,
  leaderboardRateLimit,
  postCreationRateLimit,
  startRateLimitCleanup,
  stopRateLimitCleanup,
  clearRateLimitStore,
  type RateLimitConfig,
} from "./rateLimit.js";

// Input sanitization
export {
  escapeHtml,
  stripHtml,
  sanitizeString,
  sanitizeObject,
  sanitizeObjectSafe,
  sanitizeBody,
  sanitizeQuery,
  isSafeString,
  sanitizedString,
  safeString,
  sanitizeUrl,
  sanitizeWalletAddress,
} from "./sanitize.js";

// Security headers
export {
  securityHeaders,
  corsPreflightHandler,
  requestId,
  validateProductionEnvironment,
  logProductionStatus,
  timingSafeEqual,
  type SecurityHeadersConfig,
} from "./security.js";

// Error handling
export {
  createErrorHandler,
  AppError,
  Errors,
  ERROR_CODES,
  type ErrorCode,
  type ErrorResponse,
} from "./errorHandler.js";

// Structured logging
export {
  structuredLogger,
  productionLogger,
  developmentLogger,
  type LogEntry,
  type StructuredLoggerConfig,
} from "./logger.js";

// CSRF Protection
export {
  csrfProtection,
  secureCookieSettings,
  developmentCookieSettings,
  getCookieSettings,
  type CsrfConfig,
} from "./csrf.js";
