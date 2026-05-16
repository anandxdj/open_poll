import { Router } from 'express';
import { AuthController } from './auth.controller';
import { authenticate } from './auth.middleware';
import { validate } from '../../common/middlewares/validate.middleware';
import { registerSchema } from './dto/register.schema';
import { loginSchema } from './dto/login.schema';
import { forgotPasswordSchema } from './dto/forgot-password.schema';
import { resetPasswordSchema } from './dto/reset-password.schema';

const router = Router();

router.post('/register', validate(registerSchema), AuthController.register as any);
router.post('/login', validate(loginSchema), AuthController.login as any);
router.post('/refresh-token', AuthController.refreshToken as any);
router.post('/logout', AuthController.logout as any);
router.get('/verify-email/:token', AuthController.verifyEmail as any);
router.post('/resend-verification', AuthController.resendVerification as any);
router.post('/forgot-password', validate(forgotPasswordSchema), AuthController.forgotPassword as any);
router.put('/reset-password/:token', validate(resetPasswordSchema), AuthController.resetPassword as any);
router.get('/me', authenticate() as any, AuthController.me as any);

// Google OAuth
router.get('/google', AuthController.googleLogin);
router.get('/google/callback', AuthController.googleCallback as any);

export default router;
