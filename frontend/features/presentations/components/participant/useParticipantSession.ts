"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { getPresentationByCode } from "../../api/participant";
import { useLive, useLiveStore } from "../../live/store";
import { useLiveSocket } from "../../live/useLiveSocket";
import type { PresentationRealtimeEvent } from "../../types";
import { forgetCredentials, readCredentials, readDevice } from "./participantSession";

/** Events after which the participant re-reads own score, rank and last answer. */
const REFRESH_ME_ON = new Set(["slide:closed", "question:revealed", "leaderboard:shown", "session:ended"]);

export type ParticipantLoad = "loading" | "ready" | "not-found";

/**
 * Participant-side session driver: looks the code up, picks the stored
 * credentials of **that session**, resyncs from `GET /:id/live-state` (on load,
 * on every socket (re)join, when the tab returns, when a host seq reset is
 * seen), follows the socket, and reacts when the credentials stop working
 * (`kicked` stays as it is; `stale`/`missing` forget them and look the code up
 * again, so the participant can rejoin the live session). Must run inside a
 * participant `LiveStoreProvider`.
 */
export function useParticipantSession(code: string) {
  const store = useLiveStore();
  const [load, setLoad] = useState<ParticipantLoad>("loading");
  /** Id of a newer live session of the deck while this one is over. */
  const [newerSessionId, setNewerSessionId] = useState<string | null>(null);
  const checkedForeign = useRef(new Set<string>());

  const presentationId = useLive((s) => s.presentationId);
  const self = useLive((s) => s.self);
  const sessionId = useLive((s) => s.sessionId);
  const lost = useLive((s) => s.lost);

  /**
   * Code lookup → stored credentials of the session it names (or, once the
   * deck has ended, of the last session joined, to keep showing the standings)
   * → `live-state`.
   */
  const loadInfo = useCallback(async () => {
    try {
      const info = await getPresentationByCode(code);
      const receivedAt = Date.now();
      const liveSessionId = info.sessionId ?? null;
      const credentialSessionId = liveSessionId ?? readDevice(code).lastSessionId ?? null;
      const credentials = readCredentials(code, credentialSessionId);
      store.getState().dispatch({
        type: "participant/info-loaded",
        info,
        self: credentials,
        sessionId: credentials ? credentialSessionId : liveSessionId,
        receivedAt,
      });
      setLoad("ready");
      if (credentials) await store.getState().loadLiveState();
    } catch {
      setLoad("not-found");
    }
  }, [code, store]);

  // Every setState in loadInfo runs after its awaited fetch; the rule does not
  // model `await` and reports it as synchronous.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void loadInfo(); }, [loadInfo]);

  // The credentials stopped working: forget them. A kicked participant stays
  // out; otherwise look up which session is live and offer to (re)join it.
  useEffect(() => {
    let previous = store.getState().lost;
    return store.subscribe((state) => {
      if (state.lost === previous) return;
      previous = state.lost;
      if (!state.lost) return;
      forgetCredentials(code, state.sessionId);
      if (state.lost !== "kicked") void loadInfo();
    });
  }, [store, code, loadInfo]);

  // Any reason (rejoined, tab visible, seq reset) means the same thing here: read `live-state`.
  const resync = useCallback(() => {
    if (store.getState().self) void store.getState().loadLiveState();
  }, [store]);

  /** Another session's envelope: ours is over or about to be. Look at most once per foreign session. */
  const onForeignSession = useCallback(
    (event: PresentationRealtimeEvent) => {
      const foreign = event.sessionId;
      if (!foreign || checkedForeign.current.has(foreign)) return;
      checkedForeign.current.add(foreign);
      void getPresentationByCode(code)
        .then((info) => {
          const current = store.getState();
          if (!info.sessionId || info.sessionId === current.sessionId) return;
          // We missed our session's end: re-read it, which shows the final screen.
          if (current.self && current.status !== "ended") void current.loadLiveState();
          setNewerSessionId(info.sessionId);
        })
        .catch(() => {});
    },
    [code, store]
  );

  useLiveSocket(
    presentationId,
    self ? { role: "participant", participantId: self.participantId, participantToken: self.token } : undefined,
    {
      onEvent: (event) => {
        if (REFRESH_ME_ON.has(event.type)) void store.getState().loadMe();
      },
      onResync: resync,
      onForeignSession,
      // A refused room join usually means the credentials are bad; the REST
      // read tells which way (`kicked`, `stale`, `missing`).
      onJoinError: (error) => {
        if (error === "FORBIDDEN") void store.getState().loadLiveState();
      },
    }
  );

  /** From the "a new session is live" notice: leave the finished session and show the join form. */
  const joinNewerSession = useCallback(async () => {
    setNewerSessionId(null);
    await loadInfo();
  }, [loadInfo]);

  return { load, self, sessionId, lost, newerSessionId, joinNewerSession };
}
