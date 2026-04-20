-- Token communities and coordinated X raids

CREATE TABLE "TokenCommunityProfile" (
  "id" TEXT NOT NULL,
  "tokenId" TEXT NOT NULL,
  "headline" TEXT,
  "xCashtag" TEXT,
  "voiceHints" JSONB,
  "insideJokes" JSONB,
  "preferredTemplateIds" JSONB,
  "raidLeadMinLevel" INTEGER NOT NULL DEFAULT 3,
  "updatedById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TokenCommunityProfile_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TokenCommunityThread" (
  "id" TEXT NOT NULL,
  "tokenId" TEXT NOT NULL,
  "authorId" TEXT NOT NULL,
  "title" TEXT,
  "content" TEXT NOT NULL,
  "kind" TEXT NOT NULL DEFAULT 'general',
  "raidCampaignId" TEXT,
  "replyCount" INTEGER NOT NULL DEFAULT 0,
  "isPinned" BOOLEAN NOT NULL DEFAULT false,
  "lastActivityAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deletedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TokenCommunityThread_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TokenCommunityReply" (
  "id" TEXT NOT NULL,
  "threadId" TEXT NOT NULL,
  "authorId" TEXT NOT NULL,
  "content" TEXT NOT NULL,
  "parentId" TEXT,
  "rootId" TEXT,
  "depth" INTEGER NOT NULL DEFAULT 0,
  "deletedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TokenCommunityReply_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TokenRaidCampaign" (
  "id" TEXT NOT NULL,
  "tokenId" TEXT NOT NULL,
  "createdById" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'active',
  "objective" TEXT NOT NULL,
  "memeOptionsJson" JSONB NOT NULL,
  "copyOptionsJson" JSONB NOT NULL,
  "activeKey" TEXT,
  "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "closedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TokenRaidCampaign_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TokenRaidSubmission" (
  "id" TEXT NOT NULL,
  "raidCampaignId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "memeOptionId" TEXT NOT NULL,
  "copyOptionId" TEXT NOT NULL,
  "renderPayloadJson" JSONB NOT NULL,
  "composerText" TEXT NOT NULL,
  "xPostUrl" TEXT,
  "postedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TokenRaidSubmission_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TokenCommunityProfile_tokenId_key" ON "TokenCommunityProfile"("tokenId");
CREATE UNIQUE INDEX "TokenCommunityThread_raidCampaignId_key" ON "TokenCommunityThread"("raidCampaignId");
CREATE UNIQUE INDEX "TokenRaidCampaign_activeKey_key" ON "TokenRaidCampaign"("activeKey");
CREATE UNIQUE INDEX "TokenRaidSubmission_raidCampaignId_userId_key" ON "TokenRaidSubmission"("raidCampaignId", "userId");

CREATE INDEX "TokenCommunityProfile_updatedById_updatedAt_idx" ON "TokenCommunityProfile"("updatedById", "updatedAt");
CREATE INDEX "TokenCommunityThread_tokenId_isPinned_lastActivityAt_idx" ON "TokenCommunityThread"("tokenId", "isPinned", "lastActivityAt");
CREATE INDEX "TokenCommunityThread_tokenId_createdAt_idx" ON "TokenCommunityThread"("tokenId", "createdAt");
CREATE INDEX "TokenCommunityThread_authorId_createdAt_idx" ON "TokenCommunityThread"("authorId", "createdAt");
CREATE INDEX "TokenCommunityReply_threadId_createdAt_idx" ON "TokenCommunityReply"("threadId", "createdAt");
CREATE INDEX "TokenCommunityReply_authorId_createdAt_idx" ON "TokenCommunityReply"("authorId", "createdAt");
CREATE INDEX "TokenCommunityReply_parentId_createdAt_idx" ON "TokenCommunityReply"("parentId", "createdAt");
CREATE INDEX "TokenCommunityReply_rootId_createdAt_idx" ON "TokenCommunityReply"("rootId", "createdAt");
CREATE INDEX "TokenRaidCampaign_tokenId_status_openedAt_idx" ON "TokenRaidCampaign"("tokenId", "status", "openedAt");
CREATE INDEX "TokenRaidCampaign_createdById_createdAt_idx" ON "TokenRaidCampaign"("createdById", "createdAt");
CREATE INDEX "TokenRaidSubmission_raidCampaignId_postedAt_idx" ON "TokenRaidSubmission"("raidCampaignId", "postedAt");
CREATE INDEX "TokenRaidSubmission_userId_createdAt_idx" ON "TokenRaidSubmission"("userId", "createdAt");

ALTER TABLE "TokenCommunityProfile"
  ADD CONSTRAINT "TokenCommunityProfile_tokenId_fkey"
  FOREIGN KEY ("tokenId") REFERENCES "Token"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TokenCommunityProfile"
  ADD CONSTRAINT "TokenCommunityProfile_updatedById_fkey"
  FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "TokenCommunityThread"
  ADD CONSTRAINT "TokenCommunityThread_tokenId_fkey"
  FOREIGN KEY ("tokenId") REFERENCES "Token"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TokenCommunityThread"
  ADD CONSTRAINT "TokenCommunityThread_authorId_fkey"
  FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TokenCommunityReply"
  ADD CONSTRAINT "TokenCommunityReply_threadId_fkey"
  FOREIGN KEY ("threadId") REFERENCES "TokenCommunityThread"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TokenCommunityReply"
  ADD CONSTRAINT "TokenCommunityReply_authorId_fkey"
  FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TokenCommunityReply"
  ADD CONSTRAINT "TokenCommunityReply_parentId_fkey"
  FOREIGN KEY ("parentId") REFERENCES "TokenCommunityReply"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "TokenCommunityReply"
  ADD CONSTRAINT "TokenCommunityReply_rootId_fkey"
  FOREIGN KEY ("rootId") REFERENCES "TokenCommunityReply"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "TokenRaidCampaign"
  ADD CONSTRAINT "TokenRaidCampaign_tokenId_fkey"
  FOREIGN KEY ("tokenId") REFERENCES "Token"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TokenRaidCampaign"
  ADD CONSTRAINT "TokenRaidCampaign_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TokenCommunityThread"
  ADD CONSTRAINT "TokenCommunityThread_raidCampaignId_fkey"
  FOREIGN KEY ("raidCampaignId") REFERENCES "TokenRaidCampaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "TokenRaidSubmission"
  ADD CONSTRAINT "TokenRaidSubmission_raidCampaignId_fkey"
  FOREIGN KEY ("raidCampaignId") REFERENCES "TokenRaidCampaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TokenRaidSubmission"
  ADD CONSTRAINT "TokenRaidSubmission_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
