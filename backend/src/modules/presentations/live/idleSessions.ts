import { audit } from '../../../common/audit/audit';
import { env } from '../../../common/config/env';
import { registerJob, type JobContext } from '../../../common/jobs/scheduler';
import { ApiError } from '../../../common/utils/ApiError';
import { WorkspaceModel } from '../../workspaces/workspace.model';
import { PresentationSessionModel, type IPresentationSession } from '../models/session.model';
import { idleLimitMs, lastActivityOf, type IdleEndReason, type IdleThresholds } from './activity';
import { LIVE_ERROR_CODES } from './contract';
import { endIdleSession } from './session.service';

/**
 * The idle-session job: a lobby with no activity for SESSION_IDLE_LOBBY_HOURS
 * (default 6) and a presented session with none for SESSION_IDLE_LIVE_HOURS
 * (default 12) are ended the way the host's End Session ends them (final
 * leaderboard, retention, Redis cleanup, `session:ended` to connected
 * sockets), then audited as `session.auto_ended`. Activity: `activity.ts`.
 *
 * Runs every 10 minutes on one instance at a time (scheduler tick and run
 * locks). Each session is read again before it ends, so one a host or a
 * participant used meanwhile stays live.
 */

export const SESSION_IDLE_JOB = 'presentations-idle-session-end';
export const SESSION_IDLE_JOB_EVERY_MS = 10 * 60 * 1000;

export interface IdleSweepOptions {
  now?: Date;
  /** Default: SESSION_IDLE_LOBBY_HOURS / SESSION_IDLE_LIVE_HOURS (`env.sessionIdle`). */
  thresholds?: IdleThresholds;
  signal?: AbortSignal;
}

export interface IdleSweepTotals {
  ended: number;
  /** Used again, or ended by the host, between the lookup and the end. */
  skipped: number;
  failed: number;
}

/** Ids of the live sessions in `status` whose last activity is at or before `cutoff` (index `live_sessions_by_activity`). */
const idleCandidates = async (status: 'lobby' | 'active', cutoff: Date) => {
  const rows = await PresentationSessionModel.find({
    isLive: true,
    status,
    $or: [
      { lastActivityAt: { $lte: cutoff } },
      // Opened before `lastActivityAt` was recorded: their last save stands in (`lastActivityOf`).
      { lastActivityAt: null, updatedAt: { $lte: cutoff } },
    ],
  })
    .select('_id')
    .lean();
  return rows.map((row) => String(row._id));
};

const auditAutoEnd = async (session: IPresentationSession, reason: IdleEndReason, thresholds: IdleThresholds) => {
  const workspace = session.workspaceId
    ? await WorkspaceModel.findById(session.workspaceId).select('plan planOverrides').lean()
    : null;
  await audit(
    { actorType: 'system', workspace },
    'session.auto_ended',
    { type: 'session', id: session._id },
    {
      reason,
      presentationId: String(session.presentationId),
      runNumber: session.runNumber,
      lastActivityAt: lastActivityOf(session)?.toISOString() ?? null,
      idleHours: reason === 'lobby_idle' ? thresholds.lobbyHours : thresholds.liveHours,
    }
  );
};

/** Ends every live session idle past its threshold at `now`. Safe to re-run: ended sessions are never matched again. */
export async function endIdleSessions(options: IdleSweepOptions = {}): Promise<IdleSweepTotals> {
  const now = options.now ?? new Date();
  const thresholds = options.thresholds ?? env.sessionIdle;
  const totals: IdleSweepTotals = { ended: 0, skipped: 0, failed: 0 };

  for (const status of ['lobby', 'active'] as const) {
    const cutoff = new Date(now.getTime() - idleLimitMs(status, thresholds)!);
    for (const sessionId of await idleCandidates(status, cutoff)) {
      if (options.signal?.aborted) return totals;
      try {
        const ended = await endIdleSession(sessionId, now, thresholds);
        if (!ended) {
          totals.skipped += 1;
          continue;
        }
        totals.ended += 1;
        await auditAutoEnd(ended.session, ended.reason, thresholds);
      } catch (error) {
        // A host command saved the session in between: it is not idle any more.
        if (error instanceof ApiError && error.code === LIVE_ERROR_CODES.sessionBusy) {
          totals.skipped += 1;
        } else {
          totals.failed += 1;
          console.error(`[Presentation] Ending idle session ${sessionId} failed:`, error);
        }
      }
    }
  }
  return totals;
}

registerJob({
  name: SESSION_IDLE_JOB,
  everyMs: SESSION_IDLE_JOB_EVERY_MS,
  run: async ({ signal }: JobContext) => {
    const totals = await endIdleSessions({ signal });
    if (totals.ended || totals.failed) console.log(`[Presentation] Idle sessions: ${JSON.stringify(totals)}`);
  },
});
