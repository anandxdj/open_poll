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
- **Hook**: `features/presentations/live/useLiveSocket.ts` —
  `useLiveSocket(presentationId, auth, onEvent?)`, used inside a live store provider (see
  [`../features/live-surfaces.md`](../features/live-surfaces.md)). Emits `quiz:join`/`quiz:leave`
  with `quizId: presentationId` (backend room `quiz_{id}`), re-joins on reconnect, filters by id,
  dispatches each event into the live store (`live/event`) and then calls `onEvent` for side
  effects; connection status lands in the store as `connected`. Wire names live in
  `LIVE_SOCKET_EVENTS` (`types/realtime.ts`). The `quiz:*` names are the wire protocol left over
  from the quiz era; the versioned `live:join`/`live:event` protocol exists server-side and the
  client moves to it with the session engine (W1-A2).
- **Auth**: `{ role: "host" }` (pulls the JWT access token from `useAuthStore`) or
  `{ role: "participant", participantId, participantToken }`. The server rejects the room join
  without valid credentials, so pass `undefined` to skip joining until a participant has
  actually joined (e.g. before the nickname gate resolves).
- **Event**: envelope `quiz:event` → `{ quizId, type, payload, emittedAt }` plus the v1 fields
  (`v`, `seq`, `sessionId`, `audience`) — typed as `PresentationRealtimeEvent`, with per-type
  payloads in `RealtimePayloads` (`types/realtime.ts`).
  Types: `lobby:opened`, `participant:joined`, `question:started`, `answer:received`,
  `question:revealed`, `leaderboard:shown`, `quiz:ended` (contract:
  `backend/docs/wiki/realtime/presentations.md`).
- **Timer sync**: `question:started` carries `endsAt` + `serverNow`; `live/useCountdown.ts`
  computes a server-clock offset so client clock skew can't shift deadlines. Pass the
  `serverNow` that arrived *with* that `endsAt` — reusing the page-load value inflates every
  later countdown by the time since load.
- **State recovery**: on refresh/late join, `GET /presentations/code/:code` returns the live
  slide + timing — render immediately (initialising that slide's inputs), then follow socket
  events.
- **Lobby re-open**: `lobby:opened` means the host restarted the session and the server wiped
  every participant, so the participant view drops its stored credentials (keeping the device
  token) and shows the nickname gate again.