"use client";

import { createContext, createElement, useContext, type ReactNode } from "react";
import { createStore, useStore, type StoreApi } from "zustand";

import { getApiErrorMessage, getApiErrorStatus } from "@/lib/api-error";
import { getParticipantLiveState, getParticipantState, submitAnswer as postAnswer } from "../api/participant";
import type { AnswerPayload } from "../types";
import { getApiErrorCode, LIVE_ERROR_CODES } from "./errors";
import {
  createInitialLiveState,
  liveReducer,
  type LiveAction,
  type LiveRole,
  type LiveState,
  type ParticipantLostReason,
} from "./reducer";

export type SubmitAnswerResult =
  | { status: "accepted" }
  /** The server already had an answer for this slide (409) — counts as submitted. */
  | { status: "duplicate" }
  | { status: "skipped" }
  /**
   * `message` is the API's error text when it sent one; the caller supplies the
   * fallback. `code` is the live error code (`PARTICIPANT_STALE`, …) when sent.
   */
  | { status: "error"; message?: string; code?: string };

export interface LiveStore extends LiveState {
  dispatch: (action: LiveAction) => void;
  /**
   * Participant: submit an answer for the slide on screen, then refresh `me`.
   * The one place answers leave the client (the offline queue and socket ack
   * plug in here).
   */
  submitAnswer: (payload: AnswerPayload) => Promise<SubmitAnswerResult>;
  /** Participant: refresh own score/rank/last answer. Failures keep the old value. */
  loadMe: () => Promise<void>;
  /**
   * Replaces the state with a REST snapshot (`load` resolves to the action
   * that applies it, or null to skip). Envelopes that arrive while the request
   * is in flight are replayed on top, so a snapshot older than the latest
   * event never wins. When resyncs overlap, only the latest one applies.
   * Resolves to whether the snapshot was applied; rejects with `load`'s error.
   */
  resync: (load: () => Promise<LiveAction | null>) => Promise<boolean>;
  /** Participant: resync from `GET /:id/live-state`. Credential failures land in `lost`. */
  loadLiveState: () => Promise<boolean>;
}

export type LiveStoreApi = StoreApi<LiveStore>;

/** Maps a participant API failure to the reason the credentials stopped working, if it is one. */
export function participantLostReason(err: unknown): ParticipantLostReason | null {
  const code = getApiErrorCode(err);
  if (code === LIVE_ERROR_CODES.participantKicked) return "kicked";
  if (code === LIVE_ERROR_CODES.participantStale) return "stale";
  const status = getApiErrorStatus(err);
  if (status === 404 || status === 401) return "missing";
  return null;
}

/**
 * One store per mounted live surface (host console, participant shell), so a
 * client-side navigation never shows another session's state. State changes
 * only through `dispatch` → `liveReducer`.
 */
export function createLiveStore(role: LiveRole, init: Partial<LiveState> = {}): LiveStoreApi {
  // Event actions recorded while a resync request is in flight, per request.
  const recorders = new Set<LiveAction[]>();
  let resyncToken = 0;

  return createStore<LiveStore>()((set, get) => {
    const apply = (action: LiveAction) => set((state) => liveReducer(state, action));

    return {
      ...createInitialLiveState(role, init),

      dispatch: (action) => {
        if (action.type === "live/event") for (const buffer of recorders) buffer.push(action);
        apply(action);
      },

      resync: async (load) => {
        const token = ++resyncToken;
        const buffer: LiveAction[] = [];
        recorders.add(buffer);
        try {
          const action = await load();
          if (!action || token !== resyncToken) return false;
          apply(action);
          for (const event of buffer) apply(event);
          return true;
        } finally {
          recorders.delete(buffer);
        }
      },

      loadLiveState: async () => {
        const { presentationId, self, resync, dispatch } = get();
        if (!presentationId || !self) return false;
        try {
          return await resync(async () => ({
            type: "participant/live-state",
            state: await getParticipantLiveState(presentationId, self.participantId, self.token),
            receivedAt: Date.now(),
          }));
        } catch (err: unknown) {
          const reason = participantLostReason(err);
          if (reason) dispatch({ type: "participant/lost", reason });
          return false;
        }
      },

      submitAnswer: async (payload) => {
        const { presentationId, sessionId, self, slide, slideId, dispatch, loadMe } = get();
        if (!presentationId || !self || !slide) return { status: "skipped" };
        const slideIndex = slide.slideIndex;
        try {
          await postAnswer(presentationId, {
            participantId: self.participantId,
            participantToken: self.token,
            slideIndex,
            ...(sessionId ? { sessionId } : {}),
            ...(slideId ? { slideId } : {}),
            ...payload,
          });
          dispatch({ type: "participant/submitted", slideIndex });
          // Scored slides show green/red on the participant's own pick right
          // away; the correct answer itself stays hidden until reveal.
          void loadMe();
          return { status: "accepted" };
        } catch (err: unknown) {
          const code = getApiErrorCode(err);
          const reason = participantLostReason(err);
          if (reason) {
            dispatch({ type: "participant/lost", reason });
            return { status: "error", message: getApiErrorMessage(err), code };
          }
          if (getApiErrorStatus(err) === 409) {
            dispatch({ type: "participant/submitted", slideIndex });
            void loadMe();
            return { status: "duplicate" };
          }
          return { status: "error", message: getApiErrorMessage(err), code };
        }
      },

      loadMe: async () => {
        const { presentationId, self, dispatch } = get();
        if (!presentationId || !self) return;
        try {
          const me = await getParticipantState(presentationId, self.participantId, self.token);
          dispatch({ type: "participant/me-loaded", me });
        } catch (err: unknown) {
          // Score panel just stays as it was, unless the identity is gone.
          const reason = participantLostReason(err);
          if (reason === "kicked" || reason === "missing") dispatch({ type: "participant/lost", reason });
        }
      },
    };
  });
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
