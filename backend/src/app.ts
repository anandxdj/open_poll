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
