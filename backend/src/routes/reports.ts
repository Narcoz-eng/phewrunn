import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { prisma } from "../prisma.js";
import { type AuthVariables, requireAuth } from "../auth.js";
import { CreateReportSchema } from "../types.js";

export const reportsRouter = new Hono<{ Variables: AuthVariables }>();

const ACTIVE_REPORT_STATUSES = ["open", "reviewing"] as const;

function isPrismaSchemaDriftError(error: unknown): boolean {
  const code =
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof (error as { code?: unknown }).code === "string"
      ? (error as { code: string }).code
      : "";

  if (code === "P2021" || code === "P2022") {
    return true;
  }

  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : typeof error === "object" &&
            error !== null &&
            "message" in error &&
            typeof (error as { message?: unknown }).message === "string"
          ? (error as { message: string }).message
          : "";

  const normalizedMessage = message.toLowerCase();

  return (
    normalizedMessage.includes("does not exist in the current database") ||
    normalizedMessage.includes("no such column") ||
    normalizedMessage.includes("no such table") ||
    normalizedMessage.includes("has no column named") ||
    normalizedMessage.includes("unknown arg") ||
    normalizedMessage.includes("unknown argument") ||
    normalizedMessage.includes("unknown field") ||
    (normalizedMessage.includes("column") && normalizedMessage.includes("does not exist")) ||
    (normalizedMessage.includes("table") && normalizedMessage.includes("does not exist")) ||
    (normalizedMessage.includes("relation") && normalizedMessage.includes("does not exist"))
  );
}

reportsRouter.post("/", requireAuth, zValidator("json", CreateReportSchema), async (c) => {
  const reporter = c.get("user");
  if (!reporter) {
    return c.json({ error: { message: "Unauthorized", code: "UNAUTHORIZED" } }, 401);
  }

  const payload = c.req.valid("json");

  try {
    if (payload.targetType === "post") {
      const post = await prisma.post.findUnique({
        where: { id: payload.targetId },
        select: {
          id: true,
          authorId: true,
        },
      });

      if (!post) {
        return c.json({ error: { message: "Post not found", code: "NOT_FOUND" } }, 404);
      }

      if (post.authorId === reporter.id) {
        return c.json(
          { error: { message: "You cannot report your own post", code: "INVALID_OPERATION" } },
          400
        );
      }

      const existing = await prisma.report.findFirst({
        where: {
          entityType: "post",
          postId: post.id,
          reporterUserId: reporter.id,
          status: { in: [...ACTIVE_REPORT_STATUSES] },
        },
        select: {
          id: true,
          status: true,
        },
      });

      if (existing) {
        return c.json({
          data: {
            id: existing.id,
            status: existing.status,
            duplicate: true,
          },
        });
      }

      const report = await prisma.report.create({
        data: {
          entityType: "post",
          postId: post.id,
          reporterUserId: reporter.id,
          reason: payload.reason,
          details: payload.details ?? null,
        },
        select: {
          id: true,
          status: true,
          createdAt: true,
        },
      });

      return c.json(
        {
          data: {
            id: report.id,
            status: report.status,
            duplicate: false,
            createdAt: report.createdAt.toISOString(),
          },
        },
        201
      );
    }

    const targetUser = await prisma.user.findFirst({
      where: {
        OR: [
          { id: payload.targetId },
          { username: { equals: payload.targetId.trim().toLowerCase(), mode: "insensitive" } },
        ],
      },
      select: {
        id: true,
      },
    });

    if (!targetUser) {
      return c.json({ error: { message: "User not found", code: "NOT_FOUND" } }, 404);
    }

    if (targetUser.id === reporter.id) {
      return c.json(
        { error: { message: "You cannot report yourself", code: "INVALID_OPERATION" } },
        400
      );
    }

    const existing = await prisma.report.findFirst({
      where: {
        entityType: "user",
        targetUserId: targetUser.id,
        reporterUserId: reporter.id,
        status: { in: [...ACTIVE_REPORT_STATUSES] },
      },
      select: {
        id: true,
        status: true,
      },
    });

    if (existing) {
      return c.json({
        data: {
          id: existing.id,
          status: existing.status,
          duplicate: true,
        },
      });
    }

    const report = await prisma.report.create({
      data: {
        entityType: "user",
        targetUserId: targetUser.id,
        reporterUserId: reporter.id,
        reason: payload.reason,
        details: payload.details ?? null,
      },
      select: {
        id: true,
        status: true,
        createdAt: true,
      },
    });

    return c.json(
      {
        data: {
          id: report.id,
          status: report.status,
          duplicate: false,
          createdAt: report.createdAt.toISOString(),
        },
      },
      201
    );
  } catch (error) {
    if (isPrismaSchemaDriftError(error)) {
      return c.json(
        {
          error: {
            message: "Reporting is temporarily unavailable until the database schema is updated",
            code: "REPORTING_UNAVAILABLE",
          },
        },
        503
      );
    }

    console.error("[reports/create] Failed to create report:", error);
    return c.json(
      { error: { message: "Failed to submit report", code: "INTERNAL_ERROR" } },
      500
    );
  }
});
