import { defaultForm, type DeckForm } from "./form";
import type {
  DeckCreatedResponse,
  DeckError,
  DeckKindInfo,
  DeckOutline,
  DeckOutlineResponse,
  DeckSource,
  DeckWarning,
} from "./types";

/**
 * Where the author is in the flow:
 * form -> planning -> outline (review) -> writing -> done.
 * A failed plan returns to the form, a failed write to the outline, each with the error.
 */
export type AiDeckPhase = "form" | "planning" | "outline" | "writing" | "done";

export interface AiDeckState {
  phase: AiDeckPhase;
  form: DeckForm;
  outline: DeckOutline | null;
  kinds: DeckKindInfo[];
  /** Where the outline came from: `mock` means placeholder text, not a model. */
  outlineSource: DeckSource | null;
  outlineWarnings: DeckWarning[];
  result: DeckCreatedResponse | null;
  error: DeckError | null;
}

export type AiDeckAction =
  | { type: "edit-form"; patch: Partial<DeckForm> }
  | { type: "plan-start" }
  | { type: "plan-done"; response: DeckOutlineResponse }
  | { type: "plan-failed"; error: DeckError | null }
  | { type: "edit-outline"; outline: DeckOutline }
  | { type: "back-to-form" }
  | { type: "write-start" }
  | { type: "write-done"; response: DeckCreatedResponse }
  | { type: "write-failed"; error: DeckError }
  | { type: "dismiss-error" }
  | { type: "reset"; topic?: string };

export const initialState = (topic = ""): AiDeckState => ({
  phase: "form",
  form: defaultForm(topic),
  outline: null,
  kinds: [],
  outlineSource: null,
  outlineWarnings: [],
  result: null,
  error: null,
});

export function aiDeckReducer(state: AiDeckState, action: AiDeckAction): AiDeckState {
  switch (action.type) {
    case "edit-form":
      // Editing the request makes the planned outline stale; the author goes back through "Plan outline".
      return { ...state, form: { ...state.form, ...action.patch }, error: null };
    case "plan-start":
      return { ...state, phase: "planning", error: null };
    case "plan-done":
      return {
        ...state,
        phase: "outline",
        outline: action.response.outline,
        kinds: action.response.availableKinds,
        outlineSource: action.response.source,
        outlineWarnings: action.response.warnings,
        error: null,
      };
    case "plan-failed":
      return { ...state, phase: "form", error: action.error };
    case "edit-outline":
      return { ...state, outline: action.outline };
    case "back-to-form":
      return { ...state, phase: "form", error: null };
    case "write-start":
      return { ...state, phase: "writing", error: null };
    case "write-done":
      return { ...state, phase: "done", result: action.response, error: null };
    case "write-failed":
      return { ...state, phase: "outline", error: action.error };
    case "dismiss-error":
      return { ...state, error: null };
    case "reset":
      return initialState(action.topic ?? state.form.topic);
  }
}

/** True while a request is in flight (the dialog must not be dismissed mid-write). */
export const isBusy = (state: AiDeckState) => state.phase === "planning" || state.phase === "writing";
