import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import mongoose from 'mongoose';
import { redisClient } from '../src/common/config/redis';
import { errorHandler } from '../src/common/middlewares/errorHandler';
import { S3Storage } from '../src/common/storage/s3.storage';
import {
  DisabledStorage,
  setStorageDriver,
  storage,
  type StorageDriver,
  type StoredObjectInfo,
} from '../src/common/storage/storage';
import { MediaAssetModel } from '../src/modules/uploads/media.model';
import { UploadsController } from '../src/modules/uploads/uploads.controller';
import { UploadsService, pendingUploadKey } from '../src/modules/uploads/uploads.service';
import { captureNext, mockReq, mockRes } from './helpers/http';

const WS_ID = '64b0000000000000000000a1';
const USER_ID = '64b0000000000000000000c3';
const S3_CONFIG = {
  endpoint: 'http://127.0.0.1:9000',
  region: 'auto',
  bucket: 'media',
  accessKeyId: 'a',
  secretAccessKey: 's',
  publicUrl: 'https://cdn.example/media/',
};

const rejection = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (error) {
    return error as any;
  }
  throw new Error('expected a rejection');
};

describe('storage disabled', () => {
  const driver = new DisabledStorage();

  it('fails every operation with 503 STORAGE_DISABLED', async () => {
    const expected = { statusCode: 503, code: 'STORAGE_DISABLED' };
    expect(driver.enabled).toBe(false);
    expect(await rejection(driver.presignPut())).toMatchObject(expected);
    expect(await rejection(driver.stat())).toMatchObject(expected);
    expect(await rejection(driver.getObject())).toMatchObject(expected);
    expect(await rejection(driver.putObject())).toMatchObject(expected);
    expect(await rejection(driver.delete())).toMatchObject(expected);
    expect(() => driver.publicUrl()).toThrow(expect.objectContaining(expected));
  });

  it('makes POST /api/uploads/presign answer 503 with the code', async () => {
    const previous = setStorageDriver(new DisabledStorage());
    try {
      expect(storage.enabled).toBe(false);
      const { next, calls } = captureNext();
      const req = Object.assign(mockReq({ body: { purpose: 'slide_image', mime: 'image/png', bytes: 10 } }), {
        user: { id: USER_ID, email: 'a@example.com', name: 'A', role: 'user' },
        workspace: { _id: WS_ID },
        membership: { role: 'owner', status: 'active', workspaceId: WS_ID },
      });
      await UploadsController.presign(req, mockRes() as any, next);
      const res = mockRes();
      errorHandler(calls[0], req, res as any, () => {});
      expect(res.statusCode).toBe(503);
      expect(res.body).toMatchObject({ success: false, code: 'STORAGE_DISABLED' });
    } finally {
      setStorageDriver(previous);
    }
  });
});

describe('S3Storage', () => {
  const objects = new Map<string, { size: number; type: string }>();
  const presigned: Array<{ key: string; options: any }> = [];
  const fakeClient = {
    presign: (key: string, options: any) => {
      presigned.push({ key, options });
      return `http://127.0.0.1:9000/media/${key}?X-Amz-Signature=sig`;
    },
    file: (key: string) => ({
      stat: async () => {
        const object = objects.get(key);
        if (!object) throw Object.assign(new Error('The specified key does not exist.'), { name: 'S3Error', code: 'NoSuchKey' });
        return { ...object, etag: '"etag"', lastModified: new Date(0) };
      },
      stream: () => new Blob(['data']).stream(),
      bytes: async () => new Uint8Array([1, 2, 3]),
      text: async () => 'data',
    }),
    write: async (key: string, body: string, options: { type: string }) => {
      objects.set(key, { size: body.length, type: options.type });
      return body.length;
    },
    delete: async (key: string) => {
      if (!objects.delete(key)) throw Object.assign(new Error('missing'), { code: 'NoSuchKey' });
    },
  };
  const s3 = new S3Storage(S3_CONFIG, fakeClient as unknown as Bun.S3Client);

  beforeEach(() => {
    objects.clear();
    presigned.length = 0;
  });

  it('presigns a PUT the client sends with the declared Content-Type', async () => {
    const upload = await s3.presignPut('uploads/a/b.png', 'image/png', 1024);
    expect(presigned).toEqual([{ key: 'uploads/a/b.png', options: { method: 'PUT', expiresIn: 900 } }]);
    expect(upload).toMatchObject({ key: 'uploads/a/b.png', method: 'PUT', headers: { 'Content-Type': 'image/png' } });
    expect(upload.expiresAt.getTime()).toBeGreaterThan(Date.now() + 800_000);
  });

  it('rejects keys that escape their prefix or are not plain paths', async () => {
    for (const key of ['/abs.png', 'a/../b.png', 'a//b.png', 'a/./b', 'sp ace.png', '']) {
      expect(await rejection(s3.presignPut(key, 'image/png', 1))).toMatchObject({ statusCode: 400 });
    }
  });

  it('builds public URLs from the configured base', () => {
    expect(s3.publicUrl('uploads/ws/deck_1/a.png')).toBe('https://cdn.example/media/uploads/ws/deck_1/a.png');
  });

  it('stats, reads, writes and deletes objects', async () => {
    await s3.putObject('exports/a.zip', 'zipdata', 'application/zip');
    expect(await s3.stat('exports/a.zip')).toMatchObject({ key: 'exports/a.zip', size: 7, type: 'application/zip' });
    const object = await s3.getObject('exports/a.zip');
    expect(await object.text()).toBe('data');
    await s3.delete('exports/a.zip');
    expect(await s3.stat('exports/a.zip')).toBeNull();
    // Deleting again is fine; reading a missing object is a 404.
    await s3.delete('exports/a.zip');
    expect(await rejection(s3.getObject('exports/a.zip'))).toMatchObject({ statusCode: 404, code: 'STORAGE_OBJECT_NOT_FOUND' });
  });
});

describe('uploads service', () => {
  /** Stands in for the bucket: the "browser" PUT is simulated by writing into `bucket`. */
  const bucket = new Map<string, StoredObjectInfo>();
  const fakeDriver: StorageDriver = {
    enabled: true,
    presignPut: async (key, mime) => ({
      key,
      url: `https://bucket.example/${key}?sig`,
      method: 'PUT',
      headers: { 'Content-Type': mime },
      expiresAt: new Date(Date.now() + 900_000),
    }),
    publicUrl: (key) => `https://cdn.example/${key}`,
    stat: async (key) => bucket.get(key) ?? null,
    getObject: async () => {
      throw new Error('unused');
    },
    putObject: async () => {},
    delete: async (key) => void bucket.delete(key),
  };
  const redisStore = new Map<string, string>();
  const assets: any[] = [];
  const saved = {
    set: redisClient.set,
    get: redisClient.get,
    del: redisClient.del,
    findOne: MediaAssetModel.findOne,
    create: MediaAssetModel.create,
  };
  let previousDriver: StorageDriver;

  const ctx = (role = 'editor', userId = USER_ID) =>
    ({
      user: { id: userId },
      workspace: { _id: new mongoose.Types.ObjectId(WS_ID) },
      membership: { role, status: 'active', workspaceId: WS_ID },
    }) as any;

  beforeEach(() => {
    bucket.clear();
    redisStore.clear();
    assets.length = 0;
    previousDriver = setStorageDriver(fakeDriver);
    (redisClient as any).set = async (key: string, value: string) => {
      redisStore.set(key, value);
      return 'OK';
    };
    (redisClient as any).get = async (key: string) => redisStore.get(key) ?? null;
    (redisClient as any).del = async (key: string) => Number(redisStore.delete(key));
    (MediaAssetModel as any).findOne = async (filter: any) =>
      assets.find((asset) => asset.key === filter.key && String(asset.workspaceId) === String(filter.workspaceId)) ?? null;
    (MediaAssetModel as any).create = async (data: any) => {
      const asset = { _id: new mongoose.Types.ObjectId(), ...data };
      assets.push(asset);
      return asset;
    };
  });

  afterEach(() => {
    setStorageDriver(previousDriver);
    Object.assign(redisClient as any, { set: saved.set, get: saved.get, del: saved.del });
    Object.assign(MediaAssetModel as any, { findOne: saved.findOne, create: saved.create });
  });

  it('presigns allowed uploads under the workspace prefix and remembers the declaration', async () => {
    const upload = await UploadsService.presign(ctx(), { purpose: 'slide_image', mime: 'image/png', bytes: 2048 });
    expect(upload.key).toMatch(new RegExp(`^uploads/${WS_ID}/slide_image/\\d{6}/[0-9a-f-]{36}\\.png$`));
    expect(upload.maxBytes).toBe(10 * 1024 * 1024);
    expect(JSON.parse(redisStore.get(pendingUploadKey(upload.key))!)).toEqual({
      userId: USER_ID,
      workspaceId: WS_ID,
      purpose: 'slide_image',
      mime: 'image/png',
      bytes: 2048,
    });
  });

  it('enforces the per-purpose type and size allow-lists and the role', async () => {
    expect(await rejection(UploadsService.presign(ctx(), { purpose: 'slide_image', mime: 'image/svg+xml', bytes: 10 }))).toMatchObject({
      statusCode: 400,
      code: 'UPLOAD_TYPE_NOT_ALLOWED',
    });
    expect(
      await rejection(UploadsService.presign(ctx('admin'), { purpose: 'brand_logo', mime: 'image/png', bytes: 3 * 1024 * 1024 })),
    ).toMatchObject({ statusCode: 413, code: 'UPLOAD_TOO_LARGE' });
    expect(await rejection(UploadsService.presign(ctx('viewer'), { purpose: 'slide_image', mime: 'image/png', bytes: 10 }))).toMatchObject({
      statusCode: 403,
      code: 'FORBIDDEN',
    });
    // Brand assets need workspace:brand (admin+), not just deck editing.
    expect(await rejection(UploadsService.presign(ctx('editor'), { purpose: 'brand_logo', mime: 'image/png', bytes: 10 }))).toMatchObject({
      statusCode: 403,
    });
    await UploadsService.presign(ctx('admin'), { purpose: 'brand_logo', mime: 'image/png', bytes: 10 });
  });

  it('completes a matching upload into a MediaAsset, idempotently', async () => {
    const { key } = await UploadsService.presign(ctx(), { purpose: 'slide_image', mime: 'image/webp', bytes: 5000 });
    expect(await rejection(UploadsService.complete(ctx(), key))).toMatchObject({ statusCode: 409, code: 'UPLOAD_INCOMPLETE' });

    bucket.set(key, { key, size: 4096, type: 'image/webp' });
    const first = await UploadsService.complete(ctx(), key);
    expect(first.created).toBe(true);
    expect(first.asset).toMatchObject({ key, url: `https://cdn.example/${key}`, mime: 'image/webp', bytes: 4096, source: 'upload' });
    expect(redisStore.has(pendingUploadKey(key))).toBe(false);

    const again = await UploadsService.complete(ctx(), key);
    expect(again).toMatchObject({ created: false });
    expect(String(again.asset._id)).toBe(String(first.asset._id));
    expect(assets).toHaveLength(1);
  });

  it('deletes an object whose type or size differs from the declaration', async () => {
    const typed = await UploadsService.presign(ctx(), { purpose: 'slide_image', mime: 'image/png', bytes: 100 });
    bucket.set(typed.key, { key: typed.key, size: 100, type: 'text/html' });
    expect(await rejection(UploadsService.complete(ctx(), typed.key))).toMatchObject({ statusCode: 400, code: 'UPLOAD_MISMATCH' });
    expect(bucket.has(typed.key)).toBe(false);

    const sized = await UploadsService.presign(ctx(), { purpose: 'slide_image', mime: 'image/png', bytes: 100 });
    bucket.set(sized.key, { key: sized.key, size: 101, type: 'image/png' });
    expect(await rejection(UploadsService.complete(ctx(), sized.key))).toMatchObject({ code: 'UPLOAD_MISMATCH' });
    expect(assets).toHaveLength(0);
  });

  it("treats another user's pending key as unknown", async () => {
    const { key } = await UploadsService.presign(ctx(), { purpose: 'slide_image', mime: 'image/png', bytes: 100 });
    bucket.set(key, { key, size: 100, type: 'image/png' });
    expect(await rejection(UploadsService.complete(ctx('editor', '64b0000000000000000000e5'), key))).toMatchObject({
      statusCode: 404,
      code: 'UPLOAD_NOT_FOUND',
    });
  });
});
