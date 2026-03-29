-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "emailVerified" BOOLEAN NOT NULL DEFAULT false,
    "image" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "walletAddress" TEXT,
    "walletProvider" TEXT,
    "walletConnectedAt" TIMESTAMP(3),
    "username" TEXT,
    "level" INTEGER NOT NULL DEFAULT 0,
    "xp" INTEGER NOT NULL DEFAULT 0,
    "bio" TEXT,
    "bannerImage" TEXT,
    "role" TEXT NOT NULL DEFAULT 'user',
    "isAdmin" BOOLEAN NOT NULL DEFAULT false,
    "isBanned" BOOLEAN NOT NULL DEFAULT false,
    "isVerified" BOOLEAN NOT NULL DEFAULT false,
    "winRate7d" DOUBLE PRECISION,
    "winRate30d" DOUBLE PRECISION,
    "avgRoi7d" DOUBLE PRECISION,
    "avgRoi30d" DOUBLE PRECISION,
    "trustScore" DOUBLE PRECISION,
    "reputationTier" TEXT,
    "firstCallCount" INTEGER NOT NULL DEFAULT 0,
    "firstCallAvgRoi" DOUBLE PRECISION,
    "lastTraderMetricsAt" TIMESTAMP(3),
    "lastUsernameUpdate" TIMESTAMP(3),
    "lastPhotoUpdate" TIMESTAMP(3),
    "tradeFeeRewardsEnabled" BOOLEAN NOT NULL DEFAULT true,
    "tradeFeeShareBps" INTEGER NOT NULL DEFAULT 50,
    "tradeFeePayoutAddress" TEXT,
    "inviteQuota" INTEGER NOT NULL DEFAULT 2,
    "invitedById" TEXT,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "token" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "userId" TEXT NOT NULL,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Account" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "accessToken" TEXT,
    "refreshToken" TEXT,
    "idToken" TEXT,
    "accessTokenExpiresAt" TIMESTAMP(3),
    "refreshTokenExpiresAt" TIMESTAMP(3),
    "scope" TEXT,
    "password" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Verification" (
    "id" TEXT NOT NULL,
    "identifier" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Verification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Follow" (
    "id" TEXT NOT NULL,
    "followerId" TEXT NOT NULL,
    "followingId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Follow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Post" (
    "id" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "tokenId" TEXT,
    "contractAddress" TEXT,
    "chainType" TEXT,
    "tokenSymbol" TEXT,
    "tokenName" TEXT,
    "tokenImage" TEXT,
    "dexscreenerUrl" TEXT,
    "entryMcap" DOUBLE PRECISION,
    "currentMcap" DOUBLE PRECISION,
    "mcap1h" DOUBLE PRECISION,
    "mcap6h" DOUBLE PRECISION,
    "lastMcapUpdate" TIMESTAMP(3),
    "trackingMode" TEXT,
    "viewCount" INTEGER NOT NULL DEFAULT 0,
    "confidenceScore" DOUBLE PRECISION,
    "hotAlphaScore" DOUBLE PRECISION,
    "earlyRunnerScore" DOUBLE PRECISION,
    "highConvictionScore" DOUBLE PRECISION,
    "timingTier" TEXT,
    "firstCallerRank" INTEGER,
    "roiPeakPct" DOUBLE PRECISION,
    "roiCurrentPct" DOUBLE PRECISION,
    "threadCount" INTEGER NOT NULL DEFAULT 0,
    "reactionCounts" JSONB,
    "trustedTraderCount" INTEGER NOT NULL DEFAULT 0,
    "entryQualityScore" DOUBLE PRECISION,
    "bundlePenaltyScore" DOUBLE PRECISION,
    "sentimentScore" DOUBLE PRECISION,
    "lastIntelligenceAt" TIMESTAMP(3),
    "settled" BOOLEAN NOT NULL DEFAULT false,
    "settledAt" TIMESTAMP(3),
    "isWin" BOOLEAN,
    "isWin1h" BOOLEAN,
    "isWin6h" BOOLEAN,
    "percentChange1h" DOUBLE PRECISION,
    "percentChange6h" DOUBLE PRECISION,
    "recoveryEligible" BOOLEAN,
    "settled6h" BOOLEAN NOT NULL DEFAULT false,
    "levelChange1h" INTEGER,
    "levelChange6h" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Post_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AggregateSnapshot" (
    "key" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "payload" JSONB NOT NULL,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AggregateSnapshot_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "TradeFeeEvent" (
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
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TradeFeeEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Report" (
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

    CONSTRAINT "Report_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Like" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Like_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Comment" (
    "id" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "parentId" TEXT,
    "rootId" TEXT,
    "depth" INTEGER NOT NULL DEFAULT 0,
    "kind" TEXT,
    "replyCount" INTEGER NOT NULL DEFAULT 0,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Comment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Repost" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Repost_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "dedupeKey" TEXT,
    "read" BOOLEAN NOT NULL DEFAULT false,
    "dismissed" BOOLEAN NOT NULL DEFAULT false,
    "clickedAt" TIMESTAMP(3),
    "readAt" TIMESTAMP(3),
    "priority" INTEGER NOT NULL DEFAULT 0,
    "entityType" TEXT,
    "entityId" TEXT,
    "reasonCode" TEXT,
    "payload" JSONB,
    "postId" TEXT,
    "fromUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Token" (
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
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Token_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TokenMetricSnapshot" (
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

-- CreateTable
CREATE TABLE "TokenBundleCluster" (
    "id" TEXT NOT NULL,
    "tokenId" TEXT NOT NULL,
    "clusterLabel" TEXT NOT NULL,
    "walletCount" INTEGER NOT NULL,
    "estimatedSupplyPct" DOUBLE PRECISION NOT NULL,
    "evidenceJson" JSONB NOT NULL,
    "currentAction" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TokenBundleCluster_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TokenEvent" (
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

-- CreateTable
CREATE TABLE "Reaction" (
    "id" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Reaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TokenFollow" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TokenFollow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AlertPreference" (
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
    "notifyLiquiditySurge" BOOLEAN NOT NULL DEFAULT true,
    "notifyHolderGrowth" BOOLEAN NOT NULL DEFAULT true,
    "notifyMomentum" BOOLEAN NOT NULL DEFAULT true,
    "notifyWhaleAccumulating" BOOLEAN NOT NULL DEFAULT true,
    "notifySmartMoney" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AlertPreference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TraderMetricDaily" (
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

-- CreateTable
CREATE TABLE "Announcement" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "isPinned" BOOLEAN NOT NULL DEFAULT false,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "authorId" TEXT NOT NULL,

    CONSTRAINT "Announcement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PushSubscription" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PushSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnnouncementView" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "announcementId" TEXT NOT NULL,
    "viewedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AnnouncementView_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccessCode" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT,
    "type" TEXT NOT NULL DEFAULT 'admin',
    "maxUses" INTEGER NOT NULL DEFAULT 1,
    "useCount" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3),
    "isRevoked" BOOLEAN NOT NULL DEFAULT false,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AccessCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccessCodeUse" (
    "id" TEXT NOT NULL,
    "codeId" TEXT NOT NULL,
    "usedById" TEXT NOT NULL,
    "usedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AccessCodeUse_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GlobalSetting" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GlobalSetting_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_walletAddress_key" ON "User"("walletAddress");

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- CreateIndex
CREATE INDEX "User_createdAt_idx" ON "User"("createdAt");

-- CreateIndex
CREATE INDEX "User_level_xp_idx" ON "User"("level", "xp");

-- CreateIndex
CREATE INDEX "User_role_idx" ON "User"("role");

-- CreateIndex
CREATE INDEX "User_isBanned_createdAt_idx" ON "User"("isBanned", "createdAt");

-- CreateIndex
CREATE INDEX "User_isVerified_createdAt_idx" ON "User"("isVerified", "createdAt");

-- CreateIndex
CREATE INDEX "User_walletAddress_idx" ON "User"("walletAddress");

-- CreateIndex
CREATE INDEX "User_username_idx" ON "User"("username");

-- CreateIndex
CREATE INDEX "User_trustScore_createdAt_idx" ON "User"("trustScore", "createdAt");

-- CreateIndex
CREATE INDEX "User_winRate30d_avgRoi30d_idx" ON "User"("winRate30d", "avgRoi30d");

-- CreateIndex
CREATE UNIQUE INDEX "Session_token_key" ON "Session"("token");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");

-- CreateIndex
CREATE INDEX "Account_userId_idx" ON "Account"("userId");

-- CreateIndex
CREATE INDEX "Account_providerId_idx" ON "Account"("providerId");

-- CreateIndex
CREATE UNIQUE INDEX "Account_providerId_accountId_key" ON "Account"("providerId", "accountId");

-- CreateIndex
CREATE INDEX "Verification_identifier_idx" ON "Verification"("identifier");

-- CreateIndex
CREATE INDEX "Verification_expiresAt_idx" ON "Verification"("expiresAt");

-- CreateIndex
CREATE INDEX "Follow_followerId_createdAt_idx" ON "Follow"("followerId", "createdAt");

-- CreateIndex
CREATE INDEX "Follow_followingId_createdAt_idx" ON "Follow"("followingId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Follow_followerId_followingId_key" ON "Follow"("followerId", "followingId");

-- CreateIndex
CREATE INDEX "Post_authorId_settled_idx" ON "Post"("authorId", "settled");

-- CreateIndex
CREATE INDEX "Post_authorId_settledAt_idx" ON "Post"("authorId", "settledAt");

-- CreateIndex
CREATE INDEX "Post_settled_settledAt_idx" ON "Post"("settled", "settledAt");

-- CreateIndex
CREATE INDEX "Post_createdAt_idx" ON "Post"("createdAt");

-- CreateIndex
CREATE INDEX "Post_createdAt_id_idx" ON "Post"("createdAt", "id");

-- CreateIndex
CREATE INDEX "Post_createdAt_authorId_idx" ON "Post"("createdAt", "authorId");

-- CreateIndex
CREATE INDEX "Post_authorId_createdAt_idx" ON "Post"("authorId", "createdAt");

-- CreateIndex
CREATE INDEX "Post_contractAddress_createdAt_idx" ON "Post"("contractAddress", "createdAt");

-- CreateIndex
CREATE INDEX "Post_settled_createdAt_idx" ON "Post"("settled", "createdAt");

-- CreateIndex
CREATE INDEX "Post_settled_isWin_authorId_idx" ON "Post"("settled", "isWin", "authorId");

-- CreateIndex
CREATE INDEX "Post_trackingMode_lastMcapUpdate_idx" ON "Post"("trackingMode", "lastMcapUpdate");

-- CreateIndex
CREATE INDEX "Post_lastMcapUpdate_idx" ON "Post"("lastMcapUpdate");

-- CreateIndex
CREATE INDEX "Post_chainType_contractAddress_idx" ON "Post"("chainType", "contractAddress");

-- CreateIndex
CREATE INDEX "Post_settled6h_createdAt_idx" ON "Post"("settled6h", "createdAt");

-- CreateIndex
CREATE INDEX "Post_settled_isWin_idx" ON "Post"("settled", "isWin");

-- CreateIndex
CREATE INDEX "Post_createdAt_entryMcap_idx" ON "Post"("createdAt", "entryMcap");

-- CreateIndex
CREATE INDEX "Post_tokenId_createdAt_idx" ON "Post"("tokenId", "createdAt");

-- CreateIndex
CREATE INDEX "Post_confidenceScore_createdAt_idx" ON "Post"("confidenceScore", "createdAt");

-- CreateIndex
CREATE INDEX "Post_hotAlphaScore_createdAt_idx" ON "Post"("hotAlphaScore", "createdAt");

-- CreateIndex
CREATE INDEX "Post_earlyRunnerScore_createdAt_idx" ON "Post"("earlyRunnerScore", "createdAt");

-- CreateIndex
CREATE INDEX "Post_highConvictionScore_createdAt_idx" ON "Post"("highConvictionScore", "createdAt");

-- CreateIndex
CREATE INDEX "AggregateSnapshot_expiresAt_idx" ON "AggregateSnapshot"("expiresAt");

-- CreateIndex
CREATE INDEX "AggregateSnapshot_capturedAt_idx" ON "AggregateSnapshot"("capturedAt");

-- CreateIndex
CREATE INDEX "TradeFeeEvent_posterUserId_createdAt_idx" ON "TradeFeeEvent"("posterUserId", "createdAt");

-- CreateIndex
CREATE INDEX "TradeFeeEvent_postId_createdAt_idx" ON "TradeFeeEvent"("postId", "createdAt");

-- CreateIndex
CREATE INDEX "TradeFeeEvent_status_createdAt_idx" ON "TradeFeeEvent"("status", "createdAt");

-- CreateIndex
CREATE INDEX "TradeFeeEvent_txSignature_idx" ON "TradeFeeEvent"("txSignature");

-- CreateIndex
CREATE INDEX "TradeFeeEvent_traderUserId_createdAt_idx" ON "TradeFeeEvent"("traderUserId", "createdAt");

-- CreateIndex
CREATE INDEX "Report_status_createdAt_idx" ON "Report"("status", "createdAt");

-- CreateIndex
CREATE INDEX "Report_entityType_status_createdAt_idx" ON "Report"("entityType", "status", "createdAt");

-- CreateIndex
CREATE INDEX "Report_reporterUserId_createdAt_idx" ON "Report"("reporterUserId", "createdAt");

-- CreateIndex
CREATE INDEX "Report_targetUserId_status_createdAt_idx" ON "Report"("targetUserId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "Report_postId_status_createdAt_idx" ON "Report"("postId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "Report_reviewedById_createdAt_idx" ON "Report"("reviewedById", "createdAt");

-- CreateIndex
CREATE INDEX "Like_postId_idx" ON "Like"("postId");

-- CreateIndex
CREATE INDEX "Like_userId_createdAt_idx" ON "Like"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Like_userId_postId_key" ON "Like"("userId", "postId");

-- CreateIndex
CREATE INDEX "Comment_postId_createdAt_idx" ON "Comment"("postId", "createdAt");

-- CreateIndex
CREATE INDEX "Comment_authorId_createdAt_idx" ON "Comment"("authorId", "createdAt");

-- CreateIndex
CREATE INDEX "Comment_parentId_createdAt_idx" ON "Comment"("parentId", "createdAt");

-- CreateIndex
CREATE INDEX "Comment_rootId_createdAt_idx" ON "Comment"("rootId", "createdAt");

-- CreateIndex
CREATE INDEX "Repost_postId_idx" ON "Repost"("postId");

-- CreateIndex
CREATE INDEX "Repost_userId_createdAt_idx" ON "Repost"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Repost_userId_postId_key" ON "Repost"("userId", "postId");

-- CreateIndex
CREATE UNIQUE INDEX "Notification_dedupeKey_key" ON "Notification"("dedupeKey");

-- CreateIndex
CREATE INDEX "Notification_userId_createdAt_idx" ON "Notification"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "Notification_userId_dismissed_createdAt_idx" ON "Notification"("userId", "dismissed", "createdAt");

-- CreateIndex
CREATE INDEX "Notification_userId_read_dismissed_idx" ON "Notification"("userId", "read", "dismissed");

-- CreateIndex
CREATE INDEX "Notification_userId_read_dismissed_createdAt_idx" ON "Notification"("userId", "read", "dismissed", "createdAt");

-- CreateIndex
CREATE INDEX "Notification_userId_type_createdAt_idx" ON "Notification"("userId", "type", "createdAt");

-- CreateIndex
CREATE INDEX "Notification_fromUserId_createdAt_idx" ON "Notification"("fromUserId", "createdAt");

-- CreateIndex
CREATE INDEX "Notification_postId_createdAt_idx" ON "Notification"("postId", "createdAt");

-- CreateIndex
CREATE INDEX "Notification_entityType_entityId_createdAt_idx" ON "Notification"("entityType", "entityId", "createdAt");

-- CreateIndex
CREATE INDEX "Token_hotAlphaScore_updatedAt_idx" ON "Token"("hotAlphaScore", "updatedAt");

-- CreateIndex
CREATE INDEX "Token_earlyRunnerScore_updatedAt_idx" ON "Token"("earlyRunnerScore", "updatedAt");

-- CreateIndex
CREATE INDEX "Token_highConvictionScore_updatedAt_idx" ON "Token"("highConvictionScore", "updatedAt");

-- CreateIndex
CREATE INDEX "Token_tokenRiskScore_updatedAt_idx" ON "Token"("tokenRiskScore", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Token_chainType_address_key" ON "Token"("chainType", "address");

-- CreateIndex
CREATE INDEX "TokenMetricSnapshot_tokenId_capturedAt_idx" ON "TokenMetricSnapshot"("tokenId", "capturedAt");

-- CreateIndex
CREATE INDEX "TokenBundleCluster_tokenId_estimatedSupplyPct_idx" ON "TokenBundleCluster"("tokenId", "estimatedSupplyPct");

-- CreateIndex
CREATE INDEX "TokenEvent_tokenId_timestamp_idx" ON "TokenEvent"("tokenId", "timestamp");

-- CreateIndex
CREATE INDEX "TokenEvent_eventType_timestamp_idx" ON "TokenEvent"("eventType", "timestamp");

-- CreateIndex
CREATE INDEX "Reaction_postId_createdAt_idx" ON "Reaction"("postId", "createdAt");

-- CreateIndex
CREATE INDEX "Reaction_userId_createdAt_idx" ON "Reaction"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Reaction_postId_userId_type_key" ON "Reaction"("postId", "userId", "type");

-- CreateIndex
CREATE INDEX "TokenFollow_tokenId_createdAt_idx" ON "TokenFollow"("tokenId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "TokenFollow_userId_tokenId_key" ON "TokenFollow"("userId", "tokenId");

-- CreateIndex
CREATE UNIQUE INDEX "AlertPreference_userId_key" ON "AlertPreference"("userId");

-- CreateIndex
CREATE INDEX "TraderMetricDaily_bucketDate_trustScore_idx" ON "TraderMetricDaily"("bucketDate", "trustScore");

-- CreateIndex
CREATE UNIQUE INDEX "TraderMetricDaily_traderId_bucketDate_key" ON "TraderMetricDaily"("traderId", "bucketDate");

-- CreateIndex
CREATE INDEX "Announcement_isPinned_priority_createdAt_idx" ON "Announcement"("isPinned", "priority", "createdAt");

-- CreateIndex
CREATE INDEX "Announcement_authorId_createdAt_idx" ON "Announcement"("authorId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PushSubscription_endpoint_key" ON "PushSubscription"("endpoint");

-- CreateIndex
CREATE INDEX "PushSubscription_userId_idx" ON "PushSubscription"("userId");

-- CreateIndex
CREATE INDEX "AnnouncementView_userId_viewedAt_idx" ON "AnnouncementView"("userId", "viewedAt");

-- CreateIndex
CREATE INDEX "AnnouncementView_announcementId_viewedAt_idx" ON "AnnouncementView"("announcementId", "viewedAt");

-- CreateIndex
CREATE UNIQUE INDEX "AnnouncementView_userId_announcementId_key" ON "AnnouncementView"("userId", "announcementId");

-- CreateIndex
CREATE UNIQUE INDEX "AccessCode_code_key" ON "AccessCode"("code");

-- CreateIndex
CREATE INDEX "AccessCode_code_idx" ON "AccessCode"("code");

-- CreateIndex
CREATE INDEX "AccessCode_isRevoked_expiresAt_idx" ON "AccessCode"("isRevoked", "expiresAt");

-- CreateIndex
CREATE INDEX "AccessCode_createdById_createdAt_idx" ON "AccessCode"("createdById", "createdAt");

-- CreateIndex
CREATE INDEX "AccessCode_type_createdById_idx" ON "AccessCode"("type", "createdById");

-- CreateIndex
CREATE INDEX "AccessCodeUse_usedById_idx" ON "AccessCodeUse"("usedById");

-- CreateIndex
CREATE INDEX "AccessCodeUse_codeId_usedAt_idx" ON "AccessCodeUse"("codeId", "usedAt");

-- CreateIndex
CREATE UNIQUE INDEX "AccessCodeUse_codeId_usedById_key" ON "AccessCodeUse"("codeId", "usedById");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_invitedById_fkey" FOREIGN KEY ("invitedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Follow" ADD CONSTRAINT "Follow_followerId_fkey" FOREIGN KEY ("followerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Follow" ADD CONSTRAINT "Follow_followingId_fkey" FOREIGN KEY ("followingId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Post" ADD CONSTRAINT "Post_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Post" ADD CONSTRAINT "Post_tokenId_fkey" FOREIGN KEY ("tokenId") REFERENCES "Token"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TradeFeeEvent" ADD CONSTRAINT "TradeFeeEvent_postId_fkey" FOREIGN KEY ("postId") REFERENCES "Post"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TradeFeeEvent" ADD CONSTRAINT "TradeFeeEvent_posterUserId_fkey" FOREIGN KEY ("posterUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TradeFeeEvent" ADD CONSTRAINT "TradeFeeEvent_traderUserId_fkey" FOREIGN KEY ("traderUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Report" ADD CONSTRAINT "Report_reporterUserId_fkey" FOREIGN KEY ("reporterUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Report" ADD CONSTRAINT "Report_targetUserId_fkey" FOREIGN KEY ("targetUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Report" ADD CONSTRAINT "Report_postId_fkey" FOREIGN KEY ("postId") REFERENCES "Post"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Report" ADD CONSTRAINT "Report_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Like" ADD CONSTRAINT "Like_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Like" ADD CONSTRAINT "Like_postId_fkey" FOREIGN KEY ("postId") REFERENCES "Post"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Comment" ADD CONSTRAINT "Comment_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Comment" ADD CONSTRAINT "Comment_postId_fkey" FOREIGN KEY ("postId") REFERENCES "Post"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Comment" ADD CONSTRAINT "Comment_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Comment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Comment" ADD CONSTRAINT "Comment_rootId_fkey" FOREIGN KEY ("rootId") REFERENCES "Comment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Repost" ADD CONSTRAINT "Repost_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Repost" ADD CONSTRAINT "Repost_postId_fkey" FOREIGN KEY ("postId") REFERENCES "Post"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_fromUserId_fkey" FOREIGN KEY ("fromUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_postId_fkey" FOREIGN KEY ("postId") REFERENCES "Post"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TokenMetricSnapshot" ADD CONSTRAINT "TokenMetricSnapshot_tokenId_fkey" FOREIGN KEY ("tokenId") REFERENCES "Token"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TokenBundleCluster" ADD CONSTRAINT "TokenBundleCluster_tokenId_fkey" FOREIGN KEY ("tokenId") REFERENCES "Token"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TokenEvent" ADD CONSTRAINT "TokenEvent_tokenId_fkey" FOREIGN KEY ("tokenId") REFERENCES "Token"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TokenEvent" ADD CONSTRAINT "TokenEvent_traderId_fkey" FOREIGN KEY ("traderId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TokenEvent" ADD CONSTRAINT "TokenEvent_postId_fkey" FOREIGN KEY ("postId") REFERENCES "Post"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reaction" ADD CONSTRAINT "Reaction_postId_fkey" FOREIGN KEY ("postId") REFERENCES "Post"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reaction" ADD CONSTRAINT "Reaction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TokenFollow" ADD CONSTRAINT "TokenFollow_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TokenFollow" ADD CONSTRAINT "TokenFollow_tokenId_fkey" FOREIGN KEY ("tokenId") REFERENCES "Token"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AlertPreference" ADD CONSTRAINT "AlertPreference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TraderMetricDaily" ADD CONSTRAINT "TraderMetricDaily_traderId_fkey" FOREIGN KEY ("traderId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Announcement" ADD CONSTRAINT "Announcement_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PushSubscription" ADD CONSTRAINT "PushSubscription_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnnouncementView" ADD CONSTRAINT "AnnouncementView_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnnouncementView" ADD CONSTRAINT "AnnouncementView_announcementId_fkey" FOREIGN KEY ("announcementId") REFERENCES "Announcement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccessCode" ADD CONSTRAINT "AccessCode_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccessCodeUse" ADD CONSTRAINT "AccessCodeUse_codeId_fkey" FOREIGN KEY ("codeId") REFERENCES "AccessCode"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccessCodeUse" ADD CONSTRAINT "AccessCodeUse_usedById_fkey" FOREIGN KEY ("usedById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
