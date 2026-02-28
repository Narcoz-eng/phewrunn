import { useCallback, useEffect, useRef, useState } from "react";
import { getIdentityToken, usePrivy, useLogin } from "@privy-io/react-auth";
import { useAuth, syncPrivySession } from "@/lib/auth-client";
import { toast } from "sonner";

const LOGIN_SYNC_TIMEOUT_MS = 30_000;
const IDENTITY_TOKEN_ATTEMPTS = 5;
const IDENTITY_TOKEN_RETRY_DELAYS_MS = [120, 180, 260, 360] as const;
const RETRYABLE_SYNC_ERROR_PATTERN =
  /timed out|network|failed to fetch|failed to sign in \(5\d\d\)|failed to sign in \(429\)|server|rate limit|too many requests/i;
const FORCED_PRIVY_LOGOUT_ERROR_PATTERN = /invalid privy session|invalid privy user|unauthorized|forbidden/i;
type PrivyUserLike = {
  id: string;
  email?: { address?: string } | null;
  google?: { name?: string } | null;
  linkedAccounts?: Array<{ type: string; address?: string }> | null;
};

async function getIdentityTokenFast(): Promise<string | undefined> {
  for (let attempt = 0; attempt < IDENTITY_TOKEN_ATTEMPTS; attempt += 1) {
    const token = await getIdentityToken();
    if (token) {
      return token;
    }
    const delayMs = IDENTITY_TOKEN_RETRY_DELAYS_MS[attempt];
    if (!delayMs) {
      continue;
    }
    await new Promise<void>((resolve) => {
      setTimeout(resolve, delayMs);
    });
  }
  return undefined;
}

// This hook MUST only be called inside a component rendered within PrivyProvider
export function usePrivyLogin() {
  const { ready, authenticated, user, logout: privyLogout } = usePrivy();
  const { refetch } = useAuth();
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const syncGuardRef = useRef(false);
  const syncTimeoutRef = useRef<number | null>(null);
  const loginRequestedRef = useRef(false);

  const clearSyncTimeout = () => {
    if (syncTimeoutRef.current !== null) {
      window.clearTimeout(syncTimeoutRef.current);
      syncTimeoutRef.current = null;
    }
  };

  const startSyncTimeout = () => {
    clearSyncTimeout();
    syncTimeoutRef.current = window.setTimeout(() => {
      loginRequestedRef.current = false;
      syncGuardRef.current = false;
      setIsSyncing(false);
      setSyncError("Sign-in timed out. Please try again.");
      toast.error("Sign-in timed out. Please try again.");
    }, LOGIN_SYNC_TIMEOUT_MS);
  };

  const runPrivySync = useCallback(async (privyUser: PrivyUserLike) => {
    if (syncGuardRef.current) {
      return;
    }

    syncGuardRef.current = true;
    setSyncError(null);

    try {
      const privyIdToken = await getIdentityTokenFast();
      const email =
        privyUser.email?.address ??
        (privyUser.linkedAccounts?.find(
          (a: { type: string; address?: string }) => a.type === "email"
        ) as { type: string; address?: string } | undefined)?.address ??
        "";

      if (!email && !privyIdToken) {
        console.warn("[usePrivyLogin] Privy returned no email/idToken; falling back to privyUserId sync");
      }

      const name = (privyUser.google as { name?: string } | undefined)?.name ?? email.split("@")[0] ?? "";

      await syncPrivySession(
        privyUser.id,
        email || undefined,
        name || undefined,
        privyIdToken ?? undefined
      );
      await refetch();
    } catch (err) {
      console.error("[usePrivyLogin] sync error:", err);
      const message = err instanceof Error ? err.message : "Failed to sign in";
      setSyncError(message);
      toast.error(message);
      const shouldKeepPrivySession = RETRYABLE_SYNC_ERROR_PATTERN.test(message);
      const shouldForcePrivyLogout = FORCED_PRIVY_LOGOUT_ERROR_PATTERN.test(message);
      if (!shouldKeepPrivySession && shouldForcePrivyLogout) {
        void privyLogout().catch(() => {
          // Ignore cleanup errors; primary flow should never stay blocked on logout cleanup.
        });
      }
    } finally {
      clearSyncTimeout();
      loginRequestedRef.current = false;
      syncGuardRef.current = false;
      setIsSyncing(false);
    }
  }, [privyLogout, refetch]);

  useEffect(() => {
    return () => {
      clearSyncTimeout();
    };
  }, []);

  const { login } = useLogin({
    onComplete: async (params) => {
      void runPrivySync(params.user as PrivyUserLike);
    },
    onError: (error) => {
      clearSyncTimeout();
      loginRequestedRef.current = false;
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
    loginRequestedRef.current = true;
    setIsSyncing(true);
    startSyncTimeout();

    if (authenticated && user) {
      void runPrivySync(user as PrivyUserLike);
      return;
    }

    login();
  };

  return { login: startLogin, ready, authenticated, user, privyLogout, isSyncing, syncError };
}
