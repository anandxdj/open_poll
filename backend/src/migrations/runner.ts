import { randomUUID } from 'node:crypto';
import path from 'node:path';
import mongoose from 'mongoose';

/**
 * Numbered, idempotent data/index migrations (`bun run migrate`).
 *
 * Each `src/migrations/NNN-name.ts` default-exports a Migration whose id equals
 * NNN. Ranges per work package: 001–009 platform, 010–019 library, 020–029
 * workspaces, 030–039 sessions, 100–199 wave 3, 200+ wave 4. Applied ids are
 * recorded in the `migrations` collection, so each runs once; `up` must still
 * be safe to re-run, because a crash between `up` and the record repeats it.
 * Indexes of collections a migration owns are created with `syncIndexes()`
 * inside the migration (production runs with autoIndex off for them).
 *
 * A lock document in the same collection keeps two deploys from migrating at
 * the same time.
 */

export interface MigrationContext {
  db: mongoose.mongo.Db;
  connection: mongoose.Connection;
  log: (message: string) => void;
}

export interface Migration {
  id: number;
  name: string;
  up(context: MigrationContext): Promise<void>;
}

export interface MigrationRecord {
  _id: number;
  name: string;
  startedAt: Date;
  finishedAt: Date;
  durationMs: number;
}

interface LockRecord {
  _id: 'lock';
  owner: string;
  lockedUntil: Date;
}

export const MIGRATIONS_COLLECTION = 'migrations';
const LOCK_ID = 'lock' as const;
/** A crashed runner's lock frees itself after this long. */
const LOCK_TTL_MS = 30 * 60 * 1000;
const FILE_PATTERN = /^(\d{3})-[a-z0-9-]+\.ts$/;

export class MigrationLockedError extends Error {
  constructor(owner: string, until: Date | undefined) {
    super(`Migrations are locked by another runner (${owner}) until ${until?.toISOString() ?? 'unknown'}`);
    this.name = 'MigrationLockedError';
  }
}

const label = (migration: Pick<Migration, 'id' | 'name'>) => `${String(migration.id).padStart(3, '0')}-${migration.name}`;

/** Checks ids are unique positive integers and returns the migrations in id order. */
export function orderMigrations(migrations: Migration[]): Migration[] {
  const seen = new Map<number, string>();
  for (const migration of migrations) {
    if (!Number.isInteger(migration.id) || migration.id < 1 || migration.id > 999) {
      throw new Error(`Migration "${migration.name}" has invalid id ${migration.id} (1-999)`);
    }
    const clash = seen.get(migration.id);
    if (clash) throw new Error(`Migrations "${clash}" and "${migration.name}" share id ${migration.id}`);
    seen.set(migration.id, migration.name);
  }
  return [...migrations].sort((a, b) => a.id - b.id);
}

/** Imports every NNN-*.ts next to this file (or in `dir`); the file number must match the export's id. */
export async function loadMigrations(dir: string = import.meta.dir): Promise<Migration[]> {
  const files = [...new Bun.Glob('*.ts').scanSync({ cwd: dir })].filter((file) => FILE_PATTERN.test(file)).sort();
  const migrations: Migration[] = [];
  for (const file of files) {
    const module = (await import(path.join(dir, file))) as { default?: Migration };
    const migration = module.default;
    const fileId = Number(FILE_PATTERN.exec(file)![1]);
    if (!migration || typeof migration.up !== 'function' || migration.id !== fileId) {
      throw new Error(`${file} must default-export a migration with id ${fileId}`);
    }
    migrations.push(migration);
  }
  return orderMigrations(migrations);
}

function migrationsCollection(db: mongoose.mongo.Db) {
  return db.collection<MigrationRecord | LockRecord>(MIGRATIONS_COLLECTION);
}

async function acquireLock(db: mongoose.mongo.Db, owner: string) {
  const collection = db.collection<LockRecord>(MIGRATIONS_COLLECTION);
  const now = new Date();
  try {
    // Matches only an expired lock; with none present the upsert inserts ours,
    // and with a live one the insert collides on _id.
    await collection.updateOne(
      { _id: LOCK_ID, lockedUntil: { $lt: now } },
      { $set: { owner, lockedUntil: new Date(now.getTime() + LOCK_TTL_MS) } },
      { upsert: true },
    );
  } catch (error) {
    if ((error as { code?: number }).code !== 11000) throw error;
    const current = await collection.findOne({ _id: LOCK_ID });
    throw new MigrationLockedError(current?.owner ?? 'unknown', current?.lockedUntil);
  }
}

async function renewLock(db: mongoose.mongo.Db, owner: string) {
  await db
    .collection<LockRecord>(MIGRATIONS_COLLECTION)
    .updateOne({ _id: LOCK_ID, owner }, { $set: { lockedUntil: new Date(Date.now() + LOCK_TTL_MS) } });
}

async function releaseLock(db: mongoose.mongo.Db, owner: string) {
  await db.collection<LockRecord>(MIGRATIONS_COLLECTION).deleteOne({ _id: LOCK_ID, owner });
}

function requireDb(connection: mongoose.Connection): mongoose.mongo.Db {
  if (!connection.db || connection.readyState !== 1) throw new Error('Connect to MongoDB before running migrations');
  return connection.db;
}

async function appliedIds(db: mongoose.mongo.Db): Promise<Set<number>> {
  const records = await migrationsCollection(db)
    .find({ _id: { $ne: LOCK_ID } })
    .project<{ _id: number }>({ _id: 1 })
    .toArray();
  return new Set(records.map((record) => record._id));
}

export interface RunOptions {
  connection?: mongoose.Connection;
  /** Defaults to loadMigrations(). */
  migrations?: Migration[];
  log?: (message: string) => void;
}

/** Applies pending migrations in id order. Resolves with the ids applied and skipped. */
export async function runMigrations(options: RunOptions = {}): Promise<{ applied: number[]; skipped: number[] }> {
  const connection = options.connection ?? mongoose.connection;
  const db = requireDb(connection);
  const log = options.log ?? (() => {});
  const migrations = orderMigrations(options.migrations ?? (await loadMigrations()));
  const owner = `${process.pid}@${randomUUID()}`;
  const applied: number[] = [];
  const skipped: number[] = [];

  await acquireLock(db, owner);
  try {
    const done = await appliedIds(db);
    for (const migration of migrations) {
      if (done.has(migration.id)) {
        skipped.push(migration.id);
        continue;
      }
      log(`[Migrate] ${label(migration)} ...`);
      const startedAt = new Date();
      await migration.up({ db, connection, log });
      const finishedAt = new Date();
      await migrationsCollection(db).updateOne(
        { _id: migration.id },
        {
          $set: {
            name: migration.name,
            startedAt,
            finishedAt,
            durationMs: finishedAt.getTime() - startedAt.getTime(),
          },
        },
        { upsert: true },
      );
      applied.push(migration.id);
      log(`[Migrate] ${label(migration)} done in ${finishedAt.getTime() - startedAt.getTime()}ms`);
      await renewLock(db, owner);
    }
  } finally {
    await releaseLock(db, owner);
  }
  return { applied, skipped };
}

/** Every known migration with when it was applied (null = pending). */
export async function migrationStatus(
  options: Pick<RunOptions, 'connection' | 'migrations'> = {},
): Promise<Array<{ id: number; name: string; appliedAt: Date | null }>> {
  const db = requireDb(options.connection ?? mongoose.connection);
  const migrations = orderMigrations(options.migrations ?? (await loadMigrations()));
  const records = await migrationsCollection(db)
    .find({ _id: { $ne: LOCK_ID } })
    .toArray();
  const finished = new Map(records.map((record) => [record._id as number, (record as MigrationRecord).finishedAt]));
  return migrations.map((migration) => ({
    id: migration.id,
    name: migration.name,
    appliedAt: finished.get(migration.id) ?? null,
  }));
}
