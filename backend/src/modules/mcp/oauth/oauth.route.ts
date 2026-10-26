import express, { Router, type Request, type Response } from 'express';
import cors from 'cors';
import { authorizationHandler } from '@modelcontextprotocol/sdk/server/auth/handlers/authorize.js';
import { clientRegistrationHandler } from '@modelcontextprotocol/sdk/server/auth/handlers/register.js';
import type { OAuthServerProvider } from '@modelcontextprotocol/sdk/server/auth/provider.js';
import {
  InvalidClientError,
  OAuthError,
  ServerError,
  UnsupportedGrantTypeError,
} from '@modelcontextprotocol/sdk/server/auth/errors.js';
import { env } from '../../../common/config/env';
import { rateLimit } from '../../../common/middlewares/rateLimit.middleware';
import { MCP_SCOPES, getMcpPublicUrl } from '../mcp.constants';
import {
  assertTokenRequestParam,
  authenticateClient,
  exchangeAuthorizationCode,
  exchangeRefreshToken,
  mcpResourceUrl,
  oauthClientsStore,
  revokeToken,
  startAuthorization,
} from './oauth.service';

/**
 * Public OAuth 2.1 endpoints for remote MCP connectors. Mounted before the
 * credentialed CORS allow-list (createApp → mountPreParserRoutes): Claude,
 * ChatGPT and browser-based MCP clients call them from origins we do not
 * know, and none of them reads a cookie, so any origin may call them.
 *
 * - RFC 8414 authorization server metadata, RFC 9728 protected resource metadata
 * - /oauth/authorize and /oauth/register: the SDK handlers (redirect URI checks,
 *   client metadata validation) on our client store
 * - /oauth/token and /oauth/revoke: ours, because client secrets are stored
 *   hashed and the SDK's client check compares them in plain text
 */

const SUPPORTED_AUTH_METHODS = ['none', 'client_secret_post', 'client_secret_basic'];

export function authorizationServerMetadata(req: Request) {
  const base = getMcpPublicUrl(req);
  return {
    issuer: base,
    authorization_endpoint: `${base}/oauth/authorize`,
    token_endpoint: `${base}/oauth/token`,
    registration_endpoint: `${base}/oauth/register`,
    revocation_endpoint: `${base}/oauth/revoke`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: SUPPORTED_AUTH_METHODS,
    revocation_endpoint_auth_methods_supported: SUPPORTED_AUTH_METHODS,
    scopes_supported: [...MCP_SCOPES],
    service_documentation: `${env.FRONTEND_URL}/settings/mcp`,
  };
}

export function protectedResourceMetadata(req: Request) {
  return {
    resource: mcpResourceUrl(req),
    authorization_servers: [getMcpPublicUrl(req)],
    scopes_supported: [...MCP_SCOPES],
    bearer_methods_supported: ['header'],
    resource_name: 'Open Poll',
    resource_documentation: `${env.FRONTEND_URL}/settings/mcp`,
  };
}

const oauthLimit = (prefix: string, windowSec: number, max: number, keyBy: 'ip' | ((req: Request) => string | undefined) = 'ip') =>
  rateLimit({ prefix, windowSec, max, keyBy, onStoreError: 'memory' });

/**
 * Token and revocation calls come from the connector's servers (Claude's,
 * ChatGPT's), one IP for all of their users, so they are limited per client
 * and address: per address alone would throttle all users of a connector
 * together, per client alone would let anyone who learns a client id use up
 * its window. The body is parsed before the limiter for that.
 */
const perClient = (req: Request): string | undefined => {
  let clientId = typeof req.body?.client_id === 'string' ? req.body.client_id : undefined;
  const header = req.headers.authorization;
  if (!clientId && header?.startsWith('Basic ')) {
    const decoded = Buffer.from(header.slice(6), 'base64').toString('utf8');
    const separator = decoded.indexOf(':');
    if (separator > 0) clientId = decodeURIComponent(decoded.slice(0, separator));
  }
  return clientId ? `client:${clientId}:${req.ip}` : undefined;
};

function sendOAuthError(res: Response, error: unknown) {
  if (error instanceof OAuthError) {
    res.status(error instanceof InvalidClientError ? 401 : error instanceof ServerError ? 500 : 400).json(error.toResponseObject());
    return;
  }
  console.error('[McpOAuth] token endpoint error:', error);
  res.status(500).json(new ServerError('Internal Server Error').toResponseObject());
}

const noStore = (_req: Request, res: Response, next: () => void) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Pragma', 'no-cache');
  next();
};

/**
 * The SDK authorize handler only uses `clientsStore` and `authorize`; tokens
 * go through our own endpoint below.
 */
const authorizeProvider = {
  clientsStore: oauthClientsStore,
  async authorize(client, params, res) {
    res.redirect(302, await startAuthorization(client, params, res.req));
  },
} as Pick<OAuthServerProvider, 'clientsStore' | 'authorize'> as OAuthServerProvider;

const anyOrigin = cors();

/** Mounted at `/.well-known`. */
export const wellKnownRouter = Router();

wellKnownRouter.get('/oauth-authorization-server', anyOrigin, (req, res) => {
  res.json(authorizationServerMetadata(req));
});

wellKnownRouter.get(['/oauth-protected-resource', '/oauth-protected-resource/mcp'], anyOrigin, (req, res) => {
  res.json(protectedResourceMetadata(req));
});

/** Mounted at `/oauth`. */
const router = Router();

router.use(
  '/authorize',
  oauthLimit('mcp-oauth-authorize', 60, 60),
  authorizationHandler({ provider: authorizeProvider, rateLimit: false }),
);

router.use(
  '/register',
  // Hosted connectors register from shared server IPs, one client per user that connects.
  oauthLimit('mcp-oauth-register', 60 * 60, 300),
  // Secrets of confidential clients never expire: a connector that registered
  // once keeps working until it stops being used (the client TTL).
  clientRegistrationHandler({ clientsStore: oauthClientsStore, clientSecretExpirySeconds: 0, rateLimit: false }),
);

router.use(['/token', '/revoke'], anyOrigin);

router.post(
  '/token',
  noStore,
  express.urlencoded({ extended: false }),
  oauthLimit('mcp-oauth-token', 60, 120, perClient),
  async (req, res) => {
    try {
      const client = await authenticateClient(req);
      const body = req.body ?? {};
      const resource = typeof body.resource === 'string' ? body.resource : undefined;
      if (body.grant_type === 'authorization_code') {
        res.json(
          await exchangeAuthorizationCode(client, {
            code: assertTokenRequestParam(body.code, 'code'),
            codeVerifier: typeof body.code_verifier === 'string' ? body.code_verifier : undefined,
            redirectUri: typeof body.redirect_uri === 'string' ? body.redirect_uri : undefined,
            resource,
          }),
        );
        return;
      }
      if (body.grant_type === 'refresh_token') {
        res.json(
          await exchangeRefreshToken(client, {
            refreshToken: assertTokenRequestParam(body.refresh_token, 'refresh_token'),
            scopes: typeof body.scope === 'string' ? body.scope.split(' ').filter(Boolean) : undefined,
            resource,
          }),
        );
        return;
      }
      throw new UnsupportedGrantTypeError('Use authorization_code or refresh_token');
    } catch (error) {
      sendOAuthError(res, error);
    }
  },
);

router.post(
  '/revoke',
  noStore,
  express.urlencoded({ extended: false }),
  oauthLimit('mcp-oauth-revoke', 60, 120, perClient),
  async (req, res) => {
    try {
      const client = await authenticateClient(req);
      await revokeToken(client, assertTokenRequestParam(req.body?.token, 'token'));
      res.status(200).end();
    } catch (error) {
      sendOAuthError(res, error);
    }
  },
);

export default router;
