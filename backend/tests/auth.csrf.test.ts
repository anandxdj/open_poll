import { describe, expect, it } from 'bun:test';
import { requireTrustedOrigin } from '../src/common/middlewares/origin.middleware';
import { authenticate } from '../src/modules/auth/auth.middleware';
import { generateAccessToken } from '../src/common/utils/jwt.utils';
import { captureNext, mockReq } from './helpers/http';

const guard = requireTrustedOrigin(['https://openpoll.example', 'https://preview.example']);

const check = (headers: Record<string, string>) => {
  const { next, calls } = captureNext();
  guard(mockReq({ headers }), {} as any, next);
  return calls[0] as any;
};

describe('cookie-authenticated endpoint origin check', () => {
  it('allows listed origins', () => {
    expect(check({ Origin: 'https://openpoll.example' })).toBeUndefined();
    expect(check({ Origin: 'https://preview.example' })).toBeUndefined();
  });

  it('rejects cross-site and opaque origins', () => {
    expect(check({ Origin: 'https://evil.example' })?.statusCode).toBe(403);
    expect(check({ Origin: 'null' })?.statusCode).toBe(403);
    // A trusted Referer cannot rescue an untrusted Origin.
    expect(check({ Origin: 'https://evil.example', Referer: 'https://openpoll.example/polls' })?.statusCode).toBe(403);
  });

  it('falls back to the Referer origin when Origin is absent', () => {
    expect(check({ Referer: 'https://openpoll.example/polls?x=1' })).toBeUndefined();
    expect(check({ Referer: 'https://evil.example/openpoll.example' })?.statusCode).toBe(403);
  });

  it('rejects requests that carry neither header', () => {
    expect(check({})?.statusCode).toBe(403);
  });
});

describe('auth route wiring', () => {
  it('guards /refresh-token and /logout with the origin check', async () => {
    const express = (await import('express')).default;
    const cookieParser = (await import('cookie-parser')).default;
    const { default: authRouter } = await import('../src/modules/auth/auth.route');
    const { errorHandler } = await import('../src/common/middlewares/errorHandler');
    const { redisClient } = await import('../src/common/config/redis');

    const originalIncr = redisClient.incr;
    const originalExpire = redisClient.expire;
    (redisClient as any).incr = async () => 1;
    (redisClient as any).expire = async () => 1;

    const app = express();
    app.use(express.json());
    app.use(cookieParser());
    app.use('/api/auth', authRouter);
    app.use(errorHandler);
    const server = app.listen(0);
    const { port } = server.address() as { port: number };
    const post = (path: string, origin: string) =>
      fetch(`http://127.0.0.1:${port}/api/auth${path}`, { method: 'POST', headers: { Origin: origin, Cookie: 'refreshToken=x' } });

    try {
      expect((await post('/refresh-token', 'https://evil.example')).status).toBe(403);
      expect((await post('/logout', 'https://evil.example')).status).toBe(403);
      // Dev/test trusts the local frontend; the bogus cookie then fails auth normally.
      expect((await post('/refresh-token', 'http://localhost:3000')).status).toBe(401);
    } finally {
      server.close();
      (redisClient as any).incr = originalIncr;
      (redisClient as any).expire = originalExpire;
    }
  });
});

describe('authenticate', () => {
  it('ignores a `token` cookie: Bearer is the only accepted credential', async () => {
    const token = generateAccessToken({ id: '64b000000000000000000001', email: 'a@example.com', name: 'A', role: 'user' });
    const { next, calls } = captureNext();
    await authenticate()(mockReq({ cookies: { token } }), {} as any, next);
    expect((calls[0] as any)?.statusCode).toBe(401);
  });
});
