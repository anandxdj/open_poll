import { StripeEventModel } from '../modules/billing/stripeEvent.model';
import type { Migration } from './runner';

/** W3-C: the StripeEvent collection (webhook idempotency records) and its TTL index. */
const migration: Migration = {
  id: 120,
  name: 'stripe-events',
  async up({ log }) {
    const dropped = await StripeEventModel.syncIndexes();
    log(`  ${StripeEventModel.collection.collectionName}: indexes in sync${dropped.length ? `, dropped ${dropped.join(', ')}` : ''}`);
  },
};

export default migration;
