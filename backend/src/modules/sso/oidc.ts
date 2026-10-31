import * as oidc from 'openid-client';
import { decryptSecret } from '../../common/utils/crypto';
import type { ISsoConnection } from './ssoConnection.model';
import { ssoUrls } from './sso.urls';

/**
 * Per-workspace OIDC (W3-D): each connection has its own issuer and client.
 * Discovery documents are cached per connection and issuer, and dropped on
 * failure so a passing outage does not stick.
 */

const configurations = new Map<string, Promise<oidc.Configuration>>();

/** Discovery for a connection; tests swap it with `setOidcDiscovery`. */
let discover = (issuer: URL, clientId: string, metadata: Partial<oidc.ClientMetadata>, auth: oidc.ClientAuth) =>
  oidc.discovery(issuer, clientId, metadata, auth);

export const setOidcDiscovery = (fn: typeof discover) => {
  discover = fn;
  configurations.clear();
};

export const oidcSecretContext = (connectionId: string) => `sso:${connectionId}`;

export function oidcConfiguration(connection: Pick<ISsoConnection, '_id' | 'oidc' | 'updatedAt'>): Promise<oidc.Configuration> {
  const settings = connection.oidc;
  if (!settings) throw new Error('Not an OIDC connection');
  const id = String(connection._id);
  const cacheKey = `${id}:${settings.issuer}:${settings.clientId}:${connection.updatedAt?.getTime() ?? 0}`;
  let pending = configurations.get(cacheKey);
  if (!pending) {
    const secret = decryptSecret(settings.clientSecretEnc, oidcSecretContext(id));
    pending = discover(
      new URL(settings.issuer),
      settings.clientId,
      { redirect_uris: [ssoUrls(id).oidcRedirectUri], response_types: ['code'] },
      oidc.ClientSecretBasic(secret),
    ).catch((error) => {
      configurations.delete(cacheKey);
      throw error;
    });
    configurations.set(cacheKey, pending);
  }
  return pending;
}

export interface OidcStart {
  url: URL;
  state: string;
  codeVerifier: string;
  nonce: string;
}

export async function startOidcLogin(connection: Pick<ISsoConnection, '_id' | 'oidc' | 'updatedAt'>, loginHint?: string): Promise<OidcStart> {
  const config = await oidcConfiguration(connection);
  const codeVerifier = oidc.randomPKCECodeVerifier();
  const state = oidc.randomState();
  const nonce = oidc.randomNonce();
  const url = oidc.buildAuthorizationUrl(config, {
    redirect_uri: ssoUrls(String(connection._id)).oidcRedirectUri,
    scope: 'openid profile email',
    response_type: 'code',
    code_challenge: await oidc.calculatePKCECodeChallenge(codeVerifier),
    code_challenge_method: 'S256',
    state,
    nonce,
    ...(loginHint ? { login_hint: loginHint } : {}),
  });
  return { url, state, codeVerifier, nonce };
}

export interface OidcIdentity {
  subject: string;
  email: string;
  name: string;
  groups: string[];
}

/** Exchanges the code (PKCE, state, nonce checked by openid-client) and reads the person from the ID token. */
export async function finishOidcLogin(
  connection: Pick<ISsoConnection, '_id' | 'oidc' | 'updatedAt'>,
  callbackUrl: URL,
  expected: { state: string; codeVerifier: string; nonce: string },
): Promise<OidcIdentity> {
  const config = await oidcConfiguration(connection);
  const tokens = await oidc.authorizationCodeGrant(config, callbackUrl, {
    pkceCodeVerifier: expected.codeVerifier,
    expectedState: expected.state,
    expectedNonce: expected.nonce,
    idTokenExpected: true,
  });
  const claims = (tokens.claims() ?? {}) as Record<string, unknown>;
  const email = typeof claims.email === 'string' ? claims.email.trim().toLowerCase() : '';
  if (!claims.sub || !email || claims.email_verified === false) throw new Error('The identity provider sent no verified email');
  const name = typeof claims.name === 'string' && claims.name.trim() ? claims.name.trim() : email.split('@')[0]!;
  const groups = Array.isArray(claims.groups) ? claims.groups.filter((g: unknown): g is string => typeof g === 'string') : [];
  return { subject: String(claims.sub), email, name, groups };
}
