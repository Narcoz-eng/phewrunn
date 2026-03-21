import { useState, useEffect } from "react";
import { useNavigate, useSearchParams, Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { KeyRound, ArrowRight, ArrowLeft } from "lucide-react";
import { clearPrivySyncFailureState, setPrivyAuthBootstrapState } from "@/lib/auth-client";

const PENDING_CODE_KEY = "phew.pending-invite-code";

export default function AccessCodeEntry() {
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

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

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = code.trim().toUpperCase();
    if (!trimmed) {
      setError("Please enter an invite or access code.");
      return;
    }
    sessionStorage.setItem(PENDING_CODE_KEY, trimmed);
    // Navigate back to login — the code will be picked up on next privy-sync
    clearPrivySyncFailureState();
    setPrivyAuthBootstrapState("idle", {
      owner: "system",
      mode: "system",
      userId: null,
      detail: "invite/access code updated",
      debugCode: "access_code_submitted",
    });
    navigate("/login", { replace: true });
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
            <Button type="submit" className="w-full gap-2">
              Continue <ArrowRight className="h-4 w-4" />
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
