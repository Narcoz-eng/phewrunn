/**
 * Market Cap Tracking Service
 *
 * Handles fetching and tracking market cap data from DexScreener API.
 * Implements intelligent tracking modes based on post age:
 * - Active mode (< 1 hour old): Update every 30 seconds
 * - Settled mode (>= 1 hour old): Update every 5 minutes
 *
 * TODO: Future enhancement - implement a proper background job system
 * using something like BullMQ or cron jobs for more reliable updates
 * instead of the current lazy update pattern on feed fetch.
 */
import { dexscreenerCircuit } from "../lib/circuit-breaker.js";
import { cacheGetJson, cacheSetJson } from "../lib/redis.js";

// Tracking mode constants
export const TRACKING_MODE_ACTIVE = 'active';
export const TRACKING_MODE_SETTLED = 'settled';

// Update intervals in milliseconds
export const ACTIVE_UPDATE_INTERVAL_MS = 30 * 1000; // 30 seconds
export const SETTLED_UPDATE_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

// Time thresholds
export const ONE_HOUR_MS = 60 * 60 * 1000;
export const SIX_HOURS_MS = 6 * 60 * 60 * 1000;

// Rate limiting and backoff settings
const MAX_RETRIES = 1;
const BASE_DELAY_MS = 350;
const MAX_DELAY_MS = 3000;
const REQUEST_TIMEOUT_MS = process.env.NODE_ENV === "production" ? 1400 : 1800;
const MARKETCAP_SNAPSHOT_CACHE_TTL_MS = process.env.NODE_ENV === "production" ? 8_000 : 3_000;
const MARKETCAP_SNAPSHOT_REDIS_TTL_MS = process.env.NODE_ENV === "production" ? 30_000 : 15_000;

// Simple in-memory rate limiter
let lastRequestTime = 0;
const MIN_REQUEST_INTERVAL_MS = 200; // Min 200ms between requests

// LRU-capped snapshot cache — prevents unbounded memory growth when many
// unique contract addresses are queried over time.
const MARKET_SNAPSHOT_CACHE_MAX_ENTRIES = 500;
const marketSnapshotCache = new Map<
  string,
  { result: MarketCapResult; expiresAtMs: number; fetchedAtMs: number }
>();

function setMarketSnapshotCacheEntry(key: string, value: { result: MarketCapResult; expiresAtMs: number; fetchedAtMs: number }): void {
  // Delete-then-set moves the key to the end (most-recently-used position)
  marketSnapshotCache.delete(key);
  marketSnapshotCache.set(key, value);
  // Evict oldest entries (front of Map insertion order) when over the cap
  if (marketSnapshotCache.size > MARKET_SNAPSHOT_CACHE_MAX_ENTRIES) {
    const oldest = marketSnapshotCache.keys().next().value;
    if (oldest !== undefined) marketSnapshotCache.delete(oldest);
  }
}

const marketSnapshotInFlight = new Map<string, Promise<MarketCapResult>>();

/**
 * DexScreener API response types
 */
interface DexscreenerPair {
  chainId?: string;
  dexId?: string;
  pairAddress?: string;
  fdv?: number | string;
  marketCap?: number | string;
  priceUsd?: string;
  liquidity?: {
    usd?: number | string;
  };
  volume?: {
    h24?: number | string;
  };
  priceChange?: {
    h24?: number | string;
  };
  txns?: {
    h24?: {
      buys?: number | string;
      sells?: number | string;
    };
  };
  baseToken?: {
    address?: string;
    name?: string;
    symbol?: string;
    icon?: string;
    logoURI?: string;
  };
  quoteToken?: {
    address?: string;
    name?: string;
    symbol?: string;
    icon?: string;
    logoURI?: string;
  };
  url?: string;
  info?: {
    imageUrl?: string;
    header?: string;
    openGraph?: string;
    websites?: { label: string; url: string }[];
    socials?: { type: string; url: string }[];
  };
}

type DexscreenerResponse = DexscreenerPair[] | { pairs?: DexscreenerPair[] | null };

interface DexMatchedTokenRef {
  address?: string;
  name?: string;
  symbol?: string;
  icon?: string;
  logoURI?: string;
}

interface DexscreenerSelectedPair {
  pair: DexscreenerPair;
  matchedToken?: DexMatchedTokenRef;
}

/**
 * Result of a market cap fetch
 */
export interface MarketCapResult {
  mcap: number | null;
  source?: string;
  fetchedAt?: string;
  cacheStatus?: "hit" | "miss" | "inflight";
  tokenName?: string;
  tokenSymbol?: string;
  tokenImage?: string;
  dexscreenerUrl?: string;
  pairAddress?: string;
  dexId?: string;
  priceUsd?: number | null;
  liquidityUsd?: number | null;
  volume24hUsd?: number | null;
  priceChange24hPct?: number | null;
  buys24h?: number | null;
  sells24h?: number | null;
  error?: string;
}

/**
 * Sleep for a given number of milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Calculate exponential backoff delay
 */
function calculateBackoffDelay(attempt: number): number {
  const delay = BASE_DELAY_MS * Math.pow(2, attempt);
  return Math.min(delay, MAX_DELAY_MS);
}

function normalizeDexAddress(value: string | null | undefined): string | null {
  if (!value) return null;
  const normalized = value.trim().toLowerCase();
  return normalized || null;
}

function normalizeDexChain(chainType: string | null | undefined): string | null {
  if (!chainType) return null;
  const normalized = chainType.trim().toLowerCase();
  if (!normalized) return null;
  if (normalized === "eth" || normalized === "evm") return "ethereum";
  if (normalized === "sol") return "solana";
  return normalized;
}

function inferDexChainFromAddress(address: string | null | undefined): "solana" | "ethereum" | null {
  const value = address?.trim();
  if (!value) return null;
  if (/^0x[a-fA-F0-9]{40}$/.test(value)) return "ethereum";
  // Solana mints are base58 (32-44 chars, no 0/O/I/l characters)
  if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value)) return "solana";
  return null;
}

function toFiniteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function pickMatchedTokenFromPair(
  pair: DexscreenerPair,
  requestedAddress: string
): DexMatchedTokenRef | undefined {
  const target = normalizeDexAddress(requestedAddress);
  if (!target) return pair.baseToken;

  if (normalizeDexAddress(pair.baseToken?.address) === target) {
    return pair.baseToken;
  }
  if (normalizeDexAddress(pair.quoteToken?.address) === target) {
    return pair.quoteToken;
  }
  return pair.baseToken ?? pair.quoteToken;
}

function extractDexPairs(payload: DexscreenerResponse): DexscreenerPair[] {
  return Array.isArray(payload) ? payload : (payload.pairs ?? []);
}

function selectBestDexPair(
  pairs: DexscreenerPair[] | null | undefined,
  requestedAddress: string,
  chainType?: string | null
): DexscreenerSelectedPair | undefined {
  if (!pairs?.length) return undefined;

  const target = normalizeDexAddress(requestedAddress);
  const expectedChain =
    normalizeDexChain(chainType) ?? inferDexChainFromAddress(requestedAddress);
  const rankedPairs = [...pairs].sort((a, b) => {
    const score = (pair: DexscreenerPair): number => {
      const baseMatch = normalizeDexAddress(pair.baseToken?.address) === target;
      const quoteMatch = normalizeDexAddress(pair.quoteToken?.address) === target;
      const chainMatch =
        expectedChain !== null && normalizeDexChain(pair.chainId) === expectedChain;

      let value = 0;
      if (baseMatch && chainMatch) value += 120;
      else if (quoteMatch && chainMatch) value += 100;
      else if (baseMatch) value += 70;
      else if (quoteMatch) value += 55;
      if (chainMatch) value += 20;
      return value;
    };

    const scoreDelta = score(b) - score(a);
    if (scoreDelta !== 0) return scoreDelta;

    const mcapDelta =
      (toFiniteNumber(b.marketCap) ?? toFiniteNumber(b.fdv) ?? 0) -
      (toFiniteNumber(a.marketCap) ?? toFiniteNumber(a.fdv) ?? 0);
    return mcapDelta;
  });

  const pair = rankedPairs[0];
  if (!pair) return undefined;
  return {
    pair,
    matchedToken: pickMatchedTokenFromPair(pair, requestedAddress),
  };
}

function pickDexImageUrl(
  pair: DexscreenerPair | undefined,
  matchedToken?: DexMatchedTokenRef
): string | undefined {
  const candidates = [
    matchedToken?.icon,
    matchedToken?.logoURI,
    pair?.info?.imageUrl,
    pair?.info?.header,
    pair?.info?.openGraph,
  ];

  for (const candidate of candidates) {
    const value = candidate?.trim();
    if (value) return value;
  }

  return undefined;
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

function buildMarketSnapshotCacheKey(address: string, chainType?: string | null): string {
  const normalizedChain = normalizeDexChain(chainType) ?? inferDexChainFromAddress(address) ?? "unknown";
  return `${normalizedChain}:${address.trim().toLowerCase()}`;
}

function buildMarketSnapshotRedisKey(address: string, chainType?: string | null): string {
  return `market:${address.trim().toLowerCase()}:${normalizeDexChain(chainType) ?? inferDexChainFromAddress(address) ?? "unknown"}`;
}

function cloneMarketCapResult(result: MarketCapResult): MarketCapResult {
  return { ...result };
}

export function clearMarketCapSnapshotCache(): void {
  marketSnapshotCache.clear();
  marketSnapshotInFlight.clear();
}

/**
 * Fetch market cap from DexScreener API with rate limiting and exponential backoff
 * @param address - Token contract address
 * @returns Market cap result with optional token info
 */
export async function fetchMarketCap(
  address: string,
  chainType?: string | null
): Promise<MarketCapResult> {
  // Rate limiting - ensure minimum interval between requests
  const now = Date.now();
  const timeSinceLastRequest = now - lastRequestTime;

  if (timeSinceLastRequest < MIN_REQUEST_INTERVAL_MS) {
    await sleep(MIN_REQUEST_INTERVAL_MS - timeSinceLastRequest);
  }

  let lastError: Error | null = null;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      lastRequestTime = Date.now();
      const preferredChain =
        normalizeDexChain(chainType) ?? inferDexChainFromAddress(address);
      const endpointChains = preferredChain
        ? [preferredChain]
        : ["solana", "ethereum"];
      const uniqueEndpointChains = [...new Set(endpointChains)];
      const endpoints = [
        ...uniqueEndpointChains.map(
          (chain) => `https://api.dexscreener.com/tokens/v1/${chain}/${address}`
        ),
        `https://api.dexscreener.com/latest/dex/tokens/${address}`,
      ];
      let selectedPair: DexscreenerSelectedPair | undefined;

      // Fast-fail if DexScreener is having an outage — skip timeout wait
      if (dexscreenerCircuit.isOpen()) {
        return { mcap: null, error: "DexScreener circuit open — service unavailable" };
      }

      for (const endpoint of endpoints) {
        let response: Response;
        try {
          response = await fetchWithTimeout(
            endpoint,
            {
              headers: {
                Accept: "application/json",
              },
            },
            REQUEST_TIMEOUT_MS
          );
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          console.warn(`[MarketCap] Endpoint timeout/error for ${endpoint}: ${message}`);
          dexscreenerCircuit.recordFailure();
          continue;
        }

        // Handle rate limiting — not a service failure, don't trip circuit
        if (response.status === 429) {
          const retryAfter = response.headers.get('Retry-After');
          const waitTime = retryAfter
            ? parseInt(retryAfter) * 1000
            : calculateBackoffDelay(attempt);

          console.warn(`[MarketCap] Rate limited, waiting ${waitTime}ms before retry`);
          await sleep(waitTime);
          continue;
        }

        if (response.status >= 500) {
          dexscreenerCircuit.recordFailure();
          continue;
        }

        if (!response.ok) {
          continue;
        }

        const data = await response.json() as DexscreenerResponse;
        const pairs = extractDexPairs(data);
        selectedPair = selectBestDexPair(pairs, address, chainType);
        if (selectedPair?.pair) {
          dexscreenerCircuit.recordSuccess();
          break;
        }
      }

      if (selectedPair?.pair) {
        const marketCap = toFiniteNumber(selectedPair.pair.marketCap);
        const fdv = toFiniteNumber(selectedPair.pair.fdv);
        return {
          // Prefer circulating market cap; fallback to FDV.
          mcap: marketCap ?? fdv ?? null,
          tokenName: selectedPair.matchedToken?.name ?? selectedPair.pair.baseToken?.name,
          tokenSymbol: selectedPair.matchedToken?.symbol ?? selectedPair.pair.baseToken?.symbol,
          tokenImage: pickDexImageUrl(selectedPair.pair, selectedPair.matchedToken),
          dexscreenerUrl: selectedPair.pair.url?.trim() || undefined,
          pairAddress: selectedPair.pair.pairAddress?.trim() || undefined,
          dexId: selectedPair.pair.dexId?.trim() || undefined,
          priceUsd: toFiniteNumber(selectedPair.pair.priceUsd),
          liquidityUsd: toFiniteNumber(selectedPair.pair.liquidity?.usd),
          volume24hUsd: toFiniteNumber(selectedPair.pair.volume?.h24),
          priceChange24hPct: toFiniteNumber(selectedPair.pair.priceChange?.h24),
          buys24h: toFiniteNumber(selectedPair.pair.txns?.h24?.buys),
          sells24h: toFiniteNumber(selectedPair.pair.txns?.h24?.sells),
        };
      }

      return { mcap: null, error: "No pairs found" };

    } catch (error) {
      lastError = error as Error;
      console.error(`[MarketCap] Attempt ${attempt + 1} failed:`, error);

      if (attempt < MAX_RETRIES - 1) {
        const delay = calculateBackoffDelay(attempt);
        console.log(`[MarketCap] Retrying in ${delay}ms...`);
        await sleep(delay);
      }
    }
  }

  return {
    mcap: null,
    error: lastError?.message || "Failed to fetch market cap after retries"
  };
}

export async function getCachedMarketCapSnapshot(
  address: string,
  chainType?: string | null
): Promise<MarketCapResult> {
  const cacheKey = buildMarketSnapshotCacheKey(address, chainType);
  const now = Date.now();
  const cached = marketSnapshotCache.get(cacheKey);
  if (cached && cached.expiresAtMs > now) {
    return {
      ...cloneMarketCapResult(cached.result),
      source: cached.result.source ?? "dexscreener",
      fetchedAt: new Date(cached.fetchedAtMs).toISOString(),
      cacheStatus: "hit",
    };
  }

  const redisCached = await readCachedMarketCapSnapshotOnly(address, chainType);
  if (redisCached) {
    return redisCached;
  }

  const inFlight = marketSnapshotInFlight.get(cacheKey);
  if (inFlight) {
    const result = cloneMarketCapResult(await inFlight);
    return {
      ...result,
      source: result.source ?? "dexscreener",
      fetchedAt: result.fetchedAt ?? new Date().toISOString(),
      cacheStatus: "inflight",
    };
  }

  const request = fetchMarketCap(address, chainType)
    .then((result) => {
      const fetchedAtMs = Date.now();
      const enriched = {
        ...cloneMarketCapResult(result),
        source: "dexscreener",
        fetchedAt: new Date(fetchedAtMs).toISOString(),
        cacheStatus: "miss" as const,
      };
      setMarketSnapshotCacheEntry(cacheKey, {
        result: enriched,
        expiresAtMs: fetchedAtMs + MARKETCAP_SNAPSHOT_CACHE_TTL_MS,
        fetchedAtMs,
      });
      void cacheSetJson(
        buildMarketSnapshotRedisKey(address, chainType),
        { fetchedAtMs, result: enriched },
        MARKETCAP_SNAPSHOT_REDIS_TTL_MS
      );
      return enriched;
    })
    .finally(() => {
      marketSnapshotInFlight.delete(cacheKey);
    });

  marketSnapshotInFlight.set(cacheKey, request);
  return cloneMarketCapResult(await request);
}

export async function readCachedMarketCapSnapshotOnly(
  address: string,
  chainType?: string | null
): Promise<MarketCapResult | null> {
  const cacheKey = buildMarketSnapshotCacheKey(address, chainType);
  const now = Date.now();
  const cached = marketSnapshotCache.get(cacheKey);
  if (cached && cached.expiresAtMs > now) {
    return {
      ...cloneMarketCapResult(cached.result),
      source: cached.result.source ?? "dexscreener",
      fetchedAt: new Date(cached.fetchedAtMs).toISOString(),
      cacheStatus: "hit",
    };
  }

  const redisCached = await cacheGetJson<{
    fetchedAtMs: number;
    result: MarketCapResult;
  }>(buildMarketSnapshotRedisKey(address, chainType));
  if (!redisCached?.result || typeof redisCached.fetchedAtMs !== "number") {
    return null;
  }
  if (now - redisCached.fetchedAtMs > MARKETCAP_SNAPSHOT_REDIS_TTL_MS) {
    return null;
  }

  setMarketSnapshotCacheEntry(cacheKey, {
    result: redisCached.result,
    expiresAtMs: redisCached.fetchedAtMs + MARKETCAP_SNAPSHOT_CACHE_TTL_MS,
    fetchedAtMs: redisCached.fetchedAtMs,
  });

  return {
    ...cloneMarketCapResult(redisCached.result),
    source: redisCached.result.source ?? "dexscreener",
    fetchedAt: new Date(redisCached.fetchedAtMs).toISOString(),
    cacheStatus: "hit",
  };
}

/**
 * Determine tracking mode based on post age
 * @param createdAt - Post creation timestamp
 * @returns Tracking mode ('active' or 'settled')
 */
export function determineTrackingMode(createdAt: Date): 'active' | 'settled' {
  const ageMs = Date.now() - createdAt.getTime();

  if (ageMs < ONE_HOUR_MS) {
    return TRACKING_MODE_ACTIVE;
  }

  return TRACKING_MODE_SETTLED;
}

/**
 * Check if market cap needs update based on tracking mode and last update time
 * @param createdAt - Post creation timestamp
 * @param lastMcapUpdate - Last market cap update timestamp (can be null)
 * @param settled - Whether the post has been settled at 1H
 * @returns Whether the market cap should be updated
 */
export function needsMcapUpdate(
  createdAt: Date,
  lastMcapUpdate: Date | null,
  settled: boolean
): boolean {
  const now = Date.now();
  const postAgeMs = now - createdAt.getTime();

  // If no lastMcapUpdate, we need an update
  if (!lastMcapUpdate) {
    return true;
  }

  const timeSinceUpdateMs = now - lastMcapUpdate.getTime();

  if (postAgeMs < ONE_HOUR_MS) {
    // Active mode: update every 30 seconds
    return timeSinceUpdateMs >= ACTIVE_UPDATE_INTERVAL_MS;
  } else {
    // Settled mode (1H+): update every 5 minutes
    // Continue tracking currentMcap even after settlement
    return timeSinceUpdateMs >= SETTLED_UPDATE_INTERVAL_MS;
  }
}

/**
 * Check if post is ready for 1H settlement
 * @param createdAt - Post creation timestamp
 * @param settled - Current settled status
 * @returns Whether the post should be settled at 1H
 */
export function isReadyFor1HSettlement(createdAt: Date, settled: boolean): boolean {
  if (settled) return false;

  const postAgeMs = Date.now() - createdAt.getTime();
  return postAgeMs >= ONE_HOUR_MS;
}

/**
 * Check if post is ready for 6H mcap snapshot
 * @param createdAt - Post creation timestamp
 * @param mcap6h - Current 6H mcap value (null if not yet captured)
 * @returns Whether the 6H mcap should be captured
 */
export function isReadyFor6HSnapshot(createdAt: Date, mcap6h: number | null): boolean {
  if (mcap6h !== null) return false;

  const postAgeMs = Date.now() - createdAt.getTime();
  return postAgeMs >= SIX_HOURS_MS;
}

/**
 * Batch fetch market caps for multiple addresses
 * Implements rate limiting to avoid overwhelming the API
 * @param addresses - Array of contract addresses
 * @returns Map of address to market cap result
 */
export async function batchFetchMarketCaps(
  addresses: string[]
): Promise<Map<string, MarketCapResult>> {
  const results = new Map<string, MarketCapResult>();

  // Deduplicate addresses
  const uniqueAddresses = [...new Set(addresses)];

  for (const address of uniqueAddresses) {
    const result = await fetchMarketCap(address);
    results.set(address, result);

    // Small delay between requests to be nice to the API
    if (uniqueAddresses.indexOf(address) < uniqueAddresses.length - 1) {
      await sleep(MIN_REQUEST_INTERVAL_MS);
    }
  }

  return results;
}

/**
 * TODO: Background Job System Enhancement
 *
 * The current implementation uses a lazy update pattern where market caps
 * are updated when the feed is fetched. For production, consider implementing
 * a proper background job system:
 *
 * 1. BullMQ with Redis:
 *    - Create a queue for market cap updates
 *    - Schedule jobs based on tracking mode
 *    - Handle retries and failures automatically
 *
 * 2. Cron Jobs:
 *    - Run every 30 seconds for active posts
 *    - Run every 5 minutes for settled posts
 *    - Use database flags to track which posts need updates
 *
 * 3. WebSocket Updates:
 *    - Push real-time price updates to connected clients
 *    - Reduce polling from frontend
 *
 * Example BullMQ implementation:
 *
 * const mcapQueue = new Queue('marketcap-updates');
 *
 * mcapQueue.add('update', { postId }, {
 *   repeat: { every: 30000 }, // 30 seconds for active
 *   jobId: `mcap-${postId}`,
 * });
 *
 * const worker = new Worker('marketcap-updates', async (job) => {
 *   const post = await prisma.post.findUnique({ where: { id: job.data.postId } });
 *   if (post?.contractAddress) {
 *     const result = await fetchMarketCap(post.contractAddress);
 *     if (result.mcap) {
 *       await prisma.post.update({
 *         where: { id: post.id },
 *         data: { currentMcap: result.mcap, lastMcapUpdate: new Date() },
 *       });
 *     }
 *   }
 * });
 */
