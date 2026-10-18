import type { Request, Response, NextFunction } from 'express';
import { env } from '../config/env';
import { ApiError } from '../utils/ApiError';

const refererOrigin = (referer: string | undefined) => {
  if (!referer) return undefined;
  try {
    return new URL(referer).origin;
  } catch {
    return undefined;
  }
};

/**
 * CSRF guard for state-changing endpoints authenticated only by an ambient
 * cookie (the refresh cookie is SameSite=None in production, so browsers send
 * it cross-site). Browsers attach Origin to every cross-origin POST; Referer
 * is the fallback. A request must come from an allow-listed frontend origin —
 * an unknown, `null`, or missing source is rejected.
 */
export const requireTrustedOrigin = (allowedOrigins: readonly string[] = env.allowedOrigins) => {
  return (req: Request, _res: Response, next: NextFunction) => {
    const origin = req.get('origin');
    const source = origin !== undefined ? origin : refererOrigin(req.get('referer'));
    if (source && allowedOrigins.includes(source)) return next();
    next(ApiError.forbidden('Request origin not allowed'));
  };
};
