import { useCallback, useEffect, useRef, useState } from "react";
import { usePrivy, useLogin, useLoginWithOAuth } from "@privy-io/react-auth";
import {
  clearPrivySyncFailureState,
  isExplicitLogoutCoolingDown,
  isPrivyAuthBootstrapStatePending,
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
    console.info("[AuthFlow] usePrivyLogin delegating sync to controller", {
      owner: "usePrivyLogin",
      mode: "manual",
      userId: privyUser.id,
      existingState: bootstrapSnapshot?.state ?? "idle",
    });
    const syncedUser = await startPrivyAuthBootstrap({
      owner: "usePrivyLogin",
      mode: "manual",
      user: privyUser,
      getLatestUser: () => latestPrivyUserRef.current,
    });

    if (syncedUser) {
      handleSuccessfulLogin(syncedUser);
    }

    return syncedUser;
  }, [bootstrapSnapshot?.state, handleSuccessfulLogin]);

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
    if (oauthLoading || isPrivyAuthBootstrapStatePending(bootstrapSnapshot?.state)) {
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
    bootstrapSnapshot?.state,
    handlePrivyAuthError,
    initOAuth,
    login,
    oauthLoading,
    privyLogout,
    ready,
    runManualSync,
    user,
  ]);

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
    syncError: localSyncError ?? bootstrapError ?? null,
  };
}
