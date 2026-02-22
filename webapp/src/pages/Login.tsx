import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/lib/auth-client";
import { usePrivyLogin } from "@/hooks/usePrivyLogin";
import { usePrivyAvailable } from "@/components/PrivyWalletProvider";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Button } from "@/components/ui/button";
import { ArrowRight, Zap, TrendingUp, Users, Target, Shield, Loader2, Mail } from "lucide-react";
import { AccuracyScoreCard } from "@/components/AccuracyScoreCard";
import { cn } from "@/lib/utils";

const features = [
  {
    icon: Target,
    title: "Track Alpha Calls",
    description: "Log your crypto predictions and build an immutable track record."
  },
  {
    icon: TrendingUp,
    title: "Prove Your Edge",
    description: "Real-time accuracy metrics that showcase your trading insight."
  },
  {
    icon: Users,
    title: "Join the Phew",
    description: "Connect with verified traders. Follow the signal, cut the noise."
  }
];

const stats = [
  { value: "10K+", label: "Calls Tracked" },
  { value: "68%", label: "Avg Accuracy" },
  { value: "2.4K", label: "Active Traders" }
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
      {/* Background Effects */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <div
          className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[600px] rounded-full blur-3xl animate-glow-pulse"
          style={{ background: "radial-gradient(ellipse at center, hsl(var(--primary) / 0.15), transparent 70%)" }}
        />
        <div
          className="absolute bottom-0 right-0 w-[600px] h-[600px] rounded-full blur-3xl animate-glow-pulse"
          style={{ background: "radial-gradient(ellipse at center, hsl(var(--accent) / 0.1), transparent 70%)", animationDelay: "1.5s" }}
        />
        <div
          className="absolute inset-0 opacity-[0.02]"
          style={{
            backgroundImage: `linear-gradient(hsl(var(--foreground)) 1px, transparent 1px), linear-gradient(90deg, hsl(var(--foreground)) 1px, transparent 1px)`,
            backgroundSize: "60px 60px"
          }}
        />
      </div>

      {/* Header */}
      <header className={cn("fixed top-0 left-0 right-0 z-50 transition-all duration-500", isLoaded ? "opacity-100 translate-y-0" : "opacity-0 -translate-y-4")}>
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center">
              <Zap className="w-4 h-4 text-primary" />
            </div>
            <span className="font-semibold text-sm tracking-tight">Just a Phew</span>
          </div>
          <ThemeToggle size="icon" className="h-9 w-9" />
        </div>
      </header>

      {/* Main Content */}
      <main className="relative z-10 pt-24 pb-20">
        <section className="max-w-7xl mx-auto px-6 pt-8 md:pt-16 pb-12">
          <div className="grid lg:grid-cols-2 gap-12 lg:gap-20 items-center">
            {/* Left Column - Branding */}
            <div className="hidden lg:block">
              <div
                className={cn("transition-all duration-500", isLoaded ? "opacity-100 translate-y-0" : "opacity-0 translate-y-6")}
                style={{ transitionDelay: "100ms" }}
              >
                <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-primary/5 border border-primary/10 mb-6">
                  <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-primary"></span>
                  </span>
                  <span className="text-xs font-medium text-muted-foreground">The SocialFi platform for verified alpha</span>
                </div>

                <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold tracking-tight mb-4">
                  <span className="text-gradient">Just a Phew</span>
                </h1>
                <p className="text-xl md:text-2xl text-muted-foreground font-medium mb-4">running the internet</p>
                <p className="text-base text-muted-foreground/80 max-w-md mb-6">
                  Build your reputation through verified crypto calls. Track accuracy, climb the ranks, become the alpha.
                </p>

                <AccuracyScoreCard className="mb-6" />

                <div className="space-y-4">
                  {features.map((feature, index) => (
                    <div key={index} className="flex items-start gap-3">
                      <div className="w-10 h-10 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center flex-shrink-0">
                        <feature.icon className="w-5 h-5 text-primary" />
                      </div>
                      <div>
                        <h3 className="font-semibold text-sm">{feature.title}</h3>
                        <p className="text-xs text-muted-foreground">{feature.description}</p>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="flex items-center gap-8 mt-8 pt-6 border-t border-border/50">
                  {stats.map((stat, index) => (
                    <div key={index}>
                      <div className="text-xl font-bold text-foreground">{stat.value}</div>
                      <div className="text-xs text-muted-foreground">{stat.label}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Right Column - Auth Card */}
            <div className="w-full max-w-md mx-auto lg:mx-0">
              <div
                className={cn("card-premium p-8 transition-all duration-500", isLoaded ? "opacity-100 translate-y-0" : "opacity-0 translate-y-6")}
                style={{ transitionDelay: "200ms" }}
              >
                {/* Mobile branding */}
                <div className="lg:hidden text-center mb-8">
                  <h1 className="text-3xl font-bold tracking-tight mb-2">
                    <span className="text-gradient">Just a Phew</span>
                  </h1>
                  <p className="text-sm text-muted-foreground">running the internet</p>
                </div>

                <div className="text-center mb-8">
                  <h2 className="text-xl font-semibold">Welcome</h2>
                  <p className="text-sm text-muted-foreground mt-1">
                    Sign in with your email to access your dashboard
                  </p>
                </div>

                <div className="space-y-4 relative z-10">
                  {privyAvailable ? <PrivyLoginButton /> : <FallbackLoginButton />}

                  <p className="text-xs text-center text-muted-foreground pt-2">
                    New to Just a Phew? An account will be created automatically.
                  </p>
                </div>
              </div>

              {/* Security notice */}
              <div
                className={cn("flex items-center justify-center gap-2 mt-6 text-xs text-muted-foreground transition-all duration-500", isLoaded ? "opacity-100 translate-y-0" : "opacity-0 translate-y-6")}
                style={{ transitionDelay: "300ms" }}
              >
                <Shield className="w-3.5 h-3.5" />
                <span>Secured with end-to-end encryption</span>
              </div>
            </div>
          </div>
        </section>

        {/* Mobile Features Section */}
        <section className="lg:hidden max-w-7xl mx-auto px-6 py-12">
          <div className="text-center mb-8">
            <h2 className="text-2xl font-bold mb-2">Reputation is everything</h2>
            <p className="text-muted-foreground text-sm">In a world of noise, your track record speaks louder than words.</p>
          </div>
          <div className="space-y-4">
            {features.map((feature, index) => (
              <div key={index} className="card-premium p-5">
                <div className="flex items-start gap-4">
                  <div className="w-10 h-10 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center flex-shrink-0">
                    <feature.icon className="w-5 h-5 text-primary" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-sm mb-1">{feature.title}</h3>
                    <p className="text-xs text-muted-foreground">{feature.description}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
          <div className="flex items-center justify-center gap-8 mt-8 py-6 border-t border-border/50">
            {stats.map((stat, index) => (
              <div key={index} className="text-center">
                <div className="text-xl font-bold text-foreground">{stat.value}</div>
                <div className="text-xs text-muted-foreground">{stat.label}</div>
              </div>
            ))}
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="relative z-10 border-t border-border/50 py-8">
        <div className="max-w-7xl mx-auto px-6 flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2 text-muted-foreground text-sm">
            <Zap className="w-4 h-4 text-primary" />
            <span>Just a Phew</span>
            <span className="text-muted-foreground/50">|</span>
            <span>running the internet</span>
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
