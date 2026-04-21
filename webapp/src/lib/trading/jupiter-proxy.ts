export type TradeAttributionType = "token_page_direct" | "post_attributed";

export type JupiterQuoteRequestPayload = {
  inputMint: string;
  outputMint: string;
  amount: number;
  slippageBps: number;
  swapMode: "ExactIn";
  attributionType: TradeAttributionType;
  postId?: string;
};

export type JupiterQuoteResponse = {
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

export type JupiterSwapResponse = {
  swapTransaction?: string;
  lastValidBlockHeight?: number;
  tradeFeeEventId?: string | null;
  tradeVerificationMemo?: string | null;
  platformFeeBpsApplied?: number;
  posterShareBpsApplied?: number;
};

const JUPITER_QUOTE_TIMEOUT_MS = 4_800;
const JUPITER_QUOTE_MEMORY_CACHE_TTL_MS = 4_000;

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
    payload.postId ?? "",
    payload.attributionType,
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

export async function fetchJupiterQuoteFast(
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
      const response = await fetch("/api/posts/jupiter/quote", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
        signal,
        cache: "no-store",
        credentials: "same-origin",
      });
      if (!response.ok) {
        const bodyText = await response.text().catch(() => "");
        let message = bodyText || `Quote failed (${response.status})`;
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

      const quote = (await response.json()) as JupiterQuoteResponse;
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
