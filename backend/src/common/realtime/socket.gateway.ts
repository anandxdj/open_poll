import { Server as HttpServer } from 'http';
import { Server } from 'socket.io';
import type { PollAnalyticsUpdateEvent } from './events';

let ioInstance: Server | null = null;

export const initSocketGateway = (httpServer: HttpServer): Server => {
  ioInstance = new Server(httpServer, {
    cors: {
      origin: '*',
      methods: ['GET', 'POST'],
    },
  });

  ioInstance.on('connection', (socket) => {
    socket.on('poll:join', (pollId: string) => {
      if (pollId) {
        socket.join(pollId);
      }
    });

    socket.on('poll:leave', (pollId: string) => {
      if (pollId) {
        socket.leave(pollId);
      }
    });
  });

  return ioInstance;
};

export const emitPollAnalyticsUpdate = (event: PollAnalyticsUpdateEvent) => {
  if (!ioInstance) return;
  ioInstance.to(event.pollId).emit('analytics:update', event);
};
