import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Hono } from "hono";
import type { AuthVariables } from "./auth.js";
import { prisma } from "./prisma.js";
import { adminInvitesRouter } from "./routes/admin-invites.js";

type UserDelegate = {
  findUnique: (...args: unknown[]) => Promise<unknown>;
};

type AccessCodeDelegate = {
  findMany: (...args: unknown[]) => Promise<unknown>;
  count: (...args: unknown[]) => Promise<unknown>;
};

const userDelegate = prisma.user as unknown as UserDelegate;
const accessCodeDelegate = prisma.accessCode as unknown as AccessCodeDelegate;

const originalUserFindUnique = userDelegate.findUnique;
const originalAccessCodeFindMany = accessCodeDelegate.findMany;
const originalAccessCodeCount = accessCodeDelegate.count;

function createTestApp() {
  const app = new Hono<{ Variables: AuthVariables }>();

  app.use("/api/admin/*", async (c, next) => {
    const userId = c.req.header("x-test-user-id");

    if (userId) {
      c.set("user", {
        id: userId,
        email: null,
        walletAddress: null,
        role: null,
        isAdmin: false,
        isBanned: false,
      });
    }

    return next();
  });

  app.route("/api/admin", adminInvitesRouter);

  return app;
}

describe("admin invite route protection", () => {
  beforeEach(() => {
    userDelegate.findUnique = async (...args: unknown[]) => {
      const [{ where }] = args as [{ where?: { id?: string } }];
      if (where?.id === "admin_user") {
        return { role: "admin" };
      }
      if (where?.id === "member_user") {
        return { role: "user" };
      }
      return null;
    };

    accessCodeDelegate.findMany = async () => [];
    accessCodeDelegate.count = async () => 0;
  });

  afterEach(() => {
    userDelegate.findUnique = originalUserFindUnique;
    accessCodeDelegate.findMany = originalAccessCodeFindMany;
    accessCodeDelegate.count = originalAccessCodeCount;
  });

  test("rejects unauthenticated access to admin invite routes", async () => {
    const app = createTestApp();

    const response = await app.request(
      "/api/admin/access-codes?page=1&limit=20&status=all&type=all"
    );

    expect(response.status).toBe(401);
  });

  test("rejects non-admin access to admin invite routes", async () => {
    const app = createTestApp();

    const response = await app.request(
      "/api/admin/access-codes?page=1&limit=20&status=all&type=all",
      {
        headers: {
          "x-test-user-id": "member_user",
        },
      }
    );

    expect(response.status).toBe(403);
  });

  test("allows admin access to admin invite routes", async () => {
    const app = createTestApp();

    const response = await app.request(
      "/api/admin/access-codes?page=1&limit=20&status=all&type=all",
      {
        headers: {
          "x-test-user-id": "admin_user",
        },
      }
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      data: {
        codes: [],
        total: 0,
        page: 1,
        limit: 20,
        totalPages: 0,
      },
    });
  });
});
