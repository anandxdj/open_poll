import type { NextFunction, Request, Response } from 'express';
import { httpRequestDuration } from './metrics';

/**
 * Times every HTTP request into `openpoll_http_request_duration_seconds`
 * {method, route, status_code}. `route` is the Express route pattern
 * (`/api/presentations/:id/answer`), so ids never reach a label; requests no
 * route matched share one `unmatched` label, so scanners cannot grow the series.
 * `/metrics` itself is not measured.
 */
export const routeLabel = (req: Pick<Request, 'baseUrl' | 'route'>): string => {
  const path = req.route?.path;
  if (typeof path !== 'string') return 'unmatched';
  return `${req.baseUrl ?? ''}${path === '/' && req.baseUrl ? '' : path}` || '/';
};

export const httpMetrics = (req: Request, res: Response, next: NextFunction) => {
  if (req.originalUrl === '/metrics' || req.originalUrl.startsWith('/metrics?') || req.originalUrl.startsWith('/metrics/')) return next();
  const started = process.hrtime.bigint();
  res.once('finish', () => {
    httpRequestDuration.observe(
      { method: req.method, route: routeLabel(req), status_code: String(res.statusCode) },
      Number(process.hrtime.bigint() - started) / 1e9
    );
  });
  next();
};
