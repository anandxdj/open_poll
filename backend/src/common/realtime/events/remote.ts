import { defineLiveEvents } from './envelope';

// ---------- Phone remote events (modules/remote, W2-A) ----------

export const REMOTE_EVENTS = defineLiveEvents({
  // The paired phone remote connected (its first socket joined) / disconnected (its last socket left).
  'remote:connected': { audience: 'host' },
  'remote:disconnected': { audience: 'host' },
});

export type RemoteEventType = keyof typeof REMOTE_EVENTS;

export const REMOTE_SOCKET_EVENTS = {
  // Client → server: `{token, deviceKey}` with an ack `{ok, state} | {ok: false, error}`.
  remoteJoin: 'remote:join',
  // Client → server: `{command}` (next|prev|reveal|close|extend30|pause|resume) with an ack.
  remoteCommand: 'remote:command',
  // Server → remote socket: the pairing was revoked (or replaced); the socket left the deck's rooms.
  remoteRevoked: 'remote:revoked',
} as const;
