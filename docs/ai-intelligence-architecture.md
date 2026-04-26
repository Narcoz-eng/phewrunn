# Phew.run AI Intelligence Layer

## 1. Architecture Summary

### Current codebase constraints

- The app is still centered on `User`, `Post`, `Notification`, and `Follow`.
- Feed, reactions, comments, price refresh, chart proxying, and maintenance logic are heavily concentrated in `backend/src/routes/posts.ts`.
- Frontend feed/profile/post detail screens all consume the current `Post` shape.
- There is no first-class `Token` entity yet, even though contract-aware UI already exists.

### Target domain model

- `Trader` = current `User` plus intelligence fields and trader metrics.
- `Call` = current `Post` record exposed through a new call-oriented API surface.
- `Token` = new first-class entity keyed by `chain + address`, with risk, sentiment, radar, and timeline data.

### Clean architecture rule

- Do not rename `Post` to `Call` in Prisma yet. That creates unnecessary migration risk.
- Treat `Post` as the persisted call record for now, and add call-oriented DTOs/routes/services on top.
- Add intelligence as shared services and read models, not as feed-only logic.

### Proposed backend layers

1. Ingestion layer
   - Token metrics refresh
   - Holder distribution refresh
   - Bundle cluster detection
   - Trader metric refresh

2. Intelligence layer
   - `token-risk-service`
   - `token-sentiment-service`
   - `alpha-confidence-service`
   - `hot-alpha-service`
   - `early-runner-service`
   - `high-conviction-service`
   - `timeline-event-service`

3. Delivery layer
   - Feed ranking endpoints
   - Token page endpoints
   - Call detail/thread/reaction endpoints
   - Notification event fanout
   - Leaderboards

### Proposed backend module split

Add these modules instead of growing `posts.ts` further:

- `backend/src/routes/feed.ts`
- `backend/src/routes/tokens.ts`
- `backend/src/routes/calls.ts`
- `backend/src/routes/alerts.ts`
- `backend/src/routes/radar.ts`
- `backend/src/services/intelligence/scoring.ts`
- `backend/src/services/intelligence/token-risk.ts`
- `backend/src/services/intelligence/bundle-detector.ts`
- `backend/src/services/intelligence/token-metrics.ts`
- `backend/src/services/intelligence/trader-metrics.ts`
- `backend/src/services/intelligence/events.ts`
- `backend/src/services/intelligence/notifications.ts`
- `backend/src/jobs/intelligence-maintenance.ts`

## 2. Exact Backend Tables To Add Or Change

### Existing table changes

#### `User` (Trader)

Add:

- `winRate7d Float?`
- `winRate30d Float?`
- `avgRoi7d Float?`
- `avgRoi30d Float?`
- `trustScore Float?`
- `reputationTier String?`
- `firstCallCount Int @default(0)`
- `firstCallAvgRoi Float?`
- `lastTraderMetricsAt DateTime?`

Reason:

- Keep trader intelligence queryable without forcing every feed read through expensive aggregations.

#### `Post` (Call)

Add:

- `tokenId String?`
- `confidenceScore Float?`
- `hotAlphaScore Float?`
- `earlyRunnerScore Float?`
- `highConvictionScore Float?`
- `timingTier String?`
- `firstCallerRank Int?`
- `roiPeakPct Float?`
- `roiCurrentPct Float?`
- `threadCount Int @default(0)`
- `reactionCounts Json?`
- `trustedTraderCount Int @default(0)`
- `entryQualityScore Float?`
- `bundlePenaltyScore Float?`
- `sentimentScore Float?`
- `lastIntelligenceAt DateTime?`

Relations:

- `token Token? @relation(fields: [tokenId], references: [id], onDelete: SetNull)`
- `reactions Reaction[]`

Keep existing token display fields during transition:

- `contractAddress`
- `chainType`
- `tokenSymbol`
- `tokenName`
- `tokenImage`

#### `Comment`

Change from flat comments to threads by adding:

- `parentId String?`
- `rootId String?`
- `depth Int @default(0)`
- `kind String?`  // entry | chart | update | exit | warning | general
- `replyCount Int @default(0)`
- `deletedAt DateTime?`

Relations:

- self relation for parent/children

#### `Notification`

Add:

- `entityType String?`
- `entityId String?`
- `payload Json?`
- `readAt DateTime?`
- `priority Int @default(0)`
- `reasonCode String?`

Keep `message`, `read`, `dismissed`, `clickedAt`, and `dedupeKey` for compatibility.

### New tables

#### `Token`

```prisma
model Token {
  id                         String   @id @default(cuid())
  chainType                  String
  address                    String
  symbol                     String?
  name                       String?
  imageUrl                   String?
  dexscreenerUrl             String?
  launchAt                   DateTime?
  pairAddress                String?
  dexId                      String?
  liquidity                  Float?
  volume24h                  Float?
  holderCount                Int?
  largestHolderPct           Float?
  top10HolderPct             Float?
  deployerSupplyPct          Float?
  bundledWalletCount         Int?
  bundledClusterCount        Int?
  estimatedBundledSupplyPct  Float?
  bundleRiskLabel            String?
  tokenRiskScore             Float?
  sentimentScore             Float?
  radarScore                 Float?
  confidenceScore            Float?
  hotAlphaScore              Float?
  earlyRunnerScore           Float?
  highConvictionScore        Float?
  isEarlyRunner              Boolean  @default(false)
  earlyRunnerReasons         Json?
  lastIntelligenceAt         DateTime?
  createdAt                  DateTime @default(now())
  updatedAt                  DateTime @updatedAt

  calls        Post[]
  clusters     TokenBundleCluster[]
  events       TokenEvent[]
  snapshots    TokenMetricSnapshot[]
  followers    TokenFollow[]

  @@unique([chainType, address])
  @@index([hotAlphaScore, updatedAt])
  @@index([earlyRunnerScore, updatedAt])
  @@index([highConvictionScore, updatedAt])
  @@index([tokenRiskScore, updatedAt])
}
```

#### `TokenMetricSnapshot`

```prisma
model TokenMetricSnapshot {
  id                        String   @id @default(cuid())
  tokenId                   String
  capturedAt                DateTime @default(now())
  priceUsd                  Float?
  marketCap                 Float?
  liquidity                 Float?
  volume1h                  Float?
  volume24h                 Float?
  holderCount               Int?
  largestHolderPct          Float?
  top10HolderPct            Float?
  bundledWalletCount        Int?
  estimatedBundledSupplyPct Float?
  tokenRiskScore            Float?
  sentimentScore            Float?
  confidenceScore           Float?
  radarScore                Float?

  token Token @relation(fields: [tokenId], references: [id], onDelete: Cascade)

  @@index([tokenId, capturedAt])
}
```

#### `TokenBundleCluster`

```prisma
model TokenBundleCluster {
  id                 String   @id @default(cuid())
  tokenId            String
  clusterLabel       String
  walletCount        Int
  estimatedSupplyPct Float
  evidenceJson       Json
  createdAt          DateTime @default(now())
  updatedAt          DateTime @updatedAt

  token Token @relation(fields: [tokenId], references: [id], onDelete: Cascade)

  @@index([tokenId, estimatedSupplyPct])
}
```

#### `TokenEvent`

```prisma
model TokenEvent {
  id         String   @id @default(cuid())
  tokenId     String
  eventType   String
  timestamp   DateTime
  marketCap   Float?
  liquidity   Float?
  volume      Float?
  traderId    String?
  postId      String?
  metadata    Json?
  createdAt   DateTime @default(now())

  token Token @relation(fields: [tokenId], references: [id], onDelete: Cascade)
  trader User? @relation(fields: [traderId], references: [id], onDelete: SetNull)
  post   Post? @relation(fields: [postId], references: [id], onDelete: SetNull)

  @@index([tokenId, timestamp])
  @@index([eventType, timestamp])
}
```

#### `Reaction`

```prisma
model Reaction {
  id         String   @id @default(cuid())
  postId      String
  userId      String
  type        String   // alpha | based | printed | rug
  createdAt   DateTime @default(now())

  post Post @relation(fields: [postId], references: [id], onDelete: Cascade)
  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([postId, userId, type])
  @@index([postId, createdAt])
  @@index([userId, createdAt])
}
```

#### `TokenFollow`

```prisma
model TokenFollow {
  id        String   @id @default(cuid())
  userId     String
  tokenId    String
  createdAt  DateTime @default(now())

  user  User  @relation(fields: [userId], references: [id], onDelete: Cascade)
  token Token @relation(fields: [tokenId], references: [id], onDelete: Cascade)

  @@unique([userId, tokenId])
  @@index([tokenId, createdAt])
}
```

#### `AlertPreference`

```prisma
model AlertPreference {
  id                  String   @id @default(cuid())
  userId               String   @unique
  minConfidenceScore   Float?   @default(65)
  minLiquidity         Float?
  maxBundleRiskScore   Float?   @default(45)
  timeframeMinutes     Int?     @default(240)
  notifyFollowedTraders Boolean @default(true)
  notifyFollowedTokens  Boolean @default(true)
  notifyEarlyRunners    Boolean @default(true)
  notifyHotAlpha        Boolean @default(true)
  notifyHighConviction  Boolean @default(true)
  notifyBundleChanges   Boolean @default(true)
  notifyConfidenceCross Boolean @default(true)
  createdAt             DateTime @default(now())
  updatedAt             DateTime @updatedAt

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)
}
```

#### `TraderMetricDaily`

```prisma
model TraderMetricDaily {
  id            String   @id @default(cuid())
  traderId       String
  bucketDate     DateTime
  callsCount     Int
  settledCount   Int
  winRate        Float
  avgRoi         Float
  firstCalls     Int
  firstCallAvgRoi Float?
  trustScore     Float?

  trader User @relation(fields: [traderId], references: [id], onDelete: Cascade)

  @@unique([traderId, bucketDate])
  @@index([bucketDate, trustScore])
}
```

## 3. Exact Endpoints To Add

### New feed endpoints

- `GET /api/feed/latest`
- `GET /api/feed/hot-alpha`
- `GET /api/feed/early-runners`
- `GET /api/feed/high-conviction`
- `GET /api/feed/following`

Notes:

- Keep `GET /api/posts` as a compatibility adapter during migration.
- New feed endpoints should all return the same enriched call card DTO.

### New token endpoints

- `GET /api/tokens/:tokenAddress`
- `GET /api/tokens/:tokenAddress/chart`
- `GET /api/tokens/:tokenAddress/timeline`
- `GET /api/tokens/:tokenAddress/calls`
- `GET /api/tokens/:tokenAddress/risk`
- `GET /api/tokens/:tokenAddress/sentiment`
- `POST /api/tokens/:tokenAddress/follow`
- `DELETE /api/tokens/:tokenAddress/follow`

### New call endpoints

- `GET /api/calls/:id`
- `GET /api/calls/:id/quality`
- `GET /api/calls/:id/thread`
- `POST /api/calls/:id/reactions`
- `DELETE /api/calls/:id/reactions/:type`
- `POST /api/calls/:id/comments`
- `POST /api/calls/:id/comments/:commentId/replies`

### Trader endpoints to extend

- `GET /api/traders/:handle`
- `GET /api/traders/:handle/stats`
- `GET /api/traders/:handle/calls`
- `GET /api/traders/:handle/first-calls`

Implementation note:

- These can initially be backed by `usersRouter` with `/api/users/*` compatibility until frontend switches.

### Radar endpoints

- `GET /api/radar/early-runners`
- `GET /api/radar/hot-alpha`
- `GET /api/radar/high-conviction`

### Alert endpoints

- `GET /api/alerts`
- `GET /api/alerts/preferences`
- `PUT /api/alerts/preferences`

### Leaderboard endpoints

- `GET /api/leaderboards/daily`
- `GET /api/leaderboards/first-callers`
- `GET /api/leaderboards/top-traders-today`
- `GET /api/leaderboards/top-alpha-today`

## 4. Scoring Formulas

Use normalized 0-100 component scores. Persist both component inputs and final scores so rankings can be debugged.

### Shared normalization helpers

- `pct(x, max) = clamp((x / max) * 100, 0, 100)`
- `inversePct(x, max) = 100 - pct(x, max)`
- `logScore(x, pivot) = clamp((ln(1 + x) / ln(1 + pivot)) * 100, 0, 100)`
- `clampScore(x) = clamp(x, 0, 100)`

### A. Token Risk Score

Goal:

- Higher score = higher risk.

Formula:

```text
bundledSupplyRisk        = pct(estimatedBundledSupplyPct, 40)
clusterCountRisk         = pct(bundledClusterCount, 8)
largestHolderRisk        = pct(largestHolderPct, 20)
top10HolderRisk          = pct(top10HolderPct, 65)
deployerRisk             = pct(deployerSupplyPct, 15)
concentrationRisk        = clampScore((largestHolderRisk * 0.55) + (top10HolderRisk * 0.45))

tokenRiskScore =
  0.35 * bundledSupplyRisk +
  0.10 * clusterCountRisk +
  0.20 * largestHolderRisk +
  0.15 * top10HolderRisk +
  0.10 * deployerRisk +
  0.10 * concentrationRisk
```

Labels:

- `Clean`: `< 30`
- `Moderate Bundling`: `30 - 59.99`
- `Hard Bundled`: `>= 60`

### B. Alpha Confidence Score

Goal:

- Higher score = stronger, healthier call at the moment of viewing.

Components:

- `traderWinRateScore = pct(winRate30d, 80)`
- `traderRoiScore = logScore(max(avgRoi30d, 0), 300)`
- `traderTrustScore = clampScore(trustScore)`
- `entryQualityScore = clampScore(entryQualityScore)`
- `liquidityScore = logScore(liquidityUsd, 250000)`
- `volumeGrowthScore = pct(volumeGrowth24hPct, 300)`
- `momentumScore = pct(momentumPct, 120)`
- `confirmationScore = pct(trustedTraderCount, 5)`
- `holderHealthScore = inversePct(top10HolderPct, 70)`
- `bundlePenalty = pct(tokenRiskScore, 100)`

Formula:

```text
confidenceScoreRaw =
  0.16 * traderTrustScore +
  0.12 * traderWinRateScore +
  0.10 * traderRoiScore +
  0.12 * entryQualityScore +
  0.12 * liquidityScore +
  0.10 * volumeGrowthScore +
  0.10 * momentumScore +
  0.08 * confirmationScore +
  0.10 * holderHealthScore

confidenceScore =
  clampScore(confidenceScoreRaw - (0.20 * bundlePenalty))
```

### C. Hot Alpha Score

Goal:

- Rank call cards that are both strong and currently active.

Components:

- `confidenceScore`
- `engagementVelocityScore = pct(weightedEngagementPerHour, 80)`
- `earlyGainsScore = pct(max(roiCurrentPct, 0), 250)`
- `traderTrustScore`
- `liquidityScore`
- `sentimentScore = clampScore(sentimentScore)`
- `momentumScore`
- `bundlePenalty`

Weighted engagement:

```text
weightedEngagementPerHour =
  1.0 * alphaReactions +
  0.8 * basedReactions +
  1.4 * printedReactions +
  1.2 * threadReplies -
  1.8 * rugReactions
```

Formula:

```text
hotAlphaScoreRaw =
  0.22 * confidenceScore +
  0.18 * engagementVelocityScore +
  0.14 * earlyGainsScore +
  0.10 * traderTrustScore +
  0.12 * liquidityScore +
  0.10 * sentimentScore +
  0.14 * momentumScore

hotAlphaScore =
  clampScore(hotAlphaScoreRaw - (0.18 * bundlePenalty))
```

### D. Early Runner Score

Goal:

- Detect tokens breaking out before obvious mainstream trend.

Components:

- `trustedTraderClusterScore = pct(distinctTrustedTradersLast6h, 4)`
- `liquidityRiseScore = pct(liquidityGrowth1hPct, 120)`
- `volumeSpikeScore = pct(volumeGrowth1hPct, 300)`
- `holderGrowthScore = pct(holderGrowth1hPct, 80)`
- `momentumScore = pct(momentumPct, 100)`
- `sentimentScore`
- `riskGate = inversePct(tokenRiskScore, 100)`

Formula:

```text
earlyRunnerScore =
  0.22 * trustedTraderClusterScore +
  0.18 * liquidityRiseScore +
  0.22 * volumeSpikeScore +
  0.14 * holderGrowthScore +
  0.12 * momentumScore +
  0.07 * sentimentScore +
  0.05 * riskGate
```

Early runner classification:

- `isEarlyRunner = true` when:
  - `earlyRunnerScore >= 72`
  - `confidenceScore >= 60`
  - `tokenRiskScore <= 55`
  - `liquidity >= min alert threshold`

### E. High Conviction Score

Goal:

- Prefer durable, high-quality calls over pure noise.

Formula:

```text
highConvictionScoreRaw =
  0.32 * confidenceScore +
  0.18 * traderTrustScore +
  0.10 * entryQualityScore +
  0.12 * liquidityScore +
  0.08 * sentimentScore +
  0.10 * confirmationScore +
  0.10 * inversePct(tokenRiskScore, 100)

highConvictionScore =
  clampScore(highConvictionScoreRaw)
```

### F. Token Sentiment Score

Use reactions, rugs, and thread tone:

```text
reactionSentimentRaw =
  2.0 * alpha +
  1.0 * based +
  3.0 * printed -
  4.0 * rug

sentimentScore =
  clampScore(50 + reactionSentimentRaw + sentimentTrendAdjustment)
```

### G. First Caller / Early Caller / Late Caller

For each token:

- Sort calls by `createdAt ASC`.
- `firstCallerRank = dense_rank() over token calls`.

Rules:

- `FIRST_CALLER` if `firstCallerRank = 1`
- `EARLY_CALLER` if:
  - `firstCallerRank <= 3`, or
  - `createdAt <= token.firstCallAt + 30m`, or
  - `entryMcap <= firstCallEntryMcap * 1.5`
- `LATE_CALLER` otherwise

## 5. Implementation Order By Sprint

### Sprint 1: Token foundation

- Add `Token`, `TokenMetricSnapshot`, `TokenBundleCluster`, `TokenEvent`, `TokenFollow`, `AlertPreference`.
- Add `tokenId` relation to `Post`.
- Backfill tokens from existing `Post.contractAddress + chainType`.
- Create token metrics refresh worker.

Done when:

- Every post with a contract address resolves to a token record.
- Token snapshots refresh without blocking feed reads.
- `/api/tokens/:tokenAddress` returns stable data for seeded tokens.

### Sprint 2: Bundle intelligence and token risk

- Build bundle detector pipeline.
- Persist cluster percentages and risk score.
- Add `/api/tokens/:tokenAddress/risk` and timeline event writing.

Done when:

- Token risk page shows cluster list, total bundled supply, largest holder, top 10 holders.
- Risk label changes when distribution changes.
- Bundle risk can be used as a ranking penalty input.

### Sprint 3: Scoring engine and AI feeds

- Add confidence, hot alpha, early runner, high conviction scoring services.
- Add `feedRouter` with `latest`, `hot-alpha`, `early-runners`, `high-conviction`, `following`.
- Extend feed card DTO with confidence, timing tier, bundle badge, reaction summary, thread count.

Done when:

- Feed tabs return different rank orders from the same shared score tables.
- Scores are persisted and explainable.
- Feed cards no longer depend on client-side ranking tricks.

### Sprint 4: Social upgrade

- Add `Reaction` table and APIs.
- Migrate flat comments into threaded comments.
- Add token follow support.
- Add sentiment scoring from reactions and threads.

Done when:

- Each call supports four reaction types.
- Threads support replies and categories.
- Token and call sentiment update within minutes of social activity.

### Sprint 5: Alerts and radar

- Add alert preference UI and backend.
- Add notification event engine for hot alpha, early runners, high conviction, bundle changes, confidence threshold crosses.
- Add radar endpoints and notification payloads.

Done when:

- Users can filter alerts by confidence, liquidity, bundle risk, timeframe, followed traders, and followed tokens.
- Radar pages and notifications are powered by the same signal engine.

### Sprint 6: Reputation and competition

- Add first caller stats and daily alpha race.
- Add leaderboards for first callers, best ROI today, top traders today, top alpha today.
- Surface metrics on profile pages.

Done when:

- Profiles display first-caller performance.
- Daily leaderboard endpoints run from precomputed snapshots.
- Public competition features do not degrade feed latency.

## 6. Required Migrations

Recommended migration sequence:

1. `20260310_add_token_intelligence_core`
   - Add `Token`, `TokenMetricSnapshot`, `TokenEvent`, `TokenFollow`, `AlertPreference`
   - Add `tokenId` on `Post`

2. `20260310_backfill_tokens_from_posts`
   - Create tokens from distinct `Post.contractAddress + chainType`
   - Backfill `Post.tokenId`

3. `20260311_add_bundle_clusters_and_token_risk`
   - Add `TokenBundleCluster`
   - Add token risk fields on `Token`

4. `20260311_add_call_intelligence_fields`
   - Add confidence/hot/early/high-conviction/timing fields to `Post`
   - Add trader metric columns to `User`

5. `20260312_add_reactions_and_threading`
   - Add `Reaction`
   - Add threaded comment columns and self relation
   - Backfill `rootId`, `depth`, `threadCount`

6. `20260312_migrate_likes_to_reactions`
   - Copy `Like` rows into `Reaction(type = "alpha")`
   - Keep `Like` temporarily for compatibility

7. `20260313_add_notification_payload_and_alert_prefs`
   - Extend `Notification` with `entityType`, `entityId`, `payload`, `readAt`, `priority`, `reasonCode`

8. `20260313_add_trader_metric_daily`
   - Add `TraderMetricDaily`

## 7. Existing Files And Services To Modify First

Start here, in this order:

1. [backend/prisma/schema.prisma](c:/Users/renga/Documents/phewrunn/backend/prisma/schema.prisma)
   - Add the new domain tables and `Post`/`User` extensions first.

2. [backend/src/index.ts](c:/Users/renga/Documents/phewrunn/backend/src/index.ts)
   - Mount new routers and wire the intelligence maintenance job.

3. [backend/src/routes/posts.ts](c:/Users/renga/Documents/phewrunn/backend/src/routes/posts.ts)
   - Extract feed read logic, post detail logic, comment logic, and reaction logic into smaller routers/services.
   - Keep compatibility shims here while the frontend migrates.

4. [backend/src/routes/users.ts](c:/Users/renga/Documents/phewrunn/backend/src/routes/users.ts)
   - Extend trader stats/profile surfaces with trust, first-call, and intelligence fields.

5. [backend/src/routes/notifications.ts](c:/Users/renga/Documents/phewrunn/backend/src/routes/notifications.ts)
   - Add alert payload handling, preferences, and new notification types.

6. [backend/src/routes/leaderboard.ts](c:/Users/renga/Documents/phewrunn/backend/src/routes/leaderboard.ts)
   - Add first-caller and daily alpha race snapshots using precomputed intelligence tables.

7. [webapp/src/types/index.ts](c:/Users/renga/Documents/phewrunn/webapp/src/types/index.ts)
   - Add `Token`, `CallQuality`, `ReactionCounts`, `AlertPreference`, `RadarToken`, and threaded comment types.

8. [webapp/src/components/feed/FeedHeader.tsx](c:/Users/renga/Documents/phewrunn/webapp/src/components/feed/FeedHeader.tsx)
   - Replace `trending` with AI feed tabs: `hot-alpha`, `early-runners`, `high-conviction`.

9. [webapp/src/pages/Feed.tsx](c:/Users/renga/Documents/phewrunn/webapp/src/pages/Feed.tsx)
   - Switch query strategy from `/api/posts?sort=...` to dedicated feed endpoints.

10. [webapp/src/components/feed/PostCard.tsx](c:/Users/renga/Documents/phewrunn/webapp/src/components/feed/PostCard.tsx)
    - Add confidence, risk, timing badge, richer reactions, and thread summary.

11. [webapp/src/App.tsx](c:/Users/renga/Documents/phewrunn/webapp/src/App.tsx)
    - Add token route and radar route surfaces.

12. [webapp/src/pages/PostDetail.tsx](c:/Users/renga/Documents/phewrunn/webapp/src/pages/PostDetail.tsx)
    - Repoint to `call` DTOs and threaded discussions.

13. [webapp/src/pages/UserProfile.tsx](c:/Users/renga/Documents/phewrunn/webapp/src/pages/UserProfile.tsx)
    - Surface trader trust tier, first-caller stats, and conviction breakdowns.

14. [webapp/src/pages/Notifications.tsx](c:/Users/renga/Documents/phewrunn/webapp/src/pages/Notifications.tsx)
    - Support intelligent alert payloads and alert preference navigation.

## 8. Step-By-Step Rollout Plan With Acceptance Criteria

### Phase 1 rollout: hidden backend launch

- Ship schema and background jobs behind feature flags.
- Backfill token rows and score columns.
- Do not change the feed UI yet.

Acceptance criteria:

- No regression in existing `/api/posts`, `/api/users`, `/api/notifications`.
- Backfill completes for historical token posts.
- Intelligence recomputation is idempotent and resumable.

### Phase 2 rollout: token pages

- Add token routes and token page UI.
- Link token cards from post/feed surfaces.

Acceptance criteria:

- Token page shows chart, calls, timeline, traders, sentiment, risk, and bundle clusters.
- Token page loads from precomputed intelligence data, not per-request joins only.

### Phase 3 rollout: AI feeds

- Release `Hot Alpha`, `Early Runners`, `High Conviction`.
- Keep `Latest` and `Following`.
- Move current `Trending` into a token radar module, not a primary feed tab.

Acceptance criteria:

- Feed tab ordering differs materially from chronological latest.
- Bundle risk visibly suppresses risky tokens/calls.
- Confidence score is visible on every call card.

### Phase 4 rollout: reactions and threads

- Replace likes in UI with four reactions.
- Enable threaded discussion on call detail first, then inline feed expansion.

Acceptance criteria:

- Users can react without losing existing engagement history.
- Token sentiment changes after social activity.
- Thread count and reply count are accurate on feed cards.

### Phase 5 rollout: intelligent alerts

- Add alert preferences page.
- Trigger notifications from score threshold crossings and signal events.

Acceptance criteria:

- Users can follow tokens and traders independently.
- Notifications dedupe correctly by event and timeframe.
- Alert delivery is explainable via payload reasons.

### Phase 6 rollout: reputation and competition

- Release first-caller labels and daily alpha race.
- Add public leaderboards and profile summary cards.

Acceptance criteria:

- First-caller labels are stable and backfilled historically.
- Daily leaderboards use snapshots, not live heavy joins.
- Profile pages reflect the same intelligence outputs as feed ranking.

## 9. Recommended First Build Cut

If you want the highest-value first implementation without creating architectural debt, ship this first:

1. Token table + token snapshots + bundle clusters
2. Token risk score + confidence score
3. Token pages
4. AI feed endpoints
5. Feed card confidence/risk/timing badges

That gives Phew.run the first real intelligence loop:

- calls create token evidence
- token evidence updates risk/sentiment
- scores rank feeds
- scores trigger alerts
- token pages explain the ranking
