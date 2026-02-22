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

interface CreatePostProps {
  user: User | null;
  onSubmit: (content: string) => Promise<void>;
  isSubmitting: boolean;
}

interface TokenInfo {
  name: string;
  symbol: string;
  priceUsd: string;
  marketCap: number;
  dexscreenerUrl: string;
}

const MIN_CHARS = 10;
const MAX_CHARS = 400;

export function CreatePost({ user, onSubmit, isSubmitting }: CreatePostProps) {
  const navigate = useNavigate();
  const [content, setContent] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [tokenInfo, setTokenInfo] = useState<TokenInfo | null>(null);
  const [isFetchingToken, setIsFetchingToken] = useState(false);
  const debounceRef = useRef<NodeJS.Timeout | null>(null);

  const isLiquidated = user !== null && user.level <= LIQUIDATION_LEVEL;
  const detected = detectContractAddress(content);
  const charCount = content.length;

  // Fetch token info from Dexscreener with debounce
  const fetchTokenInfo = useCallback(async (address: string, chainType: "solana" | "evm") => {
    setIsFetchingToken(true);
    try {
      const response = await fetch(
        `https://api.dexscreener.com/latest/dex/tokens/${address}`
      );
      if (!response.ok) throw new Error("Failed to fetch");

      const data = await response.json();
      if (data.pairs && data.pairs.length > 0) {
        const pair = data.pairs[0];
        setTokenInfo({
          name: pair.baseToken?.name || "Unknown",
          symbol: pair.baseToken?.symbol || "???",
          priceUsd: pair.priceUsd || "N/A",
          marketCap: pair.marketCap || 0,
          dexscreenerUrl: pair.url || `https://dexscreener.com/${chainType === "solana" ? "solana" : "ethereum"}/${address}`,
        });
      } else {
        setTokenInfo(null);
      }
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
      "bg-card border border-border rounded-xl p-4 transition-all",
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
            placeholder={isLiquidated ? "Posting disabled - Account liquidated" : "Drop your alpha... (paste a contract address)"}
            value={content}
            onChange={(e) => !isLiquidated && setContent(e.target.value)}
            disabled={isSubmitting || isLiquidated}
            rows={3}
            className={cn(
              "w-full min-h-[80px] max-h-[200px] resize-y bg-background border border-border rounded-lg px-3 py-2",
              "focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary",
              "placeholder:text-muted-foreground/60 text-foreground leading-relaxed",
              isLiquidated && "opacity-40 cursor-not-allowed bg-muted/50 grayscale"
            )}
          />

          {/* Token Preview */}
          {detected && (
            <div className="p-3 bg-secondary/50 rounded-lg border border-border/50 animate-fade-in-up">
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
                    className="inline-flex items-center gap-1.5 px-2 py-1 text-xs font-medium text-primary bg-primary/10 hover:bg-primary/20 rounded-md border border-primary/20 transition-colors"
                  >
                    <ExternalLink className="h-3 w-3" />
                    Dexscreener
                  </a>
                ) : null}
              </div>

              {/* Token Details */}
              {tokenInfo && !isFetchingToken && (
                <div className="mt-2 pt-2 border-t border-border/50 animate-fade-in">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-foreground">
                      {tokenInfo.symbol}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {tokenInfo.name}
                    </span>
                  </div>
                  {tokenInfo.marketCap > 0 && (
                    <p className="text-xs text-muted-foreground mt-1">
                      Market Cap: ${tokenInfo.marketCap.toLocaleString()}
                    </p>
                  )}
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
              disabled={isSubmitting || isLiquidated}
              size="sm"
              className={cn(
                "gap-2 relative overflow-hidden",
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
              ) : isSubmitting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span>Posting...</span>
                </>
              ) : (
                <>
                  <Send className="h-4 w-4" />
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
