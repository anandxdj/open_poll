---
summary: Live events and socket messages of Q&A and reactions — types, audiences, payloads, who receives what.
status: active
last_updated: 2026-10-19
---

# Q&A and reactions realtime

Types: `backend/src/common/realtime/events/{qna,reactions}.ts`; payloads: `QnaEventPayloads` in
`backend/src/modules/qna/qna.contract.ts`. Envelope, seq and delivery: [`envelope.md`](./envelope.md).
Rules and API: [`../modules/qna.md`](../modules/qna.md). Every envelope carries the session's id in
`sessionId`; clients ignore events of other sessions.

## Server → client (`live:event`)

| Type | Audience | Payload | When |
| --- | --- | --- | --- |
| `qna:question` | `host` while the question is `pending`, `all` once visible | `{question}` | A question was asked. The author already has it in the POST response. |
| `qna:updated` | `all` when participants saw the question before or see it now; otherwise `host` + `participant:<author>` | `{question}` | Status, pin or approval changed. A pending question that is rejected or archived reaches only the host and its author. |
| `qna:votes` | `all` | `{votes: [{id, upvoteCount}]}` | Coalesced: at most one per session every 500 ms, across instances; counts are read from Mongo at flush time. |
| `qna:highlight` | `all` | `{question \| null}` | The stage question changed; `null` clears it (also when the highlighted question is archived or rejected). |
| `reaction:burst` | `host` | `{counts: {emoji: n}}` | Coalesced reactions, at most one per session every 500 ms. Never sent to participants. |

`question` is `QnaQuestionView`: `id, sessionId, slideId, text, authorName (null when anonymous),
anonymous, status, pinned, upvoteCount, createdAt, answeredAt` — never the author's participant id.
A pending question is only ever published to `host`; the `participant:<id>` copy of an update is
how its author hears about approval or rejection.

## Client → server

| Event | Role | Payload | Reply |
| --- | --- | --- | --- |
| `reaction:send` | participant (token in the payload) | `{presentationId, participantId, participantToken, emoji}` | ack `{ok: true}` or `{ok: false, error: 'INVALID_PAYLOAD' \| 'RATE_LIMITED' \| 'FORBIDDEN' \| 'SESSION_ENDED' \| 'DISABLED' \| 'EMOJI_NOT_ALLOWED' \| 'UNAVAILABLE'}` |

Limits: 5 per second per socket, 300 per second per session, emoji from the session's allow-list.
Questions are asked over HTTP, not sockets.

## Who sees what

| Receiver | Gets |
| --- | --- |
| Host room | everything above, including `pending` questions and `reaction:burst` |
| Participants (`live:{pid}`) | `qna:question` (visible only), `qna:updated` (public changes), `qna:votes`, `qna:highlight` |
| One participant (`live:{pid}:p:{id}`) | updates about their own question while it is not public (pending → rejected/archived/approved) |
