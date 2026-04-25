import { useEffect, useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useLocation, useNavigate } from "react-router-dom";
import { ArrowRight, AtSign, Loader2, LogOut, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { LivePlatformPreview } from "@/components/login/LivePlatformPreview";
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
      toast.info("Signing you in...");
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
    <div className="min-h-screen overflow-hidden bg-background text-white">
      <div className="fixed inset-0 z-0 overflow-hidden">
        <LivePlatformPreview />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(169,255,52,0.06),transparent_24%),linear-gradient(180deg,rgba(2,5,7,0.42),rgba(2,5,7,0.92))]" />
        <div className="absolute inset-0 bg-black/20 backdrop-blur-[2px]" />
      </div>

      <main className="relative z-10 flex min-h-screen items-center justify-center px-5 py-10 sm:px-6">
        <div className="w-full max-w-[460px]">
          <section className="rounded-[28px] border border-white/12 bg-[linear-gradient(180deg,rgba(6,10,12,0.84),rgba(3,7,9,0.95))] p-6 shadow-[0_34px_96px_-52px_rgba(0,0,0,0.95)] backdrop-blur-3xl sm:p-7">
            <div className="space-y-5">
              <div>
                <div className="inline-flex items-center gap-2 rounded-full border border-lime-300/18 bg-lime-300/10 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.22em] text-lime-100">
                  <Sparkles className="h-3.5 w-3.5" />
                  First-time setup
                </div>
                <h1 className="mt-4 text-2xl font-semibold tracking-[-0.04em] text-white">Claim your handle</h1>
                <p className="mt-2 text-sm text-white/65">
                  Choose the profile path people will open, follow, and share.
                </p>
              </div>

              <div className="space-y-3">
                <label className="block text-sm font-medium text-white/80" htmlFor="profile-handle">
                  Handle
                </label>
                <div className="flex items-center gap-3 rounded-[18px] border border-white/10 bg-white/[0.04] px-4 py-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
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
                  Lowercase letters, numbers, and underscores. Between 3 and 20 characters.
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
                className="h-14 w-full justify-between rounded-[18px] bg-[linear-gradient(135deg,#c7f5a6_0%,#98e9dc_100%)] px-5 text-sm font-semibold text-slate-950 shadow-[0_24px_60px_-30px_rgba(152,233,220,0.75)] hover:brightness-105"
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

              <button
                type="button"
                onClick={() => void signOut()}
                className="mx-auto flex items-center gap-1.5 text-xs text-white/42 transition hover:text-lime-200"
              >
                <LogOut className="h-3.5 w-3.5" />
                Switch account
              </button>
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}
