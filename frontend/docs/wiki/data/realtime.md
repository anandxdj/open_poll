---
summary: WebSocket hook structure and live analytics event flow.
status: active
last_updated: 2026-10-19
---

# Realtime & WebSockets

## Socket Configuration
- We use the standard Socket.io client.
- **Connection**: Initialize the connection only when entering a realtime domain (e.g., Live Analytics screen). Ensure component unmount completely disconnects the socket.

## Poll Live Sockets
- **Rooms**: Socket rooms join/leave with raw `pollId` strings. This must exactly match the backend `socket.gateway.ts`.
- **Events**: Listen for vote increments and dynamically merge the state into the analytics data structure without causing full page reloads.

## Presentation Deck Live Sockets
- **Protocol**: the versioned one only — `live:join` (with an ack) and `live:event` envelopes
  (`backend/docs/wiki/realtime/envelope.md`). The client no longer emits `quiz:join` or listens to
  `quiz:event` (the backend still dual-emits until W2-D removes it; the client ignores the copy).
  Session semantics: `backend/docs/wiki/modules/presentations-live.md`.
- **Hook**: `features/presentations/live/useLiveSocket.ts` —
  `useLiveSocket(presentationId, auth, handlers?)` (`handlers` = `{ onEvent, onResync,
  onForeignSession, onJoinError }`, or a bare `onEvent` function), used inside a live store provider
  (see [`../features/live-surfaces.md`](../features/live-surfaces.md)). Emits `live:join
  {presentationId, role, accessToken | participantId + participantToken}` on connect and on every
  reconnect, waits for the ack (`{ok: true, role}` / `{ok: false, error}`: `UNAUTHENTICATED`,
  `FORBIDDEN`, `INVALID_PAYLOAD`, `RATE_LIMITED` — retried after 5 s), and sets `connected` in the
  store only once joined. On unmount it emits `live:leave`. Wire names: `LIVE_SOCKET_EVENTS`
  (`types/realtime.ts`).
- **Auth**: `{ role: "host" }` (pulls the JWT access token from `useAuthStore`) or
  `{ role: "participant", participantId, participantToken }` (from the session's stored
  credentials). The server rejects the room join without valid credentials, so pass `undefined` to
  skip joining until a participant has actually joined (before the nickname gate resolves).
- **Event**: envelope `live:event` → `{ v, presentationId, sessionId, seq, type, audience, payload,
  emittedAt }`, typed as `PresentationRealtimeEvent`, per-type payloads in `RealtimePayloads`
  (`types/realtime.ts`, mirror of `backend/src/modules/presentations/live/contract.ts`). Types:
  `session:lobby`, `participant:joined`, `slide:shown`, `question:started`, `slide:closed`,
  `answer:received` (host only), `question:revealed`, `leaderboard:shown`, `session:ended`
  (legacy copies `lobby:opened` and `quiz:ended` are ignored by the reducer).
- **Session scoping**: an envelope whose `sessionId` is not the session the surface follows is
  **ignored** (the reducer records only its `seq`; `onForeignSession` lets the surface check which
  session is live — a participant shows "a new session is live", the host re-reads host state).
- **seq**: one counter per deck across every audience and session (`INCR live:{pid}:seq`).
  `planEnvelope(state, event)` (`live/reducer.ts`): the same `seq` again is dropped; a **lower**
  `seq` (the counter restarted, or out-of-order delivery) triggers a resync for everyone; a **gap**
  triggers a resync for the **host** only — it receives every `all` and `host` event, so a skip is a
  lost event (resyncs are rate limited to one per second). A participant does not treat a gap as
  loss: host-only events and other participants' events use numbers it never sees. Resync always
  runs *before* the event is applied, and the store replays the events that arrive while the REST
  read is in flight on top of its result (`store.resync`), so an old snapshot never wins.
- **Resync**: host → `GET /:id/host/state` (`host/state-loaded`); participant → `GET
  /:id/live-state?participantId&token` (`participant/live-state`). Triggers: every socket
  (re)join (covers the gap between the first REST read and the room join, and every reconnect),
  the tab returning to the foreground, a `seq` reset, and (host) a `seq` gap. A participant whose
  `live-state` answers 404/401 or `PARTICIPANT_STALE`/`PARTICIPANT_KICKED` has lost its identity
  (see the participant flow in the live-surfaces doc).
- **Timer sync**: `question:started`, `slide:shown`, `slide:closed` carry `serverNow`, and so does
  every REST snapshot (`serverNow`). The server-clock offset is **measured per message** from that
  message's own `serverNow` at the moment it arrived (`receivedAt`, passed with the action) and kept
  with the answer window it belongs to (`timing.clockOffsetMs`); `live/clock.ts` +
  `useCountdown(timing, totalSeconds)` turn it into the countdown. Never reuse a `serverNow` read
  earlier (the old bug: the page-load value inflated every countdown by the time since load).
  `endsAt: null` is an untimed window: no timer, open until the host closes or reveals.
- **State recovery**: on refresh/late join the participant's code lookup returns the live slide,
  its `currentSlideId`, phase and timing; `live-state` adds results, standings and whether the
  slide was answered — render immediately, then follow socket events.
- **New lobby / session**: `session:lobby` belongs to a *new* session, so it arrives as a foreign
  envelope for participants of the previous one (they keep their finished screen and are offered
  to join); it no longer wipes anybody's credentials (they are stored per session).
