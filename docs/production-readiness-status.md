# Production Readiness Status

Status: Active execution
Last updated: 2026-03-29

## Current Phase

- ADR-0: Approved
- P0: In progress
- Public release: Blocked until P0 release gate is satisfied

## P0 Status

| Ticket | Owner | Sign-off owner | Status | Notes |
| --- | --- | --- | --- | --- |
| `PR-001` | Backend Lead | Security Lead | Implemented, pending sign-off | Admin invite routes now share the admin guard and backend regression tests pass |
| `PR-002` | Backend Lead | Security Lead | Implemented, pending sign-off | Browser-readable backend token path removed, legacy auth exports removed, cookie-only session path verified |
| `PR-003` | Platform Engineer | Security Lead | Implemented, pending sign-off | Production now requires Upstash Redis REST and rate limiting no longer falls back to memory in production |
| `PR-004` | Platform Engineer | Tech Lead | Implemented, pending sign-off | QStash-backed internal job control plane, signed delivery verification, idempotency, dead-letter callback, and queue health wiring are in place |
| `PR-005` | Backend Lead | Tech Lead | Implemented, pending sign-off | Post-create fanout, push delivery, maintenance dispatch, settlement dispatch, leaderboard stats refresh, and intelligence refresh now route through the internal job control plane; read-path intelligence refresh was removed and the priority loop now enqueues idempotent jobs |
| `PR-006` | Data Engineer | Tech Lead | Implemented, pending sign-off | Baseline bootstrap migration is active, additive migrations are archived, direct-DB clean bootstrap and adoption validation passed on the EC2 executor, and runtime schema mutation paths were removed |

## Daily Log

### 2026-03-29

- Execution opened against the approved production-readiness roadmap.
- ADR-0 is treated as approved and P0 work has started.
- `PR-001` route protection was implemented by extracting a shared admin guard and applying it to the admin-invites router.
- Added regression coverage for anonymous, non-admin, and admin access to the admin-invites surface.
- Backend verification passed: `npm --prefix backend run test` and `npm --prefix backend run typecheck`.
- `PR-001` is now pending `Security Lead` sign-off.
- `PR-002` was implemented by removing the frontend backend-session token store, removing legacy email/password/social/reset exports, removing bearer session lookup from backend auth resolution, and stopping auth responses from returning a browser-consumed session token.
- Verification passed for `PR-002`: `npm --prefix backend run test`, `npm --prefix backend run typecheck`, and `npm --prefix webapp run build`.
- `PR-002` is now pending `Security Lead` sign-off.
- `PR-003` was implemented by making Upstash Redis REST a production startup requirement and by removing the production in-memory fallback path from rate limiting.
- Added backend hardening tests for the production shared-backend requirement and fallback rejection logic.
- Verification passed for `PR-003`: `npm --prefix backend run test` and `npm --prefix backend run typecheck`.
- `PR-003` is now pending `Security Lead` sign-off.
- `PR-004` was implemented by adding the QStash-backed queue control plane, signed internal job routes, Redis-backed idempotency primitives, per-job concurrency caps, dead-letter callback handling, and queue health visibility.
- Added backend regression coverage for signed queue delivery, duplicate replay suppression, and QStash publish header construction.
- Added `docs/queue-platform.md` to capture the queue architecture, env contract, and control-plane boundaries before business-flow migration.
- Verification passed for `PR-004`: `npm --prefix backend run test` and `npm --prefix backend run typecheck`.
- `PR-004` is now pending `Tech Lead` sign-off.
- `PR-005` moved the first concrete flows off the request path by queueing post-create fanout and push delivery while retaining a direct fallback when QStash publish credentials are absent.
- Registered the first internal job handlers for `post_fanout` and `push_delivery`, and updated post creation to enqueue follower/alpha fanout instead of waiting on it inline.
- Verification passed for the `PR-005` slice: `npm --prefix backend run test` and `npm --prefix backend run typecheck`.
- `PR-005` remains in progress until settlement, market refresh, leaderboard refresh, and intelligence refresh are migrated.
- `PR-005` migrated the remaining maintenance dispatch paths to the queue control plane: `/maintenance/run` now enqueues settlement, market refresh, intelligence refresh, and leaderboard refresh; `/settle` now dispatches through the queue; stale leaderboard stats refreshes now schedule `leaderboard_refresh` instead of in-process fire-and-forget work.
- Registered the remaining internal job handlers for `settlement`, `market_refresh`, `intelligence_refresh`, and `leaderboard_refresh`, and added regression coverage for the new maintenance job builders.
- Verification passed for the second `PR-005` slice: `npm --prefix backend run test` and `npm --prefix backend run typecheck` with backend tests now at `23` passing cases.
- `PR-005` is now functionally complete. The read-path token refresh trigger was removed from `services/intelligence/engine.ts`, the standalone intelligence priority loop now enqueues the idempotent `intelligence_refresh` job instead of calling refresh work directly, and the unused direct maintenance cycle path that still referenced intelligence prewarm was deleted.
- Verification passed for the final `PR-005` slice: `npm --prefix backend run test` and `npm --prefix backend run typecheck` with backend tests now at `24` passing cases.
- Code-path verification for `PR-005` now reduces `prewarmRecentTokenIntelligence(...)` references to the job executor path only, and `POST /api/posts` no longer calls or schedules intelligence refresh work synchronously.
- `PR-006` moved from pending to active analysis. Prisma diffing confirmed the current schema can be rendered from scratch, but the checked-in migration history is additive and not yet a full bootstrap chain, so runtime DDL removal still needs a formal baseline migration plan before code deletion.
- `PR-006` now has an execution plan captured in `docs/pr-006-migration-baseline-plan.md`. The baseline approach is: generate a full bootstrap migration from the current schema, archive the additive-only migration chain out of the active deploy path, verify clean-db bootstrap, verify a staging-clone resolve-and-deploy path, then remove runtime DDL and the schema-drift compat refresh hook.
- `PR-006` resumed on the IPv6-capable EC2 executor after direct `5432` reachability was verified. Clean bootstrap passed with `migrate deploy` against schema `pr006_clean_20260329_ec2`, and the follow-up `migrate diff --exit-code` returned `No difference detected`.
- A staging-clone adoption path was validated safely in isolated schema `pr006_stageclone_20260329_ec2`: `db push` created the pre-existing structure, `migrate resolve --applied 20260329_bootstrap_baseline` recorded the baseline, `migrate deploy` applied no extra work, and the final `migrate diff --exit-code` returned `No difference detected`.
- The verified bootstrap baseline is now the active Prisma migration chain, the previous additive migrations were moved into `backend/prisma/migrations_archive`, and runtime schema mutation plus schema-drift compat refresh hooks were removed from backend code.
- Final `PR-006` verification passed locally after the migration-chain swap: `rg` found no runtime DDL in `backend/src`, `npm --prefix backend run typecheck` passed, `npm --prefix backend run test` passed with `24/24`, and the backend completed a direct boot check after `prisma generate` + `prisma-migrate-deploy.mjs` + `bun run src/index.ts`.
- No feature work is authorized until all P0 items are complete and signed off.
