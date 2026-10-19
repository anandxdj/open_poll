import { registerLiveReducer } from "@/features/presentations/live/reducer";
import { registerSlot } from "@/features/presentations/live/slots";
import { ReactionsBar } from "./components/ReactionsBar";
import { ReactionsOverlay } from "./components/ReactionsOverlay";
import { initialReactionState, REACTION_PREFIX, reactionReducer } from "./state";

/**
 * Registers emoji reactions on the live surfaces: the `reaction` state slice
 * (the latest coalesced burst), the participant's reaction bar and the floating
 * emoji over the stage. Returns the function that undoes it (tests).
 * `register.ts` calls this once at import.
 */
export function registerReactionsModule(): () => void {
  const disposers = [
    registerLiveReducer(REACTION_PREFIX, reactionReducer, initialReactionState),
    registerSlot("participantFooter", { id: "reactions", order: 20, Component: ReactionsBar }),
    registerSlot("stageOverlays", { id: "reactions", order: 30, Component: ReactionsOverlay }),
  ];
  return () => disposers.forEach((dispose) => dispose());
}
