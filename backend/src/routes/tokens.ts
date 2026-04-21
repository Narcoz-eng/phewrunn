import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { type AuthVariables, requireAuth, requireNotBanned } from "../auth.js";
import { cacheGetJson, cacheSetJson, redisDelete } from "../lib/redis.js";
import { isPrismaPoolPressureActive, isTransientPrismaError, prisma } from "../prisma.js";
import { getCachedMarketCapSnapshot } from "../services/marketcap.js";
import {
  analyzeSolanaTokenDistribution,
  peekCachedSolanaTokenDistribution,
} from "../services/intelligence/token-metrics.js";
import {
  findTokenByAddress,
  getTokenOverviewByAddress,
  invalidateViewerSocialCaches,
} from "../services/intelligence/engine.js";
import { loadTokenSocialSignals } from "../services/token-social-signals.js";
import {
  computeStateAwareIntelligenceScores,
  computeConfidenceScore,
  computeEarlyRunnerScore,
  computeHighConvictionScore,
  computeHotAlphaScore,
  computeSentimentScore,
  computeTokenRiskScore,
  computeWeightedEngagementPerHour,
  determineBundleRiskLabel,
  type ReactionCounts,
} from "../services/intelligence/scoring.js";

export const tokensRouter = new Hono<{ Variables: AuthVariables }>();

type TokenRoutePayload = NonNullable<Awaited<ReturnType<typeof getTokenOverviewByAddress>>>["token"];
type TokenRouteCacheEntry<T> = {
  data: T;
  expiresAtMs: number;
  staleUntilMs: number;
};
type TokenLivePayload = {
  marketCap: number | null;
  liquidity: number | null;
  volume24h: number | null;
  holderCount: number | null;
  holderCountSource: TokenRoutePayload["holderCountSource"];
  largestHolderPct: number | null;
  top10HolderPct: number | null;
  deployerSupplyPct: number | null;
  bundledWalletCount: number | null;
  estimatedBundledSupplyPct: number | null;
  bundleRiskLabel: string | null;
  tokenRiskScore: number | null;
  topHolders: TokenRoutePayload["topHolders"];
  devWallet: TokenRoutePayload["devWallet"];
  bundleClusters: TokenRoutePayload["bundleClusters"];
  dexscreenerUrl: string | null;
  pairAddress: string | null;
  dexId: string | null;
  imageUrl: string | null;
  symbol: string | null;
  name: string | null;
  sentimentScore: number | null;
  confidenceScore: number | null;
  hotAlphaScore: number | null;
  earlyRunnerScore: number | null;
  highConvictionScore: number | null;
  marketHealthScore: number | null;
  setupQualityScore: number | null;
  opportunityScore: number | null;
  dataReliabilityScore: number | null;
  activityStatus: string | null;
  activityStatusLabel: string | null;
  isTradable: boolean;
  bullishSignalsSuppressed: boolean;
  sentiment: TokenRoutePayload["sentiment"];
  lastIntelligenceAt: string | null;
  priceUsd: number | null;
  priceChange24hPct: number | null;
  buys24h: number | null;
  sells24h: number | null;
  bundleScanCompletedAt: string | null;
  updatedAt: string;
};

const TOKEN_ROUTE_CACHE_TTL_MS = process.env.NODE_ENV === "production" ? 2 * 60_000 : 30_000;
const TOKEN_ROUTE_STALE_FALLBACK_MS = process.env.NODE_ENV === "production" ? 30 * 60_000 : 5 * 60_000;
const TOKEN_LIVE_ROUTE_RESOLVED_CACHE_TTL_MS = process.env.NODE_ENV === "production" ? 5_000 : 1_500;
const TOKEN_LIVE_ROUTE_PENDING_CACHE_TTL_MS = process.env.NODE_ENV === "production" ? 2_500 : 750;
const TOKEN_ROUTE_CACHE_VERSION = 28;
const TOKEN_CHART_ROUTE_CACHE_TTL_MS = process.env.NODE_ENV === "production" ? 45_000 : 8_000;
const TOKEN_CHART_ROUTE_STALE_FALLBACK_MS = process.env.NODE_ENV === "production" ? 15 * 60_000 : 3 * 60_000;
const TOKEN_CHART_ROUTE_MAX_POINTS = process.env.NODE_ENV === "production" ? 720 : 240;
const TRUSTED_TRADER_THRESHOLD = 58;
const tokenRouteCache = new Map<string, TokenRouteCacheEntry<TokenRoutePayload>>();
const tokenLiveRouteCache = new Map<string, TokenRouteCacheEntry<TokenLivePayload>>();
const tokenChartRouteCache = new Map<string, TokenRouteCacheEntry<TokenRoutePayload["chart"]>>();
const tokenLiveRouteInFlight = new Map<string, Promise<TokenLivePayload>>();
const TokenAddressParamSchema = z.object({
  tokenAddress: z.string().trim().min(1),
});
const TokenLiveQuerySchema = z.object({
  fresh: z.string().optional(),
});
const SOLANA_ADDRESS_REGEX = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const EVM_ADDRESS_REGEX = /^0x[a-fA-F0-9]{40}$/;

function buildTokenRouteCacheKey(tokenAddress: string, viewerId: string | null): string {
  return `route:token:v${TOKEN_ROUTE_CACHE_VERSION}:${viewerId ?? "anonymous"}:${tokenAddress.trim().toLowerCase()}`;
}

function buildTokenLiveRouteCacheKey(tokenAddress: string, options?: { fresh?: boolean }): string {
  return `route:token-live:${options?.fresh ? "fresh" : "default"}:${tokenAddress.trim().toLowerCase()}`;
}

function buildTokenChartRouteCacheKey(tokenAddress: string): string {
  return `route:token-chart:${tokenAddress.trim().toLowerCase()}`;
}

function readTokenRouteCache(key: string, opts?: { allowStale?: boolean }): TokenRoutePayload | null {
  const cached = tokenRouteCache.get(key);
  if (!cached) return null;
  const now = Date.now();
  if (cached.expiresAtMs > now) {
    return cached.data;
  }
  if (opts?.allowStale && cached.staleUntilMs > now) {
    return cached.data;
  }
  if (cached.staleUntilMs <= now) {
    tokenRouteCache.delete(key);
  }
  return null;
}

function readTokenLiveRouteCache(key: string): TokenLivePayload | null {
  const cached = tokenLiveRouteCache.get(key);
  if (!cached) return null;
  if (cached.expiresAtMs <= Date.now()) {
    tokenLiveRouteCache.delete(key);
    return null;
  }
  return cached.data;
}

function readTokenChartRouteCache(
  key: string,
  opts?: { allowStale?: boolean }
): TokenRoutePayload["chart"] | null {
  const cached = tokenChartRouteCache.get(key);
  if (!cached) return null;
  const now = Date.now();
  if (cached.expiresAtMs > now) {
    return cached.data;
  }
  if (opts?.allowStale && cached.staleUntilMs > now) {
    return cached.data;
  }
  if (cached.staleUntilMs <= now) {
    tokenChartRouteCache.delete(key);
  }
  return null;
}

function hasResolvedLiveTokenPayload(payload: TokenLivePayload): boolean {
  return Boolean(
    payload.bundleScanCompletedAt &&
      payload.topHolders.length > 0 &&
      hasResolvedHolderCount(payload.holderCount, payload.holderCountSource) &&
      hasResolvedHolderRoleIntelligence(payload.topHolders, payload.devWallet)
  );
}

function writeTokenRouteCache(key: string, data: TokenRoutePayload): void {
  const now = Date.now();
  tokenRouteCache.set(key, {
    data,
    expiresAtMs: now + TOKEN_ROUTE_CACHE_TTL_MS,
    staleUntilMs: now + TOKEN_ROUTE_STALE_FALLBACK_MS,
  });
}

async function readBestEffortTokenRouteCache(
  key: string,
  opts?: { allowStale?: boolean }
): Promise<TokenRoutePayload | null> {
  const local = readTokenRouteCache(key, opts);
  if (local) {
    return local;
  }

  const redisRaw = await cacheGetJson<unknown>(key);
  const envelope =
    redisRaw &&
    typeof redisRaw === "object" &&
    !Array.isArray(redisRaw) &&
    "data" in redisRaw
      ? (redisRaw as { data?: TokenRoutePayload; cachedAt?: unknown })
      : null;
  const redisCached = envelope?.data ?? (redisRaw as TokenRoutePayload | null);
  const cachedAtMs =
    envelope && typeof envelope.cachedAt === "number" && Number.isFinite(envelope.cachedAt)
      ? envelope.cachedAt
      : Date.now() - TOKEN_ROUTE_CACHE_TTL_MS;
  if (redisCached) {
    if (!opts?.allowStale && Date.now() - cachedAtMs > TOKEN_ROUTE_CACHE_TTL_MS) {
      return null;
    }
    writeTokenRouteCache(key, redisCached);
    return redisCached;
  }

  return null;
}

function writeBestEffortTokenRouteCache(key: string, data: TokenRoutePayload): void {
  writeTokenRouteCache(key, data);
  void cacheSetJson(
    key,
    {
      data,
      cachedAt: Date.now(),
    },
    TOKEN_ROUTE_STALE_FALLBACK_MS
  );
}

function invalidateTokenRouteCache(tokenAddress: string): void {
  const anonymousKey = buildTokenRouteCacheKey(tokenAddress, null);
  tokenRouteCache.delete(anonymousKey);
  void redisDelete(anonymousKey);
}

function stripViewerStateFromRecentCalls(
  recentCalls: TokenRoutePayload["recentCalls"]
): TokenRoutePayload["recentCalls"] {
  return recentCalls.map((call) => ({
    ...call,
    isLiked: false,
    isReposted: false,
    isFollowingAuthor: false,
    currentReactionType: null,
  }));
}

function toSharedTokenRoutePayload(data: TokenRoutePayload): TokenRoutePayload {
  return {
    ...data,
    isFollowing: false,
    recentCalls: stripViewerStateFromRecentCalls(data.recentCalls),
  };
}

function isMeaningfulTokenRoutePayload(token: TokenRoutePayload): boolean {
  const hasHolderTelemetry =
    token.chainType !== "solana" ||
    token.topHolders.length > 0 ||
    (typeof token.holderCount === "number" &&
      Number.isFinite(token.holderCount) &&
      token.holderCount > 0);
  const hasSignals = [
    token.confidenceScore,
    token.hotAlphaScore,
    token.earlyRunnerScore,
    token.highConvictionScore,
  ].some((value) => typeof value === "number" && Number.isFinite(value));
  const hasMarketData = [token.liquidity, token.volume24h, token.holderCount].some(
    (value) => typeof value === "number" && Number.isFinite(value) && value > 0
  );
  const hasChart = token.chart.some((point) =>
    [point.marketCap, point.liquidity, point.volume24h, point.holderCount].some(
      (value) => typeof value === "number" && Number.isFinite(value) && value > 0
    )
  );

  return (
    hasHolderTelemetry &&
    (hasSignals || hasMarketData || hasChart || token.recentCalls.length > 0 || token.timeline.length > 0)
  );
}

function buildTokenRouteHeaders(isPersonalized: boolean): Record<string, string> {
  return {
    "cache-control": isPersonalized
      ? "private, no-store"
      : process.env.NODE_ENV === "production"
        ? "public, max-age=20, s-maxage=45, stale-while-revalidate=240"
        : "no-store",
  };
}

function buildLiveTokenRouteHeaders(): Record<string, string> {
  return {
    "cache-control":
      process.env.NODE_ENV === "production"
        ? "public, max-age=4, s-maxage=5, stale-while-revalidate=12"
        : "no-store",
  };
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function roundMetric(value: number | null | undefined): number | null {
  if (!isFiniteNumber(value)) return null;
  return Math.round(value * 100) / 100;
}

function roundCount(value: number | null | undefined): number | null {
  if (!isFiniteNumber(value)) return null;
  return Math.round(value);
}

function toTimestampMs(value: Date | string | null | undefined): number {
  if (value instanceof Date) {
    const timestamp = value.getTime();
    return Number.isFinite(timestamp) ? timestamp : 0;
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function toIsoTimestamp(value: Date | string | null | undefined): string | null {
  const timestamp = toTimestampMs(value);
  return timestamp > 0 ? new Date(timestamp).toISOString() : null;
}

function finiteMetric(value: number | null | undefined, fallback = 0): number {
  return isFiniteNumber(value) ? value : fallback;
}

function growthPct(current: number | null | undefined, previous: number | null | undefined): number {
  const currentValue = finiteMetric(current);
  const previousValue = finiteMetric(previous);
  if (currentValue <= 0 || previousValue <= 0) return 0;
  return ((currentValue - previousValue) / previousValue) * 100;
}

function deriveRoiPct(entryMcap: number | null | undefined, targetMcap: number | null | undefined): number | null {
  const entryValue = finiteMetric(entryMcap);
  const targetValue = finiteMetric(targetMcap);
  if (entryValue <= 0 || targetValue <= 0) return null;
  return ((targetValue - entryValue) / entryValue) * 100;
}

function averageFiniteMetric(values: Array<number | null | undefined>): number | null {
  const finiteValues = values.filter((value): value is number => isFiniteNumber(value));
  if (finiteValues.length === 0) {
    return null;
  }

  return finiteValues.reduce((sum, value) => sum + value, 0) / finiteValues.length;
}

function hasChartPointTelemetry(
  point: Partial<TokenRoutePayload["chart"][number]> | null | undefined
): boolean {
  if (!point) return false;
  return [point.marketCap, point.liquidity, point.volume24h, point.holderCount].some(
    (value) => typeof value === "number" && Number.isFinite(value) && value > 0
  );
}

function dedupeAndNormalizeChartPoints(
  points: TokenRoutePayload["chart"]
): TokenRoutePayload["chart"] {
  const pointsByTimestamp = new Map<string, TokenRoutePayload["chart"][number]>();
  for (const point of points) {
    if (!point?.timestamp) continue;
    const existing = pointsByTimestamp.get(point.timestamp);
    if (!existing) {
      pointsByTimestamp.set(point.timestamp, point);
      continue;
    }

    pointsByTimestamp.set(point.timestamp, {
      timestamp: point.timestamp,
      marketCap: pickFirstPositiveMetric(point.marketCap, existing.marketCap),
      liquidity: pickFirstPositiveMetric(point.liquidity, existing.liquidity),
      volume24h: pickFirstPositiveMetric(point.volume24h, existing.volume24h),
      holderCount: pickFirstPositiveMetric(point.holderCount, existing.holderCount),
      sentimentScore: pickFirstFiniteMetric(point.sentimentScore, existing.sentimentScore),
      confidenceScore: pickFirstFiniteMetric(point.confidenceScore, existing.confidenceScore),
    });
  }

  return Array.from(pointsByTimestamp.values()).sort(
    (left, right) => toTimestampMs(left.timestamp) - toTimestampMs(right.timestamp)
  );
}

function compressChartPoints(
  points: TokenRoutePayload["chart"],
  maxPoints: number
): TokenRoutePayload["chart"] {
  const normalized = dedupeAndNormalizeChartPoints(points).filter((point) => hasChartPointTelemetry(point));
  if (normalized.length <= maxPoints) {
    return normalized;
  }

  const result: TokenRoutePayload["chart"] = [];
  const lastIndex = normalized.length - 1;
  const interiorTargetCount = Math.max(0, maxPoints - 2);
  result.push(normalized[0]!);

  for (let slot = 1; slot <= interiorTargetCount; slot += 1) {
    const ratio = slot / (interiorTargetCount + 1);
    const index = Math.max(1, Math.min(lastIndex - 1, Math.round(ratio * lastIndex)));
    const point = normalized[index];
    if (!point) continue;
    const previous = result[result.length - 1];
    if (previous?.timestamp === point.timestamp) continue;
    result.push(point);
  }

  const lastPoint = normalized[lastIndex];
  if (lastPoint && result[result.length - 1]?.timestamp !== lastPoint.timestamp) {
    result.push(lastPoint);
  }

  return result;
}

async function loadTokenChartHistory(
  tokenAddress: string
): Promise<TokenRoutePayload["chart"] | null> {
  const cacheKey = buildTokenChartRouteCacheKey(tokenAddress);
  const cached = readTokenChartRouteCache(cacheKey);
  if (cached) {
    return cached;
  }
  const staleCached = readTokenChartRouteCache(cacheKey, { allowStale: true });

  const token = await findTokenByAddress(tokenAddress);
  if (!token) {
    return null;
  }

  try {
    const [snapshots, liveMarketSnapshot] = await Promise.all([
      prisma.tokenMetricSnapshot.findMany({
        where: { tokenId: token.id },
        select: {
          capturedAt: true,
          marketCap: true,
          liquidity: true,
          volume24h: true,
          holderCount: true,
          sentimentScore: true,
          confidenceScore: true,
        },
        orderBy: { capturedAt: "asc" },
      }),
      getCachedMarketCapSnapshot(token.address, token.chainType).catch(() => null),
    ]);

    const historyPoints: TokenRoutePayload["chart"] = snapshots.map((snapshot) => ({
      timestamp: snapshot.capturedAt.toISOString(),
      marketCap: roundMetric(snapshot.marketCap),
      liquidity: roundMetric(snapshot.liquidity),
      volume24h: roundMetric(snapshot.volume24h),
      holderCount: roundCount(snapshot.holderCount),
      sentimentScore: roundMetric(snapshot.sentimentScore),
      confidenceScore: roundMetric(snapshot.confidenceScore),
    }));

    const currentTimestamp = toIsoTimestamp(token.lastIntelligenceAt ?? token.updatedAt) ?? new Date().toISOString();
    const currentPoint: TokenRoutePayload["chart"][number] = {
      timestamp: currentTimestamp,
      marketCap: roundMetric(pickFirstPositiveMetric(liveMarketSnapshot?.mcap)),
      liquidity: roundMetric(pickFirstPositiveMetric(liveMarketSnapshot?.liquidityUsd, token.liquidity)),
      volume24h: roundMetric(pickFirstPositiveMetric(liveMarketSnapshot?.volume24hUsd, token.volume24h)),
      holderCount: roundCount(pickFirstPositiveMetric(token.holderCount)),
      sentimentScore: roundMetric(token.sentimentScore),
      confidenceScore: roundMetric(token.confidenceScore),
    };

    const merged = hasChartPointTelemetry(currentPoint)
      ? [...historyPoints, currentPoint]
      : historyPoints;
    const chart = compressChartPoints(merged, TOKEN_CHART_ROUTE_MAX_POINTS);

    tokenChartRouteCache.set(cacheKey, {
      data: chart,
      expiresAtMs: Date.now() + TOKEN_CHART_ROUTE_CACHE_TTL_MS,
      staleUntilMs: Date.now() + TOKEN_CHART_ROUTE_STALE_FALLBACK_MS,
    });

    return chart;
  } catch (error) {
    if (staleCached) {
      console.warn("[tokens/chart] serving stale chart history", {
        tokenAddress,
        message: error instanceof Error ? error.message : String(error),
      });
      return staleCached;
    }
    throw error;
  }
}

function emptyReactionCounts(): ReactionCounts {
  return {
    alpha: 0,
    based: 0,
    printed: 0,
    rug: 0,
  };
}

function parseReactionCounts(value: unknown): ReactionCounts {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return emptyReactionCounts();
  }

  const candidate = value as Partial<Record<keyof ReactionCounts, unknown>>;
  return {
    alpha: isFiniteNumber(candidate.alpha as number) && Number(candidate.alpha) > 0 ? Math.round(Number(candidate.alpha)) : 0,
    based: isFiniteNumber(candidate.based as number) && Number(candidate.based) > 0 ? Math.round(Number(candidate.based)) : 0,
    printed: isFiniteNumber(candidate.printed as number) && Number(candidate.printed) > 0 ? Math.round(Number(candidate.printed)) : 0,
    rug: isFiniteNumber(candidate.rug as number) && Number(candidate.rug) > 0 ? Math.round(Number(candidate.rug)) : 0,
  };
}

function sumReactionCounts(left: ReactionCounts, right: ReactionCounts): ReactionCounts {
  return {
    alpha: left.alpha + right.alpha,
    based: left.based + right.based,
    printed: left.printed + right.printed,
    rug: left.rug + right.rug,
  };
}

function getFreshestMetricTimestamp(value: {
  lastMcapUpdate?: Date | string | null;
  lastIntelligenceAt?: Date | string | null;
  createdAt?: Date | string | null;
}): number {
  return Math.max(
    toTimestampMs(value.lastMcapUpdate),
    toTimestampMs(value.lastIntelligenceAt),
    toTimestampMs(value.createdAt)
  );
}

function pickFreshestPostCurrentMcap(
  posts: Array<{
    currentMcap: number | null;
    lastMcapUpdate?: Date | string | null;
    lastIntelligenceAt?: Date | string | null;
    createdAt?: Date | string | null;
  }>
): number | null {
  let bestValue: number | null = null;
  let bestTimestamp = 0;

  for (const post of posts) {
    if (!isFiniteNumber(post.currentMcap) || post.currentMcap <= 0) {
      continue;
    }

    const timestamp = getFreshestMetricTimestamp(post);
    if (bestValue === null || timestamp >= bestTimestamp) {
      bestValue = post.currentMcap;
      bestTimestamp = timestamp;
    }
  }

  return bestValue;
}

function computeDexSentimentTrendAdjustment(args: {
  priceChange24hPct: number | null | undefined;
  buys24h: number | null | undefined;
  sells24h: number | null | undefined;
}): number {
  const priceChangePct = finiteMetric(args.priceChange24hPct);
  const buys24h = Math.max(0, finiteMetric(args.buys24h));
  const sells24h = Math.max(0, finiteMetric(args.sells24h));
  const totalTrades = buys24h + sells24h;
  const orderFlowImbalancePct = totalTrades > 0 ? ((buys24h - sells24h) / totalTrades) * 100 : 0;
  const priceAdjustment = Math.max(-14, Math.min(14, priceChangePct / 3));
  const flowAdjustment = Math.max(-10, Math.min(10, orderFlowImbalancePct / 5));
  const activityAdjustment = totalTrades >= 40 ? Math.min(4, totalTrades / 50) : 0;

  if (!isFiniteNumber(args.priceChange24hPct) && totalTrades === 0) {
    return 0;
  }

  return priceAdjustment + flowAdjustment + activityAdjustment;
}

function hasResolvedHolderCount(
  value: number | null | undefined,
  source: TokenRoutePayload["holderCountSource"] | TokenLivePayload["holderCountSource"]
): value is number {
  return (
    isFiniteNumber(value) &&
    value > 0 &&
    source !== "largest_accounts" &&
    source !== null &&
    !(
      (source === "stored" || source === "helius" || source === "rpc_scan" || source === "birdeye") &&
      Math.round(value) === 1000
    )
  );
}

function looksLikeLowerBoundStoredHolderCount(args: {
  chainType: string;
  storedHolderCount: number | null | undefined;
  observedTopHolderCount: number;
  liveHolderCount: number | null | undefined;
  liveHolderCountSource: TokenRoutePayload["holderCountSource"] | TokenLivePayload["holderCountSource"];
}): boolean {
  if (args.chainType !== "solana" || !isFiniteNumber(args.storedHolderCount) || args.storedHolderCount <= 0) {
    return false;
  }
  if (hasResolvedHolderCount(args.liveHolderCount, args.liveHolderCountSource)) {
    return false;
  }

  const normalizedStoredCount = Math.round(args.storedHolderCount);
  if (normalizedStoredCount === 1000) {
    return true;
  }
  if (args.observedTopHolderCount >= 20) {
    return normalizedStoredCount <= args.observedTopHolderCount;
  }

  return args.observedTopHolderCount >= 10 && normalizedStoredCount <= 20;
}

function pickFirstPositiveMetric(...values: Array<number | null | undefined>): number | null {
  for (const value of values) {
    if (isFiniteNumber(value) && value > 0) {
      return value;
    }
  }

  return null;
}

function pickFirstFiniteMetric(...values: Array<number | null | undefined>): number | null {
  for (const value of values) {
    if (isFiniteNumber(value)) {
      return value;
    }
  }

  return null;
}

function deriveBundledSupplyPctFromClusters(
  clusters: Array<{ estimatedSupplyPct: number }> | null | undefined
): number | null {
  if (!Array.isArray(clusters) || clusters.length === 0) {
    return null;
  }

  const total = clusters.reduce((sum, cluster) => {
    return sum + (isFiniteNumber(cluster.estimatedSupplyPct) && cluster.estimatedSupplyPct > 0 ? cluster.estimatedSupplyPct : 0);
  }, 0);

  return total > 0 ? roundMetric(total) : null;
}

function resolveBundledSupplyPct(
  value: number | null | undefined,
  clusters: Array<{ estimatedSupplyPct: number }> | null | undefined
): number | null {
  const roundedValue = roundMetric(value);
  const derivedFromClusters = deriveBundledSupplyPctFromClusters(clusters);

  if (derivedFromClusters !== null) {
    return derivedFromClusters;
  }

  return roundedValue;
}

function inferTokenChainType(tokenAddress: string): "solana" | "evm" | null {
  const normalized = tokenAddress.trim();
  if (SOLANA_ADDRESS_REGEX.test(normalized)) {
    return "solana";
  }
  if (EVM_ADDRESS_REGEX.test(normalized)) {
    return "evm";
  }
  return null;
}

function hasUsefulLiveTokenPayload(payload: TokenLivePayload): boolean {
  return (
    payload.marketCap !== null ||
    payload.liquidity !== null ||
    payload.volume24h !== null ||
    payload.sentimentScore !== null ||
    payload.confidenceScore !== null ||
    payload.hotAlphaScore !== null ||
    payload.earlyRunnerScore !== null ||
    payload.highConvictionScore !== null ||
    payload.priceUsd !== null ||
    payload.symbol !== null ||
    payload.name !== null ||
    payload.dexscreenerUrl !== null ||
    payload.topHolders.length > 0 ||
    payload.devWallet !== null ||
    payload.holderCount !== null
  );
}

type TokenLookupPayload = NonNullable<Awaited<ReturnType<typeof findTokenByAddress>>>;

function hasStoredSolanaDistributionTelemetry(token: TokenLookupPayload | null | undefined): boolean {
  if (!token || token.chainType !== "solana") {
    return false;
  }

  const normalizedBundleRiskLabel = token.bundleRiskLabel?.trim().toLowerCase() ?? "";
  return (
    (isFiniteNumber(token.holderCount) && token.holderCount > 0) ||
    isFiniteNumber(token.largestHolderPct) ||
    isFiniteNumber(token.top10HolderPct) ||
    isFiniteNumber(token.deployerSupplyPct) ||
    (isFiniteNumber(token.bundledWalletCount) && token.bundledWalletCount > 0) ||
    (isFiniteNumber(token.estimatedBundledSupplyPct) && token.estimatedBundledSupplyPct > 0) ||
    isFiniteNumber(token.tokenRiskScore) ||
    (normalizedBundleRiskLabel.length > 0 &&
      normalizedBundleRiskLabel !== "clean" &&
      normalizedBundleRiskLabel !== "unknown")
  );
}

function hasResolvedSolanaDistributionSnapshot(
  snapshot: Awaited<ReturnType<typeof peekCachedSolanaTokenDistribution>>
): boolean {
  if (!snapshot) {
    return false;
  }

  return (
    snapshot.topHolders.length > 0 ||
    snapshot.devWallet !== null ||
    hasResolvedHolderCount(snapshot.holderCount, snapshot.holderCountSource) ||
    isFiniteNumber(snapshot.largestHolderPct) ||
    isFiniteNumber(snapshot.top10HolderPct) ||
    isFiniteNumber(snapshot.deployerSupplyPct) ||
    (isFiniteNumber(snapshot.bundledWalletCount) && snapshot.bundledWalletCount > 0) ||
    (isFiniteNumber(snapshot.estimatedBundledSupplyPct) && snapshot.estimatedBundledSupplyPct > 0) ||
    snapshot.clusters.length > 0
  );
}

function hasResolvedHolderRoleFields(
  holder:
    | Pick<TokenRoutePayload["topHolders"][number], "badges" | "devRole" | "activeAgeDays" | "fundedBy" | "tradeVolume90dSol" | "solBalance" | "label">
    | null
    | undefined
): boolean {
  if (!holder) {
    return false;
  }

  return Boolean(
    holder.badges.length > 0 ||
      holder.activeAgeDays !== null ||
      holder.fundedBy !== null ||
      holder.tradeVolume90dSol !== null ||
      holder.solBalance !== null ||
      (typeof holder.label === "string" && holder.label.trim().length > 0)
  );
}

function hasResolvedHolderRoleIntelligence(
  topHolders: TokenRoutePayload["topHolders"] | TokenLivePayload["topHolders"] | null | undefined,
  devWallet:
    | TokenRoutePayload["devWallet"]
    | TokenLivePayload["devWallet"]
    | NonNullable<Awaited<ReturnType<typeof peekCachedSolanaTokenDistribution>>>["devWallet"]
    | null
    | undefined
): boolean {
  return Boolean((topHolders ?? []).some((holder) => hasResolvedHolderRoleFields(holder)));
}

function needsFreshSolanaHolderDistributionSnapshot(
  snapshot: Awaited<ReturnType<typeof peekCachedSolanaTokenDistribution>>
): boolean {
  if (!snapshot) {
    return true;
  }

  return (
    snapshot.topHolders.length === 0 ||
    !hasResolvedHolderCount(snapshot.holderCount, snapshot.holderCountSource) ||
    !hasResolvedHolderRoleIntelligence(snapshot.topHolders, snapshot.devWallet)
  );
}

tokensRouter.get(
  "/:tokenAddress/live",
  zValidator("param", TokenAddressParamSchema),
  zValidator("query", TokenLiveQuerySchema),
  async (c) => {
  const { tokenAddress } = c.req.valid("param");
  const { fresh } = c.req.valid("query");
  const shouldPreferFreshDistribution = fresh === "1" || fresh === "true";
  const shouldAvoidFreshDbReads = await isPrismaPoolPressureActive();
  const cacheKey = buildTokenLiveRouteCacheKey(tokenAddress, {
    fresh: shouldPreferFreshDistribution,
  });
  const cached = readTokenLiveRouteCache(cacheKey);
  if (cached) {
    return c.json({ data: cached }, 200, buildLiveTokenRouteHeaders());
  }

  let request = tokenLiveRouteInFlight.get(cacheKey);
  if (!request) {
    request = (async () => {
      let token = null;
      try {
        token = await findTokenByAddress(tokenAddress);
      } catch (error) {
        if (!isTransientPrismaError(error)) {
          throw error;
        }
        console.warn("[tokens/live] token lookup degraded; falling back to address-only live payload", {
          tokenAddress,
          message: error instanceof Error ? error.message : String(error),
        });
      }

      const chainType = token?.chainType ?? inferTokenChainType(tokenAddress);
      if (!chainType) {
        throw new Error("NOT_FOUND");
      }

      const cachedDistribution =
        chainType === "solana" ? peekCachedSolanaTokenDistribution(tokenAddress) : null;
      const shouldRunLiveDistributionScan =
        chainType === "solana" &&
        (shouldPreferFreshDistribution
          ? needsFreshSolanaHolderDistributionSnapshot(cachedDistribution)
          : !cachedDistribution && (!token || !hasStoredSolanaDistributionTelemetry(token)));

      const [marketSnapshot, distributionSnapshot, recentSignalCalls, snapshotHistory] = await Promise.all([
        getCachedMarketCapSnapshot(tokenAddress, chainType),
        shouldRunLiveDistributionScan
          ? analyzeSolanaTokenDistribution(tokenAddress, token?.liquidity ?? null, {
              preferFresh: shouldPreferFreshDistribution,
            })
          : Promise.resolve(cachedDistribution),
        shouldAvoidFreshDbReads
          ? Promise.resolve([] as Array<{
              id: string;
              authorId: string;
              createdAt: Date;
              entryMcap: number | null;
              currentMcap: number | null;
              lastMcapUpdate: Date | null;
              lastIntelligenceAt: Date | null;
              roiCurrentPct: number | null;
              threadCount: number | null;
              reactionCounts: unknown;
              entryQualityScore: number | null;
              author: {
                id: string;
                trustScore: number | null;
                winRate30d: number | null;
                avgRoi30d: number | null;
              };
              _count: {
                comments: number;
              };
            }>)
          : prisma.post.findMany({
              where: {
                contractAddress: tokenAddress,
              },
              select: {
                id: true,
                authorId: true,
                createdAt: true,
                entryMcap: true,
                currentMcap: true,
                lastMcapUpdate: true,
                lastIntelligenceAt: true,
                roiCurrentPct: true,
                threadCount: true,
                reactionCounts: true,
                entryQualityScore: true,
                author: {
                  select: {
                    id: true,
                    trustScore: true,
                    winRate30d: true,
                    avgRoi30d: true,
                  },
                },
                _count: {
                  select: {
                    comments: true,
                  },
                },
              },
              orderBy: [{ createdAt: "desc" }, { id: "desc" }],
              take: 24,
            }).catch(() => [] as Array<{
              id: string;
              authorId: string;
              createdAt: Date;
              entryMcap: number | null;
              currentMcap: number | null;
              lastMcapUpdate: Date | null;
              lastIntelligenceAt: Date | null;
              roiCurrentPct: number | null;
              threadCount: number | null;
              reactionCounts: unknown;
              entryQualityScore: number | null;
              author: {
                id: string;
                trustScore: number | null;
                winRate30d: number | null;
                avgRoi30d: number | null;
              };
              _count: {
                comments: number;
              };
            }>),
        shouldAvoidFreshDbReads || !token?.id
          ? Promise.resolve([] as Array<{
              capturedAt: Date;
              marketCap: number | null;
              liquidity: number | null;
              volume24h: number | null;
              holderCount: number | null;
            }>)
          : prisma.tokenMetricSnapshot.findMany({
              where: { tokenId: token.id },
              select: {
                capturedAt: true,
                marketCap: true,
                liquidity: true,
                volume24h: true,
                holderCount: true,
              },
              orderBy: { capturedAt: "desc" },
              take: 6,
            }).catch(() => [] as Array<{
              capturedAt: Date;
              marketCap: number | null;
              liquidity: number | null;
              volume24h: number | null;
              holderCount: number | null;
            }>),
      ]);

      const liveBundleClusters =
        distributionSnapshot?.clusters.map((cluster) => ({
          id: `live:${token?.id ?? tokenAddress.trim().toLowerCase()}:${cluster.clusterLabel}`,
          clusterLabel: cluster.clusterLabel,
          walletCount: cluster.walletCount,
          estimatedSupplyPct: cluster.estimatedSupplyPct,
          evidenceJson: cluster.evidenceJson,
          currentAction: null as string | null,
        })) ?? [];
      const distributionHolderCount =
        chainType === "solana"
          ? roundCount(distributionSnapshot?.holderCount)
          : null;
      const distributionHolderCountSource =
        chainType === "solana"
          ? distributionSnapshot?.holderCountSource ?? null
          : null;
      const observedTopHolderCount = distributionSnapshot?.topHolders.length ?? 0;
      const rawStoredHolderCount = roundCount(pickFirstPositiveMetric(token?.holderCount));
      const storedHolderCount =
        looksLikeLowerBoundStoredHolderCount({
          chainType,
          storedHolderCount: rawStoredHolderCount,
          observedTopHolderCount,
          liveHolderCount: distributionHolderCount,
          liveHolderCountSource: distributionHolderCountSource,
        })
          ? null
          : rawStoredHolderCount;
      const unresolvedDistributionHolderCount =
        chainType === "solana"
          ? distributionHolderCountSource === "largest_accounts"
            ? distributionHolderCount
            : observedTopHolderCount > 0 && !hasResolvedHolderCount(distributionHolderCount, distributionHolderCountSource)
              ? observedTopHolderCount
              : null
          : null;
      const holderCount =
        chainType === "solana"
          ? hasResolvedHolderCount(distributionHolderCount, distributionHolderCountSource)
            ? distributionHolderCount
            : pickFirstPositiveMetric(storedHolderCount, unresolvedDistributionHolderCount)
          : roundCount(pickFirstPositiveMetric(token?.holderCount));
      const holderCountSource =
        chainType === "solana"
          ? hasResolvedHolderCount(distributionHolderCount, distributionHolderCountSource)
            ? distributionHolderCountSource
            : holderCount !== null
              ? storedHolderCount !== null
                ? "stored"
                : unresolvedDistributionHolderCount !== null
                  ? distributionHolderCountSource ?? "largest_accounts"
                  : null
              : null
          : holderCount !== null
            ? "stored"
            : null;
      const largestHolderPct =
        chainType === "solana"
          ? roundMetric(pickFirstFiniteMetric(distributionSnapshot?.largestHolderPct, token?.largestHolderPct))
          : roundMetric(pickFirstFiniteMetric(token?.largestHolderPct));
      const top10HolderPct =
        chainType === "solana"
          ? roundMetric(pickFirstFiniteMetric(distributionSnapshot?.top10HolderPct, token?.top10HolderPct))
          : roundMetric(pickFirstFiniteMetric(token?.top10HolderPct));
      const deployerSupplyPct =
        chainType === "solana"
          ? roundMetric(pickFirstFiniteMetric(distributionSnapshot?.deployerSupplyPct, token?.deployerSupplyPct))
          : roundMetric(pickFirstFiniteMetric(token?.deployerSupplyPct));
      const bundledWalletCount =
        chainType === "solana"
          ? roundCount(pickFirstFiniteMetric(distributionSnapshot?.bundledWalletCount, token?.bundledWalletCount))
          : roundCount(pickFirstFiniteMetric(token?.bundledWalletCount));
      const estimatedBundledSupplyPct =
        chainType === "solana"
          ? resolveBundledSupplyPct(
              pickFirstFiniteMetric(distributionSnapshot?.estimatedBundledSupplyPct, token?.estimatedBundledSupplyPct)
              ,
              liveBundleClusters
            )
          : roundMetric(pickFirstFiniteMetric(token?.estimatedBundledSupplyPct));
      const tokenRiskScore =
        chainType === "solana" &&
        ((isFiniteNumber(estimatedBundledSupplyPct) && estimatedBundledSupplyPct > 0) || liveBundleClusters.length > 0)
          ? roundMetric(
              computeTokenRiskScore({
                estimatedBundledSupplyPct,
                bundledClusterCount: liveBundleClusters.length,
                largestHolderPct,
                top10HolderPct,
                deployerSupplyPct,
              })
            )
          : chainType === "solana"
            ? roundMetric(pickFirstFiniteMetric(distributionSnapshot?.tokenRiskScore, token?.tokenRiskScore))
            : roundMetric(pickFirstFiniteMetric(token?.tokenRiskScore));
      const bundleRiskLabel =
        chainType === "solana" &&
        typeof tokenRiskScore === "number" &&
        Number.isFinite(tokenRiskScore) &&
        ((isFiniteNumber(estimatedBundledSupplyPct) && estimatedBundledSupplyPct > 0) || liveBundleClusters.length > 0)
          ? determineBundleRiskLabel(tokenRiskScore)
          : chainType === "solana"
            ? distributionSnapshot?.bundleRiskLabel ?? token?.bundleRiskLabel ?? null
            : token?.bundleRiskLabel ?? null;
      const comparisonSnapshot =
        snapshotHistory.length > 1
          ? snapshotHistory[snapshotHistory.length - 1] ?? null
          : snapshotHistory[0] ?? null;
      const freshestPostCurrentMcap = pickFreshestPostCurrentMcap(recentSignalCalls);
      const marketCap = roundMetric(
        pickFirstPositiveMetric(
          freshestPostCurrentMcap,
          marketSnapshot.mcap,
          comparisonSnapshot?.marketCap
        )
      );
      const liquidity = roundMetric(
        pickFirstPositiveMetric(
          marketSnapshot.liquidityUsd,
          token?.liquidity,
          comparisonSnapshot?.liquidity
        )
      );
      const volume24h = roundMetric(
        pickFirstPositiveMetric(
          marketSnapshot.volume24hUsd,
          token?.volume24h,
          comparisonSnapshot?.volume24h
        )
      );
      const aggregatedReactions = recentSignalCalls.reduce(
        (totals, call) => sumReactionCounts(totals, parseReactionCounts(call.reactionCounts)),
        emptyReactionCounts()
      );
      const bullishReactions =
        aggregatedReactions.alpha + aggregatedReactions.based + aggregatedReactions.printed;
      const bearishReactions = aggregatedReactions.rug;
      const totalSentimentReactions = bullishReactions + bearishReactions;
      const sentimentScore = roundMetric(
        computeSentimentScore({
          reactions: aggregatedReactions,
          sentimentTrendAdjustment: computeDexSentimentTrendAdjustment({
            priceChange24hPct: marketSnapshot.priceChange24hPct,
            buys24h: marketSnapshot.buys24h,
            sells24h: marketSnapshot.sells24h,
          }),
        })
      );
      const volumeGrowth24hPct = growthPct(volume24h, comparisonSnapshot?.volume24h ?? null);
      const liquidityGrowth1hPct = growthPct(liquidity, comparisonSnapshot?.liquidity ?? null);
      const holderGrowth1hPct = growthPct(holderCount, comparisonSnapshot?.holderCount ?? null);
      const mcapGrowthPct = growthPct(marketCap, comparisonSnapshot?.marketCap ?? null);
      const momentumPct = finiteMetric(marketSnapshot.priceChange24hPct);
      const compositeMomentumPct = Math.max(Math.max(0, momentumPct), Math.max(0, mcapGrowthPct));
      const trustedTraderCount = new Set(
        recentSignalCalls
          .filter((call) => finiteMetric(call.author.trustScore) >= TRUSTED_TRADER_THRESHOLD)
          .map((call) => call.authorId)
      ).size;
      const distinctTrustedTradersLast6h = new Set(
        recentSignalCalls
          .filter((call) => Date.now() - call.createdAt.getTime() <= 6 * 60 * 60 * 1000)
          .filter((call) => finiteMetric(call.author.trustScore) >= TRUSTED_TRADER_THRESHOLD)
          .map((call) => call.authorId)
      ).size;
      const traderWinRate30d = averageFiniteMetric(recentSignalCalls.map((call) => call.author.winRate30d));
      const traderAvgRoi30d = averageFiniteMetric(recentSignalCalls.map((call) => call.author.avgRoi30d));
      const traderTrustScore = averageFiniteMetric(recentSignalCalls.map((call) => call.author.trustScore));
      const entryQualityScore = averageFiniteMetric(recentSignalCalls.map((call) => call.entryQualityScore));
      const weightedEngagementPerHour = averageFiniteMetric(
        recentSignalCalls.map((call) =>
          computeWeightedEngagementPerHour({
            reactions: parseReactionCounts(call.reactionCounts),
            threadReplies: call.threadCount ?? call._count.comments,
            ageHours: Math.max(0.2, (Date.now() - call.createdAt.getTime()) / (60 * 60 * 1000)),
          })
        )
      );
      const avgCurrentRoiPct = averageFiniteMetric(
        recentSignalCalls.map((call) => call.roiCurrentPct ?? deriveRoiPct(call.entryMcap, call.currentMcap))
      );
      const baseConfidenceScore = roundMetric(
        computeConfidenceScore({
          traderWinRate30d,
          traderAvgRoi30d,
          traderTrustScore,
          entryQualityScore,
          liquidityUsd: liquidity,
          volumeGrowth24hPct,
          liquidityGrowth1hPct,
          holderGrowth1hPct,
          mcapGrowthPct,
          momentumPct: compositeMomentumPct,
          trustedTraderCount,
          holderCount,
          largestHolderPct,
          top10HolderPct,
          deployerSupplyPct,
          bundledWalletCount,
          estimatedBundledSupplyPct,
          tokenRiskScore,
          roiCurrentPct: avgCurrentRoiPct,
          sentimentScore,
        })
      );
      const baseHotAlphaScore = roundMetric(
        computeHotAlphaScore({
          confidenceScore: baseConfidenceScore,
          weightedEngagementPerHour,
          earlyGainsPct: avgCurrentRoiPct,
          traderTrustScore,
          liquidityUsd: liquidity,
          sentimentScore,
          momentumPct: compositeMomentumPct,
          holderCount,
          largestHolderPct,
          top10HolderPct,
          deployerSupplyPct,
          bundledWalletCount,
          estimatedBundledSupplyPct,
          tokenRiskScore,
        })
      );
      const baseEarlyRunnerScore = roundMetric(
        computeEarlyRunnerScore({
          distinctTrustedTradersLast6h,
          liquidityGrowth1hPct,
          volumeGrowth1hPct: volumeGrowth24hPct,
          holderGrowth1hPct,
          momentumPct: compositeMomentumPct,
          sentimentScore,
          holderCount,
          largestHolderPct,
          top10HolderPct,
          deployerSupplyPct,
          bundledWalletCount,
          estimatedBundledSupplyPct,
          tokenRiskScore,
        })
      );
      const baseHighConvictionScore = roundMetric(
        computeHighConvictionScore({
          confidenceScore: baseConfidenceScore,
          traderTrustScore,
          entryQualityScore,
          liquidityUsd: liquidity,
          sentimentScore,
          trustedTraderCount,
          holderCount,
          largestHolderPct,
          top10HolderPct,
          deployerSupplyPct,
          bundledWalletCount,
          estimatedBundledSupplyPct,
          tokenRiskScore,
        })
      );
      const scoreState = computeStateAwareIntelligenceScores({
        baseConfidenceScore,
        baseHotAlphaScore,
        baseEarlyRunnerScore,
        baseHighConvictionScore,
        liquidityUsd: liquidity,
        volume24hUsd: volume24h,
        holderCount,
        largestHolderPct,
        top10HolderPct,
        deployerSupplyPct,
        bundledWalletCount,
        estimatedBundledSupplyPct,
        tokenRiskScore,
        traderTrustScore,
        entryQualityScore,
        trustedTraderCount,
        sentimentScore,
        marketBreadthScore: 50,
        liquidityGrowthPct: liquidityGrowth1hPct,
        volumeGrowthPct: volumeGrowth24hPct,
        holderGrowthPct: holderGrowth1hPct,
        mcapGrowthPct,
        momentumPct: compositeMomentumPct,
        tradeCount24h:
          typeof marketSnapshot.buys24h === "number" || typeof marketSnapshot.sells24h === "number"
            ? finiteMetric(marketSnapshot.buys24h) + finiteMetric(marketSnapshot.sells24h)
            : null,
        hasTradablePair: Boolean(marketSnapshot.pairAddress ?? token?.pairAddress ?? marketSnapshot.dexscreenerUrl ?? token?.dexscreenerUrl),
        hasResolvedHolderDistribution:
          (distributionSnapshot?.topHolders?.length ?? 0) > 0 ||
          largestHolderPct !== null ||
          top10HolderPct !== null,
        recentCallCount: recentSignalCalls.length,
        signalAgeHours:
          recentSignalCalls.length > 0
            ? Math.max(0.2, (Date.now() - recentSignalCalls[0]!.createdAt.getTime()) / (60 * 60 * 1000))
            : null,
      });
      const confidenceScore = roundMetric(scoreState.confidenceScore);
      const hotAlphaScore = roundMetric(scoreState.hotAlphaScore);
      const earlyRunnerScore = roundMetric(scoreState.earlyRunnerScore);
      const highConvictionScore = roundMetric(scoreState.highConvictionScore);
      const liveLastIntelligenceTimestamp = Math.max(
        toTimestampMs(token?.lastIntelligenceAt),
        ...recentSignalCalls.map((call) => toTimestampMs(call.lastIntelligenceAt))
      );

      const payload = {
        marketCap,
        liquidity,
        volume24h,
        holderCount,
        holderCountSource,
        largestHolderPct,
        top10HolderPct,
        deployerSupplyPct,
        bundledWalletCount,
        estimatedBundledSupplyPct,
        bundleRiskLabel,
        tokenRiskScore,
        topHolders: distributionSnapshot?.topHolders ?? [],
        devWallet: distributionSnapshot?.devWallet ?? null,
        bundleClusters: liveBundleClusters,
        dexscreenerUrl: marketSnapshot.dexscreenerUrl ?? token?.dexscreenerUrl ?? null,
        pairAddress: marketSnapshot.pairAddress ?? token?.pairAddress ?? null,
        dexId: marketSnapshot.dexId ?? token?.dexId ?? null,
        imageUrl: marketSnapshot.tokenImage ?? token?.imageUrl ?? null,
        symbol: marketSnapshot.tokenSymbol ?? token?.symbol ?? null,
        name: marketSnapshot.tokenName ?? token?.name ?? null,
        sentimentScore,
        confidenceScore,
        hotAlphaScore,
        earlyRunnerScore,
        highConvictionScore,
        marketHealthScore: scoreState.marketHealthScore,
        setupQualityScore: scoreState.setupQualityScore,
        opportunityScore: scoreState.opportunityScore,
        dataReliabilityScore: scoreState.dataReliabilityScore,
        activityStatus: scoreState.activityStatus,
        activityStatusLabel: scoreState.activityStatusLabel,
        isTradable: scoreState.isTradable,
        bullishSignalsSuppressed: scoreState.bullishSignalsSuppressed,
        sentiment: {
          score: sentimentScore ?? 0,
          reactions: aggregatedReactions,
          bullishPct:
            totalSentimentReactions > 0
              ? roundMetric((bullishReactions / totalSentimentReactions) * 100) ?? 0
              : sentimentScore ?? 0,
          bearishPct:
            totalSentimentReactions > 0
              ? roundMetric((bearishReactions / totalSentimentReactions) * 100) ?? 0
              : Math.max(0, 100 - finiteMetric(sentimentScore)),
        },
        lastIntelligenceAt: liveLastIntelligenceTimestamp > 0 ? new Date(liveLastIntelligenceTimestamp).toISOString() : null,
        priceUsd: roundMetric(marketSnapshot.priceUsd ?? null),
        priceChange24hPct: roundMetric(marketSnapshot.priceChange24hPct ?? null),
        buys24h: roundCount(marketSnapshot.buys24h ?? null),
        sells24h: roundCount(marketSnapshot.sells24h ?? null),
        bundleScanCompletedAt: hasResolvedSolanaDistributionSnapshot(distributionSnapshot)
          ? new Date().toISOString()
          : null,
        updatedAt: new Date().toISOString(),
      } satisfies TokenLivePayload;

      if (!token && !hasUsefulLiveTokenPayload(payload)) {
        throw new Error("NOT_FOUND");
      }

      return payload;
    })();
    tokenLiveRouteInFlight.set(cacheKey, request);
  }

  try {
    const payload = await request;
    tokenLiveRouteCache.set(cacheKey, {
      data: payload,
      expiresAtMs:
        Date.now() +
        (hasResolvedLiveTokenPayload(payload)
          ? TOKEN_LIVE_ROUTE_RESOLVED_CACHE_TTL_MS
          : TOKEN_LIVE_ROUTE_PENDING_CACHE_TTL_MS),
      staleUntilMs:
        Date.now() +
        (hasResolvedLiveTokenPayload(payload)
          ? TOKEN_ROUTE_STALE_FALLBACK_MS
          : TOKEN_LIVE_ROUTE_PENDING_CACHE_TTL_MS),
    });
    return c.json({ data: payload }, 200, buildLiveTokenRouteHeaders());
  } catch (error) {
    if (error instanceof Error && error.message === "NOT_FOUND") {
      return c.json({ error: { message: "Token not found", code: "NOT_FOUND" } }, 404);
    }
    throw error;
  } finally {
    const current = tokenLiveRouteInFlight.get(cacheKey);
    if (current === request) {
      tokenLiveRouteInFlight.delete(cacheKey);
    }
  }
});

tokensRouter.get("/:tokenAddress", zValidator("param", TokenAddressParamSchema), async (c) => {
  const { tokenAddress } = c.req.valid("param");
  const viewer = c.get("user");
  const isPersonalized = Boolean(viewer?.id);
  const sharedCacheKey = buildTokenRouteCacheKey(tokenAddress, null);
  const sharedCached = await readBestEffortTokenRouteCache(sharedCacheKey);
  const sharedStaleCached = await readBestEffortTokenRouteCache(sharedCacheKey, { allowStale: true });
  if (isPersonalized) {
    c.header("Vary", "Cookie");
    if (await isPrismaPoolPressureActive()) {
      if (sharedCached ?? sharedStaleCached) {
        return c.json({ data: (sharedCached ?? sharedStaleCached)! }, 200, buildTokenRouteHeaders(true));
      }
      return c.json(
        {
          error: {
            message: "Token overview is temporarily unavailable. Please retry shortly.",
            code: "TOKEN_UNAVAILABLE",
          },
        },
        503
      );
    }
    const overview = await getTokenOverviewByAddress(tokenAddress, viewer!.id);
    if (!overview) {
      return c.json({ error: { message: "Token not found", code: "NOT_FOUND" } }, 404);
    }

    const data = overview.token;
    if (isMeaningfulTokenRoutePayload(data)) {
      writeBestEffortTokenRouteCache(sharedCacheKey, toSharedTokenRoutePayload(data));
    }

    return c.json({ data }, 200, buildTokenRouteHeaders(true));
  }

  const cached = sharedCached;
  const staleCached = sharedStaleCached;

  if (cached) {
    return c.json({ data: cached }, 200, buildTokenRouteHeaders(false));
  }
  if (staleCached) {
    void getTokenOverviewByAddress(tokenAddress, null)
      .then((overview) => {
        if (!overview) return;
        const data = isMeaningfulTokenRoutePayload(overview.token) ? overview.token : staleCached;
        if (!isMeaningfulTokenRoutePayload(data)) return;
        writeBestEffortTokenRouteCache(sharedCacheKey, toSharedTokenRoutePayload(data));
      })
      .catch(() => undefined);
    return c.json({ data: staleCached }, 200, buildTokenRouteHeaders(false));
  }

  if (await isPrismaPoolPressureActive()) {
    return c.json(
      {
        error: {
          message: "Token overview is temporarily unavailable. Please retry shortly.",
          code: "TOKEN_UNAVAILABLE",
        },
      },
      503
    );
  }

  let overview;
  try {
    overview = await getTokenOverviewByAddress(tokenAddress, null);
  } catch (error) {
    if (cached ?? staleCached) {
      console.warn("[tokens] serving stale cached token overview", {
        tokenAddress,
        viewerId: null,
        message: error instanceof Error ? error.message : String(error),
      });
      return c.json({ data: (cached ?? staleCached)! }, 200, buildTokenRouteHeaders(false));
    }
    throw error;
  }

  if (!overview) {
    return c.json({ error: { message: "Token not found", code: "NOT_FOUND" } }, 404);
  }

  const data = isMeaningfulTokenRoutePayload(overview.token) ? overview.token : staleCached ?? overview.token;
  if (isMeaningfulTokenRoutePayload(data)) {
    writeBestEffortTokenRouteCache(sharedCacheKey, toSharedTokenRoutePayload(data));
  }

  return c.json({ data }, 200, buildTokenRouteHeaders(false));
});

tokensRouter.get("/:tokenAddress/chart", zValidator("param", TokenAddressParamSchema), async (c) => {
  const { tokenAddress } = c.req.valid("param");
  const chart = await loadTokenChartHistory(tokenAddress);

  if (!chart) {
    return c.json({ error: { message: "Token not found", code: "NOT_FOUND" } }, 404);
  }

  return c.json({ data: chart }, 200, buildTokenRouteHeaders(false));
});

tokensRouter.get("/:tokenAddress/timeline", zValidator("param", TokenAddressParamSchema), async (c) => {
  const { tokenAddress } = c.req.valid("param");
  const viewer = c.get("user");
  const overview = await getTokenOverviewByAddress(tokenAddress, viewer?.id ?? null);

  if (!overview) {
    return c.json({ error: { message: "Token not found", code: "NOT_FOUND" } }, 404);
  }

  return c.json({ data: overview.token.timeline }, 200, buildTokenRouteHeaders(false));
});

tokensRouter.get("/:tokenAddress/calls", zValidator("param", TokenAddressParamSchema), async (c) => {
  const { tokenAddress } = c.req.valid("param");
  const viewer = c.get("user");
  const overview = await getTokenOverviewByAddress(tokenAddress, viewer?.id ?? null);
  if (!overview) {
    return c.json({ error: { message: "Token not found", code: "NOT_FOUND" } }, 404);
  }
  if (viewer?.id) {
    c.header("Vary", "Cookie");
  }
  return c.json({ data: overview.token.recentCalls }, 200, buildTokenRouteHeaders(Boolean(viewer?.id)));
});

tokensRouter.get("/:tokenAddress/risk", zValidator("param", TokenAddressParamSchema), async (c) => {
  const { tokenAddress } = c.req.valid("param");
  const viewer = c.get("user");
  const overview = await getTokenOverviewByAddress(tokenAddress, viewer?.id ?? null);

  if (!overview) {
    return c.json({ error: { message: "Token not found", code: "NOT_FOUND" } }, 404);
  }

  return c.json({ data: overview.token.risk }, 200, buildTokenRouteHeaders(false));
});

tokensRouter.get("/:tokenAddress/sentiment", zValidator("param", TokenAddressParamSchema), async (c) => {
  const { tokenAddress } = c.req.valid("param");
  const viewer = c.get("user");
  const overview = await getTokenOverviewByAddress(tokenAddress, viewer?.id ?? null);

  if (!overview) {
    return c.json({ error: { message: "Token not found", code: "NOT_FOUND" } }, 404);
  }

  return c.json({ data: overview.token.sentiment }, 200, buildTokenRouteHeaders(false));
});

tokensRouter.get("/:tokenAddress/social-signals", zValidator("param", TokenAddressParamSchema), async (c) => {
  const { tokenAddress } = c.req.valid("param");
  const token = await findTokenByAddress(tokenAddress);

  if (!token) {
    return c.json({ error: { message: "Token not found", code: "NOT_FOUND" } }, 404);
  }

  const data = await loadTokenSocialSignals({
    tokenAddress: token.address,
    symbol: token.symbol ?? null,
    name: token.name ?? null,
  });

  return c.json({ data }, 200, buildTokenRouteHeaders(false));
});

tokensRouter.post("/:tokenAddress/follow", requireNotBanned, zValidator("param", TokenAddressParamSchema), async (c) => {
  const user = c.get("user");
  if (!user) {
    return c.json({ error: { message: "Unauthorized", code: "UNAUTHORIZED" } }, 401);
  }

  const { tokenAddress } = c.req.valid("param");
  const overview = await getTokenOverviewByAddress(tokenAddress, user.id);
  if (!overview) {
    return c.json({ error: { message: "Token not found", code: "NOT_FOUND" } }, 404);
  }
  if (!overview.token.communityExists) {
    return c.json(
      { error: { message: "Community has not been created yet", code: "COMMUNITY_NOT_CREATED" } },
      409
    );
  }

  await prisma.tokenFollow.upsert({
    where: {
      userId_tokenId: {
        userId: user.id,
        tokenId: overview.token.id,
      },
    },
    create: {
      userId: user.id,
      tokenId: overview.token.id,
    },
    update: {},
  });
  invalidateViewerSocialCaches(user.id);
  invalidateTokenRouteCache(tokenAddress);

  return c.json({ data: { following: true, tokenId: overview.token.id } });
});

tokensRouter.delete("/:tokenAddress/follow", requireAuth, zValidator("param", TokenAddressParamSchema), async (c) => {
  const user = c.get("user");
  if (!user) {
    return c.json({ error: { message: "Unauthorized", code: "UNAUTHORIZED" } }, 401);
  }

  const { tokenAddress } = c.req.valid("param");
  const overview = await getTokenOverviewByAddress(tokenAddress, user.id);
  if (!overview) {
    return c.json({ error: { message: "Token not found", code: "NOT_FOUND" } }, 404);
  }

  await prisma.tokenFollow.delete({
    where: {
      userId_tokenId: {
        userId: user.id,
        tokenId: overview.token.id,
      },
    },
  }).catch(() => undefined);
  invalidateViewerSocialCaches(user.id);
  invalidateTokenRouteCache(tokenAddress);

  return c.json({ data: { following: false, tokenId: overview.token.id } });
});
