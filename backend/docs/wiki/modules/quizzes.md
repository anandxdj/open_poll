---
summary: Mentimeter-style live quiz competitions — timed questions, speed scoring, leaderboard.
status: active
last_updated: 2026-06-10
---

# Quizzes Module (`src/modules/quizzes/`)

Presenter-paced live quiz competitions (Mentimeter "Quiz competition" slides). The host
drives a slide deck; participants join with a 6-digit code and a nickname (no account),
answer timed questions on their phone, and earn points. A cumulative leaderboard can be
shown between questions; the final standings show on `end`.

## Models (`quizzes.model.ts`)

- **Quiz** — definition + live session state in one document.
  - `slides[]`: `type` (`select_answer` | `type_answer`), `question`, `options[{text,isCorrect}]`,
    `acceptedAnswers[]`, `timeLimit` (5–300s, default 30), `points` (default 1000),
    `scoreDependsOnTime` (default true).
  - Session: `status` (`draft → lobby → question ⇄ reveal ⇄ leaderboard → ended`),
    `currentSlideIndex` (-1 before first question), `questionStartedAt`, `questionEndsAt`,
    `joinCode` (unique 6-digit string).
- **QuizParticipant** — `{ quizId, name, deviceId, score, correctCount }`,
  unique `(quizId, deviceId)` → refresh-safe idempotent join.
- **QuizAnswer** — `{ quizId, participantId, slideIndex, optionIndex|text, isCorrect, score, timeMs }`,
  unique `(quizId, slideIndex, participantId)` → hard double-answer guard.

## Scoring

Server-clock only (`now - questionStartedAt`); clients never report timing. Wrong = 0.
Correct with `scoreDependsOnTime`: `round(points * (1 - ratio/2))` where
`ratio = elapsed/timeLimit` — fastest ≈ full points, slowest ≈ 50% (Kahoot/Mentimeter style).
Answers rejected after `questionEndsAt` + 750ms grace. Type answers are matched
case/whitespace-insensitively against `acceptedAnswers`.

## Routes (`/api/quizzes`)

Public (participants):
- `GET /code/:code` — resolve join code (includes live slide for late joiners; 404 while draft)
- `POST /:id/join` — `{ name, deviceId }` → `{ participantId }` (idempotent per device)
- `POST /:id/answer` — `{ participantId, slideIndex, optionIndex|text }` (no correctness leak in response)
- `GET /:id/participants/:participantId` — score/rank; `lastAnswer` only exposed after reveal

Creator (JWT):
- `POST /`, `GET /`, `GET /:id`, `PATCH /:id` (draft/ended only), `DELETE /:id`
- Host controls: `GET /:id/host/state`, `POST /:id/host/open-lobby` (wipes previous run),
  `/next-question`, `/reveal`, `/leaderboard`, `/end`

## Realtime

Every state change publishes to Redis channel `quiz:event`; socket subscriber re-emits to
room `quiz_{quizId}`. See `realtime/socket-events.md` for the event contract.

## Frontend

`frontend/features/quizzes/` (types, api, hooks, components) + pages:
- `/quizzes` — creator dashboard list
- `/quiz/create` — slide builder (`?id=` for edit)
- `/quiz/host/[id]` — fullscreen presenter (lobby code, timer, reveal charts, leaderboard)
- `/quiz/join` + `/quiz/play/[code]` — participant flow (fullscreen, no app shell)
