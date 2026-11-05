import cors from 'cors';
import { env } from '../config/env';
import { ApiError } from '../utils/ApiError';
import { isActiveDomainOrigin } from '../../modules/domains/domains.service';

/**
 * Credentialed CORS for the browser API. env.allowedOrigins already adds the
 * local dev frontends outside production; a workspace's active custom domain
 * (W4-E, Redis set `domains:active`) is allowed too. Requests without an
 * Origin (curl, Postman, server-side calls) pass; any other origin is rejected.
 */
export const corsMiddleware = cors({
  origin: (origin, callback) => {
    if (!origin || env.allowedOrigins.includes(origin)) return callback(null, true);
    isActiveDomainOrigin(origin).then(
      (allowed) => (allowed ? callback(null, true) : callback(ApiError.forbidden(`CORS: Origin ${origin} not allowed`))),
      () => callback(ApiError.forbidden(`CORS: Origin ${origin} not allowed`)),
    );
  },
  credentials: true,
});
