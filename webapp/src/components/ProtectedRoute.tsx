import { useEffect, useRef, useState } from "react";
import { Navigate } from "react-router-dom";
import { usePrivy } from "@privy-io/react-auth";
import { getExplicitLogoutAt, useSession } from "@/lib/auth-client";
import { usePrivyAvailable } from "@/components/PrivyWalletProvider";

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

function ProtectedRouteFallback({ children }: { children: React.ReactNode }) {
  const { data: session, isPending } = useSession();
  const hadTokenHint = useRef(useStoredAuthHint());
  const [graceExpired, setGraceExpired] = useState(false);

  useEffect(() => {
    if (session?.user || isPending || !hadTokenHint.current) return;
    const timer = window.setTimeout(() => setGraceExpired(true), 4_000);
    return () => window.clearTimeout(timer);
  }, [isPending, session?.user]);

  if (session?.user) {
    hadTokenHint.current = false;
  }

  if (isPending) {
    return <RouteLoading label="Loading..." />;
  }

  if (!session?.user) {
    if (hadTokenHint.current && !graceExpired) {
      return <RouteLoading label="Signing in..." />;
    }
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
}

function ProtectedRouteWithPrivy({ children }: { children: React.ReactNode }) {
  const { data: session, isPending } = useSession();
  const { ready, authenticated } = usePrivy();
  const hadTokenHint = useRef(useStoredAuthHint());
  const [graceExpired, setGraceExpired] = useState(false);
  const hasPrivySyncHint = ready && authenticated && !session?.user;

  useEffect(() => {
    if (session?.user || isPending || (!hadTokenHint.current && !hasPrivySyncHint)) return;
    const timer = window.setTimeout(() => setGraceExpired(true), hasPrivySyncHint ? 12_000 : 4_000);
    return () => window.clearTimeout(timer);
  }, [hasPrivySyncHint, isPending, session?.user]);

  if (session?.user) {
    hadTokenHint.current = false;
  }

  if (isPending) {
    return <RouteLoading label="Loading..." />;
  }

  if (!session?.user) {
    if (hasPrivySyncHint) {
      return <RouteLoading label={graceExpired ? "Still finalizing sign-in..." : "Completing sign-in..."} />;
    }
    if (hadTokenHint.current && !graceExpired) {
      return <RouteLoading label="Signing in..." />;
    }
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
}

export function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const privyAvailable = usePrivyAvailable();

  if (!privyAvailable) {
    return <ProtectedRouteFallback>{children}</ProtectedRouteFallback>;
  }

  return <ProtectedRouteWithPrivy>{children}</ProtectedRouteWithPrivy>;
}
