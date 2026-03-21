import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { motion } from "framer-motion";
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
      <Button
        type="button"
        className="h-[56px] w-full rounded-2xl border border-white/15 bg-[linear-gradient(135deg,#c7f5a6_0%,#98e9dc_100%)] px-5 text-slate-950 shadow-[0_16px_48px_-20px_rgba(152,233,220,0.75)] transition-all duration-300 hover:-translate-y-px hover:brightness-105 hover:shadow-[0_20px_56px_-20px_rgba(152,233,220,0.9)] justify-between"
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

      {/* X / Twitter */}
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

// ─── Page ──────────────────────────────────────────────────────────────────────

const stats = [
  { value: "10K+", label: "Calls settled" },
  { value: "68%", label: "Avg accuracy" },
  { value: "2.4K", label: "Active traders" },
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
        <div
          className="absolute -top-[20%] right-[-8%] h-[600px] w-[600px] rounded-full blur-[100px] opacity-60 motion-safe:animate-glow-pulse"
          style={{ background: "radial-gradient(ellipse, hsl(var(--primary)/0.12) 0%, transparent 65%)" }}
        />
        <div
          className="absolute bottom-[-12%] left-[-10%] h-[500px] w-[500px] rounded-full blur-[90px] opacity-50 motion-safe:animate-glow-pulse"
          style={{ background: "radial-gradient(ellipse, hsl(var(--accent)/0.09) 0%, transparent 65%)", animationDelay: "1.8s" }}
        />
        <div
          className="absolute inset-0 opacity-[0.02]"
          style={{
            backgroundImage: `linear-gradient(hsl(var(--foreground)) 1px, transparent 1px), linear-gradient(90deg, hsl(var(--foreground)) 1px, transparent 1px)`,
            backgroundSize: "64px 64px",
          }}
        />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,transparent_0%,hsl(var(--background))_80%)]" />
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
              <span className="w-1.5 h-1.5 rounded-full bg-gain animate-pulse" />
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
              initial={{ opacity: 0, y: 16 }}
              animate={loaded ? { opacity: 1, y: 0 } : {}}
              transition={{ duration: 0.5, delay: 0.05, ease: "easeOut" }}
            >
              {/* Eyebrow */}
              <div className="inline-flex items-center gap-2 rounded-full border border-primary/25 bg-primary/8 px-3 py-1 text-[11px] font-medium text-primary mb-7">
                <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
                Good alpha first. Fees follow.
              </div>

              {/* Headline */}
              <h1 className="font-heading text-4xl sm:text-5xl lg:text-[3.25rem] xl:text-6xl font-extrabold tracking-tight leading-[1.06] mb-5">
                Post a Call.
                <br />
                <span className="bg-gradient-to-r from-[#c7f5a6] via-[#a9ef9d] to-[#98e9dc] bg-clip-text text-transparent">
                  Earn the Buy.
                </span>
              </h1>

              {/* Sub */}
              <p className="text-base sm:text-lg text-muted-foreground leading-relaxed mb-10 max-w-[440px]">
                Be first with good alpha, capture the buy route, and earn{" "}
                <span className="text-foreground font-semibold">0.5%</span> every time
                traders act from your post.
              </p>

              {/* Stats */}
              <div className="flex items-center gap-6 sm:gap-8">
                {stats.map((stat, i) => (
                  <motion.div
                    key={stat.label}
                    initial={{ opacity: 0, y: 8 }}
                    animate={loaded ? { opacity: 1, y: 0 } : {}}
                    transition={{ duration: 0.4, delay: 0.2 + i * 0.07, ease: "easeOut" }}
                  >
                    <div className="text-2xl sm:text-3xl font-mono font-bold tracking-tight">
                      {stat.value}
                    </div>
                    <div className="text-[11px] sm:text-xs text-muted-foreground mt-0.5">
                      {stat.label}
                    </div>
                  </motion.div>
                ))}
              </div>
            </motion.div>

            {/* ── Right: Sign-in card ── */}
            <motion.div
              className="order-1 lg:order-2 w-full max-w-[440px] mx-auto lg:mx-0"
              initial={{ opacity: 0, y: 16 }}
              animate={loaded ? { opacity: 1, y: 0 } : {}}
              transition={{ duration: 0.5, delay: 0.12, ease: "easeOut" }}
            >
              <div className={cn(
                "relative rounded-[28px] p-[1px]",
                "bg-[linear-gradient(160deg,hsl(var(--primary)/0.5),hsl(var(--accent)/0.25),transparent_80%)]",
                "shadow-[0_32px_100px_-40px_hsl(var(--primary)/0.6)]"
              )}>
                {/* Inner glow */}
                <div className="absolute inset-[15%] rounded-full bg-primary/10 blur-3xl pointer-events-none" />

                <div className="relative rounded-[27px] overflow-hidden border border-white/6 bg-background/94 backdrop-blur-2xl">
                  <div className="px-7 pt-7 pb-6">

                    {/* Card header */}
                    <div className="mb-7">
                      <div className="text-[10px] uppercase tracking-[0.3em] text-primary/70 mb-2">
                        Creator access
                      </div>
                      <h2 className="text-2xl font-heading font-bold tracking-tight">
                        Sign in to Phew
                      </h2>
                      <p className="text-sm text-muted-foreground mt-1.5">
                        Instant account. No wallet needed to start.
                      </p>
                    </div>

                    {/* Auth buttons */}
                    {privyAvailable ? <PrivyLoginButton /> : <FallbackLoginButton />}

                    {/* Divider */}
                    <div className="mt-6 pt-5 border-t border-border/40">
                      <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                        <span>Secure email verification</span>
                        <span className="flex items-center gap-1.5">
                          <span className="w-1.5 h-1.5 rounded-full bg-gain" />
                          Payout rail active
                        </span>
                      </div>
                    </div>

                  </div>

                  {/* Footer */}
                  <div className="px-7 py-4 bg-card/40 border-t border-border/30">
                    <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                      <span>0.5% per routed buy</span>
                      <span>Reputation compounds on-chain</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Trust note */}
              <p className="text-center text-[11px] text-muted-foreground mt-4">
                Wallet linking handled separately after sign-in.
              </p>
            </motion.div>

          </div>
        </div>
      </main>
    </div>
  );
}
