import { useCallback, useEffect, useRef, useState } from "react";
import { usePrivy, useLogin, useLoginWithOAuth } from "@privy-io/react-auth";
import {
  clearPrivySyncFailureState,
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
import {
  clearPrivyLoginIntent,
  writePrivyLoginIntent,
} from "@/lib/privy-login-intent";
import { toast } from "sonner";

const PRIVY_LOGOUT_SETTLE_MS = 250;

type UsePrivyLoginOptions = {
  onSuccess?: (user: AuthUser) => void;
};

type VisibleAuthStatus =
  | "idle"
  | "awaiting_identity_token"
  | "syncing_backend"
  | "rate_limited_cooldown"
  | "authenticated"
  | "failed";

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

function waitFor(delayMs: number): Promise<void> {
  return new Promise<void>((resolve) => {
    window.setTimeout(resolve, delayMs);
  });
}

export function usePrivyLogin(options: UsePrivyLoginOptions = {}) {
  const { ready, authenticated, user, logout: privyLogout } = usePrivy();
  const { hasLiveSession } = useAuth();
  const bootstrapSnapshot = usePrivyAuthBootstrapSnapshot();
  const { onSuccess } = options;
  const [localSyncError, setLocalSyncError] = useState<string | null>(null);
  const latestPrivyUserRef = useRef<PrivyUserLike | null>(null);
  const successfulLoginHandledRef = useRef(false);

  const handleSuccessfulLogin = useCallback((syncedUser: AuthUser) => {
    if (successfulLoginHandledRef.current) {
      return;
    }

    successfulLoginHandledRef.current = true;
    clearPrivyLoginIntent();
    setLocalSyncError(null);
    onSuccess?.(syncedUser);
  }, [onSuccess]);

  useEffect(() => {
    latestPrivyUserRef.current = user ? (user as PrivyUserLike) : null;
  }, [user]);

  useEffect(() => {
    if (!hasLiveSession) {
      return;
    }

    clearPrivyLoginIntent();
    setLocalSyncError(null);
  }, [hasLiveSession]);

  useEffect(() => {
    if (authenticated) {
      return;
    }

    latestPrivyUserRef.current = null;
    successfulLoginHandledRef.current = false;
    setLocalSyncError(null);
  }, [authenticated]);

  const runManualSync = useCallback(async (privyUser: PrivyUserLike): Promise<AuthUser | null> => {
    const currentSnapshot = readPrivyAuthBootstrapSnapshot();
    if (isPrivyAuthBootstrapStatePending(currentSnapshot?.state)) {
      console.info("[AuthFlow] usePrivyLogin manual retry blocked by pending auth flow", {
        userId: privyUser.id,
        state: currentSnapshot?.state,
        owner: currentSnapshot?.owner,
        mode: currentSnapshot?.mode,
      });
      return null;
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
    });
    const syncedUser = await startPrivyAuthBootstrap({
      owner: "usePrivyLogin",
      mode: "manual",
      user: privyUser,
      getLatestUser: () => latestPrivyUserRef.current,
      triggerSource: "manual_user_action",
    });

    if (syncedUser) {
      handleSuccessfulLogin(syncedUser);
    }

    return syncedUser;
  }, [handleSuccessfulLogin]);

  const handlePrivyAuthComplete = useCallback(async (privyUser: PrivyUserLike) => {
    clearPrivySyncFailureState();
    setLocalSyncError(null);
    await runManualSync(privyUser);
  }, [runManualSync]);

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
  const authStatus: VisibleAuthStatus =
    bootstrapSnapshot?.state === "awaiting_identity_token" || bootstrapSnapshot?.state === "cooldown"
      ? "awaiting_identity_token"
      : bootstrapSnapshot?.state === "syncing_backend"
        ? "syncing_backend"
        : bootstrapSnapshot?.state === "failed_rate_limited"
          ? "rate_limited_cooldown"
          : bootstrapSnapshot?.state === "authenticated"
            ? "authenticated"
            : bootstrapSnapshot?.state === "failed" || localSyncError
              ? "failed"
              : "idle";

  const authStatusMessage =
    authStatus === "awaiting_identity_token"
      ? "Waiting for Privy to finish verification..."
      : authStatus === "syncing_backend"
        ? "Finalizing your Phew session..."
        : authStatus === "rate_limited_cooldown"
          ? bootstrapSnapshot?.debugCode === "privy_rate_limited_before_backend_sync"
            ? bootstrapSnapshot.detail ??
              "Sign-in could not start because Privy is temporarily rate limiting this browser/session. Please wait 10-15 seconds and try again, or use a fresh private window."
            : bootstrapSnapshot?.detail ??
              "Privy is temporarily rate limiting sign-in. Please wait 10-15 seconds, then tap Sign in again."
          : authStatus === "authenticated"
            ? "Signed in. Loading your account..."
            : authStatus === "failed"
              ? localSyncError ?? bootstrapSnapshot?.detail ?? "Sign-in failed."
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
