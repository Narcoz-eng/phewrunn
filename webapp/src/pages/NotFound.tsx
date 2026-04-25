import { useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { ArrowLeft, Compass, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { LivePlatformPreview } from "@/components/login/LivePlatformPreview";
import { useAuth } from "@/lib/auth-client";

export default function NotFound() {
  const location = useLocation();
  const navigate = useNavigate();
  const { isAuthenticated, hasLiveSession } = useAuth();
  const canEnterProduct = isAuthenticated && hasLiveSession;

  useEffect(() => {
    console.error("404 Error: User attempted to access non-existent route:", location.pathname);
  }, [location.pathname]);

  return (
    <div className="min-h-screen overflow-hidden bg-background text-white">
      <div className="fixed inset-0 z-0 overflow-hidden">
        <LivePlatformPreview />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(169,255,52,0.06),transparent_24%),linear-gradient(180deg,rgba(2,5,7,0.44),rgba(2,5,7,0.94))]" />
        <div className="absolute inset-0 bg-black/24 backdrop-blur-[2px]" />
      </div>

      <main className="relative z-10 flex min-h-screen items-center justify-center px-5 py-10">
        <section className="w-full max-w-[460px] rounded-[28px] border border-white/12 bg-[linear-gradient(180deg,rgba(6,10,12,0.84),rgba(3,7,9,0.95))] p-6 text-center shadow-[0_34px_96px_-52px_rgba(0,0,0,0.95)] backdrop-blur-3xl sm:p-7">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-[18px] border border-lime-300/18 bg-lime-300/10 text-lime-200">
            {canEnterProduct ? <Compass className="h-6 w-6" /> : <Lock className="h-6 w-6" />}
          </div>
          <div className="mt-5 text-[10px] font-semibold uppercase tracking-[0.26em] text-lime-200/70">
            Route not found
          </div>
          <h1 className="mt-3 text-3xl font-semibold tracking-[-0.05em] text-white">404</h1>
          <p className="mx-auto mt-3 max-w-sm text-sm leading-6 text-white/56">
            {canEnterProduct
              ? "That product route does not exist. Return to the live feed and continue from a real surface."
              : "That route is locked or unavailable. Sign in before entering the product."}
          </p>

          <Button
            type="button"
            onClick={() => navigate(canEnterProduct ? "/" : "/login", { replace: true })}
            className="mt-6 h-12 w-full rounded-[16px] text-slate-950"
          >
            <ArrowLeft className="mr-2 h-4 w-4" />
            {canEnterProduct ? "Go to Feed" : "Go to Login"}
          </Button>
        </section>
      </main>
    </div>
  );
}
