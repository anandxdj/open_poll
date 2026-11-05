import type { AnswerDelivery } from "../answerDelivery";
import type { AnswerQueueStorage, QueuedAnswer } from "./types";

/** Waits between failed sends of a queued answer (then the last one, repeated), ±20% jitter. */
export const QUEUE_RETRY_DELAYS_MS = [1_000, 2_000, 4_000, 8_000, 15_000, 30_000] as const;

/** Queued answers older than this are dropped unsent: their session is long over. */
export const QUEUE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/** While the device reports itself offline nothing is sent; look again this often (the `online` event usually comes first). */
const OFFLINE_RECHECK_MS = 5_000;

/** Delay before the next send after `attempts` failed ones (≥ 1): the backoff step, ±20%. */
export function queueRetryDelayMs(
  attempts: number,
  delays: readonly number[] = QUEUE_RETRY_DELAYS_MS,
  random: () => number = Math.random
): number {
  const step = delays[Math.min(Math.max(attempts, 1), delays.length) - 1] ?? 1_000;
  return Math.round(step * (0.8 + 0.4 * random()));
}

/** A queued answer's end: the server took it (also as a replay) or refused it for good. */
export type SettledDelivery = Exclude<AnswerDelivery, { kind: "unreachable" }>;

export interface AnswerSyncOptions {
  storage: AnswerQueueStorage;
  /** The deck whose queued answers this surface sends; null while it has none. */
  presentationId: () => string | null;
  /** Sends one queued answer (same `clientAnswerId`, `offline: true`). Must not throw. */
  send: (entry: QueuedAnswer) => Promise<AnswerDelivery>;
  /** Every entry a pass looks at, before sending it: how "saved" comes back after a reload. */
  onPending?: (entry: QueuedAnswer) => void;
  /** The entry has left the queue. */
  onSettled: (entry: QueuedAnswer, outcome: SettledDelivery) => void;
  isOnline?: () => boolean;
  retryDelaysMs?: readonly number[];
  maxAgeMs?: number;
  now?: () => number;
  random?: () => number;
}

export interface AnswerSync {
  /** Stores an answer the live path could not deliver; it is sent at `nextAttemptAt` (or on the next reconnect). */
  enqueue(entry: QueuedAnswer): Promise<void>;
  /**
   * Sends every queued answer that is due — or all of them with `force` (the
   * connection just came back). One pass at a time: a flush asked for during
   * a pass runs right after it. Resolves when the queue is quiet again.
   */
  flush(force?: boolean): Promise<void>;
  /** Starts sending: a forced flush now, then the retry timer. */
  start(): void;
  /** Stops sending and the timer. Queued answers stay stored. */
  stop(): void;
}

/**
 * The offline answer queue's sender: retries every queued answer with
 * backoff until the server accepts it (`replay: true` when an earlier send
 * had landed) or refuses it for good, then removes it and reports the
 * outcome. Sends nothing while stopped or while the device is offline.
 */
export function createAnswerSync(options: AnswerSyncOptions): AnswerSync {
  const now = options.now ?? Date.now;
  const isOnline = options.isOnline ?? (() => true);
  const maxAgeMs = options.maxAgeMs ?? QUEUE_MAX_AGE_MS;
  const delays = options.retryDelaysMs ?? QUEUE_RETRY_DELAYS_MS;
  const { storage } = options;

  let active = false;
  let running: Promise<void> | null = null;
  let queued: { force: boolean } | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const clearTimer = () => {
    if (timer) clearTimeout(timer);
    timer = null;
  };

  const scheduleAt = (at: number | null) => {
    clearTimer();
    if (!active || at === null) return;
    timer = setTimeout(() => {
      timer = null;
      void flush(false);
    }, Math.max(0, at - now()));
  };

  /** One look at the deck's queue. Resolves to when the next send is due (null: nothing queued). */
  const pass = async (force: boolean): Promise<number | null> => {
    const presentationId = options.presentationId();
    if (!presentationId) return null;
    const entries = (await storage.list(presentationId).catch(() => [] as QueuedAnswer[])).sort(
      (a, b) => a.queuedAt - b.queuedAt
    );
    let nextAt: number | null = null;
    const later = (at: number) => (nextAt = nextAt === null ? at : Math.min(nextAt, at));

    for (const entry of entries) {
      if (!active) break;
      if (now() - entry.queuedAt > maxAgeMs) {
        await storage.remove(entry.clientAnswerId).catch(() => {});
        continue;
      }
      options.onPending?.(entry);
      if (!isOnline()) {
        later(now() + OFFLINE_RECHECK_MS);
        continue;
      }
      if (!force && entry.nextAttemptAt > now()) {
        later(entry.nextAttemptAt);
        continue;
      }
      const outcome = await options.send(entry).catch((): AnswerDelivery => ({ kind: "unreachable" }));
      if (outcome.kind === "unreachable") {
        const attempts = entry.attempts + 1;
        const retry: QueuedAnswer = { ...entry, attempts, nextAttemptAt: now() + queueRetryDelayMs(attempts, delays, options.random) };
        await storage.put(retry).catch(() => {});
        later(retry.nextAttemptAt);
        continue;
      }
      await storage.remove(entry.clientAnswerId).catch(() => {});
      options.onSettled(entry, outcome);
    }
    return nextAt;
  };

  const drain = async (force: boolean) => {
    let nextAt: number | null = null;
    try {
      nextAt = await pass(force);
      while (queued && active) {
        const next = queued;
        queued = null;
        nextAt = await pass(next.force);
      }
    } finally {
      running = null;
      queued = null;
      scheduleAt(nextAt);
    }
  };

  const flush = (force = false): Promise<void> => {
    if (!active) return Promise.resolve();
    if (running) {
      queued = { force: (queued?.force ?? false) || force };
      return running;
    }
    running = drain(force);
    return running;
  };

  return {
    enqueue: async (entry) => {
      await storage.put(entry).catch(() => {});
      // Not due yet: this pass only (re)arms the timer for it.
      if (active) void flush(false);
    },
    flush,
    start: () => {
      active = true;
      void flush(true);
    },
    stop: () => {
      active = false;
      clearTimer();
    },
  };
}
