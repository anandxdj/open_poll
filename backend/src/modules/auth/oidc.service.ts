import * as oidc from 'openid-client';
import { UserModel } from './auth.model';
import { ApiError } from '../../common/utils/ApiError';
import { env } from '../../common/config/env';
import { resetUnverifiedAccount } from './auth.service';
import {
  generateAccessToken,
  generateRefreshToken,
  hashToken,
} from '../../common/utils/jwt.utils';

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

    const accessToken = generateAccessToken({
      id: user._id,
      email: user.email,
      name: user.name,
      role: user.role,
    });
    const refreshToken = generateRefreshToken({ id: user._id });
    user.refreshToken = hashToken(refreshToken);
    await user.save();

    return { user, accessToken, refreshToken };
  }

  /**
   * Resolves the local account for validated ID-token claims: by `sub`, else by
   * email (linking), else a new user. Changes are saved by the caller.
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
    let user = await UserModel.findOne({ sub: claims.sub });
    if (!user) user = await UserModel.findOne({ email });

    if (!user) {
      return UserModel.create({
        sub: claims.sub,
        email,
        name,
        isVerified: true,
        role: 'user',
      });
    }

    if (user.sub && user.sub !== claims.sub) {
      throw ApiError.conflict('This email is already linked to another identity');
    }
    // Linking a verified local account is safe; an unverified one may have been
    // pre-registered by someone else, so it must not keep their password.
    if (!user.isVerified) resetUnverifiedAccount(user);
    user.sub = claims.sub;
    user.email = email;
    user.name = name;
    user.isVerified = true;
    user.lastLogin = new Date();
    return user;
  }
}
