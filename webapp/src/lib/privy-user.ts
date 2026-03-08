import { getIdentityToken } from "@privy-io/react-auth";

const IDENTITY_TOKEN_ATTEMPTS = 2;
const IDENTITY_TOKEN_RETRY_DELAYS_MS = [180] as const;
const AUTH_PAYLOAD_READY_DELAYS_MS = [1200] as const;
const IDENTITY_TOKEN_ATTEMPT_TIMEOUT_MS = 280;
const OAUTH_IDENTITY_TOKEN_TIMEOUT_MS = 220;
const QUICK_IDENTITY_TOKEN_TIMEOUT_MS = 120;
const PRIVY_IDENTITY_429_COOLDOWN_MS = 10_000;
let privyAuthPayloadInFlight: { userId: string; promise: Promise<ResolvedPrivyAuthPayload> } | null =
  null;
let privyIdentityRateLimitedUntilMs = 0;
const privyIdentityRetryWaiters = new Map<number, (completed: boolean) => void>();
const RATE_LIMITED_TOKEN = Symbol("privy_identity_rate_limited");
type IdentityTokenAttemptResult = {
  token?: string;
  rateLimited: boolean;
};

type LinkedAccountLike = {
  type: string;
  address?: string;
  name?: string | null;
  username?: string | null;
};

export type PrivyUserLike = {
  id: string;
  email?: { address?: string } | null;
  google?: { name?: string | null } | null;
  twitter?: { name?: string | null; username?: string | null } | null;
  linkedAccounts?: LinkedAccountLike[] | null;
};

export type ResolvedPrivyAuthPayload = {
  user: PrivyUserLike;
  email?: string;
  name?: string;
  privyIdToken?: string;
};

async function waitFor(delayMs: number): Promise<boolean> {
  return await new Promise<boolean>((resolve) => {
    const timeoutId = window.setTimeout(() => {
      privyIdentityRetryWaiters.delete(timeoutId);
      resolve(true);
    }, delayMs);
    privyIdentityRetryWaiters.set(timeoutId, resolve);
  });
}

export function cancelPrivyIdentityRetryTimers(reason: string): void {
  if (privyIdentityRetryWaiters.size === 0) {
    return;
  }

  const waiters = Array.from(privyIdentityRetryWaiters.entries());
  privyIdentityRetryWaiters.clear();

  for (const [timeoutId, resolve] of waiters) {
    window.clearTimeout(timeoutId);
    resolve(false);
  }

  console.info("[AuthFlow] cancelled pending Privy identity retry timers", {
    reason,
    count: waiters.length,
  });
}

function getPrivyErrorMessage(error: unknown): string {
  if (typeof error === "string") {
    return error;
  }
  if (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof (error as { message?: unknown }).message === "string"
  ) {
    return (error as { message: string }).message;
  }
  return "";
}

function isPrivyRateLimitError(error: unknown): boolean {
  const message = getPrivyErrorMessage(error);
  return /429|too many requests|rate limit/i.test(message);
}

function getPrivyRateLimitRemainingMs(referenceTime = Date.now()): number {
  return Math.max(0, privyIdentityRateLimitedUntilMs - referenceTime);
}

export function getPrivyIdentityRateLimitRemainingMs(referenceTime = Date.now()): number {
  return getPrivyRateLimitRemainingMs(referenceTime);
}

async function getIdentityTokenWithin(timeoutMs: number): Promise<IdentityTokenAttemptResult> {
  const rateLimitRemainingMs = getPrivyRateLimitRemainingMs();
  if (rateLimitRemainingMs > 0) {
    console.warn("[AuthFlow] Privy identity token request skipped due to cooldown", {
      retryInMs: rateLimitRemainingMs,
    });
    return { token: undefined, rateLimited: true };
  }

  const raced = await Promise.race<string | undefined | typeof RATE_LIMITED_TOKEN>([
    getIdentityToken()
      .then((token) => (typeof token === "string" && token.length > 0 ? token : undefined))
      .catch((error) => {
        if (isPrivyRateLimitError(error)) {
          privyIdentityRateLimitedUntilMs = Date.now() + PRIVY_IDENTITY_429_COOLDOWN_MS;
          cancelPrivyIdentityRetryTimers("privy_429");
          console.warn("[AuthFlow] Privy identity provider returned 429", {
            cooldownMs: PRIVY_IDENTITY_429_COOLDOWN_MS,
            message: getPrivyErrorMessage(error),
          });
          return RATE_LIMITED_TOKEN;
        }
        return undefined;
      }),
    waitFor(timeoutMs).then(() => undefined),
  ]);

  if (raced === RATE_LIMITED_TOKEN) {
    return { token: undefined, rateLimited: true };
  }

  return {
    token: raced,
    rateLimited: false,
  };
}

function hasOAuthIdentity(user: PrivyUserLike): boolean {
  if (user.twitter?.username || user.twitter?.name) {
    return true;
  }

  return Boolean(
    user.linkedAccounts?.some((account) => account.type.endsWith("_oauth"))
  );
}

export async function getPrivyIdentityTokenFast(): Promise<IdentityTokenAttemptResult> {
  for (let attempt = 0; attempt < IDENTITY_TOKEN_ATTEMPTS; attempt += 1) {
    const result = await getIdentityTokenWithin(IDENTITY_TOKEN_ATTEMPT_TIMEOUT_MS);
    if (result.token || result.rateLimited) {
      return result;
    }

    const delayMs = IDENTITY_TOKEN_RETRY_DELAYS_MS[attempt];
    if (!delayMs) {
      continue;
    }

    console.info("[AuthFlow] Privy identity token retry scheduled", {
      attempt: attempt + 1,
      delayMs,
    });
    const completed = await waitFor(delayMs);
    if (!completed) {
      return {
        token: undefined,
        rateLimited: getPrivyRateLimitRemainingMs() > 0,
      };
    }
  }

  return { token: undefined, rateLimited: false };
}

export function getPrivyPrimaryEmail(user: PrivyUserLike): string | undefined {
  const directEmail = user.email?.address?.trim();
  if (directEmail) {
    return directEmail;
  }

  const linkedEmail = user.linkedAccounts
    ?.find((account) => account.type === "email")
    ?.address
    ?.trim();

  return linkedEmail || undefined;
}

export function getPrivyDisplayName(user: PrivyUserLike, email?: string): string | undefined {
  const googleName = user.google?.name?.trim();
  if (googleName) {
    return googleName;
  }

  const twitterName = user.twitter?.name?.trim();
  if (twitterName) {
    return twitterName;
  }

  const twitterUsername = user.twitter?.username?.trim();
  if (twitterUsername) {
    return twitterUsername;
  }

  const linkedName = user.linkedAccounts
    ?.find((account) => account.type.endsWith("_oauth"))
    ?.name
    ?.trim();
  if (linkedName) {
    return linkedName;
  }

  const linkedUsername = user.linkedAccounts
    ?.find((account) => account.type.endsWith("_oauth"))
    ?.username
    ?.trim();
  if (linkedUsername) {
    return linkedUsername;
  }

  if (email?.includes("@")) {
    return email.split("@")[0];
  }

  return undefined;
}

export async function resolvePrivyAuthPayload({
  user,
  getLatestUser,
  isTerminal,
}: {
  user: PrivyUserLike;
  getLatestUser?: () => PrivyUserLike | null | undefined;
  isTerminal?: () => boolean;
}): Promise<ResolvedPrivyAuthPayload> {
  const userId = user.id;
  if (privyAuthPayloadInFlight?.userId === userId) {
    return privyAuthPayloadInFlight.promise;
  }

  const resolutionPromise = (async (): Promise<ResolvedPrivyAuthPayload> => {
    let latestUser = getLatestUser?.() ?? user;
    let email = getPrivyPrimaryEmail(latestUser);
    let name = getPrivyDisplayName(latestUser, email);
    let sawRateLimit = false;

    const initialTokenTimeoutMs = hasOAuthIdentity(latestUser)
      ? OAUTH_IDENTITY_TOKEN_TIMEOUT_MS
      : QUICK_IDENTITY_TOKEN_TIMEOUT_MS;

    let initialTokenResult = await getIdentityTokenWithin(initialTokenTimeoutMs);
    let privyIdToken = initialTokenResult.token;
    sawRateLimit = sawRateLimit || initialTokenResult.rateLimited;
    if (!privyIdToken) {
      const fastTokenResult = await getPrivyIdentityTokenFast();
      privyIdToken = fastTokenResult.token;
      sawRateLimit = sawRateLimit || fastTokenResult.rateLimited;
    }
    if (privyIdToken) {
      return {
        user: latestUser,
        email,
        name,
        privyIdToken,
      };
    }

    for (const delayMs of AUTH_PAYLOAD_READY_DELAYS_MS) {
      if (sawRateLimit || getPrivyRateLimitRemainingMs() > 0 || isTerminal?.() === true) {
        console.info("[AuthFlow] finalizing retry suppressed due to privy_429", {
          delayMs,
          rateLimited: sawRateLimit || getPrivyRateLimitRemainingMs() > 0,
          terminal: isTerminal?.() === true,
        });
        break;
      }

      console.info("[AuthFlow] Privy identity still finalizing; retry scheduled", {
        delayMs,
      });
      const completed = await waitFor(delayMs);
      if (!completed) {
        break;
      }

      if (sawRateLimit || getPrivyRateLimitRemainingMs() > 0 || isTerminal?.() === true) {
        console.info("[AuthFlow] finalizing retry suppressed due to privy_429", {
          delayMs,
          rateLimited: sawRateLimit || getPrivyRateLimitRemainingMs() > 0,
          terminal: isTerminal?.() === true,
        });
        break;
      }

      latestUser = getLatestUser?.() ?? latestUser;
      email = getPrivyPrimaryEmail(latestUser);
      name = getPrivyDisplayName(latestUser, email);
      const delayedTokenResult = await getPrivyIdentityTokenFast();
      privyIdToken = delayedTokenResult.token;
      sawRateLimit = sawRateLimit || delayedTokenResult.rateLimited;

      if (privyIdToken) {
        break;
      }
    }

    if (sawRateLimit || getPrivyRateLimitRemainingMs() > 0 || isTerminal?.() === true) {
      throw new Error("Privy identity provider is rate limited");
    }

    return {
      user: latestUser,
      email,
      name,
      privyIdToken,
    };
  })();

  privyAuthPayloadInFlight = { userId, promise: resolutionPromise };

  try {
    return await resolutionPromise;
  } finally {
    if (privyAuthPayloadInFlight?.promise === resolutionPromise) {
      privyAuthPayloadInFlight = null;
    }
  }
}
