import type { PrismaClient, Prisma } from "@prisma/client";
import { prisma } from "../prisma.js";

type CommunityAuthorInput = {
  id: string;
  name: string;
  username: string | null;
  image: string | null;
  level: number;
  isVerified?: boolean | null;
};

export function serializeCommunityAuthor(author: CommunityAuthorInput) {
  return {
    id: author.id,
    name: author.name,
    username: author.username,
    image: author.image,
    level: author.level,
    isVerified: author.isVerified ?? false,
  };
}

export function serializeCommunityAsset(
  tokenAddress: string,
  asset: {
    id: string;
    kind: string;
    status: string;
    url: string;
    objectKey: string;
    mimeType: string;
    width: number | null;
    height: number | null;
    sizeBytes: number | null;
    sortOrder: number;
    createdAt: Date;
  },
) {
  return {
    id: asset.id,
    kind: asset.kind,
    status: asset.status,
    url: asset.url,
    renderUrl: `/api/tokens/${tokenAddress}/community/assets/${asset.id}/content`,
    objectKey: asset.objectKey,
    mimeType: asset.mimeType,
    width: asset.width,
    height: asset.height,
    sizeBytes: asset.sizeBytes,
    sortOrder: asset.sortOrder,
    createdAt: asset.createdAt.toISOString(),
  };
}

export async function mutateCommunityMemberStats(params: {
  db?: PrismaClient | Prisma.TransactionClient;
  tokenId: string;
  userId: string;
  threadCount?: number;
  replyCount?: number;
  reactionsReceived?: number;
  raidsJoined?: number;
  raidsLaunched?: number;
  raidPostsLinked?: number;
  boostsGiven?: number;
  contributionScore?: number;
  setCurrentRaidStreak?: number;
  setBestRaidStreak?: number;
  joinedAt?: Date;
  lastActiveAt?: Date;
}) {
  const db = params.db ?? prisma;
  const now = params.lastActiveAt ?? new Date();
  const createContribution =
    (params.threadCount ?? 0) * 6 +
    (params.replyCount ?? 0) * 3 +
    (params.reactionsReceived ?? 0) * 2 +
    (params.raidsJoined ?? 0) * 4 +
    (params.raidsLaunched ?? 0) * 12 +
    (params.raidPostsLinked ?? 0) * 16 +
    (params.boostsGiven ?? 0) * 2 +
    (params.contributionScore ?? 0);
  await db.tokenCommunityMemberStats.upsert({
    where: {
      tokenId_userId: {
        tokenId: params.tokenId,
        userId: params.userId,
      },
    },
    create: {
      tokenId: params.tokenId,
      userId: params.userId,
      joinedAt: params.joinedAt ?? now,
      lastActiveAt: now,
      threadCount: Math.max(0, params.threadCount ?? 0),
      replyCount: Math.max(0, params.replyCount ?? 0),
      reactionsReceived: Math.max(0, params.reactionsReceived ?? 0),
      raidsJoined: Math.max(0, params.raidsJoined ?? 0),
      raidsLaunched: Math.max(0, params.raidsLaunched ?? 0),
      raidPostsLinked: Math.max(0, params.raidPostsLinked ?? 0),
      boostsGiven: Math.max(0, params.boostsGiven ?? 0),
      contributionScore: Math.max(0, createContribution),
      currentRaidStreak: Math.max(0, params.setCurrentRaidStreak ?? (params.raidPostsLinked ? 1 : 0)),
      bestRaidStreak: Math.max(0, params.setBestRaidStreak ?? (params.raidPostsLinked ? 1 : 0)),
    },
    update: {
      lastActiveAt: now,
      ...(params.threadCount ? { threadCount: { increment: params.threadCount } } : {}),
      ...(params.replyCount ? { replyCount: { increment: params.replyCount } } : {}),
      ...(params.reactionsReceived ? { reactionsReceived: { increment: params.reactionsReceived } } : {}),
      ...(params.raidsJoined ? { raidsJoined: { increment: params.raidsJoined } } : {}),
      ...(params.raidsLaunched ? { raidsLaunched: { increment: params.raidsLaunched } } : {}),
      ...(params.raidPostsLinked ? { raidPostsLinked: { increment: params.raidPostsLinked } } : {}),
      ...(params.boostsGiven ? { boostsGiven: { increment: params.boostsGiven } } : {}),
      ...(createContribution ? { contributionScore: { increment: createContribution } } : {}),
      ...(params.setCurrentRaidStreak !== undefined ? { currentRaidStreak: params.setCurrentRaidStreak } : {}),
      ...(params.setBestRaidStreak !== undefined ? { bestRaidStreak: params.setBestRaidStreak } : {}),
      ...(params.joinedAt ? { joinedAt: params.joinedAt } : {}),
    },
  });
}

export async function loadTokenCommunityRoom(params: {
  tokenId: string;
  tokenAddress: string;
  viewerId: string | null;
  viewerLevel: number;
  viewerIsAdmin: boolean;
}) {
  const [profile, follow, memberCount, activeThreadCount, recentMembers, suggestedThread, assets, topContributors, viewerStats] =
    await Promise.all([
      prisma.tokenCommunityProfile.findUnique({
        where: { tokenId: params.tokenId },
        select: {
          id: true,
          headline: true,
          xCashtag: true,
          raidLeadMinLevel: true,
          whyLine: true,
          welcomePrompt: true,
          vibeTags: true,
          mascotName: true,
          voiceHints: true,
          insideJokes: true,
          updatedAt: true,
        },
      }),
      params.viewerId
        ? prisma.tokenFollow.findUnique({
            where: {
              userId_tokenId: {
                userId: params.viewerId,
                tokenId: params.tokenId,
              },
            },
            select: { createdAt: true },
          })
        : null,
      prisma.tokenFollow.count({
        where: { tokenId: params.tokenId },
      }),
      prisma.tokenCommunityThread.count({
        where: { tokenId: params.tokenId, deletedAt: null },
      }),
      prisma.tokenFollow.findMany({
        where: { tokenId: params.tokenId },
        select: {
          createdAt: true,
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
        orderBy: { createdAt: "desc" },
        take: 6,
      }),
      prisma.tokenCommunityThread.findFirst({
        where: {
          tokenId: params.tokenId,
          deletedAt: null,
        },
        select: {
          id: true,
          title: true,
          content: true,
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
        orderBy: [{ replyCount: "desc" }, { lastActivityAt: "desc" }],
      }),
      prisma.tokenCommunityAsset.findMany({
        where: { tokenId: params.tokenId, status: "ready" },
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
        orderBy: [{ kind: "asc" }, { sortOrder: "asc" }, { createdAt: "desc" }],
      }),
      prisma.tokenCommunityMemberStats.findMany({
        where: { tokenId: params.tokenId },
        select: {
          contributionScore: true,
          currentRaidStreak: true,
          bestRaidStreak: true,
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
        take: 6,
      }),
      params.viewerId
        ? prisma.tokenCommunityMemberStats.findUnique({
            where: {
              tokenId_userId: {
                tokenId: params.tokenId,
                userId: params.viewerId,
              },
            },
            select: {
              threadCount: true,
              replyCount: true,
              raidsJoined: true,
              raidPostsLinked: true,
              currentRaidStreak: true,
              bestRaidStreak: true,
            },
          })
        : null,
    ]);

  const exists = Boolean(profile);
  if (!exists) {
    return {
      exists: false,
      canCreate: params.viewerIsAdmin || params.viewerLevel >= 3,
      canJoin: false,
      joined: false,
      joinedAt: null,
      memberCount: 0,
      onlineNowEstimate: 0,
      activeThreadCount: 0,
      currentRaidPulse: null,
      topContributors: [],
      recentMembers: [],
      whyLine: null,
      welcomePrompt: null,
      suggestedThread: null,
      activeRaidSummary: null,
      recentWins: [],
      headline: null,
      xCashtag: null,
      vibeTags: [],
      mascotName: null,
      assets: {
        logo: null,
        banner: null,
        mascot: null,
        referenceMemes: [],
      },
      viewer: {
        joined: false,
        joinedAt: null,
        hasPosted: false,
        hasReplied: false,
        hasRaided: false,
        showWelcomeBanner: false,
        suggestedAction: params.viewerIsAdmin || params.viewerLevel >= 3 ? "create-community" : "wait-community",
      },
    };
  }

  if (!profile) {
    throw new Error("Community profile expected for existing room");
  }
  const ensuredProfile = profile;

  const activeRaid = await prisma.tokenRaidCampaign.findFirst({
    where: {
      tokenId: params.tokenId,
      status: "active",
    },
    select: {
      id: true,
      objective: true,
      openedAt: true,
      thread: { select: { id: true } },
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
          status: true,
          userId: true,
          postedAt: true,
        },
      },
      submissions: {
        where: { xPostUrl: { not: null } },
        select: {
          id: true,
          xPostUrl: true,
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
          boosts: {
            select: {
              id: true,
            },
          },
        },
        orderBy: [{ postedAt: "desc" }, { createdAt: "desc" }],
        take: 6,
      },
    },
  });

  const onlineThreshold = Date.now() - 30 * 60_000;
  const onlineNowEstimate = await prisma.tokenCommunityMemberStats.count({
    where: {
      tokenId: params.tokenId,
      lastActiveAt: { gte: new Date(onlineThreshold) },
    },
  });

  const logoAsset = assets.find((asset) => asset.kind === "logo") ?? null;
  const bannerAsset = assets.find((asset) => asset.kind === "banner") ?? null;
  const mascotAsset = assets.find((asset) => asset.kind === "mascot") ?? null;
  const referenceMemes = assets.filter((asset) => asset.kind === "reference_meme").slice(0, 5);
  const postedCount = activeRaid?.submissions.length ?? 0;
  const participantCount = activeRaid?.participants.length ?? 0;
  const joined = Boolean(follow);
  const showWelcomeBanner =
    joined &&
    (!viewerStats || (viewerStats.threadCount ?? 0) + (viewerStats.replyCount ?? 0) + (viewerStats.raidsJoined ?? 0) === 0);

  return {
    exists: true,
    canCreate: false,
    canJoin: !joined,
    joined,
    joinedAt: follow?.createdAt?.toISOString() ?? null,
    memberCount,
    onlineNowEstimate,
    activeThreadCount,
    currentRaidPulse: activeRaid
      ? {
          label: postedCount > 0 ? `${postedCount} posts linked` : `${participantCount} raiders joined`,
          participantCount,
          postedCount,
        }
      : null,
    topContributors: topContributors.map((entry) => ({
      user: serializeCommunityAuthor(entry.user),
      contributionScore: entry.contributionScore,
      currentRaidStreak: entry.currentRaidStreak,
      bestRaidStreak: entry.bestRaidStreak,
      badge: entry.user.level >= 8 ? "elite" : entry.user.level >= 5 ? "trusted" : "room-regular",
    })),
    recentMembers: recentMembers.map((entry) => ({
      joinedAt: entry.createdAt.toISOString(),
      user: serializeCommunityAuthor(entry.user),
    })),
    whyLine: ensuredProfile.whyLine ?? null,
    welcomePrompt: ensuredProfile.welcomePrompt ?? null,
    suggestedThread: suggestedThread
      ? {
          id: suggestedThread.id,
          title: suggestedThread.title,
          content: suggestedThread.content,
          createdAt: suggestedThread.createdAt.toISOString(),
          author: serializeCommunityAuthor(suggestedThread.author),
        }
      : null,
    activeRaidSummary: activeRaid
      ? {
          id: activeRaid.id,
          objective: activeRaid.objective,
          openedAt: activeRaid.openedAt.toISOString(),
          threadId: activeRaid.thread?.id ?? null,
          joinedCount: participantCount,
          postedCount,
          createdBy: serializeCommunityAuthor(activeRaid.createdBy),
        }
      : null,
    recentWins: (activeRaid?.submissions ?? []).map((submission) => ({
      id: submission.id,
      xPostUrl: submission.xPostUrl,
      postedAt: submission.postedAt?.toISOString() ?? null,
      boostCount: submission.boosts.length,
      user: serializeCommunityAuthor(submission.user),
    })),
    headline: ensuredProfile.headline ?? null,
    xCashtag: ensuredProfile.xCashtag ?? null,
    vibeTags: Array.isArray(ensuredProfile.vibeTags) ? ensuredProfile.vibeTags : [],
    mascotName: ensuredProfile.mascotName ?? null,
    assets: {
      logo: logoAsset ? serializeCommunityAsset(params.tokenAddress, logoAsset) : null,
      banner: bannerAsset ? serializeCommunityAsset(params.tokenAddress, bannerAsset) : null,
      mascot: mascotAsset ? serializeCommunityAsset(params.tokenAddress, mascotAsset) : null,
      referenceMemes: referenceMemes.map((asset) => serializeCommunityAsset(params.tokenAddress, asset)),
    },
    viewer: {
      joined,
      joinedAt: follow?.createdAt?.toISOString() ?? null,
      hasPosted: Boolean((viewerStats?.threadCount ?? 0) > 0),
      hasReplied: Boolean((viewerStats?.replyCount ?? 0) > 0),
      hasRaided: Boolean((viewerStats?.raidsJoined ?? 0) > 0 || (viewerStats?.raidPostsLinked ?? 0) > 0),
      showWelcomeBanner,
      suggestedAction: !joined
        ? "join-community"
        : activeRaid
          ? "join-raid"
          : suggestedThread
            ? "reply-thread"
            : "introduce",
      currentRaidStreak: viewerStats?.currentRaidStreak ?? 0,
      bestRaidStreak: viewerStats?.bestRaidStreak ?? 0,
    },
  };
}
