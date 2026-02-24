import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/lib/auth-client";
import { usePrivyLogin } from "@/hooks/usePrivyLogin";
import { usePrivyAvailable } from "@/components/PrivyWalletProvider";
import { ThemeToggle } from "@/components/ThemeToggle";
import { LevelBar } from "@/components/feed/LevelBar";
import { Button } from "@/components/ui/button";
import {
  ArrowRight,
  BarChart3,
  CheckCircle2,
  Clock3,
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

const signInSteps = [
  {
    icon: Mail,
    title: "Enter Email",
    description: "Privy sends a one-time code to verify ownership of your email.",
  },
  {
    icon: CheckCircle2,
    title: "Confirm Code",
    description: "Your account is created automatically on first sign-in.",
  },
  {
    icon: BarChart3,
    title: "Start Building Proof",
    description: "Post calls, track outcomes, and grow your on-chain reputation.",
  },
];

const levelBarSnapshots = [
  {
    level: -4,
    title: "Critical",
    note: "One more bad result can push you into liquidation.",
  },
  {
    level: STARTING_LEVEL,
    title: "Starting Point",
    note: "New users begin neutral and earn reputation from outcomes.",
  },
  {
    level: 4,
    title: "Veteran Zone",
    note: "Consistent results move you into a stronger reputation tier.",
  },
  {
    level: 9,
    title: "Elite",
    note: "Top performers sit near the cap with strong visible track records.",
  },
];

const levelRules = [
  "1H win (>0%) gives +1 level immediately.",
  "1H soft loss (<30%) does not level down immediately and gets a 6H recovery check.",
  "1H severe loss (>=30%) gives -1 level immediately.",
  "At 6H, a recovery win gives +1 level; recovery failure gives -1 level.",
  "If you win at 1H and still win at 6H, you earn a second +1 level bonus.",
  `Levels are capped between LVL ${MIN_LEVEL} and LVL +${MAX_LEVEL}.`,
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
                  <div className="px-6 sm:px-7 pt-6 pb-5 border-b border-border/50 bg-gradient-to-b from-primary/[0.05] to-transparent">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <div className="inline-flex items-center gap-2 rounded-full border border-border/60 bg-background/70 px-2.5 py-1 mb-3">
                          <Clock3 className="w-3 h-3 text-primary" />
                          <span className="text-[11px] text-muted-foreground">Email code sign-in takes under a minute</span>
                        </div>
                        <h2 className="text-2xl sm:text-3xl font-semibold tracking-tight">Welcome back</h2>
                        <p className="text-sm text-muted-foreground mt-2 max-w-sm leading-relaxed">
                          Sign in with your email to access your dashboard, profile, and leaderboard position.
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="px-6 sm:px-7 py-6">
                    <div className="rounded-xl border border-border/60 bg-card/70 p-4 sm:p-5">
                      <div className="space-y-4">
                        {privyAvailable ? <PrivyLoginButton /> : <FallbackLoginButton />}

                        <div className="flex items-start gap-2 rounded-lg bg-secondary/30 px-3 py-2.5 border border-border/50">
                          <Shield className="w-4 h-4 mt-0.5 text-primary shrink-0" />
                          <p className="text-xs text-muted-foreground leading-relaxed">
                            We use secure email verification via Privy. New accounts are created automatically after code confirmation.
                          </p>
                        </div>

                        <p className="text-xs text-center text-muted-foreground">
                          By continuing, you agree to use the platform responsibly and keep signal quality high.
                        </p>
                      </div>
                    </div>

                    <div className="mt-5 grid gap-3">
                      {signInSteps.map((step, index) => (
                        <div
                          key={step.title}
                          className="rounded-xl border border-border/50 bg-background/40 p-4"
                        >
                          <div className="flex items-start gap-3">
                            <div className="w-9 h-9 rounded-lg border border-primary/20 bg-primary/10 flex items-center justify-center shrink-0">
                              <step.icon className="w-4 h-4 text-primary" />
                            </div>
                            <div className="min-w-0">
                              <div className="flex items-center gap-2">
                                <span className="text-[11px] font-medium text-muted-foreground">Step {index + 1}</span>
                              </div>
                              <h3 className="text-sm font-semibold mt-0.5">{step.title}</h3>
                              <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{step.description}</p>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>

                    <div className="mt-5 grid grid-cols-2 gap-3">
                      <div className="rounded-xl border border-border/50 bg-background/40 p-4">
                        <div className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground mb-2">Trust</div>
                        <div className="text-sm font-medium leading-tight">Timestamped calls + visible outcomes</div>
                      </div>
                      <div className="rounded-xl border border-border/50 bg-background/40 p-4">
                        <div className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground mb-2">Focus</div>
                        <div className="text-sm font-medium leading-tight">Email-only access keeps onboarding clean</div>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="mt-4 rounded-2xl border border-border/60 bg-background/75 backdrop-blur-xl overflow-hidden">
                  <div className="px-6 sm:px-7 py-5 border-b border-border/50 bg-gradient-to-b from-accent/[0.05] to-transparent">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <h3 className="text-lg font-semibold tracking-tight">How Levels Work</h3>
                        <p className="text-xs sm:text-sm text-muted-foreground mt-1 leading-relaxed">
                          Reputation moves up and down based on post outcomes. The bar below is the same level system used across profile, feed, and leaderboard.
                        </p>
                      </div>
                    </div>
                    <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-2">
                      <div className="rounded-lg border border-border/50 bg-background/50 p-3">
                        <div className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground mb-1">Start</div>
                        <div className="text-sm font-semibold">LVL {STARTING_LEVEL}</div>
                      </div>
                      <div className="rounded-lg border border-border/50 bg-background/50 p-3">
                        <div className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground mb-1">Floor</div>
                        <div className="text-sm font-semibold">LVL {MIN_LEVEL}</div>
                      </div>
                      <div className="rounded-lg border border-border/50 bg-background/50 p-3">
                        <div className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground mb-1">Cap</div>
                        <div className="text-sm font-semibold">LVL +{MAX_LEVEL}</div>
                      </div>
                      <div className="rounded-lg border border-border/50 bg-background/50 p-3">
                        <div className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground mb-1">Risk</div>
                        <div className="text-sm font-semibold">LVL {LIQUIDATION_LEVEL}</div>
                      </div>
                    </div>
                  </div>

                  <div className="px-6 sm:px-7 py-5">
                    <div className="rounded-xl border border-border/50 bg-card/50 p-4">
                      <div className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground mb-3">
                        Level Bar Snapshots
                      </div>
                      <div className="space-y-3">
                        {levelBarSnapshots.map((snapshot) => (
                          <div key={`${snapshot.title}-${snapshot.level}`} className="rounded-lg border border-border/50 bg-background/40 p-3">
                            <div className="flex items-center justify-between gap-3 mb-2">
                              <div className="text-sm font-medium">{snapshot.title}</div>
                              <div className="text-[11px] text-muted-foreground">Example</div>
                            </div>
                            <LevelBar level={snapshot.level} size="md" />
                            <p className="mt-2 text-xs text-muted-foreground leading-relaxed">{snapshot.note}</p>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="mt-4 rounded-xl border border-border/50 bg-background/40 p-4">
                      <div className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground mb-3">
                        Grow / Level Down Rules
                      </div>
                      <ul className="space-y-2.5">
                        {levelRules.map((rule, index) => (
                          <li key={rule} className="flex items-start gap-3">
                            <div className="mt-0.5 h-5 w-5 rounded-full border border-primary/25 bg-primary/10 text-[11px] font-semibold text-primary flex items-center justify-center shrink-0">
                              {index + 1}
                            </div>
                            <p className="text-xs sm:text-sm text-muted-foreground leading-relaxed">{rule}</p>
                          </li>
                        ))}
                      </ul>
                      <div className="mt-4 rounded-lg border border-red-500/20 bg-red-500/5 p-3">
                        <p className="text-xs text-red-300 leading-relaxed">
                          If your level reaches <span className="font-semibold">LVL {LIQUIDATION_LEVEL}</span>, you enter liquidation and cannot post new alphas until your reputation improves.
                        </p>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="mt-4 px-1 flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-xs text-muted-foreground">
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
            <a href="#" className="hover:text-foreground transition-colors">Terms</a>
            <a href="#" className="hover:text-foreground transition-colors">Privacy</a>
            <a href="#" className="hover:text-foreground transition-colors">Docs</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
