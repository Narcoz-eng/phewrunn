import { useEffect, useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useLocation, useNavigate } from "react-router-dom";
import { ArrowRight, AtSign, Loader2, LogOut, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { BrandLogo } from "@/components/BrandLogo";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth, useSession, updateCachedAuthUser } from "@/lib/auth-client";
import { api, ApiError } from "@/lib/api";
import {
  buildProfilePath,
  buildSuggestedProfileHandle,
  getProfileHandleValidationMessage,
  normalizeProfileHandleInput,
} from "@/lib/profile-path";

type ProfileUpdateResponse = {
  id: string;
  name: string;
  email: string;
  image: string | null;
  walletAddress: string | null;
  username: string | null;
  level: number;
  xp: number;
  bio: string | null;
  isVerified?: boolean;
  isAdmin?: boolean;
  tradeFeeRewardsEnabled?: boolean;
  tradeFeeShareBps?: number;
  tradeFeePayoutAddress?: string | null;
  createdAt: string;
};

export default function HandleOnboarding() {
  const navigate = useNavigate();
  const location = useLocation();
  const { data: session, isPending, hasLiveSession } = useSession();
  const { signOut } = useAuth();
  const [handle, setHandle] = useState("");
  const redirectTarget = useMemo(() => {
    const from =
      typeof location.state === "object" &&
      location.state !== null &&
      "from" in location.state &&
      typeof (location.state as { from?: unknown }).from === "string"
        ? ((location.state as { from?: string }).from ?? "")
        : "";

    if (!from || from === "/welcome" || from === "/login") {
      return "/";
    }

    return from;
  }, [location.state]);

  useEffect(() => {
    if (!session?.user || !hasLiveSession) {
      return;
    }

    if (session.user.username) {
      navigate(redirectTarget, { replace: true });
      return;
    }

    setHandle((current) =>
      current ||
      buildSuggestedProfileHandle(
        [session.user.name, session.user.email?.split("@")[0]],
        session.user.id
      )
    );
  }, [hasLiveSession, navigate, redirectTarget, session?.user]);

  const normalizedHandle = normalizeProfileHandleInput(handle);
  const validationMessage = getProfileHandleValidationMessage(normalizedHandle);

  const saveHandleMutation = useMutation({
    mutationFn: async (nextHandle: string) =>
      api.patch<ProfileUpdateResponse>("/api/users/me", { username: nextHandle }),
    onSuccess: (updatedUser) => {
      updateCachedAuthUser(updatedUser);
      toast.success("Handle locked in");
      navigate(redirectTarget, { replace: true });
    },
    onError: (error) => {
      const message =
        error instanceof ApiError && error.message
          ? error.message
          : error instanceof Error
            ? error.message
            : "Failed to save handle";
      toast.error(message);
    },
  });

  const handleSubmit = () => {
    if (!hasLiveSession) {
      toast.info("Still finalizing sign-in. Saving your handle will unlock in a moment.");
      return;
    }

    if (validationMessage) {
      toast.error(validationMessage);
      return;
    }

    saveHandleMutation.mutate(normalizedHandle);
  };

  if (isPending || !session?.user || !hasLiveSession) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="text-sm text-muted-foreground">
            {session?.user ? "Finalizing your account..." : "Preparing your account..."}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(153,230,200,0.18),_transparent_38%),linear-gradient(180deg,#0b0f10_0%,#111617_100%)] text-white">
      <header className="border-b border-white/10 bg-black/20 backdrop-blur-xl">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-5 py-3.5 sm:px-6">
          <BrandLogo size="sm" showTagline />
          <div className="flex items-center gap-3">
            <ThemeToggle size="icon" className="h-9 w-9 border-white/10 bg-white/5 text-white hover:bg-white/10" />
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => void signOut()}
              className="gap-1.5 text-white/75 hover:bg-white/10 hover:text-white"
            >
              <LogOut className="h-4 w-4" />
              Switch account
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto flex min-h-[calc(100vh-65px)] max-w-5xl items-center px-5 py-10 sm:px-6">
        <div className="grid w-full gap-8 lg:grid-cols-[1.05fr_0.95fr]">
          <section className="space-y-5">
            <div className="inline-flex items-center gap-2 rounded-full border border-emerald-300/20 bg-emerald-300/10 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.18em] text-emerald-100/90">
              <Sparkles className="h-3.5 w-3.5" />
              First-time setup
            </div>
            <div className="space-y-3">
              <h1 className="max-w-xl text-4xl font-black tracking-tight text-white sm:text-5xl">
                Pick the handle your profile will live on.
              </h1>
              <p className="max-w-lg text-sm leading-relaxed text-white/70 sm:text-base">
                This is the path people will open, follow, and share. Keep it clean.
                You can change it later, but only once every 7 days.
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-3xl border border-white/10 bg-white/5 p-4 backdrop-blur-xl">
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-white/45">
                  Profile URL
                </p>
                <p className="mt-2 text-xl font-semibold text-emerald-100">
                  phew.run/{normalizedHandle || "your_handle"}
                </p>
                <p className="mt-2 text-sm text-white/60">
                  This becomes your public profile link.
                </p>
              </div>
              <div className="rounded-3xl border border-white/10 bg-white/5 p-4 backdrop-blur-xl">
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-white/45">
                  What works
                </p>
                <p className="mt-2 text-base font-semibold text-white">Lowercase, numbers, underscores</p>
                <p className="mt-2 text-sm text-white/60">
                  Keep it between 3 and 20 characters.
                </p>
              </div>
            </div>
          </section>

          <section className="rounded-[32px] border border-white/10 bg-black/35 p-5 shadow-[0_30px_90px_-40px_rgba(0,0,0,0.85)] backdrop-blur-2xl sm:p-6">
            <div className="space-y-5">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-white/45">
                  Creator handle
                </p>
                <h2 className="mt-2 text-2xl font-bold text-white">Finish sign-in</h2>
                <p className="mt-2 text-sm text-white/65">
                  @{session.user.name || session.user.email?.split("@")[0] || "creator"} will appear under this handle.
                </p>
              </div>

              <div className="space-y-3">
                <label className="block text-sm font-medium text-white/80" htmlFor="profile-handle">
                  Handle
                </label>
                <div className="flex items-center gap-3 rounded-[24px] border border-white/10 bg-white/5 px-4 py-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
                  <AtSign className="h-4 w-4 text-emerald-200/80" />
                  <Input
                    id="profile-handle"
                    value={handle}
                    onChange={(event) => setHandle(normalizeProfileHandleInput(event.target.value))}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        handleSubmit();
                      }
                    }}
                    autoFocus
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    placeholder="your_handle"
                    className="h-auto border-0 bg-transparent px-0 py-0 text-base text-white shadow-none focus-visible:ring-0"
                  />
                </div>
                <p className="text-xs text-white/50">
                  Use lowercase letters, numbers, and underscores. No spaces in the final URL.
                </p>
                {validationMessage ? (
                  <p className="text-xs font-medium text-amber-200">{validationMessage}</p>
                ) : (
                  <p className="text-xs font-medium text-emerald-200">
                    Profile preview: {buildProfilePath(session.user.id, normalizedHandle)}
                  </p>
                )}
              </div>

              <Button
                type="button"
                onClick={handleSubmit}
                disabled={saveHandleMutation.isPending || !!validationMessage}
                className="h-14 w-full justify-between rounded-[22px] bg-[linear-gradient(135deg,#c7f5a6_0%,#98e9dc_100%)] px-5 text-sm font-semibold text-slate-950 shadow-[0_24px_60px_-30px_rgba(152,233,220,0.75)] hover:brightness-105"
              >
                <span className="flex items-center gap-2">
                  {saveHandleMutation.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Sparkles className="h-4 w-4" />
                  )}
                  Save handle and continue
                </span>
                <ArrowRight className="h-4 w-4" />
              </Button>
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}
