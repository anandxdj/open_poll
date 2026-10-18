import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import type { Server, Socket } from 'socket.io';
import '../src/common/realtime/modules';
import { MAX_JOINS_PER_MINUTE } from '../src/common/realtime/rooms';
import { getSocketModules, registerSocketModule } from '../src/common/realtime/registry';
import { generateAccessToken } from '../src/common/utils/jwt.utils';
import { PollModel } from '../src/modules/polls/polls.model';
import { PresentationService } from '../src/modules/presentations/presentations.service';

const PID = '64b7f0c2a1b2c3d4e5f60718';
const POLL_ID = '64b7f0c2a1b2c3d4e5f60719';
const PARTICIPANT_ID = '64b7f0c2a1b2c3d4e5f6071a';
const HOST_ID = '64b7f0c2a1b2c3d4e5f60720';
const PARTICIPANT_TOKEN = 'p'.repeat(32);

const hostToken = (id = HOST_ID) => generateAccessToken({ id, email: 'h@example.com', name: 'H', role: 'user' });

/** A socket that records handlers and room membership, wired to every registered module. */
function connect(user: { id: string } | null = null) {
  const handlers = new Map<string, (...args: any[]) => unknown>();
  const rooms = new Set<string>(['socket-id']);
  const socket = {
    id: 'socket-id',
    data: { user: user ? { ...user, expiresAt: null } : null },
    handshake: { auth: {} },
    rooms,
    on: (event: string, fn: (...args: any[]) => unknown) => handlers.set(event, fn),
    join: (room: string) => rooms.add(room),
    leave: (room: string) => rooms.delete(room),
  } as unknown as Socket;
  for (const module of getSocketModules()) module.onConnection?.(socket, {} as Server);

  const emit = async (event: string, ...args: unknown[]) => {
    const handler = handlers.get(event);
    if (!handler) throw new Error(`no handler for ${event}`);
    await handler(...args);
  };
  const ack = async (event: string, payload: unknown) => {
    let reply: unknown;
    await emit(event, payload, (r: unknown) => {
      reply = r;
    });
    return reply;
  };
  const joined = () => [...rooms].filter((r) => r !== 'socket-id').sort();
  return { emit, ack, joined };
}

describe('socket module registry', () => {
  it('registers the polls and presentations modules', () => {
    expect(getSocketModules().map((m) => m.name)).toEqual(['polls', 'presentations']);
  });

  it('refuses a second module with the same name', () => {
    expect(() => registerSocketModule({ name: 'polls' })).toThrow('registered twice');
    expect(getSocketModules()).toHaveLength(2);
  });
});

describe('presentations socket module', () => {
  const original = {
    isOwner: PresentationService.isOwner,
    isAuthorizedParticipant: PresentationService.isAuthorizedParticipant,
  };
  const ownerCalls: Array<[string, string]> = [];
  const participantCalls: Array<[string, string, string]> = [];

  beforeEach(() => {
    ownerCalls.length = 0;
    participantCalls.length = 0;
    (PresentationService as any).isOwner = async (presentationId: string, userId: string) => {
      ownerCalls.push([presentationId, userId]);
      return userId === HOST_ID;
    };
    (PresentationService as any).isAuthorizedParticipant = async (
      presentationId: string,
      participantId: string,
      token: string
    ) => {
      participantCalls.push([presentationId, participantId, token]);
      return token === PARTICIPANT_TOKEN;
    };
  });

  afterEach(() => {
    (PresentationService as any).isOwner = original.isOwner;
    (PresentationService as any).isAuthorizedParticipant = original.isAuthorizedParticipant;
  });

  describe('legacy quiz:join', () => {
    it('puts an owner in the legacy and live host rooms', async () => {
      const socket = connect();
      await socket.emit('quiz:join', { quizId: PID, role: 'host', accessToken: hostToken() });
      expect(ownerCalls).toEqual([[PID, HOST_ID]]);
      expect(socket.joined()).toEqual([`live:${PID}`, `live:${PID}:host`, `quiz_${PID}`, `quiz_${PID}_host`].sort());
    });

    it('accepts the handshake identity when no access token is sent', async () => {
      const socket = connect({ id: HOST_ID });
      await socket.emit('quiz:join', { quizId: PID, role: 'host' });
      expect(socket.joined()).toContain(`quiz_${PID}_host`);
    });

    it('drops hosts that are not the owner or not authenticated', async () => {
      const other = connect();
      await other.emit('quiz:join', { quizId: PID, role: 'host', accessToken: hostToken(PARTICIPANT_ID) });
      const anonymous = connect();
      await anonymous.emit('quiz:join', { quizId: PID, role: 'host' });
      const badToken = connect({ id: HOST_ID });
      await badToken.emit('quiz:join', { quizId: PID, role: 'host', accessToken: 'garbage' });
      expect(other.joined()).toEqual([]);
      expect(anonymous.joined()).toEqual([]);
      expect(badToken.joined()).toEqual([]);
    });

    it('puts a verified participant in the shared rooms and its own room, never a host room', async () => {
      const socket = connect();
      await socket.emit('quiz:join', {
        quizId: PID,
        role: 'participant',
        participantId: PARTICIPANT_ID,
        participantToken: PARTICIPANT_TOKEN,
      });
      expect(participantCalls).toEqual([[PID, PARTICIPANT_ID, PARTICIPANT_TOKEN]]);
      expect(socket.joined()).toEqual([`live:${PID}`, `live:${PID}:p:${PARTICIPANT_ID}`, `quiz_${PID}`].sort());
    });

    it('drops participants with a wrong token or a malformed payload', async () => {
      const socket = connect();
      await socket.emit('quiz:join', {
        quizId: PID,
        role: 'participant',
        participantId: PARTICIPANT_ID,
        participantToken: 'x'.repeat(32),
      });
      await socket.emit('quiz:join', { quizId: PID, role: 'participant', participantId: PARTICIPANT_ID });
      await socket.emit('quiz:join', { quizId: 'nope', role: 'participant' });
      await socket.emit('quiz:join', null);
      expect(socket.joined()).toEqual([]);
    });

    it('quiz:leave leaves every room of that presentation', async () => {
      const socket = connect();
      await socket.emit('quiz:join', { quizId: PID, role: 'host', accessToken: hostToken() });
      await socket.emit('quiz:leave', PID);
      expect(socket.joined()).toEqual([]);
    });
  });

  describe('live:join', () => {
    it('joins only the live rooms and acks the role', async () => {
      const host = connect({ id: HOST_ID });
      expect(await host.ack('live:join', { presentationId: PID, role: 'host' })).toEqual({ ok: true, role: 'host' });
      expect(host.joined()).toEqual([`live:${PID}`, `live:${PID}:host`]);

      const participant = connect();
      expect(
        await participant.ack('live:join', {
          presentationId: PID,
          role: 'participant',
          participantId: PARTICIPANT_ID,
          participantToken: PARTICIPANT_TOKEN,
        })
      ).toEqual({ ok: true, role: 'participant' });
      expect(participant.joined()).toEqual([`live:${PID}`, `live:${PID}:p:${PARTICIPANT_ID}`]);
    });

    it('acks the reason a join was refused', async () => {
      const socket = connect();
      expect(await socket.ack('live:join', { presentationId: PID, role: 'host' })).toEqual({
        ok: false,
        error: 'UNAUTHENTICATED',
      });
      expect(await socket.ack('live:join', { presentationId: PID, role: 'host', accessToken: hostToken(PARTICIPANT_ID) })).toEqual({
        ok: false,
        error: 'FORBIDDEN',
      });
      expect(
        await socket.ack('live:join', {
          presentationId: PID,
          role: 'participant',
          participantId: PARTICIPANT_ID,
          participantToken: 'x'.repeat(32),
        })
      ).toEqual({ ok: false, error: 'FORBIDDEN' });
      expect(await socket.ack('live:join', { presentationId: PID, role: 'screen' })).toEqual({
        ok: false,
        error: 'INVALID_PAYLOAD',
      });
      expect(await socket.ack('live:join', { presentationId: 'nope', role: 'host' })).toEqual({
        ok: false,
        error: 'INVALID_PAYLOAD',
      });
      expect(socket.joined()).toEqual([]);
    });

    it('shares the per-connection join budget with quiz:join', async () => {
      const socket = connect({ id: HOST_ID });
      for (let i = 0; i < MAX_JOINS_PER_MINUTE; i++) {
        await socket.emit('quiz:join', { quizId: PID, role: 'host' });
      }
      expect(await socket.ack('live:join', { presentationId: PID, role: 'host' })).toEqual({
        ok: false,
        error: 'RATE_LIMITED',
      });
    });

    it('live:leave leaves the presentation and acks', async () => {
      const socket = connect({ id: HOST_ID });
      await socket.ack('live:join', { presentationId: PID, role: 'host' });
      expect(await socket.ack('live:leave', { presentationId: PID })).toEqual({ ok: true });
      expect(socket.joined()).toEqual([]);
      expect(await socket.ack('live:leave', { presentationId: 'nope' })).toEqual({ ok: false });
    });

    it('works without an ack callback', async () => {
      const socket = connect({ id: HOST_ID });
      await socket.emit('live:join', { presentationId: PID, role: 'host' });
      expect(socket.joined()).toEqual([`live:${PID}`, `live:${PID}:host`]);
    });
  });
});

describe('polls socket module', () => {
  const originalFindById = PollModel.findById;
  let isPublished = true;

  beforeEach(() => {
    (PollModel as any).findById = () => ({ select: async () => ({ isPublished }) });
  });
  afterEach(() => {
    (PollModel as any).findById = originalFindById;
  });

  it('joins and leaves the room of a published poll', async () => {
    isPublished = true;
    const socket = connect();
    await socket.emit('poll:join', POLL_ID);
    expect(socket.joined()).toEqual([`poll_${POLL_ID}`]);
    await socket.emit('poll:leave', POLL_ID);
    expect(socket.joined()).toEqual([]);
  });

  it('ignores unpublished polls and invalid ids', async () => {
    isPublished = false;
    const socket = connect();
    await socket.emit('poll:join', POLL_ID);
    await socket.emit('poll:join', { $gt: '' });
    expect(socket.joined()).toEqual([]);
  });

  it('delivers analytics to the poll room through io.local', () => {
    const module = getSocketModules().find((m) => m.name === 'polls')!;
    const emits: Array<[string, string, unknown]> = [];
    const io = {
      local: { to: (room: string) => ({ emit: (event: string, data: unknown) => emits.push([room, event, data]) }) },
      to: () => {
        throw new Error('must use io.local');
      },
    } as unknown as Server;
    const analytics = { pollId: POLL_ID, totalResponses: 3, questionSummaries: [], emittedAt: 'now' };

    module.channels!['analytics:update']!(JSON.stringify({ pollId: POLL_ID, analytics }), io);

    expect(emits).toEqual([[`poll_${POLL_ID}`, 'analytics:update', analytics]]);
  });
});
