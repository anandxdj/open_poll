import { createClient } from 'redis';

const redisUrl = process.env.REDIS_URL || 'redis://127.0.0.1:6379';
console.log(`[Redis] Connecting to: ${redisUrl}`);

export const redisClient = createClient({
  url: redisUrl,
});

redisClient.on('error', (err) => console.error('[Redis] Client Error:', err));
redisClient.on('connect', () => console.log('[Redis] Connected successfully ⚡'));

export const connectRedis = async () => {
  try {
    if (!redisClient.isOpen) {
      await redisClient.connect();
    }
  } catch (error) {
    console.error(`[Redis] Connection Error:`, error);
  }
};