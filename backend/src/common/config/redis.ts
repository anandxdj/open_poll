import { createClient } from 'redis';
import { env } from './env';

const redisUrl = env.REDIS_URL;

/** Never log the password embedded in a redis:// URL. */
const redactUrl = (value: string) => {
  try {
    const url = new URL(value);
    if (url.password) url.password = '***';
    return url.toString();
  } catch {
    return '<invalid url>';
  }
};
console.log(`[Redis] Connecting to: ${redactUrl(redisUrl)}`);

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