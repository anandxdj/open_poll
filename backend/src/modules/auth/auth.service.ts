import axios from 'axios';
import bcrypt from 'bcryptjs';
import { UserModel } from './auth.model';
import type { IUser } from './auth.model';
import { ApiError } from '../../common/utils/ApiError';
import { env } from '../../common/config/env';
import {
  generateAccessToken,
  generateRefreshToken,
  verifyRefreshToken,
  generateResetToken,
  hashToken,
} from '../../common/utils/jwt.utils';

import {
  sendVerificationEmail,
  sendResetPasswordEmail,
  sendAccountExistsEmail,
} from '../../common/config/email';

/**
 * bcrypt hash (cost 12, same as auth.model) of a throwaway string. Compared
 * against when no password hash exists so "unknown email" costs as much time
 * as "wrong password".
 */
const TIMING_DUMMY_HASH = '$2b$12$m4daYAiMWvh.MRFjcFKTeOzM0qFhjU101NDgsvIEM7qHIQvdl71j.';

/**
 * Responses must not reveal whether an account exists, so mail goes out in the
 * background: awaiting the provider only on the "account exists" branch would
 * leak it through response time. sendEmail already logs its own failures.
 */
const sendInBackground = (label: string, send: () => Promise<unknown>) => {
  void send().catch((error: any) => console.error(`Failed to send ${label} email:`, error?.message));
};

/**
 * An unverified local account was never proven to belong to the owner of its
 * email: anyone can register any address. Before a provider-verified sign-in
 * claims it, drop everything the registrant chose (password, pending tokens,
 * sessions, role) so a pre-registered attacker keeps no way back in.
 */
export const resetUnverifiedAccount = (user: IUser) => {
  user.set('password', undefined);
  user.set('verificationToken', undefined);
  user.set('resetPasswordToken', undefined);
  user.set('resetPasswordExpires', undefined);
  user.set('refreshToken', undefined);
  user.role = 'user';
};

export class AuthService {
  /**
   * Resolves the same way whether or not the email is taken; an existing
   * owner gets an "account exists" email instead of a new account.
   */
  static async register(userData: { email?: string; name?: string; password?: string }): Promise<void> {
    const { email, name, password } = userData;

    if (!email || !name || !password) {
      throw ApiError.badRequest('Email, name, and password are required');
    }

    const existingUser = await UserModel.findOne({ email });
    if (existingUser) {
      // Match the bcrypt cost a real signup pays in the pre-save hook.
      await bcrypt.hash(password, 12);
      sendInBackground('account-exists', () => sendAccountExistsEmail(email));
      return;
    }

    const { rawToken, hashedToken } = generateResetToken();

    try {
      // Role is never taken from input: public signup always creates a plain user.
      await UserModel.create({
        email,
        name,
        password,
        role: 'user',
        verificationToken: hashedToken,
        isVerified: false,
      });
    } catch (error: any) {
      // Lost a race with a concurrent signup for the same email: same outcome as above.
      if (error?.code === 11000) {
        sendInBackground('account-exists', () => sendAccountExistsEmail(email));
        return;
      }
      throw error;
    }

    sendInBackground('verification', () => sendVerificationEmail(email, rawToken));
  }

  static async login(credentials: { email?: string; password?: string }) {
    const { email, password } = credentials;

    if (!email || !password) {
      throw ApiError.badRequest('Email and password are required');
    }

    const user = await UserModel.findOne({ email }).select('+password');
    if (!user || !user.password) {
      // Burn the same bcrypt time as a real comparison so response timing
      // doesn't reveal which emails have password accounts.
      await bcrypt.compare(password, TIMING_DUMMY_HASH);
      throw ApiError.unauthorized('Invalid email or password');
    }

    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      throw ApiError.unauthorized('Invalid email or password');
    }

    if (!user.isVerified) {
      throw ApiError.forbidden('Please verify your email before logging in');
    }

    const accessToken = generateAccessToken({
      id: user._id,
      email: user.email,
      name: user.name,
      role: user.role
    });
    const refreshToken = generateRefreshToken({ id: user._id });

    // Store hashed refresh token in DB
    user.refreshToken = hashToken(refreshToken);
    user.lastLogin = new Date();
    await user.save();

    const userObj = user.toObject();
    delete userObj.password;
    delete userObj.refreshToken;

    return { user: userObj, accessToken, refreshToken };
  }

  static async refresh(token?: string) {
    if (!token) {
      throw ApiError.unauthorized('Refresh token missing');
    }

    try {
      const decoded = verifyRefreshToken(token) as any;
      const user = await UserModel.findById(decoded.id).select('+refreshToken');

      if (!user || user.refreshToken !== hashToken(token)) {
        throw ApiError.unauthorized('Invalid refresh token — please log in again');
      }

      const accessToken = generateAccessToken({
        id: user._id,
        email: user.email,
        name: user.name,
        role: user.role
      });
      return { accessToken };
    } catch (error) {
      throw ApiError.unauthorized('Invalid or expired refresh token');
    }
  }

  static async logout(userId: string) {
    await UserModel.findByIdAndUpdate(userId, { $unset: { refreshToken: 1 } });
  }

  static async logoutByToken(token: string) {
    const hashedToken = hashToken(token);
    await UserModel.findOneAndUpdate({ refreshToken: hashedToken }, { $unset: { refreshToken: 1 } });
  }

  /** Silently does nothing for unknown or already-verified emails (no enumeration). */
  static async resendVerification(email: string): Promise<void> {
    const user = await UserModel.findOne({ email });
    if (!user || user.isVerified) return;

    const { rawToken, hashedToken } = generateResetToken();
    user.verificationToken = hashedToken;
    await user.save();

    sendInBackground('verification', () => sendVerificationEmail(email, rawToken));
  }

  static async verifyEmail(token: string) {
    const trimmedToken = String(token).trim();
    if (!trimmedToken) {
      throw ApiError.badRequest('Invalid or expired verification token');
    }

    const hashedInput = hashToken(trimmedToken);

    // Check both hashed and raw (for flexibility during development)
    let user = await UserModel.findOne({ verificationToken: hashedInput }).select('+verificationToken');
    if (!user) {
      user = await UserModel.findOne({ verificationToken: trimmedToken }).select('+verificationToken');
    }

    if (!user) {
      throw ApiError.badRequest('Invalid or expired verification token');
    }

    user.isVerified = true;
    user.verificationToken = undefined;
    await user.save();

    return user;
  }

  /** Silently does nothing for unknown emails (no enumeration). */
  static async forgotPassword(email: string): Promise<void> {
    const user = await UserModel.findOne({ email });
    if (!user) return;

    const { rawToken, hashedToken } = generateResetToken();

    user.resetPasswordToken = hashedToken;
    user.resetPasswordExpires = new Date(Date.now() + 15 * 60 * 1000); // 15 mins
    await user.save();

    sendInBackground('password reset', () => sendResetPasswordEmail(email, rawToken));
  }

  static async resetPassword(token: string, newPassword: string) {
    const hashedToken = hashToken(token);

    const user = await UserModel.findOne({
      resetPasswordToken: hashedToken,
      resetPasswordExpires: { $gt: new Date() },
    }).select('+resetPasswordToken +resetPasswordExpires');

    if (!user) {
      throw ApiError.badRequest('Invalid or expired reset token');
    }

    user.password = newPassword;
    user.resetPasswordToken = undefined;
    user.resetPasswordExpires = undefined;
    // The link reached this inbox, which proves ownership of the email. Also
    // revoke existing sessions: a reset usually means the old password leaked.
    user.isVerified = true;
    user.verificationToken = undefined;
    user.refreshToken = undefined;
    await user.save();
  }

  static async getMe(userId: string) {
    const user = await UserModel.findById(userId);
    if (!user) {
      throw ApiError.notFound('User not found');
    }
    return user;
  }

  /** `state` is bound to this browser by the controller and checked on callback. */
  static getGoogleAuthUrl(state: string) {
    if (!env.google) throw new Error('Google sign-in is not configured');
    const rootUrl = 'https://accounts.google.com/o/oauth2/v2/auth';
    const options = {
      redirect_uri: env.google.redirectUri,
      client_id: env.google.clientId,
      access_type: 'offline',
      response_type: 'code',
      prompt: 'consent',
      state,
      scope: [
        'https://www.googleapis.com/auth/userinfo.profile',
        'https://www.googleapis.com/auth/userinfo.email',
      ].join(' '),
    };

    const qs = new URLSearchParams(options);
    return `${rootUrl}?${qs.toString()}`;
  }

  static async handleGoogleCallback(code: string) {
    if (!env.google) throw ApiError.unauthorized('Google sign-in is not configured');
    const url = 'https://oauth2.googleapis.com/token';
    const values = {
      code,
      client_id: env.google.clientId,
      client_secret: env.google.clientSecret,
      redirect_uri: env.google.redirectUri,
      grant_type: 'authorization_code',
    };

    try {
      const res = await axios.post(url, new URLSearchParams(values), {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      });

      const { access_token } = res.data;

      // Fetch user info from Google
      const googleUserRes = await axios.get(
        'https://www.googleapis.com/oauth2/v3/userinfo',
        {
          headers: {
            Authorization: `Bearer ${access_token}`,
          },
        }
      );

      const googleUser = googleUserRes.data;

      if (!googleUser.email_verified && !googleUser.verified_email) {
        throw ApiError.forbidden('Google account is not verified');
      }

      let user = await UserModel.findOne({ email: googleUser.email });

      if (!user) {
        user = await UserModel.create({
          email: googleUser.email,
          name: googleUser.name || googleUser.given_name,
          picture: googleUser.picture,
          isVerified: true,
          role: 'user',
          sub: googleUser.sub,
        });
      } else {
        if (!user.isVerified) resetUnverifiedAccount(user);
        user.name = googleUser.name || googleUser.given_name;
        user.picture = googleUser.picture;
        user.isVerified = true;
        user.lastLogin = new Date();
        user.sub = googleUser.sub;
        await user.save();
      }

      const accessToken = generateAccessToken({
        id: user._id,
        email: user.email,
        name: user.name,
        role: user.role
      });
      const refreshToken = generateRefreshToken({ id: user._id });

      user.refreshToken = hashToken(refreshToken);
      await user.save();

      return { user, accessToken, refreshToken };
    } catch (error: any) {
      const detail = error.response?.data?.error_description || error.response?.data?.error || error.message;
      console.error('Google OAuth Error:', detail);
      throw ApiError.unauthorized(`Google authentication failed: ${detail}`);
    }
  }
}
