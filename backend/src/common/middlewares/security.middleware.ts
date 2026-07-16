import type { NextFunction, Request, Response } from 'express';

/**
 * Baseline HTTP hardening without external dependencies (helmet-equivalent
 * subset). The API serves JSON only, so a restrictive CSP is safe.
 */
export const securityHeaders = (req: Request, res: Response, next: NextFunction) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-site');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  if (process.env.NODE_ENV === 'production') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  res.removeHeader('X-Powered-By');
  next();
};

/**
 * Strips Mongo operator injection from user input: removes any object key
 * starting with `$` or containing `.` anywhere in the JSON body/params/query.
 */
const sanitizeValue = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(sanitizeValue);
  if (value !== null && typeof value === 'object') {
    const clean: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value)) {
      if (key.startsWith('$') || key.includes('.')) continue;
      clean[key] = sanitizeValue(v);
    }
    return clean;
  }
  return value;
};

export const mongoSanitize = (req: Request, _res: Response, next: NextFunction) => {
  if (req.body && typeof req.body === 'object') {
    req.body = sanitizeValue(req.body);
  }
  // Express 5 exposes query/params via getters; sanitize values in place.
  for (const bag of [req.params, req.query] as Record<string, unknown>[]) {
    if (!bag || typeof bag !== 'object') continue;
    for (const [key, v] of Object.entries(bag)) {
      if (key.startsWith('$') || key.includes('.')) {
        delete bag[key];
      } else if (v !== null && typeof v === 'object') {
        bag[key] = sanitizeValue(v);
      }
    }
  }
  next();
};
