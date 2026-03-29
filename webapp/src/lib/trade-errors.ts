import { ApiError, NetworkError, TimeoutError } from "@/lib/api";

export type TradeErrorLayer = "frontend" | "wallet" | "routing" | "rpc" | "backend";

export type TradeExecutionErrorState = {
  kind:
    | "wallet_not_connected"
    | "wallet_not_linked"
    | "wallet_mismatch"
    | "wallet_rejected"
    | "insufficient_balance"
    | "invalid_token"
    | "quote_unavailable"
    | "route_expired"
    | "slippage_exceeded"
    | "provider_unavailable"
    | "confirmation_timeout"
    | "unknown";
  layer: TradeErrorLayer;
  title: string;
  message: string;
  retryable: boolean;
  shouldRefetchQuote: boolean;
  rawMessage: string;
  statusCode: number | null;
  errorCode: string | null;
};

function extractErrorCode(error: unknown): string | null {
  if (error instanceof ApiError && error.data && typeof error.data === "object" && "code" in error.data) {
    const candidate = (error.data as { code?: unknown }).code;
    return typeof candidate === "string" ? candidate : null;
  }
  if (error && typeof error === "object" && "code" in error) {
    const candidate = (error as { code?: unknown }).code;
    return typeof candidate === "string" ? candidate : null;
  }
  return null;
}

function extractErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message.trim();
  }
  if (typeof error === "string" && error.trim().length > 0) {
    return error.trim();
  }
  return "Trade failed";
}

function normalize(message: string): string {
  return message.toLowerCase();
}

export function mapTradeExecutionError(error: unknown): TradeExecutionErrorState {
  const rawMessage = extractErrorMessage(error);
  const normalized = normalize(rawMessage);
  const errorCode = extractErrorCode(error);
  const statusCode = error instanceof ApiError ? error.status : null;

  if (normalized.includes("connect a solana wallet")) {
    return {
      kind: "wallet_not_connected",
      layer: "wallet",
      title: "Connect your wallet",
      message: "Connect and unlock your Solana wallet before placing a trade.",
      retryable: false,
      shouldRefetchQuote: false,
      rawMessage,
      statusCode,
      errorCode,
    };
  }

  if (normalized.includes("does not support transaction signing")) {
    return {
      kind: "wallet_not_connected",
      layer: "wallet",
      title: "Wallet cannot sign",
      message: "The selected wallet is connected, but it cannot sign this transaction. Switch wallets and retry.",
      retryable: false,
      shouldRefetchQuote: false,
      rawMessage,
      statusCode,
      errorCode,
    };
  }

  if (errorCode === "WALLET_NOT_LINKED" || normalized.includes("link a wallet before building trades")) {
    return {
      kind: "wallet_not_linked",
      layer: "backend",
      title: "Wallet not linked",
      message: "Link the wallet to your account before building a trade route.",
      retryable: false,
      shouldRefetchQuote: false,
      rawMessage,
      statusCode,
      errorCode,
    };
  }

  if (errorCode === "WALLET_MISMATCH" || normalized.includes("wallet mismatch")) {
    return {
      kind: "wallet_mismatch",
      layer: "backend",
      title: "Wrong wallet selected",
      message: "The connected wallet does not match the wallet linked to this account. Switch wallets and retry.",
      retryable: false,
      shouldRefetchQuote: false,
      rawMessage,
      statusCode,
      errorCode,
    };
  }

  if (
    normalized.includes("user rejected") ||
    normalized.includes("user denied") ||
    normalized.includes("rejected the request") ||
    normalized.includes("cancelled") ||
    normalized.includes("canceled")
  ) {
    return {
      kind: "wallet_rejected",
      layer: "wallet",
      title: "Signature rejected",
      message: "The wallet rejected the signature request. Nothing was submitted. You can retry immediately.",
      retryable: true,
      shouldRefetchQuote: false,
      rawMessage,
      statusCode,
      errorCode,
    };
  }

  if (
    normalized.includes("insufficient") ||
    normalized.includes("higher than your current token balance") ||
    normalized.includes("custom program error: 0x1")
  ) {
    return {
      kind: "insufficient_balance",
      layer: normalized.includes("balance") ? "frontend" : "rpc",
      title: "Insufficient balance",
      message: "Your wallet balance is too low for this trade after fees and slippage. Reduce the amount and retry.",
      retryable: true,
      shouldRefetchQuote: true,
      rawMessage,
      statusCode,
      errorCode,
    };
  }

  if (normalized.includes("invalid solana token address")) {
    return {
      kind: "invalid_token",
      layer: "frontend",
      title: "Invalid token route",
      message: "This token address could not be routed for trading. Refresh the panel and try again.",
      retryable: false,
      shouldRefetchQuote: false,
      rawMessage,
      statusCode,
      errorCode,
    };
  }

  if (
    normalized.includes("no route") ||
    normalized.includes("quote unavailable") ||
    normalized.includes("wait for quote to load") ||
    normalized.includes("quote failed")
  ) {
    return {
      kind: "quote_unavailable",
      layer: "routing",
      title: "Route unavailable",
      message: "No executable route is available right now. Wait for a fresh quote or reduce the trade size.",
      retryable: true,
      shouldRefetchQuote: true,
      rawMessage,
      statusCode,
      errorCode,
    };
  }

  if (
    normalized.includes("block height exceeded") ||
    normalized.includes("blockhash not found") ||
    normalized.includes("transaction expired") ||
    normalized.includes("route expired")
  ) {
    return {
      kind: "route_expired",
      layer: "rpc",
      title: "Quote expired",
      message: "The route expired before submission. A fresh quote is required. Retry once the route refresh completes.",
      retryable: true,
      shouldRefetchQuote: true,
      rawMessage,
      statusCode,
      errorCode,
    };
  }

  if (
    normalized.includes("slippage") ||
    normalized.includes("price impact") ||
    normalized.includes("out amount") ||
    normalized.includes("too little received")
  ) {
    return {
      kind: "slippage_exceeded",
      layer: "routing",
      title: "Price moved too far",
      message: "The route moved outside your slippage tolerance. Refresh the quote, widen slippage carefully, or reduce size.",
      retryable: true,
      shouldRefetchQuote: true,
      rawMessage,
      statusCode,
      errorCode,
    };
  }

  if (
    error instanceof TimeoutError ||
    normalized.includes("timed out") ||
    normalized.includes("not yet confirmed on-chain")
  ) {
    return {
      kind: "confirmation_timeout",
      layer: "rpc",
      title: "Confirmation delayed",
      message: "The transaction was submitted but confirmation is delayed. Check the wallet or explorer, then retry only if it did not land.",
      retryable: true,
      shouldRefetchQuote: false,
      rawMessage,
      statusCode,
      errorCode,
    };
  }

  if (
    error instanceof NetworkError ||
    normalized.includes("failed to fetch") ||
    normalized.includes("network error") ||
    normalized.includes("rpc") ||
    normalized.includes("429") ||
    normalized.includes("503")
  ) {
    return {
      kind: "provider_unavailable",
      layer: statusCode && statusCode >= 500 ? "backend" : "rpc",
      title: "Provider unavailable",
      message: "The route or RPC provider is slow right now. The panel is still usable. Retry in a few seconds with a fresh quote.",
      retryable: true,
      shouldRefetchQuote: true,
      rawMessage,
      statusCode,
      errorCode,
    };
  }

  return {
    kind: "unknown",
    layer: "frontend",
    title: "Trade failed",
    message: "The trade did not complete. Retry with a fresh quote. Raw details were logged for debugging.",
    retryable: true,
    shouldRefetchQuote: true,
    rawMessage,
    statusCode,
    errorCode,
  };
}
