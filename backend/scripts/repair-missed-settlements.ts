import { prisma } from "../src/prisma.js";
import { enqueueInternalJob, hasQStashPublishConfig } from "../src/lib/job-queue.js";
import {
  buildPostAutoSettlementJobInput,
  runSettlementJob,
} from "../src/routes/posts.js";

const ONE_HOUR_MS = 60 * 60 * 1000;
const MAX_SETTLEMENT_LOOPS = 100;

async function scheduleMissingDelayedSettlementJobs(): Promise<number> {
  if (!hasQStashPublishConfig()) {
    return 0;
  }

  const pendingFutureWindow = await prisma.post.findMany({
    where: {
      settled: false,
      contractAddress: { not: null },
      entryMcap: { gt: 0 },
      createdAt: { gte: new Date(Date.now() - ONE_HOUR_MS) },
    },
    select: {
      id: true,
      createdAt: true,
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });

  let scheduled = 0;
  for (const post of pendingFutureWindow) {
    await enqueueInternalJob(
      buildPostAutoSettlementJobInput({
        postId: post.id,
        createdAt: post.createdAt,
      })
    );
    scheduled += 1;
  }

  return scheduled;
}

async function repairMissedSettlements(): Promise<void> {
  const overdueWhere = {
    settled: false,
    contractAddress: { not: null },
    entryMcap: { gt: 0 },
    createdAt: { lt: new Date(Date.now() - ONE_HOUR_MS) },
  } as const;

  const overdueBefore = await prisma.post.count({ where: overdueWhere });
  const scheduledFutureJobs = await scheduleMissingDelayedSettlementJobs();

  let loops = 0;
  let repaired = 0;
  let snapshot6h = 0;
  let levelChanges6h = 0;
  let errors = 0;

  while (loops < MAX_SETTLEMENT_LOOPS) {
    loops += 1;
    const result = await runSettlementJob();
    repaired += result.settled1h;
    snapshot6h += result.snapshot6h;
    levelChanges6h += result.levelChanges6h;
    errors += result.errors;
    if (result.settled1h === 0) {
      break;
    }
  }

  const overdueAfter = await prisma.post.count({ where: overdueWhere });

  console.log(
    JSON.stringify(
      {
        overdueBefore,
        overdueAfter,
        repaired,
        repairedByDelta: Math.max(0, overdueBefore - overdueAfter),
        scheduledFutureJobs,
        snapshot6h,
        levelChanges6h,
        errors,
        loops,
        usedCurrentBestAvailableMarketCapFallback: true,
      },
      null,
      2
    )
  );
}

try {
  await repairMissedSettlements();
} finally {
  await prisma.$disconnect().catch(() => undefined);
}
