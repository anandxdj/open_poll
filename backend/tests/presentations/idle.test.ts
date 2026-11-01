import { afterEach, beforeEach, describe, expect, it, setSystemTime } from 'bun:test';
import {
  ACTIVITY_WRITE_INTERVAL_MS,
  createActivityThrottle,
  idleEndReason,
  lastActivityOf,
  resetActivityThrottle,
} from '../../src/modules/presentations/live/activity';
import { endIdleSession } from '../../src/modules/presentations/live/session.service';
import { PresentationService } from '../../src/modules/presentations/presentations.service';
import { flush, installFakeRedis, installModelStubs, OWNER_ID, type FakeRedis } from './harness';

/**
 * Idle sessions (auto-end): the idle decision, the activity write throttle, and
 * the engine recording activity (host commands, joins, answers) and ending an
 * idle session the way the host's End Session does.
 */

const HOUR = 3600 * 1000;
const MIN = 60 * 1000;
const T0 = new Date('2026-06-01T10:00:00.000Z').getTime();
const at = (ms: number) => setSystemTime(new Date(T0 + ms));
const date = (ms: number) => new Date(T0 + ms);
const DEFAULTS = { lobbyHours: 6, liveHours: 12 };

describe('idle decision', () => {
  const live = (status: 'lobby' | 'active' | 'ended', lastActivityMs: number | null, extra: Record<string, unknown> = {}) => ({
    isLive: status !== 'ended',
    status,
    lastActivityAt: lastActivityMs === null ? null : date(lastActivityMs),
    ...extra,
  });

  it('ends a lobby after lobbyHours without activity, not a minute before', () => {
    expect(idleEndReason(live('lobby', 0), date(6 * HOUR - MIN), DEFAULTS)).toBeNull();
    expect(idleEndReason(live('lobby', 0), date(6 * HOUR), DEFAULTS)).toBe('lobby_idle');
    expect(idleEndReason(live('lobby', 0), date(48 * HOUR), DEFAULTS)).toBe('lobby_idle');
  });

  it('gives a presented session liveHours', () => {
    expect(idleEndReason(live('active', 0), date(7 * HOUR), DEFAULTS)).toBeNull();
    expect(idleEndReason(live('active', 0), date(12 * HOUR - MIN), DEFAULTS)).toBeNull();
    expect(idleEndReason(live('active', 0), date(12 * HOUR), DEFAULTS)).toBe('live_idle');
  });

  it('counts from the last activity, not from the start', () => {
    const session = live('active', 10 * HOUR, { startedAt: date(0), updatedAt: date(HOUR) });
    expect(idleEndReason(session, date(21 * HOUR), DEFAULTS)).toBeNull();
    expect(idleEndReason(session, date(22 * HOUR), DEFAULTS)).toBe('live_idle');
  });

  it('never ends a session that already ended or is not live', () => {
    expect(idleEndReason(live('ended', 0), date(100 * HOUR), DEFAULTS)).toBeNull();
    expect(idleEndReason({ ...live('lobby', 0), isLive: false }, date(100 * HOUR), DEFAULTS)).toBeNull();
  });

  it('falls back to the last save, then the start, for sessions without lastActivityAt', () => {
    const legacy = live('lobby', null, { updatedAt: date(2 * HOUR), startedAt: date(0) });
    expect(lastActivityOf(legacy)).toEqual(date(2 * HOUR));
    expect(idleEndReason(legacy, date(7 * HOUR), DEFAULTS)).toBeNull();
    expect(idleEndReason(legacy, date(8 * HOUR), DEFAULTS)).toBe('lobby_idle');
    expect(lastActivityOf(live('lobby', null, { startedAt: date(0) }))).toEqual(date(0));
    // No time at all: left alone rather than guessed.
    expect(idleEndReason(live('lobby', null), date(100 * HOUR), DEFAULTS)).toBeNull();
  });

  it('follows configured thresholds', () => {
    const thresholds = { lobbyHours: 1, liveHours: 2.5 };
    expect(idleEndReason(live('lobby', 0), date(HOUR), thresholds)).toBe('lobby_idle');
    expect(idleEndReason(live('active', 0), date(2 * HOUR), thresholds)).toBeNull();
    expect(idleEndReason(live('active', 0), date(2.5 * HOUR), thresholds)).toBe('live_idle');
  });
});

describe('activity write throttle', () => {
  it('writes a session at most once per interval, each session on its own', () => {
    const throttle = createActivityThrottle(5 * MIN);
    expect(throttle.shouldWrite('a', 0)).toBe(true);
    expect(throttle.shouldWrite('a', 1)).toBe(false);
    expect(throttle.shouldWrite('a', 5 * MIN - 1)).toBe(false);
    expect(throttle.shouldWrite('b', 1)).toBe(true);
    expect(throttle.shouldWrite('a', 5 * MIN)).toBe(true);
    expect(throttle.shouldWrite('a', 5 * MIN + 1)).toBe(false);
  });

  it('drops stale entries once it tracks too many sessions', () => {
    const throttle = createActivityThrottle(5 * MIN, 3);
    for (const id of ['a', 'b', 'c']) throttle.shouldWrite(id, 0);
    expect(throttle.size()).toBe(3);
    throttle.shouldWrite('d', 10 * MIN);
    expect(throttle.size()).toBe(1);
    expect(throttle.shouldWrite('a', 10 * MIN)).toBe(true);
  });
});

describe('session activity and idle end (engine)', () => {
  let redis: FakeRedis;
  let models: ReturnType<typeof installModelStubs>;
  let restoreRedis: () => void;

  beforeEach(() => {
    const fake = installFakeRedis();
    redis = fake.redis;
    restoreRedis = fake.restore;
    models = installModelStubs();
    resetActivityThrottle();
    at(0);
  });

  afterEach(async () => {
    await flush();
    models.restore();
    restoreRedis();
    setSystemTime();
  });

  // Untimed, so answers still count hours after the slide opened.
  const CLOUD = { type: 'wordcloud', question: 'One word', timeLimit: 0 };

  const addDeck = () =>
    models.addPresentation({ title: 'Idle', creatorId: OWNER_ID, joinCode: '777777', slides: [structuredClone(CLOUD)] });

  const lastActivity = (pid: string) => models.liveSession(pid)?.lastActivityAt?.getTime() - T0;

  it('stamps host commands, joins and answers, joins and answers at most every interval', async () => {
    const pid = String(addDeck()._id);
    await PresentationService.openLobby(pid, OWNER_ID);
    expect(lastActivity(pid)).toBe(0);

    at(HOUR);
    const ada = await PresentationService.joinPresentation(pid, { name: 'Ada' });
    await flush();
    expect(lastActivity(pid)).toBe(HOUR);

    at(HOUR + MIN); // within the interval of the last write: not written again
    const grace = await PresentationService.joinPresentation(pid, { name: 'Grace' });
    await flush();
    expect(lastActivity(pid)).toBe(HOUR);

    at(2 * HOUR); // host commands are written with the session they change
    await PresentationService.startSession(pid, OWNER_ID);
    expect(lastActivity(pid)).toBe(2 * HOUR);

    at(2 * HOUR + ACTIVITY_WRITE_INTERVAL_MS);
    await PresentationService.submitAnswer(pid, { participantId: ada.participantId, participantToken: ada.token, slideIndex: 0, entries: ['sun'] } as any);
    await flush();
    expect(lastActivity(pid)).toBe(2 * HOUR + ACTIVITY_WRITE_INTERVAL_MS);

    at(3 * HOUR);
    await PresentationService.closeCurrentSlide(pid, OWNER_ID);
    expect(lastActivity(pid)).toBe(3 * HOUR);
    at(4 * HOUR);
    await PresentationService.reopenCurrentSlide(pid, OWNER_ID);
    expect(lastActivity(pid)).toBe(4 * HOUR);
    at(5 * HOUR);
    await PresentationService.submitAnswer(pid, { participantId: grace.participantId, participantToken: grace.token, slideIndex: 0, entries: ['moon'] } as any);
    await flush();
    expect(lastActivity(pid)).toBe(5 * HOUR);
    at(6 * HOUR);
    await PresentationService.revealCurrentSlide(pid, OWNER_ID);
    expect(lastActivity(pid)).toBe(6 * HOUR);
  });

  it('ends an idle lobby like the host would: snapshot, retention, deck mirror, session:ended', async () => {
    const deck = addDeck();
    const pid = String(deck._id);
    const opened = await PresentationService.openLobby(pid, OWNER_ID);
    await PresentationService.joinPresentation(pid, { name: 'Ada' });
    await flush();

    at(5 * HOUR);
    expect(await endIdleSession(opened.session.sessionId, date(5 * HOUR), DEFAULTS)).toBeNull();
    expect(models.liveSession(pid)).not.toBeNull();

    at(6 * HOUR);
    const ended = await endIdleSession(opened.session.sessionId, date(6 * HOUR), DEFAULTS);
    expect(ended?.reason).toBe('lobby_idle');
    const session = models.sessions.find((s) => String(s._id) === opened.session.sessionId)!;
    expect(session).toMatchObject({ status: 'ended', isLive: false, endReason: 'lobby_idle', participantCount: 1 });
    expect(session.endedAt).toEqual(date(6 * HOUR));
    expect(session.retainUntil).toBeInstanceOf(Date);
    expect(session.lastActivityAt).toEqual(date(0)); // kept: when it was last used
    expect(deck.status).toBe('ended');
    expect(deck.activeSessionId).toBeNull();
    expect(redis.lastEvent('session:ended')!.payload).toMatchObject({ runNumber: 1, participantCount: 1 });

    // Ending again is a no-op.
    expect(await endIdleSession(opened.session.sessionId, date(100 * HOUR), DEFAULTS)).toBeNull();
    expect(redis.events('session:ended')).toHaveLength(1);
  });

  it('records the host as the reason when the host ends the session', async () => {
    const pid = String(addDeck()._id);
    const opened = await PresentationService.openLobby(pid, OWNER_ID);
    await PresentationService.endPresentation(pid, OWNER_ID);
    expect(models.sessions.find((s) => String(s._id) === opened.session.sessionId)!.endReason).toBe('host');
  });
});
