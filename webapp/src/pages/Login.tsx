import { useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { motion } from "framer-motion";
import {
  clearPrivySyncFailureState,
  setPrivyAuthBootstrapState,
  useAuth,
  usePrivySyncFailureSnapshot,
} from "@/lib/auth-client";
import { usePrivyLogin } from "@/hooks/usePrivyLogin";
import { usePrivyAvailable } from "@/components/PrivyContext";
import { ThemeToggle } from "@/components/ThemeToggle";
import { BrandLogo } from "@/components/BrandLogo";
import { LivePlatformPreview } from "@/components/login/LivePlatformPreview";
import { Button } from "@/components/ui/button";
import { Loader2, Mail } from "lucide-react";

function Background() {
  return (
    <div className="fixed inset-0 z-0 overflow-hidden">
      <LivePlatformPreview />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(169,255,52,0.1),transparent_24%),linear-gradient(180deg,rgba(2,5,7,0.22),rgba(2,5,7,0.82))]" />
    </div>
  );
}

function PrivyLoginButton() {
  const navigate = useNavigate();
  const { user: authUser, hasLiveSession } = useAuth();
  const {
    login,
    ready: privyReady,
    isSyncing,
    isRetryBlocked,
    syncError,
    authStatusMessage,
  } = usePrivyLogin({
    onSuccess: (user) => navigate(user.username ? "/" : "/welcome", { replace: true }),
  });

  const privySyncFailure = usePrivySyncFailureSnapshot();
  const visibleSyncError =
    !authUser && !hasLiveSession && !isSyncing && !authStatusMessage && (syncError || privySyncFailure)
      ? "Sign-in failed. Please retry."
      : null;
  const visibleStatus =
    authStatusMessage ?? (authUser && !hasLiveSession ? "Finalizing your session..." : null);

  useEffect(() => {
    if (!syncError) return;
    const lowerErr = syncError.toLowerCase();
    if (
      lowerErr.includes("invite or access code") ||
      lowerErr.includes("access_code_required") ||
      lowerErr.includes("access_code_invalid")
    ) {
      navigate("/access-code");
    }
  }, [navigate, syncError]);

  const orbClassName =
    "group flex min-h-[120px] flex-col items-center justify-center gap-4 rounded-[28px] border border-white/10 bg-[linear-gradient(180deg,rgba(16,21,24,0.98),rgba(9,12,15,0.98))] px-4 py-5 text-center text-white transition-all duration-300 hover:-translate-y-0.5 hover:border-white/18 hover:bg-white/[0.06]";

  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2">
        <button
          type="button"
          className={orbClassName}
          onClick={() => login({ loginMethods: ["twitter"] })}
          disabled={isSyncing || isRetryBlocked}
        >
          <span className="inline-flex h-16 w-16 items-center justify-center rounded-full border border-white/10 bg-white/[0.05] text-2xl font-black shadow-[0_12px_36px_-20px_rgba(255,255,255,0.18)]">
            X
          </span>
          <span className="text-sm font-medium text-white/78">
            {privyReady ? "X (Twitter)" : "Initializing..."}
          </span>
        </button>
        <button
          type="button"
          className={orbClassName}
          onClick={() => login({ loginMethods: ["email"] })}
          disabled={isSyncing || isRetryBlocked}
        >
          <span className="inline-flex h-16 w-16 items-center justify-center rounded-full border border-lime-300/18 bg-lime-300/10 text-lime-200 shadow-[0_12px_36px_-20px_rgba(169,255,52,0.34)]">
            <Mail className="h-7 w-7" />
          </span>
          <span className="text-sm font-medium text-white/78">
            {privyReady ? "Email" : "Initializing..."}
          </span>
        </button>
      </div>

      {visibleStatus ? <p className="pt-0.5 text-center text-[11px] text-muted-foreground">{visibleStatus}</p> : null}
      {visibleSyncError ? <p className="text-center text-[11px] text-red-400">{visibleSyncError}</p> : null}
    </div>
  );
}

function FallbackLoginButton() {
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        {["X", "Email"].map((label) => (
          <Button key={label} type="button" variant="outline" className="h-[120px] rounded-[28px] opacity-50" disabled>
            <div className="flex flex-col items-center gap-3">
              <Loader2 className="h-5 w-5 animate-spin" />
              <span className="text-sm font-semibold">{label}</span>
            </div>
          </Button>
        ))}
      </div>
    </div>
  );
}

function LoginCard({ privyAvailable }: { privyAvailable: boolean }) {
  return (
    <motion.div
      className="w-full max-w-[460px]"
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, delay: 0.08, ease: "easeOut" }}
    >
      <div className="relative overflow-hidden rounded-[34px] border border-white/12 bg-[linear-gradient(180deg,rgba(6,10,12,0.84),rgba(3,7,9,0.92))] p-7 shadow-[0_34px_96px_-52px_rgba(0,0,0,0.95)] backdrop-blur-3xl sm:p-8">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(169,255,52,0.12),transparent_22%),radial-gradient(circle_at_top_right,rgba(65,232,207,0.08),transparent_24%)]" />

        <div className="relative">
          <div className="text-[10px] uppercase tracking-[0.28em] text-white/44">Secure access</div>
          <h1 className="mt-4 text-[2.4rem] font-semibold tracking-[-0.05em] text-white sm:text-5xl">
            Run the room.
          </h1>
          <p className="mt-3 text-sm leading-6 text-white/58 sm:text-[15px]">
            Sign in to open the live feed, terminal, raids, bundle intelligence, and community rooms.
          </p>
        </div>

        <motion.div
          className="relative mt-7"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, delay: 0.22 }}
        >
          {privyAvailable ? <PrivyLoginButton /> : <FallbackLoginButton />}
        </motion.div>

        <div className="mt-7 border-t border-white/8 pt-5 text-[11px] leading-6 text-white/42">
          Supported sign-in methods only. Session routing, invite bootstrap, and account recovery stay unchanged.
        </div>
      </div>
    </motion.div>
  );
}

export default function Login() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { user, hasLiveSession, isReady } = useAuth();
  const privyAvailable = usePrivyAvailable();

  useEffect(() => {
    const urlCode = searchParams.get("code");
    if (urlCode) {
      sessionStorage.setItem("phew.pending-invite-code", urlCode.trim().toUpperCase());
      clearPrivySyncFailureState();
      setPrivyAuthBootstrapState("idle", {
        owner: "system",
        mode: "system",
        userId: null,
        detail: "invite/access code updated from login URL",
        debugCode: "access_code_url_prefill",
      });
    }
  }, [searchParams]);

  useEffect(() => {
    if (!isReady || !hasLiveSession) return;
    navigate(user?.username ? "/" : "/welcome", { replace: true });
  }, [hasLiveSession, isReady, navigate, user?.username]);

  return (
    <div className="min-h-screen overflow-x-hidden bg-background text-white">
      <Background />

      <div className="relative z-40 flex justify-end px-5 pt-5 sm:px-8">
        <ThemeToggle size="icon" className="h-9 w-9 border border-white/10 bg-white/[0.04]" />
      </div>

      <main className="relative z-10 flex min-h-[calc(100vh-64px)] items-center justify-center px-5 pb-14 pt-8 sm:px-8 sm:pt-10">
        <div className="w-full max-w-[1180px]">
          <div className="grid items-center gap-8 lg:grid-cols-[minmax(0,1fr)_460px]">
            <motion.section
              initial={{ opacity: 0, y: 22 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.45, delay: 0.05, ease: "easeOut" }}
              className="hidden lg:block"
            >
              <BrandLogo size="lg" className="scale-[1.02]" />
              <div className="mt-8 max-w-[520px]">
                <div className="text-[11px] uppercase tracking-[0.24em] text-lime-300/72">
                  Real product preview
                </div>
                <h2 className="mt-4 text-5xl font-semibold tracking-[-0.06em] text-white">
                  The background is the app.
                </h2>
                <p className="mt-4 text-base leading-7 text-white/58">
                  Live feed, raids, leaderboard, and watchlist modules stay visible behind auth so the login page reflects the actual product surface instead of a fabricated hero scene.
                </p>
              </div>
            </motion.section>

            <div className="mx-auto w-full lg:mx-0">
              <LoginCard privyAvailable={privyAvailable} />
              <p className="mt-5 text-center text-[11px] text-white/42">
                By signing in you agree to Terms of Service and Privacy Policy.
              </p>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
