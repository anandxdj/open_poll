/**
 * Platform primitives against real services: migrations, workspace
 * provisioning under concurrency, usage counters (Redis + Mongo mirror),
 * audit TTL, the scheduler lock on Redis and, optionally, uploads through an
 * S3-compatible server.
 *
 * Skipped unless TEST_MONGO_URI and TEST_REDIS_URL are set. Point them at
 * dedicated test instances, never a dev or shared one. Mongo work happens in a
 * fresh database (dropped afterwards); Redis keys are namespaced by fresh ids
 * and deleted afterwards.
 *
 *   docker run -d --name openpoll-test-redis -p 127.0.0.1:6390:6379 redis:7-alpine
 *   docker run -d --name openpoll-test-mongo -p 127.0.0.1:27117:27017 mongo:7
 *
 *   cd backend
 *   TEST_REDIS_URL=redis://127.0.0.1:6390/6 \
 *   TEST_MONGO_URI='mongodb://127.0.0.1:27117/openpoll_w0d?directConnection=true' \
 *   bun test tests/platform.integration.test.ts
 *
 * The S3 block also needs TEST_S3_ENDPOINT, TEST_S3_ACCESS_KEY_ID and
 * TEST_S3_SECRET_ACCESS_KEY (TEST_S3_REGION defaults to us-east-1). It creates
 * a uniquely named bucket and deletes it, with everything in it, afterwards.
 *
 * The shared `redisClient` is never connected here: the methods the code under
 * test calls are delegated to a client of TEST_REDIS_URL for the duration.
 */
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { createHash, createHmac, randomUUID } from 'node:crypto';
import mongoose from 'mongoose';
import { createClient } from 'redis';
import { audit } from '../src/common/audit/audit';
import { redisClient } from '../src/common/config/redis';
import { Scheduler, redisLockStore, type JobDefinition } from '../src/common/jobs/scheduler';
import { consumeUsage, usageKey, usagePeriod } from '../src/common/plans/usage';
import { S3Storage } from '../src/common/storage/s3.storage';
import { setStorageDriver, type StorageDriver } from '../src/common/storage/storage';
import { resolveWorkspaceContext } from '../src/common/tenancy/workspaceContext.middleware';
import bootstrap from '../src/migrations/001-bootstrap';
import { MigrationLockedError, migrationStatus, runMigrations, type Migration } from '../src/migrations/runner';
import { AuditEventModel } from '../src/modules/audit/audit.model';
import { UserModel } from '../src/modules/auth/auth.model';
import { MediaAssetModel } from '../src/modules/uploads/media.model';
import { UploadsService } from '../src/modules/uploads/uploads.service';
import { UsageCounterModel } from '../src/modules/workspaces/usageCounter.model';
import { WorkspaceModel } from '../src/modules/workspaces/workspace.model';
import { WorkspaceMemberModel } from '../src/modules/workspaces/workspaceMember.model';
import { ensurePersonalWorkspace } from '../src/modules/workspaces/provisioning';

const TEST_MONGO_URI = process.env.TEST_MONGO_URI;
const TEST_REDIS_URL = process.env.TEST_REDIS_URL;
const enabled = Boolean(TEST_MONGO_URI && TEST_REDIS_URL);

const S3_TEST = {
  endpoint: process.env.TEST_S3_ENDPOINT,
  accessKeyId: process.env.TEST_S3_ACCESS_KEY_ID,
  secretAccessKey: process.env.TEST_S3_SECRET_ACCESS_KEY,
  region: process.env.TEST_S3_REGION || 'us-east-1',
};
const s3Enabled = enabled && Boolean(S3_TEST.endpoint && S3_TEST.accessKeyId && S3_TEST.secretAccessKey);

const DELEGATED = ['get', 'set', 'del', 'incrBy', 'decrBy', 'expire'] as const;

const newUser = (name: string) =>
  UserModel.create({ email: `${name.toLowerCase()}-${randomUUID()}@example.com`, name, isVerified: true });

describe.skipIf(!enabled)('platform integration', () => {
  const dbName = `openpoll_w0d_platform_${process.pid}_${Date.now()}`;
  const redis = createClient({ url: TEST_REDIS_URL });
  const savedRedis = Object.fromEntries(DELEGATED.map((name) => [name, (redisClient as any)[name]]));
  const redisKeys = new Set<string>();

  beforeAll(async () => {
    await mongoose.connect(TEST_MONGO_URI!, { dbName });
    await redis.connect();
    for (const name of DELEGATED) {
      (redisClient as any)[name] = (key: string, ...args: unknown[]) => {
        redisKeys.add(key);
        return (redis as any)[name](key, ...args);
      };
    }
  });

  afterAll(async () => {
    Object.assign(redisClient as any, savedRedis);
    if (redisKeys.size > 0) await redis.del([...redisKeys]);
    await redis.close();
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  });

  describe('migrations', () => {
    it('applies 001 once, records it, and skips it afterwards', async () => {
      const logs: string[] = [];
      expect(await runMigrations({ log: (line) => logs.push(line) })).toEqual({ applied: [1], skipped: [] });
      expect(logs.some((line) => line.includes('001-bootstrap'))).toBe(true);
      expect(await runMigrations()).toEqual({ applied: [], skipped: [1] });

      const status = await migrationStatus();
      expect(status[0]).toMatchObject({ id: 1, name: 'bootstrap' });
      expect(status[0]!.appliedAt).toBeInstanceOf(Date);
    });

    it('creates the indexes the primitives rely on', async () => {
      const workspaceIndexes = await WorkspaceModel.collection.indexes();
      expect(workspaceIndexes.find((index) => index.name === 'personal_workspace_per_owner')).toMatchObject({
        unique: true,
        partialFilterExpression: { type: 'personal' },
      });
      expect(workspaceIndexes.find((index) => index.key.slug)).toMatchObject({ unique: true });
      expect((await WorkspaceMemberModel.collection.indexes()).find((index) => index.key.workspaceId && index.key.userId)).toMatchObject({
        unique: true,
      });
      expect((await AuditEventModel.collection.indexes()).find((index) => index.key.expiresAt)).toMatchObject({
        expireAfterSeconds: 0,
      });
      expect((await UserModel.collection.indexes()).some((index) => index.key['identities.provider'] === 1)).toBe(true);
    });

    it('re-running 001 directly changes nothing', async () => {
      const before = await WorkspaceModel.collection.indexes();
      const context = { db: mongoose.connection.db!, connection: mongoose.connection, log: () => {} };
      await bootstrap.up(context);
      await bootstrap.up(context);
      expect(await WorkspaceModel.collection.indexes()).toEqual(before);
    });

    it('lets only one runner migrate at a time and releases the lock', async () => {
      const slow: Migration = { id: 998, name: 'slow', up: () => Bun.sleep(300) };
      const results = await Promise.allSettled([
        runMigrations({ migrations: [slow] }),
        Bun.sleep(50).then(() => runMigrations({ migrations: [slow] })),
      ]);
      expect(results[0]).toMatchObject({ status: 'fulfilled', value: { applied: [998] } });
      expect(results[1].status).toBe('rejected');
      expect((results[1] as PromiseRejectedResult).reason).toBeInstanceOf(MigrationLockedError);
      expect(await runMigrations({ migrations: [slow] })).toEqual({ applied: [], skipped: [998] });
    });

    it('leaves a failing migration pending and the lock free', async () => {
      const broken: Migration = {
        id: 997,
        name: 'broken',
        up: async () => {
          throw new Error('bad data');
        },
      };
      await expect(runMigrations({ migrations: [broken] })).rejects.toThrow('bad data');
      expect((await migrationStatus({ migrations: [broken] }))[0]!.appliedAt).toBeNull();
      expect(await runMigrations({ migrations: [{ ...broken, up: async () => {} }] })).toEqual({ applied: [997], skipped: [] });
    });
  });

  describe('workspace provisioning', () => {
    it('creates exactly one personal workspace under concurrent first requests', async () => {
      const user = await newUser('Concurrent');
      const results = await Promise.all(Array.from({ length: 12 }, () => ensurePersonalWorkspace(user)));

      const ids = new Set(results.map((result) => String(result.workspace._id)));
      expect(ids.size).toBe(1);
      const [workspaceId] = [...ids];
      expect(await WorkspaceModel.countDocuments({ ownerId: user._id, type: 'personal' })).toBe(1);
      expect(await WorkspaceMemberModel.countDocuments({ workspaceId })).toBe(1);
      expect(await WorkspaceMemberModel.findOne({ workspaceId })).toMatchObject({ role: 'owner', status: 'active' });
      expect(String((await UserModel.findById(user._id))!.defaultWorkspaceId)).toBe(workspaceId!);
    });

    it('resolves the same context for concurrent requests without a header', async () => {
      const user = await newUser('Middleware');
      const contexts = await Promise.all(Array.from({ length: 8 }, () => resolveWorkspaceContext(String(user._id))));
      expect(new Set(contexts.map((context) => String(context.workspace._id))).size).toBe(1);
      expect(await WorkspaceModel.countDocuments({ ownerId: user._id })).toBe(1);
    });

    it('enforces active membership for X-Workspace-Id', async () => {
      const owner = await newUser('Owner');
      const guest = await newUser('Guest');
      const team = await WorkspaceModel.create({ name: 'Team', slug: `team-${randomUUID().slice(0, 8)}`, type: 'team', ownerId: owner._id });
      await WorkspaceMemberModel.create({ workspaceId: team._id, userId: owner._id, role: 'owner' });
      const membership = await WorkspaceMemberModel.create({ workspaceId: team._id, userId: guest._id, role: 'viewer', status: 'suspended' });

      await expect(resolveWorkspaceContext(String(guest._id), String(team._id))).rejects.toMatchObject({ code: 'WORKSPACE_FORBIDDEN' });
      await WorkspaceMemberModel.updateOne({ _id: membership._id }, { status: 'active' });
      expect(String((await resolveWorkspaceContext(String(guest._id), String(team._id))).workspace._id)).toBe(String(team._id));
    });
  });

  describe('usage counters', () => {
    it('enforces the monthly quota in Redis, mirrors it to Mongo and survives a lost key', async () => {
      const { workspace } = await ensurePersonalWorkspace(await newUser('Quota'));
      for (let i = 0; i < 5; i += 1) await consumeUsage(workspace, 'import');
      await expect(consumeUsage(workspace, 'import')).rejects.toMatchObject({ code: 'PLAN_LIMIT_REACHED' });

      const filter = { workspaceId: workspace._id, period: usagePeriod(), counter: 'import' as const };
      expect((await UsageCounterModel.findOne(filter))!.value).toBe(5);

      // Redis restarted without persistence: the mirror restores the count.
      await redis.del(usageKey(String(workspace._id), usagePeriod(), 'import'));
      await expect(consumeUsage(workspace, 'import')).rejects.toMatchObject({ code: 'PLAN_LIMIT_REACHED' });
      expect(await redis.get(usageKey(String(workspace._id), usagePeriod(), 'import'))).toBe('5');
    });
  });

  describe('audit', () => {
    it('records request audits with plan-based retention', async () => {
      const user = await newUser('Auditor');
      const { workspace } = await ensurePersonalWorkspace(user);
      await audit(
        { user: { id: String(user._id) }, workspace, ip: '203.0.113.9', headers: { 'user-agent': 'bun-test' } },
        'media.upload',
        { type: 'media', id: 'm1' },
        { bytes: 10 },
      );
      const event = await AuditEventModel.findOne({ workspaceId: workspace._id, action: 'media.upload' }).lean();
      expect(event).toMatchObject({ actorType: 'user', targetType: 'media', targetId: 'm1', ip: '203.0.113.9', ua: 'bun-test', meta: { bytes: 10 } });
      const days = (event!.expiresAt!.getTime() - Date.now()) / 86_400_000;
      expect(Math.round(days)).toBe(30);

      workspace.planOverrides = { limits: { auditRetentionDays: null } };
      await audit({ actorType: 'system', workspace }, 'workspace.plan.set', { type: 'workspace', id: workspace._id });
      expect((await AuditEventModel.findOne({ action: 'workspace.plan.set', workspaceId: workspace._id }).lean())!.expiresAt).toBeNull();
    });
  });

  describe('scheduler on Redis', () => {
    it('runs each tick once across two instances', async () => {
      const name = `w0d-it-${randomUUID().slice(0, 8)}`;
      const ticks: number[] = [];
      const job: JobDefinition = { name, everyMs: 200, run: ({ tick }) => void ticks.push(tick) };
      const quiet = { log: () => {}, error: () => {} };
      const store = redisLockStore(redis as any);
      const a = new Scheduler({ jobs: [job], store, instanceId: 'a', log: quiet });
      const b = new Scheduler({ jobs: [job], store, instanceId: 'b', log: quiet });

      for (let tick = 1; tick <= 5; tick += 1) {
        const ran = await Promise.all([a.runTick(job, tick), b.runTick(job, tick)]);
        expect(ran.filter(Boolean)).toHaveLength(1);
      }
      a.start();
      b.start();
      await Bun.sleep(1_100);
      await Promise.all([a.stop(), b.stop()]);

      expect(ticks.slice(0, 5)).toEqual([1, 2, 3, 4, 5]);
      expect(ticks.length).toBeGreaterThanOrEqual(8);
      expect(new Set(ticks).size).toBe(ticks.length);
      const leftovers = await redis.keys(`jobs:{${name}}:*`);
      if (leftovers.length > 0) await redis.del(leftovers);
    });
  });

  describe.skipIf(!s3Enabled)('uploads through S3-compatible storage', () => {
    const bucket = `openpoll-w0d-test-${randomUUID().slice(0, 8)}`;
    // describe bodies run even when skipped, so nothing here may assume the S3 settings.
    const endpoint = (S3_TEST.endpoint ?? '').replace(/\/+$/, '');
    const settings = {
      endpoint,
      region: S3_TEST.region,
      bucket,
      accessKeyId: S3_TEST.accessKeyId ?? '',
      secretAccessKey: S3_TEST.secretAccessKey ?? '',
    };
    let s3: S3Storage;
    let client: Bun.S3Client;
    let previous: StorageDriver;

    /** Bun's client has no bucket API: sign CreateBucket/DeleteBucket (SigV4) by hand. */
    const bucketRequest = (method: 'PUT' | 'DELETE') => {
      const url = new URL(`${endpoint}/${bucket}`);
      const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '');
      const day = amzDate.slice(0, 8);
      const payloadHash = createHash('sha256').update('').digest('hex');
      const signedHeaders = 'host;x-amz-content-sha256;x-amz-date';
      const canonical = [
        method,
        url.pathname,
        '',
        `host:${url.host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n`,
        signedHeaders,
        payloadHash,
      ].join('\n');
      const scope = `${day}/${S3_TEST.region}/s3/aws4_request`;
      const toSign = ['AWS4-HMAC-SHA256', amzDate, scope, createHash('sha256').update(canonical).digest('hex')].join('\n');
      let signingKey: Buffer = createHmac('sha256', `AWS4${S3_TEST.secretAccessKey}`).update(day).digest();
      for (const part of [S3_TEST.region, 's3', 'aws4_request']) signingKey = createHmac('sha256', signingKey).update(part).digest();
      const signature = createHmac('sha256', signingKey).update(toSign).digest('hex');
      return fetch(url, {
        method,
        headers: {
          'x-amz-date': amzDate,
          'x-amz-content-sha256': payloadHash,
          Authorization: `AWS4-HMAC-SHA256 Credential=${S3_TEST.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
        },
      });
    };

    beforeAll(async () => {
      const response = await bucketRequest('PUT');
      if (!response.ok) throw new Error(`CreateBucket ${bucket} failed: ${response.status} ${await response.text()}`);
      s3 = new S3Storage({ ...settings, publicUrl: `${endpoint}/${bucket}` });
      client = new Bun.S3Client(settings);
      previous = setStorageDriver(s3);
    });

    afterAll(async () => {
      setStorageDriver(previous);
      for (const object of (await client.list()).contents ?? []) await client.delete(object.key);
      const response = await bucketRequest('DELETE');
      if (!response.ok) throw new Error(`DeleteBucket ${bucket} failed: ${response.status} ${await response.text()}`);
    });

    it('presigns, accepts the browser PUT, verifies and records the asset', async () => {
      const user = await newUser('Uploader');
      const { workspace, membership } = await ensurePersonalWorkspace(user);
      const ctx = { user: { id: String(user._id) }, workspace, membership };
      const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);

      const upload = await UploadsService.presign(ctx, { purpose: 'slide_image', mime: 'image/png', bytes: png.length });
      const put = await fetch(upload.url, { method: upload.method, headers: upload.headers, body: png });
      expect(put.status).toBe(200);

      const { asset, created } = await UploadsService.complete(ctx, upload.key);
      expect(created).toBe(true);
      expect(asset).toMatchObject({ key: upload.key, mime: 'image/png', bytes: png.length, url: `${endpoint}/${bucket}/${upload.key}` });
      expect(await MediaAssetModel.countDocuments({ key: upload.key })).toBe(1);
      expect(await (await s3.getObject(upload.key)).bytes()).toEqual(png);
    });

    it('deletes an upload whose stored type differs from the declaration', async () => {
      const user = await newUser('Sneaky');
      const { workspace, membership } = await ensurePersonalWorkspace(user);
      const ctx = { user: { id: String(user._id) }, workspace, membership };
      const upload = await UploadsService.presign(ctx, { purpose: 'slide_image', mime: 'image/png', bytes: 20 });
      await fetch(upload.url, { method: 'PUT', headers: { 'Content-Type': 'text/html' }, body: '<script>1</script>' });

      await expect(UploadsService.complete(ctx, upload.key)).rejects.toMatchObject({ code: 'UPLOAD_MISMATCH' });
      expect(await s3.stat(upload.key)).toBeNull();
    });
  });
});
