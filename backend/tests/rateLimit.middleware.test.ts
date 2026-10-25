import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { rateLimit, resetRateLimitMemory } from '../src/common/middlewares/rateLimit.middleware';
import { redisClient } from '../src/common/config/redis';
import { captureNext, mockReq } from './helpers/http';

const originalIncr = redisClient.incr;
const originalExpire = redisClient.expire;
let keys: string[] = [];
const quietError = console.error;

beforeEach(() => {
  keys = [];
  resetRateLimitMemory();
  console.error = () => {};
  (redisClient as any).incr = async (key: string) => {
    keys.push(key);
    return 1;
  };
  (redisClient as any).expire = async () => 1;
});

afterEach(() => {
  (redisClient as any).incr = originalIncr;
  (redisClient as any).expire = originalExpire;
  console.error = quietError;
});

const redisDown = () => {
  (redisClient as any).incr = async () => {
    throw new Error('redis down');
  };
};

const run = async (mw: ReturnType<typeof rateLimit>, req = mockReq()) => {
  const { next, calls } = captureNext();
  await mw(req, {} as any, next);
  return calls[0] as any;
};

describe('rateLimit keying', () => {
  it('keeps the existing ip and global key formats', async () => {
    await run(rateLimit({ prefix: 'p', windowSec: 60, max: 5 }), mockReq({ ip: '198.51.100.1' }));
    await run(rateLimit({ prefix: 'g', windowSec: 60, max: 5, keyBy: 'global' }));
    expect(keys).toEqual(['rl:p:198.51.100.1', 'rl:g:global']);
  });

  it('keys by normalized, hashed email across IPs', async () => {
    const mw = rateLimit({ prefix: 'login-email', windowSec: 60, max: 5, keyBy: 'email' });
    await run(mw, mockReq({ ip: '198.51.100.1', body: { email: 'Victim@Example.com ' } }));
    await run(mw, mockReq({ ip: '198.51.100.2', body: { email: 'victim@example.com' } }));
    await run(mw, mockReq({ ip: '198.51.100.1', body: { email: 'other@example.com' } }));

    expect(keys[0]).toBe(keys[1]!);
    expect(keys[0]).not.toBe(keys[2]!);
    expect(keys[0]).toMatch(/^rl:login-email:email:[a-f0-9]{32}$/);
    expect(keys.join()).not.toContain('example.com');
  });

  it('supports ip+email pairs and falls back to IP without an email', async () => {
    const mw = rateLimit({ prefix: 'forgot', windowSec: 60, max: 5, keyBy: 'ip+email' });
    await run(mw, mockReq({ ip: '198.51.100.1', body: { email: 'a@example.com' } }));
    await run(mw, mockReq({ ip: '198.51.100.1', body: {} }));
    expect(keys[0]).toMatch(/^rl:forgot:198\.51\.100\.1:email:[a-f0-9]{32}$/);
    expect(keys[1]).toBe('rl:forgot:198.51.100.1');
  });

  it('accepts a custom identity function', async () => {
    const mw = rateLimit({ prefix: 'custom', windowSec: 60, max: 5, keyBy: (req) => String(req.params.token) });
    await run(mw, mockReq({ params: { token: 'abc' } }));
    expect(keys[0]).toMatch(/^rl:custom:id:[a-f0-9]{32}$/);
  });

  it('rejects with 429 once the window is exhausted', async () => {
    (redisClient as any).incr = async () => 6;
    const err = await run(rateLimit({ prefix: 'p', windowSec: 60, max: 5 }));
    expect(err?.statusCode).toBe(429);
  });
});

describe('rateLimit when Redis fails', () => {
  it('fails open by default (participant routes)', async () => {
    redisDown();
    const err = await run(rateLimit({ prefix: 'p', windowSec: 60, max: 1 }));
    expect(err).toBeUndefined();
  });

  it('fails closed with 503 when asked', async () => {
    redisDown();
    const err = await run(rateLimit({ prefix: 'p', windowSec: 60, max: 100, onStoreError: 'closed' }));
    expect(err?.statusCode).toBe(503);
  });

  it('falls back to an in-memory window that still enforces the limit', async () => {
    redisDown();
    const mw = rateLimit({ prefix: 'auth-login', windowSec: 60, max: 2, onStoreError: 'memory' });
    const req = () => mockReq({ ip: '198.51.100.9' });
    expect(await run(mw, req())).toBeUndefined();
    expect(await run(mw, req())).toBeUndefined();
    expect((await run(mw, req()))?.statusCode).toBe(429);
    // Other clients have their own window.
    expect(await run(mw, mockReq({ ip: '198.51.100.10' }))).toBeUndefined();
  });

  it('applies email keying to the in-memory fallback too', async () => {
    redisDown();
    const mw = rateLimit({ prefix: 'auth-login-email', windowSec: 60, max: 1, keyBy: 'email', onStoreError: 'memory' });
    expect(await run(mw, mockReq({ ip: '198.51.100.1', body: { email: 'v@example.com' } }))).toBeUndefined();
    const err = await run(mw, mockReq({ ip: '198.51.100.2', body: { email: 'V@example.com' } }));
    expect(err?.statusCode).toBe(429);
  });
});
