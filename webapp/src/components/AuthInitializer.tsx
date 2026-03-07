import React, { useEffect, useRef } from "react";
import { usePrivy } from "@privy-io/react-auth";
import {
  clearPrivyAuthBootstrapState,
  useAuth,
  syncPrivySession,
  registerPreLogoutHook,
  isExplicitLogoutCoolingDown,
  usePrivySyncFailureSnapshot,
  isPrivyAuthBootstrapPending,
  readPrivyAuthBootstrapSnapshot,
  setPrivyAuthBootstrapState,
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

const AUTO_SYNC_COOLDOWN_MS = 8000;
const AUTO_SYNC_RETRYABLE_FAILURE_COOLDOWN_MS = 6000;
const AUTO_SYNC_MAX_ATTEMPTS = 2;
const RETRYABLE_AUTO_SYNC_FAILURE_PATTERN =
  /finalizing|identity verification|identity token|rate limit|too many requests|429/i;

function AuthInitializerInner({ children }: AuthInitializerProps) {
  const { ready, authenticated, user, logout: privyLogout } = usePrivy();
  const { isAuthenticated, hasLiveSession } = useAuth();
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
      clearPrivyAuthBootstrapState();
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
    if (hasLiveSession) {
      attemptsRef.current = 0;
      lastSyncedPrivyUserRef.current = user.id;
      return;
    }
    if (isPrivyAuthBootstrapPending()) return;
    if (syncInFlightRef.current) return;

    if (lastSyncedPrivyUserRef.current !== user.id) {
      attemptsRef.current = 0;
      lastAttemptAtRef.current = 0;
      lastSyncedPrivyUserRef.current = user.id;
    }

    const bootstrapSnapshot = readPrivyAuthBootstrapSnapshot();
    const lastFailureWasRetryable =
      bootstrapSnapshot?.phase === "sync_failed" &&
      RETRYABLE_AUTO_SYNC_FAILURE_PATTERN.test(bootstrapSnapshot.detail ?? "");
    const cooldownMs = lastFailureWasRetryable
      ? AUTO_SYNC_RETRYABLE_FAILURE_COOLDOWN_MS
      : AUTO_SYNC_COOLDOWN_MS;

    if (attemptsRef.current >= AUTO_SYNC_MAX_ATTEMPTS) return;
    if (Date.now() - lastAttemptAtRef.current < cooldownMs) return;

    attemptsRef.current += 1;
    lastAttemptAtRef.current = Date.now();
    syncInFlightRef.current = true;

    void (async () => {
      try {
        setPrivyAuthBootstrapState("awaiting_identity_token", {
          source: "auto",
          userId: user.id,
          detail: "privy user ready",
        });

        const resolvedPayload = await resolvePrivyAuthPayload({
          user: user as PrivyUserLike,
          getLatestUser: () => latestPrivyUserRef.current,
        });

        if (!resolvedPayload.privyIdToken) {
          throw new Error("Privy identity verification is still finalizing");
        }

        await syncPrivySession(
          resolvedPayload.user.id,
          resolvedPayload.email,
          resolvedPayload.name,
          resolvedPayload.privyIdToken ?? undefined
        );
        attemptsRef.current = 0;
      } catch (error) {
        console.warn("[AuthInitializer] Privy session auto-sync failed", error);
        setPrivyAuthBootstrapState("sync_failed", {
          source: "auto",
          userId: user.id,
          detail: error instanceof Error ? error.message : String(error),
        });
      } finally {
        syncInFlightRef.current = false;
      }
    })();
  }, [authenticated, hasLiveSession, isAuthenticated, privySyncFailure, ready, user]);

  return <>{children}</>;
}

export function AuthInitializer({ children }: AuthInitializerProps) {
  const privyAvailable = usePrivyAvailable();
  if (!privyAvailable) {
    return <>{children}</>;
  }
  return <AuthInitializerInner>{children}</AuthInitializerInner>;
}
