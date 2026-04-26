# Platform Data Correctness Audit

Last updated: 2026-04-26

## Shared Contracts

- Feed token/signal fields use `Post.signal`, `Post.tokenContext`, and `Post.coverage` from `webapp/src/types/index.ts`.
- Terminal token/signal fields use `TerminalAggregateResponse` and `TerminalCoverage` from `webapp/src/components/token/pro-terminal/types.ts`.
- Token page still mixes `/api/tokens/:tokenAddress`, `/chart`, live-panel data, community data, social signals, and discovery sidebar data. Any new Feed/Terminal/Token display should prefer the shared coverage shape: `state`, `source`, `unavailableReason`.

## Page Map

| Page | Visible fields | Source endpoint | Status | Fallback behavior | Label correctness |
| --- | --- | --- | --- | --- | --- |
| Feed | post author/content/social counts/polls/reposts | `/api/feed/*`, `/api/posts/*` | real | cached first page only for recovery | labels match social counters |
| Feed | token card, AI signal, momentum, smart money, risk, chart | post `signal`, `/api/tokens/:address/terminal?timeframe=1h` | real/partial | unavailable reasons shown for missing signal/candles | fixed overconfident risk and generic signal reasons |
| Feed right rail | market stats, top gainers, raids, calls, communities, AI spotlight, whale rows | `/api/discovery/feed-sidebar` | real/partial | empty states say provider coverage is needed | labels mostly match values |
| Terminal | token identity, market metrics, chart, trades, depth, smart money, execution | `/api/tokens/:tokenAddress/terminal?timeframe=*` | real/partial | `TerminalCoverage` drives unavailable text | labels backed by coverage |
| Token | hero/metrics/holders/traders/chart/community/social signals | `/api/tokens/:tokenAddress`, `/api/tokens/:tokenAddress/chart`, `/community/*`, `/social-signals`, discovery sidebar | real/partial | merges holder/chart/live data; some historical fallback remains | needs continued pass to route every unavailable label through shared coverage |
| Profile | hero, XP, posts/reposts, wallet, performance, profile hub | `/api/me`, `/api/users/:id`, `/posts`, `/reposts`, `/wallet/overview`, `/performance`, `/profile-hub` | real/partial | cached profile/posts; local profile-hub synthesis if endpoint unavailable | fixed AI score fallback so unavailable stays unavailable |
| Community | hero/stats/room/profile/top calls/raids/feed | `/api/tokens/:tokenAddress/community/summary`, `/room`, `/profile`, `/top-calls`, `/raids` | real/partial | empty sections when endpoint returns no rows | labels match community counts |
| Raid room | campaign/submissions/participant state/leaderboard/intelligence | `/api/tokens/:tokenAddress/community/raids/:raidId` | real/partial | unavailable campaign state when missing | intelligence labels need backend coverage if projections are absent |
| Bundle Checker | entity, risk summary, linked wallets, graph, behavior, risk factors, AI insight | `/api/bundle-checker/:identifier` | real/partial | disabled until identifier; unavailable/empty scan states | labels should avoid “clean” unless risk factors explicitly support it |
| Leaderboard | call performance/activity/XP ranks | `/api/leaderboard/performance`, `/api/leaderboard/top-users` | real | session cache for recent responses | rank labels match returned stats; neutral tones are visual only |
| Notifications | notifications, unread count, alert preferences | `/api/notifications`, `/api/notifications/unread-count`, `/api/alerts/preferences` | real | cached notifications during recovery | labels match notification payloads |

## Fixes Applied In This Pass

- Sidebar is fixed, full-height, and independently scrollable with `overflow-y: auto`, `overscroll-contain`, stable scrollbar gutter, and smooth scroll.
- Feed card risk copy no longer says “clean” based only on a low bundle penalty.
- Feed card no longer invents “Fresh signal” or generic neutral conviction when signal reasons are missing.
- Profile hub fallback no longer converts win rate into an AI score or labels unavailable AI scoring as “developing.”

## Remaining Audit Items

- Token page: normalize all chart/live/social/holder fallbacks into the same `coverage` and `unavailableReason` pattern used by Terminal.
- Raid room: add explicit coverage/unavailable reason fields for projected intelligence values if the backend cannot compute them.
- Bundle Checker: verify backend response includes risk-factor reasons whenever a low-risk label is rendered.
- QA after a backend is running: reload Feed, Terminal, Token, Profile, Community, Raid room, Bundle Checker, Leaderboard, and Notifications; refetch each query; inspect empty states, console errors, and network waterfalls.
