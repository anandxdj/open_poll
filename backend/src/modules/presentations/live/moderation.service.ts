import mongoose from 'mongoose';
import { ApiError } from '../../../common/utils/ApiError';
import { redisClient } from '../../../common/config/redis';
import { authorizeDeck, type Actor } from '../access';
import { PresentationParticipantModel } from '../models/participant.model';
import { LIVE_ERROR_CODES, type KickResponse } from './contract';
import { getParticipantCount } from './distribution';
import { publishParticipantKicked } from './events';
import { k, touchTtls } from './keys';
import { requireLiveSession } from './session.service';
import { requestParticipantRoomsLeave } from './control';

/**
 * Host moderation (W2-A): removing a participant from the live session.
 *
 * A kicked participant:
 * - is marked in Mongo (`kickedAt`) and in the session's Redis `kicked` set, so
 *   the answer script refuses its answers (403 `PARTICIPANT_KICKED`) and every
 *   participant read (`/me`, `/live-state`, socket joins) fails the same way;
 * - cannot rejoin the session: a join with its device token is refused before
 *   it takes a seat (the seat it held is given back, so a capped session can
 *   admit someone else);
 * - leaves the live participant count and the standings (its name and score
 *   leave the Redis mirror; the final leaderboard skips kicked participants).
 *   Answers it already gave stay counted in the slides' results.
 *
 * The host room and the participant's own room get `participant:kicked`; the
 * participant's sockets then leave the deck's rooms on every instance.
 */

const notFound = () =>
  new ApiError(404, 'No such participant in the live session', LIVE_ERROR_CODES.participantNotFound);

export const kickParticipant = async (
  presentationId: string,
  actor: Actor,
  participantId: string
): Promise<KickResponse> => {
  await authorizeDeck(presentationId, actor, 'deck:host');
  const session = await requireLiveSession(presentationId);
  if (!mongoose.isValidObjectId(participantId)) throw notFound();
  const sid = String(session._id);

  const participant = await PresentationParticipantModel.findOne({ _id: participantId, sessionId: session._id });
  if (!participant) throw notFound();
  // Idempotent: a second kick keeps the first time.
  if (!participant.kickedAt) {
    await PresentationParticipantModel.updateOne(
      { _id: participant._id, kickedAt: null },
      { $set: { kickedAt: new Date() } }
    );
  }

  try {
    await Promise.all([
      redisClient.sAdd(k.kicked(sid), participantId),
      redisClient.hDel(k.names(sid), participantId),
      redisClient.zRem(k.scores(sid), participantId),
      redisClient.sRem(k.seats(sid), participant.deviceId),
    ]);
    await touchTtls([k.kicked(sid)]);
  } catch (error) {
    // Mongo (`kickedAt`) still refuses the participant: token checks fall back to it.
    console.error('[Presentation] Failed to mirror a kick to Redis:', error);
  }

  const participantCount = await getParticipantCount(sid);
  await publishParticipantKicked(presentationId, sid, { participantId, name: participant.name, participantCount });
  await requestParticipantRoomsLeave(presentationId, participantId);

  return { participantId, name: participant.name, kicked: true, participantCount };
};
