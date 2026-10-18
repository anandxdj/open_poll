import type { Request, Response, NextFunction } from 'express';
import * as crypto from 'crypto';
import { AuthService } from './auth.service';
import { ApiResponse } from '../../common/utils/ApiResponse';
import { ApiError } from '../../common/utils/ApiError';
import { redisClient } from '../../common/config/redis';
import { env } from '../../common/config/env';
import type { AuthRequest } from './auth.middleware';
import { OidcService, type OidcTransaction } from './oidc.service';

const sessionCookieOptions = {
  httpOnly: true,
  secure: env.isProduction,
  sameSite: (env.isProduction ? 'none' : 'lax') as 'none' | 'lax',
  path: '/',
  maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
};

// One-time OAuth `state` binding. Path '/' so it reaches every registered
// callback (root /auth/callback, /api/auth/callback, /api/auth/google/callback);
// SameSite=Lax still sends it on the provider's top-level redirect back.
const oauthStateCookieOptions = {
  httpOnly: true,
  secure: env.isProduction,
  sameSite: 'lax' as const,
  path: '/',
  maxAge: 10 * 60 * 1000,
};

export const OIDC_STATE_COOKIE = 'oidc_state';
export const GOOGLE_STATE_COOKIE = 'google_oauth_state';

const oidcTransactionKey = (state: string) => `auth:oidc:${state}`;
const googleStateKey = (state: string) => `auth:google-state:${state}`;

/** Uniform responses: they must not reveal whether an account exists. */
export const AUTH_MESSAGES = {
  register: 'Check your email to finish signing up.',
  resendVerification: "If that account still needs verification, we've sent a new link.",
  forgotPassword: "If an account exists for that email, we've sent a password reset link.",
} as const;

/**
 * Codes the login page turns into copy. Browser-facing auth routes redirect
 * with one of these instead of rendering JSON or echoing provider errors.
 */
export type AuthErrorCode =
  | 'sso_unavailable'
  | 'sso_expired'
  | 'sso_failed'
  | 'google_unavailable'
  | 'google_failed'
  | 'oauth_failed';

const loginErrorUrl = (code: AuthErrorCode) => `${env.FRONTEND_URL}/login?error=${code}`;

const logAuthFailure = (flow: string, error: any) =>
  console.error(`${flow} failed:`, error?.code || error?.message || 'unknown error');

/** Constant-time string equality; false for missing or differently sized values. */
const safeEqual = (a: unknown, b: unknown) => {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  return bufA.length === bufB.length && crypto.timingSafeEqual(bufA, bufB);
};

/**
 * Never put the access token in a redirect URL (it would leak into logs,
 * history, and Referer headers). Park it behind a short-lived single-use
 * exchange code instead.
 */
const redirectWithExchangeCode = async (res: Response, accessToken: string, refreshToken: string) => {
  res.cookie('refreshToken', refreshToken, sessionCookieOptions);
  const exchangeCode = crypto.randomBytes(32).toString('hex');
  await redisClient.set(`auth:oauth-exchange:${exchangeCode}`, accessToken, { EX: 60 });
  return res.redirect(`${env.FRONTEND_URL}/auth/callback?code=${exchangeCode}`);
};

export class AuthController {
  /**
   * Shared registered callback (/api/auth/google/callback). The flow is picked
   * by which state cookie the returned `state` matches, so a callback can only
   * resume a flow this browser started; anything else is rejected.
   */
  static async externalOAuthCallback(req: Request, res: Response) {
    const state = req.query.state;
    if (safeEqual(state, req.cookies?.[OIDC_STATE_COOKIE])) {
      return AuthController.oidcCallback(req, res);
    }
    if (safeEqual(state, req.cookies?.[GOOGLE_STATE_COOKIE])) {
      return AuthController.googleCallback(req, res);
    }
    // Stale tab, replayed callback, or login CSRF.
    res.clearCookie(OIDC_STATE_COOKIE, oauthStateCookieOptions);
    res.clearCookie(GOOGLE_STATE_COOKIE, oauthStateCookieOptions);
    return res.redirect(loginErrorUrl('oauth_failed'));
  }

  static async oidcLogin(_req: Request, res: Response) {
    try {
      const { url, state, transaction } = await OidcService.createAuthorizationRequest();
      await redisClient.set(oidcTransactionKey(state), JSON.stringify(transaction), { EX: 600 });
      res.cookie(OIDC_STATE_COOKIE, state, oauthStateCookieOptions);
      return res.redirect(url.toString());
    } catch (error) {
      logAuthFailure('OIDC login', error);
      return res.redirect(loginErrorUrl('sso_unavailable'));
    }
  }

  static async oidcContinue(req: Request, res: Response) {
    try {
      const state = req.cookies?.[OIDC_STATE_COOKIE];
      const raw = typeof state === 'string' ? await redisClient.get(oidcTransactionKey(state)) : null;
      if (!state || !raw) return res.redirect(loginErrorUrl('sso_expired'));
      const url = await OidcService.resumeAuthorizationRequest(state, JSON.parse(raw) as OidcTransaction);
      return res.redirect(url.toString());
    } catch (error) {
      logAuthFailure('OIDC continue', error);
      return res.redirect(loginErrorUrl('sso_unavailable'));
    }
  }

  static async oidcCallback(req: Request, res: Response) {
    const state = typeof req.query.state === 'string' ? req.query.state : '';
    const cookieState = req.cookies?.[OIDC_STATE_COOKIE];

    try {
      if (!state || !safeEqual(state, cookieState)) {
        throw ApiError.unauthorized('Invalid OIDC state');
      }
      // Consuming the transaction before token exchange makes callbacks single-use,
      // including failed exchanges (wrong secret, PKCE, or redirect URI).
      const raw = await redisClient.getDel(oidcTransactionKey(state));
      res.clearCookie(OIDC_STATE_COOKIE, oauthStateCookieOptions);
      if (!raw) throw ApiError.unauthorized('OIDC sign-in has expired or was already used');
      const transaction = JSON.parse(raw) as OidcTransaction;
      const callbackUrl = new URL(transaction.redirectUri);
      for (const [key, value] of Object.entries(req.query)) {
        if (typeof value === 'string') callbackUrl.searchParams.set(key, value);
      }
      const { accessToken, refreshToken } = await OidcService.finishAuthorizationRequest(callbackUrl, state, transaction);
      return await redirectWithExchangeCode(res, accessToken, refreshToken);
    } catch (error) {
      res.clearCookie(OIDC_STATE_COOKIE, oauthStateCookieOptions);
      logAuthFailure('OIDC callback', error);
      return res.redirect(loginErrorUrl('sso_failed'));
    }
  }

  static async register(req: Request, res: Response, next: NextFunction) {
    try {
      await AuthService.register(req.body);
      return ApiResponse.created(res, AUTH_MESSAGES.register);
    } catch (error) {
      next(error);
    }
  }

  static async login(req: Request, res: Response, next: NextFunction) {
    try {
      const { user, accessToken, refreshToken } = await AuthService.login(req.body);

      // Set refresh token in httpOnly cookie
      res.cookie('refreshToken', refreshToken, sessionCookieOptions);

      return ApiResponse.ok(res, 'Login successful', { user, accessToken });
    } catch (error) {
      next(error);
    }
  }

  static async refreshToken(req: Request, res: Response, next: NextFunction) {
    try {
      const token = req.cookies?.refreshToken;
      const { accessToken } = await AuthService.refresh(token);
      return ApiResponse.ok(res, 'Token refreshed', { accessToken });
    } catch (error) {
      next(error);
    }
  }

  static async logout(req: Request, res: Response, next: NextFunction) {
    try {
      const token = req.cookies?.refreshToken;
      if (token) {
        await AuthService.logoutByToken(token);
      }

      res.clearCookie('refreshToken', sessionCookieOptions);
      return ApiResponse.ok(res, 'Logged out successfully');
    } catch (error) {
      next(error);
    }
  }

  static async resendVerification(req: Request, res: Response, next: NextFunction) {
    try {
      await AuthService.resendVerification(req.body.email);
      return ApiResponse.ok(res, AUTH_MESSAGES.resendVerification);
    } catch (error) {
      next(error);
    }
  }

  static async verifyEmail(req: Request, res: Response, next: NextFunction) {
    try {
      await AuthService.verifyEmail(req.params.token as string);
      return ApiResponse.ok(res, 'Email verified successfully');
    } catch (error) {
      next(error);
    }
  }

  static async forgotPassword(req: Request, res: Response, next: NextFunction) {
    try {
      await AuthService.forgotPassword(req.body.email);
      return ApiResponse.ok(res, AUTH_MESSAGES.forgotPassword);
    } catch (error) {
      next(error);
    }
  }

  static async resetPassword(req: Request, res: Response, next: NextFunction) {
    try {
      await AuthService.resetPassword(req.params.token as string, req.body.password);
      return ApiResponse.ok(res, 'Password reset successful');
    } catch (error) {
      next(error);
    }
  }

  static async me(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      if (!req.user) {
        return ApiResponse.ok(res, 'No active session', null);
      }
      const user = await AuthService.getMe(req.user.id);
      return ApiResponse.ok(res, 'User profile fetched', user);
    } catch (error) {
      next(error);
    }
  }

  static async googleLogin(_req: Request, res: Response) {
    try {
      // Login-CSRF protection: the callback must echo a state this browser holds.
      const state = crypto.randomBytes(32).toString('hex');
      const url = AuthService.getGoogleAuthUrl(state);
      await redisClient.set(googleStateKey(state), '1', { EX: 600 });
      res.cookie(GOOGLE_STATE_COOKIE, state, oauthStateCookieOptions);
      return res.redirect(url);
    } catch (error) {
      logAuthFailure('Google login', error);
      return res.redirect(loginErrorUrl('google_unavailable'));
    }
  }

  static async googleCallback(req: Request, res: Response) {
    const state = typeof req.query.state === 'string' ? req.query.state : '';
    const cookieState = req.cookies?.[GOOGLE_STATE_COOKIE];
    res.clearCookie(GOOGLE_STATE_COOKIE, oauthStateCookieOptions);

    try {
      if (!state || !safeEqual(state, cookieState)) {
        throw ApiError.unauthorized('Invalid Google OAuth state');
      }
      // Single-use: a replayed callback finds no entry.
      if (!(await redisClient.getDel(googleStateKey(state)))) {
        throw ApiError.unauthorized('Google sign-in has expired or was already used');
      }
      const { code } = req.query;
      if (typeof code !== 'string' || !code) {
        throw ApiError.unauthorized('Google did not return an authorization code');
      }

      const { accessToken, refreshToken } = await AuthService.handleGoogleCallback(code);
      return await redirectWithExchangeCode(res, accessToken, refreshToken);
    } catch (error) {
      logAuthFailure('Google callback', error);
      return res.redirect(loginErrorUrl('google_failed'));
    }
  }

  /** Exchanges a single-use OAuth callback code for the access token. */
  static async exchangeOAuthCode(req: Request, res: Response, next: NextFunction) {
    try {
      const { code } = req.body;
      if (!code || typeof code !== 'string' || !/^[a-f0-9]{64}$/.test(code)) {
        throw ApiError.badRequest('Invalid exchange code');
      }

      const key = `auth:oauth-exchange:${code}`;
      const accessToken = await redisClient.getDel(key);
      if (!accessToken) {
        throw ApiError.unauthorized('Exchange code expired or already used');
      }

      return ApiResponse.ok(res, 'Token exchanged', { accessToken });
    } catch (error) {
      next(error);
    }
  }
}
