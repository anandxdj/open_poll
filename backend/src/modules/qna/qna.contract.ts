/**
 * Q&A wire contract: HTTP responses and live event payloads. Mirrored by the
 * frontend in `features/qna/types.ts`. Docs: `docs/wiki/modules/qna.md`.
 */

export const QNA_STATUSES = ['pending', 'visible', 'answered', 'archived', 'rejected'] as const;
export type QnaStatus = (typeof QNA_STATUSES)[number];

/** Statuses the host may set (a question is `pending` only until it is moderated). */
export const QNA_HOST_STATUSES = ['visible', 'answered', 'archived', 'rejected'] as const;
export type QnaHostStatus = (typeof QNA_HOST_STATUSES)[number];

/** Statuses every participant sees. */
export const QNA_PUBLIC_STATUSES: readonly QnaStatus[] = ['visible', 'answered'];

export const isPublicStatus = (status: QnaStatus) => QNA_PUBLIC_STATUSES.includes(status);

export const QNA_TEXT_MAX = 280;

/**
 * One question as participants (and the stage) see it. Never carries the
 * author's participant id; `authorName` is null for anonymous questions.
 */
export interface QnaQuestionView {
  id: string;
  sessionId: string;
  /** The Q&A slide on screen when it was asked; null when asked through the Q&A tab. */
  slideId: string | null;
  text: string;
  authorName: string | null;
  anonymous: boolean;
  status: QnaStatus;
  pinned: boolean;
  upvoteCount: number;
  createdAt: string;
  answeredAt: string | null;
}

/** Participant list entry: the view plus the caller's own relation to it. */
export interface QnaParticipantQuestion extends QnaQuestionView {
  /** Asked by the caller (their pending questions are listed too). */
  mine: boolean;
  /** The caller upvoted it. */
  upvoted: boolean;
}

/** Host list entry. `participantId` is withheld for anonymous questions. */
export interface QnaHostQuestion extends QnaQuestionView {
  participantId: string | null;
  highlighted: boolean;
}

/** The deck's Q&A settings for the session, plus whether asking is possible right now. */
export interface QnaSettingsView {
  enabled: boolean;
  moderation: boolean;
  anonymousAllowed: boolean;
  upvotes: boolean;
  /** Participants may ask now: Q&A is enabled, or a Q&A slide is on screen; and the session is live. */
  open: boolean;
  /** A Q&A slide is on screen now (it opens Q&A even when the deck setting is off). */
  onBoard: boolean;
  /** The session's deck has a Q&A slide, so Q&A may open later even when the deck setting is off. */
  hasBoard: boolean;
}

export interface ReactionSettingsView {
  enabled: boolean;
  emojis: string[];
}

/** `GET /api/presentations/:id/qna` */
export interface QnaParticipantListResponse {
  sessionId: string;
  qna: QnaSettingsView;
  reactions: ReactionSettingsView;
  highlightedId: string | null;
  questions: QnaParticipantQuestion[];
}

/** `GET /api/presentations/:id/host/qna` */
export interface QnaHostListResponse {
  /** The live session, else the latest ended one; null when the deck never ran. */
  sessionId: string | null;
  qna: QnaSettingsView;
  highlightedId: string | null;
  questions: QnaHostQuestion[];
}

/** `POST|DELETE /api/presentations/:id/qna/:qid/upvote` */
export interface QnaUpvoteResponse {
  questionId: string;
  upvoted: boolean;
  upvoteCount: number;
}

// ---------- Live event payloads ----------

export interface QnaEventPayloads {
  /** Audience `host` while pending, `all` once visible. */
  'qna:question': { question: QnaQuestionView };
  /** Audience `all` when the question is or was public; else `host` + the author. */
  'qna:updated': { question: QnaQuestionView };
  'qna:votes': { votes: { id: string; upvoteCount: number }[] };
  'qna:highlight': { question: QnaQuestionView | null };
}

// ---------- Error codes ----------

export const QNA_ERROR_CODES = {
  /** 403: Q&A is off for this deck and no Q&A slide is on screen. */
  disabled: 'QNA_DISABLED',
  /** 403: the deck does not allow anonymous questions. */
  anonymousDisabled: 'QNA_ANONYMOUS_DISABLED',
  /** 403: upvotes are off for this deck. */
  upvotesDisabled: 'QNA_UPVOTES_DISABLED',
  /** 403: participants cannot upvote their own question. */
  ownQuestion: 'QNA_OWN_QUESTION',
  /** 409: the question is not visible to participants (pending, rejected, archived). */
  notVisible: 'QNA_NOT_VISIBLE',
  /** 401: missing participant credentials. */
  participantRequired: 'PARTICIPANT_REQUIRED',
} as const;
