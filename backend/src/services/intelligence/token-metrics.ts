import bs58 from "bs58";
import { getCachedMarketCapSnapshot } from "../marketcap.js";
import {
  getHeliusAuthorityAssetSummary,
  getHeliusCurrentHolderOwnerCount,
  getLikelyMintCreatorWallet,
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
  | "ultra_degen"
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

type RpcProgramAccountResult = Array<
  | {
      account?: {
        data?: [string, string] | string | null;
      } | null;
    }
  | null
>;

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

type RpcOwnerAccountInfoResult = {
  value?: Array<
    | {
        executable?: boolean | null;
        owner?: string | null;
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

type OwnerAccountClassification = {
  ownerProgram: string | null;
  executable: boolean;
  isSystemOwned: boolean;
};

const SOLANA_TOKEN_PROGRAM_ID = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const SYSTEM_PROGRAM_ID = "11111111111111111111111111111111";
const DEFAULT_SOLANA_RPC_URL = "https://api.mainnet-beta.solana.com";
const BIRDEYE_API_KEY = process.env.BIRDEYE_API_KEY?.trim() || "";
const HOLDER_SCAN_RPC_TIMEOUT_MS = process.env.NODE_ENV === "production" ? 8_000 : 12_000;
const TOKEN_DISTRIBUTION_CACHE_TTL_MS = process.env.NODE_ENV === "production" ? 90_000 : 15_000;
const TOKEN_DISTRIBUTION_STALE_TTL_MS = process.env.NODE_ENV === "production" ? 15 * 60_000 : 90_000;
const TOKEN_DISTRIBUTION_RETRY_MS = process.env.NODE_ENV === "production" ? 30_000 : 7_500;
const TOKEN_DISTRIBUTION_VISIBLE_REFRESH_MS = process.env.NODE_ENV === "production" ? 4_500 : 1_500;
const FRESH_WALLET_DAYS_THRESHOLD = 5;
const OBSERVED_FRESH_WALLET_DAYS_THRESHOLD = 5;
const LOW_HISTORY_MINT_THRESHOLD = 2;
const LOW_HISTORY_TX_THRESHOLD = 12;
const HIGH_VOLUME_TRADER_SOL_THRESHOLD = 180;
const SOFT_HIGH_VOLUME_TRADER_SOL_THRESHOLD = 75;
const HIGH_ACTIVITY_MINTS_THRESHOLD = 6;
const HIGH_ACTIVITY_TX_THRESHOLD = 18;
const WHALE_BALANCE_SOL_THRESHOLD = 250;
const SOFT_WHALE_BALANCE_SOL_THRESHOLD = 200;
const WHALE_BALANCE_USD_THRESHOLD = 45_000;
const SOFT_WHALE_BALANCE_USD_THRESHOLD = 35_000;
const ULTRA_DEGEN_TRADE_VOLUME_SOL_THRESHOLD = 220;
const SOFT_ULTRA_DEGEN_TRADE_VOLUME_SOL_THRESHOLD = 90;
const ULTRA_DEGEN_DISTINCT_MINTS_THRESHOLD = 9;
const SOFT_ULTRA_DEGEN_DISTINCT_MINTS_THRESHOLD = 5;
const ULTRA_DEGEN_TX_THRESHOLD = 36;
const SOFT_ULTRA_DEGEN_TX_THRESHOLD = 18;
const SERIAL_DEPLOYER_ASSET_THRESHOLD = 5;
const SERIAL_RUGGER_DEPLOYMENT_THRESHOLD = 3;
const HOLDER_ACTIVITY_LOOKBACK_MS = 90 * 24 * 60 * 60 * 1000;
const SOLANA_WALLET_REGEX = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const SOLANA_RPC_URLS = [
  process.env.HELIUS_RPC_URL?.trim() || null,
  process.env.HELIUS_RPC_ENDPOINT?.trim() || null,
  process.env.SOLANA_RPC_URL?.trim() || null,
  // Additional free public RPC endpoints as fallbacks when no API key is configured.
  // Tried in order — first successful response wins.
  "https://rpc.ankr.com/solana",
  "https://solana.publicnode.com",
  DEFAULT_SOLANA_RPC_URL,
].filter((value, index, collection): value is string =>
  typeof value === "string" &&
  value.length > 0 &&
  collection.indexOf(value) === index
);
const tokenDistributionCache = new Map<
  string,
  {
    value: TokenDistributionSnapshot | null;
    expiresAtMs: number;
    staleExpiresAtMs: number;
    nextRefreshAllowedAtMs: number;
  }
>();
const tokenDistributionInFlight = new Map<string, Promise<TokenDistributionSnapshot | null>>();
const AMBIGUOUS_HOLDER_COUNT_PAGE_SIZE = 1000;

function isSuspiciousResolvedHolderCount(args: {
  holderCount: number | null | undefined;
  holderCountSource: TokenDistributionSnapshot["holderCountSource"];
  minimumObservedHolderCount?: number | null | undefined;
}): boolean {
  if (
    args.holderCountSource === null ||
    args.holderCountSource === "largest_accounts" ||
    typeof args.holderCount !== "number" ||
    !Number.isFinite(args.holderCount) ||
    args.holderCount <= 0
  ) {
    return false;
  }

  const normalizedHolderCount = Math.round(args.holderCount);
  if (normalizedHolderCount !== AMBIGUOUS_HOLDER_COUNT_PAGE_SIZE) {
    return false;
  }

  const minimumObservedHolderCount =
    typeof args.minimumObservedHolderCount === "number" && Number.isFinite(args.minimumObservedHolderCount)
      ? Math.max(0, Math.round(args.minimumObservedHolderCount))
      : 0;

  return minimumObservedHolderCount < normalizedHolderCount;
}

function hasResolvedHolderCount(snapshot: TokenDistributionSnapshot | null | undefined): boolean {
  return Boolean(
    snapshot &&
    typeof snapshot.holderCount === "number" &&
    Number.isFinite(snapshot.holderCount) &&
    snapshot.holderCount > 0 &&
    snapshot.holderCountSource !== "largest_accounts" &&
    snapshot.holderCountSource !== null &&
    !isSuspiciousResolvedHolderCount({
      holderCount: snapshot.holderCount,
      holderCountSource: snapshot.holderCountSource,
      minimumObservedHolderCount: snapshot.topHolders.length,
    })
  );
}

function needsVisibleDistributionRefresh(snapshot: TokenDistributionSnapshot | null | undefined): boolean {
  if (!snapshot) {
    return true;
  }

  return (
    snapshot.topHolders.length === 0 ||
    !hasResolvedHolderCount(snapshot) ||
    !hasResolvedHolderRoleIntelligence(snapshot)
  );
}

function hasResolvedHolderRoleFields(
  holder: Pick<
    TokenHolderSnapshot,
    "badges" | "devRole" | "activeAgeDays" | "fundedBy" | "tradeVolume90dSol" | "solBalance" | "label"
  > | null | undefined
): boolean {
  if (!holder) {
    return false;
  }

  return Boolean(
    holder.badges.length > 0 ||
      holder.devRole !== null ||
      holder.activeAgeDays !== null ||
      holder.fundedBy !== null ||
      holder.tradeVolume90dSol !== null ||
      holder.solBalance !== null ||
      (typeof holder.label === "string" && holder.label.trim().length > 0)
  );
}

function hasResolvedHolderRoleIntelligence(snapshot: TokenDistributionSnapshot | null | undefined): boolean {
  if (!snapshot) {
    return false;
  }

  return (
    snapshot.topHolders.some((holder) => hasResolvedHolderRoleFields(holder)) ||
    hasResolvedHolderRoleFields(snapshot.devWallet)
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
    // Default 2500ms per endpoint so fallback URLs are reached within the
    // 5s distribution section timeout if the primary endpoint is unreachable.
    const timeoutId = setTimeout(() => controller.abort(), options?.timeoutMs ?? 2_500);
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

function decodeProgramAccountSlice(data: [string, string] | string | null | undefined): Uint8Array | null {
  const encoded =
    typeof data === "string"
      ? data
      : Array.isArray(data) && typeof data[0] === "string"
        ? data[0]
        : null;
  if (!encoded) return null;

  try {
    return Uint8Array.from(Buffer.from(encoded, "base64"));
  } catch {
    return null;
  }
}

function parseSliceOwnerAddress(bytes: Uint8Array): string | null {
  if (bytes.length < 32) return null;
  const ownerBytes = bytes.slice(0, 32);
  const allZero = ownerBytes.every((value) => value === 0);
  if (allZero) return null;

  const address = bs58.encode(ownerBytes);
  return isLikelySolanaWallet(address) ? address : null;
}

function parseSliceAmount(bytes: Uint8Array): bigint | null {
  if (bytes.length < 40) return null;
  let amount = 0n;
  for (let index = 0; index < 8; index += 1) {
    amount += BigInt(bytes[32 + index] ?? 0) << (8n * BigInt(index));
  }
  return amount;
}

function countCurrentHolderWalletsFromProgramAccounts(
  accounts: RpcProgramAccountResult | null | undefined
): number | null {
  if (!Array.isArray(accounts) || accounts.length === 0) return 0;
  if (accounts.length === AMBIGUOUS_HOLDER_COUNT_PAGE_SIZE) {
    return null;
  }

  const owners = new Set<string>();
  for (const account of accounts) {
    const bytes = decodeProgramAccountSlice(account?.account?.data);
    if (!bytes) continue;
    const owner = parseSliceOwnerAddress(bytes);
    const amount = parseSliceAmount(bytes);
    if (!owner || amount === null || amount <= 0n) continue;
    owners.add(owner);
  }

  return owners.size;
}

function buildBundleClusters(holderPcts: number[]): BundleClusterSnapshot[] {
  const buckets = [
    { key: ">=8%", min: 8, max: Number.POSITIVE_INFINITY },
    { key: "4-8%", min: 4, max: 8 },
    { key: "2-4%", min: 2, max: 4 },
    { key: "1-2%", min: 1, max: 2 },
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
  balanceUsd: number | null;
  activeAgeDays: number | null;
  tradeVolume90dSol: number | null;
  balanceSol: number | null;
  distinctMintsTraded: number;
  observedTxCount: number;
  lastSeenHours: number | null;
  devRole: TokenHolderSnapshot["devRole"];
  authorityAssetCount: number | null;
  ruggedDeploymentCount: number;
}): TokenHolderBadge[] {
  const badges: TokenHolderBadge[] = [];
  const observedTradingDays =
    params.activeAgeDays !== null && Number.isFinite(params.activeAgeDays)
      ? Math.max(1, Math.min(params.activeAgeDays, 90))
      : 90;
  const avgDailyTradeSol =
    params.tradeVolume90dSol !== null && Number.isFinite(params.tradeVolume90dSol)
      ? params.tradeVolume90dSol / observedTradingDays
      : null;

  if (params.devRole) badges.push("dev_wallet");
  if (
    params.authorityAssetCount !== null &&
    params.authorityAssetCount >= SERIAL_DEPLOYER_ASSET_THRESHOLD &&
    params.ruggedDeploymentCount >= SERIAL_RUGGER_DEPLOYMENT_THRESHOLD
  ) {
    badges.push("serial_rugger");
  }
  if (
    (params.authorityAssetCount !== null && params.authorityAssetCount >= SERIAL_DEPLOYER_ASSET_THRESHOLD) ||
    false
  ) {
    badges.push("serial_deployer");
  }
  if (
    (
      params.tradeVolume90dSol !== null &&
      params.tradeVolume90dSol >= ULTRA_DEGEN_TRADE_VOLUME_SOL_THRESHOLD &&
      (
        params.distinctMintsTraded >= ULTRA_DEGEN_DISTINCT_MINTS_THRESHOLD ||
        params.observedTxCount >= ULTRA_DEGEN_TX_THRESHOLD
      )
    ) ||
    (
      avgDailyTradeSol !== null &&
      avgDailyTradeSol >= 3 &&
      params.distinctMintsTraded >= Math.max(6, ULTRA_DEGEN_DISTINCT_MINTS_THRESHOLD - 1) &&
      params.observedTxCount >= 20
    )
  ) {
    badges.push("ultra_degen");
  }
  if (
    (params.balanceSol !== null && params.balanceSol >= WHALE_BALANCE_SOL_THRESHOLD) ||
    (params.balanceUsd !== null && params.balanceUsd >= WHALE_BALANCE_USD_THRESHOLD)
  ) {
    badges.push("whale");
  }
  if (
    (
      params.tradeVolume90dSol !== null &&
      params.tradeVolume90dSol >= HIGH_VOLUME_TRADER_SOL_THRESHOLD
    ) ||
    (
      avgDailyTradeSol !== null &&
      avgDailyTradeSol >= 2 &&
      params.tradeVolume90dSol !== null &&
      params.tradeVolume90dSol >= 30
    )
  ) {
    badges.push("high_volume_trader");
  }
  if (params.activeAgeDays !== null && params.activeAgeDays <= FRESH_WALLET_DAYS_THRESHOLD) {
    badges.push("fresh_wallet");
  }

  if (badges.length === 0) {
    if (params.authorityAssetCount !== null && params.authorityAssetCount >= 2) {
      badges.push("serial_deployer");
    } else if (
      (
        params.tradeVolume90dSol !== null &&
        params.tradeVolume90dSol >= SOFT_ULTRA_DEGEN_TRADE_VOLUME_SOL_THRESHOLD &&
        (
          params.distinctMintsTraded >= SOFT_ULTRA_DEGEN_DISTINCT_MINTS_THRESHOLD ||
          params.observedTxCount >= SOFT_ULTRA_DEGEN_TX_THRESHOLD
        )
      ) ||
      (
        avgDailyTradeSol !== null &&
        avgDailyTradeSol >= 1.4 &&
        params.distinctMintsTraded >= 4 &&
        params.observedTxCount >= 12
      )
    ) {
      badges.push("ultra_degen");
    } else if (
      (params.balanceSol !== null && params.balanceSol >= SOFT_WHALE_BALANCE_SOL_THRESHOLD) ||
      (params.balanceUsd !== null && params.balanceUsd >= SOFT_WHALE_BALANCE_USD_THRESHOLD)
    ) {
      badges.push("whale");
    } else if (
      (
        params.tradeVolume90dSol !== null &&
        params.tradeVolume90dSol >= SOFT_HIGH_VOLUME_TRADER_SOL_THRESHOLD
      ) ||
      (
        avgDailyTradeSol !== null &&
        avgDailyTradeSol >= 1.1 &&
        params.tradeVolume90dSol !== null &&
        params.tradeVolume90dSol >= 15
      ) ||
      params.distinctMintsTraded >= HIGH_ACTIVITY_MINTS_THRESHOLD ||
      params.observedTxCount >= HIGH_ACTIVITY_TX_THRESHOLD
    ) {
      badges.push("high_volume_trader");
    } else if (
      params.activeAgeDays !== null &&
      params.activeAgeDays <= OBSERVED_FRESH_WALLET_DAYS_THRESHOLD &&
      params.distinctMintsTraded <= LOW_HISTORY_MINT_THRESHOLD &&
      params.observedTxCount <= LOW_HISTORY_TX_THRESHOLD
    ) {
      badges.push("fresh_wallet");
    } else if (
      params.lastSeenHours !== null &&
      params.lastSeenHours <= 24 &&
      params.observedTxCount <= LOW_HISTORY_TX_THRESHOLD
    ) {
      badges.push("fresh_wallet");
    }
  }

  const priority: Record<TokenHolderBadge, number> = {
    dev_wallet: 0,
    serial_rugger: 1,
    serial_deployer: 2,
    ultra_degen: 3,
    whale: 4,
    high_volume_trader: 5,
    fresh_wallet: 6,
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

function isLikelyLiquidityPoolHolder(params: {
  holder: TokenHolderSnapshot;
  referenceLiquidityUsd: number | null | undefined;
}): boolean {
  const referenceLiquidityUsd =
    typeof params.referenceLiquidityUsd === "number" && Number.isFinite(params.referenceLiquidityUsd)
      ? params.referenceLiquidityUsd
      : null;
  const holderValueUsd =
    typeof params.holder.valueUsd === "number" && Number.isFinite(params.holder.valueUsd)
      ? params.holder.valueUsd
      : typeof params.holder.totalValueUsd === "number" && Number.isFinite(params.holder.totalValueUsd)
        ? params.holder.totalValueUsd
        : null;

  if (!referenceLiquidityUsd || referenceLiquidityUsd <= 0 || !holderValueUsd || holderValueUsd <= 0) {
    return false;
  }

  if (params.holder.devRole) {
    return false;
  }

  const liquidityMatchRatio = holderValueUsd / referenceLiquidityUsd;
  const lacksWalletSignals =
    (params.holder.tradeVolume90dSol ?? 0) <= 0 &&
    (params.holder.solBalance ?? 0) <= 2 &&
    (params.holder.activeAgeDays ?? 0) <= 0 &&
    !params.holder.fundedBy;

  return (
    params.holder.supplyPct >= 2 &&
    liquidityMatchRatio >= 0.18 &&
    liquidityMatchRatio <= 1.2 &&
    lacksWalletSignals
  );
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

async function getRpcOwnerAccountClassifications(
  ownerAddresses: string[]
): Promise<Map<string, OwnerAccountClassification>> {
  const uniqueAddresses = [...new Set(
    ownerAddresses
      .map((address) => (typeof address === "string" ? address.trim() : ""))
      .filter((address) => address.length > 0)
  )];
  const classificationMap = new Map<string, OwnerAccountClassification>();
  if (uniqueAddresses.length === 0) {
    return classificationMap;
  }

  const response = await rpcCall<RpcOwnerAccountInfoResult>(
    "getMultipleAccounts",
    [
      uniqueAddresses,
      {
        encoding: "base64",
        commitment: "confirmed",
      },
    ],
    { timeoutMs: Math.min(HOLDER_SCAN_RPC_TIMEOUT_MS, 7_500) }
  );
  const values = response?.value ?? [];
  uniqueAddresses.forEach((address, index) => {
    const account = values[index];
    const ownerProgram =
      typeof account?.owner === "string" && account.owner.trim().length > 0
        ? account.owner.trim()
        : null;
    classificationMap.set(address, {
      ownerProgram,
      executable: account?.executable === true,
      isSystemOwned: ownerProgram === SYSTEM_PROGRAM_ID,
    });
  });

  return classificationMap;
}

function isProgramOwnedHolder(params: {
  holder: TokenHolderSnapshot;
  ownerClassification: OwnerAccountClassification | null | undefined;
  pairAddress: string | null | undefined;
}): boolean {
  const normalizedPairAddress = params.pairAddress?.trim() ?? null;
  const holderAddress = params.holder.address.trim();
  const ownerAddress = params.holder.ownerAddress?.trim() ?? null;
  const tokenAccountAddress = params.holder.tokenAccountAddress?.trim() ?? null;

  if (
    normalizedPairAddress &&
    (normalizedPairAddress === holderAddress ||
      normalizedPairAddress === ownerAddress ||
      normalizedPairAddress === tokenAccountAddress)
  ) {
    return true;
  }

  if (!params.ownerClassification) {
    return false;
  }

  if (params.ownerClassification.executable) {
    return true;
  }

  return (
    params.ownerClassification.ownerProgram !== null &&
    params.ownerClassification.ownerProgram !== SYSTEM_PROGRAM_ID
  );
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
  fallbackLiquidityUsd?: number | null,
  options?: { preferFresh?: boolean }
): Promise<TokenDistributionSnapshot | null> {
  const cacheKey = mintAddress.trim();
  const now = Date.now();
  const cached = tokenDistributionCache.get(cacheKey);
  const hasFreshCachedValue = cached && cached.expiresAtMs > now;
  const hasStaleCachedValue = cached && cached.staleExpiresAtMs > now;
  const canBypassFreshCacheForVisibleRefresh = Boolean(
    options?.preferFresh &&
      needsVisibleDistributionRefresh(cached?.value ?? null) &&
      (cached?.nextRefreshAllowedAtMs ?? 0) <= now
  );

  if (hasFreshCachedValue && !canBypassFreshCacheForVisibleRefresh) {
    return cloneDistributionSnapshot(cached.value);
  }

  const inFlight = tokenDistributionInFlight.get(cacheKey);
  if (inFlight) {
    if (!options?.preferFresh && hasStaleCachedValue) {
      return cloneDistributionSnapshot(cached.value);
    }
    return cloneDistributionSnapshot(await inFlight);
  }

  if (!options?.preferFresh && hasStaleCachedValue) {
    if ((cached?.nextRefreshAllowedAtMs ?? 0) <= now) {
      tokenDistributionCache.set(cacheKey, {
        value: cached?.value ?? null,
        expiresAtMs: cached?.expiresAtMs ?? 0,
        staleExpiresAtMs: cached?.staleExpiresAtMs ?? now + TOKEN_DISTRIBUTION_STALE_TTL_MS,
        nextRefreshAllowedAtMs: now + TOKEN_DISTRIBUTION_RETRY_MS,
      });
      void analyzeSolanaTokenDistribution(mintAddress, fallbackLiquidityUsd, { preferFresh: true }).catch(() => undefined);
    }
    return cloneDistributionSnapshot(cached.value);
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
          // SPL token account layout: owner at offset 32, amount at offset 64.
          dataSlice: { offset: 32, length: 40 },
        },
      ], { timeoutMs: HOLDER_SCAN_RPC_TIMEOUT_MS }),
      fetchBirdeyeHolderCount(mintAddress),
      getHeliusTokenMetadataForMint({ mint: mintAddress, chainType: "solana" }),
      // Cap at 3 pages (~3000 accounts, ~900ms) so the Promise.all resolves within
      // the 5s distribution section timeout. For tokens with more holders, returns null
      // and we fall through to the largestAccounts lower-bound count.
      getHeliusCurrentHolderOwnerCount({ mint: mintAddress, maxPages: 3 }),
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

    const rawTopHoldersByWallet = aggregateTopHoldersByWallet(rpcTopHolders);
    const ownerAccountClassifications = await getRpcOwnerAccountClassifications(
      rawTopHoldersByWallet
        // Only classify confirmed wallet addresses (ownerAddress), not token accounts.
        // Token accounts are owned by SPL Token Program and would be wrongly filtered.
        .map((holder) => holder.ownerAddress)
        .filter((address): address is string => isLikelySolanaWallet(address))
    );
    const topHoldersBase = rawTopHoldersByWallet.filter((holder) => {
      const walletAddress = holder.ownerAddress ?? holder.address;
      // Only use program classification when we successfully resolved the wallet owner.
      // If ownerAddress is null (getRpcTokenAccountOwners failed), the walletAddress is
      // actually a token account (owned by SPL Token Program), so classification would
      // incorrectly mark all holders as program-owned and filter them out.
      const ownerClassification =
        holder.ownerAddress !== null
          ? ownerAccountClassifications.get(walletAddress) ?? null
          : null;
      return !isProgramOwnedHolder({
        holder,
        ownerClassification,
        pairAddress: marketSnapshot.pairAddress ?? null,
      });
    });
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
    let creatorHistoryWalletAddress: string | null = null;
    let creatorHistoryBlockTimeMs: number | null = null;
    if (![...devWalletRoles.values()].includes("creator")) {
      const creatorResolution = await getLikelyMintCreatorWallet(mintAddress);
      if (isLikelySolanaWallet(creatorResolution?.walletAddress)) {
        creatorHistoryWalletAddress = creatorResolution.walletAddress;
        creatorHistoryBlockTimeMs = creatorResolution.blockTimeMs ?? null;
        if (!devWalletRoles.has(creatorResolution.walletAddress)) {
          devWalletRoles.set(creatorResolution.walletAddress, "creator");
        }
      }
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
    const [walletActivityEntries, devWalletProfileEntries, authorityAssetSummaryEntries, devHoldingEntries] = await Promise.all([
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
        [...devWalletRoles.keys()].map(async (address) => [
          address,
          await getWalletActivityProfile({
            walletAddress: address,
            sinceMs: null,
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
    const devWalletProfileMap = new Map<string, Awaited<ReturnType<typeof getWalletActivityProfile>>>(devWalletProfileEntries);
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

    const hydratedTopHolders = topHoldersBase.map((holder) => {
      const walletAddress = holder.ownerAddress ?? holder.address;
      const activity = walletActivityMap.get(walletAddress) ?? null;
      const devProfile = devWalletProfileMap.get(walletAddress) ?? null;
      const devRole = devWalletRoles.get(walletAddress) ?? null;
      const authorityHeuristic = authorityHeuristicMap.get(walletAddress) ?? {
        authorityAssetCount: null,
        ruggedDeploymentCount: 0,
      };

      return {
        ...holder,
        label:
          devRole === "creator" && walletAddress === creatorHistoryWalletAddress
            ? "Detected from earliest mint signer"
            : (activity?.distinctMintsTraded ?? devProfile?.distinctMintsTraded ?? 0) > 0
              ? `${activity?.distinctMintsTraded ?? devProfile?.distinctMintsTraded ?? 0} mints traded`
              : null,
        domain: null,
        accountType: null,
        activeAgeDays:
          activity?.observedAgeDays ??
          devProfile?.observedAgeDays ??
          (devRole === "creator" && creatorHistoryBlockTimeMs
            ? Math.max(0.1, Math.round(((Date.now() - creatorHistoryBlockTimeMs) / (24 * 60 * 60 * 1000)) * 10) / 10)
            : null),
        fundedBy: devProfile?.fundedBy ?? activity?.fundedBy ?? null,
        totalValueUsd: holder.valueUsd ?? null,
        tradeVolume90dSol: activity?.totalTradeVolumeSol ?? devProfile?.totalTradeVolumeSol ?? null,
        solBalance: activity?.balanceSol ?? devProfile?.balanceSol ?? null,
        badges: buildHolderBadges({
          supplyPct: holder.supplyPct,
          balanceUsd: activity?.balanceUsd ?? devProfile?.balanceUsd ?? null,
          activeAgeDays:
            activity?.observedAgeDays ??
            devProfile?.observedAgeDays ??
            (devRole === "creator" && creatorHistoryBlockTimeMs
              ? Math.max(0.1, Math.round(((Date.now() - creatorHistoryBlockTimeMs) / (24 * 60 * 60 * 1000)) * 10) / 10)
              : null),
          tradeVolume90dSol: activity?.totalTradeVolumeSol ?? null,
          balanceSol: activity?.balanceSol ?? devProfile?.balanceSol ?? null,
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

    const referenceLiquidityUsd =
      typeof marketSnapshot.liquidityUsd === "number" && Number.isFinite(marketSnapshot.liquidityUsd) && marketSnapshot.liquidityUsd > 0
        ? marketSnapshot.liquidityUsd
        : typeof fallbackLiquidityUsd === "number" && Number.isFinite(fallbackLiquidityUsd) && fallbackLiquidityUsd > 0
          ? fallbackLiquidityUsd
          : null;
    const topHolders = hydratedTopHolders.filter((holder) =>
      !isLikelyLiquidityPoolHolder({
        holder,
        referenceLiquidityUsd,
      })
    );

    const devWallet =
      topHolders.find((holder) => holder.devRole !== null) ??
      (() => {
        const [walletAddress, devRole] = devWalletRoles.entries().next().value ?? [];
        if (!isLikelySolanaWallet(walletAddress) || !devRole) return null;
        const activity = walletActivityMap.get(walletAddress) ?? null;
        const devProfile = devWalletProfileMap.get(walletAddress) ?? null;
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
              ? walletAddress === creatorHistoryWalletAddress
                ? "Detected from earliest mint signer"
                : "Detected from token creation authority"
              : devRole === "mint_authority"
                ? "Detected from mint authority on-chain"
                : "Detected from freeze authority on-chain",
          domain: null,
          accountType: null,
          activeAgeDays:
            activity?.observedAgeDays ??
            devProfile?.observedAgeDays ??
            (devRole === "creator" && creatorHistoryBlockTimeMs
              ? Math.max(0.1, Math.round(((Date.now() - creatorHistoryBlockTimeMs) / (24 * 60 * 60 * 1000)) * 10) / 10)
              : null),
          fundedBy: devProfile?.fundedBy ?? activity?.fundedBy ?? null,
          totalValueUsd: devHolding?.holdingUsd ?? null,
          tradeVolume90dSol: activity?.totalTradeVolumeSol ?? devProfile?.totalTradeVolumeSol ?? null,
          solBalance: activity?.balanceSol ?? devProfile?.balanceSol ?? null,
          badges: buildHolderBadges({
            supplyPct,
            balanceUsd: activity?.balanceUsd ?? devProfile?.balanceUsd ?? null,
            activeAgeDays:
              activity?.observedAgeDays ??
              devProfile?.observedAgeDays ??
              (devRole === "creator" && creatorHistoryBlockTimeMs
                ? Math.max(0.1, Math.round(((Date.now() - creatorHistoryBlockTimeMs) / (24 * 60 * 60 * 1000)) * 10) / 10)
                : null),
            tradeVolume90dSol: activity?.totalTradeVolumeSol ?? null,
            balanceSol: activity?.balanceSol ?? devProfile?.balanceSol ?? null,
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
      return pct >= 1;
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
    const minimumObservedHolderCount = topHolders.length;
    const normalizedObservedHolderCount = minimumObservedHolderCount > 0 ? minimumObservedHolderCount : 0;
    const heliusHolderCount =
      typeof heliusHolderSummary === "number" &&
      Number.isFinite(heliusHolderSummary) &&
      heliusHolderSummary > 0
        ? Math.round(heliusHolderSummary)
        : 0;
    const rpcHolderCount = countCurrentHolderWalletsFromProgramAccounts(holderAccountsResult);
    const normalizedBirdeyeHolderCount =
      typeof birdeyeHolderCount === "number" && Number.isFinite(birdeyeHolderCount)
        ? Math.round(birdeyeHolderCount)
        : null;
    const isSuspiciousBirdeyeHolderCount = isSuspiciousResolvedHolderCount({
      holderCount: normalizedBirdeyeHolderCount,
      holderCountSource: "birdeye",
      minimumObservedHolderCount: normalizedObservedHolderCount,
    });

    const isPlausibleHolderCount = (value: number | null | undefined): value is number =>
      typeof value === "number" &&
      Number.isFinite(value) &&
      value > 0 &&
      value >= normalizedObservedHolderCount;

    if (isPlausibleHolderCount(rpcHolderCount)) {
      holderCount = rpcHolderCount;
      holderCountSource = "rpc_scan";
    } else if (isPlausibleHolderCount(heliusHolderCount)) {
      // Trust the paginated Helius count directly — getHeliusCurrentHolderOwnerCount
      // already returns null for any ambiguous/truncated result, so a non-null value
      // here is a verified unique-owner count.
      holderCount = heliusHolderCount;
      holderCountSource = "helius";
    } else if (
      normalizedBirdeyeHolderCount !== null &&
      !isSuspiciousBirdeyeHolderCount &&
      isPlausibleHolderCount(normalizedBirdeyeHolderCount)
    ) {
      holderCount = normalizedBirdeyeHolderCount;
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
      const needsFollowUpVisibleRefresh = needsVisibleDistributionRefresh(snapshot);
      tokenDistributionCache.set(cacheKey, {
        value: cloneDistributionSnapshot(snapshot),
        expiresAtMs: Date.now() + TOKEN_DISTRIBUTION_CACHE_TTL_MS,
        staleExpiresAtMs: Date.now() + TOKEN_DISTRIBUTION_STALE_TTL_MS,
        nextRefreshAllowedAtMs: Date.now() +
          (needsFollowUpVisibleRefresh
            ? TOKEN_DISTRIBUTION_VISIBLE_REFRESH_MS
            : TOKEN_DISTRIBUTION_CACHE_TTL_MS),
      });
      return snapshot;
    })
    .catch((error) => {
      const previous = tokenDistributionCache.get(cacheKey);
      if (previous && previous.staleExpiresAtMs > Date.now()) {
        tokenDistributionCache.set(cacheKey, {
          ...previous,
          nextRefreshAllowedAtMs: Date.now() + TOKEN_DISTRIBUTION_RETRY_MS,
        });
      }
      throw error;
    })
    .finally(() => {
      tokenDistributionInFlight.delete(cacheKey);
    });

  tokenDistributionInFlight.set(cacheKey, request);
  return cloneDistributionSnapshot(await request);
}

export function peekCachedSolanaTokenDistribution(mintAddress: string): TokenDistributionSnapshot | null {
  const cacheKey = mintAddress.trim();
  const cached = tokenDistributionCache.get(cacheKey);
  if (!cached) {
    return null;
  }
  if (cached.staleExpiresAtMs <= Date.now()) {
    tokenDistributionCache.delete(cacheKey);
    return null;
  }
  return cloneDistributionSnapshot(cached.value);
}
