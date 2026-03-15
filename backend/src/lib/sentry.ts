/**
 * Sentry Error Tracking
 *
 * Captures unhandled 500 errors and sends them to Sentry for monitoring.
 * Fully optional — if SENTRY_DSN is not set, all calls are silent no-ops.
 *
 * Usage:
 *   import { captureException, captureMessage } from "./sentry.js";
 *   captureException(error, { path: "/api/posts", userId: "abc" });
 */

import * as Sentry from "@sentry/node";

const SENTRY_DSN = process.env.SENTRY_DSN?.trim() || "";
const isEnabled = SENTRY_DSN.length > 0;

if (isEnabled) {
  Sentry.init({
    dsn: SENTRY_DSN,
    environment: process.env.NODE_ENV ?? "development",
    // Capture 100% of errors (not transactions — we don't need performance tracing)
    tracesSampleRate: 0,
    // Include source context in stack traces
    includeLocalVariables: false,
    // Don't send PII
    sendDefaultPii: false,
    beforeSend(event) {
      // Strip any auth tokens or sensitive headers that might leak
      if (event.request?.headers) {
        delete event.request.headers["authorization"];
        delete event.request.headers["cookie"];
        delete event.request.headers["x-session-token"];
      }
      return event;
    },
  });

  console.log("[Sentry] Initialized — error tracking active");
} else {
  console.log("[Sentry] DSN not configured — error tracking disabled");
}

/**
 * Capture an exception and send to Sentry with optional context.
 * Silent no-op if Sentry is not configured.
 */
export function captureException(
  error: unknown,
  context?: {
    path?: string;
    method?: string;
    userId?: string;
    requestId?: string;
    [key: string]: unknown;
  }
): void {
  if (!isEnabled) return;

  Sentry.withScope((scope) => {
    if (context?.userId) {
      scope.setUser({ id: context.userId });
    }
    if (context?.requestId) {
      scope.setTag("requestId", context.requestId);
    }
    if (context?.path) {
      scope.setTag("path", context.path);
    }
    if (context?.method) {
      scope.setTag("method", context.method);
    }
    // Include any extra context fields
    const extra: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(context ?? {})) {
      if (k !== "userId" && k !== "requestId" && k !== "path" && k !== "method") {
        extra[k] = v;
      }
    }
    if (Object.keys(extra).length > 0) {
      scope.setExtras(extra);
    }
    Sentry.captureException(error);
  });
}

/**
 * Capture a message (for warnings / anomalies that aren't exceptions).
 * Silent no-op if Sentry is not configured.
 */
export function captureMessage(
  message: string,
  level: "warning" | "error" | "info" = "warning",
  context?: Record<string, unknown>
): void {
  if (!isEnabled) return;

  Sentry.withScope((scope) => {
    if (context) scope.setExtras(context);
    Sentry.captureMessage(message, level);
  });
}

export { isEnabled as isSentryEnabled };
