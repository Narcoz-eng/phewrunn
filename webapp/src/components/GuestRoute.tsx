import { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { usePrivy } from "@privy-io/react-auth";
import {
  getAuthUiState,
  isExplicitLogoutCoolingDown,
  readCachedAuthUserSnapshot,
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
  const { ready, authenticated } = usePrivy();
  const bootstrapSnapshot = usePrivyAuthBootstrapSnapshot();
  const [graceExpired, setGraceExpired] = useState(false);
  const cachedUser = !session?.user ? readCachedAuthUserSnapshot() : null;
  const effectiveUser = session?.user ?? cachedUser;
  const privySyncFailureSnapshot = usePrivySyncFailureSnapshot();
  const logoutCooldownActive = isExplicitLogoutCoolingDown();
  const privySyncFailure = !effectiveUser ? privySyncFailureSnapshot : null;
  const activeLoginIntent =
    !effectiveUser && !logoutCooldownActive ? readPrivyLoginIntent() : null;
  const hasOAuthReturnHint = activeLoginIntent?.method === "twitter";
  const hasPrivyHydrationHint =
    bootstrapSnapshot?.state === "privy_hydrating" && !effectiveUser && !logoutCooldownActive;
  const hasPrivySyncHint = ready && authenticated && !effectiveUser && !logoutCooldownActive;
  const authUiState = getAuthUiState({
    snapshot: bootstrapSnapshot,
    privyAuthenticated: authenticated,
    logoutCoolingDown: logoutCooldownActive,
  });
  const shouldHoldForOAuthReturn =
    hasOAuthReturnHint && !ready && !effectiveUser && !logoutCooldownActive;
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
