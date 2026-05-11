import mongoose, { Document, Schema } from 'mongoose';

export interface IAnalyticsQuestionSummary {
  questionId: mongoose.Types.ObjectId;
  counts: number[];
}

export interface IAnalytics extends Document {
  pollId: mongoose.Types.ObjectId;
  totalResponses: number;
  questionSummaries: IAnalyticsQuestionSummary[];
}

const AnalyticsQuestionSummarySchema = new Schema<IAnalyticsQuestionSummary>(
  {
    questionId: { type: Schema.Types.ObjectId, required: true },
    counts: { type: [Number], required: true, default: [] },
  },
  { _id: false },
);

const AnalyticsSchema = new Schema<IAnalytics>(
  {
    pollId: { type: Schema.Types.ObjectId, required: true, unique: true, index: true, ref: 'Poll' },
    totalResponses: { type: Number, required: true, default: 0 },
    questionSummaries: { type: [AnalyticsQuestionSummarySchema], required: true, default: [] },
  },
  { timestamps: true },
);

export const AnalyticsModel = mongoose.model<IAnalytics>('Analytics', AnalyticsSchema);
