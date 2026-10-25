import mongoose, { Schema, type Document, type Types } from 'mongoose';
import { env } from '../../common/config/env';
import { SHARE_ROLES, type ShareRole } from '../../common/tenancy/roles';

// Owner and admin are workspace-wide; a share grants at most editor (roles.ts).
export { SHARE_ROLES, type ShareRole };
export const SHARE_RESOURCE_TYPES = ['presentation', 'folder'] as const;
export type ShareResourceType = (typeof SHARE_RESOURCE_TYPES)[number];
export const SHARE_PRINCIPAL_TYPES = ['user', 'group'] as const;
export type SharePrincipalType = (typeof SHARE_PRINCIPAL_TYPES)[number];

/** Grants one user or group a role on one deck or folder (W3-B1 adds it to the policy). */
export interface IResourceShare extends Document {
  _id: Types.ObjectId;
  workspaceId: Types.ObjectId;
  resourceType: ShareResourceType;
  resourceId: Types.ObjectId;
  principalType: SharePrincipalType;
  principalId: Types.ObjectId;
  role: ShareRole;
  createdAt: Date;
  updatedAt: Date;
}

const resourceShareSchema = new Schema<IResourceShare>(
  {
    workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true },
    resourceType: { type: String, enum: SHARE_RESOURCE_TYPES, required: true },
    resourceId: { type: Schema.Types.ObjectId, required: true },
    principalType: { type: String, enum: SHARE_PRINCIPAL_TYPES, required: true },
    principalId: { type: Schema.Types.ObjectId, required: true },
    role: { type: String, enum: SHARE_ROLES, required: true },
  },
  { timestamps: true, autoIndex: !env.isProduction },
);

resourceShareSchema.index(
  { resourceType: 1, resourceId: 1, principalType: 1, principalId: 1 },
  { unique: true, name: 'one_share_per_principal' },
);
// "Shared with me" lookups.
resourceShareSchema.index({ workspaceId: 1, principalType: 1, principalId: 1 });

export const ResourceShareModel = mongoose.model<IResourceShare>('ResourceShare', resourceShareSchema);
