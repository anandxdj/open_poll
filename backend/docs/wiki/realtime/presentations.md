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
- **host** — the user must own the deck (`PresentationService.isOwner`). The user comes from
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

| Type | Audience | Payload |
| --- | --- | --- |
| `lobby:opened` | all | `{ joinCode }` |
| `participant:joined` | all | `{ participantId, name, participantCount }` |
| `question:started` | all | `{ slide (sanitized, no answer keys), startedAt, endsAt, serverNow }` |
| `answer:received` | **host only** (forced) | per answer `{ slideIndex, answeredCount }`; every 2s from `liveDistribution.worker.ts` while answers arrive `{ slideIndex, answeredCount, participantCount, distribution }` |
| `question:revealed` | all | `{ slideIndex, question, type, scored, distribution, answeredCount, participantCount, isLastSlide, auto }` |
| `leaderboard:shown` | all | `{ slideIndex, leaderboard[], participantCount, isLastSlide }` |
| `quiz:ended` | all | `{ leaderboard[], participantCount }` |

`distribution.kind`: `options` (select) | `text` (type) | `words` (wordcloud) | `responses`
(open_ended) | `scales` (per-statement averages) | `ranking` (Borda items + voters).

`answer:received` carries the live distribution before reveal, so it never reaches a participant
room on either protocol, whatever audience a publisher asks for.

## Publishing

Services publish through `publishPresentationEvent(presentationId, type, payload)`
(`presentations.service.ts`), which calls `publishLiveEvent` — never `io.emit` from a service.
