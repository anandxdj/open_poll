---
summary: Socket.io room strategy and event contract for live analytics.
status: active
last_updated: 2026-05-11
---

# Socket Events

Client events:
- `poll:join` with `pollId` to subscribe creator dashboard to room `poll_{pollId}`.
- `poll:leave` with `pollId` to unsubscribe from room `poll_{pollId}`.

Server events:
- `analytics:update` emitted to room `poll_{pollId}`.

`analytics:update` payload includes:
- `pollId`
- `totalResponses`
- `questionSummaries[]` with per-option counts
- `emittedAt`
