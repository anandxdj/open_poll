import { PresentationSessionModel, type IPresentationSession, type SessionEndReason } from '../models/session.model';

/**
 * Session activity: when a live session was last used, and whether it has been
 * idle long enough for the idle-session job (`idleSessions.ts`) to end it.
 *
 * Activity is a host command, a participant joining or an accepted answer. It
 * is kept on the session as `lastActivityAt`:
 * - host commands set it on the session document they save anyway;
 * - joins and answers never write the session document, so they go through
 *   `noteSessionActivity`, which writes at most once per session every
 *   `ACTIVITY_WRITE_INTERVAL_MS` on each instance (never a write per answer).
 */

/** How often one instance records joins and answers of the same session. */
export const ACTIVITY_WRITE_INTERVAL_MS = 5 * 60 * 1000;
/** Above this many tracked sessions, entries older than the interval are dropped. */
const MAX_TRACKED_SESSIONS = 1000;

const HOUR_MS = 3600 * 1000;

/**
 * Per-session write throttle: `shouldWrite` is true at most once per
 * `intervalMs` for the same session.
 */
export function createActivityThrottle(intervalMs = ACTIVITY_WRITE_INTERVAL_MS, maxTracked = MAX_TRACKED_SESSIONS) {
  const lastWrite = new Map<string, number>();
  return {
    shouldWrite(sessionId: string, nowMs: number): boolean {
      const previous = lastWrite.get(sessionId);
      if (previous !== undefined && nowMs - previous < intervalMs) return false;
      lastWrite.set(sessionId, nowMs);
      if (lastWrite.size > maxTracked) {
        for (const [id, at] of lastWrite) if (nowMs - at >= intervalMs) lastWrite.delete(id);
      }
      return true;
    },
    size: () => lastWrite.size,
    clear: () => lastWrite.clear(),
  };
}

const throttle = createActivityThrottle();

/**
 * Records a join or an answer on a live session. Fire-and-forget: never throws
 * and never delays the caller. Returns the write (for tests), or null when the
 * throttle skipped it. `$max`, so a late write never moves the time back.
 */
export const noteSessionActivity = (sessionId: string, now = new Date()): Promise<void> | null => {
  if (!throttle.shouldWrite(sessionId, now.getTime())) return null;
  return PresentationSessionModel.updateOne({ _id: sessionId, isLive: true }, { $max: { lastActivityAt: now } }).then(
    () => undefined,
    (error: unknown) => console.error('[Presentation] Failed to record session activity:', (error as Error)?.message)
  );
};

/** Forgets which sessions were written recently, so the next activity writes at once (tests). */
export const resetActivityThrottle = () => throttle.clear();

// ---------------------------------------------------------------------------
// Idle decision
// ---------------------------------------------------------------------------

export interface IdleThresholds {
  /** A lobby ends after this many hours without activity. */
  lobbyHours: number;
  /** A session being presented (`active`) ends after this many hours without activity. */
  liveHours: number;
}

export type IdleEndReason = Extract<SessionEndReason, 'lobby_idle' | 'live_idle'>;

type ActivityFields = Pick<IPresentationSession, 'lastActivityAt' | 'updatedAt' | 'startedAt'>;

/**
 * When the session was last used. Sessions opened before `lastActivityAt`
 * existed (or by an older instance during a deploy) fall back to their last
 * save, which every host command makes.
 */
export const lastActivityOf = (session: Partial<ActivityFields>): Date | null =>
  session.lastActivityAt ?? session.updatedAt ?? session.startedAt ?? null;

/** How long a session in `status` may stay idle, in ms; null for statuses that never idle out. */
export const idleLimitMs = (status: string, thresholds: IdleThresholds): number | null => {
  if (status === 'lobby') return thresholds.lobbyHours * HOUR_MS;
  if (status === 'active') return thresholds.liveHours * HOUR_MS;
  return null;
};

/**
 * Why the idle-session job should end this session now, or null to leave it:
 * a live lobby idle for `lobbyHours` (`lobby_idle`), a live presented session
 * idle for `liveHours` (`live_idle`). Ended sessions, and sessions with no
 * known activity time, are left alone.
 */
export const idleEndReason = (
  session: Pick<IPresentationSession, 'isLive' | 'status'> & Partial<ActivityFields>,
  now: Date,
  thresholds: IdleThresholds
): IdleEndReason | null => {
  if (!session.isLive) return null;
  const limitMs = idleLimitMs(session.status, thresholds);
  const last = lastActivityOf(session);
  if (limitMs === null || !last) return null;
  if (now.getTime() - last.getTime() < limitMs) return null;
  return session.status === 'lobby' ? 'lobby_idle' : 'live_idle';
};
