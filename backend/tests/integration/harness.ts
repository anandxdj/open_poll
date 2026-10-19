/**
 * Integration harness: the real app from createApp() plus the realtime
 * server, listening on port 0 against dedicated test services.
 *
 *   docker run -d --name openpoll-test-mongo -p 127.0.0.1:27117:27017 mongo:7
 *   docker run -d --name openpoll-test-redis -p 127.0.0.1:6390:6379 redis:7-alpine
 *
 *   cd backend
 *   TEST_MONGO_URI='mongodb://127.0.0.1:27117/openpoll_test?directConnection=true' \
 *   TEST_REDIS_URL=redis://127.0.0.1:6390/5 \
 *   bun test tests/integration
 *
 * Suites skip when either variable is unset. `resetTestData()` empties every
 * collection of TEST_MONGO_URI's database and flushes TEST_REDIS_URL's Redis
 * database, so point both at throwaway services, never a dev or shared one.
 * Run from backend/: bunfig.toml preloads tests/preload.ts, which points the
 * app's own MONGO_URI/REDIS_URL at the test services. Interval workers are
 * never started.
 */
import { describe } from 'bun:test';
import { createServer, type Server as HttpServer } from 'http';
import type { AddressInfo } from 'net';
import type { Express } from 'express';
import mongoose from 'mongoose';
import type { Server as SocketServer } from 'socket.io';
import { io as connectClient, type ManagerOptions, type Socket as ClientSocket, type SocketOptions } from 'socket.io-client';
import { env } from '../../src/common/config/env';
import { redisClient } from '../../src/common/config/redis';
import type { RedisAdapterOptions } from '../../src/common/realtime/adapter';
import { setupSocketAndPubSub } from '../../src/common/realtime/socket';
import { createApp } from '../../src/http/createApp';
import { flushScheduledNow } from '../../src/modules/presentations/live/coalescer';
import { flushWriteBehind } from '../../src/modules/presentations/live/writeBehind';
import { createSocketServer } from '../../src/http/socketServer';

export const TEST_MONGO_URI = process.env.TEST_MONGO_URI;
export const TEST_REDIS_URL = process.env.TEST_REDIS_URL;
export const integrationEnabled = Boolean(TEST_MONGO_URI && TEST_REDIS_URL);

/** `describe` that skips the suite unless both test services are configured. */
export const describeIntegration = describe.skipIf(!integrationEnabled);

export interface StartTestServerOptions {
  /** Link this server's Socket.io instance to the others through the Redis adapter (`key` keeps runs apart). */
  redisAdapter?: RedisAdapterOptions;
}

/** Writes the answer batches and publishes the host updates still waiting on their timers. */
export const settleLiveEngine = async () => {
  await flushWriteBehind();
  await flushScheduledNow();
};

export interface TestServer {
  app: Express;
  httpServer: HttpServer;
  io: SocketServer;
  /** `http://127.0.0.1:<port>` */
  baseUrl: string;
  /** `fetch` against the server; a plain-object body is sent as JSON. */
  request(path: string, init?: Omit<RequestInit, 'body'> & { body?: unknown }): Promise<Response>;
  /** A websocket-only client; disconnected by `close()`. */
  connectSocket(options?: Partial<ManagerOptions & SocketOptions>): ClientSocket;
  close(): Promise<void>;
}

let openServers = 0;
// mvp.smoke.test.ts pins `redisClient.isOpen` to true; lift it while a server owns the client.
let pinnedIsOpen: PropertyDescriptor | undefined;

function assertTestServices() {
  if (!integrationEnabled) {
    throw new Error('Integration harness needs TEST_MONGO_URI and TEST_REDIS_URL');
  }
  if (env.MONGO_URI !== TEST_MONGO_URI || redisClient.options?.url !== TEST_REDIS_URL) {
    throw new Error(
      'The app is not pointed at TEST_MONGO_URI/TEST_REDIS_URL. Run `bun test` from backend/ so ' +
        'bunfig.toml preloads tests/preload.ts.',
    );
  }
}

async function acquireConnections() {
  assertTestServices();
  if (openServers++ > 0) return;
  pinnedIsOpen = Object.getOwnPropertyDescriptor(redisClient, 'isOpen');
  if (pinnedIsOpen) delete (redisClient as { isOpen?: boolean }).isOpen;
  if (!redisClient.isOpen) await redisClient.connect();
  if (mongoose.connection.readyState !== 1) await mongoose.connect(env.MONGO_URI);
}

async function releaseConnections() {
  if (--openServers > 0) return;
  await mongoose.disconnect();
  if (redisClient.isOpen) await redisClient.close();
  if (pinnedIsOpen) Object.defineProperty(redisClient, 'isOpen', pinnedIsOpen);
  pinnedIsOpen = undefined;
}

/**
 * Connects Mongo and Redis (shared by every server started in the file) and
 * serves createApp() with realtime on an ephemeral port. Call twice for two
 * "instances" sharing the same Redis.
 */
export async function startTestServer(options: StartTestServerOptions = {}): Promise<TestServer> {
  await acquireConnections();

  const app = createApp();
  const httpServer = createServer(app);
  const io = createSocketServer(httpServer);
  const realtime = await setupSocketAndPubSub(io, { redisAdapter: options.redisAdapter });
  await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${(httpServer.address() as AddressInfo).port}`;
  const sockets: ClientSocket[] = [];

  return {
    app,
    httpServer,
    io,
    baseUrl,
    request(path, init = {}) {
      const { body, headers, ...rest } = init;
      const isJson = body !== undefined && typeof body === 'object' && !(body instanceof FormData);
      return fetch(`${baseUrl}${path}`, {
        ...rest,
        headers: { ...(isJson ? { 'content-type': 'application/json' } : {}), ...(headers as Record<string, string>) },
        body: isJson ? JSON.stringify(body) : (body as RequestInit['body']),
      });
    },
    connectSocket(options = {}) {
      const socket = connectClient(baseUrl, { transports: ['websocket'], forceNew: true, ...options });
      sockets.push(socket);
      return socket;
    },
    async close() {
      await settleLiveEngine();
      for (const socket of sockets) socket.disconnect();
      await realtime.close();
      await new Promise<void>((resolve) => io.close(() => resolve()));
      await releaseConnections();
    },
  };
}

/** Empties every collection (indexes stay) and the test Redis database. Needs a running server. */
export async function resetTestData(): Promise<void> {
  assertTestServices();
  const db = mongoose.connection.db;
  if (!db) throw new Error('resetTestData() needs a started test server');
  await settleLiveEngine();
  for (const collection of await db.collections()) await collection.deleteMany({});
  await redisClient.flushDb();
}
