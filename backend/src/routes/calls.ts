import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { type AuthVariables, requireNotBanned } from "../auth.js";
import { prisma } from "../prisma.js";
import { getEnrichedCallById, listThreadForCall } from "../services/intelligence/engine.js";

export const callsRouter = new Hono<{ Variables: AuthVariables }>();

const CallIdParamSchema = z.object({
  id: z.string().trim().min(1),
});

const ReactionSchema = z.object({
  type: z.enum(["alpha", "based", "printed", "rug"]),
});

const CommentSchema = z.object({
  content: z.string().trim().min(1).max(280),
  parentId: z.string().trim().min(1).optional(),
  kind: z.enum(["entry", "analysis", "update", "exit", "warning", "general"]).optional(),
});

callsRouter.get("/:id", zValidator("param", CallIdParamSchema), async (c) => {
  const { id } = c.req.valid("param");
  const viewer = c.get("user");
  const call = await getEnrichedCallById(id, viewer?.id ?? null);

  if (!call) {
    return c.json({ error: { message: "Call not found", code: "NOT_FOUND" } }, 404);
  }

  return c.json({ data: call });
});

callsRouter.get("/:id/quality", zValidator("param", CallIdParamSchema), async (c) => {
  const { id } = c.req.valid("param");
  const viewer = c.get("user");
  const call = await getEnrichedCallById(id, viewer?.id ?? null);

  if (!call) {
    return c.json({ error: { message: "Call not found", code: "NOT_FOUND" } }, 404);
  }

  return c.json({
    data: {
      confidenceScore: call.confidenceScore,
      hotAlphaScore: call.hotAlphaScore,
      earlyRunnerScore: call.earlyRunnerScore,
      highConvictionScore: call.highConvictionScore,
      timingTier: call.timingTier,
      firstCallerRank: call.firstCallerRank,
      roiPeakPct: call.roiPeakPct,
      roiCurrentPct: call.roiCurrentPct,
      entryQualityScore: call.entryQualityScore,
      trustedTraderCount: call.trustedTraderCount,
      bundlePenaltyScore: call.bundlePenaltyScore,
      radarReasons: call.radarReasons,
    },
  });
});

callsRouter.get("/:id/thread", zValidator("param", CallIdParamSchema), async (c) => {
  c.header("Cache-Control", "no-store");
  const { id } = c.req.valid("param");
  const thread = await listThreadForCall(id);
  return c.json({ data: thread });
});

callsRouter.post("/:id/reactions", requireNotBanned, zValidator("param", CallIdParamSchema), zValidator("json", ReactionSchema), async (c) => {
  const user = c.get("user");
  if (!user) {
    return c.json({ error: { message: "Unauthorized", code: "UNAUTHORIZED" } }, 401);
  }

  const { id } = c.req.valid("param");
  const { type } = c.req.valid("json");
  const post = await prisma.post.findUnique({
    where: { id },
    select: {
      id: true,
      authorId: true,
      content: true,
    },
  });

  if (!post) {
    return c.json({ error: { message: "Call not found", code: "NOT_FOUND" } }, 404);
  }

  const existing = await prisma.reaction.findFirst({
    where: {
      postId: id,
      userId: user.id,
    },
    select: {
      id: true,
      type: true,
    },
  });

  let currentReactionType: string | null = null;
  if (existing && existing.type === type) {
    await prisma.reaction.delete({ where: { id: existing.id } });
    currentReactionType = null;
  } else {
    await prisma.reaction.deleteMany({
      where: {
        postId: id,
        userId: user.id,
      },
    });
    await prisma.reaction.create({
      data: {
        postId: id,
        userId: user.id,
        type,
      },
    });
    currentReactionType = type;
  }

  const call = await getEnrichedCallById(id, user.id);
  if (!call) {
    return c.json({ error: { message: "Call not found", code: "NOT_FOUND" } }, 404);
  }

  return c.json({
    data: {
      reactionCounts: call.reactionCounts,
      currentReactionType,
    },
  });
});

callsRouter.post("/:id/comments", requireNotBanned, zValidator("param", CallIdParamSchema), zValidator("json", CommentSchema), async (c) => {
  const user = c.get("user");
  if (!user) {
    return c.json({ error: { message: "Unauthorized", code: "UNAUTHORIZED" } }, 401);
  }

  const { id } = c.req.valid("param");
  const { content, parentId, kind } = c.req.valid("json");
  const post = await prisma.post.findUnique({
    where: { id },
    select: {
      id: true,
      authorId: true,
    },
  });

  if (!post) {
    return c.json({ error: { message: "Call not found", code: "NOT_FOUND" } }, 404);
  }

  let parentComment:
    | {
        id: string;
        rootId: string | null;
        depth: number;
      }
    | null = null;

  if (parentId) {
    parentComment = await prisma.comment.findUnique({
      where: { id: parentId },
      select: {
        id: true,
        rootId: true,
        depth: true,
      },
    });

    if (!parentComment) {
      return c.json({ error: { message: "Parent comment not found", code: "NOT_FOUND" } }, 404);
    }
  }

  const comment = await prisma.comment.create({
    data: {
      content,
      authorId: user.id,
      postId: id,
      parentId: parentComment?.id ?? null,
      rootId: parentComment?.rootId ?? parentComment?.id ?? null,
      depth: Math.min(4, (parentComment?.depth ?? -1) + 1),
      kind: kind ?? "general",
    },
    include: {
      author: {
        select: {
          id: true,
          name: true,
          username: true,
          image: true,
          level: true,
          xp: true,
          isVerified: true,
          trustScore: true,
          reputationTier: true,
        },
      },
    },
  });

  if (parentComment) {
    await prisma.comment.update({
      where: { id: parentComment.id },
      data: {
        replyCount: { increment: 1 },
      },
    }).catch(() => undefined);
  }

  await prisma.post.update({
    where: { id },
    data: {
      threadCount: { increment: 1 },
    },
  }).catch(() => undefined);

  return c.json({ data: comment });
});
