import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

const SESSION_TOKEN_VERSION = "v1";
const DEFAULT_SESSION_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;

export type SessionTokenUserClaims = {
  name?: string | null;
  email?: string | null;
  emailVerified?: boolean | null;
  image?: string | null;
  walletAddress?: string | null;
  walletProvider?: string | null;
  username?: string | null;
  level?: number | null;
  xp?: number | null;
  bio?: string | null;
  role?: string | null;
  isAdmin?: boolean | null;
  isBanned?: boolean | null;
  isVerified?: boolean | null;
  tradeFeeRewardsEnabled?: boolean | null;
  tradeFeeShareBps?: number | null;
  tradeFeePayoutAddress?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
};

function getSessionTokenSecret(): string {
  const secret = process.env.AUTH_SESSION_TOKEN_SECRET?.trim();
  if (!secret) {
    throw new Error("AUTH_SESSION_TOKEN_SECRET is required");
  }
  return secret;
}

function toBase64Url(buffer: Buffer): string {
  return buffer
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function fromBase64Url(value: string): Buffer | null {
  if (!/^[A-Za-z0-9\-_]+$/.test(value)) return null;
  const padded = value + "=".repeat((4 - (value.length % 4)) % 4);
  try {
    return Buffer.from(padded.replace(/-/g, "+").replace(/_/g, "/"), "base64");
  } catch {
    return null;
  }
}

function signTokenBody(body: string): Buffer {
  return createHmac("sha256", getSessionTokenSecret()).update(body).digest();
}

type SessionTokenPayload = {
  v: 1;
  uid: string;
  iat: number;
  exp: number;
  jti: string;
  usr?: SessionTokenUserClaims;
};

export type VerifiedSignedSessionToken = {
  userId: string;
  issuedAt: Date;
  expiresAt: Date;
  jti: string;
  userClaims: SessionTokenUserClaims | null;
};

export type SignedSessionTokenInspection = {
  formatValid: boolean;
  versionValid: boolean;
  signatureDecoded: boolean;
  signatureVerified: boolean;
  payloadDecoded: boolean;
  payloadParsed: boolean;
  payloadValid: boolean;
  expired: boolean;
  futureIat: boolean;
  failureReason:
    | "invalid_format"
    | "invalid_version"
    | "invalid_signature_encoding"
    | "signature_mismatch"
    | "invalid_payload_encoding"
    | "invalid_payload_json"
    | "invalid_payload_shape"
    | "expired"
    | "future_iat"
    | null;
  verified: VerifiedSignedSessionToken | null;
};

function toOptionalString(value: unknown): string | null | undefined {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (value === null) return null;
  return undefined;
}

function toOptionalBoolean(value: unknown): boolean | null | undefined {
  if (typeof value === "boolean") return value;
  if (value === null) return null;
  return undefined;
}

function toOptionalFiniteNumber(value: unknown): number | null | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (value === null) return null;
  return undefined;
}

function toOptionalRole(value: unknown): string | null | undefined {
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    return normalized.length > 0 ? normalized.slice(0, 32) : null;
  }
  if (value === null) return null;
  return undefined;
}

function toOptionalIsoDateString(value: unknown): string | null | undefined {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString();
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const parsed = new Date(trimmed);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
    return null;
  }
  if (value === null) return null;
  return undefined;
}

function sanitizeUserClaims(
  claims: SessionTokenUserClaims | undefined
): SessionTokenUserClaims | undefined {
  if (!claims) return undefined;

  const sanitized: SessionTokenUserClaims = {};
  let hasAnyValue = false;

  const assign = <K extends keyof SessionTokenUserClaims>(
    key: K,
    value: SessionTokenUserClaims[K] | undefined
  ) => {
    if (value === undefined) return;
    sanitized[key] = value;
    hasAnyValue = true;
  };

  assign("name", toOptionalString(claims.name));
  assign("email", toOptionalString(claims.email));
  assign("emailVerified", toOptionalBoolean(claims.emailVerified));
  assign("image", toOptionalString(claims.image));
  assign("walletAddress", toOptionalString(claims.walletAddress));
  assign("walletProvider", toOptionalString(claims.walletProvider));
  assign("username", toOptionalString(claims.username));
  assign("level", toOptionalFiniteNumber(claims.level));
  assign("xp", toOptionalFiniteNumber(claims.xp));
  assign("bio", toOptionalString(claims.bio));
  assign("role", toOptionalRole(claims.role));
  assign("isAdmin", toOptionalBoolean(claims.isAdmin));
  assign("isBanned", toOptionalBoolean(claims.isBanned));
  assign("isVerified", toOptionalBoolean(claims.isVerified));
  assign("tradeFeeRewardsEnabled", toOptionalBoolean(claims.tradeFeeRewardsEnabled));
  assign("tradeFeeShareBps", toOptionalFiniteNumber(claims.tradeFeeShareBps));
  assign("tradeFeePayoutAddress", toOptionalString(claims.tradeFeePayoutAddress));
  assign("createdAt", toOptionalIsoDateString(claims.createdAt));
  assign("updatedAt", toOptionalIsoDateString(claims.updatedAt));

  return hasAnyValue ? sanitized : undefined;
}

function parseUserClaims(value: unknown): SessionTokenUserClaims | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const claims = value as Record<string, unknown>;
  const parsed = sanitizeUserClaims({
    name: toOptionalString(claims.name),
    email: toOptionalString(claims.email),
    emailVerified: toOptionalBoolean(claims.emailVerified),
    image: toOptionalString(claims.image),
    walletAddress: toOptionalString(claims.walletAddress),
    walletProvider: toOptionalString(claims.walletProvider),
    username: toOptionalString(claims.username),
    level: toOptionalFiniteNumber(claims.level),
    xp: toOptionalFiniteNumber(claims.xp),
    bio: toOptionalString(claims.bio),
    role: toOptionalRole(claims.role),
    isAdmin: toOptionalBoolean(claims.isAdmin),
    isBanned: toOptionalBoolean(claims.isBanned),
    isVerified: toOptionalBoolean(claims.isVerified),
    tradeFeeRewardsEnabled: toOptionalBoolean(claims.tradeFeeRewardsEnabled),
    tradeFeeShareBps: toOptionalFiniteNumber(claims.tradeFeeShareBps),
    tradeFeePayoutAddress: toOptionalString(claims.tradeFeePayoutAddress),
    createdAt: toOptionalIsoDateString(claims.createdAt),
    updatedAt: toOptionalIsoDateString(claims.updatedAt),
  });

  return parsed ?? null;
}

export function createSignedSessionToken(params: {
  userId: string;
  now?: Date;
  ttlMs?: number;
  user?: SessionTokenUserClaims;
}): string {
  const nowMs = (params.now ?? new Date()).getTime();
  const ttlMs = params.ttlMs ?? DEFAULT_SESSION_TOKEN_TTL_MS;
  const userClaims = sanitizeUserClaims(params.user);
  const payload: SessionTokenPayload = {
    v: 1,
    uid: params.userId,
    iat: nowMs,
    exp: nowMs + ttlMs,
    jti: randomUUID().replace(/-/g, ""),
    ...(userClaims ? { usr: userClaims } : {}),
  };

  const encodedPayload = toBase64Url(Buffer.from(JSON.stringify(payload), "utf8"));
  const body = `${SESSION_TOKEN_VERSION}.${encodedPayload}`;
  const signature = toBase64Url(signTokenBody(body));
  return `${body}.${signature}`;
}

export function inspectSignedSessionToken(token: string): SignedSessionTokenInspection {
  const parts = token.split(".");
  if (parts.length !== 3) {
    return {
      formatValid: false,
      versionValid: false,
      signatureDecoded: false,
      signatureVerified: false,
      payloadDecoded: false,
      payloadParsed: false,
      payloadValid: false,
      expired: false,
      futureIat: false,
      failureReason: "invalid_format",
      verified: null,
    };
  }

  const version = parts[0];
  const encodedPayload = parts[1];
  const encodedSignature = parts[2];
  if (
    version === undefined ||
    encodedPayload === undefined ||
    encodedSignature === undefined
  ) {
    return {
      formatValid: false,
      versionValid: false,
      signatureDecoded: false,
      signatureVerified: false,
      payloadDecoded: false,
      payloadParsed: false,
      payloadValid: false,
      expired: false,
      futureIat: false,
      failureReason: "invalid_format",
      verified: null,
    };
  }
  if (version !== SESSION_TOKEN_VERSION) {
    return {
      formatValid: true,
      versionValid: false,
      signatureDecoded: false,
      signatureVerified: false,
      payloadDecoded: false,
      payloadParsed: false,
      payloadValid: false,
      expired: false,
      futureIat: false,
      failureReason: "invalid_version",
      verified: null,
    };
  }

  const signature = fromBase64Url(encodedSignature);
  if (!signature) {
    return {
      formatValid: true,
      versionValid: true,
      signatureDecoded: false,
      signatureVerified: false,
      payloadDecoded: false,
      payloadParsed: false,
      payloadValid: false,
      expired: false,
      futureIat: false,
      failureReason: "invalid_signature_encoding",
      verified: null,
    };
  }

  const body = `${version}.${encodedPayload}`;
  const expectedSignature = signTokenBody(body);
  if (
    signature.length !== expectedSignature.length ||
    !timingSafeEqual(signature, expectedSignature)
  ) {
    return {
      formatValid: true,
      versionValid: true,
      signatureDecoded: true,
      signatureVerified: false,
      payloadDecoded: false,
      payloadParsed: false,
      payloadValid: false,
      expired: false,
      futureIat: false,
      failureReason: "signature_mismatch",
      verified: null,
    };
  }

  const payloadBuffer = fromBase64Url(encodedPayload);
  if (!payloadBuffer) {
    return {
      formatValid: true,
      versionValid: true,
      signatureDecoded: true,
      signatureVerified: true,
      payloadDecoded: false,
      payloadParsed: false,
      payloadValid: false,
      expired: false,
      futureIat: false,
      failureReason: "invalid_payload_encoding",
      verified: null,
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(payloadBuffer.toString("utf8"));
  } catch {
    return {
      formatValid: true,
      versionValid: true,
      signatureDecoded: true,
      signatureVerified: true,
      payloadDecoded: true,
      payloadParsed: false,
      payloadValid: false,
      expired: false,
      futureIat: false,
      failureReason: "invalid_payload_json",
      verified: null,
    };
  }

  if (!parsed || typeof parsed !== "object") {
    return {
      formatValid: true,
      versionValid: true,
      signatureDecoded: true,
      signatureVerified: true,
      payloadDecoded: true,
      payloadParsed: true,
      payloadValid: false,
      expired: false,
      futureIat: false,
      failureReason: "invalid_payload_shape",
      verified: null,
    };
  }
  const payload = parsed as Partial<SessionTokenPayload>;
  if (
    payload.v !== 1 ||
    typeof payload.uid !== "string" ||
    payload.uid.length === 0 ||
    typeof payload.iat !== "number" ||
    typeof payload.exp !== "number" ||
    typeof payload.jti !== "string" ||
    payload.jti.length === 0
  ) {
    return {
      formatValid: true,
      versionValid: true,
      signatureDecoded: true,
      signatureVerified: true,
      payloadDecoded: true,
      payloadParsed: true,
      payloadValid: false,
      expired: false,
      futureIat: false,
      failureReason: "invalid_payload_shape",
      verified: null,
    };
  }

  const nowMs = Date.now();
  if (payload.exp <= nowMs) {
    return {
      formatValid: true,
      versionValid: true,
      signatureDecoded: true,
      signatureVerified: true,
      payloadDecoded: true,
      payloadParsed: true,
      payloadValid: true,
      expired: true,
      futureIat: false,
      failureReason: "expired",
      verified: null,
    };
  }
  if (payload.iat > nowMs + MAX_CLOCK_SKEW_MS) {
    return {
      formatValid: true,
      versionValid: true,
      signatureDecoded: true,
      signatureVerified: true,
      payloadDecoded: true,
      payloadParsed: true,
      payloadValid: true,
      expired: false,
      futureIat: true,
      failureReason: "future_iat",
      verified: null,
    };
  }

  return {
    formatValid: true,
    versionValid: true,
    signatureDecoded: true,
    signatureVerified: true,
    payloadDecoded: true,
    payloadParsed: true,
    payloadValid: true,
    expired: false,
    futureIat: false,
    failureReason: null,
    verified: {
      userId: payload.uid,
      issuedAt: new Date(payload.iat),
      expiresAt: new Date(payload.exp),
      jti: payload.jti,
      userClaims: parseUserClaims(payload.usr),
    },
  };
}

export function verifySignedSessionToken(
  token: string
): VerifiedSignedSessionToken | null {
  return inspectSignedSessionToken(token).verified;
}
