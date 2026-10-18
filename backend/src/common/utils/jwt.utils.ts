import * as crypto from 'crypto';
import * as jwt from 'jsonwebtoken';
import { env } from '../config/env';

// Presence of production secrets is enforced at boot by common/config/env.
const JWT_ACCESS_SECRET = env.jwt.accessSecret;
const JWT_REFRESH_SECRET = env.jwt.refreshSecret;
const JWT_ACCESS_EXPIRES_IN = env.jwt.accessExpiresIn;
const JWT_REFRESH_EXPIRES_IN = env.jwt.refreshExpiresIn;

export const generateAccessToken = (payload: object) => {
  return jwt.sign(payload, JWT_ACCESS_SECRET, {
    expiresIn: JWT_ACCESS_EXPIRES_IN as any,
  });
};

export const verifyAccessToken = (token: string) => {
  return jwt.verify(token, JWT_ACCESS_SECRET) as any;
};

export const generateRefreshToken = (payload: object) => {
  return jwt.sign(payload, JWT_REFRESH_SECRET, {
    expiresIn: JWT_REFRESH_EXPIRES_IN as any,
  });
};

export const verifyRefreshToken = (token: string) => {
  return jwt.verify(token, JWT_REFRESH_SECRET) as any;
};

export const generateResetToken = () => {
  const rawToken = crypto.randomBytes(32).toString('hex');
  const hashedToken = crypto
    .createHash('sha256')
    .update(rawToken)
    .digest('hex');

  return { rawToken, hashedToken };
};

export const hashToken = (token: string) =>
  crypto.createHash('sha256').update(token).digest('hex');
