import mongoose, { Schema, type Document, type Types } from 'mongoose';
import { env } from '../../common/config/env';

export const EXPORT_STATUSES = ['delivered', 'failed'] as const;
export type ExportStatus = (typeof EXPORT_STATUSES)[number];

/** How long export records are kept (they only count toward the daily limit and show on the privacy page). */
export const EXPORT_RECORD_TTL_SEC = 90 * 24 * 60 * 60;

/**
 * One personal-data export (POST /api/me/export). The archive is built in the
 * request and streamed back, never stored, so `objectKey` and `expiresAt` stay
 * null; they are there for stored archives should exports ever outgrow a
 * request.
 */
export interface IDataExportJob extends Document {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  status: ExportStatus;
  /** Size of the archive sent. */
  bytes: number;
  objectKey: string | null;
  expiresAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const dataExportJobSchema = new Schema<IDataExportJob>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    status: { type: String, enum: EXPORT_STATUSES, required: true },
    bytes: { type: Number, default: 0 },
    objectKey: { type: String, default: null },
    expiresAt: { type: Date, default: null },
  },
  // Production indexes come from migrations (bun run migrate), not boot.
  { timestamps: true, autoIndex: !env.isProduction },
);

dataExportJobSchema.index({ userId: 1, createdAt: -1 });
dataExportJobSchema.index({ createdAt: 1 }, { expireAfterSeconds: EXPORT_RECORD_TTL_SEC });

export const DataExportJobModel = mongoose.model<IDataExportJob>('DataExportJob', dataExportJobSchema);
