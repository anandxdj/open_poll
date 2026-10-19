---
summary: Live deck socket contract — join/leave events, rooms per role, event types, audiences and payloads.
status: active
last_updated: 2026-10-19
---

# Presentations realtime

Handlers: `backend/src/modules/presentations/presentations.socket.ts`. Event types:
`backend/src/common/realtime/events/presentation.ts`. Envelope, seq and delivery rules:
[`envelope.md`](./envelope.md).

The live-deck entity is `presentations`. The `quiz:*` names are the wire protocol kept from before
the quizzes module was folded in; `quizId` carries the presentation id.

## Client → server

| Event | Payload | Joins | Reply |
| --- | --- | --- | --- |
| `quiz:join` (legacy) | `{ quizId, role: 'host', accessToken? }` or `{ quizId, role: 'participant', participantId, participantToken }` | legacy **and** live rooms | none — unauthorized joins are silently dropped |
| `quiz:leave` (legacy) | `quizId` | leaves every room of that presentation | none |
| `live:join` | `{ presentationId, role: 'host', accessToken? }` or `{ presentationId, role: 'participant', participantId, participantToken }` | live rooms only | ack `{ ok: true, role }` or `{ ok: false, error: 'INVALID_PAYLOAD' \| 'RATE_LIMITED' \| 'UNAUTHENTICATED' \| 'FORBIDDEN' }` |
| `live:leave` | `{ presentationId }` (or the bare id) | leaves every room of that presentation | ack `{ ok }` |

Authorization (same for both protocols):
- **host** — the user needs `deck:host` on the deck (`PresentationService.canHost`: its creator, or an active member of the deck's workspace whose role allows hosting). The user comes from
  `accessToken` when sent (it must be valid), otherwise from the handshake token
  (`handshake.auth.token`, see `envelope.md`).
- **participant** — `participantId` + `participantToken` issued by `POST /:id/join`
  (`PresentationService.isAuthorizedParticipant`).

All joins count against the 30-per-minute per-connection budget.

## Rooms

| Role | Live rooms | Legacy rooms (`quiz:join` only) |
| --- | --- | --- |
| host | `live:{pid}`, `live:{pid}:host` | `quiz_{pid}`, `quiz_{pid}_host` |
| participant | `live:{pid}`, `live:{pid}:p:{participantId}` | `quiz_{pid}` |

## Server → client

- `live:event` — the v1 envelope, to the `live:*` room of its audience.
- `quiz:event` (legacy) — the same envelope, to `quiz_{pid}` (`all`) or `quiz_{pid}_host` (`host`).
  Participant-targeted events have no legacy copy. Current clients read `quizId`, `type`, `payload`
  and `emittedAt`, which are unchanged; the extra fields are ignored.

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
| `question:started` | all | `{ slideId, slideIndex, slide (sanitized, no answer keys), startedAt, endsAt (null = untimed), serverNow, isLastSlide, reopened }` |
| `slide:shown` | all | `{ slideId, slideIndex, slide (sanitized content slide), isLastSlide, serverNow }`; content slides open no answer window |
| `slide:closed` | all | `{ slideId, slideIndex, slide, closedAt, answeredCount, participantCount, isLastSlide, revisit, serverNow }` — answers stopped, results not revealed |
| `answer:received` | **host only** (forced) | per answer `{ slideId, slideIndex, answeredCount }`; every 2s from `liveDistribution.worker.ts` while answers arrive `{ slideId, slideIndex, answeredCount, participantCount, distribution }` |
| `question:revealed` | all | `{ slideId, slideIndex, slide, question, type, scored, distribution, answeredCount, participantCount, isLastSlide, auto, revealedAt, revisit }` |
| `leaderboard:shown` | all | `{ slideId, slideIndex, slide, leaderboard[], participantCount, isLastSlide }` |
| `session:ended` | all | `{ runNumber, endedAt, leaderboard[] (≤100), participantCount, answerCount }` |
| `quiz:ended` | all | `{ leaderboard[], participantCount }` — legacy copy of `session:ended` |

`distribution.kind`: `options` (select) | `text` (type) | `words` (wordcloud) | `responses`
(open_ended) | `scales` (per-statement averages) | `ranking` (Borda items + voters).

`answer:received` carries the live distribution before reveal, so it never reaches a participant
room on either protocol, whatever audience a publisher asks for.

## Other modules' events

`qna:*` and `reaction:burst` (Q&A and reactions) are documented in [`qna.md`](./qna.md).

## Publishing

Services publish through `publishPresentationEvent(presentationId, type, payload)`
(`presentations.service.ts`), which calls `publishLiveEvent` — never `io.emit` from a service.
