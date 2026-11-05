import type { LiveEventDefinition } from './envelope';
import { EDITOR_PRESENCE_CHANNEL, EDITOR_SOCKET_EVENTS } from './editor';
import { POLL_SOCKET_EVENTS } from './poll';
import { PRESENTATION_EVENTS, PRESENTATION_SOCKET_EVENTS } from './presentation';
import { QNA_EVENTS } from './qna';
import { REACTION_EVENTS, REACTION_SOCKET_EVENTS } from './reactions';
import { REMOTE_EVENTS, REMOTE_SOCKET_EVENTS } from './remote';

export * from './editor';
export * from './envelope';
export * from './poll';
export * from './presentation';
export * from './qna';
export * from './reactions';
export * from './remote';

/** Redis pub/sub channels. Every instance subscribes and delivers to its own sockets. */
export const REALTIME_CHANNELS = {
  analyticsUpdate: 'analytics:update',
  editorPresence: EDITOR_PRESENCE_CHANNEL,
  liveEvent: 'live:event',
  // Room changes every instance applies to its own sockets (W2-A: kicked participants, revoked remotes).
  presentationsControl: 'presentations:control',
  remoteControl: 'remote:control',
} as const;

/** Socket.io event names on the wire. */
export const SOCKET_EVENTS = {
  liveEvent: 'live:event',
  ...EDITOR_SOCKET_EVENTS,
  ...POLL_SOCKET_EVENTS,
  ...PRESENTATION_SOCKET_EVENTS,
  ...REACTION_SOCKET_EVENTS,
  ...REMOTE_SOCKET_EVENTS,
} as const;

// Live event types by module. Append-only, alphabetical, one line per module.
export const LIVE_EVENTS = {
  ...PRESENTATION_EVENTS,
  ...QNA_EVENTS,
  ...REACTION_EVENTS,
  ...REMOTE_EVENTS,
} as const;

export type LiveEventType = keyof typeof LIVE_EVENTS;

export const getLiveEventDefinition = (type: string): LiveEventDefinition | undefined =>
  Object.hasOwn(LIVE_EVENTS, type) ? (LIVE_EVENTS as Record<string, LiveEventDefinition>)[type] : undefined;

export const isHostOnlyEvent = (type: string): boolean => getLiveEventDefinition(type)?.hostOnly === true;
