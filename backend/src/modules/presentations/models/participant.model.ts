import mongoose, { Schema, Document } from 'mongoose';

export interface IPresentationParticipant extends Document {
  presentationId: mongoose.Types.ObjectId;
  name: string;
  deviceId: string;
  /** Secret returned only to the joiner; required to submit answers as this participant */
  token: string;
  score: number;
  correctCount: number;
  joinedAt: Date;
}

const PresentationParticipantSchema = new Schema<IPresentationParticipant>({
  presentationId: { type: Schema.Types.ObjectId, ref: 'Presentation', required: true, index: true },
  name: { type: String, required: true, trim: true, maxlength: 30 },
  deviceId: { type: String, required: true },
  token: { type: String, required: true },
  score: { type: Number, default: 0 },
  correctCount: { type: Number, default: 0 },
  joinedAt: { type: Date, default: Date.now },
});

// One participant per device per presentation (rejoin returns the same participant)
PresentationParticipantSchema.index({ presentationId: 1, deviceId: 1 }, { unique: true });

export const PresentationParticipantModel = mongoose.model<IPresentationParticipant>(
  'PresentationParticipant',
  PresentationParticipantSchema
);
