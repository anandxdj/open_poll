import type { LiveSubReducer } from "@/features/presentations/live/reducer";

/**
 * Phone-remote presence slice (`state.modules.remote`, W2-A): the host room
 * hears `remote:connected` when the paired phone's socket arrives and
 * `remote:disconnected` when it leaves (or the pairing is revoked). `null`
 * until an event or a status read says which.
 */
export const REMOTE_PREFIX = "remote";

export interface RemotePresence {
  connected: boolean | null;
  /** A phone redeemed the current pairing (it connected at least once). */
  bound: boolean;
  /** Server time of the last change. */
  at: string | null;
}

export const initialRemotePresence: RemotePresence = { connected: null, bound: false, at: null };

/**
 * `live/module` `remote/status` `{connected, bound}` — a status read or a new
 * pairing (the panel's own REST calls); `remote:connected` also means the
 * pairing is bound.
 */
export const remotePresenceReducer: LiveSubReducer<RemotePresence> = (state, action) => {
  if (action.type === "live/module" && action.prefix === REMOTE_PREFIX && action.name === "status") {
    const payload = (action.payload ?? {}) as { connected?: unknown; bound?: unknown };
    const connected = Boolean(payload.connected);
    const bound = Boolean(payload.bound) || connected;
    return state.connected === connected && state.bound === bound ? state : { connected, bound, at: state.at };
  }
  if (action.type !== "live/event") return state;
  const { type, payload } = action.event;
  if (type !== "remote:connected" && type !== "remote:disconnected") return state;
  const at = typeof payload.at === "string" ? payload.at : null;
  const connected = type === "remote:connected";
  return { connected, bound: state.bound || connected, at };
};
