import type { Context, Next } from "hono";
import { z } from "zod";

/**
 * Input Sanitization Middleware
 *
 * Provides XSS prevention by sanitizing user input.
 * Works in conjunction with Zod validation for defense in depth.
 */

/**
 * HTML entities to escape for XSS prevention
 */
const HTML_ENTITIES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#x27;",
  "/": "&#x2F;",
  "`": "&#x60;",
  "=": "&#x3D;",
};

/**
 * Regex pattern for HTML entity escaping
 */
const HTML_ESCAPE_REGEX = /[&<>"'`=/]/g;

/**
 * Escape HTML entities to prevent XSS
 */
export function escapeHtml(str: string): string {
  return str.replace(HTML_ESCAPE_REGEX, (char) => HTML_ENTITIES[char] || char);
}

/**
 * Remove HTML tags from a string
 * Use when you want to strip all HTML, not just escape it
 */
export function stripHtml(str: string): string {
  return str
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "") // Remove script tags and content
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, "") // Remove style tags and content
    .replace(/<[^>]+>/g, "") // Remove remaining HTML tags
    .replace(/javascript:/gi, "") // Remove javascript: protocol
    .replace(/on\w+\s*=/gi, ""); // Remove event handlers
}

/**
 * Sanitize a string value
 * Removes HTML tags and trims whitespace
 */
export function sanitizeString(str: string): string {
  if (typeof str !== "string") return str;
  return stripHtml(str).trim();
}

/**
 * Deep sanitize an object, sanitizing all string values
 */
export function sanitizeObject<T>(obj: T): T {
  if (obj === null || obj === undefined) return obj;

  if (typeof obj === "string") {
    return sanitizeString(obj) as T;
  }

  if (Array.isArray(obj)) {
    return obj.map(sanitizeObject) as T;
  }

  if (typeof obj === "object") {
    const sanitized: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      sanitized[key] = sanitizeObject(value);
    }
    return sanitized as T;
  }

  return obj;
}

/**
 * Fields that should NOT be sanitized (e.g., passwords)
 * These fields may contain special characters that are valid
 */
const SKIP_SANITIZE_FIELDS = new Set([
  "password",
  "passwordHash",
  "token",
  "accessToken",
  "refreshToken",
  "signature",
  "privateKey",
  "secret",
]);

/**
 * Deep sanitize an object, skipping sensitive fields
 */
export function sanitizeObjectSafe<T>(
  obj: T,
  skipFields: Set<string> = SKIP_SANITIZE_FIELDS
): T {
  if (obj === null || obj === undefined) return obj;

  if (typeof obj === "string") {
    return sanitizeString(obj) as T;
  }

  if (Array.isArray(obj)) {
    return obj.map((item) => sanitizeObjectSafe(item, skipFields)) as T;
  }

  if (typeof obj === "object") {
    const sanitized: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      if (skipFields.has(key)) {
        sanitized[key] = value; // Skip sanitization for sensitive fields
      } else {
        sanitized[key] = sanitizeObjectSafe(value, skipFields);
      }
    }
    return sanitized as T;
  }

  return obj;
}

/**
 * Middleware to sanitize JSON request body
 * Strips HTML tags from all string fields
 */
export function sanitizeBody() {
  return async (c: Context, next: Next) => {
    // Only process JSON requests
    const contentType = c.req.header("content-type");
    if (!contentType?.includes("application/json")) {
      return next();
    }

    // Skip if no body
    const body = await c.req.raw.clone().text();
    if (!body) {
      return next();
    }

    try {
      const parsed = JSON.parse(body);
      const sanitized = sanitizeObjectSafe(parsed);

      // Store sanitized body in context for later use
      c.set("sanitizedBody", sanitized);
    } catch {
      // If parsing fails, let the route handler deal with it
    }

    await next();
  };
}

/**
 * Middleware to sanitize query parameters
 */
export function sanitizeQuery() {
  return async (c: Context, next: Next) => {
    // Query params are already parsed by Hono, so we just sanitize what's there
    // Note: This doesn't modify the original query, just provides sanitized versions
    const queries = c.req.queries();
    const sanitized: Record<string, string[]> = {};

    for (const [key, values] of Object.entries(queries)) {
      sanitized[key] = values.map(sanitizeString);
    }

    c.set("sanitizedQuery", sanitized);

    await next();
  };
}

/**
 * Validate that a string doesn't contain dangerous patterns
 * Returns true if the string is safe
 */
export function isSafeString(str: string): boolean {
  if (typeof str !== "string") return true;

  // Check for script injection attempts
  const dangerousPatterns = [
    /<script/i,
    /javascript:/i,
    /on\w+\s*=/i, // Event handlers like onclick=
    /data:/i, // Data URLs
    /<iframe/i,
    /<object/i,
    /<embed/i,
    /<form/i,
  ];

  return !dangerousPatterns.some((pattern) => pattern.test(str));
}

/**
 * Zod transformer that sanitizes strings
 * Use this with your existing Zod schemas for defense in depth
 *
 * Example:
 * const schema = z.object({
 *   content: z.string().transform(sanitizedString)
 * });
 */
export function sanitizedString(str: string): string {
  return sanitizeString(str);
}

/**
 * Create a Zod string schema with built-in sanitization
 *
 * Example:
 * const schema = z.object({
 *   content: safeString().min(1).max(500)
 * });
 */
export function safeString() {
  return z.string().transform(sanitizedString);
}

/**
 * Sanitize URL to prevent javascript: and data: protocols
 */
export function sanitizeUrl(url: string): string | null {
  if (!url) return null;

  const trimmed = url.trim().toLowerCase();

  // Block dangerous protocols
  if (
    trimmed.startsWith("javascript:") ||
    trimmed.startsWith("data:") ||
    trimmed.startsWith("vbscript:")
  ) {
    return null;
  }

  return url.trim();
}

/**
 * Validate and sanitize a wallet address
 * Allows only alphanumeric characters and expected prefixes
 */
export function sanitizeWalletAddress(address: string): string | null {
  if (!address) return null;

  const trimmed = address.trim();

  // EVM address: 0x followed by 40 hex characters
  const evmRegex = /^0x[a-fA-F0-9]{40}$/;

  // Solana address: Base58, 32-44 characters
  const solanaRegex = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

  if (evmRegex.test(trimmed) || solanaRegex.test(trimmed)) {
    return trimmed;
  }

  return null;
}
