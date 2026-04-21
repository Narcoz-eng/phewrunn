import { useEffect, useMemo, useState } from "react";
import {
  subscribeToTokenLiveStream,
  type TokenLiveStreamParams,
  type TokenLiveStreamSnapshot,
  type TradePanelLiveStatus,
  type TradePanelRecentTrade,
} from "@/lib/trading/live-token-stream";

function shortenTradeWalletAddress(address: string | null): string | null {
  if (!address) return null;
  if (address.length <= 10) return address;
  return `${address.slice(0, 4)}...${address.slice(-4)}`;
}

function createEmptySnapshot(): TokenLiveStreamSnapshot {
  return {
    status: {
      connected: false,
      mode: "fallback",
      reason: null,
      timestampMs: 0,
    },
    recentTrades: [],
    liveSamples: [],
    lastEventAtMs: 0,
    lastTradeEventAtMs: 0,
    usingFallbackPolling: false,
    hasConnectedStream: false,
  };
}

export type { TradePanelLiveStatus, TradePanelRecentTrade };

export function useTradePanelLiveFeed(params: TokenLiveStreamParams) {
  const [snapshot, setSnapshot] = useState<TokenLiveStreamSnapshot>(() => createEmptySnapshot());

  useEffect(() => subscribeToTokenLiveStream(params, setSnapshot), [
    params.chainType,
    params.enabled,
    params.pairAddress,
    params.tokenAddress,
  ]);

  const recentTradesWithDisplay = useMemo(
    () =>
      snapshot.recentTrades.map((trade) => ({
        ...trade,
        walletShort: shortenTradeWalletAddress(trade.walletAddress),
      })),
    [snapshot.recentTrades]
  );

  return {
    liveSamples: snapshot.liveSamples,
    recentTrades: recentTradesWithDisplay,
    liveStatus: snapshot.status,
    usingFallbackPolling: snapshot.usingFallbackPolling,
    hasConnectedStream: snapshot.hasConnectedStream,
    lastEventAtMs: snapshot.lastEventAtMs,
    lastTradeEventAtMs: snapshot.lastTradeEventAtMs,
  };
}
