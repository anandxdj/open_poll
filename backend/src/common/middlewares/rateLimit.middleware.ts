import type { Request, Response, NextFunction } from 'express';
import { redisClient } from '../config/redis';
import { ApiError } from '../utils/ApiError';

interface RateLimitOptions {
  /** Unique name for this limiter (becomes part of the Redis key) */
  prefix: string;
  /** Window length in seconds */
  windowSec: number;
  /** Max requests per IP per window */
  max: number;
}

/**
 * Fixed-window rate limiter backed by Redis (INCR + EXPIRE), so limits hold
 * across multiple backend instances. Fails open if Redis is unavailable —
 * availability beats throttling for this app.
 */
export const rateLimit = ({ prefix, windowSec, max }: RateLimitOptions) => {
  return async (req: Request, _res: Response, next: NextFunction) => {
    try {
      const ip = req.ip || req.socket.remoteAddress || 'unknown';
      const key = `rl:${prefix}:${ip}`;

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
