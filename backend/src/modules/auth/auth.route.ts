import { Router } from 'express';
import { AuthController } from './auth.controller';
import { authenticate } from './auth.middleware';
import { validate } from '../../common/middlewares/validate.middleware';
import { registerSchema } from './dto/register.schema';
import { loginSchema } from './dto/login.schema';
import { forgotPasswordSchema } from './dto/forgot-password.schema';
import { resetPasswordSchema } from './dto/reset-password.schema';
import { rateLimit } from '../../common/middlewares/rateLimit.middleware';

const router = Router();

router.post('/register', rateLimit({ prefix: 'auth-register', windowSec: 900, max: 10 }), validate(registerSchema), AuthController.register as any);
router.post('/login', rateLimit({ prefix: 'auth-login', windowSec: 300, max: 10 }), validate(loginSchema), AuthController.login as any);
router.post('/refresh-token', AuthController.refreshToken as any);
router.post('/logout', AuthController.logout as any);
router.get('/verify-email/:token', AuthController.verifyEmail as any);
router.post('/resend-verification', rateLimit({ prefix: 'auth-resend', windowSec: 900, max: 5 }), AuthController.resendVerification as any);
router.post('/forgot-password', rateLimit({ prefix: 'auth-forgot', windowSec: 900, max: 5 }), validate(forgotPasswordSchema), AuthController.forgotPassword as any);
router.put('/reset-password/:token', validate(resetPasswordSchema), AuthController.resetPassword as any);
router.get('/me', authenticate() as any, AuthController.me as any);

// Google OAuth
router.get('/google', AuthController.googleLogin);
router.get('/google/callback', AuthController.googleCallback as any);

export default router;
