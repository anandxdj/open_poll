---
summary: Realtime core — socket module registry, handshake auth, live event envelope, seq, audiences, rooms and delivery.
status: active
last_updated: 2026-10-19
---

# Realtime core

Code: `backend/src/common/realtime/`. Per-module contracts: [`presentations.md`](./presentations.md),
[`polls.md`](./polls.md). Redis channels: [`redis-channels.md`](./redis-channels.md).

## Layout

| File | Role |
| --- | --- |
| `socket.ts` | `setupSocketAndPubSub(io, { redisAdapter? })`: attaches the optional cluster adapter, counts connections for metrics, installs handshake auth, attaches every registered module, opens one Redis subscriber per instance (`redisClient.duplicate()`) and routes each channel to its handlers. Returns `{ close }`. |
| `adapter.ts` | `attachRedisAdapter(io, { enabled?, key? })`: `@socket.io/redis-adapter` on two duplicated clients when `SOCKET_REDIS_ADAPTER=on`. |
| `registry.ts` | `registerSocketModule({ name, onConnection?, channels? })`, `getSocketModules()`. Names are unique (a second registration throws). |
| `modules.ts` | Append-only list of side-effect imports, one line per module, alphabetical. |
| `auth.ts` | `socketAuth` (`io.use`), `getSocketUser`, `resolveSocketUserId`, `userFromAccessToken`. |
| `rooms.ts` | Room names, audience → room mapping, `leavePresentationRooms`, the per-connection join budget. |
| `publish.ts` | `publishLiveEvent`, `publishPollAnalytics`, and the subscriber side `deliverLiveEvent`. |
| `events/index.ts` | `REALTIME_CHANNELS`, `SOCKET_EVENTS`, `LIVE_EVENTS` (append-only, one spread per module). |
| `events/envelope.ts` | `LiveEventEnvelope`, `LiveAudience`, `LiveEventDefinition`, `defineLiveEvents`. |
| `events/<module>.ts` | A module's event types with their default audience, and its socket event names. |
| `polls.socket.ts` | Poll analytics module. |

Feature modules keep their socket handlers next to their service
(`modules/presentations/presentations.socket.ts`) and register them through `modules.ts`.

## Handshake auth

`socketAuth` reads an optional access token from `handshake.auth.token` (`"Bearer <jwt>"` or the
bare JWT) into `socket.data.user = { id, email?, name?, role?, expiresAt }`. No token, or an
invalid one, connects the socket with `user: null` — participants never need an account, and a
stale token must not lock anyone out of a deck. `getSocketUser(socket)` returns null once the
token's `exp` has passed; refresh the token and reconnect (socket.io-client re-reads `auth` on
reconnect when it is a function). `resolveSocketUserId(socket, accessToken?)` prefers a token sent
with the event (it must be valid on its own) and otherwise uses the handshake identity.

Joins share a per-connection budget of 30 per minute across every module (`allowJoin`).

## Envelope (v1)

```ts
{
  v: 1,
  presentationId: string,
  sessionId: string | null,   // null for events published outside a session
  seq: number,                // INCR live:{presentationId}:seq
  type: string,               // e.g. 'question:started'
  payload: Record<string, unknown>,
  audience: 'all' | 'host' | `participant:${participantId}`,
  emittedAt: string,          // ISO time at publish
  quizId: string,             // = presentationId, for clients of the legacy protocol
}
```

Publish with `publishLiveEvent({ presentationId, type, payload, audience?, sessionId? })`. It
resolves to the envelope it sent, or null after logging a failure — it never throws, like the
fire-and-forget publishes it replaced. A malformed `participant:` audience is refused without
publishing.

### seq

One Lua script runs `INCR live:{pid}:seq`, refreshes a 7-day TTL and `PUBLISH`es the envelope with
that seq spliced in, so concurrent publishers for one deck reach subscribers in seq order. seq is
per presentation and spans sessions; it restarts at 1 only after a week without events — a client
seeing a lower seq than its last one should resync.

seq is one counter for every audience: a participant does not see host-only or other participants'
events, so gaps are normal and do not on their own mean an event was lost. Use seq to order and
de-duplicate; recover state with a resync on reconnect.

### Audiences

`LIVE_EVENTS` gives each type a default audience. Types defined `hostOnly` (today
`answer:received`) are forced to `host` by `publishLiveEvent` and again by `deliverLiveEvent`, so no
publisher can send them to participant rooms.

| Audience | `live:event` room | Legacy `quiz:event` room |
| --- | --- | --- |
| `all` | `live:{pid}` | `quiz_{pid}` |
| `host` | `live:{pid}:host` | `quiz_{pid}_host` |
| `participant:<id>` | `live:{pid}:p:{id}` | none |

## Delivery

Every instance subscribes to `live:event`; `deliverLiveEvent` parses and validates the envelope and
emits with **`io.local.to(room)`** — never `io.to`, which would re-broadcast through a cluster
adapter and duplicate events (`tests/integration/multiInstance.test.ts` fails if any handler uses `io.to`). It emits `live:event` to the audience's `live:*` room and the same
envelope as `quiz:event` to the matching `quiz_*` room. A socket that joined through `quiz:join`
sits in both kinds of room and receives each event once per event name.

Malformed messages (bad JSON, `v !== 1`, missing `presentationId`/`type`/`audience`/`seq`, bad
participant audience) are logged and dropped. A throwing channel handler is logged and does not
stop the other handlers.

## Cluster adapter

`SOCKET_REDIS_ADAPTER=on` (default off) links the Socket.io servers of several instances through Redis
(`adapter.ts`): rooms and `io.in(room).fetchSockets()` / `disconnectSockets()` / `socketsJoin()` then
span instances (remote sockets come back as `RemoteSocket`). It is **not** what delivers live events:
those travel over the `live:event` subscriber and `io.local`, with or without the adapter, so enabling
it never duplicates or drops an event. Pub/sub ignores the Redis DB index; give each deployment that
shares a Redis server its own adapter `key` (`RedisAdapterOptions`). Operations:
[`docs/deploy/multi-instance.md`](../../../docs/deploy/multi-instance.md).

## Adding to the realtime layer

- **New event types**: add them to the module's `events/<module>.ts` with `defineLiveEvents`, prefixed
  by module (`slide:`, `session:`, `qna:`, `reaction:`, `remote:`, `presence:`). A new module adds
  one spread line to `LIVE_EVENTS` and one `export *` in `events/index.ts`.
- **New client events or channels**: call `registerSocketModule` in the module's `*.socket.ts` and
  add one import line to `modules.ts`. Channel handlers deliver with `io.local`.
- Document the module's events, rooms and audiences in `realtime/<module>.md`.

## Tests

- Unit: `backend/tests/realtime.{publish,deliver,auth,rooms,modules}.test.ts`.
- Integration: `backend/tests/realtime.integration.test.ts` — real Redis and Mongo, two Socket.io
  servers sharing one Redis, legacy and new joins. Skipped unless `TEST_REDIS_URL` and
  `TEST_MONGO_URI` are set; the file header has the run command.
  `backend/tests/integration/multiInstance.test.ts` — two full instances, adapter on and off:
  every event exactly once on every socket, one coalesced host update.
