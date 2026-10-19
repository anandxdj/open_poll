import { createAdapter } from '@socket.io/redis-adapter';
import type { Server } from 'socket.io';
import { redisClient } from '../config/redis';
import { env } from '../config/env';

/**
 * Cluster adapter (W2-D). With `SOCKET_REDIS_ADAPTER=on` every instance's
 * Socket.io server shares room membership and cross-instance operations
 * (`io.in(room).fetchSockets()`, `disconnectSockets()`, …) over Redis.
 *
 * It does NOT change how live events are delivered: those already reach every
 * instance through the `live:event` pub/sub subscriber, which emits with
 * `io.local` — to this instance's sockets only. Emitting with `io.to` here
 * would make the adapter re-broadcast cluster-wide and deliver every event
 * once per instance, so `deliverLiveEvent` and every module channel handler
 * must keep using `io.local` (`registry.ts`, `socket.ts`).
 *
 * Off (default): single-instance mode, no extra connections. The adapter needs
 * its own publisher/subscriber pair, duplicated from the shared client.
 */
export interface RedisAdapterOptions {
  enabled?: boolean;
  /** Pub/sub channel prefix (`socket.io` by default). Tests use their own to stay apart. */
  key?: string;
}

export const attachRedisAdapter = async (io: Server, options: RedisAdapterOptions = {}) => {
  if (!(options.enabled ?? env.socketRedisAdapter)) return { close: async () => {} };

  const pub = redisClient.duplicate();
  const sub = redisClient.duplicate();
  for (const client of [pub, sub]) {
    client.on('error', (error) => console.error('[Redis] Socket adapter client error:', error));
  }
  await Promise.all([pub.connect(), sub.connect()]);
  io.adapter(createAdapter(pub, sub, options.key ? { key: options.key } : {}));

  return {
    close: async () => {
      for (const client of [pub, sub]) if (client.isOpen) await client.close();
    },
  };
};
