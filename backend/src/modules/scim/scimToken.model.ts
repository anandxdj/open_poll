import mongoose, { Schema, type Document, type Types } from 'mongoose';
import { env } from '../../common/config/env';

/**
 * A bearer token an identity provider uses to provision one workspace's
 * people over SCIM 2.0 (W3-D). Only the SHA-256 hash is stored; the token is
 * shown once when created.
 */
export interface IScimToken extends Document {
  _id: Types.ObjectId;
  workspaceId: Types.ObjectId;
  label: string;
  tokenHash: string;
  /** `scim_` plus the first characters, to tell tokens apart. */
  prefix: string;
  last4: string;
  createdBy: Types.ObjectId | null;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const scimTokenSchema = new Schema<IScimToken>(
  {
    workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true },
    label: { type: String, required: true, trim: true, maxlength: 80 },
    tokenHash: { type: String, required: true },
    prefix: { type: String, required: true },
    last4: { type: String, required: true },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    lastUsedAt: { type: Date, default: null },
    revokedAt: { type: Date, default: null },
  },
  // Production indexes come from migrations (bun run migrate), not boot.
  { timestamps: true, autoIndex: !env.isProduction },
);

scimTokenSchema.index({ tokenHash: 1 }, { unique: true });
scimTokenSchema.index({ workspaceId: 1, createdAt: -1 });

export const ScimTokenModel = mongoose.model<IScimToken>('ScimToken', scimTokenSchema);
