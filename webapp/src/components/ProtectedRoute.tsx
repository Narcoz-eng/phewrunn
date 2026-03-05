import { useEffect, useRef, useState } from "react";
import { Navigate } from "react-router-dom";
import { useSession, getExplicitLogoutAt } from "@/lib/auth-client";

/**
 * Maximum time (ms) to wait for a session to hydrate when we detect
 * evidence of a prior login (localStorage token or sessionStorage cache).
 * After this grace period we redirect to /login.
 */
const TOKEN_HYDRATION_GRACE_MS = 4_000;

function hasStoredAuthHint(): boolean {
  // Skip grace period if the user just explicitly logged out.
  const logoutAt = getExplicitLogoutAt();
  if (logoutAt > 0 && Date.now() - logoutAt < 10_000) {
    return false;
  }
  try {
    if (localStorage.getItem("auth-token")) return true;
  } catch { /* ignore */ }
  try {
    if (sessionStorage.getItem("phew.auth.session.v1")) return true;
  } catch { /* ignore */ }
  return false;
}

/**
 * Maximum time (ms) to wait for a session to hydrate when we detect
 * evidence of a prior login (localStorage token or sessionStorage cache).
 * After this grace period we redirect to /login.
 */
const TOKEN_HYDRATION_GRACE_MS = 4_000;

export function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { data: session, isPending } = useSession();
  const hadTokenHint = useRef((() => {
    try { if (localStorage.getItem("auth-token")) return true; } catch { /* ignore */ }
    try { if (sessionStorage.getItem("phew.auth.session.v1")) return true; } catch { /* ignore */ }
    return false;
  })());
  const [graceExpired, setGraceExpired] = useState(false);

  // Start a grace timer if we had a token hint but no session yet.
  useEffect(() => {
    if (session?.user || isPending || !hadTokenHint.current) return;
    const timer = setTimeout(() => setGraceExpired(true), TOKEN_HYDRATION_GRACE_MS);
    return () => clearTimeout(timer);
  }, [session?.user, isPending]);

  // Clear the hint once authenticated so future renders skip the grace period.
  if (session?.user) {
    hadTokenHint.current = false;
  }

  // Still loading the session – show a spinner.
  if (isPending) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background">
        <div className="flex flex-col items-center gap-4">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          <span className="text-muted-foreground text-sm">Loading...</span>
        </div>
      </div>
    );
  }

  // Session loaded but no user – check if we should wait for hydration.
  if (!session?.user) {
    if (hadTokenHint.current && !graceExpired) {
      return (
        <div className="flex items-center justify-center min-h-screen bg-background">
          <div className="flex flex-col items-center gap-4">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
            <span className="text-muted-foreground text-sm">Signing in...</span>
          </div>
        </div>
      );
    }
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
}
