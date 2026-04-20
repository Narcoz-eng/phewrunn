ALTER TABLE "TokenCommunityProfile"
  ADD COLUMN "whyLine" TEXT,
  ADD COLUMN "welcomePrompt" TEXT,
  ADD COLUMN "vibeTags" JSONB,
  ADD COLUMN "mascotName" TEXT,
  ADD COLUMN "createdById" TEXT;

ALTER TABLE "TokenRaidCampaign"
  ADD COLUMN "generationHistoryJson" JSONB;

CREATE TABLE "TokenCommunityAsset" (
  "id" TEXT NOT NULL,
  "tokenId" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "url" TEXT NOT NULL,
  "objectKey" TEXT NOT NULL,
  "mimeType" TEXT NOT NULL,
  "width" INTEGER,
  "height" INTEGER,
  "sizeBytes" INTEGER,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "uploadedById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TokenCommunityAsset_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TokenCommunityMemberStats" (
  "id" TEXT NOT NULL,
  "tokenId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastActiveAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "threadCount" INTEGER NOT NULL DEFAULT 0,
  "replyCount" INTEGER NOT NULL DEFAULT 0,
  "reactionsReceived" INTEGER NOT NULL DEFAULT 0,
  "raidsJoined" INTEGER NOT NULL DEFAULT 0,
  "raidsLaunched" INTEGER NOT NULL DEFAULT 0,
  "raidPostsLinked" INTEGER NOT NULL DEFAULT 0,
  "boostsGiven" INTEGER NOT NULL DEFAULT 0,
  "contributionScore" INTEGER NOT NULL DEFAULT 0,
  "currentRaidStreak" INTEGER NOT NULL DEFAULT 0,
  "bestRaidStreak" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TokenCommunityMemberStats_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TokenCommunityThreadReaction" (
  "id" TEXT NOT NULL,
  "threadId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "emoji" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TokenCommunityThreadReaction_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TokenRaidParticipant" (
  "id" TEXT NOT NULL,
  "raidCampaignId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'joined',
  "currentStep" TEXT NOT NULL DEFAULT 'meme',
  "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "launchedAt" TIMESTAMP(3),
  "postedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TokenRaidParticipant_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TokenRaidBoost" (
  "id" TEXT NOT NULL,
  "submissionId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TokenRaidBoost_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TokenCommunityAsset_objectKey_key" ON "TokenCommunityAsset"("objectKey");
CREATE INDEX "TokenCommunityAsset_tokenId_kind_sortOrder_idx" ON "TokenCommunityAsset"("tokenId", "kind", "sortOrder");
CREATE INDEX "TokenCommunityAsset_uploadedById_createdAt_idx" ON "TokenCommunityAsset"("uploadedById", "createdAt");

CREATE UNIQUE INDEX "TokenCommunityMemberStats_tokenId_userId_key" ON "TokenCommunityMemberStats"("tokenId", "userId");
CREATE INDEX "TokenCommunityMemberStats_tokenId_contributionScore_idx" ON "TokenCommunityMemberStats"("tokenId", "contributionScore");
CREATE INDEX "TokenCommunityMemberStats_tokenId_lastActiveAt_idx" ON "TokenCommunityMemberStats"("tokenId", "lastActiveAt");
CREATE INDEX "TokenCommunityMemberStats_userId_updatedAt_idx" ON "TokenCommunityMemberStats"("userId", "updatedAt");

CREATE UNIQUE INDEX "TokenCommunityThreadReaction_threadId_userId_emoji_key" ON "TokenCommunityThreadReaction"("threadId", "userId", "emoji");
CREATE INDEX "TokenCommunityThreadReaction_threadId_createdAt_idx" ON "TokenCommunityThreadReaction"("threadId", "createdAt");
CREATE INDEX "TokenCommunityThreadReaction_userId_createdAt_idx" ON "TokenCommunityThreadReaction"("userId", "createdAt");

CREATE UNIQUE INDEX "TokenRaidParticipant_raidCampaignId_userId_key" ON "TokenRaidParticipant"("raidCampaignId", "userId");
CREATE INDEX "TokenRaidParticipant_raidCampaignId_joinedAt_idx" ON "TokenRaidParticipant"("raidCampaignId", "joinedAt");
CREATE INDEX "TokenRaidParticipant_userId_updatedAt_idx" ON "TokenRaidParticipant"("userId", "updatedAt");

CREATE UNIQUE INDEX "TokenRaidBoost_submissionId_userId_key" ON "TokenRaidBoost"("submissionId", "userId");
CREATE INDEX "TokenRaidBoost_submissionId_createdAt_idx" ON "TokenRaidBoost"("submissionId", "createdAt");
CREATE INDEX "TokenRaidBoost_userId_createdAt_idx" ON "TokenRaidBoost"("userId", "createdAt");

CREATE INDEX "TokenCommunityProfile_createdById_createdAt_idx" ON "TokenCommunityProfile"("createdById", "createdAt");

ALTER TABLE "TokenCommunityProfile"
  ADD CONSTRAINT "TokenCommunityProfile_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "TokenCommunityAsset"
  ADD CONSTRAINT "TokenCommunityAsset_tokenId_fkey"
  FOREIGN KEY ("tokenId") REFERENCES "Token"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TokenCommunityAsset"
  ADD CONSTRAINT "TokenCommunityAsset_uploadedById_fkey"
  FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TokenCommunityMemberStats"
  ADD CONSTRAINT "TokenCommunityMemberStats_tokenId_fkey"
  FOREIGN KEY ("tokenId") REFERENCES "Token"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TokenCommunityMemberStats"
  ADD CONSTRAINT "TokenCommunityMemberStats_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TokenCommunityThreadReaction"
  ADD CONSTRAINT "TokenCommunityThreadReaction_threadId_fkey"
  FOREIGN KEY ("threadId") REFERENCES "TokenCommunityThread"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TokenCommunityThreadReaction"
  ADD CONSTRAINT "TokenCommunityThreadReaction_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TokenRaidParticipant"
  ADD CONSTRAINT "TokenRaidParticipant_raidCampaignId_fkey"
  FOREIGN KEY ("raidCampaignId") REFERENCES "TokenRaidCampaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TokenRaidParticipant"
  ADD CONSTRAINT "TokenRaidParticipant_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TokenRaidBoost"
  ADD CONSTRAINT "TokenRaidBoost_submissionId_fkey"
  FOREIGN KEY ("submissionId") REFERENCES "TokenRaidSubmission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TokenRaidBoost"
  ADD CONSTRAINT "TokenRaidBoost_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
