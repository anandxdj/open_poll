import express, { type Express } from 'express';
import cookieParser from 'cookie-parser';
import { corsMiddleware } from '../common/middlewares/cors';
import { errorHandler } from '../common/middlewares/errorHandler';
import { mongoSanitize, securityHeaders } from '../common/middlewares/security.middleware';
import { LARGE_JSON_PATHS, mountPreParserRoutes, mountRoutes } from './routes';

/**
 * Builds the Express app. It opens no connection, starts no worker and does
 * not listen, so tests can serve it on port 0; app.ts owns the boot order.
 *
 * Order: security headers → pre-parser mounts (webhook, SAML ACS, SCIM,
 * metrics) → CORS → JSON (1mb for decks, 100kb elsewhere) → cookies →
 * mongoSanitize → routes → error handler. Unmatched requests fall through to
 * Express's default 404.
 */
export function createApp(): Express {
  const app = express();
  app.set('trust proxy', 1);

  app.use(securityHeaders);
  mountPreParserRoutes(app);
  app.use(corsMiddleware);
  // A body parsed by the first parser is skipped by the second.
  app.use(LARGE_JSON_PATHS, express.json({ limit: '1mb' }));
  app.use(express.json({ limit: '100kb' }));
  app.use(cookieParser());
  app.use(mongoSanitize);

  mountRoutes(app);
  app.use(errorHandler);

  return app;
}
