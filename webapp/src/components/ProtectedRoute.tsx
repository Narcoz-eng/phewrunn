import { useEffect, useRef, useState } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { usePrivy } from "@privy-io/react-auth";
import {
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
    return <RouteLoading label="Loading..." />;
  }

  if (!effectiveUser) {
    if (hadTokenHint.current && !graceExpired) {
      return <RouteLoading label="Signing in..." />;
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
      return <RouteLoading label="Finalizing sign-in..." />;
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
    return <RouteLoading label="Preparing your account..." />;
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
  const privySyncFailure = !effectiveUser ? privySyncFailureSnapshot : null;
  const activeLoginIntent =
    !effectiveUser && !logoutCooldownActive ? readPrivyLoginIntent() : null;
  const hasOAuthReturnHint = activeLoginIntent?.method === "twitter";
  const hasPrivyHydrationHint =
    bootstrapSnapshot?.state === "privy_hydrating" && !effectiveUser && !logoutCooldownActive;
  const hasPrivyFinalizationHint =
    bootstrapSnapshot?.state === "awaiting_identity_verification_finalization" &&
    !effectiveUser &&
    !logoutCooldownActive;
  const hasPrivySyncHint = ready && authenticated && !effectiveUser && !logoutCooldownActive;
  const shouldHoldForConfirmedSession = Boolean(effectiveUser) && !hasLiveSession;
  const shouldHoldForRecovery =
    hasPrivyHydrationHint ||
    hasPrivyFinalizationHint ||
    hasPrivySyncHint ||
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
    isPending,
    location.pathname,
    privySyncFailure?.message,
    ready,
    routeAuthStage,
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
      shouldHoldForConfirmedSession,
      privySyncFailure: privySyncFailure?.message ?? null,
    });
  }, [
    effectiveUser,
    hasLiveSession,
    hasPrivyHydrationHint,
    hasPrivyFinalizationHint,
    hasPrivySyncHint,
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
    return <RouteLoading label="Loading..." />;
  }

  if (!effectiveUser) {
    if (privySyncFailure && graceExpired) {
      return (
        <LoggedNavigate
          to="/login"
          replace
          state={{
            from: location.pathname + location.search + location.hash,
            syncError: privySyncFailure.message,
          }}
          reason="privy_no_effective_user_after_grace_with_sync_failure"
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
    if (hasOAuthReturnHint && !ready && !privySyncFailure) {
      return <RouteLoading label={graceExpired ? "Still returning from X..." : "Returning from X..."} />;
    }
    if (hasPrivyHydrationHint) {
      return (
        <RouteLoading
          label={
            graceExpired
              ? "Still checking your Privy session..."
              : "Checking your Privy session..."
          }
        />
      );
    }
    if (hasPrivySyncHint) {
      return (
        <RouteLoading
          label={
            privySyncFailure
              ? (graceExpired ? "Retrying sign-in..." : "Recovering your session...")
              : (graceExpired ? "Still finalizing sign-in..." : "Completing sign-in...")
          }
        />
      );
    }
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
            privySyncFailure: privySyncFailure.message,
          }}
        />
      );
    }
    if (hadTokenHint.current && !graceExpired) {
      return <RouteLoading label="Signing in..." />;
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
    if (privySyncFailure && graceExpired) {
      return (
        <LoggedNavigate
          to="/login"
          replace
          state={{
            from: location.pathname + location.search + location.hash,
            syncError: privySyncFailure.message,
          }}
          reason="privy_effective_user_without_live_session_after_grace"
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
    return (
      <RouteLoading
        label={
          privySyncFailure
            ? (graceExpired ? "Retrying sign-in..." : "Recovering your session...")
            : (graceExpired ? "Still finalizing sign-in..." : "Finalizing sign-in...")
        }
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
