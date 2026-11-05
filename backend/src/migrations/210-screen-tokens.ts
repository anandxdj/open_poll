import { ScreenTokenModel } from '../modules/embeds/screenToken.model';
import type { Migration } from './runner';

/** Screen tokens (W4-D): the unique token hash and the per-deck and per-workspace indexes come from the schema. */
const migration: Migration = {
  id: 210,
  name: 'screen-tokens',
  async up({ log }) {
    const dropped = await ScreenTokenModel.syncIndexes();
    log(`  ${ScreenTokenModel.collection.collectionName}: indexes in sync${dropped.length ? `, dropped ${dropped.join(', ')}` : ''}`);
  },
};

export default migration;
