# Whale Ingestion Architecture

Last updated: 2026-04-27

## Rules

- Whale rows are never synthesized in the UI.
- Feed and right rail only render persisted, verified whale events.
- A whale event requires source, wallet, token, USD value, direction, timestamp, transaction hash, and dedupe key.
- Smart money is separate from whale size. A wallet becomes smart money only through tracked performance, repeated profitable behavior, or manual trust tagging.

## Solana

- Source: Helius webhooks and enhanced transaction streams.
- Endpoint: `POST /api/webhooks/helius`.
- Current persistence: `TokenEvent` with metadata `{ source, signature, wallet, tokenAddress, amount, valueUsd, direction, transactionType, explorerUrl }`.
- Deduplication: transaction signature in event metadata.
- Display: `/api/discovery/feed-sidebar` reads recent `whale_*` token events.

## Ethereum

- Required provider: Alchemy or Infura.
- Events to ingest:
  - ERC20 `Transfer` logs.
  - Uniswap/Sushi swap logs.
  - Large wallet movements from tracked addresses.
- Required normalized shape matches Solana:
  - `wallet`
  - `tokenAddress`
  - `valueUsd`
  - `direction`
  - `timestamp`
  - `txHash`
  - `source`

## Threshold

- Current bootstrap threshold: `HELIUS_WHALE_THRESHOLD_USD`.
- V2 target: dynamic threshold using token liquidity and market cap, with an absolute minimum floor.

## Feed Usage

- Whale card renders only when `payload.whale` has verified event coverage.
- Right rail Whale Activity renders only persisted events younger than the freshness window.
- No `quiet`, `neutral`, or midpoint smart-money fallback is valid user-facing data.
