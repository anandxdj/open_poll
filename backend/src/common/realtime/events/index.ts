import type { LiveEventDefinition } from './envelope';
import { POLL_SOCKET_EVENTS } from './poll';
import { PRESENTATION_EVENTS, PRESENTATION_SOCKET_EVENTS } from './presentation';
import { QNA_EVENTS } from './qna';
import { REACTION_EVENTS, REACTION_SOCKET_EVENTS } from './reactions';

export * from './envelope';
export * from './poll';
export * from './presentation';
export * from './qna';
export * from './reactions';

/** Redis pub/sub channels. Every instance subscribes and delivers to its own sockets. */
export const REALTIME_CHANNELS = {
  analyticsUpdate: 'analytics:update',
  liveEvent: 'live:event',
} as const;

/** Socket.io event names on the wire. */
export const SOCKET_EVENTS = {
  liveEvent: 'live:event',
  ...POLL_SOCKET_EVENTS,
  ...PRESENTATION_SOCKET_EVENTS,
  ...REACTION_SOCKET_EVENTS,
} as const;

// Live event types by module. Append-only, alphabetical, one line per module.
export const LIVE_EVENTS = {
  ...PRESENTATION_EVENTS,
  ...QNA_EVENTS,
  ...REACTION_EVENTS,
} as const;

export type LiveEventType = keyof typeof LIVE_EVENTS;

export const getLiveEventDefinition = (type: string): LiveEventDefinition | undefined =>
  Object.hasOwn(LIVE_EVENTS, type) ? (LIVE_EVENTS as Record<string, LiveEventDefinition>)[type] : undefined;

export const isHostOnlyEvent = (type: string): boolean => getLiveEventDefinition(type)?.hostOnly === true;
