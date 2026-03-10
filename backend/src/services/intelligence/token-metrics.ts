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

export type TokenDistributionSnapshot = {
  holderCount: number | null;
  largestHolderPct: number | null;
  top10HolderPct: number | null;
  deployerSupplyPct: number | null;
  bundledWalletCount: number;
  bundledClusterCount: number;
  estimatedBundledSupplyPct: number;
  tokenRiskScore: number;
  bundleRiskLabel: string;
  clusters: BundleClusterSnapshot[];
};

type DexTokenRef = {
  address?: string;
  name?: string;
  symbol?: string;
  icon?: string;
  logoURI?: string;
};

type DexPair = {
  chainId?: string;
  dexId?: string;
  url?: string;
  pairAddress?: string;
  baseToken?: DexTokenRef;
  quoteToken?: DexTokenRef;
  priceUsd?: string | number;
  fdv?: string | number;
  marketCap?: string | number;
  liquidity?: {
    usd?: string | number;
  };
  volume?: {
    h24?: string | number;
  };
  priceChange?: {
    h24?: string | number;
  };
  txns?: {
    h24?: {
      buys?: string | number;
      sells?: string | number;
    };
  };
  info?: {
    imageUrl?: string;
    header?: string;
    openGraph?: string;
  };
};

type DexPayload =
  | DexPair[]
  | {
      pairs?: DexPair[] | null;
    }
  | null;

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

function normalizeDexAddress(value: string | null | undefined): string | null {
  if (!value) return null;
  const normalized = value.trim().toLowerCase();
  return normalized.length > 0 ? normalized : null;
}

function normalizeDexChain(value: string | null | undefined): string | null {
  if (!value) return null;
  const normalized = value.trim().toLowerCase();
  if (!normalized) return null;
  if (normalized === "eth" || normalized === "evm") return "ethereum";
  if (normalized === "sol") return "solana";
  return normalized;
}

function toFiniteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function pickDexTokenFromPair(pair: DexPair | null, address: string): DexTokenRef | null {
  if (!pair) return null;
  const normalizedAddress = normalizeDexAddress(address);
  if (normalizedAddress && normalizeDexAddress(pair.baseToken?.address) === normalizedAddress) {
    return pair.baseToken ?? null;
  }
  if (normalizedAddress && normalizeDexAddress(pair.quoteToken?.address) === normalizedAddress) {
    return pair.quoteToken ?? null;
  }
  return pair.baseToken ?? pair.quoteToken ?? null;
}

function pickDexPair(payload: DexPayload, address: string, chainType: string | null): DexPair | null {
  const pairs = Array.isArray(payload) ? payload : (payload?.pairs ?? []);
  if (!pairs.length) return null;

  const normalizedAddress = normalizeDexAddress(address);
  const expectedChain = normalizeDexChain(chainType);

  const ranked = [...pairs].sort((left, right) => {
    const scorePair = (pair: DexPair): number => {
      let score = 0;
      const baseMatch = normalizeDexAddress(pair.baseToken?.address) === normalizedAddress;
      const quoteMatch = normalizeDexAddress(pair.quoteToken?.address) === normalizedAddress;
      const chainMatch = expectedChain !== null && normalizeDexChain(pair.chainId) === expectedChain;
      if (baseMatch && chainMatch) score += 120;
      else if (quoteMatch && chainMatch) score += 100;
      else if (baseMatch) score += 75;
      else if (quoteMatch) score += 55;
      if (chainMatch) score += 20;
      if (pair.url?.trim()) score += 5;
      return score;
    };

    const scoreDelta = scorePair(right) - scorePair(left);
    if (scoreDelta !== 0) return scoreDelta;
    return (toFiniteNumber(right.liquidity?.usd) ?? 0) - (toFiniteNumber(left.liquidity?.usd) ?? 0);
  });

  return ranked[0] ?? null;
}

function pickDexImageUrl(pair: DexPair | null, token: DexTokenRef | null): string | null {
  const candidates = [
    token?.icon,
    token?.logoURI,
    pair?.info?.imageUrl,
    pair?.info?.header,
    pair?.info?.openGraph,
  ];

  for (const candidate of candidates) {
    const trimmed = candidate?.trim();
    if (trimmed) return trimmed;
  }

  return null;
}

export async function fetchDexTokenStats(
  address: string,
  chainType: string | null
): Promise<DexTokenStats | null> {
  const chain = chainType === "solana" ? "solana" : "ethereum";
  const endpoints = [
    `https://api.dexscreener.com/tokens/v1/${chain}/${address}`,
    `https://api.dexscreener.com/latest/dex/tokens/${address}`,
  ];

  for (const endpoint of endpoints) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 4_500);
    try {
      const response = await fetch(endpoint, {
        headers: { Accept: "application/json" },
        signal: controller.signal,
      });
      if (!response.ok) continue;
      const payload = (await response.json()) as DexPayload;
      const pair = pickDexPair(payload, address, chainType);
      if (!pair) continue;
      const token = pickDexTokenFromPair(pair, address);

      return {
        symbol: token?.symbol?.trim() || pair.baseToken?.symbol?.trim() || null,
        name: token?.name?.trim() || pair.baseToken?.name?.trim() || null,
        imageUrl: pickDexImageUrl(pair, token),
        dexscreenerUrl: pair.url?.trim() || null,
        pairAddress: pair.pairAddress?.trim() || null,
        dexId: pair.dexId?.trim() || null,
        priceUsd: toFiniteNumber(pair.priceUsd),
        marketCap: toFiniteNumber(pair.marketCap) ?? toFiniteNumber(pair.fdv),
        liquidityUsd: toFiniteNumber(pair.liquidity?.usd),
        volume24hUsd: toFiniteNumber(pair.volume?.h24),
        priceChange24hPct: toFiniteNumber(pair.priceChange?.h24),
        buys24h: toFiniteNumber(pair.txns?.h24?.buys),
        sells24h: toFiniteNumber(pair.txns?.h24?.sells),
      };
    } catch {
      continue;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  return null;
}

async function rpcCall<T>(method: string, params: unknown[]): Promise<T | null> {
  if (SOLANA_RPC_URLS.length === 0) return null;

  for (const endpoint of SOLANA_RPC_URLS) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 6_000);
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
  const [supplyResult, largestAccountsResult, holderAccountsResult] = await Promise.all([
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
    ]),
  ]);

  const totalSupply = uiAmountToNumber({
    amount: supplyResult?.value?.amount ?? null,
    decimals: supplyResult?.value?.decimals ?? null,
  });

  const largestAccounts = largestAccountsResult?.value ?? [];
  const holderPcts = totalSupply && totalSupply > 0
    ? largestAccounts
        .map((holder) => {
          const uiAmount = uiAmountToNumber(holder);
          if (uiAmount === null || uiAmount <= 0) return null;
          return (uiAmount / totalSupply) * 100;
        })
        .filter((pct): pct is number => pct !== null)
    : [];

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

  return {
    holderCount: Array.isArray(holderAccountsResult) ? holderAccountsResult.length : null,
    largestHolderPct,
    top10HolderPct,
    deployerSupplyPct: largestHolderPct,
    bundledWalletCount: suspiciousHolderPcts.length,
    bundledClusterCount: clusters.length,
    estimatedBundledSupplyPct,
    tokenRiskScore,
    bundleRiskLabel: determineBundleRiskLabel(tokenRiskScore),
    clusters,
  };
}
