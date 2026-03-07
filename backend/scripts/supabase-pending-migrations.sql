-- Apply the remaining pending Prisma migrations directly in Supabase SQL Editor.
-- Safe to rerun because every statement is idempotent.
SET statement_timeout = 0;

-- 20260306_add_runtime_compat_columns
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "tradeFeeRewardsEnabled" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "tradeFeeShareBps" INTEGER NOT NULL DEFAULT 100;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "tradeFeePayoutAddress" TEXT;
ALTER TABLE "Post" ADD COLUMN IF NOT EXISTS "dexscreenerUrl" TEXT;
ALTER TABLE "Notification" ADD COLUMN IF NOT EXISTS "dismissed" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Notification" ADD COLUMN IF NOT EXISTS "clickedAt" TIMESTAMP(3);

-- 20260307_add_aggregate_snapshot_and_post_indexes
CREATE TABLE IF NOT EXISTS "AggregateSnapshot" (
  "key" TEXT NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "payload" JSONB NOT NULL,
  "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AggregateSnapshot_pkey" PRIMARY KEY ("key")
);

CREATE INDEX IF NOT EXISTS "AggregateSnapshot_expiresAt_idx" ON "AggregateSnapshot"("expiresAt");
CREATE INDEX IF NOT EXISTS "AggregateSnapshot_capturedAt_idx" ON "AggregateSnapshot"("capturedAt");
CREATE INDEX IF NOT EXISTS "Post_createdAt_authorId_idx" ON "Post"("createdAt", "authorId");
CREATE INDEX IF NOT EXISTS "Post_settled_isWin_authorId_idx" ON "Post"("settled", "isWin", "authorId");
