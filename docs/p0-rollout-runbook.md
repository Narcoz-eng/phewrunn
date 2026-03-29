# P0 Rollout Runbook

Status: Ready for execution
Last updated: 2026-03-29
Scope: `PR-001` through `PR-006` are implemented. Remaining gates are sign-off, staging load validation, staging hold, canary, and final go/no-go.

## Dates

- Load validation: `2026-04-02`
- Staging hold start: immediately after a passing load run on `2026-04-02`
- Earliest canary start: `2026-04-03`

## Inputs Required Before Load Validation

- Staging base URL in `BASE_URL`
- A valid Privy ID token in `K6_PRIVY_ID_TOKEN` for `/api/auth/privy-sync`
- Either:
  - `K6_SESSION_COOKIES` with one or more full session-cookie values separated by `||`
  - or `K6_INTERNAL_AUTH_SECRET` plus `K6_INTERNAL_AUTH_USER_IDS` if the target environment explicitly allows the non-production load-sim auth path
- Enough authenticated test accounts to stay below write and session limits during the mixed run
  - `POST /api/posts` limit: `10` posts per user per hour
  - `/api/me` and `/api/notifications` should be spread across multiple sessions to avoid skewing into limiter-only behavior
- A token address pool in `K6_TOKEN_ADDRESSES` if feed discovery is not enough for post-create traffic

## Checked-In Load Suite

- Suite: [load-tests/k6/p0-gate.mjs](/c:/Users/renga/Documents/phewrunn/load-tests/k6/p0-gate.mjs)
- Purpose:
  - mixed-load coverage for `/api/auth/privy-sync`, `/api/me`, `/api/feed/latest`, `/api/notifications`, `/api/leaderboard/stats`, and `POST /api/posts`
  - optional `/api/me` abuse scenario that should produce `429` without spilling into `5xx`
- Thresholds encoded in the suite:
  - `/api/auth/privy-sync`: `p95 < 500 ms`, `p99 < 1200 ms`
  - `/api/me`: `p95 < 150 ms`, `p99 < 400 ms`
  - `/api/feed/latest`: `p95 < 400 ms`, `p99 < 900 ms`
  - `/api/notifications`: `p95 < 300 ms`, `p99 < 800 ms`
  - `/api/leaderboard/stats`: `p95 < 300 ms`, `p99 < 800 ms`
  - `POST /api/posts`: `p95 < 400 ms`, `p99 < 900 ms`
  - abuse `/api/me`: some `429` responses must occur and unexpected responses must stay below `1%`

## Load Validation Commands

### 1. Mixed staging run

Use this first. It is the P0 gate run.

```bash
k6 run \
  -e BASE_URL="https://staging.example.com" \
  -e K6_PRIVY_ID_TOKEN="$K6_PRIVY_ID_TOKEN" \
  -e K6_SESSION_COOKIES="$K6_SESSION_COOKIES" \
  -e K6_TOKEN_ADDRESSES="$K6_TOKEN_ADDRESSES" \
  -e K6_DURATION="15m" \
  -e K6_FEED_RATE="6" \
  -e K6_ME_RATE="2" \
  -e K6_NOTIFICATIONS_RATE="1" \
  -e K6_LEADERBOARD_RATE="1" \
  -e K6_AUTH_SYNC_RATE_PER_MIN="1" \
  -e K6_POST_CREATE_RATE_PER_MIN="6" \
  load-tests/k6/p0-gate.mjs
```

Pass criteria:
- k6 exits cleanly
- every encoded threshold passes
- staging dashboards do not cross any P0 rollback threshold
- queue depth and oldest-job-age stay inside the roadmap freshness targets

### 2. 10x burst run

Run only after the mixed staging run passes.

```bash
k6 run \
  -e BASE_URL="https://staging.example.com" \
  -e K6_PRIVY_ID_TOKEN="$K6_PRIVY_ID_TOKEN" \
  -e K6_SESSION_COOKIES="$K6_SESSION_COOKIES" \
  -e K6_TOKEN_ADDRESSES="$K6_TOKEN_ADDRESSES" \
  -e K6_DURATION="5m" \
  -e K6_FEED_RATE="60" \
  -e K6_ME_RATE="20" \
  -e K6_NOTIFICATIONS_RATE="10" \
  -e K6_LEADERBOARD_RATE="10" \
  -e K6_AUTH_SYNC_RATE_PER_MIN="10" \
  -e K6_POST_CREATE_RATE_PER_MIN="60" \
  load-tests/k6/p0-gate.mjs
```

Pass criteria:
- auth and core read paths stay inside rollback thresholds
- queue absorbs post-create fanout without oldest-job-age alarm
- no admin/auth/rate-limit regression appears under burst

### 3. Session abuse run

This confirms shared rate limiting under concentrated authenticated spam.

```bash
k6 run \
  -e BASE_URL="https://staging.example.com" \
  -e K6_SESSION_COOKIES="$K6_SESSION_COOKIES" \
  -e K6_ABUSE_DURATION="10m" \
  -e K6_FEED_RATE="0" \
  -e K6_ME_RATE="0" \
  -e K6_NOTIFICATIONS_RATE="0" \
  -e K6_LEADERBOARD_RATE="0" \
  -e K6_AUTH_SYNC_RATE_PER_MIN="0" \
  -e K6_POST_CREATE_RATE_PER_MIN="0" \
  -e K6_ABUSE_ME_RATE="30" \
  load-tests/k6/p0-gate.mjs
```

Pass criteria:
- the abuse scenario emits `429`
- unexpected responses stay below `1%`
- no `5xx` spike or auth spillover appears on the rest of staging traffic

## Observability To Watch During Load Validation

- API:
  - request volume
  - `401`, `403`, `429`, `5xx`
  - p95 and p99 latency for `/api/auth/privy-sync`, `/api/me`, `/api/feed/latest`, `/api/notifications`, `/api/leaderboard/stats`, `POST /api/posts`
- Database:
  - connection count
  - pool wait
  - slow-query count
  - timeout rate
- Queue:
  - publish success rate
  - queue depth
  - oldest high-priority job age
  - dead-letter count
- Rate limiting:
  - Redis latency
  - Redis error rate
  - limiter hit rate
- Providers:
  - timeout rate
  - circuit-breaker opens
  - stale-cache hit rate

## Staging Hold

The `24h` hold starts only after a passing mixed run and passing burst/abuse checks on `2026-04-02`.

Hold requirements:
- staging stays on the P0 build for the full `24h`
- synthetic traffic continues at low rate
- no rollback threshold is crossed
- queue freshness, Redis health, and auth success stay stable for the full window

Minimum evidence to record:
- start time and end time of the hold
- alert history for the hold window
- p95 and p99 summaries for the critical routes
- queue oldest-age and dead-letter summary
- DB slow-query summary

## Canary

Earliest start: `2026-04-03`

Sequence:
1. internal-only canary for `30m`
2. `10%` traffic for `30m`
3. `50%` traffic for `30m`
4. `100%` only if no rollback threshold trips

Rollback is immediate if any of these occur:
- any unauthenticated or under-privileged admin access
- `5xx > 1.0%` on a critical path for `5m`
- `/api/auth/privy-sync` success below `99.5%` for `10m`
- `/api/me` exceeds `p95 400 ms` for `10m`
- `POST /api/posts` exceeds `p95 900 ms` for `10m`
- Redis limiter or revocation errors exceed `0.1%` for `5m`
- oldest high-priority job age exceeds `2m` for `10m`

## Evidence Package Required Before Go/No-Go

- `Security Lead` sign-off on `PR-001`, `PR-002`, `PR-003`
- `Tech Lead` sign-off on `PR-004`, `PR-005`, `PR-006`
- k6 output from mixed, burst, and abuse runs
- staging hold start/end and alert summary
- canary step timings and metrics
- explicit pass/fail decision against rollback thresholds
