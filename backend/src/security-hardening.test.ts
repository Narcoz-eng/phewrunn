import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createSignedSessionToken, verifySignedSessionToken } from "./lib/session-token.js";
import { buildApiMeAuthTrace, getPreferredAuthCookieEntries } from "./lib/auth-trace.js";
import { PublicUserProfileDTOSchema, UpdateProfileSchema } from "./types.js";

const TEST_SESSION_SECRET = "0123456789abcdef0123456789abcdef";

describe("session token hardening", () => {
  const originalSecret = process.env.AUTH_SESSION_TOKEN_SECRET;

  beforeEach(() => {
    process.env.AUTH_SESSION_TOKEN_SECRET = TEST_SESSION_SECRET;
  });

  afterEach(() => {
    if (typeof originalSecret === "string") {
      process.env.AUTH_SESSION_TOKEN_SECRET = originalSecret;
      return;
    }
    delete process.env.AUTH_SESSION_TOKEN_SECRET;
  });

  test("normalizes and preserves server-side role claims", () => {
    const token = createSignedSessionToken({
      userId: "user_123",
      user: {
        role: "ADMIN",
        isAdmin: true,
      },
    });

    const verified = verifySignedSessionToken(token);

    expect(verified?.userId).toBe("user_123");
    expect(verified?.userClaims?.role).toBe("admin");
    expect(verified?.userClaims?.isAdmin).toBe(true);
  });

  test("requires AUTH_SESSION_TOKEN_SECRET", () => {
    delete process.env.AUTH_SESSION_TOKEN_SECRET;

    expect(() => createSignedSessionToken({ userId: "user_456" })).toThrow(
      "AUTH_SESSION_TOKEN_SECRET is required"
    );
  });
});

describe("public and profile schemas", () => {
  test("rejects walletAddress in generic profile updates", () => {
    const parsed = UpdateProfileSchema.safeParse({
      username: "safe_handle",
      walletAddress: "So11111111111111111111111111111111111111112",
    });

    expect(parsed.success).toBe(false);
  });

  test("rejects sensitive extras in public profile payloads", () => {
    const parsed = PublicUserProfileDTOSchema.safeParse({
      id: "user_123",
      username: "trader",
      image: null,
      level: 3,
      xp: 420,
      isVerified: true,
      createdAt: new Date().toISOString(),
      isFollowing: false,
      stats: {
        posts: 2,
        followers: 10,
        following: 4,
        totalCalls: 2,
        wins: 1,
        losses: 1,
        winRate: 50,
        totalProfitPercent: 12.5,
      },
      email: "victim@example.com",
      walletAddress: "So11111111111111111111111111111111111111112",
    });

    expect(parsed.success).toBe(false);
  });
});

describe("auth cookie compatibility", () => {
  test("prefers canonical session cookies over legacy cookie names", () => {
    const ordered = getPreferredAuthCookieEntries(
      [
        "better-auth.session_token=legacy-token",
        "phew.session_token=canonical-token",
        "session_token=older-token",
      ].join("; ")
    );

    expect(ordered.map((entry) => `${entry.name}:${entry.value}`)).toEqual([
      "phew.session_token:canonical-token",
      "better-auth.session_token:legacy-token",
      "session_token:older-token",
    ]);
  });

  test("auth trace reports canonical cookie when legacy cookie appears first", () => {
    const headers = new Headers({
      cookie: [
        "better-auth.session_token=legacy-token",
        "phew.session_token=canonical-token",
      ].join("; "),
    });

    const trace = buildApiMeAuthTrace(headers, "req_123");

    expect(trace.authCookieNameFound).toBe("phew.session_token");
    expect(trace.authLikeCookieCount).toBe(2);
  });
});
