import { DataExportJobModel } from '../modules/privacy/privacy.model';
import type { Migration } from './runner';

/** Personal-data export records (W4-C): the per-user index and the 90-day TTL come from the schema. */
const migration: Migration = {
  id: 160,
  name: 'data-exports',
  async up({ log }) {
    const dropped = await DataExportJobModel.syncIndexes();
    log(`  ${DataExportJobModel.collection.collectionName}: indexes in sync${dropped.length ? `, dropped ${dropped.join(', ')}` : ''}`);
  },
};

export default migration;
