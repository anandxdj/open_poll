import { startAutoRevealWorker } from '../../modules/presentations/live/autoRevealWorker';
import { startAnalyticsWorker } from '../../modules/responses/analytics.worker';
import { startScheduler } from './scheduler';

/**
 * Starts the in-process interval workers and the cluster-wide job scheduler
 * (every job registered with registerJob() by the modules app.ts imported).
 * Only the server boot (app.ts) calls this: tests build the app with
 * createApp() and never start them.
 */
export const startJobs = () => {
  startAnalyticsWorker();
  startAutoRevealWorker();
  startScheduler();
};
