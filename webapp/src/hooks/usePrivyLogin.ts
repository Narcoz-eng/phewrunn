import { useCallback, useEffect, useRef, useState } from "react";
import { usePrivy, useIdentityToken, useLogin, useLoginWithOAuth, useUser } from "@privy-io/react-auth";
import {
  clearPrivySyncFailureState,
  getAuthUiState,
  getPrivyAuthBootstrapCooldownRemainingMs,
  isExplicitLogoutCoolingDown,
  isPrivyAuthBootstrapCooldownActive,
  isPrivyAuthBootstrapStatePending,
  readPrivyAuthBootstrapSnapshot,
  setPrivyAuthBootstrapState,
  startPrivyAuthBootstrap,
  type AuthUser,
  useAuth,
  usePrivyAuthBootstrapSnapshot,
} from "@/lib/auth-client";
import type { PrivyUserLike } from "@/lib/privy-user";
import { usePrivyProviderInstanceId } from "@/components/PrivyContext";
import {
  clearPrivyLoginIntent,
  writePrivyLoginIntent,
} from "@/lib/privy-login-intent";
import { toast } from "sonner";

const PRIVY_LOGOUT_SETTLE_MS = 250;
const PRIVY_CALLBACK_READY_TIMEOUT_MS = 15_000;

type UsePrivyLoginOptions = {
  onSuccess?: (user: AuthUser) => void;
};

type VisibleAuthStatus =
  | "signed_out"
  | "hydrating"
  | "connecting_backend_session"
  | "finalizing_identity_verification"
  | "authenticated"
  | "rate_limited"
  | "logout_in_progress";

type LoginMethodOverride = "email" | "twitter" | "wallet" | "telegram" | "google";

type StartLoginOptions = {
  loginMethods?: LoginMethodOverride[];
  prefill?: {
    type: "email";
    value: string;
  };
};

type PendingPrivyCallbackHandoff = {
  user: PrivyUserLike;
  startedAt: number;
  resumed: boolean;
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

function waitFor(delayMs: number): Promise<void> {
  return new Promise<void>((resolve) => {
    window.setTimeout(resolve, delayMs);
  });
}

export function usePrivyLogin(options: UsePrivyLoginOptions = {}) {
  const { ready, authenticated, user, logout: privyLogout, getAccessToken } = usePrivy();
  const { refreshUser } = useUser();
  const { identityToken } = useIdentityToken();
  const { hasLiveSession } = useAuth();
  const providerInstanceId = usePrivyProviderInstanceId();
  const bootstrapSnapshot = usePrivyAuthBootstrapSnapshot();
  const { onSuccess } = options;
  const [localSyncError, setLocalSyncError] = useState<string | null>(null);
  const latestPrivyUserRef = useRef<PrivyUserLike | null>(null);
  const latestPrivyIdentityTokenRef = useRef<string | null>(null);
  const latestPrivyStateRef = useRef({ ready: false, authenticated: false });
  const successfulLoginHandledRef = useRef(false);
  const pendingPrivyCallbackRef = useRef<PendingPrivyCallbackHandoff | null>(null);
  const pendingPrivyCallbackTimeoutRef = useRef<number | null>(null);
  const pendingPrivyCallbackResumeInFlightRef = useRef(false);

  const handleSuccessfulLogin = useCallback((syncedUser: AuthUser) => {
    if (successfulLoginHandledRef.current) {
      return;
    }

    successfulLoginHandledRef.current = true;
    clearPrivyLoginIntent();
    setLocalSyncError(null);
    onSuccess?.(syncedUser);
  }, [onSuccess]);

  const clearPendingPrivyCallbackTimeout = useCallback(() => {
    if (pendingPrivyCallbackTimeoutRef.current !== null) {
      window.clearTimeout(pendingPrivyCallbackTimeoutRef.current);
      pendingPrivyCallbackTimeoutRef.current = null;
    }
  }, []);

  const clearPendingPrivyCallbackHandoff = useCallback(() => {
    clearPendingPrivyCallbackTimeout();
    pendingPrivyCallbackRef.current = null;
    pendingPrivyCallbackResumeInFlightRef.current = false;
  }, [clearPendingPrivyCallbackTimeout]);

  useEffect(() => {
    latestPrivyUserRef.current = user ? (user as PrivyUserLike) : null;
  }, [user]);

  useEffect(() => {
    latestPrivyIdentityTokenRef.current =
      typeof identityToken === "string" && identityToken.trim().length > 0
        ? identityToken.trim()
        : null;
  }, [identityToken]);

  useEffect(() => {
    latestPrivyStateRef.current = { ready, authenticated };
  }, [authenticated, ready]);

  useEffect(() => {
    if (!hasLiveSession) {
      return;
    }

    clearPrivyLoginIntent();
    setLocalSyncError(null);
    clearPendingPrivyCallbackHandoff();
  }, [clearPendingPrivyCallbackHandoff, hasLiveSession]);

  useEffect(() => {
    if (authenticated) {
      return;
    }

    latestPrivyUserRef.current = null;
    successfulLoginHandledRef.current = false;
    setLocalSyncError(null);
    clearPendingPrivyCallbackHandoff();
  }, [authenticated, clearPendingPrivyCallbackHandoff]);

  useEffect(() => clearPendingPrivyCallbackHandoff, [clearPendingPrivyCallbackHandoff]);

  const isResumablePendingSnapshot = useCallback((snapshot: ReturnType<typeof readPrivyAuthBootstrapSnapshot>, userId: string) => {
    if (!snapshot || !isPrivyAuthBootstrapStatePending(snapshot.state)) {
      return false;
    }

    return (
      snapshot.owner === "usePrivyLogin" &&
      snapshot.userId === userId &&
      (snapshot.debugCode === "awaiting_privy_sdk_ready" ||
        snapshot.debugCode === "awaiting_privy_identity_token_hook" ||
        (snapshot.debugCode === "awaiting_privy_identity_verification_finalization" &&
          Boolean(latestPrivyIdentityTokenRef.current)))
    );
  }, []);

  const runManualSync = useCallback(async (privyUser: PrivyUserLike): Promise<AuthUser | null> => {
    const currentSnapshot = readPrivyAuthBootstrapSnapshot();
    const resumablePendingSnapshot = isResumablePendingSnapshot(currentSnapshot, privyUser.id);
    if (isPrivyAuthBootstrapStatePending(currentSnapshot?.state) && !resumablePendingSnapshot) {
      console.info("[AuthFlow] usePrivyLogin manual retry blocked by pending auth flow", {
        userId: privyUser.id,
        state: currentSnapshot?.state,
        owner: currentSnapshot?.owner,
        mode: currentSnapshot?.mode,
      });
      return null;
    }

    if (resumablePendingSnapshot) {
      console.info("[AuthFlow] usePrivyLogin resuming deferred bootstrap handoff", {
        userId: privyUser.id,
        state: currentSnapshot?.state,
        debugCode: currentSnapshot?.debugCode,
      });
    }

    const cooldownActive =
      currentSnapshot?.state === "failed_rate_limited" &&
      isPrivyAuthBootstrapCooldownActive(currentSnapshot);
    if (cooldownActive) {
      const retryInMs = getPrivyAuthBootstrapCooldownRemainingMs(currentSnapshot);
      const retryMessage =
        currentSnapshot.detail ??
        "Privy is temporarily rate limiting sign-in. Please wait 10-15 seconds, then tap Sign in again.";
      setLocalSyncError(retryMessage);
      console.info("[AuthFlow] usePrivyLogin manual retry blocked by cooldown", {
        userId: privyUser.id,
        retryInMs,
      });
      return null;
    }

    console.info("[AuthFlow] usePrivyLogin delegating sync to controller", {
      owner: "usePrivyLogin",
      mode: "manual",
      userId: privyUser.id,
      existingState: currentSnapshot?.state ?? "idle",
      privyReady: latestPrivyStateRef.current.ready,
      privyAuthenticated: latestPrivyStateRef.current.authenticated,
      hookIdentityTokenPresent: Boolean(latestPrivyIdentityTokenRef.current),
    });
    const syncedUser = await startPrivyAuthBootstrap({
      owner: "usePrivyLogin",
      mode: "manual",
      user: privyUser,
      getLatestUser: () => latestPrivyUserRef.current,
      privyReady: latestPrivyStateRef.current.ready,
      privyAuthenticated: latestPrivyStateRef.current.authenticated,
      privyIdentityToken: latestPrivyIdentityTokenRef.current,
      getLatestPrivyIdentityToken: () => latestPrivyIdentityTokenRef.current,
      refreshPrivyAuthState: async () => (await refreshUser()) as PrivyUserLike,
      getLatestPrivyAccessToken: () => getAccessToken(),
      triggerSource: "manual_user_action",
    });

    if (syncedUser) {
      handleSuccessfulLogin(syncedUser);
    }

    return syncedUser;
  }, [getAccessToken, handleSuccessfulLogin, isResumablePendingSnapshot, refreshUser]);

  useEffect(() => {
    const pendingCallback = pendingPrivyCallbackRef.current;
    if (!pendingCallback || pendingCallback.resumed || pendingPrivyCallbackResumeInFlightRef.current) {
      return;
    }

    const hookIdentityToken = latestPrivyIdentityTokenRef.current;
    const sdkReadyForBootstrap =
      Boolean(hookIdentityToken) ||
      (latestPrivyStateRef.current.ready && latestPrivyStateRef.current.authenticated);
    const latestPrivyUser = latestPrivyUserRef.current;
    const candidateUser =
      latestPrivyUser?.id === pendingCallback.user.id
        ? latestPrivyUser
        : pendingCallback.user;

    if (!sdkReadyForBootstrap || !candidateUser) {
      return;
    }

    pendingCallback.resumed = true;
    pendingPrivyCallbackResumeInFlightRef.current = true;
    clearPendingPrivyCallbackTimeout();

    console.info("[AuthFlow] usePrivyLogin resuming bootstrap after Privy SDK became ready", {
      userId: candidateUser.id,
      privyReady: latestPrivyStateRef.current.ready,
      privyAuthenticated: latestPrivyStateRef.current.authenticated,
      hookIdentityTokenPresent: Boolean(hookIdentityToken),
      callbackWaitMs: Date.now() - pendingCallback.startedAt,
    });

    void (async () => {
      try {
        await runManualSync(candidateUser);
      } finally {
        clearPendingPrivyCallbackHandoff();
      }
    })();
  }, [authenticated, clearPendingPrivyCallbackHandoff, clearPendingPrivyCallbackTimeout, identityToken, ready, runManualSync, user]);

  const handlePrivyAuthComplete = useCallback(async (privyUser: PrivyUserLike) => {
    clearPrivySyncFailureState();
    setLocalSyncError(null);
    const privyState = latestPrivyStateRef.current;
    const hookIdentityToken = latestPrivyIdentityTokenRef.current;
    const sdkReadyForBootstrap =
      Boolean(hookIdentityToken) || (privyState.ready && privyState.authenticated);
    console.info("[AuthFlow] usePrivyLogin Privy login callback received", {
      userId: privyUser.id,
      providerInstanceId,
      privyReady: privyState.ready,
      privyAuthenticated: privyState.authenticated,
      hookIdentityTokenPresent: Boolean(hookIdentityToken),
      hookIdentityTokenLength: hookIdentityToken?.length ?? 0,
    });

    if (!sdkReadyForBootstrap) {
      const currentSnapshot = readPrivyAuthBootstrapSnapshot();
      const existingPendingCallback = pendingPrivyCallbackRef.current;
      const duplicatePendingCallback =
        existingPendingCallback?.user.id === privyUser.id &&
        !existingPendingCallback.resumed;
      const alreadyWaitingForSdkReady =
        currentSnapshot?.owner === "usePrivyLogin" &&
        currentSnapshot?.userId === privyUser.id &&
        currentSnapshot?.state === "privy_pending" &&
        currentSnapshot?.debugCode === "awaiting_privy_sdk_ready";

      if (!duplicatePendingCallback) {
        pendingPrivyCallbackRef.current = {
          user: privyUser,
          startedAt: Date.now(),
          resumed: false,
        };
        clearPendingPrivyCallbackTimeout();
        pendingPrivyCallbackTimeoutRef.current = window.setTimeout(() => {
          const pendingCallback = pendingPrivyCallbackRef.current;
          if (!pendingCallback || pendingCallback.user.id !== privyUser.id || pendingCallback.resumed) {
            return;
          }

          const message =
            "Privy sign-in completed, but the Privy SDK never became ready for backend sign-in. Please try again.";
          console.warn("[AuthFlow] usePrivyLogin timed out waiting for Privy SDK readiness after callback", {
            userId: privyUser.id,
            waitMs: PRIVY_CALLBACK_READY_TIMEOUT_MS,
          });
          clearPendingPrivyCallbackHandoff();
          setLocalSyncError(message);
          setPrivyAuthBootstrapState("failed", {
            owner: "usePrivyLogin",
            mode: "manual",
            userId: privyUser.id,
            detail: message,
            debugCode: "privy_sdk_ready_timeout",
          });
        }, PRIVY_CALLBACK_READY_TIMEOUT_MS);
      }

      if (!alreadyWaitingForSdkReady) {
        setPrivyAuthBootstrapState("privy_pending", {
          owner: "usePrivyLogin",
          mode: "manual",
          userId: privyUser.id,
          detail: "waiting for Privy SDK authenticated state",
          debugCode: "awaiting_privy_sdk_ready",
        });
      }

      console.info("[AuthFlow] usePrivyLogin deferring bootstrap until Privy SDK is ready/authenticated", {
        userId: privyUser.id,
        providerInstanceId,
        privyReady: privyState.ready,
        privyAuthenticated: privyState.authenticated,
        hookIdentityTokenPresent: Boolean(hookIdentityToken),
        alreadyWaitingForSdkReady,
        duplicatePendingCallback,
      });
      return;
    }

    clearPendingPrivyCallbackHandoff();
    await runManualSync(privyUser);
  }, [clearPendingPrivyCallbackHandoff, clearPendingPrivyCallbackTimeout, providerInstanceId, runManualSync]);

  const handlePrivyAuthError = useCallback((error: unknown) => {
    const errorMessage = getPrivyErrorMessage(error);
    successfulLoginHandledRef.current = false;
    clearPrivyLoginIntent();
    setLocalSyncError(errorMessage);
    setPrivyAuthBootstrapState("failed", {
      owner: "usePrivyLogin",
      mode: "manual",
      userId: null,
      detail: errorMessage,
    });
    console.error("[usePrivyLogin] Privy login error:", error);
    toast.error("Privy sign-in failed");
  }, []);

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

  const startLogin = useCallback((loginOptions?: StartLoginOptions) => {
    const currentSnapshot = readPrivyAuthBootstrapSnapshot();

    if (oauthLoading || isPrivyAuthBootstrapStatePending(currentSnapshot?.state)) {
      return;
    }

    const rateLimitedCooldownActive =
      currentSnapshot?.state === "failed_rate_limited" &&
      isPrivyAuthBootstrapCooldownActive(currentSnapshot);
    if (rateLimitedCooldownActive) {
      const retryMessage =
        currentSnapshot.detail ??
        "Privy is temporarily rate limiting sign-in. Please wait 10-15 seconds, then tap Sign in again.";
      setLocalSyncError(retryMessage);
      console.info("[AuthFlow] usePrivyLogin start blocked by rate-limit cooldown", {
        retryInMs: getPrivyAuthBootstrapCooldownRemainingMs(currentSnapshot),
      });
      return;
    }

    const requestedMethod =
      loginOptions?.loginMethods?.length === 1
        ? loginOptions.loginMethods[0]
        : null;
    const isXLogin = requestedMethod === "twitter";

    clearPrivySyncFailureState();
    setLocalSyncError(null);
    successfulLoginHandledRef.current = false;

    // Clear stale failed bootstrap state so the new login attempt isn't blocked
    if (currentSnapshot?.state === "failed") {
      setPrivyAuthBootstrapState("idle", {
        owner: "usePrivyLogin",
        mode: "manual",
        userId: currentSnapshot.userId,
        detail: "cleared stale failure for new login attempt",
        debugCode: "manual_retry_cleared_failure",
      });
    }

    if (!ready) {
      if (isXLogin) {
        clearPrivyLoginIntent();
      }
      const message = "Sign-in is still initializing. Please wait a second and try again.";
      setLocalSyncError(message);
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
            await waitFor(PRIVY_LOGOUT_SETTLE_MS);
          } catch (error) {
            console.warn("[usePrivyLogin] Privy logout before account switch failed", error);
          }

          setPrivyAuthBootstrapState("privy_pending", {
            owner: "usePrivyLogin",
            mode: "manual",
            userId: null,
            detail: "waiting for Privy sign-in completion",
          });

          if (isXLogin) {
            void initOAuth({ provider: "twitter" }).catch(handlePrivyAuthError);
            return;
          }

          login(loginOptions);
          return;
        }

        await runManualSync(user as PrivyUserLike);
      })();
      return;
    }

    setPrivyAuthBootstrapState("privy_pending", {
      owner: "usePrivyLogin",
      mode: "manual",
      userId: null,
      detail: "waiting for Privy sign-in completion",
    });

    if (isXLogin) {
      void initOAuth({ provider: "twitter" }).catch(handlePrivyAuthError);
      return;
    }

    login(loginOptions);
  }, [
    authenticated,
    handlePrivyAuthError,
    initOAuth,
    login,
    oauthLoading,
    privyLogout,
    ready,
    runManualSync,
    user,
  ]);

  const cooldownRemainingMs = getPrivyAuthBootstrapCooldownRemainingMs(bootstrapSnapshot);
  const authStatus: VisibleAuthStatus = getAuthUiState({
    snapshot: bootstrapSnapshot,
    privyAuthenticated: authenticated,
    logoutCoolingDown: isExplicitLogoutCoolingDown(),
  });

  const authStatusMessage =
    authStatus === "hydrating"
      ? "Checking your Privy session..."
      : authStatus === "connecting_backend_session"
        ? "Connecting your backend session..."
        : authStatus === "finalizing_identity_verification"
          ? "Finalizing sign-in..."
          : authStatus === "rate_limited"
            ? bootstrapSnapshot?.debugCode === "privy_rate_limited_before_backend_sync"
              ? bootstrapSnapshot.detail ??
                "Sign-in could not start because Privy is temporarily rate limiting this browser/session. Please wait 10-15 seconds and try again, or use a fresh private window."
              : bootstrapSnapshot?.detail ??
                "Privy is temporarily rate limiting sign-in. Please wait 10-15 seconds, then tap Sign in again."
            : authStatus === "authenticated"
              ? "Signed in. Loading your account..."
              : authStatus === "logout_in_progress"
                ? "Signing out..."
                : null;

  const bootstrapError =
    bootstrapSnapshot?.state === "failed" || bootstrapSnapshot?.state === "failed_rate_limited"
      ? bootstrapSnapshot.detail
      : null;

  return {
    login: startLogin,
    ready,
    authenticated,
    user,
    identityToken,
    privyLogout,
    isSyncing: oauthLoading || isPrivyAuthBootstrapStatePending(bootstrapSnapshot?.state),
    isRetryBlocked:
      bootstrapSnapshot?.state === "failed_rate_limited" &&
      isPrivyAuthBootstrapCooldownActive(bootstrapSnapshot),
    cooldownRemainingMs,
    syncError: localSyncError ?? bootstrapError ?? null,
    authStatus,
    authStatusMessage,
    backendSyncStarted: bootstrapSnapshot?.backendSyncStarted === true,
    bootstrapDebugCode: bootstrapSnapshot?.debugCode ?? null,
  };
}
