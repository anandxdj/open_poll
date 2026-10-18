import type { Socket } from 'socket.io';
import { resolveSocketUserId } from '../../common/realtime/auth';
import { SOCKET_EVENTS, type LiveRole } from '../../common/realtime/events';
import { registerSocketModule } from '../../common/realtime/registry';
import {
  allowJoin,
  isValidObjectId,
  leavePresentationRooms,
  legacyRooms,
  liveRooms,
} from '../../common/realtime/rooms';
import { PresentationService } from './presentations.service';

interface JoinCredentials {
  role?: LiveRole;
  /** Host only. Optional when the socket authenticated at the handshake. */
  accessToken?: string;
  participantId?: string;
  participantToken?: string;
}

/** Legacy `quiz:join` payload — `quizId` carries the presentation id. */
interface QuizJoinPayload extends JoinCredentials {
  quizId?: string;
}

interface LiveJoinPayload extends JoinCredentials {
  presentationId?: string;
}

export type LiveJoinError = 'INVALID_PAYLOAD' | 'RATE_LIMITED' | 'UNAUTHENTICATED' | 'FORBIDDEN';

export type LiveJoinAck = { ok: true; role: LiveRole } | { ok: false; error: LiveJoinError };

type JoinGrant = { role: 'host' } | { role: 'participant'; participantId: string };

/**
 * Decides whether a socket may follow a deck, without touching rooms. Hosts need
 * `deck:host` on the deck (its creator, or a member of its workspace whose role
 * allows hosting); participants must present the token issued by `POST /:id/join`.
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
  socket.join(
    grant.role === 'host'
      ? liveRooms.host(presentationId)
      : liveRooms.participant(presentationId, grant.participantId)
  );
};

const joinLegacyRooms = (socket: Socket, presentationId: string, grant: JoinGrant) => {
  socket.join(legacyRooms.all(presentationId));
  // Host-only room: carries pre-reveal answer distributions that must never
  // reach participant sockets.
  if (grant.role === 'host') socket.join(legacyRooms.host(presentationId));
};

const leaveTarget = (data: unknown): string | null => {
  const presentationId =
    typeof data === 'string' ? data : (data as { presentationId?: unknown } | null)?.presentationId;
  return isValidObjectId(presentationId) ? presentationId : null;
};

export const presentationsSocketModule = registerSocketModule({
  name: 'presentations',

  onConnection(socket) {
    // Legacy protocol (`quiz_*` rooms, `quiz:event`): unauthorized joins are
    // silently dropped. The socket also joins the `live:*` rooms, so it receives
    // `live:event` as well.
    socket.on(SOCKET_EVENTS.quizJoin, async (data: QuizJoinPayload | null) => {
      if (!allowJoin(socket)) return;
      const presentationId = data?.quizId;
      if (!isValidObjectId(presentationId) || !data?.role) return;

      const grant = await authorizeJoin(socket, presentationId, data);
      if (typeof grant === 'string') return;
      joinLegacyRooms(socket, presentationId, grant);
      joinLiveRooms(socket, presentationId, grant);
    });

    socket.on(SOCKET_EVENTS.quizLeave, (data: unknown) => {
      const presentationId = leaveTarget(data);
      if (presentationId) leavePresentationRooms(socket, presentationId);
    });

    // `live:*` rooms only, with an ack reporting the outcome.
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

    socket.on(SOCKET_EVENTS.liveLeave, (data: unknown, ack?: unknown) => {
      const presentationId = leaveTarget(data);
      if (presentationId) leavePresentationRooms(socket, presentationId);
      if (typeof ack === 'function') ack({ ok: presentationId !== null });
    });
  },
});
