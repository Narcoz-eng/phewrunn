import React, { useEffect, useRef } from "react";
import { usePrivy, useIdentityToken } from "@privy-io/react-auth";
import {
  registerPreLogoutHook,
  setPrivyAuthAnonymousState,
  setPrivyAuthBootstrapState,
  startPrivyAuthBootstrap,
  useAuth,
  readPrivyAuthBootstrapSnapshot,
} from "@/lib/auth-client";
import { usePrivyAvailable, usePrivyProviderInstanceId } from "@/components/PrivyWalletProvider";
import type { PrivyUserLike } from "@/lib/privy-user";
import { clearPrivyLoginIntent } from "@/lib/privy-login-intent";

interface AuthInitializerProps {
  children: React.ReactNode;
}

function AuthInitializerInner({ children }: AuthInitializerProps) {
  const { ready, authenticated, user, logout: privyLogout } = usePrivy();
  const { identityToken } = useIdentityToken();
  const { isAuthenticated, hasLiveSession } = useAuth();
  const providerInstanceId = usePrivyProviderInstanceId();
  const latestPrivyUserRef = useRef<PrivyUserLike | null>(null);
  const latestPrivyIdentityTokenRef = useRef<string | null>(null);
  const lastLoggedSdkSnapshotRef = useRef<string | null>(null);

  useEffect(() => {
    const unregister = registerPreLogoutHook(async () => {
      try {
        await privyLogout();
      } catch (error) {
        console.warn("[AuthInitializer] Privy logout in pre-logout hook failed:", error);
      }
    });

    return unregister;
  }, [privyLogout]);

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
    const snapshotKey = JSON.stringify({
      providerInstanceId,
      ready,
      authenticated,
      userId: user?.id ?? null,
      hookIdentityTokenPresent: Boolean(latestPrivyIdentityTokenRef.current),
      isAuthenticated,
      hasLiveSession,
    });

    if (lastLoggedSdkSnapshotRef.current === snapshotKey) {
      return;
    }
    lastLoggedSdkSnapshotRef.current = snapshotKey;

    console.info("[AuthFlow] AuthInitializer Privy SDK snapshot", {
      providerInstanceId,
      ready,
      authenticated,
      userId: user?.id ?? null,
      hookIdentityTokenPresent: Boolean(latestPrivyIdentityTokenRef.current),
      isAuthenticated,
      hasLiveSession,
    });
  }, [authenticated, hasLiveSession, identityToken, isAuthenticated, providerInstanceId, ready, user]);

  useEffect(() => {
    if (!isAuthenticated) {
      return;
    }

    clearPrivyLoginIntent();
  }, [isAuthenticated]);

  useEffect(() => {
    if (authenticated) {
      return;
    }

    latestPrivyUserRef.current = null;
    console.info("[AuthFlow] AuthInitializer applying anonymous state because Privy SDK is not authenticated", {
      providerInstanceId,
      ready,
      authenticated,
      previousUserId: user?.id ?? null,
      bootstrapSnapshot: readPrivyAuthBootstrapSnapshot(),
    });
    setPrivyAuthAnonymousState("AuthInitializer");
  }, [authenticated, providerInstanceId, ready, user]);

  useEffect(() => {
    if (!ready || !authenticated || !user) {
      return;
    }

    const snapshot = readPrivyAuthBootstrapSnapshot();
    const sameUserSnapshot = snapshot?.userId === user.id ? snapshot : null;
    const currentState = sameUserSnapshot?.state ?? "idle";
    const canResumeDeferredUsePrivyLoginHandoff =
      sameUserSnapshot?.owner === "usePrivyLogin" &&
      (sameUserSnapshot.debugCode === "awaiting_privy_sdk_ready" ||
        sameUserSnapshot.debugCode === "awaiting_privy_identity_token_hook") &&
      (Boolean(latestPrivyIdentityTokenRef.current) || (ready && authenticated));
    const canResumeAuthenticatedSdkTokenRequest =
      sameUserSnapshot?.owner === "AuthInitializer" &&
      currentState === "awaiting_identity_token" &&
      sameUserSnapshot.debugCode === "awaiting_privy_identity_token_hook" &&
      ready &&
      authenticated;

    if (hasLiveSession) {
      if (currentState !== "authenticated") {
        setPrivyAuthBootstrapState("authenticated", {
          owner: "AuthInitializer",
          mode: "system",
          userId: user.id,
          detail: "existing backend session available",
        });
      }
      return;
    }

    if (
      sameUserSnapshot &&
      (currentState === "privy_pending" ||
        currentState === "awaiting_identity_token" ||
        currentState === "cooldown" ||
        currentState === "syncing_backend") &&
      !canResumeDeferredUsePrivyLoginHandoff &&
      !canResumeAuthenticatedSdkTokenRequest
    ) {
      console.info("[AuthFlow] AuthInitializer found controller-owned pending state", {
        userId: user.id,
        state: currentState,
        providerInstanceId,
      });
      return;
    }

    if (canResumeDeferredUsePrivyLoginHandoff) {
      console.info("[AuthFlow] AuthInitializer resuming deferred usePrivyLogin handoff", {
        userId: user.id,
        state: currentState,
        providerInstanceId,
        debugCode: sameUserSnapshot?.debugCode,
        hookIdentityTokenPresent: Boolean(latestPrivyIdentityTokenRef.current),
      });
    }

    if (!latestPrivyIdentityTokenRef.current) {
      setPrivyAuthBootstrapState("awaiting_identity_token", {
        owner: "AuthInitializer",
        mode: "auto",
        userId: user.id,
        detail: "waiting for Privy identity token",
        debugCode: "awaiting_privy_identity_token_hook",
      });
      console.info("[AuthFlow] AuthInitializer delegating authenticated SDK state to active identity token request", {
        userId: user.id,
        providerInstanceId,
        ready,
        authenticated,
        hookIdentityTokenPresent: false,
      });
    }

    if (
      sameUserSnapshot &&
      (currentState === "failed" ||
        currentState === "failed_rate_limited" ||
        currentState === "authenticated")
    ) {
      console.info("[AuthFlow] AuthInitializer leaving terminal auth state untouched", {
        userId: user.id,
        state: currentState,
      });
      return;
    }

    console.info("[AuthFlow] AuthInitializer delegating bootstrap to controller", {
      userId: user.id,
      state: currentState,
      providerInstanceId,
    });
    void startPrivyAuthBootstrap({
      owner: "AuthInitializer",
      mode: "auto",
      user: user as PrivyUserLike,
      getLatestUser: () => latestPrivyUserRef.current,
      privyReady: ready,
      privyAuthenticated: authenticated,
      privyIdentityToken: latestPrivyIdentityTokenRef.current,
      getLatestPrivyIdentityToken: () => latestPrivyIdentityTokenRef.current,
      tryExistingBackendSession: true,
      triggerSource: "component_mount",
    });
  }, [authenticated, hasLiveSession, identityToken, ready, user]);

  return <>{children}</>;
}

export function AuthInitializer({ children }: AuthInitializerProps) {
  const privyAvailable = usePrivyAvailable();
  if (!privyAvailable) {
    return <>{children}</>;
  }
  return <AuthInitializerInner>{children}</AuthInitializerInner>;
}
