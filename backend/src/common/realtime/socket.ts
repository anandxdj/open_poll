import { createClient } from 'redis';
import type { Server } from 'socket.io';
import {
  REALTIME_CHANNELS,
  SOCKET_EVENTS,
  type ResponseAcceptedEvent,
} from './events';

export const setupSocketAndPubSub = async (io: Server) => {
  const subscriber = createClient({
    url: process.env.REDIS_URL || 'redis://127.0.0.1:6379',
  });

  subscriber.on('error', (error) => {
    console.error('[Redis] Subscriber Error:', error);
  });

  if (!subscriber.isOpen) {
    await subscriber.connect();
  }

  io.on('connection', (socket) => {
    socket.on(SOCKET_EVENTS.pollJoin, (pollId: string) => {
      if (!pollId) return;
      socket.join(`poll_${pollId}`);
    });

    socket.on(SOCKET_EVENTS.pollLeave, (pollId: string) => {
      if (!pollId) return;
      socket.leave(`poll_${pollId}`);
    });
  });

  await subscriber.subscribe(REALTIME_CHANNELS.analyticsUpdate, (payload: string) => {
    const parsed = JSON.parse(payload) as ResponseAcceptedEvent;
    io.to(`poll_${parsed.pollId}`).emit(SOCKET_EVENTS.analyticsUpdate, parsed.analytics);
  });
};
