/**
 * Runs database migrations (src/migrations) against MONGO_URI.
 *
 *   bun run migrate            apply pending migrations
 *   bun run migrate status     list migrations and when each was applied
 *
 * Run it on every deploy before the new version starts serving; production
 * creates the indexes of new collections only here.
 */
import { env } from '../src/common/config/env';
import mongoose from 'mongoose';
import { connectDB } from '../src/common/config/db';
import { migrationStatus, runMigrations } from '../src/migrations/runner';

const command = process.argv[2] ?? 'up';

if (command !== 'up' && command !== 'status') {
  console.error('Usage: bun run migrate [up|status]');
  process.exit(1);
}

console.log(`[Migrate] ${env.NODE_ENV}: ${command}`);
await connectDB();
try {
  if (command === 'status') {
    for (const { id, name, appliedAt } of await migrationStatus()) {
      const number = String(id).padStart(3, '0');
      console.log(`  ${number}-${name}  ${appliedAt ? `applied ${appliedAt.toISOString()}` : 'pending'}`);
    }
  } else {
    const { applied, skipped } = await runMigrations({ log: (message) => console.log(message) });
    console.log(`[Migrate] Applied ${applied.length}, already applied ${skipped.length}.`);
  }
} catch (error) {
  console.error('[Migrate] Failed:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await mongoose.disconnect();
}
