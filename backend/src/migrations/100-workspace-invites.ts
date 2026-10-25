import { WorkspaceInviteModel } from '../modules/workspaces/workspaceInvite.model';
import type { Migration } from './runner';

/**
 * W3-B1: one pending invite per workspace and email, so re-inviting refreshes
 * the existing invite instead of racing a second one in. Older duplicates
 * (none are expected: nothing wrote invites before W3-B1) are removed, keeping
 * the most recently updated one, then the invite indexes are synced, which
 * replaces the non-unique `{workspaceId, email}` index with the unique one.
 */
const migration: Migration = {
  id: 100,
  name: 'workspace-invites',
  async up({ log }) {
    const collection = WorkspaceInviteModel.collection;
    const duplicates = await collection
      .aggregate<{ _id: unknown; ids: unknown[] }>([
        { $sort: { updatedAt: -1, _id: -1 } },
        { $group: { _id: { workspaceId: '$workspaceId', email: '$email' }, ids: { $push: '$_id' }, count: { $sum: 1 } } },
        { $match: { count: { $gt: 1 } } },
      ])
      .toArray();
    const stale = duplicates.flatMap((group) => group.ids.slice(1));
    if (stale.length > 0) await collection.deleteMany({ _id: { $in: stale as never[] } });
    log(`  workspaceinvites: removed ${stale.length} duplicate invite(s)`);

    const dropped = await WorkspaceInviteModel.syncIndexes();
    log(`  workspaceinvites: indexes in sync${dropped.length ? `, dropped ${dropped.join(', ')}` : ''}`);
  },
};

export default migration;
