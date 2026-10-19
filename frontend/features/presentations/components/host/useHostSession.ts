"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

import { getApiErrorMessage, getApiErrorStatus } from "@/lib/api-error";
import {
  closeVoting,
  endSession,
  getHostState,
  gotoSlide,
  openLobby,
  reopenVoting,
  revealResults,
  startSession,
} from "../../api/host";
import { LIVE_ERROR_CODES } from "../../live/errors";
import { useLive, useLiveStore } from "../../live/store";
import { useCountdown } from "../../live/useCountdown";
import { useLiveSocket, type ResyncReason } from "../../live/useLiveSocket";
import type { HostCommandResponse, LiveSocketAuth } from "../../types";
import { sendHostCommand, type HostCommandOutcome } from "./hostCommands";

const HOST_AUTH: LiveSocketAuth = { role: "host" };

/** Resyncs triggered by the stream itself (gaps, tab focus) run at most this often. */
const RESYNC_MIN_INTERVAL_MS = 1_000;
type CommandName = "start" | "openLobby" | "goto" | "close" | "reopen" | "reveal" | "end";

/**
 * Host-side session driver. On mount it only **reads** `GET /:id/host/state`
 * — it never opens a lobby or starts anything by itself — and the console
 * renders what the server reports: no session yet or an ended one (start
 * presenting / open the lobby), a lobby, or a live session resumed where it
 * is. It then follows the socket, resyncing from host state on every (re)join,
 * `seq` gap, tab focus and foreign-session envelope, and exposes the host
 * commands. Must run inside a host `LiveStoreProvider`.
 */
export function useHostSession(presentationId: string) {
  const t = useTranslations("presenter");
  const store = useLiveStore();

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const autoRevealKey = useRef<string | null>(null);
  const refreshing = useRef({ inFlight: false, queued: false, startedAt: 0, timer: null as ReturnType<typeof setTimeout> | null });

  const status = useLive((s) => s.status);
  const phase = useLive((s) => s.phase);
  const timing = useLive((s) => s.timing);
  const sessionId = useLive((s) => s.sessionId);
  const slideId = useLive((s) => s.slideId);
  const currentSlide = useLive((s) => s.deck?.slides[s.currentSlideIndex] ?? null);

  // ---------- reading state ----------

  const refresh = useCallback(async () => {
    const r = refreshing.current;
    if (r.inFlight) {
      // One more read after the current one, however many calls pile up.
      r.queued = true;
      return;
    }
    r.inFlight = true;
    try {
      do {
        r.queued = false;
        r.startedAt = Date.now();
        try {
          await store.getState().resync(async () => ({
            type: "host/state-loaded",
            state: await getHostState(presentationId),
            receivedAt: Date.now(),
          }));
          setLoadError(null);
        } catch (err: unknown) {
          // A failed refresh of a loaded console keeps what is on screen.
          if (!store.getState().deck) {
            const httpStatus = getApiErrorStatus(err);
            if (httpStatus === 404) setLoadError(t("load.notFound"));
            else if (httpStatus === 401 || httpStatus === 403) setLoadError(t("load.forbidden"));
            else setLoadError(getApiErrorMessage(err) || t("load.failed"));
          }
        }
      } while (r.queued);
    } finally {
      r.inFlight = false;
      setLoading(false);
    }
  }, [presentationId, store, t]);

  /** Stream-triggered resyncs are rate limited: a burst of gaps becomes one read. */
  const requestRefresh = useCallback(
    (reason: ResyncReason) => {
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

  const { connected } = useLiveSocket(presentationId, HOST_AUTH, {
    onResync: requestRefresh,
    // A session this console does not follow: started from another window, or
    // our own start/open-lobby racing its HTTP response. Read what is live.
    onForeignSession: () => requestRefresh("gap"),
  });

  // Joins can be missed while the socket is down; fall back to polling the lobby.
  useEffect(() => {
    if (status !== "lobby" || connected) return;
    const interval = setInterval(() => void refresh(), 3000);
    return () => clearInterval(interval);
  }, [status, connected, refresh]);

  // ---------- commands ----------

  const failureMessage = useCallback(
    (name: CommandName, outcome: Extract<HostCommandOutcome, { ok: false }>) => {
      if (outcome.code === LIVE_ERROR_CODES.sessionAlreadyLive) return t("errors.alreadyLive");
      if (outcome.code === LIVE_ERROR_CODES.noLiveSession) return t("errors.noLiveSession");
      if (outcome.code === LIVE_ERROR_CODES.sessionBusy) return t("errors.busy");
      return outcome.message || t(`errors.${name}`);
    },
    [t]
  );

  /**
   * Runs one host command at a time (a held arrow key or a double click must
   * not stack navigations). `SESSION_BUSY` is retried once; `SESSION_ALREADY_LIVE`
   * and `NO_LIVE_SESSION` mean this console is out of date, so it re-reads the state.
   */
  const run = useCallback(
    async (name: CommandName, send: () => Promise<HostCommandResponse>): Promise<HostCommandResponse | null> => {
      if (busyRef.current) return null;
      busyRef.current = true;
      setBusy(true);
      try {
        const outcome = await sendHostCommand(send);
        if (outcome.ok) {
          store.getState().dispatch({ type: "host/command", response: outcome.response });
          return outcome.response;
        }
        toast.error(failureMessage(name, outcome));
        if (outcome.stale) void refresh();
        return null;
      } finally {
        busyRef.current = false;
        setBusy(false);
      }
    },
    [store, failureMessage, refresh]
  );

  const start = useCallback(() => run("start", () => startSession(presentationId)), [run, presentationId]);

  const openLobbyNow = useCallback(async () => {
    const response = await run("openLobby", () => openLobby(presentationId));
    if (response) toast.success(t("toasts.lobbyOpened", { code: response.session.joinCode }));
  }, [run, presentationId, t]);

  const goto = useCallback(
    (slideIndex: number) => {
      const { totalSlides, currentSlideIndex } = store.getState();
      if (slideIndex < 0 || slideIndex >= totalSlides || slideIndex === currentSlideIndex) return Promise.resolve(null);
      return run("goto", () => gotoSlide(presentationId, slideIndex));
    },
    [run, presentationId, store]
  );

  const next = useCallback(() => goto(store.getState().currentSlideIndex + 1), [goto, store]);
  const previous = useCallback(() => goto(store.getState().currentSlideIndex - 1), [goto, store]);
  const close = useCallback(() => run("close", () => closeVoting(presentationId)), [run, presentationId]);
  const reopen = useCallback(() => run("reopen", () => reopenVoting(presentationId)), [run, presentationId]);
  const reveal = useCallback(() => run("reveal", () => revealResults(presentationId)), [run, presentationId]);

  const end = useCallback(async () => {
    if (!window.confirm(t("toasts.confirmEnd"))) return;
    const response = await run("end", () => endSession(presentationId));
    if (response) toast.success(t("toasts.sessionEnded"));
  }, [run, presentationId, t]);

  // ---------- timer-driven reveal ----------

  const countdown = useCountdown(timing, currentSlide?.timeLimit ?? 30);

  // When a timed answer window runs out the host reveals it, once per window
  // (a reopen opens a new window). Skipped while another command is in flight:
  // `reveal` acts on whatever slide is current when it lands.
  const revealKey = `${sessionId}:${slideId}:${timing?.startedAt ?? ""}:${timing?.endsAt ?? ""}`;
  useEffect(() => {
    if (status !== "active" || phase !== "open" || !timing?.endsAt || !countdown.expired) return;
    if (busy || autoRevealKey.current === revealKey) return;
    autoRevealKey.current = revealKey;
    void revealResults(presentationId)
      .then((response) => store.getState().dispatch({ type: "host/command", response }))
      .catch(() => {
        // Not revealed (offline, or the slide moved on): let the next change retry.
        autoRevealKey.current = null;
      });
  }, [status, phase, timing?.endsAt, countdown.expired, busy, revealKey, presentationId, store]);

  return {
    loading,
    loadError,
    busy,
    connected,
    countdown,
    start,
    openLobby: openLobbyNow,
    goto,
    next,
    previous,
    closeVoting: close,
    reopenVoting: reopen,
    reveal,
    end,
  };
}
