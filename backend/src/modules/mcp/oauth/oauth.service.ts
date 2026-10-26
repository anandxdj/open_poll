import * as crypto from 'crypto';
import type { Request } from 'express';
import type { OAuthRegisteredClientsStore } from '@modelcontextprotocol/sdk/server/auth/clients.js';
import type { AuthorizationParams } from '@modelcontextprotocol/sdk/server/auth/provider.js';
import type { OAuthClientInformationFull, OAuthTokens } from '@modelcontextprotocol/sdk/shared/auth.js';
import {
  InvalidClientError,
  InvalidClientMetadataError,
  InvalidGrantError,
  InvalidRequestError,
  InvalidScopeError,
  InvalidTargetError,
} from '@modelcontextprotocol/sdk/server/auth/errors.js';
import { env } from '../../../common/config/env';
import { redisClient } from '../../../common/config/redis';
import { ApiError } from '../../../common/utils/ApiError';
import { hashToken } from '../../../common/utils/jwt.utils';
import { hexEquals } from '../../../common/utils/signedId.utils';
import { resolveWorkspaceContext } from '../../../common/tenancy/workspaceContext.middleware';
import { UserModel } from '../../auth/auth.model';
import type { IWorkspace } from '../../workspaces/workspace.model';
import { isAccountUsable } from '../../auth/auth.service';
import {
  MCP_OAUTH_ACCESS_PREFIX,
  MCP_OAUTH_REFRESH_PREFIX,
  MCP_SCOPES,
  getMcpPublicUrl,
  type McpScope,
} from '../mcp.constants';
import { OAuthClientModel, type IOAuthClient } from './oauth.client.model';
import { McpGrantModel, type IMcpGrant } from './oauth.grant.model';

/**
 * The authorization server behind remote MCP connectors (OAuth 2.1 with PKCE
 * and dynamic client registration). Flow:
 *
 *   client ─/oauth/authorize─► startAuthorization (pending request in Redis)
 *          ─302─► frontend /oauth/consent?request=… (the user signs in, picks a
 *          workspace and scopes) ─► approveAuthorization (one-time code in Redis)
 *          ─302─► client redirect_uri?code=… ─/oauth/token─► exchangeAuthorizationCode
 *          (McpGrant with hashed access + refresh tokens) ─► /mcp with the access token.
 *
 * Tokens are opaque random strings stored as sha256 hashes, like PATs. Access
 * tokens live an hour; refresh tokens 30 days and rotate on every use.
 */

export const OAUTH_TTL = {
  /** A consent page left open longer than this has to start again. */
  requestSeconds: 10 * 60,
  codeSeconds: 5 * 60,
  accessSeconds: 60 * 60,
  refreshSeconds: 30 * 24 * 60 * 60,
  /** Registered clients nobody uses are removed after this long. */
  clientIdleDays: 90,
} as const;

/** Connected apps per user; approving one more drops the least recently used. */
export const MCP_MAX_GRANTS_PER_USER = 20;

const requestKey = (id: string) => `mcp:oauth:request:${id}`;
const codeKey = (code: string) => `mcp:oauth:code:${hashToken(code)}`;
const randomToken = (prefix = '') => `${prefix}${crypto.randomBytes(32).toString('base64url')}`;

/** What `/mcp` answers to: the resource indicator (RFC 8707) clients bind tokens to. */
export const mcpResourceUrl = (req?: Parameters<typeof getMcpPublicUrl>[0]) => `${getMcpPublicUrl(req)}/mcp`;

/** Where `/mcp` 401s point clients (RFC 9728 §5.1, WWW-Authenticate resource_metadata). */
export const protectedResourceMetadataUrl = (req?: Parameters<typeof getMcpPublicUrl>[0]) =>
  `${getMcpPublicUrl(req)}/.well-known/oauth-protected-resource/mcp`;

const sameResource = (a: string, b: string) => a.replace(/\/+$/, '') === b.replace(/\/+$/, '');

const isMcpPath = (raw: string) => {
  try {
    return new URL(raw).pathname.replace(/\/+$/, '') === '/mcp';
  } catch {
    return false;
  }
};

/** Requested scopes we know; none (or none known) means every scope, narrowed on the consent page. */
export function normalizeScopes(requested: readonly string[] | undefined): McpScope[] {
  const known = (requested ?? []).filter((scope): scope is McpScope => (MCP_SCOPES as readonly string[]).includes(scope));
  return known.length ? [...new Set(known)] : [...MCP_SCOPES];
}

// ---------------------------------------------------------------------------
// Clients (dynamic registration, RFC 7591)
// ---------------------------------------------------------------------------

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);

/**
 * https anywhere, http only on loopback (native apps), or an app's own
 * scheme (cursor://, vscode://). Never javascript:, data: or file:.
 */
export function isAllowedRedirectUri(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.hash) return false;
  if (url.protocol === 'https:') return true;
  if (url.protocol === 'http:') return LOOPBACK.has(url.hostname);
  return /^[a-z][a-z0-9+.-]*:$/.test(url.protocol) && !['javascript:', 'data:', 'file:', 'blob:', 'vbscript:', 'about:'].includes(url.protocol);
}

const clientExpiry = () => new Date(Date.now() + OAUTH_TTL.clientIdleDays * 24 * 60 * 60 * 1000);

const toClientInfo = (doc: IOAuthClient): OAuthClientInformationFull =>
  ({ ...doc.metadata, client_id: doc.clientId, client_id_issued_at: doc.clientIdIssuedAt }) as OAuthClientInformationFull;

export const clientNameOf = (client: { client_name?: unknown; metadata?: Record<string, unknown> }) => {
  const name = client.client_name ?? client.metadata?.client_name;
  return typeof name === 'string' && name.trim() ? name.trim().slice(0, 200) : 'Unnamed app';
};

export const oauthClientsStore: OAuthRegisteredClientsStore = {
  async getClient(clientId) {
    const doc = await OAuthClientModel.findOne({ clientId });
    return doc ? toClientInfo(doc) : undefined;
  },

  // The SDK handler validated the metadata and generated the id and secret;
  // the secret is returned to the client once and only its hash is kept.
  async registerClient(client) {
    const full = client as OAuthClientInformationFull;
    if (!full.redirect_uris.length || !full.redirect_uris.every((uri) => isAllowedRedirectUri(String(uri)))) {
      throw new InvalidClientMetadataError('redirect_uris must use https, a loopback http address, or an app scheme');
    }
    const { client_id, client_secret, client_id_issued_at, client_secret_expires_at: _expires, ...metadata } = full;
    await OAuthClientModel.create({
      clientId: client_id,
      clientSecretHash: client_secret ? hashToken(client_secret) : null,
      metadata,
      clientIdIssuedAt: client_id_issued_at ?? Math.floor(Date.now() / 1000),
      expiresAt: clientExpiry(),
    });
    return full;
  },
};

/** RFC 6749 §2.3: client_secret_post, client_secret_basic, or none for public clients. */
export async function authenticateClient(req: Request): Promise<IOAuthClient> {
  let clientId = typeof req.body?.client_id === 'string' ? req.body.client_id : undefined;
  let secret = typeof req.body?.client_secret === 'string' ? req.body.client_secret : undefined;
  const header = req.headers.authorization;
  if (header?.startsWith('Basic ')) {
    const decoded = Buffer.from(header.slice(6), 'base64').toString('utf8');
    const separator = decoded.indexOf(':');
    if (separator > 0) {
      clientId = decodeURIComponent(decoded.slice(0, separator));
      secret = decodeURIComponent(decoded.slice(separator + 1));
    }
  }
  if (!clientId) throw new InvalidClientError('client_id is required');

  const client = await OAuthClientModel.findOne({ clientId });
  if (!client) throw new InvalidClientError('Invalid client_id');
  if (client.clientSecretHash && (!secret || !hexEquals(hashToken(secret), client.clientSecretHash))) {
    throw new InvalidClientError('Invalid client credentials');
  }
  void OAuthClientModel.updateOne({ _id: client._id }, { expiresAt: clientExpiry() }).catch(() => {});
  return client;
}

// ---------------------------------------------------------------------------
// Authorization: pending request → consent → one-time code
// ---------------------------------------------------------------------------

export interface PendingAuthorization {
  clientId: string;
  clientName: string;
  redirectUri: string;
  codeChallenge: string;
  state?: string;
  scopes: McpScope[];
  resource: string;
  expiresAt: number;
}

interface AuthorizationCodeRecord {
  clientId: string;
  userId: string;
  workspaceId: string;
  scopes: McpScope[];
  codeChallenge: string;
  redirectUri: string;
  resource: string;
}

/**
 * Called by the SDK authorize handler once client_id and redirect_uri are
 * checked. Parks the request and sends the browser to the consent page.
 */
export async function startAuthorization(
  client: OAuthClientInformationFull,
  params: AuthorizationParams,
  req: Request,
): Promise<string> {
  const resource = mcpResourceUrl(req);
  if (params.resource && !sameResource(params.resource.href, resource)) {
    throw new InvalidTargetError(`This server only issues tokens for ${resource}`);
  }
  const id = randomToken();
  const pending: PendingAuthorization = {
    clientId: client.client_id,
    clientName: clientNameOf(client),
    redirectUri: params.redirectUri,
    codeChallenge: params.codeChallenge,
    ...(params.state ? { state: params.state } : {}),
    scopes: normalizeScopes(params.scopes),
    resource,
    expiresAt: Date.now() + OAUTH_TTL.requestSeconds * 1000,
  };
  await redisClient.setEx(requestKey(id), OAUTH_TTL.requestSeconds, JSON.stringify(pending));
  return `${env.FRONTEND_URL}/oauth/consent?request=${encodeURIComponent(id)}`;
}

const expiredRequest = () =>
  new ApiError(404, 'This connection request expired or was already answered. Start connecting again from your app.', 'OAUTH_REQUEST_EXPIRED');

export async function getPendingAuthorization(id: string): Promise<PendingAuthorization> {
  const raw = id.length <= 128 ? await redisClient.get(requestKey(id)) : null;
  if (!raw) throw expiredRequest();
  return JSON.parse(raw) as PendingAuthorization;
}

/** Answers the request at most once: whoever takes it from Redis first. */
async function takePendingAuthorization(id: string): Promise<PendingAuthorization> {
  const raw = await redisClient.getDel(requestKey(id));
  if (!raw) throw expiredRequest();
  return JSON.parse(raw) as PendingAuthorization;
}

function redirectWith(pending: PendingAuthorization, params: Record<string, string>) {
  const url = new URL(pending.redirectUri);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  if (pending.state) url.searchParams.set('state', pending.state);
  return url.href;
}

/**
 * The signed-in user approves: the client may act as them in `workspaceId`
 * (they must be an active member) with `scopes` (a subset of the request).
 * Returns where the browser goes next: the client's redirect_uri with a code.
 */
export async function approveAuthorization(
  id: string,
  userId: string,
  choice: { workspaceId: string; scopes: McpScope[] },
): Promise<{ redirectUrl: string; pending: PendingAuthorization; workspace: IWorkspace }> {
  const pending = await getPendingAuthorization(id);
  const scopes = [...new Set(choice.scopes)];
  if (!scopes.length || scopes.some((scope) => !pending.scopes.includes(scope))) {
    throw ApiError.badRequest('Choose at least one of the permissions the app asked for');
  }
  const { workspace } = await resolveWorkspaceContext(userId, choice.workspaceId);
  await takePendingAuthorization(id);

  const code = randomToken();
  const record: AuthorizationCodeRecord = {
    clientId: pending.clientId,
    userId,
    workspaceId: choice.workspaceId,
    scopes,
    codeChallenge: pending.codeChallenge,
    redirectUri: pending.redirectUri,
    resource: pending.resource,
  };
  await redisClient.setEx(codeKey(code), OAUTH_TTL.codeSeconds, JSON.stringify(record));
  return { redirectUrl: redirectWith(pending, { code }), pending, workspace };
}

export async function denyAuthorization(id: string): Promise<{ redirectUrl: string }> {
  const pending = await takePendingAuthorization(id);
  return {
    redirectUrl: redirectWith(pending, { error: 'access_denied', error_description: 'The user declined to connect Open Poll' }),
  };
}

// ---------------------------------------------------------------------------
// Tokens
// ---------------------------------------------------------------------------

/** PKCE S256 (RFC 7636): BASE64URL(SHA256(verifier)) equals the challenge. */
export function pkceMatches(verifier: string | undefined, challenge: string): boolean {
  if (!verifier || !/^[A-Za-z0-9\-._~]{43,128}$/.test(verifier)) return false;
  const computed = crypto.createHash('sha256').update(verifier).digest('base64url');
  return computed.length === challenge.length && crypto.timingSafeEqual(Buffer.from(computed), Buffer.from(challenge));
}

function newTokens() {
  const accessToken = randomToken(MCP_OAUTH_ACCESS_PREFIX);
  const refreshToken = randomToken(MCP_OAUTH_REFRESH_PREFIX);
  const now = Date.now();
  return {
    accessToken,
    refreshToken,
    hashes: {
      accessTokenHash: hashToken(accessToken),
      accessExpiresAt: new Date(now + OAUTH_TTL.accessSeconds * 1000),
      refreshTokenHash: hashToken(refreshToken),
      refreshExpiresAt: new Date(now + OAUTH_TTL.refreshSeconds * 1000),
    },
  };
}

const tokenResponse = (tokens: ReturnType<typeof newTokens>, scopes: readonly string[]): OAuthTokens => ({
  access_token: tokens.accessToken,
  token_type: 'Bearer',
  expires_in: OAUTH_TTL.accessSeconds,
  refresh_token: tokens.refreshToken,
  scope: scopes.join(' '),
});

/** The user is still usable and still an active member of the grant's workspace. */
async function assertStillAllowed(userId: string, workspaceId: string) {
  const user = await UserModel.findById(userId);
  if (!user || !isAccountUsable(user)) throw new InvalidGrantError('The user can no longer sign in');
  try {
    await resolveWorkspaceContext(userId, workspaceId);
  } catch {
    throw new InvalidGrantError('The user is no longer a member of this workspace');
  }
  return user;
}

export async function exchangeAuthorizationCode(
  client: IOAuthClient,
  input: { code: string; codeVerifier?: string; redirectUri?: string; resource?: string },
): Promise<OAuthTokens> {
  const raw = await redisClient.getDel(codeKey(input.code));
  if (!raw) throw new InvalidGrantError('Invalid or expired authorization code');
  const record = JSON.parse(raw) as AuthorizationCodeRecord;
  if (record.clientId !== client.clientId) throw new InvalidGrantError('The code was issued to another client');
  if (input.redirectUri !== undefined && input.redirectUri !== record.redirectUri) {
    throw new InvalidGrantError('redirect_uri does not match the authorization request');
  }
  if (!pkceMatches(input.codeVerifier, record.codeChallenge)) {
    throw new InvalidGrantError('code_verifier does not match the challenge');
  }
  if (input.resource && !sameResource(input.resource, record.resource)) {
    throw new InvalidTargetError(`This server only issues tokens for ${record.resource}`);
  }
  await assertStillAllowed(record.userId, record.workspaceId);

  // Reconnecting the same app to the same workspace replaces its grant.
  await McpGrantModel.deleteMany({ userId: record.userId, clientId: client.clientId, workspaceId: record.workspaceId });
  const tokens = newTokens();
  await McpGrantModel.create({
    userId: record.userId,
    workspaceId: record.workspaceId,
    clientId: client.clientId,
    clientName: clientNameOf(client),
    scopes: record.scopes,
    ...tokens.hashes,
    previousRefreshTokenHash: null,
    lastUsedAt: new Date(),
  });

  const surplus = await McpGrantModel.find({ userId: record.userId })
    .sort({ lastUsedAt: -1, createdAt: -1 })
    .skip(MCP_MAX_GRANTS_PER_USER)
    .select('_id');
  if (surplus.length) await McpGrantModel.deleteMany({ _id: { $in: surplus.map((grant) => grant._id) } });

  return tokenResponse(tokens, record.scopes);
}

export async function exchangeRefreshToken(
  client: IOAuthClient,
  input: { refreshToken: string; scopes?: string[]; resource?: string },
): Promise<OAuthTokens> {
  const hash = hashToken(input.refreshToken);
  const grant = await McpGrantModel.findOne({ refreshTokenHash: hash });
  if (!grant) {
    // A rotated-out token coming back means it leaked: end the whole grant.
    await McpGrantModel.deleteOne({ previousRefreshTokenHash: hash });
    throw new InvalidGrantError('Invalid refresh token');
  }
  if (grant.clientId !== client.clientId) throw new InvalidGrantError('The refresh token was issued to another client');
  if (grant.refreshExpiresAt.getTime() <= Date.now()) {
    await grant.deleteOne();
    throw new InvalidGrantError('The refresh token expired; connect again');
  }
  // The grant was bound to this server's /mcp at approval; a refresh may only name the same path.
  if (input.resource && !isMcpPath(input.resource)) {
    throw new InvalidTargetError('This server only issues tokens for its /mcp endpoint');
  }
  let scopes = grant.scopes;
  if (input.scopes?.length) {
    if (input.scopes.some((scope) => !grant.scopes.includes(scope as McpScope))) {
      throw new InvalidScopeError('A refresh cannot add scopes the user did not approve');
    }
    scopes = input.scopes as McpScope[];
  }
  await assertStillAllowed(String(grant.userId), String(grant.workspaceId));

  const tokens = newTokens();
  const rotated = await McpGrantModel.findOneAndUpdate(
    { _id: grant._id, refreshTokenHash: hash },
    { $set: { ...tokens.hashes, previousRefreshTokenHash: hash, scopes, lastUsedAt: new Date() } },
    { returnDocument: 'after' },
  );
  if (!rotated) throw new InvalidGrantError('Invalid refresh token');
  return tokenResponse(tokens, scopes);
}

export interface VerifiedAccessToken {
  grantId: string;
  workspaceId: string;
  clientId: string;
  scopes: McpScope[];
  user: { id: string; email: string; name: string; role: string };
}

/** `/mcp` bearer check for connector tokens. */
export async function verifyAccessToken(rawToken: string): Promise<VerifiedAccessToken> {
  if (!rawToken.startsWith(MCP_OAUTH_ACCESS_PREFIX)) throw ApiError.unauthorized('Invalid MCP token');
  const grant = await McpGrantModel.findOne({ accessTokenHash: hashToken(rawToken) });
  if (!grant) throw ApiError.unauthorized('Invalid MCP token');
  if (grant.accessExpiresAt.getTime() <= Date.now()) throw ApiError.unauthorized('MCP token expired');

  const user = await UserModel.findById(grant.userId);
  if (!user || !isAccountUsable(user)) throw ApiError.unauthorized('User no longer exists');

  // At most one write every five minutes per grant.
  if (!grant.lastUsedAt || Date.now() - grant.lastUsedAt.getTime() > 5 * 60 * 1000) {
    void McpGrantModel.updateOne({ _id: grant._id }, { lastUsedAt: new Date() }).catch(() => {});
  }
  return {
    grantId: String(grant._id),
    workspaceId: String(grant.workspaceId),
    clientId: grant.clientId,
    scopes: grant.scopes,
    user: { id: String(user._id), email: user.email, name: user.name, role: user.role },
  };
}

/** RFC 7009: revoking either token of a grant ends the grant. Unknown tokens are not an error. */
export async function revokeToken(client: IOAuthClient, token: string): Promise<void> {
  const hash = hashToken(token);
  await McpGrantModel.deleteOne({
    clientId: client.clientId,
    $or: [{ accessTokenHash: hash }, { refreshTokenHash: hash }],
  });
}

// ---------------------------------------------------------------------------
// Connected apps (settings)
// ---------------------------------------------------------------------------

export const toGrantView = (grant: IMcpGrant, workspaceNames: Map<string, string>) => ({
  id: String(grant._id),
  clientName: grant.clientName,
  workspace: { id: String(grant.workspaceId), name: workspaceNames.get(String(grant.workspaceId)) ?? null },
  scopes: grant.scopes,
  createdAt: grant.createdAt,
  lastUsedAt: grant.lastUsedAt ?? null,
});

export function assertTokenRequestParam(value: unknown, name: string): string {
  if (typeof value !== 'string' || !value) throw new InvalidRequestError(`${name} is required`);
  return value;
}
