import cors from 'cors';
import { env } from '../config/env';
import { ApiError } from '../utils/ApiError';

/**
 * Credentialed CORS for the browser API. env.allowedOrigins already adds the
 * local dev frontends outside production. Requests without an Origin (curl,
 * Postman, server-side calls) pass; any other origin is rejected.
 */
export const corsMiddleware = cors({
  origin: (origin, callback) => {
    if (!origin || env.allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(ApiError.forbidden(`CORS: Origin ${origin} not allowed`));
    }
  },
  credentials: true,
});
