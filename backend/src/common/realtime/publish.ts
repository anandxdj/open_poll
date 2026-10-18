import type { Server } from 'socket.io';
import { redisClient } from '../config/redis';
import {
  LIVE_EVENT_VERSION,
  REALTIME_CHANNELS,
  SOCKET_EVENTS,
  getLiveEventDefinition,
  isHostOnlyEvent,
  type LiveAudience,
  type LiveEventEnvelope,
  type LiveEventType,
  type ResponseAcceptedEvent,
} from './events';
import { legacyRoomForAudience, liveRoomForAudience } from './rooms';

// The seq counter outlives sessions; it only expires after a week without events.
const SEQ_TTL_SEC = 7 * 24 * 3600;

export const liveSeqKey = (presentationId: string) => `live:${presentationId}:seq`;

// INCR and PUBLISH in one script, so concurrent publishers for the same deck
// reach subscribers in seq order. The envelope arrives as the JSON before and
// after its `seq` value (ARGV[1], ARGV[2]).
const PUBLISH_LIVE_EVENT_SCRIPT = `
local seq = redis.call('INCR', KEYS[1])
redis.call('EXPIRE', KEYS[1], ARGV[3])
redis.call('PUBLISH', ARGV[4], ARGV[1] .. seq .. ARGV[2])
return seq
`;

export interface PublishLiveEventInput {
  presentationId: string;
  type: LiveEventType;
  payload: Record<string, unknown>;
  /** Defaults to the event type's audience; host-only types always go to `host`. */
  audience?: LiveAudience;
  sessionId?: string | null;
}

export const resolveAudience = (type: string, requested?: LiveAudience): LiveAudience => {
  const definition = getLiveEventDefinition(type);
  if (definition?.hostOnly) return 'host';
  return requested ?? definition?.audience ?? 'all';
};

/**
 * Publishes a live event to every instance. Best-effort like the HTTP flows that
 * call it: failures are logged and resolve to null instead of throwing.
 */
export const publishLiveEvent = async (
  input: PublishLiveEventInput
): Promise<LiveEventEnvelope<LiveEventType> | null> => {
  const { presentationId, type, payload } = input;
  const sessionId = input.sessionId ?? null;
  const audience = resolveAudience(type, input.audience);
  if (!liveRoomForAudience(presentationId, audience)) {
    console.error(`[Realtime] Not publishing ${type}: invalid audience "${audience}"`);
    return null;
  }

  const emittedAt = new Date().toISOString();
  const head = JSON.stringify({ v: LIVE_EVENT_VERSION, presentationId, sessionId });
  const tail = JSON.stringify({ type, payload, audience, emittedAt, quizId: presentationId });

  try {
    const seq = Number(
      await redisClient.eval(PUBLISH_LIVE_EVENT_SCRIPT, {
        keys: [liveSeqKey(presentationId)],
        arguments: [
          `${head.slice(0, -1)},"seq":`,
          `,${tail.slice(1)}`,
          String(SEQ_TTL_SEC),
          REALTIME_CHANNELS.liveEvent,
        ],
      })
    );
    return {
      v: LIVE_EVENT_VERSION,
      presentationId,
      sessionId,
      seq,
      type,
      payload,
      audience,
      emittedAt,
      quizId: presentationId,
    };
  } catch (error) {
    console.error('[Realtime] Failed to publish live event:', error);
    return null;
  }
};

/** Publishes a poll's refreshed analytics to every instance. */
export const publishPollAnalytics = async (event: ResponseAcceptedEvent) => {
  await redisClient.publish(REALTIME_CHANNELS.analyticsUpdate, JSON.stringify(event));
};

// ---------- Subscriber side ----------

const isString = (value: unknown): value is string => typeof value === 'string' && value.length > 0;

export const parseLiveEnvelope = (message: string): LiveEventEnvelope | null => {
  let parsed: Partial<LiveEventEnvelope>;
  try {
    parsed = JSON.parse(message);
  } catch {
    return null;
  }
  if (
    !parsed ||
    parsed.v !== LIVE_EVENT_VERSION ||
    !isString(parsed.presentationId) ||
    !isString(parsed.type) ||
    !isString(parsed.audience) ||
    typeof parsed.seq !== 'number'
  ) {
    return null;
  }
  return parsed as LiveEventEnvelope;
};

/**
 * Delivers one published live event to this instance's sockets: `live:event` to
 * the audience's `live:*` room, plus the legacy `quiz:event` copy to the matching
 * `quiz_*` room. Uses `io.local` — every instance runs this subscriber, so each
 * one delivers only to the sockets it holds.
 */
export const deliverLiveEvent = (message: string, io: Server) => {
  const envelope = parseLiveEnvelope(message);
  if (!envelope) {
    console.error('[Realtime] Dropped malformed live event');
    return;
  }

  // Re-checked here so a publisher that skipped `publishLiveEvent` still cannot
  // send host-only data to participants.
  const audience: LiveAudience = isHostOnlyEvent(envelope.type) ? 'host' : envelope.audience;
  const room = liveRoomForAudience(envelope.presentationId, audience);
  if (!room) {
    console.error(`[Realtime] Dropped ${envelope.type}: invalid audience "${envelope.audience}"`);
    return;
  }
  const delivered = audience === envelope.audience ? envelope : { ...envelope, audience };

  io.local.to(room).emit(SOCKET_EVENTS.liveEvent, delivered);
  const legacyRoom = legacyRoomForAudience(envelope.presentationId, audience);
  if (legacyRoom) io.local.to(legacyRoom).emit(SOCKET_EVENTS.quizEvent, delivered);
};
