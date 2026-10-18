import mongoose, { Schema, type Document, type Types } from 'mongoose';
import { env } from '../../common/config/env';

export const MEDIA_SOURCES = ['upload', 'import', 'ai'] as const;
export type MediaSource = (typeof MEDIA_SOURCES)[number];

/** A stored object in the workspace's media library (common/storage). */
export interface IMediaAsset extends Document {
  _id: Types.ObjectId;
  workspaceId: Types.ObjectId;
  uploaderId?: Types.ObjectId | null;
  /** Object key in the bucket; unique. */
  key: string;
  /** Public/CDN URL the object is served from. */
  url: string;
  mime: string;
  bytes: number;
  source: MediaSource;
  /** Upload purpose (uploads.service UPLOAD_PURPOSES) for uploads; null for import/AI output. */
  purpose?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const mediaAssetSchema = new Schema<IMediaAsset>(
  {
    workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true },
    uploaderId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    key: { type: String, required: true },
    url: { type: String, required: true },
    mime: { type: String, required: true },
    bytes: { type: Number, required: true, min: 0 },
    source: { type: String, enum: MEDIA_SOURCES, required: true },
    purpose: { type: String, default: null },
  },
  { timestamps: true, autoIndex: !env.isProduction },
);

mediaAssetSchema.index({ key: 1 }, { unique: true });
mediaAssetSchema.index({ workspaceId: 1, createdAt: -1 });

export const MediaAssetModel = mongoose.model<IMediaAsset>('MediaAsset', mediaAssetSchema);
