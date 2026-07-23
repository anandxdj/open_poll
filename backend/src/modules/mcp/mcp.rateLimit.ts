import type { Response, NextFunction } from 'express';
import { redisClient } from '../../common/config/redis';
import { ApiError } from '../../common/utils/ApiError';
import type { McpAuthRequest } from './mcp.auth';

export const mcpRateLimit = async (req: McpAuthRequest, _res: Response, next: NextFunction) => {
  try {
    const tokenHash = req.mcp?.tokenHash;
    if (!tokenHash) return next();

    const key = `rl:mcp-token:${tokenHash}`;
    const count = await redisClient.incr(key);
    if (count === 1) {
      await redisClient.expire(key, 60);
    }

    if (count > 120) {
      return next(ApiError.tooManyRequests());
    }
  } catch (error) {
    console.error('[McpRateLimit] Redis error, failing open:', error);
  }

  next();
};
