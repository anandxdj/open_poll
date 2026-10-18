import mongoose, { Schema, type Document, type Types } from 'mongoose';
import { env } from '../../common/config/env';
import { WORKSPACE_ROLES, type WorkspaceRole } from '../../common/tenancy/roles';

/** A pending invitation; only the SHA-256 of the emailed token is stored. Removed by TTL at expiresAt. */
export interface IWorkspaceInvite extends Document {
  _id: Types.ObjectId;
  workspaceId: Types.ObjectId;
  email: string;
  role: WorkspaceRole;
  tokenHash: string;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const workspaceInviteSchema = new Schema<IWorkspaceInvite>(
  {
    workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true },
    email: { type: String, required: true, lowercase: true, trim: true },
    role: { type: String, enum: WORKSPACE_ROLES, required: true },
    tokenHash: { type: String, required: true },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true, autoIndex: !env.isProduction },
);

workspaceInviteSchema.index({ tokenHash: 1 }, { unique: true });
workspaceInviteSchema.index({ workspaceId: 1, email: 1 });
workspaceInviteSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const WorkspaceInviteModel = mongoose.model<IWorkspaceInvite>('WorkspaceInvite', workspaceInviteSchema);
