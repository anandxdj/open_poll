import type { Server, Socket } from 'socket.io';
import { REALTIME_CHANNELS, SOCKET_EVENTS } from '../../common/realtime/events';
import { registerSocketModule } from '../../common/realtime/registry';
import { allowJoin, leavePresentationRooms, liveRooms } from '../../common/realtime/rooms';
import { ApiError } from '../../common/utils/ApiError';
import {
  REMOTE_COMMANDS,
  REMOTE_ERROR_CODES,
  type RemoteCommand,
  type RemoteCommandAck,
  type RemoteJoinAck,
} from './remote.contract';
import { noteRemoteSocketJoined, noteRemoteSocketLeft, RemoteService } from './remote.service';

/**
 * Phone remote sockets (W2-A).
 *
 * - `remote:join {token, deviceKey}` → redeems the pairing (the first device
 *   binds it) and joins `live:{pid}` (the public events every participant gets:
 *   slide changes, timing) plus `live:{pid}:remote`; acks the remote state. The
 *   host hears `remote:connected` when the deck's first remote socket arrives.
 * - `remote:command {command}` (next|prev|reveal|close|extend30|pause|resume) →
 *   re-checks the pairing, runs the host command as the host who paired, acks
 *   the new state or the refusal.
 * - Disconnecting the last remote socket sends `remote:disconnected`.
 * - `remote:control` (Redis channel) `{kind: 'revoke', presentationId}` drops the
 *   deck's remote sockets out of its rooms on every instance and tells them
 *   (`remote:revoked`).
 */

interface RemoteSocketData {
  presentationId: string;
  tokenId: string;
}

const remoteRoom = (presentationId: string) => `${liveRooms.all(presentationId)}:remote`;

/** Commands per socket: enough for a presenter tapping fast, not for a script. */
const COMMANDS_PER_SOCKET = { max: 30, windowMs: 10_000 };
const commandWindows = new WeakMap<Socket, { count: number; windowStart: number }>();

const allowCommand = (socket: Socket, now = Date.now()) => {
  let window = commandWindows.get(socket);
  if (!window || now - window.windowStart > COMMANDS_PER_SOCKET.windowMs) {
    window = { count: 0, windowStart: now };
    commandWindows.set(socket, window);
  }
  window.count += 1;
  return window.count <= COMMANDS_PER_SOCKET.max;
};

const remoteOf = (socket: Socket): RemoteSocketData | null => (socket.data?.remote as RemoteSocketData | undefined) ?? null;

const reply = <T>(ack: unknown, value: T) => {
  if (typeof ack === 'function') ack(value);
};

const isCommand = (value: unknown): value is RemoteCommand =>
  typeof value === 'string' && (REMOTE_COMMANDS as readonly string[]).includes(value);

/** Leaves the deck's rooms and forgets the pairing (revoked, replaced, or a new join elsewhere). */
const detach = (socket: Socket) => {
  const remote = remoteOf(socket);
  if (!remote) return null;
  leavePresentationRooms(socket, remote.presentationId);
  socket.data.remote = null;
  return remote;
};

const handleJoin = async (socket: Socket, data: { token?: unknown; deviceKey?: unknown } | null, ack: unknown) => {
  if (!allowJoin(socket)) return reply<RemoteJoinAck>(ack, { ok: false, error: 'RATE_LIMITED' });
  if (!data || typeof data !== 'object') return reply<RemoteJoinAck>(ack, { ok: false, error: 'INVALID_PAYLOAD' });
  try {
    const pairing = await RemoteService.redeem(data.token, data.deviceKey);
    const presentationId = String(pairing.presentationId);
    const previous = detach(socket);
    if (previous && previous.presentationId !== presentationId) void noteRemoteSocketLeft(previous.presentationId, socket.id);
    socket.data.remote = { presentationId, tokenId: String(pairing._id) } satisfies RemoteSocketData;
    socket.join(liveRooms.all(presentationId));
    socket.join(remoteRoom(presentationId));
    await noteRemoteSocketJoined(presentationId, socket.id);
    reply<RemoteJoinAck>(ack, { ok: true, state: await RemoteService.state(presentationId) });
  } catch (error) {
    if (error instanceof ApiError) {
      if (error.code === REMOTE_ERROR_CODES.bound) return reply<RemoteJoinAck>(ack, { ok: false, error: 'REMOTE_BOUND' });
      if (error.statusCode === 400) return reply<RemoteJoinAck>(ack, { ok: false, error: 'INVALID_PAYLOAD' });
      return reply<RemoteJoinAck>(ack, { ok: false, error: 'REMOTE_INVALID' });
    }
    console.error('[Remote] remote:join failed:', error);
    reply<RemoteJoinAck>(ack, { ok: false, error: 'UNAVAILABLE' });
  }
};

const handleCommand = async (socket: Socket, data: { command?: unknown } | null, ack: unknown) => {
  const remote = remoteOf(socket);
  if (!remote) return reply<RemoteCommandAck>(ack, { ok: false, error: 'NOT_JOINED' });
  if (!allowCommand(socket)) return reply<RemoteCommandAck>(ack, { ok: false, error: 'RATE_LIMITED' });
  const command = data?.command;
  if (!isCommand(command)) return reply<RemoteCommandAck>(ack, { ok: false, error: 'INVALID_PAYLOAD' });

  let pairing;
  try {
    pairing = await RemoteService.requireActive(remote.tokenId);
  } catch {
    detach(socket);
    void noteRemoteSocketLeft(remote.presentationId, socket.id);
    return reply<RemoteCommandAck>(ack, { ok: false, error: 'REMOTE_INVALID' });
  }
  try {
    const state = await RemoteService.command(pairing, command);
    reply<RemoteCommandAck>(ack, { ok: true, command, state });
  } catch (error) {
    if (error instanceof ApiError) {
      return reply<RemoteCommandAck>(ack, {
        ok: false,
        error: error.statusCode === 401 || error.statusCode === 403 ? 'FORBIDDEN' : 'COMMAND_FAILED',
        ...(error.code ? { code: error.code } : {}),
        message: error.message,
      });
    }
    console.error('[Remote] remote:command failed:', error);
    reply<RemoteCommandAck>(ack, { ok: false, error: 'UNAVAILABLE' });
  }
};

/** Channel handler (every instance): a revoked pairing's sockets leave and are told. */
const applyRemoteControl = (raw: string, io: Server) => {
  let message: { kind?: unknown; presentationId?: unknown };
  try {
    message = JSON.parse(raw) as typeof message;
  } catch {
    return;
  }
  if (message.kind !== 'revoke' || typeof message.presentationId !== 'string') return;
  const presentationId = message.presentationId;
  void io.local
    .in(remoteRoom(presentationId))
    .fetchSockets()
    .then((sockets) => {
      for (const remote of sockets) {
        const socket = remote as unknown as Socket;
        detach(socket);
        socket.emit(SOCKET_EVENTS.remoteRevoked, { presentationId });
      }
    })
    .catch((error) => console.error('[Remote] Failed to drop revoked remotes:', error));
};

export const remoteSocketModule = registerSocketModule({
  name: 'remote',

  channels: { [REALTIME_CHANNELS.remoteControl]: applyRemoteControl },

  onConnection(socket) {
    socket.on(SOCKET_EVENTS.remoteJoin, (data: { token?: unknown; deviceKey?: unknown } | null, ack?: unknown) =>
      handleJoin(socket, data, ack)
    );
    socket.on(SOCKET_EVENTS.remoteCommand, (data: { command?: unknown } | null, ack?: unknown) =>
      handleCommand(socket, data, ack)
    );
    socket.on('disconnect', () => {
      const remote = remoteOf(socket);
      if (remote) void noteRemoteSocketLeft(remote.presentationId, socket.id);
    });
  },
});
