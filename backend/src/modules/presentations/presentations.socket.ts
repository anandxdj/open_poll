import type { Socket } from 'socket.io';
import { redisClient } from '../../common/config/redis';
import { ApiError } from '../../common/utils/ApiError';
import { resolveSocketUserId } from '../../common/realtime/auth';
import { liveSeqKey } from '../../common/realtime/publish';
import { SOCKET_EVENTS, type LiveRole } from '../../common/realtime/events';
import { registerSocketModule } from '../../common/realtime/registry';
import { registerScreenView } from '../../common/realtime/screenViews';
import { allowJoin, isValidObjectId, leavePresentationRooms, liveRooms } from '../../common/realtime/rooms';
import { PresentationService } from './presentations.service';
import { authorizeScreen } from '../embeds/screenTokens.service';
import { getScreenState } from '../embeds/stage.service';
import { stripAnswerKeys } from '../embeds/stageSafe';
import { screenTokensOf } from '../embeds/screenSockets';
import { submitPresentationAnswerSchema } from './presentations.schema';
import {
  LIVE_ERROR_CODES,
  type AnswerSubmitAck,
  type HostStateResponse,
  type LiveResyncAck,
  type LiveResyncPayload,
} from './live/contract';

interface JoinCredentials {
  role?: LiveRole;
  /** Host only. Optional when the socket authenticated at the handshake. */
  accessToken?: string;
  participantId?: string;
  participantToken?: string;
  /** Screen only (W4-D): a screen token of this deck. */
  screenToken?: string;
}

interface LiveJoinPayload extends JoinCredentials {
  presentationId?: string;
}

export type LiveJoinError = 'INVALID_PAYLOAD' | 'RATE_LIMITED' | 'UNAUTHENTICATED' | 'FORBIDDEN';

export type LiveJoinAck = { ok: true; role: LiveRole } | { ok: false; error: LiveJoinError };

type JoinGrant =
  | { role: 'host' }
  | { role: 'participant'; participantId: string }
  | { role: 'screen'; screenTokenId: string };

/**
 * Decides whether a socket may follow a deck, without touching rooms. Hosts need
 * `deck:host` on the deck (its creator, or a member of its workspace whose role
 * allows hosting); participants must present the token issued by `POST /:id/join`;
 * screens a live screen token of that deck, which must allow embedding (W4-D).
 */
const authorizeJoin = async (
  socket: Socket,
  presentationId: string,
  credentials: JoinCredentials
): Promise<JoinGrant | LiveJoinError> => {
  if (credentials.role === 'host') {
    const userId = resolveSocketUserId(socket, credentials.accessToken);
    if (!userId) return 'UNAUTHENTICATED';
    const allowed = await PresentationService.canHost(presentationId, userId).catch(() => false);
    return allowed ? { role: 'host' } : 'FORBIDDEN';
  }

  if (credentials.role === 'screen') {
    if (typeof credentials.screenToken !== 'string' || !credentials.screenToken) return 'INVALID_PAYLOAD';
    const screen = await authorizeScreen(presentationId, credentials.screenToken).catch(() => null);
    return screen ? { role: 'screen', screenTokenId: String(screen.token._id) } : 'FORBIDDEN';
  }

  if (credentials.role === 'participant') {
    const { participantId, participantToken } = credentials;
    if (!isValidObjectId(participantId) || typeof participantToken !== 'string' || !participantToken) {
      return 'INVALID_PAYLOAD';
    }
    const authorized = await PresentationService.isAuthorizedParticipant(
      presentationId,
      participantId,
      participantToken
    ).catch(() => false);
    return authorized ? { role: 'participant', participantId } : 'FORBIDDEN';
  }

  return 'INVALID_PAYLOAD';
};

const joinLiveRooms = (socket: Socket, presentationId: string, grant: JoinGrant) => {
  socket.join(liveRooms.all(presentationId));
  if (grant.role === 'host') socket.join(liveRooms.host(presentationId));
  else if (grant.role === 'participant') socket.join(liveRooms.participant(presentationId, grant.participantId));
  else {
    // Never the host room: a screen gets host events only as their screen views.
    socket.join(liveRooms.screen(presentationId));
    screenTokensOf(socket).set(presentationId, grant.screenTokenId);
  }
};

const leaveTarget = (data: unknown): string | null => {
  const presentationId =
    typeof data === 'string' ? data : (data as { presentationId?: unknown } | null)?.presentationId;
  return isValidObjectId(presentationId) ? presentationId : null;
};

// ---------------------------------------------------------------------------
// answer:submit and live:resync
// ---------------------------------------------------------------------------

/**
 * Per-connection budgets, in memory: they keep one socket from spraying the
 * Redis-backed paths below. The per-participant answer budget lives in the
 * answer script and covers every channel.
 */
const ANSWERS_PER_SOCKET = { max: 120, windowMs: 10_000 };
const RESYNCS_PER_SOCKET = { max: 20, windowMs: 60_000 };

const budgets = new WeakMap<Socket, Map<string, { count: number; windowStart: number }>>();

const withinBudget = (
  socket: Socket,
  bucket: string,
  { max, windowMs }: { max: number; windowMs: number },
  now = Date.now()
) => {
  let perSocket = budgets.get(socket);
  if (!perSocket) budgets.set(socket, (perSocket = new Map()));
  let window = perSocket.get(bucket);
  if (!window || now - window.windowStart > windowMs) {
    window = { count: 0, windowStart: now };
    perSocket.set(bucket, window);
  }
  window.count += 1;
  return window.count <= max;
};

const ackWith = (ack: unknown) => (result: unknown) => {
  if (typeof ack === 'function') ack(result);
};

const failedAnswer = (status: number, message: string, code?: string): AnswerSubmitAck => ({
  success: false,
  status,
  message,
  ...(code ? { code } : {}),
  data: null,
});

/**
 * `answer:submit` — the REST answer, over the socket. The payload is the REST
 * body plus `presentationId`. Two things are required: the socket joined the
 * deck as that participant (`live:join` with the participant's token, so an
 * anonymous connection never reaches the answer path), and the
 * participant token travels in the payload (the identity is the token, checked
 * by the answer script on every answer — being in a room proves nothing by
 * itself). The ack is the REST envelope with the status the HTTP call would
 * have returned.
 */
const handleAnswerSubmit = async (socket: Socket, data: unknown, ack: unknown) => {
  const reply = ackWith(ack);
  if (!withinBudget(socket, 'answer', ANSWERS_PER_SOCKET)) {
    return reply(failedAnswer(429, 'Too many answers, slow down', LIVE_ERROR_CODES.answerRateLimited));
  }
  const presentationId = (data as { presentationId?: unknown } | null)?.presentationId;
  if (!isValidObjectId(presentationId)) return reply(failedAnswer(400, 'presentationId is required', 'INVALID_PAYLOAD'));
  const parsed = submitPresentationAnswerSchema.safeParse(data);
  if (!parsed.success) {
    const message = parsed.error.issues.map((issue) => `${issue.path.join('.') || 'body'}: ${issue.message}`).join('; ');
    return reply(failedAnswer(400, message, 'INVALID_PAYLOAD'));
  }
  if (!socket.rooms.has(liveRooms.participant(presentationId, parsed.data.participantId))) {
    return reply(failedAnswer(403, 'Join the presentation as this participant before answering', 'NOT_JOINED'));
  }
  try {
    const result = await PresentationService.submitAnswer(presentationId, parsed.data, { via: 'socket' });
    reply({ success: true, status: 200, message: 'Answer accepted', data: result } satisfies AnswerSubmitAck);
  } catch (error) {
    if (error instanceof ApiError) return reply(failedAnswer(error.statusCode, error.message, error.code));
    console.error('[Presentation] answer:submit failed:', error);
    reply(failedAnswer(500, 'Internal server error'));
  }
};

const resyncFailure = (error: unknown): LiveResyncAck => {
  if (error instanceof ApiError) {
    if (error.statusCode === 401) return { ok: false, error: 'UNAUTHENTICATED' };
    if (error.statusCode === 403) return { ok: false, error: 'FORBIDDEN' };
    if (error.statusCode === 404) return { ok: false, error: 'NOT_FOUND' };
  } else {
    console.error('[Presentation] live:resync failed:', error);
  }
  return { ok: false, error: 'UNAVAILABLE' };
};

/**
 * `live:resync` — the state a reconnecting client needs, over the socket it
 * already has: `live-state` for a participant (token required), `host/state` for
 * the host (access token, or the handshake identity, with `deck:host`). The ack
 * carries the deck's current `seq`, read BEFORE the state, so every event after
 * it is either in the state or still to come.
 */
const handleLiveResync = async (socket: Socket, data: LiveResyncPayload | null, ack: unknown) => {
  const reply = ackWith(ack);
  if (!withinBudget(socket, 'resync', RESYNCS_PER_SOCKET)) return reply({ ok: false, error: 'RATE_LIMITED' } satisfies LiveResyncAck);
  const presentationId = data?.presentationId;
  if (!isValidObjectId(presentationId) || (data?.role !== 'host' && data?.role !== 'participant' && data?.role !== 'screen')) {
    return reply({ ok: false, error: 'INVALID_PAYLOAD' } satisfies LiveResyncAck);
  }

  try {
    if (data.role === 'screen') {
      if (typeof data.screenToken !== 'string' || !data.screenToken) {
        return reply({ ok: false, error: 'INVALID_PAYLOAD' } satisfies LiveResyncAck);
      }
      const seq = Number((await redisClient.get(liveSeqKey(presentationId)).catch(() => null)) ?? 0);
      const state = await getScreenState(presentationId, data.screenToken);
      return reply({ ok: true, role: 'screen', seq, state: state as unknown as HostStateResponse } satisfies LiveResyncAck);
    }

    if (data.role === 'host') {
      const userId = resolveSocketUserId(socket, data.accessToken);
      if (!userId) return reply({ ok: false, error: 'UNAUTHENTICATED' } satisfies LiveResyncAck);
      const seq = Number((await redisClient.get(liveSeqKey(presentationId)).catch(() => null)) ?? 0);
      const state = (await PresentationService.getHostState(presentationId, userId)) as unknown as HostStateResponse;
      return reply({ ok: true, role: 'host', seq, state } satisfies LiveResyncAck);
    }

    const { participantId, participantToken } = data;
    if (!isValidObjectId(participantId) || typeof participantToken !== 'string' || !participantToken) {
      return reply({ ok: false, error: 'INVALID_PAYLOAD' } satisfies LiveResyncAck);
    }
    const seq = Number((await redisClient.get(liveSeqKey(presentationId)).catch(() => null)) ?? 0);
    const state = await PresentationService.getParticipantLiveState(presentationId, participantId, participantToken);
    return reply({ ok: true, role: 'participant', seq, state } satisfies LiveResyncAck);
  } catch (error) {
    reply(resyncFailure(error));
  }
};

// A screen draws the live results as answers arrive, like the host's stage, but
// `answer:received` is only ever sent before the reveal: its answer key stays home.
registerScreenView('answer:received', (payload) => stripAnswerKeys(payload));

export const presentationsSocketModule = registerSocketModule({
  name: 'presentations',

  onConnection(socket) {
    // The only join: `live:*` rooms, with an ack reporting the outcome. (The legacy
    // `quiz:join` / `quiz:leave` and the `quiz:event` copy were removed in W2-D phase 2.)
    socket.on(SOCKET_EVENTS.liveJoin, async (data: LiveJoinPayload | null, ack?: unknown) => {
      const reply = (result: LiveJoinAck) => {
        if (typeof ack === 'function') ack(result);
      };
      if (!allowJoin(socket)) return reply({ ok: false, error: 'RATE_LIMITED' });
      const presentationId = data?.presentationId;
      if (!isValidObjectId(presentationId) || !data?.role) {
        return reply({ ok: false, error: 'INVALID_PAYLOAD' });
      }

      const grant = await authorizeJoin(socket, presentationId, data);
      if (typeof grant === 'string') return reply({ ok: false, error: grant });
      joinLiveRooms(socket, presentationId, grant);
      reply({ ok: true, role: grant.role });
    });

    socket.on(SOCKET_EVENTS.answerSubmit, (data: unknown, ack?: unknown) => handleAnswerSubmit(socket, data, ack));

    socket.on(SOCKET_EVENTS.liveResync, (data: LiveResyncPayload | null, ack?: unknown) =>
      handleLiveResync(socket, data, ack)
    );

    socket.on(SOCKET_EVENTS.liveLeave, (data: unknown, ack?: unknown) => {
      const presentationId = leaveTarget(data);
      if (presentationId) leavePresentationRooms(socket, presentationId);
      if (typeof ack === 'function') ack({ ok: presentationId !== null });
    });
  },
});
