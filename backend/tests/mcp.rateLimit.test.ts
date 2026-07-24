import { describe, expect, it } from 'bun:test';
import { mcpRateLimit } from '../src/modules/mcp/mcp.rateLimit';
import { redisClient } from '../src/common/config/redis';
import type { McpAuthRequest } from '../src/modules/mcp/mcp.auth';

function makeReq(tokenHash: string): McpAuthRequest {
  return { mcp: { tokenHash } } as unknown as McpAuthRequest;
}

describe('mcpRateLimit', () => {
  it('allows requests under the limit', async () => {
    const originalIncr = redisClient.incr;
    const originalExpire = redisClient.expire;
    (redisClient as any).incr = async () => 1;
    (redisClient as any).expire = async () => 1;

    let called = false;
    await mcpRateLimit(makeReq('hash-a'), {} as any, ((err?: unknown) => {
      called = true;
      expect(err).toBeUndefined();
    }) as any);
    expect(called).toBe(true);

    (redisClient as any).incr = originalIncr;
    (redisClient as any).expire = originalExpire;
  });

  it('blocks requests over the limit with 429', async () => {
    const originalIncr = redisClient.incr;
    (redisClient as any).incr = async () => 121;

    let receivedError: any;
    await mcpRateLimit(makeReq('hash-b'), {} as any, ((err?: unknown) => {
      receivedError = err;
    }) as any);

    expect(receivedError?.statusCode).toBe(429);

    (redisClient as any).incr = originalIncr;
  });

  it('fails open when redis errors', async () => {
    const originalIncr = redisClient.incr;
    (redisClient as any).incr = async () => {
      throw new Error('redis down');
    };

    let called = false;
    let receivedError: any;
    await mcpRateLimit(makeReq('hash-c'), {} as any, ((err?: unknown) => {
      called = true;
      receivedError = err;
    }) as any);

    expect(called).toBe(true);
    expect(receivedError).toBeUndefined();

    (redisClient as any).incr = originalIncr;
  });

  it('skips the check entirely when there is no resolved token', async () => {
    let called = false;
    await mcpRateLimit({} as McpAuthRequest, {} as any, ((err?: unknown) => {
      called = true;
      expect(err).toBeUndefined();
    }) as any);
    expect(called).toBe(true);
  });
});
