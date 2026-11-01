import { afterAll, beforeAll, expect, it } from 'bun:test';
import mongoose from 'mongoose';
import migration from '../../src/migrations/200-session-activity';
import { LIVE_ACTIVITY_INDEX } from '../../src/modules/presentations/models/session.model';
import { describeIntegration, resetTestData, startTestServer, type TestServer } from './harness';

/**
 * Migration 200 on sessions stored before `lastActivityAt`: the idle-session
 * index exists (partial on live sessions) and live sessions get their last save
 * as their last activity; ended ones and ones already stamped are untouched.
 * Run twice.
 */
describeIntegration('migration 200 — session activity', () => {
  let server: TestServer;
  let db: mongoose.mongo.Db;
  const run = () => migration.up({ db, connection: mongoose.connection, log: () => {} });
  const T = (hours: number) => new Date(Date.UTC(2026, 9, 1, hours));

  beforeAll(async () => {
    server = await startTestServer();
    db = mongoose.connection.db!;
    await resetTestData();
  }, 20_000);

  afterAll(async () => {
    await resetTestData();
    await server?.close();
  });

  it('indexes live sessions by activity and backfills their last activity from their last save', async () => {
    const sessions = db.collection('presentationsessions');
    await sessions.dropIndex(LIVE_ACTIVITY_INDEX).catch(() => {});
    const base = { presentationId: new mongoose.Types.ObjectId(), runNumber: 1, joinCode: '123456', startedAt: T(0) };
    const ids = {
      lobby: new mongoose.Types.ObjectId(),
      noUpdatedAt: new mongoose.Types.ObjectId(),
      stamped: new mongoose.Types.ObjectId(),
      ended: new mongoose.Types.ObjectId(),
    };
    await sessions.insertMany([
      { ...base, _id: ids.lobby, status: 'lobby', isLive: true, updatedAt: T(2) },
      { ...base, _id: ids.noUpdatedAt, presentationId: new mongoose.Types.ObjectId(), status: 'active', isLive: true },
      { ...base, _id: ids.stamped, presentationId: new mongoose.Types.ObjectId(), status: 'active', isLive: true, updatedAt: T(2), lastActivityAt: T(5) },
      { ...base, _id: ids.ended, presentationId: new mongoose.Types.ObjectId(), status: 'ended', isLive: false, updatedAt: T(3) },
    ]);

    await run();
    await run();

    const index = (await sessions.indexes()).find((candidate) => candidate.name === LIVE_ACTIVITY_INDEX);
    expect(index).toMatchObject({ key: { status: 1, lastActivityAt: 1 }, partialFilterExpression: { isLive: true } });
    const activity = async (id: mongoose.Types.ObjectId) => (await sessions.findOne({ _id: id }))?.lastActivityAt;
    expect(await activity(ids.lobby)).toEqual(T(2));
    expect(await activity(ids.noUpdatedAt)).toEqual(T(0));
    expect(await activity(ids.stamped)).toEqual(T(5));
    expect(await activity(ids.ended)).toBeUndefined();
  });
});
