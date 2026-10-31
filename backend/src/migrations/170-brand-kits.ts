import { BrandKitModel } from '../modules/themes/brandKit.model';
import type { Migration } from './runner';

/** Brand kits (W3-A): the per-workspace index comes from the schema (production runs with autoIndex off). */
const migration: Migration = {
  id: 170,
  name: 'brand-kits',
  async up({ log }) {
    const dropped = await BrandKitModel.syncIndexes();
    log(`  ${BrandKitModel.collection.collectionName}: indexes in sync${dropped.length ? `, dropped ${dropped.join(', ')}` : ''}`);
  },
};

export default migration;
