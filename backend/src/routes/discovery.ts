import { Hono } from "hono";
import { prisma } from "../prisma.js";

export const discoveryRouter = new Hono();

function toNumber(value: number | null | undefined, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function normalizeTokenLabel(token: { symbol: string | null; name: string | null }): string {
  return token.symbol?.trim() || token.name?.trim() || "Unknown";
}

function inferSignalDirection(value: string | null | undefined): "LONG" | "SHORT" | null {
  const normalized = value?.toLowerCase() ?? "";
  if (!normalized) return null;
  if (normalized.includes(" short")) return "SHORT";
  if (normalized.startsWith("short ") || normalized.includes(" bearish")) return "SHORT";
  if (normalized.includes(" long")) return "LONG";
  if (normalized.startsWith("long ") || normalized.includes(" bullish")) return "LONG";
  return null;
}

function parseReactionSummary(value: unknown): { count: number; positiveBias: number } {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { count: 0, positiveBias: 0 };
  }

  const record = value as Record<string, unknown>;
  let count = 0;
  let positiveBias = 0;
  for (const [key, raw] of Object.entries(record)) {
    const numeric = typeof raw === "number" && Number.isFinite(raw) ? raw : 0;
    count += numeric;
    if (key === "bullish" || key === "fire" || key === "like") {
      positiveBias += numeric;
    }
  }

  return { count, positiveBias };
}

discoveryRouter.get("/feed-sidebar", async (c) => {
  const [topTokens, liveRaids, recentCalls, communities] = await Promise.all([
    prisma.token.findMany({
      select: {
        id: true,
        address: true,
        symbol: true,
        name: true,
        imageUrl: true,
        liquidity: true,
        volume24h: true,
        confidenceScore: true,
        highConvictionScore: true,
        hotAlphaScore: true,
        sentimentScore: true,
        updatedAt: true,
      },
      orderBy: [{ highConvictionScore: "desc" }, { confidenceScore: "desc" }, { updatedAt: "desc" }],
      take: 8,
    }),
    prisma.tokenRaidCampaign.findMany({
      where: { status: "active" },
      select: {
        id: true,
        objective: true,
        openedAt: true,
        token: {
          select: {
            address: true,
            symbol: true,
            name: true,
            imageUrl: true,
          },
        },
        participants: {
          select: { id: true },
        },
        submissions: {
          where: { xPostUrl: { not: null } },
          select: { id: true },
        },
      },
      orderBy: { openedAt: "desc" },
      take: 3,
    }),
    prisma.post.findMany({
      where: {
        OR: [
          { confidenceScore: { not: null } },
          { highConvictionScore: { not: null } },
          { hotAlphaScore: { not: null } },
        ],
      },
      select: {
        id: true,
        content: true,
        tokenSymbol: true,
        tokenName: true,
        tokenImage: true,
        contractAddress: true,
        author: {
          select: {
            username: true,
            name: true,
          },
        },
        highConvictionScore: true,
        confidenceScore: true,
        hotAlphaScore: true,
        earlyRunnerScore: true,
        roiCurrentPct: true,
        reactionCounts: true,
        threadCount: true,
        createdAt: true,
      },
      orderBy: [{ createdAt: "desc" }],
      take: 30,
    }),
    prisma.token.findMany({
      where: {
        communityProfile: { isNot: null },
      },
      select: {
        id: true,
        address: true,
        symbol: true,
        name: true,
        imageUrl: true,
        _count: {
          select: {
            followers: true,
            communityThreads: true,
            raidCampaigns: true,
          },
        },
        communityMemberStats: {
          select: {
            contributionScore: true,
          },
          orderBy: { contributionScore: "desc" },
          take: 20,
        },
      },
      take: 8,
    }),
  ]);

  const topGainers = topTokens
    .map((token) => ({
      id: token.id,
      address: token.address,
      symbol: normalizeTokenLabel(token),
      name: token.name,
      imageUrl: token.imageUrl,
      confidenceScore: token.confidenceScore,
      highConvictionScore: token.highConvictionScore,
      hotAlphaScore: token.hotAlphaScore,
      liquidity: token.liquidity,
      volume24h: token.volume24h,
    }))
    .sort(
      (a, b) =>
        toNumber(b.highConvictionScore) +
        toNumber(b.confidenceScore) +
        toNumber(b.hotAlphaScore) -
        (toNumber(a.highConvictionScore) + toNumber(a.confidenceScore) + toNumber(a.hotAlphaScore)),
    )
    .slice(0, 5);

  const trendingCalls = recentCalls
    .map((post) => {
      const reactions = parseReactionSummary(post.reactionCounts);
      const trendScore =
        toNumber(post.highConvictionScore) * 2 +
        toNumber(post.confidenceScore) * 1.4 +
        toNumber(post.hotAlphaScore) * 1.2 +
        toNumber(post.earlyRunnerScore) +
        toNumber(post.threadCount) * 8 +
        reactions.count * 3 +
        reactions.positiveBias * 2 +
        Math.max(0, toNumber(post.roiCurrentPct));

      return {
        id: post.id,
        title: post.tokenSymbol ? `$${post.tokenSymbol}` : post.tokenName ?? "Tracked call",
        tokenSymbol: post.tokenSymbol ?? post.tokenName ?? "Call",
        tokenName: post.tokenName,
        tokenImage: post.tokenImage,
        contractAddress: post.contractAddress,
        authorHandle: post.author?.username ?? post.author?.name ?? "trader",
        direction: inferSignalDirection(post.content),
        trendScore,
        conviction: post.highConvictionScore,
        confidence: post.confidenceScore,
        roiCurrentPct: post.roiCurrentPct,
      };
    })
    .sort((a, b) => b.trendScore - a.trendScore)
    .slice(0, 5);

  const trendingCommunities = communities
    .map((token) => {
      const contributionScore = token.communityMemberStats.reduce(
        (sum, item) => sum + toNumber(item.contributionScore),
        0,
      );
      return {
        id: token.id,
        tokenAddress: token.address,
        xCashtag: normalizeTokenLabel(token),
        headline: token.name,
        name: token.name,
        imageUrl: token.imageUrl,
        memberCount: token._count.followers,
        onlineCount: Math.min(
          token._count.followers,
          Math.max(token._count.raidCampaigns * 8, token._count.communityThreads * 3),
        ),
        threadCount: token._count.communityThreads,
        raidCount: token._count.raidCampaigns,
        communityScore:
          token._count.followers * 2 +
          token._count.communityThreads * 4 +
          token._count.raidCampaigns * 6 +
          contributionScore * 0.1,
      };
    })
    .sort((a, b) => b.communityScore - a.communityScore)
    .slice(0, 5);

  const aiSpotlightSource = [...topTokens].sort(
    (a, b) =>
      toNumber(b.highConvictionScore) +
      toNumber(b.confidenceScore) -
      (toNumber(a.highConvictionScore) + toNumber(a.confidenceScore)),
  )[0];

  return c.json({
    data: {
      topGainers,
      liveRaids: liveRaids.map((raid) => ({
        id: raid.id,
        objective: raid.objective,
        status: "active",
        openedAt: raid.openedAt.toISOString(),
        participantCount: raid.participants.length,
        postedCount: raid.submissions.length,
        tokenAddress: raid.token.address,
        tokenSymbol: normalizeTokenLabel(raid.token),
        tokenName: raid.token.name,
        tokenImageUrl: raid.token.imageUrl,
      })),
      trendingCalls,
      trendingCommunities,
      aiSpotlight: aiSpotlightSource
        ? {
            id: aiSpotlightSource.id,
            tokenAddress: aiSpotlightSource.address,
            ticker: normalizeTokenLabel(aiSpotlightSource),
            title: aiSpotlightSource.name,
            imageUrl: aiSpotlightSource.imageUrl,
            confidenceScore: aiSpotlightSource.confidenceScore,
            highConvictionScore: aiSpotlightSource.highConvictionScore,
            timingTier:
              toNumber(aiSpotlightSource.highConvictionScore) >= 80
                ? "High Conviction"
                : toNumber(aiSpotlightSource.confidenceScore) >= 65
                  ? "Active"
                  : "Monitoring",
            summary: `${normalizeTokenLabel(aiSpotlightSource)} is leading live conviction, confidence, and momentum signals right now.`,
          }
        : null,
    },
  });
});
