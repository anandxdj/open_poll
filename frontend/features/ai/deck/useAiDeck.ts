"use client";

import { useCallback, useEffect, useReducer, useRef } from "react";

import { deckApi, type DeckApi } from "./api";
import { planOutline, writeDeck } from "./flow";
import { aiDeckReducer, initialState, type AiDeckState } from "./state";
import type { DeckCreatedResponse } from "./types";

export interface UseAiDeckOptions {
  /** Seeds the topic field. */
  initialTopic?: string;
  /** The name the author already gave the deck; becomes the outline's title. */
  deckTitle?: string;
  api?: DeckApi;
}

/** State and actions of the whole-deck flow (reducer in `state.ts`, async steps in `flow.ts`). */
export function useAiDeck({ initialTopic = "", deckTitle = "", api = deckApi }: UseAiDeckOptions = {}) {
  const [state, dispatch] = useReducer(aiDeckReducer, initialTopic, initialState);
  const stateRef = useRef<AiDeckState>(state);
  const controller = useRef<AbortController | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    stateRef.current = state;
  });

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      controller.current?.abort();
    };
  }, []);

  // Updates after unmount are dropped: the dialog may be closed while a request is in flight.
  const safeDispatch = useCallback((action: Parameters<typeof dispatch>[0]) => {
    if (mounted.current) dispatch(action);
  }, []);

  const plan = useCallback(async () => {
    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
    await planOutline(api, stateRef.current.form, deckTitle, safeDispatch, abort.signal);
  }, [api, deckTitle, safeDispatch]);

  const cancelPlan = useCallback(() => controller.current?.abort(), []);

  const write = useCallback(async (): Promise<DeckCreatedResponse | null> => {
    const { form, outline } = stateRef.current;
    if (!outline) return null;
    return writeDeck(api, form, outline, safeDispatch);
  }, [api, safeDispatch]);

  return { state, dispatch, plan, cancelPlan, write };
}
