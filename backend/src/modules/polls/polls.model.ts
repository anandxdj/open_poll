import mongoose, { Schema, Document } from 'mongoose';

// Interface for type safety in TypeScript
export interface IQuestion {
  _id?: mongoose.Types.ObjectId;
  text: string;
  options: string[];
  type?: 'single' | 'multiple';
  correctOptionIndices?: number[];
  explanation?: string;
  points?: number;
  isMandatory: boolean;
}

export interface IPoll extends Document {
  creatorId: string; // Mocked for now, will be User ID later
  /** Owning workspace. Missing on polls created before migration 020 (policy falls back to creatorId). */
  workspaceId?: mongoose.Types.ObjectId | null;
  title: string;
  pollType: 'POLL' | 'TRIAL';
  passingScorePercentage: number;
  isAnonymous: boolean;
  expiresAt: Date;
  isPublished: boolean;
  isClosed: boolean;
  closedAt?: Date | null;
  isResultsPublished: boolean;
  resultsPublishedAt?: Date | null;
  questions: IQuestion[];
}

// Embedded Question Schema
const QuestionSchema = new Schema<IQuestion>({
  text: { type: String, required: true },
  options: { 
    type: [String], 
    required: true, 
    validate: {
      validator: (v: string[]) => v.length >= 2,
      message: "A question must have at least 2 options."
    }
  },
  type: { type: String, enum: ['single', 'multiple'], default: 'single' },
  correctOptionIndices: { type: [Number], default: [] },
  explanation: { type: String, default: '' },
  points: { type: Number, default: 1 },
  isMandatory: { type: Boolean, default: true }
});

// Core Poll Schema
const PollSchema = new Schema<IPoll>({
  creatorId: { type: String, required: true },
  workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace' },
  title: { type: String, required: true },
  pollType: { type: String, enum: ['POLL', 'TRIAL'], default: 'POLL' },
  passingScorePercentage: { type: Number, default: 70 },
  isAnonymous: { type: Boolean, default: true },
  expiresAt: { type: Date, required: true },
  isPublished: { type: Boolean, default: false },
  isClosed: { type: Boolean, default: false },
  closedAt: { type: Date, default: null },
  isResultsPublished: { type: Boolean, default: false },
  resultsPublishedAt: { type: Date, default: null },
  questions: { 
    type: [QuestionSchema], 
    required: true, 
    validate: {
      validator: (v: IQuestion[]) => v.length > 0,
      message: "A poll must contain at least one question."
    }
  }
}, {
  timestamps: true // Automatically adds createdAt and updatedAt
});

// Workspace poll list, newest first. Production gets it from migration 020.
PollSchema.index({ workspaceId: 1, createdAt: -1 });

export const PollModel = mongoose.model<IPoll>('Poll', PollSchema);