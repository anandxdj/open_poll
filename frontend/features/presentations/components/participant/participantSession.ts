import type { LiveSelf } from "../../live/reducer";

/**
 * Participant identity per join code in localStorage, so a refresh rejoins
 * as the same participant.
 */
interface StoredSession extends Partial<LiveSelf> {
  /** Server-signed device identity, presented on rejoin after a refresh */
  deviceToken?: string;
}

const storageKeyFor = (code: string) => `openpoll_participant_${code}`;

export function readSession(code: string): StoredSession {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(localStorage.getItem(storageKeyFor(code)) ?? "{}") as StoredSession;
  } catch {
    return {};
  }
}

export function writeSession(code: string, session: StoredSession) {
  try {
    localStorage.setItem(storageKeyFor(code), JSON.stringify(session));
  } catch {
    // Private mode / quota: the session just won't survive a refresh.
  }
}

export function readParticipant(code: string): LiveSelf | null {
  const { participantId, name, token } = readSession(code);
  return participantId && name && token ? { participantId, name, token } : null;
}

/** The lobby was reopened (identities wiped server-side): keep only the device token. */
export function forgetParticipant(code: string) {
  writeSession(code, { deviceToken: readSession(code).deviceToken });
}
