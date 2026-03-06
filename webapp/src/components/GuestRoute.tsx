import { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { usePrivy } from "@privy-io/react-auth";
import { useSession } from "@/lib/auth-client";
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

function getSignedInDestination(username: string | null | undefined): string {
  return typeof username === "string" && username.trim().length > 0 ? "/" : "/welcome";
}

function GuestRouteFallback({ children }: { children: React.ReactNode }) {
  const { data: session, isPending } = useSession();

  if (isPending) {
    return <RouteLoading label="Loading..." />;
  }

  if (session?.user) {
    return <Navigate to={getSignedInDestination(session.user.username)} replace />;
  }

  return <>{children}</>;
}

function GuestRouteWithPrivy({ children }: { children: React.ReactNode }) {
  const { data: session, isPending } = useSession();
  const { ready, authenticated } = usePrivy();
  const [graceExpired, setGraceExpired] = useState(false);
  const hasPrivySyncHint = ready && authenticated && !session?.user;

  useEffect(() => {
    if (!hasPrivySyncHint) {
      setGraceExpired(false);
      return;
    }

    const timer = window.setTimeout(() => setGraceExpired(true), 12_000);
    return () => window.clearTimeout(timer);
  }, [hasPrivySyncHint]);

  if (isPending) {
    return <RouteLoading label="Loading..." />;
  }

  if (session?.user) {
    return <Navigate to={getSignedInDestination(session.user.username)} replace />;
  }

  if (hasPrivySyncHint && !graceExpired) {
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
