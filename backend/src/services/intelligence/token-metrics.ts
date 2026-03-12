import { getCachedMarketCapSnapshot } from "../marketcap.js";
import { computeTokenRiskScore, determineBundleRiskLabel } from "./scoring.js";

export type DexTokenStats = {
  symbol: string | null;
  name: string | null;
  imageUrl: string | null;
  dexscreenerUrl: string | null;
  pairAddress: string | null;
  dexId: string | null;
  priceUsd: number | null;
  marketCap: number | null;
  liquidityUsd: number | null;
  volume24hUsd: number | null;
  priceChange24hPct: number | null;
  buys24h: number | null;
  sells24h: number | null;
};

export type BundleClusterSnapshot = {
  clusterLabel: string;
  walletCount: number;
  estimatedSupplyPct: number;
  evidenceJson: {
    bucket: string;
    holderPcts: number[];
  };
};

export type TokenHolderSnapshot = {
  address: string;
  amount: number | null;
  supplyPct: number;
};

export type TokenDistributionSnapshot = {
  holderCount: number | null;
  holderCountSource: "rpc_scan" | "birdeye" | "largest_accounts" | null;
  largestHolderPct: number | null;
  top10HolderPct: number | null;
  topHolders: TokenHolderSnapshot[];
  deployerSupplyPct: number | null;
  bundledWalletCount: number;
  bundledClusterCount: number;
  estimatedBundledSupplyPct: number;
  tokenRiskScore: number;
  bundleRiskLabel: string;
  clusters: BundleClusterSnapshot[];
};

type RpcTokenSupplyResult = {
  value?: {
    amount?: string;
    decimals?: number;
  };
};

type RpcLargestAccountsResult = {
  value?: Array<{
    address?: string;
    amount?: string;
    decimals?: number;
    uiAmount?: number | null;
    uiAmountString?: string | null;
  }>;
};

type RpcProgramAccountResult = Array<unknown>;

const SOLANA_TOKEN_PROGRAM_ID = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const DEFAULT_SOLANA_RPC_URL = "https://api.mainnet-beta.solana.com";
const BIRDEYE_API_KEY = process.env.BIRDEYE_API_KEY?.trim() || "";
const HOLDER_SCAN_RPC_TIMEOUT_MS = process.env.NODE_ENV === "production" ? 8_000 : 12_000;
const TOKEN_DISTRIBUTION_CACHE_TTL_MS = process.env.NODE_ENV === "production" ? 20_000 : 5_000;
const SOLANA_RPC_URLS = [
  process.env.HELIUS_RPC_URL?.trim() || null,
  process.env.HELIUS_RPC_ENDPOINT?.trim() || null,
  process.env.SOLANA_RPC_URL?.trim() || null,
  DEFAULT_SOLANA_RPC_URL,
].filter((value, index, collection): value is string =>
  typeof value === "string" &&
  value.length > 0 &&
  collection.indexOf(value) === index
);
const tokenDistributionCache = new Map<
  string,
  { value: TokenDistributionSnapshot | null; expiresAtMs: number }
>();
const tokenDistributionInFlight = new Map<string, Promise<TokenDistributionSnapshot | null>>();

function hasResolvedHolderCount(snapshot: TokenDistributionSnapshot | null | undefined): boolean {
  return Boolean(
    snapshot &&
    typeof snapshot.holderCount === "number" &&
    Number.isFinite(snapshot.holderCount) &&
    snapshot.holderCount > 0 &&
    snapshot.holderCountSource !== "largest_accounts" &&
    snapshot.holderCountSource !== null
  );
}

function cloneDistributionSnapshot(
  snapshot: TokenDistributionSnapshot | null
): TokenDistributionSnapshot | null {
  if (!snapshot) return null;

  return {
    ...snapshot,
    topHolders: snapshot.topHolders.map((holder) => ({ ...holder })),
    clusters: snapshot.clusters.map((cluster) => ({
      ...cluster,
      evidenceJson: {
        bucket: cluster.evidenceJson.bucket,
        holderPcts: [...cluster.evidenceJson.holderPcts],
      },
    })),
  };
}

export async function fetchDexTokenStats(
  address: string,
  chainType: string | null
): Promise<DexTokenStats | null> {
  const snapshot = await getCachedMarketCapSnapshot(address, chainType);
  if (
    snapshot.mcap === null &&
    !snapshot.tokenName &&
    !snapshot.tokenSymbol &&
    !snapshot.tokenImage &&
    !snapshot.dexscreenerUrl
  ) {
    return null;
  }

  return {
    symbol: snapshot.tokenSymbol ?? null,
    name: snapshot.tokenName ?? null,
    imageUrl: snapshot.tokenImage ?? null,
    dexscreenerUrl: snapshot.dexscreenerUrl ?? null,
    pairAddress: snapshot.pairAddress ?? null,
    dexId: snapshot.dexId ?? null,
    priceUsd: snapshot.priceUsd ?? null,
    marketCap: snapshot.mcap,
    liquidityUsd: snapshot.liquidityUsd ?? null,
    volume24hUsd: snapshot.volume24hUsd ?? null,
    priceChange24hPct: snapshot.priceChange24hPct ?? null,
    buys24h: snapshot.buys24h ?? null,
    sells24h: snapshot.sells24h ?? null,
  };
}

async function rpcCall<T>(
  method: string,
  params: unknown[],
  options?: { timeoutMs?: number }
): Promise<T | null> {
  if (SOLANA_RPC_URLS.length === 0) return null;

  for (const endpoint of SOLANA_RPC_URLS) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), options?.timeoutMs ?? 6_000);
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: `intelligence:${method}`,
          method,
          params,
        }),
        signal: controller.signal,
      });
      if (!response.ok) continue;
      const payload = (await response.json()) as { result?: T; error?: unknown };
      if (payload.error) continue;
      return payload.result ?? null;
    } catch {
      continue;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  return null;
}

function searchForNumericField(
  value: unknown,
  fieldNames: Set<string>,
  depth = 0
): number | null {
  if (depth > 4 || value === null || value === undefined) return null;
  if (typeof value === "number" && Number.isFinite(value)) {
    return value > 0 ? value : null;
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = searchForNumericField(item, fieldNames, depth + 1);
      if (found !== null) return found;
    }
    return null;
  }
  if (typeof value !== "object") return null;

  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    if (fieldNames.has(key.toLowerCase())) {
      const direct = searchForNumericField(nested, fieldNames, depth + 1);
      if (direct !== null) return direct;
    }
  }

  for (const nested of Object.values(value as Record<string, unknown>)) {
    const found = searchForNumericField(nested, fieldNames, depth + 1);
    if (found !== null) return found;
  }

  return null;
}

async function fetchBirdeyeHolderCount(address: string): Promise<number | null> {
  if (!BIRDEYE_API_KEY) return null;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 3_800);
  try {
    const response = await fetch(
      `https://public-api.birdeye.so/defi/token_overview?address=${encodeURIComponent(address)}`,
      {
        method: "GET",
        headers: {
          accept: "application/json",
          "x-chain": "solana",
          "X-API-KEY": BIRDEYE_API_KEY,
        },
        signal: controller.signal,
      }
    );
    if (!response.ok) return null;
    const payload = (await response.json()) as unknown;
    return searchForNumericField(
      payload,
      new Set(["holder", "holders", "holdercount", "holder_count"])
    );
  } catch {
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}

function uiAmountToNumber(input: {
  uiAmount?: number | null;
  uiAmountString?: string | null;
  amount?: string | null;
  decimals?: number | null;
}): number | null {
  if (typeof input.uiAmount === "number" && Number.isFinite(input.uiAmount)) {
    return input.uiAmount;
  }
  if (typeof input.uiAmountString === "string") {
    const parsed = Number(input.uiAmountString);
    if (Number.isFinite(parsed)) return parsed;
  }
  if (typeof input.amount === "string") {
    const rawAmount = Number(input.amount);
    const decimals = typeof input.decimals === "number" ? input.decimals : 0;
    if (Number.isFinite(rawAmount)) {
      return rawAmount / Math.pow(10, decimals);
    }
  }
  return null;
}

function buildBundleClusters(holderPcts: number[]): BundleClusterSnapshot[] {
  const buckets = [
    { key: ">=8%", min: 8, max: Number.POSITIVE_INFINITY },
    { key: "4-8%", min: 4, max: 8 },
    { key: "2-4%", min: 2, max: 4 },
    { key: "1.5-2%", min: 1.5, max: 2 },
  ];

  const clusters: BundleClusterSnapshot[] = [];
  let labelIndex = 0;

  for (const bucket of buckets) {
    const members = holderPcts.filter((pct) => pct >= bucket.min && pct < bucket.max);
    if (members.length === 0) continue;
    const clusterLabel = `Cluster ${String.fromCharCode(65 + labelIndex)}`;
    labelIndex += 1;
    clusters.push({
      clusterLabel,
      walletCount: members.length,
      estimatedSupplyPct: Math.round(members.reduce((sum, pct) => sum + pct, 0) * 100) / 100,
      evidenceJson: {
        bucket: bucket.key,
        holderPcts: members.map((pct) => Math.round(pct * 100) / 100),
      },
    });
  }

  return clusters;
}

export async function analyzeSolanaTokenDistribution(
  mintAddress: string,
  fallbackLiquidityUsd?: number | null
): Promise<TokenDistributionSnapshot | null> {
  const cacheKey = mintAddress.trim();
  const now = Date.now();
  const cached = tokenDistributionCache.get(cacheKey);
  if (cached && cached.expiresAtMs > now) {
    return cloneDistributionSnapshot(cached.value);
  }

  const inFlight = tokenDistributionInFlight.get(cacheKey);
  if (inFlight) {
    return cloneDistributionSnapshot(await inFlight);
  }

  const request = (async (): Promise<TokenDistributionSnapshot | null> => {
    const [supplyResult, largestAccountsResult, holderAccountsResult, birdeyeHolderCount] = await Promise.all([
      rpcCall<RpcTokenSupplyResult>("getTokenSupply", [mintAddress]),
      rpcCall<RpcLargestAccountsResult>("getTokenLargestAccounts", [mintAddress]),
      rpcCall<RpcProgramAccountResult>("getProgramAccounts", [
        SOLANA_TOKEN_PROGRAM_ID,
        {
          encoding: "base64",
          filters: [
            { dataSize: 165 },
            { memcmp: { offset: 0, bytes: mintAddress } },
          ],
          dataSlice: { offset: 0, length: 0 },
        },
      ], { timeoutMs: HOLDER_SCAN_RPC_TIMEOUT_MS }),
      fetchBirdeyeHolderCount(mintAddress),
    ]);

    const totalSupply = uiAmountToNumber({
      amount: supplyResult?.value?.amount ?? null,
      decimals: supplyResult?.value?.decimals ?? null,
    });

    const largestAccounts = largestAccountsResult?.value ?? [];
    const topHolders: TokenHolderSnapshot[] =
      totalSupply && totalSupply > 0
        ? largestAccounts
            .map((holder): TokenHolderSnapshot | null => {
              const address = typeof holder.address === "string" ? holder.address.trim() : "";
              const uiAmount = uiAmountToNumber(holder);
              if (!address || uiAmount === null || uiAmount <= 0) return null;
              return {
                address,
                amount: uiAmount,
                supplyPct: Math.round(((uiAmount / totalSupply) * 100) * 100) / 100,
              };
            })
            .filter((holder): holder is TokenHolderSnapshot => holder !== null)
        : [];
    const holderPcts = topHolders.map((holder) => holder.supplyPct);

    const largestHolderPct =
      holderPcts.length > 0 ? Math.round(holderPcts[0]! * 100) / 100 : null;
    const top10HolderPct =
      holderPcts.length > 0
        ? Math.round(holderPcts.slice(0, 10).reduce((sum, pct) => sum + pct, 0) * 100) / 100
        : null;

    const suspiciousHolderPcts = holderPcts.filter((pct, index) => {
      if (index === 0 && fallbackLiquidityUsd && fallbackLiquidityUsd > 0 && pct > 12) {
        return false;
      }
      return pct >= 1.5;
    });

    const clusters = buildBundleClusters(suspiciousHolderPcts);
    const estimatedBundledSupplyPct = Math.round(
      clusters.reduce((sum, cluster) => sum + cluster.estimatedSupplyPct, 0) * 100
    ) / 100;

    const tokenRiskScore = computeTokenRiskScore({
      estimatedBundledSupplyPct,
      bundledClusterCount: clusters.length,
      largestHolderPct,
      top10HolderPct,
      deployerSupplyPct: largestHolderPct,
    });

    let holderCount: number | null = null;
    let holderCountSource: TokenDistributionSnapshot["holderCountSource"] = null;
    const rpcHolderCount =
      Array.isArray(holderAccountsResult) && holderAccountsResult.length > 0
        ? holderAccountsResult.length
        : 0;
    const rpcCountLooksTruncated =
      rpcHolderCount > 0 &&
      topHolders.length >= 20 &&
      rpcHolderCount <= topHolders.length;

    if (!rpcCountLooksTruncated && rpcHolderCount > 0) {
      holderCount = rpcHolderCount;
      holderCountSource = "rpc_scan";
    } else if (
      typeof birdeyeHolderCount === "number" &&
      Number.isFinite(birdeyeHolderCount) &&
      birdeyeHolderCount > 0
    ) {
      holderCount = Math.round(birdeyeHolderCount);
      holderCountSource = "birdeye";
    } else if (topHolders.length > 0) {
      holderCount = topHolders.length;
      holderCountSource = "largest_accounts";
    }

    const nextSnapshot: TokenDistributionSnapshot = {
      holderCount,
      holderCountSource,
      largestHolderPct,
      top10HolderPct,
      topHolders,
      deployerSupplyPct: largestHolderPct,
      bundledWalletCount: suspiciousHolderPcts.length,
      bundledClusterCount: clusters.length,
      estimatedBundledSupplyPct,
      tokenRiskScore,
      bundleRiskLabel: determineBundleRiskLabel(tokenRiskScore),
      clusters,
    };

    const previousSnapshot = cached?.value ?? null;
    if (hasResolvedHolderCount(previousSnapshot) && !hasResolvedHolderCount(nextSnapshot)) {
      nextSnapshot.holderCount = previousSnapshot?.holderCount ?? null;
      nextSnapshot.holderCountSource = previousSnapshot?.holderCountSource ?? null;
    }

    return nextSnapshot;
  })()
    .then((snapshot) => {
      tokenDistributionCache.set(cacheKey, {
        value: cloneDistributionSnapshot(snapshot),
        expiresAtMs: Date.now() + TOKEN_DISTRIBUTION_CACHE_TTL_MS,
      });
      return snapshot;
    })
    .finally(() => {
      tokenDistributionInFlight.delete(cacheKey);
    });

  tokenDistributionInFlight.set(cacheKey, request);
  return cloneDistributionSnapshot(await request);
}
