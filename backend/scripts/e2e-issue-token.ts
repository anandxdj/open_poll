/**
 * Issues a known email-verification or password-reset token for an account and
 * prints it, standing in for the email the Playwright suite cannot read.
 *
 *   MONGO_URI=… bun scripts/e2e-issue-token.ts <email> verify|reset
 *
 * Only the hash is stored, as the app does. Never point this at a shared or
 * production database.
 */
import mongoose from 'mongoose';
import { UserModel } from '../src/modules/auth/auth.model';
import { generateResetToken } from '../src/common/utils/jwt.utils';

const [email, kind] = process.argv.slice(2);

const main = async () => {
  if (process.env.NODE_ENV === 'production') throw new Error('Refusing to issue tokens in production');
  if (!email || (kind !== 'verify' && kind !== 'reset')) throw new Error('Usage: e2e-issue-token.ts <email> verify|reset');
  const mongoUri = process.env.MONGO_URI;
  if (!mongoUri) throw new Error('MONGO_URI is required');

  await mongoose.connect(mongoUri);
  try {
    const user = await UserModel.findOne({ email: email.toLowerCase() });
    if (!user) throw new Error(`No account for ${email}`);
    const { rawToken, hashedToken } = generateResetToken();
    if (kind === 'verify') {
      user.verificationToken = hashedToken;
    } else {
      user.resetPasswordToken = hashedToken;
      user.resetPasswordExpires = new Date(Date.now() + 15 * 60 * 1000);
    }
    await user.save();
    console.log(rawToken);
  } finally {
    await mongoose.disconnect();
  }
};

main().catch((error) => {
  console.error('[e2e-issue-token]', error instanceof Error ? error.message : error);
  process.exit(1);
});
