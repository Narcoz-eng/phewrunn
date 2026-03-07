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
