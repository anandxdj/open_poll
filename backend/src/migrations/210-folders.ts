import { FolderModel } from '../modules/folders/folder.model';
import type { Migration } from './runner';

/**
 * Library folders (W3-B2):
 *
 * 1. `folders` is a new collection: its indexes come from the schema
 *    (`folder_name_per_parent`, unique `{workspaceId, parentId, nameKey}`).
 * 2. Polls can be filed too: `{workspaceId, folderId, updatedAt}` on `polls`
 *    (a pre-existing collection, so createIndex rather than syncIndexes).
 *    Decks already have the same index from migration 030.
 *
 * Idempotent: syncIndexes and createIndex with the same spec are no-ops.
 * No backfill: a missing `folderId` reads as null (the top level).
 */
const migration: Migration = {
  id: 210,
  name: 'folders',
  async up({ db, log }) {
    const dropped = await FolderModel.syncIndexes();
    log(`  ${FolderModel.collection.collectionName}: indexes in sync${dropped.length ? `, dropped ${dropped.join(', ')}` : ''}`);
    await db.collection('polls').createIndex({ workspaceId: 1, folderId: 1, updatedAt: -1 }, { name: 'polls_workspace_folder_updated' });
    log('  polls: polls_workspace_folder_updated index present');
  },
};

export default migration;
