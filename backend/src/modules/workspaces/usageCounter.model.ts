import mongoose, { Schema, type Document, type Types } from 'mongoose';
import { env } from '../../common/config/env';
import { USAGE_COUNTERS, type UsageCounterName } from '../../common/plans/plans';

/**
 * Durable mirror of the Redis monthly usage counters (common/plans/usage.ts):
 * restores a counter Redis lost and keeps counting while Redis is down.
 */
export interface IUsageCounter extends Document {
  workspaceId: Types.ObjectId;
  /** UTC calendar month, yyyymm. */
  period: string;
  counter: UsageCounterName;
  value: number;
  createdAt: Date;
  updatedAt: Date;
}

const usageCounterSchema = new Schema<IUsageCounter>(
  {
    workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true },
    period: { type: String, required: true, match: /^\d{6}$/ },
    counter: { type: String, enum: Object.keys(USAGE_COUNTERS), required: true },
    value: { type: Number, default: 0 },
  },
  { timestamps: true, autoIndex: !env.isProduction },
);

usageCounterSchema.index({ workspaceId: 1, period: 1, counter: 1 }, { unique: true });

export const UsageCounterModel = mongoose.model<IUsageCounter>('UsageCounter', usageCounterSchema);
