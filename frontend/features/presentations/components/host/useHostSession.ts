"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { toast } from "sonner";

import { getApiErrorMessage, getApiErrorStatus } from "@/lib/api-error";
import {
  advanceSlide,
  endPresentation,
  getHostState,
  openLobby,
  revealCurrentSlide,
} from "../../api/host";
import { useLive, useLiveStore } from "../../live/store";
import { useCountdown } from "../../live/useCountdown";
import { useLiveSocket } from "../../live/useLiveSocket";
import { getSlideRuntime } from "../../slides/runtime";
import type { LiveSocketAuth, PresentationRealtimeEvent } from "../../types";

const HOST_AUTH: LiveSocketAuth = { role: "host" };

/**
 * Host-side session driver: loads host state into the live store, follows
 * the socket, runs the countdown and the timer-driven reveal, and exposes the
 * host controls. Must run inside a host `LiveStoreProvider`.
 */
export function useHostSession(presentationId: string) {
  const store = useLiveStore();
  const searchParams = useSearchParams();
  const isResetRequested = searchParams?.get("reset") === "true";

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const revealFiredRef = useRef(false);
  const hasResetLobbyRef = useRef(false);

  const deck = useLive((s) => s.deck);
  const timing = useLive((s) => s.timing);
  const status = deck?.status;
  const currentSlide = deck?.slides[deck.currentSlideIndex] ?? null;

  const refresh = useCallback(async () => {
    try {
      const state = await getHostState(presentationId);
      let current = state.presentation ?? state.quiz;
      if (!current) throw new Error("Host state is missing the presentation deck");

      // First load only: open the lobby for a draft/ended deck or ?reset=true.
      if (!hasResetLobbyRef.current) {
        hasResetLobbyRef.current = true;
        if (current.status === "draft" || current.status === "ended" || isResetRequested) {
          const loaded = current;
          // Fall back to the loaded state if the lobby cannot be (re)opened.
          current = await openLobby(presentationId).catch(() => loaded);
        }
      }

      store.getState().dispatch({ type: "host/state-loaded", state, deck: current });
    } catch (err: unknown) {
      const status = getApiErrorStatus(err);
      if (status === 404) setLoadError("Presentation deck not found.");
      else if (status === 401 || status === 403) setLoadError("You are not authorized to host this deck.");
      else setLoadError(getApiErrorMessage(err) || "Could not load deck.");
    } finally {
      setLoading(false);
    }
  }, [presentationId, isResetRequested, store]);

  // Every setState in refresh() runs after its awaited fetch, but the rule does
  // not model `await` and reports them as synchronous.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void refresh(); }, [refresh]);

  // Joins can be missed between the page load and the socket join; poll the lobby.
  useEffect(() => {
    if (status !== "lobby") return;
    const interval = setInterval(() => void refresh(), 3000);
    return () => clearInterval(interval);
  }, [status, refresh]);

  const { connected } = useLiveSocket(presentationId, HOST_AUTH, (event: PresentationRealtimeEvent) => {
    switch (event.type) {
      case "question:revealed":
        revealFiredRef.current = true;
        void refresh();
        break;
      case "question:started":
        revealFiredRef.current = false;
        void refresh();
        break;
      case "leaderboard:shown":
      case "quiz:ended":
        void refresh();
        break;
    }
  });

  const endsAt = timing?.endsAt ?? null;
  const countdown = useCountdown(endsAt, timing?.serverNow ?? null, currentSlide?.timeLimit ?? 30);
  const { expired } = countdown;
  const revealable = currentSlide ? getSlideRuntime(currentSlide.type)?.lifecycle === "response" : false;

  // Auto-reveal when the timer hits 0.
  useEffect(() => {
    if (status !== "active" || !expired || !endsAt || busy || revealFiredRef.current) return;
    if (!revealable) return;
    revealFiredRef.current = true;
    void revealCurrentSlide(presentationId).catch(() => {});
  }, [expired, status, endsAt, busy, presentationId, revealable]);

  const handleOpenLobby = async () => {
    setBusy(true);
    try {
      const deck = await openLobby(presentationId);
      store.getState().dispatch({ type: "host/lobby-opened", deck });
      toast.success("Lobby opened — code " + deck.joinCode);
    } catch (err: unknown) {
      toast.error(getApiErrorMessage(err) || "Failed to open lobby.");
    } finally {
      setBusy(false);
    }
  };

  const handleAdvance = async (targetIndex?: number) => {
    setBusy(true);
    try {
      const deck = await advanceSlide(presentationId, targetIndex);
      store.getState().dispatch({ type: "host/advanced", deck, serverNow: new Date().toISOString() });
      revealFiredRef.current = false;
    } catch (err: unknown) {
      toast.error(getApiErrorMessage(err) || "Failed to advance slide.");
    } finally {
      setBusy(false);
    }
  };

  const handleEnd = async () => {
    if (!window.confirm("End the session for all participants?")) return;
    setBusy(true);
    try {
      const deck = await endPresentation(presentationId);
      store.getState().dispatch({ type: "host/ended", deck });
      toast.success("Session ended.");
    } catch (err: unknown) {
      toast.error(getApiErrorMessage(err) || "Failed to end session.");
    } finally {
      setBusy(false);
    }
  };

  return {
    loading,
    loadError,
    busy,
    connected,
    countdown,
    openLobby: handleOpenLobby,
    advance: handleAdvance,
    end: handleEnd,
  };
}
