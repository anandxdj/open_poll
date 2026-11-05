// Must stay the first import: validates the environment before any module
// reads it, so a misconfigured deploy fails at boot with every problem listed.
import { env } from './common/config/env';
import { createServer } from 'http';
import { connectDB } from './common/config/db';
import { connectRedis } from './common/config/redis';
import { startJobs } from './common/jobs/start';
import { setupSocketAndPubSub } from './common/realtime/socket';
import { createApp } from './http/createApp';
import { createSocketServer } from './http/socketServer';
import { notifyError } from './common/observability/alerts';

// A stray rejected promise is logged and alerted, and the server keeps serving live sessions.
process.on('unhandledRejection', (reason) => {
  console.error('[Unhandled Rejection]', reason);
  void notifyError('unhandledRejection', reason);
});
// An uncaught exception leaves the process in an unknown state: alert (for up to 3 s), then exit
// so the container restarts it.
process.on('uncaughtException', (error) => {
  console.error('[Uncaught Exception]', error);
  const exit = () => process.exit(1);
  setTimeout(exit, 3000).unref();
  notifyError('uncaughtException', error).finally(exit);
});

// Boot only. The app is built by createApp() and its routes live in
// http/routes.ts; tests build the same app without this file.
const bootstrap = async () => {
  const httpServer = createServer(createApp());
  const io = createSocketServer(httpServer);

  await connectDB();
  await connectRedis();
  await setupSocketAndPubSub(io);
  startJobs();

  httpServer.listen(env.PORT, () => {
    console.log(`[Server] Running on port ${env.PORT}`);
  });
};

void bootstrap();
