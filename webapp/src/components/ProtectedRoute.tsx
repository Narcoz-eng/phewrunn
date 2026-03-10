import { useEffect, useRef, useState } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { usePrivy } from "@privy-io/react-auth";
import {
  getAuthUiState,
  getExplicitLogoutAt,
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

function LoggedNavigate({
  to,
  replace = false,
  state,
  reason,
  context,
}: {
  to: string;
  replace?: boolean;
  state?: unknown;
  reason: string;
  context: Record<string, unknown>;
}) {
  useEffect(() => {
    console.warn("[AuthFlow] ProtectedRoute redirect", {
      to,
      replace,
      reason,
      ...context,
    });
  }, [context, reason, replace, state, to]);

  return <Navigate to={to} replace={replace} state={state} />;
}

function useStoredAuthHint(): boolean {
  if (isExplicitLogoutCoolingDown()) {
    return false;
  }
  try {
    if (sessionStorage.getItem("phew.auth.session.v1")) return true;
  } catch {
    // ignore
  }
  return false;
}

function hasCompletedHandle(username: string | null | undefined): boolean {
  return typeof username === "string" && username.trim().length > 0;
}

function getPrivyHandoffLabel(state: ReturnType<typeof getAuthUiState>, detail: string | null, graceExpired: boolean): string {
  void detail;
  void graceExpired;
  switch (state) {
    case "hydrating":
      return "Connecting...";
    case "finalizing_identity_verification":
      return "Signing you in...";
    case "rate_limited":
      return "Sign-in failed. Please retry.";
    case "connecting_backend_session":
      return "Signing you in...";
    case "logout_in_progress":
      return "Connecting...";
    default:
      return "Signing you in...";
  }
}

function ProtectedRouteFallback({
  children,
  allowMissingUsername,
}: {
  children: React.ReactNode;
  allowMissingUsername: boolean;
}) {
  const { data: session, isPending, hasLiveSession } = useSession();
  const location = useLocation();
  const hadTokenHint = useRef(useStoredAuthHint());
  const [graceExpired, setGraceExpired] = useState(false);
  const cachedUser = !session?.user ? readCachedAuthUserSnapshot() : null;
  const effectiveUser = session?.user ?? cachedUser;

  useEffect(() => {
    if (effectiveUser || isPending || !hadTokenHint.current) return;
    const timer = window.setTimeout(() => setGraceExpired(true), 4_000);
    return () => window.clearTimeout(timer);
  }, [effectiveUser, isPending]);

  if (effectiveUser) {
    hadTokenHint.current = false;
  }

  if (isPending) {
    return <RouteLoading label="Connecting..." />;
  }

  if (!effectiveUser) {
    if (hadTokenHint.current && !graceExpired) {
      return <RouteLoading label="Signing you in..." />;
    }
    return (
      <LoggedNavigate
        to="/login"
        replace
        reason="fallback_no_effective_user"
        context={{
          pathname: location.pathname,
          hasLiveSession,
          isPending,
          graceExpired,
          hadTokenHint: hadTokenHint.current,
        }}
      />
    );
  }

  if (!hasLiveSession) {
    if (!graceExpired) {
      return <RouteLoading label="Signing you in..." />;
    }
    return (
      <LoggedNavigate
        to="/login"
        replace
        reason="fallback_effective_user_without_live_session"
        context={{
          pathname: location.pathname,
          effectiveUserId: effectiveUser.id,
          hasLiveSession,
          isPending,
          graceExpired,
        }}
      />
    );
  }

  if (!allowMissingUsername && !hasCompletedHandle(effectiveUser.username)) {
    return (
      <Navigate
        to="/welcome"
        replace
        state={{ from: `${location.pathname}${location.search}${location.hash}` }}
      />
    );
  }

  if (!session?.user) {
    return <RouteLoading label="Connecting..." />;
  }

  return <>{children}</>;
}

function ProtectedRouteWithPrivy({
  children,
  allowMissingUsername,
}: {
  children: React.ReactNode;
  allowMissingUsername: boolean;
}) {
  const { data: session, isPending, hasLiveSession } = useSession();
  const { ready, authenticated } = usePrivy();
  const bootstrapSnapshot = usePrivyAuthBootstrapSnapshot();
  const location = useLocation();
  const hadTokenHint = useRef(useStoredAuthHint());
  const [graceExpired, setGraceExpired] = useState(false);
  const cachedUser = !session?.user ? readCachedAuthUserSnapshot() : null;
  const effectiveUser = session?.user ?? cachedUser;
  const privySyncFailureSnapshot = usePrivySyncFailureSnapshot();
  const logoutCooldownActive = isExplicitLogoutCoolingDown();
  // Suppress Privy auto-bootstrap for a longer window after explicit logout
  // so the user isn't stuck on a loading screen while the Privy SDK settles.
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
  const hasPrivyFinalizationHint =
    bootstrapSnapshot?.state === "awaiting_identity_verification_finalization" &&
    !effectiveUser &&
    !recentlyLoggedOut;
  const hasPrivySyncHint = ready && authenticated && !effectiveUser && !recentlyLoggedOut;
  const authUiState = getAuthUiState({
    snapshot: bootstrapSnapshot,
    privyAuthenticated: authenticated,
    logoutCoolingDown: recentlyLoggedOut,
  });
  const shouldHoldAuthenticatedPrivyState =
    ready &&
    authenticated &&
    !recentlyLoggedOut &&
    !privySyncFailure &&
    bootstrapSnapshot?.state !== "failed" &&
    bootstrapSnapshot?.state !== "failed_rate_limited";
  const shouldHoldForConfirmedSession = Boolean(effectiveUser) && !hasLiveSession;
  const shouldHoldForRecovery =
    hasPrivyHydrationHint ||
    hasPrivyFinalizationHint ||
    hasPrivySyncHint ||
    shouldHoldAuthenticatedPrivyState ||
    hasOAuthReturnHint ||
    shouldHoldForConfirmedSession ||
    hadTokenHint.current;
  const routeAuthStage =
    isPending
      ? "trying_to_connect"
      : effectiveUser && hasLiveSession
        ? "authenticated"
        : privySyncFailure
          ? "failed"
          : hasPrivyHydrationHint ||
              hasPrivyFinalizationHint ||
              hasPrivySyncHint ||
              shouldHoldAuthenticatedPrivyState ||
              shouldHoldForConfirmedSession ||
              hadTokenHint.current
            ? "trying_to_connect"
            : "anonymous";

  useEffect(() => {
    console.info("[AuthColdStart] protected route stage", {
      stage: routeAuthStage,
      pathname: location.pathname,
      ready,
      authenticated,
      effectiveUserId: effectiveUser?.id ?? null,
      hasLiveSession,
      isPending,
      hasPrivyHydrationHint,
      hasPrivyFinalizationHint,
      hasPrivySyncHint,
      authUiState,
      shouldHoldAuthenticatedPrivyState,
      hasOAuthReturnHint,
      shouldHoldForConfirmedSession,
      hadTokenHint: hadTokenHint.current,
      privySyncFailure: privySyncFailure?.message ?? null,
    });
  }, [
    authenticated,
    effectiveUser?.id,
    hasLiveSession,
    hasPrivyHydrationHint,
    hasPrivyFinalizationHint,
    hasOAuthReturnHint,
    hasPrivySyncHint,
    authUiState,
    isPending,
    location.pathname,
    privySyncFailure?.message,
    ready,
    routeAuthStage,
    shouldHoldAuthenticatedPrivyState,
    shouldHoldForConfirmedSession,
  ]);

  useEffect(() => {
    if (!effectiveUser || routeAuthStage !== "trying_to_connect") {
      return;
    }
    console.warn("[AuthColdStart] protected route is holding pending state despite recovered user", {
      pathname: location.pathname,
      effectiveUserId: effectiveUser.id,
      hasLiveSession,
      isPending,
      hasPrivyHydrationHint,
      hasPrivyFinalizationHint,
      hasPrivySyncHint,
      authUiState,
      shouldHoldForConfirmedSession,
      privySyncFailure: privySyncFailure?.message ?? null,
    });
  }, [
    effectiveUser,
    hasLiveSession,
    hasPrivyHydrationHint,
    hasPrivyFinalizationHint,
    hasPrivySyncHint,
    authUiState,
    isPending,
    location.pathname,
    privySyncFailure?.message,
    routeAuthStage,
    shouldHoldForConfirmedSession,
  ]);

  useEffect(() => {
    if (
      (effectiveUser && hasLiveSession) ||
      isPending ||
      !shouldHoldForRecovery
    ) {
      if (!isPending) {
        setGraceExpired(false);
      }
      return;
    }
    const timer = window.setTimeout(
      () => setGraceExpired(true),
      hasPrivyHydrationHint || hasPrivySyncHint || hasOAuthReturnHint || shouldHoldForConfirmedSession ? 12_000 : 4_000
    );
    return () => window.clearTimeout(timer);
  }, [effectiveUser, hasLiveSession, hasOAuthReturnHint, hasPrivyHydrationHint, hasPrivySyncHint, isPending, shouldHoldForConfirmedSession, shouldHoldForRecovery]);

  if (effectiveUser) {
    hadTokenHint.current = false;
  }

  if (isPending) {
    return <RouteLoading label="Connecting..." />;
  }

  if (!effectiveUser) {
    if (privySyncFailure) {
      return (
        <LoggedNavigate
          to="/login"
          replace
          state={{
            from: location.pathname + location.search + location.hash,
            syncError: privySyncFailure.message,
          }}
          reason="privy_no_effective_user_with_sync_failure"
          context={{
            pathname: location.pathname,
            ready,
            authenticated,
            hasLiveSession,
            isPending,
            hasPrivySyncHint,
            hadTokenHint: hadTokenHint.current,
            graceExpired,
            privySyncFailure: privySyncFailure.message,
          }}
        />
      );
    }
    if (shouldHoldAuthenticatedPrivyState) {
      return (
        <RouteLoading
          label={getPrivyHandoffLabel(authUiState, bootstrapSnapshot?.detail ?? null, graceExpired)}
        />
      );
    }
    if (hasOAuthReturnHint && !ready && !privySyncFailure) {
      return <RouteLoading label="Connecting..." />;
    }
    if (hasPrivyHydrationHint) {
      return <RouteLoading label="Connecting..." />;
    }
    if (hasPrivyFinalizationHint) {
      return <RouteLoading label="Signing you in..." />;
    }
    if (hasPrivySyncHint) {
      return <RouteLoading label="Signing you in..." />;
    }
    if (hadTokenHint.current && !graceExpired) {
      return <RouteLoading label="Signing you in..." />;
    }
    return (
      <LoggedNavigate
        to="/login"
        replace
        reason="privy_no_effective_user"
        context={{
          pathname: location.pathname,
          ready,
          authenticated,
          hasLiveSession,
          isPending,
          hasPrivySyncHint,
          hadTokenHint: hadTokenHint.current,
          graceExpired,
        }}
      />
    );
  }

  if (!hasLiveSession) {
    if (privySyncFailure) {
      return (
        <LoggedNavigate
          to="/login"
          replace
          state={{
            from: location.pathname + location.search + location.hash,
            syncError: privySyncFailure.message,
          }}
          reason="privy_effective_user_without_live_session_after_sync_failure"
          context={{
            pathname: location.pathname,
            ready,
            authenticated,
            effectiveUserId: effectiveUser.id,
            hasLiveSession,
            isPending,
            graceExpired,
            privySyncFailure: privySyncFailure.message,
          }}
        />
      );
    }
    if (shouldHoldAuthenticatedPrivyState) {
      return (
        <RouteLoading
          label={getPrivyHandoffLabel(authUiState, bootstrapSnapshot?.detail ?? null, graceExpired)}
        />
      );
    }
    return <RouteLoading label="Signing you in..." />;
  }

  if (!allowMissingUsername && !hasCompletedHandle(effectiveUser.username)) {
    return (
      <Navigate
        to="/welcome"
        replace
        state={{ from: `${location.pathname}${location.search}${location.hash}` }}
      />
    );
  }

  return <>{children}</>;
}

export function ProtectedRoute({
  children,
  allowMissingUsername = false,
}: {
  children: React.ReactNode;
  allowMissingUsername?: boolean;
}) {
  const privyAvailable = usePrivyAvailable();

  if (!privyAvailable) {
    return (
      <ProtectedRouteFallback allowMissingUsername={allowMissingUsername}>
        {children}
      </ProtectedRouteFallback>
    );
  }

  return (
    <ProtectedRouteWithPrivy allowMissingUsername={allowMissingUsername}>
      {children}
    </ProtectedRouteWithPrivy>
  );
}
