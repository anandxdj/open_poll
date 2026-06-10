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
- `quiz:join` with `quizId` to subscribe to room `quiz_{quizId}` (host + participants).
- `quiz:leave` with `quizId` to unsubscribe.

Server event:
- `quiz:event` emitted to room `quiz_{quizId}`. Envelope: `{ quizId, type, payload, emittedAt }`.

`type` values and payloads:
- `lobby:opened` — `{ joinCode }`
- `participant:joined` — `{ participantId, name, participantCount }`
- `question:started` — `{ slide (sanitized, no answer keys), startedAt, endsAt, serverNow }`
- `answer:received` — `{ slideIndex, answeredCount }`
- `question:revealed` — `{ slideIndex, question, distribution, answeredCount, participantCount, isLastSlide }`
- `leaderboard:shown` — `{ leaderboard[], participantCount, isLastSlide }`
- `quiz:ended` — `{ leaderboard[], participantCount }`

Backend publishes on Redis channel `quiz:event`; the socket subscriber re-emits to the room
(same horizontal-scaling pattern as `analytics:update`). Constants live in
`src/common/realtime/events.ts`.
