import { registerLiveReducer } from "@/features/presentations/live/reducer";
import { initialRemotePresence, REMOTE_PREFIX, remotePresenceReducer } from "./remoteState";

/**
 * Registers the presenter tools' live state (W2-A): the phone remote's
 * presence (`remote:*` events). Returns the function that undoes it (tests).
 * `register.ts` calls this once at import.
 */
export function registerPresenterModule(): () => void {
  const disposers = [registerLiveReducer(REMOTE_PREFIX, remotePresenceReducer, initialRemotePresence)];
  return () => disposers.forEach((dispose) => dispose());
}
