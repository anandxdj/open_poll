import type { Request, Response, NextFunction } from 'express';
import * as crypto from 'crypto';
import { AuthService } from './auth.service';
import { ApiResponse } from '../../common/utils/ApiResponse';
import { ApiError } from '../../common/utils/ApiError';
import { redisClient } from '../../common/config/redis';
import type { AuthRequest } from './auth.middleware';

const isProduction = process.env.NODE_ENV === 'production';

const sessionCookieOptions = {
  httpOnly: true,
  secure: isProduction,
  sameSite: (isProduction ? 'none' : 'lax') as 'none' | 'lax',
  path: '/',
  maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
};

export class AuthController {
  static async register(req: Request, res: Response, next: NextFunction) {
    try {
      const user = await AuthService.register(req.body);
      return ApiResponse.created(res, 'Registration successful. Please verify your email.', user);
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
      const { email } = req.body;
      if (!email) {
        throw ApiError.badRequest('Email is required');
      }
      await AuthService.resendVerification(email);
      return ApiResponse.ok(res, 'Verification email resent');
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
      return ApiResponse.ok(res, 'Password reset email sent');
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

  static async googleLogin(req: Request, res: Response) {
    const url = AuthService.getGoogleAuthUrl();
    res.redirect(url);
  }

  static async googleCallback(req: Request, res: Response, next: NextFunction) {
    try {
      const { code } = req.query;
      if (!code) {
        return res.redirect(`${process.env.FRONTEND_URL}/login?error=Google authentication failed`);
      }

      const { user, accessToken, refreshToken } = await AuthService.handleGoogleCallback(code as string);

      // Set refresh token in httpOnly cookie
      res.cookie('refreshToken', refreshToken, sessionCookieOptions);

      // Never put the access token in the redirect URL (it would leak into
      // logs, history, and Referer headers). Park it behind a short-lived
      // single-use exchange code instead.
      const exchangeCode = crypto.randomBytes(32).toString('hex');
      await redisClient.set(`auth:oauth-exchange:${exchangeCode}`, accessToken, { EX: 60 });

      const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
      const redirectUrl = new URL(`${frontendUrl}/auth/callback`);
      redirectUrl.searchParams.set('code', exchangeCode);

      res.redirect(redirectUrl.toString());
    } catch (error: any) {
      console.error('Google callback error:', error);
      const errorMessage = error.message || 'Google authentication failed';
      const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
      res.redirect(`${frontendUrl}/login?error=${encodeURIComponent(errorMessage)}`);
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
