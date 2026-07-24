import mongoose, { Document, Schema } from 'mongoose';

export interface IResponseAnswer {
  questionId: mongoose.Types.ObjectId;
  selectedOptionIndex?: number;
  selectedOptionIndices?: number[];
}

export interface IResponse extends Document {
  pollId: mongoose.Types.ObjectId;
  respondentId: string;
  answers: IResponseAnswer[];
  attemptNumber: number;
  score?: number;
  maxScore?: number;
  percentage?: number;
  passed?: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const ResponseAnswerSchema = new Schema<IResponseAnswer>(
  {
    questionId: { type: Schema.Types.ObjectId, required: true },
    selectedOptionIndex: { type: Number, required: false },
    selectedOptionIndices: { type: [Number], required: false, default: [] },
  },
  { _id: false },
);

const ResponseSchema = new Schema<IResponse>(
  {
    pollId: { type: Schema.Types.ObjectId, required: true, index: true, ref: 'Poll' },
    respondentId: { type: String, required: true },
    answers: { type: [ResponseAnswerSchema], required: true },
    attemptNumber: { type: Number, default: 1 },
    score: { type: Number, required: false },
    maxScore: { type: Number, required: false },
    percentage: { type: Number, required: false },
    passed: { type: Boolean, required: false },
  },
  {
    timestamps: true,
  },
);

export const ResponseModel = mongoose.model<IResponse>('Response', ResponseSchema);
