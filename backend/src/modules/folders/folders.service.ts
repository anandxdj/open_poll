import mongoose, { Types } from 'mongoose';
import { assertCan, assertCanWithShares, type PolicyContext, type PolicyResource } from '../../common/tenancy/policy';
import { ApiError } from '../../common/utils/ApiError';
import { PollModel } from '../polls/polls.model';
import { PresentationModel } from '../presentations/models/presentation.model';
import { ResourceShareModel } from '../workspaces/resourceShare.model';
import { FolderModel, folderNameKey, MAX_FOLDERS_PER_WORKSPACE, type IFolder } from './folder.model';
import type { MoveItemsInput } from './folders.schema';

type IdLike = string | { toString(): string };

/** The caller after authenticate() + workspaceContext(). */
export type FolderActor = PolicyContext & { user: { id: string }; workspace: { _id: IdLike } };

/** One folder as the API returns it. */
export interface FolderView {
  id: string;
  name: string;
  /** Always null today: folders are one level deep. */
  parentId: null;
  /** What the library shows inside it (decks in the trash and templates do not count). */
  counts: { presentations: number; polls: number };
  createdAt: string;
  updatedAt: string;
}

export interface MoveResult {
  folderId: string | null;
  moved: { presentations: number; polls: number };
}

export interface DeleteResult {
  folder: { id: string; name: string };
  /** Decks and polls that were in it, now at the top level. */
  moved: { presentations: number; polls: number };
  sharesRemoved: number;
}

const oid = (value: IdLike) => new Types.ObjectId(String(value));

const nameTaken = () => new ApiError(409, 'A folder with this name already exists', 'FOLDER_NAME_TAKEN');
const folderNotFound = () => ApiError.notFound('Folder not found');

/** Library items count the same way `GET /api/library` lists them. */
const LISTED_DECK = { deletedAt: null, isTemplate: { $ne: true } } as const;

const policyOf = (folder: Pick<IFolder, '_id' | 'workspaceId'>): PolicyResource => ({
  _id: folder._id,
  workspaceId: folder.workspaceId,
  kind: 'folder',
});

function toView(folder: Pick<IFolder, '_id' | 'name' | 'createdAt' | 'updatedAt'>, counts = { presentations: 0, polls: 0 }): FolderView {
  return {
    id: String(folder._id),
    name: folder.name,
    parentId: null,
    counts,
    createdAt: new Date(folder.createdAt).toISOString(),
    updatedAt: new Date(folder.updatedAt).toISOString(),
  };
}

/** A folder by id, or 404. The policy checks that it belongs to the caller's workspace. */
async function loadFolder(id: string) {
  const folder = mongoose.isValidObjectId(id) ? await FolderModel.findById(id) : null;
  if (!folder || folder.deletedAt) throw folderNotFound();
  return folder;
}

/** Per-folder item counts for `folderIds` of `workspaceId`. */
async function countItems(workspaceId: Types.ObjectId, folderIds: Types.ObjectId[]) {
  const group = { $group: { _id: '$folderId', n: { $sum: 1 } } };
  const [decks, polls] = await Promise.all([
    PresentationModel.aggregate<{ _id: Types.ObjectId; n: number }>([
      { $match: { workspaceId, folderId: { $in: folderIds }, ...LISTED_DECK } },
      group,
    ]),
    PollModel.aggregate<{ _id: Types.ObjectId; n: number }>([{ $match: { workspaceId, folderId: { $in: folderIds } } }, group]),
  ]);
  const deckCounts = new Map(decks.map((row) => [String(row._id), row.n]));
  const pollCounts = new Map(polls.map((row) => [String(row._id), row.n]));
  return (id: Types.ObjectId) => ({ presentations: deckCounts.get(String(id)) ?? 0, polls: pollCounts.get(String(id)) ?? 0 });
}

const isDuplicateKey = (error: unknown) => (error as { code?: number } | null)?.code === 11000;

/**
 * Library folders of a workspace (W3-B2). Folders hold decks and polls of the
 * same workspace, one level deep. Who may do what:
 * - list: `deck:read` (every member sees the folders, like the library);
 * - create: `deck:create`; rename: `deck:edit` on the folder (an editor share on it counts);
 * - delete: `deck:delete` (the workspace role; shares never grant it);
 * - move items: `deck:share` on every item (editor and up). A folder's shares
 *   cover the decks in it, so filing a deck into a folder, or taking it out,
 *   changes who can open it: the same right as sharing it.
 */
export class FoldersService {
  static async list(ctx: FolderActor): Promise<{ folders: FolderView[] }> {
    assertCan(ctx, 'deck:read');
    const workspaceId = oid(ctx.workspace._id);
    const folders = await FolderModel.find({ workspaceId, parentId: null, deletedAt: null })
      .sort({ nameKey: 1 })
      .limit(MAX_FOLDERS_PER_WORKSPACE)
      .lean();
    if (folders.length === 0) return { folders: [] };
    const countsOf = await countItems(workspaceId, folders.map((folder) => folder._id));
    return { folders: folders.map((folder) => toView(folder, countsOf(folder._id))) };
  }

  static async create(ctx: FolderActor, name: string): Promise<FolderView> {
    assertCan(ctx, 'deck:create');
    const workspaceId = oid(ctx.workspace._id);
    if ((await FolderModel.countDocuments({ workspaceId })) >= MAX_FOLDERS_PER_WORKSPACE) {
      throw new ApiError(409, `A workspace can hold up to ${MAX_FOLDERS_PER_WORKSPACE} folders`, 'FOLDER_LIMIT_REACHED');
    }
    try {
      const folder = await FolderModel.create({
        workspaceId,
        parentId: null,
        name: name.trim(),
        nameKey: folderNameKey(name),
        createdBy: mongoose.isValidObjectId(ctx.user.id) ? oid(ctx.user.id) : null,
      });
      return toView(folder);
    } catch (error) {
      if (isDuplicateKey(error)) throw nameTaken();
      throw error;
    }
  }

  static async rename(ctx: FolderActor, id: string, name: string): Promise<{ folder: FolderView; previousName: string }> {
    const folder = await loadFolder(id);
    // An editor share on the folder counts, like on the decks in it.
    await assertCanWithShares(ctx, 'deck:edit', policyOf(folder));
    const previousName = folder.name;
    folder.name = name.trim();
    folder.nameKey = folderNameKey(name);
    try {
      await folder.save();
    } catch (error) {
      if (isDuplicateKey(error)) throw nameTaken();
      throw error;
    }
    const countsOf = await countItems(folder.workspaceId, [folder._id]);
    return { folder: toView(folder, countsOf(folder._id)), previousName };
  }

  /**
   * Deletes the folder. What was in it moves to the top level (nothing is
   * deleted with it), and the folder's shares are removed: a ResourceShare on
   * a folder that no longer exists must not linger (the sharing module reads
   * the raw collection, and a later folder could never reuse the id anyway).
   */
  static async remove(ctx: FolderActor, id: string): Promise<DeleteResult> {
    const folder = await loadFolder(id);
    // deck:delete is never granted by a share: the workspace role decides.
    assertCan(ctx, 'deck:delete', policyOf(folder));
    const deleted = await FolderModel.findOneAndDelete({ _id: folder._id, workspaceId: folder.workspaceId });
    if (!deleted) throw folderNotFound();
    const filter = { workspaceId: folder.workspaceId, folderId: folder._id };
    const unfile = { $set: { folderId: null } };
    // Trashed decks too, so a restored deck never points at a missing folder.
    const [decks, polls, shares] = await Promise.all([
      PresentationModel.updateMany(filter, unfile, { timestamps: false }),
      PollModel.updateMany(filter, unfile, { timestamps: false }),
      ResourceShareModel.deleteMany({ resourceType: 'folder', resourceId: folder._id }),
    ]);
    return {
      folder: { id: String(folder._id), name: folder.name },
      moved: { presentations: decks.modifiedCount, polls: polls.modifiedCount },
      sharesRemoved: shares.deletedCount,
    };
  }

  /**
   * Files decks and polls into `folderId` (null = the top level). All or
   * nothing: every item must exist in the caller's workspace and be movable
   * by them, else nothing moves. Moving does not touch `updatedAt`, so the
   * library order stays as it was.
   */
  static async move(ctx: FolderActor, input: MoveItemsInput): Promise<MoveResult> {
    const folder = input.folderId ? await loadFolder(input.folderId) : null;
    if (folder) assertCan(ctx, 'deck:edit', policyOf(folder));
    else assertCan(ctx, 'deck:read');

    const deckIds = [...new Set(input.items.filter((item) => item.entityType === 'presentation').map((item) => item.id.toLowerCase()))];
    const pollIds = [...new Set(input.items.filter((item) => item.entityType === 'poll').map((item) => item.id.toLowerCase()))];
    const [decks, polls] = await Promise.all([
      deckIds.length
        ? PresentationModel.find({ _id: { $in: deckIds }, ...LISTED_DECK }).select('_id workspaceId creatorId').lean()
        : [],
      pollIds.length ? PollModel.find({ _id: { $in: pollIds } }).select('_id workspaceId creatorId').lean() : [],
    ]);
    if (decks.length !== deckIds.length || polls.length !== pollIds.length) {
      throw ApiError.notFound('Some of these items no longer exist');
    }
    for (const item of [...decks, ...polls]) {
      // Items from before workspaces (only their creator reaches them) cannot join a workspace folder.
      if (!item.workspaceId) {
        throw new ApiError(409, "This item doesn't belong to a workspace yet, so it can't go in a folder", 'NOT_MOVABLE');
      }
      assertCan(ctx, 'deck:share', item);
    }

    const workspaceId = oid(ctx.workspace._id);
    const target = folder ? folder._id : null;
    const [movedDecks, movedPolls] = await Promise.all([
      deckIds.length
        ? PresentationModel.updateMany({ _id: { $in: deckIds }, workspaceId }, { $set: { folderId: target } }, { timestamps: false })
        : null,
      pollIds.length
        ? PollModel.updateMany({ _id: { $in: pollIds }, workspaceId }, { $set: { folderId: target } }, { timestamps: false })
        : null,
    ]);

    // A delete of the folder may have run meanwhile: put these items back at the top level.
    if (folder && !(await FolderModel.exists({ _id: folder._id }))) {
      await Promise.all([
        PresentationModel.updateMany({ workspaceId, folderId: folder._id }, { $set: { folderId: null } }, { timestamps: false }),
        PollModel.updateMany({ workspaceId, folderId: folder._id }, { $set: { folderId: null } }, { timestamps: false }),
      ]);
      throw folderNotFound();
    }

    return {
      folderId: target ? String(target) : null,
      moved: { presentations: movedDecks?.matchedCount ?? 0, polls: movedPolls?.matchedCount ?? 0 },
    };
  }
}
