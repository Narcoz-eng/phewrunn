import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { type AuthVariables, requireAuth, requireNotBanned } from "../auth.js";
import { cacheGetJson, cacheSetJson, redisDelete } from "../lib/redis.js";
import { prisma } from "../prisma.js";
import { getCachedMarketCapSnapshot } from "../services/marketcap.js";
import { analyzeSolanaTokenDistribution } from "../services/intelligence/token-metrics.js";
import {
  findTokenByAddress,
  getTokenOverviewByAddress,
  invalidateViewerSocialCaches,
} from "../services/intelligence/engine.js";

export const tokensRouter = new Hono<{ Variables: AuthVariables }>();

type TokenRoutePayload = NonNullable<Awaited<ReturnType<typeof getTokenOverviewByAddress>>>["token"];
type TokenRouteCacheEntry<T> = {
  data: T;
  expiresAtMs: number;
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
  updatedAt: string;
};

const TOKEN_ROUTE_CACHE_TTL_MS = process.env.NODE_ENV === "production" ? 2 * 60_000 : 30_000;
const TOKEN_LIVE_ROUTE_CACHE_TTL_MS = process.env.NODE_ENV === "production" ? 5_000 : 1_500;
const TOKEN_ROUTE_CACHE_VERSION = 11;
const tokenRouteCache = new Map<string, TokenRouteCacheEntry<TokenRoutePayload>>();
const tokenLiveRouteCache = new Map<string, TokenRouteCacheEntry<TokenLivePayload>>();
const tokenLiveRouteInFlight = new Map<string, Promise<TokenLivePayload>>();
const TokenAddressParamSchema = z.object({
  tokenAddress: z.string().trim().min(1),
});

function buildTokenRouteCacheKey(tokenAddress: string, viewerId: string | null): string {
  return `route:token:v${TOKEN_ROUTE_CACHE_VERSION}:${viewerId ?? "anonymous"}:${tokenAddress.trim().toLowerCase()}`;
}

function buildTokenLiveRouteCacheKey(tokenAddress: string): string {
  return `route:token-live:${tokenAddress.trim().toLowerCase()}`;
}

function shouldUseTokenRouteCache(viewerId: string | null | undefined): boolean {
  return !viewerId;
}

function readTokenRouteCache(key: string): TokenRoutePayload | null {
  const cached = tokenRouteCache.get(key);
  if (!cached) return null;
  if (cached.expiresAtMs <= Date.now()) {
    tokenRouteCache.delete(key);
    return null;
  }
  return cached.data;
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

function writeTokenRouteCache(key: string, data: TokenRoutePayload): void {
  tokenRouteCache.set(key, {
    data,
    expiresAtMs: Date.now() + TOKEN_ROUTE_CACHE_TTL_MS,
  });
}

async function readBestEffortTokenRouteCache(key: string): Promise<TokenRoutePayload | null> {
  const local = readTokenRouteCache(key);
  if (local) {
    return local;
  }

  const redisCached = await cacheGetJson<TokenRoutePayload>(key);
  if (redisCached) {
    writeTokenRouteCache(key, redisCached);
    return redisCached;
  }

  return null;
}

function writeBestEffortTokenRouteCache(key: string, data: TokenRoutePayload): void {
  writeTokenRouteCache(key, data);
  void cacheSetJson(key, data, TOKEN_ROUTE_CACHE_TTL_MS);
}

function invalidateTokenRouteCache(tokenAddress: string): void {
  const anonymousKey = buildTokenRouteCacheKey(tokenAddress, null);
  tokenRouteCache.delete(anonymousKey);
  void redisDelete(anonymousKey);
}

function isMeaningfulTokenRoutePayload(token: TokenRoutePayload): boolean {
  const hasHolderTelemetry =
    token.chainType !== "solana" ||
    token.topHolders.length > 0 ||
    (token.holderCountSource !== "stored" &&
      typeof token.holderCount === "number" &&
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

tokensRouter.get("/:tokenAddress/live", zValidator("param", TokenAddressParamSchema), async (c) => {
  const { tokenAddress } = c.req.valid("param");
  const cacheKey = buildTokenLiveRouteCacheKey(tokenAddress);
  const cached = readTokenLiveRouteCache(cacheKey);
  if (cached) {
    return c.json({ data: cached }, 200, buildLiveTokenRouteHeaders());
  }

  let request = tokenLiveRouteInFlight.get(cacheKey);
  if (!request) {
    request = (async () => {
      const token = await findTokenByAddress(tokenAddress);

      if (!token) {
        throw new Error("NOT_FOUND");
      }

      const [marketSnapshot, distributionSnapshot] = await Promise.all([
        getCachedMarketCapSnapshot(token.address, token.chainType),
        token.chainType === "solana"
          ? analyzeSolanaTokenDistribution(token.address, token.liquidity)
          : Promise.resolve(null),
      ]);

      const liveBundleClusters =
        distributionSnapshot?.clusters.map((cluster) => ({
          id: `live:${token.id}:${cluster.clusterLabel}`,
          clusterLabel: cluster.clusterLabel,
          walletCount: cluster.walletCount,
          estimatedSupplyPct: cluster.estimatedSupplyPct,
          evidenceJson: cluster.evidenceJson,
        })) ?? [];
      const distributionHolderCount =
        token.chainType === "solana"
          ? roundCount(distributionSnapshot?.holderCount)
          : null;
      const distributionHolderCountSource =
        token.chainType === "solana"
          ? distributionSnapshot?.holderCountSource ?? null
          : null;
      const observedTopHolderCount = distributionSnapshot?.topHolders.length ?? 0;
      const rawStoredHolderCount = roundCount(pickFirstPositiveMetric(token.holderCount));
      const storedHolderCount =
        looksLikeLowerBoundStoredHolderCount({
          chainType: token.chainType,
          storedHolderCount: rawStoredHolderCount,
          observedTopHolderCount,
          liveHolderCount: distributionHolderCount,
          liveHolderCountSource: distributionHolderCountSource,
        })
          ? null
          : rawStoredHolderCount;
      const unresolvedDistributionHolderCount =
        token.chainType === "solana" && distributionHolderCountSource === "largest_accounts"
          ? distributionHolderCount
          : null;
      const holderCount =
        token.chainType === "solana"
          ? hasResolvedHolderCount(distributionHolderCount, distributionHolderCountSource)
            ? distributionHolderCount
            : pickFirstPositiveMetric(storedHolderCount, unresolvedDistributionHolderCount)
          : roundCount(pickFirstPositiveMetric(token.holderCount));
      const holderCountSource =
        token.chainType === "solana"
          ? hasResolvedHolderCount(distributionHolderCount, distributionHolderCountSource)
            ? distributionHolderCountSource
            : holderCount !== null
              ? storedHolderCount !== null
                ? "stored"
                : unresolvedDistributionHolderCount !== null
                  ? distributionHolderCountSource ?? null
                  : null
              : null
          : holderCount !== null
            ? "stored"
            : null;
      const largestHolderPct =
        token.chainType === "solana"
          ? roundMetric(pickFirstFiniteMetric(distributionSnapshot?.largestHolderPct, token.largestHolderPct))
          : roundMetric(pickFirstFiniteMetric(token.largestHolderPct));
      const top10HolderPct =
        token.chainType === "solana"
          ? roundMetric(pickFirstFiniteMetric(distributionSnapshot?.top10HolderPct, token.top10HolderPct))
          : roundMetric(pickFirstFiniteMetric(token.top10HolderPct));
      const deployerSupplyPct =
        token.chainType === "solana"
          ? roundMetric(pickFirstFiniteMetric(distributionSnapshot?.deployerSupplyPct, token.deployerSupplyPct))
          : roundMetric(pickFirstFiniteMetric(token.deployerSupplyPct));
      const bundledWalletCount =
        token.chainType === "solana"
          ? roundCount(pickFirstFiniteMetric(distributionSnapshot?.bundledWalletCount, token.bundledWalletCount))
          : roundCount(pickFirstFiniteMetric(token.bundledWalletCount));
      const estimatedBundledSupplyPct =
        token.chainType === "solana"
          ? roundMetric(
              pickFirstFiniteMetric(distributionSnapshot?.estimatedBundledSupplyPct, token.estimatedBundledSupplyPct)
            )
          : roundMetric(pickFirstFiniteMetric(token.estimatedBundledSupplyPct));
      const tokenRiskScore =
        token.chainType === "solana"
          ? roundMetric(pickFirstFiniteMetric(distributionSnapshot?.tokenRiskScore, token.tokenRiskScore))
          : roundMetric(pickFirstFiniteMetric(token.tokenRiskScore));
      const bundleRiskLabel =
        token.chainType === "solana"
          ? distributionSnapshot?.bundleRiskLabel ?? token.bundleRiskLabel ?? null
          : token.bundleRiskLabel ?? null;

      return {
        marketCap: roundMetric(pickFirstPositiveMetric(marketSnapshot.mcap)),
        liquidity: roundMetric(pickFirstPositiveMetric(marketSnapshot.liquidityUsd, token.liquidity)),
        volume24h: roundMetric(pickFirstPositiveMetric(marketSnapshot.volume24hUsd, token.volume24h)),
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
        dexscreenerUrl: marketSnapshot.dexscreenerUrl ?? token.dexscreenerUrl ?? null,
        pairAddress: marketSnapshot.pairAddress ?? token.pairAddress ?? null,
        dexId: marketSnapshot.dexId ?? token.dexId ?? null,
        imageUrl: marketSnapshot.tokenImage ?? token.imageUrl ?? null,
        symbol: marketSnapshot.tokenSymbol ?? token.symbol ?? null,
        name: marketSnapshot.tokenName ?? token.name ?? null,
        priceUsd: roundMetric(marketSnapshot.priceUsd ?? null),
        priceChange24hPct: roundMetric(marketSnapshot.priceChange24hPct ?? null),
        buys24h: roundCount(marketSnapshot.buys24h ?? null),
        sells24h: roundCount(marketSnapshot.sells24h ?? null),
        updatedAt: new Date().toISOString(),
      } satisfies TokenLivePayload;
    })();
    tokenLiveRouteInFlight.set(cacheKey, request);
  }

  try {
    const payload = await request;
    tokenLiveRouteCache.set(cacheKey, {
      data: payload,
      expiresAtMs: Date.now() + TOKEN_LIVE_ROUTE_CACHE_TTL_MS,
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
  const shouldUseCache = shouldUseTokenRouteCache(viewer?.id ?? null);
  const cacheKey = shouldUseCache ? buildTokenRouteCacheKey(tokenAddress, null) : null;
  const cached = cacheKey ? await readBestEffortTokenRouteCache(cacheKey) : null;
  if (isPersonalized) {
    c.header("Vary", "Cookie");
  }

  let overview;
  try {
    overview = await getTokenOverviewByAddress(tokenAddress, viewer?.id ?? null);
  } catch (error) {
    if (cached) {
      console.warn("[tokens] serving stale cached token overview", {
        tokenAddress,
        viewerId: viewer?.id ?? null,
        message: error instanceof Error ? error.message : String(error),
      });
      return c.json({ data: cached }, 200, buildTokenRouteHeaders(isPersonalized));
    }
    throw error;
  }

  if (!overview) {
    return c.json({ error: { message: "Token not found", code: "NOT_FOUND" } }, 404);
  }

  const data = isMeaningfulTokenRoutePayload(overview.token) ? overview.token : cached ?? overview.token;
  if (cacheKey && isMeaningfulTokenRoutePayload(data)) {
    writeBestEffortTokenRouteCache(cacheKey, data);
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
