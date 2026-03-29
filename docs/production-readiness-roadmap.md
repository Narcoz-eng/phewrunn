# Production Readiness Roadmap

Status: Active execution
Date: 2026-03-29
Release policy: No public release until every P0 item in this document is complete, validated, and signed off.

## Assumptions

- Kickoff starts on 2026-03-30.
- Ownership is assigned by accountable role. Replace role labels with named engineers when this is copied into the tracker.
- Timelines assume one accountable owner per track working in parallel.
- No remediation code starts until the architecture decisions in `ADR-0` are approved.

## Owner Map

- `Tech Lead`: cross-cutting architecture, dependency cleanup, provider decisions, release gate.
- `Backend Lead`: backend routes, auth, validation, job producers/consumers.
- `Frontend Lead`: SPA auth handling, bundle size, browser hardening.
- `Platform Engineer`: Redis, queue infrastructure, CI/CD, observability, deploy/runtime controls.
- `Data Engineer`: Prisma schema, migrations, indexes, backups, restore drills.
- `Security Lead`: security review, threat-model review, secret-management review, and sign-off on auth/access/rate-limit gates.

## ADR-0: Decisions Required Before Coding

Target completion: 2026-04-01
Owner: `Tech Lead`

### Decision 1: Queue system

- Decision: use `Upstash QStash` for asynchronous job dispatch and retries.
- Why: the current deployment shape is Vercel-style serverless; QStash fits that model better than BullMQ and does not require a long-running worker process.
- Implementation rule: every non-trivial background task is invoked through authenticated internal job endpoints and is idempotent.
- Rejected for now: `BullMQ`. Reconsider only if the backend moves to a long-running worker service.

### Decision 2: Shared rate limiting and hot-path state

- Decision: `Upstash Redis REST` is mandatory in production.
- Why: in-memory limits and revocation caches are not acceptable for public multi-instance traffic.
- Implementation rule: production startup fails if the required Upstash env vars are missing.

### Decision 3: Final session model

- Decision: cookie-only auth.
- Credential: `phew.session_token` as the only session credential.
- Cookie settings: `HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/`, 7-day max age for the first production cut.
- Rotation rule: rotate on sign-in, Privy sync, logout, and privilege changes; no browser-readable bearer fallback.
- Revocation rule: Redis-backed `jti` revocation is required; DB persistence remains optional and out of the request hot path.

### Decision 4: Background jobs, retries, and backpressure

- Decision: jobs are required for `post_fanout`, `push_delivery`, `settlement`, `market_refresh`, `leaderboard_refresh`, and `intelligence_refresh`.
- Retry policy: exponential backoff at `30s`, `2m`, `10m`, `30m`, `2h`, max `5` attempts.
- Backpressure policy: per-job concurrency caps, oldest-job-age alerting, dead-letter queue after max attempts, and low-priority refresh jobs paused before user-facing writes.
- Queue-first rule: any work expected to take more than `250 ms` or fan out to more than one recipient must leave the request path.

### Decision 5: Provider strategy

- Decision: keep `Helius`, `DexScreener`, and `Jupiter` as primary providers.
- Decision: `Solscan`, `Birdeye`, and `GeckoTerminal` stay only if a route depends on data quality that the primary providers cannot provide.
- Implementation rule: every provider kept must have a documented purpose, timeout, circuit-breaker policy, and owner.

### Decision 6: Canonical package manager

- Decision: `npm` is the canonical package manager for CI/CD and releases.
- Why: deployment and verification already run through npm; dual lockfiles are avoidable drift.
- Implementation rule: remove `bun.lock` files from release workflows or move Bun usage to explicitly local-only tooling.

## Timeline Summary

- `2026-03-30` to `2026-04-01`: ADR-0 decisions and sign-off.
- `2026-03-30` to `2026-04-15`: P0 blockers.
- `2026-04-16` to `2026-04-29`: P1 scale-readiness.
- `2026-04-30` to `2026-05-13`: P2 hardening and operations.
- `2026-05-14` to `2026-05-15`: final production readiness review and go/no-go.

## Service Objectives

| Critical path | Availability SLO | Latency target | Notes |
| --- | --- | --- | --- |
| `POST /api/auth/privy-sync` | `99.95%` | `p95 <= 500 ms`, `p99 <= 1200 ms`, hard timeout `<= 2500 ms` | Includes server-side verification and session issuance |
| `GET /api/me` | `99.95%` | `p95 <= 150 ms`, `p99 <= 400 ms` | Must stay fast during auth-heavy spikes |
| `GET /api/feed` first page | `99.90%` | `p95 <= 400 ms`, `p99 <= 900 ms` | Cache-hit path should dominate |
| `POST /api/posts` | `99.90%` | `p95 <= 400 ms`, `p99 <= 900 ms` | Excludes downstream async job completion |
| `GET /api/notifications` | `99.90%` | `p95 <= 300 ms`, `p99 <= 800 ms` | Stale-cache fallback is acceptable |
| `POST /api/posts/jupiter/quote` | `99.50%` | `p95 <= 1200 ms`, `p99 <= 2500 ms` | Provider-bound path; fast-fail and stale/empty degrade are acceptable |
| High-priority jobs `post_fanout`, `push_delivery` | `99.00% freshness` | `99% start <= 30 s`, `oldest job <= 2 m` | Jobs can lag briefly but must not silently stall |
| Maintenance jobs `settlement`, `market_refresh`, `leaderboard_refresh`, `intelligence_refresh` | `99.00% freshness` | `99% start <= 5 m`, `oldest job <= 15 m` | Low-priority jobs can be deferred before user-facing work |

## Ticket Breakdown

| ID | Priority | Owner | Sign-off owner | Timeline | Scope | Dependencies | Expected outcome |
| --- | --- | --- | --- | --- | --- | --- | --- |
| PR-001 | P0 | Backend Lead | Security Lead | 2026-03-30 to 2026-03-31 | Lock down all admin-invite routes | None | All `/api/admin` invite routes require admin auth and have regression coverage |
| PR-002 | P0 | Backend Lead | Security Lead | 2026-03-31 to 2026-04-06 | Remove legacy auth flows and finalize cookie-only auth | ADR-0 session decision | One coherent auth model with no dead password/social/reset flows |
| PR-003 | P0 | Platform Engineer | Security Lead | 2026-03-30 to 2026-04-02 | Enforce shared rate limiting and shared revocation | ADR-0 rate-limit decision | No production in-memory fallback for limits or revocation |
| PR-004 | P0 | Platform Engineer | Tech Lead | 2026-04-01 to 2026-04-04 | Build queue infrastructure and operational controls | ADR-0 queue and job decisions | Durable queue plumbing, idempotency primitives, metrics, and internal job auth exist |
| PR-005 | P0 | Backend Lead | Tech Lead | 2026-04-04 to 2026-04-10 | Migrate concrete flows to background jobs | PR-004 | Post fanout, push, settlement, refresh, and intelligence work leave the request path |
| PR-006 | P0 | Data Engineer | Tech Lead | 2026-03-31 to 2026-04-07 | Remove runtime schema mutation and formalize migrations | ADR-0 package manager decision | Startup is read-only with respect to schema; migrations are reviewed and reversible |
| PR-007 | P1 | Backend Lead | Tech Lead | 2026-04-16 to 2026-04-21 | Add validation and pagination discipline | PR-001, PR-002 | Public endpoints have explicit schemas and bounded result sets |
| PR-008 | P1 | Tech Lead | Platform Engineer | 2026-04-16 to 2026-04-22 | Dependency cleanup and dead-code removal | PR-002, ADR-0 provider decision | Unused auth libraries and dead flows are removed; package list is intentional |
| PR-009 | P1 | Frontend Lead | Tech Lead | 2026-04-20 to 2026-04-24 | Reduce frontend bundle size | PR-002, PR-008 | Main bundle size drops materially and route splitting is enforced |
| PR-010 | P1 | Platform Engineer | Tech Lead | 2026-04-20 to 2026-04-22 | Env/config cleanup and startup validation | PR-002, PR-003, PR-006 | Env contracts are complete, validated, and documented |
| PR-011 | P1 | Platform Engineer | Tech Lead | 2026-04-20 to 2026-04-24 | Reproducible builds and release gates | ADR-0 package manager decision | CI is deterministic and blocks broken lint/build/test states |
| PR-012 | P1 | Data Engineer | Tech Lead | 2026-04-22 to 2026-04-29 | Query/index performance work tied to hot queries | PR-006, PR-007 | Measured hot queries have indexes, rewritten plans, and before/after evidence |
| PR-013 | P2 | Platform Engineer | Security Lead | 2026-04-30 to 2026-05-05 | Runbooks, backups, alerts, and secret rotation/retention | PR-003, PR-004, PR-006 | Ops has restore drills, alert thresholds, rotation policy, and incident procedures |
| PR-014 | P2 | Frontend Lead | Security Lead | 2026-04-30 to 2026-05-04 | Frontend CSP and browser hardening | PR-002 | Browser-side security posture is materially stronger |
| PR-015 | P2 | Tech Lead | Platform Engineer | 2026-05-04 to 2026-05-08 | Infra and service consolidation | PR-008, PR-010, PR-011 | Each external service has a clear purpose or is removed |
| PR-016 | P2 | Tech Lead | Platform Engineer | 2026-05-04 to 2026-05-08 | Provider consolidation and cost review | ADR-0 provider decision, PR-005 | Redundant market-data providers are removed or downgraded to fallback-only use |

## Security Review Hard Gate

- `PR-001`, `PR-002`, and `PR-003` cannot merge and cannot deploy without `Security Lead` sign-off.
- `PR-001` review artifacts: admin-route access matrix, anonymous/user/admin negative tests, and a direct verification that unauthenticated requests fail.
- `PR-002` review artifacts: final auth sequence diagram, proof that backend credentials are absent from `sessionStorage` and `localStorage`, and CSRF/XSS review for the final cookie-only design.
- `PR-003` review artifacts: distributed abuse test results, Redis limiter failure-mode review, and revocation propagation verification across multiple instances.

## P0 Details

### PR-001: Protect admin-invite routes

- Owner: `Backend Lead`
- Sign-off owner: `Security Lead`
- Scope: secure `/api/admin` invite and access-code operations.
- Files/modules: `backend/src/index.ts`, `backend/src/routes/admin-invites.ts`, `backend/src/routes/admin.ts`, new auth regression tests in `backend/src`.
- Approach: apply `requireAdmin` at the router boundary, align route mounting so all `/api/admin/*` paths share one authorization model, and add explicit anonymous/user/admin tests.
- Risks: accidental lockout of valid admin flows if middleware order is wrong.
- Rollback: revert route mounting and middleware changes; retain tests to confirm the previous behavior and re-apply behind a short-lived feature branch.
- Validation: integration tests for `401`, `403`, `200`; manual admin smoke test; verify no unauthenticated admin route responds successfully.
- Hard gate: `Security Lead` review is mandatory before merge or deploy.

### PR-002: Remove legacy auth flows and finalize cookie-only sessions

- Owner: `Backend Lead`
- Sign-off owner: `Security Lead`
- Scope: remove dead email/password/social/reset flows and eliminate browser-readable backend bearer tokens.
- Files/modules: `backend/src/index.ts`, `backend/src/lib/auth.ts`, `backend/src/middleware/auth.ts`, `backend/src/lib/session-token.ts`, `backend/src/lib/session-revocation.ts`, `backend/src/env.ts`, `webapp/src/lib/auth-client.ts`, `webapp/src/lib/backend-session-token.ts`, `webapp/src/lib/api.ts`, `webapp/src/components/AuthInitializer.tsx`, `webapp/src/hooks/usePrivyLogin.ts`, `webapp/src/pages/Login.tsx`, `webapp/src/pages/Docs.tsx`.
- Approach: remove legacy auth API helpers and UI, remove bearer fallback from middleware and frontend request code, keep Privy sync plus server-issued session cookie as the only login path, and update docs to reflect the final model.
- Risks: breaking login recovery paths, stale sessions after deploy, hidden UI paths still calling removed helpers.
- Rollback: restore the removed client helpers and bearer fallback behind a feature branch, but keep the sessionStorage code disabled by default; if rollback is required, treat it as an emergency temporary measure only.
- Validation: auth integration tests, browser login/logout regression, XSS-focused review that confirms no backend credential is readable from `window.sessionStorage` or `window.localStorage`, and load tests on `/api/auth/privy-sync` and `/api/me`.
- Hard gate: `Security Lead` review is mandatory before merge or deploy.

### PR-003: Enforce shared rate limiting and session revocation

- Owner: `Platform Engineer`
- Sign-off owner: `Security Lead`
- Scope: remove production dependence on local memory for rate limiting and revocation.
- Files/modules: `backend/src/env.ts`, `backend/src/lib/redis.ts`, `backend/src/middleware/rateLimit.ts`, `backend/src/lib/session-revocation.ts`, `backend/src/middleware/security.ts`, deployment env configuration.
- Approach: make Upstash env validation mandatory in production, fail startup if missing, migrate all sensitive and expensive limiters to the shared backend, and expose limiter health metrics and alarms.
- Risks: bad Redis configuration can cause startup failure or over-throttle production traffic.
- Rollback: keep the old code path available only in non-production; rollback in production means restoring the previous deploy while Redis credentials are fixed.
- Validation: cross-instance abuse test, limiter hit-rate dashboards, canary deploy with synthetic auth and quote traffic, and alarm verification for Redis failures.
- Hard gate: `Security Lead` review is mandatory before merge or deploy.

### PR-004: Queue infrastructure and operational controls

- Owner: `Platform Engineer`
- Sign-off owner: `Tech Lead`
- Scope: build the queue platform and control plane before moving any concrete flows.
- Files/modules: new queue/job modules under `backend/src`, `backend/src/env.ts`, `backend/src/index.ts`, `backend/package.json`, `vercel.json`, internal job authentication middleware, observability dashboards and deployment configuration.
- Approach: add QStash-backed producers and internal job handlers, define job envelopes and idempotency keys, add dead-letter handling, per-job concurrency controls, queue metrics, and authenticated internal execution paths.
- Risks: duplicate delivery if idempotency keys or handler authentication are incomplete.
- Rollback: disable queue producers and redeploy the previous release if queue plumbing causes systemic failures.
- Validation: enqueue/dequeue integration tests, duplicate-delivery tests, dead-letter tests, and internal job-auth verification.

### PR-005: Move concrete flows to background jobs

- Owner: `Backend Lead`
- Sign-off owner: `Tech Lead`
- Scope: migrate request-path work onto the queue infrastructure.
- Files/modules: `backend/src/routes/posts.ts`, `backend/src/routes/leaderboard.ts`, `backend/src/routes/notifications.ts`, `backend/src/services/webPush.ts`, `backend/src/services/marketcap.ts`, `backend/src/services/intelligence/engine.ts`, queue producer and consumer modules created in `PR-004`.
- Approach: move `post_fanout`, `push_delivery`, `settlement`, `market_refresh`, `leaderboard_refresh`, and `intelligence_refresh` to async jobs, preserve idempotency across retries, and keep request handlers responsible only for validation, durable writes, and enqueue.
- Risks: delayed notifications, duplicate refreshes, out-of-order updates, and stale caches during cutover.
- Rollback: keep a short-lived emergency flag for synchronous execution during initial staging only; for production rollback, return to the previous deploy rather than running dual paths long term.
- Validation: end-to-end tests that compare request latency before and after, backlog stress tests, duplicate execution tests, and freshness SLO dashboards for each migrated flow.

### PR-006: Remove runtime schema mutations and formalize migrations

- Owner: `Data Engineer`
- Sign-off owner: `Tech Lead`
- Scope: stop application instances from issuing DDL during startup and runtime drift handling.
- Files/modules: `backend/src/prisma.ts`, `backend/src/index.ts`, `backend/prisma/schema.prisma`, `backend/prisma/migrations/*`, `backend/scripts/prisma-migrate-deploy.mjs`, `backend/.env.example`, operational docs in `docs/`.
- Approach: move all remaining compatibility DDL into explicit Prisma or SQL migrations, remove startup mutation code, make startup schema checks read-only, and document migration, rollback, and restore procedures.
- Risks: latent schema drift currently hidden by runtime repair becomes visible, and deploys can fail if migrations are not applied correctly.
- Rollback: keep the last known-good migration chain and database snapshot, roll back application deploy first, and restore the prior schema only through reviewed SQL.
- Validation: migrate-from-clean-db test, migrate-from-current-prod-clone test, rollback rehearsal on staging, and startup verification that no `ALTER TABLE` or `CREATE INDEX` statements run from app boot.

## P0 Cutover Plan

### Preconditions

- P0 staging environment matches production dependencies for database, Redis, queue, and provider secrets.
- All P0 dashboards, alerts, synthetic probes, and rollback commands are prepared before the production window.
- `Backend Lead`, `Platform Engineer`, and `Security Lead` are staffed for the production cutover window and first-hour watch.

### Canary Sequence

1. Deploy the P0 release to staging and hold for `24 hours` with synthetic traffic and targeted load tests.
2. Deploy to production behind an internal-only canary path or canary domain and run for `30 minutes`.
3. Expand to `10%` of public traffic for `30 minutes`.
4. Expand to `50%` of public traffic for `30 minutes`.
5. Promote to `100%` only if all rollback thresholds remain clear.

### Rollback Thresholds

- Any unauthenticated or under-privileged access to an admin route.
- `5xx > 1.0%` on any critical path for `5 minutes`.
- Auth success rate on `/api/auth/privy-sync` drops below `99.5%` for `10 minutes`.
- `GET /api/me` exceeds `p95 400 ms` for `10 minutes`.
- `POST /api/posts` exceeds `p95 900 ms` for `10 minutes`.
- Redis rate-limit or revocation errors exceed `0.1%` of calls for `5 minutes`.
- Oldest high-priority job age exceeds `2 minutes` for `10 minutes`.
- Migration failure, queue dead-letter spike, or security review discovering a new exploitable path.

### First-Hour Monitoring

- Watch request volume, `401`, `403`, `429`, `5xx`, and p95/p99 latency for `/api/auth/privy-sync`, `/api/me`, `/api/feed`, `/api/posts`, `/api/notifications`, and `/api/leaderboard`.
- Watch Redis latency, Redis error rate, limiter hit rate, queue depth, oldest job age, dead-letter count, DB pool wait, slow-query count, and provider timeout rate.
- Watch post-create enqueue success, notification lag, settlement freshness, and any auth-session anomaly or unexpected logout spike.
- If any rollback threshold trips, roll back immediately, freeze further traffic expansion, and open an incident document before reattempting.

## P1 Details

### PR-007: Pagination and validation hardening

- Owner: `Backend Lead`
- Sign-off owner: `Tech Lead`
- Scope: every external API boundary gets explicit validation; every unbounded list becomes paginated.
- Files/modules: `backend/src/routes/users.ts`, `backend/src/routes/posts.ts`, `backend/src/routes/notifications.ts`, `backend/src/routes/leaderboard.ts`, `backend/src/routes/leaderboards.ts`, shared schemas in `backend/src/types.ts`.
- Approach: add `zValidator` to params, query, and body shapes; introduce cursor or page-size bounds for followers, following, repost lists, and other hot collections; reject oversized requests early.
- Risks: frontend breakage if existing callers expect unbounded arrays or lax inputs.
- Rollback: keep compatibility adapters for one release where needed, but do not reintroduce unbounded endpoints.
- Validation: contract tests, negative-input tests, and pagination load tests against large follower graphs.

### PR-008: Dependency cleanup and dead-code removal

- Owner: `Tech Lead`
- Sign-off owner: `Platform Engineer`
- Scope: remove unused packages, dead auth code, and low-value dependencies.
- Files/modules: `backend/package.json`, `webapp/package.json`, `backend/package-lock.json`, `webapp/package-lock.json`, `backend/bun.lock`, `webapp/bun.lock`, `webapp/src/lib/auth-client.ts`, `backend/src/index.ts`, provider-related services and docs.
- Approach: remove `better-auth` if source usage stays absent, remove direct `baseline-browser-mapping`, move or remove `@vibecodeapp/cloud-studio`, evaluate `@vibecodeapp/proxy`, and delete dead legacy auth helpers and dead docs references.
- Risks: hidden imports or scripts may still depend on a package that looks unused.
- Rollback: restore package entries and lockfiles in one revert commit if a hidden dependency is discovered.
- Validation: full install, build, typecheck, tests, route smoke tests, and bundle diff review.

### PR-009: Frontend bundle-size reduction

- Owner: `Frontend Lead`
- Sign-off owner: `Tech Lead`
- Scope: reduce startup cost and isolate heavy wallet, auth, and chart code.
- Files/modules: `webapp/src/App.tsx`, `webapp/src/lib/auth-client.ts`, `webapp/src/components/feed/PostCard.tsx`, `webapp/src/pages/Admin.tsx`, `webapp/src/pages/TokenPage.tsx`, `webapp/vite.config.ts`, `webapp/package.json`.
- Approach: tighten route-level lazy loading, move admin-only and trading-heavy code into separate chunks, remove dead auth code, and set a CI chunk budget.
- Risks: more route boundaries can create loading-state regressions if not handled cleanly.
- Rollback: revert chunk-splitting changes while retaining removed dead code and measurement tooling.
- Validation: build artifact diff, bundle analyzer output, slow-device smoke test, and p95 client boot timing on staging.

### PR-010: Env and config cleanup

- Owner: `Platform Engineer`
- Sign-off owner: `Tech Lead`
- Scope: make env contracts explicit and remove mismatches.
- Files/modules: `backend/src/env.ts`, `backend/.env.example`, `webapp/.env.example`, `backend/src/routes/invites.ts`, `webapp/src/components/PrivyWalletProvider.tsx`, `webapp/src/components/SolanaWalletProvider.tsx`, deploy configuration.
- Approach: add every used env var to the relevant schema/example, remove stale vars, decide whether `FRONTEND_URL` is required, and prevent private provider secrets from being referenced through `VITE_*`.
- Risks: startup failures after env validation becomes stricter.
- Rollback: revert the stricter validation in non-production while configuration is corrected; do not silently weaken production requirements.
- Validation: startup tests per environment, deploy dry runs, and explicit checks that no private provider secret is shipped to the client bundle.

### PR-011: Reproducible builds and release gates

- Owner: `Platform Engineer`
- Sign-off owner: `Tech Lead`
- Scope: make builds deterministic and enforce quality gates.
- Files/modules: root `package.json`, `backend/package.json`, `webapp/package.json`, lockfiles, CI workflow files under `.github/`, `webapp/eslint.config.js`, `webapp/vite.config.ts`.
- Approach: choose npm as canonical, remove dual-lockfile ambiguity, fix the current frontend lint failure, and require `install`, `lint`, `build`, `typecheck`, and targeted load checks in CI.
- Risks: build scripts may need cleanup where Bun assumptions leaked into scripts.
- Rollback: restore prior lockfiles and scripts in one revert if CI bootstrap breaks, then re-introduce changes incrementally.
- Validation: fresh clone build, CI parity check, and repeatable artifact hashes for equivalent inputs.

### PR-012: Query and index performance tied to hot queries

- Owner: `Data Engineer`
- Sign-off owner: `Tech Lead`
- Scope: optimize the highest-cost query patterns proven by load traces and query logs.
- Files/modules: `backend/src/routes/leaderboard.ts`, `backend/src/routes/leaderboards.ts`, `backend/src/routes/notifications.ts`, `backend/src/routes/users.ts`, `backend/src/routes/posts.ts`, `backend/prisma/schema.prisma`, `backend/prisma/migrations/*`, DB query-log and dashboard configuration.
- Approach: capture and rank real query fingerprints under staging load and first-canary traffic, then prioritize index and plan work for leaderboard aggregations, notification list/count queries, user profile/posts/reposts queries, followers/following graph queries, and any feed or chart query that stays in the top query set. Record `EXPLAIN ANALYZE` before and after every index or rewrite.
- Risks: write amplification from extra indexes, migration lock time, and optimizing the wrong query shape if traces are incomplete.
- Rollback: drop new indexes or revert query rewrites through reviewed migrations and restore the prior query path.
- Validation: before/after `EXPLAIN ANALYZE`, p95 latency improvement on the targeted routes, and a write-throughput regression check that stays within `10%`.

## P2 Details

### PR-013: Runbooks, backups, alerts, and secret rotation/retention

- Owner: `Platform Engineer`
- Sign-off owner: `Security Lead`
- Scope: production operations readiness and secret-management policy.
- Files/modules: `docs/`, deploy configuration, monitoring configuration, database backup configuration, secret-manager configuration.
- Approach: document incident runbooks for auth outage, Redis outage, queue backlog, DB saturation, and provider outage; define alert thresholds; run restore drills and record RTO/RPO; define secret rotation cadence and retention policy for session-signing secrets, Redis credentials, provider API keys, VAPID private key, cron secrets, and database credentials.
- Secret policy: standard rotation every `90 days`, emergency rotation within `4 hours` of suspected exposure, previous secret versions retained only for a controlled drain window of `24 hours` when dual-read is required, and no secrets logged or stored in the repo.
- Risks: false-positive alerts, incomplete runbooks, or accidental session invalidation during secret rotation.
- Rollback: documentation changes are low-risk; rotation changes roll back by restoring the immediately previous secret version within the allowed drain window.
- Validation: tabletop exercise, backup restore drill, alert fire-test, and a secret-rotation rehearsal in staging.

### PR-014: Frontend CSP and browser hardening

- Owner: `Frontend Lead`
- Sign-off owner: `Security Lead`
- Scope: tighten browser-side protections after auth cleanup.
- Files/modules: `webapp/index.html`, `vercel.json`, frontend auth/bootstrap code, any inline script usage discovered during implementation.
- Approach: define a strict CSP compatible with the final provider set, remove inline/script-eval dependencies where possible, and verify that auth and wallet flows still work.
- Risks: wallet or auth SDKs may require policy exceptions that need to be documented explicitly.
- Rollback: loosen CSP incrementally by nonce or host exception while preserving reporting and review.
- Validation: CSP report-only rollout, browser compatibility checks, and XSS regression review.

### PR-015: Infra and service consolidation

- Owner: `Tech Lead`
- Sign-off owner: `Platform Engineer`
- Scope: remove unnecessary services and clarify what remains.
- Files/modules: `vercel.json`, env/config docs, service wrappers in `backend/src/services`, package manifests, operational docs.
- Approach: inventory every external dependency, remove anything without a clear runtime purpose, and document owner, cost, and fallback for what remains.
- Risks: removing a low-traffic dependency can expose an undocumented edge-case dependency.
- Rollback: restore the removed integration and env vars from the last known-good deploy.
- Validation: service inventory review, cost comparison, and staging smoke tests with the reduced provider set.

### PR-016: Provider consolidation and cost review

- Owner: `Tech Lead`
- Sign-off owner: `Platform Engineer`
- Scope: reduce redundant market-data providers and simplify failure handling.
- Files/modules: `backend/src/services/helius.ts`, `backend/src/services/solscan.ts`, `backend/src/services/marketcap.ts`, `backend/src/services/intelligence/token-metrics.ts`, `backend/src/routes/posts.ts`, `webapp/src/components/feed/PostCard.tsx`, `webapp/src/pages/TokenPage.tsx`.
- Approach: keep primary providers only where they materially improve correctness or latency, demote secondary providers to fallback-only use if needed, and remove dead provider-specific code paths.
- Risks: narrower provider coverage can reduce resilience if fallbacks are removed without adequate measurement.
- Rollback: restore removed provider code paths behind configuration flags if data quality regresses.
- Validation: compare data completeness and latency before and after, run provider outage drills, and confirm circuit-breaker behavior with the final provider set.

## Load and Failure Validation Matrix

| Scenario | What breaks first today | Detection required after remediation | Graceful degradation target | Validation approach |
| --- | --- | --- | --- | --- |
| 10x traffic spike | DB read paths and inline expensive request handlers | p95/p99 latency, DB pool wait, cache-hit rate, error rate, queue depth | Serve stale cached reads, reject excess writes early, keep auth and core feed responsive | `k6` or `Artillery` against `/api/feed`, `/api/notifications`, `/api/posts`, `/api/leaderboard` with 10x baseline |
| Endpoint abuse without rate limiting | Multi-instance bypass of local limiters, provider cost spikes | Shared `429` metrics, per-route cardinality, Redis limiter health, provider spend alarms | Reject before DB/provider work, preserve legitimate traffic on other routes | Distributed abuse test from multiple clients or instances against auth, quote, and admin surfaces |
| DB connection saturation | Leaderboards, notifications, user graph reads, then writes | DB connection count, pool wait time, slow query logs, error budget burn | Stale-cache reads, fast `503` on non-critical writes, queue continues for retriable work | Load test with artificially reduced pool size and heavy concurrent reads and writes |
| Queue backlog | Notification and push freshness, then maintenance refreshes | Queue depth, oldest job age, retry count, dead-letter count | Pause low-priority refresh jobs first, preserve user writes and auth, surface delayed-status metrics | Enqueue 10x normal job volume and verify backlog drain time plus dead-letter handling |
| Third-party provider slowdown | Quote, chart, and intelligence refresh latency and timeout cascades | Circuit-breaker opens, timeout rate, stale-cache hit rate, provider-specific error rate | Use stale data where safe, disable non-critical enrichments, keep core post and read flows available | Inject `2s` to `10s` delays and `5xx` faults through mocks or proxy fault injection |

## Definition of Done

A remediation item is not complete unless all of the following are true:

- It is implemented and merged.
- It has automated test coverage appropriate to the change.
- It emits logs and metrics that let operators detect failure.
- It has a documented load or abuse behavior.
- It has a rollback procedure.
- If it touches auth, access control, or rate limiting and it is `PR-001`, `PR-002`, or `PR-003`, `Security Lead` sign-off is attached before merge.
- If it is operational in nature, it is documented in `docs/` and exercised at least once in staging.

## Release Gate

Public production launch remains blocked until:

- `PR-001` through `PR-006` are complete.
- `Security Lead` has signed off `PR-001`, `PR-002`, and `PR-003`.
- P0 load and abuse validation passes.
- P0 canary expansion completes without hitting any rollback threshold.
- First-hour monitoring after full rollout completes without a rollback event.
- Monitoring and rollback paths for P0 changes are confirmed.
- The accountable owner and sign-off owner for each P0 item both sign off in the tracker.
