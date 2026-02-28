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

// Simple in-memory rate limiter
let lastRequestTime = 0;
const MIN_REQUEST_INTERVAL_MS = 200; // Min 200ms between requests

/**
 * DexScreener API response types
 */
interface DexscreenerPair {
  chainId?: string;
  fdv?: number | string;
  marketCap?: number | string;
  priceUsd?: string;
  baseToken?: {
    address?: string;
    name?: string;
    symbol?: string;
  };
  quoteToken?: {
    address?: string;
    name?: string;
    symbol?: string;
  };
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
  name?: string;
  symbol?: string;
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
  tokenName?: string;
  tokenSymbol?: string;
  tokenImage?: string;
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

function pickDexImageUrl(pair: DexscreenerPair | undefined): string | undefined {
  const candidates = [
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
          continue;
        }

        // Handle rate limiting
        if (response.status === 429) {
          const retryAfter = response.headers.get('Retry-After');
          const waitTime = retryAfter
            ? parseInt(retryAfter) * 1000
            : calculateBackoffDelay(attempt);

          console.warn(`[MarketCap] Rate limited, waiting ${waitTime}ms before retry`);
          await sleep(waitTime);
          continue;
        }

        if (!response.ok) {
          continue;
        }

        const data = await response.json() as DexscreenerResponse;
        const pairs = extractDexPairs(data);
        selectedPair = selectBestDexPair(pairs, address, chainType);
        if (selectedPair?.pair) break;
      }

      if (selectedPair?.pair) {
        const marketCap = toFiniteNumber(selectedPair.pair.marketCap);
        const fdv = toFiniteNumber(selectedPair.pair.fdv);
        return {
          // Prefer circulating market cap; fallback to FDV.
          mcap: marketCap ?? fdv ?? null,
          tokenName: selectedPair.matchedToken?.name ?? selectedPair.pair.baseToken?.name,
          tokenSymbol: selectedPair.matchedToken?.symbol ?? selectedPair.pair.baseToken?.symbol,
          tokenImage: pickDexImageUrl(selectedPair.pair),
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
