import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { createServer } from 'http';
import type { AddressInfo } from 'net';
import { createAdapter } from '@socket.io/redis-adapter';
import { createClient } from 'redis';
import { Server } from 'socket.io';
import { io as connectClient, type Socket as ClientSocket } from 'socket.io-client';

/**
 * W2-D spike: @socket.io/redis-adapter on node-redis v5 links two Socket.io
 * servers in one process. Needs TEST_REDIS_URL (skips otherwise). Each run uses
 * its own channel prefix, since Redis pub/sub ignores the database index.
 */
const TEST_REDIS_URL = process.env.TEST_REDIS_URL;

type RedisClient = ReturnType<typeof createClient>;
type Instance = { io: Server; url: string; clients: RedisClient[] };

const waitFor = async (check: () => boolean, what: string, timeoutMs = 3000) => {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}`);
    await Bun.sleep(10);
  }
};

describe.skipIf(!TEST_REDIS_URL)('spike: @socket.io/redis-adapter + node-redis v5', () => {
  const key = `openpoll-spike-${randomUUID()}`;
  const instances: Instance[] = [];
  let client: ClientSocket;
  const received: string[] = [];

  const startInstance = async (): Promise<Instance> => {
    const pub = createClient({ url: TEST_REDIS_URL });
    const sub = pub.duplicate();
    await Promise.all([pub.connect(), sub.connect()]);
    const http = createServer();
    const io = new Server(http, { adapter: createAdapter(pub, sub, { key }) });
    io.on('connection', (socket) => socket.join('live:deck'));
    await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve));
    const instance = { io, url: `http://127.0.0.1:${(http.address() as AddressInfo).port}`, clients: [pub, sub] };
    instances.push(instance);
    return instance;
  };

  beforeAll(async () => {
    const a = await startInstance();
    await startInstance();
    client = connectClient(a.url, { transports: ['websocket'], forceNew: true });
    client.on('hello', (from: string) => received.push(from));
    await waitFor(() => client.connected, 'client to connect');
    await waitFor(() => (a.io.of('/').adapter.rooms.get('live:deck')?.size ?? 0) === 1, 'room join');
  });

  afterAll(async () => {
    client?.disconnect();
    for (const { io, clients } of instances) {
      await new Promise<void>((resolve) => io.close(() => resolve()));
      for (const redis of clients) if (redis.isOpen) await redis.close();
    }
  });

  it('delivers a room broadcast from the other instance', async () => {
    instances[1]!.io.to('live:deck').emit('hello', 'b-broadcast');
    await waitFor(() => received.includes('b-broadcast'), 'cross-instance broadcast');
  });

  it('keeps io.local emits on the emitting instance', async () => {
    instances[1]!.io.local.to('live:deck').emit('hello', 'b-local');
    // Published after b-local on the same Redis connection, so it would arrive after it.
    instances[1]!.io.to('live:deck').emit('hello', 'b-fence');
    instances[0]!.io.local.to('live:deck').emit('hello', 'a-local');
    await waitFor(() => received.includes('a-local') && received.includes('b-fence'), 'local emit and fence');
    expect(received).not.toContain('b-local');
  });

  it('answers cluster-wide requests (fetchSockets, serverSideEmit)', async () => {
    const sockets = await instances[1]!.io.in('live:deck').fetchSockets();
    expect(sockets.map((socket) => socket.id)).toEqual([client.id!]);

    const got = new Promise<string>((resolve) => instances[0]!.io.on('ping-cluster', resolve));
    instances[1]!.io.serverSideEmit('ping-cluster', 'from-b');
    expect(await got).toBe('from-b');
  });
});
