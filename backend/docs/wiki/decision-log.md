---
summary: Concise architecture and implementation decisions by phase.
status: active
last_updated: 2026-10-18
---

# Decision Log

## 2026-10-18 (quizzes → presentations, gradeable assessments)
- Deleted the unmounted `quizzes` backend module; `presentations` is the only live-deck module. The `quiz:*` socket names, `quiz_{id}` rooms and the `/api/quizzes` alias stay as wire compatibility.
- Folded `frontend/features/quizzes` into `features/presentations`; `/quiz/*` and `/quizzes` 308-redirect to the presentation routes, and the host QR code points at `/live/{code}`.
- A **published** `TRIAL` poll must be gradeable on every surface (`polls/polls.grading.ts`): REST create validates with `createPollRequestSchema`, `PollService` re-checks on create/update against the stored poll. Drafts may be answerless because the web builder autosaves them; MCP stays stricter and always requires answers.

## 2026-06-10 (live quiz feature)
- New `quizzes` module: Quiz doc holds both slide deck and live session state; presenter-paced state machine.
- Scoring is server-clock only; Kahoot-style decay `points * (1 - ratio/2)` with per-slide toggle.
- Answer hot path runs entirely on Redis (session cache, SADD dedup, ZSET scores) with Mongo as async write-behind — verified ~1100 answers/sec single instance.
- Participants authenticate answers with a join-time secret token; participantId alone is public.
- Added Redis fixed-window per-IP rate limiter (fails open); applied to quiz public routes + auth routes.
- Quiz realtime uses one envelope event `quiz:event` on room `quiz_{quizId}` via Redis pub/sub (same bridge pattern as analytics).
- `open-lobby` wipes the previous run (participants/answers/Redis keys); session history deferred to roadmap Phase 7.
- Roadmap for remaining Mentimeter parity lives in `quiz-roadmap.md` (Phases 3–8).

## 2026-05-11
- Adopted room key = `pollId` for creator live analytics subscriptions.
- Chose Redis pub/sub bridge (`responses.accepted`) as source for socket fanout events.
- Kept auth deferred and standardized mocked creator id behavior in controllers.
- Used LangChain structured output + LangGraph node flow for AI draft generation.
- Added always-on Cursor context-router rule to enforce minimal wiki doc loading per task.
- Added `beforeSubmitPrompt` hook to auto-append per-chat prompt log entries in `chat-log.md`.
