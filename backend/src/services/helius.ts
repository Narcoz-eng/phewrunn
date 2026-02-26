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

type HeliusTokenHolding = {
  amount: number;
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

const HELIUS_RPC_URL =
  process.env.HELIUS_RPC_URL?.trim() ||
  process.env.HELIUS_RPC_ENDPOINT?.trim() ||
  null;

const WRAPPED_SOL_MINT = "So11111111111111111111111111111111111111112";
const SOLANA_WALLET_REGEX = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const TOKEN_PROGRAM_ID = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const HELIUS_CACHE_TTL_MS = process.env.NODE_ENV === "production" ? 45_000 : 10_000;
const WALLET_BASE_CACHE_TTL_MS = process.env.NODE_ENV === "production" ? 5 * 60_000 : 30_000;
const DEX_PRICE_CACHE_TTL_MS = process.env.NODE_ENV === "production" ? 60_000 : 15_000;
const HELIUS_MAX_TX_PAGES = process.env.NODE_ENV === "production" ? 5 : 2;
const HELIUS_TX_PAGE_LIMIT = 100;

const heliusSnapshotCache = new Map<string, { value: WalletTradeSnapshot | null; expiresAtMs: number }>();
const heliusSnapshotInFlight = new Map<string, Promise<WalletTradeSnapshot | null>>();
const walletBaseCache = new Map<string, { value: WalletBaseSnapshot | null; expiresAtMs: number }>();
const walletBaseInFlight = new Map<string, Promise<WalletBaseSnapshot | null>>();
const dexPriceCache = new Map<string, { priceUsd: number | null; expiresAtMs: number }>();
const dexPriceInFlight = new Map<string, Promise<number | null>>();

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

async function heliusRpcCall<T>(method: string, params: unknown[], id: string): Promise<T | null> {
  if (!HELIUS_RPC_URL) return null;
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
    if (!response.ok) return null;
    const payload = (await response.json()) as { result?: T; error?: unknown };
    if (payload.error) return null;
    return payload.result ?? null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
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
    const existing = holdings.get(mint)?.amount ?? 0;
    holdings.set(mint, { amount: existing + amount });
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

async function buildWalletBaseSnapshot(params: { walletAddress: string; sinceMs?: number | null }): Promise<WalletBaseSnapshot | null> {
  const [balanceSol, holdingsByMint, solPriceUsd, txs] = await Promise.all([
    fetchWalletSolBalance(params.walletAddress),
    fetchWalletTokenHoldings(params.walletAddress),
    fetchDexTokenPriceUsd(WRAPPED_SOL_MINT),
    fetchEnhancedTransactionsByAddress({ walletAddress: params.walletAddress, sinceMs: params.sinceMs }),
  ]);

  if (balanceSol === null && holdingsByMint === null && txs.length === 0) {
    return null;
  }

  const tradeByMint = aggregateWalletTradesFromEnhancedTx({
    walletAddress: params.walletAddress,
    txs,
    sinceMs: params.sinceMs,
  });

  return {
    walletAddress: params.walletAddress,
    balanceSol,
    solPriceUsd,
    holdingsByMint: holdingsByMint ?? new Map<string, HeliusTokenHolding>(),
    tradeByMint,
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
  tokenMints: Array<string | null | undefined>;
}): Promise<Record<string, WalletTradeSnapshot> | null> {
  if (!HELIUS_RPC_URL) return null;
  if (!isLikelySolanaAddress(params.walletAddress)) return null;

  const uniqueMints = [...new Set(
    params.tokenMints.filter((mint): mint is string => isLikelySolanaAddress(mint))
  )];
  if (uniqueMints.length === 0) return null;

  // Lightweight feed path: holdings + token prices only (no enhanced tx history scan).
  const holdingsByMint = await fetchWalletTokenHoldings(params.walletAddress);
  if (!holdingsByMint) return null;

  const snapshots: Record<string, WalletTradeSnapshot> = {};
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

  if (missingPriceMints.length > 0) {
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
    const priceUsd = priceByMint.get(mint) ?? null;
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

export function isHeliusConfigured(): boolean {
  return !!HELIUS_RPC_URL;
}
