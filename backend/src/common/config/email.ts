import { Resend } from 'resend';
import { env } from './env';
import { BRAND, emailLayout, linkLine } from './emailLayout';

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
    'Verify your email for Open Poll',
    emailLayout({
      heading: 'Verify your email',
      body: `<p style="margin: 0;">Thanks for signing up for Open Poll. Confirm this is your email address to finish setting up your account.</p>${linkLine(url)}`,
      button: { href: url, label: 'Verify email' },
      footer: "If you didn't create an account, you can ignore this email.",
    })
  );
};

export const sendResetPasswordEmail = async (email: string, token: string) => {
  const url = `${env.FRONTEND_URL}/reset-password/${token}`;
  await sendEmail(
    email,
    'Reset your Open Poll password',
    emailLayout({
      heading: 'Reset your password',
      body: `<p style="margin: 0;">We received a request to reset your password. Choose a new one with the button below. The link expires in 15 minutes.</p>${linkLine(url)}`,
      button: { href: url, label: 'Choose a new password' },
      footer: "If you didn't ask for this, you can ignore this email. Your password stays the same.",
    })
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
    'You already have an Open Poll account',
    emailLayout({
      heading: 'You already have an account',
      body: `<p style="margin: 0;">Someone, hopefully you, tried to sign up for Open Poll with this email address. An account already exists for it, so nothing was changed.</p><p style="margin: 16px 0 0;">Forgot your password? <a href="${resetUrl}" style="color: ${BRAND.emberInk};">Reset it here</a>.</p>`,
      button: { href: loginUrl, label: 'Log in' },
      footer: "If this wasn't you, you can ignore this email.",
    })
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
    `${invite.inviterName} invited you to ${invite.workspaceName} on Open Poll`.replace(/\s+/g, ' ').slice(0, 200),
    emailLayout({
      heading: `Join ${workspace} on Open Poll`,
      body: `<p style="margin: 0;">${inviter} invited you to the <strong style="color: ${BRAND.ink};">${workspace}</strong> workspace as <strong style="color: ${BRAND.ink};">${role}</strong>.</p><p style="margin: 16px 0 0;">Sign in with this email address (${escapeHtml(email)}) to accept. The link works once and expires on ${invite.expiresAt.toUTCString()}.</p>${linkLine(url)}`,
      button: { href: url, label: 'Accept invitation' },
      footer: "If you weren't expecting this invitation, you can ignore this email.",
    })
  );
  return Boolean(delivered);
};

/** After DELETE /api/me: when the account goes, and that signing in keeps it. */
export const sendAccountDeletionEmail = async (email: string, purgeAt: Date) => {
  const loginUrl = `${env.FRONTEND_URL}/login`;
  const date = purgeAt.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });
  await sendEmail(
    email,
    'Your Open Poll account will be deleted',
    emailLayout({
      heading: 'Your account will be deleted',
      body: `<p style="margin: 0;">You asked us to delete your Open Poll account. On ${date} we delete it for good, with your personal workspace and everything in it.</p><p style="margin: 16px 0 0;">Changed your mind? Log in before then and your account stays as it is.</p>`,
      button: { href: loginUrl, label: 'Log in to keep my account' },
      footer: "If you didn't ask for this, log in now and change your password.",
    })
  );
};
