import mongoose, { Schema, Document } from 'mongoose';

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
}

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
