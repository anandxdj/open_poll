import type { LiveSelf } from "../../live/reducer";

/**
 * Participant identity in localStorage. Credentials belong to one **session**
 * (a device that joins a later run of the same deck is a new participant), so
 * they are keyed `openpoll_participant_{code}_{sessionId}`. What is per
 * device — the signed device token (same seat on a rejoin), the last nickname
 * (pre-filled when rejoining) and the session last joined (so a reload after
 * the session ended can still show the final standings) — lives under
 * `openpoll_participant_{code}`.
 *
 * Every access is guarded: private windows and blocked storage just mean the
 * identity does not survive a reload.
 */

export interface DeviceRecord {
  /** Server-signed device identity, presented on rejoin. */
  deviceToken?: string;
  /** Last nickname used with this code. */
  name?: string;
  /** Session last joined with this code. */
  lastSessionId?: string;
}

const PREFIX = "openpoll_participant_";

export const deviceKey = (code: string) => `${PREFIX}${code}`;
export const credentialsKey = (code: string, sessionId: string) => `${PREFIX}${code}_${sessionId}`;

function storage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

function readJson(key: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(storage()?.getItem(key) ?? "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function writeJson(key: string, value: Record<string, unknown>) {
  try {
    storage()?.setItem(key, JSON.stringify(value));
  } catch {
    // Quota or private mode: the identity just won't survive a reload.
  }
}

const str = (value: unknown): string | undefined => (typeof value === "string" && value ? value : undefined);

export function readDevice(code: string): DeviceRecord {
  const raw = readJson(deviceKey(code));
  return { deviceToken: str(raw.deviceToken), name: str(raw.name), lastSessionId: str(raw.lastSessionId) };
}

export function writeDevice(code: string, patch: DeviceRecord) {
  const next: Record<string, unknown> = { ...readDevice(code), ...patch };
  for (const key of Object.keys(next)) if (next[key] === undefined) delete next[key];
  writeJson(deviceKey(code), next);
}

/** This session's credentials, or null when the device never joined it. */
export function readCredentials(code: string, sessionId: string | null | undefined): LiveSelf | null {
  if (!sessionId) return null;
  const raw = readJson(credentialsKey(code, sessionId));
  const participantId = str(raw.participantId);
  const name = str(raw.name);
  const token = str(raw.token);
  return participantId && name && token ? { participantId, name, token } : null;
}

/** Stores a join: this session's credentials, plus the device record. */
export function saveJoin(code: string, sessionId: string, self: LiveSelf, deviceToken: string) {
  writeJson(credentialsKey(code, sessionId), { ...self });
  writeDevice(code, { deviceToken, name: self.name, lastSessionId: sessionId });
}

/** The credentials stopped working (kicked, stale, unknown): forget them, keep the device record. */
export function forgetCredentials(code: string, sessionId: string | null | undefined) {
  if (!sessionId) return;
  try {
    storage()?.removeItem(credentialsKey(code, sessionId));
  } catch {
    // Nothing to forget in blocked storage.
  }
}
