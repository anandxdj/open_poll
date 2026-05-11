import mongoose, { Schema, Document } from 'mongoose';

// Interface for type safety in TypeScript
export interface IQuestion {
  _id?: mongoose.Types.ObjectId;
  text: string;
  options: string[];
  isMandatory: boolean;
}

export interface IPoll extends Document {
  creatorId: string; // Mocked for now, will be User ID later
  title: string;
  isAnonymous: boolean;
  expiresAt: Date;
  isPublished: boolean;
  isClosed: boolean;
  closedAt?: Date | null;
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
  isMandatory: { type: Boolean, default: true }
});

// Core Poll Schema
const PollSchema = new Schema<IPoll>({
  creatorId: { type: String, required: true },
  title: { type: String, required: true },
  isAnonymous: { type: Boolean, default: true },
  expiresAt: { type: Date, required: true },
  isPublished: { type: Boolean, default: false },
  isClosed: { type: Boolean, default: false },
  closedAt: { type: Date, default: null },
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

export const PollModel = mongoose.model<IPoll>('Poll', PollSchema);