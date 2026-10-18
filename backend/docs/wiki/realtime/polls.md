---
summary: Poll analytics socket contract — poll room join/leave and the analytics:update event.
status: active
last_updated: 2026-10-19
---

# Polls realtime

Handlers: `backend/src/common/realtime/polls.socket.ts`. Types:
`backend/src/common/realtime/events/poll.ts`. Polls keep their own channel and event; they do not
use the live envelope ([`envelope.md`](./envelope.md)).

## Client → server

- `poll:join` with `pollId` — joins room `poll_{pollId}`. Only **published** polls can be observed;
  invalid ids, unpublished polls and joins over the 30-per-minute per-connection budget are
  silently dropped.
- `poll:leave` with `pollId` — leaves `poll_{pollId}`.

## Server → client

`analytics:update` to room `poll_{pollId}`:

```ts
{
  pollId: string,
  totalResponses: number,
  questionSummaries: Array<{ questionId: string, counts: number[] }>,
  emittedAt: string,
}
```

## Publishing

`responses/analytics.worker.ts` flushes buffered counters every 2s, then calls
`publishPollAnalytics({ pollId, analytics })` (`common/realtime/publish.ts`), which publishes on
Redis channel `analytics:update`. Every instance's subscriber emits the `analytics` object to its
own sockets in `poll_{pollId}` with `io.local`.
