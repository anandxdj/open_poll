---
summary: Redis pub/sub channels and keys used by the realtime layer.
status: active
last_updated: 2026-10-19
---

# Redis Channels

Every instance runs one subscriber (`common/realtime/socket.ts`) and delivers each message to its
own sockets with `io.local`.

| Channel | Publisher | Message | Delivered as |
| --- | --- | --- | --- |
| `live:event` | `publishLiveEvent` (`common/realtime/publish.ts`), via `publishPresentationEvent` | live envelope v1 ([`envelope.md`](./envelope.md)) | `live:event` to `live:*` rooms + legacy `quiz:event` to `quiz_*` rooms ([`presentations.md`](./presentations.md)) |
| `analytics:update` | `publishPollAnalytics`, from `responses/analytics.worker.ts` | `{ pollId, analytics }` | `analytics:update` to `poll_{pollId}` ([`polls.md`](./polls.md)) |

The `quiz:event` **channel** is gone: deck events are published once, on `live:event`. The
`quiz:event` **socket event** still exists as the legacy copy.

Keys: `live:{presentationId}:seq` — the envelope `seq` counter, incremented in the same Lua script
that publishes, 7-day sliding TTL. Q&A and reaction coalescing keys (`qna:{<sid>}:*`,
`reactions:{<sid>}:*`, 6 h TTL): [`../modules/qna.md`](../modules/qna.md#redis-keys).

With `SOCKET_REDIS_ADAPTER=on` the Socket.io adapter adds its own pub/sub channels
(`socket.io#/#…`, prefix = the adapter `key`) on two extra connections per instance. They carry room
operations only; live events still use `live:event`.

Live answer keys (`psess:{sid}:dirty`, `:dirty:slides`, `:rate:{participantId}`, the global
`live:autoreveal` ZSET) are listed in [`../modules/presentations-live.md`](../modules/presentations-live.md#redis-keys).

Poll analytics path:
1. Responses service writes buffered counters to Redis keys, adds the question id to the poll's
   `buffer:poll:{pollId}:questions` SET (so the worker never scans keys) and the poll id to `buffer:active_polls`.
2. The 2-second analytics worker applies one Mongo `bulkWrite` to the analytics doc and clears the buffer keys.
3. The worker deletes the analytics cache and publishes `{ pollId, analytics }` on `analytics:update`.
4. Each instance's subscriber emits `analytics:update` to its sockets in `poll_{pollId}`.
