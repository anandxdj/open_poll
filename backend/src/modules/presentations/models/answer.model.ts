import mongoose, { Schema, Document } from 'mongoose';

export const ANSWER_CHANNELS = ['rest', 'socket', 'offline'] as const;
export type AnswerChannel = (typeof ANSWER_CHANNELS)[number];

export interface IPresentationAnswer extends Document {
  presentationId: mongoose.Types.ObjectId;
  sessionId: mongoose.Types.ObjectId;
  participantId: mongoose.Types.ObjectId;
  /** The slide answered (stable across deck edits). */
  slideId: mongoose.Types.ObjectId;
  /** Position of the slide in the session's deck snapshot; kept for exports. */
  slideIndex: number;
  optionIndex?: number | null;
  text?: string | null;
  /** Structured payload (wordcloud entries / scales ratings / ranking order / registry types) */
  payload?: unknown;
  isCorrect: boolean;
  score: number;
  timeMs: number; // elapsed time from question start to answer (server clock)
  /** Client-generated id for idempotent retries (offline queue, socket + REST fallback). */
  clientAnswerId: string | null;
  via: AnswerChannel;
  createdAt: Date;
  updatedAt: Date;
}

const PresentationAnswerSchema = new Schema<IPresentationAnswer>(
  {
    presentationId: { type: Schema.Types.ObjectId, ref: 'Presentation', required: true, index: true },
    sessionId: { type: Schema.Types.ObjectId, ref: 'PresentationSession' },
    participantId: { type: Schema.Types.ObjectId, ref: 'PresentationParticipant', required: true },
    slideId: { type: Schema.Types.ObjectId },
    slideIndex: { type: Number, required: true },
    optionIndex: { type: Number, default: null },
    text: { type: String, default: null },
    payload: { type: Schema.Types.Mixed, default: null },
    isCorrect: { type: Boolean, required: true },
    score: { type: Number, required: true },
    timeMs: { type: Number, required: true },
    clientAnswerId: { type: String, default: null, maxlength: 64 },
    via: { type: String, enum: ANSWER_CHANNELS, default: 'rest' },
  },
  { timestamps: true }
);

// Hard guarantee against double answers. Partial: answers stored before
// sessions get `sessionId`/`slideId` from migration 030.
PresentationAnswerSchema.index(
  { sessionId: 1, slideId: 1, participantId: 1 },
  { unique: true, partialFilterExpression: { sessionId: { $exists: true } } }
);
PresentationAnswerSchema.index({ sessionId: 1, slideId: 1 });

export const PresentationAnswerModel = mongoose.model<IPresentationAnswer>('PresentationAnswer', PresentationAnswerSchema);
