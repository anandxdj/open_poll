import type { Types } from 'mongoose';
import { ensurePersonalWorkspace } from '../modules/workspaces/provisioning';
import type { Migration } from './runner';

/** Collections whose documents belong to their creator's personal workspace once scoped. */
const SCOPED_COLLECTIONS = ['polls', 'presentations'] as const;

interface UserRow {
  _id: Types.ObjectId;
  name?: string;
  defaultWorkspaceId?: Types.ObjectId | null;
}

/**
 * 020-workspaces: scopes everything that predates workspaces.
 *
 * For every user: the personal workspace and owner membership (provisioned
 * exactly as the lazy path does, ensurePersonalWorkspace), `defaultWorkspaceId`
 * when unset, and `workspaceId` on their polls and presentations that have none.
 *
 * Polls and presentations are written with raw collection operations so
 * later schema changes cannot break this migration. Documents that already
 * have a workspace are never moved, so re-running it changes nothing.
 * Documents whose creatorId matches no user stay unscoped (only their creator
 * could act on them, and there is none).
 */
const migration: Migration = {
  id: 20,
  name: 'workspaces',
  async up({ db, log }) {
    await db.collection('polls').createIndex({ workspaceId: 1, createdAt: -1 });

    const workspaces = db.collection('workspaces');
    const personalBefore = await workspaces.countDocuments({ type: 'personal' });
    const scoped: Record<(typeof SCOPED_COLLECTIONS)[number], number> = { polls: 0, presentations: 0 };
    let users = 0;

    const cursor = db
      .collection<UserRow>('users')
      .find({}, { projection: { _id: 1, name: 1, defaultWorkspaceId: 1 } })
      .sort({ _id: 1 });
    for await (const user of cursor) {
      users += 1;
      const { workspace } = await ensurePersonalWorkspace({
        _id: user._id,
        name: user.name?.trim() || 'User',
        defaultWorkspaceId: user.defaultWorkspaceId ?? null,
      });

      // creatorId is stored as the user id string; match an ObjectId too in case a writer skipped the cast.
      const mine = { creatorId: { $in: [String(user._id), user._id] }, workspaceId: null };
      for (const name of SCOPED_COLLECTIONS) {
        const result = await db.collection(name).updateMany(mine, { $set: { workspaceId: workspace._id } });
        scoped[name] += result.modifiedCount;
      }
    }

    const created = (await workspaces.countDocuments({ type: 'personal' })) - personalBefore;
    log(`  users: ${users}, personal workspaces created: ${created}`);
    for (const name of SCOPED_COLLECTIONS) {
      const orphans = await db.collection(name).countDocuments({ workspaceId: null });
      log(`  ${name}: ${scoped[name]} scoped${orphans ? `, ${orphans} left unscoped (creator not found)` : ''}`);
    }
  },
};

export default migration;
