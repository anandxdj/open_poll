import type { Server } from 'socket.io';
import { redisClient } from '../config/redis';
import { socketAuth } from './auth';
import { REALTIME_CHANNELS } from './events';
import './modules';
import { deliverLiveEvent } from './publish';
import { getSocketModules, type ChannelHandler } from './registry';

/**
 * Boots realtime on a Socket.io server: the optional-JWT handshake, every
 * registered socket module, and one Redis subscriber per instance that delivers
 * published events to this instance's sockets. The returned `close` drops the
 * subscriber (tests, graceful shutdown).
 */
export const setupSocketAndPubSub = async (io: Server) => {
  const subscriber = redisClient.duplicate();
  subscriber.on('error', (error) => {
    console.error('[Redis] Subscriber Error:', error);
  });
  await subscriber.connect();

  const modules = getSocketModules();

  io.use(socketAuth);
  io.on('connection', (socket) => {
    for (const module of modules) module.onConnection?.(socket, io);
  });

  const handlers = new Map<string, ChannelHandler[]>([[REALTIME_CHANNELS.liveEvent, [deliverLiveEvent]]]);
  for (const module of modules) {
    for (const [channel, handler] of Object.entries(module.channels ?? {})) {
      handlers.set(channel, [...(handlers.get(channel) ?? []), handler]);
    }
  }

  for (const [channel, channelHandlers] of handlers) {
    await subscriber.subscribe(channel, (message: string) => {
      for (const handler of channelHandlers) {
        try {
          handler(message, io);
        } catch (error) {
          console.error(`[Realtime] Handler for ${channel} failed:`, error);
        }
      }
    });
  }

  return {
    close: async () => {
      if (subscriber.isOpen) await subscriber.close();
    },
  };
};
