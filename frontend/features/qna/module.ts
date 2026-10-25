import { registerLiveReducer } from "@/features/presentations/live/reducer";
import { registerSlot } from "@/features/presentations/live/slots";
import { HighlightOverlay } from "./components/HighlightOverlay";
import { HostQnaDrawer } from "./components/HostQnaDrawer";
import { PresenterQnaPanel, QnaParticipantSync, QnaTab } from "./components/QnaSlots";
import { initialQnaState, QNA_PREFIX, qnaReducer } from "./state";
import { qnaTabAvailable } from "./tabAvailability";

/**
 * Registers Q&A on the live surfaces: the `qna` state slice, the participant
 * tab (with its loader), the host's moderation drawer, the presenter console
 * panel and the highlighted question over the stage. Returns the function
 * that undoes it (tests). `register.ts` calls this once at import.
 */
export function registerQnaModule(): () => void {
  const disposers = [
    registerLiveReducer(QNA_PREFIX, qnaReducer, initialQnaState),
    registerSlot("participantTabs", {
      id: "qna",
      order: 20,
      label: "Q&A",
      when: ({ presentationId }) => qnaTabAvailable(presentationId),
      Component: QnaTab,
    }),
    registerSlot("participantBanner", { id: "qna-sync", order: 20, Component: QnaParticipantSync }),
    registerSlot("hostToolbar", { id: "qna", order: 20, Component: HostQnaDrawer }),
    registerSlot("presenterPanels", { id: "qna", order: 20, Component: PresenterQnaPanel }),
    registerSlot("stageOverlays", { id: "qna-highlight", order: 20, Component: HighlightOverlay }),
  ];
  return () => disposers.forEach((dispose) => dispose());
}
