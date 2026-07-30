---
summary: WebSocket hook structure and live analytics event flow.
status: active
last_updated: 2026-05-13
---

# Realtime & WebSockets

## Socket Configuration
- We use the standard Socket.io client.
- **Connection**: Initialize the connection only when entering a realtime domain (e.g., Live Analytics screen). Ensure component unmount completely disconnects the socket.

## Poll Live Sockets
- **Rooms**: Socket rooms join/leave with raw `pollId` strings. This must exactly match the backend `socket.gateway.ts`.
- **Events**: Listen for vote increments and dynamically merge the state into the analytics data structure without causing full page reloads.

## Quiz Live Sockets
- **Hook**: `features/quizzes/hooks/useQuizSocket.ts` — emits `quiz:join`/`quiz:leave` with
  `quizId` (backend room `quiz_{quizId}`), re-joins on reconnect, filters by quizId.
- **Auth**: the hook takes a required third `auth` param — `{ role: "host" }` (pulls the JWT
  access token from `useAuthStore`) or `{ role: "participant", participantId, participantToken }`.
  The server rejects the room join without valid credentials, so pass `auth={undefined}` to skip
  joining until a participant has actually joined (e.g. before the nickname gate resolves).
- **Event**: single envelope `quiz:event` → `{ quizId, type, payload, emittedAt }`.
  Types: `lobby:opened`, `participant:joined`, `question:started`, `answer:received`,
  `question:revealed`, `leaderboard:shown`, `quiz:ended` (contract:
  `backend/docs/wiki/realtime/socket-events.md`).
- **Timer sync**: `question:started` carries `endsAt` + `serverNow`; `useCountdown`
  computes a server-clock offset so client clock skew can't shift deadlines.
- **State recovery**: on refresh/late join, `GET /quizzes/code/:code` returns the live
  slide + timing — render immediately, then follow socket events.