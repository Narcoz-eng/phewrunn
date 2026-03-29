# PR-006 Migration Baseline Plan

Status: Active execution planning
Last updated: 2026-03-29

## Objective

Remove all runtime schema mutation from the backend and replace it with a reviewed Prisma migration chain that can:

- bootstrap a clean database from zero
- reconcile an existing staging clone without app-boot DDL
- leave no `CREATE TABLE IF NOT EXISTS`, `ALTER TABLE ... IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`, or runtime compat refresh hooks in the application code

## Current State

- `backend/src/prisma.ts` still contains `initPostgresCompatColumns(...)` and `refreshPrismaCompatGuardrails(...)`.
- `backend/src/middleware/errorHandler.ts` still triggers the compat refresh hook on schema-drift failures.
- `backend/prisma/migrations` is additive, not a full bootstrap chain.
- Baseline feasibility is confirmed: `npx prisma migrate diff --from-empty --to-schema-datamodel prisma/schema.prisma --script` renders the full current schema successfully.

## Execution Plan

### Step 1: Generate the bootstrap baseline migration

Goal: produce one migration that creates the full current schema from an empty database.

Commands, in order:

```powershell
New-Item -ItemType Directory -Force backend/prisma/migrations/20260329_bootstrap_baseline
Push-Location backend
npx prisma migrate diff --from-empty --to-schema-datamodel prisma/schema.prisma --script --output prisma/migrations/20260329_bootstrap_baseline/migration.sql
Pop-Location
```

Expected result:

- `backend/prisma/migrations/20260329_bootstrap_baseline/migration.sql` contains the full schema bootstrap.
- No runtime DDL remains required to create tables, columns, indexes, or extensions.

### Step 2: Move the additive chain out of the active deploy path

Goal: make the active migration directory represent a valid bootstrap chain from empty.

Approach:

- keep `migration_lock.toml`
- retain `20260329_bootstrap_baseline` as the first active migration
- move the current additive migrations into an archive directory for audit/reference only

Commands, in order:

```powershell
New-Item -ItemType Directory -Force backend/prisma/migrations_archive
Move-Item -LiteralPath backend/prisma/migrations/20260306_add_reports_table -Destination backend/prisma/migrations_archive/
Move-Item -LiteralPath backend/prisma/migrations/20260306_add_runtime_compat_columns -Destination backend/prisma/migrations_archive/
Move-Item -LiteralPath backend/prisma/migrations/20260307_add_aggregate_snapshot_and_post_indexes -Destination backend/prisma/migrations_archive/
Move-Item -LiteralPath backend/prisma/migrations/20260307_add_feed_cursor_and_search_indexes -Destination backend/prisma/migrations_archive/
Move-Item -LiteralPath backend/prisma/migrations/20260307_add_notification_dedupe_key -Destination backend/prisma/migrations_archive/
Move-Item -LiteralPath backend/prisma/migrations/20260307_harden_auth_and_trade_fee_events -Destination backend/prisma/migrations_archive/
Move-Item -LiteralPath backend/prisma/migrations/20260309_add_ai_intelligence_layer -Destination backend/prisma/migrations_archive/
Move-Item -LiteralPath backend/prisma/migrations/20260311_reconcile_runtime_compat_schema -Destination backend/prisma/migrations_archive/
Move-Item -LiteralPath backend/prisma/migrations/20260316_add_push_subscriptions -Destination backend/prisma/migrations_archive/
Move-Item -LiteralPath backend/prisma/migrations/20260316_add_smart_alert_preferences -Destination backend/prisma/migrations_archive/
Move-Item -LiteralPath backend/prisma/migrations/20260324_add_bundle_cluster_action -Destination backend/prisma/migrations_archive/
```

Expected result:

- `backend/prisma/migrations` becomes a valid bootstrap directory.
- `backend/prisma/migrations_archive` preserves the old additive history for audit comparison.

### Step 3: Verify clean-database bootstrap

Goal: prove the active migration directory can build the schema from empty with no runtime help.

Inputs:

- `PRISMA_BASELINE_TEST_DATABASE_URL`
- `PRISMA_BASELINE_TEST_SHADOW_URL`

Commands, in order:

```powershell
Push-Location backend
$env:DATABASE_URL=$env:PRISMA_BASELINE_TEST_DATABASE_URL
$env:DIRECT_URL=$env:PRISMA_BASELINE_TEST_DATABASE_URL
npx prisma migrate deploy
npx prisma migrate diff --from-url $env:PRISMA_BASELINE_TEST_DATABASE_URL --to-schema-datamodel prisma/schema.prisma --shadow-database-url $env:PRISMA_BASELINE_TEST_SHADOW_URL --exit-code
Pop-Location
```

Expected result:

- `prisma migrate deploy` succeeds on an empty database.
- the final diff exits `0`, proving the clean DB matches `schema.prisma`.

### Step 4: Verify staging-clone adoption

Goal: prove an already-populated environment can adopt the new baseline without replaying DDL.

Inputs:

- `PRISMA_STAGING_CLONE_DATABASE_URL`
- `PRISMA_STAGING_CLONE_SHADOW_URL`

Commands, in order:

```powershell
Push-Location backend
$env:DATABASE_URL=$env:PRISMA_STAGING_CLONE_DATABASE_URL
$env:DIRECT_URL=$env:PRISMA_STAGING_CLONE_DATABASE_URL
npx prisma migrate resolve --applied 20260329_bootstrap_baseline
npx prisma migrate deploy
npx prisma migrate diff --from-url $env:PRISMA_STAGING_CLONE_DATABASE_URL --to-schema-datamodel prisma/schema.prisma --shadow-database-url $env:PRISMA_STAGING_CLONE_SHADOW_URL --exit-code
Pop-Location
```

Expected result:

- baseline is marked as applied on the staging clone
- `migrate deploy` applies no extra drift-fix DDL
- the final diff exits `0`, proving the staging clone matches `schema.prisma`

### Step 5: Remove runtime DDL and compat refresh hooks

Goal: leave startup and error handling read-only.

Files to change:

- `backend/src/prisma.ts`
- `backend/src/middleware/errorHandler.ts`

Required code removal:

- delete `initPostgresCompatColumns(...)`
- delete `refreshPrismaCompatGuardrails(...)`
- delete startup invocation of the compat guardrails
- delete schema-drift-triggered compat refresh from the error handler

Verification commands:

```powershell
rg -n "initPostgresCompatColumns|refreshPrismaCompatGuardrails|CREATE TABLE IF NOT EXISTS|ALTER TABLE .*IF NOT EXISTS|CREATE INDEX IF NOT EXISTS" backend/src -S
npm --prefix backend run typecheck
npm --prefix backend run test
```

Expected result:

- the `rg` command returns no runtime schema mutation hits in `backend/src`
- backend typecheck passes
- backend tests pass

## Definition Of Done

`PR-006` is done only when all of the following are true:

- the active Prisma migration directory boots a clean database from empty
- a staging clone can adopt the new baseline with `migrate resolve` plus `migrate deploy`
- runtime DDL is removed from `backend/src/prisma.ts`
- schema-drift compat refresh is removed from `backend/src/middleware/errorHandler.ts`
- code search shows no runtime schema mutation statements remain in backend source
- backend typecheck passes
- backend tests pass
- `Tech Lead` sign-off is recorded

## Current Risk To Timeline

- `PR-006` is still the critical path for the April 2 load-test gate.
- The main schedule risk is baseline adoption on the staging clone; if the clone diff is not clean after `migrate resolve`, the load test date must move.
- Validation will not be compressed. Any failure in Step 3 or Step 4 moves the full P0 gate timeline.
