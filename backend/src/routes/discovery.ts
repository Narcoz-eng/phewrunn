import { Hono } from "hono";
import { prisma } from "../prisma.js";
import { getCachedMarketCapSnapshot } from "../services/marketcap.js";

export const discoveryRouter = new Hono();

const DISCOVERY_MARKET_MAX_AGE_MS = 90_000;
const DISCOVERY_SNAPSHOT_MAX_AGE_MS = 15 * 60_000;
const DISCOVERY_CALL_MAX_AGE_MS = 48 * 60 * 60_000;
const DISCOVERY_TRENDING_CALL_MARKET_MAX_AGE_MS = 5 * 60_000;
const DISCOVERY_WHALE_MAX_AGE_MS = 24 * 60 * 60_000;

function toNumber(value: number | null | undefined, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function nullableNumber(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function growthPct(current: number | null | undefined, previous: number | null | undefined): number | null {
  const currentValue = nullableNumber(current);
  const previousValue = nullableNumber(previous);
  if (currentValue === null || previousValue === null || previousValue <= 0) return null;
  return ((currentValue - previousValue) / previousValue) * 100;
}

function isFreshDate(value: Date | string | null | undefined, maxAgeMs: number): boolean {
  if (!value) return false;
  const ms = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isFinite(ms) && Date.now() - ms <= maxAgeMs;
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T | null> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<null>((resolve) => {
        timeout = setTimeout(() => resolve(null), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
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
  const [topTokens, liveRaids, recentCalls, communities, whaleEvents] = await Promise.all([
    prisma.token.findMany({
      select: {
        id: true,
        address: true,
        chainType: true,
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
        snapshots: {
          select: {
            capturedAt: true,
            marketCap: true,
            liquidity: true,
            volume24h: true,
          },
          orderBy: { capturedAt: "desc" },
          take: 24,
        },
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
        postType: true,
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
        entryMcap: true,
        currentMcap: true,
        lastMcapUpdate: true,
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
    prisma.tokenEvent.findMany({
      where: {
        eventType: { in: ["whale_buy", "whale_sell", "whale_transfer_in", "whale_transfer_out", "whale_accumulation", "whale_distribution"] },
        timestamp: { gte: new Date(Date.now() - DISCOVERY_WHALE_MAX_AGE_MS) },
      },
      select: {
        id: true,
        eventType: true,
        timestamp: true,
        metadata: true,
        token: {
          select: {
            address: true,
            symbol: true,
            name: true,
            imageUrl: true,
          },
        },
      },
      orderBy: { timestamp: "desc" },
      take: 8,
    }),
  ]);

  const providerSnapshots = new Map<string, Awaited<ReturnType<typeof getCachedMarketCapSnapshot>>>();
  await Promise.all(
    topTokens.slice(0, 8).map(async (token) => {
      const result = await withTimeout(getCachedMarketCapSnapshot(token.address, token.chainType), 1_600);
      if (result) providerSnapshots.set(token.id, result);
    })
  );

  const tokenRows = topTokens.map((token) => {
    const provider = providerSnapshots.get(token.id) ?? null;
    const providerFresh = provider?.fetchedAt ? isFreshDate(provider.fetchedAt, DISCOVERY_MARKET_MAX_AGE_MS) : false;
    const latestSnapshot = token.snapshots[0] ?? null;
    const snapshotFresh = isFreshDate(latestSnapshot?.capturedAt, DISCOVERY_SNAPSHOT_MAX_AGE_MS);
    const comparisonSnapshot =
      token.snapshots.find((snapshot) => Date.now() - snapshot.capturedAt.getTime() >= 20 * 60 * 60 * 1000) ??
      token.snapshots[token.snapshots.length - 1] ??
      null;
    const marketCap = providerFresh ? nullableNumber(provider?.mcap) : snapshotFresh ? nullableNumber(latestSnapshot?.marketCap) : null;
    const liquidity = providerFresh ? nullableNumber(provider?.liquidityUsd) : snapshotFresh ? nullableNumber(latestSnapshot?.liquidity) : null;
    const volume24h = providerFresh ? nullableNumber(provider?.volume24hUsd) : snapshotFresh ? nullableNumber(latestSnapshot?.volume24h) : null;
    const marketCapChange24hPct = providerFresh
      ? nullableNumber(provider?.priceChange24hPct)
      : snapshotFresh
        ? growthPct(marketCap, comparisonSnapshot?.marketCap)
        : null;
    const liquidityChange24hPct = snapshotFresh ? growthPct(liquidity, comparisonSnapshot?.liquidity) : null;
    const volumeChange24hPct = snapshotFresh ? growthPct(volume24h, comparisonSnapshot?.volume24h) : null;
    const change24hPct =
      marketCapChange24hPct ??
      liquidityChange24hPct ??
      volumeChange24hPct ??
      null;

    return {
      token,
      marketCap,
      liquidity,
      volume24h,
      change24hPct,
      marketCapChange24hPct,
      liquidityChange24hPct,
      volumeChange24hPct,
      source: providerFresh ? provider?.source ?? "dexscreener" : snapshotFresh ? "token-snapshot" : "unavailable",
      fetchedAt: providerFresh ? provider?.fetchedAt ?? null : snapshotFresh ? latestSnapshot?.capturedAt.toISOString() ?? null : null,
      maxAgeMs: providerFresh ? DISCOVERY_MARKET_MAX_AGE_MS : snapshotFresh ? DISCOVERY_SNAPSHOT_MAX_AGE_MS : null,
    };
  });

  const aggregateMarketCap = tokenRows.reduce((sum, row) => sum + toNumber(row.marketCap), 0);
  const aggregateVolume24h = tokenRows.reduce((sum, row) => sum + toNumber(row.volume24h), 0);
  const freshMarketRows = tokenRows.filter((row) => row.fetchedAt && row.source !== "unavailable" && isFreshDate(row.fetchedAt, row.maxAgeMs ?? 0));
  const marketStatsAsOf = freshMarketRows
    .map((row) => row.fetchedAt)
    .filter((value): value is string => Boolean(value))
    .sort()
    .at(0) ?? null;
  const marketStats = {
    marketCap: aggregateMarketCap > 0 ? aggregateMarketCap : null,
    volume24h: aggregateVolume24h > 0 ? aggregateVolume24h : null,
    btcDominance: null,
    marketCapChangePct: null,
    volume24hChangePct: null,
    btcDominanceChangePct: null,
    coverage: {
      marketCap: aggregateMarketCap > 0 ? "tracked_tokens" : "unavailable",
      volume24h: aggregateVolume24h > 0 ? "tracked_tokens" : "unavailable",
      btcDominance: "unavailable",
      unavailableReason:
        aggregateMarketCap > 0 || aggregateVolume24h > 0
          ? "BTC dominance requires a global market data provider and is intentionally not inferred from tracked tokens."
          : "No tracked token market snapshots are currently available.",
    },
    source: freshMarketRows.some((row) => row.source === "dexscreener") ? "dexscreener-tracked-tokens" : freshMarketRows.length ? "token-snapshot" : "unavailable",
    asOf: marketStatsAsOf,
    maxAgeMs: freshMarketRows.some((row) => row.source === "dexscreener") ? DISCOVERY_MARKET_MAX_AGE_MS : DISCOVERY_SNAPSHOT_MAX_AGE_MS,
  };

  const topGainers = topTokens
    .map((token) => {
      const row = tokenRows.find((item) => item.token.id === token.id);
      return {
        id: token.id,
        address: token.address,
        symbol: normalizeTokenLabel(token),
        name: token.name,
        imageUrl: token.imageUrl,
        confidenceScore: token.confidenceScore,
        highConvictionScore: token.highConvictionScore,
        hotAlphaScore: token.hotAlphaScore,
        liquidity: row?.liquidity ?? token.liquidity,
        volume24h: row?.volume24h ?? token.volume24h,
        marketCap: row?.marketCap ?? null,
        change24hPct: row?.change24hPct ?? null,
        changeSource: row && row.change24hPct !== null ? row.source : "unavailable",
        fetchedAt: row?.fetchedAt ?? null,
        maxAgeMs: row?.maxAgeMs ?? null,
      };
    })
    .filter((item) => {
      const hasRealChange =
        typeof item.change24hPct === "number" &&
        Number.isFinite(item.change24hPct) &&
        Math.abs(item.change24hPct) >= 0.01 &&
        item.changeSource !== "unavailable" &&
        isFreshDate(item.fetchedAt, item.maxAgeMs ?? 0);
      const hasMarketBasis =
        (typeof item.marketCap === "number" && Number.isFinite(item.marketCap) && item.marketCap > 0) ||
        (typeof item.liquidity === "number" && Number.isFinite(item.liquidity) && item.liquidity > 0) ||
        (typeof item.volume24h === "number" && Number.isFinite(item.volume24h) && item.volume24h > 0);
      return hasRealChange && hasMarketBasis;
    })
    .sort(
      (a, b) =>
        toNumber(b.change24hPct) +
        toNumber(b.highConvictionScore) * 0.35 +
        toNumber(b.confidenceScore) * 0.2 -
        (toNumber(a.change24hPct) + toNumber(a.highConvictionScore) * 0.35 + toNumber(a.confidenceScore) * 0.2),
    )
    .slice(0, 5);

  const trendingCalls = recentCalls
    .map((post) => {
      const reactions = parseReactionSummary(post.reactionCounts);
      const postAgeMs = Date.now() - post.createdAt.getTime();
      const marketFresh = isFreshDate(post.lastMcapUpdate, DISCOVERY_TRENDING_CALL_MARKET_MAX_AGE_MS);
      const liveMove =
        marketFresh &&
        typeof post.currentMcap === "number" &&
        Number.isFinite(post.currentMcap) &&
        typeof post.entryMcap === "number" &&
        Number.isFinite(post.entryMcap) &&
        post.entryMcap > 0
          ? ((post.currentMcap - post.entryMcap) / post.entryMcap) * 100
          : null;
      const trendScore =
        toNumber(post.highConvictionScore) * 2 +
        toNumber(post.confidenceScore) * 1.4 +
        toNumber(post.hotAlphaScore) * 1.2 +
        toNumber(post.earlyRunnerScore) +
        toNumber(post.threadCount) * 8 +
        reactions.count * 3 +
        reactions.positiveBias * 2 +
        Math.max(0, toNumber(liveMove)) -
        Math.max(0, (postAgeMs - 12 * 60 * 60_000) / (60 * 60_000)) * 2.5;

      return {
        id: post.id,
        postType: post.postType ?? (post.contractAddress ? "alpha" : "discussion"),
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
        roiCurrentPct: liveMove,
        asOf: marketFresh ? post.lastMcapUpdate?.toISOString() ?? null : null,
        source: marketFresh ? "post-market-tracker" : "unavailable",
        scoreReason:
          liveMove !== null && liveMove > 0
            ? "Fresh market performance"
            : post.highConvictionScore !== null
              ? "Fresh conviction signal"
              : "Recent engagement",
        staleReason: marketFresh ? null : "Current market data is stale for trending calls.",
        createdAt: post.createdAt.toISOString(),
      };
    })
    .filter((item) => {
      const hasTokenContext = Boolean(item.contractAddress || item.tokenSymbol || item.tokenName);
      const isRecent = Date.now() - new Date(item.createdAt).getTime() <= DISCOVERY_CALL_MAX_AGE_MS;
      const hasCurrentMarket = item.source !== "unavailable" && isFreshDate(item.asOf, DISCOVERY_TRENDING_CALL_MARKET_MAX_AGE_MS);
      const hasPerformance =
        (typeof item.roiCurrentPct === "number" && Number.isFinite(item.roiCurrentPct) && Math.abs(item.roiCurrentPct) >= 0.1) ||
        (typeof item.conviction === "number" && Number.isFinite(item.conviction) && item.conviction >= 40) ||
        (typeof item.confidence === "number" && Number.isFinite(item.confidence) && item.confidence >= 40);
      return isRecent && hasCurrentMarket && hasTokenContext && item.trendScore >= 20 && hasPerformance;
    })
    .sort((a, b) => b.trendScore - a.trendScore)
    .filter((item, index, rows) => {
      const key = item.contractAddress?.toLowerCase() || item.tokenSymbol?.toLowerCase() || item.id;
      return rows.findIndex((row) => (row.contractAddress?.toLowerCase() || row.tokenSymbol?.toLowerCase() || row.id) === key) === index;
    })
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

  const aiSpotlightSource = [...topTokens]
    .filter((token) => {
      const row = tokenRows.find((item) => item.token.id === token.id);
      return Boolean(row?.fetchedAt && row.source !== "unavailable" && isFreshDate(row.fetchedAt, row.maxAgeMs ?? 0));
    })
    .sort(
      (a, b) =>
        toNumber(b.highConvictionScore) +
        toNumber(b.confidenceScore) -
        (toNumber(a.highConvictionScore) + toNumber(a.confidenceScore)),
    )[0];

  const whaleActivity = whaleEvents
    .map((event) => {
      const metadata = event.metadata && typeof event.metadata === "object" && !Array.isArray(event.metadata)
        ? event.metadata as Record<string, unknown>
        : {};
      return {
        id: event.id,
        tokenSymbol: normalizeTokenLabel(event.token),
        tokenImage: event.token.imageUrl,
        action: String(metadata.direction ?? event.eventType.replace(/^whale_/, "").replaceAll("_", " ")),
        amount: typeof metadata.amount === "string" ? metadata.amount : metadata.amount === null || metadata.amount === undefined ? null : String(metadata.amount),
        valueUsd: nullableNumber(metadata.valueUsd as number | null | undefined),
        explorerUrl: typeof metadata.explorerUrl === "string" ? metadata.explorerUrl : null,
        createdAt: event.timestamp.toISOString(),
        source: typeof metadata.source === "string" ? metadata.source : "token-event",
        asOf: event.timestamp.toISOString(),
        coverage: "live",
      };
    })
    .filter((event) => isFreshDate(event.asOf, DISCOVERY_WHALE_MAX_AGE_MS));

  return c.json({
    data: {
      marketStats,
      topGainers,
      liveRaids: liveRaids
        .filter((raid) => raid.participants.length > 0 || raid.submissions.length > 0)
        .map((raid) => ({
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
      whaleActivity,
    },
  });
});
