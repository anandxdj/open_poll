import { Resend } from 'resend';
import { env } from './env';

const resend = env.mail.resendApiKey ? new Resend(env.mail.resendApiKey) : null;

const sendEmail = async (to: string, subject: string, html: string) => {
  try {
    if (resend) {
      const { data, error } = await resend.emails.send({
        from: `"${env.mail.fromName}" <${env.mail.fromEmail}>`,
        to: [to],
        subject,
        html,
      });

      if (error) {
        throw new Error(error.message);
      }
      return data;
    } else {
      // Fallback to mock log if no API key is provided
      console.log(`[Email Mock] To: ${to}, Subject: ${subject}`);
    }
  } catch (error: any) {
    console.error(`[Email Error] Failed to send email to ${to}:`, error.message);
  }
};

export const sendVerificationEmail = async (email: string, token: string) => {
  const url = `${env.FRONTEND_URL}/verify-email/${token}`;
  await sendEmail(
    email,
    'Verify your email - OpenPoll',
    `
    <div style="font-family: sans-serif; max-width: 600px; margin: auto; padding: 20px; border: 1px solid #eee; border-radius: 10px;">
      <h2 style="color: #d8ad87;">Welcome to OpenPoll!</h2>
      <p>Thank you for signing up. Please click the button below to verify your email address:</p>
      <div style="text-align: center; margin: 30px 0;">
        <a href="${url}" style="background-color: #d8ad87; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; font-weight: bold;">Verify Email</a>
      </div>
      <p>Or copy and paste this link into your browser:</p>
      <p style="word-break: break-all; color: #666;">${url}</p>
      <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;">
      <p style="font-size: 12px; color: #999;">If you didn't create an account, you can safely ignore this email.</p>
    </div>
    `
  );
};

export const sendResetPasswordEmail = async (email: string, token: string) => {
  const url = `${env.FRONTEND_URL}/reset-password/${token}`;
  await sendEmail(
    email,
    'Reset your password - OpenPoll',
    `
    <div style="font-family: sans-serif; max-width: 600px; margin: auto; padding: 20px; border: 1px solid #eee; border-radius: 10px;">
      <h2 style="color: #d8ad87;">Password Reset Request</h2>
      <p>We received a request to reset your password. Click the button below to choose a new one:</p>
      <div style="text-align: center; margin: 30px 0;">
        <a href="${url}" style="background-color: #d8ad87; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; font-weight: bold;">Reset Password</a>
      </div>
      <p>This link will expire in 15 minutes.</p>
      <p>If you didn't request a password reset, please ignore this email.</p>
      <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;">
      <p style="font-size: 12px; color: #999;">OpenPoll Platform</p>
    </div>
    `
  );
};

/**
 * Sent instead of a verification email when someone registers with an address
 * that already has an account, so the signup response can stay identical.
 */
export const sendAccountExistsEmail = async (email: string) => {
  const loginUrl = `${env.FRONTEND_URL}/login`;
  const resetUrl = `${env.FRONTEND_URL}/forgot-password`;
  await sendEmail(
    email,
    'You already have an OpenPoll account',
    `
    <div style="font-family: sans-serif; max-width: 600px; margin: auto; padding: 20px; border: 1px solid #eee; border-radius: 10px;">
      <h2 style="color: #d8ad87;">You already have an account</h2>
      <p>Someone, hopefully you, tried to sign up for OpenPoll with this email address. An account already exists for it, so nothing was changed.</p>
      <div style="text-align: center; margin: 30px 0;">
        <a href="${loginUrl}" style="background-color: #d8ad87; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; font-weight: bold;">Log in</a>
      </div>
      <p>Forgot your password? <a href="${resetUrl}" style="color: #d8ad87;">Reset it here</a>.</p>
      <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;">
      <p style="font-size: 12px; color: #999;">If this wasn't you, you can safely ignore this email.</p>
    </div>
    `
  );
};

const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);

/**
 * Invitation to join a team workspace (W3-B1). `url` carries the single-use
 * token. With mail disabled (no RESEND_API_KEY, never in production) the link
 * is logged so local setups can still accept invites. Resolves to whether the
 * provider accepted the message (false when mail is off or the send failed).
 */
export const sendWorkspaceInviteEmail = async (
  email: string,
  invite: { url: string; workspaceName: string; inviterName: string; role: string; expiresAt: Date },
) => {
  if (!resend && !env.isProduction) console.log(`[Email Mock] Workspace invite link for ${email}: ${invite.url}`);
  const workspace = escapeHtml(invite.workspaceName);
  const inviter = escapeHtml(invite.inviterName);
  const role = escapeHtml(invite.role);
  const url = escapeHtml(invite.url);
  const delivered = await sendEmail(
    email,
    // Names are user-supplied: keep the subject on one line.
    `${invite.inviterName} invited you to ${invite.workspaceName} on OpenPoll`.replace(/\s+/g, ' ').slice(0, 200),
    `
    <div style="font-family: sans-serif; max-width: 600px; margin: auto; padding: 20px; border: 1px solid #eee; border-radius: 10px;">
      <h2 style="color: #d8ad87;">Join ${workspace} on OpenPoll</h2>
      <p>${inviter} invited you to the <strong>${workspace}</strong> workspace as <strong>${role}</strong>.</p>
      <div style="text-align: center; margin: 30px 0;">
        <a href="${url}" style="background-color: #d8ad87; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; font-weight: bold;">Accept invitation</a>
      </div>
      <p>Sign in with this email address (${escapeHtml(email)}) to accept. The link works once and expires on ${invite.expiresAt.toUTCString()}.</p>
      <p style="word-break: break-all; color: #666;">${url}</p>
      <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;">
      <p style="font-size: 12px; color: #999;">If you weren't expecting this invitation, you can ignore this email.</p>
    </div>
    `
  );
  return Boolean(delivered);
};
