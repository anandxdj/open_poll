import { registerJob, type JobContext } from '../../../common/jobs/scheduler';
import { closeDueAudiences } from './audience.service';

/**
 * The `audience-autoclose` job (W2-F): every 30 seconds, on one instance at a
 * time (the scheduler's tick and run locks), closes the audience-paced
 * sessions whose closing time has passed (`closeDueAudiences`). Answers are
 * already refused past the closing time by the answer windows (their deadline
 * is the closing time); the job records the close, stops the windows for good
 * and tells everyone (`audience:closed`), so results shown "after close" appear.
 */
export const AUDIENCE_AUTOCLOSE_JOB = 'audience-autoclose';
export const AUDIENCE_AUTOCLOSE_EVERY_MS = 30_000;

registerJob({
  name: AUDIENCE_AUTOCLOSE_JOB,
  everyMs: AUDIENCE_AUTOCLOSE_EVERY_MS,
  run: async ({ signal }: JobContext) => {
    const totals = await closeDueAudiences(new Date(), signal);
    if (totals.closed || totals.failed) console.log(`[Presentation] Audience auto-close: ${JSON.stringify(totals)}`);
  },
});
