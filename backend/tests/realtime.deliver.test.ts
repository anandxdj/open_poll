import { describe, expect, it } from 'bun:test';
import type { Server } from 'socket.io';
import type { LiveEventEnvelope } from '../src/common/realtime/events';
import { deliverLiveEvent, parseLiveEnvelope } from '../src/common/realtime/publish';
import { registerScreenView } from '../src/common/realtime/screenViews';

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
  it("sends 'all' events to the live room only (no legacy quiz:event copy)", () => {
    expect(deliver(envelope())).toEqual([
      { room: `live:${PRESENTATION_ID}`, event: 'live:event', audience: 'all', seq: 7 },
    ]);
  });

  it("sends 'host' events to the host room only", () => {
    expect(deliver(envelope({ type: 'quiz:ended', audience: 'host' }))).toEqual([
      { room: `live:${PRESENTATION_ID}:host`, event: 'live:event', audience: 'host', seq: 7 },
    ]);
  });

  it('sends participant-targeted events to that participant only', () => {
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
    // No screen view in this test: nothing but the host room.
    const undo = registerScreenView('answer:received', () => null);
    try {
      for (const audience of ['all', `participant:${PARTICIPANT_ID}`] as const) {
        expect(deliver(envelope({ type: 'answer:received', audience }))).toEqual([
          { room: `live:${PRESENTATION_ID}:host`, event: 'live:event', audience: 'host', seq: 7 },
        ]);
      }
    } finally {
      undo();
    }
  });

  it('sends screens (W4-D) a host event only through its screen view', () => {
    const { io, emits } = fakeIo();
    const undo = registerScreenView('answer:received', (payload) => ({ ...payload, secret: undefined, screened: true }));
    try {
      deliverLiveEvent(JSON.stringify(envelope({ type: 'answer:received', audience: 'all', payload: { secret: 'key', n: 1 } })), io);
      // A host event without a view, and an `all` event (screens get it through the `all` room).
      deliverLiveEvent(JSON.stringify(envelope({ type: 'quiz:ended', audience: 'host' })), io);
      deliverLiveEvent(JSON.stringify(envelope()), io);
    } finally {
      undo();
    }
    const screen = emits.filter((e) => e.room === `live:${PRESENTATION_ID}:screen`);
    expect(screen).toHaveLength(1);
    expect(screen[0]!.event).toBe('live:event');
    expect(screen[0]!.data.payload).toEqual({ n: 1, screened: true });
    expect(screen[0]!.data.type).toBe('answer:received');
    // Participants never get it, screens or not.
    expect(emits.some((e) => e.room === `live:${PRESENTATION_ID}` && e.data.type === 'answer:received')).toBe(false);
  });

  it('skips the screen copy when the view returns null or throws', () => {
    const { io, emits } = fakeIo();
    const undoNull = registerScreenView('answer:received', () => null);
    deliverLiveEvent(JSON.stringify(envelope({ type: 'answer:received', audience: 'host' })), io);
    undoNull();
    const undoThrow = registerScreenView('answer:received', () => {
      throw new Error('boom');
    });
    deliverLiveEvent(JSON.stringify(envelope({ type: 'answer:received', audience: 'host' })), io);
    undoThrow();
    expect(emits.filter((e) => e.room.endsWith(':screen'))).toHaveLength(0);
    expect(emits.filter((e) => e.room === `live:${PRESENTATION_ID}:host`)).toHaveLength(2);
  });

  it('delivers the whole envelope once, as live:event', () => {
    const { io, emits } = fakeIo();
    const sent = envelope({ sessionId: 's-1' });
    deliverLiveEvent(JSON.stringify(sent), io);
    expect(emits.map((e) => e.data)).toEqual([sent]);
    expect(emits.map((e) => e.event)).toEqual(['live:event']);
    expect(emits[0]!.data.quizId).toBe(PRESENTATION_ID);
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
