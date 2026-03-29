import { describe, expect, test } from "bun:test";
import {
  requiresSharedRateLimitBackend,
  shouldRejectRateLimitFallback,
} from "./middleware/rateLimit.js";

describe("rate limit hardening", () => {
  test("requires shared rate limiting backend in production", () => {
    expect(requiresSharedRateLimitBackend("production")).toBe(true);
    expect(requiresSharedRateLimitBackend("development")).toBe(false);
    expect(requiresSharedRateLimitBackend("test")).toBe(false);
  });

  test("rejects in-memory fallback in production when shared backend is missing", () => {
    expect(
      shouldRejectRateLimitFallback({
        nodeEnv: "production",
        hasFastBackend: false,
        redisWindowAvailable: false,
      })
    ).toBe(true);

    expect(
      shouldRejectRateLimitFallback({
        nodeEnv: "production",
        hasFastBackend: true,
        redisWindowAvailable: false,
      })
    ).toBe(true);
  });

  test("allows non-production fallback behavior", () => {
    expect(
      shouldRejectRateLimitFallback({
        nodeEnv: "development",
        hasFastBackend: false,
        redisWindowAvailable: false,
      })
    ).toBe(false);
  });
});
