import { getApiErrorMessage } from "@/lib/api-error";
import { getApiErrorCode, LIVE_ERROR_CODES } from "../../live/errors";
import type { HostCommandResponse } from "../../types";

export type HostCommandOutcome =
  | { ok: true; response: HostCommandResponse }
  | {
      ok: false;
      /** The API's live error code, if it sent one. */
      code: string | undefined;
      /** The API's message, if it sent one. */
      message: string | undefined;
      /**
       * The console is out of date: a session is already live (`SESSION_ALREADY_LIVE`)
       * or none is (`NO_LIVE_SESSION`). It should re-read the host state.
       */
      stale: boolean;
    };

/** Wait before retrying a command that hit `SESSION_BUSY`. */
export const BUSY_RETRY_MS = 300;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Sends one host command. `SESSION_BUSY` (a concurrent command changed the
 * session) is retried once after a short wait; every other failure is reported
 * as an outcome rather than thrown.
 */
export async function sendHostCommand(
  send: () => Promise<HostCommandResponse>,
  retryDelayMs = BUSY_RETRY_MS
): Promise<HostCommandOutcome> {
  try {
    try {
      return { ok: true, response: await send() };
    } catch (err: unknown) {
      if (getApiErrorCode(err) !== LIVE_ERROR_CODES.sessionBusy) throw err;
      await sleep(retryDelayMs);
      return { ok: true, response: await send() };
    }
  } catch (err: unknown) {
    const code = getApiErrorCode(err);
    return {
      ok: false,
      code,
      message: getApiErrorMessage(err),
      stale: code === LIVE_ERROR_CODES.sessionAlreadyLive || code === LIVE_ERROR_CODES.noLiveSession,
    };
  }
}
