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
} as const;

export type LiveErrorCode = (typeof LIVE_ERROR_CODES)[keyof typeof LIVE_ERROR_CODES];

/** The API's `code` for a failed request, if it sent one. */
export function getApiErrorCode(err: unknown): string | undefined {
  if (!axios.isAxiosError<{ code?: unknown }>(err)) return undefined;
  const code = err.response?.data?.code;
  return typeof code === "string" ? code : undefined;
}
