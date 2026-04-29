import { z } from "zod";
import {
  registerInternalJobHandler,
  type InternalJobResult,
} from "../lib/job-queue.js";
import {
  runIntelligenceRefreshJob,
  runChartRefreshJob,
  runMarketRefreshJob,
  runPostCreateFanout,
  runSettlementJob,
} from "../routes/posts.js";
import { runDiscoverySidebarRefreshJob } from "../routes/discovery.js";
import { runLeaderboardStatsRefresh } from "../routes/leaderboard.js";
import { runMaterializedFeedRefreshJob } from "../services/materialized-feed.js";
import { refreshFeedChartPreview } from "../services/feed-chart-preview.js";
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
const feedRefreshPayloadSchema = maintenanceReasonPayloadSchema.extend({
  kind: z.enum(["latest", "hot-alpha", "early-runners", "high-conviction", "following"]).nullable().optional(),
  viewerId: z.string().min(1).nullable().optional(),
});
const chartRefreshPayloadSchema = maintenanceReasonPayloadSchema.extend({
  purpose: z.enum(["feed-preview", "candles"]).optional(),
  tokenAddress: z.string().min(1).nullable().optional(),
  pairAddress: z.string().min(1).nullable().optional(),
  poolAddress: z.string().min(1).nullable().optional(),
  chainType: z.enum(["solana", "evm", "ethereum"]).nullable().optional(),
  timeframe: z.enum(["minute", "hour", "day"]).optional(),
  aggregate: z.number().int().min(1).max(240).optional(),
  limit: z.number().int().min(20).max(720).optional(),
});
const settlementPayloadSchema = maintenanceReasonPayloadSchema.extend({
  postId: z.string().min(1).max(128).optional(),
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

  registerInternalJobHandler("feed_refresh", async ({ envelope }) => {
    const payload = feedRefreshPayloadSchema.parse(envelope.payload);
    const result = await runMaterializedFeedRefreshJob({
      kind: payload.kind ?? null,
      viewerId: payload.viewerId ?? null,
    });
    return coerceResult(result);
  });

  registerInternalJobHandler("sidebar_refresh", async ({ envelope }) => {
    maintenanceReasonPayloadSchema.parse(envelope.payload);
    const data = await runDiscoverySidebarRefreshJob();
    return coerceResult({
      topGainers: data?.topGainers.length ?? 0,
      trendingCalls: data?.trendingCalls.length ?? 0,
      whaleRows: data?.whaleActivity.length ?? 0,
    });
  });

  registerInternalJobHandler("chart_refresh", async ({ envelope }) => {
    const payload = chartRefreshPayloadSchema.parse(envelope.payload);
    if (payload.purpose === "feed-preview") {
      const result = await refreshFeedChartPreview({
        tokenAddress: payload.tokenAddress ?? null,
        pairAddress: payload.pairAddress ?? payload.poolAddress ?? null,
        chainType: payload.chainType ?? null,
      });
      return coerceResult({
        state: result.state,
        source: result.source,
        candles: result.candles?.length ?? 0,
      });
    }

    const result = await runChartRefreshJob({
      tokenAddress: payload.tokenAddress ?? undefined,
      poolAddress: payload.poolAddress ?? payload.pairAddress ?? undefined,
      chainType: payload.chainType ?? undefined,
      timeframe: payload.timeframe ?? "minute",
      aggregate: payload.aggregate ?? 5,
      limit: payload.limit ?? 260,
    });
    return coerceResult({
      refreshed: result.refreshed,
      source: result.source,
      candles: result.candles,
      skippedReason: result.skippedReason,
    });
  });

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
    const payload = settlementPayloadSchema.parse(envelope.payload);
    const result = await runSettlementJob({
      postId: payload.postId ?? null,
    });
    return coerceResult({
      settled1h: result.settled1h,
      snapshot6h: result.snapshot6h,
      levelChanges6h: result.levelChanges6h,
      errors: result.errors,
      postId: payload.postId ?? null,
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
