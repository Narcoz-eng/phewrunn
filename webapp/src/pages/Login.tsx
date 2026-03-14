import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { motion, useReducedMotion } from "framer-motion";
import { Suspense, lazy, useRef, type ReactNode } from "react";
import { useAuth, usePrivySyncFailureSnapshot } from "@/lib/auth-client";
import { usePrivyLogin } from "@/hooks/usePrivyLogin";
import { usePrivyAvailable } from "@/components/PrivyWalletProvider";
import { ThemeToggle } from "@/components/ThemeToggle";
import { BrandLogo } from "@/components/BrandLogo";
import { LevelBar } from "@/components/feed/LevelBar";
import { CreatorFeeRailIcon } from "@/components/login/CreatorFeeRailIcon";
import {
  CommunityTrustIcon,
  FlowRouteIcon,
  InboxRouteIcon,
  LevelTierIcon,
  OutcomeLiftIcon,
  PenaltyMarkIcon,
  ProofShieldIcon,
  RouteArrowIcon,
  SignalBurstIcon,
  SignalTargetIcon,
  TimingWindowIcon,
  ConsistencyGridIcon,
} from "@/components/login/LoginPageIcons";
import { useIsMobile } from "@/hooks/use-mobile";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  LIQUIDATION_LEVEL,
  MAX_LEVEL,
  MIN_LEVEL,
  STARTING_LEVEL,
  VETERAN_THRESHOLD,
} from "@/types";
import { AccuracyScoreCard } from "@/components/AccuracyScoreCard";
import { WeeklyBestSection } from "@/components/login/WeeklyBestSection";

const FeeOrbit = lazy(() =>
  import("@/components/login/FeeOrbit").then((module) => ({
    default: module.FeeOrbit,
  }))
);

const ReputationEngine = lazy(() =>
  import("@/components/login/ReputationEngine").then((module) => ({
    default: module.ReputationEngine,
  }))
);

type DeferredViewportBlockProps = {
  children: ReactNode;
  fallback: ReactNode;
  disabled?: boolean;
  rootMargin?: string;
};

function DeferredViewportBlock({
  children,
  fallback,
  disabled = false,
  rootMargin = "260px",
}: DeferredViewportBlockProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [isReady, setIsReady] = useState(disabled);

  useEffect(() => {
    if (disabled) {
      setIsReady(true);
      return;
    }

    const node = hostRef.current;
    if (!node || typeof window === "undefined" || !("IntersectionObserver" in window)) {
      setIsReady(true);
      return;
    }

    const observer = new window.IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setIsReady(true);
          observer.disconnect();
        }
      },
      { rootMargin }
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, [disabled, rootMargin]);

  return <div ref={hostRef}>{isReady ? children : fallback}</div>;
}

function MarketingSectionPlaceholder({
  eyebrow,
  title,
  className,
}: {
  eyebrow: string;
  title: string;
  className?: string;
}) {
  return (
    <section className={className}>
      <div className="max-w-7xl mx-auto px-5 sm:px-6 py-12 md:py-16">
        <div className="rounded-[28px] border border-border/40 bg-card/35 p-6 sm:p-8">
          <div className="animate-pulse space-y-4">
            <div className="h-3 w-28 rounded-full bg-primary/20" />
            <div className="h-8 max-w-lg rounded-full bg-foreground/10" />
            <div className="h-4 max-w-2xl rounded-full bg-foreground/10" />
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="h-32 rounded-2xl border border-border/35 bg-background/45" />
              <div className="h-32 rounded-2xl border border-border/35 bg-background/45" />
            </div>
          </div>
          <div className="sr-only">
            {eyebrow} {title}
          </div>
        </div>
      </div>
    </section>
  );
}

function VisualizationCardSkeleton() {
  return (
    <div className="rounded-2xl border border-border/50 bg-background/70 backdrop-blur-xl p-6 shadow-[0_20px_60px_-30px_hsl(var(--primary)/0.2)]">
      <div className="animate-pulse space-y-4">
        <div className="mx-auto h-5 w-40 rounded-full bg-primary/15" />
        <div className="mx-auto h-[220px] w-full max-w-[260px] rounded-full border border-border/35 bg-card/50" />
        <div className="h-10 rounded-xl border border-border/35 bg-card/50" />
      </div>
    </div>
  );
}

function ReputationEngineSkeleton() {
  return (
    <div className="rounded-[28px] border border-primary/15 bg-[linear-gradient(180deg,hsl(var(--card)/0.92),hsl(var(--background)/0.88))] p-5 sm:p-6 shadow-[0_24px_80px_-44px_hsl(var(--primary)/0.45)]">
      <div className="animate-pulse space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div className="space-y-2">
            <div className="h-3 w-28 rounded-full bg-primary/15" />
            <div className="h-7 w-56 rounded-full bg-foreground/10" />
          </div>
          <div className="h-8 w-28 rounded-full bg-background/60" />
        </div>
        <div className="grid gap-4 xl:grid-cols-[1.12fr_0.88fr]">
          <div className="h-[320px] rounded-[24px] border border-border/45 bg-background/55" />
          <div className="h-[320px] rounded-[24px] border border-border/45 bg-card/60" />
        </div>
      </div>
    </div>
  );
}

// ─── Data ─────────────────────────────────────────────────────────────────────

const earlyCallerData = [
  {
    label: "Hour 0",
    tag: "First Good Alpha",
    trades: 320,
    pct: 100,
    color: "bg-gain",
    textColor: "text-gain",
    borderColor: "border-gain/30",
    bgColor: "bg-gain/5",
    desc: "When your alpha lands first and traders trust it, your post captures the cleanest flow and the strongest attention.",
  },
  {
    label: "Hour 2",
    tag: "Late But Right",
    trades: 72,
    pct: 23,
    color: "bg-primary",
    textColor: "text-primary",
    borderColor: "border-primary/30",
    bgColor: "bg-primary/5",
    desc: "Even good alpha later in the cycle fights a market that already rewarded the first convincing post.",
  },
  {
    label: "Hour 6",
    tag: "Crowded Trade",
    trades: 14,
    pct: 4,
    color: "bg-muted-foreground",
    textColor: "text-muted-foreground",
    borderColor: "border-border/40",
    bgColor: "bg-background/40",
    desc: "By the time the crowd arrives, the edge is diluted, the trade is crowded, and most of the creator payout has already moved elsewhere.",
  },
];

const timingPillars = [
  {
    icon: FlowRouteIcon,
    title: "Early good alpha gets the cleanest flow",
    description:
      "The first convincing post catches traders before the market gets crowded, which means better attention and more buying routed through your call.",
    accent: "border-gain/20 bg-gain/5 text-gain",
  },
  {
    icon: ProofShieldIcon,
    title: "Being right matters more than being loud",
    description:
      "The platform rewards conviction the market can verify, not volume. Early plus accurate is what creates separation.",
    accent: "border-primary/20 bg-primary/5 text-primary",
  },
];

const reputationPillars = [
  {
    icon: OutcomeLiftIcon,
    title: "Good calls lift your level",
    description:
      "Settled wins become visible proof. The next trader sees stronger signal before they even open your post.",
    accent: "border-gain/20 bg-gain/5 text-gain",
  },
  {
    icon: PenaltyMarkIcon,
    title: "Bad calls mark you down in public",
    description:
      "Weak conviction and severe misses cool trust, cut reach, and force you to earn the edge back the hard way.",
    accent: "border-loss/20 bg-loss/5 text-loss",
  },
  {
    icon: ConsistencyGridIcon,
    title: "Consistency unlocks protection",
    description:
      "Veteran tiers reward traders who keep putting up quality outcomes instead of farming attention with noise.",
    accent: "border-primary/20 bg-primary/5 text-primary",
  },
];

const levelBarSnapshots = [
  {
    level: -4,
    title: "Danger Zone",
    note: "One more bad stretch and your profile starts losing the right to lead.",
  },
  {
    level: STARTING_LEVEL,
    title: "Neutral Entry",
    note: "Everyone starts from zero and earns trust in public from there.",
  },
  {
    level: 4,
    title: "Credible",
    note: "A visible streak starts to separate signal from random posting.",
  },
  {
    level: 5,
    title: "Veteran",
    note: "Protection kicks in once you have shown enough real quality.",
  },
  {
    level: 9,
    title: "Elite",
    note: "Top-tier profiles carry the strongest proof, trust, and attention.",
  },
];

const levelRules = [
  "Win above 3%: +1 level at 1H. Very large runners can scale higher.",
  "Small wins up to 3% are XP-only and do not move level.",
  "Soft loss under 30% gets a 6H recovery chance before any penalty.",
  "Veteran protection starts at LVL +5. Severe loss of 30%+ costs 1 level immediately.",
];

const features = [
  {
    icon: SignalTargetIcon,
    title: "Post Good Alpha First",
    description:
      "Every call is timestamped in public. When you are early and right, the receipts stay attached to your name.",
  },
  {
    icon: FlowRouteIcon,
    title: "Earn When Traders Buy Through Your Call",
    description:
      "When traders buy from your post, your call keeps the route and credits you 0.5%. Stronger signal keeps that flow coming back.",
  },
  {
    icon: CommunityTrustIcon,
    title: "Build Reputation That Compounds",
    description:
      "Accuracy, level, and trust all move off outcomes the market can see. Good calls pull you up. Bad calls show too.",
  },
];

const stats = [
  { value: "10K+", label: "Calls Settled" },
  { value: "68%", label: "Avg Public Accuracy" },
  { value: "2.4K", label: "Traders Chasing Signal" },
];

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
  const privySyncFailure = usePrivySyncFailureSnapshot();
  // Once we have any recovered user, keep the UI in a pending state until the
  // backend session confirms instead of flashing a stale failure.
  const visibleSyncError =
    !authUser && !hasLiveSession && !isSyncing && !authStatusMessage && (syncError || privySyncFailure)
      ? "Sign-in failed. Please retry."
      : null;
  const visibleStatus =
    authStatusMessage ?? (authUser && !hasLiveSession ? "Finalizing your session..." : null);
  const emailLabel = privyReady ? "Continue with Email" : "Initialize Email";
  const xLabel = privyReady ? "Sign in with X" : "Start X";
  const emailSubLabel = "Fastest path. Verification code lands instantly.";
  const xSubLabel = "Fast X access.";

  return (
    <div className="space-y-3">
      <div className="space-y-3">
        <Button
          type="button"
          className="h-auto min-h-[76px] w-full justify-between rounded-[24px] border border-white/15 bg-[linear-gradient(135deg,#c7f5a6_0%,#98e9dc_100%)] px-4 py-4 text-left text-slate-950 shadow-[0_24px_60px_-30px_rgba(152,233,220,0.85)] transition-all duration-300 hover:-translate-y-0.5 hover:brightness-105 hover:shadow-[0_28px_70px_-28px_rgba(152,233,220,0.95)]"
          onClick={() => login({ loginMethods: ["email"] })}
          disabled={isLoading || isRetryBlocked}
        >
          {isLoading ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              Signing you in...
            </>
          ) : (
            <>
              <span className="flex min-w-0 flex-1 items-center gap-3">
                <span className="flex h-11 w-11 items-center justify-center rounded-2xl border border-slate-950/10 bg-slate-950/10">
                  <InboxRouteIcon className="h-4 w-4" />
                </span>
                <span className="min-w-0 flex-1 space-y-0.5 pr-2">
                  <span className="block truncate text-sm font-semibold leading-tight">{emailLabel}</span>
                  <span className="block truncate text-xs text-slate-700 max-[380px]:hidden">
                    {emailSubLabel}
                  </span>
                </span>
              </span>
              <RouteArrowIcon className="h-4 w-4 shrink-0" />
            </>
          )}
        </Button>

        <Button
          type="button"
          variant="outline"
          className="group h-auto min-h-[76px] w-full justify-between rounded-[24px] border border-white/18 bg-[linear-gradient(180deg,rgba(14,18,20,0.96),rgba(8,11,12,0.94))] px-4 py-4 text-left text-white shadow-[0_20px_60px_-34px_rgba(0,0,0,0.95)] transition-[border-color,box-shadow,background-color,color] duration-300 hover:border-white/28 hover:bg-[linear-gradient(180deg,rgba(18,22,26,0.98),rgba(10,13,16,0.96))] hover:text-white hover:shadow-[0_24px_68px_-34px_rgba(0,0,0,0.98)]"
          onClick={() => login({ loginMethods: ["twitter"] })}
          disabled={isLoading || isRetryBlocked}
        >
          {isLoading ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              Signing you in...
            </>
          ) : (
            <>
              <span className="flex min-w-0 flex-1 items-center gap-3">
                <span className="inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-white/12 bg-white/[0.06] text-sm font-black transition-colors group-hover:border-white/18 group-hover:bg-white/[0.09]">
                  X
                </span>
                <span className="min-w-0 flex-1 space-y-0.5 pr-2">
                  <span className="block truncate text-sm font-semibold leading-tight">{xLabel}</span>
                  <span className="block truncate text-xs text-white/70 max-[420px]:hidden">
                    {xSubLabel}
                  </span>
                </span>
              </span>
              <RouteArrowIcon className="h-4 w-4 shrink-0 transition-transform duration-300 group-hover:translate-x-0.5" />
            </>
          )}
        </Button>
      </div>
      {visibleStatus ? (
        <div className="rounded-[18px] border border-white/10 bg-white/[0.03] px-3 py-2 text-[11px] leading-relaxed text-white/80">
          {visibleStatus}
        </div>
      ) : null}
      <p className="text-[11px] text-muted-foreground leading-relaxed">
        Wallet linking is handled separately in your profile after sign-in.
      </p>
      {visibleSyncError ? (
        <p className="text-[11px] text-red-400 leading-relaxed">{visibleSyncError}</p>
      ) : null}
    </div>
  );
}

function FallbackLoginButton() {
  return (
    <div className="space-y-3">
      <Button
        type="button"
        className="h-auto min-h-[76px] w-full justify-start rounded-[24px] px-4 py-4 font-semibold opacity-50"
        disabled
      >
        <Loader2 className="w-4 h-4 animate-spin" />
        Initializing Email
      </Button>
      <Button
        type="button"
        variant="outline"
        className="h-auto min-h-[76px] w-full justify-start rounded-[24px] px-4 py-4 font-semibold opacity-50"
        disabled
      >
        <Loader2 className="w-4 h-4 animate-spin" />
        Initializing X
      </Button>
    </div>
  );
}

// ─── Page ──────────────────────────────────────────────────────────────────────

export default function Login() {
  const navigate = useNavigate();
  const { user, hasLiveSession, isReady } = useAuth();
  const privyAvailable = usePrivyAvailable();
  const isMobile = useIsMobile();
  const reduceMotion = useReducedMotion();
  const optimizeMotion = isMobile || reduceMotion;
  const shouldDeferMarketing =
    isMobile || (typeof window !== "undefined" && window.innerWidth < 768);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!isReady || !hasLiveSession) return;
    navigate(user?.username ? "/" : "/welcome", { replace: true });
  }, [hasLiveSession, isReady, navigate, user?.username]);

  useEffect(() => {
    if (optimizeMotion) {
      setLoaded(true);
      return;
    }
    const t = window.setTimeout(() => setLoaded(true), 40);
    return () => window.clearTimeout(t);
  }, [optimizeMotion]);

  return (
    <div className="min-h-screen bg-background relative overflow-x-hidden">
      {/* ── Background atmosphere ── */}
      <div
        className={cn(
          "inset-0 pointer-events-none overflow-hidden z-0",
          isMobile ? "absolute" : "fixed"
        )}
      >
        {/* Top-right glow */}
        <div
          className={cn(
            "absolute rounded-full",
            optimizeMotion
              ? "-top-[8%] right-[-10%] h-[340px] w-[340px] blur-[70px] opacity-70"
              : "-top-[15%] right-[-5%] h-[700px] w-[700px] blur-[100px] motion-safe:animate-glow-pulse"
          )}
          style={{
            background:
              "radial-gradient(ellipse, hsl(var(--primary)/0.13) 0%, transparent 65%)",
          }}
        />
        {/* Bottom-left glow */}
        <div
          className={cn(
            "absolute rounded-full",
            optimizeMotion
              ? "bottom-[-6%] left-[-12%] h-[300px] w-[300px] blur-[65px] opacity-60"
              : "bottom-[-10%] left-[-8%] h-[600px] w-[600px] blur-[90px] motion-safe:animate-glow-pulse"
          )}
          style={{
            background:
              "radial-gradient(ellipse, hsl(var(--accent)/0.1) 0%, transparent 65%)",
            animationDelay: "1.5s",
          }}
        />
        {/* Mid gain glow */}
        <div
          className={cn(
            "absolute top-[50%] left-[50%] -translate-x-1/2 -translate-y-1/2 rounded-full",
            optimizeMotion ? "h-[220px] w-[220px] blur-[80px]" : "h-[400px] w-[400px] blur-[110px]"
          )}
          style={{
            background:
              "radial-gradient(ellipse, hsl(var(--gain)/0.04) 0%, transparent 70%)",
          }}
        />
        {/* Grid */}
        <div
          className={cn("absolute inset-0", optimizeMotion ? "opacity-[0.018]" : "opacity-[0.025]")}
          style={{
            backgroundImage: `linear-gradient(hsl(var(--foreground)) 1px, transparent 1px),
              linear-gradient(90deg, hsl(var(--foreground)) 1px, transparent 1px)`,
            backgroundSize: isMobile ? "56px 56px" : "64px 64px",
          }}
        />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,transparent_0%,hsl(var(--background))_75%)]" />
      </div>

      {/* ── Header ── */}
      <motion.header
        className="fixed top-0 left-0 right-0 z-50 border-b border-border/40 backdrop-blur-xl bg-background/70"
        initial={optimizeMotion ? false : { opacity: 0, y: -12 }}
        animate={loaded ? { opacity: 1, y: 0 } : {}}
        transition={{ duration: optimizeMotion ? 0 : 0.4, ease: "easeOut" }}
      >
        <div className="max-w-7xl mx-auto px-3 sm:px-6 py-3.5 flex items-center justify-between">
          <BrandLogo size="sm" showTagline={!isMobile} />
          <div className="flex items-center gap-3">
            <span className="hidden sm:inline-flex items-center gap-1.5 text-xs text-muted-foreground border border-border/50 rounded-full px-3 py-1 bg-card/50">
              <span className="w-1.5 h-1.5 rounded-full bg-gain animate-pulse" />
              Live platform
            </span>
            <ThemeToggle size="icon" className="h-9 w-9" />
          </div>
        </div>
      </motion.header>

      {/* ── Main ── */}
      <main className="relative z-10 pt-[72px]">

        {/* ━━━━━━ SECTION 1: HERO ━━━━━━ */}
        <section className="max-w-7xl mx-auto px-3 sm:px-6 pt-6 pb-6 sm:pt-10 sm:pb-8 md:pt-14 md:pb-12">
          <div className="grid xl:grid-cols-[1fr_420px] gap-5 sm:gap-8 xl:gap-12 items-start">

            {/* Left — headline + features */}
            <motion.div
              className="order-2 xl:order-1 space-y-5 sm:space-y-6"
              initial={optimizeMotion ? false : { opacity: 0, y: 20 }}
              animate={loaded ? { opacity: 1, y: 0 } : {}}
              transition={{ duration: optimizeMotion ? 0 : 0.5, delay: optimizeMotion ? 0 : 0.1 }}
            >
              {/* Badge */}
              <div className="inline-flex max-w-full items-center gap-2 rounded-full border border-primary/20 bg-primary/5 px-3 py-1.5 text-[11px] font-medium text-primary sm:px-3.5 sm:text-xs">
                <SignalBurstIcon className="w-3.5 h-3.5" />
                Good alpha first. Fees follow.
              </div>

              {/* Headline */}
              <div>
                <h1 className="font-heading text-[2.6rem] sm:text-5xl lg:text-6xl font-extrabold tracking-tight leading-[1.05]">
                  Post a Call.
                  <br />
                  <span
                    className="bg-gradient-to-r from-[#c7f5a6] via-[#a9ef9d] to-[#98e9dc] bg-clip-text text-transparent"
                  >
                    Earn When Your Call Gets The Buy.
                  </span>
                </h1>
                <p className="mt-3.5 max-w-xl text-[15px] leading-relaxed text-muted-foreground sm:mt-4 sm:text-lg">
                  The first good alpha does more than win attention. It captures
                  the buy route, raises your public reputation, and credits you{" "}
                  <span className="text-foreground font-semibold">0.5%</span> every
                  time traders act directly from your post.
                </p>
              </div>

              {/* Stats row */}
              <div className="grid max-w-[22rem] grid-cols-3 gap-1.5 sm:max-w-md sm:gap-3">
                {stats.map((stat, i) => (
                  <motion.div
                    key={stat.label}
                    className="rounded-xl border border-border/50 bg-card/60 p-3 sm:p-3.5 backdrop-blur-sm"
                    initial={optimizeMotion ? false : { opacity: 0, y: 12 }}
                    animate={loaded ? { opacity: 1, y: 0 } : {}}
                    transition={{ duration: optimizeMotion ? 0 : 0.4, delay: optimizeMotion ? 0 : 0.2 + i * 0.06 }}
                  >
                    <div className="text-lg sm:text-2xl font-mono font-bold tracking-tight">
                      {stat.value}
                    </div>
                    <div className="mt-0.5 text-[10px] text-muted-foreground sm:text-[11px]">
                      {stat.label}
                    </div>
                  </motion.div>
                ))}
              </div>

              {/* AccuracyScoreCard */}
              <motion.div
                className="max-w-md"
                initial={optimizeMotion ? false : { opacity: 0, y: 12 }}
                animate={loaded ? { opacity: 1, y: 0 } : {}}
                transition={{ duration: optimizeMotion ? 0 : 0.4, delay: optimizeMotion ? 0 : 0.32 }}
              >
                <AccuracyScoreCard />
              </motion.div>

              {/* Features */}
              <div className="grid gap-2.5 max-w-md">
                {features.map((f, i) => (
                  <motion.div
                    key={f.title}
                    className="flex items-start gap-3 rounded-xl border border-border/50 bg-card/50 p-3.5 sm:p-4 hover:border-primary/30 transition-colors duration-200"
                    initial={optimizeMotion ? false : { opacity: 0, x: -12 }}
                    animate={loaded ? { opacity: 1, x: 0 } : {}}
                    transition={{ duration: optimizeMotion ? 0 : 0.4, delay: optimizeMotion ? 0 : 0.38 + i * 0.07 }}
                  >
                    <div className="w-9 h-9 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0">
                      <f.icon className="w-4.5 h-4.5 text-primary w-[18px] h-[18px]" />
                    </div>
                    <div>
                      <h3 className="font-semibold text-sm">{f.title}</h3>
                      <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
                        {f.description}
                      </p>
                    </div>
                  </motion.div>
                ))}
              </div>
            </motion.div>

            {/* Right — sign-in + fee orbit */}
            <div className="order-1 xl:order-2 w-full max-w-[352px] sm:max-w-[420px] mx-auto xl:mx-0 xl:sticky xl:top-[80px]">
              <motion.div
                initial={optimizeMotion ? false : { opacity: 0, y: 20 }}
                animate={loaded ? { opacity: 1, y: 0 } : {}}
                transition={{ duration: optimizeMotion ? 0 : 0.5, delay: optimizeMotion ? 0 : 0.15 }}
              >
                <div className={cn(
                  "relative rounded-[30px] p-[1px] bg-[linear-gradient(160deg,hsl(var(--primary)/0.55),hsl(var(--accent)/0.28),transparent_88%)]",
                  isMobile ? "shadow-[0_24px_80px_-48px_hsl(var(--primary)/0.55)]" : "shadow-[0_32px_120px_-40px_hsl(var(--primary)/0.7)]"
                )}>
                  <div className="absolute inset-[12%] rounded-full bg-primary/12 blur-3xl pointer-events-none" />
                  <div className="relative rounded-[29px] overflow-hidden border border-white/8 bg-background/92 backdrop-blur-2xl">
                    <div className="border-b border-border/50 bg-[linear-gradient(180deg,hsl(var(--primary)/0.14),transparent_75%)] px-3.5 pb-4 pt-4.5 sm:px-6 sm:pb-5 sm:pt-6">
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div className="flex items-start gap-3">
                          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-primary/25 bg-[radial-gradient(circle_at_32%_28%,hsl(var(--primary)/0.22),transparent_62%),linear-gradient(180deg,rgba(12,18,24,0.9),rgba(8,12,16,0.88))] shadow-[0_0_0_1px_hsl(var(--primary)/0.08)]">
                            <CreatorFeeRailIcon className="h-5 w-5" />
                          </div>
                          <div>
                            <div className="text-[10px] uppercase tracking-[0.28em] text-primary/75 mb-2">
                              Creator Fee Rail
                            </div>
                            <h2 className="text-xl font-semibold tracking-tight">
                              Start Earning Today
                            </h2>
                            <p className="text-xs text-muted-foreground leading-relaxed mt-1.5 max-w-[250px]">
                              Be the post traders trust first and turn that conviction into creator payouts.
                            </p>
                          </div>
                        </div>
                        <div className="shrink-0 rounded-full border border-gain/20 bg-gain/10 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-gain">
                          0.5% Live
                        </div>
                      </div>

                      <div className="mt-4 grid grid-cols-2 gap-2 sm:mt-5 sm:grid-cols-3">
                        {[
                          { label: "Account", value: "Instant" },
                          { label: "Payouts", value: "On-chain" },
                          { label: "Setup", value: "Email first" },
                        ].map((item, index) => (
                          <div
                            key={item.label}
                            className={cn(
                              "rounded-2xl border border-border/45 bg-background/45 px-3 py-3",
                              index === 2 && "col-span-2 sm:col-span-1"
                            )}
                          >
                            <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                              {item.label}
                            </div>
                            <div className="text-sm font-semibold tracking-tight mt-1">
                              {item.value}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="space-y-3 p-3.5 sm:space-y-4 sm:p-5">
                      <div className="rounded-[24px] border border-primary/18 bg-[radial-gradient(circle_at_top,hsl(var(--primary)/0.14),transparent_58%),linear-gradient(180deg,hsl(var(--card)/0.92),hsl(var(--background)/0.82))] p-3.5 sm:p-4 shadow-[0_20px_60px_-34px_hsl(var(--primary)/0.55)]">
                        <div className="flex items-center justify-between gap-3 mb-3">
                          <div>
                            <div className="text-[10px] uppercase tracking-[0.24em] text-muted-foreground">
                              Secure Access
                            </div>
                            <div className="text-sm font-semibold tracking-tight mt-1">
                              Launch your creator dashboard
                            </div>
                          </div>
                          <div className="w-9 h-9 rounded-2xl border border-border/50 bg-background/60 flex items-center justify-center shrink-0">
                            <ProofShieldIcon className="w-4 h-4 text-primary" />
                          </div>
                        </div>
                        {privyAvailable ? <PrivyLoginButton /> : <FallbackLoginButton />}
                        <div className="mt-3 flex items-start gap-2 rounded-2xl border border-border/45 bg-background/55 px-3 py-3">
                          <ProofShieldIcon className="w-3.5 h-3.5 mt-0.5 text-primary shrink-0" />
                          <p className="text-[11px] text-muted-foreground leading-relaxed">
                            Secure email verification. Your account opens instantly and you can connect payout rails later.
                          </p>
                        </div>
                      </div>

                      <div className="rounded-[24px] border border-gain/20 bg-[linear-gradient(180deg,hsl(var(--gain)/0.11),transparent_18%),linear-gradient(180deg,hsl(var(--background)/0.78),hsl(var(--background)/0.96))] p-3.5 sm:p-4">
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
                          <div>
                            <div className="text-[10px] uppercase tracking-[0.24em] text-gain/80">
                              Fee Capture Model
                            </div>
                            <div className="mt-2 text-4xl font-mono font-bold text-gain">
                              0.5%
                            </div>
                            <p className="mt-2 text-[11px] text-muted-foreground leading-relaxed max-w-[190px]">
                              Each routed buy credits your call automatically.
                            </p>
                          </div>
                          <div className="rounded-2xl border border-gain/15 bg-background/55 px-3 py-3 min-w-[108px]">
                            <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                              Status
                            </div>
                            <div className="mt-2 flex items-center gap-2 text-sm font-semibold text-foreground">
                              <span className="w-2 h-2 rounded-full bg-gain animate-pulse" />
                              Routing live
                            </div>
                            <div className="mt-1 text-[11px] text-muted-foreground">
                              Payout rail active
                            </div>
                          </div>
                        </div>

                        <div className="mt-4 grid grid-cols-1 gap-2 min-[400px]:grid-cols-3">
                          {[
                            { volume: "$1K", payout: "$5", accent: "border-border/45" },
                            { volume: "$10K", payout: "$50", accent: "border-gain/30 shadow-[0_16px_40px_-30px_hsl(var(--gain)/0.45)]" },
                            { volume: "$100K", payout: "$500", accent: "border-border/45" },
                          ].map((tier) => (
                            <div
                              key={tier.volume}
                              className={cn(
                                "rounded-2xl bg-background/60 px-3 py-3 text-center border",
                                tier.accent
                              )}
                            >
                              <div className="text-lg font-mono font-bold text-gain">
                                {tier.payout}
                              </div>
                              <div className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground mt-1">
                                from {tier.volume}
                              </div>
                              <div className="text-[11px] text-muted-foreground mt-2 leading-snug">
                                traded from your post
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>

                      <div className="grid grid-cols-1 gap-2 text-[11px] min-[390px]:grid-cols-3">
                        {[
                          "Secure email",
                          "Auto account creation",
                          "No wallet needed",
                        ].map((item) => (
                          <div
                            key={item}
                            className="rounded-2xl border border-border/45 bg-background/45 px-3 py-3 text-center text-muted-foreground"
                          >
                            {item}
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              </motion.div>
            </div>
          </div>
        </section>

        {/* ━━━━━━ SECTION 2: WHY EARLY MATTERS ━━━━━━ */}
        <DeferredViewportBlock
          disabled={!shouldDeferMarketing}
          fallback={
            <MarketingSectionPlaceholder
              eyebrow="Time Is Everything"
              title="Being first with good alpha changes the entire trade."
              className="border-t border-border/40 bg-card/30 backdrop-blur-sm"
            />
          }
        >
          <section className="border-t border-border/40 bg-card/30 backdrop-blur-sm">
            <div className="max-w-7xl mx-auto px-3 sm:px-6 py-10 sm:py-12 md:py-16">
              <div className="grid lg:grid-cols-2 gap-10 lg:gap-16 items-center">
                <motion.div
                  className="order-2 lg:order-1"
                  initial={optimizeMotion ? false : { opacity: 0, scale: 0.92 }}
                  whileInView={optimizeMotion ? undefined : { opacity: 1, scale: 1 }}
                  viewport={{ once: true, margin: "-80px" }}
                  transition={{ duration: optimizeMotion ? 0 : 0.45 }}
                >
                  <div className="rounded-2xl border border-border/50 bg-background/70 backdrop-blur-xl p-6 shadow-[0_20px_60px_-30px_hsl(var(--primary)/0.2)]">
                    <div className="text-center mb-2">
                      <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-primary/20 bg-primary/5 text-xs font-medium text-primary mb-3">
                        <SignalBurstIcon className="w-3 h-3" />
                        Live Trade Simulation
                      </div>
                      <h3 className="font-heading text-lg font-bold">
                        First Good Alpha Wins The Route
                      </h3>
                      <p className="text-xs text-muted-foreground mt-1">
                        Traders act on the post they trust first. The best call keeps the route and the creator payout.
                      </p>
                    </div>
                    <Suspense fallback={<VisualizationCardSkeleton />}>
                      <FeeOrbit />
                    </Suspense>
                  </div>
                </motion.div>

                <motion.div
                  className="order-1 lg:order-2 space-y-6"
                  initial={optimizeMotion ? false : { opacity: 0, y: 20 }}
                  whileInView={optimizeMotion ? undefined : { opacity: 1, y: 0 }}
                  viewport={{ once: true, margin: "-80px" }}
                  transition={{ duration: optimizeMotion ? 0 : 0.45, delay: optimizeMotion ? 0 : 0.08 }}
                >
                  <div>
                    <div className="inline-flex items-center gap-2 text-xs font-semibold text-gain uppercase tracking-widest mb-3">
                      <TimingWindowIcon className="w-3.5 h-3.5" />
                      Time Is Everything
                    </div>
                    <h2 className="font-heading text-3xl sm:text-4xl font-extrabold tracking-tight leading-tight">
                      Being First With Good Alpha,
                      <br />
                      <span className="text-gradient">Changes The Entire Trade.</span>
                    </h2>
                    <p className="mt-3 text-sm text-muted-foreground leading-relaxed">
                      Phew is not about posting early for the sake of noise. It is
                      about being early with conviction traders actually want to
                      follow. The first strong call captures the best attention,
                      the cleanest buy flow, and the strongest creator payouts.
                    </p>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2">
                    {timingPillars.map((pillar, index) => (
                      <motion.div
                        key={pillar.title}
                        className={cn("rounded-xl border p-4", pillar.accent)}
                        initial={optimizeMotion ? false : { opacity: 0, y: 14 }}
                        whileInView={optimizeMotion ? undefined : { opacity: 1, y: 0 }}
                        viewport={{ once: true, margin: "-60px" }}
                        transition={{ duration: optimizeMotion ? 0 : 0.35, delay: optimizeMotion ? 0 : index * 0.08 }}
                      >
                        <div className="mb-2 flex h-9 w-9 items-center justify-center rounded-lg border border-current/20 bg-background/55">
                          <pillar.icon className="h-4 w-4" />
                        </div>
                        <h3 className="text-sm font-semibold text-foreground">
                          {pillar.title}
                        </h3>
                        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                          {pillar.description}
                        </p>
                      </motion.div>
                    ))}
                  </div>

                  <div className="space-y-3">
                    {earlyCallerData.map((row, i) => (
                      <motion.div
                        key={row.label}
                        className={cn("rounded-xl border p-4", row.borderColor, row.bgColor)}
                        initial={optimizeMotion ? false : { opacity: 0, x: 20 }}
                        whileInView={optimizeMotion ? undefined : { opacity: 1, x: 0 }}
                        viewport={{ once: true, margin: "-60px" }}
                        transition={{ duration: optimizeMotion ? 0 : 0.35, delay: optimizeMotion ? 0 : i * 0.08 }}
                      >
                        <div className="flex items-center justify-between gap-3 mb-2.5">
                          <div className="flex items-center gap-2">
                            <span className={cn("text-xs font-bold", row.textColor)}>
                              {row.label}
                            </span>
                            <span className="text-[10px] px-2 py-0.5 rounded-full bg-background/60 border border-border/40 text-muted-foreground">
                              {row.tag}
                            </span>
                          </div>
                          <span className={cn("text-sm font-mono font-bold", row.textColor)}>
                            {row.trades} buys from post
                          </span>
                        </div>
                        <div className="h-2 rounded-full bg-background/60 overflow-hidden">
                          <motion.div
                            className={cn("h-full rounded-full", row.color)}
                            initial={optimizeMotion ? false : { width: 0 }}
                            whileInView={optimizeMotion ? undefined : { width: `${row.pct}%` }}
                            viewport={{ once: true, margin: "-60px" }}
                            transition={{
                              duration: optimizeMotion ? 0 : 0.7,
                              delay: optimizeMotion ? 0 : 0.18 + i * 0.14,
                              ease: "easeOut",
                            }}
                            style={optimizeMotion ? { width: `${row.pct}%` } : undefined}
                          />
                        </div>
                        <p className="mt-2 text-[11px] text-muted-foreground">
                          {row.desc}
                        </p>
                      </motion.div>
                    ))}
                  </div>

                  <div className="rounded-xl border border-gain/25 bg-gain/5 p-4 flex items-start gap-3">
                    <div className="w-8 h-8 rounded-lg bg-gain/15 border border-gain/25 flex items-center justify-center shrink-0 mt-0.5">
                      <FlowRouteIcon className="w-4 h-4 text-gain" />
                    </div>
                    <div>
                      <div className="text-sm font-semibold text-gain">
                        First good callers can capture up to 23x more routed flow.
                      </div>
                      <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                        The edge is not just speed. It is speed plus quality. Be
                        first with signal the market respects and the fee rail
                        starts compounding through your post while everyone else
                        is still reacting.
                      </p>
                    </div>
                  </div>
                </motion.div>
              </div>
            </div>
          </section>
        </DeferredViewportBlock>

        {/* ━━━━━━ SECTION 3: REPUTATION MARKET ━━━━━━ */}
        <DeferredViewportBlock
          disabled={!shouldDeferMarketing}
          fallback={
            <MarketingSectionPlaceholder
              eyebrow="Reputation Market"
              title="Good calls build a public edge."
            />
          }
        >
          <section className="max-w-7xl mx-auto px-3 sm:px-6 py-10 sm:py-12 md:py-16">
            <div className="grid items-center gap-10 lg:grid-cols-[1.08fr_0.92fr] lg:gap-14">
              <motion.div
                initial={optimizeMotion ? false : { opacity: 0, y: 20 }}
                whileInView={optimizeMotion ? undefined : { opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "-80px" }}
                transition={{ duration: optimizeMotion ? 0 : 0.45 }}
              >
                <Suspense fallback={<ReputationEngineSkeleton />}>
                  <ReputationEngine />
                </Suspense>
              </motion.div>

              <motion.div
                className="space-y-5"
                initial={optimizeMotion ? false : { opacity: 0, y: 20 }}
                whileInView={optimizeMotion ? undefined : { opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "-80px" }}
                transition={{ duration: optimizeMotion ? 0 : 0.45, delay: optimizeMotion ? 0 : 0.08 }}
              >
                <div>
                  <div className="inline-flex items-center gap-2 text-xs font-semibold text-primary uppercase tracking-widest mb-3">
                    <SignalBurstIcon className="w-3.5 h-3.5" />
                    Reputation Market
                  </div>
                  <h2 className="font-heading text-3xl sm:text-4xl font-extrabold tracking-tight">
                    Good Calls Build A Public Edge.
                  </h2>
                  <p className="mt-3 text-sm text-muted-foreground leading-relaxed">
                    Every outcome reprices your profile. Good calls raise level,
                    trust, and future attention. Bad calls cool the room off. The
                    entire platform is built to separate quality signal from
                    random posting.
                  </p>
                </div>

                <div className="grid gap-3">
                  {reputationPillars.map((pillar, index) => (
                    <motion.div
                      key={pillar.title}
                      className={cn("rounded-xl border p-4", pillar.accent)}
                      initial={optimizeMotion ? false : { opacity: 0, x: 16 }}
                      whileInView={optimizeMotion ? undefined : { opacity: 1, x: 0 }}
                      viewport={{ once: true, margin: "-60px" }}
                      transition={{ duration: optimizeMotion ? 0 : 0.35, delay: optimizeMotion ? 0 : index * 0.07 }}
                    >
                      <div className="flex items-start gap-3">
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-current/20 bg-background/55">
                          <pillar.icon className="h-4 w-4" />
                        </div>
                        <div>
                          <h3 className="text-sm font-semibold text-foreground">{pillar.title}</h3>
                          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                            {pillar.description}
                          </p>
                        </div>
                      </div>
                    </motion.div>
                  ))}
                </div>

                <div className="rounded-2xl border border-border/50 bg-card/50 p-5">
                  <div className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
                    What traders are reading
                  </div>
                  <p className="mt-3 text-sm leading-relaxed text-foreground">
                    When someone opens your post, they are not just reading a
                    ticker. They are reading the quality of your last decisions.
                    That is why better calls compound harder than better
                    branding.
                  </p>
                </div>
              </motion.div>
            </div>
          </section>
        </DeferredViewportBlock>

        {/* ━━━━━━ SECTION 4: LEVEL SYSTEM ━━━━━━ */}
        <DeferredViewportBlock
          disabled={!shouldDeferMarketing}
          fallback={
            <MarketingSectionPlaceholder
              eyebrow="Level System"
              title="Know exactly what moves you up or down."
            />
          }
        >
          <section className="max-w-7xl mx-auto px-3 sm:px-6 py-10 sm:py-12 md:py-16">
            <motion.div
              initial={optimizeMotion ? false : { opacity: 0, y: 20 }}
              whileInView={optimizeMotion ? undefined : { opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-80px" }}
              transition={{ duration: optimizeMotion ? 0 : 0.45 }}
            >
              <div className="text-center mb-8">
                <div className="inline-flex items-center gap-2 text-xs font-semibold text-primary uppercase tracking-widest mb-3">
                  <LevelTierIcon className="w-3.5 h-3.5" />
                  Level System
                </div>
                <h2 className="font-heading text-3xl sm:text-4xl font-extrabold tracking-tight">
                  Know Exactly What Moves You Up Or Down.
                </h2>
                <p className="mt-2 text-sm text-muted-foreground max-w-lg mx-auto leading-relaxed">
                  Levels are the public scorecard behind every profile. They move
                  with outcomes, not followers, and they tell the market who has
                  actually earned attention.
                </p>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-8">
                {[
                  {
                    label: "Liquidation",
                    value: `LVL ${MIN_LEVEL}`,
                    desc: "Posts disabled",
                    color: "border-red-500/25 bg-red-500/5 text-red-400",
                  },
                  {
                    label: "Neutral Entry",
                    value: `LVL ${STARTING_LEVEL}`,
                    desc: "Everyone starts here",
                    color: "border-border/50",
                  },
                  {
                    label: "Veteran",
                    value: `LVL +${VETERAN_THRESHOLD}`,
                    desc: "Protection unlocked",
                    color: "border-primary/30 bg-primary/5 text-primary",
                  },
                  {
                    label: "Elite Ceiling",
                    value: `LVL +${MAX_LEVEL}`,
                    desc: "Top-tier trust",
                    color: "border-gain/30 bg-gain/5 text-gain",
                  },
                ].map((tier) => (
                  <div
                    key={tier.label}
                    className={cn(
                      "rounded-xl border p-4 backdrop-blur-sm bg-card/50",
                      tier.color
                    )}
                  >
                    <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1">
                      {tier.label}
                    </div>
                    <div
                      className={cn(
                        "text-lg font-mono font-bold",
                        tier.color.includes("text-") ? "" : "text-foreground"
                      )}
                    >
                      {tier.value}
                    </div>
                    <div className="text-[11px] text-muted-foreground mt-0.5">
                      {tier.desc}
                    </div>
                  </div>
                ))}
              </div>

              <div className="grid lg:grid-cols-[1.3fr_0.7fr] gap-5">
                <div className="rounded-2xl border border-primary/15 bg-card/60 p-5 shadow-[0_10px_40px_-24px_hsl(var(--primary)/0.3)]">
                  <div className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground mb-4">
                    Key Level States
                  </div>
                  <div className="grid sm:grid-cols-2 gap-3">
                    {levelBarSnapshots.map((snap) => (
                      <div
                        key={snap.title}
                        className="rounded-xl border border-border/50 bg-background/40 p-3.5"
                      >
                        <div className="flex items-center justify-between gap-2 mb-2">
                          <span className="text-xs font-semibold">{snap.title}</span>
                          <span className="text-[10px] px-2 py-0.5 rounded-full border border-border/50 bg-background/50 text-muted-foreground font-mono">
                            LVL {snap.level > 0 ? `+${snap.level}` : snap.level}
                          </span>
                        </div>
                        <LevelBar level={snap.level} size="sm" showLabel={false} />
                        <p className="mt-2 text-[11px] text-muted-foreground leading-relaxed">
                          {snap.note}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="space-y-4">
                  <div className="rounded-2xl border border-border/50 bg-card/50 p-5">
                    <div className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground mb-3">
                      Level Rules
                    </div>
                    <ul className="space-y-2.5">
                      {levelRules.map((rule) => (
                        <li key={rule} className="flex items-start gap-2.5">
                          <div className="mt-[5px] w-1.5 h-1.5 rounded-full bg-primary/70 shrink-0" />
                          <p className="text-xs text-muted-foreground leading-relaxed">
                            {rule}
                          </p>
                        </li>
                      ))}
                    </ul>
                  </div>
                  <div className="rounded-xl border border-red-500/20 bg-red-500/5 p-4">
                    <p className="text-xs text-red-400 leading-relaxed">
                      Liquidation triggers at{" "}
                      <span className="font-semibold">LVL {LIQUIDATION_LEVEL}</span>.
                      Posting is disabled until your reputation recovers.
                    </p>
                  </div>
                </div>
              </div>
            </motion.div>
          </section>
        </DeferredViewportBlock>

        {/* ━━━━━━ SECTION 5: WEEKLY BEST ━━━━━━ */}
        <DeferredViewportBlock
          disabled={!shouldDeferMarketing}
          fallback={
            <MarketingSectionPlaceholder
              eyebrow="Proof of Alpha"
              title="This week's best calls."
            />
          }
        >
          <WeeklyBestSection optimizeMotion={optimizeMotion} />
        </DeferredViewportBlock>

        {/* ━━━━━━ SECTION 6: BOTTOM CTA ━━━━━━ */}
        <DeferredViewportBlock
          disabled={!shouldDeferMarketing}
          fallback={
            <MarketingSectionPlaceholder
              eyebrow="Creator payouts on routed buys"
              title="Your next good call could pay you for a long time."
              className="border-t border-border/40 bg-gradient-to-b from-card/30 to-transparent"
            />
          }
        >
          <section className="border-t border-border/40 bg-gradient-to-b from-card/30 to-transparent">
            <div className="max-w-2xl mx-auto px-3 sm:px-6 py-12 sm:py-14 text-center">
              <motion.div
                initial={optimizeMotion ? false : { opacity: 0, y: 20 }}
                whileInView={optimizeMotion ? undefined : { opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "-60px" }}
                transition={{ duration: optimizeMotion ? 0 : 0.45 }}
                className="space-y-4"
              >
                <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full border border-gain/25 bg-gain/5 text-xs font-medium text-gain">
                  <FlowRouteIcon className="w-3.5 h-3.5" />
                  0.5% on routed buys. Reputation earned in public.
                </div>
                <h2 className="font-heading text-3xl sm:text-4xl font-extrabold tracking-tight">
                  Your Next Good Call Could
                  <br />
                  <span className="bg-gradient-to-r from-[#c7f5a6] via-[#a9ef9d] to-[#98e9dc] bg-clip-text text-transparent">
                    Pay You For A Long Time.
                  </span>
                </h2>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  Sign up free. Post the right call early. Every trader who buys
                  through your post reinforces your signal and credits the route you created.
                </p>
                <div className="pt-2">
                  {privyAvailable ? <PrivyLoginButton /> : <FallbackLoginButton />}
                </div>
              </motion.div>
            </div>
          </section>
        </DeferredViewportBlock>
      </main>

      {/* ── Footer ── */}
      <footer className="relative z-10 border-t border-border/40 py-7">
        <div className="max-w-7xl mx-auto px-3 sm:px-6 flex flex-col sm:flex-row items-center justify-between gap-4">
          <BrandLogo size="sm" showTagline={!isMobile} />
          <div className="flex items-center gap-5 text-xs text-muted-foreground">
            <Link to="/terms" className="hover:text-foreground transition-colors">
              Terms
            </Link>
            <Link to="/privacy" className="hover:text-foreground transition-colors">
              Privacy
            </Link>
            <Link to="/docs" className="hover:text-foreground transition-colors">
              Docs
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
