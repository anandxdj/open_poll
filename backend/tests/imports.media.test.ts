import { describe, expect, it } from 'bun:test';
import { createCanvas } from '@napi-rs/canvas';
import { setStorageDriver } from '../src/common/storage/storage';
import { importMediaKey, sniffImage, storeImportImage, toWebImage } from '../src/modules/imports/media';
import { MediaAssetModel } from '../src/modules/uploads/media.model';
import { importWorkerInProcess } from '../src/workers/import.worker';
import { MemoryStorage } from './helpers/memoryStorage';
import { PNG_1X1 } from './fixtures/imports/pptx';

const canvasBytes = async (format: 'png' | 'jpeg' | 'webp' | 'avif') => {
  const canvas = createCanvas(8, 8);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#336699';
  ctx.fillRect(0, 0, 8, 8);
  return new Uint8Array(await canvas.encode(format as 'png'));
};

/** A 1x1 24-bit BMP. */
const BMP_1X1 = Uint8Array.from([
  0x42, 0x4d, 0x3a, 0, 0, 0, 0, 0, 0, 0, 0x36, 0, 0, 0, 0x28, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0x18, 0, 0, 0, 0, 0, 4, 0, 0, 0,
  0x13, 0x0b, 0, 0, 0x13, 0x0b, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0xff, 0, 0, 0,
]);

const SVG = new TextEncoder().encode(
  '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="10"><rect width="20" height="10" fill="red"/><script>alert(1)</script></svg>',
);

describe('image sniffing', () => {
  it('judges by content, not by name', async () => {
    expect(sniffImage(PNG_1X1)).toEqual({ mime: 'image/png', ext: 'png' });
    expect(sniffImage(await canvasBytes('jpeg'))).toEqual({ mime: 'image/jpeg', ext: 'jpg' });
    expect(sniffImage(await canvasBytes('webp'))).toEqual({ mime: 'image/webp', ext: 'webp' });
    expect(sniffImage(await canvasBytes('avif'))).toEqual({ mime: 'image/avif', ext: 'avif' });
    expect(sniffImage(new TextEncoder().encode('GIF89a......'))).toEqual({ mime: 'image/gif', ext: 'gif' });
    expect(sniffImage(new TextEncoder().encode('<svg xmlns="x"></svg>'))).toBeNull();
    expect(sniffImage(new Uint8Array(4))).toBeNull();
  });
});

describe('toWebImage', () => {
  it('passes native formats through untouched', async () => {
    const out = await toWebImage(PNG_1X1);
    expect(out).toMatchObject({ mime: 'image/png', ext: 'png' });
    expect(out!.bytes).toBe(PNG_1X1);
  });

  it('re-encodes BMP and SVG as PNG, dropping anything scripted from the SVG', async () => {
    for (const source of [BMP_1X1, SVG]) {
      const out = await toWebImage(source);
      expect(out).toMatchObject({ mime: 'image/png', ext: 'png' });
      expect(sniffImage(out!.bytes)?.mime).toBe('image/png');
    }
  });

  it('refuses data that is not an image', async () => {
    expect(await toWebImage(new TextEncoder().encode('just some text, definitely not a picture'))).toBeNull();
    expect(await toWebImage(new Uint8Array(100))).toBeNull();
  });
});

describe('storeImportImage', () => {
  it('writes to a key derived from the job and records an import MediaAsset', async () => {
    const memory = new MemoryStorage();
    const previous = setStorageDriver(memory);
    const calls: unknown[] = [];
    const original = MediaAssetModel.updateOne;
    (MediaAssetModel as any).updateOne = (...args: unknown[]) => {
      calls.push(args);
      return Promise.resolve({});
    };
    try {
      const target = { workspaceId: '64b0000000000000000000a1', userId: '64b0000000000000000000b2', jobId: '64b0000000000000000000c3' };
      const stored = await storeImportImage(target, 3, { bytes: PNG_1X1, mime: 'image/png', ext: 'png' });
      expect(stored.key).toBe(importMediaKey(target, 3, 'png'));
      expect(stored.key).toBe('uploads/64b0000000000000000000a1/import/64b0000000000000000000c3/3.png');
      expect(stored.url).toBe(`https://cdn.test/${stored.key}`);
      expect(memory.objects.get(stored.key)).toMatchObject({ type: 'image/png' });
      const [filter, update, options] = calls[0] as any[];
      expect(filter).toEqual({ key: stored.key });
      expect(update.$setOnInsert).toMatchObject({ source: 'import', workspaceId: target.workspaceId, uploaderId: target.userId });
      expect(options).toEqual({ upsert: true });
    } finally {
      (MediaAssetModel as any).updateOne = original;
      setStorageDriver(previous);
    }
  });
});

describe('IMPORT_WORKER_INPROCESS', () => {
  it('is on unless switched off', () => {
    expect(importWorkerInProcess(undefined)).toBe(true);
    expect(importWorkerInProcess('')).toBe(true);
    expect(importWorkerInProcess('1')).toBe(true);
    expect(importWorkerInProcess('true')).toBe(true);
    for (const off of ['0', 'false', 'FALSE', 'no', 'off', ' 0 ']) expect(importWorkerInProcess(off)).toBe(false);
  });
});
