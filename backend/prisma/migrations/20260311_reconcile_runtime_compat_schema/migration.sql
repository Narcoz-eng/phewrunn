SET statement_timeout = 0;

ALTER TABLE "Notification"
  ADD COLUMN IF NOT EXISTS "postId" TEXT,
  ADD COLUMN IF NOT EXISTS "fromUserId" TEXT;

CREATE INDEX IF NOT EXISTS "Notification_userId_createdAt_idx" ON "Notification"("userId", "createdAt");
CREATE INDEX IF NOT EXISTS "Notification_userId_dismissed_createdAt_idx" ON "Notification"("userId", "dismissed", "createdAt");
CREATE INDEX IF NOT EXISTS "Notification_userId_read_dismissed_idx" ON "Notification"("userId", "read", "dismissed");
CREATE INDEX IF NOT EXISTS "Notification_fromUserId_createdAt_idx" ON "Notification"("fromUserId", "createdAt");
CREATE INDEX IF NOT EXISTS "Notification_postId_createdAt_idx" ON "Notification"("postId", "createdAt");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Notification_fromUserId_fkey') THEN
    ALTER TABLE "Notification"
      ADD CONSTRAINT "Notification_fromUserId_fkey"
      FOREIGN KEY ("fromUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Notification_postId_fkey') THEN
    ALTER TABLE "Notification"
      ADD CONSTRAINT "Notification_postId_fkey"
      FOREIGN KEY ("postId") REFERENCES "Post"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "TradeFeeEvent" (
  "id" TEXT NOT NULL,
  "postId" TEXT NOT NULL,
  "posterUserId" TEXT NOT NULL,
  "traderUserId" TEXT,
  "traderWalletAddress" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "tradeSide" TEXT NOT NULL,
  "inputMint" TEXT NOT NULL,
  "outputMint" TEXT NOT NULL,
  "inAmountAtomic" TEXT NOT NULL,
  "outAmountAtomic" TEXT NOT NULL,
  "platformFeeBps" INTEGER NOT NULL,
  "platformFeeAmountAtomic" TEXT NOT NULL,
  "feeMint" TEXT NOT NULL,
  "posterShareBps" INTEGER NOT NULL,
  "posterShareAmountAtomic" TEXT NOT NULL,
  "posterPayoutAddress" TEXT,
  "txSignature" TEXT,
  "confirmedAt" TIMESTAMP(3),
  "verificationError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TradeFeeEvent_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "TradeFeeEvent"
  ADD COLUMN IF NOT EXISTS "postId" TEXT,
  ADD COLUMN IF NOT EXISTS "posterUserId" TEXT,
  ADD COLUMN IF NOT EXISTS "traderUserId" TEXT,
  ADD COLUMN IF NOT EXISTS "traderWalletAddress" TEXT,
  ADD COLUMN IF NOT EXISTS "status" TEXT NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS "tradeSide" TEXT,
  ADD COLUMN IF NOT EXISTS "inputMint" TEXT,
  ADD COLUMN IF NOT EXISTS "outputMint" TEXT,
  ADD COLUMN IF NOT EXISTS "inAmountAtomic" TEXT,
  ADD COLUMN IF NOT EXISTS "outAmountAtomic" TEXT,
  ADD COLUMN IF NOT EXISTS "platformFeeBps" INTEGER,
  ADD COLUMN IF NOT EXISTS "platformFeeAmountAtomic" TEXT,
  ADD COLUMN IF NOT EXISTS "feeMint" TEXT,
  ADD COLUMN IF NOT EXISTS "posterShareBps" INTEGER,
  ADD COLUMN IF NOT EXISTS "posterShareAmountAtomic" TEXT,
  ADD COLUMN IF NOT EXISTS "posterPayoutAddress" TEXT,
  ADD COLUMN IF NOT EXISTS "txSignature" TEXT,
  ADD COLUMN IF NOT EXISTS "confirmedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "verificationError" TEXT,
  ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE INDEX IF NOT EXISTS "TradeFeeEvent_posterUserId_createdAt_idx" ON "TradeFeeEvent"("posterUserId", "createdAt");
CREATE INDEX IF NOT EXISTS "TradeFeeEvent_postId_createdAt_idx" ON "TradeFeeEvent"("postId", "createdAt");
CREATE INDEX IF NOT EXISTS "TradeFeeEvent_status_createdAt_idx" ON "TradeFeeEvent"("status", "createdAt");
CREATE INDEX IF NOT EXISTS "TradeFeeEvent_txSignature_idx" ON "TradeFeeEvent"("txSignature");
CREATE INDEX IF NOT EXISTS "TradeFeeEvent_traderUserId_createdAt_idx" ON "TradeFeeEvent"("traderUserId", "createdAt");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'TradeFeeEvent_postId_fkey') THEN
    ALTER TABLE "TradeFeeEvent"
      ADD CONSTRAINT "TradeFeeEvent_postId_fkey"
      FOREIGN KEY ("postId") REFERENCES "Post"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'TradeFeeEvent_posterUserId_fkey') THEN
    ALTER TABLE "TradeFeeEvent"
      ADD CONSTRAINT "TradeFeeEvent_posterUserId_fkey"
      FOREIGN KEY ("posterUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'TradeFeeEvent_traderUserId_fkey') THEN
    ALTER TABLE "TradeFeeEvent"
      ADD CONSTRAINT "TradeFeeEvent_traderUserId_fkey"
      FOREIGN KEY ("traderUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "Announcement" (
  "id" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "content" TEXT NOT NULL,
  "isPinned" BOOLEAN NOT NULL DEFAULT false,
  "priority" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "authorId" TEXT NOT NULL,
  CONSTRAINT "Announcement_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "Announcement"
  ADD COLUMN IF NOT EXISTS "title" TEXT,
  ADD COLUMN IF NOT EXISTS "content" TEXT,
  ADD COLUMN IF NOT EXISTS "isPinned" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "priority" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN IF NOT EXISTS "authorId" TEXT;

CREATE INDEX IF NOT EXISTS "Announcement_isPinned_priority_createdAt_idx" ON "Announcement"("isPinned", "priority", "createdAt");
CREATE INDEX IF NOT EXISTS "Announcement_authorId_createdAt_idx" ON "Announcement"("authorId", "createdAt");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Announcement_authorId_fkey') THEN
    ALTER TABLE "Announcement"
      ADD CONSTRAINT "Announcement_authorId_fkey"
      FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "AnnouncementView" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "announcementId" TEXT NOT NULL,
  "viewedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AnnouncementView_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "AnnouncementView"
  ADD COLUMN IF NOT EXISTS "userId" TEXT,
  ADD COLUMN IF NOT EXISTS "announcementId" TEXT,
  ADD COLUMN IF NOT EXISTS "viewedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE UNIQUE INDEX IF NOT EXISTS "AnnouncementView_userId_announcementId_key" ON "AnnouncementView"("userId", "announcementId");
CREATE INDEX IF NOT EXISTS "AnnouncementView_userId_viewedAt_idx" ON "AnnouncementView"("userId", "viewedAt");
CREATE INDEX IF NOT EXISTS "AnnouncementView_announcementId_viewedAt_idx" ON "AnnouncementView"("announcementId", "viewedAt");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AnnouncementView_userId_fkey') THEN
    ALTER TABLE "AnnouncementView"
      ADD CONSTRAINT "AnnouncementView_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AnnouncementView_announcementId_fkey') THEN
    ALTER TABLE "AnnouncementView"
      ADD CONSTRAINT "AnnouncementView_announcementId_fkey"
      FOREIGN KEY ("announcementId") REFERENCES "Announcement"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
