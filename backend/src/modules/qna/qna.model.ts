import mongoose, { Schema, type Document, type Types } from 'mongoose';
import { env } from '../../common/config/env';
import { QNA_STATUSES, QNA_TEXT_MAX, type QnaStatus } from './qna.contract';

/**
 * A participant's question in one live session. Questions stay after the
 * session ends (session reports, W2-C); they are never moved to another session.
 */
export interface IQnaQuestion extends Document {
  _id: Types.ObjectId;
  presentationId: Types.ObjectId;
  /** The deck's workspace when asked; null for decks created before workspaces. */
  workspaceId: Types.ObjectId | null;
  sessionId: Types.ObjectId;
  /** The Q&A slide on screen when asked; null when asked through the Q&A tab. */
  slideId: Types.ObjectId | null;
  participantId: Types.ObjectId;
  /** The participant's nickname; null for anonymous questions. */
  authorName: string | null;
  anonymous: boolean;
  text: string;
  status: QnaStatus;
  pinned: boolean;
  /** Atomic counter, moved only together with a QnaUpvote insert/delete. */
  upvoteCount: number;
  answeredAt: Date | null;
  /** Set on the session's highlighted question (at most one per session). */
  highlightedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const qnaQuestionSchema = new Schema<IQnaQuestion>(
  {
    presentationId: { type: Schema.Types.ObjectId, ref: 'Presentation', required: true },
    workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', default: null },
    sessionId: { type: Schema.Types.ObjectId, ref: 'PresentationSession', required: true },
    slideId: { type: Schema.Types.ObjectId, default: null },
    participantId: { type: Schema.Types.ObjectId, ref: 'PresentationParticipant', required: true },
    authorName: { type: String, default: null, maxlength: 30 },
    anonymous: { type: Boolean, default: false },
    text: { type: String, required: true, trim: true, maxlength: QNA_TEXT_MAX },
    status: { type: String, enum: QNA_STATUSES, required: true },
    pinned: { type: Boolean, default: false },
    upvoteCount: { type: Number, default: 0 },
    answeredAt: { type: Date, default: null },
    highlightedAt: { type: Date, default: null },
  },
  { timestamps: true, autoIndex: !env.isProduction },
);

// Lists by status, most upvoted first (participant and host lists).
qnaQuestionSchema.index({ sessionId: 1, status: 1, upvoteCount: -1 });
// A participant's own questions (pending ones are listed only to their author).
qnaQuestionSchema.index({ sessionId: 1, participantId: 1 });

export const QnaQuestionModel = mongoose.model<IQnaQuestion>('QnaQuestion', qnaQuestionSchema);

/** One participant's upvote on one question. The unique index is the dedup. */
export interface IQnaUpvote extends Document {
  _id: Types.ObjectId;
  questionId: Types.ObjectId;
  participantId: Types.ObjectId;
  sessionId: Types.ObjectId;
  presentationId: Types.ObjectId;
  workspaceId: Types.ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
}

const qnaUpvoteSchema = new Schema<IQnaUpvote>(
  {
    questionId: { type: Schema.Types.ObjectId, ref: 'QnaQuestion', required: true },
    participantId: { type: Schema.Types.ObjectId, ref: 'PresentationParticipant', required: true },
    sessionId: { type: Schema.Types.ObjectId, ref: 'PresentationSession', required: true },
    presentationId: { type: Schema.Types.ObjectId, ref: 'Presentation', required: true },
    workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', default: null },
  },
  { timestamps: true, autoIndex: !env.isProduction },
);

qnaUpvoteSchema.index({ questionId: 1, participantId: 1 }, { unique: true });
// "Which of these did I upvote" for a participant's list.
qnaUpvoteSchema.index({ sessionId: 1, participantId: 1 });

export const QnaUpvoteModel = mongoose.model<IQnaUpvote>('QnaUpvote', qnaUpvoteSchema);
