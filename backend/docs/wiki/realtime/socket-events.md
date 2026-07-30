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

## Quiz events (live quiz competitions)

Client events:
- `quiz:join` with `{ quizId, role, ... }` to subscribe to room `quiz_{quizId}` (host + participants).
  The server verifies the caller before joining the room — unauthenticated/unauthorized joins are
  silently dropped (no ack, no error event):
  - `role: "host"` — requires `accessToken` (JWT access token); verified against the quiz/presentation's `creatorId`.
  - `role: "participant"` — requires `participantId` + `participantToken` (issued by `POST /:id/join`).
- `quiz:leave` with `quizId` to unsubscribe.

Server event:
- `quiz:event` emitted to room `quiz_{quizId}` (all roles). Envelope: `{ quizId, type, payload, emittedAt }`.
- Hosts additionally join `quiz_{quizId}_host` on connect. `answer:received` — which carries the
  live vote/word distribution before reveal — is routed to `quiz_{quizId}_host` only, never to
  `quiz_{quizId}`, so participants can't see results before the host reveals them.

`type` values and payloads:
- `lobby:opened` — `{ joinCode }`
- `participant:joined` — `{ participantId, name, participantCount }`
- `question:started` — `{ slide (sanitized, no answer keys), startedAt, endsAt, serverNow }`
- `answer:received` (host-only room) — `{ slideIndex, answeredCount, participantCount, distribution }`
- `question:revealed` — `{ slideIndex, question, type, scored, distribution, answeredCount, participantCount, isLastSlide }`
  — `distribution.kind`: `options` (select) | `text` (type) | `words` (wordcloud) |
  `responses` (open_ended) | `scales` (per-statement averages) | `ranking` (Borda items + voters)
- `leaderboard:shown` — `{ leaderboard[], participantCount, isLastSlide }`
- `quiz:ended` — `{ leaderboard[], participantCount }`

Backend publishes on Redis channel `quiz:event`; the socket subscriber re-emits to the room
(same horizontal-scaling pattern as `analytics:update`). Constants live in
`src/common/realtime/events.ts`.
