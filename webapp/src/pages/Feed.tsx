import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { useInfiniteQuery, useQuery, useMutation, useQueryClient, type InfiniteData } from "@tanstack/react-query";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useSession, useAuth } from "@/lib/auth-client";
import { api, ApiError, TimeoutError } from "@/lib/api";
import { DiscoveryFeedSidebarResponse, Post, User } from "@/types";
import { PostCard, type PostCardRealtimePriceMode } from "@/components/feed/PostCard";
import { PostCardSkeleton, ProfileCardSkeleton } from "@/components/feed/PostCardSkeleton";
import { CreatePost } from "@/components/feed/CreatePost";
import { LevelBar } from "@/components/feed/LevelBar";
import { FeedHeader, FeedTab } from "@/components/feed/FeedHeader";
import { AnnouncementBanner } from "@/components/feed/AnnouncementBanner";
import { SearchBar } from "@/components/feed/SearchBar";
import { WindowVirtualList } from "@/components/virtual/WindowVirtualList";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Sparkles, RefreshCw, AlertCircle, Radar, BrainCircuit, Flame, ArrowUpRight, Users, Zap, Search, TrendingUp } from "lucide-react";
import { getAvatarUrl } from "@/types";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { readSessionCache, writeSessionCache } from "@/lib/session-cache";
import { hasResolvedBundleEvidence, isBundlePlaceholderState } from "@/lib/bundle-intelligence";
import { QueryErrorBoundary } from "@/components/QueryErrorBoundary";
import { PhewTrophyIcon } from "@/components/icons/PhewIcons";
import { syncPostsIntoQueryCache } from "@/lib/post-query-cache";
import { V2StatusPill } from "@/components/ui/v2/V2StatusPill";

interface FeedPage {
  items: Post[];
  hasMore: boolean;
  nextCursor: string | null;
  totalPosts: number | null;
}

type CachedFeedPageEntry = {
  cachedAt: number;
  page: FeedPage;
};

const FEED_PAGE_SIZE = 10;
const FEED_MAX_PAGES = 5;
const FEED_FIRST_PAGE_CACHE_PREFIX = "phew.feed.first-page.v3";
const FEED_FIRST_PAGE_CACHE_TTL_MS = 30 * 60_000;
const FEED_PUBLIC_CACHE_SCOPE = "public";
const FEED_NEW_POSTS_POLL_MS = 15_000;
const FEED_ACTIVE_TAB_POLL_MS = 90_000;
const FEED_TAB_PREFETCH_ENABLED = false;
const FEED_TAB_PREFETCH_INITIAL_DELAY_MS = import.meta.env.PROD ? 2_500 : 1_200;
const FEED_TAB_PREFETCH_GAP_MS = import.meta.env.PROD ? 550 : 300;
const FEED_UNREAD_QUERY_STARTUP_DELAY_MS = import.meta.env.PROD ? 1_000 : 350;
const FEED_ANNOUNCEMENTS_QUERY_STARTUP_DELAY_MS = import.meta.env.PROD ? 2_400 : 650;
const FEED_TRENDING_QUERY_STARTUP_DELAY_MS = import.meta.env.PROD ? 4_200 : 1_000;
const FEED_REALTIME_ENRICHMENT_STARTUP_DELAY_MS = import.meta.env.PROD ? 900 : 250;
const FEED_BACKGROUND_REFRESH_STARTUP_DELAY_MS = import.meta.env.PROD ? 12_000 : 3_000;
const FEED_AUTO_APPLY_NEW_POSTS_TOP_THRESHOLD_PX = 600;
const FEED_REALTIME_STATE_FIELDS_COUNT = 20;
const FEED_CURRENT_USER_CACHE_KEY = "phew.feed.current-user";
const FEED_CURRENT_USER_CACHE_TTL_MS = 5 * 60_000;
const FEED_LATEST_ACK_CACHE_KEY = "phew.feed.latest.ack.v1";
const FEED_LATEST_ACK_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const FEED_RECENT_POST_CACHE_BYPASS_AGE_MS = 2 * 60 * 60 * 1000;
const FEED_LATEST_CACHE_HYDRATION_MAX_AGE_MS = 15_000;
const FEED_QUERY_GC_TIME_MS = 5 * 60_000;
const FEED_AI_REQUEST_TIMEOUT_MS = 4_200;
const FEED_LEGACY_FALLBACK_TIMEOUT_MS = 2_200;

type AiFeedResponse = {
  data?: {
    items?: Post[];
    nextCursor?: string | null;
    hasMore?: boolean;
    totalPosts?: number | null;
    degraded?: boolean;
  };
};

type LegacyFeedResponse = {
  data?: Post[];
  nextCursor?: string | null;
  hasMore?: boolean;
  totalPosts?: number | null;
};

function isGlobalOverlayOpen(): boolean {
  if (typeof document === "undefined") return false;
  if (
    document.body.classList.contains("overflow-hidden") ||
    document.documentElement.classList.contains("overflow-hidden") ||
    document.body.classList.contains("wallet-adapter-modal-open") ||
    document.body.classList.contains("phew-overlay-open")
  ) {
    return true;
  }
  if (document.body.style.overflow === "hidden" || document.documentElement.style.overflow === "hidden") {
    return true;
  }
  return document.querySelector("[role='dialog'][data-state='open']") !== null;
}

function hasActiveTradeDialogMarker(): boolean {
  if (typeof document === "undefined") return false;
  const active = document.body?.dataset?.phewActiveTradeDialogPostId?.trim();
  return Boolean(active);
}

function getFeedFirstPageCacheKey(viewerScope: string, tab: FeedTab, search: string): string {
  return `${FEED_FIRST_PAGE_CACHE_PREFIX}:${viewerScope}:${tab}:${search}`;
}

function readCachedFirstFeedPageEntry(
  viewerScope: string,
  tab: FeedTab,
  search: string
): CachedFeedPageEntry | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(getFeedFirstPageCacheKey(viewerScope, tab, search));
    if (!raw) return null;

    const parsed = JSON.parse(raw) as Partial<CachedFeedPageEntry>;

    if (
      typeof parsed?.cachedAt !== "number" ||
      !parsed.page ||
      !Array.isArray(parsed.page.items) ||
      parsed.page.items.length === 0 ||
      Date.now() - parsed.cachedAt > FEED_FIRST_PAGE_CACHE_TTL_MS
    ) {
      return null;
    }

    return {
      cachedAt: parsed.cachedAt,
      page: {
        ...parsed.page,
        totalPosts:
          typeof parsed.page.totalPosts === "number" && Number.isFinite(parsed.page.totalPosts)
            ? parsed.page.totalPosts
            : null,
      },
    };
  } catch {
    return null;
  }
}

function readCachedFirstFeedPage(viewerScope: string, tab: FeedTab, search: string): FeedPage | null {
  return readCachedFirstFeedPageEntry(viewerScope, tab, search)?.page ?? null;
}

function writeCachedFirstFeedPage(
  viewerScope: string,
  tab: FeedTab,
  search: string,
  page: FeedPage
): void {
  if (typeof window === "undefined") return;
  try {
    const cacheKey = getFeedFirstPageCacheKey(viewerScope, tab, search);
    if (!Array.isArray(page.items) || page.items.length === 0) {
      window.sessionStorage.removeItem(cacheKey);
      return;
    }
    window.sessionStorage.setItem(
      cacheKey,
      JSON.stringify({
        cachedAt: Date.now(),
        page,
      })
    );
  } catch {
    // Ignore storage quota / privacy mode issues.
  }
}

function stripPersonalizedPostState(post: Post): Post {
  if (!post.isLiked && !post.isReposted && !post.isFollowingAuthor) {
    return post;
  }

  return {
    ...post,
    isLiked: false,
    isReposted: false,
    isFollowingAuthor: false,
  };
}

function stripPersonalizedFeedPageState(page: FeedPage): FeedPage {
  let didChange = false;
  const nextItems = page.items.map((item) => {
    const nextItem = stripPersonalizedPostState(item);
    if (nextItem !== item) {
      didChange = true;
    }
    return nextItem;
  });

  if (!didChange) {
    return page;
  }

  return {
    ...page,
    items: nextItems,
  };
}

function shouldUseSharedPublicFeedCache(tab: FeedTab, search: string): boolean {
  return tab !== "following" && search.trim().length === 0;
}

function readPreferredCachedFirstFeedPageEntry(
  viewerScope: string,
  tab: FeedTab,
  search: string
): CachedFeedPageEntry | null {
  const scopedEntry = readCachedFirstFeedPageEntry(viewerScope, tab, search);
  if (scopedEntry?.page.items.length) {
    return scopedEntry;
  }
  if (!shouldUseSharedPublicFeedCache(tab, search) || viewerScope === FEED_PUBLIC_CACHE_SCOPE) {
    return scopedEntry;
  }
  const sharedEntry = readCachedFirstFeedPageEntry(FEED_PUBLIC_CACHE_SCOPE, tab, search);
  return sharedEntry?.page.items.length ? sharedEntry : scopedEntry;
}

function readPreferredCachedFirstFeedPage(
  viewerScope: string,
  tab: FeedTab,
  search: string
): FeedPage | null {
  return readPreferredCachedFirstFeedPageEntry(viewerScope, tab, search)?.page ?? null;
}

function writeCachedFirstFeedPageForScopes(
  viewerScope: string,
  tab: FeedTab,
  search: string,
  page: FeedPage
): void {
  writeCachedFirstFeedPage(viewerScope, tab, search, page);
  if (viewerScope !== FEED_PUBLIC_CACHE_SCOPE && shouldUseSharedPublicFeedCache(tab, search)) {
    writeCachedFirstFeedPage(
      FEED_PUBLIC_CACHE_SCOPE,
      tab,
      search,
      stripPersonalizedFeedPageState(page)
    );
  }
}

function buildRealtimePageFingerprint(page: FeedPage): string {
  return page.items
    .slice(0, FEED_REALTIME_STATE_FIELDS_COUNT)
    .map((item) => [
      item.id,
      item.settled ? "1" : "0",
      item.currentMcap ?? "null",
      item.mcap1h ?? "null",
      item.mcap6h ?? "null",
      item.isWin ?? "null",
      item.confidenceScore ?? "null",
      item.bundleRiskLabel ?? "null",
      item.timingTier ?? "null",
      item.author?.level ?? "null",
      item.author?.xp ?? "null",
    ].join(":"))
    .join("|");
}

function sortPostsNewestFirst(items: Post[]): Post[] {
  return [...items].sort((a, b) => {
    const createdAtDelta = new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    if (createdAtDelta !== 0) {
      return createdAtDelta;
    }
    return b.id.localeCompare(a.id);
  });
}

function isRecentFeedPost(post: Pick<Post, "createdAt"> | null | undefined): boolean {
  if (!post?.createdAt) return false;
  const createdAtMs = new Date(post.createdAt).getTime();
  if (!Number.isFinite(createdAtMs)) return false;
  return Date.now() - createdAtMs < FEED_RECENT_POST_CACHE_BYPASS_AGE_MS;
}

function shouldUseCachedFeedPageForHydration(
  entry: CachedFeedPageEntry | null,
  tab: FeedTab,
  search: string
): boolean {
  if (!entry?.page.items.length) return false;
  if (tab !== "latest" || search.trim().length > 0) return true;

  const cacheAgeMs = Date.now() - entry.cachedAt;
  const hasRecentLatestPosts = entry.page.items.slice(0, 5).some((post) => isRecentFeedPost(post));
  if (!hasRecentLatestPosts) {
    return true;
  }

  return cacheAgeMs <= FEED_LATEST_CACHE_HYDRATION_MAX_AGE_MS;
}

function shouldBypassCachedRealtimeMerge(post: Post, tab: FeedTab, search: string): boolean {
  return tab === "latest" && search.trim().length === 0 && isRecentFeedPost(post);
}

function shouldMergeSessionCachedRealtimeState(tab: FeedTab, search: string): boolean {
  return !(tab === "latest" && search.trim().length === 0);
}

function isMissingFeedValue<T>(value: T | null | undefined): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === "string") return value.trim().length === 0;
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

function parseFeedTimestamp(value: string | null | undefined): number {
  if (!value) return 0;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function getFeedMarketStateVersion(post: Pick<Post, "lastMcapUpdate" | "settledAt" | "createdAt">): number {
  return Math.max(
    parseFeedTimestamp(post.lastMcapUpdate),
    parseFeedTimestamp(post.settledAt),
    parseFeedTimestamp(post.createdAt)
  );
}

function getFeedIntelligenceVersion(post: Pick<Post, "lastIntelligenceAt">): number {
  return parseFeedTimestamp(post.lastIntelligenceAt);
}

function getFeedPostIntelligenceRichness(post: Post): number {
  let score = 0;
  const fields: Array<unknown> = [
    post.confidenceScore,
    post.hotAlphaScore,
    post.earlyRunnerScore,
    post.highConvictionScore,
    post.timingTier,
    post.firstCallerRank,
    post.roiPeakPct,
    post.roiCurrentPct,
    post.trustedTraderCount,
    post.entryQualityScore,
    post.bundlePenaltyScore,
    post.sentimentScore,
    post.tokenRiskScore,
    post.bundleRiskLabel,
    post.liquidity,
    post.volume24h,
    post.holderCount,
    post.largestHolderPct,
    post.top10HolderPct,
    post.bundledWalletCount,
    post.estimatedBundledSupplyPct,
    post.reactionCounts,
    post.currentReactionType,
    post.threadCount,
    post.radarReasons,
    post.author?.trustScore,
    post.author?.reputationTier,
    post.author?.winRate30d,
    post.author?.avgRoi30d,
    post.author?.firstCallCount,
    post.author?.isVerified,
  ];

  for (const field of fields) {
    if (!isMissingFeedValue(field)) {
      score += 1;
    }
  }

  if (Array.isArray(post.bundleClusters) && post.bundleClusters.length > 0) {
    score += 1;
  }

  return score;
}

function mergePostWithCachedRealtimeState(
  post: Post,
  cachedPost: Post | null | undefined,
  options?: { preserveEngagementState?: boolean }
): Post {
  if (!cachedPost) {
    return post;
  }

  let didChange = false;
  let nextCurrentMcap = post.currentMcap;
  let nextSettled = post.settled;
  let nextSettledAt = post.settledAt;
  let nextMcap1h = post.mcap1h;
  let nextMcap6h = post.mcap6h;
  let nextIsWin = post.isWin;
  let nextIsLiked = post.isLiked;
  let nextIsReposted = post.isReposted;
  let nextIsFollowingAuthor = post.isFollowingAuthor;
  let nextCounts = post._count;
  let nextTokenName = post.tokenName;
  let nextTokenSymbol = post.tokenSymbol;
  let nextTokenImage = post.tokenImage;
  let nextDexscreenerUrl = post.dexscreenerUrl;
  let nextConfidenceScore = post.confidenceScore;
  let nextHotAlphaScore = post.hotAlphaScore;
  let nextEarlyRunnerScore = post.earlyRunnerScore;
  let nextHighConvictionScore = post.highConvictionScore;
  let nextMarketHealthScore = post.marketHealthScore;
  let nextSetupQualityScore = post.setupQualityScore;
  let nextOpportunityScore = post.opportunityScore;
  let nextDataReliabilityScore = post.dataReliabilityScore;
  let nextActivityStatus = post.activityStatus;
  let nextActivityStatusLabel = post.activityStatusLabel;
  let nextIsTradable = post.isTradable;
  let nextBullishSignalsSuppressed = post.bullishSignalsSuppressed;
  let nextTimingTier = post.timingTier;
  let nextFirstCallerRank = post.firstCallerRank;
  let nextRoiPeakPct = post.roiPeakPct;
  let nextRoiCurrentPct = post.roiCurrentPct;
  let nextTrustedTraderCount = post.trustedTraderCount;
  let nextEntryQualityScore = post.entryQualityScore;
  let nextBundlePenaltyScore = post.bundlePenaltyScore;
  let nextSentimentScore = post.sentimentScore;
  let nextTokenRiskScore = post.tokenRiskScore;
  let nextBundleRiskLabel = post.bundleRiskLabel;
  let nextBundleScanCompletedAt = post.bundleScanCompletedAt ?? null;
  let nextLiquidity = post.liquidity;
  let nextVolume24h = post.volume24h;
  let nextHolderCount = post.holderCount;
  let nextLargestHolderPct = post.largestHolderPct;
  let nextTop10HolderPct = post.top10HolderPct;
  let nextBundledWalletCount = post.bundledWalletCount;
  let nextEstimatedBundledSupplyPct = post.estimatedBundledSupplyPct;
  let nextBundleClusters = post.bundleClusters;
  let nextReactionCounts = post.reactionCounts;
  let nextCurrentReactionType = post.currentReactionType;
  let nextThreadCount = post.threadCount;
  let nextRadarReasons = post.radarReasons;
  let nextAuthor = post.author;
  let nextLastMcapUpdate = post.lastMcapUpdate ?? null;
  let nextLastIntelligenceAt = post.lastIntelligenceAt ?? null;
  let nextTrackingMode = post.trackingMode ?? null;

  const fetchedMarketStateVersion = getFeedMarketStateVersion(post);
  const cachedMarketStateVersion = getFeedMarketStateVersion(cachedPost);
  const shouldPreferCachedMarketState = cachedMarketStateVersion > fetchedMarketStateVersion;
  const sameOrNewerCachedMarketState = cachedMarketStateVersion >= fetchedMarketStateVersion;
  const fetchedIntelligenceVersion = getFeedIntelligenceVersion(post);
  const cachedIntelligenceVersion = getFeedIntelligenceVersion(cachedPost);
  const sameOrNewerCachedIntelligence =
    cachedIntelligenceVersion > 0 && cachedIntelligenceVersion >= fetchedIntelligenceVersion;
  const hasNewerCachedIntelligence =
    cachedIntelligenceVersion > 0 && cachedIntelligenceVersion > fetchedIntelligenceVersion;
  const fetchedBundleLooksPlaceholder = isBundlePlaceholderState({
    bundleRiskLabel: post.bundleRiskLabel,
    bundleScanCompletedAt: post.bundleScanCompletedAt,
    bundledWalletCount: post.bundledWalletCount,
    estimatedBundledSupplyPct: post.estimatedBundledSupplyPct,
    bundleClusters: post.bundleClusters,
  });
  const cachedHasResolvedBundleEvidence = hasResolvedBundleEvidence({
    bundleRiskLabel: cachedPost.bundleRiskLabel,
    bundleScanCompletedAt: cachedPost.bundleScanCompletedAt,
    bundledWalletCount: cachedPost.bundledWalletCount,
    estimatedBundledSupplyPct: cachedPost.estimatedBundledSupplyPct,
    bundleClusters: cachedPost.bundleClusters,
  });

  const cachedLooksLikeLiveCurrent =
    cachedPost.currentMcap !== null &&
    cachedPost.entryMcap !== null &&
    cachedPost.currentMcap !== cachedPost.entryMcap;
  const fetchedLooksLikeBaselineCurrent =
    post.currentMcap === null ||
    (post.entryMcap !== null && post.currentMcap === post.entryMcap);

  if (cachedLooksLikeLiveCurrent && fetchedLooksLikeBaselineCurrent) {
    nextCurrentMcap = cachedPost.currentMcap;
    didChange = true;
  }

  if (shouldPreferCachedMarketState) {
    if (cachedPost.currentMcap !== null && cachedPost.currentMcap !== post.currentMcap) {
      nextCurrentMcap = cachedPost.currentMcap;
      didChange = true;
    }
    if (cachedPost.settled !== post.settled) {
      nextSettled = cachedPost.settled;
      didChange = true;
    }
    if (cachedPost.settledAt !== post.settledAt) {
      nextSettledAt = cachedPost.settledAt;
      didChange = true;
    }
    if (cachedPost.mcap1h !== null && cachedPost.mcap1h !== post.mcap1h) {
      nextMcap1h = cachedPost.mcap1h;
      didChange = true;
    }
    if (cachedPost.mcap6h !== null && cachedPost.mcap6h !== post.mcap6h) {
      nextMcap6h = cachedPost.mcap6h;
      didChange = true;
    }
    if (cachedPost.isWin !== null && cachedPost.isWin !== post.isWin) {
      nextIsWin = cachedPost.isWin;
      didChange = true;
    }
    if ((cachedPost.lastMcapUpdate ?? null) !== (post.lastMcapUpdate ?? null)) {
      nextLastMcapUpdate = cachedPost.lastMcapUpdate ?? null;
      didChange = true;
    }
    if ((cachedPost.trackingMode ?? null) !== (post.trackingMode ?? null)) {
      nextTrackingMode = cachedPost.trackingMode ?? null;
      didChange = true;
    }
  }

  if (hasNewerCachedIntelligence) {
    if ((cachedPost.lastIntelligenceAt ?? null) !== (post.lastIntelligenceAt ?? null)) {
      nextLastIntelligenceAt = cachedPost.lastIntelligenceAt ?? null;
      didChange = true;
    }
    if ((cachedPost.bundleScanCompletedAt ?? null) !== (post.bundleScanCompletedAt ?? null)) {
      nextBundleScanCompletedAt = cachedPost.bundleScanCompletedAt ?? null;
      didChange = true;
    }

    if (cachedPost.confidenceScore !== null && cachedPost.confidenceScore !== post.confidenceScore) {
      nextConfidenceScore = cachedPost.confidenceScore;
      didChange = true;
    }

    if (cachedPost.hotAlphaScore !== null && cachedPost.hotAlphaScore !== post.hotAlphaScore) {
      nextHotAlphaScore = cachedPost.hotAlphaScore;
      didChange = true;
    }

    if (cachedPost.earlyRunnerScore !== null && cachedPost.earlyRunnerScore !== post.earlyRunnerScore) {
      nextEarlyRunnerScore = cachedPost.earlyRunnerScore;
      didChange = true;
    }

    if (
      cachedPost.highConvictionScore !== null &&
      cachedPost.highConvictionScore !== post.highConvictionScore
    ) {
      nextHighConvictionScore = cachedPost.highConvictionScore;
      didChange = true;
    }
    if (cachedPost.marketHealthScore !== null && cachedPost.marketHealthScore !== post.marketHealthScore) {
      nextMarketHealthScore = cachedPost.marketHealthScore;
      didChange = true;
    }
    if (cachedPost.setupQualityScore !== null && cachedPost.setupQualityScore !== post.setupQualityScore) {
      nextSetupQualityScore = cachedPost.setupQualityScore;
      didChange = true;
    }
    if (cachedPost.opportunityScore !== null && cachedPost.opportunityScore !== post.opportunityScore) {
      nextOpportunityScore = cachedPost.opportunityScore;
      didChange = true;
    }
    if (
      cachedPost.dataReliabilityScore !== null &&
      cachedPost.dataReliabilityScore !== post.dataReliabilityScore
    ) {
      nextDataReliabilityScore = cachedPost.dataReliabilityScore;
      didChange = true;
    }
    if ((cachedPost.activityStatus ?? null) !== (post.activityStatus ?? null)) {
      nextActivityStatus = cachedPost.activityStatus ?? null;
      didChange = true;
    }
    if ((cachedPost.activityStatusLabel ?? null) !== (post.activityStatusLabel ?? null)) {
      nextActivityStatusLabel = cachedPost.activityStatusLabel ?? null;
      didChange = true;
    }
    if (cachedPost.isTradable !== post.isTradable) {
      nextIsTradable = cachedPost.isTradable;
      didChange = true;
    }
    if (cachedPost.bullishSignalsSuppressed !== post.bullishSignalsSuppressed) {
      nextBullishSignalsSuppressed = cachedPost.bullishSignalsSuppressed;
      didChange = true;
    }

    if (cachedPost.roiCurrentPct !== null && cachedPost.roiCurrentPct !== post.roiCurrentPct) {
      nextRoiCurrentPct = cachedPost.roiCurrentPct;
      didChange = true;
    }

    if (!isMissingFeedValue(cachedPost.timingTier) && cachedPost.timingTier !== post.timingTier) {
      nextTimingTier = cachedPost.timingTier;
      didChange = true;
    }

    if (!isMissingFeedValue(cachedPost.bundleRiskLabel) && cachedPost.bundleRiskLabel !== post.bundleRiskLabel) {
      nextBundleRiskLabel = cachedPost.bundleRiskLabel;
      didChange = true;
    }

    if (cachedPost.tokenRiskScore !== null && cachedPost.tokenRiskScore !== post.tokenRiskScore) {
      nextTokenRiskScore = cachedPost.tokenRiskScore;
      didChange = true;
    }

    if (cachedPost.liquidity !== null && cachedPost.liquidity !== post.liquidity) {
      nextLiquidity = cachedPost.liquidity;
      didChange = true;
    }

    if (cachedPost.volume24h !== null && cachedPost.volume24h !== post.volume24h) {
      nextVolume24h = cachedPost.volume24h;
      didChange = true;
    }

    if (cachedPost.holderCount !== null && cachedPost.holderCount !== post.holderCount) {
      nextHolderCount = cachedPost.holderCount;
      didChange = true;
    }

    if (cachedPost.largestHolderPct !== null && cachedPost.largestHolderPct !== post.largestHolderPct) {
      nextLargestHolderPct = cachedPost.largestHolderPct;
      didChange = true;
    }

    if (cachedPost.top10HolderPct !== null && cachedPost.top10HolderPct !== post.top10HolderPct) {
      nextTop10HolderPct = cachedPost.top10HolderPct;
      didChange = true;
    }

    if (
      cachedPost.bundledWalletCount !== null &&
      cachedPost.bundledWalletCount !== post.bundledWalletCount
    ) {
      nextBundledWalletCount = cachedPost.bundledWalletCount;
      didChange = true;
    }

    if (
      cachedPost.estimatedBundledSupplyPct !== null &&
      cachedPost.estimatedBundledSupplyPct !== post.estimatedBundledSupplyPct
    ) {
      nextEstimatedBundledSupplyPct = cachedPost.estimatedBundledSupplyPct;
      didChange = true;
    }
  }

  if (cachedPost.settled && !post.settled) {
    nextSettled = true;
    nextSettledAt = cachedPost.settledAt ?? post.settledAt;
    didChange = true;
  }

  if (cachedPost.mcap1h !== null && post.mcap1h === null) {
    nextMcap1h = cachedPost.mcap1h;
    didChange = true;
  }

  if (cachedPost.mcap6h !== null && post.mcap6h === null) {
    nextMcap6h = cachedPost.mcap6h;
    didChange = true;
  }

  if (cachedPost.isWin !== null && post.isWin === null) {
    nextIsWin = cachedPost.isWin;
    didChange = true;
  }

  if (isMissingFeedValue(post.tokenName) && !isMissingFeedValue(cachedPost.tokenName)) {
    nextTokenName = cachedPost.tokenName;
    didChange = true;
  }

  if (isMissingFeedValue(post.tokenSymbol) && !isMissingFeedValue(cachedPost.tokenSymbol)) {
    nextTokenSymbol = cachedPost.tokenSymbol;
    didChange = true;
  }

  if (isMissingFeedValue(post.tokenImage) && !isMissingFeedValue(cachedPost.tokenImage)) {
    nextTokenImage = cachedPost.tokenImage;
    didChange = true;
  }

  if (isMissingFeedValue(post.dexscreenerUrl) && !isMissingFeedValue(cachedPost.dexscreenerUrl)) {
    nextDexscreenerUrl = cachedPost.dexscreenerUrl;
    didChange = true;
  }

  if (
    sameOrNewerCachedIntelligence &&
    post.confidenceScore == null &&
    cachedPost.confidenceScore != null
  ) {
    nextConfidenceScore = cachedPost.confidenceScore;
    didChange = true;
  }

  if (
    sameOrNewerCachedIntelligence &&
    typeof cachedPost.confidenceScore === "number" &&
    cachedPost.confidenceScore > 0 &&
    (post.confidenceScore == null || post.confidenceScore <= 0)
  ) {
    nextConfidenceScore = cachedPost.confidenceScore;
    didChange = true;
  }

  if (
    sameOrNewerCachedIntelligence &&
    post.hotAlphaScore == null &&
    cachedPost.hotAlphaScore != null
  ) {
    nextHotAlphaScore = cachedPost.hotAlphaScore;
    didChange = true;
  }

  if (
    sameOrNewerCachedIntelligence &&
    typeof cachedPost.hotAlphaScore === "number" &&
    cachedPost.hotAlphaScore > 0 &&
    (post.hotAlphaScore == null || post.hotAlphaScore <= 0)
  ) {
    nextHotAlphaScore = cachedPost.hotAlphaScore;
    didChange = true;
  }

  if (
    sameOrNewerCachedIntelligence &&
    post.earlyRunnerScore == null &&
    cachedPost.earlyRunnerScore != null
  ) {
    nextEarlyRunnerScore = cachedPost.earlyRunnerScore;
    didChange = true;
  }

  if (
    sameOrNewerCachedIntelligence &&
    typeof cachedPost.earlyRunnerScore === "number" &&
    cachedPost.earlyRunnerScore > 0 &&
    (post.earlyRunnerScore == null || post.earlyRunnerScore <= 0)
  ) {
    nextEarlyRunnerScore = cachedPost.earlyRunnerScore;
    didChange = true;
  }

  if (
    sameOrNewerCachedIntelligence &&
    post.highConvictionScore == null &&
    cachedPost.highConvictionScore != null
  ) {
    nextHighConvictionScore = cachedPost.highConvictionScore;
    didChange = true;
  }

  if (
    sameOrNewerCachedIntelligence &&
    typeof cachedPost.highConvictionScore === "number" &&
    cachedPost.highConvictionScore > 0 &&
    (post.highConvictionScore == null || post.highConvictionScore <= 0)
  ) {
    nextHighConvictionScore = cachedPost.highConvictionScore;
    didChange = true;
  }

  if (isMissingFeedValue(post.timingTier) && !isMissingFeedValue(cachedPost.timingTier)) {
    nextTimingTier = cachedPost.timingTier;
    didChange = true;
  }

  if (post.firstCallerRank == null && cachedPost.firstCallerRank != null) {
    nextFirstCallerRank = cachedPost.firstCallerRank;
    didChange = true;
  }

  if (post.roiPeakPct == null && cachedPost.roiPeakPct != null) {
    nextRoiPeakPct = cachedPost.roiPeakPct;
    didChange = true;
  }

  if (post.roiCurrentPct == null && cachedPost.roiCurrentPct != null) {
    nextRoiCurrentPct = cachedPost.roiCurrentPct;
    didChange = true;
  }

  if (post.trustedTraderCount == null && cachedPost.trustedTraderCount != null) {
    nextTrustedTraderCount = cachedPost.trustedTraderCount;
    didChange = true;
  }

  if (post.entryQualityScore == null && cachedPost.entryQualityScore != null) {
    nextEntryQualityScore = cachedPost.entryQualityScore;
    didChange = true;
  }

  if (post.bundlePenaltyScore == null && cachedPost.bundlePenaltyScore != null) {
    nextBundlePenaltyScore = cachedPost.bundlePenaltyScore;
    didChange = true;
  }

  if (post.sentimentScore == null && cachedPost.sentimentScore != null) {
    nextSentimentScore = cachedPost.sentimentScore;
    didChange = true;
  }

  if (post.tokenRiskScore == null && cachedPost.tokenRiskScore != null) {
    nextTokenRiskScore = cachedPost.tokenRiskScore;
    didChange = true;
  }

  if (isMissingFeedValue(post.bundleRiskLabel) && !isMissingFeedValue(cachedPost.bundleRiskLabel)) {
    nextBundleRiskLabel = cachedPost.bundleRiskLabel;
    didChange = true;
  }

  if (post.liquidity == null && cachedPost.liquidity != null) {
    nextLiquidity = cachedPost.liquidity;
    didChange = true;
  }

  if (post.volume24h == null && cachedPost.volume24h != null) {
    nextVolume24h = cachedPost.volume24h;
    didChange = true;
  }

  if (post.holderCount == null && cachedPost.holderCount != null) {
    nextHolderCount = cachedPost.holderCount;
    didChange = true;
  }

  if (post.largestHolderPct == null && cachedPost.largestHolderPct != null) {
    nextLargestHolderPct = cachedPost.largestHolderPct;
    didChange = true;
  }

  if (post.top10HolderPct == null && cachedPost.top10HolderPct != null) {
    nextTop10HolderPct = cachedPost.top10HolderPct;
    didChange = true;
  }

  if (post.bundledWalletCount == null && cachedPost.bundledWalletCount != null) {
    nextBundledWalletCount = cachedPost.bundledWalletCount;
    didChange = true;
  }

  if (post.estimatedBundledSupplyPct == null && cachedPost.estimatedBundledSupplyPct != null) {
    nextEstimatedBundledSupplyPct = cachedPost.estimatedBundledSupplyPct;
    didChange = true;
  }

  if (
    sameOrNewerCachedIntelligence &&
    cachedHasResolvedBundleEvidence &&
    fetchedBundleLooksPlaceholder
  ) {
    if (!isMissingFeedValue(cachedPost.bundleRiskLabel) && cachedPost.bundleRiskLabel !== post.bundleRiskLabel) {
      nextBundleRiskLabel = cachedPost.bundleRiskLabel;
      didChange = true;
    }
    if (cachedPost.tokenRiskScore !== null && cachedPost.tokenRiskScore !== post.tokenRiskScore) {
      nextTokenRiskScore = cachedPost.tokenRiskScore;
      didChange = true;
    }
    if (cachedPost.bundledWalletCount !== null && cachedPost.bundledWalletCount !== post.bundledWalletCount) {
      nextBundledWalletCount = cachedPost.bundledWalletCount;
      didChange = true;
    }
    if (
      cachedPost.estimatedBundledSupplyPct !== null &&
      cachedPost.estimatedBundledSupplyPct !== post.estimatedBundledSupplyPct
    ) {
      nextEstimatedBundledSupplyPct = cachedPost.estimatedBundledSupplyPct;
      didChange = true;
    }
    if (!isMissingFeedValue(cachedPost.bundleClusters) && cachedPost.bundleClusters !== post.bundleClusters) {
      nextBundleClusters = cachedPost.bundleClusters;
      didChange = true;
    }
    if ((cachedPost.lastIntelligenceAt ?? null) !== (post.lastIntelligenceAt ?? null)) {
      nextLastIntelligenceAt = cachedPost.lastIntelligenceAt ?? null;
      didChange = true;
    }
    if ((cachedPost.bundleScanCompletedAt ?? null) !== (post.bundleScanCompletedAt ?? null)) {
      nextBundleScanCompletedAt = cachedPost.bundleScanCompletedAt ?? null;
      didChange = true;
    }
  }

  if (
    sameOrNewerCachedIntelligence &&
    typeof cachedPost.estimatedBundledSupplyPct === "number" &&
    cachedPost.estimatedBundledSupplyPct > 0 &&
    (post.estimatedBundledSupplyPct == null || fetchedBundleLooksPlaceholder)
  ) {
    nextEstimatedBundledSupplyPct = cachedPost.estimatedBundledSupplyPct;
    didChange = true;
  }

  if (post.marketHealthScore == null && cachedPost.marketHealthScore != null) {
    nextMarketHealthScore = cachedPost.marketHealthScore;
    didChange = true;
  }

  if (post.setupQualityScore == null && cachedPost.setupQualityScore != null) {
    nextSetupQualityScore = cachedPost.setupQualityScore;
    didChange = true;
  }

  if (post.opportunityScore == null && cachedPost.opportunityScore != null) {
    nextOpportunityScore = cachedPost.opportunityScore;
    didChange = true;
  }

  if (post.dataReliabilityScore == null && cachedPost.dataReliabilityScore != null) {
    nextDataReliabilityScore = cachedPost.dataReliabilityScore;
    didChange = true;
  }

  if (isMissingFeedValue(post.activityStatus) && !isMissingFeedValue(cachedPost.activityStatus)) {
    nextActivityStatus = cachedPost.activityStatus;
    didChange = true;
  }

  if (isMissingFeedValue(post.activityStatusLabel) && !isMissingFeedValue(cachedPost.activityStatusLabel)) {
    nextActivityStatusLabel = cachedPost.activityStatusLabel;
    didChange = true;
  }

  if (isMissingFeedValue(post.bundleClusters) && !isMissingFeedValue(cachedPost.bundleClusters)) {
    nextBundleClusters = cachedPost.bundleClusters;
    didChange = true;
  }

  if (isMissingFeedValue(post.reactionCounts) && !isMissingFeedValue(cachedPost.reactionCounts)) {
    nextReactionCounts = cachedPost.reactionCounts;
    didChange = true;
  }

  if (isMissingFeedValue(post.currentReactionType) && !isMissingFeedValue(cachedPost.currentReactionType)) {
    nextCurrentReactionType = cachedPost.currentReactionType;
    didChange = true;
  }

  if (post.threadCount == null && cachedPost.threadCount != null) {
    nextThreadCount = cachedPost.threadCount;
    didChange = true;
  }

  if (isMissingFeedValue(post.radarReasons) && !isMissingFeedValue(cachedPost.radarReasons)) {
    nextRadarReasons = cachedPost.radarReasons;
    didChange = true;
  }

  const nextAuthorTrustScore =
    post.author.trustScore == null && cachedPost.author?.trustScore != null
      ? cachedPost.author.trustScore
      : post.author.trustScore;
  const nextAuthorReputationTier =
    isMissingFeedValue(post.author.reputationTier) && !isMissingFeedValue(cachedPost.author?.reputationTier)
      ? cachedPost.author.reputationTier
      : post.author.reputationTier;
  const nextAuthorWinRate30d =
    post.author.winRate30d == null && cachedPost.author?.winRate30d != null
      ? cachedPost.author.winRate30d
      : post.author.winRate30d;
  const nextAuthorAvgRoi30d =
    post.author.avgRoi30d == null && cachedPost.author?.avgRoi30d != null
      ? cachedPost.author.avgRoi30d
      : post.author.avgRoi30d;
  const nextAuthorFirstCallCount =
    post.author.firstCallCount == null && cachedPost.author?.firstCallCount != null
      ? cachedPost.author.firstCallCount
      : post.author.firstCallCount;
  const nextAuthorIsVerified =
    post.author.isVerified == null && cachedPost.author?.isVerified != null
      ? cachedPost.author.isVerified
      : post.author.isVerified;

  if (
    nextAuthorTrustScore !== post.author.trustScore ||
    nextAuthorReputationTier !== post.author.reputationTier ||
    nextAuthorWinRate30d !== post.author.winRate30d ||
    nextAuthorAvgRoi30d !== post.author.avgRoi30d ||
    nextAuthorFirstCallCount !== post.author.firstCallCount ||
    nextAuthorIsVerified !== post.author.isVerified
  ) {
    nextAuthor = {
      ...post.author,
      trustScore: nextAuthorTrustScore,
      reputationTier: nextAuthorReputationTier,
      winRate30d: nextAuthorWinRate30d,
      avgRoi30d: nextAuthorAvgRoi30d,
      firstCallCount: nextAuthorFirstCallCount,
      isVerified: nextAuthorIsVerified,
    };
    didChange = true;
  }

  if (options?.preserveEngagementState) {
    if (cachedPost.isLiked && !post.isLiked) {
      nextIsLiked = true;
      didChange = true;

      const fetchedLikes = post._count?.likes ?? 0;
      const cachedLikes = cachedPost._count?.likes ?? fetchedLikes;
      if (cachedLikes > fetchedLikes) {
        nextCounts = {
          ...nextCounts,
          likes: cachedLikes,
        };
      }
    }

    if (cachedPost.isReposted && !post.isReposted) {
      nextIsReposted = true;
      didChange = true;

      const fetchedReposts = post._count?.reposts ?? 0;
      const cachedReposts = cachedPost._count?.reposts ?? fetchedReposts;
      if (cachedReposts > fetchedReposts) {
        nextCounts = {
          ...nextCounts,
          reposts: cachedReposts,
        };
      }
    }

    if (cachedPost.isFollowingAuthor && !post.isFollowingAuthor) {
      nextIsFollowingAuthor = true;
      didChange = true;
    }
  }

  if (!didChange) {
    return post;
  }

  return {
    ...post,
    currentMcap: nextCurrentMcap,
    settled: nextSettled,
    settledAt: nextSettledAt,
    mcap1h: nextMcap1h,
    mcap6h: nextMcap6h,
    isWin: nextIsWin,
    lastMcapUpdate: nextLastMcapUpdate,
    lastIntelligenceAt: nextLastIntelligenceAt,
    trackingMode: nextTrackingMode,
    tokenName: nextTokenName,
    tokenSymbol: nextTokenSymbol,
    tokenImage: nextTokenImage,
    dexscreenerUrl: nextDexscreenerUrl,
    confidenceScore: nextConfidenceScore,
    hotAlphaScore: nextHotAlphaScore,
    earlyRunnerScore: nextEarlyRunnerScore,
    highConvictionScore: nextHighConvictionScore,
    marketHealthScore: nextMarketHealthScore,
    setupQualityScore: nextSetupQualityScore,
    opportunityScore: nextOpportunityScore,
    dataReliabilityScore: nextDataReliabilityScore,
    activityStatus: nextActivityStatus,
    activityStatusLabel: nextActivityStatusLabel,
    isTradable: nextIsTradable,
    bullishSignalsSuppressed: nextBullishSignalsSuppressed,
    timingTier: nextTimingTier,
    firstCallerRank: nextFirstCallerRank,
    roiPeakPct: nextRoiPeakPct,
    roiCurrentPct: nextRoiCurrentPct,
    trustedTraderCount: nextTrustedTraderCount,
    entryQualityScore: nextEntryQualityScore,
    bundlePenaltyScore: nextBundlePenaltyScore,
    sentimentScore: nextSentimentScore,
    tokenRiskScore: nextTokenRiskScore,
    bundleRiskLabel: nextBundleRiskLabel,
    bundleScanCompletedAt: nextBundleScanCompletedAt,
    liquidity: nextLiquidity,
    volume24h: nextVolume24h,
    holderCount: nextHolderCount,
    largestHolderPct: nextLargestHolderPct,
    top10HolderPct: nextTop10HolderPct,
    bundledWalletCount: nextBundledWalletCount,
    estimatedBundledSupplyPct: nextEstimatedBundledSupplyPct,
    bundleClusters: nextBundleClusters,
    reactionCounts: nextReactionCounts,
    currentReactionType: nextCurrentReactionType,
    threadCount: nextThreadCount,
    radarReasons: nextRadarReasons,
    author: nextAuthor,
    isLiked: nextIsLiked,
    isReposted: nextIsReposted,
    isFollowingAuthor: nextIsFollowingAuthor,
    _count: nextCounts,
  };
}

function resolveFeedCardRealtimePriceMode(post: Post): PostCardRealtimePriceMode {
  const createdAtMs = new Date(post.createdAt).getTime();
  if (!Number.isFinite(createdAtMs)) {
    return "active";
  }
  if (!post.settled) {
    return "active";
  }
  return Date.now() - createdAtMs < FEED_RECENT_POST_CACHE_BYPASS_AGE_MS ? "active" : "passive";
}

function buildLegacyFeedEndpoint(tab: FeedTab, search: string, pageParam?: string): string {
  const params = new URLSearchParams();
  params.set("limit", String(FEED_PAGE_SIZE));
  params.set(
    "sort",
    tab === "hot-alpha" || tab === "high-conviction" ? "trending" : "latest"
  );
  if (tab === "following") {
    params.set("following", "true");
  }
  if (search && search.length >= 3) {
    params.set("search", search);
  }
  if (pageParam) {
    params.set("cursor", pageParam);
  }
  return `/api/posts?${params.toString()}`;
}

function isBackendPoolPressureError(error: unknown): boolean {
  if (error instanceof TimeoutError) {
    return true;
  }

  if (error instanceof ApiError) {
    if (error.status === 429 || error.status === 503) {
      return true;
    }

    const message = error.message.toLowerCase();
    if (error.status >= 500) {
      return (
        message.includes("database") ||
        message.includes("connection pool") ||
        message.includes("pool timeout") ||
        message.includes("timed out") ||
        message.includes("temporarily unavailable") ||
        message.includes("unable to check out connection")
      );
    }
  }

  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    return (
      message.includes("connection pool") ||
      message.includes("pool timeout") ||
      message.includes("timed out") ||
      message.includes("temporarily unavailable") ||
      message.includes("unable to check out connection")
    );
  }

  return false;
}

// Error Boundary Component for Feed
function FeedError({ error, onRetry }: { error: Error; onRetry: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 gap-4 text-center">
      <div className="w-20 h-20 rounded-full bg-destructive/10 flex items-center justify-center">
        <AlertCircle className="h-10 w-10 text-destructive" />
      </div>
      <div>
        <p className="font-semibold text-foreground text-lg">Failed to load posts</p>
        <p className="text-sm text-muted-foreground mt-1 max-w-xs">
          {error.message || "Something went wrong. Please try again."}
        </p>
      </div>
      <Button onClick={onRetry} variant="outline" className="mt-2">
        <RefreshCw className="h-4 w-4 mr-2" />
        Try Again
      </Button>
    </div>
  );
}

export default function Feed() {
  const { data: session } = useSession();
  const { signOut, hasLiveSession, canPerformAuthenticatedWrites, isUsingCachedUser } = useAuth();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [activeTab, setActiveTab] = useState<FeedTab>("latest");
  const [searchQuery, setSearchQuery] = useState(searchParams.get("search") || "");
  const loadMoreRef = useRef<HTMLDivElement>(null);
  const [hasUserScrolledForAutoLoad, setHasUserScrolledForAutoLoad] = useState(false);
  const [pendingLatestFirstPage, setPendingLatestFirstPage] = useState<FeedPage | null>(null);
  const [pendingLatestCount, setPendingLatestCount] = useState(0);
  const [isManualRefreshing, setIsManualRefreshing] = useState(false);
  const [isOverlayOpen, setIsOverlayOpen] = useState<boolean>(() => isGlobalOverlayOpen());
  const [frozenPostsWhileOverlayOpen, setFrozenPostsWhileOverlayOpen] = useState<Post[] | null>(null);
  const [feedUnreadQueryReady, setFeedUnreadQueryReady] = useState(false);
  const [feedAnnouncementsReady, setFeedAnnouncementsReady] = useState(false);
  const [feedTrendingReady, setFeedTrendingReady] = useState(false);
  const [feedRealtimeEnrichmentReady, setFeedRealtimeEnrichmentReady] = useState(false);
  const [feedBackgroundRefreshReady, setFeedBackgroundRefreshReady] = useState(false);
  const [latestAcknowledgedTopId, setLatestAcknowledgedTopId] = useState<string | null>(() =>
    readSessionCache<string>(FEED_LATEST_ACK_CACHE_KEY, FEED_LATEST_ACK_CACHE_TTL_MS)
  );
  const feedShownLoggedRef = useRef(false);
  const latestAcknowledgedTopIdRef = useRef<string | null>(latestAcknowledgedTopId);
  const effectiveSearchQuery = searchQuery.trim().length >= 3 ? searchQuery.trim() : "";
  // Keep feed cache/query scope stable while backend session confirmation catches up.
  // Using hasLiveSession here causes the feed query to bounce between anonymous and
  // user-scoped keys during transient /api/me churn, which can leave the page stuck
  // in loading even when /api/feed/latest itself is healthy.
  const feedViewerScope = session?.user?.id ?? "anonymous";
  const cachedFirstPageEntry = useMemo(
    () => readPreferredCachedFirstFeedPageEntry(feedViewerScope, activeTab, effectiveSearchQuery),
    [activeTab, effectiveSearchQuery, feedViewerScope]
  );
  const cachedFirstPage = cachedFirstPageEntry?.page ?? null;
  const hydrationCachedFirstPageEntry = useMemo(
    () =>
      shouldUseCachedFeedPageForHydration(cachedFirstPageEntry, activeTab, effectiveSearchQuery)
        ? cachedFirstPageEntry
        : null,
    [activeTab, cachedFirstPageEntry, effectiveSearchQuery]
  );
  const hydrationCachedFirstPage = hydrationCachedFirstPageEntry?.page ?? null;
  const feedCurrentUserCacheKey = useMemo(
    () => (session?.user?.id ? `${FEED_CURRENT_USER_CACHE_KEY}:${session.user.id}` : null),
    [session?.user?.id]
  );
  const cachedFeedUser = useMemo(
    () =>
      feedCurrentUserCacheKey
        ? readSessionCache<User>(feedCurrentUserCacheKey, FEED_CURRENT_USER_CACHE_TTL_MS)
        : null,
    [feedCurrentUserCacheKey]
  );
  const sessionBackedUser = useMemo<User | null>(() => {
    if (!session?.user) return cachedFeedUser;
    return {
      id: session.user.id,
      name: session.user.name,
      email: session.user.email,
      image: session.user.image ?? cachedFeedUser?.image ?? null,
      walletAddress: session.user.walletAddress ?? cachedFeedUser?.walletAddress ?? null,
      username: session.user.username ?? cachedFeedUser?.username ?? null,
      level: session.user.level ?? cachedFeedUser?.level ?? 0,
      xp: session.user.xp ?? cachedFeedUser?.xp ?? 0,
      bio: session.user.bio ?? cachedFeedUser?.bio ?? null,
      isAdmin: session.user.isAdmin ?? cachedFeedUser?.isAdmin ?? false,
      isVerified: session.user.isVerified ?? cachedFeedUser?.isVerified,
      tradeFeeRewardsEnabled:
        session.user.tradeFeeRewardsEnabled ?? cachedFeedUser?.tradeFeeRewardsEnabled,
      tradeFeeShareBps: session.user.tradeFeeShareBps ?? cachedFeedUser?.tradeFeeShareBps,
      tradeFeePayoutAddress:
        session.user.tradeFeePayoutAddress ?? cachedFeedUser?.tradeFeePayoutAddress ?? null,
      createdAt: session.user.createdAt ?? cachedFeedUser?.createdAt ?? new Date(0).toISOString(),
    };
  }, [cachedFeedUser, session?.user]);
  const isAuthWritePending = Boolean(session?.user) && !canPerformAuthenticatedWrites;
  const persistLatestAcknowledgedTopId = useCallback((nextTopId: string | null) => {
    latestAcknowledgedTopIdRef.current = nextTopId;
    setLatestAcknowledgedTopId(nextTopId);
    if (typeof window === "undefined") return;

    try {
      if (nextTopId) {
        writeSessionCache(FEED_LATEST_ACK_CACHE_KEY, nextTopId);
        return;
      }
      window.sessionStorage.removeItem(FEED_LATEST_ACK_CACHE_KEY);
    } catch {
      // Ignore storage access failures.
    }
  }, []);
  const clearPendingLatestState = useCallback(() => {
    setPendingLatestFirstPage(null);
    setPendingLatestCount(0);
  }, []);
  const setPendingLatestState = useCallback((nextFirstPage: FeedPage, nextCount: number) => {
    setPendingLatestFirstPage(nextFirstPage);
    setPendingLatestCount(nextCount);
  }, []);

  useEffect(() => {
    if (!hasLiveSession || !session?.user?.id) {
      feedShownLoggedRef.current = false;
      return;
    }

    if (feedShownLoggedRef.current) {
      return;
    }

    feedShownLoggedRef.current = true;
    console.info("[AuthFlow] feed shown", {
      userId: session.user.id,
      pathname: typeof window !== "undefined" ? window.location.pathname : null,
    });
  }, [hasLiveSession, session?.user?.id]);

  useEffect(() => {
    latestAcknowledgedTopIdRef.current = latestAcknowledgedTopId;
  }, [latestAcknowledgedTopId]);

  const guardPendingAuthWrite = useCallback(() => {
    if (!session?.user) {
      toast.info("Sign in to interact with posts.");
      return true;
    }
    if (!isAuthWritePending) {
      return false;
    }
    toast.warning("Signing you in...");
    return true;
  }, [isAuthWritePending, session?.user]);

  const handleSignOut = useCallback(async () => {
    await signOut();
    navigate("/login", { replace: true });
  }, [navigate, signOut]);

  const handleWriteSessionExpired = useCallback(() => {
    toast.error("Session expired. Please sign in again.");
    void handleSignOut();
  }, [handleSignOut]);

  const getFeedQueryKey = useCallback(
    (tab: FeedTab, search: string, viewerScope: string) =>
      ["posts", viewerScope, tab, search] as const,
    []
  );
  const activeFeedQueryKey = useMemo(
    () => getFeedQueryKey(activeTab, effectiveSearchQuery, feedViewerScope),
    [activeTab, effectiveSearchQuery, feedViewerScope, getFeedQueryKey]
  );

  useEffect(() => {
    if (typeof document === "undefined" || typeof window === "undefined") return;

    let rafId = 0;
    const syncOverlayState = () => {
      if (rafId) return;
      rafId = window.requestAnimationFrame(() => {
        rafId = 0;
        const next = isGlobalOverlayOpen();
        setIsOverlayOpen((prev) => (prev === next ? prev : next));
      });
    };

    syncOverlayState();

    const observer = new MutationObserver(() => syncOverlayState());
    if (document.body) {
      observer.observe(document.body, {
        subtree: true,
        childList: true,
        attributes: true,
        attributeFilter: [
          "class",
          "style",
          "data-state",
          "role",
          "data-phew-pinned-item-key",
          "data-phew-active-trade-dialog-post-id",
        ],
      });
    }
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "style"],
    });

    window.addEventListener("focus", syncOverlayState);
    document.addEventListener("visibilitychange", syncOverlayState);
    return () => {
      if (rafId) {
        window.cancelAnimationFrame(rafId);
      }
      observer.disconnect();
      window.removeEventListener("focus", syncOverlayState);
      document.removeEventListener("visibilitychange", syncOverlayState);
    };
  }, []);

  const fetchFeedPage = useCallback(async (
    tab: FeedTab,
    search: string,
    pageParam?: string
  ): Promise<FeedPage> => {
    const liveCachedFirstPageEntry =
      !pageParam && !search && tab !== "following"
        ? readPreferredCachedFirstFeedPageEntry(feedViewerScope, tab, search)
        : null;
    const liveCachedFirstPage = liveCachedFirstPageEntry?.page ?? null;
    const queryKey = getFeedQueryKey(tab, search, feedViewerScope);
    const currentQueryFirstPage =
      !pageParam
        ? queryClient.getQueryData<InfiniteData<FeedPage>>(queryKey)?.pages?.[0] ?? null
        : null;
    const hasCurrentFirstPage = Boolean(currentQueryFirstPage?.items.length);
    const fallbackFirstPage =
      hasCurrentFirstPage && currentQueryFirstPage
        ? currentQueryFirstPage
        : liveCachedFirstPage && liveCachedFirstPage.items.length > 0
          ? liveCachedFirstPage
          : currentQueryFirstPage && currentQueryFirstPage.items.length > 0
            ? currentQueryFirstPage
            : null;
    const shouldUseCachedFirstPageFallback = !pageParam && !search && tab !== "following" && Boolean(fallbackFirstPage?.items.length);
    let endpoint = `/api/feed/${tab}`;
    const params = new URLSearchParams();

    if (search && search.length >= 3) {
      params.set("search", search);
    }
    params.set("limit", String(FEED_PAGE_SIZE));
    if (pageParam) {
      params.set("cursor", pageParam);
    }

    if (params.toString()) {
      endpoint += `?${params.toString()}`;
    }

    const requestCacheMode: RequestCache =
      !pageParam &&
      !search &&
      tab !== "following" &&
      feedViewerScope === FEED_PUBLIC_CACHE_SCOPE
        ? "default"
        : "no-store";

    const readPrimaryFeedPayload = async (): Promise<FeedPage> => {
      const response = await api.raw(endpoint, {
        cache: requestCacheMode,
        timeout: FEED_AI_REQUEST_TIMEOUT_MS,
      });
      if (!response.ok) {
        const json = await response.json().catch(() => null);
        throw new ApiError(
          json?.error?.message || `Request failed with status ${response.status}`,
          response.status,
          json?.error || json
        );
      }

      const json = await response.json().catch(() => null) as AiFeedResponse | null;
      const data = json?.data;
      if (!data || !Array.isArray(data.items)) {
        throw new ApiError("Feed payload was invalid. Please retry.", response.status, json);
      }
      if (data.degraded === true) {
        if (shouldUseCachedFirstPageFallback && fallbackFirstPage) {
          return fallbackFirstPage;
        }

        return {
          items: data.items,
          nextCursor: null,
          hasMore: false,
          totalPosts:
            typeof data.totalPosts === "number" && Number.isFinite(data.totalPosts)
              ? data.totalPosts
              : null,
        };
      }

      return {
        items: data.items,
        nextCursor: typeof data.nextCursor === "string" ? data.nextCursor : null,
        hasMore: Boolean(data.hasMore && data.nextCursor),
        totalPosts:
          typeof data.totalPosts === "number" && Number.isFinite(data.totalPosts)
            ? data.totalPosts
            : null,
      };
    };

    const readLegacyFeedPayload = async (): Promise<FeedPage> => {
      const legacyEndpoint = buildLegacyFeedEndpoint(tab, search, pageParam);
      const response = await api.raw(legacyEndpoint, {
        cache: requestCacheMode,
        timeout: FEED_LEGACY_FALLBACK_TIMEOUT_MS,
      });
      if (!response.ok) {
        const json = await response.json().catch(() => null);
        throw new ApiError(
          json?.error?.message || `Request failed with status ${response.status}`,
          response.status,
          json?.error || json
        );
      }

      const json = await response.json().catch(() => null) as LegacyFeedResponse | null;
      const items = Array.isArray(json?.data) ? json.data : null;
      if (!items) {
        throw new ApiError("Legacy feed payload was invalid. Please retry.", response.status, json);
      }

      const nextCursor = typeof json?.nextCursor === "string" ? json.nextCursor : null;
      return {
        items,
        nextCursor,
        hasMore: Boolean(json?.hasMore && nextCursor),
        totalPosts:
          typeof json?.totalPosts === "number" && Number.isFinite(json.totalPosts)
            ? json.totalPosts
            : null,
      };
    };

    let page: FeedPage;
    try {
      page = await readPrimaryFeedPayload();
      const shouldFallbackFromEmptyPrimary =
        !pageParam &&
        page.items.length === 0 &&
        (tab === "latest" || tab === "following");
      if (shouldFallbackFromEmptyPrimary) {
        page = await readLegacyFeedPayload();
      }
    } catch (error) {
      if (isBackendPoolPressureError(error)) {
        if (shouldUseCachedFirstPageFallback && fallbackFirstPage) {
          return fallbackFirstPage;
        }
        if (tab === "hot-alpha" || tab === "early-runners" || tab === "high-conviction") {
          try {
            return await readLegacyFeedPayload();
          } catch {
            return {
              items: [],
              nextCursor: null,
              hasMore: false,
              totalPosts: null,
            };
          }
        }
        throw error;
      }
      try {
        page = await readLegacyFeedPayload();
      } catch {
        if (shouldUseCachedFirstPageFallback && fallbackFirstPage) {
          return fallbackFirstPage;
        }
        throw error;
      }
    }

    const items = page.items;
    const nextCursor = page.nextCursor;
    const totalPosts = page.totalPosts;
    const currentVisiblePostsById = new Map<string, Post>();
    const currentRealtimeMergeSource = hasCurrentFirstPage ? currentQueryFirstPage : null;
    for (const item of currentRealtimeMergeSource?.items ?? []) {
      currentVisiblePostsById.set(item.id, item);
    }

    const cachedRealtimePostsById = new Map<string, Post>();
    const rememberReusableCachedPost = (candidate: Post) => {
      const existing = cachedRealtimePostsById.get(candidate.id);
      if (!existing) {
        cachedRealtimePostsById.set(candidate.id, candidate);
        return;
      }

      const existingMarketStateVersion = getFeedMarketStateVersion(existing);
      const candidateMarketStateVersion = getFeedMarketStateVersion(candidate);
      if (candidateMarketStateVersion > existingMarketStateVersion) {
        cachedRealtimePostsById.set(candidate.id, candidate);
        return;
      }

      if (
        candidateMarketStateVersion === existingMarketStateVersion &&
        getFeedPostIntelligenceRichness(candidate) > getFeedPostIntelligenceRichness(existing)
      ) {
        cachedRealtimePostsById.set(candidate.id, candidate);
      }
    };

    const cachedFeedQueries = queryClient.getQueriesData<InfiniteData<FeedPage>>({
      queryKey: ["posts", feedViewerScope],
    });
    for (const [, cachedFeedData] of cachedFeedQueries) {
      for (const cachedPage of cachedFeedData?.pages ?? []) {
        for (const cachedItem of cachedPage.items ?? []) {
          rememberReusableCachedPost(cachedItem);
        }
      }
    }

    const canUseSessionRealtimeMerge =
      !pageParam &&
      !hasCurrentFirstPage &&
      shouldMergeSessionCachedRealtimeState(tab, search);
    if (canUseSessionRealtimeMerge && liveCachedFirstPage?.items?.length) {
      for (const item of liveCachedFirstPage.items) {
        rememberReusableCachedPost(item);
      }
    }
    const mergedItems = items.map((item) => {
      const mergedWithCurrentView = mergePostWithCachedRealtimeState(
        item,
        currentVisiblePostsById.get(item.id),
        { preserveEngagementState: true }
      );

      if (shouldBypassCachedRealtimeMerge(item, tab, search)) {
        return mergedWithCurrentView;
      }

      return mergePostWithCachedRealtimeState(
        mergedWithCurrentView,
        cachedRealtimePostsById.get(item.id)
      );
    });

    if (shouldUseCachedFirstPageFallback && fallbackFirstPage && mergedItems.length === 0) {
      return fallbackFirstPage;
    }

    return {
      items: mergedItems,
      nextCursor,
      hasMore: Boolean(page.hasMore && nextCursor),
      totalPosts,
    } satisfies FeedPage;
  }, [feedViewerScope, getFeedQueryKey, queryClient]);

  // Update URL when search changes
  const handleSearchChange = useCallback((value: string) => {
    setSearchQuery(value);
    if (value) {
      setSearchParams({ search: value });
    } else {
      setSearchParams({});
    }
  }, [setSearchParams]);

  // Fetch current user with React Query
  const {
    data: user,
    isLoading: isLoadingUser,
    error: userError,
    refetch: refetchUser,
    isFetched: isUserFetched,
  } = useQuery({
    queryKey: ["currentUser", session?.user?.id ?? "anonymous"],
    queryFn: async () => {
      try {
        return await api.get<User>("/api/me");
      } catch (error) {
        if (sessionBackedUser) {
          if (!(error instanceof ApiError)) {
            return sessionBackedUser;
          }
          if (error.status !== 401 && error.status !== 403) {
            return sessionBackedUser;
          }
        }
        throw error;
      }
    },
    initialData: sessionBackedUser ?? undefined,
    enabled: hasLiveSession,
    gcTime: 15 * 60 * 1000,
    retry: (failureCount, error) => {
      if (error instanceof ApiError && (error.status === 401 || error.status === 403 || error.status === 429)) {
        return false;
      }
      return failureCount < 2;
    },
    staleTime: 5 * 60 * 1000,
    refetchInterval: false,
    refetchOnMount: sessionBackedUser || cachedFeedUser ? false : true,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

  useEffect(() => {
    if (!isUserFetched || !user || !feedCurrentUserCacheKey) return;
    writeSessionCache(feedCurrentUserCacheKey, user);
  }, [feedCurrentUserCacheKey, isUserFetched, user]);

  // Fetch posts with React Query
  const {
    data: postsPages,
    isLoading: isLoadingPosts,
    isFetched: isPostsFetched,
    error: postsError,
    refetch: refetchPosts,
    isFetching,
    isFetchingNextPage,
    dataUpdatedAt: postsDataUpdatedAt,
    fetchNextPage,
    hasNextPage,
  } = useInfiniteQuery({
    queryKey: activeFeedQueryKey,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => fetchFeedPage(activeTab, effectiveSearchQuery, pageParam),
    getNextPageParam: (lastPage) => (lastPage.hasMore ? (lastPage.nextCursor ?? undefined) : undefined),
    maxPages: FEED_MAX_PAGES,
    initialData: hydrationCachedFirstPage
      ? {
          pages: [hydrationCachedFirstPage],
          pageParams: [undefined],
        }
      : undefined,
    initialDataUpdatedAt: hydrationCachedFirstPageEntry?.cachedAt,
    enabled: activeTab !== "following" || hasLiveSession,
    retry: (failureCount, error) => {
      if (error instanceof ApiError && (error.status === 429 || error.status === 503)) {
        return false;
      }
      if (isBackendPoolPressureError(error)) {
        return false;
      }
      return failureCount < 2;
    },
    gcTime: FEED_QUERY_GC_TIME_MS,
    staleTime: 60_000, // 1 minute; reduces tab-switch reloads
    refetchOnMount: "always",
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    refetchInterval: false,
  });

  const hasInitialFeedResult = isPostsFetched || Boolean(postsError);

  useEffect(() => {
    if (feedUnreadQueryReady || !hasInitialFeedResult) return;
    const timer = window.setTimeout(() => {
      setFeedUnreadQueryReady(true);
    }, FEED_UNREAD_QUERY_STARTUP_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [feedUnreadQueryReady, hasInitialFeedResult]);

  useEffect(() => {
    if (feedAnnouncementsReady || !hasInitialFeedResult) return;
    const timer = window.setTimeout(() => {
      setFeedAnnouncementsReady(true);
    }, FEED_ANNOUNCEMENTS_QUERY_STARTUP_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [feedAnnouncementsReady, hasInitialFeedResult]);

  useEffect(() => {
    if (feedTrendingReady || !hasInitialFeedResult) return;
    const timer = window.setTimeout(() => {
      setFeedTrendingReady(true);
    }, FEED_TRENDING_QUERY_STARTUP_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [feedTrendingReady, hasInitialFeedResult]);

  useEffect(() => {
    if (feedBackgroundRefreshReady || !hasInitialFeedResult) return;
    const timer = window.setTimeout(() => {
      setFeedBackgroundRefreshReady(true);
    }, FEED_BACKGROUND_REFRESH_STARTUP_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [feedBackgroundRefreshReady, hasInitialFeedResult]);

  useEffect(() => {
    if (feedRealtimeEnrichmentReady || !hasInitialFeedResult) return;
    const timer = window.setTimeout(() => {
      setFeedRealtimeEnrichmentReady(true);
    }, FEED_REALTIME_ENRICHMENT_STARTUP_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [feedRealtimeEnrichmentReady, hasInitialFeedResult]);

  const posts = useMemo(() => {
    const mergedPosts = postsPages?.pages.flatMap((page) => page.items) ?? [];
    if (activeTab === "hot-alpha" || activeTab === "early-runners" || activeTab === "high-conviction") {
      return mergedPosts;
    }
    return sortPostsNewestFirst(mergedPosts);
  }, [activeTab, postsPages?.pages]);
  useEffect(() => {
    if (!posts.length) return;
    syncPostsIntoQueryCache(queryClient, posts);
  }, [posts, queryClient]);
  const hasLiveOverlay = useCallback(
    () => isOverlayOpen || hasActiveTradeDialogMarker(),
    [isOverlayOpen]
  );
  const shouldFreezeFeedItems = isOverlayOpen || hasActiveTradeDialogMarker();
  useEffect(() => {
    if (shouldFreezeFeedItems) {
      setFrozenPostsWhileOverlayOpen((prev) => prev ?? posts);
      return;
    }
    setFrozenPostsWhileOverlayOpen(null);
  }, [posts, shouldFreezeFeedItems]);
  const displayedPosts = frozenPostsWhileOverlayOpen ?? posts;
  const shouldShowFollowingSessionRecovery = activeTab === "following" && isUsingCachedUser;
  const shouldShowFollowingAuthState =
    activeTab === "following" && !hasLiveSession && !shouldShowFollowingSessionRecovery;
  const hasPosts = displayedPosts.length > 0;
  const shouldShowFeedFatalError = Boolean(
    postsError &&
    !hasPosts &&
    !shouldShowFollowingAuthState &&
    !shouldShowFollowingSessionRecovery
  );
  const shouldShowFeedSoftError = Boolean(postsError && hasPosts);
  const isRefreshing = isManualRefreshing || (isFetching && !isFetchingNextPage);

  useEffect(() => {
    const firstPage = postsPages?.pages?.[0];
    if (!firstPage) return;
    if (postsDataUpdatedAt <= 0) return;
    if (
      hydrationCachedFirstPageEntry?.cachedAt &&
      postsDataUpdatedAt <= hydrationCachedFirstPageEntry.cachedAt
    ) {
      return;
    }
    writeCachedFirstFeedPageForScopes(feedViewerScope, activeTab, effectiveSearchQuery, firstPage);
  }, [
    activeTab,
    effectiveSearchQuery,
    feedViewerScope,
    hydrationCachedFirstPageEntry?.cachedAt,
    postsDataUpdatedAt,
    postsPages?.pages,
  ]);

  const updateInfinitePosts = useCallback((updater: (post: Post) => Post) => {
    const updatedData = queryClient.setQueryData<InfiniteData<FeedPage>>(
      activeFeedQueryKey,
      (oldData) => {
        if (!oldData) return oldData;
        return {
          ...oldData,
          pages: oldData.pages.map((page) => ({
            ...page,
            items: page.items.map(updater),
          })),
        };
      }
    );
    const nextFirstPage = updatedData?.pages?.[0];
    if (nextFirstPage?.items.length) {
      writeCachedFirstFeedPageForScopes(
        feedViewerScope,
        activeTab,
        effectiveSearchQuery,
        nextFirstPage
      );
    }
  }, [activeFeedQueryKey, activeTab, effectiveSearchQuery, feedViewerScope, queryClient]);

  const applyFirstPageToCache = useCallback(
    (tab: FeedTab, search: string, nextFirstPage: FeedPage) => {
      queryClient.setQueryData<InfiniteData<FeedPage>>(
        getFeedQueryKey(tab, search, feedViewerScope),
        (oldData) => {
          if (!oldData || oldData.pages.length === 0) {
            return {
              pages: [nextFirstPage],
              pageParams: [undefined],
            };
          }

          const preserveDisplacedItems = hasLiveOverlay();
          if (preserveDisplacedItems) {
            return oldData;
          }
          const nextIds = new Set(nextFirstPage.items.map((item) => item.id));
          const [previousFirstPage, ...restPages] = oldData.pages;
          const carryOverItems = (previousFirstPage?.items ?? []).filter(
            (item) => !nextIds.has(item.id)
          );

          const nextPages: FeedPage[] = [nextFirstPage];
          const globalSeenIds = new Set(nextFirstPage.items.map((item) => item.id));

          const restWithCarry: FeedPage[] = [];
          if (carryOverItems.length > 0) {
            restWithCarry.push({
              hasMore: true,
              nextCursor: nextFirstPage.nextCursor ?? null,
              items: carryOverItems,
              totalPosts: nextFirstPage.totalPosts,
            });
          }
          restWithCarry.push(...restPages);

          for (const page of restWithCarry) {
            const dedupedItems = page.items.filter((item) => {
              if (nextIds.has(item.id)) return false;
              if (globalSeenIds.has(item.id)) return false;
              globalSeenIds.add(item.id);
              return true;
            });
            if (dedupedItems.length === 0) continue;
            nextPages.push({
              ...page,
              items: dedupedItems,
            });
          }

          return {
            ...oldData,
            pages: nextPages,
          };
        }
      );
    },
    [feedViewerScope, getFeedQueryKey, hasLiveOverlay, queryClient]
  );

  const applyPendingLatestPosts = useCallback(() => {
    if (!pendingLatestFirstPage) return;
    applyFirstPageToCache("latest", "", pendingLatestFirstPage);
    writeCachedFirstFeedPageForScopes(feedViewerScope, "latest", "", pendingLatestFirstPage);
    persistLatestAcknowledgedTopId(pendingLatestFirstPage.items[0]?.id ?? null);
    clearPendingLatestState();
  }, [
    applyFirstPageToCache,
    clearPendingLatestState,
    feedViewerScope,
    pendingLatestFirstPage,
    persistLatestAcknowledgedTopId,
  ]);

  const visibleLatestTopId =
    activeTab === "latest" && !effectiveSearchQuery
      ? postsPages?.pages?.[0]?.items?.[0]?.id ?? null
      : null;

  useEffect(() => {
    if (!visibleLatestTopId) return;
    if (typeof window === "undefined") return;
    if (hasLiveOverlay()) return;
    if (window.scrollY >= FEED_AUTO_APPLY_NEW_POSTS_TOP_THRESHOLD_PX) return;

    persistLatestAcknowledgedTopId(visibleLatestTopId);
    if (pendingLatestFirstPage?.items?.[0]?.id === visibleLatestTopId) {
      clearPendingLatestState();
    }
  }, [
    clearPendingLatestState,
    hasLiveOverlay,
    pendingLatestFirstPage?.items,
    persistLatestAcknowledgedTopId,
    visibleLatestTopId,
  ]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const onScroll = () => {
      if (window.scrollY > 120) {
        setHasUserScrolledForAutoLoad(true);
      }
    };

    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    if (!FEED_TAB_PREFETCH_ENABLED) return;
    if (activeTab !== "latest") return;
    if (searchQuery.trim().length >= 3) return;
    if (!postsPages?.pages?.length) return;

    let cancelled = false;
    const tabsToPrefetch: FeedTab[] = hasLiveSession
      ? ["hot-alpha", "early-runners", "high-conviction", "following"]
      : ["hot-alpha", "early-runners", "high-conviction"];
    let staggerTimer: number | null = null;

    const prefetchNextTab = (index: number) => {
      if (cancelled || index >= tabsToPrefetch.length) {
        return;
      }

      const tab = tabsToPrefetch[index];
      if (!tab) {
        return;
      }

      const key = getFeedQueryKey(tab, "", feedViewerScope);
      const state = queryClient.getQueryState(key);
      if (!(state?.status === "success" && Date.now() - state.dataUpdatedAt < 45_000)) {
        void queryClient.prefetchInfiniteQuery({
          queryKey: key,
          initialPageParam: undefined as string | undefined,
          queryFn: ({ pageParam }) => fetchFeedPage(tab, "", pageParam),
          getNextPageParam: (lastPage) => (lastPage.hasMore ? (lastPage.nextCursor ?? undefined) : undefined),
          staleTime: 60_000,
        });
      }

      staggerTimer = window.setTimeout(() => {
        prefetchNextTab(index + 1);
      }, FEED_TAB_PREFETCH_GAP_MS);
    };

    let idleHandle: number | null = null;
    const timer = window.setTimeout(() => {
      if ("requestIdleCallback" in window) {
        idleHandle = window.requestIdleCallback(() => {
          prefetchNextTab(0);
        }, { timeout: 1500 });
        return;
      }

      prefetchNextTab(0);
    }, FEED_TAB_PREFETCH_INITIAL_DELAY_MS);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      if (staggerTimer !== null) {
        window.clearTimeout(staggerTimer);
      }
      if (idleHandle !== null && "cancelIdleCallback" in window) {
        window.cancelIdleCallback(idleHandle);
      }
    };
  }, [
    activeTab,
    feedViewerScope,
    fetchFeedPage,
    getFeedQueryKey,
    postsPages?.pages?.length,
    queryClient,
    searchQuery,
    hasLiveSession,
  ]);

  useEffect(() => {
    if (!hasNextPage || isFetchingNextPage) return;
    if (typeof window === "undefined" || typeof IntersectionObserver === "undefined") return;
    if (!hasUserScrolledForAutoLoad) return;
    const node = loadMoreRef.current;
    if (!node) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (entry?.isIntersecting) {
          void fetchNextPage();
        }
      },
      {
        root: null,
        rootMargin: "100px 0px",
        threshold: 0,
      }
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, [fetchNextPage, hasNextPage, hasUserScrolledForAutoLoad, isFetchingNextPage]);

  // X-style lightweight new-post detection on Latest:
  // poll only the first page every 30s, then show a "new posts" button (or auto-apply near top).
  useEffect(() => {
    if (!feedBackgroundRefreshReady) return;
    if (activeTab !== "latest") return;
    if (effectiveSearchQuery) return;
    if (hasLiveOverlay()) return;
    if (typeof window === "undefined") return;

    let cancelled = false;
    let inFlight = false;

    const checkForNewPosts = async () => {
      if (cancelled || inFlight) return;
      if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
      if (typeof navigator !== "undefined" && navigator.onLine === false) return;
      if (hasLiveOverlay()) return;

      const currentData = queryClient.getQueryData<InfiniteData<FeedPage>>(
        getFeedQueryKey("latest", "", feedViewerScope)
      );
      const currentFirstPage =
        currentData?.pages?.[0] ??
        readPreferredCachedFirstFeedPage(feedViewerScope, "latest", "") ??
        null;
      const baselineTopId = latestAcknowledgedTopIdRef.current ?? currentFirstPage?.items[0]?.id ?? null;
      if (!currentFirstPage && !baselineTopId) return;

      inFlight = true;
      try {
        const freshFirstPage = await fetchFeedPage("latest", "");
        if (cancelled || freshFirstPage.items.length === 0) return;
        if (hasLiveOverlay()) return;

        const freshTopId = freshFirstPage.items[0]?.id;

        if (!freshTopId) {
          return;
        }

        if (!baselineTopId) {
          if (window.scrollY < FEED_AUTO_APPLY_NEW_POSTS_TOP_THRESHOLD_PX) {
            applyFirstPageToCache("latest", "", freshFirstPage);
            writeCachedFirstFeedPageForScopes(feedViewerScope, "latest", "", freshFirstPage);
            persistLatestAcknowledgedTopId(freshTopId);
            clearPendingLatestState();
            return;
          }

          setPendingLatestState(freshFirstPage, freshFirstPage.items.length);
          return;
        }

        if (baselineTopId === freshTopId) {
          const currentFingerprint = buildRealtimePageFingerprint(currentFirstPage ?? freshFirstPage);
          const freshFingerprint = buildRealtimePageFingerprint(freshFirstPage);

          if (currentFingerprint !== freshFingerprint) {
            applyFirstPageToCache("latest", "", freshFirstPage);
            writeCachedFirstFeedPageForScopes(feedViewerScope, "latest", "", freshFirstPage);
            if (window.scrollY < FEED_AUTO_APPLY_NEW_POSTS_TOP_THRESHOLD_PX) {
              persistLatestAcknowledgedTopId(freshTopId);
            }
            clearPendingLatestState();
            void refetchUser();
            return;
          }

          clearPendingLatestState();
          return;
        }

        let newCount = 0;
        for (const item of freshFirstPage.items) {
          if (item.id === baselineTopId) break;
          newCount++;
        }
        if (newCount <= 0) {
          newCount = freshFirstPage.items.length;
        }

        // If user is near the top, apply instantly for a seamless "live" feel.
        if (window.scrollY < FEED_AUTO_APPLY_NEW_POSTS_TOP_THRESHOLD_PX) {
          applyFirstPageToCache("latest", "", freshFirstPage);
          writeCachedFirstFeedPageForScopes(feedViewerScope, "latest", "", freshFirstPage);
          persistLatestAcknowledgedTopId(freshTopId);
          clearPendingLatestState();
          return;
        }

        setPendingLatestState(freshFirstPage, newCount);
      } catch {
        // Silent failure; polling should never break feed UX.
      } finally {
        inFlight = false;
      }
    };

    const intervalId = window.setInterval(() => {
      void checkForNewPosts();
    }, FEED_NEW_POSTS_POLL_MS);

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void checkForNewPosts();
      }
    };

    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [
    activeTab,
    applyFirstPageToCache,
    clearPendingLatestState,
    effectiveSearchQuery,
    feedViewerScope,
    fetchFeedPage,
    getFeedQueryKey,
    hasLiveOverlay,
    persistLatestAcknowledgedTopId,
    queryClient,
    refetchUser,
    setPendingLatestState,
    feedBackgroundRefreshReady,
  ]);

  // Keep non-latest tabs (and searched latest) fresh with lightweight first-page sync.
  // This stays visibility-aware and online-aware to reduce unnecessary traffic.
  useEffect(() => {
    if (!feedBackgroundRefreshReady) return;
    if (!hasLiveSession) return;
    if (activeTab === "latest" && !effectiveSearchQuery) return;
    if (hasLiveOverlay()) return;
    if (typeof window === "undefined") return;

    let cancelled = false;
    let inFlight = false;

    const refreshActiveTabFirstPage = async () => {
      if (cancelled || inFlight) return;
      if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
      if (typeof navigator !== "undefined" && navigator.onLine === false) return;
      if (hasLiveOverlay()) return;

      const currentData = queryClient.getQueryData<InfiniteData<FeedPage>>(
        getFeedQueryKey(activeTab, effectiveSearchQuery, feedViewerScope)
      );
      const currentFirstPage = currentData?.pages?.[0];
      if (!currentFirstPage || currentFirstPage.items.length === 0) return;

      inFlight = true;
      try {
        const freshFirstPage = await fetchFeedPage(activeTab, effectiveSearchQuery);
        if (cancelled || freshFirstPage.items.length === 0) return;
        if (hasLiveOverlay()) return;

        const currentTopId = currentFirstPage.items[0]?.id;
        const freshTopId = freshFirstPage.items[0]?.id;
        if (!currentTopId || !freshTopId) return;

        if (currentTopId === freshTopId) {
          const currentFingerprint = buildRealtimePageFingerprint(currentFirstPage);
          const freshFingerprint = buildRealtimePageFingerprint(freshFirstPage);
          if (currentFingerprint === freshFingerprint) {
            return;
          }
        }

        applyFirstPageToCache(activeTab, effectiveSearchQuery, freshFirstPage);
        writeCachedFirstFeedPageForScopes(
          feedViewerScope,
          activeTab,
          effectiveSearchQuery,
          freshFirstPage
        );
      } catch {
        // Keep current feed visible; next interval will retry.
      } finally {
        inFlight = false;
      }
    };

    const intervalId = window.setInterval(() => {
      void refreshActiveTabFirstPage();
    }, FEED_ACTIVE_TAB_POLL_MS);

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void refreshActiveTabFirstPage();
      }
    };

    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [
    activeTab,
    applyFirstPageToCache,
    effectiveSearchQuery,
    feedViewerScope,
    fetchFeedPage,
    getFeedQueryKey,
    hasLiveOverlay,
    queryClient,
    hasLiveSession,
    feedBackgroundRefreshReady,
  ]);

  // Create post mutation
  const createPostMutation = useMutation({
    mutationFn: async (content: string) => {
      const newPost = await api.post<Post>("/api/posts", { content });
      return newPost;
    },
    onSuccess: (newPost) => {
      const prependPostToFeed = (tab: FeedTab, search: string) => {
        const queryKey = getFeedQueryKey(tab, search, feedViewerScope);
        const updatedData = queryClient.setQueryData<InfiniteData<FeedPage>>(queryKey, (oldData) => {
          if (!oldData || oldData.pages.length === 0) {
            return oldData;
          }
          const [firstPage, ...restPages] = oldData.pages;
          if (!firstPage) return oldData;

          const dedupedItems = firstPage.items.filter((item) => item.id !== newPost.id);
          const nextFirstPage: FeedPage = {
            ...firstPage,
            items: [newPost, ...dedupedItems],
          };

          return {
            ...oldData,
            pages: [nextFirstPage, ...restPages],
          };
        });

        const nextFirstPage = updatedData?.pages?.[0];
        if (nextFirstPage && nextFirstPage.items.length > 0) {
          writeCachedFirstFeedPageForScopes(feedViewerScope, tab, search, nextFirstPage);
        }
      };

      prependPostToFeed(activeTab, effectiveSearchQuery);
      if (activeTab !== "latest" || effectiveSearchQuery) {
        prependPostToFeed("latest", "");
      }
      toast.success("Alpha posted!");
      // Refresh user data in case level changed
      refetchUser();
    },
    onError: (error) => {
      if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
        handleWriteSessionExpired();
        return;
      }
      const message = error instanceof ApiError ? error.message : "Failed to post";
      toast.error(message);
    },
  });

  // Like mutation
  const likeMutation = useMutation({
    mutationFn: async ({ postId, isLiked }: { postId: string; isLiked: boolean }) => {
      if (isLiked) {
        await api.delete(`/api/posts/${postId}/like`);
      } else {
        await api.post(`/api/posts/${postId}/like`);
      }
      return { postId, isLiked };
    },
    onSuccess: ({ postId, isLiked }) => {
      updateInfinitePosts((post) =>
        post.id === postId
          ? {
              ...post,
              isLiked: !isLiked,
              _count: {
                ...post._count,
                likes: post._count.likes + (isLiked ? -1 : 1),
              },
            }
          : post
      );
    },
    onError: (error) => {
      if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
        handleWriteSessionExpired();
      }
    },
  });

  // Repost mutation
  const repostMutation = useMutation({
    mutationFn: async ({ postId, isReposted }: { postId: string; isReposted: boolean }) => {
      if (isReposted) {
        await api.delete(`/api/posts/${postId}/repost`);
      } else {
        await api.post(`/api/posts/${postId}/repost`);
      }
      return { postId, isReposted };
    },
    onSuccess: ({ postId, isReposted }) => {
      updateInfinitePosts((post) =>
        post.id === postId
          ? {
              ...post,
              isReposted: !isReposted,
              _count: {
                ...post._count,
                reposts: post._count.reposts + (isReposted ? -1 : 1),
              },
            }
          : post
      );
    },
    onError: (error) => {
      if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
        handleWriteSessionExpired();
      }
    },
  });

  // Comment mutation
  const commentMutation = useMutation({
    mutationFn: async ({ postId, content }: { postId: string; content: string }) => {
      await api.post(`/api/posts/${postId}/comments`, { content });
      return { postId };
    },
    onSuccess: ({ postId }) => {
      toast.success("Comment added!");
      // Update comment count
      updateInfinitePosts((post) =>
        post.id === postId
          ? {
              ...post,
              _count: {
                ...post._count,
                comments: post._count.comments + 1,
              },
            }
          : post
      );
    },
    onError: (error) => {
      if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
        handleWriteSessionExpired();
        return;
      }
      toast.error("Failed to add comment");
    },
  });

  // Handlers
  const handleCreatePost = async (content: string) => {
    if (guardPendingAuthWrite()) {
      return;
    }
    await createPostMutation.mutateAsync(content);
  };

  const handleLike = async (postId: string) => {
    if (guardPendingAuthWrite()) {
      return;
    }
    const post = displayedPosts.find((p) => p.id === postId);
    if (post) {
      likeMutation.mutate({ postId, isLiked: post.isLiked });
    }
  };

  const handleRepost = async (postId: string) => {
    if (guardPendingAuthWrite()) {
      return;
    }
    const post = displayedPosts.find((p) => p.id === postId);
    if (post) {
      repostMutation.mutate({ postId, isReposted: post.isReposted });
    }
  };

  const handleComment = async (postId: string, content: string) => {
    if (guardPendingAuthWrite()) {
      return;
    }
    await commentMutation.mutateAsync({ postId, content });
  };

  const handleTabChange = (tab: FeedTab) => {
    setActiveTab(tab);
  };

  const handleRefresh = () => {
    void (async () => {
      if (activeTab === "latest" && !effectiveSearchQuery && pendingLatestFirstPage) {
        applyPendingLatestPosts();
        return;
      }

      setIsManualRefreshing(true);
      try {
        const freshFirstPage = await fetchFeedPage(activeTab, effectiveSearchQuery);
        applyFirstPageToCache(activeTab, effectiveSearchQuery, freshFirstPage);
        writeCachedFirstFeedPageForScopes(
          feedViewerScope,
          activeTab,
          effectiveSearchQuery,
          freshFirstPage
        );
        if (activeTab === "latest" && !effectiveSearchQuery) {
          persistLatestAcknowledgedTopId(freshFirstPage.items[0]?.id ?? null);
          clearPendingLatestState();
        }
      } catch {
        // Fallback to react-query refetch if manual refresh fails
        queryClient.setQueryData<InfiniteData<FeedPage>>(
          activeFeedQueryKey,
          (oldData) => {
            if (!oldData) return oldData;
            return {
              ...oldData,
              pages: oldData.pages.slice(0, 1),
              pageParams: oldData.pageParams.slice(0, 1),
            };
          }
        );
        await refetchPosts();
      } finally {
        setIsManualRefreshing(false);
      }
    })();
  };

  const autoLoadEnabled = Boolean(hasNextPage && hasUserScrolledForAutoLoad);
  const showLoadMoreControls = Boolean(hasNextPage);
  const { data: discoverySidebar } = useQuery({
    queryKey: ["discovery", "feed-sidebar"],
    queryFn: () => api.get<DiscoveryFeedSidebarResponse>("/api/discovery/feed-sidebar"),
    enabled: feedTrendingReady,
    staleTime: 45_000,
    refetchOnWindowFocus: false,
    refetchInterval: 90_000,
  });
  const sidebarTopGainers = discoverySidebar?.topGainers ?? [];
  const sidebarLiveRaid = discoverySidebar?.liveRaids?.[0] ?? null;
  const sidebarTrendingCalls = discoverySidebar?.trendingCalls ?? [];
  const sidebarTrendingCommunities = discoverySidebar?.trendingCommunities ?? [];
  const sidebarAiSpotlight = discoverySidebar?.aiSpotlight ?? null;

  return (
    <div className="space-y-4">
      <main className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-4">
          <section className="relative overflow-hidden rounded-[32px] border border-white/8 bg-[radial-gradient(circle_at_top_left,rgba(169,255,52,0.14),transparent_28%),radial-gradient(circle_at_top_right,rgba(45,212,191,0.12),transparent_24%),linear-gradient(180deg,rgba(8,12,18,0.97),rgba(3,7,10,0.99))] px-5 py-5 shadow-[0_34px_80px_-44px_rgba(15,20,28,0.9)] sm:px-6">
            <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <V2StatusPill tone="live">{activeTab === "latest" ? "Live discovery" : activeTab.replace("-", " ")}</V2StatusPill>
                  <span className="text-[11px] font-semibold uppercase tracking-[0.2em] text-white/34">Signal network</span>
                </div>
                <div>
                  <h1 className="text-3xl font-semibold tracking-tight text-white sm:text-[2.55rem]">Run the feed.</h1>
                  <p className="mt-1 max-w-2xl text-sm leading-6 text-white/56">
                    Auto-tracked calls, AI conviction, live raid pressure, and trader reputation in one discovery surface.
                  </p>
                </div>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={handleRefresh}
                disabled={isManualRefreshing}
                className="h-10 rounded-full border border-white/10 bg-white/[0.04] px-4 text-white/72 hover:bg-white/[0.08] hover:text-white"
              >
                <RefreshCw className={cn("mr-2 h-4 w-4", isManualRefreshing && "animate-spin")} />
                Refresh feed
              </Button>
            </div>

            <div className="mt-5">
              <SearchBar
                value={searchQuery}
                onChange={handleSearchChange}
                isLoading={isRefreshing && searchQuery.length >= 3}
              />
            </div>

            <div className="mt-4 rounded-[26px] border border-white/8 bg-[linear-gradient(180deg,rgba(8,12,18,0.92),rgba(6,10,15,0.96))] p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
              <FeedHeader
                user={user ?? null}
                activeTab={activeTab}
                onTabChange={handleTabChange}
                onLogout={handleSignOut}
                enableUnreadCountQuery={feedUnreadQueryReady}
                compact
              />
            </div>
          </section>

          <section className="space-y-3">
            <QueryErrorBoundary sectionName="Announcements">
              <AnnouncementBanner enabled={feedAnnouncementsReady} />
            </QueryErrorBoundary>
          </section>

          <div className="grid gap-4 xl:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]">
          {isLoadingUser ? (
            <ProfileCardSkeleton className="mb-0" />
          ) : user ? (
            <section className="overflow-hidden rounded-[28px] border border-white/8 bg-[radial-gradient(circle_at_top_left,rgba(169,255,52,0.12),transparent_28%),linear-gradient(180deg,rgba(9,13,20,0.96),rgba(6,10,14,0.98))] p-5 shadow-[0_30px_70px_-46px_rgba(45,212,191,0.5)]">
              <div className="flex items-start gap-4">
                <Avatar className="h-16 w-16 border border-lime-300/20 shadow-[0_0_24px_rgba(169,255,52,0.2)]">
                  <AvatarImage src={getAvatarUrl(user.id, user.image)} />
                  <AvatarFallback className="bg-white/[0.04] text-lg text-white">
                    {user.name?.charAt(0) || "?"}
                  </AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="truncate text-lg font-semibold text-white">{user.username || user.name}</h2>
                    <span className="inline-flex items-center gap-1 rounded-full border border-lime-300/18 bg-lime-300/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-lime-200">
                      <PhewTrophyIcon className="h-3 w-3" />
                      Level {user.level ?? 0}
                    </span>
                  </div>
                  <p className="mt-1 truncate text-sm text-white/42">{user.email}</p>
                  <div className="mt-4 flex flex-wrap items-end gap-3">
                    <div>
                      <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-white/34">XP</div>
                      <div className="mt-1 text-2xl font-semibold text-lime-300">{(user.xp ?? 0).toLocaleString()}</div>
                    </div>
                    <div className="rounded-full border border-white/8 bg-white/[0.03] px-3 py-1.5 text-xs text-white/56">
                      Reputation band active
                    </div>
                  </div>
                </div>
              </div>
              <div className="mt-4">
                <LevelBar level={user.level} size="xl" />
              </div>
            </section>
          ) : userError ? (
            <div className="rounded-[24px] border border-destructive/30 bg-destructive/10 p-4">
              <div className="flex items-center gap-3 text-destructive">
                <AlertCircle className="h-5 w-5" />
                <span className="text-sm">Failed to load profile</span>
                <Button variant="ghost" size="sm" onClick={() => refetchUser()} className="ml-auto">
                  Retry
                </Button>
              </div>
            </div>
          ) : null}

          <section className="rounded-[28px] border border-white/8 bg-[linear-gradient(180deg,rgba(9,13,20,0.97),rgba(6,10,14,0.99))] p-4 shadow-[0_26px_60px_-42px_rgba(0,0,0,0.88)]">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-white/34">Post signal</div>
                <div className="mt-1 text-sm text-white/58">Drop a new call, paste a CA, or post a thesis with conviction.</div>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleRefresh}
                disabled={isRefreshing}
                className="h-9 gap-1.5 rounded-full border border-white/10 bg-white/[0.04] px-3 text-white/62 hover:bg-white/[0.08] hover:text-white"
              >
                <RefreshCw className={cn("h-3.5 w-3.5", isRefreshing && "animate-spin")} />
                Live
              </Button>
            </div>
            <CreatePost
              user={user ?? null}
              onSubmit={handleCreatePost}
              isSubmitting={createPostMutation.isPending}
              isAuthPending={isAuthWritePending}
            />
          </section>
          </div>

          <section className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-white/34">
                  {searchQuery.length >= 3 ? `Search mode` : activeTab === "latest" ? "For you" : activeTab.replace("-", " ")}
                </div>
                <div className="mt-1 text-sm text-white/56">
                  {searchQuery.length >= 3 ? `Results for "${searchQuery}"` : "Calls stay visible with conviction, risk, and trade context surfaced up front."}
                </div>
              </div>
              <div className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs text-white/50">
                {displayedPosts.length} visible
              </div>
            </div>

          {activeTab === "latest" && !effectiveSearchQuery && pendingLatestCount > 0 ? (
            <div className="sticky top-[7.25rem] z-20 flex justify-center">
              <Button
                type="button"
                onClick={applyPendingLatestPosts}
                className="h-10 rounded-full border border-primary/25 px-4 shadow-[0_20px_46px_-20px_hsl(var(--primary)/0.45)]"
              >
                {pendingLatestCount > FEED_PAGE_SIZE ? `${FEED_PAGE_SIZE}+` : pendingLatestCount} new alpha{pendingLatestCount === 1 ? "" : "s"} posted - Show
              </Button>
            </div>
          ) : null}

          {shouldShowFeedSoftError ? (
            <div className="app-surface-soft mb-3 border-amber-400/25 bg-amber-400/10 p-3 text-amber-900 dark:text-amber-100">
              <div className="flex items-center gap-2">
                <AlertCircle className="h-4 w-4" />
                <span className="text-xs sm:text-sm">
                  Live refresh is temporarily delayed. Existing posts stay visible.
                </span>
                <Button variant="ghost" size="sm" onClick={() => void refetchPosts()} className="ml-auto h-7 px-2 text-xs">
                  Retry
                </Button>
              </div>
            </div>
          ) : null}

          {isLoadingPosts && !hasPosts ? (
            // Loading Skeletons
            <>
              {[0, 1, 2].map((i) => (
                <PostCardSkeleton
                  key={i}
                  showMarketData={i < 2}
                  className="animate-fade-in-up"
                  style={{ animationDelay: `${i * 0.1}s` }}
                />
              ))}
            </>
          ) : shouldShowFollowingSessionRecovery ? (
            <div className="app-empty-state">
              <div className="flex h-20 w-20 items-center justify-center rounded-full bg-muted">
                <RefreshCw className="h-10 w-10 animate-spin text-muted-foreground" />
              </div>
              <div>
                <p className="font-semibold text-foreground text-lg">Loading Following</p>
                <p className="text-sm text-muted-foreground mt-1">
                  Finalizing your session and loading followed traders.
                </p>
              </div>
            </div>
          ) : shouldShowFollowingAuthState ? (
            <div className="app-empty-state">
              <div className="flex h-20 w-20 items-center justify-center rounded-full bg-muted">
                <Sparkles className="h-10 w-10 text-muted-foreground" />
              </div>
              <div>
                <p className="font-semibold text-foreground text-lg">Sign in to see Following</p>
                <p className="text-sm text-muted-foreground mt-1">
                  Follow traders and their new calls will appear here.
                </p>
              </div>
            </div>
          ) : shouldShowFeedFatalError ? (
            <FeedError
              error={postsError as Error}
              onRetry={() => refetchPosts()}
            />
          ) : displayedPosts.length === 0 ? (
            <div className="app-empty-state">
              <div className="flex h-20 w-20 items-center justify-center rounded-full bg-muted">
                {activeTab === "hot-alpha" ? (
                  <Flame className="h-10 w-10 text-muted-foreground" />
                ) : activeTab === "early-runners" ? (
                  <Radar className="h-10 w-10 text-muted-foreground" />
                ) : activeTab === "high-conviction" ? (
                  <BrainCircuit className="h-10 w-10 text-muted-foreground" />
                ) : (
                  <Sparkles className="h-10 w-10 text-muted-foreground" />
                )}
              </div>
              <div>
                <p className="font-semibold text-foreground text-lg">
                  {searchQuery.length >= 3
                    ? "No results found"
                    : activeTab === "high-conviction"
                    ? "No high conviction calls yet"
                    : activeTab === "early-runners"
                    ? "No early runners yet"
                    : activeTab === "hot-alpha"
                    ? "No hot alpha yet"
                    : activeTab === "following"
                    ? "No posts from people you follow"
                    : "No alpha yet"}
                </p>
                <p className="text-sm text-muted-foreground mt-1">
                  {searchQuery.length >= 3
                    ? `Try a different search term`
                    : activeTab === "high-conviction"
                    ? "Calls with the strongest combined trust, confidence, and token health will show here"
                    : activeTab === "early-runners"
                    ? "AI-detected breakouts will surface here once signals line up"
                    : activeTab === "hot-alpha"
                    ? "Strong signal, engagement, and momentum calls will surface here"
                    : activeTab === "following"
                    ? "Follow some traders to see their calls here"
                    : "Be the first to drop a call!"}
                </p>
              </div>
            </div>
          ) : (
            <>
              <WindowVirtualList
                items={displayedPosts}
                getItemKey={(post) => post.id}
                estimateItemHeight={560}
                overscanPx={1400}
                renderItem={(post, index) => (
                  <div className={index < displayedPosts.length - 1 ? "pb-4" : undefined}>
                    <div
                      className="animate-fade-in-up"
                      style={{ animationDelay: `${Math.min(index, 8) * 0.05}s` }}
                    >
                          <PostCard
                            post={post}
                            currentUserId={user?.id}
                            onLike={handleLike}
                            onRepost={handleRepost}
                            onComment={handleComment}
                            enableRealtimePricePolling={feedRealtimeEnrichmentReady}
                            realtimePriceMode={resolveFeedCardRealtimePriceMode(post)}
                            enableSharedAlphaPreviewPrefetch={feedRealtimeEnrichmentReady}
                          />
                    </div>
                  </div>
                )}
              />

              {showLoadMoreControls ? (
                <div className="pt-2">
                  {autoLoadEnabled ? <div ref={loadMoreRef} className="h-1 w-full" aria-hidden="true" /> : null}

                  <div className="flex flex-col items-center gap-3 py-2">
                    {isFetchingNextPage ? (
                      <>
                        <div className="flex items-center gap-2 text-sm text-muted-foreground">
                          <RefreshCw className="h-4 w-4 animate-spin" />
                          Loading more posts...
                        </div>
                        <PostCardSkeleton showMarketData={false} />
                      </>
                    ) : (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => void fetchNextPage()}
                        className="px-4"
                      >
                        Show more
                      </Button>
                    )}
                  </div>
                </div>
              ) : null}
            </>
          )}
          </section>
        </div>

        <aside className="space-y-4">
          <section className="rounded-[28px] border border-white/8 bg-[linear-gradient(180deg,rgba(8,12,18,0.96),rgba(5,9,13,0.99))] p-4">
            <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-white/34">
              <TrendingUp className="h-3.5 w-3.5 text-lime-300" />
              Top gainers (24h)
            </div>
            <div className="mt-4 space-y-3">
              {sidebarTopGainers.slice(0, 5).map((item) => (
                <button
                  key={item.address}
                  type="button"
                  onClick={() => navigate(`/token/${item.address}`)}
                  className="flex w-full items-center justify-between rounded-[18px] border border-white/8 bg-white/[0.03] px-3 py-3 text-left transition hover:bg-white/[0.06]"
                >
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold text-white">{item.symbol || item.name || item.address.slice(0, 6)}</div>
                    <div className="mt-0.5 truncate text-xs text-white/42">{item.name || item.address}</div>
                  </div>
                  <div className="text-sm font-semibold text-emerald-300">
                    {typeof item.change24hPct === "number" ? `${item.change24hPct >= 0 ? "+" : ""}${item.change24hPct.toFixed(2)}%` : "—"}
                  </div>
                </button>
              ))}
            </div>
          </section>

          <section className="rounded-[28px] border border-lime-300/12 bg-[radial-gradient(circle_at_top_right,rgba(169,255,52,0.12),transparent_30%),linear-gradient(180deg,rgba(10,15,14,0.96),rgba(7,10,13,0.98))] p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-white/34">X raids live</div>
                <div className="mt-1 text-sm font-semibold text-white">{sidebarLiveRaid?.title || "No active raid pulse"}</div>
              </div>
              <V2StatusPill tone="live">{sidebarLiveRaid ? "Live" : "Idle"}</V2StatusPill>
            </div>
            {sidebarLiveRaid ? (
              <>
                <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                  <div className="rounded-[18px] border border-white/8 bg-white/[0.04] px-3 py-3">
                    <div className="text-[10px] uppercase tracking-[0.16em] text-white/34">Participants</div>
                    <div className="mt-1 text-lg font-semibold text-white">{sidebarLiveRaid.participantCount.toLocaleString()}</div>
                  </div>
                  <div className="rounded-[18px] border border-white/8 bg-white/[0.04] px-3 py-3">
                    <div className="text-[10px] uppercase tracking-[0.16em] text-white/34">Pool</div>
                    <div className="mt-1 text-lg font-semibold text-white">{sidebarLiveRaid.poolAmount ? sidebarLiveRaid.poolAmount.toLocaleString() : "—"}</div>
                  </div>
                </div>
                <Button
                  type="button"
                  onClick={() => navigate(`/raids/${sidebarLiveRaid.tokenAddress}/${sidebarLiveRaid.id}`)}
                  className="mt-4 h-11 w-full rounded-full border border-lime-300/30 bg-[linear-gradient(135deg,rgba(169,255,52,0.96),rgba(45,212,191,0.88))] text-sm font-semibold text-slate-950"
                >
                  Join raid
                </Button>
              </>
            ) : (
              <p className="mt-3 text-sm text-white/48">A live coordinated campaign will surface here as soon as one opens.</p>
            )}
          </section>

          <section className="rounded-[28px] border border-white/8 bg-[linear-gradient(180deg,rgba(8,12,18,0.96),rgba(5,9,13,0.99))] p-4">
            <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-white/34">
              <Zap className="h-3.5 w-3.5 text-cyan-300" />
              Trending calls
            </div>
            <div className="mt-4 space-y-3">
              {sidebarTrendingCalls.slice(0, 4).map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => navigate(`/post/${item.id}`)}
                  className="flex w-full items-center justify-between rounded-[18px] border border-white/8 bg-white/[0.03] px-3 py-3 text-left transition hover:bg-white/[0.06]"
                >
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold text-white">{item.title}</div>
                    <div className="mt-0.5 truncate text-xs text-white/42">@{item.authorHandle || "trader"} • {item.direction || "call"}</div>
                  </div>
                  <ArrowUpRight className="h-4 w-4 text-white/34" />
                </button>
              ))}
            </div>
          </section>

          {sidebarAiSpotlight ? (
            <section className="rounded-[28px] border border-lime-300/12 bg-[radial-gradient(circle_at_top_left,rgba(169,255,52,0.12),transparent_30%),linear-gradient(180deg,rgba(11,16,13,0.96),rgba(7,10,12,0.99))] p-4">
              <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-white/34">
                <BrainCircuit className="h-3.5 w-3.5 text-lime-200" />
                AI watchlist
              </div>
              <div className="mt-3 rounded-[22px] border border-lime-300/14 bg-lime-300/8 p-4">
                <div className="text-sm font-semibold text-white">{sidebarAiSpotlight.title}</div>
                <p className="mt-2 text-sm leading-6 text-white/62">{sidebarAiSpotlight.summary}</p>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => sidebarAiSpotlight.tokenAddress ? navigate(`/token/${sidebarAiSpotlight.tokenAddress}`) : undefined}
                  className="mt-4 h-10 rounded-full border border-white/10 bg-black/20 px-4 text-white/76 hover:bg-white/[0.08] hover:text-white"
                >
                  Open watch
                </Button>
              </div>
            </section>
          ) : null}

          <section className="rounded-[28px] border border-white/8 bg-[linear-gradient(180deg,rgba(8,12,18,0.96),rgba(5,9,13,0.99))] p-4">
            <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-white/34">
              <Users className="h-3.5 w-3.5 text-lime-300" />
              Trending communities
            </div>
            <div className="mt-4 space-y-3">
              {sidebarTrendingCommunities.slice(0, 4).map((community) => (
                <button
                  key={community.tokenAddress}
                  type="button"
                  onClick={() => navigate(`/communities/${community.tokenAddress}`)}
                  className="flex w-full items-center justify-between rounded-[18px] border border-white/8 bg-white/[0.03] px-3 py-3 text-left transition hover:bg-white/[0.06]"
                >
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold text-white">{community.name}</div>
                    <div className="mt-0.5 truncate text-xs text-white/42">
                      {community.memberCount.toLocaleString()} members • {community.onlineCount.toLocaleString()} online
                    </div>
                  </div>
                  <ArrowUpRight className="h-4 w-4 text-white/34" />
                </button>
              ))}
            </div>
          </section>
        </aside>
      </main>
    </div>
  );
}
