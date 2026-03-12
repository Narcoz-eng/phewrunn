type SolscanEnvelope<T> = {
  success?: boolean;
  data?: T;
  errors?: {
    code?: number;
    message?: string;
  } | null;
};

type CacheEntry<T> = {
  value: T | null;
  expiresAtMs: number;
};

type SolscanTokenMetaResponse = {
  holder?: number | string | null;
  creator?: string | null;
  mint_authority?: string | null;
  freeze_authority?: string | null;
};

type SolscanTokenHolderItem = {
  address?: string | null;
  owner?: string | null;
  amount?: number | string | null;
  value?: number | string | null;
  percentage?: number | string | null;
  rank?: number | string | null;
};

type SolscanTokenHoldersResponse = {
  total?: number | string | null;
  items?: SolscanTokenHolderItem[] | null;
};

type SolscanAccountMetadataResponse = {
  account_address?: string | null;
  account_label?: string | null;
  account_tags?: string[] | string | null;
  account_type?: string | null;
  account_domain?: string | null;
  active_age?: number | string | null;
  funded_by?: string | null;
};

type SolscanAccountPortfolioResponse = {
  total_value?: number | string | null;
};

export type SolscanTokenMeta = {
  holderCount: number | null;
  creator: string | null;
  mintAuthority: string | null;
  freezeAuthority: string | null;
};

export type SolscanTokenHolder = {
  address: string;
  ownerAddress: string | null;
  tokenAccountAddress: string | null;
  amount: number | null;
  valueUsd: number | null;
  supplyPct: number | null;
  rank: number | null;
};

export type SolscanWalletMetadata = {
  address: string;
  label: string | null;
  tags: string[];
  type: string | null;
  domain: string | null;
  activeAgeDays: number | null;
  fundedBy: string | null;
};

const SOLSCAN_API_KEY = process.env.SOLSCAN_API_KEY?.trim() || "";
const SOLSCAN_API_BASE = "https://pro-api.solscan.io/v2.0";
const SOLSCAN_TIMEOUT_MS = process.env.NODE_ENV === "production" ? 6_500 : 9_000;
const SOLSCAN_TOKEN_CACHE_TTL_MS = process.env.NODE_ENV === "production" ? 60_000 : 20_000;
const SOLSCAN_WALLET_CACHE_TTL_MS = process.env.NODE_ENV === "production" ? 5 * 60_000 : 60_000;

const tokenMetaCache = new Map<string, CacheEntry<SolscanTokenMeta>>();
const tokenMetaInFlight = new Map<string, Promise<SolscanTokenMeta | null>>();
const tokenHolderCache = new Map<string, CacheEntry<{ total: number | null; holders: SolscanTokenHolder[] }>>();
const tokenHolderInFlight = new Map<string, Promise<{ total: number | null; holders: SolscanTokenHolder[] } | null>>();
const walletMetadataCache = new Map<string, CacheEntry<SolscanWalletMetadata>>();
const walletMetadataInFlight = new Map<string, Promise<SolscanWalletMetadata | null>>();
const walletPortfolioCache = new Map<string, CacheEntry<number | null>>();
const walletPortfolioInFlight = new Map<string, Promise<number | null>>();

function normalizeAddress(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
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

function normalizePct(value: unknown): number | null {
  const parsed = parseFiniteNumber(value);
  if (parsed === null) return null;
  if (parsed > 0 && parsed <= 1) {
    return Math.round(parsed * 10_000) / 100;
  }
  return Math.round(parsed * 100) / 100;
}

function normalizeTags(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
      .filter((entry) => entry.length > 0);
  }
  if (typeof value === "string") {
    return value
      .split(/[|,]/)
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);
  }
  return [];
}

function readCache<T>(store: Map<string, CacheEntry<T>>, key: string): T | null {
  const cached = store.get(key);
  if (!cached) return null;
  if (cached.expiresAtMs <= Date.now()) {
    store.delete(key);
    return null;
  }
  return cached.value;
}

function writeCache<T>(store: Map<string, CacheEntry<T>>, key: string, value: T | null, ttlMs: number): void {
  store.set(key, {
    value,
    expiresAtMs: Date.now() + ttlMs,
  });
}

async function solscanGet<T>(
  path: string,
  queryParams?: Record<string, string | number | boolean | Array<string> | null | undefined>
): Promise<T | null> {
  if (!SOLSCAN_API_KEY) return null;

  const url = new URL(`${SOLSCAN_API_BASE}${path}`);
  for (const [key, value] of Object.entries(queryParams ?? {})) {
    if (value === null || value === undefined) continue;
    if (Array.isArray(value)) {
      for (const entry of value) {
        if (typeof entry === "string" && entry.trim().length > 0) {
          url.searchParams.append(key, entry.trim());
        }
      }
      continue;
    }
    url.searchParams.set(key, String(value));
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SOLSCAN_TIMEOUT_MS);
  try {
    const response = await fetch(url.toString(), {
      method: "GET",
      headers: {
        accept: "application/json",
        token: SOLSCAN_API_KEY,
      },
      signal: controller.signal,
    });
    if (!response.ok) return null;
    const payload = (await response.json().catch(() => null)) as SolscanEnvelope<T> | T | null;
    if (!payload || typeof payload !== "object") return null;
    if ("data" in payload) {
      return payload.data ?? null;
    }
    return payload as T;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

export function isSolscanConfigured(): boolean {
  return SOLSCAN_API_KEY.length > 0;
}

export async function getSolscanTokenMeta(address: string): Promise<SolscanTokenMeta | null> {
  const normalizedAddress = normalizeAddress(address);
  if (!normalizedAddress) return null;

  const cacheKey = normalizedAddress.toLowerCase();
  const cached = readCache(tokenMetaCache, cacheKey);
  if (cached) return cached;

  const inFlight = tokenMetaInFlight.get(cacheKey);
  if (inFlight) return inFlight;

  const request = solscanGet<SolscanTokenMetaResponse>("/token/meta", {
    address: normalizedAddress,
  })
    .then((response) => {
      if (!response) return null;
      const result: SolscanTokenMeta = {
        holderCount: parseFiniteNumber(response.holder),
        creator: normalizeAddress(response.creator),
        mintAuthority: normalizeAddress(response.mint_authority),
        freezeAuthority: normalizeAddress(response.freeze_authority),
      };
      writeCache(tokenMetaCache, cacheKey, result, SOLSCAN_TOKEN_CACHE_TTL_MS);
      return result;
    })
    .finally(() => {
      tokenMetaInFlight.delete(cacheKey);
    });

  tokenMetaInFlight.set(cacheKey, request);
  return request;
}

export async function getSolscanTokenHolders(
  address: string,
  pageSize = 20
): Promise<{ total: number | null; holders: SolscanTokenHolder[] } | null> {
  const normalizedAddress = normalizeAddress(address);
  if (!normalizedAddress) return null;

  const cacheKey = `${normalizedAddress.toLowerCase()}:${pageSize}`;
  const cached = readCache(tokenHolderCache, cacheKey);
  if (cached) return cached;

  const inFlight = tokenHolderInFlight.get(cacheKey);
  if (inFlight) return inFlight;

  const request = solscanGet<SolscanTokenHoldersResponse>("/token/holders", {
    address: normalizedAddress,
    page: 1,
    page_size: pageSize,
  })
    .then((response) => {
      if (!response) return null;
      const holders = (response.items ?? [])
        .map((holder): SolscanTokenHolder | null => {
          const tokenAccountAddress = normalizeAddress(holder.address);
          const ownerAddress = normalizeAddress(holder.owner);
          const addressToDisplay = ownerAddress ?? tokenAccountAddress;
          if (!addressToDisplay) return null;
          return {
            address: addressToDisplay,
            ownerAddress,
            tokenAccountAddress,
            amount: parseFiniteNumber(holder.amount),
            valueUsd: parseFiniteNumber(holder.value),
            supplyPct: normalizePct(holder.percentage),
            rank: parseFiniteNumber(holder.rank),
          };
        })
        .filter((holder): holder is SolscanTokenHolder => holder !== null);
      const result = {
        total: parseFiniteNumber(response.total),
        holders,
      };
      writeCache(tokenHolderCache, cacheKey, result, SOLSCAN_TOKEN_CACHE_TTL_MS);
      return result;
    })
    .finally(() => {
      tokenHolderInFlight.delete(cacheKey);
    });

  tokenHolderInFlight.set(cacheKey, request);
  return request;
}

export async function getSolscanWalletMetadata(address: string): Promise<SolscanWalletMetadata | null> {
  const normalizedAddress = normalizeAddress(address);
  if (!normalizedAddress) return null;

  const cacheKey = normalizedAddress.toLowerCase();
  const cached = readCache(walletMetadataCache, cacheKey);
  if (cached) return cached;

  const inFlight = walletMetadataInFlight.get(cacheKey);
  if (inFlight) return inFlight;

  const request = solscanGet<SolscanAccountMetadataResponse>("/account/metadata", {
    address: normalizedAddress,
  })
    .then((response) => {
      if (!response) return null;
      const result: SolscanWalletMetadata = {
        address: normalizedAddress,
        label: normalizeAddress(response.account_label),
        tags: normalizeTags(response.account_tags),
        type: normalizeAddress(response.account_type),
        domain: normalizeAddress(response.account_domain),
        activeAgeDays: parseFiniteNumber(response.active_age),
        fundedBy: normalizeAddress(response.funded_by),
      };
      writeCache(walletMetadataCache, cacheKey, result, SOLSCAN_WALLET_CACHE_TTL_MS);
      return result;
    })
    .finally(() => {
      walletMetadataInFlight.delete(cacheKey);
    });

  walletMetadataInFlight.set(cacheKey, request);
  return request;
}

export async function getSolscanWalletMetadataMulti(addresses: string[]): Promise<Map<string, SolscanWalletMetadata>> {
  const uniqueAddresses = [...new Set(addresses.map((address) => normalizeAddress(address)).filter((address): address is string => Boolean(address)))];
  const result = new Map<string, SolscanWalletMetadata>();
  if (uniqueAddresses.length === 0) return result;

  const cachedMisses: string[] = [];
  for (const address of uniqueAddresses) {
    const cached = readCache(walletMetadataCache, address.toLowerCase());
    if (cached) {
      result.set(address, cached);
    } else {
      cachedMisses.push(address);
    }
  }

  if (cachedMisses.length === 0) return result;

  const multiResponse = await solscanGet<SolscanAccountMetadataResponse[]>("/account/metadata/multi", {
    address: cachedMisses,
  });

  if (Array.isArray(multiResponse) && multiResponse.length > 0) {
    for (const item of multiResponse) {
      const address = normalizeAddress(item.account_address);
      if (!address) continue;
      const metadata: SolscanWalletMetadata = {
        address,
        label: normalizeAddress(item.account_label),
        tags: normalizeTags(item.account_tags),
        type: normalizeAddress(item.account_type),
        domain: normalizeAddress(item.account_domain),
        activeAgeDays: parseFiniteNumber(item.active_age),
        fundedBy: normalizeAddress(item.funded_by),
      };
      writeCache(walletMetadataCache, address.toLowerCase(), metadata, SOLSCAN_WALLET_CACHE_TTL_MS);
      result.set(address, metadata);
    }
  }

  const missingAfterMulti = cachedMisses.filter((address) => !result.has(address));
  if (missingAfterMulti.length > 0) {
    const fallbacks = await Promise.all(
      missingAfterMulti.map(async (address) => [address, await getSolscanWalletMetadata(address)] as const)
    );
    for (const [address, metadata] of fallbacks) {
      if (metadata) {
        result.set(address, metadata);
      }
    }
  }

  return result;
}

export async function getSolscanWalletTotalValueUsd(address: string): Promise<number | null> {
  const normalizedAddress = normalizeAddress(address);
  if (!normalizedAddress) return null;

  const cacheKey = normalizedAddress.toLowerCase();
  const cached = readCache(walletPortfolioCache, cacheKey);
  if (cached !== null) return cached;

  const inFlight = walletPortfolioInFlight.get(cacheKey);
  if (inFlight) return inFlight;

  const request = solscanGet<SolscanAccountPortfolioResponse>("/account/portfolio", {
    address: normalizedAddress,
    exclude_low_score_tokens: true,
  })
    .then((response) => {
      const totalValueUsd = response ? parseFiniteNumber(response.total_value) : null;
      writeCache(walletPortfolioCache, cacheKey, totalValueUsd, SOLSCAN_WALLET_CACHE_TTL_MS);
      return totalValueUsd;
    })
    .finally(() => {
      walletPortfolioInFlight.delete(cacheKey);
    });

  walletPortfolioInFlight.set(cacheKey, request);
  return request;
}
