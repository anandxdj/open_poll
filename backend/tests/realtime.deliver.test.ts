import { describe, expect, it } from 'bun:test';
import type { Server } from 'socket.io';
import type { LiveEventEnvelope } from '../src/common/realtime/events';
import { deliverLiveEvent, parseLiveEnvelope } from '../src/common/realtime/publish';

const PRESENTATION_ID = '64b7f0c2a1b2c3d4e5f60718';
const PARTICIPANT_ID = '64b7f0c2a1b2c3d4e5f6071a';

/** Records `io.local.to(room).emit(...)`; `io.to` throws so a non-local broadcast fails the test. */
function fakeIo() {
  const emits: Array<{ room: string; event: string; data: LiveEventEnvelope }> = [];
  const io = {
    local: {
      to: (room: string) => ({
        emit: (event: string, data: LiveEventEnvelope) => {
          emits.push({ room, event, data });
          return true;
        },
      }),
    },
    to: () => {
      throw new Error('deliverLiveEvent must use io.local');
    },
  };
  return { io: io as unknown as Server, emits };
}

const envelope = (overrides: Partial<LiveEventEnvelope> = {}): LiveEventEnvelope => ({
  v: 1,
  presentationId: PRESENTATION_ID,
  sessionId: null,
  seq: 7,
  type: 'question:started',
  payload: { slide: { index: 0 } },
  audience: 'all',
  emittedAt: new Date().toISOString(),
  quizId: PRESENTATION_ID,
  ...overrides,
});

const deliver = (value: unknown) => {
  const { io, emits } = fakeIo();
  deliverLiveEvent(typeof value === 'string' ? value : JSON.stringify(value), io);
  return emits.map(({ room, event, data }) => ({ room, event, audience: data.audience, seq: data.seq }));
};

describe('deliverLiveEvent', () => {
  it("sends 'all' events to the live room and the legacy room", () => {
    expect(deliver(envelope())).toEqual([
      { room: `live:${PRESENTATION_ID}`, event: 'live:event', audience: 'all', seq: 7 },
      { room: `quiz_${PRESENTATION_ID}`, event: 'quiz:event', audience: 'all', seq: 7 },
    ]);
  });

  it("sends 'host' events to the host rooms only", () => {
    expect(deliver(envelope({ type: 'quiz:ended', audience: 'host' }))).toEqual([
      { room: `live:${PRESENTATION_ID}:host`, event: 'live:event', audience: 'host', seq: 7 },
      { room: `quiz_${PRESENTATION_ID}_host`, event: 'quiz:event', audience: 'host', seq: 7 },
    ]);
  });

  it('sends participant-targeted events to that participant only, with no legacy copy', () => {
    expect(deliver(envelope({ audience: `participant:${PARTICIPANT_ID}` }))).toEqual([
      {
        room: `live:${PRESENTATION_ID}:p:${PARTICIPANT_ID}`,
        event: 'live:event',
        audience: `participant:${PARTICIPANT_ID}`,
        seq: 7,
      },
    ]);
  });

  it('keeps answer:received in the host rooms whatever audience the envelope claims', () => {
    for (const audience of ['all', `participant:${PARTICIPANT_ID}`] as const) {
      expect(deliver(envelope({ type: 'answer:received', audience }))).toEqual([
        { room: `live:${PRESENTATION_ID}:host`, event: 'live:event', audience: 'host', seq: 7 },
        { room: `quiz_${PRESENTATION_ID}_host`, event: 'quiz:event', audience: 'host', seq: 7 },
      ]);
    }
  });

  it('delivers the whole envelope, legacy copy included', () => {
    const { io, emits } = fakeIo();
    const sent = envelope({ sessionId: 's-1' });
    deliverLiveEvent(JSON.stringify(sent), io);
    expect(emits.map((e) => e.data)).toEqual([sent, sent]);
    expect(emits[1]!.data.quizId).toBe(PRESENTATION_ID);
  });

  it('drops malformed messages', () => {
    expect(deliver('not json')).toEqual([]);
    expect(deliver(envelope({ v: 2 as 1 }))).toEqual([]);
    expect(deliver({ ...envelope(), seq: undefined })).toEqual([]);
    expect(deliver({ ...envelope(), presentationId: '' })).toEqual([]);
    expect(deliver(envelope({ audience: 'participant:' }))).toEqual([]);
    expect(deliver(envelope({ audience: 'everyone' as 'all' }))).toEqual([]);
  });
});

describe('parseLiveEnvelope', () => {
  it('accepts a v1 envelope', () => {
    const sent = envelope();
    expect(parseLiveEnvelope(JSON.stringify(sent))).toEqual(sent);
  });

  it('rejects the pre-envelope quiz:event shape', () => {
    const legacy = { quizId: PRESENTATION_ID, type: 'quiz:ended', payload: {}, emittedAt: new Date().toISOString() };
    expect(parseLiveEnvelope(JSON.stringify(legacy))).toBeNull();
  });
});
