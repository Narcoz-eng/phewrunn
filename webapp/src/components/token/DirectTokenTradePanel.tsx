import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { Connection, LAMPORTS_PER_SOL, PublicKey, VersionedTransaction } from "@solana/web3.js";
import { AlertCircle, CheckCircle2, ExternalLink, Loader2, Wallet2 } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { mapTradeExecutionError, type TradeExecutionErrorState } from "@/lib/trade-errors";
import { TradingPanel } from "@/components/feed/TradingPanel";
import PortfolioPanel, { type PortfolioPosition } from "@/components/feed/PortfolioPanel";
import { cn } from "@/lib/utils";

const SOL_MINT = "So11111111111111111111111111111111111111112";
const JUPITER_QUOTE_TIMEOUT_MS = 4_800;
const JUPITER_QUOTE_REFRESH_BEFORE_EXECUTE_MS = 8_000;
const TRADE_SOL_BALANCE_BUFFER_SOL = 0.01;
const QUICK_BUY_PRESETS = ["0.10", "0.20", "0.50", "1.00"];
const SELL_QUICK_PERCENTS = [25, 50, 75, 100];

type TradeSide = "buy" | "sell";
type TradeAttributionType = "token_page_direct" | "post_attributed";

type JupiterQuoteRequestPayload = {
  inputMint: string;
  outputMint: string;
  amount: number;
  slippageBps: number;
  swapMode: "ExactIn";
  attributionType: TradeAttributionType;
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
  platformFeeBpsApplied?: number;
  posterShareBpsApplied?: number;
};

type TradePanelContextResponse = {
  source: string;
  walletAddress: string;
  tokenMint: string;
  walletNativeBalance: number | null;
  walletTokenBalance: number | null;
  tokenDecimals: number | null;
} | null;

type TradePanelPortfolioResponse = {
  positions: PortfolioPosition[];
  totalUnrealizedPnl: number | null;
};

type TradeNotice = {
  tone: "info" | "success" | "error";
  title: string;
  detail: string;
  txSignature: string | null;
};

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

async function fetchJupiterQuoteFast(
  payload: JupiterQuoteRequestPayload,
  options?: { signal?: AbortSignal; timeoutMs?: number }
): Promise<JupiterQuoteResponse> {
  const { signal, cleanup } = createAbortSignalWithTimeout(
    options?.timeoutMs ?? JUPITER_QUOTE_TIMEOUT_MS,
    options?.signal
  );

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
      throw new Error(bodyText || `Quote failed (${response.status})`);
    }
    return (await response.json()) as JupiterQuoteResponse;
  } finally {
    cleanup();
  }
}

function formatTokenAmountFromAtomic(amount: string | null | undefined, decimals: number): string {
  if (!amount) return "N/A";
  const raw = Number(amount);
  if (!Number.isFinite(raw)) return "N/A";
  const value = raw / Math.pow(10, decimals);
  return value.toLocaleString(undefined, {
    maximumFractionDigits: value >= 1000 ? 2 : value >= 1 ? 4 : 6,
  });
}

function formatSolAtomic(amount: string | null | undefined): string {
  if (!amount) return "N/A";
  const raw = Number(amount);
  if (!Number.isFinite(raw)) return "N/A";
  return (raw / LAMPORTS_PER_SOL).toLocaleString(undefined, {
    maximumFractionDigits: 6,
  });
}

function formatDecimalInputValue(value: number, fractionDigits: number): string {
  if (!Number.isFinite(value) || value <= 0) return "";
  return value
    .toFixed(Math.max(0, Math.min(8, fractionDigits)))
    .replace(/\.?0+$/, "");
}

function normalizeSlippageInput(value: string): number | null {
  const parsed = Number(value.replace("%", "").trim());
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.max(0.01, Math.min(50, parsed));
}

export function DirectTokenTradePanel({
  tokenAddress,
  chainType,
  tokenSymbol,
  tokenImage,
  tokenPriceUsd,
  liveStateLabel,
}: {
  tokenAddress: string;
  chainType: "solana" | "ethereum";
  tokenSymbol: string;
  tokenImage: string | null;
  tokenPriceUsd: number | null;
  liveStateLabel: string | null;
}) {
  const wallet = useWallet();
  const { connection } = useConnection();
  const { setVisible: setWalletModalVisible } = useWalletModal();
  const heliusReadRpcUrl = (import.meta.env.VITE_HELIUS_RPC_URL as string | undefined)?.trim() || null;
  const tradeReadConnection = useMemo(
    () => (heliusReadRpcUrl ? new Connection(heliusReadRpcUrl, "confirmed") : connection),
    [heliusReadRpcUrl, connection]
  );

  const [tradeSide, setTradeSide] = useState<TradeSide>("buy");
  const [buyAmountSol, setBuyAmountSol] = useState("0.10");
  const [sellAmountToken, setSellAmountToken] = useState("");
  const [slippageBps, setSlippageBps] = useState(100);
  const [slippageInputPercent, setSlippageInputPercent] = useState("1.0");
  const [autoConfirmEnabled, setAutoConfirmEnabled] = useState(true);
  const [mevProtectionEnabled, setMevProtectionEnabled] = useState(true);
  const [priceProtectionEnabled, setPriceProtectionEnabled] = useState(false);
  const [stopLossPercent, setStopLossPercent] = useState("-15");
  const [takeProfitPercent, setTakeProfitPercent] = useState("50");
  const [txSignature, setTxSignature] = useState<string | null>(null);
  const [tradeError, setTradeError] = useState<TradeExecutionErrorState | null>(null);
  const [isExecuting, setIsExecuting] = useState(false);
  const [tradeNotice, setTradeNotice] = useState<TradeNotice | null>(null);
  const [lastQuoteAtMs, setLastQuoteAtMs] = useState(0);
  const preparedSwapRef = useRef<{ key: string; payload: JupiterSwapResponse; cachedAt: number } | null>(null);

  const isSolanaTradeSupported = chainType === "solana";
  const walletPublicKey = wallet.publicKey;
  const walletAddress = walletPublicKey?.toBase58() ?? null;
  const parsedBuyAmountSol = Number(buyAmountSol);
  const parsedSellAmountToken = Number(sellAmountToken);
  const outputTokenDecimalsFallback = 6;
  const tradePanelContextQuery = useQuery<TradePanelContextResponse>({
    queryKey: ["token-direct-trade-context", walletAddress, tokenAddress],
    enabled: isSolanaTradeSupported && !!walletAddress,
    staleTime: 20_000,
    gcTime: 60_000,
    refetchOnWindowFocus: false,
    retry: 1,
    queryFn: async () => {
      if (!walletAddress) return null;
      return api.post<TradePanelContextResponse>("/api/posts/trade-context", {
        walletAddress,
        tokenMint: tokenAddress,
      });
    },
  });

  const outputTokenDecimals =
    typeof tradePanelContextQuery.data?.tokenDecimals === "number"
      ? tradePanelContextQuery.data.tokenDecimals
      : outputTokenDecimalsFallback;
  const walletNativeBalance =
    typeof tradePanelContextQuery.data?.walletNativeBalance === "number" &&
    Number.isFinite(tradePanelContextQuery.data.walletNativeBalance)
      ? tradePanelContextQuery.data.walletNativeBalance
      : null;
  const walletTokenBalance =
    typeof tradePanelContextQuery.data?.walletTokenBalance === "number" &&
    Number.isFinite(tradePanelContextQuery.data.walletTokenBalance)
      ? tradePanelContextQuery.data.walletTokenBalance
      : null;

  const portfolioQuery = useQuery<TradePanelPortfolioResponse>({
    queryKey: ["token-direct-portfolio", walletAddress, tokenAddress],
    enabled: isSolanaTradeSupported && !!walletAddress,
    staleTime: 20_000,
    gcTime: 60_000,
    refetchOnWindowFocus: false,
    retry: 1,
    queryFn: async () => {
      if (!walletAddress) {
        return { positions: [], totalUnrealizedPnl: null };
      }
      return api.post<TradePanelPortfolioResponse>("/api/posts/portfolio", {
        walletAddress,
        tokenMints: [tokenAddress],
      });
    },
  });

  const createJupiterQuotePayload = useCallback(
    (side: TradeSide, amountAtomic: number): JupiterQuoteRequestPayload | null => {
      if (!isSolanaTradeSupported) return null;
      let tokenMint = tokenAddress.trim();
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
        attributionType: "token_page_direct",
      };
    },
    [isSolanaTradeSupported, slippageBps, tokenAddress]
  );

  const quoteAmountAtomic = useMemo(() => {
    if (!isSolanaTradeSupported) return null;
    if (tradeSide === "buy") {
      if (!Number.isFinite(parsedBuyAmountSol) || parsedBuyAmountSol <= 0) return null;
      return Math.max(1, Math.round(parsedBuyAmountSol * LAMPORTS_PER_SOL));
    }
    if (!Number.isFinite(parsedSellAmountToken) || parsedSellAmountToken <= 0) return null;
    return Math.max(1, Math.round(parsedSellAmountToken * Math.pow(10, outputTokenDecimals)));
  }, [isSolanaTradeSupported, outputTokenDecimals, parsedBuyAmountSol, parsedSellAmountToken, tradeSide]);

  const quoteQuery = useQuery<JupiterQuoteResponse>({
    queryKey: ["token-direct-quote", tokenAddress, tradeSide, quoteAmountAtomic, slippageBps],
    enabled: isSolanaTradeSupported && !!quoteAmountAtomic,
    staleTime: 4_000,
    gcTime: 60_000,
    refetchOnWindowFocus: false,
    retry: 1,
    queryFn: async ({ signal }) => {
      if (!quoteAmountAtomic) throw new Error("Missing amount");
      const payload = createJupiterQuotePayload(tradeSide, quoteAmountAtomic);
      if (!payload) throw new Error("Invalid token address");
      return fetchJupiterQuoteFast(payload, { signal });
    },
  });

  useEffect(() => {
    if (!quoteQuery.data) return;
    setLastQuoteAtMs(Date.now());
  }, [quoteQuery.data]);

  useEffect(() => {
    preparedSwapRef.current = null;
  }, [tokenAddress, tradeSide, buyAmountSol, sellAmountToken, slippageBps]);

  const quoteData = quoteQuery.data ?? null;
  const jupiterOutputFormatted = quoteData
    ? tradeSide === "buy"
      ? formatTokenAmountFromAtomic(quoteData.outAmount, outputTokenDecimals)
      : formatSolAtomic(quoteData.outAmount)
    : "-";
  const jupiterMinReceiveFormatted = quoteData
    ? tradeSide === "buy"
      ? formatTokenAmountFromAtomic(quoteData.otherAmountThreshold, outputTokenDecimals)
      : formatSolAtomic(quoteData.otherAmountThreshold)
    : "-";
  const priceImpactPct = quoteData?.priceImpactPct ? Number(quoteData.priceImpactPct) * 100 : null;
  const jupiterPriceImpactDisplay =
    typeof priceImpactPct === "number" && Number.isFinite(priceImpactPct)
      ? `${priceImpactPct.toFixed(priceImpactPct >= 1 ? 2 : 3)}%`
      : "-";
  const jupiterPlatformFeeAtomic = quoteData?.platformFee?.amount ?? null;
  const jupiterPlatformFeeBps = quoteData?.platformFee?.feeBps ?? 50;
  const jupiterPlatformFeeMint = quoteData?.platformFee?.mint ?? SOL_MINT;
  const jupiterPlatformFeeAmountDisplay =
    jupiterPlatformFeeMint === SOL_MINT
      ? `${formatSolAtomic(jupiterPlatformFeeAtomic)} SOL`
      : `${formatTokenAmountFromAtomic(jupiterPlatformFeeAtomic, outputTokenDecimals)} ${tokenSymbol}`;
  const routeFeeDisplay =
    jupiterPlatformFeeAtomic && jupiterPlatformFeeAtomic !== "0"
      ? `${(jupiterPlatformFeeBps / 100).toFixed(2)}% (${jupiterPlatformFeeAmountDisplay})`
      : `${(jupiterPlatformFeeBps / 100).toFixed(2)}%`;
  const quoteFreshnessLabel =
    lastQuoteAtMs > 0 ? `Refreshed ${Math.max(1, Math.round((Date.now() - lastQuoteAtMs) / 1000))}s ago` : null;

  const buyAmountExceedsBalance =
    tradeSide === "buy" &&
    walletNativeBalance !== null &&
    Number.isFinite(parsedBuyAmountSol) &&
    parsedBuyAmountSol + TRADE_SOL_BALANCE_BUFFER_SOL > walletNativeBalance + 1e-9;
  const sellAmountExceedsBalance =
    tradeSide === "sell" &&
    walletTokenBalance !== null &&
    Number.isFinite(parsedSellAmountToken) &&
    parsedSellAmountToken > walletTokenBalance + 1e-9;

  const canExecute =
    isSolanaTradeSupported &&
    !!walletPublicKey &&
    !!wallet.signTransaction &&
    !!quoteData &&
    !!quoteAmountAtomic &&
    !buyAmountExceedsBalance &&
    !sellAmountExceedsBalance &&
    !isExecuting;

  const handleConnectWallet = useCallback(() => {
    setWalletModalVisible(true);
  }, [setWalletModalVisible]);

  const applySlippagePercentInput = useCallback(() => {
    const normalized = normalizeSlippageInput(slippageInputPercent);
    if (normalized === null) {
      setSlippageInputPercent((slippageBps / 100).toFixed(2));
      return;
    }
    const nextBps = Math.round(normalized * 100);
    setSlippageBps(nextBps);
    setSlippageInputPercent(normalized.toFixed(2));
  }, [slippageBps, slippageInputPercent]);

  const setSellAmountFromPercent = useCallback(
    (percent: number) => {
      if (walletTokenBalance === null || !Number.isFinite(walletTokenBalance) || walletTokenBalance <= 0) return;
      const next = walletTokenBalance * (percent / 100);
      setSellAmountToken(formatDecimalInputValue(next, 6));
    },
    [walletTokenBalance]
  );

  const updateTradeNotice = useCallback((next: TradeNotice) => {
    setTradeNotice(next);
    const toastId = `token-direct-trade:${tokenAddress}`;
    if (next.tone === "error") {
      toast.error(next.title, { id: toastId, description: next.detail });
      return;
    }
    if (next.tone === "success") {
      toast.success(next.title, { id: toastId, description: next.detail });
      return;
    }
    toast.loading(next.title, { id: toastId, description: next.detail });
  }, [tokenAddress]);

  const buildSwapTransaction = useCallback(async (quote: JupiterQuoteResponse) => {
    if (!walletPublicKey) {
      throw new Error("Connect a Solana wallet first");
    }

    const cacheKey = [
      walletPublicKey.toBase58(),
      tokenAddress,
      tradeSide,
      String(quote.inAmount),
      String(quote.outAmount),
      String(slippageBps),
      mevProtectionEnabled ? "mev" : "plain",
    ].join(":");

    const cached = preparedSwapRef.current;
    if (cached && cached.key === cacheKey && Date.now() - cached.cachedAt < 12_000) {
      return cached.payload;
    }

    const response = await api.raw("/api/posts/jupiter/swap", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        quoteResponse: quote,
        userPublicKey: walletPublicKey.toBase58(),
        tradeSide,
        attributionType: "token_page_direct",
        wrapAndUnwrapSol: true,
        dynamicComputeUnitLimit: true,
        mevProtection: mevProtectionEnabled,
      }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(body || `Swap build failed (${response.status})`);
    }

    const payload = (await response.json()) as JupiterSwapResponse;
    preparedSwapRef.current = { key: cacheKey, payload, cachedAt: Date.now() };
    return payload;
  }, [mevProtectionEnabled, slippageBps, tokenAddress, tradeSide, walletPublicKey]);

  const handleExecute = useCallback(async () => {
    if (!isSolanaTradeSupported) {
      const error = mapTradeExecutionError(new Error("Ethereum direct trading is still being finalized in the shared engine"));
      setTradeError(error);
      updateTradeNotice({
        tone: "error",
        title: error.title,
        detail: error.message,
        txSignature: null,
      });
      return;
    }
    if (!walletPublicKey) {
      handleConnectWallet();
      return;
    }
    if (!wallet.signTransaction) {
      const error = mapTradeExecutionError(new Error("This wallet does not support transaction signing"));
      setTradeError(error);
      updateTradeNotice({
        tone: "error",
        title: error.title,
        detail: error.message,
        txSignature: null,
      });
      return;
    }

    const freshestQuote = quoteData;
    if (!freshestQuote || !quoteAmountAtomic) {
      const error = mapTradeExecutionError(new Error("Quote unavailable"));
      setTradeError(error);
      updateTradeNotice({
        tone: "error",
        title: error.title,
        detail: error.message,
        txSignature: null,
      });
      return;
    }

    setIsExecuting(true);
    setTradeError(null);
    setTxSignature(null);
    updateTradeNotice({
      tone: "info",
      title: `${tradeSide === "buy" ? "Buy" : "Sell"} ${tokenSymbol} order has been created`,
      detail: "Refreshing the route and preparing the transaction.",
      txSignature: null,
    });

    try {
      let quote = freshestQuote;
      if (Date.now() - lastQuoteAtMs > JUPITER_QUOTE_REFRESH_BEFORE_EXECUTE_MS) {
        const payload = createJupiterQuotePayload(tradeSide, quoteAmountAtomic);
        if (payload) {
          quote = await fetchJupiterQuoteFast(payload);
          setLastQuoteAtMs(Date.now());
        }
      }

      const swapPayload = await buildSwapTransaction(quote);
      if (!swapPayload.swapTransaction) {
        throw new Error("No swap transaction returned");
      }

      updateTradeNotice({
        tone: "info",
        title: "Awaiting wallet signature",
        detail: `Sign this ${tradeSide} transaction to continue.`,
        txSignature: null,
      });

      const transaction = VersionedTransaction.deserialize(
        Uint8Array.from(atob(swapPayload.swapTransaction), (char) => char.charCodeAt(0))
      );
      const signedTransaction = await wallet.signTransaction(transaction);
      const sendCommitment = autoConfirmEnabled ? "processed" : "confirmed";
      const signature = await tradeReadConnection.sendRawTransaction(signedTransaction.serialize(), {
        maxRetries: autoConfirmEnabled ? 0 : 2,
        skipPreflight: autoConfirmEnabled,
        preflightCommitment: sendCommitment,
      });

      setTxSignature(signature);
      updateTradeNotice({
        tone: "info",
        title: "Transaction submitted",
        detail: `${tradeSide === "buy" ? "Buy" : "Sell"} transaction is on-chain now. Waiting for confirmation.`,
        txSignature: signature,
      });

      if (typeof swapPayload.lastValidBlockHeight === "number") {
        await tradeReadConnection.confirmTransaction(
          {
            signature,
            blockhash: transaction.message.recentBlockhash,
            lastValidBlockHeight: swapPayload.lastValidBlockHeight,
          },
          sendCommitment
        );
      } else {
        await tradeReadConnection.confirmTransaction(signature, sendCommitment);
      }

      updateTradeNotice({
        tone: "success",
        title: `${tradeSide === "buy" ? "Buy" : "Sell"} confirmed`,
        detail: `Executed with ${(jupiterPlatformFeeBps / 100).toFixed(2)}% platform fee on the direct token trade lane.`,
        txSignature: signature,
      });

      preparedSwapRef.current = null;
      void quoteQuery.refetch();
      void tradePanelContextQuery.refetch();
      void portfolioQuery.refetch();
    } catch (error) {
      preparedSwapRef.current = null;
      const mapped = mapTradeExecutionError(error);
      setTradeError(mapped);
      updateTradeNotice({
        tone: "error",
        title: mapped.title,
        detail: mapped.message,
        txSignature: null,
      });
    } finally {
      setIsExecuting(false);
    }
  }, [
    autoConfirmEnabled,
    buildSwapTransaction,
    createJupiterQuotePayload,
    handleConnectWallet,
    isSolanaTradeSupported,
    jupiterPlatformFeeBps,
    lastQuoteAtMs,
    portfolioQuery,
    quoteAmountAtomic,
    quoteData,
    quoteQuery,
    tokenSymbol,
    tradePanelContextQuery,
    tradeReadConnection,
    tradeSide,
    updateTradeNotice,
    wallet,
    walletPublicKey,
  ]);

  const tradePayUsdEstimate =
    tradeSide === "sell" && Number.isFinite(parsedSellAmountToken) && tokenPriceUsd !== null
      ? parsedSellAmountToken * tokenPriceUsd
      : null;
  const tradeReceiveUsdEstimate =
    tradeSide === "buy" && quoteData && tokenPriceUsd !== null
      ? (Number(quoteData.outAmount) / Math.pow(10, outputTokenDecimals)) * tokenPriceUsd
      : null;

  const walletTokenBalanceFormatted =
    walletTokenBalance !== null
      ? walletTokenBalance.toLocaleString(undefined, { maximumFractionDigits: 6 })
      : "--";

  const executeDisabledReason = !isSolanaTradeSupported
    ? "Ethereum direct trading is still being finalized."
    : buyAmountExceedsBalance
      ? "Insufficient SOL balance for this trade."
      : sellAmountExceedsBalance
        ? "Sell amount is higher than your balance."
        : null;

  return (
    <div className="space-y-4">
      {tradeNotice ? (
        <div
          className={cn(
            "rounded-[22px] border p-4 shadow-[0_24px_60px_-38px_hsl(var(--foreground)/0.28)]",
            tradeNotice.tone === "success"
              ? "border-emerald-300/35 bg-emerald-500/10"
              : tradeNotice.tone === "error"
                ? "border-rose-300/35 bg-rose-500/10"
                : "border-primary/25 bg-primary/10"
          )}
        >
          <div className="flex items-start gap-3">
            <div
              className={cn(
                "mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full",
                tradeNotice.tone === "success"
                  ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-300"
                  : tradeNotice.tone === "error"
                    ? "bg-rose-500/15 text-rose-600 dark:text-rose-300"
                    : "bg-primary/15 text-primary"
              )}
            >
              {tradeNotice.tone === "success" ? (
                <CheckCircle2 className="h-4 w-4" />
              ) : tradeNotice.tone === "error" ? (
                <AlertCircle className="h-4 w-4" />
              ) : (
                <Loader2 className="h-4 w-4 animate-spin" />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold text-foreground">{tradeNotice.title}</div>
              <div className="mt-1 text-sm leading-6 text-muted-foreground">{tradeNotice.detail}</div>
              {tradeNotice.txSignature ? (
                <a
                  href={`https://solscan.io/tx/${tradeNotice.txSignature}`}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-3 inline-flex items-center gap-1.5 text-xs font-semibold text-primary transition-colors hover:text-primary/80"
                >
                  View transaction
                  <ExternalLink className="h-3 w-3" />
                </a>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      {executeDisabledReason && chainType === "ethereum" ? (
        <div className="rounded-[22px] border border-amber-300/35 bg-amber-500/10 p-4 text-sm leading-6 text-amber-900 dark:text-amber-100">
          <div className="font-semibold">Ethereum direct trade lane is still being finalized</div>
          <p className="mt-1">
            The token-page fee split is ready for the shared engine, but the EVM signing/runtime path still needs the final 0x + Privy wallet pass.
          </p>
        </div>
      ) : null}

      <TradingPanel
        tradeSide={tradeSide}
        onTradeSideChange={setTradeSide}
        buyAmountSol={buyAmountSol}
        onBuyAmountChange={setBuyAmountSol}
        sellAmountToken={sellAmountToken}
        onSellAmountChange={setSellAmountToken}
        tokenSymbol={tokenSymbol}
        tokenName={tokenName}
        tokenImage={tokenImage}
        chainType={chainType}
        slippageBps={slippageBps}
        onSlippageChange={(bps) => {
          setSlippageBps(bps);
          setSlippageInputPercent((bps / 100).toFixed(2));
        }}
        jupiterOutputFormatted={jupiterOutputFormatted}
        jupiterMinReceiveFormatted={jupiterMinReceiveFormatted}
        jupiterPriceImpactDisplay={jupiterPriceImpactDisplay}
        routeFeeDisplay={routeFeeDisplay}
        creatorFeeDisplay="Not applied on token-page direct trades"
        platformFeeDisplay={`${(jupiterPlatformFeeBps / 100).toFixed(2)}%`}
        jupiterStatusLabel={isExecuting ? "Processing trade..." : "Platform fee only"}
        isQuoteLoading={quoteQuery.isLoading || quoteQuery.isFetching}
        isExecuting={isExecuting}
        canExecute={canExecute}
        walletConnected={Boolean(walletPublicKey && wallet.signTransaction)}
        walletBalance={walletNativeBalance}
        walletBalanceLoading={tradePanelContextQuery.isLoading || tradePanelContextQuery.isFetching}
        walletBalanceUsd={null}
        walletTokenBalance={walletTokenBalance}
        walletTokenBalanceFormatted={walletTokenBalanceFormatted}
        walletTokenBalanceLoading={tradePanelContextQuery.isLoading || tradePanelContextQuery.isFetching}
        payAmountUsd={tradePayUsdEstimate}
        receiveAmountUsd={tradeReceiveUsdEstimate}
        slippageInputPercent={slippageInputPercent}
        onSlippageInputChange={setSlippageInputPercent}
        onSlippageInputCommit={applySlippagePercentInput}
        onExecute={() => void handleExecute()}
        onConnectWallet={handleConnectWallet}
        txSignature={txSignature}
        quickBuyPresets={[...QUICK_BUY_PRESETS]}
        sellQuickPercents={[...SELL_QUICK_PERCENTS]}
        onQuickBuyPresetClick={setBuyAmountSol}
        onSellPercentClick={setSellAmountFromPercent}
        autoConfirmEnabled={autoConfirmEnabled}
        onAutoConfirmChange={setAutoConfirmEnabled}
        mevProtectionEnabled={mevProtectionEnabled}
        onMevProtectionChange={setMevProtectionEnabled}
        protectionEnabled={priceProtectionEnabled}
        onProtectionEnabledChange={setPriceProtectionEnabled}
        stopLossPercent={stopLossPercent}
        onStopLossPercentChange={setStopLossPercent}
        takeProfitPercent={takeProfitPercent}
        onTakeProfitPercentChange={setTakeProfitPercent}
        protectionStatusLabel={priceProtectionEnabled ? "Arms after your next fill." : "Optional price guard"}
        protectionStatusTone={priceProtectionEnabled ? "armed" : "idle"}
        quoteFreshnessLabel={quoteFreshnessLabel}
        liveStateLabel={liveStateLabel}
        tradeError={
          tradeError
            ? {
                title: tradeError.title,
                message: tradeError.message,
                retryable: tradeError.retryable,
              }
            : executeDisabledReason && chainType === "ethereum"
              ? {
                  title: "Ethereum direct trading is not live yet",
                  message: executeDisabledReason,
                  retryable: false,
                }
              : null
        }
        onClearTradeError={() => setTradeError(null)}
        onRetryTradeError={() => {
          setTradeError(null);
          void quoteQuery.refetch();
        }}
      />

      <PortfolioPanel
        positions={portfolioQuery.data?.positions ?? []}
        isLoading={portfolioQuery.isLoading || portfolioQuery.isFetching}
        totalUnrealizedPnl={portfolioQuery.data?.totalUnrealizedPnl ?? null}
        onQuickSell={(mint, amount) => {
          if (mint !== tokenAddress) return;
          setTradeSide("sell");
          setSellAmountToken(formatDecimalInputValue(amount, 6));
        }}
        walletConnected={Boolean(walletPublicKey && wallet.signTransaction)}
        actionMode="always"
        actionLabel="Route"
        actionTone="neutral"
      />

      {!walletPublicKey ? (
        <div className="rounded-[22px] border border-dashed border-border/60 bg-card/60 p-4 text-sm text-muted-foreground">
          <div className="flex items-center gap-2 font-semibold text-foreground">
            <Wallet2 className="h-4 w-4 text-primary" />
            Connect your wallet to trade directly from this token page
          </div>
          <p className="mt-2 leading-6">
            Token-page trades use the direct lane only: 0.50% platform fee, no creator fee, no recent-call dependency.
          </p>
        </div>
      ) : null}
    </div>
  );
}
