"use client";

import { useEffect, useRef, useState } from "react";

import { useLive, useLiveStore, type LiveStoreApi } from "@/features/presentations/live/store";
import { listHostQuestions, listQuestions } from "./api";
import { initialQnaState, QNA_PREFIX, qnaActions, type QnaState } from "./state";

/** The Q&A slice of the surrounding live store. */
export const selectQna = (state: { modules: Record<string, unknown> }): QnaState =>
  (state.modules[QNA_PREFIX] as QnaState | undefined) ?? initialQnaState;

const inflight = new WeakMap<LiveStoreApi, Promise<boolean>>();

/**
 * Loads the session's questions into the live store: a participant's list
 * (visible + own pending) or the host's full list. One request per store at a
 * time. Resolves false when the request failed (the slice stays unloaded).
 */
export function loadQna(store: LiveStoreApi): Promise<boolean> {
  const running = inflight.get(store);
  if (running) return running;

  const { role, presentationId, self, dispatch } = store.getState();
  if (!presentationId) return Promise.resolve(false);
  if (role === "participant" && !self) return Promise.resolve(false);

  const request = (async () => {
    try {
      if (role === "host") {
        dispatch(qnaActions.loadedForHost(await listHostQuestions(presentationId)));
      } else if (self) {
        dispatch(
          qnaActions.loadedForParticipant(
            await listQuestions(presentationId, { participantId: self.participantId, token: self.token })
          )
        );
      }
      return true;
    } catch {
      return false;
    } finally {
      inflight.delete(store);
    }
  })();
  inflight.set(store, request);
  return request;
}

/**
 * Keeps the Q&A slice filled: loads once the surface knows the deck (and the
 * participant their identity), again after the slice was reset by a new
 * session, and again after a socket reconnect (events may have been missed).
 * Returns whether the last load failed, for a retry button.
 */
export function useQnaSync(): { loaded: boolean; failed: boolean; retry: () => void } {
  const store = useLiveStore();
  const presentationId = useLive((s) => s.presentationId);
  const participantId = useLive((s) => s.self?.participantId ?? null);
  const role = useLive((s) => s.role);
  const connected = useLive((s) => s.connected);
  const loaded = useLive((s) => selectQna(s).loaded);
  const [failed, setFailed] = useState(false);
  const wasConnected = useRef(false);

  const ready = Boolean(presentationId) && (role === "host" || participantId !== null);

  const run = () => {
    void loadQna(store).then((ok) => {
      setFailed(!ok);
    });
  };

  useEffect(() => {
    if (!ready || loaded) return;
    run();
    // `run` only reads refs and the stable store.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, loaded, presentationId, participantId]);

  useEffect(() => {
    if (connected && wasConnected.current && ready) run();
    wasConnected.current = connected;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connected]);

  return { loaded, failed: failed && !loaded, retry: run };
}
