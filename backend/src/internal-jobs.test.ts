import { createHash, createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL ??= "file:./prisma/test.db";
process.env.BACKEND_URL ??= "https://backend.example.com";
process.env.PRIVY_APP_ID ??= "test-privy-app-id";
process.env.PRIVY_APP_SECRET ??= "test-privy-app-secret";
process.env.AUTH_SESSION_TOKEN_SECRET ??= "test-session-secret-1234567890abcdef";

const {
  createQStashPublishRequest,
  getInternalJobMetricsSnapshot,
  resetInternalJobQueueTestingState,
} = await import("./lib/job-queue.js");
const { createInternalJobsRouter } = await import("./routes/internal-jobs.js");

const TEST_SIGNING_KEYS = {
  current: "test-current-signing-key-0123456789abcdef",
  next: "test-next-signing-key-fedcba9876543210",
};

function createSignedQStashToken(params: {
  requestUrl: string;
  rawBody: string;
  signingKey: string;
}): string {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(
    JSON.stringify({
      iss: "Upstash",
      sub: params.requestUrl,
      exp: nowSeconds + 300,
      nbf: nowSeconds - 5,
      body: createHash("sha256").update(params.rawBody).digest("base64url"),
    })
  ).toString("base64url");
  const signature = createHmac("sha256", params.signingKey)
    .update(`${header}.${payload}`)
    .digest("base64url");
  return `${header}.${payload}.${signature}`;
}

describe("internal job control plane", () => {
  beforeEach(() => {
    resetInternalJobQueueTestingState();
  });

  afterEach(() => {
    resetInternalJobQueueTestingState();
  });

  test("builds QStash publish requests with retries, dedupe, flow control, and failure callback", () => {
    const request = createQStashPublishRequest(
      {
        jobName: "post_fanout",
        idempotencyKey: "post:abc123",
        payload: { postId: "post_123" },
        traceId: "trace_123",
      },
      {
        backendUrl: "https://backend.example.com",
        qstashUrl: "https://qstash.upstash.io",
        qstashToken: "qstash_token",
      }
    );

    expect(request.requestUrl).toBe(
      "https://qstash.upstash.io/v2/publish/https://backend.example.com/api/internal/jobs/post_fanout"
    );
    expect(request.envelope.jobName).toBe("post_fanout");
    expect(request.envelope.traceId).toBe("trace_123");

    const headers = request.requestInit.headers as Headers;
    expect(headers.get("Authorization")).toBe("Bearer qstash_token");
    expect(headers.get("Upstash-Method")).toBe("POST");
    expect(headers.get("Upstash-Retries")).toBe("5");
    expect(headers.get("Upstash-Deduplication-Id")).toContain("internal-job:post_fanout:");
    expect(headers.get("Upstash-Flow-Control-Key")).toBe("job:post_fanout");
    expect(headers.get("Upstash-Flow-Control-Value")).toBe("parallelism=6, rate=120, period=1m");
    expect(headers.get("Upstash-Failure-Callback")).toBe(
      "https://backend.example.com/api/internal/jobs/failures?jobName=post_fanout"
    );
  });

  test("accepts a signed QStash delivery and runs the matching handler once", async () => {
    let handled = 0;
    const router = createInternalJobsRouter({
      signingKeys: TEST_SIGNING_KEYS,
      handlers: {
        post_fanout: async ({ envelope, context }) => {
          handled += 1;
          expect(envelope.payload.postId).toBe("post_123");
          expect(context.messageId).toBe("msg_1");
          expect(context.retried).toBe(0);
        },
      },
    });

    const requestUrl = "https://backend.example.com/post_fanout";
    const rawBody = JSON.stringify({
      version: 1,
      jobName: "post_fanout",
      jobId: "b792af68-564f-4de9-8e7f-fb4d7a1fd2a7",
      idempotencyKey: "post:abc123",
      enqueuedAt: "2026-03-29T12:00:00.000Z",
      payload: { postId: "post_123" },
    });
    const signature = createSignedQStashToken({
      requestUrl,
      rawBody,
      signingKey: TEST_SIGNING_KEYS.current,
    });

    const response = await router.request(requestUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "upstash-signature": signature,
        "upstash-message-id": "msg_1",
        "upstash-retried": "0",
      },
      body: rawBody,
    });

    expect(response.status).toBe(200);
    expect(handled).toBe(1);

    const payload = await response.json();
    expect(payload).toEqual({
      data: {
        status: "success",
        completionPersisted: true,
        meta: null,
      },
    });

    const metrics = getInternalJobMetricsSnapshot();
    expect(metrics.post_fanout.deliveriesStarted).toBe(1);
    expect(metrics.post_fanout.deliveriesSucceeded).toBe(1);
    expect(metrics.post_fanout.deliveriesSkipped).toBe(0);
  });

  test("suppresses duplicate delivery when the same idempotency key is replayed", async () => {
    let handled = 0;
    const router = createInternalJobsRouter({
      signingKeys: TEST_SIGNING_KEYS,
      handlers: {
        post_fanout: async () => {
          handled += 1;
        },
      },
    });

    const requestUrl = "https://backend.example.com/post_fanout";
    const rawBody = JSON.stringify({
      version: 1,
      jobName: "post_fanout",
      jobId: "32c9de2d-521f-4e5b-b93c-7f3f7dbfe9f8",
      idempotencyKey: "post:duplicate",
      enqueuedAt: "2026-03-29T12:00:00.000Z",
      payload: { postId: "post_123" },
    });

    const firstSignature = createSignedQStashToken({
      requestUrl,
      rawBody,
      signingKey: TEST_SIGNING_KEYS.current,
    });
    const secondSignature = createSignedQStashToken({
      requestUrl,
      rawBody,
      signingKey: TEST_SIGNING_KEYS.current,
    });

    const firstResponse = await router.request(requestUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "upstash-signature": firstSignature,
        "upstash-message-id": "msg_1",
      },
      body: rawBody,
    });
    const secondResponse = await router.request(requestUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "upstash-signature": secondSignature,
        "upstash-message-id": "msg_2",
      },
      body: rawBody,
    });

    expect(firstResponse.status).toBe(200);
    expect(secondResponse.status).toBe(202);
    expect(handled).toBe(1);

    const secondPayload = await secondResponse.json();
    expect(secondPayload).toEqual({
      data: {
        status: "skipped",
        reason: "duplicate_delivery",
      },
    });
  });

  test("rejects unsigned or invalidly signed deliveries", async () => {
    const router = createInternalJobsRouter({
      signingKeys: TEST_SIGNING_KEYS,
      handlers: {
        post_fanout: async () => undefined,
      },
    });

    const response = await router.request("https://backend.example.com/post_fanout", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "upstash-signature": "invalid.token.parts",
      },
      body: JSON.stringify({
        version: 1,
        jobName: "post_fanout",
        jobId: "76188dd0-24e7-4257-9ef0-c9a7c65ab603",
        idempotencyKey: "post:invalid",
        enqueuedAt: "2026-03-29T12:00:00.000Z",
        payload: { postId: "post_123" },
      }),
    });

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      error: {
        code: "INVALID_QUEUE_SIGNATURE",
        message: "Invalid queue signature",
      },
    });
  });
});
