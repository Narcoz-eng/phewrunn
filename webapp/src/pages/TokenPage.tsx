import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { api, ApiError, TimeoutError } from "@/lib/api";
import {
  appendLiveTradeSample,
  getChartBucketMs,
  mergeLiveSamplesIntoCandles,
  type LiveTradeSample,
} from "@/lib/live-candle-stream";
import { Post, PostAuthor, ReactionCounts, TokenSocialSignals, formatMarketCap, formatTimeAgo, getAvatarUrl } from "@/types";
import { Button } from "@/components/ui/button";
import { ArrowLeft, AlertCircle, BarChart3, Coins, Copy, ExternalLink, Loader2, ShieldAlert, TrendingUp, Users, Activity, Flame, Zap, Target, ChevronRight, ShieldCheck } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { BundleScanLoop, isBundleScanPending } from "@/components/feed/BundleScanLoop";
import { PostCard } from "@/components/feed/PostCard";
import { TokenScanningState } from "@/components/feed/TokenScanningState";
import {
  hasResolvedBundleEvidence,
  isBundlePlaceholderState,
  resolveEstimatedBundledSupplyPct,
} from "@/lib/bundle-intelligence";
import { cn } from "@/lib/utils";
import { useSession } from "@/lib/auth-client";
import { readSessionCacheEntry, writeSessionCache } from "@/lib/session-cache";
import { syncTokenIntelligenceAcrossPostCaches } from "@/lib/token-intelligence-cache";
import {
  buildTokenIntelligenceSnapshotFromLivePayload,
  getTokenLiveIntelligence,
} from "@/lib/token-live-intelligence";
import {
  getCachedPostsForToken,
  mergePreferredPostCollections,
} from "@/lib/post-query-cache";
import { toast } from "sonner";
import { PhewTradeIcon } from "@/components/icons/PhewIcons";
import { importWithRecovery } from "@/lib/lazy-with-recovery";

const TokenTelemetryCharts = lazy(() =>
  importWithRecovery(() => import("@/components/token/TokenTelemetryCharts"), "token-page:telemetry-charts")
);
const TokenCommunitySection = lazy(() =>
  importWithRecovery(
    () =>
      import("@/components/token-community/TokenCommunitySection").then((module) => ({
        default: module.TokenCommunitySection,
      })),
    "token-page:community-section"
  )
);

const TOKEN_PAGE_CACHE_TTL_MS = 75_000;
const TOKEN_LIVE_PENDING_REFRESH_INTERVAL_MS = 5_000;
const TOKEN_LIVE_RESOLVED_REFRESH_INTERVAL_MS = 10_000;
const TOKEN_LIVE_CHART_VISIBLE_POINTS = 72;
const TOKEN_LIVE_CHART_FUTURE_SLOTS = 6;
const FRESH_POST_MCAP_WINDOW_MS = 30 * 60_000;
const TOKEN_CHART_INTERVAL_OPTIONS = [
  { value: "1m", label: "1m" },
  { value: "5m", label: "5m" },
  { value: "15m", label: "15m" },
  { value: "1h", label: "1h" },
  { value: "4h", label: "4h" },
  { value: "1D", label: "1D" },
] as const;
const TOKEN_QUICK_BUY_PRESETS = ["0.10", "0.20", "0.50", "1.00"] as const;
const TOKEN_PAGE_TABS = ["trade", "community", "intel"] as const;

type TokenChartIntervalValue = (typeof TOKEN_CHART_INTERVAL_OPTIONS)[number]["value"];
type TokenPageTab = (typeof TOKEN_PAGE_TABS)[number];

type TokenChartPoint = {
  timestamp: string;
  marketCap: number | null;
  liquidity: number | null;
  volume24h: number | null;
  holderCount: number | null;
  sentimentScore: number | null;
  confidenceScore: number | null;
};

type TokenChartCandle = {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

type TokenChartCandlesSource = "birdeye" | "geckoterminal" | "unknown";

type TokenChartCandlesResponse = {
  candles: TokenChartCandle[];
  source: TokenChartCandlesSource;
  network: string | null;
};

type TokenTrader = PostAuthor & {
  callsCount: number;
  avgConfidenceScore: number;
  bestRoiPct: number;
};

type TokenHolderTradeSnapshot = {
  boughtAmount: number | null;
  soldAmount: number | null;
  holdingAmount: number | null;
  netAmount: number | null;
};

type HolderBehavior = "accumulating" | "holding" | "selling" | "unknown";

function getHolderBehavior(snapshot: TokenHolderTradeSnapshot | null | undefined): HolderBehavior {
  if (!snapshot) return "unknown";
  const { boughtAmount, soldAmount, holdingAmount } = snapshot;
  const bought = typeof boughtAmount === "number" && Number.isFinite(boughtAmount) ? boughtAmount : null;
  const sold = typeof soldAmount === "number" && Number.isFinite(soldAmount) ? soldAmount : null;
  const holding = typeof holdingAmount === "number" && Number.isFinite(holdingAmount) ? holdingAmount : null;
  // No trade history but holds the token → they accumulated it at some point
  if (bought === null && sold === null) {
    if (holding !== null && holding > 0) return "holding";
    return "unknown";
  }
  const totalBought = bought ?? 0;
  const totalSold = sold ?? 0;
  const currentHolding = holding ?? (totalBought - totalSold);
  // Has sold more than 60% of what they bought → selling
  if (totalSold > 0 && totalBought > 0 && totalSold >= totalBought * 0.6) return "selling";
  // Sold everything (or near 0 remaining)
  if (totalSold > 0 && currentHolding <= 0) return "selling";
  // Bought and never sold, or sold less than 10% → holding strong / accumulating
  if (totalSold === 0 && totalBought > 0) return "accumulating";
  // Still holds majority, bought way more than sold → accumulating
  if (totalBought > 0 && totalSold < totalBought * 0.1) return "accumulating";
  // Holding a reasonable portion
  if (currentHolding > 0) return "holding";
  return "unknown";
}

function HolderBehaviorIndicator({ snapshot }: { snapshot: TokenHolderTradeSnapshot | null | undefined }) {
  const behavior = getHolderBehavior(snapshot);
  if (behavior === "unknown") return null;

  const config = {
    accumulating: { emoji: "🔥", label: "Accumulating", className: "border-emerald-300/70 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" },
    holding: { emoji: "💎", label: "Holding", className: "border-sky-300/70 bg-sky-500/10 text-sky-700 dark:text-sky-300" },
    selling: { emoji: "🔻", label: "Selling", className: "border-rose-300/70 bg-rose-500/10 text-rose-700 dark:text-rose-300" },
  }[behavior];

  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.1em] ${config.className}`}>
      <span>{config.emoji}</span>
      <span>{config.label}</span>
    </span>
  );
}

type TokenHolder = {
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
  badges: Array<
    "dev_wallet" |
    "fresh_wallet" |
    "high_volume_trader" |
    "whale" |
    "ultra_degen" |
    "serial_deployer" |
    "serial_rugger"
  >;
  devRole: "creator" | "mint_authority" | "freeze_authority" | null;
  tradeSnapshot: TokenHolderTradeSnapshot | null;
  phewHandle: string | null;
  phewImage: string | null;
  phewEntryMcap: number | null;
};

type TokenRisk = {
  tokenRiskScore: number | null;
  bundleRiskLabel: string | null;
  largestHolderPct: number | null;
  top10HolderPct: number | null;
  bundledWalletCount: number | null;
  estimatedBundledSupplyPct: number | null;
  deployerSupplyPct: number | null;
  holderCount: number | null;
  topHolders: TokenHolder[];
  devWallet: TokenHolder | null;
};

type TokenBundleCluster = {
  id?: string;
  clusterLabel: string;
  walletCount: number;
  estimatedSupplyPct: number;
  evidenceJson?: { bucket?: string; holderPcts?: number[] } | null;
  currentAction?: string | null;
};

type TokenTimelineEvent = {
  id: string;
  eventType: string;
  timestamp: string;
  marketCap: number | null;
  liquidity: number | null;
  volume: number | null;
  traderId: string | null;
  postId: string | null;
  metadata?: {
    traderHandle?: string | null;
    traderName?: string | null;
    timingTier?: string | null;
    confidenceScore?: number | null;
  } | null;
};

type TokenPageData = {
  id: string;
  address: string;
  chainType: string;
  symbol: string | null;
  name: string | null;
  imageUrl: string | null;
  dexscreenerUrl: string | null;
  pairAddress?: string | null;
  marketCap: number | null;
  liquidity: number | null;
  volume24h: number | null;
  holderCount: number | null;
  holderCountSource?: "stored" | "helius" | "rpc_scan" | "birdeye" | "largest_accounts" | null;
  largestHolderPct: number | null;
  top10HolderPct: number | null;
  deployerSupplyPct: number | null;
  bundledWalletCount: number | null;
  estimatedBundledSupplyPct: number | null;
  bundleRiskLabel: string | null;
  bundleScanCompletedAt: string | null;
  tokenRiskScore: number | null;
  sentimentScore: number | null;
  radarScore: number | null;
  lastIntelligenceAt: string | null;
  confidenceScore: number | null;
  hotAlphaScore: number | null;
  earlyRunnerScore: number | null;
  highConvictionScore: number | null;
  marketHealthScore: number | null;
  setupQualityScore: number | null;
  opportunityScore: number | null;
  dataReliabilityScore: number | null;
  activityStatus: string | null;
  activityStatusLabel: string | null;
  isTradable: boolean;
  bullishSignalsSuppressed: boolean;
  isEarlyRunner: boolean;
  isFollowing: boolean;
  communityExists: boolean;
  communityBannerUrl: string | null;
  earlyRunnerReasons?: string[];
  topHolders: TokenHolder[];
  devWallet: TokenHolder | null;
  bundleClusters: TokenBundleCluster[];
  chart: TokenChartPoint[];
  callsCount: number;
  distinctTraders: number;
  topTraders: TokenTrader[];
  sentiment: {
    score: number;
    reactions: ReactionCounts;
    bullishPct: number;
    bearishPct: number;
  };
  risk: TokenRisk;
  timeline: TokenTimelineEvent[];
  recentCalls: Post[];
};

type TokenLiveData = {
  marketCap: number | null;
  liquidity: number | null;
  volume24h: number | null;
  holderCount: number | null;
  holderCountSource?: "stored" | "helius" | "rpc_scan" | "birdeye" | "largest_accounts" | null;
  largestHolderPct: number | null;
  top10HolderPct: number | null;
  deployerSupplyPct: number | null;
  bundledWalletCount: number | null;
  estimatedBundledSupplyPct: number | null;
  bundleRiskLabel: string | null;
  tokenRiskScore: number | null;
  topHolders: TokenHolder[];
  devWallet: TokenHolder | null;
  bundleClusters: TokenBundleCluster[];
  dexscreenerUrl: string | null;
  pairAddress: string | null;
  dexId: string | null;
  imageUrl: string | null;
  symbol: string | null;
  name: string | null;
  sentimentScore: number | null;
  confidenceScore: number | null;
  hotAlphaScore: number | null;
  earlyRunnerScore: number | null;
  highConvictionScore: number | null;
  marketHealthScore: number | null;
  setupQualityScore: number | null;
  opportunityScore: number | null;
  dataReliabilityScore: number | null;
  activityStatus: string | null;
  activityStatusLabel: string | null;
  isTradable: boolean;
  bullishSignalsSuppressed: boolean;
  sentiment: {
    score: number;
    reactions: ReactionCounts;
    bullishPct: number;
    bearishPct: number;
  };
  lastIntelligenceAt: string | null;
  priceUsd: number | null;
  priceChange24hPct: number | null;
  buys24h: number | null;
  sells24h: number | null;
  bundleScanCompletedAt: string | null;
  updatedAt: string;
};

function parseTokenPageTab(value: string | null): TokenPageTab {
  if (value === "community" || value === "intel") return value;
  return "trade";
}

function buildXSearchUrl(query: string): string {
  return `https://x.com/search?q=${encodeURIComponent(query)}&src=typed_query&f=live`;
}

function formatPct(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "N/A";
  return `${value.toFixed(1)}%`;
}

function formatIntegerMetric(
  value: number | null | undefined,
  options?: { zeroIsValid?: boolean; emptyLabel?: string }
): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return options?.emptyLabel ?? "Scanning";
  if (!options?.zeroIsValid && value <= 0) return options?.emptyLabel ?? "Scanning";
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(value);
}

function formatMarketMetric(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return "Scanning";
  return formatMarketCap(value);
}

function formatTokenPrice(value: number): string {
  if (!Number.isFinite(value)) return "-";
  if (value === 0) return "$0.00";
  if (Math.abs(value) < 0.000001) return `$${value.toExponential(2)}`;
  if (Math.abs(value) < 0.01) return `$${value.toFixed(6)}`;
  if (Math.abs(value) < 1) return `$${value.toFixed(4)}`;
  return `$${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`;
}

function formatChartTimelineTick(timestampMs: number, spanMs: number): string {
  if (!Number.isFinite(timestampMs)) return "";
  const date = new Date(timestampMs);
  if (spanMs >= 14 * 24 * 60 * 60 * 1000) {
    return date.toLocaleDateString([], { month: "short", day: "numeric" });
  }
  if (spanMs >= 2 * 24 * 60 * 60 * 1000) {
    return date.toLocaleDateString([], { month: "short", day: "numeric", hour: "2-digit" });
  }
  if (spanMs >= 6 * 60 * 60 * 1000) {
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function formatChartTimelineTooltip(timestampMs: number): string {
  if (!Number.isFinite(timestampMs)) return "";
  return new Date(timestampMs).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatHolderAmount(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return "Amount unavailable";
  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: value >= 1000 ? 1 : 2,
  }).format(value);
}

function formatSolMetric(value: number | null | undefined): string | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return null;
  return `${new Intl.NumberFormat("en-US", { maximumFractionDigits: value >= 100 ? 0 : 1 }).format(value)} SOL`;
}

function formatHolderAddress(address: string): string {
  const trimmed = address.trim();
  if (trimmed.length <= 12) return trimmed;
  return `${trimmed.slice(0, 4)}...${trimmed.slice(-4)}`;
}

type HolderBadgeMeta = {
  label: string;
  emoji: string;
  className: string;
};

function getHolderBadgeMeta(badge: TokenHolder["badges"][number]): HolderBadgeMeta {
  switch (badge) {
    case "dev_wallet":
      return {
        label: "Dev wallet",
        emoji: "🛠",
        className: "border-amber-300/85 bg-[linear-gradient(135deg,rgba(251,191,36,0.26),rgba(249,115,22,0.22))] text-amber-950 shadow-[0_18px_34px_-26px_rgba(245,158,11,0.9)] dark:border-amber-300/70 dark:bg-[linear-gradient(135deg,rgba(245,158,11,0.28),rgba(249,115,22,0.18))] dark:text-amber-50",
      };
    case "fresh_wallet":
      return {
        label: "Fresh wallet",
        emoji: "🌱",
        className: "border-emerald-300/85 bg-[linear-gradient(135deg,rgba(52,211,153,0.26),rgba(16,185,129,0.22))] text-emerald-950 shadow-[0_16px_32px_-24px_rgba(16,185,129,0.9)] dark:border-emerald-300/70 dark:bg-[linear-gradient(135deg,rgba(16,185,129,0.3),rgba(5,150,105,0.2))] dark:text-emerald-50",
      };
    case "high_volume_trader":
      return {
        label: "High volume trader",
        emoji: "⚡",
        className: "border-sky-300/85 bg-[linear-gradient(135deg,rgba(56,189,248,0.26),rgba(59,130,246,0.22))] text-sky-950 shadow-[0_16px_32px_-24px_rgba(37,99,235,0.9)] dark:border-sky-300/70 dark:bg-[linear-gradient(135deg,rgba(56,189,248,0.28),rgba(59,130,246,0.18))] dark:text-sky-50",
      };
    case "whale":
      return {
        label: "Whale",
        emoji: "🐋",
        className: "border-indigo-400/85 bg-[linear-gradient(135deg,rgba(99,102,241,0.22),rgba(56,189,248,0.18))] text-indigo-950 shadow-[0_18px_36px_-24px_rgba(79,70,229,0.95)] dark:border-indigo-300/75 dark:bg-[linear-gradient(135deg,rgba(99,102,241,0.28),rgba(14,165,233,0.18))] dark:text-indigo-50",
      };
    case "ultra_degen":
      return {
        label: "Ultra degen",
        emoji: "🧨",
        className: "border-fuchsia-400/90 bg-[linear-gradient(135deg,rgba(217,70,239,0.28),rgba(249,115,22,0.22))] text-fuchsia-950 shadow-[0_22px_40px_-24px_rgba(217,70,239,0.98)] dark:border-fuchsia-300/80 dark:bg-[linear-gradient(135deg,rgba(217,70,239,0.34),rgba(249,115,22,0.22))] dark:text-fuchsia-50",
      };
    case "serial_deployer":
      return {
        label: "Serial deployer",
        emoji: "🏗",
        className: "border-violet-300/85 bg-[linear-gradient(135deg,rgba(167,139,250,0.24),rgba(139,92,246,0.2))] text-violet-950 shadow-[0_16px_32px_-24px_rgba(124,58,237,0.88)] dark:border-violet-300/70 dark:bg-[linear-gradient(135deg,rgba(139,92,246,0.28),rgba(109,40,217,0.18))] dark:text-violet-50",
      };
    case "serial_rugger":
      return {
        label: "Serial rugger",
        emoji: "☠",
        className: "border-rose-300/85 bg-[linear-gradient(135deg,rgba(251,113,133,0.24),rgba(239,68,68,0.18))] text-rose-950 shadow-[0_16px_32px_-24px_rgba(225,29,72,0.92)] dark:border-rose-300/70 dark:bg-[linear-gradient(135deg,rgba(244,63,94,0.28),rgba(190,24,93,0.18))] dark:text-rose-50",
      };
    default:
      return {
        label: badge,
        emoji: "•",
        className: "border-border/60 bg-white/80 text-muted-foreground dark:bg-white/[0.05]",
      };
  }
}

function formatHolderBadge(badge: TokenHolder["badges"][number]): string {
  const meta = getHolderBadgeMeta(badge);
  return `${meta.emoji} ${meta.label}`;
}

function getHolderRoleSurfaceClass(
  badge: TokenHolder["badges"][number] | null | undefined
): string {
  switch (badge) {
    case "ultra_degen":
      return "border-fuchsia-400/40 bg-[linear-gradient(180deg,rgba(217,70,239,0.12),rgba(249,115,22,0.08),rgba(15,23,42,0.72))] shadow-[0_24px_48px_-34px_rgba(217,70,239,0.95)]";
    case "whale":
      return "border-indigo-400/38 bg-[linear-gradient(180deg,rgba(79,70,229,0.12),rgba(56,189,248,0.08),rgba(15,23,42,0.72))] shadow-[0_24px_48px_-34px_rgba(79,70,229,0.95)]";
    case "fresh_wallet":
      return "border-emerald-400/34 bg-[linear-gradient(180deg,rgba(16,185,129,0.12),rgba(6,95,70,0.06),rgba(15,23,42,0.72))] shadow-[0_22px_44px_-34px_rgba(16,185,129,0.88)]";
    case "high_volume_trader":
      return "border-sky-400/34 bg-[linear-gradient(180deg,rgba(56,189,248,0.12),rgba(37,99,235,0.06),rgba(15,23,42,0.72))] shadow-[0_22px_44px_-34px_rgba(37,99,235,0.88)]";
    case "serial_rugger":
      return "border-rose-400/34 bg-[linear-gradient(180deg,rgba(244,63,94,0.12),rgba(190,24,93,0.08),rgba(15,23,42,0.72))] shadow-[0_22px_44px_-34px_rgba(225,29,72,0.9)]";
    case "serial_deployer":
      return "border-violet-400/34 bg-[linear-gradient(180deg,rgba(139,92,246,0.12),rgba(91,33,182,0.06),rgba(15,23,42,0.72))] shadow-[0_22px_44px_-34px_rgba(124,58,237,0.88)]";
    case "dev_wallet":
      return "border-amber-400/34 bg-[linear-gradient(180deg,rgba(245,158,11,0.12),rgba(249,115,22,0.06),rgba(15,23,42,0.72))] shadow-[0_22px_44px_-34px_rgba(245,158,11,0.88)]";
    default:
      return "border-border/60 bg-secondary";
  }
}

function getNormalizedHolderBadges(
  holder: Pick<TokenHolder, "badges" | "devRole"> | null | undefined
): TokenHolder["badges"] {
  if (!holder) {
    return [];
  }

  const badges = [...holder.badges];
  if (holder.devRole && !badges.includes("dev_wallet")) {
    badges.unshift("dev_wallet");
  }
  return [...new Set(badges)];
}

function getPrimaryHolderBadge(
  holder: Pick<TokenHolder, "badges" | "devRole"> | null | undefined
): TokenHolder["badges"][number] | null {
  return getNormalizedHolderBadges(holder)[0] ?? null;
}

function getSecondaryHolderBadges(
  holder: Pick<TokenHolder, "badges" | "devRole"> | null | undefined
): TokenHolder["badges"] {
  const badges = getNormalizedHolderBadges(holder);
  if (!badges.length) {
    return [];
  }

  const primary = getPrimaryHolderBadge(holder);
  return badges.filter((badge) => badge !== primary);
}

function buildHolderScanSummary(holder: TokenHolder | null | undefined): string | null {
  if (!holder) {
    return null;
  }

  const ageLabel = formatDaysMetric(holder.activeAgeDays);
  const flowLabel = formatSolMetric(holder.tradeVolume90dSol);
  const details = [
    holder.label,
    ageLabel ? `Age ${ageLabel}` : null,
    flowLabel ? `${flowLabel} traded` : null,
  ].filter((value): value is string => Boolean(value));

  return details.length > 0 ? details.join(" | ") : null;
}

function formatDaysMetric(value: number | null | undefined): string | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return null;
  return value < 1 ? "<1d" : `${Math.round(value)}d`;
}

function getDevRoleLabel(devRole: TokenHolder["devRole"] | null | undefined): string {
  if (devRole === "creator") return "Creator wallet";
  if (devRole === "mint_authority") return "Mint authority";
  if (devRole === "freeze_authority") return "Freeze authority";
  return "Developer wallet";
}

function getDevRoleSourceLabel(devRole: TokenHolder["devRole"] | null | undefined): string {
  if (devRole === "creator") return "Token creator";
  if (devRole === "mint_authority") return "Mint authority";
  if (devRole === "freeze_authority") return "Freeze authority";
  return "On-chain authority";
}

function getDevPositionStatus(holder: Pick<TokenHolder, "amount" | "supplyPct" | "valueUsd"> | null | undefined): {
  label: string;
  toneClass: string;
} | null {
  if (!holder) {
    return null;
  }

  const isStillIn =
    (typeof holder.amount === "number" && Number.isFinite(holder.amount) && holder.amount > 0) ||
    (typeof holder.supplyPct === "number" && Number.isFinite(holder.supplyPct) && holder.supplyPct > 0) ||
    (typeof holder.valueUsd === "number" && Number.isFinite(holder.valueUsd) && holder.valueUsd > 0);

  return isStillIn
    ? {
        label: "Dev still in",
        toneClass:
          "border-emerald-300/80 bg-[linear-gradient(135deg,rgba(16,185,129,0.26),rgba(5,150,105,0.18))] text-emerald-950 dark:border-emerald-300/70 dark:bg-[linear-gradient(135deg,rgba(16,185,129,0.24),rgba(4,120,87,0.18))] dark:text-emerald-50",
      }
    : {
        label: "Dev out",
        toneClass:
          "border-rose-300/80 bg-[linear-gradient(135deg,rgba(244,63,94,0.18),rgba(239,68,68,0.14))] text-rose-950 dark:border-rose-300/70 dark:bg-[linear-gradient(135deg,rgba(244,63,94,0.2),rgba(190,24,93,0.16))] dark:text-rose-50",
      };
}

function formatTimelineEventLabel(eventType: string): string {
  switch (eventType) {
    case "alpha_call":
      return "Alpha call";
    case "early_runner_detected":
      return "Early runner detected";
    case "hot_alpha_detected":
      return "Hot alpha detected";
    case "high_conviction_detected":
      return "High conviction signal";
    default:
      return eventType.replace(/_/g, " ");
  }
}

function buildTimelineCopy(event: TokenTimelineEvent): { title: string; description: string } {
  const traderLabel = event.metadata?.traderHandle || event.metadata?.traderName || "Phew engine";
  const eventLabel = formatTimelineEventLabel(event.eventType);
  const details = [
    event.marketCap ? `at ${formatMarketCap(event.marketCap)}` : null,
    event.metadata?.timingTier ?? null,
    typeof event.metadata?.confidenceScore === "number"
      ? `${event.metadata.confidenceScore.toFixed(0)}% confidence`
      : null,
  ].filter(Boolean);

  if (event.eventType === "alpha_call") {
    return {
      title: traderLabel,
      description: `${eventLabel}${details.length ? ` ${details.join(" | ")}` : ""}`,
    };
  }

  return {
    title: eventLabel,
    description: `${traderLabel}${details.length ? ` | ${details.join(" | ")}` : ""}`,
  };
}

function isTokenPageDataCacheable(token: TokenPageData | null | undefined): token is TokenPageData {
  if (!token) return false;
  const hasSignals = [
    token.confidenceScore,
    token.hotAlphaScore,
    token.earlyRunnerScore,
    token.highConvictionScore,
  ].some((value) => typeof value === "number" && Number.isFinite(value));
  const hasMarketData = [token.liquidity, token.volume24h, token.holderCount].some(
    (value) => typeof value === "number" && Number.isFinite(value) && value > 0
  );
  const hasChart = token.chart.some(
    (point) =>
      [point.marketCap, point.liquidity, point.volume24h, point.holderCount].some(
        (value) => typeof value === "number" && Number.isFinite(value) && value > 0
      )
  );

  return hasSignals || hasMarketData || hasChart || token.recentCalls.length > 0;
}

function parseTimestamp(value: string | null | undefined): number {
  if (!value) return 0;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function finiteMetric(value: number | null | undefined, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function getPostMetricTimestamp(
  post: Pick<Post, "lastMcapUpdate" | "lastIntelligenceAt" | "createdAt">
): number {
  return Math.max(
    parseTimestamp(post.lastMcapUpdate ?? null),
    parseTimestamp(post.lastIntelligenceAt ?? null),
    parseTimestamp(post.createdAt)
  );
}

function syncRecentCallViewerState(
  primary: Post[] | null | undefined,
  merged: Post[]
): Post[] {
  if (!Array.isArray(primary) || primary.length === 0 || merged.length === 0) {
    return merged;
  }

  const primaryById = new Map(primary.map((post) => [post.id, post] as const));
  let didChange = false;
  const nextMerged = merged.map((post) => {
    const primaryPost = primaryById.get(post.id);
    if (!primaryPost) {
      return post;
    }

    const nextPost = {
      ...post,
      isLiked: primaryPost.isLiked,
      isReposted: primaryPost.isReposted,
      isFollowingAuthor: primaryPost.isFollowingAuthor,
      currentReactionType: primaryPost.currentReactionType,
    };

    if (
      nextPost.isLiked !== post.isLiked ||
      nextPost.isReposted !== post.isReposted ||
      nextPost.isFollowingAuthor !== post.isFollowingAuthor ||
      nextPost.currentReactionType !== post.currentReactionType
    ) {
      didChange = true;
      return nextPost;
    }

    return post;
  });

  return didChange ? nextMerged : merged;
}

function pickMergedMetric(
  live: number | null | undefined,
  cached: number | null | undefined,
  preferSecondOrOptions?: boolean | { positive?: boolean },
  options?: { positive?: boolean }
): number | null {
  const preferSecond = typeof preferSecondOrOptions === "boolean" ? preferSecondOrOptions : false;
  const opts = typeof preferSecondOrOptions === "object" ? preferSecondOrOptions : options;
  const first = preferSecond ? cached : live;
  const second = preferSecond ? live : cached;
  if (typeof first === "number" && Number.isFinite(first) && (!opts?.positive || first > 0)) {
    return first;
  }
  if (typeof second === "number" && Number.isFinite(second) && (!opts?.positive || second > 0)) {
    return second;
  }
  return first ?? second ?? null;
}

function getBestPostCurrentMcapSnapshot(
  posts: Post[] | null | undefined
): { value: number; timestamp: number } | null {
  let best: { value: number; timestamp: number } | null = null;

  for (const post of posts ?? []) {
    if (typeof post.currentMcap !== "number" || !Number.isFinite(post.currentMcap) || post.currentMcap <= 0) {
      continue;
    }

    const timestamp = getPostMetricTimestamp(post);
    if (!best || timestamp >= best.timestamp) {
      best = {
        value: post.currentMcap,
        timestamp,
      };
    }
  }

  return best;
}

function pickStableMarketCap(
  live: number | null | undefined,
  cached: number | null | undefined,
  posts: Post[] | null | undefined
): number | null {
  const merged = pickMergedMetric(live, cached, { positive: true });
  const postCurrentMcap = getBestPostCurrentMcapSnapshot(posts);

  if (postCurrentMcap) {
    if (typeof merged !== "number" || !Number.isFinite(merged) || merged <= 0) {
      return postCurrentMcap.value;
    }

    const ratio = Math.max(merged, postCurrentMcap.value) / Math.max(1, Math.min(merged, postCurrentMcap.value));
    const postMetricIsFresh =
      postCurrentMcap.timestamp > 0 && Date.now() - postCurrentMcap.timestamp <= FRESH_POST_MCAP_WINDOW_MS;
    if (postMetricIsFresh || ratio >= 1.15) {
      return postCurrentMcap.value;
    }
  }

  return merged;
}

function deriveTimelineFromCalls(calls: Post[] | null | undefined): TokenTimelineEvent[] {
  return [...(calls ?? [])]
    .sort((left, right) => parseTimestamp(right.createdAt) - parseTimestamp(left.createdAt))
    .slice(0, 12)
    .map((call) => ({
      id: `call:${call.id}`,
      eventType: "alpha_call",
      timestamp: call.createdAt,
      marketCap: call.entryMcap,
      liquidity: call.liquidity ?? null,
      volume: call.volume24h ?? null,
      traderId: call.author.id,
      postId: call.id,
      metadata: {
        traderHandle: call.author.username,
        traderName: call.author.name,
        timingTier: call.timingTier ?? null,
        confidenceScore: call.confidenceScore ?? null,
      },
    }));
}

function mergeTimelineEvents(
  primary: TokenTimelineEvent[] | null | undefined,
  fallback: TokenTimelineEvent[] | null | undefined
): TokenTimelineEvent[] {
  const mergedById = new Map<string, TokenTimelineEvent>();

  for (const event of [...(primary ?? []), ...(fallback ?? [])]) {
    if (!event?.id || mergedById.has(event.id)) {
      continue;
    }
    mergedById.set(event.id, event);
  }

  return Array.from(mergedById.values())
    .sort((left, right) => parseTimestamp(right.timestamp) - parseTimestamp(left.timestamp))
    .slice(0, 48);
}

function deriveTopTradersFromCalls(calls: Post[] | null | undefined): TokenTrader[] {
  const traderMap = new Map<
    string,
    TokenTrader & {
      totalConfidenceScore: number;
    }
  >();

  for (const call of calls ?? []) {
    const existing = traderMap.get(call.author.id) ?? {
      id: call.author.id,
      name: call.author.name,
      username: call.author.username,
      image: call.author.image,
      level: call.author.level,
      xp: call.author.xp,
      trustScore: call.author.trustScore ?? null,
      reputationTier: call.author.reputationTier ?? null,
      winRate30d: call.author.winRate30d ?? null,
      avgRoi30d: call.author.avgRoi30d ?? null,
      firstCallCount: call.author.firstCallCount,
      callsCount: 0,
      avgConfidenceScore: 0,
      bestRoiPct: 0,
      totalConfidenceScore: 0,
    };

    existing.callsCount += 1;
    existing.totalConfidenceScore += finiteMetric(call.confidenceScore);
    existing.bestRoiPct = Math.max(
      existing.bestRoiPct,
      Math.max(0, finiteMetric(call.roiPeakPct, finiteMetric(call.roiCurrentPct)))
    );
    traderMap.set(call.author.id, existing);
  }

  return Array.from(traderMap.values())
    .map(({ totalConfidenceScore, ...trader }) => ({
      ...trader,
      avgConfidenceScore:
        trader.callsCount > 0 ? Math.round((totalConfidenceScore / trader.callsCount) * 10) / 10 : 0,
      bestRoiPct: Math.round(trader.bestRoiPct * 10) / 10,
    }))
    .sort((left, right) => {
      const callDelta = right.callsCount - left.callsCount;
      if (callDelta !== 0) return callDelta;
      const confidenceDelta = finiteMetric(right.avgConfidenceScore) - finiteMetric(left.avgConfidenceScore);
      if (confidenceDelta !== 0) return confidenceDelta;
      const trustDelta = finiteMetric(right.trustScore) - finiteMetric(left.trustScore);
      if (trustDelta !== 0) return trustDelta;
      return finiteMetric(right.bestRoiPct) - finiteMetric(left.bestRoiPct);
    })
    .slice(0, 8);
}

function getTokenIntelligenceVersion(token: Pick<TokenPageData, "lastIntelligenceAt"> | null | undefined): number {
  if (!token?.lastIntelligenceAt) {
    return 0;
  }
  const parsed = new Date(token.lastIntelligenceAt).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function clampPercentage(value: number | null | undefined): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }
  return Math.max(0, Math.min(100, value));
}

function sanitizeReactionCounts(
  reactions: Partial<ReactionCounts> | null | undefined
): ReactionCounts {
  return {
    alpha:
      typeof reactions?.alpha === "number" && Number.isFinite(reactions.alpha) && reactions.alpha > 0
        ? Math.round(reactions.alpha)
        : 0,
    based:
      typeof reactions?.based === "number" && Number.isFinite(reactions.based) && reactions.based > 0
        ? Math.round(reactions.based)
        : 0,
    printed:
      typeof reactions?.printed === "number" && Number.isFinite(reactions.printed) && reactions.printed > 0
        ? Math.round(reactions.printed)
        : 0,
    rug:
      typeof reactions?.rug === "number" && Number.isFinite(reactions.rug) && reactions.rug > 0
        ? Math.round(reactions.rug)
        : 0,
  };
}

function resolveSentimentSplit(args: {
  bullishPct: number | null | undefined;
  bearishPct: number | null | undefined;
  sentimentScore?: number | null | undefined;
}): { bullishPct: number; bearishPct: number } {
  const bullishPct = clampPercentage(args.bullishPct);
  const bearishPct = clampPercentage(args.bearishPct);

  if (bullishPct !== null && bearishPct !== null) {
    const total = bullishPct + bearishPct;
    if (total > 0) {
      return {
        bullishPct: (bullishPct / total) * 100,
        bearishPct: (bearishPct / total) * 100,
      };
    }
  }

  if (bullishPct !== null) {
    return { bullishPct, bearishPct: 100 - bullishPct };
  }
  if (bearishPct !== null) {
    return { bullishPct: 100 - bearishPct, bearishPct };
  }

  const fallbackScore = clampPercentage(args.sentimentScore);
  if (fallbackScore !== null) {
    return {
      bullishPct: fallbackScore,
      bearishPct: 100 - fallbackScore,
    };
  }

  return { bullishPct: 50, bearishPct: 50 };
}

function sanitizeSentimentView(
  sentiment: TokenPageData["sentiment"] | TokenLiveData["sentiment"] | null | undefined,
  fallbackScore: number | null | undefined
): {
  score: number;
  reactions: ReactionCounts;
  bullishPct: number;
  bearishPct: number;
} {
  const score = clampPercentage(sentiment?.score ?? fallbackScore) ?? 0;

  return {
    score,
    reactions: sanitizeReactionCounts(sentiment?.reactions),
    bullishPct: score,
    bearishPct: Math.max(0, 100 - score),
  };
}

function hasResolvedHolderCount(
  holderCount: number | null | undefined,
  holderCountSource: TokenPageData["holderCountSource"] | TokenLiveData["holderCountSource"]
): boolean {
  return (
    typeof holderCount === "number" &&
    Number.isFinite(holderCount) &&
    holderCount > 0 &&
    holderCountSource !== "largest_accounts" &&
    holderCountSource !== null &&
    holderCountSource !== undefined &&
    !(
      (holderCountSource === "stored" ||
        holderCountSource === "helius" ||
        holderCountSource === "rpc_scan" ||
        holderCountSource === "birdeye") &&
      Math.round(holderCount) === 1000
    )
  );
}

function isHolderIntelligencePending(
  token:
    | (Pick<TokenPageData, "chainType" | "topHolders" | "holderCount" | "holderCountSource" | "devWallet"> & {
        bundleScanCompletedAt?: string | null;
      })
    | null
    | undefined
): boolean {
  if (!token || token.chainType !== "solana") {
    return false;
  }

  // If backend completed the scan, trust it — holder intelligence is settled
  return (
    token.topHolders.length === 0 ||
    !hasResolvedHolderCount(token.holderCount, token.holderCountSource) ||
    !hasResolvedHolderRoleIntelligence(token)
  );
}

function hasResolvedHolderRoleFields(
  holder:
    | Pick<TokenHolder, "badges" | "devRole" | "activeAgeDays" | "fundedBy" | "tradeVolume90dSol" | "solBalance" | "label">
    | null
    | undefined
): boolean {
  if (!holder) {
    return false;
  }

  return Boolean(
    holder.badges.length > 0 ||
      holder.activeAgeDays !== null ||
      holder.fundedBy !== null ||
      holder.tradeVolume90dSol !== null ||
      holder.solBalance !== null ||
      (typeof holder.label === "string" && holder.label.trim().length > 0)
  );
}

function hasResolvedHolderRoleIntelligence(
  token:
    | Pick<TokenPageData, "topHolders" | "devWallet">
    | null
    | undefined
): boolean {
  if (!token) {
    return false;
  }

  return token.topHolders.some((holder) => hasResolvedHolderRoleFields(holder));
}

function normalizeHolderIdentifier(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim().toLowerCase();
  return normalized.length > 0 ? normalized : null;
}

function holderSnapshotKeys(
  holder: Pick<TokenHolder, "address" | "ownerAddress" | "tokenAccountAddress">
): string[] {
  return [...new Set(
    [
      normalizeHolderIdentifier(holder.ownerAddress),
      normalizeHolderIdentifier(holder.address),
      normalizeHolderIdentifier(holder.tokenAccountAddress),
    ].filter((value): value is string => value !== null)
  )];
}

function mergeHolderBadges(
  primary: TokenHolder["badges"] | null | undefined,
  fallback: TokenHolder["badges"] | null | undefined
): TokenHolder["badges"] {
  return [...new Set([...(primary ?? []), ...(fallback ?? [])])];
}

function getHolderRoleRichness(holder: TokenHolder | null | undefined): number {
  if (!holder) {
    return 0;
  }

  return (
    holder.badges.length * 10 +
    Number(holder.devRole !== null) * 8 +
    Number(holder.activeAgeDays !== null) * 4 +
    Number(holder.tradeVolume90dSol !== null) * 4 +
    Number(holder.solBalance !== null) * 3 +
    Number(holder.fundedBy !== null) * 2 +
    Number(typeof holder.label === "string" && holder.label.trim().length > 0) * 2
  );
}

function hasApproximateHolderPositionMatch(left: TokenHolder, right: TokenHolder): boolean {
  const leftSupplyPct = typeof left.supplyPct === "number" && Number.isFinite(left.supplyPct) ? left.supplyPct : null;
  const rightSupplyPct = typeof right.supplyPct === "number" && Number.isFinite(right.supplyPct) ? right.supplyPct : null;
  const leftAmount = typeof left.amount === "number" && Number.isFinite(left.amount) ? left.amount : null;
  const rightAmount = typeof right.amount === "number" && Number.isFinite(right.amount) ? right.amount : null;

  if (leftSupplyPct === null || rightSupplyPct === null || leftAmount === null || rightAmount === null) {
    return false;
  }

  const supplyDiff = Math.abs(leftSupplyPct - rightSupplyPct);
  const amountDiff = Math.abs(leftAmount - rightAmount);
  const amountTolerance = Math.max(1, Math.abs(rightAmount) * 0.0025);
  return supplyDiff <= 0.05 && amountDiff <= amountTolerance;
}

function mergeHolderSnapshot(
  primary: TokenHolder,
  fallback: TokenHolder | null | undefined
): TokenHolder {
  if (!fallback) {
    return primary;
  }

  const resolvedOwnerAddress = primary.ownerAddress ?? fallback.ownerAddress ?? null;
  const resolvedTokenAccountAddress =
    primary.tokenAccountAddress ??
    fallback.tokenAccountAddress ??
    (() => {
      const primaryAddressKey = normalizeHolderIdentifier(primary.address);
      const fallbackAddressKey = normalizeHolderIdentifier(fallback.address);
      const ownerAddressKey = normalizeHolderIdentifier(resolvedOwnerAddress);

      if (primaryAddressKey && primaryAddressKey !== ownerAddressKey) {
        return primary.address;
      }
      if (fallbackAddressKey && fallbackAddressKey !== ownerAddressKey) {
        return fallback.address;
      }
      return null;
    })();

  return {
    address: resolvedOwnerAddress ?? primary.address ?? fallback.address,
    ownerAddress: resolvedOwnerAddress,
    tokenAccountAddress: resolvedTokenAccountAddress,
    amount: pickMergedMetric(primary.amount, fallback.amount, { positive: true }),
    supplyPct: pickMergedMetric(primary.supplyPct, fallback.supplyPct) ?? 0,
    valueUsd: pickMergedMetric(primary.valueUsd, fallback.valueUsd, { positive: true }),
    label: primary.label ?? fallback.label ?? null,
    domain: primary.domain ?? fallback.domain ?? null,
    accountType: primary.accountType ?? fallback.accountType ?? null,
    activeAgeDays: pickMergedMetric(primary.activeAgeDays, fallback.activeAgeDays, { positive: true }),
    fundedBy: primary.fundedBy ?? fallback.fundedBy ?? null,
    totalValueUsd: pickMergedMetric(primary.totalValueUsd, fallback.totalValueUsd, { positive: true }),
    tradeVolume90dSol: pickMergedMetric(primary.tradeVolume90dSol, fallback.tradeVolume90dSol, { positive: true }),
    solBalance: pickMergedMetric(primary.solBalance, fallback.solBalance, { positive: true }),
    badges: mergeHolderBadges(primary.badges, fallback.badges),
    devRole: primary.devRole ?? fallback.devRole ?? null,
    tradeSnapshot: primary.tradeSnapshot ?? fallback.tradeSnapshot ?? null,
  };
}

function mergeTopHolderSnapshots(
  primary: TokenHolder[] | null | undefined,
  fallback: TokenHolder[] | null | undefined
): TokenHolder[] {
  const primaryRows = primary ?? [];
  const fallbackRows = fallback ?? [];
  if (primaryRows.length === 0) {
    return fallbackRows;
  }
  if (fallbackRows.length === 0) {
    return primaryRows;
  }

  const fallbackByKey = new Map<string, TokenHolder>();
  for (const holder of fallbackRows) {
    for (const key of holderSnapshotKeys(holder)) {
      if (!fallbackByKey.has(key)) {
        fallbackByKey.set(key, holder);
      }
    }
  }

  const merged: TokenHolder[] = [];
  const seenFallbackRows = new Set<TokenHolder>();

  for (const holder of primaryRows) {
    const matchingFallback = holderSnapshotKeys(holder)
      .map((key) => fallbackByKey.get(key) ?? null)
      .find((candidate): candidate is TokenHolder => candidate !== null) ?? null;
    if (matchingFallback) {
      seenFallbackRows.add(matchingFallback);
    }
    merged.push(mergeHolderSnapshot(holder, matchingFallback));
  }

  for (const holder of fallbackRows) {
    if (seenFallbackRows.has(holder)) continue;

    const approximateMatchIndex = merged.findIndex((existingHolder) => {
      const exactSharedKey = holderSnapshotKeys(existingHolder).some((key) => holderSnapshotKeys(holder).includes(key));
      if (exactSharedKey) {
        return true;
      }

      return (
        getHolderRoleRichness(holder) > getHolderRoleRichness(existingHolder) &&
        hasApproximateHolderPositionMatch(existingHolder, holder)
      );
    });

    if (approximateMatchIndex >= 0) {
      merged[approximateMatchIndex] = mergeHolderSnapshot(merged[approximateMatchIndex]!, holder);
      continue;
    }

    merged.push(holder);
  }

  const coalesced: TokenHolder[] = [];
  for (const holder of merged) {
    const matchingIndex = coalesced.findIndex((existingHolder) => {
      const exactSharedKey = holderSnapshotKeys(existingHolder).some((key) => holderSnapshotKeys(holder).includes(key));
      if (exactSharedKey) {
        return true;
      }

      return (
        (getHolderRoleRichness(holder) > 0 || getHolderRoleRichness(existingHolder) > 0) &&
        hasApproximateHolderPositionMatch(existingHolder, holder)
      );
    });

    if (matchingIndex < 0) {
      coalesced.push(holder);
      continue;
    }

    const existingHolder = coalesced[matchingIndex]!;
    const richerHolder =
      getHolderRoleRichness(holder) > getHolderRoleRichness(existingHolder)
        ? holder
        : existingHolder;
    const thinnerHolder = richerHolder === holder ? existingHolder : holder;
    coalesced[matchingIndex] = mergeHolderSnapshot(richerHolder, thinnerHolder);
  }

  return [...coalesced].sort((left, right) => {
    if (right.supplyPct !== left.supplyPct) {
      return right.supplyPct - left.supplyPct;
    }

    const rightAmount = typeof right.amount === "number" && Number.isFinite(right.amount) ? right.amount : 0;
    const leftAmount = typeof left.amount === "number" && Number.isFinite(left.amount) ? left.amount : 0;
    if (rightAmount !== leftAmount) {
      return rightAmount - leftAmount;
    }

    return getHolderRoleRichness(right) - getHolderRoleRichness(left);
  });
}

function mergeTokenPageDataWithCached(
  live: TokenPageData,
  cached: TokenPageData | null | undefined
): TokenPageData {
  if (!cached) {
    return live;
  }

  const liveIntelligenceVersion = getTokenIntelligenceVersion(live);
  const cachedIntelligenceVersion = getTokenIntelligenceVersion(cached);
  const canReuseCachedIntelligence =
    cachedIntelligenceVersion > 0 && cachedIntelligenceVersion >= liveIntelligenceVersion;
  const liveSentimentHasSignals =
    live.sentiment.score > 0 ||
    Object.values(live.sentiment.reactions).some((value) => value > 0);
  const liveEstimatedBundledSupplyPct = resolveEstimatedBundledSupplyPct({
    estimatedBundledSupplyPct: live.estimatedBundledSupplyPct,
    bundleClusters: live.bundleClusters,
  });
  const cachedEstimatedBundledSupplyPct = resolveEstimatedBundledSupplyPct({
    estimatedBundledSupplyPct: cached.estimatedBundledSupplyPct,
    bundleClusters: cached.bundleClusters,
  });
  const liveBundleState = {
    bundleRiskLabel: live.bundleRiskLabel,
    bundleScanCompletedAt: live.bundleScanCompletedAt,
    bundledWalletCount: live.bundledWalletCount,
    estimatedBundledSupplyPct: liveEstimatedBundledSupplyPct,
    bundleClusters: live.bundleClusters,
  };
  const cachedBundleState = {
    bundleRiskLabel: cached.bundleRiskLabel,
    bundleScanCompletedAt: cached.bundleScanCompletedAt,
    bundledWalletCount: cached.bundledWalletCount,
    estimatedBundledSupplyPct: cachedEstimatedBundledSupplyPct,
    bundleClusters: cached.bundleClusters,
  };
  const shouldKeepCachedBundleState =
    hasResolvedBundleEvidence(cachedBundleState) && isBundlePlaceholderState(liveBundleState);
  const mergedRecentCalls = syncRecentCallViewerState(
    live.recentCalls,
    mergePreferredPostCollections(live.recentCalls, cached.recentCalls)
  );
  return {
    ...live,
    marketCap: pickStableMarketCap(live.marketCap, cached.marketCap, mergedRecentCalls),
    liquidity: pickMergedMetric(live.liquidity, cached.liquidity, { positive: true }),
    volume24h: pickMergedMetric(live.volume24h, cached.volume24h, { positive: true }),
    holderCount: pickMergedMetric(live.holderCount, cached.holderCount, { positive: true }),
    largestHolderPct: pickMergedMetric(live.largestHolderPct, cached.largestHolderPct),
    top10HolderPct: pickMergedMetric(live.top10HolderPct, cached.top10HolderPct),
    deployerSupplyPct: pickMergedMetric(live.deployerSupplyPct, cached.deployerSupplyPct),
    bundledWalletCount: shouldKeepCachedBundleState
      ? cached.bundledWalletCount
      : pickMergedMetric(live.bundledWalletCount, cached.bundledWalletCount, { positive: true }),
    estimatedBundledSupplyPct: shouldKeepCachedBundleState
      ? cachedEstimatedBundledSupplyPct
      : pickMergedMetric(liveEstimatedBundledSupplyPct, cachedEstimatedBundledSupplyPct),
    tokenRiskScore: canReuseCachedIntelligence
      ? pickMergedMetric(live.tokenRiskScore, cached.tokenRiskScore)
      : live.tokenRiskScore ?? null,
    sentimentScore: pickMergedMetric(live.sentimentScore, cached.sentimentScore),
    radarScore: pickMergedMetric(live.radarScore, cached.radarScore),
    confidenceScore: canReuseCachedIntelligence
      ? pickMergedMetric(live.confidenceScore, cached.confidenceScore)
      : live.confidenceScore ?? null,
    hotAlphaScore: canReuseCachedIntelligence
      ? pickMergedMetric(live.hotAlphaScore, cached.hotAlphaScore)
      : live.hotAlphaScore ?? null,
    earlyRunnerScore: canReuseCachedIntelligence
      ? pickMergedMetric(live.earlyRunnerScore, cached.earlyRunnerScore)
      : live.earlyRunnerScore ?? null,
    highConvictionScore: canReuseCachedIntelligence
      ? pickMergedMetric(live.highConvictionScore, cached.highConvictionScore)
      : live.highConvictionScore ?? null,
    marketHealthScore: canReuseCachedIntelligence
      ? pickMergedMetric(live.marketHealthScore, cached.marketHealthScore)
      : live.marketHealthScore ?? null,
    setupQualityScore: canReuseCachedIntelligence
      ? pickMergedMetric(live.setupQualityScore, cached.setupQualityScore)
      : live.setupQualityScore ?? null,
    opportunityScore: canReuseCachedIntelligence
      ? pickMergedMetric(live.opportunityScore, cached.opportunityScore)
      : live.opportunityScore ?? null,
    dataReliabilityScore: canReuseCachedIntelligence
      ? pickMergedMetric(live.dataReliabilityScore, cached.dataReliabilityScore)
      : live.dataReliabilityScore ?? null,
    activityStatus: canReuseCachedIntelligence
      ? live.activityStatus ?? cached.activityStatus ?? null
      : live.activityStatus ?? null,
    activityStatusLabel: canReuseCachedIntelligence
      ? live.activityStatusLabel ?? cached.activityStatusLabel ?? null
      : live.activityStatusLabel ?? null,
    isTradable: canReuseCachedIntelligence ? live.isTradable || cached.isTradable : live.isTradable,
    bullishSignalsSuppressed: canReuseCachedIntelligence
      ? live.bullishSignalsSuppressed || cached.bullishSignalsSuppressed
      : live.bullishSignalsSuppressed,
    bundleRiskLabel: shouldKeepCachedBundleState
      ? cached.bundleRiskLabel ?? live.bundleRiskLabel
      : canReuseCachedIntelligence
      ? live.bundleRiskLabel ?? cached.bundleRiskLabel
      : live.bundleRiskLabel ?? null,
    bundleScanCompletedAt: shouldKeepCachedBundleState
      ? cached.bundleScanCompletedAt ?? live.bundleScanCompletedAt ?? null
      : live.bundleScanCompletedAt ?? cached.bundleScanCompletedAt ?? null,
    holderCountSource:
      hasResolvedHolderCount(live.holderCount, live.holderCountSource)
        ? live.holderCountSource ?? cached.holderCountSource
        : hasResolvedHolderCount(cached.holderCount, cached.holderCountSource)
          ? cached.holderCountSource
          : live.holderCountSource ?? cached.holderCountSource,
    topHolders: mergeTopHolderSnapshots(live.topHolders, cached.topHolders),
    devWallet: live.devWallet ? mergeHolderSnapshot(live.devWallet, cached.devWallet) : cached.devWallet,
    bundleClusters: shouldKeepCachedBundleState
      ? cached.bundleClusters
      : live.bundleClusters.length > 0
        ? live.bundleClusters
        : cached.bundleClusters,
    chart: live.chart.length > 1 ? live.chart : cached.chart,
    callsCount: live.callsCount > 0 ? live.callsCount : cached.callsCount,
    distinctTraders: live.distinctTraders > 0 ? live.distinctTraders : cached.distinctTraders,
    topTraders: live.topTraders.length > 0 ? live.topTraders : cached.topTraders,
    sentiment: liveSentimentHasSignals ? live.sentiment : cached.sentiment,
    risk: {
      tokenRiskScore: canReuseCachedIntelligence
        ? pickMergedMetric(live.risk.tokenRiskScore, cached.risk.tokenRiskScore)
        : live.risk.tokenRiskScore ?? null,
      bundleRiskLabel: shouldKeepCachedBundleState
        ? cached.risk.bundleRiskLabel ?? live.risk.bundleRiskLabel
        : canReuseCachedIntelligence
        ? live.risk.bundleRiskLabel ?? cached.risk.bundleRiskLabel
        : live.risk.bundleRiskLabel ?? null,
      largestHolderPct: pickMergedMetric(live.risk.largestHolderPct, cached.risk.largestHolderPct),
      top10HolderPct: pickMergedMetric(live.risk.top10HolderPct, cached.risk.top10HolderPct),
      bundledWalletCount: shouldKeepCachedBundleState
        ? cached.risk.bundledWalletCount
        : pickMergedMetric(live.risk.bundledWalletCount, cached.risk.bundledWalletCount, { positive: true }),
      estimatedBundledSupplyPct: shouldKeepCachedBundleState
        ? cachedEstimatedBundledSupplyPct ?? cached.risk.estimatedBundledSupplyPct
        : pickMergedMetric(
            liveEstimatedBundledSupplyPct ?? live.risk.estimatedBundledSupplyPct,
            cachedEstimatedBundledSupplyPct ?? cached.risk.estimatedBundledSupplyPct
          ),
      deployerSupplyPct: pickMergedMetric(live.risk.deployerSupplyPct, cached.risk.deployerSupplyPct),
      holderCount: pickMergedMetric(live.risk.holderCount, cached.risk.holderCount, { positive: true }),
      topHolders: mergeTopHolderSnapshots(live.risk.topHolders, cached.risk.topHolders),
      devWallet: live.risk.devWallet
        ? mergeHolderSnapshot(live.risk.devWallet, cached.risk.devWallet)
        : cached.risk.devWallet,
    },
    timeline: live.timeline.length > 0 ? live.timeline : cached.timeline,
    recentCalls: mergedRecentCalls,
  };
}

function getTokenIntelligenceRichnessFromPost(post: Post): number {
  return (
    Number(typeof post.confidenceScore === "number" && Number.isFinite(post.confidenceScore)) +
    Number(typeof post.hotAlphaScore === "number" && Number.isFinite(post.hotAlphaScore)) +
    Number(typeof post.earlyRunnerScore === "number" && Number.isFinite(post.earlyRunnerScore)) +
    Number(typeof post.highConvictionScore === "number" && Number.isFinite(post.highConvictionScore)) +
    Number(typeof post.marketHealthScore === "number" && Number.isFinite(post.marketHealthScore)) +
    Number(typeof post.setupQualityScore === "number" && Number.isFinite(post.setupQualityScore)) +
    Number(typeof post.opportunityScore === "number" && Number.isFinite(post.opportunityScore)) +
    Number(typeof post.dataReliabilityScore === "number" && Number.isFinite(post.dataReliabilityScore)) +
    Number(typeof post.sentimentScore === "number" && Number.isFinite(post.sentimentScore)) +
    Number(typeof post.tokenRiskScore === "number" && Number.isFinite(post.tokenRiskScore)) +
    Number(typeof post.liquidity === "number" && Number.isFinite(post.liquidity) && post.liquidity > 0) +
    Number(typeof post.volume24h === "number" && Number.isFinite(post.volume24h) && post.volume24h > 0) +
    Number(typeof post.holderCount === "number" && Number.isFinite(post.holderCount) && post.holderCount > 0) +
    Number(typeof post.largestHolderPct === "number" && Number.isFinite(post.largestHolderPct)) +
    Number(typeof post.top10HolderPct === "number" && Number.isFinite(post.top10HolderPct)) +
    Number(typeof post.bundledWalletCount === "number" && Number.isFinite(post.bundledWalletCount) && post.bundledWalletCount > 0) +
    Number(typeof resolveEstimatedBundledSupplyPct({
      estimatedBundledSupplyPct: post.estimatedBundledSupplyPct,
      bundleClusters: post.bundleClusters,
    }) === "number") +
    Number(hasResolvedBundleEvidence({
      bundleRiskLabel: post.bundleRiskLabel,
      bundleScanCompletedAt: post.bundleScanCompletedAt,
      bundledWalletCount: post.bundledWalletCount,
      estimatedBundledSupplyPct: post.estimatedBundledSupplyPct,
      bundleClusters: post.bundleClusters,
    }))
  );
}

function pickBestCachedTokenPost(posts: Post[] | null | undefined): Post | null {
  let best: Post | null = null;

  for (const candidate of posts ?? []) {
    if (!candidate?.id) continue;
    if (!best) {
      best = candidate;
      continue;
    }

    const candidateHasResolvedBundle = hasResolvedBundleEvidence({
      bundleRiskLabel: candidate.bundleRiskLabel,
      bundleScanCompletedAt: candidate.bundleScanCompletedAt,
      bundledWalletCount: candidate.bundledWalletCount,
      estimatedBundledSupplyPct: candidate.estimatedBundledSupplyPct,
      bundleClusters: candidate.bundleClusters,
    });
    const bestHasResolvedBundle = hasResolvedBundleEvidence({
      bundleRiskLabel: best.bundleRiskLabel,
      bundleScanCompletedAt: best.bundleScanCompletedAt,
      bundledWalletCount: best.bundledWalletCount,
      estimatedBundledSupplyPct: best.estimatedBundledSupplyPct,
      bundleClusters: best.bundleClusters,
    });

    if (candidateHasResolvedBundle !== bestHasResolvedBundle) {
      if (candidateHasResolvedBundle) {
        best = candidate;
      }
      continue;
    }

    const candidateVersion = parseTimestamp(
      candidate.lastIntelligenceAt ?? candidate.bundleScanCompletedAt ?? candidate.lastMcapUpdate ?? candidate.createdAt
    );
    const bestVersion = parseTimestamp(
      best.lastIntelligenceAt ?? best.bundleScanCompletedAt ?? best.lastMcapUpdate ?? best.createdAt
    );

    if (candidateVersion !== bestVersion) {
      if (candidateVersion > bestVersion) {
        best = candidate;
      }
      continue;
    }

    if (getTokenIntelligenceRichnessFromPost(candidate) > getTokenIntelligenceRichnessFromPost(best)) {
      best = candidate;
    }
  }

  return best;
}

function mergeTokenPageDataWithCachedPosts(
  current: TokenPageData,
  cachedPosts: Post[] | null | undefined
): TokenPageData {
  const mergedRecentCalls = syncRecentCallViewerState(
    current.recentCalls,
    mergePreferredPostCollections(current.recentCalls, cachedPosts)
  );
  const bestPost = pickBestCachedTokenPost(mergedRecentCalls);

  if (!bestPost) {
    return mergedRecentCalls === current.recentCalls
      ? current
      : {
          ...current,
          recentCalls: mergedRecentCalls,
        };
  }

  const currentIntelligenceVersion = getTokenIntelligenceVersion(current);
  const postIntelligenceVersion = parseTimestamp(
    bestPost.lastIntelligenceAt ?? bestPost.bundleScanCompletedAt ?? bestPost.lastMcapUpdate ?? bestPost.createdAt
  );
  const preferPostIntelligence = postIntelligenceVersion > 0 && postIntelligenceVersion >= currentIntelligenceVersion;
  const currentEstimatedBundledSupplyPct = resolveEstimatedBundledSupplyPct({
    estimatedBundledSupplyPct: current.estimatedBundledSupplyPct,
    bundleClusters: current.bundleClusters,
  });
  const postEstimatedBundledSupplyPct = resolveEstimatedBundledSupplyPct({
    estimatedBundledSupplyPct: bestPost.estimatedBundledSupplyPct,
    bundleClusters: bestPost.bundleClusters,
  });
  const currentBundleState = {
    bundleRiskLabel: current.bundleRiskLabel,
    bundleScanCompletedAt: current.bundleScanCompletedAt,
    bundledWalletCount: current.bundledWalletCount,
    estimatedBundledSupplyPct: currentEstimatedBundledSupplyPct,
    bundleClusters: current.bundleClusters,
  };
  const postBundleState = {
    bundleRiskLabel: bestPost.bundleRiskLabel,
    bundleScanCompletedAt: bestPost.bundleScanCompletedAt,
    bundledWalletCount: bestPost.bundledWalletCount,
    estimatedBundledSupplyPct: postEstimatedBundledSupplyPct,
    bundleClusters: bestPost.bundleClusters,
  };
  const shouldPreferPostBundleState =
    hasResolvedBundleEvidence(postBundleState) && isBundlePlaceholderState(currentBundleState);
  const nextBundleClusters =
    Array.isArray(bestPost.bundleClusters) &&
    bestPost.bundleClusters.length > 0 &&
    (shouldPreferPostBundleState || current.bundleClusters.length === 0)
      ? bestPost.bundleClusters
      : current.bundleClusters;
  const nextEstimatedBundledSupplyPct = shouldPreferPostBundleState
    ? postEstimatedBundledSupplyPct
    : pickMergedMetric(currentEstimatedBundledSupplyPct, postEstimatedBundledSupplyPct, preferPostIntelligence);
  const nextBundleRiskLabel = shouldPreferPostBundleState
    ? bestPost.bundleRiskLabel ?? current.bundleRiskLabel
    : current.bundleRiskLabel ?? bestPost.bundleRiskLabel ?? null;
  const nextBundleScanCompletedAt = shouldPreferPostBundleState
    ? bestPost.bundleScanCompletedAt ?? current.bundleScanCompletedAt ?? null
    : current.bundleScanCompletedAt ?? bestPost.bundleScanCompletedAt ?? null;
  const nextBundledWalletCount = shouldPreferPostBundleState
    ? bestPost.bundledWalletCount ?? current.bundledWalletCount ?? null
    : pickMergedMetric(current.bundledWalletCount, bestPost.bundledWalletCount, preferPostIntelligence, {
        positive: true,
      });
  const nextTokenRiskScore = shouldPreferPostBundleState
    ? pickMergedMetric(current.tokenRiskScore, bestPost.tokenRiskScore, true)
    : pickMergedMetric(current.tokenRiskScore, bestPost.tokenRiskScore, preferPostIntelligence);
  const nextLastIntelligenceAt =
    shouldPreferPostBundleState || preferPostIntelligence
      ? bestPost.lastIntelligenceAt ?? bestPost.bundleScanCompletedAt ?? current.lastIntelligenceAt ?? null
      : current.lastIntelligenceAt ?? bestPost.lastIntelligenceAt ?? bestPost.bundleScanCompletedAt ?? null;

  return {
    ...current,
    symbol: current.symbol ?? bestPost.tokenSymbol ?? null,
    name: current.name ?? bestPost.tokenName ?? null,
    imageUrl: current.imageUrl ?? bestPost.tokenImage ?? null,
    dexscreenerUrl: current.dexscreenerUrl ?? bestPost.dexscreenerUrl ?? null,
    liquidity: pickMergedMetric(current.liquidity, bestPost.liquidity, preferPostIntelligence, { positive: true }),
    volume24h: pickMergedMetric(current.volume24h, bestPost.volume24h, preferPostIntelligence, { positive: true }),
    holderCount: pickMergedMetric(current.holderCount, bestPost.holderCount, preferPostIntelligence, { positive: true }),
    largestHolderPct: pickMergedMetric(current.largestHolderPct, bestPost.largestHolderPct, preferPostIntelligence),
    top10HolderPct: pickMergedMetric(current.top10HolderPct, bestPost.top10HolderPct, preferPostIntelligence),
    bundledWalletCount: nextBundledWalletCount ?? null,
    estimatedBundledSupplyPct: nextEstimatedBundledSupplyPct ?? null,
    bundleRiskLabel: nextBundleRiskLabel,
    bundleScanCompletedAt: nextBundleScanCompletedAt,
    tokenRiskScore: nextTokenRiskScore ?? null,
    sentimentScore: pickMergedMetric(current.sentimentScore, bestPost.sentimentScore, preferPostIntelligence),
    confidenceScore: pickMergedMetric(current.confidenceScore, bestPost.confidenceScore, preferPostIntelligence),
    hotAlphaScore: pickMergedMetric(current.hotAlphaScore, bestPost.hotAlphaScore, preferPostIntelligence),
    earlyRunnerScore: pickMergedMetric(current.earlyRunnerScore, bestPost.earlyRunnerScore, preferPostIntelligence),
    highConvictionScore: pickMergedMetric(current.highConvictionScore, bestPost.highConvictionScore, preferPostIntelligence),
    marketHealthScore: pickMergedMetric(current.marketHealthScore, bestPost.marketHealthScore, preferPostIntelligence),
    setupQualityScore: pickMergedMetric(current.setupQualityScore, bestPost.setupQualityScore, preferPostIntelligence),
    opportunityScore: pickMergedMetric(current.opportunityScore, bestPost.opportunityScore, preferPostIntelligence),
    dataReliabilityScore: pickMergedMetric(current.dataReliabilityScore, bestPost.dataReliabilityScore, preferPostIntelligence),
    activityStatus: preferPostIntelligence ? bestPost.activityStatus ?? current.activityStatus ?? null : current.activityStatus ?? bestPost.activityStatus ?? null,
    activityStatusLabel: preferPostIntelligence ? bestPost.activityStatusLabel ?? current.activityStatusLabel ?? null : current.activityStatusLabel ?? bestPost.activityStatusLabel ?? null,
    isTradable: preferPostIntelligence ? bestPost.isTradable === true : current.isTradable,
    bullishSignalsSuppressed: preferPostIntelligence ? bestPost.bullishSignalsSuppressed === true : current.bullishSignalsSuppressed,
    lastIntelligenceAt: nextLastIntelligenceAt,
    bundleClusters: nextBundleClusters,
    risk: {
      ...current.risk,
      tokenRiskScore: nextTokenRiskScore ?? null,
      bundleRiskLabel: nextBundleRiskLabel,
      largestHolderPct: pickMergedMetric(current.risk.largestHolderPct, bestPost.largestHolderPct, preferPostIntelligence),
      top10HolderPct: pickMergedMetric(current.risk.top10HolderPct, bestPost.top10HolderPct, preferPostIntelligence),
      bundledWalletCount: nextBundledWalletCount ?? null,
      estimatedBundledSupplyPct: nextEstimatedBundledSupplyPct ?? null,
      holderCount: pickMergedMetric(current.risk.holderCount, bestPost.holderCount, preferPostIntelligence, {
        positive: true,
      }),
    },
    recentCalls: mergedRecentCalls,
  };
}

function mergeTokenPageDataWithLiveSnapshot(
  current: TokenPageData,
  live: TokenLiveData
): TokenPageData {
  const currentIntelligenceVersion = getTokenIntelligenceVersion(current);
  const liveIntelligenceVersion = getTokenIntelligenceVersion(live);
  const preferCurrentIntelligence =
    currentIntelligenceVersion > 0 && currentIntelligenceVersion > liveIntelligenceVersion;
  const holderCount = hasResolvedHolderCount(live.holderCount, live.holderCountSource)
    ? live.holderCount
    : hasResolvedHolderCount(current.holderCount, current.holderCountSource)
      ? current.holderCount
      : pickMergedMetric(live.holderCount, current.holderCount, { positive: true });
  const holderCountSource = hasResolvedHolderCount(live.holderCount, live.holderCountSource)
    ? live.holderCountSource ?? current.holderCountSource
    : hasResolvedHolderCount(current.holderCount, current.holderCountSource)
      ? current.holderCountSource
      : live.holderCountSource ?? current.holderCountSource;
  const largestHolderPct = pickMergedMetric(live.largestHolderPct, current.largestHolderPct);
  const top10HolderPct = pickMergedMetric(live.top10HolderPct, current.top10HolderPct);
  const deployerSupplyPct = pickMergedMetric(live.deployerSupplyPct, current.deployerSupplyPct);
  const bundledWalletCount = pickMergedMetric(live.bundledWalletCount, current.bundledWalletCount, { positive: true });
  const tokenRiskScore = pickMergedMetric(live.tokenRiskScore, current.tokenRiskScore);
  const liveEstimatedBundledSupplyPct = resolveEstimatedBundledSupplyPct({
    estimatedBundledSupplyPct: live.estimatedBundledSupplyPct,
    bundleClusters: live.bundleClusters,
  });
  const currentEstimatedBundledSupplyPct = resolveEstimatedBundledSupplyPct({
    estimatedBundledSupplyPct: current.estimatedBundledSupplyPct,
    bundleClusters: current.bundleClusters,
  });
  const liveBundleState = {
    bundleRiskLabel: live.bundleRiskLabel,
    bundleScanCompletedAt: live.bundleScanCompletedAt,
    bundledWalletCount: live.bundledWalletCount,
    estimatedBundledSupplyPct: liveEstimatedBundledSupplyPct,
    bundleClusters: live.bundleClusters,
  };
  const currentBundleState = {
    bundleRiskLabel: current.bundleRiskLabel,
    bundleScanCompletedAt: current.bundleScanCompletedAt,
    bundledWalletCount: current.bundledWalletCount,
    estimatedBundledSupplyPct: currentEstimatedBundledSupplyPct,
    bundleClusters: current.bundleClusters,
  };
  const shouldKeepCurrentBundleState =
    hasResolvedBundleEvidence(currentBundleState) && isBundlePlaceholderState(liveBundleState);
  const bundleRiskLabel = shouldKeepCurrentBundleState
    ? current.bundleRiskLabel
    : live.bundleRiskLabel ?? current.bundleRiskLabel;
  const topHolders = mergeTopHolderSnapshots(live.topHolders, current.topHolders);
  const devWallet = live.devWallet ? mergeHolderSnapshot(live.devWallet, current.devWallet) : current.devWallet;
  const bundleClusters = shouldKeepCurrentBundleState
    ? current.bundleClusters
    : live.bundleClusters.length > 0
      ? live.bundleClusters
      : current.bundleClusters;
  const estimatedBundledSupplyPct = shouldKeepCurrentBundleState
    ? currentEstimatedBundledSupplyPct
    : pickMergedMetric(liveEstimatedBundledSupplyPct, currentEstimatedBundledSupplyPct);
  const bundleScanCompletedAt = shouldKeepCurrentBundleState
    ? current.bundleScanCompletedAt ?? live.bundleScanCompletedAt ?? null
    : live.bundleScanCompletedAt ?? current.bundleScanCompletedAt ?? null;
  const lastIntelligenceAt = shouldKeepCurrentBundleState
    ? current.lastIntelligenceAt ?? live.lastIntelligenceAt ?? live.bundleScanCompletedAt ?? live.updatedAt ?? null
    : live.lastIntelligenceAt ?? live.bundleScanCompletedAt ?? live.updatedAt ?? current.lastIntelligenceAt ?? null;
  const marketCap = pickStableMarketCap(live.marketCap, current.marketCap, current.recentCalls);
  const sentiment = sanitizeSentimentView(live.sentiment, live.sentimentScore);

  return {
    ...current,
    symbol: live.symbol ?? current.symbol,
    name: live.name ?? current.name,
    imageUrl: live.imageUrl ?? current.imageUrl,
    dexscreenerUrl: live.dexscreenerUrl ?? current.dexscreenerUrl,
    pairAddress: live.pairAddress ?? current.pairAddress,
    marketCap,
    liquidity: pickMergedMetric(live.liquidity, current.liquidity, { positive: true }),
    volume24h: pickMergedMetric(live.volume24h, current.volume24h, { positive: true }),
    holderCount,
    holderCountSource,
    largestHolderPct,
    top10HolderPct,
    deployerSupplyPct,
    bundledWalletCount,
    estimatedBundledSupplyPct,
    bundleRiskLabel,
    bundleScanCompletedAt,
    lastIntelligenceAt,
    tokenRiskScore,
    sentimentScore: pickMergedMetric(live.sentimentScore, current.sentimentScore, preferCurrentIntelligence),
    confidenceScore: pickMergedMetric(live.confidenceScore, current.confidenceScore, preferCurrentIntelligence),
    hotAlphaScore: pickMergedMetric(live.hotAlphaScore, current.hotAlphaScore, preferCurrentIntelligence),
    earlyRunnerScore: pickMergedMetric(live.earlyRunnerScore, current.earlyRunnerScore, preferCurrentIntelligence),
    highConvictionScore: pickMergedMetric(
      live.highConvictionScore,
      current.highConvictionScore,
      preferCurrentIntelligence
    ),
    marketHealthScore: pickMergedMetric(live.marketHealthScore, current.marketHealthScore, preferCurrentIntelligence),
    setupQualityScore: pickMergedMetric(live.setupQualityScore, current.setupQualityScore, preferCurrentIntelligence),
    opportunityScore: pickMergedMetric(live.opportunityScore, current.opportunityScore, preferCurrentIntelligence),
    dataReliabilityScore: pickMergedMetric(
      live.dataReliabilityScore,
      current.dataReliabilityScore,
      preferCurrentIntelligence
    ),
    activityStatus: preferCurrentIntelligence
      ? current.activityStatus ?? live.activityStatus ?? null
      : live.activityStatus ?? current.activityStatus ?? null,
    activityStatusLabel: preferCurrentIntelligence
      ? current.activityStatusLabel ?? live.activityStatusLabel ?? null
      : live.activityStatusLabel ?? current.activityStatusLabel ?? null,
    isTradable: preferCurrentIntelligence ? current.isTradable : live.isTradable,
    bullishSignalsSuppressed: preferCurrentIntelligence
      ? current.bullishSignalsSuppressed
      : live.bullishSignalsSuppressed,
    sentiment,
    topHolders,
    devWallet,
    bundleClusters,
    risk: {
      ...current.risk,
      tokenRiskScore,
      bundleRiskLabel,
      largestHolderPct,
      top10HolderPct,
      bundledWalletCount: shouldKeepCurrentBundleState
        ? current.risk.bundledWalletCount
        : bundledWalletCount,
      estimatedBundledSupplyPct: shouldKeepCurrentBundleState
        ? currentEstimatedBundledSupplyPct ?? current.risk.estimatedBundledSupplyPct
        : estimatedBundledSupplyPct,
      deployerSupplyPct,
      holderCount,
      topHolders,
      devWallet,
    },
  };
}

const containerVariants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.07 } },
};

const sectionVariants = {
  hidden: { opacity: 0, y: 18 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.5, ease: [0.16, 1, 0.3, 1] } },
};

function ScoreRing({ value, size = 80 }: { value: number | null | undefined; size?: number }) {
  const radius = (size - 10) / 2;
  const circumference = 2 * Math.PI * radius;
  const pct =
    typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : 0;
  const offset = circumference - (pct / 100) * circumference;
  const color =
    pct >= 75 ? "#10b981" : pct >= 50 ? "#f59e0b" : pct >= 25 ? "#94a3b8" : "#475569";

  return (
    <svg
      width={size}
      height={size}
      style={{ transform: "rotate(-90deg)", display: "block" }}
    >
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        strokeWidth={6}
        fill="none"
        stroke="rgba(148,163,184,0.15)"
      />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        strokeWidth={6}
        fill="none"
        stroke={color}
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        strokeLinecap="round"
        style={{ transition: "stroke-dashoffset 1.2s cubic-bezier(0.16,1,0.3,1)" }}
      />
    </svg>
  );
}

function RiskBar({
  label,
  value,
  max = 100,
  danger = 30,
  warn = 15,
  pending = false,
  formatValue,
}: {
  label: string;
  value: number | null | undefined;
  max?: number;
  danger?: number;
  warn?: number;
  pending?: boolean;
  formatValue?: (value: number) => string;
}) {
  const pct =
    typeof value === "number" && Number.isFinite(value)
      ? Math.max(0, Math.min((value / max) * 100, 100))
      : 0;
  const realValue = typeof value === "number" && Number.isFinite(value) ? value : null;
  const barColor =
    realValue === null
      ? "bg-border/40"
      : realValue >= danger
      ? "bg-rose-500"
      : realValue >= warn
      ? "bg-amber-500"
      : "bg-emerald-500";

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-[11px]">
        <span className="font-medium uppercase tracking-[0.13em] text-muted-foreground">
          {label}
        </span>
        <span className="font-mono font-semibold text-foreground">
          {pending ? (
            <span className="text-primary">Scanning</span>
          ) : realValue !== null ? (
            formatValue ? formatValue(realValue) : `${realValue.toFixed(1)}%`
          ) : (
            "—"
          )}
        </span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-border/30">
        <div
          className={`h-full rounded-full transition-all duration-1000 ${barColor}`}
          style={{ width: pending ? "100%" : `${pct}%`, opacity: pending ? 0.35 : 1 }}
        />
      </div>
    </div>
  );
}

function SentimentSplit({
  bullishPct,
  bearishPct,
  sentimentScore,
}: {
  bullishPct: number | null | undefined;
  bearishPct: number | null | undefined;
  sentimentScore?: number | null | undefined;
}) {
  const { bullishPct: b, bearishPct: r } = resolveSentimentSplit({
    bullishPct,
    bearishPct,
    sentimentScore,
  });
  return (
    <div className="space-y-2">
      <div className="flex overflow-hidden rounded-full h-2.5 bg-border/30">
        <div
          className="h-full bg-emerald-500 transition-all duration-1000"
          style={{ width: `${b}%` }}
        />
        <div
          className="h-full bg-rose-500 transition-all duration-1000"
          style={{ width: `${r}%` }}
        />
      </div>
      <div className="flex justify-between text-[11px]">
        <span className="font-semibold text-emerald-500">{b.toFixed(0)}% Bullish</span>
        <span className="font-semibold text-rose-500">{r.toFixed(0)}% Bearish</span>
      </div>
    </div>
  );
}

function scoreTone(value: number | null | undefined): string {
  const score = typeof value === "number" && Number.isFinite(value) ? value : 0;
  if (score >= 75) return "text-gain";
  if (score >= 55) return "text-foreground";
  return "text-muted-foreground";
}

function activityTone(label: string | null | undefined): string {
  switch ((label ?? "").toLowerCase()) {
    case "active":
      return "border-gain/30 bg-gain/10 text-gain";
    case "warming":
      return "border-amber-400/35 bg-amber-400/10 text-amber-700 dark:text-amber-300";
    case "inactive":
      return "border-border/70 bg-secondary text-muted-foreground";
    case "dormant":
    case "untradable":
      return "border-loss/30 bg-loss/10 text-loss";
    default:
      return "border-border/70 bg-secondary text-muted-foreground";
  }
}

function riskTone(label: string | null | undefined): string {
  if (label === "Clean") return "border-gain/30 bg-gain/10 text-gain";
  if (label === "Moderate Bundling") return "border-amber-400/35 bg-amber-400/10 text-amber-600 dark:text-amber-300";
  return "border-loss/30 bg-loss/10 text-loss";
}

export default function TokenPage() {
  const { tokenAddress } = useParams<{ tokenAddress: string }>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const { data: session, canPerformAuthenticatedWrites } = useSession();
  const [communityEntryIntent, setCommunityEntryIntent] = useState<"create-community" | null>(null);
  const [communityEntryIntentToken, setCommunityEntryIntentToken] = useState(0);
  const viewerScope = session?.user?.id ?? "anonymous";
  const tokenQueryKey = useMemo(
    () => ["token-page", viewerScope, tokenAddress] as const,
    [tokenAddress, viewerScope]
  );
  const tokenCacheKey = useMemo(
    () => (tokenAddress ? `phew.token-page.v31:${viewerScope}:${tokenAddress}` : null),
    [tokenAddress, viewerScope]
  );
  const cachedTokenEntry = useMemo(
    () => (tokenCacheKey ? readSessionCacheEntry<TokenPageData>(tokenCacheKey, TOKEN_PAGE_CACHE_TTL_MS) : null),
    [tokenCacheKey]
  );
  const cachedToken = cachedTokenEntry?.data ?? null;
  const cachedPostsForToken = useMemo(
    () => getCachedPostsForToken(queryClient, tokenAddress ?? null),
    [queryClient, tokenAddress]
  );
  const cachedTokenWithPostIntelligence = useMemo(
    () => (cachedToken ? mergeTokenPageDataWithCachedPosts(cachedToken, cachedPostsForToken) : null),
    [cachedPostsForToken, cachedToken]
  );
  // Track last known valid token across query-key changes (e.g. auth loading changes viewerScope)
  const lastKnownTokenRef = useRef<TokenPageData | null>(null);
  const recentCallsRef = useRef<HTMLDivElement | null>(null);
  const [expandedClusters, setExpandedClusters] = useState<Set<string>>(new Set());
  const [pendingTradeCallId, setPendingTradeCallId] = useState<string | null>(null);
  const [pendingQuickBuyAmountSol, setPendingQuickBuyAmountSol] = useState<string | null>(null);
  const [chartInterval, setChartInterval] = useState<TokenChartIntervalValue>("5m");
  const [liveTradeSamples, setLiveTradeSamples] = useState<LiveTradeSample[]>([]);
  const [hasConsumedTradeDeepLink, setHasConsumedTradeDeepLink] = useState(false);
  const activeTokenTab = parseTokenPageTab(searchParams.get("tab"));

  useEffect(() => {
    setLiveTradeSamples([]);
  }, [tokenAddress]);

  const handleCopyTokenAddress = async () => {
    if (!token?.address) return;
    try {
      await navigator.clipboard.writeText(token.address);
      toast.success("Contract address copied");
    } catch {
      toast.error("Failed to copy contract address");
    }
  };

  const {
    data: tokenQueryData,
    isLoading,
    isFetching,
    error,
    refetch: refetchToken,
  } = useQuery({
    queryKey: tokenQueryKey,
    queryFn: async () => {
      if (!tokenAddress) throw new Error("Token address is required");
      const data = await api.get<TokenPageData>(`/api/tokens/${tokenAddress}`);
      const currentQueryData = queryClient.getQueryData<TokenPageData>(tokenQueryKey);
      const latestCachedToken =
        tokenCacheKey ? readSessionCacheEntry<TokenPageData>(tokenCacheKey, TOKEN_PAGE_CACHE_TTL_MS)?.data ?? null : null;
      return mergeTokenPageDataWithCachedPosts(
        mergeTokenPageDataWithCached(
          data,
          currentQueryData ??
            lastKnownTokenRef.current ??
            latestCachedToken ??
            cachedTokenWithPostIntelligence
        ),
        cachedPostsForToken
      );
    },
    initialData: cachedTokenWithPostIntelligence ?? undefined,
    initialDataUpdatedAt: cachedTokenEntry?.cachedAt,
    placeholderData: (previousData) => previousData,
    enabled: !!tokenAddress,
    staleTime: 45_000,
    gcTime: 8 * 60_000,
    refetchOnMount: "always",
    refetchOnWindowFocus: false,
    retry: 1,
    // The live token query handles high-frequency intelligence refreshes.
    refetchInterval: false,
    refetchIntervalInBackground: false,
  });

  // When query succeeds, persist to last-known-good so we can fall back on query-key transitions.
  if (tokenQueryData) {
    lastKnownTokenRef.current = tokenQueryData;
  }
  // Fall back to the last known good data when the current query errored but had valid data before
  // (e.g. when viewerScope changes from "anonymous" to userId and the user-scoped fetch fails).
  const tokenBase = tokenQueryData ?? (error ? (lastKnownTokenRef.current ?? undefined) : undefined);
  const token = useMemo(
    () => (tokenBase ? mergeTokenPageDataWithCachedPosts(tokenBase, cachedPostsForToken) : tokenBase),
    [cachedPostsForToken, tokenBase]
  );

  const bundleScanPending = token
    ? isBundleScanPending({
        bundleRiskLabel: token.risk.bundleRiskLabel,
        bundleScanCompletedAt: token.bundleScanCompletedAt,
        bundledWalletCount: token.risk.bundledWalletCount,
        estimatedBundledSupplyPct: token.risk.estimatedBundledSupplyPct,
        bundleClusters: token.bundleClusters,
      })
    : false;
  const mergedTopHolders = token
    ? mergeTopHolderSnapshots(token.topHolders, token.risk.topHolders ?? [])
    : [];
  const mergedDevWallet = token
    ? token.devWallet
      ? mergeHolderSnapshot(token.devWallet, token.risk.devWallet ?? undefined)
      : token.risk.devWallet ?? null
    : null;
  const resolvedBundledSupplyPct = token
    ? resolveEstimatedBundledSupplyPct({
        estimatedBundledSupplyPct: token.risk.estimatedBundledSupplyPct,
        bundleClusters: token.bundleClusters,
      })
    : null;
  const holderIntelligencePending = token
    ? isHolderIntelligencePending({
        chainType: token.chainType,
        topHolders: mergedTopHolders,
        holderCount: token.holderCount,
        holderCountSource: token.holderCountSource,
        devWallet: mergedDevWallet,
        bundleScanCompletedAt: token.bundleScanCompletedAt,
      })
    : false;
  const shouldForceFreshDistribution = Boolean(token && (bundleScanPending || holderIntelligencePending));

  const chartRequestConfig = useMemo(() => {
    switch (chartInterval) {
      case "1m":
        return { timeframe: "minute" as const, aggregate: 1, limit: 360 };
      case "5m":
        return { timeframe: "minute" as const, aggregate: 5, limit: 360 };
      case "15m":
        return { timeframe: "minute" as const, aggregate: 15, limit: 360 };
      case "1h":
        return { timeframe: "hour" as const, aggregate: 1, limit: 320 };
      case "4h":
        return { timeframe: "hour" as const, aggregate: 4, limit: 320 };
      case "1D":
      default:
        return { timeframe: "day" as const, aggregate: 1, limit: 260 };
    }
  }, [chartInterval]);
  const liveStreamRefreshIntervalMs =
    chartRequestConfig.timeframe === "minute"
      ? chartRequestConfig.aggregate <= 5
        ? 3_500
        : 5_000
      : chartRequestConfig.timeframe === "hour"
        ? 6_000
        : 8_000;
  const liveStreamCacheTtlMs = Math.max(
    1_500,
    chartRequestConfig.timeframe === "minute" && chartRequestConfig.aggregate <= 5 ? 2_750 : 4_000
  );

  const liveTokenQuery = useQuery<TokenLiveData>({
    queryKey: [
      "token-live",
      tokenAddress,
      shouldForceFreshDistribution ? "fresh-distribution" : "cached",
    ],
    enabled: Boolean(tokenAddress && token?.id),
    staleTime: 6_000,
    gcTime: 5 * 60_000,
    placeholderData: (previousData) => previousData,
    refetchOnWindowFocus: false,
    retry: 1,
    refetchIntervalInBackground: false,
    refetchInterval: shouldForceFreshDistribution
      ? Math.min(TOKEN_LIVE_PENDING_REFRESH_INTERVAL_MS, liveStreamRefreshIntervalMs)
      : Math.min(TOKEN_LIVE_RESOLVED_REFRESH_INTERVAL_MS, liveStreamRefreshIntervalMs),
    queryFn: async () => {
      if (!tokenAddress) throw new Error("Token address is required");
      return getTokenLiveIntelligence(tokenAddress, {
        freshBundle: shouldForceFreshDistribution,
        timeoutMs: shouldForceFreshDistribution ? 12_000 : 9_000,
        cacheTtlMs: liveStreamCacheTtlMs,
      }) as Promise<TokenLiveData>;
    },
  });

  useEffect(() => {
    if (!liveTokenQuery.data) return;
    queryClient.setQueryData<TokenPageData | undefined>(tokenQueryKey, (current) =>
      current ? mergeTokenPageDataWithLiveSnapshot(current, liveTokenQuery.data) : current
    );
    if (tokenAddress) {
      syncTokenIntelligenceAcrossPostCaches(
        queryClient,
        buildTokenIntelligenceSnapshotFromLivePayload(tokenAddress, liveTokenQuery.data)
      );
    }
  }, [liveTokenQuery.data, queryClient, tokenAddress, tokenQueryKey]);

  useEffect(() => {
    if (!tokenCacheKey || !isTokenPageDataCacheable(token)) return;
    writeSessionCache(tokenCacheKey, token);
  }, [token, tokenCacheKey]);

  useEffect(() => {
    if (!token) return;
    syncTokenIntelligenceAcrossPostCaches(queryClient, token);
  }, [queryClient, token]);

  const historicalChartQuery = useQuery<TokenChartPoint[]>({
    queryKey: ["token-chart-history", tokenAddress],
    enabled: Boolean(tokenAddress),
    staleTime: 45_000,
    gcTime: 8 * 60_000,
    placeholderData: (previousData) => previousData,
    refetchOnWindowFocus: false,
    retry: 1,
    queryFn: async () => {
      if (!tokenAddress) {
        return [];
      }
      return api.get<TokenChartPoint[]>(`/api/tokens/${tokenAddress}/chart`);
    },
  });

  const liveChartQuery = useQuery<TokenChartCandlesResponse>({
    queryKey: [
      "token-live-chart",
      tokenAddress,
      token?.pairAddress ?? null,
      chartRequestConfig.timeframe,
      chartRequestConfig.aggregate,
      chartRequestConfig.limit,
    ],
    enabled: Boolean(tokenAddress && token && (token.pairAddress || token.address)),
    staleTime: 4_000,
    gcTime: 8 * 60_000,
    placeholderData: (previousData) => previousData,
    refetchOnWindowFocus: false,
    retry: 1,
    refetchInterval:
      chartRequestConfig.timeframe === "minute"
        ? chartRequestConfig.aggregate <= 5
          ? 5_000
          : 8_000
        : chartRequestConfig.timeframe === "hour"
          ? 15_000
          : 45_000,
    queryFn: async () => {
      if (!tokenAddress || !token) {
        return {
          candles: [],
          source: "unknown" as const,
          network: null,
        };
      }

      const response = await api.raw("/api/posts/chart/candles", {
        method: "POST",
        cache: "no-store",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          poolAddress: token.pairAddress ?? undefined,
          tokenAddress: token.address,
          chainType: token.chainType === "solana" ? "solana" : "ethereum",
          timeframe: chartRequestConfig.timeframe,
          aggregate: chartRequestConfig.aggregate,
          limit: chartRequestConfig.limit,
        }),
      });

      if (!response.ok) {
        const payload = await response.text().catch(() => "");
        throw new Error(payload || `Chart request failed (${response.status})`);
      }

      const payload = (await response.json().catch(() => null)) as
        | {
            data?: {
              candles?: TokenChartCandle[];
              source?: string;
              network?: string | null;
            };
          }
        | null;
      const sourceRaw = payload?.data?.source;
      return {
        candles: Array.isArray(payload?.data?.candles) ? payload.data.candles : [],
        source: sourceRaw === "birdeye" || sourceRaw === "geckoterminal" ? sourceRaw : "unknown",
        network: typeof payload?.data?.network === "string" ? payload.data.network : null,
      };
    },
  });

  const liveTradeCount24h =
    (typeof liveTokenQuery.data?.buys24h === "number" ? liveTokenQuery.data.buys24h : 0) +
    (typeof liveTokenQuery.data?.sells24h === "number" ? liveTokenQuery.data.sells24h : 0);

  useEffect(() => {
    const nextPriceUsd = liveTokenQuery.data?.priceUsd;
    if (typeof nextPriceUsd !== "number" || !Number.isFinite(nextPriceUsd) || nextPriceUsd <= 0) {
      return;
    }

    const timestampMs =
      liveTokenQuery.data?.updatedAt && Number.isFinite(Date.parse(liveTokenQuery.data.updatedAt))
        ? Date.parse(liveTokenQuery.data.updatedAt)
        : Date.now();

    setLiveTradeSamples((current) =>
      appendLiveTradeSample(
        current,
        {
          timestamp: timestampMs,
          priceUsd: nextPriceUsd,
          volume24hUsd: liveTokenQuery.data?.volume24h ?? null,
          tradeCount24h: liveTradeCount24h,
        },
        720
      )
    );
  }, [
    liveChartQuery.data?.source,
    liveTokenQuery.data?.priceUsd,
    liveTokenQuery.data?.updatedAt,
    liveTokenQuery.data?.volume24h,
    liveTradeCount24h,
  ]);

  const chartData = useMemo(
    () => {
      const basePoints = [...(historicalChartQuery.data ?? token?.chart ?? [])]
        .filter((point) => point?.timestamp)
        .sort((left, right) => Date.parse(left.timestamp) - Date.parse(right.timestamp));

      const deduped = new Map<string, TokenChartPoint>();
      for (const point of basePoints) {
        deduped.set(point.timestamp, point);
      }

      const liveTimestamp =
        liveTokenQuery.data?.updatedAt && Number.isFinite(Date.parse(liveTokenQuery.data.updatedAt))
          ? new Date(Date.parse(liveTokenQuery.data.updatedAt)).toISOString()
          : null;
      if (
        liveTimestamp &&
        [
          liveTokenQuery.data?.marketCap,
          liveTokenQuery.data?.liquidity,
          liveTokenQuery.data?.volume24h,
          liveTokenQuery.data?.holderCount,
          liveTokenQuery.data?.confidenceScore,
        ].some((value) => typeof value === "number" && Number.isFinite(value) && value > 0)
      ) {
        deduped.set(liveTimestamp, {
          timestamp: liveTimestamp,
          marketCap: liveTokenQuery.data?.marketCap ?? null,
          liquidity: liveTokenQuery.data?.liquidity ?? null,
          volume24h: liveTokenQuery.data?.volume24h ?? null,
          holderCount: liveTokenQuery.data?.holderCount ?? null,
          sentimentScore: liveTokenQuery.data?.sentimentScore ?? null,
          confidenceScore: liveTokenQuery.data?.confidenceScore ?? null,
        });
      }

      return Array.from(deduped.values())
        .sort((left, right) => Date.parse(left.timestamp) - Date.parse(right.timestamp))
        .map((point) => ({
          ...point,
          ts: Date.parse(point.timestamp),
        }));
    },
    [
      historicalChartQuery.data,
      liveTokenQuery.data?.confidenceScore,
      liveTokenQuery.data?.holderCount,
      liveTokenQuery.data?.liquidity,
      liveTokenQuery.data?.marketCap,
      liveTokenQuery.data?.sentimentScore,
      liveTokenQuery.data?.updatedAt,
      liveTokenQuery.data?.volume24h,
      token?.chart,
    ]
  );

  const streamedChartCandles = useMemo(
    () =>
      mergeLiveSamplesIntoCandles(
        liveChartQuery.data?.candles ?? [],
        liveTradeSamples,
        getChartBucketMs(chartRequestConfig.timeframe, chartRequestConfig.aggregate)
      ),
    [chartRequestConfig.aggregate, chartRequestConfig.timeframe, liveChartQuery.data?.candles, liveTradeSamples]
  );

  const liveChartData = useMemo(
    () =>
      streamedChartCandles.map((candle) => ({
        ts: candle.timestamp,
        open: candle.open,
        high: candle.high,
        low: candle.low,
        close: candle.close,
        volume: candle.volume,
        isBullish: candle.close >= candle.open,
        label: new Date(candle.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        fullLabel: new Date(candle.timestamp).toLocaleString([], {
          month: "short",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        }),
      })),
    [streamedChartCandles]
  );

  const liveChartWindow = useMemo(() => {
    if (liveChartData.length === 0) {
      return { startIndex: 0, endIndex: -1 };
    }
    const visiblePoints = Math.min(TOKEN_LIVE_CHART_VISIBLE_POINTS, liveChartData.length);
    return {
      startIndex: Math.max(0, liveChartData.length - visiblePoints),
      endIndex: liveChartData.length - 1,
    };
  }, [liveChartData]);

  const recentCalls = useMemo(
    () =>
      syncRecentCallViewerState(
        token?.recentCalls ?? [],
        mergePreferredPostCollections(token?.recentCalls ?? [], cachedPostsForToken)
      ),
    [cachedPostsForToken, token?.recentCalls]
  );
  const displayLiveChartData = liveChartData;
  const displayTimeline = useMemo(
    () => mergeTimelineEvents(token?.timeline ?? [], deriveTimelineFromCalls(recentCalls)),
    [recentCalls, token?.timeline]
  );
  const displayTopTraders = useMemo(
    () => (token?.topTraders.length ? token.topTraders : deriveTopTradersFromCalls(recentCalls)),
    [recentCalls, token?.topTraders]
  );
  const recentCallsCount = Math.max(token?.callsCount ?? 0, recentCalls.length);
  const isRefreshingLive = isFetching || liveTokenQuery.isFetching;
  const liveMarketCap = liveTokenQuery.data?.marketCap ?? null;
  const livePriceChange24h = liveTokenQuery.data?.priceChange24hPct ?? null;
  const sentimentView = useMemo(
    () => sanitizeSentimentView(token?.sentiment, token?.sentimentScore),
    [token?.sentiment, token?.sentimentScore]
  );
  const isTokenApparentlyDead = Boolean(
    (typeof liveMarketCap === "number" && Number.isFinite(liveMarketCap) && liveMarketCap < 10_000) ||
    (typeof livePriceChange24h === "number" && Number.isFinite(livePriceChange24h) && livePriceChange24h < -85)
  );
  // Use the post's currentMcap when it's significantly lower than what the live endpoint reports.
  // GeckoTerminal/DexScreener can lag badly for dead/low-volume tokens.
  const displayMarketCap = (() => {
    return pickStableMarketCap(liveMarketCap ?? token?.marketCap ?? null, token?.marketCap ?? null, recentCalls);
  })();
  const shouldAutoOpenTradePanel = searchParams.get("trade") === "1";
  const setTokenTab = (tab: TokenPageTab) => {
    const next = new URLSearchParams(searchParams);
    if (tab === "trade") {
      next.delete("tab");
    } else {
      next.set("tab", tab);
    }
    setSearchParams(next, { replace: true });
  };
  const tokenTradeBridgePost = useMemo<Post | null>(() => {
    if (!token || token.chainType !== "solana") return null;
    return {
      id: `token-trade-bridge:${token.address}`,
      content: `Token-native trade lane for ${token.symbol ? `$${token.symbol}` : token.name || token.address}.`,
      authorId: "system:phew-router",
      author: {
        id: "system:phew-router",
        name: "Phew Router",
        username: "phewrouter",
        image: null,
        level: 10,
        xp: 0,
        isVerified: true,
      },
      contractAddress: token.address,
      chainType: token.chainType,
      tokenName: token.name,
      tokenSymbol: token.symbol,
      tokenImage: token.imageUrl,
      entryMcap: displayMarketCap,
      currentMcap: displayMarketCap,
      mcap1h: null,
      mcap6h: null,
      settled: false,
      settledAt: null,
      isWin: null,
      lastMcapUpdate: token.lastIntelligenceAt,
      lastIntelligenceAt: token.lastIntelligenceAt,
      trackingMode: "live",
      createdAt: token.lastIntelligenceAt ?? new Date().toISOString(),
      _count: {
        likes: 0,
        comments: 0,
        reposts: 0,
      },
      isLiked: false,
      isReposted: false,
      viewCount: 0,
      dexscreenerUrl: token.dexscreenerUrl,
      confidenceScore: token.confidenceScore,
      hotAlphaScore: token.hotAlphaScore,
      earlyRunnerScore: token.earlyRunnerScore,
      highConvictionScore: token.highConvictionScore,
      marketHealthScore: token.marketHealthScore,
      setupQualityScore: token.setupQualityScore,
      opportunityScore: token.opportunityScore,
      dataReliabilityScore: token.dataReliabilityScore,
      activityStatus: token.activityStatus,
      activityStatusLabel: token.activityStatusLabel,
      isTradable: token.isTradable,
      bullishSignalsSuppressed: token.bullishSignalsSuppressed,
      sentimentScore: token.sentimentScore,
      tokenRiskScore: token.tokenRiskScore,
      bundleRiskLabel: token.bundleRiskLabel,
      liquidity: token.liquidity,
      volume24h: token.volume24h,
      holderCount: token.holderCount,
      largestHolderPct: token.largestHolderPct,
      top10HolderPct: token.top10HolderPct,
      bundledWalletCount: token.bundledWalletCount,
      estimatedBundledSupplyPct: token.estimatedBundledSupplyPct,
      bundleClusters: token.bundleClusters,
      reactionCounts: token.sentiment?.reactions,
      threadCount: 0,
      radarReasons: token.earlyRunnerReasons ?? [],
    };
  }, [displayMarketCap, token]);
  const canTradeTokenDirectly = Boolean(tokenTradeBridgePost);
  const hasChartTelemetry = chartData.some(
    (point) =>
      [point.marketCap, point.liquidity, point.volume24h, point.holderCount].some(
        (value) => typeof value === "number" && Number.isFinite(value) && value > 0
      )
  );
  const hasLiveChartTelemetry = displayLiveChartData.length > 1;
  const liveChartPriceChangePct =
    displayLiveChartData.length > 1
      ? ((displayLiveChartData[displayLiveChartData.length - 1]!.close - displayLiveChartData[0]!.open) / displayLiveChartData[0]!.open) * 100
      : null;
  const chartHistorySpanMs =
    chartData.length > 1 ? Math.max(0, chartData[chartData.length - 1]!.ts - chartData[0]!.ts) : 0;
  const liveChartSourceLabel =
    liveChartQuery.data?.source === "birdeye"
      ? "Birdeye live + token stream"
      : liveChartQuery.data?.source === "geckoterminal"
        ? "GeckoTerminal live + token stream"
        : "Live chart + token stream";
  const canCreateTokenCommunity = Boolean(session?.user && (session.user.isAdmin || (session.user.level ?? 0) >= 3));
  const socialSignalsQuery = useQuery<TokenSocialSignals>({
    queryKey: ["token-social-signals", tokenAddress],
    enabled: Boolean(tokenAddress && activeTokenTab === "intel"),
    staleTime: 60_000,
    gcTime: 5 * 60_000,
    placeholderData: (previousData) => previousData,
    refetchOnWindowFocus: false,
    retry: 1,
    queryFn: async () => {
      if (!tokenAddress) throw new Error("Token address is required");
      return api.get<TokenSocialSignals>(`/api/tokens/${tokenAddress}/social-signals`);
    },
  });
  const socialSignals = socialSignalsQuery.data ?? null;
  const socialSignalQueries = useMemo(() => {
    const queries = socialSignals?.matchedQueries?.length
      ? socialSignals.matchedQueries
      : [
          token?.address ?? null,
          token?.symbol ? `$${token.symbol.replace(/^\$/, "")}` : null,
          token?.name ?? null,
        ];
    return [...new Set(queries.filter((value): value is string => Boolean(value && value.trim())))].slice(0, 3);
  }, [socialSignals?.matchedQueries, token?.address, token?.name, token?.symbol]);

  const followMutation = useMutation({
    mutationFn: async () => {
      if (!tokenAddress) throw new Error("Token address is required");
      if (!session?.user) throw new Error("Sign in to follow tokens");
      if (!canPerformAuthenticatedWrites) throw new Error("Signing you in...");
      if (token?.isFollowing) {
        return api.delete<{ following: boolean }>(`/api/tokens/${tokenAddress}/follow`);
      }
      return api.post<{ following: boolean }>(`/api/tokens/${tokenAddress}/follow`);
    },
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey: tokenQueryKey });
      const previousToken = queryClient.getQueryData<TokenPageData | undefined>(tokenQueryKey);
      if (previousToken) {
        queryClient.setQueryData<TokenPageData | undefined>(tokenQueryKey, {
          ...previousToken,
          isFollowing: !previousToken.isFollowing,
        });
      }
      return { previousToken };
    },
    onSuccess: (response) => {
      queryClient.setQueryData<TokenPageData | undefined>(tokenQueryKey, (current) =>
        current ? { ...current, isFollowing: response.following } : current
      );
      void queryClient.invalidateQueries({ queryKey: ["posts"] });
      void queryClient.invalidateQueries({ queryKey: ["token-community-room", tokenAddress] });
      void queryClient.invalidateQueries({ queryKey: ["token-community-active-raid", tokenAddress] });
      toast.success(response.following ? "Token followed" : "Token unfollowed");
    },
    onError: (_error, _variables, context) => {
      if (context?.previousToken) {
        queryClient.setQueryData(tokenQueryKey, context.previousToken);
      }
      toast.error(_error instanceof Error ? _error.message : "Failed to update token follow");
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: tokenQueryKey });
    },
  });

  const handleOpenTradePanel = () => {
    setTokenTab("trade");
    if (!tokenTradeBridgePost) {
      toast.info("Direct trading is currently available for Solana tokens only.");
      return;
    }
    setPendingQuickBuyAmountSol(null);
    setPendingTradeCallId(tokenTradeBridgePost.id);
    recentCallsRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  };

  const handleQuickBuyPreset = (amount: string) => {
    setTokenTab("trade");
    if (!tokenTradeBridgePost) {
      toast.info("Direct trading is currently available for Solana tokens only.");
      return;
    }
    setPendingQuickBuyAmountSol(amount);
    setPendingTradeCallId(tokenTradeBridgePost.id);
    recentCallsRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  };

  const handleCommunityAction = () => {
    if (!token) return;
    setTokenTab("community");
    if (!token.communityExists) {
      setCommunityEntryIntent("create-community");
      setCommunityEntryIntentToken((current) => current + 1);
      document.getElementById("token-community-room")?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
      return;
    }
    followMutation.mutate();
  };

  useEffect(() => {
    if (!shouldAutoOpenTradePanel || hasConsumedTradeDeepLink || !tokenTradeBridgePost) return;
    setTokenTab("trade");
    setPendingTradeCallId(tokenTradeBridgePost.id);
    setHasConsumedTradeDeepLink(true);
    recentCallsRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  }, [hasConsumedTradeDeepLink, shouldAutoOpenTradePanel, tokenTradeBridgePost]);

  const showTokenLoading = !token && isLoading;
  const topHolders = mergedTopHolders;
  const topHolderRows = topHolders.slice(0, 10);
  const hasLiveHolderDistribution = topHolderRows.length > 0;
  const topHolderSectionCopy = holderIntelligencePending
    ? "Scanning top wallets and role tags for this token."
    : "Top wallets and role tags from the latest chain scan.";
  const recentCallsEmptyCopy =
    isLoading || isFetching
      ? "Recent token calls are still loading for this address."
      : "No recent calls are available for this token yet.";

  return (
    <div className="min-h-screen bg-background">
      <header className="app-topbar">
        <div className="mx-auto flex h-[4.4rem] max-w-[980px] items-center justify-between gap-3 px-4 sm:px-5">
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="icon"
              className="h-10 w-10 rounded-2xl border border-border/60 bg-white/60 shadow-[0_18px_34px_-28px_hsl(var(--foreground)/0.18)] dark:border-white/[0.08] dark:bg-white/[0.04] dark:shadow-none"
              onClick={() => navigate(-1)}
            >
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <div>
              <div className="text-[10px] font-black uppercase tracking-[0.22em] text-primary/80">Phew Ultra</div>
              <h1 className="font-semibold text-lg">Token Lab</h1>
            </div>
          </div>
          {isRefreshingLive ? (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-primary/25 bg-primary/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-primary">
              <Activity className="h-3 w-3 animate-pulse" />
              Live
            </span>
          ) : token ? (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-border/50 bg-secondary px-3 py-1 text-[11px] text-muted-foreground">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
              Intelligence ready
            </span>
          ) : null}
        </div>
      </header>

      <main className="mx-auto max-w-[980px] px-4 pb-12 pt-5 sm:px-5">
        {showTokenLoading ? (
          <TokenScanningState
            address={tokenAddress}
            title="Opening Phew Ultra Token Lab"
            subtitle="We are mapping liquidity, community sentiment, holder concentration, bundle risk, and conviction signals for this token."
          />
        ) : !token ? (
          <div className="app-empty-state min-h-[360px]">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-destructive/10">
              <AlertCircle className="h-8 w-8 text-destructive" />
            </div>
            {error && !(error instanceof ApiError && error.status === 404) ? (
              <>
                <p className="text-lg font-semibold text-foreground">Failed to load token</p>
                <p className="text-sm text-muted-foreground">
                  {error instanceof TimeoutError
                    ? "The request timed out. Please try again."
                    : "Something went wrong loading this token. Please try again."}
                </p>
                <button
                  onClick={() => void refetchToken()}
                  className="mt-2 rounded-lg border border-border px-4 py-2 text-sm text-muted-foreground hover:bg-muted/50 transition-colors"
                >
                  Try again
                </button>
              </>
            ) : (
              <>
                <p className="text-lg font-semibold text-foreground">Token not found</p>
                <p className="text-sm text-muted-foreground">
                  We could not load token intelligence for this address.
                </p>
              </>
            )}
          </div>
        ) : (
          <motion.div
            className="space-y-5"
            variants={containerVariants}
            initial="hidden"
            animate="visible"
          >
            {/* ── SECTION 1: HERO ── */}
            <motion.section variants={sectionVariants} className="overflow-hidden rounded-[28px] border border-border/60 bg-[linear-gradient(160deg,rgba(255,255,255,0.96),rgba(243,249,245,0.97))] shadow-[0_32px_80px_-40px_hsl(var(--primary)/0.18)] dark:bg-[radial-gradient(ellipse_at_top_left,rgba(16,185,129,0.11),transparent_48%),linear-gradient(180deg,rgba(10,16,24,0.98),rgba(5,10,16,0.99))] dark:shadow-none">
              {token.communityBannerUrl ? (
                <div className="relative h-28 border-b border-border/60 sm:h-36 lg:h-40">
                  <div
                    className="absolute inset-0 bg-cover bg-center"
                    style={{ backgroundImage: `url("${token.communityBannerUrl}")` }}
                    aria-hidden="true"
                  />
                  <div
                    className="absolute inset-0 bg-[linear-gradient(180deg,rgba(3,7,18,0.14),rgba(3,7,18,0.62)),linear-gradient(135deg,rgba(5,150,105,0.12),rgba(15,23,42,0.2))]"
                    aria-hidden="true"
                  />
                  <div className="absolute inset-x-0 bottom-0 h-16 bg-[linear-gradient(180deg,rgba(2,6,23,0),rgba(2,6,23,0.72))]" aria-hidden="true" />
                  <div className="relative flex h-full items-end px-5 pb-4 sm:px-7">
                    <div className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-black/35 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-white/90 backdrop-blur-md">
                      <Users className="h-3 w-3" />
                      Community Room
                    </div>
                  </div>
                </div>
              ) : null}
              {/* Top stripe: identity */}
              <div className="flex flex-col gap-6 p-5 sm:p-7 lg:flex-row lg:items-start lg:justify-between">
                {/* Left: image + name + address */}
                <div className="flex min-w-0 items-start gap-4">
                  <div className="relative shrink-0">
                    <div className="flex h-[72px] w-[72px] items-center justify-center overflow-hidden rounded-full border-2 border-primary/30 bg-secondary shadow-[0_0_32px_rgba(16,185,129,0.28)]">
                      {token.imageUrl ? (
                        <img src={token.imageUrl} alt={token.symbol ?? "Token"} className="h-full w-full object-cover" />
                      ) : (
                        <Coins className="h-8 w-8 text-primary" />
                      )}
                    </div>
                    <span className="absolute -bottom-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full border-2 border-background bg-emerald-500">
                      <span className="h-1.5 w-1.5 rounded-full bg-white" />
                    </span>
                  </div>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-3xl font-black tracking-tight text-foreground">
                        {token.symbol || token.address.slice(0, 6)}
                      </h2>
                      {token.name && token.name !== token.symbol ? (
                        <span className="text-base font-medium text-muted-foreground">{token.name}</span>
                      ) : null}
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      <span className={cn("rounded-full border px-2.5 py-0.5 text-[11px] font-semibold",
                        bundleScanPending ? "border-primary/25 bg-primary/10 text-primary" : riskTone(token.bundleRiskLabel)
                      )}>
                        {bundleScanPending ? (
                          <span className="flex items-center gap-1"><Loader2 className="h-2.5 w-2.5 animate-spin" />Scanning</span>
                        ) : (token.bundleRiskLabel || "Unknown Risk")}
                      </span>
                      {token.isEarlyRunner ? (
                        <span className="rounded-full border border-amber-400/40 bg-amber-400/10 px-2.5 py-0.5 text-[11px] font-semibold text-amber-600 dark:text-amber-300">
                          ⚡ Early Runner
                        </span>
                      ) : null}
                      <span className="rounded-full border border-border/50 bg-secondary px-2.5 py-0.5 text-[11px] font-mono text-muted-foreground uppercase tracking-wider">
                        {token.chainType}
                      </span>
                    </div>
                    <div className="mt-2 flex items-center gap-1.5">
                      <span className="font-mono text-[11px] text-muted-foreground">{token.address.slice(0, 6)}…{token.address.slice(-4)}</span>
                      <button
                        onClick={handleCopyTokenAddress}
                        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-border/60 bg-secondary text-muted-foreground transition-colors hover:text-foreground"
                        aria-label="Copy address"
                      >
                        <Copy className="h-3 w-3" />
                      </button>
                    </div>
                    {token.earlyRunnerReasons?.length ? (
                      <div className="mt-3 flex flex-wrap gap-1.5">
                        {token.earlyRunnerReasons.map((reason) => (
                          <span key={reason} className="rounded-full border border-border/50 bg-secondary/60 px-2.5 py-0.5 text-[10px] text-muted-foreground">
                            {reason}
                          </span>
                        ))}
                      </div>
                    ) : null}
                  </div>
                </div>

                {/* Right: action buttons */}
                <div className="flex shrink-0 flex-wrap items-center gap-2 lg:flex-col lg:items-end">
                  <Button
                    onClick={handleOpenTradePanel}
                    disabled={!canTradeTokenDirectly}
                    className="h-10 gap-2 rounded-full border border-primary/35 bg-[linear-gradient(135deg,hsl(var(--primary)/0.98),rgba(52,211,153,0.9))] px-5 text-sm font-semibold text-slate-950 shadow-[0_16px_40px_-16px_hsl(var(--primary)/0.55)] hover:brightness-[1.04] disabled:opacity-50"
                  >
                    <PhewTradeIcon className="h-3.5 w-3.5" />
                    Trade
                  </Button>
                  <Button
                    variant={token.isFollowing ? "outline" : "outline"}
                    onClick={handleCommunityAction}
                    disabled={followMutation.isPending || (!token.communityExists && !canCreateTokenCommunity)}
                    className={cn("h-10 rounded-full px-5 text-sm font-semibold transition-all",
                      token.communityExists && token.isFollowing
                        ? "border-primary/30 bg-primary/8 text-primary hover:bg-primary/12"
                        : !token.communityExists
                          ? "border-amber-300/40 bg-amber-400/10 text-amber-700 hover:border-amber-300/60 dark:text-amber-300"
                          : "border-border/60 bg-secondary hover:border-primary/30"
                    )}
                  >
                    {followMutation.isPending ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : !token.communityExists ? (
                      canCreateTokenCommunity ? "Create Community" : "Community Not Open Yet"
                    ) : token.isFollowing ? (
                      "Joined"
                    ) : (
                      "Join Community"
                    )}
                  </Button>
                  <a
                    href={token.dexscreenerUrl ?? `https://dexscreener.com/${token.chainType === "solana" ? "solana" : "ethereum"}/${token.address}`}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex h-10 items-center gap-2 rounded-full border border-border/60 bg-secondary px-4 text-xs font-semibold text-muted-foreground transition-colors hover:text-foreground"
                  >
                    Dexscreener
                    <ExternalLink className="h-3 w-3" />
                  </a>
                </div>
              </div>

              {/* Bottom stripe: live market stats */}
              <div className="grid grid-cols-3 gap-px border-t border-border/40 bg-border/40">
                {[
                  { label: "Market Cap", value: formatMarketMetric(displayMarketCap), highlight: true },
                  { label: "Liquidity", value: formatMarketMetric(token.liquidity), highlight: false },
                  { label: "Volume 24h", value: formatMarketMetric(token.volume24h), highlight: false },
                ].map((stat) => (
                  <div key={stat.label} className="bg-[rgba(255,255,255,0.7)] px-5 py-4 dark:bg-[rgba(10,16,24,0.9)]">
                    <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">{stat.label}</div>
                    <div className={cn("mt-1.5 text-xl font-bold tabular-nums", stat.highlight ? "text-primary" : "text-foreground")}>
                      {stat.value}
                    </div>
                  </div>
                ))}
              </div>
            </motion.section>

            {/* ── SECTION 2: SCORE RINGS ── */}
            <motion.section variants={sectionVariants}>
              <div className="rounded-[24px] border border-border/60 bg-card/90 p-2 shadow-[0_20px_44px_-34px_hsl(var(--foreground)/0.22)] dark:shadow-none">
                <div className="grid grid-cols-3 gap-2">
                  {([
                    { value: "trade", label: "Trade", hint: "Chart, quick buy, recent calls", icon: Coins },
                    {
                      value: "community",
                      label: "Community",
                      hint: token.communityExists ? "Room, raids, threads" : "Create or join the room",
                      icon: Users,
                    },
                    { value: "intel", label: "Intel", hint: "Signals, holders, external X", icon: ShieldCheck },
                  ] as const).map((tab) => {
                    const Icon = tab.icon;
                    const active = activeTokenTab === tab.value;
                    return (
                      <button
                        key={tab.value}
                        type="button"
                        onClick={() => setTokenTab(tab.value)}
                        className={cn(
                          "rounded-[20px] border px-4 py-3 text-left transition-all",
                          active
                            ? "border-primary/35 bg-[linear-gradient(135deg,hsl(var(--primary)/0.16),rgba(52,211,153,0.1))] shadow-[0_18px_38px_-30px_hsl(var(--primary)/0.5)]"
                            : "border-transparent bg-secondary/70 hover:border-border/60 hover:bg-secondary"
                        )}
                      >
                        <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                          <Icon className={cn("h-4 w-4", active ? "text-primary" : "text-muted-foreground")} />
                          {tab.label}
                        </div>
                        <div className="mt-1 text-xs text-muted-foreground">{tab.hint}</div>
                      </button>
                    );
                  })}
                </div>
              </div>
            </motion.section>
            {activeTokenTab === "intel" ? (
            <motion.section variants={sectionVariants}>
              <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-foreground">AI state</div>
                  <p className="text-xs text-muted-foreground">
                    Market Health checks whether the token is alive now, Setup Quality measures structure, Opportunity Now combines freshness and live activity, and Confidence reflects signal reliability.
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className={cn("rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.12em]", activityTone(token.activityStatusLabel))}>
                    {token.activityStatusLabel ?? "Monitoring"}
                  </span>
                  {token.bullishSignalsSuppressed ? (
                    <span className="rounded-full border border-loss/30 bg-loss/10 px-3 py-1 text-[11px] font-semibold text-loss">
                      Bullish signals suppressed
                    </span>
                  ) : null}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {[
                  { label: "Market Health", value: token.marketHealthScore, icon: <Activity className="h-3.5 w-3.5" />, desc: "Liquidity, volume, trades" },
                  { label: "Setup Quality", value: token.setupQualityScore, icon: <ShieldCheck className="h-3.5 w-3.5" />, desc: "Structure and holder quality" },
                  { label: "Opportunity Now", value: token.opportunityScore, icon: <Flame className="h-3.5 w-3.5" />, desc: "Current setup after decay" },
                  { label: "Confidence", value: token.confidenceScore, icon: <Target className="h-3.5 w-3.5" />, desc: "Signal reliability" },
                ].map((s) => {
                  const raw = typeof s.value === "number" && Number.isFinite(s.value) ? s.value : null;
                  const pct = raw !== null ? Math.max(0, Math.min(raw, 100)) : null;
                  const color = pct !== null && pct >= 75 ? "text-emerald-500" : pct !== null && pct >= 50 ? "text-amber-500" : "text-muted-foreground";
                  return (
                    <div key={s.label} className="relative overflow-hidden rounded-[22px] border p-4 border-border/60 bg-[linear-gradient(180deg,rgba(255,255,255,0.85),rgba(248,248,248,0.9))] shadow-[inset_0_1px_0_rgba(255,255,255,0.8)] dark:bg-[linear-gradient(180deg,rgba(15,20,30,0.96),rgba(8,12,20,0.98))] dark:shadow-none">
                      <div className="flex items-start justify-between">
                        <div className="space-y-1">
                          <div className="flex items-center gap-1.5 text-muted-foreground">{s.icon}<span className="text-[10px] font-semibold uppercase tracking-[0.15em]">{s.label}</span></div>
                          <div className={cn("text-3xl font-black tabular-nums", color)}>
                            {pct !== null ? `${pct.toFixed(0)}` : "—"}
                            {pct !== null ? <span className="text-lg font-semibold opacity-70">%</span> : null}
                          </div>
                          <div className="text-[10px] text-muted-foreground">{s.desc}</div>
                        </div>
                        <div className="shrink-0 opacity-80">
                          <ScoreRing value={pct} size={56} />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="mt-3 flex flex-wrap gap-2 text-xs text-muted-foreground">
                {token.bullishSignalsSuppressed ? (
                  <span className="rounded-full border border-border/60 bg-secondary px-3 py-1">
                    Hot Alpha / Early Runner / High Conviction stay capped until the token is active and tradable again.
                  </span>
                ) : (
                  <>
                    {typeof token.hotAlphaScore === "number" && token.hotAlphaScore >= 55 ? (
                      <span className="rounded-full border border-border/60 bg-secondary px-3 py-1">Hot Alpha {token.hotAlphaScore.toFixed(0)}</span>
                    ) : null}
                    {typeof token.earlyRunnerScore === "number" && token.earlyRunnerScore >= 55 ? (
                      <span className="rounded-full border border-border/60 bg-secondary px-3 py-1">Early Runner {token.earlyRunnerScore.toFixed(0)}</span>
                    ) : null}
                    {typeof token.highConvictionScore === "number" && token.highConvictionScore >= 55 ? (
                      <span className="rounded-full border border-border/60 bg-secondary px-3 py-1">High Conviction {token.highConvictionScore.toFixed(0)}</span>
                    ) : null}
                  </>
                )}
              </div>
            </motion.section>
            ) : null}

            {/* ── SECTION 3: CHART + QUICK BUY ── */}
            {activeTokenTab === "trade" ? (
            <motion.section variants={sectionVariants} className="grid gap-5 lg:items-start lg:grid-cols-[1fr_270px]">
              <div className="app-surface p-5 sm:p-6">
                <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <BarChart3 className="h-4 w-4 text-primary" />
                      <h3 className="text-base font-semibold text-foreground">Live price chart</h3>
                      {typeof liveChartPriceChangePct === "number" && Number.isFinite(liveChartPriceChangePct) ? (
                        <span className={cn("rounded-full border px-2 py-0.5 text-[11px] font-bold",
                          liveChartPriceChangePct >= 0 ? "border-gain/25 bg-gain/10 text-gain" : "border-loss/25 bg-loss/10 text-loss"
                        )}>
                          {liveChartPriceChangePct >= 0 ? "+" : ""}{liveChartPriceChangePct.toFixed(2)}%
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {hasLiveChartTelemetry ? liveChartSourceLabel : hasChartTelemetry ? `${chartData.length} snapshot points` : "Awaiting market data"}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                  {TOKEN_CHART_INTERVAL_OPTIONS.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => setChartInterval(option.value)}
                      className={cn(
                        "h-7 rounded-lg px-3 text-[11px] font-semibold transition-all",
                        chartInterval === option.value
                          ? "bg-primary text-slate-950 shadow-[0_4px_14px_-4px_hsl(var(--primary)/0.5)]"
                          : "border border-border/60 bg-secondary text-muted-foreground hover:text-foreground"
                      )}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
                </div>
                {/* Chart area */}
                <div className="mt-4 space-y-4">
                  {hasLiveChartTelemetry || hasChartTelemetry ? (
                    <Suspense
                      fallback={
                        <div className="flex h-[340px] items-center justify-center rounded-[24px] border border-border/60 bg-white/50 shadow-[inset_0_1px_0_hsl(0_0%_100%/0.68)] dark:bg-white/[0.03] dark:shadow-none">
                          <div className="flex flex-col items-center gap-2 text-center">
                            <Loader2 className="h-5 w-5 animate-spin text-primary" />
                            <div className="text-sm font-medium text-foreground">
                              Loading market charts
                            </div>
                          </div>
                        </div>
                      }
                    >
                      <TokenTelemetryCharts
                        hasLiveChartTelemetry={hasLiveChartTelemetry}
                        hasChartTelemetry={hasChartTelemetry}
                        displayLiveChartData={displayLiveChartData}
                        liveChartWindow={liveChartWindow}
                        liveChartFutureSlotCount={TOKEN_LIVE_CHART_FUTURE_SLOTS}
                        chartData={chartData}
                        chartDataPointCount={chartData.length}
                        formatTokenPrice={formatTokenPrice}
                        formatLiveTick={(timestampMs) =>
                          new Date(timestampMs).toLocaleTimeString([], {
                            ...(chartRequestConfig.timeframe === "day"
                              ? ({ month: "short", day: "numeric" } as const)
                              : ({ hour: "2-digit", minute: "2-digit" } as const)),
                          })
                        }
                        formatTimelineTick={(timestampMs) =>
                          formatChartTimelineTick(timestampMs, chartHistorySpanMs)
                        }
                        formatTimelineTooltip={formatChartTimelineTooltip}
                      />
                    </Suspense>
                  ) : (
                    <div className="flex h-[340px] items-center justify-center rounded-[24px] border border-dashed border-primary/25 bg-gradient-to-br from-primary/8 via-transparent to-cyan-400/6 px-6 text-center">
                      <div className="max-w-md space-y-3">
                        <div className="inline-flex h-12 w-12 items-center justify-center rounded-full border border-primary/30 bg-primary/10 text-primary">
                          <Loader2 className="h-5 w-5 animate-spin" />
                        </div>
                        <div className="space-y-1">
                          <div className="text-base font-semibold text-foreground">Scanning token telemetry</div>
                          <p className="text-sm text-muted-foreground">
                            We are pulling the live price route, market cap snapshots, liquidity flow, holder distribution, and sentiment inputs for this token.
                          </p>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Quick buy sidebar */}
              <div className="space-y-4">
                <div className="app-surface p-5">
                  <div className="mb-3 flex items-center gap-2">
                    <Zap className="h-4 w-4 text-primary" />
                    <div className="text-sm font-semibold text-foreground">Quick buy</div>
                  </div>
                  <div className="mt-4 grid grid-cols-2 gap-2">
                    {TOKEN_QUICK_BUY_PRESETS.map((amount) => (
                      <Button
                        key={amount}
                        type="button"
                        variant="outline"
                        onClick={() => handleQuickBuyPreset(amount)}
                        disabled={!canTradeTokenDirectly}
                        className="h-11 rounded-[18px] border-primary/20 bg-white/70 text-sm font-semibold text-foreground hover:border-primary/35 hover:bg-primary/8 dark:bg-white/[0.03]"
                      >
                        {amount} SOL
                      </Button>
                    ))}
                  </div>
                  <Button
                    type="button"
                    onClick={handleOpenTradePanel}
                    disabled={!canTradeTokenDirectly}
                    className="mt-3 h-11 w-full rounded-[18px] border border-primary/25 bg-[linear-gradient(135deg,hsl(var(--primary)/0.95),rgba(52,211,153,0.88))] text-sm font-semibold text-slate-950 shadow-[0_18px_36px_-26px_hsl(var(--primary)/0.48)] hover:brightness-[1.03] disabled:opacity-60"
                  >
                    Open full trade panel
                  </Button>
                </div>

                <div className="app-surface p-5">
                  <div className="text-sm font-semibold text-foreground">Live route</div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {hasLiveChartTelemetry
                      ? `${liveChartSourceLabel} is updating this panel in real time.`
                      : "Live candles will appear here as soon as market route data is available."}
                  </div>
                  <div className="mt-4 space-y-2 text-xs text-muted-foreground">
                    <div className="flex items-center justify-between rounded-[16px] border border-border/60 bg-secondary px-3 py-2">
                      <span>Current MCAP</span>
                      <span className="font-semibold text-foreground">{formatMarketMetric(displayMarketCap)}</span>
                    </div>
                    <div className="flex items-center justify-between rounded-[16px] border border-border/60 bg-secondary px-3 py-2">
                      <span>Current liquidity</span>
                      <span className="font-semibold text-foreground">{formatMarketMetric(token.liquidity)}</span>
                    </div>
                    <div className="flex items-center justify-between rounded-[16px] border border-border/60 bg-secondary px-3 py-2">
                      <span>24h volume</span>
                      <span className="font-semibold text-foreground">{formatMarketMetric(token.volume24h)}</span>
                    </div>
                    <div className="flex items-center justify-between rounded-[16px] border border-border/60 bg-secondary px-3 py-2">
                      <span>Confidence</span>
                      <span className={cn("font-semibold", scoreTone(token.confidenceScore))}>
                        {typeof token.confidenceScore === "number" ? `${token.confidenceScore.toFixed(0)}%` : "N/A"}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </motion.section>
            ) : null}

            {/* ── SECTION 4: RISK + HOLDERS ── */}
            {activeTokenTab === "intel" ? (
            <>
            <motion.section variants={sectionVariants} className="grid gap-5 lg:items-start lg:grid-cols-[1fr_1fr]">
              <div className="app-surface p-5">
                <div className="mb-4 flex items-center gap-2">
                  <ShieldAlert className="h-4 w-4 text-primary" />
                  <h3 className="text-base font-semibold text-foreground">Risk panel</h3>
                </div>
                <div className="space-y-3">
                  <RiskBar label="Largest holder" value={token.risk.largestHolderPct ?? 0} max={100} danger={30} warn={15} />
                  <RiskBar label="Top 10 holders" value={token.risk.top10HolderPct ?? 0} max={100} danger={60} warn={35} />
                  {bundleScanPending ? (
                    <div className="space-y-3">
                      <BundleScanLoop title="Scanning bundled wallets" hint="Resolving linked wallets." className="w-full" />
                      <BundleScanLoop title="Scanning bundled supply" hint="Measuring bundled supply." className="w-full" />
                    </div>
                  ) : (
                    <>
                      <RiskBar
                        label="Bundled wallets"
                        value={typeof token.risk.bundledWalletCount === "number" ? Math.min(token.risk.bundledWalletCount, 50) : 0}
                        max={50}
                        danger={20}
                        warn={5}
                        formatValue={(value) => {
                          const count = Math.max(0, Math.round(value));
                          return `${count} wallet${count === 1 ? "" : "s"}`;
                        }}
                      />
                      <RiskBar label="Bundled supply" value={resolvedBundledSupplyPct ?? 0} max={100} danger={25} warn={10} />
                    </>
                  )}
                </div>
                  <div className="mt-4 rounded-[20px] border border-border/60 bg-secondary/60 p-4">
                    <div className="mb-3 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Bundle clusters</div>
                    <div className="space-y-2">
                      {token.bundleClusters.length > 0 ? (() => {
                        const clusterColors = [
                          { bg: "bg-orange-500/15", border: "border-orange-500/40", text: "text-orange-400", dot: "bg-orange-400" },
                          { bg: "bg-purple-500/15", border: "border-purple-500/40", text: "text-purple-400", dot: "bg-purple-400" },
                          { bg: "bg-rose-500/15", border: "border-rose-500/40", text: "text-rose-400", dot: "bg-rose-400" },
                          { bg: "bg-amber-500/15", border: "border-amber-500/40", text: "text-amber-400", dot: "bg-amber-400" },
                        ];
                        return token.bundleClusters.map((cluster, ci) => {
                          const clusterKey = cluster.id ?? cluster.clusterLabel;
                          const isExpanded = expandedClusters.has(clusterKey);
                          const color = clusterColors[ci % clusterColors.length]!;
                          const clusterPcts = new Set(
                            (cluster.evidenceJson?.holderPcts ?? []).map((p) => Math.round(p * 100) / 100)
                          );
                          const clusterWallets = token.risk.topHolders.filter(
                            (h) => clusterPcts.has(Math.round(h.supplyPct * 100) / 100)
                          );
                          return (
                            <div key={clusterKey} className={cn("rounded-[16px] border overflow-hidden", color.bg, color.border)}>
                              <button
                                onClick={() => setExpandedClusters((prev) => {
                                  const next = new Set(prev);
                                  if (next.has(clusterKey)) next.delete(clusterKey);
                                  else next.add(clusterKey);
                                  return next;
                                })}
                                className="flex w-full items-center gap-2.5 px-3 py-2.5 text-sm"
                              >
                                <div className={cn("flex h-5 w-5 shrink-0 items-center justify-center rounded-full", color.bg, color.border, "border")}>
                                  <div className={cn("h-2 w-2 rounded-full", color.dot)} />
                                </div>
                                <span className="font-semibold text-foreground flex-1 text-left">{cluster.clusterLabel}</span>
                                <span className={cn("text-[10px] uppercase tracking-[0.12em]", color.text)}>{cluster.walletCount} wallets</span>
                                {cluster.currentAction === "distributing" ? (
                                  <span className="rounded-full bg-red-500/15 border border-red-500/30 px-1.5 py-0.5 text-[9px] font-semibold text-red-400 uppercase tracking-wide">↓ Selling</span>
                                ) : cluster.currentAction === "accumulating" ? (
                                  <span className="rounded-full bg-emerald-500/15 border border-emerald-500/30 px-1.5 py-0.5 text-[9px] font-semibold text-emerald-400 uppercase tracking-wide">↑ Buying</span>
                                ) : cluster.currentAction === "holding" ? (
                                  <span className="rounded-full bg-zinc-500/15 border border-zinc-500/30 px-1.5 py-0.5 text-[9px] font-semibold text-zinc-400 uppercase tracking-wide">→ Holding</span>
                                ) : null}
                                <span className={cn("font-mono text-sm font-semibold", color.text)}>{cluster.estimatedSupplyPct.toFixed(1)}%</span>
                                <span className={cn("text-[10px]", color.text)}>{isExpanded ? "▲" : "▼"}</span>
                              </button>
                              {isExpanded ? (
                                <div className="border-t border-inherit px-3 pb-2.5 pt-2 space-y-1.5">
                                  {clusterWallets.length > 0 ? (
                                    clusterWallets.map((h, i) => (
                                      <div key={h.address} className="flex items-center justify-between text-[11px]">
                                        <div className="flex items-center gap-2">
                                          <span className={cn("font-semibold", color.text)}>{i + 1}.</span>
                                          <span className="font-mono text-foreground">{formatHolderAddress(h.ownerAddress ?? h.address)}</span>
                                          {h.phewHandle ? (
                                            <span className={cn("rounded-full border px-1.5 py-0.5 text-[9px] font-semibold", color.bg, color.border, color.text)}>@{h.phewHandle}</span>
                                          ) : null}
                                        </div>
                                        <span className={cn("font-mono font-semibold", color.text)}>{h.supplyPct.toFixed(2)}%</span>
                                      </div>
                                    ))
                                  ) : (
                                    <p className={cn("text-[11px]", color.text, "opacity-70")}>Wallet data not yet resolved for this cluster.</p>
                                  )}
                                </div>
                              ) : null}
                            </div>
                          );
                        });
                      })() : bundleScanPending ? (
                        <BundleScanLoop
                          title="Cluster loop active"
                          hint="Mapping linked holder groups and supply pockets."
                          className="w-full"
                        />
                      ) : (
                        <p className="text-sm text-muted-foreground">
                          {token.risk.bundleRiskLabel ? "No clustered bundlers detected yet." : "Scanning holder clusters and linked bundlers."}
                        </p>
                      )}
                    </div>
                  </div>
              </div>

              <div className="app-surface p-5">
                <div className="mb-4 flex items-center justify-between gap-3">
                  <div>
                    <div className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">Holder intelligence</div>
                      <div className="mt-1 text-sm text-muted-foreground">
                        {topHolderSectionCopy}
                      </div>
                    </div>
                    <div className={cn(
                      "rounded-full border px-3 py-1 text-[11px]",
                      holderIntelligencePending
                        ? "border-primary/30 bg-primary/10 text-primary font-medium"
                        : "border-border/60 bg-secondary text-muted-foreground"
                    )}>
                      {holderIntelligencePending ? (
                        <span className="flex items-center gap-1.5">
                          <Loader2 className="h-3 w-3 animate-spin" />
                          {topHolderRows.length > 0 ? `${topHolderRows.length} wallets` : "Scanning"}
                        </span>
                      ) : (
                        `${topHolderRows.length} wallets`
                      )}
                    </div>
                  </div>
                  <div className="max-h-[360px] space-y-2.5 overflow-y-auto pr-1">
                    {topHolderRows.length > 0 ? (() => {
                      const clusterColors = [
                        { bg: "bg-orange-500/15", border: "border-orange-500/40", text: "text-orange-400", dot: "bg-orange-400" },
                        { bg: "bg-purple-500/15", border: "border-purple-500/40", text: "text-purple-400", dot: "bg-purple-400" },
                        { bg: "bg-rose-500/15", border: "border-rose-500/40", text: "text-rose-400", dot: "bg-rose-400" },
                        { bg: "bg-amber-500/15", border: "border-amber-500/40", text: "text-amber-400", dot: "bg-amber-400" },
                      ];
                      // Build supplyPct → cluster index map
                      const pctToClusterIdx = new Map<number, number>();
                      token.bundleClusters.forEach((cluster, ci) => {
                        (cluster.evidenceJson?.holderPcts ?? []).forEach((p) => {
                          pctToClusterIdx.set(Math.round(p * 100) / 100, ci);
                        });
                      });
                      return topHolderRows.map((holder, index) => {
                        const clusterIdx = pctToClusterIdx.get(Math.round(holder.supplyPct * 100) / 100) ?? null;
                        const clusterColor = clusterIdx !== null ? clusterColors[clusterIdx % clusterColors.length] : null;
                        return (
                        <div
                          key={`${holder.address}:${index}`}
                          className={cn(
                            "rounded-[18px] border px-3 py-3 text-sm",
                            clusterColor ? `${clusterColor.bg} ${clusterColor.border}` : ""
                          )}
                        >
                          {clusterColor && clusterIdx !== null ? (
                            <div className="mb-2 flex items-center gap-1.5">
                              <div className={cn("h-2 w-2 rounded-full", clusterColor.dot)} />
                              <span className={cn("text-[10px] font-semibold uppercase tracking-[0.12em]", clusterColor.text)}>
                                {token.bundleClusters[clusterIdx]?.clusterLabel ?? "Bundled"}
                              </span>
                            </div>
                          ) : null}
                          <div className="flex items-start justify-between gap-3">
                            <div className="flex min-w-0 items-start gap-3">
                              <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-primary/18 bg-white/70 text-[11px] font-semibold text-primary dark:bg-white/[0.05]">
                                {index + 1}
                              </div>
                              <div className="min-w-0">
                                <div className="font-mono text-[12px] font-semibold text-foreground">
                                  {formatHolderAddress(holder.address)}
                                </div>
                                {holder.phewHandle ? (
                                  <div className="mt-1 flex items-center gap-1.5">
                                    <span className="inline-flex items-center gap-1 rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">
                                      @{holder.phewHandle}
                                    </span>
                                    {holder.phewEntryMcap ? (
                                      <span className="text-[10px] text-muted-foreground">bought at {formatMarketCap(holder.phewEntryMcap)}</span>
                                    ) : null}
                                  </div>
                                ) : null}
                                {getPrimaryHolderBadge(holder) ? (
                                  <div className="mt-1">
                                    <span
                                      className={cn(
                                        "inline-flex items-center rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] shadow-sm",
                                        getHolderBadgeMeta(getPrimaryHolderBadge(holder)!).className
                                      )}
                                    >
                                      {formatHolderBadge(getPrimaryHolderBadge(holder)!)}
                                    </span>
                                  </div>
                                ) : (
                                  null
                                )}
                                {buildHolderScanSummary(holder) ? (
                                  <div className="mt-1 text-[11px] text-muted-foreground">
                                    {buildHolderScanSummary(holder)}
                                  </div>
                                ) : null}
                                <div className="mt-1 text-[11px] text-muted-foreground">
                                  {formatHolderAmount(holder.amount)} tokens
                                  {holder.valueUsd ? (
                                    <span className="ml-1 text-foreground/80">| {formatMarketCap(holder.valueUsd)}</span>
                                  ) : null}
                                </div>
                                <div className="mt-1.5 flex flex-wrap gap-1.5">
                                  {getSecondaryHolderBadges(holder).length > 0 ? (
                                    getSecondaryHolderBadges(holder).map((badge) => (
                                      <span
                                        key={badge}
                                        className={cn(
                                          "rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] shadow-sm",
                                          getHolderBadgeMeta(badge).className
                                        )}
                                      >
                                        {formatHolderBadge(badge)}
                                      </span>
                                    ))
                                  ) : null}
                                </div>
                                {getHolderBehavior(holder.tradeSnapshot) !== "unknown" ? (
                                  <div className="mt-1.5">
                                    <HolderBehaviorIndicator snapshot={holder.tradeSnapshot} />
                                  </div>
                                ) : null}
                                <div className="mt-1.5 flex flex-wrap gap-2 text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                                  {holder.activeAgeDays !== null ? <span>Age {formatDaysMetric(holder.activeAgeDays)}</span> : null}
                                  {holder.tradeVolume90dSol !== null ? <span>90d {formatSolMetric(holder.tradeVolume90dSol)}</span> : null}
                                  {holder.solBalance !== null ? <span>Balance {formatSolMetric(holder.solBalance)}</span> : null}
                                  {holder.label ? <span>{holder.label}</span> : null}
                                </div>
                              </div>
                            </div>
                            <div className="shrink-0 text-right">
                              <div className="font-mono text-sm font-semibold text-foreground">
                                {formatPct(holder.supplyPct)}
                              </div>
                              <div className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                                of supply
                              </div>
                            </div>
                          </div>
                          <div className="mt-3 h-2 overflow-hidden rounded-full bg-border/55">
                            <div
                              className={cn("h-full rounded-full", clusterColor ? clusterColor.dot : "bg-[linear-gradient(90deg,hsl(var(--primary)),rgba(52,211,153,0.82))]")}
                              style={{ width: `${Math.max(6, Math.min(holder.supplyPct, 100))}%` }}
                            />
                          </div>
                        </div>
                        );
                      });
                    })() : holderIntelligencePending ? (
                      <BundleScanLoop
                        title="Holder scan active"
                        hint="Tracing wallet concentration, role tags, and early holder expansion."
                        className="w-full"
                      />
                    ) : (
                      <p className="text-sm text-muted-foreground">
                        No holder wallets were returned by the latest chain scan.
                      </p>
                    )}
                  </div>
              </div>
            </motion.section>

            {/* ── SECTION 5: TIMELINE + SENTIMENT ── */}
            <motion.section variants={sectionVariants} className="space-y-5">
              <div className="app-surface p-5">
                <div className="mb-4 flex items-center justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <ExternalLink className="h-4 w-4 text-primary" />
                      <h3 className="text-base font-semibold text-foreground">External X signals</h3>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Relevant posts matched by contract, symbol, and token name, plus the top accounts talking about it.
                    </p>
                  </div>
                  {socialSignalsQuery.isFetching ? (
                    <span className="inline-flex items-center gap-1 rounded-full border border-border/60 bg-secondary px-2.5 py-1 text-[11px] text-muted-foreground">
                      <Loader2 className="h-3 w-3 animate-spin" />
                      Updating
                    </span>
                  ) : socialSignals?.source ? (
                    <span className="rounded-full border border-border/60 bg-secondary px-2.5 py-1 text-[11px] text-muted-foreground">
                      {socialSignals.source}
                    </span>
                  ) : null}
                </div>
                {socialSignals?.available ? (
                  <div className="space-y-4">
                    <div className="grid gap-3 sm:grid-cols-3">
                      <div className="rounded-[18px] border border-border/60 bg-secondary/60 p-4">
                        <div className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">Calls 24h</div>
                        <div className="mt-2 text-2xl font-black text-foreground">{socialSignals.callCount24h}</div>
                      </div>
                      <div className="rounded-[18px] border border-border/60 bg-secondary/60 p-4">
                        <div className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">Unique authors</div>
                        <div className="mt-2 text-2xl font-black text-foreground">{socialSignals.uniqueAuthors24h}</div>
                      </div>
                      <div className="rounded-[18px] border border-border/60 bg-secondary/60 p-4">
                        <div className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">Matched by</div>
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {socialSignals.matchedQueries.slice(0, 3).map((query) => (
                            <span key={query} className="rounded-full border border-border/60 bg-background/70 px-2.5 py-1 text-[11px] text-foreground">
                              {query}
                            </span>
                          ))}
                        </div>
                      </div>
                    </div>
                    <div className="grid gap-4 xl:grid-cols-[0.92fr,1.08fr]">
                      <div className="space-y-3">
                        <div className="text-sm font-semibold text-foreground">Top KOLs from X</div>
                        {socialSignals.topKols.length > 0 ? socialSignals.topKols.map((kol, index) => (
                          <div key={`${kol.handle}-${index}`} className="flex items-center justify-between gap-3 rounded-[18px] border border-border/60 bg-secondary/55 p-3">
                            <div className="flex items-center gap-3">
                              <div className="flex h-8 w-8 items-center justify-center rounded-full border border-primary/15 bg-white/60 text-xs font-bold text-primary dark:bg-white/[0.05]">
                                {index + 1}
                              </div>
                              <Avatar className="h-10 w-10 border border-border">
                                <AvatarImage src={kol.avatarUrl ?? undefined} />
                                <AvatarFallback>{kol.handle.charAt(0).toUpperCase()}</AvatarFallback>
                              </Avatar>
                              <div className="min-w-0">
                                <div className="truncate text-sm font-semibold text-foreground">{kol.displayName || `@${kol.handle}`}</div>
                                <div className="truncate text-xs text-muted-foreground">
                                  @{kol.handle} · {kol.matchedPostCount} matched posts
                                </div>
                              </div>
                            </div>
                            <div className="shrink-0 text-right">
                              <div className="text-sm font-bold text-foreground">{Math.round(kol.engagementScore)}</div>
                              <div className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">engagement</div>
                            </div>
                          </div>
                        )) : (
                          <div className="rounded-[18px] border border-dashed border-border/60 bg-secondary/55 p-4 text-sm text-muted-foreground">
                            No top KOL matches yet for this token.
                          </div>
                        )}
                      </div>
                      <div className="space-y-3">
                        <div className="text-sm font-semibold text-foreground">Top X posts</div>
                        {socialSignals.latestPosts.length > 0 ? socialSignals.latestPosts.map((post) => (
                          <a
                            key={post.id}
                            href={post.url ?? `https://x.com/${post.authorHandle}`}
                            target="_blank"
                            rel="noreferrer"
                            className="block rounded-[18px] border border-border/60 bg-secondary/55 p-4 transition-colors hover:border-primary/25 hover:bg-secondary"
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <div className="flex flex-wrap items-center gap-2">
                                  <span className="text-sm font-semibold text-foreground">
                                    {post.authorDisplayName || `@${post.authorHandle}`}
                                  </span>
                                  <span className="text-xs text-muted-foreground">@{post.authorHandle}</span>
                                  {post.isCall ? (
                                    <span className="rounded-full border border-primary/25 bg-primary/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-primary">
                                      call
                                    </span>
                                  ) : null}
                                </div>
                                <p className="mt-2 line-clamp-3 text-sm leading-6 text-muted-foreground">{post.text}</p>
                              </div>
                              <ExternalLink className="h-4 w-4 shrink-0 text-muted-foreground" />
                            </div>
                            <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-muted-foreground">
                              <span>{formatTimeAgo(post.createdAt)}</span>
                              <span>likes {post.likeCount}</span>
                              <span>reposts {post.repostCount}</span>
                              <span>replies {post.replyCount}</span>
                              <span>matched {post.matchedBy}</span>
                            </div>
                          </a>
                        )) : (
                          <div className="rounded-[18px] border border-dashed border-border/60 bg-secondary/55 p-4 text-sm text-muted-foreground">
                            <div>No top X posts matched this token yet.</div>
                            {socialSignalQueries.length > 0 ? (
                              <div className="mt-3 flex flex-wrap gap-2">
                                {socialSignalQueries.map((query) => (
                                  <a
                                    key={query}
                                    href={buildXSearchUrl(query)}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="rounded-full border border-border/60 bg-background/70 px-2.5 py-1 text-[11px] text-foreground transition-colors hover:border-primary/25"
                                  >
                                    Search {query}
                                  </a>
                                ))}
                              </div>
                            ) : null}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="rounded-[20px] border border-dashed border-border/60 bg-secondary/55 p-4 text-sm text-muted-foreground">
                    <div>{socialSignals?.message || "External X signals are not connected yet."}</div>
                    {socialSignalQueries.length > 0 ? (
                      <div className="mt-3 flex flex-wrap gap-2">
                        {socialSignalQueries.map((query) => (
                          <a
                            key={query}
                            href={buildXSearchUrl(query)}
                            target="_blank"
                            rel="noreferrer"
                            className="rounded-full border border-border/60 bg-background/70 px-2.5 py-1 text-[11px] text-foreground transition-colors hover:border-primary/25"
                          >
                            Search X for {query}
                          </a>
                        ))}
                      </div>
                    ) : null}
                  </div>
                )}
              </div>
            </motion.section>

            <motion.section variants={sectionVariants} className="grid gap-5 lg:items-start lg:grid-cols-[1fr_1fr]">
              <div className="app-surface p-5">
                <div className="mb-5 flex items-center gap-2">
                  <Activity className="h-4 w-4 text-primary" />
                  <h3 className="text-base font-semibold text-foreground">Alpha timeline</h3>
                </div>
                <div className="relative space-y-0">
                  {displayTimeline.length > 0 ? (() => {
                    const holderHandleMap = new Map(
                      token.risk.topHolders
                        .filter((h) => h.phewHandle)
                        .map((h) => [h.phewHandle!, h])
                    );
                    return displayTimeline.map((event, idx) => {
                      const timelineCopy = buildTimelineCopy(event);
                      const linkedHolder = event.metadata?.traderHandle
                        ? holderHandleMap.get(event.metadata.traderHandle)
                        : null;
                      return (
                        <div key={event.id} className="relative flex gap-4 pb-5 last:pb-0">
                          <div className="relative flex flex-col items-center">
                            <div className="z-10 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-primary/25 bg-primary/10 text-primary">
                              <div className="h-2 w-2 rounded-full bg-primary" />
                            </div>
                            {idx < displayTimeline.length - 1 ? (
                              <div className="mt-1 w-px flex-1 bg-border/50" />
                            ) : null}
                          </div>
                          <div className="min-w-0 flex-1 pb-1">
                            <div className="flex items-start justify-between gap-2">
                              <div className="text-sm font-semibold text-foreground">{timelineCopy.title}</div>
                              <div className="shrink-0 text-[11px] text-muted-foreground">{formatTimeAgo(event.timestamp)}</div>
                            </div>
                            <div className="mt-1 text-xs text-muted-foreground">{timelineCopy.description}</div>
                            {linkedHolder ? (
                              <div className="mt-1">
                                <span className="inline-flex items-center rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-500">
                                  still holding · {linkedHolder.supplyPct.toFixed(2)}% supply{linkedHolder.phewEntryMcap ? ` · bought at ${formatMarketCap(linkedHolder.phewEntryMcap)}` : ""}
                                </span>
                              </div>
                            ) : null}
                          </div>
                        </div>
                      );
                    });
                  })() : (
                    <div className="rounded-[18px] border border-dashed border-border/60 bg-secondary/60 p-4 text-sm text-muted-foreground">
                      Timeline events are being assembled from calls and token signals.
                    </div>
                  )}
                </div>
              </div>

              <div className="space-y-5">
                <div className="app-surface p-5">
                  <div className="mb-4 flex items-center justify-between">
                    <div>
                      <div className="flex items-center gap-2">
                        <Flame className="h-4 w-4 text-primary" />
                        <h3 className="text-base font-semibold text-foreground">Sentiment</h3>
                      </div>
                      <p className="mt-0.5 text-xs text-muted-foreground">Community signal and market health</p>
                    </div>
                    <div className={cn("rounded-full border px-2.5 py-1 text-[11px] font-semibold", scoreTone(sentimentView.score))}>
                      {sentimentView.score.toFixed(0)}
                    </div>
                  </div>
                  <SentimentSplit
                    bullishPct={sentimentView.bullishPct}
                    bearishPct={sentimentView.bearishPct}
                    sentimentScore={sentimentView.score}
                  />
                  <div className="mt-4 grid grid-cols-3 gap-2">
                    <div className="rounded-[16px] border border-border/60 bg-secondary p-3 text-center">
                      <div className="text-base font-bold text-foreground">{formatMarketMetric(token.liquidity)}</div>
                      <div className="mt-0.5 text-[10px] uppercase tracking-[0.14em] text-muted-foreground">Liquidity</div>
                    </div>
                    <div className="rounded-[16px] border border-border/60 bg-secondary p-3 text-center">
                      <div className="text-base font-bold text-foreground">{formatMarketMetric(token.volume24h)}</div>
                      <div className="mt-0.5 text-[10px] uppercase tracking-[0.14em] text-muted-foreground">Vol 24h</div>
                    </div>
                    <div className="rounded-[16px] border border-border/60 bg-secondary p-3 text-center">
                      <div className={cn("text-base font-bold", sentimentView.bullishPct >= 50 ? "text-gain" : "text-loss")}>
                        {sentimentView.bullishPct.toFixed(0)}%
                      </div>
                      <div className="mt-0.5 text-[10px] uppercase tracking-[0.14em] text-muted-foreground">Bullish</div>
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    <span className="rounded-full border border-border/60 bg-secondary px-2.5 py-1 text-[11px] text-muted-foreground">⚡ Alpha {sentimentView.reactions.alpha}</span>
                    <span className="rounded-full border border-border/60 bg-secondary px-2.5 py-1 text-[11px] text-muted-foreground">🔥 Based {sentimentView.reactions.based}</span>
                    <span className="rounded-full border border-border/60 bg-secondary px-2.5 py-1 text-[11px] text-muted-foreground">💰 Printed {sentimentView.reactions.printed}</span>
                    <span className="rounded-full border border-border/60 bg-secondary px-2.5 py-1 text-[11px] text-muted-foreground">⚠️ Rug {sentimentView.reactions.rug}</span>
                  </div>
                </div>

                <div className="app-surface p-5">
                  <div className="mb-4 flex items-center gap-2">
                    <Users className="h-4 w-4 text-primary" />
                    <h3 className="text-base font-semibold text-foreground">Top traders</h3>
                  </div>
                  <div className="space-y-2.5">
                    {displayTopTraders.length > 0 ? (() => {
                      const holderHandleSet = new Map(
                        token.risk.topHolders.filter((h) => h.phewHandle).map((h) => [h.phewHandle!, h])
                      );
                      return displayTopTraders.map((trader, idx) => {
                        const linkedHolder = trader.username ? holderHandleSet.get(trader.username) : null;
                        return (
                          <div key={trader.id} className="rounded-[18px] border border-border/60 bg-secondary p-3">
                            <div className="flex items-center gap-3">
                              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-primary/18 bg-white/70 text-[11px] font-bold text-primary dark:bg-white/[0.05]">
                                {idx + 1}
                              </div>
                              <Avatar className="h-8 w-8 border border-border">
                                <AvatarImage src={getAvatarUrl(trader.id, trader.image)} />
                                <AvatarFallback>{(trader.username || trader.name || "?").charAt(0)}</AvatarFallback>
                              </Avatar>
                              <div className="min-w-0 flex-1">
                                <div className="truncate text-sm font-semibold text-foreground">{trader.username || trader.name}</div>
                                <div className="text-[11px] text-muted-foreground">{trader.reputationTier || "Unranked"} · {trader.callsCount} calls</div>
                              </div>
                              <div className="shrink-0 text-right">
                                <div className="text-sm font-bold text-gain">+{trader.bestRoiPct.toFixed(1)}%</div>
                                <div className="text-[10px] text-muted-foreground">best ROI</div>
                              </div>
                            </div>
                            {linkedHolder ? (
                              <div className="mt-2 pl-11">
                                <span className="inline-flex items-center rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-500">
                                  holding · {linkedHolder.supplyPct.toFixed(2)}% supply{linkedHolder.phewEntryMcap ? ` · bought at ${formatMarketCap(linkedHolder.phewEntryMcap)}` : ""}
                                </span>
                              </div>
                            ) : null}
                          </div>
                        );
                      });
                    })() : (
                      <div className="rounded-[18px] border border-dashed border-border/60 bg-secondary/60 p-4 text-sm text-muted-foreground">
                        We are still ranking trader quality for this token.
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </motion.section>
            </>
            ) : null}

            {activeTokenTab === "community" ? (
            <motion.section variants={sectionVariants}>
              <Suspense
                fallback={
                  <div className="app-surface p-5">
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Loading community...
                    </div>
                  </div>
                }
              >
                <TokenCommunitySection
                  tokenAddress={token.address}
                  tokenSymbol={token.symbol}
                  tokenName={token.name}
                  viewer={session?.user ?? null}
                  canPerformAuthenticatedWrites={canPerformAuthenticatedWrites}
                  entryIntent={communityEntryIntent}
                  entryIntentToken={communityEntryIntentToken}
                />
              </Suspense>
            </motion.section>
            ) : null}

            {/* ── SECTION 6: RECENT CALLS ── */}
            {activeTokenTab === "trade" ? (
            <motion.section variants={sectionVariants}>
              <div ref={recentCallsRef} className="space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Target className="h-4 w-4 text-primary" />
                    <h3 className="text-lg font-semibold text-foreground">Recent calls</h3>
                  </div>
                  <span className="rounded-full border border-border/60 bg-secondary px-3 py-1 text-xs text-muted-foreground">{recentCallsCount} calls</span>
                </div>
                {recentCalls.length > 0 ? (
                  recentCalls.map((post) => (
                    <PostCard
                      key={post.id}
                      post={post}
                      currentUserId={canPerformAuthenticatedWrites ? session?.user?.id : undefined}
                      autoOpenTradePanel={pendingTradeCallId === post.id}
                      autoPrefillBuyAmountSol={pendingTradeCallId === post.id ? pendingQuickBuyAmountSol : null}
                      onTradePanelAutoOpened={() => {
                        setPendingTradeCallId((current) => (current === post.id ? null : current));
                        setPendingQuickBuyAmountSol(null);
                      }}
                    />
                  ))
                ) : (
                  <div className="rounded-[20px] border border-dashed border-border/60 bg-secondary/60 p-5 text-sm text-muted-foreground">
                    {recentCallsEmptyCopy}
                  </div>
                )}
              </div>
              {tokenTradeBridgePost ? (
                <div className="hidden">
                  <PostCard
                    post={tokenTradeBridgePost}
                    currentUserId={canPerformAuthenticatedWrites ? session?.user?.id : undefined}
                    autoOpenTradePanel={pendingTradeCallId === tokenTradeBridgePost.id}
                    autoPrefillBuyAmountSol={pendingTradeCallId === tokenTradeBridgePost.id ? pendingQuickBuyAmountSol : null}
                    onTradePanelAutoOpened={() => {
                      setPendingTradeCallId((current) => (current === tokenTradeBridgePost.id ? null : current));
                      setPendingQuickBuyAmountSol(null);
                    }}
                  />
                </div>
              ) : null}
            </motion.section>
            ) : null}
          </motion.div>
        )}
      </main>
    </div>
  );
}
