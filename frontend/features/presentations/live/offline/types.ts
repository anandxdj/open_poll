import type { AnswerRequest } from "../../types";

/**
 * An answer the live path could not deliver (offline, server unreachable,
 * rate limited), kept on the device until the server takes it or refuses it
 * for good. Keyed by `clientAnswerId`: every send of it reuses the id, so the
 * server counts it once however often it goes out.
 */
export interface QueuedAnswer {
  clientAnswerId: string;
  presentationId: string;
  sessionId: string | null;
  participantId: string;
  slideId: string | null;
  slideIndex: number;
  /**
   * The answer body as first sent: participant token, slide ticket, the
   * answer itself and `clientAnswerId`. Sent again with `offline: true`.
   */
  body: AnswerRequest;
  /** Client ms when it was queued; entries older than a day are dropped unsent. */
  queuedAt: number;
  /** Failed sends since it was queued. */
  attempts: number;
  /** Client ms of the next scheduled send (a reconnect sends earlier). */
  nextAttemptAt: number;
}

/** Where queued answers live: IndexedDB in browsers (survives a reload), memory otherwise. */
export interface AnswerQueueStorage {
  /** Adds or replaces the entry with this `clientAnswerId`. */
  put(entry: QueuedAnswer): Promise<void>;
  remove(clientAnswerId: string): Promise<void>;
  /** Every queued answer of one deck (any session or participant). */
  list(presentationId: string): Promise<QueuedAnswer[]>;
}
