import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { type AuthVariables, requireAuth, requireNotBanned } from "../auth.js";
import { prisma } from "../prisma.js";
import { findTokenByAddress } from "../services/intelligence/engine.js";
import { invalidateNotificationsCache } from "./notifications.js";
import {
  TOKEN_RAID_TEMPLATE_IDS,
  TokenRaidCopyOptionSchema,
  TokenRaidGenerationResultSchema,
  TokenRaidMemeOptionSchema,
  safeGenerateTokenRaidOptions,
} from "../services/token-raid-generation.js";

export const tokenCommunitiesRouter = new Hono<{ Variables: AuthVariables }>();

const TokenAddressParamSchema = z.object({
  tokenAddress: z.string().trim().min(1),
});

const ThreadListQuerySchema = z.object({
  cursor: z.string().trim().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(30).optional(),
});

const CommunityProfilePatchSchema = z
  .object({
    headline: z.string().trim().min(8).max(120).nullable().optional(),
    xCashtag: z
      .string()
      .trim()
      .regex(/^\$?[A-Za-z0-9_]{1,15}$/, "X cashtag must be 1-15 letters/numbers/underscores")
      .nullable()
      .optional(),
    voiceHints: z.array(z.string().trim().min(3).max(60)).max(6).optional(),
    insideJokes: z.array(z.string().trim().min(4).max(80)).max(6).optional(),
    preferredTemplateIds: z.array(z.enum(TOKEN_RAID_TEMPLATE_IDS)).max(6).optional(),
    raidLeadMinLevel: z.number().int().min(3).max(10).optional(),
  })
  .strict();

const CreateThreadSchema = z
  .object({
    title: z.string().trim().min(4).max(80).optional(),
    content: z.string().trim().min(6).max(600),
  })
  .strict();

const CreateReplySchema = z
  .object({
    content: z.string().trim().min(2).max(400),
    parentId: z.string().trim().min(1).optional(),
  })
  .strict();

const CreateRaidSchema = z
  .object({
    objective: z.string().trim().min(10).max(160).optional(),
    replaceActive: z.boolean().optional(),
  })
  .strict();

const LaunchRaidSchema = z
  .object({
    memeOptionId: z.string().trim().min(1),
    copyOptionId: z.string().trim().min(1),
    renderPayloadJson: z.record(z.string(), z.unknown()),
    composerText: z.string().trim().min(10).max(280),
  })
  .strict();

const PatchRaidSubmissionSchema = z
  .object({
    xPostUrl: z
      .string()
      .trim()
      .url()
      .refine(
        (value) =>
          /^https:\/\/(www\.)?(x|twitter)\.com\/[^/]+\/status\/\d+/i.test(value),
        "Provide a valid X post URL",
      ),
  })
  .strict();

const COMMUNITY_PROFILE_DEFAULT_VOICE_HINTS = [
  "dry confidence",
  "internet-native and sharp",
  "receipts over slogans",
];

const COMMUNITY_PROFILE_DEFAULT_JOKES = [
  "the group chat hears the boss music first",
  "the chart keeps trying to act innocent",
  "receipts age better than cope",
];

function normalizeCashtag(value: string | null | undefined, symbol: string | null | undefined): string | null {
  const raw = (value ?? "").trim() || (symbol ? `$${symbol}` : "");
  if (!raw) return null;
  return raw.startsWith("$") ? raw.toUpperCase() : `$${raw.toUpperCase()}`;
}

function normalizeStringList(input: unknown, fallback: string[] = []): string[] {
  if (!Array.isArray(input)) return [...fallback];
  const values = input
    .map((value) => (typeof value === "string" ? value.trim() : ""))
    .filter((value) => value.length > 0);
  return values.length > 0 ? values.slice(0, 6) : [...fallback];
}

function buildProfileResponse(
  token: { symbol: string | null; name: string | null },
  profile: {
    id: string;
    headline: string | null;
    xCashtag: string | null;
    voiceHints: unknown;
    insideJokes: unknown;
    preferredTemplateIds: unknown;
    raidLeadMinLevel: number;
    updatedAt: Date;
  } | null,
) {
  const cashtag = normalizeCashtag(profile?.xCashtag, token.symbol);
  const tokenName = token.name?.trim() || token.symbol?.trim() || "This token";
  return {
    id: profile?.id ?? null,
    headline:
      profile?.headline?.trim() ||
      `${tokenName} has a fast, online community that trades jokes and receipts at the same time.`,
    xCashtag: cashtag,
    voiceHints: normalizeStringList(profile?.voiceHints, [...COMMUNITY_PROFILE_DEFAULT_VOICE_HINTS]),
    insideJokes: normalizeStringList(profile?.insideJokes, [...COMMUNITY_PROFILE_DEFAULT_JOKES]),
    preferredTemplateIds: normalizeStringList(profile?.preferredTemplateIds),
    raidLeadMinLevel: profile?.raidLeadMinLevel ?? 3,
    updatedAt: profile?.updatedAt?.toISOString() ?? null,
  };
}

function encodeCursor(createdAt: Date, id: string): string {
  return Buffer.from(`${createdAt.toISOString()}|${id}`, "utf8").toString("base64url");
}

function decodeCursor(cursor: string | undefined): { createdAt: Date; id: string } | null {
  if (!cursor) return null;
  try {
    const raw = Buffer.from(cursor, "base64url").toString("utf8");
    const [timestamp, id] = raw.split("|");
    if (!timestamp || !id) return null;
    const createdAt = new Date(timestamp);
    if (Number.isNaN(createdAt.getTime())) return null;
    return { createdAt, id };
  } catch {
    return null;
  }
}

async function resolveTokenByAddressOrThrow(tokenAddress: string) {
  const token = await findTokenByAddress(tokenAddress);
  if (!token) throw new Error("TOKEN_NOT_FOUND");
  return token;
}

async function resolveViewerState(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      name: true,
      username: true,
      image: true,
      level: true,
      isAdmin: true,
      isVerified: true,
    },
  });
  if (!user) throw new Error("USER_NOT_FOUND");
  return user;
}

function assertTrustedMember(viewer: { level: number; isAdmin: boolean }, requiredLevel = 3): void {
  if (viewer.isAdmin) return;
  if (viewer.level < requiredLevel) {
    throw new Error("INSUFFICIENT_LEVEL");
  }
}

function parseStoredMemeOptions(value: unknown) {
  const parsed = z.array(TokenRaidMemeOptionSchema).safeParse(value);
  if (!parsed.success) throw new Error("INVALID_MEME_OPTIONS");
  return parsed.data;
}

function parseStoredCopyOptions(value: unknown) {
  const parsed = z.array(TokenRaidCopyOptionSchema).safeParse(value);
  if (!parsed.success) throw new Error("INVALID_COPY_OPTIONS");
  return parsed.data;
}

function serializeAuthor(author: {
  id: string;
  name: string;
  username: string | null;
  image: string | null;
  level: number;
  isVerified?: boolean | null;
}) {
  return {
    id: author.id,
    name: author.name,
    username: author.username,
    image: author.image,
    level: author.level,
    isVerified: author.isVerified ?? false,
  };
}

function serializeThread(thread: {
  id: string;
  title: string | null;
  content: string;
  kind: string;
  raidCampaignId: string | null;
  replyCount: number;
  isPinned: boolean;
  lastActivityAt: Date;
  deletedAt: Date | null;
  createdAt: Date;
  author: {
    id: string;
    name: string;
    username: string | null;
    image: string | null;
    level: number;
    isVerified: boolean;
  };
}) {
  return {
    id: thread.id,
    title: thread.deletedAt ? null : thread.title,
    content: thread.deletedAt ? "Message deleted." : thread.content,
    kind: thread.kind,
    raidCampaignId: thread.raidCampaignId,
    replyCount: thread.replyCount,
    isPinned: thread.isPinned,
    lastActivityAt: thread.lastActivityAt.toISOString(),
    deletedAt: thread.deletedAt?.toISOString() ?? null,
    createdAt: thread.createdAt.toISOString(),
    author: serializeAuthor(thread.author),
  };
}

function serializeReply(reply: {
  id: string;
  content: string;
  parentId: string | null;
  rootId: string | null;
  depth: number;
  deletedAt: Date | null;
  createdAt: Date;
  author: {
    id: string;
    name: string;
    username: string | null;
    image: string | null;
    level: number;
    isVerified: boolean;
  };
}) {
  return {
    id: reply.id,
    content: reply.deletedAt ? "Reply deleted." : reply.content,
    parentId: reply.parentId,
    rootId: reply.rootId,
    depth: reply.depth,
    deletedAt: reply.deletedAt?.toISOString() ?? null,
    createdAt: reply.createdAt.toISOString(),
    author: serializeAuthor(reply.author),
  };
}

function serializeSubmission(submission: {
  id: string;
  memeOptionId: string;
  copyOptionId: string;
  renderPayloadJson: unknown;
  composerText: string;
  xPostUrl: string | null;
  postedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  user: {
    id: string;
    name: string;
    username: string | null;
    image: string | null;
    level: number;
    isVerified: boolean;
  };
}) {
  return {
    id: submission.id,
    memeOptionId: submission.memeOptionId,
    copyOptionId: submission.copyOptionId,
    renderPayloadJson: submission.renderPayloadJson,
    composerText: submission.composerText,
    xPostUrl: submission.xPostUrl,
    postedAt: submission.postedAt?.toISOString() ?? null,
    createdAt: submission.createdAt.toISOString(),
    updatedAt: submission.updatedAt.toISOString(),
    user: serializeAuthor(submission.user),
  };
}

async function fanoutRaidStartedNotifications(params: {
  tokenId: string;
  tokenSymbol: string | null;
  raidId: string;
  creatorId: string;
  creatorLabel: string;
}) {
  const followers = await prisma.tokenFollow.findMany({
    where: {
      tokenId: params.tokenId,
      userId: { not: params.creatorId },
    },
    select: { userId: true },
    take: 400,
  });

  if (followers.length === 0) return;

  const tokenLabel = params.tokenSymbol ? `$${params.tokenSymbol}` : "this token";
  const notifications = followers.map((follower) => ({
    userId: follower.userId,
    type: "raid_started",
    message: `${params.creatorLabel} started a raid for ${tokenLabel}.`,
    dedupeKey: `raid_started:${params.raidId}:${follower.userId}`,
    fromUserId: params.creatorId,
    entityType: "token_raid_campaign",
    entityId: params.raidId,
    reasonCode: "raid_started",
    payload: {
      raidId: params.raidId,
      tokenId: params.tokenId,
      tokenSymbol: params.tokenSymbol,
    },
    priority: 2,
  }));

  await prisma.notification.createMany({ data: notifications, skipDuplicates: true });
  for (const follower of followers) {
    invalidateNotificationsCache(follower.userId);
  }
}

async function createCommunityReplyNotification(params: {
  threadId: string;
  recipientUserId: string;
  actorId: string;
  actorLabel: string;
}) {
  if (params.recipientUserId === params.actorId) return;
  await prisma.notification.create({
    data: {
      userId: params.recipientUserId,
      type: "community_reply",
      message: `${params.actorLabel} replied in your token community thread.`,
      dedupeKey: `community_reply:${params.threadId}:${params.actorId}:${Date.now()}`,
      fromUserId: params.actorId,
      entityType: "token_community_thread",
      entityId: params.threadId,
      reasonCode: "community_reply",
      priority: 1,
    },
  }).catch(() => undefined);
  invalidateNotificationsCache(params.recipientUserId);
}

async function loadRaidContext(tokenId: string) {
  const [tokenRecord, profile, recentThreads, recentRaids] = await Promise.all([
    prisma.token.findUnique({
      where: { id: tokenId },
      select: {
        id: true,
        symbol: true,
        name: true,
        chainType: true,
        holderCount: true,
        sentimentScore: true,
        confidenceScore: true,
        hotAlphaScore: true,
        earlyRunnerScore: true,
        highConvictionScore: true,
      },
    }),
    prisma.tokenCommunityProfile.findUnique({
      where: { tokenId },
      select: {
        headline: true,
        xCashtag: true,
        voiceHints: true,
        insideJokes: true,
        preferredTemplateIds: true,
      },
    }),
    prisma.tokenCommunityThread.findMany({
      where: {
        tokenId,
        deletedAt: null,
      },
      select: {
        title: true,
        content: true,
        createdAt: true,
        author: {
          select: {
            name: true,
            username: true,
          },
        },
      },
      orderBy: [{ lastActivityAt: "desc" }, { createdAt: "desc" }],
      take: 12,
    }),
    prisma.tokenRaidCampaign.findMany({
      where: { tokenId },
      select: {
        objective: true,
        memeOptionsJson: true,
        copyOptionsJson: true,
      },
      orderBy: { openedAt: "desc" },
      take: 5,
    }),
  ]);

  if (!tokenRecord) {
    throw new Error("TOKEN_NOT_FOUND");
  }

  return {
    token: tokenRecord,
    profile: profile
      ? {
          ...profile,
          voiceHints: normalizeStringList(profile.voiceHints),
          insideJokes: normalizeStringList(profile.insideJokes),
          preferredTemplateIds: normalizeStringList(profile.preferredTemplateIds),
        }
      : null,
    recentThreads: recentThreads.map((thread) => ({
      title: thread.title,
      content: thread.content,
      authorName: thread.author.name,
      authorUsername: thread.author.username,
      createdAt: thread.createdAt,
    })),
    recentRaidHistory: recentRaids.map((raid) => ({
      objective: raid.objective,
      memeOptions: raid.memeOptionsJson,
      copyOptions: raid.copyOptionsJson,
    })),
  };
}

async function loadActiveRaidView(tokenId: string, viewerId: string | null) {
  const active = await prisma.tokenRaidCampaign.findFirst({
    where: {
      tokenId,
      status: "active",
    },
    select: {
      id: true,
      status: true,
      objective: true,
      memeOptionsJson: true,
      copyOptionsJson: true,
      openedAt: true,
      closedAt: true,
      createdAt: true,
      updatedAt: true,
      createdBy: {
        select: {
          id: true,
          name: true,
          username: true,
          image: true,
          level: true,
          isVerified: true,
        },
      },
      thread: {
        select: {
          id: true,
        },
      },
      submissions: {
        select: {
          id: true,
          memeOptionId: true,
          copyOptionId: true,
          renderPayloadJson: true,
          composerText: true,
          xPostUrl: true,
          postedAt: true,
          createdAt: true,
          updatedAt: true,
          user: {
            select: {
              id: true,
              name: true,
              username: true,
              image: true,
              level: true,
              isVerified: true,
            },
          },
        },
        orderBy: [{ postedAt: "desc" }, { createdAt: "desc" }],
        take: 40,
      },
    },
    orderBy: { openedAt: "desc" },
  });

  if (!active) {
    return { campaign: null, submissions: [], mySubmission: null };
  }

  const memeOptions = parseStoredMemeOptions(active.memeOptionsJson);
  const copyOptions = parseStoredCopyOptions(active.copyOptionsJson);
  const visibleSubmissions = active.submissions.filter((submission) => submission.xPostUrl);
  const mySubmission = viewerId
    ? active.submissions.find((submission) => submission.user.id === viewerId) ?? null
    : null;

  return {
    campaign: {
      id: active.id,
      status: active.status,
      objective: active.objective,
      memeOptions,
      copyOptions,
      openedAt: active.openedAt.toISOString(),
      closedAt: active.closedAt?.toISOString() ?? null,
      createdAt: active.createdAt.toISOString(),
      updatedAt: active.updatedAt.toISOString(),
      threadId: active.thread?.id ?? null,
      createdBy: serializeAuthor(active.createdBy),
    },
    submissions: visibleSubmissions.map((submission) =>
      serializeSubmission(submission as Parameters<typeof serializeSubmission>[0]),
    ),
    mySubmission: mySubmission
      ? serializeSubmission(mySubmission as Parameters<typeof serializeSubmission>[0])
      : null,
  };
}

tokenCommunitiesRouter.get(
  "/:tokenAddress/community/profile",
  requireAuth,
  zValidator("param", TokenAddressParamSchema),
  async (c) => {
    try {
      const token = await resolveTokenByAddressOrThrow(c.req.valid("param").tokenAddress);
      const profile = await prisma.tokenCommunityProfile.findUnique({
        where: { tokenId: token.id },
        select: {
          id: true,
          headline: true,
          xCashtag: true,
          voiceHints: true,
          insideJokes: true,
          preferredTemplateIds: true,
          raidLeadMinLevel: true,
          updatedAt: true,
        },
      });

      return c.json({ data: buildProfileResponse(token, profile) });
    } catch (error) {
      if (error instanceof Error && error.message === "TOKEN_NOT_FOUND") {
        return c.json({ error: { message: "Token not found", code: "NOT_FOUND" } }, 404);
      }
      throw error;
    }
  },
);

tokenCommunitiesRouter.patch(
  "/:tokenAddress/community/profile",
  requireNotBanned,
  zValidator("param", TokenAddressParamSchema),
  zValidator("json", CommunityProfilePatchSchema),
  async (c) => {
    const viewer = await resolveViewerState(c.get("user")!.id);
    try {
      const token = await resolveTokenByAddressOrThrow(c.req.valid("param").tokenAddress);
      const payload = c.req.valid("json");
      const existing = await prisma.tokenCommunityProfile.findUnique({
        where: { tokenId: token.id },
        select: { raidLeadMinLevel: true },
      });
      assertTrustedMember(viewer, Math.max(existing?.raidLeadMinLevel ?? 3, 3));

      const profile = await prisma.tokenCommunityProfile.upsert({
        where: { tokenId: token.id },
        create: {
          tokenId: token.id,
          headline: payload.headline ?? null,
          xCashtag: normalizeCashtag(payload.xCashtag ?? null, token.symbol),
          voiceHints: payload.voiceHints ?? [...COMMUNITY_PROFILE_DEFAULT_VOICE_HINTS],
          insideJokes: payload.insideJokes ?? [...COMMUNITY_PROFILE_DEFAULT_JOKES],
          preferredTemplateIds: payload.preferredTemplateIds ?? [],
          raidLeadMinLevel: payload.raidLeadMinLevel ?? 3,
          updatedById: viewer.id,
        },
        update: {
          ...(payload.headline !== undefined ? { headline: payload.headline } : {}),
          ...(payload.xCashtag !== undefined
            ? { xCashtag: normalizeCashtag(payload.xCashtag, token.symbol) }
            : {}),
          ...(payload.voiceHints !== undefined ? { voiceHints: payload.voiceHints } : {}),
          ...(payload.insideJokes !== undefined ? { insideJokes: payload.insideJokes } : {}),
          ...(payload.preferredTemplateIds !== undefined
            ? { preferredTemplateIds: payload.preferredTemplateIds }
            : {}),
          ...(payload.raidLeadMinLevel !== undefined
            ? { raidLeadMinLevel: payload.raidLeadMinLevel }
            : {}),
          updatedById: viewer.id,
        },
        select: {
          id: true,
          headline: true,
          xCashtag: true,
          voiceHints: true,
          insideJokes: true,
          preferredTemplateIds: true,
          raidLeadMinLevel: true,
          updatedAt: true,
        },
      });

      return c.json({ data: buildProfileResponse(token, profile) });
    } catch (error) {
      if (error instanceof Error && error.message === "TOKEN_NOT_FOUND") {
        return c.json({ error: { message: "Token not found", code: "NOT_FOUND" } }, 404);
      }
      if (error instanceof Error && error.message === "INSUFFICIENT_LEVEL") {
        return c.json(
          { error: { message: "Trusted members only", code: "INSUFFICIENT_LEVEL" } },
          403,
        );
      }
      throw error;
    }
  },
);

tokenCommunitiesRouter.get(
  "/:tokenAddress/community/threads",
  requireAuth,
  zValidator("param", TokenAddressParamSchema),
  zValidator("query", ThreadListQuerySchema),
  async (c) => {
    try {
      const token = await resolveTokenByAddressOrThrow(c.req.valid("param").tokenAddress);
      const query = c.req.valid("query");
      const cursor = decodeCursor(query.cursor);
      const limit = query.limit ?? 12;
      const threads = await prisma.tokenCommunityThread.findMany({
        where: {
          tokenId: token.id,
          ...(cursor
            ? {
                OR: [
                  { createdAt: { lt: cursor.createdAt } },
                  { createdAt: cursor.createdAt, id: { lt: cursor.id } },
                ],
              }
            : {}),
        },
        select: {
          id: true,
          title: true,
          content: true,
          kind: true,
          raidCampaignId: true,
          replyCount: true,
          isPinned: true,
          lastActivityAt: true,
          deletedAt: true,
          createdAt: true,
          author: {
            select: {
              id: true,
              name: true,
              username: true,
              image: true,
              level: true,
              isVerified: true,
            },
          },
        },
        orderBy: [{ isPinned: "desc" }, { createdAt: "desc" }, { id: "desc" }],
        take: limit + 1,
      });

      const hasMore = threads.length > limit;
      const items = hasMore ? threads.slice(0, limit) : threads;
      const nextCursor =
        hasMore && items.length > 0
          ? encodeCursor(items[items.length - 1]!.createdAt, items[items.length - 1]!.id)
          : null;

      return c.json({
        data: {
          items: items.map((thread) => serializeThread(thread)),
          hasMore,
          nextCursor,
        },
      });
    } catch (error) {
      if (error instanceof Error && error.message === "TOKEN_NOT_FOUND") {
        return c.json({ error: { message: "Token not found", code: "NOT_FOUND" } }, 404);
      }
      throw error;
    }
  },
);

tokenCommunitiesRouter.post(
  "/:tokenAddress/community/threads",
  requireNotBanned,
  zValidator("param", TokenAddressParamSchema),
  zValidator("json", CreateThreadSchema),
  async (c) => {
    try {
      const token = await resolveTokenByAddressOrThrow(c.req.valid("param").tokenAddress);
      const payload = c.req.valid("json");
      const viewer = c.get("user")!;
      const thread = await prisma.tokenCommunityThread.create({
        data: {
          tokenId: token.id,
          authorId: viewer.id,
          title: payload.title?.trim() || null,
          content: payload.content.trim(),
          kind: "general",
          lastActivityAt: new Date(),
        },
        select: {
          id: true,
          title: true,
          content: true,
          kind: true,
          raidCampaignId: true,
          replyCount: true,
          isPinned: true,
          lastActivityAt: true,
          deletedAt: true,
          createdAt: true,
          author: {
            select: {
              id: true,
              name: true,
              username: true,
              image: true,
              level: true,
              isVerified: true,
            },
          },
        },
      });

      return c.json({ data: serializeThread(thread) }, 201);
    } catch (error) {
      if (error instanceof Error && error.message === "TOKEN_NOT_FOUND") {
        return c.json({ error: { message: "Token not found", code: "NOT_FOUND" } }, 404);
      }
      throw error;
    }
  },
);

tokenCommunitiesRouter.get(
  "/:tokenAddress/community/threads/:threadId/replies",
  requireAuth,
  zValidator("param", TokenAddressParamSchema.extend({ threadId: z.string().trim().min(1) })),
  async (c) => {
    try {
      const { tokenAddress, threadId } = c.req.valid("param");
      const token = await resolveTokenByAddressOrThrow(tokenAddress);
      const thread = await prisma.tokenCommunityThread.findFirst({
        where: { id: threadId, tokenId: token.id },
        select: { id: true },
      });
      if (!thread) {
        return c.json({ error: { message: "Thread not found", code: "NOT_FOUND" } }, 404);
      }

      const replies = await prisma.tokenCommunityReply.findMany({
        where: { threadId: thread.id },
        select: {
          id: true,
          content: true,
          parentId: true,
          rootId: true,
          depth: true,
          deletedAt: true,
          createdAt: true,
          author: {
            select: {
              id: true,
              name: true,
              username: true,
              image: true,
              level: true,
              isVerified: true,
            },
          },
        },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      });

      return c.json({ data: replies.map((reply) => serializeReply(reply)) });
    } catch (error) {
      if (error instanceof Error && error.message === "TOKEN_NOT_FOUND") {
        return c.json({ error: { message: "Token not found", code: "NOT_FOUND" } }, 404);
      }
      throw error;
    }
  },
);

tokenCommunitiesRouter.post(
  "/:tokenAddress/community/threads/:threadId/replies",
  requireNotBanned,
  zValidator("param", TokenAddressParamSchema.extend({ threadId: z.string().trim().min(1) })),
  zValidator("json", CreateReplySchema),
  async (c) => {
    try {
      const viewer = c.get("user")!;
      const viewerState = await resolveViewerState(viewer.id);
      const { tokenAddress, threadId } = c.req.valid("param");
      const payload = c.req.valid("json");
      const token = await resolveTokenByAddressOrThrow(tokenAddress);
      const thread = await prisma.tokenCommunityThread.findFirst({
        where: { id: threadId, tokenId: token.id },
        select: {
          id: true,
          authorId: true,
        },
      });
      if (!thread) {
        return c.json({ error: { message: "Thread not found", code: "NOT_FOUND" } }, 404);
      }

      let parent: { id: string; rootId: string | null; depth: number } | null = null;
      if (payload.parentId) {
        parent = await prisma.tokenCommunityReply.findFirst({
          where: {
            id: payload.parentId,
            threadId: thread.id,
          },
          select: {
            id: true,
            rootId: true,
            depth: true,
          },
        });
        if (!parent) {
          return c.json({ error: { message: "Parent reply not found", code: "NOT_FOUND" } }, 404);
        }
      }

      const reply = await prisma.$transaction(async (tx) => {
        const created = await tx.tokenCommunityReply.create({
          data: {
            threadId: thread.id,
            authorId: viewer.id,
            content: payload.content.trim(),
            parentId: parent?.id ?? null,
            rootId: parent?.rootId ?? parent?.id ?? null,
            depth: Math.min(4, (parent?.depth ?? -1) + 1),
          },
          select: {
            id: true,
            content: true,
            parentId: true,
            rootId: true,
            depth: true,
            deletedAt: true,
            createdAt: true,
            author: {
              select: {
                id: true,
                name: true,
                username: true,
                image: true,
                level: true,
                isVerified: true,
              },
            },
          },
        });

        await tx.tokenCommunityThread.update({
          where: { id: thread.id },
          data: {
            replyCount: { increment: 1 },
            lastActivityAt: new Date(),
          },
        });

        return created;
      });

      await createCommunityReplyNotification({
        threadId: thread.id,
        recipientUserId: thread.authorId,
        actorId: viewer.id,
        actorLabel: viewerState.username || viewerState.name,
      });

      return c.json({ data: serializeReply(reply) }, 201);
    } catch (error) {
      if (error instanceof Error && error.message === "TOKEN_NOT_FOUND") {
        return c.json({ error: { message: "Token not found", code: "NOT_FOUND" } }, 404);
      }
      throw error;
    }
  },
);

tokenCommunitiesRouter.delete(
  "/:tokenAddress/community/threads/:threadId",
  requireNotBanned,
  zValidator("param", TokenAddressParamSchema.extend({ threadId: z.string().trim().min(1) })),
  async (c) => {
    try {
      const viewer = await resolveViewerState(c.get("user")!.id);
      const { tokenAddress, threadId } = c.req.valid("param");
      const token = await resolveTokenByAddressOrThrow(tokenAddress);
      const thread = await prisma.tokenCommunityThread.findFirst({
        where: { id: threadId, tokenId: token.id },
        select: { id: true, authorId: true, deletedAt: true },
      });

      if (!thread) {
        return c.json({ error: { message: "Thread not found", code: "NOT_FOUND" } }, 404);
      }
      if (!viewer.isAdmin && thread.authorId !== viewer.id) {
        return c.json({ error: { message: "Forbidden", code: "FORBIDDEN" } }, 403);
      }

      if (!thread.deletedAt) {
        await prisma.tokenCommunityThread.update({
          where: { id: thread.id },
          data: { deletedAt: new Date(), isPinned: false },
        });
      }

      return c.json({ data: { deleted: true } });
    } catch (error) {
      if (error instanceof Error && error.message === "TOKEN_NOT_FOUND") {
        return c.json({ error: { message: "Token not found", code: "NOT_FOUND" } }, 404);
      }
      throw error;
    }
  },
);

tokenCommunitiesRouter.delete(
  "/:tokenAddress/community/replies/:replyId",
  requireNotBanned,
  zValidator("param", TokenAddressParamSchema.extend({ replyId: z.string().trim().min(1) })),
  async (c) => {
    try {
      const viewer = await resolveViewerState(c.get("user")!.id);
      const { tokenAddress, replyId } = c.req.valid("param");
      const token = await resolveTokenByAddressOrThrow(tokenAddress);
      const reply = await prisma.tokenCommunityReply.findFirst({
        where: { id: replyId, thread: { tokenId: token.id } },
        select: { id: true, authorId: true, deletedAt: true },
      });

      if (!reply) {
        return c.json({ error: { message: "Reply not found", code: "NOT_FOUND" } }, 404);
      }
      if (!viewer.isAdmin && reply.authorId !== viewer.id) {
        return c.json({ error: { message: "Forbidden", code: "FORBIDDEN" } }, 403);
      }

      if (!reply.deletedAt) {
        await prisma.tokenCommunityReply.update({
          where: { id: reply.id },
          data: { deletedAt: new Date() },
        });
      }

      return c.json({ data: { deleted: true } });
    } catch (error) {
      if (error instanceof Error && error.message === "TOKEN_NOT_FOUND") {
        return c.json({ error: { message: "Token not found", code: "NOT_FOUND" } }, 404);
      }
      throw error;
    }
  },
);

tokenCommunitiesRouter.get(
  "/:tokenAddress/community/raids/active",
  requireAuth,
  zValidator("param", TokenAddressParamSchema),
  async (c) => {
    try {
      const token = await resolveTokenByAddressOrThrow(c.req.valid("param").tokenAddress);
      const active = await loadActiveRaidView(token.id, c.get("user")?.id ?? null);
      return c.json({ data: active });
    } catch (error) {
      if (error instanceof Error && error.message === "TOKEN_NOT_FOUND") {
        return c.json({ error: { message: "Token not found", code: "NOT_FOUND" } }, 404);
      }
      throw error;
    }
  },
);

tokenCommunitiesRouter.post(
  "/:tokenAddress/community/raids",
  requireNotBanned,
  zValidator("param", TokenAddressParamSchema),
  zValidator("json", CreateRaidSchema),
  async (c) => {
    try {
      const viewer = await resolveViewerState(c.get("user")!.id);
      const token = await resolveTokenByAddressOrThrow(c.req.valid("param").tokenAddress);
      const payload = c.req.valid("json");
      const existingProfile = await prisma.tokenCommunityProfile.findUnique({
        where: { tokenId: token.id },
        select: { raidLeadMinLevel: true },
      });
      assertTrustedMember(viewer, Math.max(existingProfile?.raidLeadMinLevel ?? 3, 3));

      const [activeExisting, raidContext] = await Promise.all([
        prisma.tokenRaidCampaign.findFirst({
          where: { tokenId: token.id, status: "active" },
          select: { id: true, thread: { select: { id: true } } },
        }),
        loadRaidContext(token.id),
      ]);

      if (activeExisting && !payload.replaceActive) {
        return c.json(
          { error: { message: "An active raid already exists", code: "ACTIVE_RAID_EXISTS" } },
          409,
        );
      }

      const objective =
        payload.objective?.trim() ||
        `Make ${normalizeCashtag(raidContext.profile?.xCashtag ?? null, raidContext.token.symbol) || "$TOKEN"} impossible to ignore without sounding desperate.`;

      const generated = TokenRaidGenerationResultSchema.parse(
        safeGenerateTokenRaidOptions({
          ...raidContext,
          objective,
          generationSalt: randomUUID(),
        }),
      );

      const created = await prisma.$transaction(async (tx) => {
        if (activeExisting) {
          await tx.tokenRaidCampaign.update({
            where: { id: activeExisting.id },
            data: { status: "closed", activeKey: null, closedAt: new Date() },
          });
          if (activeExisting.thread?.id) {
            await tx.tokenCommunityThread.update({
              where: { id: activeExisting.thread.id },
              data: { isPinned: false },
            }).catch(() => undefined);
          }
        }

        const raid = await tx.tokenRaidCampaign.create({
          data: {
            tokenId: token.id,
            createdById: viewer.id,
            status: "active",
            objective,
            memeOptionsJson: generated.memeOptions,
            copyOptionsJson: generated.copyOptions,
            activeKey: `${token.id}:active`,
          },
          select: {
            id: true,
            status: true,
            objective: true,
            memeOptionsJson: true,
            copyOptionsJson: true,
            openedAt: true,
            closedAt: true,
            createdAt: true,
            updatedAt: true,
            createdBy: {
              select: {
                id: true,
                name: true,
                username: true,
                image: true,
                level: true,
                isVerified: true,
              },
            },
          },
        });

        await tx.tokenCommunityThread.create({
          data: {
            tokenId: token.id,
            authorId: viewer.id,
            title: `Raid live: ${(token.symbol ? `$${token.symbol}` : token.name || "Token").trim()}`,
            content: `${objective}\n\nPick a meme. Pick a line. Post the receipt back here.`,
            kind: "raid",
            raidCampaignId: raid.id,
            isPinned: true,
            lastActivityAt: new Date(),
          },
        });

        return raid;
      });

      await fanoutRaidStartedNotifications({
        tokenId: token.id,
        tokenSymbol: token.symbol,
        raidId: created.id,
        creatorId: viewer.id,
        creatorLabel: viewer.username || viewer.name,
      }).catch(() => undefined);

      return c.json({
        data: {
          campaign: {
            id: created.id,
            status: created.status,
            objective: created.objective,
            memeOptions: parseStoredMemeOptions(created.memeOptionsJson),
            copyOptions: parseStoredCopyOptions(created.copyOptionsJson),
            openedAt: created.openedAt.toISOString(),
            closedAt: created.closedAt?.toISOString() ?? null,
            createdAt: created.createdAt.toISOString(),
            updatedAt: created.updatedAt.toISOString(),
            createdBy: serializeAuthor(created.createdBy),
          },
        },
      }, 201);
    } catch (error) {
      if (error instanceof Error && error.message === "TOKEN_NOT_FOUND") {
        return c.json({ error: { message: "Token not found", code: "NOT_FOUND" } }, 404);
      }
      if (error instanceof Error && error.message === "INSUFFICIENT_LEVEL") {
        return c.json(
          { error: { message: "Trusted members only", code: "INSUFFICIENT_LEVEL" } },
          403,
        );
      }
      throw error;
    }
  },
);

tokenCommunitiesRouter.post(
  "/:tokenAddress/community/raids/:raidId/regenerate",
  requireNotBanned,
  zValidator("param", TokenAddressParamSchema.extend({ raidId: z.string().trim().min(1) })),
  async (c) => {
    try {
      const viewer = await resolveViewerState(c.get("user")!.id);
      const { tokenAddress, raidId } = c.req.valid("param");
      const token = await resolveTokenByAddressOrThrow(tokenAddress);
      const profile = await prisma.tokenCommunityProfile.findUnique({
        where: { tokenId: token.id },
        select: { raidLeadMinLevel: true },
      });
      assertTrustedMember(viewer, Math.max(profile?.raidLeadMinLevel ?? 3, 3));

      const [raid, raidContext] = await Promise.all([
        prisma.tokenRaidCampaign.findFirst({
          where: { id: raidId, tokenId: token.id },
          select: { id: true, objective: true, status: true },
        }),
        loadRaidContext(token.id),
      ]);

      if (!raid) {
        return c.json({ error: { message: "Raid not found", code: "NOT_FOUND" } }, 404);
      }
      if (raid.status !== "active") {
        return c.json({ error: { message: "Raid is closed", code: "RAID_CLOSED" } }, 409);
      }

      const generated = TokenRaidGenerationResultSchema.parse(
        safeGenerateTokenRaidOptions({
          ...raidContext,
          objective: raid.objective,
          generationSalt: randomUUID(),
        }),
      );

      const updated = await prisma.tokenRaidCampaign.update({
        where: { id: raid.id },
        data: {
          memeOptionsJson: generated.memeOptions,
          copyOptionsJson: generated.copyOptions,
        },
        select: {
          id: true,
          status: true,
          objective: true,
          memeOptionsJson: true,
          copyOptionsJson: true,
          openedAt: true,
          closedAt: true,
          createdAt: true,
          updatedAt: true,
          createdBy: {
            select: {
              id: true,
              name: true,
              username: true,
              image: true,
              level: true,
              isVerified: true,
            },
          },
        },
      });

      return c.json({
        data: {
          campaign: {
            id: updated.id,
            status: updated.status,
            objective: updated.objective,
            memeOptions: parseStoredMemeOptions(updated.memeOptionsJson),
            copyOptions: parseStoredCopyOptions(updated.copyOptionsJson),
            openedAt: updated.openedAt.toISOString(),
            closedAt: updated.closedAt?.toISOString() ?? null,
            createdAt: updated.createdAt.toISOString(),
            updatedAt: updated.updatedAt.toISOString(),
            createdBy: serializeAuthor(updated.createdBy),
          },
        },
      });
    } catch (error) {
      if (error instanceof Error && error.message === "TOKEN_NOT_FOUND") {
        return c.json({ error: { message: "Token not found", code: "NOT_FOUND" } }, 404);
      }
      if (error instanceof Error && error.message === "INSUFFICIENT_LEVEL") {
        return c.json(
          { error: { message: "Trusted members only", code: "INSUFFICIENT_LEVEL" } },
          403,
        );
      }
      throw error;
    }
  },
);

tokenCommunitiesRouter.post(
  "/:tokenAddress/community/raids/:raidId/launch",
  requireNotBanned,
  zValidator("param", TokenAddressParamSchema.extend({ raidId: z.string().trim().min(1) })),
  zValidator("json", LaunchRaidSchema),
  async (c) => {
    try {
      const viewer = c.get("user")!;
      const { tokenAddress, raidId } = c.req.valid("param");
      const payload = c.req.valid("json");
      const token = await resolveTokenByAddressOrThrow(tokenAddress);
      const raid = await prisma.tokenRaidCampaign.findFirst({
        where: { id: raidId, tokenId: token.id },
        select: {
          id: true,
          status: true,
          memeOptionsJson: true,
          copyOptionsJson: true,
        },
      });

      if (!raid) {
        return c.json({ error: { message: "Raid not found", code: "NOT_FOUND" } }, 404);
      }
      if (raid.status !== "active") {
        return c.json({ error: { message: "Raid is closed", code: "RAID_CLOSED" } }, 409);
      }

      const memeOptions = parseStoredMemeOptions(raid.memeOptionsJson);
      const copyOptions = parseStoredCopyOptions(raid.copyOptionsJson);
      const selectedMeme = memeOptions.find((option) => option.id === payload.memeOptionId);
      const selectedCopy = copyOptions.find((option) => option.id === payload.copyOptionId);
      if (!selectedMeme || !selectedCopy) {
        return c.json(
          { error: { message: "Selected raid options are invalid", code: "INVALID_RAID_OPTIONS" } },
          400,
        );
      }

      const submission = await prisma.tokenRaidSubmission.upsert({
        where: {
          raidCampaignId_userId: {
            raidCampaignId: raid.id,
            userId: viewer.id,
          },
        },
        create: {
          raidCampaignId: raid.id,
          userId: viewer.id,
          memeOptionId: selectedMeme.id,
          copyOptionId: selectedCopy.id,
          renderPayloadJson: payload.renderPayloadJson as Prisma.InputJsonValue,
          composerText: payload.composerText,
        },
        update: {
          memeOptionId: selectedMeme.id,
          copyOptionId: selectedCopy.id,
          renderPayloadJson: payload.renderPayloadJson as Prisma.InputJsonValue,
          composerText: payload.composerText,
        },
        select: {
          id: true,
          memeOptionId: true,
          copyOptionId: true,
          renderPayloadJson: true,
          composerText: true,
          xPostUrl: true,
          postedAt: true,
          createdAt: true,
          updatedAt: true,
          user: {
            select: {
              id: true,
              name: true,
              username: true,
              image: true,
              level: true,
              isVerified: true,
            },
          },
        },
      });

      return c.json({
        data: serializeSubmission(submission as Parameters<typeof serializeSubmission>[0]),
      });
    } catch (error) {
      if (error instanceof Error && error.message === "TOKEN_NOT_FOUND") {
        return c.json({ error: { message: "Token not found", code: "NOT_FOUND" } }, 404);
      }
      throw error;
    }
  },
);

tokenCommunitiesRouter.patch(
  "/:tokenAddress/community/raids/:raidId/submission",
  requireNotBanned,
  zValidator("param", TokenAddressParamSchema.extend({ raidId: z.string().trim().min(1) })),
  zValidator("json", PatchRaidSubmissionSchema),
  async (c) => {
    try {
      const viewer = c.get("user")!;
      const { tokenAddress, raidId } = c.req.valid("param");
      const payload = c.req.valid("json");
      const token = await resolveTokenByAddressOrThrow(tokenAddress);
      const raid = await prisma.tokenRaidCampaign.findFirst({
        where: { id: raidId, tokenId: token.id },
        select: { id: true },
      });
      if (!raid) {
        return c.json({ error: { message: "Raid not found", code: "NOT_FOUND" } }, 404);
      }

      const submission = await prisma.tokenRaidSubmission.update({
        where: {
          raidCampaignId_userId: {
            raidCampaignId: raid.id,
            userId: viewer.id,
          },
        },
        data: {
          xPostUrl: payload.xPostUrl,
          postedAt: new Date(),
        },
        select: {
          id: true,
          memeOptionId: true,
          copyOptionId: true,
          renderPayloadJson: true,
          composerText: true,
          xPostUrl: true,
          postedAt: true,
          createdAt: true,
          updatedAt: true,
          user: {
            select: {
              id: true,
              name: true,
              username: true,
              image: true,
              level: true,
              isVerified: true,
            },
          },
        },
      });

      return c.json({
        data: serializeSubmission(submission as Parameters<typeof serializeSubmission>[0]),
      });
    } catch (error) {
      if (error instanceof Error && error.message === "TOKEN_NOT_FOUND") {
        return c.json({ error: { message: "Token not found", code: "NOT_FOUND" } }, 404);
      }
      throw error;
    }
  },
);

tokenCommunitiesRouter.delete(
  "/:tokenAddress/community/raids/:raidId/submission",
  requireNotBanned,
  zValidator("param", TokenAddressParamSchema.extend({ raidId: z.string().trim().min(1) })),
  async (c) => {
    try {
      const viewer = c.get("user")!;
      const { tokenAddress, raidId } = c.req.valid("param");
      const token = await resolveTokenByAddressOrThrow(tokenAddress);
      const raid = await prisma.tokenRaidCampaign.findFirst({
        where: { id: raidId, tokenId: token.id },
        select: { id: true },
      });
      if (!raid) {
        return c.json({ error: { message: "Raid not found", code: "NOT_FOUND" } }, 404);
      }

      await prisma.tokenRaidSubmission.delete({
        where: {
          raidCampaignId_userId: {
            raidCampaignId: raid.id,
            userId: viewer.id,
          },
        },
      }).catch(() => undefined);

      return c.json({ data: { deleted: true } });
    } catch (error) {
      if (error instanceof Error && error.message === "TOKEN_NOT_FOUND") {
        return c.json({ error: { message: "Token not found", code: "NOT_FOUND" } }, 404);
      }
      throw error;
    }
  },
);

tokenCommunitiesRouter.get(
  "/:tokenAddress/community/raids/:raidId/submissions",
  requireAuth,
  zValidator("param", TokenAddressParamSchema.extend({ raidId: z.string().trim().min(1) })),
  async (c) => {
    try {
      const { tokenAddress, raidId } = c.req.valid("param");
      const token = await resolveTokenByAddressOrThrow(tokenAddress);
      const raid = await prisma.tokenRaidCampaign.findFirst({
        where: { id: raidId, tokenId: token.id },
        select: { id: true },
      });
      if (!raid) {
        return c.json({ error: { message: "Raid not found", code: "NOT_FOUND" } }, 404);
      }

      const submissions = await prisma.tokenRaidSubmission.findMany({
        where: {
          raidCampaignId: raid.id,
          xPostUrl: { not: null },
        },
        select: {
          id: true,
          memeOptionId: true,
          copyOptionId: true,
          renderPayloadJson: true,
          composerText: true,
          xPostUrl: true,
          postedAt: true,
          createdAt: true,
          updatedAt: true,
          user: {
            select: {
              id: true,
              name: true,
              username: true,
              image: true,
              level: true,
              isVerified: true,
            },
          },
        },
        orderBy: [{ postedAt: "desc" }, { createdAt: "desc" }],
        take: 60,
      });

      return c.json({
        data: submissions.map((submission) =>
          serializeSubmission(submission as Parameters<typeof serializeSubmission>[0]),
        ),
      });
    } catch (error) {
      if (error instanceof Error && error.message === "TOKEN_NOT_FOUND") {
        return c.json({ error: { message: "Token not found", code: "NOT_FOUND" } }, 404);
      }
      throw error;
    }
  },
);
