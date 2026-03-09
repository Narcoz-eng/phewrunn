import { prisma } from "../../prisma.js";
import { computeTraderTrustScore } from "./scoring.js";

type TraderMetrics = {
  winRate7d: number;
  winRate30d: number;
  avgRoi7d: number;
  avgRoi30d: number;
  settledCount30d: number;
  firstCallCount: number;
  firstCallAvgRoi: number | null;
  trustScore: number;
  reputationTier: string;
};

type SettledPostSnapshot = {
  createdAt: Date;
  isWin: boolean | null;
  entryMcap: number | null;
  currentMcap: number | null;
  mcap1h: number | null;
  mcap6h: number | null;
  roiPeakPct: number | null;
  firstCallerRank: number | null;
};

function clampMetric(value: number): number {
  return Math.round(value * 100) / 100;
}

function deriveRoiPeakPct(post: SettledPostSnapshot): number | null {
  const candidates: number[] = [];
  if (typeof post.roiPeakPct === "number" && Number.isFinite(post.roiPeakPct)) {
    candidates.push(post.roiPeakPct);
  }

  const entryMcap = post.entryMcap;
  if (typeof entryMcap === "number" && entryMcap > 0) {
    const mcapCandidates = [post.currentMcap, post.mcap1h, post.mcap6h];
    for (const marketCap of mcapCandidates) {
      if (typeof marketCap === "number" && Number.isFinite(marketCap)) {
        candidates.push(((marketCap - entryMcap) / entryMcap) * 100);
      }
    }
  }

  if (candidates.length === 0) return null;
  return Math.max(...candidates);
}

function getReputationTier(trustScore: number): string {
  if (trustScore >= 85) return "Legend";
  if (trustScore >= 72) return "Elite";
  if (trustScore >= 58) return "Trusted";
  if (trustScore >= 42) return "Provisional";
  return "Unproven";
}

function summarizeWindow(posts: SettledPostSnapshot[], windowStartMs: number): {
  winRate: number;
  avgRoi: number;
  settledCount: number;
} {
  const inWindow = posts.filter((post) => post.createdAt.getTime() >= windowStartMs);
  const settledCount = inWindow.length;
  if (settledCount === 0) {
    return {
      winRate: 0,
      avgRoi: 0,
      settledCount: 0,
    };
  }

  let winCount = 0;
  let roiTotal = 0;
  let roiCount = 0;

  for (const post of inWindow) {
    if (post.isWin === true) {
      winCount += 1;
    }
    const roi = deriveRoiPeakPct(post);
    if (typeof roi === "number" && Number.isFinite(roi)) {
      roiTotal += roi;
      roiCount += 1;
    }
  }

  return {
    winRate: settledCount > 0 ? (winCount / settledCount) * 100 : 0,
    avgRoi: roiCount > 0 ? roiTotal / roiCount : 0,
    settledCount,
  };
}

export async function computeTraderMetricsMap(authorIds: string[]): Promise<Map<string, TraderMetrics>> {
  const uniqueAuthorIds = [...new Set(authorIds.filter((authorId) => authorId.trim().length > 0))];
  const metricsByAuthor = new Map<string, TraderMetrics>();

  if (uniqueAuthorIds.length === 0) {
    return metricsByAuthor;
  }

  const posts = await prisma.post.findMany({
    where: {
      authorId: { in: uniqueAuthorIds },
      settled: true,
    },
    select: {
      authorId: true,
      createdAt: true,
      isWin: true,
      entryMcap: true,
      currentMcap: true,
      mcap1h: true,
      mcap6h: true,
      roiPeakPct: true,
      firstCallerRank: true,
    },
    orderBy: { createdAt: "desc" },
  });

  const postsByAuthor = new Map<string, SettledPostSnapshot[]>();
  for (const post of posts) {
    const bucket = postsByAuthor.get(post.authorId) ?? [];
    bucket.push(post);
    postsByAuthor.set(post.authorId, bucket);
  }

  const now = Date.now();
  const sevenDaysAgoMs = now - 7 * 24 * 60 * 60 * 1000;
  const thirtyDaysAgoMs = now - 30 * 24 * 60 * 60 * 1000;

  for (const authorId of uniqueAuthorIds) {
    const authorPosts = postsByAuthor.get(authorId) ?? [];
    const summary7d = summarizeWindow(authorPosts, sevenDaysAgoMs);
    const summary30d = summarizeWindow(authorPosts, thirtyDaysAgoMs);

    const firstCallPosts = authorPosts.filter((post) => post.firstCallerRank === 1);
    let firstCallAvgRoi: number | null = null;
    if (firstCallPosts.length > 0) {
      const total = firstCallPosts.reduce((sum, post) => sum + (deriveRoiPeakPct(post) ?? 0), 0);
      firstCallAvgRoi = total / firstCallPosts.length;
    }

    const trustScore = computeTraderTrustScore({
      winRate30d: summary30d.winRate,
      avgRoi30d: summary30d.avgRoi,
      settledCount30d: summary30d.settledCount,
      firstCallCount: firstCallPosts.length,
      firstCallAvgRoi,
    });

    metricsByAuthor.set(authorId, {
      winRate7d: clampMetric(summary7d.winRate),
      winRate30d: clampMetric(summary30d.winRate),
      avgRoi7d: clampMetric(summary7d.avgRoi),
      avgRoi30d: clampMetric(summary30d.avgRoi),
      settledCount30d: summary30d.settledCount,
      firstCallCount: firstCallPosts.length,
      firstCallAvgRoi: firstCallAvgRoi === null ? null : clampMetric(firstCallAvgRoi),
      trustScore: clampMetric(trustScore),
      reputationTier: getReputationTier(trustScore),
    });
  }

  return metricsByAuthor;
}

export async function refreshTraderMetrics(authorIds: string[]): Promise<void> {
  const metricsByAuthor = await computeTraderMetricsMap(authorIds);
  if (metricsByAuthor.size === 0) return;

  const now = new Date();
  const bucketDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

  await Promise.all(
    Array.from(metricsByAuthor.entries()).map(async ([authorId, metrics]) => {
      await prisma.user.update({
        where: { id: authorId },
        data: {
          winRate7d: metrics.winRate7d,
          winRate30d: metrics.winRate30d,
          avgRoi7d: metrics.avgRoi7d,
          avgRoi30d: metrics.avgRoi30d,
          trustScore: metrics.trustScore,
          reputationTier: metrics.reputationTier,
          firstCallCount: metrics.firstCallCount,
          firstCallAvgRoi: metrics.firstCallAvgRoi,
          lastTraderMetricsAt: now,
        },
      }).catch(() => undefined);

      await prisma.traderMetricDaily.upsert({
        where: {
          traderId_bucketDate: {
            traderId: authorId,
            bucketDate,
          },
        },
        create: {
          traderId: authorId,
          bucketDate,
          callsCount: metrics.settledCount30d,
          settledCount: metrics.settledCount30d,
          winRate: metrics.winRate30d,
          avgRoi: metrics.avgRoi30d,
          firstCalls: metrics.firstCallCount,
          firstCallAvgRoi: metrics.firstCallAvgRoi,
          trustScore: metrics.trustScore,
        },
        update: {
          callsCount: metrics.settledCount30d,
          settledCount: metrics.settledCount30d,
          winRate: metrics.winRate30d,
          avgRoi: metrics.avgRoi30d,
          firstCalls: metrics.firstCallCount,
          firstCallAvgRoi: metrics.firstCallAvgRoi,
          trustScore: metrics.trustScore,
        },
      }).catch(() => undefined);
    })
  );
}
