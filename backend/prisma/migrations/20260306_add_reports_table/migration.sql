ALTER TABLE "User"
  ADD COLUMN IF NOT EXISTS "lastUsernameUpdate" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "lastPhotoUpdate" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "tradeFeeRewardsEnabled" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "tradeFeeShareBps" INTEGER NOT NULL DEFAULT 100,
  ADD COLUMN IF NOT EXISTS "tradeFeePayoutAddress" TEXT;

ALTER TABLE "Notification"
  ADD COLUMN IF NOT EXISTS "dismissed" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "clickedAt" TIMESTAMP(3);

CREATE TABLE IF NOT EXISTS "Report" (
  "id" TEXT NOT NULL,
  "entityType" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "details" TEXT,
  "status" TEXT NOT NULL DEFAULT 'open',
  "reporterUserId" TEXT NOT NULL,
  "targetUserId" TEXT,
  "postId" TEXT,
  "reviewedById" TEXT,
  "resolvedAt" TIMESTAMP(3),
  "reviewerNotes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Report_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Report_reporterUserId_fkey"
    FOREIGN KEY ("reporterUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "Report_targetUserId_fkey"
    FOREIGN KEY ("targetUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "Report_postId_fkey"
    FOREIGN KEY ("postId") REFERENCES "Post"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "Report_reviewedById_fkey"
    FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "Report_status_createdAt_idx" ON "Report"("status", "createdAt");
CREATE INDEX IF NOT EXISTS "Report_entityType_status_createdAt_idx" ON "Report"("entityType", "status", "createdAt");
CREATE INDEX IF NOT EXISTS "Report_reporterUserId_createdAt_idx" ON "Report"("reporterUserId", "createdAt");
CREATE INDEX IF NOT EXISTS "Report_targetUserId_status_createdAt_idx" ON "Report"("targetUserId", "status", "createdAt");
CREATE INDEX IF NOT EXISTS "Report_postId_status_createdAt_idx" ON "Report"("postId", "status", "createdAt");
CREATE INDEX IF NOT EXISTS "Report_reviewedById_createdAt_idx" ON "Report"("reviewedById", "createdAt");
