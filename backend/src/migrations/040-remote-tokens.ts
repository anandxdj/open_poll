import { RemoteTokenModel } from '../modules/remote/remote.model';
import type { Migration } from './runner';

/**
 * Phone-remote pairings (W2-A): `remotetokens`, whose indexes are owned by the
 * schema (production runs with autoIndex off): the unique token hash, the
 * per-deck lookup and the TTL on `expiresAt`.
 */
const migration: Migration = {
  id: 40,
  name: 'remote-tokens',
  async up({ log }) {
    const dropped = await RemoteTokenModel.syncIndexes();
    log(`  ${RemoteTokenModel.collection.collectionName}: indexes in sync${dropped.length ? `, dropped ${dropped.join(', ')}` : ''}`);
  },
};

export default migration;
