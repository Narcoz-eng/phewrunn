import { api } from "@/lib/api";
import { resolveEstimatedBundledSupplyPct } from "@/lib/bundle-intelligence";
import type { ReactionCounts, TokenBundleCluster } from "@/types";
import type { TokenIntelligenceSnapshot } from "@/lib/token-intelligence-cache";

export type TokenLiveIntelligencePayload = {
  marketCap: number | null;
  liquidity: number | null;
  volume24h: number | null;
  holderCount: number | null;
  holderCountSource?: "stored" | "helius" | "rpc_scan" | "birdeye" | "largest_accounts" | null;
  largestHolderPct: number | null;
  top10HolderPct: number | null;
  deployerSupplyPct: number | null;
  bundledWalletCount: number | null;
  estimatedBundledSupplyPct: number | null;
  bundleRiskLabel: string | null;
  tokenRiskScore: number | null;
  topHolders: unknown[];
  devWallet: unknown | null;
  bundleClusters: TokenBundleCluster[];
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
  sentiment: {
    score: number;
    reactions: ReactionCounts;
    bullishPct: number;
    bearishPct: number;
  };
  lastIntelligenceAt: string | null;
  priceUsd: number | null;
  priceChange24hPct: number | null;
  buys24h: number | null;
  sells24h: number | null;
  bundleScanCompletedAt: string | null;
  updatedAt: string;
};

const TOKEN_LIVE_RESOLVED_CACHE_TTL_MS = import.meta.env.PROD ? 60_000 : 12_000;
const TOKEN_LIVE_PENDING_CACHE_TTL_MS = import.meta.env.PROD ? 30_000 : 8_000;

const tokenLiveCache = new Map<
  string,
  {
    data: TokenLiveIntelligencePayload;
    expiresAtMs: number;
    staleUntilMs: number;
  }
>();
const tokenLiveInFlight = new Map<string, Promise<TokenLiveIntelligencePayload>>();
const tokenLiveBackoffUntil = new Map<string, number>();

function normalizeTokenAddress(address: string): string {
  return address.trim().toLowerCase();
}

function buildTokenLiveCacheKey(address: string, freshBundle: boolean): string {
  return `${normalizeTokenAddress(address)}:${freshBundle ? "fresh" : "default"}`;
}

function readCachedTokenLivePayload(cacheKey: string): TokenLiveIntelligencePayload | null {
  const cached = tokenLiveCache.get(cacheKey);
  if (!cached) {
    return null;
  }
  if (cached.expiresAtMs <= Date.now()) {
    tokenLiveCache.delete(cacheKey);
    return null;
  }
  return cached.data;
}

function readStaleTokenLivePayload(cacheKey: string): TokenLiveIntelligencePayload | null {
  const cached = tokenLiveCache.get(cacheKey);
  if (!cached || cached.staleUntilMs <= Date.now()) return null;
  return cached.data;
}

function hasResolvedHolderCount(
  holderCount: number | null | undefined,
  holderCountSource: TokenLiveIntelligencePayload["holderCountSource"]
): boolean {
  return (
    typeof holderCount === "number" &&
    Number.isFinite(holderCount) &&
    holderCount > 0 &&
    holderCountSource !== "largest_accounts" &&
    holderCountSource !== null &&
    holderCountSource !== undefined &&
    !(
      (holderCountSource === "helius" ||
        holderCountSource === "rpc_scan" ||
        holderCountSource === "birdeye" ||
        holderCountSource === "stored") &&
      Math.round(holderCount) === 1000
    )
  );
}

function hasResolvedHolderRoleFields(holder: unknown): boolean {
  if (!holder || typeof holder !== "object") {
    return false;
  }

  const candidate = holder as {
    badges?: unknown;
    devRole?: unknown;
  };

  const badges =
    Array.isArray(candidate.badges) &&
    candidate.badges.some((badge) => typeof badge === "string" && badge.trim().length > 0);
  const devRole = typeof candidate.devRole === "string" && candidate.devRole.trim().length > 0;
  return badges || devRole;
}

function hasResolvedHolderRoleIntelligence(payload: TokenLiveIntelligencePayload): boolean {
  return payload.topHolders.some((holder) => hasResolvedHolderRoleFields(holder)) || hasResolvedHolderRoleFields(payload.devWallet);
}

function isPendingLiveDistributionPayload(payload: TokenLiveIntelligencePayload): boolean {
  // If the backend explicitly set bundleScanCompletedAt, trust that the scan
  // is done — the backend's resolved criteria are broader than what the client
  // can inspect (e.g. it checks largestHolderPct, deployerSupplyPct, etc.).
  if (payload.bundleScanCompletedAt) {
    return false;
  }
  return (
    payload.topHolders.length === 0 ||
    !hasResolvedHolderCount(payload.holderCount, payload.holderCountSource)
  );
}

export async function getTokenLiveIntelligence(
  address: string,
  options?: { freshBundle?: boolean; timeoutMs?: number; cacheTtlMs?: number }
): Promise<TokenLiveIntelligencePayload> {
  const freshBundle = Boolean(options?.freshBundle);
  const cacheKey = buildTokenLiveCacheKey(address, freshBundle);
  const cached = readCachedTokenLivePayload(cacheKey);
  if (cached) {
    return cached;
  }
  const stale = readStaleTokenLivePayload(cacheKey);
  if ((tokenLiveBackoffUntil.get(cacheKey) ?? 0) > Date.now() && stale) {
    return stale;
  }

  const inFlight = tokenLiveInFlight.get(cacheKey);
  if (inFlight) {
    return inFlight;
  }

  const request = (async () => {
    const endpoint = `/api/tokens/${address}/live${freshBundle ? "?fresh=1" : ""}`;
    const response = await api.raw(endpoint, {
      method: "GET",
      cache: "no-store",
      timeout: options?.timeoutMs ?? (freshBundle ? 12_000 : 9_000),
    });

    if (!response.ok) {
      const payload = await response.text().catch(() => "");
      if (response.status === 429 || response.status >= 500) {
        tokenLiveBackoffUntil.set(cacheKey, Date.now() + (response.status === 429 ? 60_000 : 20_000));
        const stalePayload = readStaleTokenLivePayload(cacheKey);
        if (stalePayload) return stalePayload;
      }
      throw new Error(payload || `Live token request failed (${response.status})`);
    }

    const payload = (await response.json().catch(() => null)) as
      | {
          data?: TokenLiveIntelligencePayload;
        }
      | null;

    if (!payload?.data) {
      throw new Error("Live token payload missing");
    }

    const resolvedTtlMs = (() => {
          const defaultTtlMs = isPendingLiveDistributionPayload(payload.data)
            ? TOKEN_LIVE_PENDING_CACHE_TTL_MS
            : TOKEN_LIVE_RESOLVED_CACHE_TTL_MS;
          if (
            typeof options?.cacheTtlMs === "number" &&
            Number.isFinite(options.cacheTtlMs) &&
            options.cacheTtlMs > 0
          ) {
            return Math.max(defaultTtlMs, Math.round(options.cacheTtlMs));
          }
          return defaultTtlMs;
        })();
    tokenLiveBackoffUntil.delete(cacheKey);
    tokenLiveCache.set(cacheKey, {
      data: payload.data,
      expiresAtMs: Date.now() + resolvedTtlMs,
      staleUntilMs: Date.now() + Math.max(5 * 60_000, resolvedTtlMs),
    });

    return payload.data;
  })().catch((error) => {
    const stalePayload = readStaleTokenLivePayload(cacheKey);
    if (stalePayload) return stalePayload;
    throw error;
  }).finally(() => {
    tokenLiveInFlight.delete(cacheKey);
  });

  tokenLiveInFlight.set(cacheKey, request);
  return request;
}

export function buildTokenIntelligenceSnapshotFromLivePayload(
  address: string,
  payload: TokenLiveIntelligencePayload
): TokenIntelligenceSnapshot {
  const estimatedBundledSupplyPct = resolveEstimatedBundledSupplyPct({
    estimatedBundledSupplyPct: payload.estimatedBundledSupplyPct,
    bundleClusters: payload.bundleClusters,
  });

  return {
    address,
    symbol: payload.symbol,
    name: payload.name,
    imageUrl: payload.imageUrl,
    dexscreenerUrl: payload.dexscreenerUrl,
    bundleScanCompletedAt: payload.bundleScanCompletedAt,
    liquidity: payload.liquidity,
    volume24h: payload.volume24h,
    holderCount: payload.holderCount,
    largestHolderPct: payload.largestHolderPct,
    top10HolderPct: payload.top10HolderPct,
    bundledWalletCount: payload.bundledWalletCount,
    estimatedBundledSupplyPct,
    bundleRiskLabel: payload.bundleRiskLabel,
    tokenRiskScore: payload.tokenRiskScore,
    sentimentScore: payload.sentimentScore,
    confidenceScore: payload.confidenceScore,
    hotAlphaScore: payload.hotAlphaScore,
    earlyRunnerScore: payload.earlyRunnerScore,
    highConvictionScore: payload.highConvictionScore,
    marketHealthScore: payload.marketHealthScore,
    setupQualityScore: payload.setupQualityScore,
    opportunityScore: payload.opportunityScore,
    dataReliabilityScore: payload.dataReliabilityScore,
    activityStatus: payload.activityStatus,
    activityStatusLabel: payload.activityStatusLabel,
    isTradable: payload.isTradable,
    bullishSignalsSuppressed: payload.bullishSignalsSuppressed,
    lastIntelligenceAt: payload.lastIntelligenceAt ?? payload.bundleScanCompletedAt ?? payload.updatedAt ?? null,
    bundleClusters: payload.bundleClusters ?? [],
  };
}
