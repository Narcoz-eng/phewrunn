import { getCachedMarketCapSnapshot } from "../marketcap.js";
import {
  getHeliusAuthorityAssetSummary,
  getHeliusTokenAccountsForMint,
  getHeliusTokenMetadataForMint,
  getWalletTradeSnapshotForSolanaToken,
  getWalletActivityProfile,
} from "../helius.js";
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

export type TokenHolderBadge =
  | "dev_wallet"
  | "fresh_wallet"
  | "high_volume_trader"
  | "whale"
  | "serial_deployer"
  | "serial_rugger";

export type TokenHolderSnapshot = {
  address: string;
  ownerAddress: string | null;
  tokenAccountAddress: string | null;
  amount: number | null;
  supplyPct: number;
  valueUsd: number | null;
  label: string | null;
  domain: string | null;
  accountType: string | null;
  activeAgeDays: number | null;
  fundedBy: string | null;
  totalValueUsd: number | null;
  tradeVolume90dSol: number | null;
  solBalance: number | null;
  badges: TokenHolderBadge[];
  devRole: "creator" | "mint_authority" | "freeze_authority" | null;
};

export type TokenDistributionSnapshot = {
  holderCount: number | null;
  holderCountSource: "helius" | "rpc_scan" | "birdeye" | "largest_accounts" | null;
  largestHolderPct: number | null;
  top10HolderPct: number | null;
  topHolders: TokenHolderSnapshot[];
  devWallet: TokenHolderSnapshot | null;
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

type RpcTokenAccountInfoResult = {
  value?: Array<
    | {
        data?: {
          parsed?: {
            info?: {
              owner?: string | null;
            };
          };
        } | null;
      }
    | null
  > | null;
};

type RpcMintAccountInfoResult = {
  value?: {
    data?: {
      parsed?: {
        info?: {
          mintAuthority?: string | null;
          freezeAuthority?: string | null;
        };
      };
    } | null;
  } | null;
};

const SOLANA_TOKEN_PROGRAM_ID = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const DEFAULT_SOLANA_RPC_URL = "https://api.mainnet-beta.solana.com";
const BIRDEYE_API_KEY = process.env.BIRDEYE_API_KEY?.trim() || "";
const HOLDER_SCAN_RPC_TIMEOUT_MS = process.env.NODE_ENV === "production" ? 8_000 : 12_000;
const TOKEN_DISTRIBUTION_CACHE_TTL_MS = process.env.NODE_ENV === "production" ? 20_000 : 5_000;
const FRESH_WALLET_DAYS_THRESHOLD = 30;
const OBSERVED_FRESH_WALLET_DAYS_THRESHOLD = 60;
const LOW_HISTORY_MINT_THRESHOLD = 2;
const LOW_HISTORY_TX_THRESHOLD = 12;
const HIGH_VOLUME_TRADER_SOL_THRESHOLD = 100;
const SOFT_HIGH_VOLUME_TRADER_SOL_THRESHOLD = 25;
const HIGH_ACTIVITY_MINTS_THRESHOLD = 6;
const HIGH_ACTIVITY_TX_THRESHOLD = 18;
const WHALE_SUPPLY_PCT_THRESHOLD = 4;
const WHALE_PORTFOLIO_USD_THRESHOLD = 500_000;
const SOFT_WHALE_SUPPLY_PCT_THRESHOLD = 0.8;
const SOFT_WHALE_VALUE_USD_THRESHOLD = 75_000;
const SERIAL_DEPLOYER_ASSET_THRESHOLD = 5;
const SERIAL_RUGGER_DEPLOYMENT_THRESHOLD = 3;
const HOLDER_ACTIVITY_LOOKBACK_MS = 90 * 24 * 60 * 60 * 1000;
const SOLANA_WALLET_REGEX = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
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
    topHolders: snapshot.topHolders.map((holder) => ({ ...holder, badges: [...holder.badges] })),
    devWallet: snapshot.devWallet
      ? { ...snapshot.devWallet, badges: [...snapshot.devWallet.badges] }
      : null,
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

function isLikelySolanaWallet(value: string | null | undefined): value is string {
  return typeof value === "string" && SOLANA_WALLET_REGEX.test(value.trim());
}

function buildHolderBadges(params: {
  supplyPct: number;
  totalValueUsd: number | null;
  activeAgeDays: number | null;
  tradeVolume90dSol: number | null;
  distinctMintsTraded: number;
  observedTxCount: number;
  lastSeenHours: number | null;
  devRole: TokenHolderSnapshot["devRole"];
  authorityAssetCount: number | null;
  ruggedDeploymentCount: number;
}): TokenHolderBadge[] {
  const badges: TokenHolderBadge[] = [];
  if (params.devRole) badges.push("dev_wallet");
  if (params.activeAgeDays !== null && params.activeAgeDays <= FRESH_WALLET_DAYS_THRESHOLD) {
    badges.push("fresh_wallet");
  }
  if (
    (params.tradeVolume90dSol !== null && params.tradeVolume90dSol >= HIGH_VOLUME_TRADER_SOL_THRESHOLD)
  ) {
    badges.push("high_volume_trader");
  }
  if (
    params.supplyPct >= WHALE_SUPPLY_PCT_THRESHOLD ||
    (params.totalValueUsd !== null && params.totalValueUsd >= WHALE_PORTFOLIO_USD_THRESHOLD)
  ) {
    badges.push("whale");
  }
  if (
    (params.authorityAssetCount !== null && params.authorityAssetCount >= SERIAL_DEPLOYER_ASSET_THRESHOLD) ||
    false
  ) {
    badges.push("serial_deployer");
  }
  if (
    params.authorityAssetCount !== null &&
    params.authorityAssetCount >= SERIAL_DEPLOYER_ASSET_THRESHOLD &&
    params.ruggedDeploymentCount >= SERIAL_RUGGER_DEPLOYMENT_THRESHOLD
  ) {
    badges.push("serial_rugger");
  }

  if (badges.length === 0) {
    if (
      params.activeAgeDays !== null &&
      params.activeAgeDays <= OBSERVED_FRESH_WALLET_DAYS_THRESHOLD &&
      params.distinctMintsTraded <= LOW_HISTORY_MINT_THRESHOLD &&
      params.observedTxCount <= LOW_HISTORY_TX_THRESHOLD
    ) {
      badges.push("fresh_wallet");
    } else if (
      params.authorityAssetCount !== null &&
      params.authorityAssetCount >= 2
    ) {
      badges.push("serial_deployer");
    } else if (
      (params.tradeVolume90dSol !== null && params.tradeVolume90dSol >= SOFT_HIGH_VOLUME_TRADER_SOL_THRESHOLD) ||
      params.distinctMintsTraded >= HIGH_ACTIVITY_MINTS_THRESHOLD ||
      params.observedTxCount >= HIGH_ACTIVITY_TX_THRESHOLD
    ) {
      badges.push("high_volume_trader");
    } else if (
      params.supplyPct >= SOFT_WHALE_SUPPLY_PCT_THRESHOLD ||
      (params.totalValueUsd !== null && params.totalValueUsd >= SOFT_WHALE_VALUE_USD_THRESHOLD)
    ) {
      badges.push("whale");
    } else if (
      params.lastSeenHours !== null &&
      params.lastSeenHours <= 24 &&
      params.observedTxCount <= LOW_HISTORY_TX_THRESHOLD
    ) {
      badges.push("fresh_wallet");
    } else {
      badges.push("whale");
    }
  }

  const priority: Record<TokenHolderBadge, number> = {
    dev_wallet: 0,
    serial_rugger: 1,
    serial_deployer: 2,
    whale: 3,
    high_volume_trader: 4,
    fresh_wallet: 5,
  };

  return [...new Set(badges)].sort((left, right) => priority[left] - priority[right]);
}

function isRugLikeMarketSnapshot(snapshot: Awaited<ReturnType<typeof getCachedMarketCapSnapshot>> | null): boolean {
  if (!snapshot) return false;
  if (
    typeof snapshot.liquidityUsd === "number" &&
    Number.isFinite(snapshot.liquidityUsd) &&
    snapshot.liquidityUsd > 0 &&
    snapshot.liquidityUsd < 1_500
  ) {
    return true;
  }
  if (
    typeof snapshot.mcap === "number" &&
    Number.isFinite(snapshot.mcap) &&
    snapshot.mcap > 0 &&
    snapshot.mcap < 20_000
  ) {
    return true;
  }
  if (
    typeof snapshot.priceChange24hPct === "number" &&
    Number.isFinite(snapshot.priceChange24hPct) &&
    snapshot.priceChange24hPct <= -95
  ) {
    return true;
  }
  return false;
}

function aggregateTopHoldersByWallet(holders: TokenHolderSnapshot[]): TokenHolderSnapshot[] {
  const grouped = new Map<string, TokenHolderSnapshot>();

  for (const holder of holders) {
    const walletAddress = holder.ownerAddress ?? holder.address;
    const existing = grouped.get(walletAddress);
    if (!existing) {
      grouped.set(walletAddress, {
        ...holder,
        address: walletAddress,
        ownerAddress: walletAddress,
      });
      continue;
    }

    existing.amount =
      holder.amount !== null || existing.amount !== null
        ? (existing.amount ?? 0) + (holder.amount ?? 0)
        : null;
    existing.supplyPct = Math.round((existing.supplyPct + holder.supplyPct) * 100) / 100;
    existing.valueUsd =
      holder.valueUsd !== null || existing.valueUsd !== null
        ? (existing.valueUsd ?? 0) + (holder.valueUsd ?? 0)
        : null;
    existing.tokenAccountAddress =
      existing.tokenAccountAddress && holder.tokenAccountAddress && existing.tokenAccountAddress === holder.tokenAccountAddress
        ? existing.tokenAccountAddress
        : null;
  }

  return [...grouped.values()].sort((left, right) => right.supplyPct - left.supplyPct);
}

async function getRpcTokenAccountOwners(tokenAccountAddresses: string[]): Promise<Map<string, string>> {
  const uniqueAddresses = [...new Set(
    tokenAccountAddresses
      .map((address) => (typeof address === "string" ? address.trim() : ""))
      .filter((address) => address.length > 0)
  )];
  const ownerMap = new Map<string, string>();
  if (uniqueAddresses.length === 0) return ownerMap;

  const response = await rpcCall<RpcTokenAccountInfoResult>(
    "getMultipleAccounts",
    [
      uniqueAddresses,
      {
        encoding: "jsonParsed",
        commitment: "confirmed",
      },
    ],
    { timeoutMs: Math.min(HOLDER_SCAN_RPC_TIMEOUT_MS, 7_500) }
  );
  const values = response?.value ?? [];
  uniqueAddresses.forEach((address, index) => {
    const owner = values[index]?.data?.parsed?.info?.owner;
    if (isLikelySolanaWallet(owner)) {
      ownerMap.set(address, owner);
    }
  });
  return ownerMap;
}

async function getRpcMintAuthorities(mintAddress: string): Promise<{
  mintAuthority: string | null;
  freezeAuthority: string | null;
}> {
  const response = await rpcCall<RpcMintAccountInfoResult>(
    "getAccountInfo",
    [
      mintAddress,
      {
        encoding: "jsonParsed",
        commitment: "confirmed",
      },
    ],
    { timeoutMs: Math.min(HOLDER_SCAN_RPC_TIMEOUT_MS, 6_500) }
  );

  const info = response?.value?.data?.parsed?.info;
  return {
    mintAuthority: isLikelySolanaWallet(info?.mintAuthority) ? info.mintAuthority : null,
    freezeAuthority: isLikelySolanaWallet(info?.freezeAuthority) ? info.freezeAuthority : null,
  };
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
    const [
      supplyResult,
      largestAccountsResult,
      holderAccountsResult,
      birdeyeHolderCount,
      heliusTokenMeta,
      heliusHolderSummary,
      rpcMintAuthorities,
      marketSnapshot,
    ] = await Promise.all([
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
      getHeliusTokenMetadataForMint({ mint: mintAddress, chainType: "solana" }),
      getHeliusTokenAccountsForMint({ mint: mintAddress, limit: 1 }),
      getRpcMintAuthorities(mintAddress),
      getCachedMarketCapSnapshot(mintAddress, "solana"),
    ]);

    const totalSupply = uiAmountToNumber({
      amount: supplyResult?.value?.amount ?? null,
      decimals: supplyResult?.value?.decimals ?? null,
    });
    const tokenPriceUsd =
      typeof marketSnapshot.priceUsd === "number" && Number.isFinite(marketSnapshot.priceUsd) && marketSnapshot.priceUsd > 0
        ? marketSnapshot.priceUsd
        : null;

    const largestAccounts = largestAccountsResult?.value ?? [];
    const tokenAccountOwners = await getRpcTokenAccountOwners(
      largestAccounts
        .map((holder) => (typeof holder.address === "string" ? holder.address.trim() : ""))
        .filter((address) => address.length > 0)
    );
    const rpcTopHolders: TokenHolderSnapshot[] =
      totalSupply && totalSupply > 0
        ? largestAccounts
            .map((holder): TokenHolderSnapshot | null => {
              const address = typeof holder.address === "string" ? holder.address.trim() : "";
              const uiAmount = uiAmountToNumber(holder);
              if (!address || uiAmount === null || uiAmount <= 0) return null;
              return {
                address,
                ownerAddress: tokenAccountOwners.get(address) ?? null,
                tokenAccountAddress: address,
                amount: uiAmount,
                supplyPct: Math.round(((uiAmount / totalSupply) * 100) * 100) / 100,
                valueUsd: tokenPriceUsd !== null ? Math.round(uiAmount * tokenPriceUsd * 100) / 100 : null,
                label: null,
                domain: null,
                accountType: null,
                activeAgeDays: null,
                fundedBy: null,
                totalValueUsd: null,
                tradeVolume90dSol: null,
                solBalance: null,
                badges: [],
                devRole: null,
              };
            })
            .filter((holder): holder is TokenHolderSnapshot => holder !== null)
        : [];

    const topHoldersBase = aggregateTopHoldersByWallet(rpcTopHolders);
    const devWalletRoles = new Map<string, TokenHolderSnapshot["devRole"]>();
    if (isLikelySolanaWallet(heliusTokenMeta?.creator) && !devWalletRoles.has(heliusTokenMeta.creator)) {
      devWalletRoles.set(heliusTokenMeta.creator, "creator");
    }
    if (isLikelySolanaWallet(heliusTokenMeta?.updateAuthority) && !devWalletRoles.has(heliusTokenMeta.updateAuthority)) {
      devWalletRoles.set(heliusTokenMeta.updateAuthority, "creator");
    }
    if (isLikelySolanaWallet(heliusTokenMeta?.mintAuthority) && !devWalletRoles.has(heliusTokenMeta.mintAuthority)) {
      devWalletRoles.set(heliusTokenMeta.mintAuthority, "mint_authority");
    }
    if (isLikelySolanaWallet(rpcMintAuthorities.mintAuthority) && !devWalletRoles.has(rpcMintAuthorities.mintAuthority)) {
      devWalletRoles.set(rpcMintAuthorities.mintAuthority, "mint_authority");
    }
    if (isLikelySolanaWallet(heliusTokenMeta?.freezeAuthority) && !devWalletRoles.has(heliusTokenMeta.freezeAuthority)) {
      devWalletRoles.set(heliusTokenMeta.freezeAuthority, "freeze_authority");
    }
    if (isLikelySolanaWallet(rpcMintAuthorities.freezeAuthority) && !devWalletRoles.has(rpcMintAuthorities.freezeAuthority)) {
      devWalletRoles.set(rpcMintAuthorities.freezeAuthority, "freeze_authority");
    }

    const candidateWallets = [...new Set(
      [
        ...topHoldersBase.map((holder) => holder.ownerAddress ?? holder.address),
        ...devWalletRoles.keys(),
      ].filter((address): address is string => isLikelySolanaWallet(address))
    )];
    const authorityScanWallets = [...new Set(
      [
        ...topHoldersBase.slice(0, 10).map((holder) => holder.ownerAddress ?? holder.address),
        ...devWalletRoles.keys(),
      ].filter((address): address is string => isLikelySolanaWallet(address))
    )];
    const [walletActivityEntries, authorityAssetSummaryEntries, devHoldingEntries] = await Promise.all([
      Promise.all(
        candidateWallets.map(async (address) => [
          address,
          await getWalletActivityProfile({
            walletAddress: address,
            sinceMs: Date.now() - HOLDER_ACTIVITY_LOOKBACK_MS,
          }),
        ] as const)
      ),
      Promise.all(
        authorityScanWallets.map(async (address) => [address, await getHeliusAuthorityAssetSummary({
          authorityAddress: address,
          limit: 12,
        })] as const)
      ),
      Promise.all(
        [...devWalletRoles.keys()].map(async (address) => [
          address,
          await getWalletTradeSnapshotForSolanaToken({
            walletAddress: address,
            tokenMint: mintAddress,
            chainType: "solana",
          }),
        ] as const)
      ),
    ]);
    const walletActivityMap = new Map<string, Awaited<ReturnType<typeof getWalletActivityProfile>>>(walletActivityEntries);
    const authorityAssetSummaryMap = new Map<string, Awaited<ReturnType<typeof getHeliusAuthorityAssetSummary>>>(authorityAssetSummaryEntries);
    const devHoldingMap = new Map<string, Awaited<ReturnType<typeof getWalletTradeSnapshotForSolanaToken>>>(devHoldingEntries);
    const authorityHeuristicEntries = await Promise.all(
      authorityScanWallets.map(async (address) => {
        const summary = authorityAssetSummaryMap.get(address) ?? null;
        const historicalMints =
          summary?.mintAddresses
            .filter((candidate) => candidate !== mintAddress)
            .slice(0, 8) ?? [];
        const snapshots = await Promise.all(
          historicalMints.map((candidateMint) => getCachedMarketCapSnapshot(candidateMint, "solana"))
        );
        return [
          address,
          {
            authorityAssetCount: summary?.total ?? null,
            ruggedDeploymentCount: snapshots.filter((snapshot) => isRugLikeMarketSnapshot(snapshot)).length,
          },
        ] as const;
      })
    );
    const authorityHeuristicMap = new Map<string, { authorityAssetCount: number | null; ruggedDeploymentCount: number }>(
      authorityHeuristicEntries
    );

    const topHolders = topHoldersBase.map((holder) => {
      const walletAddress = holder.ownerAddress ?? holder.address;
      const activity = walletActivityMap.get(walletAddress) ?? null;
      const devRole = devWalletRoles.get(walletAddress) ?? null;
      const authorityHeuristic = authorityHeuristicMap.get(walletAddress) ?? {
        authorityAssetCount: null,
        ruggedDeploymentCount: 0,
      };
      const totalValueUsd = holder.valueUsd ?? null;

      return {
        ...holder,
        label:
          activity && activity.distinctMintsTraded > 0
            ? `${activity.distinctMintsTraded} mints traded`
            : null,
        domain: null,
        accountType: null,
        activeAgeDays: activity?.observedAgeDays ?? null,
        fundedBy: null,
        totalValueUsd,
        tradeVolume90dSol: activity?.totalTradeVolumeSol ?? null,
        solBalance: activity?.balanceSol ?? null,
        badges: buildHolderBadges({
          supplyPct: holder.supplyPct,
          totalValueUsd,
          activeAgeDays: activity?.observedAgeDays ?? null,
          tradeVolume90dSol: activity?.totalTradeVolumeSol ?? null,
          distinctMintsTraded: activity?.distinctMintsTraded ?? 0,
          observedTxCount: activity?.observedTxCount ?? 0,
          lastSeenHours: activity?.lastSeenHours ?? null,
          devRole,
          authorityAssetCount: authorityHeuristic.authorityAssetCount,
          ruggedDeploymentCount: authorityHeuristic.ruggedDeploymentCount,
        }),
        devRole,
      };
    });

    const devWallet =
      topHolders.find((holder) => holder.devRole !== null) ??
      (() => {
        const [walletAddress, devRole] = devWalletRoles.entries().next().value ?? [];
        if (!isLikelySolanaWallet(walletAddress) || !devRole) return null;
        const activity = walletActivityMap.get(walletAddress) ?? null;
        const devHolding = devHoldingMap.get(walletAddress) ?? null;
        const authorityHeuristic = authorityHeuristicMap.get(walletAddress) ?? {
          authorityAssetCount: null,
          ruggedDeploymentCount: 0,
        };
        const holdingAmount = devHolding?.holdingAmount ?? null;
        const supplyPct =
          holdingAmount !== null && totalSupply && totalSupply > 0
            ? Math.round(((holdingAmount / totalSupply) * 100) * 100) / 100
            : 0;
        return {
          address: walletAddress,
          ownerAddress: walletAddress,
          tokenAccountAddress: null,
          amount: holdingAmount,
          supplyPct,
          valueUsd: devHolding?.holdingUsd ?? null,
          label:
            devRole === "creator"
              ? "Detected from token creation authority"
              : devRole === "mint_authority"
                ? "Detected from mint authority on-chain"
                : "Detected from freeze authority on-chain",
          domain: null,
          accountType: null,
          activeAgeDays: activity?.observedAgeDays ?? null,
          fundedBy: null,
          totalValueUsd: devHolding?.holdingUsd ?? null,
          tradeVolume90dSol: activity?.totalTradeVolumeSol ?? null,
          solBalance: activity?.balanceSol ?? null,
          badges: buildHolderBadges({
            supplyPct,
            totalValueUsd: devHolding?.holdingUsd ?? null,
            activeAgeDays: activity?.observedAgeDays ?? null,
            tradeVolume90dSol: activity?.totalTradeVolumeSol ?? null,
            distinctMintsTraded: activity?.distinctMintsTraded ?? 0,
            observedTxCount: activity?.observedTxCount ?? 0,
            lastSeenHours: activity?.lastSeenHours ?? null,
            devRole,
            authorityAssetCount: authorityHeuristic.authorityAssetCount,
            ruggedDeploymentCount: authorityHeuristic.ruggedDeploymentCount,
          }),
          devRole,
        } satisfies TokenHolderSnapshot;
      })();

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
      deployerSupplyPct: devWallet?.supplyPct ?? largestHolderPct,
    });

    let holderCount: number | null = null;
    let holderCountSource: TokenDistributionSnapshot["holderCountSource"] = null;
    const minimumObservedHolderCount = topHoldersBase.length;
    const normalizedObservedHolderCount = minimumObservedHolderCount > 0 ? minimumObservedHolderCount : 0;
    const heliusHolderCount =
      heliusHolderSummary?.total && heliusHolderSummary.total > 0
        ? Math.round(heliusHolderSummary.total)
        : 0;
    const rpcHolderCount =
      Array.isArray(holderAccountsResult) && holderAccountsResult.length > 0
        ? holderAccountsResult.length
        : 0;
    const rpcCountLooksTruncated =
      rpcHolderCount > 0 &&
      topHolders.length >= 20 &&
      rpcHolderCount <= topHolders.length;

    const isPlausibleHolderCount = (value: number): boolean =>
      value > 0 && value >= normalizedObservedHolderCount;

    if (isPlausibleHolderCount(heliusHolderCount)) {
      holderCount = heliusHolderCount;
      holderCountSource = "helius";
    } else if (!rpcCountLooksTruncated && isPlausibleHolderCount(rpcHolderCount)) {
      holderCount = rpcHolderCount;
      holderCountSource = "rpc_scan";
    } else if (
      typeof birdeyeHolderCount === "number" &&
      Number.isFinite(birdeyeHolderCount) &&
      isPlausibleHolderCount(Math.round(birdeyeHolderCount))
    ) {
      holderCount = Math.round(birdeyeHolderCount);
      holderCountSource = "birdeye";
    } else if (normalizedObservedHolderCount > 0) {
      holderCount = normalizedObservedHolderCount;
      holderCountSource = "largest_accounts";
    }

    const nextSnapshot: TokenDistributionSnapshot = {
      holderCount,
      holderCountSource,
      largestHolderPct,
      top10HolderPct,
      topHolders,
      devWallet,
      deployerSupplyPct: devWallet?.supplyPct ?? largestHolderPct,
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
