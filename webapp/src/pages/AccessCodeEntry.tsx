import { useState, useEffect } from "react";
import { useNavigate, useSearchParams, Link } from "react-router-dom";
import { usePrivy, useIdentityToken } from "@privy-io/react-auth";
import { useUser } from "@privy-io/react-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { KeyRound, ArrowRight, ArrowLeft, Loader2 } from "lucide-react";
import {
  clearPrivySyncFailureState,
  isAccessCodeBootstrapDebugCode,
  readPrivyAuthBootstrapSnapshot,
  setPrivyAuthBootstrapState,
  startPrivyAuthBootstrap,
} from "@/lib/auth-client";
import type { PrivyUserLike } from "@/lib/privy-user";

const PENDING_CODE_KEY = "phew.pending-invite-code";

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
      setCode(urlCode.toUpperCase());
      sessionStorage.setItem(PENDING_CODE_KEY, urlCode.toUpperCase());
    } else {
      const stored = sessionStorage.getItem(PENDING_CODE_KEY);
      if (stored) setCode(stored);
    }
  }, [searchParams]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = code.trim().toUpperCase();
    if (!trimmed) {
      setError("Please enter an invite or access code.");
      return;
    }
    setError(null);

    // Store code FIRST so the backend sync request will include it
    sessionStorage.setItem(PENDING_CODE_KEY, trimmed);
    clearPrivySyncFailureState();

    if (!authenticated || !user) {
      // Not signed in with Privy yet — reset state and go to login
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

    // Reset bootstrap state so guards don't block the retry
    setPrivyAuthBootstrapState("idle", {
      owner: "system",
      mode: "manual",
      userId: null,
      detail: "access code submitted, retrying backend sync",
      debugCode: "access_code_submitted",
    });

    setIsSyncing(true);
    try {
      // Call startPrivyAuthBootstrap directly to bypass usePrivyLogin's
      // intermediate layers which can silently return null without feedback.
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

      // Bootstrap returned null — determine why and show appropriate error
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
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
            <KeyRound className="h-6 w-6 text-primary" />
          </div>
          <CardTitle className="text-2xl">Access Required</CardTitle>
          <CardDescription>
            phew.run is currently invite-only. Enter your invite or access code to join.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="code">Invite / Access Code</Label>
              <Input
                id="code"
                placeholder="PHEW-XXXX or USR-XXXXXXXX"
                value={code}
                onChange={(e) => {
                  setCode(e.target.value.toUpperCase());
                  setError(null);
                }}
                className="font-mono tracking-wider text-center"
                autoFocus
                autoComplete="off"
              />
              {error ? <p className="text-sm text-destructive">{error}</p> : null}
            </div>
            <Button type="submit" className="w-full gap-2" disabled={isSyncing}>
              {isSyncing ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Verifying...
                </>
              ) : (
                <>
                  Continue <ArrowRight className="h-4 w-4" />
                </>
              )}
            </Button>
            <p className="text-center text-xs text-muted-foreground">
              Don&apos;t have a code? Ask someone on phew.run to invite you.
            </p>
            <Link
              to="/login"
              className="flex items-center justify-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              <ArrowLeft className="h-3 w-3" />
              Back to login
            </Link>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
