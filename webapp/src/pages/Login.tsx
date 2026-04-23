import { useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { motion } from "framer-motion";
import {
  clearPrivySyncFailureState,
  setPrivyAuthBootstrapState,
  useAuth,
  usePrivySyncFailureSnapshot,
} from "@/lib/auth-client";
import { usePrivyLogin } from "@/hooks/usePrivyLogin";
import { usePrivyAvailable } from "@/components/PrivyContext";
import { ThemeToggle } from "@/components/ThemeToggle";
import { BrandLogo } from "@/components/BrandLogo";
import { InboxRouteIcon, RouteArrowIcon } from "@/components/login/LoginPageIcons";
import { Button } from "@/components/ui/button";
import { Loader2, Mail, Zap } from "lucide-react";
import { BuyPanelViz } from "@/components/login/BuyPanelViz";
import { AlertsViz } from "@/components/login/AlertsViz";

function Background() {
  return (
    <div className="pointer-events-none fixed inset-0 z-0 overflow-hidden">
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
      <motion.div
        className="absolute rounded-full blur-[100px]"
        style={{
          width: 520,
          height: 520,
          bottom: "-14%",
          left: "-10%",
          background: "radial-gradient(ellipse, hsl(var(--accent)/0.2) 0%, transparent 65%)",
          willChange: "transform",
        }}
        animate={{ x: [0, -32, 22, 0], y: [0, 22, -14, 0], scale: [1, 1.05, 0.96, 1] }}
        transition={{ duration: 26, ease: "easeInOut", repeat: Infinity, repeatType: "loop" }}
      />
      <motion.div
        className="absolute rounded-full blur-[80px]"
        style={{
          width: 300,
          height: 300,
          top: "40%",
          right: "5%",
          background: "radial-gradient(ellipse, hsl(var(--primary)/0.1) 0%, transparent 70%)",
          willChange: "transform",
        }}
        animate={{ x: [0, 20, -10, 0], y: [0, -20, 10, 0] }}
        transition={{ duration: 19, ease: "easeInOut", repeat: Infinity, repeatType: "loop" }}
      />
      <div
        className="absolute inset-0 opacity-[0.025]"
        style={{
          backgroundImage:
            "linear-gradient(hsl(var(--foreground)) 1px, transparent 1px), linear-gradient(90deg, hsl(var(--foreground)) 1px, transparent 1px)",
          backgroundSize: "64px 64px",
        }}
      />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,transparent_0%,hsl(var(--background))_80%)]" />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_bottom,transparent_0%,hsl(var(--background)/0.5)_90%)]" />
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

  const orbClassName =
    "group flex min-h-[120px] flex-col items-center justify-center gap-4 rounded-[28px] border border-white/10 bg-[linear-gradient(180deg,rgba(16,21,24,0.98),rgba(9,12,15,0.98))] px-4 py-5 text-center text-white transition-all duration-300 hover:-translate-y-0.5 hover:border-white/18 hover:bg-white/[0.06]";

  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2">
        <button
          type="button"
          className={orbClassName}
          onClick={() => login({ loginMethods: ["twitter"] })}
          disabled={isSyncing || isRetryBlocked}
        >
          <span className="inline-flex h-16 w-16 items-center justify-center rounded-full border border-white/10 bg-white/[0.05] text-2xl font-black shadow-[0_12px_36px_-20px_rgba(255,255,255,0.18)]">
            X
          </span>
          <span className="text-sm font-medium text-white/78">
            {privyReady ? "X (Twitter)" : "Initializing..."}
          </span>
        </button>
        <button
          type="button"
          className={orbClassName}
          onClick={() => login({ loginMethods: ["email"] })}
          disabled={isSyncing || isRetryBlocked}
        >
          <span className="inline-flex h-16 w-16 items-center justify-center rounded-full border border-lime-300/18 bg-lime-300/10 text-lime-200 shadow-[0_12px_36px_-20px_rgba(169,255,52,0.34)]">
            <Mail className="h-7 w-7" />
          </span>
          <span className="text-sm font-medium text-white/78">
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
      <div className="grid gap-3 sm:grid-cols-2">
        {["X", "Email"].map((label) => (
          <Button key={label} type="button" variant="outline" className="h-[120px] rounded-[28px] opacity-50" disabled>
            <div className="flex flex-col items-center gap-3">
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
      className="w-full"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, delay: 0.12, ease: "easeOut" }}
    >
      <div className="relative overflow-hidden rounded-[34px] border border-white/10 bg-[linear-gradient(180deg,rgba(6,10,12,0.96),rgba(3,7,9,0.96))] p-6 shadow-[0_34px_96px_-52px_rgba(0,0,0,0.95)] backdrop-blur-2xl sm:p-7">
        <div className="pointer-events-none absolute inset-x-[18%] top-0 h-24 rounded-full bg-lime-300/6 blur-3xl" />
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(169,255,52,0.1),transparent_22%),radial-gradient(circle_at_top_right,rgba(65,232,207,0.08),transparent_24%)]" />

        <motion.div
          className="relative mb-5 text-[10px] uppercase tracking-[0.3em] text-white/46"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.4, delay: 0.28 }}
        >
          Continue with
        </motion.div>

        <motion.div
          className="relative"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, delay: 0.42 }}
        >
          {privyAvailable ? <PrivyLoginButton /> : <FallbackLoginButton />}
        </motion.div>

        <motion.div
          className="mt-6 border-t border-white/8 pt-5 text-center text-sm text-white/52"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.35, delay: 0.5 }}
        >
          Already have an account? <button type="button" className="font-semibold text-lime-300">Log in</button>
          <div className="mt-3 text-[11px] text-white/42">
            Supported sign-in methods only. Session routing, invite bootstrap, and account recovery stay unchanged.
          </div>
        </motion.div>
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

      <div className="relative z-40 flex justify-end px-5 pt-5 sm:px-8">
        <ThemeToggle size="icon" className="h-9 w-9 border border-white/10 bg-white/[0.04]" />
      </div>

      <main className="relative z-10 px-5 pb-16 pt-4 sm:px-8 sm:pt-6">
        <div className="mx-auto flex w-full max-w-7xl flex-col gap-8">
          <section className="v2-auth-hero-lines relative text-center">
            <motion.div
              initial={{ opacity: 0, y: 18 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.08, ease: "easeOut" }}
              className="mx-auto max-w-5xl"
            >
              <div className="flex justify-center">
                <BrandLogo size="lg" className="scale-[1.08]" />
              </div>
              <h1 className="mt-10 text-5xl font-black tracking-[-0.05em] text-white sm:text-7xl lg:text-[6rem] lg:leading-[0.94]">
                <span className="bg-gradient-to-r from-[#b6ff40] via-[#8ef06c] to-[#41e8cf] bg-clip-text text-transparent">
                  Run the alpha.
                </span>
                <br />
                <span className="bg-gradient-to-r from-[#b6ff40] via-[#8ef06c] to-[#41e8cf] bg-clip-text text-transparent">
                  Win together.
                </span>
              </h1>
              <p className="mx-auto mt-6 max-w-3xl text-lg leading-8 text-white/58 sm:text-[1.35rem]">
                Social calls. AI intelligence. X raids. Trading terminal. Bundle risk. All in one operating surface.
              </p>
            </motion.div>

            <div className="mx-auto mt-10 max-w-4xl">
              <LoginCard privyAvailable={privyAvailable} />
              <p className="mt-5 text-center text-[11px] text-white/42">
                By signing in you agree to Terms of Service and Privacy Policy.
              </p>
            </div>
          </section>

          <section className="space-y-5">
            <div className="v2-auth-preview-grid">
              <div className="v2-auth-preview-cell px-4 py-5">
                <div className="mb-5 flex items-center gap-3">
                  <BrandLogo size="sm" showTagline={false} />
                </div>
                <div className="space-y-2">
                  {[
                    "Feed",
                    "X Raids",
                    "Terminal",
                    "Leaderboard",
                    "Communities",
                    "AI Intelligence",
                    "Notifications",
                    "Profile",
                  ].map((item, index) => (
                    <div
                      key={item}
                      className={`rounded-[18px] border px-3 py-3 text-sm ${
                        index === 2
                          ? "border-lime-300/18 bg-lime-300/10 text-lime-200"
                          : "border-white/8 bg-white/[0.03] text-white/62"
                      }`}
                    >
                      {item}
                    </div>
                  ))}
                </div>
                <div className="mt-5 rounded-[24px] border border-white/8 bg-white/[0.03] p-4">
                  <div className="text-sm font-semibold text-white">PhewRunner</div>
                  <div className="mt-1 text-xs text-white/46">Level 27</div>
                  <div className="mt-4 h-2 overflow-hidden rounded-full bg-white/[0.06]">
                    <div className="h-full w-[74%] rounded-full bg-[linear-gradient(90deg,#a9ff34,#41e8cf)]" />
                  </div>
                  <div className="mt-2 text-xs text-lime-300">18,540 / 25,000 XP</div>
                </div>
              </div>

              <div className="v2-auth-preview-cell px-5 py-5">
                <div className="flex items-center justify-between gap-4 border-b border-white/8 pb-4">
                  <div>
                    <div className="text-[11px] uppercase tracking-[0.2em] text-white/36">Terminal</div>
                    <div className="mt-2 text-xl font-semibold text-white">$PEPE / USDT</div>
                  </div>
                  <div className="rounded-[18px] border border-lime-300/16 bg-lime-300/10 px-4 py-2 text-lg font-semibold text-lime-300">
                    0.00001235
                    <span className="ml-2 text-sm text-emerald-300">+24.23%</span>
                  </div>
                </div>
                <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1.05fr)_300px]">
                  <div className="rounded-[24px] border border-white/8 bg-[linear-gradient(180deg,rgba(6,11,14,0.98),rgba(3,8,10,0.98))] p-4">
                    <div className="mb-3 text-[11px] uppercase tracking-[0.18em] text-white/36">Chart core</div>
                    <BuyPanelViz />
                  </div>
                  <div className="grid gap-4">
                    <div className="rounded-[24px] border border-white/8 bg-white/[0.03] p-4">
                      <div className="text-[11px] uppercase tracking-[0.18em] text-white/36">AI Detection</div>
                      <div className="mt-3 flex items-center justify-between gap-3">
                        <div>
                          <div className="rounded-full border border-lime-300/16 bg-lime-300/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-lime-200">
                            High conviction
                          </div>
                          <div className="mt-4 text-4xl font-semibold text-[#41e8cf]">
                            98.7<span className="text-xl text-white/40">/100</span>
                          </div>
                        </div>
                        <div className="rounded-full border border-lime-300/14 bg-lime-300/8 p-4 text-lime-300">
                          <Zap className="h-9 w-9" />
                        </div>
                      </div>
                    </div>
                    <div className="rounded-[24px] border border-white/8 bg-white/[0.03] p-4">
                      <div className="text-[11px] uppercase tracking-[0.18em] text-white/36">Top Signals</div>
                      <div className="mt-3 space-y-2 text-sm">
                        {[
                          ["Whale accumulation", "High"],
                          ["Smart money flow", "High"],
                          ["Holder growth", "Very high"],
                          ["Social sentiment", "Bullish"],
                        ].map(([label, value]) => (
                          <div
                            key={label}
                            className="flex items-center justify-between rounded-[16px] border border-white/8 bg-white/[0.03] px-3 py-2"
                          >
                            <span className="text-white/72">{label}</span>
                            <span className="text-lime-300">{value}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
                <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                  <div className="rounded-[22px] border border-white/8 bg-white/[0.03] p-4">
                    <div className="text-[11px] uppercase tracking-[0.18em] text-white/36">AI Detection</div>
                    <div className="mt-3 text-lg font-semibold text-[#41e8cf]">98.7 / 100</div>
                    <div className="mt-1 text-xs text-lime-300">High conviction</div>
                  </div>
                  <div className="rounded-[22px] border border-white/8 bg-white/[0.03] p-4">
                    <div className="text-[11px] uppercase tracking-[0.18em] text-white/36">Top Signals</div>
                    <div className="mt-3 text-lg font-semibold text-white">Whale + Smart Money</div>
                    <div className="mt-1 text-xs text-white/42">Momentum, social, holder growth</div>
                  </div>
                  <div className="rounded-[22px] border border-white/8 bg-white/[0.03] p-4">
                    <div className="text-[11px] uppercase tracking-[0.18em] text-white/36">X Raid Active</div>
                    <div className="mt-3 text-lg font-semibold text-white">$PEPE RAID</div>
                    <div className="mt-1 text-xs text-lime-300">1,245 participants · 76%</div>
                  </div>
                  <div className="rounded-[22px] border border-white/8 bg-white/[0.03] p-4">
                    <div className="text-[11px] uppercase tracking-[0.18em] text-white/36">Community</div>
                    <div className="mt-3 text-lg font-semibold text-white">$PEPE Community</div>
                    <div className="mt-1 text-xs text-white/42">12.4K members · 245 online</div>
                  </div>
                </div>
              </div>

              <div className="v2-auth-preview-cell px-4 py-5">
                <div className="text-[11px] uppercase tracking-[0.18em] text-white/36">Market + alerts</div>
                <div className="mt-4 space-y-4">
                  <div className="rounded-[24px] border border-white/8 bg-white/[0.03] p-4">
                    <div className="mb-3 text-sm font-semibold text-white">Market trades</div>
                    <div className="space-y-2 text-sm">
                      {[
                        ["0.00001235", "11.23M", "lime"],
                        ["0.00001236", "3.45M", "lime"],
                        ["0.00001233", "2.11M", "rose"],
                        ["0.00001235", "4.96M", "rose"],
                        ["0.00001236", "4.56M", "lime"],
                      ].map(([price, amount, tone], index) => (
                        <div
                          key={`${price}-${index}`}
                          className="grid grid-cols-[1fr_auto] items-center gap-3 rounded-[14px] border border-white/6 bg-white/[0.02] px-3 py-2"
                        >
                          <span className={tone === "rose" ? "text-rose-300" : "text-lime-300"}>{price}</span>
                          <span className="text-white/56">{amount}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                  <AlertsViz />
                </div>
              </div>
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}
