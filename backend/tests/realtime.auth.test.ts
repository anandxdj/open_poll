import { describe, expect, it } from 'bun:test';
import jwt from 'jsonwebtoken';
import type { Socket } from 'socket.io';
import {
  getSocketUser,
  resolveSocketUserId,
  socketAuth,
  userFromAccessToken,
} from '../src/common/realtime/auth';
import { generateAccessToken } from '../src/common/utils/jwt.utils';

const USER_ID = '64b7f0c2a1b2c3d4e5f60720';
const OTHER_USER_ID = '64b7f0c2a1b2c3d4e5f60721';

const accessToken = (id = USER_ID) =>
  generateAccessToken({ id, email: 'host@example.com', name: 'Host', role: 'user' });

/** Runs the handshake middleware on a fake socket; returns the socket and what `next` got. */
const handshake = (auth: Record<string, unknown> = {}) => {
  const socket = { handshake: { auth }, data: {} } as unknown as Socket;
  const nextArgs: unknown[][] = [];
  socketAuth(socket, (...args: unknown[]) => {
    nextArgs.push(args);
  });
  return { socket, nextArgs };
};

describe('socketAuth', () => {
  it('lets anonymous sockets connect with no user', () => {
    const { socket, nextArgs } = handshake();
    expect(nextArgs).toEqual([[]]);
    expect(socket.data.user).toBeNull();
  });

  it('reads a Bearer token into socket.data.user', () => {
    const { socket, nextArgs } = handshake({ token: `Bearer ${accessToken()}` });
    expect(nextArgs).toEqual([[]]);
    expect(socket.data.user).toMatchObject({ id: USER_ID, email: 'host@example.com', name: 'Host', role: 'user' });
    expect(socket.data.user.expiresAt).toBeGreaterThan(Date.now());
  });

  it('accepts a bare JWT too', () => {
    const { socket } = handshake({ token: accessToken() });
    expect(socket.data.user?.id).toBe(USER_ID);
  });

  it('connects sockets with an invalid token as anonymous instead of rejecting them', () => {
    for (const token of ['Bearer not-a-jwt', jwt.sign({ id: USER_ID }, 'wrong-secret'), 42, '']) {
      const { socket, nextArgs } = handshake({ token });
      expect(nextArgs).toEqual([[]]);
      expect(socket.data.user).toBeNull();
    }
  });
});

describe('getSocketUser', () => {
  it('stops trusting the handshake identity once its token expires', () => {
    const { socket } = handshake({ token: accessToken() });
    const expiresAt = socket.data.user.expiresAt as number;
    expect(getSocketUser(socket, expiresAt - 1)?.id).toBe(USER_ID);
    expect(getSocketUser(socket, expiresAt)).toBeNull();
  });
});

describe('resolveSocketUserId', () => {
  it('prefers a token sent with the event', () => {
    const { socket } = handshake({ token: accessToken(USER_ID) });
    expect(resolveSocketUserId(socket, accessToken(OTHER_USER_ID))).toBe(OTHER_USER_ID);
  });

  it('does not fall back to the handshake when the event token is invalid', () => {
    const { socket } = handshake({ token: accessToken(USER_ID) });
    expect(resolveSocketUserId(socket, 'garbage')).toBeNull();
  });

  it('falls back to the handshake identity when the event carries no token', () => {
    const { socket } = handshake({ token: accessToken(USER_ID) });
    expect(resolveSocketUserId(socket)).toBe(USER_ID);
    expect(resolveSocketUserId(handshake().socket)).toBeNull();
  });
});

describe('userFromAccessToken', () => {
  it('rejects expired tokens', () => {
    // Same secret resolution as jwt.utils, so only the expiry can fail verification.
    const secret = process.env.JWT_ACCESS_SECRET || process.env.JWT_SECRET || 'access-secret';
    const expired = jwt.sign({ id: USER_ID, exp: Math.floor(Date.now() / 1000) - 10 }, secret);
    expect(userFromAccessToken(expired)).toBeNull();
  });
});
