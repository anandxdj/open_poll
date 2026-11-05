import mongoose, { Schema, Document } from 'mongoose';

/** One submitted attempt of an audience-paced run (W2-F); see `AudienceAttemptResult`. */
export interface IAudienceAttempt {
  number: number;
  submittedAt: Date;
  score: number;
  maxScore: number;
  percentage: number | null;
  correctCount: number;
  answeredCount: number;
  totalQuestions: number;
  passed: boolean | null;
}

/** A participant's progress through an audience-paced session (null until the first submit or retry). */
export interface IAudienceProgress {
  /** The current attempt (Redis `psess:{sid}:attempts` is authoritative while live). */
  attempt: number;
  attempts: IAudienceAttempt[];
}

export interface IPresentationParticipant extends Document {
  presentationId: mongoose.Types.ObjectId;
  /** The session joined. A device joining a later session becomes a new participant there. */
  sessionId: mongoose.Types.ObjectId;
  name: string;
  deviceId: string;
  /** Secret returned only to the joiner; required to submit answers as this participant */
  token: string;
  score: number;
  correctCount: number;
  joinedAt: Date;
  /** Set when the host removed the participant; they cannot answer or rejoin the session. */
  kickedAt: Date | null;
  /** Participant UI language chosen on join, if any. */
  locale: string | null;
  /**
   * Set when the session ended and `score`/`correctCount` were recomputed from the
   * stored answers; from then on the answer write-behind adds nothing (it would count twice).
   */
  scoreFinalAt: Date | null;
  /** Audience pace (W2-F): attempts and their results; null until the participant submits once. */
  audience: IAudienceProgress | null;
}

const AudienceAttemptSchema = new Schema<IAudienceAttempt>(
  {
    number: { type: Number, required: true, min: 1 },
    submittedAt: { type: Date, required: true },
    score: { type: Number, default: 0 },
    maxScore: { type: Number, default: 0 },
    percentage: { type: Number, default: null },
    correctCount: { type: Number, default: 0 },
    answeredCount: { type: Number, default: 0 },
    totalQuestions: { type: Number, default: 0 },
    passed: { type: Boolean, default: null },
  },
  { _id: false }
);

const AudienceProgressSchema = new Schema<IAudienceProgress>(
  {
    attempt: { type: Number, default: 1, min: 1 },
    attempts: { type: [AudienceAttemptSchema], default: [] },
  },
  { _id: false }
);

const PresentationParticipantSchema = new Schema<IPresentationParticipant>({
  presentationId: { type: Schema.Types.ObjectId, ref: 'Presentation', required: true, index: true },
  sessionId: { type: Schema.Types.ObjectId, ref: 'PresentationSession' },
  name: { type: String, required: true, trim: true, maxlength: 30 },
  deviceId: { type: String, required: true },
  token: { type: String, required: true },
  score: { type: Number, default: 0 },
  correctCount: { type: Number, default: 0 },
  joinedAt: { type: Date, default: Date.now },
  kickedAt: { type: Date, default: null },
  locale: { type: String, default: null, maxlength: 10 },
  scoreFinalAt: { type: Date, default: null },
  audience: { type: AudienceProgressSchema, default: null },
});

// One participant per device per session (rejoin returns the same participant).
// Partial: participants stored before sessions get `sessionId` from migration 030.
PresentationParticipantSchema.index(
  { sessionId: 1, deviceId: 1 },
  { unique: true, partialFilterExpression: { sessionId: { $exists: true } } }
);

export const PresentationParticipantModel = mongoose.model<IPresentationParticipant>(
  'PresentationParticipant',
  PresentationParticipantSchema
);
