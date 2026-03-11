import { useEffect, useRef, useState } from "react";
import { Navigate } from "react-router-dom";
import { usePrivy } from "@privy-io/react-auth";
import {
  getAuthUiState,
  getExplicitLogoutAt,
  isPrivyAuthBootstrapStatePending,
  isExplicitLogoutCoolingDown,
  readCachedAuthUserSnapshot,
  useAuth,
  usePrivyAuthBootstrapSnapshot,
  usePrivySyncFailureSnapshot,
  useSession,
} from "@/lib/auth-client";
import { usePrivyAvailable } from "@/components/PrivyWalletProvider";
import { readPrivyLoginIntent } from "@/lib/privy-login-intent";

function RouteLoading({ label }: { label: string }) {
  return (
    <div className="flex items-center justify-center min-h-screen bg-background">
      <div className="flex flex-col items-center gap-4">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        <span className="text-muted-foreground text-sm">{label}</span>
      </div>
    </div>
  );
}

function getSignedInDestination(username: string | null | undefined): string {
  return typeof username === "string" && username.trim().length > 0 ? "/" : "/welcome";
}

function GuestRouteFallback({ children }: { children: React.ReactNode }) {
  const { data: session, isPending, hasLiveSession } = useSession();
  const cachedUser = !session?.user ? readCachedAuthUserSnapshot() : null;
  const effectiveUser = session?.user ?? cachedUser;

  if (isPending) {
    return <RouteLoading label="Connecting..." />;
  }

  if (effectiveUser && hasLiveSession) {
    return <Navigate to={getSignedInDestination(effectiveUser.username)} replace />;
  }

  if (effectiveUser && !hasLiveSession) {
    return <RouteLoading label="Signing you in..." />;
  }

  return <>{children}</>;
}

function GuestRouteWithPrivy({ children }: { children: React.ReactNode }) {
  const { data: session, isPending, hasLiveSession } = useSession();
  const { refetch } = useAuth();
  const { ready, authenticated } = usePrivy();
  const bootstrapSnapshot = usePrivyAuthBootstrapSnapshot();
  const [graceExpired, setGraceExpired] = useState(false);
  const sessionRecoveryAttemptRef = useRef<{
    key: string | null;
    startedAt: number;
  }>({
    key: null,
    startedAt: 0,
  });
  const cachedUser = !session?.user ? readCachedAuthUserSnapshot() : null;
  const effectiveUser = session?.user ?? cachedUser;
  const privySyncFailureSnapshot = usePrivySyncFailureSnapshot();
  const logoutCooldownActive = isExplicitLogoutCoolingDown();
  // After explicit logout, suppress Privy auto-bootstrap for longer than the
  // hard cooldown so the user isn't trapped in "Signing you in..." when the
  // Privy SDK is slow to de-authenticate.
  const RECENT_LOGOUT_SUPPRESS_MS = 15_000;
  const recentlyLoggedOut =
    logoutCooldownActive ||
    (getExplicitLogoutAt() > 0 && Date.now() - getExplicitLogoutAt() < RECENT_LOGOUT_SUPPRESS_MS);
  const privySyncFailure = !effectiveUser ? privySyncFailureSnapshot : null;
  const activeLoginIntent =
    !effectiveUser && !recentlyLoggedOut ? readPrivyLoginIntent() : null;
  const hasOAuthReturnHint = activeLoginIntent?.method === "twitter";
  const hasPrivyHydrationHint =
    bootstrapSnapshot?.state === "privy_hydrating" && !effectiveUser && !recentlyLoggedOut;
  const hasPrivySyncHint = ready && authenticated && !effectiveUser && !recentlyLoggedOut;
  const authUiState = getAuthUiState({
    snapshot: bootstrapSnapshot,
    privyAuthenticated: authenticated,
    logoutCoolingDown: recentlyLoggedOut,
  });
  const shouldHoldForOAuthReturn =
    hasOAuthReturnHint && !ready && !effectiveUser && !recentlyLoggedOut;
  const shouldHoldForConfirmedSession = Boolean(effectiveUser) && !hasLiveSession;
  const shouldHoldForRecovery =
    hasPrivyHydrationHint ||
    (hasPrivySyncHint &&
      authUiState !== "rate_limited" &&
      authUiState !== "finalizing_identity_verification") ||
    shouldHoldForOAuthReturn ||
    shouldHoldForConfirmedSession;

  useEffect(() => {
    if (!shouldHoldForRecovery) {
      setGraceExpired(false);
      return;
    }

    const timer = window.setTimeout(() => setGraceExpired(true), 12_000);
    return () => window.clearTimeout(timer);
  }, [shouldHoldForRecovery]);

  useEffect(() => {
    const shouldAttemptSessionRecovery =
      !recentlyLoggedOut &&
      !isPending &&
      !privySyncFailure &&
      (
        (Boolean(effectiveUser) && !hasLiveSession) ||
        (
          !effectiveUser &&
          (
            (ready && authenticated) ||
            bootstrapSnapshot?.state === "authenticated" ||
            isPrivyAuthBootstrapStatePending(bootstrapSnapshot?.state)
          )
        )
      );

    if (!shouldAttemptSessionRecovery) {
      return;
    }

    const recoveryKey = [
      effectiveUser?.id ?? "anonymous",
      hasLiveSession ? "live" : "pending",
      ready ? "ready" : "not_ready",
      authenticated ? "authenticated" : "not_authenticated",
      bootstrapSnapshot?.state ?? "none",
      bootstrapSnapshot?.userId ?? "none",
    ].join(":");
    const lastAttempt = sessionRecoveryAttemptRef.current;
    if (lastAttempt.key === recoveryKey && Date.now() - lastAttempt.startedAt < 4000) {
      return;
    }

    sessionRecoveryAttemptRef.current = {
      key: recoveryKey,
      startedAt: Date.now(),
    };

    void refetch().catch((error) => {
      console.warn("[AuthFlow] GuestRoute session recovery probe failed", {
        recoveryKey,
        message: error instanceof Error ? error.message : String(error),
      });
    });
  }, [
    authenticated,
    bootstrapSnapshot?.state,
    bootstrapSnapshot?.userId,
    effectiveUser,
    hasLiveSession,
    isPending,
    privySyncFailure,
    ready,
    recentlyLoggedOut,
    refetch,
  ]);

  if (isPending) {
    return <RouteLoading label="Connecting..." />;
  }

  if (effectiveUser && hasLiveSession) {
    return <Navigate to={getSignedInDestination(effectiveUser.username)} replace />;
  }

  if (effectiveUser && !hasLiveSession) {
    if (privySyncFailure && graceExpired) {
      return <>{children}</>;
    }
    return <RouteLoading label="Signing you in..." />;
  }

  if (shouldHoldForOAuthReturn && !graceExpired && !privySyncFailure) {
    return <RouteLoading label="Connecting..." />;
  }

  if (hasPrivyHydrationHint && !graceExpired && !privySyncFailure) {
    return <RouteLoading label="Connecting..." />;
  }

  if (hasPrivySyncHint) {
    if (
      authUiState === "rate_limited" ||
      authUiState === "finalizing_identity_verification"
    ) {
      return <>{children}</>;
    }
    if (bootstrapSnapshot?.state === "failed" || bootstrapSnapshot?.state === "failed_rate_limited") {
      return <>{children}</>;
    }
    if (privySyncFailure && graceExpired) {
      return <>{children}</>;
    }
    return <RouteLoading label="Signing you in..." />;
  }

  return <>{children}</>;
}

export function GuestRoute({ children }: { children: React.ReactNode }) {
  const privyAvailable = usePrivyAvailable();

  if (!privyAvailable) {
    return <GuestRouteFallback>{children}</GuestRouteFallback>;
  }

  return <GuestRouteWithPrivy>{children}</GuestRouteWithPrivy>;
}
