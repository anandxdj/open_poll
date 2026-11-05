import mongoose, { Schema, type Document, type Types } from 'mongoose';
import { env } from '../../common/config/env';

/** Longest folder name accepted (the library chip and the move dialog show it in full). */
export const MAX_FOLDER_NAME = 60;
/** Folders one workspace may hold. */
export const MAX_FOLDERS_PER_WORKSPACE = 200;

/**
 * A folder of a workspace's library (W3-B2). Decks and polls point at it with
 * `folderId`; a ResourceShare with `resourceType: 'folder'` covers the decks
 * in it (`common/tenancy/policy.ts`). One level for now: `parentId` is always
 * null, kept so nesting can come later without a migration of the documents.
 *
 * `workspaces/sharing.service.ts` reads the raw `folders` collection
 * (`_id`, `workspaceId`, `name`, `deletedAt`), so these fields keep their names.
 */
export interface IFolder extends Document {
  _id: Types.ObjectId;
  workspaceId: Types.ObjectId;
  parentId: Types.ObjectId | null;
  name: string;
  /** `name` trimmed and lowercased: one folder per name in a workspace (case-insensitive). */
  nameKey: string;
  createdBy: Types.ObjectId | null;
  /** Unused today (folders are deleted outright); the sharing module treats a set value as gone. */
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export const folderNameKey = (name: string) => name.trim().toLowerCase();

const folderSchema = new Schema<IFolder>(
  {
    workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true },
    parentId: { type: Schema.Types.ObjectId, ref: 'Folder', default: null },
    name: { type: String, required: true, trim: true, maxlength: MAX_FOLDER_NAME },
    nameKey: { type: String, required: true },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true, autoIndex: !env.isProduction, collection: 'folders' },
);

// The plan's index (listing a workspace's folders, one level at a time) doubles as the
// uniqueness rule: no two folders with the same name side by side. Created by migration 210.
folderSchema.index({ workspaceId: 1, parentId: 1, nameKey: 1 }, { unique: true, name: 'folder_name_per_parent' });

export const FolderModel = mongoose.model<IFolder>('Folder', folderSchema);
