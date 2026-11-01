import { LIVE_ACTIVITY_INDEX } from '../modules/presentations/models/session.model';
import type { Migration } from './runner';

/**
 * Idle sessions end on their own (`presentations/live/idleSessions.ts`):
 *
 * 1. The job's index on `presentationsessions`: `{status, lastActivityAt}`,
 *    partial on `isLive: true`, so only live sessions are in it (the schema
 *    declares the same index for development and tests).
 * 2. Live sessions opened before `lastActivityAt` existed get their last save
 *    (`updatedAt`, else `startedAt`) as their last activity. The job falls back
 *    to the same value, so this only lets the index serve them.
 *
 * Raw collection operations; idempotent (createIndex with the same spec is a
 * no-op, the backfill only touches sessions still missing the field).
 */
const migration: Migration = {
  id: 200,
  name: 'session-activity',
  async up({ db, log }) {
    const sessions = db.collection('presentationsessions');
    await sessions.createIndex(
      { status: 1, lastActivityAt: 1 },
      { name: LIVE_ACTIVITY_INDEX, partialFilterExpression: { isLive: true } }
    );
    log(`  presentationsessions: ${LIVE_ACTIVITY_INDEX} index present`);

    const backfilled = await sessions.updateMany({ isLive: true, lastActivityAt: null }, [
      { $set: { lastActivityAt: { $ifNull: ['$updatedAt', '$startedAt'] } } },
    ]);
    log(`  presentationsessions: lastActivityAt set on ${backfilled.modifiedCount} live session(s)`);
  },
};

export default migration;
