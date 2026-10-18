/**
 * Seeds a verified host account for the frontend Playwright suite and clears the
 * rate-limit counters, so repeated local runs never trip `auth-login` or `join`.
 *
 *   MONGO_URI=… REDIS_URL=… bun scripts/seed-e2e-user.ts <email> <password> [name]
 *
 * Login refuses unverified accounts and dev has no inbox, so the user is written
 * straight to the database. Never point this at a shared or production database.
 */
import mongoose from 'mongoose';
import { createClient } from 'redis';
import { UserModel } from '../src/modules/auth/auth.model';

const [email, password, name = 'E2E Host'] = process.argv.slice(2);

const main = async () => {
  if (process.env.NODE_ENV === 'production') throw new Error('Refusing to seed in production');
  if (!email || !password) throw new Error('Usage: seed-e2e-user.ts <email> <password> [name]');
  const mongoUri = process.env.MONGO_URI;
  if (!mongoUri) throw new Error('MONGO_URI is required');

  await mongoose.connect(mongoUri);
  try {
    const existing = await UserModel.findOne({ email: email.toLowerCase() });
    const user = existing ?? new UserModel({ email, name });
    user.name = name;
    user.password = password; // hashed by the pre-save hook
    user.isVerified = true;
    await user.save();
    console.log(`[seed-e2e-user] ${existing ? 'reset' : 'created'} ${user.email}`);
  } finally {
    await mongoose.disconnect();
  }

  if (process.env.REDIS_URL) {
    const redis = createClient({ url: process.env.REDIS_URL });
    await redis.connect();
    try {
      let cleared = 0;
      for await (const keys of redis.scanIterator({ MATCH: 'rl:*', COUNT: 500 })) {
        if (keys.length > 0) cleared += await redis.del(keys);
      }
      console.log(`[seed-e2e-user] cleared ${cleared} rate-limit keys`);
    } finally {
      await redis.quit();
    }
  }
};

main().catch((error) => {
  console.error('[seed-e2e-user]', error instanceof Error ? error.message : error);
  process.exit(1);
});
