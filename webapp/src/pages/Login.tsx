import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { motion, useMotionValue, animate } from "framer-motion";
import {
  clearPrivySyncFailureState,
  setPrivyAuthBootstrapState,
  useAuth,
  usePrivySyncFailureSnapshot,
} from "@/lib/auth-client";
import { usePrivyLogin } from "@/hooks/usePrivyLogin";
import { usePrivyAvailable } from "@/components/PrivyWalletProvider";
import { ThemeToggle } from "@/components/ThemeToggle";
import { BrandLogo } from "@/components/BrandLogo";
import { InboxRouteIcon, RouteArrowIcon } from "@/components/login/LoginPageIcons";
import { Button } from "@/components/ui/button";
import { Loader2, Zap } from "lucide-react";
import { BuyPanelViz } from "@/components/login/BuyPanelViz";
import { AlertsViz } from "@/components/login/AlertsViz";
import { WeeklyBestSection } from "@/components/login/WeeklyBestSection";

// ─── Animated stat counter ──────────────────────────────────────────────────

function AnimatedStat({
  rawValue,
  suffix,
  label,
  delay,
}: {
  rawValue: number;
  suffix: string;
  label: string;
  delay: number;
}) {
  const motionVal = useMotionValue(0);
  const [display, setDisplay] = useState<string>("0");

  useEffect(() => {
    const unsub = motionVal.on("change", (v) => {
      setDisplay(rawValue % 1 !== 0 ? v.toFixed(1) : String(Math.round(v)));
    });
    const ctrl = animate(motionVal, rawValue, { duration: 1.6, delay, ease: "easeOut" });
    return () => {
      ctrl.stop();
      unsub();
    };
  }, [rawValue, delay, motionVal]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay, ease: "easeOut" }}
    >
      <div className="text-2xl sm:text-3xl font-mono font-bold tracking-tight tabular-nums">
        {display}
        <span className="text-primary/70">{suffix}</span>
      </div>
      <div className="text-[11px] sm:text-xs text-muted-foreground mt-0.5">{label}</div>
    </motion.div>
  );
}

// ─── Background (Framer Motion orbs — always animates, no CSS-class dependency) ──

function Background() {
  return (
    <div className="fixed inset-0 pointer-events-none z-0 overflow-hidden">
      {/* Orb 1 — top right */}
      <motion.div
        className="absolute rounded-full blur-[120px]"
        style={{
          width: 640,
          height: 640,
          top: "-20%",
          right: "-8%",
          background: "radial-gradient(ellipse, hsl(var(--primary)/0.26) 0%, transparent 65%)",
          willChange: "transform",
        }}
        animate={{ x: [0, 44, -22, 0], y: [0, -32, 16, 0], scale: [1, 1.06, 0.97, 1] }}
        transition={{ duration: 22, ease: "easeInOut", repeat: Infinity, repeatType: "loop" }}
      />
      {/* Orb 2 — bottom left */}
      <motion.div
        className="absolute rounded-full blur-[100px]"
        style={{
          width: 520,
          height: 520,
          bottom: "-14%",
          left: "-10%",
          background: "radial-gradient(ellipse, hsl(var(--accent)/0.20) 0%, transparent 65%)",
          willChange: "transform",
        }}
        animate={{ x: [0, -32, 22, 0], y: [0, 22, -14, 0], scale: [1, 1.05, 0.96, 1] }}
        transition={{ duration: 26, ease: "easeInOut", repeat: Infinity, repeatType: "loop" }}
      />
      {/* Orb 3 — mid right accent */}
      <motion.div
        className="absolute rounded-full blur-[80px]"
        style={{
          width: 300,
          height: 300,
          top: "40%",
          right: "5%",
          background: "radial-gradient(ellipse, hsl(var(--primary)/0.10) 0%, transparent 70%)",
          willChange: "transform",
        }}
        animate={{ x: [0, 20, -10, 0], y: [0, -20, 10, 0] }}
        transition={{ duration: 19, ease: "easeInOut", repeat: Infinity, repeatType: "loop" }}
      />

      {/* Subtle grid */}
      <div
        className="absolute inset-0 opacity-[0.025]"
        style={{
          backgroundImage: `linear-gradient(hsl(var(--foreground)) 1px, transparent 1px), linear-gradient(90deg, hsl(var(--foreground)) 1px, transparent 1px)`,
          backgroundSize: "64px 64px",
        }}
      />
      {/* Vignettes */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,transparent_0%,hsl(var(--background))_80%)]" />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_bottom,transparent_0%,hsl(var(--background)/0.5)_90%)]" />
    </div>
  );
}

// ─── Auth buttons ──────────────────────────────────────────────────────────────

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
    onSuccess: (user) =>
      navigate(user.username ? "/" : "/welcome", { replace: true }),
  });

  const isLoading = isSyncing;

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
  }, [syncError, navigate]);

  const privySyncFailure = usePrivySyncFailureSnapshot();
  const visibleSyncError =
    !authUser && !hasLiveSession && !isSyncing && !authStatusMessage && (syncError || privySyncFailure)
      ? "Sign-in failed. Please retry."
      : null;

  const visibleStatus =
    authStatusMessage ?? (authUser && !hasLiveSession ? "Finalizing your session..." : null);

  const emailLabel = privyReady ? "Continue with Email" : "Initializing...";
  const xLabel = privyReady ? "Continue with X" : "Initializing...";

  return (
    <div className="space-y-2.5">
      {/* Email */}
      <motion.div whileHover={{ y: -1 }} whileTap={{ scale: 0.985 }}>
        <Button
          type="button"
          className="h-[52px] w-full rounded-2xl border border-white/15 bg-[linear-gradient(135deg,#c7f5a6_0%,#98e9dc_100%)] px-5 text-slate-950 shadow-[0_12px_40px_-16px_rgba(152,233,220,0.65)] transition-shadow duration-300 hover:shadow-[0_16px_48px_-16px_rgba(152,233,220,0.85)] justify-between"
          onClick={() => login({ loginMethods: ["email"] })}
          disabled={isLoading || isRetryBlocked}
        >
          {isLoading ? (
            <span className="flex items-center gap-2 text-sm font-medium">
              <Loader2 className="w-4 h-4 animate-spin" />
              Signing you in...
            </span>
          ) : (
            <>
              <span className="flex items-center gap-3">
                <span className="flex h-7 w-7 items-center justify-center rounded-xl border border-slate-950/10 bg-slate-950/8">
                  <InboxRouteIcon className="h-3.5 w-3.5" />
                </span>
                <span className="text-sm font-semibold">{emailLabel}</span>
              </span>
              <RouteArrowIcon className="h-3.5 w-3.5 opacity-70" />
            </>
          )}
        </Button>
      </motion.div>

      {/* X / Twitter */}
      <motion.div whileHover={{ y: -1 }} whileTap={{ scale: 0.985 }}>
        <Button
          type="button"
          variant="outline"
          className="group h-[52px] w-full rounded-2xl border border-white/14 bg-[linear-gradient(180deg,rgba(14,18,20,0.96),rgba(8,11,12,0.94))] px-5 text-white shadow-[0_8px_32px_-16px_rgba(0,0,0,0.7)] transition-all duration-300 hover:border-white/24 hover:text-white hover:shadow-[0_12px_40px_-16px_rgba(0,0,0,0.9)] justify-between"
          onClick={() => login({ loginMethods: ["twitter"] })}
          disabled={isLoading || isRetryBlocked}
        >
          {isLoading ? (
            <span className="flex items-center gap-2 text-sm font-medium">
              <Loader2 className="w-4 h-4 animate-spin" />
              Signing you in...
            </span>
          ) : (
            <>
              <span className="flex items-center gap-3">
                <span className="inline-flex h-7 w-7 items-center justify-center rounded-xl border border-white/10 bg-white/[0.07] text-sm font-black transition-colors group-hover:bg-white/[0.1]">
                  X
                </span>
                <span className="text-sm font-semibold">{xLabel}</span>
              </span>
              <RouteArrowIcon className="h-3.5 w-3.5 opacity-50 transition-transform duration-300 group-hover:translate-x-0.5" />
            </>
          )}
        </Button>
      </motion.div>

      {visibleStatus ? (
        <p className="text-center text-[11px] text-muted-foreground pt-0.5">{visibleStatus}</p>
      ) : null}

      {visibleSyncError ? (
        <p className="text-center text-[11px] text-red-400">{visibleSyncError}</p>
      ) : null}
    </div>
  );
}

function FallbackLoginButton() {
  return (
    <div className="space-y-2.5">
      <Button
        type="button"
        className="h-[52px] w-full rounded-2xl opacity-50 justify-start gap-3"
        disabled
      >
        <Loader2 className="w-4 h-4 animate-spin" />
        <span className="text-sm font-semibold">Continue with Email</span>
      </Button>
      <Button
        type="button"
        variant="outline"
        className="h-[52px] w-full rounded-2xl opacity-50 justify-start gap-3"
        disabled
      >
        <Loader2 className="w-4 h-4 animate-spin" />
        <span className="text-sm font-semibold">Continue with X</span>
      </Button>
    </div>
  );
}

// ─── Login card ────────────────────────────────────────────────────────────────

function LoginCard({ privyAvailable }: { privyAvailable: boolean }) {
  return (
    <motion.div
      className="w-full"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, delay: 0.12, ease: "easeOut" }}
    >
      {/* Border wrapper — lower opacity gradient to avoid color crash */}
      <div
        className="relative rounded-[28px] p-[1px] overflow-hidden shadow-[0_28px_80px_-32px_hsl(var(--primary)/0.35)]"
        style={{
          background:
            "linear-gradient(160deg, hsl(var(--primary)/0.35) 0%, hsl(var(--accent)/0.18) 50%, hsl(var(--border)/0.3) 100%)",
        }}
      >
        <div className="relative rounded-[27px] overflow-hidden bg-background/95 backdrop-blur-2xl">
          {/* Top inner glow */}
          <div className="absolute inset-x-[20%] top-0 h-[30%] rounded-full bg-primary/6 blur-3xl pointer-events-none" />

          <div className="px-6 pt-6 pb-5 relative">
            {/* Card header */}
            <div className="mb-6">
              <motion.div
                className="text-[10px] uppercase tracking-[0.3em] text-primary/65 mb-2"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.4, delay: 0.28 }}
              >
                Creator access
              </motion.div>
              <motion.h2
                className="text-[1.4rem] font-heading font-bold tracking-tight"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.35, delay: 0.32 }}
              >
                Sign in to Phew
              </motion.h2>
              <motion.p
                className="text-sm text-muted-foreground mt-1.5"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.35, delay: 0.38 }}
              >
                Instant account. No wallet needed to start.
              </motion.p>
            </div>

            {/* Auth buttons */}
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.35, delay: 0.42 }}
            >
              {privyAvailable ? <PrivyLoginButton /> : <FallbackLoginButton />}
            </motion.div>

            {/* Divider */}
            <motion.div
              className="mt-5 pt-4 border-t border-border/40"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.35, delay: 0.5 }}
            >
              <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                <span>Secure email verification</span>
                <span className="flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-gain inline-block animate-pulse" />
                  Payout rail active
                </span>
              </div>
            </motion.div>
          </div>

          {/* Footer */}
          <div className="px-6 py-3.5 bg-card/40 border-t border-border/30">
            <div className="flex items-center justify-between text-[11px] text-muted-foreground">
              <span>0.5% per routed buy</span>
              <span>Reputation compounds on-chain</span>
            </div>
          </div>
        </div>
      </div>

      {/* Trust note */}
      <motion.p
        className="text-center text-[11px] text-muted-foreground mt-3"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.35, delay: 0.58 }}
      >
        Wallet linking handled separately after sign-in.
      </motion.p>
    </motion.div>
  );
}

// ─── Page ──────────────────────────────────────────────────────────────────────

const STATS = [
  { rawValue: 10, suffix: "K+", label: "Calls settled" },
  { rawValue: 68, suffix: "%", label: "Avg accuracy" },
  { rawValue: 2.4, suffix: "K", label: "Active traders" },
];

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
    <div className="min-h-screen bg-background flex flex-col overflow-x-hidden">
      <Background />

      {/* ── Header ── */}
      <motion.header
        className="relative z-50 border-b border-border/35 backdrop-blur-xl bg-background/65"
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, ease: "easeOut" }}
      >
        <div className="max-w-6xl mx-auto px-5 sm:px-8 h-14 flex items-center justify-between">
          <BrandLogo size="sm" showTagline={false} />
          <div className="flex items-center gap-3">
            <span className="hidden sm:inline-flex items-center gap-1.5 text-[11px] text-muted-foreground border border-border/50 rounded-full px-2.5 py-1 bg-card/40">
              <span className="w-1.5 h-1.5 rounded-full bg-gain inline-block animate-pulse" />
              Live
            </span>
            <ThemeToggle size="icon" className="h-8 w-8" />
          </div>
        </div>
      </motion.header>

      {/* ── Main ── */}
      <main className="relative z-10 flex-1 px-5 sm:px-8 py-10 sm:py-14">
        <div className="w-full max-w-6xl mx-auto">
          <div className="grid lg:grid-cols-[1fr_420px] xl:grid-cols-[1fr_440px] gap-10 xl:gap-16 items-start">

            {/* ── Left: Feature showcase ── */}
            <motion.div
              className="order-2 lg:order-1 space-y-8 max-w-xl"
              initial={{ opacity: 0, x: -16 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.5, delay: 0.06, ease: "easeOut" }}
            >
              {/* Hero section */}
              <div>
                {/* Eyebrow */}
                <motion.div
                  className="inline-flex items-center gap-2 rounded-full border border-primary/25 bg-primary/8 px-3 py-1 text-[11px] font-medium text-primary mb-6"
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ duration: 0.35, delay: 0.12, ease: "easeOut" }}
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-primary inline-block animate-pulse" />
                  Good alpha first. Fees follow.
                </motion.div>

                {/* Headline */}
                <motion.h1
                  className="font-heading text-4xl sm:text-5xl lg:text-[3rem] xl:text-[3.4rem] font-extrabold tracking-tight leading-[1.07] mb-4"
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.5, delay: 0.18, ease: "easeOut" }}
                >
                  Post a Call.
                  <br />
                  <span className="bg-gradient-to-r from-[#c7f5a6] via-[#a9ef9d] to-[#98e9dc] bg-clip-text text-transparent">
                    Earn the Buy.
                  </span>
                </motion.h1>

                {/* Sub */}
                <motion.p
                  className="text-base sm:text-lg text-muted-foreground leading-relaxed mb-8 max-w-[440px]"
                  initial={{ opacity: 0, y: 14 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.45, delay: 0.24, ease: "easeOut" }}
                >
                  Be first with good alpha, capture the buy route, and earn{" "}
                  <span className="text-foreground font-semibold">0.5%</span> every time traders
                  act from your post.
                </motion.p>

                {/* Stats */}
                <div className="flex items-center gap-6 sm:gap-8">
                  {STATS.map((stat, i) => (
                    <AnimatedStat
                      key={stat.label}
                      rawValue={stat.rawValue}
                      suffix={stat.suffix}
                      label={stat.label}
                      delay={0.32 + i * 0.1}
                    />
                  ))}
                </div>
              </div>

              {/* Buy Panel */}
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, delay: 0.45, ease: "easeOut" }}
              >
                <div className="flex items-center gap-2 mb-3">
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/25 bg-emerald-500/8 px-2.5 py-1 text-[11px] font-medium text-emerald-400">
                    <Zap className="w-3 h-3" />
                    In-post trading
                  </span>
                  <span className="text-[12px] text-muted-foreground">Every call has an instant swap panel built in</span>
                </div>
                <BuyPanelViz />
              </motion.div>

              {/* Notifications */}
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, delay: 0.6, ease: "easeOut" }}
              >
                <div className="flex items-center gap-2 mb-3">
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-violet-500/25 bg-violet-500/8 px-2.5 py-1 text-[11px] font-medium text-violet-400">
                    <Zap className="w-3 h-3" />
                    Real-time alerts
                  </span>
                  <span className="text-[12px] text-muted-foreground">From live posts & our on-chain intelligence</span>
                </div>
                <AlertsViz />
              </motion.div>
            </motion.div>

            {/* ── Right: Login card (sticky) ── */}
            <div className="order-1 lg:order-2 lg:sticky lg:top-8 w-full max-w-[440px] mx-auto lg:mx-0">
              <LoginCard privyAvailable={privyAvailable} />
            </div>

          </div>
        </div>
      </main>

      {/* ── Weekly Best Section ── */}
      <WeeklyBestSection optimizeMotion={false} />
    </div>
  );
}
