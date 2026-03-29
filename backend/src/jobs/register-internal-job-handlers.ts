import { z } from "zod";
import {
  registerInternalJobHandler,
  type InternalJobResult,
} from "../lib/job-queue.js";
import { runPostCreateFanout } from "../routes/posts.js";
import {
  sendPushToUserNow,
  sendPushToUsersNow,
  type PushPayload,
} from "../services/webPush.js";

const postFanoutPayloadSchema = z.object({
  authorId: z.string().min(1),
  authorName: z.string().min(1),
  authorUsername: z.string().nullable(),
  postId: z.string().min(1),
});

const pushPayloadSchema = z.object({
  title: z.string().min(1),
  body: z.string().min(1),
  icon: z.string().optional(),
  badge: z.string().optional(),
  url: z.string().optional(),
  tag: z.string().optional(),
}) satisfies z.ZodType<PushPayload>;

const pushDeliveryPayloadSchema = z.object({
  userIds: z.array(z.string().min(1)).min(1).max(500),
  payload: pushPayloadSchema,
});

let handlersRegistered = false;

function coerceResult(meta?: Record<string, string | number | boolean | null | undefined>): InternalJobResult {
  return {
    status: "success",
    meta,
  };
}

export function registerInternalJobHandlers(): void {
  if (handlersRegistered) {
    return;
  }
  handlersRegistered = true;

  registerInternalJobHandler("post_fanout", async ({ envelope }) => {
    const payload = postFanoutPayloadSchema.parse(envelope.payload);
    await runPostCreateFanout(payload);
    return coerceResult({ postId: payload.postId });
  });

  registerInternalJobHandler("push_delivery", async ({ envelope }) => {
    const payload = pushDeliveryPayloadSchema.parse(envelope.payload);
    if (payload.userIds.length === 1) {
      const [userId] = payload.userIds;
      if (userId) {
        await sendPushToUserNow(userId, payload.payload);
      }
    } else {
      await sendPushToUsersNow(payload.userIds, payload.payload);
    }
    return coerceResult({ recipients: payload.userIds.length });
  });
}

registerInternalJobHandlers();
