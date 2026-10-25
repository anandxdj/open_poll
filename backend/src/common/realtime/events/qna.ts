import { defineLiveEvents } from './envelope';

// ---------- Q&A events (modules/qna) ----------
// Payload types: `modules/qna/qna.contract.ts`.

export const QNA_EVENTS = defineLiveEvents({
  // A new question. Defaults to the host room: a question waiting for moderation
  // (`pending`) must not reach participants. Visible questions are published to `all`.
  'qna:question': { audience: 'host' },
  // A question's status or pin changed (approve, reject, answer, archive, pin).
  'qna:updated': { audience: 'all' },
  // Coalesced upvote counts (at most one per session every 500 ms).
  'qna:votes': { audience: 'all' },
  // The question shown over the stage changed (or was cleared).
  'qna:highlight': { audience: 'all' },
});

export type QnaEventType = keyof typeof QNA_EVENTS;
