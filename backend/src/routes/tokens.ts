import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { type AuthVariables, requireAuth, requireNotBanned } from "../auth.js";
import { cacheGetJson, cacheSetJson, redisDelete } from "../lib/redis.js";
import { isTransientPrismaError, prisma } from "../prisma.js";
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
import { computeTokenRiskScore, determineBundleRiskLabel } from "../services/intelligence/scoring.js";

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
const TOKEN_ROUTE_CACHE_VERSION = 16;
const tokenRouteCache = new Map<string, TokenRouteCacheEntry<TokenRoutePayload>>();
const tokenLiveRouteCache = new Map<string, TokenRouteCacheEntry<TokenLivePayload>>();
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

  return Boolean(holder.badges.length > 0 || holder.devRole !== null);
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
  return Boolean(
    (topHolders ?? []).some((holder) => hasResolvedHolderRoleFields(holder)) ||
      hasResolvedHolderRoleFields(devWallet)
  );
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

      const [marketSnapshot, distributionSnapshot] = await Promise.all([
        getCachedMarketCapSnapshot(tokenAddress, chainType),
        shouldRunLiveDistributionScan
          ? analyzeSolanaTokenDistribution(tokenAddress, token?.liquidity ?? null, {
              preferFresh: shouldPreferFreshDistribution,
            })
          : Promise.resolve(cachedDistribution),
      ]);

      const liveBundleClusters =
        distributionSnapshot?.clusters.map((cluster) => ({
          id: `live:${token?.id ?? tokenAddress.trim().toLowerCase()}:${cluster.clusterLabel}`,
          clusterLabel: cluster.clusterLabel,
          walletCount: cluster.walletCount,
          estimatedSupplyPct: cluster.estimatedSupplyPct,
          evidenceJson: cluster.evidenceJson,
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

      const payload = {
        marketCap: roundMetric(pickFirstPositiveMetric(marketSnapshot.mcap)),
        liquidity: roundMetric(pickFirstPositiveMetric(marketSnapshot.liquidityUsd, token?.liquidity)),
        volume24h: roundMetric(pickFirstPositiveMetric(marketSnapshot.volume24hUsd, token?.volume24h)),
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
  const viewerCacheKey = viewer?.id ? buildTokenRouteCacheKey(tokenAddress, viewer.id) : sharedCacheKey;
  const cachedViewerPayload = viewerCacheKey ? await readBestEffortTokenRouteCache(viewerCacheKey) : null;
  const cachedSharedPayload =
    viewerCacheKey !== sharedCacheKey ? await readBestEffortTokenRouteCache(sharedCacheKey) : cachedViewerPayload;
  const cached = cachedViewerPayload ?? cachedSharedPayload;
  const staleCachedViewerPayload = viewerCacheKey
    ? await readBestEffortTokenRouteCache(viewerCacheKey, { allowStale: true })
    : null;
  const staleCachedSharedPayload =
    viewerCacheKey !== sharedCacheKey
      ? await readBestEffortTokenRouteCache(sharedCacheKey, { allowStale: true })
      : staleCachedViewerPayload;
  const staleCached = staleCachedViewerPayload ?? staleCachedSharedPayload;
  if (isPersonalized) {
    c.header("Vary", "Cookie");
  }

  if (cachedViewerPayload) {
    return c.json({ data: cachedViewerPayload }, 200, buildTokenRouteHeaders(isPersonalized));
  }
  if (staleCached) {
    void getTokenOverviewByAddress(tokenAddress, viewer?.id ?? null)
      .then((overview) => {
        if (!overview) return;
        const data = isMeaningfulTokenRoutePayload(overview.token) ? overview.token : staleCached;
        if (!isMeaningfulTokenRoutePayload(data)) return;
        writeBestEffortTokenRouteCache(viewerCacheKey, data);
        writeBestEffortTokenRouteCache(sharedCacheKey, toSharedTokenRoutePayload(data));
      })
      .catch(() => undefined);
    return c.json({ data: staleCached }, 200, buildTokenRouteHeaders(isPersonalized));
  }

  let overview;
  try {
    overview = await getTokenOverviewByAddress(tokenAddress, viewer?.id ?? null);
  } catch (error) {
    if (cached ?? staleCached) {
      console.warn("[tokens] serving stale cached token overview", {
        tokenAddress,
        viewerId: viewer?.id ?? null,
        message: error instanceof Error ? error.message : String(error),
      });
      return c.json({ data: (cached ?? staleCached)! }, 200, buildTokenRouteHeaders(isPersonalized));
    }
    throw error;
  }

  if (!overview) {
    return c.json({ error: { message: "Token not found", code: "NOT_FOUND" } }, 404);
  }

  const data = isMeaningfulTokenRoutePayload(overview.token) ? overview.token : staleCached ?? overview.token;
  if (isMeaningfulTokenRoutePayload(data)) {
    writeBestEffortTokenRouteCache(viewerCacheKey, data);
    writeBestEffortTokenRouteCache(sharedCacheKey, toSharedTokenRoutePayload(data));
  }

  return c.json({ data }, 200, buildTokenRouteHeaders(isPersonalized));
});

tokensRouter.get("/:tokenAddress/chart", zValidator("param", TokenAddressParamSchema), async (c) => {
  const { tokenAddress } = c.req.valid("param");
  const viewer = c.get("user");
  const overview = await getTokenOverviewByAddress(tokenAddress, viewer?.id ?? null);

  if (!overview) {
    return c.json({ error: { message: "Token not found", code: "NOT_FOUND" } }, 404);
  }

  return c.json({ data: overview.token.chart }, 200, buildTokenRouteHeaders(false));
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
