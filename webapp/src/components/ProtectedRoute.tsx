import { useEffect, useRef, useState } from "react";
import { Navigate } from "react-router-dom";
import { getExplicitLogoutAt, useSession } from "@/lib/auth-client";

export function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { data: session, isPending } = useSession();
  const hadTokenHint = useRef((() => {
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
  })());
  const [graceExpired, setGraceExpired] = useState(false);

  useEffect(() => {
    if (session?.user || isPending || !hadTokenHint.current) return;
    const timer = window.setTimeout(() => setGraceExpired(true), 4_000);
    return () => window.clearTimeout(timer);
  }, [session?.user, isPending]);

  if (session?.user) {
    hadTokenHint.current = false;
  }

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
