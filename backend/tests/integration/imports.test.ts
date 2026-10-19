import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'bun:test';
import mongoose from 'mongoose';
import { redisClient } from '../../src/common/config/redis';
import { setStorageDriver, type StorageDriver } from '../../src/common/storage/storage';
import { resolveWorkspaceContext } from '../../src/common/tenancy/workspaceContext.middleware';
import { ImportJobModel } from '../../src/modules/imports/import.model';
import { importKeys } from '../../src/modules/imports/queue';
import { PPTX_MIME } from '../../src/modules/imports/gslides';
import { PresentationModel } from '../../src/modules/presentations/models/presentation.model';
import { MediaAssetModel } from '../../src/modules/uploads/media.model';
import { WorkspaceModel } from '../../src/modules/workspaces/workspace.model';
import { WorkspaceMemberModel } from '../../src/modules/workspaces/workspaceMember.model';
import { ImportWorker, type ImportWorkerOptions } from '../../src/workers/import.worker';
import { MemoryStorage } from '../helpers/memoryStorage';
import { SAMPLE_PDF } from '../fixtures/import/constants';
import { buildPdf } from '../fixtures/imports/pdf';
import { PNG_1X1, buildPptx } from '../fixtures/imports/pptx';
import { BAD_ROWS, GOOD_ROWS, csvOf, xlsxOf } from '../fixtures/imports/questions';
import { createVerifiedUser, createPresentation, type TestUser } from './fixtures';
import { describeIntegration, resetTestData, startTestServer, type TestServer } from './harness';

/**
 * Imports through the real app and the real worker: job lifecycle, reaper,
 * authorization and workspace isolation, storage-off behaviour, usage limits
 * and the synchronous question import.
 */
describeIntegration('imports', () => {
  let server: TestServer;
  let memory: MemoryStorage;
  let previousStorage: StorageDriver;
  let user: TestUser;
  let workspaceId: string;
  let worker: ImportWorker | null = null;

  const FAST: Partial<ImportWorkerOptions> = { visibilityMs: 3000, graceMs: 100, reapEveryMs: 0, orphanAfterMs: 50, blockSeconds: 1, stopTimeoutMs: 5000 };

  const startWorker = (options: Partial<ImportWorkerOptions> = {}) => {
    worker = new ImportWorker({ ...FAST, ...options });
    worker.start();
    return worker;
  };

  beforeAll(async () => {
    server = await startTestServer();
    memory = new MemoryStorage();
    previousStorage = setStorageDriver(memory);
  }, 20_000);

  afterAll(async () => {
    await worker?.stop();
    setStorageDriver(previousStorage);
    await server?.close();
  });

  beforeEach(async () => {
    await worker?.stop();
    worker = null;
    await resetTestData();
    memory.objects.clear();
    user = await createVerifiedUser();
    workspaceId = String((await resolveWorkspaceContext(user.id)).workspace._id);
  });

  afterEach(async () => {
    await worker?.stop();
    worker = null;
  });

  /** Stores an uploaded source the way /api/uploads/complete leaves it. */
  const upload = async (bytes: Uint8Array, mime: string, ext: string, owner = user, workspace = workspaceId) => {
    const key = `uploads/${workspace}/import_source/202610/${new mongoose.Types.ObjectId()}.${ext}`;
    await memory.putObject(key, bytes, mime);
    await MediaAssetModel.create({ workspaceId: workspace, uploaderId: owner.id, key, url: memory.publicUrl(key), mime, bytes: bytes.length, source: 'upload', purpose: 'import_source' });
    return key;
  };

  const post = (body: unknown, who = user, extra: Record<string, string> = {}) =>
    server.request('/api/imports', { method: 'POST', headers: { ...who.headers, ...extra }, body });
  const getJob = async (id: string, who = user) => {
    const res = await server.request(`/api/imports/${id}`, { headers: who.headers });
    return { status: res.status, body: (await res.json()) as any };
  };
  const waitFor = async (id: string, done: (job: any) => boolean = (job) => job.status === 'completed' || job.status === 'failed') => {
    const deadline = Date.now() + 15_000;
    for (;;) {
      const { body } = await getJob(id);
      if (done(body.data)) return body.data;
      if (Date.now() > deadline) throw new Error(`Import ${id} did not finish: ${JSON.stringify(body.data)}`);
      await new Promise((resolve) => setTimeout(resolve, 40));
    }
  };

  const samplePptx = () =>
    buildPptx({
      title: 'Imported deck',
      slides: [
        { title: 'Welcome', subtitle: 'To the show' },
        { title: 'Agenda', body: [{ text: 'One' }, { text: 'Two', level: 1 }], notes: 'Say hi' },
        { title: 'Photo', pictures: [{ descr: 'A red dot', bytes: PNG_1X1 }] },
        { title: 'Numbers', body: ['Up'], chart: true },
      ],
    });

  describe('PPTX and PDF jobs', () => {
    it('imports a PPTX through the worker into a deck with stored pictures and warnings', async () => {
      const key = await upload(samplePptx(), PPTX_MIME, 'pptx');
      const res = await post({ kind: 'pptx', key });
      expect(res.status).toBe(202);
      const queued = ((await res.json()) as any).data;
      expect(queued).toMatchObject({ kind: 'pptx', status: 'queued', resultPresentationId: null, warnings: [], error: null });

      startWorker();
      const job = await waitFor(queued.id);
      expect(job).toMatchObject({ status: 'completed', error: null });
      expect(job.warnings.map((w: any) => w.code)).toEqual(['CHART_NOT_IMPORTED']);

      const deck = await PresentationModel.findById(job.resultPresentationId).lean();
      expect(deck).toMatchObject({ title: 'Imported deck', workspaceId: new mongoose.Types.ObjectId(workspaceId), creatorId: user.id });
      expect(deck!.slides.map((s: any) => s.type)).toEqual(['heading', 'bullets', 'image', 'paragraph']);
      expect(deck!.slides[1]).toMatchObject({ notes: 'Say hi' });
      const image = deck!.slides[2] as any;
      expect(image.content.alt).toBe('A red dot');
      expect(image.content.key).toStartWith(`uploads/${workspaceId}/import/${job.id}/`);
      expect(memory.objects.get(image.content.key)?.type).toBe('image/png');
      expect(await MediaAssetModel.findOne({ key: image.content.key })).toMatchObject({ source: 'import', mime: 'image/png' });
    });

    it('imports a PDF as one image slide per page, with page text in notes and alt', async () => {
      const pdf = await buildPdf(SAMPLE_PDF.pages.map((p) => ({ title: p.title, body: p.body })));
      const key = await upload(pdf, 'application/pdf', 'pdf');
      const queued = ((await (await post({ kind: 'pdf', key, title: 'My PDF' })).json()) as any).data;
      startWorker();
      const job = await waitFor(queued.id);
      expect(job.status).toBe('completed');
      const deck = await PresentationModel.findById(job.resultPresentationId).lean();
      expect(deck!.title).toBe('My PDF');
      expect(deck!.slides.map((s: any) => s.type)).toEqual(['image', 'image']);
      const first = deck!.slides[0] as any;
      expect(first.notes).toContain(SAMPLE_PDF.pages[0].title);
      expect(first.content.alt).toContain(SAMPLE_PDF.pages[0].title);
      const png = memory.objects.get(first.content.key)!;
      expect(png.type).toBe('image/png');
      expect(Array.from(png.bytes.subarray(1, 4))).toEqual([0x50, 0x4e, 0x47]);
    });

    it('imports a public Google Slides link through the SSRF-guarded fetch', async () => {
      const id = '1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-aBcDe';
      const requested: string[] = [];
      startWorker({
        pipeline: {
          resolve: async () => ['142.250.74.78'],
          fetchImpl: (async (url: URL) => {
            requested.push(String(url));
            return new Response(buildPptx({ slides: [{ title: 'From Slides', pictures: [{ descr: 'pic' }] }] }), { headers: { 'content-type': PPTX_MIME } });
          }) as unknown as typeof fetch,
        },
      });
      const res = await post({ kind: 'gslides', url: `https://docs.google.com/presentation/d/${id}/edit?usp=sharing` });
      expect(res.status).toBe(202);
      const job = await waitFor(((await res.json()) as any).data.id);
      expect(job.status).toBe('completed');
      expect(requested).toEqual([`https://docs.google.com/presentation/d/${id}/export/pptx`]);
      const deck = await PresentationModel.findById(job.resultPresentationId).lean();
      expect(deck!.slides.map((s: any) => s.type)).toEqual(['image']);
    });

    describe('with a Gotenberg renderer', () => {
      const deckWithChart = () =>
        buildPptx({
          slides: [
            { title: 'Intro' },
            { title: 'Hidden backup', hidden: true },
            { title: 'Revenue', body: ['Up and to the right'], chart: true, notes: 'Walk through the curve' },
            { smartArt: true },
          ],
        });
      const renderedPdf = () => buildPdf([{ title: 'Intro' }, { title: 'Revenue chart' }, { title: 'Diagram' }]);

      it('replaces slides it cannot edit with a rendered picture and keeps their notes', async () => {
        const key = await upload(deckWithChart(), PPTX_MIME, 'pptx');
        const calls: string[] = [];
        const pdf = await renderedPdf();
        startWorker({
          pipeline: {
            gotenbergUrl: 'http://gotenberg.test:3000',
            fetchImpl: (async (url: string) => {
              calls.push(url);
              return new Response(pdf, { status: 200 });
            }) as unknown as typeof fetch,
          },
        });
        const queued = ((await (await post({ kind: 'pptx', key })).json()) as any).data;
        const job = await waitFor(queued.id);
        expect(job.status).toBe('completed');
        expect(calls).toEqual(['http://gotenberg.test:3000/forms/libreoffice/convert']);
        expect(job.warnings.map((w: any) => w.code).sort()).toEqual(['SLIDE_HIDDEN', 'SLIDE_RENDERED', 'SLIDE_RENDERED']);

        const deck = await PresentationModel.findById(job.resultPresentationId).lean();
        expect(deck!.slides.map((s: any) => s.type)).toEqual(['heading', 'image', 'image']);
        const chart = deck!.slides[1] as any;
        expect(chart.notes).toBe('Walk through the curve');
        expect(chart.content.alt).toContain('Revenue');
        expect(memory.objects.get(chart.content.key)?.type).toBe('image/png');
      });

      it('falls back to editable text with a warning when the renderer is down', async () => {
        const key = await upload(deckWithChart(), PPTX_MIME, 'pptx');
        startWorker({
          pipeline: { gotenbergUrl: 'http://gotenberg.test:3000', fetchImpl: (async () => new Response('boom', { status: 502 })) as unknown as typeof fetch },
        });
        const queued = ((await (await post({ kind: 'pptx', key })).json()) as any).data;
        const job = await waitFor(queued.id);
        expect(job.status).toBe('completed');
        const codes = job.warnings.map((w: any) => w.code);
        expect(codes).toContain('RENDER_UNAVAILABLE');
        expect(codes).toContain('CHART_NOT_IMPORTED');
        expect(codes).toContain('SLIDE_SKIPPED');
        const deck = await PresentationModel.findById(job.resultPresentationId).lean();
        expect(deck!.slides.map((s: any) => s.type)).toEqual(['heading', 'paragraph']);
      });
    });

    it('fails with a readable message, once, when the file is not a presentation', async () => {
      const key = await upload(new TextEncoder().encode('PK not really a deck'), PPTX_MIME, 'pptx');
      const queued = ((await (await post({ kind: 'pptx', key })).json()) as any).data;
      startWorker();
      const job = await waitFor(queued.id);
      expect(job.status).toBe('failed');
      expect(job.error.message).toContain('could not be read as a PowerPoint');
      expect(job.resultPresentationId).not.toBeNull();
      expect(await PresentationModel.findById(job.resultPresentationId)).toBeNull();
      expect((await ImportJobModel.findById(queued.id))!.attempts).toBe(1);
    });

    it('fails a Google link that is private without retrying', async () => {
      startWorker({
        pipeline: { resolve: async () => ['142.250.74.78'], fetchImpl: (async () => new Response(null, { status: 302, headers: { location: 'https://accounts.google.com/login' } })) as unknown as typeof fetch },
      });
      const res = await post({ kind: 'gslides', url: 'https://docs.google.com/presentation/d/1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-aBcDe/edit' });
      const job = await waitFor(((await res.json()) as any).data.id);
      expect(job).toMatchObject({ status: 'failed', error: { code: 'GSLIDES_PRIVATE' } });
      expect((await ImportJobModel.findById(job.id))!.attempts).toBe(1);
    });

    it('retries a transient failure and gives up with a generic message after the last attempt', async () => {
      const key = await upload(samplePptx(), PPTX_MIME, 'pptx');
      let failures = 1;
      const original = memory.getObject.bind(memory);
      memory.getObject = async (k: string) => {
        if (failures-- > 0) throw new Error('S3 hiccup');
        return original(k);
      };
      try {
        const queued = ((await (await post({ kind: 'pptx', key })).json()) as any).data;
        startWorker();
        const job = await waitFor(queued.id);
        expect(job.status).toBe('completed');
        expect((await ImportJobModel.findById(queued.id))!.attempts).toBe(2);

        await worker!.stop();
        failures = 99;
        const again = ((await (await post({ kind: 'pptx', key })).json()) as any).data;
        startWorker({ maxAttempts: 2 });
        const dead = await waitFor(again.id);
        expect(dead).toMatchObject({ status: 'failed', error: { code: 'IMPORT_FAILED' } });
        expect(dead.error.message).not.toContain('hiccup');
        expect((await ImportJobModel.findById(again.id))!.attempts).toBe(2);
      } finally {
        memory.getObject = original;
      }
    });

    it('does not create a second deck when a finished run is repeated', async () => {
      const key = await upload(samplePptx(), PPTX_MIME, 'pptx');
      const queued = ((await (await post({ kind: 'pptx', key })).json()) as any).data;
      startWorker();
      const job = await waitFor(queued.id);
      await worker!.stop();
      // A crash after the deck was created but before the job was marked done.
      await ImportJobModel.updateOne({ _id: queued.id }, { $set: { status: 'queued', finishedAt: null } });
      await redisClient.lPush(importKeys.pending, queued.id);
      startWorker();
      await waitFor(queued.id, (j) => j.status === 'completed' && j.id === queued.id);
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(await PresentationModel.countDocuments({ creatorId: user.id })).toBe(1);
      expect((await ImportJobModel.findById(queued.id))!.resultPresentationId?.toString()).toBe(job.resultPresentationId);
    });
  });

  describe('queue reaper', () => {
    /** One reaper pass at `now`; the lock from the previous pass is cleared so passes can follow each other. */
    const reap = async (reaper: ImportWorker, now: number) => {
      await redisClient.del(importKeys.reaperLock);
      return reaper.reapOnce(now);
    };
    const takeWithoutWorker = async () => {
      const id = await redisClient.blMove(importKeys.pending, importKeys.processing, 'RIGHT', 'LEFT', 1);
      expect(id).not.toBeNull();
      return id!;
    };

    it('puts a job a dead worker left behind back in the queue, then it completes', async () => {
      const key = await upload(samplePptx(), PPTX_MIME, 'pptx');
      const queued = ((await (await post({ kind: 'pptx', key })).json()) as any).data;
      const id = await takeWithoutWorker();
      await ImportJobModel.updateOne({ _id: id }, { $set: { status: 'running', attempts: 1, leaseOwner: 'dead-worker' } });

      const reaper = new ImportWorker({ ...FAST });
      expect(await reap(reaper, Date.now())).toEqual({ requeued: [], failed: [] }); // seen, but not yet for the grace period
      expect(await redisClient.lRange(importKeys.processing, 0, -1)).toEqual([id]);
      await new Promise((resolve) => setTimeout(resolve, 150));
      const result = await reap(reaper, Date.now() + 1000);
      expect(result).toEqual({ requeued: [id], failed: [] });
      expect(await redisClient.lRange(importKeys.pending, 0, -1)).toEqual([id]);
      expect(await redisClient.lRange(importKeys.processing, 0, -1)).toEqual([]);

      startWorker();
      const job = await waitFor(queued.id);
      expect(job.status).toBe('completed');
      expect((await ImportJobModel.findById(id))!.attempts).toBe(2);
    });

    it('leaves a job alone while its lease is alive', async () => {
      const key = await upload(samplePptx(), PPTX_MIME, 'pptx');
      await post({ kind: 'pptx', key });
      const id = await takeWithoutWorker();
      await redisClient.set(importKeys.lease(id), 'busy-worker', { PX: 60_000 });
      const reaper = new ImportWorker({ ...FAST });
      await reap(reaper, Date.now());
      expect(await reap(reaper, Date.now() + 10_000)).toEqual({ requeued: [], failed: [] });
      expect(await redisClient.lRange(importKeys.processing, 0, -1)).toEqual([id]);
    });

    it('fails a job that keeps being abandoned, with a human error', async () => {
      const key = await upload(samplePptx(), PPTX_MIME, 'pptx');
      const queued = ((await (await post({ kind: 'pptx', key })).json()) as any).data;
      const id = await takeWithoutWorker();
      await ImportJobModel.updateOne({ _id: id }, { $set: { status: 'running', attempts: 3 } });
      const reaper = new ImportWorker({ ...FAST, maxAttempts: 3 });
      await reap(reaper, Date.now());
      await new Promise((resolve) => setTimeout(resolve, 150));
      expect(await reap(reaper, Date.now() + 1000)).toEqual({ requeued: [], failed: [id] });
      const job = (await getJob(queued.id)).body.data;
      expect(job).toMatchObject({ status: 'failed', error: { code: 'IMPORT_INTERRUPTED' } });
      expect(job.error.message).toContain('interrupted');
      expect(await redisClient.lRange(importKeys.processing, 0, -1)).toEqual([]);
    });

    it('re-queues unfinished jobs that Redis lost', async () => {
      const key = await upload(samplePptx(), PPTX_MIME, 'pptx');
      const queued = ((await (await post({ kind: 'pptx', key })).json()) as any).data;
      await redisClient.flushDb();
      await ImportJobModel.updateOne({ _id: queued.id }, { $set: { queuedAt: new Date(Date.now() - 60_000) } });
      const reaper = new ImportWorker({ ...FAST });
      expect((await reap(reaper, Date.now())).requeued).toEqual([queued.id]);
      startWorker();
      expect((await waitFor(queued.id)).status).toBe('completed');
    });

    it('lets one reaper run at a time', async () => {
      const a = new ImportWorker({ ...FAST, reapEveryMs: 60_000, instanceId: 'a' });
      const b = new ImportWorker({ ...FAST, reapEveryMs: 60_000, instanceId: 'b' });
      await a.reapOnce();
      const key = await upload(samplePptx(), PPTX_MIME, 'pptx');
      await post({ kind: 'pptx', key });
      const id = await takeWithoutWorker();
      await redisClient.del(importKeys.lease(id));
      await b.reapOnce(Date.now()); // blocked by a's lock: does not even note the suspect
      expect(await redisClient.hGetAll(importKeys.suspects)).toEqual({});
    });
  });

  describe('authorization and isolation', () => {
    it('requires authentication', async () => {
      expect((await server.request('/api/imports', { method: 'POST', body: { kind: 'pptx', key: 'x' } })).status).toBe(401);
      expect((await server.request('/api/imports/abc')).status).toBe(401);
      expect((await server.request('/api/imports/questions', { method: 'POST' })).status).toBe(401);
    });

    it('shows a job to its creator only', async () => {
      const key = await upload(samplePptx(), PPTX_MIME, 'pptx');
      const queued = ((await (await post({ kind: 'pptx', key })).json()) as any).data;
      const stranger = await createVerifiedUser();
      expect((await getJob(queued.id, stranger)).status).toBe(404);
      expect((await getJob('not-an-id')).status).toBe(404);
      expect((await getJob(String(new mongoose.Types.ObjectId()))).status).toBe(404);
      expect((await getJob(queued.id)).status).toBe(200);

      // A teammate in the same workspace is not the creator either.
      await WorkspaceMemberModel.create({ workspaceId, userId: stranger.id, role: 'editor', status: 'active' });
      expect((await getJob(queued.id, stranger)).status).toBe(404);

      // The creator loses access with the membership.
      await WorkspaceMemberModel.updateOne({ workspaceId, userId: user.id }, { $set: { status: 'suspended' } });
      expect((await getJob(queued.id)).status).toBe(404);
    });

    it('refuses sources from another workspace, unknown keys and the wrong file type', async () => {
      const stranger = await createVerifiedUser();
      const strangerWorkspace = String((await resolveWorkspaceContext(stranger.id)).workspace._id);
      const theirKey = await upload(samplePptx(), PPTX_MIME, 'pptx', stranger, strangerWorkspace);
      const res = await post({ kind: 'pptx', key: theirKey });
      expect(res.status).toBe(404);
      expect(await res.json()).toMatchObject({ code: 'UPLOAD_NOT_FOUND' });
      expect((await post({ kind: 'pptx', key: 'uploads/nope.pptx' })).status).toBe(404);

      const pdfKey = await upload(await buildPdf([{ title: 'x' }]), 'application/pdf', 'pdf');
      const mismatch = await post({ kind: 'pptx', key: pdfKey });
      expect(mismatch.status).toBe(400);
      expect(await mismatch.json()).toMatchObject({ code: 'IMPORT_KIND_MISMATCH' });
      expect(await ImportJobModel.countDocuments()).toBe(0);
    });

    it('needs the deck:create permission', async () => {
      const viewer = await createVerifiedUser();
      await WorkspaceMemberModel.create({ workspaceId, userId: viewer.id, role: 'viewer', status: 'active' });
      const key = await upload(samplePptx(), PPTX_MIME, 'pptx');
      const res = await post({ kind: 'pptx', key }, viewer, { 'X-Workspace-Id': workspaceId });
      expect(res.status).toBe(403);
      expect(await ImportJobModel.countDocuments()).toBe(0);
    });

    it('validates the request body', async () => {
      for (const body of [
        {},
        { kind: 'docx', key: 'x' },
        { kind: 'pptx' },
        { kind: 'gslides' },
        { kind: 'gslides', url: 'https://docs.google.com/presentation/d/x', driveFileId: 'abcdefghijk', driveAccessToken: 'tokentokentoken' },
        { kind: 'gslides', driveFileId: 'abcdefghijk' },
      ]) {
        expect((await post(body)).status).toBe(400);
      }
      const bad = await post({ kind: 'gslides', url: 'https://evil.example/presentation/d/1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789' });
      expect(bad.status).toBe(400);
      expect(await bad.json()).toMatchObject({ code: 'INVALID_LINK' });
    });

    it('answers 503 for Drive imports while Drive import is not configured', async () => {
      const res = await post({ kind: 'gslides', driveFileId: '1aBcDeFgHiJkLmNoPqRsTuVwXyZ', driveAccessToken: 'ya29.tokentokentoken' });
      expect(res.status).toBe(503);
      expect(await res.json()).toMatchObject({ code: 'GOOGLE_DRIVE_DISABLED' });
    });
  });

  describe('storage disabled', () => {
    it('answers 503 STORAGE_DISABLED for uploaded files and still accepts Google links', async () => {
      const off = setStorageDriver(new (await import('../../src/common/storage/storage')).DisabledStorage());
      try {
        const res = await post({ kind: 'pptx', key: 'uploads/x/y.pptx' });
        expect(res.status).toBe(503);
        expect(await res.json()).toMatchObject({ success: false, code: 'STORAGE_DISABLED' });
        expect((await post({ kind: 'pdf', key: 'uploads/x/y.pdf' })).status).toBe(503);

        startWorker({
          pipeline: {
            resolve: async () => ['142.250.74.78'],
            fetchImpl: (async () => new Response(buildPptx({ slides: [{ title: 'Text only' }, { title: 'Pic', pictures: [{}] }] }), { headers: { 'content-type': PPTX_MIME } })) as unknown as typeof fetch,
          },
        });
        const link = await post({ kind: 'gslides', url: 'https://docs.google.com/presentation/d/1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-aBcDe/edit' });
        expect(link.status).toBe(202);
        const job = await waitFor(((await link.json()) as any).data.id);
        expect(job.status).toBe('completed');
        expect(job.warnings.map((w: any) => w.code)).toContain('PICTURES_NOT_STORED');
        const deck = await PresentationModel.findById(job.resultPresentationId).lean();
        expect(deck!.slides.map((s: any) => s.type)).toEqual(['heading', 'image']);
        expect((deck!.slides[1] as any).content.key).toBeNull();
      } finally {
        setStorageDriver(off);
      }
    });
  });

  describe('plan limit', () => {
    it('counts each import against importsPerMonth, and a repeated request for a running job counts once', async () => {
      await WorkspaceModel.updateOne({ _id: workspaceId }, { $set: { planOverrides: { limits: { importsPerMonth: 2 } } } });
      const keyA = await upload(samplePptx(), PPTX_MIME, 'pptx');
      const keyB = await upload(samplePptx(), PPTX_MIME, 'pptx');
      const keyC = await upload(samplePptx(), PPTX_MIME, 'pptx');
      const first = ((await (await post({ kind: 'pptx', key: keyA })).json()) as any).data;
      const repeat = ((await (await post({ kind: 'pptx', key: keyA })).json()) as any).data;
      expect(repeat.id).toBe(first.id);
      expect((await post({ kind: 'pptx', key: keyB })).status).toBe(202);
      const over = await post({ kind: 'pptx', key: keyC });
      expect(over.status).toBe(403);
      expect(await over.json()).toMatchObject({ code: 'PLAN_LIMIT_REACHED' });
      expect(await ImportJobModel.countDocuments()).toBe(2);
    });
  });

  describe('questions import', () => {
    const questions = (file: Uint8Array | null, fields: Record<string, string> = {}, who = user, name = 'quiz.csv', extra: Record<string, string> = {}) => {
      const form = new FormData();
      if (file) form.append('file', new Blob([file]), name);
      for (const [key, value] of Object.entries(fields)) form.append(key, value);
      return server.request('/api/imports/questions', { method: 'POST', headers: { ...who.headers, ...extra }, body: form as never });
    };
    const csv = (rows = GOOD_ROWS) => new TextEncoder().encode(csvOf(rows));

    it('previews without writing anything', async () => {
      const res = await questions(csv([...GOOD_ROWS, ...BAD_ROWS.slice(0, 2)]), { mode: 'preview' });
      expect(res.status).toBe(200);
      const { data } = (await res.json()) as any;
      expect(data).toMatchObject({ mode: 'preview', fileKind: 'csv', imported: GOOD_ROWS.length, skipped: 2, totalRows: GOOD_ROWS.length + 2 });
      expect(data.errors.map((e: any) => e.row)).toEqual([10, 11]);
      expect(data.questions[0]).toMatchObject({ row: 2, type: 'select_answer', question: 'Capital of France?' });
      expect(await PresentationModel.countDocuments()).toBe(0);
      expect(await ImportJobModel.countDocuments()).toBe(0);
    });

    it('creates a new deck with the right slides and records a completed import', async () => {
      const res = await questions(csv([...GOOD_ROWS, BAD_ROWS[0]!]), {});
      expect(res.status).toBe(201);
      const { data } = (await res.json()) as any;
      expect(data).toMatchObject({ mode: 'import', created: true, imported: GOOD_ROWS.length, skipped: 1, slideCount: GOOD_ROWS.length });
      const deck = await PresentationModel.findById(data.presentationId).lean();
      expect(deck).toMatchObject({ title: 'quiz', creatorId: user.id });
      expect(deck!.slides.map((s: any) => s.type)).toEqual(['select_answer', 'select_answer', 'select_answer', 'type_answer', 'wordcloud', 'open_ended', 'scales', 'ranking']);
      expect(deck!.slides[0]).toMatchObject({ question: 'Capital of France?', timeLimit: 20 });
      const job = (await getJob(data.importId)).body.data;
      expect(job).toMatchObject({ kind: 'csv', status: 'completed', resultPresentationId: data.presentationId });
    });

    it('reads XLSX the same way and honours a title', async () => {
      const res = await questions(await xlsxOf(GOOD_ROWS), { title: 'From Excel' }, user, 'q.xlsx');
      const { data } = (await res.json()) as any;
      expect(data).toMatchObject({ fileKind: 'xlsx', imported: GOOD_ROWS.length });
      expect((await PresentationModel.findById(data.presentationId))!.title).toBe('From Excel');
    });

    it('appends to an editable deck and respects the 50-slide cap', async () => {
      const deck = await createPresentation(server, user);
      const res = await questions(csv(GOOD_ROWS.slice(0, 3)), { presentationId: deck._id });
      expect(res.status).toBe(201);
      expect(((await res.json()) as any).data).toMatchObject({ created: false, presentationId: deck._id, slideCount: 4 });
      const stored = await PresentationModel.findById(deck._id).lean();
      expect(stored!.slides.map((s: any) => s.question)).toEqual(['Pick one', 'Capital of France?', 'Pick the primes', 'Favourite colour?']);

      // Room for 46 more only.
      await PresentationModel.updateOne({ _id: deck._id }, { $set: { slides: Array.from({ length: 48 }, (_, i) => ({ type: 'open_ended', question: `Q${i}`, timeLimit: 0 })) } });
      const full = await questions(csv(GOOD_ROWS.slice(0, 4)), { presentationId: deck._id, mode: 'preview' });
      expect(((await full.json()) as any).data).toMatchObject({ imported: 2, skipped: 2, capacity: 2 });
    });

    it('does not let others append to a deck or write into a workspace they cannot', async () => {
      const deck = await createPresentation(server, user);
      const stranger = await createVerifiedUser();
      const res = await questions(csv(), { presentationId: deck._id }, stranger);
      expect(res.status).toBe(403);
      expect((await PresentationModel.findById(deck._id))!.slides).toHaveLength(1);

      const viewer = await createVerifiedUser();
      await WorkspaceMemberModel.create({ workspaceId, userId: viewer.id, role: 'viewer', status: 'active' });
      expect((await questions(csv(), {}, viewer, 'q.csv', { 'X-Workspace-Id': workspaceId })).status).toBe(403);
      expect((await questions(csv(), { presentationId: deck._id }, viewer, 'q.csv', { 'X-Workspace-Id': workspaceId })).status).toBe(403);
    });

    it('refuses a deck that is being presented', async () => {
      const deck = await createPresentation(server, user);
      await PresentationModel.updateOne({ _id: deck._id }, { $set: { status: 'active' } });
      expect((await questions(csv(), { presentationId: deck._id })).status).toBe(400);
    });

    it('rejects bad uploads with clear errors', async () => {
      expect((await questions(null)).status).toBe(400);
      const noValid = await questions(csv(BAD_ROWS), {});
      expect(noValid.status).toBe(400);
      expect(await noValid.json()).toMatchObject({ code: 'NO_VALID_QUESTIONS', details: { errors: expect.any(Array) } });
      const wrongHeader = await questions(new TextEncoder().encode('a,b\r\n1,2'), {});
      expect(wrongHeader.status).toBe(400);
      expect(await wrongHeader.json()).toMatchObject({ code: 'QUESTIONS_HEADER_INVALID' });
      const big = await questions(new Uint8Array(2 * 1024 * 1024 + 10), {});
      expect(big.status).toBe(413);
      const bogus = await questions(csv(), { mode: 'whatever' });
      expect(bogus.status).toBe(400);
      const json = await server.request('/api/imports/questions', { method: 'POST', headers: user.headers, body: { file: 'x' } });
      expect(json.status).toBe(415);
      expect(await PresentationModel.countDocuments()).toBe(0);
    });

    it('serves the CSV and XLSX templates, which import cleanly', async () => {
      const csvRes = await server.request('/api/imports/templates/questions.csv');
      expect(csvRes.status).toBe(200);
      expect(csvRes.headers.get('content-type')).toContain('text/csv');
      expect(csvRes.headers.get('content-disposition')).toContain('attachment');
      const csvBytes = new Uint8Array(await csvRes.arrayBuffer());
      const xlsxRes = await server.request('/api/imports/templates/questions.xlsx');
      expect(xlsxRes.status).toBe(200);
      expect(xlsxRes.headers.get('content-type')).toContain('spreadsheetml');
      const xlsxBytes = new Uint8Array(await xlsxRes.arrayBuffer());
      expect((await server.request('/api/imports/templates/questions.pdf')).status).toBe(404);

      for (const [bytes, name] of [[csvBytes, 't.csv'], [xlsxBytes, 't.xlsx']] as const) {
        const res = await questions(bytes, { mode: 'preview' }, user, name);
        expect(((await res.json()) as any).data).toMatchObject({ skipped: 0, imported: 8 });
      }
    });
  });

  describe('rate limits', () => {
    it('limits job creation per account', async () => {
      const statuses: number[] = [];
      for (let i = 0; i < 12; i++) statuses.push((await post({})).status);
      expect(statuses.slice(0, 10).every((status) => status === 400)).toBe(true);
      expect(statuses.slice(10)).toEqual([429, 429]);
    });
  });
});
