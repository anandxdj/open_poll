"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { getApiErrorStatus } from "@/lib/api-error";
import { useLive, useLiveStore } from "@/features/presentations/live/store";
import { useCountdown } from "@/features/presentations/live/useCountdown";
import { useLiveSocket, type ResyncReason } from "@/features/presentations/live/useLiveSocket";
import type { LiveSocketAuth } from "@/features/presentations/types";
import { qnaActions } from "@/features/qna/state";
import { getScreenState } from "../api";

/** Why a screen shows a notice instead of the stage. */
export type ScreenProblem = "notFound" | "disabled" | "revoked" | "failed";

const RESYNC_MIN_INTERVAL_MS = 1_000;

/**
 * Drives a read-only stage (W4-D). Reads `GET /api/embeds/stage` with the
 * screen token into a host-shaped live store, joins the deck as `screen` and
 * follows the events (the stage-safe `answer:received` included), and re-reads
 * the state on every (re)join, return to the tab, `seq` reset, and when a
 * response slide opens, closes or is revealed (the revealed slide's answer key
 * only comes with the state). The state also carries the session's public Q&A,
 * loaded into the Q&A slice. When the link is turned off or the deck stops
 * allowing embedding, the server sends the screen away (`screen:revoked`). A `seq` gap is normal for a screen (it does not
 * get every host event), so it is not a reason to re-read. Never sends a command.
 */
export function useScreenSession(presentationId: string, screenToken: string) {
  const store = useLiveStore();
  const [loading, setLoading] = useState(true);
  const [problem, setProblem] = useState<ScreenProblem | null>(null);
  const refreshing = useRef({ inFlight: false, queued: false, startedAt: 0, timer: null as ReturnType<typeof setTimeout> | null });

  const timing = useLive((s) => s.timing);
  const currentSlide = useLive((s) => s.deck?.slides[s.currentSlideIndex] ?? null);

  const refresh = useCallback(async () => {
    const r = refreshing.current;
    if (r.inFlight) {
      r.queued = true;
      return;
    }
    r.inFlight = true;
    try {
      do {
        r.queued = false;
        r.startedAt = Date.now();
        try {
          const state = await getScreenState(screenToken);
          const deckId = state.presentation?._id ?? state.quiz?._id;
          if (deckId !== presentationId) {
            // The token belongs to another deck: this URL is wrong.
            setProblem("notFound");
            continue;
          }
          await store.getState().resync(async () => ({ type: "host/state-loaded", state, receivedAt: Date.now() }));
          // The session's public Q&A as it is now: a screen that joins mid-session shows
          // the approved and highlighted questions, then follows the qna:* events.
          if (state.qna) store.getState().dispatch(qnaActions.loadedForParticipant(state.qna));
          setProblem(null);
        } catch (err: unknown) {
          const status = getApiErrorStatus(err);
          if (status === 404) setProblem("notFound");
          else if (status === 403) setProblem("disabled");
          // A failed refresh of a loaded stage keeps what is on screen.
          else if (!store.getState().deck) setProblem("failed");
        }
      } while (r.queued);
    } finally {
      r.inFlight = false;
      setLoading(false);
    }
  }, [presentationId, screenToken, store]);

  const requestRefresh = useCallback(
    (reason: ResyncReason) => {
      if (reason === "gap") return;
      const r = refreshing.current;
      const wait = reason === "joined" ? 0 : r.startedAt + RESYNC_MIN_INTERVAL_MS - Date.now();
      if (wait <= 0) {
        void refresh();
        return;
      }
      if (r.timer) return;
      r.timer = setTimeout(() => {
        r.timer = null;
        void refresh();
      }, wait);
    },
    [refresh]
  );

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const r = refreshing.current;
    return () => {
      if (r.timer) clearTimeout(r.timer);
    };
  }, []);

  const auth: LiveSocketAuth | undefined = problem === null || problem === "failed" ? { role: "screen", screenToken } : undefined;
  const { connected } = useLiveSocket(presentationId, auth, {
    onEvent: (event) => {
      if (event.type === "question:started" || event.type === "slide:closed" || event.type === "question:revealed") {
        requestRefresh("visible");
      }
    },
    onResync: requestRefresh,
    // The host presented again (a new session): read which one is live.
    onForeignSession: () => requestRefresh("visible"),
    onJoinError: (error) => {
      if (error === "FORBIDDEN") void refresh();
    },
    onScreenRevoked: (reason) => setProblem(reason === "embed_disabled" ? "disabled" : "revoked"),
  });

  const countdown = useCountdown(timing, currentSlide?.timeLimit ?? 30);
  return { loading, problem, connected, countdown, retry: refresh };
}
