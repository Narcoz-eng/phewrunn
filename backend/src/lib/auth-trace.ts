export const AUTH_COOKIE_NAMES = [
  "phew.session_token",
  "better-auth.session_token",
  "auth.session_token",
  "session_token",
] as const;

export type AuthCookieName = (typeof AUTH_COOKIE_NAMES)[number];

export type AuthCookieEntry = {
  name: AuthCookieName;
  value: string;
};

export type AuthTokenAttemptTrace = {
  source: "cookie" | "bearer";
  cookieNames: string[];
  signedTokenPresent: boolean;
  signedTokenParseSuccess: boolean;
  signatureVerifySuccess: boolean;
  tokenExpiryValid: boolean;
  fallbackToDbUsed: boolean;
  redisTouched: boolean;
  redisResult: string | null;
  sessionRowFound: boolean;
  userRowFound: boolean;
  sessionResolved: boolean;
  reason: string | null;
};

export type ApiMeAuthTrace = {
  requestId: string | null;
  host: string | null;
  origin: string | null;
  userAgent: string | null;
  cookieHeaderPresent: boolean;
  authCookieNameFound: string | null;
  authCookieNamesFound: string[];
  authLikeCookieCount: number;
  signedTokenPresent: boolean;
  signedTokenParseSuccess: boolean;
  signatureVerifySuccess: boolean;
  tokenExpiryValid: boolean;
  fallbackToDbUsed: boolean;
  redisTouched: boolean;
  redisResult: string | null;
  sessionRowFound: boolean;
  userRowFound: boolean;
  finalAuthResult: 200 | 401 | null;
  exact401Reason: string | null;
  decisionPath: string[];
  tokenAttempts: AuthTokenAttemptTrace[];
  cookieCandidates: Array<{
    name: string;
    signedTokenPresent: boolean;
  }>;
};

export function getAuthCookieEntries(cookieHeader: string | null | undefined): AuthCookieEntry[] {
  if (!cookieHeader) return [];

  const entries: AuthCookieEntry[] = [];
  for (const part of cookieHeader.split(";")) {
    const [rawKey, ...rest] = part.trim().split("=");
    if (!rawKey) continue;
    if (!(AUTH_COOKIE_NAMES as readonly string[]).includes(rawKey)) continue;
    const rawValue = rest.join("=").trim();
    if (!rawValue) continue;
    try {
      entries.push({
        name: rawKey as AuthCookieName,
        value: decodeURIComponent(rawValue),
      });
    } catch {
      entries.push({
        name: rawKey as AuthCookieName,
        value: rawValue,
      });
    }
  }
  return entries;
}

export function getPreferredAuthCookieEntries(
  cookieHeader: string | null | undefined
): AuthCookieEntry[] {
  const entries = getAuthCookieEntries(cookieHeader);
  if (entries.length <= 1) {
    return entries;
  }

  const canonicalEntries = entries.filter((entry) => entry.name === AUTH_COOKIE_NAMES[0]);
  if (canonicalEntries.length === 0) {
    return entries;
  }

  return [
    ...canonicalEntries,
    ...entries.filter((entry) => entry.name !== AUTH_COOKIE_NAMES[0]),
  ];
}

export function getPreferredAuthCookieEntry(
  cookieHeader: string | null | undefined
): AuthCookieEntry | null {
  return getPreferredAuthCookieEntries(cookieHeader)[0] ?? null;
}

export function createAuthTokenAttemptTrace(params: {
  source: "cookie" | "bearer";
  cookieNames?: string[];
  token: string;
}): AuthTokenAttemptTrace {
  return {
    source: params.source,
    cookieNames: [...new Set((params.cookieNames ?? []).filter((value) => value.length > 0))],
    signedTokenPresent: params.token.startsWith("v1."),
    signedTokenParseSuccess: false,
    signatureVerifySuccess: false,
    tokenExpiryValid: false,
    fallbackToDbUsed: false,
    redisTouched: false,
    redisResult: null,
    sessionRowFound: false,
    userRowFound: false,
    sessionResolved: false,
    reason: null,
  };
}

export function buildApiMeAuthTrace(
  headers: Headers,
  requestId: string | null
): ApiMeAuthTrace {
  const cookieHeader = headers.get("cookie");
  const cookieEntries = getAuthCookieEntries(cookieHeader);
  const preferredCookieEntry = getPreferredAuthCookieEntry(cookieHeader);
  return {
    requestId,
    host: headers.get("host"),
    origin: headers.get("origin"),
    userAgent: headers.get("user-agent"),
    cookieHeaderPresent: Boolean(cookieHeader && cookieHeader.trim().length > 0),
    authCookieNameFound: preferredCookieEntry?.name ?? null,
    authCookieNamesFound: [...new Set(cookieEntries.map((entry) => entry.name))],
    authLikeCookieCount: cookieEntries.length,
    signedTokenPresent: false,
    signedTokenParseSuccess: false,
    signatureVerifySuccess: false,
    tokenExpiryValid: false,
    fallbackToDbUsed: false,
    redisTouched: false,
    redisResult: null,
    sessionRowFound: false,
    userRowFound: false,
    finalAuthResult: null,
    exact401Reason: null,
    decisionPath: [],
    tokenAttempts: [],
    cookieCandidates: cookieEntries.map((entry) => ({
      name: entry.name,
      signedTokenPresent: entry.value.startsWith("v1."),
    })),
  };
}

export function appendAuthDecision(
  trace: ApiMeAuthTrace | null | undefined,
  decision: string
): void {
  if (!trace) return;
  trace.decisionPath.push(decision);
}

export function finalizeApiMeAuthTrace(
  trace: ApiMeAuthTrace | null | undefined,
  finalAuthResult: 200 | 401,
  exact401Reason: string | null
): ApiMeAuthTrace | null {
  if (!trace) return null;

  const firstAttempt = trace.tokenAttempts[0] ?? null;
  if (trace.tokenAttempts.length > 0) {
    trace.signedTokenPresent = trace.tokenAttempts.some((attempt) => attempt.signedTokenPresent);
    trace.signedTokenParseSuccess = trace.tokenAttempts.some((attempt) => attempt.signedTokenParseSuccess);
    trace.signatureVerifySuccess = trace.tokenAttempts.some((attempt) => attempt.signatureVerifySuccess);
    trace.tokenExpiryValid = trace.tokenAttempts.some((attempt) => attempt.tokenExpiryValid);
    trace.fallbackToDbUsed = trace.tokenAttempts.some((attempt) => attempt.fallbackToDbUsed);
    trace.redisTouched = trace.tokenAttempts.some((attempt) => attempt.redisTouched);
    trace.redisResult =
      [...trace.tokenAttempts]
        .reverse()
        .find((attempt) => typeof attempt.redisResult === "string" && attempt.redisResult.length > 0)
        ?.redisResult ?? null;
    trace.sessionRowFound = trace.tokenAttempts.some((attempt) => attempt.sessionRowFound);
    trace.userRowFound = trace.tokenAttempts.some((attempt) => attempt.userRowFound);
  }
  if (firstAttempt && !trace.authCookieNameFound) {
    trace.authCookieNameFound = firstAttempt.cookieNames[0] ?? null;
  }

  trace.finalAuthResult = finalAuthResult;
  trace.exact401Reason = finalAuthResult === 401 ? exact401Reason : null;
  return trace;
}
