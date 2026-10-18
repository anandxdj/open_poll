import type { Server as HttpServer } from 'http';
import { Server } from 'socket.io';
import { env } from '../common/config/env';

/** The Socket.io server attached to the HTTP server; realtime handlers are added by setupSocketAndPubSub. */
export const createSocketServer = (httpServer: HttpServer) =>
  new Server(httpServer, {
    cors: {
      origin: env.allowedOrigins,
      methods: ['GET', 'POST'],
    },
  });
