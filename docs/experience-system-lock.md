# Experience System Lock

## Purpose
This document is the enforceable contract for the first terminal rebuild slice.
It defines what profile, leaderboard, and terminal surfaces must do before broader feature work continues.

## Core Principles
- Performance-first, not social-first.
- Dense information without clutter.
- Zero flicker on live updates.
- One visual language across profile, leaderboard, and terminal.
- API data must be normalized through ViewModels before rendering.

## Visual Rules
- Backgrounds use deep near-black surfaces, not flat gray.
- Surfaces rely on tonal separation and soft elevation, not heavy borders.
- Primary text is white.
- Secondary text is muted gray.
- Profit green is the dominant accent.
- Loss red is reserved for negative state and warnings.
- Chips are the default pattern for timeframe, mode, route, and filter controls.
- Avatars are circular and treated as trust anchors.
- Profile banners are removed from performance-first surfaces.

## Spacing And Density
- Base grid: `4px`.
- Primary cards use `28px` to `32px` radius.
- Screen sections should compress before they wrap.
- Avoid decorative empty space.
- Data groups should be separated by hierarchy and rhythm, not nested card stacks.

## Motion Rules
- No full-card remounts on quote refresh, follow state changes, wallet changes, or trade execution updates.
- Numeric values update in place.
- Lists retain row position unless sort order actually changes.
- Execution flows use persistent step states, not toast-only feedback.
- Mobile details appear in bottom sheets or progressive overlays.

## ViewModel Contract
- Components render display-ready values only.
- Raw API payloads do not enter terminal/profile/leaderboard components directly.
- Formatting rules live in ViewModels:
  - currency labels
  - percent labels
  - compact counts
  - tone selection
  - fallback identity labels

## Surface Rules

### Profile = TraderPerformanceView
- Required hierarchy:
  - identity
  - credibility strip
  - dominant PnL/value
  - chart
  - positions
- Required fields:
  - `total_pnl`
  - `pnl_24h`
  - `win_rate`
  - `avg_hold_time`
  - `trade_count`
  - `positions[]`
- Rules:
  - PnL/value is the largest metric.
  - Chart stays above the fold.
  - Positions are live and clickable.
  - Do not mix social decoration with financial hierarchy.

### Leaderboard = Competitive Scan Surface
- Required hierarchy:
  - pinned rank
  - timeframe chips
  - ranking mode chips
  - dense rows
- Row order:
  - rank
  - avatar
  - display name
  - handle
  - dominant metric
  - token/context badges
- Rules:
  - server-side sorting only
  - no layout shift on simple metric refresh
  - rank color tiers: gold, silver, bronze

### Terminal = 3-Column Execution Surface
- Left column:
  - token identity
  - liquidity / volume / holders
  - risk
  - smart wallet activity
  - live activity avatars
- Center column:
  - chart primary
  - trades/orderflow always visible
  - overlays for entries, clusters, and signals
- Right column:
  - buy/sell
  - presets
  - slippage
  - route preview
  - fees
  - ETA
  - execution stepper
- Rules:
  - execution must feel like a process, not a button click
  - the stepper is mandatory for same-chain and cross-chain flows

## Current Slice Scope
- New experience primitives in `webapp/src/index.css`
- Shared experience components in `webapp/src/components/experience`
- ViewModels in `webapp/src/viewmodels`
- First migrated screens:
  - self profile
  - leaderboard
- Public profile migration is the next UI conversion step and must reuse the same surface model

## Non-Negotiable Acceptance For This Layer
- No new surface may bypass the ViewModel layer.
- No new surface may invent a separate style grammar.
- No new profile/leaderboard work may reintroduce banners or social-first layout priority.
- Terminal work must reuse the same chips, cards, spacing, and metric hierarchy defined here.
