import { useCallback, useEffect, useRef, useState } from "react";
import { getIdentityToken, usePrivy, useLogin } from "@privy-io/react-auth";
import { useAuth, syncPrivySession } from "@/lib/auth-client";
import { toast } from "sonner";

const LOGIN_SYNC_TIMEOUT_MS = 45_000;
const AUTO_RESYNC_COOLDOWN_MS = 12_000;
const AUTO_RESYNC_MAX_ATTEMPTS = 3;
const IDENTITY_TOKEN_ATTEMPTS = 5;
const IDENTITY_TOKEN_RETRY_DELAYS_MS = [120, 180, 260, 360] as const;
const RETRYABLE_SYNC_ERROR_PATTERN =
  /timed out|network|failed to fetch|failed to sign in \(5\d\d\)|failed to sign in \(429\)|server|rate limit|too many requests/i;
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
  const { refetch, isAuthenticated: appSessionAuthenticated } = useAuth();
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const syncGuardRef = useRef(false);
  const syncTimeoutRef = useRef<number | null>(null);
  const loginRequestedRef = useRef(false);
  const lastAutoResyncAtRef = useRef(0);
  const autoResyncAttemptsRef = useRef(0);
  const lastPrivyUserIdRef = useRef<string | null>(null);

  const clearSyncTimeout = useCallback(() => {
    if (syncTimeoutRef.current !== null) {
      window.clearTimeout(syncTimeoutRef.current);
      syncTimeoutRef.current = null;
    }
  }, []);

  const startSyncTimeout = useCallback(() => {
    clearSyncTimeout();
    syncTimeoutRef.current = window.setTimeout(() => {
      if (!syncGuardRef.current) return;
      setSyncError("Sign-in is taking longer than expected. Please wait...");
      toast.warning("Still signing in...");
    }, LOGIN_SYNC_TIMEOUT_MS);
  }, [clearSyncTimeout]);

  const runPrivySync = useCallback(async (
    privyUser: PrivyUserLike,
    source: "manual" | "auto" = "manual"
  ) => {
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
      // Session cookies can propagate a moment after sync on some deployments.
      await new Promise<void>((resolve) => window.setTimeout(resolve, 260));
      await refetch();
      autoResyncAttemptsRef.current = 0;
    } catch (err) {
      console.error("[usePrivyLogin] sync error:", err);
      const message = err instanceof Error ? err.message : "Failed to sign in";
      setSyncError(message);

      if (source === "auto") {
        autoResyncAttemptsRef.current += 1;
      }

      const isRetryable = RETRYABLE_SYNC_ERROR_PATTERN.test(message);
      const shouldToast =
        source === "manual" ||
        !isRetryable ||
        autoResyncAttemptsRef.current >= AUTO_RESYNC_MAX_ATTEMPTS;

      if (shouldToast) {
        toast.error(message);
      }
    } finally {
      clearSyncTimeout();
      loginRequestedRef.current = false;
      syncGuardRef.current = false;
      setIsSyncing(false);
    }
  }, [clearSyncTimeout, refetch]);

  useEffect(() => {
    return () => {
      clearSyncTimeout();
    };
  }, [clearSyncTimeout]);

  useEffect(() => {
    if (!appSessionAuthenticated) return;
    autoResyncAttemptsRef.current = 0;
    lastAutoResyncAtRef.current = 0;
    setSyncError(null);
  }, [appSessionAuthenticated]);

  useEffect(() => {
    if (!ready || !authenticated || !user) return;
    if (appSessionAuthenticated) return;
    if (syncGuardRef.current || isSyncing) return;

    if (lastPrivyUserIdRef.current !== user.id) {
      autoResyncAttemptsRef.current = 0;
      lastAutoResyncAtRef.current = 0;
      lastPrivyUserIdRef.current = user.id;
    }

    if (autoResyncAttemptsRef.current >= AUTO_RESYNC_MAX_ATTEMPTS) {
      setSyncError("Sign-in is delayed. Please tap sign in again.");
      return;
    }

    const now = Date.now();
    const dynamicCooldown =
      AUTO_RESYNC_COOLDOWN_MS * Math.max(1, autoResyncAttemptsRef.current + 1);
    if (now - lastAutoResyncAtRef.current < dynamicCooldown) return;
    lastAutoResyncAtRef.current = now;

    setSyncError(null);
    loginRequestedRef.current = true;
    setIsSyncing(true);
    startSyncTimeout();
    void runPrivySync(user as PrivyUserLike, "auto");
  }, [appSessionAuthenticated, authenticated, isSyncing, ready, runPrivySync, startSyncTimeout, user]);

  const { login } = useLogin({
    onComplete: async (params) => {
      autoResyncAttemptsRef.current = 0;
      lastAutoResyncAtRef.current = 0;
      void runPrivySync(params.user as PrivyUserLike, "manual");
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
    autoResyncAttemptsRef.current = 0;
    lastAutoResyncAtRef.current = 0;
    loginRequestedRef.current = true;
    setIsSyncing(true);
    startSyncTimeout();

    if (authenticated && user) {
      void runPrivySync(user as PrivyUserLike, "manual");
      return;
    }

    login();
  };

  return { login: startLogin, ready, authenticated, user, privyLogout, isSyncing, syncError };
}
