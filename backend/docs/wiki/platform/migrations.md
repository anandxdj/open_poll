---
summary: Numbered idempotent migrations (bun run migrate), the migrations collection and lock, number ranges, and index ownership.
status: active
last_updated: 2026-10-19
---

# Migrations (`src/migrations/`)

```sh
bun run migrate            # apply pending migrations (run on every deploy, before serving)
bun run migrate status     # list migrations and when each was applied
```

## Writing one

`src/migrations/NNN-short-name.ts` default-exports:

```ts
import type { Migration } from './runner';
const migration: Migration = {
  id: 20,                       // must equal NNN
  name: 'workspaces',
  async up({ db, connection, log }) { … },
};
export default migration;
```

- Files are discovered by name (`NNN-*.ts`); there is no registry to edit.
- Ranges: 001–009 W0-D, 010–019 W1-C, 020–029 W1-B, 030–039 W1-A1, 100–199 Wave 3 (10 per
  package), 200+ Wave 4.
- `up` must be idempotent: a crash between `up` and its record re-runs it. Prefer raw
  collection operations (`db.collection(...)`) for data backfills so later schema changes
  don't break old migrations.
- Indexes: a migration that introduces a collection calls `Model.syncIndexes()` for it
  (creates missing, drops undeclared). For pre-existing collections use
  `collection.createIndex(...)` and drop old indexes explicitly; never `syncIndexes()` a
  collection whose indexes the schema does not fully describe.
- New schemas use `autoIndex: !env.isProduction`, so production gets their indexes only from
  migrations; development and tests build them on boot as before.

## Runner (`runner.ts`)

- `runMigrations({ connection?, migrations?, log? })` → `{ applied, skipped }`, in id order;
  stops at the first failure (it stays pending).
- `migrations` collection: one document per applied migration
  `{_id: id, name, startedAt, finishedAt, durationMs}`, plus a lock document
  `{_id: 'lock', owner, lockedUntil}` taken with an upsert. A second concurrent runner fails
  with `MigrationLockedError`; a crashed runner's lock frees itself after 30 minutes (renewed
  after each migration).
- `migrationStatus()`, `loadMigrations(dir?)`, `orderMigrations()` are exported for scripts
  and tests.

## 001-bootstrap

`syncIndexes()` for `workspaces`, `workspacemembers`, `workspaceinvites`, `workspacegroups`,
`resourceshares`, `usagecounters`, `mediaassets`, `auditevents`; creates the
`{identities.provider, identities.subject}` index on `users`.
