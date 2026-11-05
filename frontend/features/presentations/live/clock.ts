/**
 * Server clock alignment for live countdowns.
 *
 * Deadlines (`endsAt`) are server times. A client turns them into "seconds
 * left" with an offset `serverClock − clientClock`, measured from a `serverNow`
 * at the moment the response or event carrying it **arrived**. Every event or
 * REST response that brings a `serverNow` yields a fresh sample; the offset is
 * never derived from a stale `serverNow` read against the current client time
 * (the old bug: a participant who waited in the lobby got a page-load
 * `serverNow` paired with "now", and every countdown ran long by the wait).
 */

/** `serverNow − receivedAt` in ms, or null when `serverNow` is missing or unparsable. */
export function clockOffsetFrom(serverNow: string | null | undefined, receivedAtMs: number | undefined): number | null {
  if (!serverNow || receivedAtMs === undefined) return null;
  const serverMs = Date.parse(serverNow);
  return Number.isNaN(serverMs) ? null : serverMs - receivedAtMs;
}

export interface CountdownInput {
  /** Deadline on the server clock; null = untimed, or paused (then `pausedRemainingMs` is set). */
  endsAt: string | null;
  /** Offset measured when the deadline arrived (`clockOffsetFrom`). */
  clockOffsetMs: number;
  /** The host paused the timer (W2-A): the time left, frozen. */
  pausedRemainingMs?: number | null;
  /** The timer's whole budget (time limit plus extensions, ms), when the server sent it. */
  durationMs?: number | null;
}

export interface CountdownValue {
  /** False for untimed windows (no deadline): no timer, never expires. */
  timed: boolean;
  /** The host paused the timer: `msLeft` is frozen and the window never expires meanwhile. */
  paused: boolean;
  msLeft: number;
  secondsLeft: number;
  /** 1 → full time left, 0 → expired (1 while untimed). */
  progress: number;
  expired: boolean;
}

const UNTIMED: CountdownValue = { timed: false, paused: false, msLeft: 0, secondsLeft: 0, progress: 1, expired: false };

/**
 * Time left on an answer window at client time `clientNowMs`. The window's
 * budget — `durationMs` when the server sent it (time limit plus extensions),
 * else `totalSeconds` (the slide's time limit) — scales `progress` and caps
 * `msLeft`, so a client clock far behind the server never shows more than the
 * budget. A paused window reports its frozen time left and never expires.
 */
export function countdownAt(
  timing: CountdownInput | null | undefined,
  clientNowMs: number,
  totalSeconds: number
): CountdownValue {
  // An extended timer's budget is larger than the slide's own time limit.
  const budgetMs =
    typeof timing?.durationMs === "number" && timing.durationMs > 0
      ? timing.durationMs
      : Math.max(0, totalSeconds) * 1000;
  if (typeof timing?.pausedRemainingMs === "number") {
    const frozen = Math.max(0, timing.pausedRemainingMs);
    const msLeft = budgetMs > 0 ? Math.min(frozen, budgetMs) : frozen;
    return {
      timed: true,
      paused: true,
      msLeft,
      secondsLeft: Math.ceil(msLeft / 1000),
      progress: budgetMs > 0 ? Math.min(1, msLeft / budgetMs) : 0,
      expired: false,
    };
  }
  if (!timing?.endsAt) return UNTIMED;
  const endMs = Date.parse(timing.endsAt);
  if (Number.isNaN(endMs)) return UNTIMED;
  let msLeft: number;
  if (Number.isFinite(clientNowMs)) {
    const serverNowMs = clientNowMs + timing.clockOffsetMs;
    msLeft = Math.max(0, endMs - serverNowMs);
    if (budgetMs > 0) msLeft = Math.min(msLeft, budgetMs);
  } else {
    // No client clock yet (server render): show the full budget.
    msLeft = budgetMs;
  }
  return {
    timed: true,
    paused: false,
    msLeft,
    secondsLeft: Math.ceil(msLeft / 1000),
    progress: budgetMs > 0 ? Math.min(1, msLeft / budgetMs) : 0,
    expired: msLeft <= 0,
  };
}
