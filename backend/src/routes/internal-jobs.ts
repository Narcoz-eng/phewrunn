import { Hono } from "hono";
import type { AuthVariables } from "../auth.js";
import {
  acquireInternalJobConcurrencyLease,
  getInternalJobDefinition,
  hasQStashVerificationConfig,
  internalJobEnvelopeSchema,
  internalJobNameSchema,
  logInternalJobDeliveryFailure,
  logInternalJobDeliveryResult,
  logInternalJobDeliveryStart,
  markInternalJobExecutionComplete,
  recordInternalJobDeadLetter,
  recordInternalJobFailed,
  recordInternalJobRejected,
  recordInternalJobSkipped,
  recordInternalJobStarted,
  recordInternalJobSucceeded,
  releaseInternalJobExecution,
  resolveInternalJobHandler,
  tryClaimInternalJobExecution,
  type InternalJobHandler,
  type InternalJobName,
  verifyQStashSignature,
} from "../lib/job-queue.js";

type InternalJobsRouterOptions = {
  handlers?: Partial<Record<InternalJobName, InternalJobHandler>>;
  signingKeys?: {
    current: string;
    next?: string | null;
  };
};

type InternalJobsVariables = AuthVariables & { requestId?: string };

function parseRetriedHeader(value: string | undefined): number {
  if (!value) return 0;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function getHeaderValue(c: {
  req: { header: (name: string) => string | undefined };
}): { signature: string | null; messageId: string | null; retried: number } {
  const signature =
    c.req.header("upstash-signature") ??
    c.req.header("Upstash-Signature") ??
    null;
  const messageId =
    c.req.header("upstash-message-id") ??
    c.req.header("Upstash-Message-Id") ??
    null;
  const retried = parseRetriedHeader(
    c.req.header("upstash-retried") ?? c.req.header("Upstash-Retried")
  );
  return { signature, messageId, retried };
}

function jsonError(
  code: string,
  message: string
): { error: { code: string; message: string } } {
  return {
    error: {
      code,
      message,
    },
  };
}

function summarizeFailureCallbackBody(rawBody: string): Record<string, unknown> {
  if (!rawBody.trim()) {
    return { size: 0 };
  }

  try {
    const parsed = JSON.parse(rawBody) as Record<string, unknown>;
    const maybeMessageId =
      typeof parsed.messageId === "string"
        ? parsed.messageId
        : typeof parsed.message_id === "string"
          ? parsed.message_id
          : null;
    const maybeTopic =
      typeof parsed.topicName === "string"
        ? parsed.topicName
        : typeof parsed.topic_name === "string"
          ? parsed.topic_name
          : null;
    return {
      size: rawBody.length,
      messageId: maybeMessageId,
      topic: maybeTopic,
    };
  } catch {
    return {
      size: rawBody.length,
      messageId: null,
    };
  }
}

export function createInternalJobsRouter(options: InternalJobsRouterOptions = {}) {
  const router = new Hono<{ Variables: InternalJobsVariables }>();

  router.post("/failures", async (c) => {
    const requestId = c.get("requestId") ?? null;
    const rawBody = await c.req.text();
    const { signature } = getHeaderValue(c);

    try {
      verifyQStashSignature({
        signature,
        requestUrl: c.req.url,
        rawBody,
        signingKeys: options.signingKeys,
      });
    } catch (error) {
      console.warn("[job-queue] failure callback rejected", {
        requestId,
        error: error instanceof Error ? error.message : String(error),
      });
      return c.json(jsonError("INVALID_QUEUE_SIGNATURE", "Invalid queue signature"), 401);
    }

    const url = new URL(c.req.url);
    const maybeJobName = url.searchParams.get("jobName");
    const jobNameResult = internalJobNameSchema.safeParse(maybeJobName);
    if (jobNameResult.success) {
      recordInternalJobDeadLetter(jobNameResult.data);
      logInternalJobDeliveryResult({
        jobName: jobNameResult.data,
        messageId: null,
        requestId,
        result: "dead_letter",
      });
    }

    console.error("[job-queue] dead-letter callback received", {
      requestId,
      jobName: jobNameResult.success ? jobNameResult.data : maybeJobName,
      payload: summarizeFailureCallbackBody(rawBody),
    });

    return c.json({ data: { received: true } });
  });

  router.post("/:jobName", async (c) => {
    const requestId = c.get("requestId") ?? null;
    const jobNameResult = internalJobNameSchema.safeParse(c.req.param("jobName"));
    if (!jobNameResult.success) {
      return c.json(jsonError("UNKNOWN_JOB", "Unknown internal job type"), 404);
    }

    const jobName = jobNameResult.data;
    const rawBody = await c.req.text();
    const { signature, messageId, retried } = getHeaderValue(c);

    if (!hasQStashVerificationConfig() && !options.signingKeys?.current) {
      recordInternalJobRejected(jobName, "signing_keys_missing");
      return c.json(
        jsonError("QUEUE_NOT_CONFIGURED", "Queue signing keys are not configured"),
        503
      );
    }

    try {
      verifyQStashSignature({
        signature,
        requestUrl: c.req.url,
        rawBody,
        signingKeys: options.signingKeys,
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      recordInternalJobRejected(jobName, reason);
      return c.json(jsonError("INVALID_QUEUE_SIGNATURE", "Invalid queue signature"), 401);
    }

    let parsedBody: unknown;
    try {
      parsedBody = rawBody ? JSON.parse(rawBody) : {};
    } catch {
      recordInternalJobRejected(jobName, "invalid_json");
      return c.json(jsonError("INVALID_JOB_PAYLOAD", "Queue payload must be valid JSON"), 400);
    }

    const envelopeResult = internalJobEnvelopeSchema.safeParse(parsedBody);
    if (!envelopeResult.success) {
      recordInternalJobRejected(jobName, "invalid_envelope");
      return c.json(jsonError("INVALID_JOB_PAYLOAD", "Queue payload shape is invalid"), 400);
    }

    const envelope = envelopeResult.data;
    if (envelope.jobName !== jobName) {
      recordInternalJobRejected(jobName, "route_job_mismatch");
      return c.json(
        jsonError("JOB_NAME_MISMATCH", "Route job name does not match the queued payload"),
        400
      );
    }

    const handler = resolveInternalJobHandler(jobName, options.handlers);
    if (!handler) {
      recordInternalJobFailed(jobName, messageId, "handler_missing");
      return c.json(
        jsonError("JOB_HANDLER_MISSING", "No handler is registered for this internal job"),
        503
      );
    }

    const claim = await tryClaimInternalJobExecution(envelope);
    if (claim.kind === "duplicate") {
      recordInternalJobSkipped(jobName, messageId, "duplicate_delivery");
      logInternalJobDeliveryResult({
        jobName,
        messageId,
        requestId,
        result: "skipped",
        reason: "duplicate_delivery",
      });
      return c.json({ data: { status: "skipped", reason: "duplicate_delivery" } }, 202);
    }

    if (claim.kind === "processing") {
      recordInternalJobSkipped(jobName, messageId, "already_processing");
      logInternalJobDeliveryResult({
        jobName,
        messageId,
        requestId,
        result: "skipped",
        reason: "already_processing",
      });
      return c.json({ data: { status: "skipped", reason: "already_processing" } }, 202);
    }

    if (claim.kind === "unavailable") {
      recordInternalJobFailed(jobName, messageId, "idempotency_backend_unavailable");
      return c.json(
        jsonError("JOB_IDEMPOTENCY_UNAVAILABLE", "Job idempotency backend is unavailable"),
        503
      );
    }

    const concurrencyLease = acquireInternalJobConcurrencyLease(jobName);
    if (!concurrencyLease) {
      await releaseInternalJobExecution(envelope);
      recordInternalJobFailed(jobName, messageId, "concurrency_cap");
      return c.json(
        jsonError("JOB_BACKPRESSURE", "Job concurrency limit reached"),
        503
      );
    }

    const definition = getInternalJobDefinition(jobName);
    recordInternalJobStarted(jobName, messageId);
    logInternalJobDeliveryStart({
      jobName,
      messageId,
      requestId,
      retried,
    });

    try {
      const result = await handler({
        envelope,
        context: {
          messageId,
          requestId,
          retried,
          definition,
        },
      });

      const completed = await markInternalJobExecutionComplete(envelope);
      if (!completed) {
        console.error("[job-queue] completion state could not be persisted", {
          jobName,
          messageId,
          requestId,
          jobId: envelope.jobId,
        });
      }

      if (result && result.status === "skipped") {
        recordInternalJobSkipped(jobName, messageId, result.reason);
        logInternalJobDeliveryResult({
          jobName,
          messageId,
          requestId,
          result: "skipped",
          reason: result.reason,
        });
        return c.json({
          data: {
            status: "skipped",
            reason: result.reason,
            completionPersisted: completed,
            meta: result.meta ?? null,
          },
        }, 202);
      }

      recordInternalJobSucceeded(jobName, messageId);
      logInternalJobDeliveryResult({
        jobName,
        messageId,
        requestId,
        result: "success",
      });
      return c.json({
        data: {
          status: "success",
          completionPersisted: completed,
          meta: result?.meta ?? null,
        },
      });
    } catch (error) {
      await releaseInternalJobExecution(envelope);
      const reason = error instanceof Error ? error.message : String(error);
      recordInternalJobFailed(jobName, messageId, reason);
      logInternalJobDeliveryFailure({
        jobName,
        messageId,
        requestId,
        reason,
        error: reason,
      });
      return c.json(jsonError("JOB_EXECUTION_FAILED", "Internal job execution failed"), 500);
    } finally {
      concurrencyLease.release();
    }
  });

  return router;
}

export const internalJobsRouter = createInternalJobsRouter();
