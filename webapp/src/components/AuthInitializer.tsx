import React, { useEffect, useRef } from "react";
import { usePrivy } from "@privy-io/react-auth";
import {
  ensureBackendSessionReady,
  useAuth,
  syncPrivySession,
  registerPreLogoutHook,
  hasStoredAuthTokenHint,
  isExplicitLogoutCoolingDown,
  usePrivySyncFailureSnapshot,
} from "@/lib/auth-client";
import { usePrivyAvailable } from "@/components/PrivyWalletProvider";
import {
  resolvePrivyAuthPayload,
  type PrivyUserLike,
} from "@/lib/privy-user";
import { clearPrivyLoginIntent } from "@/lib/privy-login-intent";

interface AuthInitializerProps {
  children: React.ReactNode;
}

const AUTO_SYNC_COOLDOWN_MS = 3000;
const AUTO_SYNC_MAX_ATTEMPTS = 6;

function AuthInitializerInner({ children }: AuthInitializerProps) {
  const { ready, authenticated, user, logout: privyLogout } = usePrivy();
  const { isAuthenticated, hasLiveSession, refetch } = useAuth();
  const syncInFlightRef = useRef(false);
  const attemptsRef = useRef(0);
  const lastAttemptAtRef = useRef(0);
  const lastSyncedPrivyUserRef = useRef<string | null>(null);
  const latestPrivyUserRef = useRef<PrivyUserLike | null>(null);
  const privySyncFailure = usePrivySyncFailureSnapshot();

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
    latestPrivyUserRef.current = user ? (user as PrivyUserLike) : null;
  }, [user]);

  useEffect(() => {
    if (!isAuthenticated) {
      return;
    }

    clearPrivyLoginIntent();
  }, [isAuthenticated]);

  useEffect(() => {
    if (!authenticated) {
      attemptsRef.current = 0;
      lastAttemptAtRef.current = 0;
      syncInFlightRef.current = false;
      lastSyncedPrivyUserRef.current = null;
      latestPrivyUserRef.current = null;
    }
  }, [authenticated]);

  useEffect(() => {
    if (!ready || !authenticated || !user) return;
    if (isExplicitLogoutCoolingDown()) return;
    if (
      privySyncFailure &&
      Date.now() - privySyncFailure.recordedAt < AUTO_SYNC_COOLDOWN_MS
    ) {
      return;
    }
    const shouldRepairMissingFallbackToken = isAuthenticated && !hasStoredAuthTokenHint();
    if (hasLiveSession && !shouldRepairMissingFallbackToken) {
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
        if (isAuthenticated || hasStoredAuthTokenHint()) {
          const recoveredUser = await ensureBackendSessionReady(user.id, 1800);
          if (recoveredUser) {
            await refetch();
            attemptsRef.current = 0;
            return;
          }
        }

        const resolvedPayload = await resolvePrivyAuthPayload({
          user: user as PrivyUserLike,
          getLatestUser: () => latestPrivyUserRef.current,
        });

        await syncPrivySession(
          resolvedPayload.user.id,
          resolvedPayload.email,
          resolvedPayload.name,
          resolvedPayload.privyIdToken ?? undefined
        );
        await refetch();
        attemptsRef.current = 0;
      } catch (error) {
        console.warn("[AuthInitializer] Privy session auto-sync failed", error);
      } finally {
        syncInFlightRef.current = false;
      }
    })();
  }, [authenticated, hasLiveSession, isAuthenticated, privySyncFailure, ready, refetch, user]);

  return <>{children}</>;
}

export function AuthInitializer({ children }: AuthInitializerProps) {
  const privyAvailable = usePrivyAvailable();
  if (!privyAvailable) {
    return <>{children}</>;
  }
  return <AuthInitializerInner>{children}</AuthInitializerInner>;
}
