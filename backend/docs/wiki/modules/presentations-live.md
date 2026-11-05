---
summary: Live session engine contract — sessions, slide phases, host commands, presenter tools (timer, kick, phone remote), audience pace (open/close, attempts, auto-close), participant resync, events, Redis keys, error codes.
status: active
last_updated: 2026-11-05
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
| `pace` | `presenter` (one slide open at a time); `audience` (every response slide open at once, [Audience pace](#audience-pace-w2-f)) |
| `joinCode` | The deck's join code at open (codes are per deck and stable across runs) |
| `currentSlideId`, `currentSlideIndex` | -1 / null in the lobby |
| `slideStates` | slideId → `{openedAt, endsAt, pausedRemainingMs, pausedAt, pausedMs, closedAt, revealedAt}` for every visited slide (the pause fields: [Presenter tools](#presenter-tools-w2-a)) |
| `deckSnapshot`, `settingsSnapshot`, `themeSnapshot`, `entitlementsSnapshot` | Frozen at open; the engine runs from `deckSnapshot`, so slide ids and answer keys never shift under a session |
| `participantCount`, `answerCount`, `finalLeaderboard` (≤100), `slideStats[]` | Written by `end` |
| `retainUntil` | `endedAt` + workspace retention (setting capped by the plan); null = no limit |
| `endReason` | `host` (End Session, or a new lobby replacing it), `lobby_idle` / `live_idle` (ended by the idle-session job); null for sessions ended before it was recorded |
| `lastActivityAt` | Last host command, join or answer while live; see [Idle sessions](#idle-sessions-end-on-their-own) |
| `share` | Result-sharing link (token, `includeNames`, `expiresAt`); see [sessions](./sessions.md) |
| `audience` | Audience pace (W2-F): `{openedAt, closesAt, closedAt, closeReason: host\|schedule\|ended}`; null for presenter pace. See [Audience pace](#audience-pace-w2-f) |

The deck keeps a **mirror** of its live session — `status` (`draft` before the first run, `ended`
between runs), `currentSlideIndex`, `questionStartedAt`, `questionEndsAt`, `activeSessionId`,
`lastSessionAt`, `sessionCount`. Only `live/session.service.ts` writes them. Deck edits stay
blocked while a session is live, except the embedding switch `settings.embed.allowed` (W4-D,
`modules/embeds.md`), which a presenter may need mid-session to put the stage on a second screen.

Participants and answers carry `sessionId`; answers also carry `slideId` (plus `slideIndex` for
exports), `clientAnswerId` and `via` (`rest`, `socket`, or `offline` for an answer the client held
in its offline queue). A participant
belongs to one session: a device that joins a later session becomes a new participant there.

## Slide phases

| Lifecycle (registry) | Phases |
| --- | --- |
| `content`, `board`, `system` | `shown` |
| `response` | `open` → `closed` → `revealed` (`reopen` goes back to `open`) |

- **Timed** response slides (`timeLimit` > 0) close by the clock: answers are refused after
  `endsAt` + 750 ms grace (+ up to 15 s with a slide ticket, see [Answer path](#answer-path)),
  and views report `closed` once `endsAt` has passed. The host can pause, resume, extend or skip
  the timer ([Presenter tools](#presenter-tools-w2-a)); a paused slide stays `open` with `endsAt`
  null and its time left frozen in `pausedRemainingMs`.
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
| `POST /:id/host/open-lobby` | — | Ends the live session if any (with a snapshot), opens a **new** session in `lobby`. Never deletes data. 409 `TEMPLATE_NOT_PRESENTABLE` on a workspace template (also on start). | `session:lobby`, `lobby:opened` |
| `POST /:id/host/start` | — | Present without a lobby: lobby session → goes to slide 0; no live session → new session straight to slide 0. 409 `SESSION_ALREADY_LIVE` while a session is `active`. | slide 0's event (below) |
| `POST /:id/host/goto` | `{slideIndex}` or `{slideId}` | Moves to any slide, forwards or backwards (from `lobby` too). | the target's event |
| `POST /:id/host/advance` | `{slideIndex?}` | Legacy alias: `goto` `slideIndex`, default current + 1. | the target's event |
| `POST /:id/host/close` | — | Stops answers on the current response slide (no reveal). No-op if already closed. | `slide:closed` |
| `POST /:id/host/reopen` | — | Re-opens the current closed/revealed response slide with a fresh timer (`timeLimit`, or untimed). Earlier answers stay; those participants cannot answer again. | `question:started` (`reopened: true`) |
| `POST /:id/host/reveal` | — | Closes (if open) and reveals the current response slide. Repeatable (re-broadcast). | `question:revealed` |
| `POST /:id/host/end` | — | Ends the live session: snapshot, reconciliation, `retainUntil`. Idempotent once ended. | `session:ended`, `quiz:ended` |
| `POST /:id/host/timer` | `{action: 'pause'\|'resume'\|'extend', seconds?}` (5–600, default 30) | The current open, timed response slide's timer ([Presenter tools](#presenter-tools-w2-a)). 400 `NO_TIMER` (untimed, closed, time already up for a pause), 409/400 `TIMER_STATE` (already paused / not paused). | `slide:timing` |
| `POST /:id/host/skip` | — | Time's up now on the current timed slide: `endsAt` = now (ends a pause); its grace and auto-reveal follow. 400 `NO_TIMER` for untimed slides (use `close`). | `slide:timing` |

Event on arriving at a slide (`goto`, `start`, `advance`):

| Target | Event |
| --- | --- |
| content / board slide | `slide:shown` |
| system (leaderboard) slide | `leaderboard:shown` |
| response slide, first visit | `question:started` (opens the answer window) |
| response slide, revisited after a reveal | `question:revealed` (`revisit: true`, stored results) |
| response slide, revisited while closed | `slide:closed` (`revisit: true`) |

`goto` to the slide already current is a no-op (no event).

Presenter routes that are not slide commands (they return their own bodies):

| Route | Body / response | Effect | Events |
| --- | --- | --- | --- |
| `POST /:id/host/participants/:participantId/kick` | → `KickResponse {participantId, name, kicked: true, participantCount}` | Removes a participant of the live session ([Removing a participant](#removing-a-participant)). Idempotent. 404 `PARTICIPANT_NOT_FOUND`, 400 `NO_LIVE_SESSION`. | `participant:kicked` (host room and that participant's room) |
| `GET /:id/host/remote-token` | → `RemoteStatus {paired, bound, boundAt, expiresAt, connected}` | The deck's phone-remote pairing ([Phone remote](#phone-remote)). | — |
| `POST /:id/host/remote-token` | → 201 `RemoteTokenCreated {token, path, expiresAt}` | A new pairing; the previous one is revoked. The token is returned once. Rate limited 20/min per IP. | `remote:disconnected` if a remote was connected |
| `DELETE /:id/host/remote-token` | → `RemoteStatus` | Revokes the pairing; a connected remote is dropped at once. Rate limited 20/min per IP. | `remote:disconnected` |

### Reads

| Route | Policy | Response |
| --- | --- | --- |
| `GET /:id/host/state` | `deck:host` | `HostStateResponse` (built by `buildDeckLiveState`, which the read-only screen state of `modules/embeds.md` shares): the legacy fields (`quiz`, `presentation`, `serverNow`, `participants`, `answeredCount`, `liveDistribution`, `leaderboard`) for `session`, plus `session` (live, else latest ended, else null), `slideStates` (visited slides) and `distributions` (slideId → results of every visited response slide). After `end` the results come from the stored snapshot. |
| `GET /:id/sessions` | `session:read` | `SessionListItem[]`, newest first. |

## Participant API (public)

| Route | Rate limit (per IP) | Notes |
| --- | --- | --- |
| `GET /code/:code` | 60/min + 5000/min global | Adds `sessionId`, `pace`, `currentSlideId`, `currentSlidePhase`, `nickname` (the session's nickname rule) and `audience` (the audience window, null for presenter pace). `questionEndsAt` is null for an untimed open slide and while paused; after an early close/reveal it is the close time. `questionPausedRemainingMs` (paused) and `questionDurationMs` (the timer's budget) for response slides. |
| `POST /:id/join` | 500 / 5 min | `{name?, deviceToken?, locale?}` → `JoinResponse` (adds `sessionId`). `name` is required unless the nickname rule is `optional` or `off` ("Guest NNNN", [Audience pace](#audience-pace-w2-f)). Joins the **live** session. 403 `SESSION_FULL` when the session already has `audienceCap` participants (a rejoin with the same `deviceToken` always succeeds). 403 `PARTICIPANT_KICKED` for removed participants (checked before a seat is taken). |
| `POST /:id/answer` | 2000/min | Unchanged body plus optional `sessionId`, `slideId`, `clientAnswerId` (≤ 64 chars), `slideTicket`, `offline`. `slideIndex` stays required and must match the slide. Returns `AnswerResult`; see [Answer path](#answer-path) for the replay rule, grace and errors. 409 `PARTICIPANT_STALE` when the participant belongs to an ended session. |
| `GET /:id/me?participantId&token` | 600/min | Adds `sessionId`; `lastAnswer` (with `slideId`) once the current slide is no longer `open`. |
| `GET /:id/live-state?participantId&token` | 600/min | `ParticipantLiveState`: session status, settings, theme, current slide (sanitized) with phase and timing (`pausedRemainingMs`, `durationMs` included), results when revealed, leaderboard on system slides, the participant's own standing, final standings once ended. Use it to resync after any reconnect or `seq` gap. |

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
| `slide:timing` | all | `timer` / `skip` — `{slideId, slideIndex, action: pause\|resume\|extend\|skip, startedAt, endsAt \| null, pausedRemainingMs, durationMs, addedSeconds, serverNow}` |
| `participant:kicked` | host + the removed participant | `kick` — `{participantId, name, participantCount}` (two publishes; other phones never get it) |
| `remote:connected` / `remote:disconnected` | host | the paired phone remote's first socket joined / last socket left (or the pairing was revoked) — `{at}`; `sessionId` null |
| `audience:opened` | all | audience pace: `open-audience` (also a changed closing time) — `{openedAt, closesAt \| null, serverNow}` |
| `audience:closed` | all | audience pace: the slides closed — `{closedAt, reason: host\|schedule}` |
| `audience:progress` | host only | audience pace: a submit or retry — `{participantId, name, attempt, submitted, percentage, passed}` |

Clients ignore events whose `sessionId` is not their session's. `showResultsOnDevices` and
`quiz.showCorrectOnDevices` are presentation choices applied by the participant UI; results are
not secret once revealed.

## Answer path

`POST /:id/answer` and the socket `answer:submit` run the same code (`live/answer.service.ts`):

1. **Window.** The session is the client's `sessionId` or `presentation:{pid}:active`; the slide's
   answer window comes from `psess:{sid}:slides` (rebuilt from the session document on a miss).
2. **Grade (JS).** The slide type's `answerSchema`, `accept` and `score` run on the window's cached
   config. A malformed or ungradeable answer is 400 before any write. Ungraded slides never count
   as correct. Speed scoring gets `activeElapsedMs`: the time the timer ran (finished pauses left
   out; an answer landing during a pause counts at the pause's start). With the deck setting
   `profanityFilter` on, the text of word-cloud and open-ended answers is masked first
   (`common/utils/profanity.ts`), so neither results nor stored answers carry the words.
3. **One script call** (`live/lua/answer.lua`, `EVALSHA` with an `EVAL` fallback, every key under the
   session's hash tag). In order, with nothing written until the answer is accepted:
   unknown window or a different run of the slide than the one graded (`STALE`: reload once) →
   participant token (`NO_TOKEN` falls back to Mongo and re-mirrors the token once; `BAD_TOKEN` 401)
   → kicked (403) → per-participant rate limit → **dedup** (already answered) → session ended →
   **attempt** (audience pace, `ATTEMPT`: see [Audience pace](#attempts-on-the-answer-path)) → window
   closed → **paused** (`PAUSED` after 750 ms of pause, W2-A) → deadline → validate the
   type's ops → write: `SADD answered`, `ZINCRBY scores`,
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
| 409 | `SLIDE_PAUSED` | the host paused the timer (more than 750 ms ago); clients retry with the same `clientAnswerId` once it resumes |
| 409 | `PARTICIPANT_STALE` | the participant belongs to another session |
| 409 | `ATTEMPT_SUBMITTED` / `ATTEMPT_STALE` | audience pace: the attempt was submitted / is not the current one |
| 429 | `RATE_LIMITED` | more than 30 authenticated attempts in 10 s by this participant (any channel) |

### Socket: `answer:submit` and `live:resync`

`answer:submit` takes the REST body plus `presentationId` and acks the REST envelope with the HTTP
status the same call would have had:

```ts
AnswerSubmitAck = { success: true,  status: 200, message: 'Answer accepted', data: AnswerResult }
                | { success: false, status: number, message: string, code?: string, data: null }
```

The socket must first have joined the deck **as that participant** (`live:join` with the participant's
credentials): an anonymous connection never reaches the answer path, and an
answer for a participant the socket did not join is 403 `NOT_JOINED` (a reconnected socket has no
rooms: await the `live:join` ack, then send). Identity is still the participant token in the payload,
checked by the script on every answer; the room only gates who may call. Two budgets apply: the participant's script budget above and
120 `answer:submit` per socket per 10 s (429 `RATE_LIMITED`, before any Redis work). Client rule:
2xx done; 409/400/401 and 403 `PARTICIPANT_KICKED` final; 403 `NOT_JOINED` means join and retry; 429, 5xx,
409 `SLIDE_PAUSED` and ack timeouts retry with the same `clientAnswerId`.

`live:resync` takes `{presentationId, role, …credentials}` as `live:join` does and acks
`{ok: true, role, seq, state}` — `state` is `ParticipantLiveState` (what `GET /:id/live-state` returns,
ticket included) or `HostStateResponse` (what `GET /:id/host/state` returns) — or
`{ok: false, error}` with `INVALID_PAYLOAD`, `RATE_LIMITED` (20 per socket per minute),
`UNAUTHENTICATED`, `FORBIDDEN`, `NOT_FOUND`, `UNAVAILABLE`. A `screen` (W4-D) resyncs with `screenToken` and gets the stage-safe screen state (`modules/embeds.md`). `seq` is the deck's envelope counter read
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

### Idle sessions end on their own

A host who walks away would otherwise leave the session live for good: the deck keeps showing
"Lobby open", keeps its join code, and `retainUntil` never starts. So:

- a **lobby** with no activity for `SESSION_IDLE_LOBBY_HOURS` (default **6**) ends;
- a **presented** (`active`) session with no activity for `SESSION_IDLE_LIVE_HOURS` (default
  **12**) ends.

Both are hours, 1–8760, validated at boot (`env.sessionIdle`; `backend/.env.example`). An
audience-paced session open until a closing time is not idle before that time (W2-F).

**Activity** is a host command (open lobby, start, goto/advance, close, reopen, reveal), a
participant joining, or an accepted answer, kept as the session's `lastActivityAt`
(`live/activity.ts`). Host commands set it on the session document they save anyway (a command
that changes nothing, such as closing a closed slide, does not count). Joins and answers never
write the session document, so `noteSessionActivity` writes `$max: {lastActivityAt}` at most
once per session every 5 minutes per instance (in-process throttle): never a Mongo write per
answer. Sessions opened before the field existed are judged by `updatedAt` (every host command
saves the session); migration 200 also backfills them. Q&A and reactions do not count.

**The job** `presentations-idle-session-end` (`live/idleSessions.ts`, registered through
`registerJob`, see [jobs](../platform/jobs.md)) runs every 10 minutes on one instance at a
time (the scheduler's tick and run locks). It looks up live sessions past their threshold
through the partial index `live_sessions_by_activity` (`{status, lastActivityAt}`, live
sessions only, migration 200), and for each calls `endIdleSession`, which re-reads the session,
checks it is still idle (a host or participant who came back meanwhile wins; a host command
racing it surfaces as `SESSION_BUSY` and is skipped), then ends it through the **same code as
`end`** (`finishSession` + deck mirror): current slide closed, reconciliation, final
leaderboard, `retainUntil`, Redis cleanup, `session:ended` (+ `quiz:ended`) to connected
sockets. An open host console therefore shows the normal ended screen. `endReason` records
`lobby_idle` or `live_idle`, and each session gets a `session.auto_ended` audit event
(`actorType: system`, target `session`, in the deck's workspace) with `meta: {reason,
presentationId, runNumber, lastActivityAt, idleHours}`.

## Redis keys

Session-scoped and hash-tagged, so one session's keys share a Cluster slot (Lua-safe):

| Key | Type | Content |
| --- | --- | --- |
| `presentation:{pid}:active` | STRING | live session id |
| `psess:{<sid>}:meta` | HASH | `presentationId`, `pace`, `status`, `cap` (`''` = unlimited), `runNumber`, `totalSlides` |
| `psess:{<sid>}:current` | STRING | current slideId (presenter pace) |
| `psess:{<sid>}:slides` | HASH | slideId → answer window JSON `{v: 5, slideId, slideIndex, type, scored, open, startedAtMs, endsAtMs \| null, pausedRemainingMs, pausedAtMs, pausedMs, profanityFilter, audience, cfg}` (an entry of another version is dropped and rebuilt) |
| `psess:{<sid>}:scores` / `:correct` / `:names` / `:tokens` | ZSET / HASH | standings, correct counts, nicknames, participant secrets |
| `psess:{<sid>}:seats` | SET | deviceIds holding a seat (audience cap; SADD-then-SCARD never over-admits) |
| `psess:{<sid>}:kicked` | SET | removed participantIds |
| `psess:{<sid>}:answered:{slideId}` | SET | dedup + answered count (written only by the answer script) |
| `psess:{<sid>}:dist:{slideId}` / `:disp:{slideId}` / `:feed:{slideId}` | HASH / HASH / LIST | the slide type's counters |
| `psess:{<sid>}:results:{slideId}` | HASH | participantId → full answer JSON (`/me` results and reconciliation) |
| `psess:{<sid>}:answered:{slideId}:a<n>` / `:results:{slideId}:a<n>` | SET / HASH | audience pace: dedup and stored results of attempt n ≥ 2 |
| `psess:{<sid>}:attempts` | HASH | audience pace: participantId → `"<n>"` (attempt n running) or `"<n>:done"` (submitted); missing = `"1"` |
| `psess:{<sid>}:dirty` | STRING (PX 250) | coalescer window flag (`SET NX PX`); never part of the 6 h key set |
| `psess:{<sid>}:dirty:slides` | SET | slideIds answered since the last host update (60 s TTL) |
| `psess:{<sid>}:rate:{participantId}` | STRING (PX 10 s) | the participant's answer-attempt counter |
| `live:autoreveal` | ZSET | `<sid>\|<slideId>` → due time (ms) of scored timed slides' auto-reveal (global, not session-scoped) |
| `live:{pid}:seq` | STRING | envelope seq (unchanged) |
| `remote:{<pid>}:sockets` | SET (12 h TTL) | socket ids of the deck's connected phone remote, all instances (drives `remote:connected` / `remote:disconnected`) |

TTL 6 h after the last transition. A missing window is rebuilt from the session document
(`slideStates`), so a Redis restart cannot reopen a closed or revealed slide.

## Error codes

`SESSION_FULL` (403, join), `SESSION_ALREADY_LIVE` (409, start), `SESSION_BUSY` (409, concurrent
host commands — retry), `NO_LIVE_SESSION` (400, host commands that need one),
`TEMPLATE_NOT_PRESENTABLE` (409, open-lobby and start on a workspace template, W3-B2),
`PARTICIPANT_KICKED` (403), `PARTICIPANT_STALE` (409, answer from an ended session's participant),
`FORBIDDEN` (403, policy), `WORKSPACE_FORBIDDEN` (403, bad `X-Workspace-Id`). Answers add
`NOT_ACCEPTING` (400), `TIME_UP` (400), `ALREADY_ANSWERED` (409), `SLIDE_PAUSED` (409) and
`RATE_LIMITED` (429), see [Answer path](#answer-path). Presenter tools add `NO_TIMER` (400),
`TIMER_STATE` (400/409), `PARTICIPANT_NOT_FOUND` (404); the remote adds `REMOTE_INVALID` (404),
`REMOTE_BOUND` (403), `REMOTE_DEVICE_REQUIRED` (400). Audience pace adds `NOT_AUDIENCE_PACED` (409),
`AUDIENCE_PACED` (409), `AUDIENCE_NOT_OPEN` (400), `ATTEMPT_SUBMITTED` / `ATTEMPT_STALE` (409),
`RETRY_NOT_ALLOWED` (409). Messages are for humans.

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

## Presenter tools (W2-A)

Code: `live/timing.service.ts` (timer), `live/moderation.service.ts` (kick), `live/control.ts`
(room changes on every instance), `modules/remote/**` (phone remote). Tests:
`tests/integration/presenter.test.ts`, `tests/presentations/timing.test.ts`, the paused scenario in
`tests/integration/answerScript.test.ts`.

### Timer

Only the current **open** response slide **with a timer** qualifies (400 `NO_TIMER` otherwise:
untimed slides have `close`). Each action changes the slide state on the session document (same
optimistic concurrency as every host command), rewrites the Redis answer window (which re-times or
cancels the auto-reveal) and publishes one `slide:timing`.

| Action | State change |
| --- | --- |
| `pause` | `endsAt` → null, `pausedRemainingMs` = time left, `pausedAt` = now. 400 `NO_TIMER` when the time is already up; 409 `TIMER_STATE` when already paused. |
| `resume` | `endsAt` = now + `pausedRemainingMs`; the pause joins `pausedMs`; 400 `TIMER_STATE` when not paused. |
| `extend` (`seconds` 5–600) | running: `endsAt` += seconds (a timer that already ran out but whose slide is still open restarts from now); paused: `pausedRemainingMs` += seconds. |
| `skip` (`POST /:id/host/skip`) | `endsAt` = now (a running pause ends): time's up now; the 750 ms / ticket grace and the auto-reveal of scored slides follow, as for a timer running out. |

While paused: the slide stays `open`; the answer script refuses answers 750 ms after `pausedAt`
(answers already on their way are taken) with 409 `SLIDE_PAUSED`, which clients retry (same
`clientAnswerId`) once it resumes; the auto-reveal is unscheduled (`autoRevealDueAt` is null for a
paused window). Closing, revealing, leaving or ending a paused slide ends the pause.

**Fair scoring.** Speed points use `activeElapsedMs` — the time the timer ran, without pauses — so a
pause neither costs points nor gives a head start (nobody can answer while paused). Speed points are
measured against the slide's own `timeLimit`: an answer in extra time gets the minimum speed share.

**Views.** `SlideStateView` (host state, command responses) adds `pausedAt` and `durationMs` (the
timer's whole budget: time limit plus extensions, derived from the state: running `endsAt −
openedAt − pausedMs`, paused the time it ran plus what is left). `live-state.current` and the code
lookup carry `pausedRemainingMs` and `durationMs` too, so a reload shows the frozen or extended time.

### Removing a participant

`POST /:id/host/participants/:pid/kick` (policy `deck:host`, live session only, the participant must
belong to it):

- `kickedAt` is set in Mongo and the id added to `psess:{sid}:kicked`: the answer script refuses its
  answers (403 `PARTICIPANT_KICKED`), and so do `/me`, `/live-state`, `live:resync` and socket
  `live:join` (`verifyParticipant`);
- a join with its device token is refused **before** a seat is claimed, and the seat it held
  (`psess:{sid}:seats`) is given back, so a capped session can admit someone else;
- its name and score leave the Redis mirror (`:names`, `:scores`): the live participant count and
  the leaderboards no longer count it; the final leaderboard and `participantCount` skip kicked
  participants (`getStoredLeaderboard`, the snapshot). Answers it already gave stay in the results;
- `participant:kicked` goes to the host room and to the participant's own room, then a
  `presentations:control` message `{kind: 'participant-leave'}` makes every instance remove that
  participant's sockets from the deck's rooms (published on the same connection after the event, so
  the phone receives its envelope first).

### Phone remote

`modules/remote/**` (`remote.service.ts`, `remote.socket.ts`, `remote.route.ts`, model
`RemoteToken`, collection `remotetokens`, migration 040). One pairing per deck.

- **Pairing.** `POST /:id/host/remote-token` makes `rt1.` + 43 base64url characters (32 random
  bytes); only its SHA-256 is stored, with `createdBy` (the host), `expiresAt` (24 h, TTL index) and
  `revokedAt`. A new pairing revokes the previous one. The token is returned once (the presenter
  view shows it as a QR code of `<origin>/remote/<token>`).
- **First device binds.** The phone generates a device key (22–128 of `[A-Za-z0-9_-]`, kept in its
  localStorage) and sends it with every call; the first redemption stores its SHA-256
  (`findOneAndUpdate` on `deviceHash: null`, so of two racing phones one wins). Another key: 403
  `REMOTE_BOUND`; unknown, revoked, replaced or expired token: 404 `REMOTE_INVALID`; missing key:
  400 `REMOTE_DEVICE_REQUIRED`.
- **`GET /api/remote/:token/state`** (header `X-Remote-Device`, 120/min per IP, allow-listed in the
  tenancy test: the token plus the bound device are the credential) → `RemoteState`: deck title,
  session status (`draft` before the first run), participant count, the current slide (`title`,
  type, lifecycle, phase, timer fields, answered count and its **speaker notes** — the remote is the
  presenter's own device) and the next slide's title. Redeeming on a GET binds the device: it is the
  phone's first call.
- **Socket.** `remote:join {token, deviceKey}` redeems and joins `live:{pid}` (the public events
  every participant gets) and `live:{pid}:remote`; acks `{ok: true, state}` or `{ok: false, error}`
  (`INVALID_PAYLOAD`, `RATE_LIMITED`, `REMOTE_INVALID`, `REMOTE_BOUND`, `UNAVAILABLE`); counts
  against the 30/min join budget. `remote:command {command}` (`next`, `prev`, `reveal`, `close`,
  `extend30`, `pause`, `resume`; 30 per socket per 10 s) re-reads the pairing, then runs the host
  command **as the host who paired** (a bare user id actor: `deck:host` is evaluated each time, so a
  host who lost the deck loses the remote) and acks `{ok: true, command, state}` or `{ok: false,
  error: NOT_JOINED | RATE_LIMITED | REMOTE_INVALID | FORBIDDEN | COMMAND_FAILED | UNAVAILABLE, code?,
  message?}`. `next` needs a live session (from the lobby it starts slide 1) and refuses past the
  last slide. The pairing names its deck: a `presentationId` in the payload is ignored.
- **Presence.** Remote socket ids live in `remote:{<pid>}:sockets` (all instances); the first one
  publishes `remote:connected`, the last one leaving `remote:disconnected` (host audience).
- **Revocation.** `DELETE` (or a new pairing) sets `revokedAt`, publishes `remote:control {kind:
  'revoke'}` — every instance makes the deck's remote sockets leave the rooms and emits
  `remote:revoked` to them — clears the presence set and publishes `remote:disconnected`.

### Deck setting `profanityFilter`

`settings.profanityFilter` (default false, snapshotted with the session) masks profanity in the text
of word-cloud entries and open-ended answers on the answer path (the window carries
`profanityFilter`); Q&A questions are always masked. The word list and masking:
`common/utils/profanity.ts` (shared with Q&A).

## Notes for later packages

- **W1-A2**: no auto-open on mount — read `host/state`; `session` null or ended → "Start
  presenting" (`start`) / "Open lobby"; back/forward = `goto`; untimed slides need "Close voting"
  (`close`); participants resync with `live-state`.
- **W2-A** (done, [Presenter tools](#presenter-tools-w2-a)): timer, skip, kick, phone remote,
  profanity filter; frontend in `frontend/docs/wiki/features/live-surfaces.md` ("Presenter view").
- **W2-C** (done, [sessions](./sessions.md)): `slideStats`, `finalLeaderboard`, `retainUntil`, `share` are on the session;
  answers are keyed by `{sessionId, slideId, participantId}`.
- **W2-D** (done): the answer path is one Redis script (below); `clientAnswerId` and `via`
  (`rest`/`socket`/`offline`) are stored; `psess:{sid}:results` holds what reconciliation needs.
  Phase 2 (done, frontend): `submitAnswer` in `frontend/features/presentations/live/store.ts`
  (socket `answer:submit` with a 3 s ack, only after the `live:join` ack → REST → the IndexedDB
  queue in `live/offline/`) sends a stable `clientAnswerId`, the slide's ticket and `offline: true`
  for queued answers (`frontend/docs/wiki/features/live-surfaces.md`, "Answers"). The legacy
  `quiz:join` / `quiz:event` protocol is gone.
- **W2-F** (done, [Audience pace](#audience-pace-w2-f)): `open-audience` / `close-audience`, attempts on
  the answer path, submit and retry, the `audience-autoclose` job, migration 230; frontend in
  `frontend/docs/wiki/features/live-surfaces.md` ("Audience pace").

## Audience pace (W2-F)

Code: `live/audience.service.ts` (commands, the auto-close sweep), `live/audienceState.ts` (settings,
attempt scoring, the participant and host views), `live/attempts.ts` (attempt states),
`live/audienceAutoClose.ts` (the job), `routes/audience.route.ts`, `controllers/audience.controller.ts`.
Tests: `tests/integration/audiencePace.test.ts`, the attempt scenario in
`tests/integration/answerScript.test.ts`.

A deck with `pace: 'audience'` opens **every response slide at once**; each participant moves
through the deck on their own. There is no current slide (`currentSlideIndex` −1, `current` null),
no timer and no speed points. The pace is snapshotted on the session, with `settings.audiencePaced`:

| Setting | Meaning |
| --- | --- |
| `resultsVisibility` | `after_submit` (a slide's results once the participant answered it), `after_close` (once the slides closed), `never`. Default `after_close`. |
| `closeAfterMinutes` | 1–43200 or null: `open-audience` without `closesAt` closes that long after opening. |
| `assessment.enabled` | Graded slides count towards a score; each submitted attempt passes or fails at `passingScorePercentage`. |
| `assessment.maxAttempts` | 1–10, or null = unlimited (capped at `AUDIENCE_UNLIMITED_ATTEMPTS` = 100). Without an assessment there is one attempt. |

`settings.nickname` (`required` / `optional` / `off`) applies to joins in both paces: `optional`
takes the typed name or makes one, `off` always makes one — "Guest NNNN" (`guestName`); `required`
refuses an empty name (400 "Name is required"). The code lookup carries `nickname`.

### Host commands

| Command | Body | Effect | Events |
| --- | --- | --- | --- |
| `POST /:id/host/open-audience` | `{closesAt?}`: ISO time in the future, ≤ 30 days ahead; null = no closing time; omitted = `closeAfterMinutes` from now (or the closing time already set on an open session) | Opens every response slide (`openedAt`, `endsAt` = the closing time) from the lobby, or opens a **new** session straight away. On an open session it only changes the closing time; on a closed one it opens the slides again (answers given stay). 409 `NOT_AUDIENCE_PACED` (presenter-paced deck or live session), 409 `TEMPLATE_NOT_PRESENTABLE`, 400 for a bad `closesAt`. | `audience:opened` |
| `POST /:id/host/close-audience` | — | Closes every open slide; the session stays live, so results shown `after_close` appear. Idempotent. 400 `AUDIENCE_NOT_OPEN` before opening, 409 `NOT_AUDIENCE_PACED`. | `audience:closed {reason: 'host'}` |

`start` on an audience-paced deck (lobby or no live session) is `open-audience` with no body.
`goto` / `advance` on an audience-paced session are 409 `AUDIENCE_PACED`; `close`, `reopen`,
`reveal`, `timer` and `skip` find no current slide (400). `end` closes every open slide and the
audience window (`closeReason: 'ended'`), then ends as usual. Both routes run `authenticate()` →
`workspaceContext()` → `deck:host`, rate limited 60/min per IP. The command responses are
`HostCommandResponse`; `SessionView.audience` = `{openedAt, closesAt, closedAt, closeReason}`
(null for presenter pace), also on the session document (`audience`).

### Participants

| Route | Body | Notes |
| --- | --- | --- |
| `POST /:id/answer` (and socket `answer:submit`) | as before, plus `attempt?` (the client sends its current attempt) | Any **open** slide of the session by `slideId` + `slideIndex`. No speed points (graded as if instant); `timeMs` keeps the real time. |
| `POST /:id/audience/submit` | `{participantId, participantToken, attempt?}` | Locks the attempt (the answer script refuses answers for it from then on), scores it from its stored answers and records it on the participant (`audience.attempts[]`). Returns `AudienceParticipantView`. Submitting again returns the same view; 409 `ATTEMPT_STALE` for another attempt; also works after the slides closed or the session ended (to see the score). |
| `POST /:id/audience/retry` | `{participantId, participantToken}` | Next attempt of a failed assessment while attempts are left and the slides are open: the attempt state moves on and the leaderboard score goes back to 0 (the latest attempt counts). A double click starts one attempt. 409 `RETRY_NOT_ALLOWED` (no assessment, not submitted, passed, no attempt left, closed). |

Both are public (participant token; allow-listed in the tenancy test), rate limited 600/min per IP,
400 `AUDIENCE_NOT_OPEN` before the host opened the slides, 409 `NOT_AUDIENCE_PACED` for presenter pace.

`GET /:id/live-state` adds `audience: AudienceParticipantView` (null for presenter pace): `status`
(`waiting` | `open` | `closed`), the window, `resultsVisibility`, `assessment`, `attempt {number,
submitted, submittedAt}`, `attempts[]` (`AudienceAttemptResult`: `score`, `maxScore`, `percentage`,
`correctCount`, `answeredCount`, `totalQuestions`, `passed`), `attemptsLeft`, `canRetry`, `final` and
every slide (`AudienceSlideView`: sanitized slide, phase, `slideTicket` while open, `answered` and
`response` in the current attempt, `isCorrect` / `score` / `explanation`, `results`).

- **Answer keys** (right or wrong, the select_answer explanation) show only once `final`: the slides
  closed, or the attempt is submitted and nothing can change (no assessment, passed, or out of
  attempts). Results of graded slides of an assessment follow the same rule; other results follow
  `resultsVisibility`.
- **Scoring.** `score` = points of graded slides answered right (no speed share), `maxScore` = the
  points of every graded slide, `percentage` = round(score / maxScore × 100) (null without graded
  slides), `passed` = percentage ≥ pass mark (null without an assessment).
- **Results** count every attempt's answers: the distribution and its `answeredCount` are the
  responses of all attempts (as `slideStats` after the end).

### Host view

`GET /:id/host/state` adds `audience: HostAudienceView` for audience-paced sessions: the window and
settings, `totalQuestions`, `participantCount`, `startedCount`, `completedCount` (current attempt
submitted), `passedCount` / `failedCount` (latest result), per response slide `answeredCount`
(participants whose **current** attempt answered it) and per participant `attempt`, `answeredCount`,
`submitted`, `lastResult`, `kicked` (Redis dedup sets while live, stored answers once ended). The
host-only `audience:progress {participantId, name, attempt, submitted, percentage, passed}` is
published on every submit and retry; `answer:received` (coalesced) still goes out per answered slide.

### Screens (W4-D)

A room screen on an audience-paced deck gets the progress of the room, never a person: the screen
state's `audience` has the counts without the per-participant rows, results stay out until the slides
closed (never with results `never`), no standings while live, `answer:received` arrives as counts only
(the coalescer marks audience-paced updates `audience: true`) and `audience:progress` not at all. See
[`embeds.md`](./embeds.md) → The screen state.

### Attempts on the answer path

The answer script (v2) takes the participant's attempt state from `psess:{sid}:attempts` (KEYS[15],
`"<n>"` running, `"<n>:done"` submitted, missing = `"1"`) and an expected state in ARGV[18]: after the
dedup check (so replays still answer `replay: true`) and the ended check, a state other than the
expected `"<n>"` replies `{'ATTEMPT', current}` → 409 `ATTEMPT_SUBMITTED` (that attempt was
submitted) or `ATTEMPT_STALE` (another attempt; a client that named no attempt is re-graded once
against the current one). Presenter pace sends an empty expected state: no check. Attempt n ≥ 2
dedups and stores its results in `answered:{slide}:a<n>` / `results:{slide}:a<n>` (attempt 1 keeps
the plain keys), so an offline answer of attempt 1 replays as attempt 1 even after a retry. The
counters (`dist`, `disp`, `feed`) are shared by all attempts. Answers carry `attempt` in Mongo
(unique `{sessionId, slideId, participantId, attempt}`, migration 230); reconciliation walks every
attempt, and a participant's final `score` / `correctCount` are their latest attempt's.

Answer windows (version 5) carry `audience: true`: no auto-reveal, `endsAtMs` is the closing time
(so answers stop at `closesAt` + 750 ms grace, + 15 s with the slide's ticket, before the job runs).

### Closing time and the `audience-autoclose` job

`audience-autoclose` (`live/audienceAutoClose.ts`, every 30 s, one instance per tick) finds live
sessions with `audience.closesAt` ≤ now and no `closedAt` (index `audience_autoclose`, partial on
live sessions with a closing time, migration 230), re-reads each, and closes it like the host
(`closeReason: 'schedule'`; a passing closing time does not count as activity) → `audience:closed`.
The idle-session job leaves an audience-paced session alone before its closing time
(`idleEndReason`), so an assessment can stay open for days.

### Migration 230

`230-audience-pace.ts`: creates `answer_once_per_attempt` (`{sessionId, slideId, participantId,
attempt}`, unique, partial on `sessionId`), then drops migration 030's
`sessionId_1_slideId_1_participantId_1`; creates `audience_autoclose`. Idempotent; old answers have
no `attempt` (null in the index) and count as attempt 1. Deploy with no live session (the answer
window version changes; windows are rebuilt from the session on the next answer anyway).
