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
    release?: string;
    serverName?: string;
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
const SENTRY_ENVIRONMENT =
  process.env.SENTRY_ENVIRONMENT?.trim() ||
  process.env.VERCEL_ENV?.trim() ||
  process.env.NODE_ENV ||
  "development";
const SENTRY_RELEASE =
  process.env.SENTRY_RELEASE?.trim() ||
  process.env.VERCEL_GIT_COMMIT_SHA?.trim() ||
  process.env.SOURCE_VERSION?.trim() ||
  "";
const SENTRY_SERVER_NAME =
  process.env.VERCEL_URL?.trim() ||
  process.env.BACKEND_URL?.trim() ||
  "";
const parsedTracesSampleRate = Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? "0");
const SENTRY_TRACES_SAMPLE_RATE =
  Number.isFinite(parsedTracesSampleRate) &&
  parsedTracesSampleRate >= 0 &&
  parsedTracesSampleRate <= 1
    ? parsedTracesSampleRate
    : 0;

const sentryModuleName = "@sentry/node";
const sentryModule = (await import(sentryModuleName).catch(() => null)) as SentryModule | null;
const isEnabled = SENTRY_DSN.length > 0 && Boolean(sentryModule);

if (SENTRY_DSN && !sentryModule) {
  console.warn("[Sentry] @sentry/node is not installed - error tracking disabled");
} else if (isEnabled && sentryModule) {
  sentryModule.init({
    dsn: SENTRY_DSN,
    environment: SENTRY_ENVIRONMENT,
    ...(SENTRY_RELEASE ? { release: SENTRY_RELEASE } : {}),
    ...(SENTRY_SERVER_NAME ? { serverName: SENTRY_SERVER_NAME } : {}),
    tracesSampleRate: SENTRY_TRACES_SAMPLE_RATE,
    includeLocalVariables: false,
    sendDefaultPii: false,
    beforeSend(event) {
      if (event.request?.headers) {
        delete event.request.headers.authorization;
        delete event.request.headers.cookie;
        delete event.request.headers["x-session-token"];
        delete event.request.headers["x-forwarded-for"];
        delete event.request.headers["cf-connecting-ip"];
      }
      return event;
    },
  });

  console.log("[Sentry] Initialized - error tracking active", {
    environment: SENTRY_ENVIRONMENT,
    release: SENTRY_RELEASE || "unset",
    tracesSampleRate: SENTRY_TRACES_SAMPLE_RATE,
  });
} else {
  console.log("[Sentry] DSN not configured - error tracking disabled");
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
    if (SENTRY_RELEASE) {
      scope.setTag("release", SENTRY_RELEASE);
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
    if (SENTRY_RELEASE) {
      scope.setTag("release", SENTRY_RELEASE);
    }
    if (context) {
      scope.setExtras(context);
    }
    sentryModule.captureMessage(message, level);
  });
}

export { isEnabled as isSentryEnabled };
