import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { type AuthVariables, requireAuth, requireNotBanned } from "../auth.js";
import { cacheGetJson, cacheSetJson, redisDelete } from "../lib/redis.js";
import { prisma } from "../prisma.js";
import {
  getTokenOverviewByAddress,
  invalidateViewerSocialCaches,
  listTokenCallsByAddress,
} from "../services/intelligence/engine.js";

export const tokensRouter = new Hono<{ Variables: AuthVariables }>();

type TokenRoutePayload = NonNullable<Awaited<ReturnType<typeof getTokenOverviewByAddress>>>["token"];
type TokenRouteCacheEntry<T> = {
  data: T;
  expiresAtMs: number;
};

const TOKEN_ROUTE_CACHE_TTL_MS = process.env.NODE_ENV === "production" ? 2 * 60_000 : 30_000;
const tokenRouteCache = new Map<string, TokenRouteCacheEntry<TokenRoutePayload>>();

const TokenAddressParamSchema = z.object({
  tokenAddress: z.string().trim().min(1),
});

function buildTokenRouteCacheKey(tokenAddress: string, viewerId: string | null): string {
  return `route:token:${viewerId ?? "anonymous"}:${tokenAddress.trim().toLowerCase()}`;
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

  return hasSignals || hasMarketData || hasChart || token.recentCalls.length > 0 || token.timeline.length > 0;
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

tokensRouter.get("/:tokenAddress", zValidator("param", TokenAddressParamSchema), async (c) => {
  const { tokenAddress } = c.req.valid("param");
  const viewer = c.get("user");
  const isPersonalized = Boolean(viewer?.id);
  const shouldUseCache = shouldUseTokenRouteCache(viewer?.id ?? null);
  const cacheKey = shouldUseCache ? buildTokenRouteCacheKey(tokenAddress, null) : null;
  const cached = cacheKey ? await readBestEffortTokenRouteCache(cacheKey) : null;
  c.header("Vary", "Cookie");

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
  const calls = await listTokenCallsByAddress(tokenAddress, viewer?.id ?? null);
  c.header("Vary", "Cookie");
  return c.json({ data: calls }, 200, buildTokenRouteHeaders(Boolean(viewer?.id)));
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
