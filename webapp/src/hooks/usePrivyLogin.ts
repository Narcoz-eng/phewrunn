import { useRef, useState } from "react";
import { getIdentityToken, usePrivy, useLogin } from "@privy-io/react-auth";
import { useAuth, syncPrivySession } from "@/lib/auth-client";
import { toast } from "sonner";

// This hook MUST only be called inside a component rendered within PrivyProvider
export function usePrivyLogin() {
  const { ready, authenticated, user, logout: privyLogout } = usePrivy();
  const { refetch } = useAuth();
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const syncGuardRef = useRef(false);

  const { login } = useLogin({
    onComplete: async (params) => {
      if (syncGuardRef.current) {
        console.warn("[usePrivyLogin] Duplicate onComplete callback ignored");
        return;
      }
      syncGuardRef.current = true;
      setSyncError(null);
      try {
        const privyUser = params.user;
        const privyIdToken = await getIdentityToken();
        const email =
          privyUser.email?.address ??
          (privyUser.linkedAccounts?.find(
            (a: { type: string; address?: string }) => a.type === "email"
          ) as { type: string; address?: string } | undefined)?.address ??
          "";

        if (!email && !privyIdToken) {
          // Privy can occasionally omit email / identity token on repeat sign-ins.
          // Backend can still resolve the user via privyUserId using Privy server API.
          console.warn("[usePrivyLogin] Privy returned no email/idToken; falling back to privyUserId sync");
        }

        const name = (privyUser.google as { name?: string } | undefined)?.name ?? email.split("@")[0] ?? "";

        await syncPrivySession(
          privyUser.id,
          email || undefined,
          name || undefined,
          privyIdToken ?? undefined
        );
        void refetch();
      } catch (err) {
        console.error("[usePrivyLogin] onComplete error:", err);
        const message = err instanceof Error ? err.message : "Failed to sign in";
        setSyncError(message);
        toast.error(message);
        try {
          await privyLogout();
        } catch {
          // Ignore cleanup errors; the backend sync failure is the primary issue.
        }
      } finally {
        syncGuardRef.current = false;
        setIsSyncing(false);
      }
    },
    onError: (error) => {
      syncGuardRef.current = false;
      console.error("[usePrivyLogin] Privy login error:", error);
      setIsSyncing(false);
      setSyncError(error instanceof Error ? error.message : "Privy sign-in failed");
      toast.error("Privy sign-in failed");
    },
  });

  const startLogin = () => {
    if (syncGuardRef.current || isSyncing) {
      return;
    }
    setSyncError(null);
    setIsSyncing(true);
    login();
  };

  return { login: startLogin, ready, authenticated, user, privyLogout, isSyncing, syncError };
}
