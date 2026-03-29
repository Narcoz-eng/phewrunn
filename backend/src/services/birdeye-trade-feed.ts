import WebSocket from "ws";

const BIRDEYE_API_KEY = process.env.BIRDEYE_API_KEY?.trim() || "";
const BIRDEYE_ORIGIN = "https://birdeye.so";
const BIRDEYE_SOCKET_PROTOCOL = "echo-protocol";
const BIRDEYE_REST_BASE_URL = "https://public-api.birdeye.so";
const BIRDEYE_SOCKET_BASE_URL = "wss://public-api.birdeye.so/socket";
const BIRDEYE_SOCKET_HANDSHAKE_TIMEOUT_MS = 7_000;
const BIRDEYE_SOCKET_PING_INTERVAL_MS = 15_000;

export type BirdeyeTradeFeedChain = "solana" | "ethereum";

export type TradeFeedTrade = {
  id: string;
  timestampMs: number;
  txHash: string | null;
  walletAddress: string | null;
  side: "buy" | "sell" | "unknown";
  priceUsd: number | null;
  volumeUsd: number | null;
  fromAmount: number | null;
  fromSymbol: string | null;
  toAmount: number | null;
  toSymbol: string | null;
  source: string | null;
  platform: string | null;
  poolId: string | null;
  isLarge: boolean;
};

export type TradeFeedPriceUpdate = {
  timestampMs: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volumeUsd: number;
  chartType: string;
  address: string | null;
  symbol: string | null;
};

export type TradeFeedStatus = {
  connected: boolean;
  mode: "stream" | "fallback" | "unavailable";
  reason: string | null;
  timestampMs: number;
};

type StartBirdeyeLiveFeedParams = {
  chainType: BirdeyeTradeFeedChain;
  tokenAddress: string;
  pairAddress?: string | null;
  onPrice: (update: TradeFeedPriceUpdate) => void;
  onTrade: (trade: TradeFeedTrade) => void;
  onStatus?: (status: TradeFeedStatus) => void;
  onError?: (error: unknown) => void;
};

function safeRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function safeString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  return normalized ? normalized : null;
}

function safeNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function normalizeChainType(chainType: BirdeyeTradeFeedChain): BirdeyeTradeFeedChain {
  return chainType === "ethereum" ? "ethereum" : "solana";
}

function toTimestampMs(value: unknown): number | null {
  const numeric = safeNumber(value);
  if (numeric === null || numeric <= 0) return null;
  return numeric > 10_000_000_000 ? Math.round(numeric) : Math.round(numeric * 1000);
}

function toTradeSide(value: unknown): TradeFeedTrade["side"] {
  const normalized = safeString(value)?.toLowerCase();
  if (normalized === "buy" || normalized === "sell") {
    return normalized;
  }
  return "unknown";
}

function isLargePrint(volumeUsd: number | null): boolean {
  return volumeUsd !== null && volumeUsd >= 5_000;
}

function mapBirdeyeTrade(value: unknown): TradeFeedTrade | null {
  const record = safeRecord(value);
  if (!record) return null;

  const from = safeRecord(record.from);
  const to = safeRecord(record.to);
  const timestampMs =
    toTimestampMs(record.blockUnixTime) ??
    toTimestampMs(record.block_unix_time) ??
    toTimestampMs(record.unixTime) ??
    null;
  if (timestampMs === null) {
    return null;
  }

  const txHash = safeString(record.txHash) ?? safeString(record.tx_hash);
  const walletAddress = safeString(record.owner) ?? safeString(record.walletAddress);
  const priceUsd =
    safeNumber(record.tokenPrice) ??
    safeNumber(record.priceUsd) ??
    safeNumber(record.pricePair) ??
    safeNumber(record.price) ??
    null;
  const volumeUsd =
    safeNumber(record.volumeUSD) ??
    safeNumber(record.volumeUsd) ??
    safeNumber(record.volume_usd) ??
    null;

  return {
    id: txHash ?? `${timestampMs}:${safeString(record.owner) ?? "unknown"}`,
    timestampMs,
    txHash,
    walletAddress,
    side: toTradeSide(record.side),
    priceUsd,
    volumeUsd,
    fromAmount: safeNumber(from?.uiAmount) ?? safeNumber(from?.uiChangeAmount) ?? null,
    fromSymbol: safeString(from?.symbol),
    toAmount: safeNumber(to?.uiAmount) ?? safeNumber(to?.uiChangeAmount) ?? null,
    toSymbol: safeString(to?.symbol),
    source: safeString(record.source),
    platform: safeString(record.platform),
    poolId: safeString(record.poolId) ?? safeString(record.pool_id),
    isLarge: isLargePrint(volumeUsd),
  };
}

function mapBirdeyePriceUpdate(value: unknown): TradeFeedPriceUpdate | null {
  const record = safeRecord(value);
  if (!record) return null;

  const timestampMs = toTimestampMs(record.unixTime) ?? toTimestampMs(record.blockUnixTime);
  const open = safeNumber(record.o);
  const high = safeNumber(record.h);
  const low = safeNumber(record.l);
  const close = safeNumber(record.c);
  const volumeUsd = safeNumber(record.v) ?? 0;
  if (timestampMs === null || open === null || high === null || low === null || close === null) {
    return null;
  }

  return {
    timestampMs,
    open,
    high,
    low,
    close,
    volumeUsd,
    chartType: safeString(record.type) ?? "1m",
    address: safeString(record.address),
    symbol: safeString(record.symbol),
  };
}

async function parseBirdeyeJsonResponse(response: Response): Promise<unknown> {
  const payloadText = await response.text().catch(() => "");
  if (!response.ok) {
    throw new Error(payloadText || `Birdeye request failed (${response.status})`);
  }
  try {
    return JSON.parse(payloadText);
  } catch {
    throw new Error("Birdeye returned invalid JSON");
  }
}

export function hasBirdeyeTradeFeedConfig(): boolean {
  return BIRDEYE_API_KEY.length > 0;
}

export async function fetchBirdeyeRecentTrades(params: {
  chainType: BirdeyeTradeFeedChain;
  tokenAddress: string;
  limit: number;
}): Promise<TradeFeedTrade[]> {
  if (!hasBirdeyeTradeFeedConfig()) {
    return [];
  }

  const chainType = normalizeChainType(params.chainType);
  const limit = Math.max(5, Math.min(40, Math.round(params.limit)));
  const url = new URL(`${BIRDEYE_REST_BASE_URL}/defi/txs/token`);
  url.searchParams.set("address", params.tokenAddress);
  url.searchParams.set("offset", "0");
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("tx_type", "swap");
  url.searchParams.set("sort_by", "block_unix_time");
  url.searchParams.set("sort_type", "desc");

  const response = await fetch(url, {
    method: "GET",
    headers: {
      accept: "application/json",
      "X-API-KEY": BIRDEYE_API_KEY,
      "x-chain": chainType,
    },
  });

  const payload = await parseBirdeyeJsonResponse(response);
  const record = safeRecord(payload);
  const data = safeRecord(record?.data);
  const itemsCandidate =
    (Array.isArray(data?.items) ? data?.items : null) ??
    (Array.isArray(data?.txs) ? data?.txs : null) ??
    (Array.isArray(record?.data) ? record?.data : null) ??
    (Array.isArray(record?.items) ? record?.items : null) ??
    [];

  return itemsCandidate
    .map((item) => mapBirdeyeTrade(item))
    .filter((item): item is TradeFeedTrade => item !== null)
    .sort((left, right) => right.timestampMs - left.timestampMs)
    .slice(0, limit);
}

export function startBirdeyeLiveFeed(params: StartBirdeyeLiveFeedParams): { close: () => void } {
  if (!hasBirdeyeTradeFeedConfig()) {
    params.onStatus?.({
      connected: false,
      mode: "unavailable",
      reason: "Birdeye API key is not configured",
      timestampMs: Date.now(),
    });
    return { close: () => undefined };
  }

  const chain = normalizeChainType(params.chainType);
  const address = params.pairAddress?.trim() || params.tokenAddress.trim();
  const priceCurrency = params.pairAddress ? "pair" : "usd";
  const liveChartType = chain === "solana" ? "1s" : "1m";
  const socketUrl = `${BIRDEYE_SOCKET_BASE_URL}/${chain}?x-api-key=${encodeURIComponent(BIRDEYE_API_KEY)}`;
  const socket = new WebSocket(socketUrl, [BIRDEYE_SOCKET_PROTOCOL], {
    origin: BIRDEYE_ORIGIN,
    handshakeTimeout: BIRDEYE_SOCKET_HANDSHAKE_TIMEOUT_MS,
  });

  let closed = false;
  let pingInterval: ReturnType<typeof setInterval> | null = null;

  const close = () => {
    if (closed) return;
    closed = true;
    if (pingInterval) {
      clearInterval(pingInterval);
      pingInterval = null;
    }
    try {
      socket.close();
    } catch {
      // no-op
    }
  };

  socket.on("open", () => {
    if (closed) return;
    params.onStatus?.({
      connected: true,
      mode: "stream",
      reason: null,
      timestampMs: Date.now(),
    });

    socket.send(
      JSON.stringify({
        type: "SUBSCRIBE_PRICE",
        data: {
          queryType: "simple",
          chartType: liveChartType,
          address,
          currency: priceCurrency,
        },
      })
    );

    socket.send(
      JSON.stringify({
        type: "SUBSCRIBE_TXS",
        data: params.pairAddress
          ? {
              queryType: "simple",
              pairAddress: params.pairAddress,
              txsType: "swap",
            }
          : {
              queryType: "simple",
              address: params.tokenAddress,
              txsType: "swap",
            },
      })
    );

    pingInterval = setInterval(() => {
      if (socket.readyState === WebSocket.OPEN) {
        try {
          socket.ping();
        } catch {
          // ignore ping failures; close handler will surface the disconnect
        }
      }
    }, BIRDEYE_SOCKET_PING_INTERVAL_MS);
  });

  socket.on("message", (rawMessage) => {
    if (closed) return;

    try {
      const payload =
        typeof rawMessage === "string"
          ? JSON.parse(rawMessage)
          : JSON.parse(rawMessage.toString());
      const record = safeRecord(payload);
      const type = safeString(record?.type)?.toUpperCase();
      if (type === "PRICE_DATA") {
        const update = mapBirdeyePriceUpdate(record?.data);
        if (update) {
          params.onPrice(update);
        }
        return;
      }
      if (type === "TXS_DATA") {
        const trade = mapBirdeyeTrade(record?.data);
        if (trade) {
          params.onTrade(trade);
        }
      }
    } catch (error) {
      params.onError?.(error);
    }
  });

  socket.on("close", (_code, reasonBuffer) => {
    if (closed) return;
    const reason = reasonBuffer.toString() || "Birdeye stream closed";
    params.onStatus?.({
      connected: false,
      mode: "fallback",
      reason,
      timestampMs: Date.now(),
    });
    close();
  });

  socket.on("error", (error) => {
    if (closed) return;
    params.onError?.(error);
    params.onStatus?.({
      connected: false,
      mode: "fallback",
      reason: error instanceof Error ? error.message : "Birdeye stream error",
      timestampMs: Date.now(),
    });
    close();
  });

  return { close };
}
