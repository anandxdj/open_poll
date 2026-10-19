import { defineLiveEvents } from './envelope';

// ---------- Reaction events (modules/reactions) ----------

export const REACTION_EVENTS = defineLiveEvents({
  // Coalesced emoji counts (at most one per session every 500 ms), for the stage:
  // the host console and audience screens.
  'reaction:burst': { audience: 'host' },
});

export type ReactionEventType = keyof typeof REACTION_EVENTS;

export const REACTION_SOCKET_EVENTS = {
  // Client → server, participant role: `{presentationId, participantId, participantToken, emoji}` with an ack.
  reactionSend: 'reaction:send',
} as const;
