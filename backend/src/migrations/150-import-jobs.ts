import { ImportJobModel } from '../modules/imports/import.model';
import type { Migration } from './runner';

/** The import queue's collection: indexes come from its schema (production runs with autoIndex off). */
const migration: Migration = {
  id: 150,
  name: 'import-jobs',
  async up({ log }) {
    const dropped = await ImportJobModel.syncIndexes();
    log(`  ${ImportJobModel.collection.collectionName}: indexes in sync${dropped.length ? `, dropped ${dropped.join(', ')}` : ''}`);
  },
};

export default migration;
