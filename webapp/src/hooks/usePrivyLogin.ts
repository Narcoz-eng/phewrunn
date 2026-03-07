import { useCallback, useEffect, useRef, useState } from "react";
import { usePrivy, useLogin, useLoginWithOAuth } from "@privy-io/react-auth";
import {
  clearPrivyAuthBootstrapState,
  clearPrivySyncFailureState,
  isExplicitLogoutCoolingDown,
  setPrivyAuthBootstrapState,
  type AuthUser,
  readCachedAuthUserSnapshot,
  useAuth,
  syncPrivySession,
} from "@/lib/auth-client";
import {
  resolvePrivyAuthPayload,
  type PrivyUserLike,
} from "@/lib/privy-user";
import {
  clearPrivyLoginIntent,
  writePrivyLoginIntent,
} from "@/lib/privy-login-intent";
import { toast } from "sonner";

const LOGIN_SYNC_TIMEOUT_MS = 5_000;
const AUTO_RESYNC_COOLDOWN_MS = 2_000;
const AUTO_RESYNC_MAX_ATTEMPTS = 5;
const TOO_MANY_REQUESTS_BACKOFF_MS = 3_000;
const PRIVY_LOGOUT_SETTLE_MS = 250;
const RETRYABLE_SYNC_ERROR_PATTERN =
  /timed out|network|failed to fetch|failed to sign in \(5\d\d\)|failed to sign in \(429\)|server|rate limit|too many requests|finalizing|identity verification|identity token/i;
const TOO_MANY_REQUESTS_ERROR_PATTERN = /too many requests|rate limit|429/i;

type UsePrivyLoginOptions = {
  onSuccess?: (user: AuthUser) => void;
};

type LoginMethodOverride = "email" | "twitter";

type StartLoginOptions = {
  loginMethods?: LoginMethodOverride[];
  prefill?: {
    type: "email";
    value: string;
  };
};

function getPrivyErrorMessage(error: unknown): string {
  if (typeof error === "string") {
    return error;
  }

  if (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof (error as { message?: unknown }).message === "string"
  ) {
    return (error as { message: string }).message;
  }

  return "Privy sign-in failed";
}

// This hook MUST only be called inside a component rendered within PrivyProvider
export function usePrivyLogin(options: UsePrivyLoginOptions = {}) {
  const { ready, authenticated, user, logout: privyLogout } = usePrivy();
  const { hasLiveSession } = useAuth();
  const { onSuccess } = options;
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const syncGuardRef = useRef(false);
  const activeSyncPromiseRef = useRef<Promise<AuthUser | null> | null>(null);
  const hasLiveSessionRef = useRef(hasLiveSession);
  const syncTimeoutRef = useRef<number | null>(null);
  const loginRequestedRef = useRef(false);
  const successfulLoginHandledRef = useRef(false);
  const lastAutoResyncAtRef = useRef(0);
  const autoResyncAttemptsRef = useRef(0);
  const lastPrivyUserIdRef = useRef<string | null>(null);
  const rateLimitedUntilRef = useRef(0);
  const latestPrivyUserRef = useRef<PrivyUserLike | null>(null);
  const lastSyncFailureRef = useRef<{ message: string; retryable: boolean } | null>(null);

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

  const handleSuccessfulLogin = useCallback((syncedUser: AuthUser) => {
    if (successfulLoginHandledRef.current) {
      return;
    }
    successfulLoginHandledRef.current = true;
    clearPrivyLoginIntent();
    onSuccess?.(syncedUser);
  }, [onSuccess]);

  const runPrivySync = useCallback((
    privyUser: PrivyUserLike,
    source: "manual" | "auto" = "manual"
  ): Promise<AuthUser | null> => {
    if (activeSyncPromiseRef.current) {
      return activeSyncPromiseRef.current;
    }

    const syncPromise = (async (): Promise<AuthUser | null> => {
      syncGuardRef.current = true;
      setIsSyncing(true);
      setSyncError(null);
      startSyncTimeout();

      try {
        setPrivyAuthBootstrapState("awaiting_identity_token", {
          source,
          userId: privyUser.id,
          detail: "privy user ready",
        });
        const resolvedPayload = await resolvePrivyAuthPayload({
          user: privyUser,
          getLatestUser: () => latestPrivyUserRef.current,
        });
        const privyIdToken = resolvedPayload.privyIdToken;
        const email = resolvedPayload.email ?? "";

        if (!privyIdToken) {
          throw new Error("Privy identity verification is still finalizing");
        }

        const name = resolvedPayload.name ?? "";

        const syncResult = await syncPrivySession(
          resolvedPayload.user.id,
          email || undefined,
          name || undefined,
          privyIdToken ?? undefined
        );

        autoResyncAttemptsRef.current = 0;
        lastSyncFailureRef.current = null;
        setPrivyAuthBootstrapState("sync_succeeded", {
          source,
          userId: syncResult.user.id,
          detail: "session synced",
        });
        return syncResult.user;
      } catch (err) {
        console.error("[usePrivyLogin] sync error:", err);
        const rawMessage = err instanceof Error ? err.message : "Failed to sign in";
        setPrivyAuthBootstrapState("sync_failed", {
          source,
          userId: privyUser.id,
          detail: rawMessage,
        });
        if (source === "auto" && hasLiveSessionRef.current) {
          setSyncError(null);
          clearPrivyLoginIntent();
          return readCachedAuthUserSnapshot();
        }

        const isTooManyRequests = TOO_MANY_REQUESTS_ERROR_PATTERN.test(rawMessage);
        const isRetryable = RETRYABLE_SYNC_ERROR_PATTERN.test(rawMessage);
        lastSyncFailureRef.current = {
          message: rawMessage,
          retryable: isTooManyRequests || isRetryable,
        };
        const userMessage = isTooManyRequests ? "Sign-in is busy. Retrying..." : rawMessage;
        const shouldShowInlineError =
          source === "manual"
            ? !isRetryable
            : !isRetryable || autoResyncAttemptsRef.current >= AUTO_RESYNC_MAX_ATTEMPTS;

        if (shouldShowInlineError || !isTooManyRequests) {
          setSyncError(userMessage);
        } else {
          setSyncError(null);
        }

        if (source === "auto") {
          autoResyncAttemptsRef.current += 1;
        }

        const exhaustedAutoRetries =
          source === "auto" &&
          (!isRetryable || autoResyncAttemptsRef.current >= AUTO_RESYNC_MAX_ATTEMPTS);
        if (source === "manual" || exhaustedAutoRetries) {
          clearPrivyLoginIntent();
        }

        const shouldToast =
          source === "manual"
            ? !isRetryable
            : !isRetryable || autoResyncAttemptsRef.current >= AUTO_RESYNC_MAX_ATTEMPTS;

        if (shouldToast) {
          toast.error(userMessage);
        }

        if (TOO_MANY_REQUESTS_ERROR_PATTERN.test(rawMessage) && source === "auto") {
          rateLimitedUntilRef.current = Date.now() + TOO_MANY_REQUESTS_BACKOFF_MS;
        }

        return null;
      } finally {
        clearSyncTimeout();
        loginRequestedRef.current = false;
        syncGuardRef.current = false;
        activeSyncPromiseRef.current = null;
        setIsSyncing(false);
      }
    })();

    activeSyncPromiseRef.current = syncPromise;
    return syncPromise;
  }, [clearSyncTimeout, startSyncTimeout]);

  useEffect(() => {
    return () => {
      clearSyncTimeout();
    };
  }, [clearSyncTimeout]);

  useEffect(() => {
    hasLiveSessionRef.current = hasLiveSession;
    if (!hasLiveSession) return;
    autoResyncAttemptsRef.current = 0;
    lastAutoResyncAtRef.current = 0;
    lastSyncFailureRef.current = null;
    clearPrivyLoginIntent();
    setSyncError(null);
  }, [hasLiveSession]);

  useEffect(() => {
    latestPrivyUserRef.current = user ? (user as PrivyUserLike) : null;
  }, [user]);

  useEffect(() => {
    if (!authenticated) {
      autoResyncAttemptsRef.current = 0;
      lastAutoResyncAtRef.current = 0;
      rateLimitedUntilRef.current = 0;
      lastPrivyUserIdRef.current = null;
      loginRequestedRef.current = false;
      successfulLoginHandledRef.current = false;
      lastSyncFailureRef.current = null;
      latestPrivyUserRef.current = null;
      setSyncError(null);
      clearPrivyAuthBootstrapState();
    }
  }, [authenticated]);


  const runManualSync = useCallback(async (privyUser: PrivyUserLike): Promise<AuthUser | null> => {
    const syncedUser = await runPrivySync(privyUser, "manual");
    if (syncedUser) {
      handleSuccessfulLogin(syncedUser);
    }
    return syncedUser;
  }, [handleSuccessfulLogin, runPrivySync]);

  const handlePrivyAuthComplete = useCallback(async (privyUser: PrivyUserLike) => {
    autoResyncAttemptsRef.current = 0;
    lastAutoResyncAtRef.current = 0;
    clearPrivySyncFailureState();
    await runManualSync(privyUser);
  }, [runManualSync]);

  const handlePrivyAuthError = useCallback((error: unknown) => {
    clearSyncTimeout();
    loginRequestedRef.current = false;
    syncGuardRef.current = false;
    clearPrivyLoginIntent();
    lastSyncFailureRef.current = {
      message: getPrivyErrorMessage(error),
      retryable: false,
    };
    console.error("[usePrivyLogin] Privy login error:", error);
    setIsSyncing(false);
    const errorMessage = getPrivyErrorMessage(error);
    setSyncError(errorMessage);
    toast.error("Privy sign-in failed");
  }, [clearSyncTimeout]);

  const { login } = useLogin({
    onComplete: async (params) => {
      await handlePrivyAuthComplete(params.user as PrivyUserLike);
    },
    onError: handlePrivyAuthError,
  });

  const { initOAuth, loading: oauthLoading } = useLoginWithOAuth({
    onComplete: async (params) => {
      await handlePrivyAuthComplete(params.user as PrivyUserLike);
    },
    onError: handlePrivyAuthError,
  });

  const startLogin = (loginOptions?: StartLoginOptions) => {
    if (syncGuardRef.current || isSyncing || oauthLoading) {
      return;
    }

    const requestedMethod =
      loginOptions?.loginMethods?.length === 1
        ? loginOptions.loginMethods[0]
        : null;
    const isXLogin = requestedMethod === "twitter";
    rateLimitedUntilRef.current = 0;
    clearPrivySyncFailureState();
    clearPrivyAuthBootstrapState();
    setSyncError(null);
    autoResyncAttemptsRef.current = 0;
    lastAutoResyncAtRef.current = 0;
    loginRequestedRef.current = true;
    successfulLoginHandledRef.current = false;

    if (!ready) {
      if (isXLogin) {
        clearPrivyLoginIntent();
      }
      loginRequestedRef.current = false;
      setSyncError("Sign-in is still initializing. Please wait a second and try again.");
      toast.warning("Sign-in is still initializing...");
      return;
    }

    if (isXLogin) {
      writePrivyLoginIntent("twitter");
    } else {
      clearPrivyLoginIntent();
    }

    if (authenticated && user) {
      void (async () => {
        if (isExplicitLogoutCoolingDown()) {
          try {
            await privyLogout();
            await new Promise<void>((resolve) => {
              window.setTimeout(resolve, PRIVY_LOGOUT_SETTLE_MS);
            });
          } catch (error) {
            console.warn("[usePrivyLogin] Privy logout before account switch failed", error);
          }

          if (isXLogin) {
            void initOAuth({ provider: "twitter" }).catch(handlePrivyAuthError);
            return;
          }

          login(loginOptions);
          return;
        }

        const syncedUser = await runManualSync(user as PrivyUserLike);
        if (syncedUser) {
          return;
        }

        if (lastSyncFailureRef.current?.retryable) {
          return;
        }

        try {
          await privyLogout();
        } catch (error) {
          console.warn("[usePrivyLogin] Privy logout before re-auth failed", error);
        }

        if (isXLogin) {
          clearPrivyLoginIntent();
          const resetMessage = "Previous sign-in session was reset. Tap Continue with X again.";
          setSyncError(resetMessage);
          toast.warning(resetMessage);
          return;
        }

        login(loginOptions);
      })();
      return;
    }

    if (isXLogin) {
      void initOAuth({ provider: "twitter" }).catch(handlePrivyAuthError);
      return;
    }

    login(loginOptions);
  };

  return {
    login: startLogin,
    ready,
    authenticated,
    user,
    privyLogout,
    isSyncing: isSyncing || oauthLoading,
    syncError,
  };
}
