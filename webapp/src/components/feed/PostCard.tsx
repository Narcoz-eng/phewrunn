import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient, type InfiniteData, type QueryClient } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { WalletReadyState } from "@solana/wallet-adapter-base";
import {
  AddressLookupTableAccount,
  Connection,
  LAMPORTS_PER_SOL,
  PublicKey,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { LevelBadge, LevelBar } from "./LevelBar";
import { RepostersDialog } from "./RepostersDialog";
import { SharedAlphaDialog, type SharedAlphaResponse } from "./SharedAlphaDialog";
import { TokenInfoCard } from "./TokenInfoCard";
import { AlsoCalledBy } from "./AlsoCalledBy";
import { CandlestickChart } from "./CandlestickChart";
import { VerifiedBadge } from "@/components/VerifiedBadge";
import { api, ApiError } from "@/lib/api";
import { getPostPriceSnapshotBatched, type BatchedPostPriceSnapshot } from "@/lib/post-price-batch";
import {
  Post,
  Comment,
  ReactionType,
  SharedAlphaUser,
  MIN_LEVEL,
  MAX_LEVEL,
  formatMarketCap,
  calculatePercentChange,
  formatMultiplier,
  formatTimeAgo,
  getAvatarUrl,
  stripContractAddress,
} from "@/types";
import type { MultiplierDisplay } from "@/types";
import {
  ExternalLink,
  Clock,
  TrendingUp,
  TrendingDown,
  CheckCircle2,
  XCircle,
  Users,
  Check,
  Sparkles,
  UserCheck,
  Loader2,
  Download,
  Coins,
  ChevronLeft,
  ChevronRight,
  Minus,
  Plus,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { buildProfilePath } from "@/lib/profile-path";
import { toast } from "sonner";
import { TradingPanel } from "./TradingPanel";
import PortfolioPanel from "./PortfolioPanel";
import type { PortfolioPosition } from "./PortfolioPanel";
import { ReportDialog } from "@/components/reporting/ReportDialog";
import { BrandLogo } from "@/components/BrandLogo";
import { EXACT_LOGO_IMAGE_SRC } from "@/lib/brand";
import {
  PhewChartIcon,
  PhewCommentIcon,
  PhewFollowIcon,
  PhewRepostIcon,
  PhewSendIcon,
  PhewShareIcon,
  PhewTradeIcon,
} from "@/components/icons/PhewIcons";

const SOL_MINT = "So11111111111111111111111111111111111111112";
const TRADE_SLIPPAGE_STORAGE_KEY = "phew.trade.slippage-bps";
const TRADE_AUTO_CONFIRM_STORAGE_KEY = "phew.trade.auto-confirm";
const TRADE_QUICK_BUY_PRESETS_STORAGE_KEY = "phew.trade.quick-buy-presets-sol";
const DEFAULT_QUICK_BUY_PRESETS_SOL = ["0.10", "0.20", "0.50", "1.00"];
const SLIPPAGE_PRESETS_BPS = [50, 100, 200, 300, 500];
const REALTIME_SETTLEMENT_REFRESH_THROTTLE_MS = 8_000;
const JUPITER_QUOTE_TIMEOUT_MS = 3_000;
const JUPITER_QUOTE_STALE_MAX_AGE_MS = 15_000;
const QUICK_BUY_QUOTE_PREFETCH_TIMEOUT_MS = 2_600;
const JUPITER_QUOTE_MEMORY_CACHE_TTL_MS = 4_000;
const MEMO_PROGRAM_ID = new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");
const MAX_CREATOR_ROUTE_FEE_BPS = 50;
const DEFAULT_TOTAL_ROUTE_FEE_BPS = 100;
let lastRealtimeSettlementRefreshAt = 0;
const DEX_CHART_INTERVAL_OPTIONS = [
  { value: "5", label: "5m" },
  { value: "15", label: "15m" },
  { value: "60", label: "1h" },
  { value: "240", label: "4h" },
  { value: "1D", label: "1D" },
] as const;
const REACTION_BUTTONS: Array<{ type: ReactionType; emoji: string; label: string }> = [
  { type: "alpha", emoji: "🔥", label: "Alpha" },
  { type: "based", emoji: "🐸", label: "Based" },
  { type: "printed", emoji: "💰", label: "Printed" },
  { type: "rug", emoji: "💀", label: "Rug" },
];
type DexChartIntervalValue = (typeof DEX_CHART_INTERVAL_OPTIONS)[number]["value"];
const CHART_DEFAULT_VISIBLE_POINTS = 72;
const CHART_MIN_VISIBLE_POINTS = 18;
const CHART_MAX_VISIBLE_POINTS = 320;
const CHART_ZOOM_STEP_POINTS = 16;
const CHART_PAN_STEP_POINTS = 6;
const CHART_FUTURE_PADDING_SLOTS = 6;
const CHART_TOUCH_PAN_THRESHOLD_PX = 12;
const CHART_TOUCH_PAN_STEP_PX = 14;
const CHART_TOUCH_PINCH_THRESHOLD_PX = 18;

type TradeSide = "buy" | "sell";

function getTouchMidpoint(touches: TouchList): { x: number; y: number } | null {
  const first = touches[0];
  const second = touches[1];
  if (!first || !second) return null;
  return {
    x: (first.clientX + second.clientX) / 2,
    y: (first.clientY + second.clientY) / 2,
  };
}

function getTouchDistance(touches: TouchList): number | null {
  const first = touches[0];
  const second = touches[1];
  if (!first || !second) return null;
  const deltaX = second.clientX - first.clientX;
  const deltaY = second.clientY - first.clientY;
  return Math.hypot(deltaX, deltaY);
}

type JupiterQuoteRequestPayload = {
  inputMint: string;
  outputMint: string;
  amount: number;
  slippageBps: number;
  swapMode: "ExactIn";
  postId: string;
};

type JupiterQuoteResponse = {
  inputMint: string;
  inAmount: string;
  outputMint: string;
  outAmount: string;
  otherAmountThreshold: string;
  swapMode: string;
  slippageBps: number;
  priceImpactPct?: string;
  routePlan?: Array<{
    swapInfo?: {
      label?: string;
      inAmount?: string;
      outAmount?: string;
    };
    percent?: number;
  }>;
  contextSlot?: number;
  timeTaken?: number;
  platformFee?: {
    amount?: string;
    feeBps?: number;
    mint?: string;
  };
};

type JupiterSwapResponse = {
  swapTransaction?: string;
  lastValidBlockHeight?: number;
  tradeFeeEventId?: string | null;
  tradeVerificationMemo?: string | null;
  platformFeeBpsApplied?: number;
  posterShareBpsApplied?: number;
};

const jupiterQuoteCache = new Map<
  string,
  { quote: JupiterQuoteResponse; expiresAtMs: number }
>();
const jupiterQuoteInFlight = new Map<string, Promise<JupiterQuoteResponse>>();

function buildJupiterQuoteCacheKey(payload: JupiterQuoteRequestPayload): string {
  return [
    payload.inputMint,
    payload.outputMint,
    String(payload.amount),
    String(payload.slippageBps),
    payload.swapMode,
    payload.postId,
  ].join(":");
}

function createAbortSignalWithTimeout(timeoutMs: number, externalSignal?: AbortSignal): {
  signal: AbortSignal;
  cleanup: () => void;
} {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  const handleExternalAbort = () => controller.abort();

  if (externalSignal) {
    if (externalSignal.aborted) {
      controller.abort();
    } else {
      externalSignal.addEventListener("abort", handleExternalAbort, { once: true });
    }
  }

  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timeoutId);
      if (externalSignal) {
        externalSignal.removeEventListener("abort", handleExternalAbort);
      }
    },
  };
}

async function loadAddressLookupTablesForTransaction(
  connection: Connection,
  transaction: VersionedTransaction
): Promise<AddressLookupTableAccount[]> {
  if (!("addressTableLookups" in transaction.message)) {
    return [];
  }

  const addressTableLookups = transaction.message.addressTableLookups ?? [];
  if (addressTableLookups.length === 0) {
    return [];
  }

  const lookupTableResponses = await Promise.all(
    addressTableLookups.map((lookup) => connection.getAddressLookupTable(lookup.accountKey))
  );

  return lookupTableResponses
    .map((response) => response.value)
    .filter((table): table is AddressLookupTableAccount => table !== null);
}

async function appendTradeVerificationMemoToTransaction(
  connection: Connection,
  transaction: VersionedTransaction,
  memo: string
): Promise<VersionedTransaction> {
  const addressLookupTableAccounts = await loadAddressLookupTablesForTransaction(
    connection,
    transaction
  );
  const decompiledMessage = TransactionMessage.decompile(
    transaction.message,
    addressLookupTableAccounts.length > 0
      ? { addressLookupTableAccounts }
      : undefined
  );
  decompiledMessage.instructions.push(
    new TransactionInstruction({
      programId: MEMO_PROGRAM_ID,
      keys: [],
      data: new TextEncoder().encode(memo),
    })
  );

  const compiledMessage =
    "addressTableLookups" in transaction.message
      ? decompiledMessage.compileToV0Message(addressLookupTableAccounts)
      : decompiledMessage.compileToLegacyMessage();

  return new VersionedTransaction(compiledMessage);
}

function isRetryableJupiterQuoteError(error: unknown): boolean {
  const message = (
    error instanceof Error ? error.message : typeof error === "string" ? error : ""
  ).toLowerCase();
  return (
    message.includes("aborted") ||
    message.includes("timeout") ||
    message.includes("failed to fetch") ||
    message.includes("networkerror")
  );
}

async function fetchJupiterQuoteFast(
  payload: JupiterQuoteRequestPayload,
  options?: { timeoutMs?: number; signal?: AbortSignal }
): Promise<JupiterQuoteResponse> {
  const key = buildJupiterQuoteCacheKey(payload);
  const now = Date.now();
  const cached = jupiterQuoteCache.get(key);
  if (cached && cached.expiresAtMs > now) {
    return cached.quote;
  }
  if (cached) {
    jupiterQuoteCache.delete(key);
  }

  const inFlight = jupiterQuoteInFlight.get(key);
  if (inFlight) {
    return inFlight;
  }

  const requestOnce = async (timeoutMs: number): Promise<JupiterQuoteResponse> => {
    const { signal, cleanup } = createAbortSignalWithTimeout(timeoutMs, options?.signal);
    try {
      const res = await fetch("/api/posts/jupiter/quote", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
        signal,
        cache: "no-store",
        credentials: "same-origin",
      });
      if (!res.ok) {
        const bodyText = await res.text().catch(() => "");
        let message = bodyText || `Quote failed (${res.status})`;
        if (bodyText) {
          try {
            const parsed = JSON.parse(bodyText) as { error?: { message?: string } };
            const upstreamMessage = parsed?.error?.message;
            if (typeof upstreamMessage === "string" && upstreamMessage.trim().length > 0) {
              message = upstreamMessage.trim();
            }
          } catch {
            // Keep raw text for non-JSON upstream responses.
          }
        }
        throw new Error(message);
      }

      const quote = (await res.json()) as JupiterQuoteResponse;
      jupiterQuoteCache.set(key, {
        quote,
        expiresAtMs: Date.now() + JUPITER_QUOTE_MEMORY_CACHE_TTL_MS,
      });
      return quote;
    } finally {
      cleanup();
    }
  };

  const requestPromise = (async () => {
    try {
      const baseTimeoutMs = options?.timeoutMs ?? JUPITER_QUOTE_TIMEOUT_MS;
      try {
        return await requestOnce(baseTimeoutMs);
      } catch (error) {
        if (options?.signal?.aborted || !isRetryableJupiterQuoteError(error)) {
          throw error;
        }
        const retryTimeoutMs = Math.max(baseTimeoutMs + 1_400, JUPITER_QUOTE_TIMEOUT_MS + 1_200);
        return await requestOnce(retryTimeoutMs);
      }
    } finally {
      jupiterQuoteInFlight.delete(key);
    }
  })();

  jupiterQuoteInFlight.set(key, requestPromise);
  return requestPromise;
}

type DexscreenerTokenRef = {
  address?: string;
  name?: string;
  symbol?: string;
  icon?: string;
  logoURI?: string;
};

type DexscreenerPair = {
  chainId?: string;
  dexId?: string;
  url?: string;
  pairAddress?: string;
  baseToken?: DexscreenerTokenRef;
  quoteToken?: DexscreenerTokenRef;
  priceUsd?: string | number;
  fdv?: string | number;
  marketCap?: string | number;
  liquidity?: {
    usd?: string | number;
  };
  volume?: {
    h24?: string | number;
  };
  priceChange?: {
    h24?: string | number;
  };
  txns?: {
    h24?: {
      buys?: string | number;
      sells?: string | number;
    };
  };
  info?: {
    imageUrl?: string;
    header?: string;
    openGraph?: string;
  };
};

type DexscreenerImagePayload =
  | DexscreenerPair[]
  | {
      pairs?: DexscreenerPair[] | null;
    }
  | null;

type DexscreenerTokenData = {
  tokenName: string | null;
  tokenSymbol: string | null;
  tokenImage: string | null;
  dexscreenerUrl: string | null;
  pairAddress: string | null;
  dexId: string | null;
  priceUsd: number | null;
  marketCap: number | null;
  liquidityUsd: number | null;
  volume24hUsd: number | null;
  priceChange24hPct: number | null;
  buys24h: number | null;
  sells24h: number | null;
};

type ChartCandle = {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

type ChartCandlesSource = "birdeye" | "geckoterminal" | "unknown";

type ChartCandlesResponse = {
  candles: ChartCandle[];
  source: ChartCandlesSource;
  network: string | null;
};

function normalizeDexAddress(value: string | null | undefined): string | null {
  if (!value) return null;
  const normalized = value.trim().toLowerCase();
  return normalized || null;
}

function normalizeDexChain(value: string | null | undefined): string | null {
  if (!value) return null;
  const normalized = value.trim().toLowerCase();
  if (!normalized) return null;
  if (normalized === "eth") return "ethereum";
  if (normalized === "sol") return "solana";
  return normalized;
}

function pickDexTokenFromPair(
  pair: DexscreenerPair | undefined,
  contractAddress: string
): DexscreenerTokenRef | null {
  if (!pair) return null;
  const target = normalizeDexAddress(contractAddress);
  const base = pair.baseToken;
  const quote = pair.quoteToken;
  if (target && normalizeDexAddress(base?.address) === target) return base ?? null;
  if (target && normalizeDexAddress(quote?.address) === target) return quote ?? null;
  return base ?? quote ?? null;
}

function pickDexImageUrlFromPair(
  pair: DexscreenerPair | undefined,
  token: DexscreenerTokenRef | null
): string | null {
  const candidates = [
    token?.icon,
    token?.logoURI,
    pair?.info?.imageUrl,
    pair?.info?.header,
    pair?.info?.openGraph,
  ];
  for (const candidate of candidates) {
    const value = candidate?.trim();
    if (value) return value;
  }
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

function formatUsdCompact(value: number): string {
  if (!Number.isFinite(value)) return "-";
  if (Math.abs(value) >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(2)}B`;
  if (Math.abs(value) >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`;
  if (Math.abs(value) >= 1_000) return `$${(value / 1_000).toFixed(2)}K`;
  if (Math.abs(value) >= 1) return `$${value.toFixed(4)}`;
  return `$${value.toFixed(8)}`;
}

function pickDexPairFromPayload(
  payload: DexscreenerImagePayload,
  contractAddress: string,
  chainType: string | null
): DexscreenerPair | null {
  const pairs = Array.isArray(payload) ? payload : (payload?.pairs ?? []);
  if (!pairs.length) return null;

  const target = normalizeDexAddress(contractAddress);
  const expectedChain = normalizeDexChain(chainType === "solana" ? "solana" : "ethereum");
  const rankedPairs = [...pairs].sort((a, b) => {
    const scorePair = (pair: DexscreenerPair): number => {
      const baseMatch = normalizeDexAddress(pair.baseToken?.address) === target;
      const quoteMatch = normalizeDexAddress(pair.quoteToken?.address) === target;
      const chainMatch = normalizeDexChain(pair.chainId) === expectedChain;
      let score = 0;
      if (baseMatch && chainMatch) score += 120;
      else if (quoteMatch && chainMatch) score += 100;
      else if (baseMatch) score += 70;
      else if (quoteMatch) score += 55;
      if (chainMatch) score += 20;
      if (pair.url?.trim()) score += 5;
      return score;
    };

    const scoreDelta = scorePair(b) - scorePair(a);
    if (scoreDelta !== 0) return scoreDelta;

    const liquidityDelta = (toFiniteNumber(b.liquidity?.usd) ?? 0) - (toFiniteNumber(a.liquidity?.usd) ?? 0);
    if (liquidityDelta !== 0) return liquidityDelta;

    return (toFiniteNumber(b.volume?.h24) ?? 0) - (toFiniteNumber(a.volume?.h24) ?? 0);
  });
  const matchedPair = rankedPairs[0];

  return matchedPair ?? null;
}

async function fetchDexscreenerTokenData(args: {
  contractAddress: string;
  chainType: string | null;
}): Promise<DexscreenerTokenData | null> {
  const { contractAddress, chainType } = args;
  const chain = chainType === "solana" ? "solana" : "ethereum";
  const endpoints = [
    `https://api.dexscreener.com/tokens/v1/${chain}/${contractAddress}`,
    `https://api.dexscreener.com/latest/dex/tokens/${contractAddress}`,
  ];

  for (const endpoint of endpoints) {
    try {
      const response = await fetch(endpoint, {
        headers: { Accept: "application/json" },
      });
      if (!response.ok) continue;
      const payload = (await response.json()) as DexscreenerImagePayload;
      const pair = pickDexPairFromPayload(payload, contractAddress, chainType);
      if (!pair) continue;
      const token = pickDexTokenFromPair(pair, contractAddress);

      return {
        tokenName: token?.name?.trim() || pair.baseToken?.name?.trim() || null,
        tokenSymbol: token?.symbol?.trim() || pair.baseToken?.symbol?.trim() || null,
        tokenImage: pickDexImageUrlFromPair(pair, token),
        dexscreenerUrl: pair.url?.trim() || null,
        pairAddress: pair.pairAddress?.trim() || null,
        dexId: pair.dexId?.trim() || null,
        priceUsd: toFiniteNumber(pair.priceUsd),
        marketCap: toFiniteNumber(pair.marketCap) ?? toFiniteNumber(pair.fdv),
        liquidityUsd: toFiniteNumber(pair.liquidity?.usd),
        volume24hUsd: toFiniteNumber(pair.volume?.h24),
        priceChange24hPct: toFiniteNumber(pair.priceChange?.h24),
        buys24h: toFiniteNumber(pair.txns?.h24?.buys),
        sells24h: toFiniteNumber(pair.txns?.h24?.sells),
      };
    } catch {
      // Quiet fallback to next endpoint.
    }
  }

  return null;
}

interface PostCardProps {
  post: Post;
  className?: string;
  currentUserId?: string;
  onLike?: (postId: string) => void;
  onReact?: (postId: string, type: ReactionType | null) => Promise<void> | void;
  onRepost?: (postId: string) => void;
  onComment?: (postId: string, content: string) => Promise<void> | void;
  enableRealtimePricePolling?: boolean;
  autoOpenTradePanel?: boolean;
  autoPrefillBuyAmountSol?: string | null;
  onTradePanelAutoOpened?: () => void;
}

type FeedPostsPageLike = {
  items: Post[];
};

type TokenPageCacheLike = {
  recentCalls: Post[];
};

type IntelligenceLeaderboardsCacheLike = {
  topAlphaToday?: Post[];
  biggestRoiToday?: Post[];
  bestEntryToday?: Post[];
};

function syncFollowStateAcrossPostCaches(
  queryClient: QueryClient,
  author: Pick<PostAuthor, "id" | "username">,
  nextFollowing: boolean
): void {
  const normalizedUsername = author.username?.trim().toLowerCase() ?? null;
  const matchesAuthor = (post: Post): boolean =>
    post.author.id === author.id ||
    post.authorId === author.id ||
    (normalizedUsername !== null && post.author.username?.trim().toLowerCase() === normalizedUsername);
  const syncPost = (post: Post): Post =>
    matchesAuthor(post) ? { ...post, isFollowingAuthor: nextFollowing } : post;

  queryClient.setQueriesData<InfiniteData<FeedPostsPageLike>>({ queryKey: ["posts"] }, (current) => {
    if (!current) return current;
    return {
      ...current,
      pages: current.pages.map((page) => ({
        ...page,
        items: page.items.map(syncPost),
      })),
    };
  });

  queryClient.setQueriesData<Post[]>({ queryKey: ["userPosts"] }, (current) =>
    current?.map(syncPost) ?? current
  );
  queryClient.setQueriesData<Post[]>({ queryKey: ["userReposts"] }, (current) =>
    current?.map(syncPost) ?? current
  );
  queryClient.setQueriesData<TokenPageCacheLike>({ queryKey: ["token-page"] }, (current) => {
    if (!current) return current;
    return {
      ...current,
      recentCalls: current.recentCalls?.map(syncPost) ?? current.recentCalls,
    };
  });
  queryClient.setQueriesData<IntelligenceLeaderboardsCacheLike>({ queryKey: ["leaderboards"] }, (current) => {
    if (!current) return current;
    return {
      ...current,
      topAlphaToday: current.topAlphaToday?.map(syncPost) ?? current.topAlphaToday,
      biggestRoiToday: current.biggestRoiToday?.map(syncPost) ?? current.biggestRoiToday,
      bestEntryToday: current.bestEntryToday?.map(syncPost) ?? current.bestEntryToday,
    };
  });
  queryClient.setQueriesData<{ id?: string | null; username?: string | null; isFollowing?: boolean }>(
    { queryKey: ["userProfile"] },
    (current) => {
      if (!current) return current;
      const matchesProfile =
        current.id === author.id ||
        (normalizedUsername !== null && current.username?.trim().toLowerCase() === normalizedUsername);
      return matchesProfile ? { ...current, isFollowing: nextFollowing } : current;
    }
  );
}

function parseMarketStateTimestamp(value: string | null | undefined): number {
  if (!value) return 0;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function getPostDynamicStateVersion(
  post: Pick<Post, "lastMcapUpdate" | "settledAt" | "createdAt" | "lastIntelligenceAt">
): number {
  return Math.max(
    parseMarketStateTimestamp(post.lastMcapUpdate),
    parseMarketStateTimestamp(post.settledAt),
    parseMarketStateTimestamp(post.lastIntelligenceAt),
    parseMarketStateTimestamp(post.createdAt)
  );
}

function getSnapshotDynamicStateVersion(
  snapshot: Pick<BatchedPostPriceSnapshot, "lastMcapUpdate" | "settledAt" | "lastIntelligenceAt">
): number {
  return Math.max(
    parseMarketStateTimestamp(snapshot.lastMcapUpdate),
    parseMarketStateTimestamp(snapshot.settledAt),
    parseMarketStateTimestamp(snapshot.lastIntelligenceAt)
  );
}

function resolveSnapshotCurrentMcap(
  existingCurrentMcap: number | null,
  entryMcap: number | null,
  snapshot: BatchedPostPriceSnapshot
): number | null {
  if (snapshot.currentMcap === null) {
    return existingCurrentMcap;
  }

  if (existingCurrentMcap === null) {
    return snapshot.currentMcap;
  }

  const existingLooksLive =
    entryMcap !== null &&
    existingCurrentMcap !== entryMcap;
  const snapshotLooksBaseline =
    snapshot.entryMcap !== null &&
    snapshot.currentMcap === snapshot.entryMcap;
  const snapshotHasResolvedOutcome =
    snapshot.settled ||
    snapshot.mcap1h !== null ||
    snapshot.mcap6h !== null;

  if (existingLooksLive && snapshotLooksBaseline && !snapshotHasResolvedOutcome) {
    return existingCurrentMcap;
  }

  return snapshot.currentMcap;
}

function applyRealtimeSnapshotToPost(post: Post, snapshot: BatchedPostPriceSnapshot): Post {
  const postVersion = getPostDynamicStateVersion(post);
  const snapshotVersion = getSnapshotDynamicStateVersion(snapshot);
  const shouldPreserveExistingDynamicState =
    snapshotVersion > 0 && snapshotVersion < postVersion;
  const nextCurrentMcap = shouldPreserveExistingDynamicState
    ? post.currentMcap
    : resolveSnapshotCurrentMcap(post.currentMcap, post.entryMcap, snapshot);
  const nextSettled = shouldPreserveExistingDynamicState ? post.settled : snapshot.settled || post.settled;
  const nextSettledAt = shouldPreserveExistingDynamicState
    ? post.settledAt
    : snapshot.settledAt ?? post.settledAt;
  const nextMcap1h = shouldPreserveExistingDynamicState ? post.mcap1h : snapshot.mcap1h ?? post.mcap1h;
  const nextMcap6h = shouldPreserveExistingDynamicState ? post.mcap6h : snapshot.mcap6h ?? post.mcap6h;
  const nextLastMcapUpdate = shouldPreserveExistingDynamicState
    ? post.lastMcapUpdate ?? null
    : snapshot.lastMcapUpdate ?? post.lastMcapUpdate ?? null;
  const nextLastIntelligenceAt = shouldPreserveExistingDynamicState
    ? post.lastIntelligenceAt ?? null
    : snapshot.lastIntelligenceAt ?? post.lastIntelligenceAt ?? null;
  const nextTrackingMode = shouldPreserveExistingDynamicState
    ? post.trackingMode ?? null
    : snapshot.trackingMode ?? post.trackingMode ?? null;
  const nextConfidenceScore = shouldPreserveExistingDynamicState
    ? post.confidenceScore ?? null
    : snapshot.confidenceScore ?? post.confidenceScore ?? null;
  const nextHotAlphaScore = shouldPreserveExistingDynamicState
    ? post.hotAlphaScore ?? null
    : snapshot.hotAlphaScore ?? post.hotAlphaScore ?? null;
  const nextEarlyRunnerScore = shouldPreserveExistingDynamicState
    ? post.earlyRunnerScore ?? null
    : snapshot.earlyRunnerScore ?? post.earlyRunnerScore ?? null;
  const nextHighConvictionScore = shouldPreserveExistingDynamicState
    ? post.highConvictionScore ?? null
    : snapshot.highConvictionScore ?? post.highConvictionScore ?? null;
  const nextRoiCurrentPct = shouldPreserveExistingDynamicState
    ? post.roiCurrentPct ?? null
    : snapshot.roiCurrentPct ?? post.roiCurrentPct ?? null;
  const nextTimingTier = shouldPreserveExistingDynamicState
    ? post.timingTier ?? null
    : snapshot.timingTier ?? post.timingTier ?? null;
  const nextBundleRiskLabel = shouldPreserveExistingDynamicState
    ? post.bundleRiskLabel ?? null
    : snapshot.bundleRiskLabel ?? post.bundleRiskLabel ?? null;
  const nextTokenRiskScore = shouldPreserveExistingDynamicState
    ? post.tokenRiskScore ?? null
    : snapshot.tokenRiskScore ?? post.tokenRiskScore ?? null;
  const nextLiquidity = shouldPreserveExistingDynamicState
    ? post.liquidity ?? null
    : snapshot.liquidity ?? post.liquidity ?? null;
  const nextVolume24h = shouldPreserveExistingDynamicState
    ? post.volume24h ?? null
    : snapshot.volume24h ?? post.volume24h ?? null;
  const nextHolderCount = shouldPreserveExistingDynamicState
    ? post.holderCount ?? null
    : snapshot.holderCount ?? post.holderCount ?? null;
  const nextLargestHolderPct = shouldPreserveExistingDynamicState
    ? post.largestHolderPct ?? null
    : snapshot.largestHolderPct ?? post.largestHolderPct ?? null;
  const nextTop10HolderPct = shouldPreserveExistingDynamicState
    ? post.top10HolderPct ?? null
    : snapshot.top10HolderPct ?? post.top10HolderPct ?? null;
  const nextBundledWalletCount = shouldPreserveExistingDynamicState
    ? post.bundledWalletCount ?? null
    : snapshot.bundledWalletCount ?? post.bundledWalletCount ?? null;
  const nextEstimatedBundledSupplyPct = shouldPreserveExistingDynamicState
    ? post.estimatedBundledSupplyPct ?? null
    : snapshot.estimatedBundledSupplyPct ?? post.estimatedBundledSupplyPct ?? null;
  const nextIsWin =
    nextMcap1h !== null && post.entryMcap !== null
      ? nextMcap1h > post.entryMcap
      : post.isWin;

  if (
    nextCurrentMcap === post.currentMcap &&
    nextSettled === post.settled &&
    nextSettledAt === post.settledAt &&
    nextMcap1h === post.mcap1h &&
    nextMcap6h === post.mcap6h &&
    nextLastMcapUpdate === post.lastMcapUpdate &&
    nextLastIntelligenceAt === (post.lastIntelligenceAt ?? null) &&
    nextTrackingMode === post.trackingMode &&
    nextConfidenceScore === (post.confidenceScore ?? null) &&
    nextHotAlphaScore === (post.hotAlphaScore ?? null) &&
    nextEarlyRunnerScore === (post.earlyRunnerScore ?? null) &&
    nextHighConvictionScore === (post.highConvictionScore ?? null) &&
    nextRoiCurrentPct === (post.roiCurrentPct ?? null) &&
    nextTimingTier === (post.timingTier ?? null) &&
    nextBundleRiskLabel === (post.bundleRiskLabel ?? null) &&
    nextTokenRiskScore === (post.tokenRiskScore ?? null) &&
    nextLiquidity === (post.liquidity ?? null) &&
    nextVolume24h === (post.volume24h ?? null) &&
    nextHolderCount === (post.holderCount ?? null) &&
    nextLargestHolderPct === (post.largestHolderPct ?? null) &&
    nextTop10HolderPct === (post.top10HolderPct ?? null) &&
    nextBundledWalletCount === (post.bundledWalletCount ?? null) &&
    nextEstimatedBundledSupplyPct === (post.estimatedBundledSupplyPct ?? null) &&
    nextIsWin === post.isWin
  ) {
    return post;
  }

  return {
    ...post,
    currentMcap: nextCurrentMcap,
    settled: nextSettled,
    settledAt: nextSettledAt,
    mcap1h: nextMcap1h,
    mcap6h: nextMcap6h,
    lastMcapUpdate: nextLastMcapUpdate,
    lastIntelligenceAt: nextLastIntelligenceAt,
    trackingMode: nextTrackingMode,
    confidenceScore: nextConfidenceScore,
    hotAlphaScore: nextHotAlphaScore,
    earlyRunnerScore: nextEarlyRunnerScore,
    highConvictionScore: nextHighConvictionScore,
    roiCurrentPct: nextRoiCurrentPct,
    timingTier: nextTimingTier,
    bundleRiskLabel: nextBundleRiskLabel,
    tokenRiskScore: nextTokenRiskScore,
    liquidity: nextLiquidity,
    volume24h: nextVolume24h,
    holderCount: nextHolderCount,
    largestHolderPct: nextLargestHolderPct,
    top10HolderPct: nextTop10HolderPct,
    bundledWalletCount: nextBundledWalletCount,
    estimatedBundledSupplyPct: nextEstimatedBundledSupplyPct,
    isWin: nextIsWin,
  };
}

function syncRealtimeSnapshotToCachedPosts(
  queryClient: QueryClient,
  postId: string,
  snapshot: BatchedPostPriceSnapshot
): void {
  queryClient.setQueriesData(
    { queryKey: ["posts"] },
    (existing: InfiniteData<FeedPostsPageLike> | undefined) => {
      if (!existing?.pages?.length) {
        return existing;
      }

      let didChange = false;
      const nextPages = existing.pages.map((page) => {
        let pageChanged = false;
        const nextItems = page.items.map((item) => {
          if (item.id !== postId) {
            return item;
          }
          const nextItem = applyRealtimeSnapshotToPost(item, snapshot);
          if (nextItem !== item) {
            pageChanged = true;
            didChange = true;
          }
          return nextItem;
        });

        return pageChanged ? { ...page, items: nextItems } : page;
      });

      return didChange ? { ...existing, pages: nextPages } : existing;
    }
  );

  const syncPostArray = (existing: Post[] | undefined) => {
    if (!Array.isArray(existing) || existing.length === 0) {
      return existing;
    }

    let didChange = false;
    const nextItems = existing.map((item) => {
      if (item.id !== postId) {
        return item;
      }
      const nextItem = applyRealtimeSnapshotToPost(item, snapshot);
      if (nextItem !== item) {
        didChange = true;
      }
      return nextItem;
    });

    return didChange ? nextItems : existing;
  };

  queryClient.setQueriesData({ queryKey: ["userPosts"] }, syncPostArray);
  queryClient.setQueriesData({ queryKey: ["userReposts"] }, syncPostArray);
  queryClient.setQueryData<Post>(["post", postId], (existing) =>
    existing ? applyRealtimeSnapshotToPost(existing, snapshot) : existing
  );
}

export function PostCard({
  post,
  className,
  currentUserId,
  onReact,
  onRepost,
  enableRealtimePricePolling = true,
  autoOpenTradePanel = false,
  autoPrefillBuyAmountSol = null,
  onTradePanelAutoOpened,
}: PostCardProps) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const chartInteractionRef = useRef<HTMLDivElement>(null);
  const { connection } = useConnection();
  const wallet = useWallet();
  const { visible: isWalletModalVisible, setVisible: setWalletModalVisible } = useWalletModal();
  const tradeWalletPublicKey =
    wallet.publicKey ?? wallet.wallet?.adapter?.publicKey ?? wallet.adapter?.publicKey ?? null;
  const tradeWalletAddress = tradeWalletPublicKey?.toBase58() ?? null;
  const cardRef = useRef<HTMLDivElement>(null);
  const [isCommentsOpen, setIsCommentsOpen] = useState(false);
  const [commentText, setCommentText] = useState("");
  const [replyingToComment, setReplyingToComment] = useState<Comment | null>(null);
  const [isReposted, setIsReposted] = useState(post.isReposted);
  const [likeCount, setLikeCount] = useState(post.reactionCounts?.alpha ?? post._count?.likes ?? 0);
  const [reactionCounts, setReactionCounts] = useState(post.reactionCounts ?? {
    alpha: post._count?.likes ?? 0,
    based: 0,
    printed: 0,
    rug: 0,
  });
  const [currentReactionType, setCurrentReactionType] = useState<ReactionType | null>(
    post.currentReactionType ?? (post.isLiked ? "alpha" : null)
  );
  const [repostCount, setRepostCount] = useState(post._count?.reposts ?? 0);
  const [copied, setCopied] = useState(false);
  const [isRepostersOpen, setIsRepostersOpen] = useState(false);
  const [isSharedAlphaOpen, setIsSharedAlphaOpen] = useState(false);
  // Initialize follow state from post data (optimistic update)
  const [isFollowing, setIsFollowing] = useState(post.isFollowingAuthor ?? false);
  const [isFollowLoading, setIsFollowLoading] = useState(false);
  const [commentCount, setCommentCount] = useState(post._count?.comments ?? 0);
  const [isInViewport, setIsInViewport] = useState(true);
  const [isWinCardDownloading, setIsWinCardDownloading] = useState(false);
  const [isWinCardPreviewOpen, setIsWinCardPreviewOpen] = useState(false);
  const [isBuyDialogOpen, setIsBuyDialogOpen] = useState(false);
  const [isWalletConnectDialogOpen, setIsWalletConnectDialogOpen] = useState(false);
  const [pendingBuyAfterWalletConnect, setPendingBuyAfterWalletConnect] = useState(false);
  const [tradeSide, setTradeSide] = useState<TradeSide>("buy");
  const [buyAmountSol, setBuyAmountSol] = useState("0.10");
  const [sellAmountToken, setSellAmountToken] = useState("");
  const [slippageBps, setSlippageBps] = useState(100);
  const [slippageInputPercent, setSlippageInputPercent] = useState("1.00");
  const [showSlippageSettings, setShowSlippageSettings] = useState(false);
  const [quickBuyPresetsSol, setQuickBuyPresetsSol] = useState<string[]>(DEFAULT_QUICK_BUY_PRESETS_SOL);
  const [pendingQuickBuyAutoExecute, setPendingQuickBuyAutoExecute] = useState(false);
  const [isExecutingBuy, setIsExecutingBuy] = useState(false);
  const [buyTxSignature, setBuyTxSignature] = useState<string | null>(null);
  const preparedSwapRef = useRef<{ key: string; payload: JupiterSwapResponse; cachedAt: number } | null>(null);
  const swapBuildInFlightRef = useRef<{ key: string; promise: Promise<JupiterSwapResponse> } | null>(null);

  useEffect(() => {
    setReactionCounts(post.reactionCounts ?? {
      alpha: post._count?.likes ?? 0,
      based: 0,
      printed: 0,
      rug: 0,
    });
    setCurrentReactionType(post.currentReactionType ?? (post.isLiked ? "alpha" : null));
  }, [post.currentReactionType, post.isLiked, post.reactionCounts, post._count?.likes]);
  const quickBuyRetryCountRef = useRef(0);
  const [autoConfirmEnabled, setAutoConfirmEnabled] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem(TRADE_AUTO_CONFIRM_STORAGE_KEY) === "true";
  });
  const [portfolioPositions, setPortfolioPositions] = useState<PortfolioPosition[]>([]);
  const [portfolioTotalPnl, setPortfolioTotalPnl] = useState<number | null>(null);
  const [isPortfolioLoading, setIsPortfolioLoading] = useState(false);
  const [chartInterval, setChartInterval] = useState<DexChartIntervalValue>("15");
  const [isChartInfoVisible, setIsChartInfoVisible] = useState(true);
  const [isChartTradesVisible, setIsChartTradesVisible] = useState(true);
  const [chartWindow, setChartWindow] = useState<{ startIndex: number; endIndex: number } | null>(null);
  const [chartActiveIndex, setChartActiveIndex] = useState<number | null>(null);
  const [isChartMousePanning, setIsChartMousePanning] = useState(false);
  const chartTouchGestureRef = useRef<{
    x: number;
    y: number;
    distance: number | null;
    mode: "pan" | "scroll" | "pinch" | null;
  } | null>(null);
  const chartMouseGestureRef = useRef<{
    x: number;
    y: number;
    mode: "pan" | "scroll" | null;
  } | null>(null);
  const walletConnectAttemptRef = useRef<Promise<boolean> | null>(null);
  const walletConnectCooldownUntilRef = useRef(0);
  const exactLogoImageSrc = EXACT_LOGO_IMAGE_SRC;
  const heliusReadRpcUrl = (import.meta.env.VITE_HELIUS_RPC_URL as string | undefined)?.trim() || null;
  const tradeReadConnection = useMemo(
    () => (heliusReadRpcUrl ? new Connection(heliusReadRpcUrl, "confirmed") : connection),
    [heliusReadRpcUrl, connection]
  );
  const tradeRpcConnections = useMemo(() => {
    const seen = new Set<string>();
    const connections = [tradeReadConnection, connection];
    return connections.filter((candidate, index) => {
      const key = candidate.rpcEndpoint || `rpc-${index}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [connection, tradeReadConnection]);
  const isLikelyMobileDevice = useMemo(() => {
    if (typeof navigator === "undefined") return false;
    const ua = navigator.userAgent || "";
    return /android|iphone|ipad|ipod|mobile/i.test(ua);
  }, []);

  const hasGlobalDialogOpen = useCallback(() => {
    if (typeof document === "undefined") return false;
    return document.querySelector("[role='dialog'][data-state='open']") !== null;
  }, []);

  const hasActiveTradePanelMarker = useCallback(() => {
    if (typeof document === "undefined") return false;
    const activePostId = document.body?.dataset?.phewActiveTradeDialogPostId?.trim();
    return Boolean(activePostId);
  }, []);

  const clearPotentialScrollLock = useCallback(() => {
    if (typeof document === "undefined") return;
    if (hasGlobalDialogOpen() || hasActiveTradePanelMarker()) return;
    document.body.classList.remove("overflow-hidden", "wallet-adapter-modal-open");
    document.documentElement.classList.remove("overflow-hidden");
    document.body.style.overflow = "";
    document.documentElement.style.overflow = "";
    document.body.style.paddingRight = "";
    document.documentElement.style.paddingRight = "";
    document.body.style.touchAction = "";
    document.documentElement.style.touchAction = "";
    if (document.body.style.pointerEvents === "none") {
      document.body.style.pointerEvents = "";
    }
    if (document.documentElement.style.pointerEvents === "none") {
      document.documentElement.style.pointerEvents = "";
    }
  }, [hasActiveTradePanelMarker, hasGlobalDialogOpen]);

  // Sync follow state when post data changes
  useEffect(() => {
    setIsFollowing(post.isFollowingAuthor ?? false);
  }, [post.isFollowingAuthor]);

  useEffect(() => {
    setIsReposted(post.isReposted);
    setLikeCount(post.reactionCounts?.alpha ?? post._count?.likes ?? 0);
    setRepostCount(post._count?.reposts ?? 0);
    setCommentCount(post._count?.comments ?? 0);
  }, [
    post.id,
    post.isReposted,
    post.reactionCounts?.alpha,
    post._count?.comments,
    post._count?.likes,
    post._count?.reposts,
  ]);

  useEffect(() => {
    setLikeCount(reactionCounts.alpha);
  }, [reactionCounts.alpha]);

  // Complete the intended "connect then buy" flow without opening both popups at once.
  useEffect(() => {
    if (!tradeWalletPublicKey) return;
    if (isWalletModalVisible) {
      setWalletModalVisible(false);
    }
    if (isWalletConnectDialogOpen) {
      setIsWalletConnectDialogOpen(false);
    }
    if (pendingBuyAfterWalletConnect) {
      setPendingBuyAfterWalletConnect(false);
      setBuyTxSignature(null);
      // For quick-buy flows, execute without forcing an overlay dialog.
      if (!pendingQuickBuyAutoExecute) {
        setIsBuyDialogOpen(true);
      }
    }
    if (
      typeof window !== "undefined" &&
      !isWalletModalVisible &&
      !isWalletConnectDialogOpen &&
      !isBuyDialogOpen &&
      !isWinCardPreviewOpen &&
      !hasGlobalDialogOpen() &&
      !hasActiveTradePanelMarker()
    ) {
      window.setTimeout(clearPotentialScrollLock, 120);
    }
  }, [
    tradeWalletPublicKey,
    isWalletConnectDialogOpen,
    pendingBuyAfterWalletConnect,
    pendingQuickBuyAutoExecute,
    isBuyDialogOpen,
    isWalletModalVisible,
    isWinCardPreviewOpen,
    setWalletModalVisible,
    clearPotentialScrollLock,
    hasActiveTradePanelMarker,
    hasGlobalDialogOpen,
  ]);

  useEffect(() => {
    if (typeof document === "undefined") return;
    const activeId = document.body?.dataset?.phewActiveTradeDialogPostId?.trim();
    if (isBuyDialogOpen) {
      document.body.dataset.phewActiveTradeDialogPostId = post.id;
      return;
    }
    if (activeId === post.id) {
      delete document.body.dataset.phewActiveTradeDialogPostId;
    }
    return () => {
      const currentId = document.body?.dataset?.phewActiveTradeDialogPostId?.trim();
      if (currentId === post.id) {
        delete document.body.dataset.phewActiveTradeDialogPostId;
      }
    };
  }, [isBuyDialogOpen, post.id]);

  useEffect(() => {
    if (!autoOpenTradePanel || isBuyDialogOpen || !post.contractAddress) return;
    if (typeof window === "undefined") {
      if (autoPrefillBuyAmountSol) {
        setTradeSide("buy");
        setBuyAmountSol(autoPrefillBuyAmountSol);
      }
      setIsBuyDialogOpen(true);
      onTradePanelAutoOpened?.();
      return;
    }
    const frameId = window.requestAnimationFrame(() => {
      if (autoPrefillBuyAmountSol) {
        setTradeSide("buy");
        setBuyAmountSol(autoPrefillBuyAmountSol);
      }
      setIsBuyDialogOpen(true);
      onTradePanelAutoOpened?.();
    });
    return () => window.cancelAnimationFrame(frameId);
  }, [autoOpenTradePanel, autoPrefillBuyAmountSol, isBuyDialogOpen, onTradePanelAutoOpened, post.contractAddress]);

  useEffect(() => {
    if (isWalletModalVisible || isWalletConnectDialogOpen || isBuyDialogOpen || isWinCardPreviewOpen) {
      return;
    }
    if (hasGlobalDialogOpen() || hasActiveTradePanelMarker()) return;
    if (typeof window === "undefined") return;
    const timer = window.setTimeout(clearPotentialScrollLock, 80);
    return () => window.clearTimeout(timer);
  }, [
    isWalletModalVisible,
    isWalletConnectDialogOpen,
    isBuyDialogOpen,
    isWinCardPreviewOpen,
    clearPotentialScrollLock,
    hasActiveTradePanelMarker,
    hasGlobalDialogOpen,
  ]);

  useEffect(() => {
    if (typeof document === "undefined") return;
    const hasOverlayOpen = isBuyDialogOpen || isWalletConnectDialogOpen || isWinCardPreviewOpen;
    const shouldLockDocument = hasOverlayOpen || hasGlobalDialogOpen() || hasActiveTradePanelMarker();
    if (shouldLockDocument) {
      document.body.classList.add("phew-overlay-open");
      document.body.style.overflow = "hidden";
      document.documentElement.style.overflow = "hidden";
      document.body.style.touchAction = "none";
      document.documentElement.style.touchAction = "none";
    } else if (!hasGlobalDialogOpen() && !hasActiveTradePanelMarker()) {
      document.body.classList.remove("phew-overlay-open");
      document.body.style.overflow = "";
      document.documentElement.style.overflow = "";
      document.body.style.touchAction = "";
      document.documentElement.style.touchAction = "";
    }

    return () => {
      if (!hasGlobalDialogOpen() && !hasActiveTradePanelMarker()) {
        document.body.classList.remove("phew-overlay-open");
        document.body.style.overflow = "";
        document.documentElement.style.overflow = "";
        document.body.style.touchAction = "";
        document.documentElement.style.touchAction = "";
      }
    };
  }, [
    isBuyDialogOpen,
    isWalletConnectDialogOpen,
    isWinCardPreviewOpen,
    hasActiveTradePanelMarker,
    hasGlobalDialogOpen,
  ]);

  useEffect(() => {
    if (isBuyDialogOpen) return;
    setPendingQuickBuyAutoExecute(false);
    preparedSwapRef.current = null;
    swapBuildInFlightRef.current = null;
  }, [isBuyDialogOpen]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const raw = window.localStorage.getItem(TRADE_SLIPPAGE_STORAGE_KEY);
    if (!raw) return;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) return;
    const normalized = Math.min(5000, Math.max(1, Math.round(parsed)));
    setSlippageBps(normalized);
    setSlippageInputPercent((normalized / 100).toFixed(2));
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(TRADE_SLIPPAGE_STORAGE_KEY, String(slippageBps));
    setSlippageInputPercent((slippageBps / 100).toFixed(2));
  }, [slippageBps]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const raw = window.localStorage.getItem(TRADE_QUICK_BUY_PRESETS_STORAGE_KEY);
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return;
      const next = parsed
        .slice(0, DEFAULT_QUICK_BUY_PRESETS_SOL.length)
        .map((value) => String(value).trim())
        .filter((value) => value.length > 0);
      if (next.length === DEFAULT_QUICK_BUY_PRESETS_SOL.length) {
        setQuickBuyPresetsSol(next);
      }
    } catch {
      // Ignore malformed local settings.
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(
      TRADE_QUICK_BUY_PRESETS_STORAGE_KEY,
      JSON.stringify(quickBuyPresetsSol)
    );
  }, [quickBuyPresetsSol]);

  // Auto-confirm persistence
  const handleAutoConfirmChange = useCallback((enabled: boolean) => {
    setAutoConfirmEnabled(enabled);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(TRADE_AUTO_CONFIRM_STORAGE_KEY, String(enabled));
    }
  }, []);

  // Fetch portfolio when buy dialog opens and wallet is connected
  useEffect(() => {
    if (!isBuyDialogOpen || !tradeWalletPublicKey || !post.contractAddress) return;
    const walletAddr = tradeWalletPublicKey.toBase58();
    setIsPortfolioLoading(true);
    fetch("/api/posts/portfolio", {
      method: "POST",
      headers: { "content-type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ walletAddress: walletAddr, tokenMints: [post.contractAddress] }),
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => {
        const data = json?.data;
        if (data?.positions) {
          setPortfolioPositions(data.positions);
          setPortfolioTotalPnl(data.totalUnrealizedPnl ?? null);
        }
      })
      .catch(() => {
        // Silently fail - portfolio is supplementary
      })
      .finally(() => setIsPortfolioLoading(false));
  }, [isBuyDialogOpen, tradeWalletPublicKey, post.contractAddress]);

  // Only live-poll prices for visible/nearby cards to reduce load on initial feed render.
  useEffect(() => {
    if (!enableRealtimePricePolling) {
      setIsInViewport(false);
      return;
    }
    if (typeof window === "undefined" || typeof IntersectionObserver === "undefined") {
      return;
    }
    const node = cardRef.current;
    if (!node) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (entry) {
          setIsInViewport(entry.isIntersecting);
        }
      },
      {
        root: null,
        rootMargin: "300px 0px",
        threshold: 0,
      }
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, [enableRealtimePricePolling]);

  // Real-time price state
  const [currentMcap, setCurrentMcap] = useState(post.currentMcap);
  // Track settlement state locally to detect when post settles
  const [localSettled, setLocalSettled] = useState(post.settled);
  const [localMcap1h, setLocalMcap1h] = useState(post.mcap1h);
  const [localMcap6h, setLocalMcap6h] = useState(post.mcap6h);
  const [localIsWin, setLocalIsWin] = useState(post.isWin);
  const latestMarketStateVersionRef = useRef<number>(getPostDynamicStateVersion(post));

  // Sync state when post prop changes
  useEffect(() => {
    const incomingVersion = getPostDynamicStateVersion(post);
    const currentVersion = latestMarketStateVersionRef.current;
    const shouldAdoptIncomingMarketState = incomingVersion >= currentVersion;

    if (shouldAdoptIncomingMarketState) {
      latestMarketStateVersionRef.current = incomingVersion;
      setCurrentMcap(post.currentMcap);
      setLocalSettled(post.settled);
      setLocalMcap1h(post.mcap1h);
      setLocalMcap6h(post.mcap6h);
      setLocalIsWin(post.isWin);
      return;
    }

    if (post.settled && !localSettled) {
      setLocalSettled(true);
    }
    if (post.mcap1h !== null && localMcap1h === null) {
      setLocalMcap1h(post.mcap1h);
    }
    if (post.mcap6h !== null && localMcap6h === null) {
      setLocalMcap6h(post.mcap6h);
    }
    if (post.isWin !== null && localIsWin === null) {
      setLocalIsWin(post.isWin);
    }
  }, [
    post,
    post.currentMcap,
    post.settled,
    post.mcap1h,
    post.mcap6h,
    post.isWin,
    post.lastMcapUpdate,
    post.settledAt,
    post.createdAt,
    localSettled,
    localMcap1h,
    localMcap6h,
    localIsWin,
  ]);

  // Real-time price updates with dynamic intervals:
  // - Unsettled posts (< 1 hour): Update every 30 seconds
  // - Settled posts (>= 1 hour): Update every 5 minutes
  // Also auto-refresh when post settles to show final 1H result
  useEffect(() => {
    if (!enableRealtimePricePolling) return;
    if (!post.contractAddress) return;
    if (!isInViewport) return;

    const fetchPrice = async () => {
      if (typeof document !== "undefined" && document.visibilityState !== "visible") {
        return;
      }
      try {
        const data = await getPostPriceSnapshotBatched(post.id);
        if (!data) return;

        syncRealtimeSnapshotToCachedPosts(queryClient, post.id, data);

        const snapshotVersion = getSnapshotDynamicStateVersion(data);
        if (snapshotVersion > latestMarketStateVersionRef.current) {
          latestMarketStateVersionRef.current = snapshotVersion;
        }

        setCurrentMcap((prev) => resolveSnapshotCurrentMcap(prev, post.entryMcap, data));

        let shouldInvalidateRealtimeStats = false;

        // Keep settlement state synchronized with server snapshots.
        if (data.settled && !localSettled) {
          setLocalSettled(true);
          shouldInvalidateRealtimeStats = true;
        }
        if (data.mcap1h !== null && data.mcap1h !== localMcap1h) {
          setLocalMcap1h(data.mcap1h);
          const isWin = post.entryMcap !== null && data.mcap1h > post.entryMcap;
          setLocalIsWin(isWin);
          shouldInvalidateRealtimeStats = true;
        }

        // Update 6H mcap if available and refresh user stats in near-real time.
        if (data.mcap6h !== null && data.mcap6h !== localMcap6h) {
          setLocalMcap6h(data.mcap6h);
          shouldInvalidateRealtimeStats = true;
        }

        if (shouldInvalidateRealtimeStats) {
          // Throttle feed/profile invalidation so level/xp badges refresh in near real time
          // without every visible card spamming refetches when many posts settle together.
          const nowMs = Date.now();
          if (nowMs - lastRealtimeSettlementRefreshAt >= REALTIME_SETTLEMENT_REFRESH_THROTTLE_MS) {
            lastRealtimeSettlementRefreshAt = nowMs;
            void queryClient.invalidateQueries({ queryKey: ["posts"], refetchType: "active" });
            void queryClient.invalidateQueries({ queryKey: ["users"], refetchType: "active" });
            void queryClient.invalidateQueries({ queryKey: ["userProfile"], refetchType: "active" });
            void queryClient.invalidateQueries({ queryKey: ["userPosts"], refetchType: "active" });
            void queryClient.invalidateQueries({ queryKey: ["userReposts"], refetchType: "active" });
            void queryClient.invalidateQueries({ queryKey: ["profile", "me"], refetchType: "active" });
            void queryClient.invalidateQueries({ queryKey: ["currentUser"], refetchType: "active" });
            void queryClient.invalidateQueries({ queryKey: ["leaderboard"], refetchType: "active" });
          }
        }
      } catch (error) {
        // Silently fail - don't spam console
      }
    };

    // Faster cadence for visible cards to reflect settlement/snapshot changes in near real time.
    const postAgeMs = Date.now() - new Date(post.createdAt).getTime();
    const waitingForSixHourSnapshot =
      localSettled && localMcap6h === null && postAgeMs >= 6 * 60 * 60 * 1000;
    const baseInterval = waitingForSixHourSnapshot ? 45_000 : localSettled ? 5 * 60 * 1000 : 30_000;
    const initialDelay =
      post.currentMcap == null
        ? 0
        : Math.min(10_000, Math.floor(Math.random() * 4_000) + 1_000);

    const initialTimer = setTimeout(fetchPrice, initialDelay);
    const intervalTimer = setInterval(fetchPrice, baseInterval);

    return () => {
      clearTimeout(initialTimer);
      clearInterval(intervalTimer);
    };
  }, [
    enableRealtimePricePolling,
    post.id,
    post.contractAddress,
    post.entryMcap,
    post.currentMcap,
    post.createdAt,
    localSettled,
    localMcap1h,
    localMcap6h,
    isInViewport,
    queryClient,
  ]);

  // Fetch comments when expanded
  const { data: comments, isLoading: isCommentsLoading, refetch: refetchComments } = useQuery({
    queryKey: ["callThread", post.id],
    queryFn: async () => {
      const data = await api.get<Comment[]>(`/api/calls/${post.id}/thread`);
      return data;
    },
    enabled: isCommentsOpen,
    staleTime: 30000,
  });

  // Fetch shared alpha users (other traders who called the same token)
  const shouldPrefetchSharedAlphaPreview =
    Boolean(post.contractAddress) &&
    isInViewport &&
    typeof post.sharedAlphaCount === "number" &&
    post.sharedAlphaCount > 0 &&
    post.sharedAlphaCount <= 3;

  const { data: sharedAlphaData } = useQuery({
    queryKey: ["sharedAlpha", post.id],
    queryFn: () => api.get<SharedAlphaResponse>(`/api/posts/${post.id}/shared-alpha`),
    enabled: Boolean(post.contractAddress) && (isSharedAlphaOpen || shouldPrefetchSharedAlphaPreview),
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
  const sharedAlphaUsers = sharedAlphaData?.users ?? [];
  const sharedAlphaTotalCount = Math.max(post.sharedAlphaCount ?? 0, sharedAlphaData?.count ?? 0);
  const hasSharedAlphaPreview = sharedAlphaUsers.length > 0 || sharedAlphaTotalCount > 0;

  // Handle follow/unfollow with optimistic updates
  const handleFollow = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!currentUserId || isFollowLoading) return;

    // Optimistic update - change state immediately
    const wasFollowing = isFollowing;
    const followTargetIdentifier = post.author.username || post.author.id;
    setIsFollowing(!wasFollowing);
    setIsFollowLoading(true);
    syncFollowStateAcrossPostCaches(queryClient, post.author, !wasFollowing);

    try {
      if (wasFollowing) {
        await api.delete(`/api/users/${followTargetIdentifier}/follow`);
        toast.success(`Unfollowed ${post.author.username || post.author.name}`);
      } else {
        await api.post(`/api/users/${followTargetIdentifier}/follow`, {});
        toast.success(`Following ${post.author.username || post.author.name}`);
      }
      // Invalidate relevant queries to refresh data
      void queryClient.invalidateQueries({ queryKey: ["posts"] });
      void queryClient.invalidateQueries({ queryKey: ["users"] });
      void queryClient.invalidateQueries({ queryKey: ["userProfile"] });
      void queryClient.invalidateQueries({ queryKey: ["userPosts"] });
      void queryClient.invalidateQueries({ queryKey: ["userReposts"] });
    } catch (error) {
      if (error instanceof ApiError) {
        const alreadyFollowing = !wasFollowing && error.status === 400 && /already following/i.test(error.message);
        const notFollowing = wasFollowing && error.status === 404 && /not following/i.test(error.message);

        if (alreadyFollowing || notFollowing) {
          const nextFollowing = alreadyFollowing;
          setIsFollowing(nextFollowing);
          syncFollowStateAcrossPostCaches(queryClient, post.author, nextFollowing);
          void queryClient.invalidateQueries({ queryKey: ["posts"] });
          void queryClient.invalidateQueries({ queryKey: ["users"] });
          void queryClient.invalidateQueries({ queryKey: ["userProfile"] });
          void queryClient.invalidateQueries({ queryKey: ["userPosts"] });
          void queryClient.invalidateQueries({ queryKey: ["userReposts"] });
          toast.success(alreadyFollowing ? `Following ${post.author.username || post.author.name}` : `Unfollowed ${post.author.username || post.author.name}`);
          return;
        }
      }

      // Revert on error
      setIsFollowing(wasFollowing);
      syncFollowStateAcrossPostCaches(queryClient, post.author, wasFollowing);
      toast.error(error instanceof Error ? error.message : "Failed to update follow status");
    } finally {
      setIsFollowLoading(false);
    }
  };

  // Use settled 1H mcap when present, but fallback to live mcap for legacy rows missing mcap1h.
  const officialMcap = localSettled ? (localMcap1h ?? currentMcap) : currentMcap;
  const percentChange = calculatePercentChange(post.entryMcap, officialMcap);
  const winCardCurrentMcap = currentMcap;
  const winCardSettledMcapLabel = localSettled ? "1H Settled MCAP" : "Reference MCAP";
  const winCardCurrentMcapLabel = localSettled ? "Current MCAP (Live)" : "Current MCAP";
  const isGain = percentChange !== null && percentChange > 0;
  const isLoss = percentChange !== null && percentChange < 0;
  const hasContractAddress = post.contractAddress !== null;
  const winCardProfitLossValue =
    post.entryMcap !== null && officialMcap !== null ? officialMcap - post.entryMcap : null;
  const walletTradeSnapshot = post.walletTradeSnapshot ?? null;
  const verifiedTotalPnlUsd =
    typeof walletTradeSnapshot?.totalPnlUsd === "number" ? walletTradeSnapshot.totalPnlUsd : null;
  const boughtUsd = typeof walletTradeSnapshot?.boughtUsd === "number" ? walletTradeSnapshot.boughtUsd : null;
  const soldUsd = typeof walletTradeSnapshot?.soldUsd === "number" ? walletTradeSnapshot.soldUsd : null;
  const holdingUsd = typeof walletTradeSnapshot?.holdingUsd === "number" ? walletTradeSnapshot.holdingUsd : null;
  const boughtAmount =
    typeof walletTradeSnapshot?.boughtAmount === "number" ? walletTradeSnapshot.boughtAmount : null;
  const soldAmount =
    typeof walletTradeSnapshot?.soldAmount === "number" ? walletTradeSnapshot.soldAmount : null;
  const holdingAmount =
    typeof walletTradeSnapshot?.holdingAmount === "number" ? walletTradeSnapshot.holdingAmount : null;
  const hasWalletTradeInfo =
    verifiedTotalPnlUsd !== null ||
    boughtUsd !== null ||
    soldUsd !== null ||
    boughtAmount !== null ||
    soldAmount !== null ||
    holdingUsd !== null ||
    holdingAmount !== null;
  const confidenceScore = post.confidenceScore ?? null;
  const hotAlphaScore = post.hotAlphaScore ?? null;
  const earlyRunnerScore = post.earlyRunnerScore ?? null;
  const highConvictionScore = post.highConvictionScore ?? null;
  const tokenPageHref = post.contractAddress ? `/token/${post.contractAddress}` : null;
  const hasTokenIntelligence =
    confidenceScore !== null ||
    hotAlphaScore !== null ||
    earlyRunnerScore !== null ||
    highConvictionScore !== null ||
    post.bundleRiskLabel != null ||
    post.timingTier != null ||
    post.author.reputationTier != null ||
    post.estimatedBundledSupplyPct != null ||
    post.liquidity != null ||
    post.volume24h != null ||
    post.holderCount != null;
  const shouldShowIntelligenceStrip = hasContractAddress || hasTokenIntelligence;
  const hasResolvedConfidenceContext =
    (typeof confidenceScore === "number" && confidenceScore > 0) ||
    typeof hotAlphaScore === "number" ||
    typeof earlyRunnerScore === "number" ||
    typeof highConvictionScore === "number" ||
    post.bundleRiskLabel != null ||
    post.timingTier != null ||
    post.liquidity != null ||
    post.volume24h != null ||
    post.holderCount != null ||
    post.top10HolderPct != null ||
    post.largestHolderPct != null;
  const hasResolvedBundleContext =
    typeof post.estimatedBundledSupplyPct === "number" ||
    post.bundleRiskLabel != null ||
    post.tokenRiskScore != null ||
    post.bundledWalletCount != null ||
    Boolean(post.bundleClusters?.length);
  const normalizedConfidenceScore =
    hasResolvedConfidenceContext && typeof confidenceScore === "number" && Number.isFinite(confidenceScore)
      ? Math.max(0, Math.min(100, confidenceScore))
      : null;
  const normalizedBundleRiskLabel =
    post.bundleRiskLabel ||
    (hasResolvedBundleContext ? "Unknown" : "Pending");
  const normalizedBundledSupplyPct =
    typeof post.estimatedBundledSupplyPct === "number"
      ? `${post.estimatedBundledSupplyPct.toFixed(1)}%`
      : hasResolvedBundleContext
        ? "--"
        : "Pending";
  const threadTotal = post.threadCount ?? commentCount;
  const traderTier =
    post.author.reputationTier ??
    (typeof post.author.trustScore === "number" && post.author.trustScore >= 72
      ? "Elite"
      : typeof post.author.trustScore === "number" && post.author.trustScore >= 58
        ? "Trusted"
        : "Provisional");
  const formatUsdStat = (value: number) =>
    new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: "USD",
      notation: Math.abs(value) >= 1000 ? "compact" : "standard",
      maximumFractionDigits: Math.abs(value) >= 1000 ? 1 : 2,
    }).format(value);
  const winCardSettledWin = localSettled && localIsWin === true;
  const winCardSettledLoss = localSettled && localIsWin === false;
  const winCardAccentClass =
    winCardSettledWin || (!localSettled && (winCardProfitLossValue ?? 0) >= 0)
      ? "text-gain"
      : winCardSettledLoss
        ? "text-loss"
        : "text-muted-foreground";
  const winCardResultLabel = localSettled ? (winCardSettledWin ? "WIN CARD" : "RESULT CARD") : "LIVE CARD";
  const winCardResultText =
    percentChange !== null ? `${percentChange >= 0 ? "+" : ""}${percentChange.toFixed(2)}%` : "N/A";
  const winCardVerifiedPnlLabel =
    verifiedTotalPnlUsd === null
      ? null
      : verifiedTotalPnlUsd >= 0
        ? "Wallet Profit"
        : "Wallet Loss";
  const winCardVerifiedPnlText =
    verifiedTotalPnlUsd === null ? null : `${verifiedTotalPnlUsd >= 0 ? "+" : "-"}${formatUsdStat(Math.abs(verifiedTotalPnlUsd))}`;
  const winCardMarketMoveLabel =
    winCardProfitLossValue === null
      ? "MCAP Delta"
      : winCardProfitLossValue >= 0
        ? "MCAP Gain"
        : "MCAP Drop";
  const winCardMarketMoveText =
    winCardProfitLossValue === null
      ? "N/A"
      : `${winCardProfitLossValue >= 0 ? "+" : "-"}${formatMarketCap(Math.abs(winCardProfitLossValue))}`;
  const winCardTokenPrimary = post.tokenSymbol || post.tokenName || "TOKEN";
  const winCardTokenSecondary =
    post.tokenName && post.tokenSymbol
      ? post.tokenName
      : post.contractAddress
        ? `${post.contractAddress.slice(0, 6)}...${post.contractAddress.slice(-4)}`
        : "No contract";
  const winCardPostPreview = (stripContractAddress(post.content) || post.content || "No description").slice(0, 220);
  const winCardChainLabel = post.chainType?.toUpperCase() || "CHAIN";
  const winCardAuthorName = post.author.username ? `@${post.author.username}` : post.author.name;
  const winCardAuthorMeta = `Level ${post.author.level > 0 ? `+${post.author.level}` : post.author.level} | ${formatTimeAgo(post.createdAt)} | ${winCardChainLabel}`;
  const winCardShareIntro = "Share-ready alpha receipt with settlement snapshots and engagement proof.";
  const winCardPerformanceEyebrow = localSettled ? "Settled performance" : "Live performance";
  const winCardPerformanceSupport = localSettled ? "Benchmark locked" : "Live market snapshot";
  const winCardFooterRightLabel = localSettled ? "Settlement verified snapshot" : "Live snapshot at export time";
  const buildWinCardSnapshotMetric = (label: string, snapshotMcap: number | null) => {
    if (post.entryMcap === null || snapshotMcap === null) {
      return {
        label,
        percentText: "Pending",
        profitText: "N/A",
        toneClass: "text-muted-foreground",
        positive: null as boolean | null,
        magnitudeRatio: 0,
      };
    }
    const snapshotPercent = calculatePercentChange(post.entryMcap, snapshotMcap);
    const snapshotProfit = snapshotMcap - post.entryMcap;
    const isPositive = snapshotProfit >= 0;
    const absPercent = snapshotPercent === null ? 0 : Math.abs(snapshotPercent);
    return {
      label,
      percentText:
        snapshotPercent === null ? "N/A" : `${snapshotPercent >= 0 ? "+" : ""}${snapshotPercent.toFixed(2)}%`,
      profitText: `${snapshotProfit >= 0 ? "+" : "-"}${formatMarketCap(Math.abs(snapshotProfit))}`,
      toneClass: isPositive ? "text-gain" : "text-loss",
      positive: isPositive,
      magnitudeRatio: Math.max(0.12, Math.min(1, absPercent / 250)),
    };
  };
  const winCardSnapshotMetrics = [
    buildWinCardSnapshotMetric("1H Snapshot", localMcap1h),
    buildWinCardSnapshotMetric("6H Snapshot", localMcap6h),
    buildWinCardSnapshotMetric("Current", currentMcap),
  ];
  const winCardLevelProgressRatio = Math.max(
    0,
    Math.min(1, (post.author.level - MIN_LEVEL) / (MAX_LEVEL - MIN_LEVEL))
  );
  const winCardLevelLabel =
    post.author.level >= 8
      ? "Elite"
      : post.author.level >= 4
        ? "Veteran"
        : post.author.level >= 1
          ? "Rising"
          : post.author.level >= -2
            ? "Neutral"
            : "Danger";
  const winCardLevelToneClass =
    post.author.level >= 8
      ? "text-amber-300"
      : post.author.level >= 4
        ? "text-slate-200"
        : post.author.level >= 1
          ? "text-orange-300"
        : post.author.level >= -2
          ? "text-rose-200"
          : "text-red-300";
  const winCardTrendTone =
    winCardSettledWin || (!localSettled && (winCardProfitLossValue ?? 0) >= 0)
      ? "gain"
      : winCardSettledLoss
        ? "loss"
        : "neutral";
  const winCardStatusTitle =
    localSettled ? (winCardSettledWin ? "Settled Winner" : "Settled Result") : "Live Tracking";
  const winCardStatusDetail = localSettled ? "1H benchmark locked" : "Live market snapshot";
  const winCardMetricCards = [
    {
      label: "Entry MCAP",
      value: formatMarketCap(post.entryMcap),
      hint: "Position opened",
      emphasis: false,
    },
    {
      label: winCardSettledMcapLabel,
      value: formatMarketCap(officialMcap),
      hint: localSettled ? "Official benchmark" : "Current benchmark",
      emphasis: false,
    },
    {
      label: winCardCurrentMcapLabel,
      value: formatMarketCap(winCardCurrentMcap),
      hint: "Latest tracked MCAP",
      emphasis: true,
    },
    {
      label: winCardMarketMoveLabel,
      value: winCardMarketMoveText,
      hint: "Versus entry",
      emphasis: false,
      toneClass: winCardAccentClass,
    },
  ];
  const winCardSnapshotRows = [
    { shortLabel: "1H", ...winCardSnapshotMetrics[0] },
    { shortLabel: "6H", ...winCardSnapshotMetrics[1] },
    { shortLabel: "NOW", ...winCardSnapshotMetrics[2] },
  ];
  const winCardWalletSummaryCards = [
    verifiedTotalPnlUsd !== null
      ? {
          label: "Wallet P/L",
          value: winCardVerifiedPnlText ?? "N/A",
          hint: verifiedTotalPnlUsd >= 0 ? "Verified profit" : "Verified loss",
          toneClass: verifiedTotalPnlUsd >= 0 ? "text-gain" : "text-loss",
        }
      : null,
    boughtUsd !== null || boughtAmount !== null
      ? {
          label: "Bought",
          value: boughtUsd !== null ? formatUsdStat(boughtUsd) : "N/A",
          hint:
            boughtAmount !== null
              ? `Qty ${boughtAmount.toLocaleString(undefined, { maximumFractionDigits: 6 })}`
              : "No amount",
          toneClass: "text-foreground",
        }
      : null,
    soldUsd !== null || soldAmount !== null
      ? {
          label: "Sold",
          value: soldUsd !== null ? formatUsdStat(soldUsd) : "N/A",
          hint:
            soldAmount !== null
              ? `Qty ${soldAmount.toLocaleString(undefined, { maximumFractionDigits: 6 })}`
              : "No amount",
          toneClass: "text-foreground",
        }
      : null,
    holdingUsd !== null || holdingAmount !== null
      ? {
          label: "Holding",
          value: holdingUsd !== null ? formatUsdStat(holdingUsd) : "N/A",
          hint:
            holdingAmount !== null
              ? `Qty ${holdingAmount.toLocaleString(undefined, { maximumFractionDigits: 6 })}`
              : "No position",
          toneClass: "text-foreground",
        }
      : null,
  ].filter(Boolean);

  // Calculate multiplier displays for each mcap field
  const multiplierLive = formatMultiplier(post.entryMcap, currentMcap);
  const multiplier1h = formatMultiplier(post.entryMcap, localMcap1h);
  const multiplier6h = formatMultiplier(post.entryMcap, localMcap6h);
  const multiplierCurrent = formatMultiplier(post.entryMcap, currentMcap);

  // Calculate 6H percent change if available
  const percentChange6h = localMcap6h !== null ? calculatePercentChange(post.entryMcap, localMcap6h) : null;
  const isGain6h = percentChange6h !== null && percentChange6h > 0;
  const isLoss6h = percentChange6h !== null && percentChange6h < 0;

  // Calculate current mcap vs entry (for settled posts showing current as reference)
  const percentChangeCurrent = currentMcap !== null ? calculatePercentChange(post.entryMcap, currentMcap) : null;
  const isGainCurrent = percentChangeCurrent !== null && percentChangeCurrent > 0;
  const isLossCurrent = percentChangeCurrent !== null && percentChangeCurrent < 0;

  // Helper function to get styling classes based on multiplier tier
  const getMultiplierClasses = (display: MultiplierDisplay | null) => {
    if (!display) return { text: "text-muted-foreground", bg: "", glow: "" };

    switch (display.tier) {
      case 'negative':
        return { text: "text-loss", bg: "bg-loss/10", glow: "" };
      case 'low':
        return { text: "text-gain", bg: "bg-gain/10", glow: "" };
      case 'medium':
        return { text: "text-gain font-bold", bg: "bg-gain/15", glow: "" };
      case 'high':
        return { text: "text-yellow-500 font-bold", bg: "bg-yellow-500/15", glow: "" };
      case 'mega':
        return {
          text: "text-yellow-400 font-black",
          bg: "bg-gradient-to-r from-yellow-500/20 to-amber-500/20",
          glow: "shadow-[0_0_20px_rgba(234,179,8,0.4)]"
        };
      default:
        return { text: "text-muted-foreground", bg: "", glow: "" };
    }
  };

  // Calculate time until settlement (1 hour from creation)
  const createdAt = new Date(post.createdAt);
  const settlesAt = new Date(createdAt.getTime() + 60 * 60 * 1000);
  const now = new Date();
  const timeUntilSettlement = Math.max(0, settlesAt.getTime() - now.getTime());
  const minutesLeft = Math.floor(timeUntilSettlement / 60000);
  const isSettlementPending = !localSettled && timeUntilSettlement > 0 && hasContractAddress;

  const sharedByCount = post.sharedBy?.length ?? 0;

  const handleReaction = async (type: ReactionType) => {
    if (!currentUserId) return;
    const previousType = currentReactionType;
    const nextType = previousType === type ? null : type;
    const nextCounts = { ...reactionCounts };
    if (previousType) {
      nextCounts[previousType] = Math.max(0, nextCounts[previousType] - 1);
    }
    if (nextType) {
      nextCounts[nextType] += 1;
    }

    setCurrentReactionType(nextType);
    setReactionCounts(nextCounts);

    try {
      if (onReact) {
        await onReact(post.id, nextType);
      } else {
        const payload = nextType ?? previousType;
        if (!payload) {
          return;
        }
        const response = await api.post<{ reactionCounts: typeof nextCounts; currentReactionType: ReactionType | null }>(
          `/api/calls/${post.id}/reactions`,
          { type: payload }
        );
        setReactionCounts(response.reactionCounts);
        setCurrentReactionType(response.currentReactionType);
      }
    } catch (error) {
      setCurrentReactionType(previousType);
      setReactionCounts(reactionCounts);
      toast.error(error instanceof Error ? error.message : "Failed to react");
    }
  };

  const handleRepost = () => {
    setIsReposted(!isReposted);
    setRepostCount(isReposted ? repostCount - 1 : repostCount + 1);
    onRepost?.(post.id);
  };

  const handleShare = async () => {
    const url = `${window.location.origin}/post/${post.id}`;
    await navigator.clipboard.writeText(url);
    setCopied(true);
    toast.success("Link copied to clipboard");
    setTimeout(() => setCopied(false), 2000);
  };

  const refreshWinCardLiveData = useCallback(async () => {
    try {
      const latest = await api.get<BatchedPostPriceSnapshot>(`/api/posts/${post.id}/price`, {
        cache: "no-store",
      });
      if (!latest) return null;

      const snapshotVersion = getSnapshotDynamicStateVersion(latest);
      if (snapshotVersion > latestMarketStateVersionRef.current) {
        latestMarketStateVersionRef.current = snapshotVersion;
      }

      if (typeof latest.currentMcap === "number" && Number.isFinite(latest.currentMcap)) {
        setCurrentMcap(latest.currentMcap);
      }
      if (typeof latest.mcap1h === "number" && Number.isFinite(latest.mcap1h)) {
        setLocalMcap1h(latest.mcap1h);
      }
      if (typeof latest.mcap6h === "number" && Number.isFinite(latest.mcap6h)) {
        setLocalMcap6h(latest.mcap6h);
      }
      setLocalSettled(Boolean(latest.settled));
      if (post.entryMcap !== null) {
        const settledBase = latest.mcap1h ?? latest.currentMcap;
        if (typeof settledBase === "number" && Number.isFinite(settledBase)) {
          setLocalIsWin(settledBase > post.entryMcap);
        }
      }

      return latest;
    } catch {
      return null;
    }
  }, [post.entryMcap, post.id]);

  const handleOpenWinCardPreview = () => {
    setIsWinCardPreviewOpen(true);
    void refreshWinCardLiveData();
  };

  useEffect(() => {
    if (!isWinCardPreviewOpen) return;
    if (typeof window === "undefined") return;

    void refreshWinCardLiveData();
    const timerId = window.setInterval(() => {
      void refreshWinCardLiveData();
    }, 12_000);

    return () => {
      window.clearInterval(timerId);
    };
  }, [isWinCardPreviewOpen, refreshWinCardLiveData]);

  const handleDownloadWinCard = async () => {
    if (isWinCardDownloading) return;

    const latestSnapshot = await refreshWinCardLiveData();
    const liveCurrentMcap =
      latestSnapshot && typeof latestSnapshot.currentMcap === "number"
        ? latestSnapshot.currentMcap
        : currentMcap;
    const liveMcap1h =
      latestSnapshot && typeof latestSnapshot.mcap1h === "number"
        ? latestSnapshot.mcap1h
        : localMcap1h;
    const liveMcap6h =
      latestSnapshot && typeof latestSnapshot.mcap6h === "number"
        ? latestSnapshot.mcap6h
        : localMcap6h;
    const liveSettled = latestSnapshot ? Boolean(latestSnapshot.settled) : localSettled;
    const liveOfficialMcap = liveSettled ? (liveMcap1h ?? liveCurrentMcap) : liveCurrentMcap;
    const livePercentChange = calculatePercentChange(post.entryMcap, liveOfficialMcap);
    const liveProfitLossValue =
      post.entryMcap !== null && liveOfficialMcap !== null ? liveOfficialMcap - post.entryMcap : null;
    const liveIsWin =
      post.entryMcap !== null && liveOfficialMcap !== null ? liveOfficialMcap > post.entryMcap : localIsWin;
    const liveSnapshotMetrics = [
      buildWinCardSnapshotMetric("1H Snapshot", liveMcap1h),
      buildWinCardSnapshotMetric("6H Snapshot", liveMcap6h),
      buildWinCardSnapshotMetric("Current", liveCurrentMcap),
    ];

    const canvas = document.createElement("canvas");
    const width = 1200;
    const height = 820;
    const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;

    const ctx = canvas.getContext("2d");
    if (!ctx) {
      toast.error("Failed to generate win card");
      return;
    }

    ctx.scale(dpr, dpr);

    const officialValue = liveOfficialMcap;
    const profitLossValue = liveProfitLossValue;
    const isSettledWin = liveSettled && liveIsWin === true;
    const isSettledLoss = liveSettled && liveIsWin === false;
    const isPositive = profitLossValue !== null ? profitLossValue >= 0 : false;
    const accent = isSettledWin || (!liveSettled && isPositive) ? "#22c55e" : isSettledLoss ? "#ef4444" : "#94a3b8";
    const accentSoft =
      isSettledWin || (!liveSettled && isPositive)
        ? "rgba(34,197,94,0.18)"
        : isSettledLoss
          ? "rgba(239,68,68,0.16)"
          : "rgba(148,163,184,0.16)";
    const levelToneColor =
      post.author.level >= 8
        ? "#fcd34d"
        : post.author.level >= 4
          ? "#e2e8f0"
          : post.author.level >= 1
            ? "#fdba74"
            : post.author.level >= -2
              ? "#fecdd3"
              : "#fca5a5";

    const drawRoundedRect = (
      x: number,
      y: number,
      w: number,
      h: number,
      r: number
    ) => {
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.lineTo(x + w - r, y);
      ctx.quadraticCurveTo(x + w, y, x + w, y + r);
      ctx.lineTo(x + w, y + h - r);
      ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
      ctx.lineTo(x + r, y + h);
      ctx.quadraticCurveTo(x, y + h, x, y + h - r);
      ctx.lineTo(x, y + r);
      ctx.quadraticCurveTo(x, y, x + r, y);
      ctx.closePath();
    };

    const drawWrappedText = (
      text: string,
      x: number,
      y: number,
      maxWidth: number,
      lineHeight: number,
      maxLines: number
    ) => {
      const words = text.trim().split(/\s+/);
      const lines: string[] = [];
      let current = "";

      for (const word of words) {
        const next = current ? `${current} ${word}` : word;
        if (ctx.measureText(next).width <= maxWidth) {
          current = next;
          continue;
        }
        if (current) {
          lines.push(current);
          current = word;
        } else {
          lines.push(word);
          current = "";
        }
        if (lines.length >= maxLines) break;
      }

      if (lines.length < maxLines && current) {
        lines.push(current);
      }

      const trimmedLines = lines.slice(0, maxLines);
      if (lines.length > maxLines && trimmedLines.length > 0) {
        trimmedLines[trimmedLines.length - 1] = `${trimmedLines[trimmedLines.length - 1]}...`;
      }

      trimmedLines.forEach((line, index) => {
        ctx.fillText(line, x, y + index * lineHeight);
      });
      return trimmedLines.length;
    };

    const fitTextSingleLine = (text: string, maxWidth: number) => {
      const source = text.trim();
      if (!source) return "";
      if (ctx.measureText(source).width <= maxWidth) return source;
      let value = source;
      while (value.length > 1) {
        value = value.slice(0, -1);
        const candidate = `${value}...`;
        if (ctx.measureText(candidate).width <= maxWidth) {
          return candidate;
        }
      }
      return "...";
    };

    const drawPanel = (
      x: number,
      y: number,
      w: number,
      h: number,
      options?: {
        glowColor?: string;
        fillStops?: Array<[number, string]>;
        strokeStyle?: string;
        topGlow?: string;
      }
    ) => {
      if (options?.glowColor) {
        ctx.save();
        ctx.shadowColor = options.glowColor;
        ctx.shadowBlur = 24;
        drawRoundedRect(x, y, w, h, 26);
        ctx.fillStyle = "rgba(0,0,0,0.02)";
        ctx.fill();
        ctx.restore();
      }

      const fill = ctx.createLinearGradient(x, y, x + w, y + h);
      const stops =
        options?.fillStops ??
        [
          [0, "rgba(12,18,28,0.96)"],
          [0.55, "rgba(10,15,24,0.92)"],
          [1, "rgba(7,11,18,0.95)"],
        ];
      stops.forEach(([stop, color]) => fill.addColorStop(stop, color));

      drawRoundedRect(x, y, w, h, 26);
      ctx.fillStyle = fill;
      ctx.fill();
      ctx.strokeStyle = options?.strokeStyle ?? "rgba(255,255,255,0.08)";
      ctx.lineWidth = 1.2;
      ctx.stroke();

      if (options?.topGlow) {
        drawRoundedRect(x, y, w, 12, 26);
        const topFill = ctx.createLinearGradient(x, y, x + w, y);
        topFill.addColorStop(0, options.topGlow);
        topFill.addColorStop(1, "rgba(255,255,255,0)");
        ctx.fillStyle = topFill;
        ctx.fill();
      }
    };

    const titleName = post.author.username ? `@${post.author.username}` : post.author.name;
    const tokenPrimary = post.tokenSymbol || post.tokenName || "TOKEN";
    const tokenSecondary = post.tokenName && post.tokenSymbol ? post.tokenName : (post.contractAddress ? `${post.contractAddress.slice(0, 6)}...${post.contractAddress.slice(-4)}` : "No contract");
    const resultLabel = liveSettled ? (isSettledWin ? "WIN CARD" : "RESULT CARD") : "LIVE CARD";
    const resultText =
      livePercentChange !== null
        ? `${livePercentChange >= 0 ? "+" : ""}${livePercentChange.toFixed(2)}%`
        : "N/A";
    const verifiedPnlText =
      verifiedTotalPnlUsd === null
        ? null
        : `${verifiedTotalPnlUsd >= 0 ? "+" : "-"}${formatUsdStat(Math.abs(verifiedTotalPnlUsd))}`;
    const verifiedPnlLabel =
      verifiedTotalPnlUsd === null
        ? null
        : verifiedTotalPnlUsd >= 0
          ? "Wallet Profit"
          : "Wallet Loss";
    const postPreview = stripContractAddress(post.content) || post.content || "No description";
    const interactionsText = `${likeCount} likes / ${commentCount} comments / ${repostCount} reposts`;
    const logoMarkSrc = exactLogoImageSrc;
    const logoMarkFallbackSrc = "/phew-mark.svg";
    const authorAvatarSrc = getAvatarUrl(post.author.id, post.author.image);
    const loadCanvasImage = (src: string | null | undefined) =>
      new Promise<HTMLImageElement | null>((resolve) => {
        if (!src) {
          resolve(null);
          return;
        }
        const img = new Image();
        if (/^https?:\/\//i.test(src)) {
          img.crossOrigin = "anonymous";
        }
        img.onload = () => resolve(img);
        img.onerror = () => resolve(null);
        img.src = src;
      });
    const loadFirstCanvasImage = async (sources: Array<string | null | undefined>) => {
      for (const src of sources) {
        const img = await loadCanvasImage(src);
        if (img) return img;
      }
      return null;
    };

    const liveMetricCards = [
      {
        label: "Entry MCAP",
        value: formatMarketCap(post.entryMcap),
        hint: "Position opened",
        emphasis: false,
        tone: "#f8fafc",
      },
      {
        label: liveSettled ? "Official MCAP" : "Reference MCAP",
        value: formatMarketCap(officialValue),
        hint: liveSettled ? "1H benchmark locked" : "Live benchmark",
        emphasis: false,
        tone: "#f8fafc",
      },
      {
        label: liveSettled ? "Current MCAP (Live)" : "Current MCAP",
        value: formatMarketCap(liveCurrentMcap),
        hint: "Latest tracked MCAP",
        emphasis: true,
        tone: "#f8fafc",
      },
      {
        label: profitLossValue === null ? "MCAP Delta" : profitLossValue >= 0 ? "MCAP Gain" : "MCAP Drop",
        value:
          profitLossValue === null
            ? "N/A"
            : `${profitLossValue >= 0 ? "+" : "-"}${formatMarketCap(Math.abs(profitLossValue))}`,
        hint: "Versus entry",
        emphasis: false,
        tone: profitLossValue === null ? "#f8fafc" : isPositive ? "#86efac" : "#fda4af",
      },
    ];

    const liveSnapshotRows = [
      { shortLabel: "1H", ...liveSnapshotMetrics[0] },
      { shortLabel: "6H", ...liveSnapshotMetrics[1] },
      { shortLabel: "NOW", ...liveSnapshotMetrics[2] },
    ];

    const liveWalletSummaryRows: Array<{ label: string; value: string; tone: string }> = [];
    if (verifiedPnlText) {
      liveWalletSummaryRows.push({
        label: verifiedPnlLabel ?? "Wallet P/L",
        value: verifiedPnlText,
        tone: verifiedTotalPnlUsd !== null && verifiedTotalPnlUsd >= 0 ? "#86efac" : "#fda4af",
      });
    }
    if (boughtUsd !== null) {
      liveWalletSummaryRows.push({
        label: "Bought",
        value: formatUsdStat(boughtUsd),
        tone: "#f8fafc",
      });
    }
    if (soldUsd !== null) {
      liveWalletSummaryRows.push({
        label: "Sold",
        value: formatUsdStat(soldUsd),
        tone: "#f8fafc",
      });
    }
    if (holdingUsd !== null) {
      liveWalletSummaryRows.push({
        label: "Holding",
        value: formatUsdStat(holdingUsd),
        tone: "#f8fafc",
      });
    }

    setIsWinCardDownloading(true);
    try {
      const [brandMarkImg, authorAvatarImg] = await Promise.all([
        loadFirstCanvasImage([logoMarkSrc, logoMarkFallbackSrc]),
        loadCanvasImage(authorAvatarSrc),
      ]);

      ctx.fillStyle = "#061018";
      ctx.fillRect(0, 0, width, height);

      const pageGradient = ctx.createLinearGradient(0, 0, width, height);
      pageGradient.addColorStop(0, "#081420");
      pageGradient.addColorStop(0.45, "#07111a");
      pageGradient.addColorStop(1, "#04080f");
      ctx.fillStyle = pageGradient;
      ctx.fillRect(0, 0, width, height);

      const leftGlow = ctx.createRadialGradient(220, 180, 20, 220, 180, 360);
      leftGlow.addColorStop(0, "rgba(163,230,53,0.18)");
      leftGlow.addColorStop(0.55, "rgba(163,230,53,0.07)");
      leftGlow.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = leftGlow;
      ctx.fillRect(-40, -40, 520, 500);

      const rightGlow = ctx.createRadialGradient(980, 190, 20, 980, 190, 360);
      rightGlow.addColorStop(0, "rgba(45,212,191,0.16)");
      rightGlow.addColorStop(0.58, "rgba(45,212,191,0.06)");
      rightGlow.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = rightGlow;
      ctx.fillRect(700, -20, 460, 500);

      const accentGlow = ctx.createRadialGradient(540, 620, 20, 540, 620, 320);
      accentGlow.addColorStop(0, accentSoft);
      accentGlow.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = accentGlow;
      ctx.fillRect(240, 420, 620, 320);

      ctx.save();
      ctx.globalAlpha = 0.05;
      ctx.strokeStyle = "rgba(255,255,255,0.8)";
      ctx.lineWidth = 1;
      for (let y = -height; y < width; y += 34) {
        ctx.beginPath();
        ctx.moveTo(y, 0);
        ctx.lineTo(y + height, height);
        ctx.stroke();
      }
      ctx.restore();

      drawPanel(36, 34, width - 72, height - 68, {
        fillStops: [
          [0, "rgba(8,12,20,0.97)"],
          [0.55, "rgba(7,12,18,0.94)"],
          [1, "rgba(5,8,13,0.97)"],
        ],
        strokeStyle: "rgba(255,255,255,0.1)",
        topGlow: "rgba(255,255,255,0.05)",
      });

      ctx.save();
      ctx.beginPath();
      drawRoundedRect(36, 34, width - 72, height - 68, 34);
      ctx.clip();
      ctx.strokeStyle = "rgba(255,255,255,0.045)";
      ctx.lineWidth = 1;
      for (let x = 60; x < width; x += 52) {
        ctx.beginPath();
        ctx.moveTo(x, 34);
        ctx.lineTo(x, height - 34);
        ctx.stroke();
      }
      ctx.restore();

      drawRoundedRect(72, 66, 328, 66, 22);
      ctx.fillStyle = "rgba(255,255,255,0.05)";
      ctx.fill();
      ctx.strokeStyle = "rgba(255,255,255,0.08)";
      ctx.lineWidth = 1.2;
      ctx.stroke();

      drawRoundedRect(88, 79, 42, 42, 14);
      ctx.fillStyle = "rgba(255,255,255,0.04)";
      ctx.fill();
      ctx.strokeStyle = "rgba(255,255,255,0.08)";
      ctx.stroke();
      if (brandMarkImg) {
        ctx.save();
        ctx.beginPath();
        drawRoundedRect(91, 82, 36, 36, 11);
        ctx.clip();
        ctx.drawImage(brandMarkImg, 91, 82, 36, 36);
        ctx.restore();
      } else {
        ctx.fillStyle = "#f8fafc";
        ctx.font = "800 18px Inter, system-ui, sans-serif";
        ctx.textAlign = "center";
        ctx.fillText("P", 109, 106);
        ctx.textAlign = "start";
      }

      ctx.font = "800 27px Inter, system-ui, sans-serif";
      ctx.fillStyle = "#f8fafc";
      ctx.fillText("PHEW", 144, 102);
      const runOffset = 144 + ctx.measureText("PHEW").width;
      const runFill = ctx.createLinearGradient(runOffset, 76, runOffset + 86, 106);
      runFill.addColorStop(0, "#A9FF34");
      runFill.addColorStop(0.55, "#76FF44");
      runFill.addColorStop(1, "#41E8CF");
      ctx.fillStyle = runFill;
      ctx.fillText(".RUN", runOffset, 102);

      ctx.fillStyle = "rgba(226,232,240,0.62)";
      ctx.font = "600 12px Inter, system-ui, sans-serif";
      ctx.fillText("Official alpha result card", 144, 122);

      drawRoundedRect(944, 72, 184, 42, 20);
      const headerChipFill = ctx.createLinearGradient(944, 72, 1128, 114);
      headerChipFill.addColorStop(0, accentSoft);
      headerChipFill.addColorStop(1, "rgba(255,255,255,0.035)");
      ctx.fillStyle = headerChipFill;
      ctx.fill();
      ctx.strokeStyle = accent;
      ctx.lineWidth = 1.4;
      ctx.stroke();
      ctx.fillStyle = "#f8fafc";
      ctx.font = "800 13px Inter, system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(resultLabel, 1036, 98);
      ctx.textAlign = "start";

      drawRoundedRect(72, 144, 1056, 42, 16);
      ctx.fillStyle = "rgba(255,255,255,0.045)";
      ctx.fill();
      ctx.strokeStyle = "rgba(255,255,255,0.08)";
      ctx.stroke();
      ctx.fillStyle = "rgba(226,232,240,0.82)";
      ctx.font = "500 15px Inter, system-ui, sans-serif";
      ctx.fillText(winCardShareIntro, 96, 170);

      drawPanel(72, 170, 538, 198, {
        glowColor: `${accent}22`,
        fillStops: [
          [0, "rgba(12,18,28,0.96)"],
          [0.62, "rgba(8,14,22,0.93)"],
          [1, "rgba(8,14,20,0.95)"],
        ],
        strokeStyle: "rgba(255,255,255,0.08)",
        topGlow: accentSoft,
      });

      ctx.fillStyle = "rgba(226,232,240,0.72)";
      ctx.font = "700 12px Inter, system-ui, sans-serif";
      ctx.fillText(liveSettled ? "Settled performance" : "Live performance", 100, 206);
      ctx.fillStyle = accent;
      ctx.shadowColor = `${accent}44`;
      ctx.shadowBlur = 18;
      ctx.font = "800 74px Inter, system-ui, sans-serif";
      ctx.fillText(resultText, 96, 284);
      ctx.shadowBlur = 0;
      ctx.fillStyle = "rgba(226,232,240,0.68)";
      ctx.font = "600 17px Inter, system-ui, sans-serif";
      ctx.fillText(liveSettled ? "1H benchmark locked" : "Live market snapshot", 102, 316);

      const heroInfoChips = [
        {
          label: liveMetricCards[3].label.toUpperCase(),
          value: liveMetricCards[3].value,
          tone: liveMetricCards[3].tone,
        },
        verifiedPnlText
          ? {
              label: (verifiedPnlLabel ?? "Wallet P/L").toUpperCase(),
              value: verifiedPnlText,
              tone: verifiedTotalPnlUsd !== null && verifiedTotalPnlUsd >= 0 ? "#86efac" : "#fda4af",
            }
          : {
              label: "STATUS",
              value: liveSettled ? "Benchmark locked" : "Live updates on",
              tone: "#f8fafc",
            },
      ];

      heroInfoChips.forEach((chip, index) => {
        const chipX = 100 + index * 208;
        const chipY = 302;
        const chipH = 48;
        drawRoundedRect(chipX, chipY, 188, chipH, 18);
        ctx.fillStyle = "rgba(255,255,255,0.045)";
        ctx.fill();
        ctx.strokeStyle = "rgba(255,255,255,0.06)";
        ctx.stroke();
        ctx.fillStyle = "rgba(226,232,240,0.54)";
        ctx.font = "700 10px Inter, system-ui, sans-serif";
        ctx.fillText(chip.label, chipX + 16, chipY + 18);
        ctx.fillStyle = chip.tone;
        ctx.font = "700 16px Inter, system-ui, sans-serif";
        ctx.fillText(fitTextSingleLine(chip.value, 156), chipX + 16, chipY + 38);
      });

      drawPanel(626, 170, 502, 198, {
        fillStops: [
          [0, "rgba(14,19,29,0.95)"],
          [1, "rgba(9,14,21,0.94)"],
        ],
        strokeStyle: "rgba(255,255,255,0.08)",
        topGlow: "rgba(255,255,255,0.06)",
      });

      drawRoundedRect(652, 196, 64, 64, 22);
      ctx.fillStyle = "rgba(255,255,255,0.05)";
      ctx.fill();
      ctx.strokeStyle = "rgba(255,255,255,0.08)";
      ctx.stroke();
      if (authorAvatarImg) {
        ctx.save();
        ctx.beginPath();
        drawRoundedRect(658, 202, 52, 52, 18);
        ctx.clip();
        ctx.drawImage(authorAvatarImg, 658, 202, 52, 52);
        ctx.restore();
      } else {
        ctx.fillStyle = "#f8fafc";
        ctx.font = "700 24px Inter, system-ui, sans-serif";
        ctx.textAlign = "center";
        ctx.fillText((post.author.username || post.author.name || "?").charAt(0).toUpperCase(), 684, 238);
        ctx.textAlign = "start";
      }

      ctx.fillStyle = "#f8fafc";
      ctx.font = "700 28px Inter, system-ui, sans-serif";
      ctx.fillText(fitTextSingleLine(titleName, 330), 734, 222);
      ctx.fillStyle = "rgba(226,232,240,0.66)";
      ctx.font = "600 13px Inter, system-ui, sans-serif";
      ctx.fillText(
        `Level ${post.author.level > 0 ? `+${post.author.level}` : post.author.level} / ${formatTimeAgo(post.createdAt)}`,
        734,
        246
      );

      drawRoundedRect(984, 196, 118, 34, 17);
      const chainPillFill = ctx.createLinearGradient(984, 196, 1102, 230);
      chainPillFill.addColorStop(0, "rgba(163,230,53,0.11)");
      chainPillFill.addColorStop(1, "rgba(45,212,191,0.1)");
      ctx.fillStyle = chainPillFill;
      ctx.fill();
      ctx.strokeStyle = "rgba(255,255,255,0.08)";
      ctx.stroke();
      ctx.fillStyle = "#d9f99d";
      ctx.font = "700 13px Inter, system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(post.chainType?.toUpperCase() || "CHAIN", 1043, 218);
      ctx.textAlign = "start";

      drawRoundedRect(652, 278, 450, 64, 18);
      const tokenCardFill = ctx.createLinearGradient(652, 278, 1102, 342);
      tokenCardFill.addColorStop(0, "rgba(163,230,53,0.06)");
      tokenCardFill.addColorStop(0.45, "rgba(255,255,255,0.03)");
      tokenCardFill.addColorStop(1, "rgba(45,212,191,0.06)");
      ctx.fillStyle = tokenCardFill;
      ctx.fill();
      ctx.strokeStyle = "rgba(255,255,255,0.08)";
      ctx.stroke();
      ctx.fillStyle = "rgba(226,232,240,0.55)";
      ctx.font = "700 10px Inter, system-ui, sans-serif";
      ctx.fillText("CALLED TOKEN", 676, 300);
      ctx.fillStyle = "#f8fafc";
      ctx.font = "700 23px Inter, system-ui, sans-serif";
      ctx.fillText(fitTextSingleLine(tokenPrimary, 250), 676, 323);
      ctx.fillStyle = "rgba(226,232,240,0.66)";
      ctx.font = "600 13px Inter, system-ui, sans-serif";
      ctx.fillText(fitTextSingleLine(tokenSecondary, 220), 676, 345);

      drawRoundedRect(940, 286, 142, 42, 16);
      ctx.fillStyle = "rgba(255,255,255,0.05)";
      ctx.fill();
      ctx.strokeStyle = "rgba(255,255,255,0.06)";
      ctx.stroke();
      if (brandMarkImg) {
        ctx.drawImage(brandMarkImg, 950, 293, 28, 28);
      }
      ctx.fillStyle = levelToneColor;
      ctx.font = "700 13px Inter, system-ui, sans-serif";
      ctx.fillText(`${winCardLevelLabel} / LVL ${post.author.level > 0 ? `+${post.author.level}` : post.author.level}`, 986, 312);

      const levelTrackX = 652;
      const levelTrackY = 350;
      const levelTrackW = 450;
      const levelTrackH = 8;
      drawRoundedRect(levelTrackX, levelTrackY, levelTrackW, levelTrackH, 4);
      ctx.fillStyle = "rgba(255,255,255,0.09)";
      ctx.fill();
      const levelFillW = Math.max(18, Math.round(levelTrackW * winCardLevelProgressRatio));
      const levelFill = ctx.createLinearGradient(levelTrackX, levelTrackY, levelTrackX + levelFillW, levelTrackY);
      if (post.author.level >= 8) {
        levelFill.addColorStop(0, "#f59e0b");
        levelFill.addColorStop(1, "#fde68a");
      } else if (post.author.level >= 4) {
        levelFill.addColorStop(0, "#94a3b8");
        levelFill.addColorStop(1, "#e2e8f0");
      } else if (post.author.level >= 1) {
        levelFill.addColorStop(0, "#f97316");
        levelFill.addColorStop(1, "#fdba74");
      } else if (post.author.level >= -2) {
        levelFill.addColorStop(0, "#fb7185");
        levelFill.addColorStop(1, "#fecdd3");
      } else {
        levelFill.addColorStop(0, "#dc2626");
        levelFill.addColorStop(1, "#f87171");
      }
      drawRoundedRect(levelTrackX, levelTrackY, levelFillW, levelTrackH, 4);
      ctx.fillStyle = levelFill;
      ctx.fill();

      // Metrics row
      const metricY = 388;
      const metricGap = 16;
      const metricW = 252;
      const metricH = 108;
      liveMetricCards.forEach((metric, index) => {
        const x = 72 + index * (metricW + metricGap);
        drawPanel(x, metricY, metricW, metricH, {
          fillStops: metric.emphasis
            ? [
                [0, "rgba(163,230,53,0.12)"],
                [0.52, "rgba(12,18,28,0.94)"],
                [1, "rgba(45,212,191,0.12)"],
              ]
            : undefined,
          strokeStyle: metric.emphasis ? "rgba(196,255,99,0.28)" : "rgba(255,255,255,0.08)",
          topGlow: metric.emphasis ? "rgba(163,230,53,0.24)" : "rgba(255,255,255,0.045)",
        });
        ctx.fillStyle = "rgba(226,232,240,0.56)";
        ctx.font = "700 11px Inter, system-ui, sans-serif";
        ctx.fillText(metric.label.toUpperCase(), x + 18, metricY + 26);
        ctx.fillStyle = metric.tone;
        ctx.font = "800 27px Inter, system-ui, sans-serif";
        ctx.fillText(fitTextSingleLine(metric.value, metricW - 36), x + 18, metricY + 62);
        ctx.fillStyle = "rgba(226,232,240,0.62)";
        ctx.font = "600 12px Inter, system-ui, sans-serif";
        ctx.fillText(metric.hint, x + 18, metricY + 88);
      });

      drawPanel(72, 518, 352, 156, {
        strokeStyle: "rgba(255,255,255,0.08)",
        topGlow: "rgba(255,255,255,0.05)",
      });
      ctx.fillStyle = "rgba(226,232,240,0.6)";
      ctx.font = "700 11px Inter, system-ui, sans-serif";
      ctx.fillText("SNAPSHOT LADDER", 94, 546);
      liveSnapshotRows.forEach((row, index) => {
        const rowY = 574 + index * 32;
        ctx.fillStyle = "rgba(255,255,255,0.08)";
        drawRoundedRect(94, rowY - 4, 42, 10, 5);
        ctx.fill();
        ctx.fillStyle =
          row.positive === null ? "rgba(148,163,184,0.55)" : row.positive ? "rgba(34,197,94,0.88)" : "rgba(239,68,68,0.88)";
        drawRoundedRect(94, rowY - 4, Math.max(8, Math.round(42 * row.magnitudeRatio)), 10, 5);
        ctx.fill();
        ctx.fillStyle = "rgba(226,232,240,0.72)";
        ctx.font = "700 13px Inter, system-ui, sans-serif";
        ctx.fillText(row.shortLabel, 152, rowY + 4);
        ctx.fillStyle = row.positive === null ? "#e2e8f0" : row.positive ? "#86efac" : "#fda4af";
        ctx.font = "700 14px Inter, system-ui, sans-serif";
        ctx.fillText(row.percentText, 206, rowY + 4);
        ctx.textAlign = "right";
        ctx.fillStyle = row.positive === null ? "rgba(226,232,240,0.66)" : row.positive ? "#dcfce7" : "#fecdd3";
        ctx.fillText(row.profitText, 396, rowY + 4);
        ctx.textAlign = "start";
      });

      drawPanel(440, 518, 280, 156, {
        strokeStyle: "rgba(255,255,255,0.08)",
        topGlow: "rgba(255,255,255,0.05)",
      });
      ctx.fillStyle = "rgba(226,232,240,0.6)";
      ctx.font = "700 11px Inter, system-ui, sans-serif";
      ctx.fillText(hasWalletTradeInfo ? "WALLET SUMMARY" : "ENGAGEMENT", 462, 546);
      if (liveWalletSummaryRows.length > 0) {
        liveWalletSummaryRows.slice(0, 3).forEach((row, index) => {
          const rowY = 578 + index * 34;
          drawRoundedRect(462, rowY - 16, 236, 28, 12);
          ctx.fillStyle = "rgba(255,255,255,0.04)";
          ctx.fill();
          ctx.fillStyle = "rgba(226,232,240,0.56)";
          ctx.font = "700 10px Inter, system-ui, sans-serif";
          ctx.fillText(row.label.toUpperCase(), 474, rowY - 1);
          ctx.textAlign = "right";
          ctx.fillStyle = row.tone;
          ctx.font = "700 14px Inter, system-ui, sans-serif";
          ctx.fillText(row.value, 684, rowY - 1);
          ctx.textAlign = "start";
        });
      } else {
        [interactionsText, liveSettled ? "1H benchmark locked" : "Live market snapshot"].forEach((item, index) => {
          const rowY = 582 + index * 34;
          drawRoundedRect(462, rowY - 16, 236, 28, 12);
          ctx.fillStyle = "rgba(255,255,255,0.04)";
          ctx.fill();
          ctx.fillStyle = "rgba(226,232,240,0.82)";
          ctx.font = "600 13px Inter, system-ui, sans-serif";
          ctx.fillText(fitTextSingleLine(item, 214), 474, rowY - 1);
        });
      }

      drawPanel(736, 518, 392, 156, {
        strokeStyle: "rgba(255,255,255,0.08)",
        topGlow: accentSoft,
      });
      ctx.fillStyle = "rgba(226,232,240,0.6)";
      ctx.font = "700 11px Inter, system-ui, sans-serif";
      ctx.fillText("ALPHA NOTES", 758, 546);
      ctx.fillStyle = "#e5e7eb";
      ctx.font = "500 20px Inter, system-ui, sans-serif";
      drawWrappedText(postPreview, 758, 582, 340, 26, 3);
      ctx.fillStyle = "rgba(226,232,240,0.58)";
      ctx.font = "600 12px Inter, system-ui, sans-serif";
      ctx.fillText(`Post ID ${post.id.slice(0, 10)}...`, 758, 652);

      ctx.strokeStyle = "rgba(255,255,255,0.06)";
      ctx.beginPath();
      ctx.moveTo(72, 760);
      ctx.lineTo(width - 72, 760);
      ctx.stroke();
      ctx.fillStyle = "rgba(226,232,240,0.64)";
      ctx.font = "600 12px Inter, system-ui, sans-serif";
      ctx.fillText("Generated on PHEW.RUN for fast sharing", 82, 786);
      ctx.textAlign = "right";
      ctx.fillText(
        liveSettled ? "Settlement verified snapshot" : "Live snapshot at export time",
        width - 82,
        786
      );
      ctx.textAlign = "start";

      const filenameBase = (post.tokenSymbol || post.author.username || post.author.name || "phew-post")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 32) || "phew-post";
      const filename = `phew-${liveSettled && isSettledWin ? "wincard" : "result-card"}-${filenameBase}.png`;

      const triggerDownload = (url: string) => {
        const link = document.createElement("a");
        link.href = url;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        link.remove();
      };

      if (canvas.toBlob) {
        await new Promise<void>((resolve, reject) => {
          canvas.toBlob((blob) => {
            if (!blob) {
              reject(new Error("Failed to render image"));
              return;
            }
            const objectUrl = URL.createObjectURL(blob);
            triggerDownload(objectUrl);
            setTimeout(() => URL.revokeObjectURL(objectUrl), 1500);
            resolve();
          }, "image/png");
        });
      } else {
        triggerDownload(canvas.toDataURL("image/png"));
      }

      toast.success(liveSettled && isSettledWin ? "Wincard downloaded" : "Result card downloaded");
    } catch (error) {
      console.error("[wincard] Failed to generate card", error);
      toast.error("Failed to generate win card");
    } finally {
      setIsWinCardDownloading(false);
    }
  };

  const handleSubmitComment = async () => {
    if (!commentText.trim() || !currentUserId) return;
    const trimmedComment = commentText.trim();
    const previousComments = queryClient.getQueryData<Comment[]>(["callThread", post.id]);
    const optimisticCommentId = `optimistic-${post.id}-${Date.now()}`;
    const optimisticComment: Comment = {
      id: optimisticCommentId,
      content: trimmedComment,
      authorId: currentUserId,
      author: {
        id: currentUserId,
        name: "You",
        username: null,
        image: null,
        level: 0,
        xp: 0,
      },
      postId: post.id,
      parentId: replyingToComment?.id ?? null,
      rootId: replyingToComment?.rootId ?? replyingToComment?.id ?? null,
      depth: Math.min(4, (replyingToComment?.depth ?? -1) + 1),
      kind: "general",
      replyCount: 0,
      createdAt: new Date().toISOString(),
    };

    try {
      setCommentText("");
      setReplyingToComment(null);
      setCommentCount((prev) => prev + 1);
      if (isCommentsOpen && previousComments) {
        queryClient.setQueryData<Comment[]>(["callThread", post.id], [...previousComments, optimisticComment]);
      }

      await api.post(`/api/calls/${post.id}/comments`, {
        content: trimmedComment,
        parentId: replyingToComment?.id,
      });
      void refetchComments();
    } catch (error: unknown) {
      setCommentText(trimmedComment);
      setCommentCount((prev) => Math.max(0, prev - 1));
      if (isCommentsOpen && previousComments) {
        queryClient.setQueryData<Comment[]>(["callThread", post.id], previousComments);
      }
      const err = error as { message?: string };
      toast.error(err.message || "Failed to add comment");
    }
  };

  const getDexscreenerUrl = () => {
    if (post.dexscreenerUrl) return post.dexscreenerUrl;
    if (!post.contractAddress) return null;
    const chain = post.chainType === "solana" ? "solana" : "ethereum";
    return `https://dexscreener.com/${chain}/${post.contractAddress}`;
  };

  const dexscreenerUrl = getDexscreenerUrl();
  const isSolanaTradeSupported = post.chainType === "solana" && !!post.contractAddress;
  const parsedBuyAmountSol = Number(buyAmountSol);
  const buyAmountLamports =
    Number.isFinite(parsedBuyAmountSol) && parsedBuyAmountSol > 0
      ? Math.max(1, Math.floor(parsedBuyAmountSol * LAMPORTS_PER_SOL))
      : null;
  const dexTokenDataQuery = useQuery({
    queryKey: ["dexTokenData", post.chainType, post.contractAddress],
    enabled:
      hasContractAddress &&
      (isBuyDialogOpen ||
        isInViewport ||
        !post.tokenImage ||
        !post.tokenName ||
        !post.tokenSymbol ||
        !post.dexscreenerUrl),
    staleTime: 3 * 60 * 1000,
    retry: 1,
    refetchOnWindowFocus: false,
    refetchInterval: isBuyDialogOpen ? 20_000 : false,
    queryFn: async () => {
      if (!post.contractAddress) return null;
      return fetchDexscreenerTokenData({
        contractAddress: post.contractAddress,
        chainType: post.chainType ?? null,
      });
    },
  });
  const solSpotPriceQuery = useQuery({
    queryKey: ["dexTokenData", "solana", SOL_MINT, "spot"],
    enabled: isBuyDialogOpen && isSolanaTradeSupported,
    staleTime: 60_000,
    retry: 1,
    refetchOnWindowFocus: false,
    refetchInterval: isBuyDialogOpen ? 60_000 : false,
    queryFn: async () =>
      fetchDexscreenerTokenData({
        contractAddress: SOL_MINT,
        chainType: "solana",
      }),
  });
  const resolvedTokenImage = post.tokenImage ?? dexTokenDataQuery.data?.tokenImage ?? null;
  const resolvedTokenName = post.tokenName ?? dexTokenDataQuery.data?.tokenName ?? null;
  const resolvedTokenSymbol = post.tokenSymbol ?? dexTokenDataQuery.data?.tokenSymbol ?? null;
  const resolvedDexscreenerUrl = post.dexscreenerUrl ?? dexTokenDataQuery.data?.dexscreenerUrl ?? dexscreenerUrl;
  const resolvedPriceUsd = dexTokenDataQuery.data?.priceUsd ?? null;
  const resolvedMarketCap = currentMcap ?? dexTokenDataQuery.data?.marketCap ?? null;
  const resolvedLiquidityUsd = dexTokenDataQuery.data?.liquidityUsd ?? null;
  const resolvedVolume24hUsd = dexTokenDataQuery.data?.volume24hUsd ?? null;
  const resolvedPriceChange24hPct = dexTokenDataQuery.data?.priceChange24hPct ?? null;
  const resolvedBuys24h = dexTokenDataQuery.data?.buys24h ?? null;
  const resolvedSells24h = dexTokenDataQuery.data?.sells24h ?? null;
  const resolvedDexId = dexTokenDataQuery.data?.dexId ?? null;
  const resolvedPairAddress = dexTokenDataQuery.data?.pairAddress ?? null;
  const solPriceUsd = solSpotPriceQuery.data?.priceUsd ?? null;
  const displayTokenSymbol = resolvedTokenSymbol || resolvedTokenName || "TOKEN";
  const displayTokenLabel = resolvedTokenSymbol || resolvedTokenName || "Token";
  const displayTokenSubtitle =
    resolvedTokenName && resolvedTokenSymbol
      ? resolvedTokenName
      : (post.contractAddress || "No contract address");

  const chartRequestConfig = useMemo(() => {
    switch (chartInterval) {
      case "5":
        return { timeframe: "minute" as const, aggregate: 1, limit: 360 };
      case "15":
        return { timeframe: "minute" as const, aggregate: 5, limit: 360 };
      case "60":
        return { timeframe: "hour" as const, aggregate: 1, limit: 320 };
      case "240":
        return { timeframe: "hour" as const, aggregate: 4, limit: 320 };
      case "1D":
      default:
        return { timeframe: "day" as const, aggregate: 1, limit: 260 };
    }
  }, [chartInterval]);
  const canRequestChartCandles =
    !!resolvedPairAddress || !!post.contractAddress;

  const chartCandlesQuery = useQuery<ChartCandlesResponse>({
    queryKey: [
      "chartCandles",
      post.id,
      resolvedPairAddress,
      post.contractAddress,
      chartRequestConfig.timeframe,
      chartRequestConfig.aggregate,
      chartRequestConfig.limit,
    ],
    enabled: isBuyDialogOpen && canRequestChartCandles,
    staleTime: 5_000,
    placeholderData: (previousData) => previousData,
    retry: 1,
    refetchOnWindowFocus: false,
    refetchInterval:
      isBuyDialogOpen
        ? chartRequestConfig.timeframe === "minute"
          ? chartRequestConfig.aggregate <= 5
            ? 8_000
            : 12_000
          : chartRequestConfig.timeframe === "hour"
            ? 20_000
            : 60_000
        : false,
    queryFn: async () => {
      if (!canRequestChartCandles) {
        return {
          candles: [],
          source: "unknown" as const,
          network: null,
        };
      }
      const response = await fetch("/api/posts/chart/candles", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          poolAddress: resolvedPairAddress ?? undefined,
          tokenAddress: post.contractAddress ?? undefined,
          chainType: post.chainType === "solana" ? "solana" : "ethereum",
          timeframe: chartRequestConfig.timeframe,
          aggregate: chartRequestConfig.aggregate,
          limit: chartRequestConfig.limit,
        }),
      });
      if (!response.ok) {
        const body = await response.text().catch(() => "");
        throw new Error(body || `Chart request failed (${response.status})`);
      }
      const payload = (await response.json()) as {
        data?: {
          source?: string;
          network?: string | null;
          candles?: ChartCandle[];
        };
      };
      const sourceRaw = payload?.data?.source;
      const source: ChartCandlesSource =
        sourceRaw === "birdeye" || sourceRaw === "geckoterminal" ? sourceRaw : "unknown";
      return {
        candles: Array.isArray(payload?.data?.candles) ? payload.data!.candles! : [],
        source,
        network: typeof payload?.data?.network === "string" ? payload.data.network : null,
      };
    },
  });

  const outputTokenDecimalsQuery = useQuery({
    queryKey: ["jupiterTokenDecimals", post.contractAddress],
    enabled: isBuyDialogOpen && isSolanaTradeSupported,
    staleTime: 60 * 60 * 1000,
    retry: 1,
    queryFn: async () => {
      if (!post.contractAddress) return 6;
      try {
        const supply = await tradeReadConnection.getTokenSupply(new PublicKey(post.contractAddress));
        return supply.value.decimals;
      } catch {
        return null;
      }
    },
  });
  const outputTokenDecimals =
    typeof outputTokenDecimalsQuery.data === "number" ? outputTokenDecimalsQuery.data : 6;
  const hasRpcTokenDecimals = typeof outputTokenDecimalsQuery.data === "number";

  const walletNativeBalanceQuery = useQuery({
    queryKey: ["walletNativeBalance", tradeWalletAddress, tradeRpcConnections.map((rpc) => rpc.rpcEndpoint).join("|")],
    enabled: isBuyDialogOpen && isSolanaTradeSupported && !!tradeWalletPublicKey,
    staleTime: 8_000,
    retry: 1,
    refetchOnWindowFocus: false,
    refetchInterval: isBuyDialogOpen ? 15_000 : false,
    queryFn: async () => {
      if (!tradeWalletPublicKey) return null;
      for (const rpcConnection of tradeRpcConnections) {
        try {
          const lamports = await rpcConnection.getBalance(tradeWalletPublicKey, "processed");
          return lamports / LAMPORTS_PER_SOL;
        } catch {
          continue;
        }
      }
      return null;
    },
  });
  const walletNativeBalance =
    typeof walletNativeBalanceQuery.data === "number" &&
    Number.isFinite(walletNativeBalanceQuery.data)
      ? walletNativeBalanceQuery.data
      : null;
  const walletNativeBalanceLoading =
    walletNativeBalanceQuery.isLoading ||
    (walletNativeBalanceQuery.isFetching && walletNativeBalance === null);
  const refetchWalletNativeBalance = walletNativeBalanceQuery.refetch;
  const walletNativeBalanceUsd =
    walletNativeBalance !== null && solPriceUsd !== null
      ? walletNativeBalance * solPriceUsd
      : null;

  const parsedSellAmountToken = Number(sellAmountToken);
  const sellAmountAtomic =
    Number.isFinite(parsedSellAmountToken) && parsedSellAmountToken > 0 && hasRpcTokenDecimals
      ? Math.max(1, Math.floor(parsedSellAmountToken * Math.pow(10, outputTokenDecimals)))
      : null;
  const tradeAmountAtomic = tradeSide === "buy" ? buyAmountLamports : sellAmountAtomic;
  const quoteOutputDecimals = tradeSide === "buy" ? outputTokenDecimals : 9;
  const tradeInputTokenLabel = tradeSide === "buy" ? "SOL" : displayTokenSymbol;
  const tradeOutputTokenLabel = tradeSide === "buy" ? displayTokenSymbol : "SOL";

  const walletTokenBalanceQuery = useQuery({
    queryKey: [
      "walletTokenBalance",
      tradeWalletAddress,
      post.contractAddress,
      tradeRpcConnections.map((rpc) => rpc.rpcEndpoint).join("|"),
    ],
    enabled: isBuyDialogOpen && isSolanaTradeSupported && !!tradeWalletPublicKey,
    staleTime: 8_000,
    retry: 1,
    refetchOnWindowFocus: false,
    refetchInterval: isBuyDialogOpen ? 15_000 : false,
    queryFn: async () => {
      if (!tradeWalletPublicKey || !post.contractAddress) return null;
      const mint = new PublicKey(post.contractAddress);
      for (const rpcConnection of tradeRpcConnections) {
        try {
          const accounts = await rpcConnection.getParsedTokenAccountsByOwner(tradeWalletPublicKey, { mint });
          let totalUiAmount = 0;
          for (const account of accounts.value) {
            type ParsedTokenAmountLike = {
              uiAmount?: number | null;
              uiAmountString?: string;
            };
            type ParsedTokenAccountLike = {
              parsed?: {
                info?: {
                  tokenAmount?: ParsedTokenAmountLike;
                };
              };
            };
            const parsedData = account.account.data as unknown as ParsedTokenAccountLike;
            const tokenAmount = parsedData.parsed?.info?.tokenAmount;
            const uiAmount =
              typeof tokenAmount?.uiAmount === "number"
                ? tokenAmount.uiAmount
                : Number(tokenAmount?.uiAmountString ?? 0);
            if (Number.isFinite(uiAmount)) {
              totalUiAmount += uiAmount;
            }
          }
          return totalUiAmount;
        } catch {
          continue;
        }
      }
      return 0;
    },
  });
  const walletTokenBalance =
    typeof walletTokenBalanceQuery.data === "number" && Number.isFinite(walletTokenBalanceQuery.data)
      ? walletTokenBalanceQuery.data
      : null;
  const walletTokenBalanceLoading =
    walletTokenBalanceQuery.isLoading ||
    (walletTokenBalanceQuery.isFetching && walletTokenBalance === null);
  const refetchWalletTokenBalance = walletTokenBalanceQuery.refetch;
  const walletTokenBalanceFormatted =
    walletTokenBalance === null
      ? "-"
      : walletTokenBalance.toLocaleString(undefined, {
          maximumFractionDigits: Math.min(8, Math.max(2, outputTokenDecimals)),
        });
  useEffect(() => {
    if (!isBuyDialogOpen || !isSolanaTradeSupported || !tradeWalletAddress || wallet.connecting) return;
    void refetchWalletNativeBalance();
    void refetchWalletTokenBalance();
  }, [
    isBuyDialogOpen,
    isSolanaTradeSupported,
    tradeWalletAddress,
    wallet.connecting,
    wallet.connected,
    refetchWalletNativeBalance,
    refetchWalletTokenBalance,
  ]);
  const sellAmountExceedsBalance =
    tradeSide === "sell" &&
    walletTokenBalance !== null &&
    Number.isFinite(parsedSellAmountToken) &&
    parsedSellAmountToken > walletTokenBalance + 1e-9;
  const sellHasNoTokens =
    tradeSide === "sell" &&
    !!tradeWalletPublicKey &&
    walletTokenBalance !== null &&
    walletTokenBalance <= 0;
  const sellBlockedByRpcTokenInfo =
    tradeSide === "sell" && !hasRpcTokenDecimals && !sellHasNoTokens;

  const createJupiterQuotePayload = useCallback(
    (side: TradeSide, amountAtomic: number): JupiterQuoteRequestPayload | null => {
      if (!post.contractAddress) return null;

      let tokenMint = post.contractAddress.trim();
      try {
        tokenMint = new PublicKey(tokenMint).toBase58();
      } catch {
        return null;
      }

      return {
        inputMint: side === "buy" ? SOL_MINT : tokenMint,
        outputMint: side === "buy" ? tokenMint : SOL_MINT,
        amount: amountAtomic,
        slippageBps,
        swapMode: "ExactIn",
        postId: post.id,
      };
    },
    [post.contractAddress, post.id, slippageBps]
  );

  const jupiterQuoteQuery = useQuery<JupiterQuoteResponse>({
    queryKey: ["jupiterQuote", post.contractAddress, tradeSide, tradeAmountAtomic, slippageBps],
    enabled: (isBuyDialogOpen || pendingQuickBuyAutoExecute) && isSolanaTradeSupported && !!tradeAmountAtomic,
    staleTime: 2_500,
    gcTime: 45_000,
    retry: 1,
    retryDelay: (attempt) => Math.min(350, 120 * (attempt + 1)),
    placeholderData: (previousData) => previousData,
    refetchInterval: isBuyDialogOpen ? (q) => (q.state.data ? 5_000 : 2_200) : false,
    refetchOnWindowFocus: false,
    queryFn: async ({ signal }) => {
      if (!tradeAmountAtomic) {
        throw new Error("Missing token or amount");
      }
      const quotePayload = createJupiterQuotePayload(tradeSide, tradeAmountAtomic);
      if (!quotePayload) {
        throw new Error("Invalid Solana token address");
      }
      return fetchJupiterQuoteFast(quotePayload, { signal });
    },
  });
  const jupiterQuoteData = jupiterQuoteQuery.data;
  const [lastGoodQuoteBySide, setLastGoodQuoteBySide] = useState<Record<TradeSide, { quote: JupiterQuoteResponse; updatedAtMs: number } | null>>({
    buy: null,
    sell: null,
  });
  const refetchJupiterQuote = jupiterQuoteQuery.refetch;
  const walletPublicKey = tradeWalletPublicKey;
  const walletSignTransaction = wallet.signTransaction;

  useEffect(() => {
    if (!jupiterQuoteData) return;
    setLastGoodQuoteBySide((prev) => ({
      ...prev,
      [tradeSide]: {
        quote: jupiterQuoteData,
        updatedAtMs: Date.now(),
      },
    }));
  }, [jupiterQuoteData, tradeSide]);

  useEffect(() => {
    setLastGoodQuoteBySide({
      buy: null,
      sell: null,
    });
  }, [post.id]);

  const formatTokenAmountFromAtomic = (amount: string | null | undefined, decimals: number) => {
    if (!amount) return "N/A";
    const raw = Number(amount);
    if (!Number.isFinite(raw)) return "N/A";
    const value = raw / Math.pow(10, decimals);
    return value.toLocaleString(undefined, {
      maximumFractionDigits: value >= 1000 ? 2 : value >= 1 ? 4 : 6,
    });
  };

  const formatSolAtomic = (amount: string | null | undefined) => {
    if (!amount) return "N/A";
    const raw = Number(amount);
    if (!Number.isFinite(raw)) return "N/A";
    return (raw / LAMPORTS_PER_SOL).toLocaleString(undefined, {
      maximumFractionDigits: 6,
    });
  };

  const formatDecimalInputValue = (value: number, fractionDigits: number) => {
    if (!Number.isFinite(value) || value <= 0) return "";
    return value
      .toFixed(Math.max(0, Math.min(8, fractionDigits)))
      .replace(/\.?0+$/, "");
  };

  const sanitizeQuickBuyPreset = (value: string) => {
    const trimmed = value.trim();
    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed) || parsed <= 0) return "";
    const clamped = Math.min(100, Math.max(0.001, parsed));
    return formatDecimalInputValue(clamped, clamped >= 1 ? 2 : 3);
  };

  const updateQuickBuyPreset = (index: number, value: string) => {
    setQuickBuyPresetsSol((prev) =>
      prev.map((preset, i) => (i === index ? value : preset))
    );
  };

  const commitQuickBuyPreset = (index: number) => {
    setQuickBuyPresetsSol((prev) =>
      prev.map((preset, i) => {
        if (i !== index) return preset;
        const next = sanitizeQuickBuyPreset(preset);
        return next || DEFAULT_QUICK_BUY_PRESETS_SOL[index] || "0.10";
      })
    );
  };

  const resetQuickBuyPresets = () => {
    setQuickBuyPresetsSol(DEFAULT_QUICK_BUY_PRESETS_SOL);
  };

  const handleCloseBuyDialog = () => {
    setIsBuyDialogOpen(false);
  };

  const handleQuickBuyPresetClick = (amount: string) => {
    quickBuyRetryCountRef.current = 0;
    setTradeSide("buy");
    setBuyAmountSol(amount);
    setBuyTxSignature(null);
    setPendingQuickBuyAutoExecute(true);

    const parsedAmount = Number(amount);
    if (Number.isFinite(parsedAmount) && parsedAmount > 0) {
      const prefetchAmountLamports = Math.max(1, Math.floor(parsedAmount * LAMPORTS_PER_SOL));
      const prefetchPayload = createJupiterQuotePayload("buy", prefetchAmountLamports);
      if (prefetchPayload) {
        void fetchJupiterQuoteFast(prefetchPayload, {
          timeoutMs: QUICK_BUY_QUOTE_PREFETCH_TIMEOUT_MS,
        }).catch(() => {
          // Quick-buy fallback path will retry during execution.
        });
      }
    }

    if (isSolanaTradeSupported && !walletPublicKey) {
      setPendingBuyAfterWalletConnect(true);
      openWalletSelector();
      return;
    }
    // Quick-buy should execute immediately without forcing modal navigation.
    handleCloseBuyDialog();
  };

  const handlePortfolioQuickSell = useCallback((mint: string, amount: number) => {
    setTradeSide("sell");
    setSellAmountToken(String(amount));
  }, []);

  const applySlippagePercentInput = () => {
    const parsed = Number(slippageInputPercent);
    if (!Number.isFinite(parsed)) {
      setSlippageInputPercent((slippageBps / 100).toFixed(2));
      return;
    }
    const clamped = Math.min(50, Math.max(0.01, parsed));
    setSlippageBps(Math.round(clamped * 100));
  };

  const setSellAmountFromPercent = (percent: number) => {
    if (walletTokenBalance === null || walletTokenBalance <= 0) return;
    const nextValue = (walletTokenBalance * percent) / 100;
    setSellAmountToken(formatDecimalInputValue(nextValue, Math.max(2, outputTokenDecimals)));
  };

  const handleOpenBuyDialog = () => {
    setBuyTxSignature(null);
    setIsBuyDialogOpen(true);
  };

  const handleOpenTradeWalletConnectDialog = () => {
    setBuyTxSignature(null);
    setPendingBuyAfterWalletConnect(true);
    handleCloseBuyDialog();
    setIsWalletConnectDialogOpen(true);
  };

  const connectDetectedWalletDirect = useCallback(async (): Promise<boolean> => {
    if (wallet.connected || wallet.publicKey || wallet.wallet?.adapter?.publicKey) {
      return true;
    }

    const availableWallets = wallet.wallets ?? [];
    if (availableWallets.length === 0) {
      return false;
    }

    const preferredWallet =
      availableWallets.find(
        (entry) =>
          entry.adapter.readyState === WalletReadyState.Installed &&
          entry.adapter.name.toLowerCase().includes("phantom")
      ) ??
      availableWallets.find((entry) => entry.adapter.readyState === WalletReadyState.Installed) ??
      availableWallets.find((entry) => entry.adapter.readyState === WalletReadyState.Loadable) ??
      null;

    if (!preferredWallet) {
      return false;
    }

    const currentWalletName = wallet.wallet?.adapter?.name;
    if (currentWalletName !== preferredWallet.adapter.name) {
      wallet.select(preferredWallet.adapter.name);
      if (typeof window !== "undefined") {
        await new Promise<void>((resolve) => window.setTimeout(resolve, 40));
      }
    }

    await wallet.connect();
    return true;
  }, [wallet]);

  const openWalletSelector = ({
    closeBuyDialog = false,
    closeWalletConnectDialog = false,
  }: {
    closeBuyDialog?: boolean;
    closeWalletConnectDialog?: boolean;
  } = {}) => {
    if (closeBuyDialog) {
      handleCloseBuyDialog();
    }
    const shouldCloseWalletConnectDialog = closeWalletConnectDialog;
    if (wallet.connecting) {
      return;
    }
    const now = Date.now();
    if (now < walletConnectCooldownUntilRef.current) {
      return;
    }
    walletConnectCooldownUntilRef.current = now + 450;
    if (walletConnectAttemptRef.current) {
      return;
    }

    const connectAttempt = (async () => {
      if (isLikelyMobileDevice) {
        try {
          const connectedDirectly = await connectDetectedWalletDirect();
          if (connectedDirectly) {
            if (shouldCloseWalletConnectDialog) {
              setIsWalletConnectDialogOpen(false);
            }
            return true;
          }
        } catch (error) {
          console.warn("[trade] Direct mobile wallet connect failed; falling back to wallet selector", error);
        }
      }

      if (shouldCloseWalletConnectDialog) {
        setIsWalletConnectDialogOpen(false);
      }
      setWalletModalVisible(true);
      return false;
    })().finally(() => {
      walletConnectAttemptRef.current = null;
    });

    walletConnectAttemptRef.current = connectAttempt;
  };

  const handleTradeCtaClick = () => {
    handleOpenBuyDialog();
  };

  const buildSwapTransaction = useCallback(
    async (quoteOverride?: JupiterQuoteResponse): Promise<JupiterSwapResponse> => {
      if (!walletPublicKey) {
        throw new Error("Connect a Solana wallet first");
      }

      const quote = quoteOverride ?? jupiterQuoteData;
      if (!quote) {
        throw new Error("Wait for quote to load");
      }

      const cacheKey = [
        post.id,
        walletPublicKey.toBase58(),
        tradeSide,
        String(tradeAmountAtomic ?? ""),
        String(slippageBps),
        quote.inAmount,
        quote.outAmount,
        quote.otherAmountThreshold,
        String(quote.contextSlot ?? ""),
      ].join(":");

      const cached = preparedSwapRef.current;
      if (cached && cached.key === cacheKey && Date.now() - cached.cachedAt < 15_000) {
        return cached.payload;
      }

      const inFlight = swapBuildInFlightRef.current;
      if (inFlight && inFlight.key === cacheKey) {
        return inFlight.promise;
      }

      const requestPromise = (async () => {
        const swapPayloadBody = JSON.stringify({
          quoteResponse: quote,
          userPublicKey: walletPublicKey.toBase58(),
          postId: post.id,
          tradeSide,
          wrapAndUnwrapSol: true,
          dynamicComputeUnitLimit: true,
        });

        const swapRes = await api.raw("/api/posts/jupiter/swap", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: swapPayloadBody,
        });

        if (!swapRes.ok) {
          const body = await swapRes.text().catch(() => "");
          throw new Error(body || `Swap build failed (${swapRes.status})`);
        }

        const swapPayload = (await swapRes.json()) as JupiterSwapResponse;
        if (!swapPayload.swapTransaction) {
          throw new Error("No swap transaction returned");
        }

        preparedSwapRef.current = {
          key: cacheKey,
          payload: swapPayload,
          cachedAt: Date.now(),
        };
        return swapPayload;
      })().finally(() => {
        if (swapBuildInFlightRef.current?.key === cacheKey) {
          swapBuildInFlightRef.current = null;
        }
      });

      swapBuildInFlightRef.current = { key: cacheKey, promise: requestPromise };
      return requestPromise;
    },
    [jupiterQuoteData, post.id, slippageBps, tradeAmountAtomic, tradeSide, walletPublicKey]
  );

  const handleExecuteJupiterBuy = useCallback(async () => {
    if (!isSolanaTradeSupported || !post.contractAddress) {
      toast.error("Trading is available for Solana posts only");
      return;
    }
    if (!walletPublicKey) {
      toast.error("Connect a Solana wallet first");
      return;
    }
    if (!walletSignTransaction) {
      toast.error("This wallet does not support transaction signing");
      return;
    }
    const fallbackQuoteCandidate = lastGoodQuoteBySide[tradeSide];
    const fallbackQuote =
      fallbackQuoteCandidate &&
      Date.now() - fallbackQuoteCandidate.updatedAtMs <= JUPITER_QUOTE_STALE_MAX_AGE_MS
        ? fallbackQuoteCandidate.quote
        : null;
    let quote = jupiterQuoteData ?? fallbackQuote;
    if (!quote && tradeAmountAtomic) {
      const payload = createJupiterQuotePayload(tradeSide, tradeAmountAtomic);
      if (payload) {
        try {
          quote = await fetchJupiterQuoteFast(payload, {
            timeoutMs: QUICK_BUY_QUOTE_PREFETCH_TIMEOUT_MS,
          });
        } catch {
          // Keep default error path below.
        }
      }
    }
    if (!quote) {
      toast.error("Wait for quote to load");
      return;
    }
    if (sellAmountExceedsBalance) {
      toast.error("Sell amount is higher than your current token balance");
      return;
    }

    setIsExecutingBuy(true);
    setBuyTxSignature(null);
    try {
      const swapPayload = await buildSwapTransaction(quote);
      const swapTransaction = swapPayload.swapTransaction;
      if (!swapTransaction) {
        throw new Error("No swap transaction returned");
      }
      const txBytes = Uint8Array.from(atob(swapTransaction), (c) => c.charCodeAt(0));
      const tx = VersionedTransaction.deserialize(txBytes);
      const transactionForSigning = swapPayload.tradeVerificationMemo
        ? await appendTradeVerificationMemoToTransaction(
            tradeReadConnection,
            tx,
            swapPayload.tradeVerificationMemo
          )
        : tx;
      const signedTx = await walletSignTransaction(transactionForSigning);
      const sendCommitment = autoConfirmEnabled ? "processed" : "confirmed";
      const signature = await tradeReadConnection.sendRawTransaction(signedTx.serialize(), {
        maxRetries: autoConfirmEnabled ? 0 : 2,
        skipPreflight: autoConfirmEnabled,
        preflightCommitment: sendCommitment,
      });

      preparedSwapRef.current = null;
      if (typeof swapPayload.lastValidBlockHeight === "number") {
        void tradeReadConnection
          .confirmTransaction(
            {
              signature,
              blockhash: transactionForSigning.message.recentBlockhash,
              lastValidBlockHeight: swapPayload.lastValidBlockHeight,
            },
            sendCommitment
          )
          .catch((error) => {
            console.warn("[jupiter-trade] Confirmation warning", error);
          });
      } else {
        void tradeReadConnection.confirmTransaction(signature, sendCommitment).catch((error) => {
          console.warn("[jupiter-trade] Confirmation warning", error);
        });
      }

      setBuyTxSignature(signature);
      if (swapPayload.tradeFeeEventId) {
        void api.post("/api/posts/jupiter/fee-confirm", {
            tradeFeeEventId: swapPayload.tradeFeeEventId,
            txSignature: signature,
            walletAddress: walletPublicKey.toBase58(),
          }).catch((error) => {
          console.warn("[trade-fee] Failed to confirm fee event", error);
        });
      }
      toast.success(`${tradeSide === "buy" ? "Buy" : "Sell"} order sent successfully`);
      void refetchJupiterQuote();
    } catch (error) {
      preparedSwapRef.current = null;
      const message =
        error instanceof Error
          ? error.message
          : `Failed to execute ${tradeSide === "buy" ? "buy" : "sell"}`;
      console.error("[jupiter-trade] Failed to execute trade", error);
      toast.error(message);
    } finally {
      setIsExecutingBuy(false);
    }
  }, [
    buildSwapTransaction,
    isSolanaTradeSupported,
    jupiterQuoteData,
    lastGoodQuoteBySide,
    post.contractAddress,
    refetchJupiterQuote,
    sellAmountExceedsBalance,
    createJupiterQuotePayload,
    tradeAmountAtomic,
    tradeReadConnection,
    tradeSide,
    autoConfirmEnabled,
    walletPublicKey,
    walletSignTransaction,
  ]);

  // Navigate to user profile (prefer username over ID for cleaner URLs)
  const handleProfileClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigate(buildProfilePath(post.author.id, post.author.username));
  };

  const staleQuoteForSideCandidate = lastGoodQuoteBySide[tradeSide];
  const staleQuoteForSide =
    staleQuoteForSideCandidate &&
    Date.now() - staleQuoteForSideCandidate.updatedAtMs <= JUPITER_QUOTE_STALE_MAX_AGE_MS
      ? staleQuoteForSideCandidate.quote
      : null;
  const jupiterQuote = jupiterQuoteQuery.data ?? staleQuoteForSide;
  const isUsingStaleQuote = !jupiterQuoteQuery.data && !!staleQuoteForSide;
  const showQuoteLoading = jupiterQuoteQuery.isLoading && !jupiterQuote;
  const jupiterOutputAmountFormatted = jupiterQuote
    ? tradeSide === "buy"
      ? formatTokenAmountFromAtomic(jupiterQuote.outAmount, outputTokenDecimals)
      : formatSolAtomic(jupiterQuote.outAmount)
    : "-";
  const jupiterMinReceiveFormatted = jupiterQuote
    ? tradeSide === "buy"
      ? formatTokenAmountFromAtomic(jupiterQuote.otherAmountThreshold, outputTokenDecimals)
      : formatSolAtomic(jupiterQuote.otherAmountThreshold)
    : "-";
  const jupiterInputAmountFormatted = jupiterQuote
    ? tradeSide === "buy"
      ? formatSolAtomic(jupiterQuote.inAmount)
      : formatTokenAmountFromAtomic(jupiterQuote.inAmount, outputTokenDecimals)
    : tradeSide === "buy"
      ? buyAmountLamports
        ? (buyAmountLamports / LAMPORTS_PER_SOL).toLocaleString(undefined, { maximumFractionDigits: 6 })
        : "-"
      : sellAmountToken || "-";
  const jupiterPlatformFeeAtomic = jupiterQuote?.platformFee?.amount ?? null;
  const jupiterPlatformFeeBps = jupiterQuote?.platformFee?.feeBps ?? null;
  const jupiterPlatformFeeMint = jupiterQuote?.platformFee?.mint ?? null;
  const creatorRouteFeeBps =
    post.author.tradeFeeRewardsEnabled === false
      ? 0
      : Number.isFinite(post.author.tradeFeeShareBps)
        ? Math.max(0, Math.min(MAX_CREATOR_ROUTE_FEE_BPS, Math.round(Number(post.author.tradeFeeShareBps))))
        : MAX_CREATOR_ROUTE_FEE_BPS;
  const totalRouteFeeBps =
    jupiterPlatformFeeBps !== null && Number.isFinite(jupiterPlatformFeeBps)
      ? Math.max(DEFAULT_TOTAL_ROUTE_FEE_BPS, Math.round(Number(jupiterPlatformFeeBps)))
      : DEFAULT_TOTAL_ROUTE_FEE_BPS;
  const retainedPlatformFeeBps = Math.max(0, totalRouteFeeBps - creatorRouteFeeBps);
  const jupiterPlatformFeeAmountDisplay =
    !jupiterPlatformFeeAtomic || jupiterPlatformFeeAtomic === "0"
      ? "-"
      : jupiterPlatformFeeMint === SOL_MINT
        ? `${formatSolAtomic(jupiterPlatformFeeAtomic)} SOL`
        : `${formatTokenAmountFromAtomic(jupiterPlatformFeeAtomic, outputTokenDecimals)} ${displayTokenSymbol}`;
  const jupiterQuoteErrorMessage =
    !jupiterQuote && jupiterQuoteQuery.error instanceof Error ? jupiterQuoteQuery.error.message : null;
  const jupiterNoRouteDetected =
    !!jupiterQuoteErrorMessage &&
    /route|not tradable|no route|could not find|TOKEN_NOT_TRADABLE/i.test(jupiterQuoteErrorMessage);
  const jupiterQuoteUnavailable =
    !!jupiterQuoteErrorMessage &&
    !jupiterNoRouteDetected;
  const jupiterRouteFeeDisplay =
    showQuoteLoading || jupiterNoRouteDetected || jupiterQuoteUnavailable
      ? "-"
      : jupiterPlatformFeeBps !== null && Number.isFinite(jupiterPlatformFeeBps)
        ? `${(Number(jupiterPlatformFeeBps) / 100).toFixed(2)}% (${jupiterPlatformFeeAmountDisplay})`
        : jupiterPlatformFeeAmountDisplay;
  const creatorFeeDisplay =
    creatorRouteFeeBps > 0 ? `${(creatorRouteFeeBps / 100).toFixed(2)}% max` : "Disabled";
  const retainedPlatformFeeDisplay = `${(retainedPlatformFeeBps / 100).toFixed(2)}%`;
  const jupiterPriceImpactPct = jupiterQuote?.priceImpactPct ? Number(jupiterQuote.priceImpactPct) * 100 : null;
  const tradeInputAmountNumeric = useMemo(() => {
    if (jupiterQuote) {
      const raw = Number(jupiterQuote.inAmount);
      if (!Number.isFinite(raw)) return null;
      return tradeSide === "buy" ? raw / LAMPORTS_PER_SOL : raw / Math.pow(10, outputTokenDecimals);
    }
    if (tradeSide === "buy") {
      return Number.isFinite(parsedBuyAmountSol) && parsedBuyAmountSol > 0 ? parsedBuyAmountSol : null;
    }
    return Number.isFinite(parsedSellAmountToken) && parsedSellAmountToken > 0 ? parsedSellAmountToken : null;
  }, [jupiterQuote, outputTokenDecimals, parsedBuyAmountSol, parsedSellAmountToken, tradeSide]);
  const tradeOutputAmountNumeric = useMemo(() => {
    if (!jupiterQuote) return null;
    const raw = Number(jupiterQuote.outAmount);
    if (!Number.isFinite(raw)) return null;
    return tradeSide === "buy" ? raw / Math.pow(10, outputTokenDecimals) : raw / LAMPORTS_PER_SOL;
  }, [jupiterQuote, outputTokenDecimals, tradeSide]);
  const tradePayUsdEstimate =
    tradeInputAmountNumeric !== null
      ? tradeSide === "buy"
        ? solPriceUsd !== null
          ? tradeInputAmountNumeric * solPriceUsd
          : null
        : resolvedPriceUsd !== null
          ? tradeInputAmountNumeric * resolvedPriceUsd
          : null
      : null;
  const tradeReceiveUsdEstimate =
    tradeOutputAmountNumeric !== null
      ? tradeSide === "buy"
        ? resolvedPriceUsd !== null
          ? tradeOutputAmountNumeric * resolvedPriceUsd
          : null
        : solPriceUsd !== null
          ? tradeOutputAmountNumeric * solPriceUsd
          : null
      : null;
  const hasWalletSignerForTrade = !!(walletPublicKey && wallet.signTransaction);
  const isWalletConnectedForTrade = Boolean(
    tradeWalletPublicKey && (wallet.connected || hasWalletSignerForTrade)
  );
  const walletShortAddress = walletPublicKey
    ? `${walletPublicKey.toBase58().slice(0, 4)}...${walletPublicKey.toBase58().slice(-4)}`
    : null;
  const walletDisplayName = wallet.wallet?.adapter?.name ?? "Solana Wallet";
  const buyQuickAmounts = quickBuyPresetsSol;
  const sellQuickPercents = [25, 50, 75, 100];
  const canExecuteJupiterBuy =
    isSolanaTradeSupported &&
    hasWalletSignerForTrade &&
    !!wallet.signTransaction &&
    !!jupiterQuote &&
    !!tradeAmountAtomic &&
    !sellBlockedByRpcTokenInfo &&
    !sellAmountExceedsBalance &&
    !isExecutingBuy;
  const connectWalletCtaLabel = "Connect Wallet";
  const tradeCtaLabel = !isSolanaTradeSupported
    ? "Trade (Solana only)"
    : "Trade Now";
  const shouldPulseTradeCta =
    isSolanaTradeSupported && (!isWalletConnectedForTrade || !localSettled);
  const connectWalletTone =
    "border-emerald-300/75 bg-[linear-gradient(135deg,rgba(199,245,166,0.96),rgba(152,233,220,0.94))] text-[#0c2e24] shadow-[0_20px_44px_-24px_rgba(45,212,191,0.72)] hover:brightness-[1.02] dark:border-emerald-200/25 dark:bg-[linear-gradient(135deg,rgba(52,211,153,0.18),rgba(45,212,191,0.14))] dark:text-white dark:shadow-[0_18px_40px_-28px_rgba(16,185,129,0.35)]";
  const tradeButtonTone = !isSolanaTradeSupported
    ? "border-border/70 bg-white/80 text-slate-700 hover:bg-white hover:text-slate-900 dark:border-white/10 dark:bg-white/5 dark:text-white/70 dark:hover:bg-white/10 dark:hover:text-white"
    : isWalletConnectedForTrade
      ? !localSettled
        ? "border-emerald-300/70 bg-[linear-gradient(135deg,rgba(199,245,166,0.96),rgba(152,233,220,0.92))] text-[#0c2e24] hover:brightness-[1.02] shadow-[0_18px_40px_-24px_rgba(34,197,94,0.35)] dark:border-lime-300/25 dark:bg-gradient-to-r dark:from-lime-400/20 dark:via-lime-300/12 dark:to-white/5 dark:text-white dark:hover:from-lime-400/25 dark:hover:to-white/10 dark:shadow-lg dark:shadow-lime-400/10"
        : localIsWin
          ? "border-emerald-300/55 bg-[linear-gradient(135deg,rgba(221,255,230,0.96),rgba(192,245,214,0.92))] text-emerald-800 hover:brightness-[1.02] shadow-[0_18px_40px_-26px_rgba(16,185,129,0.28)] dark:border-gain/25 dark:bg-gradient-to-r dark:from-gain/20 dark:via-gain/12 dark:to-white/5 dark:text-white dark:hover:from-gain/25 dark:hover:to-white/10 dark:shadow-lg dark:shadow-gain/15"
          : "border-rose-300/55 bg-[linear-gradient(135deg,rgba(255,244,244,0.96),rgba(255,228,228,0.92))] text-rose-700 hover:bg-rose-50 shadow-[0_18px_40px_-28px_rgba(244,63,94,0.18)] dark:border-loss/20 dark:bg-gradient-to-r dark:from-white/6 dark:to-white/4 dark:text-white dark:hover:from-white/10 dark:hover:to-white/6"
      : connectWalletTone;
  const canTriggerWalletConnectFromFooter = isSolanaTradeSupported && !hasWalletSignerForTrade;
  const isBuyFooterDisabled = isSolanaTradeSupported
    ? hasWalletSignerForTrade
      ? !canExecuteJupiterBuy
      : false
    : true;

  const handleBuyFooterAction = () => {
    if (canTriggerWalletConnectFromFooter) {
      handleOpenTradeWalletConnectDialog();
      return;
    }
    void handleExecuteJupiterBuy();
  };
  const fallbackCurrentMcap =
    currentMcap ??
    resolvedMarketCap ??
    (Number.isFinite(post.entryMcap) ? post.entryMcap : null);
  const tradeChartData = [
    { label: "Entry", short: "E", mcap: post.entryMcap, kind: "entry" as const },
    ...(localMcap1h != null ? [{ label: "1H", short: "1H", mcap: localMcap1h, kind: "snap" as const }] : []),
    ...(localMcap6h != null ? [{ label: "6H", short: "6H", mcap: localMcap6h, kind: "snap" as const }] : []),
    ...(fallbackCurrentMcap != null
      ? [{ label: "Now", short: "Now", mcap: fallbackCurrentMcap, kind: "current" as const }]
      : []),
  ]
    .filter((point) => Number.isFinite(point.mcap))
    .map((point) => ({
      ...point,
      mcap: Number(point.mcap),
      deltaPct: calculatePercentChange(post.entryMcap, Number(point.mcap)),
    }));
  const currentTradeDeltaPct = tradeChartData[tradeChartData.length - 1]?.deltaPct ?? null;
  const jupiterStatusLabel = !isSolanaTradeSupported
    ? "Unsupported chain"
    : jupiterQuoteQuery.isLoading || jupiterQuoteQuery.isFetching
      ? isUsingStaleQuote
        ? "Refreshing route..."
        : "Fetching route..."
      : jupiterNoRouteDetected
        ? "No route available"
        : jupiterQuoteUnavailable
          ? "Quote unavailable"
        : jupiterQuote
          ? "Route ready"
          : "Awaiting quote";
  const jupiterStatusTone = !isSolanaTradeSupported
    ? "border-slate-900/10 bg-slate-900/[0.04] text-slate-600 dark:border-white/10 dark:bg-white/5 dark:text-white/70"
    : jupiterNoRouteDetected
      ? "border-amber-400/30 bg-amber-400/10 text-amber-700 dark:border-amber-300/20 dark:bg-amber-300/10 dark:text-amber-100"
      : jupiterQuoteUnavailable
        ? "border-loss/20 bg-loss/10 text-rose-600 dark:text-loss"
      : jupiterQuote
        ? "border-emerald-400/25 bg-emerald-500/10 text-emerald-700 dark:border-lime-300/20 dark:bg-lime-300/10 dark:text-lime-100"
        : "border-slate-900/10 bg-slate-900/[0.04] text-slate-600 dark:border-white/10 dark:bg-white/5 dark:text-white/70";
  const jupiterReceiveDisplay = showQuoteLoading
    ? "Loading quote..."
    : jupiterNoRouteDetected
      ? "No route available"
      : jupiterQuoteUnavailable
        ? "Quote unavailable"
      : `${jupiterOutputAmountFormatted} ${tradeOutputTokenLabel}`;
  const jupiterMinReceiveDisplay = showQuoteLoading
    ? "Loading quote..."
    : jupiterNoRouteDetected
      ? "No route available"
      : jupiterQuoteUnavailable
        ? "Quote unavailable"
      : `${jupiterMinReceiveFormatted} ${tradeOutputTokenLabel}`;
  const jupiterPriceImpactDisplay =
    jupiterQuoteQuery.isLoading || jupiterNoRouteDetected || jupiterPriceImpactPct === null || !Number.isFinite(jupiterPriceImpactPct)
      ? "-"
      : `${jupiterPriceImpactPct.toFixed(2)}%`;
  const professionalChartData = useMemo(() => {
    const providerCandles = chartCandlesQuery.data?.candles ?? [];
    const fallbackIntervalMs =
      chartRequestConfig.timeframe === "day"
        ? chartRequestConfig.aggregate * 86_400_000
        : chartRequestConfig.timeframe === "hour"
          ? chartRequestConfig.aggregate * 3_600_000
          : chartRequestConfig.aggregate * 60_000;
    const fallbackPoints = tradeChartData
      .map((point) => point.mcap)
      .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
    if (fallbackPoints.length === 1) {
      fallbackPoints.push(fallbackPoints[0]);
    }
    const fallbackAnchorTs = Number.isFinite(new Date(post.createdAt).getTime())
      ? new Date(post.createdAt).getTime()
      : Date.now();
    const fallbackCandles: ChartCandle[] =
      fallbackPoints.length >= 2
        ? fallbackPoints.map((closeValue, index) => {
            const previous = index === 0 ? closeValue : fallbackPoints[index - 1] ?? closeValue;
            const openValue = Number.isFinite(previous) ? previous : closeValue;
            const highValue = Math.max(openValue, closeValue);
            const lowValue = Math.min(openValue, closeValue);
            return {
              timestamp: fallbackAnchorTs + (index - (fallbackPoints.length - 1)) * fallbackIntervalMs,
              open: openValue,
              high: highValue,
              low: lowValue,
              close: closeValue,
              volume: 0,
            };
          })
        : [];

    const candles = providerCandles.length >= 2 ? providerCandles : fallbackCandles;
    return candles
      .map((candle) => {
        const open = Number(candle.open);
        const high = Number(candle.high);
        const low = Number(candle.low);
        const close = Number(candle.close);
        const volume = Number(candle.volume);
        const normalizedTs =
          candle.timestamp > 10_000_000_000
            ? candle.timestamp
            : candle.timestamp * 1000;
        const date = new Date(normalizedTs);
        const label =
          chartRequestConfig.timeframe === "day"
            ? date.toLocaleDateString(undefined, { month: "short", day: "numeric" })
            : date.toLocaleTimeString(undefined, {
                hour: "2-digit",
                minute: "2-digit",
              });
        const fullLabel = date.toLocaleString(undefined, {
          month: "short",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        });
        return {
          ...candle,
          open,
          high,
          low,
          close,
          volume: Number.isFinite(volume) ? volume : 0,
          isBullish: close >= open,
          label,
          fullLabel,
          ts: normalizedTs,
        };
      })
      .filter((point) =>
        Number.isFinite(point.ts) &&
        Number.isFinite(point.open) &&
        Number.isFinite(point.high) &&
        Number.isFinite(point.low) &&
        Number.isFinite(point.close)
      )
      .sort((a, b) => a.ts - b.ts);
  }, [chartCandlesQuery.data?.candles, chartRequestConfig.aggregate, chartRequestConfig.timeframe, post.createdAt, tradeChartData]);
  const hasProviderChartCandles = (chartCandlesQuery.data?.candles?.length ?? 0) >= 2;
  const hasProfessionalChartData = professionalChartData.length >= 2;
  const isFallbackChartData = hasProfessionalChartData && !hasProviderChartCandles;
  const chartTotalPoints = professionalChartData.length;
  const chartWindowBounds = useMemo(() => {
    if (chartTotalPoints <= 0) {
      return {
        startIndex: 0,
        endIndex: 0,
        visibleCount: 0,
      };
    }

    const minVisible = Math.min(CHART_MIN_VISIBLE_POINTS, chartTotalPoints);
    const maxVisible = Math.min(CHART_MAX_VISIBLE_POINTS, chartTotalPoints);
    const fallbackVisible = Math.min(
      chartTotalPoints,
      Math.max(minVisible, Math.min(maxVisible, CHART_DEFAULT_VISIBLE_POINTS))
    );
    const fallbackStart = Math.max(0, chartTotalPoints - fallbackVisible);

    const unsafeStart = chartWindow?.startIndex ?? fallbackStart;
    const unsafeEnd = chartWindow?.endIndex ?? chartTotalPoints - 1;
    const center = Math.round((unsafeStart + unsafeEnd) / 2);
    const width = Math.max(
      minVisible,
      Math.min(maxVisible, Math.max(1, unsafeEnd - unsafeStart + 1))
    );
    let startIndex = center - Math.floor(width / 2);
    startIndex = Math.max(0, Math.min(startIndex, chartTotalPoints - width));
    const endIndex = startIndex + width - 1;

    return {
      startIndex,
      endIndex,
      visibleCount: width,
    };
  }, [chartTotalPoints, chartWindow]);
  const chartVisibleStartPoint =
    hasProfessionalChartData && chartWindowBounds.visibleCount > 0
      ? professionalChartData[chartWindowBounds.startIndex] ?? null
      : null;
  const chartVisibleEndPoint =
    hasProfessionalChartData && chartWindowBounds.visibleCount > 0
      ? professionalChartData[chartWindowBounds.endIndex] ?? null
      : null;
  const chartVisibleRangeLabel = useMemo(() => {
    if (!chartVisibleStartPoint || !chartVisibleEndPoint) return "No chart range";
    const formatTimestamp = (ts: number) => {
      const date = new Date(ts);
      if (chartRequestConfig.timeframe === "day") {
        return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
      }
      return date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
    };
    return `${formatTimestamp(chartVisibleStartPoint.ts)} - ${formatTimestamp(chartVisibleEndPoint.ts)}`;
  }, [chartRequestConfig.timeframe, chartVisibleEndPoint, chartVisibleStartPoint]);
  const chartRangeDetailLabel = useMemo(() => {
    if (!chartVisibleStartPoint || !chartVisibleEndPoint) return "";
    return `${chartVisibleStartPoint.fullLabel} -> ${chartVisibleEndPoint.fullLabel}`;
  }, [chartVisibleEndPoint, chartVisibleStartPoint]);
  const formatChartXAxisTick = useCallback(
    (value: number | string) => {
      const ts = typeof value === "number" ? value : Number(value);
      if (!Number.isFinite(ts)) return "";
      const date = new Date(ts);
      if (chartRequestConfig.timeframe === "day") {
        return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
      }
      return date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
    },
    [chartRequestConfig.timeframe]
  );
  const chartEntryTargetTs = useMemo(() => {
    const parsed = new Date(post.createdAt).getTime();
    return Number.isFinite(parsed) ? parsed : null;
  }, [post.createdAt]);
  const chartEntryCandle = useMemo(() => {
    if (!hasProfessionalChartData || chartEntryTargetTs === null) return null;
    let nearest = professionalChartData[0] ?? null;
    if (!nearest) return null;
    let bestDelta = Math.abs(nearest.ts - chartEntryTargetTs);
    for (let index = 1; index < professionalChartData.length; index += 1) {
      const point = professionalChartData[index];
      if (!point) continue;
      const delta = Math.abs(point.ts - chartEntryTargetTs);
      if (delta < bestDelta) {
        bestDelta = delta;
        nearest = point;
      }
    }
    return nearest;
  }, [chartEntryTargetTs, hasProfessionalChartData, professionalChartData]);
  const chartEntryIndex = useMemo(() => {
    if (!chartEntryCandle) return -1;
    return professionalChartData.findIndex((point) => point.ts === chartEntryCandle.ts);
  }, [chartEntryCandle, professionalChartData]);
  const chartEntryPrice =
    chartEntryCandle && Number.isFinite(chartEntryCandle.close) ? chartEntryCandle.close : null;
  const isEntryInCurrentView =
    chartEntryIndex >= chartWindowBounds.startIndex &&
    chartEntryIndex <= chartWindowBounds.endIndex;
  const canPanChartLeft = chartWindowBounds.startIndex > 0;
  const canPanChartRight = chartWindowBounds.endIndex < chartTotalPoints - 1;
  const minVisiblePoints = Math.min(CHART_MIN_VISIBLE_POINTS, chartTotalPoints || CHART_MIN_VISIBLE_POINTS);
  const maxVisiblePoints = Math.min(CHART_MAX_VISIBLE_POINTS, chartTotalPoints || CHART_MAX_VISIBLE_POINTS);
  const canZoomInChart = chartWindowBounds.visibleCount > minVisiblePoints;
  const canZoomOutChart = chartWindowBounds.visibleCount < maxVisiblePoints;
  const panChartWindowBy = useCallback(
    (deltaPoints: number) => {
      if (chartTotalPoints <= 1 || chartWindowBounds.visibleCount <= 0) return;
      const maxStart = chartTotalPoints - chartWindowBounds.visibleCount;
      if (maxStart <= 0) return;
      const nextStart = Math.max(
        0,
        Math.min(maxStart, chartWindowBounds.startIndex + Math.trunc(deltaPoints))
      );
      if (nextStart === chartWindowBounds.startIndex) return;
      setChartWindow({
        startIndex: nextStart,
        endIndex: nextStart + chartWindowBounds.visibleCount - 1,
      });
    },
    [chartTotalPoints, chartWindowBounds.startIndex, chartWindowBounds.visibleCount]
  );
  const zoomChartWindow = useCallback(
    (direction: "in" | "out", anchorIndex?: number | null) => {
      if (chartTotalPoints <= 1 || chartWindowBounds.visibleCount <= 0) return;
      const minVisible = Math.min(CHART_MIN_VISIBLE_POINTS, chartTotalPoints);
      const maxVisible = Math.min(CHART_MAX_VISIBLE_POINTS, chartTotalPoints);
      const delta = direction === "in" ? -CHART_ZOOM_STEP_POINTS : CHART_ZOOM_STEP_POINTS;
      const nextVisible = Math.max(
        minVisible,
        Math.min(maxVisible, chartWindowBounds.visibleCount + delta)
      );
      if (nextVisible === chartWindowBounds.visibleCount) return;

      const rawAnchor = anchorIndex ?? chartActiveIndex ?? chartWindowBounds.endIndex;
      const clampedAnchor = Math.max(0, Math.min(chartTotalPoints - 1, rawAnchor));
      const ratio =
        chartWindowBounds.visibleCount <= 1
          ? 1
          : (clampedAnchor - chartWindowBounds.startIndex) / (chartWindowBounds.visibleCount - 1);
      let nextStart = Math.round(clampedAnchor - ratio * (nextVisible - 1));
      nextStart = Math.max(0, Math.min(nextStart, chartTotalPoints - nextVisible));
      setChartWindow({
        startIndex: nextStart,
        endIndex: nextStart + nextVisible - 1,
      });
    },
    [
      chartActiveIndex,
      chartTotalPoints,
      chartWindowBounds.endIndex,
      chartWindowBounds.startIndex,
      chartWindowBounds.visibleCount,
    ]
  );
  const resetChartWindow = useCallback(() => {
    if (chartTotalPoints <= 0) {
      setChartWindow(null);
      setChartActiveIndex(null);
      return;
    }
    const minVisible = Math.min(CHART_MIN_VISIBLE_POINTS, chartTotalPoints);
    const maxVisible = Math.min(CHART_MAX_VISIBLE_POINTS, chartTotalPoints);
    const width = Math.min(
      chartTotalPoints,
      Math.max(minVisible, Math.min(maxVisible, CHART_DEFAULT_VISIBLE_POINTS))
    );
    const startIndex = Math.max(0, chartTotalPoints - width);
    setChartWindow({
      startIndex,
      endIndex: startIndex + width - 1,
    });
    setChartActiveIndex(null);
  }, [chartTotalPoints]);
  const centerChartOnEntry = useCallback(() => {
    if (chartEntryIndex < 0 || chartTotalPoints <= 0 || chartWindowBounds.visibleCount <= 0) return;
    const width = chartWindowBounds.visibleCount;
    let startIndex = chartEntryIndex - Math.floor(width / 2);
    startIndex = Math.max(0, Math.min(startIndex, chartTotalPoints - width));
    setChartWindow({
      startIndex,
      endIndex: startIndex + width - 1,
    });
    setChartActiveIndex(chartEntryIndex);
  }, [chartEntryIndex, chartTotalPoints, chartWindowBounds.visibleCount]);
  const handleChartWheel = useCallback(
    (event: React.WheelEvent<HTMLDivElement>) => {
      if (!hasProfessionalChartData || chartWindowBounds.visibleCount <= 0) return;
      const absX = Math.abs(event.deltaX);
      const absY = Math.abs(event.deltaY);
      if (absX < 0.4 && absY < 0.4) return;
      event.preventDefault();
      if (event.shiftKey || absX > absY) {
        const direction = event.deltaX > 0 ? CHART_PAN_STEP_POINTS : -CHART_PAN_STEP_POINTS;
        panChartWindowBy(direction);
        return;
      }
      zoomChartWindow(event.deltaY < 0 ? "in" : "out");
    },
    [
      chartWindowBounds.visibleCount,
      hasProfessionalChartData,
      panChartWindowBy,
      zoomChartWindow,
    ]
  );
  const resolveChartTouchAnchorIndex = useCallback(
    (clientX: number) => {
      if (chartTotalPoints <= 0 || chartWindowBounds.visibleCount <= 0) {
        return chartActiveIndex ?? 0;
      }
      const node = chartInteractionRef.current;
      if (!node) {
        return chartActiveIndex ?? chartWindowBounds.endIndex;
      }
      const rect = node.getBoundingClientRect();
      const safeWidth = Math.max(1, rect.width);
      const relativeRatio = Math.max(0, Math.min(1, (clientX - rect.left) / safeWidth));
      const span = Math.max(0, chartWindowBounds.visibleCount - 1);
      return Math.max(
        0,
        Math.min(
          chartTotalPoints - 1,
          chartWindowBounds.startIndex + Math.round(relativeRatio * span)
        )
      );
    },
    [
      chartActiveIndex,
      chartTotalPoints,
      chartWindowBounds.endIndex,
      chartWindowBounds.startIndex,
      chartWindowBounds.visibleCount,
    ]
  );
  const handleChartTouchStart = useCallback((event: React.TouchEvent<HTMLDivElement>) => {
    if (event.touches.length >= 2) {
      const midpoint = getTouchMidpoint(event.touches);
      const distance = getTouchDistance(event.touches);
      if (!midpoint || distance === null) return;
      chartTouchGestureRef.current = {
        x: midpoint.x,
        y: midpoint.y,
        distance,
        mode: "pinch",
      };
      return;
    }

    const touch = event.touches[0];
    if (!touch) return;
    chartTouchGestureRef.current = {
      x: touch.clientX,
      y: touch.clientY,
      distance: null,
      mode: null,
    };
  }, []);
  const handleChartTouchMove = useCallback(
    (event: React.TouchEvent<HTMLDivElement>) => {
      if (!hasProfessionalChartData || chartWindowBounds.visibleCount <= 0) return;
      const gesture = chartTouchGestureRef.current;
      if (!gesture) return;

      if (event.touches.length >= 2) {
        const midpoint = getTouchMidpoint(event.touches);
        const distance = getTouchDistance(event.touches);
        if (!midpoint || distance === null) return;
        if (gesture.mode !== "pinch") {
          gesture.mode = "pinch";
          gesture.x = midpoint.x;
          gesture.y = midpoint.y;
          gesture.distance = distance;
          return;
        }

        const priorDistance = gesture.distance ?? distance;
        const deltaDistance = distance - priorDistance;
        if (Math.abs(deltaDistance) < CHART_TOUCH_PINCH_THRESHOLD_PX) {
          return;
        }

        event.preventDefault();
        const anchorIndex = resolveChartTouchAnchorIndex(midpoint.x);
        zoomChartWindow(deltaDistance > 0 ? "in" : "out", anchorIndex);
        gesture.x = midpoint.x;
        gesture.y = midpoint.y;
        gesture.distance = distance;
        return;
      }

      const touch = event.touches[0];
      if (!touch) return;
      if (gesture.mode === "pinch") {
        gesture.mode = null;
        gesture.distance = null;
        gesture.x = touch.clientX;
        gesture.y = touch.clientY;
        return;
      }

      const deltaX = touch.clientX - gesture.x;
      const deltaY = touch.clientY - gesture.y;
      if (!gesture.mode) {
        if (
          Math.abs(deltaX) >= CHART_TOUCH_PAN_THRESHOLD_PX &&
          Math.abs(deltaX) > Math.abs(deltaY)
        ) {
          gesture.mode = "pan";
        } else if (Math.abs(deltaY) >= CHART_TOUCH_PAN_THRESHOLD_PX) {
          gesture.mode = "scroll";
        }
      }

      if (gesture.mode !== "pan") return;
      event.preventDefault();
      const steps = Math.trunc(deltaX / CHART_TOUCH_PAN_STEP_PX);
      if (steps === 0) return;
      panChartWindowBy(-steps * CHART_PAN_STEP_POINTS);
      gesture.x = touch.clientX;
      gesture.y = touch.clientY;
      gesture.distance = null;
    },
    [
      chartWindowBounds.visibleCount,
      hasProfessionalChartData,
      panChartWindowBy,
      resolveChartTouchAnchorIndex,
      zoomChartWindow,
    ]
  );
  const handleChartTouchEnd = useCallback(() => {
    chartTouchGestureRef.current = null;
  }, []);
  const handleChartMouseDown = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    chartMouseGestureRef.current = {
      x: event.clientX,
      y: event.clientY,
      mode: null,
    };
    setIsChartMousePanning(false);
  }, []);
  const handleChartMouseMove = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (!hasProfessionalChartData || chartWindowBounds.visibleCount <= 0) return;
      const gesture = chartMouseGestureRef.current;
      if (!gesture) return;
      if (event.buttons === 0) {
        chartMouseGestureRef.current = null;
        setIsChartMousePanning(false);
        return;
      }

      const deltaX = event.clientX - gesture.x;
      const deltaY = event.clientY - gesture.y;
      if (!gesture.mode) {
        if (
          Math.abs(deltaX) >= CHART_TOUCH_PAN_THRESHOLD_PX &&
          Math.abs(deltaX) > Math.abs(deltaY)
        ) {
          gesture.mode = "pan";
          setIsChartMousePanning(true);
        } else if (Math.abs(deltaY) >= CHART_TOUCH_PAN_THRESHOLD_PX) {
          gesture.mode = "scroll";
        }
      }

      if (gesture.mode !== "pan") return;
      event.preventDefault();
      const steps = Math.trunc(deltaX / CHART_TOUCH_PAN_STEP_PX);
      if (steps === 0) return;
      panChartWindowBy(-steps * CHART_PAN_STEP_POINTS);
      gesture.x = event.clientX;
      gesture.y = event.clientY;
    },
    [chartWindowBounds.visibleCount, hasProfessionalChartData, panChartWindowBy]
  );
  const handleChartMouseUp = useCallback(() => {
    chartMouseGestureRef.current = null;
    setIsChartMousePanning(false);
  }, []);
  const professionalChartFirst = hasProfessionalChartData ? professionalChartData[0] : null;
  const professionalChartLast = hasProfessionalChartData
    ? professionalChartData[professionalChartData.length - 1]
    : null;
  const professionalChartDeltaPct =
    professionalChartFirst && professionalChartLast && professionalChartFirst.close > 0
      ? ((professionalChartLast.close - professionalChartFirst.close) / professionalChartFirst.close) * 100
      : null;
  const professionalChartTrendPositive =
    professionalChartDeltaPct == null ? true : professionalChartDeltaPct >= 0;
  const professionalChartStroke = professionalChartTrendPositive ? "#74f37a" : "#ff6b6b";
  const professionalChartFill = professionalChartTrendPositive
    ? "rgba(116,243,122,0.18)"
    : "rgba(255,107,107,0.18)";
  const chartFeedLabel = useMemo(() => {
    if (isFallbackChartData) {
      return "Phew";
    }
    switch (chartCandlesQuery.data?.source) {
      case "birdeye":
        return "Birdeye";
      case "geckoterminal":
        return "GeckoTerminal";
      default:
        return "Live";
    }
  }, [chartCandlesQuery.data?.source, isFallbackChartData]);
  const walletConnectDialogClassName =
    "w-[calc(100vw-1rem)] max-w-md overflow-hidden border-slate-900/10 bg-[linear-gradient(180deg,rgba(255,252,247,0.98),rgba(246,239,228,0.98))] p-0 text-slate-900 shadow-[0_36px_120px_-50px_rgba(15,23,42,0.34)] dark:border-white/10 dark:bg-[linear-gradient(180deg,rgba(8,10,15,0.96),rgba(4,6,10,0.98))] dark:text-white dark:shadow-[0_36px_120px_-50px_rgba(0,0,0,0.95)]";
  const tradeDialogSurfaceClassName =
    "flex w-[calc(100vw-0.4rem)] max-h-[calc(100dvh-0.5rem)] max-w-6xl flex-col overflow-hidden border-slate-900/[0.08] bg-[linear-gradient(180deg,rgba(255,252,248,0.98),rgba(244,237,225,0.97))] p-0 text-slate-900 shadow-[0_60px_180px_-56px_rgba(15,23,42,0.34)] dark:border-white/[0.08] dark:bg-[linear-gradient(180deg,rgba(8,10,15,0.99),rgba(5,7,10,0.99))] dark:text-white dark:shadow-[0_60px_180px_-40px_rgba(0,0,0,0.98)] [&>button]:hidden sm:w-[calc(100vw-0.75rem)] sm:max-h-[94vh]";
  const tradeDialogHeaderClassName =
    "relative shrink-0 overflow-hidden border-b border-slate-900/[0.06] bg-[radial-gradient(circle_at_18%_0%,rgba(16,185,129,0.10),transparent_38%),radial-gradient(circle_at_100%_0%,rgba(245,158,11,0.10),transparent_34%),linear-gradient(180deg,rgba(255,255,255,0.82),rgba(248,242,232,0.9))] px-5 pb-3 pt-4 dark:border-white/[0.06] dark:bg-[radial-gradient(circle_at_18%_0%,rgba(16,185,129,0.10),transparent_38%),radial-gradient(circle_at_100%_0%,rgba(59,130,246,0.08),transparent_30%),linear-gradient(180deg,rgba(10,12,18,0.98),rgba(7,9,13,0.96))] sm:px-6";
  const tradeDialogBodyClassName =
    "min-h-0 flex-1 space-y-2.5 overflow-y-auto bg-[linear-gradient(180deg,rgba(255,252,248,0.9),rgba(245,238,226,0.98))] p-2.5 dark:bg-[linear-gradient(180deg,rgba(7,9,14,0.98),rgba(5,7,10,0.98))] sm:space-y-3 sm:p-4";
  const tradeDialogFooterClassName =
    "relative z-20 flex-row items-center justify-between gap-2 border-t border-slate-900/[0.06] bg-[linear-gradient(180deg,rgba(252,247,239,0.98),rgba(246,239,227,0.94))] px-4 py-3 dark:border-white/[0.06] dark:bg-[linear-gradient(180deg,rgba(10,12,18,0.96),rgba(7,9,13,0.98))] sm:px-5";
  const chartPanelClassName =
    "relative overflow-hidden rounded-2xl border border-slate-900/[0.08] bg-[linear-gradient(180deg,rgba(255,255,255,0.82),rgba(247,241,230,0.94))] shadow-[0_30px_80px_-52px_rgba(148,163,184,0.74)] ring-1 ring-white/65 dark:border-white/[0.08] dark:bg-[radial-gradient(circle_at_12%_0%,rgba(16,185,129,0.08),transparent_30%),radial-gradient(circle_at_100%_0%,rgba(59,130,246,0.12),transparent_26%),linear-gradient(180deg,rgba(8,11,18,0.99),rgba(3,6,11,0.99))] dark:shadow-[0_34px_96px_-62px_rgba(0,0,0,0.98)] dark:ring-white/6";
  const chartDividerClassName = "border-slate-900/[0.06] dark:border-white/[0.06]";
  const chartDividerFillClassName = "bg-slate-900/[0.08] dark:bg-white/[0.08]";
  const chartMutedTextClassName = "text-slate-500 dark:text-white/30";
  const chartMutedSubtleTextClassName = "text-slate-400 dark:text-white/20";
  const chartStrongTextClassName = "text-slate-800 dark:text-white/70";
  const chartInactiveButtonClassName =
    "text-slate-500 hover:bg-slate-900/[0.04] hover:text-slate-800 dark:text-white/35 dark:hover:bg-white/[0.04] dark:hover:text-white/60";
  const chartInactiveToggleButtonClassName =
    "text-slate-500 hover:bg-slate-900/[0.04] hover:text-slate-700 dark:text-white/30 dark:hover:bg-white/[0.04] dark:hover:text-white/50";
  const chartControlButtonClassName =
    "text-slate-500 hover:bg-slate-900/[0.05] hover:text-slate-800 dark:text-white/40 dark:hover:bg-white/[0.06] dark:hover:text-white/70 disabled:opacity-30";
  const chartCanvasClassName =
    "relative h-[220px] overscroll-contain bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.85),rgba(245,238,225,0.98))] px-1 pb-2 pt-2 sm:h-[320px] sm:px-2 lg:h-[460px] xl:h-[520px] dark:bg-[radial-gradient(circle_at_16%_8%,rgba(59,130,246,0.12),transparent_28%),radial-gradient(circle_at_88%_14%,rgba(16,185,129,0.08),transparent_32%),linear-gradient(180deg,rgba(4,9,18,0.99),rgba(1,4,9,1))]";

  useEffect(() => {
    if (chartTotalPoints <= 0) {
      setChartWindow(null);
      setChartActiveIndex(null);
      return;
    }

    setChartWindow((prev) => {
      const minVisible = Math.min(CHART_MIN_VISIBLE_POINTS, chartTotalPoints);
      const maxVisible = Math.min(CHART_MAX_VISIBLE_POINTS, chartTotalPoints);
      if (!prev) {
        const width = Math.min(
          chartTotalPoints,
          Math.max(minVisible, Math.min(maxVisible, CHART_DEFAULT_VISIBLE_POINTS))
        );
        const startIndex = Math.max(0, chartTotalPoints - width);
        return { startIndex, endIndex: startIndex + width - 1 };
      }

      const width = Math.max(
        minVisible,
        Math.min(maxVisible, Math.max(1, prev.endIndex - prev.startIndex + 1))
      );
      const wasNearEnd = prev.endIndex >= chartTotalPoints - 3;
      let startIndex = wasNearEnd ? chartTotalPoints - width : prev.startIndex;
      startIndex = Math.max(0, Math.min(startIndex, chartTotalPoints - width));
      return { startIndex, endIndex: startIndex + width - 1 };
    });
  }, [chartTotalPoints, chartInterval]);

  useEffect(() => {
    if (!isBuyDialogOpen) return;
    resetChartWindow();
  }, [isBuyDialogOpen, resetChartWindow]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const onMouseUp = () => handleChartMouseUp();
    window.addEventListener("mouseup", onMouseUp);
    return () => window.removeEventListener("mouseup", onMouseUp);
  }, [handleChartMouseUp]);

  useEffect(() => {
    if (!isBuyDialogOpen && !pendingQuickBuyAutoExecute) return;
    if (!canExecuteJupiterBuy) return;
    if (isExecutingBuy) return;
    void buildSwapTransaction().catch(() => {
      // Ignore prebuild errors; execution path will show actionable errors.
    });
  }, [buildSwapTransaction, canExecuteJupiterBuy, isBuyDialogOpen, isExecutingBuy, pendingQuickBuyAutoExecute]);

  useEffect(() => {
    if (!pendingQuickBuyAutoExecute) return;

    if (jupiterNoRouteDetected) {
      quickBuyRetryCountRef.current = 0;
      setPendingQuickBuyAutoExecute(false);
      return;
    }

    if (jupiterQuoteUnavailable) {
      if (quickBuyRetryCountRef.current < 2) {
        quickBuyRetryCountRef.current += 1;
        void refetchJupiterQuote();
        return;
      }
      quickBuyRetryCountRef.current = 0;
      setPendingQuickBuyAutoExecute(false);
      return;
    }

    if (!canExecuteJupiterBuy) return;

    quickBuyRetryCountRef.current = 0;
    setPendingQuickBuyAutoExecute(false);
    void handleExecuteJupiterBuy();
  }, [
    pendingQuickBuyAutoExecute,
    jupiterNoRouteDetected,
    jupiterQuoteUnavailable,
    canExecuteJupiterBuy,
    refetchJupiterQuote,
    handleExecuteJupiterBuy,
  ]);

  return (
    <div
      ref={cardRef}
      className={cn(
        "group app-surface relative rounded-[28px] transition-all duration-300",
        "hover:border-primary/35 hover:shadow-[0_30px_90px_-56px_hsl(var(--foreground)/0.22)] dark:hover:shadow-none",
        localSettled && localIsWin && "border-gain/20",
        localSettled && !localIsWin && "border-loss/20",
        className
      )}
    >
      {/* Glow overlay for settled posts */}
      {localSettled && (
        <div
          className={cn(
            "absolute inset-0 rounded-[28px] opacity-5 pointer-events-none",
            localIsWin ? "bg-gain" : "bg-loss"
          )}
        />
      )}

      <div className="p-4 sm:p-5">
        {/* Header */}
        <div className="flex items-start gap-3">
          <Avatar
            className="h-11 w-11 cursor-pointer border-2 border-primary/15 ring-4 ring-white/70 transition-all hover:ring-primary/20 dark:border-white/[0.08] dark:ring-background"
            onClick={handleProfileClick}
          >
            <AvatarImage src={getAvatarUrl(post.author.id, post.author.image)} />
            <AvatarFallback className="bg-muted text-muted-foreground text-sm font-medium">
              {post.author.name?.charAt(0) || "?"}
            </AvatarFallback>
          </Avatar>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <button
                onClick={handleProfileClick}
                className="font-semibold text-foreground truncate hover:text-primary hover:underline transition-colors"
              >
                {post.author.username || post.author.name}
              </button>
              {post.author.isVerified ? <VerifiedBadge size="sm" /> : null}
              <LevelBadge level={post.author.level} />
              <span className="text-muted-foreground text-xs">
                {formatTimeAgo(post.createdAt)}
              </span>
              {/* Account actions */}
              {currentUserId && currentUserId !== post.author.id && (
                <div className="ml-auto flex items-center gap-1.5">
                  <ReportDialog
                    targetType="post"
                    targetId={post.id}
                    targetLabel={resolvedTokenSymbol ?? post.author.username ?? post.author.name}
                    buttonVariant="ghost"
                    buttonSize="icon"
                    buttonClassName="h-8 w-8 rounded-full border border-border/75 bg-white/78 text-slate-500 shadow-[0_14px_24px_-20px_hsl(var(--foreground)/0.18)] hover:bg-white hover:text-slate-800 dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-white/40 dark:shadow-none dark:hover:bg-white/[0.08] dark:hover:text-white/70"
                    iconOnly
                  />
                  <button
                    onClick={handleFollow}
                    disabled={isFollowLoading}
                    className={cn(
                      "flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition-all",
                      isFollowing
                        ? "border border-emerald-300/55 bg-emerald-50 text-emerald-700 shadow-[0_14px_28px_-24px_rgba(16,185,129,0.24)] hover:bg-emerald-100 dark:border-primary/25 dark:bg-primary/10 dark:text-primary dark:shadow-none dark:hover:bg-primary/15"
                        : "border border-primary/20 bg-[linear-gradient(135deg,hsl(var(--primary)/0.95),hsl(var(--accent)/0.85))] text-slate-950 shadow-[0_16px_34px_-20px_hsl(var(--primary)/0.42)] hover:brightness-[1.03] dark:border-primary/15 dark:bg-primary dark:text-primary-foreground dark:hover:brightness-[1.03]"
                    )}
                  >
                    {isFollowLoading ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : isFollowing ? (
                      <>
                        <UserCheck className="h-3 w-3" />
                        <span>Following</span>
                      </>
                    ) : (
                      <>
                        <PhewFollowIcon className="h-3 w-3" />
                        <span>Follow</span>
                      </>
                    )}
                  </button>
                </div>
              )}
            </div>

            {/* Author Level Bar - Larger and Higher Contrast */}
            <div className="mt-2">
              <LevelBar level={post.author.level} size="lg" showLabel={false} />
            </div>

            {/* Token Info Card - Display prominently if contract address exists */}
            {hasContractAddress && post.contractAddress && (
              <div className="mt-3">
                <TokenInfoCard
                  contractAddress={post.contractAddress}
                  chainType={post.chainType}
                  tokenName={resolvedTokenName}
                  tokenSymbol={resolvedTokenSymbol}
                  tokenImage={resolvedTokenImage}
                  dexscreenerUrl={resolvedDexscreenerUrl}
                />
              </div>
            )}

            {/* Also Called By - Show other users who called this token */}
            {hasSharedAlphaPreview && (
              <AlsoCalledBy
                users={sharedAlphaUsers}
                totalCount={sharedAlphaTotalCount}
                onShowMore={() => setIsSharedAlphaOpen(true)}
                maxDisplay={4}
              />
            )}

            {/* Post content - Cleaned of contract addresses */}
            {(() => {
              const cleanedContent = stripContractAddress(post.content);
              return cleanedContent ? (
                <p className="mt-3 text-foreground text-[15px] leading-relaxed whitespace-pre-wrap break-words">
                  {cleanedContent}
                </p>
              ) : null;
            })()}

            {/* Market Cap Info */}
            {hasContractAddress && (
              <div className="app-surface-soft mt-4 p-4">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  {/* Live Badge / Settled Status */}
                  <div className="flex items-center gap-2">
                    {!localSettled && (
                      <div className="flex items-center gap-1.5">
                        <span className="relative flex h-2 w-2">
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75"></span>
                          <span className="relative inline-flex rounded-full h-2 w-2 bg-primary"></span>
                        </span>
                        <span className="text-xs text-primary font-semibold">LIVE</span>
                      </div>
                    )}

                    {localSettled && (
                      <div className="flex items-center gap-1.5">
                        {localIsWin ? (
                          <>
                            <CheckCircle2 className="h-4 w-4 text-gain" />
                            <span className="text-xs text-gain font-semibold">WON</span>
                          </>
                        ) : (
                          <>
                            <XCircle className="h-4 w-4 text-loss" />
                            <span className="text-xs text-loss font-semibold">LOST</span>
                          </>
                        )}
                      </div>
                    )}
                  </div>

                  <div className="w-full sm:w-auto flex items-center sm:justify-end gap-2">
                    <motion.div
                      className="w-full sm:w-auto"
                      whileHover={{ scale: 1.02, y: -1 }}
                      whileTap={{ scale: 0.98 }}
                      animate={shouldPulseTradeCta ? { scale: [1, 1.015, 1] } : { scale: 1 }}
                      transition={
                        shouldPulseTradeCta
                          ? { duration: 2.2, repeat: Infinity, ease: "easeInOut" }
                          : { duration: 0.2, ease: "easeOut" }
                      }
                    >
                      <Button
                        type="button"
                        onClick={handleTradeCtaClick}
                        className={cn(
                          "group/button relative w-full sm:w-auto min-w-[196px] h-11 px-5 gap-2 rounded-xl border text-[15px] font-extrabold tracking-[0.01em] shadow-[0_14px_36px_-20px_rgba(0,0,0,0.95)]",
                          tradeButtonTone
                        )}
                        variant="ghost"
                      >
                        <motion.span
                          aria-hidden
                          className="pointer-events-none absolute inset-y-0 left-0 w-2/5 bg-gradient-to-r from-transparent via-white/28 to-transparent"
                          animate={isSolanaTradeSupported ? { x: ["-130%", "260%"] } : { x: "-130%" }}
                          transition={isSolanaTradeSupported ? { duration: 2.6, repeat: Infinity, ease: "linear" } : undefined}
                        />
                        {!localSettled && isSolanaTradeSupported && isWalletConnectedForTrade && (
                          <span className="relative flex h-2.5 w-2.5">
                            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-lime-300/80" />
                            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-lime-300" />
                          </span>
                        )}
                        {isWalletConnectedForTrade ? <PhewTradeIcon className="h-4 w-4" /> : <PhewFollowIcon className="h-4 w-4" />}
                        <span className="whitespace-nowrap">{tradeCtaLabel}</span>
                      </Button>
                    </motion.div>
                  </div>
                </div>

                {isSolanaTradeSupported && (
                  <div className="mt-2 flex items-center justify-end gap-1.5 flex-wrap">
                    <span className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground mr-1">
                      Quick Buy
                    </span>
                    {buyQuickAmounts.map((amount) => (
                      <button
                        key={`feed-quick-buy-${amount}`}
                        type="button"
                        onClick={() => handleQuickBuyPresetClick(amount)}
                        disabled={isExecutingBuy}
                        className="h-8 rounded-full border border-emerald-300/35 bg-white/80 px-2.5 text-[11px] font-semibold text-slate-700 transition-colors hover:border-emerald-400/50 hover:bg-emerald-50 hover:text-emerald-800 disabled:cursor-not-allowed disabled:opacity-60 dark:border-lime-300/15 dark:bg-lime-300/5 dark:text-lime-50/90 dark:hover:bg-lime-300/10 dark:hover:border-lime-300/25 dark:hover:text-white"
                        title={`Quick buy ${amount} SOL`}
                      >
                        {amount} SOL
                      </button>
                    ))}
                    <button
                      type="button"
                      onClick={() => {
                        setTradeSide("buy");
                        setShowSlippageSettings(true);
                        handleOpenBuyDialog();
                      }}
                      className="h-8 rounded-full border border-border/75 bg-white/80 px-2.5 text-[11px] font-medium text-slate-600 transition-colors hover:bg-white hover:text-slate-900 dark:border-white/10 dark:bg-black/20 dark:text-muted-foreground dark:hover:bg-white/5 dark:hover:text-foreground"
                    >
                      Edit
                    </button>
                  </div>
                )}

                {/* Entry Market Cap - Prominent Display */}
                <div className="mt-4 rounded-[20px] border border-border/60 bg-white/65 p-3 shadow-[inset_0_1px_0_hsl(0_0%_100%/0.72)] dark:bg-background/35 dark:shadow-none">
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium">Entry Market Cap</p>
                  <p className="text-2xl font-bold font-mono text-foreground mt-1">
                    {formatMarketCap(post.entryMcap)}
                  </p>
                </div>

                {/* Market Cap Stats - Different layout for settled vs live */}
                {localSettled ? (
                  <div className="mt-3 space-y-2">
                    {/* 1H Mcap - Official Result (Primary) */}
                    {(() => {
                      const m1hStyles = getMultiplierClasses(multiplier1h);
                      return (
                        <div
                          className={cn(
                            "p-3 rounded-lg border-2 relative overflow-hidden",
                            multiplier1h?.tier === 'mega' && m1hStyles.glow,
                            isGain && "bg-gain/5 border-gain/40",
                            isLoss && "bg-loss/5 border-loss/40",
                            !isGain && !isLoss && "bg-muted/50 border-border"
                          )}
                          style={{
                            boxShadow: multiplier1h?.tier === 'mega'
                              ? "0 0 30px rgba(234, 179, 8, 0.5), inset 0 0 40px rgba(234, 179, 8, 0.1)"
                              : isGain
                              ? "0 0 20px rgba(34, 197, 94, 0.3), inset 0 0 30px rgba(34, 197, 94, 0.05)"
                              : isLoss
                              ? "0 0 20px rgba(239, 68, 68, 0.3), inset 0 0 30px rgba(239, 68, 68, 0.05)"
                              : undefined,
                          }}
                        >
                          <div className="flex items-center justify-between">
                            <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium">
                              1H Snapshot
                            </p>
                            <span
                              className={cn(
                                "text-[9px] font-bold uppercase px-2 py-0.5 rounded-full",
                                isGain && "bg-gain/20 text-gain border border-gain/30",
                                isLoss && "bg-loss/20 text-loss border border-loss/30",
                                !isGain && !isLoss && "bg-primary/20 text-primary border border-primary/30"
                              )}
                            >
                              Official Result
                            </span>
                          </div>
                          <div className="flex items-center justify-between mt-1.5">
                            <p
                              className={cn(
                                "text-xl font-mono font-bold",
                                isGain && "text-gain",
                                isLoss && "text-loss",
                                !isGain && !isLoss && "text-foreground"
                              )}
                            >
                              {formatMarketCap(localMcap1h)}
                            </p>
                            <div className="flex items-center gap-1">
                              {isGain && <TrendingUp className="h-4 w-4 text-gain" />}
                              {isLoss && <TrendingDown className="h-4 w-4 text-loss" />}
                              <span
                                className={cn(
                                  "text-sm font-mono font-bold px-2 py-0.5 rounded",
                                  m1hStyles.text,
                                  multiplier1h?.tier === 'high' && "bg-yellow-500/20",
                                  multiplier1h?.tier === 'mega' && "bg-gradient-to-r from-yellow-500/30 to-amber-500/30 animate-pulse"
                                )}
                              >
                                {multiplier1h?.text ?? "N/A"}
                              </span>
                            </div>
                          </div>
                        </div>
                      );
                    })()}

                    {/* 6H Mcap - Extended Benchmark (if available) */}
                    {localMcap6h !== null && (() => {
                      const m6hStyles = getMultiplierClasses(multiplier6h);
                      return (
                        <div
                          className={cn(
                            "p-2 rounded-lg border",
                            multiplier6h?.tier === 'mega' && m6hStyles.glow,
                            isGain6h && "bg-gain/10 border-gain/30",
                            isLoss6h && "bg-loss/10 border-loss/30",
                            !isGain6h && !isLoss6h && "bg-background/30 border-border/50"
                          )}
                          style={{
                            boxShadow: multiplier6h?.tier === 'mega'
                              ? "0 0 20px rgba(234, 179, 8, 0.4)"
                              : undefined,
                          }}
                        >
                          <div className="flex items-center justify-between">
                            <p className={cn(
                              "text-[10px] uppercase tracking-wider",
                              isGain6h && "text-gain/80",
                              isLoss6h && "text-loss/80",
                              !isGain6h && !isLoss6h && "text-muted-foreground"
                            )}>
                              6H Snapshot
                            </p>
                            <div className="flex items-center gap-1">
                              {isGain6h && <TrendingUp className="h-3 w-3 text-gain" />}
                              {isLoss6h && <TrendingDown className="h-3 w-3 text-loss" />}
                              <span
                                className={cn(
                                  "text-xs font-mono font-medium px-1.5 py-0.5 rounded",
                                  m6hStyles.text,
                                  multiplier6h?.tier === 'high' && "bg-yellow-500/15",
                                  multiplier6h?.tier === 'mega' && "bg-gradient-to-r from-yellow-500/25 to-amber-500/25"
                                )}
                              >
                                {multiplier6h?.text ?? "N/A"}
                              </span>
                            </div>
                          </div>
                          <p className={cn(
                            "text-sm font-mono font-semibold mt-0.5",
                            isGain6h && "text-gain",
                            isLoss6h && "text-loss",
                            !isGain6h && !isLoss6h && "text-foreground"
                          )}>
                            {formatMarketCap(localMcap6h)}
                          </p>
                        </div>
                      );
                    })()}

                    {/* Current Mcap - Same layout as 1H/6H rows */}
                    {(() => {
                      const mCurrentStyles = getMultiplierClasses(multiplierCurrent);
                      return (
                        <div
                          className={cn(
                            "p-2 rounded-lg border",
                            multiplierCurrent?.tier === 'mega' && mCurrentStyles.glow,
                            isGainCurrent && "bg-gain/10 border-gain/30",
                            isLossCurrent && "bg-loss/10 border-loss/30",
                            !isGainCurrent && !isLossCurrent && "bg-background/30 border-border/50"
                          )}
                          style={{
                            boxShadow: multiplierCurrent?.tier === 'mega'
                              ? "0 0 20px rgba(234, 179, 8, 0.4)"
                              : undefined,
                          }}
                        >
                          <div className="flex items-center justify-between">
                            <p className={cn(
                              "text-[10px] uppercase tracking-wider",
                              isGainCurrent && "text-gain/80",
                              isLossCurrent && "text-loss/80",
                              !isGainCurrent && !isLossCurrent && "text-muted-foreground"
                            )}>
                              Current
                            </p>
                            <div className="flex items-center gap-1">
                              {isGainCurrent && <TrendingUp className="h-3 w-3 text-gain" />}
                              {isLossCurrent && <TrendingDown className="h-3 w-3 text-loss" />}
                              <span
                                className={cn(
                                  "text-xs font-mono font-medium px-1.5 py-0.5 rounded",
                                  mCurrentStyles.text,
                                  multiplierCurrent?.tier === 'high' && "bg-yellow-500/15",
                                  multiplierCurrent?.tier === 'mega' && "bg-gradient-to-r from-yellow-500/25 to-amber-500/25"
                                )}
                              >
                                {multiplierCurrent?.text ?? "N/A"}
                              </span>
                            </div>
                          </div>
                          <p className={cn(
                            "text-sm font-mono font-semibold mt-0.5",
                            isGainCurrent && "text-gain",
                            isLossCurrent && "text-loss",
                            !isGainCurrent && !isLossCurrent && "text-foreground"
                          )}>
                            {formatMarketCap(currentMcap)}
                          </p>
                        </div>
                      );
                    })()}
                  </div>
                ) : (
                  /* Live - Before 1H Settlement */
                  <div className="mt-3 grid grid-cols-2 gap-3">
                    {(() => {
                      const mLiveStyles = getMultiplierClasses(multiplierLive);
                      return (
                        <>
                          <div
                            className={cn(
                              "rounded-[18px] border border-primary/20 bg-white/60 p-2 shadow-[inset_0_1px_0_hsl(0_0%_100%/0.7)] dark:bg-background/35 dark:shadow-none",
                              multiplierLive?.tier === 'mega' && mLiveStyles.glow
                            )}
                            style={{
                              boxShadow: multiplierLive?.tier === 'mega'
                                ? "0 0 20px rgba(234, 179, 8, 0.4)"
                                : undefined,
                            }}
                          >
                            <div className="flex items-center gap-1.5">
                              <span className="relative flex h-2 w-2">
                                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75"></span>
                                <span className="relative inline-flex rounded-full h-2 w-2 bg-primary"></span>
                              </span>
                              <p className="text-[10px] text-primary uppercase tracking-wider font-semibold">LIVE</p>
                            </div>
                            <p className="text-base font-mono font-semibold text-foreground mt-1">
                              {formatMarketCap(currentMcap)}
                            </p>
                          </div>
                          <div
                            className={cn(
                              "rounded-[18px] bg-white/55 p-2 shadow-[inset_0_1px_0_hsl(0_0%_100%/0.72)] dark:bg-background/35 dark:shadow-none",
                              multiplierLive?.tier === 'mega' && "border border-yellow-500/30"
                            )}
                          >
                            <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Change</p>
                            <div className="flex items-center gap-1 mt-1">
                              {isGain && <TrendingUp className="h-4 w-4 text-gain" />}
                              {isLoss && <TrendingDown className="h-4 w-4 text-loss" />}
                              <p
                                className={cn(
                                  "text-base font-mono font-bold px-1.5 py-0.5 rounded",
                                  mLiveStyles.text,
                                  multiplierLive?.tier === 'high' && "bg-yellow-500/15",
                                  multiplierLive?.tier === 'mega' && "bg-gradient-to-r from-yellow-500/25 to-amber-500/25 animate-pulse"
                                )}
                              >
                                {multiplierLive?.text ?? "N/A"}
                              </p>
                            </div>
                          </div>
                        </>
                      );
                    })()}
                  </div>
                )}

                {hasWalletTradeInfo && (
                  <div className="mt-3 rounded-[20px] border border-border/60 bg-white/45 p-3 shadow-[inset_0_1px_0_hsl(0_0%_100%/0.7)] dark:bg-background/25 dark:shadow-none">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-[10px] uppercase tracking-wider font-semibold text-foreground/80">
                        Wallet Trade Summary
                      </p>
                    </div>

                    <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {(holdingUsd !== null || holdingAmount !== null) && (
                        <div className="rounded-[16px] border border-border/60 bg-white/60 p-2.5 shadow-[inset_0_1px_0_hsl(0_0%_100%/0.68)] dark:bg-background/40 dark:shadow-none sm:col-span-2">
                          <div className="flex items-center justify-between gap-2">
                            <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Holding</p>
                            {holdingAmount !== null && (
                              <p className="text-[11px] font-mono text-muted-foreground">
                                Qty {holdingAmount.toLocaleString(undefined, { maximumFractionDigits: 6 })}
                              </p>
                            )}
                          </div>
                          <p className="mt-1 text-sm font-semibold text-foreground">
                            {holdingUsd !== null ? formatUsdStat(holdingUsd) : "N/A"}
                          </p>
                        </div>
                      )}

                      {verifiedTotalPnlUsd !== null && (
                        <div className="rounded-[16px] border border-border/60 bg-white/60 p-2.5 shadow-[inset_0_1px_0_hsl(0_0%_100%/0.68)] dark:bg-background/40 dark:shadow-none">
                          <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Wallet P/L</p>
                          <p className={cn("mt-1 text-sm font-semibold", verifiedTotalPnlUsd >= 0 ? "text-gain" : "text-loss")}>
                            {winCardVerifiedPnlText}
                          </p>
                        </div>
                      )}

                      {(boughtUsd !== null || boughtAmount !== null) && (
                        <div className="rounded-[16px] border border-border/60 bg-white/60 p-2.5 shadow-[inset_0_1px_0_hsl(0_0%_100%/0.68)] dark:bg-background/40 dark:shadow-none">
                          <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Bought</p>
                          <p className="mt-1 text-sm font-semibold text-foreground">
                            {boughtUsd !== null ? formatUsdStat(boughtUsd) : "N/A"}
                          </p>
                          {boughtAmount !== null && (
                            <p className="mt-0.5 text-[10px] text-muted-foreground">
                              Qty {boughtAmount.toLocaleString(undefined, { maximumFractionDigits: 6 })}
                            </p>
                          )}
                        </div>
                      )}

                      {(soldUsd !== null || soldAmount !== null) && (
                        <div className="rounded-[16px] border border-border/60 bg-white/60 p-2.5 shadow-[inset_0_1px_0_hsl(0_0%_100%/0.68)] dark:bg-background/40 dark:shadow-none">
                          <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Sold</p>
                          <p className="mt-1 text-sm font-semibold text-foreground">
                            {soldUsd !== null ? formatUsdStat(soldUsd) : "N/A"}
                          </p>
                          {soldAmount !== null && (
                            <p className="mt-0.5 text-[10px] text-muted-foreground">
                              Qty {soldAmount.toLocaleString(undefined, { maximumFractionDigits: 6 })}
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* Settlement Timer */}
                {isSettlementPending && (
                  <div className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Clock className="h-3.5 w-3.5" />
                    <span>Settles in {minutesLeft}m</span>
                  </div>
                )}
              </div>
            )}

            {/* Shared By Counter - Clickable Badge (Reposts) */}
            {sharedByCount > 0 && (
              <button
                onClick={() => setIsRepostersOpen(true)}
                className={cn(
                  "mt-3 inline-flex items-center gap-2 rounded-full border border-primary/20 px-3 py-2",
                  "bg-primary/5 hover:bg-primary/10",
                  "text-sm text-foreground font-medium transition-all duration-200",
                  "hover:border-primary/40 hover:shadow-[0_16px_30px_-24px_hsl(var(--primary)/0.3)] cursor-pointer dark:hover:shadow-none"
                )}
              >
                <Users className="h-4 w-4 text-primary" />
                <span>Shared by {sharedByCount} {sharedByCount === 1 ? "other" : "others"}</span>
                <div className="flex -space-x-2 ml-1">
                  {post.sharedBy?.slice(0, 3).map((user) => (
                    <Avatar key={user.id} className="h-6 w-6 border-2 border-background">
                      <AvatarImage src={getAvatarUrl(user.id, user.image)} />
                      <AvatarFallback className="text-[9px] bg-muted">{user.name?.charAt(0)}</AvatarFallback>
                    </Avatar>
                  ))}
                  {sharedByCount > 3 && (
                    <div className="h-6 w-6 rounded-full bg-muted border-2 border-background flex items-center justify-center">
                      <span className="text-[9px] font-medium text-muted-foreground">+{sharedByCount - 3}</span>
                    </div>
                  )}
                </div>
              </button>
            )}

            {shouldShowIntelligenceStrip ? (
              <div className="mt-3 space-y-2">
                <div className="grid grid-cols-2 gap-2 xl:grid-cols-4">
                  <div className="rounded-[18px] border border-border/60 bg-white/55 px-3 py-2.5 text-sm shadow-[inset_0_1px_0_hsl(0_0%_100%/0.7)] dark:bg-white/[0.03] dark:shadow-none">
                    <div className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Alpha confidence</div>
                    <div className="mt-1 flex items-center justify-between gap-3">
                      <div className="h-2 flex-1 overflow-hidden rounded-full bg-secondary">
                        <div
                          className="h-full rounded-full bg-primary transition-[width,opacity] duration-200"
                          style={{ width: `${normalizedConfidenceScore ?? 0}%`, opacity: normalizedConfidenceScore === null ? 0.35 : 1 }}
                        />
                      </div>
                      <span className="font-semibold text-foreground">
                        {normalizedConfidenceScore === null ? "Pending" : `${normalizedConfidenceScore.toFixed(0)}%`}
                      </span>
                    </div>
                  </div>
                  <div className="rounded-[18px] border border-border/60 bg-white/55 px-3 py-2.5 text-sm shadow-[inset_0_1px_0_hsl(0_0%_100%/0.7)] dark:bg-white/[0.03] dark:shadow-none">
                    <div className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Trader tier</div>
                    <div className="mt-1 font-semibold text-foreground">{traderTier}</div>
                  </div>
                  <div className="rounded-[18px] border border-border/60 bg-white/55 px-3 py-2.5 text-sm shadow-[inset_0_1px_0_hsl(0_0%_100%/0.7)] dark:bg-white/[0.03] dark:shadow-none">
                    <div className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Bundle risk</div>
                    <div className="mt-1 font-semibold text-foreground">
                      {normalizedBundleRiskLabel} | {normalizedBundledSupplyPct}
                    </div>
                  </div>
                  <div className="rounded-[18px] border border-border/60 bg-white/55 px-3 py-2.5 text-sm shadow-[inset_0_1px_0_hsl(0_0%_100%/0.7)] dark:bg-white/[0.03] dark:shadow-none">
                    <div className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Timing</div>
                    <div className="mt-1 font-semibold text-foreground">{post.timingTier || "UNRANKED"}</div>
                  </div>
                </div>
                {tokenPageHref ? (
                  <button
                    type="button"
                    onClick={() => navigate(tokenPageHref)}
                    className="group relative overflow-hidden rounded-[20px] border border-primary/30 bg-[radial-gradient(circle_at_top_left,hsl(var(--primary)/0.18),transparent_42%),linear-gradient(135deg,hsl(var(--primary)/0.14),hsl(var(--background))_78%)] px-4 py-3.5 text-left shadow-[0_24px_56px_-34px_hsl(var(--primary)/0.45)] transition-all duration-200 hover:border-primary/45 hover:shadow-[0_28px_62px_-30px_hsl(var(--primary)/0.58)]"
                  >
                    <div className="absolute inset-0 bg-[linear-gradient(120deg,transparent,rgba(255,255,255,0.06),transparent)] opacity-0 transition-opacity duration-200 group-hover:opacity-100" />
                    <div className="relative flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <div className="min-w-0">
                        <div className="inline-flex items-center gap-1 rounded-full border border-primary/20 bg-primary/10 px-2 py-1 text-[9px] font-black uppercase tracking-[0.22em] text-primary">
                          <Sparkles className="h-3 w-3" />
                          Phew Ultra
                        </div>
                        <div className="mt-2 flex items-center gap-2">
                          <span className="text-base font-semibold text-foreground">Open Token Lab</span>
                          <span className="hidden rounded-full border border-primary/15 bg-primary/8 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-primary sm:inline-flex">
                            Research hub
                          </span>
                        </div>
                        <p className="mt-1 text-[12px] leading-5 text-muted-foreground">
                          Open instantly, then load the deeper chart, callers, and risk data inside the token page.
                        </p>
                      </div>
                      <div className="flex items-center gap-3 self-start sm:self-auto">
                        <div className="hidden h-10 w-px bg-gradient-to-b from-transparent via-primary/20 to-transparent sm:block" />
                        <div className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/10 px-3 py-2 text-sm font-semibold text-primary transition-transform duration-200 group-hover:translate-x-0.5">
                          View
                          <ExternalLink className="h-4 w-4" />
                        </div>
                      </div>
                    </div>
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>

        {/* Social Buttons */}
        <div className="mt-5 flex items-center justify-between border-t border-border/50 pt-4">
          <div className="flex flex-wrap items-center gap-1.5">
            {REACTION_BUTTONS.map((reaction) => {
              const isActive = currentReactionType === reaction.type;
              const count = reactionCounts[reaction.type] ?? 0;
              return (
                <Button
                  key={reaction.type}
                  variant="ghost"
                  size="sm"
                  onClick={() => void handleReaction(reaction.type)}
                  className={cn(
                    "h-10 rounded-full border border-border/60 bg-white/55 px-3 text-muted-foreground shadow-[0_18px_30px_-28px_hsl(var(--foreground)/0.15)] dark:border-white/[0.08] dark:bg-white/[0.04] dark:shadow-none",
                    isActive && "border-primary/35 bg-primary/10 text-foreground"
                  )}
                >
                  <span className="text-sm">{reaction.emoji}</span>
                  <span className="text-[11px] font-semibold">{count > 0 ? count : reaction.label}</span>
                </Button>
              );
            })}

            {/* Comment Button */}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setIsCommentsOpen(!isCommentsOpen)}
              className="h-10 rounded-full border border-border/60 bg-white/55 px-3 text-muted-foreground shadow-[0_18px_30px_-28px_hsl(var(--foreground)/0.15)] dark:border-white/[0.08] dark:bg-white/[0.04] dark:shadow-none"
            >
              <PhewCommentIcon className={cn("h-4 w-4", isCommentsOpen && "text-primary")} />
              <span className="text-xs font-semibold">{threadTotal > 0 ? threadTotal : ""}</span>
            </Button>

            {/* Repost Button */}
            <Button
              variant="ghost"
              size="sm"
              onClick={handleRepost}
              className={cn(
                "h-10 rounded-full border border-border/60 bg-white/55 px-3 text-muted-foreground shadow-[0_18px_30px_-28px_hsl(var(--foreground)/0.15)] dark:border-white/[0.08] dark:bg-white/[0.04] dark:shadow-none",
                isReposted && "text-gain hover:text-gain"
              )}
            >
              <PhewRepostIcon className={cn("h-4 w-4", isReposted && "text-gain")} />
              <span className="text-xs font-semibold">{repostCount > 0 ? repostCount : ""}</span>
            </Button>

            {/* Share Button */}
            <Button
              variant="ghost"
              size="sm"
              onClick={handleShare}
              className="h-10 rounded-full border border-border/60 bg-white/55 px-3 text-muted-foreground shadow-[0_18px_30px_-28px_hsl(var(--foreground)/0.15)] dark:border-white/[0.08] dark:bg-white/[0.04] dark:shadow-none"
            >
              {copied ? <Check className="h-4 w-4 text-gain" /> : <PhewShareIcon className="h-4 w-4" />}
            </Button>

            {/* Wincard / Result card preview */}
            <Button
              variant="ghost"
              size="sm"
              onClick={handleOpenWinCardPreview}
              className="h-10 rounded-full border border-border/60 bg-white/55 px-3 text-muted-foreground shadow-[0_18px_30px_-28px_hsl(var(--foreground)/0.15)] dark:border-white/[0.08] dark:bg-white/[0.04] dark:shadow-none"
              title="Preview shareable win card"
            >
              <Download className="h-4 w-4" />
            </Button>
          </div>

          {/* View Count */}
          <div className="flex flex-wrap items-center justify-end gap-2 text-xs text-muted-foreground">
            {hotAlphaScore !== null && hotAlphaScore >= 70 ? (
              <span className="rounded-full border border-border/60 bg-secondary px-2.5 py-1">Hot {hotAlphaScore.toFixed(0)}</span>
            ) : null}
            {earlyRunnerScore !== null && earlyRunnerScore >= 70 ? (
              <span className="rounded-full border border-border/60 bg-secondary px-2.5 py-1">Runner {earlyRunnerScore.toFixed(0)}</span>
            ) : null}
            {highConvictionScore !== null && highConvictionScore >= 75 ? (
              <span className="rounded-full border border-border/60 bg-secondary px-2.5 py-1">Conviction {highConvictionScore.toFixed(0)}</span>
            ) : null}
            {post.viewCount > 0 ? <span>{post.viewCount.toLocaleString()} views</span> : null}
          </div>
        </div>

        {/* Comments Section - Animated */}
        <AnimatePresence>
          {isCommentsOpen && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ type: "spring", damping: 25, stiffness: 300 }}
              className="overflow-hidden"
            >
              <div className="mt-3 pt-3 border-t border-border/50 space-y-3">
                {/* Add Comment Input */}
                <motion.div
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ type: "spring", damping: 25, stiffness: 300, delay: 0.1 }}
                  className="space-y-2"
                >
                  {replyingToComment ? (
                    <div className="flex items-center justify-between rounded-[16px] border border-border/60 bg-secondary px-3 py-2 text-xs text-muted-foreground">
                      <span>
                        Replying to {replyingToComment.author.username || replyingToComment.author.name}
                      </span>
                      <button
                        type="button"
                        onClick={() => setReplyingToComment(null)}
                        className="font-semibold text-primary"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : null}
                  <div className="flex items-center gap-2">
                    <Input
                      placeholder={replyingToComment ? "Reply to thread..." : "Add a comment..."}
                      value={commentText}
                      onChange={(e) => setCommentText(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && handleSubmitComment()}
                      className="h-10 flex-1 text-sm"
                    />
                    <Button
                      size="sm"
                      onClick={handleSubmitComment}
                      disabled={!commentText.trim()}
                      className="h-10 rounded-full px-3"
                    >
                      <PhewSendIcon className="h-4 w-4" />
                    </Button>
                  </div>
                </motion.div>

                {/* Comments List */}
                <motion.div
                  initial="hidden"
                  animate="visible"
                  variants={{
                    visible: {
                      transition: {
                        staggerChildren: 0.05
                      }
                    }
                  }}
                  className="space-y-3 max-h-80 overflow-y-auto"
                >
                  {isCommentsLoading ? (
                    <div className="flex items-center justify-center py-4">
                      <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                    </div>
                  ) : comments && comments.length > 0 ? (
                    comments.map((comment) => (
                      <motion.div
                        key={comment.id}
                        variants={{
                          hidden: { opacity: 0, y: -10 },
                          visible: { opacity: 1, y: 0 }
                        }}
                        className="flex items-start gap-2 rounded-[18px] border border-border/50 bg-white/50 p-2.5 shadow-[inset_0_1px_0_hsl(0_0%_100%/0.7)] dark:bg-white/[0.03] dark:shadow-none"
                        style={{ marginLeft: `${Math.min(comment.depth ?? 0, 4) * 14}px` }}
                      >
                        <Avatar
                          className="h-7 w-7 cursor-pointer border border-border"
                          onClick={() => navigate(buildProfilePath(comment.author.id, comment.author.username))}
                        >
                          <AvatarImage src={getAvatarUrl(comment.author.id, comment.author.image)} />
                          <AvatarFallback className="text-[10px] bg-muted">
                            {comment.author.name?.charAt(0) || "?"}
                          </AvatarFallback>
                        </Avatar>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5">
                            <button
                              onClick={() => navigate(buildProfilePath(comment.author.id, comment.author.username))}
                              className="text-xs font-semibold text-foreground hover:text-primary hover:underline transition-colors"
                            >
                              {comment.author.username || comment.author.name}
                            </button>
                            <LevelBadge level={comment.author.level} className="text-[8px] px-1 py-0" />
                            <span className="text-[10px] text-muted-foreground">
                              {formatTimeAgo(comment.createdAt)}
                            </span>
                          </div>
                          <p className="text-sm text-foreground mt-0.5 break-words">
                            {comment.content}
                          </p>
                          <div className="mt-2 flex items-center gap-3 text-[11px] text-muted-foreground">
                            <button
                              type="button"
                              onClick={() => setReplyingToComment(comment)}
                              className="font-semibold text-primary"
                            >
                              Reply
                            </button>
                            {typeof comment.replyCount === "number" && comment.replyCount > 0 ? (
                              <span>{comment.replyCount} replies</span>
                            ) : null}
                            {comment.kind ? <span className="uppercase tracking-[0.14em]">{comment.kind}</span> : null}
                          </div>
                        </div>
                      </motion.div>
                    ))
                  ) : (
                    <motion.p
                      variants={{
                        hidden: { opacity: 0, y: -10 },
                        visible: { opacity: 1, y: 0 }
                      }}
                      className="text-sm text-muted-foreground text-center py-4"
                    >
                      No comments yet. Be the first!
                    </motion.p>
                  )}
                </motion.div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <Dialog open={isWalletConnectDialogOpen} onOpenChange={(open) => {
        setIsWalletConnectDialogOpen(open);
        if (!open) {
          setPendingBuyAfterWalletConnect(false);
          if (!tradeWalletPublicKey) {
            setPendingQuickBuyAutoExecute(false);
          }
        }
      }}>
        <DialogContent className={walletConnectDialogClassName}>
          <div className="relative">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_10%,rgba(163,230,53,0.14),transparent_52%),radial-gradient(circle_at_100%_0%,rgba(45,212,191,0.12),transparent_58%)] dark:bg-[radial-gradient(circle_at_20%_10%,rgba(163,230,53,0.14),transparent_52%),radial-gradient(circle_at_100%_0%,rgba(45,212,191,0.12),transparent_58%)]" />
            <div className="absolute inset-0 opacity-[0.03] dark:opacity-[0.035]" style={{ backgroundImage: "linear-gradient(rgba(15,23,42,0.18) 1px, transparent 1px), linear-gradient(90deg, rgba(15,23,42,0.18) 1px, transparent 1px)", backgroundSize: "18px 18px" }} />
            <DialogHeader className="relative border-b border-slate-900/10 px-5 pb-4 pt-5 dark:border-white/10">
              <DialogTitle className="flex items-center gap-2 text-base sm:text-lg">
                <PhewFollowIcon className="h-4 w-4 text-amber-500 dark:text-amber-200" />
                Connect Wallet to Buy
              </DialogTitle>
              <DialogDescription className="text-xs sm:text-sm text-muted-foreground">
                Connect a Solana wallet first. Once connected, we will open the buy panel automatically.
              </DialogDescription>
            </DialogHeader>

            <div className="relative p-5 space-y-4">
              <div className="rounded-2xl border border-slate-900/10 bg-white/65 p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.7)] dark:border-white/10 dark:bg-white/[0.03] dark:shadow-none">
                <div className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Selected token</div>
                <div className="mt-3 flex items-center gap-3">
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-slate-900/10 bg-slate-900/[0.04] dark:border-white/10 dark:bg-black/30">
                    {resolvedTokenImage ? (
                      <img src={resolvedTokenImage} alt={displayTokenLabel} className="h-full w-full object-cover" />
                    ) : (
                      <Coins className="h-4 w-4 text-muted-foreground" />
                    )}
                  </div>
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-foreground truncate">
                      {displayTokenLabel}
                    </div>
                    <div className="text-xs text-muted-foreground truncate">
                      {post.contractAddress || "No contract"}
                    </div>
                  </div>
                </div>
              </div>

              {walletDisplayName !== undefined ? (
              <div className="rounded-2xl border border-slate-900/10 bg-slate-900/[0.03] p-4 shadow-[0_18px_44px_-36px_rgba(148,163,184,0.65)] dark:border-white/10 dark:bg-black/20 dark:shadow-none">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <div className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Wallet status</div>
                    <div className="mt-1 text-sm font-medium text-foreground">
                      {wallet.connecting ? "Connecting..." : walletShortAddress ? `${walletDisplayName} • ${walletShortAddress}` : "Not connected"}
                    </div>
                  </div>
                  <span className={cn(
                    "rounded-full border px-2.5 py-1 text-[10px] font-medium tracking-[0.12em]",
                    walletShortAddress
                      ? "border-lime-300/20 bg-lime-300/10 text-lime-100"
                      : "border-cyan-300/25 bg-cyan-300/10 text-cyan-100"
                  )}>
                    {walletShortAddress ? "READY" : "CONNECT"}
                  </span>
                </div>
                <div className="mt-4 grid gap-2 sm:grid-cols-2">
                  <Button
                    type="button"
                    onClick={() => openWalletSelector({ closeWalletConnectDialog: true })}
                    disabled={wallet.connecting}
                    className={cn(
                      "h-11 gap-2 font-semibold",
                      connectWalletTone
                    )}
                  >
                    {wallet.connecting ? <Loader2 className="h-4 w-4 animate-spin" /> : <PhewFollowIcon className="h-4 w-4" />}
                    {walletShortAddress ? "Switch Wallet" : "Choose Wallet"}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      setPendingBuyAfterWalletConnect(false);
                      setIsWalletConnectDialogOpen(false);
                    }}
                    className="h-11 border-slate-900/10 bg-white/70 text-slate-700 hover:bg-white dark:border-white/10 dark:bg-white/5 dark:text-white/70 dark:hover:bg-white/10"
                  >
                    Cancel
                  </Button>
                </div>
                <p className="mt-3 text-xs text-muted-foreground">
                  If the wallet popup does not open, disable browser popup blocking for this site and ensure Phantom / Solflare is installed and unlocked.
                </p>
              </div>
            ) : (
              <div className="relative overflow-hidden rounded-[26px] border border-white/10 bg-[#071019] shadow-[0_28px_90px_-36px_rgba(0,0,0,0.85)] ring-1 ring-white/5">
                <div className="absolute inset-0 bg-[linear-gradient(135deg,#081420_0%,#07111a_48%,#04080f_100%)]" />
                <div className="absolute inset-0 opacity-[0.05] [background-image:linear-gradient(rgba(255,255,255,0.9)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.9)_1px,transparent_1px)] [background-size:52px_52px]" />
                <div className="absolute inset-0 bg-[radial-gradient(circle_at_16%_14%,rgba(163,230,53,0.16),transparent_34%),radial-gradient(circle_at_86%_16%,rgba(45,212,191,0.16),transparent_34%),radial-gradient(circle_at_50%_88%,rgba(148,163,184,0.12),transparent_38%)]" />
                <div
                  className={cn(
                    "absolute -top-20 left-16 h-72 w-72 rounded-full blur-3xl",
                    winCardTrendTone === "gain"
                      ? "bg-gain/20"
                      : winCardTrendTone === "loss"
                        ? "bg-loss/20"
                        : "bg-slate-400/20"
                  )}
                />
                <div className="absolute bottom-[-18%] right-[-8%] h-72 w-72 rounded-full bg-primary/12 blur-3xl" />

                <div className="relative p-4 sm:p-6">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="rounded-2xl border border-white/10 bg-white/[0.05] px-4 py-3 shadow-[0_16px_40px_-24px_rgba(0,0,0,0.9)]">
                      <BrandLogo size="sm" className="gap-3" />
                      <div className="mt-1 pl-[3.25rem] text-[10px] font-medium uppercase tracking-[0.18em] text-slate-300/60">
                        Official alpha result card
                      </div>
                    </div>
                    <div
                      className={cn(
                        "inline-flex items-center rounded-full border px-3.5 py-1.5 text-[11px] font-semibold tracking-[0.16em]",
                        winCardTrendTone === "gain"
                          ? "border-gain/35 bg-gain/10 text-gain"
                          : winCardTrendTone === "loss"
                            ? "border-loss/35 bg-loss/10 text-loss"
                            : "border-white/10 bg-white/5 text-slate-300"
                      )}
                    >
                      {winCardResultLabel}
                    </div>
                  </div>

                  <div className="mt-4 grid gap-4 lg:grid-cols-[1.06fr_0.94fr]">
                    <div className="rounded-[22px] border border-white/10 bg-white/[0.045] p-4 shadow-[0_22px_60px_-38px_rgba(0,0,0,0.92)]">
                      <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-300/68">
                        {winCardStatusTitle}
                      </div>
                      <div className={cn("mt-2 text-[2.35rem] font-black tracking-tight sm:text-[4.5rem]", winCardAccentClass)}>
                        {winCardResultText}
                      </div>
                      <div className="text-sm text-slate-300/72 sm:text-base">{winCardStatusDetail}</div>

                      <div className="mt-4 grid gap-2 sm:grid-cols-2">
                        <div className="rounded-2xl border border-white/10 bg-white/[0.045] px-3.5 py-3">
                          <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-300/56">
                            {winCardMarketMoveLabel}
                          </div>
                          <div className={cn("mt-1 text-base font-semibold", winCardAccentClass)}>{winCardMarketMoveText}</div>
                        </div>
                        <div className="rounded-2xl border border-white/10 bg-white/[0.045] px-3.5 py-3">
                          <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-300/56">
                            {winCardVerifiedPnlLabel ?? "Status"}
                          </div>
                          <div
                            className={cn(
                              "mt-1 text-base font-semibold",
                              winCardVerifiedPnlText
                                ? verifiedTotalPnlUsd !== null && verifiedTotalPnlUsd >= 0
                                  ? "text-gain"
                                  : "text-loss"
                                : "text-white"
                            )}
                          >
                            {winCardVerifiedPnlText ?? winCardStatusDetail}
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="rounded-[22px] border border-white/10 bg-white/[0.045] p-4 shadow-[0_22px_60px_-38px_rgba(0,0,0,0.92)]">
                      <div className="flex items-center gap-3">
                        <Avatar className="h-14 w-14 border border-white/10">
                          <AvatarImage src={getAvatarUrl(post.author.id, post.author.image)} />
                          <AvatarFallback className="bg-white/5 text-base font-bold text-white">
                            {(post.author.username || post.author.name || "?").charAt(0).toUpperCase()}
                          </AvatarFallback>
                        </Avatar>
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-xl font-semibold text-white">
                            {post.author.username ? `@${post.author.username}` : post.author.name}
                          </div>
                          <div className="truncate text-[11px] uppercase tracking-[0.12em] text-slate-300/68">
                            Level {post.author.level > 0 ? `+${post.author.level}` : post.author.level} / {formatTimeAgo(post.createdAt)}
                          </div>
                        </div>
                        <div className="rounded-full border border-lime-300/20 bg-gradient-to-r from-lime-300/12 to-cyan-300/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-lime-100">
                          {post.chainType?.toUpperCase() || "CHAIN"}
                        </div>
                      </div>

                      <div className="mt-4 rounded-[20px] border border-white/10 bg-gradient-to-r from-lime-300/8 via-white/[0.04] to-cyan-300/8 p-3.5">
                        <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-300/60">Called token</div>
                        <div className="mt-1 truncate text-lg font-semibold text-white">{winCardTokenPrimary}</div>
                        <div className="mt-1 truncate text-sm text-slate-300/74">{winCardTokenSecondary}</div>
                      </div>

                      <div className="mt-3 rounded-[20px] border border-white/10 bg-black/20 p-3.5">
                        <div className="mb-2 flex items-center justify-between gap-2">
                          <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-300/60">
                            Reputation
                          </div>
                          <div className={cn("text-[11px] font-semibold tracking-[0.12em]", winCardLevelToneClass)}>
                            {winCardLevelLabel} / LVL {post.author.level > 0 ? `+${post.author.level}` : post.author.level}
                          </div>
                        </div>
                        <LevelBar level={post.author.level} size="sm" showLabel={false} className="space-y-0" />
                      </div>
                    </div>
                  </div>

                  <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                    {winCardMetricCards.map((metric) => (
                      <div
                        key={metric.label}
                        className={cn(
                          "rounded-[20px] border p-3.5 shadow-[0_18px_50px_-36px_rgba(0,0,0,0.9)]",
                          metric.emphasis
                            ? "border-lime-300/25 bg-gradient-to-br from-lime-300/12 via-white/[0.04] to-cyan-300/12"
                            : "border-white/10 bg-white/[0.045]"
                        )}
                      >
                        <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-300/60">
                          {metric.label}
                        </div>
                        <div className={cn("mt-1.5 text-lg font-bold", metric.toneClass ?? "text-white")}>
                          {metric.value}
                        </div>
                        <div className="mt-1 text-[11px] text-slate-300/68">{metric.hint}</div>
                      </div>
                    ))}
                  </div>

                  <div className="mt-4 grid gap-3 lg:grid-cols-[1fr_0.78fr_1.05fr]">
                    <div className="rounded-[20px] border border-white/10 bg-white/[0.045] p-3.5">
                      <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-300/60">
                        Snapshot ladder
                      </div>
                      <div className="mt-3 space-y-3">
                        {winCardSnapshotRows.map((metric) => (
                          <div key={metric.label} className="flex items-center gap-3">
                            <div className="h-2 w-12 overflow-hidden rounded-full bg-white/10">
                              <div
                                className={cn(
                                  "h-full rounded-full",
                                  metric.positive === null
                                    ? "bg-white/20"
                                    : metric.positive
                                      ? "bg-gradient-to-r from-lime-300/80 to-green-400/80"
                                      : "bg-gradient-to-r from-rose-400/80 to-red-500/80"
                                )}
                                style={{ width: `${Math.max(8, Math.round(metric.magnitudeRatio * 100))}%` }}
                              />
                            </div>
                            <div className="w-9 text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-300/68">
                              {metric.shortLabel}
                            </div>
                            <div className={cn("min-w-0 flex-1 text-sm font-semibold", metric.toneClass)}>
                              {metric.percentText}
                            </div>
                            <div className={cn("text-sm", metric.positive === null ? "text-slate-300/72" : metric.toneClass)}>
                              {metric.profitText}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="rounded-[20px] border border-white/10 bg-white/[0.045] p-3.5">
                      <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-300/60">
                        {winCardWalletSummaryCards.length > 0 ? "Wallet summary" : "Engagement"}
                      </div>
                      <div className="mt-3 space-y-2.5">
                        {winCardWalletSummaryCards.length > 0 ? (
                          (winCardWalletSummaryCards as Array<{ label: string; value: string; hint: string; toneClass: string }>)
                            .slice(0, 3)
                            .map((item) => (
                              <div key={item.label} className="rounded-2xl border border-white/10 bg-black/20 px-3 py-2.5">
                                <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-300/56">
                                  {item.label}
                                </div>
                                <div className={cn("mt-1 text-sm font-semibold", item.toneClass)}>{item.value}</div>
                                <div className="mt-0.5 text-[11px] text-slate-300/68">{item.hint}</div>
                              </div>
                            ))
                        ) : (
                          <>
                            <div className="rounded-2xl border border-white/10 bg-black/20 px-3 py-2.5 text-sm font-medium text-white">
                              {likeCount} likes / {commentCount} comments / {repostCount} reposts
                            </div>
                            <div className="rounded-2xl border border-white/10 bg-black/20 px-3 py-2.5 text-sm text-slate-300/78">
                              {winCardStatusDetail}
                            </div>
                          </>
                        )}
                      </div>
                    </div>

                    <div className="rounded-[20px] border border-white/10 bg-white/[0.045] p-3.5">
                      <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-300/60">
                        Alpha notes
                      </div>
                      <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-relaxed text-slate-100">
                        {winCardPostPreview}
                      </p>
                      <div className="mt-4 text-[11px] text-slate-300/62">Post ID {post.id.slice(0, 10)}...</div>
                    </div>
                  </div>

                  <div className="mt-4 flex flex-col gap-2 text-[11px] text-slate-300/70 sm:flex-row sm:items-center sm:justify-between">
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-3 py-1.5">
                      <Sparkles className="h-3 w-3 text-slate-300/80" />
                      Generated on PHEW.RUN for fast sharing
                    </span>
                    <span className="rounded-full border border-white/10 bg-black/20 px-3 py-1.5">
                      {localSettled ? "Settlement verified snapshot" : "Live snapshot at export time"}
                    </span>
                  </div>
                </div>
              </div>
            )}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={isBuyDialogOpen} onOpenChange={(open) => {
        // Ignore close events fired by dialog internals; close is handled explicitly.
        if (open) {
          setIsBuyDialogOpen(true);
        }
      }}>
        <DialogContent
          className={tradeDialogSurfaceClassName}
          onInteractOutside={(event) => event.preventDefault()}
          onPointerDownOutside={(event) => event.preventDefault()}
          onEscapeKeyDown={(event) => event.preventDefault()}
        >
          <DialogHeader className={tradeDialogHeaderClassName}>
            <div className="flex items-center justify-between gap-3">
              <DialogTitle className="flex items-center gap-2.5 text-sm font-semibold text-slate-900 dark:text-white sm:text-base">
                {resolvedTokenImage ? (
                  <img src={resolvedTokenImage} alt={displayTokenLabel} className="h-6 w-6 rounded-full ring-1 ring-slate-900/10 dark:ring-white/[0.1]" />
                ) : (
                  <div className="flex h-6 w-6 items-center justify-center rounded-full bg-slate-900/[0.04] ring-1 ring-slate-900/10 dark:bg-white/[0.06] dark:ring-white/[0.1]">
                    <Coins className="h-3 w-3 text-slate-500 dark:text-white/40" />
                  </div>
                )}
                <span className="truncate">{displayTokenLabel}</span>
                {post.chainType && (
                  <span className="rounded-md bg-slate-900/[0.04] px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-widest text-slate-500 dark:bg-white/[0.05] dark:text-white/35">
                    {post.chainType}
                  </span>
                )}
              </DialogTitle>
              <div className="flex items-center gap-2 shrink-0">
                <span className={cn("rounded-md px-2 py-0.5 text-[10px] font-medium tracking-wide", jupiterStatusTone)}>
                  {jupiterStatusLabel}
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={handleCloseBuyDialog}
                  className="h-7 w-7 rounded-lg bg-slate-900/[0.04] p-0 text-slate-500 hover:bg-slate-900/[0.08] hover:text-slate-700 dark:bg-white/[0.04] dark:text-white/40 dark:hover:bg-white/[0.08] dark:hover:text-white/60"
                >
                  <Plus className="h-3.5 w-3.5 rotate-45" />
                </Button>
              </div>
            </div>
            <DialogDescription className="sr-only">
              {isSolanaTradeSupported
                ? "Trade panel with live chart"
                : "Chart view - trading available for Solana posts only"}
            </DialogDescription>
          </DialogHeader>

          <div className={tradeDialogBodyClassName}>
            {/* Compact token stats bar */}
            <div className="flex items-center gap-2 flex-wrap px-1">
              {post.contractAddress && (
                <span className="max-w-[200px] truncate rounded-md bg-slate-900/[0.04] px-2 py-1 font-mono text-[10px] text-slate-500 dark:bg-white/[0.04] dark:text-white/30">
                  {post.contractAddress}
                </span>
              )}
              {isBuyDialogOpen && dexTokenDataQuery.isFetching && (
                <span className="animate-pulse text-[10px] text-slate-400 dark:text-white/25">Refreshing...</span>
              )}
            </div>

            {!isSolanaTradeSupported ? (
              <div className="rounded-xl border border-slate-900/[0.08] bg-white/65 p-3 text-xs text-slate-500 shadow-[inset_0_1px_0_rgba(255,255,255,0.7)] dark:border-white/[0.06] dark:bg-white/[0.02] dark:text-white/40 dark:shadow-none">
                Trading is available for Solana posts only. Chart navigation remains available.
              </div>
            ) : null}
            <div className="grid gap-3 lg:min-h-0 lg:grid-cols-[minmax(0,1.25fr)_minmax(300px,0.75fr)] lg:items-start">
                  <div className="space-y-3 lg:min-h-0 lg:max-h-[min(74vh,58rem)] lg:overflow-y-auto lg:pr-1">
                    <div className={chartPanelClassName}>
                      {/* Chart Toolbar */}
                      <div className={cn("flex items-center justify-between gap-2 border-b px-4 py-2.5", chartDividerClassName)}>
                        <div className="flex items-center gap-1.5">
                          {DEX_CHART_INTERVAL_OPTIONS.map((preset) => (
                            <button
                              key={preset.value}
                              type="button"
                              onClick={() => setChartInterval(preset.value)}
                              className={cn(
                                "rounded-md px-2 py-1 text-[11px] font-medium transition-all duration-150",
                                chartInterval === preset.value
                                  ? "bg-slate-900/[0.06] text-slate-900 shadow-[inset_0_1px_0_rgba(255,255,255,0.8)] dark:bg-white/[0.1] dark:text-white"
                                  : chartInactiveButtonClassName
                              )}
                            >
                              {preset.label}
                            </button>
                          ))}
                        </div>
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => setIsChartInfoVisible((prev) => !prev)}
                            className={cn(
                              "rounded-md px-2 py-1 text-[10px] font-medium transition-all duration-150",
                              isChartInfoVisible
                                ? "bg-blue-500/10 text-blue-400"
                                : chartInactiveToggleButtonClassName
                            )}
                          >
                            Vol
                          </button>
                          <button
                            type="button"
                            onClick={() => setIsChartTradesVisible((prev) => !prev)}
                            className={cn(
                              "rounded-md px-2 py-1 text-[10px] font-medium transition-all duration-150",
                              isChartTradesVisible
                                ? "bg-emerald-500/10 text-emerald-400"
                                : chartInactiveToggleButtonClassName
                            )}
                          >
                            OHLC
                          </button>
                        </div>
                      </div>
                      {/* Compact market stats */}
                      <div className={cn("flex items-center gap-3 overflow-x-auto border-b px-4 py-2 text-[11px]", chartDividerClassName)}>
                        <div className="flex items-center gap-1.5 shrink-0">
                          <span className={chartMutedTextClassName}>MCap</span>
                          <span className={cn("font-medium", chartStrongTextClassName)}>{formatMarketCap(post.entryMcap)}</span>
                          {resolvedMarketCap != null && (
                            <>
                              <span className={chartMutedSubtleTextClassName}>&rarr;</span>
                              <span className={cn("font-medium", chartStrongTextClassName)}>{formatMarketCap(resolvedMarketCap)}</span>
                            </>
                          )}
                        </div>
                        <div className={cn("h-3 w-px shrink-0", chartDividerFillClassName)} />
                        <div className="flex items-center gap-1.5 shrink-0">
                          <span className={chartMutedTextClassName}>Price</span>
                          <span className={cn("font-medium", chartStrongTextClassName)}>
                            {resolvedPriceUsd != null ? `$${resolvedPriceUsd.toLocaleString(undefined, { maximumFractionDigits: 8 })}` : "--"}
                          </span>
                        </div>
                        <div className={cn("h-3 w-px shrink-0", chartDividerFillClassName)} />
                        <span className={cn(
                          "font-semibold shrink-0",
                          currentTradeDeltaPct == null ? "text-slate-400 dark:text-white/40" : currentTradeDeltaPct >= 0 ? "text-emerald-400" : "text-rose-400"
                        )}>
                          {currentTradeDeltaPct == null ? "--" : `${currentTradeDeltaPct >= 0 ? "+" : ""}${currentTradeDeltaPct.toFixed(1)}%`}
                        </span>
                        <div className={cn("h-3 w-px shrink-0", chartDividerFillClassName)} />
                        <span className={cn(
                          "rounded-md px-1.5 py-0.5 text-[10px] font-medium shrink-0",
                          !localSettled ? "bg-blue-500/10 text-blue-400" : localIsWin ? "bg-emerald-500/10 text-emerald-400" : "bg-rose-500/10 text-rose-400"
                        )}>
                          {!localSettled ? "LIVE" : localIsWin ? "WON" : "LOST"}
                        </span>
                      </div>

                      {/* Chart controls */}
                      <div className={cn("flex items-center justify-between gap-2 border-b px-4 py-2", chartDividerClassName)}>
                        <div className={cn("min-w-0 truncate text-[10px]", chartMutedTextClassName)}>
                          {chartVisibleRangeLabel}
                          {chartRangeDetailLabel ? <span className={cn("ml-1.5", chartMutedSubtleTextClassName)}>{chartRangeDetailLabel}</span> : null}
                        </div>
                            <div className="flex items-center gap-0.5">
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                onClick={() => panChartWindowBy(-CHART_PAN_STEP_POINTS * 2)}
                                disabled={!hasProfessionalChartData || !canPanChartLeft}
                                className={cn("h-7 w-7 sm:h-6 sm:w-6", chartControlButtonClassName)}
                              >
                                <ChevronLeft className="h-3.5 w-3.5 sm:h-3 sm:w-3" />
                              </Button>
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                onClick={() => panChartWindowBy(CHART_PAN_STEP_POINTS * 2)}
                                disabled={!hasProfessionalChartData || !canPanChartRight}
                                className={cn("h-7 w-7 sm:h-6 sm:w-6", chartControlButtonClassName)}
                              >
                                <ChevronRight className="h-3.5 w-3.5 sm:h-3 sm:w-3" />
                              </Button>
                              <div className={cn("mx-0.5 h-3 w-px", chartDividerFillClassName)} />
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                onClick={() => zoomChartWindow("in")}
                                disabled={!hasProfessionalChartData || !canZoomInChart}
                                className={cn("h-7 w-7 sm:h-6 sm:w-6", chartControlButtonClassName)}
                              >
                                <Plus className="h-3.5 w-3.5 sm:h-3 sm:w-3" />
                              </Button>
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                onClick={() => zoomChartWindow("out")}
                                disabled={!hasProfessionalChartData || !canZoomOutChart}
                                className={cn("h-7 w-7 sm:h-6 sm:w-6", chartControlButtonClassName)}
                              >
                                <Minus className="h-3.5 w-3.5 sm:h-3 sm:w-3" />
                              </Button>
                              <div className={cn("mx-0.5 h-3 w-px", chartDividerFillClassName)} />
                              <Button
                                type="button"
                                variant="ghost"
                                onClick={resetChartWindow}
                                disabled={!hasProfessionalChartData}
                                className={cn("h-7 px-2 text-[10px] sm:h-6 sm:px-1.5", chartControlButtonClassName)}
                              >
                                Reset
                              </Button>
                              <Button
                                type="button"
                                variant="ghost"
                                onClick={centerChartOnEntry}
                                disabled={!hasProfessionalChartData || chartEntryIndex < 0}
                                className={cn(
                                  "h-7 px-2 text-[10px] sm:h-6 sm:px-1.5 hover:bg-slate-900/[0.05] dark:hover:bg-white/[0.06] disabled:opacity-30",
                                  isEntryInCurrentView ? "text-blue-400" : "text-slate-500 hover:text-slate-800 dark:text-white/30 dark:hover:text-white/60"
                                )}
                              >
                                Entry
                              </Button>
                            </div>
                          </div>
                          {isLikelyMobileDevice ? (
                            <div className="mt-1 text-[10px] text-slate-400 dark:text-white/28">
                              Pinch to zoom. Drag sideways to pan.
                            </div>
                          ) : null}

                      <div
                        ref={chartInteractionRef}
                        className={cn(
                          chartCanvasClassName,
                          hasProfessionalChartData
                            ? isChartMousePanning
                              ? "cursor-grabbing"
                              : "cursor-grab"
                            : "cursor-default"
                        )}
                        onWheel={handleChartWheel}
                        onTouchStart={handleChartTouchStart}
                        onTouchMove={handleChartTouchMove}
                        onTouchEnd={handleChartTouchEnd}
                        onTouchCancel={handleChartTouchEnd}
                        onMouseDown={handleChartMouseDown}
                        onMouseMove={handleChartMouseMove}
                        onMouseUp={handleChartMouseUp}
                        onMouseLeave={handleChartMouseUp}
                        style={{
                          touchAction: hasProfessionalChartData ? "pan-y" : "auto",
                          userSelect: isChartMousePanning ? "none" : "auto",
                        }}
                      >
                        {hasProfessionalChartData ? (
                          <CandlestickChart
                            data={professionalChartData}
                            visibleStartIndex={chartWindowBounds.startIndex}
                            visibleEndIndex={chartWindowBounds.endIndex}
                            futureSlotCount={CHART_FUTURE_PADDING_SLOTS}
                            showVolume={isChartInfoVisible}
                            showCandles={isChartTradesVisible}
                            stroke={professionalChartStroke}
                            fill={professionalChartFill}
                            entryPrice={chartEntryPrice}
                            entryPoint={
                              chartEntryCandle
                                ? { ts: chartEntryCandle.ts, close: chartEntryCandle.close }
                                : null
                            }
                            onHoverIndexChange={setChartActiveIndex}
                            onOverviewSelect={(index) => {
                              const width = chartWindowBounds.visibleCount;
                              let startIndex = index - Math.floor(width / 2);
                              startIndex = Math.max(0, Math.min(startIndex, Math.max(0, chartTotalPoints - width)));
                              setChartWindow({
                                startIndex,
                                endIndex: startIndex + width - 1,
                              });
                              setChartActiveIndex(index);
                            }}
                            formatPrice={formatUsdCompact}
                            formatTick={formatChartXAxisTick}
                            resetHoverKey={isBuyDialogOpen ? `${post.id}:${chartInterval}` : null}
                          />
                        ) : chartCandlesQuery.isLoading || chartCandlesQuery.isFetching ? (
                          <div className="flex h-full items-center justify-center">
                            <div className="flex flex-col items-center gap-2">
                              <Loader2 className="h-5 w-5 animate-spin text-slate-400 dark:text-white/20" />
                              <span className="text-[11px] text-slate-500 dark:text-white/25">Loading chart data...</span>
                            </div>
                          </div>
                        ) : chartCandlesQuery.error ? (
                          <div className="flex h-full items-center justify-center p-6 text-center">
                            <div className="space-y-2">
                              <PhewChartIcon className="mx-auto h-6 w-6 text-slate-400 dark:text-white/15" />
                              <p className="text-[11px] text-slate-500 dark:text-white/25">
                                Chart feed unavailable. Try a different interval.
                              </p>
                              <Button
                                type="button"
                                variant="outline"
                                onClick={() => {
                                  void chartCandlesQuery.refetch();
                                }}
                                className="h-7 border-slate-900/10 bg-white/70 px-3 text-[10px] text-slate-700 hover:bg-white dark:border-white/10 dark:bg-white/[0.03] dark:text-white/70 dark:hover:bg-white/[0.06]"
                              >
                                Retry
                              </Button>
                            </div>
                          </div>
                        ) : (
                          <div className="flex h-full items-center justify-center p-6 text-center">
                            <div className="space-y-2">
                              <PhewChartIcon className="mx-auto h-6 w-6 text-slate-400 dark:text-white/15" />
                              <p className="text-[11px] text-slate-500 dark:text-white/25">
                                Candle data not yet available for this token.
                              </p>
                            </div>
                          </div>
                        )}
                      </div>

                      {/* Chart footer */}
                      <div className={cn("flex items-center justify-between border-t px-4 py-2 text-[10px] text-slate-500 dark:text-white/25", chartDividerClassName)}>
                        <div className="flex items-center gap-3">
                          {hasProfessionalChartData && (
                            <span>{chartFeedLabel} {chartRequestConfig.timeframe}/{chartRequestConfig.aggregate}</span>
                          )}
                          {resolvedLiquidityUsd != null && (
                            <span>Liq ${resolvedLiquidityUsd.toLocaleString()}</span>
                          )}
                          {resolvedVolume24hUsd != null && (
                            <span>24h Vol ${resolvedVolume24hUsd.toLocaleString()}</span>
                          )}
                          {resolvedDexId && <span>{resolvedDexId}</span>}
                        </div>
                        {hasProfessionalChartData && professionalChartLast && (
                          <span>
                            {new Date(professionalChartLast.ts).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}
                          </span>
                        )}
                      </div>
                    </div>

                  </div>

                  <div className="relative z-10 flex min-h-0 flex-col gap-3 self-start lg:max-h-[min(74vh,58rem)] lg:overflow-y-auto lg:pr-1">
                    {/* New Trading Panel */}
                    <TradingPanel
                      tradeSide={tradeSide}
                      onTradeSideChange={setTradeSide}
                      buyAmountSol={buyAmountSol}
                      onBuyAmountChange={setBuyAmountSol}
                      sellAmountToken={sellAmountToken}
                      onSellAmountChange={setSellAmountToken}
                      tokenSymbol={displayTokenSymbol}
                      tokenName={displayTokenLabel}
                      tokenImage={resolvedTokenImage}
                      slippageBps={slippageBps}
                      onSlippageChange={setSlippageBps}
                      jupiterOutputFormatted={jupiterOutputAmountFormatted}
                      jupiterMinReceiveFormatted={jupiterMinReceiveFormatted}
                      jupiterPriceImpactDisplay={jupiterPriceImpactDisplay}
                      routeFeeDisplay={jupiterRouteFeeDisplay}
                      creatorFeeDisplay={creatorFeeDisplay}
                      platformFeeDisplay={retainedPlatformFeeDisplay}
                      jupiterStatusLabel={jupiterStatusLabel}
                      isQuoteLoading={showQuoteLoading}
                      isExecuting={isExecutingBuy}
                      canExecute={canExecuteJupiterBuy}
                      walletConnected={isWalletConnectedForTrade}
                      walletBalance={walletNativeBalance}
                      walletBalanceLoading={walletNativeBalanceLoading}
                      walletBalanceUsd={walletNativeBalanceUsd}
                      walletTokenBalance={walletTokenBalance}
                      walletTokenBalanceFormatted={walletTokenBalanceFormatted}
                      walletTokenBalanceLoading={walletTokenBalanceLoading}
                      payAmountUsd={tradePayUsdEstimate}
                      receiveAmountUsd={tradeReceiveUsdEstimate}
                      slippageInputPercent={slippageInputPercent}
                      onSlippageInputChange={setSlippageInputPercent}
                      onSlippageInputCommit={applySlippagePercentInput}
                      onExecute={handleExecuteJupiterBuy}
                      onConnectWallet={handleOpenTradeWalletConnectDialog}
                      txSignature={buyTxSignature}
                      quickBuyPresets={buyQuickAmounts}
                      sellQuickPercents={sellQuickPercents}
                      onQuickBuyPresetClick={(amount) => setBuyAmountSol(amount)}
                      onSellPercentClick={(percent) => setSellAmountFromPercent(percent)}
                      autoConfirmEnabled={autoConfirmEnabled}
                      onAutoConfirmChange={handleAutoConfirmChange}
                    />

                    {/* Portfolio Panel */}
                    <PortfolioPanel
                      positions={portfolioPositions}
                      isLoading={isPortfolioLoading}
                      totalUnrealizedPnl={portfolioTotalPnl}
                      onQuickSell={handlePortfolioQuickSell}
                      walletConnected={isWalletConnectedForTrade}
                    />
                  </div>
                </div>
          </div>

          <DialogFooter className={tradeDialogFooterClassName}>
            <div className="flex items-center gap-2">
              {resolvedDexscreenerUrl && (
                <a
                  href={resolvedDexscreenerUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 text-[10px] text-slate-500 transition-colors hover:text-slate-700 dark:text-white/25 dark:hover:text-white/50"
                >
                  DexScreener
                  <ExternalLink className="w-2.5 h-2.5" />
                </a>
              )}
            </div>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="ghost"
                onClick={handleCloseBuyDialog}
                className="h-8 px-3 text-[11px] text-slate-500 hover:bg-slate-900/[0.04] hover:text-slate-700 dark:text-white/40 dark:hover:bg-white/[0.04] dark:hover:text-white/60"
              >
                Close
              </Button>
              <Button
                type="button"
                onClick={handleBuyFooterAction}
                disabled={isBuyFooterDisabled}
                className={cn(
                  "h-8 px-4 text-[11px] font-semibold rounded-lg transition-all duration-200",
                  hasWalletSignerForTrade
                    ? tradeSide === "buy"
                      ? "bg-emerald-600 hover:bg-emerald-500 text-white"
                      : "bg-rose-600 hover:bg-rose-500 text-white"
                    : "bg-white/[0.08] hover:bg-white/[0.12] text-white"
                )}
              >
                {isExecutingBuy ? (
                  <Loader2 className="h-3 w-3 animate-spin mr-1.5" />
                ) : hasWalletSignerForTrade ? (
                  <PhewTradeIcon className="mr-1.5 h-3 w-3" />
                ) : (
                  <PhewFollowIcon className="mr-1.5 h-3 w-3" />
                )}
                {hasWalletSignerForTrade ? (tradeSide === "buy" ? "Buy" : "Sell") : connectWalletCtaLabel}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isWinCardPreviewOpen} onOpenChange={setIsWinCardPreviewOpen}>
        <DialogContent className="w-[calc(100vw-0.75rem)] max-w-5xl max-h-[92vh] p-0 overflow-y-auto border-border/60 bg-background/95">
            <DialogHeader className="px-5 sm:px-6 pt-5 pb-3 border-b border-border/50">
              <DialogTitle className="flex items-center gap-2 text-base sm:text-lg">
                <Sparkles className="h-4 w-4 text-primary" />
                Wincard Preview
              </DialogTitle>
              <DialogDescription className="text-xs sm:text-sm">
                Review a share-ready card, then export a PNG built for fast attention.
              </DialogDescription>
            </DialogHeader>

          <div className="p-3 sm:p-5">
            <div className="mx-auto max-w-[980px]">
              {(
              <div className="relative overflow-hidden rounded-[26px] border border-white/10 bg-[#071019] shadow-[0_34px_120px_-52px_rgba(0,0,0,0.92)] ring-1 ring-white/5">
                <div className="absolute inset-0 bg-[linear-gradient(135deg,#071019_0%,#07111a_44%,#04080f_100%)]" />
                <div
                  className="absolute inset-0 opacity-[0.06]"
                  style={{
                    backgroundImage:
                      "linear-gradient(rgba(255,255,255,0.9) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.9) 1px, transparent 1px)",
                    backgroundSize: "38px 38px",
                  }}
                />
                <div className="absolute inset-0 bg-[radial-gradient(circle_at_16%_14%,rgba(163,230,53,0.16),transparent_34%),radial-gradient(circle_at_86%_16%,rgba(45,212,191,0.16),transparent_34%),radial-gradient(circle_at_50%_88%,rgba(148,163,184,0.1),transparent_38%)]" />
                <div className="absolute inset-0 opacity-[0.09] [background-image:linear-gradient(120deg,transparent_0%,rgba(255,255,255,0.6)_48%,transparent_52%)] [background-size:280px_100%]" />
                <div
                  className={cn(
                    "absolute -right-14 top-[-4rem] h-72 w-72 rounded-full blur-3xl",
                    winCardTrendTone === "gain"
                      ? "bg-gain/18"
                      : winCardTrendTone === "loss"
                        ? "bg-loss/18"
                        : "bg-slate-400/16"
                  )}
                />
                <div className="absolute -left-16 bottom-[-4rem] h-72 w-72 rounded-full bg-primary/12 blur-3xl" />
                <div className="absolute left-8 top-24 h-px w-[calc(100%-4rem)] bg-gradient-to-r from-transparent via-white/12 to-transparent" />

                <div className="relative p-4 sm:p-6 lg:p-7">
                  <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                    <div className="inline-flex rounded-[22px] border border-white/10 bg-white/[0.045] px-4 py-3 shadow-[0_18px_44px_-28px_rgba(0,0,0,0.95)] backdrop-blur-sm">
                      <BrandLogo size="sm" className="gap-3" />
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <div
                        className={cn(
                          "inline-flex items-center rounded-full border px-3.5 py-1.5 text-[11px] font-semibold tracking-[0.18em] shadow-[0_12px_28px_-22px_rgba(0,0,0,0.9)]",
                          winCardTrendTone === "gain"
                            ? "border-gain/35 bg-gain/10 text-gain"
                            : winCardTrendTone === "loss"
                              ? "border-loss/35 bg-loss/10 text-loss"
                              : "border-white/10 bg-white/5 text-slate-300"
                        )}
                      >
                        {winCardResultLabel}
                      </div>
                      <div className="inline-flex items-center rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-300/78">
                        Share-ready
                      </div>
                    </div>
                  </div>

                  <div className="mt-4 rounded-[22px] border border-white/10 bg-white/[0.045] px-4 py-3 text-sm text-slate-200/86 shadow-[0_18px_44px_-30px_rgba(0,0,0,0.95)] sm:text-[15px]">
                    {winCardShareIntro}
                  </div>

                  <div className="mt-4 grid gap-4 xl:grid-cols-[1.14fr_0.86fr]">
                    <div className="rounded-[24px] border border-white/10 bg-white/[0.045] p-4 shadow-[0_26px_70px_-40px_rgba(0,0,0,0.95)] sm:p-5">
                      <div className="flex items-center gap-3">
                        <Avatar className="h-14 w-14 border border-white/10 shadow-[0_12px_30px_-18px_rgba(0,0,0,0.85)]">
                          <AvatarImage src={getAvatarUrl(post.author.id, post.author.image)} />
                          <AvatarFallback className="bg-white/5 text-base font-bold text-white">
                            {(post.author.username || post.author.name || "?").charAt(0).toUpperCase()}
                          </AvatarFallback>
                        </Avatar>
                        <div className="min-w-0">
                          <div className="truncate text-xl font-semibold tracking-tight text-white sm:text-2xl">
                            {winCardAuthorName}
                          </div>
                          <div className="truncate text-[11px] uppercase tracking-[0.14em] text-slate-300/68 sm:text-xs">
                            {winCardAuthorMeta}
                          </div>
                        </div>
                      </div>
                      <div className="mt-5 rounded-[22px] border border-white/10 bg-gradient-to-r from-lime-300/8 via-white/[0.04] to-cyan-300/8 p-4 shadow-inner shadow-black/30">
                        <div className="inline-flex items-center rounded-full border border-white/10 bg-black/20 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-300/72">
                          Token call
                        </div>
                        <div className="mt-3 truncate text-2xl font-semibold tracking-tight text-white sm:text-[2rem]">{winCardTokenPrimary}</div>
                        <div className="mt-1 truncate text-sm text-slate-300/78 sm:text-[15px]">{winCardTokenSecondary}</div>
                      </div>
                      <div className="mt-3 rounded-[22px] border border-white/10 bg-black/20 p-4 shadow-inner shadow-black/30">
                        <div className="mb-2 flex items-center justify-between gap-3">
                          <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-300/60">
                            Reputation
                          </div>
                          <div className={cn("text-[11px] font-semibold uppercase tracking-[0.14em]", winCardLevelToneClass)}>
                            {winCardLevelLabel} / LVL {post.author.level > 0 ? `+${post.author.level}` : post.author.level}
                          </div>
                        </div>
                        <LevelBar
                          level={post.author.level}
                          size="sm"
                          showLabel={false}
                          className="space-y-0"
                        />
                      </div>
                    </div>

                    <div className="relative overflow-hidden rounded-[24px] border border-white/10 bg-white/[0.045] p-4 shadow-[0_26px_70px_-40px_rgba(0,0,0,0.95)] sm:p-5">
                      <div className={cn(
                        "absolute inset-x-0 top-0 h-1.5",
                        winCardTrendTone === "gain"
                          ? "bg-gradient-to-r from-lime-300/70 via-white/30 to-cyan-300/70"
                          : winCardTrendTone === "loss"
                            ? "bg-gradient-to-r from-rose-400/75 via-white/20 to-red-500/70"
                            : "bg-gradient-to-r from-slate-300/50 via-white/25 to-slate-400/50"
                      )} />
                      <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-300/68">{winCardPerformanceEyebrow}</div>
                      <div className={cn("mt-3 text-[2.8rem] font-black tracking-tight sm:text-[4.6rem]", winCardAccentClass)}>
                        {winCardResultText}
                      </div>
                      <div className="text-sm text-slate-300/78 sm:text-base">{winCardPerformanceSupport}</div>
                      {winCardVerifiedPnlLabel && winCardVerifiedPnlText ? (
                        <>
                          <div className="mt-4 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-300/58">{winCardVerifiedPnlLabel}</div>
                          <div
                            className={cn(
                              "mt-1 text-lg font-semibold tracking-tight",
                              verifiedTotalPnlUsd !== null && verifiedTotalPnlUsd >= 0 ? "text-gain" : "text-loss"
                            )}
                          >
                            {winCardVerifiedPnlText}
                          </div>
                        </>
                      ) : null}
                      <div className="mt-4 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-300/58">
                        {winCardMarketMoveLabel}
                      </div>
                      <div className={cn("mt-1 text-lg font-semibold tracking-tight", winCardAccentClass)}>
                        {winCardMarketMoveText}
                      </div>
                      <div className="mt-5 flex items-center gap-2 text-[11px] text-slate-300/70">
                        <Sparkles className="h-3.5 w-3.5" />
                        {winCardFooterRightLabel}
                      </div>
                    </div>
                  </div>

                  <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                    <div className="rounded-[20px] border border-white/10 bg-white/[0.045] p-3.5 shadow-[0_18px_50px_-34px_rgba(0,0,0,0.9)]">
                      <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-300/60">Entry MCAP</div>
                      <div className="mt-2 text-xl font-bold tracking-tight text-white">{formatMarketCap(post.entryMcap)}</div>
                    </div>
                    <div className="rounded-[20px] border border-white/10 bg-white/[0.045] p-3.5 shadow-[0_18px_50px_-34px_rgba(0,0,0,0.9)]">
                      <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-300/60">
                        {winCardSettledMcapLabel}
                      </div>
                      <div className="mt-2 text-xl font-bold tracking-tight text-white">{formatMarketCap(officialMcap)}</div>
                    </div>
                    <div className="rounded-[20px] border border-lime-300/25 bg-gradient-to-br from-lime-300/12 via-white/[0.04] to-cyan-300/12 p-3.5 shadow-[0_18px_50px_-30px_rgba(163,230,53,0.82)]">
                      <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-lime-100/85">
                        {winCardCurrentMcapLabel}
                      </div>
                      <div className="mt-2 text-xl font-bold tracking-tight text-white">
                        {formatMarketCap(winCardCurrentMcap)}
                      </div>
                    </div>
                    <div className="rounded-[20px] border border-white/10 bg-white/[0.045] p-3.5 shadow-[0_18px_50px_-34px_rgba(0,0,0,0.9)] sm:col-span-2 xl:col-span-1">
                      <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-300/60">Engagement</div>
                      <div className="mt-2 text-sm font-semibold tracking-tight text-white">
                        {likeCount} likes | {commentCount} comments | {repostCount} reposts
                      </div>
                    </div>
                  </div>

                  <div className="mt-4 rounded-[22px] border border-white/10 bg-white/[0.045] p-4 shadow-[0_22px_60px_-38px_rgba(0,0,0,0.9)]">
                    <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-300/60">
                      Snapshot Ladder
                    </div>
                    <div className="mt-3 grid gap-2.5 sm:grid-cols-3">
                      {winCardSnapshotMetrics.map((metric) => (
                        <div
                          key={metric.label}
                          className="rounded-[18px] border border-white/10 bg-black/20 p-3.5 shadow-inner shadow-black/30"
                        >
                          <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-300/60">
                            {metric.label}
                          </div>
                          <div className="mt-2 h-1.5 rounded-full bg-white/10 overflow-hidden">
                            <div
                              className={cn(
                                "h-full rounded-full",
                                metric.positive === null
                                  ? "bg-white/20"
                                  : metric.positive
                                    ? "bg-gradient-to-r from-lime-300/80 to-green-400/80"
                                    : "bg-gradient-to-r from-rose-400/80 to-red-500/80"
                              )}
                              style={{ width: `${Math.round(metric.magnitudeRatio * 100)}%` }}
                            />
                          </div>
                          <div className={cn("mt-2 text-base font-semibold tracking-tight", metric.toneClass)}>
                            {metric.percentText}
                          </div>
                          <div
                            className={cn(
                              "mt-1 text-sm",
                              metric.positive === null ? "text-slate-300/75" : metric.toneClass
                            )}
                          >
                            {metric.profitText}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {hasWalletTradeInfo ? (
                    <div className="mt-4 rounded-[22px] border border-white/10 bg-white/[0.045] p-4 shadow-[0_22px_60px_-38px_rgba(0,0,0,0.9)]">
                      <div className="flex items-center justify-between gap-2">
                        <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-300/60">
                          Wallet Trade Summary
                        </div>
                      </div>
                      <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                        {verifiedTotalPnlUsd !== null ? (
                          <div className="rounded-[18px] border border-white/10 bg-black/20 p-3.5">
                            <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-300/60">Wallet P/L</div>
                            <div className={cn("mt-2 text-base font-semibold tracking-tight", verifiedTotalPnlUsd >= 0 ? "text-gain" : "text-loss")}>
                              {winCardVerifiedPnlText}
                            </div>
                          </div>
                        ) : null}
                        {boughtUsd !== null || boughtAmount !== null ? (
                          <div className="rounded-[18px] border border-white/10 bg-black/20 p-3.5">
                            <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-300/60">Bought</div>
                            <div className="mt-2 text-base font-semibold tracking-tight text-white">
                              {boughtUsd !== null ? formatUsdStat(boughtUsd) : "N/A"}
                            </div>
                            {boughtAmount !== null ? (
                              <div className="mt-0.5 text-[11px] text-slate-300/75">
                                Qty {boughtAmount.toLocaleString(undefined, { maximumFractionDigits: 6 })}
                              </div>
                            ) : null}
                          </div>
                        ) : null}
                        {soldUsd !== null || soldAmount !== null ? (
                          <div className="rounded-[18px] border border-white/10 bg-black/20 p-3.5">
                            <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-300/60">Sold</div>
                            <div className="mt-2 text-base font-semibold tracking-tight text-white">
                              {soldUsd !== null ? formatUsdStat(soldUsd) : "N/A"}
                            </div>
                            {soldAmount !== null ? (
                              <div className="mt-0.5 text-[11px] text-slate-300/75">
                                Qty {soldAmount.toLocaleString(undefined, { maximumFractionDigits: 6 })}
                              </div>
                            ) : null}
                          </div>
                        ) : null}
                        {holdingUsd !== null || holdingAmount !== null ? (
                          <div className="rounded-[18px] border border-white/10 bg-black/20 p-3.5">
                            <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-300/60">Holding</div>
                            <div className="mt-2 text-base font-semibold tracking-tight text-white">
                              {holdingUsd !== null ? formatUsdStat(holdingUsd) : "N/A"}
                            </div>
                            {holdingAmount !== null ? (
                              <div className="mt-0.5 text-[11px] text-slate-300/75">
                                Qty {holdingAmount.toLocaleString(undefined, { maximumFractionDigits: 6 })}
                              </div>
                            ) : null}
                          </div>
                        ) : null}
                      </div>
                    </div>
                  ) : null}

                  <div className="mt-4 rounded-[22px] border border-white/10 bg-white/[0.045] p-4 shadow-[0_22px_60px_-38px_rgba(0,0,0,0.9)]">
                    <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-300/60">Alpha Notes</div>
                    <p className="mt-4 text-sm leading-7 text-slate-100/92 whitespace-pre-wrap break-words sm:text-[15px]">
                      {winCardPostPreview}
                    </p>
                    <div className="mt-4 inline-flex rounded-full border border-white/10 bg-black/20 px-3 py-1.5 text-[11px] text-slate-300/74">
                      Post ID: {post.id.slice(0, 10)}...
                    </div>
                  </div>

                  <div className="mt-5 flex flex-col items-start gap-2 text-[11px] text-slate-300/72 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-3 py-1.5">
                      <Sparkles className="h-3.5 w-3.5 text-slate-300/80" />
                      Generated on PHEW.RUN
                    </span>
                    <span className="rounded-full border border-white/10 bg-black/20 px-3 py-1.5">
                      {winCardFooterRightLabel}
                    </span>
                  </div>
                </div>
              </div>
              )}
            </div>
          </div>

          <DialogFooter className="px-5 sm:px-6 py-4 border-t border-border/50 bg-background/80">
            <Button
              type="button"
              variant="outline"
              onClick={() => setIsWinCardPreviewOpen(false)}
              className="w-full sm:w-auto"
            >
              Close
            </Button>
            <Button
              type="button"
              onClick={handleDownloadWinCard}
              disabled={isWinCardDownloading}
              className="w-full sm:w-auto gap-2"
            >
              {isWinCardDownloading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Download className="h-4 w-4" />
              )}
              Download PNG
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reposters Dialog */}
      <RepostersDialog
        postId={post.id}
        open={isRepostersOpen}
        onOpenChange={setIsRepostersOpen}
        initialCount={sharedByCount}
      />

      {/* Shared Alpha Dialog */}
      <SharedAlphaDialog
        postId={post.id}
        contractAddress={post.contractAddress}
        open={isSharedAlphaOpen}
        onOpenChange={setIsSharedAlphaOpen}
        initialCount={sharedAlphaTotalCount}
      />
    </div>
  );
}

