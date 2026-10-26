import { CustomDomainModel } from '../modules/domains/customDomain.model';
import type { Migration } from './runner';

/** Custom domains (W4-E): the unique hostname and per-workspace indexes come from the schema. */
const migration: Migration = {
  id: 190,
  name: 'custom-domains',
  async up({ log }) {
    const dropped = await CustomDomainModel.syncIndexes();
    log(`  ${CustomDomainModel.collection.collectionName}: indexes in sync${dropped.length ? `, dropped ${dropped.join(', ')}` : ''}`);
  },
};

export default migration;
