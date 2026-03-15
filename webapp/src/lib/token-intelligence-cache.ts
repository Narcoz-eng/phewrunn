import type { InfiniteData, QueryClient } from "@tanstack/react-query";
import type { Post, TokenBundleCluster } from "@/types";
import { hasResolvedBundleEvidence, isBundlePlaceholderState } from "@/lib/bundle-intelligence";

type FeedPageLike = {
  items: Post[];
};

type TokenPageLike = {
  recentCalls?: Post[];
};

type FeedFirstPageCacheEnvelope = {
  cachedAt: number;
  page: FeedPageLike;
};

export type TokenIntelligenceSnapshot = {
  address: string;
  symbol: string | null;
  name: string | null;
  imageUrl: string | null;
  dexscreenerUrl: string | null;
  bundleScanCompletedAt?: string | null;
  liquidity: number | null;
  volume24h: number | null;
  holderCount: number | null;
  largestHolderPct: number | null;
  top10HolderPct: number | null;
  bundledWalletCount: number | null;
  estimatedBundledSupplyPct: number | null;
  bundleRiskLabel: string | null;
  tokenRiskScore: number | null;
  sentimentScore: number | null;
  confidenceScore: number | null;
  hotAlphaScore: number | null;
  earlyRunnerScore: number | null;
  highConvictionScore: number | null;
  lastIntelligenceAt: string | null;
  bundleClusters: TokenBundleCluster[];
};

const FEED_FIRST_PAGE_CACHE_PREFIX = "phew.feed.first-page.v3";

function parseTimestamp(value: string | null | undefined): number {
  if (!value) return 0;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeAddress(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return normalized.length > 0 ? normalized : null;
}

function isMissingValue<T>(value: T | null | undefined): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === "string") return value.trim().length === 0;
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

function pickMetric(
  current: number | null | undefined,
  incoming: number | null | undefined,
  preferIncoming: boolean,
  options?: { positive?: boolean }
): number | null | undefined {
  const incomingValid =
    typeof incoming === "number" &&
    Number.isFinite(incoming) &&
    (!options?.positive || incoming > 0);
  const currentValid =
    typeof current === "number" &&
    Number.isFinite(current) &&
    (!options?.positive || current > 0);

  if (preferIncoming && incomingValid) {
    return incoming;
  }
  if (!currentValid && incomingValid) {
    return incoming;
  }
  return current;
}

function pickText(
  current: string | null | undefined,
  incoming: string | null | undefined,
  preferIncoming: boolean
): string | null | undefined {
  const incomingValid = typeof incoming === "string" && incoming.trim().length > 0;
  const currentValid = typeof current === "string" && current.trim().length > 0;

  if (preferIncoming && incomingValid) {
    return incoming;
  }
  if (!currentValid && incomingValid) {
    return incoming;
  }
  return current;
}

function mergeTokenIntelligenceIntoPost(post: Post, token: TokenIntelligenceSnapshot): Post {
  const normalizedTokenAddress = normalizeAddress(token.address);
  const normalizedPostAddress = normalizeAddress(post.contractAddress);
  if (!normalizedTokenAddress || normalizedTokenAddress !== normalizedPostAddress) {
    return post;
  }

  const incomingVersion = parseTimestamp(token.lastIntelligenceAt);
  const currentVersion = parseTimestamp(post.lastIntelligenceAt);
  const preferIncoming = incomingVersion > 0 && incomingVersion >= currentVersion;
  const shouldPreferIncomingBundle =
    preferIncoming ||
    (hasResolvedBundleEvidence(token) &&
      isBundlePlaceholderState({
        bundleRiskLabel: post.bundleRiskLabel,
        bundleScanCompletedAt: post.bundleScanCompletedAt,
        bundledWalletCount: post.bundledWalletCount,
        estimatedBundledSupplyPct: post.estimatedBundledSupplyPct,
        bundleClusters: post.bundleClusters,
      }));

  const nextTokenName = pickText(post.tokenName, token.name, preferIncoming);
  const nextTokenSymbol = pickText(post.tokenSymbol, token.symbol, preferIncoming);
  const nextTokenImage = pickText(post.tokenImage, token.imageUrl, preferIncoming);
  const nextDexscreenerUrl = pickText(post.dexscreenerUrl, token.dexscreenerUrl, preferIncoming);
  const nextConfidenceScore = pickMetric(post.confidenceScore, token.confidenceScore, preferIncoming);
  const nextHotAlphaScore = pickMetric(post.hotAlphaScore, token.hotAlphaScore, preferIncoming);
  const nextEarlyRunnerScore = pickMetric(post.earlyRunnerScore, token.earlyRunnerScore, preferIncoming);
  const nextHighConvictionScore = pickMetric(post.highConvictionScore, token.highConvictionScore, preferIncoming);
  const nextSentimentScore = pickMetric(post.sentimentScore, token.sentimentScore, preferIncoming);
  const nextTokenRiskScore = pickMetric(post.tokenRiskScore, token.tokenRiskScore, shouldPreferIncomingBundle);
  const nextBundleRiskLabel = pickText(post.bundleRiskLabel, token.bundleRiskLabel, shouldPreferIncomingBundle);
  const nextBundleScanCompletedAt = pickText(
    post.bundleScanCompletedAt,
    token.bundleScanCompletedAt,
    shouldPreferIncomingBundle
  );
  const nextLiquidity = pickMetric(post.liquidity, token.liquidity, preferIncoming, { positive: true });
  const nextVolume24h = pickMetric(post.volume24h, token.volume24h, preferIncoming, { positive: true });
  const nextHolderCount = pickMetric(post.holderCount, token.holderCount, preferIncoming, { positive: true });
  const nextLargestHolderPct = pickMetric(post.largestHolderPct, token.largestHolderPct, preferIncoming);
  const nextTop10HolderPct = pickMetric(post.top10HolderPct, token.top10HolderPct, preferIncoming);
  const nextBundledWalletCount = pickMetric(
    post.bundledWalletCount,
    token.bundledWalletCount,
    shouldPreferIncomingBundle,
    { positive: true }
  );
  const nextEstimatedBundledSupplyPct = pickMetric(
    post.estimatedBundledSupplyPct,
    token.estimatedBundledSupplyPct,
    shouldPreferIncomingBundle
  );
  const nextLastIntelligenceAt =
    (preferIncoming || shouldPreferIncomingBundle) && incomingVersion > 0
      ? token.lastIntelligenceAt
      : (post.lastIntelligenceAt ?? token.lastIntelligenceAt ?? null);
  const nextBundleClusters =
    token.bundleClusters.length > 0 && (shouldPreferIncomingBundle || isMissingValue(post.bundleClusters))
      ? token.bundleClusters
      : post.bundleClusters;

  if (
    nextTokenName === post.tokenName &&
    nextTokenSymbol === post.tokenSymbol &&
    nextTokenImage === post.tokenImage &&
    nextDexscreenerUrl === post.dexscreenerUrl &&
    nextConfidenceScore === post.confidenceScore &&
    nextHotAlphaScore === post.hotAlphaScore &&
    nextEarlyRunnerScore === post.earlyRunnerScore &&
    nextHighConvictionScore === post.highConvictionScore &&
    nextSentimentScore === post.sentimentScore &&
    nextTokenRiskScore === post.tokenRiskScore &&
    nextBundleRiskLabel === post.bundleRiskLabel &&
    nextBundleScanCompletedAt === (post.bundleScanCompletedAt ?? null) &&
    nextLiquidity === post.liquidity &&
    nextVolume24h === post.volume24h &&
    nextHolderCount === post.holderCount &&
    nextLargestHolderPct === post.largestHolderPct &&
    nextTop10HolderPct === post.top10HolderPct &&
    nextBundledWalletCount === post.bundledWalletCount &&
    nextEstimatedBundledSupplyPct === post.estimatedBundledSupplyPct &&
    nextLastIntelligenceAt === (post.lastIntelligenceAt ?? null) &&
    nextBundleClusters === post.bundleClusters
  ) {
    return post;
  }

  return {
    ...post,
    tokenName: nextTokenName ?? null,
    tokenSymbol: nextTokenSymbol ?? null,
    tokenImage: nextTokenImage ?? null,
    dexscreenerUrl: nextDexscreenerUrl ?? null,
    confidenceScore: nextConfidenceScore ?? null,
    hotAlphaScore: nextHotAlphaScore ?? null,
    earlyRunnerScore: nextEarlyRunnerScore ?? null,
    highConvictionScore: nextHighConvictionScore ?? null,
    sentimentScore: nextSentimentScore ?? null,
    tokenRiskScore: nextTokenRiskScore ?? null,
    bundleRiskLabel: nextBundleRiskLabel ?? null,
    bundleScanCompletedAt: nextBundleScanCompletedAt ?? null,
    liquidity: nextLiquidity ?? null,
    volume24h: nextVolume24h ?? null,
    holderCount: nextHolderCount ?? null,
    largestHolderPct: nextLargestHolderPct ?? null,
    top10HolderPct: nextTop10HolderPct ?? null,
    bundledWalletCount: nextBundledWalletCount ?? null,
    estimatedBundledSupplyPct: nextEstimatedBundledSupplyPct ?? null,
    lastIntelligenceAt: nextLastIntelligenceAt ?? null,
    bundleClusters: nextBundleClusters,
  };
}

function syncPostArray(posts: Post[] | undefined, token: TokenIntelligenceSnapshot): Post[] | undefined {
  if (!Array.isArray(posts) || posts.length === 0) {
    return posts;
  }

  let didChange = false;
  const nextPosts = posts.map((post) => {
    const nextPost = mergeTokenIntelligenceIntoPost(post, token);
    if (nextPost !== post) {
      didChange = true;
    }
    return nextPost;
  });

  return didChange ? nextPosts : posts;
}

function syncFeedFirstPageSessionCaches(token: TokenIntelligenceSnapshot): void {
  if (typeof window === "undefined") return;

  try {
    const keys: string[] = [];
    for (let index = 0; index < window.sessionStorage.length; index += 1) {
      const key = window.sessionStorage.key(index);
      if (typeof key === "string" && key.startsWith(FEED_FIRST_PAGE_CACHE_PREFIX)) {
        keys.push(key);
      }
    }

    for (const key of keys) {
      const raw = window.sessionStorage.getItem(key);
      if (!raw) continue;
      const parsed = JSON.parse(raw) as FeedFirstPageCacheEnvelope | null;
      if (!parsed?.page || !Array.isArray(parsed.page.items)) continue;
      const nextItems = syncPostArray(parsed.page.items, token);
      if (nextItems === parsed.page.items) continue;
      window.sessionStorage.setItem(
        key,
        JSON.stringify({
          ...parsed,
          page: {
            ...parsed.page,
            items: nextItems,
          },
        })
      );
    }
  } catch {
    // Ignore storage access failures.
  }
}

export function syncTokenIntelligenceAcrossPostCaches(
  queryClient: QueryClient,
  token: TokenIntelligenceSnapshot
): void {
  queryClient.setQueriesData<InfiniteData<FeedPageLike>>({ queryKey: ["posts"] }, (existing) => {
    if (!existing?.pages?.length) {
      return existing;
    }

    let didChange = false;
    const nextPages = existing.pages.map((page) => {
      const nextItems = syncPostArray(page.items, token);
      if (nextItems !== page.items) {
        didChange = true;
        return {
          ...page,
          items: nextItems ?? page.items,
        };
      }
      return page;
    });

    return didChange ? { ...existing, pages: nextPages } : existing;
  });

  queryClient.setQueriesData<Post[]>({ queryKey: ["userPosts"] }, (existing) => syncPostArray(existing, token) ?? existing);
  queryClient.setQueriesData<Post[]>({ queryKey: ["userReposts"] }, (existing) => syncPostArray(existing, token) ?? existing);
  queryClient.setQueriesData<Post[]>({ queryKey: ["profile", "posts"] }, (existing) => syncPostArray(existing, token) ?? existing);
  queryClient.setQueriesData<Post[]>({ queryKey: ["profile", "reposts"] }, (existing) => syncPostArray(existing, token) ?? existing);
  queryClient.setQueriesData<Post[]>({ queryKey: ["token-calls"] }, (existing) => syncPostArray(existing, token) ?? existing);
  queryClient.setQueriesData<TokenPageLike>({ queryKey: ["token-page"] }, (existing) => {
    if (!existing?.recentCalls?.length) {
      return existing;
    }
    const nextRecentCalls = syncPostArray(existing.recentCalls, token);
    return nextRecentCalls === existing.recentCalls
      ? existing
      : {
          ...existing,
          recentCalls: nextRecentCalls ?? existing.recentCalls,
        };
  });
  queryClient.setQueriesData<Post>({ queryKey: ["post"] }, (existing) =>
    existing ? mergeTokenIntelligenceIntoPost(existing, token) : existing
  );

  syncFeedFirstPageSessionCaches(token);
}
