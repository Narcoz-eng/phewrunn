import React, { useEffect, useRef } from "react";
import { getIdentityToken, usePrivy } from "@privy-io/react-auth";
import { useAuth, syncPrivySession } from "@/lib/auth-client";
import { usePrivyAvailable } from "@/components/PrivyWalletProvider";

interface AuthInitializerProps {
  children: React.ReactNode;
}

type PrivyUserLike = {
  id: string;
  email?: { address?: string } | null;
  google?: { name?: string } | null;
  linkedAccounts?: Array<{ type: string; address?: string }> | null;
};

const AUTO_SYNC_COOLDOWN_MS = 2500;
const AUTO_SYNC_MAX_ATTEMPTS = 4;

function AuthInitializerInner({ children }: AuthInitializerProps) {
  const { ready, authenticated, user } = usePrivy();
  const { isAuthenticated, refetch } = useAuth();
  const syncInFlightRef = useRef(false);
  const attemptsRef = useRef(0);
  const lastAttemptAtRef = useRef(0);
  const lastSyncedPrivyUserRef = useRef<string | null>(null);

  useEffect(() => {
    if (!ready || !authenticated || !user) return;
    const pathname =
      typeof window !== "undefined" ? window.location.pathname : "";
    // Login page owns manual auth UX/sync; avoid duplicate sync attempts here.
    if (pathname === "/login") return;
    if (isAuthenticated) {
      attemptsRef.current = 0;
      lastSyncedPrivyUserRef.current = user.id;
      return;
    }
    if (syncInFlightRef.current) return;

    if (lastSyncedPrivyUserRef.current !== user.id) {
      attemptsRef.current = 0;
      lastAttemptAtRef.current = 0;
      lastSyncedPrivyUserRef.current = user.id;
    }

    if (attemptsRef.current >= AUTO_SYNC_MAX_ATTEMPTS) return;
    if (Date.now() - lastAttemptAtRef.current < AUTO_SYNC_COOLDOWN_MS) return;

    attemptsRef.current += 1;
    lastAttemptAtRef.current = Date.now();
    syncInFlightRef.current = true;

    void (async () => {
      try {
        const privyUser = user as PrivyUserLike;
        const privyIdToken = await getIdentityToken();
        const email =
          privyUser.email?.address ??
          privyUser.linkedAccounts?.find((account) => account.type === "email")?.address ??
          undefined;
        const name =
          privyUser.google?.name ??
          (typeof email === "string" && email.includes("@")
            ? email.split("@")[0]
            : undefined);

        await syncPrivySession(
          privyUser.id,
          email,
          name,
          privyIdToken ?? undefined
        );
        await refetch();
        attemptsRef.current = 0;
      } catch (error) {
        console.warn("[AuthInitializer] Privy session auto-sync failed", error);
      } finally {
        syncInFlightRef.current = false;
      }
    })();
  }, [authenticated, isAuthenticated, ready, refetch, user]);

  return <>{children}</>;
}

export function AuthInitializer({ children }: AuthInitializerProps) {
  const privyAvailable = usePrivyAvailable();
  if (!privyAvailable) {
    return <>{children}</>;
  }
  return <AuthInitializerInner>{children}</AuthInitializerInner>;
}
