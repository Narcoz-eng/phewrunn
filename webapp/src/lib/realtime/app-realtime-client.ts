import { API_BASE_URL } from "@/lib/api";
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

type TokenSubscriptionState = {
  params: TokenRealtimeParams;
  handlers: Map<string, TokenRealtimeHandlers>;
};

type AppInvalidatePayload = {
  scopes?: string[];
  timestampMs?: number;
};

type AppRealtimeHandlers = {
  onInvalidate?: (payload: AppInvalidatePayload) => void;
  onError?: (error: Error) => void;
};

type RealtimeSocketState = {
  socket: WebSocket | null;
  reconnectTimer: ReturnType<typeof setTimeout> | null;
  reconnectAttempts: number;
  tokens: Map<string, TokenSubscriptionState>;
  appHandlers: Map<string, AppRealtimeHandlers>;
};

const realtimeSocketState: RealtimeSocketState = {
  socket: null,
  reconnectTimer: null,
  reconnectAttempts: 0,
  tokens: new Map(),
  appHandlers: new Map(),
};

function buildTokenChannelKey(params: TokenRealtimeParams): string {
  return [params.chainType, params.tokenAddress, params.pairAddress ?? ""].join(":").toLowerCase();
}

function buildRealtimeUrl(): string {
  const relativePath = "/api/realtime";
  if (typeof window === "undefined") {
    return relativePath;
  }

  try {
    const apiUrl = new URL(API_BASE_URL, window.location.origin);
    const isSameOrigin = apiUrl.origin === window.location.origin;
    const baseUrl = isSameOrigin ? new URL(window.location.origin) : apiUrl;
    baseUrl.protocol = baseUrl.protocol === "https:" ? "wss:" : "ws:";
    baseUrl.pathname = relativePath;
    baseUrl.search = "";
    baseUrl.hash = "";
    return baseUrl.toString();
  } catch {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    return `${protocol}//${window.location.host}${relativePath}`;
  }
}

function notifyTokenHandlers(channel: string, notifier: (handlers: TokenRealtimeHandlers) => void): void {
  const tokenState = realtimeSocketState.tokens.get(channel);
  if (!tokenState) {
    return;
  }
  for (const handlers of tokenState.handlers.values()) {
    notifier(handlers);
  }
}

function notifyAppHandlers(notifier: (handlers: AppRealtimeHandlers) => void): void {
  for (const handlers of realtimeSocketState.appHandlers.values()) {
    notifier(handlers);
  }
}

function sendSocketMessage(payload: unknown): void {
  const socket = realtimeSocketState.socket;
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    return;
  }
  socket.send(JSON.stringify(payload));
}

function sendSubscribeToken(params: TokenRealtimeParams): void {
  sendSocketMessage({
    type: "subscribe_token",
    payload: {
      tokenAddress: params.tokenAddress,
      pairAddress: params.pairAddress,
      chainType: params.chainType,
    },
  });
}

function sendUnsubscribeToken(params: TokenRealtimeParams): void {
  sendSocketMessage({
    type: "unsubscribe_token",
    payload: {
      tokenAddress: params.tokenAddress,
      pairAddress: params.pairAddress,
      chainType: params.chainType,
    },
  });
}

function scheduleRealtimeReconnect(): void {
  if (realtimeSocketState.reconnectTimer || realtimeSocketState.tokens.size === 0) {
    return;
  }

  const delayMs = Math.min(10_000, 500 * Math.pow(2, realtimeSocketState.reconnectAttempts));
  realtimeSocketState.reconnectTimer = window.setTimeout(() => {
    realtimeSocketState.reconnectTimer = null;
    ensureRealtimeSocket();
  }, delayMs);
}

function handleRealtimeMessage(rawMessage: MessageEvent<string>): void {
  try {
    const parsed = JSON.parse(rawMessage.data) as {
      type?: string;
      channel?: string;
      payload?: unknown;
    };
    const channel = typeof parsed.channel === "string" ? parsed.channel : null;
    if (!channel) {
      return;
    }

    if (parsed.type === "market.snapshot") {
      notifyTokenHandlers(channel, (handlers) => {
        handlers.onSnapshot?.((parsed.payload ?? null) as TokenRealtimeSnapshotPayload);
      });
      return;
    }
    if (parsed.type === "market.price") {
      notifyTokenHandlers(channel, (handlers) => {
        handlers.onPrice?.((parsed.payload ?? null) as TokenRealtimePricePayload);
      });
      return;
    }
    if (parsed.type === "market.trade") {
      notifyTokenHandlers(channel, (handlers) => {
        handlers.onTrade?.((parsed.payload ?? null) as TradePanelRecentTrade);
      });
      return;
    }
    if (parsed.type === "market.status") {
      notifyTokenHandlers(channel, (handlers) => {
        handlers.onStatus?.((parsed.payload ?? null) as TradePanelLiveStatus);
      });
      return;
    }
    if (parsed.type === "app.invalidate") {
      notifyAppHandlers((handlers) => {
        handlers.onInvalidate?.((parsed.payload ?? null) as AppInvalidatePayload);
      });
    }
  } catch {
    // Ignore malformed realtime payloads.
  }
}

function ensureRealtimeSocket(): void {
  if (typeof window === "undefined" || (realtimeSocketState.tokens.size === 0 && realtimeSocketState.appHandlers.size === 0)) {
    return;
  }

  const currentSocket = realtimeSocketState.socket;
  if (currentSocket && (currentSocket.readyState === WebSocket.OPEN || currentSocket.readyState === WebSocket.CONNECTING)) {
    return;
  }

  const socket = new WebSocket(buildRealtimeUrl());
  realtimeSocketState.socket = socket;

  socket.onopen = () => {
    realtimeSocketState.reconnectAttempts = 0;
    for (const [channel, tokenState] of realtimeSocketState.tokens) {
      sendSubscribeToken(tokenState.params);
      notifyTokenHandlers(channel, (handlers) => {
        handlers.onOpen?.();
      });
    }
  };

  socket.onmessage = handleRealtimeMessage;

  socket.onerror = () => {
    for (const [channel] of realtimeSocketState.tokens) {
      notifyTokenHandlers(channel, (handlers) => {
        handlers.onError?.(new Error("Realtime socket error"));
      });
    }
    notifyAppHandlers((handlers) => {
      handlers.onError?.(new Error("Realtime socket error"));
    });
  };

  socket.onclose = () => {
    realtimeSocketState.socket = null;
    realtimeSocketState.reconnectAttempts += 1;
    for (const [channel] of realtimeSocketState.tokens) {
      notifyTokenHandlers(channel, (handlers) => {
        handlers.onError?.(new Error("Realtime socket disconnected"));
      });
    }
    notifyAppHandlers((handlers) => {
      handlers.onError?.(new Error("Realtime socket disconnected"));
    });
    scheduleRealtimeReconnect();
  };
}

function maybeCloseRealtimeSocket(): void {
  if (realtimeSocketState.tokens.size > 0 || realtimeSocketState.appHandlers.size > 0) {
    return;
  }

  if (realtimeSocketState.reconnectTimer) {
    clearTimeout(realtimeSocketState.reconnectTimer);
    realtimeSocketState.reconnectTimer = null;
  }

  realtimeSocketState.socket?.close();
  realtimeSocketState.socket = null;
  realtimeSocketState.reconnectAttempts = 0;
}

export function subscribeToAppRealtime(handlers: AppRealtimeHandlers): () => void {
  const handlerId =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now()}:${Math.random().toString(36).slice(2)}`;

  realtimeSocketState.appHandlers.set(handlerId, handlers);
  ensureRealtimeSocket();

  return () => {
    realtimeSocketState.appHandlers.delete(handlerId);
    maybeCloseRealtimeSocket();
  };
}

export function subscribeToTokenRealtime(
  params: TokenRealtimeParams,
  handlers: TokenRealtimeHandlers
): () => void {
  const normalizedParams = {
    tokenAddress: params.tokenAddress.trim(),
    pairAddress: params.pairAddress?.trim() ?? null,
    chainType: params.chainType,
  } satisfies TokenRealtimeParams;
  const channel = buildTokenChannelKey(normalizedParams);
  const tokenState = realtimeSocketState.tokens.get(channel) ?? {
    params: normalizedParams,
    handlers: new Map<string, TokenRealtimeHandlers>(),
  };

  const handlerId =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now()}:${Math.random().toString(36).slice(2)}`;

  tokenState.handlers.set(handlerId, handlers);
  realtimeSocketState.tokens.set(channel, tokenState);
  ensureRealtimeSocket();

  if (realtimeSocketState.socket?.readyState === WebSocket.OPEN) {
    sendSubscribeToken(normalizedParams);
    handlers.onOpen?.();
  }

  return () => {
    const activeTokenState = realtimeSocketState.tokens.get(channel);
    if (!activeTokenState) {
      return;
    }

    activeTokenState.handlers.delete(handlerId);
    if (activeTokenState.handlers.size === 0) {
      realtimeSocketState.tokens.delete(channel);
      sendUnsubscribeToken(normalizedParams);
    }
    maybeCloseRealtimeSocket();
  };
}
