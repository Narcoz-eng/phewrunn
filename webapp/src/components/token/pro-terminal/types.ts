import type { Post } from "@/types";
import type { TradePanelRecentTrade } from "@/lib/trade-panel-live";

export type TerminalCoverageState = "live" | "partial" | "unavailable";

export type TerminalCoverage = {
  state: TerminalCoverageState;
  source: string;
  unavailableReason: string | null;
};

export type TerminalCandle = {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

export type TerminalDepthLevel = {
  price: number;
  amount: number;
  totalUsd: number;
  side: "bid" | "ask";
};

export type TerminalDepthPoint = {
  price: number;
  bidDepthUsd: number;
  askDepthUsd: number;
};

export type TerminalAggregateResponse = {
  generatedAt: string;
  timeframe: TerminalTimeframe;
  token: {
    id: string;
    address: string;
    chainType: string;
    symbol: string | null;
    name: string | null;
    imageUrl: string | null;
    fallbackImageUrl: string;
    dexscreenerUrl: string | null;
    pairAddress: string | null;
    dexId: string | null;
    priceUsd: number | null;
    priceChange24hPct: number | null;
    marketCap: number | null;
    liquidity: number | null;
    volume24h: number | null;
    holderCount: number | null;
    isTradable: boolean;
    isFollowing: boolean;
    communityExists: boolean;
  };
  coverage: Record<string, TerminalCoverage>;
  marketStrip: TerminalMarketStripToken[];
  chart: {
    candles: TerminalCandle[];
    source: string;
    network: string | null;
    coverage: TerminalCoverage;
  };
  marketFlow: {
    mode: "orderbook" | "liquidity_depth_approximation" | "unavailable";
    bids: TerminalDepthLevel[];
    asks: TerminalDepthLevel[];
    spread: number | null;
    depthSeries: TerminalDepthPoint[];
    recentTrades: TradePanelRecentTrade[];
    coverage: {
      depth: TerminalCoverage;
      trades: TerminalCoverage;
    };
  };
  execution: {
    supported: boolean;
    provider: string | null;
    unavailableReason: string | null;
  };
  intelligence: {
    coverage: TerminalCoverage;
    conviction: number | null;
    confidence: number | null;
    momentum: number | null;
    smartMoney: number | null;
    riskScore: number | null;
    sentiment: {
      bullishPct: number;
      bearishPct: number;
      score: number;
      sourceCount: number;
    };
    labels: string[];
    explanation: string;
  };
  smartMoney: {
    coverage: TerminalCoverage;
    rows: Array<{
      id: string;
      wallet: string;
      label: string;
      action: string;
      valueUsd: number | null;
      supplyPct: number | null;
      confidence: number | null;
      explorerUrl: string | null;
    }>;
  };
  community: {
    id: string | null;
    exists: boolean;
    headline: string | null;
    cashtag: string | null;
    whyLine: string | null;
    mascotName: string | null;
    postsCount: number;
  };
  recentCalls: Post[];
  topCallers: Array<{
    id: string;
    name: string;
    username: string | null;
    image: string | null;
    level: number;
    xp: number;
    trustScore: number | null;
    reputationTier: string | null;
    callsCount: number;
    avgConfidenceScore: number;
    bestRoiPct: number;
  }>;
  activeRaids: Array<{
    id: string;
    status: string;
    objective: string;
    activeKey: string | null;
    participantCount: number;
    postedCount: number;
    progressPct: number;
    openedAt: string;
  }>;
  news: Array<{
    id: string;
    eventType: string;
    timestamp: string;
    headline: string;
    marketCap: number | null;
    liquidity: number | null;
    volume: number | null;
  }>;
};

export type TerminalMarketStripToken = {
  address: string;
  chainType: string;
  symbol: string | null;
  name: string | null;
  imageUrl: string | null;
  priceUsd: number | null;
  priceChange24hPct: number | null;
  volume24h: number | null;
  liquidity: number | null;
  score: number | null;
  coverage: TerminalCoverage;
};

export type TerminalTimeframe = "1m" | "5m" | "15m" | "1h" | "4h" | "1D";

export const TERMINAL_TIMEFRAMES: TerminalTimeframe[] = ["1m", "5m", "15m", "1h", "4h", "1D"];
