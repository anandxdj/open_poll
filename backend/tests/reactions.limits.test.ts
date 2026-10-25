import { describe, expect, it } from 'bun:test';
import {
  allowSocketReaction,
  REACTIONS_PER_SESSION_PER_SEC,
  REACTIONS_PER_SOCKET_PER_SEC,
  reactionKeys,
  sendReaction,
} from '../src/modules/reactions/reactions.service';

const PRESENTATION_ID = '64b7f0c2a1b2c3d4e5f60718';
const PARTICIPANT_ID = '64b7f0c2a1b2c3d4e5f6071a';
const TOKEN = 't'.repeat(48);

const valid = (overrides: Record<string, unknown> = {}) => ({
  presentationId: PRESENTATION_ID,
  participantId: PARTICIPANT_ID,
  participantToken: TOKEN,
  emoji: '👍',
  ...overrides,
});

describe('allowSocketReaction', () => {
  it('lets five through per second and refuses the sixth', () => {
    const socket = {};
    const t0 = 1_000_000;
    for (let i = 0; i < REACTIONS_PER_SOCKET_PER_SEC; i++) expect(allowSocketReaction(socket, t0 + i)).toBe(true);
    expect(allowSocketReaction(socket, t0 + 10)).toBe(false);
    expect(allowSocketReaction(socket, t0 + 999)).toBe(false);
  });

  it('is a sliding window: capacity returns as the oldest reactions age out', () => {
    const socket = {};
    const t0 = 5_000_000;
    allowSocketReaction(socket, t0);
    allowSocketReaction(socket, t0 + 100);
    for (let i = 0; i < 3; i++) allowSocketReaction(socket, t0 + 200);
    expect(allowSocketReaction(socket, t0 + 300)).toBe(false);
    // 1000 ms after the first one only that one has aged out.
    expect(allowSocketReaction(socket, t0 + 1000)).toBe(true);
    expect(allowSocketReaction(socket, t0 + 1001)).toBe(false);
    expect(allowSocketReaction(socket, t0 + 1100)).toBe(true);
  });

  it('counts per socket', () => {
    const a = {};
    const b = {};
    const now = 9_000_000;
    for (let i = 0; i < REACTIONS_PER_SOCKET_PER_SEC; i++) allowSocketReaction(a, now);
    expect(allowSocketReaction(a, now)).toBe(false);
    expect(allowSocketReaction(b, now)).toBe(true);
  });
});

describe('sendReaction input checks (no I/O)', () => {
  it('refuses malformed payloads before touching anything', async () => {
    const cases: unknown[] = [
      null,
      undefined,
      {},
      valid({ presentationId: 'nope' }),
      valid({ presentationId: undefined }),
      valid({ participantId: '123' }),
      valid({ participantToken: 'short' }),
      valid({ participantToken: 'x'.repeat(129) }),
      valid({ participantToken: 42 }),
      valid({ emoji: '' }),
      valid({ emoji: 'x'.repeat(17) }),
      valid({ emoji: 5 }),
      valid({ emoji: undefined }),
    ];
    for (const data of cases) expect(await sendReaction({}, data as never)).toEqual({ ok: false, error: 'INVALID_PAYLOAD' });
  });

  it('rate limits a socket before any lookup', async () => {
    const socket = {};
    for (let i = 0; i < REACTIONS_PER_SOCKET_PER_SEC; i++) allowSocketReaction(socket);
    expect(await sendReaction(socket, valid() as never)).toEqual({ ok: false, error: 'RATE_LIMITED' });
  });

  it('checks the payload before spending the socket budget', async () => {
    const socket = {};
    for (let i = 0; i < 20; i++) await sendReaction(socket, { emoji: '👍' } as never);
    // Still a full budget: none of the invalid sends counted.
    for (let i = 0; i < REACTIONS_PER_SOCKET_PER_SEC; i++) expect(allowSocketReaction(socket)).toBe(true);
  });
});

describe('reaction limits and keys', () => {
  it('documents 5 per socket and 300 per session per second', () => {
    expect(REACTIONS_PER_SOCKET_PER_SEC).toBe(5);
    expect(REACTIONS_PER_SESSION_PER_SEC).toBe(300);
  });

  it('keys share the session hash tag so one Cluster slot holds them', () => {
    const keys = Object.values(reactionKeys).map((key) => key('abc123'));
    expect(keys).toEqual(['reactions:{abc123}:pending', 'reactions:{abc123}:lock', 'reactions:{abc123}:rate']);
  });
});
