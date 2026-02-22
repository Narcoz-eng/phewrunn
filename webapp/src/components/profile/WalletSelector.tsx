import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { Wallet, Ghost, Sun, Loader2, AlertTriangle } from "lucide-react";

// Wallet provider options
const WALLET_PROVIDERS = [
  {
    id: "phantom",
    name: "Phantom",
    description: "Enter Phantom wallet address",
    icon: Ghost,
    iconBg: "bg-purple-500/10",
    iconColor: "text-purple-500",
  },
  {
    id: "solflare",
    name: "Solflare",
    description: "Enter Solflare wallet address",
    icon: Sun,
    iconBg: "bg-orange-500/10",
    iconColor: "text-orange-500",
  },
  {
    id: "manual",
    name: "Other Wallet",
    description: "Enter any wallet address",
    icon: Wallet,
    iconBg: "bg-muted",
    iconColor: "text-muted-foreground",
  },
] as const;

type WalletProviderId = typeof WALLET_PROVIDERS[number]["id"];

interface WalletSelectorProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConnect: (address: string, provider: string, signature?: string) => void;
  isConnecting: boolean;
}

// Validate Solana or EVM address format
function validateWalletAddress(address: string): { valid: boolean; type: "solana" | "evm" | null } {
  // Solana: Base58, 32-44 chars
  const solanaRegex = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
  // EVM: 0x prefix + 40 hex chars
  const evmRegex = /^0x[a-fA-F0-9]{40}$/;

  if (solanaRegex.test(address)) {
    return { valid: true, type: "solana" };
  }
  if (evmRegex.test(address)) {
    return { valid: true, type: "evm" };
  }
  return { valid: false, type: null };
}

export function WalletSelector({
  open,
  onOpenChange,
  onConnect,
  isConnecting,
}: WalletSelectorProps) {
  const [selectedProvider, setSelectedProvider] = useState<WalletProviderId | null>(null);
  const [walletAddress, setWalletAddress] = useState("");
  const [addressError, setAddressError] = useState<string | null>(null);

  // Reset state when dialog opens
  useEffect(() => {
    if (open) {
      setSelectedProvider(null);
      setWalletAddress("");
      setAddressError(null);
    }
  }, [open]);

  const handleProviderSelect = (providerId: WalletProviderId) => {
    setSelectedProvider(providerId);
    setWalletAddress("");
    setAddressError(null);
  };

  const handleAddressChange = (value: string) => {
    setWalletAddress(value.trim());
    if (value.trim()) {
      const validation = validateWalletAddress(value.trim());
      if (!validation.valid) {
        setAddressError("Invalid wallet address format");
      } else {
        setAddressError(null);
      }
    } else {
      setAddressError(null);
    }
  };

  const handleConnect = () => {
    if (!walletAddress || !selectedProvider) return;

    const validation = validateWalletAddress(walletAddress);
    if (!validation.valid) {
      setAddressError("Invalid wallet address format");
      return;
    }

    onConnect(walletAddress, selectedProvider);
  };

  const handleClose = () => {
    setSelectedProvider(null);
    setWalletAddress("");
    setAddressError(null);
    onOpenChange(false);
  };

  const isValid = selectedProvider && walletAddress && !addressError;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Wallet className="h-5 w-5" />
            Connect Wallet
          </DialogTitle>
          <DialogDescription>
            Select your wallet type and enter your address.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Provider Selection */}
          <div className="space-y-2">
            <Label>Select Wallet Type</Label>
            <div className="grid gap-2">
              {WALLET_PROVIDERS.map((provider) => {
                const Icon = provider.icon;
                const isSelected = selectedProvider === provider.id;
                return (
                  <button
                    key={provider.id}
                    type="button"
                    onClick={() => handleProviderSelect(provider.id)}
                    disabled={isConnecting}
                    className={cn(
                      "flex items-center gap-3 p-3 rounded-lg border transition-all",
                      "hover:border-primary/50 hover:bg-secondary/50",
                      "disabled:opacity-50 disabled:cursor-not-allowed",
                      isSelected
                        ? "border-primary bg-primary/5"
                        : "border-border bg-background"
                    )}
                  >
                    <div
                      className={cn(
                        "flex items-center justify-center w-10 h-10 rounded-lg",
                        provider.iconBg
                      )}
                    >
                      <Icon className={cn("h-5 w-5", provider.iconColor)} />
                    </div>
                    <div className="flex-1 text-left">
                      <p className="font-medium text-sm">{provider.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {provider.description}
                      </p>
                    </div>
                    <div
                      className={cn(
                        "w-4 h-4 rounded-full border-2 transition-colors",
                        isSelected
                          ? "border-primary bg-primary"
                          : "border-muted-foreground/30"
                      )}
                    />
                  </button>
                );
              })}
            </div>
          </div>

          {/* Address Input (shown when provider selected) */}
          {selectedProvider && (
            <div className="space-y-2 animate-fade-in">
              <Label htmlFor="wallet-address">Wallet Address</Label>
              <Input
                id="wallet-address"
                placeholder="Enter your wallet address..."
                value={walletAddress}
                onChange={(e) => handleAddressChange(e.target.value)}
                className={cn(
                  "font-mono text-sm",
                  addressError && "border-destructive focus-visible:ring-destructive"
                )}
              />
              {addressError ? (
                <p className="text-xs text-destructive">{addressError}</p>
              ) : (
                <p className="text-xs text-muted-foreground flex items-center gap-1">
                  <AlertTriangle className="h-3 w-3" />
                  Supports Solana and EVM addresses
                </p>
              )}
            </div>
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={handleClose} disabled={isConnecting}>
            Cancel
          </Button>
          <Button
            onClick={handleConnect}
            disabled={!isValid || isConnecting}
          >
            {isConnecting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Connecting...
              </>
            ) : (
              "Connect Wallet"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
