import { useEffect, useRef, useState } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { usePrivy } from "@privy-io/react-auth";
import {
  getAuthUiState,
  isPrivyAuthBootstrapStatePending,
  isExplicitLogoutCoolingDown,
  isRecentExplicitLogoutSuppressed,
  readCachedAuthUserSnapshot,
  useAuth,
  usePrivyAuthBootstrapSnapshot,
  usePrivySyncFailureSnapshot,
  useSession,
} from "@/lib/auth-client";
import { usePrivyAvailable } from "@/components/PrivyContext";
import { readPrivyLoginIntent } from "@/lib/privy-login-intent";
import { V2AppShell } from "@/components/layout/V2AppShell";

function isProductRoute(pathname: string): boolean {
  return (
    pathname === "/" ||
    pathname.startsWith("/profile") ||
    pathname.startsWith("/notifications") ||
    pathname.startsWith("/leaderboard") ||
    pathname.startsWith("/post/") ||
    pathname.startsWith("/token/") ||
    pathname.startsWith("/terminal") ||
    pathname.startsWith("/bundle-checker") ||
    pathname.startsWith("/communities") ||
    pathname.startsWith("/raids")
  );
}

function RouteLoading({ label }: { label: string }) {
  const location = useLocation();

  if (isProductRoute(location.pathname)) {
    return (
      <V2AppShell>
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="space-y-3">
            <div className="rounded-[22px] border border-white/[0.07] bg-white/[0.03] px-4 py-4">
              <div className="h-5 w-32 rounded-full bg-white/[0.08]" />
              <div className="mt-3 h-4 w-72 max-w-full rounded-full bg-white/[0.055]" />
            </div>
            <div className="rounded-[22px] border border-white/[0.07] bg-white/[0.03] p-4">
              <div className="h-16 rounded-[16px] border border-white/[0.06] bg-black/20" />
              <div className="mt-3 flex gap-2">
                <div className="h-8 w-20 rounded-[10px] bg-white/[0.06]" />
                <div className="h-8 w-20 rounded-[10px] bg-white/[0.06]" />
                <div className="h-8 w-24 rounded-[10px] bg-white/[0.06]" />
              </div>
            </div>
            <div className="rounded-[22px] border border-white/[0.07] bg-white/[0.025] p-4">
              <div className="h-4 w-40 rounded-full bg-white/[0.06]" />
              <div className="mt-4 h-5 w-64 max-w-full rounded-full bg-white/[0.08]" />
              <div className="mt-3 h-4 w-full rounded-full bg-white/[0.045]" />
            </div>
          </div>
          <div className="hidden space-y-3 lg:block">
            <div className="h-28 rounded-[22px] border border-white/[0.07] bg-white/[0.03]" />
            <div className="h-28 rounded-[22px] border border-white/[0.07] bg-white/[0.03]" />
          </div>
        </div>
      </V2AppShell>
    );
  }

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

  if (isPending && !effectiveUser) {
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
  const { refetch } = useAuth();
  const { ready, authenticated } = usePrivy();
  const bootstrapSnapshot = usePrivyAuthBootstrapSnapshot();
  const location = useLocation();
  const hadTokenHint = useRef(useStoredAuthHint());
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
  const recentlyLoggedOut =
    logoutCooldownActive || isRecentExplicitLogoutSuppressed();
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
            isPrivyAuthBootstrapStatePending(bootstrapSnapshot?.state) ||
            hadTokenHint.current
          )
        )
      );

    if (!shouldAttemptSessionRecovery) {
      return;
    }

    const recoveryKey = [
      location.pathname,
      effectiveUser?.id ?? "anonymous",
      hasLiveSession ? "live" : "pending",
      ready ? "ready" : "not_ready",
      authenticated ? "authenticated" : "not_authenticated",
      bootstrapSnapshot?.state ?? "none",
      bootstrapSnapshot?.userId ?? "none",
      hadTokenHint.current ? "had_hint" : "no_hint",
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
      console.warn("[AuthFlow] ProtectedRoute session recovery probe failed", {
        recoveryKey,
        pathname: location.pathname,
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
    location.pathname,
    privySyncFailure,
    ready,
    recentlyLoggedOut,
    refetch,
  ]);

  if (effectiveUser) {
    hadTokenHint.current = false;
  }

  if (isPending && !effectiveUser) {
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
      // Don't hold if bootstrap has terminally failed — redirect to login so user can retry
      if (
        bootstrapSnapshot?.state === "failed" ||
        bootstrapSnapshot?.state === "failed_rate_limited"
      ) {
        return (
          <LoggedNavigate
            to="/login"
            replace
            reason="privy_sync_hint_with_failed_bootstrap"
            context={{
              pathname: location.pathname,
              ready,
              authenticated,
              hasLiveSession,
              bootstrapState: bootstrapSnapshot?.state ?? null,
              graceExpired,
            }}
          />
        );
      }
      if (privySyncFailure && graceExpired) {
        return (
          <LoggedNavigate
            to="/login"
            replace
            reason="privy_sync_hint_with_sync_failure"
            context={{
              pathname: location.pathname,
              ready,
              authenticated,
              hasLiveSession,
              bootstrapState: bootstrapSnapshot?.state ?? null,
              graceExpired,
            }}
          />
        );
      }
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
