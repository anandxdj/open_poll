import type { Socket } from 'socket.io';
import { publishLiveEvent } from '../../common/realtime/publish';
import { isValidObjectId } from '../../common/realtime/rooms';
import { verifyParticipant } from '../presentations/live/participant.service';
import { hashCoalescer } from '../qna/coalescer';
import { loadSessionContext, reactionSettingsOf } from '../qna/qna.service';

/**
 * Emoji reactions: participants send `reaction:send` on their socket; the
 * stage (host room) gets `reaction:burst {counts}` at most every 500 ms per
 * session. Limits: 5 per second per socket (in memory, before any I/O), 300
 * per second per session (Redis, atomic with the count), emoji from the
 * deck's allow-list (`settings.reactions.emojis`, ≤ 6).
 */

export const REACTIONS_PER_SOCKET_PER_SEC = 5;
export const REACTIONS_PER_SESSION_PER_SEC = 300;
const KEY_TTL_SEC = 6 * 3600;
const AUTH_CACHE_MS = 30_000;
const CONTEXT_CACHE_MS = 2_000;
const CONTEXT_CACHE_MAX = 5_000;

const session = (sid: string) => `reactions:{${sid}}`;

export const reactionKeys = {
  /** HASH emoji → count since the last `reaction:burst`. */
  pending: (sid: string) => `${session(sid)}:pending`,
  /** STRING lock (`SET NX PX 500`) while a burst is scheduled. */
  lock: (sid: string) => `${session(sid)}:lock`,
  /** STRING fixed one-second window counter for the per-session cap. */
  rate: (sid: string) => `${session(sid)}:rate`,
};

export type ReactionError =
  | 'INVALID_PAYLOAD'
  | 'RATE_LIMITED'
  | 'FORBIDDEN'
  | 'SESSION_ENDED'
  | 'DISABLED'
  | 'EMOJI_NOT_ALLOWED'
  | 'UNAVAILABLE';

export type ReactionAck = { ok: true } | { ok: false; error: ReactionError };

export interface ReactionSendPayload {
  presentationId?: unknown;
  participantId?: unknown;
  participantToken?: unknown;
  emoji?: unknown;
}

// ---------- Per-socket window (in memory: the socket lives on this instance) ----------

const socketWindows = new WeakMap<object, number[]>();

/** Sliding one-second window per socket. */
export const allowSocketReaction = (socket: object, now = Date.now()): boolean => {
  const recent = (socketWindows.get(socket) ?? []).filter((t) => now - t < 1000);
  if (recent.length >= REACTIONS_PER_SOCKET_PER_SEC) {
    socketWindows.set(socket, recent);
    return false;
  }
  recent.push(now);
  socketWindows.set(socket, recent);
  return true;
};

// ---------- Participant check, cached per socket ----------

const verified = new WeakMap<object, Map<string, { sessionId: string; until: number }>>();

const participantSessionId = async (
  socket: object,
  presentationId: string,
  participantId: string,
  token: string,
  now = Date.now()
): Promise<string | null> => {
  const key = `${presentationId}:${participantId}:${token}`;
  let cache = verified.get(socket);
  const hit = cache?.get(key);
  if (hit && hit.until > now) return hit.sessionId;
  try {
    const { sessionId } = await verifyParticipant(presentationId, participantId, token);
    if (!cache) verified.set(socket, (cache = new Map()));
    cache.set(key, { sessionId, until: now + AUTH_CACHE_MS });
    return sessionId;
  } catch {
    cache?.delete(key);
    return null;
  }
};

// ---------- Session settings, cached briefly per instance ----------

type CachedContext = { isLive: boolean; presentationId: string; enabled: boolean; emojis: string[]; until: number };
const contexts = new Map<string, CachedContext>();

const sessionReactionContext = async (sessionId: string, now = Date.now()): Promise<CachedContext | null> => {
  const hit = contexts.get(sessionId);
  if (hit && hit.until > now) return hit;
  const ctx = await loadSessionContext(sessionId);
  if (!ctx) return null;
  const reactions = reactionSettingsOf(ctx.settings);
  const entry: CachedContext = {
    isLive: ctx.isLive,
    presentationId: ctx.presentationId,
    enabled: reactions.enabled,
    emojis: reactions.emojis,
    until: now + CONTEXT_CACHE_MS,
  };
  if (contexts.size >= CONTEXT_CACHE_MAX) contexts.clear();
  contexts.set(sessionId, entry);
  return entry;
};

/** Test helper: forgets cached session settings. */
export const resetReactionCaches = () => contexts.clear();

// ---------- Send ----------

const isShortString = (value: unknown, min: number, max: number): value is string =>
  typeof value === 'string' && value.length >= min && value.length <= max;

/** Coalesced `reaction:burst` for one session. */
const burst = (presentationId: string, sessionId: string) =>
  hashCoalescer({
    keys: { data: reactionKeys.pending(sessionId), lock: reactionKeys.lock(sessionId) },
    ttlSec: KEY_TTL_SEC,
    flush: async (counts) => {
      await publishLiveEvent({ presentationId, sessionId, type: 'reaction:burst', payload: { counts }, audience: 'host' });
    },
  });

/** Handles one `reaction:send`; never throws. */
export const sendReaction = async (socket: Socket | object, data: ReactionSendPayload | null): Promise<ReactionAck> => {
  const presentationId = data?.presentationId;
  const participantId = data?.participantId;
  const token = data?.participantToken;
  const emoji = data?.emoji;
  if (
    !isValidObjectId(presentationId) ||
    !isValidObjectId(participantId) ||
    !isShortString(token, 16, 128) ||
    !isShortString(emoji, 1, 16)
  ) {
    return { ok: false, error: 'INVALID_PAYLOAD' };
  }
  if (!allowSocketReaction(socket)) return { ok: false, error: 'RATE_LIMITED' };

  try {
    const sessionId = await participantSessionId(socket, presentationId, participantId, token);
    if (!sessionId) return { ok: false, error: 'FORBIDDEN' };
    const ctx = await sessionReactionContext(sessionId);
    if (!ctx || ctx.presentationId !== presentationId) return { ok: false, error: 'FORBIDDEN' };
    if (!ctx.isLive) return { ok: false, error: 'SESSION_ENDED' };
    if (!ctx.enabled) return { ok: false, error: 'DISABLED' };
    if (!ctx.emojis.includes(emoji)) return { ok: false, error: 'EMOJI_NOT_ALLOWED' };

    const result = await burst(presentationId, sessionId).add(emoji, 1, {
      key: reactionKeys.rate(sessionId),
      max: REACTIONS_PER_SESSION_PER_SEC,
      windowSec: 1,
    });
    return result === 'limited' ? { ok: false, error: 'RATE_LIMITED' } : { ok: true };
  } catch (error) {
    console.error('[Reactions] reaction:send failed:', error);
    return { ok: false, error: 'UNAVAILABLE' };
  }
};
