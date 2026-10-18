---
summary: Live presentation decks (Mentimeter-style) — scored and interactive slides, join codes, speed scoring, leaderboard, Redis-first hot path.
status: active
last_updated: 2026-10-18
---

# Presentations Module (`src/modules/presentations/`)

`modules/presentations` runs presenter-paced live decks. The host drives a slide deck;
participants join with a 6-digit code or QR scan and a nickname (no account), answer
timed slides on their phone, and earn points on scored slides. Leaderboard slides show
standings mid-deck; final standings show on `end`.

This is the only live-deck module. It replaced `modules/quizzes`, which was unmounted in
`5e63f87` and deleted afterwards; the "quiz" names that survive (`/api/quizzes`,
`quiz:*` socket events, `POST /api/ai/generate-quiz`) are wire compatibility, not a
second entity. Graded polls ("assessments", `pollType: 'TRIAL'`) are a different
feature in `modules/polls` — see `modules/polls.md`.

> Roadmap for upcoming phases: `backend/docs/wiki/quiz-roadmap.md`.

## Models (`presentations.model.ts`)

- **Presentation** — definition + live session state in one document.
  - `slides[]`: `type` — scored: `select_answer` | `type_answer`; interactive (never
    scored): `wordcloud` | `open_ended` | `scales` | `ranking`; plus `leaderboard`
    (no question, no timer, shows standings). Common: `question`, `timeLimit` (5–300s,
    default 30). Per type: `options[{text,isCorrect}]` (select, 2–8, at least one
    correct), `acceptedAnswers[]` (type), `maxEntries` 1–3 (wordcloud), `statements[]` +
    `minLabel`/`maxLabel` + `scaleMax` 2–10 (scales), `items[]` 2–10 (ranking). Scored
    only: `points` (default 1000), `scoreDependsOnTime` (default true). Flat schema with
    per-type Zod `superRefine` (`presentationSlideSchema`); unused fields default empty.
  - Session: `status` `draft → lobby → active → ended`. While `active`, whether the
    current slide is still answering or already revealed is derived from the clock on
    the client, not stored. `currentSlideIndex` (-1 before the first slide),
    `questionStartedAt`, `questionEndsAt`, `joinCode` (unique 6-digit string).
- **PresentationParticipant** — `{ presentationId, name, deviceId, token, score, correctCount }`,
  unique `(presentationId, deviceId)` → refresh-safe idempotent join. `deviceId` comes
  from a server-signed device token, so clients cannot mint identities. `token` is a
  48-hex-char secret returned **only to the joiner** (never broadcast); required on every
  answer and on the socket room join.
- **PresentationAnswer** — `{ presentationId, participantId, slideIndex, optionIndex|text|payload, isCorrect, score, timeMs }`,
  unique `(presentationId, slideIndex, participantId)` — durable backstop against double answers.

## Session flow

- `open-lobby` wipes the previous run (participants, answers, Redis keys) and sets
  `lobby`. Participants holding credentials from the old run must rejoin.
- `advance` moves **forward only** while `active`; going backwards is rejected. A
  leaderboard slide emits `leaderboard:shown` and has no timer.
- `reveal` closes the answer window (deletes the session key) and broadcasts the
  distribution. The host view calls it automatically when its countdown hits 0.
- `end` sets `ended`; Redis state is kept readable for final screens, then expires.

## Scoring

Server-clock only (`now - questionStartedAt`); clients never report timing. Wrong = 0.
Correct with `scoreDependsOnTime`: `round(points * (1 - ratio/2))` where
`ratio = elapsed/timeLimit` — fastest ≈ full points, slowest ≈ 50% (Kahoot/Mentimeter style).
Answers rejected after `questionEndsAt` + 750ms grace, and immediately after reveal.
Type answers matched case/whitespace-insensitively against `acceptedAnswers`.

Interactive types are never scored: score=0, no correct count, leaderboard unchanged.
The results hash entry carries `scored:false` so `/me` renders "response received".
Payload per type: wordcloud `entries[]` (≤ maxEntries, deduped, one submission),
open_ended `text`, scales `ratings[]` (one per statement, 1..scaleMax), ranking
`ranking[]` (permutation of item indices, Borda-counted: top = n points … last = 1).

## Redis-first hot path

`submitAnswer` never reads Mongo on the happy path; Mongo is async write-behind.

Key map (TTL ~6h after the last transition; wiped on `open-lobby`):

| Key | Type | Purpose |
|---|---|---|
| `presentation:{id}:session` | STRING (JSON) | Live slide snapshot (timing, answer key, points). Set on advance, **deleted on reveal** → stops accepting answers. |
| `presentation:{id}:scores` | ZSET | participantId → cumulative score; leaderboard = `ZRANGE REV`. |
| `presentation:{id}:correct` | HASH | participantId → correct-answer count. |
| `presentation:{id}:names` | HASH | participantId → nickname (also participant count via `HLEN`). |
| `presentation:{id}:tokens` | HASH | participantId → secret token (answer auth without Mongo). |
| `presentation:{id}:answered:{slide}` | SET | `SADD` = atomic dedup; `SCARD` = live answered count. |
| `presentation:{id}:dist:{slide}` | HASH | optionIndex/normalized text → count; scales `s{i}:sum`/`s{i}:count`; ranking itemIndex → Borda points + `voters`. |
| `presentation:{id}:disp:{slide}` | HASH | normalized text → first-seen original casing (wordcloud / open_ended). |
| `presentation:{id}:results:{slide}` | HASH | participantId → `{isCorrect, score, scored}` for `/me`. |
| `buffer:active_presentation_distributions` | SET | decks with fresh answers, drained by the live distribution worker. |

Answer flow: `GET session` → token check → `SADD answered` (dedup) → grade + score →
one `MULTI` for score/correct/dist/results → `SADD` the buffer set → publish a light
`answer:received` (counts only) → fire-and-forget Mongo writes.

`liveDistribution.worker.ts` drains the buffer set every 2s and publishes
`answer:received` with the full distribution (`computeSlideDistributionHelper`) to the
host-only room, so the host chart updates without a per-answer recompute.

Resilience: Redis reads fall back to Mongo and re-hydrate (restart mid-session degrades,
doesn't break). Multi-instance safe: state lives in Redis/Mongo; events fan out over
Redis pub/sub → Socket.io.

## Security

- **Participant token auth** — answering, `/me` and the socket room join require the
  join-time secret; a broadcast `participantId` is useless for spoofing.
- **Host socket auth** — `quiz:join` as host requires a JWT whose user owns the deck.
- **Rate limiting** (per-IP, sized for classroom NAT): code lookup 60/min plus a global
  5000/min cap against code enumeration, join 500/5min, answer 2000/min, me 600/min.
- Answer keys never leave the server before reveal (`sanitizeSlide`), and the
  pre-reveal live distribution only reaches the host-only room.

## Routes (`/api/presentations`)

Also mounted at `/api/quizzes` as a legacy alias (same router, same collection).

Public (participants):
- `GET /code/:code` — resolve join code (includes the live slide + timing for late joiners; 404 while draft)
- `POST /:id/join` — `{ name, deviceToken? }` → `{ participantId, name, score, token, deviceToken }`
- `POST /:id/answer` — `{ participantId, participantToken, slideIndex, optionIndex|text|entries[]|ratings[]|ranking[] }`
- `GET /:id/me?participantId=&token=` — score/rank; `lastAnswer` only after reveal

Creator (JWT):
- `POST /`, `GET /`, `GET /:id`, `PATCH /:id` (draft/ended only), `DELETE /:id`
- Host controls: `GET /:id/host/state`, `POST /:id/host/open-lobby`, `POST /:id/host/advance`
  (`{ slideIndex? }`), `POST /:id/host/reveal`, `POST /:id/host/end`
- AI drafts: `POST /api/ai/generate-quiz` — `{ topic, slideCount, slideTypes[], tone }` →
  `{ title, slides[] }`, every slide validated against `presentationSlideSchema` (see `modules/ai.md`).

## Realtime

Every state change publishes to Redis channel `quiz:event`; the socket subscriber
re-emits to room `quiz_{presentationId}` (and `answer:received` only to
`quiz_{presentationId}_host`). See `realtime/socket-events.md` for the event contract.

## Frontend

`frontend/features/presentations/` (types, api, hooks, components, slideTypeMeta):
- `/polls` — dashboard "Decks" tab (`PresentationCard`); sidebar "Create Deck" opens
  `CreatePresentationModal` (title → manual or AI)
- `/presentation/create` — `PresentationBuilder` (`?id=` edit, `?name=&mode=ai|manual`)
- `/presentation/host/[id]` — `HostView`: lobby with join code + QR to `/live/{joinCode}`,
  timer, live/reveal charts, leaderboard
- `/live` + `/live/[code]` — participant join + `PlayView` (no app shell)

Old `/quiz/*` and `/quizzes` URLs redirect to these (`frontend/next.config.ts`).
