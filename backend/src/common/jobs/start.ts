import { startImportWorker } from '../../workers/import.worker';
import { startLiveDistributionWorker } from '../../modules/presentations/liveDistribution.worker';
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
  startLiveDistributionWorker();
  // Imports run here unless IMPORT_WORKER_INPROCESS=0 (then `bun run worker:import` does).
  startImportWorker();
  startScheduler();
};
