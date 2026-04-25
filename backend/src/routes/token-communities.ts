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
  COMMUNITY_ASSET_KIND_VALUES,
  buildCommunityAssetObjectKey,
  createCommunityAssetUpload,
  deleteCommunityAssetObject,
  fetchCommunityAssetObject,
  getCommunityAssetStorageDiagnostics,
  uploadCommunityAssetObject,
  isCommunityAssetStorageConfigured,
  type CommunityAssetKind,
} from "../services/community-asset-storage.js";
import {
  TOKEN_RAID_TEMPLATE_IDS,
  TokenRaidCopyOptionSchema,
  TokenRaidGenerationResultSchema,
  TokenRaidMemeOptionSchema,
  safeGenerateTokenRaidOptions,
} from "../services/token-raid-generation.js";
import {
  loadTokenCommunityRoom,
  mutateCommunityMemberStats,
  serializeCommunityAsset,
  serializeCommunityAuthor,
} from "../services/token-community-room.js";

export const tokenCommunitiesRouter = new Hono<{ Variables: AuthVariables }>();

const COMMUNITY_ALLOWED_EMOJIS = ["🔥", "👀", "😂", "🫡"] as const;

const TokenAddressParamSchema = z.object({
  tokenAddress: z.string().trim().min(1),
});

const ThreadListQuerySchema = z.object({
  cursor: z.string().trim().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(30).optional(),
  sort: z.enum(["latest", "trending"]).optional(),
});

const CommunityProfileBaseSchema = z.object({
  headline: z.string().trim().min(8).max(120).nullable().optional(),
  whyLine: z.string().trim().min(12).max(140).nullable().optional(),
  welcomePrompt: z.string().trim().min(8).max(120).nullable().optional(),
  vibeTags: z.array(z.string().trim().min(2).max(24)).max(6).optional(),
  mascotName: z.string().trim().min(2).max(40).nullable().optional(),
  xCashtag: z
    .string()
    .trim()
    .regex(/^\$?[A-Za-z0-9_]{1,15}$/, "X cashtag must be 1-15 letters/numbers/underscores")
    .nullable()
    .optional(),
  voiceHints: z.array(z.string().trim().min(3).max(60)).max(6).optional(),
  insideJokes: z.array(z.string().trim().min(4).max(80)).max(6).optional(),
  preferredTemplateIds: z.array(z.enum(TOKEN_RAID_TEMPLATE_IDS)).max(9).optional(),
  raidLeadMinLevel: z.number().int().min(3).max(10).optional(),
  assetIds: z.array(z.string().trim().min(1)).max(8).optional(),
});

const CreateCommunitySchema = CommunityProfileBaseSchema.extend({
  whyLine: z.string().trim().min(12).max(140),
  welcomePrompt: z.string().trim().min(8).max(120),
  vibeTags: z.array(z.string().trim().min(2).max(24)).min(1).max(6),
  assetIds: z.array(z.string().trim().min(1)).min(3).max(8),
}).strict();

const CommunityProfilePatchSchema = CommunityProfileBaseSchema.strict();

const CommunityAssetPresignSchema = z
  .object({
    kind: z.enum(COMMUNITY_ASSET_KIND_VALUES),
    fileName: z.string().trim().min(1).max(160),
    contentType: z.string().trim().regex(/^image\/[a-z0-9.+-]+$/i, "Provide an image content type"),
    sizeBytes: z.number().int().min(1).max(8 * 1024 * 1024),
    width: z.number().int().min(1).max(4096).optional(),
    height: z.number().int().min(1).max(4096).optional(),
  })
  .strict();

const CommunityAssetImportSchema = z
  .object({
    kind: z.enum(COMMUNITY_ASSET_KIND_VALUES),
    sourceUrl: z.string().trim().url("Provide a valid image URL"),
  })
  .strict();

const CreateThreadSchema = z
  .object({
    title: z.string().trim().min(4).max(80).optional(),
    content: z.string().trim().min(6).max(600),
    postType: z.enum(["alpha", "discussion", "chart", "poll", "raid", "news"]).optional(),
  })
  .strict();

const CreateReplySchema = z
  .object({
    content: z.string().trim().min(2).max(400),
    parentId: z.string().trim().min(1).optional(),
  })
  .strict();

const ThreadReactionSchema = z
  .object({
    emoji: z.enum(COMMUNITY_ALLOWED_EMOJIS),
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
        (value) => /^https:\/\/(www\.)?(x|twitter)\.com\/[^/]+\/status\/\d+/i.test(value),
        "Provide a valid X post URL",
      ),
  })
  .strict();

const COMMUNITY_PROFILE_DEFAULT_VOICE_HINTS = [
  "dry confidence",
  "internet-native and sharp",
  "receipts over slogans",
] as const;

const COMMUNITY_PROFILE_DEFAULT_JOKES = [
  "the group chat hears the boss music first",
  "the chart keeps trying to act innocent",
  "receipts age better than cope",
] as const;

function normalizeCashtag(value: string | null | undefined, symbol: string | null | undefined): string | null {
  const raw = (value ?? "").trim() || (symbol ? `$${symbol}` : "");
  if (!raw) return null;
  return raw.startsWith("$") ? raw.toUpperCase() : `$${raw.toUpperCase()}`;
}

function normalizeStringList(input: unknown, fallback: string[] = [], maxItems = 6): string[] {
  if (!Array.isArray(input)) return [...fallback];
  const values = input
    .map((value) => (typeof value === "string" ? value.trim() : ""))
    .filter((value) => value.length > 0);
  return values.length > 0 ? values.slice(0, maxItems) : [...fallback];
}

function isCommunityAssetKind(value: string): value is CommunityAssetKind {
  return COMMUNITY_ASSET_KIND_VALUES.includes(value as CommunityAssetKind);
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
    whyLine: string | null;
    welcomePrompt: string | null;
    vibeTags: unknown;
    mascotName: string | null;
    createdAt: Date;
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
    preferredTemplateIds: normalizeStringList(profile?.preferredTemplateIds, [], 9),
    raidLeadMinLevel: profile?.raidLeadMinLevel ?? 3,
    whyLine: profile?.whyLine ?? null,
    welcomePrompt: profile?.welcomePrompt ?? null,
    vibeTags: normalizeStringList(profile?.vibeTags, []),
    mascotName: profile?.mascotName ?? null,
    createdAt: profile?.createdAt?.toISOString() ?? null,
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

async function requireExistingCommunity(tokenId: string) {
  const profile = await prisma.tokenCommunityProfile.findUnique({
    where: { tokenId },
    select: {
      id: true,
      raidLeadMinLevel: true,
      headline: true,
      xCashtag: true,
      voiceHints: true,
      insideJokes: true,
      preferredTemplateIds: true,
      whyLine: true,
      welcomePrompt: true,
      vibeTags: true,
      mascotName: true,
    },
  });
  if (!profile) {
    throw new Error("COMMUNITY_NOT_CREATED");
  }
  return profile;
}

async function requireCommunityMembership(tokenId: string, userId: string) {
  const follow = await prisma.tokenFollow.findUnique({
    where: {
      userId_tokenId: {
        userId,
        tokenId,
      },
    },
    select: { createdAt: true },
  });
  if (!follow) {
    throw new Error("COMMUNITY_JOIN_REQUIRED");
  }
  return follow;
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

function serializeReactionSummary(
  reactions: Array<{ emoji: string; userId: string }>,
  viewerId: string | null,
) {
  const counts = new Map<string, { emoji: string; count: number; reactedByViewer: boolean }>();
  for (const reaction of reactions) {
    const existing = counts.get(reaction.emoji) ?? {
      emoji: reaction.emoji,
      count: 0,
      reactedByViewer: false,
    };
    existing.count += 1;
    if (viewerId && reaction.userId === viewerId) {
      existing.reactedByViewer = true;
    }
    counts.set(reaction.emoji, existing);
  }
  return COMMUNITY_ALLOWED_EMOJIS.map((emoji) => counts.get(emoji) ?? { emoji, count: 0, reactedByViewer: false });
}

function serializeThread(
  viewerId: string | null,
  thread: {
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
    reactions?: Array<{
      emoji: string;
      userId: string;
    }>;
  },
) {
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
    author: serializeCommunityAuthor(thread.author),
    reactionSummary: serializeReactionSummary(thread.reactions ?? [], viewerId),
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
    author: serializeCommunityAuthor(reply.author),
  };
}

function serializeParticipant(participant: {
  id: string;
  status: string;
  currentStep: string;
  joinedAt: Date;
  launchedAt: Date | null;
  postedAt: Date | null;
}) {
  return {
    id: participant.id,
    status: participant.status,
    currentStep: participant.currentStep,
    joinedAt: participant.joinedAt.toISOString(),
    launchedAt: participant.launchedAt?.toISOString() ?? null,
    postedAt: participant.postedAt?.toISOString() ?? null,
  };
}

function serializeParticipantWithUser(participant: {
  id: string;
  status: string;
  currentStep: string;
  joinedAt: Date;
  launchedAt: Date | null;
  postedAt: Date | null;
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
    ...serializeParticipant(participant),
    user: serializeCommunityAuthor(participant.user),
  };
}

function serializeSubmission(
  viewerId: string | null,
  submission: {
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
    boosts?: Array<{ userId: string; createdAt?: Date }>;
  },
) {
  const boostCount = submission.boosts?.length ?? 0;
  const latestBoostedAt = submission.boosts?.reduce<Date | null>((latest, boost) => {
    if (!boost.createdAt) return latest;
    return !latest || boost.createdAt.getTime() > latest.getTime() ? boost.createdAt : latest;
  }, null);
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
    boostCount,
    latestBoostedAt: latestBoostedAt?.toISOString() ?? null,
    isBoostedByViewer: Boolean(viewerId && submission.boosts?.some((boost) => boost.userId === viewerId)),
    user: serializeCommunityAuthor(submission.user),
  };
}

function buildRaidMilestones(postedCount: number, participantCount: number) {
  const target = Math.max(10, Math.ceil(Math.max(participantCount, 1) / 10) * 10);
  return [
    { label: "First wave", threshold: Math.max(3, Math.ceil(target * 0.25)) },
    { label: "Pressure line", threshold: Math.max(5, Math.ceil(target * 0.5)) },
    { label: "Trend break", threshold: Math.max(8, Math.ceil(target * 0.75)) },
    { label: "Resistance break", threshold: target },
    { label: "Overdrive", threshold: Math.ceil(target * 1.25) },
  ].map((milestone) => ({
    ...milestone,
    unlocked: postedCount >= milestone.threshold,
  }));
}

function buildChoiceCounts(submissions: Array<{ memeOptionId: string; copyOptionId: string }>) {
  return submissions.reduce(
    (counts, submission) => {
      counts.memeChoiceCounts[submission.memeOptionId] = (counts.memeChoiceCounts[submission.memeOptionId] ?? 0) + 1;
      counts.copyChoiceCounts[submission.copyOptionId] = (counts.copyChoiceCounts[submission.copyOptionId] ?? 0) + 1;
      return counts;
    },
    {
      memeChoiceCounts: {} as Record<string, number>,
      copyChoiceCounts: {} as Record<string, number>,
    },
  );
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
    message: `${params.creatorLabel} started a raid campaign for ${tokenLabel}.`,
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

async function validateSelectedAssetRows(params: {
  tokenId: string;
  assetIds: string[];
}) {
  const uniqueIds = [...new Set(params.assetIds)];
  const assets = await prisma.tokenCommunityAsset.findMany({
    where: {
      tokenId: params.tokenId,
      id: { in: uniqueIds },
    },
    select: {
      id: true,
      kind: true,
      status: true,
      url: true,
      objectKey: true,
      mimeType: true,
      width: true,
      height: true,
      sizeBytes: true,
      sortOrder: true,
      createdAt: true,
    },
  });
  if (assets.length !== uniqueIds.length) {
    throw new Error("INVALID_ASSET_SELECTION");
  }

  const logo = assets.filter((asset) => asset.kind === "logo");
  const banner = assets.filter((asset) => asset.kind === "banner");
  const mascot = assets.filter((asset) => asset.kind === "mascot");
  const referenceMemes = assets.filter((asset) => asset.kind === "reference_meme");

  if (logo.length !== 1 || banner.length !== 1 || referenceMemes.length < 1 || referenceMemes.length > 5 || mascot.length > 1) {
    throw new Error("INVALID_ASSET_REQUIREMENTS");
  }

  return {
    assets,
    logo: logo[0] ?? null,
    banner: banner[0] ?? null,
    mascot: mascot[0] ?? null,
    referenceMemes,
  };
}

async function loadRaidContext(tokenId: string) {
  const [tokenRecord, profile, assets, recentThreads, recentRaids] = await Promise.all([
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
        vibeTags: true,
        mascotName: true,
      },
    }),
    prisma.tokenCommunityAsset.findMany({
      where: { tokenId, status: "ready" },
      select: {
        id: true,
        kind: true,
      },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }],
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
        generationHistoryJson: true,
      },
      orderBy: { openedAt: "desc" },
      take: 5,
    }),
  ]);

  if (!tokenRecord) {
    throw new Error("TOKEN_NOT_FOUND");
  }

  const normalizedAssets = assets.filter(
    (asset): asset is { id: string; kind: CommunityAssetKind } => isCommunityAssetKind(asset.kind),
  );

  const history = recentRaids.flatMap((raid) => {
    const items: Array<{ objective?: string | null; memeOptions?: unknown; copyOptions?: unknown }> = [
      {
        objective: raid.objective,
        memeOptions: raid.memeOptionsJson,
        copyOptions: raid.copyOptionsJson,
      },
    ];
    if (Array.isArray(raid.generationHistoryJson)) {
      for (const entry of raid.generationHistoryJson.slice(-6)) {
        if (entry && typeof entry === "object") {
          items.push(entry as { objective?: string | null; memeOptions?: unknown; copyOptions?: unknown });
        }
      }
    }
    return items;
  });

  return {
    token: tokenRecord,
    profile: profile
      ? {
          ...profile,
          voiceHints: normalizeStringList(profile.voiceHints),
          insideJokes: normalizeStringList(profile.insideJokes),
          preferredTemplateIds: normalizeStringList(profile.preferredTemplateIds, [], 9),
          vibeTags: normalizeStringList(profile.vibeTags, []),
          mascotName: profile.mascotName,
          assets: normalizedAssets,
        }
      : null,
    recentThreads: recentThreads.map((thread) => ({
      title: thread.title,
      content: thread.content,
      authorName: thread.author.name,
      authorUsername: thread.author.username,
      createdAt: thread.createdAt,
    })),
    recentRaidHistory: history,
  };
}

function buildGenerationHistoryEntry(raid: {
  objective: string;
  memeOptionsJson: unknown;
  copyOptionsJson: unknown;
}): Prisma.InputJsonObject {
  return {
    objective: raid.objective,
    memeOptions: raid.memeOptionsJson as Prisma.InputJsonValue,
    copyOptions: raid.copyOptionsJson as Prisma.InputJsonValue,
    generatedAt: new Date().toISOString(),
  };
}

function buildGenerationHistoryJson(
  existingHistory: Prisma.JsonValue | null | undefined,
  raid: {
    objective: string;
    memeOptionsJson: unknown;
    copyOptionsJson: unknown;
  },
): Prisma.InputJsonArray {
  const normalizedHistory = Array.isArray(existingHistory)
    ? (existingHistory.filter((entry) => entry !== null) as Prisma.InputJsonValue[])
    : [];

  return [...normalizedHistory, buildGenerationHistoryEntry(raid)].slice(-8) as Prisma.InputJsonArray;
}

async function loadActiveRaidView(token: { id: string; address: string }, viewerId: string | null) {
  const [active, assets] = await Promise.all([
    prisma.tokenRaidCampaign.findFirst({
      where: {
        tokenId: token.id,
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
        participants: {
          select: {
            id: true,
            userId: true,
            status: true,
            currentStep: true,
            joinedAt: true,
            launchedAt: true,
            postedAt: true,
          },
          orderBy: [{ joinedAt: "desc" }],
          take: 120,
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
            boosts: {
              select: {
                userId: true,
              },
            },
          },
          orderBy: [{ postedAt: "desc" }, { createdAt: "desc" }],
          take: 60,
        },
      },
      orderBy: { openedAt: "desc" },
    }),
    prisma.tokenCommunityAsset.findMany({
      where: { tokenId: token.id, status: "ready" },
      select: {
        id: true,
        kind: true,
        status: true,
        url: true,
        objectKey: true,
        mimeType: true,
        width: true,
        height: true,
        sizeBytes: true,
        sortOrder: true,
        createdAt: true,
      },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }],
    }),
  ]);

  const readyAssets = {
    logo: assets.find((asset) => asset.kind === "logo") ?? null,
    banner: assets.find((asset) => asset.kind === "banner") ?? null,
    mascot: assets.find((asset) => asset.kind === "mascot") ?? null,
    referenceMemes: assets.filter((asset) => asset.kind === "reference_meme").slice(0, 5),
  };

  if (!active) {
    return {
      campaign: null,
      submissions: [],
      mySubmission: null,
      myParticipant: null,
      communityAssets: {
        logo: readyAssets.logo ? serializeCommunityAsset(token.address, readyAssets.logo) : null,
        banner: readyAssets.banner ? serializeCommunityAsset(token.address, readyAssets.banner) : null,
        mascot: readyAssets.mascot ? serializeCommunityAsset(token.address, readyAssets.mascot) : null,
        referenceMemes: readyAssets.referenceMemes.map((asset) => serializeCommunityAsset(token.address, asset)),
      },
    };
  }

  const memeOptions = parseStoredMemeOptions(active.memeOptionsJson);
  const copyOptions = parseStoredCopyOptions(active.copyOptionsJson);
  const visibleSubmissions = active.submissions.filter((submission) => submission.xPostUrl);
  const mySubmission = viewerId
    ? active.submissions.find((submission) => submission.user.id === viewerId) ?? null
    : null;
  const myParticipant = viewerId
    ? active.participants.find((participant) => participant.userId === viewerId) ??
      (mySubmission
        ? {
            id: `legacy-${mySubmission.id}`,
            userId: viewerId,
            status: mySubmission.xPostUrl ? "posted" : "launched",
            currentStep: mySubmission.xPostUrl ? "complete" : "launch",
            joinedAt: mySubmission.createdAt,
            launchedAt: mySubmission.updatedAt,
            postedAt: mySubmission.postedAt,
          }
        : null)
    : null;

  const memeChoiceCounts = active.submissions.reduce<Record<string, number>>((acc, submission) => {
    acc[submission.memeOptionId] = (acc[submission.memeOptionId] ?? 0) + 1;
    return acc;
  }, {});
  const copyChoiceCounts = active.submissions.reduce<Record<string, number>>((acc, submission) => {
    acc[submission.copyOptionId] = (acc[submission.copyOptionId] ?? 0) + 1;
    return acc;
  }, {});

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
      participantCount: active.participants.length,
      postedCount: visibleSubmissions.length,
      memeChoiceCounts,
      copyChoiceCounts,
      createdBy: serializeCommunityAuthor(active.createdBy),
    },
    submissions: visibleSubmissions.map((submission) =>
      serializeSubmission(viewerId, submission as Parameters<typeof serializeSubmission>[1]),
    ),
    mySubmission: mySubmission
      ? serializeSubmission(viewerId, mySubmission as Parameters<typeof serializeSubmission>[1])
      : null,
    myParticipant: myParticipant ? serializeParticipant(myParticipant) : null,
    communityAssets: {
      logo: readyAssets.logo ? serializeCommunityAsset(token.address, readyAssets.logo) : null,
      banner: readyAssets.banner ? serializeCommunityAsset(token.address, readyAssets.banner) : null,
      mascot: readyAssets.mascot ? serializeCommunityAsset(token.address, readyAssets.mascot) : null,
      referenceMemes: readyAssets.referenceMemes.map((asset) => serializeCommunityAsset(token.address, asset)),
    },
  };
}

async function loadCommunitySummaryView(
  token: { id: string; address: string; symbol: string | null; name: string | null; imageUrl: string | null },
  viewerId: string | null,
) {
  const [profile, memberStats, counts, pinnedThread, activeRaid, recentRaids, topCalls] = await Promise.all([
    prisma.tokenCommunityProfile.findUnique({
      where: { tokenId: token.id },
      select: {
        id: true,
        headline: true,
        xCashtag: true,
        voiceHints: true,
        insideJokes: true,
        preferredTemplateIds: true,
        raidLeadMinLevel: true,
        whyLine: true,
        welcomePrompt: true,
        vibeTags: true,
        mascotName: true,
        createdAt: true,
        updatedAt: true,
      },
    }),
    prisma.tokenCommunityMemberStats.findMany({
      where: { tokenId: token.id },
      select: {
        contributionScore: true,
        lastActiveAt: true,
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
      orderBy: [{ contributionScore: "desc" }, { lastActiveAt: "desc" }],
      take: 8,
    }),
    prisma.token.findUnique({
      where: { id: token.id },
      select: {
        _count: {
          select: {
            followers: true,
            communityThreads: true,
            calls: true,
            raidCampaigns: true,
          },
        },
      },
    }),
    prisma.tokenCommunityThread.findFirst({
      where: {
        tokenId: token.id,
        deletedAt: null,
        isPinned: true,
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
        reactions: {
          select: {
            emoji: true,
            userId: true,
          },
        },
      },
      orderBy: [{ lastActivityAt: "desc" }, { createdAt: "desc" }],
    }),
    prisma.tokenRaidCampaign.findFirst({
      where: {
        tokenId: token.id,
        status: "active",
      },
      select: {
        id: true,
        objective: true,
        openedAt: true,
        participants: {
          select: { id: true },
        },
        submissions: {
          where: { xPostUrl: { not: null } },
          select: { id: true },
        },
      },
      orderBy: { openedAt: "desc" },
    }),
    prisma.tokenRaidCampaign.findMany({
      where: { tokenId: token.id },
      select: {
        id: true,
        objective: true,
        status: true,
        openedAt: true,
        closedAt: true,
        participants: {
          select: { id: true },
        },
      },
      orderBy: { openedAt: "desc" },
      take: 5,
    }),
    prisma.post.findMany({
      where: { tokenId: token.id },
      select: {
        id: true,
        content: true,
        postType: true,
        contractAddress: true,
        tokenSymbol: true,
        tokenName: true,
        tokenImage: true,
        confidenceScore: true,
        highConvictionScore: true,
        roiCurrentPct: true,
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
        likes: { select: { id: true } },
        reposts: { select: { id: true } },
      },
      orderBy: [{ highConvictionScore: "desc" }, { confidenceScore: "desc" }, { createdAt: "desc" }],
      take: 4,
    }),
  ]);

  const onlineThresholdMs = 15 * 60 * 1000;
  const onlineMembers = memberStats
    .filter((member) => Date.now() - member.lastActiveAt.getTime() <= onlineThresholdMs)
    .slice(0, 6)
    .map((member) => serializeCommunityAuthor(member.user));

  return {
    hero: {
      tokenAddress: token.address,
      symbol: token.symbol,
      name: token.name,
      imageUrl: token.imageUrl,
      profile: buildProfileResponse({ symbol: token.symbol, name: token.name }, profile),
      memberCount: counts?._count.followers ?? 0,
      onlineCount: onlineMembers.length,
    },
    stats: {
      members: counts?._count.followers ?? 0,
      posts: counts?._count.communityThreads ?? 0,
      calls: counts?._count.calls ?? 0,
      raids: counts?._count.raidCampaigns ?? 0,
    },
    pinnedCall: pinnedThread ? serializeThread(viewerId, pinnedThread) : null,
    topContributors: memberStats.map((member) => ({
      score: member.contributionScore,
      user: serializeCommunityAuthor(member.user),
      lastActiveAt: member.lastActiveAt.toISOString(),
    })),
    onlineMembers,
    activeRaid: activeRaid
      ? {
          id: activeRaid.id,
          objective: activeRaid.objective,
          openedAt: activeRaid.openedAt.toISOString(),
          participantCount: activeRaid.participants.length,
          postedCount: activeRaid.submissions.length,
        }
      : null,
    recentRaids: recentRaids.map((raid) => ({
      id: raid.id,
      objective: raid.objective,
      status: raid.status,
      openedAt: raid.openedAt.toISOString(),
      closedAt: raid.closedAt?.toISOString() ?? null,
      participantCount: raid.participants.length,
    })),
    topCalls: topCalls.map((call) => ({
      id: call.id,
      content: call.content,
      postType: call.postType ?? (call.contractAddress ? "alpha" : "discussion"),
      contractAddress: call.contractAddress,
      tokenSymbol: call.tokenSymbol,
      tokenName: call.tokenName,
      tokenImage: call.tokenImage,
      confidenceScore: call.confidenceScore,
      highConvictionScore: call.highConvictionScore,
      roiCurrentPct: call.roiCurrentPct,
      createdAt: call.createdAt.toISOString(),
      engagementCount: call.likes.length + call.reposts.length,
      author: serializeCommunityAuthor(call.author),
    })),
  };
}

async function loadRaidDetailView(
  token: { id: string; address: string; symbol: string | null; name: string | null; imageUrl: string | null },
  raidId: string,
  viewerId: string | null,
) {
  const [raid, assets] = await Promise.all([
    prisma.tokenRaidCampaign.findFirst({
      where: {
        id: raidId,
        tokenId: token.id,
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
        participants: {
          select: {
            id: true,
            userId: true,
            status: true,
            currentStep: true,
            joinedAt: true,
            launchedAt: true,
            postedAt: true,
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
          orderBy: [{ joinedAt: "desc" }],
          take: 200,
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
            boosts: {
              select: { userId: true, createdAt: true },
            },
          },
          orderBy: [{ postedAt: "desc" }, { createdAt: "desc" }],
          take: 100,
        },
      },
    }),
    prisma.tokenCommunityAsset.findMany({
      where: { tokenId: token.id, status: "ready" },
      select: {
        id: true,
        kind: true,
        status: true,
        url: true,
        objectKey: true,
        mimeType: true,
        width: true,
        height: true,
        sizeBytes: true,
        sortOrder: true,
        createdAt: true,
      },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }],
    }),
  ]);

  if (!raid) {
    return null;
  }

  const visibleSubmissions = raid.submissions.filter((submission) => submission.xPostUrl);
  const participantCount = raid.participants.length;
  const postedCount = visibleSubmissions.length;
  const milestoneTarget = Math.max(10, Math.ceil(participantCount / 10) * 10);
  const milestones = buildRaidMilestones(postedCount, participantCount);
  const progressPct = milestoneTarget > 0 ? Math.min(100, Math.round((postedCount / milestoneTarget) * 100)) : 0;
  const now = new Date();
  const endsAtDate = raid.closedAt ?? new Date(raid.openedAt.getTime() + 24 * 60 * 60 * 1000);
  const openHours = Math.max((now.getTime() - raid.openedAt.getTime()) / 3_600_000, 0.1);
  const remainingHours = raid.closedAt ? 0 : Math.max((endsAtDate.getTime() - now.getTime()) / 3_600_000, 0);
  const boostCount = visibleSubmissions.reduce((sum, submission) => sum + (submission.boosts?.length ?? 0), 0);
  const postedVelocityPerHour = Number((postedCount / openHours).toFixed(2));
  const boostVelocityPerHour = Number((boostCount / openHours).toFixed(2));
  const projectedPostedCount = Math.round(postedCount + postedVelocityPerHour * remainingHours);
  const activationRatePct = participantCount > 0 ? Math.round((postedCount / participantCount) * 100) : 0;
  const boostDensity = postedCount > 0 ? Number((boostCount / postedCount).toFixed(1)) : 0;
  const pressureScore = Math.min(
    100,
    Math.round(progressPct * 0.42 + Math.min(activationRatePct, 100) * 0.28 + Math.min(boostDensity * 12, 100) * 0.18 + Math.min(postedVelocityPerHour * 12, 100) * 0.12),
  );
  const socialSignal =
    pressureScore >= 80
      ? "Raid pressure is compounding across posted links and boosts."
      : pressureScore >= 55
        ? "Room execution is building, but more posted proof is needed."
        : "Raid has joined interest but needs visible execution to break out.";
  const serializedParticipants = raid.participants.map((participant) => serializeParticipantWithUser(participant));
  const serializedSubmissions = visibleSubmissions.map((submission) =>
    serializeSubmission(viewerId, submission as Parameters<typeof serializeSubmission>[1]),
  );
  const leaderboard = serializedSubmissions
    .map((submission) => ({
      ...submission,
      submissionId: submission.id,
      impactScore:
        submission.boostCount * 5 +
        (submission.postedAt ? 15 : 0) +
        Math.min(submission.user.level, 50),
    }))
    .sort((a, b) => b.impactScore - a.impactScore);
  const topDriver = leaderboard[0] ?? null;
  const viewerParticipant =
    viewerId
      ? serializedParticipants.find((participant) => participant.user?.id === viewerId) ?? null
      : null;
  const viewerSubmission =
    viewerId ? serializedSubmissions.find((submission) => submission.user.id === viewerId) ?? null : null;
  const participantEvents = serializedParticipants.slice(0, 40).map((participant) => ({
    id: `participant:${participant.id}`,
    kind: participant.status === "posted" ? "participant_posted" : participant.status === "launched" ? "kit_launched" : "joined",
    body:
      participant.status === "posted"
        ? "linked an X post and advanced the raid proof count."
        : participant.status === "launched"
          ? "launched the raid kit and is ready to post proof."
          : "joined the raid room.",
    createdAt: (participant.postedAt ?? participant.launchedAt ?? participant.joinedAt),
    user: participant.user,
  }));
  const submissionEvents = serializedSubmissions.flatMap((submission) => {
    const events = [
      {
        id: `submission:${submission.id}`,
        kind: "submission",
        body: submission.composerText,
        createdAt: submission.postedAt ?? submission.updatedAt,
        user: submission.user,
      },
    ];
    if (submission.latestBoostedAt) {
      events.push({
        id: `boost:${submission.id}`,
        kind: "boost",
        body: `${submission.boostCount} boost${submission.boostCount === 1 ? "" : "s"} concentrated on this raid post.`,
        createdAt: submission.latestBoostedAt,
        user: submission.user,
      });
    }
    return events;
  });
  const updates = [...participantEvents, ...submissionEvents]
    .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime())
    .slice(0, 80);
  const { memeChoiceCounts, copyChoiceCounts } = buildChoiceCounts(raid.submissions);

  const logoAsset = assets.find((asset) => asset.kind === "logo") ?? null;
  const bannerAsset = assets.find((asset) => asset.kind === "banner") ?? null;
  const mascotAsset = assets.find((asset) => asset.kind === "mascot") ?? null;

  return {
    campaign: {
      id: raid.id,
      status: raid.status,
      objective: raid.objective,
      memeOptions: parseStoredMemeOptions(raid.memeOptionsJson),
      copyOptions: parseStoredCopyOptions(raid.copyOptionsJson),
      openedAt: raid.openedAt.toISOString(),
      closedAt: raid.closedAt?.toISOString() ?? null,
      createdAt: raid.createdAt.toISOString(),
      updatedAt: raid.updatedAt.toISOString(),
      endsAt: endsAtDate.toISOString(),
      participantCount,
      postedCount,
      milestoneTarget,
      progressPct,
      memeChoiceCounts,
      copyChoiceCounts,
      token: {
        address: token.address,
        symbol: token.symbol,
        name: token.name,
        imageUrl: token.imageUrl,
      },
      createdBy: serializeCommunityAuthor(raid.createdBy),
    },
    submissions: serializedSubmissions,
    participants: serializedParticipants,
    leaderboard,
    updates,
    milestones,
    intelligence: {
      pressureScore,
      activationRatePct,
      postedVelocityPerHour,
      boostVelocityPerHour,
      projectedPostedCount,
      projectedCompletionPct: milestoneTarget > 0 ? Math.min(100, Math.round((projectedPostedCount / milestoneTarget) * 100)) : 0,
      boostDensity,
      socialSignal,
      nextBestAction:
        !viewerParticipant
          ? "Join the room to start contributing to raid execution."
          : !viewerSubmission
            ? "Launch the creative kit, then submit your public X proof."
            : !viewerSubmission.xPostUrl
              ? "Paste your X post link so the room can count your execution."
              : "Boost high-quality raid posts to compound the room pressure.",
      topDriver: topDriver
        ? {
            user: topDriver.user,
            boostCount: topDriver.boostCount,
            impactScore: topDriver.impactScore,
          }
        : null,
    },
    myParticipant: viewerParticipant,
    mySubmission: viewerSubmission,
    viewerState: {
      participant: viewerParticipant,
      submission: viewerSubmission,
    },
    communityAssets: {
      logo: logoAsset ? serializeCommunityAsset(token.address, logoAsset) : null,
      banner: bannerAsset ? serializeCommunityAsset(token.address, bannerAsset) : null,
      mascot: mascotAsset ? serializeCommunityAsset(token.address, mascotAsset) : null,
    },
  };
}

function mapRouteError(error: unknown) {
  if (!(error instanceof Error)) return null;
  if (error.message === "TOKEN_NOT_FOUND") {
    return { status: 404 as const, error: { message: "Token not found", code: "NOT_FOUND" } };
  }
  if (error.message === "COMMUNITY_NOT_CREATED") {
    return {
      status: 409 as const,
      error: { message: "Community has not been created yet", code: "COMMUNITY_NOT_CREATED" },
    };
  }
  if (error.message === "COMMUNITY_JOIN_REQUIRED") {
    return {
      status: 403 as const,
      error: { message: "Join the community first", code: "COMMUNITY_JOIN_REQUIRED" },
    };
  }
  if (error.message === "INSUFFICIENT_LEVEL") {
    return { status: 403 as const, error: { message: "Trusted members only", code: "INSUFFICIENT_LEVEL" } };
  }
  if (error.message === "INVALID_ASSET_SELECTION") {
    return {
      status: 400 as const,
      error: { message: "Selected asset set is invalid", code: "INVALID_ASSET_SELECTION" },
    };
  }
  if (error.message === "INVALID_ASSET_REQUIREMENTS") {
    return {
      status: 400 as const,
      error: {
        message: "Community requires exactly one logo, one banner, and 1-5 reference memes",
        code: "INVALID_ASSET_REQUIREMENTS",
      },
    };
  }
  if (error.message === "COMMUNITY_ALREADY_EXISTS") {
    return {
      status: 409 as const,
      error: { message: "Community already exists", code: "COMMUNITY_ALREADY_EXISTS" },
    };
  }
  if (error.message === "COMMUNITY_ASSET_STORAGE_NOT_CONFIGURED") {
    return {
      status: 503 as const,
      error: { message: "Asset storage is not configured", code: "ASSET_STORAGE_UNAVAILABLE" },
    };
  }
  if (error.message === "COMMUNITY_ASSET_STORAGE_PERMISSION_DENIED") {
    return {
      status: 503 as const,
      error: {
        message: "Asset storage rejected the upload. Check the R2 bucket name, access key, secret, and write permissions.",
        code: "ASSET_STORAGE_PERMISSION_DENIED",
      },
    };
  }
  if (error.message === "COMMUNITY_ASSET_STORAGE_BUCKET_NOT_FOUND") {
    return {
      status: 503 as const,
      error: {
        message: "Asset storage bucket was not found. Check COMMUNITY_ASSET_STORAGE_BUCKET and endpoint settings.",
        code: "ASSET_STORAGE_BUCKET_NOT_FOUND",
      },
    };
  }
  if (error.message === "COMMUNITY_ASSET_STORAGE_UPSTREAM_UNAVAILABLE") {
    return {
      status: 503 as const,
      error: {
        message: "Asset storage is temporarily unavailable. Retry in a few seconds.",
        code: "ASSET_STORAGE_UPSTREAM_UNAVAILABLE",
      },
    };
  }
  if (error.message.startsWith("COMMUNITY_ASSET_STORAGE_UPLOAD_FAILED:")) {
    return {
      status: 503 as const,
      error: {
        message: "Asset storage rejected the upload request. Check the R2 endpoint, bucket, and credentials.",
        code: "ASSET_STORAGE_UPLOAD_FAILED",
      },
    };
  }
  if (error.message === "INVALID_ASSET_UPLOAD") {
    return {
      status: 400 as const,
      error: { message: "Upload one image file at a time", code: "INVALID_ASSET_UPLOAD" },
    };
  }
  if (error.message === "REMOTE_ASSET_FETCH_FAILED") {
    return {
      status: 400 as const,
      error: { message: "Could not fetch the image from that URL", code: "REMOTE_ASSET_FETCH_FAILED" },
    };
  }
  if (error.message === "REMOTE_ASSET_NOT_IMAGE") {
    return {
      status: 400 as const,
      error: { message: "That URL did not return an image", code: "REMOTE_ASSET_NOT_IMAGE" },
    };
  }
  if (error.message === "REMOTE_ASSET_TOO_LARGE") {
    return {
      status: 400 as const,
      error: { message: "Image is too large. Keep it under 8 MB", code: "REMOTE_ASSET_TOO_LARGE" },
    };
  }
  if (error.message === "ASSET_UPLOAD_MISSING") {
    return {
      status: 409 as const,
      error: { message: "The uploaded image could not be confirmed in storage", code: "ASSET_UPLOAD_MISSING" },
    };
  }
  return null;
}

function inferRemoteAssetFilename(sourceUrl: string, fallbackContentType: string): string {
  try {
    const url = new URL(sourceUrl);
    const lastSegment = url.pathname.split("/").filter(Boolean).pop();
    if (lastSegment && /\.[a-z0-9]{2,10}$/i.test(lastSegment)) {
      return lastSegment;
    }
  } catch {
    // ignore malformed URLs here; schema validation handles them upstream
  }

  const extension =
    fallbackContentType.split("/")[1]?.replace(/[^a-z0-9.+-]/gi, "").toLowerCase() || "png";
  return `remote-asset.${extension}`;
}

function parseOptionalPositiveInt(value: string | File | null): number | null {
  if (typeof value !== "string") return null;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
}

function getUploadedImageFromFormData(formData: FormData): {
  kind: CommunityAssetKind;
  file: File;
  width: number | null;
  height: number | null;
} {
  const kindValue = formData.get("kind");
  const fileValue = formData.get("file");

  if (typeof kindValue !== "string" || !isCommunityAssetKind(kindValue)) {
    throw new Error("INVALID_ASSET_UPLOAD");
  }
  if (!(fileValue instanceof File)) {
    throw new Error("INVALID_ASSET_UPLOAD");
  }
  if (!/^image\/[a-z0-9.+-]+$/i.test(fileValue.type || "")) {
    throw new Error("REMOTE_ASSET_NOT_IMAGE");
  }
  if (fileValue.size <= 0 || fileValue.size > 8 * 1024 * 1024) {
    throw new Error("REMOTE_ASSET_TOO_LARGE");
  }

  return {
    kind: kindValue,
    file: fileValue,
    width: parseOptionalPositiveInt(formData.get("width")),
    height: parseOptionalPositiveInt(formData.get("height")),
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
          whyLine: true,
          welcomePrompt: true,
          vibeTags: true,
          mascotName: true,
          createdAt: true,
          updatedAt: true,
        },
      });

      return c.json({ data: buildProfileResponse(token, profile) });
    } catch (error) {
      const mapped = mapRouteError(error);
      if (mapped) return c.json(mapped.error, mapped.status);
      throw error;
    }
  },
);

tokenCommunitiesRouter.post(
  "/:tokenAddress/community",
  requireNotBanned,
  zValidator("param", TokenAddressParamSchema),
  zValidator("json", CreateCommunitySchema),
  async (c) => {
    try {
      const viewer = await resolveViewerState(c.get("user")!.id);
      assertTrustedMember(viewer, 3);
      const token = await resolveTokenByAddressOrThrow(c.req.valid("param").tokenAddress);
      const payload = c.req.valid("json");
      const existing = await prisma.tokenCommunityProfile.findUnique({
        where: { tokenId: token.id },
        select: { id: true },
      });
      if (existing) {
        throw new Error("COMMUNITY_ALREADY_EXISTS");
      }

      await validateSelectedAssetRows({ tokenId: token.id, assetIds: payload.assetIds });

      await prisma.$transaction(async (tx) => {
        await tx.tokenCommunityProfile.create({
          data: {
            tokenId: token.id,
            headline: payload.headline ?? null,
            xCashtag: normalizeCashtag(payload.xCashtag ?? null, token.symbol),
            voiceHints: payload.voiceHints ?? [...COMMUNITY_PROFILE_DEFAULT_VOICE_HINTS],
            insideJokes: payload.insideJokes ?? [...COMMUNITY_PROFILE_DEFAULT_JOKES],
            preferredTemplateIds: payload.preferredTemplateIds ?? [],
            raidLeadMinLevel: payload.raidLeadMinLevel ?? 3,
            whyLine: payload.whyLine,
            welcomePrompt: payload.welcomePrompt,
            vibeTags: payload.vibeTags,
            mascotName: payload.mascotName ?? null,
            createdById: viewer.id,
            updatedById: viewer.id,
          },
        });
        await tx.tokenCommunityAsset.updateMany({
          where: {
            tokenId: token.id,
          },
          data: {
            status: "pending",
          },
        });
        for (const [index, assetId] of payload.assetIds.entries()) {
          await tx.tokenCommunityAsset.update({
            where: { id: assetId },
            data: {
              status: "ready",
              sortOrder: index,
            },
          });
        }
        await tx.tokenFollow.upsert({
          where: {
            userId_tokenId: {
              userId: viewer.id,
              tokenId: token.id,
            },
          },
          create: {
            userId: viewer.id,
            tokenId: token.id,
          },
          update: {},
        });
        await mutateCommunityMemberStats({
          db: tx,
          tokenId: token.id,
          userId: viewer.id,
          joinedAt: new Date(),
          lastActiveAt: new Date(),
        });
      });

      const room = await loadTokenCommunityRoom({
        tokenId: token.id,
        tokenAddress: token.address,
        viewerId: viewer.id,
        viewerLevel: viewer.level,
        viewerIsAdmin: viewer.isAdmin,
      });
      return c.json({ data: room }, 201);
    } catch (error) {
      const mapped = mapRouteError(error);
      if (mapped) return c.json(mapped.error, mapped.status);
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
    try {
      const viewer = await resolveViewerState(c.get("user")!.id);
      const token = await resolveTokenByAddressOrThrow(c.req.valid("param").tokenAddress);
      const payload = c.req.valid("json");
      const existing = await requireExistingCommunity(token.id);
      assertTrustedMember(viewer, Math.max(existing.raidLeadMinLevel ?? 3, 3));

      if (payload.assetIds) {
        await validateSelectedAssetRows({ tokenId: token.id, assetIds: payload.assetIds });
      }

      const profile = await prisma.$transaction(async (tx) => {
        if (payload.assetIds) {
          await tx.tokenCommunityAsset.updateMany({
            where: { tokenId: token.id },
            data: { status: "pending" },
          });
          for (const [index, assetId] of payload.assetIds.entries()) {
            await tx.tokenCommunityAsset.update({
              where: { id: assetId },
              data: { status: "ready", sortOrder: index },
            });
          }
        }

        return tx.tokenCommunityProfile.update({
          where: { tokenId: token.id },
          data: {
            ...(payload.headline !== undefined ? { headline: payload.headline } : {}),
            ...(payload.xCashtag !== undefined
              ? { xCashtag: normalizeCashtag(payload.xCashtag, token.symbol) }
              : {}),
            ...(payload.voiceHints !== undefined ? { voiceHints: payload.voiceHints } : {}),
            ...(payload.insideJokes !== undefined ? { insideJokes: payload.insideJokes } : {}),
            ...(payload.preferredTemplateIds !== undefined
              ? { preferredTemplateIds: payload.preferredTemplateIds }
              : {}),
            ...(payload.raidLeadMinLevel !== undefined ? { raidLeadMinLevel: payload.raidLeadMinLevel } : {}),
            ...(payload.whyLine !== undefined ? { whyLine: payload.whyLine } : {}),
            ...(payload.welcomePrompt !== undefined ? { welcomePrompt: payload.welcomePrompt } : {}),
            ...(payload.vibeTags !== undefined ? { vibeTags: payload.vibeTags } : {}),
            ...(payload.mascotName !== undefined ? { mascotName: payload.mascotName } : {}),
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
            whyLine: true,
            welcomePrompt: true,
            vibeTags: true,
            mascotName: true,
            createdAt: true,
            updatedAt: true,
          },
        });
      });

      return c.json({ data: buildProfileResponse(token, profile) });
    } catch (error) {
      const mapped = mapRouteError(error);
      if (mapped) return c.json(mapped.error, mapped.status);
      throw error;
    }
  },
);

tokenCommunitiesRouter.get(
  "/:tokenAddress/community/assets/health",
  requireAuth,
  zValidator("param", TokenAddressParamSchema),
  async (c) => {
    try {
      await resolveTokenByAddressOrThrow(c.req.valid("param").tokenAddress);
      return c.json({ data: getCommunityAssetStorageDiagnostics() });
    } catch (error) {
      const mapped = mapRouteError(error);
      if (mapped) return c.json(mapped.error, mapped.status);
      throw error;
    }
  },
);

tokenCommunitiesRouter.post(
  "/:tokenAddress/community/assets/upload",
  requireNotBanned,
  zValidator("param", TokenAddressParamSchema),
  async (c) => {
    try {
      if (!isCommunityAssetStorageConfigured()) {
        throw new Error("COMMUNITY_ASSET_STORAGE_NOT_CONFIGURED");
      }
      const viewer = c.get("user")!;
      const token = await resolveTokenByAddressOrThrow(c.req.valid("param").tokenAddress);
      const diagnostics = getCommunityAssetStorageDiagnostics();
      const uploadSessionId = randomUUID();
      const formData = await c.req.formData();
      const payload = getUploadedImageFromFormData(formData);
      const body = new Uint8Array(await payload.file.arrayBuffer());
      const objectKey = buildCommunityAssetObjectKey({
        tokenAddress: token.address,
        kind: payload.kind,
        fileName: payload.file.name,
      });
      const upload = await uploadCommunityAssetObject({
        objectKey,
        contentType: payload.file.type || "image/png",
        body,
      });

      const asset = await prisma.tokenCommunityAsset.create({
        data: {
          tokenId: token.id,
          kind: payload.kind,
          status: "ready",
          url: upload.publicUrl,
          objectKey,
          mimeType: payload.file.type || "image/png",
          width: payload.width,
          height: payload.height,
          sizeBytes: payload.file.size,
          uploadedById: viewer.id,
        },
        select: {
          id: true,
          kind: true,
          status: true,
          url: true,
          objectKey: true,
          mimeType: true,
          width: true,
          height: true,
          sizeBytes: true,
          sortOrder: true,
          createdAt: true,
        },
      });

      console.info("[community-assets/upload]", {
        uploadSessionId,
        tokenAddress: token.address,
        assetId: asset.id,
        kind: payload.kind,
        contentType: asset.mimeType,
        sizeBytes: asset.sizeBytes,
        endpointHost: diagnostics.endpointHost,
        publicBaseHost: diagnostics.publicBaseHost,
        issues: diagnostics.issues,
      });

      return c.json({ data: serializeCommunityAsset(token.address, asset) });
    } catch (error) {
      console.warn("[community-assets/upload] failed", {
        tokenAddress: c.req.valid("param").tokenAddress,
        message: error instanceof Error ? error.message : String(error),
      });
      const mapped = mapRouteError(error);
      if (mapped) return c.json(mapped.error, mapped.status);
      throw error;
    }
  },
);

tokenCommunitiesRouter.post(
  "/:tokenAddress/community/assets/presign",
  requireNotBanned,
  zValidator("param", TokenAddressParamSchema),
  zValidator("json", CommunityAssetPresignSchema),
  async (c) => {
    try {
      if (!isCommunityAssetStorageConfigured()) {
        throw new Error("COMMUNITY_ASSET_STORAGE_NOT_CONFIGURED");
      }
      const viewer = c.get("user")!;
      const token = await resolveTokenByAddressOrThrow(c.req.valid("param").tokenAddress);
      const payload = c.req.valid("json");
      const diagnostics = getCommunityAssetStorageDiagnostics();
      const uploadSessionId = randomUUID();
      const objectKey = buildCommunityAssetObjectKey({
        tokenAddress: token.address,
        kind: payload.kind,
        fileName: payload.fileName,
      });
      const upload = createCommunityAssetUpload({
        objectKey,
        contentType: payload.contentType,
      });

      const asset = await prisma.tokenCommunityAsset.create({
        data: {
          tokenId: token.id,
          kind: payload.kind,
          status: "pending",
          url: upload.publicUrl,
          objectKey,
          mimeType: payload.contentType,
          width: payload.width ?? null,
          height: payload.height ?? null,
          sizeBytes: payload.sizeBytes,
          uploadedById: viewer.id,
        },
        select: {
          id: true,
          kind: true,
          status: true,
          url: true,
          objectKey: true,
          mimeType: true,
          width: true,
          height: true,
          sizeBytes: true,
          sortOrder: true,
          createdAt: true,
        },
      });

      console.info("[community-assets/presign]", {
        uploadSessionId,
        tokenAddress: token.address,
        assetId: asset.id,
        kind: payload.kind,
        contentType: payload.contentType,
        sizeBytes: payload.sizeBytes,
        endpointHost: diagnostics.endpointHost,
        publicBaseHost: diagnostics.publicBaseHost,
        issues: diagnostics.issues,
      });

      return c.json({
        data: {
          asset: serializeCommunityAsset(token.address, asset),
          upload: {
            method: "PUT",
            url: upload.uploadUrl,
            headers: upload.headers,
            expiresAt: upload.expiresAt,
          },
          uploadSessionId,
        },
      });
    } catch (error) {
      const mapped = mapRouteError(error);
      if (mapped) return c.json(mapped.error, mapped.status);
      throw error;
    }
  },
);

tokenCommunitiesRouter.post(
  "/:tokenAddress/community/assets/:assetId/complete",
  requireNotBanned,
  zValidator("param", TokenAddressParamSchema.extend({ assetId: z.string().trim().min(1) })),
  async (c) => {
    try {
      if (!isCommunityAssetStorageConfigured()) {
        throw new Error("COMMUNITY_ASSET_STORAGE_NOT_CONFIGURED");
      }
      const viewer = c.get("user")!;
      const { tokenAddress, assetId } = c.req.valid("param");
      const token = await resolveTokenByAddressOrThrow(tokenAddress);
      const asset = await prisma.tokenCommunityAsset.findFirst({
        where: {
          id: assetId,
          tokenId: token.id,
          uploadedById: viewer.id,
        },
        select: {
          id: true,
          kind: true,
          status: true,
          url: true,
          objectKey: true,
          mimeType: true,
          width: true,
          height: true,
          sizeBytes: true,
          sortOrder: true,
          createdAt: true,
        },
      });

      if (!asset) {
        return c.json({ error: { message: "Asset not found", code: "NOT_FOUND" } }, 404);
      }

      if (asset.status === "ready") {
        return c.json({ data: serializeCommunityAsset(token.address, asset) });
      }

      const storageResponse = await fetchCommunityAssetObject(asset.objectKey);
      if (!storageResponse.ok) {
        console.warn("[community-assets/complete] storage verification failed", {
          tokenAddress: token.address,
          assetId: asset.id,
          status: storageResponse.status,
        });
        throw new Error("ASSET_UPLOAD_MISSING");
      }

      const updated = await prisma.tokenCommunityAsset.update({
        where: { id: asset.id },
        data: { status: "ready" },
        select: {
          id: true,
          kind: true,
          status: true,
          url: true,
          objectKey: true,
          mimeType: true,
          width: true,
          height: true,
          sizeBytes: true,
          sortOrder: true,
          createdAt: true,
        },
      });

      console.info("[community-assets/complete]", {
        tokenAddress: token.address,
        assetId: updated.id,
        kind: updated.kind,
      });

      return c.json({ data: serializeCommunityAsset(token.address, updated) });
    } catch (error) {
      const mapped = mapRouteError(error);
      if (mapped) return c.json(mapped.error, mapped.status);
      throw error;
    }
  },
);

tokenCommunitiesRouter.post(
  "/:tokenAddress/community/assets/import",
  requireNotBanned,
  zValidator("param", TokenAddressParamSchema),
  zValidator("json", CommunityAssetImportSchema),
  async (c) => {
    try {
      if (!isCommunityAssetStorageConfigured()) {
        throw new Error("COMMUNITY_ASSET_STORAGE_NOT_CONFIGURED");
      }
      const viewer = c.get("user")!;
      const token = await resolveTokenByAddressOrThrow(c.req.valid("param").tokenAddress);
      const payload = c.req.valid("json");
      const diagnostics = getCommunityAssetStorageDiagnostics();
      const uploadSessionId = randomUUID();

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15_000);
      let upstream: Response;
      try {
        upstream = await fetch(payload.sourceUrl, {
          method: "GET",
          redirect: "follow",
          signal: controller.signal,
        });
      } catch {
        throw new Error("REMOTE_ASSET_FETCH_FAILED");
      } finally {
        clearTimeout(timeoutId);
      }

      if (!upstream.ok) {
        throw new Error("REMOTE_ASSET_FETCH_FAILED");
      }

      const contentType = upstream.headers.get("content-type")?.split(";")[0]?.trim() || "";
      if (!/^image\/[a-z0-9.+-]+$/i.test(contentType)) {
        throw new Error("REMOTE_ASSET_NOT_IMAGE");
      }

      const contentLengthHeader = upstream.headers.get("content-length");
      if (contentLengthHeader) {
        const declaredSize = Number.parseInt(contentLengthHeader, 10);
        if (Number.isFinite(declaredSize) && declaredSize > 8 * 1024 * 1024) {
          throw new Error("REMOTE_ASSET_TOO_LARGE");
        }
      }

      const body = new Uint8Array(await upstream.arrayBuffer());
      if (body.byteLength === 0) {
        throw new Error("REMOTE_ASSET_FETCH_FAILED");
      }
      if (body.byteLength > 8 * 1024 * 1024) {
        throw new Error("REMOTE_ASSET_TOO_LARGE");
      }

      const objectKey = buildCommunityAssetObjectKey({
        tokenAddress: token.address,
        kind: payload.kind,
        fileName: inferRemoteAssetFilename(payload.sourceUrl, contentType),
      });
      const upload = await uploadCommunityAssetObject({
        objectKey,
        contentType,
        body,
      });

      const asset = await prisma.tokenCommunityAsset.create({
        data: {
          tokenId: token.id,
          kind: payload.kind,
          status: "ready",
          url: upload.publicUrl,
          objectKey,
          mimeType: contentType,
          sizeBytes: body.byteLength,
          uploadedById: viewer.id,
        },
        select: {
          id: true,
          kind: true,
          status: true,
          url: true,
          objectKey: true,
          mimeType: true,
          width: true,
          height: true,
          sizeBytes: true,
          sortOrder: true,
          createdAt: true,
        },
      });

      console.info("[community-assets/import]", {
        uploadSessionId,
        tokenAddress: token.address,
        assetId: asset.id,
        kind: payload.kind,
        sourceUrl: payload.sourceUrl,
        endpointHost: diagnostics.endpointHost,
        publicBaseHost: diagnostics.publicBaseHost,
        issues: diagnostics.issues,
      });

      return c.json({ data: serializeCommunityAsset(token.address, asset) });
    } catch (error) {
      const mapped = mapRouteError(error);
      if (mapped) return c.json(mapped.error, mapped.status);
      throw error;
    }
  },
);

tokenCommunitiesRouter.delete(
  "/:tokenAddress/community/assets/:assetId",
  requireNotBanned,
  zValidator("param", TokenAddressParamSchema.extend({ assetId: z.string().trim().min(1) })),
  async (c) => {
    try {
      const viewer = await resolveViewerState(c.get("user")!.id);
      const { tokenAddress, assetId } = c.req.valid("param");
      const token = await resolveTokenByAddressOrThrow(tokenAddress);
      const asset = await prisma.tokenCommunityAsset.findFirst({
        where: { id: assetId, tokenId: token.id },
        select: {
          id: true,
          kind: true,
          objectKey: true,
          uploadedById: true,
          status: true,
        },
      });
      if (!asset) {
        return c.json({ error: { message: "Asset not found", code: "NOT_FOUND" } }, 404);
      }

      const profile = await prisma.tokenCommunityProfile.findUnique({
        where: { tokenId: token.id },
        select: { id: true },
      });
      if (profile) {
        assertTrustedMember(viewer, 3);
        const remaining = await prisma.tokenCommunityAsset.findMany({
          where: {
            tokenId: token.id,
            status: "ready",
            id: { not: asset.id },
          },
          select: { id: true, kind: true },
        });
        if (
          remaining.filter((item) => item.kind === "logo").length < 1 ||
          remaining.filter((item) => item.kind === "banner").length < 1 ||
          remaining.filter((item) => item.kind === "reference_meme").length < 1
        ) {
          return c.json(
            {
              error: {
                message: "Community must keep one logo, one banner, and at least one reference meme",
                code: "ASSET_DELETE_BLOCKED",
              },
            },
            409,
          );
        }
      } else if (!viewer.isAdmin && asset.uploadedById !== viewer.id) {
        return c.json({ error: { message: "Forbidden", code: "FORBIDDEN" } }, 403);
      }

      await prisma.tokenCommunityAsset.delete({
        where: { id: asset.id },
      });
      await deleteCommunityAssetObject(asset.objectKey).catch(() => undefined);

      return c.json({ data: { deleted: true } });
    } catch (error) {
      const mapped = mapRouteError(error);
      if (mapped) return c.json(mapped.error, mapped.status);
      throw error;
    }
  },
);

tokenCommunitiesRouter.get(
  "/:tokenAddress/community/assets/:assetId/content",
  requireAuth,
  zValidator("param", TokenAddressParamSchema.extend({ assetId: z.string().trim().min(1) })),
  async (c) => {
    try {
      const { tokenAddress, assetId } = c.req.valid("param");
      const token = await resolveTokenByAddressOrThrow(tokenAddress);
      const asset = await prisma.tokenCommunityAsset.findFirst({
        where: { id: assetId, tokenId: token.id },
        select: {
          objectKey: true,
          mimeType: true,
        },
      });
      if (!asset) {
        return c.json({ error: { message: "Asset not found", code: "NOT_FOUND" } }, 404);
      }

      const upstream = await fetchCommunityAssetObject(asset.objectKey);
      if (!upstream.ok) {
        return c.json({ error: { message: "Asset unavailable", code: "ASSET_UNAVAILABLE" } }, 502);
      }

      const headers = new Headers();
      headers.set("Content-Type", upstream.headers.get("content-type") || asset.mimeType || "image/png");
      headers.set("Cache-Control", "private, max-age=300");
      return new Response(upstream.body, {
        status: 200,
        headers,
      });
    } catch (error) {
      const mapped = mapRouteError(error);
      if (mapped) return c.json(mapped.error, mapped.status);
      throw error;
    }
  },
);

tokenCommunitiesRouter.get(
  "/:tokenAddress/community/room",
  requireAuth,
  zValidator("param", TokenAddressParamSchema),
  async (c) => {
    try {
      const token = await resolveTokenByAddressOrThrow(c.req.valid("param").tokenAddress);
      const viewer = c.get("user");
      const viewerState = viewer ? await resolveViewerState(viewer.id) : null;
      const room = await loadTokenCommunityRoom({
        tokenId: token.id,
        tokenAddress: token.address,
        viewerId: viewer?.id ?? null,
        viewerLevel: viewerState?.level ?? 0,
        viewerIsAdmin: viewerState?.isAdmin ?? false,
      });
      return c.json({ data: room });
    } catch (error) {
      const mapped = mapRouteError(error);
      if (mapped) return c.json(mapped.error, mapped.status);
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
      const sort = query.sort ?? "latest";
      const hasCommunity = await prisma.tokenCommunityProfile.findUnique({
        where: { tokenId: token.id },
        select: { id: true },
      });
      if (!hasCommunity) {
        return c.json({ data: { items: [], hasMore: false, nextCursor: null } });
      }

      const threads = await prisma.tokenCommunityThread.findMany({
        where: {
          tokenId: token.id,
          ...(sort === "latest" && cursor
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
          reactions: {
            select: {
              emoji: true,
              userId: true,
            },
            take: 60,
          },
        },
        orderBy:
          sort === "trending"
            ? [{ isPinned: "desc" }, { lastActivityAt: "desc" }, { createdAt: "desc" }]
            : [{ isPinned: "desc" }, { createdAt: "desc" }, { id: "desc" }],
        take: sort === "trending" ? Math.max(limit * 3, 24) : limit + 1,
      });

      const rankedThreads =
        sort === "trending"
          ? [...threads].sort((left, right) => {
              const leftReactionCount = left.reactions.length;
              const rightReactionCount = right.reactions.length;
              const leftScore =
                (left.isPinned ? 10_000 : 0) +
                left.replyCount * 5 +
                leftReactionCount * 7 +
                Math.max(0, Math.round((left.lastActivityAt.getTime() - left.createdAt.getTime()) / 60_000));
              const rightScore =
                (right.isPinned ? 10_000 : 0) +
                right.replyCount * 5 +
                rightReactionCount * 7 +
                Math.max(0, Math.round((right.lastActivityAt.getTime() - right.createdAt.getTime()) / 60_000));
              if (rightScore !== leftScore) return rightScore - leftScore;
              return right.lastActivityAt.getTime() - left.lastActivityAt.getTime();
            })
          : threads;

      const hasMore = sort === "latest" && rankedThreads.length > limit;
      const items = hasMore ? rankedThreads.slice(0, limit) : rankedThreads.slice(0, limit);
      const nextCursor =
        sort === "latest" && hasMore && items.length > 0
          ? encodeCursor(items[items.length - 1]!.createdAt, items[items.length - 1]!.id)
          : null;

      return c.json({
        data: {
          items: items.map((thread) => serializeThread(c.get("user")?.id ?? null, thread)),
          hasMore,
          nextCursor,
          sort,
        },
      });
    } catch (error) {
      const mapped = mapRouteError(error);
      if (mapped) return c.json(mapped.error, mapped.status);
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
      const viewer = c.get("user")!;
      const token = await resolveTokenByAddressOrThrow(c.req.valid("param").tokenAddress);
      await requireExistingCommunity(token.id);
      await requireCommunityMembership(token.id, viewer.id);
      const payload = c.req.valid("json");
      if (payload.postType === "poll") {
        return c.json(
          { error: { message: "Community thread polls require dedicated community poll storage.", code: "COMMUNITY_POLL_UNAVAILABLE" } },
          400,
        );
      }

      const thread = await prisma.tokenCommunityThread.create({
        data: {
          tokenId: token.id,
          authorId: viewer.id,
          title: payload.title?.trim() || null,
          content: payload.content.trim(),
          kind: payload.postType ?? "discussion",
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
          reactions: {
            select: {
              emoji: true,
              userId: true,
            },
          },
        },
      });
      await mutateCommunityMemberStats({
        tokenId: token.id,
        userId: viewer.id,
        threadCount: 1,
        lastActiveAt: new Date(),
      });

      return c.json({ data: serializeThread(viewer.id, thread) }, 201);
    } catch (error) {
      const mapped = mapRouteError(error);
      if (mapped) return c.json(mapped.error, mapped.status);
      throw error;
    }
  },
);

tokenCommunitiesRouter.post(
  "/:tokenAddress/community/threads/:threadId/reactions",
  requireNotBanned,
  zValidator("param", TokenAddressParamSchema.extend({ threadId: z.string().trim().min(1) })),
  zValidator("json", ThreadReactionSchema),
  async (c) => {
    try {
      const viewer = c.get("user")!;
      const { tokenAddress, threadId } = c.req.valid("param");
      const { emoji } = c.req.valid("json");
      const token = await resolveTokenByAddressOrThrow(tokenAddress);
      await requireExistingCommunity(token.id);
      await requireCommunityMembership(token.id, viewer.id);
      const thread = await prisma.tokenCommunityThread.findFirst({
        where: { id: threadId, tokenId: token.id },
        select: { id: true, authorId: true },
      });
      if (!thread) {
        return c.json({ error: { message: "Thread not found", code: "NOT_FOUND" } }, 404);
      }

      const existing = await prisma.tokenCommunityThreadReaction.findUnique({
        where: {
          threadId_userId_emoji: {
            threadId: thread.id,
            userId: viewer.id,
            emoji,
          },
        },
        select: { id: true },
      });
      if (!existing) {
        await prisma.tokenCommunityThreadReaction.create({
          data: {
            threadId: thread.id,
            userId: viewer.id,
            emoji,
          },
        });
        if (thread.authorId !== viewer.id) {
          await mutateCommunityMemberStats({
            tokenId: token.id,
            userId: thread.authorId,
            reactionsReceived: 1,
            lastActiveAt: new Date(),
          });
        }
        await mutateCommunityMemberStats({
          tokenId: token.id,
          userId: viewer.id,
          lastActiveAt: new Date(),
        });
      }

      const reactions = await prisma.tokenCommunityThreadReaction.findMany({
        where: { threadId: thread.id },
        select: { emoji: true, userId: true },
      });
      return c.json({ data: serializeReactionSummary(reactions, viewer.id) });
    } catch (error) {
      const mapped = mapRouteError(error);
      if (mapped) return c.json(mapped.error, mapped.status);
      throw error;
    }
  },
);

tokenCommunitiesRouter.delete(
  "/:tokenAddress/community/threads/:threadId/reactions/:emoji",
  requireNotBanned,
  zValidator(
    "param",
    TokenAddressParamSchema.extend({
      threadId: z.string().trim().min(1),
      emoji: z.enum(COMMUNITY_ALLOWED_EMOJIS),
    }),
  ),
  async (c) => {
    try {
      const viewer = c.get("user")!;
      const { tokenAddress, threadId, emoji } = c.req.valid("param");
      const token = await resolveTokenByAddressOrThrow(tokenAddress);
      await requireExistingCommunity(token.id);
      await requireCommunityMembership(token.id, viewer.id);
      const thread = await prisma.tokenCommunityThread.findFirst({
        where: { id: threadId, tokenId: token.id },
        select: { id: true },
      });
      if (!thread) {
        return c.json({ error: { message: "Thread not found", code: "NOT_FOUND" } }, 404);
      }

      await prisma.tokenCommunityThreadReaction.delete({
        where: {
          threadId_userId_emoji: {
            threadId: thread.id,
            userId: viewer.id,
            emoji,
          },
        },
      }).catch(() => undefined);

      const reactions = await prisma.tokenCommunityThreadReaction.findMany({
        where: { threadId: thread.id },
        select: { emoji: true, userId: true },
      });
      return c.json({ data: serializeReactionSummary(reactions, viewer.id) });
    } catch (error) {
      const mapped = mapRouteError(error);
      if (mapped) return c.json(mapped.error, mapped.status);
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
      const mapped = mapRouteError(error);
      if (mapped) return c.json(mapped.error, mapped.status);
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
      await requireExistingCommunity(token.id);
      await requireCommunityMembership(token.id, viewer.id);
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
        await mutateCommunityMemberStats({
          db: tx,
          tokenId: token.id,
          userId: viewer.id,
          replyCount: 1,
          lastActiveAt: new Date(),
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
      const mapped = mapRouteError(error);
      if (mapped) return c.json(mapped.error, mapped.status);
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
      const mapped = mapRouteError(error);
      if (mapped) return c.json(mapped.error, mapped.status);
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
      const mapped = mapRouteError(error);
      if (mapped) return c.json(mapped.error, mapped.status);
      throw error;
    }
  },
);

tokenCommunitiesRouter.get(
  "/:tokenAddress/community/summary",
  zValidator("param", TokenAddressParamSchema),
  async (c) => {
    try {
      const token = await resolveTokenByAddressOrThrow(c.req.valid("param").tokenAddress);
      const summary = await loadCommunitySummaryView(
        {
          id: token.id,
          address: token.address,
          symbol: token.symbol ?? null,
          name: token.name ?? null,
          imageUrl: token.imageUrl ?? null,
        },
        c.get("user")?.id ?? null,
      );
      return c.json({ data: summary });
    } catch (error) {
      const mapped = mapRouteError(error);
      if (mapped) return c.json(mapped.error, mapped.status);
      throw error;
    }
  },
);

tokenCommunitiesRouter.get(
  "/:tokenAddress/community/top-calls",
  zValidator("param", TokenAddressParamSchema),
  async (c) => {
    try {
      const token = await resolveTokenByAddressOrThrow(c.req.valid("param").tokenAddress);
      const posts = await prisma.post.findMany({
        where: { tokenId: token.id },
        select: {
          id: true,
          content: true,
          postType: true,
          contractAddress: true,
          tokenSymbol: true,
          tokenName: true,
          tokenImage: true,
          confidenceScore: true,
          highConvictionScore: true,
          roiCurrentPct: true,
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
          likes: { select: { id: true } },
          reposts: { select: { id: true } },
          comments: { select: { id: true } },
        },
        orderBy: [{ highConvictionScore: "desc" }, { confidenceScore: "desc" }, { createdAt: "desc" }],
        take: 20,
      });

      return c.json({
        data: posts.map((post) => ({
          id: post.id,
          content: post.content,
          postType: post.postType ?? (post.contractAddress ? "alpha" : "discussion"),
          contractAddress: post.contractAddress,
          tokenSymbol: post.tokenSymbol,
          tokenName: post.tokenName,
          tokenImage: post.tokenImage,
          confidenceScore: post.confidenceScore,
          highConvictionScore: post.highConvictionScore,
          roiCurrentPct: post.roiCurrentPct,
          createdAt: post.createdAt.toISOString(),
          engagementCount: post.likes.length + post.reposts.length + post.comments.length,
          author: serializeCommunityAuthor(post.author),
        })),
      });
    } catch (error) {
      const mapped = mapRouteError(error);
      if (mapped) return c.json(mapped.error, mapped.status);
      throw error;
    }
  },
);

tokenCommunitiesRouter.get(
  "/:tokenAddress/community/raids",
  zValidator("param", TokenAddressParamSchema),
  async (c) => {
    try {
      const token = await resolveTokenByAddressOrThrow(c.req.valid("param").tokenAddress);
      const raids = await prisma.tokenRaidCampaign.findMany({
        where: { tokenId: token.id },
        select: {
          id: true,
          status: true,
          objective: true,
          openedAt: true,
          closedAt: true,
          createdAt: true,
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
          participants: { select: { id: true } },
          submissions: {
            where: { xPostUrl: { not: null } },
            select: { id: true },
          },
        },
        orderBy: { openedAt: "desc" },
        take: 20,
      });

      return c.json({
        data: raids.map((raid) => ({
          id: raid.id,
          status: raid.status,
          objective: raid.objective,
          openedAt: raid.openedAt.toISOString(),
          closedAt: raid.closedAt?.toISOString() ?? null,
          createdAt: raid.createdAt.toISOString(),
          participantCount: raid.participants.length,
          postedCount: raid.submissions.length,
          createdBy: serializeCommunityAuthor(raid.createdBy),
        })),
      });
    } catch (error) {
      const mapped = mapRouteError(error);
      if (mapped) return c.json(mapped.error, mapped.status);
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
      const active = await loadActiveRaidView(token, c.get("user")?.id ?? null);
      return c.json({ data: active });
    } catch (error) {
      const mapped = mapRouteError(error);
      if (mapped) return c.json(mapped.error, mapped.status);
      throw error;
    }
  },
);

tokenCommunitiesRouter.get(
  "/:tokenAddress/community/raids/:raidId",
  zValidator("param", TokenAddressParamSchema.extend({ raidId: z.string().trim().min(1) })),
  async (c) => {
    try {
      const { tokenAddress, raidId } = c.req.valid("param");
      const token = await resolveTokenByAddressOrThrow(tokenAddress);
      const detail = await loadRaidDetailView(
        {
          id: token.id,
          address: token.address,
          symbol: token.symbol ?? null,
          name: token.name ?? null,
          imageUrl: token.imageUrl ?? null,
        },
        raidId,
        c.get("user")?.id ?? null,
      );
      if (!detail) {
        return c.json({ error: { message: "Raid not found", code: "NOT_FOUND" } }, 404);
      }
      return c.json({ data: detail });
    } catch (error) {
      const mapped = mapRouteError(error);
      if (mapped) return c.json(mapped.error, mapped.status);
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
      const profile = await requireExistingCommunity(token.id);
      await requireCommunityMembership(token.id, viewer.id);
      assertTrustedMember(viewer, Math.max(profile.raidLeadMinLevel ?? 3, 3));

      const [activeExisting, raidContext] = await Promise.all([
        prisma.tokenRaidCampaign.findFirst({
          where: { tokenId: token.id, status: "active" },
          select: {
            id: true,
            objective: true,
            memeOptionsJson: true,
            copyOptionsJson: true,
            generationHistoryJson: true,
            thread: { select: { id: true } },
          },
        }),
        loadRaidContext(token.id),
      ]);

      if (activeExisting && !payload.replaceActive) {
        return c.json(
          { error: { message: "An active raid campaign already exists", code: "ACTIVE_RAID_EXISTS" } },
          409,
        );
      }

      const objective =
        payload.objective?.trim() ||
        `Make ${normalizeCashtag(profile.xCashtag ?? null, token.symbol) || "$TOKEN"} impossible to ignore without sounding desperate.`;

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
            data: {
              status: "closed",
              activeKey: null,
              closedAt: new Date(),
              generationHistoryJson: buildGenerationHistoryJson(
                activeExisting.generationHistoryJson,
                activeExisting,
              ),
            },
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
            generationHistoryJson: [],
            activeKey: `${token.id}:active`,
          },
          select: {
            id: true,
          },
        });

        await tx.tokenCommunityThread.create({
          data: {
            tokenId: token.id,
            authorId: viewer.id,
            title: `Raid campaign live: ${(token.symbol ? `$${token.symbol}` : token.name || "Token").trim()}`,
            content: `${objective}\n\nJoin the raid campaign, pick a meme, pick a line, and post the receipt back here.`,
            kind: "raid",
            raidCampaignId: raid.id,
            isPinned: true,
            lastActivityAt: new Date(),
          },
        });

        await tx.tokenRaidParticipant.create({
          data: {
            raidCampaignId: raid.id,
            userId: viewer.id,
            status: "joined",
            currentStep: "meme",
          },
        });
        await mutateCommunityMemberStats({
          db: tx,
          tokenId: token.id,
          userId: viewer.id,
          raidsJoined: 1,
          raidsLaunched: 1,
          lastActiveAt: new Date(),
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

      const active = await loadActiveRaidView(token, viewer.id);
      return c.json({ data: active }, 201);
    } catch (error) {
      const mapped = mapRouteError(error);
      if (mapped) return c.json(mapped.error, mapped.status);
      throw error;
    }
  },
);

tokenCommunitiesRouter.post(
  "/:tokenAddress/community/raids/:raidId/join",
  requireNotBanned,
  zValidator("param", TokenAddressParamSchema.extend({ raidId: z.string().trim().min(1) })),
  async (c) => {
    try {
      const viewer = c.get("user")!;
      const { tokenAddress, raidId } = c.req.valid("param");
      const token = await resolveTokenByAddressOrThrow(tokenAddress);
      await requireExistingCommunity(token.id);
      await requireCommunityMembership(token.id, viewer.id);
      const raid = await prisma.tokenRaidCampaign.findFirst({
        where: { id: raidId, tokenId: token.id },
        select: { id: true, status: true },
      });
      if (!raid) {
        return c.json({ error: { message: "Raid not found", code: "NOT_FOUND" } }, 404);
      }
      if (raid.status !== "active") {
        return c.json({ error: { message: "Raid is closed", code: "RAID_CLOSED" } }, 409);
      }

      const existing = await prisma.tokenRaidParticipant.findUnique({
        where: {
          raidCampaignId_userId: {
            raidCampaignId: raid.id,
            userId: viewer.id,
          },
        },
        select: { id: true },
      });

      const participant = await prisma.tokenRaidParticipant.upsert({
        where: {
          raidCampaignId_userId: {
            raidCampaignId: raid.id,
            userId: viewer.id,
          },
        },
        create: {
          raidCampaignId: raid.id,
          userId: viewer.id,
          status: "joined",
          currentStep: "meme",
        },
        update: {
          status: "joined",
          currentStep: "meme",
        },
        select: {
          id: true,
          status: true,
          currentStep: true,
          joinedAt: true,
          launchedAt: true,
          postedAt: true,
        },
      });

      if (!existing) {
        await mutateCommunityMemberStats({
          tokenId: token.id,
          userId: viewer.id,
          raidsJoined: 1,
          lastActiveAt: new Date(),
        });
      }

      return c.json({ data: serializeParticipant(participant) });
    } catch (error) {
      const mapped = mapRouteError(error);
      if (mapped) return c.json(mapped.error, mapped.status);
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
      const profile = await requireExistingCommunity(token.id);
      await requireCommunityMembership(token.id, viewer.id);
      assertTrustedMember(viewer, Math.max(profile.raidLeadMinLevel ?? 3, 3));

      const [raid, raidContext] = await Promise.all([
        prisma.tokenRaidCampaign.findFirst({
          where: { id: raidId, tokenId: token.id },
          select: {
            id: true,
            objective: true,
            status: true,
            memeOptionsJson: true,
            copyOptionsJson: true,
            generationHistoryJson: true,
          },
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

      await prisma.tokenRaidCampaign.update({
        where: { id: raid.id },
        data: {
          memeOptionsJson: generated.memeOptions,
          copyOptionsJson: generated.copyOptions,
          generationHistoryJson: buildGenerationHistoryJson(raid.generationHistoryJson, raid),
        },
      });

      const active = await loadActiveRaidView(token, viewer.id);
      return c.json({ data: active });
    } catch (error) {
      const mapped = mapRouteError(error);
      if (mapped) return c.json(mapped.error, mapped.status);
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
      await requireExistingCommunity(token.id);
      await requireCommunityMembership(token.id, viewer.id);
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

      const participant = await prisma.tokenRaidParticipant.findUnique({
        where: {
          raidCampaignId_userId: {
            raidCampaignId: raid.id,
            userId: viewer.id,
          },
        },
        select: { id: true },
      });
      if (!participant) {
        return c.json({ error: { message: "Join the raid campaign first", code: "RAID_JOIN_REQUIRED" } }, 403);
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

      const submission = await prisma.$transaction(async (tx) => {
        const next = await tx.tokenRaidSubmission.upsert({
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
            boosts: {
              select: { userId: true },
            },
          },
        });
        await tx.tokenRaidParticipant.update({
          where: {
            raidCampaignId_userId: {
              raidCampaignId: raid.id,
              userId: viewer.id,
            },
          },
          data: {
            status: "launched",
            currentStep: "launch",
            launchedAt: new Date(),
          },
        });
        await mutateCommunityMemberStats({
          db: tx,
          tokenId: token.id,
          userId: viewer.id,
          lastActiveAt: new Date(),
        });
        return next;
      });

      return c.json({
        data: serializeSubmission(viewer.id, submission as Parameters<typeof serializeSubmission>[1]),
      });
    } catch (error) {
      const mapped = mapRouteError(error);
      if (mapped) return c.json(mapped.error, mapped.status);
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
      await requireExistingCommunity(token.id);
      await requireCommunityMembership(token.id, viewer.id);
      const raid = await prisma.tokenRaidCampaign.findFirst({
        where: { id: raidId, tokenId: token.id },
        select: { id: true },
      });
      if (!raid) {
        return c.json({ error: { message: "Raid not found", code: "NOT_FOUND" } }, 404);
      }

      const existingStats = await prisma.tokenCommunityMemberStats.findUnique({
        where: {
          tokenId_userId: {
            tokenId: token.id,
            userId: viewer.id,
          },
        },
        select: {
          currentRaidStreak: true,
          bestRaidStreak: true,
        },
      });
      const nextStreak = (existingStats?.currentRaidStreak ?? 0) + 1;
      const nextBest = Math.max(existingStats?.bestRaidStreak ?? 0, nextStreak);

      const submission = await prisma.$transaction(async (tx) => {
        const next = await tx.tokenRaidSubmission.update({
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
            boosts: {
              select: { userId: true },
            },
          },
        });
        await tx.tokenRaidParticipant.upsert({
          where: {
            raidCampaignId_userId: {
              raidCampaignId: raid.id,
              userId: viewer.id,
            },
          },
          create: {
            raidCampaignId: raid.id,
            userId: viewer.id,
            status: "posted",
            currentStep: "complete",
            launchedAt: new Date(),
            postedAt: new Date(),
          },
          update: {
            status: "posted",
            currentStep: "complete",
            postedAt: new Date(),
          },
        });
        await mutateCommunityMemberStats({
          db: tx,
          tokenId: token.id,
          userId: viewer.id,
          raidPostsLinked: 1,
          setCurrentRaidStreak: nextStreak,
          setBestRaidStreak: nextBest,
          lastActiveAt: new Date(),
        });
        return next;
      });

      return c.json({
        data: serializeSubmission(viewer.id, submission as Parameters<typeof serializeSubmission>[1]),
      });
    } catch (error) {
      const mapped = mapRouteError(error);
      if (mapped) return c.json(mapped.error, mapped.status);
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
      await prisma.tokenRaidParticipant.update({
        where: {
          raidCampaignId_userId: {
            raidCampaignId: raid.id,
            userId: viewer.id,
          },
        },
        data: {
          status: "joined",
          currentStep: "preview",
          postedAt: null,
        },
      }).catch(() => undefined);

      return c.json({ data: { deleted: true } });
    } catch (error) {
      const mapped = mapRouteError(error);
      if (mapped) return c.json(mapped.error, mapped.status);
      throw error;
    }
  },
);

tokenCommunitiesRouter.post(
  "/:tokenAddress/community/raids/:raidId/submissions/:submissionId/boosts",
  requireNotBanned,
  zValidator(
    "param",
    TokenAddressParamSchema.extend({
      raidId: z.string().trim().min(1),
      submissionId: z.string().trim().min(1),
    }),
  ),
  async (c) => {
    try {
      const viewer = c.get("user")!;
      const { tokenAddress, raidId, submissionId } = c.req.valid("param");
      const token = await resolveTokenByAddressOrThrow(tokenAddress);
      await requireExistingCommunity(token.id);
      await requireCommunityMembership(token.id, viewer.id);
      const submission = await prisma.tokenRaidSubmission.findFirst({
        where: {
          id: submissionId,
          raidCampaignId: raidId,
          raidCampaign: { tokenId: token.id },
          xPostUrl: { not: null },
        },
        select: {
          id: true,
        },
      });
      if (!submission) {
        return c.json({ error: { message: "Submission not found", code: "NOT_FOUND" } }, 404);
      }

      const existing = await prisma.tokenRaidBoost.findUnique({
        where: {
          submissionId_userId: {
            submissionId: submission.id,
            userId: viewer.id,
          },
        },
        select: { id: true },
      });
      if (!existing) {
        await prisma.tokenRaidBoost.create({
          data: {
            submissionId: submission.id,
            userId: viewer.id,
          },
        });
        await mutateCommunityMemberStats({
          tokenId: token.id,
          userId: viewer.id,
          boostsGiven: 1,
          lastActiveAt: new Date(),
        });
      }

      const count = await prisma.tokenRaidBoost.count({
        where: { submissionId: submission.id },
      });
      return c.json({ data: { boosted: true, boostCount: count } });
    } catch (error) {
      const mapped = mapRouteError(error);
      if (mapped) return c.json(mapped.error, mapped.status);
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
          boosts: {
            select: { userId: true },
          },
        },
        orderBy: [{ postedAt: "desc" }, { createdAt: "desc" }],
        take: 60,
      });

      return c.json({
        data: submissions.map((submission) =>
          serializeSubmission(c.get("user")?.id ?? null, submission as Parameters<typeof serializeSubmission>[1]),
        ),
      });
    } catch (error) {
      const mapped = mapRouteError(error);
      if (mapped) return c.json(mapped.error, mapped.status);
      throw error;
    }
  },
);
