import mongoose, { Schema, Document } from 'mongoose';

export interface IPresentationAnswer extends Document {
  presentationId: mongoose.Types.ObjectId;
  participantId: mongoose.Types.ObjectId;
  slideIndex: number;
  optionIndex?: number | null;
  text?: string | null;
  /** Structured payload (wordcloud entries / scales ratings / ranking order / registry types) */
  payload?: unknown;
  isCorrect: boolean;
  score: number;
  timeMs: number; // elapsed time from question start to answer (server clock)
}

const PresentationAnswerSchema = new Schema<IPresentationAnswer>(
  {
    presentationId: { type: Schema.Types.ObjectId, ref: 'Presentation', required: true, index: true },
    participantId: { type: Schema.Types.ObjectId, ref: 'PresentationParticipant', required: true },
    slideIndex: { type: Number, required: true },
    optionIndex: { type: Number, default: null },
    text: { type: String, default: null },
    payload: { type: Schema.Types.Mixed, default: null },
    isCorrect: { type: Boolean, required: true },
    score: { type: Number, required: true },
    timeMs: { type: Number, required: true },
  },
  { timestamps: true }
);

// Hard guarantee against double answers
PresentationAnswerSchema.index({ presentationId: 1, slideIndex: 1, participantId: 1 }, { unique: true });

export const PresentationAnswerModel = mongoose.model<IPresentationAnswer>('PresentationAnswer', PresentationAnswerSchema);
