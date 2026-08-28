import * as oidc from 'openid-client';
import { UserModel } from './auth.model';
import { ApiError } from '../../common/utils/ApiError';
import {
  generateAccessToken,
  generateRefreshToken,
  hashToken,
} from '../../common/utils/jwt.utils';

const DEFAULT_ISSUER = 'https://id-backend.anands.dev';
const DEFAULT_REDIRECT_URI = 'http://localhost:5000/auth/callback';

export interface OidcTransaction {
  codeVerifier: string;
  nonce: string;
  redirectUri: string;
}

let configurationPromise: Promise<oidc.Configuration> | undefined;

function requiredEnv(name: 'OIDC_CLIENT_ID' | 'OIDC_CLIENT_SECRET'): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required for OIDC sign-in`);
  return value;
}

function getRedirectUri(): string {
  return process.env.OIDC_REDIRECT_URI?.trim() || DEFAULT_REDIRECT_URI;
}

async function getConfiguration(): Promise<oidc.Configuration> {
  if (!configurationPromise) {
    const issuer = new URL(process.env.OIDC_ISSUER?.trim() || DEFAULT_ISSUER);
    const clientId = requiredEnv('OIDC_CLIENT_ID');
    const clientSecret = requiredEnv('OIDC_CLIENT_SECRET');
    configurationPromise = oidc.discovery(
      issuer,
      clientId,
      { redirect_uris: [getRedirectUri()], response_types: ['code'] },
      oidc.ClientSecretBasic(clientSecret),
    );
  }
  return configurationPromise;
}

export class OidcService {
  static async createAuthorizationRequest() {
    const config = await getConfiguration();
    const codeVerifier = oidc.randomPKCECodeVerifier();
    const codeChallenge = await oidc.calculatePKCECodeChallenge(codeVerifier);
    const state = oidc.randomState();
    const nonce = oidc.randomNonce();
    const redirectUri = getRedirectUri();
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
    const claims = tokens.claims();

    // authorizationCodeGrant validates the RS256 signature using provider JWKS,
    // plus iss, aud, exp, iat, and nonce. Require the application identity claims too.
    if (!claims?.sub || typeof claims.email !== 'string' || claims.email_verified !== true) {
      throw ApiError.unauthorized('OIDC account is missing a verified email');
    }

    const name = typeof claims.name === 'string' && claims.name.trim()
      ? claims.name.trim()
      : claims.email.split('@')[0]!;
    let user = await UserModel.findOne({ sub: claims.sub });
    if (!user) user = await UserModel.findOne({ email: claims.email.toLowerCase() });

    if (!user) {
      user = await UserModel.create({
        sub: claims.sub,
        email: claims.email,
        name,
        isVerified: true,
        role: 'user',
      });
    } else {
      if (user.sub && user.sub !== claims.sub) {
        throw ApiError.conflict('This email is already linked to another identity');
      }
      user.sub = claims.sub;
      user.email = claims.email;
      user.name = name;
      user.isVerified = true;
      user.lastLogin = new Date();
    }

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
}
