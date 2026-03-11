import { Prisma } from "@prisma/client";
import { prisma } from "../../prisma.js";

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
};

function bucketKey(prefix: string): string {
  const now = new Date();
  const bucket = `${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, "0")}${String(now.getUTCDate()).padStart(2, "0")}${String(now.getUTCHours()).padStart(2, "0")}`;
  return `${prefix}:${bucket}`;
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
  await prisma.notification.create({
    data: {
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
    },
  }).catch(() => undefined);
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
  bundleRiskScore: number | null;
}): Promise<void> {
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
          args.bundleRiskScore !== null &&
          pref.maxBundleRiskScore !== null &&
          args.bundleRiskScore > pref.maxBundleRiskScore
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
          dedupeKey: bucketKey(`posted_alpha:${pref.userId}:${args.postId}`),
        })
      )
  );
}

export async function fanoutTokenSignalAlerts(args: {
  token: {
    id: string;
    address: string;
    symbol: string | null;
    name: string | null;
    liquidity: number | null;
    bundleRiskLabel: string | null;
    tokenRiskScore: number | null;
    confidenceScore: number | null;
    hotAlphaScore: number | null;
    earlyRunnerScore: number | null;
    highConvictionScore: number | null;
  };
  previousToken: {
    bundleRiskLabel: string | null;
    tokenRiskScore: number | null;
    confidenceScore: number | null;
    hotAlphaScore: number | null;
    earlyRunnerScore: number | null;
    highConvictionScore: number | null;
  } | null;
}): Promise<void> {
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

  const alertDefs = [
    {
      key: "early_runner",
      enabled: (pref: AlertPreferenceSnapshot) => pref.notifyEarlyRunners,
      passed: thresholdPassed(args.token.earlyRunnerScore, args.previousToken?.earlyRunnerScore ?? null, 72),
      message: `${symbol} was flagged as an early runner`,
      reasonCode: "early_runner_detected",
      type: "early_runner_detected",
    },
    {
      key: "hot_alpha",
      enabled: (pref: AlertPreferenceSnapshot) => pref.notifyHotAlpha,
      passed: thresholdPassed(args.token.hotAlphaScore, args.previousToken?.hotAlphaScore ?? null, 75),
      message: `${symbol} just entered Hot Alpha`,
      reasonCode: "hot_alpha_detected",
      type: "hot_alpha_detected",
    },
    {
      key: "high_conviction",
      enabled: (pref: AlertPreferenceSnapshot) => pref.notifyHighConviction,
      passed: thresholdPassed(args.token.highConvictionScore, args.previousToken?.highConvictionScore ?? null, 78),
      message: `${symbol} reached high conviction status`,
      reasonCode: "high_conviction_detected",
      type: "high_conviction_detected",
    },
    {
      key: "bundle_risk",
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
      enabled: (pref: AlertPreferenceSnapshot) => pref.notifyConfidenceCross,
      passed: true,
      message: `${symbol} confidence crossed your threshold`,
      reasonCode: "confidence_threshold_crossed",
      type: "token_confidence_crossed",
    },
  ] as const;

  await Promise.all(
    prefs.map(async (pref) => {
      const followsToken = tokenFollowers.has(pref.userId);
      if (!followsToken && !pref.notifyEarlyRunners && !pref.notifyHotAlpha && !pref.notifyHighConviction) {
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
        args.token.tokenRiskScore !== null &&
        args.token.tokenRiskScore > pref.maxBundleRiskScore
      ) {
        return;
      }

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
        } else if (!followsToken && alertDef.key === "bundle_risk") {
          continue;
        }

        await createNotification({
          userId: pref.userId,
          type: alertDef.type,
          message: alertDef.message,
          entityType: "token",
          entityId: args.token.id,
          reasonCode: alertDef.reasonCode,
          payload: {
            tokenAddress: args.token.address,
            symbol: args.token.symbol,
            confidenceScore: args.token.confidenceScore,
            hotAlphaScore: args.token.hotAlphaScore,
            earlyRunnerScore: args.token.earlyRunnerScore,
            highConvictionScore: args.token.highConvictionScore,
            bundleRiskLabel: args.token.bundleRiskLabel,
          },
          dedupeKey: bucketKey(`${alertDef.key}:${pref.userId}:${args.token.id}`),
        });
      }
    })
  );
}
