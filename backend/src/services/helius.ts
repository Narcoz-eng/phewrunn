type WalletTradeSnapshot = {
  source: "helius";
  totalPnlUsd: number | null;
  realizedPnlUsd: number | null;
  unrealizedPnlUsd: number | null;
  boughtUsd: number | null;
  soldUsd: number | null;
  holdingUsd: number | null;
  holdingAmount: number | null;
  boughtAmount?: number | null;
  soldAmount?: number | null;
  netAmount?: number | null;
};

export type HeliusTokenMetadata = {
  source: "helius";
  tokenName: string | null;
  tokenSymbol: string | null;
  tokenImage: string | null;
  creator: string | null;
  updateAuthority: string | null;
  mintAuthority: string | null;
  freezeAuthority: string | null;
  authorityAddresses: string[];
  creatorAddresses: string[];
};

export type HeliusTradePanelContext = {
  source: "helius";
  walletAddress: string;
  tokenMint: string;
  walletNativeBalance: number | null;
  walletTokenBalance: number | null;
  tokenDecimals: number | null;
};

export type WalletPortfolioOverview = {
  source: "helius";
  walletAddress: string;
  balanceSol: number | null;
  balanceUsd: number | null;
  totalVolumeBoughtSol: number | null;
  totalVolumeSoldSol: number | null;
  totalVolumeBoughtUsd: number | null;
  totalVolumeSoldUsd: number | null;
  totalProfitUsd: number | null;
  tokens: Record<string, WalletTradeSnapshot>;
};

export type WalletActivityProfile = {
  source: "helius";
  walletAddress: string;
  balanceSol: number | null;
  balanceUsd: number | null;
  nonBaseTokenHoldingsUsd: number | null;
  totalTradeVolumeSol: number | null;
  distinctMintsTraded: number;
  observedAgeDays: number | null;
  observedTxCount: number;
  lastSeenHours: number | null;
  fundedBy: string | null;
};

type HeliusTokenHolding = {
  amount: number;
  decimals?: number | null;
};

type TokenTradeAggregate = {
  boughtAmount: number;
  soldAmount: number;
  boughtSol: number;
  soldSol: number;
};

type WalletBaseSnapshot = {
  walletAddress: string;
  balanceSol: number | null;
  solPriceUsd: number | null;
  holdingsByMint: Map<string, HeliusTokenHolding>;
  tradeByMint: Map<string, TokenTradeAggregate>;
  observedFirstActivityAtMs: number | null;
  observedLastActivityAtMs: number | null;
  observedTxCount: number;
  fundedBy: string | null;
};

type PortfolioTokenInput = {
  mint: string;
  chainType?: string | null;
};

type RpcTokenAmount = {
  uiAmount?: number | null;
  uiAmountString?: string;
  amount?: string;
  decimals?: number;
};

type RpcTokenAccountResponse = {
  account?: {
    data?: {
      parsed?: {
        info?: {
          mint?: string;
          tokenAmount?: RpcTokenAmount;
        };
      };
    };
  };
};

type HeliusEnhancedTx = {
  signature?: string;
  timestamp?: number;
  type?: string;
  nativeTransfers?: Array<{
    fromUserAccount?: string | null;
    toUserAccount?: string | null;
    amount?: number | string | null;
  }> | null;
  tokenTransfers?: Array<{
    mint?: string;
    tokenAmount?: number | string;
    fromUserAccount?: string | null;
    toUserAccount?: string | null;
  }>;
  events?: {
    swap?: {
      nativeInput?: {
        account?: string | null;
        amount?: number | string | null;
      };
      nativeOutput?: {
        account?: string | null;
        amount?: number | string | null;
      };
      tokenInputs?: Array<{
        userAccount?: string | null;
        mint?: string | null;
        tokenAmount?: number | string | null;
        rawTokenAmount?: {
          tokenAmount?: string | number | null;
          decimals?: number | null;
        } | null;
      }>;
      tokenOutputs?: Array<{
        userAccount?: string | null;
        mint?: string | null;
        tokenAmount?: number | string | null;
        rawTokenAmount?: {
          tokenAmount?: string | number | null;
          decimals?: number | null;
        } | null;
      }>;
    };
  };
};

type HeliusTokenAccountRecord = {
  address?: string | null;
  mint?: string | null;
  owner?: string | null;
  amount?: number | string | null;
  delegated_amount?: number | string | null;
  frozen?: boolean | null;
  burnt?: boolean | null;
};

type HeliusTokenAccountsResponse = {
  total?: number | string | null;
  limit?: number | string | null;
  cursor?: string | null;
  token_accounts?: HeliusTokenAccountRecord[] | null;
};

type HeliusAssetsByAuthorityResponse = {
  total?: number | string | null;
  items?: Array<{
    id?: string | null;
  }> | null;
};

export type HeliusTokenAccountSummary = {
  source: "helius";
  mint: string;
  total: number | null;
  cursor: string | null;
  tokenAccounts: Array<{
    address: string;
    owner: string | null;
    amount: number | null;
  }>;
};

export type HeliusAuthorityAssetSummary = {
  source: "helius";
  authorityAddress: string;
  total: number | null;
  mintAddresses: string[];
};

export type ParsedSolanaInstruction = {
  program?: string;
  programId?: string;
  parsed?: unknown;
  accounts?: string[];
  data?: string;
};

export type ParsedSolanaTransaction = {
  blockTime?: number | null;
  meta?: {
    err?: unknown;
    innerInstructions?: Array<{
      instructions?: ParsedSolanaInstruction[] | null;
    } | null> | null;
  } | null;
  transaction?: {
    message?: {
      accountKeys?: Array<
        | string
        | {
            pubkey?: string;
            signer?: boolean;
            writable?: boolean;
          }
      > | null;
      instructions?: ParsedSolanaInstruction[] | null;
    } | null;
  } | null;
};

type RpcSignatureForAddressResult = Array<{
  signature?: string | null;
  blockTime?: number | null;
  err?: unknown;
}>;

export type MintCreatorResolution = {
  source: "helius";
  walletAddress: string;
  reason: "mint_initialize_signer" | "mint_history_signer";
  signature: string | null;
  blockTimeMs: number | null;
};

import { heliusCircuit } from "../lib/circuit-breaker.js";

const HELIUS_RPC_URL =
  process.env.HELIUS_RPC_URL?.trim() ||
  process.env.HELIUS_RPC_ENDPOINT?.trim() ||
  null;

const WRAPPED_SOL_MINT = "So11111111111111111111111111111111111111112";
const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const USDT_MINT = "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB";
const SYSTEM_PROGRAM_ID = "11111111111111111111111111111111";
const SOLANA_WALLET_REGEX = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const TOKEN_PROGRAM_ID = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const HELIUS_CACHE_TTL_MS = process.env.NODE_ENV === "production" ? 45_000 : 10_000;
const WALLET_BASE_CACHE_TTL_MS = process.env.NODE_ENV === "production" ? 5 * 60_000 : 30_000;
const DEX_PRICE_CACHE_TTL_MS = process.env.NODE_ENV === "production" ? 60_000 : 15_000;
const HELIUS_METADATA_CACHE_TTL_MS = process.env.NODE_ENV === "production" ? 24 * 60 * 60_000 : 5 * 60_000;
const HELIUS_MAX_TX_PAGES = process.env.NODE_ENV === "production" ? 5 : 2;
const HELIUS_TX_PAGE_LIMIT = 100;

const heliusSnapshotCache = new Map<string, { value: WalletTradeSnapshot | null; expiresAtMs: number }>();
const heliusSnapshotInFlight = new Map<string, Promise<WalletTradeSnapshot | null>>();
const walletBaseCache = new Map<string, { value: WalletBaseSnapshot | null; expiresAtMs: number }>();
const walletBaseInFlight = new Map<string, Promise<WalletBaseSnapshot | null>>();
const dexPriceCache = new Map<string, { priceUsd: number | null; expiresAtMs: number }>();
const dexPriceInFlight = new Map<string, Promise<number | null>>();
const heliusTokenMetadataCache = new Map<string, { value: HeliusTokenMetadata | null; expiresAtMs: number }>();
const heliusTokenMetadataInFlight = new Map<string, Promise<HeliusTokenMetadata | null>>();
const heliusTokenDecimalsCache = new Map<string, { value: number | null; expiresAtMs: number }>();
const heliusTokenDecimalsInFlight = new Map<string, Promise<number | null>>();
const heliusMintHolderCache = new Map<string, { value: HeliusTokenAccountSummary | null; expiresAtMs: number }>();
const heliusMintHolderInFlight = new Map<string, Promise<HeliusTokenAccountSummary | null>>();
const heliusAuthorityAssetSummaryCache = new Map<string, { value: HeliusAuthorityAssetSummary | null; expiresAtMs: number }>();
const heliusAuthorityAssetSummaryInFlight = new Map<string, Promise<HeliusAuthorityAssetSummary | null>>();
const heliusMintCreatorCache = new Map<string, { value: MintCreatorResolution | null; expiresAtMs: number }>();
const heliusMintCreatorInFlight = new Map<string, Promise<MintCreatorResolution | null>>();
const heliusTradePanelContextCache = new Map<string, { value: HeliusTradePanelContext | null; expiresAtMs: number }>();
const heliusTradePanelContextInFlight = new Map<string, Promise<HeliusTradePanelContext | null>>();
const NON_BASE_TOKEN_EXCLUDE_MINTS = new Set<string>([WRAPPED_SOL_MINT, USDC_MINT, USDT_MINT]);

function isLikelySolanaAddress(value: string | null | undefined): value is string {
  return typeof value === "string" && SOLANA_WALLET_REGEX.test(value);
}

function normalizeAddress(value: string | null | undefined): string | null {
  if (!value) return null;
  return value.trim();
}

function buildEmptyTradeSnapshot(): WalletTradeSnapshot {
  return {
    source: "helius",
    totalPnlUsd: null,
    realizedPnlUsd: null,
    unrealizedPnlUsd: null,
    boughtUsd: null,
    soldUsd: null,
    holdingUsd: null,
    holdingAmount: null,
    boughtAmount: null,
    soldAmount: null,
    netAmount: null,
  };
}

function parseHeliusUrlParts() {
  if (!HELIUS_RPC_URL) return null;
  try {
    const rpcUrl = new URL(HELIUS_RPC_URL);
    const apiKey = rpcUrl.searchParams.get("api-key") || rpcUrl.searchParams.get("api_key");
    const candidateOrigins = [rpcUrl.origin];
    if (!rpcUrl.hostname.startsWith("api-")) {
      candidateOrigins.push(`${rpcUrl.protocol}//api-${rpcUrl.hostname}`);
    }
    candidateOrigins.push("https://api.helius.xyz");
    return {
      rpcUrl,
      apiKey,
      enhancedApiOrigins: [...new Set(candidateOrigins)],
    };
  } catch {
    return null;
  }
}

async function heliusRpcCall<T>(method: string, params: unknown, id: string): Promise<T | null> {
  if (!HELIUS_RPC_URL) return null;
  // Fast-fail if Helius is having an outage — skip the 6s timeout wait
  if (heliusCircuit.isOpen()) return null;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 6000);
  try {
    const response = await fetch(HELIUS_RPC_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id,
        method,
        params,
      }),
      signal: controller.signal,
    });
    if (response.status >= 500) {
      heliusCircuit.recordFailure();
      return null;
    }
    if (!response.ok) return null;
    const payload = (await response.json()) as { result?: T; error?: unknown };
    if (payload.error) return null;
    heliusCircuit.recordSuccess();
    return payload.result ?? null;
  } catch {
    heliusCircuit.recordFailure();
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

export async function getParsedSolanaTransaction(
  signature: string
): Promise<ParsedSolanaTransaction | null> {
  const normalizedSignature = signature.trim();
  if (!normalizedSignature) return null;

  return await heliusRpcCall<ParsedSolanaTransaction>(
    "getTransaction",
    [
      normalizedSignature,
      {
        encoding: "jsonParsed",
        commitment: "confirmed",
        maxSupportedTransactionVersion: 0,
      },
    ],
    `tx-${normalizedSignature.slice(0, 12)}`
  );
}

function readParsedInstructionType(instruction: ParsedSolanaInstruction | null | undefined): string | null {
  if (!instruction?.parsed || typeof instruction.parsed !== "object") return null;
  const type = (instruction.parsed as Record<string, unknown>).type;
  return typeof type === "string" && type.trim().length > 0 ? type.trim() : null;
}

function readInstructionMintAddress(
  instruction: ParsedSolanaInstruction | null | undefined
): string | null {
  if (!instruction?.parsed || typeof instruction.parsed !== "object") return null;
  const info = (instruction.parsed as Record<string, unknown>).info;
  if (!info || typeof info !== "object") return null;
  const candidate =
    readNonEmptyString((info as Record<string, unknown>).mint) ??
    readNonEmptyString((info as Record<string, unknown>).account);
  return isLikelySolanaAddress(candidate) ? candidate : null;
}

function readTransactionSignerKeys(transaction: ParsedSolanaTransaction): string[] {
  const accountKeys = transaction.transaction?.message?.accountKeys ?? [];
  const explicitSigners = accountKeys
    .map((entry) => {
      if (!entry || typeof entry !== "object") return null;
      const record = entry as Record<string, unknown>;
      if (record.signer !== true) return null;
      return readNonEmptyString(record.pubkey);
    })
    .filter((entry): entry is string => isLikelySolanaAddress(entry));
  if (explicitSigners.length > 0) {
    return explicitSigners;
  }

  const legacyFeePayer = accountKeys[0];
  return typeof legacyFeePayer === "string" && isLikelySolanaAddress(legacyFeePayer)
    ? [legacyFeePayer]
    : [];
}

function readTransactionInstructions(transaction: ParsedSolanaTransaction): ParsedSolanaInstruction[] {
  const outer = transaction.transaction?.message?.instructions ?? [];
  const inner = transaction.meta?.innerInstructions ?? [];
  return [
    ...outer.filter((instruction): instruction is ParsedSolanaInstruction => Boolean(instruction)),
    ...inner.flatMap((entry) => (entry?.instructions ?? []).filter((instruction): instruction is ParsedSolanaInstruction => Boolean(instruction))),
  ];
}

function isMintLifecycleInstruction(
  instruction: ParsedSolanaInstruction,
  mintAddress: string
): boolean {
  const type = readParsedInstructionType(instruction);
  if (!type) return false;
  if (!["initializeMint", "initializeMint2", "mintTo", "mintToChecked", "setAuthority"].includes(type)) {
    return false;
  }
  return readInstructionMintAddress(instruction) === mintAddress;
}

function readNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export async function getLikelyMintCreatorWallet(
  mintAddress: string | null | undefined
): Promise<MintCreatorResolution | null> {
  if (!HELIUS_RPC_URL) return null;
  if (!isLikelySolanaAddress(mintAddress)) return null;

  const mint = mintAddress;
  const now = Date.now();
  const cached = heliusMintCreatorCache.get(mint);
  if (cached && cached.expiresAtMs > now) return cached.value;
  const inFlight = heliusMintCreatorInFlight.get(mint);
  if (inFlight) return inFlight;

  const request = (async (): Promise<MintCreatorResolution | null> => {
    const signatures = await heliusRpcCall<RpcSignatureForAddressResult>(
      "getSignaturesForAddress",
      [mint, { limit: 12, commitment: "confirmed" }],
      `mint-sigs-${mint.slice(0, 8)}`
    );
    if (!Array.isArray(signatures) || signatures.length === 0) {
      return null;
    }

    const orderedSignatures = signatures
      .filter((entry) => typeof entry?.signature === "string" && entry.signature.trim().length > 0)
      .reverse();
    let fallback: MintCreatorResolution | null = null;

    for (const entry of orderedSignatures) {
      const signature = entry.signature?.trim() ?? "";
      if (!signature || entry.err) continue;
      const transaction = await getParsedSolanaTransaction(signature);
      if (!transaction || transaction.meta?.err) continue;

      const signerKeys = readTransactionSignerKeys(transaction).filter(
        (address) => address !== mint && address !== SYSTEM_PROGRAM_ID
      );
      if (signerKeys.length === 0) continue;

      const primarySigner = signerKeys[0]!;
      const blockTimeMs = normalizeTsToMs(entry.blockTime ?? transaction.blockTime ?? undefined);
      if (!fallback) {
        fallback = {
          source: "helius",
          walletAddress: primarySigner,
          reason: "mint_history_signer",
          signature,
          blockTimeMs,
        };
      }

      const hasMintLifecycleInstruction = readTransactionInstructions(transaction).some((instruction) =>
        isMintLifecycleInstruction(instruction, mint)
      );
      if (hasMintLifecycleInstruction) {
        return {
          source: "helius",
          walletAddress: primarySigner,
          reason: "mint_initialize_signer",
          signature,
          blockTimeMs,
        };
      }
    }

    return fallback;
  })().finally(() => {
    heliusMintCreatorInFlight.delete(mint);
  });

  heliusMintCreatorInFlight.set(mint, request);
  const value = await request;
  heliusMintCreatorCache.set(mint, {
    value,
    expiresAtMs: now + HELIUS_METADATA_CACHE_TTL_MS,
  });
  return value;
}

function readHeliusAssetImage(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const obj = payload as Record<string, unknown>;

  const links = obj.links as Record<string, unknown> | undefined;
  const linksImage = readNonEmptyString(links?.image);
  if (linksImage) return linksImage;

  const content = obj.content as Record<string, unknown> | undefined;
  const files = Array.isArray(content?.files) ? content?.files : null;
  if (files) {
    for (const file of files) {
      if (!file || typeof file !== "object") continue;
      const fileObj = file as Record<string, unknown>;
      const image =
        readNonEmptyString(fileObj.cdn_uri) ||
        readNonEmptyString(fileObj.uri);
      if (image) return image;
    }
  }

  const metadata = obj.metadata as Record<string, unknown> | undefined;
  return readNonEmptyString(metadata?.image);
}

function parseFiniteNumber(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function readAddressArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => {
      if (typeof entry === "string") return readNonEmptyString(entry);
      if (!entry || typeof entry !== "object") return null;
      const record = entry as Record<string, unknown>;
      return (
        readNonEmptyString(record.address) ||
        readNonEmptyString(record.owner) ||
        readNonEmptyString(record.account)
      );
    })
    .filter((entry): entry is string => isLikelySolanaAddress(entry));
}

function readHeliusAssetMetadata(payload: unknown): HeliusTokenMetadata | null {
  if (!payload || typeof payload !== "object") return null;
  const obj = payload as Record<string, unknown>;
  const content = obj.content as Record<string, unknown> | undefined;
  const contentMetadata = content?.metadata as Record<string, unknown> | undefined;
  const metadata = obj.metadata as Record<string, unknown> | undefined;
  const tokenInfo = obj.token_info as Record<string, unknown> | undefined;
  const authorities = readAddressArray(obj.authorities);
  const creators = [
    ...readAddressArray(obj.creators),
    ...readAddressArray(contentMetadata?.creators),
    ...readAddressArray(metadata?.creators),
  ];
  const updateAuthority = authorities[0] ?? null;
  const creator =
    creators[0] ??
    readNonEmptyString(obj.ownership && typeof obj.ownership === "object" ? (obj.ownership as Record<string, unknown>).owner : null) ??
    updateAuthority;
  const mintAuthority = readNonEmptyString(tokenInfo?.mint_authority);
  const freezeAuthority = readNonEmptyString(tokenInfo?.freeze_authority);

  const tokenName =
    readNonEmptyString(contentMetadata?.name) ||
    readNonEmptyString(metadata?.name) ||
    readNonEmptyString(tokenInfo?.name);
  const tokenSymbol =
    readNonEmptyString(contentMetadata?.symbol) ||
    readNonEmptyString(metadata?.symbol) ||
    readNonEmptyString(tokenInfo?.symbol);
  const tokenImage = readHeliusAssetImage(payload);

  if (
    !tokenName &&
    !tokenSymbol &&
    !tokenImage &&
    !creator &&
    !updateAuthority &&
    !mintAuthority &&
    !freezeAuthority
  ) {
    return null;
  }

  return {
    source: "helius",
    tokenName: tokenName ?? null,
    tokenSymbol: tokenSymbol ?? null,
    tokenImage: tokenImage ?? null,
    creator: creator ?? null,
    updateAuthority,
    mintAuthority: isLikelySolanaAddress(mintAuthority) ? mintAuthority : null,
    freezeAuthority: isLikelySolanaAddress(freezeAuthority) ? freezeAuthority : null,
    authorityAddresses: authorities,
    creatorAddresses: creators,
  };
}

function readUiTokenAmount(tokenAmount: RpcTokenAmount | undefined): number {
  if (!tokenAmount) return 0;
  if (typeof tokenAmount.uiAmount === "number") return Number.isFinite(tokenAmount.uiAmount) ? tokenAmount.uiAmount : 0;
  if (typeof tokenAmount.uiAmountString === "string") {
    const parsed = Number(tokenAmount.uiAmountString);
    if (Number.isFinite(parsed)) return parsed;
  }
  if (typeof tokenAmount.amount === "string") {
    const raw = Number(tokenAmount.amount);
    const decimals = typeof tokenAmount.decimals === "number" ? tokenAmount.decimals : 0;
    if (Number.isFinite(raw)) return raw / Math.pow(10, decimals);
  }
  return 0;
}

async function fetchWalletTokenHoldings(ownerWallet: string): Promise<Map<string, HeliusTokenHolding> | null> {
  const result = await heliusRpcCall<{ value?: RpcTokenAccountResponse[] }>(
    "getTokenAccountsByOwner",
    [ownerWallet, { programId: TOKEN_PROGRAM_ID }, { encoding: "jsonParsed", commitment: "confirmed" }],
    `token-accounts-${ownerWallet.slice(0, 6)}`
  );
  if (!result) return null;

  const holdings = new Map<string, HeliusTokenHolding>();
  for (const account of result.value ?? []) {
    const info = account.account?.data?.parsed?.info;
    const mint = normalizeAddress(info?.mint);
    if (!mint) continue;
    const amount = readUiTokenAmount(info?.tokenAmount);
    const existing = holdings.get(mint);
    const decimals =
      typeof info?.tokenAmount?.decimals === "number" && Number.isFinite(info.tokenAmount.decimals)
        ? info.tokenAmount.decimals
        : existing?.decimals ?? null;
    holdings.set(mint, {
      amount: (existing?.amount ?? 0) + amount,
      decimals,
    });
  }
  return holdings;
}

async function fetchWalletSolBalance(ownerWallet: string): Promise<number | null> {
  const result = await heliusRpcCall<{ value?: number }>(
    "getBalance",
    [ownerWallet, { commitment: "confirmed" }],
    `sol-balance-${ownerWallet.slice(0, 6)}`
  );
  if (!result || typeof result.value !== "number") return null;
  return result.value / 1_000_000_000;
}

async function fetchTokenSupplyDecimals(mint: string): Promise<number | null> {
  if (!isLikelySolanaAddress(mint)) return null;

  const now = Date.now();
  const cached = heliusTokenDecimalsCache.get(mint);
  if (cached && cached.expiresAtMs > now) {
    return cached.value;
  }

  const inFlight = heliusTokenDecimalsInFlight.get(mint);
  if (inFlight) {
    return inFlight;
  }

  const request = (async () => {
    const response = await heliusRpcCall<{ value?: { decimals?: number | null } }>(
      "getTokenSupply",
      [mint, { commitment: "confirmed" }],
      `token-supply-${mint.slice(0, 8)}`
    );
    const decimals =
      typeof response?.value?.decimals === "number" && Number.isFinite(response.value.decimals)
        ? response.value.decimals
        : null;
    heliusTokenDecimalsCache.set(mint, {
      value: decimals,
      expiresAtMs: Date.now() + HELIUS_METADATA_CACHE_TTL_MS,
    });
    return decimals;
  })().finally(() => {
    heliusTokenDecimalsInFlight.delete(mint);
  });

  heliusTokenDecimalsInFlight.set(mint, request);
  return request;
}

async function fetchDexTokenPriceUsd(mint: string): Promise<number | null> {
  const now = Date.now();
  const cached = dexPriceCache.get(mint);
  if (cached && cached.expiresAtMs > now) return cached.priceUsd;
  const inFlight = dexPriceInFlight.get(mint);
  if (inFlight) return inFlight;

  const request = (async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    try {
      const response = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${mint}`, {
        headers: { Accept: "application/json" },
        signal: controller.signal,
      });
      if (!response.ok) return null;
      const payload = (await response.json()) as { pairs?: Array<{ priceUsd?: string | number | null }> | null };
      const pair = payload.pairs?.[0];
      if (!pair?.priceUsd) return null;
      const parsed = typeof pair.priceUsd === "number" ? pair.priceUsd : Number(pair.priceUsd);
      return Number.isFinite(parsed) ? parsed : null;
    } catch {
      return null;
    } finally {
      clearTimeout(timeout);
    }
  })().finally(() => {
    dexPriceInFlight.delete(mint);
  });

  dexPriceInFlight.set(mint, request);
  const priceUsd = await request;
  dexPriceCache.set(mint, { priceUsd, expiresAtMs: Date.now() + DEX_PRICE_CACHE_TTL_MS });
  return priceUsd;
}

function readAmount(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function readTokenAmountFromSwapNode(node: {
  tokenAmount?: number | string | null;
  rawTokenAmount?: { tokenAmount?: string | number | null; decimals?: number | null } | null;
} | null | undefined): number | null {
  if (!node) return null;
  const direct = readAmount(node.tokenAmount);
  if (direct !== null) return direct;
  const raw = node.rawTokenAmount;
  if (!raw) return null;
  const rawAmount = readAmount(raw.tokenAmount);
  const decimals = typeof raw.decimals === "number" ? raw.decimals : 0;
  if (rawAmount === null) return null;
  return rawAmount / Math.pow(10, decimals);
}

function normalizeTsToMs(ts: number | undefined): number | null {
  if (typeof ts !== "number" || !Number.isFinite(ts)) return null;
  // Helius timestamps are seconds.
  return ts > 10_000_000_000 ? ts : ts * 1000;
}

/**
 * Lightweight fallback using standard getSignaturesForAddress RPC (no API key needed).
 * Fetches up to 1000 recent signatures to determine:
 *   - lastActivityAtMs  — when the wallet was last seen (for lastSeenHours)
 *   - firstActivityAtMs — oldest of ALL fetched sigs, or null if we hit the limit
 *                         (if we got exactly 1000 results there are even older txs;
 *                          in that case we can't cheaply determine true wallet age
 *                          and return null so the wallet is NOT misclassified as fresh)
 *   - txCount           — transactions within the optional sinceMs window
 */
async function fetchWalletSignatureTimings(params: {
  walletAddress: string;
  sinceMs?: number | null;
}): Promise<{ txCount: number; firstActivityAtMs: number | null; lastActivityAtMs: number | null }> {
  const FETCH_LIMIT = 1000;
  type SigEntry = { signature: string; blockTime?: number | null; err?: unknown };
  const signatures = await heliusRpcCall<SigEntry[]>(
    "getSignaturesForAddress",
    [params.walletAddress, { limit: FETCH_LIMIT, commitment: "confirmed" }],
    `wallet-sig-timings-${params.walletAddress.slice(0, 8)}`
  );

  if (!Array.isArray(signatures) || signatures.length === 0) {
    return { txCount: 0, firstActivityAtMs: null, lastActivityAtMs: null };
  }

  // getSignaturesForAddress returns reverse-chronological order.
  const allTimestamps = signatures
    .filter((s) => !s.err)
    .map((s) => normalizeTsToMs(s.blockTime ?? undefined))
    .filter((t): t is number => t !== null);

  if (allTimestamps.length === 0) {
    return { txCount: 0, firstActivityAtMs: null, lastActivityAtMs: null };
  }

  const lastActivityAtMs = Math.max(...allTimestamps);

  // If we received exactly FETCH_LIMIT results the wallet has even older transactions
  // we didn't fetch. We cannot determine true wallet age cheaply, so return null for
  // firstActivityAtMs to prevent old high-activity wallets being tagged as fresh.
  const hitLimit = signatures.length >= FETCH_LIMIT;
  const firstActivityAtMs = hitLimit ? null : Math.min(...allTimestamps);

  // txCount = how many of those fall inside the activity lookback window
  const txCount = params.sinceMs
    ? allTimestamps.filter((t) => t >= params.sinceMs!).length
    : allTimestamps.length;

  return { txCount, firstActivityAtMs, lastActivityAtMs };
}

async function fetchEnhancedTransactionsByAddress(params: {
  walletAddress: string;
  sinceMs?: number | null;
}): Promise<HeliusEnhancedTx[]> {
  const parts = parseHeliusUrlParts();
  if (!parts?.apiKey) return [];

  const results: HeliusEnhancedTx[] = [];
  let before: string | null = null;

  for (let page = 0; page < HELIUS_MAX_TX_PAGES; page++) {
    let pageData: HeliusEnhancedTx[] | null = null;

    for (const origin of parts.enhancedApiOrigins) {
      const url = new URL(`${origin.replace(/\/$/, "")}/v0/addresses/${params.walletAddress}/transactions`);
      url.searchParams.set("api-key", parts.apiKey);
      url.searchParams.set("limit", String(HELIUS_TX_PAGE_LIMIT));
      if (before) url.searchParams.set("before", before);

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 7000);
      try {
        const response = await fetch(url.toString(), { signal: controller.signal });
        if (!response.ok) continue;
        const parsed = (await response.json()) as unknown;
        if (Array.isArray(parsed)) {
          pageData = parsed as HeliusEnhancedTx[];
          break;
        }
      } catch {
        // try next origin
      } finally {
        clearTimeout(timeout);
      }
    }

    if (!pageData || pageData.length === 0) break;
    results.push(...pageData);

    const last = pageData[pageData.length - 1];
    before = last?.signature ?? null;
    if (!before) break;

    if (params.sinceMs) {
      const oldestMs = normalizeTsToMs(last?.timestamp);
      if (oldestMs !== null && oldestMs < params.sinceMs) {
        break;
      }
    }
  }

  return results;
}

function getTradeAgg(tradeByMint: Map<string, TokenTradeAggregate>, mint: string): TokenTradeAggregate {
  const existing = tradeByMint.get(mint);
  if (existing) return existing;
  const created: TokenTradeAggregate = { boughtAmount: 0, soldAmount: 0, boughtSol: 0, soldSol: 0 };
  tradeByMint.set(mint, created);
  return created;
}

function aggregateWalletTradesFromEnhancedTx(params: {
  walletAddress: string;
  txs: HeliusEnhancedTx[];
  targetMints?: Set<string>;
  sinceMs?: number | null;
}): Map<string, TokenTradeAggregate> {
  const wallet = params.walletAddress;
  const targetMints = params.targetMints;
  const tradeByMint = new Map<string, TokenTradeAggregate>();

  for (const tx of params.txs) {
    const tsMs = normalizeTsToMs(tx.timestamp);
    if (params.sinceMs && tsMs !== null && tsMs < params.sinceMs) {
      continue;
    }

    const swap = tx.events?.swap;
    if (swap) {
      const nativeInLamports =
        swap.nativeInput?.account === wallet ? (readAmount(swap.nativeInput.amount) ?? 0) : 0;
      const nativeOutLamports =
        swap.nativeOutput?.account === wallet ? (readAmount(swap.nativeOutput.amount) ?? 0) : 0;

      const tokenInputs = swap.tokenInputs ?? [];
      const tokenOutputs = swap.tokenOutputs ?? [];

      for (const input of tokenInputs) {
        if (input.userAccount !== wallet) continue;
        const mint = normalizeAddress(input.mint);
        if (!mint) continue;
        if (targetMints && !targetMints.has(mint)) continue;
        const amount = readTokenAmountFromSwapNode(input);
        if (amount === null || amount <= 0) continue;
        const agg = getTradeAgg(tradeByMint, mint);
        agg.soldAmount += amount;
        if (nativeOutLamports > 0) agg.soldSol += nativeOutLamports / 1_000_000_000;
      }

      for (const output of tokenOutputs) {
        if (output.userAccount !== wallet) continue;
        const mint = normalizeAddress(output.mint);
        if (!mint) continue;
        if (targetMints && !targetMints.has(mint)) continue;
        const amount = readTokenAmountFromSwapNode(output);
        if (amount === null || amount <= 0) continue;
        const agg = getTradeAgg(tradeByMint, mint);
        agg.boughtAmount += amount;
        if (nativeInLamports > 0) agg.boughtSol += nativeInLamports / 1_000_000_000;
      }

      continue;
    }

    // Fallback: use tokenTransfers (amounts only, no SOL cashflow attribution)
    for (const transfer of tx.tokenTransfers ?? []) {
      const mint = normalizeAddress(transfer.mint);
      if (!mint) continue;
      if (targetMints && !targetMints.has(mint)) continue;
      const amount = readAmount(transfer.tokenAmount);
      if (amount === null || amount <= 0) continue;
      const agg = getTradeAgg(tradeByMint, mint);
      if (transfer.toUserAccount === wallet) agg.boughtAmount += amount;
      if (transfer.fromUserAccount === wallet) agg.soldAmount += amount;
    }
  }

  return tradeByMint;
}

function inferWalletFundingSource(params: {
  walletAddress: string;
  txs: HeliusEnhancedTx[];
}): string | null {
  const wallet = params.walletAddress;
  const orderedTxs = [...params.txs].sort((left, right) => {
    const leftTs = normalizeTsToMs(left.timestamp) ?? Number.POSITIVE_INFINITY;
    const rightTs = normalizeTsToMs(right.timestamp) ?? Number.POSITIVE_INFINITY;
    return leftTs - rightTs;
  });

  for (const tx of orderedTxs) {
    for (const transfer of tx.nativeTransfers ?? []) {
      const fromUserAccount = readNonEmptyString(transfer?.fromUserAccount);
      const toUserAccount = readNonEmptyString(transfer?.toUserAccount);
      const amount = readAmount(transfer?.amount);
      if (
        toUserAccount === wallet &&
        fromUserAccount &&
        fromUserAccount !== wallet &&
        amount !== null &&
        amount > 0
      ) {
        return fromUserAccount;
      }
    }
  }

  return null;
}

async function buildWalletBaseSnapshot(params: { walletAddress: string; sinceMs?: number | null }): Promise<WalletBaseSnapshot | null> {
  const [balanceSol, holdingsByMint, solPriceUsd, txs] = await Promise.all([
    fetchWalletSolBalance(params.walletAddress),
    fetchWalletTokenHoldings(params.walletAddress),
    fetchDexTokenPriceUsd(WRAPPED_SOL_MINT),
    fetchEnhancedTransactionsByAddress({ walletAddress: params.walletAddress, sinceMs: params.sinceMs }),
  ]);

  if (balanceSol === null && holdingsByMint === null && txs.length === 0) {
    // Last-resort check via RPC signature list — works without a Helius API key.
    // If even this returns nothing the wallet genuinely has no on-chain history.
    const rpcTimings = await fetchWalletSignatureTimings({
      walletAddress: params.walletAddress,
      sinceMs: params.sinceMs,
    });
    if (rpcTimings.txCount === 0) return null;
    // We have some RPC data but no balance/holdings — return a minimal snapshot
    // so badge logic can at least compute wallet age and activity count.
    return {
      walletAddress: params.walletAddress,
      balanceSol: null,
      solPriceUsd,
      holdingsByMint: new Map(),
      tradeByMint: new Map(),
      observedFirstActivityAtMs: rpcTimings.firstActivityAtMs,
      observedLastActivityAtMs: rpcTimings.lastActivityAtMs,
      observedTxCount: rpcTimings.txCount,
      fundedBy: null,
    };
  }

  const tradeByMint = aggregateWalletTradesFromEnhancedTx({
    walletAddress: params.walletAddress,
    txs,
    sinceMs: params.sinceMs,
  });

  // Compute activity timestamps from enhanced tx data first.
  // If enhanced API returned nothing (no API key), fall back to RPC signature list
  // which provides blockTimes from getSignaturesForAddress without needing the key.
  let observedFirstActivityAtMs: number | null = null;
  let observedLastActivityAtMs: number | null = null;
  let observedTxCount = txs.length;

  if (txs.length > 0) {
    const observedTxTimestamps = txs
      .map((tx) => normalizeTsToMs(tx.timestamp))
      .filter((timestamp): timestamp is number => typeof timestamp === "number" && Number.isFinite(timestamp))
      .sort((left, right) => left - right);
    observedFirstActivityAtMs = observedTxTimestamps[0] ?? null;
    observedLastActivityAtMs = observedTxTimestamps.length > 0
      ? observedTxTimestamps[observedTxTimestamps.length - 1] ?? null
      : null;
  } else {
    // Enhanced tx API returned nothing — use getSignaturesForAddress as fallback.
    // This is a standard RPC method that works with any Solana RPC URL.
    const rpcTimings = await fetchWalletSignatureTimings({
      walletAddress: params.walletAddress,
      sinceMs: params.sinceMs,
    });
    observedFirstActivityAtMs = rpcTimings.firstActivityAtMs;
    observedLastActivityAtMs = rpcTimings.lastActivityAtMs;
    observedTxCount = rpcTimings.txCount;
  }

  return {
    walletAddress: params.walletAddress,
    balanceSol,
    solPriceUsd,
    holdingsByMint: holdingsByMint ?? new Map<string, HeliusTokenHolding>(),
    tradeByMint,
    observedFirstActivityAtMs,
    observedLastActivityAtMs,
    observedTxCount,
    fundedBy: inferWalletFundingSource({ walletAddress: params.walletAddress, txs }),
  };
}

async function getWalletBaseSnapshot(params: { walletAddress: string; sinceMs?: number | null }): Promise<WalletBaseSnapshot | null> {
  const cacheKey = `${params.walletAddress}:${params.sinceMs ?? "all"}`;
  const now = Date.now();
  const cached = walletBaseCache.get(cacheKey);
  if (cached && cached.expiresAtMs > now) return cached.value;
  const inFlight = walletBaseInFlight.get(cacheKey);
  if (inFlight) return inFlight;

  const request = buildWalletBaseSnapshot(params)
    .finally(() => {
      walletBaseInFlight.delete(cacheKey);
    });
  walletBaseInFlight.set(cacheKey, request);
  const value = await request;
  walletBaseCache.set(cacheKey, { value, expiresAtMs: Date.now() + WALLET_BASE_CACHE_TTL_MS });
  return value;
}

function roundMoney(value: number | null): number | null {
  if (value === null || !Number.isFinite(value)) return null;
  return Math.round(value * 100) / 100;
}

async function estimateWalletNonBaseTokenHoldingsUsd(params: {
  base: WalletBaseSnapshot;
  excludeMints?: Array<string | null | undefined>;
}): Promise<number | null> {
  const excludeMints = new Set(
    [
      ...NON_BASE_TOKEN_EXCLUDE_MINTS,
      ...(params.excludeMints ?? []).filter((mint): mint is string => isLikelySolanaAddress(mint)),
    ].map((mint) => mint.trim())
  );
  const candidateMints = [...params.base.holdingsByMint.entries()]
    .filter(([mint, holding]) => !excludeMints.has(mint) && Number.isFinite(holding.amount) && holding.amount > 0)
    .map(([mint]) => mint);
  if (candidateMints.length === 0) {
    return 0;
  }

  const prices = await Promise.all(candidateMints.map(async (mint) => [mint, await fetchDexTokenPriceUsd(mint)] as const));
  let totalUsd = 0;
  let resolvedAnyValue = false;
  for (const [mint, priceUsd] of prices) {
    const amount = params.base.holdingsByMint.get(mint)?.amount ?? 0;
    if (!Number.isFinite(amount) || amount <= 0 || priceUsd === null || !Number.isFinite(priceUsd) || priceUsd <= 0) {
      continue;
    }
    totalUsd += amount * priceUsd;
    resolvedAnyValue = true;
  }

  return resolvedAnyValue ? roundMoney(totalUsd) : null;
}

function buildTokenSnapshotFromBase(params: {
  mint: string;
  base: WalletBaseSnapshot;
  priceUsd: number | null;
}): WalletTradeSnapshot {
  const snapshot = buildEmptyTradeSnapshot();
  const holdingAmount = params.base.holdingsByMint.get(params.mint)?.amount ?? 0;
  const trade = params.base.tradeByMint.get(params.mint);
  const solPriceUsd = params.base.solPriceUsd;

  snapshot.holdingAmount = holdingAmount;
  snapshot.boughtAmount = trade ? trade.boughtAmount : 0;
  snapshot.soldAmount = trade ? trade.soldAmount : 0;
  snapshot.netAmount = (snapshot.boughtAmount ?? 0) - (snapshot.soldAmount ?? 0);

  if (params.priceUsd !== null) {
    snapshot.holdingUsd = roundMoney(holdingAmount * params.priceUsd);
  }

  if (trade && solPriceUsd !== null) {
    snapshot.boughtUsd = roundMoney(trade.boughtSol * solPriceUsd);
    snapshot.soldUsd = roundMoney(trade.soldSol * solPriceUsd);
  }

  if (snapshot.boughtUsd !== null || snapshot.soldUsd !== null || snapshot.holdingUsd !== null) {
    const bought = snapshot.boughtUsd ?? 0;
    const sold = snapshot.soldUsd ?? 0;
    const holding = snapshot.holdingUsd ?? 0;
    snapshot.totalPnlUsd = roundMoney(sold + holding - bought);
  }

  return snapshot;
}

export async function getWalletPortfolioOverviewForPostedTokens(params: {
  walletAddress: string | null | undefined;
  tokens: PortfolioTokenInput[];
  sinceMs?: number | null;
}): Promise<WalletPortfolioOverview | null> {
  if (!HELIUS_RPC_URL) return null;
  if (!isLikelySolanaAddress(params.walletAddress)) return null;

  const uniqueMints = [...new Set(
    params.tokens
      .filter((t) => t.chainType === "solana" && isLikelySolanaAddress(t.mint))
      .map((t) => t.mint)
  )];
  if (uniqueMints.length === 0) return null;

  const base = await getWalletBaseSnapshot({ walletAddress: params.walletAddress, sinceMs: params.sinceMs ?? null });
  if (!base) return null;

  const priceEntries = await Promise.all(uniqueMints.map(async (mint) => [mint, await fetchDexTokenPriceUsd(mint)] as const));
  const priceByMint = new Map<string, number | null>(priceEntries);

  const tokens: Record<string, WalletTradeSnapshot> = {};
  let totalVolumeBoughtSol = 0;
  let totalVolumeSoldSol = 0;
  let totalVolumeBoughtUsd = 0;
  let totalVolumeSoldUsd = 0;
  let totalProfitUsd = 0;
  let hasBoughtUsd = false;
  let hasSoldUsd = false;
  let hasProfitUsd = false;

  for (const mint of uniqueMints) {
    const snapshot = buildTokenSnapshotFromBase({
      mint,
      base,
      priceUsd: priceByMint.get(mint) ?? null,
    });
    tokens[mint] = snapshot;

    const trade = base.tradeByMint.get(mint);
    if (trade) {
      totalVolumeBoughtSol += trade.boughtSol;
      totalVolumeSoldSol += trade.soldSol;
    }
    if (snapshot.boughtUsd !== null) {
      totalVolumeBoughtUsd += snapshot.boughtUsd;
      hasBoughtUsd = true;
    }
    if (snapshot.soldUsd !== null) {
      totalVolumeSoldUsd += snapshot.soldUsd;
      hasSoldUsd = true;
    }
    if (snapshot.totalPnlUsd !== null) {
      totalProfitUsd += snapshot.totalPnlUsd;
      hasProfitUsd = true;
    }
  }

  const balanceUsd = base.balanceSol !== null && base.solPriceUsd !== null
    ? roundMoney(base.balanceSol * base.solPriceUsd)
    : null;

  return {
    source: "helius",
    walletAddress: params.walletAddress,
    balanceSol: base.balanceSol,
    balanceUsd,
    totalVolumeBoughtSol: roundMoney(totalVolumeBoughtSol),
    totalVolumeSoldSol: roundMoney(totalVolumeSoldSol),
    totalVolumeBoughtUsd: hasBoughtUsd ? roundMoney(totalVolumeBoughtUsd) : null,
    totalVolumeSoldUsd: hasSoldUsd ? roundMoney(totalVolumeSoldUsd) : null,
    totalProfitUsd: hasProfitUsd ? roundMoney(totalProfitUsd) : null,
    tokens,
  };
}

export async function getWalletActivityProfile(params: {
  walletAddress: string | null | undefined;
  sinceMs?: number | null;
  excludeMints?: Array<string | null | undefined>;
  includeNonBaseTokenHoldingsUsd?: boolean;
}): Promise<WalletActivityProfile | null> {
  if (!HELIUS_RPC_URL) return null;
  if (!isLikelySolanaAddress(params.walletAddress)) return null;

  const base = await getWalletBaseSnapshot({ walletAddress: params.walletAddress, sinceMs: params.sinceMs ?? null });
  if (!base) return null;

  const nonBaseTokenHoldingsUsd = params.includeNonBaseTokenHoldingsUsd
    ? await estimateWalletNonBaseTokenHoldingsUsd({
        base,
        excludeMints: params.excludeMints,
      })
    : null;

  let totalTradeVolumeSol = 0;
  for (const trade of base.tradeByMint.values()) {
    totalTradeVolumeSol += trade.boughtSol + trade.soldSol;
  }

  const balanceUsd = base.balanceSol !== null && base.solPriceUsd !== null
    ? roundMoney(base.balanceSol * base.solPriceUsd)
    : null;
  const now = Date.now();
  const observedAgeDays =
    base.observedFirstActivityAtMs !== null
      ? Math.max(0, Math.round(((now - base.observedFirstActivityAtMs) / (24 * 60 * 60 * 1000)) * 10) / 10)
      : null;
  const lastSeenHours =
    base.observedLastActivityAtMs !== null
      ? Math.max(0, Math.round(((now - base.observedLastActivityAtMs) / (60 * 60 * 1000)) * 10) / 10)
      : null;

  return {
    source: "helius",
    walletAddress: params.walletAddress,
    balanceSol: base.balanceSol,
    balanceUsd,
    nonBaseTokenHoldingsUsd,
    totalTradeVolumeSol: totalTradeVolumeSol > 0 ? roundMoney(totalTradeVolumeSol) : null,
    distinctMintsTraded: base.tradeByMint.size,
    observedAgeDays,
    observedTxCount: base.observedTxCount,
    lastSeenHours,
    fundedBy: base.fundedBy,
  };
}

// Extracts per-token trade data (bought/sold amounts) from the cached wallet base snapshot.
// Must be called with the same sinceMs used for getWalletActivityProfile to hit the cache.
export async function getWalletMintTradeFromBase(params: {
  walletAddress: string | null | undefined;
  mintAddress: string | null | undefined;
  sinceMs: number | null;
}): Promise<{ boughtAmount: number | null; soldAmount: number | null; holdingAmount: number | null; netAmount: number | null } | null> {
  if (!HELIUS_RPC_URL) return null;
  if (!isLikelySolanaAddress(params.walletAddress) || !isLikelySolanaAddress(params.mintAddress)) return null;

  const base = await getWalletBaseSnapshot({ walletAddress: params.walletAddress!, sinceMs: params.sinceMs });
  if (!base) return null;

  const mint = params.mintAddress!;
  const trade = base.tradeByMint.get(mint) ?? base.tradeByMint.get(mint.toLowerCase()) ?? null;
  const holding = base.holdingsByMint.get(mint) ?? base.holdingsByMint.get(mint.toLowerCase());
  const holdingAmount = typeof holding?.amount === "number" && Number.isFinite(holding.amount) ? holding.amount : null;
  const boughtAmount = trade ? trade.boughtAmount : null;
  const soldAmount = trade ? trade.soldAmount : null;
  const netAmount = boughtAmount !== null && soldAmount !== null ? boughtAmount - soldAmount : null;

  if (boughtAmount === null && soldAmount === null && holdingAmount === null) return null;
  return { boughtAmount, soldAmount, holdingAmount, netAmount };
}

export async function getWalletTradeSnapshotForSolanaToken(params: {
  walletAddress: string | null | undefined;
  tokenMint: string | null | undefined;
  chainType: string | null | undefined;
}): Promise<WalletTradeSnapshot | null> {
  if (!HELIUS_RPC_URL) return null;
  if (params.chainType !== "solana") return null;
  if (!isLikelySolanaAddress(params.walletAddress) || !isLikelySolanaAddress(params.tokenMint)) {
    return null;
  }

  const cacheKey = `${params.walletAddress}:${params.tokenMint}`;
  const now = Date.now();
  const cached = heliusSnapshotCache.get(cacheKey);
  if (cached && cached.expiresAtMs > now) return cached.value;
  const inFlight = heliusSnapshotInFlight.get(cacheKey);
  if (inFlight) return inFlight;

  const request = (async (): Promise<WalletTradeSnapshot | null> => {
    // Lightweight path for feed/single-post: no tx-history scan here.
    const [holdingsByMint, priceUsd] = await Promise.all([
      fetchWalletTokenHoldings(params.walletAddress!),
      fetchDexTokenPriceUsd(params.tokenMint!),
    ]);
    if (!holdingsByMint) return null;

    const snapshot = buildEmptyTradeSnapshot();
    const holdingAmount = holdingsByMint.get(params.tokenMint!)?.amount ?? 0;
    snapshot.holdingAmount = holdingAmount;
    if (priceUsd !== null) {
      snapshot.holdingUsd = roundMoney(holdingAmount * priceUsd);
    }
    return snapshot;
  })().finally(() => {
    heliusSnapshotInFlight.delete(cacheKey);
  });

  heliusSnapshotInFlight.set(cacheKey, request);
  const value = await request;
  heliusSnapshotCache.set(cacheKey, { value, expiresAtMs: now + HELIUS_CACHE_TTL_MS });
  return value;
}

export async function getWalletTradeSnapshotsForSolanaTokens(params: {
  walletAddress: string | null | undefined;
  tokenMints?: Array<string | null | undefined>;
  withPricing?: boolean;
}): Promise<Record<string, WalletTradeSnapshot> | null> {
  if (!HELIUS_RPC_URL) return null;
  if (!isLikelySolanaAddress(params.walletAddress)) return null;

  // Lightweight feed path: holdings + token prices only (no enhanced tx history scan).
  const holdingsByMint = await fetchWalletTokenHoldings(params.walletAddress);
  if (!holdingsByMint) return null;
  const requestedMints = [...new Set(
    (params.tokenMints ?? []).filter((mint): mint is string => isLikelySolanaAddress(mint))
  )];
  const uniqueMints =
    requestedMints.length > 0
      ? requestedMints
      : [...holdingsByMint.entries()]
          .filter(([, holding]) => Number(holding.amount) > 0)
          .map(([mint]) => mint);

  const snapshots: Record<string, WalletTradeSnapshot> = {};
  if (uniqueMints.length === 0) {
    return snapshots;
  }

  const withPricing = params.withPricing !== false;
  const now = Date.now();

  const missingPriceMints: string[] = [];
  const priceByMint = new Map<string, number | null>();

  for (const mint of uniqueMints) {
    const cacheKey = `${params.walletAddress}:${mint}`;
    const cached = heliusSnapshotCache.get(cacheKey);
    if (cached && cached.expiresAtMs > now && cached.value) {
      snapshots[mint] = cached.value;
      continue;
    }
    missingPriceMints.push(mint);
  }

  if (withPricing && missingPriceMints.length > 0) {
    const prices = await Promise.all(
      missingPriceMints.map(async (mint) => [mint, await fetchDexTokenPriceUsd(mint)] as const)
    );
    for (const [mint, priceUsd] of prices) {
      priceByMint.set(mint, priceUsd);
    }
  }

  for (const mint of missingPriceMints) {
    const snapshot = buildEmptyTradeSnapshot();
    const holdingAmount = holdingsByMint.get(mint)?.amount ?? 0;
    snapshot.holdingAmount = holdingAmount;
    const priceUsd = withPricing ? (priceByMint.get(mint) ?? null) : null;
    if (priceUsd !== null) {
      snapshot.holdingUsd = roundMoney(holdingAmount * priceUsd);
    }
    snapshots[mint] = snapshot;
    heliusSnapshotCache.set(`${params.walletAddress}:${mint}`, {
      value: snapshot,
      expiresAtMs: now + HELIUS_CACHE_TTL_MS,
    });
  }

  return snapshots;
}

export async function getHeliusTokenMetadataForMint(params: {
  mint: string | null | undefined;
  chainType?: string | null | undefined;
}): Promise<HeliusTokenMetadata | null> {
  if (!HELIUS_RPC_URL) return null;
  if (params.chainType && params.chainType !== "solana") return null;
  if (!isLikelySolanaAddress(params.mint)) return null;

  const mint = params.mint;
  const now = Date.now();
  const cached = heliusTokenMetadataCache.get(mint);
  if (cached && cached.expiresAtMs > now) return cached.value;
  const inFlight = heliusTokenMetadataInFlight.get(mint);
  if (inFlight) return inFlight;

  const request = (async (): Promise<HeliusTokenMetadata | null> => {
    const asset = await heliusRpcCall<unknown>("getAsset", [mint], `asset-${mint.slice(0, 8)}`);
    return readHeliusAssetMetadata(asset);
  })().finally(() => {
    heliusTokenMetadataInFlight.delete(mint);
  });

  heliusTokenMetadataInFlight.set(mint, request);
  const value = await request;
  heliusTokenMetadataCache.set(mint, {
    value,
    expiresAtMs: now + HELIUS_METADATA_CACHE_TTL_MS,
  });
  return value;
}

export async function getHeliusTradePanelContext(params: {
  walletAddress: string | null | undefined;
  tokenMint: string | null | undefined;
}): Promise<HeliusTradePanelContext | null> {
  const walletAddress = normalizeAddress(params.walletAddress);
  const tokenMint = normalizeAddress(params.tokenMint);
  if (!HELIUS_RPC_URL || !isLikelySolanaAddress(walletAddress) || !isLikelySolanaAddress(tokenMint)) {
    return null;
  }

  const cacheKey = `${walletAddress}:${tokenMint}`;
  const now = Date.now();
  const cached = heliusTradePanelContextCache.get(cacheKey);
  if (cached && cached.expiresAtMs > now) {
    return cached.value;
  }

  const inFlight = heliusTradePanelContextInFlight.get(cacheKey);
  if (inFlight) {
    return inFlight;
  }

  const request = (async (): Promise<HeliusTradePanelContext | null> => {
    const [walletNativeBalance, holdingsByMint] = await Promise.all([
      fetchWalletSolBalance(walletAddress),
      fetchWalletTokenHoldings(walletAddress),
    ]);
    if (!holdingsByMint) {
      return null;
    }

    const holding = holdingsByMint.get(tokenMint) ?? holdingsByMint.get(tokenMint.toLowerCase()) ?? null;
    const tokenDecimals =
      typeof holding?.decimals === "number" && Number.isFinite(holding.decimals)
        ? holding.decimals
        : await fetchTokenSupplyDecimals(tokenMint);

    const context: HeliusTradePanelContext = {
      source: "helius",
      walletAddress,
      tokenMint,
      walletNativeBalance,
      walletTokenBalance:
        typeof holding?.amount === "number" && Number.isFinite(holding.amount) ? holding.amount : 0,
      tokenDecimals,
    };

    heliusTradePanelContextCache.set(cacheKey, {
      value: context,
      expiresAtMs: Date.now() + (process.env.NODE_ENV === "production" ? 8_000 : 2_500),
    });
    return context;
  })().finally(() => {
    heliusTradePanelContextInFlight.delete(cacheKey);
  });

  heliusTradePanelContextInFlight.set(cacheKey, request);
  return request;
}

export async function getHeliusTokenAccountsForMint(params: {
  mint: string | null | undefined;
  limit?: number | null | undefined;
  cursor?: string | null | undefined;
}): Promise<HeliusTokenAccountSummary | null> {
  if (!HELIUS_RPC_URL) return null;
  if (!isLikelySolanaAddress(params.mint)) return null;

  const mint = params.mint;
  const limit = Math.max(1, Math.min(Math.round(params.limit ?? 1), 1000));
  const cursor = readNonEmptyString(params.cursor) ?? null;
  const cacheKey = `${mint}:${limit}:${cursor ?? "start"}`;
  const now = Date.now();
  const cached = heliusMintHolderCache.get(cacheKey);
  if (cached && cached.expiresAtMs > now) return cached.value;
  const inFlight = heliusMintHolderInFlight.get(cacheKey);
  if (inFlight) return inFlight;

  const request = (async (): Promise<HeliusTokenAccountSummary | null> => {
    const response = await heliusRpcCall<HeliusTokenAccountsResponse>(
      "getTokenAccounts",
      {
        mint,
        limit,
        ...(cursor ? { cursor } : {}),
        options: {
          showZeroBalance: false,
        },
      },
      `token-accounts-${mint.slice(0, 8)}`
    );
    if (!response) return null;
    return {
      source: "helius",
      mint,
      total: parseFiniteNumber(response.total),
      cursor: readNonEmptyString(response.cursor),
      tokenAccounts: (response.token_accounts ?? [])
        .map((account) => {
          const address = normalizeAddress(account.address);
          if (!address) return null;
          return {
            address,
            owner: normalizeAddress(account.owner),
            amount: parseFiniteNumber(account.amount),
          };
        })
        .filter((account): account is NonNullable<typeof account> => account !== null),
    };
  })().finally(() => {
    heliusMintHolderInFlight.delete(cacheKey);
  });

  heliusMintHolderInFlight.set(cacheKey, request);
  const value = await request;
  heliusMintHolderCache.set(cacheKey, {
    value,
    expiresAtMs: now + HELIUS_CACHE_TTL_MS,
  });
  return value;
}

export async function getHeliusCurrentHolderOwnerCount(params: {
  mint: string | null | undefined;
  maxPages?: number | null | undefined;
}): Promise<number | null> {
  if (!HELIUS_RPC_URL) return null;
  if (!isLikelySolanaAddress(params.mint)) return null;

  const mint = params.mint;
  const limit = 1000;
  const maxPages = Math.max(1, Math.min(Math.round(params.maxPages ?? (process.env.NODE_ENV === "production" ? 24 : 40)), 80));
  const uniqueOwners = new Set<string>();
  const seenCursors = new Set<string>();
  let cursor: string | null = null;
  let processedAccounts = 0;

  for (let pageIndex = 0; pageIndex < maxPages; pageIndex += 1) {
    const page = await getHeliusTokenAccountsForMint({
      mint,
      limit,
      cursor,
    });
    if (!page) {
      return uniqueOwners.size > 0 ? uniqueOwners.size : null;
    }

    for (const account of page.tokenAccounts) {
      if (
        account.owner &&
        typeof account.amount === "number" &&
        Number.isFinite(account.amount) &&
        account.amount > 0
      ) {
        uniqueOwners.add(account.owner);
      }
    }

    processedAccounts += page.tokenAccounts.length;
    const nextCursor = page.cursor ?? null;
    const hasKnownTotal =
      typeof page.total === "number" &&
      Number.isFinite(page.total) &&
      page.total > 0;
    const knownTotal = hasKnownTotal ? page.total : null;
    const reachedKnownEnd =
      hasKnownTotal &&
      processedAccounts >= knownTotal!;
    const looksTruncatedWithoutCursor =
      !nextCursor &&
      page.tokenAccounts.length >= limit &&
      (!hasKnownTotal || processedAccounts < knownTotal!);

    if (looksTruncatedWithoutCursor) {
      return null;
    }
    if (page.tokenAccounts.length === 0 || reachedKnownEnd) {
      return uniqueOwners.size;
    }
    if (!nextCursor) {
      return hasKnownTotal && processedAccounts < knownTotal! ? null : uniqueOwners.size;
    }
    if (seenCursors.has(nextCursor)) {
      return reachedKnownEnd ? uniqueOwners.size : null;
    }

    seenCursors.add(nextCursor);
    cursor = nextCursor;
  }

  return null;
}

export async function getHeliusAuthorityAssetCount(authorityAddress: string): Promise<number | null> {
  const summary = await getHeliusAuthorityAssetSummary({ authorityAddress, limit: 1 });
  return summary?.total ?? null;
}

export async function getHeliusAuthorityAssetSummary(params: {
  authorityAddress: string | null | undefined;
  limit?: number | null | undefined;
}): Promise<HeliusAuthorityAssetSummary | null> {
  if (!HELIUS_RPC_URL) return null;
  if (!isLikelySolanaAddress(params.authorityAddress)) return null;

  const authorityAddress = params.authorityAddress;
  const limit = Math.max(1, Math.min(Math.round(params.limit ?? 12), 50));
  const cacheKey = `${authorityAddress}:${limit}`;
  const now = Date.now();
  const cached = heliusAuthorityAssetSummaryCache.get(cacheKey);
  if (cached && cached.expiresAtMs > now) return cached.value;
  const inFlight = heliusAuthorityAssetSummaryInFlight.get(cacheKey);
  if (inFlight) return inFlight;

  const request = (async (): Promise<HeliusAuthorityAssetSummary | null> => {
    const response = await heliusRpcCall<HeliusAssetsByAuthorityResponse>(
      "getAssetsByAuthority",
      {
        authorityAddress,
        page: 1,
        limit,
      },
      `assets-authority-${authorityAddress.slice(0, 8)}`
    );
    if (!response) return null;
    return {
      source: "helius",
      authorityAddress,
      total: parseFiniteNumber(response.total),
      mintAddresses: [...new Set(
        (response.items ?? [])
          .map((item) => readNonEmptyString(item?.id))
          .filter((mint): mint is string => isLikelySolanaAddress(mint))
      )],
    };
  })().finally(() => {
    heliusAuthorityAssetSummaryInFlight.delete(cacheKey);
  });

  heliusAuthorityAssetSummaryInFlight.set(cacheKey, request);
  const value = await request;
  heliusAuthorityAssetSummaryCache.set(cacheKey, {
    value,
    expiresAtMs: now + HELIUS_METADATA_CACHE_TTL_MS,
  });
  return value;
}

export function isHeliusConfigured(): boolean {
  return !!HELIUS_RPC_URL;
}
