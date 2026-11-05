"use client";

import { createContext, createElement, useContext, type ReactNode } from "react";
import { createStore, useStore, type StoreApi } from "zustand";

import { getApiErrorStatus } from "@/lib/api-error";
import { getParticipantLiveState, getParticipantState, submitAnswer as postAnswer } from "../api/participant";
import type { AnswerPayload, AnswerRequest } from "../types";
import { deliverAnswer, type AnswerDelivery, type AnswerSocketTransport } from "./answerDelivery";
import { newClientAnswerId } from "./answerId";
import { getApiErrorCode, LIVE_ERROR_CODES } from "./errors";
import {
  createAnswerSync,
  defaultAnswerQueueStorage,
  queueRetryDelayMs,
  type AnswerQueueStorage,
  type QueuedAnswer,
  type SettledDelivery,
} from "./offline";
import {
  createInitialLiveState,
  liveReducer,
  type LiveAction,
  type LiveRole,
  type LiveState,
  type ParticipantLostReason,
} from "./reducer";

export type SubmitAnswerResult =
  /**
   * The answer counted. `replay`: the server already had this exact attempt
   * (a retry whose first send landed) and counted nothing twice.
   * `clientAnswerId` identifies the attempt.
   */
  | { status: "accepted"; replay: boolean; clientAnswerId: string }
  /** The server already had a different answer for this slide (409 `ALREADY_ANSWERED`) — counts as submitted. */
  | { status: "duplicate" }
  /**
   * The server could not be reached (offline, timeouts, 5xx, rate limited):
   * the answer is saved in the offline queue and sent when the connection is
   * back (`pendingAnswers` shows "Saved — will sync" until then).
   */
  | { status: "queued"; clientAnswerId: string }
  | { status: "skipped" }
  /**
   * `message` is the API's error text when it sent one; the caller supplies the
   * fallback. `code` is the live error code (`NOT_ACCEPTING`, `TIME_UP`,
   * `RATE_LIMITED`, `PARTICIPANT_STALE`, …) when sent.
   */
  | { status: "error"; message?: string; code?: string };

export interface LiveStore extends LiveState {
  dispatch: (action: LiveAction) => void;
  /**
   * Participant: submit an answer for the slide on screen, then refresh `me`.
   * The one place answers leave the client, for every slide type. Each call is
   * one **attempt** with its own `clientAnswerId`, sent with the slide's
   * `slideTicket`: `answer:submit` over the joined socket (3 s ack timeout) →
   * `POST /:id/answer` (re-sent after transient failures) → the offline queue
   * (IndexedDB), which keeps sending it with backoff and on every reconnect.
   * Every send reuses the id, so the server counts the answer once. After
   * `NOT_ACCEPTING` or `TIME_UP` the participant's state is re-read — the
   * window closed while the phone was not looking.
   */
  submitAnswer: (payload: AnswerPayload) => Promise<SubmitAnswerResult>;
  /**
   * Participant: starts sending the offline queue (now, with backoff, and on
   * `online` / tab visible / socket rejoined) and restores "saved" for
   * queued answers after a reload. Returns the stop function (effect cleanup).
   */
  startAnswerSync: () => () => void;
  /** Sends the queued answers now (`force`, the default: ignore their backoff). Resolves when the queue is quiet. */
  flushAnswerQueue: (force?: boolean) => Promise<void>;
  /**
   * The live socket hook registers the socket here once `live:join` acked as
   * this participant, and clears it on disconnect; registering flushes the
   * queue (the connection is back).
   */
  setAnswerTransport: (transport: AnswerSocketTransport | null) => void;
  /** Participant: refresh own score/rank/last answer. Failures keep the old value. */
  loadMe: () => Promise<void>;
  /**
   * Replaces the state with a REST snapshot (`load` resolves to the action
   * that applies it, or null to skip). Envelopes (and host command responses)
   * that arrive while the request is in flight are replayed on top, so a
   * snapshot older than the latest event never wins. When resyncs overlap, only the latest one applies.
   * Resolves to whether the snapshot was applied; rejects with `load`'s error.
   */
  resync: (load: () => Promise<LiveAction | null>) => Promise<boolean>;
  /** Participant: resync from `GET /:id/live-state`. Credential failures land in `lost`. */
  loadLiveState: () => Promise<boolean>;
}

export type LiveStoreApi = StoreApi<LiveStore>;

export interface LiveStoreOptions {
  /** Waits before each REST re-send of a transiently failed answer (default 400 ms, then 1.2 s), before it is queued. */
  answerRetryDelaysMs?: readonly number[];
  /** Where the offline queue lives (default: IndexedDB, else memory). */
  answerQueue?: AnswerQueueStorage;
  /** Backoff of queued answers (default `QUEUE_RETRY_DELAYS_MS`: 1 s … 30 s). */
  queueRetryDelaysMs?: readonly number[];
  /** Whether the device may be online (default `navigator.onLine`; false sends nothing and queues at once). */
  isOnline?: () => boolean;
}

const DEFAULT_ANSWER_RETRY_DELAYS_MS = [400, 1200] as const;

const browserOnline = () => typeof navigator === "undefined" || navigator.onLine !== false;

/** The reason the credentials stopped working, from a failed call's status and live code, if it is one. */
export function lostReasonFor(status: number | undefined, code: string | undefined): ParticipantLostReason | null {
  if (code === LIVE_ERROR_CODES.participantKicked) return "kicked";
  if (code === LIVE_ERROR_CODES.participantStale) return "stale";
  if (status === 404 || status === 401) return "missing";
  return null;
}

/** Maps a participant API failure to the reason the credentials stopped working, if it is one. */
export function participantLostReason(err: unknown): ParticipantLostReason | null {
  return lostReasonFor(getApiErrorStatus(err), getApiErrorCode(err));
}

/** 409 `ALREADY_ANSWERED` (or a bare 409): the server has an answer from this participant — counts as answered. */
const isAlreadyAnswered = (status: number | undefined, code: string | undefined) =>
  code === LIVE_ERROR_CODES.alreadyAnswered || (!code && status === 409);

/**
 * Actions replayed over a REST snapshot that loaded while they happened: the
 * snapshot may have been read before them (an answer accepted after the
 * `live-state` read started must stay answered).
 */
const REPLAYED_OVER_SNAPSHOT = new Set<LiveAction["type"]>([
  "live/event",
  "host/command",
  "participant/submitted",
  "participant/answer-queued",
  "participant/answer-synced",
  "participant/answer-refused",
]);

/**
 * One store per mounted live surface (host console, participant shell), so a
 * client-side navigation never shows another session's state. State changes
 * only through `dispatch` → `liveReducer`.
 */
export function createLiveStore(
  role: LiveRole,
  init: Partial<LiveState> = {},
  options: LiveStoreOptions = {}
): LiveStoreApi {
  const retryDelays = options.answerRetryDelaysMs ?? DEFAULT_ANSWER_RETRY_DELAYS_MS;
  const isOnline = options.isOnline ?? browserOnline;
  // Event actions recorded while a resync request is in flight, per request.
  const recorders = new Set<LiveAction[]>();
  let resyncToken = 0;
  // The joined socket (participant), set by the live socket hook after the `live:join` ack.
  let transport: AnswerSocketTransport | null = null;

  return createStore<LiveStore>()((set, get) => {
    const apply = (action: LiveAction) => set((state) => liveReducer(state, action));

    const deliver = (presentationId: string, body: AnswerRequest, restRetryDelaysMs: readonly number[]) =>
      deliverAnswer(presentationId, body, { transport, restRetryDelaysMs, isOnline, post: postAnswer });

    /** A queued answer of the identity and session on screen (others are leftovers: sent, but silent). */
    const ownsEntry = (entry: QueuedAnswer) => {
      const { self, sessionId } = get();
      return Boolean(self) && entry.participantId === self?.participantId && (entry.sessionId ?? null) === sessionId;
    };

    /**
     * A final refusal of a live answer. `PARTICIPANT_KICKED` / `_STALE` / 401 /
     * 404 mean the credentials are gone; `ALREADY_ANSWERED` counts as answered.
     */
    const refusedLive = (delivery: Extract<AnswerDelivery, { kind: "refused" }>, slideIndex: number): SubmitAnswerResult => {
      const { dispatch, loadMe, loadLiveState } = get();
      const { status, code, message } = delivery;
      const reason = lostReasonFor(status, code);
      if (reason) {
        dispatch({ type: "participant/lost", reason });
        return { status: "error", message, code };
      }
      if (isAlreadyAnswered(status, code)) {
        dispatch({ type: "participant/submitted", slideIndex });
        void loadMe();
        return { status: "duplicate" };
      }
      // The window closed (or was left) without this phone hearing about it.
      if (code === LIVE_ERROR_CODES.notAccepting || code === LIVE_ERROR_CODES.timeUp) void loadLiveState();
      return { status: "error", message, code };
    };

    /** A queued answer left the queue: accepted, already there, or refused for good. */
    const settleQueued = (entry: QueuedAnswer, outcome: SettledDelivery) => {
      if (!ownsEntry(entry)) return;
      const { dispatch, loadMe, loadLiveState } = get();
      const ref = { slideId: entry.slideId, slideIndex: entry.slideIndex, clientAnswerId: entry.clientAnswerId };
      if (outcome.kind === "accepted" || isAlreadyAnswered(outcome.status, outcome.code)) {
        dispatch({ type: "participant/answer-synced", ...ref });
        void loadMe();
        return;
      }
      dispatch({ type: "participant/answer-refused", ...ref, code: outcome.code ?? null, message: outcome.message ?? null });
      const reason = lostReasonFor(outcome.status, outcome.code);
      if (reason) dispatch({ type: "participant/lost", reason });
      else if (outcome.code === LIVE_ERROR_CODES.notAccepting || outcome.code === LIVE_ERROR_CODES.timeUp) void loadLiveState();
    };

    const sync = createAnswerSync({
      storage: options.answerQueue ?? defaultAnswerQueueStorage(),
      presentationId: () => get().presentationId,
      // Same id, flagged as held offline; the queue's backoff replaces the quick REST re-sends.
      send: (entry) => deliver(entry.presentationId, { ...entry.body, offline: true }, []),
      onPending: (entry) => {
        if (!ownsEntry(entry)) return;
        get().dispatch({
          type: "participant/answer-queued",
          slideId: entry.slideId,
          slideIndex: entry.slideIndex,
          clientAnswerId: entry.clientAnswerId,
        });
      },
      onSettled: settleQueued,
      isOnline,
      retryDelaysMs: options.queueRetryDelaysMs,
    });

    return {
      ...createInitialLiveState(role, init),

      dispatch: (action) => {
        // What happens while a snapshot loads is replayed on top of it: envelopes, the host's
        // own command responses (a `goto` answered while an older read is in flight), and the
        // participant's answers settling.
        if (REPLAYED_OVER_SNAPSHOT.has(action.type)) {
          for (const buffer of recorders) buffer.push(action);
        }
        apply(action);
      },

      startAnswerSync: () => {
        sync.start();
        if (typeof window === "undefined") return () => sync.stop();
        // The connection is (probably) back: send what is queued without waiting for its backoff.
        const onOnline = () => void sync.flush(true);
        const onVisible = () => {
          if (document.visibilityState === "visible") void sync.flush(true);
        };
        window.addEventListener("online", onOnline);
        document.addEventListener("visibilitychange", onVisible);
        return () => {
          window.removeEventListener("online", onOnline);
          document.removeEventListener("visibilitychange", onVisible);
          sync.stop();
        };
      },

      flushAnswerQueue: (force = true) => sync.flush(force),

      setAnswerTransport: (next) => {
        transport = next;
        if (next) void sync.flush(true);
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
        const { presentationId, sessionId, self, slide, slideId, slideTicket, dispatch, loadMe } = get();
        if (!presentationId || !self || !slide) return { status: "skipped" };
        const slideIndex = slide.slideIndex;
        // One attempt = one id, however many times (and over whichever channel) it is sent.
        const clientAnswerId = newClientAnswerId();
        const body: AnswerRequest = {
          participantId: self.participantId,
          participantToken: self.token,
          slideIndex,
          ...(sessionId ? { sessionId } : {}),
          ...(slideId ? { slideId } : {}),
          ...(slideTicket ? { slideTicket } : {}),
          clientAnswerId,
          ...payload,
        };

        const delivery = await deliver(presentationId, body, retryDelays);
        if (delivery.kind === "accepted") {
          dispatch({ type: "participant/submitted", slideIndex });
          // Scored slides show green/red on the participant's own pick right
          // away; the correct answer itself stays hidden until reveal.
          void loadMe();
          return { status: "accepted", replay: delivery.result.replay, clientAnswerId };
        }
        if (delivery.kind === "refused") return refusedLive(delivery, slideIndex);

        // Unreachable: keep it on the device and send it when the connection is back.
        const queuedAt = Date.now();
        const entry: QueuedAnswer = {
          clientAnswerId,
          presentationId,
          sessionId,
          participantId: self.participantId,
          slideId,
          slideIndex,
          body,
          queuedAt,
          attempts: 0,
          nextAttemptAt: queuedAt + queueRetryDelayMs(1, options.queueRetryDelaysMs),
        };
        dispatch({ type: "participant/answer-queued", slideId, slideIndex, clientAnswerId });
        await sync.enqueue(entry);
        return { status: "queued", clientAnswerId };
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
