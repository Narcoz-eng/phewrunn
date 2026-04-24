# V2 Pixel-Parity Pass Notes

Current pass date: 2026-04-24

## Shell / Sidebar

- Target width: 220-240px fixed left rail; implemented 232px.
- Content stage: no global topbar; page headers own search/icons/avatar.
- Sidebar order: logo, compact nav, user card, XP bar, AI trader score, quick actions, utility icons.
- Active state: lime translucent row plus left lime indicator.
- Dead routes: Portfolio, Communities, AI Intelligence, Messages, More, Create Raid, and Wallet Tracker are disabled instead of silently routing to unrelated pages.

## Feed

- Target columns: left sidebar 232px, main feed min 720px, right rail 340px.
- Header: `FEED` title/subtitle left; compact search/actions/avatar right.
- Module order: header, composer, tab rail, announcements, feed list, right rail from top.
- Spacing: 14-18px cards/gaps, tighter than prior dashboard layout.
- Remaining data rule: feed posts still come from `/api/feed/*` and discovery rail from `/api/discovery/feed-sidebar`.

## Leaderboard

- Target columns: main board plus 340px right rail.
- Header: title/subtitle with search/actions/avatar.
- Board tabs: call/wallet/raid/XP row retained; wallet remains explicit unavailable state because wallet-performance ranking is not implemented.
- Podium: implemented real 1/2/3 podium from ranked call-performance rows, with medal styling and sparklines.
- Right rail: keeps Top Movers, AI Highlights, Active Leaders, Legend.

## Bundle Checker

- Target columns: graph-dominant main area plus 350px risk rail.
- Header: `Trace smart. Trade safe.` with KPI cards aligned right.
- Search: full-width under title/KPIs.
- Graph: large dark canvas, real nodes/edges only, edge strength opacity/width, selectable node panel, graph controls, legend.
- Sparse state: no synthetic nodes before backend resolution.

## Raid

- Target columns: live-room main area plus 340-360px right rail.
- Header: `RAIDS`, subtitle, search/actions/avatar.
- Existing backend-backed live room data retained from `/api/tokens/:token/community/raids/:id`.
- Chat simulation avoided; live activity uses real updates/submissions, with proof-link input.

## Community

- Header: `COMMUNITY`, breadcrumb copy, search/actions/avatar.
- Existing community hero, tabs, composer/feed section, and right rail continue to use token-community backend endpoints.
- No hardcoded SOL routing added.

## Remaining Pages

- Profile and Terminal/Token already had V2 data-backed compositions. This pass removed the global shell topbar that was visually conflicting with them; deeper page-level pixel matching is still the next highest-value continuation.
