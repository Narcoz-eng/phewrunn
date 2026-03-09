CREATE EXTENSION IF NOT EXISTS pg_trgm;

ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "winRate7d" DOUBLE PRECISION;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "winRate30d" DOUBLE PRECISION;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "avgRoi7d" DOUBLE PRECISION;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "avgRoi30d" DOUBLE PRECISION;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "trustScore" DOUBLE PRECISION;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "reputationTier" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "firstCallCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "firstCallAvgRoi" DOUBLE PRECISION;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "lastTraderMetricsAt" TIMESTAMP(3);

CREATE TABLE IF NOT EXISTS "Token" (
  "id" TEXT NOT NULL,
  "chainType" TEXT NOT NULL,
  "address" TEXT NOT NULL,
  "symbol" TEXT,
  "name" TEXT,
  "imageUrl" TEXT,
  "dexscreenerUrl" TEXT,
  "launchAt" TIMESTAMP(3),
  "pairAddress" TEXT,
  "dexId" TEXT,
  "liquidity" DOUBLE PRECISION,
  "volume24h" DOUBLE PRECISION,
  "holderCount" INTEGER,
  "largestHolderPct" DOUBLE PRECISION,
  "top10HolderPct" DOUBLE PRECISION,
  "deployerSupplyPct" DOUBLE PRECISION,
  "bundledWalletCount" INTEGER,
  "bundledClusterCount" INTEGER,
  "estimatedBundledSupplyPct" DOUBLE PRECISION,
  "bundleRiskLabel" TEXT,
  "tokenRiskScore" DOUBLE PRECISION,
  "sentimentScore" DOUBLE PRECISION,
  "radarScore" DOUBLE PRECISION,
  "confidenceScore" DOUBLE PRECISION,
  "hotAlphaScore" DOUBLE PRECISION,
  "earlyRunnerScore" DOUBLE PRECISION,
  "highConvictionScore" DOUBLE PRECISION,
  "isEarlyRunner" BOOLEAN NOT NULL DEFAULT false,
  "earlyRunnerReasons" JSONB,
  "lastIntelligenceAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Token_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "Post" ADD COLUMN IF NOT EXISTS "tokenId" TEXT;
ALTER TABLE "Post" ADD COLUMN IF NOT EXISTS "confidenceScore" DOUBLE PRECISION;
ALTER TABLE "Post" ADD COLUMN IF NOT EXISTS "hotAlphaScore" DOUBLE PRECISION;
ALTER TABLE "Post" ADD COLUMN IF NOT EXISTS "earlyRunnerScore" DOUBLE PRECISION;
ALTER TABLE "Post" ADD COLUMN IF NOT EXISTS "highConvictionScore" DOUBLE PRECISION;
ALTER TABLE "Post" ADD COLUMN IF NOT EXISTS "timingTier" TEXT;
ALTER TABLE "Post" ADD COLUMN IF NOT EXISTS "firstCallerRank" INTEGER;
ALTER TABLE "Post" ADD COLUMN IF NOT EXISTS "roiPeakPct" DOUBLE PRECISION;
ALTER TABLE "Post" ADD COLUMN IF NOT EXISTS "roiCurrentPct" DOUBLE PRECISION;
ALTER TABLE "Post" ADD COLUMN IF NOT EXISTS "threadCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Post" ADD COLUMN IF NOT EXISTS "reactionCounts" JSONB;
ALTER TABLE "Post" ADD COLUMN IF NOT EXISTS "trustedTraderCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Post" ADD COLUMN IF NOT EXISTS "entryQualityScore" DOUBLE PRECISION;
ALTER TABLE "Post" ADD COLUMN IF NOT EXISTS "bundlePenaltyScore" DOUBLE PRECISION;
ALTER TABLE "Post" ADD COLUMN IF NOT EXISTS "sentimentScore" DOUBLE PRECISION;
ALTER TABLE "Post" ADD COLUMN IF NOT EXISTS "lastIntelligenceAt" TIMESTAMP(3);

ALTER TABLE "Comment" ADD COLUMN IF NOT EXISTS "parentId" TEXT;
ALTER TABLE "Comment" ADD COLUMN IF NOT EXISTS "rootId" TEXT;
ALTER TABLE "Comment" ADD COLUMN IF NOT EXISTS "depth" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Comment" ADD COLUMN IF NOT EXISTS "kind" TEXT;
ALTER TABLE "Comment" ADD COLUMN IF NOT EXISTS "replyCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Comment" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);

ALTER TABLE "Notification" ADD COLUMN IF NOT EXISTS "readAt" TIMESTAMP(3);
ALTER TABLE "Notification" ADD COLUMN IF NOT EXISTS "priority" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Notification" ADD COLUMN IF NOT EXISTS "entityType" TEXT;
ALTER TABLE "Notification" ADD COLUMN IF NOT EXISTS "entityId" TEXT;
ALTER TABLE "Notification" ADD COLUMN IF NOT EXISTS "reasonCode" TEXT;
ALTER TABLE "Notification" ADD COLUMN IF NOT EXISTS "payload" JSONB;

CREATE TABLE IF NOT EXISTS "TokenMetricSnapshot" (
  "id" TEXT NOT NULL,
  "tokenId" TEXT NOT NULL,
  "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "priceUsd" DOUBLE PRECISION,
  "marketCap" DOUBLE PRECISION,
  "liquidity" DOUBLE PRECISION,
  "volume1h" DOUBLE PRECISION,
  "volume24h" DOUBLE PRECISION,
  "holderCount" INTEGER,
  "largestHolderPct" DOUBLE PRECISION,
  "top10HolderPct" DOUBLE PRECISION,
  "bundledWalletCount" INTEGER,
  "estimatedBundledSupplyPct" DOUBLE PRECISION,
  "tokenRiskScore" DOUBLE PRECISION,
  "sentimentScore" DOUBLE PRECISION,
  "confidenceScore" DOUBLE PRECISION,
  "radarScore" DOUBLE PRECISION,
  CONSTRAINT "TokenMetricSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "TokenBundleCluster" (
  "id" TEXT NOT NULL,
  "tokenId" TEXT NOT NULL,
  "clusterLabel" TEXT NOT NULL,
  "walletCount" INTEGER NOT NULL,
  "estimatedSupplyPct" DOUBLE PRECISION NOT NULL,
  "evidenceJson" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TokenBundleCluster_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "TokenEvent" (
  "id" TEXT NOT NULL,
  "tokenId" TEXT NOT NULL,
  "eventType" TEXT NOT NULL,
  "timestamp" TIMESTAMP(3) NOT NULL,
  "marketCap" DOUBLE PRECISION,
  "liquidity" DOUBLE PRECISION,
  "volume" DOUBLE PRECISION,
  "traderId" TEXT,
  "postId" TEXT,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TokenEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "Reaction" (
  "id" TEXT NOT NULL,
  "postId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Reaction_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "TokenFollow" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "tokenId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TokenFollow_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "AlertPreference" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "minConfidenceScore" DOUBLE PRECISION DEFAULT 65,
  "minLiquidity" DOUBLE PRECISION,
  "maxBundleRiskScore" DOUBLE PRECISION DEFAULT 45,
  "timeframeMinutes" INTEGER DEFAULT 240,
  "notifyFollowedTraders" BOOLEAN NOT NULL DEFAULT true,
  "notifyFollowedTokens" BOOLEAN NOT NULL DEFAULT true,
  "notifyEarlyRunners" BOOLEAN NOT NULL DEFAULT true,
  "notifyHotAlpha" BOOLEAN NOT NULL DEFAULT true,
  "notifyHighConviction" BOOLEAN NOT NULL DEFAULT true,
  "notifyBundleChanges" BOOLEAN NOT NULL DEFAULT true,
  "notifyConfidenceCross" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AlertPreference_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "TraderMetricDaily" (
  "id" TEXT NOT NULL,
  "traderId" TEXT NOT NULL,
  "bucketDate" TIMESTAMP(3) NOT NULL,
  "callsCount" INTEGER NOT NULL,
  "settledCount" INTEGER NOT NULL,
  "winRate" DOUBLE PRECISION NOT NULL,
  "avgRoi" DOUBLE PRECISION NOT NULL,
  "firstCalls" INTEGER NOT NULL,
  "firstCallAvgRoi" DOUBLE PRECISION,
  "trustScore" DOUBLE PRECISION,
  CONSTRAINT "TraderMetricDaily_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "Token_chainType_address_key" ON "Token"("chainType", "address");
CREATE UNIQUE INDEX IF NOT EXISTS "Reaction_postId_userId_type_key" ON "Reaction"("postId", "userId", "type");
CREATE UNIQUE INDEX IF NOT EXISTS "TokenFollow_userId_tokenId_key" ON "TokenFollow"("userId", "tokenId");
CREATE UNIQUE INDEX IF NOT EXISTS "AlertPreference_userId_key" ON "AlertPreference"("userId");
CREATE UNIQUE INDEX IF NOT EXISTS "TraderMetricDaily_traderId_bucketDate_key" ON "TraderMetricDaily"("traderId", "bucketDate");

CREATE INDEX IF NOT EXISTS "User_trustScore_createdAt_idx" ON "User"("trustScore", "createdAt");
CREATE INDEX IF NOT EXISTS "User_winRate30d_avgRoi30d_idx" ON "User"("winRate30d", "avgRoi30d");
CREATE INDEX IF NOT EXISTS "Post_tokenId_createdAt_idx" ON "Post"("tokenId", "createdAt");
CREATE INDEX IF NOT EXISTS "Post_confidenceScore_createdAt_idx" ON "Post"("confidenceScore", "createdAt");
CREATE INDEX IF NOT EXISTS "Post_hotAlphaScore_createdAt_idx" ON "Post"("hotAlphaScore", "createdAt");
CREATE INDEX IF NOT EXISTS "Post_earlyRunnerScore_createdAt_idx" ON "Post"("earlyRunnerScore", "createdAt");
CREATE INDEX IF NOT EXISTS "Post_highConvictionScore_createdAt_idx" ON "Post"("highConvictionScore", "createdAt");
CREATE INDEX IF NOT EXISTS "Comment_parentId_createdAt_idx" ON "Comment"("parentId", "createdAt");
CREATE INDEX IF NOT EXISTS "Comment_rootId_createdAt_idx" ON "Comment"("rootId", "createdAt");
CREATE INDEX IF NOT EXISTS "Notification_entityType_entityId_createdAt_idx" ON "Notification"("entityType", "entityId", "createdAt");
CREATE INDEX IF NOT EXISTS "Token_hotAlphaScore_updatedAt_idx" ON "Token"("hotAlphaScore", "updatedAt");
CREATE INDEX IF NOT EXISTS "Token_earlyRunnerScore_updatedAt_idx" ON "Token"("earlyRunnerScore", "updatedAt");
CREATE INDEX IF NOT EXISTS "Token_highConvictionScore_updatedAt_idx" ON "Token"("highConvictionScore", "updatedAt");
CREATE INDEX IF NOT EXISTS "Token_tokenRiskScore_updatedAt_idx" ON "Token"("tokenRiskScore", "updatedAt");
CREATE INDEX IF NOT EXISTS "TokenMetricSnapshot_tokenId_capturedAt_idx" ON "TokenMetricSnapshot"("tokenId", "capturedAt");
CREATE INDEX IF NOT EXISTS "TokenBundleCluster_tokenId_estimatedSupplyPct_idx" ON "TokenBundleCluster"("tokenId", "estimatedSupplyPct");
CREATE INDEX IF NOT EXISTS "TokenEvent_tokenId_timestamp_idx" ON "TokenEvent"("tokenId", "timestamp");
CREATE INDEX IF NOT EXISTS "TokenEvent_eventType_timestamp_idx" ON "TokenEvent"("eventType", "timestamp");
CREATE INDEX IF NOT EXISTS "Reaction_postId_createdAt_idx" ON "Reaction"("postId", "createdAt");
CREATE INDEX IF NOT EXISTS "Reaction_userId_createdAt_idx" ON "Reaction"("userId", "createdAt");
CREATE INDEX IF NOT EXISTS "TokenFollow_tokenId_createdAt_idx" ON "TokenFollow"("tokenId", "createdAt");
CREATE INDEX IF NOT EXISTS "TraderMetricDaily_bucketDate_trustScore_idx" ON "TraderMetricDaily"("bucketDate", "trustScore");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Post_tokenId_fkey') THEN
    ALTER TABLE "Post"
      ADD CONSTRAINT "Post_tokenId_fkey"
      FOREIGN KEY ("tokenId") REFERENCES "Token"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Comment_parentId_fkey') THEN
    ALTER TABLE "Comment"
      ADD CONSTRAINT "Comment_parentId_fkey"
      FOREIGN KEY ("parentId") REFERENCES "Comment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Comment_rootId_fkey') THEN
    ALTER TABLE "Comment"
      ADD CONSTRAINT "Comment_rootId_fkey"
      FOREIGN KEY ("rootId") REFERENCES "Comment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'TokenMetricSnapshot_tokenId_fkey') THEN
    ALTER TABLE "TokenMetricSnapshot"
      ADD CONSTRAINT "TokenMetricSnapshot_tokenId_fkey"
      FOREIGN KEY ("tokenId") REFERENCES "Token"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'TokenBundleCluster_tokenId_fkey') THEN
    ALTER TABLE "TokenBundleCluster"
      ADD CONSTRAINT "TokenBundleCluster_tokenId_fkey"
      FOREIGN KEY ("tokenId") REFERENCES "Token"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'TokenEvent_tokenId_fkey') THEN
    ALTER TABLE "TokenEvent"
      ADD CONSTRAINT "TokenEvent_tokenId_fkey"
      FOREIGN KEY ("tokenId") REFERENCES "Token"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'TokenEvent_traderId_fkey') THEN
    ALTER TABLE "TokenEvent"
      ADD CONSTRAINT "TokenEvent_traderId_fkey"
      FOREIGN KEY ("traderId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'TokenEvent_postId_fkey') THEN
    ALTER TABLE "TokenEvent"
      ADD CONSTRAINT "TokenEvent_postId_fkey"
      FOREIGN KEY ("postId") REFERENCES "Post"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Reaction_postId_fkey') THEN
    ALTER TABLE "Reaction"
      ADD CONSTRAINT "Reaction_postId_fkey"
      FOREIGN KEY ("postId") REFERENCES "Post"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Reaction_userId_fkey') THEN
    ALTER TABLE "Reaction"
      ADD CONSTRAINT "Reaction_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'TokenFollow_userId_fkey') THEN
    ALTER TABLE "TokenFollow"
      ADD CONSTRAINT "TokenFollow_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'TokenFollow_tokenId_fkey') THEN
    ALTER TABLE "TokenFollow"
      ADD CONSTRAINT "TokenFollow_tokenId_fkey"
      FOREIGN KEY ("tokenId") REFERENCES "Token"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AlertPreference_userId_fkey') THEN
    ALTER TABLE "AlertPreference"
      ADD CONSTRAINT "AlertPreference_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'TraderMetricDaily_traderId_fkey') THEN
    ALTER TABLE "TraderMetricDaily"
      ADD CONSTRAINT "TraderMetricDaily_traderId_fkey"
      FOREIGN KEY ("traderId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
