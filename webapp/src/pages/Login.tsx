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
import { EXACT_LOGO_IMAGE_SRC } from "@/lib/brand";
import { Button } from "@/components/ui/button";
import { Loader2, Send, WalletCards } from "lucide-react";

function Background() {
  return (
    <div className="fixed inset-0 z-0 overflow-hidden">
      <LivePlatformPreview cinematic />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(169,255,52,0.04),transparent_28%),linear-gradient(180deg,rgba(1,4,6,0.08),rgba(1,4,6,0.62))]" />
      <div className="absolute inset-x-0 top-0 h-48 bg-gradient-to-b from-black/54 to-transparent" />
      <div className="absolute inset-x-0 bottom-0 h-72 bg-gradient-to-t from-black/72 to-transparent" />
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
    "group flex h-[68px] items-center justify-start gap-5 rounded-[22px] border border-white/14 bg-[linear-gradient(180deg,rgba(12,17,20,0.86),rgba(5,9,12,0.92))] px-5 text-left text-white shadow-[0_20px_70px_-42px_rgba(0,0,0,0.94)] backdrop-blur-xl transition-all duration-300 hover:-translate-y-0.5 hover:border-lime-300/36 hover:bg-white/[0.07] disabled:cursor-not-allowed disabled:opacity-50";

  return (
    <div className="space-y-3">
      <div className="grid gap-3">
        {[
          { label: "X (Twitter)", method: "twitter" as const, icon: "X" },
          { label: "Wallet", method: "wallet" as const, icon: WalletCards },
          { label: "Telegram", method: "telegram" as const, icon: Send },
          { label: "Google", method: "google" as const, icon: "G" },
        ].map((item) => {
          const Icon = typeof item.icon === "string" ? null : item.icon;
          return (
            <button
              key={item.method}
              type="button"
              className={buttonClassName}
              onClick={() => login({ loginMethods: [item.method] })}
              disabled={isSyncing || isRetryBlocked}
            >
              <span className="inline-flex h-12 w-12 items-center justify-center rounded-[16px] border border-lime-300/22 bg-lime-300/10 text-2xl font-black text-lime-200 shadow-[0_12px_36px_-20px_rgba(169,255,52,0.34)]">
                {Icon ? <Icon className="h-5 w-5" /> : item.icon}
              </span>
              <span className="text-lg font-semibold text-white/90">
                {privyReady ? item.label : "Initializing..."}
              </span>
            </button>
          );
        })}
      </div>

      {visibleStatus ? <p className="pt-0.5 text-center text-xs text-white/56">{visibleStatus}</p> : null}
      {visibleSyncError ? <p className="text-center text-[11px] text-red-400">{visibleSyncError}</p> : null}
    </div>
  );
}

function FallbackLoginButton() {
  return (
    <div className="space-y-4">
      <div className="grid gap-3">
        {["X", "Wallet", "Telegram", "Google"].map((label) => (
          <Button key={label} type="button" variant="outline" className="h-[68px] justify-start rounded-[22px] opacity-50" disabled>
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

function AuthConnectors({ privyAvailable }: { privyAvailable: boolean }) {
  return (
    <motion.div
      className="w-full max-w-[500px]"
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, delay: 0.08, ease: "easeOut" }}
    >
      <div className="relative">
        <div className="mb-4 text-center text-sm font-medium text-white/58">
          Continue with
        </div>

        <motion.div
          className="relative mt-7"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, delay: 0.22 }}
        >
          {privyAvailable ? <PrivyLoginButton /> : <FallbackLoginButton />}
        </motion.div>
      </div>
    </motion.div>
  );
}

function BrandHero() {
  return (
    <motion.div
      className="text-center"
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.48, ease: "easeOut" }}
    >
      <div className="mx-auto flex items-center justify-center gap-5">
        <img
          src={EXACT_LOGO_IMAGE_SRC}
          alt=""
          aria-hidden="true"
          className="h-20 w-20 rounded-[24px] object-cover shadow-[0_0_60px_-18px_rgba(169,255,52,0.72)] sm:h-24 sm:w-24"
          loading="eager"
          decoding="async"
        />
        <div className="text-left">
          <div className="text-5xl font-black uppercase leading-none tracking-[-0.055em] text-white sm:text-7xl">
            Phew<span className="bg-gradient-to-r from-[#A9FF34] via-[#76FF44] to-[#41E8CF] bg-clip-text text-transparent">.run</span>
          </div>
          <div className="mt-3 text-center text-[11px] font-semibold uppercase tracking-[0.38em] text-white/78 sm:text-sm">
            A Phew Running The Internet
          </div>
        </div>
      </div>

      <h1 className="mx-auto mt-20 max-w-[860px] text-balance text-6xl font-black uppercase leading-[0.95] tracking-[-0.06em] sm:text-7xl lg:text-[5.8rem]">
        <span className="block bg-gradient-to-r from-[#B9FF4D] via-[#83FF46] to-[#29E6D0] bg-clip-text text-transparent drop-shadow-[0_0_40px_rgba(97,255,155,0.18)]">
          Phew.
        </span>
        <span className="block bg-gradient-to-r from-[#B9FF4D] via-[#83FF46] to-[#29E6D0] bg-clip-text text-transparent drop-shadow-[0_0_40px_rgba(97,255,155,0.18)]">
          Running The Internet.
        </span>
      </h1>

      <p className="mx-auto mt-7 max-w-[660px] text-balance text-xl leading-8 text-white/74 sm:text-2xl">
        Social calls. AI intelligence. X raids. Communities.
        <br className="hidden sm:block" />
        Trading terminal. All in one place.
      </p>
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
        <div className="mx-auto flex w-full max-w-[920px] flex-col items-center">
          <BrandHero />
          <div className="mt-10 w-full max-w-[500px]">
            <AuthConnectors privyAvailable={privyAvailable} />
          </div>
          <p className="mt-7 text-center text-sm text-white/58">
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
