import React, { useEffect, useRef } from "react";
import { usePrivy } from "@privy-io/react-auth";
import {
  registerPreLogoutHook,
  setPrivyAuthAnonymousState,
  setPrivyAuthBootstrapState,
  startPrivyAuthBootstrap,
  useAuth,
  readPrivyAuthBootstrapSnapshot,
} from "@/lib/auth-client";
import { usePrivyAvailable } from "@/components/PrivyWalletProvider";
import type { PrivyUserLike } from "@/lib/privy-user";
import { clearPrivyLoginIntent } from "@/lib/privy-login-intent";

interface AuthInitializerProps {
  children: React.ReactNode;
}

function AuthInitializerInner({ children }: AuthInitializerProps) {
  const { ready, authenticated, user, logout: privyLogout } = usePrivy();
  const { isAuthenticated, hasLiveSession } = useAuth();
  const latestPrivyUserRef = useRef<PrivyUserLike | null>(null);

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
    setPrivyAuthAnonymousState("AuthInitializer");
  }, [authenticated]);

  useEffect(() => {
    if (!ready || !authenticated || !user) {
      return;
    }

    const snapshot = readPrivyAuthBootstrapSnapshot();
    const sameUserSnapshot = snapshot?.userId === user.id ? snapshot : null;
    const currentState = sameUserSnapshot?.state ?? "idle";

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
        currentState === "syncing_backend")
    ) {
      console.info("[AuthFlow] AuthInitializer found controller-owned pending state", {
        userId: user.id,
        state: currentState,
      });
      return;
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
    });
    void startPrivyAuthBootstrap({
      owner: "AuthInitializer",
      mode: "auto",
      user: user as PrivyUserLike,
      getLatestUser: () => latestPrivyUserRef.current,
    });
  }, [authenticated, hasLiveSession, ready, user]);

  return <>{children}</>;
}

export function AuthInitializer({ children }: AuthInitializerProps) {
  const privyAvailable = usePrivyAvailable();
  if (!privyAvailable) {
    return <>{children}</>;
  }
  return <AuthInitializerInner>{children}</AuthInitializerInner>;
}
