import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Hono } from "hono";
import type { AuthVariables } from "./auth.js";
import { prisma } from "./prisma.js";
import { tokenCommunitiesRouter } from "./routes/token-communities.js";

type GenericAsyncFn = (...args: unknown[]) => Promise<unknown>;
type TransactionAsyncFn = (...args: unknown[]) => Promise<unknown>;

type MockUser = {
  id: string;
  name: string;
  username: string | null;
  image: string | null;
  level: number;
  isAdmin: boolean;
  isVerified: boolean;
  isBanned: boolean;
};

type MockState = {
  users: Record<string, MockUser>;
  token: {
    id: string;
    address: string;
    symbol: string;
    name: string;
    chainType: string;
    holderCount: number;
    sentimentScore: number;
    confidenceScore: number;
    hotAlphaScore: number;
    earlyRunnerScore: number;
    highConvictionScore: number;
    updatedAt: Date;
  };
  profile: {
    raidLeadMinLevel: number;
    id?: string;
    headline?: string | null;
    xCashtag?: string | null;
    voiceHints?: string[];
    insideJokes?: string[];
    preferredTemplateIds?: string[];
    whyLine?: string | null;
    welcomePrompt?: string | null;
    vibeTags?: string[];
    mascotName?: string | null;
    createdAt?: Date;
    updatedAt?: Date;
  } | null;
  joinedUserIds: string[];
  existingThread: {
    id: string;
    tokenId: string;
    authorId: string;
    deletedAt: Date | null;
  } | null;
  createdThreadAuthorId: string;
  activeRaid: {
    id: string;
    tokenId: string;
    status: "active" | "closed";
    objective: string;
    memeOptionsJson: unknown;
    copyOptionsJson: unknown;
    thread: { id: string } | null;
  } | null;
  raidHistory: Array<{
    objective: string;
    memeOptionsJson: unknown;
    copyOptionsJson: unknown;
  }>;
  raidParticipants: Array<{
    id: string;
    raidCampaignId: string;
    userId: string;
    status: string;
    currentStep: string;
    joinedAt: Date;
    launchedAt: Date | null;
    postedAt: Date | null;
  }>;
  submissionUpserts: unknown[];
  threadUpdates: unknown[];
  notificationsCreated: unknown[];
  notificationsCreatedMany: unknown[];
};

type UserDelegate = { findUnique: GenericAsyncFn };
type TokenDelegate = { findFirst: GenericAsyncFn; findUnique: GenericAsyncFn };
type PostDelegate = { findFirst: GenericAsyncFn };
type TokenCommunityProfileDelegate = { findUnique: GenericAsyncFn; upsert: GenericAsyncFn };
type TokenCommunityThreadDelegate = {
  findMany: GenericAsyncFn;
  findFirst: GenericAsyncFn;
  create: GenericAsyncFn;
  update: GenericAsyncFn;
};
type TokenCommunityReplyDelegate = {
  findMany: GenericAsyncFn;
  findFirst: GenericAsyncFn;
  create: GenericAsyncFn;
  update: GenericAsyncFn;
};
type TokenRaidCampaignDelegate = {
  findFirst: GenericAsyncFn;
  findMany: GenericAsyncFn;
};
type TokenRaidParticipantDelegate = {
  findUnique: GenericAsyncFn;
  create: GenericAsyncFn;
  upsert: GenericAsyncFn;
  update: GenericAsyncFn;
};
type TokenRaidSubmissionDelegate = {
  upsert: GenericAsyncFn;
  update: GenericAsyncFn;
  delete: GenericAsyncFn;
  findMany: GenericAsyncFn;
};
type TokenFollowDelegate = { findMany: GenericAsyncFn; findUnique: GenericAsyncFn };
type TokenCommunityAssetDelegate = { findMany: GenericAsyncFn };
type TokenCommunityMemberStatsDelegate = {
  upsert: GenericAsyncFn;
  findUnique: GenericAsyncFn;
  findMany: GenericAsyncFn;
  count: GenericAsyncFn;
};
type NotificationDelegate = { create: GenericAsyncFn; createMany: GenericAsyncFn };
type PrismaTransactionHolder = { $transaction: TransactionAsyncFn };

const prismaTransactionHolder = prisma as unknown as PrismaTransactionHolder;
const userDelegate = prisma.user as unknown as UserDelegate;
const tokenDelegate = prisma.token as unknown as TokenDelegate;
const postDelegate = prisma.post as unknown as PostDelegate;
const tokenCommunityProfileDelegate = prisma.tokenCommunityProfile as unknown as TokenCommunityProfileDelegate;
const tokenCommunityThreadDelegate = prisma.tokenCommunityThread as unknown as TokenCommunityThreadDelegate;
const tokenCommunityReplyDelegate = prisma.tokenCommunityReply as unknown as TokenCommunityReplyDelegate;
const tokenRaidCampaignDelegate = prisma.tokenRaidCampaign as unknown as TokenRaidCampaignDelegate;
const tokenRaidParticipantDelegate = prisma.tokenRaidParticipant as unknown as TokenRaidParticipantDelegate;
const tokenRaidSubmissionDelegate = prisma.tokenRaidSubmission as unknown as TokenRaidSubmissionDelegate;
const tokenFollowDelegate = prisma.tokenFollow as unknown as TokenFollowDelegate;
const tokenCommunityAssetDelegate = prisma.tokenCommunityAsset as unknown as TokenCommunityAssetDelegate;
const tokenCommunityMemberStatsDelegate =
  prisma.tokenCommunityMemberStats as unknown as TokenCommunityMemberStatsDelegate;
const notificationDelegate = prisma.notification as unknown as NotificationDelegate;

const originals = {
  userFindUnique: userDelegate.findUnique,
  tokenFindFirst: tokenDelegate.findFirst,
  tokenFindUnique: tokenDelegate.findUnique,
  postFindFirst: postDelegate.findFirst,
  profileFindUnique: tokenCommunityProfileDelegate.findUnique,
  profileUpsert: tokenCommunityProfileDelegate.upsert,
  threadFindMany: tokenCommunityThreadDelegate.findMany,
  threadFindFirst: tokenCommunityThreadDelegate.findFirst,
  threadCreate: tokenCommunityThreadDelegate.create,
  threadUpdate: tokenCommunityThreadDelegate.update,
  replyFindMany: tokenCommunityReplyDelegate.findMany,
  replyFindFirst: tokenCommunityReplyDelegate.findFirst,
  replyCreate: tokenCommunityReplyDelegate.create,
  replyUpdate: tokenCommunityReplyDelegate.update,
  raidFindFirst: tokenRaidCampaignDelegate.findFirst,
  raidFindMany: tokenRaidCampaignDelegate.findMany,
  raidParticipantFindUnique: tokenRaidParticipantDelegate.findUnique,
  raidParticipantCreate: tokenRaidParticipantDelegate.create,
  raidParticipantUpsert: tokenRaidParticipantDelegate.upsert,
  raidParticipantUpdate: tokenRaidParticipantDelegate.update,
  submissionUpsert: tokenRaidSubmissionDelegate.upsert,
  submissionUpdate: tokenRaidSubmissionDelegate.update,
  submissionDelete: tokenRaidSubmissionDelegate.delete,
  submissionFindMany: tokenRaidSubmissionDelegate.findMany,
  followFindMany: tokenFollowDelegate.findMany,
  followFindUnique: tokenFollowDelegate.findUnique,
  assetFindMany: tokenCommunityAssetDelegate.findMany,
  memberStatsUpsert: tokenCommunityMemberStatsDelegate.upsert,
  memberStatsFindUnique: tokenCommunityMemberStatsDelegate.findUnique,
  memberStatsFindMany: tokenCommunityMemberStatsDelegate.findMany,
  memberStatsCount: tokenCommunityMemberStatsDelegate.count,
  notificationCreate: notificationDelegate.create,
  notificationCreateMany: notificationDelegate.createMany,
  transaction: prismaTransactionHolder.$transaction,
};

function createDefaultState(): MockState {
  return {
    users: {
      member_user: {
        id: "member_user",
        name: "Member User",
        username: "member_user",
        image: null,
        level: 4,
        isAdmin: false,
        isVerified: true,
        isBanned: false,
      },
      low_level_user: {
        id: "low_level_user",
        name: "Low Level",
        username: "lowlevel",
        image: null,
        level: 2,
        isAdmin: false,
        isVerified: false,
        isBanned: false,
      },
      banned_user: {
        id: "banned_user",
        name: "Banned User",
        username: "banned",
        image: null,
        level: 6,
        isAdmin: false,
        isVerified: false,
        isBanned: true,
      },
      thread_author: {
        id: "thread_author",
        name: "Thread Author",
        username: "thread_author",
        image: null,
        level: 5,
        isAdmin: false,
        isVerified: true,
        isBanned: false,
      },
    },
    token: {
      id: "token_1",
      address: "token-address-1",
      symbol: "PHEW",
      name: "Just A Phew",
      chainType: "solana",
      holderCount: 1842,
      sentimentScore: 71,
      confidenceScore: 76,
      hotAlphaScore: 79,
      earlyRunnerScore: 68,
      highConvictionScore: 74,
      updatedAt: new Date("2026-04-20T10:00:00.000Z"),
    },
    profile: {
      id: "profile_1",
      raidLeadMinLevel: 3,
      headline: "$PHEW has a fast, online room that trades jokes and receipts at the same time.",
      xCashtag: "$PHEW",
      voiceHints: ["dry confidence"],
      insideJokes: ["receipts age better than cope"],
      preferredTemplateIds: ["chart-rat"],
      whyLine: "The room exists to keep timing sharp and the excuses outside.",
      welcomePrompt: "Drop your first take or jump into the live raid.",
      vibeTags: ["late-night desk", "receipt room"],
      mascotName: "Phewster",
      createdAt: new Date("2026-04-20T09:45:00.000Z"),
      updatedAt: new Date("2026-04-20T10:00:00.000Z"),
    },
    joinedUserIds: ["member_user", "low_level_user", "thread_author"],
    existingThread: {
      id: "thread_1",
      tokenId: "token_1",
      authorId: "member_user",
      deletedAt: null,
    },
    createdThreadAuthorId: "member_user",
    activeRaid: {
      id: "raid_1",
      tokenId: "token_1",
      status: "active",
      objective: "Make $PHEW impossible to ignore without sounding desperate.",
      memeOptionsJson: [
        {
          id: "meme_1",
          templateId: "chart-rat",
          title: "Receipt Rat",
          angle: "Smug chart-room flex",
          topText: "$PHEW room when the chart fakes weakness for one candle",
          bottomText: "five minutes later and the receipts are everywhere",
          kicker: "the tape looks suspiciously alive",
          footer: "dry confidence",
          toneLabel: "Cleaner flex",
          bestFor: "Hard signal with a grin",
          socialTag: "Most picked by raiders",
          assetIdsUsed: [],
        },
        {
          id: "meme_2",
          templateId: "breaking-news",
          title: "Desk Alert",
          angle: "Fake newsroom bulletin",
          topText: "BREAKING: $PHEW just made the boring people nervous",
          bottomText: "analysts cite bad sleep and suspicious timing",
          kicker: "fast, punchy, and a little sleep-deprived",
          footer: "receipts first, victory laps second",
          toneLabel: "Chaos mode",
          bestFor: "Fast-moving feed pressure",
          socialTag: "Fresh angle",
          assetIdsUsed: [],
        },
        {
          id: "meme_3",
          templateId: "group-chat",
          title: "Unread Messages",
          angle: "Private group chat spiral",
          topText: "the $PHEW group chat the second the chart gets weird",
          bottomText: "three screenshots later everyone is somehow a specialist",
          kicker: "group-chat combustible",
          footer: "internet gremlin discipline",
          toneLabel: "Fresh angle",
          bestFor: "Room energy and jokes",
          socialTag: "Chaos mode",
          assetIdsUsed: [],
        },
      ],
      copyOptionsJson: [
        {
          id: "copy_1",
          style: "deadpan-flex",
          label: "Deadpan flex",
          angle: "Calm, smug, and clipped",
          text: "$PHEW is doing that thing again where the chart acts innocent while the community stacks receipts.",
          voiceLabel: "Cleaner flex",
          bestFor: "Confident room signal",
          socialTag: "Fresh angle",
        },
        {
          id: "copy_2",
          style: "chaos-wire",
          label: "Chaos wire",
          angle: "Fast bulletin energy",
          text: "Desk update: $PHEW just turned the room into a siren factory.",
          voiceLabel: "Chaos mode",
          bestFor: "Fast-moving X post",
          socialTag: "Most picked by raiders",
        },
        {
          id: "copy_3",
          style: "group-chat-spiral",
          label: "Group chat spiral",
          angle: "Private-chat chaos leaking into public",
          text: "The $PHEW group chat has reached the phase where every joke comes with a receipt.",
          voiceLabel: "Room signal",
          bestFor: "Community identity",
          socialTag: "Cleaner flex",
        },
      ],
      thread: { id: "thread_raid_1" },
    },
    raidHistory: [],
    raidParticipants: [
      {
        id: "participant_1",
        raidCampaignId: "raid_1",
        userId: "member_user",
        status: "joined",
        currentStep: "meme",
        joinedAt: new Date("2026-04-20T10:10:00.000Z"),
        launchedAt: null,
        postedAt: null,
      },
    ],
    submissionUpserts: [],
    threadUpdates: [],
    notificationsCreated: [],
    notificationsCreatedMany: [],
  };
}

let state = createDefaultState();

function pickSelected<T extends Record<string, unknown>>(record: T, select: unknown): Partial<T> {
  if (!select || typeof select !== "object") return record;
  const result: Partial<T> = {};
  for (const [key, enabled] of Object.entries(select as Record<string, unknown>)) {
    if (enabled) {
      result[key as keyof T] = record[key as keyof T];
    }
  }
  return result;
}

function createTestApp() {
  const app = new Hono<{ Variables: AuthVariables }>();

  app.use("/api/tokens/*", async (c, next) => {
    const userId = c.req.header("x-test-user-id");

    if (userId) {
      const user = state.users[userId];
      c.set("user", {
        id: userId,
        email: null,
        walletAddress: null,
        role: user?.isAdmin ? "admin" : "user",
        isAdmin: user?.isAdmin ?? false,
        isBanned: user?.isBanned ?? false,
      });
    }

    return next();
  });

  app.route("/api/tokens", tokenCommunitiesRouter);

  return app;
}

beforeEach(() => {
  state = createDefaultState();

  userDelegate.findUnique = async (...args: unknown[]) => {
    const [{ where, select }] = args as [{ where?: { id?: string }; select?: Record<string, boolean> }];
    const id = where?.id ?? "";
    const user = state.users[id];
    if (!user) return null;
    return pickSelected(user, select);
  };

  tokenDelegate.findFirst = async (...args: unknown[]) => {
    const [{ where }] = args as [{ where?: { address?: string } }];
    if (where?.address === state.token.address) {
      return state.token;
    }
    return null;
  };

  tokenDelegate.findUnique = async (...args: unknown[]) => {
    const [{ where }] = args as [{ where?: { id?: string } }];
    if (where?.id === state.token.id) {
      return state.token;
    }
    return null;
  };

  postDelegate.findFirst = async () => null;

  tokenCommunityProfileDelegate.findUnique = async () =>
    state.profile
      ? {
          id: state.profile.id ?? "profile_1",
          headline: state.profile.headline ?? null,
          xCashtag: state.profile.xCashtag ?? "$PHEW",
          voiceHints: state.profile.voiceHints ?? ["dry confidence"],
          insideJokes: state.profile.insideJokes ?? ["receipts age better than cope"],
          preferredTemplateIds: state.profile.preferredTemplateIds ?? ["chart-rat"],
          raidLeadMinLevel: state.profile.raidLeadMinLevel,
          whyLine: state.profile.whyLine ?? null,
          welcomePrompt: state.profile.welcomePrompt ?? null,
          vibeTags: state.profile.vibeTags ?? [],
          mascotName: state.profile.mascotName ?? null,
          createdAt: state.profile.createdAt ?? new Date("2026-04-20T09:45:00.000Z"),
          updatedAt: state.profile.updatedAt ?? new Date("2026-04-20T10:00:00.000Z"),
        }
      : null;

  tokenCommunityProfileDelegate.upsert = async () => null;

  tokenCommunityThreadDelegate.findMany = async () => [];

  tokenCommunityThreadDelegate.findFirst = async (...args: unknown[]) => {
    const [{ where }] = args as [{ where?: { id?: string; tokenId?: string } }];
    if (
      state.existingThread &&
      where?.id === state.existingThread.id &&
      where?.tokenId === state.existingThread.tokenId
    ) {
      return state.existingThread;
    }
    return null;
  };

  tokenCommunityThreadDelegate.create = async () => {
    const author = state.users[state.createdThreadAuthorId]!;
    const createdAt = new Date("2026-04-20T10:15:00.000Z");
    return {
      id: "thread_created_1",
      title: "Late night setup",
      content: "Liquidity woke up and the room got smug fast.",
      kind: "general",
      raidCampaignId: null,
      replyCount: 0,
      isPinned: false,
      lastActivityAt: createdAt,
      deletedAt: null,
      createdAt,
      author: {
        id: author.id,
        name: author.name,
        username: author.username,
        image: author.image,
        level: author.level,
        isVerified: author.isVerified,
      },
    };
  };

  tokenCommunityThreadDelegate.update = async (...args: unknown[]) => {
    state.threadUpdates.push(args[0]);
    return { id: state.existingThread?.id ?? "thread_1" };
  };

  tokenCommunityReplyDelegate.findMany = async () => [];
  tokenCommunityReplyDelegate.findFirst = async () => null;
  tokenCommunityReplyDelegate.create = async () => {
    const author = state.users.member_user!;
    return {
      id: "reply_1",
      content: "Posting the receipts back here.",
      parentId: null,
      rootId: null,
      depth: 0,
      deletedAt: null,
      createdAt: new Date("2026-04-20T10:25:00.000Z"),
      author: {
        id: author.id,
        name: author.name,
        username: author.username,
        image: author.image,
        level: author.level,
        isVerified: author.isVerified,
      },
    };
  };
  tokenCommunityReplyDelegate.update = async () => ({ id: "reply_1" });

  tokenRaidCampaignDelegate.findFirst = async (...args: unknown[]) => {
    const [{ where }] = args as [{ where?: { id?: string; tokenId?: string; status?: string } }];
    if (!state.activeRaid) return null;
    if (where?.tokenId !== state.activeRaid.tokenId) return null;
    if (where?.id && where.id !== state.activeRaid.id) return null;
    if (where?.status && where.status !== state.activeRaid.status) return null;
    return state.activeRaid;
  };

  tokenRaidCampaignDelegate.findMany = async () => state.raidHistory;

  tokenRaidParticipantDelegate.findUnique = async (...args: unknown[]) => {
    const [{ where }] = args as [{ where?: { raidCampaignId_userId?: { raidCampaignId?: string; userId?: string } } }];
    const raidCampaignId = where?.raidCampaignId_userId?.raidCampaignId;
    const userId = where?.raidCampaignId_userId?.userId;
    return state.raidParticipants.find(
      (participant) => participant.raidCampaignId === raidCampaignId && participant.userId === userId,
    ) ?? null;
  };
  tokenRaidParticipantDelegate.create = async (...args: unknown[]) => {
    const [{ data }] = args as [{ data: MockState["raidParticipants"][number] }];
    state.raidParticipants.push({
      id: data.id ?? `participant_${state.raidParticipants.length + 1}`,
      raidCampaignId: data.raidCampaignId,
      userId: data.userId,
      status: data.status,
      currentStep: data.currentStep,
      joinedAt: data.joinedAt ?? new Date("2026-04-20T10:10:00.000Z"),
      launchedAt: data.launchedAt ?? null,
      postedAt: data.postedAt ?? null,
    });
    return state.raidParticipants[state.raidParticipants.length - 1];
  };
  tokenRaidParticipantDelegate.upsert = async (...args: unknown[]) => {
    const [{ where, create, update }] = args as [
      {
        where?: { raidCampaignId_userId?: { raidCampaignId?: string; userId?: string } };
        create: MockState["raidParticipants"][number];
        update: Partial<MockState["raidParticipants"][number]>;
      },
    ];
    const raidCampaignId = where?.raidCampaignId_userId?.raidCampaignId;
    const userId = where?.raidCampaignId_userId?.userId;
    const existing = state.raidParticipants.find(
      (participant) => participant.raidCampaignId === raidCampaignId && participant.userId === userId,
    );
    if (existing) {
      Object.assign(existing, update);
      return existing;
    }
    const created = {
      id: create.id ?? `participant_${state.raidParticipants.length + 1}`,
      raidCampaignId: create.raidCampaignId,
      userId: create.userId,
      status: create.status,
      currentStep: create.currentStep,
      joinedAt: create.joinedAt ?? new Date("2026-04-20T10:10:00.000Z"),
      launchedAt: create.launchedAt ?? null,
      postedAt: create.postedAt ?? null,
    };
    state.raidParticipants.push(created);
    return created;
  };
  tokenRaidParticipantDelegate.update = async (...args: unknown[]) => {
    const [{ where, data }] = args as [
      { where?: { raidCampaignId_userId?: { raidCampaignId?: string; userId?: string } }; data: Partial<MockState["raidParticipants"][number]> },
    ];
    const raidCampaignId = where?.raidCampaignId_userId?.raidCampaignId;
    const userId = where?.raidCampaignId_userId?.userId;
    const existing = state.raidParticipants.find(
      (participant) => participant.raidCampaignId === raidCampaignId && participant.userId === userId,
    );
    if (!existing) return null;
    Object.assign(existing, data);
    return existing;
  };

  tokenRaidSubmissionDelegate.upsert = async (...args: unknown[]) => {
    state.submissionUpserts.push(args[0]);
    const author = state.users.member_user!;
    return {
      id: "submission_1",
      memeOptionId: "meme_1",
      copyOptionId: "copy_1",
      renderPayloadJson: { templateId: "chart-rat" },
      composerText: "Desk update: $PHEW is doing it again.",
      xPostUrl: null,
      postedAt: null,
      createdAt: new Date("2026-04-20T10:30:00.000Z"),
      updatedAt: new Date("2026-04-20T10:30:00.000Z"),
      user: {
        id: author.id,
        name: author.name,
        username: author.username,
        image: author.image,
        level: author.level,
        isVerified: author.isVerified,
      },
    };
  };
  tokenRaidSubmissionDelegate.update = async () => null;
  tokenRaidSubmissionDelegate.delete = async () => null;
  tokenRaidSubmissionDelegate.findMany = async () => [];

  tokenFollowDelegate.findMany = async () => [];
  tokenFollowDelegate.findUnique = async (...args: unknown[]) => {
    const [{ where }] = args as [{ where?: { userId_tokenId?: { userId?: string; tokenId?: string } } }];
    const userId = where?.userId_tokenId?.userId;
    const tokenId = where?.userId_tokenId?.tokenId;
    if (tokenId !== state.token.id || !userId || !state.joinedUserIds.includes(userId)) {
      return null;
    }
    return { createdAt: new Date("2026-04-20T09:50:00.000Z") };
  };

  tokenCommunityAssetDelegate.findMany = async () => [];

  tokenCommunityMemberStatsDelegate.upsert = async () => null;
  tokenCommunityMemberStatsDelegate.findUnique = async () => null;
  tokenCommunityMemberStatsDelegate.findMany = async () => [];
  tokenCommunityMemberStatsDelegate.count = async () => 0;

  notificationDelegate.create = async (...args: unknown[]) => {
    state.notificationsCreated.push(args[0]);
    return null;
  };
  notificationDelegate.createMany = async (...args: unknown[]) => {
    state.notificationsCreatedMany.push(args[0]);
    return { count: 0 };
  };

  prismaTransactionHolder.$transaction = async (...args: unknown[]) => {
    const [callback] = args as [(tx: typeof prisma) => Promise<unknown>];
    return callback(prisma);
  };
});

afterEach(() => {
  userDelegate.findUnique = originals.userFindUnique;
  tokenDelegate.findFirst = originals.tokenFindFirst;
  tokenDelegate.findUnique = originals.tokenFindUnique;
  postDelegate.findFirst = originals.postFindFirst;
  tokenCommunityProfileDelegate.findUnique = originals.profileFindUnique;
  tokenCommunityProfileDelegate.upsert = originals.profileUpsert;
  tokenCommunityThreadDelegate.findMany = originals.threadFindMany;
  tokenCommunityThreadDelegate.findFirst = originals.threadFindFirst;
  tokenCommunityThreadDelegate.create = originals.threadCreate;
  tokenCommunityThreadDelegate.update = originals.threadUpdate;
  tokenCommunityReplyDelegate.findMany = originals.replyFindMany;
  tokenCommunityReplyDelegate.findFirst = originals.replyFindFirst;
  tokenCommunityReplyDelegate.create = originals.replyCreate;
  tokenCommunityReplyDelegate.update = originals.replyUpdate;
  tokenRaidCampaignDelegate.findFirst = originals.raidFindFirst;
  tokenRaidCampaignDelegate.findMany = originals.raidFindMany;
  tokenRaidParticipantDelegate.findUnique = originals.raidParticipantFindUnique;
  tokenRaidParticipantDelegate.create = originals.raidParticipantCreate;
  tokenRaidParticipantDelegate.upsert = originals.raidParticipantUpsert;
  tokenRaidParticipantDelegate.update = originals.raidParticipantUpdate;
  tokenRaidSubmissionDelegate.upsert = originals.submissionUpsert;
  tokenRaidSubmissionDelegate.update = originals.submissionUpdate;
  tokenRaidSubmissionDelegate.delete = originals.submissionDelete;
  tokenRaidSubmissionDelegate.findMany = originals.submissionFindMany;
  tokenFollowDelegate.findMany = originals.followFindMany;
  tokenFollowDelegate.findUnique = originals.followFindUnique;
  tokenCommunityAssetDelegate.findMany = originals.assetFindMany;
  tokenCommunityMemberStatsDelegate.upsert = originals.memberStatsUpsert;
  tokenCommunityMemberStatsDelegate.findUnique = originals.memberStatsFindUnique;
  tokenCommunityMemberStatsDelegate.findMany = originals.memberStatsFindMany;
  tokenCommunityMemberStatsDelegate.count = originals.memberStatsCount;
  notificationDelegate.create = originals.notificationCreate;
  notificationDelegate.createMany = originals.notificationCreateMany;
  prismaTransactionHolder.$transaction = originals.transaction;
});

describe("token communities router", () => {
  test("allows signed-in non-banned users to create community threads", async () => {
    const app = createTestApp();

    const response = await app.request(`/api/tokens/${state.token.address}/community/threads`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-test-user-id": "member_user",
      },
      body: JSON.stringify({
        title: "Late night setup",
        content: "Liquidity woke up and the room got smug fast.",
      }),
    });

    expect(response.status).toBe(201);
    const payload = (await response.json()) as {
      data: { author: { id: string }; kind: string };
    };
    expect(payload.data.author.id).toBe("member_user");
    expect(payload.data.kind).toBe("general");
  });

  test("rejects banned users from creating community threads", async () => {
    const app = createTestApp();

    const response = await app.request(`/api/tokens/${state.token.address}/community/threads`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-test-user-id": "banned_user",
      },
      body: JSON.stringify({
        title: "Blocked",
        content: "This should not get through.",
      }),
    });

    expect(response.status).toBe(403);
    const payload = (await response.json()) as { error: { code: string } };
    expect(payload.error.code).toBe("ACCOUNT_BANNED");
  });

  test("creates replies and notifies the thread author", async () => {
    const app = createTestApp();
    state.existingThread = {
      id: "thread_1",
      tokenId: state.token.id,
      authorId: "thread_author",
      deletedAt: null,
    };

    const response = await app.request(
      `/api/tokens/${state.token.address}/community/threads/thread_1/replies`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-test-user-id": "member_user",
        },
        body: JSON.stringify({
          content: "Posting the receipts back here.",
        }),
      },
    );

    expect(response.status).toBe(201);
    expect(state.threadUpdates).toHaveLength(1);
    expect(state.notificationsCreated).toHaveLength(1);
  });

  test("blocks raid creation for members below the trusted level", async () => {
    const app = createTestApp();

    const response = await app.request(`/api/tokens/${state.token.address}/community/raids`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-test-user-id": "low_level_user",
      },
      body: JSON.stringify({
        objective: "Make $PHEW feel like the funniest room on the timeline.",
      }),
    });

    expect(response.status).toBe(403);
  });

  test("returns a conflict when an active raid already exists", async () => {
    const app = createTestApp();

    const response = await app.request(`/api/tokens/${state.token.address}/community/raids`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-test-user-id": "member_user",
      },
      body: JSON.stringify({
        objective: "Make $PHEW feel like the funniest room on the timeline.",
      }),
    });

    expect(response.status).toBe(409);
    const payload = (await response.json()) as { error: { code: string } };
    expect(payload.error.code).toBe("ACTIVE_RAID_EXISTS");
  });

  test("launch upserts the user's raid submission", async () => {
    const app = createTestApp();

    const response = await app.request(
      `/api/tokens/${state.token.address}/community/raids/${state.activeRaid!.id}/launch`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-test-user-id": "member_user",
        },
        body: JSON.stringify({
          memeOptionId: "meme_1",
          copyOptionId: "copy_1",
          renderPayloadJson: {
            templateId: "chart-rat",
            topText: "Desk update",
          },
          composerText: "Desk update: $PHEW is doing it again.",
        }),
      },
    );

    expect(response.status).toBe(200);
    expect(state.submissionUpserts).toHaveLength(1);
    const payload = (await response.json()) as {
      data: { memeOptionId: string; copyOptionId: string };
    };
    expect(payload.data.memeOptionId).toBe("meme_1");
    expect(payload.data.copyOptionId).toBe("copy_1");
  });

  test("rejects invalid X post URLs before submission updates reach the route handler", async () => {
    const app = createTestApp();

    const response = await app.request(
      `/api/tokens/${state.token.address}/community/raids/${state.activeRaid!.id}/submission`,
      {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          "x-test-user-id": "member_user",
        },
        body: JSON.stringify({
          xPostUrl: "https://x.com/member_user/not-a-status/123",
        }),
      },
    );

    expect(response.status).toBe(400);
  });

  test("soft-deletes community threads for the author", async () => {
    const app = createTestApp();
    state.existingThread = {
      id: "thread_1",
      tokenId: state.token.id,
      authorId: "member_user",
      deletedAt: null,
    };

    const response = await app.request(`/api/tokens/${state.token.address}/community/threads/thread_1`, {
      method: "DELETE",
      headers: {
        "x-test-user-id": "member_user",
      },
    });

    expect(response.status).toBe(200);
    const payload = (await response.json()) as { data: { deleted: boolean } };
    expect(payload.data.deleted).toBe(true);
    expect(state.threadUpdates).toHaveLength(1);
  });
});
