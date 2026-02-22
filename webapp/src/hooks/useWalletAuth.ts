import { useCallback, useState } from "react";
import { usePrivy, useConnectWallet } from "@privy-io/react-auth";
import { useWallets, useSignMessage } from "@privy-io/react-auth/solana";
import { api } from "@/lib/api";
import bs58 from "bs58";

interface WalletAuthResult {
  success: boolean;
  error?: string;
}

const createSignMessage = (walletAddress: string, nonce: string): string => {
  return `Sign this message to verify your wallet ownership.\n\nWallet: ${walletAddress}\nNonce: ${nonce}\nTimestamp: ${new Date().toISOString()}`;
};

const generateNonce = (): string => {
  const array = new Uint8Array(16);
  crypto.getRandomValues(array);
  return Array.from(array, (byte) => byte.toString(16).padStart(2, "0")).join("");
};

export function useWalletAuth() {
  const { ready, authenticated } = usePrivy();
  const { wallets } = useWallets();
  const { signMessage } = useSignMessage();
  const { connectWallet } = useConnectWallet();
  const [isAuthenticating, setIsAuthenticating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const connectedWallet = wallets[0] ?? null;
  const connected = !!connectedWallet;
  const publicKey = connectedWallet?.address ?? null;
  const walletName = connectedWallet?.standardWallet?.name ?? null;

  const openWalletModal = useCallback(() => {
    setError(null);
    connectWallet();
  }, [connectWallet]);

  const authenticateWallet = useCallback(async (): Promise<WalletAuthResult> => {
    if (!connectedWallet) {
      return { success: false, error: "Wallet not connected" };
    }

    setIsAuthenticating(true);
    setError(null);

    try {
      const walletAddress = connectedWallet.address;
      const nonce = generateNonce();
      const message = createSignMessage(walletAddress, nonce);

      const messageBytes = new TextEncoder().encode(message);
      const { signature: signatureBytes } = await signMessage({
        message: messageBytes,
        wallet: connectedWallet,
      });
      const signature = bs58.encode(signatureBytes);

      const walletProvider = connectedWallet.standardWallet?.name?.toLowerCase() || "unknown";

      const response = await api.raw("/api/auth/wallet", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ walletAddress, walletProvider, signature, message, nonce }),
      });

      if (response.ok) {
        const data = await response.json() as { token?: string };
        if (data.token) localStorage.setItem("auth-token", data.token);
        return { success: true };
      } else {
        const data = await response.json() as { error?: { message?: string } };
        const errorMessage = data.error?.message || "Failed to authenticate wallet";
        setError(errorMessage);
        return { success: false, error: errorMessage };
      }
    } catch (err) {
      console.error("Wallet auth error:", err);
      const errorMessage = err instanceof Error ? err.message : "Failed to sign message";
      setError(errorMessage);
      return { success: false, error: errorMessage };
    } finally {
      setIsAuthenticating(false);
    }
  }, [connectedWallet, signMessage]);

  const disconnectWallet = useCallback(async () => {
    try {
      if (connectedWallet) await connectedWallet.disconnect();
      setError(null);
    } catch (err) {
      console.error("Disconnect error:", err);
    }
  }, [connectedWallet]);

  return {
    connected,
    publicKey,
    walletName,
    isAuthenticating,
    error,
    ready,
    authenticated,
    openWalletModal,
    authenticateWallet,
    disconnectWallet,
    clearError: () => setError(null),
  };
}
