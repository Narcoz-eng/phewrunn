import React, { useEffect, useRef } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { useAuth, syncPrivySession, registerPreLogoutHook } from "@/lib/auth-client";
import { usePrivyAvailable } from "@/components/PrivyWalletProvider";
import {
  getPrivyDisplayName,
  getPrivyIdentityTokenFast,
  getPrivyPrimaryEmail,
  type PrivyUserLike,
} from "@/lib/privy-user";

interface AuthInitializerProps {
  children: React.ReactNode;
}

const AUTO_SYNC_COOLDOWN_MS = 2500;
const AUTO_SYNC_MAX_ATTEMPTS = 4;

function AuthInitializerInner({ children }: AuthInitializerProps) {
  const { ready, authenticated, user, logout: privyLogout } = usePrivy();
  const { isAuthenticated, refetch } = useAuth();
  const syncInFlightRef = useRef(false);
  const attemptsRef = useRef(0);
  const lastAttemptAtRef = useRef(0);
  const lastSyncedPrivyUserRef = useRef<string | null>(null);

  useEffect(() => {
    const unregister = registerPreLogoutHook(async () => {
      try {
        await privyLogout();
      } catch (error) {
        console.warn("[AuthInitializer] Privy logout in pre-logout hook failed:", error);
      }
    });

    return unregister;
  }, [privyLogout]);

  useEffect(() => {
    if (!authenticated) {
      attemptsRef.current = 0;
      lastAttemptAtRef.current = 0;
      syncInFlightRef.current = false;
      lastSyncedPrivyUserRef.current = null;
    }
  }, [authenticated]);

  useEffect(() => {
    if (!ready || !authenticated || !user) return;
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
        const privyIdToken = await getPrivyIdentityTokenFast();
        const email = getPrivyPrimaryEmail(privyUser);
        const name = getPrivyDisplayName(privyUser, email);

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
