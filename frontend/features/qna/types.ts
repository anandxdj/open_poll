// Wire types of the Q&A API and its live events. Mirrors
// backend/src/modules/qna/qna.contract.ts; contract doc:
// backend/docs/wiki/modules/qna.md.

export const QNA_STATUSES = ["pending", "visible", "answered", "archived", "rejected"] as const;
export type QnaStatus = (typeof QNA_STATUSES)[number];

/** Statuses every participant sees. */
export const isPublicStatus = (status: QnaStatus) => status === "visible" || status === "answered";

export const QNA_TEXT_MAX = 280;

/** One question as participants and the stage see it (never the author's id). */
export interface QnaQuestionView {
  id: string;
  sessionId: string;
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

export interface QnaParticipantQuestion extends QnaQuestionView {
  mine: boolean;
  upvoted: boolean;
}

/** `participantId` is null for anonymous questions. */
export interface QnaHostQuestion extends QnaQuestionView {
  participantId: string | null;
  highlighted: boolean;
}

export interface QnaSettingsView {
  enabled: boolean;
  moderation: boolean;
  anonymousAllowed: boolean;
  upvotes: boolean;
  /** Participants may ask now. */
  open: boolean;
  /** A Q&A slide is on screen. */
  onBoard: boolean;
  /** The session's deck has a Q&A slide. */
  hasBoard: boolean;
}

export interface ReactionSettingsView {
  enabled: boolean;
  emojis: string[];
}

export interface QnaParticipantListResponse {
  sessionId: string;
  qna: QnaSettingsView;
  reactions: ReactionSettingsView;
  highlightedId: string | null;
  questions: QnaParticipantQuestion[];
}

export interface QnaHostListResponse {
  sessionId: string | null;
  qna: QnaSettingsView;
  highlightedId: string | null;
  questions: QnaHostQuestion[];
}

export interface QnaUpvoteResponse {
  questionId: string;
  upvoted: boolean;
  upvoteCount: number;
}

/** Payloads of the `qna:*` live events. */
export interface QnaEventPayloads {
  "qna:question": { question: QnaQuestionView };
  "qna:updated": { question: QnaQuestionView };
  "qna:votes": { votes: { id: string; upvoteCount: number }[] };
  "qna:highlight": { question: QnaQuestionView | null };
}

/** Acks of the `reaction:send` socket event. */
export type ReactionError =
  | "INVALID_PAYLOAD"
  | "RATE_LIMITED"
  | "FORBIDDEN"
  | "SESSION_ENDED"
  | "DISABLED"
  | "EMOJI_NOT_ALLOWED"
  | "UNAVAILABLE";

export type ReactionAck = { ok: true } | { ok: false; error: ReactionError };
