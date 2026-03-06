import { useEffect, useRef, useState } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { usePrivy } from "@privy-io/react-auth";
import { getExplicitLogoutAt, readCachedAuthUserSnapshot, usePrivySyncFailureSnapshot, useSession } from "@/lib/auth-client";
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

function useStoredAuthHint(): boolean {
  const logoutAt = getExplicitLogoutAt();
  if (logoutAt > 0 && Date.now() - logoutAt < 10_000) {
    return false;
  }
  try {
    if (localStorage.getItem("auth-token")) return true;
  } catch {
    // ignore
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
  const { data: session, isPending } = useSession();
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
    return <Navigate to="/login" replace />;
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
  const { data: session, isPending } = useSession();
  const { ready, authenticated } = usePrivy();
  const location = useLocation();
  const hadTokenHint = useRef(useStoredAuthHint());
  const [graceExpired, setGraceExpired] = useState(false);
  const cachedUser = !session?.user ? readCachedAuthUserSnapshot() : null;
  const effectiveUser = session?.user ?? cachedUser;
  const privySyncFailureSnapshot = usePrivySyncFailureSnapshot();
  const privySyncFailure = !effectiveUser ? privySyncFailureSnapshot : null;
  const activeLoginIntent = !effectiveUser ? readPrivyLoginIntent() : null;
  const hasOAuthReturnHint = activeLoginIntent?.method === "twitter";
  const hasPrivySyncHint = ready && authenticated && !effectiveUser;

  useEffect(() => {
    if (
      effectiveUser ||
      isPending ||
      privySyncFailure ||
      (!hadTokenHint.current && !hasPrivySyncHint && !hasOAuthReturnHint)
    ) {
      return;
    }
    const timer = window.setTimeout(
      () => setGraceExpired(true),
      hasPrivySyncHint || hasOAuthReturnHint ? 12_000 : 4_000
    );
    return () => window.clearTimeout(timer);
  }, [effectiveUser, hasOAuthReturnHint, hasPrivySyncHint, isPending, privySyncFailure]);

  if (effectiveUser) {
    hadTokenHint.current = false;
  }

  if (isPending) {
    return <RouteLoading label="Loading..." />;
  }

  if (!effectiveUser) {
    if (hasOAuthReturnHint && !ready && !privySyncFailure) {
      return <RouteLoading label={graceExpired ? "Still returning from X..." : "Returning from X..."} />;
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
        <Navigate
          to="/login"
          replace
          state={{
            from: location.pathname + location.search + location.hash,
            syncError: privySyncFailure.message,
          }}
        />
      );
    }
    if (hadTokenHint.current && !graceExpired) {
      return <RouteLoading label="Signing in..." />;
    }
    return <Navigate to="/login" replace />;
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
