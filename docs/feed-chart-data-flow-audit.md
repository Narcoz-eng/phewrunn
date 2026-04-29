# Feed And Chart Data Flow Audit

Last updated: 2026-04-29

## Product Rules

- The product UI must not expose cache, fallback, source, provider, or debug labels.
- Core feed tabs must prefer alpha inventory over social inventory.
- Invalid chart data must produce a compact no-chart state, never a full candle chart.
- Following is a direct lightweight social read and must not call intelligence ranking.

## Frontend Flow

### Feed Requests

- `webapp/src/pages/Feed.tsx` owns all tab requests through `useInfiniteQuery`.
- Query key: `["feed", tab, search, viewerScope]`.
- Endpoint: `GET /api/feed/:kind`.
- Page size: `10`, max pages: `5`, stale time: `30s`.
- Following is only enabled when the active tab is `following` and a live session exists.
- Neighbor prefetch skips `following` entirely.
- The public feed payload only contains `items`, `hasMore`, `nextCursor`, and `totalPosts`.

### Chart Preview Requests

- `Feed.tsx` is the only caller of `loadBatchedFeedChartPreview`.
- `FeedV2PostCard.tsx` only renders cached/feed-provided chart data and never starts requests.
- The visible-card collector scans the first `24` displayed posts, dedupes by token/pair/timeframe key, queues globally, and updates all feed query pages after fulfilled previews.
- Client cache keys:
  - `pair:{chain}:{pairAddress}:{timeframe}`
  - `token:{chain}:{tokenAddress}:{timeframe}`
  - `symbol:{symbol}:{timeframe}`
- Client request guards:
  - 250ms global batch window
  - max 24 tokens per batch
  - token/timeframe request TTL: 30s
  - unavailable suppression: 5 minutes after repeated unavailable responses
  - in-flight dedupe by batch key
- Client logs include `queued`, `skippedFresh`, `skippedUnavailable`, `batchSize`, and `batchSizeDistribution`.

## Backend Feed Paths

### `GET /api/feed/latest`

- Active implementation: `listMaterializedFeedCalls` in `backend/src/services/materialized-feed.ts`.
- Primary source: materialized feed cache.
- Cache keys:
  - memory: `feed:materialized:v2:latest`
  - redis: `phew:feed:materialized:v2:latest`
- TTLs:
  - fresh: 45s
  - stale usable: 10 minutes
  - refresh debounce: 20s
- Cold fallback order:
  - latest good materialized envelope for requested tab
  - latest ranked inventory from another core materialized tab
  - direct stored DB ranked read
- Ranking rule: call/chart > raid/news > discussion/poll, with low-engagement social penalized.

### `GET /api/feed/hot-alpha`

- Active implementation: same materialized service.
- Primary post types: `alpha`, `chart`.
- Empty hot-alpha materialization is not stored. Existing last-good memory is preserved.
- Cold tab reads can serve latest ranked inventory while the hot-alpha cache warms.

### `GET /api/feed/early-runners`

- Active implementation: same materialized service.
- Primary post types: `raid`, `alpha`, `chart`.
- Same cache/fallback rules as latest.

### `GET /api/feed/high-conviction`

- Active implementation: same materialized service.
- Primary post types: `alpha`, `chart`.
- Same cache/fallback rules as hot-alpha.

### `GET /api/feed/following`

- Active implementation: `listLightweightFeed` direct DB read.
- Data source: Prisma only.
- Query shape:
  - fetch followed trader IDs and followed token IDs
  - query posts where `authorId in followedTraderIds` or `tokenId in followedTokenIds`
  - order by `createdAt desc`
- No materialized feed cache, no intelligence engine, no pool-pressure guard, no heavy ranking, no neighbor prefetch.

## Backend Chart Path

### `POST /api/feed/chart-previews`

- Active route: `backend/src/routes/feed.ts`.
- Max tokens per request: 24.
- Route dedupes token requests by supplied key.
- Worker concurrency: 3 per batch.
- Per-token provider flow in `backend/src/services/feed-chart-preview.ts`:
  - Solana with Birdeye API key: Birdeye OHLCV first.
  - Pair address available: GeckoTerminal OHLCV.
  - Token address available: stored token snapshots as a last-good compact source.
  - Last-good live preview is served only if it still passes candle validation.
- Backend cache:
  - key: `{network}:{pairAddress|tokenAddress}:minute:5`
  - live TTL: 45s
  - last-good TTL: 5 minutes
  - unavailable TTL: 5s
  - request timeout: 2.2s
  - fresh candle max age: 10 minutes

### Candle Validation

- Required:
  - at least 12 candles
  - strictly increasing timestamps
  - finite positive OHLC values
  - finite non-negative volume
  - high/low must contain open/close
- Rejected:
  - flat or malformed ranges
  - candle range > 65% of price basis
  - wick/body ratio > 18 with range > 12%
  - zero-body candles with range > 4%
  - isolated single-bar moves above 45%
  - total range below 0.05% or above 600%
- The frontend repeats the same validation before SVG rendering.

## Removed Duplicate Paths

- `/api/feed/:kind/debug-ranking` was removed.
- The active feed route no longer imports the intelligence `listFeedCalls` path.
- The legacy exported `listFeedCalls` request path and its request caches were removed from the intelligence engine.
- Per-card chart preview fetching was removed from `FeedV2PostCard`.
- Feed response source/cache/debug/degraded fields were removed from the public API payload.

## Validation Targets

- Feed route logs should show `/api/feed/following` served by `following lightweight read`, with no `intelligence/feed_soft_timeout:following`.
- Chart client logs should show batch sizes greater than 1 when multiple visible chart candidates exist.
- Chart route logs should report `batchSize`, `dedupeHits`, `liveResults`, and unavailable reason counts.
- When `liveResults` is 0, feed cards render compact chart-unavailable rows, not full candle SVGs.
