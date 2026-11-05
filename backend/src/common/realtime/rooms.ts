import mongoose from 'mongoose';
import type { Socket } from 'socket.io';
import type { LiveAudience } from './events';

// ---------- Room names ----------
// `live:*` rooms receive `live:event`. (The legacy `quiz_*` rooms and their
// `quiz:event` copy were removed in W2-D phase 2.)

export const liveRooms = {
  /** Everyone following the deck: host, screens and participants. */
  all: (presentationId: string) => `live:${presentationId}`,
  host: (presentationId: string) => `live:${presentationId}:host`,
  participant: (presentationId: string, participantId: string) =>
    `live:${presentationId}:p:${participantId}`,
};

export const pollRoom = (pollId: string) => `poll_${pollId}`;

/** Room ids are Mongo ObjectIds; anything else is dropped before touching the DB. */
export const isValidObjectId = (id: unknown): id is string =>
  typeof id === 'string' && mongoose.Types.ObjectId.isValid(id);

const PARTICIPANT_AUDIENCE_PREFIX = 'participant:';

/** The participant id of a `participant:<id>` audience; null for any other audience. */
export const audienceParticipantId = (audience: string): string | null => {
  if (!audience.startsWith(PARTICIPANT_AUDIENCE_PREFIX)) return null;
  const participantId = audience.slice(PARTICIPANT_AUDIENCE_PREFIX.length);
  return isValidObjectId(participantId) ? participantId : null;
};

/** Room that receives `live:event` for an audience; null when the audience is malformed. */
export const liveRoomForAudience = (presentationId: string, audience: LiveAudience): string | null => {
  if (audience === 'all') return liveRooms.all(presentationId);
  if (audience === 'host') return liveRooms.host(presentationId);
  const participantId = audienceParticipantId(audience);
  return participantId ? liveRooms.participant(presentationId, participantId) : null;
};

/** Leaves every live room of one presentation, whatever role joined them. */
export const leavePresentationRooms = (socket: Socket, presentationId: string) => {
  const live = liveRooms.all(presentationId);
  for (const room of [...socket.rooms]) {
    if (room === live || room.startsWith(`${live}:`)) socket.leave(room);
  }
};

// ---------- Join budget ----------

// Per-connection cap on join attempts — rooms are cheap but not free, and an
// unauthenticated socket should not be able to spray joins. Shared by every
// module's join events.
export const MAX_JOINS_PER_MINUTE = 30;

const joinWindows = new WeakMap<Socket, { count: number; windowStart: number }>();

export const allowJoin = (socket: Socket, now = Date.now()): boolean => {
  let window = joinWindows.get(socket);
  if (!window || now - window.windowStart > 60_000) {
    window = { count: 0, windowStart: now };
    joinWindows.set(socket, window);
  }
  window.count += 1;
  return window.count <= MAX_JOINS_PER_MINUTE;
};
