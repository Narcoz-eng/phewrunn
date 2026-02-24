import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "@/lib/auth-client";
import { usePrivyLogin } from "@/hooks/usePrivyLogin";
import { usePrivyAvailable } from "@/components/PrivyWalletProvider";
import { ThemeToggle } from "@/components/ThemeToggle";
import { LevelBar } from "@/components/feed/LevelBar";
import { Button } from "@/components/ui/button";
import {
  ArrowRight,
  Loader2,
  Mail,
  Shield,
  Sparkles,
  Target,
  TrendingUp,
  Users,
  Zap,
} from "lucide-react";
import { AccuracyScoreCard } from "@/components/AccuracyScoreCard";
import { cn } from "@/lib/utils";
import { LIQUIDATION_LEVEL, MAX_LEVEL, MIN_LEVEL, STARTING_LEVEL } from "@/types";

const features = [
  {
    icon: Target,
    title: "Track Alpha Calls",
    description: "Log predictions with timestamps and build a public, immutable record.",
  },
  {
    icon: TrendingUp,
    title: "Measure Real Performance",
    description: "Show accuracy, ROI signals, and consistency with transparent scoring.",
  },
  {
    icon: Users,
    title: "Build Reputation",
    description: "Followers can evaluate proof, not hype. Signal rises, noise falls.",
  },
];

const stats = [
  { value: "10K+", label: "Calls Tracked" },
  { value: "68%", label: "Avg Accuracy" },
  { value: "2.4K", label: "Active Traders" },
];

const levelBarSnapshots = [
  {
    level: -4,
    title: "Danger Zone",
    note: "You are close to liquidation. Recovery calls matter the most here.",
  },
  {
    level: STARTING_LEVEL,
    title: "Neutral",
    note: "Everyone begins here and builds reputation from real outcomes.",
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
    note: "Top performers sit near the cap with the strongest public track records.",
  },
];

const levelRules = [
  "1H win: +1 level immediately.",
  "Soft loss (<30%) gets a 6H recovery chance before penalty.",
  "Veteran protection starts at LVL +5, making drawdowns less punishing.",
  "Severe loss (>=30%) can level you down.",
];

// Inner component that uses Privy hooks — only rendered when Privy is available
function PrivyLoginButton() {
  const { login, ready: privyReady, isSyncing } = usePrivyLogin();

  const isLoading = !privyReady || isSyncing;

  return (
    <Button
      type="button"
      className="w-full h-12 font-semibold gap-3 shadow-glow hover:shadow-glow-lg transition-all duration-300"
      onClick={login}
      disabled={isLoading}
    >
      {isLoading ? (
        <>
          <Loader2 className="w-4 h-4 animate-spin" />
          {isSyncing ? "Signing in..." : "Loading..."}
        </>
      ) : (
        <>
          <Mail className="w-4 h-4" />
          Sign in with Email
          <ArrowRight className="w-4 h-4" />
        </>
      )}
    </Button>
  );
}

// Fallback button when Privy is not available
function FallbackLoginButton() {
  return (
    <Button
      type="button"
      className="w-full h-12 font-semibold gap-3 opacity-50"
      disabled
    >
      <Loader2 className="w-4 h-4 animate-spin" />
      Initializing...
    </Button>
  );
}

export default function Login() {
  const navigate = useNavigate();
  const { isAuthenticated, isReady } = useAuth();
  const privyAvailable = usePrivyAvailable();
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    if (isReady && isAuthenticated) {
      navigate("/", { replace: true });
    }
  }, [isReady, isAuthenticated, navigate]);

  useEffect(() => {
    const timer = setTimeout(() => setIsLoaded(true), 50);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div className="min-h-screen bg-background relative overflow-hidden">
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <div
          className="absolute top-[-10%] left-[55%] -translate-x-1/2 w-[900px] h-[700px] rounded-full blur-3xl motion-safe:animate-glow-pulse"
          style={{ background: "radial-gradient(ellipse at center, hsl(var(--primary) / 0.15), transparent 70%)" }}
        />
        <div
          className="absolute bottom-[-10%] left-[10%] w-[700px] h-[700px] rounded-full blur-3xl motion-safe:animate-glow-pulse"
          style={{ background: "radial-gradient(ellipse at center, hsl(var(--accent) / 0.1), transparent 70%)", animationDelay: "1.5s" }}
        />
        <div
          className="absolute inset-0 opacity-[0.02]"
          style={{
            backgroundImage: `linear-gradient(hsl(var(--foreground)) 1px, transparent 1px), linear-gradient(90deg, hsl(var(--foreground)) 1px, transparent 1px)`,
            backgroundSize: "60px 60px"
          }}
        />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,transparent_0%,hsl(var(--background))_70%)]" />
      </div>

      <header className={cn("fixed top-0 left-0 right-0 z-50 transition-all duration-500", isLoaded ? "opacity-100 translate-y-0" : "opacity-0 -translate-y-4")}>
        <div className="max-w-7xl mx-auto px-5 sm:px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center shadow-[0_0_0_1px_hsl(var(--primary)/0.08)]">
              <Zap className="w-4 h-4 text-primary" />
            </div>
            <div className="leading-tight">
              <div className="font-semibold text-sm tracking-tight">Phew.run</div>
              <div className="text-[11px] text-muted-foreground">Proof over noise</div>
            </div>
          </div>
          <ThemeToggle size="icon" className="h-9 w-9" />
        </div>
      </header>

      <main className="relative z-10 pt-24 pb-12">
        <section className="max-w-7xl mx-auto px-5 sm:px-6 pt-6 md:pt-10">
          <div className="grid xl:grid-cols-[1.05fr_0.95fr] gap-8 xl:gap-10 items-start">
            <div
              className={cn(
                "order-2 xl:order-1 relative card-premium p-5 sm:p-6 md:p-8 lg:p-10 overflow-hidden transition-all duration-500",
                isLoaded ? "opacity-100 translate-y-0" : "opacity-0 translate-y-6"
              )}
              style={{ transitionDelay: "90ms" }}
            >
              <div className="absolute inset-0 pointer-events-none">
                <div className="absolute right-[-5%] top-[-10%] h-48 w-48 rounded-full blur-3xl bg-primary/10" />
                <div className="absolute left-[-10%] bottom-[-18%] h-56 w-56 rounded-full blur-3xl bg-accent/10" />
              </div>

              <div className="relative z-10">
                <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-primary/5 border border-primary/15 mb-6">
                  <Sparkles className="w-3.5 h-3.5 text-primary" />
                  <span className="text-xs font-medium text-muted-foreground">Verified trading reputation, built in public</span>
                </div>

                <div className="max-w-xl">
                  <h1 className="text-3xl sm:text-4xl lg:text-5xl font-bold tracking-tight leading-tight">
                    Turn every call into
                    <span className="block text-gradient">provable performance</span>
                  </h1>
                  <p className="mt-4 text-sm sm:text-base text-muted-foreground leading-relaxed">
                    Phew.run helps traders document calls, measure outcomes, and earn credibility with transparent accuracy tracking.
                    No screenshots. No hindsight edits. Just a track record.
                  </p>
                </div>

                <div className="mt-7 grid sm:grid-cols-3 gap-3">
                  {stats.map((stat, index) => (
                    <div
                      key={stat.label}
                      className={cn(
                        "rounded-xl border border-border/50 bg-background/50 backdrop-blur-sm p-4 transition-all duration-500",
                        isLoaded ? "opacity-100 translate-y-0" : "opacity-0 translate-y-3"
                      )}
                      style={{ transitionDelay: `${140 + index * 40}ms` }}
                    >
                      <div className="text-xl font-semibold tracking-tight">{stat.value}</div>
                      <div className="text-xs text-muted-foreground mt-1">{stat.label}</div>
                    </div>
                  ))}
                </div>

                <div className="mt-7">
                  <AccuracyScoreCard />
                </div>

                <div className="mt-7 grid gap-3">
                  {features.map((feature, index) => (
                    <div
                      key={feature.title}
                      className={cn(
                        "rounded-xl border border-border/50 bg-background/40 p-4 flex items-start gap-3 transition-all duration-500",
                        isLoaded ? "opacity-100 translate-y-0" : "opacity-0 translate-y-3"
                      )}
                      style={{ transitionDelay: `${220 + index * 50}ms` }}
                    >
                      <div className="w-10 h-10 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0">
                        <feature.icon className="w-5 h-5 text-primary" />
                      </div>
                      <div>
                        <h3 className="font-semibold text-sm">{feature.title}</h3>
                        <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{feature.description}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="order-1 xl:order-2 w-full max-w-xl mx-auto xl:max-w-none">
              <div
                className={cn(
                  "transition-all duration-500",
                  isLoaded ? "opacity-100 translate-y-0" : "opacity-0 translate-y-6"
                )}
                style={{ transitionDelay: "160ms" }}
              >
                <div className="rounded-2xl border border-border/60 bg-background/80 backdrop-blur-xl shadow-[0_20px_70px_-35px_hsl(var(--foreground)/0.45)] overflow-hidden">
                  <div className="px-5 sm:px-6 pt-5 pb-4 border-b border-border/50 bg-gradient-to-b from-primary/[0.05] to-transparent">
                    <h2 className="text-xl sm:text-2xl font-semibold tracking-tight">Welcome back</h2>
                    <p className="text-xs sm:text-sm text-muted-foreground mt-1.5 leading-relaxed">
                      Sign in with your email to access your feed, profile, and leaderboard.
                    </p>
                  </div>

                  <div className="px-5 sm:px-6 py-5">
                    <div className="rounded-xl border border-border/60 bg-card/70 p-4">
                      <div className="space-y-3">
                        {privyAvailable ? <PrivyLoginButton /> : <FallbackLoginButton />}

                        <div className="flex items-start gap-2 rounded-lg bg-secondary/25 px-3 py-2 border border-border/40">
                          <Shield className="w-3.5 h-3.5 mt-0.5 text-primary shrink-0" />
                          <p className="text-[11px] sm:text-xs text-muted-foreground leading-relaxed">
                            Secure email verification. No wallet required to get started.
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="mt-4 rounded-2xl sm:rounded-3xl border border-primary/20 bg-background/85 backdrop-blur-xl overflow-hidden shadow-[0_24px_90px_-42px_hsl(var(--primary)/0.45)] ring-1 ring-primary/10">
                  <div className="px-5 sm:px-6 lg:px-7 py-5 sm:py-6 border-b border-border/50 bg-gradient-to-b from-primary/[0.10] via-accent/[0.06] to-transparent">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <h3 className="text-xl sm:text-2xl font-semibold tracking-tight">Level System</h3>
                        <p className="text-xs sm:text-sm text-muted-foreground mt-1.5 leading-relaxed">
                          Reputation moves in real time from liquidation risk to elite trader status.
                        </p>
                      </div>
                    </div>
                    <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-2.5 sm:gap-3">
                      <div className="rounded-xl border border-border/50 bg-background/50 p-3 sm:p-3.5">
                        <div className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground mb-1">Liquidation</div>
                        <div className="text-sm sm:text-base font-semibold">LVL {MIN_LEVEL}</div>
                      </div>
                      <div className="rounded-xl border border-border/50 bg-background/50 p-3 sm:p-3.5">
                        <div className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground mb-1">Neutral Entry</div>
                        <div className="text-sm sm:text-base font-semibold">LVL {STARTING_LEVEL}</div>
                      </div>
                      <div className="rounded-xl border border-primary/20 bg-primary/[0.04] p-3 sm:p-3.5 shadow-[0_0_0_1px_hsl(var(--primary)/0.06)]">
                        <div className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground mb-1">Veteran Protection</div>
                        <div className="text-sm sm:text-base font-semibold text-primary">LVL +5</div>
                      </div>
                      <div className="rounded-xl border border-border/50 bg-background/50 p-3 sm:p-3.5">
                        <div className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground mb-1">Elite Ceiling</div>
                        <div className="text-sm sm:text-base font-semibold">LVL +{MAX_LEVEL}</div>
                      </div>
                    </div>
                  </div>

                  <div className="px-5 sm:px-6 lg:px-7 py-5 sm:py-6">
                    <div className="grid gap-4 lg:grid-cols-[1.15fr_0.85fr] lg:items-start">
                    <div className="rounded-2xl border border-primary/15 bg-card/60 p-4 sm:p-5 shadow-[0_10px_40px_-28px_hsl(var(--primary)/0.5)]">
                      <div className="text-[11px] sm:text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground mb-3">
                        Key Level States
                      </div>
                      <div className="grid gap-3 sm:grid-cols-2">
                        {levelBarSnapshots.map((snapshot) => (
                          <div key={`${snapshot.title}-${snapshot.level}`} className="rounded-xl border border-border/50 bg-background/40 p-3.5 sm:p-4">
                            <div className="flex items-center justify-between gap-3 mb-2">
                              <div className="text-xs sm:text-sm font-medium">{snapshot.title}</div>
                              <div className="text-[10px] sm:text-[11px] px-2 py-0.5 rounded-full border border-border/60 bg-background/60 text-muted-foreground">
                                LVL {snapshot.level > 0 ? `+${snapshot.level}` : snapshot.level}
                              </div>
                            </div>
                            <LevelBar level={snapshot.level} size="sm" showLabel={false} />
                            <p className="mt-2 text-[11px] sm:text-xs text-muted-foreground leading-relaxed">{snapshot.note}</p>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="rounded-2xl border border-border/50 bg-background/40 p-4 sm:p-5">
                      <div className="text-[11px] sm:text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground mb-2.5">
                        Grow / Level Down Rules
                      </div>
                      <ul className="space-y-2">
                        {levelRules.map((rule) => (
                          <li key={rule} className="flex items-start gap-2.5">
                            <div className="mt-[6px] h-1.5 w-1.5 rounded-full bg-primary/80 shrink-0" />
                            <p className="text-[11px] sm:text-xs text-muted-foreground leading-relaxed">{rule}</p>
                          </li>
                        ))}
                      </ul>
                      <div className="mt-3.5 rounded-xl border border-red-500/20 bg-red-500/5 p-3">
                        <p className="text-[11px] sm:text-xs text-red-300 leading-relaxed">
                          Liquidation triggers at <span className="font-semibold">LVL {LIQUIDATION_LEVEL}</span>, and posting is disabled until your reputation improves.
                        </p>
                      </div>
                    </div>
                    </div>
                  </div>
                </div>

                <div className="mt-3 px-1 flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-[11px] sm:text-xs text-muted-foreground">
                  <div className="inline-flex items-center gap-1.5">
                    <Shield className="w-3.5 h-3.5" />
                    Secure email verification
                  </div>
                  <div className="hidden sm:block w-1 h-1 rounded-full bg-border" />
                  <div>Automatic account creation</div>
                  <div className="hidden sm:block w-1 h-1 rounded-full bg-border" />
                  <div>No wallet required to get started</div>
                </div>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="relative z-10 border-t border-border/50 py-8">
        <div className="max-w-7xl mx-auto px-5 sm:px-6 flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2 text-muted-foreground text-sm">
            <Zap className="w-4 h-4 text-primary" />
            <span>Phew.run</span>
            <span className="text-muted-foreground/50">|</span>
            <span>Proof over noise</span>
          </div>
          <div className="flex items-center gap-6 text-sm text-muted-foreground">
            <Link to="/terms" className="hover:text-foreground transition-colors">Terms</Link>
            <Link to="/privacy" className="hover:text-foreground transition-colors">Privacy</Link>
            <Link to="/docs" className="hover:text-foreground transition-colors">Docs</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
