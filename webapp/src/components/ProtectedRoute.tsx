import { useEffect, useRef, useState } from "react";
import { Navigate, useLocation } from "react-router-dom";
import {
  isExplicitLogoutCoolingDown,
  readCachedAuthUserSnapshot,
  useSession,
} from "@/lib/auth-client";
import { usePrivyAvailable } from "@/components/PrivyContext";
import { V2AppShell } from "@/components/layout/V2AppShell";
import { ProtectedRouteWithPrivy } from "@/components/ProtectedRouteWithPrivy";

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
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div className="flex flex-col items-center gap-4">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        <span className="text-sm text-muted-foreground">{label}</span>
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

export function ProtectedRoute({
  children,
  allowMissingUsername = false,
}: {
  children: React.ReactNode;
  allowMissingUsername?: boolean;
}) {
  const privyAvailable = usePrivyAvailable();
  const fallback = (
    <ProtectedRouteFallback allowMissingUsername={allowMissingUsername}>
      {children}
    </ProtectedRouteFallback>
  );

  if (!privyAvailable) {
    return fallback;
  }

  return (
    <ProtectedRouteWithPrivy allowMissingUsername={allowMissingUsername}>
      {children}
    </ProtectedRouteWithPrivy>
  );
}
