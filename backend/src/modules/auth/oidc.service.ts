import * as oidc from 'openid-client';
import { UserModel } from './auth.model';
import { ApiError } from '../../common/utils/ApiError';
import { env } from '../../common/config/env';
import { resetUnverifiedAccount, startSession } from './auth.service';
import { identityFilter, linkedIdentity, linkIdentity } from './identities';
import { assertSsoNotRequired } from '../sso/requireSso';

export interface OidcTransaction {
  codeVerifier: string;
  nonce: string;
  redirectUri: string;
}

/** The ID-token claims account linking relies on (validated by openid-client). */
export interface OidcIdentityClaims {
  sub?: string;
  email?: unknown;
  email_verified?: unknown;
  name?: unknown;
}

let configurationPromise: Promise<oidc.Configuration> | undefined;

function getOidcSettings() {
  if (!env.oidc) throw new Error('OIDC sign-in is not configured (set OIDC_CLIENT_ID and OIDC_CLIENT_SECRET)');
  return env.oidc;
}

async function getConfiguration(): Promise<oidc.Configuration> {
  if (!configurationPromise) {
    const { issuer, clientId, clientSecret, redirectUri } = getOidcSettings();
    configurationPromise = oidc.discovery(
      new URL(issuer),
      clientId,
      { redirect_uris: [redirectUri], response_types: ['code'] },
      oidc.ClientSecretBasic(clientSecret),
    ).catch((error) => {
      // Never cache a failed discovery: a transient IdP outage would otherwise
      // break SSO until the process restarts.
      configurationPromise = undefined;
      throw error;
    });
  }
  return configurationPromise;
}

/** Drops the cached discovery document so the next sign-in re-discovers (tests, config reloads). */
export function resetOidcConfiguration() {
  configurationPromise = undefined;
}

export class OidcService {
  static async createAuthorizationRequest() {
    const config = await getConfiguration();
    const codeVerifier = oidc.randomPKCECodeVerifier();
    const codeChallenge = await oidc.calculatePKCECodeChallenge(codeVerifier);
    const state = oidc.randomState();
    const nonce = oidc.randomNonce();
    const redirectUri = getOidcSettings().redirectUri;
    const url = oidc.buildAuthorizationUrl(config, {
      redirect_uri: redirectUri,
      scope: 'openid profile email',
      response_type: 'code',
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
      state,
      nonce,
    });

    return { url, state, transaction: { codeVerifier, nonce, redirectUri } satisfies OidcTransaction };
  }

  static async resumeAuthorizationRequest(state: string, transaction: OidcTransaction) {
    const config = await getConfiguration();
    const codeChallenge = await oidc.calculatePKCECodeChallenge(transaction.codeVerifier);
    return oidc.buildAuthorizationUrl(config, {
      redirect_uri: transaction.redirectUri,
      scope: 'openid profile email',
      response_type: 'code',
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
      state,
      nonce: transaction.nonce,
    });
  }

  static async finishAuthorizationRequest(callbackUrl: URL, expectedState: string, transaction: OidcTransaction) {
    const config = await getConfiguration();
    const tokens = await oidc.authorizationCodeGrant(config, callbackUrl, {
      pkceCodeVerifier: transaction.codeVerifier,
      expectedState,
      expectedNonce: transaction.nonce,
      idTokenExpected: true,
    });

    // authorizationCodeGrant validates the RS256 signature using provider JWKS,
    // plus iss, aud, exp, iat, and nonce.
    const user = await OidcService.findOrLinkUser(tokens.claims() ?? {});
    await assertSsoNotRequired(user);

    const { accessToken, refreshToken, restored } = await startSession(user);

    return { user, accessToken, refreshToken, restored };
  }

  /**
   * Resolves the local account for validated ID-token claims: by the `oidc`
   * identity, else by the legacy `sub` field (accounts linked before
   * identities[] existed), else by email (linking), else a new user. Changes
   * are saved by the caller.
   */
  static async findOrLinkUser(claims: OidcIdentityClaims) {
    // Require the application identity claims too.
    if (!claims.sub || typeof claims.email !== 'string' || claims.email_verified !== true) {
      throw ApiError.unauthorized('OIDC account is missing a verified email');
    }

    const email = claims.email.toLowerCase();
    const name = typeof claims.name === 'string' && claims.name.trim()
      ? claims.name.trim()
      : email.split('@')[0]!;
    const identity = { provider: 'oidc', subject: claims.sub } as const;
    let user = await UserModel.findOne(identityFilter(identity));
    if (!user) user = await UserModel.findOne({ sub: claims.sub });
    if (!user) user = await UserModel.findOne({ email });

    if (!user) {
      return UserModel.create({
        email,
        name,
        isVerified: true,
        role: 'user',
        identities: [identity],
      });
    }

    // Only an existing OIDC link can conflict. The legacy `sub` field is not
    // consulted here: Google sign-in used to write it too, so a mismatch there
    // says nothing about which OIDC subject owns the account.
    const linked = linkedIdentity(user, 'oidc');
    if (linked && linked.subject !== claims.sub) {
      throw ApiError.conflict('This email is already linked to another identity');
    }
    // Linking a verified local account is safe; an unverified one may have been
    // pre-registered by someone else, so it must not keep their password.
    if (!user.isVerified) resetUnverifiedAccount(user);
    linkIdentity(user, identity);
    user.email = email;
    user.name = name;
    user.isVerified = true;
    user.lastLogin = new Date();
    return user;
  }
}
