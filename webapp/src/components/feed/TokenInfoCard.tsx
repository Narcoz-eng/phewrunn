import { useState } from "react";
import { Copy, Check, Coins, ExternalLink, BarChart3 } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

interface TokenInfoCardProps {
  contractAddress: string;
  chainType: string | null;
  tokenName?: string | null;
  tokenSymbol?: string | null;
  tokenImage?: string | null;
  dexscreenerUrl?: string | null;
  className?: string;
}

export function TokenInfoCard({
  contractAddress,
  chainType,
  tokenName,
  tokenSymbol,
  tokenImage,
  dexscreenerUrl,
  className,
}: TokenInfoCardProps) {
  const [copied, setCopied] = useState(false);
  const [imageError, setImageError] = useState(false);

  const handleCopyCA = async () => {
    await navigator.clipboard.writeText(contractAddress);
    setCopied(true);
    toast.success("Contract address copied!");
    setTimeout(() => setCopied(false), 2000);
  };

  const truncatedAddress = `${contractAddress.slice(0, 6)}...${contractAddress.slice(-4)}`;

  const getDexscreenerUrl = () => {
    if (dexscreenerUrl) return dexscreenerUrl;
    const chain = chainType === "solana" ? "solana" : "ethereum";
    return `https://dexscreener.com/${chain}/${contractAddress}`;
  };

  const getPumpFunUrl = () => {
    if (chainType !== "solana") return null;

    const normalizedCa = contractAddress.trim().toLowerCase();
    const sourceUrl = (dexscreenerUrl ?? "").toLowerCase();
    // Pump.fun convention: many Solana meme CAs end with "pump".
    // Keep URL-based fallback when DexScreener explicitly identifies Pump.fun.
    const looksLikePumpFun =
      normalizedCa.endsWith("pump") ||
      sourceUrl.includes("pump.fun") ||
      sourceUrl.includes("pumpfun");

    if (!looksLikePumpFun) return null;
    return `https://pump.fun/coin/${contractAddress}`;
  };

  const pumpFunUrl = getPumpFunUrl();

  // Show placeholder if no image or if image failed to load
  const showPlaceholder = !tokenImage || imageError;

  return (
    <div
      className={cn(
        "p-4 bg-secondary/50 rounded-xl border border-border/50",
        className
      )}
    >
      <div className="flex items-start gap-3">
        {/* Token Image or Placeholder */}
        <div className="flex-shrink-0">
          {tokenImage && !imageError ? (
            <img
              src={tokenImage}
              alt={tokenName || "Token"}
              loading="lazy"
              className="h-12 w-12 rounded-full object-cover border-2 border-border"
              onError={() => setImageError(true)}
            />
          ) : (
            <div className="h-12 w-12 rounded-full bg-gradient-to-br from-primary/20 to-accent/20 border-2 border-border flex items-center justify-center">
              <Coins className="h-6 w-6 text-primary" />
            </div>
          )}
        </div>

        {/* Token Info */}
        <div className="flex-1 min-w-0">
          {/* Token Name and Symbol */}
          <div className="flex items-center gap-2 flex-wrap">
            {tokenName || tokenSymbol ? (
              <>
                <span className="font-semibold text-foreground text-lg truncate">
                  {tokenName || "Unknown Token"}
                </span>
                {tokenSymbol && (
                  <span className="text-sm font-medium text-muted-foreground">
                    (${tokenSymbol})
                  </span>
                )}
              </>
            ) : (
              <span className="font-semibold text-foreground text-lg truncate max-w-[200px]" title={contractAddress}>
                {truncatedAddress}
              </span>
            )}
          </div>

          {/* Contract Address Row - only show if we have token name */}
          {(tokenName || tokenSymbol) && (
            <div className="flex items-center gap-2 mt-1.5">
              <code className="text-xs text-muted-foreground font-mono bg-background/50 px-2 py-1 rounded">
                {truncatedAddress}
              </code>
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      onClick={handleCopyCA}
                      className={cn(
                        "p-1.5 rounded-md transition-all font-medium",
                        "bg-primary/10 hover:bg-primary/20 border border-primary/30",
                        "text-primary hover:text-primary",
                        copied && "bg-gain/20 border-gain/40 text-gain"
                      )}
                    >
                      {copied ? (
                        <Check className="h-3.5 w-3.5" />
                      ) : (
                        <Copy className="h-3.5 w-3.5" />
                      )}
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>{copied ? "Copied!" : "Copy CA"}</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
          )}

          {/* Copy button for when no token name (show inline) */}
          {!tokenName && !tokenSymbol && (
            <div className="flex items-center gap-2 mt-1.5">
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      onClick={handleCopyCA}
                      className={cn(
                        "p-1.5 rounded-md transition-all font-medium",
                        "bg-primary/10 hover:bg-primary/20 border border-primary/30",
                        "text-primary hover:text-primary",
                        copied && "bg-gain/20 border-gain/40 text-gain"
                      )}
                    >
                      {copied ? (
                        <Check className="h-3.5 w-3.5" />
                      ) : (
                        <Copy className="h-3.5 w-3.5" />
                      )}
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>{copied ? "Copied!" : "Copy CA"}</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
              <span className="text-xs text-muted-foreground">Copy Address</span>
            </div>
          )}

          {/* Chain Badge */}
          <div className="flex items-center gap-2 mt-2">
            <span
              className={cn(
                "text-[10px] font-bold uppercase px-2 py-0.5 rounded-md border",
                chainType === "solana"
                  ? "bg-accent/15 text-accent border-accent/30 dark:bg-accent/20 dark:border-accent/40"
                  : "bg-primary/15 text-primary border-primary/30 dark:bg-primary/20 dark:border-primary/40"
              )}
            >
              {chainType || "Unknown"}
            </span>
            {/* Dexscreener Link */}
            <a
              href={getDexscreenerUrl()}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-medium text-primary bg-primary/10 hover:bg-primary/20 rounded-md border border-primary/20 transition-colors"
            >
              <BarChart3 className="h-3 w-3" />
              Chart
              <ExternalLink className="h-2.5 w-2.5" />
            </a>
            {pumpFunUrl && (
              <a
                href={pumpFunUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-medium text-white bg-green-600 hover:bg-green-500 rounded-md border border-green-500/80 transition-colors"
              >
                <Coins className="h-3 w-3" />
                Trade on Pump
                <ExternalLink className="h-2.5 w-2.5" />
              </a>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
