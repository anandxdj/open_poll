import type { NextFunction, Request, Response } from 'express';
import { httpRequestDuration } from './metrics';

/**
 * Times every HTTP request into `openpoll_http_request_duration_seconds`
 * {method, route, status_code}. `route` is the Express route pattern
 * (`/api/presentations/:id/answer`), so ids never reach a label; requests no
 * route matched share one `unmatched` label, so scanners cannot grow the series.
 * `/metrics` itself is not measured.
 *
 * Express resets `req.baseUrl` when an error leaves a router, so by the time the
 * error handler answers, `baseUrl + route.path` would lose its mount prefix.
 * The label is therefore taken at the moment the router assigns `req.route`,
 * while the prefix is still right.
 */
export const joinRoute = (baseUrl: string | undefined, path: unknown): string | null => {
  if (typeof path !== 'string') return null;
  const base = baseUrl ?? '';
  return `${base}${path === '/' && base ? '' : path}` || '/';
};

const isMetricsRequest = (url: string) =>
  url === '/metrics' || url.startsWith('/metrics?') || url.startsWith('/metrics/');

export const httpMetrics = (req: Request, res: Response, next: NextFunction) => {
  if (isMetricsRequest(req.originalUrl)) return next();

  let route: string | null = null;
  let current: unknown;
  Object.defineProperty(req, 'route', {
    configurable: true,
    enumerable: true,
    get: () => current,
    set: (value: { path?: unknown } | undefined) => {
      current = value;
      route = joinRoute(req.baseUrl, value?.path) ?? route;
    },
  });

  const started = process.hrtime.bigint();
  res.once('finish', () => {
    httpRequestDuration.observe(
      { method: req.method, route: route ?? 'unmatched', status_code: String(res.statusCode) },
      Number(process.hrtime.bigint() - started) / 1e9
    );
  });
  next();
};
