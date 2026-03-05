import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { useAuth } from "@/lib/auth-client";
import { usePrivyLogin } from "@/hooks/usePrivyLogin";
import { usePrivyAvailable } from "@/components/PrivyWalletProvider";
import { ThemeToggle } from "@/components/ThemeToggle";
import { BrandLogo } from "@/components/BrandLogo";
import { LevelBar } from "@/components/feed/LevelBar";
import { Button } from "@/components/ui/button";
import {
  ArrowRight,
  Clock,
  Loader2,
  Mail,
  Shield,
  Sparkles,
  Target,
  TrendingUp,
  Users,
  Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  LIQUIDATION_LEVEL,
  MAX_LEVEL,
  MIN_LEVEL,
  STARTING_LEVEL,
} from "@/types";
import { FeeOrbit } from "@/components/login/FeeOrbit";
import { AccuracyScoreCard } from "@/components/AccuracyScoreCard";

// ─── Data ─────────────────────────────────────────────────────────────────────

const earlyCallerData = [
  {
    label: "Hour 0",
    tag: "First Caller",
    trades: 320,
    pct: 100,
    color: "bg-gain",
    textColor: "text-gain",
    borderColor: "border-gain/30",
    bgColor: "bg-gain/5",
    desc: "Most buys happen in the first hour — your post captures them all",
  },
  {
    label: "Hour 2",
    tag: "Late Caller",
    trades: 72,
    pct: 23,
    color: "bg-primary",
    textColor: "text-primary",
    borderColor: "border-primary/30",
    bgColor: "bg-primary/5",
    desc: "Early posts already absorbed the bulk of buy volume",
  },
  {
    label: "Hour 6",
    tag: "Very Late",
    trades: 14,
    pct: 4,
    color: "bg-muted-foreground",
    textColor: "text-muted-foreground",
    borderColor: "border-border/40",
    bgColor: "bg-background/40",
    desc: "Minimal buys left — minimal fees earned",
  },
];

const levelBarSnapshots = [
  {
    level: -4,
    title: "Danger Zone",
    note: "Close to liquidation. Recovery calls matter most here.",
  },
  {
    level: STARTING_LEVEL,
    title: "Neutral",
    note: "Everyone begins here and builds from real outcomes.",
  },
  {
    level: 4,
    title: "Veteran",
    note: "Consistency moves you into stronger reputation tiers.",
  },
  {
    level: 5,
    title: "High Conviction",
    note: "Strong hit rate and discipline push you into upper-tier visibility.",
  },
  {
    level: 9,
    title: "Elite",
    note: "Top performers with the strongest public track records.",
  },
];

const levelRules = [
  "1H win: +1 level immediately.",
  "Soft loss (<30%) gets a 6H recovery chance before penalty.",
  "Veteran protection starts at LVL +5, making drawdowns less punishing.",
  "Severe loss (≥30%) can level you down.",
];

const features = [
  {
    icon: Target,
    title: "Post Your Call",
    description:
      "Log your alpha with a timestamp. Every call becomes a public, immutable record — no edits, no hindsight.",
  },
  {
    icon: TrendingUp,
    title: "Get Paid Every Time They Buy",
    description:
      "Every time a trader buys directly from your post, you earn 0.5% of the trade. Automatically. Forever.",
  },
  {
    icon: Users,
    title: "Build a Verified Track Record",
    description:
      "Accuracy scores, win rates, and level progression based on real outcomes — not follower counts.",
  },
];

const stats = [
  { value: "10K+", label: "Calls Tracked" },
  { value: "68%", label: "Avg Accuracy" },
  { value: "2.4K", label: "Active Traders" },
];

// ─── Auth buttons ──────────────────────────────────────────────────────────────

function PrivyLoginButton() {
  const navigate = useNavigate();
  const { login, ready: privyReady, isSyncing, syncError } = usePrivyLogin({
    onSuccess: () => navigate("/", { replace: true }),
  });
  const isLoading = isSyncing;

  return (
    <div className="space-y-2">
      <Button
        type="button"
        className="w-full h-14 rounded-2xl border border-white/20 bg-[linear-gradient(135deg,#c7f5a6_0%,#98e9dc_100%)] text-slate-950 font-semibold gap-3 shadow-[0_24px_60px_-30px_rgba(152,233,220,0.85)] transition-all duration-300 text-sm hover:-translate-y-0.5 hover:brightness-105 hover:shadow-[0_28px_70px_-28px_rgba(152,233,220,0.95)]"
        onClick={login}
        disabled={isLoading}
      >
        {isLoading ? (
          <>
            <Loader2 className="w-4 h-4 animate-spin" />
            Signing in…
          </>
        ) : (
          <>
            <Mail className="w-4 h-4" />
            {privyReady ? "Sign in with Email" : "Initialize Sign In"}
            <ArrowRight className="w-4 h-4" />
          </>
        )}
      </Button>
      {syncError ? (
        <p className="text-[11px] text-red-400 leading-relaxed">{syncError}</p>
      ) : null}
    </div>
  );
}

function FallbackLoginButton() {
  return (
    <Button
      type="button"
      className="w-full h-14 rounded-2xl font-semibold gap-3 opacity-50"
      disabled
    >
      <Loader2 className="w-4 h-4 animate-spin" />
      Initializing…
    </Button>
  );
}

// ─── Page ──────────────────────────────────────────────────────────────────────

export default function Login() {
  const navigate = useNavigate();
  const { isAuthenticated, isReady } = useAuth();
  const privyAvailable = usePrivyAvailable();
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (isReady && isAuthenticated) navigate("/", { replace: true });
  }, [isReady, isAuthenticated, navigate]);

  useEffect(() => {
    const t = setTimeout(() => setLoaded(true), 40);
    return () => clearTimeout(t);
  }, []);

  return (
    <div className="min-h-screen bg-background relative overflow-x-hidden">
      {/* ── Background atmosphere ── */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden z-0">
        {/* Top-right glow */}
        <div
          className="absolute -top-[15%] right-[-5%] w-[700px] h-[700px] rounded-full blur-[100px] motion-safe:animate-glow-pulse"
          style={{
            background:
              "radial-gradient(ellipse, hsl(var(--primary)/0.13) 0%, transparent 65%)",
          }}
        />
        {/* Bottom-left glow */}
        <div
          className="absolute bottom-[-10%] left-[-8%] w-[600px] h-[600px] rounded-full blur-[90px] motion-safe:animate-glow-pulse"
          style={{
            background:
              "radial-gradient(ellipse, hsl(var(--accent)/0.1) 0%, transparent 65%)",
            animationDelay: "1.5s",
          }}
        />
        {/* Mid gain glow */}
        <div
          className="absolute top-[50%] left-[50%] -translate-x-1/2 -translate-y-1/2 w-[400px] h-[400px] rounded-full blur-[110px]"
          style={{
            background:
              "radial-gradient(ellipse, hsl(var(--gain)/0.04) 0%, transparent 70%)",
          }}
        />
        {/* Grid */}
        <div
          className="absolute inset-0 opacity-[0.025]"
          style={{
            backgroundImage: `linear-gradient(hsl(var(--foreground)) 1px, transparent 1px),
              linear-gradient(90deg, hsl(var(--foreground)) 1px, transparent 1px)`,
            backgroundSize: "64px 64px",
          }}
        />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,transparent_0%,hsl(var(--background))_75%)]" />
      </div>

      {/* ── Header ── */}
      <motion.header
        className="fixed top-0 left-0 right-0 z-50 border-b border-border/40 backdrop-blur-xl bg-background/70"
        initial={{ opacity: 0, y: -12 }}
        animate={loaded ? { opacity: 1, y: 0 } : {}}
        transition={{ duration: 0.4, ease: "easeOut" }}
      >
        <div className="max-w-7xl mx-auto px-5 sm:px-6 py-3.5 flex items-center justify-between">
          <BrandLogo size="sm" showTagline />
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
        <section className="max-w-7xl mx-auto px-5 sm:px-6 pt-10 pb-8 md:pt-14 md:pb-12">
          <div className="grid xl:grid-cols-[1fr_420px] gap-8 xl:gap-12 items-start">

            {/* Left — headline + features */}
            <motion.div
              className="order-2 xl:order-1 space-y-6"
              initial={{ opacity: 0, y: 20 }}
              animate={loaded ? { opacity: 1, y: 0 } : {}}
              transition={{ duration: 0.5, delay: 0.1 }}
            >
              {/* Badge */}
              <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full border border-primary/20 bg-primary/5 text-xs font-medium text-primary">
                <Sparkles className="w-3.5 h-3.5" />
                Your call. Their buy. Your cut.
              </div>

              {/* Headline */}
              <div>
                <h1 className="font-heading text-4xl sm:text-5xl lg:text-6xl font-extrabold tracking-tight leading-[1.08]">
                  Post a Call.
                  <br />
                  <span
                    className="bg-gradient-to-r from-[#c7f5a6] via-[#a9ef9d] to-[#98e9dc] bg-clip-text text-transparent"
                  >
                    Get Paid on Every Buy.
                  </span>
                </h1>
                <p className="mt-4 text-base sm:text-lg text-muted-foreground leading-relaxed max-w-xl">
                  When traders buy directly from your post, you earn{" "}
                  <span className="text-foreground font-semibold">
                    0.5% of every buy
                  </span>
                  . No followers required. Just post your alpha and earn every
                  time someone acts on it.
                </p>
              </div>

              {/* Stats row */}
              <div className="grid grid-cols-3 gap-3 max-w-md">
                {stats.map((stat, i) => (
                  <motion.div
                    key={stat.label}
                    className="rounded-xl border border-border/50 bg-card/60 p-3.5 backdrop-blur-sm"
                    initial={{ opacity: 0, y: 12 }}
                    animate={loaded ? { opacity: 1, y: 0 } : {}}
                    transition={{ duration: 0.4, delay: 0.2 + i * 0.06 }}
                  >
                    <div className="text-xl sm:text-2xl font-mono font-bold tracking-tight">
                      {stat.value}
                    </div>
                    <div className="text-[11px] text-muted-foreground mt-0.5">
                      {stat.label}
                    </div>
                  </motion.div>
                ))}
              </div>

              {/* AccuracyScoreCard */}
              <motion.div
                className="max-w-md"
                initial={{ opacity: 0, y: 12 }}
                animate={loaded ? { opacity: 1, y: 0 } : {}}
                transition={{ duration: 0.4, delay: 0.32 }}
              >
                <AccuracyScoreCard />
              </motion.div>

              {/* Features */}
              <div className="grid gap-2.5 max-w-md">
                {features.map((f, i) => (
                  <motion.div
                    key={f.title}
                    className="flex items-start gap-3 rounded-xl border border-border/50 bg-card/50 p-4 hover:border-primary/30 transition-colors duration-200"
                    initial={{ opacity: 0, x: -12 }}
                    animate={loaded ? { opacity: 1, x: 0 } : {}}
                    transition={{ duration: 0.4, delay: 0.38 + i * 0.07 }}
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
            <div className="order-1 xl:order-2 w-full max-w-[420px] mx-auto xl:mx-0 xl:sticky xl:top-[80px]">
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={loaded ? { opacity: 1, y: 0 } : {}}
                transition={{ duration: 0.5, delay: 0.15 }}
              >
                <div className="relative rounded-[30px] p-[1px] bg-[linear-gradient(160deg,hsl(var(--primary)/0.55),hsl(var(--accent)/0.28),transparent_88%)] shadow-[0_32px_120px_-40px_hsl(var(--primary)/0.7)]">
                  <div className="absolute inset-[12%] rounded-full bg-primary/12 blur-3xl pointer-events-none" />
                  <div className="relative rounded-[29px] overflow-hidden border border-white/8 bg-background/92 backdrop-blur-2xl">
                    <div className="px-6 pt-6 pb-5 border-b border-border/50 bg-[linear-gradient(180deg,hsl(var(--primary)/0.14),transparent_75%)]">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-start gap-3">
                          <div className="w-11 h-11 rounded-2xl bg-primary/12 border border-primary/25 flex items-center justify-center shrink-0 shadow-[0_0_0_1px_hsl(var(--primary)/0.08)]">
                            <Zap className="w-4.5 h-4.5 text-primary" />
                          </div>
                          <div>
                            <div className="text-[10px] uppercase tracking-[0.28em] text-primary/75 mb-2">
                              Creator Fee Rail
                            </div>
                            <h2 className="text-xl font-semibold tracking-tight">
                              Start Earning Today
                            </h2>
                            <p className="text-xs text-muted-foreground leading-relaxed mt-1.5 max-w-[250px]">
                              Route every buy through your post and turn public conviction into instant payout momentum.
                            </p>
                          </div>
                        </div>
                        <div className="shrink-0 rounded-full border border-gain/20 bg-gain/10 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-gain">
                          0.5% Live
                        </div>
                      </div>

                      <div className="mt-5 grid grid-cols-3 gap-2">
                        {[
                          { label: "Account", value: "Instant" },
                          { label: "Payouts", value: "On-chain" },
                          { label: "Setup", value: "Email first" },
                        ].map((item) => (
                          <div
                            key={item.label}
                            className="rounded-2xl border border-border/45 bg-background/45 px-3 py-3"
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

                    <div className="p-5 space-y-4">
                      <div className="rounded-[24px] border border-primary/18 bg-[radial-gradient(circle_at_top,hsl(var(--primary)/0.14),transparent_58%),linear-gradient(180deg,hsl(var(--card)/0.92),hsl(var(--background)/0.82))] p-4 shadow-[0_20px_60px_-34px_hsl(var(--primary)/0.55)]">
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
                            <Shield className="w-4 h-4 text-primary" />
                          </div>
                        </div>
                        {privyAvailable ? <PrivyLoginButton /> : <FallbackLoginButton />}
                        <div className="mt-3 flex items-start gap-2 rounded-2xl border border-border/45 bg-background/55 px-3 py-3">
                          <Shield className="w-3.5 h-3.5 mt-0.5 text-primary shrink-0" />
                          <p className="text-[11px] text-muted-foreground leading-relaxed">
                            Secure email verification. Your account opens instantly and you can connect payout rails later.
                          </p>
                        </div>
                      </div>

                      <div className="rounded-[24px] border border-gain/20 bg-[linear-gradient(180deg,hsl(var(--gain)/0.11),transparent_18%),linear-gradient(180deg,hsl(var(--background)/0.78),hsl(var(--background)/0.96))] p-4">
                        <div className="flex items-start justify-between gap-4">
                          <div>
                            <div className="text-[10px] uppercase tracking-[0.24em] text-gain/80">
                              Fee Capture Model
                            </div>
                            <div className="mt-2 text-4xl font-mono font-bold text-gain">
                              0.5%
                            </div>
                            <p className="mt-2 text-[11px] text-muted-foreground leading-relaxed max-w-[190px]">
                              Every buy executed from your post routes a slice of flow back to you automatically.
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

                        <div className="mt-4 grid grid-cols-3 gap-2">
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

                      <div className="grid grid-cols-3 gap-2 text-[11px]">
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
        <section className="border-t border-border/40 bg-card/30 backdrop-blur-sm">
          <div className="max-w-7xl mx-auto px-5 sm:px-6 py-12 md:py-16">
            <div className="grid lg:grid-cols-2 gap-10 lg:gap-16 items-center">

              {/* Fee orbit visualizer */}
              <motion.div
                className="order-2 lg:order-1"
                initial={{ opacity: 0, scale: 0.92 }}
                whileInView={{ opacity: 1, scale: 1 }}
                viewport={{ once: true, margin: "-80px" }}
                transition={{ duration: 0.5 }}
              >
                <div className="rounded-2xl border border-border/50 bg-background/70 backdrop-blur-xl p-6 shadow-[0_20px_60px_-30px_hsl(var(--primary)/0.2)]">
                  <div className="text-center mb-2">
                    <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-primary/20 bg-primary/5 text-xs font-medium text-primary mb-3">
                      <Sparkles className="w-3 h-3" />
                      Live Trade Simulation
                    </div>
                    <h3 className="font-heading text-lg font-bold">
                      Trades From Your Post
                    </h3>
                    <p className="text-xs text-muted-foreground mt-1">
                      Each trader who buys from your post sends 0.5% to you
                    </p>
                  </div>
                  <FeeOrbit />
                </div>
              </motion.div>

              {/* Explanation + early caller bars */}
              <motion.div
                className="order-1 lg:order-2 space-y-6"
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "-80px" }}
                transition={{ duration: 0.5, delay: 0.1 }}
              >
                <div>
                  <div className="inline-flex items-center gap-2 text-xs font-semibold text-gain uppercase tracking-widest mb-3">
                    <Clock className="w-3.5 h-3.5" />
                    Timing Is Everything
                  </div>
                  <h2 className="font-heading text-3xl sm:text-4xl font-extrabold tracking-tight leading-tight">
                    The Earlier You Post,
                    <br />
                    <span className="text-gradient">The More You Earn.</span>
                  </h2>
                  <p className="mt-3 text-sm text-muted-foreground leading-relaxed">
                    Buy volume peaks in the first hour after a call drops. Post
                    first and your post absorbs the lion's share of buys — each
                    one paying you 0.5%. Late callers fight over what's left.
                  </p>
                </div>

                {/* Early caller comparison bars */}
                <div className="space-y-3">
                  {earlyCallerData.map((row, i) => (
                    <motion.div
                      key={row.label}
                      className={cn(
                        "rounded-xl border p-4",
                        row.borderColor,
                        row.bgColor
                      )}
                      initial={{ opacity: 0, x: 20 }}
                      whileInView={{ opacity: 1, x: 0 }}
                      viewport={{ once: true, margin: "-60px" }}
                      transition={{ duration: 0.4, delay: i * 0.1 }}
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
                      {/* Bar */}
                      <div className="h-2 rounded-full bg-background/60 overflow-hidden">
                        <motion.div
                          className={cn("h-full rounded-full", row.color)}
                          initial={{ width: 0 }}
                          whileInView={{ width: `${row.pct}%` }}
                          viewport={{ once: true, margin: "-60px" }}
                          transition={{
                            duration: 0.8,
                            delay: 0.2 + i * 0.15,
                            ease: "easeOut",
                          }}
                        />
                      </div>
                      <p className="mt-2 text-[11px] text-muted-foreground">
                        {row.desc}
                      </p>
                    </motion.div>
                  ))}
                </div>

                {/* Summary callout */}
                <div className="rounded-xl border border-gain/25 bg-gain/5 p-4 flex items-start gap-3">
                  <div className="w-8 h-8 rounded-lg bg-gain/15 border border-gain/25 flex items-center justify-center shrink-0 mt-0.5">
                    <TrendingUp className="w-4 h-4 text-gain" />
                  </div>
                  <div>
                    <div className="text-sm font-semibold text-gain">
                      First callers earn up to 23× more in fees
                    </div>
                    <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                      Buy volume spikes the moment a call drops and decays fast.
                      Post first and your post captures the wave. Every buy
                      through your post is 0.5% straight to your wallet.
                    </p>
                  </div>
                </div>
              </motion.div>
            </div>
          </div>
        </section>

        {/* ━━━━━━ SECTION 3: LEVEL SYSTEM ━━━━━━ */}
        <section className="max-w-7xl mx-auto px-5 sm:px-6 py-12 md:py-16">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-80px" }}
            transition={{ duration: 0.5 }}
          >
            <div className="text-center mb-8">
              <div className="inline-flex items-center gap-2 text-xs font-semibold text-primary uppercase tracking-widest mb-3">
                <Sparkles className="w-3.5 h-3.5" />
                Reputation System
              </div>
              <h2 className="font-heading text-3xl sm:text-4xl font-extrabold tracking-tight">
                Levels Earned, Not Bought
              </h2>
              <p className="mt-2 text-sm text-muted-foreground max-w-lg mx-auto leading-relaxed">
                Your level is a live reflection of your track record. Win
                consistently to rise. Lose badly and fall. No pay-to-win.
              </p>
            </div>

            {/* Level tier indicators */}
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
                  desc: "Where everyone starts",
                  color: "border-border/50",
                },
                {
                  label: "Veteran",
                  value: "LVL +5",
                  desc: "Drawdown protection",
                  color: "border-primary/30 bg-primary/5 text-primary",
                },
                {
                  label: "Elite Ceiling",
                  value: `LVL +${MAX_LEVEL}`,
                  desc: "Top performers only",
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

            {/* Level snapshots + rules */}
            <div className="grid lg:grid-cols-[1.3fr_0.7fr] gap-5">
              {/* Snapshot cards */}
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

              {/* Rules */}
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

        {/* ━━━━━━ SECTION 4: BOTTOM CTA ━━━━━━ */}
        <section className="border-t border-border/40 bg-gradient-to-b from-card/30 to-transparent">
          <div className="max-w-2xl mx-auto px-5 sm:px-6 py-14 text-center">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-60px" }}
              transition={{ duration: 0.5 }}
              className="space-y-4"
            >
              <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full border border-gain/25 bg-gain/5 text-xs font-medium text-gain">
                <Sparkles className="w-3.5 h-3.5" />
                0.5% per buy — live on Solana
              </div>
              <h2 className="font-heading text-3xl sm:text-4xl font-extrabold tracking-tight">
                Your Next Call Could
                <br />
                <span className="bg-gradient-to-r from-[#c7f5a6] via-[#a9ef9d] to-[#98e9dc] bg-clip-text text-transparent">
                  Pay You Forever.
                </span>
              </h2>
              <p className="text-sm text-muted-foreground leading-relaxed">
                Sign up free. Post your first call. Every trader who buys from
                your post sends 0.5% straight to your wallet — forever.
              </p>
              <div className="pt-2">
                {privyAvailable ? <PrivyLoginButton /> : <FallbackLoginButton />}
              </div>
            </motion.div>
          </div>
        </section>
      </main>

      {/* ── Footer ── */}
      <footer className="relative z-10 border-t border-border/40 py-7">
        <div className="max-w-7xl mx-auto px-5 sm:px-6 flex flex-col sm:flex-row items-center justify-between gap-4">
          <BrandLogo size="sm" showTagline />
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
