import mongoose, { Schema, type Document, type Types } from 'mongoose';
import { env } from '../../common/config/env';
import { MEMBER_STATUSES, WORKSPACE_ROLES, type MemberStatus, type WorkspaceRole } from '../../common/tenancy/roles';

export const MEMBER_SOURCES = ['manual', 'scim', 'sso_jit'] as const;
export type MemberSource = (typeof MEMBER_SOURCES)[number];

export interface IWorkspaceMember extends Document {
  _id: Types.ObjectId;
  workspaceId: Types.ObjectId;
  userId: Types.ObjectId;
  role: WorkspaceRole;
  /** Only `active` members pass workspace context and the policy. */
  status: MemberStatus;
  /** How the membership was created: by hand/invite, SCIM push or SSO just-in-time. */
  source: MemberSource;
  createdAt: Date;
  updatedAt: Date;
}

const workspaceMemberSchema = new Schema<IWorkspaceMember>(
  {
    workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    role: { type: String, enum: WORKSPACE_ROLES, required: true },
    status: { type: String, enum: MEMBER_STATUSES, default: 'active' },
    source: { type: String, enum: MEMBER_SOURCES, default: 'manual' },
  },
  { timestamps: true, autoIndex: !env.isProduction },
);

workspaceMemberSchema.index({ workspaceId: 1, userId: 1 }, { unique: true });
workspaceMemberSchema.index({ userId: 1 });

export const WorkspaceMemberModel = mongoose.model<IWorkspaceMember>('WorkspaceMember', workspaceMemberSchema);
