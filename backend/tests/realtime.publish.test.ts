import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { redisClient } from '../src/common/config/redis';
import { REALTIME_CHANNELS, type LiveEventEnvelope } from '../src/common/realtime/events';
import { liveSeqKey, publishLiveEvent, resolveAudience } from '../src/common/realtime/publish';
import { publishPresentationEvent } from '../src/modules/presentations/presentations.service';

const PRESENTATION_ID = '64b7f0c2a1b2c3d4e5f60718';
const OTHER_PRESENTATION_ID = '64b7f0c2a1b2c3d4e5f60719';
const PARTICIPANT_ID = '64b7f0c2a1b2c3d4e5f6071a';

/**
 * Stands in for the publish script: INCR per key, then PUBLISH of
 * ARGV[1] .. seq .. ARGV[2] on channel ARGV[4] — exactly what the Lua does.
 */
function stubEval() {
  const original = redisClient.eval;
  const counters = new Map<string, number>();
  const published: Array<{ channel: string; message: string; ttl: string; key: string }> = [];
  let failWith: Error | null = null;

  (redisClient as any).eval = async (_script: string, options: { keys: string[]; arguments: string[] }) => {
    if (failWith) throw failWith;
    const [key] = options.keys;
    const [head, tail, ttl, channel] = options.arguments;
    const seq = (counters.get(key!) ?? 0) + 1;
    counters.set(key!, seq);
    published.push({ channel: channel!, message: `${head}${seq}${tail}`, ttl: ttl!, key: key! });
    return seq;
  };

  return {
    published,
    fail(error: Error) {
      failWith = error;
    },
    restore() {
      (redisClient as any).eval = original;
    },
  };
}

describe('publishLiveEvent', () => {
  let stub: ReturnType<typeof stubEval>;
  beforeEach(() => {
    stub = stubEval();
  });
  afterEach(() => stub.restore());

  it('publishes the v1 envelope on the live channel and returns it', async () => {
    const envelope = await publishLiveEvent({
      presentationId: PRESENTATION_ID,
      type: 'lobby:opened',
      payload: { joinCode: 'ABC123' },
    });

    expect(stub.published).toHaveLength(1);
    const [sent] = stub.published;
    expect(sent!.channel).toBe(REALTIME_CHANNELS.liveEvent);
    expect(sent!.key).toBe(`live:${PRESENTATION_ID}:seq`);
    expect(Number(sent!.ttl)).toBeGreaterThan(0);

    const wire = JSON.parse(sent!.message) as LiveEventEnvelope;
    expect(wire).toEqual(envelope!);
    expect(Object.keys(wire)).toEqual([
      'v',
      'presentationId',
      'sessionId',
      'seq',
      'type',
      'payload',
      'audience',
      'emittedAt',
      'quizId',
    ]);
    expect(wire).toMatchObject({
      v: 1,
      presentationId: PRESENTATION_ID,
      sessionId: null,
      seq: 1,
      type: 'lobby:opened',
      payload: { joinCode: 'ABC123' },
      audience: 'all',
      quizId: PRESENTATION_ID,
    });
    expect(Number.isNaN(Date.parse(wire.emittedAt))).toBe(false);
  });

  it('numbers events per presentation', async () => {
    const seqs = [];
    for (const presentationId of [PRESENTATION_ID, PRESENTATION_ID, OTHER_PRESENTATION_ID, PRESENTATION_ID]) {
      const envelope = await publishLiveEvent({ presentationId, type: 'question:started', payload: {} });
      seqs.push(envelope!.seq);
    }
    expect(seqs).toEqual([1, 2, 1, 3]);
    expect(liveSeqKey(OTHER_PRESENTATION_ID)).toBe(`live:${OTHER_PRESENTATION_ID}:seq`);
  });

  it('keeps payloads intact, including text that looks like envelope JSON', async () => {
    const payload = { text: '"seq":99,"audience":"all"}', emoji: '🎉', nested: { list: [1, null, 'x'] } };
    await publishLiveEvent({ presentationId: PRESENTATION_ID, type: 'question:revealed', payload });
    const wire = JSON.parse(stub.published[0]!.message) as LiveEventEnvelope;
    expect(wire.payload).toEqual(payload);
    expect(wire.seq).toBe(1);
    expect(wire.audience).toBe('all');
  });

  it('carries the session id when given', async () => {
    const envelope = await publishLiveEvent({
      presentationId: PRESENTATION_ID,
      sessionId: 'session-1',
      type: 'quiz:ended',
      payload: {},
    });
    expect(envelope!.sessionId).toBe('session-1');
    expect(JSON.parse(stub.published[0]!.message).sessionId).toBe('session-1');
  });

  it('forces host-only types to the host audience', async () => {
    for (const audience of ['all', `participant:${PARTICIPANT_ID}`, undefined] as const) {
      const envelope = await publishLiveEvent({
        presentationId: PRESENTATION_ID,
        type: 'answer:received',
        payload: { slideIndex: 0, answeredCount: 1 },
        audience,
      });
      expect(envelope!.audience).toBe('host');
    }
    expect(stub.published.map((p) => JSON.parse(p.message).audience)).toEqual(['host', 'host', 'host']);
  });

  it('targets a single participant when asked', async () => {
    const envelope = await publishLiveEvent({
      presentationId: PRESENTATION_ID,
      type: 'question:started',
      payload: {},
      audience: `participant:${PARTICIPANT_ID}`,
    });
    expect(envelope!.audience).toBe(`participant:${PARTICIPANT_ID}`);
  });

  it('refuses a malformed participant audience without publishing', async () => {
    const envelope = await publishLiveEvent({
      presentationId: PRESENTATION_ID,
      type: 'question:started',
      payload: {},
      audience: 'participant:../host',
    });
    expect(envelope).toBeNull();
    expect(stub.published).toHaveLength(0);
  });

  it('resolves to null instead of throwing when Redis fails', async () => {
    stub.fail(new Error('connection lost'));
    const envelope = await publishLiveEvent({ presentationId: PRESENTATION_ID, type: 'quiz:ended', payload: {} });
    expect(envelope).toBeNull();
  });
});

describe('resolveAudience', () => {
  it('uses the type default, honours explicit audiences and pins host-only types', () => {
    expect(resolveAudience('question:started')).toBe('all');
    expect(resolveAudience('question:started', 'host')).toBe('host');
    expect(resolveAudience('answer:received')).toBe('host');
    expect(resolveAudience('answer:received', 'all')).toBe('host');
    expect(resolveAudience('not:a:type')).toBe('all');
  });
});

describe('publishPresentationEvent', () => {
  it('goes through the live envelope', async () => {
    const stub = stubEval();
    try {
      await publishPresentationEvent(PRESENTATION_ID, 'answer:received', { slideIndex: 2, answeredCount: 5 });
      const wire = JSON.parse(stub.published[0]!.message) as LiveEventEnvelope;
      expect(stub.published[0]!.channel).toBe(REALTIME_CHANNELS.liveEvent);
      expect(wire).toMatchObject({
        v: 1,
        presentationId: PRESENTATION_ID,
        quizId: PRESENTATION_ID,
        type: 'answer:received',
        audience: 'host',
        payload: { slideIndex: 2, answeredCount: 5 },
      });
    } finally {
      stub.restore();
    }
  });
});
