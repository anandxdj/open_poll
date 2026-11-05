import axios from "axios";
import type { Socket } from "socket.io-client";

import { getApiErrorMessage, getApiErrorStatus } from "@/lib/api-error";
import { LIVE_SOCKET_EVENTS, type AnswerRequest, type AnswerResult, type AnswerSubmitAck } from "../types";
import { answerFailureVerdict, getApiErrorCode, isRetryableAnswerFailure } from "./errors";

/** How long `answer:submit` waits for its ack before the answer goes over REST instead. */
export const ANSWER_ACK_TIMEOUT_MS = 3_000;

/**
 * Sends answers over the deck's socket. The live socket hook registers one
 * only once `live:join` acked as this participant, and drops it on every
 * disconnect — so after a reconnect nothing is sent over the socket before
 * the join ack (the server would answer `NOT_JOINED`).
 */
export interface AnswerSocketTransport {
  /** Rejects when the socket is not connected or no ack arrives in time. */
  submit(body: AnswerRequest): Promise<AnswerSubmitAck>;
}

/**
 * `answer:submit` on a joined socket, with an ack timeout. A disconnected
 * socket rejects at once instead of letting socket.io buffer the packet: a
 * buffered emit is flushed on reconnect *before* the new `live:join`.
 */
export function createSocketAnswerTransport(
  socket: Socket,
  presentationId: string,
  timeoutMs: number = ANSWER_ACK_TIMEOUT_MS
): AnswerSocketTransport {
  return {
    submit: async (body) => {
      if (!socket.connected) throw new Error("socket disconnected");
      return (await socket
        .timeout(timeoutMs)
        .emitWithAck(LIVE_SOCKET_EVENTS.answerSubmit, { ...body, presentationId })) as AnswerSubmitAck;
    },
  };
}

export type AnswerChannel = "socket" | "rest";

/** What one delivery of an answer came to. */
export type AnswerDelivery =
  | { kind: "accepted"; result: AnswerResult; channel: AnswerChannel }
  /** The server's final word (REST error or socket ack), never retried. */
  | { kind: "refused"; status?: number; code?: string; message?: string }
  /** Nothing definite came back (offline, timeouts, 5xx, 429): send it again later with the same id. */
  | { kind: "unreachable" };

export interface DeliverAnswerOptions {
  /** The joined socket, or null (not joined, reconnecting, host surface). */
  transport: AnswerSocketTransport | null;
  /** Waits before each REST re-send after a transient failure (none for queued answers: their backoff covers it). */
  restRetryDelaysMs: readonly number[];
  /** `navigator.onLine`: false means certainly offline, so nothing is sent. */
  isOnline: () => boolean;
  /** `POST /:id/answer`. */
  post: (presentationId: string, body: AnswerRequest) => Promise<AnswerResult>;
  wait?: (ms: number) => Promise<void>;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** The request ran into its own timeout (a dead connection that still looks online). */
const timedOut = (err: unknown) => axios.isAxiosError(err) && (err.code === "ECONNABORTED" || err.code === "ETIMEDOUT");

/**
 * The one way an answer leaves the client: `answer:submit` over the joined
 * socket with a 3 s ack timeout, then `POST /:id/answer` (re-sent after
 * transient failures), always with the body's `clientAnswerId` — a second send
 * of an answer that did land is answered with `replay: true`, never counted
 * twice. A socket ack that is final (`TIME_UP`, `ALREADY_ANSWERED`, …) ends it;
 * no ack, `NOT_JOINED`, 429 or 5xx fall through to REST. A REST request that
 * timed out is not re-sent here (it already waited its full timeout): the
 * caller queues the answer. Never throws.
 */
export async function deliverAnswer(
  presentationId: string,
  body: AnswerRequest,
  options: DeliverAnswerOptions
): Promise<AnswerDelivery> {
  if (!options.isOnline()) return { kind: "unreachable" };
  const wait = options.wait ?? sleep;

  if (options.transport) {
    const ack = await options.transport.submit(body).catch(() => null);
    if (ack?.success) return { kind: "accepted", result: ack.data, channel: "socket" };
    if (ack && answerFailureVerdict(ack.status, ack.code) === "final") {
      return { kind: "refused", status: ack.status, code: ack.code, message: ack.message };
    }
  }

  for (let attempt = 0; ; attempt++) {
    try {
      return { kind: "accepted", result: await options.post(presentationId, body), channel: "rest" };
    } catch (err: unknown) {
      if (!isRetryableAnswerFailure(err)) {
        return {
          kind: "refused",
          status: getApiErrorStatus(err),
          code: getApiErrorCode(err),
          message: getApiErrorMessage(err),
        };
      }
      if (timedOut(err) || attempt >= options.restRetryDelaysMs.length || !options.isOnline()) {
        return { kind: "unreachable" };
      }
      await wait(options.restRetryDelaysMs[attempt]);
    }
  }
}
