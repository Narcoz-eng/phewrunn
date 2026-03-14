export type RealtimeTopic =
  | `user:${string}`
  | "feed:latest"
  | `feed:following:${string}`;

export type RealtimeClientChannel = "feed.latest" | "feed.following";

export type RealtimeNotificationUser = {
  id: string;
  name: string;
  username: string | null;
  image: string | null;
  level: number;
};

export type RealtimeNotificationPost = {
  id: string;
  content: string;
  contractAddress: string | null;
};

export type RealtimeNotificationPayload = {
  id: string;
  userId: string;
  type: string;
  message: string;
  read: boolean;
  dismissed: boolean;
  clickedAt: string | null;
  entityType: string | null;
  entityId: string | null;
  reasonCode: string | null;
  payload: unknown | null;
  postId: string | null;
  fromUserId: string | null;
  fromUser: RealtimeNotificationUser | null;
  post: RealtimeNotificationPost | null;
  createdAt: string;
};

export type RealtimePostCounts = {
  likes: number;
  comments: number;
  reposts: number;
};

export type RealtimePostAuthor = {
  id: string;
  name: string;
  username: string | null;
  image: string | null;
  level: number;
  xp: number;
  isVerified?: boolean;
};

export type RealtimePostPayload = {
  id: string;
  content: string;
  authorId: string;
  author: RealtimePostAuthor;
  contractAddress: string | null;
  chainType: string | null;
  tokenName: string | null;
  tokenSymbol: string | null;
  tokenImage: string | null;
  entryMcap: number | null;
  currentMcap: number | null;
  mcap1h: number | null;
  mcap6h: number | null;
  settled: boolean;
  settledAt: string | null;
  isWin: boolean | null;
  createdAt: string;
  lastMcapUpdate?: string | null;
  lastIntelligenceAt?: string | null;
  trackingMode?: string | null;
  dexscreenerUrl: string | null;
  confidenceScore?: number | null;
  hotAlphaScore?: number | null;
  earlyRunnerScore?: number | null;
  highConvictionScore?: number | null;
  timingTier?: string | null;
  firstCallerRank?: number | null;
  roiPeakPct?: number | null;
  roiCurrentPct?: number | null;
  trustedTraderCount?: number;
  entryQualityScore?: number | null;
  bundlePenaltyScore?: number | null;
  sentimentScore?: number | null;
  tokenRiskScore?: number | null;
  bundleRiskLabel?: string | null;
  liquidity?: number | null;
  volume24h?: number | null;
  holderCount?: number | null;
  largestHolderPct?: number | null;
  top10HolderPct?: number | null;
  bundledWalletCount?: number | null;
  estimatedBundledSupplyPct?: number | null;
  reactionCounts?: Record<string, number> | null;
  currentReactionType?: string | null;
  threadCount?: number;
  radarReasons?: string[] | null;
  viewCount?: number;
  isLiked: boolean;
  isReposted: boolean;
  isFollowingAuthor?: boolean;
  _count: RealtimePostCounts;
};

export type RealtimeServerEvent =
  | {
      type: "system.connected";
      eventId: string;
      sentAt: string;
      connectionId: string;
      degraded: boolean;
      channels: RealtimeClientChannel[];
    }
  | {
      type: "system.ping";
      eventId: string;
      sentAt: string;
      connectionId: string;
    }
  | {
      type: "notification.created";
      eventId: string;
      sentAt: string;
      notification: RealtimeNotificationPayload;
    }
  | {
      type: "notification.unread_count";
      eventId: string;
      sentAt: string;
      userId: string;
      count: number;
    }
  | {
      type: "feed.latest.new_post";
      eventId: string;
      sentAt: string;
      post: RealtimePostPayload;
    }
  | {
      type: "feed.following.new_post";
      eventId: string;
      sentAt: string;
      userId: string;
      post: RealtimePostPayload;
    }
  | {
      type: "post.engagement.updated";
      eventId: string;
      sentAt: string;
      postId: string;
      counts: RealtimePostCounts;
      viewerState?: {
        isLiked?: boolean;
        isReposted?: boolean;
      };
    };

export type RealtimeEventInput = RealtimeServerEvent extends infer Event
  ? Event extends { eventId: string; sentAt: string }
    ? Omit<Event, "eventId" | "sentAt">
    : never
  : never;

export type RealtimeClientMessage =
  | {
      type: "subscribe";
      channel: RealtimeClientChannel;
    }
  | {
      type: "unsubscribe";
      channel: RealtimeClientChannel;
    }
  | {
      type: "system.ping";
    };

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function isRealtimeClientChannel(value: unknown): value is RealtimeClientChannel {
  return value === "feed.latest" || value === "feed.following";
}

export function parseRealtimeClientMessage(value: unknown): RealtimeClientMessage | null {
  if (!isRecord(value) || typeof value.type !== "string") {
    return null;
  }

  if (value.type === "system.ping") {
    return { type: "system.ping" };
  }

  if (
    (value.type === "subscribe" || value.type === "unsubscribe") &&
    isRealtimeClientChannel(value.channel)
  ) {
    return {
      type: value.type,
      channel: value.channel,
    };
  }

  return null;
}

export function isRealtimeServerEvent(value: unknown): value is RealtimeServerEvent {
  if (!isRecord(value) || typeof value.type !== "string" || typeof value.eventId !== "string") {
    return false;
  }

  switch (value.type) {
    case "system.connected":
      return typeof value.connectionId === "string" && typeof value.degraded === "boolean";
    case "system.ping":
      return typeof value.connectionId === "string";
    case "notification.created":
      return isRecord(value.notification) && typeof value.notification.id === "string";
    case "notification.unread_count":
      return typeof value.userId === "string" && typeof value.count === "number";
    case "feed.latest.new_post":
      return isRecord(value.post) && typeof value.post.id === "string";
    case "feed.following.new_post":
      return (
        typeof value.userId === "string" &&
        isRecord(value.post) &&
        typeof value.post.id === "string"
      );
    case "post.engagement.updated":
      return (
        typeof value.postId === "string" &&
        isRecord(value.counts) &&
        typeof value.counts.likes === "number" &&
        typeof value.counts.comments === "number" &&
        typeof value.counts.reposts === "number"
      );
    default:
      return false;
  }
}
