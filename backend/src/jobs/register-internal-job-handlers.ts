import { z } from "zod";
import {
  registerInternalJobHandler,
  type InternalJobResult,
} from "../lib/job-queue.js";
import {
  runIntelligenceRefreshJob,
  runMarketRefreshJob,
  runPostCreateFanout,
  runSettlementJob,
} from "../routes/posts.js";
import { runLeaderboardStatsRefresh } from "../routes/leaderboard.js";
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
const maintenanceReasonPayloadSchema = z.object({
  reason: z.string().min(1).max(160).optional(),
});
const intelligenceRefreshPayloadSchema = maintenanceReasonPayloadSchema.extend({
  contractAddress: z.string().trim().min(1).optional(),
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

  registerInternalJobHandler("settlement", async ({ envelope }) => {
    maintenanceReasonPayloadSchema.parse(envelope.payload);
    const result = await runSettlementJob();
    return coerceResult({
      settled1h: result.settled1h,
      snapshot6h: result.snapshot6h,
      levelChanges6h: result.levelChanges6h,
      errors: result.errors,
    });
  });

  registerInternalJobHandler("market_refresh", async ({ envelope }) => {
    maintenanceReasonPayloadSchema.parse(envelope.payload);
    const result = await runMarketRefreshJob();
    return coerceResult({
      refreshedContracts: result.marketRefresh.refreshedContracts,
      updatedPosts: result.marketRefresh.updatedPosts,
      liquiditySpikes: result.marketAlerts.liquiditySpikes,
      volumeSpikes: result.marketAlerts.volumeSpikes,
      errors: result.marketRefresh.errors + result.marketAlerts.errors,
    });
  });

  registerInternalJobHandler("intelligence_refresh", async ({ envelope }) => {
    const payload = intelligenceRefreshPayloadSchema.parse(envelope.payload);
    const result = await runIntelligenceRefreshJob({
      contractAddress: payload.contractAddress ?? null,
    });
    return coerceResult({
      attempted: result.attempted,
      refreshed: result.refreshed,
      skipped: result.skipped,
      errors: result.errors,
      contractAddress: payload.contractAddress ?? null,
    });
  });

  registerInternalJobHandler("leaderboard_refresh", async ({ envelope, context }) => {
    const payload = maintenanceReasonPayloadSchema.parse(envelope.payload);
    const data = await runLeaderboardStatsRefresh({
      requestId: context.requestId,
      source: payload.reason ?? "/api/internal/jobs/leaderboard_refresh",
    });
    return coerceResult({
      totalUsers: data.totalUsers,
      topUsersThisWeek: data.topUsersThisWeek.length,
    });
  });
}

registerInternalJobHandlers();
