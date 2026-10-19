import { timingSafeEqual, createHash } from 'node:crypto';
import { Router, type NextFunction, type Request, type Response } from 'express';
import { env } from '../../common/config/env';
import { rateLimit } from '../../common/middlewares/rateLimit.middleware';
import { renderMetrics } from '../../common/observability/metrics';

/**
 * `GET /metrics` — Prometheus exposition, mounted by `src/http/routes.ts` ahead
 * of CORS and the body parsers (scrapers send no browser context).
 *
 * Never open: without `METRICS_TOKEN` the endpoint does not exist (404, and
 * `GET /api/capabilities` reports `metrics: false`); with it, every request
 * needs `Authorization: Bearer <token>`, compared in constant time. The token
 * is read per request from `env`, so tests and rotations need no re-mount.
 */
const router = Router();

const digest = (value: string) => createHash('sha256').update(value).digest();

export const hasValidMetricsToken = (req: Pick<Request, 'headers'>, token: string): boolean => {
  const header = req.headers.authorization;
  if (typeof header !== 'string' || !header.startsWith('Bearer ')) return false;
  return timingSafeEqual(digest(header.slice('Bearer '.length).trim()), digest(token));
};

const requireMetricsToken = (req: Request, res: Response, next: NextFunction) => {
  const token = env.metricsToken;
  if (!token) {
    res.status(404).json({ success: false, message: 'Not found' });
    return;
  }
  if (!hasValidMetricsToken(req, token)) {
    res.setHeader('WWW-Authenticate', 'Bearer realm="metrics"');
    res.status(401).json({ success: false, message: 'A valid metrics token is required' });
    return;
  }
  next();
};

// A scraper polls every few seconds; the limit stops token guessing, not scraping.
router.get(
  '/',
  rateLimit({ prefix: 'metrics', windowSec: 60, max: 120 }),
  requireMetricsToken,
  async (_req, res, next) => {
    try {
      const { contentType, body } = await renderMetrics();
      res.setHeader('Content-Type', contentType);
      res.setHeader('Cache-Control', 'no-store');
      res.status(200).send(body);
    } catch (error) {
      next(error);
    }
  }
);

export default router;
