"use client";

import { createContext, createElement, useContext, type ReactNode } from "react";
import { createStore, useStore, type StoreApi } from "zustand";

import { getApiErrorMessage, getApiErrorStatus } from "@/lib/api-error";
import { getParticipantState, submitAnswer as postAnswer } from "../api/participant";
import type { AnswerPayload } from "../types";
import {
  createInitialLiveState,
  liveReducer,
  type LiveAction,
  type LiveRole,
  type LiveState,
} from "./reducer";

export type SubmitAnswerResult =
  | { status: "accepted" }
  /** The server already had an answer for this slide (409) — counts as submitted. */
  | { status: "duplicate" }
  | { status: "skipped" }
  /** `message` is the API's error text when it sent one; the caller supplies the fallback. */
  | { status: "error"; message?: string };

export interface LiveStore extends LiveState {
  dispatch: (action: LiveAction) => void;
  /** Participant: submit an answer for the slide on screen, then refresh `me`. */
  submitAnswer: (payload: AnswerPayload) => Promise<SubmitAnswerResult>;
  /** Participant: refresh own score/rank/last answer. Failures keep the old value. */
  loadMe: () => Promise<void>;
}

export type LiveStoreApi = StoreApi<LiveStore>;

/**
 * One store per mounted live surface (host console, participant shell), so a
 * client-side navigation never shows another session's state. State changes
 * only through `dispatch` → `liveReducer`.
 */
export function createLiveStore(role: LiveRole, init: Partial<LiveState> = {}): LiveStoreApi {
  return createStore<LiveStore>()((set, get) => ({
    ...createInitialLiveState(role, init),

    dispatch: (action) => set((state) => liveReducer(state, action)),

    submitAnswer: async (payload) => {
      const { presentationId, self, slide, dispatch, loadMe } = get();
      if (!presentationId || !self || !slide) return { status: "skipped" };
      const slideIndex = slide.slideIndex;
      try {
        await postAnswer(presentationId, {
          participantId: self.participantId,
          participantToken: self.token,
          slideIndex,
          ...payload,
        });
        dispatch({ type: "participant/submitted", slideIndex });
        // Scored slides show green/red on the participant's own pick right
        // away; the correct answer itself stays hidden until reveal.
        void loadMe();
        return { status: "accepted" };
      } catch (err: unknown) {
        if (getApiErrorStatus(err) === 409) {
          dispatch({ type: "participant/submitted", slideIndex });
          void loadMe();
          return { status: "duplicate" };
        }
        return { status: "error", message: getApiErrorMessage(err) };
      }
    },

    loadMe: async () => {
      const { presentationId, self, dispatch } = get();
      if (!presentationId || !self) return;
      try {
        const me = await getParticipantState(presentationId, self.participantId, self.token);
        dispatch({ type: "participant/me-loaded", me });
      } catch {
        // Score panel just stays as it was.
      }
    },
  }));
}

const LiveStoreContext = createContext<LiveStoreApi | null>(null);

export function LiveStoreProvider({ store, children }: { store: LiveStoreApi; children: ReactNode }) {
  return createElement(LiveStoreContext.Provider, { value: store }, children);
}

/** The surrounding live store (imperative access: `getState()`, `subscribe`). */
export function useLiveStore(): LiveStoreApi {
  const store = useContext(LiveStoreContext);
  if (!store) throw new Error("useLiveStore must be used inside <LiveStoreProvider>");
  return store;
}

/** Subscribes to a slice of the surrounding live store. Select primitives or stable references. */
export function useLive<T>(selector: (state: LiveStore) => T): T {
  return useStore(useLiveStore(), selector);
}

let emptyStore: LiveStoreApi | null = null;

/**
 * `useLive` for views that also render outside a live surface (builder
 * previews, thumbnails): there it reads an empty participant store.
 */
export function useLiveOptional<T>(selector: (state: LiveStore) => T): T {
  const store = useContext(LiveStoreContext) ?? (emptyStore ??= createLiveStore("participant"));
  return useStore(store, selector);
}
