import { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { usePrivy } from "@privy-io/react-auth";
import { readCachedAuthUserSnapshot, usePrivySyncFailureSnapshot, useSession } from "@/lib/auth-client";
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
  const { data: session, isPending } = useSession();
  const cachedUser = !session?.user ? readCachedAuthUserSnapshot() : null;
  const effectiveUser = session?.user ?? cachedUser;

  if (isPending) {
    return <RouteLoading label="Loading..." />;
  }

  if (effectiveUser) {
    return <Navigate to={getSignedInDestination(effectiveUser.username)} replace />;
  }

  return <>{children}</>;
}

function GuestRouteWithPrivy({ children }: { children: React.ReactNode }) {
  const { data: session, isPending } = useSession();
  const { ready, authenticated } = usePrivy();
  const [graceExpired, setGraceExpired] = useState(false);
  const cachedUser = !session?.user ? readCachedAuthUserSnapshot() : null;
  const effectiveUser = session?.user ?? cachedUser;
  const privySyncFailureSnapshot = usePrivySyncFailureSnapshot();
  const privySyncFailure = !effectiveUser ? privySyncFailureSnapshot : null;
  const activeLoginIntent = !effectiveUser ? readPrivyLoginIntent() : null;
  const hasOAuthReturnHint = activeLoginIntent?.method === "twitter";
  const hasPrivySyncHint = ready && authenticated && !effectiveUser;
  const shouldHoldForOAuthReturn = hasOAuthReturnHint && !ready && !effectiveUser;

  useEffect(() => {
    if (!hasPrivySyncHint && !shouldHoldForOAuthReturn) {
      setGraceExpired(false);
      return;
    }

    const timer = window.setTimeout(() => setGraceExpired(true), 12_000);
    return () => window.clearTimeout(timer);
  }, [hasPrivySyncHint, shouldHoldForOAuthReturn]);

  if (isPending) {
    return <RouteLoading label="Loading..." />;
  }

  if (effectiveUser) {
    return <Navigate to={getSignedInDestination(effectiveUser.username)} replace />;
  }

  if (shouldHoldForOAuthReturn && !graceExpired && !privySyncFailure) {
    return <RouteLoading label="Returning from X..." />;
  }

  if (hasPrivySyncHint && !graceExpired && !privySyncFailure) {
    return <RouteLoading label="Completing sign-in..." />;
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
