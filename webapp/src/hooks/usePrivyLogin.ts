import { useCallback, useEffect, useRef, useState } from "react";
import { getIdentityToken, usePrivy, useLogin } from "@privy-io/react-auth";
import { useAuth, syncPrivySession } from "@/lib/auth-client";
import { toast } from "sonner";

const LOGIN_SYNC_TIMEOUT_MS = 45_000;
const AUTO_RESYNC_COOLDOWN_MS = 4_000;
const AUTO_RESYNC_MAX_ATTEMPTS = 3;
const TOO_MANY_REQUESTS_BACKOFF_MS = 6_000;
const IDENTITY_TOKEN_ATTEMPTS = 4;
const IDENTITY_TOKEN_RETRY_DELAYS_MS = [60, 100, 160] as const;
const RETRYABLE_SYNC_ERROR_PATTERN =
  /timed out|network|failed to fetch|failed to sign in \(5\d\d\)|failed to sign in \(4\d\d\)|server|rate limit|too many/i;
const TOO_MANY_REQUESTS_ERROR_PATTERN = /too many|rate limit|429/i;
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
  const rateLimitedUntilRef = useRef(0);

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
      // syncPrivySession already caches the user and stores the token,
      // so the first refetch resolves from cache instantly.
      await refetch();
      autoResyncAttemptsRef.current = 0;
    } catch (err) {
      console.error("[usePrivyLogin] sync error:", err);
      const rawMessage = err instanceof Error ? err.message : "Failed to sign in";

      if (source === "auto") {
        autoResyncAttemptsRef.current += 1;
      }

      const isRetryable = RETRYABLE_SYNC_ERROR_PATTERN.test(rawMessage);
      const isRateLimited = TOO_MANY_REQUESTS_ERROR_PATTERN.test(rawMessage);
      const attemptsExhausted = autoResyncAttemptsRef.current >= AUTO_RESYNC_MAX_ATTEMPTS;

      // Show a subtle status message, not scary errors
      if (isRetryable && !attemptsExhausted) {
        setSyncError("Connecting...");
      } else {
        setSyncError("Could not connect. Please tap Sign In to try again.");
        // Only toast on final failure, not intermediate retries
        toast.error("Sign-in failed. Please try again.");
      }

      // Apply backoff for auto-retries, never block manual sign-in
      if (isRateLimited && source === "auto") {
        rateLimitedUntilRef.current = Date.now() + TOO_MANY_REQUESTS_BACKOFF_MS;
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

  // Auto-resync: only attempt ONCE on mount when Privy is already authenticated
  // (e.g. page refresh with persisted Privy session). Don't retry automatically
  // to avoid burning through rate limits before the user even taps anything.
  const mountResyncDoneRef = useRef(false);
  useEffect(() => {
    if (!ready || !authenticated || !user) return;
    if (appSessionAuthenticated) return;
    if (syncGuardRef.current || isSyncing) return;
    if (mountResyncDoneRef.current) return;

    mountResyncDoneRef.current = true;
    lastPrivyUserIdRef.current = user.id;
    setIsSyncing(true);
    void runPrivySync(user as PrivyUserLike, "auto");
  }, [appSessionAuthenticated, authenticated, isSyncing, ready, runPrivySync, user]);

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
    // Always allow manual sign-in — clear any previous rate-limit lockout
    rateLimitedUntilRef.current = 0;
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
