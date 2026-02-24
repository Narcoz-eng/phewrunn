type WalletTradeSnapshot = {
  source: "helius";
  totalPnlUsd: number | null;
  realizedPnlUsd: number | null;
  unrealizedPnlUsd: number | null;
  boughtUsd: number | null;
  soldUsd: number | null;
  holdingUsd: number | null;
  holdingAmount: number | null;
};

const HELIUS_RPC_URL =
  process.env.HELIUS_RPC_URL?.trim() ||
  process.env.HELIUS_RPC_ENDPOINT?.trim() ||
  null;

const HELIUS_CACHE_TTL_MS = process.env.NODE_ENV === "production" ? 45_000 : 10_000;
const heliusSnapshotCache = new Map<string, { value: WalletTradeSnapshot | null; expiresAtMs: number }>();
const heliusSnapshotInFlight = new Map<string, Promise<WalletTradeSnapshot | null>>();

const SOLANA_WALLET_REGEX = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

function isLikelySolanaAddress(value: string | null | undefined): value is string {
  return typeof value === "string" && SOLANA_WALLET_REGEX.test(value);
}

function buildEmptySnapshot(): WalletTradeSnapshot {
  return {
    source: "helius",
    totalPnlUsd: null,
    realizedPnlUsd: null,
    unrealizedPnlUsd: null,
    boughtUsd: null,
    soldUsd: null,
    holdingUsd: null,
    holdingAmount: null,
  };
}

async function fetchHeliusHoldingAmount(ownerWallet: string, tokenMint: string): Promise<number | null> {
  if (!HELIUS_RPC_URL) return null;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 4_500);

  try {
    const response = await fetch(HELIUS_RPC_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: `holding-${ownerWallet.slice(0, 6)}-${tokenMint.slice(0, 6)}`,
        method: "getTokenAccountsByOwner",
        params: [
          ownerWallet,
          { mint: tokenMint },
          { encoding: "jsonParsed", commitment: "confirmed" },
        ],
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      return null;
    }

    const payload = (await response.json()) as {
      result?: {
        value?: Array<{
          account?: {
            data?: {
              parsed?: {
                info?: {
                  tokenAmount?: {
                    uiAmount?: number | null;
                    uiAmountString?: string;
                    amount?: string;
                    decimals?: number;
                  };
                };
              };
            };
          };
        }>;
      };
      error?: unknown;
    };

    if (payload.error) {
      return null;
    }

    const accounts = payload.result?.value ?? [];
    if (accounts.length === 0) return 0;

    let total = 0;
    for (const account of accounts) {
      const tokenAmount = account.account?.data?.parsed?.info?.tokenAmount;
      if (!tokenAmount) continue;

      if (typeof tokenAmount.uiAmount === "number") {
        total += tokenAmount.uiAmount;
        continue;
      }

      if (typeof tokenAmount.uiAmountString === "string") {
        const parsed = Number(tokenAmount.uiAmountString);
        if (Number.isFinite(parsed)) total += parsed;
        continue;
      }

      if (typeof tokenAmount.amount === "string") {
        const raw = Number(tokenAmount.amount);
        const decimals = typeof tokenAmount.decimals === "number" ? tokenAmount.decimals : 0;
        if (Number.isFinite(raw)) total += raw / Math.pow(10, decimals);
      }
    }

    return Number.isFinite(total) ? total : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
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
  if (cached && cached.expiresAtMs > now) {
    return cached.value;
  }

  const inFlight = heliusSnapshotInFlight.get(cacheKey);
  if (inFlight) return inFlight;

  const request = (async (): Promise<WalletTradeSnapshot | null> => {
    const holdingAmount = await fetchHeliusHoldingAmount(params.walletAddress!, params.tokenMint!);
    if (holdingAmount === null) {
      return null;
    }

    const snapshot = buildEmptySnapshot();
    snapshot.holdingAmount = holdingAmount;
    return snapshot;
  })()
    .finally(() => {
      heliusSnapshotInFlight.delete(cacheKey);
    });

  heliusSnapshotInFlight.set(cacheKey, request);
  const value = await request;
  heliusSnapshotCache.set(cacheKey, { value, expiresAtMs: now + HELIUS_CACHE_TTL_MS });
  return value;
}

export function isHeliusConfigured(): boolean {
  return !!HELIUS_RPC_URL;
}

