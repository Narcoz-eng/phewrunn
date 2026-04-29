import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { env, isProduction } from "../env.js";
import {
  isRedisConfigured,
  redisDelete,
  redisGetString,
  redisSetIfNotExists,
  redisSetString,
} from "./redis.js";

export const INTERNAL_JOB_NAMES = [
  "feed_refresh",
  "sidebar_refresh",
  "chart_refresh",
  "post_fanout",
  "push_delivery",
  "settlement",
  "market_refresh",
  "leaderboard_refresh",
  "intelligence_refresh",
] as const;

export type InternalJobName = (typeof INTERNAL_JOB_NAMES)[number];

export const internalJobNameSchema = z.enum(INTERNAL_JOB_NAMES);

export const internalJobEnvelopeSchema = z.object({
  version: z.literal(1),
  jobName: internalJobNameSchema,
  jobId: z.string().uuid(),
  idempotencyKey: z.string().min(1).max(256),
  enqueuedAt: z.string().datetime({ offset: true }),
  traceId: z.string().min(1).max(128).optional(),
  payload: z.record(z.string(), z.unknown()),
});

export type InternalJobEnvelope = z.infer<typeof internalJobEnvelopeSchema>;

type InternalJobDefinition = {
  label: string;
  timeout: string;
  retries: number;
  retryDelayExpression: string;
  flowControlKey: string;
  flowControlValue: string;
  localConcurrencyLimit: number;
  processingTtlMs: number;
  completedTtlMs: number;
};

export type InternalJobResult =
  | { status?: "success"; meta?: Record<string, string | number | boolean | null | undefined> }
  | { status: "skipped"; reason: string; meta?: Record<string, string | number | boolean | null | undefined> }
  | void;

export type InternalJobHandlerContext = {
  messageId: string | null;
  requestId: string | null;
  retried: number;
  definition: InternalJobDefinition;
};

export type InternalJobHandler = (args: {
  envelope: InternalJobEnvelope;
  context: InternalJobHandlerContext;
}) => Promise<InternalJobResult>;

type EndpointConcurrencyLease = {
  release: () => void;
};

type EndpointConcurrencyLimiter = {
  limit: number;
  tryAcquire: () => EndpointConcurrencyLease | null;
  current: () => number;
};

type InternalJobMetric = {
  enqueued: number;
  deduplicatedPublishes: number;
  enqueueFailures: number;
  deliveriesStarted: number;
  deliveriesSucceeded: number;
  deliveriesSkipped: number;
  deliveriesRejected: number;
  deliveriesFailed: number;
  deadLettered: number;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  lastFailureReason: string | null;
  lastMessageId: string | null;
};

type InternalJobExecutionState =
  | {
      status: "processing";
      jobId: string;
      expiresAtMs: number;
    }
  | {
      status: "completed";
      jobId: string;
      expiresAtMs: number;
    };

type InternalJobExecutionClaim =
  | { kind: "claimed" }
  | { kind: "duplicate" }
  | { kind: "processing" }
  | { kind: "unavailable" };

type QStashVerificationKeys = {
  current: string;
  next?: string | null;
};

type QStashVerificationClaims = {
  sub: string;
  exp: number;
  nbf: number;
  body: string;
};

type CreatePublishRequestOverrides = {
  backendUrl?: string;
  qstashUrl?: string;
  qstashToken?: string;
};

export type EnqueueInternalJobInput = {
  jobName: InternalJobName;
  idempotencyKey: string;
  payload: Record<string, unknown>;
  traceId?: string | null;
  notBeforeAt?: Date | string | number | null;
};

type QStashPublishResponse = {
  messageId?: string;
  deduplicated?: boolean;
};

const JOB_RETRY_DELAY_EXPRESSION =
  "30000*max(0,1-abs(retried-0))+120000*max(0,1-abs(retried-1))+600000*max(0,1-abs(retried-2))+1800000*max(0,1-abs(retried-3))+7200000*min(1,max(0,retried-4))";
const LOCAL_JOB_STATE_MAX_ENTRIES = isProduction ? 20_000 : 2_000;
const QSTASH_HEADER_LABEL_PREFIX = "internal-job";

export const INTERNAL_JOB_DEFINITIONS: Record<InternalJobName, InternalJobDefinition> = {
  feed_refresh: {
    label: "refresh-feed",
    timeout: "30s",
    retries: 5,
    retryDelayExpression: JOB_RETRY_DELAY_EXPRESSION,
    flowControlKey: "job:refresh_feed",
    flowControlValue: "parallelism=1, rate=30, period=1m",
    localConcurrencyLimit: 1,
    processingTtlMs: 30 * 60 * 1000,
    completedTtlMs: 10 * 60 * 1000,
  },
  sidebar_refresh: {
    label: "refresh-sidebar",
    timeout: "30s",
    retries: 5,
    retryDelayExpression: JOB_RETRY_DELAY_EXPRESSION,
    flowControlKey: "job:refresh_sidebar",
    flowControlValue: "parallelism=1, rate=20, period=1m",
    localConcurrencyLimit: 1,
    processingTtlMs: 30 * 60 * 1000,
    completedTtlMs: 5 * 60 * 1000,
  },
  chart_refresh: {
    label: "refresh-chart",
    timeout: "30s",
    retries: 5,
    retryDelayExpression: JOB_RETRY_DELAY_EXPRESSION,
    flowControlKey: "job:refresh_chart",
    flowControlValue: "parallelism=2, rate=60, period=1m",
    localConcurrencyLimit: 2,
    processingTtlMs: 30 * 60 * 1000,
    completedTtlMs: 5 * 60 * 1000,
  },
  post_fanout: {
    label: "post-fanout",
    timeout: "20s",
    retries: 5,
    retryDelayExpression: JOB_RETRY_DELAY_EXPRESSION,
    flowControlKey: "job:post_fanout",
    flowControlValue: "parallelism=6, rate=120, period=1m",
    localConcurrencyLimit: 6,
    processingTtlMs: 60 * 60 * 1000,
    completedTtlMs: 7 * 24 * 60 * 60 * 1000,
  },
  push_delivery: {
    label: "push-delivery",
    timeout: "20s",
    retries: 5,
    retryDelayExpression: JOB_RETRY_DELAY_EXPRESSION,
    flowControlKey: "job:push_delivery",
    flowControlValue: "parallelism=12, rate=240, period=1m",
    localConcurrencyLimit: 12,
    processingTtlMs: 60 * 60 * 1000,
    completedTtlMs: 7 * 24 * 60 * 60 * 1000,
  },
  settlement: {
    label: "settlement",
    timeout: "30s",
    retries: 5,
    retryDelayExpression: JOB_RETRY_DELAY_EXPRESSION,
    flowControlKey: "job:settlement",
    flowControlValue: "parallelism=1, rate=6, period=1m",
    localConcurrencyLimit: 1,
    processingTtlMs: 6 * 60 * 60 * 1000,
    completedTtlMs: 7 * 24 * 60 * 60 * 1000,
  },
  market_refresh: {
    label: "market-refresh",
    timeout: "30s",
    retries: 5,
    retryDelayExpression: JOB_RETRY_DELAY_EXPRESSION,
    flowControlKey: "job:market_refresh",
    flowControlValue: "parallelism=2, rate=12, period=1m",
    localConcurrencyLimit: 2,
    processingTtlMs: 6 * 60 * 60 * 1000,
    completedTtlMs: 7 * 24 * 60 * 60 * 1000,
  },
  leaderboard_refresh: {
    label: "leaderboard-refresh",
    timeout: "20s",
    retries: 5,
    retryDelayExpression: JOB_RETRY_DELAY_EXPRESSION,
    flowControlKey: "job:leaderboard_refresh",
    flowControlValue: "parallelism=1, rate=6, period=1m",
    localConcurrencyLimit: 1,
    processingTtlMs: 2 * 60 * 60 * 1000,
    completedTtlMs: 7 * 24 * 60 * 60 * 1000,
  },
  intelligence_refresh: {
    label: "intelligence-refresh",
    timeout: "30s",
    retries: 5,
    retryDelayExpression: JOB_RETRY_DELAY_EXPRESSION,
    flowControlKey: "job:intelligence_refresh",
    flowControlValue: "parallelism=2, rate=12, period=1m",
    localConcurrencyLimit: 2,
    processingTtlMs: 6 * 60 * 60 * 1000,
    completedTtlMs: 7 * 24 * 60 * 60 * 1000,
  },
};

const internalJobHandlers = new Map<InternalJobName, InternalJobHandler>();
const localJobStates = new Map<string, InternalJobExecutionState>();
const internalJobMetrics = new Map<InternalJobName, InternalJobMetric>();
const internalJobConcurrencyLimiters = new Map<InternalJobName, EndpointConcurrencyLimiter>();

function createEndpointConcurrencyLimiter(configuredLimit: number): EndpointConcurrencyLimiter {
  let inFlight = 0;
  const limit = configuredLimit > 0 ? configuredLimit : Number.MAX_SAFE_INTEGER;

  return {
    limit,
    tryAcquire() {
      if (inFlight >= limit) {
        return null;
      }

      inFlight += 1;
      let released = false;
      return {
        release() {
          if (released) return;
          released = true;
          inFlight = Math.max(0, inFlight - 1);
        },
      };
    },
    current() {
      return inFlight;
    },
  };
}

function getJobMetric(jobName: InternalJobName): InternalJobMetric {
  let metric = internalJobMetrics.get(jobName);
  if (!metric) {
    metric = {
      enqueued: 0,
      deduplicatedPublishes: 0,
      enqueueFailures: 0,
      deliveriesStarted: 0,
      deliveriesSucceeded: 0,
      deliveriesSkipped: 0,
      deliveriesRejected: 0,
      deliveriesFailed: 0,
      deadLettered: 0,
      lastSuccessAt: null,
      lastFailureAt: null,
      lastFailureReason: null,
      lastMessageId: null,
    };
    internalJobMetrics.set(jobName, metric);
  }
  return metric;
}

function getJobConcurrencyLimiter(jobName: InternalJobName): EndpointConcurrencyLimiter {
  let limiter = internalJobConcurrencyLimiters.get(jobName);
  if (!limiter) {
    limiter = createEndpointConcurrencyLimiter(INTERNAL_JOB_DEFINITIONS[jobName].localConcurrencyLimit);
    internalJobConcurrencyLimiters.set(jobName, limiter);
  }
  return limiter;
}

function logJobEvent(event: string, details: Record<string, unknown>): void {
  console.info(`[job-queue] ${event}`, details);
}

function logJobError(event: string, details: Record<string, unknown>): void {
  console.error(`[job-queue] ${event}`, details);
}

function hashValue(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 40);
}

function buildQueueDeduplicationId(jobName: InternalJobName, idempotencyKey: string): string {
  return `${QSTASH_HEADER_LABEL_PREFIX}:${jobName}:${hashValue(idempotencyKey)}`;
}

function buildInternalJobStateKey(jobName: InternalJobName, idempotencyKey: string): string {
  return `queue:idempotency:v1:${jobName}:${hashValue(idempotencyKey)}`;
}

function pruneExpiredLocalJobStates(now = Date.now()): void {
  for (const [key, state] of localJobStates) {
    if (state.expiresAtMs <= now) {
      localJobStates.delete(key);
    }
  }
}

function setLocalJobState(key: string, state: InternalJobExecutionState): void {
  pruneExpiredLocalJobStates();
  if (!localJobStates.has(key) && localJobStates.size >= LOCAL_JOB_STATE_MAX_ENTRIES) {
    const oldestKey = localJobStates.keys().next().value;
    if (typeof oldestKey === "string") {
      localJobStates.delete(oldestKey);
    }
  }
  localJobStates.set(key, state);
}

function createBodyHash(body: string): string {
  return createHash("sha256").update(body).digest("base64url");
}

function constantTimeEquals(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }
  return timingSafeEqual(leftBuffer, rightBuffer);
}

function decodeBase64UrlJson<T>(value: string): T {
  return JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as T;
}

function parseQStashVerificationToken(signature: string): {
  signingInput: string;
  signaturePart: string;
  claims: QStashVerificationClaims;
} {
  const parts = signature.split(".");
  if (parts.length !== 3) {
    throw new Error("Malformed Upstash signature");
  }

  const [encodedHeader, encodedPayload, signaturePart] = parts;
  if (!encodedHeader || !encodedPayload || !signaturePart) {
    throw new Error("Malformed Upstash signature");
  }

  const header = decodeBase64UrlJson<{ alg?: string; typ?: string }>(encodedHeader);
  if (header.alg !== "HS256") {
    throw new Error("Unsupported Upstash signature algorithm");
  }

  const claims = decodeBase64UrlJson<QStashVerificationClaims>(encodedPayload);
  return {
    signingInput: `${encodedHeader}.${encodedPayload}`,
    signaturePart,
    claims,
  };
}

function verifyQStashTokenWithKey(
  token: { signingInput: string; signaturePart: string; claims: QStashVerificationClaims },
  signingKey: string
): boolean {
  const digest = createHmac("sha256", signingKey)
    .update(token.signingInput)
    .digest("base64url");
  return constantTimeEquals(digest, token.signaturePart);
}

function getVerificationKeys(overrides?: Partial<QStashVerificationKeys>): QStashVerificationKeys | null {
  const current = overrides?.current ?? env.QSTASH_CURRENT_SIGNING_KEY ?? null;
  const next = overrides?.next ?? env.QSTASH_NEXT_SIGNING_KEY ?? null;
  if (!current) {
    return null;
  }
  return { current, next };
}

function getPublishConfig(overrides?: CreatePublishRequestOverrides): {
  backendUrl: string;
  qstashUrl: string;
  qstashToken: string;
} | null {
  const backendUrl = overrides?.backendUrl ?? env.BACKEND_URL;
  const qstashUrl = overrides?.qstashUrl ?? env.QSTASH_URL;
  const qstashToken = overrides?.qstashToken ?? env.QSTASH_TOKEN ?? null;
  if (!qstashToken) {
    return null;
  }
  return { backendUrl, qstashUrl, qstashToken };
}

export function hasQStashPublishConfig(): boolean {
  return getPublishConfig() !== null;
}

export function hasQStashVerificationConfig(): boolean {
  return getVerificationKeys() !== null;
}

export function buildInternalJobDestinationUrl(
  jobName: InternalJobName,
  backendUrl = env.BACKEND_URL
): string {
  return new URL(`/api/internal/jobs/${jobName}`, backendUrl).toString();
}

export function buildInternalJobFailureCallbackUrl(
  jobName: InternalJobName,
  backendUrl = env.BACKEND_URL
): string {
  const url = new URL("/api/internal/jobs/failures", backendUrl);
  url.searchParams.set("jobName", jobName);
  return url.toString();
}

export function buildQStashVerificationUrls(requestUrl: string, backendUrl = env.BACKEND_URL): string[] {
  const urls = new Set<string>();
  const actualUrl = new URL(requestUrl);
  urls.add(actualUrl.toString());
  urls.add(new URL(`${actualUrl.pathname}${actualUrl.search}`, backendUrl).toString());
  return [...urls];
}

export function verifyQStashSignature(params: {
  signature: string | null | undefined;
  requestUrl: string;
  rawBody: string;
  signingKeys?: Partial<QStashVerificationKeys>;
}): { keyUsed: "current" | "next" } {
  const signature = params.signature?.trim();
  if (!signature) {
    throw new Error("Missing Upstash signature");
  }

  const keys = getVerificationKeys(params.signingKeys);
  if (!keys) {
    throw new Error("QStash signing keys are not configured");
  }

  const token = parseQStashVerificationToken(signature);
  const nowSeconds = Math.floor(Date.now() / 1000);
  if (token.claims.exp <= nowSeconds || token.claims.nbf > nowSeconds) {
    throw new Error("Expired Upstash signature");
  }

  const bodyHash = createBodyHash(params.rawBody);
  if (!constantTimeEquals(bodyHash, token.claims.body)) {
    throw new Error("Upstash signature body hash mismatch");
  }

  const allowedSubjects = buildQStashVerificationUrls(params.requestUrl);
  if (!allowedSubjects.some((candidate) => candidate === token.claims.sub)) {
    throw new Error("Upstash signature subject mismatch");
  }

  if (verifyQStashTokenWithKey(token, keys.current)) {
    return { keyUsed: "current" };
  }

  if (keys.next && verifyQStashTokenWithKey(token, keys.next)) {
    return { keyUsed: "next" };
  }

  throw new Error("Invalid Upstash signature");
}

export function buildInternalJobEnvelope(input: EnqueueInternalJobInput): InternalJobEnvelope {
  return {
    version: 1,
    jobName: input.jobName,
    jobId: crypto.randomUUID(),
    idempotencyKey: input.idempotencyKey,
    enqueuedAt: new Date().toISOString(),
    ...(input.traceId ? { traceId: input.traceId } : {}),
    payload: input.payload,
  };
}

function resolveNotBeforeHeaderValue(input: EnqueueInternalJobInput): string | null {
  const raw = input.notBeforeAt;
  if (raw == null) {
    return null;
  }

  let timestampMs: number | null = null;
  if (raw instanceof Date) {
    timestampMs = raw.getTime();
  } else if (typeof raw === "number" && Number.isFinite(raw)) {
    timestampMs = raw > 10_000_000_000 ? raw : raw * 1000;
  } else if (typeof raw === "string") {
    const parsed = Date.parse(raw);
    timestampMs = Number.isFinite(parsed) ? parsed : null;
  }

  if (!timestampMs || !Number.isFinite(timestampMs)) {
    return null;
  }

  const unixSeconds = Math.max(Math.ceil(timestampMs / 1000), Math.floor(Date.now() / 1000));
  return String(unixSeconds);
}

export function createQStashPublishRequest(
  input: EnqueueInternalJobInput,
  overrides?: CreatePublishRequestOverrides
): {
  envelope: InternalJobEnvelope;
  requestUrl: string;
  requestInit: RequestInit;
} {
  const config = getPublishConfig(overrides);
  if (!config) {
    throw new Error("QStash publish config is incomplete");
  }

  const definition = INTERNAL_JOB_DEFINITIONS[input.jobName];
  const envelope = buildInternalJobEnvelope(input);
  const destination = buildInternalJobDestinationUrl(input.jobName, config.backendUrl);
  const requestUrl = `${config.qstashUrl.replace(/\/+$/, "")}/v2/publish/${destination}`;
  const deduplicationId = buildQueueDeduplicationId(input.jobName, input.idempotencyKey);

  const headers = new Headers({
    Authorization: `Bearer ${config.qstashToken}`,
    "Content-Type": "application/json",
    "Upstash-Method": "POST",
    "Upstash-Timeout": definition.timeout,
    "Upstash-Retries": String(definition.retries),
    "Upstash-Retry-Delay": definition.retryDelayExpression,
    "Upstash-Deduplication-Id": deduplicationId,
    "Upstash-Label": `${QSTASH_HEADER_LABEL_PREFIX}:${definition.label}`,
    "Upstash-Flow-Control-Key": definition.flowControlKey,
    "Upstash-Flow-Control-Value": definition.flowControlValue,
    "Upstash-Failure-Callback": buildInternalJobFailureCallbackUrl(input.jobName, config.backendUrl),
  });
  const notBeforeHeader = resolveNotBeforeHeaderValue(input);
  if (notBeforeHeader) {
    headers.set("Upstash-Not-Before", notBeforeHeader);
  }

  return {
    envelope,
    requestUrl,
    requestInit: {
      method: "POST",
      headers,
      body: JSON.stringify(envelope),
    },
  };
}

export async function enqueueInternalJob(input: EnqueueInternalJobInput): Promise<{
  messageId: string;
  deduplicated: boolean;
  envelope: InternalJobEnvelope;
}> {
  const { envelope, requestUrl, requestInit } = createQStashPublishRequest(input);
  const metric = getJobMetric(input.jobName);

  let response: Response;
  try {
    response = await fetch(requestUrl, requestInit);
  } catch (error) {
    metric.enqueueFailures += 1;
    metric.lastFailureAt = new Date().toISOString();
    metric.lastFailureReason = error instanceof Error ? error.message : String(error);
    logJobError("enqueue_failed", {
      jobName: input.jobName,
      idempotencyKey: input.idempotencyKey,
      error: metric.lastFailureReason,
    });
    throw error;
  }

  if (!response.ok) {
    const responseText = await response.text().catch(() => "");
    metric.enqueueFailures += 1;
    metric.lastFailureAt = new Date().toISOString();
    metric.lastFailureReason = `QStash publish failed with status ${response.status}`;
    logJobError("enqueue_failed", {
      jobName: input.jobName,
      status: response.status,
      responseText: responseText.slice(0, 500),
    });
    throw new Error(`QStash publish failed with status ${response.status}`);
  }

  const payload = (await response.json().catch(() => ({}))) as QStashPublishResponse;
  const messageId = payload.messageId?.trim();
  if (!messageId) {
    metric.enqueueFailures += 1;
    metric.lastFailureAt = new Date().toISOString();
    metric.lastFailureReason = "QStash publish response did not include a messageId";
    throw new Error("QStash publish response did not include a messageId");
  }

  metric.enqueued += 1;
  metric.lastMessageId = messageId;
  if (payload.deduplicated) {
    metric.deduplicatedPublishes += 1;
  }

  logJobEvent("enqueued", {
    jobName: input.jobName,
    messageId,
    deduplicated: Boolean(payload.deduplicated),
    idempotencyKey: buildQueueDeduplicationId(input.jobName, input.idempotencyKey),
  });

  return {
    messageId,
    deduplicated: Boolean(payload.deduplicated),
    envelope,
  };
}

async function tryClaimInternalJobExecutionRedis(
  envelope: InternalJobEnvelope,
  definition: InternalJobDefinition
): Promise<InternalJobExecutionClaim> {
  const stateKey = buildInternalJobStateKey(envelope.jobName, envelope.idempotencyKey);
  const result = await redisSetIfNotExists(
    stateKey,
    `processing:${envelope.jobId}`,
    definition.processingTtlMs
  );
  if (result === "stored") {
    return { kind: "claimed" };
  }
  if (result === "unavailable") {
    return { kind: "unavailable" };
  }

  const currentState = await redisGetString(stateKey);
  if (currentState?.startsWith("completed:")) {
    return { kind: "duplicate" };
  }
  if (currentState?.startsWith("processing:")) {
    return { kind: "processing" };
  }
  return { kind: "unavailable" };
}

function tryClaimInternalJobExecutionLocal(
  envelope: InternalJobEnvelope,
  definition: InternalJobDefinition
): InternalJobExecutionClaim {
  pruneExpiredLocalJobStates();
  const stateKey = buildInternalJobStateKey(envelope.jobName, envelope.idempotencyKey);
  const currentState = localJobStates.get(stateKey);
  if (currentState?.status === "completed") {
    return { kind: "duplicate" };
  }
  if (currentState?.status === "processing") {
    return { kind: "processing" };
  }

  setLocalJobState(stateKey, {
    status: "processing",
    jobId: envelope.jobId,
    expiresAtMs: Date.now() + definition.processingTtlMs,
  });
  return { kind: "claimed" };
}

export async function tryClaimInternalJobExecution(
  envelope: InternalJobEnvelope
): Promise<InternalJobExecutionClaim> {
  const definition = INTERNAL_JOB_DEFINITIONS[envelope.jobName];
  if (isRedisConfigured()) {
    const result = await tryClaimInternalJobExecutionRedis(envelope, definition);
    if (result.kind !== "unavailable" || isProduction) {
      return result;
    }
  }

  return tryClaimInternalJobExecutionLocal(envelope, definition);
}

export async function markInternalJobExecutionComplete(envelope: InternalJobEnvelope): Promise<boolean> {
  const definition = INTERNAL_JOB_DEFINITIONS[envelope.jobName];
  const stateKey = buildInternalJobStateKey(envelope.jobName, envelope.idempotencyKey);

  if (isRedisConfigured()) {
    const stored = await redisSetString(
      stateKey,
      `completed:${envelope.jobId}`,
      definition.completedTtlMs
    );
    if (stored) {
      return true;
    }
    if (isProduction) {
      return false;
    }
  }

  setLocalJobState(stateKey, {
    status: "completed",
    jobId: envelope.jobId,
    expiresAtMs: Date.now() + definition.completedTtlMs,
  });
  return true;
}

export async function releaseInternalJobExecution(envelope: InternalJobEnvelope): Promise<void> {
  const stateKey = buildInternalJobStateKey(envelope.jobName, envelope.idempotencyKey);
  if (isRedisConfigured()) {
    const deleted = await redisDelete(stateKey);
    if (deleted || !isProduction) {
      localJobStates.delete(stateKey);
      return;
    }
  }
  localJobStates.delete(stateKey);
}

export function registerInternalJobHandler(jobName: InternalJobName, handler: InternalJobHandler): void {
  internalJobHandlers.set(jobName, handler);
}

export function getInternalJobHandler(jobName: InternalJobName): InternalJobHandler | null {
  return internalJobHandlers.get(jobName) ?? null;
}

export function getRegisteredInternalJobHandlerCount(): number {
  return internalJobHandlers.size;
}

export function recordInternalJobRejected(jobName: InternalJobName, reason: string): void {
  const metric = getJobMetric(jobName);
  metric.deliveriesRejected += 1;
  metric.lastFailureAt = new Date().toISOString();
  metric.lastFailureReason = reason;
}

export function recordInternalJobStarted(jobName: InternalJobName, messageId: string | null): void {
  const metric = getJobMetric(jobName);
  metric.deliveriesStarted += 1;
  metric.lastMessageId = messageId;
}

export function recordInternalJobSucceeded(jobName: InternalJobName, messageId: string | null): void {
  const metric = getJobMetric(jobName);
  metric.deliveriesSucceeded += 1;
  metric.lastSuccessAt = new Date().toISOString();
  metric.lastMessageId = messageId;
}

export function recordInternalJobSkipped(
  jobName: InternalJobName,
  messageId: string | null,
  reason: string
): void {
  const metric = getJobMetric(jobName);
  metric.deliveriesSkipped += 1;
  metric.lastFailureAt = new Date().toISOString();
  metric.lastFailureReason = reason;
  metric.lastMessageId = messageId;
}

export function recordInternalJobFailed(
  jobName: InternalJobName,
  messageId: string | null,
  reason: string
): void {
  const metric = getJobMetric(jobName);
  metric.deliveriesFailed += 1;
  metric.lastFailureAt = new Date().toISOString();
  metric.lastFailureReason = reason;
  metric.lastMessageId = messageId;
}

export function recordInternalJobDeadLetter(jobName: InternalJobName): void {
  const metric = getJobMetric(jobName);
  metric.deadLettered += 1;
  metric.lastFailureAt = new Date().toISOString();
  metric.lastFailureReason = "dead_letter";
}

export function acquireInternalJobConcurrencyLease(jobName: InternalJobName): EndpointConcurrencyLease | null {
  return getJobConcurrencyLimiter(jobName).tryAcquire();
}

export function getInternalJobQueueHealthSummary(): {
  provider: "qstash";
  publishConfigured: boolean;
  verificationConfigured: boolean;
  registeredHandlers: number;
  handlerCoverage: string;
} {
  return {
    provider: "qstash",
    publishConfigured: hasQStashPublishConfig(),
    verificationConfigured: hasQStashVerificationConfig(),
    registeredHandlers: getRegisteredInternalJobHandlerCount(),
    handlerCoverage: `${getRegisteredInternalJobHandlerCount()}/${INTERNAL_JOB_NAMES.length}`,
  };
}

export function getInternalJobMetricsSnapshot(): Record<InternalJobName, InternalJobMetric & { inFlight: number }> {
  const snapshot = {} as Record<InternalJobName, InternalJobMetric & { inFlight: number }>;
  for (const jobName of INTERNAL_JOB_NAMES) {
    const metric = getJobMetric(jobName);
    snapshot[jobName] = {
      ...metric,
      inFlight: getJobConcurrencyLimiter(jobName).current(),
    };
  }
  return snapshot;
}

export function resolveInternalJobHandler(
  jobName: InternalJobName,
  overrides?: Partial<Record<InternalJobName, InternalJobHandler>>
): InternalJobHandler | null {
  return overrides?.[jobName] ?? getInternalJobHandler(jobName);
}

export function getInternalJobDefinition(jobName: InternalJobName): InternalJobDefinition {
  return INTERNAL_JOB_DEFINITIONS[jobName];
}

export function resetInternalJobQueueTestingState(): void {
  internalJobHandlers.clear();
  localJobStates.clear();
  internalJobMetrics.clear();
  internalJobConcurrencyLimiters.clear();
}

export function logInternalJobDeliveryStart(params: {
  jobName: InternalJobName;
  messageId: string | null;
  requestId: string | null;
  retried: number;
}): void {
  logJobEvent("delivery_started", params);
}

export function logInternalJobDeliveryResult(params: {
  jobName: InternalJobName;
  messageId: string | null;
  requestId: string | null;
  result: "success" | "skipped" | "dead_letter";
  reason?: string;
}): void {
  logJobEvent("delivery_result", params);
}

export function logInternalJobDeliveryFailure(params: {
  jobName: InternalJobName;
  messageId: string | null;
  requestId: string | null;
  reason: string;
  error?: string;
}): void {
  logJobError("delivery_failed", params);
}
