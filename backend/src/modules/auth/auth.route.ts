import { Router, type Request } from 'express';
import { AuthController } from './auth.controller';
import { authenticate, type AuthRequest } from './auth.middleware';
import { validate } from '../../common/middlewares/validate.middleware';
import { registerSchema } from './dto/register.schema';
import { loginSchema } from './dto/login.schema';
import { forgotPasswordSchema } from './dto/forgot-password.schema';
import { resendVerificationSchema } from './dto/resend-verification.schema';
import { resetPasswordSchema } from './dto/reset-password.schema';
import { updateProfileSchema } from './dto/update-profile.schema';
import { changePasswordSchema } from './dto/change-password.schema';
import { rateLimit } from '../../common/middlewares/rateLimit.middleware';
import { requireTrustedOrigin } from '../../common/middlewares/origin.middleware';

const router = Router();

/** Limit key for signed-in account routes: the user, so it must run after authenticate(). */
const byUser = (req: Request) => (req as AuthRequest).user?.id;

/**
 * Every auth route is limited, and a Redis outage falls back to per-instance
 * in-memory windows instead of dropping brute-force protection. Routes that
 * take an email are also limited per account across all IPs; signed-in
 * account routes are limited per user (`byUser`).
 */
const authLimit = (prefix: string, windowSec: number, max: number, keyBy: 'ip' | 'email' | typeof byUser = 'ip') =>
  rateLimit({ prefix, windowSec, max, keyBy, onStoreError: 'memory' });

/** Cookie-authenticated, state-changing endpoints only accept our own frontends. */
const trustedOrigin = requireTrustedOrigin();

/** Registered OIDC redirect URI handlers; app.ts also mounts these at the root /auth/callback. */
export const oidcCallbackHandlers = [
  authLimit('auth-oidc-callback', 300, 30),
  AuthController.oidcCallback as any,
];

router.get('/login', authLimit('auth-oidc-login', 300, 30), AuthController.oidcLogin as any);
router.get('/continue', authLimit('auth-oidc-continue', 300, 30), AuthController.oidcContinue as any);
router.get('/callback', ...oidcCallbackHandlers);
router.post(
  '/register',
  authLimit('auth-register', 900, 10),
  authLimit('auth-register-email', 3600, 5, 'email'),
  validate(registerSchema),
  AuthController.register as any,
);
router.post(
  '/login',
  authLimit('auth-login', 300, 10),
  authLimit('auth-login-email', 900, 20, 'email'),
  validate(loginSchema),
  AuthController.login as any,
);
router.post('/refresh-token', trustedOrigin, authLimit('auth-refresh', 300, 60), AuthController.refreshToken as any);
router.post('/logout', trustedOrigin, authLimit('auth-logout', 300, 30), AuthController.logout as any);
router.get('/verify-email/:token', authLimit('auth-verify-email', 900, 20), AuthController.verifyEmail as any);
router.post(
  '/resend-verification',
  authLimit('auth-resend', 900, 5),
  authLimit('auth-resend-email', 3600, 3, 'email'),
  validate(resendVerificationSchema),
  AuthController.resendVerification as any,
);
router.post(
  '/forgot-password',
  authLimit('auth-forgot', 900, 5),
  authLimit('auth-forgot-email', 3600, 3, 'email'),
  validate(forgotPasswordSchema),
  AuthController.forgotPassword as any,
);
router.put('/reset-password/:token', authLimit('auth-reset-password', 900, 10), validate(resetPasswordSchema), AuthController.resetPassword as any);
router.get('/me', authenticate() as any, AuthController.me as any);

// Google OAuth
router.get('/google', authLimit('auth-google', 300, 30), AuthController.googleLogin as any);
router.get('/google/callback', authLimit('auth-google-callback', 300, 30), AuthController.externalOAuthCallback as any);
router.post('/oauth/exchange', authLimit('auth-oauth-exchange', 300, 20), AuthController.exchangeOAuthCode as any);

/**
 * Mounted at /api/me by src/http/routes.ts, beside the privacy module's
 * router: the signed-in user's own profile and password, no workspace context.
 *
 * - PATCH /          `{ name }`, returns the user as GET /api/auth/me does
 * - POST  /password  `{ currentPassword, newPassword }`, ends every other session
 */
export const accountRouter = Router();

accountRouter.patch(
  '/',
  authenticate() as any,
  authLimit('auth-update-profile', 300, 30, byUser),
  validate(updateProfileSchema),
  AuthController.updateMe as any,
);
accountRouter.post(
  '/password',
  authenticate() as any,
  authLimit('auth-change-password', 900, 10, byUser),
  validate(changePasswordSchema),
  AuthController.changePassword as any,
);

export default router;
