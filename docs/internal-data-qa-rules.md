# Internal Data QA Rules

Last updated: 2026-04-26

These rules are the current guardrails for platform data correctness.

## Validators

`webapp/src/lib/data-validators.ts` protects visible Feed and right-rail data from looking sourced when it is not.

- `isValidMarketStats`: market stats need at least one finite, non-zero real market field before rendering as live.
- `isValidGainer`: top gainers need a real non-zero 24h move, a usable token identity, and a non-unavailable change source.
- `isValidCandleSeries`: charts need enough finite OHLCV candles and meaningful OHLC movement. Flat, malformed, or placeholder-like candles compress to unavailable.
- `isValidSignalScore`: AI/setup/health scores need finite values inside `0..100`.
- `isValidSmartMoney`: smart-money copy needs explicit flow/trader/whale signal, not just an empty label.
- `isValidRiskLabel`: low-risk or clean-style labels need explicit backend evidence and must not be inferred from missing risk data.

## Coverage States

- `live`: source returned enough real data for the value to render normally.
- `partial`: source returned some data, but the UI must show the unavailable reason for missing fields and avoid confident labels.
- `unavailable`: source did not return enough data. Render compact unavailable copy, hide the module, or show `not_enough_evidence`.

Frontend code should not upgrade `partial` or `unavailable` data into a confident label. Backend responses should include `coverage.state`, `coverage.source`, and `coverage.unavailableReason` where a field can be absent or projected.

## Chart Rendering

Feed chart previews render only when `isValidCandleSeries` passes. If OHLCV coverage is missing, too short, flat, or malformed, the card must compress to a compact "chart unavailable" state instead of drawing a fake-looking chart or showing a price label from unusable candles.

Strong coverage can render the full card. Partial coverage should use a medium compact card. Unavailable coverage should use a text-first card with no large chart or metric panels.
