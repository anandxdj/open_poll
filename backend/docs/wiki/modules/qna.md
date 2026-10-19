---
summary: Audience Q&A (questions, upvotes, moderation, highlight, the qna board slide) and emoji reactions — API, settings, events, Redis keys, limits, tests.
status: active
last_updated: 2026-10-19
---

# Q&A and reactions (`src/modules/{qna,reactions}/`)

Participants of a live session ask questions, upvote each other's, and send emoji reactions; the
host moderates, answers, pins and puts one question on the stage. Both features ride the live
session of [`presentations-live.md`](./presentations-live.md): questions belong to a session
(`sessionId`) and stay in Mongo after it ends, for session reports. Event contract:
[`../realtime/qna.md`](../realtime/qna.md).

| File | Owns |
| --- | --- |
| `qna/qna.route.ts` | Participant router (`/api/presentations/:presentationId/qna`) and `qnaHostRouter` (`…/host/qna`); mounted by `http/routes.ts`. |
| `qna/participantAuth.ts` | `participantAuth()` — identity from the participant token headers; `participantKey` for per-participant rate limits. |
| `qna/qna.service.ts` | All rules: session context, `settingsView`, ask / list / upvote, host list / update / highlight, event publishing. |
| `qna/qna.model.ts` | `QnaQuestion` (`qnaquestions`), `QnaUpvote` (`qnaupvotes`). |
| `qna/qna.contract.ts` | Wire types, statuses, error codes. The frontend mirrors it in `features/qna/types.ts`. |
| `qna/qna.schema.ts`, `qna.controller.ts`, `qna.keys.ts`, `profanity.ts` | Zod schemas, thin handlers, Redis keys, word-list mask. |
| `qna/coalescer.ts` | Cross-instance coalescing (`setCoalescer` for `qna:votes`, `hashCoalescer` for `reaction:burst`). |
| `reactions/reactions.service.ts`, `reactions.socket.ts` | `reaction:send` handler and limits. |
| `presentations/slides/types/qna.ts` | The `qna` slide type (`board` lifecycle). |
| `migrations/050-qna.ts` | `syncIndexes()` for both collections (production runs with autoIndex off). |

## Participant identity

Participant routes take the credentials `POST /:id/join` returned as **headers**, not body or
query: `X-Participant-Id` and `X-Participant-Token` (`participantAuth`, which calls
`verifyParticipant` like the answer path). Missing → 401 `PARTICIPANT_REQUIRED`; wrong token → 401;
unknown participant, or one of another deck → 404; kicked → 403 `PARTICIPANT_KICKED`. Bodies are
strict Zod objects, so a smuggled `participantId`, `authorName`, `status` or `sessionId` is a 400.
The author, session and workspace of a question come from the token and the session only.

Credentials of an earlier run belong to an ended session: reads still work (they show that run's
questions, `qna.open: false`), writes answer 409 `PARTICIPANT_STALE`.

## Participant API

| Route | Limit (per participant) | Behavior |
| --- | --- | --- |
| `GET /api/presentations/:id/qna` | 120 / min | `{sessionId, qna, reactions, highlightedId, questions}`: visible and answered questions plus the caller's **own pending** ones (≤300, pinned first, then most upvoted, then newest). Each entry has `mine` and `upvoted`. |
| `POST /api/presentations/:id/qna` `{text, anonymous?}` | 5 / min | 201 with the question. Text is trimmed, whitespace collapsed, 1–280 chars, profanity masked (`*` per letter). `anonymous: true` hides the name everywhere. |
| `POST /api/presentations/:id/qna/:qid/upvote` | 60 / min | One upvote per participant (a repeat is a no-op reporting the state). → `{questionId, upvoted, upvoteCount}`. |
| `DELETE /api/presentations/:id/qna/:qid/upvote` | 60 / min | Removes the caller's upvote (no-op when none). |

Every route also passes a coarse per-IP budget (2000 / min, classroom NAT) before the token is
checked, so token guessing stays bounded; the real limits are per participant, so one noisy phone
cannot spend a whole room's budget (a 6th ask in a minute is 429, while another participant on the
same IP still asks).

**Upvote rules.** Only `visible` and `answered` questions can be voted (409 `QNA_NOT_VISIBLE`
otherwise). **A participant cannot upvote their own question** (403 `QNA_OWN_QUESTION`). Upvotes off
for the deck → 403 `QNA_UPVOTES_DISABLED`. Dedup is the unique index `{questionId, participantId}`
on `qnaupvotes`; the question's `upvoteCount` moves (`$inc ±1`) only when an upvote document was
actually inserted or deleted, so 20 simultaneous clicks count once and 30 voters count 30. A repeat
or lost race reports the number of upvote documents, which the counter converges to. If a process
dies between the insert and the `$inc` the counter drifts by one; the documents stay the truth.

## Host API

`authenticate()` → `workspaceContext()` → `deck:host` on the deck (`authorizeDeck`); 600 / min per
user. Participant tokens are not accounts: 401. A deck of another user or workspace is 403.

| Route | Behavior |
| --- | --- |
| `GET /api/presentations/:id/host/qna?status=` | `{sessionId, qna, highlightedId, questions}` for the live session, else the latest (ended) one; `sessionId: null` when the deck never ran. `status` = one status or `all` (default); anything else 400. ≤500 per call, pinned first, then most upvoted, then newest. Entries add `participantId` (null for anonymous questions) and `highlighted`. |
| `PATCH /api/presentations/:id/host/qna/:qid` `{status?, pinned?}` | `status` ∈ `visible` (approve / restore), `answered`, `archived`, `rejected`; at least one field. `answered` sets `answeredAt`, any other status clears it. A status that participants cannot see also clears a highlight. |
| `POST /api/presentations/:id/host/qna/:qid/highlight` `{highlighted?}` | Default `true`: puts the question on the stage (409 `QNA_NOT_VISIBLE` unless visible/answered); at most one highlighted question per session. `{highlighted: false}` takes it down. |

## Statuses and moderation

`pending` → `visible` ⇄ `answered`; the host can also `archive` or `reject`. With
`settings.qna.moderation` on, a new question is `pending`: only the host (`GET /host/qna`, the
host-only `qna:question`) and its author (own list) see it; approving it (`status: 'visible'`)
makes it public. With moderation off, a new question is `visible` at once. `pending` cannot be set
by the host. Rejecting or archiving a question participants never saw is only told to the host and
the author; one they saw is told to everyone.

## Settings semantics

Deck settings `settings.qna` `{enabled, moderation, anonymousAllowed, upvotes}` and
`settings.reactions` `{enabled, emojis ≤ 6}` are read from the **session's `settingsSnapshot`**
(frozen when the lobby opens; sessions that predate snapshots read the deck). Changing them in the
builder applies to the next session, not the running one.

| Setting | Effect |
| --- | --- |
| `qna.enabled` off | Asking and upvoting → 403 `QNA_DISABLED` — **unless a `qna` slide is on screen** (the board opens Q&A for as long as it is shown). Reading still works. |
| `qna.anonymousAllowed` off | `anonymous: true` → 403 `QNA_ANONYMOUS_DISABLED`. |
| `qna.upvotes` off | Upvote routes → 403 `QNA_UPVOTES_DISABLED`. |
| `reactions.enabled` / `emojis` | The allow-list for `reaction:send`; defaults `👍 ❤️ 😂 😮 👏`. |

`qna` in the participant and host responses is `{enabled, moderation, anonymousAllowed, upvotes,
open, onBoard, hasBoard}`: `open` = the session is live and (`enabled` or `onBoard`); `onBoard` = a
Q&A slide is on screen now; `hasBoard` = the session's deck has a Q&A slide (so a client can show a
Q&A tab even while `open` is false).

## The `qna` slide

`slides/types/qna.ts`: kind `interactive`, lifecycle **`board`**, never scored. The host moves to it
like a content slide (`slide:shown`, no answer window, no timer); the schema forces `timeLimit: 0`,
`points: 0`, `scoreDependsOnTime: false` and `question` (the board's optional heading, ≤500 chars)
defaults to `''`. While it is the session's current slide, participants may ask even when
`qna.enabled` is off; questions asked then carry its `slideId`.

## Reactions

Client → server (participant): `reaction:send {presentationId, participantId, participantToken,
emoji}` with an ack `{ok: true}` or `{ok: false, error}`; errors: `INVALID_PAYLOAD`,
`RATE_LIMITED`, `FORBIDDEN` (bad token, or a participant of another deck), `SESSION_ENDED`,
`DISABLED`, `EMOJI_NOT_ALLOWED`, `UNAVAILABLE`. The emoji must be in the session's allow-list.

Limits: **5 / s per socket** (in memory, checked right after the payload shape, before any I/O) and
**300 / s per session** (a fixed-window counter `INCR`ed in the same Lua script as the count, so a
refused reaction records nothing). The participant token is verified on the first send and cached
for 30 s per socket (a kicked participant can react for up to 30 s more); a session's settings are
cached for 2 s per instance.

Delivery: counts go to a per-session Redis hash; the first send of a window takes the lock and
schedules one flush after 500 ms; the flush drains hash and lock atomically and publishes
`reaction:burst {counts: {emoji: n}}` to the **host room** (the host console and, through it,
audience screens). Participants never receive bursts.

## Redis keys

Hash-tagged by session id so one session's keys share a Cluster slot; all expire 6 h after their
last write.

| Key | Type | Use |
| --- | --- | --- |
| `qna:{<sid>}:votes:dirty` | SET | Question ids whose upvote count changed since the last `qna:votes`. |
| `qna:{<sid>}:votes:lock` | STRING `NX PX 500` | Held while a `qna:votes` flush is scheduled. |
| `reactions:{<sid>}:pending` | HASH | emoji → count since the last burst. |
| `reactions:{<sid>}:lock` | STRING `NX PX 500` | Held while a burst flush is scheduled. |
| `reactions:{<sid>}:rate` | STRING | One-second window counter for the 300 / s cap. |

**Coalescing** (`qna/coalescer.ts`): a change is recorded and, if `SET lock NX PX 500` succeeded,
that instance schedules the one flush for the window. The flush drains the data and the lock in one
script, so a change landing after it takes the lock again (next window) or was included — never
lost. If the scheduling instance dies, the lock expires and the next change on any instance
schedules a flush. `qna:votes` reads the counts from Mongo when it fires.

## Data

`qnaquestions`: `presentationId, workspaceId, sessionId, slideId|null, participantId, authorName|null,
anonymous, text ≤ 280, status, pinned, upvoteCount, answeredAt, highlightedAt`; indexes
`{sessionId, status, upvoteCount: -1}`, `{sessionId, participantId}`. `qnaupvotes`: `questionId,
participantId, sessionId, presentationId, workspaceId`; unique `{questionId, participantId}`,
`{sessionId, participantId}`. Public views never include `participantId`; anonymous questions have
no name anywhere, including the host list.

## Tests

- Unit: `tests/qna.{profanity,schema,views,coalescer,registry}.test.ts`, `tests/reactions.limits.test.ts`.
- Integration (`tests/integration/qna.test.ts`, real Mongo + Redis + sockets, two server instances
  for coalescing): token identity, moderation flow, board lifecycle, anonymity, upvote atomicity,
  `qna:votes` and `reaction:burst` coalescing, host policy across workspaces, per-participant rate
  limit, persistence after the session, reaction limits.
