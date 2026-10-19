---
summary: Live session engine contract — sessions, slide phases, host commands, participant resync, events, Redis keys, error codes.
status: active
last_updated: 2026-10-19
---

# Presentations live sessions (contract)

Types: `backend/src/modules/presentations/live/contract.ts` (mirror them in the frontend's
`features/presentations/types/{live,realtime}.ts`). Module layout and slide registry:
[`presentations.md`](./presentations.md). Envelope, rooms and delivery:
[`../realtime/envelope.md`](../realtime/envelope.md).

## Model

Every time a deck is presented it gets a **session** (`PresentationSession`, collection
`presentationsessions`). Sessions are never deleted by presenting again: each keeps its
participants, answers, scores and a final snapshot. At most one session per deck is **live**
(`isLive: true`, status `lobby` or `active`); a unique partial index enforces it.

| Session field | Meaning |
| --- | --- |
| `runNumber` | 1, 2, 3, … per deck (`presentation.sessionCount` after open) |
| `status` | `lobby` → `active` → `ended`; `isLive` while not `ended` |
| `pace` | `presenter` (one slide open at a time); `audience` (W2-F) |
| `joinCode` | The deck's join code at open (codes are per deck and stable across runs) |
| `currentSlideId`, `currentSlideIndex` | -1 / null in the lobby |
| `slideStates` | slideId → `{openedAt, endsAt, pausedRemainingMs, closedAt, revealedAt}` for every visited slide |
| `deckSnapshot`, `settingsSnapshot`, `themeSnapshot`, `entitlementsSnapshot` | Frozen at open; the engine runs from `deckSnapshot`, so slide ids and answer keys never shift under a session |
| `participantCount`, `answerCount`, `finalLeaderboard` (≤100), `slideStats[]` | Written by `end` |
| `retainUntil` | `endedAt` + workspace retention (setting capped by the plan); null = no limit |
| `share` | Reserved for result sharing (W2-C) |

The deck keeps a **mirror** of its live session — `status` (`draft` before the first run, `ended`
between runs), `currentSlideIndex`, `questionStartedAt`, `questionEndsAt`, `activeSessionId`,
`lastSessionAt`, `sessionCount`. Only `live/session.service.ts` writes them. Deck edits stay
blocked while a session is live.

Participants and answers carry `sessionId`; answers also carry `slideId` (plus `slideIndex` for
exports), `clientAnswerId` and `via` (`rest` today; `socket`/`offline` from W2-D). A participant
belongs to one session: a device that joins a later session becomes a new participant there.

## Slide phases

| Lifecycle (registry) | Phases |
| --- | --- |
| `content`, `board`, `system` | `shown` |
| `response` | `open` → `closed` → `revealed` (`reopen` goes back to `open`) |

- **Timed** response slides (`timeLimit` > 0) close by the clock: answers are refused after
  `endsAt` + 750 ms grace (+ up to 15 s with a slide ticket, see [Answer path](#answer-path)),
  and views report `closed` once `endsAt` has passed.
- **Untimed** slides (`timeLimit: 0`, allowed for unscored types; scored types need ≥ 5 s) have
  `endsAt: null` and stay `open` until the host closes, reveals or leaves the slide.
- `reveal` closes the slide first: **no answer is accepted after a reveal**, even before `endsAt`
  and even with a slide ticket. A scored timed slide reveals itself 1.5 s after its timer (auto-reveal).
- Leaving an open slide (goto elsewhere) closes it.
- Revisiting a slide never reopens it: it comes back in its stored phase with its stored results.

## Host commands

All under `/api/presentations` (also `/api/quizzes`), `authenticate()` + `workspaceContext()`,
policy `deck:host` (`assertCan`; decks without `workspaceId` — before migration 020 — fall back to
the creator). Each returns `HostCommandResponse` = the deck document **plus `session: SessionView`**
(`session.current` describes the current slide, including its phase and answered count).

| Command | Body | Effect | Events |
| --- | --- | --- | --- |
| `POST /:id/host/open-lobby` | — | Ends the live session if any (with a snapshot), opens a **new** session in `lobby`. Never deletes data. | `session:lobby`, `lobby:opened` |
| `POST /:id/host/start` | — | Present without a lobby: lobby session → goes to slide 0; no live session → new session straight to slide 0. 409 `SESSION_ALREADY_LIVE` while a session is `active`. | slide 0's event (below) |
| `POST /:id/host/goto` | `{slideIndex}` or `{slideId}` | Moves to any slide, forwards or backwards (from `lobby` too). | the target's event |
| `POST /:id/host/advance` | `{slideIndex?}` | Legacy alias: `goto` `slideIndex`, default current + 1. | the target's event |
| `POST /:id/host/close` | — | Stops answers on the current response slide (no reveal). No-op if already closed. | `slide:closed` |
| `POST /:id/host/reopen` | — | Re-opens the current closed/revealed response slide with a fresh timer (`timeLimit`, or untimed). Earlier answers stay; those participants cannot answer again. | `question:started` (`reopened: true`) |
| `POST /:id/host/reveal` | — | Closes (if open) and reveals the current response slide. Repeatable (re-broadcast). | `question:revealed` |
| `POST /:id/host/end` | — | Ends the live session: snapshot, reconciliation, `retainUntil`. Idempotent once ended. | `session:ended`, `quiz:ended` |

Event on arriving at a slide (`goto`, `start`, `advance`):

| Target | Event |
| --- | --- |
| content / board slide | `slide:shown` |
| system (leaderboard) slide | `leaderboard:shown` |
| response slide, first visit | `question:started` (opens the answer window) |
| response slide, revisited after a reveal | `question:revealed` (`revisit: true`, stored results) |
| response slide, revisited while closed | `slide:closed` (`revisit: true`) |

`goto` to the slide already current is a no-op (no event).

### Reads

| Route | Policy | Response |
| --- | --- | --- |
| `GET /:id/host/state` | `deck:host` | `HostStateResponse`: the legacy fields (`quiz`, `presentation`, `serverNow`, `participants`, `answeredCount`, `liveDistribution`, `leaderboard`) for `session`, plus `session` (live, else latest ended, else null), `slideStates` (visited slides) and `distributions` (slideId → results of every visited response slide). After `end` the results come from the stored snapshot. |
| `GET /:id/sessions` | `session:read` | `SessionListItem[]`, newest first. |

## Participant API (public)

| Route | Rate limit (per IP) | Notes |
| --- | --- | --- |
| `GET /code/:code` | 60/min + 5000/min global | Adds `sessionId`, `pace`, `currentSlideId`, `currentSlidePhase`. `questionEndsAt` is null for an untimed open slide; after an early close/reveal it is the close time. |
| `POST /:id/join` | 500 / 5 min | `{name, deviceToken?, locale?}` → `JoinResponse` (adds `sessionId`). Joins the **live** session. 403 `SESSION_FULL` when the session already has `audienceCap` participants (a rejoin with the same `deviceToken` always succeeds). 403 `PARTICIPANT_KICKED` for removed participants. |
| `POST /:id/answer` | 2000/min | Unchanged body plus optional `sessionId`, `slideId`, `clientAnswerId` (≤ 64 chars), `slideTicket`, `offline`. `slideIndex` stays required and must match the slide. Returns `AnswerResult`; see [Answer path](#answer-path) for the replay rule, grace and errors. 409 `PARTICIPANT_STALE` when the participant belongs to an ended session. |
| `GET /:id/me?participantId&token` | 600/min | Adds `sessionId`; `lastAnswer` (with `slideId`) once the current slide is no longer `open`. |
| `GET /:id/live-state?participantId&token` | 600/min | `ParticipantLiveState`: session status, settings, theme, current slide (sanitized) with phase and timing, results when revealed, leaderboard on system slides, the participant's own standing, final standings once ended. Use it to resync after any reconnect or `seq` gap. |

Participant credentials are per session. Clients should key stored credentials by session
(`openpoll_participant_{code}_{sessionId}`) and rejoin when `live-state`/`me` answers 404 or the
code lookup shows a different `sessionId`.

## Events

Envelope v1 with `sessionId` set (see `realtime/envelope.md`). Payload types:
`PresentationEventPayloads`. All carry `slideId` where a slide is concerned.

| Type | Audience | When |
| --- | --- | --- |
| `session:lobby` | all | `open-lobby` — `{runNumber, joinCode, pace}` |
| `lobby:opened` | all | legacy copy, right after `session:lobby` — `{joinCode}` |
| `participant:joined` | all | join — `{participantId, name, participantCount}` |
| `question:started` | all | response slide opened — `{slideId, slideIndex, slide, startedAt, endsAt \| null, serverNow, isLastSlide, reopened, slideTicket}` |
| `slide:shown` | all | content/board slide — `{slideId, slideIndex, slide, isLastSlide, serverNow}` |
| `slide:closed` | all | close, or revisit of a closed slide — `{slideId, slideIndex, slide, closedAt, answeredCount, participantCount, isLastSlide, revisit, serverNow}` |
| `answer:received` | host only | coalesced: one per dirty slide per 250 ms window `{slideId, slideIndex, answeredCount, participantCount, distribution}` ([Coalesced host updates](#coalesced-host-updates)) |
| `question:revealed` | all | reveal, or revisit of a revealed slide — legacy fields + `{slideId, slide, revealedAt, revisit}` |
| `leaderboard:shown` | all | system slide — `{slideId, slideIndex, slide, leaderboard, participantCount, isLastSlide}` |
| `session:ended` | all | end — `{runNumber, endedAt, leaderboard (≤100), participantCount, answerCount}` |
| `quiz:ended` | all | legacy copy, right after `session:ended` — `{leaderboard, participantCount}` |

Clients ignore events whose `sessionId` is not their session's. `showResultsOnDevices` and
`quiz.showCorrectOnDevices` are presentation choices applied by the participant UI; results are
not secret once revealed.

## Answer path

`POST /:id/answer` and the socket `answer:submit` run the same code (`live/answer.service.ts`):

1. **Window.** The session is the client's `sessionId` or `presentation:{pid}:active`; the slide's
   answer window comes from `psess:{sid}:slides` (rebuilt from the session document on a miss).
2. **Grade (JS).** The slide type's `answerSchema`, `accept` and `score` run on the window's cached
   config. A malformed or ungradeable answer is 400 before any write. Ungraded slides never count
   as correct.
3. **One script call** (`live/lua/answer.lua`, `EVALSHA` with an `EVAL` fallback, every key under the
   session's hash tag). In order, with nothing written until the answer is accepted:
   unknown window or a different run of the slide than the one graded (`STALE`: reload once) →
   participant token (`NO_TOKEN` falls back to Mongo and re-mirrors the token once; `BAD_TOKEN` 401)
   → kicked (403) → per-participant rate limit → **dedup** (already answered) → session ended →
   window closed → deadline → validate the type's ops → write: `SADD answered`, `ZINCRBY scores`,
   `HINCRBY correct` when correct, every op of the type (`hincrby`, `hsetnx`, `lpush_trim`, run
   generically, never per type), the stored result in `results`, TTL refresh, and the coalescer
   mark.
4. **After the reply.** Accepted answers are queued for batched Mongo write-behind
   (`live/writeBehind.ts`); the window's owner schedules the host update. Nothing awaits Mongo or a
   publish.

**Idempotent replays.** An answer carries an optional `clientAnswerId`. If the participant already
answered the slide and the stored answer has the same `clientAnswerId`, the call returns the
original `AnswerResult` with `replay: true` and counts nothing again, also after the slide closed
(a lost ack retried from the offline queue). Any other second answer is 409 `ALREADY_ANSWERED`.

```ts
AnswerResult = { accepted: true, replay: boolean, slideId, slideIndex,
                 clientAnswerId: string | null, via: 'rest'|'socket'|'offline', answeredAt }
```

`via` is the channel of the original answer. A client replaying its offline queue sends
`offline: true` (stored as `via: 'offline'`, even over the socket).

**Grace and the slide ticket.** A timed slide takes answers until `endsAt` + 750 ms. A
**ticket** extends that to `endsAt` + 15 s while the host has not closed or revealed the slide.
The ticket is `st1.` + 32 hex characters: a truncated HMAC-SHA256 (keyed by `ID_SIGNING_SECRET`,
scope `slide-ticket.v1`) over `sessionId|slideId|startedAtMs` (`live/ticket.ts`). The server hands
it out only while the window is open — in `question:started`, in the participant `live-state`
(`current.slideTicket`, null unless open) and in the `live:resync` state — and the client sends it
back as `slideTicket` with the answer. It proves the client saw this run of the slide while it was
open; it is per window, not per participant (who answers is the participant token), so a reopened
slide's old tickets stop working, a ticket for another slide is no ticket, and a malformed one just
counts as none. Per slide kind:

| Slide | Without ticket | With a valid ticket |
| --- | --- | --- |
| Unscored, timed | until `endsAt` + 750 ms | until `endsAt` + 15 s |
| Scored, timed | until `endsAt` + 750 ms | until the (auto-)reveal, capped at `endsAt` + 15 s |
| Untimed | while open | while open |
| Any, after close or reveal | refused | refused (the host's decision wins) |
| Any, after the session ended | refused | refused |

**Auto-reveal.** A scored, timed slide that is still open 1.5 s after its timer is revealed by the
engine (`session.service.autoRevealSlide`): the same close + reveal as the host's, `question:revealed`
published. Open scored timed windows are scheduled in `live:autoreveal` (kept in step by every window
write, so close, reveal, reopen, pause and leaving the slide re-time or cancel the entry); every
instance polls it every 250 ms and the successful `ZREM` decides which one reveals, so each slide
reveals once. A host who closed, revealed or moved on first wins; the job re-checks the session
before acting. Unscored and untimed slides never auto-reveal.

**Errors.**

| Status | Code | When |
| --- | --- | --- |
| 400 | `NOT_ACCEPTING` | no window, wrong slide, closed, revealed, left, session ended |
| 400 | `TIME_UP` | past the deadline plus grace |
| 400 | — | malformed payload (`payload.<path>: …`) |
| 401 | — | wrong participant token |
| 403 | `PARTICIPANT_KICKED` | removed by the host |
| 409 | `ALREADY_ANSWERED` | answered already and this is not a replay |
| 409 | `PARTICIPANT_STALE` | the participant belongs to another session |
| 429 | `RATE_LIMITED` | more than 30 authenticated attempts in 10 s by this participant (any channel) |

### Socket: `answer:submit` and `live:resync`

`answer:submit` takes the REST body plus `presentationId` and acks the REST envelope with the HTTP
status the same call would have had:

```ts
AnswerSubmitAck = { success: true,  status: 200, message: 'Answer accepted', data: AnswerResult }
                | { success: false, status: number, message: string, code?: string, data: null }
```

The socket must first have joined the deck **as that participant** (`live:join` with the participant's
credentials, or the legacy `quiz:join`): an anonymous connection never reaches the answer path, and an
answer for a participant the socket did not join is 403 `NOT_JOINED` (a reconnected socket has no
rooms: await the `live:join` ack, then send). Identity is still the participant token in the payload,
checked by the script on every answer; the room only gates who may call. Two budgets apply: the participant's script budget above and
120 `answer:submit` per socket per 10 s (429 `RATE_LIMITED`, before any Redis work). Client rule:
2xx done; 409/400/401 and 403 `PARTICIPANT_KICKED` final; 403 `NOT_JOINED` means join and retry; 429, 5xx
and ack timeouts retry with the same `clientAnswerId`.

`live:resync` takes `{presentationId, role, …credentials}` as `live:join` does and acks
`{ok: true, role, seq, state}` — `state` is `ParticipantLiveState` (what `GET /:id/live-state` returns,
ticket included) or `HostStateResponse` (what `GET /:id/host/state` returns) — or
`{ok: false, error}` with `INVALID_PAYLOAD`, `RATE_LIMITED` (20 per socket per minute),
`UNAUTHENTICATED`, `FORBIDDEN`, `NOT_FOUND`, `UNAVAILABLE`. `seq` is the deck's envelope counter read
before the state, so an event with a higher seq is either in the state or still to come. It does not
join rooms.

### Coalesced host updates

The old per-answer `answer:received` and the 2 s worker are gone. The answer script adds the slide to
`psess:{sid}:dirty:slides` and tries `SET psess:{sid}:dirty 1 NX PX 250`; the answer that wins owns
the window and its instance runs `flushDirty` 250 ms later (`live/coalescer.ts`): drain the dirty set
(`SMEMBERS` + `DEL` in one transaction) and publish ONE host-only `answer:received` per dirty slide
with the current answered count, participant count and distribution. One Redis key decides who owns
a window and the drain hands each dirty slide to exactly one flush, so the host gets each update once
however many instances took answers. A window whose owner died is picked up by the next answer's
window. Host commands that move or stop the slide (`goto`, `close`, `reveal`, `end`, auto-reveal)
flush first, so the host always has the last counts before the transition event.

### Write-behind

Mongo is written in batches of up to 200 answers every 50 ms (`live/writeBehind.ts`): `insertMany`
(unordered; a duplicate key means reconciliation or a replay got there first), then the points of
the answers that were really inserted are added to their participants — unless the participant is
final (`scoreFinalAt`, set by the end-of-session reconciliation). A failed batch is logged and
dropped; reconciliation restores it from `results` at the end.

## Ending a session

`end` (and `open-lobby` replacing a live session) closes the current slide and writes the snapshot:

1. **Reconciliation** — answers live in Redis first and reach Mongo by write-behind. For every
   visited response slide, answers present in `psess:{sid}:results:{slideId}` (full answer JSON)
   but missing in Mongo are inserted; participants' `score`/`correctCount` are set from the Redis
   totals.
   Participants are marked final (`scoreFinalAt`) **before** the totals are recomputed, so a
   write-behind batch still in flight cannot add the points of an answer the recount already
   counted (the answer-path write-behind skips final participants; an answer it stores late is a
   duplicate key and adds nothing).
2. `slideStats[]` (per visited response slide: `answeredCount` + the type's `distribution`),
   `finalLeaderboard` (top 100), `participantCount`, `answerCount`.
3. `retainUntil` from the deck's workspace (`settings.retentionDays` capped by the plan's
   `retentionDays`; decks without a workspace use the free plan).
4. Redis keys stay readable for final screens (TTL refreshed), `presentation:{pid}:active` is
   removed, and the deck mirror becomes `ended`.

## Redis keys

Session-scoped and hash-tagged, so one session's keys share a Cluster slot (Lua-safe):

| Key | Type | Content |
| --- | --- | --- |
| `presentation:{pid}:active` | STRING | live session id |
| `psess:{<sid>}:meta` | HASH | `presentationId`, `pace`, `status`, `cap` (`''` = unlimited), `runNumber`, `totalSlides` |
| `psess:{<sid>}:current` | STRING | current slideId (presenter pace) |
| `psess:{<sid>}:slides` | HASH | slideId → answer window JSON `{v, slideId, slideIndex, type, scored, open, startedAtMs, endsAtMs \| null, pausedRemainingMs, cfg}` |
| `psess:{<sid>}:scores` / `:correct` / `:names` / `:tokens` | ZSET / HASH | standings, correct counts, nicknames, participant secrets |
| `psess:{<sid>}:seats` | SET | deviceIds holding a seat (audience cap; SADD-then-SCARD never over-admits) |
| `psess:{<sid>}:kicked` | SET | removed participantIds |
| `psess:{<sid>}:answered:{slideId}` | SET | dedup + answered count (written only by the answer script) |
| `psess:{<sid>}:dist:{slideId}` / `:disp:{slideId}` / `:feed:{slideId}` | HASH / HASH / LIST | the slide type's counters |
| `psess:{<sid>}:results:{slideId}` | HASH | participantId → full answer JSON (`/me` results and reconciliation) |
| `psess:{<sid>}:dirty` | STRING (PX 250) | coalescer window flag (`SET NX PX`); never part of the 6 h key set |
| `psess:{<sid>}:dirty:slides` | SET | slideIds answered since the last host update (60 s TTL) |
| `psess:{<sid>}:rate:{participantId}` | STRING (PX 10 s) | the participant's answer-attempt counter |
| `live:autoreveal` | ZSET | `<sid>\|<slideId>` → due time (ms) of scored timed slides' auto-reveal (global, not session-scoped) |
| `live:{pid}:seq` | STRING | envelope seq (unchanged) |

TTL 6 h after the last transition. A missing window is rebuilt from the session document
(`slideStates`), so a Redis restart cannot reopen a closed or revealed slide.

## Error codes

`SESSION_FULL` (403, join), `SESSION_ALREADY_LIVE` (409, start), `SESSION_BUSY` (409, concurrent
host commands — retry), `NO_LIVE_SESSION` (400, host commands that need one),
`PARTICIPANT_KICKED` (403), `PARTICIPANT_STALE` (409, answer from an ended session's participant),
`FORBIDDEN` (403, policy), `WORKSPACE_FORBIDDEN` (403, bad `X-Workspace-Id`). Answers add
`NOT_ACCEPTING` (400), `TIME_UP` (400), `ALREADY_ANSWERED` (409) and `RATE_LIMITED` (429), see
[Answer path](#answer-path). Messages are for humans.

## Migration 030 and deploy runbook

`src/migrations/030-presentation-sessions.ts` (idempotent, raw collection operations):

1. `syncIndexes()` for `presentationsessions`.
2. Every deck with participants or answers lacking `sessionId` gets **legacy session #1**
   (`runNumber: 1`, ended, `deckSnapshot` = the deck's current slides, `slideStates` for the
   slides up to the last shown, `slideStats` replayed from the stored answers,
   `finalLeaderboard`, counts, `entitlementsSnapshot`, `retainUntil`). Its participants get
   `sessionId`; its answers get `sessionId` and `slideId = slides[slideIndex]._id` (answers on a
   slide deleted since the run share one fresh id per index). The deck gets `sessionCount ≥ 1`,
   `lastSessionAt`, `activeSessionId: null`.
3. Decks left in `lobby`/`active` become `ended`.
4. Creates `{sessionId, deviceId}` (participants) and `{sessionId, slideId, participantId}` +
   `{sessionId, slideId}` (answers) — unique ones partial on `sessionId` — then drops
   `presentationId_1_deviceId_1` and `presentationId_1_slideIndex_1_participantId_1`; adds the
   deck indexes `{workspaceId, updatedAt}`, `{workspaceId, folderId, updatedAt}`,
   `{legacy.source, legacy.sourceId}` (sparse).

Runbook:

- Deploy when **no session is live**: the Redis key format changes (`presentation:{pid}:*` →
  `psess:{<sid>}:*`), so a run in progress cannot continue across the deploy; the migration ends it.
- `bun run migrate` runs before the server starts (the container entrypoint does it). Migration
  020 (workspaces) runs first, so legacy sessions copy the deck's `workspaceId`.
- Development databases created before this change still carry the old unique index on
  participants; until `bun run migrate` drops it, joining a second session from the same
  device fails with a duplicate key.
- Old Redis keys expire on their own within 6 h; to clear them at once:
  `redis-cli --scan --pattern 'presentation:*' | grep -v ':active$' | xargs -r redis-cli del`.
- Rollback: the previous release reads the same documents (new fields are additive) but its
  per-deck unique indexes are gone; recreate them only if no deck has run twice since.

## Behaviour changes from the single-run engine

- Opening the lobby again no longer wipes the previous run; it starts session N+1.
- Navigation works in both directions; revisits show stored results.
- Reveal stops answers immediately (previously answers were accepted until `endsAt` + grace).
- Ungraded slides — `select_answer`/`type_answer` worth 0 points or without a correct answer
  (converted polls) — are unscored: `scored: false` on the slide, results and events, answers
  never count as correct, and their distribution marks no option correct.
- Unscored built-in types may be untimed (`timeLimit: 0`).
- Answer path (W2-D): one script call per answer; host `answer:received` is coalesced (one per
  slide per 250 ms window, with the distribution) instead of one per answer plus a 2 s worker;
  `POST /answer` returns the richer `AnswerResult` (still `accepted: true`); a repeat with the same
  `clientAnswerId` is a replay, any other repeat 409 `ALREADY_ANSWERED`; slide tickets stretch the
  timer grace to 15 s; scored timed slides auto-reveal 1.5 s after their timer; each participant
  has a budget of 30 answer attempts per 10 s; `question:started` and `live-state` carry
  `slideTicket`.
- Host and edit routes use the workspace policy; `GET /api/presentations` lists the current
  workspace's decks (plus the caller's own decks not yet assigned to a workspace when the current
  workspace is their personal one), most recently updated first.

## Notes for later packages

- **W1-A2**: no auto-open on mount — read `host/state`; `session` null or ended → "Start
  presenting" (`start`) / "Open lobby"; back/forward = `goto`; untimed slides need "Close voting"
  (`close`); participants resync with `live-state`.
- **W2-A** (`timing.service`): `slideStates.pausedRemainingMs` and the window's
  `pausedRemainingMs` are reserved for pause/resume; `close`/`reopen` already exist for remotes.
- **W2-C**: `slideStats`, `finalLeaderboard`, `retainUntil`, `share` are on the session;
  answers are keyed by `{sessionId, slideId, participantId}`.
- **W2-D** (done): the answer path is one Redis script (below); `clientAnswerId` and `via`
  (`rest`/`socket`/`offline`) are stored; `psess:{sid}:results` holds what reconciliation needs.
  Phase 2 (frontend): the offline queue and `submitAnswer` in `live/store.ts` (socket ack 3 s →
  REST → queue) call `answer:submit` / `POST /answer` with a stable `clientAnswerId`, the slide's
  ticket and `offline: true` for queued answers, then the legacy `quiz:event` dual-emit goes.
- **W2-F**: `pace: 'audience'` opens every response slide in `:slides`; `settings.audiencePaced`
  is snapshotted.
