/**
 * The participant's stored identity, read by the take-home page. The live
 * client keeps it per join code and session (`openpoll_participant_{code}_{sessionId}`,
 * W1-A2); before that it was one entry per code (`openpoll_participant_{code}`),
 * which is still read as a fallback. Pure over a `Storage`-like object so it
 * is unit tested without a browser.
 */

export interface SummaryCredentials {
  /** Null for the per-code entry (it has no session); the page resolves it. */
  sessionId: string | null;
  participantId: string;
  token: string;
  name?: string;
}

type StorageLike = Pick<Storage, "getItem" | "key" | "length">;

const OBJECT_ID = /^[a-f0-9]{24}$/i;

export const participantKey = (code: string, sessionId?: string | null) =>
  sessionId ? `openpoll_participant_${code}_${sessionId}` : `openpoll_participant_${code}`;

function parse(raw: string | null): { participantId: string; token: string; name?: string } | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Record<string, unknown>;
    if (typeof value.participantId !== "string" || typeof value.token !== "string") return null;
    if (!value.participantId || !value.token) return null;
    return {
      participantId: value.participantId,
      token: value.token,
      ...(typeof value.name === "string" ? { name: value.name } : {}),
    };
  } catch {
    return null;
  }
}

/** Joins can happen on a shared device, so a stray entry must not crash the page. */
function safeGet(storage: StorageLike, key: string): string | null {
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
}

/**
 * Credentials for `code`: the entry of `sessionId` when given, else the
 * newest session's entry (ObjectIds sort by creation time), else the legacy
 * per-code entry.
 */
export function readSummaryCredentials(
  storage: StorageLike,
  code: string,
  sessionId?: string | null
): SummaryCredentials | null {
  if (sessionId) {
    if (!OBJECT_ID.test(sessionId)) return null;
    const scoped = parse(safeGet(storage, participantKey(code, sessionId)));
    return scoped ? { sessionId, ...scoped } : null;
  }

  const prefix = `openpoll_participant_${code}_`;
  const found: { sessionId: string; value: NonNullable<ReturnType<typeof parse>> }[] = [];
  try {
    for (let i = 0; i < storage.length; i += 1) {
      const key = storage.key(i);
      if (!key?.startsWith(prefix)) continue;
      const id = key.slice(prefix.length);
      const value = OBJECT_ID.test(id) ? parse(safeGet(storage, key)) : null;
      if (value) found.push({ sessionId: id, value });
    }
  } catch {
    // Storage unavailable: nothing to read.
  }
  found.sort((a, b) => (a.sessionId < b.sessionId ? 1 : -1));
  if (found[0]) return { sessionId: found[0].sessionId, ...found[0].value };

  const legacy = parse(safeGet(storage, participantKey(code)));
  return legacy ? { sessionId: null, ...legacy } : null;
}
