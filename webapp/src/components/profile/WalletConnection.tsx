import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { WalletSelector } from "./WalletSelector";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  Wallet,
  Copy,
  Check,
  Unplug,
  Ghost,
  Sun,
  Calendar,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";

// Wallet status type from backend
interface WalletStatus {
  connected: boolean;
  address?: string | null;
  provider?: string | null;
  connectedAt?: string | null;
}

// Truncate wallet address for display
function truncateAddress(address: string): string {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

// Get provider display info
function getProviderInfo(provider: string | null | undefined) {
  switch (provider) {
    case "phantom":
      return { name: "Phantom", icon: Ghost, color: "text-purple-500" };
    case "solflare":
      return { name: "Solflare", icon: Sun, color: "text-orange-500" };
    default:
      return { name: "Wallet", icon: Wallet, color: "text-primary" };
  }
}

// Format connected date
function formatConnectedDate(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

interface WalletConnectionProps {
  className?: string;
}

export function WalletConnection({ className }: WalletConnectionProps) {
  const queryClient = useQueryClient();
  const [selectorOpen, setSelectorOpen] = useState(false);
  const [disconnectOpen, setDisconnectOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  // Fetch wallet status
  const {
    data: walletStatus,
    isLoading,
    error,
  } = useQuery({
    queryKey: ["wallet-status"],
    queryFn: () => api.get<WalletStatus>("/api/users/me/wallet"),
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    retry: 1,
  });

  // Connect wallet mutation
  const connectMutation = useMutation({
    mutationFn: (data: { walletAddress: string; walletProvider: string; signature?: string }) =>
      api.post("/api/users/me/wallet", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["wallet-status"] });
      queryClient.invalidateQueries({ queryKey: ["profile", "me"] });
      setSelectorOpen(false);
      toast.success("Wallet connected successfully!");
    },
    onError: (error: Error) => {
      toast.error(error.message || "Failed to connect wallet");
    },
  });

  // Disconnect wallet mutation
  const disconnectMutation = useMutation({
    mutationFn: () => api.delete("/api/users/me/wallet"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["wallet-status"] });
      queryClient.invalidateQueries({ queryKey: ["profile", "me"] });
      setDisconnectOpen(false);
      toast.success("Wallet disconnected");
    },
    onError: (error: Error) => {
      toast.error(error.message || "Failed to disconnect wallet");
    },
  });

  // Copy address to clipboard
  const handleCopyAddress = async () => {
    if (!walletStatus?.address) return;
    try {
      await navigator.clipboard.writeText(walletStatus.address);
      setCopied(true);
      toast.success("Address copied to clipboard");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Failed to copy address");
    }
  };

  // Handle connect - supports signature verification
  const handleConnect = (address: string, provider: string, signature?: string) => {
    connectMutation.mutate({ walletAddress: address, walletProvider: provider, signature });
  };

  if (isLoading) {
    return (
      <Card className={className}>
        <CardHeader>
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-4 w-64 mt-1" />
        </CardHeader>
        <CardContent>
          <Skeleton className="h-12 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card className={className}>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Wallet className="h-5 w-5" />
            Wallet Connection
          </CardTitle>
          <CardDescription>
            Connect your crypto wallet for enhanced features
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-destructive">
            Failed to load wallet status. Please try again.
          </p>
        </CardContent>
      </Card>
    );
  }

  const isConnected = walletStatus?.connected && walletStatus?.address;
  const providerInfo = getProviderInfo(walletStatus?.provider);
  const ProviderIcon = providerInfo.icon;

  return (
    <>
      <Card className={cn("overflow-hidden", className)}>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Wallet className="h-5 w-5" />
            Wallet Connection
          </CardTitle>
          <CardDescription>
            Connect your crypto wallet for enhanced features
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isConnected ? (
            // Connected State
            <div className="space-y-4">
              {/* Wallet Info */}
              <div className="p-4 bg-secondary/50 rounded-lg border border-border/50">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-background flex items-center justify-center border border-border">
                      <ProviderIcon className={cn("h-5 w-5", providerInfo.color)} />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-sm font-medium">
                          {truncateAddress(walletStatus.address!)}
                        </span>
                        <Badge variant="secondary" className="text-xs">
                          {providerInfo.name}
                        </Badge>
                      </div>
                      {walletStatus.connectedAt && (
                        <div className="flex items-center gap-1.5 mt-1 text-xs text-muted-foreground">
                          <Calendar className="h-3 w-3" />
                          Connected {formatConnectedDate(walletStatus.connectedAt)}
                        </div>
                      )}
                    </div>
                  </div>
                  <Badge variant="outline" className="bg-gain/10 text-gain border-gain/30">
                    Connected
                  </Badge>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleCopyAddress}
                  className="gap-1.5"
                >
                  {copied ? (
                    <>
                      <Check className="h-3.5 w-3.5" />
                      Copied
                    </>
                  ) : (
                    <>
                      <Copy className="h-3.5 w-3.5" />
                      Copy Address
                    </>
                  )}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setDisconnectOpen(true)}
                  className="gap-1.5 text-destructive hover:text-destructive hover:bg-destructive/10"
                >
                  <Unplug className="h-3.5 w-3.5" />
                  Disconnect
                </Button>
              </div>
            </div>
          ) : (
            // Not Connected State
            <div className="space-y-4">
              <div className="p-4 bg-secondary/30 rounded-lg border border-dashed border-border text-center">
                <div className="w-12 h-12 rounded-full bg-muted mx-auto flex items-center justify-center mb-3">
                  <Wallet className="h-6 w-6 text-muted-foreground" />
                </div>
                <p className="text-sm text-muted-foreground mb-1">
                  No wallet connected
                </p>
                <p className="text-xs text-muted-foreground">
                  Connect your Phantom or Solflare wallet
                </p>
              </div>

              <Button
                onClick={() => setSelectorOpen(true)}
                className="w-full gap-2"
              >
                <Wallet className="h-4 w-4" />
                Connect Wallet
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Wallet Selector Dialog */}
      <WalletSelector
        open={selectorOpen}
        onOpenChange={setSelectorOpen}
        onConnect={handleConnect}
        isConnecting={connectMutation.isPending}
      />

      {/* Disconnect Confirmation Dialog */}
      <AlertDialog open={disconnectOpen} onOpenChange={setDisconnectOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Disconnect Wallet?</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to disconnect your wallet? You can reconnect
              it at any time.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={disconnectMutation.isPending}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                disconnectMutation.mutate();
              }}
              disabled={disconnectMutation.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {disconnectMutation.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Disconnecting...
                </>
              ) : (
                "Disconnect"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
