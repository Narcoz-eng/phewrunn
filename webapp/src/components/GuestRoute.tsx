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

function GuestRouteFallback({ children }: { children: React.ReactNode }) {
  const { data: session, isPending } = useSession();

  if (isPending) {
    return <RouteLoading label="Loading..." />;
  }

  if (session?.user) {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
}

function GuestRouteWithPrivy({ children }: { children: React.ReactNode }) {
  const { data: session, isPending } = useSession();
  const { ready, authenticated } = usePrivy();

  if (isPending) {
    return <RouteLoading label="Loading..." />;
  }

  if (session?.user) {
    return <Navigate to="/" replace />;
  }

  // Once Privy accepts the OTP, immediately leave the guest route.
  // ProtectedRoute handles the handoff while the backend session hydrates.
  if (ready && authenticated) {
    return <Navigate to="/" replace />;
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
