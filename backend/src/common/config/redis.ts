import { createClient } from 'redis';
import { emitPollAnalyticsUpdate } from '../realtime/socket.gateway';
import { REALTIME_CHANNELS } from '../realtime/events';
import type { ResponseAcceptedEvent } from '../realtime/events';

export const redisClient = createClient({
  url: process.env.REDIS_URL || 'redis://127.0.0.1:6379'
});

export const redisSubscriber = redisClient.duplicate();

redisClient.on('error', (err) => console.error('[Redis] Client Error:', err));
redisClient.on('connect', () => console.log('[Redis] Connected successfully ⚡'));
redisSubscriber.on('error', (err) => console.error('[Redis] Subscriber Error:', err));

export const connectRedis = async () => {
  try {
    if (!redisClient.isOpen) {
      await redisClient.connect();
    }

    if (!redisSubscriber.isOpen) {
      await redisSubscriber.connect();
    }

    await redisSubscriber.subscribe(REALTIME_CHANNELS.responseAccepted, (payload) => {
      const parsed = JSON.parse(payload) as ResponseAcceptedEvent;
      emitPollAnalyticsUpdate(parsed.analytics);
    });
  } catch (error) {
    console.error(`[Redis] Connection Error:`, error);
  }
};