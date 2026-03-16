import { Prisma } from "@prisma/client";
import { prisma } from "../../prisma.js";
import { invalidateNotificationsCache } from "../../routes/notifications.js";
import { sendPushToUser, type PushPayload } from "../webPush.js";

// Map notification type to a push-friendly title
function buildPushPayload(data: {
  type: string;
  message: string;
  entityType?: string;
  entityId?: string;
  postId?: string | null;
}): PushPayload {
  const typeToTitle: Record<string, string> = {
    posted_alpha: "New Alpha Posted",
    early_runner_detected: "Early Runner Detected",
    hot_alpha_detected: "Hot Alpha",
    high_conviction_detected: "High Conviction Signal",
    bundle_risk_changed: "Bundle Risk Changed",
    token_confidence_crossed: "Confidence Threshold Crossed",
    token_liquidity_surge: "Liquidity Surge",
    token_holder_growth: "Holders Growing",
    token_momentum: "Momentum Building",
    token_whale_accumulating: "Whales Accumulating",
    token_smart_money: "Smart Money Entering",
    liquidity_spike: "Liquidity Spike",
    volume_spike: "Volume Spike",
    settlement_win: "Trade Won",
    settlement_loss: "Trade Settled",
    like: "New Like",
    comment: "New Comment",
    follow: "New Follower",
    repost: "Repost",
  };

  const title = typeToTitle[data.type] ?? "Phewrunn";

  // Build deep-link URL
  let url = "/notifications";
  if (data.postId) {
    url = `/posts/${data.postId}`;
  } else if (data.entityType === "token" && data.entityId) {
    url = `/tokens/${data.entityId}`;
  }

  return { title, body: data.message, icon: "/phew-mark.svg", badge: "/phew-mark.svg", url, tag: data.type };
}

type AlertPreferenceSnapshot = {
  userId: string;
  minConfidenceScore: number | null;
  minLiquidity: number | null;
  maxBundleRiskScore: number | null;
  notifyFollowedTraders: boolean;
  notifyFollowedTokens: boolean;
  notifyEarlyRunners: boolean;
  notifyHotAlpha: boolean;
  notifyHighConviction: boolean;
  notifyBundleChanges: boolean;
  notifyConfidenceCross: boolean;
  notifyLiquiditySurge: boolean;
  notifyHolderGrowth: boolean;
  notifyMomentum: boolean;
  notifyWhaleAccumulating: boolean;
  notifySmartMoney: boolean;
};

const ALERT_MIN_MARKET_CAP = 5_000;

function bucketKey(prefix: string, now = new Date()): string {
  const bucket = `${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, "0")}${String(now.getUTCDate()).padStart(2, "0")}${String(now.getUTCHours()).padStart(2, "0")}`;
  return `${prefix}:${bucket}`;
}

function bucketKeyByWindow(prefix: string, now = new Date(), windowMinutes = 60): string {
  const windowMs = Math.max(1, windowMinutes) * 60 * 1000;
  const bucket = Math.floor(now.getTime() / windowMs);
  return `${prefix}:${bucket}`;
}

function normalizeSignalDate(value: Date | string | null | undefined): Date | null {
  if (value instanceof Date && Number.isFinite(value.getTime())) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = new Date(value);
    return Number.isFinite(parsed.getTime()) ? parsed : null;
  }
  return null;
}

function buildTokenSignalDedupeKey(args: {
  alertKey: string;
  userId: string;
  tokenId: string;
  fallbackSeed?: string | null;
  signalAt?: Date | string | null;
  cooldownMinutes?: number;
}): string {
  return bucketKeyByWindow(
    `${args.alertKey}:${args.userId}:${args.tokenId}:${args.fallbackSeed ?? "signal"}`,
    normalizeSignalDate(args.signalAt) ?? new Date(),
    args.cooldownMinutes ?? 360
  );
}

async function createNotification(data: {
  userId: string;
  type: string;
  message: string;
  entityType: string;
  entityId: string;
  postId?: string | null;
  fromUserId?: string | null;
  reasonCode?: string | null;
  payload?: Record<string, unknown>;
  dedupeKey: string;
}): Promise<void> {
  try {
    const created = await prisma.notification.createMany({
      data: [{
        userId: data.userId,
        type: data.type,
        message: data.message,
        entityType: data.entityType,
        entityId: data.entityId,
        postId: data.postId ?? null,
        fromUserId: data.fromUserId ?? null,
        reasonCode: data.reasonCode ?? null,
        payload: (data.payload ?? undefined) as Prisma.InputJsonValue | undefined,
        dedupeKey: data.dedupeKey,
        priority: 1,
      }],
      skipDuplicates: true,
    });
    if (created.count > 0) {
      invalidateNotificationsCache(data.userId);
    }
    // Fire push notification non-blocking — don't await, never crash the caller
    if (created.count > 0) {
      void sendPushToUser(data.userId, buildPushPayload(data)).catch(() => {});
    }
  } catch (error) {
    console.warn("[alerts] notification fanout write skipped", {
      userId: data.userId,
      type: data.type,
      entityType: data.entityType,
      entityId: data.entityId,
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

async function readAlertPreferences(): Promise<AlertPreferenceSnapshot[]> {
  const users = await prisma.user.findMany({
    select: { id: true },
  });
  const existingPrefs = await prisma.alertPreference.findMany({
    select: {
      userId: true,
      minConfidenceScore: true,
      minLiquidity: true,
      maxBundleRiskScore: true,
      notifyFollowedTraders: true,
      notifyFollowedTokens: true,
      notifyEarlyRunners: true,
      notifyHotAlpha: true,
      notifyHighConviction: true,
      notifyBundleChanges: true,
      notifyConfidenceCross: true,
      notifyLiquiditySurge: true,
      notifyHolderGrowth: true,
      notifyMomentum: true,
      notifyWhaleAccumulating: true,
      notifySmartMoney: true,
    },
  });

  const prefMap = new Map(existingPrefs.map((pref) => [pref.userId, pref]));
  return users.map((user) => {
    const pref = prefMap.get(user.id);
    return {
      userId: user.id,
      minConfidenceScore: pref?.minConfidenceScore ?? 65,
      minLiquidity: pref?.minLiquidity ?? null,
      maxBundleRiskScore: pref?.maxBundleRiskScore ?? 45,
      notifyFollowedTraders: pref?.notifyFollowedTraders ?? true,
      notifyFollowedTokens: pref?.notifyFollowedTokens ?? true,
      notifyEarlyRunners: pref?.notifyEarlyRunners ?? true,
      notifyHotAlpha: pref?.notifyHotAlpha ?? true,
      notifyHighConviction: pref?.notifyHighConviction ?? true,
      notifyBundleChanges: pref?.notifyBundleChanges ?? true,
      notifyConfidenceCross: pref?.notifyConfidenceCross ?? true,
      notifyLiquiditySurge: pref?.notifyLiquiditySurge ?? true,
      notifyHolderGrowth: pref?.notifyHolderGrowth ?? true,
      notifyMomentum: pref?.notifyMomentum ?? true,
      notifyWhaleAccumulating: pref?.notifyWhaleAccumulating ?? true,
      notifySmartMoney: pref?.notifySmartMoney ?? true,
    };
  });
}

export async function fanoutPostedAlphaAlert(args: {
  postId: string;
  authorId: string;
  authorLabel: string;
  tokenId: string | null;
  tokenSymbol: string | null;
  confidenceScore: number | null;
  liquidity: number | null;
  entryMcap: number | null;
  estimatedBundledSupplyPct: number | null;
}): Promise<void> {
  if (args.entryMcap === null || args.entryMcap < ALERT_MIN_MARKET_CAP) {
    return;
  }

  const [follows, tokenFollows, prefs] = await Promise.all([
    prisma.follow.findMany({
      where: { followingId: args.authorId },
      select: { followerId: true },
    }),
    args.tokenId
      ? prisma.tokenFollow.findMany({
          where: { tokenId: args.tokenId },
          select: { userId: true },
        })
      : Promise.resolve([]),
    readAlertPreferences(),
  ]);

  const followers = new Set(follows.map((follow) => follow.followerId));
  const tokenFollowers = new Set(tokenFollows.map((follow) => follow.userId));

  await Promise.all(
    prefs
      .filter((pref) => pref.userId !== args.authorId)
      .filter((pref) => {
        const followsTrader = followers.has(pref.userId);
        const followsToken = tokenFollowers.has(pref.userId);
        if (!followsTrader && !followsToken) return false;
        if (args.confidenceScore !== null && pref.minConfidenceScore !== null && args.confidenceScore < pref.minConfidenceScore) {
          return false;
        }
        if (args.liquidity !== null && pref.minLiquidity !== null && args.liquidity < pref.minLiquidity) {
          return false;
        }
        if (
          pref.maxBundleRiskScore !== null &&
          args.estimatedBundledSupplyPct !== null &&
          args.estimatedBundledSupplyPct > pref.maxBundleRiskScore
        ) {
          return false;
        }
        // Trader followers already receive the primary new-post notification fanout.
        // Keep this alert path for token followers so one post does not generate two
        // nearly identical notifications for the same user.
        return followsToken && pref.notifyFollowedTokens && !followsTrader;
      })
      .map((pref) =>
        createNotification({
          userId: pref.userId,
          type: "posted_alpha",
          message: `${args.authorLabel} posted alpha${args.tokenSymbol ? ` on ${args.tokenSymbol}` : ""}`,
          entityType: "call",
          entityId: args.postId,
          postId: args.postId,
          fromUserId: args.authorId,
          reasonCode: "followed_source_posted",
          payload: {
            tokenId: args.tokenId,
            tokenSymbol: args.tokenSymbol,
            confidenceScore: args.confidenceScore,
          },
          dedupeKey: `posted_alpha:${pref.userId}:${args.postId}`,
        })
      )
  );
}

export async function fanoutTokenSignalAlerts(args: {
  marketCap: number | null;
  token: {
    id: string;
    address: string;
    symbol: string | null;
    name: string | null;
    liquidity: number | null;
    bundleRiskLabel: string | null;
    tokenRiskScore: number | null;
    estimatedBundledSupplyPct: number | null;
    confidenceScore: number | null;
    hotAlphaScore: number | null;
    earlyRunnerScore: number | null;
    highConvictionScore: number | null;
    lastIntelligenceAt: Date | string | null;
  };
  previousToken: {
    bundleRiskLabel: string | null;
    tokenRiskScore: number | null;
    confidenceScore: number | null;
    hotAlphaScore: number | null;
    earlyRunnerScore: number | null;
    highConvictionScore: number | null;
    liquidity?: number | null;
    holderCount?: number | null;
  } | null;
  holderStats?: {
    holderCount: number | null;
    previousHolderCount: number | null;
    whaleAccumulatingCount: number;
    smartMoneyCount: number;
  } | null;
}): Promise<void> {
  if (args.marketCap === null || args.marketCap < ALERT_MIN_MARKET_CAP) {
    return;
  }

  const [prefs, tokenFollows] = await Promise.all([
    readAlertPreferences(),
    prisma.tokenFollow.findMany({
      where: { tokenId: args.token.id },
      select: { userId: true },
    }),
  ]);

  const tokenFollowers = new Set(tokenFollows.map((follow) => follow.userId));
  const symbol = args.token.symbol ?? args.token.name ?? args.token.address.slice(0, 6);
  const thresholdPassed = (current: number | null, previous: number | null, threshold: number) =>
    (current ?? 0) >= threshold && (previous ?? 0) < threshold;
  const signalAt = normalizeSignalDate(args.token.lastIntelligenceAt) ?? new Date();
  const confidenceBand = (score: number | null, threshold: number) => {
    const safeScore = Math.max(threshold, Math.round(score ?? threshold));
    return `${Math.floor(safeScore / 5) * 5}`;
  };

  // Smart signal computations
  const prevLiquidity = args.previousToken?.liquidity ?? null;
  const currLiquidity = args.token.liquidity;
  const liquiditySurgePassed =
    currLiquidity !== null && prevLiquidity !== null && prevLiquidity > 0
      ? currLiquidity / prevLiquidity >= 1.5
      : false;

  const currHolders = args.holderStats?.holderCount ?? null;
  const prevHolders = args.holderStats?.previousHolderCount ?? null;
  const holderGrowthPassed =
    currHolders !== null && prevHolders !== null && prevHolders > 0
      ? currHolders / prevHolders >= 1.15
      : false;

  const prevMcap = args.previousToken ? (args.marketCap ?? 0) * 0.7 : null; // fallback: estimate
  const momentumPassed =
    args.marketCap !== null && args.previousToken !== null
      ? (() => {
          // Use confidence score jump as a momentum proxy when mcap delta isn't passed
          const confJump = (args.token.confidenceScore ?? 0) - (args.previousToken?.confidenceScore ?? 0);
          return confJump >= 15 || thresholdPassed(args.token.hotAlphaScore, args.previousToken?.hotAlphaScore ?? null, 65);
        })()
      : false;

  const whaleCount = args.holderStats?.whaleAccumulatingCount ?? 0;
  const smartCount = args.holderStats?.smartMoneyCount ?? 0;
  const whaleAccumulatingPassed = whaleCount >= 1;
  const smartMoneyPassed = smartCount >= 1;

  const alertDefs = [
    {
      key: "early_runner",
      priority: 3,
      cooldownMinutes: 12 * 60,
      enabled: (pref: AlertPreferenceSnapshot) => pref.notifyEarlyRunners,
      passed: thresholdPassed(args.token.earlyRunnerScore, args.previousToken?.earlyRunnerScore ?? null, 72),
      message: `${symbol} was flagged as an early runner`,
      reasonCode: "early_runner_detected",
      type: "early_runner_detected",
    },
    {
      key: "hot_alpha",
      priority: 4,
      cooldownMinutes: 12 * 60,
      enabled: (pref: AlertPreferenceSnapshot) => pref.notifyHotAlpha,
      passed: thresholdPassed(args.token.hotAlphaScore, args.previousToken?.hotAlphaScore ?? null, 75),
      message: `${symbol} just entered Hot Alpha`,
      reasonCode: "hot_alpha_detected",
      type: "hot_alpha_detected",
    },
    {
      key: "high_conviction",
      priority: 5,
      cooldownMinutes: 12 * 60,
      enabled: (pref: AlertPreferenceSnapshot) => pref.notifyHighConviction,
      passed: thresholdPassed(args.token.highConvictionScore, args.previousToken?.highConvictionScore ?? null, 78),
      message: `${symbol} reached high conviction status`,
      reasonCode: "high_conviction_detected",
      type: "high_conviction_detected",
    },
    {
      key: "bundle_risk",
      priority: 2,
      cooldownMinutes: 6 * 60,
      enabled: (pref: AlertPreferenceSnapshot) => pref.notifyBundleChanges,
      passed:
        args.previousToken !== null &&
        args.previousToken.bundleRiskLabel !== args.token.bundleRiskLabel,
      message: `${symbol} bundle risk changed to ${args.token.bundleRiskLabel ?? "unknown"}`,
      reasonCode: "bundle_risk_changed",
      type: "bundle_risk_changed",
    },
    {
      key: "confidence_cross",
      priority: 1,
      cooldownMinutes: 8 * 60,
      enabled: (pref: AlertPreferenceSnapshot) => pref.notifyConfidenceCross,
      passed: true,
      message: `${symbol} confidence crossed your threshold`,
      reasonCode: "confidence_threshold_crossed",
      type: "token_confidence_crossed",
    },
    // Smart money & on-chain signals
    {
      key: "smart_money",
      priority: 8,
      cooldownMinutes: 6 * 60,
      enabled: (pref: AlertPreferenceSnapshot) => pref.notifySmartMoney,
      passed: smartMoneyPassed,
      message: smartCount > 1 ? `${smartCount} smart money wallets are buying ${symbol}` : `Smart money is buying ${symbol}`,
      reasonCode: "smart_money_detected",
      type: "token_smart_money",
    },
    {
      key: "whale_accumulating",
      priority: 7,
      cooldownMinutes: 6 * 60,
      enabled: (pref: AlertPreferenceSnapshot) => pref.notifyWhaleAccumulating,
      passed: whaleAccumulatingPassed,
      message: whaleCount > 1 ? `${whaleCount} whales are accumulating ${symbol}` : `A whale is accumulating ${symbol}`,
      reasonCode: "whale_accumulating",
      type: "token_whale_accumulating",
    },
    {
      key: "momentum",
      priority: 6,
      cooldownMinutes: 4 * 60,
      enabled: (pref: AlertPreferenceSnapshot) => pref.notifyMomentum,
      passed: momentumPassed,
      message: `${symbol} is picking up momentum`,
      reasonCode: "momentum_detected",
      type: "token_momentum",
    },
    {
      key: "holder_growth",
      priority: 4,
      cooldownMinutes: 4 * 60,
      enabled: (pref: AlertPreferenceSnapshot) => pref.notifyHolderGrowth,
      passed: holderGrowthPassed,
      message: `${symbol} holders are growing fast`,
      reasonCode: "holder_growth_detected",
      type: "token_holder_growth",
    },
    {
      key: "liquidity_surge",
      priority: 6,
      cooldownMinutes: 4 * 60,
      enabled: (pref: AlertPreferenceSnapshot) => pref.notifyLiquiditySurge,
      passed: liquiditySurgePassed,
      message: `${symbol} liquidity surged 50%+`,
      reasonCode: "liquidity_surge_detected",
      type: "token_liquidity_surge",
    },
  ];

  await Promise.all(
    prefs.map(async (pref) => {
      const followsToken = tokenFollowers.has(pref.userId);
      if (
        !followsToken &&
        !pref.notifyEarlyRunners &&
        !pref.notifyHotAlpha &&
        !pref.notifyHighConviction &&
        !pref.notifyConfidenceCross &&
        !pref.notifyLiquiditySurge &&
        !pref.notifyHolderGrowth &&
        !pref.notifyMomentum &&
        !pref.notifyWhaleAccumulating &&
        !pref.notifySmartMoney
      ) {
        return;
      }
      if (
        pref.minLiquidity !== null &&
        args.token.liquidity !== null &&
        args.token.liquidity < pref.minLiquidity
      ) {
        return;
      }
      if (
        pref.maxBundleRiskScore !== null &&
        args.token.estimatedBundledSupplyPct !== null &&
        args.token.estimatedBundledSupplyPct > pref.maxBundleRiskScore
      ) {
        return;
      }

      const eligibleAlerts: Array<{
        key: string;
        priority: number;
        cooldownMinutes: number;
        type: string;
        message: string;
        reasonCode: string;
        fallbackSeed: string | null;
      }> = [];

      for (const alertDef of alertDefs) {
        if (!alertDef.enabled(pref)) continue;
        if (!alertDef.passed) continue;

        if (alertDef.key === "confidence_cross") {
          const minConfidence = pref.minConfidenceScore ?? 65;
          if ((args.token.confidenceScore ?? 0) < minConfidence) {
            continue;
          }
          if ((args.previousToken?.confidenceScore ?? 0) >= minConfidence) {
            continue;
          }
          eligibleAlerts.push({
            key: alertDef.key,
            priority: alertDef.priority,
            cooldownMinutes: alertDef.cooldownMinutes,
            type: alertDef.type,
            message: alertDef.message,
            reasonCode: alertDef.reasonCode,
            fallbackSeed: `threshold:${minConfidence}:band:${confidenceBand(args.token.confidenceScore, minConfidence)}`,
          });
        } else if (!followsToken && alertDef.key === "bundle_risk") {
          continue;
        } else {
          const scoreSeed =
            alertDef.key === "bundle_risk"
              ? args.token.bundleRiskLabel
              : String(
                  Math.round(
                    alertDef.key === "high_conviction"
                      ? args.token.highConvictionScore ?? 0
                      : alertDef.key === "hot_alpha"
                        ? args.token.hotAlphaScore ?? 0
                        : args.token.earlyRunnerScore ?? 0
                  )
                );
          eligibleAlerts.push({
            key: alertDef.key,
            priority: alertDef.priority,
            cooldownMinutes: alertDef.cooldownMinutes,
            type: alertDef.type,
            message: alertDef.message,
            reasonCode: alertDef.reasonCode,
            fallbackSeed: scoreSeed,
          });
        }
      }

      const strongestAlert = eligibleAlerts.sort((left, right) => right.priority - left.priority)[0];
      if (!strongestAlert) {
        return;
      }

      await createNotification({
        userId: pref.userId,
        type: strongestAlert.type,
        message: strongestAlert.message,
        entityType: "token",
        entityId: args.token.id,
        reasonCode: strongestAlert.reasonCode,
        payload: {
          tokenAddress: args.token.address,
          symbol: args.token.symbol,
          marketCap: args.marketCap,
          confidenceScore: args.token.confidenceScore,
          hotAlphaScore: args.token.hotAlphaScore,
          earlyRunnerScore: args.token.earlyRunnerScore,
          highConvictionScore: args.token.highConvictionScore,
          bundleRiskLabel: args.token.bundleRiskLabel,
          estimatedBundledSupplyPct: args.token.estimatedBundledSupplyPct,
        },
        dedupeKey: buildTokenSignalDedupeKey({
          alertKey: strongestAlert.key,
          userId: pref.userId,
          tokenId: args.token.id,
          signalAt,
          cooldownMinutes: strongestAlert.cooldownMinutes,
          fallbackSeed: strongestAlert.fallbackSeed,
        }),
      });
    })
  );
}
