import type { Request, Response, NextFunction } from 'express';
import * as crypto from 'crypto';
import { redisClient } from '../config/redis';
import { ApiError } from '../utils/ApiError';

interface RateLimitOptions {
  /** Unique name for this limiter (becomes part of the Redis key) */
  prefix: string;
  /** Window length in seconds */
  windowSec: number;
  /** Max requests per window */
  max: number;
  /**
   * 'ip' (default) keys the limit per client IP. 'global' shares one counter
   * across every caller — use this alongside the per-IP limit on endpoints
   * that are guessable/enumerable (e.g. join-code lookup), since a per-IP
   * cap alone does nothing against brute-forcing spread across many IPs.
   * 'email' keys on the normalized `req.body.email` (hashed, never stored raw)
   * so one account can't be brute-forced or email-bombed from rotating IPs;
   * 'ip+email' keys on the pair. A function can derive any other identity.
   * Email/function keys fall back to the IP when no identity is present.
   */
  keyBy?: 'ip' | 'global' | 'email' | 'ip+email' | ((req: Request) => string | undefined);
  /**
   * What happens when Redis is unavailable. 'open' (default) lets the request
   * through — availability beats throttling on participant routes. 'memory'
   * enforces the same limit per instance from an in-process window; 'closed'
   * rejects with 503. Auth routes use 'memory' so a Redis outage never
   * removes brute-force protection.
   */
  onStoreError?: 'open' | 'memory' | 'closed';
}

const clientIp = (req: Request) => req.ip || req.socket?.remoteAddress || 'unknown';

const hashIdentity = (value: string) => crypto.createHash('sha256').update(value).digest('hex').slice(0, 32);

/** Lower-cased, trimmed `req.body.email`, or undefined when absent. */
export const normalizedEmail = (req: Request): string | undefined => {
  const email = req.body?.email;
  if (typeof email !== 'string') return undefined;
  const normalized = email.trim().toLowerCase();
  return normalized || undefined;
};

const buildKey = (prefix: string, keyBy: NonNullable<RateLimitOptions['keyBy']>, req: Request) => {
  const ip = clientIp(req);
  if (keyBy === 'global') return `rl:${prefix}:global`;
  if (keyBy === 'ip') return `rl:${prefix}:${ip}`;
  if (keyBy === 'email' || keyBy === 'ip+email') {
    const email = normalizedEmail(req);
    if (!email) return `rl:${prefix}:${ip}`;
    return keyBy === 'email'
      ? `rl:${prefix}:email:${hashIdentity(email)}`
      : `rl:${prefix}:${ip}:email:${hashIdentity(email)}`;
  }
  const identity = keyBy(req);
  return identity ? `rl:${prefix}:id:${hashIdentity(identity)}` : `rl:${prefix}:${ip}`;
};

// Per-instance fallback windows, only consulted while Redis is failing.
const MEMORY_MAX_KEYS = 10_000;
const memoryWindows = new Map<string, { count: number; resetAt: number }>();

const memoryIncr = (key: string, windowSec: number) => {
  const now = Date.now();
  let entry = memoryWindows.get(key);
  if (!entry || entry.resetAt <= now) {
    if (memoryWindows.size >= MEMORY_MAX_KEYS) {
      for (const [k, v] of memoryWindows) if (v.resetAt <= now) memoryWindows.delete(k);
      // Still full (many live keys): evict the oldest insertions.
      for (const k of memoryWindows.keys()) {
        if (memoryWindows.size < MEMORY_MAX_KEYS) break;
        memoryWindows.delete(k);
      }
    }
    entry = { count: 0, resetAt: now + windowSec * 1000 };
    memoryWindows.set(key, entry);
  }
  entry.count += 1;
  return entry.count;
};

/** Test helper: clears the in-memory fallback windows. */
export const resetRateLimitMemory = () => memoryWindows.clear();

/**
 * Fixed-window rate limiter backed by Redis (INCR + EXPIRE), so limits hold
 * across multiple backend instances. On Redis errors it fails open unless
 * `onStoreError` says otherwise.
 */
export const rateLimit = ({ prefix, windowSec, max, keyBy = 'ip', onStoreError = 'open' }: RateLimitOptions) => {
  return async (req: Request, _res: Response, next: NextFunction) => {
    const key = buildKey(prefix, keyBy, req);
    let count: number;
    try {
      count = await redisClient.incr(key);
      if (count === 1) {
        await redisClient.expire(key, windowSec);
      }
    } catch (error) {
      if (onStoreError === 'closed') {
        console.error('[RateLimit] Redis error, failing closed:', error);
        return next(new ApiError(503, 'Service temporarily unavailable, please retry shortly'));
      }
      if (onStoreError === 'open') {
        console.error('[RateLimit] Redis error, failing open:', error);
        return next();
      }
      console.error('[RateLimit] Redis error, using in-memory limit:', error);
      count = memoryIncr(key, windowSec);
    }

    if (count > max) {
      return next(ApiError.tooManyRequests());
    }
    next();
  };
};
