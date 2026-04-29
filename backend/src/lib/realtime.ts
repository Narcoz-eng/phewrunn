import type { Server, ServerWebSocket } from "bun";
import {
  startBirdeyeLiveFeed,
  type BirdeyeTradeFeedChain,
  type TradeFeedPriceUpdate,
  type TradeFeedSnapshot,
  type TradeFeedStatus,
  type TradeFeedTrade,
} from "../services/birdeye-trade-feed.js";

type RealtimeSubscribeTokenMessage = {
  type: "subscribe_token";
  payload: {
    tokenAddress: string;
    pairAddress?: string | null;
    chainType?: "solana" | "ethereum" | "evm";
  };
};

type RealtimeUnsubscribeTokenMessage = {
  type: "unsubscribe_token";
  payload: {
    tokenAddress: string;
    pairAddress?: string | null;
    chainType?: "solana" | "ethereum" | "evm";
  };
};

type RealtimeClientMessage = RealtimeSubscribeTokenMessage | RealtimeUnsubscribeTokenMessage;

type RealtimeSocketData = {
  socketId: string;
};

type RealtimeConnectionState = {
  socketId: string;
  socket: ServerWebSocket<RealtimeSocketData>;
  subscriptions: Map<string, () => void>;
};

type AppInvalidateScope =
  | "feed"
  | "leaderboard"
  | "profiles"
  | "profile-performance"
  | "user-posts"
  | "token-page";

type TokenSubscriptionPayload = {
  tokenAddress: string;
  pairAddress?: string | null;
  chainType?: "solana" | "ethereum" | "evm";
};

const realtimeConnections = new Map<string, RealtimeConnectionState>();

function normalizeRealtimeChainType(
  chainType: TokenSubscriptionPayload["chainType"]
): BirdeyeTradeFeedChain {
  return chainType === "ethereum" || chainType === "evm" ? "ethereum" : "solana";
}

function buildTokenChannelKey(payload: TokenSubscriptionPayload): string {
  return [
    normalizeRealtimeChainType(payload.chainType),
    payload.tokenAddress.trim().toLowerCase(),
    payload.pairAddress?.trim().toLowerCase() ?? "",
  ].join(":");
}

function serializeRealtimeMessage(message: unknown): string {
  return JSON.stringify(message);
}

function sendSocketMessage(socket: ServerWebSocket<RealtimeSocketData>, message: unknown): void {
  try {
    socket.send(serializeRealtimeMessage(message));
  } catch {
    // Ignore transient send failures; close handlers clean up subscriptions.
  }
}

function sendTokenSnapshot(
  socket: ServerWebSocket<RealtimeSocketData>,
  channel: string,
  snapshot: TradeFeedSnapshot
): void {
  sendSocketMessage(socket, {
    type: "market.snapshot",
    channel,
    payload: {
      trades: snapshot.recentTrades,
      latestPrice: snapshot.latestPrice,
      status: snapshot.status,
      lastTradeAtMs: snapshot.lastTradeAtMs,
      lastPriceAtMs: snapshot.lastPriceAtMs,
    },
  });
}

function sendTokenPrice(
  socket: ServerWebSocket<RealtimeSocketData>,
  channel: string,
  payload: TradeFeedPriceUpdate
): void {
  sendSocketMessage(socket, {
    type: "market.price",
    channel,
    payload,
  });
}

function sendTokenTrade(
  socket: ServerWebSocket<RealtimeSocketData>,
  channel: string,
  payload: TradeFeedTrade
): void {
  sendSocketMessage(socket, {
    type: "market.trade",
    channel,
    payload,
  });
}

function sendTokenStatus(
  socket: ServerWebSocket<RealtimeSocketData>,
  channel: string,
  payload: TradeFeedStatus
): void {
  sendSocketMessage(socket, {
    type: "market.status",
    channel,
    payload,
  });
}

function sendAppInvalidate(
  socket: ServerWebSocket<RealtimeSocketData>,
  scopes: AppInvalidateScope[]
): void {
  sendSocketMessage(socket, {
    type: "app.invalidate",
    payload: {
      scopes,
      timestampMs: Date.now(),
    },
  });
}

function unsubscribeConnectionChannel(connection: RealtimeConnectionState, channel: string): void {
  const closer = connection.subscriptions.get(channel);
  if (!closer) {
    return;
  }

  connection.subscriptions.delete(channel);
  closer();
}

function subscribeConnectionToToken(
  connection: RealtimeConnectionState,
  payload: TokenSubscriptionPayload
): void {
  const tokenAddress = payload.tokenAddress?.trim();
  if (!tokenAddress) {
    return;
  }

  const normalizedPayload: TokenSubscriptionPayload = {
    tokenAddress,
    pairAddress: payload.pairAddress?.trim() ?? null,
    chainType: normalizeRealtimeChainType(payload.chainType),
  };
  const channel = buildTokenChannelKey(normalizedPayload);
  if (connection.subscriptions.has(channel)) {
    return;
  }

  const liveFeed = startBirdeyeLiveFeed({
    chainType: normalizeRealtimeChainType(payload.chainType),
    tokenAddress,
    pairAddress: normalizedPayload.pairAddress,
    onSnapshot: (snapshot) => {
      sendTokenSnapshot(connection.socket, channel, snapshot);
    },
    onPrice: (update) => {
      sendTokenPrice(connection.socket, channel, update);
    },
    onTrade: (trade) => {
      sendTokenTrade(connection.socket, channel, trade);
    },
    onStatus: (status) => {
      sendTokenStatus(connection.socket, channel, status);
    },
    onError: (error) => {
      sendTokenStatus(connection.socket, channel, {
        connected: false,
        mode: "fallback",
        reason: error instanceof Error ? error.message : "Realtime feed error",
        timestampMs: Date.now(),
      });
    },
  });

  connection.subscriptions.set(channel, liveFeed.close);
  sendTokenSnapshot(connection.socket, channel, liveFeed.snapshot);
  sendTokenStatus(connection.socket, channel, liveFeed.snapshot.status);
}

function cleanupRealtimeConnection(socketId: string): void {
  const connection = realtimeConnections.get(socketId);
  if (!connection) {
    return;
  }

  for (const channel of [...connection.subscriptions.keys()]) {
    unsubscribeConnectionChannel(connection, channel);
  }
  realtimeConnections.delete(socketId);
}

function parseRealtimeClientMessage(rawMessage: string | Buffer): RealtimeClientMessage | null {
  try {
    const parsed = JSON.parse(typeof rawMessage === "string" ? rawMessage : rawMessage.toString("utf8")) as {
      type?: unknown;
      payload?: unknown;
    };
    if (!parsed || typeof parsed !== "object") {
      return null;
    }
    if (parsed.type !== "subscribe_token" && parsed.type !== "unsubscribe_token") {
      return null;
    }
    const payload =
      parsed.payload && typeof parsed.payload === "object" && !Array.isArray(parsed.payload)
        ? (parsed.payload as TokenSubscriptionPayload)
        : null;
    if (!payload?.tokenAddress || typeof payload.tokenAddress !== "string") {
      return null;
    }
    return {
      type: parsed.type,
      payload,
    };
  } catch {
    return null;
  }
}

export function handleRealtimeUpgrade(request: Request, server: Server<unknown> | undefined): Response | undefined {
  const url = new URL(request.url);
  if (url.pathname !== "/api/realtime") {
    return undefined;
  }

  void server;
  return new Response(
    JSON.stringify({
      error: {
        message: "Realtime socket is disabled for this deployment",
        code: "REALTIME_DISABLED",
      },
    }),
    {
      status: 410,
      headers: { "content-type": "application/json" },
    }
  );
}

export const realtimeWebSocketHandlers = {
  open(socket: ServerWebSocket<RealtimeSocketData>) {
    const socketId = socket.data.socketId;
    realtimeConnections.set(socketId, {
      socketId,
      socket,
      subscriptions: new Map(),
    });
    sendSocketMessage(socket, {
      type: "session.ready",
      payload: {
        socketId,
        timestampMs: Date.now(),
      },
    });
  },
  message(socket: ServerWebSocket<RealtimeSocketData>, rawMessage: string | Buffer) {
    const connection = realtimeConnections.get(socket.data.socketId);
    if (!connection) {
      return;
    }

    const message = parseRealtimeClientMessage(rawMessage);
    if (!message) {
      sendSocketMessage(socket, {
        type: "session.error",
        payload: {
          reason: "Invalid realtime message",
          timestampMs: Date.now(),
        },
      });
      return;
    }

    const channel = buildTokenChannelKey(message.payload);
    if (message.type === "unsubscribe_token") {
      unsubscribeConnectionChannel(connection, channel);
      return;
    }

    subscribeConnectionToToken(connection, message.payload);
  },
  close(socket: ServerWebSocket<RealtimeSocketData>) {
    cleanupRealtimeConnection(socket.data.socketId);
  },
  error(socket: ServerWebSocket<RealtimeSocketData>) {
    cleanupRealtimeConnection(socket.data.socketId);
  },
};

export function broadcastAppInvalidate(scopes: AppInvalidateScope[]): void {
  if (scopes.length === 0 || realtimeConnections.size === 0) {
    return;
  }

  const normalizedScopes = [...new Set(scopes)];
  for (const connection of realtimeConnections.values()) {
    sendAppInvalidate(connection.socket, normalizedScopes);
  }
}
