import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { motion, useMotionValue, useTransform, animate } from "framer-motion";
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
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

// ─── Animated stat counter ──────────────────────────────────────────────────

function AnimatedStat({ rawValue, label, delay }: { rawValue: number; suffix: string; label: string; delay: number }) {
  const motionVal = useMotionValue(0);
  const rounded = useTransform(motionVal, (v) => Math.round(v));
  const [display, setDisplay] = useState("0");

  useEffect(() => {
    const unsub = rounded.on("change", (v) => setDisplay(String(v)));
    const ctrl = animate(motionVal, rawValue, { duration: 1.6, delay, ease: "easeOut" });
    return () => { ctrl.stop(); unsub(); };
  }, [rawValue, delay, motionVal, rounded]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay, ease: "easeOut" }}
    >
      <div className="text-2xl sm:text-3xl font-mono font-bold tracking-tight">
        {display}
        <span className="text-primary/70">{rawValue >= 1000 ? "K+" : rawValue >= 100 ? "%" : ""}</span>
      </div>
      <div className="text-[11px] sm:text-xs text-muted-foreground mt-0.5">{label}</div>
    </motion.div>
  );
}

// ─── Floating background particles ──────────────────────────────────────────

const PARTICLES = Array.from({ length: 18 }, (_, i) => ({
  id: i,
  x: 5 + ((i * 37) % 90),
  size: 1.5 + (i % 3) * 0.8,
  delay: (i * 0.4) % 5,
  duration: 8 + (i % 5) * 2,
  opacity: 0.08 + (i % 4) * 0.04,
}));

function FloatingParticles() {
  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none">
      {PARTICLES.map((p) => (
        <motion.div
          key={p.id}
          className="absolute rounded-full bg-primary"
          style={{
            left: `${p.x}%`,
            bottom: "-10px",
            width: p.size,
            height: p.size,
            opacity: p.opacity,
          }}
          animate={{
            y: [0, -(window.innerHeight + 40)],
            x: [0, (p.id % 2 === 0 ? 1 : -1) * (10 + (p.id % 4) * 8)],
            opacity: [0, p.opacity * 2, p.opacity, 0],
          }}
          transition={{
            duration: p.duration,
            delay: p.delay,
            repeat: Infinity,
            ease: "linear",
          }}
        />
      ))}
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
          className="h-[56px] w-full rounded-2xl border border-white/15 bg-[linear-gradient(135deg,#c7f5a6_0%,#98e9dc_100%)] px-5 text-slate-950 shadow-[0_16px_48px_-20px_rgba(152,233,220,0.75)] transition-shadow duration-300 hover:shadow-[0_20px_56px_-20px_rgba(152,233,220,0.95)] justify-between"
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
                <span className="flex h-8 w-8 items-center justify-center rounded-xl border border-slate-950/10 bg-slate-950/8">
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
          className="group h-[56px] w-full rounded-2xl border border-white/14 bg-[linear-gradient(180deg,rgba(14,18,20,0.96),rgba(8,11,12,0.94))] px-5 text-white shadow-[0_12px_40px_-20px_rgba(0,0,0,0.8)] transition-all duration-300 hover:border-white/24 hover:text-white hover:shadow-[0_16px_48px_-20px_rgba(0,0,0,0.95)] justify-between"
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
                <span className="inline-flex h-8 w-8 items-center justify-center rounded-xl border border-white/10 bg-white/[0.07] text-sm font-black transition-colors group-hover:bg-white/[0.1]">
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
        className="h-[56px] w-full rounded-2xl opacity-50 justify-start gap-3"
        disabled
      >
        <Loader2 className="w-4 h-4 animate-spin" />
        <span className="text-sm font-semibold">Continue with Email</span>
      </Button>
      <Button
        type="button"
        variant="outline"
        className="h-[56px] w-full rounded-2xl opacity-50 justify-start gap-3"
        disabled
      >
        <Loader2 className="w-4 h-4 animate-spin" />
        <span className="text-sm font-semibold">Continue with X</span>
      </Button>
    </div>
  );
}

// ─── Rotating card border ────────────────────────────────────────────────────

function RotatingCardBorder({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative rounded-[28px] p-[1px] overflow-hidden shadow-[0_32px_100px_-40px_hsl(var(--primary)/0.55)]">
      {/* Rotating conic gradient ring */}
      <motion.div
        className="absolute inset-[-100%] opacity-70"
        style={{
          background:
            "conic-gradient(from 0deg, transparent 0%, hsl(var(--primary)/0.9) 25%, transparent 50%, hsl(var(--accent)/0.6) 75%, transparent 100%)",
        }}
        animate={{ rotate: 360 }}
        transition={{ duration: 7, repeat: Infinity, ease: "linear" }}
      />
      {/* Static base border so it doesn't fully disappear */}
      <div className="absolute inset-0 rounded-[28px] bg-[linear-gradient(160deg,hsl(var(--primary)/0.35),hsl(var(--accent)/0.15),transparent_70%)]" />
      {/* Content */}
      <div className="relative">{children}</div>
    </div>
  );
}

// ─── Page ──────────────────────────────────────────────────────────────────────

const stats = [
  { value: "10K+", rawValue: 10, suffix: "K+", label: "Calls settled" },
  { value: "68%", rawValue: 68, suffix: "%", label: "Avg accuracy" },
  { value: "2.4K", rawValue: 2400, suffix: "+", label: "Active traders" },
];

export default function Login() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { user, hasLiveSession, isReady } = useAuth();
  const privyAvailable = usePrivyAvailable();
  const [loaded, setLoaded] = useState(false);

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

  useEffect(() => {
    const t = window.setTimeout(() => setLoaded(true), 30);
    return () => window.clearTimeout(t);
  }, []);

  return (
    <div className="min-h-screen bg-background flex flex-col overflow-x-hidden">

      {/* ── Background ── */}
      <div className="fixed inset-0 pointer-events-none z-0 overflow-hidden">
        {/* Orb 1 — top right, primary */}
        <motion.div
          className="absolute rounded-full blur-[120px]"
          style={{
            width: 680,
            height: 680,
            top: "-20%",
            right: "-8%",
            background: "radial-gradient(ellipse, hsl(var(--primary)/0.14) 0%, transparent 65%)",
          }}
          animate={{
            x: [0, 50, -30, 20, 0],
            y: [0, -40, 20, -15, 0],
            scale: [1, 1.08, 0.96, 1.04, 1],
          }}
          transition={{ duration: 18, repeat: Infinity, ease: "easeInOut" }}
        />
        {/* Orb 2 — bottom left, accent */}
        <motion.div
          className="absolute rounded-full blur-[100px]"
          style={{
            width: 560,
            height: 560,
            bottom: "-14%",
            left: "-10%",
            background: "radial-gradient(ellipse, hsl(var(--accent)/0.11) 0%, transparent 65%)",
          }}
          animate={{
            x: [0, -40, 25, -15, 0],
            y: [0, 30, -20, 10, 0],
            scale: [1, 1.06, 0.94, 1.02, 1],
          }}
          transition={{ duration: 22, repeat: Infinity, ease: "easeInOut", delay: 3 }}
        />
        {/* Orb 3 — center, subtle */}
        <motion.div
          className="absolute rounded-full blur-[140px]"
          style={{
            width: 400,
            height: 400,
            top: "35%",
            left: "40%",
            background: "radial-gradient(ellipse, hsl(var(--primary)/0.06) 0%, transparent 65%)",
          }}
          animate={{
            x: [0, 60, -40, 30, 0],
            y: [0, -50, 30, -20, 0],
          }}
          transition={{ duration: 26, repeat: Infinity, ease: "easeInOut", delay: 6 }}
        />

        {/* Subtle grid */}
        <div
          className="absolute inset-0 opacity-[0.025]"
          style={{
            backgroundImage: `linear-gradient(hsl(var(--foreground)) 1px, transparent 1px), linear-gradient(90deg, hsl(var(--foreground)) 1px, transparent 1px)`,
            backgroundSize: "64px 64px",
          }}
        />
        {/* Radial vignette to blend grid edges */}
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,transparent_0%,hsl(var(--background))_80%)]" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_bottom,transparent_0%,hsl(var(--background)/0.6)_90%)]" />

        {/* Floating particles */}
        <FloatingParticles />
      </div>

      {/* ── Header ── */}
      <motion.header
        className="relative z-50 border-b border-border/35 backdrop-blur-xl bg-background/65"
        initial={{ opacity: 0, y: -8 }}
        animate={loaded ? { opacity: 1, y: 0 } : {}}
        transition={{ duration: 0.35, ease: "easeOut" }}
      >
        <div className="max-w-6xl mx-auto px-5 sm:px-8 h-14 flex items-center justify-between">
          <BrandLogo size="sm" showTagline={false} />
          <div className="flex items-center gap-3">
            <span className="hidden sm:inline-flex items-center gap-1.5 text-[11px] text-muted-foreground border border-border/50 rounded-full px-2.5 py-1 bg-card/40">
              <motion.span
                className="w-1.5 h-1.5 rounded-full bg-gain inline-block"
                animate={{ opacity: [1, 0.3, 1] }}
                transition={{ duration: 1.8, repeat: Infinity, ease: "easeInOut" }}
              />
              Live
            </span>
            <ThemeToggle size="icon" className="h-8 w-8" />
          </div>
        </div>
      </motion.header>

      {/* ── Main ── */}
      <main className="relative z-10 flex-1 flex items-center justify-center px-5 sm:px-8 py-10 sm:py-16">
        <div className="w-full max-w-6xl">
          <div className="grid lg:grid-cols-[1fr_400px] xl:grid-cols-[1fr_440px] gap-12 xl:gap-20 items-center">

            {/* ── Left: Brand + Value prop ── */}
            <motion.div
              className="order-2 lg:order-1 max-w-xl"
              initial={{ opacity: 0, x: -20 }}
              animate={loaded ? { opacity: 1, x: 0 } : {}}
              transition={{ duration: 0.6, delay: 0.05, ease: "easeOut" }}
            >
              {/* Eyebrow */}
              <motion.div
                className="inline-flex items-center gap-2 rounded-full border border-primary/25 bg-primary/8 px-3 py-1 text-[11px] font-medium text-primary mb-7"
                initial={{ opacity: 0, scale: 0.9 }}
                animate={loaded ? { opacity: 1, scale: 1 } : {}}
                transition={{ duration: 0.4, delay: 0.1, ease: "easeOut" }}
              >
                <motion.span
                  className="w-1.5 h-1.5 rounded-full bg-primary inline-block"
                  animate={{ opacity: [1, 0.3, 1] }}
                  transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
                />
                Good alpha first. Fees follow.
              </motion.div>

              {/* Headline */}
              <motion.h1
                className="font-heading text-4xl sm:text-5xl lg:text-[3.25rem] xl:text-6xl font-extrabold tracking-tight leading-[1.06] mb-5"
                initial={{ opacity: 0, y: 20 }}
                animate={loaded ? { opacity: 1, y: 0 } : {}}
                transition={{ duration: 0.55, delay: 0.15, ease: "easeOut" }}
              >
                Post a Call.
                <br />
                <span className="bg-gradient-to-r from-[#c7f5a6] via-[#a9ef9d] to-[#98e9dc] bg-clip-text text-transparent">
                  Earn the Buy.
                </span>
              </motion.h1>

              {/* Sub */}
              <motion.p
                className="text-base sm:text-lg text-muted-foreground leading-relaxed mb-10 max-w-[440px]"
                initial={{ opacity: 0, y: 16 }}
                animate={loaded ? { opacity: 1, y: 0 } : {}}
                transition={{ duration: 0.5, delay: 0.22, ease: "easeOut" }}
              >
                Be first with good alpha, capture the buy route, and earn{" "}
                <span className="text-foreground font-semibold">0.5%</span> every time
                traders act from your post.
              </motion.p>

              {/* Stats */}
              <div className="flex items-center gap-6 sm:gap-8">
                {loaded && stats.map((stat, i) => (
                  <AnimatedStat
                    key={stat.label}
                    rawValue={stat.rawValue}
                    suffix={stat.suffix}
                    label={stat.label}
                    delay={0.3 + i * 0.1}
                  />
                ))}
              </div>
            </motion.div>

            {/* ── Right: Sign-in card ── */}
            <motion.div
              className="order-1 lg:order-2 w-full max-w-[440px] mx-auto lg:mx-0"
              initial={{ opacity: 0, x: 20 }}
              animate={loaded ? { opacity: 1, x: 0 } : {}}
              transition={{ duration: 0.6, delay: 0.12, ease: "easeOut" }}
            >
              <RotatingCardBorder>
                <div className="relative rounded-[27px] overflow-hidden border border-white/6 bg-background/94 backdrop-blur-2xl">
                  {/* Inner top glow */}
                  <div className="absolute inset-[15%] top-0 h-[40%] rounded-full bg-primary/8 blur-3xl pointer-events-none" />

                  <div className="px-7 pt-7 pb-6 relative">
                    {/* Card header */}
                    <div className="mb-7">
                      <motion.div
                        className="text-[10px] uppercase tracking-[0.3em] text-primary/70 mb-2"
                        initial={{ opacity: 0 }}
                        animate={loaded ? { opacity: 1 } : {}}
                        transition={{ duration: 0.4, delay: 0.3 }}
                      >
                        Creator access
                      </motion.div>
                      <motion.h2
                        className="text-2xl font-heading font-bold tracking-tight"
                        initial={{ opacity: 0, y: 6 }}
                        animate={loaded ? { opacity: 1, y: 0 } : {}}
                        transition={{ duration: 0.4, delay: 0.35 }}
                      >
                        Sign in to Phew
                      </motion.h2>
                      <motion.p
                        className="text-sm text-muted-foreground mt-1.5"
                        initial={{ opacity: 0 }}
                        animate={loaded ? { opacity: 1 } : {}}
                        transition={{ duration: 0.4, delay: 0.4 }}
                      >
                        Instant account. No wallet needed to start.
                      </motion.p>
                    </div>

                    {/* Auth buttons */}
                    <motion.div
                      initial={{ opacity: 0, y: 8 }}
                      animate={loaded ? { opacity: 1, y: 0 } : {}}
                      transition={{ duration: 0.4, delay: 0.45 }}
                    >
                      {privyAvailable ? <PrivyLoginButton /> : <FallbackLoginButton />}
                    </motion.div>

                    {/* Divider */}
                    <motion.div
                      className="mt-6 pt-5 border-t border-border/40"
                      initial={{ opacity: 0 }}
                      animate={loaded ? { opacity: 1 } : {}}
                      transition={{ duration: 0.4, delay: 0.52 }}
                    >
                      <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                        <span>Secure email verification</span>
                        <span className="flex items-center gap-1.5">
                          <motion.span
                            className="w-1.5 h-1.5 rounded-full bg-gain inline-block"
                            animate={{ scale: [1, 1.4, 1], opacity: [1, 0.6, 1] }}
                            transition={{ duration: 2.5, repeat: Infinity, ease: "easeInOut" }}
                          />
                          Payout rail active
                        </span>
                      </div>
                    </motion.div>
                  </div>

                  {/* Footer */}
                  <div className="px-7 py-4 bg-card/40 border-t border-border/30">
                    <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                      <span>0.5% per routed buy</span>
                      <span>Reputation compounds on-chain</span>
                    </div>
                  </div>
                </div>
              </RotatingCardBorder>

              {/* Trust note */}
              <motion.p
                className="text-center text-[11px] text-muted-foreground mt-4"
                initial={{ opacity: 0 }}
                animate={loaded ? { opacity: 1 } : {}}
                transition={{ duration: 0.4, delay: 0.6 }}
              >
                Wallet linking handled separately after sign-in.
              </motion.p>
            </motion.div>

          </div>
        </div>
      </main>
    </div>
  );
}
