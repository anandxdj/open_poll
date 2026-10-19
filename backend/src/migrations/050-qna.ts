import { QnaQuestionModel, QnaUpvoteModel } from '../modules/qna/qna.model';
import type { Migration } from './runner';

/**
 * Q&A collections (W2-B): `qnaquestions` and `qnaupvotes`, whose indexes are
 * owned by their schemas (production runs with autoIndex off for them). The
 * unique `{questionId, participantId}` index is the upvote dedup.
 */
const migration: Migration = {
  id: 50,
  name: 'qna',
  async up({ log }) {
    for (const model of [QnaQuestionModel, QnaUpvoteModel]) {
      const dropped = await model.syncIndexes();
      log(`  ${model.collection.collectionName}: indexes in sync${dropped.length ? `, dropped ${dropped.join(', ')}` : ''}`);
    }
  },
};

export default migration;
