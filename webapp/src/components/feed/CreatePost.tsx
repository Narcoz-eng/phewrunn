import { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Loader2, ExternalLink, Camera, Lock, Skull } from "lucide-react";
import { cn } from "@/lib/utils";
import { User, detectContractAddress, LIQUIDATION_LEVEL, getAvatarUrl } from "@/types";
import { toast } from "sonner";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { PhewSendIcon } from "@/components/icons/PhewIcons";

type ComposerMode = "alpha" | "discussion" | "chart" | "poll" | "raid" | "news";

const COMPOSER_ACTIONS: Array<{
  id: ComposerMode;
  label: string;
  prefix: string;
  tone: "default" | "lime" | "amber" | "cyan" | "violet";
  placeholder: string;
  submitLabel: string;
}> = [
  {
    id: "alpha",
    label: "Alpha",
    prefix: "[alpha]",
    tone: "lime",
    placeholder: "Drop an alpha thesis. Add entry, target, risk, and paste a token CA for live context.",
    submitLabel: "Post Alpha",
  },
  {
    id: "discussion",
    label: "Discussion",
    prefix: "[discussion]",
    tone: "default",
    placeholder: "Start a trader discussion. Ask a question, share context, or open a room thread.",
    submitLabel: "Post Discussion",
  },
  {
    id: "chart",
    label: "Chart",
    prefix: "[chart]",
    tone: "cyan",
    placeholder: "Share chart context. Paste a token CA and describe the setup.",
    submitLabel: "Post Chart",
  },
  {
    id: "poll",
    label: "Poll",
    prefix: "[poll]",
    tone: "violet",
    placeholder: "Create a poll prompt with clear options and an expiration window.",
    submitLabel: "Post Poll",
  },
  {
    id: "raid",
    label: "Raid",
    prefix: "[raid]",
    tone: "amber",
    placeholder: "Share a raid update. Link the target, goal, or room context.",
    submitLabel: "Post Raid",
  },
  {
    id: "news",
    label: "News",
    prefix: "[news]",
    tone: "default",
    placeholder: "Share market or community news with source context.",
    submitLabel: "Post News",
  },
];

function composerToneClass(action: (typeof COMPOSER_ACTIONS)[number], isActive: boolean): string {
  if (isActive) {
    return "border-lime-300/40 bg-lime-300/[0.16] text-lime-100 shadow-[0_0_22px_rgba(169,255,52,0.12)]";
  }

  if (action.tone === "lime") return "border-lime-300/20 bg-lime-300/10 text-lime-200";
  if (action.tone === "amber") return "border-amber-300/20 bg-amber-300/10 text-amber-200";
  if (action.tone === "cyan") return "border-cyan-300/20 bg-cyan-300/10 text-cyan-200";
  if (action.tone === "violet") return "border-violet-300/20 bg-violet-300/10 text-violet-200";
  return "border-white/8 bg-black/20 text-white/56";
}

function stripComposerPrefix(content: string): string {
  return content.replace(/^\[(alpha|discussion|chart|poll|raid|news)\]\s*/i, "").trim();
}

interface CreatePostProps {
  user: User | null;
  onSubmit: (content: string, postType: ComposerMode) => Promise<void>;
  isSubmitting: boolean;
  isAuthPending?: boolean;
}

interface TokenInfo {
  name: string;
  symbol: string;
  imageUrl: string | null;
  priceUsd: number | null;
  marketCap: number;
  liquidityUsd: number | null;
  volume24hUsd: number | null;
  priceChange24hPct: number | null;
  dexscreenerUrl: string;
}

const MIN_CHARS = 10;
const MAX_CHARS = 400;

type DexTokenRef = {
  address?: string;
  name?: string;
  symbol?: string;
  icon?: string;
  logoURI?: string;
};

type DexPair = {
  chainId?: string;
  url?: string;
  baseToken?: DexTokenRef;
  quoteToken?: DexTokenRef;
  priceUsd?: string | number;
  marketCap?: string | number;
  fdv?: string | number;
  liquidity?: {
    usd?: string | number;
  };
  volume?: {
    h24?: string | number;
  };
  priceChange?: {
    h24?: string | number;
  };
  info?: {
    imageUrl?: string;
    header?: string;
    openGraph?: string;
  };
};

function normalizeAddress(value: string | null | undefined): string | null {
  if (!value) return null;
  const normalized = value.trim().toLowerCase();
  return normalized || null;
}

function normalizeChain(value: string | null | undefined): string | null {
  if (!value) return null;
  const normalized = value.trim().toLowerCase();
  if (!normalized) return null;
  if (normalized === "eth") return "ethereum";
  if (normalized === "sol") return "solana";
  return normalized;
}

function toFiniteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function pickTokenFromPair(pair: DexPair, address: string): DexTokenRef | null {
  const target = normalizeAddress(address);
  if (target && normalizeAddress(pair.baseToken?.address) === target) return pair.baseToken ?? null;
  if (target && normalizeAddress(pair.quoteToken?.address) === target) return pair.quoteToken ?? null;
  return pair.baseToken ?? pair.quoteToken ?? null;
}

function pickPair(pairs: DexPair[], address: string, chainType: "solana" | "evm"): DexPair | null {
  if (!pairs.length) return null;
  const target = normalizeAddress(address);
  const expectedChain = normalizeChain(chainType === "solana" ? "solana" : "ethereum");
  const ranked = [...pairs].sort((a, b) => {
    const score = (pair: DexPair): number => {
      const baseMatch = normalizeAddress(pair.baseToken?.address) === target;
      const quoteMatch = normalizeAddress(pair.quoteToken?.address) === target;
      const chainMatch = normalizeChain(pair.chainId) === expectedChain;
      let value = 0;
      if (baseMatch && chainMatch) value += 120;
      else if (quoteMatch && chainMatch) value += 95;
      else if (baseMatch) value += 70;
      else if (quoteMatch) value += 50;
      if (chainMatch) value += 20;
      if (pair.url) value += 5;
      return value;
    };

    const scoreDelta = score(b) - score(a);
    if (scoreDelta !== 0) return scoreDelta;
    const liquidityDelta = (toFiniteNumber(b.liquidity?.usd) ?? 0) - (toFiniteNumber(a.liquidity?.usd) ?? 0);
    if (liquidityDelta !== 0) return liquidityDelta;
    return (toFiniteNumber(b.volume?.h24) ?? 0) - (toFiniteNumber(a.volume?.h24) ?? 0);
  });
  return ranked[0] ?? null;
}

function pickImageFromPair(pair: DexPair, token: DexTokenRef | null): string | null {
  const candidates = [
    token?.icon,
    token?.logoURI,
    pair.info?.imageUrl,
    pair.info?.header,
    pair.info?.openGraph,
  ];
  for (const candidate of candidates) {
    const value = candidate?.trim();
    if (value) return value;
  }
  return null;
}

export function CreatePost({
  user,
  onSubmit,
  isSubmitting,
  isAuthPending = false,
}: CreatePostProps) {
  const navigate = useNavigate();
  const [content, setContent] = useState("");
  const [mode, setMode] = useState<ComposerMode>("alpha");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [tokenInfo, setTokenInfo] = useState<TokenInfo | null>(null);
  const [isFetchingToken, setIsFetchingToken] = useState(false);
  const debounceRef = useRef<NodeJS.Timeout | null>(null);

  const isLiquidated = user !== null && user.level <= LIQUIDATION_LEVEL;
  const isComposerDisabled = isSubmitting || isLiquidated || isAuthPending;
  const detected = detectContractAddress(content);
  const charCount = content.length;
  const activeMode = COMPOSER_ACTIONS.find((action) => action.id === mode) ?? COMPOSER_ACTIONS[0];

  // Fetch token info from Dexscreener with debounce
  const fetchTokenInfo = useCallback(async (address: string, chainType: "solana" | "evm") => {
    setIsFetchingToken(true);
    try {
      const chain = chainType === "solana" ? "solana" : "ethereum";
      const endpoints = [
        `https://api.dexscreener.com/tokens/v1/${chain}/${address}`,
        `https://api.dexscreener.com/latest/dex/tokens/${address}`,
      ];

      let bestPair: DexPair | null = null;
      for (const endpoint of endpoints) {
        const response = await fetch(endpoint, { headers: { Accept: "application/json" } });
        if (!response.ok) continue;
        const payload = (await response.json()) as DexPair[] | { pairs?: DexPair[] | null };
        const pairs = Array.isArray(payload) ? payload : (payload?.pairs ?? []);
        const picked = pickPair(pairs, address, chainType);
        if (picked) {
          bestPair = picked;
          break;
        }
      }

      if (!bestPair) {
        setTokenInfo(null);
        return;
      }

      const token = pickTokenFromPair(bestPair, address);
      setTokenInfo({
        name: token?.name || bestPair.baseToken?.name || "Unknown",
        symbol: token?.symbol || bestPair.baseToken?.symbol || "???",
        imageUrl: pickImageFromPair(bestPair, token),
        priceUsd: toFiniteNumber(bestPair.priceUsd),
        marketCap: toFiniteNumber(bestPair.marketCap) ?? toFiniteNumber(bestPair.fdv) ?? 0,
        liquidityUsd: toFiniteNumber(bestPair.liquidity?.usd),
        volume24hUsd: toFiniteNumber(bestPair.volume?.h24),
        priceChange24hPct: toFiniteNumber(bestPair.priceChange?.h24),
        dexscreenerUrl:
          bestPair.url || `https://dexscreener.com/${chainType === "solana" ? "solana" : "ethereum"}/${address}`,
      });
    } catch {
      setTokenInfo(null);
    } finally {
      setIsFetchingToken(false);
    }
  }, []);

  // Debounced token fetch when CA is detected
  useEffect(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }

    if (detected) {
      debounceRef.current = setTimeout(() => {
        fetchTokenInfo(detected.address, detected.chainType);
      }, 500);
    } else {
      setTokenInfo(null);
    }

    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, [detected, fetchTokenInfo]);

  const handleSubmit = async () => {
    if (isLiquidated) {
      toast.error("Account Liquidated: Reputation too low");
      return;
    }

    const trimmedContent = content.trim();
    if (trimmedContent.length < MIN_CHARS) {
      toast.error(`Post must be at least ${MIN_CHARS} characters`);
      return;
    }

    if (trimmedContent.length > MAX_CHARS) {
      toast.error(`Post must be less than ${MAX_CHARS} characters`);
      return;
    }

    const typedContent = stripComposerPrefix(trimmedContent);

    await onSubmit(typedContent || trimmedContent, mode);
    setContent("");
    setTokenInfo(null);
  };

  if (!user) return null;

  return (
    <div
      className={cn(
        "rounded-[24px] border border-white/8 bg-[linear-gradient(180deg,rgba(8,12,18,0.96),rgba(5,8,12,0.98))] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] transition-all sm:p-5",
        isLiquidated && "border-red-600/30 bg-red-950/10"
      )}
    >
      {isLiquidated && (
        <div className="mb-4 flex items-start gap-3 rounded-[18px] border border-red-600/50 bg-red-600/20 p-4">
          <Skull className="mt-0.5 h-6 w-6 shrink-0 text-red-500" />
          <div>
            <p className="text-sm font-bold text-red-500 uppercase tracking-wide">LIQUIDATED</p>
            <p className="mt-1 text-xs text-red-300">
              You are at level -5 (liquidation). You cannot post new alphas until your level improves.
            </p>
          </div>
        </div>
      )}

      <div className="flex gap-3">
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={() => navigate("/profile")}
                className="group relative flex-shrink-0"
              >
                <Avatar className="h-11 w-11 border border-white/10 transition-colors group-hover:border-lime-300/30">
                  <AvatarImage src={getAvatarUrl(user.id, user.image)} />
                  <AvatarFallback className="bg-white/[0.04] text-white/70">
                    {user.name?.charAt(0) || "?"}
                  </AvatarFallback>
                </Avatar>
                <div className="absolute inset-0 flex items-center justify-center bg-black/50 rounded-full opacity-0 group-hover:opacity-100 transition-opacity">
                  <Camera className="h-4 w-4 text-white" />
                </div>
              </button>
            </TooltipTrigger>
            <TooltipContent>
              <p>Edit profile picture</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>

        <div className="flex-1 space-y-3">
          <div className="rounded-[20px] border border-white/8 bg-white/[0.03] px-3 py-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-white/38">
                Composer Modes
              </div>
              <div className="text-[11px] uppercase tracking-[0.16em] text-white/30">
                Text first, token context optional
              </div>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {COMPOSER_ACTIONS.map((action) => (
                <button
                  key={action.label}
                  type="button"
                  onClick={() => setMode(action.id)}
                  className={cn(
                    "rounded-full border px-3 py-1.5 text-xs font-semibold transition",
                    composerToneClass(action, mode === action.id)
                  )}
                >
                  {action.label}
                </button>
              ))}
            </div>
            <div className="mt-2 text-[11px] uppercase tracking-[0.16em] text-white/34">
              Compose a signal, chart thesis, raid update, poll, or plain discussion thread.
            </div>
          </div>

          <textarea
            ref={textareaRef}
            placeholder={
              isLiquidated
                ? "Posting disabled - Account liquidated"
                : isAuthPending
                  ? "Signing you in..."
                  : activeMode.placeholder
            }
            value={content}
            onChange={(e) => !isLiquidated && !isAuthPending && setContent(e.target.value)}
            disabled={isComposerDisabled}
            rows={4}
            className={cn(
              "min-h-[128px] w-full resize-y rounded-[22px] border border-white/8 bg-[linear-gradient(180deg,rgba(11,15,21,0.96),rgba(7,10,14,0.98))] px-4 py-3 text-sm leading-7 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]",
              "placeholder:text-white/32 focus:border-lime-300/20 focus:outline-none focus:ring-2 focus:ring-lime-300/12",
              (isLiquidated || isAuthPending) && "cursor-not-allowed opacity-40 grayscale"
            )}
          />
          {isAuthPending ? (
            <p className="text-xs text-white/44">
              Signing you in...
            </p>
          ) : null}

          {detected && (
            <div className="animate-fade-in-up rounded-[20px] border border-lime-300/14 bg-[linear-gradient(180deg,rgba(169,255,52,0.08),rgba(45,212,191,0.04))] p-3.5">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div className="flex items-center gap-2">
                  <span
                    className={cn(
                      "rounded-md border px-2 py-0.5 text-[10px] font-bold uppercase",
                      detected.chainType === "solana"
                        ? "border-cyan-300/30 bg-cyan-300/12 text-cyan-200"
                        : "border-lime-300/30 bg-lime-300/12 text-lime-200"
                    )}
                  >
                    {detected.chainType}
                  </span>
                  <code className="font-mono text-xs text-white/50">
                    {detected.address.slice(0, 6)}...{detected.address.slice(-4)}
                  </code>
                </div>

                {isFetchingToken ? (
                  <div className="flex items-center gap-2 text-xs text-white/44">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    <span>Fetching token info...</span>
                  </div>
                ) : tokenInfo ? (
                  <a
                    href={tokenInfo.dexscreenerUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-black/20 px-3 py-1.5 text-xs font-semibold text-white/78 transition-colors hover:bg-white/[0.08]"
                  >
                    <ExternalLink className="h-3 w-3" />
                    Dexscreener
                  </a>
                ) : null}
              </div>

              {tokenInfo && !isFetchingToken && (
                <div className="mt-3 animate-fade-in border-t border-white/8 pt-3">
                  <div className="flex items-center gap-2">
                    {tokenInfo.imageUrl ? (
                      <img
                        src={tokenInfo.imageUrl}
                        alt={tokenInfo.symbol}
                        className="h-6 w-6 rounded-full border border-white/10 object-cover"
                        loading="lazy"
                      />
                    ) : null}
                    <span className="text-sm font-semibold text-white">
                      {tokenInfo.symbol}
                    </span>
                    <span className="text-xs text-white/44">
                      {tokenInfo.name}
                    </span>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-white/52">
                    {tokenInfo.priceUsd != null ? (
                      <span>Price: ${tokenInfo.priceUsd.toLocaleString(undefined, { maximumFractionDigits: 8 })}</span>
                    ) : null}
                    {tokenInfo.marketCap > 0 ? <span>MCap: ${tokenInfo.marketCap.toLocaleString()}</span> : null}
                    {tokenInfo.liquidityUsd != null ? <span>Liquidity: ${tokenInfo.liquidityUsd.toLocaleString()}</span> : null}
                    {tokenInfo.volume24hUsd != null ? <span>24h Vol: ${tokenInfo.volume24hUsd.toLocaleString()}</span> : null}
                    {tokenInfo.priceChange24hPct != null ? (
                      <span className={tokenInfo.priceChange24hPct >= 0 ? "text-emerald-300" : "text-rose-300"}>
                        24h: {tokenInfo.priceChange24hPct >= 0 ? "+" : ""}
                        {tokenInfo.priceChange24hPct.toFixed(2)}%
                      </span>
                    ) : null}
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span
                className={cn(
                  "text-xs font-medium transition-colors",
                  charCount < MIN_CHARS
                    ? "text-white/40"
                    : charCount <= MAX_CHARS
                    ? "text-white/74"
                    : "text-rose-300"
                )}
              >
                {charCount}/{MAX_CHARS}
              </span>
              {charCount > 0 && charCount < MIN_CHARS && (
                <span className="text-xs text-white/40">
                  (min {MIN_CHARS})
                </span>
              )}
              {!detected && charCount >= MIN_CHARS ? (
                <span className="text-xs text-white/34">Posting as {activeMode.label.toLowerCase()}</span>
              ) : null}
              {detected && charCount >= MIN_CHARS ? (
                <span className="text-xs text-lime-200/80">Token context attached</span>
              ) : null}
            </div>

            <Button
              onClick={handleSubmit}
              disabled={isComposerDisabled}
              size="sm"
              className={cn(
                "relative overflow-hidden gap-2 rounded-2xl px-4",
                isLiquidated
                  ? "bg-red-900/50 text-red-400 border border-red-600/50 cursor-not-allowed hover:bg-red-900/50"
                  : "border border-lime-300/24 bg-[linear-gradient(135deg,rgba(169,255,52,0.96),rgba(45,212,191,0.9))] text-slate-950 hover:brightness-[1.05]",
                "transition-all duration-200",
                !isLiquidated && "hover:scale-[1.02] active:scale-[0.98]"
              )}
            >
              {isLiquidated ? (
                <>
                  <Lock className="h-4 w-4" />
                  <span>Locked</span>
                </>
              ) : isAuthPending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span>Signing you in...</span>
                </>
              ) : isSubmitting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span>Posting...</span>
                </>
              ) : (
                <>
                  <PhewSendIcon className="h-4 w-4" />
                  <span>{activeMode.submitLabel}</span>
                </>
              )}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
