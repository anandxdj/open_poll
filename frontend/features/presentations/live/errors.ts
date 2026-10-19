import axios from "axios";

/**
 * Machine-readable error codes of the live session engine
 * (`LIVE_ERROR_CODES` in `backend/src/modules/presentations/live/contract.ts`),
 * sent as `{ success: false, message, code }`.
 */
export const LIVE_ERROR_CODES = {
  /** 403 on join: the session reached its audience cap. */
  sessionFull: "SESSION_FULL",
  /** 409 on start: a session is already presenting. */
  sessionAlreadyLive: "SESSION_ALREADY_LIVE",
  /** 409: another host command changed the session concurrently; retry. */
  sessionBusy: "SESSION_BUSY",
  /** 400 on host commands that need a live session. */
  noLiveSession: "NO_LIVE_SESSION",
  /** 403 on participant calls: the host removed this participant. */
  participantKicked: "PARTICIPANT_KICKED",
  /** 409 on answers: the participant belongs to another (ended) session; rejoin. */
  participantStale: "PARTICIPANT_STALE",
  /** 400 on answers: the slide is closed, revealed, left or its session ended. */
  notAccepting: "NOT_ACCEPTING",
  /** 400 on answers: the timer ran out (plus grace) before the answer arrived. */
  timeUp: "TIME_UP",
  /** 409 on answers: already answered this slide and this is not a replay of that answer. */
  alreadyAnswered: "ALREADY_ANSWERED",
  /** 429 on answers: more than the per-participant budget of attempts; retry later. */
  rateLimited: "RATE_LIMITED",
  /** 403 on a socket answer: the socket has not joined the deck as this participant (socket only). */
  notJoined: "NOT_JOINED",
} as const;

export type LiveErrorCode = (typeof LIVE_ERROR_CODES)[keyof typeof LIVE_ERROR_CODES];

/**
 * An answer attempt worth repeating with the same `clientAnswerId`: no response
 * at all (network), a 5xx, or the per-participant rate limit. Everything else
 * is the server's final word.
 */
export function isRetryableAnswerFailure(err: unknown): boolean {
  if (!axios.isAxiosError(err)) return false;
  if (!err.response) return true;
  return err.response.status >= 500 || err.response.status === 429;
}

/** The API's `code` for a failed request, if it sent one. */
export function getApiErrorCode(err: unknown): string | undefined {
  if (!axios.isAxiosError<{ code?: unknown }>(err)) return undefined;
  const code = err.response?.data?.code;
  return typeof code === "string" ? code : undefined;
}
