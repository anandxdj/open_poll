import type { Server, Socket } from 'socket.io';
import { redisClient } from '../../common/config/redis';
import { getSocketUser, userFromAccessToken } from '../../common/realtime/auth';
import { EDITOR_PRESENCE_CHANNEL, SOCKET_EVENTS } from '../../common/realtime/events';
import { registerSocketModule } from '../../common/realtime/registry';
import { allowJoin, isValidObjectId } from '../../common/realtime/rooms';
import { canActOnDeck } from './access';

/**
 * Builder presence (W3-B2): who else has a deck open in the builder.
 *
 * - `deck:join {presentationId, accessToken?}` (ack `{ok: true, editors}` or
 *   `{ok: false, error}`): needs `deck:edit` on the deck (shares count). The
 *   socket joins the room `editor:<id>` and is recorded in the Redis hash
 *   `editor:<id>:presence` (field = socket id, value `{userId, name, since, at}`).
 *   Clients resend it every ~30 s: a heartbeat that refreshes `at` and returns
 *   the current list in the ack. Entries not refreshed for 75 s are dropped
 *   when read (a crashed instance never sent their disconnect).
 * - `deck:leave {presentationId}` and disconnecting remove the socket.
 * - A first join or a leave publishes `{presentationId}` on `editor:presence`;
 *   every instance then sends `presence:update {presentationId, editors}` to its
 *   own sockets in the room (`io.local`, never `io.to`).
 *
 * `editors` lists each user once (with `tabs`, the number of their open builders), earliest first.
 * Presence is informational: conflicting saves are caught by the deck revision
 * (`If-Match`, `revision.ts`), never by this.
 */

export const editorRoom = (presentationId: string) => `editor:${presentationId}`;
export const presenceKey = (presentationId: string) => `editor:${presentationId}:presence`;

/** An entry older than this (no heartbeat) no longer counts. */
export const PRESENCE_STALE_MS = 75_000;
/** The hash expires when nobody refreshes it. */
const PRESENCE_TTL_SEC = 180;

export interface DeckEditor {
  userId: string;
  name: string;
  /** When this user first opened the deck (ISO). */
  since: string;
  /** Open builders (sockets) of this user on the deck: more than one = another tab or device. */
  tabs: number;
}

interface PresenceEntry {
  userId: string;
  name: string;
  since: number;
  at: number;
}

export type DeckJoinError = 'INVALID_PAYLOAD' | 'RATE_LIMITED' | 'UNAUTHENTICATED' | 'FORBIDDEN' | 'UNAVAILABLE';
export type DeckJoinAck = { ok: true; editors: DeckEditor[] } | { ok: false; error: DeckJoinError };

const parseEntry = (value: string): PresenceEntry | null => {
  try {
    const entry = JSON.parse(value) as Partial<PresenceEntry>;
    if (typeof entry.userId !== 'string' || typeof entry.at !== 'number' || typeof entry.since !== 'number') return null;
    return { userId: entry.userId, name: typeof entry.name === 'string' ? entry.name : 'Someone', since: entry.since, at: entry.at };
  } catch {
    return null;
  }
};

/** The deck's current editors (stale entries are removed on the way). */
export async function readEditors(presentationId: string, now = Date.now()): Promise<DeckEditor[]> {
  const raw = await redisClient.hGetAll(presenceKey(presentationId));
  const byUser = new Map<string, PresenceEntry>();
  const tabs = new Map<string, number>();
  const stale: string[] = [];
  for (const [socketId, value] of Object.entries(raw)) {
    const entry = parseEntry(value);
    if (!entry || now - entry.at > PRESENCE_STALE_MS) {
      stale.push(socketId);
      continue;
    }
    const known = byUser.get(entry.userId);
    if (!known || entry.since < known.since) byUser.set(entry.userId, entry);
    tabs.set(entry.userId, (tabs.get(entry.userId) ?? 0) + 1);
  }
  if (stale.length) await redisClient.hDel(presenceKey(presentationId), stale).catch(() => 0);
  return [...byUser.values()]
    .sort((a, b) => a.since - b.since)
    .map((entry) => ({
      userId: entry.userId,
      name: entry.name,
      since: new Date(entry.since).toISOString(),
      tabs: tabs.get(entry.userId) ?? 1,
    }));
}

const publishPresence = (presentationId: string) =>
  redisClient.publish(EDITOR_PRESENCE_CHANNEL, JSON.stringify({ presentationId })).catch(() => 0);

/** Decks this socket joined as an editor (to clean up on disconnect). */
const decksOf = (socket: Socket): Set<string> => {
  const data = socket.data as { editorDecks?: Set<string> };
  data.editorDecks ??= new Set<string>();
  return data.editorDecks;
};

async function leaveDeck(socket: Socket, presentationId: string) {
  if (!decksOf(socket).delete(presentationId)) return;
  socket.leave(editorRoom(presentationId));
  await redisClient.hDel(presenceKey(presentationId), socket.id).catch(() => 0);
  await publishPresence(presentationId);
}

export async function handleDeckJoin(socket: Socket, data: unknown): Promise<DeckJoinAck> {
  const payload = (data ?? {}) as { presentationId?: unknown; accessToken?: unknown };
  const presentationId = payload.presentationId;
  if (!isValidObjectId(presentationId)) return { ok: false, error: 'INVALID_PAYLOAD' };
  const user =
    payload.accessToken !== undefined && payload.accessToken !== null && payload.accessToken !== ''
      ? userFromAccessToken(payload.accessToken)
      : getSocketUser(socket);
  if (!user) return { ok: false, error: 'UNAUTHENTICATED' };

  const joined = decksOf(socket).has(presentationId);
  // Heartbeats from a socket already in the room do not spend the join budget.
  if (!joined && !allowJoin(socket)) return { ok: false, error: 'RATE_LIMITED' };
  // Checked on every heartbeat too: a removed member or revoked share drops out.
  if (!(await canActOnDeck(presentationId, user.id, 'deck:edit'))) {
    if (joined) await leaveDeck(socket, presentationId);
    return { ok: false, error: 'FORBIDDEN' };
  }

  try {
    const key = presenceKey(presentationId);
    const now = Date.now();
    const previous = await redisClient.hGet(key, socket.id);
    const previousEntry = previous ? parseEntry(previous) : null;
    const entry: PresenceEntry = { userId: user.id, name: user.name?.trim() || 'Someone', since: previousEntry?.since ?? now, at: now };
    await redisClient.hSet(key, socket.id, JSON.stringify(entry));
    await redisClient.expire(key, PRESENCE_TTL_SEC);
    if (!joined) {
      socket.join(editorRoom(presentationId));
      decksOf(socket).add(presentationId);
    }
    if (!previousEntry) await publishPresence(presentationId);
    return { ok: true, editors: await readEditors(presentationId, now) };
  } catch (error) {
    console.error('[Editor] deck:join failed:', error);
    return { ok: false, error: 'UNAVAILABLE' };
  }
}

/** Channel handler: sends the deck's editors to this instance's sockets in its room. */
export function deliverPresence(message: string, io: Server) {
  let presentationId: unknown;
  try {
    presentationId = (JSON.parse(message) as { presentationId?: unknown }).presentationId;
  } catch {
    return;
  }
  if (!isValidObjectId(presentationId)) return;
  void readEditors(presentationId)
    .then((editors) => io.local.to(editorRoom(presentationId)).emit(SOCKET_EVENTS.presenceUpdate, { presentationId, editors }))
    .catch((error: unknown) => console.error('[Editor] presence delivery failed:', error));
}

export const editorSocketModule = registerSocketModule({
  name: 'editor',

  onConnection(socket) {
    socket.on(SOCKET_EVENTS.deckJoin, async (data: unknown, ack?: unknown) => {
      const result = await handleDeckJoin(socket, data);
      if (typeof ack === 'function') ack(result);
    });
    socket.on(SOCKET_EVENTS.deckLeave, (data: unknown) => {
      const presentationId = typeof data === 'string' ? data : (data as { presentationId?: unknown } | null)?.presentationId;
      if (isValidObjectId(presentationId)) void leaveDeck(socket, presentationId);
    });
    socket.on('disconnect', () => {
      for (const presentationId of [...decksOf(socket)]) void leaveDeck(socket, presentationId);
    });
  },

  channels: {
    [EDITOR_PRESENCE_CHANNEL]: deliverPresence,
  },
});
