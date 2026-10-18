import { startLiveDistributionWorker } from '../../modules/presentations/liveDistribution.worker';
import { startAnalyticsWorker } from '../../modules/responses/analytics.worker';

/**
 * Starts the in-process interval workers. Only the server boot (app.ts) calls
 * this: tests build the app with createApp() and never start them.
 */
export const startJobs = () => {
  startAnalyticsWorker();
  startLiveDistributionWorker();
};
