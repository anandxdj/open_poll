import type { Server, Socket } from 'socket.io';
import { redisClient } from '../../../common/config/redis';
import { REALTIME_CHANNELS } from '../../../common/realtime/events';
import { leavePresentationRooms, liveRooms } from '../../../common/realtime/rooms';

/**
 * Socket room changes that must reach every instance (each holds its own
 * sockets): published on `presentations:control`, applied by the presentations
 * socket module with `io.local`.
 *
 * Messages travel on the same Redis connection as the live events published
 * just before them, so a kicked participant's sockets receive their
 * `participant:kicked` envelope before they leave the rooms.
 */

export type PresentationsControlMessage = {
  kind: 'participant-leave';
  presentationId: string;
  participantId: string;
};

/** Every socket joined as this participant leaves the deck's live rooms. */
export const requestParticipantRoomsLeave = async (presentationId: string, participantId: string) => {
  const message: PresentationsControlMessage = { kind: 'participant-leave', presentationId, participantId };
  await redisClient
    .publish(REALTIME_CHANNELS.presentationsControl, JSON.stringify(message))
    .catch((error) => console.error('[Presentation] Failed to publish a room change:', error));
};

/** Channel handler (every instance): applies one message to this instance's sockets. */
export const applyPresentationsControl = (raw: string, io: Server) => {
  let message: Partial<PresentationsControlMessage>;
  try {
    message = JSON.parse(raw) as Partial<PresentationsControlMessage>;
  } catch {
    return;
  }
  if (message.kind !== 'participant-leave' || !message.presentationId || !message.participantId) return;
  const { presentationId, participantId } = message;
  void io.local
    .in(liveRooms.participant(presentationId, participantId))
    .fetchSockets()
    .then((sockets) => {
      // `io.local` only returns this instance's sockets: real Socket instances.
      for (const socket of sockets) leavePresentationRooms(socket as unknown as Socket, presentationId);
    })
    .catch((error) => console.error('[Presentation] Failed to apply a room change:', error));
};
