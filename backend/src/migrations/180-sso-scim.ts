import { ScimTokenModel } from '../modules/scim/scimToken.model';
import { SsoConnectionModel } from '../modules/sso/ssoConnection.model';
import type { Migration } from './runner';

/** Single sign-on connections and SCIM tokens (W3-D): indexes from their schemas. */
const migration: Migration = {
  id: 180,
  name: 'sso-scim',
  async up({ log }) {
    for (const model of [SsoConnectionModel, ScimTokenModel]) {
      const dropped = await model.syncIndexes();
      log(`  ${model.collection.collectionName}: indexes in sync${dropped.length ? `, dropped ${dropped.join(', ')}` : ''}`);
    }
  },
};

export default migration;
