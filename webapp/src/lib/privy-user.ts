import { getIdentityToken } from "@privy-io/react-auth";

const AUTH_PAYLOAD_READY_DELAYS_MS = [10_000] as const;
const IDENTITY_TOKEN_SETTLE_GRACE_MS = 1500;
const IDENTITY_TOKEN_ATTEMPT_TIMEOUT_MS = 280;
const OAUTH_IDENTITY_TOKEN_TIMEOUT_MS = 220;
const QUICK_IDENTITY_TOKEN_TIMEOUT_MS = 120;
const PRIVY_IDENTITY_429_COOLDOWN_MS = 10_000;
let privyAuthPayloadInFlight: { userId: string; promise: Promise<ResolvedPrivyAuthPayload> } | null =
  null;
let privyIdentityRateLimitedUntilMs = 0;
const privyIdentityRetryWaiters = new Map<number, (completed: boolean) => void>();
let pendingPrivyIdentityRequestCount = 0;
let pendingPrivyIdentityTokenPromise: Promise<string | undefined | typeof RATE_LIMITED_TOKEN> | null =
  null;
const privyIdentitySettleWaiters = new Set<() => void>();
const RATE_LIMITED_TOKEN = Symbol("privy_identity_rate_limited");
let privyUsersMeFetchInstrumentationInstalled = false;

export type PrivyIdentityDebugCaller =
  | "AuthInitializer"
  | "usePrivyLogin"
  | "controller_retry"
  | "component_mount"
  | "manual_user_action"
  | "system";

export type PrivyIdentityDebugContext = {
  attemptId: string;
  owner: string;
  mode: string;
  trigger: string | null;
  userId: string;
  bootstrapAttempt: number;
  totalAttempts: number;
  initialCaller: PrivyIdentityDebugCaller;
};

type ActivePrivyIdentityDebugContext = PrivyIdentityDebugContext & {
  getIdentityTokenCallCount: number;
  usersMeRequestCount: number;
  currentCaller: PrivyIdentityDebugCaller;
};

let activePrivyIdentityDebugContext: ActivePrivyIdentityDebugContext | null = null;
type IdentityTokenAttemptResult = {
  token?: string;
  rateLimited: boolean;
  timedOut?: boolean;
  pendingPromise?: Promise<string | undefined | typeof RATE_LIMITED_TOKEN>;
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
  pendingPrivyIdTokenPromise?: Promise<string | undefined>;
  tokenResolution?: "available" | "pending" | "empty";
  tokenLocalCheck?: {
    tokenLength: number;
    tokenExpired: boolean;
    tokenInvalid: boolean;
  } | null;
};

function inspectPrivyIdentityToken(token: string | undefined): {
  tokenLength: number;
  tokenExpired: boolean;
  tokenInvalid: boolean;
} | null {
  if (typeof token !== "string" || token.length === 0) {
    return null;
  }

  const tokenLength = token.length;
  const parts = token.split(".");
  if (parts.length < 2) {
    return {
      tokenLength,
      tokenExpired: false,
      tokenInvalid: true,
    };
  }

  try {
    const normalizedPayload = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const paddedPayload = normalizedPayload.padEnd(
      normalizedPayload.length + ((4 - (normalizedPayload.length % 4)) % 4),
      "="
    );
    const payloadJson = atob(paddedPayload);
    const payload = JSON.parse(payloadJson) as { exp?: unknown };
    const exp =
      typeof payload.exp === "number" && Number.isFinite(payload.exp) ? payload.exp : null;

    return {
      tokenLength,
      tokenExpired: exp !== null ? exp * 1000 <= Date.now() : false,
      tokenInvalid: false,
    };
  } catch {
    return {
      tokenLength,
      tokenExpired: false,
      tokenInvalid: true,
    };
  }
}

function normalizePendingPrivyIdentityTokenPromise(
  pendingPromise: Promise<string | undefined | typeof RATE_LIMITED_TOKEN>
): Promise<string | undefined> {
  return pendingPromise.then((value) => {
    if (value === RATE_LIMITED_TOKEN) {
      throw new Error("Privy identity provider is rate limited");
    }
    return typeof value === "string" && value.length > 0 ? value : undefined;
  });
}

function getFetchUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") {
    return input;
  }
  if (input instanceof URL) {
    return input.toString();
  }
  if (typeof Request !== "undefined" && input instanceof Request) {
    return input.url;
  }
  return String(input);
}

function ensurePrivyUsersMeFetchInstrumentation(): void {
  if (
    privyUsersMeFetchInstrumentationInstalled ||
    typeof window === "undefined" ||
    typeof window.fetch !== "function"
  ) {
    return;
  }

  const nativeFetch = window.fetch.bind(window);
  window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = getFetchUrl(input);
    const isPrivyUsersMe = url.startsWith("https://auth.privy.io/api/v1/users/me");
    if (!isPrivyUsersMe) {
      return nativeFetch(input, init);
    }

    const context = activePrivyIdentityDebugContext;
    const requestCount = context ? (context.usersMeRequestCount += 1) : null;
    console.info("[AuthFlow] Privy updateUserAndIdToken/users/me request started", {
      attemptId: context?.attemptId ?? null,
      caller: context?.currentCaller ?? "system",
      owner: context?.owner ?? null,
      mode: context?.mode ?? null,
      trigger: context?.trigger ?? null,
      userId: context?.userId ?? null,
      bootstrapAttempt: context?.bootstrapAttempt ?? null,
      totalAttempts: context?.totalAttempts ?? null,
      usersMeRequestCount: requestCount,
    });

    try {
      const response = await nativeFetch(input, init);
      console.info("[AuthFlow] Privy updateUserAndIdToken/users/me response", {
        attemptId: context?.attemptId ?? null,
        caller: context?.currentCaller ?? "system",
        status: response.status,
        usersMeRequestCount: requestCount,
      });
      return response;
    } catch (error) {
      console.warn("[AuthFlow] Privy updateUserAndIdToken/users/me request failed", {
        attemptId: context?.attemptId ?? null,
        caller: context?.currentCaller ?? "system",
        usersMeRequestCount: requestCount,
        message: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }) as typeof window.fetch;

  privyUsersMeFetchInstrumentationInstalled = true;
}

function beginPrivyIdentityDebugContext(
  context: PrivyIdentityDebugContext | undefined,
  caller: PrivyIdentityDebugCaller
): void {
  if (!context) {
    return;
  }

  ensurePrivyUsersMeFetchInstrumentation();

  if (!activePrivyIdentityDebugContext || activePrivyIdentityDebugContext.attemptId !== context.attemptId) {
    activePrivyIdentityDebugContext = {
      ...context,
      currentCaller: caller,
      getIdentityTokenCallCount: 0,
      usersMeRequestCount: 0,
    };
    console.info("[AuthFlow] Privy identity attempt registered", {
      attemptId: context.attemptId,
      owner: context.owner,
      mode: context.mode,
      trigger: context.trigger,
      initialCaller: context.initialCaller,
      userId: context.userId,
      bootstrapAttempt: context.bootstrapAttempt,
      totalAttempts: context.totalAttempts,
    });
    return;
  }

  activePrivyIdentityDebugContext = {
    ...activePrivyIdentityDebugContext,
    ...context,
    currentCaller: caller,
  };
}

function finishPrivyIdentityDebugContext(
  context: PrivyIdentityDebugContext | undefined,
  outcome: string
): void {
  if (!context || activePrivyIdentityDebugContext?.attemptId !== context.attemptId) {
    return;
  }

  console.info("[AuthFlow] Privy identity attempt summary", {
    attemptId: activePrivyIdentityDebugContext.attemptId,
    owner: activePrivyIdentityDebugContext.owner,
    mode: activePrivyIdentityDebugContext.mode,
    trigger: activePrivyIdentityDebugContext.trigger,
    userId: activePrivyIdentityDebugContext.userId,
    bootstrapAttempt: activePrivyIdentityDebugContext.bootstrapAttempt,
    totalAttempts: activePrivyIdentityDebugContext.totalAttempts,
    getIdentityTokenCallCount: activePrivyIdentityDebugContext.getIdentityTokenCallCount,
    usersMeRequestCount: activePrivyIdentityDebugContext.usersMeRequestCount,
    outcome,
  });

  activePrivyIdentityDebugContext = null;
}

function recordPrivyGetIdentityTokenCall(
  context: PrivyIdentityDebugContext | undefined,
  caller: PrivyIdentityDebugCaller,
  reusedPending: boolean
): void {
  beginPrivyIdentityDebugContext(context, caller);

  if (activePrivyIdentityDebugContext && !reusedPending) {
    activePrivyIdentityDebugContext.getIdentityTokenCallCount += 1;
  }

  console.info("[AuthFlow] Privy getIdentityToken call started", {
    attemptId: activePrivyIdentityDebugContext?.attemptId ?? null,
    caller,
    owner: activePrivyIdentityDebugContext?.owner ?? null,
    mode: activePrivyIdentityDebugContext?.mode ?? null,
    trigger: activePrivyIdentityDebugContext?.trigger ?? null,
    userId: activePrivyIdentityDebugContext?.userId ?? null,
    bootstrapAttempt: activePrivyIdentityDebugContext?.bootstrapAttempt ?? null,
    totalAttempts: activePrivyIdentityDebugContext?.totalAttempts ?? null,
    getIdentityTokenCallCount:
      activePrivyIdentityDebugContext?.getIdentityTokenCallCount ?? 0,
    reusedPending,
  });
}

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

function notifyPrivyIdentityRequestSettled(): void {
  if (pendingPrivyIdentityRequestCount > 0) {
    return;
  }

  const waiters = Array.from(privyIdentitySettleWaiters);
  privyIdentitySettleWaiters.clear();
  for (const waiter of waiters) {
    waiter();
  }
}

async function waitForOutstandingPrivyIdentityRequests(timeoutMs: number): Promise<boolean> {
  if (pendingPrivyIdentityRequestCount === 0) {
    return true;
  }

  return await new Promise<boolean>((resolve) => {
    const finish = (completed: boolean) => {
      window.clearTimeout(timeoutId);
      privyIdentitySettleWaiters.delete(onSettled);
      resolve(completed);
    };

    const onSettled = () => {
      if (pendingPrivyIdentityRequestCount === 0) {
        finish(true);
      }
    };

    const timeoutId = window.setTimeout(() => finish(false), timeoutMs);
    privyIdentitySettleWaiters.add(onSettled);
  });
}

export function getPrivyIdentityRateLimitRemainingMs(referenceTime = Date.now()): number {
  return getPrivyRateLimitRemainingMs(referenceTime);
}

function getOrStartPrivyIdentityTokenPromise():
  | Promise<string | undefined | typeof RATE_LIMITED_TOKEN> {
  if (pendingPrivyIdentityTokenPromise) {
    console.info("[AuthFlow] reusing pending Privy identity token request");
    return pendingPrivyIdentityTokenPromise;
  }

  pendingPrivyIdentityRequestCount += 1;
  const debugContextSnapshot = activePrivyIdentityDebugContext
    ? {
        attemptId: activePrivyIdentityDebugContext.attemptId,
        caller: activePrivyIdentityDebugContext.currentCaller,
        owner: activePrivyIdentityDebugContext.owner,
        mode: activePrivyIdentityDebugContext.mode,
        trigger: activePrivyIdentityDebugContext.trigger,
        userId: activePrivyIdentityDebugContext.userId,
        bootstrapAttempt: activePrivyIdentityDebugContext.bootstrapAttempt,
        totalAttempts: activePrivyIdentityDebugContext.totalAttempts,
      }
    : null;
  const tokenPromise = getIdentityToken()
    .then((token) => {
      const normalizedToken = typeof token === "string" && token.length > 0 ? token : undefined;
      const tokenLocalCheck = inspectPrivyIdentityToken(normalizedToken);
      console.info("[AuthFlow] Privy getIdentityToken resolved", {
        attemptId: debugContextSnapshot?.attemptId ?? null,
        caller: debugContextSnapshot?.caller ?? "system",
        owner: debugContextSnapshot?.owner ?? null,
        mode: debugContextSnapshot?.mode ?? null,
        trigger: debugContextSnapshot?.trigger ?? null,
        userId: debugContextSnapshot?.userId ?? null,
        bootstrapAttempt: debugContextSnapshot?.bootstrapAttempt ?? null,
        totalAttempts: debugContextSnapshot?.totalAttempts ?? null,
        returnedTokenString: typeof token === "string",
        tokenLengthGreaterThanZero: typeof token === "string" ? token.length > 0 : false,
        returnedEmptyToken:
          typeof token !== "string" || token.trim().length === 0,
        tokenLength: tokenLocalCheck?.tokenLength ?? 0,
        tokenExpired: tokenLocalCheck?.tokenExpired ?? false,
        tokenInvalid: tokenLocalCheck?.tokenInvalid ?? false,
      });
      return normalizedToken;
    })
    .catch((error) => {
      console.warn("[AuthFlow] Privy getIdentityToken threw", {
        attemptId: debugContextSnapshot?.attemptId ?? null,
        caller: debugContextSnapshot?.caller ?? "system",
        owner: debugContextSnapshot?.owner ?? null,
        mode: debugContextSnapshot?.mode ?? null,
        trigger: debugContextSnapshot?.trigger ?? null,
        userId: debugContextSnapshot?.userId ?? null,
        bootstrapAttempt: debugContextSnapshot?.bootstrapAttempt ?? null,
        totalAttempts: debugContextSnapshot?.totalAttempts ?? null,
        message: getPrivyErrorMessage(error),
      });
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
    })
    .finally(() => {
      if (pendingPrivyIdentityTokenPromise === tokenPromise) {
        pendingPrivyIdentityTokenPromise = null;
      }
      pendingPrivyIdentityRequestCount = Math.max(0, pendingPrivyIdentityRequestCount - 1);
      notifyPrivyIdentityRequestSettled();
    });

  pendingPrivyIdentityTokenPromise = tokenPromise;
  return tokenPromise;
}

async function getIdentityTokenWithin(
  timeoutMs: number,
  context?: PrivyIdentityDebugContext,
  caller: PrivyIdentityDebugCaller = "system"
): Promise<IdentityTokenAttemptResult> {
  const rateLimitRemainingMs = getPrivyRateLimitRemainingMs();
  if (rateLimitRemainingMs > 0) {
    console.warn("[AuthFlow] Privy identity token request skipped due to cooldown", {
      attemptId: context?.attemptId ?? null,
      caller,
      retryInMs: rateLimitRemainingMs,
    });
    return { token: undefined, rateLimited: true };
  }

  const hadPendingPromise = pendingPrivyIdentityTokenPromise !== null;
  recordPrivyGetIdentityTokenCall(context, caller, hadPendingPromise);
  const tokenPromise = getOrStartPrivyIdentityTokenPromise();
  let tokenPromiseSettled = false;
  const trackedTokenPromise = tokenPromise.then((value) => {
    tokenPromiseSettled = true;
    return value;
  });

  const raced = await Promise.race<string | undefined | typeof RATE_LIMITED_TOKEN>([
    trackedTokenPromise,
    waitFor(timeoutMs).then(() => undefined),
  ]);

  if (raced === RATE_LIMITED_TOKEN) {
    return { token: undefined, rateLimited: true };
  }

  if (!tokenPromiseSettled) {
    return {
      token: undefined,
      rateLimited: false,
      timedOut: true,
      pendingPromise: tokenPromise,
    };
  }

  return {
    token: raced,
    rateLimited: false,
  };
}

async function waitForPendingIdentityTokenResult(
  pendingPromise: Promise<string | undefined | typeof RATE_LIMITED_TOKEN>,
  timeoutMs: number
): Promise<IdentityTokenAttemptResult> {
  const settled = await Promise.race<string | undefined | typeof RATE_LIMITED_TOKEN | null>([
    pendingPromise,
    waitFor(timeoutMs).then(() => null),
  ]);

  if (settled === RATE_LIMITED_TOKEN) {
    return { token: undefined, rateLimited: true };
  }

  if (typeof settled === "string" && settled.length > 0) {
    return {
      token: settled,
      rateLimited: false,
    };
  }

  if (settled === null) {
    return {
      token: undefined,
      rateLimited: getPrivyRateLimitRemainingMs() > 0,
      timedOut: true,
      pendingPromise,
    };
  }

  return {
    token: undefined,
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
  let result = await getIdentityTokenWithin(
    IDENTITY_TOKEN_ATTEMPT_TIMEOUT_MS,
    undefined,
    "controller_retry"
  );
  if (result.token || result.rateLimited) {
    return result;
  }

  if (result.timedOut && result.pendingPromise) {
    console.info("[AuthFlow] awaiting pending Privy identity token request before retry", {
      attempt: 1,
      settleGraceMs: IDENTITY_TOKEN_SETTLE_GRACE_MS,
    });
    result = await waitForPendingIdentityTokenResult(
      result.pendingPromise,
      IDENTITY_TOKEN_SETTLE_GRACE_MS
    );
  }

  return result;
}

async function getPrivyIdentityTokenFastWithContext(
  context: PrivyIdentityDebugContext | undefined,
  caller: PrivyIdentityDebugCaller
): Promise<IdentityTokenAttemptResult> {
  let result = await getIdentityTokenWithin(
    IDENTITY_TOKEN_ATTEMPT_TIMEOUT_MS,
    context,
    caller
  );
  if (result.token || result.rateLimited) {
    return result;
  }

  if (result.timedOut && result.pendingPromise) {
    console.info("[AuthFlow] awaiting pending Privy identity token request before retry", {
      attempt: 1,
      settleGraceMs: IDENTITY_TOKEN_SETTLE_GRACE_MS,
      attemptId: context?.attemptId ?? null,
      caller,
    });
    result = await waitForPendingIdentityTokenResult(
      result.pendingPromise,
      IDENTITY_TOKEN_SETTLE_GRACE_MS
    );
  }

  return result;
}

function createDelayedPrivyIdentityTokenPromise({
  delayMs,
  debugContext,
  isTerminal,
}: {
  delayMs: number;
  debugContext?: PrivyIdentityDebugContext;
  isTerminal?: () => boolean;
}): Promise<string | undefined> {
  return (async () => {
    console.info("[AuthFlow] Privy identity token delayed follow-up scheduled", {
      delayMs,
      attemptId: debugContext?.attemptId ?? null,
      caller: "controller_retry",
    });

    const completed = await waitFor(delayMs);
    if (!completed) {
      return undefined;
    }

    if (getPrivyRateLimitRemainingMs() > 0 || isTerminal?.() === true) {
      console.info("[AuthFlow] delayed Privy identity token follow-up suppressed", {
        delayMs,
        attemptId: debugContext?.attemptId ?? null,
        rateLimited: getPrivyRateLimitRemainingMs() > 0,
        terminal: isTerminal?.() === true,
      });
      return undefined;
    }

    const delayedTokenResult = await getPrivyIdentityTokenFastWithContext(
      debugContext,
      "controller_retry"
    );

    if (delayedTokenResult.rateLimited) {
      throw new Error("Privy identity provider is rate limited");
    }

    if (!delayedTokenResult.token && delayedTokenResult.pendingPromise) {
      console.info("[AuthFlow] delayed Privy identity token request still pending; awaiting resolution", {
        delayMs,
        attemptId: debugContext?.attemptId ?? null,
        caller: "controller_retry",
      });
      return await normalizePendingPrivyIdentityTokenPromise(
        delayedTokenResult.pendingPromise
      );
    }

    return delayedTokenResult.token;
  })();
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
  debugContext,
}: {
  user: PrivyUserLike;
  getLatestUser?: () => PrivyUserLike | null | undefined;
  isTerminal?: () => boolean;
  debugContext?: PrivyIdentityDebugContext;
}): Promise<ResolvedPrivyAuthPayload> {
  const userId = user.id;
  if (privyAuthPayloadInFlight?.userId === userId) {
    beginPrivyIdentityDebugContext(debugContext, debugContext?.initialCaller ?? "system");
    console.info("[AuthFlow] reusing pending Privy auth payload resolution", {
      attemptId: debugContext?.attemptId ?? null,
      caller: debugContext?.initialCaller ?? "system",
      owner: debugContext?.owner ?? null,
      mode: debugContext?.mode ?? null,
      userId,
    });
    return privyAuthPayloadInFlight.promise;
  }

  const resolutionPromise = (async (): Promise<ResolvedPrivyAuthPayload> => {
    beginPrivyIdentityDebugContext(debugContext, debugContext?.initialCaller ?? "system");
    let latestUser = getLatestUser?.() ?? user;
    let email = getPrivyPrimaryEmail(latestUser);
    let name = getPrivyDisplayName(latestUser, email);
    let sawRateLimit = false;
    let pendingPrivyIdTokenPromise: Promise<string | undefined> | undefined;
    let tokenResolution: "available" | "pending" | "empty" = "empty";
    let tokenLocalCheck = inspectPrivyIdentityToken(undefined);

    const initialTokenTimeoutMs = hasOAuthIdentity(latestUser)
      ? OAUTH_IDENTITY_TOKEN_TIMEOUT_MS
      : QUICK_IDENTITY_TOKEN_TIMEOUT_MS;

    let initialTokenResult = await getIdentityTokenWithin(
      initialTokenTimeoutMs,
      debugContext,
      debugContext?.initialCaller ?? "system"
    );
    let privyIdToken = initialTokenResult.token;
    tokenLocalCheck = inspectPrivyIdentityToken(privyIdToken);
    sawRateLimit = sawRateLimit || initialTokenResult.rateLimited;
    if (!privyIdToken && initialTokenResult.timedOut && initialTokenResult.pendingPromise) {
      console.info("[AuthFlow] awaiting initial Privy identity token request before fast retry", {
        settleGraceMs: IDENTITY_TOKEN_SETTLE_GRACE_MS,
        attemptId: debugContext?.attemptId ?? null,
        caller: debugContext?.initialCaller ?? "system",
      });
      initialTokenResult = await waitForPendingIdentityTokenResult(
        initialTokenResult.pendingPromise,
        IDENTITY_TOKEN_SETTLE_GRACE_MS
      );
      privyIdToken = initialTokenResult.token;
      tokenLocalCheck = inspectPrivyIdentityToken(privyIdToken);
      sawRateLimit = sawRateLimit || initialTokenResult.rateLimited;
    }
    if (!privyIdToken && initialTokenResult.timedOut && initialTokenResult.pendingPromise) {
      pendingPrivyIdTokenPromise = normalizePendingPrivyIdentityTokenPromise(
        initialTokenResult.pendingPromise
      );
      tokenResolution = "pending";
    }
    if (
      !privyIdToken &&
      tokenResolution !== "pending" &&
      !sawRateLimit &&
      getPrivyRateLimitRemainingMs() === 0 &&
      isTerminal?.() !== true
    ) {
      const delayedFollowUpMs = AUTH_PAYLOAD_READY_DELAYS_MS[0];
      if (delayedFollowUpMs) {
        pendingPrivyIdTokenPromise = createDelayedPrivyIdentityTokenPromise({
          delayMs: delayedFollowUpMs,
          debugContext,
          isTerminal,
        });
        tokenResolution = "pending";
      }
    }
    if (!privyIdToken) {
      console.info("[AuthFlow] initial Privy identity flow settled without token; deferring retry", {
        attemptId: debugContext?.attemptId ?? null,
        caller: debugContext?.initialCaller ?? "system",
        userId,
        tokenResolution,
      });
    }
    if (privyIdToken) {
      tokenResolution = "available";
      return {
        user: latestUser,
        email,
        name,
        privyIdToken,
        tokenResolution,
        tokenLocalCheck,
      };
    }

    if (!sawRateLimit && getPrivyRateLimitRemainingMs() === 0 && isTerminal?.() !== true) {
      await waitForOutstandingPrivyIdentityRequests(350);
    }

    if (sawRateLimit || getPrivyRateLimitRemainingMs() > 0 || isTerminal?.() === true) {
      throw new Error("Privy identity provider is rate limited");
    }

    return {
      user: latestUser,
      email,
      name,
      privyIdToken,
      pendingPrivyIdTokenPromise,
      tokenResolution,
      tokenLocalCheck,
    };
  })();

  privyAuthPayloadInFlight = { userId, promise: resolutionPromise };

  try {
    return await resolutionPromise;
  } finally {
    finishPrivyIdentityDebugContext(
      debugContext,
      getPrivyRateLimitRemainingMs() > 0 ? "rate_limited" : "settled"
    );
    if (privyAuthPayloadInFlight?.promise === resolutionPromise) {
      privyAuthPayloadInFlight = null;
    }
  }
}
