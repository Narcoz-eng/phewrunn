import React, { useEffect, useRef, useState } from "react";
import { usePrivy, useIdentityToken, useUser } from "@privy-io/react-auth";
import {
  hasValidatedAuthSession,
  isPrivyAuthBootstrapStatePending,
  registerPreLogoutHook,
  readCachedAuthUserSnapshot,
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

const PRIVY_INITIAL_HYDRATION_GRACE_MS = 4_000;

function AuthInitializerInner({ children }: AuthInitializerProps) {
  const { ready, authenticated, user, logout: privyLogout, getAccessToken } = usePrivy();
  const { refreshUser } = useUser();
  const { identityToken } = useIdentityToken();
  const { isAuthenticated, hasLiveSession } = useAuth();
  const providerInstanceId = usePrivyProviderInstanceId();
  const latestPrivyUserRef = useRef<PrivyUserLike | null>(null);
  const latestPrivyIdentityTokenRef = useRef<string | null>(null);
  const lastLoggedSdkSnapshotRef = useRef<string | null>(null);
  const [initialHydrationTimedOut, setInitialHydrationTimedOut] = useState(false);
  const initialHydrationStartAtRef = useRef(Date.now());

  useEffect(() => {
    initialHydrationStartAtRef.current = Date.now();
    setInitialHydrationTimedOut(false);
  }, [providerInstanceId]);

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
    if (ready || authenticated || hasLiveSession) {
      return;
    }

    const timer = window.setTimeout(() => {
      setInitialHydrationTimedOut(true);
    }, PRIVY_INITIAL_HYDRATION_GRACE_MS);

    return () => window.clearTimeout(timer);
  }, [authenticated, hasLiveSession, ready]);

  useEffect(() => {
    if (ready || authenticated || hasLiveSession) {
      if (initialHydrationTimedOut) {
        setInitialHydrationTimedOut(false);
      }
      return;
    }

    if (Date.now() - initialHydrationStartAtRef.current >= PRIVY_INITIAL_HYDRATION_GRACE_MS) {
      if (!initialHydrationTimedOut) {
        setInitialHydrationTimedOut(true);
      }
    }
  }, [authenticated, hasLiveSession, initialHydrationTimedOut, ready]);

  useEffect(() => {
    if (authenticated) {
      const snapshot = readPrivyAuthBootstrapSnapshot();
      if (snapshot?.state === "privy_hydrating") {
        console.info("[AuthFlow] authenticated Privy state resumed before anonymous commit", {
          providerInstanceId,
          ready,
          authenticated,
          userId: user?.id ?? null,
          waitedMs: Date.now() - initialHydrationStartAtRef.current,
        });
      }
      return;
    }

    latestPrivyUserRef.current = null;
    const recoveredBackendUser = readCachedAuthUserSnapshot();
    if (isAuthenticated || recoveredBackendUser) {
      console.info("[AuthFlow] recovered backend auth preserved during Privy hydration", {
        providerInstanceId,
        ready,
        authenticated,
        previousUserId: user?.id ?? null,
        recoveredBackendUserId: recoveredBackendUser?.id ?? null,
        hasLiveSession,
      });
      return;
    }
    if (!ready && !hasLiveSession && !initialHydrationTimedOut) {
      const snapshot = readPrivyAuthBootstrapSnapshot();
      if (snapshot?.state !== "privy_hydrating") {
        setPrivyAuthBootstrapState("privy_hydrating", {
          owner: "AuthInitializer",
          mode: "auto",
          userId: null,
          detail: "waiting for Privy SDK hydration",
          debugCode: "awaiting_privy_initial_hydration",
        });
      }
      console.info("[AuthFlow] anonymous suppressed during initial Privy hydration", {
        providerInstanceId,
        ready,
        authenticated,
        previousUserId: user?.id ?? null,
        waitedMs: Date.now() - initialHydrationStartAtRef.current,
      });
      return;
    }
    console.info("[AuthFlow] AuthInitializer applying anonymous state because Privy SDK is not authenticated", {
      providerInstanceId,
      ready,
      authenticated,
      previousUserId: user?.id ?? null,
      bootstrapSnapshot: readPrivyAuthBootstrapSnapshot(),
      hydrationTimedOut: initialHydrationTimedOut,
    });
    console.info("[AuthFlow] anonymous applied after hydrated unauthenticated state", {
      providerInstanceId,
      ready,
      authenticated,
      previousUserId: user?.id ?? null,
      hydrationTimedOut: initialHydrationTimedOut,
      waitedMs: Date.now() - initialHydrationStartAtRef.current,
    });
    setPrivyAuthAnonymousState("AuthInitializer");
  }, [authenticated, hasLiveSession, initialHydrationTimedOut, isAuthenticated, providerInstanceId, ready, user]);

  useEffect(() => {
    if (!ready || !authenticated || !user) {
      return;
    }

    const snapshot = readPrivyAuthBootstrapSnapshot();
    const authoritativeBackendUser = readCachedAuthUserSnapshot();
    const hasAuthoritativeBackendSession =
      Boolean(authoritativeBackendUser?.id) && hasValidatedAuthSession();
    const sameUserSnapshot = snapshot?.userId === user.id ? snapshot : null;
    const currentState = sameUserSnapshot?.state ?? snapshot?.state ?? "idle";
    const hookIdentityTokenPresent = Boolean(latestPrivyIdentityTokenRef.current);
    const recoveredBackendUser = authoritativeBackendUser;
    const hasRecoveredBackendUser = Boolean(recoveredBackendUser?.id);
    const canResumeUsePrivyLoginHandoff =
      sameUserSnapshot?.owner === "usePrivyLogin" &&
      (sameUserSnapshot.debugCode === "awaiting_privy_sdk_ready" ||
        sameUserSnapshot.debugCode === "awaiting_privy_identity_token_hook") &&
      (hookIdentityTokenPresent || (ready && authenticated));
    const canResumeAuthInitializerTokenHandoff =
      sameUserSnapshot?.owner === "AuthInitializer" &&
      currentState === "awaiting_identity_token" &&
      sameUserSnapshot.debugCode === "awaiting_privy_identity_token_hook" &&
      (hookIdentityTokenPresent || (ready && authenticated));
    const canResumeAuthInitializerFinalization =
      sameUserSnapshot?.owner === "AuthInitializer" &&
      currentState === "awaiting_identity_verification_finalization" &&
      hookIdentityTokenPresent;
    const shouldPreserveSettledAuth =
      hasAuthoritativeBackendSession ||
      hasLiveSession ||
      (snapshot?.state === "authenticated" && hasRecoveredBackendUser);

    if (shouldPreserveSettledAuth) {
      if (snapshot?.state !== "authenticated") {
        setPrivyAuthBootstrapState("authenticated", {
          owner: "system",
          mode: "system",
          userId: user.id,
          detail: "existing backend session available",
          debugCode: "existing_backend_session_available",
        });
      }
      clearPrivyLoginIntent();
      return;
    }

    if (hasRecoveredBackendUser) {
      console.info("[AuthFlow] AuthInitializer deferring Privy bootstrap while recovered backend auth is being confirmed", {
        privyUserId: user.id,
        recoveredBackendUserId: recoveredBackendUser?.id ?? null,
        state: currentState,
        providerInstanceId,
        hasLiveSession,
      });
      return;
    }

    if (
      sameUserSnapshot &&
      isPrivyAuthBootstrapStatePending(currentState) &&
      !canResumeUsePrivyLoginHandoff &&
      !canResumeAuthInitializerTokenHandoff &&
      !canResumeAuthInitializerFinalization
    ) {
      console.info("[AuthFlow] AuthInitializer found controller-owned pending state", {
        userId: user.id,
        state: currentState,
        providerInstanceId,
      });
      return;
    }

    if (
      sameUserSnapshot &&
      (currentState === "failed_rate_limited" ||
        currentState === "authenticated" ||
        (sameUserSnapshot.owner === "AuthInitializer" &&
          currentState === "failed" &&
          !hookIdentityTokenPresent))
    ) {
      console.info("[AuthFlow] AuthInitializer leaving terminal auth state untouched", {
        userId: user.id,
        state: currentState,
      });
      return;
    }

    const delegatedOwner = canResumeUsePrivyLoginHandoff
      ? "usePrivyLogin"
      : "AuthInitializer";
    const delegatedMode = canResumeUsePrivyLoginHandoff ? "manual" : "auto";
    const delegatedTriggerSource = canResumeUsePrivyLoginHandoff
      ? "manual_user_action"
      : "component_mount";

    if (canResumeUsePrivyLoginHandoff) {
      console.info("[AuthFlow] AuthInitializer resuming deferred usePrivyLogin handoff", {
        userId: user.id,
        state: currentState,
        providerInstanceId,
        debugCode: sameUserSnapshot?.debugCode,
        hookIdentityTokenPresent,
      });
    } else if (canResumeAuthInitializerFinalization) {
      console.info(
        "[AuthFlow] AuthInitializer resuming finalization-pending handoff after hook token became available",
        {
          userId: user.id,
          state: currentState,
          providerInstanceId,
          debugCode: sameUserSnapshot?.debugCode,
          hookIdentityTokenPresent,
        }
      );
    } else if (!hookIdentityTokenPresent) {
      if (
        currentState !== "awaiting_identity_token" ||
        sameUserSnapshot?.owner !== "AuthInitializer" ||
        sameUserSnapshot?.debugCode !== "awaiting_privy_identity_token_hook"
      ) {
        setPrivyAuthBootstrapState("awaiting_identity_token", {
          owner: "AuthInitializer",
          mode: "auto",
          userId: user.id,
          detail: "waiting for Privy identity token",
          debugCode: "awaiting_privy_identity_token_hook",
        });
      }
      console.info("[AuthFlow] AuthInitializer delegating authenticated SDK state to active identity token request", {
        userId: user.id,
        providerInstanceId,
        ready,
        authenticated,
        hookIdentityTokenPresent: false,
      });
    }

    console.info("[AuthFlow] AuthInitializer delegating bootstrap to controller", {
      userId: user.id,
      state: currentState,
      providerInstanceId,
      delegatedOwner,
      delegatedMode,
      delegatedTriggerSource,
    });
    void startPrivyAuthBootstrap({
      owner: delegatedOwner,
      mode: delegatedMode,
      user: user as PrivyUserLike,
      getLatestUser: () => latestPrivyUserRef.current,
      privyReady: ready,
      privyAuthenticated: authenticated,
      privyIdentityToken: latestPrivyIdentityTokenRef.current,
      getLatestPrivyIdentityToken: () => latestPrivyIdentityTokenRef.current,
      refreshPrivyAuthState: async () => (await refreshUser()) as PrivyUserLike,
      getLatestPrivyAccessToken: () => getAccessToken(),
      tryExistingBackendSession: true,
      triggerSource: delegatedTriggerSource,
    });
  }, [authenticated, getAccessToken, hasLiveSession, identityToken, isAuthenticated, providerInstanceId, ready, refreshUser, user]);

  return <>{children}</>;
}

export function AuthInitializer({ children }: AuthInitializerProps) {
  const privyAvailable = usePrivyAvailable();
  if (!privyAvailable) {
    return <>{children}</>;
  }
  return <AuthInitializerInner>{children}</AuthInitializerInner>;
}
