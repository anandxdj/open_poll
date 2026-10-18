import type { ExtendedError, Socket } from 'socket.io';
import { verifyAccessToken } from '../utils/jwt.utils';

export interface SocketUser {
  id: string;
  email?: string;
  name?: string;
  role?: string;
  /** Access-token expiry (ms since epoch). The identity is ignored once it passes. */
  expiresAt: number | null;
}

export interface LiveSocketData {
  user: SocketUser | null;
}

const stripBearer = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const token = value.startsWith('Bearer ') ? value.slice('Bearer '.length) : value;
  return token.trim() || null;
};

/** Verifies an access token (bare or `Bearer <jwt>`); null when missing or invalid. */
export const userFromAccessToken = (token: unknown): SocketUser | null => {
  const jwt = stripBearer(token);
  if (!jwt) return null;
  try {
    const decoded = verifyAccessToken(jwt);
    if (!decoded || decoded.id == null) return null;
    return {
      id: String(decoded.id),
      email: typeof decoded.email === 'string' ? decoded.email : undefined,
      name: typeof decoded.name === 'string' ? decoded.name : undefined,
      role: typeof decoded.role === 'string' ? decoded.role : undefined,
      expiresAt: typeof decoded.exp === 'number' ? decoded.exp * 1000 : null,
    };
  } catch {
    return null;
  }
};

/**
 * `io.use` handshake middleware: reads an optional access token from
 * `handshake.auth.token` into `socket.data.user`. Sockets without a token — or
 * with an invalid one — still connect, as `user: null`: participants never need
 * an account, and a stale token must not lock them out of a deck.
 */
export const socketAuth = (socket: Socket, next: (err?: ExtendedError) => void) => {
  (socket.data as LiveSocketData).user = userFromAccessToken(socket.handshake.auth?.token);
  next();
};

/** The handshake identity, or null once its access token has expired. */
export const getSocketUser = (socket: Socket, now = Date.now()): SocketUser | null => {
  const user = (socket.data as Partial<LiveSocketData>).user ?? null;
  if (!user) return null;
  if (user.expiresAt !== null && user.expiresAt <= now) return null;
  return user;
};

/**
 * User id behind a privileged socket action. A token sent with the event wins
 * (the legacy `quiz:join` payload carries one) and must be valid on its own;
 * otherwise the handshake identity is used.
 */
export const resolveSocketUserId = (socket: Socket, accessToken?: unknown): string | null => {
  if (accessToken !== undefined && accessToken !== null && accessToken !== '') {
    return userFromAccessToken(accessToken)?.id ?? null;
  }
  return getSocketUser(socket)?.id ?? null;
};
