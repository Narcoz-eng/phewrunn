import type { TradePanelLiveStatus, TradePanelRecentTrade } from "@/lib/trading/live-token-stream";

type TokenRealtimeParams = {
  tokenAddress: string;
  pairAddress: string | null;
  chainType: "solana" | "ethereum";
};

type TokenRealtimeSnapshotPayload = {
  trades?: TradePanelRecentTrade[];
  latestPrice?: TokenRealtimePricePayload | null;
  status?: TradePanelLiveStatus | null;
  lastTradeAtMs?: number;
  lastPriceAtMs?: number;
};

type TokenRealtimePricePayload = {
  timestampMs: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volumeUsd: number;
};

type TokenRealtimeHandlers = {
  onOpen?: () => void;
  onSnapshot?: (payload: TokenRealtimeSnapshotPayload) => void;
  onPrice?: (payload: TokenRealtimePricePayload) => void;
  onTrade?: (payload: TradePanelRecentTrade) => void;
  onStatus?: (payload: TradePanelLiveStatus) => void;
  onError?: (error: Error) => void;
};

type AppInvalidatePayload = {
  scopes?: string[];
  timestampMs?: number;
};

type AppRealtimeHandlers = {
  onInvalidate?: (payload: AppInvalidatePayload) => void;
  onError?: (error: Error) => void;
};

const realtimeDisabledError = new Error("Realtime socket disabled");

export function subscribeToAppRealtime(handlers: AppRealtimeHandlers): () => void {
  handlers.onError?.(realtimeDisabledError);
  return () => undefined;
}

export function subscribeToTokenRealtime(
  _params: TokenRealtimeParams,
  handlers: TokenRealtimeHandlers
): () => void {
  handlers.onError?.(realtimeDisabledError);
  return () => undefined;
}
