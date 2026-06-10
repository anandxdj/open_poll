---
summary: Mentimeter-style live quiz competitions — timed questions, speed scoring, leaderboard, Redis-first hot path.
status: active
last_updated: 2026-06-10
---

# Quizzes Module (`src/modules/quizzes/`)

Presenter-paced live quiz competitions (Mentimeter "Quiz competition" slides). The host
drives a slide deck; participants join with a 6-digit code or QR scan and a nickname
(no account), answer timed questions on their phone, and earn points. A cumulative
leaderboard can be shown between questions; final standings show on `end`.

> Roadmap for all upcoming phases: `backend/docs/wiki/quiz-roadmap.md`.

## Models (`quizzes.model.ts`)

- **Quiz** — definition + live session state in one document.
  - `slides[]`: `type` — scored: `select_answer` | `type_answer`; interactive (non-scored,
    Phase 3): `wordcloud` | `open_ended` | `scales` | `ranking`. Common: `question`,
    `timeLimit` (5–300s, default 30). Per type: `options[{text,isCorrect}]` (select),
    `acceptedAnswers[]` (type), `maxEntries` 1–3 (wordcloud), `statements[]` +
    `minLabel`/`maxLabel` + `scaleMax` 2–10 (scales), `items[]` (ranking). Scored only:
    `points` (default 1000), `scoreDependsOnTime` (default true). Flat schema with
    per-type Zod `superRefine`; unused fields default empty.
  - Session: `status` (`draft → lobby → question ⇄ reveal ⇄ leaderboard → ended`),
    `currentSlideIndex` (-1 before first question), `questionStartedAt`, `questionEndsAt`,
    `joinCode` (unique 6-digit string).
- **QuizParticipant** — `{ quizId, name, deviceId, token, score, correctCount }`,
  unique `(quizId, deviceId)` → refresh-safe idempotent join. `token` is a 48-hex-char
  secret returned **only to the joiner** (never broadcast); required on every answer.
- **QuizAnswer** — `{ quizId, participantId, slideIndex, optionIndex|text, isCorrect, score, timeMs }`,
  unique `(quizId, slideIndex, participantId)` — durable backstop against double answers.

## Scoring

Server-clock only (`now - questionStartedAt`); clients never report timing. Wrong = 0.
Correct with `scoreDependsOnTime`: `round(points * (1 - ratio/2))` where
`ratio = elapsed/timeLimit` — fastest ≈ full points, slowest ≈ 50% (Kahoot/Mentimeter style).
Answers rejected after `questionEndsAt` + 750ms grace, and immediately after reveal
(session key is deleted even if the presenter reveals early). Type answers matched
case/whitespace-insensitively against `acceptedAnswers`.

Interactive types (`wordcloud`, `open_ended`, `scales`, `ranking`) are never scored:
score=0, no correct count, leaderboard unchanged. The results hash entry carries
`scored:false` so `/me` renders "response received" instead of correct/wrong.
Payload per type: wordcloud `entries[]` (≤ maxEntries, deduped, one submission),
open_ended `text`, scales `ratings[]` (one per statement, 1..scaleMax), ranking
`ranking[]` (permutation of item indices, Borda-counted: top = n points … last = 1).

## Redis-first hot path (scalability)

`submitAnswer` never reads Mongo on the happy path — it runs on Redis, with Mongo as
async write-behind. Measured on a single instance: **300 concurrent players, 300 answers
in ~273ms (~1100 answers/sec), zero lost updates**.

Key map (all keys TTL ~6h after last transition; wiped on `open-lobby`):

| Key | Type | Purpose |
|---|---|---|
| `quiz:{id}:session` | STRING (JSON) | Live question snapshot (timing, answer key, points). Set on question start, **deleted on reveal** → instantly stops accepting answers. |
| `quiz:{id}:scores` | ZSET | participantId → cumulative score. `ZINCRBY` per answer; leaderboard = `ZRANGE REV`; rank = `ZCOUNT (score +inf` + 1. |
| `quiz:{id}:correct` | HASH | participantId → correct-answer count. |
| `quiz:{id}:names` | HASH | participantId → nickname (leaderboard display, participant count via `HLEN`). |
| `quiz:{id}:tokens` | HASH | participantId → secret token (answer auth without Mongo). |
| `quiz:{id}:answered:{slide}` | SET | `SADD` = atomic dedup (returns 0 on double answer); `SCARD` = live answered count. |
| `quiz:{id}:dist:{slide}` | HASH | optionIndex/normalized text → count; scales: `s{i}:sum`+`s{i}:count`; ranking: itemIndex → Borda points + `voters`. Reveal builds the distribution from this. |
| `quiz:{id}:disp:{slide}` | HASH | normalized text → first-seen original casing (wordcloud / open_ended display). |
| `quiz:{id}:results:{slide}` | HASH | participantId → `{isCorrect, score}` for the reveal-time "your result" stampede. |

Answer flow: `GET session` → token check (`HGET tokens`) → `SADD answered` (dedup) →
grade + score → `ZINCRBY/HINCRBY/HSET` in parallel → publish `answer:received` →
fire-and-forget `QuizAnswerModel.create` + participant `$inc` to Mongo.

Resilience: every Redis read has a Mongo fallback that re-hydrates the cache (server or
Redis restart mid-quiz degrades, doesn't break). Multi-instance safe: all state lives in
Redis/Mongo; events fan out via the existing Redis pub/sub → Socket.io bridge.

## Security

- **Participant token auth** — answering and `/me` require the join-time secret; knowing
  another player's `participantId` (broadcast in events) is useless for spoofing.
- **Rate limiting** — Redis fixed-window per-IP limiter (`common/middlewares/rateLimit.middleware.ts`),
  multi-instance safe, fails open if Redis is down. Limits sized for classroom NAT:
  code lookup 60/min, join 500/5min, answer 2000/min, me 600/min. Auth routes also
  limited (login 10/5min, register 10/15min, forgot/resend 5/15min).
- Correct answers never leave the server before reveal (sanitized slide payloads).
- Socket.io CORS locked to `FRONTEND_URL`. Mongoose `CastError` mapped to 400.

## Routes (`/api/quizzes`)

Public (participants):
- `GET /code/:code` — resolve join code (includes live slide for late joiners; 404 while draft)
- `POST /:id/join` — `{ name, deviceId }` → `{ participantId, token }` (idempotent per device)
- `POST /:id/answer` — `{ participantId, participantToken, slideIndex, optionIndex|text|entries[]|ratings[]|ranking[] }`
- `GET /:id/me?participantId=&token=` — score/rank; `lastAnswer` only after reveal

Creator (JWT):
- `POST /`, `GET /`, `GET /:id`, `PATCH /:id` (draft/ended only), `DELETE /:id`
- Host controls: `GET /:id/host/state`, `POST /:id/host/open-lobby` (wipes previous run),
  `/next-question`, `/reveal`, `/leaderboard`, `/end`
- AI: `POST /api/ai/generate-quiz` (JWT + 20/5min limit) — `{ topic, slideCount, slideTypes[], tone }`
  → `{ title, slides[] }` validated against the create contract (mock fallback without Gemini key).

## Realtime

Every state change publishes to Redis channel `quiz:event`; socket subscriber re-emits to
room `quiz_{quizId}`. See `realtime/socket-events.md` for the full event contract.

## Frontend

`frontend/features/quizzes/` (types, api, hooks, components, slideTypeMeta) + pages:
- `/polls` — unified dashboard with a Polls/Quizzes switcher (quiz stats + cards)
- `/quizzes` — creator quiz list; sidebar "Create Quiz" opens a title modal (manual / AI)
- `/quiz/create` — slide builder (`?id=` edit, `?name=&mode=ai|manual` from the modal);
  Mentimeter-style "New slide" type picker + per-type editors; `AiQuizModal` fills slides
- `/quiz/host/[id]` — fullscreen presenter (lobby with join code + **QR deep link** to
  `/quiz/play/{joinCode}`, timer, reveal charts, leaderboard)
- `/quiz/join` + `/quiz/play/[code]` — participant flow (fullscreen, no app shell);
  participant `{id, name, token}` persists in localStorage per quiz
