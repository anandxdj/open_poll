import mongoose, { Schema, type Document, type Types } from 'mongoose';
import { env } from '../../common/config/env';

/** A set of members (SCIM Group or IdP group mapping) that resources can be shared with. */
export interface IWorkspaceGroup extends Document {
  _id: Types.ObjectId;
  workspaceId: Types.ObjectId;
  displayName: string;
  /** The IdP's id for the group (SCIM externalId); null for groups made in the app. */
  externalId?: string | null;
  memberIds: Types.ObjectId[];
  createdAt: Date;
  updatedAt: Date;
}

const workspaceGroupSchema = new Schema<IWorkspaceGroup>(
  {
    workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true },
    displayName: { type: String, required: true, trim: true, maxlength: 256 },
    externalId: { type: String, default: null },
    memberIds: { type: [{ type: Schema.Types.ObjectId, ref: 'User' }], default: [] },
  },
  { timestamps: true, autoIndex: !env.isProduction },
);

workspaceGroupSchema.index({ workspaceId: 1, displayName: 1 });
workspaceGroupSchema.index({ workspaceId: 1, externalId: 1 });
workspaceGroupSchema.index({ memberIds: 1 });

export const WorkspaceGroupModel = mongoose.model<IWorkspaceGroup>('WorkspaceGroup', workspaceGroupSchema);
