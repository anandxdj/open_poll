import mongoose, { Schema, type Document, type Types } from 'mongoose';
import { env } from '../../common/config/env';

/**
 * A phone-remote pairing for one deck (W2-A). The token itself is shown once
 * (the presenter view's QR code) and only its SHA-256 is stored. The first
 * device to redeem it binds it (`deviceHash`, the hash of a key the phone
 * generated); any other device is refused from then on. One active pairing per
 * deck: creating a new one revokes the previous. Expired pairings are removed
 * by the TTL index on `expiresAt`.
 */
export interface IRemoteToken extends Document {
  _id: Types.ObjectId;
  presentationId: Types.ObjectId;
  /** The deck's workspace when paired; null for decks without one. */
  workspaceId: Types.ObjectId | null;
  /** The host who paired it: remote commands run as this user (policy `deck:host`, checked each time). */
  createdBy: string;
  tokenHash: string;
  deviceHash: string | null;
  boundAt: Date | null;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const remoteTokenSchema = new Schema<IRemoteToken>(
  {
    presentationId: { type: Schema.Types.ObjectId, ref: 'Presentation', required: true },
    workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', default: null },
    createdBy: { type: String, required: true },
    tokenHash: { type: String, required: true },
    deviceHash: { type: String, default: null },
    boundAt: { type: Date, default: null },
    lastUsedAt: { type: Date, default: null },
    revokedAt: { type: Date, default: null },
    expiresAt: { type: Date, required: true },
  },
  // Production indexes come from migration 040 (syncIndexes), not boot.
  { timestamps: true, autoIndex: !env.isProduction }
);

remoteTokenSchema.index({ tokenHash: 1 }, { unique: true });
remoteTokenSchema.index({ presentationId: 1, revokedAt: 1 });
remoteTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const RemoteTokenModel = mongoose.model<IRemoteToken>('RemoteToken', remoteTokenSchema);
