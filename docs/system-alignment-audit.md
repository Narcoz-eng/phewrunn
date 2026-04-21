# System Alignment Audit

Audit date: `2026-04-21`

Purpose: verify the current codebase against the execution plan and the top-tier trading terminal standard.

Status labels:
- `Done`: implemented end-to-end in the current architecture
- `Partial`: present in some form, but not aligned to the required standard
- `Missing`: absent or structurally blocked

## 1. Trading Core
Status: `Partial`

What exists:
- Solana trading is implemented through Jupiter proxy flows in feed and token surfaces.
- Token-page and feed panels can fetch quotes and execute Solana swaps.
- Trade panel live data exists and recent trades can update from backend live feeds.

What is incomplete:
- The trading engine is still not unified end-to-end.
- Feed and token-page execution remain separate component flows.
- ETH trading is not part of the same engine.
- Cross-chain execution does not exist.
- Chart overlays for real trade bubbles are not implemented to terminal standard.
- Trades tables are not system-wide wallet-intelligence tables.

Evidence:
- `webapp/src/components/feed/PostCard.tsx`
- `webapp/src/components/token/DirectTokenTradePanel.tsx`
- `webapp/src/components/feed/TradingPanel.tsx`
- `webapp/src/lib/trading/jupiter-proxy.ts`

## 2. Real-Time System
Status: `Partial`

What exists:
- Backend uses Birdeye WebSocket ingestion for live trade feeds.
- Frontend trade panel consumes a live stream for chart/trade updates.

What is incomplete:
- The app does not use one unified WebSocket event bus.
- Frontend live trading currently depends on SSE/EventSource, not a single shared socket model.
- Leaderboard, profile, signals, and terminal do not all react to one shared real-time contract.
- Fallback paths still exist and can serve stale data.

Evidence:
- `backend/src/services/birdeye-trade-feed.ts`
- `backend/src/routes/posts.ts`
- `webapp/src/lib/trade-panel-live.ts`

## 3. Profile System
Status: `Partial`

What exists:
- Self profile has been migrated to the new terminal-style performance surface.
- Shared TraderPerformance ViewModel and UI components exist.

What is incomplete:
- Public profile is not fully migrated to the same performance-first surface.
- Banner-based profile code still exists in the public profile page.
- Profile values are still assembled from wallet overview/posts data, not from one authoritative trading engine.
- Positions are not guaranteed to be synchronized to the same execution model used by all trading surfaces.

Evidence:
- `webapp/src/pages/Profile.tsx`
- `webapp/src/pages/UserProfile.tsx`
- `webapp/src/components/experience/TraderPerformanceView.tsx`
- `webapp/src/viewmodels/trader-performance.ts`

## 4. Leaderboard System
Status: `Partial`

What exists:
- New leaderboard surface exists with pinned rank, dense rows, and terminal styling.
- Backend top-users routes exist.

What is incomplete:
- Ranking is based on `level`, `activity`, and `winrate`, not real realized PnL.
- `30d` and `All` are not implemented in the new terminal leaderboard.
- Recent token activity per row is not sourced from a dedicated performance snapshot model.
- Real-time leaderboard shifts from one event engine are not implemented.

Evidence:
- `backend/src/routes/leaderboard.ts`
- `webapp/src/pages/Leaderboard.tsx`
- `webapp/src/components/experience/TraderPerformanceView.tsx`

## 5. Wallet Intelligence
Status: `Partial`

What exists:
- Intelligence engine calculates bundle clusters and some smart/whale-style token metrics.
- Token page renders bundle/holder intelligence.
- Alert engine has smart-wallet and whale accumulation reason codes.

What is incomplete:
- Labels are not rendered system-wide in trades tables, chart overlays, signals, and execution views.
- There is no single wallet-label service exposed consistently across all surfaces.
- Explorer links and wallet transparency are not standardized across the product.

Evidence:
- `backend/src/services/intelligence/engine.ts`
- `backend/src/services/intelligence/alerts.ts`
- `webapp/src/pages/TokenPage.tsx`

## 6. Activity Layer
Status: `Missing`

What exists:
- Some live trading updates appear in the token/trade panel flow.

What is incomplete:
- Activity is not propagated as a unified product layer across charts, leaderboard rows, token views, and profile activity.
- Avatar-based live activity is not wired as a core cross-surface system.
- The UI still feels screen-based rather than event-propagated.

Evidence:
- No shared `activity.trade` event system found across major frontend surfaces

## 7. Cross-Chain + ETH
Status: `Missing`

What exists:
- Privy/EVM auth infrastructure exists.
- EVM wallet/auth code is present in the app.

What is incomplete:
- EVM trade execution is not production-complete in the same engine.
- Token trading UI still shows pending/disabled EVM route states.
- Cross-chain route selection, execution, fees, ETA, and step tracking are not implemented.

Evidence:
- `webapp/src/components/feed/TradingPanel.tsx`
- `webapp/src/components/token/DirectTokenTradePanel.tsx`
- `webapp/src/components/PrivyWalletProvider.tsx`

## 8. AI / Signal System
Status: `Partial`

What exists:
- Intelligence scoring, alerts, bundle analysis, and token metrics exist on the backend.
- Signals include reason strings and reason codes.

What is incomplete:
- Signal presentation is not yet standardized around score + reason + wallets involved.
- Deterministic cross-surface delivery and traceable wallet evidence are not enforced everywhere.
- Notification consistency still depends on existing cache/fallback behavior.

Evidence:
- `backend/src/services/intelligence/scoring.ts`
- `backend/src/services/intelligence/engine.ts`
- `backend/src/services/intelligence/alerts.ts`

## 9. Design System
Status: `Partial`

What exists:
- Experience primitives, terminal classes, and TraderPerformance components are in place.
- Experience system lock doc exists.

What is incomplete:
- The design system is not yet applied across the whole app.
- Token page, trading panels, public profile, and several legacy surfaces still use older visual systems.
- Icon unification is not complete.

Evidence:
- `docs/experience-system-lock.md`
- `webapp/src/index.css`
- `webapp/src/components/experience/TraderPerformanceView.tsx`

## 10. Single Underlying Data Model / Execution Engine
Status: `Missing`

What exists:
- The ViewModel layer is started for profile and leaderboard surfaces.
- Shared Jupiter quote client now exists.

What is incomplete:
- There is still no single execution engine spanning token page, feed trading, profile positions, leaderboard performance, ETH execution, and cross-chain execution.
- Real-time data contracts are not yet unified.

Evidence:
- `webapp/src/lib/trading/jupiter-proxy.ts`
- `webapp/src/components/feed/PostCard.tsx`
- `webapp/src/components/token/DirectTokenTradePanel.tsx`

## Additional Execution-Plan Gaps
These remain open from the broader rebuild plan:
- `Send (wallet -> wallet)` flow: `Missing`
- Community owner/mod/member permission model: `Missing`
- Ownership transfer flow: `Missing`
- Publish-community root-cause hardening: `Partial`
- Admin dashboard unification: `Partial`

## Current Highest-Priority Work
1. Unify Solana trading runtime so feed and token page stop owning separate execution logic.
2. Replace fragmented live-data paths with one shared event contract.
3. Finish public profile migration to the performance dashboard system.
4. Rebuild leaderboard around real PnL snapshots instead of level/activity/win-rate proxies.
5. Complete ETH and cross-chain execution under the same execution model.
