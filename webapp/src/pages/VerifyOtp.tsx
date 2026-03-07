import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/lib/auth-client";
import { Zap } from "lucide-react";

// This page is no longer needed with Better Auth
// Keeping it as a redirect for backwards compatibility
export default function VerifyOtp() {
  const navigate = useNavigate();
  const { isAuthenticated, hasLiveSession, isReady } = useAuth();

  useEffect(() => {
    if (isReady) {
      if (hasLiveSession) {
        navigate("/", { replace: true });
      } else if (!isAuthenticated) {
        navigate("/login", { replace: true });
      }
    }
  }, [hasLiveSession, isReady, isAuthenticated, navigate]);

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Background effects */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-primary/5 rounded-full blur-3xl animate-glow-pulse" />
        <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-accent/5 rounded-full blur-3xl animate-glow-pulse" style={{ animationDelay: "1.5s" }} />
      </div>

      {/* Loading Content */}
      <div className="flex-1 flex items-center justify-center p-6 relative z-10">
        <div className="w-full max-w-md space-y-8 text-center">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-primary/10 border border-primary/20">
            <Zap className="h-8 w-8 text-primary" />
          </div>
          <div className="flex justify-center">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          </div>
          <p className="text-muted-foreground text-sm">Redirecting...</p>
        </div>
      </div>
    </div>
  );
}
