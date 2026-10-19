import { isCancelled, toDeckError, type DeckApi } from "./api";
import { toRequest, type DeckForm } from "./form";
import { cleanOutline } from "./outline";
import type { AiDeckAction } from "./state";
import type { DeckOutline } from "./types";

/**
 * The two async steps of the flow as functions from inputs to dispatched actions,
 * so they run (and are tested) without React.
 */

/** Step 1. `deckTitle` is the name the author already gave the deck, if any. */
export async function planOutline(
  api: DeckApi,
  form: DeckForm,
  deckTitle: string,
  dispatch: (action: AiDeckAction) => void,
  signal?: AbortSignal
): Promise<void> {
  dispatch({ type: "plan-start" });
  try {
    const response = await api.planOutline(toRequest(form, "outline", { title: deckTitle }), signal);
    dispatch({ type: "plan-done", response });
  } catch (error) {
    // A cancelled plan goes back to the form without an error.
    dispatch({ type: "plan-failed", error: isCancelled(error) ? null : toDeckError(error) });
  }
}

/** Step 2: sends the reviewed outline; resolves with the created deck on success, null otherwise. */
export async function writeDeck(
  api: DeckApi,
  form: DeckForm,
  outline: DeckOutline,
  dispatch: (action: AiDeckAction) => void
) {
  dispatch({ type: "write-start" });
  try {
    const response = await api.createDeck(toRequest(form, "deck", { outline: cleanOutline(outline) }));
    dispatch({ type: "write-done", response });
    return response;
  } catch (error) {
    dispatch({ type: "write-failed", error: toDeckError(error) });
    return null;
  }
}
