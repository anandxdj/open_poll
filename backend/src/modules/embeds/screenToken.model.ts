import mongoose, { Schema, type Document, type Types } from 'mongoose';
import { env } from '../../common/config/env';

/**
 * A screen token (W4-D): a link a room screen, a web page or an add-in pane
 * uses to show one deck's stage, read-only. It joins the deck's live rooms as
 * the `screen` role and reads a stage-safe state; it can never present, answer
 * or see notes. Only the SHA-256 hash is stored; the token is shown once.
 */
export interface IScreenToken extends Document {
  _id: Types.ObjectId;
  workspaceId: Types.ObjectId | null;
  presentationId: Types.ObjectId;
  label: string;
  tokenHash: string;
  /** `scr_` plus the first characters, to tell tokens apart. */
  prefix: string;
  last4: string;
  createdBy: Types.ObjectId | null;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const screenTokenSchema = new Schema<IScreenToken>(
  {
    // Null only for decks from before workspaces (the policy falls back to their creator).
    workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', default: null },
    presentationId: { type: Schema.Types.ObjectId, ref: 'Presentation', required: true },
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

screenTokenSchema.index({ tokenHash: 1 }, { unique: true });
screenTokenSchema.index({ presentationId: 1, createdAt: -1 });
screenTokenSchema.index({ workspaceId: 1 });

export const ScreenTokenModel = mongoose.model<IScreenToken>('ScreenToken', screenTokenSchema);
