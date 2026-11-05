import { ANSWER_ONCE_PER_ATTEMPT_INDEX } from '../modules/presentations/models/answer.model';
import { AUDIENCE_AUTOCLOSE_INDEX } from '../modules/presentations/models/session.model';
import type { Migration } from './runner';

/**
 * Audience pace (W2-F, `presentations/live/audience.service.ts`):
 *
 * 1. Answers become unique per attempt: an audience-paced assessment can be
 *    retried, and each attempt answers every slide again. The unique index of
 *    migration 030, `{sessionId, slideId, participantId}`, is replaced by
 *    `{sessionId, slideId, participantId, attempt}` (same partial filter). The
 *    new one is created first, so there is no moment without a guarantee.
 *    Answers stored before carry no `attempt` (null in the index); new ones
 *    store `attempt: 1` and up. Presenter pace only ever writes attempt 1.
 * 2. The `audience-autoclose` job's index on `presentationsessions`:
 *    `{'audience.closesAt': 1}`, partial on live sessions with a closing time.
 *
 * Raw collection operations; idempotent (createIndex with the same spec is a
 * no-op, the drop only runs while the old index exists).
 */
const OLD_ANSWER_INDEX = 'sessionId_1_slideId_1_participantId_1';

const migration: Migration = {
  id: 230,
  name: 'audience-pace',
  async up({ db, log }) {
    const answers = db.collection('presentationanswers');
    await answers.createIndex(
      { sessionId: 1, slideId: 1, participantId: 1, attempt: 1 },
      { unique: true, name: ANSWER_ONCE_PER_ATTEMPT_INDEX, partialFilterExpression: { sessionId: { $exists: true } } }
    );
    log(`  presentationanswers: ${ANSWER_ONCE_PER_ATTEMPT_INDEX} index present`);
    const existing = await answers.indexes().catch(() => [] as { name?: string }[]);
    if (existing.some((index) => index.name === OLD_ANSWER_INDEX)) {
      await answers.dropIndex(OLD_ANSWER_INDEX);
      log(`  presentationanswers: dropped ${OLD_ANSWER_INDEX}`);
    }

    await db.collection('presentationsessions').createIndex(
      { 'audience.closesAt': 1 },
      {
        name: AUDIENCE_AUTOCLOSE_INDEX,
        partialFilterExpression: { isLive: true, 'audience.closesAt': { $type: 'date' } },
      }
    );
    log(`  presentationsessions: ${AUDIENCE_AUTOCLOSE_INDEX} index present`);
  },
};

export default migration;
