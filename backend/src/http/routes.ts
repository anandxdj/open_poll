import express, { type Express, type Router } from 'express';
import mongoose from 'mongoose';
import { redisClient } from '../common/config/redis';
import aiRouter from '../modules/ai/ai.route';
import auditRouter from '../modules/audit/audit.route';
import authRouter, { oidcCallbackHandlers } from '../modules/auth/auth.route';
import billingRouter, { billingWebhookRouter, plansRouter } from '../modules/billing/billing.route';
import capabilitiesRouter from '../modules/capabilities/capabilities.route';
import domainsRouter, { publicDomainsRouter } from '../modules/domains/domains.route';
import embedsRouter, { oembedRouter } from '../modules/embeds/embeds.route';
import foldersRouter from '../modules/folders/folders.route';
import importsRouter from '../modules/imports/imports.route';
import insightsRouter from '../modules/insights/insights.route';
import libraryRouter from '../modules/library/library.route';
import mcpRouter from '../modules/mcp/mcp.route';
import mcpSettingsRouter from '../modules/mcp/mcp.settings.route';
import metricsRouter from '../modules/metrics/metrics.route';
import pollsRouter from '../modules/polls/polls.route';
import presentationsRouter from '../modules/presentations/presentations.route';
import privacyRouter from '../modules/privacy/privacy.route';
import qnaRouter, { qnaHostRouter } from '../modules/qna/qna.route';
import remoteRouter from '../modules/remote/remote.route';
import responsesRouter from '../modules/responses/responses.route';
import scimRouter, { scimAdminRouter } from '../modules/scim/scim.route';
import sessionsRouter, { publicResultsRouter } from '../modules/sessions/sessions.route';
import ssoRouter, { samlAcsRouter, ssoAdminRouter } from '../modules/sso/sso.route';
import templatesRouter from '../modules/templates/templates.route';
import themesRouter, { brandKitsRouter } from '../modules/themes/themes.route';
import uploadsRouter from '../modules/uploads/uploads.route';
import workspaceInvitesRouter, { invitesRouter } from '../modules/workspaces/invites.route';
import membersRouter from '../modules/workspaces/members.route';
import sharesRouter from '../modules/workspaces/sharing.route';
import workspacesRouter from '../modules/workspaces/workspaces.route';

type Mount = readonly [path: string, router: Router];

/**
 * Mounted by createApp() after CORS, the JSON parsers, cookieParser and
 * mongoSanitize. Express tries mounts in order, so:
 * - a path nested under another module's mount comes first, ahead of the
 *   router that owns the parent path;
 * - the modules that predate this table keep their original order;
 * - everything else is alphabetical by path, one line per entry.
 * A new module fills its router file; it only adds a line here for a path
 * this table does not cover yet.
 */
const MOUNTS: readonly Mount[] = [
  ['/api/presentations/:presentationId/host/qna', qnaHostRouter],
  ['/api/presentations/:presentationId/qna', qnaRouter],
  ['/api/workspaces/:workspaceId/domains', domainsRouter],
  ['/api/workspaces/:workspaceId/invites', workspaceInvitesRouter],
  ['/api/workspaces/:workspaceId/members', membersRouter],
  ['/api/workspaces/:workspaceId/scim', scimAdminRouter],
  ['/api/workspaces/:workspaceId/sso', ssoAdminRouter],

  ['/api/auth', authRouter],
  ['/api/polls', pollsRouter],
  ['/api/responses', responsesRouter],
  ['/api/ai', aiRouter],
  ['/api/presentations', presentationsRouter],
  ['/api/quizzes', presentationsRouter], // Legacy alias spoken by older clients.
  ['/api/mcp', mcpSettingsRouter],
  ['/mcp', mcpRouter],

  ['/api/audit', auditRouter],
  ['/api/billing', billingRouter],
  ['/api/brand-kits', brandKitsRouter],
  ['/api/capabilities', capabilitiesRouter],
  ['/api/embeds', embedsRouter],
  ['/api/folders', foldersRouter],
  ['/api/imports', importsRouter],
  ['/api/insights', insightsRouter],
  ['/api/invites', invitesRouter],
  ['/api/library', libraryRouter],
  ['/api/me', privacyRouter],
  ['/api/oembed', oembedRouter],
  ['/api/plans', plansRouter],
  ['/api/public/domains', publicDomainsRouter],
  ['/api/public/results', publicResultsRouter],
  ['/api/remote', remoteRouter],
  ['/api/sessions', sessionsRouter],
  ['/api/shares', sharesRouter],
  ['/api/sso', ssoRouter],
  ['/api/templates', templatesRouter],
  ['/api/themes', themesRouter],
  ['/api/uploads', uploadsRouter],
  ['/api/workspaces', workspacesRouter],
];

/** Request paths whose JSON bodies may reach 1mb: a deck is saved with every slide in one body. */
export const LARGE_JSON_PATHS = ['/api/presentations', '/api/quizzes'];

/**
 * Endpoints that machines call or an IdP posts to. createApp() mounts them
 * before CORS, the global JSON parser and mongoSanitize, each with its own
 * body parser:
 * - Stripe signs the raw bytes, so the webhook needs the unparsed Buffer.
 * - The SAML ACS receives a cross-origin form post from the IdP, whose Origin
 *   the CORS allow-list would reject.
 * - SCIM sends `application/scim+json` with `urn:...:2.0:User` keys that
 *   mongoSanitize would strip for containing dots.
 * - Prometheus scrapes /metrics with a bearer token and no browser context.
 */
export function mountPreParserRoutes(app: Express): void {
  app.use('/api/billing/webhook', express.raw({ type: 'application/json', limit: '1mb' }), billingWebhookRouter);
  app.use(
    '/api/sso/saml/:connectionId/acs',
    express.urlencoded({ extended: false, limit: '1mb' }),
    samlAcsRouter,
  );
  app.use(
    '/scim/v2',
    express.json({ type: ['application/json', 'application/scim+json'], limit: '1mb' }),
    scimRouter,
  );
  app.use('/metrics', metricsRouter);
}

/** System routes, the root OIDC callback and the mount table. */
export function mountRoutes(app: Express): void {
  app.get('/health', (req, res) => {
    res.status(200).json({ status: 'OK', message: 'AI Poll Platform is running 🥟' });
  });

  app.get('/ready', (req, res) => {
    const mongoReady = mongoose.connection.readyState === 1;
    const redisReady = redisClient.isOpen;

    if (!mongoReady || !redisReady) {
      return res.status(503).json({
        status: 'NOT_READY',
        services: { mongodb: mongoReady, redis: redisReady },
      });
    }

    return res.status(200).json({
      status: 'READY',
      services: { mongodb: mongoReady, redis: redisReady },
    });
  });

  // Registered OIDC redirect URI. Token exchange and ID-token validation happen
  // here before the browser is sent back to the frontend.
  app.get('/auth/callback', ...oidcCallbackHandlers);

  for (const [path, router] of MOUNTS) app.use(path, router);
}
