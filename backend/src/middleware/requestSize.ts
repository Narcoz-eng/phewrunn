import type { Context, Next } from "hono";

export function bodySizeLimit(maxBytes: number, message = "Request body is too large") {
  return async (c: Context, next: Next) => {
    const method = c.req.method.toUpperCase();
    if (method === "GET" || method === "HEAD" || method === "OPTIONS") {
      return next();
    }

    const rawContentLength = c.req.header("content-length");
    if (!rawContentLength) {
      return next();
    }

    const contentLength = Number(rawContentLength);
    if (!Number.isFinite(contentLength) || contentLength <= maxBytes) {
      return next();
    }

    return c.json(
      {
        error: {
          message,
          code: "PAYLOAD_TOO_LARGE",
          maxBytes,
        },
      },
      413
    );
  };
}
