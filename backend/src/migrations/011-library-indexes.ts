import type { Migration } from './runner';

/**
 * The unified library (`GET /api/library`) reads polls and presentations of a
 * workspace newest-update first with an `(updatedAt, _id)` cursor. Both
 * collections predate migrations, so only this index is added; nothing is
 * synced or dropped there.
 */
export const LIBRARY_INDEX = { key: { workspaceId: 1, updatedAt: -1, _id: -1 }, name: 'library_workspace_updated' } as const;
export const LIBRARY_COLLECTIONS = ['polls', 'presentations'] as const;

const migration: Migration = {
  id: 11,
  name: 'library-indexes',
  async up({ db, log }) {
    for (const name of LIBRARY_COLLECTIONS) {
      await db.collection(name).createIndex(LIBRARY_INDEX.key, { name: LIBRARY_INDEX.name });
      log(`  ${name}: ${LIBRARY_INDEX.name} present`);
    }
  },
};

export default migration;
