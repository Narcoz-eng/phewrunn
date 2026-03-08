import { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Send, AlertTriangle, Loader2, ExternalLink, Camera, Lock, Skull } from "lucide-react";
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

interface CreatePostProps {
  user: User | null;
  onSubmit: (content: string) => Promise<void>;
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
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [tokenInfo, setTokenInfo] = useState<TokenInfo | null>(null);
  const [isFetchingToken, setIsFetchingToken] = useState(false);
  const debounceRef = useRef<NodeJS.Timeout | null>(null);

  const isLiquidated = user !== null && user.level <= LIQUIDATION_LEVEL;
  const isComposerDisabled = isSubmitting || isLiquidated || isAuthPending;
  const detected = detectContractAddress(content);
  const charCount = content.length;

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
  }, [detected?.address, detected?.chainType, fetchTokenInfo]);

  const handleSubmit = async () => {
    // Check liquidation
    if (isLiquidated) {
      toast.error("Account Liquidated: Reputation too low");
      return;
    }

    // Validate content
    const trimmedContent = content.trim();

    if (trimmedContent.length < MIN_CHARS) {
      toast.error(`Post must be at least ${MIN_CHARS} characters`);
      return;
    }

    if (trimmedContent.length > MAX_CHARS) {
      toast.error(`Post must be less than ${MAX_CHARS} characters`);
      return;
    }

    // Validate CA presence
    const caDetected = detectContractAddress(trimmedContent);
    if (!caDetected) {
      toast.error("Post must contain a valid contract address");
      return;
    }

    // Submit
    await onSubmit(trimmedContent);
    setContent("");
    setTokenInfo(null);
  };

  if (!user) return null;

  return (
    <div className={cn(
      "app-surface p-4 sm:p-5 transition-all",
      isLiquidated && "border-red-600/30 bg-red-950/10"
    )}>
      {/* Liquidation Warning - Enhanced */}
      {isLiquidated && (
        <div className="mb-4 p-4 bg-red-600/20 border border-red-600 rounded-lg flex items-start gap-3 animate-pulse">
          <Skull className="h-6 w-6 text-red-500 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-bold text-red-500 uppercase tracking-wide">LIQUIDATED</p>
            <p className="text-xs text-red-300 mt-1">
              You are at level -5 (liquidation). You cannot post new alphas until your level improves.
            </p>
          </div>
        </div>
      )}

      <div className="flex gap-3">
        {/* Clickable Avatar - navigates to profile for editing */}
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={() => navigate("/profile")}
                className="relative group flex-shrink-0"
              >
                <Avatar className="h-10 w-10 border border-border group-hover:border-primary/50 transition-colors">
                  <AvatarImage src={getAvatarUrl(user.id, user.image)} />
                  <AvatarFallback className="bg-muted text-muted-foreground">
                    {user.name?.charAt(0) || "?"}
                  </AvatarFallback>
                </Avatar>
                {/* Camera overlay on hover */}
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
          <textarea
            ref={textareaRef}
            placeholder={
              isLiquidated
                ? "Posting disabled - Account liquidated"
                : isAuthPending
                  ? "Signing you in..."
                  : "Drop your alpha... (paste a contract address)"
            }
            value={content}
            onChange={(e) => !isLiquidated && !isAuthPending && setContent(e.target.value)}
            disabled={isComposerDisabled}
            rows={3}
            className={cn(
              "w-full min-h-[96px] max-h-[220px] resize-y rounded-[22px] border border-border/70 bg-[linear-gradient(180deg,hsl(0_0%_100%/0.92),hsl(38_32%_94%/0.88))] px-4 py-3 shadow-[inset_0_1px_0_hsl(0_0%_100%/0.84),0_18px_34px_-28px_hsl(var(--foreground)/0.12)]",
              "focus:outline-none focus:ring-2 focus:ring-primary/45 focus:border-primary/45",
              "placeholder:text-muted-foreground/60 text-foreground leading-relaxed",
              "dark:bg-[linear-gradient(180deg,rgba(13,15,21,0.92),rgba(8,10,14,0.96))] dark:shadow-none",
              (isLiquidated || isAuthPending) && "opacity-40 cursor-not-allowed bg-muted/50 grayscale"
            )}
          />
          {isAuthPending ? (
            <p className="text-xs text-muted-foreground">
              Signing you in...
            </p>
          ) : null}

          {/* Token Preview */}
          {detected && (
            <div className="app-surface-soft animate-fade-in-up p-3.5">
              <div className="flex items-center justify-between flex-wrap gap-2">
                {/* Chain Badge & Address */}
                <div className="flex items-center gap-2">
                  <span
                    className={cn(
                      "text-[10px] font-bold uppercase px-2 py-0.5 rounded-md border",
                      detected.chainType === "solana"
                        ? "bg-accent/15 text-accent border-accent/30 dark:bg-accent/20 dark:border-accent/40"
                        : "bg-primary/15 text-primary border-primary/30 dark:bg-primary/20 dark:border-primary/40"
                    )}
                  >
                    {detected.chainType}
                  </span>
                  <code className="text-xs text-muted-foreground font-mono">
                    {detected.address.slice(0, 6)}...{detected.address.slice(-4)}
                  </code>
                </div>

                {/* Token Info or Loading */}
                {isFetchingToken ? (
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    <span>Fetching token info...</span>
                  </div>
                ) : tokenInfo ? (
                  <a
                    href={tokenInfo.dexscreenerUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 rounded-full border border-primary/20 bg-primary/10 px-3 py-1.5 text-xs font-semibold text-primary transition-colors hover:bg-primary/15"
                  >
                    <ExternalLink className="h-3 w-3" />
                    Dexscreener
                  </a>
                ) : null}
              </div>

              {/* Token Details */}
              {tokenInfo && !isFetchingToken && (
                <div className="mt-3 border-t border-border/50 pt-3 animate-fade-in">
                  <div className="flex items-center gap-2">
                    {tokenInfo.imageUrl ? (
                      <img
                        src={tokenInfo.imageUrl}
                        alt={tokenInfo.symbol}
                        className="h-6 w-6 rounded-full border border-border/60 object-cover"
                        loading="lazy"
                      />
                    ) : null}
                    <span className="text-sm font-semibold text-foreground">
                      {tokenInfo.symbol}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {tokenInfo.name}
                    </span>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                    {tokenInfo.priceUsd != null ? (
                      <span>Price: ${tokenInfo.priceUsd.toLocaleString(undefined, { maximumFractionDigits: 8 })}</span>
                    ) : null}
                    {tokenInfo.marketCap > 0 ? <span>MCap: ${tokenInfo.marketCap.toLocaleString()}</span> : null}
                    {tokenInfo.liquidityUsd != null ? <span>Liquidity: ${tokenInfo.liquidityUsd.toLocaleString()}</span> : null}
                    {tokenInfo.volume24hUsd != null ? <span>24h Vol: ${tokenInfo.volume24hUsd.toLocaleString()}</span> : null}
                    {tokenInfo.priceChange24hPct != null ? (
                      <span className={tokenInfo.priceChange24hPct >= 0 ? "text-gain" : "text-loss"}>
                        24h: {tokenInfo.priceChange24hPct >= 0 ? "+" : ""}
                        {tokenInfo.priceChange24hPct.toFixed(2)}%
                      </span>
                    ) : null}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Footer */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              {/* Character count with color coding */}
              <span
                className={cn(
                  "text-xs font-medium transition-colors",
                  charCount < MIN_CHARS
                    ? "text-muted-foreground"
                    : charCount <= MAX_CHARS
                    ? "text-foreground"
                    : "text-destructive"
                )}
              >
                {charCount}/{MAX_CHARS}
              </span>
              {charCount > 0 && charCount < MIN_CHARS && (
                <span className="text-xs text-muted-foreground">
                  (min {MIN_CHARS})
                </span>
              )}
            </div>

            <Button
              onClick={handleSubmit}
              disabled={isComposerDisabled}
              size="sm"
              className={cn(
                "relative overflow-hidden gap-2 rounded-2xl px-4",
                isLiquidated
                  ? "bg-red-900/50 text-red-400 border border-red-600/50 cursor-not-allowed hover:bg-red-900/50"
                  : "bg-primary hover:bg-primary/90 text-primary-foreground",
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
                  <span>Post</span>
                </>
              )}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
