import type { Request, Response, NextFunction } from 'express';
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
   */
  keyBy?: 'ip' | 'global';
}

/**
 * Fixed-window rate limiter backed by Redis (INCR + EXPIRE), so limits hold
 * across multiple backend instances. Fails open if Redis is unavailable —
 * availability beats throttling for this app.
 */
export const rateLimit = ({ prefix, windowSec, max, keyBy = 'ip' }: RateLimitOptions) => {
  return async (req: Request, _res: Response, next: NextFunction) => {
    try {
      const key =
        keyBy === 'global'
          ? `rl:${prefix}:global`
          : `rl:${prefix}:${req.ip || req.socket.remoteAddress || 'unknown'}`;

      const count = await redisClient.incr(key);
      if (count === 1) {
        await redisClient.expire(key, windowSec);
      }

      if (count > max) {
        return next(ApiError.tooManyRequests());
      }
    } catch (error) {
      console.error('[RateLimit] Redis error, failing open:', error);
    }
    next();
  };
};
