import type { Model } from 'mongoose';
import { AuditEventModel } from '../modules/audit/audit.model';
import { UserModel } from '../modules/auth/auth.model';
import { MediaAssetModel } from '../modules/uploads/media.model';
import { ResourceShareModel } from '../modules/workspaces/resourceShare.model';
import { UsageCounterModel } from '../modules/workspaces/usageCounter.model';
import { WorkspaceModel } from '../modules/workspaces/workspace.model';
import { WorkspaceGroupModel } from '../modules/workspaces/workspaceGroup.model';
import { WorkspaceInviteModel } from '../modules/workspaces/workspaceInvite.model';
import { WorkspaceMemberModel } from '../modules/workspaces/workspaceMember.model';
import type { Migration } from './runner';

/** Collections introduced by the platform primitives; their indexes are owned by their schemas. */
const OWNED_MODELS: Model<any>[] = [
  WorkspaceModel,
  WorkspaceMemberModel,
  WorkspaceInviteModel,
  WorkspaceGroupModel,
  ResourceShareModel,
  UsageCounterModel,
  MediaAssetModel,
  AuditEventModel,
];

const migration: Migration = {
  id: 1,
  name: 'bootstrap',
  async up({ log }) {
    for (const model of OWNED_MODELS) {
      const dropped = await model.syncIndexes();
      log(`  ${model.collection.collectionName}: indexes in sync${dropped.length ? `, dropped ${dropped.join(', ')}` : ''}`);
    }
    // users predates migrations: only add the identities lookup index, never sync (drop) there.
    await UserModel.collection.createIndex({ 'identities.provider': 1, 'identities.subject': 1 });
    log('  users: identities index present');
  },
};

export default migration;
