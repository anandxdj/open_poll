---
summary: Live deck socket contract — join/leave events, rooms per role, event types, audiences and payloads.
status: active
last_updated: 2026-11-05
---

# Presentations realtime

Handlers: `backend/src/modules/presentations/presentations.socket.ts`. Event types:
`backend/src/common/realtime/events/presentation.ts`. Envelope, seq and delivery rules:
[`envelope.md`](./envelope.md).

The live-deck entity is `presentations`. The legacy `quiz:join` / `quiz:leave` / `quiz:event`
protocol (and its `quiz_*` rooms) was removed in W2-D phase 2; the envelope still carries `quizId`
(= `presentationId`) as an alias. Event *types* keep their historical names (`quiz:ended`).

## Client → server

| Event | Payload | Joins | Reply |
| --- | --- | --- | --- |
| `live:join` | `{ presentationId, role: 'host', accessToken? }` or `{ presentationId, role: 'participant', participantId, participantToken }` | live rooms only | ack `{ ok: true, role }` or `{ ok: false, error: 'INVALID_PAYLOAD' \| 'RATE_LIMITED' \| 'UNAUTHENTICATED' \| 'FORBIDDEN' }` |
| `live:leave` | `{ presentationId }` (or the bare id) | leaves every room of that presentation | ack `{ ok }` |
| `answer:submit` | the `POST /:id/answer` body plus `presentationId` (the socket must have joined as that participant; the participant token inside is the identity) | none | ack with the REST envelope: `{ success, status, message, code?, data: AnswerResult \| null }` |
| `live:resync` | `{ presentationId, role, accessToken? \| participantId + participantToken }` | none | ack `{ ok: true, role, seq, state }` (`ParticipantLiveState` or `HostStateResponse`) or `{ ok: false, error }` |
| `remote:join` | `{ token, deviceKey }` (phone remote, W2-A; `modules/remote/remote.socket.ts`) | `live:{pid}`, `live:{pid}:remote` | ack `{ ok: true, state: RemoteState }` or `{ ok: false, error }` |
| `remote:command` | `{ command: next \| prev \| reveal \| close \| extend30 \| pause \| resume }` (after `remote:join`) | none | ack `{ ok: true, command, state }` or `{ ok: false, error, code?, message? }` |

Authorization:
- **host** — the user needs `deck:host` on the deck (`PresentationService.canHost`: its creator, or an active member of the deck's workspace whose role allows hosting). The user comes from
  `accessToken` when sent (it must be valid), otherwise from the handshake token
  (`handshake.auth.token`, see `envelope.md`).
- **participant** — `participantId` + `participantToken` issued by `POST /:id/join`
  (`PresentationService.isAuthorizedParticipant`).

All joins count against the 30-per-minute per-connection budget. `answer:submit` and `live:resync` have
their own per-connection budgets (120 per 10 s and 20 per minute); `answer:submit` also counts against
the participant's answer budget (30 attempts per 10 s) whatever the channel. Behaviour, errors and the
client retry rule: [`../modules/presentations-live.md`](../modules/presentations-live.md#answer-path).

## Rooms

| Role | Live rooms |
| --- | --- |
| host | `live:{pid}`, `live:{pid}:host` |
| participant | `live:{pid}`, `live:{pid}:p:{participantId}` |
| phone remote | `live:{pid}`, `live:{pid}:remote` |

A removed participant's sockets leave every room of the deck (`presentations:control`
`{kind: 'participant-leave'}`, applied by each instance with `io.local`); a revoked remote's
sockets leave theirs (`remote:control` `{kind: 'revoke'}`) and receive `remote:revoked`.

## Server → client

- `live:event` — the v1 envelope, to the `live:*` room of its audience. (There is no `quiz:event`
  copy any more.)
- `remote:revoked` `{ presentationId }` — to a phone remote's sockets when its pairing is revoked or
  replaced.

## Event types

Every event carries the live session's id in the envelope's `sessionId`; clients ignore events
of other sessions. Payload types: `PresentationEventPayloads` in
`modules/presentations/live/contract.ts`; when each is published:
[`../modules/presentations-live.md`](../modules/presentations-live.md#events).

| Type | Audience | Payload |
| --- | --- | --- |
| `session:lobby` | all | `{ runNumber, joinCode, pace }` — a new session opened its lobby |
| `lobby:opened` | all | `{ joinCode }` — legacy copy of `session:lobby` |
| `participant:joined` | all | `{ participantId, name, participantCount }` |
| `question:started` | all | `{ slideId, slideIndex, slide (sanitized, no answer keys), startedAt, endsAt (null = untimed), serverNow, isLastSlide, reopened, slideTicket }` |
| `slide:shown` | all | `{ slideId, slideIndex, slide (sanitized content slide), isLastSlide, serverNow }`; content slides open no answer window |
| `slide:closed` | all | `{ slideId, slideIndex, slide, closedAt, answeredCount, participantCount, isLastSlide, revisit, serverNow }` — answers stopped, results not revealed |
| `answer:received` | **host only** (forced) | coalesced, at most one per slide per 250 ms window per session: `{ slideId, slideIndex, answeredCount, participantCount, distribution }` (`live/coalescer.ts`; also flushed just before a close, reveal, move or end) |
| `question:revealed` | all | `{ slideId, slideIndex, slide, question, type, scored, distribution, answeredCount, participantCount, isLastSlide, auto, revealedAt, revisit }` |
| `leaderboard:shown` | all | `{ slideId, slideIndex, slide, leaderboard[], participantCount, isLastSlide }` |
| `session:ended` | all | `{ runNumber, endedAt, leaderboard[] (≤100), participantCount, answerCount }` |
| `quiz:ended` | all | `{ leaderboard[], participantCount }` — legacy copy of `session:ended` |
| `slide:timing` | all | `{ slideId, slideIndex, action: pause\|resume\|extend\|skip, startedAt, endsAt (null while paused), pausedRemainingMs, durationMs, addedSeconds, serverNow }` |
| `participant:kicked` | host + `participant:<id>` | `{ participantId, name, participantCount }` — published twice (host room, then the removed participant's room) |
| `remote:connected` / `remote:disconnected` | host | `{ at }` — the paired phone remote's presence (`events/remote.ts`; `sessionId` null) |
| `audience:opened` | all | `{ openedAt, closesAt (null = until closed), serverNow }` — audience pace (W2-F): every response slide open (or the closing time changed) |
| `audience:closed` | all | `{ closedAt, reason: host\|schedule }` — audience pace: no more answers |
| `audience:progress` | **host only** (forced) | `{ participantId, name, attempt, submitted, percentage, passed }` — audience pace: a submit or retry |

`distribution.kind`: `options` (select) | `text` (type) | `words` (wordcloud) | `responses`
(open_ended) | `scales` (per-statement averages) | `ranking` (Borda items + voters).

`answer:received` carries the live distribution before reveal, so it never reaches a participant
room, whatever audience a publisher asks for.

## Other modules' events

`qna:*` and `reaction:burst` (Q&A and reactions) are documented in [`qna.md`](./qna.md).

## Publishing

Services publish through `publishPresentationEvent(presentationId, type, payload)`
(`presentations.service.ts`), which calls `publishLiveEvent` — never `io.emit` from a service.
