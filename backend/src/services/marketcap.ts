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
const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1000;
const MAX_DELAY_MS = 30000;

// Simple in-memory rate limiter
let lastRequestTime = 0;
const MIN_REQUEST_INTERVAL_MS = 200; // Min 200ms between requests

/**
 * DexScreener API response types
 */
interface DexscreenerPair {
  fdv?: number;
  marketCap?: number;
  priceUsd?: string;
  baseToken?: {
    address: string;
    name: string;
    symbol: string;
  };
  quoteToken?: {
    address: string;
    name: string;
    symbol: string;
  };
  info?: {
    imageUrl?: string;
    header?: string;
    openGraph?: string;
    websites?: { label: string; url: string }[];
    socials?: { type: string; url: string }[];
  };
}

interface DexscreenerResponse {
  pairs?: DexscreenerPair[] | null;
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

/**
 * Fetch market cap from DexScreener API with rate limiting and exponential backoff
 * @param address - Token contract address
 * @returns Market cap result with optional token info
 */
export async function fetchMarketCap(address: string): Promise<MarketCapResult> {
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

      const response = await fetch(
        `https://api.dexscreener.com/latest/dex/tokens/${address}`,
        {
          headers: {
            'Accept': 'application/json',
          },
        }
      );

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
        throw new Error(`DexScreener API error: ${response.status}`);
      }

      const data = await response.json() as DexscreenerResponse;

      const pair = data.pairs?.[0];
      if (pair) {
        return {
          mcap: pair.fdv ?? pair.marketCap ?? null,
          tokenName: pair.baseToken?.name,
          tokenSymbol: pair.baseToken?.symbol,
          tokenImage: pair.info?.imageUrl,
        };
      }

      return { mcap: null, error: 'No pairs found' };

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
    error: lastError?.message || 'Failed to fetch market cap after retries'
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
