---
summary: Workspace insights (W3-G): GET /api/insights, activity over a date range for the analytics page.
status: active
last_updated: 2026-10-26
---

# Insights (`src/modules/insights/`)

Workspace activity over a date range, for the frontend's `/analytics` overview.
Read-only aggregation over sessions and poll responses; nothing is stored.

## Route

`GET /api/insights?from&to&tz`: `authenticate()` → `workspaceContext()` → per-user
rate limit (60/min) → `assertCan(ctx, 'session:read')` (every member role).

| Query | Rule |
| --- | --- |
| `from`, `to` | ISO datetimes. `to` defaults to now, `from` to 30 days before `to`; `from < to`, at most 366 days apart. |
| `tz` | IANA time zone days are counted in (default `UTC`). |

Bad input is a 400 with the Zod messages (`from must be before to`, `Ranges are at most 366 days`,
`tz must be an IANA time zone`).

## Response (`insights.contract.ts`)

- `range`: `{from, to, days, tz}` as resolved.
- `totals` and `previous` (the period of equal length just before `from`): `sessions` (live
  sessions started in the range), `participants` (summed per session), `sessionAnswers`,
  `pollResponses`, `responses` (the two together), `engagement` (answers ÷ participants × response
  slides, over ended sessions only, from `slideStats`; null without any), `decksRun` (distinct decks).
- `daily`: every day of the range in `tz` (`YYYY-MM-DD`, zeros included): `sessions`,
  `participants`, `responses` (session answers + poll responses).
- `top`: up to 6 items, decks by participants (summed over runs, with `runs`) and polls by
  responses (`runs: null`), together, most first. Deleted decks and runs nobody joined drop out.
- `recentSessions`: the 6 latest sessions in the range with deck title, run number, status,
  participants, answers and `participationRate` (null while live).
- `liveNow`: `{sessions, polls}` running right now, whatever the range.

## Scope

Like the library (`library.query.ts` `scopeFilter`): the workspace's sessions (`workspaceId`, index
`{workspaceId, startedAt}`) and polls; in a personal workspace also the owner's pre-workspace items
(sessions with `workspaceId: null` hosted by them). Poll responses are matched by the scoped poll ids
and `createdAt`.

## Tests

`tests/integration/insights.test.ts` (seeded sessions and raw responses: totals, previous period,
daily series, top list, recent sessions, time zone, default range, workspace isolation, validation, 401).
The route-table tenancy test covers the route (it runs `workspaceContext()`).
