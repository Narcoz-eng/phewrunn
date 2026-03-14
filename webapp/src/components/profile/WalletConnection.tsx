import { useCallback, useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useWallet } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import bs58 from "bs58";
import { api, ApiError } from "@/lib/api";
import { updateCachedAuthUser, useAuth, useSession } from "@/lib/auth-client";
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
  ShieldCheck,
  AlertTriangle,
  Link2,
} from "lucide-react";
import { toast } from "sonner";

interface WalletStatus {
  connected: boolean;
  address?: string | null;
  provider?: string | null;
  connectedAt?: string | null;
}

interface WalletMutationResponse {
  walletAddress?: string | null;
  walletProvider?: string | null;
}

type WalletProviderId = "phantom" | "solflare" | "other";

function truncateAddress(address: string): string {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

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

function formatConnectedDate(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function detectProviderId(adapterName: string | null | undefined): WalletProviderId {
  const lower = (adapterName || "").toLowerCase();
  if (lower.includes("phantom")) return "phantom";
  if (lower.includes("solflare")) return "solflare";
  return "other";
}

function buildWalletLinkMessage(userId: string, walletAddress: string) {
  return [
    "Phew.run Wallet Link",
    "Confirm this signature to verify wallet ownership and link it to your profile.",
    `Wallet: ${walletAddress}`,
    `User: ${userId}`,
    `Timestamp: ${new Date().toISOString()}`,
  ].join("\n");
}

interface WalletConnectionProps {
  className?: string;
  deferMs?: number;
}

export function WalletConnection({ className, deferMs = 0 }: WalletConnectionProps) {
  const queryClient = useQueryClient();
  const { data: session } = useSession();
  const { canPerformAuthenticatedWrites } = useAuth();
  const hasSessionUser = Boolean(session?.user?.id);
  const [disconnectOpen, setDisconnectOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);
  const [autoLinkAttemptedFor, setAutoLinkAttemptedFor] = useState<string | null>(null);
  const [delayReady, setDelayReady] = useState(deferMs <= 0);
  const walletStatusQueryKey = ["wallet-status", session?.user?.id ?? "anonymous"] as const;

  const {
    connected: adapterConnected,
    connecting: adapterConnecting,
    publicKey,
    wallet: adapterWallet,
    signMessage,
    disconnect: disconnectAdapter,
  } = useWallet();

  const adapterWalletAddress = publicKey?.toBase58() ?? null;
  const adapterProviderId = detectProviderId(adapterWallet?.adapter.name);

  useEffect(() => {
    if (deferMs <= 0) {
      setDelayReady(true);
      return;
    }
    setDelayReady(false);
    const timer = window.setTimeout(() => setDelayReady(true), deferMs);
    return () => window.clearTimeout(timer);
  }, [deferMs, session?.user?.id]);

  const {
    data: walletStatus,
    isLoading,
    error,
  } = useQuery({
    queryKey: walletStatusQueryKey,
    queryFn: async () => {
      const sessionFallback =
        session?.user
          ? ({
              connected: Boolean(session.user.walletAddress),
              address: session.user.walletAddress ?? null,
              provider: session.user.walletProvider ?? null,
              connectedAt: null,
            } satisfies WalletStatus)
          : null;
      try {
        return await api.get<WalletStatus>("/api/users/me/wallet");
      } catch (error) {
        if (sessionFallback) {
          if (!(error instanceof ApiError) || error.status === 401 || error.status === 403 || error.status >= 500) {
            return sessionFallback;
          }
        }
        throw error;
      }
    },
    enabled: !!session?.user && canPerformAuthenticatedWrites && delayReady,
    staleTime: 60_000,
    refetchOnMount: "always",
    refetchOnWindowFocus: false,
    retry: (failureCount, error) => {
      if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
        return failureCount < 2;
      }
      return failureCount < 1;
    },
  });
  const isLinked = Boolean(walletStatus?.connected && walletStatus?.address);

  const connectMutation = useMutation({
    mutationFn: (data: {
      walletAddress: string;
      walletProvider: WalletProviderId;
      signature: string;
      message: string;
    }) => api.post<WalletMutationResponse>("/api/users/me/wallet", data),
    onSuccess: (updatedUser) => {
      updateCachedAuthUser({
        walletAddress: updatedUser.walletAddress ?? null,
        walletProvider: updatedUser.walletProvider ?? null,
      });
      queryClient.invalidateQueries({ queryKey: walletStatusQueryKey });
      queryClient.invalidateQueries({ queryKey: ["profile", "me"] });
      queryClient.invalidateQueries({ queryKey: ["currentUser"] });
      toast.success("Wallet verified and linked");
    },
    onError: (error: Error) => {
      toast.error(error.message || "Failed to verify wallet");
    },
  });

  const disconnectMutation = useMutation({
    mutationFn: () => api.delete<WalletMutationResponse>("/api/users/me/wallet"),
    onSuccess: () => {
      updateCachedAuthUser({
        walletAddress: null,
        walletProvider: null,
      });
      queryClient.invalidateQueries({ queryKey: walletStatusQueryKey });
      queryClient.invalidateQueries({ queryKey: ["profile", "me"] });
      queryClient.invalidateQueries({ queryKey: ["currentUser"] });
      setDisconnectOpen(false);
      toast.success("Wallet disconnected");
    },
    onError: (error: Error) => {
      toast.error(error.message || "Failed to disconnect wallet");
    },
  });

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

  const handleVerifyAndLink = useCallback(async (options?: { silent?: boolean }) => {
    if (!canPerformAuthenticatedWrites) {
      if (!options?.silent) {
        toast.warning(hasSessionUser ? "Signing you in..." : "Sign in to link a wallet.");
      }
      return;
    }
    if (!adapterConnected || !adapterWalletAddress) {
      if (!options?.silent) {
        toast.error("Connect a Solana wallet first");
      }
      return;
    }
    if (!signMessage) {
      if (!options?.silent) {
        toast.error("This wallet does not support message signing");
      }
      return;
    }

    try {
      setIsVerifying(true);
      const sessionUserId = session?.user?.id;
      if (!sessionUserId) {
        throw new Error("Your session is still loading. Please try again.");
      }
      const message = buildWalletLinkMessage(sessionUserId, adapterWalletAddress);
      const signatureBytes = await signMessage(new TextEncoder().encode(message));
      const signature = bs58.encode(signatureBytes);

      await connectMutation.mutateAsync({
        walletAddress: adapterWalletAddress,
        walletProvider: adapterProviderId,
        signature,
        message,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Wallet verification failed";
      if (!options?.silent) {
        toast.error(message);
      }
    } finally {
      setIsVerifying(false);
    }
  }, [adapterConnected, adapterProviderId, adapterWalletAddress, canPerformAuthenticatedWrites, connectMutation, hasSessionUser, session?.user?.id, signMessage]);

  useEffect(() => {
    if (!adapterConnected || !adapterWalletAddress || isLinked) return;
    if (adapterConnecting || isVerifying || connectMutation.isPending) return;
    if (!signMessage) return;

    const normalizedWallet = adapterWalletAddress.toLowerCase();
    if (autoLinkAttemptedFor === normalizedWallet) return;

    setAutoLinkAttemptedFor(normalizedWallet);
    void handleVerifyAndLink({ silent: true });
  }, [
    adapterConnected,
    adapterWalletAddress,
    adapterConnecting,
    autoLinkAttemptedFor,
    connectMutation.isPending,
    isLinked,
    isVerifying,
    signMessage,
    handleVerifyAndLink,
  ]);

  if (!session?.user || isLoading || !canPerformAuthenticatedWrites) {
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
            Wallet Verification
          </CardTitle>
          <CardDescription>
            Connect and verify your Solana wallet
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

  const providerInfo = getProviderInfo(walletStatus?.provider);
  const ProviderIcon = providerInfo.icon;
  const adapterMatchesLinkedWallet =
    Boolean(isLinked && adapterWalletAddress && walletStatus?.address) &&
    walletStatus!.address!.toLowerCase() === adapterWalletAddress!.toLowerCase();

  return (
    <>
      <Card className={cn("overflow-hidden", className)}>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Wallet className="h-5 w-5" />
            Wallet Verification
          </CardTitle>
          <CardDescription>
            Link a real Solana wallet by signing a verification message
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLinked ? (
            <div className="space-y-4">
              <div className="p-4 bg-secondary/50 rounded-lg border border-border/50">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-background flex items-center justify-center border border-border">
                      <ProviderIcon className={cn("h-5 w-5", providerInfo.color)} />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-sm font-medium">
                          {truncateAddress(walletStatus!.address!)}
                        </span>
                        <Badge variant="secondary" className="text-xs">
                          {providerInfo.name}
                        </Badge>
                      </div>
                      {walletStatus?.connectedAt ? (
                        <div className="flex items-center gap-1.5 mt-1 text-xs text-muted-foreground">
                          <Calendar className="h-3 w-3" />
                          Linked {formatConnectedDate(walletStatus.connectedAt)}
                        </div>
                      ) : null}
                    </div>
                  </div>
                  <Badge variant="outline" className="bg-gain/10 text-gain border-gain/30">
                    Verified
                  </Badge>
                </div>
              </div>

              <div className="space-y-3">
                <div className="wallet-adapter-button-wrap [&_.wallet-adapter-button]:w-full [&_.wallet-adapter-button]:justify-center [&_.wallet-adapter-button]:rounded-md [&_.wallet-adapter-button]:h-10">
                  <WalletMultiButton />
                </div>

                {adapterConnected && adapterWalletAddress && !adapterMatchesLinkedWallet ? (
                  <div className="p-3 rounded-lg border border-amber-500/30 bg-amber-500/5">
                    <p className="text-xs text-amber-600 dark:text-amber-400 mb-2 flex items-start gap-1.5">
                      <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" />
                      A different wallet is selected in your browser wallet. Signing will replace the currently linked wallet.
                    </p>
                    <div className="font-mono text-xs break-all mb-3">{adapterWalletAddress}</div>
                    <Button
                      onClick={() => void handleVerifyAndLink()}
                      disabled={isVerifying || connectMutation.isPending || adapterConnecting}
                      className="w-full gap-2"
                      size="sm"
                    >
                      {isVerifying || connectMutation.isPending ? (
                        <>
                          <Loader2 className="h-4 w-4 animate-spin" />
                          Waiting for signature...
                        </>
                      ) : (
                        <>
                          <Link2 className="h-4 w-4" />
                          Verify & Replace Linked Wallet
                        </>
                      )}
                    </Button>
                  </div>
                ) : null}
              </div>

              <div className="flex flex-wrap gap-2">
                <Button variant="outline" size="sm" onClick={handleCopyAddress} className="gap-1.5">
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

                {adapterConnected ? (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => void disconnectAdapter().catch(() => {})}
                    className="gap-1.5"
                  >
                    <Wallet className="h-3.5 w-3.5" />
                    Disconnect Wallet App
                  </Button>
                ) : null}

                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setDisconnectOpen(true)}
                  className="gap-1.5 text-destructive hover:text-destructive hover:bg-destructive/10"
                >
                  <Unplug className="h-3.5 w-3.5" />
                  Unlink Wallet
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="p-4 bg-secondary/30 rounded-lg border border-dashed border-border text-center">
                <div className="w-12 h-12 rounded-full bg-muted mx-auto flex items-center justify-center mb-3">
                  <Wallet className="h-6 w-6 text-muted-foreground" />
                </div>
                <p className="text-sm text-muted-foreground mb-1">No verified wallet linked</p>
                <p className="text-xs text-muted-foreground">
                  Connect Phantom or Solflare and sign a message to verify ownership
                </p>
              </div>

              <div className="space-y-3">
                <div className="wallet-adapter-button-wrap [&_.wallet-adapter-button]:w-full [&_.wallet-adapter-button]:justify-center [&_.wallet-adapter-button]:rounded-md [&_.wallet-adapter-button]:h-10">
                  <WalletMultiButton />
                </div>

                {adapterConnected && adapterWalletAddress ? (
                  <div className="p-3 rounded-lg border border-border/50 bg-secondary/30 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-xs text-muted-foreground">Selected wallet</div>
                      <Badge variant="outline">{adapterWallet?.adapter.name || "Solana Wallet"}</Badge>
                    </div>
                    <div className="font-mono text-sm break-all">{adapterWalletAddress}</div>
                    <Button
                      onClick={() => void handleVerifyAndLink()}
                      disabled={isVerifying || connectMutation.isPending || adapterConnecting}
                      className="w-full gap-2"
                    >
                      {isVerifying || connectMutation.isPending ? (
                        <>
                          <Loader2 className="h-4 w-4 animate-spin" />
                          Waiting for signature...
                        </>
                      ) : (
                        <>
                          <ShieldCheck className="h-4 w-4" />
                          Verify & Link Wallet
                        </>
                      )}
                    </Button>
                    <p className="text-[11px] text-muted-foreground flex items-start gap-1.5">
                      <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" />
                      Your wallet will prompt you to sign a verification message. No funds are moved.
                    </p>
                  </div>
                ) : null}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <AlertDialog open={disconnectOpen} onOpenChange={setDisconnectOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Unlink Wallet?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes the verified wallet from your profile. You can link it again by signing another verification message.
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
                  Unlinking...
                </>
              ) : (
                "Unlink"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
