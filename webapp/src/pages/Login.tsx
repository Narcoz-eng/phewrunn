import { useEffect } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { motion } from "framer-motion";
import {
  clearPrivySyncFailureState,
  setPrivyAuthBootstrapState,
  useAuth,
  usePrivySyncFailureSnapshot,
} from "@/lib/auth-client";
import { usePrivyLogin } from "@/hooks/usePrivyLogin";
import { usePrivyAvailable } from "@/components/PrivyContext";
import { LivePlatformPreview } from "@/components/login/LivePlatformPreview";
import { Button } from "@/components/ui/button";
import { Loader2, Mail, ShieldCheck } from "lucide-react";

function Background() {
  return (
    <div className="fixed inset-0 z-0 overflow-hidden">
      <LivePlatformPreview />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(169,255,52,0.06),transparent_24%),linear-gradient(180deg,rgba(2,5,7,0.38),rgba(2,5,7,0.9))]" />
      <div className="absolute inset-0 bg-black/18 backdrop-blur-[2px]" />
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

  const buttonClassName =
    "group flex h-14 items-center justify-start gap-4 rounded-[18px] border border-white/10 bg-[linear-gradient(180deg,rgba(16,21,24,0.98),rgba(9,12,15,0.98))] px-4 text-left text-white transition-all duration-300 hover:-translate-y-0.5 hover:border-lime-300/28 hover:bg-white/[0.06] disabled:cursor-not-allowed disabled:opacity-50";

  return (
    <div className="space-y-3">
      <div className="grid gap-3">
        <button
          type="button"
          className={buttonClassName}
          onClick={() => login({ loginMethods: ["twitter"] })}
          disabled={isSyncing || isRetryBlocked}
        >
          <span className="inline-flex h-10 w-10 items-center justify-center rounded-[14px] border border-white/10 bg-white/[0.05] text-xl font-black shadow-[0_12px_36px_-20px_rgba(255,255,255,0.18)]">
            X
          </span>
          <span className="text-sm font-semibold text-white/82">
            {privyReady ? "X (Twitter)" : "Initializing..."}
          </span>
        </button>
        <button
          type="button"
          className={buttonClassName}
          onClick={() => login({ loginMethods: ["email"] })}
          disabled={isSyncing || isRetryBlocked}
        >
          <span className="inline-flex h-10 w-10 items-center justify-center rounded-[14px] border border-lime-300/18 bg-lime-300/10 text-lime-200 shadow-[0_12px_36px_-20px_rgba(169,255,52,0.34)]">
            <Mail className="h-5 w-5" />
          </span>
          <span className="text-sm font-semibold text-white/82">
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
      <div className="grid gap-3">
        {["X", "Email"].map((label) => (
          <Button key={label} type="button" variant="outline" className="h-14 justify-start rounded-[18px] opacity-50" disabled>
            <div className="flex items-center gap-3">
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
      className="w-full max-w-[420px]"
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, delay: 0.08, ease: "easeOut" }}
    >
      <div className="relative overflow-hidden rounded-[28px] border border-white/12 bg-[linear-gradient(180deg,rgba(6,10,12,0.82),rgba(3,7,9,0.94))] p-6 shadow-[0_34px_96px_-52px_rgba(0,0,0,0.95)] backdrop-blur-3xl sm:p-7">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(169,255,52,0.12),transparent_24%),radial-gradient(circle_at_top_right,rgba(65,232,207,0.08),transparent_28%)]" />

        <div className="relative">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-[16px] border border-lime-300/18 bg-lime-300/10 text-lime-200">
              <ShieldCheck className="h-5 w-5" />
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-[0.26em] text-lime-200/70">Access required</div>
              <h1 className="mt-1 text-2xl font-semibold tracking-[-0.04em] text-white">Enter Phew.run</h1>
            </div>
          </div>
          <p className="mt-4 text-sm leading-6 text-white/58">
            Sign in to unlock the live platform behind this screen.
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

        <div className="mt-6 border-t border-white/8 pt-4 text-[11px] leading-6 text-white/42">
          Supported sign-in methods only. Invite-gated accounts route through the access-code flow automatically.
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

      <main className="relative z-10 flex min-h-screen items-center justify-center px-5 py-10 sm:px-8">
        <div className="mx-auto w-full max-w-[420px]">
          <LoginCard privyAvailable={privyAvailable} />
          <p className="mt-5 text-center text-[11px] text-white/44">
            By signing in you agree to{" "}
            <Link to="/terms" className="text-lime-200 hover:text-lime-100">
              Terms of Service
            </Link>{" "}
            and{" "}
            <Link to="/privacy" className="text-lime-200 hover:text-lime-100">
              Privacy Policy
            </Link>
            .
          </p>
        </div>
      </main>
    </div>
  );
}
