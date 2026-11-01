import { afterAll, beforeAll, beforeEach, expect, it } from 'bun:test';
import mongoose from 'mongoose';
import { env } from '../../src/common/config/env';
import { redisClient } from '../../src/common/config/redis';
import { Scheduler, registeredJobs } from '../../src/common/jobs/scheduler';
import { AuditEventModel } from '../../src/modules/audit/audit.model';
import { resetActivityThrottle } from '../../src/modules/presentations/live/activity';
import { SESSION_IDLE_JOB, endIdleSessions } from '../../src/modules/presentations/live/idleSessions';
import { k } from '../../src/modules/presentations/live/keys';
import { PresentationModel, PresentationSessionModel } from '../../src/modules/presentations/presentations.model';
import { createVerifiedUser, type TestUser } from './fixtures';
import { describeIntegration, resetTestData, startTestServer, type TestServer } from './harness';

/**
 * Idle sessions end on their own: a lobby and a presented session aged past
 * their thresholds are ended by one run of the registered job (through the
 * scheduler's Redis lock, raced by two "instances") exactly as the host's End
 * Session ends them, and audited. Sessions used recently are left alone.
 */

type Envelope = { type: string; sessionId: string | null; payload: Record<string, any> };
type Body<T = any> = { success: boolean; message: string; data: T };

const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;
const quiet = { log: () => {}, error: () => {} };

const SELECT = {
  type: 'select_answer',
  question: 'Capital of France?',
  options: [
    { text: 'Paris', isCorrect: true },
    { text: 'Lyon', isCorrect: false },
  ],
  timeLimit: 60,
};

const waitFor = async (check: () => boolean | Promise<boolean>, what: string, timeoutMs = 5000) => {
  const deadline = Date.now() + timeoutMs;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}`);
    await Bun.sleep(20);
  }
};

describeIntegration('idle sessions end on their own', () => {
  let server: TestServer;
  let host: TestUser;

  const call = async <T = any>(method: string, path: string, options: { user?: TestUser; body?: unknown } = {}) => {
    const res = await server.request(`/api/presentations${path}`, {
      method,
      headers: options.user?.headers ?? {},
      body: options.body,
    });
    return { status: res.status, body: (await res.json()) as Body<T> };
  };

  /** A one-slide deck with its session opened by `command` (`open-lobby` or `start`). */
  const deckWithSession = async (title: string, command: 'open-lobby' | 'start') => {
    const created = await call('POST', '/', { user: host, body: { title, slides: [SELECT] } });
    expect(created.status).toBe(201);
    const pid: string = created.body.data._id;
    const opened = await call('POST', `/${pid}/host/${command}`, { user: host });
    expect(opened.status).toBe(200);
    return { pid, sid: opened.body.data.session.sessionId as string, workspaceId: created.body.data.workspaceId as string };
  };

  /** Moves the session's last activity `hoursAgo` into the past (without bumping it as a write would). */
  const age = (sid: string, hoursAgo: number) =>
    PresentationSessionModel.collection.updateOne(
      { _id: new mongoose.Types.ObjectId(sid) },
      { $set: { lastActivityAt: new Date(Date.now() - hoursAgo * HOUR) } }
    );

  const sessionOf = (sid: string) => PresentationSessionModel.findById(sid).lean();

  beforeAll(async () => {
    server = await startTestServer();
  }, 20_000);

  beforeEach(async () => {
    await resetTestData();
    resetActivityThrottle();
    host = await createVerifiedUser({ name: 'Host' });
  });

  afterAll(async () => {
    await resetTestData();
    await server?.close();
  });

  it('ends an idle lobby and an idle presented session through the job, and leaves recent ones alone', async () => {
    const { lobbyHours, liveHours } = env.sessionIdle;

    // Idle past their thresholds.
    const idleLobby = await deckWithSession('Idle lobby', 'open-lobby');
    const idleLive = await deckWithSession('Idle live', 'start');
    const beforeJoin = Date.now();
    const ada = (await call('POST', `/${idleLive.pid}/join`, { body: { name: 'Ada' } })).body.data;
    const answered = await call('POST', `/${idleLive.pid}/answer`, {
      body: { participantId: ada.participantId, participantToken: ada.token, slideIndex: 0, optionIndex: 0 },
    });
    expect(answered.status).toBe(200);
    // The join's activity write is fire-and-forget: let it land before ageing the session.
    await waitFor(
      async () => ((await sessionOf(idleLive.sid))!.lastActivityAt as Date).getTime() >= beforeJoin,
      'the join to record activity'
    );
    await age(idleLobby.sid, lobbyHours + 1);
    await age(idleLive.sid, liveHours + 1);

    // Opened before lastActivityAt existed: judged by its last save.
    const legacy = await deckWithSession('Legacy lobby', 'open-lobby');
    await PresentationSessionModel.collection.updateOne(
      { _id: new mongoose.Types.ObjectId(legacy.sid) },
      { $unset: { lastActivityAt: '' }, $set: { updatedAt: new Date(Date.now() - (lobbyHours + 1) * HOUR) } }
    );

    // Used recently: stay live.
    const recentLobby = await deckWithSession('Recent lobby', 'open-lobby');
    await age(recentLobby.sid, lobbyHours / 2);
    const recentLive = await deckWithSession('Recent live', 'start');
    await age(recentLive.sid, (lobbyHours + liveHours) / 2); // past a lobby's limit, within a presented session's
    const revived = await deckWithSession('Revived lobby', 'open-lobby');
    await age(revived.sid, lobbyHours + 1);
    expect((await call('POST', `/${revived.pid}/join`, { body: { name: 'Late' } })).status).toBe(200);
    await waitFor(
      async () => Date.now() - ((await sessionOf(revived.sid))!.lastActivityAt as Date).getTime() < HOUR,
      'the join to record activity'
    );

    // The host console of the idle presented session is open.
    const socket = server.connectSocket({ auth: { token: `Bearer ${host.accessToken}` } });
    const events: Envelope[] = [];
    socket.on('live:event', (event: Envelope) => events.push(event));
    await waitFor(() => socket.connected, 'socket connect');
    expect(await socket.timeout(3000).emitWithAck('live:join', { presentationId: idleLive.pid, role: 'host' })).toEqual({
      ok: true,
      role: 'host',
    });

    // One run, raced by two instances sharing the Redis lock: exactly one runs it.
    const job = registeredJobs().find((candidate) => candidate.name === SESSION_IDLE_JOB);
    expect(job?.everyMs).toBe(10 * 60 * 1000);
    const tick = Math.floor(Date.now() / job!.everyMs);
    const ran = await Promise.all([
      new Scheduler({ jobs: [job!], instanceId: 'a', log: quiet }).runTick(job!, tick),
      new Scheduler({ jobs: [job!], instanceId: 'b', log: quiet }).runTick(job!, tick),
    ]);
    expect(ran.filter(Boolean)).toHaveLength(1);

    // Ended like End Session: status, retention, snapshot, deck mirror, Redis pointer.
    for (const [ended, reason] of [
      [idleLobby, 'lobby_idle'],
      [idleLive, 'live_idle'],
      [legacy, 'lobby_idle'],
    ] as const) {
      const session = (await sessionOf(ended.sid))!;
      expect(session).toMatchObject({ status: 'ended', isLive: false, endReason: reason });
      expect(session.endedAt).toBeInstanceOf(Date);
      // Free plan: kept 365 days from the end.
      expect(session.retainUntil!.getTime() - session.endedAt!.getTime()).toBe(365 * DAY);
      const deck = await PresentationModel.findById(ended.pid).lean();
      expect(deck).toMatchObject({ status: 'ended', activeSessionId: null });
      expect(await redisClient.get(k.active(ended.pid))).toBeNull();
    }
    const live = (await sessionOf(idleLive.sid))!;
    expect(live).toMatchObject({ participantCount: 1, answerCount: 1 });
    expect(live.finalLeaderboard.map((entry) => entry.name)).toEqual(['Ada']);

    // The open host console got the normal end of session, and its state reads ended.
    await waitFor(() => events.some((event) => event.type === 'session:ended'), 'session:ended on the host socket');
    const endedEvent = events.find((event) => event.type === 'session:ended')!;
    expect(endedEvent.sessionId).toBe(idleLive.sid);
    expect(endedEvent.payload).toMatchObject({ runNumber: 1, participantCount: 1, answerCount: 1 });
    expect(endedEvent.payload.leaderboard.map((entry: { name: string }) => entry.name)).toEqual(['Ada']);
    const state = await call('GET', `/${idleLive.pid}/host/state`, { user: host });
    expect(state.body.data.session).toMatchObject({ sessionId: idleLive.sid, status: 'ended', isLive: false });

    // One audit event per auto-ended session, in the deck's workspace.
    const audits = await AuditEventModel.find({ action: 'session.auto_ended' }).lean();
    expect(audits).toHaveLength(3);
    const auditOf = (sid: string) => audits.find((event) => event.targetId === sid);
    expect(auditOf(idleLobby.sid)).toMatchObject({
      actorType: 'system',
      actorId: null,
      targetType: 'session',
      meta: { reason: 'lobby_idle', presentationId: idleLobby.pid, runNumber: 1, idleHours: lobbyHours },
    });
    expect(String(auditOf(idleLobby.sid)!.workspaceId)).toBe(idleLobby.workspaceId);
    expect(auditOf(idleLive.sid)).toMatchObject({ meta: { reason: 'live_idle', idleHours: liveHours } });
    expect(auditOf(legacy.sid)).toMatchObject({ meta: { reason: 'lobby_idle' } });

    // Recently used sessions are untouched.
    for (const kept of [recentLobby, recentLive, revived]) {
      expect(await sessionOf(kept.sid)).toMatchObject({ isLive: true, endedAt: null, endReason: null, retainUntil: null });
      expect((await PresentationModel.findById(kept.pid).lean())!.activeSessionId?.toString()).toBe(kept.sid);
    }
    expect((await sessionOf(recentLive.sid))!.status).toBe('active');

    // A later run finds nothing more to end.
    expect(await endIdleSessions()).toEqual({ ended: 0, skipped: 0, failed: 0 });
    expect(await AuditEventModel.countDocuments({ action: 'session.auto_ended' })).toBe(3);
  }, 30_000);
});
