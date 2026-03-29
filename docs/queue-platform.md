# Queue Platform

Status: `PR-004 implemented`
Date: `2026-03-29`

## Purpose

This control plane adds durable queue plumbing before any concrete business flow is migrated off the request path.

## Provider

- Queue provider: `Upstash QStash`
- Publish target: `POST /api/internal/jobs/:jobName`
- Dead-letter callback: `POST /api/internal/jobs/failures`

## Required Queue Concepts

- Signed delivery: every internal job delivery must present a valid `Upstash-Signature`.
- Idempotency: job execution is keyed by `jobName + idempotencyKey`.
- Flow control: every job type publishes with an explicit `Upstash-Flow-Control-Key` and `Upstash-Flow-Control-Value`.
- Dead-letter handling: exhausted jobs call the internal failure callback and increment dead-letter metrics.
- Per-instance backpressure: handlers also enforce a local concurrency cap to stop one instance from over-consuming.

## Environment

- `BACKEND_URL`: canonical callback base URL used for publish targets and signature verification.
- `QSTASH_URL`: queue API base URL. Defaults to `https://qstash.upstash.io`.
- `QSTASH_TOKEN`: publish credential.
- `QSTASH_CURRENT_SIGNING_KEY`: active signing key for delivery verification.
- `QSTASH_NEXT_SIGNING_KEY`: next signing key for rotation overlap.

## Job Types Defined In PR-004

- `post_fanout`
- `push_delivery`
- `settlement`
- `market_refresh`
- `leaderboard_refresh`
- `intelligence_refresh`

## Current Scope Boundary

- PR-004 mounts the queue control plane and delivery handlers.
- PR-004 does not move existing business work onto the queue yet.
- PR-005 is responsible for registering real handlers and moving concrete flows to producers/consumers.

## Operational Notes

- Queue config state is surfaced in `/health` as `jobQueue`.
- Delivery outcomes are logged with the `[job-queue]` prefix.
- Dead-letter callbacks log summarized payload metadata only.
- Production remains release-blocked until PR-005 migrates the expensive request-path work and P0 cutover validation passes.
