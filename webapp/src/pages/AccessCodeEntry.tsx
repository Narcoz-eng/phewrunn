import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useIdentityToken, usePrivy, useUser } from "@privy-io/react-auth";
import { ArrowLeft, ArrowRight, KeyRound, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { LivePlatformPreview } from "@/components/login/LivePlatformPreview";
import {
  clearPrivySyncFailureState,
  isAccessCodeBootstrapDebugCode,
  readPrivyAuthBootstrapSnapshot,
  setPrivyAuthBootstrapState,
  startPrivyAuthBootstrap,
} from "@/lib/auth-client";
import type { PrivyUserLike } from "@/lib/privy-user";

const PENDING_CODE_KEY = "phew.pending-invite-code";

function AuthBackground() {
  return (
    <div className="fixed inset-0 z-0 overflow-hidden">
      <LivePlatformPreview />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(169,255,52,0.06),transparent_24%),linear-gradient(180deg,rgba(2,5,7,0.42),rgba(2,5,7,0.92))]" />
      <div className="absolute inset-0 bg-black/20 backdrop-blur-[2px]" />
    </div>
  );
}

export default function AccessCodeEntry() {
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { ready, authenticated, user, getAccessToken } = usePrivy();
  const { identityToken } = useIdentityToken();
  const { refreshUser } = useUser();

  useEffect(() => {
    const urlCode = searchParams.get("code");
    if (urlCode) {
      const normalized = urlCode.trim().toUpperCase();
      setCode(normalized);
      sessionStorage.setItem(PENDING_CODE_KEY, normalized);
      return;
    }
    const stored = sessionStorage.getItem(PENDING_CODE_KEY);
    if (stored) setCode(stored);
  }, [searchParams]);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    const trimmed = code.trim().toUpperCase();
    if (!trimmed) {
      setError("Please enter an invite or access code.");
      return;
    }
    setError(null);

    sessionStorage.setItem(PENDING_CODE_KEY, trimmed);
    clearPrivySyncFailureState();

    if (!authenticated || !user) {
      setPrivyAuthBootstrapState("idle", {
        owner: "system",
        mode: "manual",
        userId: null,
        detail: "access code entered, needs Privy sign-in first",
        debugCode: "access_code_submitted",
      });
      navigate("/login", { replace: true });
      return;
    }

    setPrivyAuthBootstrapState("idle", {
      owner: "system",
      mode: "manual",
      userId: null,
      detail: "access code submitted, retrying backend sync",
      debugCode: "access_code_submitted",
    });

    setIsSyncing(true);
    try {
      const syncedUser = await startPrivyAuthBootstrap({
        owner: "usePrivyLogin",
        mode: "manual",
        user: user as PrivyUserLike,
        getLatestUser: () => user as PrivyUserLike,
        privyReady: ready,
        privyAuthenticated: authenticated,
        privyIdentityToken: identityToken ?? null,
        getLatestPrivyIdentityToken: () => identityToken ?? null,
        refreshPrivyAuthState: async () => (await refreshUser()) as PrivyUserLike,
        getLatestPrivyAccessToken: () => getAccessToken(),
        triggerSource: "manual_user_action",
      });

      if (syncedUser) {
        navigate(syncedUser.username ? "/" : "/welcome", { replace: true });
        return;
      }

      const snapshot = readPrivyAuthBootstrapSnapshot();
      if (isAccessCodeBootstrapDebugCode(snapshot?.debugCode)) {
        setError("That code didn't work. Please check and try again.");
      } else {
        setError("Could not sign you in. Please try again.");
      }
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setIsSyncing(false);
    }
  };

  return (
    <div className="min-h-screen overflow-hidden bg-background text-white">
      <AuthBackground />
      <main className="relative z-10 flex min-h-screen items-center justify-center px-5 py-10">
        <section className="w-full max-w-[420px] overflow-hidden rounded-[28px] border border-white/12 bg-[linear-gradient(180deg,rgba(6,10,12,0.84),rgba(3,7,9,0.95))] p-6 shadow-[0_34px_96px_-52px_rgba(0,0,0,0.95)] backdrop-blur-3xl sm:p-7">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-[16px] border border-lime-300/18 bg-lime-300/10 text-lime-200">
              <KeyRound className="h-5 w-5" />
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-[0.26em] text-lime-200/70">Invite gate</div>
              <h1 className="mt-1 text-2xl font-semibold tracking-[-0.04em] text-white">Access code</h1>
            </div>
          </div>

          <p className="mt-4 text-sm leading-6 text-white/58">
            Enter the invite code tied to your account, then continue through the locked product sign-in.
          </p>

          <form onSubmit={handleSubmit} className="mt-6 space-y-4">
            <div>
              <Input
                id="code"
                placeholder="PHEW-XXXX or USR-XXXXXXXX"
                value={code}
                onChange={(event) => {
                  setCode(event.target.value.toUpperCase());
                  setError(null);
                }}
                className="h-14 rounded-[18px] border-white/10 bg-white/[0.04] text-center font-mono tracking-wider text-white placeholder:text-white/26"
                autoFocus
                autoComplete="off"
              />
              {error ? <p className="mt-2 text-sm text-rose-300">{error}</p> : null}
            </div>

            <Button type="submit" className="h-14 w-full justify-between rounded-[18px] px-5 text-slate-950" disabled={isSyncing}>
              <span className="flex items-center gap-2">
                {isSyncing ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}
                {isSyncing ? "Verifying..." : "Continue"}
              </span>
              <ArrowRight className="h-4 w-4" />
            </Button>
          </form>

          <div className="mt-5 border-t border-white/8 pt-4 text-center">
            <Link to="/login" className="inline-flex items-center gap-1.5 text-xs text-white/46 transition hover:text-lime-200">
              <ArrowLeft className="h-3.5 w-3.5" />
              Back to login
            </Link>
          </div>
        </section>
      </main>
    </div>
  );
}
