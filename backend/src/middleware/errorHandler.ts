import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { ZodError } from "zod";

/**
 * Error Handler Utilities
 *
 * Provides consistent error handling across the application.
 * Ensures stack traces are not leaked in production.
 */

/**
 * Standard error response format
 */
export interface ErrorResponse {
  error: {
    message: string;
    code: string;
    details?: unknown;
  };
}

/**
 * Application error codes
 */
export const ERROR_CODES = {
  // Auth errors
  UNAUTHORIZED: "UNAUTHORIZED",
  FORBIDDEN: "FORBIDDEN",
  INVALID_TOKEN: "INVALID_TOKEN",

  // Validation errors
  VALIDATION_ERROR: "VALIDATION_ERROR",
  INVALID_INPUT: "INVALID_INPUT",

  // Resource errors
  NOT_FOUND: "NOT_FOUND",
  ALREADY_EXISTS: "ALREADY_EXISTS",
  CONFLICT: "CONFLICT",

  // Rate limiting
  RATE_LIMIT_EXCEEDED: "RATE_LIMIT_EXCEEDED",

  // Server errors
  INTERNAL_ERROR: "INTERNAL_ERROR",
  DATABASE_ERROR: "DATABASE_ERROR",
  EXTERNAL_SERVICE_ERROR: "EXTERNAL_SERVICE_ERROR",

  // Business logic errors
  LIQUIDATED: "LIQUIDATED",
  CA_REQUIRED: "CA_REQUIRED",
  CANNOT_REPOST_OWN: "CANNOT_REPOST_OWN",
  ALREADY_LIKED: "ALREADY_LIKED",
  ALREADY_REPOSTED: "ALREADY_REPOSTED",
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

/**
 * Custom application error class
 */
export class AppError extends Error {
  public readonly code: ErrorCode;
  public readonly statusCode: number;
  public readonly details?: unknown;

  constructor(
    message: string,
    code: ErrorCode,
    statusCode: number = 500,
    details?: unknown
  ) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;

    // Capture stack trace
    Error.captureStackTrace(this, this.constructor);
  }
}

/**
 * Convert a Zod error to a user-friendly format
 */
function formatZodError(error: ZodError): { message: string; details: unknown } {
  const issues = error.issues.map((issue) => ({
    field: issue.path.join("."),
    message: issue.message,
  }));

  return {
    message: "Validation failed",
    details: issues,
  };
}

/**
 * Create the global error handler for Hono
 */
export function createErrorHandler() {
  const isProduction = process.env.NODE_ENV === "production";

  return (err: Error, c: Context) => {
    // Get request ID if available
    const requestId = c.get("requestId") as string | undefined;

    // Log the error with context
    const logData = {
      requestId,
      method: c.req.method,
      path: c.req.path,
      error: err.message,
      stack: isProduction ? undefined : err.stack,
    };

    // Handle specific error types
    if (err instanceof AppError) {
      // Our custom application errors
      console.error("[AppError]", logData);

      return c.json(
        {
          error: {
            message: err.message,
            code: err.code,
            ...(err.details && !isProduction ? { details: err.details } : {}),
          },
        } satisfies ErrorResponse,
        err.statusCode as 400 | 401 | 403 | 404 | 409 | 429 | 500
      );
    }

    if (err instanceof ZodError) {
      // Validation errors from Zod
      const formatted = formatZodError(err);
      console.error("[ValidationError]", { ...logData, details: formatted.details });

      return c.json(
        {
          error: {
            message: formatted.message,
            code: ERROR_CODES.VALIDATION_ERROR,
            details: formatted.details,
          },
        } satisfies ErrorResponse,
        400
      );
    }

    if (err instanceof HTTPException) {
      // Hono HTTP exceptions
      console.error("[HTTPException]", logData);

      return c.json(
        {
          error: {
            message: err.message || "Request failed",
            code: err.status === 401 ? ERROR_CODES.UNAUTHORIZED : ERROR_CODES.INTERNAL_ERROR,
          },
        } satisfies ErrorResponse,
        err.status
      );
    }

    // Handle Prisma errors
    if (err.name === "PrismaClientKnownRequestError") {
      const prismaError = err as { code?: string; meta?: { target?: string[] } };
      console.error("[PrismaError]", { ...logData, prismaCode: prismaError.code });

      // Handle common Prisma error codes
      if (prismaError.code === "P2002") {
        // Unique constraint violation
        const target = prismaError.meta?.target?.join(", ") || "field";
        return c.json(
          {
            error: {
              message: `A record with this ${target} already exists`,
              code: ERROR_CODES.ALREADY_EXISTS,
            },
          } satisfies ErrorResponse,
          409
        );
      }

      if (prismaError.code === "P2025") {
        // Record not found
        return c.json(
          {
            error: {
              message: "Record not found",
              code: ERROR_CODES.NOT_FOUND,
            },
          } satisfies ErrorResponse,
          404
        );
      }

      // Generic database error
      return c.json(
        {
          error: {
            message: isProduction
              ? "A database error occurred"
              : err.message,
            code: ERROR_CODES.DATABASE_ERROR,
          },
        } satisfies ErrorResponse,
        500
      );
    }

    // Unknown errors - don't leak details in production
    console.error("[UnknownError]", {
      ...logData,
      errorName: err.name,
      errorStack: err.stack,
    });

    return c.json(
      {
        error: {
          message: isProduction
            ? "An unexpected error occurred"
            : err.message,
          code: ERROR_CODES.INTERNAL_ERROR,
          ...(requestId ? { requestId } : {}),
        },
      } satisfies ErrorResponse,
      500
    );
  };
}

/**
 * Helper function to create common errors
 */
export const Errors = {
  unauthorized: (message = "Unauthorized") =>
    new AppError(message, ERROR_CODES.UNAUTHORIZED, 401),

  forbidden: (message = "Forbidden") =>
    new AppError(message, ERROR_CODES.FORBIDDEN, 403),

  notFound: (resource = "Resource") =>
    new AppError(`${resource} not found`, ERROR_CODES.NOT_FOUND, 404),

  conflict: (message: string) =>
    new AppError(message, ERROR_CODES.CONFLICT, 409),

  validation: (message: string, details?: unknown) =>
    new AppError(message, ERROR_CODES.VALIDATION_ERROR, 400, details),

  rateLimit: (message = "Rate limit exceeded") =>
    new AppError(message, ERROR_CODES.RATE_LIMIT_EXCEEDED, 429),

  internal: (message = "Internal server error") =>
    new AppError(message, ERROR_CODES.INTERNAL_ERROR, 500),
};
