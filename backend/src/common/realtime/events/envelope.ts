// ---------- Live event envelope ----------
// Every live-deck event travels in this envelope: publishers build it through
// `publishLiveEvent` (../publish.ts), the per-instance subscriber delivers it to
// the room its `audience` names (../rooms.ts).

export const LIVE_EVENT_VERSION = 1 as const;

/** `participant:<participantId>` targets a single participant's private room. */
export type LiveAudience = 'all' | 'host' | `participant:${string}`;

export interface LiveEventEnvelope<TType extends string = string> {
  v: typeof LIVE_EVENT_VERSION;
  presentationId: string;
  /** Live session the event belongs to; null for events published outside one. */
  sessionId: string | null;
  /** Per-presentation counter (`INCR live:{pid}:seq`), assigned atomically with the publish. */
  seq: number;
  type: TType;
  payload: Record<string, unknown>;
  audience: LiveAudience;
  emittedAt: string;
  /** Alias of `presentationId` for clients of the legacy `quiz:event` protocol. */
  quizId: string;
}

export interface LiveEventDefinition {
  /** Audience used when the publisher does not pass one. */
  audience: 'all' | 'host';
  /**
   * The payload holds data participants must not see (e.g. pre-reveal results):
   * publish and delivery both force the `host` audience, whatever was asked for.
   */
  hostOnly?: boolean;
}

/** Declares a module's live event types; the keys are the wire `type` values. */
export const defineLiveEvents = <T extends Record<string, LiveEventDefinition>>(events: T): T => events;
