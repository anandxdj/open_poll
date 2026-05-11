import mongoose, { Document, Schema } from 'mongoose';

export interface IResponseAnswer {
  questionId: mongoose.Types.ObjectId;
  selectedOptionIndex: number;
}

export interface IResponse extends Document {
  pollId: mongoose.Types.ObjectId;
  respondentId?: string;
  answers: IResponseAnswer[];
}

const ResponseAnswerSchema = new Schema<IResponseAnswer>(
  {
    questionId: { type: Schema.Types.ObjectId, required: true },
    selectedOptionIndex: { type: Number, required: true, min: 0 },
  },
  { _id: false },
);

const ResponseSchema = new Schema<IResponse>(
  {
    pollId: { type: Schema.Types.ObjectId, required: true, index: true, ref: 'Poll' },
    respondentId: { type: String, required: false },
    answers: { type: [ResponseAnswerSchema], required: true },
  },
  {
    timestamps: true,
  },
);

export const ResponseModel = mongoose.model<IResponse>('Response', ResponseSchema);
