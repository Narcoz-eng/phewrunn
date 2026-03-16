/**
 * Sentry Error Tracking
 *
 * Fully optional. If SENTRY_DSN is unset or @sentry/node is unavailable in the
 * current workspace, all calls degrade to no-ops.
 */

type SentryEvent = {
  request?: {
    headers?: Record<string, string | undefined>;
  };
};

type SentryScope = {
  setUser: (user: { id: string }) => void;
  setTag: (key: string, value: string) => void;
  setExtras: (extras: Record<string, unknown>) => void;
};

type SentryModule = {
  init: (options: {
    dsn: string;
    environment: string;
    tracesSampleRate: number;
    includeLocalVariables: boolean;
    sendDefaultPii: boolean;
    beforeSend: (event: SentryEvent) => SentryEvent;
  }) => void;
  withScope: (callback: (scope: SentryScope) => void) => void;
  captureException: (error: unknown) => void;
  captureMessage: (message: string, level?: "warning" | "error" | "info") => void;
};

const SENTRY_DSN = process.env.SENTRY_DSN?.trim() || "";
const sentryModuleName = "@sentry/node";
const sentryModule = (await import(sentryModuleName).catch(() => null)) as SentryModule | null;
const isEnabled = SENTRY_DSN.length > 0 && Boolean(sentryModule);

if (SENTRY_DSN && !sentryModule) {
  console.warn("[Sentry] @sentry/node is not installed — error tracking disabled");
} else if (isEnabled && sentryModule) {
  sentryModule.init({
    dsn: SENTRY_DSN,
    environment: process.env.NODE_ENV ?? "development",
    tracesSampleRate: 0,
    includeLocalVariables: false,
    sendDefaultPii: false,
    beforeSend(event) {
      if (event.request?.headers) {
        delete event.request.headers.authorization;
        delete event.request.headers.cookie;
        delete event.request.headers["x-session-token"];
      }
      return event;
    },
  });

  console.log("[Sentry] Initialized — error tracking active");
} else {
  console.log("[Sentry] DSN not configured — error tracking disabled");
}

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
  if (!isEnabled || !sentryModule) return;

  sentryModule.withScope((scope) => {
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

    const extra: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(context ?? {})) {
      if (key !== "userId" && key !== "requestId" && key !== "path" && key !== "method") {
        extra[key] = value;
      }
    }
    if (Object.keys(extra).length > 0) {
      scope.setExtras(extra);
    }

    sentryModule.captureException(error);
  });
}

export function captureMessage(
  message: string,
  level: "warning" | "error" | "info" = "warning",
  context?: Record<string, unknown>
): void {
  if (!isEnabled || !sentryModule) return;

  sentryModule.withScope((scope) => {
    if (context) {
      scope.setExtras(context);
    }
    sentryModule.captureMessage(message, level);
  });
}

export { isEnabled as isSentryEnabled };
